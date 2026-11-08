// Stone-query understanding + ranking over the mineral vectors of the 120 scans.
import type { FamilyKey, Finish, L10n, Slab } from "@/lib/types";

export type Lightness = "very_light" | "light" | "medium" | "dark" | "very_dark" | "any";
export type Temperature = "warm" | "neutral" | "cool" | "any";
export type BaseHue = "white" | "cream" | "beige" | "grey" | "black" | "green" | "red" | "gold" | "brown" | "blue" | "any";
export type Veins = "none" | "subtle" | "moderate" | "bold" | "any";
export type VeinColor = "grey" | "gold" | "white" | "dark" | "brown" | "green" | "any";
export type Pattern = "veined" | "speckled" | "banded" | "uniform" | "cloudy" | "any";
export type FinishPref = Finish | "matte" | "any";

export interface ParsedQuery {
  lightness: Lightness;
  temperature: Temperature;
  base_hue: BaseHue;
  veins: Veins;
  vein_color: VeinColor;
  pattern: Pattern;
  finish: FinishPref;
  translucent: "yes" | "no" | "any";
  families: FamilyKey[];
  max_price_m2: number; // 0 = no limit
  summary_he: string;
  summary_en: string;
}

export const FAMILY_KEYS: FamilyKey[] = [
  "carrara",
  "calacatta",
  "statuario",
  "nero-marquina",
  "verde-alpi",
  "travertino",
  "onyx",
  "granite",
  "basalt",
];

/** JSON schema for structured outputs (Claude) — mirrors ParsedQuery. */
export const QUERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    lightness: { type: "string", enum: ["very_light", "light", "medium", "dark", "very_dark", "any"] },
    temperature: { type: "string", enum: ["warm", "neutral", "cool", "any"] },
    base_hue: { type: "string", enum: ["white", "cream", "beige", "grey", "black", "green", "red", "gold", "brown", "blue", "any"] },
    veins: { type: "string", enum: ["none", "subtle", "moderate", "bold", "any"] },
    vein_color: { type: "string", enum: ["grey", "gold", "white", "dark", "brown", "green", "any"] },
    pattern: { type: "string", enum: ["veined", "speckled", "banded", "uniform", "cloudy", "any"] },
    finish: { type: "string", enum: ["polished", "honed", "leathered", "matte", "any"] },
    translucent: { type: "string", enum: ["yes", "no", "any"] },
    families: { type: "array", items: { type: "string", enum: FAMILY_KEYS } },
    max_price_m2: { type: "number" },
    summary_he: { type: "string" },
    summary_en: { type: "string" },
  },
  required: [
    "lightness",
    "temperature",
    "base_hue",
    "veins",
    "vein_color",
    "pattern",
    "finish",
    "translucent",
    "families",
    "max_price_m2",
    "summary_he",
    "summary_en",
  ],
} as const;

export const emptyQuery = (): ParsedQuery => ({
  lightness: "any",
  temperature: "any",
  base_hue: "any",
  veins: "any",
  vein_color: "any",
  pattern: "any",
  finish: "any",
  translucent: "any",
  families: [],
  max_price_m2: 0,
  summary_he: "",
  summary_en: "",
});

// ── local parser (Hebrew + English) ───────────────────────────
type Hit = (q: ParsedQuery, ctx: { vein: boolean; neg: boolean; very: boolean }) => void;
const LEX: [RegExp, Hit][] = [];
const rule = (re: RegExp, fn: Hit) => LEX.push([re, fn]);

const setHue = (hue: BaseHue, vc?: VeinColor): Hit => (q, c) => {
  if (c.vein && vc) q.vein_color = vc;
  else q.base_hue = hue;
};

// colours (a colour right after "veins" describes the veins)
rule(/^(לבנ(ה|ים|ות)?|לבן|לבנבן|white|whites?)$/, (q, c) => {
  if (c.vein) q.vein_color = "white";
  else {
    q.base_hue = "white";
    if (q.lightness === "any") q.lightness = "very_light";
  }
});
rule(/^(שמנת|קרם|קרמי|cream|creamy|ivory)$/, setHue("cream"));
rule(/^(בז'?|בז׳|חולי|חול|beige|sand|sandy|taupe)$/, setHue("beige"));
rule(/^(אפור(ה|ים|ות)?|grey|gray|greyish|grayish)$/, setHue("grey", "grey"));
rule(/^(שחור(ה|ים|ות)?|black|nero)$/, (q, c) => {
  if (c.vein) q.vein_color = "dark";
  else {
    q.base_hue = "black";
    q.lightness = "very_dark";
  }
});
rule(/^(ירוק(ה|ים|ות)?|green|verde|ירקרק)$/, (q, c) => {
  if (c.vein) q.vein_color = "green";
  else {
    q.base_hue = "green";
    if (!q.families.includes("verde-alpi")) q.families.push("verde-alpi");
  }
});
rule(/^(אדו?מ(ה|ים|ות)?|אדום|בורדו|יין|red|wine|burgundy|rosso)$/, setHue("red"));
rule(/^(זהב|זהוב(ה|ים|ות)?|דבש|ענבר|gold|golden|honey|amber|oro)$/, setHue("gold", "gold"));
rule(/^(חומ(ה|ים|ות)?|חום|שוקולד|אגוז|קפה|brown|chocolate|walnut|coffee)$/, setHue("brown", "brown"));
rule(/^(כחול(ה|ים|ות)?|תכלת|פטרול|blue|azure|azul)$/, setHue("blue"));
// lightness / temperature
rule(/^(בהיר(ה|ים|ות)?|light|pale)$/, (q, c) => (q.lightness = c.very ? "very_light" : "light"));
rule(/^(כהה|כהים|כהות|dark|deep|עמוק(ה|ים)?)$/, (q, c) => (q.lightness = c.very || q.lightness === "dark" ? "very_dark" : "dark"));
rule(/^(בינוני(ת)?|medium|mid)$/, (q) => (q.lightness = "medium"));
rule(/^(חמ(ה|ים|ות)?|חם|חמימ(ה|ים)?|חמים|warm)$/, (q) => (q.temperature = "warm"));
rule(/^(קר(ה|ים|ות)?|קריר(ה|ים)?|cool|cold|icy)$/, (q) => (q.temperature = "cool"));
rule(/^(ניטרלי(ת)?|neutral)$/, (q) => (q.temperature = "neutral"));
// veins
rule(/^(ורידים|וריד|ורידי|עורקים|veins?|veined|veining)$/, (q, c) => {
  if (c.neg) {
    q.veins = "none";
    q.pattern = "uniform";
  } else if (q.veins === "any") q.veins = "moderate";
  if (q.pattern === "any" && !c.neg) q.pattern = "veined";
});
rule(/^(עדינ(ה|ים|ות)?|עדין|דק(ים|ות)?|subtle|soft|fine|delicate|faint)$/, (q) => (q.veins = "subtle"));
rule(/^(בולט(ים|ות|ת)?|דרמטי(ים|ת|ות)?|חזק(ים|ה)?|עבים|רחבים|bold|dramatic|strong|heavy|thick|broad)$/, (q) => {
  q.veins = "bold";
  if (q.pattern === "any") q.pattern = "veined";
});
// pattern
rule(/^(מנומר(ת|ים)?|נקודות|נקודתי|גרגיר(ים|י)?|פלפל|speckled|speckle|grainy|granular|pepper)$/, (q) => (q.pattern = "speckled"));
rule(/^(פסים|שכבות|גלים|גלי|אופקי(ים|ות)?|banded|bands|layered|layers|strata|stripes|horizontal|waves|wavy)$/, (q) => (q.pattern = "banded"));
rule(/^(אחיד(ה|ים)?|uniform|plain|solid|even)$/, (q) => {
  q.pattern = "uniform";
  if (q.veins === "any") q.veins = "none";
});
rule(/^(עננים|מעונן|ענני|cloudy|clouded|nuvolato)$/, (q) => (q.pattern = "cloudy"));
rule(/^(שקו(ף|פה|פים)|שקיפות|מואר|translucent|backlit|transparent)$/, (q, c) => {
  q.translucent = c.neg ? "no" : "yes";
  if (!c.neg && !q.families.includes("onyx")) q.families.push("onyx");
});
// finish
rule(/^(מבריק(ה|ים)?|מבריק|פוליש|מלוטש(ת|ים)?|glossy|polished|shiny|gloss)$/, (q, c) => (q.finish = c.neg ? "matte" : "polished"));
rule(/^(מט|מאט|הונד|משיי|matte|matt|honed|satin)$/, (q) => (q.finish = "matte"));
rule(/^(עור|לדר|מחוספס|leather|leathered|textured|brushed)$/, (q) => (q.finish = "leathered"));
// families
const fam = (f: FamilyKey): Hit => (q) => {
  if (!q.families.includes(f)) q.families.push(f);
};
rule(/^(קלקטה|calacatta)$/, fam("calacatta"));
rule(/^(קרארה|carrara)$/, fam("carrara"));
rule(/^(סטטואריו|statuario)$/, fam("statuario"));
rule(/^(מרקינה|marquina)$/, fam("nero-marquina"));
rule(/^(אלפי|alpi)$/, fam("verde-alpi"));
rule(/^(טרוורטין|טרוורטינו|travertine|travertino)$/, fam("travertino"));
rule(/^(אוניקס|onyx|onice)$/, fam("onyx"));
rule(/^(גרניט|granite)$/, fam("granite"));
rule(/^(בזלת|basalt|basalto)$/, fam("basalt"));

const NEG = /^(לא|בלי|ללא|אין|not|no|without|non)$/;
const VERY = /^(מאוד|ממש|very|really|super|extra)$/;
const VEIN_WORD = /^(ורידים|וריד|ורידי|עורקים|veins?|veining)$/;
const HE_PREFIX = /^[והבלמשכ]{1,2}(?=[א-ת]{2,})/;

function variants(tok: string): string[] {
  const out = [tok];
  if (/[א-ת]/.test(tok)) {
    const stripped = tok.replace(HE_PREFIX, "");
    if (stripped !== tok) out.push(stripped);
    if (tok.length > 3 && /^[והבלמשכ]/.test(tok)) out.push(tok.slice(1));
  }
  return out;
}

export function parseLocal(text: string): ParsedQuery {
  const q = emptyQuery();
  const tokens = text
    .toLowerCase()
    .replace(/[״"]/g, "")
    .split(/[^a-zא-ת'׳0-9₪]+/)
    .filter(Boolean);
  let veinCtx = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const prev = tokens[i - 1] ?? "";
    const prev2 = tokens[i - 2] ?? "";
    const vars = variants(tok);
    const neg = NEG.test(prev) || NEG.test(prev2);
    const very = VERY.test(tokens[i + 1] ?? "") || VERY.test(prev);
    // numbers: "עד 1200" → max price
    const num = Number(tok.replace(/[^0-9]/g, ""));
    if (num >= 200 && num <= 20000 && /^(עד|upto|under|below|max)$/.test(prev)) q.max_price_m2 = num;
    const isVein = vars.some((v) => VEIN_WORD.test(v));
    const veinNext = /^[a-z]/.test(tok) && (VEIN_WORD.test(tokens[i + 1] ?? "") || VEIN_WORD.test(tokens[i + 2] ?? ""));
    for (const v of vars) {
      const r = LEX.find(([re]) => re.test(v));
      if (r) {
        r[1](q, { vein: (veinCtx > 0 || veinNext) && !isVein, neg, very });
        break;
      }
    }
    if (isVein) veinCtx = 2;
    else if (veinCtx > 0) veinCtx--;
  }
  return q;
}

// ── scoring ────────────────────────────────────────────────────
export interface SlabVec {
  v: number[];
  lab: [number, number, number];
  vein: [number, number, number];
  density: number;
  contrast: number;
  polarity: number;
  speckle: number;
  coherence: number;
}

type Constraint = { dim: number; min?: number; max?: number; tol: number; w: number; key: string };

function constraintsFor(q: ParsedQuery): Constraint[] {
  const c: Constraint[] = [];
  const add = (key: string, dim: number, w: number, min?: number, max?: number, tol = 0.1) =>
    c.push({ key, dim, w, min, max, tol });
  switch (q.lightness) {
    case "very_light": add("lightness", 0, 3, 0.86, undefined, 0.08); break;
    case "light": add("lightness", 0, 3, 0.7, 0.92, 0.1); break;
    case "medium": add("lightness", 0, 3, 0.4, 0.72, 0.12); break;
    case "dark": add("lightness", 0, 3, undefined, 0.42, 0.12); break;
    case "very_dark": add("lightness", 0, 3, undefined, 0.28, 0.1); break;
  }
  switch (q.temperature) {
    case "warm": add("warm", 1, 1.6, 0.21, undefined, 0.08); break;
    case "neutral": add("neutral", 1, 1.2, 0.13, 0.28, 0.07); break;
    case "cool": add("cool", 1, 1.6, undefined, 0.15, 0.06); break;
  }
  switch (q.base_hue) {
    case "white": add("white", 0, 2.4, 0.84, undefined, 0.09); add("white", 3, 1, undefined, 0.16, 0.1); break;
    case "cream": add("cream", 0, 2, 0.74, 0.93, 0.1); add("cream", 1, 2, 0.3, 0.6, 0.1); break;
    case "beige": add("beige", 0, 2, 0.55, 0.88, 0.12); add("beige", 1, 2, 0.4, 0.9, 0.12); break;
    case "grey": add("grey", 3, 2, undefined, 0.14, 0.08); add("grey", 0, 1, 0.35, 0.85, 0.15); break;
    case "black": add("black", 0, 3, undefined, 0.3, 0.1); break;
    case "green": add("green", 2, 2.2, undefined, 0.33, 0.04); break;
    case "red": add("red", 2, 2.6, 0.55, undefined, 0.1); break;
    case "gold": add("gold", 1, 2.4, 0.62, undefined, 0.12); add("gold", 3, 1.6, 0.45, undefined, 0.15); break;
    case "brown": add("brown", 0, 1.6, 0.18, 0.62, 0.12); add("brown", 1, 1.6, 0.3, 0.75, 0.12); break;
    case "blue": add("blue", 1, 2.2, undefined, 0.1, 0.06); break;
  }
  switch (q.veins) {
    case "none": add("veins", 4, 1.6, undefined, 0.12, 0.1); add("veins", 5, 1, undefined, 0.28, 0.1); break;
    case "subtle": add("veins", 4, 1.4, 0.04, 0.4, 0.1); add("veins", 5, 1, undefined, 0.36, 0.1); break;
    case "moderate": add("veins", 4, 1.4, 0.08, 0.7, 0.12); break;
    case "bold": add("veins", 5, 1.8, 0.42, undefined, 0.12); add("veins", 4, 1, 0.25, undefined, 0.15); break;
  }
  switch (q.vein_color) {
    case "grey": add("veinGrey", 8, 1.6, undefined, 0.2, 0.1); add("veinGrey", 6, 1, undefined, 0.45, 0.15); break;
    case "gold": add("veinGold", 8, 1.6, 0.12, undefined, 0.1); break;
    case "white": add("veinWhite", 6, 2, 0.7, undefined, 0.12); add("veinWhite", 7, 1, 0.38, undefined, 0.12); break;
    case "dark": add("veinDark", 6, 1.8, undefined, 0.3, 0.12); break;
    case "brown": add("veinBrown", 8, 1.4, 0.18, undefined, 0.1); break;
    case "green": add("veinGreen", 2, 1.4, undefined, 0.34, 0.05); break;
  }
  switch (q.pattern) {
    case "veined": add("veined", 10, 1.2, undefined, 0.32, 0.1); break;
    case "speckled": add("speckled", 9, 1.8, 0.5, undefined, 0.12); add("speckled", 10, 1.2, undefined, 0.15, 0.08); add("speckled", 5, 1, 0.38, undefined, 0.15); break;
    case "banded": add("banded", 10, 2.2, 0.42, undefined, 0.12); break;
    case "uniform": add("uniform", 4, 1.4, undefined, 0.12, 0.08); add("uniform", 11, 1.2, undefined, 0.3, 0.1); break;
    case "cloudy": add("cloudy", 10, 1, undefined, 0.3, 0.1); add("cloudy", 4, 1, undefined, 0.25, 0.1); break;
  }
  return c;
}

const simOf = (val: number, k: Constraint) => {
  let d = 0;
  if (k.min !== undefined && val < k.min) d = k.min - val;
  if (k.max !== undefined && val > k.max) d = val - k.max;
  if (d > 0) return Math.exp(-((d / k.tol) ** 2));
  // inside the range: prefer the heart of it over the edges
  if (k.min !== undefined && k.max !== undefined) {
    const c = (k.min + k.max) / 2;
    const hw = Math.max(1e-3, (k.max - k.min) / 2);
    return 1 - 0.14 * ((val - c) / hw) ** 2;
  }
  const edge = k.min !== undefined ? val - k.min : k.max! - val;
  return 1 - 0.12 * Math.exp(-edge / k.tol);
};

export interface Ranked {
  id: string;
  score: number; // 0..1
  reason: L10n;
  held: boolean;
}

const FINISH_TXT: Record<Finish, L10n> = {
  polished: { he: "גימור מבריק", en: "polished finish" },
  honed: { he: "גימור מט", en: "honed finish" },
  leathered: { he: "גימור עור", en: "leathered finish" },
};
const FAMILY_TXT: Record<FamilyKey, L10n> = {
  carrara: { he: "קרארה", en: "Carrara" },
  calacatta: { he: "קלקטה", en: "Calacatta" },
  statuario: { he: "סטטואריו", en: "Statuario" },
  "nero-marquina": { he: "נרו מרקינה", en: "Nero Marquina" },
  "verde-alpi": { he: "ורדה אלפי", en: "Verde Alpi" },
  travertino: { he: "טרוורטין", en: "travertine" },
  onyx: { he: "אוניקס", en: "onyx" },
  granite: { he: "גרניט", en: "granite" },
  basalt: { he: "בזלת", en: "basalt" },
};

function describe(key: string, s: Slab, f: SlabVec): L10n | null {
  const [L, , b] = f.lab;
  const Ls = Math.round(L);
  const bs = (b >= 0 ? "+" : "") + Math.round(b);
  switch (key) {
    case "lightness":
    case "white":
      return { he: `בסיס ${L > 84 ? "לבן" : L > 65 ? "בהיר" : L > 40 ? "בגוון ביניים" : "כהה"} (L ${Ls})`, en: `${L > 84 ? "white" : L > 65 ? "light" : L > 40 ? "mid-tone" : "dark"} ground (L ${Ls})` };
    case "warm":
      return { he: `חמים (b* ${bs})`, en: `warm (b* ${bs})` };
    case "cool":
      return { he: `קריר (b* ${bs})`, en: `cool (b* ${bs})` };
    case "neutral":
      return { he: `ניטרלי (b* ${bs})`, en: `neutral (b* ${bs})` };
    case "cream":
    case "beige":
      return { he: `בז׳-שמנת (L ${Ls}, b* ${bs})`, en: `cream-beige (L ${Ls}, b* ${bs})` };
    case "grey":
      return { he: `אפור ניטרלי (L ${Ls})`, en: `neutral grey (L ${Ls})` };
    case "black":
      return { he: `שחור עמוק (L ${Ls})`, en: `deep black (L ${Ls})` };
    case "green":
      return { he: "בסיס ירוק-יער", en: "forest-green ground" };
    case "red":
      return { he: "גווני יין וחלודה", en: "wine and rust tones" };
    case "gold":
      return { he: `דבש וענבר (b* ${bs})`, en: `honey and amber (b* ${bs})` };
    case "brown":
      return { he: `חום חם (L ${Ls})`, en: `warm brown (L ${Ls})` };
    case "blue":
      return { he: "נטייה כחולה", en: "a blue cast" };
    case "veins":
      return f.density < 0.02
        ? { he: "כמעט ללא ורידים", en: "almost no veining" }
        : { he: `ורידים ב-${Math.round(f.density * 100)}% מהשטח`, en: `veins over ${Math.round(f.density * 100)}% of the face` };
    case "veinGrey":
      return { he: "ורידים אפורים", en: "grey veins" };
    case "veinGold":
      return { he: "ורידים בגוון זהב", en: "gold-toned veins" };
    case "veinWhite":
      return { he: "ורידים לבנים על רקע כהה", en: "white veins on a dark ground" };
    case "veinDark":
      return { he: "ורידים כהים", en: "dark veins" };
    case "veinBrown":
      return { he: "ורידים חומים", en: "brown veins" };
    case "veinGreen":
      return { he: "ורידים ירקרקים", en: "greenish veins" };
    case "speckled":
      return { he: "גרגיר מנומר", en: "speckled grain" };
    case "banded":
      return { he: "שכבות זורמות", en: "flowing bands" };
    case "uniform":
      return { he: "משטח אחיד ורגוע", en: "calm, even face" };
    case "cloudy":
      return { he: "עננות רכה", en: "soft clouding" };
    case "veined":
      return { he: "ורידים פתוחים", en: "open veining" };
    case "finish":
      return FINISH_TXT[s.finish];
    case "family":
      return FAMILY_TXT[s.family];
    case "price":
      return { he: `₪${s.priceM2.toLocaleString("en-US")} למ״ר`, en: `₪${s.priceM2.toLocaleString("en-US")}/m²` };
  }
  return null;
}

export function rankText(
  q: ParsedQuery,
  slabs: Slab[],
  vecs: Record<string, SlabVec>,
  status: Record<string, "available" | "held" | "sold">,
  limit = 8,
): Ranked[] {
  const cons = constraintsFor(q);
  const out: (Ranked & { tex: string })[] = [];
  for (const s of slabs) {
    const st = status[s.id] ?? "available";
    if (st === "sold") continue;
    const f = vecs[s.id];
    if (!f) continue;
    const parts: { key: string; w: number; sim: number }[] = [];
    for (const k of cons) parts.push({ key: k.key, w: k.w, sim: simOf(f.v[k.dim], k) });
    if (q.finish !== "any") {
      const ok = q.finish === "matte" ? s.finish !== "polished" : s.finish === q.finish;
      parts.push({ key: "finish", w: 2, sim: ok ? 1 : 0.15 });
    }
    if (q.families.length) parts.push({ key: "family", w: 2.4, sim: q.families.includes(s.family) ? 1 : 0.1 });
    if (q.translucent === "yes") parts.push({ key: "banded", w: 1.4, sim: s.family === "onyx" ? 1 : 0.2 });
    if (q.max_price_m2 > 0) parts.push({ key: "price", w: 1.5, sim: s.priceM2 <= q.max_price_m2 ? 1 : Math.exp(-(((s.priceM2 - q.max_price_m2) / 600) ** 2)) });
    const W = parts.reduce((a, p) => a + p.w, 0);
    let score = W ? parts.reduce((a, p) => a + p.w * p.sim, 0) / W : 0.5;
    if (st === "held") score *= 0.94;
    // merge duplicate keys, keep the strongest evidence
    const best = new Map<string, number>();
    for (const p of parts) best.set(p.key, Math.max(best.get(p.key) ?? 0, p.sim * p.w));
    const reasons = [...best.entries()]
      .filter(([k]) => parts.find((p) => p.key === k)!.sim > 0.55)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k]) => describe(k, s, f))
      .filter((r, i, arr): r is L10n => !!r && arr.findIndex((x) => x?.he === r.he) === i)
      .slice(0, 3);
    if (!reasons.some((r) => r === FINISH_TXT[s.finish]) && reasons.length < 3) reasons.push(FINISH_TXT[s.finish]);
    out.push({
      id: s.id,
      tex: s.tex,
      score,
      held: st === "held",
      reason: { he: reasons.map((r) => r.he).join(" · "), en: reasons.map((r) => r.en).join(" · ") },
    });
  }
  return diversify(out, limit);
}

const IMG_W = [3, 2, 1.5, 1.5, 1, 1.1, 1, 0.7, 0.6, 1, 1.4, 0.8];

export function rankImage(
  qv: number[],
  qlab: [number, number, number],
  slabs: Slab[],
  vecs: Record<string, SlabVec>,
  status: Record<string, "available" | "held" | "sold">,
  limit = 8,
): Ranked[] {
  const W = IMG_W.reduce((a, b) => a + b, 0);
  const out: (Ranked & { tex: string })[] = [];
  for (const s of slabs) {
    const st = status[s.id] ?? "available";
    if (st === "sold") continue;
    const f = vecs[s.id];
    if (!f) continue;
    let d2 = 0;
    for (let i = 0; i < qv.length; i++) d2 += IMG_W[i] * (qv[i] - f.v[i]) ** 2;
    const dist = Math.sqrt(d2 / W);
    let score = Math.exp(-((dist / 0.16) ** 2));
    if (st === "held") score *= 0.94;
    const dE = Math.hypot(qlab[0] - f.lab[0], qlab[1] - f.lab[1], qlab[2] - f.lab[2]);
    const pattern =
      f.coherence > 0.4 ? { he: "שכבות זורמות דומות", en: "similar flowing bands" } : f.v[9] > 0.6 ? { he: "גרגיר דומה", en: "similar grain" } : { he: "תנועת ורידים דומה", en: "similar vein movement" };
    out.push({
      id: s.id,
      tex: s.tex,
      score,
      held: st === "held",
      reason: {
        he: `ΔE ${dE.toFixed(1)} מגוון הבסיס בתמונה · ${pattern.he} · ${FINISH_TXT[s.finish].he}`,
        en: `ΔE ${dE.toFixed(1)} from your photo's ground colour · ${pattern.en} · ${FINISH_TXT[s.finish].en}`,
      },
    });
  }
  return diversify(out, limit);
}

/** Keep at most two slabs per base stone so the shortlist isn't six cuts of one block. */
function diversify(list: (Ranked & { tex: string })[], limit: number): Ranked[] {
  list.sort((a, b) => b.score - a.score);
  const per = new Map<string, number>();
  const blocks = new Set<string>();
  const res: Ranked[] = [];
  for (const r of list) {
    const n = per.get(r.tex) ?? 0;
    const block = r.id.split("-").slice(0, 3).join("-");
    if (n >= 2 || blocks.has(block)) continue;
    per.set(r.tex, n + 1);
    blocks.add(block);
    res.push({ id: r.id, score: r.score, reason: r.reason, held: r.held });
    if (res.length >= limit) break;
  }
  return res;
}

export function summarize(q: ParsedQuery): { he: string[]; en: string[] } {
  const he: string[] = [];
  const en: string[] = [];
  const push = (h: string, e: string) => {
    he.push(h);
    en.push(e);
  };
  const LH: Record<string, [string, string]> = {
    very_light: ["בהיר מאוד", "very light"],
    light: ["בהיר", "light"],
    medium: ["ביניים", "mid-tone"],
    dark: ["כהה", "dark"],
    very_dark: ["כהה מאוד", "very dark"],
  };
  const HUE: Record<string, [string, string]> = {
    white: ["בסיס לבן", "white ground"],
    cream: ["שמנת", "cream"],
    beige: ["בז׳", "beige"],
    grey: ["אפור", "grey"],
    black: ["שחור", "black"],
    green: ["ירוק", "green"],
    red: ["אדום-יין", "red"],
    gold: ["דבש-זהב", "honey-gold"],
    brown: ["חום", "brown"],
    blue: ["כחלחל", "blue"],
  };
  if (q.base_hue !== "any") push(...HUE[q.base_hue]);
  if (q.lightness !== "any" && q.base_hue !== "white" && q.base_hue !== "black") push(...LH[q.lightness]);
  if (q.temperature !== "any") push(...({ warm: ["חם", "warm"], cool: ["קריר", "cool"], neutral: ["ניטרלי", "neutral"] } as Record<string, [string, string]>)[q.temperature]);
  if (q.veins !== "any")
    push(...({ none: ["בלי ורידים", "no veins"], subtle: ["ורידים עדינים", "subtle veins"], moderate: ["ורידים", "veining"], bold: ["ורידים בולטים", "bold veins"] } as Record<string, [string, string]>)[q.veins]);
  if (q.vein_color !== "any")
    push(...({ grey: ["ורידים אפורים", "grey veins"], gold: ["ורידי זהב", "gold veins"], white: ["ורידים לבנים", "white veins"], dark: ["ורידים כהים", "dark veins"], brown: ["ורידים חומים", "brown veins"], green: ["ורידים ירקרקים", "green veins"] } as Record<string, [string, string]>)[q.vein_color]);
  if (q.pattern !== "any" && q.pattern !== "veined")
    push(...({ speckled: ["מנומר", "speckled"], banded: ["שכבות", "banded"], uniform: ["אחיד", "uniform"], cloudy: ["מעונן", "cloudy"] } as Record<string, [string, string]>)[q.pattern]);
  if (q.finish !== "any")
    push(...({ polished: ["מבריק", "polished"], honed: ["מט", "honed"], leathered: ["עור", "leathered"], matte: ["לא מבריק", "not glossy"] } as Record<string, [string, string]>)[q.finish]);
  if (q.translucent === "yes") push("שקוף-למחצה", "translucent");
  for (const f of q.families) push(FAMILY_TXT[f].he, FAMILY_TXT[f].en);
  if (q.max_price_m2 > 0) push(`עד ₪${q.max_price_m2}`, `≤ ₪${q.max_price_m2}`);
  return { he, en };
}
