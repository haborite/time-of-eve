/**
 * Public answer page: the answer modal (new answer or editing one), submitting it, and the message shown after the
 * reload that follows a successful submit. Only rendered while the poll accepts answers.
 */
import type { Answer } from "../../shared/public-boot";
import { $, $opt } from "../lib/dom";
import { T } from "../lib/i18n";
import { loadJson, remove, saveJson } from "../lib/storage";
import type { AnswerBody, Api, MyAnswers } from "./api";
import { createAnswerGrid } from "./answer-grid";
import type { Page } from "./page";

export interface AnswerForm {
  /** Re-layout the grid if it is shown (display time zone or screen width changed); opening always lays it out. */
  refresh(): void;
  /** Open the modal on the answer `id`, loaded with its edit token. */
  startEdit(id: string, token: string): void;
}

const DONE_KEY = "toe-done";   // {url, msg} shown once after the reload that follows a successful submit

interface Deps {
  api: Api;
  mine: MyAnswers;
  /** Matches when the grid uses the vertical (narrow screen) layout. */
  narrow: MediaQueryList;
}

/** Wire up the modal; null when the page has none (answers closed). */
export function createAnswerForm(page: Page, { api, mine, narrow }: Deps): AnswerForm | null {
  const modal = $opt("answer-modal");
  if (!modal) return null;
  const body = $("modal-body");
  const comment = $<HTMLTextAreaElement>("comment");
  const participant = $opt<HTMLSelectElement>("participant-select");
  const submitBtn = $<HTMLButtonElement>("submit-btn");
  const mark = (): Answer => (document.querySelector<HTMLInputElement>('input[name="mark"]:checked')?.value as Answer | undefined) ?? "yes";
  const grid = createAnswerGrid(page, $("answer-grid"), body, mark, narrow);
  let editing: { id: string; token: string } | null = null;

  const isOpen = () => !modal.classList.contains("hidden");

  function open(): void {
    modal!.classList.remove("hidden");
    document.body.classList.add("modal-open");
    grid.render();
    body.scrollTop = 0;
    setTimeout(() => (editing ? comment : (participant ?? $opt("display-name")))?.focus(), 0);
  }
  function close(): void {
    modal!.classList.add("hidden");
    document.body.classList.remove("modal-open");
    if (location.hash.startsWith("#edit=")) history.replaceState(null, "", location.pathname);
  }
  function showError(msg: string): void {
    const e = $("form-error");
    e.textContent = msg;
    e.classList.toggle("hidden", !msg);
  }
  /** Header of the modal: "new answer" (name fields) or "editing <name>". */
  function setMode(editName: string | null): void {
    $("who-new").classList.toggle("hidden", editName !== null);
    $("who-edit").classList.toggle("hidden", editName === null);
    if (editName !== null) $("edit-name-line").textContent = T("{name} さんの予定を直しています", { name: editName });
    $("answer-title").textContent = editName === null ? T("あなたの予定を追加する") : T("予定を直す");
  }

  function newAnswer(): void {
    editing = null;
    grid.setAnswers({});
    setMode(null);
    comment.value = "";
    showError("");
    open();
  }

  function startEdit(id: string, token: string): void {
    api.getResponse(id, token).then((r) => {
      if (!r.ok) {
        alert(r.body.error?.message || T("編集リンクが無効です"));
        return;
      }
      editing = { id, token };
      const name = r.body.display_name ?? "";
      mine.remember({ id, token, name });
      // answers to slots that are no longer open are dropped
      const openSlots = page.boot.timeline.open;
      grid.setAnswers(Object.fromEntries(Object.entries(r.body.slots ?? {}).filter(([k]) => openSlots[k])));
      setMode(name);
      comment.value = r.body.comment || "";
      showError("");
      open();
    }, () => alert(T("通信に失敗しました。もう一度お試しください。")));
  }

  $("open-form").addEventListener("click", newAnswer);
  document.querySelectorAll("[data-open-form]").forEach((b) => b.addEventListener("click", newAnswer));
  $("cancel-form").addEventListener("click", close);
  $("cancel-x").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) close(); });
  participant?.addEventListener("change", () => $("name-wrap").classList.toggle("hidden", participant.value !== "__new"));
  $("fill-all").addEventListener("click", () => grid.fillEmpty());
  $("clear-all").addEventListener("click", () => {
    if (Object.keys(grid.answers()).length && !confirm(T("入れた予定をすべて消しますか？"))) return;
    grid.setAnswers({});
  });

  $<HTMLFormElement>("answer-form").addEventListener("submit", (e) => {
    e.preventDefault();
    showError("");
    const slots = grid.answers();
    const req: AnswerBody = { slots, comment: comment.value };
    if (!editing) {
      if (participant && participant.value && participant.value !== "__new") req.participant_id = participant.value;
      else {
        req.display_name = $<HTMLInputElement>("display-name").value.trim();
        if (!req.display_name) {
          showError(participant && !participant.value ? T("お名前を選んでください") : T("ニックネームを入れてください"));
          return;
        }
      }
    }
    // 入れていない時間は確認せずに「未回答」として登録する
    if (!Object.keys(slots).length) {
      showError(T("タイムラインに予定を入れてください"));
      return;
    }
    submitBtn.disabled = true;
    const failed = (msg: string) => {
      submitBtn.disabled = false;
      showError(msg);
    };
    const done = (url: string, msg: string) => {
      saveJson("session", DONE_KEY, { url, msg });
      history.replaceState(null, "", location.pathname);
      location.reload();
    };
    const networkError = () => failed(T("通信に失敗しました。もう一度お試しください。"));
    const apiError = (r: { status: number; body: { error?: { message?: string } } }) =>
      failed(r.body.error?.message || T("登録できませんでした（{status}）", { status: r.status }));
    const ed = editing;
    if (ed) {
      api.updateResponse(ed.id, ed.token, req).then((r) => {
        if (!r.ok) return apiError(r);
        done(location.origin + location.pathname + "#edit=" + ed.id + "." + ed.token, T("予定を直しました。"));
      }, networkError);
    } else {
      api.createResponse(req).then((r) => {
        if (!r.ok || !r.body.response_id || !r.body.edit_token) return apiError(r);
        mine.remember({ id: r.body.response_id, token: r.body.edit_token, name: req.display_name || participant?.selectedOptions[0]?.text || "" });
        done(r.body.edit_url ?? "", T("予定を登録しました。"));
      }, networkError);
    }
  });

  return {
    refresh: () => { if (isOpen()) grid.render(); },
    startEdit,
  };
}

/** After the reload that follows a successful submit: show the edit link once. */
export function showDoneMessage(): void {
  const done = loadJson<{ url: string; msg: string } | null>("session", DONE_KEY, null);
  if (!done) return;
  remove("session", DONE_KEY);
  $<HTMLInputElement>("edit-url").value = done.url;
  $("done-msg").textContent = done.msg;
  $("done-box").classList.remove("hidden");
}
