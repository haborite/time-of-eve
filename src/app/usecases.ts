/**
 * Use cases shared by the web UI, REST API and MCP server: authorization + domain + persistence.
 *
 * Who may manage a poll (organizer capability):
 *  - an administrator (session, API token or OAuth) — any poll
 *  - anyone holding the poll's manage token (from the manage URL) — that poll only
 * Who may create: administrators always; everyone else only when settings.creation_mode = "anyone".
 */
import { AppError } from "../domain/errors";
import { requestHash, validatePollInput } from "../domain/input";
import type { Links } from "../domain/links";
import { cKey, findParticipant, pKey, participantAnswers, type PollAggregate } from "../domain/model";
import * as svc from "../domain/service";
import { pollBrief } from "../domain/views";
import { isoLocal } from "../lib/time";
import type { PollStore } from "../repo/polls";
import { withPoll } from "../repo/polls";
import type { Settings } from "../repo/settings";
import type { AuthUser } from "../repo/users";

export type Actor =
  | { kind: "admin"; user: AuthUser; via: "web" | "api" | "mcp" }
  | { kind: "anonymous"; via: "web" | "api" | "mcp" };

export function actorLabel(a: Actor): string {
  return a.kind === "admin" ? `${a.via}:${a.user.username}` : `${a.via}:anonymous`;
}

export interface Ctx {
  store: PollStore;
  links: Links;
  settings: Settings;
  actor: Actor;
}

export function canCreate(ctx: Pick<Ctx, "actor" | "settings">): boolean {
  return ctx.actor.kind === "admin" || ctx.settings.creation_mode === "anyone";
}

export function isAdmin(ctx: Pick<Ctx, "actor">): boolean {
  return ctx.actor.kind === "admin";
}

// ---------- create ----------

export function preview(ctx: Ctx, data: unknown, now = Date.now()) {
  const { norm, issues } = validatePollInput(data, { now, defaultTimezone: ctx.settings.default_timezone });
  const out: Record<string, unknown> = { valid: !!norm, errors: issues.errors, warnings: issues.warnings };
  if (norm) {
    const tz = norm.timezone;
    out.preview = {
      title: norm.title, timezone: tz, duration_minutes: norm.durationMinutes,
      response_deadline: norm.responseDeadline != null ? isoLocal(norm.responseDeadline, tz) : null,
      allow_maybe: norm.allowMaybe, show_participant_names: norm.showParticipantNames,
      candidate_count: norm.candidates.length,
      candidates: norm.candidates.map((c) => ({ start: isoLocal(c.startAt, tz), end: isoLocal(c.endAt, tz) })),
      participants: norm.participants.map((p) => ({ display_name: p.displayName, required: p.required })),
    };
  }
  return { result: out, norm, issues };
}

export interface CreateResult {
  agg: PollAggregate;
  created: boolean;
  warnings: ReturnType<typeof preview>["issues"]["warnings"];
}

/** Create a draft (optionally publish). Idempotent on client_request_id within the creator's scope. */
export async function createPoll(ctx: Ctx, data: unknown, opts: { publish?: boolean } = {}): Promise<CreateResult> {
  if (!canCreate(ctx)) throw new AppError("creation_disabled", 403);
  const { norm, issues } = preview(ctx, data);
  if (!norm) throw AppError.validation(issues);
  const owner = { userId: ctx.actor.kind === "admin" ? ctx.actor.user.id : null };
  const scope = owner.userId != null ? `u:${owner.userId}` : "anon";
  const hash = await requestHash(data);
  if (norm.clientRequestId) {
    const existing = await ctx.store.byIdempotencyKey(scope, norm.clientRequestId);
    if (existing) {
      if (existing.poll.requestHash !== hash) throw new AppError("idempotency_conflict", 409, "client_request_id");
      if (opts.publish && existing.poll.status === "draft") {
        svc.publish(existing);
        await ctx.store.commit(existing, { actor: actorLabel(ctx.actor) });
      }
      return { agg: existing, created: false, warnings: issues.warnings };
    }
  }
  const agg = ctx.store.adopt(svc.newPoll(norm, owner, hash));
  if (opts.publish) {
    agg.poll.status = "open";
    agg.audit.push({ action: "publish", detail: {} });
  }
  try {
    await ctx.store.commit(agg, { actor: actorLabel(ctx.actor) });
  } catch (e) {
    // a concurrent identical request won the unique index: replay it
    if (norm.clientRequestId && /UNIQUE constraint failed: polls\./.test(String((e as Error).message) + String((e as { cause?: Error }).cause?.message))) {
      return createPoll(ctx, data, opts);
    }
    throw e;
  }
  return { agg, created: true, warnings: issues.warnings };
}

export async function createdResponse(ctx: Ctx, r: CreateResult) {
  return {
    ...(await pollBrief(r.agg, ctx.links)),
    warnings: r.warnings,
    idempotent_replay: !r.created,
  };
}

// ---------- organizer access ----------

export interface PollRef {
  pollId: string;
  manageToken?: string | null;
}

/** Load a poll the caller may manage, or throw 404/403. */
export async function openForOrganizer(ctx: Ctx, ref: PollRef): Promise<PollAggregate> {
  if (!/^[0-9A-Z]{26}$/.test(ref.pollId)) throw new AppError("poll_not_found", 404, "poll_id");
  const agg = await ctx.store.byId(ref.pollId);
  if (!agg) throw new AppError("poll_not_found", 404, "poll_id");
  if (isAdmin(ctx)) return agg;
  if (ref.manageToken && (await ctx.links.checkManageToken(agg.poll, ref.manageToken))) return agg;
  throw new AppError(ref.manageToken ? "invalid_manage_token" : "unauthorized", ref.manageToken ? 403 : 401, "manage_url");
}

/** Organizer mutation with optimistic locking and retry. */
export async function organizerChange<T>(ctx: Ctx, ref: PollRef, fn: (agg: PollAggregate) => T) {
  return withPoll(() => openForOrganizer(ctx, ref), fn, () => ({ actor: actorLabel(ctx.actor) }));
}

// ---------- participants ----------

export async function submitResponse(ctx: Ctx, publicId: string, data: unknown) {
  let invited: number | undefined;
  const { agg, value: p } = await withPoll(
    () => ctx.store.publicPoll(publicId),
    (agg) => {
      const p = svc.submitResponse(agg, data);
      invited = p.preregistered ? p.no : undefined;
      return p;
    },
    () => ({ actor: actorLabel(ctx.actor).replace(/anonymous$/, "participant"), assertNotResponded: invited }),
  );
  return {
    response_id: pKey(p.no), display_name: p.displayName,
    edit_token: await ctx.links.editToken(agg.poll, p), edit_url: await ctx.links.editUrl(agg.poll, p), agg, participant: p,
  };
}

export async function openOwnResponse(ctx: Ctx, publicId: string, responseId: string, token: string | null | undefined) {
  const agg = await ctx.store.publicPoll(publicId);
  const p = findParticipant(agg, responseId);
  if (!p || !(await ctx.links.checkEditToken(agg.poll, p, token))) throw new AppError("invalid_edit_token", 403, "edit_token");
  return { agg, p };
}

export async function updateResponse(ctx: Ctx, publicId: string, responseId: string, token: string | null | undefined, data: unknown, opts: { replaceAll?: boolean } = {}) {
  const { agg, value: p } = await withPoll(
    async () => (await openOwnResponse(ctx, publicId, responseId, token)).agg,
    (agg) => {
      const p = findParticipant(agg, responseId)!;
      svc.updateResponse(agg, p, data, opts);
      return p;
    },
    () => ({ actor: actorLabel(ctx.actor).replace(/anonymous$/, "participant") }),
  );
  return { agg, p };
}

export function ownResponseView(agg: PollAggregate, p: ReturnType<typeof findParticipant> & object) {
  const answers = participantAnswers(agg, p);
  return {
    response_id: pKey(p.no), display_name: p.displayName, comment: p.comment, answers,
    candidates: agg.candidates.filter((c) => !c.deleted).map((c) => ({
      id: cKey(c.no), start: isoLocal(c.startAt, agg.poll.timezone), end: isoLocal(c.endAt, agg.poll.timezone), answer: answers[cKey(c.no)] ?? null,
    })),
  };
}
