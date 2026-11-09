// Cut-list nesting for worktops: split long pieces with seams, then MaxRects-pack onto slabs.

export interface YieldInput {
  worktopL: number;
  worktopD: number;
  returnL: number; // L-shape return (0 = none)
  islandL: number; // 0 = none
  islandW: number;
  waterfalls: 0 | 1 | 2;
  splashH: number; // 0 = none
  slabL: number;
  slabH: number;
  thickness: number;
  veinMatch: boolean;
  priceM2: number;
}

export type PieceKind = "worktop" | "ret" | "island" | "fall" | "splash";
export interface Piece {
  id: string;
  kind: PieceKind;
  L: number;
  D: number;
}
export interface Segment {
  pieceId: string;
  kind: PieceKind;
  seg: number;
  segs: number;
  w: number;
  h: number;
}
export interface Placed extends Segment {
  x: number;
  y: number;
  rotated: boolean;
}
export interface Seam {
  pieceId: string;
  kind: PieceKind;
  atMm: number;
  along?: boolean; // lengthwise seam: the piece is deeper than the slab and split across its depth
}
export interface YieldResult {
  pieces: Piece[];
  slabs: Placed[][];
  seams: Seam[];
  slabCount: number;
  slabAreaM2: number;
  usedM2: number;
  wasteM2: number;
  yieldPct: number;
  price: { stone: number; fab: number; cutouts: number; waterfalls: number; install: number; vat: number; total: number };
  usable: { L: number; H: number };
}

const TRIM = 15; // mm trimmed off each raw slab edge
const KERF = 4; // saw blade

export function buildPieces(i: YieldInput): Piece[] {
  const p: Piece[] = [];
  if (i.worktopL > 0) p.push({ id: "worktop", kind: "worktop", L: i.worktopL, D: i.worktopD });
  if (i.returnL > i.worktopD) p.push({ id: "ret", kind: "ret", L: i.returnL - i.worktopD, D: i.worktopD });
  if (i.islandL > 0 && i.islandW > 0) {
    p.push({ id: "island", kind: "island", L: i.islandL, D: i.islandW });
    const fallH = 900 - i.thickness;
    for (let k = 0; k < i.waterfalls; k++) p.push({ id: `fall${k + 1}`, kind: "fall", L: i.islandW, D: fallH });
  }
  if (i.splashH > 0) {
    if (i.worktopL > 0) p.push({ id: "splash1", kind: "splash", L: i.worktopL, D: i.splashH });
    if (i.returnL > i.worktopD) p.push({ id: "splash2", kind: "splash", L: i.returnL - i.worktopD, D: i.splashH });
  }
  return p;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

class MaxRects {
  free: Rect[];
  constructor(W: number, H: number) {
    this.free = [{ x: 0, y: 0, w: W, h: H }];
  }
  find(w: number, h: number, rotate: boolean): { r: Rect; rot: boolean } | null {
    let best: { r: Rect; rot: boolean; s1: number; s2: number } | null = null;
    for (const f of this.free) {
      const tryFit = (ww: number, hh: number, rot: boolean) => {
        if (ww <= f.w && hh <= f.h) {
          const s1 = Math.min(f.w - ww, f.h - hh);
          const s2 = Math.max(f.w - ww, f.h - hh);
          // prefer top-left (keeps the offcut in one piece) on ties
          if (!best || s1 < best.s1 || (s1 === best.s1 && (s2 < best.s2 || (s2 === best.s2 && f.y + f.x < best.r.y + best.r.x)))) {
            best = { r: { x: f.x, y: f.y, w: ww, h: hh }, rot, s1, s2 };
          }
        }
      };
      tryFit(w, h, false);
      if (rotate) tryFit(h, w, true);
    }
    return best ? { r: (best as { r: Rect }).r, rot: (best as { rot: boolean }).rot } : null;
  }
  place(p: Rect) {
    const next: Rect[] = [];
    for (const f of this.free) {
      if (p.x >= f.x + f.w || p.x + p.w <= f.x || p.y >= f.y + f.h || p.y + p.h <= f.y) {
        next.push(f);
        continue;
      }
      if (p.x > f.x) next.push({ x: f.x, y: f.y, w: p.x - f.x, h: f.h });
      if (p.x + p.w < f.x + f.w) next.push({ x: p.x + p.w, y: f.y, w: f.x + f.w - (p.x + p.w), h: f.h });
      if (p.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: p.y - f.y });
      if (p.y + p.h < f.y + f.h) next.push({ x: f.x, y: p.y + p.h, w: f.w, h: f.y + f.h - (p.y + p.h) });
    }
    this.free = next.filter(
      (a, i) =>
        a.w > 0 &&
        a.h > 0 &&
        !next.some((b, j) => j !== i && b.x <= a.x && b.y <= a.y && b.x + b.w >= a.x + a.w && b.y + b.h >= a.y + a.h && (j < i || !(a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h))),
    );
  }
}

export function computeYield(i: YieldInput): YieldResult {
  const usable = { L: i.slabL - 2 * TRIM, H: i.slabH - 2 * TRIM };
  const pieces = buildPieces(i);
  const segments: Segment[] = [];
  const seams: Seam[] = [];
  for (const p of pieces) {
    const L = p.L;
    // a piece deeper than the slab goes in rotated when that is allowed; otherwise it is split
    // across its depth into full-height rows plus a remainder strip (a lengthwise seam)
    const rotates = p.D > usable.H && !i.veinMatch && p.D <= usable.L;
    const maxLen = rotates ? usable.H : usable.L;
    const maxDepth = rotates ? p.D : usable.H;
    const rows = Math.max(1, Math.ceil(p.D / maxDepth));
    const n = Math.max(1, Math.ceil(L / maxLen));
    const segLen = Math.min(maxLen, Math.ceil(L / n / 5) * 5);
    for (let r = 0; r < rows; r++) {
      const h = r < rows - 1 ? maxDepth : p.D - maxDepth * (rows - 1);
      for (let k = 0; k < n; k++) {
        const w = k === n - 1 ? L - segLen * (n - 1) : segLen;
        segments.push({ pieceId: p.id, kind: p.kind, seg: r * n + k + 1, segs: rows * n, w, h });
        if (r === 0 && k > 0) seams.push({ pieceId: p.id, kind: p.kind, atMm: segLen * k });
      }
      if (r > 0) seams.push({ pieceId: p.id, kind: p.kind, atMm: maxDepth * r, along: true });
    }
    if (p.kind === "ret") seams.push({ pieceId: p.id, kind: p.kind, atMm: 0 }); // corner butt joint
  }
  // biggest first
  const order = [...segments].sort((a, b) => b.w * b.h - a.w * a.h || b.h - a.h);
  const bins: { mr: MaxRects; placed: Placed[] }[] = [];
  for (const s of order) {
    let done = false;
    for (const bin of bins) {
      const f = bin.mr.find(s.w + KERF, s.h + KERF, !i.veinMatch);
      if (f) {
        bin.mr.place(f.r);
        bin.placed.push({ ...s, x: f.r.x, y: f.r.y, rotated: f.rot });
        done = true;
        break;
      }
    }
    if (!done) {
      const mr = new MaxRects(usable.L + KERF, usable.H + KERF);
      const f = mr.find(s.w + KERF, s.h + KERF, !i.veinMatch);
      if (!f) {
        // should not happen after splitting; clamp, and take the space so nothing is nested on top of it
        const w = Math.min(s.w, usable.L);
        const h = Math.min(s.h, usable.H);
        mr.place({ x: 0, y: 0, w: w + KERF, h: h + KERF });
        bins.push({ mr, placed: [{ ...s, x: 0, y: 0, rotated: false, w, h }] });
        continue;
      }
      mr.place(f.r);
      bins.push({ mr, placed: [{ ...s, x: f.r.x, y: f.r.y, rotated: f.rot }] });
    }
  }
  const slabCount = bins.length;
  const slabAreaM2 = (slabCount * i.slabL * i.slabH) / 1e6;
  const usedM2 = segments.reduce((a, s) => a + s.w * s.h, 0) / 1e6;
  const wasteM2 = Math.max(0, slabAreaM2 - usedM2);
  const yieldPct = slabAreaM2 ? (usedM2 / slabAreaM2) * 100 : 0;

  // demo pricing (ILS): island edges and waterfalls only for the pieces buildPieces actually cut
  const hasIsland = pieces.some((p) => p.kind === "island");
  const falls = pieces.filter((p) => p.kind === "fall").length;
  const stone = slabAreaM2 * i.priceM2;
  const edgeM =
    (i.worktopL + Math.max(0, i.returnL - i.worktopD) + (hasIsland ? 2 * (i.islandL + i.islandW) : 0)) / 1000;
  const fab = edgeM * 240 + segments.length * 180 + seams.length * 260;
  const cutouts = (i.worktopL > 0 ? 2 : 0) * 550;
  const waterfalls = falls * 1450;
  const install = pieces.length ? 1900 + usedM2 * 190 : 0;
  const net = stone + fab + cutouts + waterfalls + install;
  const vat = net * 0.18;
  return {
    pieces,
    slabs: bins.map((b) => b.placed),
    seams,
    slabCount,
    slabAreaM2,
    usedM2,
    wasteM2,
    yieldPct,
    price: { stone, fab, cutouts, waterfalls, install, vat, total: net + vat },
    usable,
  };
}
