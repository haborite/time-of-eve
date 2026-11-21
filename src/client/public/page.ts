/** Public answer page: what the page's parts share (the server data, the current layout, marks, headings). */
import type { Answer, PublicBoot, SlotKey } from "../../shared/public-boot";
import { button, el, pad } from "../lib/dom";
import { T, weekendClass } from "../lib/i18n";
import { clock, slotText as slotTextIn, type DayRow, type Layout } from "./timeline";

/** The page's state shared by its parts. `layout` is replaced when the display time zone changes. */
export interface Page {
  readonly boot: PublicBoot;
  layout: Layout;
}

export const SYM: Record<Answer, string> = { yes: "○", maybe: "△", no: "×" };
export const LABEL: Record<Answer, string> = { yes: T("参加/可"), maybe: T("未定"), no: T("不参加/不可") };
export const UNSET = T("未記入");
export const MARK_CLASSES = ["m-yes", "m-maybe", "m-no"];
export const markClass = (v: Answer): string => "m-" + v;

/** "13:00–13:30" for a slot in the current layout. */
export function slotText(page: Page, k: SlotKey): string {
  return slotTextIn(page.layout, k, page.boot.timeline.step);
}

/** Date + hour headings. With `onAll` (answer grid) the date cell gets a "この日すべて" button. */
export function headRow(d: DayRow, onAll: ((d: DayRow) => void) | null): HTMLTableRowElement {
  const tr = el("tr", "tl-headrow");
  const th = el("th", "tl-name tl-date" + weekendClass(d.weekday));
  th.scope = onAll ? "row" : "col";
  if (onAll) th.rowSpan = 2;   // answer grid: date cell spans hour labels + slot row (compact)
  const lab = el("div", "");
  lab.appendChild(el("span", "lbl-full", d.label));
  lab.appendChild(el("span", "lbl-short", d.short));
  th.appendChild(lab);
  if (onAll) th.appendChild(button("btn-linklike small", T("この日すべて"), () => onAll(d)));
  tr.appendChild(th);
  for (const g of d.groups) {
    if (!g.span) continue;
    const hth = el("th", "tl-hour" + (g.gap ? " gap" : ""), d.phase ? clock(g.m) : pad(Math.floor(g.m / 60) % 24));
    hth.colSpan = g.span;
    hth.scope = "col";
    tr.appendChild(hth);
  }
  return tr;
}
