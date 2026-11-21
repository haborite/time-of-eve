/**
 * Public answer page: the display time zone — the switchers ([data-tz-bar]) and the server-rendered times
 * (data-range="startMs,endMs", data-ts="ms") redrawn in that zone. The choice is kept for all polls in this browser.
 */
import { $opt, el, option } from "../lib/dom";
import { LANG, T } from "../lib/i18n";
import { loadString, saveString } from "../lib/storage";
import { fmtDateTime, fmtRange, zoneOf, type TzChoice } from "./timeline";

const TZ_KEY = "toe-tz";

export interface TzBar {
  /** The display zone (IANA). */
  zone(): string;
  /** Redraw the switchers and the times. */
  render(): void;
}

function browserZone(fallback: string): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || fallback;
  } catch {
    return fallback;
  }
}

function allZones(): string[] {
  try {
    return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  } catch {
    return [];
  }
}

/** @param onChange called after the viewer picks another zone */
export function createTzBar(pollTz: string, onChange: () => void): TzBar {
  const localTz = browserZone(pollTz);
  const zones = allZones();
  let choice: TzChoice = loadString("local", TZ_KEY) || "local";
  let tz = zoneOf(choice, localTz, pollTz);

  function renderBars(): void {
    document.querySelectorAll("[data-tz-bar]").forEach((bar) => {
      bar.innerHTML = "";
      const lab = el("label", "");
      lab.appendChild(el("span", "tz-lbl", T("表示中のタイムゾーン")));
      const sel = el("select", "tz-sel");
      sel.setAttribute("data-testid", "tz-select");
      sel.appendChild(option("local", T("あなたの時刻（{tz}）", { tz: localTz })));
      sel.appendChild(option("poll", T("作成者の時刻（{tz}）", { tz: pollTz })));
      if (zones.length) {
        const og = el("optgroup");
        og.label = T("ほかのタイムゾーン");
        for (const z of zones) og.appendChild(option(z, z));
        sel.appendChild(og);
      } else if (choice !== "local" && choice !== "poll") {
        sel.appendChild(option(choice, choice));
      }
      sel.value = choice;
      if (sel.value !== choice) sel.value = "local";
      sel.addEventListener("change", () => {
        choice = sel.value;
        saveString("local", TZ_KEY, choice);
        tz = zoneOf(choice, localTz, pollTz);
        onChange();
      });
      lab.appendChild(sel);
      bar.appendChild(lab);
      if (tz !== pollTz) bar.appendChild(el("span", "tz-diff", T("作成者のタイムゾーン（{tz}）から変換して表示しています", { tz: pollTz })));
    });
  }

  function renderTexts(): void {
    document.querySelectorAll<HTMLElement>("[data-range]").forEach((e) => {
      const [s, en] = (e.dataset.range ?? "").split(",").map(Number);
      e.textContent = fmtRange(LANG, s, en, tz);
    });
    document.querySelectorAll<HTMLElement>("[data-ts]").forEach((e) => { e.textContent = fmtDateTime(LANG, Number(e.dataset.ts), tz); });
    const note = $opt("tz-note");
    if (note) note.textContent = T("時刻は {tz}", { tz });
  }

  return {
    zone: () => tz,
    render() {
      renderBars();
      renderTexts();
    },
  };
}
