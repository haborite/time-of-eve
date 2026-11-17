/**
 * Poll repository: load an aggregate with one D1 batch, persist changes with one atomic D1 batch.
 *
 * Concurrency
 * - Organizer edits bump `version`. The batch starts with a guard row asserting the version read at load time;
 *   if someone else committed meanwhile, the trigger aborts the whole batch → version_conflict (409).
 * - Responses do not bump the version (participants answer concurrently). A new participant gets no = max + 1;
 *   two simultaneous new rows collide on the primary key, the batch fails and `withPoll` retries from a fresh load.
 * - Answering as an invited participant asserts "not answered yet" with a guard row (no double submission).
 */
import { and, asc, desc, eq, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { BatchItem } from "drizzle-orm/batch";
import * as s from "../db/schema";
import { AppError } from "../domain/errors";
import { emptyDirty, sortCandidates, type Answer, type Participant, type Poll, type PollAggregate } from "../domain/model";

export type DB = DrizzleD1Database<typeof s>;

export function db(env: { DB: D1Database }): DB {
  return drizzle(env.DB, { schema: s });
}

function parseJson<T>(v: string | null, fallback: T): T {
  if (!v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

function toPoll(r: s.PollRow): Poll {
  return { ...r, status: r.status as Poll["status"] };
}

function toParticipant(r: s.ParticipantRow): Participant {
  return {
    no: r.no, displayName: r.displayName, email: r.email, required: r.required, preregistered: r.preregistered, comment: r.comment,
    answers: parseJson<Record<string, Answer>>(r.answers, {}), slots: r.slots ? parseJson<Record<string, Answer> | null>(r.slots, null) : null,
    editNonce: r.editNonce, respondedAt: r.respondedAt, createdAt: r.createdAt,
  };
}

async function loadWhere(d: DB, where: SQL): Promise<PollAggregate | null> {
  const rows = await d.select().from(s.polls).where(where).limit(1);
  if (!rows.length) return null;
  const poll = toPoll(rows[0]);
  const [cands, parts] = await d.batch([
    d.select().from(s.candidates).where(eq(s.candidates.pollId, poll.id)),
    d.select().from(s.participants).where(eq(s.participants.pollId, poll.id)).orderBy(asc(s.participants.no)),
  ]);
  return {
    poll,
    candidates: sortCandidates(cands.map((c) => ({ no: c.no, startAt: c.startAt, endAt: c.endAt, deleted: c.deleted }))),
    participants: parts.map(toParticipant),
    loadedVersion: poll.version,
    dirty: emptyDirty(),
    audit: [],
  };
}

export function loadById(d: DB, id: string) {
  return loadWhere(d, eq(s.polls.id, id));
}

export function loadByPublicId(d: DB, publicId: string) {
  return loadWhere(d, eq(s.polls.publicId, publicId));
}

export function findByIdempotencyKey(d: DB, ownerScope: string, clientRequestId: string) {
  return loadWhere(d, and(eq(s.polls.ownerScope, ownerScope), eq(s.polls.clientRequestId, clientRequestId))!);
}

/** Public lookup: hidden polls do not exist for participants. */
export async function loadPublic(d: DB, publicId: string): Promise<PollAggregate> {
  const agg = await loadByPublicId(d, publicId);
  if (!agg || agg.poll.hidden) throw new AppError("poll_not_found", 404);
  return agg;
}

export interface CommitOptions {
  actor: string;
  /** assert that this invited participant has not answered yet */
  assertNotResponded?: number;
  now?: number;
}

/** Persist everything marked dirty (and audit entries) in one atomic batch. */
export async function commit(d: DB, agg: PollAggregate, o: CommitOptions): Promise<void> {
  const now = o.now ?? Date.now();
  const p = agg.poll;
  const isNew = agg.loadedVersion === 0;
  const stmts: BatchItem<"sqlite">[] = [];
  if (!isNew && agg.dirty.bumpVersion) {
    stmts.push(d.insert(s.guard).select(
      sql`SELECT (SELECT count(*) FROM ${s.polls} WHERE ${s.polls.id} = ${p.id} AND ${s.polls.version} = ${agg.loadedVersion}), 'version_conflict'`,
    ));
  }
  if (o.assertNotResponded != null) {
    stmts.push(d.insert(s.guard).select(
      sql`SELECT (SELECT count(*) FROM ${s.participants} WHERE ${s.participants.pollId} = ${p.id} AND ${s.participants.no} = ${o.assertNotResponded} AND ${s.participants.respondedAt} IS NULL), 'already_responded'`,
    ));
  }
  const pollValues = {
    title: p.title, description: p.description, basis: p.basis, timezone: p.timezone, durationMinutes: p.durationMinutes,
    responseDeadline: p.responseDeadline, showParticipantNames: p.showParticipantNames, allowMaybe: p.allowMaybe, status: p.status,
    finalizedCandidateNo: p.finalizedCandidateNo, hidden: p.hidden, manageNonce: p.manageNonce,
  };
  if (isNew) {
    stmts.push(d.insert(s.polls).values({
      ...pollValues, id: p.id, publicId: p.publicId, ownerUserId: p.ownerUserId, ownerScope: p.ownerScope,
      clientRequestId: p.clientRequestId, requestHash: p.requestHash, version: 1, createdAt: p.createdAt, updatedAt: now,
    }));
  } else if (agg.dirty.poll || agg.dirty.bumpVersion) {
    if (agg.dirty.bumpVersion) p.version = agg.loadedVersion + 1;
    stmts.push(d.update(s.polls).set({ ...pollValues, version: p.version, updatedAt: now }).where(eq(s.polls.id, p.id)));
  } else if (agg.dirty.participants.size || agg.dirty.newParticipants.size) {
    stmts.push(d.update(s.polls).set({ updatedAt: now }).where(eq(s.polls.id, p.id)));
  }
  const newC = agg.candidates.filter((c) => agg.dirty.newCandidates.has(c.no));
  // D1 limits bound parameters per statement (100): insert in chunks.
  for (let i = 0; i < newC.length; i += 20) {
    stmts.push(d.insert(s.candidates).values(newC.slice(i, i + 20).map((c) => ({ pollId: p.id, no: c.no, startAt: c.startAt, endAt: c.endAt, deleted: c.deleted }))));
  }
  for (const c of agg.candidates) {
    if (agg.dirty.candidates.has(c.no) && !agg.dirty.newCandidates.has(c.no)) {
      stmts.push(d.update(s.candidates).set({ deleted: c.deleted }).where(and(eq(s.candidates.pollId, p.id), eq(s.candidates.no, c.no))));
    }
  }
  for (const x of agg.participants) {
    const values = {
      displayName: x.displayName, email: x.email, required: x.required, preregistered: x.preregistered, comment: x.comment,
      answers: JSON.stringify(x.answers), slots: x.slots ? JSON.stringify(x.slots) : null, editNonce: x.editNonce, respondedAt: x.respondedAt,
    };
    if (agg.dirty.newParticipants.has(x.no)) {
      stmts.push(d.insert(s.participants).values({ ...values, pollId: p.id, no: x.no, createdAt: x.createdAt }));
    } else if (agg.dirty.participants.has(x.no)) {
      stmts.push(d.update(s.participants).set(values).where(and(eq(s.participants.pollId, p.id), eq(s.participants.no, x.no))));
    }
  }
  for (const a of agg.audit) {
    stmts.push(d.insert(s.auditLogs).values({ pollId: p.id, actor: o.actor, action: a.action, detail: JSON.stringify(a.detail), createdAt: now }));
  }
  if (!stmts.length) return;
  try {
    await d.batch(stmts as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  } catch (e) {
    throw translateDbError(e);
  }
  agg.loadedVersion = p.version;
  agg.dirty = emptyDirty();
  agg.audit = [];
}

export class RetryableConflict extends Error {}

function translateDbError(e: unknown): Error {
  const msg = String((e as Error)?.message ?? e) + String(((e as { cause?: Error })?.cause)?.message ?? "");
  if (msg.includes("guard:version_conflict")) return new AppError("version_conflict", 409, "version");
  if (msg.includes("guard:already_responded")) return new AppError("already_responded", 409, "participant_id");
  if (/UNIQUE constraint failed: (participants|candidates)\./.test(msg) || /PRIMARY KEY/.test(msg)) return new RetryableConflict(msg);
  return e as Error;
}

/**
 * Load → mutate → commit, retrying when a concurrent writer took the same new row number.
 * `fn` returns a value and may throw AppError; it must be safe to run again on a fresh aggregate.
 */
export async function withPoll<T>(
  load: () => Promise<PollAggregate>, fn: (agg: PollAggregate) => Promise<T> | T, o: (agg: PollAggregate, value: T) => CommitOptions,
): Promise<{ agg: PollAggregate; value: T }> {
  for (let attempt = 0; ; attempt++) {
    const agg = await load();
    const value = await fn(agg);
    try {
      await commit(dbOf(agg), agg, o(agg, value));
      return { agg, value };
    } catch (e) {
      if (e instanceof RetryableConflict && attempt < 3) continue;
      throw e;
    }
  }
}

// `withPoll` needs the DB handle; keep it attached to aggregates loaded through `PollStore`.
const dbHandles = new WeakMap<PollAggregate, DB>();
function dbOf(agg: PollAggregate): DB {
  const d = dbHandles.get(agg);
  if (!d) throw new Error("aggregate was not loaded through PollStore");
  return d;
}

/** Convenience wrapper binding the DB handle. */
export class PollStore {
  constructor(public d: DB) {}

  private attach(agg: PollAggregate | null) {
    if (agg) dbHandles.set(agg, this.d);
    return agg;
  }

  async byId(id: string) {
    return this.attach(await loadById(this.d, id));
  }

  async byPublicId(publicId: string) {
    return this.attach(await loadByPublicId(this.d, publicId));
  }

  async publicPoll(publicId: string) {
    return this.attach(await loadPublic(this.d, publicId))!;
  }

  async byIdempotencyKey(scope: string, crid: string) {
    return this.attach(await findByIdempotencyKey(this.d, scope, crid));
  }

  adopt(agg: PollAggregate) {
    return this.attach(agg)!;
  }

  commit(agg: PollAggregate, o: CommitOptions) {
    return commit(this.d, agg, o);
  }

  async deletePoll(id: string, actor: string) {
    await this.d.batch([
      this.d.delete(s.polls).where(eq(s.polls.id, id)),
      this.d.insert(s.auditLogs).values({ pollId: id, actor, action: "delete", detail: "{}" }),
    ]);
  }

  async list(o: { ownerUserId?: number; status?: string; limit?: number; offset?: number; q?: string; anonymousOnly?: boolean } = {}) {
    const conds: SQL[] = [];
    if (o.ownerUserId != null) conds.push(eq(s.polls.ownerUserId, o.ownerUserId));
    if (o.anonymousOnly) conds.push(isNull(s.polls.ownerUserId));
    if (o.status) conds.push(eq(s.polls.status, o.status as Poll["status"]));
    if (o.q) conds.push(sql`${s.polls.title} LIKE ${"%" + o.q.replace(/[%_\\]/g, (m) => "\\" + m) + "%"} ESCAPE '\\'`);
    const rows = await this.d.select({
      id: s.polls.id, publicId: s.polls.publicId, title: s.polls.title, status: s.polls.status, hidden: s.polls.hidden,
      ownerUserId: s.polls.ownerUserId, timezone: s.polls.timezone, responseDeadline: s.polls.responseDeadline,
      createdAt: s.polls.createdAt, updatedAt: s.polls.updatedAt, version: s.polls.version, manageNonce: s.polls.manageNonce,
      candidateCount: sql<number>`(SELECT count(*) FROM ${s.candidates} WHERE ${s.candidates.pollId} = ${s.polls.id} AND ${s.candidates.deleted} = 0)`,
      responded: sql<number>`(SELECT count(*) FROM ${s.participants} WHERE ${s.participants.pollId} = ${s.polls.id} AND ${s.participants.respondedAt} IS NOT NULL)`,
      invited: sql<number>`(SELECT count(*) FROM ${s.participants} WHERE ${s.participants.pollId} = ${s.polls.id} AND ${s.participants.preregistered} = 1)`,
    }).from(s.polls).where(conds.length ? and(...conds) : undefined).orderBy(desc(s.polls.createdAt))
      .limit(o.limit ?? 100).offset(o.offset ?? 0);
    return rows;
  }

  audits(pollId: string, limit = 50) {
    return this.d.select().from(s.auditLogs).where(eq(s.auditLogs.pollId, pollId)).orderBy(desc(s.auditLogs.id)).limit(limit);
  }

  /**
   * Retention: delete anonymous polls whose last candidate ended (or, without candidates, that were last updated)
   * more than `days` ago. Returns the number deleted. Batches of 100 to stay within Worker limits.
   */
  async purgeAnonymous(days: number, now = Date.now()): Promise<number> {
    const cutoff = now - days * 86400e3;
    const lastEnd = sql`COALESCE((SELECT max(${s.candidates.endAt}) FROM ${s.candidates} WHERE ${s.candidates.pollId} = ${s.polls.id}), 0)`;
    let total = 0;
    for (let i = 0; i < 50; i++) {
      const rows = await this.d.select({ id: s.polls.id }).from(s.polls)
        .where(and(isNull(s.polls.ownerUserId), lt(s.polls.updatedAt, cutoff), sql`${lastEnd} < ${cutoff}`)).limit(100);
      if (!rows.length) break;
      const ids = rows.map((r) => r.id);
      await this.d.batch([
        this.d.delete(s.polls).where(inArray(s.polls.id, ids)),
        this.d.insert(s.auditLogs).values({ pollId: null, actor: "system:retention", action: "purge", detail: JSON.stringify({ count: ids.length, days }) }),
      ]);
      total += ids.length;
    }
    return total;
  }
}
