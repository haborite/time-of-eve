"use strict";
/* Top page: polls opened in this browser (stored only in localStorage by public.js / admin.js). */
(function () {
  var R = "toe-recent", box = document.getElementById("home-recent"), ul = document.getElementById("home-recent-list");
  if (!box || !ul) return;
  var list = [];
  try { list = JSON.parse(localStorage.getItem(R) || "[]"); } catch (e) { list = []; }
  if (!list.length) return;
  list.forEach(function (x) {
    var li = document.createElement("li"), a = document.createElement("a");
    a.href = x.url;
    a.textContent = x.title || x.url;
    li.appendChild(a);
    if (x.organizer) { var b = document.createElement("span"); b.className = "chip chip-open"; b.textContent = window.T("主催"); li.appendChild(document.createTextNode(" ")); li.appendChild(b); }
    ul.appendChild(li);
  });
  box.classList.remove("hidden");
  document.getElementById("home-recent-clear").addEventListener("click", function () {
    if (!confirm(window.T("この一覧を消しますか？（日程調整そのものは消えません）"))) return;
    try { localStorage.removeItem(R); } catch (e) { /* ignore */ }
    box.classList.add("hidden");
  });
})();
