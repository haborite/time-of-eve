/**
 * Business rules: create, state transitions, edits, responses. Pure functions that change an in-memory aggregate
 * (marking `dirty` and appending audit entries); the repository persists the result atomically.
 * Shared by the web UI, the REST API and the MCP server.
 */
import { randomToken, ulid } from "../lib/crypto";
import { isValidTimeZone } from "../lib/time";
import { AppError, Issues } from "./errors";
import {
  CandidateInput, LIMITS, ParticipantInput, RangeInput, expandRanges, mergeSlots, resolveDateTime, validateCandidates,
  validateParticipants, zodIssues, unknownKeys, type NormalizedPoll,
} from "./input";
import {
  ANSWERS, activeCandidates, cKey, deriveAnswers, effectiveStatus, emptyDirty, findCandidate, findParticipant, pKey,
  participantAnswers, responseOptions, slotsFromAnswers, sortCandidates, timeline, type Answer, type Participant, type PollAggregate,
} from "./model";
import { z } from "zod";

export interface Owner {
  userId: number | null;
}

export function newPublicId(): string {
  return randomToken(18); // 144 bits, URL-safe
}

/** Build a new aggregate (draft) from validated input. */
export function newPoll(norm: NormalizedPoll, owner: Owner, requestHash: string | null, now = Date.now()): PollAggregate {
  const agg: PollAggregate = {
    poll: {
      id: ulid(now), publicId: newPublicId(), ownerUserId: owner.userId,
      ownerScope: owner.userId != null ? `u:${owner.userId}` : "anon", manageNonce: randomToken(16),
      title: norm.title, description: norm.description, basis: norm.basis, timezone: norm.timezone,
      durationMinutes: norm.durationMinutes, responseDeadline: norm.responseDeadline,
      showParticipantNames: norm.showParticipantNames, allowMaybe: norm.allowMaybe, status: "draft",
      finalizedCandidateNo: null, hidden: false, clientRequestId: norm.clientRequestId, requestHash,
      version: 1, createdAt: now, updatedAt: now,
    },
    candidates: [], participants: [], loadedVersion: 0, dirty: emptyDirty(), audit: [],
  };
  agg.dirty.poll = true;
  norm.candidates.forEach((c) => addCandidate(agg, c.startAt, c.endAt));
  norm.participants.forEach((p) => addParticipant(agg, p.displayName, { email: p.email, required: p.required, preregistered: true }, now));
  agg.audit.push({ action: "create", detail: { candidates: norm.candidates.length, participants: norm.participants.length } });
  return agg;
}

function nextNo(list: { no: number }[]): number {
  return list.reduce((m, x) => Math.max(m, x.no), 0) + 1;
}

export function addCandidate(agg: PollAggregate, startAt: number, endAt: number) {
  const c = { no: nextNo(agg.candidates), startAt, endAt, deleted: false };
  agg.candidates.push(c);
  sortCandidates(agg.candidates);
  agg.dirty.newCandidates.add(c.no);
  return c;
}

export function addParticipant(
  agg: PollAggregate, name: string, o: { email?: string | null; required?: boolean; preregistered?: boolean } = {}, now = Date.now(),
): Participant {
  const p: Participant = {
    no: nextNo(agg.participants), displayName: name, email: o.email ?? null, required: o.required ?? false,
    preregistered: o.preregistered ?? false, comment: "", answers: {}, slots: null, editNonce: null, respondedAt: null, createdAt: now,
  };
  agg.participants.push(p);
  agg.dirty.newParticipants.add(p.no);
  return p;
}

function touch(agg: PollAggregate, expectedVersion?: number | null) {
  if (expectedVersion != null && expectedVersion !== agg.poll.version) throw new AppError("version_conflict", 409, "version");
  agg.dirty.poll = true;
  agg.dirty.bumpVersion = true;
}

function invalidState(agg: PollAggregate) {
  return new AppError("invalid_state", 409, "", { status: effectiveStatus(agg.poll) });
}

// ---------- state transitions ----------

export function publish(agg: PollAggregate) {
  if (agg.poll.status !== "draft") throw invalidState(agg);
  if (!activeCandidates(agg).length) throw new AppError("no_candidates", 409);
  touch(agg);
  agg.poll.status = "open";
  agg.audit.push({ action: "publish", detail: {} });
}

export function close(agg: PollAggregate) {
  if (effectiveStatus(agg.poll) !== "open") throw invalidState(agg);
  touch(agg);
  agg.poll.status = "closed";
  agg.audit.push({ action: "close", detail: {} });
}

/** Reopen a closed poll (or an open poll whose deadline passed). A past deadline is cleared unless a new one is given. */
export function reopen(agg: PollAggregate, newDeadline: number | null, now = Date.now()) {
  if (effectiveStatus(agg.poll, now) !== "closed") throw invalidState(agg);
  if (newDeadline != null && newDeadline <= now) throw new AppError("deadline_in_past", 400, "response_deadline");
  touch(agg);
  if (newDeadline != null) agg.poll.responseDeadline = newDeadline;
  else if (agg.poll.responseDeadline != null && agg.poll.responseDeadline < now) agg.poll.responseDeadline = null;
  agg.poll.status = "open";
  agg.audit.push({ action: "reopen", detail: { deadline: newDeadline } });
}

export function finalize(agg: PollAggregate, candidateId: string, expectedVersion?: number | null) {
  if (!["open", "closed"].includes(agg.poll.status)) throw invalidState(agg);
  const c = findCandidate(agg, candidateId);
  if (!c) throw new AppError("candidate_not_found", 404, "candidate_id", { id: String(candidateId).slice(0, 20) });
  touch(agg, expectedVersion);
  agg.poll.status = "finalized";
  agg.poll.finalizedCandidateNo = c.no;
  agg.audit.push({ action: "finalize", detail: { candidate: cKey(c.no) } });
  return c;
}

export function unfinalize(agg: PollAggregate) {
  if (agg.poll.status !== "finalized") throw invalidState(agg);
  touch(agg);
  agg.poll.status = "closed";
  agg.poll.finalizedCandidateNo = null;
  agg.audit.push({ action: "unfinalize", detail: {} });
}

export function cancel(agg: PollAggregate) {
  if (agg.poll.status === "cancelled") throw invalidState(agg);
  touch(agg);
  agg.poll.status = "cancelled";
  agg.audit.push({ action: "cancel", detail: {} });
}

/** New management link (the old one stops working). */
export function rotateManageLink(agg: PollAggregate) {
  touch(agg);
  agg.poll.manageNonce = randomToken(16);
  agg.audit.push({ action: "rotate_manage_link", detail: {} });
}

export function setHidden(agg: PollAggregate, hidden: boolean) {
  agg.dirty.poll = true;
  agg.poll.hidden = hidden;
  agg.audit.push({ action: hidden ? "hide" : "unhide", detail: {} });
}

// ---------- edit ----------

export const PatchInputShape = {
  title: z.string().optional(),
  description: z.string().optional(),
  basis: z.string().optional(),
  response_deadline: z.string().nullable().optional().describe("New deadline (local or with offset), null removes it"),
  show_participant_names: z.boolean().optional(),
  duration_minutes: z.number().int().nullable().optional().describe("Default length for added candidates"),
  add_candidates: z.array(CandidateInput).optional(),
  add_candidate_ranges: z.array(RangeInput).optional(),
  remove_candidate_ids: z.array(z.string()).optional().describe("e.g. [\"c3\"]; existing answers are kept but ignored"),
  add_participants: z.array(ParticipantInput).optional(),
  set_required: z.record(z.string(), z.boolean()).optional().describe("{\"p1\": true}"),
  version: z.number().int().optional().describe("version from your last read; fails with version_conflict if the poll changed since"),
};
export const PatchInput = z.object(PatchInputShape);

/** Edit settings, add/remove candidates, add invitees, set required. Returns warnings. */
export function patch(agg: PollAggregate, data: unknown, now = Date.now()): Issues {
  if (agg.poll.status === "cancelled") throw invalidState(agg);
  const issues = new Issues();
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new AppError("invalid_type", 400, "", { expected: "object" });
  unknownKeys(data as Record<string, unknown>, Object.keys(PatchInputShape), issues);
  const parsed = PatchInput.safeParse(data);
  if (!parsed.success) {
    zodIssues(parsed.error, issues);
    throw AppError.validation(issues);
  }
  const d = parsed.data;
  const tz = agg.poll.timezone;
  const changes: Record<string, unknown> = {};
  for (const [key, max, required] of [["title", LIMITS.titleMax, true], ["description", LIMITS.descriptionMax, false], ["basis", LIMITS.basisMax, false]] as const) {
    const v = d[key];
    if (v === undefined) continue;
    const s = v.trim();
    if (required && !s) issues.err("required", key);
    else if (s.length > max) issues.err("too_long", key, { max });
    else changes[key] = s;
  }
  if (d.show_participant_names !== undefined) changes.showParticipantNames = d.show_participant_names;
  if (d.duration_minutes !== undefined) {
    if (d.duration_minutes === null) changes.durationMinutes = null;
    else if (d.duration_minutes < 5 || d.duration_minutes > 1440 || d.duration_minutes % 5) issues.err("invalid_duration", "duration_minutes");
    else changes.durationMinutes = d.duration_minutes;
  }
  if (d.response_deadline !== undefined) {
    if (d.response_deadline === null) changes.responseDeadline = null;
    else {
      const ms = resolveDateTime(d.response_deadline, tz, "response_deadline", issues);
      if (ms != null) changes.responseDeadline = ms;
    }
  }
  const duration = (changes.durationMinutes as number | null | undefined) ?? agg.poll.durationMinutes;
  const active = activeCandidates(agg);
  let newSlots: { startAt: number; endAt: number }[] = [];
  if (d.add_candidates?.length || d.add_candidate_ranges?.length) {
    newSlots = mergeSlots([
      ...validateCandidates(d.add_candidates, tz, duration, issues, now, "add_candidates"),
      ...expandRanges(d.add_candidate_ranges, tz, duration, issues, now, "add_candidate_ranges"),
    ], issues, active);
    if (active.length + newSlots.length > LIMITS.maxCandidates) {
      issues.err("too_many_candidates", "add_candidates", { max: LIMITS.maxCandidates, n: active.length + newSlots.length });
    }
  }
  const remove = d.remove_candidate_ids ?? [];
  const removeCands = remove.map((k, i) => {
    const c = findCandidate(agg, k);
    if (!c) issues.err("candidate_not_found", `remove_candidate_ids[${i}]`, { id: String(k).slice(0, 20) });
    else if (c.no === agg.poll.finalizedCandidateNo) issues.err("candidate_finalized", `remove_candidate_ids[${i}]`);
    return c;
  });
  const newParts = validateParticipants(
    d.add_participants, issues, "add_participants", agg.participants.filter((p) => p.preregistered).map((p) => p.displayName),
  );
  const setReq = Object.entries(d.set_required ?? {}).map(([k, v]) => {
    const p = findParticipant(agg, k);
    if (!p) issues.err("participant_not_found", `set_required.${k}`, { id: k.slice(0, 20) });
    return [p, v] as const;
  });
  const anything = Object.keys(changes).length || newSlots.length || removeCands.length || newParts.length || setReq.length;
  if (issues.ok && !anything) issues.err("nothing_to_change", "");
  if (!issues.ok) throw AppError.validation(issues);

  touch(agg, d.version);
  const p = agg.poll;
  if ("title" in changes) p.title = changes.title as string;
  if ("description" in changes) p.description = changes.description as string;
  if ("basis" in changes) p.basis = changes.basis as string;
  if ("showParticipantNames" in changes) p.showParticipantNames = changes.showParticipantNames as boolean;
  if ("durationMinutes" in changes) p.durationMinutes = changes.durationMinutes as number | null;
  if ("responseDeadline" in changes) p.responseDeadline = changes.responseDeadline as number | null;
  const added = newSlots.map((s) => cKey(addCandidate(agg, s.startAt, s.endAt).no));
  for (const c of removeCands) {
    if (c && !c.deleted) {
      c.deleted = true;
      agg.dirty.candidates.add(c.no);
    }
  }
  for (const np of newParts) addParticipant(agg, np.displayName, { email: np.email, required: np.required, preregistered: true }, now);
  for (const [pp, v] of setReq) {
    if (pp && pp.required !== v) {
      pp.required = v;
      agg.dirty.participants.add(pp.no);
    }
  }
  if (removeCands.length || newSlots.length) invalidateSlots(agg);
  agg.audit.push({
    action: "update",
    detail: {
      fields: Object.keys(changes), added_candidates: added, removed_candidates: remove,
      added_participants: newParts.map((x) => x.displayName), set_required: d.set_required ?? {},
    },
  });
  return issues;
}

/** Candidate geometry changed: stored timeline marks may no longer match; answers stay authoritative. */
function invalidateSlots(agg: PollAggregate) {
  for (const p of agg.participants) {
    if (p.slots) {
      p.slots = null;
      agg.dirty.participants.add(p.no);
    }
  }
}

// ---------- responses ----------

export const ResponseInputShape = {
  participant_id: z.string().optional().describe("Invited participant's id (\"p2\") from preregistered_pending; instead of display_name"),
  display_name: z.string().optional().describe("The participant's own name"),
  answers: z.record(z.string(), z.enum(ANSWERS).nullable()).optional()
    .describe("Candidate id → \"yes\" | \"maybe\" | \"no\" (null or omitted = unanswered), e.g. {\"c1\":\"yes\",\"c2\":\"no\"}"),
  slots: z.record(z.string(), z.enum(ANSWERS).nullable()).optional().describe("Timeline marks used by the web UI (alternative to answers)"),
  comment: z.string().optional(),
};
export const ResponseInput = z.object(ResponseInputShape);

function parseResponse(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new AppError("invalid_type", 400, "", { expected: "object" });
  const parsed = ResponseInput.safeParse(data);
  if (!parsed.success) {
    const issues = new Issues();
    zodIssues(parsed.error, issues);
    throw AppError.validation(issues);
  }
  return parsed.data;
}

function ensureAccepting(agg: PollAggregate, now = Date.now()) {
  const st = effectiveStatus(agg.poll, now);
  if (st !== "open") throw new AppError("not_accepting", 409, "", { status: st });
}

function checkAnswers(agg: PollAggregate, answers: Record<string, Answer | null>): Record<string, Answer> {
  const allowed = responseOptions(agg.poll);
  const out: Record<string, Answer> = {};
  for (const [k, v] of Object.entries(answers)) {
    const c = findCandidate(agg, k);
    if (!c) throw new AppError("candidate_not_found", 400, `answers.${k.slice(0, 20)}`, { id: k.slice(0, 20) });
    if (v == null) continue;
    if (!allowed.includes(v)) throw new AppError("invalid_answer", 400, `answers.${k}`, { allowed: allowed.join("/") });
    out[cKey(c.no)] = v;
  }
  return out;
}

function checkSlots(agg: PollAggregate, slots: Record<string, Answer | null>): Record<string, Answer> {
  const open = timeline(agg).open;
  const allowed = responseOptions(agg.poll);
  const out: Record<string, Answer> = {};
  for (const [k, v] of Object.entries(slots)) {
    if (!open[k]) throw new AppError("slot_not_found", 400, "slots", { slot: k.slice(0, 20) });
    if (v == null) continue;
    if (!allowed.includes(v)) throw new AppError("invalid_answer", 400, `slots.${k}`, { allowed: allowed.join("/") });
    out[k] = v;
  }
  return out;
}

function resolveInput(agg: PollAggregate, d: z.infer<typeof ResponseInput>, base?: Record<string, Answer>) {
  if (d.slots) {
    const slots = checkSlots(agg, d.slots);
    return { answers: deriveAnswers(agg, slots), slots };
  }
  let answers = checkAnswers(agg, d.answers ?? {});
  if (base) {
    // merge: given keys replace, null clears
    const merged: Record<string, Answer> = { ...base };
    for (const [k, v] of Object.entries(d.answers ?? {})) {
      const c = findCandidate(agg, k)!;
      if (v == null) delete merged[cKey(c.no)];
    }
    answers = Object.assign(merged, answers);
  }
  return { answers, slots: slotsFromAnswers(agg, answers) };
}

function checkComment(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (v.length > LIMITS.commentMax) throw new AppError("too_long", 400, "comment", { max: LIMITS.commentMax });
  return v.trim();
}

function applyAnswers(agg: PollAggregate, p: Participant, answers: Record<string, Answer>, slots: Record<string, Answer>, now: number) {
  // keep answers of removed candidates out: only active ones are stored
  const active = new Set(activeCandidates(agg).map((c) => cKey(c.no)));
  p.answers = Object.fromEntries(Object.entries(answers).filter(([k]) => active.has(k)));
  p.slots = slots;
  p.respondedAt = now;
  agg.dirty.participants.add(p.no);
}

/** New response. Returns the participant (edit nonce set; derive the edit token from it). */
export function submitResponse(agg: PollAggregate, data: unknown, now = Date.now()): Participant {
  ensureAccepting(agg, now);
  const d = parseResponse(data);
  const { answers, slots } = resolveInput(agg, d);
  const comment = checkComment(d.comment) ?? "";
  let p: Participant | undefined;
  if (d.participant_id) {
    p = findParticipant(agg, d.participant_id);
    if (!p || !p.preregistered) throw new AppError("participant_not_found", 400, "participant_id", { id: d.participant_id.slice(0, 20) });
    if (p.respondedAt != null) throw new AppError("already_responded", 409, "participant_id");
  } else {
    const name = (d.display_name ?? "").trim();
    if (!name || name.length > LIMITS.nameMax) throw new AppError("display_name_required", 400, "display_name");
    const twin = agg.participants.find((x) => x.preregistered && x.respondedAt == null && x.displayName.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (twin) throw new AppError("use_participant_id", 409, "display_name", { name: twin.displayName, id: pKey(twin.no) });
    if (agg.participants.length >= LIMITS.maxParticipantsTotal) throw new AppError("too_many_participants", 409, "", { max: LIMITS.maxParticipantsTotal });
    p = addParticipant(agg, name, {}, now);
  }
  p.comment = comment;
  p.editNonce = randomToken(16);
  applyAnswers(agg, p, answers, slots, now);
  agg.audit.push({ action: "respond", detail: { participant: pKey(p.no), answers: Object.keys(answers).length } });
  return p;
}

/**
 * Change a response. `answers` merges into the saved answers (null clears one) unless replaceAll;
 * `slots` replaces everything. Without either, only comment / display_name change.
 */
export function updateResponse(agg: PollAggregate, p: Participant, data: unknown, opts: { replaceAll?: boolean } = {}, now = Date.now()) {
  ensureAccepting(agg, now);
  const d = parseResponse(data);
  const hasAnswers = d.answers !== undefined || d.slots !== undefined;
  if (!hasAnswers && d.comment === undefined && d.display_name === undefined) throw new AppError("nothing_to_change", 400, "answers");
  const comment = checkComment(d.comment);
  if (comment !== undefined) p.comment = comment;
  if (d.display_name !== undefined && !p.preregistered) {
    const name = d.display_name.trim();
    if (!name || name.length > LIMITS.nameMax) throw new AppError("display_name_required", 400, "display_name");
    p.displayName = name;
  }
  if (hasAnswers) {
    const { answers, slots } = resolveInput(agg, d, opts.replaceAll || d.slots ? undefined : participantAnswers(agg, p));
    applyAnswers(agg, p, answers, slots, now);
  } else {
    p.respondedAt = now;
    agg.dirty.participants.add(p.no);
  }
  agg.audit.push({ action: "update_response", detail: { participant: pKey(p.no) } });
}

export function reissueEditLink(agg: PollAggregate, participantId: string): Participant {
  const p = findParticipant(agg, participantId);
  if (!p || p.respondedAt == null) throw new AppError("participant_not_found", 404, "participant_id", { id: String(participantId).slice(0, 20) });
  p.editNonce = randomToken(16);
  agg.dirty.participants.add(p.no);
  agg.audit.push({ action: "reissue_edit_link", detail: { participant: pKey(p.no) } });
  return p;
}

export function parseDeadlineArg(agg: PollAggregate, v: unknown, field = "response_deadline"): number | null {
  if (v == null || v === "") return null;
  const issues = new Issues();
  const ms = resolveDateTime(v, agg.poll.timezone, field, issues);
  if (ms == null) throw AppError.validation(issues);
  return ms;
}

export { isValidTimeZone };
