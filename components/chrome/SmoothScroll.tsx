"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useUi } from "@/lib/ui";
import { useReducedMotion } from "@/lib/hooks";
import { getLenis, setLenis } from "@/components/nav";

/** Lenis drives the window scroll (client view only); GSAP's ticker drives Lenis. */
export default function SmoothScroll() {
  const view = useUi((s) => s.view);
  const reduced = useReducedMotion();
  const modal = useUi((s) => !!s.zoomSlabId || s.kitchenOpen);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    if (view !== "customer" || reduced) return;
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => 1 - Math.pow(1 - t, 3.4),
      smoothWheel: true,
      wheelMultiplier: 0.85,
      touchMultiplier: 1.2,
    });
    setLenis(lenis);
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
      setLenis(null);
    };
  }, [view, reduced]);

  useEffect(() => {
    const l = getLenis();
    if (!l) return;
    if (modal) l.stop();
    else l.start();
  }, [modal]);

  return null;
}
