/**
 * New poll page: keep what was entered when coming back from the confirmation screen (browser back, or the
 * "← 日程の選択に戻る" link to /new#restore). Kept in sessionStorage; any other visit starts empty.
 */
import { $ } from "../lib/dom";
import { loadJson, remove, saveJson } from "../lib/storage";
import type { Selection, SlotRange } from "./selection";
import { parseDay, type Day } from "./slots";

const STORE = "toe-new-draft";
/** Form fields kept as they are (element ids). */
const FIELDS = ["title", "desc", "duration", "deadline", "people", "split", "tz"] as const;
const CHECKBOXES = { maybe: "allow-maybe", names: "show-names" } as const;
/** Ids whose change should save the draft (the grid saves through the preview update). */
export const DRAFT_INPUTS = ["title", "desc", "deadline", "people", "allow-maybe", "show-names", "tz"];

type Field = (typeof FIELDS)[number];

interface Draft extends Partial<Record<Field, string>> {
  dates: Day[];
  times: Record<Day, number[]>;
  bulk: SlotRange | null;
  vFrom: number;
  vTo: number;
  maybe: boolean;
  names: boolean;
}

const field = (f: Field) => $<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(f);
const checkbox = (k: keyof typeof CHECKBOXES) => $<HTMLInputElement>(CHECKBOXES[k]);

export function saveDraft(sel: Selection): void {
  const o: Draft = {
    dates: sel.dates(), times: {}, bulk: sel.bulk, vFrom: sel.viewFrom, vTo: sel.viewTo,
    maybe: checkbox("maybe").checked, names: checkbox("names").checked,
  };
  for (const f of FIELDS) o[f] = field(f).value;
  for (const [k, s] of sel.times) o.times[k] = [...s];
  saveJson("session", STORE, o);
}

/** Fill the form and `sel` from the draft when coming back; otherwise drop the draft. Past dates are skipped. */
export function restoreDraft(sel: Selection, today: Date): void {
  const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  const back = nav?.type === "back_forward" || location.hash === "#restore";
  if (!back) {
    remove("session", STORE);
    return;
  }
  const o = loadJson<Draft | null>("session", STORE, null);
  if (!o) return;
  for (const f of FIELDS) if (typeof o[f] === "string") field(f).value = o[f]!;
  checkbox("maybe").checked = o.maybe !== false;
  checkbox("names").checked = o.names !== false;
  sel.bulk = o.bulk ?? null;
  if (Number.isInteger(o.vFrom) && Number.isInteger(o.vTo) && o.vFrom >= 0 && o.vTo <= 24 && o.vFrom < o.vTo) {
    sel.viewFrom = o.vFrom;
    sel.viewTo = o.vTo;
  }
  for (const k of o.dates ?? []) if (parseDay(k) >= today) sel.times.set(k, new Set(o.times?.[k] ?? []));
}
