"use client";

import { create } from "zustand";
import { RACK_A, SLAB_BY_ID } from "./data";
import type { Slab } from "./types";

export const RACK_SIZE = RACK_A.length; // 40
export const GAP = 0.36; // metres between partitions

/**
 * Animated values live outside React: the R3F frame loop integrates them and
 * DOM overlays read them in their own rAF. Discrete state lives in the store.
 */
export const anim = {
  pull: 0, // 0 = in the rack, 1 = out and facing the camera
  pullVel: 0,
  sway: 0, // pendulum angle of the hanging partition (rad)
  swayVel: 0,
  camIndex: 0, // continuous index the camera is parked at
  camVel: 0,
  book: 0, // bookmatch hinge 0..1
  bookVel: 0,
  rail: { x: 0, y: 0 }, // on-screen direction of the rail (px per unit pull)
  ready: false,
};

interface RackState {
  index: number;
  override: string | null;
  pullTarget: number;
  pulledOut: boolean; // pull settled past threshold → overlay
  bookmatch: boolean;
  busy: boolean;
  dragging: boolean;
  scrollDriven: boolean;
  setIndex: (i: number) => void;
  setPullTarget: (v: number) => void;
  setPulledOut: (v: boolean) => void;
  setBookmatch: (v: boolean) => void;
  setDragging: (v: boolean) => void;
  setScrollDriven: (v: boolean) => void;
  showSlab: (id: string) => void;
}

export const useRack = create<RackState>()((set) => ({
  index: 0,
  override: null,
  pullTarget: 0,
  pulledOut: false,
  bookmatch: false,
  busy: false,
  dragging: false,
  scrollDriven: true,
  setIndex: (index) => set({ index: ((index % RACK_SIZE) + RACK_SIZE) % RACK_SIZE }),
  setPullTarget: (pullTarget) => set({ pullTarget }),
  setPulledOut: (pulledOut) => set({ pulledOut }),
  setBookmatch: (bookmatch) => set({ bookmatch }),
  setDragging: (dragging) => set({ dragging }),
  setScrollDriven: (scrollDriven) => set({ scrollDriven }),
  showSlab: (id) => {
    const inA = RACK_A.findIndex((s) => s.id === id);
    if (inA >= 0) set({ index: inA, override: null });
    else set({ override: id });
  },
}));

export function frontSlab(state = useRack.getState()): Slab {
  if (state.override && SLAB_BY_ID[state.override]) return SLAB_BY_ID[state.override];
  return RACK_A[state.index];
}

const until = (cond: () => boolean, timeout = 4000) =>
  new Promise<void>((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      if (cond() || performance.now() - t0 > timeout) resolve();
      else requestAnimationFrame(tick);
    };
    tick();
  });

export async function pullOut() {
  useRack.setState({ pullTarget: 1 });
  await until(() => anim.pull > 0.97);
}

export async function pushIn() {
  useRack.setState({ pullTarget: 0, bookmatch: false });
  await until(() => anim.pull < 0.03);
}

/** Release the current slab, walk to the next one and pull it. */
export async function cycle(dir: 1 | -1, andPull = true) {
  const s = useRack.getState();
  if (s.busy) return;
  useRack.setState({ busy: true });
  const wasOut = anim.pull > 0.5 || s.pullTarget > 0.5;
  if (wasOut) await pushIn();
  const st = useRack.getState();
  const nextIndex = st.override ? st.index : (((st.index + dir) % RACK_SIZE) + RACK_SIZE) % RACK_SIZE;
  useRack.setState({ index: nextIndex, override: null });
  await until(() => Math.abs(anim.camIndex - nextIndex) < 0.03 || Math.abs(anim.camIndex - nextIndex) > RACK_SIZE - 1, 2500);
  if (wasOut && andPull) await pullOut();
  useRack.setState({ busy: false });
}

/** Bring an arbitrary slab (e.g. from a search result) to the front and pull it. */
export async function presentSlab(id: string) {
  const st = useRack.getState();
  if (st.busy) return;
  useRack.setState({ busy: true });
  if (anim.pull > 0.05) await pushIn();
  useRack.getState().showSlab(id);
  await until(() => Math.abs(anim.camIndex - useRack.getState().index) < 0.05, 3000);
  await pullOut();
  useRack.setState({ busy: false });
}
