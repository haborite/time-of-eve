/**
 * New poll page: STEP1 basic info, STEP2 pick dates (tap/drag), STEP3 paint times per date (tap/drag), then
 * build schema 1.0 JSON and hand it to the import confirmation screen (/new/confirm).
 */
import { $, button, capturePointer, closest, el, elementAt, focusOnly, option, pad, releasePointer } from "./lib/dom";
import { hourLabel, LANG, LOCALE, localDay, shortDate, T, weekendClass } from "./lib/i18n";
import { WEEKDAYS } from "../lib/i18n-format";
import { loadJson, remove, saveJson } from "./lib/storage";
import {
  candidates, hm, NSLOT, parseDay, pollJson, SLOT, ymdOf, type Day, type SplitMode, type Times,
} from "./new/slots";

const form = $<HTMLFormElement>("new-form");
const MAX = Number(form.dataset.max) || 600;
const narrowMq = window.matchMedia("(max-width: 640px)");

const today = new Date();
today.setHours(0, 0, 0, 0);
let view = new Date(today.getFullYear(), today.getMonth(), 1);   // first month shown
const times: Times = new Map();      // chosen dates → slot indices
let bulk: [number, number] | null = null;   // [from, to) slots applied to newly added dates
let vFrom = 8, vTo = 20;             // visible hours [vFrom, vTo)

const durSlots = (): number => Number($<HTMLSelectElement>("duration").value) / SLOT;
const sortedDates = (): Day[] => [...times.keys()].sort();
const visibleSlots = (): [number, number] => [(vFrom * 60) / SLOT, (vTo * 60) / SLOT];

function refreshAll(): void {
  renderCalendar();
  renderGrid();
  update();
}

// ---------- STEP 2: calendar ----------
const calHost = $("cal-months");
/** Calendar columns start on Sunday; WEEKDAYS are Monday-first. */
const CAL_WEEKDAYS = [6, 0, 1, 2, 3, 4, 5];

function renderCalendar(): void {
  calHost.innerHTML = "";
  for (let k = 0; k < 2; k++) {
    const m0 = new Date(view.getFullYear(), view.getMonth() + k, 1);
    const box = el("div", "cal-month");
    box.appendChild(el("div", "cal-label", m0.toLocaleDateString(LOCALE, { year: "numeric", month: "long" })));
    const g = el("div", "cal-grid");
    for (const wd of CAL_WEEKDAYS) g.appendChild(el("div", "wd" + weekendClass(wd), WEEKDAYS[LANG][wd]));
    for (let i = 0; i < m0.getDay(); i++) g.appendChild(el("div"));
    const n = new Date(m0.getFullYear(), m0.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= n; d++) {
      const dt = new Date(m0.getFullYear(), m0.getMonth(), d), key = ymdOf(dt), on = times.has(key);
      const b = el("button", "day" + weekendClass(localDay(dt).weekday) + (on ? " sel" : "") + (+dt === +today ? " today" : ""), String(d));
      b.type = "button";
      b.dataset.date = key;
      b.setAttribute("aria-pressed", String(on));
      b.setAttribute("aria-label", dt.toLocaleDateString(LOCALE, { month: "long", day: "numeric", weekday: "short" }));
      if (dt < today) b.disabled = true;
      g.appendChild(b);
    }
    box.appendChild(g);
    calHost.appendChild(box);
  }
  $("date-count").textContent = times.size ? T("{n}日 選択中", { n: times.size }) : "";
  $<HTMLButtonElement>("cal-prev").disabled = view <= new Date(today.getFullYear(), today.getMonth(), 1);
}

function setDate(key: Day, on: boolean): void {
  if (on && !times.has(key)) {
    const s = new Set<number>();
    if (bulk) for (let i = bulk[0]; i < bulk[1]; i++) s.add(i);
    times.set(key, s);
  } else if (!on) {
    times.delete(key);
  }
}

function syncDay(b: HTMLElement): void {
  const on = times.has(b.dataset.date!);
  b.classList.toggle("sel", on);
  b.setAttribute("aria-pressed", String(on));
}

// tap or drag across days: every day touched gets the state of the first one (toggled)
let calDrag: { on: boolean; id: number; seen: Set<Day> } | null = null;
const DAY_SEL = "button.day:not(:disabled)";

function touchDay(b: HTMLElement): void {
  const key = b.dataset.date!;
  if (!calDrag || calDrag.seen.has(key)) return;
  calDrag.seen.add(key);
  setDate(key, calDrag.on);
  syncDay(b);
}
calHost.addEventListener("pointerdown", (e) => {
  const b = closest(e.target, DAY_SEL);
  if (!b || (e.pointerType === "mouse" && e.button !== 0)) return;
  e.preventDefault();
  calDrag = { on: !times.has(b.dataset.date!), id: e.pointerId, seen: new Set() };
  capturePointer(calHost, e.pointerId);
  touchDay(b);
});
calHost.addEventListener("pointermove", (e) => {
  if (!calDrag || e.pointerId !== calDrag.id) return;
  const b = elementAt(e.clientX, e.clientY, DAY_SEL);
  if (b) touchDay(b);
});
function calEnd(e: PointerEvent): void {
  if (!calDrag || e.pointerId !== calDrag.id) return;
  calDrag = null;
  refreshAll();
}
calHost.addEventListener("pointerup", calEnd);
calHost.addEventListener("pointercancel", calEnd);
// keyboard: Enter/Space fire click without a pointerdown
calHost.addEventListener("click", (e) => {
  const b = closest(e.target, DAY_SEL);
  if (!b || e.detail !== 0) return;
  const key = b.dataset.date!;
  setDate(key, !times.has(key));
  refreshAll();
  calHost.querySelector<HTMLElement>(`button.day[data-date="${key}"]`)?.focus();
});
$("cal-prev").addEventListener("click", () => { view.setMonth(view.getMonth() - 1); renderCalendar(); });
$("cal-next").addEventListener("click", () => { view.setMonth(view.getMonth() + 1); renderCalendar(); });

// ---------- STEP 3: time grid ----------
function fillSelect(sel: HTMLSelectElement, from: number, to: number, value: number, fmt: (i: number) => string): void {
  sel.innerHTML = "";
  for (let i = from; i <= to; i++) sel.appendChild(option(i, fmt(i)));
  sel.value = String(value);
}
const viewFrom = $<HTMLSelectElement>("view-from"), viewTo = $<HTMLSelectElement>("view-to");
fillSelect($<HTMLSelectElement>("bulk-from"), 0, NSLOT - 1, 20, hm);
fillSelect($<HTMLSelectElement>("bulk-to"), 1, NSLOT, 36, hm);
function syncView(): void {
  fillSelect(viewFrom, 0, 23, vFrom, hourLabel);
  fillSelect(viewTo, 1, 24, vTo, hourLabel);
}
/** Widen the visible hours to show slot range [a, b). */
function ensureVisible(a: number, b: number): void {
  vFrom = Math.min(vFrom, Math.floor((a * SLOT) / 60));
  vTo = Math.max(vTo, Math.ceil((b * SLOT) / 60));
  syncView();
}
viewFrom.addEventListener("change", () => {
  vFrom = Number(viewFrom.value);
  if (vTo <= vFrom) vTo = Math.min(24, vFrom + 1);
  syncView();
  renderGrid();
});
viewTo.addEventListener("change", () => {
  vTo = Number(viewTo.value);
  if (vTo <= vFrom) vFrom = Math.max(0, vTo - 1);
  syncView();
  renderGrid();
});

const grid = $("time-grid");
let rows: Day[] = [];                          // date keys in display order
let cellOf = new Map<string, HTMLElement>();   // "row:slot" → cell
const CELL_SEL = ".tl-cell.on";

function dateLabel(key: Day): { text: string; cls: string } {
  const d = parseDay(key);
  return { text: shortDate(d), cls: weekendClass(localDay(d).weekday) };
}
function removeBtn(key: Day): HTMLButtonElement {
  const b = button("btn-linklike small", T("外す"), () => { setDate(key, false); refreshAll(); });
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
function paintCell(r: number, i: number): void {
  const c = cellOf.get(r + ":" + i);
  if (!c) return;
  const on = times.get(rows[r])!.has(i);
  c.classList.toggle("m-sel", on);
  c.setAttribute("aria-pressed", String(on));
  c.setAttribute("aria-label", rows[r] + " " + hm(i) + "–" + hm(i + 1) + (on ? " " + T("選択中") : ""));
}
function paintAll(): void {
  const [a, b] = visibleSlots();
  rows.forEach((_, r) => { for (let i = a; i < b; i++) paintCell(r, i); });
}

function renderGrid(): void {
  grid.innerHTML = "";
  cellOf = new Map();
  rows = sortedDates();
  if (!rows.length) {
    grid.className = "";
    grid.appendChild(el("p", "empty-note", T("STEP 2 で日付を選んでください")));
    return;
  }
  const [a, b] = visibleSlots(), perHour = 60 / SLOT;
  if (!narrowMq.matches) {
    grid.className = "tl-scroll";
    const t = el("table", "tl tl-ans tl-new");
    t.style.setProperty("--cols", String(b - a));
    const hr = el("tr", "tl-headrow");
    hr.appendChild(el("th", "tl-name", T("日付")));
    for (let h = vFrom; h < vTo; h++) {
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
    grid.appendChild(t);
  } else {
    grid.className = "tl-vertical";
    rows.forEach((key, r) => {
      const box = el("div", "v-day");
      const head = el("div", "v-head");
      const lab = dateLabel(key);
      head.appendChild(el("span", "v-date" + lab.cls, lab.text));
      head.appendChild(removeBtn(key));
      box.appendChild(head);
      for (let h = vFrom; h < vTo; h++) {
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
      grid.appendChild(box);
    });
  }
  paintAll();
  const first = cellOf.get("0:" + a);
  if (first) first.tabIndex = 0;
}

// tap = one meeting length from the cell; drag = rectangle (horizontal) or range within the day (vertical)
interface GridDrag { r0: number; i0: number; on: boolean; id?: number; moved: boolean; snapshot: Map<Day, number[]> }
let drag: GridDrag | null = null;

function startDrag(c: HTMLElement, id?: number): GridDrag {
  const r = Number(c.dataset.r), i = Number(c.dataset.i);
  const snapshot = new Map(rows.map((k) => [k, [...times.get(k)!]] as [Day, number[]]));
  return { r0: r, i0: i, on: !times.get(rows[r])!.has(i), id, moved: false, snapshot };
}
function applyDrag(d: GridDrag, r1: number, i1: number): void {
  const vertical = narrowMq.matches;
  const ra = vertical ? d.r0 : Math.min(d.r0, r1), rb = vertical ? d.r0 : Math.max(d.r0, r1);
  let ia: number, ib: number;
  if (r1 === d.r0 && i1 === d.i0 && !d.moved) {
    ia = d.i0;
    ib = Math.min(NSLOT, d.i0 + durSlots()) - 1;
  } else {
    ia = Math.min(d.i0, i1);
    ib = Math.max(d.i0, i1);
  }
  rows.forEach((key, r) => {
    const s = new Set(d.snapshot.get(key));
    if (r >= ra && r <= rb) for (let i = ia; i <= ib; i++) { if (d.on) s.add(i); else s.delete(i); }
    times.set(key, s);
  });
  paintAll();
}
function autoScroll(y: number): void {
  if (y < 60) window.scrollBy(0, -14);
  else if (y > window.innerHeight - 140) window.scrollBy(0, 14);
}

grid.addEventListener("pointerdown", (e) => {
  const c = closest(e.target, CELL_SEL);
  if (!c || (e.pointerType === "mouse" && e.button !== 0)) return;
  e.preventDefault();
  drag = startDrag(c, e.pointerId);
  capturePointer(grid, e.pointerId);
  applyDrag(drag, drag.r0, drag.i0);
  focusOnly(cellOf.values(), c);
});
grid.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  e.preventDefault();
  autoScroll(e.clientY);
  const c = elementAt(e.clientX, e.clientY, "#time-grid " + CELL_SEL);
  if (!c) return;
  const r = Number(c.dataset.r), i = Number(c.dataset.i);
  if (!drag.moved && r === drag.r0 && i === drag.i0) return;
  drag.moved = true;
  applyDrag(drag, r, i);
});
function gridEnd(e: PointerEvent): void {
  if (!drag || e.pointerId !== drag.id) return;
  drag = null;
  releasePointer(grid, e.pointerId);
  update();
}
grid.addEventListener("pointerup", gridEnd);
grid.addEventListener("pointercancel", gridEnd);
grid.addEventListener("contextmenu", (e) => { if (closest(e.target, CELL_SEL)) e.preventDefault(); });
grid.addEventListener("keydown", (e) => {
  const c = closest(e.target, CELL_SEL);
  if (!c) return;
  const r = Number(c.dataset.r), i = Number(c.dataset.i), [a, b] = visibleSlots();
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    const d = startDrag(c);
    applyDrag(d, r, i);
    update();
    return;
  }
  const vertical = narrowMq.matches;
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
narrowMq.addEventListener("change", renderGrid);

const errBox = $("new-error");
function showError(msg: string): void {
  errBox.textContent = msg;
  errBox.classList.toggle("hidden", !msg);
}

$("bulk-set").addEventListener("click", () => {
  const a = Number($<HTMLSelectElement>("bulk-from").value), b = Number($<HTMLSelectElement>("bulk-to").value);
  if (b <= a) { showError(T("終了は開始より後にしてください")); return; }
  showError("");
  bulk = [a, b];
  for (const k of times.keys()) {
    const s = new Set<number>();
    for (let i = a; i < b; i++) s.add(i);
    times.set(k, s);
  }
  ensureVisible(a, b);
  renderGrid();
  update();
});
$("reset-all").addEventListener("click", () => {
  const any = [...times.values()].some((s) => s.size);
  if (any && !confirm(T("選んだ時間をすべて外しますか？（日付の選択はそのままです）"))) return;
  bulk = null;
  for (const k of times.keys()) times.set(k, new Set());
  renderGrid();
  update();
});

// ---------- candidates ----------
const splitMode = (): SplitMode => ($<HTMLSelectElement>("split").value === "block" ? "block" : "slide");
const currentCandidates = () => candidates(times, durSlots(), splitMode());

function update(): void {
  const c = currentCandidates(), p = $("preview"), count = $("count");
  count.textContent = String(c.list.length);
  count.classList.toggle("over", c.list.length > MAX);
  $("frag-note").textContent = c.fragments ? T("予定時間に満たない時間帯が{n}か所あります（候補になりません）", { n: c.fragments }) : "";
  p.innerHTML = "";
  if (!c.list.length) {
    p.appendChild(el("span", "chip-empty", times.size ? T("STEP 3 で時間を選んでください") : T("STEP 2 で日付を選んでください")));
  }
  for (const [day, a, b] of c.list) p.appendChild(el("span", "", shortDate(parseDay(day)) + " " + hm(a) + "–" + hm(b)));
  save();
}
for (const id of ["duration", "split"]) $(id).addEventListener("change", update);

// ---------- keep the form when coming back from the confirmation screen ----------
const STORE = "toe-new-draft";
const FIELDS = ["title", "desc", "duration", "deadline", "people", "split", "tz"] as const;
type Field = (typeof FIELDS)[number];
const field = (f: Field) => $<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(f);
const checkbox = (id: "allow-maybe" | "show-names") => $<HTMLInputElement>(id);

interface Draft extends Partial<Record<Field, string>> {
  dates: Day[];
  times: Record<Day, number[]>;
  bulk: [number, number] | null;
  vFrom: number;
  vTo: number;
  maybe: boolean;
  names: boolean;
}

function save(): void {
  const o: Draft = {
    dates: sortedDates(), times: {}, bulk, vFrom, vTo,
    maybe: checkbox("allow-maybe").checked, names: checkbox("show-names").checked,
  };
  for (const f of FIELDS) o[f] = field(f).value;
  for (const [k, s] of times) o.times[k] = [...s];
  saveJson("session", STORE, o);
}

/** Restore the draft only when coming back (browser back or the "← 日程の選択に戻る" link). */
function restore(): void {
  const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  const back = nav?.type === "back_forward" || location.hash === "#restore";
  if (!back) { remove("session", STORE); return; }
  const o = loadJson<Draft | null>("session", STORE, null);
  if (!o) return;
  for (const f of FIELDS) if (typeof o[f] === "string") field(f).value = o[f]!;
  checkbox("allow-maybe").checked = o.maybe !== false;
  checkbox("show-names").checked = o.names !== false;
  bulk = o.bulk ?? null;
  if (Number.isInteger(o.vFrom) && Number.isInteger(o.vTo) && o.vFrom >= 0 && o.vTo <= 24 && o.vFrom < o.vTo) {
    vFrom = o.vFrom;
    vTo = o.vTo;
  }
  for (const k of o.dates ?? []) if (parseDay(k) >= today) times.set(k, new Set(o.times?.[k] ?? []));
  const first = sortedDates()[0];
  if (first) {
    const d = parseDay(first);
    view = new Date(d.getFullYear(), d.getMonth(), 1);
  }
}
for (const id of ["title", "desc", "deadline", "people", "allow-maybe", "show-names", "tz"]) $(id).addEventListener("change", save);

// ---------- submit ----------
form.addEventListener("submit", (ev) => {
  const { list } = currentCandidates(), msgs: string[] = [];
  const title = field("title").value.trim();
  if (!title) msgs.push(T("タイトルを入力してください"));
  if (!times.size) msgs.push(T("日付を選んでください（STEP 2）"));
  else if (!list.length) msgs.push(T("候補日時がありません。時間を選んでください（STEP 3）"));
  if (list.length > MAX) msgs.push(T("候補は{max}件以内にしてください（現在 {n} 件）", { max: MAX, n: list.length }));
  if (msgs.length) {
    ev.preventDefault();
    showError(msgs.join(" / "));
    if (!title) field("title").focus();
    return;
  }
  showError("");
  const data = pollJson({
    title,
    description: field("desc").value,
    timezone: field("tz").value,
    showNames: checkbox("show-names").checked,
    allowMaybe: checkbox("allow-maybe").checked,
    durationMinutes: Number(field("duration").value),
    split: splitMode(),
    deadline: field("deadline").value,
    people: field("people").value,
  }, list);
  $<HTMLInputElement>("json-out").value = JSON.stringify(data, null, 2);
  save();
});

restore();
syncView();
refreshAll();
