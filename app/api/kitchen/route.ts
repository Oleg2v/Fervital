import { jsonResponse, readBody } from "@/lib/server/http";
import { kitchen, type KitchenBody } from "@/lib/server/kitchen";

// The logic lives in lib/server/kitchen.ts and is shared with the Cloudflare Worker (worker/index.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const r = await readBody<KitchenBody>(req);
  return jsonResponse(r.ok ? await kitchen(r.body) : r.result);
}
