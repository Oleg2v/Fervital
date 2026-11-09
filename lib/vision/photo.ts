// The photo half of vein search, on the visitor's device: decode the photo, embed it with the same descriptor
// as the 120 scans (same crop, same Lanczos-3, same features), and send the API only the 12-number vector.
// The ranking is then about a millisecond of server time, which fits a Worker's CPU budget.
import { computeFeatures, toVector } from "./descriptor";
import { cropResize } from "./resample";

export interface PhotoQuery {
  /** a small JPEG of the photo, for the "you searched with" thumbnail */
  preview: string;
  vector: number[];
  /** the ground colour, CIELAB */
  lab: [number, number, number];
}

/** Throws when the browser cannot decode the file (e.g. an iPhone HEIC in Chrome). */
export async function photoQuery(file: File, max = 512): Promise<PhotoQuery> {
  if (!file.type.startsWith("image/")) throw new Error("not an image");
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * s));
  c.height = Math.max(1, Math.round(bmp.height * s));
  // CPU-backed: reading pixels back from a GPU canvas can stall for seconds on software GL
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  const rgb = new Uint8Array(c.width * c.height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i];
    rgb[j + 1] = data[i + 1];
    rgb[j + 2] = data[i + 2];
  }
  // centre crop: inspiration photos usually frame the stone in the middle
  const small = cropResize({ data: rgb, width: c.width, height: c.height }, 0.72, 256);
  const f = computeFeatures(small.data, small.width, small.height, 3);
  return { preview: c.toDataURL("image/jpeg", 0.86), vector: toVector(f), lab: [f.L, f.a, f.b] };
}
