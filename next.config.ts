import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Demo hygiene: never index this concept build.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" }],
      },
      {
        source: "/slabs/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
  serverExternalPackages: ["sharp"],
  outputFileTracingIncludes: {
    // serverless functions can't read public/ from disk on Vercel: trace what the PDF embeds
    "/api/quote": ["./assets/fonts/**", "./public/tex/_s/*-400.webp"],
    "/api/kitchen": ["./data/scenes.json"],
  },
};

export default nextConfig;
