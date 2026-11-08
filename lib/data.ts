import slabsJson from "@/data/slabs.json";
import peopleJson from "@/data/people.json";
import seedJson from "@/data/seed.json";
import texturesJson from "@/data/textures.json";
import type { Customer, Lang, ProjectDef, Slab } from "./types";

export const SLABS = slabsJson as unknown as Slab[];
export const SLAB_BY_ID: Record<string, Slab> = Object.fromEntries(SLABS.map((s) => [s.id, s]));
export const RACK_A: Slab[] = SLABS.filter((s) => s.rack.rack === "A").sort((a, b) => a.rack.slot - b.rack.slot);
export const CUSTOMERS = peopleJson.customers as Customer[];
export const CUSTOMER_BY_ID: Record<string, Customer> = Object.fromEntries(CUSTOMERS.map((c) => [c.id, c]));
export const PROJECTS = peopleJson.projects as ProjectDef[];
export const PROJECT_BY_ID: Record<string, ProjectDef> = Object.fromEntries(PROJECTS.map((p) => [p.id, p]));
export const SEED = seedJson as {
  holds: {
    slabId: string;
    customerId: string;
    projectId: string;
    roomId: string;
    hoursAgo: number;
    status: "pending" | "confirmed";
    extended: number;
  }[];
  sales: {
    slabId: string;
    customerId: string;
    projectId: string;
    roomId: string;
    stage: "cutting" | "polishing" | "ready" | "delivered";
    deliveryInDays: number;
    window: string;
  }[];
};

export interface TextureMeta {
  key: string;
  family: string;
  tiers: string[];
  normal: string[];
  zoom: { tile: number; maxLevel: number; size: number; levels: number };
  mean: string;
  source: { library: string; asset: string; url: string; license: string; resolution: string };
}
export const TEXTURES: Record<string, TextureMeta> = Object.fromEntries(
  (texturesJson as TextureMeta[]).map((t) => [t.key, t]),
);

export const AUTOPILOT_SLAB_ID = RACK_A[0].id;

export const texUrl = (tex: string, tier: "c512" | "c1k" | "c2k" | "c4k" | "n1k" | "n2k") => `/tex/${tex}/${tier}.webp`;
export const cropUrl = (id: string, size: 400 | 960 = 960) => `/tex/_s/${id}-${size}.webp`;
export const tileUrl = (tex: string, level: number, x: number, y: number) => `/tex/${tex}/tiles/${level}/${x}_${y}.webp`;

/** The slab cut right after this one from the same block — its bookmatch twin. */
export function twinOf(slab: Slab): Slab {
  const sameBlock = SLABS.filter((s) => s.block === slab.block).sort((a, b) => a.seq - b.seq);
  const next = sameBlock.find((s) => s.seq === slab.seq + 1) ?? sameBlock.find((s) => s.seq === slab.seq - 1);
  return next ?? slab;
}

export const slabName = (s: Slab, lang: Lang) => s.name[lang];
export const dimsLabel = (s: Slab) => `${s.lengthMm.toLocaleString("en-US")} × ${s.heightMm.toLocaleString("en-US")}`;

export const STAGES = ["cutting", "polishing", "ready", "delivered"] as const;
