"use strict";
(function () {
  function copyFrom(sel, btn) {
    var el = document.querySelector(sel);
    if (!el) return;
    var text = el.value !== undefined ? el.value : el.textContent;
    var done = function () { var t = btn.textContent; btn.textContent = window.T("コピーしました"); setTimeout(function () { btn.textContent = t; }, 1500); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { el.select(); document.execCommand("copy"); done(); });
    } else { el.select(); document.execCommand("copy"); done(); }
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-copy]");
    if (b) { e.preventDefault(); copyFrom(b.getAttribute("data-copy"), b); return; }
    var c = e.target.closest("[data-confirm]");
    if (c && !window.confirm(c.getAttribute("data-confirm"))) { e.preventDefault(); }
  });
  // organizer page opened by manage URL: remember it in this browser for the top page
  var mk = document.querySelector('[data-testid="manage-key"]'), mu = document.getElementById("manage-url");
  if (mk && mu) {
    try {
      var R = "toe-recent", u = new URL(mu.value), title = (document.querySelector("h1") || {}).textContent || "";
      var list = JSON.parse(localStorage.getItem(R) || "[]").filter(function (x) { return x.url !== u.pathname; });
      list.unshift({ id: u.pathname, title: title, url: u.pathname, organizer: true, at: Date.now() });
      localStorage.setItem(R, JSON.stringify(list.slice(0, 20)));
    } catch (e) { /* ignore */ }
  }
  var ta = document.getElementById("json_text");
  if (ta) {
    ["dragenter", "dragover"].forEach(function (ev) { ta.addEventListener(ev, function (e) { e.preventDefault(); ta.classList.add("drag"); }); });
    ["dragleave", "drop"].forEach(function (ev) { ta.addEventListener(ev, function () { ta.classList.remove("drag"); }); });
    ta.addEventListener("drop", function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      e.preventDefault();
      if (f.size > 512 * 1024) { alert(window.T("ファイルが大きすぎます（512KBまで）")); return; }
      f.text().then(function (t) { ta.value = t; });
    });
    var fill = document.getElementById("fill-sample");
    if (fill) fill.addEventListener("click", function () {
      if (ta.value.trim() && !confirm(window.T("入力中の内容を置き換えますか？"))) return;
      ta.value = document.getElementById("sample-json").content.textContent;
    });
  }
})();
