"use strict";
/* New poll: STEP1 basic info, STEP2 pick dates (tap/drag), STEP3 paint times per date (tap/drag), then
   build schema 1.0 JSON and hand it to the import confirmation screen. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var T = window.T, WD = window.WD;
  var SLOT = 30, NSLOT = 24 * 60 / SLOT, MAX = +document.getElementById("new-form").dataset.max || 600;
  var narrowMq = window.matchMedia("(max-width: 640px)");
  var pad = function (n) { return String(n).padStart(2, "0"); };
  var ymd = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  var parse = function (s) { return new Date(s + "T00:00:00"); };
  var hm = function (i) { var m = i * SLOT; return pad(Math.floor(m / 60)) + ":" + pad(m % 60); };
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  var today = new Date(); today.setHours(0, 0, 0, 0);
  var view = new Date(today.getFullYear(), today.getMonth(), 1);
  var dates = new Set();          // "YYYY-MM-DD"
  var times = {};                 // date -> Set(slot index), slot i = [i*30min, (i+1)*30min)
  var bulk = null;                // [from, to) slot indices applied to newly added dates
  var vFrom = 8, vTo = 20;        // visible hours [vFrom, vTo)

  function durSlots() { return +$("duration").value / SLOT; }
  function sortedDates() { return Array.from(dates).sort(); }

  // ---------- STEP 2: calendar ----------
  function monthLabel(d) {
    return d.toLocaleDateString(window.LANG === "en" ? "en-US" : "ja-JP", { year: "numeric", month: "long" });
  }
  function renderCalendar() {
    var host = $("cal-months");
    host.innerHTML = "";
    for (var k = 0; k < 2; k++) {
      var m0 = new Date(view.getFullYear(), view.getMonth() + k, 1);
      var box = el("div", "cal-month");
      box.appendChild(el("div", "cal-label", monthLabel(m0)));
      var g = el("div", "cal-grid");
      WD.forEach(function (w, i) { g.appendChild(el("div", "wd" + (i === 0 ? " sun" : i === 6 ? " sat" : ""), w)); });
      for (var i = 0; i < m0.getDay(); i++) g.appendChild(el("div"));
      var n = new Date(m0.getFullYear(), m0.getMonth() + 1, 0).getDate();
      for (var d = 1; d <= n; d++) {
        var dt = new Date(m0.getFullYear(), m0.getMonth(), d), key = ymd(dt);
        var b = el("button", "day" + (dt.getDay() === 0 ? " sun" : dt.getDay() === 6 ? " sat" : "") +
          (dates.has(key) ? " sel" : "") + (+dt === +today ? " today" : ""), String(d));
        b.type = "button";
        b.dataset.date = key;
        b.setAttribute("aria-pressed", String(dates.has(key)));
        b.setAttribute("aria-label", dt.toLocaleDateString(window.LANG === "en" ? "en-US" : "ja-JP",
          { month: "long", day: "numeric", weekday: "short" }));
        if (dt < today) b.disabled = true;
        g.appendChild(b);
      }
      box.appendChild(g);
      host.appendChild(box);
    }
    var c = dates.size;
    $("date-count").textContent = c ? T("{n}日 選択中", { n: c }) : "";
    $("cal-prev").disabled = view <= new Date(today.getFullYear(), today.getMonth(), 1);
  }
  function setDate(key, on) {
    if (on && !dates.has(key)) {
      dates.add(key);
      times[key] = new Set();
      if (bulk) for (var i = bulk[0]; i < bulk[1]; i++) times[key].add(i);
    } else if (!on && dates.has(key)) {
      dates.delete(key);
      delete times[key];
    }
  }
  var calDrag = null;
  var calHost = $("cal-months");
  function dayAt(x, y) {
    var e = document.elementFromPoint(x, y);
    return e && e.closest ? e.closest("button.day:not(:disabled)") : null;
  }
  calHost.addEventListener("pointerdown", function (e) {
    var b = e.target.closest("button.day");
    if (!b || b.disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    calDrag = { on: !dates.has(b.dataset.date), id: e.pointerId, seen: {} };
    try { calHost.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    calDrag.seen[b.dataset.date] = true;
    setDate(b.dataset.date, calDrag.on);
    syncDay(b);
  });
  calHost.addEventListener("pointermove", function (e) {
    if (!calDrag || e.pointerId !== calDrag.id) return;
    var b = dayAt(e.clientX, e.clientY);
    if (!b || calDrag.seen[b.dataset.date]) return;
    calDrag.seen[b.dataset.date] = true;
    setDate(b.dataset.date, calDrag.on);
    syncDay(b);
  });
  function calEnd(e) {
    if (!calDrag || e.pointerId !== calDrag.id) return;
    calDrag = null;
    renderCalendar(); renderGrid(); update();
  }
  calHost.addEventListener("pointerup", calEnd);
  calHost.addEventListener("pointercancel", calEnd);
  // keyboard: Enter/Space fire click without a pointerdown
  calHost.addEventListener("click", function (e) {
    var b = e.target.closest("button.day");
    if (!b || b.disabled || e.detail !== 0) return;
    setDate(b.dataset.date, !dates.has(b.dataset.date));
    var k = b.dataset.date;
    renderCalendar(); renderGrid(); update();
    var nb = calHost.querySelector('button.day[data-date="' + k + '"]');
    if (nb) nb.focus();
  });
  function syncDay(b) {
    var on = dates.has(b.dataset.date);
    b.classList.toggle("sel", on);
    b.setAttribute("aria-pressed", String(on));
  }
  $("cal-prev").addEventListener("click", function () { view.setMonth(view.getMonth() - 1); renderCalendar(); });
  $("cal-next").addEventListener("click", function () { view.setMonth(view.getMonth() + 1); renderCalendar(); });

  // ---------- STEP 3: time grid ----------
  function fillSelect(sel, from, to, value, fmt) {
    sel.innerHTML = "";
    for (var i = from; i <= to; i++) {
      var o = el("option", "", fmt(i));
      o.value = i;
      sel.appendChild(o);
    }
    sel.value = value;
  }
  var hourFmt = function (h) { return window.LANG === "en" ? pad(h) + ":00" : h + "時"; };
  fillSelect($("bulk-from"), 0, NSLOT - 1, 20, hm);
  fillSelect($("bulk-to"), 1, NSLOT, 36, hm);
  function syncView() {
    fillSelect($("view-from"), 0, 23, vFrom, hourFmt);
    fillSelect($("view-to"), 1, 24, vTo, hourFmt);
  }
  function ensureVisible(a, b) {   // slot range [a, b)
    vFrom = Math.min(vFrom, Math.floor(a * SLOT / 60));
    vTo = Math.max(vTo, Math.ceil(b * SLOT / 60));
    syncView();
  }
  $("view-from").addEventListener("change", function () {
    vFrom = +this.value; if (vTo <= vFrom) vTo = Math.min(24, vFrom + 1); syncView(); renderGrid();
  });
  $("view-to").addEventListener("change", function () {
    vTo = +this.value; if (vTo <= vFrom) vFrom = Math.max(0, vTo - 1); syncView(); renderGrid();
  });

  var grid = $("time-grid");
  var rows = [];       // date keys in display order
  var cellOf = {};     // "r:i" -> cell

  function dateLabel(key) {
    var d = parse(key);
    return { text: window.shortDate(d), cls: d.getDay() === 0 ? " sun" : d.getDay() === 6 ? " sat" : "" };
  }
  function removeBtn(key) {
    var b = el("button", "btn-linklike small", T("外す"));
    b.type = "button";
    b.title = T("この日を外す");
    b.setAttribute("aria-label", T("この日を外す"));
    b.addEventListener("click", function () { setDate(key, false); renderCalendar(); renderGrid(); update(); });
    return b;
  }
  function makeCell(tag, r, i, extra) {
    var c = el(tag, "tl-cell on" + (extra || ""));
    c.dataset.r = r;
    c.dataset.i = i;
    c.setAttribute("role", "button");
    c.tabIndex = -1;
    if ((i * SLOT) % 60 === 0) c.classList.add("hr");
    cellOf[r + ":" + i] = c;
    return c;
  }
  function paintCell(r, i) {
    var c = cellOf[r + ":" + i];
    if (!c) return;
    var on = times[rows[r]].has(i);
    c.classList.toggle("m-sel", on);
    c.setAttribute("aria-pressed", String(on));
    c.setAttribute("aria-label", rows[r] + " " + hm(i) + "–" + hm(i + 1) + (on ? " " + T("選択中") : ""));
  }
  function renderGrid() {
    grid.innerHTML = "";
    cellOf = {};
    rows = sortedDates();
    if (!rows.length) { grid.className = ""; grid.appendChild(el("p", "empty-note", T("STEP 2 で日付を選んでください"))); return; }
    var a = vFrom * 60 / SLOT, b = vTo * 60 / SLOT, perHour = 60 / SLOT;
    var vertical = narrowMq.matches;
    if (!vertical) {
      grid.className = "tl-scroll";
      var t = el("table", "tl tl-ans tl-new");
      t.style.setProperty("--cols", b - a);
      var hr = el("tr", "tl-headrow");
      hr.appendChild(el("th", "tl-name", T("日付")));
      for (var h = vFrom; h < vTo; h++) { var th = el("th", "tl-hour", pad(h)); th.colSpan = perHour; th.scope = "col"; hr.appendChild(th); }
      t.appendChild(hr);
      rows.forEach(function (key, r) {
        var tr = el("tr", "tl-candrow");
        var lab = dateLabel(key);
        var nth = el("th", "tl-name tl-date" + lab.cls);
        nth.scope = "row";
        nth.appendChild(el("div", "", lab.text));
        nth.appendChild(removeBtn(key));
        tr.appendChild(nth);
        for (var i = a; i < b; i++) tr.appendChild(makeCell("td", r, i));
        t.appendChild(tr);
      });
      grid.appendChild(t);
    } else {
      grid.className = "tl-vertical";
      rows.forEach(function (key, r) {
        var box = el("div", "v-day");
        var head = el("div", "v-head");
        var lab = dateLabel(key);
        head.appendChild(el("span", "v-date" + lab.cls, lab.text));
        head.appendChild(removeBtn(key));
        box.appendChild(head);
        for (var h = vFrom; h < vTo; h++) {
          var row = el("div", "v-row");
          row.appendChild(el("span", "v-time", hourFmt(h)));
          for (var j = 0; j < perHour; j++) {
            var i = h * perHour + j;
            var c = makeCell("div", r, i, " v-cell");
            c.appendChild(el("span", "v-min", ":" + pad((i * SLOT) % 60)));
            row.appendChild(c);
          }
          box.appendChild(row);
        }
        grid.appendChild(box);
      });
    }
    rows.forEach(function (key, r) { for (var i = a; i < b; i++) paintCell(r, i); });
    var first = cellOf["0:" + a];
    if (first) first.tabIndex = 0;
  }

  // tap = one "予定時間" span from the cell; drag = rectangle (horizontal) or range within the day (vertical)
  var drag = null;
  function applyDrag(r1, i1) {
    var vertical = narrowMq.matches;
    var ra = vertical ? drag.r0 : Math.min(drag.r0, r1), rb = vertical ? drag.r0 : Math.max(drag.r0, r1);
    var ia, ib;
    if (r1 === drag.r0 && i1 === drag.i0 && !drag.moved) { ia = drag.i0; ib = Math.min(NSLOT, drag.i0 + durSlots()) - 1; }
    else { ia = Math.min(drag.i0, i1); ib = Math.max(drag.i0, i1); }
    rows.forEach(function (key, r) {
      var s = new Set(drag.snapshot[key]);
      if (r >= ra && r <= rb) for (var i = ia; i <= ib; i++) { if (drag.on) s.add(i); else s.delete(i); }
      times[key] = s;
    });
    rows.forEach(function (key, r) { for (var i = vFrom * 60 / SLOT; i < vTo * 60 / SLOT; i++) paintCell(r, i); });
  }
  function snapshot() {
    var o = {};
    rows.forEach(function (k) { o[k] = Array.from(times[k]); });
    return o;
  }
  function cellAt(x, y) {
    var e = document.elementFromPoint(x, y);
    return e && e.closest ? e.closest("#time-grid .tl-cell.on") : null;
  }
  grid.addEventListener("pointerdown", function (e) {
    var c = e.target.closest(".tl-cell.on");
    if (!c || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    var r = +c.dataset.r, i = +c.dataset.i;
    drag = { r0: r, i0: i, on: !times[rows[r]].has(i), id: e.pointerId, moved: false, snapshot: snapshot() };
    try { grid.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    applyDrag(r, i);
    focusCell(c);
  });
  grid.addEventListener("pointermove", function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    autoScroll(e.clientY);
    var c = cellAt(e.clientX, e.clientY);
    if (!c) return;
    var r = +c.dataset.r, i = +c.dataset.i;
    if (!drag.moved && r === drag.r0 && i === drag.i0) return;
    drag.moved = true;
    applyDrag(r, i);
  });
  function gridEnd(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    try { grid.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    update();
  }
  grid.addEventListener("pointerup", gridEnd);
  grid.addEventListener("pointercancel", gridEnd);
  grid.addEventListener("contextmenu", function (e) { if (e.target.closest(".tl-cell.on")) e.preventDefault(); });
  grid.addEventListener("keydown", function (e) {
    var c = e.target.closest(".tl-cell.on");
    if (!c) return;
    var r = +c.dataset.r, i = +c.dataset.i, a = vFrom * 60 / SLOT, b = vTo * 60 / SLOT;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      drag = { r0: r, i0: i, on: !times[rows[r]].has(i), moved: false, snapshot: snapshot() };
      applyDrag(r, i);
      drag = null;
      update();
      return;
    }
    var vertical = narrowMq.matches, nr = r, ni = i;
    if (e.key === "ArrowRight") ni = i + 1;
    else if (e.key === "ArrowLeft") ni = i - 1;
    else if (e.key === "ArrowDown") { if (vertical) ni = i + 60 / SLOT; else nr = r + 1; }
    else if (e.key === "ArrowUp") { if (vertical) ni = i - 60 / SLOT; else nr = r - 1; }
    else return;
    e.preventDefault();
    if (ni >= b) { ni = a; nr++; } else if (ni < a) { ni = b - 1; nr--; }
    var n = cellOf[nr + ":" + ni];
    if (n) focusCell(n);
  });
  function focusCell(c) {
    Object.keys(cellOf).forEach(function (k) { cellOf[k].tabIndex = -1; });
    c.tabIndex = 0;
    c.focus({ preventScroll: true });
  }
  function autoScroll(y) {
    if (y < 60) window.scrollBy(0, -14);
    else if (y > window.innerHeight - 140) window.scrollBy(0, 14);
  }
  narrowMq.addEventListener("change", renderGrid);

  $("bulk-set").addEventListener("click", function () {
    var a = +$("bulk-from").value, b = +$("bulk-to").value, err = $("new-error");
    if (b <= a) { err.textContent = T("終了は開始より後にしてください"); err.classList.remove("hidden"); return; }
    err.classList.add("hidden");
    bulk = [a, b];
    sortedDates().forEach(function (k) { times[k] = new Set(); for (var i = a; i < b; i++) times[k].add(i); });
    ensureVisible(a, b);
    renderGrid(); update();
  });
  $("reset-all").addEventListener("click", function () {
    var any = sortedDates().some(function (k) { return times[k].size; });
    if (any && !confirm(T("選んだ時間をすべて外しますか？（日付の選択はそのままです）"))) return;
    bulk = null;
    sortedDates().forEach(function (k) { times[k] = new Set(); });
    renderGrid(); update();
  });

  // ---------- candidates ----------
  function isoAt(date, i) {   // slot boundary -> local wall-clock time in the poll's time zone (i may be NSLOT = next day 00:00)
    var d = parse(date);
    if (i >= NSLOT) { d.setDate(d.getDate() + 1); i -= NSLOT; }
    return ymd(d) + "T" + hm(i);
  }
  function blocksOf(set) {
    var idx = Array.from(set).sort(function (x, y) { return x - y; }), out = [];
    idx.forEach(function (i) {
      var last = out[out.length - 1];
      if (last && last[1] === i) last[1] = i + 1; else out.push([i, i + 1]);
    });
    return out;
  }
  function candidates() {
    var n = durSlots(), mode = $("split").value, list = [], frag = 0;
    sortedDates().forEach(function (d) {
      blocksOf(times[d]).forEach(function (bl) {
        var a = bl[0], b = bl[1];
        if (mode === "block") { list.push([d, a, b]); return; }
        if (b - a < n) { frag++; return; }
        // a candidate of the meeting length starts every 30 minutes (every duration if shorter, e.g. 15 min)
        var step = Math.min(1, n);
        for (var s = a; s + n <= b; s += step) list.push([d, s, s + n]);
      });
    });
    return { list: list, frag: frag };
  }
  function update() {
    var c = candidates(), p = $("preview");
    $("count").textContent = c.list.length;
    $("count").classList.toggle("over", c.list.length > MAX);
    $("frag-note").textContent = c.frag ? T("予定時間に満たない時間帯が{n}か所あります（候補になりません）", { n: c.frag }) : "";
    p.innerHTML = "";
    if (!c.list.length) { p.appendChild(el("span", "chip-empty", dates.size ? T("STEP 3 で時間を選んでください") : T("STEP 2 で日付を選んでください"))); }
    c.list.forEach(function (x) { p.appendChild(el("span", "", window.shortDate(parse(x[0])) + " " + hm(x[1]) + "–" + hm(x[2]))); });
    save();
  }
  ["duration", "split"].forEach(function (id) { $(id).addEventListener("change", update); });

  // ---------- keep the form when coming back from the confirmation screen ----------
  var STORE = "toe-new-draft";
  var FIELDS = ["title", "desc", "duration", "deadline", "people", "split", "tz"];
  function save() {
    try {
      var o = { dates: sortedDates(), times: {}, bulk: bulk, vFrom: vFrom, vTo: vTo,
                maybe: $("allow-maybe").checked, names: $("show-names").checked };
      FIELDS.forEach(function (f) { o[f] = $(f).value; });
      sortedDates().forEach(function (k) { o.times[k] = Array.from(times[k]); });
      sessionStorage.setItem(STORE, JSON.stringify(o));
    } catch (e) { /* storage unavailable */ }
  }
  function restore() {
    var nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    var back = (nav && nav.type === "back_forward") || location.hash === "#restore";
    if (!back) { try { sessionStorage.removeItem(STORE); } catch (e) { /* ignore */ } return; }
    try {
      var o = JSON.parse(sessionStorage.getItem(STORE) || "null");
      if (!o) return;
      FIELDS.forEach(function (f) { if (o[f] !== undefined) $(f).value = o[f]; });
      $("allow-maybe").checked = o.maybe !== false;
      $("show-names").checked = o.names !== false;
      bulk = o.bulk || null; vFrom = o.vFrom || vFrom; vTo = o.vTo || vTo;
      (o.dates || []).forEach(function (k) { if (parse(k) >= today) { dates.add(k); times[k] = new Set(o.times[k] || []); } });
      var first = sortedDates()[0];
      if (first) { var d = parse(first); view = new Date(d.getFullYear(), d.getMonth(), 1); }
    } catch (e) { /* ignore */ }
  }
  ["title", "desc", "deadline", "people", "allow-maybe", "show-names", "tz"].forEach(function (id) { $(id).addEventListener("change", save); });

  // ---------- submit ----------
  $("new-form").addEventListener("submit", function (ev) {
    var c = candidates(), list = c.list, errBox = $("new-error"), msgs = [];
    if (!$("title").value.trim()) msgs.push(T("タイトルを入力してください"));
    if (!dates.size) msgs.push(T("日付を選んでください（STEP 2）"));
    else if (!list.length) msgs.push(T("候補日時がありません。時間を選んでください（STEP 3）"));
    if (list.length > MAX) msgs.push(T("候補は{max}件以内にしてください（現在 {n} 件）", { max: MAX, n: list.length }));
    if (msgs.length) {
      ev.preventDefault();
      errBox.textContent = msgs.join(" / ");
      errBox.classList.remove("hidden");
      if (!$("title").value.trim()) $("title").focus();
      return;
    }
    errBox.classList.add("hidden");
    var people = $("people").value.split("\n").map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      return l.charAt(0) === "*" ? { display_name: l.slice(1).trim(), required: true } : { display_name: l, required: false };
    });
    var data = {
      title: $("title").value.trim(),
      description: $("desc").value.trim(),
      timezone: $("tz").value,
      show_participant_names: $("show-names").checked,
      allow_maybe: $("allow-maybe").checked,
      candidates: list.map(function (x) { return { start: isoAt(x[0], x[1]), end: isoAt(x[0], x[2]) }; }),
      participants: people
    };
    if ($("split").value !== "block") data.duration_minutes = +$("duration").value;
    if ($("deadline").value) data.response_deadline = $("deadline").value;
    data.client_request_id = "web-" + ymd(new Date()) + "-" + Math.random().toString(36).slice(2, 10);
    $("json-out").value = JSON.stringify(data, null, 2);
    save();
  });

  restore();
  syncView();
  renderCalendar(); renderGrid(); update();
})();
