"use client";

import { AnimatePresence } from "framer-motion";
import { cropUrl, RACK_A } from "@/lib/data";
import { frontSlab, useRack } from "@/lib/rack";
import { useT } from "@/lib/ui";
import SlabPanel from "./SlabPanel";

/** prefers-reduced-motion: the rack as a still wall — every slab, every description, no motion. */
export default function StaticWall({ compact = false }: { compact?: boolean }) {
  const { t, lang } = useT();
  const index = useRack((s) => s.index);
  const override = useRack((s) => s.override);
  const slab = frontSlab({ ...useRack.getState(), index, override });

  return (
    <section id="rack" aria-labelledby="wall-title" className={`relative bg-basalt text-carrara ${compact ? "px-4 pb-6 pt-4" : "px-6 pb-16 pt-[calc(var(--header-h)+40px)] md:px-10"}`}>
      <p className="eyebrow text-vein">{t.hero.eyebrow}</p>
      <h1 id="wall-title" className={`font-display mt-3 leading-[0.95] ${compact ? "text-[2.2rem]" : "text-[clamp(2.8rem,7vw,6.4rem)]"}`}>
        {t.hero.l1} <span className="text-vein">{t.hero.l2}</span>
      </h1>
      {!compact && <p className="mt-4 max-w-[60ch] text-[0.95rem] text-[#d5d2cc]">{t.wall.lead}</p>}

      <div className={`mt-8 grid gap-6 ${compact ? "" : "lg:grid-cols-12"}`}>
        <div className={compact ? "" : "lg:col-span-7"}>
          <figure className="relative m-0 aspect-[16/9] overflow-hidden bg-[#1a1a1a]">
            <img src={cropUrl(slab.id, 960)} alt={`${slab.name[lang]} — ${slab.desc[lang]}`} className="h-full w-full object-cover" />
            <figcaption className="font-mono absolute bottom-0 start-0 bg-basalt/85 px-2 py-1 text-[0.7rem] text-vein ltr-nums">
              {slab.rack.label} · {slab.id}
            </figcaption>
          </figure>
          <div className="relative">
            <AnimatePresence mode="wait">
              <SlabPanel key={slab.id} slab={slab} compact={compact} />
            </AnimatePresence>
          </div>
        </div>
        <ul
          className={`grid content-start gap-2 ${compact ? "grid-cols-8" : "grid-cols-5 lg:col-span-5"}`}
          aria-label={t.hero.rackLabel}
          data-ap="rack"
          onClick={() => useRack.setState({ pullTarget: 1 })}
        >
          {RACK_A.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => useRack.setState({ index: i, override: null, pullTarget: 1 })}
                aria-pressed={i === index && !override}
                aria-label={`${s.rack.label}: ${s.name[lang]} — ${s.desc[lang]}`}
                className="block w-full outline-offset-2"
                style={{ outline: i === index && !override ? "1px solid #d9a441" : undefined }}
              >
                <img src={cropUrl(s.id, 400)} alt="" className="aspect-[3/2] w-full object-cover" loading="lazy" />
                {!compact && <span className="font-mono mt-1 block text-start text-[0.6rem] text-vein ltr-nums">{s.rack.label}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
