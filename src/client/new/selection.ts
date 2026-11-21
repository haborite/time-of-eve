/**
 * New poll page: what the organizer has chosen so far — dates, slots per date, the "bulk" time range given to newly
 * added dates, and the hours the time grid shows. No DOM, so the rules are unit-tested.
 */
import { SLOT, type Day, type Times } from "./slots";

/** [from, to) slot indices */
export type SlotRange = [number, number];

export class Selection {
  /** Chosen dates → slot indices. */
  readonly times: Times = new Map();
  /** Slots given to dates added later ("一括設定"), or null. */
  bulk: SlotRange | null = null;
  /** Hours shown in the grid: [viewFrom, viewTo). */
  viewFrom = 8;
  viewTo = 20;

  get size(): number {
    return this.times.size;
  }

  has(day: Day): boolean {
    return this.times.has(day);
  }

  slots(day: Day): Set<number> {
    return this.times.get(day) ?? new Set();
  }

  dates(): Day[] {
    return [...this.times.keys()].sort();
  }

  /** Add (with the bulk slots) or remove a date. */
  setDate(day: Day, on: boolean): void {
    if (on && !this.times.has(day)) this.times.set(day, new Set(this.bulk ? range(this.bulk) : []));
    else if (!on) this.times.delete(day);
  }

  /** Give every chosen date (and dates added later) exactly these slots, and show them. */
  applyBulk(r: SlotRange): void {
    this.bulk = r;
    for (const k of this.times.keys()) this.times.set(k, new Set(range(r)));
    this.viewFrom = Math.min(this.viewFrom, Math.floor((r[0] * SLOT) / 60));
    this.viewTo = Math.max(this.viewTo, Math.ceil((r[1] * SLOT) / 60));
  }

  /** Remove all slots (dates stay) and forget the bulk range. */
  clearSlots(): void {
    this.bulk = null;
    for (const k of this.times.keys()) this.times.set(k, new Set());
  }

  hasSlots(): boolean {
    return [...this.times.values()].some((s) => s.size > 0);
  }

  /** Change the first shown hour; the last one moves along if needed. */
  setViewFrom(h: number): void {
    this.viewFrom = h;
    if (this.viewTo <= h) this.viewTo = Math.min(24, h + 1);
  }

  /** Change the end of the shown hours; the first one moves along if needed. */
  setViewTo(h: number): void {
    this.viewTo = h;
    if (h <= this.viewFrom) this.viewFrom = Math.max(0, h - 1);
  }

  /** Slot indices the grid shows: [from, to). */
  visibleSlots(): SlotRange {
    return [(this.viewFrom * 60) / SLOT, (this.viewTo * 60) / SLOT];
  }

  /** Copy of the slots, to paint a drag on top of. */
  snapshot(): Map<Day, number[]> {
    return new Map([...this.times].map(([k, s]) => [k, [...s]]));
  }

  /**
   * Paint (on) or erase (off) slots [ia, ib] (inclusive) on the dates rows[ra..rb], on top of `base`;
   * every other date gets its slots from `base` back.
   */
  paint(base: Map<Day, number[]>, rows: Day[], [ra, rb]: [number, number], [ia, ib]: [number, number], on: boolean): void {
    rows.forEach((day, r) => {
      const s = new Set(base.get(day));
      if (r >= ra && r <= rb) {
        for (let i = ia; i <= ib; i++) {
          if (on) s.add(i);
          else s.delete(i);
        }
      }
      this.times.set(day, s);
    });
  }
}

function range([a, b]: SlotRange): number[] {
  const out: number[] = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}
