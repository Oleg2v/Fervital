"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cropUrl, RACK_A, SLAB_BY_ID, texUrl } from "@/lib/data";
import { Compositor, loadScene, slabImageCache, type CompScene, type CompSurface, type SceneAssets } from "@/lib/compositor";
import { useDemo } from "@/lib/store";
import { useT, useUi } from "@/lib/ui";
import type { Slab } from "@/lib/types";
import Reveal from "@/components/chrome/Reveal";

type SceneKey = "kitchen" | "bathroom" | "upload";
type Phase = "idle" | "analysing" | "ready" | "manual" | "error";

/** Imperative hooks for the autopilot. */
export const kitchenApi: {
  current: { runSample: (k?: "kitchen" | "bathroom") => Promise<void>; setCompare: (v: number) => void; attach: () => void } | null;
} = { current: null };

const ALTS = ["nero-marquina-extra", "onice-miele", "verde-alpi", "statuario-venato", "travertino-classico", "calacatta-oro"];
function alternatives(slab: Slab): Slab[] {
  const light = slab.kind !== "granite" && slab.mean && parseInt(slab.mean.slice(1, 3), 16) > 150;
  const order = light ? ["nero-marquina-extra", "onice-miele", "verde-alpi", "travertino-classico"] : ["calacatta-oro", "statuario-venato", "travertino-classico", "onice-miele"];
  const res: Slab[] = [];
  for (const k of [...order, ...ALTS]) {
    const s = RACK_A.find((x) => x.tex === k && x.family !== slab.family);
    if (s && !res.includes(s) && s.id !== slab.id) res.push(s);
    if (res.length === 2) break;
  }
  return res;
}

export default function KitchenStudio({ compact = false }: { compact?: boolean }) {
  const { t, lang, fmt } = useT();
  const slabId = useUi((s) => s.kitchenSlabId);
  const slab = SLAB_BY_ID[slabId] ?? RACK_A[0];
  const [sceneKey, setSceneKey] = useState<SceneKey>("kitchen");
  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState(-1);
  const [elapsed, setElapsed] = useState(0);
  const [assets, setAssets] = useState<SceneAssets | null>(null);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [compare, setCompare] = useState(0.5);
  const [attached, setAttached] = useState(false);
  const [source, setSource] = useState<"sample" | "model" | "manual" | null>(null);
  const [manualQuad, setManualQuad] = useState<[number, number][] | null>(null);
  const comp = useRef<Compositor | null>(null);
  const glCanvas = useRef<HTMLCanvasElement | null>(null);
  const main = useRef<HTMLCanvasElement>(null);
  const tri = useRef<(HTMLCanvasElement | null)[]>([]);
  const stage = useRef<HTMLDivElement>(null);
  const runId = useRef(0);
  const alts = useMemo(() => alternatives(slab), [slab]);

  const ensureComp = () => {
    if (!comp.current) {
      glCanvas.current = document.createElement("canvas");
      comp.current = new Compositor(glCanvas.current);
    }
    return comp.current;
  };

  const blit = (target: HTMLCanvasElement | null, w?: number) => {
    const src = glCanvas.current;
    if (!target || !src) return;
    const W = w ?? src.width;
    const H = Math.round((W / src.width) * src.height);
    if (target.width !== W) target.width = W;
    if (target.height !== H) target.height = H;
    target.getContext("2d")!.drawImage(src, 0, 0, W, H);
  };

  const draw = useCallback(
    async (a: SceneAssets, s: Slab, reveal: number, en: Record<string, boolean>) => {
      const c = ensureComp();
      const img = await slabImageCache(texUrl(s.tex, "c2k"));
      c.setScene(a);
      c.render({ slab: s, slabImage: img, enabled: en, reveal });
      blit(main.current);
    },
    [],
  );

  const renderTriptych = useCallback(async (a: SceneAssets, en: Record<string, boolean>, list: Slab[]) => {
    const c = ensureComp();
    c.setScene(a);
    for (let i = 0; i < list.length; i++) {
      const img = await slabImageCache(texUrl(list[i].tex, "c2k"));
      c.render({ slab: list[i], slabImage: img, enabled: en, reveal: 1 });
      blit(tri.current[i], 520);
    }
  }, []);

  /** Pour the stone in, then lay out the triptych. */
  const reveal = useCallback(
    async (a: SceneAssets, s: Slab, en: Record<string, boolean>, my: number) => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const img = await slabImageCache(texUrl(s.tex, "c2k"));
      const c = ensureComp();
      c.setScene(a);
      if (!reduced) {
        const t0 = performance.now();
        await new Promise<void>((done) => {
          const tick = () => {
            if (runId.current !== my) return done();
            const p = Math.min(1, (performance.now() - t0) / 1500);
            const e = 1 - Math.pow(1 - p, 3);
            c.render({ slab: s, slabImage: img, enabled: en, reveal: e });
            blit(main.current);
            if (p < 1) requestAnimationFrame(tick);
            else done();
          };
          requestAnimationFrame(tick);
        });
      }
      c.render({ slab: s, slabImage: img, enabled: en, reveal: 1 });
      blit(main.current);
      await renderTriptych(a, en, [s, ...alternatives(s)]);
      c.render({ slab: s, slabImage: img, enabled: en, reveal: 1 });
    },
    [renderTriptych],
  );

  const analyse = useCallback(
    async (key: SceneKey, upload?: { url: string; w: number; h: number }) => {
      const my = ++runId.current;
      setPhase("analysing");
      setStep(0);
      setAttached(false);
      setManualQuad(null);
      const t0 = performance.now();
      const timer = window.setInterval(() => setElapsed((performance.now() - t0) / 1000), 100);
      const stepTimer = window.setInterval(() => setStep((s) => Math.min(3, s + 1)), key === "upload" ? 2600 : 520);
      try {
        const res = await fetch("/api/kitchen", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(key === "upload" ? { image: upload!.url, width: upload!.w, height: upload!.h } : { scene: key }),
        });
        const data = await res.json();
        if (runId.current !== my) return;
        let scene: CompScene;
        if (data.source === "sample") {
          const sc = data.scene;
          scene = {
            key,
            image: sc.image,
            width: sc.width,
            height: sc.height,
            diffuse: sc.diffuse,
            diffuseScale: sc.diffuseScale,
            gloss: sc.gloss,
            albedo: sc.albedo,
            exposure: sc.exposure,
            surfaces: (data.surfaces as (CompSurface & { id: string })[]).map((s) => ({
              id: s.id,
              kind: s.kind,
              quad: s.quad,
              sizeMm: s.sizeMm,
              mask: s.mask,
              label: s.label,
            })),
          };
        } else if (data.source === "model") {
          scene = {
            key: "upload",
            image: upload!.url,
            width: upload!.w,
            height: upload!.h,
            surfaces: data.surfaces.map((s: CompSurface & { polygon: [number, number][] }) => ({
              id: s.id,
              kind: s.kind,
              quad: s.quad,
              sizeMm: s.sizeMm,
              polygon: s.polygon,
              label: s.label,
            })),
          };
        } else {
          // manual: one worktop, four draggable corners
          const W = upload!.w, H = upload!.h;
          const q: [number, number][] = [
            [W * 0.22, H * 0.56],
            [W * 0.8, H * 0.56],
            [W * 0.92, H * 0.74],
            [W * 0.1, H * 0.74],
          ];
          setManualQuad(q);
          setSource("manual");
          const a = await loadScene(manualScene(upload!, q));
          setAssets(a);
          setEnabled({ manual: true });
          setPhase("manual");
          await draw(a, slab, 1, { manual: true });
          return;
        }
        const a = await loadScene(scene);
        // let the designed skeleton finish its story on fast (sample) answers
        const minMs = key === "upload" ? 0 : 2300;
        const wait = Math.max(0, minMs - (performance.now() - t0));
        await new Promise((r) => setTimeout(r, wait));
        if (runId.current !== my) return;
        const en = Object.fromEntries(a.scene.surfaces.map((s) => [s.id, s.kind !== 2 || key === "bathroom"]));
        setAssets(a);
        setEnabled(en);
        setSource(data.source);
        setPhase("ready");
        setCompare(0.5);
        await reveal(a, slab, en, my);
      } catch {
        if (runId.current === my) setPhase("error");
      } finally {
        window.clearInterval(timer);
        window.clearInterval(stepTimer);
        setElapsed((performance.now() - t0) / 1000);
        setStep(4);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slab, reveal, draw],
  );

  // first run when the section mounts / scene changes
  useEffect(() => {
    if (sceneKey !== "upload") analyse(sceneKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey]);

  // slab changed → re-pour on the same analysis
  useEffect(() => {
    if (!assets || phase === "analysing") return;
    const my = ++runId.current;
    if (phase === "manual") draw(assets, slab, 1, enabled);
    else reveal(assets, slab, enabled, my);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slabId]);

  const toggleSurface = (id: string) => {
    const en = { ...enabled, [id]: !(enabled[id] ?? true) };
    setEnabled(en);
    if (assets) {
      draw(assets, slab, 1, en).then(() => renderTriptych(assets, en, [slab, ...alts]).then(() => draw(assets, slab, 1, en)));
    }
  };

  const onUpload = async (f?: File | null) => {
    if (!f || !f.type.startsWith("image/")) return;
    const bmp = await createImageBitmap(f);
    const s = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * s);
    c.height = Math.round(bmp.height * s);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/jpeg", 0.88);
    setSceneKey("upload");
    analyse("upload", { url, w: c.width, h: c.height });
  };

  const attach = () => {
    const src = main.current;
    if (!src) return;
    const th = document.createElement("canvas");
    th.width = 360;
    th.height = Math.round((360 / src.width) * src.height);
    th.getContext("2d")!.drawImage(src, 0, 0, th.width, th.height);
    const ui = useUi.getState();
    useDemo.getState().attachRender(ui.projectId, { slabId: slab.id, scene: sceneKey, thumb: th.toDataURL("image/jpeg", 0.72) });
    setAttached(true);
  };

  useEffect(() => {
    kitchenApi.current = {
      runSample: async (k = "kitchen") => {
        setSceneKey(k);
        await analyse(k);
      },
      setCompare: (v: number) => setCompare(v),
      attach,
    };
    return () => {
      kitchenApi.current = null;
    };
  });

  // manual corner drag
  const dragCorner = useRef<number | null>(null);
  const onCornerMove = (e: React.PointerEvent) => {
    if (dragCorner.current === null || !manualQuad || !assets || !stage.current) return;
    const r = stage.current.getBoundingClientRect();
    const W = assets.scene.width;
    const H = assets.scene.height;
    const q = manualQuad.map((p) => [...p] as [number, number]);
    q[dragCorner.current] = [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
    setManualQuad(q);
    const sc = manualScene({ url: assets.scene.image, w: W, h: H }, q);
    loadScene(sc).then((a) => {
      setAssets(a);
      draw(a, slab, 1, { manual: true });
    });
  };

  const sceneW = assets?.scene.width ?? 1600;
  const sceneH = assets?.scene.height ?? 1000;
  const photoUrl = assets?.scene.image ?? (sceneKey === "bathroom" ? "/scenes/bathroom.jpg" : "/scenes/kitchen.jpg");

  return (
    <section id={compact ? undefined : "kitchen"} className={`${compact ? "" : "paper stone-edge-top"} relative`} aria-labelledby="kitchen-title">
      <div className={compact ? "p-4" : "mx-auto max-w-[1440px] px-6 pb-28 pt-28 md:px-10"}>
        {!compact && (
          <div className="grid gap-8 lg:grid-cols-12">
            <Reveal className="lg:col-span-3">
              <p className="eyebrow muted">{t.kitchen.eyebrow}</p>
              <div className="mt-4 flex gap-2">
                <span className="chip" style={{ borderColor: "#7a2e2e", color: "#7a2e2e" }}>
                  {t.kitchen.beta}
                </span>
                <span className="chip" style={{ borderColor: "#2e4a3d", color: "#2e4a3d" }}>
                  {t.kitchen.sim}
                </span>
              </div>
            </Reveal>
            <div className="lg:col-span-9">
              <Reveal>
                <h2 id="kitchen-title" className="font-display text-[clamp(2.6rem,6vw,6rem)] leading-[0.95]">
                  {t.kitchen.title}
                </h2>
              </Reveal>
              <Reveal delay={0.08}>
                <p className="muted mt-6 max-w-[62ch] text-[1.05rem] leading-relaxed">{t.kitchen.lead}</p>
              </Reveal>
            </div>
          </div>
        )}

        {/* controls */}
        <div className={`${compact ? "" : "mt-14"} flex flex-wrap items-center gap-2`}>
          {(["kitchen", "bathroom"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={sceneKey === k}
              onClick={() => (sceneKey === k ? analyse(k) : setSceneKey(k))}
              className={`btn !min-h-[38px] text-[0.85rem] ${sceneKey === k ? "btn-solid" : ""}`}
              data-ap={`scene-${k}`}
            >
              {k === "kitchen" ? t.kitchen.sceneKitchen : t.kitchen.sceneBath}
            </button>
          ))}
          <label className={`btn !min-h-[38px] cursor-pointer text-[0.85rem] ${sceneKey === "upload" ? "btn-solid" : ""}`}>
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => onUpload(e.target.files?.[0])} />
            {t.kitchen.upload}
          </label>
          <span className="ms-auto font-mono text-[0.72rem] muted">
            {phase === "analysing"
              ? `${elapsed.toFixed(1)} s`
              : phase === "ready" || phase === "manual"
                ? `${fmt(t.kitchen.seconds, { s: elapsed.toFixed(1) })} · ${source === "model" ? "vision model" : source === "manual" ? t.kitchen.manualTitle : lang === "he" ? "סצנה מנותחת" : "pre-segmented scene"}`
                : ""}
          </span>
        </div>

        {/* stage */}
        <div
          ref={stage}
          className="relative mt-5 w-full overflow-hidden bg-basalt select-none"
          style={{ aspectRatio: `${sceneW} / ${sceneH}` }}
          onPointerMove={onCornerMove}
          onPointerUp={() => (dragCorner.current = null)}
          data-ap="kitchen-stage"
        >
          {/* before */}
          <img
            src={photoUrl}
            alt={sceneKey === "bathroom" ? t.kitchen.sceneBath : t.kitchen.sceneKitchen}
            className="absolute inset-0 h-full w-full object-cover transition-[filter] duration-700"
            style={{ filter: phase === "analysing" ? "grayscale(0.7) brightness(0.62)" : "none" }}
            draggable={false}
          />
          {/* after */}
          <canvas
            ref={main}
            className="absolute inset-0 h-full w-full"
            style={{
              clipPath: lang === "he" ? `inset(0 ${(1 - compare) * 100}% 0 0)` : `inset(0 0 0 ${compare * 100}%)`,
              opacity: phase === "ready" || phase === "manual" ? 1 : 0,
              transition: "opacity .4s",
            }}
            aria-label={`${t.kitchen.after}: ${slab.name[lang]}`}
            role="img"
          />

          {/* designed skeleton */}
          <AnimatePresence>{phase === "analysing" && <Skeleton step={step} elapsed={elapsed} key="sk" upload={sceneKey === "upload"} />}</AnimatePresence>

          {/* before/after handle */}
          {(phase === "ready" || phase === "manual") && (
            <CompareHandle value={compare} onChange={setCompare} label={t.kitchen.sliderLabel} before={t.kitchen.before} after={t.kitchen.after} rtl={lang === "he"} />
          )}

          {/* manual corners */}
          {phase === "manual" && manualQuad && (
            <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${sceneW} ${sceneH}`} preserveAspectRatio="none">
              <polygon points={manualQuad.map((p) => p.join(",")).join(" ")} fill="none" stroke="#d9a441" strokeWidth={2} strokeDasharray="8 6" vectorEffect="non-scaling-stroke" />
              {manualQuad.map(([x, y], i) => (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={sceneW / 90}
                  fill="#0e0e0e"
                  stroke="#d9a441"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  className="cursor-grab"
                  onPointerDown={(e) => {
                    (e.target as Element).setPointerCapture?.(e.pointerId);
                    dragCorner.current = i;
                  }}
                />
              ))}
            </svg>
          )}
          {phase === "manual" && (
            <p className="absolute inset-x-0 bottom-0 bg-basalt/90 p-3 text-[0.85rem] text-carrara">{t.kitchen.manual}</p>
          )}
          {phase === "error" && <p className="absolute inset-0 grid place-items-center bg-basalt/80 p-6 text-center text-carrara">{t.kitchen.error}</p>}

          {/* slab tag */}
          {(phase === "ready" || phase === "manual") && (
            <div className="pointer-events-none absolute bottom-3 start-3 bg-basalt/85 px-3 py-2 text-carrara">
              <p className="font-display text-[1.15rem] leading-none">{slab.name[lang]}</p>
              <p className="font-mono mt-1 text-[0.65rem] text-vein ltr-nums">
                {slab.id} · {t.slab.finishes[slab.finish]}
              </p>
            </div>
          )}
        </div>

        {/* surfaces + attach */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="eyebrow muted me-1">{t.kitchen.surfaces}</span>
          {assets?.scene.surfaces.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={enabled[s.id] !== false}
              onClick={() => toggleSurface(s.id)}
              className="chip !text-[0.72rem] !normal-case !tracking-normal"
              style={enabled[s.id] !== false ? { background: "currentColor" } : undefined}
            >
              <span style={enabled[s.id] !== false ? { color: compact ? "#0e0e0e" : "#f3f1ec", mixBlendMode: "normal" } : undefined}>
                {enabled[s.id] !== false ? "✓ " : ""}
                {s.label[lang]}
              </span>
            </button>
          ))}
          <button type="button" className="btn btn-solid ms-auto !min-h-[40px] text-[0.85rem]" disabled={phase !== "ready" && phase !== "manual"} onClick={attach} data-ap="kitchen-attach">
            {attached ? `✓ ${t.kitchen.attached}` : t.kitchen.attach}
          </button>
        </div>

        {/* triptych */}
        {!compact && (
          <div className="mt-14">
            <p className="eyebrow muted">{t.kitchen.triptych}</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {[slab, ...alts].map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  className="group text-start"
                  onClick={() => useUi.getState().setKitchenSlab(s.id)}
                  aria-label={`${t.kitchen.change}: ${s.name[lang]}`}
                >
                  <div className="relative overflow-hidden bg-basalt" style={{ aspectRatio: `${sceneW} / ${sceneH}` }}>
                    <canvas ref={(el) => void (tri.current[i] = el)} className="h-full w-full" />
                    {phase !== "ready" && <div className="absolute inset-0 animate-pulse bg-[#1a1a1a]" />}
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <img src={cropUrl(s.id, 400)} alt="" className="h-8 w-12 object-cover" />
                    <div>
                      <p className="font-display text-[1.2rem] leading-none">{s.name[lang]}</p>
                      <p className="font-mono mt-1 text-[0.65rem] muted ltr-nums">{s.id}</p>
                    </div>
                    {i === 0 && <span className="chip ms-auto">{lang === "he" ? "נבחר" : "selected"}</span>}
                  </div>
                </button>
              ))}
            </div>
            <p className="muted mt-8 max-w-[70ch] text-[0.85rem]">{t.kitchen.disclaimer}</p>
          </div>
        )}
      </div>
    </section>
  );
}

function manualScene(up: { url: string; w: number; h: number }, q: [number, number][]): CompScene {
  return {
    key: "upload",
    image: up.url,
    width: up.w,
    height: up.h,
    surfaces: [{ id: "manual", kind: 0, quad: q, sizeMm: [2800, 650], polygon: q, label: { he: "משטח עבודה", en: "Worktop" } }],
  };
}

function Skeleton({ step, elapsed, upload }: { step: number; elapsed: number; upload: boolean }) {
  const { t } = useT();
  return (
    <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.5 } }}>
      {/* scanning stone edge */}
      <motion.div
        className="absolute inset-y-0 w-[2px]"
        style={{ background: "#d9a441", boxShadow: "0 0 24px 6px #d9a44166" }}
        initial={{ left: "-2%" }}
        animate={{ left: "102%" }}
        transition={{ duration: upload ? 2.4 : 1.15, ease: [0.65, 0.02, 0.15, 1], repeat: Infinity }}
      />
      <div className="absolute inset-0" style={{ backgroundImage: "linear-gradient(#f3f1ec0d 1px, transparent 1px), linear-gradient(90deg, #f3f1ec0d 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
      <div className="absolute bottom-0 start-0 m-3 min-w-[240px] bg-basalt/90 p-4 text-carrara md:m-5">
        <p className="eyebrow text-vein">{t.kitchen.sim}</p>
        <ol className="mt-3 grid gap-2">
          {t.kitchen.steps.map((s, i) => (
            <li key={s} className="flex items-center gap-3 text-[0.85rem]" style={{ opacity: i <= step ? 1 : 0.35 }}>
              <span className="font-mono w-5 text-[0.65rem] text-vein ltr-nums">{String(i + 1).padStart(2, "0")}</span>
              <span className="flex-1">{s}</span>
              {i < step ? <span className="text-amber">✓</span> : i === step ? <span className="live-dot" /> : null}
            </li>
          ))}
        </ol>
        <div className="mt-4 h-px w-full bg-[#8e8b8555]">
          <motion.div className="h-px bg-amber" animate={{ width: `${Math.min(100, ((step + 1) / 4) * 100)}%` }} transition={{ duration: 0.5 }} />
        </div>
        <p className="font-mono mt-2 text-[0.68rem] text-vein ltr-nums">{elapsed.toFixed(1)} s</p>
      </div>
    </motion.div>
  );
}

function CompareHandle({ value, onChange, label, before, after, rtl }: { value: number; onChange: (v: number) => void; label: string; before: string; after: string; rtl: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const set = (clientX: number) => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let v = (clientX - r.left) / r.width;
    if (!rtl) v = (clientX - r.left) / r.width;
    onChange(Math.min(1, Math.max(0, v)));
  };
  const x = value * 100;
  return (
    <>
      <div
        className="absolute inset-0 cursor-ew-resize"
        onPointerDown={(e) => {
          dragging.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          set(e.clientX);
        }}
        onPointerMove={(e) => dragging.current && set(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
      />
      <div ref={ref} className="pointer-events-none absolute inset-y-0 w-px bg-carrara" style={{ left: `${x}%` }}>
        <div
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(value * 100)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") onChange(Math.max(0, value - 0.05));
            if (e.key === "ArrowRight") onChange(Math.min(1, value + 0.05));
          }}
          className="pointer-events-auto absolute top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full border border-carrara bg-basalt text-carrara"
          data-ap="compare"
        >
          <svg width="18" height="10" viewBox="0 0 18 10" aria-hidden="true">
            <path d="M5 1 1 5l4 4M13 1l4 4-4 4" fill="none" stroke="currentColor" />
          </svg>
        </div>
      </div>
      <span className="eyebrow pointer-events-none absolute top-3 bg-basalt/80 px-2 py-1 text-carrara" style={{ left: 12 }}>
        {rtl ? after : before}
      </span>
      <span className="eyebrow pointer-events-none absolute top-3 bg-basalt/80 px-2 py-1 text-carrara" style={{ right: 12 }}>
        {rtl ? before : after}
      </span>
    </>
  );
}
