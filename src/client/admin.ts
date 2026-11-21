/**
 * Organizer / admin / import pages: copy buttons, confirmations, remembering the organizer page,
 * and drag-and-drop of a JSON file into the import box.
 */
import { $opt, closest } from "./lib/dom";
import { bindCopyButtons } from "./lib/clipboard";
import { T } from "./lib/i18n";
import { rememberPoll } from "./lib/recent";

const MAX_JSON_BYTES = 512 * 1024;

bindCopyButtons();

// <a|button data-confirm="…">: ask before following the link / submitting
document.addEventListener("click", (e) => {
  const c = closest(e.target, "[data-confirm]");
  if (c && !window.confirm(c.getAttribute("data-confirm") ?? "")) e.preventDefault();
});

// organizer page opened by its manage URL: remember it in this browser for the top page
const manageUrl = $opt<HTMLInputElement>("manage-url");
if (manageUrl && document.querySelector('[data-testid="manage-key"]')) {
  try {
    const path = new URL(manageUrl.value).pathname;
    rememberPoll({ id: path, url: path, title: document.querySelector("h1")?.textContent ?? "", organizer: true });
  } catch {
    /* not a URL */
  }
}

const ta = $opt<HTMLTextAreaElement>("json_text");
if (ta) {
  for (const ev of ["dragenter", "dragover"]) {
    ta.addEventListener(ev, (e) => {
      e.preventDefault();
      ta.classList.add("drag");
    });
  }
  for (const ev of ["dragleave", "drop"]) ta.addEventListener(ev, () => ta.classList.remove("drag"));
  ta.addEventListener("drop", (e) => {
    const f = e.dataTransfer?.files[0];
    if (!f) return;
    e.preventDefault();
    if (f.size > MAX_JSON_BYTES) {
      alert(T("ファイルが大きすぎます（512KBまで）"));
      return;
    }
    void f.text().then((t) => { ta.value = t; });
  });
  $opt("fill-sample")?.addEventListener("click", () => {
    if (ta.value.trim() && !confirm(T("入力中の内容を置き換えますか？"))) return;
    const sample = $opt<HTMLTemplateElement>("sample-json");
    if (sample) ta.value = sample.content.textContent ?? "";
  });
}
