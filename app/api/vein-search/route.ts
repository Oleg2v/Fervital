import { NextResponse } from "next/server";
import sharp from "sharp";
import slabsJson from "@/data/slabs.json";
import vectorsJson from "@/data/slab-vectors.json";
import { computeFeatures, toVector } from "@/lib/vision/descriptor";
import { parseLocal, rankImage, rankText, summarize, type ParsedQuery, type SlabVec } from "@/lib/ai/query";
import { hasClaude, parseQueryWithClaude } from "@/lib/ai/claude";
import type { Slab } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLABS = slabsJson as unknown as Slab[];
const VECS = vectorsJson as unknown as Record<string, SlabVec>;
const BUDGET_MS = 2300; // the whole answer must land in < 3 s

type Status = Record<string, "available" | "held" | "sold">;

export async function POST(req: Request) {
  const t0 = performance.now();
  let body: { q?: string; image?: string; status?: Status };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  const status: Status = body.status ?? {};

  // ── image query: embed the photo with the same descriptor as the scans ──
  if (body.image) {
    const b64 = body.image.split(",").pop() ?? "";
    if (b64.length > 6_000_000) return NextResponse.json({ error: "too-large" }, { status: 413 });
    try {
      const buf = Buffer.from(b64, "base64");
      const img = sharp(buf).rotate();
      const meta = await img.metadata();
      const W = meta.width ?? 0;
      const H = meta.height ?? 0;
      // centre crop: inspiration photos usually frame the stone in the middle
      const cw = Math.round(W * 0.72);
      const ch = Math.round(H * 0.72);
      const { data, info } = await img
        .extract({ left: Math.round((W - cw) / 2), top: Math.round((H - ch) / 2), width: cw, height: ch })
        .resize(256)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const f = computeFeatures(data, info.width, info.height, 3);
      const v = toVector(f);
      const results = rankImage(v, [f.L, f.a, f.b], SLABS, VECS, status);
      const understood = describeFeatures(f);
      return NextResponse.json({
        mode: "image",
        engine: "descriptor",
        ms: Math.round(performance.now() - t0),
        scanned: SLABS.length,
        understood,
        results,
      });
    } catch {
      return NextResponse.json({ error: "image-unreadable" }, { status: 422 });
    }
  }

  // ── text query ──
  const q = (body.q ?? "").trim().slice(0, 600);
  if (!q) return NextResponse.json({ error: "empty" }, { status: 400 });
  const local = parseLocal(q);
  let parsed: ParsedQuery = local;
  let engine: "local" | "claude" = "local";
  if (hasClaude()) {
    try {
      const remaining = BUDGET_MS - (performance.now() - t0);
      const viaClaude = await Promise.race([
        parseQueryWithClaude(q, Math.max(400, remaining)),
        new Promise<null>((r) => setTimeout(() => r(null), Math.max(400, remaining))),
      ]);
      if (viaClaude) {
        parsed = viaClaude;
        engine = "claude";
      }
    } catch {
      /* fall back to the local parser — the demo must always answer */
    }
  }
  const results = rankText(parsed, SLABS, VECS, status);
  return NextResponse.json({
    mode: "text",
    engine,
    ms: Math.round(performance.now() - t0),
    scanned: SLABS.length,
    understood: summarize(parsed),
    results,
  });
}

function describeFeatures(f: ReturnType<typeof computeFeatures>) {
  const he: string[] = [];
  const en: string[] = [];
  const add = (h: string, e: string) => {
    he.push(h);
    en.push(e);
  };
  add(`L ${Math.round(f.L)}`, `L ${Math.round(f.L)}`);
  if (f.b > 9) add("חם", "warm");
  else if (f.b < 1) add("קריר", "cool");
  else add("ניטרלי", "neutral");
  if (f.C > 18) add("רווי", "saturated");
  if (f.coherence > 0.4) add("שכבות", "banded");
  else if (f.speckle > 0.6) add("מנומר", "speckled");
  else if (f.veinDensity > 0.04) add(f.veinPolarity > 0 ? "ורידים בהירים" : "ורידים כהים", f.veinPolarity > 0 ? "light veins" : "dark veins");
  else add("אחיד", "even");
  return { he, en };
}
