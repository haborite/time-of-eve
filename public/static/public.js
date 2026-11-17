"use strict";
/* Public answer page: per-day timeline, paint slots by click/drag (mouse, pen, touch). */
(function () {
  var boot = JSON.parse(document.getElementById("boot").textContent);
  var tl = boot.timeline;
  var $ = function (id) { return document.getElementById(id); };
  var SYM = { yes: "○", maybe: "△", no: "×" };
  var T = window.T;
  var LABEL = { yes: T("参加/可"), maybe: T("未定"), no: T("不参加/不可") };
  var UNSET = T("未記入");
  var KEY = "toe-edit-" + boot.publicId;
  var narrowMq = window.matchMedia("(max-width: 640px)");
  var finalized = {};
  boot.finalized.forEach(function (k) { finalized[k] = true; });

  // ---------- geometry ----------
  var pad = function (n) { return String(n).padStart(2, "0"); };
  var perHour = 60 / tl.step;
  function slotKey(date, minutes) { return date + "T" + pad(Math.floor(minutes / 60)) + ":" + pad(minutes % 60); }
  function hhmm(key) { var h = +key.slice(11, 13), m = key.slice(14, 16); return h + ":" + m; }
  function endOf(key) {
    var mins = +key.slice(11, 13) * 60 + +key.slice(14, 16) + tl.step;
    return Math.floor(mins / 60) % 24 + ":" + pad(mins % 60);
  }
  // per day: ordered list of slot keys (all columns), and the open ones
  var days = tl.days.map(function (d, i) {
    var cols = [];
    for (var m = tl.hourStart * 60; m < tl.hourEnd * 60; m += tl.step) cols.push(slotKey(d.date, m));
    var open = cols.filter(function (k) { return tl.open[k]; });
    return { i: i, date: d.date, label: d.label, short: d.short, dow: d.dow, cols: cols, open: open };
  });
  var openOrder = [];
  days.forEach(function (d) { d.open.forEach(function (k) { openOrder.push(k); }); });

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function dowClass(d) { return d.dow === 6 ? " sun" : d.dow === 5 ? " sat" : ""; }

  // ---------- results ("みんなの予定") ----------
  function renderResults() {
    var host = $("results");
    host.innerHTML = "";
    if (!days.length) { host.appendChild(el("p", "muted", T("候補がありません"))); return; }
    var mine = {};
    storeList().forEach(function (x) { mine[x.id] = x; });
    days.forEach(function (d) {
      var wrap = el("div", "tl-scroll");
      var t = el("table", "tl tl-res");
      t.style.setProperty("--cols", d.cols.length);
      t.appendChild(headRow(d, null));
      boot.people.forEach(function (p) {
        var tr = el("tr", "tl-prow");
        var th = el("th", "tl-name");
        th.scope = "row";
        if (mine[p.id] && boot.accepting) {
          var b = el("button", "btn-linklike", p.name);
          b.type = "button";
          b.title = T("この予定を直す");
          b.addEventListener("click", function () { startEdit(p.id, mine[p.id].token); });
          th.appendChild(b);
        } else {
          th.appendChild(el("span", "pname", p.name));
        }
        tr.appendChild(th);
        d.cols.forEach(function (k) {
          var td = el("td", "tl-cell");
          if (!tl.open[k]) td.classList.add("off");
          else {
            var v = p.slots[k];
            if (v) { td.classList.add("m-" + v); td.textContent = SYM[v]; td.title = hhmm(k) + "– " + LABEL[v]; }
            if (finalized[k]) td.classList.add("fx");
          }
          if (+k.slice(14, 16) === 0) td.classList.add("hr");
          tr.appendChild(td);
        });
        t.appendChild(tr);
      });
      var cr = el("tr", "tl-count");
      var cth = el("th", "tl-name tl-countlabel", T("参加できる人数"));
      cth.scope = "row";
      cr.appendChild(cth);
      d.cols.forEach(function (k) {
        var td = el("td", "tl-cell");
        if (!tl.open[k]) td.classList.add("off");
        else {
          var c = boot.counts[k] || [0, 0, 0];
          if (c[0]) {
            td.textContent = c[0];
            td.classList.add("has");
            td.style.setProperty("--lv", boot.responded ? (c[0] / boot.responded).toFixed(2) : 0);
          }
          td.title = hhmm(k) + "–  ○" + c[0] + (boot.allowMaybe ? " △" + c[1] : "") + " ×" + c[2];
          if (finalized[k]) td.classList.add("fx");
        }
        if (+k.slice(14, 16) === 0) td.classList.add("hr");
        cr.appendChild(td);
      });
      t.appendChild(cr);
      wrap.appendChild(t);
      host.appendChild(wrap);
    });
  }

  function headRow(d, onAll) {
    var tr = el("tr", "tl-headrow");
    var th = el("th", "tl-name tl-date" + dowClass(d));
    th.scope = onAll ? "row" : "col";
    if (onAll) th.rowSpan = 2;   // answer grid: date cell spans hour labels + slot row (compact)
    var lab = el("div", "");
    lab.appendChild(el("span", "lbl-full", d.label));
    lab.appendChild(el("span", "lbl-short", d.short));
    th.appendChild(lab);
    if (onAll) {
      var b = el("button", "btn-linklike small", T("この日すべて"));
      b.type = "button";
      b.addEventListener("click", function () { onAll(d); });
      th.appendChild(b);
    }
    tr.appendChild(th);
    for (var h = tl.hourStart; h < tl.hourEnd; h++) {
      var hth = el("th", "tl-hour", pad(h));
      hth.colSpan = perHour;
      hth.scope = "col";
      tr.appendChild(hth);
    }
    return tr;
  }

  // ---------- answer grid ----------
  var state = {};      // slot key -> yes|maybe|no
  var editing = null;  // {id, token}
  var grid = $("answer-grid");
  var cellOf = {};     // key -> element (current layout)

  function currentMark() {
    var r = document.querySelector('input[name="mark"]:checked');
    return r ? r.value : "yes";
  }

  function paintCell(k) {
    var c = cellOf[k];
    if (!c) return;
    var v = state[k];
    c.classList.remove("m-yes", "m-maybe", "m-no");
    var sym = c.querySelector(".sym");
    if (v) { c.classList.add("m-" + v); sym.textContent = SYM[v]; }
    else sym.textContent = "";
    c.setAttribute("aria-label", hhmm(k) + "–" + endOf(k) + " " + (v ? LABEL[v] : UNSET));
    c.title = hhmm(k) + "– " + (v ? LABEL[v] : UNSET);
  }

  function makeCell(k, d, idx, vertical) {
    var c = el(vertical ? "div" : "td", "tl-cell" + (vertical ? " v-cell" : ""));
    c.dataset.key = k;
    if (!tl.open[k]) { c.classList.add("off"); return c; }
    c.classList.add("on");
    c.dataset.day = d.i;
    c.dataset.idx = idx;
    c.setAttribute("role", "button");
    c.tabIndex = -1;
    if (+k.slice(14, 16) === 0) c.classList.add("hr");
    c.appendChild(el("span", "sym"));
    if (vertical) c.appendChild(el("span", "v-min", ":" + k.slice(14, 16)));
    cellOf[k] = c;
    return c;
  }

  function fillDay(d) {
    var m = currentMark();
    d.open.forEach(function (k) { state[k] = m; paintCell(k); });
  }

  function renderGrid() {
    if (!grid) return;
    grid.innerHTML = "";
    cellOf = {};
    var vertical = narrowMq.matches;
    grid.className = vertical ? "tl-vertical" : "tl-scroll tl-horizontal";
    days.forEach(function (d) {
      var idxOf = {};
      d.open.forEach(function (k, i) { idxOf[k] = i; });
      if (!vertical) {
        var t = el("table", "tl tl-ans");
        t.style.setProperty("--cols", d.cols.length);
        t.appendChild(headRow(d, fillDay));
        var tr = el("tr", "tl-candrow");
        d.cols.forEach(function (k) { tr.appendChild(makeCell(k, d, idxOf[k], false)); });
        t.appendChild(tr);
        grid.appendChild(t);
      } else {
        var box = el("div", "v-day");
        var head = el("div", "v-head");
        head.appendChild(el("span", "v-date" + dowClass(d), d.label));
        var b = el("button", "btn-linklike small", T("この日すべて"));
        b.type = "button";
        b.addEventListener("click", function () { fillDay(d); });
        head.appendChild(b);
        box.appendChild(head);
        if (!d.open.length) return;
        var first = +d.open[0].slice(11, 13), last = +d.open[d.open.length - 1].slice(11, 13);
        for (var h = first; h <= last; h++) {
          var row = el("div", "v-row");
          row.appendChild(el("span", "v-time", window.LANG === "en" ? pad(h) + ":00" : h + "時"));
          for (var j = 0; j < perHour; j++) {
            var k = slotKey(d.date, h * 60 + j * tl.step);
            row.appendChild(makeCell(k, d, idxOf[k], true));
          }
          box.appendChild(row);
        }
        grid.appendChild(box);
      }
    });
    Object.keys(cellOf).forEach(paintCell);
    var firstCell = cellOf[openOrder[0]];
    if (firstCell) firstCell.tabIndex = 0;
  }

  // drag painting: range within the starting day, in time order (like a text selection)
  var drag = null;
  function applyRange(toIdx) {
    var d = days[drag.day];
    var a = Math.min(drag.from, toIdx), b = Math.max(drag.from, toIdx);
    d.open.forEach(function (k, i) {
      var v = (i >= a && i <= b) ? drag.value : drag.snapshot[k];
      if (v) state[k] = v; else delete state[k];
      paintCell(k);
    });
  }
  function cellAt(x, y) {
    var e = document.elementFromPoint(x, y);
    return e && e.closest ? e.closest(".tl-cell.on") : null;
  }
  if (grid) {
    grid.addEventListener("pointerdown", function (e) {
      var c = e.target.closest(".tl-cell.on");
      if (!c || (e.pointerType === "mouse" && e.button !== 0)) return;
      e.preventDefault();
      var k = c.dataset.key, m = currentMark();
      drag = { day: +c.dataset.day, from: +c.dataset.idx, value: state[k] === m ? null : m,
               snapshot: Object.assign({}, state), id: e.pointerId };
      try { grid.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      applyRange(drag.from);
      focusCell(c);
    });
    grid.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      e.preventDefault();
      autoScroll(e.clientY);
      var c = cellAt(e.clientX, e.clientY);
      if (c && +c.dataset.day === drag.day) applyRange(+c.dataset.idx);
    });
    var end = function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      try { grid.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    };
    grid.addEventListener("pointerup", end);
    grid.addEventListener("pointercancel", end);
    grid.addEventListener("contextmenu", function (e) { if (e.target.closest(".tl-cell.on")) e.preventDefault(); });

    // keyboard: arrows move between open slots, Space/Enter toggles the chosen mark
    grid.addEventListener("keydown", function (e) {
      var c = e.target.closest(".tl-cell.on");
      if (!c) return;
      var i = openOrder.indexOf(c.dataset.key), j = i;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") j = Math.min(openOrder.length - 1, i + 1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = Math.max(0, i - 1);
      else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        var k = c.dataset.key, m = currentMark();
        if (state[k] === m) delete state[k]; else state[k] = m;
        paintCell(k);
        return;
      } else return;
      e.preventDefault();
      focusCell(cellOf[openOrder[j]]);
    });
  }
  function focusCell(c) {
    Object.keys(cellOf).forEach(function (k) { cellOf[k].tabIndex = -1; });
    c.tabIndex = 0;
    c.focus({ preventScroll: true });
  }
  function autoScroll(y) {
    var body = $("modal-body");
    var r = body.getBoundingClientRect();
    if (y < r.top + 48) body.scrollTop -= 14;
    else if (y > r.bottom - 48) body.scrollTop += 14;
  }
  narrowMq.addEventListener("change", function () { renderGrid(); });

  // ---------- modal ----------
  var modal = $("answer-modal");
  function openModal() {
    modal.classList.remove("hidden");
    document.body.classList.add("modal-open");
    renderGrid();
    $("modal-body").scrollTop = 0;
    setTimeout(function () { var n = editing ? $("comment") : ($("participant-select") || $("display-name")); if (n) n.focus(); }, 0);
  }
  function closeModal() {
    modal.classList.add("hidden");
    document.body.classList.remove("modal-open");
    if (location.hash.indexOf("#edit=") === 0) history.replaceState(null, "", location.pathname);
  }
  function err(msg) { var e = $("form-error"); e.textContent = msg; e.classList.toggle("hidden", !msg); }

  function newAnswer() {
    editing = null;
    state = {};
    $("who-new").classList.remove("hidden");
    $("who-edit").classList.add("hidden");
    $("answer-title").textContent = T("あなたの予定を追加する");
    $("comment").value = "";
    err("");
    openModal();
  }

  if (modal) {
    $("open-form").addEventListener("click", newAnswer);
    document.querySelectorAll("[data-open-form]").forEach(function (b) { b.addEventListener("click", newAnswer); });
    $("cancel-form").addEventListener("click", closeModal);
    $("cancel-x").addEventListener("click", closeModal);
    modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModal(); });
    var sel = $("participant-select");
    if (sel) sel.addEventListener("change", function () { $("name-wrap").classList.toggle("hidden", sel.value !== "__new"); });
    $("fill-all").addEventListener("click", function () {
      var m = currentMark();
      openOrder.forEach(function (k) { if (!state[k]) { state[k] = m; paintCell(k); } });
    });
    $("clear-all").addEventListener("click", function () {
      if (Object.keys(state).length && !confirm(T("入れた予定をすべて消しますか？"))) return;
      state = {};
      Object.keys(cellOf).forEach(paintCell);
    });
  }

  // ---------- storage of edit tokens (this device) ----------
  function storeList() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; } }
  function remember(id, token, name) {
    try {
      var list = storeList().filter(function (x) { return x.id !== id; });
      list.push({ id: id, token: token, name: name });
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch (e) { /* storage unavailable */ }
  }

  function api(method, path, body, token) {
    var headers = { "Content-Type": "application/json", "X-UI-Lang": window.LANG };
    if (token) headers["X-Edit-Token"] = token;
    return fetch(boot.apiBase + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); });
  }

  function startEdit(id, token) {
    if (!modal) return;
    api("GET", "/responses/" + encodeURIComponent(id), null, token).then(function (r) {
      if (!r.ok) { alert((r.body.error && r.body.error.message) || T("編集リンクが無効です")); return; }
      editing = { id: id, token: token };
      remember(id, token, r.body.display_name);
      state = {};
      Object.keys(r.body.slots || {}).forEach(function (k) { if (tl.open[k]) state[k] = r.body.slots[k]; });
      $("who-new").classList.add("hidden");
      $("who-edit").classList.remove("hidden");
      $("edit-name-line").textContent = T("{name} さんの予定を直しています", { name: r.body.display_name });
      $("answer-title").textContent = T("予定を直す");
      $("comment").value = r.body.comment || "";
      err("");
        openModal();
    });
  }

  var form = $("answer-form");
  if (form) form.addEventListener("submit", function (e) {
    e.preventDefault();
    err("");
    var body = { slots: Object.assign({}, state), comment: $("comment").value };
    if (!editing) {
      var sel = $("participant-select");
      if (sel && sel.value && sel.value !== "__new") body.participant_id = sel.value;
      else {
        body.display_name = $("display-name").value.trim();
        if (!body.display_name) { err(sel && !sel.value ? T("お名前を選んでください") : T("ニックネームを入れてください")); return; }
      }
    }
    // 入れていない時間は確認せずに「未回答」として登録する
    if (!Object.keys(state).length) { err(T("タイムラインに予定を入れてください")); return; }
    $("submit-btn").disabled = true;
    var req = editing
      ? api("PATCH", "/responses/" + encodeURIComponent(editing.id), body, editing.token)
      : api("POST", "/responses", body);
    req.then(function (r) {
      $("submit-btn").disabled = false;
      if (!r.ok) { err((r.body.error && r.body.error.message) || T("登録できませんでした（{status}）", { status: r.status })); return; }
      var url, msg;
      if (editing) {
        url = location.origin + location.pathname + "#edit=" + editing.id + "." + editing.token;
        msg = T("予定を直しました。");
      } else {
        url = r.body.edit_url;
        var s = $("participant-select");
        remember(r.body.response_id, r.body.edit_token, body.display_name || (s && s.selectedOptions[0].text));
        msg = T("予定を登録しました。");
      }
      try { sessionStorage.setItem("toe-done", JSON.stringify({ url: url, msg: msg })); } catch (x) { /* ignore */ }
      history.replaceState(null, "", location.pathname);
      location.reload();
    }, function () { $("submit-btn").disabled = false; err(T("通信に失敗しました。もう一度お試しください。")); });
  });

  // ---------- after reload / my links / edit hash ----------
  try {
    var done = JSON.parse(sessionStorage.getItem("toe-done") || "null");
    if (done) {
      sessionStorage.removeItem("toe-done");
      $("edit-url").value = done.url;
      $("done-msg").textContent = done.msg;
      $("done-box").classList.remove("hidden");
    }
  } catch (e) { /* ignore */ }

  var my = $("my-links");
  if (my && boot.accepting) {
    storeList().forEach(function (x) {
      var b = el("button", "btn-linklike", T("{name} の予定を直す", { name: x.name || x.id }));
      b.type = "button";
      b.addEventListener("click", function () { startEdit(x.id, x.token); });
      my.appendChild(b);
    });
  }

  function checkHash() {
    var m = location.hash.match(/^#edit=([A-Za-z0-9]+)\.([A-Za-z0-9_\-]+)$/);
    if (!m) return;
    if (boot.accepting) startEdit(m[1], m[2]);
    else alert(T("現在は予定の入力・修正ができません。"));
  }
  window.addEventListener("hashchange", checkHash);

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-copy]");
    if (!b) return;
    var t = document.querySelector(b.dataset.copy);
    t.select();
    (navigator.clipboard && window.isSecureContext ? navigator.clipboard.writeText(t.value) : Promise.resolve(document.execCommand("copy")))
      .then(function () { var s = b.textContent; b.textContent = T("コピーしました"); setTimeout(function () { b.textContent = s; }, 1500); });
  });

  // remember this poll for the top page ("この端末で開いた日程調整"; stays in this browser)
  try {
    var R = "toe-recent", list = JSON.parse(localStorage.getItem(R) || "[]").filter(function (x) { return x.id !== boot.publicId; });
    list.unshift({ id: boot.publicId, title: document.querySelector("h1.ttl").textContent, url: location.pathname, at: Date.now() });
    localStorage.setItem(R, JSON.stringify(list.slice(0, 20)));
  } catch (e) { /* storage unavailable */ }

  renderResults();
  checkHash();
})();
