// Separable Lanczos-3 resampling on packed RGB, with no dependencies: it runs in the browser (vein search embeds
// the visitor's photo on their device), in Node and in a Worker, and gives the same pixels everywhere.

export interface RgbImage {
  /** packed RGB, 3 bytes per pixel */
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Centre crop (the given share of each side, and no more elongated than 1:4 either way, which also bounds the
 * memory), then resample to `outW` pixels wide, keeping the aspect.
 * Separable Lanczos-3, the kernel sharp/libvips used when the catalogue's vectors were built
 * (scripts/build-data.mjs), so a photo of a slab lands close to that slab's own vector.
 */
export function cropResize(src: RgbImage, share: number, outW: number): RgbImage {
  let cw = Math.max(1, Math.round(src.width * share));
  let ch = Math.max(1, Math.round(src.height * share));
  ch = Math.min(ch, cw * 4);
  cw = Math.min(cw, ch * 4);
  const x0 = Math.round((src.width - cw) / 2);
  const y0 = Math.round((src.height - ch) / 2);
  const W = Math.max(1, outW);
  const H = Math.max(1, Math.round((ch * W) / cw));
  const hx = taps(cw, W);
  const hy = taps(ch, H);
  // horizontal pass over the crop's rows → W × ch floats
  const mid = new Float32Array(W * ch * 3);
  for (let y = 0; y < ch; y++) {
    const row = (y0 + y) * src.width;
    for (let x = 0; x < W; x++) {
      const { start, w } = hx[x];
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < w.length; k++) {
        const i = (row + x0 + start + k) * 3;
        r += src.data[i] * w[k];
        g += src.data[i + 1] * w[k];
        b += src.data[i + 2] * w[k];
      }
      const o = (y * W + x) * 3;
      mid[o] = r;
      mid[o + 1] = g;
      mid[o + 2] = b;
    }
  }
  // vertical pass → W × H bytes
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const { start, w } = hy[y];
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < w.length; k++) {
        const i = ((start + k) * W + x) * 3;
        r += mid[i] * w[k];
        g += mid[i + 1] * w[k];
        b += mid[i + 2] * w[k];
      }
      const o = (y * W + x) * 3;
      out[o] = clamp8(r);
      out[o + 1] = clamp8(g);
      out[o + 2] = clamp8(b);
    }
  }
  return { data: out, width: W, height: H };
}

const clamp8 = (v: number) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));
const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
const lanczos3 = (x: number) => (x > -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0);

/** Normalised Lanczos-3 taps mapping `n` source samples onto `m` output samples (edges clamped into range). */
function taps(n: number, m: number): { start: number; w: Float32Array }[] {
  const scale = n / m;
  const s = Math.max(1, scale); // stretch the kernel when shrinking (anti-aliasing)
  const support = 3 * s;
  const res: { start: number; w: Float32Array }[] = [];
  for (let i = 0; i < m; i++) {
    const c = (i + 0.5) * scale - 0.5;
    let start = Math.ceil(c - support);
    let end = Math.floor(c + support);
    start = Math.max(0, start);
    end = Math.min(n - 1, end);
    const w = new Float32Array(end - start + 1);
    let sum = 0;
    for (let k = start; k <= end; k++) {
      const v = lanczos3((k - c) / s);
      w[k - start] = v;
      sum += v;
    }
    if (sum !== 0) for (let k = 0; k < w.length; k++) w[k] /= sum;
    res.push({ start, w });
  }
  return res;
}
