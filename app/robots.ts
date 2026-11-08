import type { MetadataRoute } from "next";

// Demo hygiene: this concept build must never be indexed.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
