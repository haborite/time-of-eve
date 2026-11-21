/**
 * Language-dependent formatting shared by the Worker and the browser (src/client).
 * No dictionary here (see src/lib/i18n.ts): browser bundles must not pull in src/i18n/en.json.
 */
import type { Local } from "./time";

export const LANGS = ["ja", "en"] as const;
export type Lang = (typeof LANGS)[number];

/** Index 0 = Monday … 6 = Sunday (same convention as Local.weekday). */
export const WEEKDAYS: Record<Lang, readonly string[]> = {
  ja: ["月", "火", "水", "木", "金", "土", "日"],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};
export const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function isLang(v: unknown): v is Lang {
  return v === "ja" || v === "en";
}

/** Fill "{name}" placeholders; unknown placeholders are left as they are. */
export function format(s: string, kw?: Record<string, string | number>): string {
  if (!kw) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(kw, k) ? String(kw[k]) : m));
}

/** "2026/12/1(火)" / "Tue, Dec 1, 2026" */
export function fmtDate(lang: Lang, d: Pick<Local, "year" | "month" | "day" | "weekday">): string {
  if (lang === "en") return `${WEEKDAYS.en[d.weekday]}, ${MONTHS_EN[d.month - 1]} ${d.day}, ${d.year}`;
  return `${d.year}/${d.month}/${d.day}(${WEEKDAYS.ja[d.weekday]})`;
}

/** "12/1(火)" / "Tue 12/1" */
export function shortDate(lang: Lang, d: Pick<Local, "month" | "day" | "weekday">): string {
  if (lang === "en") return `${WEEKDAYS.en[d.weekday]} ${d.month}/${d.day}`;
  return `${d.month}/${d.day}(${WEEKDAYS.ja[d.weekday]})`;
}

export function durLabel(lang: Lang, minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (lang === "en") return [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
  return (h ? `${h}時間` : "") + (m ? `${m}分` : "");
}
