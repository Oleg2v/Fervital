#!/usr/bin/env node
// Builds web-ready slab textures from ambientCG source scans.
//   node scripts/build-textures.mjs <ambientcg-src-dir>
// Output: public/tex/<key>/{c512,c1k,c2k,c4k?}.webp, {n1k,n2k}.webp, tiles/<level>/<x>_<y>.webp
//         data/textures.json (manifest)
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { TEXTURES, FAMILIES } from "./catalog.mjs";

sharp.concurrency(4);
sharp.cache(false);

const SRC = process.argv[2];
if (!SRC) {
  console.error("usage: node scripts/build-textures.mjs <ambientcg-src-dir>");
  process.exit(1);
}
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "public", "tex");
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;

// Deep-zoom depth per texture: 8K for the four signature stones, 4K for the
// rest of the hero set, 2K for everything else.
const ZOOM_8K = new Set(["calacatta-oro", "statuario-venato", "nero-marquina-extra", "onice-miele"]);
const TILE = 512;

async function findFile(dir, suffix) {
  const files = await fs.readdir(dir);
  const f = files.find((n) => n.endsWith(suffix));
  if (!f) throw new Error(`missing *${suffix} in ${dir}`);
  return path.join(dir, f);
}

const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Apply the documented grade to a raw RGB buffer. */
async function grade(raw, w, h, g) {
  if (!g) return raw;
  const px = w * h;
  const out = Buffer.allocUnsafe(raw.length);
  let base = null;
  if (g.detail || g.goldVeins || g.veins) {
    // Low-frequency base: downsample, blur, upsample (cheap large-radius blur).
    const small = Math.max(64, Math.round(w / 24));
    base = await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
      .resize(small, small, { kernel: "cubic" })
      .blur(2.2)
      .resize(w, h, { kernel: "cubic" })
      .raw()
      .toBuffer();
  }
  const k = g.detail ?? 1;
  const vv = g.veins ?? null; // nonlinear: flatten clouds, boost true veins
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const gold = g.goldVeins ?? 0;
  const lift = g.lift ?? 0;
  const desat = g.desat ?? 0;
  const sat = g.sat ?? 1;
  const basalt = g.basalt ?? 0;
  for (let i = 0; i < px; i++) {
    const o = i * 3;
    let r = raw[o], gg = raw[o + 1], b = raw[o + 2];
    if (base) {
      const br = base[o], bg = base[o + 1], bb = base[o + 2];
      let kk = k;
      if (vv) {
        const lum0 = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
        const blum0 = 0.2126 * br + 0.7152 * bg + 0.0722 * bb;
        const d0 = Math.abs(blum0 - lum0);
        kk = vv.flatten + (vv.boost - vv.flatten) * smooth(vv.lo, vv.hi, d0);
      }
      r = br + (r - br) * kk;
      gg = bg + (gg - bg) * kk;
      b = bb + (b - bb) * kk;
      if (gold) {
        const lum = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
        const blum = 0.2126 * br + 0.7152 * bg + 0.0722 * bb;
        const d = Math.max(0, blum - lum); // darker than surroundings = vein
        r += d * gold * 0.22;
        gg += d * gold * 0.06;
        b -= d * gold * 0.34;
      }
    }
    if (basalt) {
      const lum = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      const v = Math.pow(lum / 255, 1.12) * 255 * basalt;
      r = v * 1.0;
      gg = v * 1.0;
      b = v * 1.03;
    }
    if (desat || sat !== 1) {
      const lum = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      const f = (1 - desat) * sat;
      r = lum + (r - lum) * f;
      gg = lum + (gg - lum) * f;
      b = lum + (b - lum) * f;
    }
    if (lift) {
      r += lift * (1 - r / 255);
      gg += lift * (1 - gg / 255);
      b += lift * (1 - b / 255);
    }
    out[o] = clamp8(r);
    out[o + 1] = clamp8(gg);
    out[o + 2] = clamp8(b);
  }
  return out;
}

async function writeWebp(raw, w, h, size, file, quality) {
  await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .resize(size, size, { kernel: "lanczos3" })
    .webp({ quality, effort: 5, smartSubsample: true })
    .toFile(file);
}

async function buildTiles(raw, w, h, maxLevel, dir) {
  const levels = [];
  for (let level = 0; level <= maxLevel; level++) {
    const size = TILE * 2 ** level;
    const lvlBuf =
      size === w
        ? raw
        : await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
            .resize(size, size, { kernel: "lanczos3" })
            .raw()
            .toBuffer();
    const n = size / TILE;
    await fs.mkdir(path.join(dir, String(level)), { recursive: true });
    const jobs = [];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        jobs.push(
          sharp(lvlBuf, { raw: { width: size, height: size, channels: 3 } })
            .extract({ left: x * TILE, top: y * TILE, width: TILE, height: TILE })
            .webp({ quality: level >= 3 ? 70 : 76, effort: 4 })
            .toFile(path.join(dir, String(level), `${x}_${y}.webp`)),
        );
        if (jobs.length >= 16) await Promise.all(jobs.splice(0));
      }
    }
    await Promise.all(jobs);
    levels.push({ level, size, n });
  }
  return levels;
}

function meanColor(raw) {
  let r = 0, g = 0, b = 0;
  const step = 97 * 3;
  let n = 0;
  for (let i = 0; i < raw.length; i += step) {
    r += raw[i]; g += raw[i + 1]; b += raw[i + 2]; n++;
  }
  const hex = (v) => Math.round(v / n).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const manifest = [];
  for (const t of TEXTURES) {
    if (ONLY && !ONLY.includes(t.key)) continue;
    const t0 = Date.now();
    const dir = path.join(SRC, t.src);
    const colorFile = await findFile(dir, "_Color.jpg");
    const normalFile = await findFile(dir, "_NormalGL.jpg");
    const meta = await sharp(colorFile).metadata();
    const w = meta.width, h = meta.height;
    const raw0 = await sharp(colorFile).removeAlpha().toColourspace("srgb").raw().toBuffer();
    const raw = await grade(raw0, w, h, t.grade);
    const out = path.join(OUT, t.key);
    await fs.rm(out, { recursive: true, force: true });
    await fs.mkdir(out, { recursive: true });

    const hero = t.res === "8K";
    await writeWebp(raw, w, h, 512, path.join(out, "c512.webp"), 74);
    await writeWebp(raw, w, h, 1024, path.join(out, "c1k.webp"), 78);
    await writeWebp(raw, w, h, 2048, path.join(out, "c2k.webp"), 80);
    if (hero) await writeWebp(raw, w, h, 4096, path.join(out, "c4k.webp"), 78);

    const nmeta = await sharp(normalFile).metadata();
    const nraw = await sharp(normalFile).removeAlpha().raw().toBuffer();
    await writeWebp(nraw, nmeta.width, nmeta.height, 1024, path.join(out, "n1k.webp"), 84);
    await writeWebp(nraw, nmeta.width, nmeta.height, 2048, path.join(out, "n2k.webp"), 84);

    const maxLevel = ZOOM_8K.has(t.key) && w >= 8192 ? 4 : hero ? 3 : 2;
    const levels = await buildTiles(raw, w, h, maxLevel, path.join(out, "tiles"));

    manifest.push({
      key: t.key,
      source: { library: "ambientCG", asset: t.src, url: `https://ambientcg.com/a/${t.src}`, license: "CC0 1.0", resolution: `${w}×${h}` },
      family: t.family,
      tiers: hero ? ["c512", "c1k", "c2k", "c4k"] : ["c512", "c1k", "c2k"],
      normal: ["n1k", "n2k"],
      zoom: { tile: TILE, maxLevel, size: TILE * 2 ** maxLevel, levels: levels.length },
      mean: meanColor(raw),
    });
    console.log(`✓ ${t.key.padEnd(24)} ${w}px  zoom L${maxLevel}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  if (!ONLY) {
    await fs.writeFile(path.join(ROOT, "data", "textures.json"), JSON.stringify(manifest, null, 1));
  }
  console.log("families:", Object.keys(FAMILIES).length, "textures:", manifest.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
