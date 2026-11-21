/**
 * New poll page, STEP 3: paint times per chosen date, plus its toolbar (bulk range, reset, shown hours).
 * Tap = one meeting length from the cell; drag = rectangle across dates (horizontal) or a range within the date
 * (vertical, narrow screens). Arrows move, Space/Enter acts like a tap.
 */
import { $, button, capturePointer, closest, el, elementAt, focusOnly, option, pad, releasePointer } from "../lib/dom";
import { hourLabel, localDay, shortDate, T, weekendClass } from "../lib/i18n";
import type { Selection } from "./selection";
import { hm, NSLOT, parseDay, SLOT, type Day } from "./slots";

const CELL_SEL = ".tl-cell.on";

export interface TimeGrid {
  render(): void;
}

export interface TimeGridOptions {
  /** Meeting length in slots. */
  durSlots: () => number;
  /** Matches when the vertical layout is used. */
  narrow: MediaQueryList;
  /** Slots changed. */
  onSlotsChange: () => void;
  /** A date was removed from the grid. */
  onDatesChange: () => void;
  showError: (msg: string) => void;
}

export function createTimeGrid(sel: Selection, opts: TimeGridOptions): TimeGrid {
  const host = $("time-grid");
  let rows: Day[] = [];                          // dates in display order
  let cellOf = new Map<string, HTMLElement>();   // "row:slot" → cell

  function paintCell(r: number, i: number): void {
    const c = cellOf.get(r + ":" + i);
    if (!c) return;
    const on = sel.slots(rows[r]).has(i);
    c.classList.toggle("m-sel", on);
    c.setAttribute("aria-pressed", String(on));
    c.setAttribute("aria-label", rows[r] + " " + hm(i) + "–" + hm(i + 1) + (on ? " " + T("選択中") : ""));
  }
  function paintAll(): void {
    const [a, b] = sel.visibleSlots();
    rows.forEach((_, r) => { for (let i = a; i < b; i++) paintCell(r, i); });
  }

  function dateLabel(key: Day): { text: string; cls: string } {
    const d = parseDay(key);
    return { text: shortDate(d), cls: weekendClass(localDay(d).weekday) };
  }
  function removeBtn(key: Day): HTMLButtonElement {
    const b = button("btn-linklike small", T("外す"), () => { sel.setDate(key, false); opts.onDatesChange(); });
    b.title = T("この日を外す");
    b.setAttribute("aria-label", T("この日を外す"));
    return b;
  }
  function makeCell(tag: "td" | "div", r: number, i: number, extra = ""): HTMLElement {
    const c = el(tag, "tl-cell on" + extra);
    c.dataset.r = String(r);
    c.dataset.i = String(i);
    c.setAttribute("role", "button");
    c.tabIndex = -1;
    if ((i * SLOT) % 60 === 0) c.classList.add("hr");
    cellOf.set(r + ":" + i, c);
    return c;
  }

  function render(): void {
    host.innerHTML = "";
    cellOf = new Map();
    rows = sel.dates();
    if (!rows.length) {
      host.className = "";
      host.appendChild(el("p", "empty-note", T("STEP 2 で日付を選んでください")));
      return;
    }
    const [a, b] = sel.visibleSlots(), perHour = 60 / SLOT;
    if (!opts.narrow.matches) {
      host.className = "tl-scroll";
      const t = el("table", "tl tl-ans tl-new");
      t.style.setProperty("--cols", String(b - a));
      const hr = el("tr", "tl-headrow");
      hr.appendChild(el("th", "tl-name", T("日付")));
      for (let h = sel.viewFrom; h < sel.viewTo; h++) {
        const th = el("th", "tl-hour", pad(h));
        th.colSpan = perHour;
        th.scope = "col";
        hr.appendChild(th);
      }
      t.appendChild(hr);
      rows.forEach((key, r) => {
        const tr = el("tr", "tl-candrow");
        const lab = dateLabel(key);
        const nth = el("th", "tl-name tl-date" + lab.cls);
        nth.scope = "row";
        nth.appendChild(el("div", "", lab.text));
        nth.appendChild(removeBtn(key));
        tr.appendChild(nth);
        for (let i = a; i < b; i++) tr.appendChild(makeCell("td", r, i));
        t.appendChild(tr);
      });
      host.appendChild(t);
    } else {
      host.className = "tl-vertical";
      rows.forEach((key, r) => {
        const box = el("div", "v-day");
        const head = el("div", "v-head");
        const lab = dateLabel(key);
        head.appendChild(el("span", "v-date" + lab.cls, lab.text));
        head.appendChild(removeBtn(key));
        box.appendChild(head);
        for (let h = sel.viewFrom; h < sel.viewTo; h++) {
          const row = el("div", "v-row");
          row.appendChild(el("span", "v-time", hourLabel(h)));
          for (let j = 0; j < perHour; j++) {
            const i = h * perHour + j;
            const c = makeCell("div", r, i, " v-cell");
            c.appendChild(el("span", "v-min", ":" + pad((i * SLOT) % 60)));
            row.appendChild(c);
          }
          box.appendChild(row);
        }
        host.appendChild(box);
      });
    }
    paintAll();
    const first = cellOf.get("0:" + a);
    if (first) first.tabIndex = 0;
  }

  // ---------- painting ----------
  interface Stroke { r0: number; i0: number; on: boolean; id?: number; moved: boolean; base: Map<Day, number[]> }
  let drag: Stroke | null = null;

  function startStroke(c: HTMLElement, id?: number): Stroke {
    const r = Number(c.dataset.r), i = Number(c.dataset.i);
    return { r0: r, i0: i, on: !sel.slots(rows[r]).has(i), id, moved: false, base: sel.snapshot() };
  }
  /** Apply a stroke from its start cell to (r1, i1). Not moved yet = a tap: one meeting length. */
  function applyStroke(s: Stroke, r1: number, i1: number): void {
    const vertical = opts.narrow.matches;
    const rowRange: [number, number] = vertical ? [s.r0, s.r0] : [Math.min(s.r0, r1), Math.max(s.r0, r1)];
    const slotRange: [number, number] = r1 === s.r0 && i1 === s.i0 && !s.moved
      ? [s.i0, Math.min(NSLOT, s.i0 + opts.durSlots()) - 1]
      : [Math.min(s.i0, i1), Math.max(s.i0, i1)];
    sel.paint(s.base, rows, rowRange, slotRange, s.on);
    paintAll();
  }
  function autoScroll(y: number): void {
    if (y < 60) window.scrollBy(0, -14);
    else if (y > window.innerHeight - 140) window.scrollBy(0, 14);
  }

  host.addEventListener("pointerdown", (e) => {
    const c = closest(e.target, CELL_SEL);
    if (!c || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    drag = startStroke(c, e.pointerId);
    capturePointer(host, e.pointerId);
    applyStroke(drag, drag.r0, drag.i0);
    focusOnly(cellOf.values(), c);
  });
  host.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    autoScroll(e.clientY);
    const c = elementAt(e.clientX, e.clientY, "#time-grid " + CELL_SEL);
    if (!c) return;
    const r = Number(c.dataset.r), i = Number(c.dataset.i);
    if (!drag.moved && r === drag.r0 && i === drag.i0) return;
    drag.moved = true;
    applyStroke(drag, r, i);
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    releasePointer(host, e.pointerId);
    opts.onSlotsChange();
  };
  host.addEventListener("pointerup", end);
  host.addEventListener("pointercancel", end);
  host.addEventListener("contextmenu", (e) => { if (closest(e.target, CELL_SEL)) e.preventDefault(); });
  host.addEventListener("keydown", (e) => {
    const c = closest(e.target, CELL_SEL);
    if (!c) return;
    const r = Number(c.dataset.r), i = Number(c.dataset.i), [a, b] = sel.visibleSlots();
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      applyStroke(startStroke(c), r, i);
      opts.onSlotsChange();
      return;
    }
    const vertical = opts.narrow.matches;
    let nr = r, ni = i;
    if (e.key === "ArrowRight") ni = i + 1;
    else if (e.key === "ArrowLeft") ni = i - 1;
    else if (e.key === "ArrowDown") { if (vertical) ni = i + 60 / SLOT; else nr = r + 1; }
    else if (e.key === "ArrowUp") { if (vertical) ni = i - 60 / SLOT; else nr = r - 1; }
    else return;
    e.preventDefault();
    if (ni >= b) { ni = a; nr++; } else if (ni < a) { ni = b - 1; nr--; }
    const n = cellOf.get(nr + ":" + ni);
    if (n) focusOnly(cellOf.values(), n);
  });
  opts.narrow.addEventListener("change", render);

  // ---------- toolbar ----------
  function fillSelect(s: HTMLSelectElement, from: number, to: number, value: number, fmt: (i: number) => string): void {
    s.innerHTML = "";
    for (let i = from; i <= to; i++) s.appendChild(option(i, fmt(i)));
    s.value = String(value);
  }
  const bulkFrom = $<HTMLSelectElement>("bulk-from"), bulkTo = $<HTMLSelectElement>("bulk-to");
  const viewFrom = $<HTMLSelectElement>("view-from"), viewTo = $<HTMLSelectElement>("view-to");
  fillSelect(bulkFrom, 0, NSLOT - 1, 20, hm);
  fillSelect(bulkTo, 1, NSLOT, 36, hm);
  function syncView(): void {
    fillSelect(viewFrom, 0, 23, sel.viewFrom, hourLabel);
    fillSelect(viewTo, 1, 24, sel.viewTo, hourLabel);
  }
  syncView();
  viewFrom.addEventListener("change", () => { sel.setViewFrom(Number(viewFrom.value)); syncView(); render(); });
  viewTo.addEventListener("change", () => { sel.setViewTo(Number(viewTo.value)); syncView(); render(); });

  $("bulk-set").addEventListener("click", () => {
    const a = Number(bulkFrom.value), b = Number(bulkTo.value);
    if (b <= a) {
      opts.showError(T("終了は開始より後にしてください"));
      return;
    }
    opts.showError("");
    sel.applyBulk([a, b]);
    syncView();
    render();
    opts.onSlotsChange();
  });
  $("reset-all").addEventListener("click", () => {
    if (sel.hasSlots() && !confirm(T("選んだ時間をすべて外しますか？（日付の選択はそのままです）"))) return;
    sel.clearSlots();
    render();
    opts.onSlotsChange();
  });

  return { render };
}
