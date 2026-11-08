// Server-only helpers around the Claude API (optional: the demo runs without a key).
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { QUERY_SCHEMA, type ParsedQuery } from "./query";

// Model ids are overridable from the environment; default per Anthropic's current guidance.
const TEXT_MODEL = process.env.FERVITAL_TEXT_MODEL || "claude-opus-5-5";
const VISION_MODEL = process.env.FERVITAL_VISION_MODEL || "claude-opus-5-5";

export const hasClaude = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
export const claudeModels = { text: TEXT_MODEL, vision: VISION_MODEL };

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ maxRetries: 0 }));

function firstText(content: Anthropic.Beta.BetaContentBlock[]): string | null {
  for (const b of content) if (b.type === "text") return b.text;
  return null;
}

const QUERY_SYSTEM = `You translate a client's free-text description of a natural stone (Hebrew or English) into search attributes for a slab yard.
Map colours of the stone's ground to base_hue, colours said about the veins to vein_color. "Not glossy"/"לא מבריק"/"מט" → finish "matte".
"Warm" means yellowish/creamy white, "cool" means bluish/grey white. Translucent or backlit → translucent "yes".
Only set families when the text names a stone (Calacatta, Carrara, Statuario, Nero Marquina, Verde Alpi, travertine, onyx, granite, basalt) or clearly implies it (backlit honey wall → onyx).
Use "any" when the text says nothing about an attribute; max_price_m2 is 0 unless a price ceiling per m² is given.
summary_he / summary_en: at most 8 words restating what you understood.`;

/** Free text → ParsedQuery via structured outputs. Returns null on refusal or timeout. */
export async function parseQueryWithClaude(text: string, timeoutMs: number): Promise<ParsedQuery | null> {
  const res = await getClient().beta.messages.create(
    {
      model: TEXT_MODEL,
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: QUERY_SCHEMA as unknown as Record<string, unknown> },
      },
      system: QUERY_SYSTEM,
      messages: [{ role: "user", content: text.slice(0, 600) }],
    },
    { timeout: timeoutMs },
  );
  if (res.stop_reason === "refusal") return null;
  const t = firstText(res.content);
  if (!t) return null;
  return JSON.parse(t) as ParsedQuery;
}

// ── kitchen / bathroom segmentation ───────────────────────────
export type SurfaceType = "countertop" | "island" | "island_side" | "backsplash" | "floor" | "wall" | "vanity";
export interface SegSurface {
  type: SurfaceType;
  polygon: { x: number; y: number }[]; // 0..1000, origin top-left
  quad: { x: number; y: number }[]; // 4 corners of the real rectangle (may extend past the frame)
  length_mm: number;
  width_mm: number;
  confidence: number;
}
export interface Segmentation {
  scene: "kitchen" | "bathroom" | "other";
  surfaces: SegSurface[];
}

const POINT = {
  type: "object",
  additionalProperties: false,
  properties: { x: { type: "number" }, y: { type: "number" } },
  required: ["x", "y"],
};
const SEG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    scene: { type: "string", enum: ["kitchen", "bathroom", "other"] },
    surfaces: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ["countertop", "island", "island_side", "backsplash", "floor", "wall", "vanity"] },
          polygon: { type: "array", items: POINT },
          quad: { type: "array", items: POINT },
          length_mm: { type: "number" },
          width_mm: { type: "number" },
          confidence: { type: "number" },
        },
        required: ["type", "polygon", "quad", "length_mm", "width_mm", "confidence"],
      },
    },
  },
  required: ["scene", "surfaces"],
};

const SEG_SYSTEM = `You are the segmentation stage of a stone-visualisation tool. Given an interior photo, find the surfaces a natural-stone slab could replace: countertop (main worktop top face), island (island top face), island_side (a waterfall/side face of the island), backsplash (wall right behind a worktop), vanity (bathroom vanity top), wall (a large wall that could be clad), floor.
Coordinates are normalised to 0–1000 on both axes, origin at the top-left of the image.
For each visible surface return:
- polygon: 4–14 points tracing the VISIBLE outline of that surface, excluding objects that sit on it (sinks, taps, bowls) as far as practical.
- quad: exactly 4 points, the corners of the surface's real-world rectangle in perspective, which may lie outside the image. Order for horizontal surfaces (tops, floor): back-left, back-right, front-right, front-left as seen from the camera. Order for vertical surfaces: top-left, top-right, bottom-right, bottom-left.
- length_mm / width_mm: your estimate of that rectangle's real size (worktops are ~600–650 mm deep, island tops ~900–1200 mm).
- confidence 0–1.
Return only surfaces you can actually see; at most one floor and two walls.`;

export async function segmentWithClaude(
  base64Jpeg: string,
  timeoutMs: number,
): Promise<Segmentation | null> {
  const res = await getClient().beta.messages.create(
    {
      model: VISION_MODEL,
      max_tokens: 6000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: SEG_SCHEMA as unknown as Record<string, unknown> },
      },
      system: SEG_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64Jpeg } },
            { type: "text", text: "Segment the replaceable stone surfaces in this photo." },
          ],
        },
      ],
    },
    { timeout: timeoutMs },
  );
  if (res.stop_reason === "refusal") return null;
  const t = firstText(res.content);
  if (!t) return null;
  return JSON.parse(t) as Segmentation;
}
