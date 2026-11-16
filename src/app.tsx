/** @jsxImportSource hono/jsx */
/** The Hono application: middleware, routers, docs, MCP endpoint, errors. */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { AppError, renderIssue } from "./domain/errors";
import { guide, openApi, pollJsonSchema } from "./docs/docs";
import { api } from "./http/api";
import { apiActor, apiLang, base, ctxOf, origin, rateLimit, type C, type HonoEnv } from "./http/context";
import { errorPage, view, web } from "./http/web";
import { handleMcp } from "./mcp/server";
import { resourceMetadataUrl } from "./oauth";
import { siteMeta } from "./og/card";
import { DocsPage } from "./views/site";

export const app = new Hono<HonoEnv>();

const CSP = [
  "default-src 'self'", "script-src 'self' https://challenges.cloudflare.com", "frame-src https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'",
].join("; ");

app.use("*", async (c, next) => {
  await next();
  const path = new URL(c.req.url).pathname;
  const h = c.res.headers;
  if (!h.has("X-Content-Type-Options")) c.header("X-Content-Type-Options", "nosniff");
  if (!h.has("Referrer-Policy")) c.header("Referrer-Policy", "same-origin");
  if (!h.has("X-Frame-Options")) c.header("X-Frame-Options", "DENY");
  if (!h.has("Content-Security-Policy")) c.header("Content-Security-Policy", CSP);
  if (/^\/(p|m|admin|api|mcp|new|oauth)(\/|$)/.test(path)) c.header("X-Robots-Tag", "noindex, nofollow");
  if (/^\/(m|admin|oauth)(\/|$)/.test(path) && !h.has("Cache-Control")) c.header("Cache-Control", "no-store");
  if (origin(c.env).startsWith("https://")) c.header("Strict-Transport-Security", "max-age=31536000");
});

app.use("*", base);

app.onError(async (err, c) => {
  // Hono's own HTTP errors (e.g. the same-origin form check) keep their status
  if (err instanceof HTTPException) err = new AppError(err.status === 403 ? "csrf_failed" : "invalid_value", err.status);
  const path = new URL(c.req.url).pathname;
  const machine = path.startsWith("/api/") || path === "/mcp" || path.startsWith("/schema") || path === "/openapi.json";
  const e = err instanceof AppError ? err : null;
  if (!e) console.error(err);
  if (machine) {
    const lang = apiLang(c);
    const body = e ? e.render(lang) : { error: renderIssue(lang, { code: "internal_error", field: "" }) };
    if (e?.status === 401) c.header("WWW-Authenticate", 'Bearer error="invalid_token"');
    return c.json({ ...body, docs: c.get("links")?.url("/llms.txt") }, (e?.status ?? 500) as 400);
  }
  try {
    if (!c.get("links")) throw err;
    return await errorPage(c, e?.status ?? 500, e?.code ?? "internal_error");
  } catch {
    return c.text("Internal Server Error", 500);
  }
});

app.notFound(async (c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/")) return c.json({ error: { code: "not_found", field: "", message: "Not found" }, docs: c.get("links").url("/llms.txt") }, 404);
  return errorPage(c, 404, "not_found");
});

// ---------- health / robots / docs for AI agents ----------

app.get("/healthz", async (c) => {
  await c.env.DB.prepare("SELECT 1").first();
  return c.json({ ok: true });
});

app.get("/robots.txt", (c) => c.text("User-agent: *\nAllow: /$\nAllow: /llms.txt\nAllow: /docs\nAllow: /openapi.json\nAllow: /about\nAllow: /terms\nAllow: /privacy\nDisallow: /\n"));

const docHeaders = { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" };
app.get("/llms.txt", (c) => c.body(guide({ links: c.get("links"), settings: c.get("settings") }), 200, { "Content-Type": "text/plain; charset=utf-8", ...docHeaders }));
app.get("/llms.md", (c) => c.body(guide({ links: c.get("links"), settings: c.get("settings") }), 200, { "Content-Type": "text/markdown; charset=utf-8", ...docHeaders }));
app.get("/openapi.json", (c) => c.json(openApi(c.get("links").url()), 200, docHeaders));
app.get("/schema/poll.json", (c) => c.body(JSON.stringify(pollJsonSchema(), null, 2), 200, { "Content-Type": "application/schema+json", ...docHeaders }));
app.get("/docs", async (c) => {
  const v = view(c);
  const l = c.get("links");
  return c.html(<DocsPage v={v} meta={await siteMeta(v.lang, l, "/docs", v.t("AI・API連携"))} doc={guide({ links: l, settings: c.get("settings") })}
    llmsUrl={l.url("/llms.txt")} mcpUrl={l.url("/mcp")} open={c.get("settings").creation_mode === "anyone"} /> as unknown as string);
});

// ---------- MCP ----------

/** Browser-originated MCP calls only from our own origin (+ MCP_ALLOWED_ORIGINS): DNS-rebinding protection. */
function mcpOriginAllowed(c: C): boolean {
  const o = c.req.header("origin");
  if (!o) return true;
  const allowed = new Set([origin(c.env), ...String((c.env as unknown as Record<string, string>).MCP_ALLOWED_ORIGINS ?? "").split(",").map((x) => x.trim().replace(/\/+$/, "")).filter(Boolean)]);
  return allowed.has(o.replace(/\/+$/, ""));
}

app.all("/mcp/admin", async (c) => {
  // OAuth-protected entry for administrators (custom connectors). No/invalid token → 401 pointing at the metadata.
  if (!mcpOriginAllowed(c)) return c.json({ error: { code: "forbidden", field: "", message: "Origin not allowed" } }, 403);
  if (!c.get("bearerUser")) {
    return c.json({ jsonrpc: "2.0", error: { code: -32001, message: "Authentication required" }, id: null }, 401, {
      "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl(c.env)}", scope="mcp"`,
    });
  }
  if (c.req.method === "POST") await rateLimit(c, "RL_MCP");
  return handleMcp(c.req.raw, { ctx: ctxOf(c, apiActor(c, "mcp")), lang: apiLang(c) });
});

app.all("/mcp", async (c) => {
  if (!mcpOriginAllowed(c)) return c.json({ error: { code: "forbidden", field: "", message: "Origin not allowed" } }, 403);
  if (c.get("bearerInvalid")) {
    return c.json({ jsonrpc: "2.0", error: { code: -32001, message: "Invalid or expired token" }, id: null }, 401, {
      "WWW-Authenticate": 'Bearer error="invalid_token"',
    });
  }
  if (c.req.method === "POST") await rateLimit(c, "RL_MCP");
  const actor = apiActor(c, "mcp");
  return handleMcp(c.req.raw, { ctx: ctxOf(c, actor), lang: apiLang(c) });
});

// ---------- routers ----------

app.route("/api/v1", api);
app.route("/", web);
