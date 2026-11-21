/** Top page: polls opened in this browser (stored only in localStorage, see lib/recent). */
import { $, $opt, el } from "./lib/dom";
import { T } from "./lib/i18n";
import { clearRecent, recentPolls } from "./lib/recent";

const box = $opt("home-recent");
const ul = $opt("home-recent-list");
const list = recentPolls();

if (box && ul && list.length) {
  for (const x of list) {
    const li = el("li");
    const a = el("a", "", x.title || x.url);
    a.href = x.url;
    li.appendChild(a);
    if (x.organizer) {
      li.appendChild(document.createTextNode(" "));
      li.appendChild(el("span", "chip chip-open", T("主催")));
    }
    ul.appendChild(li);
  }
  box.classList.remove("hidden");
  $("home-recent-clear").addEventListener("click", () => {
    if (!confirm(T("この一覧を消しますか？（日程調整そのものは消えません）"))) return;
    clearRecent();
    box.classList.add("hidden");
  });
}
