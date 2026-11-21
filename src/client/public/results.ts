/** Public answer page: everyone's answers and the counts per slot ("みんなの予定"), one table per day. */
import type { SlotKey } from "../../shared/public-boot";
import { button, el } from "../lib/dom";
import { T } from "../lib/i18n";
import { headRow, LABEL, markClass, slotText, SYM, type Page } from "./page";
import { isHour, type Col, type DayRow } from "./timeline";

export interface ResultsOptions {
  /** Answers made from this browser (response id → edit token): their names become edit buttons. */
  editable: Map<string, string>;
  onEdit: (id: string, token: string) => void;
}

export function renderResults(host: HTMLElement, page: Page, opts: ResultsOptions): void {
  const { boot, layout } = page;
  const finalized = new Set<SlotKey>(boot.finalized);
  host.innerHTML = "";
  if (!layout.days.length) {
    host.appendChild(el("p", "muted", T("候補がありません")));
    return;
  }

  /** Empty cell with the classes every row shares. */
  const cell = (c: Col, d: DayRow): HTMLTableCellElement => {
    const td = el("td", "tl-cell");
    if (!c.key) td.classList.add("off");
    else if (finalized.has(c.key)) td.classList.add("fx");
    if (isHour(c, d)) td.classList.add("hr");
    if (c.gap) td.classList.add("gap");
    return td;
  };

  for (const d of layout.days) {
    const wrap = el("div", "tl-scroll");
    const t = el("table", "tl tl-res");
    t.style.setProperty("--cols", String(d.cols.length));
    t.appendChild(headRow(d, null));
    for (const p of boot.people) {
      const tr = el("tr", "tl-prow");
      const th = el("th", "tl-name");
      th.scope = "row";
      const token = opts.editable.get(p.id);
      if (token && boot.accepting) {
        const b = button("btn-linklike", p.name, () => opts.onEdit(p.id, token));
        b.title = T("この予定を直す");
        th.appendChild(b);
      } else {
        th.appendChild(el("span", "pname", p.name));
      }
      tr.appendChild(th);
      for (const c of d.cols) {
        const td = cell(c, d);
        const v = c.key ? p.slots[c.key] : undefined;
        if (c.key && v) {
          td.classList.add(markClass(v));
          td.textContent = SYM[v];
          td.title = slotText(page, c.key) + " " + LABEL[v];
        }
        tr.appendChild(td);
      }
      t.appendChild(tr);
    }
    const cr = el("tr", "tl-count");
    const cth = el("th", "tl-name tl-countlabel", T("参加できる人数"));
    cth.scope = "row";
    cr.appendChild(cth);
    for (const c of d.cols) {
      const td = cell(c, d);
      if (c.key) {
        const [yes, maybe, no] = boot.counts[c.key] ?? [0, 0, 0];
        if (yes) {
          td.textContent = String(yes);
          td.classList.add("has");
          td.style.setProperty("--lv", boot.responded ? (yes / boot.responded).toFixed(2) : "0");
        }
        td.title = slotText(page, c.key) + "  ○" + yes + (boot.allowMaybe ? " △" + maybe : "") + " ×" + no;
      }
      cr.appendChild(td);
    }
    t.appendChild(cr);
    wrap.appendChild(t);
    host.appendChild(wrap);
  }
}
