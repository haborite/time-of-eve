/** @jsxImportSource hono/jsx */
/**
 * OAuth 2.1 for MCP clients (claude.ai / ChatGPT custom connectors, Claude Code …) — administrators only.
 *
 *   /mcp         participants and anonymous organizers; no OAuth (API tokens "sch_…" also accepted)
 *   /mcp/admin   protected resource: 401 + RFC 9728 metadata → the client runs OAuth → administrator tools
 *
 * @cloudflare/workers-oauth-provider (OAuthAuthorizationServer) implements discovery (RFC 8414), the token endpoint
 * with PKCE and refresh rotation, dynamic client registration (RFC 7591) and Client ID Metadata Documents; tokens and
 * grants live in KV (OAUTH_KV), hashed. This file adds the consent page (/oauth/authorize) where an administrator
 * signs in and approves, and the token check used for /mcp/admin.
 */
import { AuthorizationError, OAuthAuthorizationServer, authorizationErrorRedirect, type AuthRequest } from "@cloudflare/workers-oauth-provider";
import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { hmac, timingSafeEqual, b64url, fromB64url } from "./lib/crypto";
import { detectLang, LANG_COOKIE, t } from "./lib/i18n";
import { db } from "./repo/polls";
import * as users from "./repo/users";
import { SESSION_COOKIE, origin, setOAuthResolver, type Env } from "./http/context";
import { auditLogs } from "./db/schema";
import { makeView } from "./views/layout";
import { OAuthConsentPage } from "./views/site";
import { siteMeta } from "./og/card";
import { Links } from "./domain/links";

export const ADMIN_MCP_PATH = "/mcp/admin";
const SCOPE = "mcp";

const servers = new Map<string, OAuthAuthorizationServer<Env>>();

function authServer(env: Env): OAuthAuthorizationServer<Env> {
  const iss = origin(env);
  let s = servers.get(iss);
  if (!s) {
    s = new OAuthAuthorizationServer<Env>({
      issuer: iss,
      resources: [`${iss}${ADMIN_MCP_PATH}`],
      authorizeEndpoint: "/oauth/authorize",
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/oauth/register",
      clientIdMetadataDocumentEnabled: true,
      scopesSupported: [SCOPE, "offline_access"],
      accessTokenTTL: 3600,
    });
    servers.set(iss, s);
  }
  return s;
}

export function resourceMetadataUrl(env: Env) {
  return `${origin(env)}/.well-known/oauth-protected-resource${ADMIN_MCP_PATH}`;
}

interface Props {
  userId: number;
  username: string;
}

// Access tokens are accepted only at /mcp/admin, and only while the administrator account is active.
setOAuthResolver(async (env, token, request) => {
  if (new URL(request.url).pathname !== ADMIN_MCP_PATH || !env.OAUTH_KV) return null;
  const r = await authServer(env).validateToken<Props>(`${origin(env)}${ADMIN_MCP_PATH}`, token, env);
  if (!r?.props?.userId) return null;
  const list = await users.listUsers(db(env));
  const u = list.find((x) => x.id === r.props.userId && !x.disabled);
  return u ? { id: u.id, username: u.username } : null;
});

// ---------- consent page ----------

const consent = new Hono<{ Bindings: Env }>();

async function sign(env: Env, req: AuthRequest) {
  const body = b64url(new TextEncoder().encode(JSON.stringify({ req, exp: Date.now() + 10 * 60e3 })));
  return `${body}.${await hmac(env.SECRET_KEY, `oauth-state:${body}`)}`;
}

async function unsign(env: Env, state: string): Promise<AuthRequest | null> {
  const [body, mac] = state.split(".");
  if (!body || !mac || !timingSafeEqual(mac, await hmac(env.SECRET_KEY, `oauth-state:${body}`))) return null;
  const o = JSON.parse(new TextDecoder().decode(fromB64url(body))) as { req: AuthRequest; exp: number };
  return o.exp > Date.now() ? o.req : null;
}

async function page(c: Context<{ Bindings: Env }>, req: AuthRequest, o: { error?: string | null; status?: number } = {}) {
  const env = c.env;
  const lang = detectLang(getCookieValue(c.req.header("cookie"), LANG_COOKIE), c.req.header("accept-language"));
  const d = db(env);
  const cookie = getCookieValue(c.req.header("cookie"), SESSION_COOKIE);
  const sess = cookie ? await users.getSession(d, env.SECRET_KEY, cookie) : null;
  const client = await authServer(env).getOAuthApi(env).lookupClient(req.clientId);
  const state = await sign(env, req);
  const v = makeView(lang, new URL(c.req.url).pathname, null, false);
  const links = new Links(origin(env), env.SECRET_KEY);
  const node = (
    <OAuthConsentPage v={v} meta={await siteMeta(lang, links, "/")} clientName={client?.clientName ?? req.clientId} redirectHost={new URL(req.redirectUri).host}
      username={sess?.user.username ?? null} state={state} csrf={await hmac(env.SECRET_KEY, `oauth-csrf:${state}`)}
      scopes={[t(lang, "日程調整の作成・編集・確定・削除（管理者としてすべての日程調整）")]} error={o.error} />
  );
  return c.html(node as unknown as string, (o.status ?? 200) as 200, {
    // the form redirects to the client's callback after submit: no form-action restriction here
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
    "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
  });
}

function getCookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

consent.get("/oauth/authorize", async (c) => {
  const helpers = authServer(c.env).getOAuthApi(c.env);
  try {
    const req = await helpers.parseAuthRequest(c.req.raw);
    return page(c, req);
  } catch (e) {
    if (e instanceof AuthorizationError) {
      if (e.redirectTo) return c.redirect(e.redirectTo, 302);
      return c.text(`OAuth error: ${e.code}${e.description ? ` — ${e.description}` : ""}`, 400);
    }
    throw e;
  }
});

consent.post("/oauth/authorize", async (c) => {
  const env = c.env;
  const form = await c.req.parseBody();
  const state = String(form.state ?? "");
  const req = state ? await unsign(env, state) : null;
  if (!req) return c.text("The authorization request expired. Start again from your MCP client.", 400);
  if (!timingSafeEqual(String(form.csrf ?? ""), await hmac(env.SECRET_KEY, `oauth-csrf:${state}`))) return c.text("Invalid form", 400);
  const o = c.req.header("origin");
  if (o && o !== origin(env)) return c.text("Invalid origin", 403);
  const lang = detectLang(getCookie(c, LANG_COOKIE), c.req.header("accept-language"));
  if (form.decision !== "allow") return c.redirect(authorizationErrorRedirect(req, "access_denied"), 302);
  const d = db(env);
  const cookie = getCookie(c, SESSION_COOKIE);
  let user = cookie ? (await users.getSession(d, env.SECRET_KEY, cookie))?.user ?? null : null;
  if (!user) {
    const username = String(form.username ?? "").slice(0, 64);
    const ipKey = `ip:${c.req.header("cf-connecting-ip") ?? "local"}`, userKey = `user:${username.toLowerCase()}`;
    if ((await users.loginBlocked(d, ipKey)) || (await users.loginBlocked(d, userKey))) return page(c, req, { error: t(lang, "試行回数が多すぎます。しばらく待ってください"), status: 429 });
    user = await users.checkLogin(d, username, String(form.password ?? "").slice(0, 1024));
    if (!user) {
      await Promise.all([users.recordLoginFailure(d, ipKey), users.recordLoginFailure(d, userKey)]);
      return page(c, req, { error: t(lang, "ユーザー名またはパスワードが違います"), status: 401 });
    }
  }
  const client = await authServer(env).getOAuthApi(env).lookupClient(req.clientId);
  const { redirectTo } = await authServer(env).getOAuthApi(env).completeAuthorization({
    request: req, userId: String(user.id), metadata: { client: client?.clientName ?? req.clientId, username: user.username },
    scope: [SCOPE, ...req.scope.filter((s) => s === "offline_access")], props: { userId: user.id, username: user.username } satisfies Props,
  });
  await d.insert(auditLogs).values({ actor: `oauth:${user.username}`, action: "oauth_grant", detail: JSON.stringify({ client: client?.clientName ?? req.clientId, ip: clientIpOf(c.req.raw) }) });
  return c.redirect(redirectTo, 302);
});

function clientIpOf(r: Request) {
  return r.headers.get("cf-connecting-ip") ?? "local";
}

/** Route OAuth endpoints; everything else goes to the app. */
export async function oauthFetch(request: Request, env: Env, ctx: ExecutionContext, next: (r: Request) => Promise<Response> | Response): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === `/.well-known/oauth-protected-resource${ADMIN_MCP_PATH}` || path === "/.well-known/oauth-protected-resource") {
    return Response.json({
      resource: `${origin(env)}${ADMIN_MCP_PATH}`, authorization_servers: [origin(env)], scopes_supported: [SCOPE],
      bearer_methods_supported: ["header"], resource_name: "Time of EVE (administrators)",
    }, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" } });
  }
  if (path === "/oauth/authorize") {
    if (!env.SECRET_KEY) return new Response("SECRET_KEY missing", { status: 500 });
    return consent.fetch(request, env, ctx);
  }
  if (path.startsWith("/.well-known/oauth-authorization-server") || path === "/oauth/token" || path === "/oauth/register") {
    return authServer(env).fetch(request, env, ctx);
  }
  return next(request);
}
