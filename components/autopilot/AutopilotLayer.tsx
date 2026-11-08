"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useT, useUi } from "@/lib/ui";
import { pauseAutopilot, skipStep, startAutopilot, stopAutopilot, useCursors, type Side } from "./engine";

function Cursor({ side }: { side: Side }) {
  const c = useCursors((s) => s[side]);
  const { lang } = useT();
  const label = side === "customer" ? (lang === "he" ? "אדריכלית" : "Architect") : lang === "he" ? "המחסן" : "Yard";
  if (!c.visible) return null;
  return (
    <div className="pointer-events-none fixed left-0 top-0 z-[180]" style={{ transform: `translate3d(${c.x}px, ${c.y}px, 0)` }} aria-hidden="true">
      <motion.svg
        width="26"
        height="30"
        viewBox="0 0 26 30"
        className="-translate-x-[3px] -translate-y-[2px] drop-shadow-[0_4px_10px_rgba(0,0,0,.55)]"
        animate={{ scale: c.pressed ? 0.86 : 1 }}
        transition={{ duration: 0.12 }}
      >
        <path d="M3 2 L22 17 L13.5 18.2 L18.6 27.4 L14.6 29 L9.6 19.8 L3 25.4 Z" fill={side === "customer" ? "#f3f1ec" : "#d9a441"} stroke="#0e0e0e" strokeWidth="1.4" />
      </motion.svg>
      <span
        className="font-mono absolute left-5 top-6 whitespace-nowrap px-1.5 py-0.5 text-[10px] tracking-[0.08em]"
        style={{ background: side === "customer" ? "#f3f1ec" : "#d9a441", color: "#0e0e0e" }}
      >
        {label}
      </span>
      <AnimatePresence>
        <motion.span
          key={c.click}
          className="absolute -left-4 -top-4 h-8 w-8 rounded-full border"
          style={{ borderColor: side === "customer" ? "#f3f1ec" : "#d9a441" }}
          initial={{ scale: 0.3, opacity: c.click ? 0.9 : 0 }}
          animate={{ scale: 1.7, opacity: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </AnimatePresence>
    </div>
  );
}

export default function AutopilotLayer() {
  const { t, lang } = useT();
  const a = useUi((s) => s.autopilot);
  const show = a.running || a.done;
  return (
    <>
      <Cursor side="customer" />
      <Cursor side="yard" />
      <AnimatePresence>
        {show && (
          <motion.div
            role="region"
            aria-label={t.autopilot.title}
            aria-live="polite"
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-x-0 bottom-5 z-[170] mx-auto flex w-[min(940px,calc(100vw-24px))] items-center gap-4 border border-[var(--hair-strong)] bg-basalt/95 px-4 py-3 text-carrara backdrop-blur"
          >
            <span className="font-mono shrink-0 text-[0.72rem] text-amber ltr-nums">
              {a.done ? "—" : `${String(Math.max(1, a.step + 1)).padStart(2, "0")}/${String(a.total).padStart(2, "0")}`}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.95rem]">{a.done ? t.autopilot.done : t.autopilot.steps[Math.max(0, a.step)] ?? "…"}</p>
              <div className="mt-2 flex gap-1" aria-hidden="true">
                {Array.from({ length: a.total }).map((_, i) => (
                  <span key={i} className="h-[2px] flex-1" style={{ background: a.done || i < a.step ? "#f3f1ec" : i === a.step ? "#d9a441" : "#8e8b8555" }} />
                ))}
              </div>
            </div>
            {a.running ? (
              <div className="flex shrink-0 gap-1.5">
                <button type="button" className="btn !min-h-[34px] !px-3 text-[0.78rem]" onClick={() => pauseAutopilot(!a.paused)} aria-pressed={a.paused}>
                  {a.paused ? t.autopilot.resume : t.autopilot.pause}
                </button>
                <button type="button" className="btn !min-h-[34px] !px-3 text-[0.78rem]" onClick={skipStep}>
                  {t.autopilot.skip}
                </button>
                <button type="button" className="btn !min-h-[34px] !px-3 text-[0.78rem]" onClick={stopAutopilot} aria-label={t.autopilot.stop}>
                  ✕
                </button>
              </div>
            ) : (
              <div className="flex shrink-0 gap-1.5">
                <button type="button" className="btn btn-amber !min-h-[34px] !px-3 text-[0.78rem]" onClick={() => startAutopilot()}>
                  {t.autopilot.again}
                </button>
                <button type="button" className="btn !min-h-[34px] !px-3 text-[0.78rem]" onClick={() => useUi.getState().setAutopilot({ done: false })} aria-label={t.common.close}>
                  ✕
                </button>
              </div>
            )}
            <span className="sr-only">{lang}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
