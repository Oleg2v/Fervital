"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { CUSTOMER_BY_ID, PROJECTS, SEED, SLAB_BY_ID, SLABS } from "./data";
import type {
  Actor,
  DemoEvent,
  EventType,
  Hold,
  Job,
  L10n,
  LayoutAttachment,
  ProjectState,
  QuoteRequest,
  RenderAttachment,
  SlabStatus,
  Stage,
} from "./types";

export const HOUR = 3600_000;
export const HOLD_MS = 48 * HOUR;
const STAGE_ORDER: Stage[] = ["cutting", "polishing", "ready", "delivered"];
const STAGE_TEXT: Record<Stage, L10n> = {
  cutting: { he: "חיתוך", en: "cutting" },
  polishing: { he: "ליטוש", en: "polishing" },
  ready: { he: "מוכן", en: "ready" },
  delivered: { he: "סופק", en: "delivered" },
};

export interface Clock {
  speed: number;
  anchorReal: number;
  anchorSim: number;
}
export const simNow = (c: Clock, real = Date.now()) => c.anchorSim + (real - c.anchorReal) * c.speed;

export interface SlabLive {
  status: SlabStatus;
  holdId?: string;
  soldTo?: string;
  jobId?: string;
}

export interface DemoData {
  version: number;
  rev: number;
  origin: string;
  clock: Clock;
  slabs: Record<string, SlabLive>;
  holds: Hold[];
  jobs: Job[];
  quotes: QuoteRequest[];
  projects: Record<string, ProjectState>;
  events: DemoEvent[];
}

interface DemoActions {
  now: () => number;
  createHold: (slabId: string, customerId: string, projectId?: string | null, roomId?: string | null) => string | null;
  confirmHold: (holdId: string) => void;
  extendHold: (holdId: string, hours?: number) => void;
  releaseHold: (holdId: string, actor?: Actor) => void;
  convertHold: (holdId: string) => string | null;
  advanceJob: (jobId: string) => void;
  setSlot: (jobId: string, day: number, window: string) => void;
  requestQuote: (projectId: string, customerId: string, total: number) => string;
  sendQuote: (quoteId: string) => void;
  addToRoom: (projectId: string, roomId: string, slabId: string) => void;
  removeFromRoom: (projectId: string, roomId: string, slabId: string) => void;
  attachRender: (projectId: string, r: Omit<RenderAttachment, "id" | "createdAt">) => void;
  attachLayout: (projectId: string, l: Omit<LayoutAttachment, "id" | "createdAt">) => void;
  expireDue: () => void;
  setSpeed: (speed: number) => void;
  resetDemo: () => void;
  restoreSlab: (slabId: string) => void;
}

export type DemoStore = DemoData & DemoActions;

export const TAB_ID =
  typeof window === "undefined" ? "server" : Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
const DATA_VERSION = 3;
/** A saved snapshot older than this is from an earlier sitting: start over from the seed (see merge). */
const STALE_MS = 2 * HOUR;

function seedState(): DemoData {
  const now = Date.now();
  const slabs: Record<string, SlabLive> = {};
  for (const s of SLABS) slabs[s.id] = { status: "available" };
  const projects: Record<string, ProjectState> = {};
  for (const p of PROJECTS) {
    projects[p.id] = { id: p.id, rooms: Object.fromEntries(p.rooms.map((r) => [r.id, [] as string[]])), renders: [], layouts: [] };
  }
  const holds: Hold[] = SEED.holds.map((h, i) => {
    const createdAt = now - h.hoursAgo * HOUR;
    const id = `h-seed-${i}`;
    slabs[h.slabId] = { status: "held", holdId: id };
    projects[h.projectId]?.rooms[h.roomId]?.push(h.slabId);
    return {
      id,
      slabId: h.slabId,
      customerId: h.customerId,
      projectId: h.projectId,
      roomId: h.roomId,
      createdAt,
      expiresAt: createdAt + HOLD_MS + h.extended * 24 * HOUR,
      status: h.status,
      extended: h.extended,
    };
  });
  const jobs: Job[] = SEED.sales.map((s, i) => {
    const id = `j-seed-${i}`;
    slabs[s.slabId] = { status: "sold", soldTo: s.customerId, jobId: id };
    projects[s.projectId]?.rooms[s.roomId]?.push(s.slabId);
    return {
      id,
      slabId: s.slabId,
      customerId: s.customerId,
      projectId: s.projectId,
      stage: s.stage,
      createdAt: now - 10 * 24 * HOUR,
      deliverySlot: { day: s.deliveryInDays, window: s.window },
    };
  });
  return {
    version: DATA_VERSION,
    rev: 1,
    origin: TAB_ID,
    clock: { speed: 1, anchorReal: now, anchorSim: now },
    slabs,
    holds,
    jobs,
    quotes: [],
    projects,
    events: [],
  };
}

const who = (customerId: string): L10n => CUSTOMER_BY_ID[customerId]?.name ?? { he: "לקוח", en: "Client" };
const label = (slabId: string) => {
  const s = SLAB_BY_ID[slabId];
  return s ? `${s.id} (${s.rack.label})` : slabId;
};

function makeEvent(
  at: number,
  actor: Actor,
  type: EventType,
  text: L10n,
  extra: Partial<DemoEvent> = {},
): DemoEvent {
  return { id: extra.id ?? uid("e"), at, real: Date.now(), actor, type, text, ...extra };
}

let applyingRemote = false;

export const useDemo = create<DemoStore>()(
  persist(
    (set, get) => {
      /** mutate helper: bumps rev, stamps origin, appends events */
      const commit = (fn: (d: DemoData, now: number) => DemoEvent[] | void) => {
        const draft = structuredClone(pickData(get()));
        const now = simNow(draft.clock);
        const evts = fn(draft, now) || [];
        draft.rev = Math.max(draft.rev, get().rev) + 1;
        draft.origin = TAB_ID;
        if (evts.length) {
          const ids = new Set(draft.events.map((e) => e.id));
          draft.events = [...evts.filter((e) => !ids.has(e.id)).reverse(), ...draft.events].slice(0, 90);
        }
        set(draft);
      };

      return {
        ...seedState(),
        now: () => simNow(get().clock),

        createHold: (slabId, customerId, projectId = null, roomId = null) => {
          const live = get().slabs[slabId];
          if (!live || live.status !== "available") return null;
          const id = uid("h");
          commit((d, now) => {
            d.holds.unshift({
              id,
              slabId,
              customerId,
              projectId,
              roomId,
              createdAt: now,
              expiresAt: now + HOLD_MS,
              status: "pending",
              extended: 0,
            });
            d.slabs[slabId] = { status: "held", holdId: id };
            if (projectId && roomId) {
              const room = d.projects[projectId]?.rooms[roomId];
              if (room && !room.includes(slabId)) room.unshift(slabId);
            }
            const n = who(customerId);
            return [
              makeEvent(now, "customer", "hold.created", {
                he: `${n.he} שריינ/ה את ${label(slabId)} ל-48 שעות`,
                en: `${n.en} put a 48 h hold on ${label(slabId)}`,
              }, { slabId, holdId: id, customerId }),
            ];
          });
          return id;
        },

        confirmHold: (holdId) =>
          commit((d, now) => {
            const h = d.holds.find((x) => x.id === holdId);
            if (!h || h.status !== "pending") return;
            h.status = "confirmed";
            h.touchedAt = now;
            return [
              makeEvent(now, "yard", "hold.confirmed", {
                he: `המחסן אישר את ההחזקה על ${label(h.slabId)}`,
                en: `The yard confirmed the hold on ${label(h.slabId)}`,
              }, { slabId: h.slabId, holdId, customerId: h.customerId }),
            ];
          }),

        extendHold: (holdId, hours = 24) =>
          commit((d, now) => {
            const h = d.holds.find((x) => x.id === holdId);
            if (!h || (h.status !== "pending" && h.status !== "confirmed")) return;
            h.expiresAt += hours * HOUR;
            h.extended += 1;
            h.touchedAt = now;
            return [
              makeEvent(now, "yard", "hold.extended", {
                he: `ההחזקה על ${label(h.slabId)} הוארכה ב-${hours} שעות`,
                en: `Hold on ${label(h.slabId)} extended by ${hours} h`,
              }, { slabId: h.slabId, holdId, customerId: h.customerId }),
            ];
          }),

        releaseHold: (holdId, actor = "yard") =>
          commit((d, now) => {
            const h = d.holds.find((x) => x.id === holdId);
            if (!h || (h.status !== "pending" && h.status !== "confirmed")) return;
            h.status = "released";
            h.touchedAt = now;
            d.slabs[h.slabId] = { status: "available" };
            return [
              makeEvent(now, actor, "hold.released", {
                he: `${label(h.slabId)} שוחרר וחזר למדף`,
                en: `${label(h.slabId)} was released back to the rack`,
              }, { slabId: h.slabId, holdId, customerId: h.customerId }),
            ];
          }),

        convertHold: (holdId) => {
          const h0 = get().holds.find((x) => x.id === holdId);
          if (!h0 || (h0.status !== "pending" && h0.status !== "confirmed")) return null;
          const jobId = uid("j");
          commit((d, now) => {
            const h = d.holds.find((x) => x.id === holdId)!;
            h.status = "converted";
            h.touchedAt = now;
            d.slabs[h.slabId] = { status: "sold", soldTo: h.customerId, jobId };
            d.jobs.unshift({
              id: jobId,
              slabId: h.slabId,
              customerId: h.customerId,
              projectId: h.projectId,
              stage: "cutting",
              createdAt: now,
              deliverySlot: null,
              touchedAt: now,
            });
            const n = who(h.customerId);
            return [
              makeEvent(now, "yard", "hold.converted", {
                he: `${label(h.slabId)} נמכר וסומן בלעדית ל${n.he}`,
                en: `${label(h.slabId)} sold and marked exclusively for ${n.en}`,
              }, { slabId: h.slabId, holdId, jobId, customerId: h.customerId }),
            ];
          });
          return jobId;
        },

        advanceJob: (jobId) =>
          commit((d, now) => {
            const j = d.jobs.find((x) => x.id === jobId);
            if (!j) return;
            const idx = STAGE_ORDER.indexOf(j.stage);
            if (idx >= STAGE_ORDER.length - 1) return;
            j.stage = STAGE_ORDER[idx + 1];
            j.touchedAt = now;
            return [
              makeEvent(now, "yard", "job.advanced", {
                he: `${label(j.slabId)} עבר ל${STAGE_TEXT[j.stage].he}`,
                en: `${label(j.slabId)} moved to ${STAGE_TEXT[j.stage].en}`,
              }, { slabId: j.slabId, jobId, customerId: j.customerId }),
            ];
          }),

        setSlot: (jobId, day, window) =>
          commit((d, now) => {
            const j = d.jobs.find((x) => x.id === jobId);
            if (!j) return;
            j.deliverySlot = { day, window };
            j.touchedAt = now;
            return [
              makeEvent(now, "yard", "job.slot", {
                he: `נקבע חלון אספקה ל-${label(j.slabId)}: ${window}`,
                en: `Delivery window set for ${label(j.slabId)}: ${window}`,
              }, { slabId: j.slabId, jobId, customerId: j.customerId }),
            ];
          }),

        requestQuote: (projectId, customerId, total) => {
          const id = uid("q");
          commit((d, now) => {
            d.quotes.unshift({ id, projectId, customerId, status: "requested", total, createdAt: now });
            const n = who(customerId);
            return [
              makeEvent(now, "customer", "quote.requested", {
                he: `${n.he} ביקש/ה הצעת מחיר`,
                en: `${n.en} requested a quote`,
              }, { quoteId: id, customerId }),
            ];
          });
          return id;
        },

        sendQuote: (quoteId) =>
          commit((d, now) => {
            const q = d.quotes.find((x) => x.id === quoteId);
            if (!q || q.status === "sent") return;
            q.status = "sent";
            q.touchedAt = now;
            return [
              makeEvent(now, "yard", "quote.sent", {
                he: `הצעת מחיר נשלחה ל${who(q.customerId).he}`,
                en: `Quote sent to ${who(q.customerId).en}`,
              }, { quoteId, customerId: q.customerId }),
            ];
          }),

        addToRoom: (projectId, roomId, slabId) =>
          commit((d, now) => {
            const room = d.projects[projectId]?.rooms[roomId];
            if (!room || room.includes(slabId)) return;
            room.unshift(slabId);
            return [
              makeEvent(now, "customer", "project.slab", {
                he: `${label(slabId)} נוסף ללוח הפרויקט`,
                en: `${label(slabId)} added to the project board`,
              }, { slabId }),
            ];
          }),

        removeFromRoom: (projectId, roomId, slabId) =>
          commit((d) => {
            const room = d.projects[projectId]?.rooms[roomId];
            if (!room) return;
            d.projects[projectId].rooms[roomId] = room.filter((x) => x !== slabId);
          }),

        attachRender: (projectId, r) =>
          commit((d, now) => {
            const p = d.projects[projectId];
            if (!p) return;
            p.renders = [{ ...r, id: uid("r"), createdAt: now }, ...p.renders].slice(0, 6);
            return [
              makeEvent(now, "customer", "project.render", {
                he: `הדמיית מטבח עם ${label(r.slabId)} צורפה לפרויקט`,
                en: `Kitchen render with ${label(r.slabId)} attached to the project`,
              }, { slabId: r.slabId }),
            ];
          }),

        attachLayout: (projectId, l) =>
          commit((d, now) => {
            const p = d.projects[projectId];
            if (!p) return;
            p.layouts = [{ ...l, id: uid("l"), createdAt: now }, ...p.layouts].slice(0, 6);
            return [
              makeEvent(now, "customer", "project.layout", {
                he: `פריסת ניצולת (${l.slabs} לוחות, ${l.yieldPct}%) צורפה לפרויקט`,
                en: `Yield layout (${l.slabs} slabs, ${l.yieldPct}%) attached to the project`,
              }, { slabId: l.slabId }),
            ];
          }),

        expireDue: () => {
          const s = get();
          const now = simNow(s.clock);
          const due = s.holds.filter((h) => (h.status === "pending" || h.status === "confirmed") && h.expiresAt <= now);
          if (!due.length) return;
          commit((d) =>
            due.map((h0) => {
              const h = d.holds.find((x) => x.id === h0.id)!;
              h.status = "expired";
              d.slabs[h.slabId] = { status: "available" };
              return makeEvent(h.expiresAt, "system", "hold.expired", {
                he: `ההחזקה על ${label(h.slabId)} פגה — הלוח חזר למדף`,
                en: `Hold on ${label(h.slabId)} expired, the slab is back on the rack`,
              }, { id: `exp-${h.id}`, slabId: h.slabId, holdId: h.id, customerId: h.customerId });
            }),
          );
        },

        setSpeed: (speed) =>
          commit((d) => {
            const real = Date.now();
            d.clock = { speed, anchorReal: real, anchorSim: simNow(d.clock, real) };
          }),

        resetDemo: () => {
          const fresh = seedState();
          fresh.rev = get().rev + 1;
          fresh.events = [
            makeEvent(fresh.clock.anchorSim, "system", "demo.reset", { he: "הדמו אופס", en: "Demo reset" }),
          ];
          set(fresh);
        },

        /** Soft reset of one slab (used by the autopilot so it can run again and again). */
        restoreSlab: (slabId) =>
          commit((d) => {
            d.holds = d.holds.filter((h) => h.slabId !== slabId);
            d.jobs = d.jobs.filter((j) => j.slabId !== slabId);
            d.slabs[slabId] = { status: "available" };
            for (const p of Object.values(d.projects)) {
              for (const k of Object.keys(p.rooms)) p.rooms[k] = p.rooms[k].filter((x) => x !== slabId);
              p.renders = p.renders.filter((r) => r.slabId !== slabId);
            }
          }),
      };
    },
    {
      name: "fervital-demo",
      version: DATA_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ ...pickData(s), savedAt: Date.now() }),
      migrate: () => seedState() as unknown as DemoStore,
      merge: (persisted, current) => {
        const p = persisted as (Partial<DemoData> & { savedAt?: number }) | undefined;
        if (!p || p.version !== DATA_VERSION) return current;
        const { savedAt = 0, ...data } = p;
        const now = Date.now();
        // holds and the clock are wall-clock stamps: a snapshot from an earlier sitting would replay the
        // closed time on the first expireDue tick and expire the seed holds at once (snapshots saved
        // before savedAt existed count as stale too, so they re-seed once)
        if (now - savedAt > STALE_MS) return current;
        // a fast demo clock must not multiply the time the page was closed
        if (data.clock && data.clock.speed !== 1) {
          data.clock = { speed: 1, anchorReal: now, anchorSim: simNow(data.clock, savedAt) + (now - savedAt) };
        }
        return { ...current, ...data };
      },
    },
  ),
);

export function pickData(s: DemoData): DemoData {
  return {
    version: s.version,
    rev: s.rev,
    origin: s.origin,
    clock: s.clock,
    slabs: s.slabs,
    holds: s.holds,
    jobs: s.jobs,
    quotes: s.quotes,
    projects: s.projects,
    events: s.events,
  };
}

// ── cross-tab sync ─────────────────────────────────────────
let channel: BroadcastChannel | null = null;
let started = false;

export function startSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  if ("BroadcastChannel" in window) {
    channel = new BroadcastChannel("fervital-demo-sync");
    channel.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type: string; from: string; data?: DemoData };
      if (!msg || msg.from === TAB_ID) return;
      if (msg.type === "state" && msg.data) applyRemote(msg.data);
      if (msg.type === "hello") {
        channel?.postMessage({ type: "state", from: TAB_ID, data: pickData(useDemo.getState()) });
      }
    };
    channel.postMessage({ type: "hello", from: TAB_ID });
  }
  // fallback / belt-and-braces: storage events from other tabs
  window.addEventListener("storage", (e) => {
    if (e.key !== "fervital-demo" || !e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue) as { state: DemoData };
      if (parsed?.state) applyRemote(parsed.state);
    } catch {
      /* ignore */
    }
  });
  useDemo.subscribe((state, prev) => {
    if (applyingRemote || state.rev === prev.rev) return;
    channel?.postMessage({ type: "state", from: TAB_ID, data: pickData(state) });
  });
}

function applyRemote(remote: DemoData) {
  const local = useDemo.getState();
  if (remote.version !== DATA_VERSION) return;
  if (remote.rev < local.rev) return;
  if (remote.rev === local.rev && remote.origin <= local.origin) return;
  applyingRemote = true;
  useDemo.setState(remote);
  applyingRemote = false;
}

// ── selectors ──────────────────────────────────────────────
export const activeHoldFor = (s: DemoData, slabId: string) =>
  s.holds.find((h) => h.slabId === slabId && (h.status === "pending" || h.status === "confirmed"));

export function formatCountdown(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
