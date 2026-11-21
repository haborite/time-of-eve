/**
 * New poll page (/new): STEP1 basic info, STEP2 pick dates, STEP3 paint times per date, then build schema 1.0 JSON
 * and hand it to the confirmation screen (/new/confirm). This file wires the parts in src/client/new together and
 * owns the candidate preview and the submit check.
 */
import { $, el } from "./lib/dom";
import { shortDate, T } from "./lib/i18n";
import { createCalendar } from "./new/calendar";
import { DRAFT_INPUTS, restoreDraft, saveDraft } from "./new/draft";
import { Selection } from "./new/selection";
import { candidates, hm, parseDay, pollJson, SLOT, type SplitMode } from "./new/slots";
import { createTimeGrid } from "./new/time-grid";

const form = $<HTMLFormElement>("new-form");
const MAX = Number(form.dataset.max) || 600;
const value = (id: string) => $<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id).value;
const checked = (id: string) => $<HTMLInputElement>(id).checked;
const durSlots = () => Number(value("duration")) / SLOT;
const splitMode = (): SplitMode => (value("split") === "block" ? "block" : "slide");

const errBox = $("new-error");
function showError(msg: string): void {
  errBox.textContent = msg;
  errBox.classList.toggle("hidden", !msg);
}

const today = new Date();
today.setHours(0, 0, 0, 0);
const sel = new Selection();
restoreDraft(sel, today);

const calendar = createCalendar(sel, today, refreshAll);
const grid = createTimeGrid(sel, {
  durSlots, narrow: window.matchMedia("(max-width: 640px)"), onSlotsChange: update, onDatesChange: refreshAll, showError,
});

function refreshAll(): void {
  calendar.render();
  grid.render();
  update();
}

const currentCandidates = () => candidates(sel.times, durSlots(), splitMode());

/** Candidate count and chips in the bottom bar; also saves the draft. */
function update(): void {
  const c = currentCandidates(), p = $("preview"), count = $("count");
  count.textContent = String(c.list.length);
  count.classList.toggle("over", c.list.length > MAX);
  $("frag-note").textContent = c.fragments ? T("予定時間に満たない時間帯が{n}か所あります（候補になりません）", { n: c.fragments }) : "";
  p.innerHTML = "";
  if (!c.list.length) {
    p.appendChild(el("span", "chip-empty", sel.size ? T("STEP 3 で時間を選んでください") : T("STEP 2 で日付を選んでください")));
  }
  for (const [day, a, b] of c.list) p.appendChild(el("span", "", shortDate(parseDay(day)) + " " + hm(a) + "–" + hm(b)));
  saveDraft(sel);
}
for (const id of ["duration", "split"]) $(id).addEventListener("change", update);
for (const id of DRAFT_INPUTS) $(id).addEventListener("change", () => saveDraft(sel));

form.addEventListener("submit", (ev) => {
  const { list } = currentCandidates(), msgs: string[] = [];
  const title = value("title").trim();
  if (!title) msgs.push(T("タイトルを入力してください"));
  if (!sel.size) msgs.push(T("日付を選んでください（STEP 2）"));
  else if (!list.length) msgs.push(T("候補日時がありません。時間を選んでください（STEP 3）"));
  if (list.length > MAX) msgs.push(T("候補は{max}件以内にしてください（現在 {n} 件）", { max: MAX, n: list.length }));
  if (msgs.length) {
    ev.preventDefault();
    showError(msgs.join(" / "));
    if (!title) $("title").focus();
    return;
  }
  showError("");
  const data = pollJson({
    title,
    description: value("desc"),
    timezone: value("tz"),
    showNames: checked("show-names"),
    allowMaybe: checked("allow-maybe"),
    durationMinutes: Number(value("duration")),
    split: splitMode(),
    deadline: value("deadline"),
    people: value("people"),
  }, list);
  $<HTMLInputElement>("json-out").value = JSON.stringify(data, null, 2);
  saveDraft(sel);
});

refreshAll();
