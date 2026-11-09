// "My kitchen in stone": sample rooms come pre-segmented from the 3D scene; an uploaded photo goes to the
// vision model when a key is configured, otherwise to the four-corner manual mode.
// Runtime-neutral: used by app/api/kitchen/route.ts and by the Cloudflare Worker.
import scenesJson from "@/data/scenes.json";
import { claudeModels, hasClaude, segmentWithClaude, type SurfaceType } from "@/lib/ai/claude";
import type { ApiResult } from "./http";

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

type SampleScene = { surfaces: { id: SurfaceType }[] } & Record<string, unknown>;
const SCENES = scenesJson as unknown as Record<string, SampleScene>;

export interface KitchenBody {
  scene?: string;
  image?: string;
  width?: number;
  height?: number;
}

export async function kitchen(body: KitchenBody | null): Promise<ApiResult> {
  const t0 = performance.now();
  if (!body) return { status: 400, body: { error: "bad-json" } };

  // Sample rooms: segmentation was computed offline from the 3D scene (exact masks + quads).
  if (body.scene) {
    const sc = Object.hasOwn(SCENES, body.scene) ? SCENES[body.scene] : undefined;
    if (!sc) return { status: 404, body: { error: "unknown-scene" } };
    return {
      status: 200,
      body: {
        source: "sample",
        ms: Math.round(performance.now() - t0),
        scene: { ...sc, key: body.scene },
        surfaces: sc.surfaces.map((s) => ({ ...s, kind: KIND[s.id] ?? 0 })),
      },
    };
  }

  // Uploaded photo: vision model segments the surfaces.
  if (body.image) {
    const W = body.width ?? 1280;
    const H = body.height ?? 800;
    if (!hasClaude()) return { status: 200, body: { source: "manual", reason: "no-model", ms: 0 } };
    const b64 = body.image.split(",").pop() ?? "";
    if (b64.length > 7_000_000) return { status: 413, body: { error: "too-large" } };
    try {
      const seg = await segmentWithClaude(b64, 14_000);
      if (!seg || !seg.surfaces?.length) return { status: 200, body: { source: "manual", reason: "nothing-found", ms: Math.round(performance.now() - t0) } };
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
      return {
        status: 200,
        body: { source: "model", model: claudeModels.vision, scene: { kind: seg.scene }, ms: Math.round(performance.now() - t0), surfaces },
      };
    } catch {
      return { status: 200, body: { source: "manual", reason: "model-error", ms: Math.round(performance.now() - t0) } };
    }
  }
  return { status: 400, body: { error: "empty" } };
}
