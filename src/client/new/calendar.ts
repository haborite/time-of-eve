/**
 * New poll page, STEP 2: two months of days. Tap a day, or drag across days, to add or remove dates
 * (every day touched by one drag gets the opposite of the first day's state).
 */
import { WEEKDAYS } from "../../shared/i18n-format";
import { $, capturePointer, closest, el, elementAt } from "../lib/dom";
import { LANG, LOCALE, localDay, T, weekendClass } from "../lib/i18n";
import type { Selection } from "./selection";
import { parseDay, ymdOf, type Day } from "./slots";

/** Calendar columns start on Sunday; WEEKDAYS are Monday-first. */
const CAL_WEEKDAYS = [6, 0, 1, 2, 3, 4, 5];
const DAY_SEL = "button.day:not(:disabled)";

export interface Calendar {
  render(): void;
}

/** @param onChange called after dates were added or removed */
export function createCalendar(sel: Selection, today: Date, onChange: () => void): Calendar {
  const host = $("cal-months");
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  // start at the month of the first chosen date (a restored draft), else this month
  const first = sel.dates()[0];
  let view = first ? new Date(parseDay(first).getFullYear(), parseDay(first).getMonth(), 1) : new Date(thisMonth);

  function render(): void {
    host.innerHTML = "";
    for (let k = 0; k < 2; k++) {
      const m0 = new Date(view.getFullYear(), view.getMonth() + k, 1);
      const box = el("div", "cal-month");
      box.appendChild(el("div", "cal-label", m0.toLocaleDateString(LOCALE, { year: "numeric", month: "long" })));
      const g = el("div", "cal-grid");
      for (const wd of CAL_WEEKDAYS) g.appendChild(el("div", "wd" + weekendClass(wd), WEEKDAYS[LANG][wd]));
      for (let i = 0; i < m0.getDay(); i++) g.appendChild(el("div"));
      const n = new Date(m0.getFullYear(), m0.getMonth() + 1, 0).getDate();
      for (let d = 1; d <= n; d++) {
        const dt = new Date(m0.getFullYear(), m0.getMonth(), d), key = ymdOf(dt), on = sel.has(key);
        const b = el("button", "day" + weekendClass(localDay(dt).weekday) + (on ? " sel" : "") + (+dt === +today ? " today" : ""), String(d));
        b.type = "button";
        b.dataset.date = key;
        b.setAttribute("aria-pressed", String(on));
        b.setAttribute("aria-label", dt.toLocaleDateString(LOCALE, { month: "long", day: "numeric", weekday: "short" }));
        if (dt < today) b.disabled = true;
        g.appendChild(b);
      }
      box.appendChild(g);
      host.appendChild(box);
    }
    $("date-count").textContent = sel.size ? T("{n}日 選択中", { n: sel.size }) : "";
    $<HTMLButtonElement>("cal-prev").disabled = view <= thisMonth;
  }

  function syncDay(b: HTMLElement): void {
    const on = sel.has(b.dataset.date!);
    b.classList.toggle("sel", on);
    b.setAttribute("aria-pressed", String(on));
  }

  let drag: { on: boolean; id: number; seen: Set<Day> } | null = null;
  function touch(b: HTMLElement): void {
    const key = b.dataset.date!;
    if (!drag || drag.seen.has(key)) return;
    drag.seen.add(key);
    sel.setDate(key, drag.on);
    syncDay(b);
  }
  host.addEventListener("pointerdown", (e) => {
    const b = closest(e.target, DAY_SEL);
    if (!b || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    drag = { on: !sel.has(b.dataset.date!), id: e.pointerId, seen: new Set() };
    capturePointer(host, e.pointerId);
    touch(b);
  });
  host.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const b = elementAt(e.clientX, e.clientY, DAY_SEL);
    if (b) touch(b);
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    onChange();
  };
  host.addEventListener("pointerup", end);
  host.addEventListener("pointercancel", end);
  // keyboard: Enter/Space fire click without a pointerdown
  host.addEventListener("click", (e) => {
    const b = closest(e.target, DAY_SEL);
    if (!b || e.detail !== 0) return;
    const key = b.dataset.date!;
    sel.setDate(key, !sel.has(key));
    onChange();
    host.querySelector<HTMLElement>(`button.day[data-date="${key}"]`)?.focus();
  });
  $("cal-prev").addEventListener("click", () => { view.setMonth(view.getMonth() - 1); render(); });
  $("cal-next").addEventListener("click", () => { view.setMonth(view.getMonth() + 1); render(); });

  return { render };
}
