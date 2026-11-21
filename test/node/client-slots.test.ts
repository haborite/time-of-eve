/** New poll page logic (src/client/new/slots.ts): chosen slots → candidates → poll JSON. */
import { describe, expect, it } from "vitest";
import { blocksOf, candidates, hm, isoAt, NSLOT, parsePeople, pollJson, type Times } from "../../src/client/new/slots";

const times = (o: Record<string, number[]>): Times => new Map(Object.entries(o).map(([k, v]) => [k, new Set(v)]));

describe("slots", () => {
  it("formats slot boundaries", () => {
    expect(hm(0)).toBe("00:00");
    expect(hm(27)).toBe("13:30");
    expect(hm(26.5)).toBe("13:15");
    expect(hm(NSLOT)).toBe("24:00");
  });

  it("rolls 24:00 into the next day (also across months)", () => {
    expect(isoAt("2026-12-01", 26)).toBe("2026-12-01T13:00");
    expect(isoAt("2026-12-31", NSLOT)).toBe("2027-01-01T00:00");
  });

  it("merges consecutive slots into blocks", () => {
    expect(blocksOf([7, 1, 3, 2])).toEqual([[1, 4], [7, 8]]);
    expect(blocksOf([])).toEqual([]);
  });

  it("slides a meeting-length window every 30 minutes and counts short stretches", () => {
    // 13:00–15:00 and a lone 18:00–18:30, 60-minute meeting (2 slots)
    const c = candidates(times({ "2026-12-02": [26, 27, 28, 29, 36], "2026-12-01": [20, 21] }), 2, "slide");
    expect(c.list).toEqual([
      ["2026-12-01", 20, 22],
      ["2026-12-02", 26, 28], ["2026-12-02", 27, 29], ["2026-12-02", 28, 30],
    ]);
    expect(c.fragments).toBe(1);
  });

  it("starts every 15 minutes for a 15-minute meeting", () => {
    expect(candidates(times({ "2026-12-01": [26] }), 0.5, "slide").list).toEqual([
      ["2026-12-01", 26, 26.5], ["2026-12-01", 26.5, 27],
    ]);
  });

  it("keeps each stretch as one candidate in block mode", () => {
    const c = candidates(times({ "2026-12-01": [26, 27, 28, 36] }), 2, "block");
    expect(c.list).toEqual([["2026-12-01", 26, 29], ["2026-12-01", 36, 37]]);
    expect(c.fragments).toBe(0);
  });

  it("reads required participants from a leading *", () => {
    expect(parsePeople(" *Lead \n\nMember A\n")).toEqual([
      { display_name: "Lead", required: true },
      { display_name: "Member A", required: false },
    ]);
  });

  it("builds schema 1.0 JSON", () => {
    const form = {
      title: " Sync ", description: " ", timezone: "Asia/Tokyo", showNames: true, allowMaybe: false,
      durationMinutes: 60, split: "slide" as const, deadline: "", people: "",
    };
    const data = pollJson(form, [["2026-12-01", 46, 48]], new Date(2026, 10, 21), () => 0.5);
    expect(data).toEqual({
      title: "Sync", description: "", timezone: "Asia/Tokyo", show_participant_names: true, allow_maybe: false,
      candidates: [{ start: "2026-12-01T23:00", end: "2026-12-02T00:00" }], participants: [],
      duration_minutes: 60, client_request_id: "web-2026-11-21-i",
    });
    const block = pollJson({ ...form, split: "block", deadline: "2026-11-30T18:00" }, []);
    expect(block.duration_minutes).toBeUndefined();
    expect(block.response_deadline).toBe("2026-11-30T18:00");
  });
});
