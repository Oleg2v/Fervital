"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Lang } from "./types";
import { AUTOPILOT_SLAB_ID, CUSTOMERS, PROJECTS } from "./data";
import { dict, fmt } from "./i18n";

export type View = "customer" | "yard" | "live";
export type Tier = "webgl" | "video" | "static";

interface UiState {
  lang: Lang;
  view: View;
  personaId: string;
  projectId: string;
  tier: Tier | null;
  zoomSlabId: string | null;
  kitchenSlabId: string;
  kitchenOpen: boolean; // compact (live pane) kitchen modal
  yourSlab: string | null; // "הלוח שלך" reveal
  wipe: { n: number; label: string };
  announce: string;
  autopilot: { running: boolean; paused: boolean; step: number; total: number; done: boolean };
  setLang: (l: Lang) => void;
  setView: (v: View) => void;
  setPersona: (id: string) => void;
  setProject: (id: string) => void;
  setTier: (t: Tier) => void;
  openZoom: (id: string | null) => void;
  setKitchenSlab: (id: string) => void;
  setKitchenOpen: (o: boolean) => void;
  setYourSlab: (id: string | null) => void;
  triggerWipe: (label?: string) => void;
  say: (msg: string) => void;
  setAutopilot: (p: Partial<UiState["autopilot"]>) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      lang: "he",
      view: "customer",
      personaId: "c-alon",
      projectId: "p-alon-villa",
      tier: null,
      zoomSlabId: null,
      kitchenSlabId: AUTOPILOT_SLAB_ID,
      kitchenOpen: false,
      yourSlab: null,
      wipe: { n: 0, label: "" },
      announce: "",
      autopilot: { running: false, paused: false, step: -1, total: 8, done: false },
      setLang: (lang) => set({ lang }),
      setView: (view) => set({ view }),
      setPersona: (personaId) => {
        const first = PROJECTS.find((p) => p.customerId === personaId);
        set({ personaId, projectId: first?.id ?? get().projectId });
      },
      setProject: (projectId) => set({ projectId }),
      setTier: (tier) => set({ tier }),
      openZoom: (zoomSlabId) => set({ zoomSlabId }),
      setKitchenSlab: (kitchenSlabId) => set({ kitchenSlabId }),
      setKitchenOpen: (kitchenOpen) => set({ kitchenOpen }),
      setYourSlab: (yourSlab) => set({ yourSlab }),
      triggerWipe: (label = "") => set((s) => ({ wipe: { n: s.wipe.n + 1, label } })),
      say: (announce) => set({ announce }),
      setAutopilot: (p) => set((s) => ({ autopilot: { ...s.autopilot, ...p } })),
    }),
    {
      name: "fervital-ui",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({ lang: s.lang, view: s.view, personaId: s.personaId, projectId: s.projectId }),
    },
  ),
);

export function useT() {
  const lang = useUi((s) => s.lang);
  // forward / back glyphs follow the reading direction ("next" points left in Hebrew)
  const arrow = lang === "he" ? { fwd: "←", back: "→" } : { fwd: "→", back: "←" };
  return { lang, t: dict[lang], fmt, arrow, dir: lang === "he" ? ("rtl" as const) : ("ltr" as const) };
}

export const personaName = (id: string, lang: Lang) => CUSTOMERS.find((c) => c.id === id)?.name[lang] ?? "";
