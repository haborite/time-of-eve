/**
 * Share image (1200×630 PNG): satori (layout → SVG) + resvg (SVG → PNG), both WebAssembly.
 *
 * Workers cannot compile WebAssembly from bytes at runtime; @cf-wasm/* import their .wasm files as modules
 * (bundled by Wrangler) and initialize them. (satori ≥ 0.40 loads a HarfBuzz .wasm by URL, which Workers cannot do;
 * @cf-wasm/satori pins a version without it.) Most link-preview services do not accept SVG, hence PNG.
 *
 * Fonts: Noto Sans JP from Google Fonts, subset to exactly the characters drawn (`text=` parameter), so a font is a
 * few KB and quick to parse. Fonts and finished images are kept in the Cache API. If fonts cannot be fetched the
 * caller falls back to the static image in /static.
 */
import { Resvg } from "@cf-wasm/resvg/workerd";
import { satori } from "@cf-wasm/satori/workerd";
import { t } from "../lib/i18n";
import { SITE_NAME, type Card } from "./card";

const W = 1200, H = 630;
const PINK = "#fe899c", PINK_DARK = "#d6546c", PINK_SOFT = "#ffa0af", INK = "#333333", MUTED = "#787878", LINE = "#ececec";
const STATUS_COLORS: Record<string, [string, string]> = {
  open: ["#2ea05a", "#e6f6ec"], closed: ["#6e6e6e", "#eeeeee"], finalized: [PINK_DARK, "#ffebef"],
  cancelled: ["#969696", "#f0f0f0"], draft: ["#6e6e6e", "#eeeeee"],
};

type Node = { type: string; props: Record<string, unknown> };
function h(type: string, style: Record<string, unknown>, ...children: (Node | string | null | false)[]): Node {
  const kids = children.filter((x) => x !== null && x !== false) as (Node | string)[];
  return { type, props: { style: { display: "flex", ...style }, children: kids.length === 1 ? kids[0] : kids } };
}

function logo(size: number): Node {
  // calendar with ○ and △ (same as the site icon)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="3" y="6" width="26" height="23" rx="4" fill="${PINK}"/><rect x="3" y="6" width="26" height="7" rx="3" fill="${PINK_DARK}"/><rect x="9" y="3" width="3" height="7" rx="1.5" fill="${PINK_DARK}"/><rect x="20" y="3" width="3" height="7" rx="1.5" fill="${PINK_DARK}"/><circle cx="11" cy="20" r="3.4" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M19 23.5l3.5-6 3.5 6z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>`;
  return { type: "img", props: { src: `data:image/svg+xml;base64,${btoa(svg)}`, width: size, height: size, style: { display: "flex" } } };
}

function tree(card: Card): Node {
  const m = 40;
  const header = h("div", { alignItems: "center", justifyContent: "space-between", width: "100%" },
    h("div", { alignItems: "center", gap: 14 }, logo(60), h("div", { fontSize: 32, fontWeight: 700, color: PINK_DARK }, SITE_NAME)),
    card.statusLabel ? h("div", {
      fontSize: 28, fontWeight: 700, color: (STATUS_COLORS[card.status] ?? STATUS_COLORS.closed)[0],
      backgroundColor: (STATUS_COLORS[card.status] ?? STATUS_COLORS.closed)[1], borderRadius: 26, padding: "8px 22px",
    }, card.statusLabel) : null,
  );
  let body: Node;
  if (!card.status) {
    body = h("div", { flexDirection: "column", justifyContent: "space-between", flexGrow: 1, paddingTop: 40 },
      h("div", { fontSize: 60, fontWeight: 700, color: INK, lineHeight: 1.35 }, t(card.lang, "人間にもAIにも使いやすい日程調整")),
      h("div", { fontSize: 30, color: MUTED }, t(card.lang, "候補を選んでURLを送るだけ・回答はログイン不要・API / MCP 対応")),
    );
  } else {
    const len = [...card.title].length;
    const size = len <= 24 ? 72 : len <= 48 ? 60 : 50;
    const main = card.finalized ? `${t(card.lang, "確定日時")}  ${card.finalized}` : [card.period, card.count].filter(Boolean).join("   ");
    const sub = [card.deadline, card.responded].filter(Boolean).join("   ");
    body = h("div", { flexDirection: "column", flexGrow: 1 },
      h("div", { flexGrow: 1, alignItems: "center" },
        h("div", { fontSize: size, fontWeight: 700, color: INK, lineHeight: 1.3, lineClamp: 3, display: "block" }, card.title)),
      h("div", { flexDirection: "column", borderTop: `2px solid ${LINE}`, paddingTop: 22, gap: 12 },
        h("div", { fontSize: 34, fontWeight: 700, color: card.finalized ? PINK_DARK : INK }, main || " "),
        sub ? h("div", { fontSize: 28, color: MUTED }, sub) : null),
    );
  }
  return h("div", { width: W, height: H, backgroundColor: PINK, position: "relative", fontFamily: "Noto Sans JP" },
    h("div", { position: "absolute", right: -140, top: -140, width: 400, height: 400, borderRadius: 200, backgroundColor: PINK_SOFT }),
    h("div", { position: "absolute", left: -120, bottom: -110, width: 280, height: 280, borderRadius: 140, backgroundColor: PINK_SOFT }),
    h("div", {
      position: "absolute", left: m, top: m, width: W - 2 * m, height: H - 2 * m, backgroundColor: "#fff", borderRadius: 28,
      flexDirection: "column", padding: "34px 56px 40px",
    }, header, body),
  );
}

function textOf(card: Card): string {
  const extra = card.status ? t(card.lang, "確定日時") : t(card.lang, "人間にもAIにも使いやすい日程調整") + t(card.lang, "候補を選んでURLを送るだけ・回答はログイン不要・API / MCP 対応");
  return [...new Set([...Object.values(card).join("") + SITE_NAME + extra + "0123456789/:()–〜 ·…"])].join("");
}

const fontMemo = new Map<string, Promise<ArrayBuffer>>();

/** Subset font from Google Fonts (TrueType: no browser User-Agent ⇒ the CSS points to .ttf). */
async function loadFont(weight: 400 | 700, text: string): Promise<ArrayBuffer> {
  const cssUrl = `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@${weight}&text=${encodeURIComponent(text)}`;
  let p = fontMemo.get(cssUrl);
  if (!p) {
    p = (async () => {
      const cache = await caches.open("og-fonts");
      const hit = await cache.match(cssUrl);
      if (hit) return hit.arrayBuffer();
      const css = await (await fetch(cssUrl)).text();
      const src = /src:\s*url\((https:[^)]+)\)\s*format\('(truetype|opentype)'\)/.exec(css)?.[1];
      if (!src) throw new Error("font url not found in Google Fonts CSS");
      const res = await fetch(src);
      if (!res.ok) throw new Error(`font fetch ${res.status}`);
      const buf = await res.arrayBuffer();
      await cache.put(cssUrl, new Response(buf, { headers: { "Cache-Control": "public, max-age=2592000" } }));
      return buf;
    })();
    fontMemo.set(cssUrl, p);
    p.catch(() => fontMemo.delete(cssUrl));
    if (fontMemo.size > 200) fontMemo.delete(fontMemo.keys().next().value!);
  }
  return p;
}

export async function renderPng(card: Card): Promise<Uint8Array> {
  const text = textOf(card);
  const [regular, bold] = await Promise.all([loadFont(400, text), loadFont(700, text)]);
  const svg = await satori(tree(card) as never, {
    width: W, height: H,
    fonts: [{ name: "Noto Sans JP", data: regular, weight: 400, style: "normal" }, { name: "Noto Sans JP", data: bold, weight: 700, style: "normal" }],
  });
  const png = (await Resvg.async(svg, { fitTo: { mode: "width", value: W } })).render();
  const out = png.asPng();
  png.free();
  return out;
}
