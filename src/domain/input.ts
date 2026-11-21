/**
 * Poll input: the Zod schema (./poll-schema, single source for validation, OpenAPI, JSON Schema and MCP tool schemas)
 * plus the domain checks Zod cannot express (time zones, DST, duplicates, limits). Collects all errors and warnings at once.
 *
 * AI-friendly by design:
 *  - times may be local wall-clock ("2026-12-01T13:00"); the server derives the UTC offset from `timezone` (DST-safe)
 *  - with duration_minutes, a candidate needs only `start`
 *  - candidate_ranges expands "weekdays 13:00–17:00 between two dates" into slots server-side
 */
import { z } from "zod";
import { sha256Hex } from "../lib/crypto";
import {
  addDays, fromLocal, fmtOffset, isValidTimeZone, offsetMinutes, parseDate, parseIsoDateTime, parseTime, toLocal, weekdayOf,
} from "../lib/time";
import { Issues } from "./errors";
import {
  CandidateInput, ParticipantInput, PollInput, PollInputShape, RangeInput, WEEKDAYS, type PollInputT,
} from "./poll-schema";

export { CandidateInput, ParticipantInput, PollInput, PollInputShape, RangeInput, type PollInputT };

export const LIMITS = {
  maxCandidates: 600,
  maxPreregistered: 100,
  maxParticipantsTotal: 300,
  maxRangeDays: 366,
  maxBodyBytes: 512 * 1024,
  titleMax: 200,
  descriptionMax: 2000,
  basisMax: 4000,
  nameMax: 100,
  commentMax: 500,
};

/** Slots from a range start this often (minutes); shorter meetings start every duration_minutes instead. */
export const RANGE_STEP_MINUTES = 30;
const RANGE_KEYS = Object.keys(RangeInput.shape);

export interface NormalizedPoll {
  clientRequestId: string | null;
  title: string;
  description: string;
  basis: string;
  timezone: string;
  durationMinutes: number | null;
  responseDeadline: number | null;
  showParticipantNames: boolean;
  allowMaybe: boolean;
  candidates: { startAt: number; endAt: number }[];
  participants: { displayName: string; email: string | null; required: boolean }[];
}

export interface ValidateOptions {
  now?: number;
  defaultTimezone: string;
}

const REQ_ID = /^[A-Za-z0-9._:-]{1,100}$/;
const EMAIL = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;

/** Map Zod issues to {code, field}. */
export function zodIssues(err: z.ZodError, issues: Issues, prefix = "") {
  for (const i of err.issues) {
    const field = [prefix, ...i.path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`))].join("").replace(/^\./, "").replace(/\.\[/g, "[");
    if (i.code === "invalid_type") {
      if (i.input === undefined) issues.err("required", field);
      else issues.err("invalid_type", field, { expected: String(i.expected) });
    } else if (i.code === "too_big" && i.origin === "string") issues.err("too_long", field, { max: Number(i.maximum) });
    else if (i.code === "invalid_value" && field.includes("weekdays")) issues.err("invalid_weekday", field);
    else issues.err("invalid_value", field);
  }
}

export function unknownKeys(data: Record<string, unknown>, known: readonly string[], issues: Issues, prefix = "") {
  for (const k of Object.keys(data)) if (!known.includes(k)) issues.warn("unknown_field", prefix + k);
}

/** Unknown keys inside each range (e.g. the removed `step_minutes`); run on the raw input, before zod strips them. */
export function unknownRangeKeys(ranges: unknown, field: string, issues: Issues) {
  if (!Array.isArray(ranges)) return;
  ranges.forEach((r, i) => {
    if (r && typeof r === "object" && !Array.isArray(r)) unknownKeys(r as Record<string, unknown>, RANGE_KEYS, issues, `${field}[${i}].`);
  });
}

/** Text field: trim, check length. */
function text(v: string | undefined, field: string, max: number, issues: Issues, required = false): string {
  const s = (v ?? "").trim();
  if (required && !s) issues.err("required", field);
  if (s.length > max) issues.err("too_long", field, { max });
  return s.slice(0, max);
}

export interface ResolvedTime {
  ms: number;
}

/**
 * Resolve a date-time string in `tz`. With an offset it must match the zone on that date; without one it is local
 * wall-clock time (DST gap → error, overlap → earlier instant + warning).
 */
export function resolveDateTime(value: unknown, tz: string, field: string, issues: Issues, opts: { aligned?: boolean } = {}): number | null {
  if (typeof value !== "string") {
    issues.err(value == null ? "required" : "invalid_type", field, { expected: "string" });
    return null;
  }
  const p = parseIsoDateTime(value);
  if (!p) {
    issues.err("invalid_datetime", field, { value: value.slice(0, 40) });
    return null;
  }
  let ms: number;
  if (p.offset != null) {
    ms = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s, p.ms) - p.offset * 60000;
    const expected = offsetMinutes(ms, tz);
    if (expected !== p.offset) {
      issues.err("timezone_mismatch", field, {
        offset: fmtOffset(p.offset), tz, date: `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`,
        expected: fmtOffset(expected),
      });
      return null;
    }
  } else {
    const r = fromLocal(tz, p.y, p.mo, p.d, p.h, p.mi, p.s);
    if (!r.ok) {
      issues.err("nonexistent_local_time", field, { value, tz });
      return null;
    }
    if (r.ambiguous) issues.warn("ambiguous_local_time", field, { value, tz });
    ms = r.ms + p.ms;
  }
  if (opts.aligned) {
    const l = toLocal(ms, tz);
    if (l.minute % 5 || l.second || ms % 1000) {
      issues.err("unaligned_time", field);
      return null;
    }
  }
  return ms;
}

interface Slot { startAt: number; endAt: number; field: string; explicit: boolean }

export function validateCandidates(
  list: z.infer<typeof CandidateInput>[] | undefined, tz: string, duration: number | null, issues: Issues, now: number, field = "candidates",
): Slot[] {
  const out: Slot[] = [];
  (list ?? []).forEach((c, i) => {
    const f = `${field}[${i}]`;
    const s = resolveDateTime(c.start, tz, `${f}.start`, issues, { aligned: true });
    let e: number | null;
    if (c.end == null) {
      if (!duration) {
        issues.err("missing_end", `${f}.end`);
        return;
      }
      e = s == null ? null : s + duration * 60000;
    } else e = resolveDateTime(c.end, tz, `${f}.end`, issues, { aligned: true });
    if (s == null || e == null) return;
    if (e <= s) {
      issues.err("end_before_start", f);
      return;
    }
    const minutes = (e - s) / 60000;
    if (duration && minutes !== duration && !c.allow_duration_mismatch) {
      issues.err("duration_mismatch", f, { minutes, duration });
    }
    if (s < now) issues.warn("candidate_in_past", f);
    out.push({ startAt: s, endAt: e, field: f, explicit: true });
  });
  return out;
}

export function expandRanges(
  ranges: z.infer<typeof RangeInput>[] | undefined, tz: string, duration: number | null, issues: Issues, now: number, field = "candidate_ranges",
): Slot[] {
  const out: Slot[] = [];
  if (!ranges?.length) return out;
  if (!duration) {
    issues.err("range_needs_duration", "duration_minutes");
    return out;
  }
  ranges.forEach((r, i) => {
    const f = `${field}[${i}]`;
    const dates: { y: number; mo: number; d: number }[] = [];
    let bad = false;
    const addDate = (v: string, ff: string) => {
      const d = parseDate(v);
      if (!d) {
        issues.err("invalid_date", ff);
        bad = true;
      } else dates.push(d);
    };
    if (r.date) addDate(r.date, `${f}.date`);
    (r.dates ?? []).forEach((v, j) => addDate(v, `${f}.dates[${j}]`));
    if (r.from_date || r.to_date) {
      const a = r.from_date ? parseDate(r.from_date) : null, b = r.to_date ? parseDate(r.to_date) : null;
      if (!a) issues.err(r.from_date ? "invalid_date" : "required", `${f}.from_date`);
      if (!b) issues.err(r.to_date ? "invalid_date" : "required", `${f}.to_date`);
      if (a && b) {
        let cur = a, n = 0;
        while (Date.UTC(cur.y, cur.mo - 1, cur.d) <= Date.UTC(b.y, b.mo - 1, b.d)) {
          if (++n > LIMITS.maxRangeDays) {
            issues.err("range_too_long", f, { max: LIMITS.maxRangeDays });
            bad = true;
            break;
          }
          dates.push(cur);
          cur = addDays(cur.y, cur.mo, cur.d, 1);
        }
        if (!n) issues.err("end_before_start", f);
      } else bad = true;
    }
    if (!r.date && !r.dates?.length && !r.from_date && !r.to_date) {
      issues.err("required", `${f}.date`);
      bad = true;
    }
    const st = parseTime(r.start_time), et = parseTime(r.end_time);
    if (!st) issues.err("invalid_time", `${f}.start_time`);
    if (!et) issues.err("invalid_time", `${f}.end_time`);
    const step = Math.min(RANGE_STEP_MINUTES, duration);
    if (bad || !st || !et) return;
    const a = st.h * 60 + st.mi, b = et.h * 60 + et.mi;
    if (a % 5 || b % 5) {
      issues.err("unaligned_time", f);
      return;
    }
    if (b <= a) {
      issues.err("end_before_start", f);
      return;
    }
    const wd = r.weekdays?.length ? new Set(r.weekdays.map((w) => WEEKDAYS.indexOf(w))) : null;
    const before = out.length;
    for (const d of dates) {
      if (wd && !wd.has(weekdayOf(d.y, d.mo, d.d))) continue;
      for (let m = a; m + duration <= b; m += step) {
        const s = fromLocal(tz, d.y, d.mo, d.d, Math.floor(m / 60), m % 60);
        if (!s.ok) continue; // DST gap: skip silently
        const startAt = s.ms, endAt = s.ms + duration * 60000;
        if (startAt < now) continue; // past slots of a range are dropped
        out.push({ startAt, endAt, field: f, explicit: false });
      }
    }
    if (out.length === before) issues.warn("range_empty", f);
  });
  return out;
}

/** Merge, dedupe, sort; errors for explicit duplicates. */
export function mergeSlots(slots: Slot[], issues: Issues, existing: { startAt: number; endAt: number }[] = []): Slot[] {
  const seen = new Map<string, Slot>();
  const existingSet = new Set(existing.map((c) => `${c.startAt}-${c.endAt}`));
  const out: Slot[] = [];
  for (const s of slots) {
    const k = `${s.startAt}-${s.endAt}`;
    if (existingSet.has(k)) {
      if (s.explicit) issues.err("duplicate_candidate", s.field, { other: "existing" });
      continue;
    }
    const prev = seen.get(k);
    if (prev) {
      if (s.explicit && prev.explicit) issues.err("duplicate_candidate", s.field, { other: prev.field });
      continue;
    }
    seen.set(k, s);
    out.push(s);
  }
  // overlapping candidates are normal (slots start every 30 minutes), so they are not reported
  out.sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt);
  return out;
}

export function validateParticipants(
  list: z.infer<typeof ParticipantInput>[] | undefined, issues: Issues, field = "participants", existingNames: string[] = [], max = LIMITS.maxPreregistered,
) {
  const out: NormalizedPoll["participants"] = [];
  if (!list) return out;
  if (list.length + existingNames.length > max) {
    issues.err("too_many_participants", field, { max });
    return out;
  }
  const names = new Set(existingNames.map((n) => n.toLocaleLowerCase()));
  list.forEach((p, i) => {
    const f = `${field}[${i}]`;
    const name = text(p.display_name, `${f}.display_name`, LIMITS.nameMax, issues, true);
    const email = text(p.email, `${f}.email`, 254, issues) || null;
    if (email && !EMAIL.test(email)) issues.err("invalid_email", `${f}.email`);
    if (!name) return;
    if (names.has(name.toLocaleLowerCase())) issues.err("duplicate_participant", `${f}.display_name`, { name });
    names.add(name.toLocaleLowerCase());
    out.push({ displayName: name, email, required: p.required ?? false });
  });
  return out;
}

export function validateDuration(v: unknown, issues: Issues, field = "duration_minutes"): number | null {
  if (v == null) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 5 || v > 1440 || v % 5) {
    issues.err("invalid_duration", field);
    return null;
  }
  return v;
}

export const KNOWN_KEYS = [...Object.keys(PollInputShape), "dry_run"] as const;

/** Validate a creation payload. Returns normalized data (null if any error) and all issues. */
export function validatePollInput(data: unknown, opts: ValidateOptions): { norm: NormalizedPoll | null; issues: Issues } {
  const issues = new Issues();
  const now = opts.now ?? Date.now();
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    issues.err("invalid_type", "", { expected: "object" });
    return { norm: null, issues };
  }
  unknownKeys(data as Record<string, unknown>, KNOWN_KEYS, issues);
  unknownRangeKeys((data as Record<string, unknown>).candidate_ranges, "candidate_ranges", issues);
  const parsed = PollInput.safeParse(data);
  if (!parsed.success) {
    zodIssues(parsed.error, issues);
    return { norm: null, issues };
  }
  const d = parsed.data;
  const title = text(d.title, "title", LIMITS.titleMax, issues, true);
  const description = text(d.description, "description", LIMITS.descriptionMax, issues);
  const basis = text(d.basis, "basis", LIMITS.basisMax, issues);
  const tz = d.timezone ?? opts.defaultTimezone;
  if (!isValidTimeZone(tz)) {
    issues.err("invalid_timezone", "timezone");
    return { norm: null, issues };
  }
  let crid: string | null = null;
  if (d.client_request_id != null) {
    if (!REQ_ID.test(d.client_request_id)) issues.err("invalid_client_request_id", "client_request_id");
    else crid = d.client_request_id;
  }
  const duration = validateDuration(d.duration_minutes, issues);
  let deadline: number | null = null;
  if (d.response_deadline != null) {
    deadline = resolveDateTime(d.response_deadline, tz, "response_deadline", issues);
    if (deadline != null && deadline < now) issues.warn("deadline_in_past", "response_deadline");
  }
  const slots = mergeSlots([
    ...validateCandidates(d.candidates, tz, duration, issues, now),
    ...expandRanges(d.candidate_ranges, tz, duration, issues, now),
  ], issues);
  if (!slots.length && issues.ok) issues.err("no_candidates", "candidates");
  if (slots.length > LIMITS.maxCandidates) issues.err("too_many_candidates", "candidates", { max: LIMITS.maxCandidates, n: slots.length });
  if (deadline != null && slots.length && deadline > slots[0].startAt) issues.warn("deadline_after_candidate", "response_deadline");
  const participants = validateParticipants(d.participants, issues);
  if (!issues.ok) return { norm: null, issues };
  return {
    norm: {
      clientRequestId: crid, title, description, basis, timezone: tz, durationMinutes: duration, responseDeadline: deadline,
      showParticipantNames: d.show_participant_names ?? true, allowMaybe: d.allow_maybe ?? true,
      candidates: slots.map((s) => ({ startAt: s.startAt, endAt: s.endAt })), participants,
    },
    issues,
  };
}

/** Stable hash of a creation request (idempotency: same client_request_id must come with the same body). */
export async function requestHash(data: unknown): Promise<string> {
  return sha256Hex(stableStringify(data));
}

export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).filter((k) => k !== "dry_run").sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

