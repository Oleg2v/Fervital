"use client";

import dynamic from "next/dynamic";

// The experience is client-only: live countdowns, persisted demo state and WebGL
// never hydrate against server HTML. The preloader (server-rendered) covers first paint.
const Experience = dynamic(() => import("./Experience"), { ssr: false });

export default function ExperienceClient() {
  return <Experience />;
}
