"use client";

import Link from "next/link";
import { cropUrl, RACK_A } from "@/lib/data";
import { useT } from "@/lib/ui";
import { resetDemoWithWipe } from "@/components/nav";
import Reveal from "@/components/chrome/Reveal";

export default function Visit() {
  const { t, lang } = useT();
  const a = RACK_A[1];
  const b = RACK_A[5];
  return (
    <footer id="visit" className="stone-edge-top relative bg-basalt text-carrara" aria-labelledby="visit-title">
      <div className="grain pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-[1440px] px-6 pb-14 pt-28 md:px-10">
        <div className="grid gap-8 lg:grid-cols-12">
          <Reveal className="lg:col-span-3">
            <p className="eyebrow text-vein">{t.visit.eyebrow}</p>
          </Reveal>
          <Reveal className="lg:col-span-9">
            <h2 id="visit-title" className="font-display text-[clamp(2.6rem,6vw,6rem)] leading-[0.95]">
              {t.visit.title}
            </h2>
          </Reveal>
        </div>
        <div className="mt-16 grid gap-10 md:grid-cols-2 lg:ms-[25%]">
          {[
            [t.visit.herzliya, t.visit.herzliyaAddr, t.visit.herzliyaNote, a],
            [t.visit.emek, t.visit.emekAddr, t.visit.emekNote, b],
          ].map(([title, addr, note, slab]) => {
            const s = slab as typeof a;
            return (
              <Reveal key={title as string}>
                <div className="relative aspect-[16/9] overflow-hidden">
                  <img src={cropUrl(s.id, 960)} alt={`${s.name[lang]} — ${s.desc[lang]}`} className="h-full w-full object-cover" loading="lazy" />
                  <span className="font-mono absolute bottom-2 end-2 bg-basalt/85 px-2 py-1 text-[0.62rem] text-vein ltr-nums">
                    {s.name.en} · {s.id}
                  </span>
                </div>
                <h3 className="font-display mt-6 text-[1.9rem] leading-tight">{title as string}</h3>
                <p className="font-mono mt-2 text-[0.78rem] text-vein">{addr as string}</p>
                <p className="mt-4 max-w-[52ch] text-[0.95rem] leading-relaxed text-[#d5d2cc]">{note as string}</p>
              </Reveal>
            );
          })}
        </div>

        <div className="mt-24 flex flex-wrap items-end justify-between gap-6 border-t border-[var(--hair)] pt-8">
          <div>
            <p className="font-display text-[2.2rem] leading-none">{lang === "he" ? "פרביטל" : "Fervital"}</p>
            <p className="font-mono mt-2 text-[0.7rem] tracking-[0.18em] text-vein">{t.visit.rights}</p>
          </div>
          <nav aria-label={lang === "he" ? "קישורי תחתית" : "Footer"} className="flex flex-wrap items-center gap-5 text-[0.85rem]">
            <Link href="/accessibility" className="underline underline-offset-4 hover:text-amber">
              {t.visit.a11y}
            </Link>
            <button type="button" className="text-vein underline underline-offset-4 hover:text-carrara" onClick={() => resetDemoWithWipe(t.nav.reset)}>
              {t.nav.reset}
            </button>
          </nav>
        </div>
        <p className="mt-6 max-w-[80ch] text-[0.78rem] leading-relaxed text-vein">
          {t.visit.concept} · {t.meta.demoOnly} {lang === "he" ? "סריקות האבן: ambientCG (CC0)." : "Stone scans: ambientCG (CC0)."}
        </p>
      </div>
    </footer>
  );
}
