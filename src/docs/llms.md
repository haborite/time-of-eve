# Time of EVE — guide for AI agents

> Scheduling polls (日程調整) that are easy for both humans and AI agents. An organizer proposes candidate time slots; participants mark ○ yes / △ maybe / × no; the server counts, ranks and records the final date. **The server does all counting and ranking — never tally answers yourself.**

Base URL: `{{BASE}}`
This document: `{{BASE}}/llms.txt` · MCP: `{{BASE}}/mcp` · OpenAPI 3.1: `{{BASE}}/openapi.json` · Poll JSON Schema: `{{BASE}}/schema/poll.json`
(人間の方へ: このページはAIエージェントが本サービスの使い方を学ぶための説明書です。)

**On this site: {{CREATION}}** · Default time zone: `{{TZ}}`

## 0. TL;DR

- Organizer ("make a poll and give me the link"): `create_poll` (MCP) or `POST /api/v1/polls` → give the user **public_url** (send to participants) and **manage_url** (the organizer's private key; keep it).
- Participant ("answer this poll for me"): `get_public_poll` → `submit_response` (or `GET /api/v1/public/{id}` → `POST …/responses`) → give the person their **edit_url** privately.
- Later: `get_results` → report `best_candidate_ids` / `pending_names` → `finalize_poll` when the user decides.

## 1. Access paths — choose honestly

| Path | When | How |
|---|---|---|
| MCP (recommended) | Your client can connect to a remote MCP server (Streamable HTTP) | `{{BASE}}/mcp`. No token needed for participants{{MCP_CREATE}}. Administrators: header `Authorization: Bearer sch_…`, or OAuth at `{{BASE}}/mcp/admin`. |
| REST API | You can send HTTPS requests | Section 5. |
| Browser | You can operate a browser | Open `{{BASE}}/new/import`, paste the poll JSON, Validate, check the preview, "作成して公開" (Create and publish). |
| Manual | Plain chat only | Output the poll JSON in one code block and ask the user to paste it at `{{BASE}}/new/import`. |

Rules:
- Never claim a poll was created or a URL exists unless the server returned it. If a step failed, say which and what the user must do.
- Never ask the user to paste passwords or API tokens into the chat.
- Share only **public_url** with participants. **manage_url** lets anyone edit, finalize or delete the poll; **edit_url** lets anyone change that one person's answer. Never post them publicly or give them to others.
- Answer a poll only for the person who asked you, with their own name and real availability. Never guess availability.

## 2. Preparing candidates

- Confirm title, length, time zone, date range, participants and hard constraints. Ask when unknown; do not invent constraints.
- Write times as **local wall-clock time without offset** — `"2026-12-01T13:00"` — and set `timezone` (IANA, e.g. `Asia/Tokyo`, `America/New_York`). The server derives the UTC offset for each date (DST-safe). If you do include an offset it must be correct for that date, otherwise `timezone_mismatch`.
- Times are on 5-minute boundaries. Typical size: 5–20 candidates; limit {{MAX_CANDIDATES}}.
- Two ways to give candidates (can be combined):
  - `candidates`: explicit slots `{"start": "2026-12-01T13:00", "end": "2026-12-01T14:00"}`. With `duration_minutes` set, `end` can be omitted.
  - `candidate_ranges`: windows the server turns into slots of `duration_minutes`, one starting every 30 minutes (every `duration_minutes` if shorter), so slots overlap: 13:00–17:00 with 60 minutes → 13:00, 13:30, …, 16:00 (7 slots). `{"from_date": "2026-12-01", "to_date": "2026-12-05", "weekdays": ["mon","wed","fri"], "start_time": "13:00", "end_time": "17:00"}` (or `date` / `dates`). Past slots are skipped.
  - To offer a whole window as one candidate ("any time this afternoon"), give it as an explicit candidate with `start` and `end` instead of a range.
- `client_request_id` (optional, recommended): a unique key per poll you intend to create. Resending the identical body returns the same poll (`idempotent_replay: true`) — safe retries. Same key with a different body → `409 idempotency_conflict`.
- Use `dry_run: true` first to see errors, warnings and the expanded candidate list without saving.

## 3. Poll JSON

```json
{
  "title": "打ち合わせ 日程調整",
  "description": "オンライン（Zoom）。1時間。",
  "basis": "Organizer free per calendar 11/15; members prefer weekday afternoons.",
  "timezone": "Asia/Tokyo",
  "duration_minutes": 60,
  "candidate_ranges": [
    {"from_date": "2026-12-01", "to_date": "2026-12-04", "weekdays": ["tue", "thu"], "start_time": "13:00", "end_time": "17:00"}
  ],
  "candidates": [{"start": "2026-12-05T10:00"}],
  "response_deadline": "2026-11-28T23:59",
  "allow_maybe": true,
  "show_participant_names": true,
  "participants": [{"display_name": "Aさん", "required": true}, {"display_name": "Bさん"}],
  "client_request_id": "claude-20261116-lab-meeting-1"
}
```

| field | | |
|---|---|---|
| `title` | required | ≤ 200 chars |
| `timezone` | optional | IANA name; default `{{TZ}}` |
| `duration_minutes` | optional | 5–1440, multiple of 5. Needed for `candidate_ranges` and for `candidates` without `end` |
| `candidates` / `candidate_ranges` | at least one candidate in total | see section 2 |
| `description` | optional | shown to participants, ≤ 2000 |
| `basis` | optional | organizer-only memo (why these candidates), ≤ 4000. Never shown to participants |
| `response_deadline` | optional | local time or ISO with offset |
| `allow_maybe` | optional | offer △ (default true) |
| `show_participant_names` | optional | show each person's answers by name (default true) |
| `participants` | optional | invitees `{display_name, required?, email?}` (≤ {{MAX_PARTICIPANTS}}); they pick their name when answering. `required: true` → ranking prefers candidates all required people can attend |
| `client_request_id` | optional | idempotency key `[A-Za-z0-9._:-]{1,100}` |

## 4. Statuses and ranking

`open` (accepting; a poll is open as soon as it is created — there are no drafts) → `closed` → `finalized`; any → `cancelled`. An open poll past its deadline behaves as `closed`; `reopen` re-opens it.
Ranking (`best_candidate_ids`): candidates where every required participant answered yes → most yes → fewest no → most maybe. Only candidates with at least one yes are ranked.

## 5. REST API (JSON)

Organizer endpoints authenticate with **one** of: header `X-Manage-Token: <token>` (the last path segment of manage_url), or `Authorization: Bearer sch_…` (administrator API token).

| method | path | |
|---|---|---|
| GET | `/api/v1` | service info (who can create, default time zone, links) |
| POST | `/api/v1/polls` | create and open for answers. Body: poll JSON (+ `"dry_run": true` to validate only). 201 → `{poll_id, status, public_url, manage_url, version, warnings, idempotent_replay}` |
| GET | `/api/v1/polls/{poll_id}` | details + results summary |
| PATCH | `/api/v1/polls/{poll_id}` | edit: `title`, `description`, `basis`, `response_deadline` (null removes), `show_participant_names`, `duration_minutes`, `add_candidates`, `add_candidate_ranges`, `remove_candidate_ids`, `add_participants`, `set_required` `{"p1": true}`, `version` |
| GET | `/api/v1/polls/{poll_id}/results?view=summary\|full` | tally and ranking |
| POST | `/api/v1/polls/{poll_id}/close` · `reopen` (`{"response_deadline"?}`) · `finalize` (`{"candidate_id": "c2", "version"?}`) · `unfinalize` · `cancel` · `rotate-manage-link` | state changes |
| POST | `/api/v1/polls/{poll_id}/participants/{p}/reissue-edit-link` | new edit_url for a participant |
| DELETE | `/api/v1/polls/{poll_id}` | delete permanently |
| GET | `/api/v1/polls` | administrators: list polls |
| GET | `/api/v1/public/{public_id}` | public view (no auth): candidates with ids and tallies, status, deadline, preregistered_pending |
| POST | `/api/v1/public/{public_id}/responses` | answer (no auth): `{"display_name": "…", "answers": {"c1": "yes", "c2": "no"}, "comment": "…"}` or `{"participant_id": "p2", …}` → 201 `{response_id, edit_token, edit_url}` |
| GET / PATCH | `/api/v1/public/{public_id}/responses/{response_id}` | header `X-Edit-Token`. PATCH merges `answers` (null clears one; `"replace_all": true` replaces) and/or `comment` |
| GET | `/api/v1/polls/{poll_id}/export.csv` | CSV |

The public page `{{BASE}}/p/{public_id}` also answers with Markdown (`/p/{id}.md`, `Accept: text/markdown`) or JSON (`/p/{id}.json`, `Accept: application/json`).

## 6. MCP tools

Participants: `get_public_poll(poll)`, `submit_response(poll, display_name | participant_id, answers, comment?)`, `get_my_response(edit_url)`, `update_my_response(edit_url, answers?, replace_all?, comment?)`.
Organizers (`poll` = manage_url; administrators may pass poll_id): `create_poll(…poll fields, dry_run?)`, `get_poll`, `get_results(view?)`, `update_poll`, `close_poll`, `reopen_poll(response_deadline?)`, `finalize_poll(candidate_id, version?)`, `unfinalize_poll`, `cancel_poll`, `reissue_edit_link(participant_id)`, `delete_poll`. Administrators: `list_polls`.
Also: `get_guide`; resources `time-of-eve://docs/guide`, `time-of-eve://docs/poll-schema.json`, `time-of-eve://polls/{public_id}`; prompts `organize_poll`, `answer_poll`.

## 7. Errors

`{"error": {"code", "field", "message", "hint"}, "errors": [...], "warnings": [...], "docs": "{{BASE}}/llms.txt"}`. Fix every entry of `errors` (`field` says where, `hint` says how) and retry. Common codes:
`validation_failed` (see errors[]), `invalid_datetime`, `timezone_mismatch` (drop the offset), `nonexistent_local_time` (DST gap), `missing_end`, `duration_mismatch`, `range_needs_duration`, `no_candidates`, `too_many_candidates`, `idempotency_conflict`, `version_conflict` (re-read and retry), `invalid_state`, `not_accepting`, `use_participant_id` (the name is an invitee: send participant_id), `already_responded` (use the edit_url), `invalid_manage_token`, `invalid_edit_token`, `creation_disabled`, `rate_limited` (wait a minute).
Warnings (`candidate_in_past`, `deadline_after_candidate`, `range_empty`, `unknown_field`, …) do not block.
