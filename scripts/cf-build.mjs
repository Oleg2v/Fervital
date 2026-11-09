// Cloudflare build: a static export of the page into out/ (served by Workers static assets, see wrangler.jsonc),
// plus the _headers file those assets are served with. /api/* is worker/index.ts.
// Usage: npm run cf:build   (then: npx wrangler deploy, or npm run cf:deploy for both)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "out");

// Route handlers (app/api) can't be part of a static export, so the export is built in a temporary copy
// without them. That also leaves the .next directory of a running `next dev` alone.
const SKIP = new Set(["node_modules", ".next", ".git", "out", ".wrangler", ".vercel"]);
const work = fs.mkdtempSync(path.join(os.tmpdir(), "fervital-export-"));
let status = 0;
try {
  for (const e of fs.readdirSync(root)) if (!SKIP.has(e)) fs.cpSync(path.join(root, e), path.join(work, e), { recursive: true });
  fs.rmSync(path.join(work, "app", "api"), { recursive: true, force: true });
  fs.symlinkSync(path.join(root, "node_modules"), path.join(work, "node_modules"), "dir");
  const r = spawnSync("npx", ["next", "build"], { cwd: work, stdio: "inherit", env: { ...process.env, FERVITAL_EXPORT: "1" } });
  status = r.status ?? 1;
  if (status === 0) {
    fs.rmSync(out, { recursive: true, force: true });
    fs.cpSync(path.join(work, "out"), out, { recursive: true });
  }
} finally {
  // also when the build fails: the copy is ~95 MB
  fs.rmSync(work, { recursive: true, force: true });
}
if (status !== 0) process.exit(status);

// Demo hygiene: never index this concept build. Hashed bundles are immutable; the stone scans, scenes and
// video are stable for a day (they are not content-hashed, so not "immutable").
fs.writeFileSync(
  path.join(out, "_headers"),
  `/*
  X-Robots-Tag: noindex, nofollow, noarchive, nosnippet
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
/_next/static/*
  Cache-Control: public, max-age=31536000, immutable
/tex/*
  Cache-Control: public, max-age=86400
/scenes/*
  Cache-Control: public, max-age=86400
/video/*
  Cache-Control: public, max-age=86400
/fonts/*
  Cache-Control: public, max-age=86400
`,
);

// what the Worker and the page rely on
const need = [
  "index.html",
  "accessibility.html",
  "404.html",
  "robots.txt",
  "icon.svg",
  "video/rack-pull-landscape.mp4",
  "scenes/kitchen.jpg",
  // the PDF quote, built in the browser
  "fonts/Heebo-Regular.ttf",
  "fonts/Heebo-Medium.ttf",
  "fonts/FrankRuhlLibre-Light.ttf",
  "fonts/IBMPlexMono-Regular.ttf",
  "tex/_s/FV-CAL-2170-01-160.jpg",
];
const missing = need.filter((f) => !fs.existsSync(path.join(out, f)));
if (missing.length) {
  console.error("cf-build: missing from out/:", missing.join(", "));
  process.exit(1);
}
let files = 0;
let bytes = 0;
let largest = 0;
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else {
      const s = fs.statSync(p).size;
      files++;
      bytes += s;
      largest = Math.max(largest, s);
    }
  }
};
walk(out);
// Workers static assets: at most 25 MiB per file
if (largest > 25 * 1024 * 1024) {
  console.error(`cf-build: a file in out/ is larger than 25 MiB (${(largest / 1048576).toFixed(1)} MiB)`);
  process.exit(1);
}
console.log(`cf-build: out/ ready — ${files} files, ${(bytes / 1048576).toFixed(1)} MiB, largest ${(largest / 1048576).toFixed(1)} MiB`);
