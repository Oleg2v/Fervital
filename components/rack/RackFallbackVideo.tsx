"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/ui";

/** Mobile / low-power: a 6-second render of the rack instead of live WebGL. */
export default function RackFallbackVideo() {
  const { t } = useT();
  const [name, setName] = useState<"portrait" | "landscape" | null>(null);
  useEffect(() => {
    const pick = () => setName(window.innerHeight > window.innerWidth * 1.05 ? "portrait" : "landscape");
    pick();
    window.addEventListener("resize", pick);
    return () => window.removeEventListener("resize", pick);
  }, []);
  if (!name) return null;
  return (
    <video
      key={name}
      className="absolute inset-0 h-full w-full object-cover"
      src={`/video/rack-pull-${name}.mp4`}
      poster={`/video/rack-pull-${name}.jpg`}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      aria-label={t.hero.rackLabel}
    />
  );
}
