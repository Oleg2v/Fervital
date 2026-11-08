"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { simNow, useDemo } from "./store";
import type { DemoEvent } from "./types";

/** Simulated "now", re-rendering every `ms`. */
export function useSimNow(ms = 1000) {
  const clock = useDemo((s) => s.clock);
  const [now, setNow] = useState(() => simNow(clock));
  useEffect(() => {
    setNow(simNow(clock));
    const id = setInterval(() => setNow(simNow(clock)), ms);
    return () => clearInterval(id);
  }, [clock, ms]);
  return now;
}

export function useMediaQuery(q: string, fallback = false) {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === "undefined") return () => {};
      const m = window.matchMedia(q);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => (typeof window === "undefined" ? fallback : window.matchMedia(q).matches),
    () => fallback,
  );
}

export const useReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)");

function useArrival(actor: DemoEvent["actor"], match: (e: DemoEvent) => boolean): number {
  const events = useDemo((s) => s.events);
  const seen = useRef<string | null | undefined>(undefined);
  const matchRef = useRef(match);
  matchRef.current = match;
  const [k, setK] = useState(0);
  useEffect(() => {
    const topId = events[0]?.id ?? null;
    if (seen.current === undefined) {
      seen.current = topId;
      return;
    }
    if (topId === seen.current) return;
    const fresh: DemoEvent[] = [];
    for (const e of events) {
      if (e.id === seen.current) break;
      fresh.push(e);
    }
    seen.current = topId;
    if (fresh.some((e) => e.actor === actor && Date.now() - e.real < 8000 && matchRef.current(e))) setK((x) => x + 1);
  }, [events, actor]);
  return k;
}

/**
 * Amber flash on the client side: a key that changes whenever the yard acts on
 * something this element shows (CSS animation restarts on key change, 1.2 s).
 */
export const useYardFlash = (match: (e: DemoEvent) => boolean) => useArrival("yard", match);

/** On the yard side: customer actions arriving. */
export const useCustomerArrival = (match: (e: DemoEvent) => boolean) => useArrival("customer", match);

export function useHydrated() {
  const [h, setH] = useState(false);
  useEffect(() => setH(true), []);
  return h;
}
