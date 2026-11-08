"use client";

import type Lenis from "lenis";
import { useUi } from "@/lib/ui";
import { presentSlab, useRack } from "@/lib/rack";

let lenis: Lenis | null = null;
export const setLenis = (l: Lenis | null) => {
  lenis = l;
};
export const getLenis = () => lenis;

/** Scroll the right scroller (window via Lenis, or the client pane in live mode). */
export function scrollToId(id: string, opts: { offset?: number; immediate?: boolean } = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  const pane = el.closest<HTMLElement>("[data-scroller]");
  const offset = opts.offset ?? -64;
  if (pane && pane.scrollHeight > pane.clientHeight + 4 && getComputedStyle(pane).overflowY !== "visible") {
    const top = el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop + offset;
    pane.scrollTo({ top, behavior: opts.immediate ? "auto" : "smooth" });
    return;
  }
  if (lenis) {
    lenis.scrollTo(el, { offset, immediate: opts.immediate, duration: 1.4, easing: (t) => 1 - Math.pow(1 - t, 4) });
  } else {
    const top = el.getBoundingClientRect().top + window.scrollY + offset;
    window.scrollTo({ top, behavior: opts.immediate ? "auto" : "smooth" });
  }
}

export function resetDemoWithWipe(label: string) {
  useUi.getState().triggerWipe(label);
  window.setTimeout(async () => {
    const { useDemo } = await import("@/lib/store");
    useDemo.getState().resetDemo();
    useUi.getState().setYourSlab(null);
  }, 420);
}

export function goKitchen(slabId: string) {
  const ui = useUi.getState();
  ui.setKitchenSlab(slabId);
  if (ui.view === "live") ui.setKitchenOpen(true);
  else scrollToId("kitchen");
}

/** From anywhere (search results, portal, yard wall): bring a slab to the front of the rack. */
export function pullFromRack(slabId: string) {
  const ui = useUi.getState();
  if (ui.view === "yard") ui.setView("customer");
  const scrollDriven = useRack.getState().scrollDriven && ui.view === "customer";
  if (scrollDriven) {
    // the hero maps scroll → pull, so park the slab at the front and scroll to the pulled-out position
    useRack.getState().showSlab(slabId);
    const el = document.getElementById("rack");
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const target = top + (el.offsetHeight - window.innerHeight) * 0.72;
    if (lenis) lenis.scrollTo(target, { duration: 1.6, easing: (t) => 1 - Math.pow(1 - t, 4) });
    else window.scrollTo({ top: target, behavior: "smooth" });
    return;
  }
  scrollToId("rack", { offset: 0 });
  window.setTimeout(() => presentSlab(slabId), 450);
}
