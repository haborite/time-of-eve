/** @jsxImportSource hono/jsx */
/**
 * HTML routes. Forms post back to the server (no SPA); CSRF: same-origin check on every form POST, plus the
 * session-bound token for administrator forms. Organizer pages without login are keyed by the manage URL itself.
 */
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { csrf as originCheck } from "hono/csrf";
import type { JSX } from "hono/jsx/jsx-runtime";
import * as uc from "../app/usecases";
import { AppError, message, renderIssue } from "../domain/errors";
import { effectiveStatus, findParticipant, type PollAggregate } from "../domain/model";
import * as svc from "../domain/service";
import { exportCsv, publicMarkdown, publicView } from "../domain/views";
import { LIMITS } from "../domain/input";
import { timingSafeEqual } from "../lib/crypto";
import { durLabel, isLang, LANG_COOKIE, t, type Lang } from "../lib/i18n";
import { fromLocal, isoLocal, isValidTimeZone, parseDate, parseTime } from "../lib/time";
import { cardFor, cardVersion, pollMeta, siteCard, siteMeta, STATIC_OG } from "../og/card";
import { renderPng } from "../og/render";
import { getSettings, sanitize, saveSettings } from "../repo/settings";
import * as users from "../repo/users";
import * as s from "../db/schema";
import { and, desc, eq } from "drizzle-orm";
import { DashboardPage, LoginPage, SettingsPage, TokensPage, type PollRowView } from "../views/admin";
import { ConfirmPage, NewPage, type PreviewData } from "../views/create";
import { makeView, type View } from "../views/layout";
import { ManagePage } from "../views/manage";
import { PublicPage } from "../views/public";
import { AboutPage, ErrorPage, HomePage, PrivacyPage, TermsPage } from "../views/site";
import { clientIp, ctxOf, isHttps, origin, rateLimit, SESSION_COOKIE, webActor, type C, type HonoEnv } from "./context";

export const web = new Hono<HonoEnv>();

// Same-origin check for form posts (Origin header). The MCP/API routers are mounted separately.
web.use("*", async (c, next) => originCheck({ origin: origin(c.env) })(c, next));

export function view(c: C): View {
  const sess = c.get("session");
  const url = new URL(c.req.url);
  return makeView(c.get("lang"), url.pathname + url.search, sess ? { username: sess.user.username, csrf: sess.csrf } : null,
    !!sess || c.get("settings").creation_mode === "anyone");
}

function html(c: C, node: JSX.Element, status = 200) {
  return c.html(node as unknown as string, status as 200);
}

export async function errorPage(c: C, status: number, code: string, msg?: string) {
  const v = view(c);
  return html(c, <ErrorPage v={v} meta={await siteMeta(v.lang, c.get("links"), "/")} status={status} code={code} message={msg ?? message(v.lang, code)} />, status);
}

function checkCsrf(c: C, token: unknown) {
  const sess = c.get("session");
  if (!sess || typeof token !== "string" || !timingSafeEqual(token, sess.csrf)) throw new AppError("csrf_failed", 403);
}

function requireAdmin(c: C): Response | null {
  const sess = c.get("session");
  if (!sess) {
    const url = new URL(c.req.url);
    return c.redirect(`/admin/login?next=${encodeURIComponent(url.pathname + url.search)}`, 303);
  }
  return null;
}

function safeNext(next: unknown, fallback: string) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : fallback;
}

// ---------- language / misc ----------

web.get("/lang/:code", (c) => {
  const code = c.req.param("code");
  const dest = safeNext(c.req.query("next"), "/");
  if (isLang(code)) setCookie(c, LANG_COOKIE, code, { path: "/", maxAge: 365 * 86400, sameSite: "Lax", secure: isHttps(c.env) });
  return c.redirect(dest, 303);
});

web.get("/", async (c) => {
  const v = view(c);
  const l = c.get("links");
  return html(c, <HomePage v={v} meta={await siteMeta(v.lang, l, "/")} settings={c.get("settings")} mcpUrl={l.url("/mcp")} llmsUrl={l.url("/llms.txt")} />);
});

web.get("/about", async (c) => {
  const v = view(c);
  return html(c, <AboutPage v={v} meta={await siteMeta(v.lang, c.get("links"), "/about", t(v.lang, "このサイトについて"))} settings={c.get("settings")} />);
});
web.get("/terms", async (c) => {
  const v = view(c);
  return html(c, <TermsPage v={v} meta={await siteMeta(v.lang, c.get("links"), "/terms", t(v.lang, "利用規約"))} settings={c.get("settings")} />);
});
web.get("/privacy", async (c) => {
  const v = view(c);
  return html(c, <PrivacyPage v={v} meta={await siteMeta(v.lang, c.get("links"), "/privacy", t(v.lang, "プライバシーポリシー"))} settings={c.get("settings")} />);
});

// ---------- public answer page ----------

const AI_AGENT_UA = /ChatGPT-User|GPTBot|OAI-SearchBot|ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai|PerplexityBot|Perplexity-User|Google-Extended|Gemini|cohere-ai|MistralAI-User|DuckAssistBot|meta-externalagent|Amazonbot|Bytespider|CCBot|YouBot|AI2Bot|Diffbot/i;

/** html / json / markdown for /p/<id>: ?view=, then Accept, then known AI-agent User-Agents (not link-preview bots). */
function wants(c: C): "html" | "json" | "markdown" {
  const q = c.req.query("view");
  if (q === "html" || q === "json" || q === "markdown") return q;
  const accept = (c.req.header("accept") ?? "").toLowerCase();
  if (!accept.includes("text/html")) {
    if (accept.includes("application/json")) return "json";
    if (/text\/(markdown|x-markdown|plain)/.test(accept)) return "markdown";
  }
  return AI_AGENT_UA.test(c.req.header("user-agent") ?? "") ? "markdown" : "html";
}

web.get("/p/:file", async (c) => {
  const file = c.req.param("file");
  const m = /^([A-Za-z0-9_-]{8,64})(\.md|\.json)?$/.exec(file);
  if (!m) return errorPage(c, 404, "poll_not_found");
  const agg = await c.get("store").publicPoll(m[1]);
  const l = c.get("links");
  const want = m[2] === ".md" ? "markdown" : m[2] === ".json" ? "json" : wants(c);
  c.header("Link", l.linkHeader(agg.poll));
  c.header("Vary", "Accept, User-Agent, Cookie, Accept-Language");
  c.header("Cache-Control", "no-store");
  if (want === "markdown") return c.body(publicMarkdown(agg, l), 200, { "Content-Type": "text/markdown; charset=utf-8" });
  if (want === "json") return c.json(publicView(agg, l));
  const v = view(c);
  return html(c, <PublicPage v={v} agg={agg} links={l} meta={await pollMeta(agg, v.lang, l)} />);
});

// ---------- share images ----------

async function ogResponse(c: C, card: ReturnType<typeof siteCard>) {
  const version = await cardVersion(card);
  const v = c.req.query("v");
  const cc = v === version ? "public, max-age=86400, immutable" : "public, max-age=600";
  const etag = `"${version}"`;
  if (c.req.header("if-none-match") === etag) return c.body(null, 304, { ETag: etag, "Cache-Control": cc });
  const cache = await caches.open("og-images");
  const key = new Request(c.get("links").url(`/og/cache/${card.lang}/${version}.png`));
  const hit = await cache.match(key);
  if (hit) return new Response(hit.body, { headers: { "Content-Type": "image/png", ETag: etag, "Cache-Control": cc } });
  try {
    const png = await renderPng(card);
    c.executionCtx.waitUntil(cache.put(key, new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=2592000" } })));
    return c.body(png as unknown as ArrayBuffer, 200, { "Content-Type": "image/png", ETag: etag, "Cache-Control": cc });
  } catch (e) {
    console.error("og render failed", e);
    return c.redirect(STATIC_OG, 302);
  }
}

function ogLang(c: C): Lang {
  const q = c.req.query("lang");
  return isLang(q) ? q : c.get("lang");
}

// Dynamic images off (default): old image URLs in link-preview caches get the static image, without touching D1.
web.use("/og/*", async (c, next) => (c.get("settings").og_dynamic ? next() : c.redirect(STATIC_OG, 302)));

web.get("/og/default.png", (c) => ogResponse(c, siteCard(ogLang(c))));

web.get("/og/p/:file", async (c) => {
  const m = /^([A-Za-z0-9_-]{8,64})\.png$/.exec(c.req.param("file"));
  if (!m) return errorPage(c, 404, "poll_not_found");
  const agg = await c.get("store").publicPoll(m[1]);
  return ogResponse(c, cardFor(agg, ogLang(c)));
});

// ---------- create ----------

const SAMPLE = JSON.stringify({
  title: "研究打合せ 日程調整", description: "オンライン（Zoom）。各候補1時間。", timezone: "Asia/Tokyo", duration_minutes: 60,
  candidate_ranges: [{ from_date: "2027-01-12", to_date: "2027-01-16", weekdays: ["tue", "thu"], start_time: "13:00", end_time: "17:00" }],
  candidates: [{ start: "2027-01-15T10:00" }],
  response_deadline: "2027-01-10T23:59", show_participant_names: true,
  participants: [{ display_name: "Aさん", required: true }, { display_name: "Bさん" }],
}, null, 2);

function denyCreate(c: C) {
  return errorPage(c, 403, "creation_disabled");
}

web.get("/new", async (c) => {
  const v = view(c);
  if (!v.canCreate) return denyCreate(c);
  return html(c, <NewPage v={v} meta={await siteMeta(v.lang, c.get("links"), "/new", t(v.lang, "日程をえらぶ"))}
    maxCandidates={LIMITS.maxCandidates} defaultTz={c.get("settings").default_timezone} durLabel={(m) => durLabel(v.lang, m)} />);
});

async function confirmPage(c: C, o: { raw: string; fromNew: boolean; result?: PreviewData | null; parseError?: string | null }, status = 200) {
  const v = view(c);
  const sess = c.get("session");
  const tpls = sess ? await c.get("db").select({ id: s.templates.id, name: s.templates.name }).from(s.templates)
    .where(eq(s.templates.ownerUserId, sess.user.id)).orderBy(desc(s.templates.id)) : [];
  return html(c, <ConfirmPage v={v} meta={await siteMeta(v.lang, c.get("links"), "/new/import")} raw={o.raw} fromNew={o.fromNew}
    result={o.result} parseError={o.parseError} templates={tpls} sample={SAMPLE}
    turnstileSiteKey={!sess && c.env.TURNSTILE_SITE_KEY ? c.env.TURNSTILE_SITE_KEY : null} />, status);
}

web.get("/new/import", async (c) => {
  if (!view(c).canCreate) return denyCreate(c);
  let raw = "";
  const sess = c.get("session");
  const tid = Number(c.req.query("template"));
  if (sess && Number.isInteger(tid) && tid > 0) {
    const r = await c.get("db").select().from(s.templates).where(and(eq(s.templates.id, tid), eq(s.templates.ownerUserId, sess.user.id))).limit(1);
    raw = r[0]?.body ?? "";
  }
  return confirmPage(c, { raw, fromNew: false });
});

async function verifyTurnstile(c: C, token: unknown): Promise<boolean> {
  const secret = c.env.TURNSTILE_SECRET_KEY;
  if (!secret) return c.env.ENVIRONMENT === "local"; // not configured: only acceptable in local development
  if (typeof token !== "string" || !token) return false;
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  body.append("remoteip", clientIp(c));
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const j = (await r.json()) as { success?: boolean };
    return j.success === true;
  } catch {
    return false;
  }
}

web.post("/new/confirm", async (c) => {
  const v = view(c);
  if (!v.canCreate) return denyCreate(c);
  const form = await c.req.parseBody();
  const sess = c.get("session");
  if (sess) checkCsrf(c, form.csrf);
  const raw = String(form.json_text ?? "");
  const fromNew = form.from_new === "1";
  const action = String(form.action ?? "validate");
  if (raw.length > LIMITS.maxBodyBytes) return confirmPage(c, { raw: "", fromNew, parseError: t(v.lang, "JSONが大きすぎます") }, 413);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return confirmPage(c, { raw, fromNew, parseError: t(v.lang, "JSONの構文エラー: {msg}", { msg: String((e as Error).message).slice(0, 200) }) }, 400);
  }
  const ctx = ctxOf(c, webActor(c));
  const pv = uc.preview(ctx, data);
  const render = (extra: Partial<PreviewData> = {}, status = 200) => confirmPage(c, {
    raw, fromNew,
    result: {
      valid: !!pv.norm, preview: pv.result.preview as PreviewData["preview"],
      errors: pv.issues.errors.map((e) => renderIssue(v.lang, e)), warnings: pv.issues.warnings.map((e) => renderIssue(v.lang, e)), ...extra,
    },
  }, status);
  if (!(action === "create" || action === "publish") || !pv.norm) return render();
  if (action === "publish" && form.confirm_publish !== "1") {
    return render({ errors: [{ code: "confirm_required", field: "", message: t(v.lang, "公開するには「内容を確認しました」にチェックしてください") }] });
  }
  if (!sess) {
    await rateLimit(c, "RL_CREATE");
    if (!(await verifyTurnstile(c, form["cf-turnstile-response"]))) {
      return render({ errors: [renderIssue(v.lang, { code: "turnstile_failed", field: "" })] }, 400);
    }
  }
  try {
    const r = await uc.createPoll(ctx, data, { publish: action === "publish" });
    const flag = r.created ? "created" : "existing";
    if (sess) return c.redirect(`/admin/polls/${r.agg.poll.id}?done=${flag}`, 303);
    return c.redirect(`${new URL(await ctx.links.manageUrl(r.agg.poll)).pathname}?done=${flag}`, 303);
  } catch (e) {
    if (e instanceof AppError) return render({ valid: false, errors: [renderIssue(v.lang, { code: e.code, field: e.field, params: e.params })] }, e.status);
    throw e;
  }
});

// ---------- organizer page (manage URL or admin) ----------

const DONE: Record<string, string> = {
  created: "作成しました。", existing: "同じ client_request_id の日程調整が既にあるため、既存のページを表示しています（重複作成なし）。",
  publish: "公開しました", close: "締め切りました", reopen: "回答受付を再開しました", finalize: "日程を確定しました",
  unfinalize: "確定を取り消しました", cancel: "中止しました", add_candidate: "候補を追加しました", remove_candidate: "候補を削除しました（既存回答は保持）",
  add_participant: "参加予定者を追加しました", toggle_required: "必須設定を変更しました", toggle_names: "回答者名の公開設定を変更しました",
  set_deadline: "回答期限を変更しました", save_template: "テンプレートとして保存しました", rotate_manage_link: "管理用URLを作り直しました。新しいURLを保存してください。",
  hide: "非公開にしました", unhide: "公開に戻しました", deleted: "削除しました",
};

async function renderManage(c: C, agg: PollAggregate, base: string, o: { error?: string | null; reissued?: { name: string; url: string } | null; status?: number } = {}) {
  const v = view(c);
  const l = c.get("links");
  const isAdmin = !!c.get("session") && base.startsWith("/admin/");
  const done = c.req.query("done");
  const audits = await c.get("store").audits(agg.poll.id);
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cache-Control", "no-store");
  return html(c, <ManagePage v={v} agg={agg} meta={await siteMeta(v.lang, l, "/")} basePath={base} publicUrl={l.publicUrl(agg.poll)}
    manageUrl={await l.manageUrl(agg.poll)} isAdmin={isAdmin} csrf={isAdmin ? c.get("session")!.csrf : undefined}
    flash={done && DONE[done] ? t(v.lang, DONE[done]) : null} error={o.error} reissued={o.reissued} audits={audits}
    justCreated={done === "created" || done === "existing"} />, o.status ?? 200);
}

function localInput(agg: PollAggregate, date: string, time: string): number {
  const d = parseDate(date), tm = parseTime(time);
  if (!d || !tm) throw new AppError("invalid_datetime", 400, "", { value: `${date} ${time}`.slice(0, 40) });
  const r = fromLocal(agg.poll.timezone, d.y, d.mo, d.d, tm.h % 24, tm.mi);
  if (!r.ok) throw new AppError("nonexistent_local_time", 400, "", { value: `${date} ${time}`, tz: agg.poll.timezone });
  return r.ms + (tm.h === 24 ? 86400e3 : 0);
}

async function manageAction(c: C, ref: uc.PollRef, base: string) {
  const form = await c.req.parseBody();
  const isAdmin = base.startsWith("/admin/");
  if (isAdmin) checkCsrf(c, form.csrf);
  const ctx = ctxOf(c, isAdmin ? webActor(c) : { kind: "anonymous", via: "web" });
  const action = String(form.action ?? "");
  const version = form.version ? Number(form.version) : undefined;
  const str = (k: string) => String(form[k] ?? "");
  try {
    if (action === "delete") {
      const agg = await uc.openForOrganizer(ctx, ref);
      await ctx.store.deletePoll(agg.poll.id, uc.actorLabel(ctx.actor));
      return c.redirect(isAdmin ? "/admin?done=deleted" : "/?deleted=1", 303);
    }
    if (action === "save_template") {
      if (!isAdmin) throw new AppError("forbidden", 403);
      const agg = await uc.openForOrganizer(ctx, ref);
      const p = agg.poll;
      const body = {
        title: p.title, description: p.description, timezone: p.timezone, duration_minutes: p.durationMinutes ?? undefined,
        allow_maybe: p.allowMaybe, show_participant_names: p.showParticipantNames, candidates: [],
        participants: agg.participants.filter((x) => x.preregistered).map((x) => ({ display_name: x.displayName, required: x.required })),
      };
      const sess = c.get("session")!;
      await ctx.store.d.insert(s.templates).values({ ownerUserId: sess.user.id, name: str("template_name").trim().slice(0, 100) || p.title.slice(0, 100), body: JSON.stringify(body, null, 2) });
      return c.redirect(`${base}?done=save_template`, 303);
    }
    if (action === "reissue_token") {
      const { agg, value: p } = await uc.organizerChange(ctx, ref, (agg) => svc.reissueEditLink(agg, str("participant_id")));
      return renderManage(c, agg, base, { reissued: { name: p.displayName, url: await ctx.links.editUrl(agg.poll, p) } });
    }
    const { agg } = await uc.organizerChange(ctx, ref, (agg) => {
      switch (action) {
        case "publish": return svc.publish(agg);
        case "close": return svc.close(agg);
        case "reopen": return svc.reopen(agg, null);
        case "finalize": return svc.finalize(agg, str("candidate_id"), version);
        case "unfinalize": return svc.unfinalize(agg);
        case "cancel": return svc.cancel(agg);
        case "rotate_manage_link": return svc.rotateManageLink(agg);
        case "hide": case "unhide":
          if (!isAdmin) throw new AppError("forbidden", 403);
          return svc.setHidden(agg, action === "hide");
        case "add_candidate": {
          const st = localInput(agg, str("start_date"), str("start_time"));
          const en = str("end_time") ? localInput(agg, str("start_date"), str("end_time")) : st + (agg.poll.durationMinutes ?? 60) * 60000;
          const tz = agg.poll.timezone;
          return svc.patch(agg, { add_candidates: [{ start: isoLocal(st, tz), end: isoLocal(en, tz), allow_duration_mismatch: true }], version });
        }
        case "remove_candidate": return svc.patch(agg, { remove_candidate_ids: [str("candidate_id")], version });
        case "add_participant": return svc.patch(agg, { add_participants: [{ display_name: str("display_name"), required: form.required === "1" }], version });
        case "toggle_required": {
          const p = findParticipant(agg, str("participant_id"));
          if (!p) throw new AppError("participant_not_found", 404, "participant_id", { id: str("participant_id").slice(0, 20) });
          return svc.patch(agg, { set_required: { [str("participant_id")]: !p.required }, version });
        }
        case "toggle_names": return svc.patch(agg, { show_participant_names: !agg.poll.showParticipantNames, version });
        case "set_deadline": {
          const dl = str("deadline");
          return svc.patch(agg, { response_deadline: dl ? dl : null, version });
        }
        default: throw new AppError("unknown_action", 400);
      }
    });
    if (action === "rotate_manage_link" && !isAdmin) {
      return c.redirect(`${new URL(await ctx.links.manageUrl(agg.poll)).pathname}?done=rotate_manage_link`, 303);
    }
    return c.redirect(`${base}?done=${action}`, 303);
  } catch (e) {
    if (!(e instanceof AppError) || e.status >= 500) throw e;
    if (e.code === "poll_not_found" || e.code === "invalid_manage_token" || e.code === "unauthorized") throw e;
    const lang = c.get("lang");
    const detail = (e.errors ?? []).map((x) => `${x.field}: ${renderIssue(lang, x).message}`).join("; ");
    const agg = await uc.openForOrganizer(ctx, ref);
    return renderManage(c, agg, base, { error: message(lang, e.code, e.params) + (detail ? `（${detail}）` : ""), status: e.status });
  }
}

async function manageGet(c: C, ref: uc.PollRef, base: string) {
  const ctx = ctxOf(c, base.startsWith("/admin/") ? webActor(c) : { kind: "anonymous", via: "web" });
  return renderManage(c, await uc.openForOrganizer(ctx, ref), base);
}

web.get("/m/:id/:token", (c) => manageGet(c, { pollId: c.req.param("id"), manageToken: c.req.param("token") }, `/m/${c.req.param("id")}/${c.req.param("token")}`));
web.post("/m/:id/:token/action", (c) => manageAction(c, { pollId: c.req.param("id"), manageToken: c.req.param("token") }, `/m/${c.req.param("id")}/${c.req.param("token")}`));
web.get("/m/:id/:token/export.csv", async (c) => {
  const ctx = ctxOf(c, { kind: "anonymous", via: "web" });
  const agg = await uc.openForOrganizer(ctx, { pollId: c.req.param("id"), manageToken: c.req.param("token") });
  return csv(c, agg);
});

function csv(c: C, agg: PollAggregate) {
  return c.body(exportCsv(agg, c.get("lang")), 200, {
    "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="poll-${agg.poll.id}.csv"`, "Cache-Control": "no-store",
  });
}

// ---------- administrators ----------

web.get("/admin/login", async (c) => {
  if (c.get("session")) return c.redirect("/admin", 303);
  const v = view(c);
  return html(c, <LoginPage v={v} meta={await siteMeta(v.lang, c.get("links"), "/admin/login")} next={safeNext(c.req.query("next"), "/admin")} />);
});

web.post("/admin/login", async (c) => {
  const v = view(c);
  const form = await c.req.parseBody();
  const username = String(form.username ?? "").slice(0, 64), password = String(form.password ?? "").slice(0, 1024);
  const next = safeNext(form.next, "/admin");
  const d = c.get("db");
  const ipKey = `ip:${clientIp(c)}`, userKey = `user:${username.toLowerCase()}`;
  const meta = await siteMeta(v.lang, c.get("links"), "/admin/login");
  if ((await users.loginBlocked(d, ipKey)) || (await users.loginBlocked(d, userKey))) {
    return html(c, <LoginPage v={v} meta={meta} next={next} error={message(v.lang, "login_limited")} />, 429);
  }
  const u = await users.checkLogin(d, username, password);
  if (!u) {
    await Promise.all([users.recordLoginFailure(d, ipKey), users.recordLoginFailure(d, userKey)]);
    return html(c, <LoginPage v={v} meta={meta} next={next} error={message(v.lang, "login_failed")} />, 401);
  }
  await users.clearLoginFailures(d, userKey);
  const sess = await users.createSession(d, c.env.SECRET_KEY, u.id);
  await d.insert(s.auditLogs).values({ actor: `web:${u.username}`, action: "login", detail: "{}" });
  setCookie(c, SESSION_COOKIE, sess.token, { httpOnly: true, secure: isHttps(c.env), sameSite: "Lax", path: "/", maxAge: users.SESSION_HOURS * 3600 });
  return c.redirect(next, 303);
});

web.post("/admin/logout", async (c) => {
  const form = await c.req.parseBody();
  if (c.get("session")) {
    checkCsrf(c, form.csrf);
    await users.deleteSession(c.get("db"), c.env.SECRET_KEY, getCookie(c, SESSION_COOKIE) ?? "");
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.redirect("/admin/login", 303);
});

web.get("/admin", async (c) => {
  const r = requireAdmin(c);
  if (r) return r;
  const v = view(c);
  const sess = c.get("session")!;
  const filter = ["mine", "all", "anonymous"].includes(c.req.query("filter") ?? "") ? c.req.query("filter")! : "all";
  const q = (c.req.query("q") ?? "").slice(0, 100);
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const per = 50;
  const rows = await c.get("store").list({
    ownerUserId: filter === "mine" ? sess.user.id : undefined, anonymousOnly: filter === "anonymous", q: q || undefined, limit: per + 1, offset: (page - 1) * per,
  });
  const names = new Map((await users.listUsers(c.get("db"))).map((u) => [u.id, u.username]));
  const polls: PollRowView[] = rows.slice(0, per).map((p) => ({
    ...p, effectiveStatus: effectiveStatus({ status: p.status, responseDeadline: p.responseDeadline } as never),
    owner: p.ownerUserId != null ? names.get(p.ownerUserId) ?? `#${p.ownerUserId}` : t(v.lang, "ログインなし"),
  }));
  const done = c.req.query("done");
  return html(c, <DashboardPage v={v} meta={await siteMeta(v.lang, c.get("links"), "/admin")} polls={polls} filter={filter} q={q} page={page}
    hasNext={rows.length > per} flash={done && DONE[done] ? t(v.lang, DONE[done]) : null} />);
});

web.get("/admin/polls/:id", async (c) => requireAdmin(c) ?? await manageGet(c, { pollId: c.req.param("id") }, `/admin/polls/${c.req.param("id")}`));
web.post("/admin/polls/:id/action", async (c) => requireAdmin(c) ?? await manageAction(c, { pollId: c.req.param("id") }, `/admin/polls/${c.req.param("id")}`));
web.get("/admin/polls/:id/export.csv", async (c) => {
  const r = requireAdmin(c);
  if (r) return r;
  return csv(c, await uc.openForOrganizer(ctxOf(c, webActor(c)), { pollId: c.req.param("id") }));
});

async function settingsPage(c: C, o: { flash?: string | null; error?: string | null } = {}, status = 200) {
  const v = view(c);
  return html(c, <SettingsPage v={v} meta={await siteMeta(v.lang, c.get("links"), "/admin/settings")} settings={await getSettings(c.get("db"))}
    users={await users.listUsers(c.get("db"))} me={c.get("session")!.user.id} flash={o.flash} error={o.error} />, status);
}

web.get("/admin/settings", async (c) => requireAdmin(c) ?? await settingsPage(c));

web.post("/admin/settings", async (c) => {
  const r = requireAdmin(c);
  if (r) return r;
  const form = await c.req.parseBody();
  checkCsrf(c, form.csrf);
  const lang = c.get("lang");
  const d = c.get("db");
  const sess = c.get("session")!;
  const action = String(form.action ?? "");
  const audit = (act: string, detail: Record<string, unknown>) => d.insert(s.auditLogs).values({ actor: `web:${sess.user.username}`, action: act, detail: JSON.stringify(detail) });
  if (action === "save") {
    if (form.default_timezone && !isValidTimeZone(String(form.default_timezone))) return settingsPage(c, { error: message(lang, "invalid_timezone") }, 400);
    const next = sanitize({ ...(await getSettings(d)), ...form, retention_days: Number(form.retention_days), og_dynamic: form.og_dynamic === "on" });
    await saveSettings(d, next);
    await audit("settings", { creation_mode: next.creation_mode, retention_days: next.retention_days, og_dynamic: next.og_dynamic });
    c.set("settings", next);
    return settingsPage(c, { flash: t(lang, "保存しました") });
  }
  if (action === "add_user") {
    const username = String(form.username ?? "").trim(), password = String(form.password ?? "");
    if (!/^[A-Za-z0-9._-]{2,64}$/.test(username) || password.length < 12) return settingsPage(c, { error: t(lang, "ユーザー名は英数字と . _ - の2～64文字、パスワードは12文字以上にしてください") }, 400);
    try {
      await users.createUser(d, username, password);
    } catch {
      return settingsPage(c, { error: t(lang, "そのユーザー名は既に使われています") }, 409);
    }
    await audit("add_user", { username });
    return settingsPage(c, { flash: t(lang, "管理者を追加しました") });
  }
  if (action === "disable_user" || action === "enable_user") {
    const id = Number(form.user_id);
    if (id === sess.user.id) return settingsPage(c, { error: message(lang, "forbidden") }, 400);
    await users.setDisabled(d, id, action === "disable_user");
    await audit(action, { user_id: id });
    return settingsPage(c, { flash: t(lang, "更新しました") });
  }
  if (action === "change_password") {
    const ok = await users.checkLogin(d, sess.user.username, String(form.current ?? ""));
    const pw = String(form.password ?? "");
    if (!ok) return settingsPage(c, { error: message(lang, "login_failed") }, 400);
    if (pw.length < 12) return settingsPage(c, { error: t(lang, "パスワードは12文字以上にしてください") }, 400);
    await users.setPassword(d, sess.user.id, pw);
    await audit("change_password", {});
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.redirect("/admin/login", 303);
  }
  throw new AppError("unknown_action", 400);
});

async function tokensPage(c: C, newToken: string | null = null) {
  const v = view(c);
  const sess = c.get("session")!;
  return html(c, <TokensPage v={v} meta={await siteMeta(v.lang, c.get("links"), "/admin/tokens")} tokens={await users.listApiTokens(c.get("db"), sess.user.id)}
    newToken={newToken} mcpUrl={c.get("links").url("/mcp")} />);
}

web.get("/admin/tokens", async (c) => requireAdmin(c) ?? await tokensPage(c));

web.post("/admin/tokens", async (c) => {
  const r = requireAdmin(c);
  if (r) return r;
  const form = await c.req.parseBody();
  checkCsrf(c, form.csrf);
  const sess = c.get("session")!;
  const d = c.get("db");
  if (form.action === "create") {
    const token = await users.createApiToken(d, c.env.SECRET_KEY, sess.user.id, String(form.name ?? ""));
    await d.insert(s.auditLogs).values({ actor: `web:${sess.user.username}`, action: "api_token_create", detail: JSON.stringify({ name: String(form.name ?? "").slice(0, 100) }) });
    c.header("Cache-Control", "no-store");
    return tokensPage(c, token);
  }
  if (form.action === "revoke") await users.revokeApiToken(d, sess.user.id, Number(form.token_id));
  return c.redirect("/admin/tokens", 303);
});

