"use client";

import { useEffect, useRef, useState } from "react";
import { useDemo } from "@/lib/store";
import { useT, useUi, type View } from "@/lib/ui";
import { scrollToId } from "@/components/nav";
import { WORDMARK_HE, WORDMARK_HE_WIDTH } from "./wordmark-paths";
import { startAutopilot, stopAutopilot } from "@/components/autopilot/engine";

export function switchView(v: View, label = "") {
  const ui = useUi.getState();
  if (ui.view === v) return;
  // the presenter is taking over: stop a running demo now, not 420 ms later when the view changes
  if (ui.autopilot.running && v !== "live") stopAutopilot();
  ui.triggerWipe(label);
  window.setTimeout(() => {
    useUi.getState().setView(v);
    window.scrollTo({ top: 0 });
  }, 420);
}

export default function Header() {
  const { t, lang } = useT();
  const view = useUi((s) => s.view);
  const running = useUi((s) => s.autopilot.running);
  const [solid, setSolid] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [menu, setMenu] = useState(false);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > window.innerHeight * 0.6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const doReset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      resetTimer.current = window.setTimeout(() => setConfirmReset(false), 3200);
      return;
    }
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
    setConfirmReset(false);
    // a run left going against the reseeded data would stall on targets that are gone, then claim a sale
    if (useUi.getState().autopilot.running) stopAutopilot();
    useUi.getState().triggerWipe(t.nav.reset);
    window.setTimeout(() => {
      useDemo.getState().resetDemo();
      useUi.getState().setYourSlab(null);
    }, 420);
  };

  const toggleLang = () => {
    const next = lang === "he" ? "en" : "he";
    useUi.getState().triggerWipe(next === "he" ? "עברית" : "English");
    window.setTimeout(() => useUi.getState().setLang(next), 420);
  };

  const navItems: [string, string][] = [
    ["rack", t.nav.rack],
    ["search", t.nav.search],
    ["kitchen", t.nav.kitchen],
    ["yield", t.nav.yield],
    ["portal", t.nav.portal],
  ];

  const go = (id: string) => {
    setMenu(false);
    // live mounts only the rack and the client dock, so #search/#kitchen/#yield/#portal exist only in the
    // client view. Keep the yard check: #rack stays mounted (in the hidden client pane) in yard view.
    if (useUi.getState().view === "yard" || !document.getElementById(id)) {
      switchView("customer");
      window.setTimeout(() => scrollToId(id, { immediate: true }), 600);
    } else scrollToId(id, { offset: id === "rack" ? 0 : -80 });
  };

  const transparent = view === "customer" && !solid;

  return (
    <header
      className="fixed inset-x-0 top-0 z-[90] text-carrara transition-colors duration-500"
      style={{
        background: transparent ? "linear-gradient(#0e0e0ee6, #0e0e0e00)" : "#0e0e0e",
        borderBottom: transparent ? "1px solid transparent" : "1px solid var(--hair)",
      }}
    >
      {/* demo ribbon — always visible */}
      <div className="flex h-[22px] items-center justify-center gap-3 border-b border-[var(--hair)] px-4 text-center">
        <span className="font-mono text-[10.5px] tracking-[0.08em] text-amber">{t.meta.badge}</span>
        <span className="hidden font-mono text-[10.5px] tracking-[0.06em] text-vein md:inline">· {t.meta.demoOnly}</span>
      </div>
      <div className="flex h-[54px] items-center gap-4 px-4 md:px-8">
        <a
          href="#rack"
          onClick={(e) => {
            e.preventDefault();
            go("rack");
          }}
          className="flex shrink-0 items-center gap-3"
          aria-label={lang === "he" ? "פרביטל — לראש העמוד" : "Fervital — back to top"}
        >
          <svg viewBox={`0 -118 ${WORDMARK_HE_WIDTH.toFixed(0)} 160`} className="h-[26px] w-auto" aria-hidden="true">
            <path d={WORDMARK_HE} fill="currentColor" />
          </svg>
          <span className="hidden font-mono text-[10px] tracking-[0.22em] text-vein sm:inline">FERVITAL · 1956</span>
        </a>

        <nav aria-label={lang === "he" ? "ניווט ראשי" : "Main"} className="mx-auto hidden xl:block">
          <ul className="flex items-center gap-6 text-[0.86rem]">
            {navItems.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    go(id);
                  }}
                  className="relative py-2 text-[#d5d2cc] transition-colors hover:text-carrara"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ms-auto flex items-center gap-2 xl:ms-0">
          <div className="hidden items-center border border-[var(--hair-strong)] sm:flex" role="group" aria-label={t.nav.modeLabel}>
            {(["customer", "yard"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => switchView(v, v === "yard" ? t.yard.title : t.nav.client)}
                className="h-[34px] px-3 text-[0.8rem] transition-colors"
                style={view === v ? { background: "#f3f1ec", color: "#0e0e0e" } : undefined}
                data-ap={`view-${v}`}
              >
                {v === "customer" ? t.nav.client : t.nav.yard}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={view === "live"}
            onClick={() => switchView(view === "live" ? "customer" : "live", t.nav.live)}
            className="flex h-[36px] items-center gap-2 border px-3 text-[0.8rem]"
            style={{ borderColor: view === "live" ? "#d9a441" : "var(--hair-strong)", color: view === "live" ? "#d9a441" : undefined }}
            data-ap="live"
          >
            <span className={view === "live" ? "live-dot" : "inline-block h-2 w-2 rounded-full bg-vein"} />
            {t.nav.live}
          </button>
          <button
            type="button"
            onClick={() => startAutopilot()}
            disabled={running}
            aria-label={t.nav.autopilot}
            className="btn btn-amber !min-h-[36px] !px-3 text-[0.8rem]"
            data-ap="autopilot"
          >
            <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true" className="rtl:-scale-x-100">
              <path d="M0 0 10 6 0 12z" fill="currentColor" />
            </svg>
            <span className="hidden md:inline">{t.nav.autopilot}</span>
          </button>
          <button
            type="button"
            onClick={doReset}
            className="hidden h-[36px] px-2 text-[0.78rem] text-vein underline-offset-4 hover:text-carrara hover:underline lg:block"
            aria-live="polite"
          >
            {confirmReset ? (lang === "he" ? "לאשר איפוס?" : "Confirm reset?") : t.nav.reset}
          </button>
          <button
            type="button"
            onClick={toggleLang}
            className="h-[36px] min-w-[40px] border border-[var(--hair-strong)] px-2 font-mono text-[0.75rem]"
            aria-label={t.nav.langLabel}
            lang={lang === "he" ? "en" : "he"}
          >
            {t.nav.lang}
          </button>
          <button
            type="button"
            className="h-[36px] border border-[var(--hair-strong)] px-3 text-[0.8rem] xl:hidden"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
          >
            {menu ? t.nav.close : t.nav.menu}
          </button>
        </div>
      </div>
      {menu && (
        <div className="border-t border-[var(--hair)] bg-basalt px-4 pb-6 pt-3 xl:hidden">
          <ul className="grid gap-1">
            {navItems.map(([id, label]) => (
              <li key={id}>
                <button type="button" className="w-full py-3 text-start text-[1.1rem]" onClick={() => go(id)}>
                  {label}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2 sm:hidden">
            {(["customer", "yard"] as const).map((v) => (
              <button key={v} type="button" className="btn" aria-pressed={view === v} onClick={() => switchView(v)}>
                {v === "customer" ? t.nav.client : t.nav.yard}
              </button>
            ))}
            <button type="button" className="btn" onClick={doReset}>
              {t.nav.reset}
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
