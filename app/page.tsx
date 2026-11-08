import Preloader from "@/components/chrome/Preloader";
import ExperienceClient from "@/components/ExperienceClient";

export default function Page() {
  return (
    <>
      <Preloader />
      <ExperienceClient />
      <noscript>
        <p style={{ padding: 24, color: "#f3f1ec" }}>
          פרביטל — 4,000 לוחות. האתר דורש JavaScript. · Fervital — 4,000 slabs. This site needs JavaScript.
        </p>
      </noscript>
    </>
  );
}
