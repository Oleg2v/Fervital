"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useT, useUi } from "@/lib/ui";

const HE = {
  title: "הצהרת נגישות",
  updated: "עודכן: נובמבר 2026",
  intro:
    "פרביטל רואה חשיבות רבה במתן שירות שוויוני ונגיש לכל הלקוחות, לרבות אנשים עם מוגבלות. האתר תוכנן בהתאם לחוק שוויון זכויות לאנשים עם מוגבלות, התשנ״ח-1998, לתקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), התשע״ג-2013, ולתקן הישראלי ת״י 5568, המבוסס על הנחיות WCAG 2.0 ברמה AA.",
  doneTitle: "מה עשינו באתר",
  done: [
    "ניווט מלא במקלדת, כולל הקטלוג התלת-ממדי: חיצים למעבר בין הלוחות, Enter לשליפה, Escape להחזרה למדף, B ל-Bookmatch ו-Z להגדלה עד הוריד.",
    "קישור ״דלגו לתוכן הראשי״ בראש כל עמוד.",
    "לכל לוח יש תיאור טקסטואלי של הגוון, הוורידים והגימור, הזמין גם לקוראי מסך.",
    "יחס ניגודיות של 4.5:1 לפחות לטקסט רגיל, ומיקוד מקלדת בולט בצבע ענבר.",
    "כאשר מערכת ההפעלה מבקשת להפחית תנועה, הקטלוג התלת-ממדי מוחלף בקיר לוחות סטטי והאנימציות מבוטלות.",
    "הכרזות לקוראי מסך (aria-live) על החלפת לוח, החזקות, ועדכונים מהמחסן.",
    "מחוון לפני/אחרי בהדמיית המטבח נשלט גם במקלדת.",
    "החלפת שפה בין עברית לאנגלית עם כיווניות ושפה מוגדרות נכון בכל עמוד.",
    "את ההדגמה האוטומטית ניתן להשהות, לדלג על שלב או לעצור בכל רגע.",
  ],
  limitsTitle: "מגבלות ידועות",
  limits: [
    "התצוגה התלת-ממדית היא ייצוג חזותי; כל המידע שבה זמין גם כטקסט.",
    "תכונות הבינה המלאכותית (חיפוש לפי וריד והמטבח שלי באבן) הן בגרסת בטא, וניתוח תמונות שהועלו עשוי להיות לא מדויק.",
    "קובץ ה-PDF של הצעת המחיר אינו מתויג עדיין לנגישות מלאה.",
  ],
  contactTitle: "פנייה בנושא נגישות",
  contact:
    "נתקלתם בקושי? נשמח לשמוע. באתר הרשמי יופיעו פרטי רכז/ת הנגישות של החברה (שם, טלפון ודוא״ל). בדמו זה הפרטים אינם פעילים.",
  concept: "זהו דמו קונספט של Kikkey ואינו האתר הרשמי של פרביטל.",
  back: "חזרה לאתר",
};
const EN: typeof HE = {
  title: "Accessibility statement",
  updated: "Updated: November 2026",
  intro:
    "Fervital is committed to equal, accessible service for every client, including people with disabilities. This site was designed in line with Israel's Equal Rights for Persons with Disabilities Law (1998), the Service Accessibility Regulations (2013) and Israeli Standard 5568, which is based on WCAG 2.0 level AA.",
  doneTitle: "What we have done",
  done: [
    "Full keyboard navigation, including the 3D catalogue: arrow keys move between slabs, Enter pulls a slab, Escape returns it, B toggles bookmatch and Z zooms to the vein.",
    "A “skip to main content” link at the top of every page.",
    "Every slab has a text description of its hue, veining and finish, available to screen readers.",
    "A contrast ratio of at least 4.5:1 for body text, and a clear amber keyboard focus.",
    "When the operating system asks for reduced motion, the 3D catalogue becomes a static slab wall and animations are switched off.",
    "Screen-reader announcements (aria-live) for slab changes, holds and updates from the yard.",
    "The before/after slider in the kitchen simulation works with the keyboard.",
    "Hebrew/English switching with correct language and direction on every page.",
    "The automatic demo can be paused, skipped or stopped at any time.",
  ],
  limitsTitle: "Known limitations",
  limits: [
    "The 3D view is a visual representation; all of its information is also available as text.",
    "The AI features (search by vein, my kitchen in stone) are in beta, and analysis of uploaded photos may be imperfect.",
    "The PDF quote is not yet fully tagged for accessibility.",
  ],
  contactTitle: "Accessibility contact",
  contact:
    "Had trouble? We want to hear about it. The official site will list the company's accessibility coordinator (name, phone and email). In this demo those details are not live.",
  concept: "This is a Kikkey concept demo and not Fervital's official website.",
  back: "Back to the site",
};

export default function Statement() {
  const { lang } = useT();
  const c = lang === "he" ? HE : EN;
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
    document.title = `${c.title} — Fervital`;
  }, [lang, c.title]);
  return (
    <main id="main" className="paper min-h-[100svh]">
      <a href="#content" className="skip-link">
        {lang === "he" ? "דלגו לתוכן הראשי" : "Skip to main content"}
      </a>
      <div className="flex items-center justify-between border-b border-[var(--hair)] px-6 py-4 md:px-10">
        <Link href="/" className="underline underline-offset-4">
          {lang === "he" ? "→" : "←"} {c.back}
        </Link>
        <button type="button" className="btn !min-h-[36px]" onClick={() => useUi.getState().setLang(lang === "he" ? "en" : "he")}>
          {lang === "he" ? "English" : "עברית"}
        </button>
      </div>
      <article id="content" className="mx-auto max-w-[860px] px-6 py-16 md:px-10">
        <p className="eyebrow muted">{c.updated}</p>
        <h1 className="font-display mt-4 text-[clamp(2.6rem,6vw,5rem)] leading-[0.95]">{c.title}</h1>
        <p className="mt-8 text-[1.1rem] leading-[1.8]">{c.intro}</p>
        <h2 className="font-display mt-14 text-[2rem]">{c.doneTitle}</h2>
        <ul className="mt-5 grid gap-3">
          {c.done.map((d) => (
            <li key={d} className="border-t border-[var(--hair)] pt-3 leading-relaxed">
              {d}
            </li>
          ))}
        </ul>
        <h2 className="font-display mt-14 text-[2rem]">{c.limitsTitle}</h2>
        <ul className="mt-5 grid gap-3">
          {c.limits.map((d) => (
            <li key={d} className="border-t border-[var(--hair)] pt-3 leading-relaxed muted">
              {d}
            </li>
          ))}
        </ul>
        <h2 className="font-display mt-14 text-[2rem]">{c.contactTitle}</h2>
        <p className="mt-5 leading-relaxed">{c.contact}</p>
        <p className="mt-16 text-[0.85rem] muted">{c.concept}</p>
      </article>
    </main>
  );
}
