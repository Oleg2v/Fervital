# Fervital — 4,000 לוחות

A pitch demo for **Fervital (פרביטל)**: a new website plus a two-sided slab-yard portal. It is Hebrew RTL first, with English second.
It is a **concept by Kikkey, not Fervital's official website** (official: fervital1.co.il). All slabs and prices are demo data, and the build is `noindex`.

> The site is the yard. Each slab is unique, so the site shows slabs, not products: you pull them out, read their veins, and hold them for 48 hours.

## What's in the one page

| Area | What it does |
|---|---|
| Preloader | CSS + SVG and under 1 s. A vein draws itself across black and becomes the wordmark (glyph outlines are pre-extracted, so no font wait). |
| The upright catalogue (R3F) | A dark rack of 40 hanging partitions. Scroll or drag pulls the front slab out on its rail: a heavy spring with a 600 ms settle and a pendulum sway. The pulled slab gets a 4K tier of an 8K scan with a normal map and a clear-coat polish under a raking light. Releasing it slides it back and pulls the next. |
| Slab panel | Name, origin, finish, dimensions (mm), thickness, slab ID, block/sequence, rack position, "במלאי בעמק חפר", and a demo price. Buttons: **Bookmatch** (hinged twin, mirrored veins), **הגדלה עד הוריד** (tiled deep zoom up to 8192 px with a cursor-following pan and a mm/px scale bar), **המטבח שלי באבן**, **שריינו לי ל-48 שעות**. |
| חיפוש לפי וריד · beta | Text or photo. Every slab scan is embedded into a 12-D "mineral vector": CIELAB base colour, vein density/contrast/polarity/colour, grain energy and banding coherence. Queries are embedded into the same space and ranked, with a one-line reason per result. It answers in ms locally, and the budget stays under 3 s with a model. |
| המטבח שלי באבן · beta · הדמיה | Sample kitchen and bathroom (rendered in Blender Cycles; no stock photos) or your own photo. Each surface gets a homography; the slab is mapped with bookmatched tiling and relit from the diffuse and gloss passes. Includes a before/after slider, three slabs side by side, and attach-to-project. Uploads are segmented by a vision model when a key is set; otherwise you place 4 corners by hand. |
| מחשבון ניצולת | Splits long pieces with seams, nests the cuts on the real slab (MaxRects, kerf and edge trim), and reports yield, waste, slabs needed, seam positions and an itemised demo price. Plan view and nesting are drawn on the actual scan. |
| הפרויקט שלי | 3 personas (private client, architect, contractor) and 6 projects. Includes 48 h holds with live countdowns, a project board by room, attached renders and layouts, **PDF quote** (`/api/quote`, Hebrew via pdf-lib + bidi) and order status. |
| המחסן (yard) | Holds arrive live with slab ID and rack position. Confirm / extend / release / convert to sale (marks the slab exclusively for that client). Production board חיתוך → ליטוש → מוכן → סופק with delivery slots, a colour-coded 120-slab rack wall, quotes, an event log, and a demo clock (×1 / ×60 / ×3600) to show expiries. |
| Two-sided live mode | Header switch לקוח / מחסן and **מצב חי**: the client at inline-start and the yard at inline-end, split by a stone hairline with a live dot. Client actions fly into the yard; yard actions flash amber on the client side for 1.2 s. One Zustand store (persisted), synced across tabs with BroadcastChannel; "איפוס דמו" resets it. |
| הפעל הדגמה | A ~30 s autopilot with two demo cursors that drives the real UI: pull → bookmatch → kitchen render → 48 h hold → lands on the yard desk → confirmed → converted to sale → "הלוח שלך". Pause / skip / stop; it respects reduced motion and is repeatable (it soft-resets its own slab). |
| Fallbacks | Mobile / low-power devices get a 6 s rendered video of the rack (`public/video/`). `prefers-reduced-motion` gets a static slab wall with full text descriptions. |
| Accessibility | WCAG 2.0 AA / IS 5568: skip link, a keyboard-operable rack (←/→, Enter, Esc, B, Z), text descriptions for every slab, aria-live announcements, ≥ 4.5:1 text contrast, reduced motion, and an accessibility statement at `/accessibility`. |

## Run

```bash
npm install
npm run dev        # http://localhost:3000
```

Useful query flags: `?rack=webgl|video|static` forces a hero tier, `?q=medium` uses a lighter 3D quality, `?lang=en` opens in English, and `?autopilot=1` starts the ~30 s demo by itself (handy for recording the email video).

### Optional: Claude for the AI features

Without a key, everything works on the built-in pipeline: the descriptor embeddings, a Hebrew/English query parser, the pre-segmented sample rooms, and a manual 4-corner mode for uploads. With a key:

```bash
ANTHROPIC_API_KEY=...          # enables free-text understanding + photo segmentation
FERVITAL_TEXT_MODEL=...        # optional override (default claude-opus-5-5, low effort, raced against the local parser inside the 3 s budget)
FERVITAL_VISION_MODEL=...      # optional override (default claude-opus-5-5)
```

Requests use structured outputs and opt into server-side refusal fallbacks (`fallbacks: "default"`).

## Deploy

### Cloudflare (live: fervital.kikkey.com)

The demo runs as the Worker `fervital` (account of kikkey.com), like the other Kikkey demos: the page is a static export served from Workers static assets, and a small Worker (`worker/index.ts`) answers `/api/*` with the same `lib/server` modules the Next.js routes use. It also serves `/video/*` with byte ranges, which iOS Safari needs to play MP4.

```bash
export CLOUDFLARE_API_TOKEN=...   # needs Workers Scripts: Edit (and Workers Routes for the custom domain)
npm run cf:deploy                 # = npm run cf:build (static export into out/) + wrangler deploy
```

- `npm run cf:build` builds the export in a temporary copy without `app/api`, then writes `out/_headers` (noindex everywhere, immutable `/_next/static`).
- `npm run cf:dev` runs it locally on the Workers runtime (http://localhost:8787) after a `cf:build`.
- Optional Claude features: `npx wrangler secret put ANTHROPIC_API_KEY` (and `FERVITAL_TEXT_MODEL` / `FERVITAL_VISION_MODEL` as vars).
- The Worker needs the Workers Paid plan's CPU allowance for the PDF and photo search (the Free plan's 10 ms is not enough).

### Vercel / any Node host

1. Import the repo into Vercel (framework: Next.js; no build settings needed), or `npm run build && npm start`.
2. Optionally add `ANTHROPIC_API_KEY` in Project → Settings → Environment Variables.
3. Keep the URL unlisted. The build already sends `X-Robots-Tag: noindex`, `robots.txt` disallows everything, and the HTML carries `noindex, nofollow`.

## Assets & data

- Stone scans are from [ambientCG](https://ambientcg.com), CC0 1.0. Each texture records its source asset in `data/textures.json`. Some are lightly graded to read as their family (for example, bolder Calacatta veining, and a basalt graded from a granite scan); see `scripts/catalog.mjs`.
- `scripts/build-textures.mjs <ambientcg-dir>` produces the WebP tiers (512 / 1K / 2K / 4K), normal maps and the deep-zoom tile pyramids (8K for the four signature stones).
- `node --experimental-strip-types scripts/build-data.mjs` produces 120 slabs (`data/slabs.json`), per-slab crops, descriptor vectors, 3 customers, 6 projects, and the seed holds and sales.
- `scripts/scenes/` contains the Blender script for the sample kitchen and bathroom (beauty, diffuse/gloss passes, masks, quads).
- Fonts: Frank Ruhl Libre, Heebo, Cormorant Garamond and IBM Plex Mono (OFL).
- No Antolini imagery is used anywhere.

## Stack

Next.js 15 · TypeScript · Tailwind v4 · React Three Fiber + drei · GSAP + Lenis · Framer Motion · Zustand · pdf-lib · jpeg-js · Cloudflare Workers (sharp for the asset build scripts).

## Held for follow-up (not built)

- **Digitising kit**: photograph the real rack with a phone, auto-crop and colour-correct each slab, and assign IDs and rack positions. The data model (`Slab.crop`, `rack`, per-slab descriptor vectors) is already shaped to receive it: every new photo would run through the same descriptor as `scripts/build-data.mjs` and become searchable by vein immediately.
