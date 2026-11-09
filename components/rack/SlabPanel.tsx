"use client";

import { motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { CUSTOMER_BY_ID, PROJECT_BY_ID, dimsLabel, twinOf } from "@/lib/data";
import { useSimNow, useYardFlash } from "@/lib/hooks";
import { cycle, useRack } from "@/lib/rack";
import { activeHoldFor, formatCountdown, useDemo } from "@/lib/store";
import { money } from "@/lib/i18n";
import { useT, useUi } from "@/lib/ui";
import type { Slab } from "@/lib/types";
import { goKitchen } from "@/components/nav";

export function StatusChip({ slab }: { slab: Slab }) {
  const { t, lang } = useT();
  const live = useDemo((s) => s.slabs[slab.id]);
  const persona = useUi((s) => s.personaId);
  const hold = useDemo((s) => activeHoldFor(s, slab.id));
  const now = useSimNow(1000);
  const flash = useYardFlash((e) => e.slabId === slab.id);
  if (!live || live.status === "available")
    return (
      <span className="chip" style={{ borderColor: "var(--color-verde)", color: "var(--color-carrara)" }}>
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-verde" style={{ boxShadow: "0 0 0 2px #2e4a3d66" }} />
        {t.slab.inStock}
      </span>
    );
  if (live.status === "sold") {
    const mine = live.soldTo === persona;
    return (
      <span key={flash} className={`chip ${flash ? "flash-amber" : ""}`} style={{ borderColor: "var(--color-rosso)" }}>
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-rosso" />
        {mine ? t.slab.yours : t.slab.sold}
        {!mine && live.soldTo ? ` · ${CUSTOMER_BY_ID[live.soldTo]?.name[lang] ?? ""}` : ""}
      </span>
    );
  }
  const mine = hold?.customerId === persona;
  return (
    <span key={flash} className={`chip chip-amber ${flash ? "flash-amber" : ""}`}>
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber" />
      {mine ? t.slab.heldYou : t.slab.heldOther}
      {hold ? <span className="font-mono ltr-nums">{formatCountdown(hold.expiresAt - now)}</span> : null}
    </span>
  );
}

// Next / Prev used from the keyboard: the panel is replaced (new slab), so the replacement takes the focus back
let refocus: "next" | "prev" | null = null;

export default function SlabPanel({ slab, compact = false, nav = true }: { slab: Slab; compact?: boolean; nav?: boolean }) {
  const { t, lang, arrow } = useT();
  const bookmatch = useRack((s) => s.bookmatch);
  const persona = useUi((s) => s.personaId);
  const projectId = useUi((s) => s.projectId);
  const live = useDemo((s) => s.slabs[slab.id]);
  const hold = useDemo((s) => activeHoldFor(s, slab.id));
  const createHold = useDemo((s) => s.createHold);
  const now = useSimNow(1000);
  const flash = useYardFlash((e) => e.slabId === slab.id);
  const twin = twinOf(slab);
  const mineHold = hold && hold.customerId === persona;
  const mineSold = live?.status === "sold" && live.soldTo === persona;
  const root = useRef<HTMLDivElement>(null);
  const holdChip = useRef<HTMLSpanElement>(null);
  const holdHadFocus = useRef(false);

  // only when the control showed a keyboard focus ring: mouse use and the autopilot's el.click() are unchanged
  const keyboardFocused = (el: HTMLElement) => el === document.activeElement && el.matches(":focus-visible");

  useEffect(() => {
    const sel = refocus;
    refocus = null;
    const a = document.activeElement;
    if (sel && (!a || a === document.body)) root.current?.querySelector<HTMLElement>(`[data-ap="${sel}"]`)?.focus({ preventScroll: true });
  }, []);

  // the countdown chip replaces the Hold button: keep the keyboard focus on it
  useEffect(() => {
    if (mineHold && holdHadFocus.current) {
      holdHadFocus.current = false;
      holdChip.current?.focus({ preventScroll: true });
    }
  }, [mineHold]);

  const step = (e: React.MouseEvent<HTMLButtonElement>, dir: 1 | -1) => {
    if (!useRack.getState().busy && keyboardFocused(e.currentTarget)) refocus = dir > 0 ? "next" : "prev";
    cycle(dir);
  };

  const onHold = (e: React.MouseEvent<HTMLButtonElement>) => {
    holdHadFocus.current = keyboardFocused(e.currentTarget);
    const project = PROJECT_BY_ID[projectId];
    const room = project?.rooms[0]?.id ?? null;
    createHold(slab.id, persona, project?.customerId === persona ? projectId : null, project?.customerId === persona ? room : null);
    useUi.getState().say(`${t.slab.heldYou}: ${slab.name[lang]} ${slab.id}`);
  };

  const spec = (label: string, value: React.ReactNode, mono = true) => (
    <div className="min-w-0">
      <dt className="eyebrow muted !text-[0.62rem]">{label}</dt>
      <dd className={`${mono ? "font-mono text-[0.8rem]" : "text-[0.9rem]"} mt-1 truncate`}>{value}</dd>
    </div>
  );

  return (
    <motion.div
      initial={{ y: 48, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 36, opacity: 0, transition: { duration: 0.35, ease: [0.7, 0, 0.84, 0] } }}
      transition={{ duration: 0.62, ease: [0.16, 1, 0.3, 1] }}
      className={`pointer-events-auto relative text-carrara ${compact ? "px-4 pb-4 pt-5" : "px-6 pb-6 pt-7 md:px-10 md:pb-8"}`}
      style={{
        background: "linear-gradient(to top, #0e0e0e 0%, #0e0e0ef2 62%, #0e0e0e00 100%)",
      }}
      role="region"
      aria-label={`${slab.name[lang]} — ${slab.id}`}
      ref={root}
    >
      <div className={`grid gap-x-8 gap-y-5 ${compact ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-12"} items-end`}>
        {/* name */}
        <div className={compact ? "" : "lg:col-span-4"}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="eyebrow muted">
              <span className="ltr-nums">{slab.rack.label}</span> · {t.slab.kinds[slab.kind]}
            </span>
            <StatusChip slab={slab} />
          </div>
          <h2 className={`font-display mt-3 leading-[0.95] ${compact ? "text-[2.1rem]" : "text-[2.6rem] md:text-[3.6rem]"}`}>
            {slab.name[lang]}
          </h2>
          {lang === "he" && (
            <p className="font-latin mt-1 text-[1.25rem] italic text-vein" lang="it" dir="ltr" style={{ textAlign: "right" }}>
              {slab.name.en}
            </p>
          )}
          <p className={`mt-3 max-w-[46ch] text-[0.88rem] leading-relaxed ${compact ? "hidden" : ""}`} style={{ color: "#d5d2cc" }}>
            <span className="sr-only">{t.slab.description}: </span>
            {slab.desc[lang]}.
          </p>
        </div>

        {/* specs */}
        <dl className={`grid grid-cols-3 gap-x-6 gap-y-3 ${compact ? "" : "lg:col-span-4"} hair-t pt-4 lg:border-t-0 lg:pt-0`}>
          {spec(t.slab.origin, slab.origin[lang], false)}
          {spec(t.slab.finish, t.slab.finishes[slab.finish], false)}
          {spec(t.slab.thickness, <span className="ltr-nums">{slab.thicknessMm} mm</span>)}
          {spec(t.slab.dims, <span className="ltr-nums">{dimsLabel(slab)} mm</span>)}
          {spec(t.slab.id, <span className="ltr-nums">{slab.id}</span>)}
          {spec(
            t.slab.price,
            <span className="ltr-nums">
              {money(lang, slab.priceM2)}/{t.common.m2}
            </span>,
          )}
          <div className="col-span-3 flex items-center gap-2 text-[0.78rem]" style={{ color: "#d5d2cc" }}>
            <span className="inline-block h-px w-6 bg-vein" />
            <span>
              {t.slab.inStock} · <span className="font-mono ltr-nums">{slab.rack.label}</span> ·{" "}
              {t.slab.block} <span className="font-mono ltr-nums">{slab.block}</span> · {t.slab.sequence}{" "}
              <span className="font-mono ltr-nums">
                {slab.seq}/{slab.blockSize}
              </span>
            </span>
          </div>
        </dl>

        {/* actions */}
        <div className={`flex flex-col gap-3 ${compact ? "" : "lg:col-span-4"}`}>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={`btn justify-center ${bookmatch ? "btn-solid" : ""}`}
              aria-pressed={bookmatch}
              data-ap="bookmatch"
              onClick={() => useRack.getState().setBookmatch(!bookmatch)}
            >
              <BookIcon />
              {t.slab.bookmatch}
            </button>
            <button type="button" className="btn justify-center" data-ap="zoom" onClick={() => useUi.getState().openZoom(slab.id)}>
              <LoupeIcon />
              {t.slab.zoom}
            </button>
            <button type="button" className="btn justify-center" data-ap="kitchen" onClick={() => goKitchen(slab.id)}>
              <KitchenIcon />
              {t.slab.kitchen}
            </button>
            {mineSold ? (
              <span className="btn btn-solid justify-center" style={{ background: "var(--color-rosso)", borderColor: "var(--color-rosso)", color: "#f3f1ec" }}>
                {t.slab.yours}
              </span>
            ) : mineHold ? (
              // not a live region: the ticking countdown would be re-announced every second (the hold is announced once by say())
              <span ref={holdChip} tabIndex={-1} className="btn relative isolate justify-center border-amber text-amber" data-ap="hold-chip">
                {/* the yard flash restarts on its own layer, so it doesn't remount the chip and drop its focus */}
                <span key={flash} aria-hidden="true" className={`pointer-events-none absolute inset-0 -z-10 ${flash ? "flash-amber" : ""}`} />
                <span className="live-dot" aria-hidden="true" />
                <span className="sr-only">
                  {t.slab.heldYou} · {t.slab.left}{" "}
                </span>
                <span className="font-mono ltr-nums">{formatCountdown(hold!.expiresAt - now)}</span>
              </span>
            ) : (
              <button
                type="button"
                className="btn btn-amber justify-center"
                data-ap="hold"
                disabled={live?.status !== "available"}
                onClick={onHold}
              >
                <HoldIcon />
                {t.slab.hold}
              </button>
            )}
          </div>
          {bookmatch && (
            <p className="font-mono text-[0.72rem] text-vein">
              {t.slab.twin}: <span className="ltr-nums text-carrara">{twin.id}</span> · {t.slab.seam}{" "}
              <span className="ltr-nums">{slab.heightMm} mm</span>
            </p>
          )}
          {nav && (
            <div className="flex items-center justify-between gap-2">
              <button type="button" className="btn !min-h-[38px] !px-3 text-[0.82rem]" onClick={(e) => step(e, -1)} data-ap="prev">
                <span aria-hidden>{arrow.back}</span> {t.slab.prev}
              </button>
              <button type="button" className="btn !min-h-[38px] !px-3 text-[0.82rem]" onClick={(e) => step(e, 1)} data-ap="next">
                {t.slab.next} <span aria-hidden>{arrow.fwd}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

const ico = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.2, "aria-hidden": true } as const;
export const BookIcon = () => (
  <svg {...ico}>
    <path d="M8 3v10M8 3 2.5 4.5v9L8 13M8 3l5.5 1.5v9L8 13" />
  </svg>
);
export const LoupeIcon = () => (
  <svg {...ico}>
    <circle cx="7" cy="7" r="4.2" />
    <path d="m10.2 10.2 3.3 3.3" />
  </svg>
);
export const KitchenIcon = () => (
  <svg {...ico}>
    <path d="M1.5 9.5h13M2.5 9.5v4M13.5 9.5v4M4 6.5h8" />
  </svg>
);
export const HoldIcon = () => (
  <svg {...ico}>
    <circle cx="8" cy="8" r="5.6" />
    <path d="M8 4.8V8l2.2 1.6" />
  </svg>
);
