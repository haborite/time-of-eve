/** Public answer page: everyone's timeline, and the answer modal where slots are painted by click/drag/keyboard. */
import type { Answer, PublicBoot, SlotKey } from "../shared/public-boot";
import { bindCopyButtons } from "./lib/clipboard";
import { $, $opt, button, capturePointer, closest, el, elementAt, focusOnly, option, pad, readJson, releasePointer } from "./lib/dom";
import { hourLabel, LANG, T, weekendClass } from "./lib/i18n";
import { rememberPoll } from "./lib/recent";
import { loadJson, loadString, remove, saveJson, saveString } from "./lib/storage";
import { createApi, myAnswers, type AnswerBody, type ApiResult, type CreatedBody } from "./public/api";
import {
  clock, fmtDateTime, fmtRange, isHour, layoutTimeline, slotText as slotTextIn, zoneOf,
  type Col, type DayRow, type Layout, type TzChoice,
} from "./public/timeline";

const boot: PublicBoot = readJson<PublicBoot | null>("boot", null) ?? (() => { throw new Error("#boot missing"); })();
const tl = boot.timeline;
const SYM: Record<Answer, string> = { yes: "○", maybe: "△", no: "×" };
const LABEL: Record<Answer, string> = { yes: T("参加/可"), maybe: T("未定"), no: T("不参加/不可") };
const UNSET = T("未記入");
const narrowMq = window.matchMedia("(max-width: 640px)");
const finalized = new Set(boot.finalized);
const api = createApi(boot.apiBase);
const mine = myAnswers(boot.publicId);

// ---------- display time zone ----------
const TZ_KEY = "toe-tz";   // TzChoice; shared by all polls in this browser
const localTz = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || boot.tz;
  } catch {
    return boot.tz;
  }
})();
let tzChoice: TzChoice = loadString("local", TZ_KEY) || "local";
let tz = zoneOf(tzChoice, localTz, boot.tz);

let lay: Layout = { days: [], openOrder: [], minOf: {} };
const slotText = (k: SlotKey) => slotTextIn(lay, k, tl.step);
const markClass = (v: Answer) => "m-" + v;

// ---------- results ("みんなの予定") ----------
function renderResults(): void {
  const host = $("results");
  host.innerHTML = "";
  if (!lay.days.length) {
    host.appendChild(el("p", "muted", T("候補がありません")));
    return;
  }
  const own = new Map(mine.list().map((x) => [x.id, x]));
  for (const d of lay.days) {
    const wrap = el("div", "tl-scroll");
    const t = el("table", "tl tl-res");
    t.style.setProperty("--cols", String(d.cols.length));
    t.appendChild(headRow(d, null));
    for (const p of boot.people) {
      const tr = el("tr", "tl-prow");
      const th = el("th", "tl-name");
      th.scope = "row";
      const my = own.get(p.id);
      if (my && boot.accepting) {
        const b = button("btn-linklike", p.name, () => startEdit(p.id, my.token));
        b.title = T("この予定を直す");
        th.appendChild(b);
      } else {
        th.appendChild(el("span", "pname", p.name));
      }
      tr.appendChild(th);
      for (const c of d.cols) {
        const td = resultCell(c, d);
        const v = c.key ? p.slots[c.key] : undefined;
        if (c.key && v) {
          td.classList.add(markClass(v));
          td.textContent = SYM[v];
          td.title = slotText(c.key) + " " + LABEL[v];
        }
        tr.appendChild(td);
      }
      t.appendChild(tr);
    }
    const cr = el("tr", "tl-count");
    const cth = el("th", "tl-name tl-countlabel", T("参加できる人数"));
    cth.scope = "row";
    cr.appendChild(cth);
    for (const c of d.cols) {
      const td = resultCell(c, d);
      if (c.key) {
        const [yes, maybe, no] = boot.counts[c.key] ?? [0, 0, 0];
        if (yes) {
          td.textContent = String(yes);
          td.classList.add("has");
          td.style.setProperty("--lv", boot.responded ? (yes / boot.responded).toFixed(2) : "0");
        }
        td.title = slotText(c.key) + "  ○" + yes + (boot.allowMaybe ? " △" + maybe : "") + " ×" + no;
      }
      cr.appendChild(td);
    }
    t.appendChild(cr);
    wrap.appendChild(t);
    host.appendChild(wrap);
  }
}

/** Empty results cell with the classes every row shares. */
function resultCell(c: Col, d: DayRow): HTMLTableCellElement {
  const td = el("td", "tl-cell");
  if (!c.key) td.classList.add("off");
  else if (finalized.has(c.key)) td.classList.add("fx");
  if (isHour(c, d)) td.classList.add("hr");
  if (c.gap) td.classList.add("gap");
  return td;
}

/** Date + hour headings. With `onAll` (answer grid) the date cell gets a "この日すべて" button. */
function headRow(d: DayRow, onAll: ((d: DayRow) => void) | null): HTMLTableRowElement {
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

// ---------- answer grid ----------
let state: Record<SlotKey, Answer> = {};
let editing: { id: string; token: string } | null = null;
const grid = $opt("answer-grid");
let cellOf = new Map<SlotKey, HTMLElement>();   // current layout
const CELL_SEL = ".tl-cell.on";

function currentMark(): Answer {
  const r = document.querySelector<HTMLInputElement>('input[name="mark"]:checked');
  return (r?.value as Answer | undefined) ?? "yes";
}

function paintCell(k: SlotKey): void {
  const c = cellOf.get(k);
  if (!c) return;
  const v = state[k];
  c.classList.remove("m-yes", "m-maybe", "m-no");
  if (v) c.classList.add(markClass(v));
  c.querySelector(".sym")!.textContent = v ? SYM[v] : "";
  const label = slotText(k) + " " + (v ? LABEL[v] : UNSET);
  c.setAttribute("aria-label", label);
  c.title = label;
}
const paintAll = () => cellOf.forEach((_, k) => paintCell(k));

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
  const m = currentMark();
  for (const k of d.open) {
    state[k] = m;
    paintCell(k);
  }
}

function renderGrid(): void {
  if (!grid) return;
  grid.innerHTML = "";
  cellOf = new Map();
  const vertical = narrowMq.matches;
  grid.className = vertical ? "tl-vertical" : "tl-scroll tl-horizontal";
  for (const d of lay.days) {
    const idxOf = new Map(d.open.map((k, i) => [k, i]));
    const idx = (c: Col) => (c.key ? idxOf.get(c.key) : undefined);
    if (!vertical) {
      const t = el("table", "tl tl-ans");
      t.style.setProperty("--cols", String(d.cols.length));
      t.appendChild(headRow(d, fillDay));
      const tr = el("tr", "tl-candrow");
      for (const c of d.cols) tr.appendChild(makeCell(c, d, idx(c), false));
      t.appendChild(tr);
      grid.appendChild(t);
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
    grid.appendChild(box);
  }
  paintAll();
  const first = cellOf.get(lay.openOrder[0]);
  if (first) first.tabIndex = 0;
}

// drag painting: range within the starting day, in time order (like a text selection)
let drag: { day: number; from: number; value: Answer | null; snapshot: Record<SlotKey, Answer>; id: number } | null = null;

function applyRange(toIdx: number): void {
  if (!drag) return;
  const a = Math.min(drag.from, toIdx), b = Math.max(drag.from, toIdx);
  lay.days[drag.day].open.forEach((k, i) => {
    const v = i >= a && i <= b ? drag!.value : drag!.snapshot[k];
    if (v) state[k] = v;
    else delete state[k];
    paintCell(k);
  });
}
function autoScroll(y: number): void {
  const body = $("modal-body");
  const r = body.getBoundingClientRect();
  if (y < r.top + 48) body.scrollTop -= 14;
  else if (y > r.bottom - 48) body.scrollTop += 14;
}

if (grid) {
  grid.addEventListener("pointerdown", (e) => {
    const c = closest(e.target, CELL_SEL);
    if (!c || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    const k = c.dataset.key!, m = currentMark();
    drag = { day: Number(c.dataset.day), from: Number(c.dataset.idx), value: state[k] === m ? null : m, snapshot: { ...state }, id: e.pointerId };
    capturePointer(grid, e.pointerId);
    applyRange(drag.from);
    focusOnly(cellOf.values(), c);
  });
  grid.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    autoScroll(e.clientY);
    const c = elementAt(e.clientX, e.clientY, CELL_SEL);
    if (c && Number(c.dataset.day) === drag.day) applyRange(Number(c.dataset.idx));
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    releasePointer(grid, e.pointerId);
  };
  grid.addEventListener("pointerup", end);
  grid.addEventListener("pointercancel", end);
  grid.addEventListener("contextmenu", (e) => { if (closest(e.target, CELL_SEL)) e.preventDefault(); });

  // keyboard: arrows move between open slots, Space/Enter toggles the chosen mark
  grid.addEventListener("keydown", (e) => {
    const c = closest(e.target, CELL_SEL);
    if (!c) return;
    const k = c.dataset.key!, order = lay.openOrder, i = order.indexOf(k);
    let j: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") j = Math.min(order.length - 1, i + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = Math.max(0, i - 1);
    else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      const m = currentMark();
      if (state[k] === m) delete state[k];
      else state[k] = m;
      paintCell(k);
      return;
    } else return;
    e.preventDefault();
    const n = cellOf.get(order[j]);
    if (n) focusOnly(cellOf.values(), n);
  });
}
narrowMq.addEventListener("change", () => renderGrid());

// ---------- modal ----------
const modal = $opt("answer-modal");
const isOpen = () => !!modal && !modal.classList.contains("hidden");

function openModal(): void {
  if (!modal) return;
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  renderGrid();
  $("modal-body").scrollTop = 0;
  setTimeout(() => {
    const n = editing ? $opt("comment") : ($opt("participant-select") ?? $opt("display-name"));
    n?.focus();
  }, 0);
}
function closeModal(): void {
  if (!modal) return;
  modal.classList.add("hidden");
  document.body.classList.remove("modal-open");
  if (location.hash.startsWith("#edit=")) history.replaceState(null, "", location.pathname);
}
function showError(msg: string): void {
  const e = $("form-error");
  e.textContent = msg;
  e.classList.toggle("hidden", !msg);
}

function newAnswer(): void {
  editing = null;
  state = {};
  $("who-new").classList.remove("hidden");
  $("who-edit").classList.add("hidden");
  $("answer-title").textContent = T("あなたの予定を追加する");
  $<HTMLTextAreaElement>("comment").value = "";
  showError("");
  openModal();
}

if (modal) {
  $("open-form").addEventListener("click", newAnswer);
  document.querySelectorAll("[data-open-form]").forEach((b) => b.addEventListener("click", newAnswer));
  $("cancel-form").addEventListener("click", closeModal);
  $("cancel-x").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) closeModal(); });
  const sel = $opt<HTMLSelectElement>("participant-select");
  sel?.addEventListener("change", () => $("name-wrap").classList.toggle("hidden", sel.value !== "__new"));
  $("fill-all").addEventListener("click", () => {
    const m = currentMark();
    for (const k of lay.openOrder) {
      if (!state[k]) {
        state[k] = m;
        paintCell(k);
      }
    }
  });
  $("clear-all").addEventListener("click", () => {
    if (Object.keys(state).length && !confirm(T("入れた予定をすべて消しますか？"))) return;
    state = {};
    paintAll();
  });
}

function startEdit(id: string, token: string): void {
  if (!modal) return;
  api.getResponse(id, token).then((r) => {
    if (!r.ok) {
      alert(r.body.error?.message || T("編集リンクが無効です"));
      return;
    }
    editing = { id, token };
    const name = r.body.display_name ?? "";
    mine.remember({ id, token, name });
    state = {};
    for (const [k, v] of Object.entries(r.body.slots ?? {})) if (tl.open[k]) state[k] = v;
    $("who-new").classList.add("hidden");
    $("who-edit").classList.remove("hidden");
    $("edit-name-line").textContent = T("{name} さんの予定を直しています", { name });
    $("answer-title").textContent = T("予定を直す");
    $<HTMLTextAreaElement>("comment").value = r.body.comment || "";
    showError("");
    openModal();
  }, () => alert(T("通信に失敗しました。もう一度お試しください。")));
}

// ---------- submit ----------
const DONE_KEY = "toe-done";   // message shown once after the reload that follows a successful submit

$opt<HTMLFormElement>("answer-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  showError("");
  const body: AnswerBody = { slots: { ...state }, comment: $<HTMLTextAreaElement>("comment").value };
  const sel = $opt<HTMLSelectElement>("participant-select");
  if (!editing) {
    if (sel && sel.value && sel.value !== "__new") body.participant_id = sel.value;
    else {
      body.display_name = $<HTMLInputElement>("display-name").value.trim();
      if (!body.display_name) {
        showError(sel && !sel.value ? T("お名前を選んでください") : T("ニックネームを入れてください"));
        return;
      }
    }
  }
  // 入れていない時間は確認せずに「未回答」として登録する
  if (!Object.keys(state).length) {
    showError(T("タイムラインに予定を入れてください"));
    return;
  }
  const submitBtn = $<HTMLButtonElement>("submit-btn");
  submitBtn.disabled = true;
  const ed = editing;
  const req = ed ? api.updateResponse(ed.id, ed.token, body) : api.createResponse(body);
  req.then((r) => {
    submitBtn.disabled = false;
    if (!r.ok) {
      showError(r.body.error?.message || T("登録できませんでした（{status}）", { status: r.status }));
      return;
    }
    let url: string, msg: string;
    if (ed) {
      url = location.origin + location.pathname + "#edit=" + ed.id + "." + ed.token;
      msg = T("予定を直しました。");
    } else {
      const created = (r as ApiResult<CreatedBody>).body;
      url = created.edit_url ?? "";
      mine.remember({ id: created.response_id ?? "", token: created.edit_token ?? "", name: body.display_name || sel?.selectedOptions[0]?.text || "" });
      msg = T("予定を登録しました。");
    }
    saveJson("session", DONE_KEY, { url, msg });
    history.replaceState(null, "", location.pathname);
    location.reload();
  }, () => {
    submitBtn.disabled = false;
    showError(T("通信に失敗しました。もう一度お試しください。"));
  });
});

// ---------- after reload / my links / edit hash ----------
const done = loadJson<{ url: string; msg: string } | null>("session", DONE_KEY, null);
if (done) {
  remove("session", DONE_KEY);
  $<HTMLInputElement>("edit-url").value = done.url;
  $("done-msg").textContent = done.msg;
  $("done-box").classList.remove("hidden");
}

const myLinks = $opt("my-links");
if (myLinks && boot.accepting) {
  for (const x of mine.list()) {
    myLinks.appendChild(button("btn-linklike", T("{name} の予定を直す", { name: x.name || x.id }), () => startEdit(x.id, x.token)));
  }
}

function checkHash(): void {
  const m = location.hash.match(/^#edit=([A-Za-z0-9]+)\.([A-Za-z0-9_-]+)$/);
  if (!m) return;
  if (boot.accepting) startEdit(m[1], m[2]);
  else alert(T("現在は予定の入力・修正ができません。"));
}
window.addEventListener("hashchange", checkHash);

bindCopyButtons();

// remember this poll for the top page ("この端末で開いた日程調整"; stays in this browser)
rememberPoll({ id: boot.publicId, title: document.querySelector("h1.ttl")?.textContent ?? "", url: location.pathname });

// ---------- display time zone: switcher, texts, re-layout ----------
const zones: string[] = (() => {
  try {
    return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  } catch {
    return [];
  }
})();

function renderTzBars(): void {
  document.querySelectorAll("[data-tz-bar]").forEach((bar) => {
    bar.innerHTML = "";
    const lab = el("label", "");
    lab.appendChild(el("span", "tz-lbl", T("表示中のタイムゾーン")));
    const sel = el("select", "tz-sel");
    sel.setAttribute("data-testid", "tz-select");
    sel.appendChild(option("local", T("あなたの時刻（{tz}）", { tz: localTz })));
    sel.appendChild(option("poll", T("作成者の時刻（{tz}）", { tz: boot.tz })));
    if (zones.length) {
      const og = el("optgroup");
      og.label = T("ほかのタイムゾーン");
      for (const z of zones) og.appendChild(option(z, z));
      sel.appendChild(og);
    } else if (tzChoice !== "local" && tzChoice !== "poll") {
      sel.appendChild(option(tzChoice, tzChoice));
    }
    sel.value = tzChoice;
    if (sel.value !== tzChoice) sel.value = "local";
    sel.addEventListener("change", () => setTz(sel.value));
    lab.appendChild(sel);
    bar.appendChild(lab);
    if (tz !== boot.tz) bar.appendChild(el("span", "tz-diff", T("作成者のタイムゾーン（{tz}）から変換して表示しています", { tz: boot.tz })));
  });
}

/** Server-rendered times (data-range="startMs,endMs", data-ts="ms") redrawn in the display zone. */
function renderTexts(): void {
  document.querySelectorAll<HTMLElement>("[data-range]").forEach((e) => {
    const [s, en] = (e.dataset.range ?? "").split(",").map(Number);
    e.textContent = fmtRange(LANG, s, en, tz);
  });
  document.querySelectorAll<HTMLElement>("[data-ts]").forEach((e) => { e.textContent = fmtDateTime(LANG, Number(e.dataset.ts), tz); });
  const note = $opt("tz-note");
  if (note) note.textContent = T("時刻は {tz}", { tz });
}

function setTz(choice: TzChoice): void {
  tzChoice = choice;
  saveString("local", TZ_KEY, choice);
  tz = zoneOf(choice, localTz, boot.tz);
  render();
}

function render(): void {
  lay = layoutTimeline(tl, tz, LANG);
  renderTzBars();
  renderTexts();
  renderResults();
  if (isOpen()) renderGrid();
}

render();
checkHash();
