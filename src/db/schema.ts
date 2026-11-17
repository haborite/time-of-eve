/**
 * D1 schema (Drizzle). Times are integer milliseconds since the Unix epoch (UTC).
 *
 * Design notes
 * - A poll is an aggregate: polls + candidates + participants. It is loaded with one D1 batch and written with
 *   one D1 batch (atomic). Optimistic locking uses `polls.version` together with the `guard` table (see
 *   migrations/0001: a trigger aborts the whole batch when a precondition row with ok = 0 is inserted).
 * - Each participant's answers live in that participant's row as JSON ({"c1":"yes"}), so reading a poll costs
 *   one row per participant instead of one per (participant × candidate). D1 bills by rows read.
 * - Edit links and management links are not stored: they are HMAC(SECRET_KEY, purpose:id:nonce). Only the nonce is
 *   stored; rotating the nonce revokes the link. A leaked database alone does not reveal any link.
 */
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`;

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull().default(now),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // HMAC of the cookie value
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  csrf: text("csrf").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (t) => [index("sessions_user").on(t.userId), index("sessions_expires").on(t.expiresAt)]);

export const apiTokens = sqliteTable("api_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull().default(now),
  lastUsedAt: integer("last_used_at"),
});

/** Failed login counter per key (ip / username) in a fixed window. Replaces the in-process dict of the Python app. */
export const loginAttempts = sqliteTable("login_attempts", {
  key: text("key").primaryKey(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull(),
});

/** Site settings editable on the admin dashboard (JSON values). */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull().default(now),
});

export const polls = sqliteTable("polls", {
  id: text("id").primaryKey(), // ULID
  publicId: text("public_id").notNull().unique(),
  ownerUserId: integer("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  /** "u:<user id>" for admins, "anon" for anonymous creators: idempotency scope of client_request_id. */
  ownerScope: text("owner_scope").notNull(),
  manageNonce: text("manage_nonce").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  basis: text("basis").notNull().default(""),
  timezone: text("timezone").notNull(),
  durationMinutes: integer("duration_minutes"),
  responseDeadline: integer("response_deadline"),
  showParticipantNames: integer("show_participant_names", { mode: "boolean" }).notNull().default(false),
  allowMaybe: integer("allow_maybe", { mode: "boolean" }).notNull().default(true),
  // "draft" is legacy (polls now open on creation; the app always sets status). Kept so the column needs no migration.
  status: text("status", { enum: ["draft", "open", "closed", "finalized", "cancelled"] }).notNull().default("draft"),
  finalizedCandidateNo: integer("finalized_candidate_no"),
  /** Moderation: hidden by an administrator (public page and API answer 404). */
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  clientRequestId: text("client_request_id"),
  requestHash: text("request_hash"),
  version: integer("version").notNull().default(1),
  createdAt: integer("created_at").notNull().default(now),
  updatedAt: integer("updated_at").notNull().default(now),
}, (t) => [
  uniqueIndex("polls_idempotency").on(t.ownerScope, t.clientRequestId),
  index("polls_owner").on(t.ownerUserId, t.createdAt),
  index("polls_created").on(t.createdAt),
]);

export const candidates = sqliteTable("candidates", {
  pollId: text("poll_id").notNull().references(() => polls.id, { onDelete: "cascade" }),
  no: integer("no").notNull(), // key = "c" + no, stable within the poll
  startAt: integer("start_at").notNull(),
  endAt: integer("end_at").notNull(),
  deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
}, (t) => [primaryKey({ columns: [t.pollId, t.no] })]);

export const participants = sqliteTable("participants", {
  pollId: text("poll_id").notNull().references(() => polls.id, { onDelete: "cascade" }),
  no: integer("no").notNull(), // key = "p" + no
  displayName: text("display_name").notNull(),
  email: text("email"),
  required: integer("required", { mode: "boolean" }).notNull().default(false),
  preregistered: integer("preregistered", { mode: "boolean" }).notNull().default(false),
  comment: text("comment").notNull().default(""),
  /** {"c1": "yes", ...} for active and removed candidates (removed ones are ignored when reading). */
  answers: text("answers").notNull().default("{}"),
  /** Timeline marks {"YYYY-MM-DDTHH:MM" (poll-local): answer}; null = derived from answers. */
  slots: text("slots"),
  editNonce: text("edit_nonce"),
  respondedAt: integer("responded_at"),
  createdAt: integer("created_at").notNull().default(now),
}, (t) => [primaryKey({ columns: [t.pollId, t.no] })]);

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  pollId: text("poll_id"), // no FK: moderation history survives deletion
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  detail: text("detail").notNull().default("{}"),
  createdAt: integer("created_at").notNull().default(now),
}, (t) => [index("audit_poll").on(t.pollId, t.id)]);

export const templates = sqliteTable("templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull().default(now),
});

/**
 * Precondition table for atomic batches. INSERT (ok = 0) aborts the batch with "guard_failed:<code>";
 * INSERT (ok = 1) is silently ignored, so the table always stays empty. Triggers are in migration 0001.
 */
export const guard = sqliteTable("guard", {
  ok: integer("ok").notNull(),
  code: text("code").notNull(),
});

export type PollRow = typeof polls.$inferSelect;
export type CandidateRow = typeof candidates.$inferSelect;
export type ParticipantRow = typeof participants.$inferSelect;
export type UserRow = typeof users.$inferSelect;
