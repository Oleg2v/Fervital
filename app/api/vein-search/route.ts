import { jsonResponse, readBody } from "@/lib/server/http";
import { veinSearch, type VeinSearchBody } from "@/lib/server/vein-search";

// The logic lives in lib/server/vein-search.ts and is shared with the Cloudflare Worker (worker/index.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const r = await readBody<VeinSearchBody>(req);
  return jsonResponse(r.ok ? await veinSearch(r.body) : r.result);
}
