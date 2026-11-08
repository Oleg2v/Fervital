"""Small, dependency-free (numpy + zlib) image I/O helpers for the scene renders.

* read_exr(path)  -> (channels: dict[name -> float32 HxW array], header: dict)
  Supports single-part scanline OpenEXR files with NONE / ZIPS / ZIP compression
  (which is what render_scenes.py writes), HALF / FLOAT / UINT channels.
* write_png(path, array)  -> 8-bit grayscale (HxW) or RGB (HxWx3) PNG.
* srgb_encode / srgb_decode  -> the IEC 61966-2-1 transfer functions.
* crypto_mask(channels, header, object_name)  -> antialiased coverage of one
  object from a Cryptomatte object pass (uses the manifest in the EXR header).
"""
import json
import struct
import zlib

import numpy as np

_LINES_PER_BLOCK = {0: 1, 1: 1, 2: 1, 3: 16}
_DTYPE = {0: np.dtype("<u4"), 1: np.dtype("<f2"), 2: np.dtype("<f4")}


def _read_cstr(buf, pos):
    end = buf.index(b"\x00", pos)
    return buf[pos:end].decode("latin-1"), end + 1


def _parse_attrs(buf, pos):
    """Parse one attribute list (terminated by a null byte). Returns (dict, pos)."""
    header = {}
    while True:
        if buf[pos] == 0:
            return header, pos + 1
        name, pos = _read_cstr(buf, pos)
        typ, pos = _read_cstr(buf, pos)
        (size,) = struct.unpack_from("<i", buf, pos)
        pos += 4
        raw = buf[pos:pos + size]
        pos += size
        if typ == "chlist":
            chans = []
            p = 0
            while raw[p] != 0:
                cname, p = _read_cstr(raw, p)
                ptype, _plin, xs, ys = struct.unpack_from("<iB3xii", raw, p)
                p += 16
                chans.append((cname, ptype, xs, ys))
            header[name] = chans
        elif typ == "compression":
            header[name] = raw[0]
        elif typ == "box2i":
            header[name] = struct.unpack("<iiii", raw)
        elif typ == "string":
            header[name] = raw.decode("utf-8", "replace")
        elif typ == "int":
            header[name] = struct.unpack("<i", raw)[0]
        elif typ == "float":
            header[name] = struct.unpack("<f", raw)[0]
        else:
            header[name] = (typ, raw)


def _parse_headers(buf):
    magic, version = struct.unpack_from("<ii", buf, 0)
    if magic != 20000630:
        raise ValueError("not an OpenEXR file")
    if version & 0x200 or version & 0x800:
        raise ValueError("tiled / deep EXR not supported")
    multipart = bool(version & 0x1000)
    pos = 8
    parts = []
    if not multipart:
        h, pos = _parse_attrs(buf, pos)
        parts.append(h)
    else:
        while buf[pos] != 0:
            h, pos = _parse_attrs(buf, pos)
            parts.append(h)
        pos += 1
    return parts, pos, multipart


def _unzip(data, expected):
    t = np.frombuffer(zlib.decompress(data), dtype=np.uint8).astype(np.int64)
    if t.size != expected:
        raise ValueError("bad zip block size")
    t[1:] -= 128
    t = (np.cumsum(t) % 256).astype(np.uint8)
    half = (t.size + 1) // 2
    out = np.empty_like(t)
    out[0::2] = t[:half]
    out[1::2] = t[half:]
    return out.tobytes()


def read_exr(path):
    """Read every channel of a (single- or multi-part) scanline EXR.

    Returns (channels, header) where channels maps the full channel name
    (e.g. 'ViewLayer.DiffDir.R') to a float32 HxW array (row 0 = top) and
    header is the merged attribute dict of all parts."""
    with open(path, "rb") as fh:
        buf = fh.read()
    parts, pos, multipart = _parse_headers(buf)
    tables = []
    for h in parts:
        xmin, ymin, xmax, ymax = h["dataWindow"]
        lpb = _LINES_PER_BLOCK.get(h["compression"])
        if lpb is None:
            raise ValueError("unsupported EXR compression %d" % h["compression"])
        n = h.get("chunkCount", (ymax - ymin + lpb) // lpb)
        tables.append(struct.unpack_from("<%dQ" % n, buf, pos))
        pos += 8 * n
    out = {}
    merged = {}
    for pi, (h, offsets) in enumerate(zip(parts, tables)):
        merged.update({k: v for k, v in h.items() if k != "channels"})
        comp = h["compression"]
        xmin, ymin, xmax, ymax = h["dataWindow"]
        w, hh = xmax - xmin + 1, ymax - ymin + 1
        chans = h["channels"]
        lpb = _LINES_PER_BLOCK[comp]
        arrs = {c[0]: np.empty((hh, w), dtype=np.float32) for c in chans}
        for off in offsets:
            if multipart:
                (_part,) = struct.unpack_from("<i", buf, off)
                off += 4
            y, size = struct.unpack_from("<ii", buf, off)
            data = buf[off + 8:off + 8 + size]
            nlines = min(lpb, ymax - y + 1)
            expected = sum(_DTYPE[c[1]].itemsize for c in chans) * w * nlines
            if comp in (2, 3) and size < expected:
                data = _unzip(data, expected)
            elif comp == 1:
                raise ValueError("RLE not implemented")
            p = 0
            for line in range(nlines):
                row = y - ymin + line
                for cname, ptype, _xs, _ys in chans:
                    dt = _DTYPE[ptype]
                    arrs[cname][row] = np.frombuffer(data, dtype=dt, count=w, offset=p).astype(np.float32)
                    p += w * dt.itemsize
        out.update(arrs)
    return out, merged


def srgb_encode(lin):
    lin = np.clip(lin, 0.0, 1.0)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1.0 / 2.4) - 0.055)


def srgb_decode(v):
    v = np.asarray(v, dtype=np.float64)
    return np.where(v <= 0.04045, v / 12.92, np.power((v + 0.055) / 1.055, 2.4))


def to_u8(x):
    return np.clip(np.round(np.asarray(x) * 255.0), 0, 255).astype(np.uint8)


def write_png(path, arr):
    """arr: uint8 HxW (gray) or HxWx3 (RGB). Rows top-to-bottom."""
    arr = np.ascontiguousarray(arr)
    if arr.dtype != np.uint8:
        raise ValueError("write_png expects uint8")
    if arr.ndim == 2:
        h, w = arr.shape
        ctype, bpp = 0, 1
    else:
        h, w, c = arr.shape
        ctype, bpp = {3: (2, 3), 4: (6, 4)}[c]
    rows = arr.reshape(h, w * bpp).astype(np.int16)
    # PNG "Up" + "Sub" filters chosen per image (cheap heuristic): try both, keep the smaller.
    best = None
    for ftype in (1, 2, 4):
        if ftype == 1:   # Sub
            f = rows.copy()
            f[:, bpp:] -= rows[:, :-bpp]
        elif ftype == 2:  # Up
            f = rows.copy()
            f[1:] -= rows[:-1]
        else:            # Paeth
            a = np.zeros_like(rows); a[:, bpp:] = rows[:, :-bpp]
            b = np.zeros_like(rows); b[1:] = rows[:-1]
            cc = np.zeros_like(rows); cc[1:, bpp:] = rows[:-1, :-bpp]
            p = a + b - cc
            pa, pb, pc = np.abs(p - a), np.abs(p - b), np.abs(p - cc)
            pred = np.where((pa <= pb) & (pa <= pc), a, np.where(pb <= pc, b, cc))
            f = rows - pred
        f = (f % 256).astype(np.uint8)
        raw = np.concatenate([np.full((h, 1), ftype, np.uint8), f], axis=1).tobytes()
        comp = zlib.compress(raw, 9)
        if best is None or len(comp) < len(best):
            best = comp

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ctype, 0, 0, 0))
    png += chunk(b"sRGB", b"\x00")
    png += chunk(b"IDAT", best)
    png += chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)


def crypto_manifest(header):
    """Return {object_name: float32 id} for every cryptomatte layer in the header."""
    res = {}
    for k, v in header.items():
        if k.startswith("cryptomatte/") and k.endswith("/manifest"):
            for name, hexid in json.loads(v).items():
                res[name] = struct.unpack("<f", struct.pack("<I", int(hexid, 16)))[0]
    return res


def crypto_layers(channels, prefix):
    """Find CryptoObjectNN RGBA channel groups -> list of (id, coverage) array pairs."""
    pairs = []
    i = 0
    while True:
        base = "%s%02d" % (prefix, i)
        keys = [k for k in channels if k.endswith(base + ".R") or k.endswith(base + ".r")]
        if not keys:
            break
        stem = keys[0][:-2]
        get = lambda s: channels.get(stem + "." + s, channels.get(stem + "." + s.lower()))
        pairs.append((get("R"), get("G")))
        pairs.append((get("B"), get("A")))
        i += 1
    return pairs


def crypto_mask(channels, header, names, prefix="CryptoObject"):
    manifest = crypto_manifest(header)
    pairs = crypto_layers(channels, prefix)
    if not pairs:
        raise ValueError("no cryptomatte layers found")
    ids = [np.float32(manifest[n]) for n in names]
    h, w = pairs[0][0].shape
    m = np.zeros((h, w), np.float32)
    for idarr, cov in pairs:
        for oid in ids:
            m += np.where(idarr.view(np.uint32) == np.array(oid, np.float32).view(np.uint32), cov, 0.0)
    return np.clip(m, 0.0, 1.0)
