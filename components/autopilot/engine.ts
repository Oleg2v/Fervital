"use client";

import { create } from "zustand";
import { AUTOPILOT_SLAB_ID } from "@/lib/data";
import { anim, useRack } from "@/lib/rack";
import { useDemo } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { kitchenApi } from "@/components/sections/KitchenStudio";

export type Side = "customer" | "yard";
export interface CursorState {
  x: number;
  y: number;
  visible: boolean;
  pressed: boolean;
  click: number;
}
interface CursorStore {
  customer: CursorState;
  yard: CursorState;
  set: (side: Side, p: Partial<CursorState>) => void;
}
export const useCursors = create<CursorStore>()((set) => ({
  customer: { x: 0, y: 0, visible: false, pressed: false, click: 0 },
  yard: { x: 0, y: 0, visible: false, pressed: false, click: 0 },
  set: (side, p) => set((s) => ({ [side]: { ...s[side], ...p } }) as Partial<CursorStore>),
}));

class Aborted extends Error {}

let token = 0;
let skipFrom = -100;

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const ap = () => useUi.getState().autopilot;

/** Wait that respects pause / skip / stop. */
function wait(ms: number, my: number, step: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let acc = 0;
    let last = performance.now();
    const tick = () => {
      if (my !== token) return reject(new Aborted());
      const now = performance.now();
      if (!ap().paused) acc += now - last;
      last = now;
      if (acc >= ms || skipFrom >= step) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function paneRoot(side: Side): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-pane="${side}"]`);
}

async function find(side: Side, sel: string, my: number, step: number, timeout = 6000): Promise<HTMLElement> {
  const t0 = performance.now();
  for (;;) {
    if (my !== token) throw new Aborted();
    const root = paneRoot(side) ?? document.body;
    const el = root.querySelector<HTMLElement>(`[data-ap="${sel}"]`) ?? document.querySelector<HTMLElement>(`[data-ap="${sel}"]`);
    if (el && el.getClientRects().length) return el;
    if (performance.now() - t0 > timeout) throw new Error(`autopilot: ${sel} not found`);
    await wait(80, my, step);
  }
}

function ensureVisible(el: HTMLElement) {
  const scroller = el.closest<HTMLElement>("[data-scroller]");
  const r = el.getBoundingClientRect();
  if (scroller) {
    const sr = scroller.getBoundingClientRect();
    if (r.top < sr.top + 60 || r.bottom > sr.bottom - 60) {
      scroller.scrollTo({ top: scroller.scrollTop + (r.top - sr.top) - sr.height / 2 + r.height / 2, behavior: reduced() ? "auto" : "smooth" });
    }
  } else if (r.top < 80 || r.bottom > window.innerHeight - 40) {
    el.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
  }
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

async function glide(side: Side, x: number, y: number, ms: number, my: number, step: number) {
  const cur = useCursors.getState()[side];
  if (!cur.visible || reduced() || skipFrom >= step) {
    useCursors.getState().set(side, { x, y, visible: true });
    return;
  }
  const x0 = cur.x, y0 = cur.y;
  // slight arc, like a hand
  const mx = (x0 + x) / 2 + (y - y0) * 0.12;
  const my2 = (y0 + y) / 2 - Math.abs(x - x0) * 0.08;
  const t0 = performance.now();
  let pausedFor = 0;
  let pauseStart = 0;
  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (my !== token) return reject(new Aborted());
      const now = performance.now();
      if (ap().paused) {
        if (!pauseStart) pauseStart = now;
        return requestAnimationFrame(tick);
      }
      if (pauseStart) {
        pausedFor += now - pauseStart;
        pauseStart = 0;
      }
      const p = Math.min(1, (now - t0 - pausedFor) / ms);
      const e = ease(p);
      const bx = (1 - e) * (1 - e) * x0 + 2 * (1 - e) * e * mx + e * e * x;
      const by = (1 - e) * (1 - e) * y0 + 2 * (1 - e) * e * my2 + e * e * y;
      useCursors.getState().set(side, { x: bx, y: by });
      if (p >= 1 || skipFrom >= step) {
        useCursors.getState().set(side, { x, y });
        return resolve();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function moveTo(side: Side, el: HTMLElement, ms: number, my: number, step: number, at: [number, number] = [0.5, 0.5]) {
  ensureVisible(el);
  await wait(skipFrom >= step ? 0 : 320, my, step);
  const r = el.getBoundingClientRect();
  await glide(side, r.left + r.width * at[0], r.top + r.height * at[1], ms, my, step);
}

async function press(side: Side, my: number, step: number) {
  useCursors.getState().set(side, { pressed: true, click: useCursors.getState()[side].click + 1 });
  await wait(160, my, step);
  useCursors.getState().set(side, { pressed: false });
}

async function clickEl(side: Side, sel: string, my: number, step: number, glideMs = 850) {
  const el = await find(side, sel, my, step);
  await moveTo(side, el, glideMs, my, step);
  await press(side, my, step);
  (await find(side, sel, my, step)).click();
}

// ── the script ──────────────────────────────────────────────
type StepFn = (my: number, step: number) => Promise<void>;
const SLAB = AUTOPILOT_SLAB_ID;

const STEPS: StepFn[] = [
  // 1 · pull a slab off the rack
  async (my, step) => {
    const rack = await find("customer", "rack", my, step);
    const r = rack.getBoundingClientRect();
    const sx = r.left + r.width * 0.32;
    const sy = r.top + r.height * 0.5;
    await glide("customer", sx, sy, 900, my, step);
    useCursors.getState().set("customer", { pressed: true });
    useRack.setState({ pullTarget: 1, dragging: false });
    const railx = anim.rail.x || 300;
    const raily = anim.rail.y || 40;
    await glide("customer", sx + railx * 0.5, sy + raily * 0.5, 900, my, step);
    useCursors.getState().set("customer", { pressed: false });
    const t0 = performance.now();
    const webgl = useUi.getState().tier === "webgl";
    while (webgl && anim.pull < 0.95 && performance.now() - t0 < 4000 && skipFrom < step) await wait(60, my, step);
    if (skipFrom >= step) {
      anim.pull = 1;
      anim.pullVel = 0;
    }
    await wait(600, my, step);
  },
  // 2 · bookmatch
  async (my, step) => {
    await clickEl("customer", "bookmatch", my, step);
    await wait(1900, my, step);
  },
  // 3 · my kitchen in stone
  async (my, step) => {
    await clickEl("customer", "kitchen", my, step);
    try {
      await wait(350, my, step);
      const run = kitchenApi.current?.runSample("kitchen");
      // the designed skeleton + pour run inside the studio
      const stage = await find("customer", "kitchen-stage", my, step);
      await moveTo("customer", stage, 700, my, step, [0.62, 0.42]);
      if (run) await Promise.race([run, wait(7000, my, step)]);
      await wait(400, my, step);
      const handle = await find("customer", "compare", my, step, 3000);
      await moveTo("customer", handle, 500, my, step);
      useCursors.getState().set("customer", { pressed: true });
      const st = stage.getBoundingClientRect();
      // drive the slider continuously while the cursor moves
      const follow = window.setInterval(() => {
        const c = useCursors.getState().customer;
        kitchenApi.current?.setCompare(Math.min(1, Math.max(0, (c.x - st.left) / st.width)));
      }, 16);
      try {
        await glide("customer", st.left + st.width * 0.12, st.top + st.height * 0.5, 750, my, step);
        await glide("customer", st.left + st.width * 0.88, st.top + st.height * 0.5, 1050, my, step);
        await glide("customer", st.left + st.width * 0.55, st.top + st.height * 0.5, 550, my, step);
      } finally {
        window.clearInterval(follow);
        useCursors.getState().set("customer", { pressed: false });
      }
      await clickEl("customer", "kitchen-attach", my, step, 550);
      await wait(500, my, step);
    } finally {
      useUi.getState().setKitchenOpen(false);
    }
    await wait(450, my, step);
  },
  // 4 · hold for 48 hours
  async (my, step) => {
    await clickEl("customer", "hold", my, step);
    await wait(1250, my, step);
  },
  // 5 · the hold lands on the yard desk
  async (my, step) => {
    const card = await find("yard", `inbox-${SLAB}`, my, step);
    if (!useCursors.getState().yard.visible) {
      const yr = paneRoot("yard")?.getBoundingClientRect();
      if (yr) useCursors.getState().set("yard", { x: yr.left + yr.width * 0.7, y: yr.top + yr.height * 0.6, visible: true });
    }
    await moveTo("yard", card, 800, my, step, [0.3, 0.25]);
    await wait(1000, my, step);
  },
  // 6 · the yard confirms
  async (my, step) => {
    await clickEl("yard", `confirm-${SLAB}`, my, step, 650);
    await wait(1300, my, step);
  },
  // 7 · converted to sale — marked exclusively
  async (my, step) => {
    await clickEl("yard", `convert-${SLAB}`, my, step, 650);
    await wait(600, my, step);
    try {
      const tile = await find("yard", `wall-${SLAB}`, my, step, 1500);
      await moveTo("yard", tile, 700, my, step);
    } catch {
      /* wall may be off-screen in tight panes */
    }
    await wait(600, my, step);
  },
  // 8 · your slab
  async (my, step) => {
    useUi.getState().setYourSlab(SLAB);
    useCursors.getState().set("yard", { visible: false });
    await wait(3800, my, step);
  },
];

export async function startAutopilot() {
  const my = ++token;
  skipFrom = -100;
  const ui = useUi.getState();
  ui.setAutopilot({ running: true, paused: false, step: -1, total: STEPS.length, done: false });
  // reset the stage so the run is repeatable
  ui.openZoom(null);
  ui.setKitchenOpen(false);
  ui.setYourSlab(null);
  ui.setPersona("c-alon");
  ui.setProject("p-alon-villa");
  ui.setKitchenSlab(SLAB);
  useDemo.getState().restoreSlab(SLAB);
  if (useDemo.getState().clock.speed !== 1) useDemo.getState().setSpeed(1);
  useRack.setState({ pullTarget: 0, bookmatch: false, index: 0, override: null, busy: false, dragging: false });
  try {
    if (ui.view !== "live") {
      ui.triggerWipe(ui.lang === "he" ? "מצב חי" : "Live");
      await wait(420, my, -1);
      useUi.getState().setView("live");
      window.scrollTo({ top: 0 });
      await wait(1100, my, -1);
    } else {
      document.querySelectorAll<HTMLElement>("[data-scroller]").forEach((s) => s.scrollTo({ top: 0 }));
      await wait(900, my, -1);
    }
    const c = paneRoot("customer")?.getBoundingClientRect();
    if (c) useCursors.getState().set("customer", { x: c.left + c.width * 0.5, y: c.top + c.height * 0.7, visible: true });
    for (let i = 0; i < STEPS.length; i++) {
      if (my !== token) return;
      useUi.getState().setAutopilot({ step: i });
      try {
        await STEPS[i](my, i);
      } catch (e) {
        // a missing target must never strand the demo: log, release the cursor, move on
        if (e instanceof Aborted) throw e;
        console.warn(e);
        useCursors.getState().set("customer", { pressed: false });
      }
    }
    useUi.getState().setAutopilot({ done: true });
  } catch (e) {
    if (!(e instanceof Aborted)) console.warn(e);
  } finally {
    if (my === token) {
      useCursors.getState().set("customer", { visible: false, pressed: false });
      useCursors.getState().set("yard", { visible: false, pressed: false });
      useUi.getState().setAutopilot({ running: false, paused: false });
    }
  }
}

export function pauseAutopilot(p: boolean) {
  useUi.getState().setAutopilot({ paused: p });
}
export function skipStep() {
  skipFrom = Math.max(skipFrom, useUi.getState().autopilot.step);
}
export function stopAutopilot() {
  token++;
  useCursors.getState().set("customer", { visible: false, pressed: false });
  useCursors.getState().set("yard", { visible: false, pressed: false });
  useUi.getState().setAutopilot({ running: false, paused: false, step: -1, done: false });
}
