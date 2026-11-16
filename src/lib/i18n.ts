/**
 * UI translation (ja / en). Japanese source strings are the keys (gettext style): views call t(lang, "日本語"),
 * browser scripts call T("日本語"). English lives in src/i18n/en.json (a test checks every key used has one).
 */
import EN_DICT from "../i18n/en.json";
import type { Local } from "./time";

export const LANGS = ["ja", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_COOKIE = "toe_lang";
export const EN: Record<string, string> = EN_DICT;

const WEEKDAYS: Record<Lang, readonly string[]> = {
  ja: ["月", "火", "水", "木", "金", "土", "日"],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};
export const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function isLang(v: unknown): v is Lang {
  return v === "ja" || v === "en";
}

/** Cookie wins; otherwise the first of ja/en in Accept-Language (by q-value); default `fallback`. */
export function detectLang(cookie: string | undefined | null, acceptLanguage: string | undefined | null, fallback: Lang = "ja"): Lang {
  if (isLang(cookie)) return cookie;
  let best: Lang = fallback;
  let bestQ = -1;
  (acceptLanguage || "").split(",").forEach((part, i) => {
    const [tag, ...params] = part.trim().split(";");
    const base = tag.trim().toLowerCase().split("-")[0];
    if (!isLang(base)) return;
    let q = 1;
    const qp = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    if (qp) q = Number(qp.slice(2)) || 0;
    q -= i * 1e-6;
    if (q > bestQ) {
      best = base;
      bestQ = q;
    }
  });
  return best;
}

export function format(s: string, kw?: Record<string, string | number>): string {
  if (!kw) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in kw ? String(kw[k]) : m));
}

export function t(lang: Lang, s: string, kw?: Record<string, string | number>): string {
  return format(lang === "en" ? EN[s] ?? s : s, kw);
}

/** Dictionary embedded into pages for browser-side T(). Escaped for <script type="application/json">. */
export function jsDict(lang: Lang): string {
  return lang === "en" ? safeJson(EN) : "{}";
}

export function safeJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export function fmtDate(lang: Lang, d: Pick<Local, "year" | "month" | "day" | "weekday">): string {
  if (lang === "en") return `${WEEKDAYS.en[d.weekday]}, ${MONTHS_EN[d.month - 1]} ${d.day}, ${d.year}`;
  return `${d.year}/${d.month}/${d.day}(${WEEKDAYS.ja[d.weekday]})`;
}

export function shortDate(lang: Lang, d: Pick<Local, "month" | "day" | "weekday">): string {
  if (lang === "en") return `${WEEKDAYS.en[d.weekday]} ${d.month}/${d.day}`;
  return `${d.month}/${d.day}(${WEEKDAYS.ja[d.weekday]})`;
}

export function durLabel(lang: Lang, minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (lang === "en") return [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
  return (h ? `${h}時間` : "") + (m ? `${m}分` : "");
}
