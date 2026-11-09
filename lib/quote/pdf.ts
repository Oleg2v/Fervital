// The demo quote PDF (pdf-lib + fontkit, Hebrew shaped through bidi-js), built in the visitor's browser:
// it takes 50–300 ms of CPU, more than a Cloudflare Worker request is given. Loaded on demand (Portal → import()),
// so none of it is in the page's first load. Fonts and slab thumbnails are static files (public/fonts, public/tex/_s).
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import bidiFactory from "bidi-js";
import slabsJson from "@/data/slabs.json";
import peopleJson from "@/data/people.json";
import type { Customer, ProjectDef, Slab } from "@/lib/types";

const SLABS = Object.fromEntries((slabsJson as unknown as Slab[]).map((s) => [s.id, s]));
const CUSTOMERS = Object.fromEntries((peopleJson.customers as Customer[]).map((c) => [c.id, c]));
const PROJECTS = Object.fromEntries((peopleJson.projects as ProjectDef[]).map((p) => [p.id, p]));

const BASALT = rgb(14 / 255, 14 / 255, 14 / 255);
const CARRARA = rgb(243 / 255, 241 / 255, 236 / 255);
const VEIN = rgb(142 / 255, 139 / 255, 133 / 255);
const AMBER = rgb(217 / 255, 164 / 255, 65 / 255);
const VERDE = rgb(46 / 255, 74 / 255, 61 / 255);

const bidi = bidiFactory();
// fontkit lays out any run containing Hebrew right-to-left and reverses the whole run,
// so we hand it the bidi *visual* order pre-reversed: its reversal restores the visual order.
const HEB = /[\u0590-\u05FF]/;
const visual = (s: string, rtl: boolean) => {
  if (!HEB.test(s)) return s;
  const levels = bidi.getEmbeddingLevels(s, rtl ? "rtl" : "ltr");
  return [...bidi.getReorderedString(s, levels)].reverse().join("");
};

/** The four faces the PDF embeds (subset): Heebo Regular / Medium, Frank Ruhl Libre Light, IBM Plex Mono Regular. */
export interface QuoteFonts {
  ui: Uint8Array;
  uiMed: Uint8Array;
  display: Uint8Array;
  mono: Uint8Array;
}
/** Font files in public/fonts, per face. */
export const QUOTE_FONT_URLS: Record<keyof QuoteFonts, string> = {
  ui: "/fonts/Heebo-Regular.ttf",
  uiMed: "/fonts/Heebo-Medium.ttf",
  display: "/fonts/FrankRuhlLibre-Light.ttf",
  mono: "/fonts/IBMPlexMono-Regular.ttf",
};
export interface QuoteIO {
  fonts: () => Promise<QuoteFonts>;
  /** A small JPEG of the slab (public/tex/_s/{id}-160.jpg), or null. */
  thumb: (slabId: string) => Promise<Uint8Array | null>;
}
export type QuoteResult = { pdf: Uint8Array; filename: string } | { error: string };

const bytesOf = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
};
let fontLoad: Promise<QuoteFonts> | null = null;
/** Fonts and thumbnails from the site's own static files (fonts fetched once per page). */
export const browserIO: QuoteIO = {
  fonts: () => {
    fontLoad ??= (async () => {
      const keys = Object.keys(QUOTE_FONT_URLS) as (keyof QuoteFonts)[];
      const all = await Promise.all(keys.map((k) => bytesOf(QUOTE_FONT_URLS[k])));
      return Object.fromEntries(keys.map((k, i) => [k, all[i]])) as unknown as QuoteFonts;
    })().catch((e) => {
      fontLoad = null; // a failed download is retried on the next quote
      throw e;
    });
    return fontLoad;
  },
  thumb: (id) =>
    /^[\w-]+$/.test(id)
      ? bytesOf(`/tex/_s/${id}-160.jpg`).catch((e) => {
          console.warn("quote: no thumbnail", id, e);
          return null;
        })
      : Promise.resolve(null),
};

/** base64 → bytes without Node's Buffer */
const base64Bytes = (b64: string) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const ils = (n: number) => `₪${Math.round(n).toLocaleString("en-US")}`;

export interface QuoteBody {
  lang?: "he" | "en";
  projectId: string;
  customerId: string;
  slabIds: string[];
  layout?: { slabs: number; yieldPct: number; wasteM2: number; seams: number; total: number; slabId: string } | null;
  renders?: string[];
}

/** The yield layout as printed: every field a finite number, or no layout line at all. */
function validLayout(l: QuoteBody["layout"]): NonNullable<QuoteBody["layout"]> | null {
  if (!l || typeof l !== "object") return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e9 ? v : null);
  const slabs = n(l.slabs), yieldPct = n(l.yieldPct), wasteM2 = n(l.wasteM2), seams = n(l.seams), total = n(l.total);
  if (slabs === null || yieldPct === null || wasteM2 === null || seams === null || total === null) return null;
  return { slabs, yieldPct, wasteM2, seams, total, slabId: String(l.slabId ?? "") };
}

export async function buildQuote(body: QuoteBody | null, io: QuoteIO): Promise<QuoteResult> {
  if (!body || typeof body.projectId !== "string" || typeof body.customerId !== "string") return { error: "bad-request" };
  const he = body.lang !== "en";
  const L = (h: string, e: string) => (he ? h : e);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(L("הצעת מחיר להדגמה — פרביטל", "Demo quote — Fervital"));
  doc.setAuthor("Kikkey concept demo");
  doc.setSubject(L("קונספט — לא מסמך רשמי של פרביטל", "Concept — not an official Fervital document"));
  const f = await io.fonts();
  const ui = await doc.embedFont(f.ui, { subset: true });
  const uiMed = await doc.embedFont(f.uiMed, { subset: true });
  const display = await doc.embedFont(f.display, { subset: true });
  const mono = await doc.embedFont(f.mono, { subset: true });

  const page = doc.addPage([595.28, 841.89]);
  const W = page.getWidth();
  const M = 42;
  // text helpers: `at` is the inline-start x (right edge in Hebrew)
  const text = (p: PDFPage, s: string, x: number, y: number, size: number, font: PDFFont, color = BASALT, align: "start" | "end" = "start") => {
    const v = visual(s, he);
    const w = font.widthOfTextAtSize(v, size);
    const leftAligned = he ? align === "end" : align === "start";
    p.drawText(v, { x: leftAligned ? x : x - w, y, size, font, color });
    return w;
  };
  const S = (x: number) => (he ? W - x : x); // mirror x for RTL layouts

  // header band
  page.drawRectangle({ x: 0, y: 841.89 - 120, width: W, height: 120, color: BASALT });
  text(page, L("פרביטל", "Fervital"), S(M), 841.89 - 70, 34, he ? display : display, CARRARA);
  text(page, "FERVITAL · 1956 · EMEK HEFER", S(M), 841.89 - 92, 7.5, mono, VEIN);
  text(page, L("הצעת מחיר להדגמה", "Demo quote"), S(W - M), 841.89 - 64, 15, uiMed, CARRARA, "end");
  const qn = `Q-${new Date().getFullYear()}-${Math.floor(Math.random() * 9000 + 1000)}`;
  text(page, `${qn} · ${new Date().toLocaleDateString("en-GB")}`, S(W - M), 841.89 - 82, 8, mono, VEIN, "end");
  page.drawRectangle({ x: 0, y: 841.89 - 120, width: W, height: 16, color: AMBER });
  {
    const banner = visual(L("קונספט של Kikkey — לא האתר הרשמי של פרביטל · מחירי הדגמה בלבד", "A Kikkey concept — not Fervital's official site · demo prices only"), he);
    const bw = uiMed.widthOfTextAtSize(banner, 7.5);
    page.drawText(banner, { x: (W - bw) / 2, y: 841.89 - 115, size: 7.5, font: uiMed, color: BASALT });
  }

  let y = 841.89 - 160;
  const cust = Object.hasOwn(CUSTOMERS, body.customerId) ? CUSTOMERS[body.customerId] : undefined;
  const proj = Object.hasOwn(PROJECTS, body.projectId) ? PROJECTS[body.projectId] : undefined;
  text(page, L("לכבוד", "For"), S(M), y, 8, ui, VEIN);
  y -= 16;
  text(page, cust ? cust.name[he ? "he" : "en"] : "—", S(M), y, 14, uiMed);
  y -= 14;
  text(page, cust ? `${cust.role[he ? "he" : "en"]} · ${cust.city[he ? "he" : "en"]}` : "", S(M), y, 9, ui, VEIN);
  y -= 22;
  text(page, L("פרויקט", "Project"), S(M), y, 8, ui, VEIN);
  y -= 15;
  text(page, proj ? proj.name[he ? "he" : "en"] : "—", S(M), y, 11, ui);
  y -= 26;

  // table header
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: BASALT });
  y -= 14;
  const cols = he
    ? { img: W - M - 54, name: W - M - 62, finish: 270, dims: 200, area: 130, total: M }
    : { img: M, name: M + 62, finish: 300, dims: 380, area: 455, total: W - M };
  text(page, L("לוח", "Slab"), cols.name, y, 7.5, uiMed, VEIN, he ? "start" : "start");
  text(page, L("גימור", "Finish"), cols.finish, y, 7.5, uiMed, VEIN, "start");
  text(page, L("מידות (מ״מ)", "Size (mm)"), cols.dims, y, 7.5, uiMed, VEIN, "start");
  text(page, L("שטח", "Area"), cols.area, y, 7.5, uiMed, VEIN, "start");
  text(page, L("סה״כ", "Total"), cols.total, y, 7.5, uiMed, VEIN, "end");
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: VEIN });

  const ids = (Array.isArray(body.slabIds) ? body.slabIds : []).filter((id) => typeof id === "string" && Object.hasOwn(SLABS, id)).slice(0, 7);
  let sum = 0;
  for (const id of ids) {
    const s = SLABS[id];
    y -= 44;
    try {
      const jpg = await io.thumb(id);
      if (!jpg) throw new Error("no thumbnail");
      const im = await doc.embedJpg(jpg);
      page.drawImage(im, { x: he ? cols.img : cols.img, y: y - 2, width: 54, height: 34 });
    } catch {
      /* thumbnail optional */
    }
    const line = s.areaM2 * s.priceM2;
    sum += line;
    text(page, s.name[he ? "he" : "en"], cols.name, y + 20, 10.5, uiMed);
    text(page, `${s.id} · ${s.rack.label}`, cols.name, y + 7, 7, mono, VEIN);
    const fin = { polished: L("מלוטש", "Polished"), honed: L("מט", "Honed"), leathered: L("עור", "Leathered") }[s.finish];
    text(page, fin, cols.finish, y + 14, 9, ui);
    text(page, `${s.lengthMm}×${s.heightMm}×${s.thicknessMm}`, cols.dims, y + 14, 8, mono);
    text(page, `${s.areaM2.toFixed(2)} m²`, cols.area, y + 14, 8, mono);
    text(page, ils(line), cols.total, y + 14, 9.5, ui, BASALT, "end");
    page.drawLine({ start: { x: M, y: y - 8 }, end: { x: W - M, y: y - 8 }, thickness: 0.3, color: VEIN });
  }
  if (!ids.length) {
    y -= 30;
    text(page, L("לא נבחרו לוחות לפרויקט עדיין.", "No slabs on this project yet."), S(M), y, 10, ui, VEIN);
  }

  // layout + totals
  y -= 40;
  const lay = validLayout(body.layout);
  if (lay) {
    text(page, L("פריסת ניצולת", "Yield layout"), S(M), y, 8, uiMed, VEIN);
    y -= 16;
    text(page, L(`${lay.slabs} לוחות · ניצולת ${lay.yieldPct}% · פחת ${lay.wasteM2} מ״ר · ${lay.seams} תפרים`, `${lay.slabs} slabs · ${lay.yieldPct}% yield · ${lay.wasteM2} m² waste · ${lay.seams} seams`), S(M), y, 10, ui);
    y -= 24;
  }
  const subtotal = lay?.total ?? sum * 1.18;
  page.drawRectangle({ x: M, y: y - 34, width: W - 2 * M, height: 44, color: CARRARA, borderColor: BASALT, borderWidth: 0.6 });
  text(page, L("הערכה כוללת (כולל מע״מ)", "Estimated total (incl. VAT)"), S(M + 12), y - 18, 10, uiMed);
  text(page, ils(subtotal), S(W - M - 12), y - 20, 18, uiMed, BASALT, "end");
  y -= 60;

  // renders: kept above the footer; if they would shrink below 60% here, they continue on a second page
  const FOOT = 84; // clear of the footer rule at y=70
  const renders: PDFImage[] = [];
  for (const r of (Array.isArray(body.renders) ? body.renders : []).filter((r) => typeof r === "string" && r.startsWith("data:image/jpeg")).slice(0, 2)) {
    try {
      renders.push(await doc.embedJpg(base64Bytes(r.split(",")[1] ?? "")));
    } catch {
      /* ignore */
    }
  }
  if (renders.length) {
    const rw = (W - 2 * M - 12) / 2;
    const tallest = Math.max(...renders.map((im) => (rw / im.width) * im.height));
    let rp = page;
    if (y - 10 - FOOT < 0.6 * tallest) {
      rp = doc.addPage([595.28, 841.89]);
      y = 841.89 - 60;
      text(rp, qn, S(W - M), y, 8, mono, VEIN, "end");
    }
    text(rp, L("הדמיות מצורפות", "Attached renders"), S(M), y, 8, uiMed, VEIN);
    y -= 10;
    let used = 0;
    renders.forEach((im, i) => {
      const h0 = (rw / im.width) * im.height;
      const h = Math.min(h0, y - FOOT);
      const w = rw * (h / h0);
      const x = he ? W - M - w - i * (rw + 12) : M + i * (rw + 12); // a narrowed render keeps to its column's inline start
      rp.drawImage(im, { x, y: y - h, width: w, height: h });
      used = Math.max(used, h);
    });
    y -= used + 14;
  }

  // footer, on every page
  for (const p of doc.getPages()) {
    p.drawLine({ start: { x: M, y: 70 }, end: { x: W - M, y: 70 }, thickness: 0.4, color: VEIN });
    text(p, L("אולם תצוגה: משכית 14, הרצליה פיתוח · גלריית אבן ומפעל: אזור התעשייה עמק חפר", "Showroom: 14 Maskit St, Herzliya Pituach · Stone gallery & plant: Emek Hefer industrial estate"), S(M), 54, 7.5, ui, VEIN);
    text(p, L("כל לוח שנרכש מסומן בלעדית עבור הלקוח. מסמך זה הוא הדגמה בלבד ואינו הצעה מחייבת.", "Every slab a customer buys is marked exclusively for them. This document is a demo, not a binding offer."), S(M), 42, 7.5, ui, VEIN);
    p.drawCircle({ x: he ? M + 4 : W - M - 4, y: 46, size: 3, color: VERDE });
  }

  const pdf = await doc.save();
  return { pdf, filename: `fervital-demo-quote-${body.projectId.replace(/[^\w-]/g, "")}.pdf` };
}
