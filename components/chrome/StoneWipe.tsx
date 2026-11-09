"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useUi } from "@/lib/ui";
import { useReducedMotion } from "@/lib/hooks";

// A chiselled stone edge: the leading edge of a slab sliding across the page.
const EDGE =
  "M0 0 L60 0 L52 6 L64 13 L49 22 L61 31 L55 38 L67 47 L50 55 L63 64 L54 71 L66 80 L51 88 L62 94 L56 100 L0 100 Z";

export default function StoneWipe() {
  const n = useUi((s) => s.wipe.n);
  const label = useUi((s) => s.wipe.label);
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const panel = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (n === 0 || !panel.current) return;
    const el = panel.current;
    if (reducedRef.current) {
      setShown(true);
      gsap.fromTo(el, { opacity: 1, xPercent: 0 }, { opacity: 0, duration: 0.35, delay: 0.4, onComplete: () => setShown(false) });
      return;
    }
    setShown(true);
    // RTL: the slab enters from the inline-start (right) edge. The direction is fixed when the wipe starts:
    // the language toggle calls setLang at full cover, and that must not restart the wipe from the far side.
    const dir = useUi.getState().lang === "he" ? -1 : 1;
    const from = dir === -1 ? 112 : -112;
    const tl = gsap.timeline({ onComplete: () => setShown(false) });
    tl.set(el, { xPercent: from, opacity: 1 })
      .to(el, { xPercent: 0, duration: 0.42, ease: "power3.in" })
      .to(el, { xPercent: -from, duration: 0.62, ease: "power3.out", delay: 0.08 });
    return () => {
      tl.kill();
    };
  }, [n]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[150] overflow-hidden" aria-hidden="true" style={{ visibility: shown ? "visible" : "hidden" }}>
      <div ref={panel} className="absolute inset-y-0 -left-[8vw] w-[116vw]" style={{ opacity: 0 }}>
        {/* the slab face: basalt scan, darkened */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: "linear-gradient(#0e0e0ed9, #0e0e0ee6), url(/tex/basalto-etna/c1k.webp)",
            backgroundSize: "cover, 900px",
          }}
        />
        {/* chiselled edges on both sides, with a hairline vein */}
        <svg className="absolute inset-y-0 -left-[59px] h-full w-[60px]" viewBox="0 0 60 100" preserveAspectRatio="none">
          <path d={EDGE} fill="#0e0e0e" transform="translate(60 0) scale(-1 1)" />
        </svg>
        <svg className="absolute inset-y-0 -right-[59px] h-full w-[60px]" viewBox="0 0 60 100" preserveAspectRatio="none">
          <path d={EDGE} fill="#0e0e0e" />
        </svg>
        <div className="absolute inset-y-0 left-0 w-px bg-vein opacity-60" />
        <div className="absolute inset-y-0 right-0 w-px bg-vein opacity-60" />
        <div className="absolute inset-0 grid place-items-center">
          <span className="font-display text-[clamp(2rem,5vw,4.4rem)] text-carrara">{label}</span>
        </div>
      </div>
    </div>
  );
}
