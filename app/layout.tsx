import type { Metadata, Viewport } from "next";
import "@fontsource-variable/frank-ruhl-libre/wght.css";
import "@fontsource-variable/heebo/wght.css";
import "@fontsource/cormorant-garamond/latin-300.css";
import "@fontsource/cormorant-garamond/latin-400.css";
import "@fontsource/cormorant-garamond/latin-500.css";
import "@fontsource/cormorant-garamond/latin-300-italic.css";
import "@fontsource/cormorant-garamond/latin-400-italic.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "פרביטל — 4,000 לוחות · קונספט",
  description:
    "Fervital — 4,000 slabs. A pitch demo of a slab-yard website and portal. Concept by Kikkey — not the official Fervital website.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    noarchive: true,
    nosnippet: true,
    noimageindex: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
  referrer: "no-referrer",
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0e0e0e",
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
