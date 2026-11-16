"use strict";
/* Tiny client-side i18n: T("日本語の原文", {k: v}) returns the English text when the page language is en. */
(function () {
  var dict = {};
  try { dict = JSON.parse(document.getElementById("i18n").textContent || "{}"); } catch (e) { dict = {}; }
  var lang = document.documentElement.lang === "en" ? "en" : "ja";
  window.LANG = lang;
  window.T = function (s, kw) {
    var out = Object.prototype.hasOwnProperty.call(dict, s) ? dict[s] : s;
    if (kw) out = out.replace(/\{(\w+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(kw, k) ? kw[k] : m; });
    return out;
  };
  window.WD = lang === "en" ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["日", "月", "火", "水", "木", "金", "土"];
  /* "11/15(日)" or "Sun 11/15" for a Date */
  window.shortDate = function (d) {
    var md = (d.getMonth() + 1) + "/" + d.getDate();
    return lang === "en" ? window.WD[d.getDay()] + " " + md : md + "(" + window.WD[d.getDay()] + ")";
  };
})();
