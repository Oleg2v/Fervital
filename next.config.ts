import type { NextConfig } from "next";

// Two builds from one tree:
// - `next build` (Vercel / `next start`): the page plus the /api route handlers.
// - `npm run cf:build` sets FERVITAL_EXPORT=1: a static export of the page into out/, served from Cloudflare
//   Workers static assets. /api/* is answered by worker/index.ts with the same lib/server modules.
const EXPORT = process.env.FERVITAL_EXPORT === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(EXPORT
    ? {
        // scripts/cf-build.mjs runs this build in a temporary copy without app/api (route handlers can't be exported)
        output: "export",
      }
    : {
        // Demo hygiene: never index this concept build. (On Cloudflare: out/_headers, written by scripts/cf-build.mjs.)
        async headers() {
          return [
            {
              source: "/:path*",
              headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" }],
            },
          ];
        },
      }),
};

export default nextConfig;
