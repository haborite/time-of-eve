/**
 * Public answer page, pure logic (no DOM): lays the poll's slots out in the display time zone.
 *
 * Slot keys ("2026-12-01T13:00") are wall-clock times in the poll's zone: answers, counts and the finalized date use
 * them. Only the layout follows the display zone: `at` gives each slot's absolute start, and every slot is placed on
 * the display zone's date and time. Rows are display-zone dates (a window crossing midnight splits into two rows);
 * columns follow the slots' own boundaries, so zones offset by :15/:45 get :15/:45 columns.
 */
import { fmtDate, shortDate, type Lang } from "../../shared/i18n-format";
import { isValidTimeZone, toLocal } from "../../shared/time";
import type { PublicBoot, SlotKey } from "../../shared/public-boot";

/** What the display time zone is set to: the viewer's zone, the poll's zone, or an IANA zone. */
export type TzChoice = "local" | "poll" | (string & {});

/** The zone a choice stands for; anything unusable falls back to the poll's zone. */
export function zoneOf(choice: TzChoice, localTz: string, pollTz: string): string {
  const z = choice === "poll" ? pollTz : choice === "local" ? localTz : choice;
  return isValidTimeZone(z) ? z : pollTz;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Minutes since midnight → "HH:MM" (wraps past 24:00). */
export function clock(min: number): string {
  return pad(Math.floor(min / 60) % 24) + ":" + pad(min % 60);
}

/** "2026/12/1(火) 13:00–14:00", with the end date when the range crosses midnight. */
export function fmtRange(lang: Lang, startMs: number, endMs: number, tz: string): string {
  const a = toLocal(startMs, tz), b = toLocal(endMs, tz);
  const same = a.year === b.year && a.month === b.month && a.day === b.day;
  return fmtDate(lang, a) + " " + clock(a.hour * 60 + a.minute) + "–" + (same ? "" : b.month + "/" + b.day + " ") + clock(b.hour * 60 + b.minute);
}

export function fmtDateTime(lang: Lang, ms: number, tz: string): string {
  const a = toLocal(ms, tz);
  return fmtDate(lang, a) + " " + clock(a.hour * 60 + a.minute);
}

/** One column of a day row: a slot (key) or an empty place (null) at minute `m`. */
export interface Col {
  m: number;
  key: SlotKey | null;
  /** First column after hours that were left out. */
  gap: boolean;
}

/** One hour heading spanning `span` columns. */
export interface Group {
  m: number;
  span: number;
  gap: boolean;
}

export interface DayRow {
  i: number;
  label: string;
  short: string;
  /** 0 = Monday … 6 = Sunday */
  weekday: number;
  /** Minute offset of the columns within the hour (0, or 15/45 for zones like Asia/Kathmandu). */
  phase: number;
  cols: Col[];
  groups: Group[];
  /** Open slots of this day in time order. */
  open: SlotKey[];
}

export interface Layout {
  days: DayRow[];
  /** All open slots in time order (keyboard navigation). */
  openOrder: SlotKey[];
  /** Display-zone minutes since midnight of each slot's start. */
  minOf: Record<SlotKey, number>;
}

export function isHour(c: Col, d: DayRow): boolean {
  return (c.m - d.phase) % 60 === 0;
}

export function layoutTimeline(tl: PublicBoot["timeline"], tz: string, lang: Lang): Layout {
  const step = tl.step;
  const keys = Object.keys(tl.open).sort((a, b) => tl.at[a] - tl.at[b]);
  const byDay = new Map<string, { local: ReturnType<typeof toLocal>; slots: { key: SlotKey; m: number }[] }>();
  const phases = new Map<number, number>();
  const minOf: Record<SlotKey, number> = {};
  for (const k of keys) {
    const local = toLocal(tl.at[k], tz), m = local.hour * 60 + local.minute;
    const dk = local.year + "-" + pad(local.month) + "-" + pad(local.day);
    if (!byDay.has(dk)) byDay.set(dk, { local, slots: [] });
    byDay.get(dk)!.slots.push({ key: k, m });
    minOf[k] = m;
    phases.set(m % step, (phases.get(m % step) ?? 0) + 1);
  }
  // columns start where the slots start: :00/:30 normally, :15/:45 for e.g. Nepal viewing a Tokyo poll
  // (the most common phase; the smallest one on a tie)
  let phase = 0, best = 0;
  for (const [p, n] of [...phases].sort((a, b) => a[0] - b[0])) if (n > best) { phase = p; best = n; }
  const col = (m: number) => phase + Math.floor((m - phase) / step) * step;
  const grp = (m: number) => phase + Math.floor((m - phase) / 60) * 60;
  // hours shown (same for every day): hours with a slot plus one hour either side. Hours in between that have no
  // slot are left out, so a window crossing midnight (13–17 Tokyo seen from New York = 23–03) stays compact;
  // the first hour after a gap is marked.
  const shown = new Set<number>();
  for (const k of keys) {
    const g = grp(col(minOf[k]));
    for (const x of [g - 60, g, g + 60]) if (x >= phase && x < 1440 + phase) shown.add(x);
  }
  const hours = [...shown].sort((a, b) => a - b);
  const days = [...byDay.values()].map(({ local, slots }, i): DayRow => {
    const at = new Map<number, SlotKey[]>();
    for (const s of slots) {
      const c = col(s.m);
      at.set(c, [...(at.get(c) ?? []), s.key]);
    }
    const cols: Col[] = [], groups: Group[] = [];
    hours.forEach((g, j) => {
      let n = 0;
      const gap = j > 0 && g !== hours[j - 1] + 60;
      for (let m = g; m < g + 60; m += step) {
        // two slots on one wall time (the display zone's DST fall-back): both get a column
        for (const key of at.get(m) ?? [null]) {
          cols.push({ m, key, gap: gap && !n });
          n++;
        }
      }
      groups.push({ m: g, span: n, gap });
    });
    return {
      i, label: fmtDate(lang, local), short: shortDate(lang, local), weekday: local.weekday, phase, cols, groups,
      open: cols.filter((c) => c.key).map((c) => c.key!),
    };
  });
  return { days, openOrder: days.flatMap((d) => d.open), minOf };
}

/** "13:00–13:30" for a slot in the current layout. */
export function slotText(layout: Layout, k: SlotKey, step: number): string {
  return clock(layout.minOf[k]) + "–" + clock(layout.minOf[k] + step);
}
