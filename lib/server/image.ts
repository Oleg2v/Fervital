// Server-side photo input for vein search, for API clients that send a JPEG instead of a vector (the page itself
// embeds the photo in the browser, see lib/vision/photo.ts). Pure JavaScript, no native modules: it runs in the
// Next.js route (Node) and in the Cloudflare Worker.
import { decode } from "jpeg-js";
import type { RgbImage } from "@/lib/vision/resample";

export { cropResize } from "@/lib/vision/resample";

/** Decode a JPEG to packed RGB. Throws on anything that is not a readable JPEG. */
export function decodeJpeg(bytes: Uint8Array): RgbImage {
  // the browser sends ≤ 512 px; the caps keep a hand-made request inside a Worker's 128 MB
  const img = decode(bytes, { useTArray: true, formatAsRGBA: false, maxResolutionInMP: 4, maxMemoryUsageInMB: 48 });
  if (!img.width || !img.height || img.data.length < img.width * img.height * 3) throw new Error("not a decodable JPEG");
  return { data: img.data, width: img.width, height: img.height };
}

/** The base64 payload of a data URL (or the string itself when it has no header). */
export const dataUrlBytes = (s: string): Uint8Array => Buffer.from(s.split(",").pop() ?? "", "base64");
