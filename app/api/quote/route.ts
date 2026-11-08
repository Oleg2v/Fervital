import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import bidiFactory from "bidi-js";
import sharp from "sharp";
import slabsJson from "@/data/slabs.json";
import peopleJson from "@/data/people.json";
import type { Customer, ProjectDef, Slab } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

let fontBytes: Record<string, Buffer> | null = null;
async function fonts() {
  if (!fontBytes) {
    const dir = path.join(process.cwd(), "assets", "fonts");
    const [ui, uiMed, display, mono] = await Promise.all([
      fs.readFile(path.join(dir, "Heebo-Regular.ttf")),
      fs.readFile(path.join(dir, "Heebo-Medium.ttf")),
      fs.readFile(path.join(dir, "FrankRuhlLibre-Light.ttf")),
      fs.readFile(path.join(dir, "IBMPlexMono-Regular.ttf")),
    ]);
    fontBytes = { ui, uiMed, display, mono };
  }
  return fontBytes;
}

const ils = (n: number) => `₪${Math.round(n).toLocaleString("en-US")}`;

interface Body {
  lang?: "he" | "en";
  projectId: string;
  customerId: string;
  slabIds: string[];
  layout?: { slabs: number; yieldPct: number; wasteM2: number; seams: number; total: number; slabId: string } | null;
  renders?: string[];
}

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const he = (body.lang ?? "he") === "he";
  const L = (h: string, e: string) => (he ? h : e);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(L("הצעת מחיר להדגמה — פרביטל", "Demo quote — Fervital"));
  doc.setAuthor("Kikkey concept demo");
  doc.setSubject(L("קונספט — לא מסמך רשמי של פרביטל", "Concept — not an official Fervital document"));
  const f = await fonts();
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
  const cust = CUSTOMERS[body.customerId];
  const proj = PROJECTS[body.projectId];
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

  const ids = (body.slabIds ?? []).filter((id) => SLABS[id]).slice(0, 7);
  let sum = 0;
  for (const id of ids) {
    const s = SLABS[id];
    y -= 44;
    try {
      const jpg = await sharp(path.join(process.cwd(), "public", "tex", "_s", `${id}-400.webp`)).resize(160).jpeg({ quality: 78 }).toBuffer();
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
  const lay = body.layout;
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

  // renders
  const renders = (body.renders ?? []).filter((r) => r.startsWith("data:image/jpeg")).slice(0, 2);
  if (renders.length) {
    text(page, L("הדמיות מצורפות", "Attached renders"), S(M), y, 8, uiMed, VEIN);
    y -= 10;
    const rw = (W - 2 * M - 12) / 2;
    for (let i = 0; i < renders.length; i++) {
      try {
        const im = await doc.embedJpg(Buffer.from(renders[i].split(",")[1], "base64"));
        const h = (rw / im.width) * im.height;
        const x = he ? W - M - rw - i * (rw + 12) : M + i * (rw + 12);
        page.drawImage(im, { x, y: y - h, width: rw, height: h });
        if (i === renders.length - 1) y -= h + 14;
      } catch {
        /* ignore */
      }
    }
  }

  // footer
  page.drawLine({ start: { x: M, y: 70 }, end: { x: W - M, y: 70 }, thickness: 0.4, color: VEIN });
  text(page, L("אולם תצוגה: משכית 14, הרצליה פיתוח · גלריית אבן ומפעל: אזור התעשייה עמק חפר", "Showroom: 14 Maskit St, Herzliya Pituach · Stone gallery & plant: Emek Hefer industrial estate"), S(M), 54, 7.5, ui, VEIN);
  text(page, L("כל לוח שנרכש מסומן בלעדית עבור הלקוח. מסמך זה הוא הדגמה בלבד ואינו הצעה מחייבת.", "Every slab a customer buys is marked exclusively for them. This document is a demo, not a binding offer."), S(M), 42, 7.5, ui, VEIN);
  page.drawCircle({ x: he ? M + 4 : W - M - 4, y: 46, size: 3, color: VERDE });

  const bytes = await doc.save();
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="fervital-demo-quote-${body.projectId}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
