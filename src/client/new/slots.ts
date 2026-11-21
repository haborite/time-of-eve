/**
 * New poll page, pure logic (no DOM): dates and 30-minute slots chosen by the organizer → candidates →
 * schema 1.0 JSON for /new/confirm. Times are wall-clock in the poll's time zone, so no zone math happens here.
 */
import type { PollInputT } from "../../domain/poll-schema";

/** Slot length in minutes. Slot i covers [i*SLOT, (i+1)*SLOT) of its day. */
export const SLOT = 30;
export const NSLOT = (24 * 60) / SLOT;

/** "YYYY-MM-DD" */
export type Day = string;
/** Day → chosen slot indices. */
export type Times = Map<Day, Set<number>>;
/** [day, first slot, end slot (exclusive)]; slots may be fractional for meetings shorter than SLOT. */
export type Candidate = [day: Day, from: number, to: number];
/** "slide": candidates of the meeting length every SLOT minutes; "block": each chosen stretch as one candidate. */
export type SplitMode = "slide" | "block";

const pad = (n: number): string => String(n).padStart(2, "0");

/** Slot boundary → "HH:MM" (i = NSLOT gives "24:00"). */
export function hm(i: number): string {
  const m = i * SLOT;
  return pad(Math.floor(m / 60)) + ":" + pad(m % 60);
}

export function ymdOf(d: Date): Day {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

/** Local midnight of a day (only its calendar fields are used). */
export function parseDay(s: Day): Date {
  return new Date(s + "T00:00:00");
}

/** Slot boundary → local wall-clock "YYYY-MM-DDTHH:MM"; i = NSLOT (or more) rolls into the next day. */
export function isoAt(day: Day, i: number): string {
  const d = parseDay(day);
  if (i >= NSLOT) {
    d.setDate(d.getDate() + 1);
    i -= NSLOT;
  }
  return ymdOf(d) + "T" + hm(i);
}

/** Consecutive runs of slot indices: {1,2,3,7} → [[1,4],[7,8]]. */
export function blocksOf(slots: Iterable<number>): [number, number][] {
  const out: [number, number][] = [];
  for (const i of [...slots].sort((x, y) => x - y)) {
    const last = out[out.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else out.push([i, i + 1]);
  }
  return out;
}

/**
 * Candidates from the chosen slots. `durSlots` is the meeting length in slots (0.5 for 15 minutes).
 * `fragments` counts stretches shorter than the meeting (they yield no candidate in "slide" mode).
 */
export function candidates(times: Times, durSlots: number, mode: SplitMode): { list: Candidate[]; fragments: number } {
  const list: Candidate[] = [];
  let fragments = 0;
  for (const day of [...times.keys()].sort()) {
    for (const [a, b] of blocksOf(times.get(day) ?? [])) {
      if (mode === "block") {
        list.push([day, a, b]);
        continue;
      }
      if (b - a < durSlots) {
        fragments++;
        continue;
      }
      // a candidate of the meeting length starts every SLOT minutes (every duration if shorter, e.g. 15 min)
      const step = Math.min(1, durSlots);
      for (let s = a; s + durSlots <= b; s += step) list.push([day, s, s + durSlots]);
    }
  }
  return { list, fragments };
}

/** "*Name" marks a required participant; blank lines are ignored. */
export function parsePeople(text: string): { display_name: string; required: boolean }[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) =>
    l.startsWith("*") ? { display_name: l.slice(1).trim(), required: true } : { display_name: l, required: false });
}

export interface NewPollForm {
  title: string;
  description: string;
  timezone: string;
  showNames: boolean;
  allowMaybe: boolean;
  durationMinutes: number;
  split: SplitMode;
  /** datetime-local value or "" */
  deadline: string;
  people: string;
}

/** Schema 1.0 poll JSON (validated again by the server on /new/confirm). */
export function pollJson(form: NewPollForm, list: Candidate[], now = new Date(), rand = Math.random): PollInputT {
  const data: PollInputT = {
    title: form.title.trim(),
    description: form.description.trim(),
    timezone: form.timezone,
    show_participant_names: form.showNames,
    allow_maybe: form.allowMaybe,
    candidates: list.map(([day, a, b]) => ({ start: isoAt(day, a), end: isoAt(day, b) })),
    participants: parsePeople(form.people),
  };
  if (form.split !== "block") data.duration_minutes = form.durationMinutes;
  if (form.deadline) data.response_deadline = form.deadline;
  data.client_request_id = "web-" + ymdOf(now) + "-" + rand().toString(36).slice(2, 10);
  return data;
}
