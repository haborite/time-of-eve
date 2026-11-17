/**
 * REST API /api/v1 (JSON). Same use cases as the web UI and MCP.
 *
 * Authentication
 *   Administrators: Authorization: Bearer sch_… (API token) or an OAuth access token; the web UI uses its session
 *   cookie + X-CSRF-Token.
 *   Organizers without an account: the poll's manage token — Authorization: Bearer <manage token> is NOT used
 *   (it would be confused with API tokens); send X-Manage-Token: <token>, or pass the manage_url.
 *   Participants: no authentication; editing one's own answer needs X-Edit-Token.
 * Errors: {error:{code, field, message, hint?}, errors?, warnings?, docs}.
 */
import { Hono } from "hono";
import { AppError } from "../domain/errors";
import { parseManageUrl } from "../domain/links";
import { findParticipant, participantSlots, pKey } from "../domain/model";
import * as svc from "../domain/service";
import { exportCsv, pollBrief, pollDetail, publicView, resultsView } from "../domain/views";
import { timingSafeEqual } from "../lib/crypto";
import * as uc from "../app/usecases";
import { apiActor, apiLang, ctxOf, rateLimit, readJson, type C, type HonoEnv } from "./context";

export const api = new Hono<HonoEnv>();

api.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Expose-Headers", "Link");
  if (c.req.method === "OPTIONS") {
    return c.body(null, 204, {
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Manage-Token, X-Edit-Token, X-UI-Lang",
      "Access-Control-Max-Age": "86400",
    });
  }
  // Cookie-authenticated (web UI) writes need the CSRF header; bearer/manage-token calls do not use cookies.
  const s = c.get("session");
  if (s && !c.req.header("authorization") && !["GET", "HEAD"].includes(c.req.method)) {
    if (!timingSafeEqual(c.req.header("x-csrf-token") ?? "", s.csrf)) throw new AppError("csrf_failed", 403);
  }
  if (!["GET", "HEAD"].includes(c.req.method)) await rateLimit(c, "RL_WRITE");
  await next();
});

function ctx(c: C) {
  return ctxOf(c, apiActor(c, "api"));
}

function ref(c: C): uc.PollRef {
  const pollId = c.req.param("id")!;
  let token = c.req.header("x-manage-token") ?? c.req.query("manage_token") ?? null;
  const fromUrl = parseManageUrl(c.req.header("x-manage-url") ?? "");
  if (!token && fromUrl?.pollId === pollId) token = fromUrl.token;
  return { pollId, manageToken: token };
}

// ---------- service info ----------

api.get("/", (c) => {
  const l = c.get("links");
  const s = c.get("settings");
  return c.json({
    name: "Time of EVE",
    description: "Scheduling polls for humans and AI agents",
    creation: s.creation_mode === "anyone" ? "anyone (no account needed; rate limited)" : "administrators only (API token)",
    authenticated_as: c.get("bearerUser")?.username ?? null,
    default_timezone: s.default_timezone,
    docs: l.url("/llms.txt"), openapi: l.url("/openapi.json"), mcp: l.url("/mcp"),
  });
});

// ---------- organizer ----------

api.post("/polls", async (c) => {
  const data = await readJson(c);
  const x = ctx(c);
  const dry = c.req.query("dry_run") === "1" || c.req.query("dry_run") === "true" || (data as { dry_run?: unknown })?.dry_run === true;
  if (dry) {
    if (!uc.canCreate(x)) throw new AppError("creation_disabled", 403);
    const { result } = uc.preview(x, data);
    return c.json(renderPreview(c, result));
  }
  if (x.actor.kind === "anonymous") await rateLimit(c, "RL_CREATE");
  const r = await uc.createPoll(x, data);
  return c.json(renderWarnings(c, await uc.createdResponse(x, r)), r.created ? 201 : 200);
});

api.get("/polls", async (c) => {
  const x = ctx(c);
  if (!uc.isAdmin(x)) throw new AppError("unauthorized", 401);
  const status = c.req.query("status");
  const mine = c.req.query("mine") !== "0";
  const rows = await x.store.list({ ownerUserId: mine && x.actor.kind === "admin" ? x.actor.user.id : undefined, status, limit: 100 });
  const l = x.links;
  return c.json({
    polls: await Promise.all(rows.map(async (r) => ({
      poll_id: r.id, title: r.title, status: r.status, candidate_count: r.candidateCount, responded: r.responded, version: r.version,
      public_url: l.publicUrl(r), manage_url: await l.manageUrl(r), hidden: r.hidden || undefined,
      created_at: new Date(r.createdAt).toISOString(),
    }))),
  });
});

api.get("/polls/:id", async (c) => {
  const x = ctx(c);
  return c.json(await pollDetail(await uc.openForOrganizer(x, ref(c)), x.links));
});

api.patch("/polls/:id", async (c) => {
  const data = await readJson(c);
  const x = ctx(c);
  const { agg, value } = await uc.organizerChange(x, ref(c), (agg) => svc.patch(agg, data));
  return c.json(renderWarnings(c, { ...(await pollDetail(agg, x.links)), warnings: value.warnings }));
});

api.delete("/polls/:id", async (c) => {
  const x = ctx(c);
  const agg = await uc.openForOrganizer(x, ref(c));
  await x.store.deletePoll(agg.poll.id, uc.actorLabel(x.actor));
  return c.json({ deleted: true, poll_id: agg.poll.id });
});

api.get("/polls/:id/results", async (c) => {
  const view = c.req.query("view") ?? "summary";
  if (view !== "summary" && view !== "full") throw new AppError("invalid_view", 400, "view");
  const x = ctx(c);
  return c.json(resultsView(await uc.openForOrganizer(x, ref(c)), view));
});

api.get("/polls/:id/export.csv", async (c) => {
  const x = ctx(c);
  const agg = await uc.openForOrganizer(x, ref(c));
  return c.body(exportCsv(agg, apiLang(c)), 200, {
    "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="poll-${agg.poll.id}.csv"`,
  });
});

const ACTIONS: Record<string, (agg: Parameters<typeof svc.close>[0], body: Record<string, unknown>) => unknown> = {
  close: (agg) => svc.close(agg),
  reopen: (agg, b) => svc.reopen(agg, svc.parseDeadlineArg(agg, b.response_deadline)),
  finalize: (agg, b) => {
    if (typeof b.candidate_id !== "string") throw new AppError("required", 400, "candidate_id");
    if (b.version != null && !Number.isInteger(b.version)) throw new AppError("invalid_type", 400, "version", { expected: "integer" });
    return svc.finalize(agg, b.candidate_id, b.version as number | undefined);
  },
  unfinalize: (agg) => svc.unfinalize(agg),
  cancel: (agg) => svc.cancel(agg),
  "rotate-manage-link": (agg) => svc.rotateManageLink(agg),
};

api.post("/polls/:id/:action{close|reopen|finalize|unfinalize|cancel|rotate-manage-link}", async (c) => {
  const body = (await readJson(c)) as Record<string, unknown>;
  const x = ctx(c);
  const action = c.req.param("action");
  const { agg } = await uc.organizerChange(x, ref(c), (agg) => ACTIONS[action](agg, body ?? {}));
  return c.json(await pollBrief(agg, x.links));
});

api.post("/polls/:id/participants/:pid/reissue-edit-link", async (c) => {
  const x = ctx(c);
  const pid = c.req.param("pid");
  const { agg, value: p } = await uc.organizerChange(x, ref(c), (agg) => svc.reissueEditLink(agg, pid));
  return c.json({
    participant_id: pKey(p.no), display_name: p.displayName, edit_url: await x.links.editUrl(agg.poll, p),
    note: "The old edit link no longer works. Give this link only to that participant.",
  });
});

// ---------- participants (no auth) ----------

function publicHeaders(c: C, publicId: string) {
  const l = c.get("links");
  c.header("Link", l.linkHeader({ publicId }));
}

api.get("/public/:pid", async (c) => {
  const x = ctx(c);
  const agg = await x.store.publicPoll(c.req.param("pid"));
  publicHeaders(c, agg.poll.publicId);
  return c.json(publicView(agg, x.links));
});

api.post("/public/:pid/responses", async (c) => {
  const data = await readJson(c);
  const x = ctx(c);
  const r = await uc.submitResponse(x, c.req.param("pid"), data);
  return c.json({ response_id: r.response_id, display_name: r.display_name, edit_token: r.edit_token, edit_url: r.edit_url }, 201);
});

api.get("/public/:pid/responses/:rid", async (c) => {
  const x = ctx(c);
  const { agg, p } = await uc.openOwnResponse(x, c.req.param("pid"), c.req.param("rid"), c.req.header("x-edit-token"));
  return c.json({ ...uc.ownResponseView(agg, p), slots: participantSlots(agg, p) });
});

api.patch("/public/:pid/responses/:rid", async (c) => {
  const data = (await readJson(c)) as Record<string, unknown>;
  const x = ctx(c);
  const replaceAll = data?.replace_all === true;
  if (data && typeof data === "object") delete data.replace_all;
  const { agg, p } = await uc.updateResponse(x, c.req.param("pid"), c.req.param("rid"), c.req.header("x-edit-token"), data, { replaceAll });
  return c.json({ updated: true, ...uc.ownResponseView(agg, findParticipant(agg, pKey(p.no))!) });
});

// ---------- helpers ----------

import { renderIssue, type Issue } from "../domain/errors";

function renderPreview(c: C, r: Record<string, unknown>) {
  const lang = apiLang(c);
  return { ...r, errors: (r.errors as Issue[]).map((e) => renderIssue(lang, e)), warnings: (r.warnings as Issue[]).map((e) => renderIssue(lang, e)) };
}

function renderWarnings<T extends { warnings: Issue[] }>(c: C, r: T) {
  const lang = apiLang(c);
  return { ...r, warnings: r.warnings.map((e) => renderIssue(lang, e)) };
}
