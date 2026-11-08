import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { claudeModels, hasClaude, segmentWithClaude, type SurfaceType } from "@/lib/ai/claude";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LABELS: Record<SurfaceType, { he: string; en: string }> = {
  countertop: { he: "משטח עבודה", en: "Worktop" },
  island: { he: "אי", en: "Island" },
  island_side: { he: "מפל האי", en: "Island waterfall" },
  backsplash: { he: "חיפוי קיר", en: "Backsplash" },
  floor: { he: "רצפה", en: "Floor" },
  wall: { he: "קיר", en: "Wall" },
  vanity: { he: "משטח רחצה", en: "Vanity top" },
};
const KIND: Record<SurfaceType, number> = { countertop: 0, island: 0, vanity: 0, floor: 2, wall: 1, backsplash: 1, island_side: 3 };

let scenesCache: Record<string, unknown> | null = null;
async function scenes() {
  if (scenesCache && process.env.NODE_ENV === "production") return scenesCache;
  scenesCache = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "scenes.json"), "utf8"));
  return scenesCache!;
}

export async function POST(req: Request) {
  const t0 = performance.now();
  let body: { scene?: string; image?: string; width?: number; height?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }

  // Sample rooms: segmentation was computed offline from the 3D scene (exact masks + quads).
  if (body.scene) {
    try {
      const all = (await scenes()) as Record<string, { surfaces: { id: SurfaceType }[] } & Record<string, unknown>>;
      const sc = all[body.scene];
      if (!sc) return NextResponse.json({ error: "unknown-scene" }, { status: 404 });
      return NextResponse.json({
        source: "sample",
        ms: Math.round(performance.now() - t0),
        scene: { ...sc, key: body.scene },
        surfaces: sc.surfaces.map((s) => ({ ...s, kind: KIND[s.id] ?? 0 })),
      });
    } catch {
      return NextResponse.json({ error: "scenes-missing" }, { status: 503 });
    }
  }

  // Uploaded photo: vision model segments the surfaces.
  if (body.image) {
    const W = body.width ?? 1280;
    const H = body.height ?? 800;
    if (!hasClaude()) return NextResponse.json({ source: "manual", reason: "no-model", ms: 0 });
    const b64 = body.image.split(",").pop() ?? "";
    if (b64.length > 7_000_000) return NextResponse.json({ error: "too-large" }, { status: 413 });
    try {
      const seg = await segmentWithClaude(b64, 14_000);
      if (!seg || !seg.surfaces?.length) return NextResponse.json({ source: "manual", reason: "nothing-found", ms: Math.round(performance.now() - t0) });
      const toPx = (p: { x: number; y: number }) => [(p.x / 1000) * W, (p.y / 1000) * H] as [number, number];
      const surfaces = seg.surfaces
        .filter((s) => s.quad?.length === 4 && s.polygon?.length >= 3)
        .slice(0, 8)
        .map((s, i) => ({
          id: `${s.type}-${i}`,
          type: s.type,
          kind: KIND[s.type] ?? 0,
          label: LABELS[s.type] ?? LABELS.countertop,
          quad: s.quad.map(toPx),
          polygon: s.polygon.map(toPx),
          sizeMm: [Math.max(300, s.length_mm || 2400), Math.max(200, s.width_mm || 620)],
          confidence: s.confidence,
        }));
      return NextResponse.json({
        source: "model",
        model: claudeModels.vision,
        scene: { kind: seg.scene },
        ms: Math.round(performance.now() - t0),
        surfaces,
      });
    } catch {
      return NextResponse.json({ source: "manual", reason: "model-error", ms: Math.round(performance.now() - t0) });
    }
  }
  return NextResponse.json({ error: "empty" }, { status: 400 });
}
