/**
 * Serialized views of a poll: organizer brief/detail, results, the public (participant-facing) view, its Markdown
 * rendering for AI agents, and CSV. Times are ISO 8601 with the poll's UTC offset.
 *
 * The public view exposes exactly what the answer page shows: never basis, emails, per-person required flags,
 * the poll id (organizer handle) or any token. Per-person answers only when names are public.
 */
import { fmtDate, type Lang } from "../lib/i18n";
import { hhmm, isoLocal, toLocal } from "../shared/time";
import type { Links } from "./links";
import {
  activeCandidates, cKey, effectiveStatus, finalizedCandidate, pKey, participantAnswers, responseOptions, results, roster,
  type Candidate, type CandidateResult, type PollAggregate,
} from "./model";

export function fmtRange(agg: PollAggregate, c: Pick<Candidate, "startAt" | "endAt">, lang: Lang): string {
  const tz = agg.poll.timezone;
  const s = toLocal(c.startAt, tz), e = toLocal(c.endAt, tz);
  const sameDay = s.year === e.year && s.month === e.month && s.day === e.day;
  const end = sameDay ? hhmm(e) : `${e.month}/${e.day} ${hhmm(e)}`;
  return `${fmtDate(lang, s)} ${hhmm(s)}–${end}`;
}

export function fmtDateTime(agg: PollAggregate, ms: number | null, lang: Lang): string {
  if (ms == null) return "";
  const l = toLocal(ms, agg.poll.timezone);
  return `${fmtDate(lang, l)} ${hhmm(l)}`;
}

const iso = (agg: PollAggregate, ms: number | null) => (ms == null ? null : isoLocal(ms, agg.poll.timezone));

function resultRow(agg: PollAggregate, r: CandidateResult) {
  const { start_ms, end_ms, id, ...counts } = r;
  return { id, start: iso(agg, start_ms)!, end: iso(agg, end_ms)!, ...counts };
}

export function resultsView(agg: PollAggregate, view: "summary" | "full" = "summary") {
  const r = results(agg);
  const out: Record<string, unknown> = {
    status: r.status,
    responded: r.responded,
    expected: r.expected,
    pending: r.pending,
    best_candidate_ids: r.best_candidate_ids,
    finalized_candidate_id: r.finalized_candidate_id,
    candidates: r.candidates.map((c) => resultRow(agg, c)),
    version: agg.poll.version,
  };
  if (view === "full") {
    out.participants = roster(agg).map((p) => ({
      id: pKey(p.no), display_name: p.displayName, required: p.required, preregistered: p.preregistered,
      responded: p.respondedAt != null, comment: p.comment || null, answers: participantAnswers(agg, p),
    }));
  } else out.pending_names = r.pending_names;
  return out;
}

export async function pollBrief(agg: PollAggregate, links: Links, opts: { manageUrl?: boolean } = { manageUrl: true }) {
  const p = agg.poll;
  const out: Record<string, unknown> = {
    poll_id: p.id, status: effectiveStatus(p), title: p.title, candidate_count: activeCandidates(agg).length,
    responded: agg.participants.filter((x) => x.respondedAt != null).length, version: p.version,
    created_at: new Date(p.createdAt).toISOString(),
  };
  out.public_url = links.publicUrl(p);
  if (opts.manageUrl) out.manage_url = await links.manageUrl(p);
  if (p.hidden) out.hidden = true;
  return out;
}

export async function pollDetail(agg: PollAggregate, links: Links) {
  const p = agg.poll;
  const fin = finalizedCandidate(agg);
  return {
    ...(await pollBrief(agg, links)),
    description: p.description, basis: p.basis, timezone: p.timezone, duration_minutes: p.durationMinutes,
    response_deadline: iso(agg, p.responseDeadline), allow_maybe: p.allowMaybe, response_options: responseOptions(p),
    show_participant_names: p.showParticipantNames,
    finalized_candidate: fin ? { id: cKey(fin.no), start: iso(agg, fin.startAt), end: iso(agg, fin.endAt) } : null,
    candidates: activeCandidates(agg).map((c) => ({ id: cKey(c.no), start: iso(agg, c.startAt), end: iso(agg, c.endAt) })),
    participants: agg.participants.map((x) => ({
      id: pKey(x.no), display_name: x.displayName, required: x.required, preregistered: x.preregistered, responded: x.respondedAt != null,
    })),
    results: resultsView(agg, "summary"),
  };
}

/** What participants (and their AI agents) can see. */
export function publicView(agg: PollAggregate, links: Links) {
  const p = agg.poll;
  const r = results(agg);
  const status = effectiveStatus(p);
  const opts = responseOptions(p);
  const u = links.agentUrls(p);
  const first = r.candidates[0]?.id ?? "c1";
  const fin = finalizedCandidate(agg);
  return {
    public_id: p.publicId,
    title: p.title,
    description: p.description,
    timezone: p.timezone,
    duration_minutes: p.durationMinutes,
    status,
    accepting_responses: status === "open",
    response_deadline: iso(agg, p.responseDeadline),
    response_options: opts,
    show_participant_names: p.showParticipantNames,
    responded: r.responded,
    expected: r.expected,
    pending: r.pending,
    best_candidate_ids: r.best_candidate_ids,
    finalized_candidate: fin ? { id: cKey(fin.no), start: iso(agg, fin.startAt), end: iso(agg, fin.endAt) } : null,
    candidates: r.candidates.map((c) => resultRow(agg, c)),
    preregistered_pending: agg.participants.filter((x) => x.preregistered && x.respondedAt == null)
      .map((x) => ({ participant_id: pKey(x.no), display_name: x.displayName })),
    participants: p.showParticipantNames
      ? agg.participants.filter((x) => x.respondedAt != null).map((x) => ({
        id: pKey(x.no), display_name: x.displayName, comment: x.comment || null, answers: participantAnswers(agg, x),
      }))
      : null,
    how_to_respond: {
      only_when: "the participant explicitly asked you to answer for them; use their own name and real availability",
      method: "POST", url: u.respond, content_type: "application/json",
      body_example: { display_name: "山田 太郎", answers: { [first]: opts[0] }, comment: "" },
      body_example_invited: { participant_id: "p1", answers: { [first]: opts[0] } },
      returns: "201 {response_id, edit_token, edit_url}; give edit_url only to that person (it changes their answer)",
      edit: "GET/PATCH {url}/{response_id} with header X-Edit-Token: <edit_token>",
      mcp: `${u.mcp} (tools get_public_poll, submit_response, get_my_response, update_my_response; no token needed)`,
    },
    links: u,
  };
}

export function publicMarkdown(agg: PollAggregate, links: Links): string {
  const v = publicView(agg, links);
  const u = v.links;
  const names: Record<string, string> = { yes: "○ yes", maybe: "△ maybe", no: "× no" };
  const L: string[] = [
    `# ${v.title}`, "",
    "> Scheduling poll (日程調整) — machine-readable view of the answer page for AI agents.",
    `> Human page: ${u.page} · JSON: ${u.json} · Guide: ${u.docs}`, "",
  ];
  if (v.description) L.push(v.description.trim(), "");
  L.push(
    `- Status: **${v.status}**${v.accepting_responses ? " (accepting responses)" : " (not accepting responses)"}`,
    `- Response deadline: ${v.response_deadline ?? "none"}`,
    `- Time zone: ${v.timezone} (all times include the UTC offset)`,
    `- Answer options: ${v.response_options.map((o) => names[o]).join(", ")}`,
    `- Responses so far: ${v.responded}${v.expected ? ` of ${v.expected} invited` : ""}`,
  );
  if (v.finalized_candidate) L.push(`- **Finalized: ${v.finalized_candidate.id} (${v.finalized_candidate.start} – ${v.finalized_candidate.end})**`);
  if (v.best_candidate_ids.length) L.push(`- Currently best (server ranking): ${v.best_candidate_ids.join(", ")}`);
  L.push("", "## Candidates", "", "| id | start | end | ○ | △ | × | unanswered |", "|---|---|---|---|---|---|---|");
  for (const c of v.candidates) {
    const mark = v.best_candidate_ids.includes(c.id) ? " ★" : "";
    L.push(`| ${c.id}${mark} | ${c.start} | ${c.end} | ${c.yes} | ${c.maybe} | ${c.no} | ${c.unanswered} |`);
  }
  if (v.preregistered_pending.length) {
    L.push("", "## Invited, not answered yet", "");
    for (const p of v.preregistered_pending) L.push(`- ${p.participant_id}: ${p.display_name}`);
  }
  if (v.participants) L.push("", `Per-person answers and comments (${v.participants.length}): see \`participants\` in the JSON view.`);
  L.push("", "## How to answer (for AI agents)", "");
  if (!v.accepting_responses) L.push("This poll is not accepting responses now. Do not try to answer.", "");
  else {
    const ex = v.how_to_respond;
    L.push(
      "Only answer when the participant explicitly asked you to, with their own name and real availability.",
      "Do not answer for anyone else and do not guess availability.", "",
      `\`POST ${ex.url}\` (no authentication, \`Content-Type: application/json\`)`, "", "```json", JSON.stringify(ex.body_example), "```", "",
      `- \`answers\`: candidate id → ${v.response_options.map((o) => `\`${o}\``).join(" / ")}; omit a candidate to leave it unanswered.`,
      "- If the person is listed under \"Invited, not answered yet\", send `\"participant_id\"` instead of `\"display_name\"`.",
      `- Optional \`"comment"\` (≤ 500 chars).`,
      "- Response `201 {\"response_id\", \"edit_token\", \"edit_url\"}`. Give `edit_url` only to that person; never post it publicly.",
      `- Change later: \`PATCH ${ex.url}/{response_id}\` with header \`X-Edit-Token: <edit_token>\` (answers are merged; null clears one).`, "",
    );
  }
  L.push(`MCP server (Streamable HTTP, no token needed for participants): ${u.mcp}`, "", `Full guide: ${u.docs} · OpenAPI: ${u.openapi}`, "");
  return L.join("\n");
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  // also neutralize spreadsheet formulas (CSV injection)
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function exportCsv(agg: PollAggregate, lang: Lang = "ja"): string {
  const people = roster(agg);
  const sym: Record<string, string> = { yes: "○", maybe: "△", no: "×" };
  const r = results(agg);
  const res = new Map(r.candidates.map((c) => [c.id, c]));
  const req = lang === "en" ? " (required)" : "(必須)";
  const rows: unknown[][] = [[
    lang === "en" ? "Candidate" : "候補ID", lang === "en" ? "Date/time" : "日時", "○", "△", "×", lang === "en" ? "Unanswered" : "未回答",
    ...people.map((p) => p.displayName + (p.required ? req : "")),
  ]];
  for (const c of activeCandidates(agg)) {
    const k = cKey(c.no), x = res.get(k)!;
    rows.push([k, fmtRange(agg, c, lang), x.yes, x.maybe, x.no, x.unanswered, ...people.map((p) => sym[p.answers[k]] ?? "")]);
  }
  rows.push([]);
  rows.push([lang === "en" ? "Comment" : "コメント", "", "", "", "", "", ...people.map((p) => p.comment)]);
  return "﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
