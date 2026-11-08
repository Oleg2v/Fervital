"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, MeshReflectorMaterial, PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import { RACK_A, SLAB_BY_ID, texUrl, twinOf } from "@/lib/data";
import { anim, GAP, RACK_SIZE, useRack } from "@/lib/rack";
import type { Slab } from "@/lib/types";
import { cropTexture, loadTexture, peekTexture } from "./textures";

// ── layout constants (metres) ───────────────────────────────
const TOP = 2.2; // slab tops are aligned under the rails
const FRAME_L = 3.42;
const FRAME_H = 2.12;
const RACK_FRONT = FRAME_L / 2 + 0.04;
const PULL_CLEAR = 0.32;

const BASALT = new THREE.Color("#0e0e0e");

export type Quality = "high" | "medium";

const finishMaterial = (finish: Slab["finish"]) =>
  finish === "polished"
    ? { roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.035, normalScale: 0.22, envMapIntensity: 1.05 }
    : finish === "honed"
      ? { roughness: 0.52, clearcoat: 0.08, clearcoatRoughness: 0.4, normalScale: 0.45, envMapIntensity: 0.75 }
      : { roughness: 0.66, clearcoat: 0.12, clearcoatRoughness: 0.55, normalScale: 1.25, envMapIntensity: 0.65 };

const slabDims = (s: Slab) => ({ L: s.lengthMm / 1000, H: s.heightMm / 1000, T: s.thicknessMm / 1000 });
export const pulledZ = (s: Slab) => RACK_FRONT + PULL_CLEAR + s.lengthMm / 2000;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Fixed overview & pulled camera poses for the slab parked at `x`. */
function poses(x: number, slab: Slab, aspect: number, fov: number, book: number) {
  const { L, H } = slabDims(slab);
  const zc = pulledZ(slab);
  const yc = TOP - H / 2;
  const vfov = (fov * Math.PI) / 180;
  const tan = Math.tan(vfov / 2);
  const width = L * (1 + book) + book * 0.01;
  const fitH = (H * 1.08) / (2 * tan);
  const fitW = (width * 1.06) / (2 * tan * aspect);
  // landscape: show the whole slab; portrait / square panes: the stone fills the frame
  const contain = Math.max(fitH, fitW);
  const cover = aspect < 1.25 ? Math.max(fitH * 0.98, (L * 0.62) / (2 * tan * aspect)) : contain;
  const D = cover + (contain - cover) * book;
  const cz = zc + (book * L) / 2;
  const portrait = aspect < 1;
  return {
    overPos: new THREE.Vector3(x - (portrait ? 4.4 : 3.05), portrait ? 1.5 : 1.34, portrait ? 6.4 : 4.75),
    overLook: new THREE.Vector3(x + (portrait ? 1.0 : 1.55), 1.12, portrait ? 0.2 : -0.35),
    pullPos: new THREE.Vector3(x - D, yc + 0.02, cz),
    pullLook: new THREE.Vector3(x, yc, cz),
  };
}

// ── the frame loop: springs, sway, camera ───────────────────
function Controller() {
  const { camera, size } = useThree();
  const look = useRef(new THREE.Vector3(1, 1.1, 0));
  const parallax = useRef(new THREE.Vector2());
  const last = useRef({ pulledOut: false });
  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), p: new THREE.Vector3(), l: new THREE.Vector3() }), []);

  useFrame((state, rawDt) => {
    const cap = (window as unknown as { __captureDt?: number }).__captureDt;
    // real-time physics: integrate in small sub-steps so slow frames don't slow the choreography
    const frameDt = cap ?? Math.min(rawDt, 0.25);
    const dt = frameDt; // camera smoothing below follows real time too
    const st = useRack.getState();
    const slab = st.override ? SLAB_BY_ID[st.override] : RACK_A[st.index];

    let remaining = frameDt;
    while (remaining > 1e-6) {
      const h = Math.min(remaining, 1 / 120);
      remaining -= h;
      // camera index (critically damped)
      {
        const target = st.index;
        if (Math.abs(target - anim.camIndex) > RACK_SIZE / 2) anim.camIndex += Math.sign(target - anim.camIndex) * RACK_SIZE;
        const w = 6.2;
        anim.camVel += (w * w * (target - anim.camIndex) - 2 * w * anim.camVel) * h;
        anim.camIndex += anim.camVel * h;
      }
      // pull spring — heavy, slightly under-damped: the 600 ms settle
      {
        const w = st.dragging ? 11 : 7.2;
        const z = st.dragging ? 0.95 : 0.7;
        const prevVel = anim.pullVel;
        const acc = w * w * (st.pullTarget - anim.pull) - 2 * z * w * anim.pullVel;
        anim.pullVel += acc * h;
        anim.pull += anim.pullVel * h;
        anim.pull = Math.max(-0.02, Math.min(1.06, anim.pull));
        // pendulum: the hanging partition swings when the rail decelerates
        const railAcc = (anim.pullVel - prevVel) / h;
        const ws = 6.6, zs = 0.22;
        const sAcc = -ws * ws * anim.sway - 2 * zs * ws * anim.swayVel - railAcc * 0.0045;
        anim.swayVel += sAcc * h;
        anim.sway += anim.swayVel * h;
        anim.sway = Math.max(-0.05, Math.min(0.05, anim.sway));
      }
      // bookmatch hinge
      {
        const target = st.bookmatch ? 1 : 0;
        const w = 5.4, z = 0.62;
        anim.bookVel += (w * w * (target - anim.book) - 2 * z * w * anim.bookVel) * h;
        anim.book += anim.bookVel * h;
        anim.book = Math.max(-0.04, Math.min(1.08, anim.book));
      }
    }

    const out = anim.pull > 0.9 && Math.abs(anim.pullVel) < 0.6;
    const inn = anim.pull < 0.82;
    if (out && !last.current.pulledOut) {
      last.current.pulledOut = true;
      useRack.getState().setPulledOut(true);
    } else if (inn && last.current.pulledOut) {
      last.current.pulledOut = false;
      useRack.getState().setPulledOut(false);
    }

    // camera
    const x = anim.camIndex * GAP;
    const persp = camera as THREE.PerspectiveCamera;
    const book = Math.max(0, Math.min(1, anim.book));
    const P = poses(x, slab, size.width / Math.max(1, size.height), persp.fov, book);
    const c = smooth(0.16, 1, anim.pull);
    // swing outward on the way so the camera arcs around the sliding slab
    const arc = Math.sin(Math.PI * c) * 0.55;
    tmp.p.lerpVectors(P.overPos, P.pullPos, c);
    tmp.p.x -= arc * 0.6;
    tmp.p.y += arc * 0.18;
    tmp.l.lerpVectors(P.overLook, P.pullLook, c);

    // pointer parallax + idle breathing (quiet, heavy)
    const t = state.clock.elapsedTime;
    parallax.current.lerp(state.pointer, 1 - Math.exp(-dt * 1.6));
    const calm = 1 - c * 0.85;
    tmp.p.y += parallax.current.y * 0.12 * calm + Math.sin(t * 0.35) * 0.012;
    tmp.p.z += -parallax.current.x * 0.22 * calm;
    tmp.l.y += Math.sin(t * 0.27) * 0.008;

    camera.position.copy(tmp.p);
    look.current.lerp(tmp.l, 1 - Math.exp(-dt * 30));
    camera.lookAt(look.current);

    // rail direction on screen (for dragging the slab along its rail)
    if (anim.pull < 0.12) {
      const { L } = slabDims(slab);
      tmp.a.set(x, TOP - 0.4, L / 2).project(camera);
      tmp.b.set(x, TOP - 0.4, L / 2 + pulledZ(slab) * 0.25).project(camera);
      anim.rail.x = ((tmp.b.x - tmp.a.x) * size.width) / 2 / 0.25;
      anim.rail.y = (-(tmp.b.y - tmp.a.y) * size.height) / 2 / 0.25;
    }
    anim.ready = true;
  });
  return null;
}

/** Soft vertical/horizontal falloff baked into an AO map: pools of light from the rails. */
function pooledLight() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  const v = g.createLinearGradient(0, 0, 0, 128);
  v.addColorStop(0, "#ffffff");
  v.addColorStop(0.45, "#d8d8d8");
  v.addColorStop(1, "#4a4a4a");
  g.fillStyle = v;
  g.fillRect(0, 0, 64, 128);
  const h = g.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, "rgba(0,0,0,0.55)");
  h.addColorStop(0.55, "rgba(0,0,0,0)");
  g.fillStyle = h;
  g.fillRect(0, 0, 64, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// ── rack: instanced frames, rails and bodies + textured faces ──
function Rack({ quality }: { quality: Quality }) {
  const index = useRack((s) => s.index);
  const override = useRack((s) => s.override);
  const [maps, setMaps] = useState<Record<string, THREE.Texture>>({});

  useEffect(() => {
    let alive = true;
    const keys = [...new Set(RACK_A.map((s) => s.tex))];
    // nearest slabs first so the hero frame is textured as soon as possible
    keys.sort((a, b) => RACK_A.findIndex((s) => s.tex === a) - RACK_A.findIndex((s) => s.tex === b));
    keys.forEach((k) =>
      loadTexture(texUrl(k, quality === "high" ? "c1k" : "c512")).then((t) => {
        if (alive) setMaps((m) => ({ ...m, [k]: t }));
      }),
    );
    return () => {
      alive = false;
    };
  }, [quality]);

  const ao = useMemo(() => pooledLight(), []);
  const faceMats = useMemo(
    () =>
      RACK_A.map((s) => {
        const base = maps[s.tex];
        const f = finishMaterial(s.finish);
        return new THREE.MeshStandardMaterial({
          map: base ? cropTexture(base, s) : null,
          color: base ? "#ffffff" : s.mean,
          roughness: Math.max(0.14, f.roughness),
          metalness: 0,
          envMapIntensity: f.envMapIntensity * 0.85,
          aoMap: ao,
          aoMapIntensity: 1,
        });
      }),
    [maps, ao],
  );

  const steel = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#151515", roughness: 0.38, metalness: 0.85, envMapIntensity: 0.9 }),
    [],
  );
  const edge = useMemo(() => new THREE.MeshStandardMaterial({ color: "#2a2927", roughness: 0.72, metalness: 0 }), []);
  const unitBox = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const plane = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const topRef = useRef<THREE.InstancedMesh>(null);
  const postRef = useRef<THREE.InstancedMesh>(null);
  const railRef = useRef<THREE.InstancedMesh>(null);
  const bodyRef = useRef<THREE.InstancedMesh>(null);

  // static instance matrices (active slot hidden — it is drawn by <ActivePartition/>)
  useEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const hidden = index; // the front slot is drawn by <ActivePartition/> (rack slab or an override)
    RACK_A.forEach((s, i) => {
      const x = i * GAP;
      const { L, H, T } = slabDims(s);
      const show = i !== hidden ? 1 : 0.0001;
      m.compose(new THREE.Vector3(x, TOP + 0.05, 0), q, new THREE.Vector3(0.045 * show, 0.07 * show, FRAME_L * show));
      topRef.current?.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, TOP - FRAME_H / 2 + 0.06, FRAME_L / 2), q, new THREE.Vector3(0.05 * show, FRAME_H * show, 0.05 * show));
      postRef.current?.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, TOP + 0.24, -0.2), q, new THREE.Vector3(0.03, 0.05, FRAME_L + 0.5));
      railRef.current?.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x + T / 2 + 0.001, TOP - H / 2, 0), q, new THREE.Vector3(T * show, H * show, L * show));
      bodyRef.current?.setMatrixAt(i, m);
    });
    for (const r of [topRef, postRef, railRef, bodyRef]) if (r.current) r.current.instanceMatrix.needsUpdate = true;
  }, [index, override]);

  return (
    <group>
      <instancedMesh ref={topRef} args={[unitBox, steel, RACK_SIZE]} frustumCulled={false} />
      <instancedMesh ref={postRef} args={[unitBox, steel, RACK_SIZE]} frustumCulled={false} />
      <instancedMesh ref={railRef} args={[unitBox, steel, RACK_SIZE]} frustumCulled={false} />
      <instancedMesh ref={bodyRef} args={[unitBox, edge, RACK_SIZE]} frustumCulled={false} />
      {/* cross beams */}
      <mesh position={[(RACK_SIZE * GAP) / 2 - 0.3, TOP + 0.31, RACK_FRONT + 0.1]} material={steel}>
        <boxGeometry args={[RACK_SIZE * GAP + 1.2, 0.09, 0.12]} />
      </mesh>
      <mesh position={[(RACK_SIZE * GAP) / 2 - 0.3, TOP + 0.31, -RACK_FRONT - 0.4]} material={steel}>
        <boxGeometry args={[RACK_SIZE * GAP + 1.2, 0.09, 0.12]} />
      </mesh>
      {RACK_A.map((s, i) => {
        if (i === index) return null;
        const { L, H } = slabDims(s);
        return (
          <mesh
            key={s.id}
            geometry={plane}
            material={faceMats[i]}
            position={[i * GAP - 0.0005, TOP - H / 2, 0]}
            rotation={[0, -Math.PI / 2, 0]}
            scale={[L, H, 1]}
          />
        );
      })}
      <ActivePartition quality={quality} steel={steel} edge={edge} />
    </group>
  );
}

// ── the slab that slides out ────────────────────────────────
function ActivePartition({ quality, steel, edge }: { quality: Quality; steel: THREE.Material; edge: THREE.Material }) {
  const index = useRack((s) => s.index);
  const override = useRack((s) => s.override);
  const slab = override ? SLAB_BY_ID[override] : RACK_A[index];
  const twin = useMemo(() => twinOf(slab), [slab]);
  const group = useRef<THREE.Group>(null);
  const swing = useRef<THREE.Group>(null);
  const hinge = useRef<THREE.Group>(null);
  const rake = useRef<THREE.SpotLight>(null);
  const rakeTarget = useMemo(() => new THREE.Object3D(), []);
  const twinLight = useRef<THREE.SpotLight>(null);
  const twinTarget = useMemo(() => new THREE.Object3D(), []);
  const post = useRef<THREE.Group>(null);
  const { L, H, T } = slabDims(slab);

  const [hi, setHi] = useState<{ id: string; map: THREE.Texture; normal: THREE.Texture | null } | null>(null);

  // progressive: c1k crop immediately, then 2K/4K + normal map
  useEffect(() => {
    let alive = true;
    const tier = quality === "high" && slab.hero ? "c4k" : "c2k";
    Promise.all([loadTexture(texUrl(slab.tex, tier)), loadTexture(texUrl(slab.tex, "n2k"), false).catch(() => null)]).then(
      ([map, normal]) => {
        if (alive) setHi({ id: slab.id, map, normal });
      },
    );
    return () => {
      alive = false;
    };
  }, [slab, quality]);

  const material = useMemo(() => {
    const f = finishMaterial(slab.finish);
    const low = peekTexture(texUrl(slab.tex, "c1k")) ?? peekTexture(texUrl(slab.tex, "c512"));
    const useHi = hi && hi.id === slab.id;
    const map = useHi ? cropTexture(hi.map, slab) : low ? cropTexture(low, slab) : null;
    const normal = useHi && hi.normal ? cropTexture(hi.normal, slab) : null;
    const mat = new THREE.MeshPhysicalMaterial({
      map,
      color: map ? "#ffffff" : slab.mean,
      normalMap: normal,
      normalScale: new THREE.Vector2(f.normalScale, f.normalScale),
      roughness: f.roughness,
      metalness: 0,
      clearcoat: f.clearcoat,
      clearcoatRoughness: f.clearcoatRoughness,
      envMapIntensity: f.envMapIntensity,
      specularIntensity: 0.6,
    });
    return mat;
  }, [slab, hi]);

  const twinMaterial = useMemo(() => {
    const m = material.clone();
    if (material.map) m.map = cropTexture(material.map, slab, true);
    if (material.normalMap) m.normalMap = cropTexture(material.normalMap, slab, true);
    m.side = THREE.DoubleSide;
    return m;
  }, [material, slab]);

  useFrame((state) => {
    if (!group.current || !swing.current) return;
    const x = index * GAP;
    const zc = pulledZ(slab);
    const zf = smooth(0, 0.8, Math.max(0, anim.pull));
    const over = Math.max(0, anim.pull - 1) * 0.6; // spring overshoot carries a few cm further
    group.current.position.set(x, 0, zc * zf + over);
    swing.current.rotation.x = anim.sway;
    if (hinge.current) {
      const b = Math.max(0, Math.min(1.08, anim.book));
      hinge.current.rotation.y = Math.PI * (1 - b) * 0.999;
      hinge.current.visible = anim.book > 0.002;
      hinge.current.position.x = 0.004 + (1 - Math.min(1, b)) * (T + 0.006);
      if (twinLight.current) twinLight.current.intensity = 16 * Math.min(1, b) * smooth(0.5, 1, anim.pull);
    }
    if (post.current) {
      const b = Math.max(0, Math.min(1, anim.book));
      post.current.position.y = b * 2.6; // slides up on its carriage, out of frame
      post.current.visible = b < 0.95;
    }
    if (rake.current) {
      const t = state.clock.elapsedTime;
      // the raking light drifts slowly along the slab so highlights travel across the polish
      const bk = Math.max(0, Math.min(1, anim.book));
      rake.current.intensity = (13 + bk * 9) * smooth(0.3, 1, anim.pull);
      rake.current.position.set(-1.8 - bk * 1.4, TOP + 1.2 + bk * 0.4, -L / 2 - 0.4 + bk * L * 0.75 + Math.sin(t * 0.22) * 0.45);
      rakeTarget.position.set(0, TOP - H * 0.6, L * 0.32 + bk * L * 0.6 + Math.sin(t * 0.22) * 0.45);
      rake.current.angle = 0.95 + bk * 0.25;
    }
  });

  return (
    <group ref={group}>
      {/* pivot at the rail carriage: the partition hangs and can sway */}
      <group position={[0, TOP + 0.24, 0]}>
        <group ref={swing}>
          <group position={[0, -TOP - 0.24, 0]}>
            <mesh material={steel} position={[0, TOP + 0.05, 0]}>
              <boxGeometry args={[0.045, 0.07, FRAME_L]} />
            </mesh>
            {/* front post + handle: they step aside when the book opens, so the seam reads clean */}
            <group ref={post}>
              <mesh material={steel} position={[0, TOP - FRAME_H / 2 + 0.06, FRAME_L / 2]}>
                <boxGeometry args={[0.05, FRAME_H, 0.05]} />
              </mesh>
              <mesh material={steel} position={[-0.05, TOP - 0.9, FRAME_L / 2 + 0.01]}>
                <cylinderGeometry args={[0.014, 0.014, 0.62, 12]} />
              </mesh>
            </group>
            {/* telescopic rail extension */}
            <mesh material={steel} position={[0, TOP + 0.19, -0.1]}>
              <boxGeometry args={[0.022, 0.035, FRAME_L + 0.2]} />
            </mesh>
            <mesh material={edge} position={[T / 2 + 0.001, TOP - H / 2, 0]}>
              <boxGeometry args={[T, H, L]} />
            </mesh>
            <mesh material={material} position={[-0.0008, TOP - H / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
              <planeGeometry args={[L, H]} />
            </mesh>
            {/* bookmatch twin, hinged on the far edge */}
            <group ref={hinge} position={[0.004, TOP - H / 2, L / 2]} visible={false}>
              <mesh material={twinMaterial} position={[0, 0, L / 2 + 0.002]} rotation={[0, -Math.PI / 2, 0]}>
                <planeGeometry args={[L, H]} />
              </mesh>
              <mesh material={edge} position={[T / 2 + 0.001, 0, L / 2 + 0.002]}>
                <boxGeometry args={[T, H, L]} />
              </mesh>
              <primitive object={twinTarget} position={[0, -H * 0.1, L * 0.5]} />
              <spotLight
                ref={twinLight}
                target={twinTarget}
                position={[-2.4, H * 0.95, L * 0.35]}
                angle={1.0}
                penumbra={1}
                distance={10}
                decay={1.4}
                intensity={0}
                color="#f3f1ec"
              />
            </group>
            <primitive object={rakeTarget} />
            <spotLight
              ref={rake}
              target={rakeTarget}
              angle={0.95}
              penumbra={1}
              distance={11}
              decay={1.4}
              intensity={0}
              color="#f3f1ec"
            />
          </group>
        </group>
      </group>
      <TwinLabel twinId={twin.id} />
    </group>
  );
}

function TwinLabel({ twinId }: { twinId: string }) {
  void twinId;
  return null;
}

function Floor({ quality }: { quality: Quality }) {
  if (quality !== "high") {
    return (
      <mesh rotation-x={-Math.PI / 2} position={[6, 0, 0]}>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#0b0b0b" roughness={0.35} metalness={0.2} />
      </mesh>
    );
  }
  return (
    <mesh rotation-x={-Math.PI / 2} position={[6, 0, 0]}>
      <planeGeometry args={[60, 60]} />
      <MeshReflectorMaterial
        resolution={512}
        blur={[300, 90]}
        mixBlur={0.9}
        mixStrength={6}
        roughness={0.75}
        depthScale={1.2}
        minDepthThreshold={0.3}
        maxDepthThreshold={1.4}
        color="#101010"
        metalness={0.55}
        mirror={0.75}
      />
    </mesh>
  );
}

function Lights() {
  const key = useRef<THREE.SpotLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const keyTarget = useMemo(() => new THREE.Object3D(), []);
  useFrame(() => {
    const x = anim.camIndex * GAP;
    if (key.current) {
      key.current.position.set(x - 1.6, 4.4, 3.4);
      keyTarget.position.set(x + 0.5, 1.0, 0.4 + anim.pull * 2.4);
    }
    if (hemi.current) hemi.current.intensity = 0.12 + 0.55 * smooth(0.3, 1, anim.pull);
  });
  return (
    <>
      <primitive object={keyTarget} />
      <spotLight ref={key} target={keyTarget} angle={0.55} penumbra={0.9} intensity={55} distance={16} decay={1.7} color="#f3f1ec" />
      <hemisphereLight ref={hemi} args={["#3a3936", "#0e0e0e", 0.12]} />
      <CeilingLights />
    </>
  );
}

/** Linear showroom lights running along the aisle — they also streak across the polished floor. */
function CeilingLights() {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#8e8b85", toneMapped: false, fog: true }), []);
  return (
    <group>
      <mesh material={mat} position={[(RACK_SIZE * GAP) / 2, 3.35, RACK_FRONT + 0.9]}>
        <boxGeometry args={[RACK_SIZE * GAP + 6, 0.025, 0.06]} />
      </mesh>
      <mesh material={mat} position={[(RACK_SIZE * GAP) / 2, 3.35, -0.2]}>
        <boxGeometry args={[RACK_SIZE * GAP + 6, 0.02, 0.05]} />
      </mesh>
    </group>
  );
}

/** Capture mode: expose a manual frame advance so a recorder can render exact frames. */
function CaptureBridge() {
  const advance = useThree((s) => s.advance);
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__captureAdvance = (t: number) => advance(t, true);
    return () => {
      delete w.__captureAdvance;
    };
  }, [advance]);
  return null;
}

function Setup() {
  const { gl, scene } = useThree();
  useEffect(() => {
    gl.toneMapping = THREE.NeutralToneMapping;
    gl.toneMappingExposure = 1.0;
    scene.background = BASALT;
    scene.fog = new THREE.FogExp2(BASALT.getHex(), 0.088);
  }, [gl, scene]);
  return null;
}

export default function RackScene({
  active,
  quality,
  onFirstFrame,
  capture = false,
}: {
  active: boolean;
  quality: Quality;
  onFirstFrame?: () => void;
  capture?: boolean;
}) {
  // adaptive: if frames drop under ~50 fps, shed resolution, then the floor reflection
  const [dpr, setDpr] = useState<number>(quality === "high" ? 1.6 : 1.25);
  const [q, setQ] = useState<Quality>(quality);
  useEffect(() => setQ(quality), [quality]);
  return (
    <Canvas
      dpr={capture ? 1 : Math.min(dpr, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1)}
      gl={{ antialias: true, alpha: false, stencil: false, powerPreference: "high-performance", preserveDrawingBuffer: capture }}
      camera={{ fov: 34, near: 0.05, far: 60, position: [-3, 1.3, 4.7] }}
      frameloop={capture ? "never" : active ? "always" : "never"}
      onCreated={() => onFirstFrame?.()}
      aria-hidden="true"
    >
      <Setup />
      {capture && <CaptureBridge />}
      {!capture && (
        <PerformanceMonitor
          bounds={() => [45, 58]}
          flipflops={3}
          onDecline={() => {
            setDpr((d) => Math.max(1, d - 0.3));
            setQ((cur) => (dpr <= 1.05 ? "medium" : cur));
          }}
          onIncline={() => setDpr((d) => Math.min(quality === "high" ? 1.6 : 1.25, d + 0.15))}
        />
      )}
      <Controller />
      <Lights />
      <Suspense fallback={null}>
        <Environment resolution={256} frames={1}>
          <Lightformer form="rect" intensity={2.2} position={[2, 5.5, 2.5]} rotation-x={Math.PI / 2} scale={[18, 0.35, 1]} />
          <Lightformer form="rect" intensity={1.6} position={[2, 5.5, -0.8]} rotation-x={Math.PI / 2} scale={[18, 0.25, 1]} />
          <Lightformer form="rect" intensity={0.9} position={[-8, 2.4, 3]} rotation-y={Math.PI / 2} scale={[3, 4, 1]} />
          <Lightformer form="rect" intensity={0.35} position={[9, 2.2, -3]} rotation-y={-Math.PI / 2} scale={[5, 3, 1]} />
          <Lightformer form="rect" intensity={0.5} position={[0, 2.5, 11]} scale={[5, 1, 1]} />
          <Lightformer form="ring" intensity={0.35} color="#d9a441" position={[-4, 3.5, 9]} scale={1.2} />
          {/* tall softbox behind the viewer: its reflection is the band that rakes across the polish */}
          <Lightformer
            form="rect"
            intensity={1.15}
            position={[-11, 3.2, 3.6]}
            rotation={[0, Math.PI / 2, 0.42]}
            scale={[1.6, 10, 1]}
          />
          <Lightformer form="rect" intensity={0.45} position={[-11, 1.2, -2]} rotation={[0, Math.PI / 2, 0]} scale={[6, 2, 1]} />
        </Environment>
        <Rack quality={quality} />
        <Floor quality={capture ? quality : q} />
      </Suspense>
    </Canvas>
  );
}
