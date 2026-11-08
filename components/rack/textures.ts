"use client";

import * as THREE from "three";
import type { Slab } from "@/lib/types";

const loader = typeof window !== "undefined" ? new THREE.TextureLoader() : null;
const cache = new Map<string, Promise<THREE.Texture>>();
const ready = new Map<string, THREE.Texture>();

export function loadTexture(url: string, color = true): Promise<THREE.Texture> {
  if (!loader) return Promise.reject(new Error("no loader"));
  let p = cache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      loader.load(
        url,
        (tex) => {
          tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          tex.anisotropy = 8;
          tex.generateMipmaps = true;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          ready.set(url, tex);
          resolve(tex);
        },
        undefined,
        reject,
      );
    });
    cache.set(url, p);
  }
  return p;
}

export const peekTexture = (url: string) => ready.get(url) ?? null;

/** A clone of `base` (sharing the GPU image) that shows exactly this slab's crop. */
export function cropTexture(base: THREE.Texture, slab: Slab, mirror = false): THREE.Texture {
  const t = base.clone();
  t.needsUpdate = true;
  const { u, v, w, h, rot } = slab.crop;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.center.set(0, 0);
  t.rotation = 0;
  // three.js image V runs bottom→top; our crop V runs top→bottom.
  let rx = w,
    ry = h,
    ox = u,
    oy = 1 - v - h;
  if (rot === 180) {
    rx = -w;
    ry = -h;
    ox = u + w;
    oy = 1 - v;
  }
  if (mirror) {
    ox = ox + rx;
    rx = -rx;
  }
  t.repeat.set(rx, ry);
  t.offset.set(ox, oy);
  t.updateMatrix();
  return t;
}
