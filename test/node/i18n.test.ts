/**
 * Every Japanese UI string must have an English translation in src/i18n/en.json.
 * Collects Japanese string literals from server-rendered views / routes and T("…") calls in browser code (src/client).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
const EN: Record<string, string> = JSON.parse(readFileSync(join(ROOT, "src/i18n/en.json"), "utf8"));
const JA = /[぀-ヿ㐀-鿿！-｠]/;

// sample data and machine-facing text that is intentionally not translated
const ALLOW = new Set([
  "打ち合わせ 日程調整", "オンライン（Zoom）。各候補1時間。", "Aさん", "Bさん", "AI(Cさん)", "山田 太郎", "日程調整",
  "日本語", "・", "｜", "月火水木金土日",
]);

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? files(join(dir, d.name), ext) : ext.test(d.name) ? [join(dir, d.name)] : []);
}

function literals(src: string): string[] {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const out: string[] = [];
  for (const m of noComments.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) {
    try {
      out.push(JSON.parse(`"${m[1]}"`));
    } catch {
      /* not a plain string literal (e.g. inside a regex) */
    }
  }
  return out.filter((s) => JA.test(s));
}

describe("translations", () => {
  const server = [...files("src/views", /\.tsx$/), "src/http/web.tsx", "src/og/card.ts", "src/og/render.ts", "src/oauth.tsx", "src/app.tsx"];
  it("server-rendered strings have English", () => {
    const missing = new Set<string>();
    for (const f of server) {
      for (const s of literals(readFileSync(join(ROOT, f), "utf8"))) {
        if (!ALLOW.has(s) && !(s in EN)) missing.add(`${f}: ${s}`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it("browser T() strings have English", () => {
    const missing: string[] = [];
    const sources = files("src/client", /\.ts$/);
    expect(sources.length).toBeGreaterThan(0);
    for (const f of sources) {
      const src = readFileSync(join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of src.matchAll(/\bT\("((?:[^"\\]|\\.)*)"/g)) {
        const s = JSON.parse(`"${m[1]}"`);
        if (!(s in EN)) missing.push(`${f}: ${s}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
