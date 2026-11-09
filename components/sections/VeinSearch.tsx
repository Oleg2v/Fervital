"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { cropUrl, SLAB_BY_ID, SLABS } from "@/lib/data";
import { useDemo } from "@/lib/store";
import { dict } from "@/lib/i18n";
import { useT, useUi } from "@/lib/ui";
import type { L10n } from "@/lib/types";
import Reveal from "@/components/chrome/Reveal";
import { goKitchen, pullFromRack } from "@/components/nav";

interface Result {
  id: string;
  score: number;
  reason: L10n;
  held: boolean;
}
interface Response {
  mode: "text" | "image";
  engine: "local" | "claude" | "descriptor";
  ms: number;
  scanned: number;
  understood: { he: string[]; en: string[] };
  results: Result[];
}

async function fileToDataUrl(file: File, max = 512): Promise<string> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.86);
}

export default function VeinSearch() {
  const { t, lang, fmt } = useT();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Response | null>(null);
  const [img, setImg] = useState<string | null>(null);
  // which error, not its text: it is rendered in the current language
  const [err, setErr] = useState<"search" | "image" | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = useCallback(
    async (payload: { q?: string; image?: string }) => {
      setBusy(true);
      setErr(null);
      const status = Object.fromEntries(Object.entries(useDemo.getState().slabs).map(([k, v]) => [k, v.status]));
      const started = performance.now();
      try {
        const r = await fetch("/api/vein-search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, status }),
        });
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as Response;
        // let the scan read for a beat — it is part of the explanation
        const wait = Math.max(0, 650 - (performance.now() - started));
        await new Promise((ok) => setTimeout(ok, wait));
        setRes(data);
      } catch {
        setErr("search");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // run the first example when the section first comes into view, so it never sits empty
  const sectionRef = useRef<HTMLElement>(null);
  const autoRan = useRef(false);
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !autoRan.current) {
          autoRan.current = true;
          io.disconnect();
          // the language now, not at mount: ?lang=en and the header toggle both land after this effect
          const first = dict[useUi.getState().lang].search.examples[0];
          setQ(first);
          run({ q: first });
        }
      },
      { rootMargin: "0px 0px -30% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // an example in the box follows a language switch (each pair is the same search)
  useEffect(() => {
    setQ((cur) => {
      const k = dict[lang === "he" ? "en" : "he"].search.examples.indexOf(cur);
      return k >= 0 ? dict[lang].search.examples[k] : cur;
    });
  }, [lang]);

  const submit = (text = q) => {
    if (!text.trim()) return;
    setImg(null);
    setQ(text);
    run({ q: text });
  };

  const onFile = async (f?: File | null) => {
    if (!f) return;
    // a file the browser cannot decode (e.g. an iPhone HEIC in Chrome) says so instead of doing nothing
    const url = f.type.startsWith("image/") ? await fileToDataUrl(f).catch(() => null) : null;
    if (!url) {
      setErr("image");
      return;
    }
    setImg(url);
    run({ image: url });
  };

  const engineLabel = res ? (res.engine === "claude" ? t.search.engineClaude : res.engine === "descriptor" ? (lang === "he" ? "וקטור מינרלי · תמונה" : "mineral vector · image") : t.search.engineLocal) : "";

  return (
    <section ref={sectionRef} id="search" className="stone-edge-top relative bg-basalt text-carrara" aria-labelledby="search-title">
      <div className="grain pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-[1440px] px-6 pb-28 pt-28 md:px-10">
        <div className="grid gap-8 lg:grid-cols-12">
          <Reveal className="lg:col-span-3">
            <p className="eyebrow text-vein">{t.search.eyebrow}</p>
            <div className="mt-4 flex gap-2">
              <span className="chip chip-amber">{t.search.beta}</span>
              <span className="chip">{t.kitchen.sim}</span>
            </div>
          </Reveal>
          <div className="lg:col-span-9">
            <Reveal>
              <h2 id="search-title" className="font-display text-[clamp(2.6rem,6vw,6rem)] leading-[0.95]">
                {t.search.title}
              </h2>
            </Reveal>
            <Reveal delay={0.08}>
              <p className="mt-6 max-w-[62ch] text-[1.05rem] leading-relaxed text-[#d5d2cc]">{t.search.lead}</p>
            </Reveal>

            <form
              className="mt-12"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              role="search"
            >
              <label htmlFor="vein-q" className="eyebrow text-vein">
                {t.search.label}
              </label>
              <div className="mt-2 flex items-end gap-3 border-b border-[var(--hair-strong)] focus-within:border-amber">
                <input
                  id="vein-q"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t.search.placeholder}
                  className="font-display min-w-0 flex-1 bg-transparent pb-3 pt-2 text-[clamp(1.4rem,3vw,2.4rem)] text-carrara placeholder:text-[#8e8b85b0] focus:outline-none"
                  autoComplete="off"
                  data-ap="search-input"
                />
                <button type="submit" className="btn btn-solid mb-3" disabled={busy}>
                  {t.search.go}
                </button>
              </div>
            </form>

            <div className="mt-5 flex flex-wrap gap-2">
              {t.search.examples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => submit(ex)}
                  className="border border-[var(--hair-strong)] px-3 py-1.5 text-[0.85rem] text-[#d5d2cc] transition-colors hover:border-amber hover:text-carrara"
                >
                  {ex}
                </button>
              ))}
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                onFile(e.dataTransfer.files?.[0]);
              }}
              className="mt-8 flex flex-wrap items-center gap-4 border border-dashed p-4 transition-colors"
              style={{ borderColor: drag ? "#d9a441" : "var(--hair-strong)" }}
            >
              {img ? (
                <img src={img} alt={t.search.imageQuery} className="h-16 w-24 object-cover" />
              ) : (
                <svg width="40" height="28" viewBox="0 0 40 28" aria-hidden="true" className="text-vein">
                  <rect x="0.5" y="0.5" width="39" height="27" fill="none" stroke="currentColor" />
                  <path d="M3 22c6-7 9-9 14-5s8 1 12-6 8-4 8-4" fill="none" stroke="#d9a441" />
                </svg>
              )}
              <div className="me-auto">
                <p className="text-[0.95rem]">{t.search.upload}</p>
                <p className="text-[0.8rem] text-vein">{t.search.drop}</p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="peer sr-only"
                id="vein-file"
                onChange={(e) => {
                  onFile(e.target.files?.[0]);
                  e.target.value = ""; // the same photo can be chosen again
                }}
              />
              {/* the input is visually hidden, so its keyboard focus ring is drawn on the label */}
              <label
                htmlFor="vein-file"
                className="btn cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-[3px] peer-focus-visible:outline-amber"
              >
                {t.search.upload}
              </label>
            </div>
          </div>
        </div>

        {/* scan + results */}
        <div className="mt-16" aria-live="polite" aria-busy={busy}>
          <ScanStrip busy={busy} hits={res?.results.map((r) => r.id) ?? []} />
          {err && (
            <p className="mt-6 text-amber">
              {err === "image" ? (lang === "he" ? "לא הצלחנו לקרוא את התמונה. נסו JPEG או PNG." : "We couldn't read that image. Try a JPEG or PNG.") : t.search.error}
            </p>
          )}
          {res && !busy && (
            <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="eyebrow text-vein">{t.search.understood}:</span>
              {res.understood[lang].map((u) => (
                <span key={u} className="chip">
                  {u}
                </span>
              ))}
              <span className="font-mono ms-auto text-[0.72rem] text-vein">
                {fmt(t.search.meta, { ms: res.ms, n: res.scanned, engine: engineLabel })}
              </span>
            </div>
          )}
          <AnimatePresence mode="wait">
            {res && !busy ? (
              <motion.ol
                key={JSON.stringify(res.results.map((r) => r.id))}
                className="mt-8 grid gap-x-5 gap-y-10 sm:grid-cols-2 xl:grid-cols-4"
                initial="hide"
                animate="show"
                exit="hide"
                variants={{ show: { transition: { staggerChildren: 0.06 } }, hide: {} }}
              >
                {res.results.map((r, i) => (
                  <ResultCard key={r.id} r={r} rank={i + 1} />
                ))}
              </motion.ol>
            ) : (
              !busy && !res && <p className="mt-8 text-[0.95rem] text-vein">{t.search.empty}</p>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

function ResultCard({ r, rank }: { r: Result; rank: number }) {
  const { t, lang } = useT();
  const s = SLAB_BY_ID[r.id];
  if (!s) return null;
  const pct = Math.round(r.score * 100);
  return (
    <motion.li
      variants={{ hide: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } } }}
      className="group"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-[#1a1a1a]">
        <img
          src={cropUrl(s.id, 400)}
          srcSet={`${cropUrl(s.id, 400)} 400w, ${cropUrl(s.id, 960)} 960w`}
          sizes="(min-width: 1280px) 25vw, 50vw"
          alt={`${s.name[lang]} — ${s.desc[lang]}`}
          className="h-full w-full object-cover transition-transform duration-[1.2s] ease-[cubic-bezier(.16,1,.3,1)] group-hover:scale-[1.06]"
          loading="lazy"
        />
        <span className="font-mono absolute start-0 top-0 bg-basalt px-2 py-1 text-[0.7rem] text-vein ltr-nums">
          {String(rank).padStart(2, "0")}
        </span>
        <span className="font-mono absolute bottom-0 end-0 bg-basalt px-2.5 py-1 text-[1.05rem] text-carrara">
          <span className="ltr-nums">{pct}%</span> <span className="text-[0.62rem] text-vein">{t.search.match}</span>
        </span>
        {r.held && <span className="chip chip-amber absolute end-2 top-2 bg-basalt">{t.search.held}</span>}
      </div>
      <div className="mt-4 flex items-baseline justify-between gap-3">
        <h3 className="font-display text-[1.6rem] leading-tight">{s.name[lang]}</h3>
        <span className="font-mono text-[0.68rem] text-vein ltr-nums">{s.rack.label}</span>
      </div>
      <p className="font-mono mt-1 text-[0.68rem] text-vein ltr-nums">
        {s.id} · {s.lengthMm}×{s.heightMm}×{s.thicknessMm}
      </p>
      <p className="mt-3 text-[0.9rem] leading-snug text-[#d5d2cc]">{r.reason[lang]}</p>
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn !min-h-[38px] !px-3 text-[0.8rem]" onClick={() => pullFromRack(s.id)}>
          {t.search.pull}
        </button>
        <button type="button" className="btn !min-h-[38px] !px-3 text-[0.8rem]" onClick={() => goKitchen(s.id)}>
          {t.slab.kitchen}
        </button>
      </div>
    </motion.li>
  );
}

/** 120 thumbnails — the whole yard, scanned. Matches light up when results land. */
function ScanStrip({ busy, hits }: { busy: boolean; hits: string[] }) {
  const hitSet = new Set(hits);
  return (
    <div className="relative overflow-hidden" aria-hidden="true">
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: "repeat(40, minmax(0, 1fr))" }}>
        {SLABS.map((s) => (
          <div
            key={s.id}
            className="aspect-[3/5] transition-[opacity,filter,outline-color] duration-500"
            style={{
              background: s.mean,
              opacity: busy ? 0.55 : hits.length ? (hitSet.has(s.id) ? 1 : 0.18) : 0.5,
              outline: hitSet.has(s.id) && !busy ? "1px solid #d9a441" : "1px solid transparent",
              outlineOffset: 1,
            }}
          />
        ))}
      </div>
      {busy && (
        <motion.div
          className="absolute inset-y-0 w-[14%]"
          style={{ background: "linear-gradient(90deg, #d9a44100, #d9a44166, #d9a44100)" }}
          initial={{ left: "-14%" }}
          animate={{ left: "100%" }}
          transition={{ duration: 0.65, ease: "linear", repeat: Infinity }}
        />
      )}
    </div>
  );
}
