"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { cropUrl, SLAB_BY_ID, STAGES } from "@/lib/data";
import { useDemo } from "@/lib/store";
import { useT, useUi } from "@/lib/ui";

/** "הלוח שלך" — the moment a slab is converted to a sale for this client. */
export default function YourSlab({ contained = false }: { contained?: boolean }) {
  const { t, lang } = useT();
  const id = useUi((s) => s.yourSlab);
  const persona = useUi((s) => s.personaId);
  const events = useDemo((s) => s.events);
  const job = useDemo((s) => (id ? s.jobs.find((j) => j.slabId === id) : undefined));
  const seen = useRef<string | null | undefined>(undefined);
  const closeRef = useRef<HTMLButtonElement>(null);

  // open automatically when the yard converts this client's hold
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
    const conv = fresh.find((e) => e.type === "hold.converted" && e.customerId === persona && Date.now() - e.real < 6000);
    if (conv?.slabId && !useUi.getState().autopilot.running) {
      window.setTimeout(() => useUi.getState().setYourSlab(conv.slabId!), 900);
    }
  }, [events, persona]);

  useEffect(() => {
    if (id) closeRef.current?.focus();
  }, [id]);

  const s = id ? SLAB_BY_ID[id] : null;
  const stage = job ? STAGES.indexOf(job.stage) : 0;
  return (
    <AnimatePresence>
      {s && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={`${t.slab.yours} — ${s.name[lang]}`}
          className={`${contained ? "absolute" : "fixed"} inset-0 z-[140] overflow-hidden bg-basalt text-carrara`}
          initial={{ clipPath: "inset(0 0 100% 0)" }}
          animate={{ clipPath: "inset(0 0 0% 0)" }}
          exit={{ opacity: 0, transition: { duration: 0.5 } }}
          transition={{ duration: 0.9, ease: [0.76, 0, 0.18, 1] }}
          onKeyDown={(e) => e.key === "Escape" && useUi.getState().setYourSlab(null)}
        >
          <motion.img
            src={cropUrl(s.id, 960)}
            alt={s.desc[lang]}
            className="absolute inset-0 h-full w-full object-cover"
            initial={{ scale: 1.18 }}
            animate={{ scale: 1.02 }}
            transition={{ duration: 3.2, ease: [0.16, 1, 0.3, 1] }}
          />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to top, #0e0e0ef2 0%, #0e0e0e99 45%, #0e0e0e33 100%)" }} />
          <div className="absolute inset-x-0 bottom-0 p-6 md:p-10">
            <motion.p className="eyebrow text-amber" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
              {t.portal.yoursLine.replace("{rack}", s.rack.label)}
            </motion.p>
            <motion.h2
              className={`font-display mt-3 leading-[0.9] ${contained ? "text-[clamp(3rem,9cqw,6rem)]" : "text-[clamp(3.6rem,11vw,10rem)]"}`}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            >
              {t.slab.yours}.
            </motion.h2>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }} className="mt-5 flex flex-wrap items-end justify-between gap-6">
              <div>
                <p className="font-display text-[1.8rem] leading-none">{s.name[lang]}</p>
                <p className="font-mono mt-2 text-[0.75rem] text-[#d5d2cc] ltr-nums">
                  {s.id} · {s.lengthMm}×{s.heightMm}×{s.thicknessMm} mm · {s.rack.label}
                </p>
              </div>
              <ol className="flex gap-1" aria-label={t.portal.order}>
                {STAGES.map((st, i) => (
                  <li key={st} className="w-20 text-[0.72rem]">
                    <div className="h-[3px]" style={{ background: i < stage ? "#f3f1ec" : i === stage ? "#d9a441" : "#8e8b8566" }} />
                    <span className={`mt-1.5 block ${i === stage ? "text-amber" : "text-[#d5d2cc]"}`}>{t.portal.stages[st]}</span>
                  </li>
                ))}
              </ol>
              <button ref={closeRef} type="button" className="btn" onClick={() => useUi.getState().setYourSlab(null)}>
                {t.common.close}
              </button>
            </motion.div>
          </div>
          {/* the exclusive mark, stamped */}
          <motion.div
            className="absolute end-6 top-6 grid h-28 w-28 place-items-center rounded-full border-2 border-amber text-center md:end-10 md:top-10"
            initial={{ scale: 2.2, opacity: 0, rotate: -24 }}
            animate={{ scale: 1, opacity: 1, rotate: -12 }}
            transition={{ delay: 1.1, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            aria-hidden="true"
          >
            <span className="font-mono px-2 text-[0.62rem] leading-tight tracking-[0.1em] text-amber">
              {lang === "he" ? "בלעדי" : "EXCLUSIVE"}
              <br />
              <span className="ltr-nums">{s.rack.label}</span>
            </span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
