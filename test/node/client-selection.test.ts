/** New poll page state (src/client/new/selection.ts): dates, slots, bulk range and shown hours. */
import { describe, expect, it } from "vitest";
import { Selection } from "../../src/client/new/selection";

const slots = (s: Selection, day: string) => [...s.slots(day)].sort((a, b) => a - b);

describe("Selection", () => {
  it("adds dates empty, or with the bulk range once one is set", () => {
    const s = new Selection();
    s.setDate("2026-12-02", true);
    s.setDate("2026-12-01", true);
    expect(s.dates()).toEqual(["2026-12-01", "2026-12-02"]);
    expect(slots(s, "2026-12-01")).toEqual([]);
    s.applyBulk([26, 28]);
    expect(slots(s, "2026-12-01")).toEqual([26, 27]);
    s.setDate("2026-12-03", true);
    expect(slots(s, "2026-12-03")).toEqual([26, 27]);
    s.setDate("2026-12-03", true);   // already there: keeps its slots
    expect(slots(s, "2026-12-03")).toEqual([26, 27]);
    s.setDate("2026-12-03", false);
    expect(s.has("2026-12-03")).toBe(false);
  });

  it("widens the shown hours to the bulk range", () => {
    const s = new Selection();
    s.applyBulk([14, 47]);   // 07:00–23:30
    expect([s.viewFrom, s.viewTo]).toEqual([7, 24]);
    expect(s.visibleSlots()).toEqual([14, 48]);
  });

  it("keeps the shown hours a non-empty range", () => {
    const s = new Selection();
    s.setViewFrom(22);
    expect([s.viewFrom, s.viewTo]).toEqual([22, 23]);
    s.setViewTo(3);
    expect([s.viewFrom, s.viewTo]).toEqual([2, 3]);
    s.setViewFrom(0);
    expect([s.viewFrom, s.viewTo]).toEqual([0, 3]);
  });

  it("clears slots but keeps dates", () => {
    const s = new Selection();
    s.setDate("2026-12-01", true);
    s.applyBulk([26, 28]);
    expect(s.hasSlots()).toBe(true);
    s.clearSlots();
    expect(s.hasSlots()).toBe(false);
    expect(s.bulk).toBeNull();
    expect(s.dates()).toEqual(["2026-12-01"]);
  });

  it("paints a rectangle on top of a snapshot, restoring rows outside it", () => {
    const s = new Selection();
    const rows = ["2026-12-01", "2026-12-02", "2026-12-03"];
    for (const d of rows) s.setDate(d, true);
    s.applyBulk([10, 12]);
    const base = s.snapshot();
    s.paint(base, rows, [0, 2], [11, 13], true);
    s.paint(base, rows, [1, 2], [11, 13], true);   // the drag shrank: row 0 goes back to the snapshot
    expect(slots(s, "2026-12-01")).toEqual([10, 11]);
    expect(slots(s, "2026-12-02")).toEqual([10, 11, 12, 13]);
    s.paint(base, rows, [2, 2], [10, 10], false);
    expect(slots(s, "2026-12-03")).toEqual([11]);
  });
});
