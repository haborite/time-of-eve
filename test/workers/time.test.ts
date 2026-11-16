import { describe, expect, it } from "vitest";
import { fromLocal, isoLocal, isValidTimeZone, offsetMinutes, parseIsoDateTime, slotKey, toLocal } from "../../src/lib/time";

describe("time zones (Intl)", () => {
  it("formats ISO with the zone offset", () => {
    const ms = Date.UTC(2026, 11, 1, 4, 0);
    expect(isoLocal(ms, "Asia/Tokyo")).toBe("2026-12-01T13:00:00+09:00");
    expect(isoLocal(ms, "America/New_York")).toBe("2026-11-30T23:00:00-05:00");
    expect(slotKey(ms, "Asia/Tokyo")).toBe("2026-12-01T13:00");
  });

  it("knows DST offsets", () => {
    expect(offsetMinutes(Date.UTC(2027, 0, 15), "America/New_York")).toBe(-300);
    expect(offsetMinutes(Date.UTC(2027, 6, 15), "America/New_York")).toBe(-240);
    expect(offsetMinutes(Date.UTC(2027, 6, 15), "Asia/Kolkata")).toBe(330);
  });

  it("resolves local wall-clock time, rejects DST gaps and flags overlaps", () => {
    const r = fromLocal("Asia/Tokyo", 2026, 12, 1, 13, 0);
    expect(r).toEqual({ ok: true, ms: Date.UTC(2026, 11, 1, 4, 0), ambiguous: false });
    expect(fromLocal("America/New_York", 2027, 3, 14, 2, 30)).toEqual({ ok: false, reason: "nonexistent" });
    const amb = fromLocal("America/New_York", 2027, 11, 7, 1, 30);
    expect(amb.ok && amb.ambiguous).toBe(true);
    expect(amb.ok && isoLocal(amb.ms, "America/New_York")).toBe("2027-11-07T01:30:00-04:00");
  });

  it("parses ISO strings", () => {
    expect(parseIsoDateTime("2026-12-01T13:00")).toMatchObject({ y: 2026, mo: 12, d: 1, h: 13, mi: 0, offset: null });
    expect(parseIsoDateTime("2026-12-01T13:00:00+09:00")?.offset).toBe(540);
    expect(parseIsoDateTime("2026-12-01T13:00:00Z")?.offset).toBe(0);
    expect(parseIsoDateTime("2026-02-30T13:00")).toBeNull();
    expect(parseIsoDateTime("tomorrow")).toBeNull();
  });

  it("validates zone names", () => {
    expect(isValidTimeZone("Asia/Tokyo")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
    expect(toLocal(Date.UTC(2026, 10, 16), "UTC").weekday).toBe(0); // Monday
  });
});
