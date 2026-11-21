/**
 * Browser-side translation: T("日本語の原文", {k: v}) returns the English text when the page language is en.
 * The dictionary is embedded by the layout as <script type="application/json" id="i18n">.
 */
import { format, shortDate as fmtShortDate, type Lang } from "../../shared/i18n-format";
import type { Local } from "../../shared/time";
import { readJson } from "./dom";

const dict = readJson<Record<string, string>>("i18n", {});

export const LANG: Lang = document.documentElement.lang === "en" ? "en" : "ja";
/** Locale for Intl / toLocaleDateString. */
export const LOCALE = LANG === "en" ? "en-US" : "ja-JP";

export function T(s: string, kw?: Record<string, string | number>): string {
  return format(Object.prototype.hasOwnProperty.call(dict, s) ? dict[s] : s, kw);
}

/** Wall-clock date fields of a Date in the browser's zone (weekday 0 = Monday, as in Local). */
export function localDay(d: Date): Pick<Local, "year" | "month" | "day" | "weekday"> {
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), weekday: (d.getDay() + 6) % 7 };
}

/** "11/15(日)" or "Sun 11/15" */
export function shortDate(d: Date): string {
  return fmtShortDate(LANG, localDay(d));
}

/** "8時" or "08:00" */
export function hourLabel(h: number): string {
  return LANG === "en" ? String(h).padStart(2, "0") + ":00" : h + "時";
}

/** " sat" / " sun" class suffix for a weekday (0 = Monday). */
export function weekendClass(weekday: number): string {
  return weekday === 6 ? " sun" : weekday === 5 ? " sat" : "";
}
