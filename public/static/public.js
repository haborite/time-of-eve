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

  // ---------- time zone ----------
  // Slot keys ("2026-12-01T13:00") are wall-clock times in the poll's zone: answers, counts and the finalized date use
  // them. Only the layout follows the display zone: tl.at gives each slot's absolute start, and every slot is placed
  // on the display zone's date and time. Rows are display-zone dates (a window crossing midnight splits into two rows);
  // columns follow the slots' own boundaries, so zones offset by :15/:45 get :15/:45 columns.
  var pad = function (n) { return String(n).padStart(2, "0"); };
  var STEP = tl.step;
  var TZ_KEY = "toe-tz";   // "local" | "poll" | an IANA zone; shared by all polls in this browser
  var localTz = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || boot.tz; } catch (e) { return boot.tz; } })();
  var tzChoice = (function () { try { return localStorage.getItem(TZ_KEY) || "local"; } catch (e) { return "local"; } })();
  var WD_JA = ["月", "火", "水", "木", "金", "土", "日"], WD_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var fmts = {};
  function validTz(z) { try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch (e) { return false; } }
  function zoneOf(choice) { var z = choice === "poll" ? boot.tz : choice === "local" ? localTz : choice; return validTz(z) ? z : boot.tz; }
  var tz = zoneOf(tzChoice);
  /** wall clock of an instant in a zone: {y, mo, d, dow (0 = Monday), min (minutes since midnight)} */
  function wall(ms, z) {
    var f = fmts[z] || (fmts[z] = new Intl.DateTimeFormat("en-US", { timeZone: z, hourCycle: "h23", weekday: "short",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }));
    var o = {};
    f.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, mo: +o.month, d: +o.day, dow: WD_EN.indexOf(o.weekday), min: (+o.hour % 24) * 60 + +o.minute };
  }
  function dateLabel(w) { return window.LANG === "en" ? WD_EN[w.dow] + ", " + MON_EN[w.mo - 1] + " " + w.d + ", " + w.y : w.y + "/" + w.mo + "/" + w.d + "(" + WD_JA[w.dow] + ")"; }
  function shortLabel(w) { return window.LANG === "en" ? WD_EN[w.dow] + " " + w.mo + "/" + w.d : w.mo + "/" + w.d + "(" + WD_JA[w.dow] + ")"; }
  function clock(min) { return pad(Math.floor(min / 60) % 24) + ":" + pad(min % 60); }
  function fmtRange(s, e) {
    var a = wall(s, tz), b = wall(e, tz);
    var same = a.y === b.y && a.mo === b.mo && a.d === b.d;
    return dateLabel(a) + " " + clock(a.min) + "–" + (same ? "" : b.mo + "/" + b.d + " ") + clock(b.min);
  }
  function fmtDateTime(ms) { var a = wall(ms, tz); return dateLabel(a) + " " + clock(a.min); }

  // ---------- geometry (for the display zone) ----------
  // days[i] = {i, label, short, dow, phase, cols: [{m, key|null}], groups: [{m, span}], open: [keys in time order]}
  var days = [], openOrder = [], minOf = {};
  function layout() {
    var keys = Object.keys(tl.open).sort(function (a, b) { return tl.at[a] - tl.at[b]; });
    var byDay = {}, order = [], phases = {};
    keys.forEach(function (k) {
      var w = wall(tl.at[k], tz), dk = w.y + "-" + pad(w.mo) + "-" + pad(w.d);
      if (!byDay[dk]) { byDay[dk] = { w: w, slots: [] }; order.push(dk); }
      byDay[dk].slots.push({ key: k, m: w.min });
      phases[w.min % STEP] = (phases[w.min % STEP] || 0) + 1;
    });
    // columns start where the slots start: :00/:30 normally, :15/:45 for e.g. Nepal viewing a Tokyo poll
    var phase = +Object.keys(phases).sort(function (a, b) { return phases[b] - phases[a]; })[0] || 0;
    var col = function (m) { return phase + Math.floor((m - phase) / STEP) * STEP; };
    var grp = function (m) { return phase + Math.floor((m - phase) / 60) * 60; };
    // hours shown (same for every day): hours with a slot plus one hour either side. Hours in between that have no
    // slot are left out, so a window crossing midnight (13–17 Tokyo seen from New York = 23–03) stays compact;
    // the first hour after a gap is marked.
    var shown = {};
    keys.forEach(function (k) {
      var g = grp(col(minOf[k] = wall(tl.at[k], tz).min));
      [g - 60, g, g + 60].forEach(function (x) { if (x >= phase && x < 1440 + phase) shown[x] = true; });
    });
    var hours = Object.keys(shown).map(Number).sort(function (a, b) { return a - b; });
    days = order.map(function (dk, i) {
      var at = {};
      byDay[dk].slots.forEach(function (s) { (at[col(s.m)] = at[col(s.m)] || []).push(s.key); });
      var cols = [], groups = [];
      hours.forEach(function (g, j) {
        var n = 0, gap = j > 0 && g !== hours[j - 1] + 60;
        for (var m = g; m < g + 60; m += STEP) {
          // two slots on one wall time (the display zone's DST fall-back): both get a column
          (at[m] || [null]).forEach(function (key) { cols.push({ m: m, key: key, gap: gap && !n }); n++; });
        }
        groups.push({ m: g, span: n, gap: gap });
      });
      var w = byDay[dk].w;
      return { i: i, label: dateLabel(w), short: shortLabel(w), dow: w.dow, phase: phase, cols: cols, groups: groups,
               open: cols.filter(function (c) { return c.key; }).map(function (c) { return c.key; }) };
    });
    openOrder = [];
    days.forEach(function (d) { d.open.forEach(function (k) { openOrder.push(k); }); });
  }
  function isHour(c, d) { return (c.m - d.phase) % 60 === 0; }
  function slotText(k) { return clock(minOf[k]) + "–" + clock(minOf[k] + STEP); }

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
        d.cols.forEach(function (c) {
          var td = el("td", "tl-cell"), k = c.key;
          if (!k) td.classList.add("off");
          else {
            var v = p.slots[k];
            if (v) { td.classList.add("m-" + v); td.textContent = SYM[v]; td.title = slotText(k) + " " + LABEL[v]; }
            if (finalized[k]) td.classList.add("fx");
          }
          if (isHour(c, d)) td.classList.add("hr");
          if (c.gap) td.classList.add("gap");
          tr.appendChild(td);
        });
        t.appendChild(tr);
      });
      var cr = el("tr", "tl-count");
      var cth = el("th", "tl-name tl-countlabel", T("参加できる人数"));
      cth.scope = "row";
      cr.appendChild(cth);
      d.cols.forEach(function (col) {
        var td = el("td", "tl-cell"), k = col.key;
        if (!k) td.classList.add("off");
        else {
          var c = boot.counts[k] || [0, 0, 0];
          if (c[0]) {
            td.textContent = c[0];
            td.classList.add("has");
            td.style.setProperty("--lv", boot.responded ? (c[0] / boot.responded).toFixed(2) : 0);
          }
          td.title = slotText(k) + "  ○" + c[0] + (boot.allowMaybe ? " △" + c[1] : "") + " ×" + c[2];
          if (finalized[k]) td.classList.add("fx");
        }
        if (isHour(col, d)) td.classList.add("hr");
        if (col.gap) td.classList.add("gap");
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
    d.groups.forEach(function (g) {
      if (!g.span) return;
      var hth = el("th", "tl-hour" + (g.gap ? " gap" : ""), d.phase ? clock(g.m) : pad(Math.floor(g.m / 60) % 24));
      hth.colSpan = g.span;
      hth.scope = "col";
      tr.appendChild(hth);
    });
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
    c.setAttribute("aria-label", slotText(k) + " " + (v ? LABEL[v] : UNSET));
    c.title = slotText(k) + " " + (v ? LABEL[v] : UNSET);
  }

  function makeCell(col, d, idx, vertical) {
    var c = el(vertical ? "div" : "td", "tl-cell" + (vertical ? " v-cell" : ""));
    var k = col.key;
    if (col.gap) c.classList.add("gap");
    if (!k) { c.classList.add("off"); return c; }
    c.dataset.key = k;
    c.classList.add("on");
    c.dataset.day = d.i;
    c.dataset.idx = idx;
    c.setAttribute("role", "button");
    c.tabIndex = -1;
    if (isHour(col, d)) c.classList.add("hr");
    c.appendChild(el("span", "sym"));
    if (vertical) c.appendChild(el("span", "v-min", ":" + pad(col.m % 60)));
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
        d.cols.forEach(function (c) { tr.appendChild(makeCell(c, d, idxOf[c.key], false)); });
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
        // one row per hour group, from the first to the last group with an open slot
        var used = d.groups.filter(function (g) {
          return d.cols.some(function (c) { return c.key && c.m >= g.m && c.m < g.m + 60; });
        });
        d.groups.forEach(function (g) {
          if (g.m < used[0].m || g.m > used[used.length - 1].m) return;
          var row = el("div", "v-row"), h = Math.floor(g.m / 60) % 24;
          row.appendChild(el("span", "v-time", d.phase ? clock(g.m) : window.LANG === "en" ? pad(h) + ":00" : h + "時"));
          d.cols.forEach(function (c) { if (c.m >= g.m && c.m < g.m + 60) row.appendChild(makeCell(c, d, idxOf[c.key], true)); });
          box.appendChild(row);
        });
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

  // ---------- display time zone: switcher, texts, re-layout ----------
  var zones = [];
  try { zones = Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : []; } catch (e) { zones = []; }
  function opt(value, text) { var o = el("option", "", text); o.value = value; return o; }
  function renderTzBars() {
    document.querySelectorAll("[data-tz-bar]").forEach(function (bar) {
      bar.innerHTML = "";
      var lab = el("label", "");
      lab.appendChild(el("span", "tz-lbl", T("表示中のタイムゾーン")));
      var sel = el("select", "tz-sel");
      sel.setAttribute("data-testid", "tz-select");
      sel.appendChild(opt("local", T("あなたの時刻（{tz}）", { tz: localTz })));
      sel.appendChild(opt("poll", T("作成者の時刻（{tz}）", { tz: boot.tz })));
      if (zones.length) {
        var og = el("optgroup");
        og.label = T("ほかのタイムゾーン");
        zones.forEach(function (z) { og.appendChild(opt(z, z)); });
        sel.appendChild(og);
      }
      if (tzChoice !== "local" && tzChoice !== "poll" && !zones.length) sel.appendChild(opt(tzChoice, tzChoice));
      sel.value = tzChoice;
      if (sel.value !== tzChoice) sel.value = "local";
      sel.addEventListener("change", function () { setTz(sel.value); });
      lab.appendChild(sel);
      bar.appendChild(lab);
      if (tz !== boot.tz) bar.appendChild(el("span", "tz-diff", T("作成者のタイムゾーン（{tz}）から変換して表示しています", { tz: boot.tz })));
    });
  }
  function renderTexts() {
    document.querySelectorAll("[data-range]").forEach(function (e) {
      var p = e.getAttribute("data-range").split(",");
      e.textContent = fmtRange(+p[0], +p[1]);
    });
    document.querySelectorAll("[data-ts]").forEach(function (e) { e.textContent = fmtDateTime(+e.getAttribute("data-ts")); });
    var note = $("tz-note");
    if (note) note.textContent = T("時刻は {tz}", { tz: tz });
  }
  function setTz(choice) {
    tzChoice = choice;
    try { localStorage.setItem(TZ_KEY, choice); } catch (e) { /* storage unavailable */ }
    tz = zoneOf(choice);
    render();
  }
  function render() {
    layout();
    renderTzBars();
    renderTexts();
    renderResults();
    if (modal && !modal.classList.contains("hidden")) renderGrid();
  }

  render();
  checkHash();
})();
