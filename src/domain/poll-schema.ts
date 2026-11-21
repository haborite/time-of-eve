/**
 * Poll input schema (Zod): the single source for validation, OpenAPI, JSON Schema, MCP tool schemas and the type of
 * the JSON the browser builds on /new. Only depends on zod, so browser code can import its types.
 * Checks Zod cannot express live in ./input.
 */
import { z } from "zod";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const DateTimeStr = z.string().describe(
  "Local time in the poll's timezone \"2026-12-01T13:00\" (recommended), or ISO 8601 with offset \"2026-12-01T13:00:00+09:00\".",
);

export const CandidateInput = z.object({
  start: DateTimeStr,
  end: DateTimeStr.optional().describe("Omit when duration_minutes is set: end = start + duration_minutes."),
  allow_duration_mismatch: z.boolean().optional().describe("Set true if this candidate's length intentionally differs from duration_minutes."),
});

export const RangeInput = z.object({
  date: z.string().optional().describe("One date YYYY-MM-DD"),
  dates: z.array(z.string()).optional().describe("Several dates YYYY-MM-DD"),
  from_date: z.string().optional().describe("First date of a period YYYY-MM-DD (with to_date)"),
  to_date: z.string().optional().describe("Last date of a period YYYY-MM-DD (inclusive)"),
  weekdays: z.array(z.enum(WEEKDAYS)).optional().describe("Keep only these weekdays, e.g. [\"mon\",\"wed\"]"),
  start_time: z.string().describe("Window start HH:MM (local)"),
  end_time: z.string().describe("Window end HH:MM (local, 24:00 allowed)"),
}).describe("A time window turned into slots of duration_minutes starting every 30 minutes (every duration_minutes if shorter), e.g. weekdays 13:00–17:00 of a week.");

export const ParticipantInput = z.object({
  display_name: z.string().describe("Name shown in the poll"),
  email: z.string().optional().describe("Never shown publicly"),
  required: z.boolean().optional().describe("Must attend: ranking prefers candidates all required people can attend"),
});

export const PollInputShape = {
  title: z.string().describe("Poll title"),
  description: z.string().optional().describe("Shown to participants (format, place, notes). Max 2000."),
  basis: z.string().optional().describe("Organizer-only memo: why these candidates (sources, constraints). Never shown to participants."),
  timezone: z.string().optional().describe("IANA time zone, e.g. Asia/Tokyo. Defaults to the site's default time zone."),
  duration_minutes: z.number().int().optional().describe("Length of each candidate in minutes (5–1440)."),
  candidates: z.array(CandidateInput).optional().describe("Explicit candidate slots."),
  candidate_ranges: z.array(RangeInput).optional().describe("Windows expanded into slots by the server (needs duration_minutes)."),
  response_deadline: z.string().nullable().optional().describe("Answers close after this time (local or with offset)."),
  allow_maybe: z.boolean().optional().describe("Offer △ maybe in addition to ○ yes / × no (default true)."),
  show_participant_names: z.boolean().optional().describe("Show each participant's answers by name on the public page (default true)."),
  participants: z.array(ParticipantInput).optional().describe("People invited in advance (they pick their name when answering)."),
  client_request_id: z.string().optional().describe("Idempotency key (1–100 of A-Z a-z 0-9 . _ : -). Resending the same body returns the same poll."),
};

export const PollInput = z.object(PollInputShape);
export type PollInputT = z.infer<typeof PollInput>;
