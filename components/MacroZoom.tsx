"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { SLAB_BY_ID, TEXTURES, tileUrl } from "@/lib/data";
import { useT, useUi } from "@/lib/ui";
import type { Slab } from "@/lib/types";

const TILE = 512;
const imgCache = new Map<string, HTMLImageElement>();
function tile(url: string, onload: () => void): HTMLImageElement | null {
  let img = imgCache.get(url);
  if (!img) {
    img = new Image();
    img.decoding = "async";
    img.src = url;
    img.onload = onload;
    imgCache.set(url, img);
    return null;
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

export default function MacroZoomHost() {
  const id = useUi((s) => s.zoomSlabId);
  const slab = id ? SLAB_BY_ID[id] : null;
  return <AnimatePresence>{slab && <MacroZoom key={slab.id} slab={slab} />}</AnimatePresence>;
}

function MacroZoom({ slab }: { slab: Slab }) {
  const { t, lang } = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const meta = TEXTURES[slab.tex];
  const maxLevel = meta?.zoom.maxLevel ?? 2;
  const view = useRef({ z: 1.6, zt: 1.6, cx: 0.5, cy: 0.5, tx: 0.5, ty: 0.5, dirty: true });
  const [hud, setHud] = useState({ z: 1.6, mmPx: 0, level: 0 });
  const closeBtn = useRef<HTMLButtonElement>(null);
  const close = () => useUi.getState().openZoom(null);

  useEffect(() => {
    // remember the opener before focus moves into the dialog; it gets the focus back on close
    const prev = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    return () => prev?.focus?.({ preventScroll: true });
  }, []);

  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let hudTick = 0;
    const redraw = () => (view.current.dirty = true);

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const v = view.current;
      const k1 = 1 - Math.exp(-dt * 3.2); // heavy follow
      const k2 = 1 - Math.exp(-dt * 6);
      const nz = v.z + (v.zt - v.z) * k2;
      const ncx = v.cx + (v.tx - v.cx) * k1;
      const ncy = v.cy + (v.ty - v.cy) * k1;
      const moving = Math.abs(nz - v.z) > 1e-4 || Math.abs(ncx - v.cx) > 1e-5 || Math.abs(ncy - v.cy) > 1e-5;
      v.z = nz;
      v.cx = ncx;
      v.cy = ncy;
      if (moving || v.dirty) {
        v.dirty = false;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const W = c.clientWidth;
        const H = c.clientHeight;
        if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
          c.width = Math.round(W * dpr);
          c.height = Math.round(H * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#0e0e0e";
        ctx.fillRect(0, 0, W, H);
        const { u, v: v0, w, h, rot } = slab.crop;
        const k0 = Math.max(W / w, H / h); // px per base unit (cover)
        const k = k0 * v.z;
        const visW = W / k;
        const visH = H / k;
        // centre in crop coords → base coords, clamped inside the crop
        const halfW = Math.min(visW / 2, w / 2);
        const halfH = Math.min(visH / 2, h / 2);
        const ccx = Math.min(1 - halfW / w, Math.max(halfW / w, v.cx));
        const ccy = Math.min(1 - halfH / h, Math.max(halfH / h, v.cy));
        // with a 180° crop, screen-left shows the crop's right side
        const bx = rot === 180 ? u + (1 - ccx) * w : u + ccx * w;
        const by = rot === 180 ? v0 + (1 - ccy) * h : v0 + ccy * h;
        const left = bx - visW / 2;
        const top = by - visH / 2;
        const needed = (W * dpr) / visW; // device px per base unit
        let level = 0;
        while (level < maxLevel && TILE * 2 ** level < needed) level++;
        ctx.save();
        if (rot === 180) {
          ctx.translate(W, H);
          ctx.scale(-1, -1);
        }
        ctx.imageSmoothingQuality = "high";
        for (let L = 0; L <= level; L++) {
          const n = 2 ** L;
          const x0 = Math.max(0, Math.floor(left * n));
          const x1 = Math.min(n - 1, Math.floor((left + visW) * n));
          const y0 = Math.max(0, Math.floor(top * n));
          const y1 = Math.min(n - 1, Math.floor((top + visH) * n));
          for (let ty = y0; ty <= y1; ty++) {
            for (let tx = x0; tx <= x1; tx++) {
              const img = tile(tileUrl(slab.tex, L, tx, ty), redraw);
              if (!img) continue;
              const sx = (tx / n - left) * k;
              const sy = (ty / n - top) * k;
              const s = k / n;
              ctx.drawImage(img, sx - 0.25, sy - 0.25, s + 0.5, s + 0.5);
            }
          }
        }
        ctx.restore();
        if (++hudTick % 6 === 0) {
          setHud({ z: v.z, mmPx: slab.lengthMm / (w * k), level });
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const onResize = () => (view.current.dirty = true);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [slab, maxLevel]);

  // never past ~1.5 screen px per scan texel: deeper than that is just pixels
  const zMax = () => {
    const c = canvas.current;
    const W = c?.clientWidth ?? 1440;
    const H = c?.clientHeight ?? 900;
    const k0 = Math.max(W / slab.crop.w, H / slab.crop.h);
    const texels = TILE * 2 ** maxLevel;
    return Math.max(2, (1.5 * texels) / (k0 * Math.min(2, window.devicePixelRatio || 1)));
  };
  const zoomBy = (f: number) => {
    const v = view.current;
    v.zt = Math.min(zMax(), Math.max(1, v.zt * f));
  };

  const onMove = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const v = view.current;
    if (e.pointerType === "touch" && e.buttons) {
      v.tx -= e.movementX / r.width / v.z;
      v.ty -= e.movementY / r.height / v.z;
    } else if (e.pointerType !== "touch") {
      v.tx = (e.clientX - r.left) / r.width;
      v.ty = (e.clientY - r.top) / r.height;
    }
    v.tx = Math.min(1, Math.max(0, v.tx));
    v.ty = Math.min(1, Math.max(0, v.ty));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Tab") {
      // aria-modal: Tab / Shift+Tab cycle through the dialog's own buttons
      const root = e.currentTarget as HTMLElement;
      const btns = Array.from(root.querySelectorAll<HTMLElement>("button"));
      const first = btns[0];
      const last = btns[btns.length - 1];
      const a = document.activeElement;
      if (e.shiftKey && (a === first || a === root)) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && (a === last || a === root)) {
        e.preventDefault();
        first?.focus();
      }
      return;
    }
    const v = view.current;
    const step = 0.08 / v.z;
    if (e.key === "Escape") close();
    else if (e.key === "+" || e.key === "=") zoomBy(1.6);
    else if (e.key === "-") zoomBy(1 / 1.6);
    else if (e.key === "ArrowLeft") v.tx = Math.max(0, v.tx - step);
    else if (e.key === "ArrowRight") v.tx = Math.min(1, v.tx + step);
    else if (e.key === "ArrowUp") v.ty = Math.max(0, v.ty - step);
    else if (e.key === "ArrowDown") v.ty = Math.min(1, v.ty + step);
    else return;
    e.preventDefault();
  };

  const scanPx = TILE * 2 ** maxLevel;
  const barMm = hud.mmPx > 1.2 ? 100 : hud.mmPx > 0.3 ? 20 : 5;
  const barPx = hud.mmPx > 0 ? barMm / hud.mmPx : 0;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`${t.zoom.title} — ${slab.name[lang]} ${slab.id}`}
      className="fixed inset-0 z-[120] bg-basalt text-carrara"
      initial={{ clipPath: "inset(48% 48% 48% 48%)" }}
      animate={{ clipPath: "inset(0% 0% 0% 0%)" }}
      exit={{ clipPath: "inset(50% 0% 50% 0%)", transition: { duration: 0.45, ease: [0.76, 0, 0.18, 1] } }}
      transition={{ duration: 0.7, ease: [0.76, 0, 0.18, 1] }}
      onKeyDown={onKey}
      tabIndex={-1}
    >
      <canvas
        ref={canvas}
        className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onWheel={(e) => zoomBy(Math.exp(-e.deltaY * 0.0016))}
        onDoubleClick={() => zoomBy(2)}
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-6 md:p-8" style={{ background: "linear-gradient(#0e0e0e99, #0e0e0e00 70%)" }}>
        <div>
          <p className="eyebrow muted">{t.zoom.title}</p>
          <p className="font-display mt-2 text-[2rem] leading-none">{slab.name[lang]}</p>
          <p className="font-mono mt-2 text-[0.75rem] text-vein ltr-nums">
            {slab.id} · {slab.rack.label}
          </p>
        </div>
      </div>
      <button
        ref={closeBtn}
        type="button"
        onClick={close}
        className="btn absolute end-6 top-6 bg-basalt md:end-8 md:top-8"
        aria-label={t.zoom.close}
      >
        ✕ <span className="hidden sm:inline">{t.zoom.close}</span>
      </button>
      <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-4 p-6 md:p-8" style={{ background: "linear-gradient(#0e0e0e00 20%, #0e0e0ea8)" }}>
        <div className="font-mono text-[0.75rem] leading-6">
          <div className="flex items-center gap-3">
            <span className="inline-block h-[2px] bg-carrara" style={{ width: Math.min(260, barPx) }} />
            <span className="ltr-nums">{barMm} mm</span>
          </div>
          <div className="text-vein">
            <span className="ltr-nums">×{hud.z.toFixed(1)}</span> · <span className="ltr-nums">{hud.mmPx.toFixed(2)}</span> {t.zoom.perPx} ·{" "}
            {t.zoom.scan} <span className="ltr-nums">{scanPx.toLocaleString("en-US")} px</span> · L{hud.level}
          </div>
          <div className="text-vein">
            {meta?.source.library} · {meta?.source.asset} · {meta?.source.license}
          </div>
        </div>
        <p className="eyebrow muted hidden md:block">{t.zoom.hint}</p>
        <div className="flex gap-2">
          <button type="button" className="btn bg-basalt" onClick={() => zoomBy(1 / 1.8)} aria-label={t.zoom.zoomOut}>
            −
          </button>
          <button type="button" className="btn bg-basalt" onClick={() => zoomBy(1.8)} aria-label={t.zoom.zoomIn}>
            +
          </button>
        </div>
      </div>
    </motion.div>
  );
}
