"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import { CUSTOMER_BY_ID, cropUrl, PROJECT_BY_ID, SLAB_BY_ID, SLABS, STAGES } from "@/lib/data";
import { useCustomerArrival, useSimNow } from "@/lib/hooks";
import { money } from "@/lib/i18n";
import { formatCountdown, HOUR, useDemo } from "@/lib/store";
import { useT } from "@/lib/ui";
import type { Hold, Job } from "@/lib/types";

const STATUS_COLOR = { available: "#2e4a3d", held: "#d9a441", sold: "#7a2e2e" } as const;

export default function YardDesk({ compact = false }: { compact?: boolean }) {
  const { t, lang } = useT();
  const slabs = useDemo((s) => s.slabs);
  const holds = useDemo((s) => s.holds);
  const jobs = useDemo((s) => s.jobs);
  const quotes = useDemo((s) => s.quotes);
  const events = useDemo((s) => s.events);
  const clock = useDemo((s) => s.clock);
  const now = useSimNow(1000);
  const open = holds.filter((h) => h.status === "pending" || h.status === "confirmed");
  const counts = useMemo(() => {
    const c = { available: 0, held: 0, sold: 0 };
    for (const s of Object.values(slabs)) c[s.status]++;
    return c;
  }, [slabs]);
  const expiring = open.filter((h) => h.expiresAt - now < 24 * HOUR).length;
  const arrival = useCustomerArrival((e) => e.type === "hold.created" || e.type === "quote.requested");

  return (
    <div className={`relative bg-basalt text-carrara ${compact ? "px-4 pb-10 pt-4" : "px-6 pb-24 pt-[calc(var(--header-h)+32px)] md:px-10"}`} id="yard">
      <div className="grain pointer-events-none absolute inset-0" />
      <div className="relative">
        {/* header */}
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="eyebrow text-vein">{t.yard.subtitle}</p>
            <h2 className={`font-display mt-2 leading-none ${compact ? "text-[2.2rem]" : "text-[clamp(2.8rem,5vw,4.8rem)]"}`}>{t.yard.title}</h2>
          </div>
          <dl className="flex flex-wrap gap-x-8 gap-y-3">
            {(
              [
                ["available", counts.available, STATUS_COLOR.available],
                ["held", counts.held, STATUS_COLOR.held],
                ["sold", counts.sold, STATUS_COLOR.sold],
                ["expiring", expiring, "#8e8b85"],
              ] as const
            ).map(([k, v, c]) => (
              <div key={k}>
                <dt className="eyebrow flex items-center gap-2 text-vein !text-[0.6rem]">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
                  {t.yard.kpi[k]}
                </dt>
                <dd className="font-mono mt-1 text-[1.6rem] leading-none ltr-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex items-center gap-2">
            <span className="eyebrow text-vein !text-[0.6rem]">{t.yard.clock}</span>
            <span className="font-mono text-[0.75rem] ltr-nums">{new Date(now).toLocaleString(lang === "he" ? "he-IL" : "en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>
            <div className="flex border border-[var(--hair-strong)]" role="group" aria-label={t.yard.clock}>
              {[1, 60, 3600].map((sp) => (
                <button
                  key={sp}
                  type="button"
                  aria-pressed={clock.speed === sp}
                  onClick={() => useDemo.getState().setSpeed(sp)}
                  className="font-mono h-8 px-2 text-[0.7rem]"
                  style={clock.speed === sp ? { background: "#d9a441", color: "#0e0e0e" } : undefined}
                >
                  ×{sp}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={`mt-8 grid gap-8 ${compact ? "" : "xl:grid-cols-12"}`}>
          {/* inbox */}
          <section className={compact ? "" : "xl:col-span-4"} aria-labelledby="inbox-h" data-fly-dst>
            <div className="flex items-center justify-between">
              <h3 id="inbox-h" className="eyebrow text-vein">
                {t.yard.inbox} <span className="font-mono text-carrara">· {open.length}</span>
              </h3>
              {arrival > 0 && (
                <motion.span key={arrival} className="chip chip-amber" initial={{ scale: 1.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                  {t.yard.isNew}
                </motion.span>
              )}
            </div>
            <ul className="mt-4 grid gap-3" data-ap="yard-inbox">
              <AnimatePresence initial={false}>
                {open.map((h) => (
                  <InboxCard key={h.id} h={h} now={now} compact={compact} />
                ))}
              </AnimatePresence>
              {!open.length && <li className="text-[0.85rem] text-vein">{t.yard.inboxEmpty}</li>}
            </ul>
          </section>

          {/* production board */}
          <section className={compact ? "" : "xl:col-span-8"} aria-labelledby="prod-h">
            <h3 id="prod-h" className="eyebrow text-vein">
              {t.yard.production}
            </h3>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4" data-ap="yard-production">
              {STAGES.map((st) => (
                <div key={st} className="min-h-[120px] border-t border-[var(--hair-strong)] pt-3">
                  <p className="font-mono flex items-center justify-between text-[0.7rem] uppercase tracking-[0.12em] text-vein">
                    {t.portal.stages[st]} <span>{jobs.filter((j) => j.stage === st).length}</span>
                  </p>
                  <ul className="mt-3 grid gap-2">
                    <AnimatePresence initial={false}>
                      {jobs
                        .filter((j) => j.stage === st)
                        .map((j) => (
                          <JobCard key={j.id} j={j} />
                        ))}
                    </AnimatePresence>
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {/* rack wall */}
          <section className={compact ? "" : "xl:col-span-8"} aria-labelledby="wall-h">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 id="wall-h" className="eyebrow text-vein">
                {t.yard.wall}
              </h3>
              <ul className="flex gap-4 text-[0.72rem]">
                {(["available", "held", "sold"] as const).map((k) => (
                  <li key={k} className="flex items-center gap-1.5">
                    <span className="h-2 w-3" style={{ background: STATUS_COLOR[k] }} />
                    {t.yard.legend[k]}
                  </li>
                ))}
              </ul>
            </div>
            <RackWall compact={compact} />
          </section>

          {/* quotes + log */}
          <section className={`grid gap-8 ${compact ? "" : "xl:col-span-4"}`}>
            <div>
              <h3 className="eyebrow text-vein">{t.yard.quotes}</h3>
              <ul className="mt-3 grid gap-2">
                {quotes.map((q) => (
                  <li key={q.id} className="hair flex items-center gap-3 p-2 text-[0.8rem]">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{CUSTOMER_BY_ID[q.customerId]?.name[lang]}</span>
                      <span className="block truncate text-[0.68rem] text-vein">{PROJECT_BY_ID[q.projectId]?.name[lang]}</span>
                    </span>
                    <span className="font-mono ltr-nums">{money(lang, q.total)}</span>
                    {q.status === "sent" ? (
                      <span className="chip">{t.yard.sent}</span>
                    ) : (
                      <button type="button" className="btn !min-h-[30px] !px-2 text-[0.72rem]" onClick={() => useDemo.getState().sendQuote(q.id)}>
                        {t.yard.markSent}
                      </button>
                    )}
                  </li>
                ))}
                {!quotes.length && <li className="text-[0.8rem] text-vein">—</li>}
              </ul>
            </div>
            <div>
              <h3 className="eyebrow text-vein">{t.yard.log}</h3>
              <ol className="font-mono mt-3 grid max-h-[320px] gap-1.5 overflow-auto pe-1 text-[0.7rem] pane-scroll" aria-live="polite">
                {events.slice(0, 40).map((e) => (
                  <li key={e.id} className="flex gap-2">
                    <span className="shrink-0 text-vein ltr-nums">{new Date(e.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                    <span
                      className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: e.actor === "customer" ? "#f3f1ec" : e.actor === "yard" ? "#d9a441" : "#8e8b85" }}
                    />
                    <span className="text-[#d5d2cc]" style={{ fontFamily: "var(--font-ui)" }}>
                      {e.text[lang]}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function InboxCard({ h, now, compact }: { h: Hold; now: number; compact: boolean }) {
  const { t, lang } = useT();
  const s = SLAB_BY_ID[h.slabId];
  const c = CUSTOMER_BY_ID[h.customerId];
  const fresh = Date.now() - (useDemo.getState().events.find((e) => e.holdId === h.id && e.type === "hold.created")?.real ?? 0) < 6000;
  const api = useDemo.getState();
  if (!s) return null;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: 40, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="list-none"
      data-ap={`inbox-${h.slabId}`}
    >
      <div className={`hair p-3 ${fresh ? "flash-amber" : ""}`} style={fresh ? { borderColor: "#d9a441" } : undefined}>
        <div className="flex gap-3">
          <img src={cropUrl(s.id, 400)} alt={s.desc[lang]} className={`${compact ? "h-12 w-16" : "h-14 w-20"} shrink-0 object-cover`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-mono truncate text-[0.8rem] ltr-nums">{s.id}</p>
              <p className="font-mono shrink-0 text-[0.95rem] text-amber ltr-nums">{s.rack.label}</p>
            </div>
            <p className="truncate text-[0.85rem]">{s.name[lang]}</p>
            <p className="truncate text-[0.72rem] text-vein">
              {c?.name[lang]} · {c?.role[lang]}
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="chip" style={h.status === "confirmed" ? { borderColor: "#2e4a3d" } : { borderColor: "#d9a441", color: "#d9a441" }}>
            {h.status === "confirmed" ? "✓ " : ""}
            {t.portal.status[h.status]}
          </span>
          <span className="font-mono text-[0.78rem] ltr-nums">
            <span className="text-vein">{t.yard.expiresIn} </span>
            {formatCountdown(h.expiresAt - now)}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          <button type="button" className="btn !min-h-[34px] justify-center !px-2 text-[0.75rem]" disabled={h.status === "confirmed"} onClick={() => api.confirmHold(h.id)} data-ap={`confirm-${h.slabId}`}>
            {t.yard.confirm}
          </button>
          <button type="button" className="btn !min-h-[34px] justify-center !px-2 text-[0.75rem]" onClick={() => api.extendHold(h.id, 24)}>
            {t.yard.extend}
          </button>
          <button type="button" className="btn !min-h-[34px] justify-center !px-2 text-[0.75rem]" onClick={() => api.releaseHold(h.id)}>
            {t.yard.release}
          </button>
          <button type="button" className="btn btn-amber !min-h-[34px] justify-center !px-2 text-[0.75rem]" onClick={() => api.convertHold(h.id)} data-ap={`convert-${h.slabId}`}>
            {t.yard.convert}
          </button>
        </div>
      </div>
    </motion.li>
  );
}

const WINDOWS = ["07:00–10:00", "10:00–13:00", "13:00–16:00"];

function JobCard({ j }: { j: Job }) {
  const { t, lang } = useT();
  const s = SLAB_BY_ID[j.slabId];
  const c = CUSTOMER_BY_ID[j.customerId];
  const [slotOpen, setSlotOpen] = useState(false);
  const idx = STAGES.indexOf(j.stage);
  const next = STAGES[idx + 1];
  if (!s) return null;
  return (
    <motion.li layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="list-none" data-ap={`job-${j.slabId}`}>
      <div className="hair p-2">
        <div className="flex items-center gap-2">
          <img src={cropUrl(s.id, 400)} alt="" className="h-8 w-10 shrink-0 object-cover" />
          <div className="min-w-0">
            <p className="font-mono truncate text-[0.68rem] ltr-nums">{s.id}</p>
            <p className="truncate text-[0.7rem] text-vein">{c?.name[lang]}</p>
          </div>
        </div>
        <p className="mt-1.5 truncate text-[0.65rem] text-vein">
          {t.yard.exclusive.replace("{name}", c?.name[lang] ?? "")}
        </p>
        <p className="font-mono mt-1 text-[0.65rem] ltr-nums">
          {j.deliverySlot ? `${j.deliverySlot.day >= 0 ? "+" : ""}${j.deliverySlot.day}d · ${j.deliverySlot.window}` : <span className="text-vein">{t.portal.noSlot}</span>}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {next && (
            <button type="button" className="btn !min-h-[28px] !px-2 text-[0.68rem]" onClick={() => useDemo.getState().advanceJob(j.id)} data-ap={`advance-${j.slabId}`}>
              → {t.portal.stages[next]}
            </button>
          )}
          {j.stage !== "delivered" && (
            <button type="button" className="btn !min-h-[28px] !px-2 text-[0.68rem]" onClick={() => setSlotOpen((o) => !o)} aria-expanded={slotOpen} data-ap={`slot-${j.slabId}`}>
              {t.yard.setSlot}
            </button>
          )}
        </div>
        {slotOpen && (
          <div className="mt-2 grid gap-1">
            {[2, 3, 5].flatMap((d) =>
              WINDOWS.slice(0, 2).map((w) => (
                <button
                  key={`${d}${w}`}
                  type="button"
                  className="font-mono border border-[var(--hair)] px-2 py-1 text-start text-[0.65rem] hover:border-amber ltr-nums"
                  onClick={() => {
                    useDemo.getState().setSlot(j.id, d, w);
                    setSlotOpen(false);
                  }}
                >
                  +{d}d · {w}
                </button>
              )),
            )}
          </div>
        )}
      </div>
    </motion.li>
  );
}

function RackWall({ compact }: { compact: boolean }) {
  const { lang } = useT();
  const slabs = useDemo((s) => s.slabs);
  const racks = ["A", "B", "C"] as const;
  return (
    <div className="mt-4 grid gap-4">
      {racks.map((r) => (
        <div key={r} className="flex items-stretch gap-3">
          <span className="font-mono w-6 shrink-0 pt-1 text-[0.75rem] text-vein">{r}</span>
          <ul className="grid flex-1 gap-[3px]" style={{ gridTemplateColumns: `repeat(${compact ? 20 : 40}, minmax(0, 1fr))` }}>
            {SLABS.filter((s) => s.rack.rack === r).map((s) => {
              const st = slabs[s.id]?.status ?? "available";
              return (
                <li key={s.id} title={`${s.rack.label} · ${s.id} · ${s.name[lang]}`} className="relative" data-ap={`wall-${s.id}`}>
                  <div className="aspect-[3/5] w-full" style={{ background: s.mean, opacity: st === "available" ? 0.9 : 1 }} />
                  <motion.div
                    className="absolute inset-x-0 bottom-0"
                    animate={{ height: st === "available" ? 3 : "100%", background: STATUS_COLOR[st], opacity: st === "available" ? 1 : 0.62 }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  />
                  <span className="sr-only">
                    {s.rack.label} {s.name[lang]} — {st}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
