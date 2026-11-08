"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";

/** Heavy, quiet entrance when an element scrolls into view (works in any scroller). */
export default function Reveal({
  children,
  className = "",
  delay = 0,
  y = 36,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  as?: "div" | "section" | "li" | "header";
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.set(el, { y, opacity: 0 });
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            gsap.to(el, { y: 0, opacity: 1, duration: 1.1, delay, ease: "expo.out" });
            io.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [delay, y]);
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Tag ref={ref as any} className={className}>
      {children}
    </Tag>
  );
}
