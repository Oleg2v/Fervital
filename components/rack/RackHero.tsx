"use client";

import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { cropUrl, RACK_A } from "@/lib/data";
import { anim, cycle, frontSlab, pullOut, pushIn, RACK_SIZE, useRack } from "@/lib/rack";
import { useT, useUi } from "@/lib/ui";
import SlabPanel from "./SlabPanel";
import RackFallbackVideo from "./RackFallbackVideo";
import StaticWall from "./StaticWall";
import type { Quality } from "./RackScene";

const RackScene = dynamic(() => import("./RackScene"), { ssr: false });

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export default function RackHero({ compact = false }: { compact?: boolean }) {
  const { t, lang, fmt, arrow } = useT();
  const tier = useUi((s) => s.tier);
  const view = useUi((s) => s.view);
  const index = useRack((s) => s.index);
  const override = useRack((s) => s.override);
  const pulledOutGl = useRack((s) => s.pulledOut);
  const bookmatch = useRack((s) => s.bookmatch);
  const pullTargetOut = useRack((s) => s.pullTarget > 0.5);
  const pulledOut = tier === "webgl" ? pulledOutGl : pullTargetOut;
  const slab = frontSlab({ ...useRack.getState(), index, override });
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const intro = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLDivElement>(null);
  const [canvasOn, setCanvasOn] = useState(false);
  const scrollDriven = !compact && tier === "webgl";
  const hidden = view === "yard";
  const [forcedQ, setForcedQ] = useState<Quality | null>(null);
  const [capture, setCapture] = useState(false);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const q = sp.get("q");
    if (q === "medium" || q === "high") setForcedQ(q);
    if (sp.get("capture") === "1") setCapture(true);
  }, []);
  const quality: Quality = forcedQ ?? (compact ? "medium" : "high");

  useEffect(() => {
    useRack.getState().setScrollDriven(scrollDriven);
  }, [scrollDriven]);

  useEffect(() => {
    // test hook for automated QA and the demo recorder
    (window as unknown as Record<string, unknown>).__rack = { useRack, anim, cycle, pullOut, pushIn };
  }, []);

  // ── scroll → pull (customer view only) ──
  useEffect(() => {
    if (!scrollDriven) return;
    let last = -1;
    let lastWant = -1; // scroll-derived target at the previous scroll position
    const onScroll = () => {
      const el = section.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - vh)));
      if (Math.abs(p - last) < 0.0005) return;
      last = p;
      const st = useRack.getState();
      if (st.busy || st.dragging) return;
      const want = smooth(0.04, 0.58, p);
      // pullTarget no longer matches the scroll position → a click, Enter, Escape, drag or cycle set it:
      // keep it until scrolling brings the scroll-derived target to the same value, then scroll takes over again
      const manual = lastWant >= 0 && Math.abs(st.pullTarget - lastWant) > 0.02;
      lastWant = want;
      if (manual && Math.abs(want - st.pullTarget) > 0.02) return;
      st.setPullTarget(want);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [scrollDriven]);

  // ── overlays follow the animated pull without React renders ──
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const webgl = useUi.getState().tier === "webgl";
      const p = webgl ? Math.max(0, Math.min(1, anim.pull)) : useRack.getState().pullTarget;
      if (intro.current) {
        const o = 1 - smooth(0.05, 0.45, p);
        intro.current.style.opacity = String(o);
        intro.current.style.transform = `translate3d(0, ${-p * 60}px, 0)`;
        intro.current.style.visibility = o < 0.01 ? "hidden" : "visible";
      }
      if (hud.current) {
        const ho = 1 - smooth(0.1, 0.5, p);
        hud.current.style.opacity = String(ho);
        const off = ho < 0.01;
        // a faded-out HUD leaves the tab order: keyboard focus on it moves to the rack (video tier: the slab's panel)
        const a = document.activeElement as HTMLElement | null;
        if (off && a && hud.current.contains(a) && a.matches(":focus-visible")) {
          const to =
            stage.current?.querySelector<HTMLElement>('[data-ap="rack"][tabindex]') ??
            stage.current?.querySelector<HTMLElement>('[data-ap="bookmatch"]');
          to?.focus({ preventScroll: true });
        }
        hud.current.style.visibility = off ? "hidden" : "visible";
      }
      if (label.current) label.current.style.opacity = String((1 - smooth(0.02, 0.25, p)) * (anim.ready && webgl ? 1 : 0));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── custom drag cursor over the rack ──
  const cursor = useRef<HTMLDivElement>(null);
  const onHover = (e: React.PointerEvent) => {
    const c = cursor.current;
    if (!c || e.pointerType !== "mouse") return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    c.style.transform = `translate3d(${e.clientX - r.left}px, ${e.clientY - r.top}px, 0)`;
    c.style.opacity = anim.pull < 0.15 && !useRack.getState().dragging ? "1" : "0";
  };

  // ── drag along the rail ──
  const drag = useRef<{ x: number; y: number; start: number; moved: boolean; id: number } | null>(null);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || useRack.getState().busy) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, start: anim.pull, moved: false, id: e.pointerId };
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    if (!d.moved) {
      d.moved = true;
      useRack.getState().setDragging(true);
    }
    let target: number;
    if (d.start < 0.5) {
      const r = anim.rail;
      const len2 = r.x * r.x + r.y * r.y;
      const along = len2 > 40 ? (dx * r.x + dy * r.y) / len2 : dy / 420;
      target = d.start + along;
    } else {
      target = d.start - (Math.abs(dx) + Math.max(0, -dy)) / 520;
    }
    useRack.getState().setPullTarget(Math.max(0, Math.min(1.04, target)));
  }, []);
  const onPointerUp = useCallback(() => {
    const d = drag.current;
    drag.current = null;
    const st = useRack.getState();
    if (!d) return;
    st.setDragging(false);
    if (!d.moved) {
      if (anim.pull < 0.5) pullOut();
      return;
    }
    if (d.start < 0.5) {
      st.setPullTarget(st.pullTarget > 0.32 ? 1 : 0);
    } else if (st.pullTarget < 0.78) {
      // releasing slides it back and pulls the next
      st.setPullTarget(1);
      cycle(1);
    } else st.setPullTarget(1);
  }, []);

  // ── keyboard through the rack ──
  const onKeyDown = (e: React.KeyboardEvent) => {
    const st = useRack.getState();
    const out = anim.pull > 0.5;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        cycle(1, out);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        cycle(-1, out);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (out) pushIn();
        else pullOut();
        break;
      case "Escape":
        if (out) pushIn();
        break;
      case "b":
      case "B":
        if (out) st.setBookmatch(!st.bookmatch);
        break;
      case "z":
      case "Z":
        useUi.getState().openZoom(frontSlab().id);
        break;
    }
  };

  // announce the front slab for screen readers
  useEffect(() => {
    const s = slab;
    useUi.getState().say(
      `${fmt(t.hero.counter, { n: index + 1, total: RACK_SIZE })}. ${s.name[lang]}, ${s.id}. ${s.desc[lang]}.`,
    );
  }, [slab, index, lang, t, fmt]);

  if (tier === "static") return <StaticWall compact={compact} />;

  const counter = String(index + 1).padStart(2, "0");

  return (
    <section
      ref={section}
      id="rack"
      aria-label={t.hero.rackLabel}
      className="relative"
      style={{ height: scrollDriven ? "290svh" : "var(--pane-h)" }}
    >
      <div ref={stage} className="sticky top-0 overflow-hidden bg-basalt" style={{ height: "var(--pane-h)" }}>
        {tier === "video" ? (
          <div className="absolute inset-0" data-ap="rack" onClick={() => !pulledOut && pullOut()}>
            <RackFallbackVideo />
            <AnimatePresence>
              {pulledOut && (
                <motion.div
                  key={slab.id}
                  className="absolute inset-0 flex"
                  style={{ perspective: 1800 }}
                  initial={{ opacity: 0, scale: 1.06 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                >
                  <motion.img
                    src={cropUrl(slab.id, 960)}
                    alt={`${slab.name[lang]} — ${slab.desc[lang]}`}
                    className="h-full object-cover"
                    animate={{ width: bookmatch ? "50%" : "100%" }}
                    transition={{ duration: 0.9, ease: [0.76, 0, 0.18, 1] }}
                  />
                  {/* bookmatch twin: mirrored, swinging open on its hinge */}
                  <AnimatePresence>
                    {bookmatch && (
                      <motion.img
                        src={cropUrl(slab.id, 960)}
                        alt=""
                        className="h-full w-1/2 object-cover"
                        style={{ transformOrigin: lang === "he" ? "100% 50%" : "0% 50%", scaleX: -1 }}
                        initial={{ rotateY: lang === "he" ? -175 : 175, opacity: 0.4 }}
                        animate={{ rotateY: 0, opacity: 1 }}
                        exit={{ rotateY: lang === "he" ? -175 : 175, opacity: 0 }}
                        transition={{ duration: 1.1, ease: [0.76, 0, 0.18, 1] }}
                      />
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <div
            className="peer absolute inset-0 cursor-grab touch-pan-y md:cursor-none"
            onPointerDown={onPointerDown}
            onPointerMove={(e) => {
              onHover(e);
              onPointerMove(e);
            }}
            onPointerLeave={() => cursor.current && (cursor.current.style.opacity = "0")}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
            tabIndex={0}
            role="group"
            aria-roledescription={lang === "he" ? "קטלוג לוחות" : "slab catalogue"}
            aria-label={`${t.hero.rackLabel}. ${t.hero.rackHelp}`}
            data-ap="rack"
          >
            {tier === "webgl" && (
              <RackScene active={!hidden} quality={quality} capture={capture} onFirstFrame={() => setCanvasOn(true)} />
            )}
            <div
              ref={cursor}
              className="pointer-events-none absolute left-0 top-0 z-10 hidden md:block"
              style={{ opacity: 0, transition: "opacity .3s" }}
              aria-hidden="true"
            >
              <div className="-translate-x-1/2 -translate-y-1/2">
                <div className="grid h-[86px] w-[86px] place-items-center rounded-full border border-[#f3f1ec99] backdrop-blur-[2px]">
                  <span className="font-mono text-center text-[10px] uppercase leading-tight tracking-[0.16em] text-carrara">
                    {lang === "he" ? "גררו" : "drag"}
                    <br />
                    <span className="text-amber">←→</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* keyboard focus ring of the rack group, on its own layer: the group's outline would be clipped by the
            stage and painted under the canvas and overlays */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-30 hidden peer-focus-visible:block"
          style={{ boxShadow: "inset 0 0 0 3px var(--color-amber)" }}
        />

        {/* vignette + grain */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 50% 40%, #0e0e0e00 55%, #0e0e0ecc 100%), linear-gradient(to bottom, #0e0e0e99 0%, #0e0e0e00 22%, #0e0e0e00 70%, #0e0e0ea6 100%)",
          }}
        />
        <div className="grain pointer-events-none absolute inset-0" />

        {/* scrim on the receding (dark) side, behind the headline */}
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-[62%]"
          style={{ background: "linear-gradient(to left, #0e0e0ef0 0%, #0e0e0ec4 38%, #0e0e0e00 100%)" }}
        />
        {/* intro typography */}
        <div
          ref={intro}
          className={`pointer-events-none absolute top-0 right-0 ${compact ? "w-full px-5 pt-6" : "w-full px-6 pt-[calc(var(--header-h)+5vh)] md:w-[58%] md:px-10"}`}
        >
          <p className="eyebrow muted fade-late">{t.hero.eyebrow}</p>
          <h1
            className={`font-display mt-4 leading-[0.9] ${compact ? "text-[2.6rem]" : "text-[clamp(3.2rem,8.1vw,8.8rem)]"}`}
          >
            <span className="rise-mask">
              <span>{t.hero.l1}</span>
            </span>
            <span className="rise-mask">
              <span className="text-vein">{t.hero.l2}</span>
            </span>
          </h1>
          <p className={`fade-late mt-6 max-w-[34ch] leading-relaxed ${compact ? "hidden" : "text-[1.05rem] md:text-[1.15rem]"}`} style={{ color: "#d5d2cc" }}>
            {t.hero.sub}
          </p>
        </div>

        {/* front slab label */}
        <div
          ref={label}
          className="pointer-events-none absolute bottom-[24%] left-[7%] hidden md:block"
          style={{ opacity: 0 }}
          aria-hidden="true"
        >
          <span className="font-mono text-[0.7rem] tracking-[0.14em] text-vein ltr-nums">
            {slab.rack.label} · {slab.id}
          </span>
          <p className="font-display text-[1.6rem] leading-tight">{slab.name[lang]}</p>
        </div>

        {/* HUD */}
        <div
          ref={hud}
          className={`absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 ${compact ? "px-5 pb-5" : "px-6 pb-7 md:px-10"}`}
        >
          <div className="flex items-center gap-3">
            <button type="button" className="btn !min-h-[40px] !px-3" aria-label={t.slab.prev} onClick={() => cycle(-1, false)}>
              {arrow.back}
            </button>
            <div className="font-mono text-[0.78rem] tracking-[0.12em]">
              <span className="ltr-nums">
                <span className="text-carrara">{counter}</span>
                <span className="text-vein"> / {RACK_SIZE}</span>
              </span>
              <span className="text-vein"> · {lang === "he" ? "מדף A" : "Rack A"}</span>
            </div>
            <button type="button" className="btn !min-h-[40px] !px-3" aria-label={t.slab.next} onClick={() => cycle(1, false)}>
              {arrow.fwd}
            </button>
          </div>
          <div className="hidden items-center gap-3 sm:flex">
            <RailHint />
            <span className="eyebrow muted">{t.hero.hint}</span>
          </div>
          <button type="button" className="btn btn-solid !min-h-[40px]" onClick={() => pullOut()} data-ap="pull">
            {lang === "he" ? "שלפו לוח" : "Pull a slab"}
          </button>
        </div>

        {/* the pulled slab: details + actions */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0">
          {/* wait: a new slab's panel enters once the old one has left (they would stack in this bottom-anchored box) */}
          <AnimatePresence mode="wait">{pulledOut && <SlabPanel key={slab.id} slab={slab} compact={compact} />}</AnimatePresence>
        </div>

        {!canvasOn && tier === "webgl" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="eyebrow muted">{t.common.loading}…</span>
          </div>
        )}
      </div>
      <p className="sr-only">{t.hero.hintKeys}</p>
      <ul className="sr-only" aria-label={t.hero.rackLabel}>
        {RACK_A.map((s) => (
          <li key={s.id}>
            {s.rack.label}: {s.name[lang]} — {s.desc[lang]}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RailHint() {
  return (
    <svg width="54" height="14" viewBox="0 0 54 14" aria-hidden="true" className="text-vein">
      <path d="M1 7h52" stroke="currentColor" strokeWidth="1" />
      <rect x="4" y="3" width="10" height="8" fill="none" stroke="#d9a441" strokeWidth="1">
        <animate attributeName="x" values="4;40;4" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.7 0 0.2 1;0.7 0 0.2 1" />
      </rect>
    </svg>
  );
}
