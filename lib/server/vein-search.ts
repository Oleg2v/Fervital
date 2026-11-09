// Vein search: free text (local lexicon, optionally Claude) or an inspiration photo (mineral vector).
// The page embeds a photo in the browser (lib/vision/photo.ts) and sends the vector; a JPEG is still accepted
// from other API clients. Runtime-neutral: used by app/api/vein-search/route.ts and by the Cloudflare Worker.
import slabsJson from "@/data/slabs.json";
import vectorsJson from "@/data/slab-vectors.json";
import { computeFeatures, toVector } from "@/lib/vision/descriptor";
import { parseLocal, rankImage, rankText, summarize, type ParsedQuery, type SlabVec } from "@/lib/ai/query";
import { hasClaude, parseQueryWithClaude } from "@/lib/ai/claude";
import type { Slab } from "@/lib/types";
import type { ApiResult } from "./http";
import { cropResize, dataUrlBytes, decodeJpeg } from "./image";

const SLABS = slabsJson as unknown as Slab[];
const VECS = vectorsJson as unknown as Record<string, SlabVec>;
const BUDGET_MS = 2300; // the whole answer must land in < 3 s

type Status = Record<string, "available" | "held" | "sold">;
export interface VeinSearchBody {
  q?: string;
  /** the 12-D mineral vector of a photo (lib/vision/descriptor.ts toVector), with its ground colour in CIELAB */
  vector?: number[];
  lab?: number[];
  /** or the photo itself, as a JPEG data URL */
  image?: string;
  status?: Status;
}

const isVector = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length === 12 && v.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1);
const isLab = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= 200);

export async function veinSearch(body: VeinSearchBody | null): Promise<ApiResult> {
  const t0 = performance.now();
  if (!body) return { status: 400, body: { error: "bad-json" } };
  const status: Status = body.status && typeof body.status === "object" ? body.status : {};
  const imageAnswer = (v: number[], lab: [number, number, number]): ApiResult => ({
    status: 200,
    body: {
      mode: "image",
      engine: "descriptor",
      ms: Math.round(performance.now() - t0),
      scanned: SLABS.length,
      understood: describeVector(v, lab),
      results: rankImage(v, lab, SLABS, VECS, status),
    },
  });

  // ── photo, embedded in the browser: only the ranking happens here ──
  if (body.vector !== undefined) {
    if (!isVector(body.vector) || !isLab(body.lab)) return { status: 400, body: { error: "bad-vector" } };
    return imageAnswer(body.vector, body.lab);
  }

  // ── photo as a JPEG: embed it here with the same descriptor as the scans ──
  if (body.image) {
    if (body.image.length > 6_000_100) return { status: 413, body: { error: "too-large" } };
    try {
      const img = decodeJpeg(dataUrlBytes(body.image));
      // centre crop: inspiration photos usually frame the stone in the middle
      const small = cropResize(img, 0.72, 256);
      const f = computeFeatures(small.data, small.width, small.height, 3);
      return imageAnswer(toVector(f), [f.L, f.a, f.b]);
    } catch {
      return { status: 422, body: { error: "image-unreadable" } };
    }
  }

  // ── text query ──
  const q = (body.q ?? "").trim().slice(0, 600);
  if (!q) return { status: 400, body: { error: "empty" } };
  let parsed: ParsedQuery = parseLocal(q);
  let engine: "local" | "claude" = "local";
  if (hasClaude()) {
    try {
      const remaining = Math.max(400, BUDGET_MS - (performance.now() - t0));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const viaClaude = await Promise.race([
        parseQueryWithClaude(q, remaining),
        new Promise<null>((r) => (timer = setTimeout(() => r(null), remaining))),
      ]);
      clearTimeout(timer);
      if (viaClaude) {
        parsed = viaClaude;
        engine = "claude";
      }
    } catch {
      /* fall back to the local parser — the demo must always answer */
    }
  }
  return {
    status: 200,
    body: {
      mode: "text",
      engine,
      ms: Math.round(performance.now() - t0),
      scanned: SLABS.length,
      understood: summarize(parsed),
      results: rankText(parsed, SLABS, VECS, status),
    },
  };
}

/**
 * What the descriptor read, from the vector and the ground colour (toVector's scaling inverted):
 * v[4] = vein density / 0.2, v[6] = (polarity + 1) / 2, v[9] = (speckle − 0.25) / 0.5, v[10] = coherence.
 */
function describeVector(v: number[], [L, a, b]: [number, number, number]) {
  const he: string[] = [];
  const en: string[] = [];
  const add = (h: string, e: string) => {
    he.push(h);
    en.push(e);
  };
  add(`L ${Math.round(L)}`, `L ${Math.round(L)}`);
  if (b > 9) add("חם", "warm");
  else if (b < 1) add("קריר", "cool");
  else add("ניטרלי", "neutral");
  if (Math.hypot(a, b) > 18) add("רווי", "saturated");
  if (v[10] > 0.4) add("שכבות", "banded");
  else if (v[9] > 0.7) add("מנומר", "speckled");
  else if (v[4] > 0.2) add(v[6] > 0.5 ? "ורידים בהירים" : "ורידים כהים", v[6] > 0.5 ? "light veins" : "dark veins");
  else add("אחיד", "even");
  return { he, en };
}

/** Run the text path once, so a fresh Worker isolate compiles it at startup and not inside a request's CPU budget. */
export function warmUp() {
  rankText(parseLocal("לבן חם עם ורידים אפורים, לא מבריק"), SLABS, VECS, {});
  rankText(parseLocal("dramatic black with white veins"), SLABS, VECS, {});
  const first = VECS[SLABS[0].id];
  if (first) rankImage(first.v, first.lab, SLABS, VECS, {});
}
