#!/usr/bin/env node
// Generates the demo yard: 120 slabs, per-slab crops, descriptor vectors, people & seeds.
//   node --experimental-strip-types scripts/build-data.mjs
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { TEXTURES, FAMILIES } from "./catalog.mjs";
import { computeFeatures, toVector } from "../lib/vision/descriptor.ts";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const TEX = path.join(ROOT, "public", "tex");
const CROPS = path.join(TEX, "_s");
const DATA = path.join(ROOT, "data");

// ── deterministic RNG ──────────────────────────────────────
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(1956);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const range = ([a, b], step = 10) => Math.round((a + rnd() * (b - a)) / step) * step;
const weighted = (obj) => {
  const r = rnd();
  let acc = 0;
  for (const [k, w] of Object.entries(obj)) {
    acc += w;
    if (r <= acc) return k;
  }
  return Object.keys(obj)[0];
};

const FINISH = {
  polished: { he: "מלוטש (פוליש)", en: "polished", short_he: "מבריק" },
  honed: { he: "מט (הונד)", en: "honed", short_he: "מט" },
  leathered: { he: "עור (לדר)", en: "leathered", short_he: "עור" },
};

function splitBlocks(n) {
  if (n >= 6) return [Math.ceil(n / 2), Math.floor(n / 2)];
  if (n === 5) return [3, 2];
  return [n];
}

// ── 1. slabs ───────────────────────────────────────────────
const slabs = [];
const usedBlocks = new Set();
for (const t of TEXTURES) {
  const fam = FAMILIES[t.family];
  const blocks = splitBlocks(t.slabs);
  blocks.forEach((size, bi) => {
    let block;
    do block = String(1100 + Math.floor(rnd() * 3800)); while (usedBlocks.has(block));
    usedBlocks.add(block);
    const finish = weighted(fam.finishes);
    const L = range(fam.dims.L);
    const H = range(fam.dims.H);
    const thickness = pick(fam.thickness);
    const cw = t.res === "8K" ? 0.96 : 0.94;
    const ch = (cw * H) / L;
    const u0 = rnd() * (1 - cw - 0.03);
    const v0 = rnd() * (1 - ch - 0.03);
    const rot = bi % 2 === 1 ? 180 : rnd() < 0.3 ? 180 : 0;
    const [pa, pb] = fam.price;
    const premium = t.res === "8K" ? 0.55 + rnd() * 0.45 : rnd() * 0.75;
    const priceM2 = Math.round((pa + (pb - pa) * premium) / 10) * 10;
    for (let s = 1; s <= size; s++) {
      const id = `FV-${fam.code}-${block}-${String(s).padStart(2, "0")}`;
      const dl = Math.round((rnd() - 0.5) * 4) * 10; // sequential slabs differ by a few cm
      const lengthMm = L + dl;
      const heightMm = H + Math.round((rnd() - 0.5) * 2) * 10;
      slabs.push({
        id,
        tex: t.key,
        family: t.family,
        kind: fam.kind,
        name: t.name,
        origin: t.origin ?? fam.origin,
        finish,
        lengthMm,
        heightMm,
        thicknessMm: thickness,
        areaM2: Math.round(((lengthMm * heightMm) / 1e6) * 100) / 100,
        block,
        seq: s,
        blockSize: size,
        priceM2,
        crop: {
          u: Math.round((u0 + (s - 1) * 0.004) * 1e4) / 1e4,
          v: Math.round(v0 * 1e4) / 1e4,
          w: Math.round(cw * 1e4) / 1e4,
          h: Math.round(ch * 1e4) / 1e4,
          rot,
        },
        desc: {
          he: `${t.desc.he}, גימור ${FINISH[finish].he}, עובי ${thickness} מ״מ`,
          en: `${t.desc.en[0].toUpperCase()}${t.desc.en.slice(1)}, ${FINISH[finish].en} finish, ${thickness} mm thick`,
        },
        status: "available",
        rack: null,
        hero: t.res === "8K",
      });
    }
  });
}
if (slabs.length !== 120) throw new Error(`expected 120 slabs, got ${slabs.length}`);

// ── 2. racks: A is the curated upright catalogue (hero), B/C the yard ──
const RACK_A = [
  "calacatta-oro", "nero-marquina-extra", "onice-miele", "statuario-venato", "verde-alpi",
  "travertino-classico", "santa-cecilia", "carrara-classico", "calacatta-gold", "onice-azzurro",
  "nero-marquina-classico", "travertino-noce", "onice-rosso", "statuario-nuvolato", "branco-siena",
  "calacatta-oro", "basalto-etna", "onice-bianco", "vermelho-brasilia", "carrara-gioia",
  "nero-marquina-dorato", "travertino-oro", "azul-noturno", "calacatta-crema", "onice-perla",
  "verde-alpi", "ouro-brasil", "statuario-venato", "calacatta-tortora", "onice-nero",
  "carrara-venato", "travertino-scuro", "basalto-grigio", "onice-miele", "nero-marquina-extra",
  "santa-cecilia", "carrara-classico", "travertino-classico", "calacatta-gold", "statuario-venato",
];
const pool = [...slabs];
const takeFirst = (tex, preferOtherBlockThan) => {
  let idx = pool.findIndex((s) => s.tex === tex && s.block !== preferOtherBlockThan);
  if (idx < 0) idx = pool.findIndex((s) => s.tex === tex);
  if (idx < 0) throw new Error(`no slab left for ${tex}`);
  return pool.splice(idx, 1)[0];
};
const lastBlockByTex = {};
RACK_A.forEach((tex, i) => {
  const s = takeFirst(tex, lastBlockByTex[tex]);
  lastBlockByTex[tex] = s.block;
  s.rack = { rack: "A", slot: i + 1, label: `A-${String(i + 1).padStart(2, "0")}` };
});
// shuffle the rest into B and C
for (let i = pool.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [pool[i], pool[j]] = [pool[j], pool[i]];
}
pool.forEach((s, i) => {
  const rack = i < 40 ? "B" : "C";
  const slot = (i % 40) + 1;
  s.rack = { rack, slot, label: `${rack}-${String(slot).padStart(2, "0")}` };
});
const rackOrder = { A: 0, B: 1, C: 2 };
slabs.sort((a, b) => rackOrder[a.rack.rack] - rackOrder[b.rack.rack] || a.rack.slot - b.rack.slot);

// ── 3. per-slab crops + descriptor vectors ───────────────
await fs.rm(CROPS, { recursive: true, force: true });
await fs.mkdir(CROPS, { recursive: true });
const vectors = {};
const texMeta = Object.fromEntries(
  JSON.parse(await fs.readFile(path.join(DATA, "textures.json"), "utf8")).map((t) => [t.key, t]),
);
for (const s of slabs) {
  const src = path.join(TEX, s.tex, "c2k.webp");
  const S = 2048;
  const left = Math.round(s.crop.u * S);
  const top = Math.round(s.crop.v * S);
  const width = Math.round(s.crop.w * S);
  const height = Math.round(s.crop.h * S);
  let img = sharp(src).extract({ left, top, width, height });
  if (s.crop.rot === 180) img = img.rotate(180);
  const buf = await img.toBuffer();
  await sharp(buf).resize(960).webp({ quality: 78 }).toFile(path.join(CROPS, `${s.id}-960.webp`));
  await sharp(buf).resize(400).webp({ quality: 72 }).toFile(path.join(CROPS, `${s.id}-400.webp`));
  const W = 256;
  const { data, info } = await sharp(buf).resize(W).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const f = computeFeatures(data, info.width, info.height, 3);
  vectors[s.id] = {
    v: toVector(f),
    lab: [Math.round(f.L * 10) / 10, Math.round(f.a * 10) / 10, Math.round(f.b * 10) / 10],
    vein: [Math.round(f.veinL * 10) / 10, Math.round(f.veinA * 10) / 10, Math.round(f.veinB * 10) / 10],
    density: Math.round(f.veinDensity * 1000) / 1000,
    contrast: Math.round(f.veinContrast * 10) / 10,
    polarity: Math.round(f.veinPolarity * 100) / 100,
    speckle: Math.round(f.speckle * 1000) / 1000,
    coherence: Math.round(f.coherence * 1000) / 1000,
  };
  // mean colour of the crop for placeholders
  const st = await sharp(buf).stats();
  const hex = (c) => Math.round(c.mean).toString(16).padStart(2, "0");
  s.mean = `#${hex(st.channels[0])}${hex(st.channels[1])}${hex(st.channels[2])}`;
  s.zoomMax = texMeta[s.tex]?.zoom?.maxLevel ?? 2;
}

// ── 4. people, projects, seeds ───────────────────────────
const people = {
  customers: [
    {
      id: "c-levy",
      kind: "private",
      name: { he: "נועה ויואב לוי", en: "Noa & Yoav Levy" },
      role: { he: "לקוחה פרטית", en: "Private client" },
      city: { he: "רמת השרון", en: "Ramat HaSharon" },
      initials: "נל",
    },
    {
      id: "c-alon",
      kind: "architect",
      name: { he: "אדר׳ תמר אלון", en: "Tamar Alon, Architect" },
      role: { he: "אדריכלית · אלון סטודיו", en: "Architect · Alon Studio" },
      city: { he: "תל אביב", en: "Tel Aviv" },
      initials: "תא",
    },
    {
      id: "c-shahar",
      kind: "contractor",
      name: { he: "רוני שחר", en: "Roni Shahar" },
      role: { he: "קבלן · שחר בנייה ויזמות", en: "Contractor · Shahar Build" },
      city: { he: "נתניה", en: "Netanya" },
      initials: "רש",
    },
  ],
  projects: [
    {
      id: "p-levy-kitchen", customerId: "c-levy",
      name: { he: "דירת גן, רמת השרון — מטבח ואי", en: "Garden flat, Ramat HaSharon — kitchen & island" },
      rooms: [
        { id: "r-kitchen", name: { he: "מטבח ואי", en: "Kitchen & island" } },
        { id: "r-bath", name: { he: "חדר רחצה הורים", en: "Main bathroom" } },
      ],
    },
    {
      id: "p-levy-parents", customerId: "c-levy",
      name: { he: "בית ההורים, כפר יונה — חדר רחצה", en: "Parents' house, Kfar Yona — bathroom" },
      rooms: [{ id: "r-bath", name: { he: "חדר רחצה", en: "Bathroom" } }],
    },
    {
      id: "p-alon-villa", customerId: "c-alon",
      name: { he: "וילה בכפר שמריהו — מטבח, לובי ומדרגות", en: "Villa, Kfar Shmaryahu — kitchen, lobby, stair" },
      rooms: [
        { id: "r-kitchen", name: { he: "מטבח", en: "Kitchen" } },
        { id: "r-lobby", name: { he: "לובי כניסה", en: "Entrance lobby" } },
        { id: "r-stair", name: { he: "מדרגות", en: "Staircase" } },
      ],
    },
    {
      id: "p-alon-penthouse", customerId: "c-alon",
      name: { he: "פנטהאוז בנמל תל אביב — רחצה ואח", en: "Penthouse, Tel Aviv Port — baths & fireplace" },
      rooms: [
        { id: "r-bath", name: { he: "חדר רחצה ראשי", en: "Main bathroom" } },
        { id: "r-fire", name: { he: "קיר אח", en: "Fireplace wall" } },
      ],
    },
    {
      id: "p-shahar-netanya", customerId: "c-shahar",
      name: { he: "מגדלי הים, נתניה — 48 יח׳ דיור", en: "Sea Towers, Netanya — 48 units" },
      rooms: [
        { id: "r-kitchen", name: { he: "משטחי מטבח (טיפוסי)", en: "Kitchen tops (typical)" } },
        { id: "r-lobby", name: { he: "לובי כניסה", en: "Entrance lobby" } },
      ],
    },
    {
      id: "p-shahar-lobby", customerId: "c-shahar",
      name: { he: "לובי משרדים, הרצליה פיתוח", en: "Office lobby, Herzliya Pituach" },
      rooms: [
        { id: "r-cladding", name: { he: "חיפוי קירות", en: "Wall cladding" } },
        { id: "r-floor", name: { he: "ריצוף", en: "Flooring" } },
      ],
    },
  ],
};

const byLabel = Object.fromEntries(slabs.map((s) => [s.rack.label, s]));
const findInYard = (tex, not = []) =>
  slabs.find((s) => s.tex === tex && s.rack.rack !== "A" && s.status === "available" && !not.includes(s.id));

const seed = { holds: [], sales: [] };
const hold = (slab, customerId, projectId, roomId, hoursAgo, status, extended = 0) => {
  slab.status = "held";
  seed.holds.push({ slabId: slab.id, customerId, projectId, roomId, hoursAgo, status, extended });
};
const sale = (slab, customerId, projectId, roomId, stage, deliveryInDays, window) => {
  slab.status = "sold";
  seed.sales.push({ slabId: slab.id, customerId, projectId, roomId, stage, deliveryInDays, window });
};
hold(byLabel["A-21"], "c-alon", "p-alon-villa", "r-lobby", 6, "confirmed");
hold(findInYard("statuario-venato"), "c-alon", "p-alon-villa", "r-kitchen", 30, "pending");
hold(findInYard("calacatta-crema"), "c-levy", "p-levy-kitchen", "r-kitchen", 46.5, "confirmed");
hold(findInYard("basalto-etna"), "c-shahar", "p-shahar-lobby", "r-floor", 12, "pending");
hold(findInYard("branco-siena"), "c-shahar", "p-shahar-netanya", "r-kitchen", 2, "confirmed", 1);
hold(findInYard("onice-bianco"), "c-alon", "p-alon-penthouse", "r-bath", 20, "pending");
sale(byLabel["A-16"], "c-alon", "p-alon-villa", "r-kitchen", "polishing", 3, "08:00–11:00");
sale(findInYard("travertino-classico"), "c-shahar", "p-shahar-lobby", "r-cladding", "cutting", 9, "07:00–10:00");
sale(findInYard("santa-cecilia"), "c-shahar", "p-shahar-netanya", "r-kitchen", "ready", 1, "07:00–10:00");
sale(findInYard("carrara-classico"), "c-levy", "p-levy-parents", "r-bath", "delivered", -5, "12:00–15:00");
sale(findInYard("verde-alpi"), "c-alon", "p-alon-penthouse", "r-fire", "cutting", 12, "09:00–12:00");
sale(findInYard("basalto-grigio"), "c-shahar", "p-shahar-lobby", "r-floor", "delivered", -2, "07:00–10:00");

// ── 5. write ─────────────────────────────────────────────
await fs.writeFile(path.join(DATA, "slabs.json"), JSON.stringify(slabs, null, 1));
await fs.writeFile(path.join(DATA, "slab-vectors.json"), JSON.stringify(vectors));
await fs.writeFile(path.join(DATA, "people.json"), JSON.stringify(people, null, 1));
await fs.writeFile(path.join(DATA, "seed.json"), JSON.stringify(seed, null, 1));

const counts = slabs.reduce((acc, s) => ((acc[s.status] = (acc[s.status] ?? 0) + 1), acc), {});
console.log("slabs", slabs.length, counts, "rack A front:", slabs.slice(0, 5).map((s) => s.id).join(" "));
