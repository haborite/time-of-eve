/**
 * Public answer page: the grid where a participant paints their answers.
 * Tap toggles the chosen mark on a slot; drag paints a range within the starting day, in time order (like a text
 * selection); arrows move between open slots and Space/Enter toggles. Horizontal tables, or one column per day on
 * narrow screens.
 */
import type { Answer, SlotKey } from "../../shared/public-boot";
import { button, capturePointer, closest, el, elementAt, focusOnly, pad, releasePointer } from "../lib/dom";
import { hourLabel, T, weekendClass } from "../lib/i18n";
import { headRow, LABEL, MARK_CLASSES, markClass, slotText, SYM, UNSET, type Page } from "./page";
import { clock, isHour, type Col, type DayRow } from "./timeline";

export type Answers = Record<SlotKey, Answer>;

export interface AnswerGrid {
  /** Rebuild the cells for the current layout and screen width. */
  render(): void;
  answers(): Answers;
  /** Replace all answers (and repaint). */
  setAnswers(a: Answers): void;
  /** Give every open slot without an answer the current mark. */
  fillEmpty(): void;
}

const CELL_SEL = ".tl-cell.on";

/**
 * @param host     element the grid is drawn into
 * @param scroller element scrolled while dragging near its edges (the modal body)
 * @param mark     the mark chosen in the form
 * @param narrow   matches when the vertical layout is used
 */
export function createAnswerGrid(page: Page, host: HTMLElement, scroller: HTMLElement, mark: () => Answer, narrow: MediaQueryList): AnswerGrid {
  let state: Answers = {};
  let cellOf = new Map<SlotKey, HTMLElement>();   // cells of the current render

  function paintCell(k: SlotKey): void {
    const c = cellOf.get(k);
    if (!c) return;
    const v = state[k];
    c.classList.remove(...MARK_CLASSES);
    if (v) c.classList.add(markClass(v));
    c.querySelector(".sym")!.textContent = v ? SYM[v] : "";
    const label = slotText(page, k) + " " + (v ? LABEL[v] : UNSET);
    c.setAttribute("aria-label", label);
    c.title = label;
  }
  const paintAll = () => cellOf.forEach((_, k) => paintCell(k));
  const set = (k: SlotKey, v: Answer | null | undefined) => {
    if (v) state[k] = v;
    else delete state[k];
    paintCell(k);
  };

  function makeCell(col: Col, d: DayRow, idx: number | undefined, vertical: boolean): HTMLElement {
    const c = el(vertical ? "div" : "td", "tl-cell" + (vertical ? " v-cell" : ""));
    if (col.gap) c.classList.add("gap");
    if (!col.key) {
      c.classList.add("off");
      return c;
    }
    c.dataset.key = col.key;
    c.classList.add("on");
    c.dataset.day = String(d.i);
    c.dataset.idx = String(idx);
    c.setAttribute("role", "button");
    c.tabIndex = -1;
    if (isHour(col, d)) c.classList.add("hr");
    c.appendChild(el("span", "sym"));
    if (vertical) c.appendChild(el("span", "v-min", ":" + pad(col.m % 60)));
    cellOf.set(col.key, c);
    return c;
  }

  function fillDay(d: DayRow): void {
    const m = mark();
    for (const k of d.open) set(k, m);
  }

  function render(): void {
    host.innerHTML = "";
    cellOf = new Map();
    const vertical = narrow.matches;
    host.className = vertical ? "tl-vertical" : "tl-scroll tl-horizontal";
    for (const d of page.layout.days) {
      const idxOf = new Map(d.open.map((k, i) => [k, i]));
      const idx = (c: Col) => (c.key ? idxOf.get(c.key) : undefined);
      if (!vertical) {
        const t = el("table", "tl tl-ans");
        t.style.setProperty("--cols", String(d.cols.length));
        t.appendChild(headRow(d, fillDay));
        const tr = el("tr", "tl-candrow");
        for (const c of d.cols) tr.appendChild(makeCell(c, d, idx(c), false));
        t.appendChild(tr);
        host.appendChild(t);
        continue;
      }
      const box = el("div", "v-day");
      const head = el("div", "v-head");
      head.appendChild(el("span", "v-date" + weekendClass(d.weekday), d.label));
      head.appendChild(button("btn-linklike small", T("この日すべて"), () => fillDay(d)));
      box.appendChild(head);
      if (!d.open.length) continue;
      // one row per hour group, from the first to the last group with an open slot
      const inGroup = (c: Col, m: number) => c.m >= m && c.m < m + 60;
      const used = d.groups.filter((g) => d.cols.some((c) => c.key && inGroup(c, g.m)));
      for (const g of d.groups) {
        if (g.m < used[0].m || g.m > used[used.length - 1].m) continue;
        const row = el("div", "v-row");
        row.appendChild(el("span", "v-time", d.phase ? clock(g.m) : hourLabel(Math.floor(g.m / 60) % 24)));
        for (const c of d.cols) if (inGroup(c, g.m)) row.appendChild(makeCell(c, d, idx(c), true));
        box.appendChild(row);
      }
      host.appendChild(box);
    }
    paintAll();
    const first = cellOf.get(page.layout.openOrder[0]);
    if (first) first.tabIndex = 0;
  }

  // ---------- pointer: tap / drag ----------
  let drag: { day: number; from: number; value: Answer | null; snapshot: Answers; id: number } | null = null;

  function applyRange(toIdx: number): void {
    if (!drag) return;
    const { from, value, snapshot } = drag;
    const a = Math.min(from, toIdx), b = Math.max(from, toIdx);
    page.layout.days[drag.day].open.forEach((k, i) => set(k, i >= a && i <= b ? value : snapshot[k]));
  }
  function autoScroll(y: number): void {
    const r = scroller.getBoundingClientRect();
    if (y < r.top + 48) scroller.scrollTop -= 14;
    else if (y > r.bottom - 48) scroller.scrollTop += 14;
  }

  host.addEventListener("pointerdown", (e) => {
    const c = closest(e.target, CELL_SEL);
    if (!c || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    const k = c.dataset.key!, m = mark();
    drag = { day: Number(c.dataset.day), from: Number(c.dataset.idx), value: state[k] === m ? null : m, snapshot: { ...state }, id: e.pointerId };
    capturePointer(host, e.pointerId);
    applyRange(drag.from);
    focusOnly(cellOf.values(), c);
  });
  host.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    autoScroll(e.clientY);
    const c = elementAt(e.clientX, e.clientY, CELL_SEL);
    if (c && Number(c.dataset.day) === drag.day) applyRange(Number(c.dataset.idx));
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    releasePointer(host, e.pointerId);
  };
  host.addEventListener("pointerup", end);
  host.addEventListener("pointercancel", end);
  host.addEventListener("contextmenu", (e) => { if (closest(e.target, CELL_SEL)) e.preventDefault(); });

  // ---------- keyboard ----------
  host.addEventListener("keydown", (e) => {
    const c = closest(e.target, CELL_SEL);
    if (!c) return;
    const k = c.dataset.key!, order = page.layout.openOrder, i = order.indexOf(k);
    let j: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") j = Math.min(order.length - 1, i + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = Math.max(0, i - 1);
    else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      const m = mark();
      set(k, state[k] === m ? null : m);
      return;
    } else return;
    e.preventDefault();
    const n = cellOf.get(order[j]);
    if (n) focusOnly(cellOf.values(), n);
  });

  return {
    render,
    answers: () => ({ ...state }),
    setAnswers(a) {
      state = { ...a };
      paintAll();
    },
    fillEmpty() {
      const m = mark();
      for (const k of page.layout.openOrder) if (!state[k]) set(k, m);
    },
  };
}
