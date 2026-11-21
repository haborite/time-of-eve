/**
 * Time-zone arithmetic on top of Intl (Workers ship full ICU). Replaces Python's zoneinfo.
 * Shared by the Worker and the browser (src/client), like everything in src/shared.
 * All instants are epoch milliseconds (UTC). "Local" values are wall-clock fields in an IANA zone.
 */

export interface Local {
  year: number; month: number; day: number; hour: number; minute: number; second: number;
  /** 0 = Monday … 6 = Sunday (same convention as Python's weekday()). */
  weekday: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
const WD: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric", weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(tz)) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock fields of an instant in a zone. */
export function toLocal(ms: number, tz: string): Local {
  const parts = formatter(tz).formatToParts(new Date(ms));
  const o: Record<string, string> = {};
  for (const p of parts) o[p.type] = p.value;
  return {
    year: +o.year, month: +o.month, day: +o.day, hour: +o.hour % 24, minute: +o.minute, second: +o.second,
    weekday: WD[o.weekday] ?? 0,
  };
}

/** UTC offset of the zone at an instant, in minutes (e.g. +540 for Asia/Tokyo). */
export function offsetMinutes(ms: number, tz: string): number {
  const l = toLocal(ms, tz);
  const asUtc = Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute, l.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

export type LocalResolution =
  | { ok: true; ms: number; ambiguous: boolean }
  | { ok: false; reason: "nonexistent" };

/**
 * Wall-clock time in a zone → instant. DST gap (time does not exist) → nonexistent;
 * DST overlap (time occurs twice) → the earlier instant, flagged ambiguous.
 */
export function fromLocal(tz: string, y: number, mo: number, d: number, h: number, mi: number, s = 0): LocalResolution {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const found = new Set<number>();
  for (const probe of [guess - 36 * 3600e3, guess, guess + 36 * 3600e3]) {
    const off = offsetMinutes(probe, tz);
    const cand = guess - off * 60000;
    const l = toLocal(cand, tz);
    if (l.year === y && l.month === mo && l.day === d && l.hour === h && l.minute === mi && l.second === s) found.add(cand);
  }
  if (!found.size) return { ok: false, reason: "nonexistent" };
  const sorted = [...found].sort((a, b) => a - b);
  return { ok: true, ms: sorted[0], ambiguous: sorted.length > 1 };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function fmtOffset(min: number): string {
  const sign = min < 0 ? "-" : "+";
  const a = Math.abs(min);
  return `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** ISO 8601 with the zone's offset, e.g. 2026-12-01T13:00:00+09:00 (same shape as Python isoformat()). */
export function isoLocal(ms: number, tz: string): string {
  const l = toLocal(ms, tz);
  return `${l.year}-${pad(l.month)}-${pad(l.day)}T${pad(l.hour)}:${pad(l.minute)}:${pad(l.second)}${fmtOffset(offsetMinutes(ms, tz))}`;
}

/** "YYYY-MM-DDTHH:MM" in the zone: timeline slot keys. */
export function slotKey(ms: number, tz: string): string {
  const l = toLocal(ms, tz);
  return `${l.year}-${pad(l.month)}-${pad(l.day)}T${pad(l.hour)}:${pad(l.minute)}`;
}

export function ymd(l: Pick<Local, "year" | "month" | "day">): string {
  return `${l.year}-${pad(l.month)}-${pad(l.day)}`;
}

export function hhmm(l: Pick<Local, "hour" | "minute">): string {
  return `${pad(l.hour)}:${pad(l.minute)}`;
}

/** Weekday (0 = Monday) of a calendar date. */
export function weekdayOf(y: number, m: number, d: number): number {
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export interface ParsedDateTime {
  y: number; mo: number; d: number; h: number; mi: number; s: number; ms: number;
  /** Offset in minutes if the string had one (Z = 0). */
  offset: number | null;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?$/i;

/** Parse "2026-12-01T13:00", "2026-12-01T13:00:00+09:00", "…Z". Returns null if malformed or out of range. */
export function parseIsoDateTime(v: string): ParsedDateTime | null {
  const m = ISO_RE.exec(v.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
  const s = m[6] ? +m[6] : 0;
  const frac = m[7] ? +m[7].slice(0, 3).padEnd(3, "0") : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || s > 59) return null;
  let offset: number | null = null;
  if (m[8]) {
    if (m[8].toUpperCase() === "Z") offset = 0;
    else {
      const sign = m[8][0] === "-" ? -1 : 1;
      const digits = m[8].slice(1).replace(":", "");
      const oh = +digits.slice(0, 2), om = +digits.slice(2, 4);
      if (oh > 23 || om > 59) return null;
      offset = sign * (oh * 60 + om);
    }
  }
  return { y, mo, d, h, mi, s, ms: frac, offset };
}

export function parseDate(v: string): { y: number; mo: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, mo, d };
}

export function parseTime(v: string): { h: number; mi: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 24 || mi > 59 || (h === 24 && mi !== 0)) return null;
  return { h, mi };
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Calendar date arithmetic (no zone involved). */
export function addDays(y: number, m: number, d: number, n: number): { y: number; mo: number; d: number } {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
