"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useId, useState } from "react";
import { CUSTOMERS, cropUrl, PROJECTS, PROJECT_BY_ID, SLAB_BY_ID, STAGES } from "@/lib/data";
import { useSimNow, useYardFlash } from "@/lib/hooks";
import { days, money } from "@/lib/i18n";
import { frontSlab, useRack } from "@/lib/rack";
import { formatCountdown, useDemo } from "@/lib/store";
import { useT, useUi } from "@/lib/ui";
import type { Hold, Job } from "@/lib/types";
import Reveal from "@/components/chrome/Reveal";
import { pullFromRack } from "@/components/nav";
import { yieldSnapshot } from "./YieldCalc";

export function PersonaSwitch({ compact = false }: { compact?: boolean }) {
  const { t, lang } = useT();
  const persona = useUi((s) => s.personaId);
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t.portal.viewingAs}>
      {!compact && <span className="eyebrow muted me-2">{t.portal.viewingAs}</span>}
      {CUSTOMERS.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-pressed={persona === c.id}
          onClick={() => useUi.getState().setPersona(c.id)}
          className="flex items-center gap-2 border px-2.5 py-1.5 text-start transition-colors"
          style={{ borderColor: persona === c.id ? "currentColor" : "var(--hair-strong)" }}
        >
          <span
            className="font-mono grid h-7 w-7 place-items-center rounded-full text-[0.65rem]"
            style={{ background: persona === c.id ? "#d9a441" : "transparent", color: persona === c.id ? "#0e0e0e" : undefined, border: "1px solid var(--hair-strong)" }}
          >
            {c.initials}
          </span>
          <span className="leading-tight">
            <span className="block text-[0.85rem]">{c.name[lang]}</span>
            {!compact && <span className="block text-[0.7rem] muted">{c.role[lang]}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

export function HoldCard({ h, compact = false }: { h: Hold; compact?: boolean }) {
  const { t, lang } = useT();
  const now = useSimNow(1000);
  const s = SLAB_BY_ID[h.slabId];
  const flash = useYardFlash((e) => e.holdId === h.id || e.slabId === h.slabId);
  const left = h.expiresAt - now;
  const frac = Math.max(0, Math.min(1, left / (48 * 3600_000 + h.extended * 24 * 3600_000)));
  if (!s) return null;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="list-none"
    >
      <div key={flash} className={`hair flex gap-4 p-3 ${flash ? "flash-amber" : ""}`} data-ap={`hold-card-${h.slabId}`}>
        <img src={cropUrl(s.id, 400)} alt={s.desc[lang]} className={`${compact ? "h-14 w-20" : "h-20 w-28"} shrink-0 object-cover`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-display truncate text-[1.25rem] leading-tight">{s.name[lang]}</p>
            <span className="font-mono text-[0.68rem] muted ltr-nums">{s.rack.label}</span>
          </div>
          <p className="font-mono text-[0.68rem] muted ltr-nums">{s.id}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="chip" style={h.status === "confirmed" ? { borderColor: "#2e4a3d", color: "inherit" } : undefined}>
              {h.status === "confirmed" ? "✓ " : ""}
              {t.portal.status[h.status]}
            </span>
            {h.extended > 0 && <span className="chip">{t.portal.extended} ×{h.extended}</span>}
          </div>
        </div>
        <div className="text-end">
          <p className="font-mono text-[1.15rem] leading-none ltr-nums" aria-label={`${t.slab.left} ${formatCountdown(left)}`}>
            {formatCountdown(left)}
          </p>
          <p className="mt-1 text-[0.65rem] muted">{t.slab.left}</p>
          <div className="mt-2 h-[3px] w-24 bg-[var(--hair)]">
            <div className="h-full bg-amber" style={{ width: `${frac * 100}%` }} />
          </div>
        </div>
      </div>
    </motion.li>
  );
}

export function OrderTrack({ j, compact = false }: { j: Job; compact?: boolean }) {
  const { t, lang } = useT();
  const s = SLAB_BY_ID[j.slabId];
  const flash = useYardFlash((e) => e.jobId === j.id || e.slabId === j.slabId);
  const idx = STAGES.indexOf(j.stage);
  if (!s) return null;
  return (
    <div key={flash} className={`hair p-4 ${flash ? "flash-amber" : ""}`} data-ap={`order-${j.slabId}`}>
      <div className="flex items-center gap-3">
        <img src={cropUrl(s.id, 400)} alt="" className="h-10 w-14 object-cover" />
        <div className="min-w-0">
          <p className="font-display truncate text-[1.15rem] leading-tight">{s.name[lang]}</p>
          <p className="font-mono text-[0.65rem] muted">
            <span className="ltr-nums">{s.id}</span> · {t.portal.yoursLine.replace("{rack}", s.rack.label)}
          </p>
        </div>
      </div>
      <ol className="mt-4 grid grid-cols-4 gap-1" aria-label={t.portal.order}>
        {STAGES.map((st, i) => (
          <li key={st} className="text-[0.72rem]" aria-current={i === idx ? "step" : undefined}>
            <div className="h-[3px]" style={{ background: i <= idx ? (i === idx ? "#d9a441" : "currentColor") : "var(--hair)" }} />
            <span className={`mt-1.5 block ${i === idx ? "" : "muted"}`}>{t.portal.stages[st]}</span>
          </li>
        ))}
      </ol>
      {!compact && (
        <p className="font-mono mt-3 text-[0.7rem] muted">
          {t.portal.slot}:{" "}
          {j.deliverySlot ? (
            <>
              {j.deliverySlot.day < 0
                ? lang === "he"
                  ? `סופק ${days(lang, j.deliverySlot.day)}`
                  : `delivered ${-j.deliverySlot.day}d`
                : days(lang, j.deliverySlot.day)}{" "}
              · <span className="ltr-nums">{j.deliverySlot.window}</span>
            </>
          ) : (
            t.portal.noSlot
          )}
        </p>
      )}
    </div>
  );
}

export default function Portal() {
  const { t, lang } = useT();
  const persona = useUi((s) => s.personaId);
  const projectId = useUi((s) => s.projectId);
  const holds = useDemo((s) => s.holds);
  const jobs = useDemo((s) => s.jobs);
  const quotes = useDemo((s) => s.quotes);
  const pstate = useDemo((s) => s.projects[projectId]);
  const liveSlabs = useDemo((s) => s.slabs);
  const project = PROJECT_BY_ID[projectId];
  const myProjects = PROJECTS.filter((p) => p.customerId === persona);
  const myHolds = holds.filter((h) => h.customerId === persona && (h.status === "pending" || h.status === "confirmed"));
  const myJobs = jobs.filter((j) => j.customerId === persona);
  const myQuote = quotes.find((q) => q.projectId === projectId);
  const quoteFlash = useYardFlash((e) => e.type === "quote.sent" && e.customerId === persona);
  const [pdfBusy, setPdfBusy] = useState(false);
  const uid = useId();
  useRack((s) => s.index);

  const requestQuote = async () => {
    setPdfBusy(true);
    const rooms = pstate?.rooms ?? {};
    const slabIds = [...new Set(Object.values(rooms).flat())];
    const layout = pstate?.layouts[0] ?? null;
    const items = slabIds.map((id) => SLAB_BY_ID[id]).filter(Boolean);
    const estimate = layout?.total ?? items.reduce((a, s) => a + s.areaM2 * s.priceM2, 0) * 1.18;
    useDemo.getState().requestQuote(projectId, persona, Math.round(estimate));
    try {
      const r = await fetch("/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lang,
          projectId,
          customerId: persona,
          slabIds,
          layout,
          yieldInput: yieldSnapshot.current?.input ?? null,
          renders: (pstate?.renders ?? []).slice(0, 2).map((r) => r.thumb),
        }),
      });
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fervital-quote-${projectId}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <section id="portal" className="paper stone-edge-top relative" aria-labelledby="portal-title">
      <div className="mx-auto max-w-[1440px] px-6 pb-28 pt-28 md:px-10">
        <div className="grid gap-8 lg:grid-cols-12">
          <Reveal className="lg:col-span-3">
            <p className="eyebrow muted">{t.portal.eyebrow}</p>
          </Reveal>
          <div className="lg:col-span-9">
            <Reveal>
              <h2 id="portal-title" className="font-display text-[clamp(2.6rem,6vw,6rem)] leading-[0.95]">
                {t.portal.title}
              </h2>
            </Reveal>
            <div className="mt-8">
              <PersonaSwitch />
            </div>
            <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label={t.portal.project}>
              {myProjects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={projectId === p.id}
                  onClick={() => useUi.getState().setProject(p.id)}
                  className="border-b-2 px-1 pb-2 text-[0.95rem] transition-colors"
                  style={{ borderColor: projectId === p.id ? "#0e0e0e" : "transparent", opacity: projectId === p.id ? 1 : 0.6 }}
                >
                  {p.name[lang]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-14 grid gap-10 lg:grid-cols-12">
          {/* holds */}
          <div className="lg:col-span-4">
            <h3 className="eyebrow muted">{t.portal.holds}</h3>
            <ul className="mt-4 grid gap-3">
              <AnimatePresence initial={false}>
                {myHolds.map((h) => (
                  <HoldCard key={h.id} h={h} />
                ))}
              </AnimatePresence>
              {!myHolds.length && <li className="muted text-[0.9rem]">{t.portal.noHolds}</li>}
            </ul>
            {myJobs.length > 0 && (
              <>
                <h3 className="eyebrow muted mt-10">{t.portal.order}</h3>
                <div className="mt-4 grid gap-3">
                  {myJobs.map((j) => (
                    <OrderTrack key={j.id} j={j} />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* project board */}
          <div className="lg:col-span-5">
            <h3 className="eyebrow muted">
              {t.portal.board} · {project?.name[lang]}
            </h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {project?.rooms.map((room) => {
                const ids = pstate?.rooms[room.id] ?? [];
                return (
                  <div key={room.id} className="hair p-3">
                    <div className="flex items-center justify-between">
                      <p className="font-display text-[1.3rem]">{room.name[lang]}</p>
                      <span className="font-mono text-[0.65rem] muted">{ids.length}</span>
                    </div>
                    <ul className="mt-3 grid gap-2">
                      {ids.map((id) => {
                        const s = SLAB_BY_ID[id];
                        const st = liveSlabs[id]?.status ?? "available";
                        return (
                          <li key={id} className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => pullFromRack(id)}
                              className="flex min-w-0 flex-1 items-center gap-2 text-start"
                              aria-describedby={`${uid}-${room.id}-${id}`}
                            >
                              <img src={cropUrl(id, 400)} alt="" className="h-8 w-12 shrink-0 object-cover" />
                              <span className="min-w-0">
                                <span className="block truncate text-[0.85rem]">{s?.name[lang]}</span>
                                <span className="font-mono block text-[0.6rem] muted ltr-nums">{id}</span>
                              </span>
                            </button>
                            {/* status as text, not only the dot colour */}
                            <span id={`${uid}-${room.id}-${id}`} className="flex shrink-0 items-center gap-1.5 text-[0.7rem] muted">
                              <span
                                aria-hidden="true"
                                className="h-2 w-2 rounded-full"
                                style={{ background: st === "sold" ? "#7a2e2e" : st === "held" ? "#d9a441" : "#2e4a3d" }}
                              />
                              {t.yard.legend[st]}
                            </span>
                          </li>
                        );
                      })}
                      {!ids.length && <li className="text-[0.8rem] muted">{t.portal.emptyRoom}</li>}
                    </ul>
                    <button
                      type="button"
                      className="mt-3 text-[0.75rem] underline underline-offset-4 muted"
                      onClick={() => useDemo.getState().addToRoom(projectId, room.id, frontSlab().id)}
                    >
                      + {t.portal.addCurrent}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              <div>
                <h4 className="eyebrow muted">{t.portal.renders}</h4>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {(pstate?.renders ?? []).map((r) => (
                    <figure key={r.id} className="m-0">
                      <img src={r.thumb} alt={`${SLAB_BY_ID[r.slabId]?.name[lang]} — ${r.scene}`} className="w-full" />
                      <figcaption className="font-mono mt-1 text-[0.6rem] muted ltr-nums">{r.slabId}</figcaption>
                    </figure>
                  ))}
                  {!pstate?.renders.length && <p className="col-span-2 text-[0.8rem] muted">{t.portal.none}</p>}
                </div>
              </div>
              <div>
                <h4 className="eyebrow muted">{t.portal.layouts}</h4>
                <ul className="mt-3 grid gap-2">
                  {(pstate?.layouts ?? []).map((l) => (
                    <li key={l.id} className="hair p-2 text-[0.8rem]">
                      {l.summary[lang]}
                      <span className="font-mono block text-[0.65rem] muted">
                        {l.seams} {t.yield.seams} · <span className="ltr-nums">{money(lang, l.total)}</span>
                      </span>
                    </li>
                  ))}
                  {!pstate?.layouts.length && <li className="text-[0.8rem] muted">{t.portal.none}</li>}
                </ul>
              </div>
            </div>
          </div>

          {/* quote */}
          <div className="lg:col-span-3">
            <h3 className="eyebrow muted">{t.portal.quote}</h3>
            <div key={quoteFlash} className={`hair mt-4 p-4 ${quoteFlash ? "flash-amber" : ""}`}>
              <p className="text-[0.9rem] muted">{project?.name[lang]}</p>
              {myQuote && (
                <p className="mt-3 text-[0.9rem]">
                  {myQuote.status === "sent" ? `✓ ${t.portal.quoteReady}` : t.portal.quoteSent}
                  <span className="font-mono block text-[1.4rem] ltr-nums">{money(lang, myQuote.total)}</span>
                  <span className="text-[0.7rem] muted">{t.portal.total}</span>
                </p>
              )}
              <button type="button" className="btn btn-solid mt-4 w-full justify-center" onClick={requestQuote} disabled={pdfBusy} data-ap="quote">
                {pdfBusy ? "…" : t.portal.quote}
              </button>
              <p className="mt-2 text-[0.7rem] muted">{t.portal.pdf} · {t.yield.note}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
