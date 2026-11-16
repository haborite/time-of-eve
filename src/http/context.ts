/**
 * Per-request context for Hono: language, settings, repositories, links, authentication.
 * Everything is derived per request (Workers have no long-lived process state).
 */
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { AppError } from "../domain/errors";
import { Links } from "../domain/links";
import { detectLang, LANG_COOKIE, type Lang } from "../lib/i18n";
import { db, PollStore, type DB } from "../repo/polls";
import { getSettings, type Settings } from "../repo/settings";
import { getSession, userForApiToken, type AuthUser } from "../repo/users";
import type { Actor, Ctx } from "../app/usecases";

export type Env = Cloudflare.Env & { SECRET_KEY: string; TURNSTILE_SECRET_KEY?: string };

export interface Session {
  user: AuthUser;
  csrf: string;
}

export interface Vars {
  lang: Lang;
  db: DB;
  store: PollStore;
  links: Links;
  settings: Settings;
  /** admin via session cookie (web) */
  session: Session | null;
  /** admin via Authorization: Bearer (API token or OAuth access token) */
  bearerUser: AuthUser | null;
  /** an Authorization header was sent but was not valid */
  bearerInvalid: boolean;
}

export type HonoEnv = { Bindings: Env; Variables: Vars };
export type C = Context<HonoEnv>;

export const SESSION_COOKIE = "toe_session";

export function origin(env: Env): string {
  return (env.PUBLIC_ORIGIN || "http://localhost:8823").replace(/\/+$/, "");
}

export function isHttps(env: Env): boolean {
  return origin(env).startsWith("https://");
}

/** OAuth access tokens are validated by the OAuth layer (src/oauth.ts); it installs a resolver here. */
export type OAuthResolver = (env: Env, token: string, request: Request) => Promise<AuthUser | null>;
let oauthResolver: OAuthResolver | null = null;
export function setOAuthResolver(r: OAuthResolver) {
  oauthResolver = r;
}

export const base = createMiddleware<HonoEnv>(async (c, next) => {
  if (!c.env.SECRET_KEY || c.env.SECRET_KEY.length < 32) {
    throw new Error("SECRET_KEY is missing or shorter than 32 characters (wrangler secret put SECRET_KEY)");
  }
  const d = db(c.env);
  c.set("db", d);
  c.set("store", new PollStore(d));
  c.set("links", new Links(origin(c.env), c.env.SECRET_KEY));
  c.set("lang", detectLang(getCookie(c, LANG_COOKIE), c.req.header("accept-language")));
  c.set("settings", await getSettings(d));
  // session (cookie)
  const cookie = getCookie(c, SESSION_COOKIE);
  c.set("session", cookie ? await getSession(d, c.env.SECRET_KEY, cookie) : null);
  // bearer (API token "sch_…" or OAuth access token)
  c.set("bearerUser", null);
  c.set("bearerInvalid", false);
  const authz = c.req.header("authorization") ?? "";
  if (/^bearer\s+/i.test(authz)) {
    const token = authz.replace(/^bearer\s+/i, "").trim();
    let user: AuthUser | null = null;
    if (token.startsWith("sch_")) user = await userForApiToken(d, c.env.SECRET_KEY, token);
    else if (oauthResolver) user = await oauthResolver(c.env, token, c.req.raw);
    c.set("bearerUser", user);
    c.set("bearerInvalid", !user);
  }
  await next();
});

/** Actor for API/MCP calls: bearer admin, else anonymous. Invalid credentials are an error, not anonymous. */
export function apiActor(c: C, via: "api" | "mcp"): Actor {
  if (c.get("bearerInvalid")) throw new AppError("unauthorized", 401);
  const u = c.get("bearerUser");
  if (u) return { kind: "admin", user: u, via };
  // the web UI calls the REST API with its session cookie (+ CSRF header, checked by the API router)
  const s = c.get("session");
  if (s && via === "api") return { kind: "admin", user: s.user, via: "web" };
  return { kind: "anonymous", via };
}

export function webActor(c: C): Actor {
  const s = c.get("session");
  return s ? { kind: "admin", user: s.user, via: "web" } : { kind: "anonymous", via: "web" };
}

export function ctxOf(c: C, actor: Actor): Ctx {
  return { store: c.get("store"), links: c.get("links"), settings: c.get("settings"), actor };
}

export function clientIp(c: C): string {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-real-ip") ?? "local";
}

/** Rate limit with a Workers Rate Limiting binding; missing binding (e.g. some test setups) = no limit. */
export async function rateLimit(c: C, binding: "RL_WRITE" | "RL_CREATE" | "RL_MCP", key = clientIp(c)) {
  const rl = (c.env as unknown as Record<string, RateLimit | undefined>)[binding];
  if (!rl || (c.env.ENVIRONMENT as string) === "test") return;
  const { success } = await rl.limit({ key: `${binding}:${key}` });
  if (!success) throw new AppError("rate_limited", 429);
}

/** Request body as JSON with a size cap. */
export async function readJson(c: C, max = 512 * 1024): Promise<unknown> {
  const len = Number(c.req.header("content-length") ?? 0);
  if (len > max) throw new AppError("payload_too_large", 413);
  const raw = await c.req.text();
  if (raw.length > max) throw new AppError("payload_too_large", 413);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("invalid_json", 400);
  }
}

/** Language for API messages: X-UI-Lang, then Accept-Language, default English (AI agents). */
export function apiLang(c: C): Lang {
  const x = c.req.header("x-ui-lang");
  if (x === "ja" || x === "en") return x;
  return detectLang(null, c.req.header("accept-language"), "en");
}
