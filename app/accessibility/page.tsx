import type { Metadata } from "next";
import Statement from "./Statement";

export const metadata: Metadata = {
  title: "הצהרת נגישות — פרביטל (קונספט)",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <Statement />;
}
