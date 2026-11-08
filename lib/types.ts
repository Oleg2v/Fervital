export type Lang = "he" | "en";
export type L10n = { he: string; en: string };

export type Finish = "polished" | "honed" | "leathered";
export type FamilyKey =
  | "carrara"
  | "calacatta"
  | "statuario"
  | "nero-marquina"
  | "verde-alpi"
  | "travertino"
  | "onyx"
  | "granite"
  | "basalt";
export type StoneKind = "marble" | "travertine" | "onyx" | "granite" | "basalt";
export type SlabStatus = "available" | "held" | "sold";

export interface SlabCrop {
  u: number;
  v: number;
  w: number;
  h: number;
  rot: 0 | 180;
}

export interface Slab {
  id: string;
  tex: string;
  family: FamilyKey;
  kind: StoneKind;
  name: L10n;
  origin: L10n;
  finish: Finish;
  lengthMm: number;
  heightMm: number;
  thicknessMm: number;
  areaM2: number;
  block: string;
  seq: number;
  blockSize: number;
  priceM2: number;
  crop: SlabCrop;
  desc: L10n;
  status: SlabStatus;
  rack: { rack: "A" | "B" | "C"; slot: number; label: string };
  hero: boolean;
  mean: string;
  zoomMax: number;
}

export interface Customer {
  id: string;
  kind: "private" | "architect" | "contractor";
  name: L10n;
  role: L10n;
  city: L10n;
  initials: string;
}

export interface ProjectDef {
  id: string;
  customerId: string;
  name: L10n;
  rooms: { id: string; name: L10n }[];
}

export type HoldStatus = "pending" | "confirmed" | "released" | "expired" | "converted";
export interface Hold {
  id: string;
  slabId: string;
  customerId: string;
  projectId: string | null;
  roomId: string | null;
  createdAt: number;
  expiresAt: number;
  status: HoldStatus;
  extended: number;
  /** sim-time of the last yard action, for the amber flash */
  touchedAt?: number;
}

export type Stage = "cutting" | "polishing" | "ready" | "delivered";
export interface Job {
  id: string;
  slabId: string;
  customerId: string;
  projectId: string | null;
  stage: Stage;
  createdAt: number;
  deliverySlot: { day: number; window: string } | null;
  touchedAt?: number;
}

export interface RenderAttachment {
  id: string;
  slabId: string;
  scene: string;
  thumb: string; // data URL (small)
  createdAt: number;
}

export interface LayoutAttachment {
  id: string;
  slabId: string;
  slabs: number;
  yieldPct: number;
  wasteM2: number;
  seams: number;
  total: number;
  summary: L10n;
  createdAt: number;
}

export interface QuoteRequest {
  id: string;
  projectId: string;
  customerId: string;
  status: "requested" | "sent";
  total: number;
  createdAt: number;
  touchedAt?: number;
}

export interface ProjectState {
  id: string;
  rooms: Record<string, string[]>; // roomId -> slabIds
  renders: RenderAttachment[];
  layouts: LayoutAttachment[];
}

export type Actor = "customer" | "yard" | "system";
export type EventType =
  | "hold.created"
  | "hold.confirmed"
  | "hold.extended"
  | "hold.released"
  | "hold.expired"
  | "hold.converted"
  | "job.advanced"
  | "job.slot"
  | "quote.requested"
  | "quote.sent"
  | "project.slab"
  | "project.render"
  | "project.layout"
  | "demo.reset";

export interface DemoEvent {
  id: string;
  at: number; // sim time
  real: number; // wall clock, for animations across tabs
  actor: Actor;
  type: EventType;
  slabId?: string;
  holdId?: string;
  jobId?: string;
  quoteId?: string;
  customerId?: string;
  text: L10n;
}
