/**
 * MCP server at /mcp — Streamable HTTP, stateless (a fresh server per request, JSON responses, no sessions).
 * Every tool calls the same use cases as the web UI and REST API.
 *
 * Who can do what
 *  - Participants: no credentials. get_public_poll → submit_response → (edit_url) get_my_response / update_my_response.
 *  - Organizers: create_poll returns manage_url — the organizer's key. Every organizer tool takes `poll` =
 *    that manage_url. Administrators (API token "sch_…" or OAuth) may pass a poll_id instead and can list polls.
 *  - create_poll is offered when the site lets anyone create, or the caller is an administrator.
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { z } from "zod";
import * as uc from "../app/usecases";
import { AppError, renderIssue } from "../domain/errors";
import { PollInputShape } from "../domain/input";
import { parseEditUrl, parseManageUrl, parsePublicRef } from "../domain/links";
import { cKey, findCandidate, pKey } from "../domain/model";
import * as svc from "../domain/service";
import { pollBrief, pollDetail, publicMarkdown, publicView, resultsView } from "../domain/views";
import type { Lang } from "../lib/i18n";
import { isoLocal } from "../lib/time";
import { guide, pollJsonSchema } from "../docs/docs";

export interface McpContext {
  ctx: uc.Ctx;
  lang: Lang;
}

type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

function ok(value: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

function fail(lang: Lang, e: unknown): ToolResult {
  if (e instanceof AppError) {
    const body = e.render(lang);
    return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }], structuredContent: body, isError: true };
  }
  console.error("mcp tool error", e);
  const body = { error: renderIssue(lang, { code: "internal_error", field: "" }) };
  return { content: [{ type: "text", text: JSON.stringify(body) }], isError: true };
}

const PUBLIC_REF = z.string().describe("The poll's share URL (…/p/<id>) or its public id");
const ORGANIZER_REF = z.string().describe("manage_url returned by create_poll (…/m/<poll_id>/<token>). Administrators may pass a poll_id.");
const EDIT_URL = z.string().describe("edit_url returned by submit_response (…/p/<id>#edit=p3.<token>)");
const VERSION = z.number().int().optional().describe("version from your last read; fails with version_conflict if the poll changed meanwhile");
const ANSWERS = z.record(z.string(), z.enum(["yes", "maybe", "no"]).nullable())
  .describe("Candidate id → \"yes\" | \"maybe\" | \"no\" (maybe only if allowed). Omitted = unanswered; null clears (update only). E.g. {\"c1\":\"yes\",\"c3\":\"no\"}");

function organizerRef(ctx: uc.Ctx, v: string): uc.PollRef {
  const m = parseManageUrl(v);
  if (m) return { pollId: m.pollId, manageToken: m.token };
  const id = v.trim();
  if (/^[0-9A-Z]{26}$/.test(id)) {
    if (!uc.isAdmin(ctx)) throw new AppError("invalid_manage_token", 403, "poll");
    return { pollId: id };
  }
  throw new AppError("invalid_poll_reference", 400, "poll");
}

function publicRef(v: string): string {
  const id = parsePublicRef(v);
  if (!id) throw new AppError("invalid_poll_reference", 400, "poll");
  return id;
}

function editRef(v: string) {
  const r = parseEditUrl(v);
  if (!r) throw new AppError("invalid_edit_token", 400, "edit_url");
  return r;
}

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

export function instructions(m: McpContext): string {
  const { ctx } = m;
  const base = ctx.links.url();
  const create = uc.canCreate(ctx);
  const s = [
    `Time of EVE: scheduling polls (日程調整) at ${base}. The server validates, counts and ranks; never tally answers yourself.`,
    "",
    "PARTICIPANT (no token): when someone gives you a poll link (…/p/<id>) and asks you to answer for them: get_public_poll → work out their availability for each candidate id (ask them, or read their calendar with permission; never guess) → submit_response with their own name (or participant_id if they are in preregistered_pending) → give them the returned edit_url privately. Later: update_my_response with that edit_url.",
    "",
  ];
  if (create) {
    s.push(
      "ORGANIZER: confirm title, length, time zone, date range, participants and constraints with the user → create_poll with dry_run=true to check and show the user → create_poll when the user agrees (it opens for answers immediately; there are no drafts) → give the user public_url (to send to participants) and manage_url (the organizer's private key: keep it, it is needed for every later step; never post it publicly).",
      "Prefer local times without offset (\"2026-12-01T13:00\") with `timezone`, and candidate_ranges for windows (\"weekdays 13:00–17:00 next week\") — the server turns them into slots of duration_minutes starting every 30 minutes and handles DST.",
      "Then: get_results (best_candidate_ids, pending_names) → finalize_poll after the user chooses.",
    );
  } else {
    s.push("ORGANIZER: creating polls on this site needs an administrator (API token `Authorization: Bearer sch_…` or OAuth). Tools that take `poll` still work with a manage_url you were given.");
  }
  if (uc.isAdmin(ctx)) s.push("", `Authenticated as administrator ${ctx.actor.kind === "admin" ? ctx.actor.user.username : ""}: list_polls is available and poll_id is accepted where a manage_url is expected.`);
  s.push("", "Errors come back as tool results {error:{code, field, message, hint}} (+ errors[] for validation). Fix the named field and retry. Full guide: get_guide or resource time-of-eve://docs/guide.");
  return s.join("\n");
}

export function buildServer(m: McpContext): McpServer {
  const { ctx, lang } = m;
  const server = new McpServer(
    { name: "time-of-eve", title: "Time of EVE — scheduling polls for humans and AI", version: "1.0.0" },
    { instructions: instructions(m), jsonSchemaValidator: new CfWorkerJsonSchemaValidator(), capabilities: { tools: {}, resources: {}, prompts: {} } },
  );
  const run = async (fn: () => Promise<Record<string, unknown>>): Promise<ToolResult> => {
    try {
      return ok(await fn());
    } catch (e) {
      return fail(lang, e);
    }
  };
  const warnings = (w: { code: string; field: string }[]) => w.map((x) => renderIssue(lang, x));

  // ---------- participants ----------

  server.registerTool("get_public_poll", {
    title: "Read a scheduling poll",
    description: "Read a poll from its share URL: title, description, status, deadline, answer options, candidates (id, start, end, current yes/maybe/no counts), server ranking (best_candidate_ids), finalized candidate, invited people who have not answered (preregistered_pending) and — if the organizer made names public — others' answers. No authentication. Use before submit_response.",
    inputSchema: { poll: PUBLIC_REF },
    annotations: RO,
  }, ({ poll }) => run(async () => publicView(await ctx.store.publicPoll(publicRef(poll)), ctx.links) as unknown as Record<string, unknown>));

  server.registerTool("submit_response", {
    title: "Answer a poll",
    description: "Record ONE participant's availability. Only when that person explicitly asked you to answer for them, under their own name, with availability they gave you (or that you read from their calendar with permission). Never guess, never answer for someone else. If the person is in preregistered_pending, pass participant_id instead of display_name. Returns edit_url: secret, give it only to that person.",
    inputSchema: {
      poll: PUBLIC_REF,
      display_name: z.string().max(100).optional().describe("The participant's own name (not needed with participant_id)"),
      participant_id: z.string().optional().describe("e.g. \"p2\" from preregistered_pending"),
      answers: ANSWERS,
      comment: z.string().max(500).optional(),
    },
    annotations: RW,
  }, (a) => run(async () => {
    const data: Record<string, unknown> = { answers: a.answers };
    if (a.participant_id) data.participant_id = a.participant_id;
    else if (a.display_name) data.display_name = a.display_name;
    if (a.comment != null) data.comment = a.comment;
    const r = await uc.submitResponse(ctx, publicRef(a.poll), data);
    const view = uc.ownResponseView(r.agg, r.participant);
    return {
      response_id: r.response_id, display_name: r.display_name, edit_url: r.edit_url, edit_token: r.edit_token,
      recorded_answers: view.candidates, unanswered_candidate_ids: view.candidates.filter((c) => !c.answer).map((c) => c.id),
      note: "Saved. Keep edit_url secret and give it only to this participant; it is needed to change the answer (update_my_response).",
    };
  }));

  server.registerTool("get_my_response", {
    title: "Read my answer",
    description: "Read a participant's own saved answer, the poll status and the finalized date (if any), using the edit_url returned by submit_response.",
    inputSchema: { edit_url: EDIT_URL },
    annotations: RO,
  }, ({ edit_url }) => run(async () => {
    const r = editRef(edit_url);
    const { agg, p } = await uc.openOwnResponse(ctx, r.publicId, r.participantId, r.token);
    const st = publicView(agg, ctx.links);
    return { poll_title: agg.poll.title, poll_status: st.status, accepting_responses: st.accepting_responses, finalized_candidate: st.finalized_candidate, ...uc.ownResponseView(agg, p) };
  }));

  server.registerTool("update_my_response", {
    title: "Change my answer",
    description: "Change a participant's own answer with their edit_url. `answers` is merged into the saved answers (null clears one); replace_all=true replaces them entirely. Pass only comment to change just the comment. Only while the poll accepts responses.",
    inputSchema: {
      edit_url: EDIT_URL, answers: ANSWERS.optional(), replace_all: z.boolean().optional(),
      comment: z.string().max(500).optional(), display_name: z.string().max(100).optional().describe("Rename (not for invited participants)"),
    },
    annotations: { ...RW, idempotentHint: true },
  }, (a) => run(async () => {
    const r = editRef(a.edit_url);
    const data: Record<string, unknown> = {};
    if (a.answers) data.answers = a.answers;
    if (a.comment != null) data.comment = a.comment;
    if (a.display_name != null) data.display_name = a.display_name;
    const { agg, p } = await uc.updateResponse(ctx, r.publicId, r.participantId, r.token, data, { replaceAll: a.replace_all });
    return { updated: true, ...uc.ownResponseView(agg, p) };
  }));

  // ---------- organizers ----------

  if (uc.canCreate(ctx)) {
    server.registerTool("create_poll", {
      title: "Create a poll",
      description: "Create a scheduling poll. Give candidates as explicit slots (`candidates`, local time like \"2026-12-01T13:00\"; `end` optional with duration_minutes) and/or windows (`candidate_ranges`: slots of duration_minutes starting every 30 minutes, made server-side). dry_run=true only validates and previews; without it the poll is created and opened for answers immediately (there are no drafts), so create only after the user agreed. Returns public_url (share with participants) and manage_url: the organizer's private key for all later steps — tell the user to keep it. client_request_id makes retries safe.",
      inputSchema: {
        ...PollInputShape,
        dry_run: z.boolean().optional().describe("Validate and preview only; nothing is saved"),
      },
      annotations: RW,
    }, (a) => run(async () => {
      const { dry_run, ...data } = a;
      if (dry_run) {
        const { result } = uc.preview(ctx, data);
        return { ...result, errors: (result.errors as never[]).map((e) => renderIssue(lang, e)), warnings: warnings(result.warnings as never[]) };
      }
      const r = await uc.createPoll(ctx, data);
      const out = await uc.createdResponse(ctx, r);
      return {
        ...out, warnings: warnings(out.warnings),
        next_step: "Created and open for answers. Give the user public_url to share with participants and manage_url to keep private. Read progress with get_results.",
      };
    }));
  }

  server.registerTool("get_poll", {
    title: "Poll details (organizer)",
    description: "Settings, candidates [{id,start,end}], participants [{id,display_name,required,responded}], results summary and current version.",
    inputSchema: { poll: ORGANIZER_REF },
    annotations: RO,
  }, ({ poll }) => run(async () => pollDetail(await uc.openForOrganizer(ctx, organizerRef(ctx, poll)), ctx.links)));

  server.registerTool("get_results", {
    title: "Results (organizer)",
    description: "Server-side tally: per candidate yes/maybe/no/unanswered, best_candidate_ids (ranking: all required yes → most yes → fewest no → most maybe), responded/expected/pending, pending_names. view=full adds each participant's answers and comments. Report these numbers as-is.",
    inputSchema: { poll: ORGANIZER_REF, view: z.enum(["summary", "full"]).optional() },
    annotations: RO,
  }, ({ poll, view }) => run(async () => resultsView(await uc.openForOrganizer(ctx, organizerRef(ctx, poll)), view ?? "summary")));

  server.registerTool("update_poll", {
    title: "Edit a poll",
    description: "Edit title/description/deadline/settings, add candidates (add_candidates / add_candidate_ranges), remove candidates, add invitees, mark people required. Existing answers are kept. Pass version from the last read.",
    inputSchema: { poll: ORGANIZER_REF, ...svc.PatchInputShape },
    annotations: RW,
  }, ({ poll, ...data }) => run(async () => {
    const { agg, value } = await uc.organizerChange(ctx, organizerRef(ctx, poll), (agg) => svc.patch(agg, data));
    return { ...(await pollDetail(agg, ctx.links)), warnings: warnings(value.warnings) };
  }));

  const transition = (name: string, title: string, description: string, fn: (agg: Parameters<typeof svc.close>[0]) => void, ann = RW) =>
    server.registerTool(name, { title, description, inputSchema: { poll: ORGANIZER_REF }, annotations: ann },
      ({ poll }) => run(async () => pollBrief((await uc.organizerChange(ctx, organizerRef(ctx, poll), fn)).agg, ctx.links)));

  transition("close_poll", "Stop accepting answers", "Close the poll (status closed). Undo with reopen_poll.", svc.close);
  transition("unfinalize_poll", "Undo finalize", "Undo finalize_poll (status back to closed).", svc.unfinalize);
  transition("cancel_poll", "Cancel a poll", "Cancel the poll; the public page shows it as cancelled. Only on the user's explicit request.", svc.cancel, DESTRUCTIVE);

  server.registerTool("reopen_poll", {
    title: "Reopen",
    description: "Accept answers again on a closed poll (or one whose deadline passed). Optionally a new future response_deadline; otherwise a past deadline is removed.",
    inputSchema: { poll: ORGANIZER_REF, response_deadline: z.string().optional().describe("Local time or ISO 8601 with offset") },
    annotations: RW,
  }, ({ poll, response_deadline }) => run(async () => pollBrief((await uc.organizerChange(ctx, organizerRef(ctx, poll),
    (agg) => svc.reopen(agg, svc.parseDeadlineArg(agg, response_deadline)))).agg, ctx.links)));

  server.registerTool("finalize_poll", {
    title: "Fix the date",
    description: "Fix the date to one candidate (status finalized; participants see it on the poll page). Only after the user chose. Pass version from get_results/get_poll.",
    inputSchema: { poll: ORGANIZER_REF, candidate_id: z.string().describe("e.g. \"c2\""), version: VERSION },
    annotations: RW,
  }, ({ poll, candidate_id, version }) => run(async () => {
    const { agg } = await uc.organizerChange(ctx, organizerRef(ctx, poll), (agg) => svc.finalize(agg, candidate_id, version));
    const c = findCandidate(agg, cKey(agg.poll.finalizedCandidateNo!))!;
    return { ...(await pollBrief(agg, ctx.links)), finalized_candidate: { id: cKey(c.no), start: isoLocal(c.startAt, agg.poll.timezone), end: isoLocal(c.endAt, agg.poll.timezone) } };
  }));

  server.registerTool("reissue_edit_link", {
    title: "Reissue a participant's edit link",
    description: "For a participant who lost their edit link: issue a new edit_url (the old one stops working). Give it only to that participant.",
    inputSchema: { poll: ORGANIZER_REF, participant_id: z.string().describe("e.g. \"p3\"") },
    annotations: DESTRUCTIVE,
  }, ({ poll, participant_id }) => run(async () => {
    const { agg, value: p } = await uc.organizerChange(ctx, organizerRef(ctx, poll), (agg) => svc.reissueEditLink(agg, participant_id));
    return { participant_id: pKey(p.no), display_name: p.displayName, edit_url: await ctx.links.editUrl(agg.poll, p), note: "The old link no longer works. Give this one only to that participant." };
  }));

  server.registerTool("delete_poll", {
    title: "Delete a poll",
    description: "Delete the poll and all answers permanently. Irreversible; only on the user's explicit request.",
    inputSchema: { poll: ORGANIZER_REF },
    annotations: DESTRUCTIVE,
  }, ({ poll }) => run(async () => {
    const agg = await uc.openForOrganizer(ctx, organizerRef(ctx, poll));
    await ctx.store.deletePoll(agg.poll.id, uc.actorLabel(ctx.actor));
    return { deleted: true, poll_id: agg.poll.id };
  }));

  if (uc.isAdmin(ctx)) {
    server.registerTool("list_polls", {
      title: "List my polls (administrator)",
      description: "Newest 100 polls created by this administrator (all=true: every poll on the site): poll_id, status, title, counts, public_url, manage_url.",
      inputSchema: { status: z.enum(["open", "closed", "finalized", "cancelled"]).optional(), all: z.boolean().optional() },
      annotations: RO,
    }, ({ status, all }) => run(async () => {
      const rows = await ctx.store.list({ ownerUserId: all || ctx.actor.kind !== "admin" ? undefined : ctx.actor.user.id, status, limit: 100 });
      return {
        polls: await Promise.all(rows.map(async (r) => ({
          poll_id: r.id, title: r.title, status: r.status, candidate_count: r.candidateCount, responded: r.responded,
          public_url: ctx.links.publicUrl(r), manage_url: await ctx.links.manageUrl(r),
        }))),
      };
    }));
  }

  server.registerTool("get_guide", {
    title: "Service guide",
    description: "Full guide for AI agents (poll fields, candidate ranges, error codes, rules). Read it when a call fails with a code you do not understand.",
    inputSchema: {},
    annotations: RO,
  }, () => run(async () => ({ guide: guide(ctx) })));

  // ---------- resources & prompts ----------

  server.registerResource("guide", "time-of-eve://docs/guide", { title: "Guide for AI agents", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: guide(ctx) }] }));
  server.registerResource("poll-schema", "time-of-eve://docs/poll-schema.json", { title: "create_poll input JSON Schema", mimeType: "application/schema+json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/schema+json", text: JSON.stringify(pollJsonSchema(), null, 2) }] }));
  server.registerResource("public-poll", new ResourceTemplate("time-of-eve://polls/{public_id}", { list: undefined }),
    { title: "Public poll (Markdown)", mimeType: "text/markdown" },
    async (uri, vars) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: publicMarkdown(await ctx.store.publicPoll(publicRef(String(vars.public_id))), ctx.links) }] }));

  if (uc.canCreate(ctx)) {
    server.registerPrompt("organize_poll", {
      title: "Create a scheduling poll",
      description: "Plan candidates with the user and create a poll",
      argsSchema: { request: z.string().describe("What to schedule (who, how long, when)") },
    }, ({ request }) => ({
      messages: [{ role: "user", content: { type: "text", text: `Create a scheduling poll with Time of EVE for: ${request}\n\nConfirm missing details (length, time zone, date range, participants) with me first. Use candidate_ranges for time windows, dry_run first, then create_poll after I agree (it opens immediately). Give me public_url and manage_url.` } }],
    }));
  }
  server.registerPrompt("answer_poll", {
    title: "Answer a scheduling poll",
    description: "Answer a poll on behalf of the user",
    argsSchema: {
      poll_url: z.string().describe("The poll link (…/p/<id>)"),
      name: z.string().describe("Whose answer this is"),
      availability: z.string().optional().describe("Free/busy times in words"),
    },
  }, ({ poll_url, name, availability }) => ({
    messages: [{ role: "user", content: { type: "text", text: `Answer the scheduling poll ${poll_url} for me (${name}).${availability ? ` My availability: ${availability}.` : " Ask me about my availability first."} Read it with get_public_poll, show me the answers you plan to send, then submit_response and give me the edit_url.` } }],
  }));

  return server;
}

/** Handle one HTTP request (POST JSON-RPC). */
export async function handleMcp(request: Request, m: McpContext): Promise<Response> {
  if (request.method === "GET") return new Response(null, { status: 405, headers: { Allow: "POST, DELETE" } });
  if (request.method === "DELETE") return new Response(null, { status: 200 });
  const server = buildServer(m);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}
