"use client";

import { motion } from "framer-motion";
import { useId, useMemo, useState } from "react";
import { cropUrl, RACK_A, SLAB_BY_ID } from "@/lib/data";
import { money, nf } from "@/lib/i18n";
import { useDemo } from "@/lib/store";
import { useRack } from "@/lib/rack";
import { useT, useUi } from "@/lib/ui";
import { computeYield, type YieldInput, type YieldResult } from "@/lib/yield";
import type { Slab } from "@/lib/types";
import Reveal from "@/components/chrome/Reveal";

export const yieldSnapshot: { current: { slabId: string; result: YieldResult; input: YieldInput } | null } = { current: null };

function NumField({ label, value, onChange, step = 10, min = 0, max = 9000, unit = "mm" }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="eyebrow text-vein !text-[0.62rem]">
        {label}
      </label>
      <div className="mt-1 flex items-center gap-2 border-b border-[var(--hair-strong)] focus-within:border-amber">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
          className="font-mono w-full bg-transparent py-2 text-[1.05rem] text-carrara focus:outline-none ltr-nums"
          dir="ltr"
        />
        <span className="font-mono text-[0.7rem] text-vein">{unit}</span>
      </div>
    </div>
  );
}

export default function YieldCalc() {
  const { t, lang } = useT();
  const rackIndex = useRack((s) => s.index);
  const [slabId, setSlabId] = useState<string>(RACK_A[0].id);
  const slab = SLAB_BY_ID[slabId];
  const [inp, setInp] = useState({
    worktopL: 3600,
    worktopD: 620,
    returnL: 2400,
    islandL: 2800,
    islandW: 1100,
    waterfalls: 2 as 0 | 1 | 2,
    splashH: 0,
    veinMatch: true,
  });
  const set = <K extends keyof typeof inp>(k: K, v: (typeof inp)[K]) => setInp((s) => ({ ...s, [k]: v }));
  const input: YieldInput = useMemo(
    () => ({ ...inp, slabL: slab.lengthMm, slabH: slab.heightMm, thickness: slab.thicknessMm, priceM2: slab.priceM2 }),
    [inp, slab],
  );
  const r = useMemo(() => computeYield(input), [input]);
  yieldSnapshot.current = { slabId, result: r, input };
  const [attached, setAttached] = useState(false);

  const attach = () => {
    const ui = useUi.getState();
    useDemo.getState().attachLayout(ui.projectId, {
      slabId,
      slabs: r.slabCount,
      yieldPct: Math.round(r.yieldPct),
      wasteM2: Math.round(r.wasteM2 * 100) / 100,
      seams: r.seams.length,
      total: Math.round(r.price.total),
      summary: {
        he: `${slab.name.he} · ${r.slabCount} לוחות · ניצולת ${Math.round(r.yieldPct)}%`,
        en: `${slab.name.en} · ${r.slabCount} slabs · ${Math.round(r.yieldPct)}% yield`,
      },
    });
    setAttached(true);
    window.setTimeout(() => setAttached(false), 2400);
  };

  const options = useMemo(() => {
    const seen = new Set<string>();
    return RACK_A.filter((s) => (seen.has(s.tex) ? false : (seen.add(s.tex), true)));
  }, []);

  return (
    <section id="yield" className="stone-edge-top relative bg-basalt text-carrara" aria-labelledby="yield-title">
      <div className="grain pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-[1440px] px-6 pb-28 pt-28 md:px-10">
        <div className="grid gap-8 lg:grid-cols-12">
          <Reveal className="lg:col-span-3">
            <p className="eyebrow text-vein">{t.yield.eyebrow}</p>
          </Reveal>
          <div className="lg:col-span-9">
            <Reveal>
              <h2 id="yield-title" className="font-display text-[clamp(2.6rem,6vw,6rem)] leading-[0.95]">
                {t.yield.title}
              </h2>
            </Reveal>
            <Reveal delay={0.08}>
              <p className="mt-6 max-w-[62ch] text-[1.05rem] leading-relaxed text-[#d5d2cc]">{t.yield.lead}</p>
            </Reveal>
          </div>
        </div>

        <div className="mt-16 grid gap-12 lg:grid-cols-12">
          {/* inputs */}
          <form className="grid content-start gap-8 lg:col-span-4" onSubmit={(e) => e.preventDefault()}>
            <fieldset>
              <legend className="font-display text-[1.6rem]">{t.yield.worktop}</legend>
              <div className="mt-3 grid grid-cols-2 gap-5">
                <NumField label={t.yield.length} value={inp.worktopL} onChange={(v) => set("worktopL", v)} />
                <NumField label={t.yield.depth} value={inp.worktopD} onChange={(v) => set("worktopD", v)} max={1200} />
                <NumField label={t.yield.ret} value={inp.returnL} onChange={(v) => set("returnL", v)} />
                <NumField label={`${t.yield.backsplash} — ${t.yield.height}`} value={inp.splashH} onChange={(v) => set("splashH", v)} max={1400} />
              </div>
            </fieldset>
            <fieldset>
              <legend className="font-display text-[1.6rem]">{t.yield.island}</legend>
              <div className="mt-3 grid grid-cols-2 gap-5">
                <NumField label={t.yield.length} value={inp.islandL} onChange={(v) => set("islandL", v)} />
                <NumField label={t.yield.width} value={inp.islandW} onChange={(v) => set("islandW", v)} max={1700} />
              </div>
              <div className="mt-5">
                <span className="eyebrow text-vein !text-[0.62rem]">{t.yield.waterfall}</span>
                <div className="mt-2 flex border border-[var(--hair-strong)]" role="radiogroup" aria-label={t.yield.waterfall}>
                  {([0, 1, 2] as const).map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={inp.waterfalls === n}
                      onClick={() => set("waterfalls", n)}
                      className="font-mono h-10 flex-1 text-[0.85rem]"
                      style={inp.waterfalls === n ? { background: "#f3f1ec", color: "#0e0e0e" } : undefined}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </fieldset>
            <fieldset>
              <legend className="font-display text-[1.6rem]">{t.kitchen.slab}</legend>
              <label htmlFor="yield-slab" className="sr-only">
                {t.kitchen.slab}
              </label>
              <select
                id="yield-slab"
                value={slabId}
                onChange={(e) => setSlabId(e.target.value)}
                className="mt-3 h-11 w-full border border-[var(--hair-strong)] bg-basalt px-3 text-[0.95rem] text-carrara"
              >
                {[RACK_A[rackIndex], ...options.filter((o) => o.id !== RACK_A[rackIndex].id)].map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name[lang]} · {s.id} · {s.lengthMm}×{s.heightMm}
                  </option>
                ))}
              </select>
              <label className="mt-5 flex cursor-pointer items-start gap-3">
                <input type="checkbox" checked={inp.veinMatch} onChange={(e) => set("veinMatch", e.target.checked)} className="mt-1 h-4 w-4 accent-[#d9a441]" />
                <span>
                  <span className="block text-[0.95rem]">{t.yield.veins}</span>
                  <span className="block text-[0.8rem] text-vein">{t.yield.veinsHelp}</span>
                </span>
              </label>
            </fieldset>
          </form>

          {/* outputs */}
          <div className="lg:col-span-8">
            <dl className="grid grid-cols-2 border-t border-[var(--hair-strong)] md:grid-cols-4">
              {[
                [t.yield.yield, `${nf(lang, r.yieldPct, 1)}%`],
                [t.yield.waste, `${nf(lang, r.wasteM2, 2)} ${t.common.m2}`],
                [t.yield.slabs, String(r.slabCount)],
                [t.yield.seams, String(r.seams.length)],
              ].map(([l, v]) => (
                <div key={l} className="border-b border-[var(--hair)] py-5 pe-4 md:border-e md:last:border-e-0 md:ps-5 md:first:ps-0">
                  <dt className="eyebrow text-vein !text-[0.62rem]">{l}</dt>
                  <dd className="font-mono mt-2 whitespace-nowrap text-[clamp(1.4rem,2.4vw,2.2rem)] leading-none ltr-nums">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-10 grid gap-10 xl:grid-cols-5">
              <div className="xl:col-span-2">
                <p className="eyebrow mb-3 text-vein">{lang === "he" ? "תוכנית — מבט על" : "Plan — top view"}</p>
                <PlanView input={input} result={r} slab={slab} />
                <ul className="font-mono mt-4 grid gap-1 text-[0.72rem] text-[#d5d2cc]">
                  {r.seams.length === 0 && <li>{t.yield.noSeams}</li>}
                  {r.seams.map((s, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="inline-block h-px w-5 border-t border-dashed border-amber" />
                      {t.yield.pieces[s.kind]} — {s.atMm === 0 ? (lang === "he" ? "חיבור פינה" : "corner joint") : `${t.yield.seamAt.replace("{mm}", nf(lang, s.atMm))}`}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="xl:col-span-3">
                <p className="eyebrow mb-3 text-vein">{lang === "he" ? "חיתוך על הלוחות" : "Nesting on the slabs"}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {r.slabs.map((placed, i) => (
                    <SlabNest key={i} n={i + 1} slab={slab} placed={placed} />
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-12 grid gap-8 md:grid-cols-2">
              <table className="w-full text-[0.9rem]">
                <caption className="eyebrow mb-3 text-start text-vein">{t.yield.price}</caption>
                <tbody className="font-mono">
                  {(
                    [
                      ["stone", r.price.stone, `${r.slabCount} × ${nf(lang, (slab.lengthMm * slab.heightMm) / 1e6, 2)} ${t.common.m2} × ${money(lang, slab.priceM2)}`],
                      ["fab", r.price.fab, ""],
                      ["cutouts", r.price.cutouts, ""],
                      ["waterfalls", r.price.waterfalls, ""],
                      ["install", r.price.install, ""],
                      ["vat", r.price.vat, ""],
                    ] as const
                  ).map(([k, v, note]) => (
                    <tr key={k} className="border-b border-[var(--hair)]">
                      <th scope="row" className="py-2.5 text-start font-[400] text-[#d5d2cc]" style={{ fontFamily: "var(--font-ui)" }}>
                        {t.yield.lines[k]}
                        {note && <span className="block text-[0.7rem] text-vein ltr-nums">{note}</span>}
                      </th>
                      <td className="py-2.5 text-end ltr-nums">{money(lang, v)}</td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row" className="pt-4 text-start text-[1rem]" style={{ fontFamily: "var(--font-ui)" }}>
                      {t.yield.lines.total}
                    </th>
                    <td className="pt-4 text-end text-[1.5rem] text-amber ltr-nums">{money(lang, r.price.total)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="flex flex-col justify-end gap-3">
                <p className="text-[0.8rem] text-vein">{t.yield.note}</p>
                <button type="button" className="btn btn-solid justify-center" onClick={attach}>
                  {attached ? t.yield.attached : t.yield.attach}
                </button>
                <a href="#portal" className="btn justify-center" onClick={(e) => { e.preventDefault(); document.getElementById("portal")?.scrollIntoView({ behavior: "smooth" }); }}>
                  {t.portal.quote} →
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SlabNest({ n, slab, placed }: { n: number; slab: Slab; placed: YieldResult["slabs"][number] }) {
  const { t } = useT();
  const uid = useId().replace(/:/g, "");
  const W = slab.lengthMm;
  const H = slab.heightMm;
  const TRIM = 15;
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`${t.yield.slabN.replace("{n}", String(n))}: ${placed.map((p) => `${t.yield.pieces[p.kind]} ${p.w}×${p.h}`).join(", ")}`}>
        <defs>
          <pattern id={`h${uid}`} width="60" height="60" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="60" height="60" fill="#0e0e0e" fillOpacity="0.62" />
            <line x1="0" y1="0" x2="0" y2="60" stroke="#8e8b85" strokeWidth="6" strokeOpacity="0.55" />
          </pattern>
          {placed.map((p, i) => (
            <clipPath key={i} id={`c${uid}${i}`}>
              <rect x={TRIM + p.x} y={TRIM + p.y} width={p.rotated ? p.h : p.w} height={p.rotated ? p.w : p.h} />
            </clipPath>
          ))}
        </defs>
        <image href={cropUrl(slab.id, 960)} x="0" y="0" width={W} height={H} preserveAspectRatio="none" />
        <rect x="0" y="0" width={W} height={H} fill={`url(#h${uid})`} />
        {placed.map((p, i) => {
          const w = p.rotated ? p.h : p.w;
          const h = p.rotated ? p.w : p.h;
          return (
            <motion.g key={`${p.pieceId}-${p.seg}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05, duration: 0.5 }}>
              <image href={cropUrl(slab.id, 960)} x="0" y="0" width={W} height={H} preserveAspectRatio="none" clipPath={`url(#c${uid}${i})`} />
              <rect x={TRIM + p.x} y={TRIM + p.y} width={w} height={h} fill="none" stroke="#f3f1ec" strokeWidth="9" />
              <rect x={TRIM + p.x + 12} y={TRIM + p.y + 12} width={Math.min(w - 24, 560)} height="130" fill="#0e0e0e" fillOpacity="0.85" />
              <text x={TRIM + p.x + 32} y={TRIM + p.y + 92} fill="#f3f1ec" fontSize="78" fontFamily="IBM Plex Mono, monospace" direction="ltr">
                {t.yield.pieces[p.kind]}
                {p.segs > 1 ? ` ${p.seg}/${p.segs}` : ""} {p.w}×{p.h}
              </text>
            </motion.g>
          );
        })}
      </svg>
      <figcaption className="font-mono mt-2 flex justify-between text-[0.68rem] text-vein">
        <span>{t.yield.slabN.replace("{n}", String(n))}</span>
        <span className="ltr-nums">
          {slab.id} · {W}×{H}
        </span>
      </figcaption>
    </figure>
  );
}

function PlanView({ input, result, slab }: { input: YieldInput; result: YieldResult; slab: Slab }) {
  const { t } = useT();
  const uid = useId().replace(/:/g, "");
  const D = input.worktopD;
  const Lw = input.worktopL;
  const Lr = input.returnL;
  const gap = 1100;
  const hasIsland = input.islandL > 0 && input.islandW > 0;
  const W = Math.max(Lw, hasIsland ? input.islandL + 400 : 0) + 200;
  const H = Math.max(Lr, D + (hasIsland ? gap + input.islandW : 0)) + 200;
  const islandX = Math.max(100, (Lw - input.islandL) / 2 + 100);
  const islandY = 100 + D + gap;
  const seam = (kind: string) => result.seams.filter((s) => s.kind === kind && s.atMm > 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={t.yield.title}>
      <defs>
        <pattern id={`t${uid}`} patternUnits="userSpaceOnUse" width={slab.lengthMm} height={slab.heightMm}>
          <image href={cropUrl(slab.id, 960)} width={slab.lengthMm} height={slab.heightMm} preserveAspectRatio="none" />
        </pattern>
      </defs>
      <rect x="0" y="0" width={W} height={H} fill="#141414" />
      {/* worktop run */}
      {Lw > 0 && <rect x="100" y="100" width={Lw} height={D} fill={`url(#t${uid})`} stroke="#f3f1ec" strokeWidth="10" />}
      {Lr > D && <rect x={100 + Lw - D} y={100 + D} width={D} height={Lr - D} fill={`url(#t${uid})`} stroke="#f3f1ec" strokeWidth="10" />}
      {hasIsland && <rect x={islandX} y={islandY} width={input.islandL} height={input.islandW} fill={`url(#t${uid})`} stroke="#f3f1ec" strokeWidth="10" />}
      {/* seams */}
      {seam("worktop").map((s, i) => (
        <line key={`w${i}`} x1={100 + s.atMm} y1="80" x2={100 + s.atMm} y2={120 + D} stroke="#d9a441" strokeWidth="14" strokeDasharray="40 30" />
      ))}
      {Lr > D && <line x1={100 + Lw - D - 20} y1={100 + D} x2={100 + Lw + 20} y2={100 + D} stroke="#d9a441" strokeWidth="14" strokeDasharray="40 30" />}
      {seam("island").map((s, i) => (
        <line key={`i${i}`} x1={islandX + s.atMm} y1={islandY - 20} x2={islandX + s.atMm} y2={islandY + input.islandW + 20} stroke="#d9a441" strokeWidth="14" strokeDasharray="40 30" />
      ))}
      {/* dims */}
      <text x={100 + Lw / 2} y="70" fill="#8e8b85" fontSize="90" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" direction="ltr">
        {Lw}
      </text>
      {hasIsland && (
        <text x={islandX + input.islandL / 2} y={islandY + input.islandW + 110} fill="#8e8b85" fontSize="90" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" direction="ltr">
          {input.islandL} × {input.islandW}
        </text>
      )}
    </svg>
  );
}
