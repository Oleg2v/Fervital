// Stone descriptor — the "mineral vector" every slab scan is embedded into.
// Pure TypeScript with no imports: used by the build script (node --experimental-strip-types)
// to embed the 120 slab scans, and by /api/vein-search to embed an uploaded photo.

export interface StoneFeatures {
  /** base (median) CIELAB */
  L: number;
  a: number;
  b: number;
  C: number;
  hue: number;
  /** global lightness spread */
  stdL: number;
  /** fraction of pixels classified as vein */
  veinDensity: number;
  /** mean |ΔL| of vein pixels vs. local base */
  veinContrast: number;
  /** -1 dark veins on light ground … +1 light veins on dark ground */
  veinPolarity: number;
  veinL: number;
  veinA: number;
  veinB: number;
  veinC: number;
  /** share of fine-scale (grain) energy: granite ≈ high, marble ≈ low */
  speckle: number;
  /** orientation coherence of the pattern: banded onyx/travertine ≈ high */
  coherence: number;
  /** dominant pattern angle, degrees */
  angle: number;
}

export const VECTOR_DIMS = [
  "lightness",
  "warmth",
  "redGreen",
  "chroma",
  "veinDensity",
  "veinContrast",
  "veinPolarity",
  "veinLightness",
  "veinChroma",
  "speckle",
  "banding",
  "movement",
] as const;

const SRGB_LUT = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();

const f3 = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = SRGB_LUT[r], G = SRGB_LUT[g], B = SRGB_LUT[b];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const fx = f3(X), fy = f3(Y), fz = f3(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src.slice();
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / win;
      const add = src[row + Math.min(w - 1, x + r + 1)];
      const sub = src[row + Math.max(0, x - r)];
      acc += add - sub;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      const add = tmp[Math.min(h - 1, y + r + 1) * w + x];
      const sub = tmp[Math.max(0, y - r) * w + x];
      acc += add - sub;
    }
  }
  return out;
}

const blur2 = (src: Float32Array, w: number, h: number, r: number) =>
  boxBlur(boxBlur(src, w, h, r), w, h, r);

function median(values: Float32Array): number {
  // histogram median for values roughly in [-128, 128]
  const bins = new Uint32Array(1024);
  for (let i = 0; i < values.length; i++) {
    const v = Math.min(1023, Math.max(0, Math.round((values[i] + 128) * 4)));
    bins[v]++;
  }
  const half = values.length / 2;
  let acc = 0;
  for (let i = 0; i < 1024; i++) {
    acc += bins[i];
    if (acc >= half) return i / 4 - 128;
  }
  return 0;
}

/**
 * Compute the descriptor of an RGB(A) image. Works best on 192–320 px wide inputs.
 */
export function computeFeatures(
  pixels: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  channels = 3,
): StoneFeatures {
  const n = w * h;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * channels;
    const lab = rgbToLab(pixels[o], pixels[o + 1], pixels[o + 2]);
    L[i] = lab[0];
    A[i] = lab[1];
    B[i] = lab[2];
  }
  const Lm = median(L), Am = median(A), Bm = median(B);

  let meanL = 0;
  for (let i = 0; i < n; i++) meanL += L[i];
  meanL /= n;
  let varL = 0;
  for (let i = 0; i < n; i++) varL += (L[i] - meanL) ** 2;
  const stdL = Math.sqrt(varL / n);

  const scale = Math.max(1, Math.round(w / 42));
  const low = blur2(L, w, h, scale);
  const fine = blur2(L, w, h, 1);
  const hp = new Float32Array(n);
  const absHp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    hp[i] = L[i] - low[i];
    absHp[i] = Math.abs(hp[i]);
  }
  const mad = Math.max(0.5, median(absHp));
  const T = Math.max(5, 2.5 * mad);

  let vCount = 0, vContrast = 0, vPol = 0, vPolW = 0, vL = 0, vA = 0, vB = 0;
  for (let i = 0; i < n; i++) {
    if (absHp[i] > T) {
      vCount++;
      vContrast += absHp[i];
      vPol += hp[i];
      vPolW += absHp[i];
      vL += L[i];
      vA += A[i];
      vB += B[i];
    }
  }
  const veinDensity = vCount / n;
  const veinContrast = vCount ? vContrast / vCount : 0;
  const veinPolarity = vPolW ? vPol / vPolW : 0;
  const veinL = vCount ? vL / vCount : Lm;
  const veinA = vCount ? vA / vCount : Am;
  const veinB = vCount ? vB / vCount : Bm;

  // grain energy (fine) vs. structure energy (mid)
  let e1 = 0, e2 = 0;
  for (let i = 0; i < n; i++) {
    e1 += Math.abs(L[i] - fine[i]);
    e2 += Math.abs(fine[i] - low[i]);
  }
  const speckle = e1 / (e1 + e2 + 1e-3);

  // structure tensor on a lightly blurred field
  const sm = blur2(L, w, h, Math.max(1, Math.round(scale / 2)));
  let jxx = 0, jyy = 0, jxy = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (sm[i + 1] - sm[i - 1]) * 0.5;
      const gy = (sm[i + w] - sm[i - w]) * 0.5;
      jxx += gx * gx;
      jyy += gy * gy;
      jxy += gx * gy;
    }
  }
  const coherence = Math.sqrt((jxx - jyy) ** 2 + 4 * jxy * jxy) / (jxx + jyy + 1e-6);
  // gradient orientation → pattern runs perpendicular to it
  const angle = ((0.5 * Math.atan2(2 * jxy, jxx - jyy) * 180) / Math.PI + 90 + 180) % 180;

  const C = Math.hypot(Am, Bm);
  return {
    L: Lm,
    a: Am,
    b: Bm,
    C,
    hue: ((Math.atan2(Bm, Am) * 180) / Math.PI + 360) % 360,
    stdL,
    veinDensity,
    veinContrast,
    veinPolarity,
    veinL,
    veinA,
    veinB,
    veinC: Math.hypot(veinA, veinB),
    speckle,
    coherence,
    angle,
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Normalised 12-D vector (order = VECTOR_DIMS). */
export function toVector(f: StoneFeatures): number[] {
  return [
    clamp01(f.L / 100),
    clamp01((f.b + 6) / 40),
    clamp01((f.a + 12) / 32),
    clamp01(f.C / 40),
    clamp01(f.veinDensity / 0.2),
    clamp01(f.veinContrast / 30),
    clamp01((f.veinPolarity + 1) / 2),
    clamp01(f.veinL / 100),
    clamp01(f.veinC / 30),
    clamp01((f.speckle - 0.25) / 0.5),
    clamp01(f.coherence),
    clamp01(f.stdL / 22),
  ].map((v) => Math.round(v * 1000) / 1000);
}

/** ΔE76 between two Lab colours. */
export const deltaE = (l1: number, a1: number, b1: number, l2: number, a2: number, b2: number) =>
  Math.hypot(l1 - l2, a1 - a2, b1 - b2);
