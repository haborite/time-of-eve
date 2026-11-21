/**
 * UI translation (ja / en). Japanese source strings are the keys (gettext style): views call t(lang, "日本語"),
 * browser scripts call T("日本語"). English lives in src/i18n/en.json (a test checks every key used has one).
 */
import EN_DICT from "../i18n/en.json";
import { format, isLang, type Lang } from "./i18n-format";

export { LANGS, MONTHS_EN, durLabel, fmtDate, format, isLang, shortDate, type Lang } from "./i18n-format";
export const LANG_COOKIE = "toe_lang";
export const EN: Record<string, string> = EN_DICT;

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


