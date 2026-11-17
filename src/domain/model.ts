/**
 * In-memory poll aggregate and the pure functions over it: status, results/ranking, timeline slots.
 * No database or HTTP here. Mutations mark what changed in `dirty`; the repository writes exactly that.
 */
import { slotKey, toLocal, ymd } from "../lib/time";

// "draft" no longer exists (polls open on creation); the database column still allows it for old rows.
export const STATUSES = ["open", "closed", "finalized", "cancelled"] as const;
export type Status = (typeof STATUSES)[number];
export const ANSWERS = ["yes", "maybe", "no"] as const;
export type Answer = (typeof ANSWERS)[number];
export const SEVERITY: Record<Answer, number> = { yes: 0, maybe: 1, no: 2 };

export interface Poll {
  id: string;
  publicId: string;
  ownerUserId: number | null;
  ownerScope: string;
  manageNonce: string;
  title: string;
  description: string;
  basis: string;
  timezone: string;
  durationMinutes: number | null;
  responseDeadline: number | null;
  showParticipantNames: boolean;
  allowMaybe: boolean;
  status: Status;
  finalizedCandidateNo: number | null;
  hidden: boolean;
  clientRequestId: string | null;
  requestHash: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface Candidate {
  no: number;
  startAt: number;
  endAt: number;
  deleted: boolean;
}

export interface Participant {
  no: number;
  displayName: string;
  email: string | null;
  required: boolean;
  preregistered: boolean;
  comment: string;
  answers: Record<string, Answer>;
  slots: Record<string, Answer> | null;
  editNonce: string | null;
  respondedAt: number | null;
  createdAt: number;
}

export interface Dirty {
  poll: boolean;
  bumpVersion: boolean;
  candidates: Set<number>;
  participants: Set<number>;
  newCandidates: Set<number>;
  newParticipants: Set<number>;
}

export interface PollAggregate {
  poll: Poll;
  candidates: Candidate[]; // ordered by startAt, then no
  participants: Participant[]; // ordered by no
  /** version as loaded from the database (optimistic lock) */
  loadedVersion: number;
  dirty: Dirty;
  /** audit entries to write with the next commit */
  audit: { action: string; detail: Record<string, unknown> }[];
}

export function emptyDirty(): Dirty {
  return { poll: false, bumpVersion: false, candidates: new Set(), participants: new Set(), newCandidates: new Set(), newParticipants: new Set() };
}

export const cKey = (no: number) => `c${no}`;
export const pKey = (no: number) => `p${no}`;

export function parseKey(prefix: "c" | "p", key: unknown): number | null {
  if (typeof key !== "string") return null;
  const m = new RegExp(`^${prefix}([1-9][0-9]{0,5})$`).exec(key.trim());
  return m ? Number(m[1]) : null;
}

export function sortCandidates(list: Candidate[]): Candidate[] {
  return list.sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt || a.no - b.no);
}

export function activeCandidates(agg: PollAggregate): Candidate[] {
  return agg.candidates.filter((c) => !c.deleted);
}

export function findCandidate(agg: PollAggregate, key: string): Candidate | undefined {
  const no = parseKey("c", key);
  return no == null ? undefined : agg.candidates.find((c) => c.no === no && !c.deleted);
}

export function findParticipant(agg: PollAggregate, key: string): Participant | undefined {
  const no = parseKey("p", key);
  return no == null ? undefined : agg.participants.find((p) => p.no === no);
}

export function finalizedCandidate(agg: PollAggregate): Candidate | undefined {
  const no = agg.poll.finalizedCandidateNo;
  return no == null ? undefined : agg.candidates.find((c) => c.no === no);
}

/** Status considering the response deadline (open + deadline passed ⇒ closed). */
export function effectiveStatus(poll: Poll, now = Date.now()): Status {
  if (poll.status === "open" && poll.responseDeadline != null && poll.responseDeadline < now) return "closed";
  return poll.status;
}

export function responseOptions(poll: Poll): Answer[] {
  return poll.allowMaybe ? ["yes", "maybe", "no"] : ["yes", "no"];
}

/** Answers of a participant restricted to active candidates. */
export function participantAnswers(agg: PollAggregate, p: Participant): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  for (const c of activeCandidates(agg)) {
    const a = p.answers[cKey(c.no)];
    if (a) out[cKey(c.no)] = a;
  }
  return out;
}

export function roster(agg: PollAggregate): Participant[] {
  return agg.participants.filter((p) => p.preregistered || p.respondedAt != null);
}

export interface CandidateResult {
  id: string;
  start_ms: number;
  end_ms: number;
  yes: number;
  maybe: number;
  no: number;
  unanswered: number;
  /** null when nobody is marked required */
  all_required_yes: boolean | null;
}

export interface Results {
  status: Status;
  expected: number | null;
  responded: number;
  pending: number | null;
  best_candidate_ids: string[];
  finalized_candidate_id: string | null;
  candidates: CandidateResult[];
  pending_names: string[] | null;
}

/**
 * Deterministic aggregation. Ranking: all required participants yes first, then most yes, fewest no, most maybe.
 * Only candidates with at least one yes can be "best".
 */
export function results(agg: PollAggregate, now = Date.now()): Results {
  const cands = activeCandidates(agg);
  const people = roster(agg);
  const prereg = agg.participants.filter((p) => p.preregistered);
  const required = people.filter((p) => p.required);
  const rows: CandidateResult[] = cands.map((c) => {
    const k = cKey(c.no);
    const counts = { yes: 0, maybe: 0, no: 0 };
    for (const p of people) {
      const a = p.answers[k];
      if (a) counts[a]++;
    }
    return {
      id: k, start_ms: c.startAt, end_ms: c.endAt, ...counts,
      unanswered: people.length - counts.yes - counts.maybe - counts.no,
      all_required_yes: required.length ? required.every((p) => p.answers[k] === "yes") : null,
    };
  });
  const eligible = rows.filter((r) => r.yes > 0 && r.all_required_yes !== false);
  let best: string[] = [];
  if (eligible.length) {
    const top = eligible.reduce((a, b) => (compareScore(a, b) <= 0 ? a : b));
    best = eligible.filter((r) => compareScore(r, top) === 0).map((r) => r.id);
  }
  const fin = finalizedCandidate(agg);
  return {
    status: effectiveStatus(agg.poll, now),
    expected: prereg.length ? prereg.length : null,
    responded: agg.participants.filter((p) => p.respondedAt != null).length,
    pending: prereg.length ? prereg.filter((p) => p.respondedAt == null).length : null,
    best_candidate_ids: best,
    finalized_candidate_id: fin ? cKey(fin.no) : null,
    candidates: rows,
    pending_names: prereg.length ? prereg.filter((p) => p.respondedAt == null).map((p) => p.displayName) : null,
  };
}

/** Negative if a ranks better than b. */
function compareScore(a: CandidateResult, b: CandidateResult): number {
  const ra = a.all_required_yes === false ? 1 : 0, rb = b.all_required_yes === false ? 1 : 0;
  return ra - rb || b.yes - a.yes || a.no - b.no || b.maybe - a.maybe;
}

/** Candidates with yes > 0 ordered by the same score as best_candidate_ids. */
export function rankedCandidates(agg: PollAggregate, limit = 5): CandidateResult[] {
  return results(agg).candidates
    .filter((r) => r.yes > 0)
    .sort((a, b) => compareScore(a, b) || a.start_ms - b.start_ms)
    .slice(0, limit);
}

// ---------- timeline slots ----------
// Respondents paint fixed-length slots on a per-day timeline; each candidate's answer is derived from the
// slots it covers: any "no" → no, any unpainted → unanswered, any "maybe" → maybe, else yes.

export function slotMinutes(agg: PollAggregate): number {
  const mins: number[] = [];
  for (const c of activeCandidates(agg)) {
    mins.push(toLocal(c.startAt, agg.poll.timezone).minute, toLocal(c.endAt, agg.poll.timezone).minute);
  }
  for (const step of [30, 15, 5]) if (mins.every((m) => m % step === 0)) return step;
  return 1;
}

export function candidateSlots(agg: PollAggregate, c: Candidate, step = slotMinutes(agg)): string[] {
  const out: string[] = [];
  for (let t = c.startAt; t < c.endAt; t += step * 60000) out.push(slotKey(t, agg.poll.timezone));
  return out;
}

export interface TimelineDay {
  date: string;
  y: number; m: number; d: number;
  /** 0 = Monday */
  dow: number;
}

export interface Timeline {
  step: number;
  hourStart: number;
  hourEnd: number;
  days: TimelineDay[];
  open: Record<string, string[]>;
  starts: Record<string, string[]>;
}

/** Geometry for the timeline UI: days × slots, and which slots belong to which candidate. */
export function timeline(agg: PollAggregate): Timeline {
  const step = slotMinutes(agg);
  const open: Record<string, string[]> = {};
  const starts: Record<string, string[]> = {};
  for (const c of activeCandidates(agg)) {
    const keys = candidateSlots(agg, c, step);
    for (const k of keys) (open[k] ??= []).push(cKey(c.no));
    if (keys.length) (starts[keys[0]] ??= []).push(cKey(c.no));
  }
  const keys = Object.keys(open).sort();
  if (!keys.length) return { step, hourStart: 9, hourEnd: 18, days: [], open: {}, starts: {} };
  const mins = keys.map((k) => +k.slice(11, 13) * 60 + +k.slice(14, 16));
  const h0 = Math.max(0, Math.floor(Math.min(...mins) / 60) - 1);
  const h1 = Math.min(24, Math.ceil((Math.max(...mins) + step) / 60) + 1);
  const days = [...new Set(keys.map((k) => k.slice(0, 10)))].map((date) => {
    const [y, m, d] = date.split("-").map(Number);
    return { date, y, m, d, dow: (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 };
  });
  const sortedOpen: Record<string, string[]> = {};
  for (const k of keys) sortedOpen[k] = open[k];
  return { step, hourStart: h0, hourEnd: h1, days, open: sortedOpen, starts };
}

export function deriveAnswers(agg: PollAggregate, slots: Record<string, Answer>): Record<string, Answer> {
  const step = slotMinutes(agg);
  const out: Record<string, Answer> = {};
  for (const c of activeCandidates(agg)) {
    const vals = candidateSlots(agg, c, step).map((k) => slots[k]);
    if (vals.includes("no")) out[cKey(c.no)] = "no";
    else if (vals.some((v) => !v)) continue;
    else out[cKey(c.no)] = vals.reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a));
  }
  return out;
}

/** Paint each answered candidate's slots; on overlap the more severe answer wins. */
export function slotsFromAnswers(agg: PollAggregate, answers: Record<string, Answer>): Record<string, Answer> {
  const step = slotMinutes(agg);
  const slots: Record<string, Answer> = {};
  for (const c of activeCandidates(agg)) {
    const a = answers[cKey(c.no)];
    if (!a) continue;
    for (const k of candidateSlots(agg, c, step)) {
      if (!slots[k] || SEVERITY[a] > SEVERITY[slots[k]]) slots[k] = a;
    }
  }
  return slots;
}

export function participantSlots(agg: PollAggregate, p: Participant): Record<string, Answer> {
  return p.slots ?? slotsFromAnswers(agg, participantAnswers(agg, p));
}

export function localDate(ms: number, tz: string): string {
  return ymd(toLocal(ms, tz));
}
