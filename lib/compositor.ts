"use client";

// WebGL2 stone compositor: maps a slab onto segmented surfaces of a photo with
// correct perspective (homography per surface), relights it and keeps reflections.

import type { Slab } from "./types";

export type SurfaceKind = 0 | 1 | 2 | 3; // 0 top, 1 wall, 2 floor, 3 vertical side
export interface CompSurface {
  id: string;
  kind: SurfaceKind;
  quad: [number, number][]; // image px, 4 corners (see orientation rules)
  sizeMm: [number, number];
  mask?: string; // url of a grayscale mask
  polygon?: [number, number][]; // image px (uploads)
  label: { he: string; en: string };
}
export interface CompScene {
  key: string;
  image: string; // url or data URL
  width: number;
  height: number;
  diffuse?: string;
  diffuseScale?: number;
  gloss?: string;
  albedo?: number;
  exposure?: number;
  surfaces: CompSurface[];
}

const MAX_SURF = 8;

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPhoto, uDiffuse, uGloss, uMaskA, uMaskB, uSlab;
uniform vec2 uSize;
uniform int uCount;
uniform mat3 uHinv[${MAX_SURF}];
uniform vec4 uSurf[${MAX_SURF}];
uniform vec4 uRefC[${MAX_SURF}];
uniform vec4 uCrop;
uniform float uRot;
uniform vec2 uSlabMm;
uniform float uPasses, uDiffScale, uExposure, uGlossK, uReveal, uShowAll;

vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 slabAt(vec2 mm, float kind, out float seam) {
  vec2 cellSize = uSlabMm;
  if (kind > 1.5 && kind < 2.5) cellSize = uSlabMm * 0.5;     // floor: half-slab tiles
  vec2 g = mm / cellSize;
  vec2 cell = floor(g);
  vec2 f = fract(g);
  vec2 m = mod(cell, 2.0);
  f = mix(f, 1.0 - f, m);                                         // bookmatched panels
  if (uRot > 0.5) f = 1.0 - f;
  vec2 tc = vec2(uCrop.x + f.x * uCrop.z, uCrop.y + f.y * uCrop.w);
  vec2 e = min(fract(g), 1.0 - fract(g)) * cellSize;
  float edgeMm = (kind > 1.5 && kind < 2.5) ? min(e.x, e.y) : e.x;
  seam = 1.0 - smoothstep(0.6, 2.4, edgeMm);
  return toLin(texture(uSlab, tc).rgb);
}

void main() {
  vec2 uv = vUv;
  vec2 px = uv * uSize;
  vec3 photo = toLin(texture(uPhoto, uv).rgb);
  vec3 col = photo;
  vec4 mA = texture(uMaskA, uv);
  vec4 mB = texture(uMaskB, uv);
  float masks[8] = float[8](mA.r, mA.g, mA.b, mA.a, mB.r, mB.g, mB.b, mB.a);
  for (int i = 0; i < ${MAX_SURF}; i++) {
    if (i >= uCount) break;
    float m = masks[i] * uSurf[i].x;
    if (m < 0.002) continue;
    vec3 h = uHinv[i] * vec3(px, 1.0);
    vec2 st = h.xy / h.z;
    vec2 mm = st * uSurf[i].yz;
    float rv = uShowAll > 0.5 ? 1.0 : smoothstep(st.x - 0.12, st.x, uReveal * 1.24 - 0.12);
    m *= rv;
    float seam;
    vec3 stone = slabAt(mm, uSurf[i].w, seam);
    vec3 lit;
    if (uPasses > 0.5) {
      vec3 d = texture(uDiffuse, uv).rgb;
      d = d * d * uDiffScale;
      vec3 gl = toLin(texture(uGloss, uv).rgb);
      lit = (stone * d + gl * uGlossK) * uExposure;
    } else {
      vec3 ref = uRefC[i].rgb;
      float shade = clamp(luma(photo) / max(luma(ref), 1e-3), 0.12, 2.4);
      lit = stone * mix(1.0, shade, 0.92);
      // keep the photo's specular highlights as reflections on the new stone
      vec3 spec = max(photo - ref * 1.25, vec3(0.0));
      lit += spec * (0.35 + uGlossK);
    }
    lit *= 1.0 - seam * 0.5;
    col = mix(col, lit, clamp(m, 0.0, 1.0));
  }
  outColor = vec4(toSrgb(col), 1.0);
}`;

// ── homography: unit square → quad, and its inverse ──
export function squareToQuad(q: [number, number][]): number[] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a, b, c, d, e, f, g, h;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = x1 - x0; b = x3 - x0; c = x0;
    d = y1 - y0; e = y3 - y0; f = y0;
    g = 0; h = 0;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
  }
  return [a, b, c, d, e, f, g, h, 1]; // row-major
}

export function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d];
  return inv.map((v) => v / det);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.decoding = "async";
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}

const imgCache = new Map<string, Promise<HTMLImageElement>>();
const cachedImage = (src: string) => {
  let p = imgCache.get(src);
  if (!p) {
    p = loadImage(src);
    imgCache.set(src, p);
  }
  return p;
};

export interface SceneAssets {
  scene: CompScene;
  photo: HTMLImageElement;
  diffuse: HTMLImageElement | null;
  gloss: HTMLImageElement | null;
  maskA: Uint8Array;
  maskB: Uint8Array;
  refs: [number, number, number][];
  mw: number;
  mh: number;
}

/** Load a scene and pack its surface masks (≤ 8) into two RGBA buffers. */
export async function loadScene(scene: CompScene): Promise<SceneAssets> {
  const [photo, diffuse, gloss] = await Promise.all([
    cachedImage(scene.image),
    scene.diffuse ? cachedImage(scene.diffuse) : Promise.resolve(null),
    scene.gloss ? cachedImage(scene.gloss) : Promise.resolve(null),
  ]);
  const mw = Math.min(scene.width, 1600);
  const mh = Math.round((mw / scene.width) * scene.height);
  const maskA = new Uint8Array(mw * mh * 4);
  const maskB = new Uint8Array(mw * mh * 4);
  const cv = document.createElement("canvas");
  cv.width = mw;
  cv.height = mh;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  // photo copy for reference colours
  ctx.drawImage(photo, 0, 0, mw, mh);
  const photoPx = ctx.getImageData(0, 0, mw, mh).data;
  const refs: [number, number, number][] = [];
  const surfaces = scene.surfaces.slice(0, MAX_SURF);
  for (let s = 0; s < surfaces.length; s++) {
    const sf = surfaces[s];
    ctx.clearRect(0, 0, mw, mh);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, mw, mh);
    if (sf.mask) {
      const m = await cachedImage(sf.mask);
      ctx.drawImage(m, 0, 0, mw, mh);
    } else if (sf.polygon?.length) {
      const k = mw / scene.width;
      ctx.filter = "blur(1.2px)";
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      sf.polygon.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
      ctx.closePath();
      ctx.fill();
      ctx.filter = "none";
    }
    const d = ctx.getImageData(0, 0, mw, mh).data;
    const target = s < 4 ? maskA : maskB;
    const ch = s % 4;
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let p = 0, q = 0; p < d.length; p += 4, q++) {
      const v = d[p];
      target[q * 4 + ch] = v;
      if (v > 200 && q % 7 === 0) {
        sr += photoPx[p];
        sg += photoPx[p + 1];
        sb += photoPx[p + 2];
        n++;
      }
    }
    const lin = (c: number) => {
      const x = c / 255;
      return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    refs.push(n ? [lin(sr / n), lin(sg / n), lin(sb / n)] : [0.5, 0.5, 0.5]);
  }
  return { scene: { ...scene, surfaces }, photo, diffuse, gloss, maskA, maskB, refs, mw, mh };
}

export interface RenderOpts {
  slab: Slab;
  slabImage: HTMLImageElement;
  enabled: Record<string, boolean>;
  reveal: number;
}

const GLOSS: Record<Slab["finish"], number> = { polished: 1.0, honed: 0.32, leathered: 0.14 };

export class Compositor {
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  tex: Record<string, WebGLTexture> = {};
  uni: Record<string, WebGLUniformLocation | null> = {};
  assets: SceneAssets | null = null;
  slabKey = "";

  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
    if (!gl) throw new Error("webgl2-unavailable");
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
    this.prog = p;
    gl.useProgram(p);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ["uPhoto", "uDiffuse", "uGloss", "uMaskA", "uMaskB", "uSlab", "uSize", "uCount", "uCrop", "uRot", "uSlabMm", "uPasses", "uDiffScale", "uExposure", "uGlossK", "uReveal", "uShowAll"])
      this.uni[n] = gl.getUniformLocation(p, n);
    ["uPhoto", "uDiffuse", "uGloss", "uMaskA", "uMaskB", "uSlab"].forEach((n, i) => gl.uniform1i(this.uni[n], i));
  }

  private upload(unit: number, name: string, src: TexImageSource | { raw: Uint8Array; w: number; h: number }, mip = false) {
    const gl = this.gl;
    let t = this.tex[name];
    if (!t) {
      t = gl.createTexture()!;
      this.tex[name] = t;
    }
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if ("raw" in src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, src.w, src.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, src.raw);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (mip) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      const ext = gl.getExtension("EXT_texture_filter_anisotropic");
      if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }

  setScene(a: SceneAssets) {
    this.assets = a;
    const { scene } = a;
    this.canvas.width = scene.width;
    this.canvas.height = scene.height;
    this.upload(0, "photo", a.photo);
    this.upload(1, "diffuse", a.diffuse ?? a.photo);
    this.upload(2, "gloss", a.gloss ?? a.photo);
    this.upload(3, "maskA", { raw: a.maskA, w: a.mw, h: a.mh });
    this.upload(4, "maskB", { raw: a.maskB, w: a.mw, h: a.mh });
  }

  setSlab(slabImage: HTMLImageElement, key: string) {
    if (this.slabKey === key) return;
    this.slabKey = key;
    this.upload(5, "slab", slabImage, true);
  }

  render(o: RenderOpts) {
    const a = this.assets;
    if (!a) return;
    const gl = this.gl;
    const { scene } = a;
    this.setSlab(o.slabImage, o.slab.tex);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.prog);
    gl.uniform2f(this.uni.uSize, scene.width, scene.height);
    gl.uniform1i(this.uni.uCount, scene.surfaces.length);
    const hinv: number[] = [];
    const surf: number[] = [];
    const refc: number[] = [];
    scene.surfaces.forEach((s, i) => {
      const H = invert3(squareToQuad(s.quad));
      // GLSL mat3 is column-major
      hinv.push(H[0], H[3], H[6], H[1], H[4], H[7], H[2], H[5], H[8]);
      surf.push(o.enabled[s.id] === false ? 0 : 1, s.sizeMm[0], s.sizeMm[1], s.kind);
      const r = a.refs[i] ?? [0.5, 0.5, 0.5];
      refc.push(r[0], r[1], r[2], 1);
    });
    while (hinv.length < MAX_SURF * 9) hinv.push(1, 0, 0, 0, 1, 0, 0, 0, 1);
    while (surf.length < MAX_SURF * 4) surf.push(0, 1, 1, 0);
    while (refc.length < MAX_SURF * 4) refc.push(0.5, 0.5, 0.5, 1);
    gl.uniformMatrix3fv(gl.getUniformLocation(this.prog, "uHinv"), false, new Float32Array(hinv));
    gl.uniform4fv(gl.getUniformLocation(this.prog, "uSurf"), new Float32Array(surf));
    gl.uniform4fv(gl.getUniformLocation(this.prog, "uRefC"), new Float32Array(refc));
    const { u, v, w, h, rot } = o.slab.crop;
    // textures are uploaded without a Y flip, so t = 0 is the image's top row, the same way crop V runs
    gl.uniform4f(this.uni.uCrop, u, v, w, h);
    gl.uniform1f(this.uni.uRot, rot === 180 ? 1 : 0);
    gl.uniform2f(this.uni.uSlabMm, o.slab.lengthMm, o.slab.heightMm);
    const passes = a.diffuse && a.gloss ? 1 : 0;
    gl.uniform1f(this.uni.uPasses, passes);
    gl.uniform1f(this.uni.uDiffScale, scene.diffuseScale ?? 1);
    gl.uniform1f(this.uni.uExposure, Math.pow(2, scene.exposure ?? 0));
    gl.uniform1f(this.uni.uGlossK, GLOSS[o.slab.finish]);
    gl.uniform1f(this.uni.uReveal, o.reveal);
    gl.uniform1f(this.uni.uShowAll, o.reveal >= 1 ? 1 : 0);
    // re-bind textures (another compositor may share the context's units)
    ["photo", "diffuse", "gloss", "maskA", "maskB", "slab"].forEach((n, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.tex[n]);
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

export const slabImageCache = cachedImage;
