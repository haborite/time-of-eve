/** Public page layout (src/client/public/timeline.ts): poll slots placed in the display time zone. */
import { describe, expect, it } from "vitest";
import { fmtRange, layoutTimeline, zoneOf } from "../../src/client/public/timeline";

/** Tokyo poll (UTC+9): 30-minute slots from `hh:mm` JST on 2026-12-01, `n` of them. */
function tokyoSlots(h: number, mi: number, n: number) {
  const open: Record<string, string[]> = {}, at: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const ms = Date.UTC(2026, 11, 1, h - 9, mi + i * 30);
    const local = new Date(ms + 9 * 3600e3);
    const key = local.toISOString().slice(0, 16);
    open[key] = ["c1"];
    at[key] = ms;
  }
  return { step: 30, open, at };
}

describe("timeline layout", () => {
  it("lays out in the poll's own zone with one spare hour either side", () => {
    const l = layoutTimeline(tokyoSlots(13, 0, 4), "Asia/Tokyo", "ja");   // 13:00–15:00
    expect(l.days).toHaveLength(1);
    const d = l.days[0];
    expect(d.label).toBe("2026/12/1(火)");
    expect(d.short).toBe("12/1(火)");
    expect(d.phase).toBe(0);
    expect(d.groups.map((g) => g.m / 60)).toEqual([12, 13, 14, 15]);
    expect(d.cols).toHaveLength(8);
    expect(d.open).toEqual(["2026-12-01T13:00", "2026-12-01T13:30", "2026-12-01T14:00", "2026-12-01T14:30"]);
    expect(l.openOrder).toEqual(d.open);
    expect(l.minOf["2026-12-01T13:30"]).toBe(13 * 60 + 30);
  });

  it("uses :15/:45 columns for a zone offset by 45 minutes", () => {
    // 13:00 JST = 09:45 in Asia/Kathmandu (UTC+5:45)
    const l = layoutTimeline(tokyoSlots(13, 0, 2), "Asia/Kathmandu", "en");
    const d = l.days[0];
    expect(d.phase).toBe(15);
    expect(d.cols.filter((c) => c.key).map((c) => c.m)).toEqual([9 * 60 + 45, 10 * 60 + 15]);
    expect(d.label).toBe("Tue, Dec 1, 2026");
  });

  it("splits a window crossing midnight into two days and leaves out empty hours", () => {
    // 13:00–17:00 JST = 23:00–03:00 in New York (UTC-5 in December)
    const l = layoutTimeline(tokyoSlots(13, 0, 8), "America/New_York", "en");
    expect(l.days.map((d) => d.short)).toEqual(["Mon 11/30", "Tue 12/1"]);
    const hours = l.days[0].groups.map((g) => g.m / 60);
    expect(hours).toEqual([0, 1, 2, 3, 22, 23]);
    expect(l.days[0].groups.find((g) => g.m === 22 * 60)?.gap).toBe(true);
    expect(l.days[0].open).toHaveLength(2);
    expect(l.days[1].open).toHaveLength(6);
    expect(l.openOrder[0]).toBe("2026-12-01T13:00");
  });

  it("is empty without slots", () => {
    expect(layoutTimeline({ step: 30, open: {}, at: {} }, "Asia/Tokyo", "ja")).toEqual({ days: [], openOrder: [], minOf: {} });
  });
});

describe("time zone choice", () => {
  it("resolves local / poll / explicit zones and falls back to the poll's zone", () => {
    expect(zoneOf("local", "Europe/Paris", "Asia/Tokyo")).toBe("Europe/Paris");
    expect(zoneOf("poll", "Europe/Paris", "Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(zoneOf("America/New_York", "Europe/Paris", "Asia/Tokyo")).toBe("America/New_York");
    expect(zoneOf("Not/AZone", "Europe/Paris", "Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it("formats ranges with the end date only when it differs", () => {
    const s = Date.UTC(2026, 11, 1, 4, 0);
    expect(fmtRange("ja", s, s + 3600e3, "Asia/Tokyo")).toBe("2026/12/1(火) 13:00–14:00");
    expect(fmtRange("en", s, s + 3600e3, "America/New_York")).toBe("Mon, Nov 30, 2026 23:00–12/1 00:00");
  });
});
