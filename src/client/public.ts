/**
 * Public answer page (/p/<id>): everyone's timeline, and the answer modal where slots are painted.
 * This file only wires the parts in src/client/public together.
 */
import type { PublicBoot } from "../shared/public-boot";
import { bindCopyButtons } from "./lib/clipboard";
import { $, $opt, button, readJson } from "./lib/dom";
import { LANG, T } from "./lib/i18n";
import { rememberPoll } from "./lib/recent";
import { createAnswerForm, showDoneMessage } from "./public/answer-form";
import { createApi, myAnswers } from "./public/api";
import type { Page } from "./public/page";
import { renderResults } from "./public/results";
import { layoutTimeline } from "./public/timeline";
import { createTzBar } from "./public/tz-bar";

const boot: PublicBoot = readJson<PublicBoot | null>("boot", null) ?? missing("#boot");
function missing(what: string): never {
  throw new Error(`${what} missing`);
}

const page: Page = { boot, layout: { days: [], openOrder: [], minOf: {} } };
const mine = myAnswers(boot.publicId);
const narrow = window.matchMedia("(max-width: 640px)");
const form = createAnswerForm(page, { api: createApi(boot.apiBase), mine, narrow });
const tzBar = createTzBar(boot.tz, render);
const startEdit = (id: string, token: string) => form?.startEdit(id, token);

function render(): void {
  page.layout = layoutTimeline(boot.timeline, tzBar.zone(), LANG);
  tzBar.render();
  renderResults($("results"), page, { editable: new Map(mine.list().map((x) => [x.id, x.token])), onEdit: startEdit });
  form?.refresh();
}
narrow.addEventListener("change", () => form?.refresh());

showDoneMessage();

// "<name> の予定を直す" for answers made from this browser
const myLinks = $opt("my-links");
if (myLinks && boot.accepting) {
  for (const x of mine.list()) {
    myLinks.appendChild(button("btn-linklike", T("{name} の予定を直す", { name: x.name || x.id }), () => startEdit(x.id, x.token)));
  }
}

// edit link: /p/<id>#edit=<response id>.<token>
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

render();
checkHash();
