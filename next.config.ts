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
    "/api/quote": ["./assets/fonts/**"],
    "/api/kitchen": ["./data/scenes.json"],
  },
};

export default nextConfig;
