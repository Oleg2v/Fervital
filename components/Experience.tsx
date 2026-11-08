"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import RackHero from "@/components/rack/RackHero";
import Header from "@/components/chrome/Header";
import StoneWipe from "@/components/chrome/StoneWipe";
import SmoothScroll from "@/components/chrome/SmoothScroll";
import About from "@/components/sections/About";
import VeinSearch from "@/components/sections/VeinSearch";
import KitchenStudio from "@/components/sections/KitchenStudio";
import YieldCalc from "@/components/sections/YieldCalc";
import Portal, { HoldCard, OrderTrack, PersonaSwitch } from "@/components/sections/Portal";
import Visit from "@/components/sections/Visit";
import YardDesk from "@/components/yard/YardDesk";
import MacroZoomHost from "@/components/MacroZoom";
import FlyLayer from "@/components/fx/FlyLayer";
import YourSlab from "@/components/fx/YourSlab";
import AutopilotLayer from "@/components/autopilot/AutopilotLayer";
import { startSync, useDemo } from "@/lib/store";
import { useYardFlash } from "@/lib/hooks";
import { useT, useUi, type Tier } from "@/lib/ui";

function detectTier(): Tier {
  const q = new URLSearchParams(window.location.search).get("rack");
  if (q === "webgl" || q === "video" || q === "static") return q;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "static";
  const c = document.createElement("canvas");
  const gl = c.getContext("webgl2");
  if (!gl) return "video";
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const small = Math.min(window.screen.width, window.screen.height) < 820;
  if ((coarse && small) || nav.connection?.saveData) return "video";
  if ((nav.deviceMemory ?? 8) <= 4 && (nav.hardwareConcurrency ?? 8) <= 4) return "video";
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
  if (/swiftshader|llvmpipe|software|mali-4|adreno \(tm\) [3-5]\d\d/i.test(renderer)) return "video";
  return "webgl";
}

function LiveClientDock() {
  const { t } = useT();
  const persona = useUi((s) => s.personaId);
  const holds = useDemo((s) => s.holds);
  const jobs = useDemo((s) => s.jobs);
  const mine = holds.filter((h) => h.customerId === persona && (h.status === "pending" || h.status === "confirmed"));
  const myJobs = jobs.filter((j) => j.customerId === persona).slice(0, 3);
  return (
    <div className="paper px-4 pb-10 pt-6" id="portal-live">
      <PersonaSwitch compact />
      <h3 className="eyebrow muted mt-6">{t.portal.holds}</h3>
      <ul className="mt-3 grid gap-2">
        <AnimatePresence initial={false}>
          {mine.map((h) => (
            <HoldCard key={h.id} h={h} compact />
          ))}
        </AnimatePresence>
        {!mine.length && <li className="muted text-[0.85rem]">{t.portal.noHolds}</li>}
      </ul>
      {myJobs.length > 0 && (
        <>
          <h3 className="eyebrow muted mt-6">{t.portal.order}</h3>
          <div className="mt-3 grid gap-2">
            {myJobs.map((j) => (
              <OrderTrack key={j.id} j={j} compact />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function KitchenModal() {
  const { t } = useT();
  const open = useUi((s) => s.kitchenOpen);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={t.kitchen.title}
          className="paper absolute inset-0 z-[60] overflow-auto pane-scroll"
          initial={{ clipPath: "inset(0 0 0 100%)" }}
          animate={{ clipPath: "inset(0 0 0 0%)" }}
          exit={{ clipPath: "inset(0 100% 0 0)" }}
          transition={{ duration: 0.7, ease: [0.76, 0, 0.18, 1] }}
          onKeyDown={(e) => e.key === "Escape" && useUi.getState().setKitchenOpen(false)}
        >
          <div className="flex items-center justify-between border-b border-[var(--hair)] px-4 py-3">
            <div className="flex items-center gap-3">
              <p className="font-display text-[1.6rem] leading-none">{t.kitchen.title}</p>
              <span className="chip" style={{ borderColor: "#7a2e2e", color: "#7a2e2e" }}>
                {t.kitchen.beta}
              </span>
              <span className="chip" style={{ borderColor: "#2e4a3d", color: "#2e4a3d" }}>
                {t.kitchen.sim}
              </span>
            </div>
            <button type="button" className="btn !min-h-[36px]" onClick={() => useUi.getState().setKitchenOpen(false)}>
              ✕ {t.common.close}
            </button>
          </div>
          <KitchenStudio compact />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PaneFlashFrame() {
  // a frame pinned to the pane viewport so the flash is seen wherever the pane is scrolled
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0" style={{ height: "calc(100svh - var(--header-h))" }}>
      <PaneFlash />
    </div>
  );
}

function PaneFlash() {
  const k = useYardFlash(() => true);
  if (!k) return null;
  return <div key={k} className="flash-amber pointer-events-none absolute inset-0 z-[70]" aria-hidden="true" style={{ background: "transparent" }} />;
}

export default function Experience() {
  const { t, lang } = useT();
  const view = useUi((s) => s.view);
  const tier = useUi((s) => s.tier);
  const announce = useUi((s) => s.announce);
  const live = view === "live";

  useEffect(() => {
    startSync();
    useUi.getState().setTier(detectTier());
    const tick = window.setInterval(() => useDemo.getState().expireDue(), 1000);
    // the CSS preloader hides itself (visibility) after ~1 s; React owns the node, so it stays
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
    document.title = t.meta.title;
  }, [lang, t]);

  useEffect(() => {
    document.documentElement.style.setProperty("--pane-h", live ? "calc(100svh - var(--header-h))" : "100svh");
  }, [live]);

  return (
    <>
      <a href="#main" className="skip-link">
        {t.meta.skip}
      </a>
      <SmoothScroll />
      <Header />
      <main
        id="main"
        tabIndex={-1}
        className={live ? "grid h-[100svh] pt-[var(--header-h)]" : ""}
        style={live ? { gridTemplateColumns: "minmax(0, 1.18fr) 1px minmax(0, 1fr)" } : undefined}
      >
        {/* client / architect */}
        <div
          data-pane="customer"
          data-scroller={live ? "" : undefined}
          className={`relative ${live ? "overflow-y-auto overflow-x-hidden pane-scroll" : ""}`}
          style={{ display: view === "yard" ? "none" : undefined, containerType: live ? "inline-size" : undefined }}
          aria-label={live ? t.common.customerSide : undefined}
          role={live ? "region" : undefined}
        >
          {tier && <RackHero compact={live} />}
          {live ? (
            <LiveClientDock />
          ) : (
            <>
              <About />
              <VeinSearch />
              <KitchenStudio />
              <YieldCalc />
              <Portal />
              <Visit />
            </>
          )}
          {live && <KitchenModal />}
          {live && <YourSlab contained />}
          {live && (
            <div className="pointer-events-none sticky bottom-0 z-[70] h-0">
              <PaneFlashFrame />
            </div>
          )}
        </div>

        {/* the stone hairline with its live dot */}
        {live && (
          <div className="relative bg-[#8e8b8580]" aria-hidden="true">
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <span className="live-dot block" />
            </div>
            <span className="font-mono absolute left-1/2 top-[calc(50%+14px)] -translate-x-1/2 bg-basalt px-1 text-[9px] uppercase tracking-[0.2em] text-amber">
              {t.live.dot}
            </span>
          </div>
        )}

        {/* the yard */}
        <div
          data-pane="yard"
          data-scroller={live ? "" : undefined}
          className={`relative bg-basalt ${live ? "overflow-y-auto pane-scroll" : "min-h-[100svh]"}`}
          style={{ display: view === "customer" ? "none" : undefined }}
          aria-label={live ? t.common.yardSide : undefined}
          role={live ? "region" : undefined}
        >
          {view !== "customer" && <YardDesk compact={live} />}
        </div>
      </main>

      {!live && <YourSlab />}
      <MacroZoomHost />
      <FlyLayer />
      <AutopilotLayer />
      <StoneWipe />
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </div>
    </>
  );
}
