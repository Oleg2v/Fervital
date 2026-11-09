// Cloudflare Worker for the static export (wrangler.jsonc): the page and every asset are served by Workers
// static assets; only /api/* and /video/* reach this code (assets.run_worker_first). The API logic is the same
// lib/server modules the Next.js routes use. Everything here stays within a few ms of CPU per request: the heavy
// work (the PDF quote, embedding a photo for vein search) runs in the visitor's browser.
import { NOINDEX, jsonResponse, readBody, type ApiResult } from "../lib/server/http";
import { veinSearch, warmUp, type VeinSearchBody } from "../lib/server/vein-search";
import { kitchen, type KitchenBody } from "../lib/server/kitchen";

export interface Env {
  ASSETS: Fetcher;
  /** optional: with a key, text search and uploaded kitchen photos go through Claude (wrangler secret put ANTHROPIC_API_KEY) */
  ANTHROPIC_API_KEY?: string;
  FERVITAL_TEXT_MODEL?: string;
  FERVITAL_VISION_MODEL?: string;
}

// The global scope runs when an isolate starts, outside any request's CPU budget: compile the search path there.
warmUp();

const API_HEADERS = { "x-robots-tag": NOINDEX };
const send = (r: ApiResult, extra?: Record<string, string>) => jsonResponse(r, { ...API_HEADERS, ...extra });

async function api(req: Request, url: URL): Promise<Response> {
  const route = url.pathname.replace(/\/+$/, "");
  if (route !== "/api/vein-search" && route !== "/api/kitchen") return send({ status: 404, body: { error: "not-found" } });
  if (req.method !== "POST") return send({ status: 405, body: { error: "method-not-allowed" } }, { allow: "POST" });
  if (route === "/api/vein-search") {
    const read = await readBody<VeinSearchBody>(req);
    return send(read.ok ? await veinSearch(read.body) : read.result);
  }
  const read = await readBody<KitchenBody>(req);
  return send(read.ok ? await kitchen(read.body) : read.result);
}

/**
 * Workers static assets answer a Range request with the whole file, and iOS Safari only plays MP4 from
 * 206 responses: /video/* comes through here and gets single byte ranges (RFC 9110 §14).
 */
async function ranged(req: Request, env: Env): Promise<Response> {
  const res = await env.ASSETS.fetch(req);
  const range = req.headers.get("range");
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  // If-Range: a range is only for the same file the client already has part of (strong ETag or date match)
  const ifRange = req.headers.get("if-range");
  const sameFile = !ifRange || ifRange === res.headers.get("etag") || ifRange === res.headers.get("last-modified");
  // an inverted range ("bytes=5-2") is invalid, and an invalid Range header is ignored
  const inverted = !!m && m[1] !== "" && m[2] !== "" && Number(m[1]) > Number(m[2]);
  if (res.status !== 200 || req.method !== "GET" || !m || (m[1] === "" && m[2] === "") || !sameFile || inverted) {
    const whole = new Response(res.body, res);
    if (res.status === 200) whole.headers.set("accept-ranges", "bytes");
    // a missing video must not be remembered for a day (the _headers rule for /video/* applies to every status)
    if (res.status >= 400) whole.headers.set("cache-control", "no-store");
    return whole;
  }
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  let start: number;
  let end: number;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2])); // "bytes=-500": the last 500
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  const headers = new Headers(res.headers);
  headers.set("accept-ranges", "bytes");
  if (!(start <= end && start < size)) {
    headers.set("content-range", `bytes */${size}`);
    headers.set("cache-control", "no-store");
    headers.delete("content-length");
    return new Response(null, { status: 416, headers });
  }
  headers.set("content-range", `bytes ${start}-${end}/${size}`);
  headers.set("content-length", String(end - start + 1));
  headers.delete("content-encoding"); // the slice is of the decoded bytes
  return new Response(buf.slice(start, end + 1), { status: 206, headers });
}

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/video/")) return ranged(req, env);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      return await api(req, url);
    } catch (e) {
      console.error("api error", url.pathname, e instanceof Error ? e.stack : e);
      return send({ status: 500, body: { error: "internal" } });
    }
  },
} satisfies ExportedHandler<Env>;
