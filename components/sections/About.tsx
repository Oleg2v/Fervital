"use client";

import { cropUrl, SLAB_BY_ID, RACK_A } from "@/lib/data";
import { useT } from "@/lib/ui";
import Reveal from "@/components/chrome/Reveal";

const BAND = RACK_A[3]; // Statuario — a slab, full-bleed, as the only image

export default function About() {
  const { t, lang } = useT();
  const band = SLAB_BY_ID[BAND.id];
  return (
    <section id="about" className="paper stone-edge-top relative" aria-labelledby="about-title">
      <div className="mx-auto max-w-[1440px] px-6 pb-24 pt-24 md:px-10 md:pb-32 md:pt-32">
        <div className="grid gap-10 lg:grid-cols-12">
          <Reveal className="lg:col-span-3">
            <p className="eyebrow muted">{t.about.eyebrow}</p>
          </Reveal>
          <Reveal className="lg:col-span-9" delay={0.05}>
            <h2 id="about-title" className="font-display text-[clamp(2.6rem,6.4vw,6.4rem)] leading-[0.95]">
              {t.about.title}
            </h2>
          </Reveal>
        </div>

        <div className="mt-16 grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-3" />
          <Reveal className="lg:col-span-4" delay={0.1}>
            <p className="text-[1.08rem] leading-[1.75]">{t.about.p1}</p>
          </Reveal>
          <Reveal className="lg:col-span-4 lg:col-start-9" delay={0.18}>
            <p className="text-[1.08rem] leading-[1.75] muted">{t.about.p2}</p>
            <p className="mt-5 text-[1.08rem] leading-[1.75] muted">{t.about.p3}</p>
          </Reveal>
        </div>

        <dl className="mt-20 grid grid-cols-2 border-t border-[var(--hair-strong)] md:grid-cols-4">
          {t.about.stats.map((s, i) => (
            <Reveal key={s.v} delay={i * 0.06} className="border-b border-[var(--hair)] py-7 pe-6 md:border-b-0 md:border-e md:last:border-e-0 md:ps-6 md:first:ps-0">
              <dt className="sr-only">{s.l}</dt>
              <dd>
                <span className="font-mono block text-[clamp(2rem,3.6vw,3.2rem)] font-[400] leading-none tracking-[-0.02em] ltr-nums">
                  {s.v}
                </span>
                <span className="mt-3 block text-[0.92rem] muted">{s.l}</span>
              </dd>
            </Reveal>
          ))}
        </dl>
      </div>

      {/* a slab, full-bleed, carrying the quote */}
      <figure className="relative h-[78svh] min-h-[520px] overflow-hidden bg-basalt">
        <img
          src={cropUrl(band.id, 960)}
          alt={`${band.name[lang]} — ${band.desc[lang]}`}
          className="absolute inset-0 h-full w-full scale-[1.04] object-cover"
          loading="lazy"
          decoding="async"
        />
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, #0e0e0ef0 0%, #0e0e0eb8 38%, #0e0e0e40 75%, #0e0e0e14 100%)" }} />
        <figcaption className="absolute inset-0 flex flex-col justify-end p-6 text-carrara md:p-10">
          <Reveal>
            <blockquote className="font-display max-w-[20ch] text-[clamp(2rem,4.4vw,4.2rem)] leading-[1.02]">
              {t.about.quote}
            </blockquote>
          </Reveal>
          <p className="font-mono mt-8 text-[0.72rem] tracking-[0.12em] text-[#d5d2cc] ltr-nums">
            {band.name.en} · {band.id} · {band.lengthMm}×{band.heightMm} mm · {band.rack.label}
          </p>
        </figcaption>
      </figure>

      <div className="mx-auto max-w-[1440px] px-6 py-20 md:px-10">
        <div className="grid gap-10 lg:grid-cols-12">
          <Reveal className="lg:col-span-3">
            <p className="eyebrow muted">{t.about.plantTitle}</p>
          </Reveal>
          <ol className="grid gap-px lg:col-span-9 sm:grid-cols-2 lg:grid-cols-4">
            {t.about.plant.map((p, i) => (
              <Reveal as="li" key={p} delay={i * 0.04} className="border-t border-[var(--hair-strong)] pb-6 pt-4 pe-4">
                <span className="font-mono text-[0.7rem] muted ltr-nums">{String(i + 1).padStart(2, "0")}</span>
                <span className="mt-2 block text-[1.05rem]">{p}</span>
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
