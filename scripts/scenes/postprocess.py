"""Turn the EXRs written by render_scenes.py into the web assets + data/scenes.json.

    python scripts/scenes/postprocess.py [--work DIR] [--scenes kitchen,bathroom]

Writes (per scene) to public/scenes/:
  <scene>.jpg               beauty: plain sRGB encoding of 2^exposure * linear radiance (Standard view), q88
  <scene>_diffuse.png       diffuse lighting (Diffuse Direct + Indirect, no albedo),
                            RGB, encoded sqrt(value / diffuseScale)
  <scene>_gloss.jpg         glossy contribution of the replaceable surfaces, plain sRGB
                            transfer of the linear value (black elsewhere)
  <scene>_mask_<id>.png     antialiased visibility mask per replaceable surface
and merges the scene entries into data/scenes.json. Also prints a pass-consistency
report and writes debug overlays to the work dir.
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sceneio  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
PUBLIC = os.path.join(REPO, "public", "scenes")
DATA = os.path.join(REPO, "data", "scenes.json")
DEFAULT_WORK = os.environ.get("SCENES_WORK", os.path.join("/tmp", "fervital-scenes-work"))

LABELS = {
    "countertop": {"he": "משטח עבודה", "en": "Worktop"},
    "island": {"he": "אי", "en": "Island"},
    "island_side": {"he": "מפל האי", "en": "Island waterfall"},
    "backsplash": {"he": "חיפוי קיר", "en": "Backsplash"},
    "floor": {"he": "רצפה", "en": "Floor"},
    "vanity": {"he": "משטח רחצה", "en": "Vanity top"},
    "wall": {"he": "קיר", "en": "Wall"},
}
ORDER = ["island", "island_side", "countertop", "backsplash", "vanity", "wall", "floor"]


def rgb(ch, name):
    p = "ViewLayer.%s." % name
    return np.stack([ch[p + "R"], ch[p + "G"], ch[p + "B"]], axis=-1)


def read_png16(path):
    raw = subprocess.run(["convert", path, "-endian", "MSB", "-depth", "16", "rgb:-"], check=True, capture_output=True).stdout
    w, h = map(int, subprocess.run(["identify", "-format", "%w %h", path], check=True,
                                   capture_output=True, text=True).stdout.split())
    return np.frombuffer(raw, dtype=">u2").reshape(h, w, 3).astype(np.float64) / 65535.0


def read_8bit(path, gray=False):
    w, h = map(int, subprocess.run(["identify", "-format", "%w %h", path], check=True,
                                   capture_output=True, text=True).stdout.split())
    fmt = "gray:-" if gray else "rgb:-"
    raw = subprocess.run(["convert", path, "-depth", "8", fmt], check=True, capture_output=True).stdout
    a = np.frombuffer(raw, dtype=np.uint8)
    return a.reshape(h, w) if gray else a.reshape(h, w, 3)


def to_jpg(src_png, dst_jpg, quality=88):
    subprocess.run(["convert", src_png, "-strip", "-sampling-factor", "4:2:0", "-interlace", "JPEG",
                    "-quality", str(quality), dst_jpg], check=True)


def fill_nearest(a, iters=16, default=1.0):
    """Grow valid (non-NaN) values into NaN pixels by averaging valid 8-neighbours."""
    a = a.copy()
    valid = ~np.isnan(a)
    h, w = a.shape
    for _ in range(iters):
        if valid.all():
            break
        vals = np.pad(np.where(valid, a, 0.0), 1)
        cnt = np.pad(valid.astype(np.float64), 1)
        ssum = np.zeros((h, w))
        c = np.zeros((h, w))
        for dy in (0, 1, 2):
            for dx in (0, 1, 2):
                ssum += vals[dy:dy + h, dx:dx + w]
                c += cnt[dy:dy + h, dx:dx + w]
        new = (~valid) & (c > 0)
        a[new] = ssum[new] / c[new]
        valid |= new
    a[~valid] = default
    return a


def process(scene, work, report):
    meta = json.load(open(os.path.join(work, "%s_meta.json" % scene)))
    W, H = meta["width"], meta["height"]
    bch, bhd = sceneio.read_exr(os.path.join(work, "%s_beauty.exr" % scene))
    dch, _ = sceneio.read_exr(os.path.join(work, "%s_diffuse.exr" % scene))
    gch, _ = sceneio.read_exr(os.path.join(work, "%s_gloss.exr" % scene))
    beauty = rgb(bch, "Combined")
    diffuse = np.maximum(rgb(dch, "Combined"), 0.0)
    gloss = np.maximum(rgb(gch, "Combined"), 0.0)
    os.makedirs(PUBLIC, exist_ok=True)

    # ---- beauty: plain sRGB encoding of 2^exposure * linear radiance -------------------
    exposure = float(meta.get("view", {}).get("exposure", 0.0))
    gain = 2.0 ** exposure
    rng = np.random.default_rng(1)
    dither = (rng.random(beauty.shape) - rng.random(beauty.shape)) / 255.0   # 1 LSB triangular dither
    disp = np.clip(sceneio.srgb_encode(beauty * gain) + dither, 0, 1)
    beauty_png = os.path.join(work, "%s_beauty8.png" % scene)
    sceneio.write_png(beauty_png, sceneio.to_u8(disp))
    to_jpg(beauty_png, os.path.join(PUBLIC, "%s.jpg" % scene))

    # ---- masks --------------------------------------------------------------------
    surfaces = meta["surfaces"]
    masks = {}
    for sid in surfaces:
        m = sceneio.crypto_mask(bch, bhd, surfaces[sid]["objects"])
        masks[sid] = m
        sceneio.write_png(os.path.join(PUBLIC, "%s_mask_%s.png" % (scene, sid)), sceneio.to_u8(m))
    union = np.zeros((H, W), bool)
    for m in masks.values():
        union |= m > 0.5

    # ---- diffuse lighting -----------------------------------------------------------
    # D = Diffuse Direct + Diffuse Indirect (the denoised 'diffuse' render). Principled BSDF
    # scales its diffuse lobe by (1 - specular albedo at the view angle), so the placeholder's
    # effective diffuse colour is DiffCol = albedo * (1 - E): ~0.75 face-on, ~0.6 at the grazing
    # angles of the tops and floor. That factor (DiffCol / albedo, measured on fully covered
    # placeholder pixels and extended a few pixels past the mask edges) is folded into the
    # published pass, so  beauty = albedo * diffuse + gloss  holds on the replaceable surfaces.
    diffcol = rgb(bch, "Diffuse Color")
    cover = np.clip(np.sum(list(masks.values()), axis=0), 0.0, 1.0)
    fres = diffcol.mean(-1) / meta["albedo"]
    factor = fill_nearest(np.where(cover > 0.995, fres, np.nan), iters=16, default=1.0)
    diffuse_raw = diffuse
    diffuse = diffuse_raw * factor[..., None]
    dmax = diffuse.max(axis=-1)
    S = float(np.percentile(dmax[union], 99.5))
    S = float("%.3g" % S)
    enc = np.sqrt(np.clip(diffuse / S, 0.0, 1.0))
    sceneio.write_png(os.path.join(PUBLIC, "%s_diffuse.png" % scene), sceneio.to_u8(enc))

    # ---- gloss --------------------------------------------------------------------
    gpng = os.path.join(work, "%s_gloss8.png" % scene)
    sceneio.write_png(gpng, sceneio.to_u8(sceneio.srgb_encode(gloss)))
    to_jpg(gpng, os.path.join(PUBLIC, "%s_gloss.jpg" % scene))

    # ---- verification ----------------------------------------------------------------
    rep = {"diffuseScale": S, "gloss_clipped_frac": float((gloss.max(-1)[union] > 1.0).mean()),
           "diffuse_clipped_frac": float((dmax[union] > S).mean())}
    raw_d = rgb(bch, "Diffuse Direct") + rgb(bch, "Diffuse Indirect")
    raw_g = rgb(bch, "Glossy Color") * (rgb(bch, "Glossy Direct") + rgb(bch, "Glossy Indirect"))
    raw_sum = diffcol * raw_d + raw_g + rgb(bch, "Emission") + rgb(bch, "Transmission Color") * (
        rgb(bch, "Transmission Direct") + rgb(bch, "Transmission Indirect"))
    noisy = rgb(bch, "Noisy Image")
    # decoded web assets
    dec_d = read_8bit(os.path.join(PUBLIC, "%s_diffuse.png" % scene)).astype(np.float64) / 255.0
    dec_d = dec_d * dec_d * S
    dec_g = sceneio.srgb_decode(read_8bit(os.path.join(PUBLIC, "%s_gloss.jpg" % scene)) / 255.0)
    blender_png = read_png16(os.path.join(work, "%s_beauty.png" % scene))   # Blender's own Standard view
    beauty_jpg = read_8bit(os.path.join(PUBLIC, "%s.jpg" % scene)) / 255.0
    per = {}
    for sid, m in masks.items():
        sel = m > 0.99
        if sel.sum() < 50:
            per[sid] = {"pixels": int(sel.sum())}
            continue
        lum = lambda a: (a[sel] @ np.array([0.2126, 0.7152, 0.0722]))
        alb = meta["albedo"]
        recon = alb * diffuse + gloss
        recon_web = alb * dec_d + dec_g
        disp_web = sceneio.srgb_encode(recon_web * gain)
        per[sid] = {
            "pixels": int(sel.sum()),
            "beauty_lin_mean": float(lum(beauty).mean()),
            "diffcol_mean": float(lum(diffcol).mean()),
            "fresnel_factor_min_mean_max": [float(factor[sel].min()), float(factor[sel].mean()), float(factor[sel].max())],
            "raw_passes_sum/noisy": float(lum(raw_sum).sum() / lum(noisy).sum()),
            "diffuse_render/raw_diffuse_light": float(lum(diffuse_raw).sum() / lum(raw_d).sum()),
            "gloss_render/raw_gloss": float(lum(gloss).sum() / max(lum(raw_g).sum(), 1e-9)),
            "gloss_share_of_beauty": float(lum(gloss).sum() / lum(beauty).sum()),
            "recon(denoised)/beauty": float(lum(recon).sum() / lum(beauty).sum()),
            "recon_pixel_relerr_median": float(np.median(np.abs(lum(recon) / np.maximum(lum(beauty), 1e-6) - 1))),
            "recon_pixel_relerr_p95": float(np.percentile(np.abs(lum(recon) / np.maximum(lum(beauty), 1e-6) - 1), 95)),
            "web_recon/beauty": float(lum(recon_web).sum() / lum(beauty).sum()),
            "srgb(gain*(albedo*diff_png+gloss_jpg))_vs_beauty_jpg_mae_8bit": float(
                np.abs(disp_web[sel] - beauty_jpg[sel]).mean() * 255),
            "srgb(...)/beauty_jpg_mean": float(disp_web[sel].mean() / max(beauty_jpg[sel].mean(), 1e-6)),
            "blender_standard_png_vs_own_srgb_mae_8bit": float(
                np.abs(blender_png[sel] - sceneio.srgb_encode(beauty * gain)[sel]).mean() * 255),
            "clipped_frac(beauty*gain>1)": float((beauty[sel].max(-1) * gain > 1.0).mean()),
        }
    rep["surfaces"] = per
    report[scene] = rep

    # ---- json entry -------------------------------------------------------------------
    entries = []
    for sid in [s for s in ORDER if s in surfaces]:
        s = surfaces[sid]
        m = masks[sid] > 0.01
        ys, xs = np.nonzero(m)
        bbox = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1] if xs.size else [0, 0, 0, 0]
        entries.append({
            "id": sid,
            "mask": "/scenes/%s_mask_%s.png" % (scene, sid),
            "quad": [[round(float(x), 1), round(float(y), 1)] for x, y in s["quad"]],
            "sizeMm": [int(v) for v in s["sizeMm"]],
            "orientation": s["orientation"],
            "label": LABELS[sid],
            "bbox": bbox,
        })
    entry = {
        "image": "/scenes/%s.jpg" % scene,
        "width": W, "height": H,
        "diffuse": "/scenes/%s_diffuse.png" % scene, "diffuseScale": S,
        "gloss": "/scenes/%s_gloss.jpg" % scene,
        "albedo": meta["albedo"],
        "surfaces": entries,
    }
    if abs(exposure) > 1e-6:
        entry = {**{k: v for k, v in entry.items() if k != "surfaces"}, "exposure": exposure,
                 "surfaces": entries}
    overlay(scene, work, entries)
    return entry


def overlay(scene, work, entries):
    cols = ["#ff3b30", "#34c759", "#0a84ff", "#ffcc00", "#bf5af2", "#ff9f0a", "#64d2ff"]
    args = ["convert", os.path.join(PUBLIC, "%s.jpg" % scene), "-fill", "none", "-strokewidth", "3"]
    for i, e in enumerate(entries):
        pts = " ".join("%.1f,%.1f" % (x, y) for x, y in e["quad"])
        args += ["-stroke", cols[i % len(cols)], "-draw", "polygon %s" % pts]
        x0, y0 = e["quad"][0]
        args += ["-stroke", cols[i % len(cols)], "-draw", "circle %.1f,%.1f %.1f,%.1f" % (x0, y0, x0 + 7, y0)]
    args.append(os.path.join(work, "%s_quads.png" % scene))
    subprocess.run(args, check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=DEFAULT_WORK)
    ap.add_argument("--scenes", default="kitchen,bathroom")
    ap.add_argument("--public", default=None, help="override output dir (testing)")
    ap.add_argument("--data", default=None, help="override scenes.json path (testing)")
    args = ap.parse_args()
    global PUBLIC, DATA
    PUBLIC = args.public or PUBLIC
    DATA = args.data or DATA
    data = {}
    if os.path.exists(DATA):
        data = json.load(open(DATA))
    report = {}
    for scene in args.scenes.split(","):
        if not os.path.exists(os.path.join(args.work, "%s_meta.json" % scene)):
            print("skip", scene)
            continue
        data[scene] = process(scene, args.work, report)
    ordered = {k: data[k] for k in ("kitchen", "bathroom") if k in data}
    os.makedirs(os.path.dirname(DATA), exist_ok=True)
    with open(DATA, "w") as fh:
        json.dump(ordered, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(json.dumps(report, indent=1))
    with open(os.path.join(args.work, "report.json"), "w") as fh:
        json.dump(report, fh, indent=1)


if __name__ == "__main__":
    main()
