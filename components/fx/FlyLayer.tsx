"use client";

import { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";
import { cropUrl, SLAB_BY_ID } from "@/lib/data";
import { useDemo } from "@/lib/store";
import { useUi } from "@/lib/ui";

interface Flight {
  id: string;
  slabId: string;
  from: DOMRect;
  to: DOMRect;
  pill?: string;
}

/** In live mode every customer hold flies across the stone hairline into the yard inbox. */
export default function FlyLayer() {
  const events = useDemo((s) => s.events);
  const view = useUi((s) => s.view);
  const seen = useRef<string | null | undefined>(undefined);
  const [flights, setFlights] = useState<Flight[]>([]);

  useEffect(() => {
    const top = events[0]?.id ?? null;
    if (seen.current === undefined) {
      seen.current = top;
      return;
    }
    if (top === seen.current) return;
    const fresh = [];
    for (const e of events) {
      if (e.id === seen.current) break;
      fresh.push(e);
    }
    seen.current = top;
    if (view !== "live") return;
    const lang = useUi.getState().lang;
    for (const e of fresh) {
      if (e.actor !== "customer" || Date.now() - e.real > 4000) continue;
      if (e.type !== "hold.created") {
        // every other client action crosses the hairline as a small pill into the yard's log
        const from = document.querySelector<HTMLElement>('[data-pane="customer"]')?.getBoundingClientRect();
        const to = document.querySelector<HTMLElement>('[data-pane="yard"]')?.getBoundingClientRect();
        if (from && to)
          setFlights((f) => [
            ...f,
            { id: e.id, slabId: e.slabId ?? "", pill: e.text[lang], from: new DOMRect(from.right - 160, from.top + from.height * 0.55, 10, 10), to: new DOMRect(to.left + 24, to.top + 90, 300, 40) },
          ]);
        continue;
      }
      if (!e.slabId) continue;
      const src =
        document.querySelector<HTMLElement>('[data-pane="customer"] [data-ap="hold-chip"]') ??
        document.querySelector<HTMLElement>('[data-pane="customer"] [data-ap="hold"]') ??
        document.querySelector<HTMLElement>('[data-pane="customer"]');
      const dst = document.querySelector<HTMLElement>('[data-pane="yard"] [data-ap="yard-inbox"]');
      if (!src || !dst) continue;
      const to = dst.getBoundingClientRect();
      setFlights((f) => [...f, { id: e.id, slabId: e.slabId!, from: src.getBoundingClientRect(), to: new DOMRect(to.left, to.top, Math.min(to.width, 360), 90) }]);
    }
  }, [events, view]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[160]" aria-hidden="true">
      {flights.map((f) => (
        <FlightCard key={f.id} f={f} done={() => setFlights((x) => x.filter((y) => y.id !== f.id))} />
      ))}
    </div>
  );
}

function FlightCard({ f, done }: { f: Flight; done: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const s = SLAB_BY_ID[f.slabId];
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const x0 = f.from.left + f.from.width / 2 - 120;
    const y0 = f.from.top + f.from.height / 2 - 34;
    const x1 = f.to.left + 8;
    const y1 = f.to.top + 6;
    const ctl = animate(0, 1, {
      duration: reduced ? 0.01 : 1.05,
      ease: [0.65, 0.02, 0.15, 1],
      onUpdate: (p) => {
        const x = x0 + (x1 - x0) * p;
        const y = y0 + (y1 - y0) * p - Math.sin(Math.PI * p) * 120;
        const r = Math.sin(Math.PI * p) * -6;
        el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${r}deg) scale(${1 - Math.sin(Math.PI * p) * 0.08})`;
        el.style.opacity = String(p > 0.9 ? (1 - p) * 10 : 1);
      },
      onComplete: done,
    });
    return () => ctl.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (f.pill)
    return (
      <div ref={ref} className="absolute left-0 top-0 max-w-[300px] truncate border border-carrara bg-basalt px-3 py-2 text-[0.75rem] text-carrara shadow-[0_18px_40px_rgba(0,0,0,.55)]">
        {f.pill}
      </div>
    );
  if (!s) return null;
  return (
    <div ref={ref} className="absolute left-0 top-0 flex w-[240px] items-center gap-3 border border-amber bg-basalt p-2 text-carrara shadow-[0_18px_40px_rgba(0,0,0,.55)]">
      <img src={cropUrl(s.id, 400)} alt="" className="h-12 w-16 object-cover" />
      <div className="min-w-0">
        <p className="font-mono truncate text-[0.7rem]">{s.id}</p>
        <p className="font-mono text-[0.9rem] text-amber">{s.rack.label}</p>
      </div>
    </div>
  );
}
