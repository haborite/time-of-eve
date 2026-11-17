import { describe, expect, it } from "vitest";
import { validatePollInput } from "../../src/domain/input";
import { deriveAnswers, results, slotsFromAnswers, timeline, type PollAggregate } from "../../src/domain/model";
import * as svc from "../../src/domain/service";
import { exportCsv, publicView } from "../../src/domain/views";
import { Links } from "../../src/domain/links";
import { AppError } from "../../src/domain/errors";

const NOW = Date.UTC(2026, 10, 16, 0, 0);
const opts = { now: NOW, defaultTimezone: "Asia/Tokyo" };
const links = new Links("https://toe.test", "test-secret-key-0123456789abcdef0123456789abcdef");

function codes(r: ReturnType<typeof validatePollInput>) {
  return { errors: r.issues.errors.map((e) => `${e.code}@${e.field}`), warnings: r.issues.warnings.map((e) => `${e.code}@${e.field}`) };
}

function poll(extra: Record<string, unknown> = {}): PollAggregate {
  const { norm } = validatePollInput({
    title: "T", duration_minutes: 60,
    candidates: [{ start: "2026-12-01T10:00" }, { start: "2026-12-01T11:00" }, { start: "2026-12-02T10:00" }],
    participants: [{ display_name: "A", required: true }, { display_name: "B" }],
    ...extra,
  }, opts);
  return svc.newPoll(norm!, { userId: null }, null, NOW);
}

describe("poll input validation", () => {
  it("accepts local times, derives offsets, fills end from duration", () => {
    const r = validatePollInput({ title: " 打合せ ", duration_minutes: 30, candidates: [{ start: "2026-12-01T13:00" }] }, opts);
    expect(r.norm?.title).toBe("打合せ");
    expect(r.norm?.timezone).toBe("Asia/Tokyo");
    expect(r.norm?.candidates).toEqual([{ startAt: Date.UTC(2026, 11, 1, 4, 0), endAt: Date.UTC(2026, 11, 1, 4, 30) }]);
  });

  it("expands candidate_ranges by weekday and duration", () => {
    const r = validatePollInput({
      title: "x", duration_minutes: 60,
      candidate_ranges: [{ from_date: "2026-11-30", to_date: "2026-12-06", weekdays: ["mon", "wed"], start_time: "13:00", end_time: "15:30" }],
    }, opts);
    expect(codes(r).errors).toEqual([]);
    expect(r.norm!.candidates).toHaveLength(8); // Mon + Wed × 13:00, 13:30, 14:00, 14:30 (15:00–16:00 does not fit)
  });

  it("starts range slots every 30 minutes, dedupes against explicit candidates, and ignores step_minutes", () => {
    const r = validatePollInput({
      title: "x", duration_minutes: 60,
      candidates: [{ start: "2026-12-01T13:00" }],
      candidate_ranges: [{ date: "2026-12-01", start_time: "13:00", end_time: "15:00", step_minutes: 60 }],
    }, opts);
    expect(r.norm!.candidates).toHaveLength(3); // 13:00, 13:30, 14:00 (13:00 deduped)
    expect(codes(r).warnings).toContain("unknown_field@candidate_ranges[0].step_minutes");
  });

  it("starts short range slots every duration_minutes", () => {
    const r = validatePollInput({ title: "x", duration_minutes: 15, candidate_ranges: [{ date: "2026-12-01", start_time: "13:00", end_time: "14:00" }] }, opts);
    expect(r.norm!.candidates.map((c) => (c.startAt - Date.UTC(2026, 11, 1, 4, 0)) / 60000)).toEqual([0, 15, 30, 45]);
  });

  it("reports every problem with codes and fields", () => {
    const r = validatePollInput({
      title: "", timezone: "Asia/Tokyo", duration_minutes: 60, foo: 1,
      candidates: [
        { start: "2026-12-01T13:00:00+08:00" }, // wrong offset for Tokyo
        { start: "2026-12-01T13:07" }, // not 5-minute aligned
        { start: "2026-12-01T14:00", end: "2026-12-01T14:30" }, // length ≠ duration
        { start: "nonsense" },
      ],
    }, opts);
    expect(r.norm).toBeNull();
    expect(codes(r).errors).toEqual(expect.arrayContaining([
      "required@title", "timezone_mismatch@candidates[0].start", "unaligned_time@candidates[1].start",
      "duration_mismatch@candidates[2]", "invalid_datetime@candidates[3].start",
    ]));
    expect(codes(r).warnings).toContain("unknown_field@foo");
  });

  it("rejects DST gaps and warns on overlaps / past times", () => {
    const r = validatePollInput({
      title: "x", timezone: "America/New_York", duration_minutes: 60,
      candidates: [{ start: "2027-03-14T02:30" }],
    }, opts);
    expect(codes(r).errors).toContain("nonexistent_local_time@candidates[0].start");
    const w = validatePollInput({
      title: "x", candidates: [{ start: "2026-12-01T13:00", end: "2026-12-01T15:00" }, { start: "2026-12-01T14:00", end: "2026-12-01T16:00" }, { start: "2026-01-01T10:00", end: "2026-01-01T11:00" }],
    }, opts);
    expect(codes(w).warnings).toEqual(["candidate_in_past@candidates[2]"]); // overlapping candidates are not reported
  });

  it("requires candidates, a valid time zone and duration for ranges", () => {
    expect(codes(validatePollInput({ title: "x" }, opts)).errors).toEqual(["no_candidates@candidates"]);
    expect(codes(validatePollInput({ title: "x", timezone: "Nowhere/City", candidates: [] }, opts)).errors).toEqual(["invalid_timezone@timezone"]);
    expect(codes(validatePollInput({ title: "x", candidate_ranges: [{ date: "2026-12-01", start_time: "10:00", end_time: "12:00" }] }, opts)).errors)
      .toContain("range_needs_duration@duration_minutes");
    expect(codes(validatePollInput({ title: "x", candidates: [{ start: "2026-12-01T10:00" }] }, opts)).errors).toContain("missing_end@candidates[0].end");
  });

  it("rejects duplicate invitees and bad emails", () => {
    const r = validatePollInput({
      title: "x", duration_minutes: 30, candidates: [{ start: "2026-12-01T10:00" }],
      participants: [{ display_name: "Ann" }, { display_name: "ann" }, { display_name: "Bob", email: "nope" }],
    }, opts);
    expect(codes(r).errors).toEqual(expect.arrayContaining(["duplicate_participant@participants[1].display_name", "invalid_email@participants[2].email"]));
  });
});

describe("results and ranking", () => {
  it("ranks required-all-yes first, then yes, no, maybe", () => {
    const agg = poll();
    svc.submitResponse(agg, { participant_id: "p1", answers: { c1: "no", c2: "yes", c3: "yes" } }, NOW);
    svc.submitResponse(agg, { participant_id: "p2", answers: { c1: "yes", c2: "maybe", c3: "yes" } }, NOW);
    svc.submitResponse(agg, { display_name: "C", answers: { c1: "yes", c2: "yes" } }, NOW);
    const r = results(agg, NOW);
    expect(r.candidates.map((c) => [c.id, c.yes, c.maybe, c.no, c.unanswered, c.all_required_yes])).toEqual([
      ["c1", 2, 0, 1, 0, false], ["c2", 2, 1, 0, 0, true], ["c3", 2, 0, 0, 1, true],
    ]);
    expect(r.best_candidate_ids).toEqual(["c2"]); // c2: 2 yes + 1 maybe beats c3: 2 yes; c1 excluded (required no)
    expect(r.responded).toBe(3);
    expect(r.pending).toBe(0);
  });

  it("derives candidate answers from timeline slots and back", () => {
    const agg = poll({ candidates: [{ start: "2026-12-01T10:00", end: "2026-12-01T11:00" }, { start: "2026-12-01T10:30", end: "2026-12-01T11:30", allow_duration_mismatch: true }] });
    expect(timeline(agg).step).toBe(30);
    const slots = { "2026-12-01T10:00": "yes", "2026-12-01T10:30": "maybe", "2026-12-01T11:00": "no" } as const;
    expect(deriveAnswers(agg, slots)).toEqual({ c1: "maybe", c2: "no" });
    expect(deriveAnswers(agg, { "2026-12-01T10:00": "yes" })).toEqual({});
    expect(slotsFromAnswers(agg, { c1: "yes", c2: "no" })).toEqual({ "2026-12-01T10:00": "yes", "2026-12-01T10:30": "no", "2026-12-01T11:00": "no" });
  });
});

describe("service rules", () => {
  it("guards state transitions", () => {
    const agg = poll();
    expect(agg.poll.status).toBe("open"); // polls open on creation (no drafts)
    expect(() => svc.reopen(agg, null, NOW)).toThrow(AppError);
    svc.close(agg);
    expect(() => svc.submitResponse(agg, { display_name: "x", answers: {} }, NOW)).toThrowError("not_accepting");
    svc.reopen(agg, null, NOW);
    svc.finalize(agg, "c2");
    expect(agg.poll.status).toBe("finalized");
    expect(() => svc.patch(agg, { remove_candidate_ids: ["c2"] }, NOW)).toThrowError("validation_failed");
    svc.unfinalize(agg);
    svc.cancel(agg);
    expect(() => svc.patch(agg, { title: "y" }, NOW)).toThrowError("invalid_state");
  });

  it("treats an open poll past its deadline as closed", () => {
    const agg = poll({ response_deadline: "2026-11-20T00:00" });
    expect(() => svc.submitResponse(agg, { display_name: "late", answers: {} }, Date.UTC(2026, 10, 25))).toThrowError("not_accepting");
  });

  it("prevents invitees from answering twice or by typed name, merges updates", () => {
    const agg = poll();
    expect(() => svc.submitResponse(agg, { display_name: " a ", answers: {} }, NOW)).toThrowError("use_participant_id");
    const p = svc.submitResponse(agg, { participant_id: "p1", answers: { c1: "yes", c2: "no" } }, NOW);
    expect(() => svc.submitResponse(agg, { participant_id: "p1", answers: {} }, NOW)).toThrowError("already_responded");
    svc.updateResponse(agg, p, { answers: { c2: "yes", c1: null } }, {}, NOW);
    expect(p.answers).toEqual({ c2: "yes" });
    svc.updateResponse(agg, p, { answers: { c3: "maybe" } }, { replaceAll: true }, NOW);
    expect(p.answers).toEqual({ c3: "maybe" });
    expect(() => svc.submitResponse(agg, { display_name: "x", answers: { c9: "yes" } }, NOW)).toThrowError("candidate_not_found");
    expect(() => svc.submitResponse(agg, { display_name: "x", answers: { c1: "perhaps" } }, NOW)).toThrowError("validation_failed");
  });

  it("refuses maybe when the poll does not allow it", () => {
    const agg = poll({ allow_maybe: false });
    expect(() => svc.submitResponse(agg, { display_name: "x", answers: { c1: "maybe" } }, NOW)).toThrowError("invalid_answer");
  });

  it("checks the version on edits", () => {
    const agg = poll();
    expect(() => svc.patch(agg, { title: "new", version: 99 }, NOW)).toThrowError("version_conflict");
    svc.patch(agg, { title: "new", add_candidates: [{ start: "2026-12-03T10:00" }], set_required: { p2: true } }, NOW);
    expect(agg.poll.title).toBe("new");
    expect(agg.candidates.filter((c) => !c.deleted)).toHaveLength(4);
    expect(() => svc.patch(agg, {}, NOW)).toThrowError("validation_failed");
  });
});

describe("views", () => {
  it("public view hides organizer-only data", () => {
    const agg = poll({ basis: "secret memo", participants: [{ display_name: "A", email: "a@example.com" }] });
    const v = JSON.stringify(publicView(agg, links));
    expect(v).not.toContain("secret memo");
    expect(v).not.toContain("a@example.com");
    expect(v).not.toContain(agg.poll.id);
    expect(v).not.toContain(agg.poll.manageNonce);
  });

  it("CSV neutralizes spreadsheet formulas", () => {
    const agg = poll();
    svc.submitResponse(agg, { display_name: "=HYPERLINK(\"x\")", answers: { c1: "yes" }, comment: "+1" }, NOW);
    const csv = exportCsv(agg, "ja");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+1");
  });
});
