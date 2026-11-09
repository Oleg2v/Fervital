// Shared by the Next.js routes and the Cloudflare Worker: the API logic returns plain results,
// and each host turns them into its own Response.

export interface ApiResult {
  status: number;
  body: unknown;
}

export const NOINDEX = "noindex, nofollow, noarchive, nosnippet";

/** Largest request body the API reads (photos arrive as ≤ 1280 px JPEG data URLs, well under this). */
export const MAX_BODY_BYTES = 8_000_000;

export type BodyRead<T> = { ok: true; body: T | null } | { ok: false; result: ApiResult };

/**
 * The JSON body of a request (null when it is missing or malformed), read as a stream so an oversized body is
 * refused with 413 before it is buffered: a Worker has 128 MB, and Cloudflare itself accepts up to 100 MB.
 */
export async function readBody<T>(req: Request, limit = MAX_BODY_BYTES): Promise<BodyRead<T>> {
  const tooLarge: BodyRead<T> = { ok: false, result: { status: 413, body: { error: "too-large" } } };
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) return tooLarge;
  if (!req.body) return { ok: true, body: null };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return tooLarge;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return { ok: true, body: v && typeof v === "object" && !Array.isArray(v) ? (v as T) : null };
  } catch {
    return { ok: true, body: null };
  }
}

export const jsonResponse = (r: ApiResult, extra?: Record<string, string>) =>
  new Response(JSON.stringify(r.body), {
    status: r.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
