/** Administrators, sessions, API tokens and login throttling (all in D1 — no in-process state). */
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import * as s from "../db/schema";
import { DUMMY_PASSWORD_HASH, hashPassword, randomToken, tokenHash, verifyPassword } from "../lib/crypto";
import type { DB } from "./polls";

export const SESSION_HOURS = 12;
export const LOGIN_WINDOW_MS = 10 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 10;
export const API_TOKEN_PREFIX = "sch_";

export interface AuthUser {
  id: number;
  username: string;
}

export async function listUsers(d: DB) {
  return d.select({ id: s.users.id, username: s.users.username, disabled: s.users.disabled, createdAt: s.users.createdAt })
    .from(s.users).orderBy(asc(s.users.id));
}

export async function countActiveUsers(d: DB): Promise<number> {
  const r = await d.select({ n: sql<number>`count(*)` }).from(s.users).where(eq(s.users.disabled, false));
  return r[0]?.n ?? 0;
}

export async function createUser(d: DB, username: string, password: string) {
  const passwordHash = await hashPassword(password);
  const r = await d.insert(s.users).values({ username, passwordHash }).returning({ id: s.users.id });
  return r[0].id;
}

export async function setPassword(d: DB, userId: number, password: string) {
  await d.batch([
    d.update(s.users).set({ passwordHash: await hashPassword(password) }).where(eq(s.users.id, userId)),
    d.delete(s.sessions).where(eq(s.sessions.userId, userId)),
  ]);
}

export async function setDisabled(d: DB, userId: number, disabled: boolean) {
  await d.batch([
    d.update(s.users).set({ disabled }).where(eq(s.users.id, userId)),
    ...(disabled ? [d.delete(s.sessions).where(eq(s.sessions.userId, userId)), d.update(s.apiTokens).set({ revoked: true }).where(eq(s.apiTokens.userId, userId))] : []),
  ] as never);
}

/** Verify credentials. Always runs one PBKDF2 (dummy hash for unknown users) so timing does not reveal usernames. */
export async function checkLogin(d: DB, username: string, password: string): Promise<AuthUser | null> {
  const rows = await d.select().from(s.users).where(eq(s.users.username, username)).limit(1);
  const u = rows[0];
  const ok = await verifyPassword(u?.passwordHash ?? DUMMY_PASSWORD_HASH, password);
  if (!u || !ok || u.disabled) return null;
  return { id: u.id, username: u.username };
}

// ---------- login throttling ----------

/** True if this key has reached the failure limit within the window. */
export async function loginBlocked(d: DB, key: string, now = Date.now()): Promise<boolean> {
  const r = await d.select().from(s.loginAttempts).where(eq(s.loginAttempts.key, key)).limit(1);
  return !!r[0] && now - r[0].windowStart < LOGIN_WINDOW_MS && r[0].count >= LOGIN_MAX_FAILURES;
}

export async function recordLoginFailure(d: DB, key: string, now = Date.now()) {
  await d.insert(s.loginAttempts).values({ key, windowStart: now, count: 1 }).onConflictDoUpdate({
    target: s.loginAttempts.key,
    set: {
      count: sql`CASE WHEN ${now} - ${s.loginAttempts.windowStart} < ${LOGIN_WINDOW_MS} THEN ${s.loginAttempts.count} + 1 ELSE 1 END`,
      windowStart: sql`CASE WHEN ${now} - ${s.loginAttempts.windowStart} < ${LOGIN_WINDOW_MS} THEN ${s.loginAttempts.windowStart} ELSE ${now} END`,
    },
  });
}

export async function clearLoginFailures(d: DB, key: string) {
  await d.delete(s.loginAttempts).where(eq(s.loginAttempts.key, key));
}

// ---------- sessions ----------

export async function createSession(d: DB, secret: string, userId: number, now = Date.now()) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  await d.insert(s.sessions).values({ id: await tokenHash(secret, token), userId, csrf, expiresAt: now + SESSION_HOURS * 3600e3 });
  return { token, csrf };
}

export async function getSession(d: DB, secret: string, token: string, now = Date.now()) {
  const rows = await d.select({ userId: s.sessions.userId, csrf: s.sessions.csrf, expiresAt: s.sessions.expiresAt, username: s.users.username, disabled: s.users.disabled })
    .from(s.sessions).innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .where(eq(s.sessions.id, await tokenHash(secret, token))).limit(1);
  const r = rows[0];
  if (!r || r.expiresAt < now || r.disabled) return null;
  return { user: { id: r.userId, username: r.username }, csrf: r.csrf };
}

export async function deleteSession(d: DB, secret: string, token: string) {
  await d.delete(s.sessions).where(eq(s.sessions.id, await tokenHash(secret, token)));
}

// ---------- API tokens ----------

export async function createApiToken(d: DB, secret: string, userId: number, name: string) {
  const token = API_TOKEN_PREFIX + randomToken(32);
  await d.insert(s.apiTokens).values({ userId, name: name.trim().slice(0, 100) || "token", tokenHash: await tokenHash(secret, token) });
  return token;
}

export async function userForApiToken(d: DB, secret: string, token: string): Promise<AuthUser | null> {
  if (!token.startsWith(API_TOKEN_PREFIX)) return null;
  const h = await tokenHash(secret, token);
  const rows = await d.select({ id: s.users.id, username: s.users.username, disabled: s.users.disabled, tokenId: s.apiTokens.id, lastUsedAt: s.apiTokens.lastUsedAt })
    .from(s.apiTokens).innerJoin(s.users, eq(s.users.id, s.apiTokens.userId))
    .where(and(eq(s.apiTokens.tokenHash, h), eq(s.apiTokens.revoked, false))).limit(1);
  const r = rows[0];
  if (!r || r.disabled) return null;
  const now = Date.now();
  if (!r.lastUsedAt || now - r.lastUsedAt > 3600e3) {
    await d.update(s.apiTokens).set({ lastUsedAt: now }).where(eq(s.apiTokens.id, r.tokenId));
  }
  return { id: r.id, username: r.username };
}

export function listApiTokens(d: DB, userId: number) {
  return d.select({ id: s.apiTokens.id, name: s.apiTokens.name, revoked: s.apiTokens.revoked, createdAt: s.apiTokens.createdAt, lastUsedAt: s.apiTokens.lastUsedAt })
    .from(s.apiTokens).where(eq(s.apiTokens.userId, userId)).orderBy(desc(s.apiTokens.id));
}

export async function revokeApiToken(d: DB, userId: number, id: number) {
  await d.update(s.apiTokens).set({ revoked: true }).where(and(eq(s.apiTokens.id, id), eq(s.apiTokens.userId, userId)));
}

// ---------- housekeeping ----------

export async function purgeExpired(d: DB, now = Date.now()) {
  await d.batch([
    d.delete(s.sessions).where(lt(s.sessions.expiresAt, now)),
    d.delete(s.loginAttempts).where(lt(s.loginAttempts.windowStart, now - LOGIN_WINDOW_MS)),
  ]);
}
