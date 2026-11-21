/**
 * Link-preview data (OGP / Twitter Card): the facts drawn on a poll's share image and its <meta> values.
 * Participant names, comments and the description never go into the image.
 * The image URL carries a hash of everything drawn (?v=…) so preview caches refresh when the poll changes.
 */
import { sha256Hex } from "../lib/crypto";
import { MONTHS_EN, fmtDate, t, type Lang } from "../lib/i18n";
import { toLocal, type Local } from "../shared/time";
import type { Links } from "../domain/links";
import { activeCandidates, effectiveStatus, finalizedCandidate, type PollAggregate } from "../domain/model";
import { fmtDateTime, fmtRange } from "../domain/views";

export const SITE_NAME = "Time of EVE";
/** Share image used when dynamic images are off (the default) or fail to render. Served as a static asset. */
export const STATIC_OG = "/static/og-default.png";
export const SITE_DESC_JA = "人間にもAIにも使いやすい日程調整ツール。候補を選んでURLを送るだけ。回答はログイン不要、AIエージェントはAPIとMCPで作成から回答まで完結できます。";

export interface Card {
  lang: Lang;
  title: string;
  status: string;
  statusLabel: string;
  period: string;
  count: string;
  deadline: string;
  finalized: string;
  responded: string;
}

export const STATUS_LABEL_JA: Record<string, string> = { open: "回答受付中", closed: "締切", finalized: "確定済み", cancelled: "中止" };

function md(lang: Lang, d: Local) {
  const wd = lang === "en" ? "" : `(${"月火水木金土日"[d.weekday]})`;
  return lang === "en" ? `${MONTHS_EN[d.month - 1]} ${d.day}` : `${d.month}/${d.day}${wd}`;
}

export function periodLabel(agg: PollAggregate, lang: Lang): string {
  const cands = activeCandidates(agg);
  if (!cands.length) return "";
  const tz = agg.poll.timezone;
  const first = toLocal(Math.min(...cands.map((c) => c.startAt)), tz);
  const last = toLocal(Math.max(...cands.map((c) => c.startAt)), tz);
  if (first.year === last.year && first.month === last.month && first.day === last.day) return fmtDate(lang, first);
  if (lang === "en") return `${md(lang, first)}${first.year === last.year ? "" : `, ${first.year}`} – ${md(lang, last)}, ${last.year}`;
  return `${first.year}/${md(lang, first)} 〜 ${first.year === last.year ? md(lang, last) : `${last.year}/${md(lang, last)}`}`;
}

/** Drop characters the font may not draw (emoji, variation selectors, controls) and collapse whitespace. */
export function clean(s: string): string {
  return (s || "").normalize("NFC")
    .replace(/[\u{10000}-\u{10FFFF}\uFE00-\uFE0F\u2600-\u27BF\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F]/gu, "")
    .replace(/\s+/g, " ").trim();
}

export function cardFor(agg: PollAggregate, lang: Lang): Card {
  const status = effectiveStatus(agg.poll);
  const n = activeCandidates(agg).length;
  const fin = finalizedCandidate(agg);
  const responded = agg.participants.filter((p) => p.respondedAt != null).length;
  return {
    lang, title: clean(agg.poll.title), status, statusLabel: t(lang, STATUS_LABEL_JA[status]),
    period: periodLabel(agg, lang),
    count: n ? t(lang, "候補 {n}件", { n }) : "",
    deadline: agg.poll.responseDeadline != null && status === "open" ? t(lang, "回答期限 {dt}", { dt: fmtDateTime(agg, agg.poll.responseDeadline, lang) }) : "",
    finalized: fin && status === "finalized" ? fmtRange(agg, fin, lang) : "",
    responded: responded ? t(lang, "{n}人が回答", { n: responded }) : "",
  };
}

export function siteCard(lang: Lang): Card {
  return { lang, title: SITE_NAME, status: "", statusLabel: "", period: "", count: "", deadline: "", finalized: "", responded: "" };
}

export async function cardVersion(card: Card): Promise<string> {
  return (await sha256Hex(Object.values(card).join("\x1f") + "\x1fv2")).slice(0, 12);
}

export interface Meta {
  title: string;
  description: string;
  url: string;
  image: string;
  imageAlt: string;
}

function clip(s: string, n: number) {
  const x = s.replace(/\s+/g, " ").trim();
  return x.length <= n ? x : x.slice(0, n - 1).trimEnd() + "…";
}

export async function pollMeta(agg: PollAggregate, lang: Lang, links: Links): Promise<Meta> {
  const card = cardFor(agg, lang);
  let lead: string;
  if (card.finalized) lead = t(lang, "日程が確定しました: {when}", { when: card.finalized });
  else if (card.status === "open") lead = t(lang, "候補日時から都合の良い時間を○△×で回答してください。");
  else if (card.status === "cancelled") lead = t(lang, "この日程調整は中止されました。");
  else lead = t(lang, "回答の受付は終了しました。");
  const facts = [card.period, card.count, card.deadline].filter(Boolean).join(lang === "ja" ? "・" : " · ");
  let desc = [lead, facts].filter(Boolean).join(" ");
  if (agg.poll.description) desc += (lang === "ja" ? "｜" : " | ") + agg.poll.description;
  return {
    title: card.title, description: clip(desc, 200), url: links.publicUrl(agg.poll),
    image: links.dynamicOg ? links.url(`/og/p/${agg.poll.publicId}.png?v=${await cardVersion(card)}&lang=${lang}`) : links.url(STATIC_OG),
    imageAlt: card.period ? `${card.title} — ${card.period}` : card.title,
  };
}

export async function siteMeta(lang: Lang, links: Links, path = "/", title?: string, description?: string): Promise<Meta> {
  return {
    title: title ?? SITE_NAME, description: description ?? t(lang, SITE_DESC_JA), url: links.url(path),
    image: links.dynamicOg ? links.url(`/og/default.png?v=${await cardVersion(siteCard(lang))}&lang=${lang}`) : links.url(STATIC_OG), imageAlt: SITE_NAME,
  };
}
