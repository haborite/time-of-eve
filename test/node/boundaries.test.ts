/**
 * Module boundaries between the Worker and the browser code:
 *  - src/shared runs in both, so it imports nothing outside src/shared (no packages, no Worker / DOM-only code)
 *  - src/client is bundled for the browser, so its runtime imports stay in src/client and src/shared;
 *    `import type` from elsewhere (e.g. the poll schema type) is fine because it is erased
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? files(join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [join(dir, d.name)] : []);
}

/** [specifier, type-only] of every import / re-export in a file. */
function imports(file: string): [string, boolean][] {
  const src = readFileSync(join(ROOT, file), "utf8");
  return [...src.matchAll(/^\s*(import|export)\s+(type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gm)]
    .map((m) => [m[3], !!m[2]]);
}

/** Where a specifier points, relative to the repo root ("zod" stays a package name). */
function target(file: string, spec: string): string {
  return spec.startsWith(".") ? relative(ROOT, resolve(ROOT, dirname(file), spec)) : spec;
}

describe("module boundaries", () => {
  it("src/shared imports only src/shared", () => {
    const bad = files("src/shared").flatMap((f) =>
      imports(f).filter(([s]) => !target(f, s).startsWith("src/shared/")).map(([s]) => `${f}: ${s}`));
    expect(bad).toEqual([]);
  });

  it("src/client imports runtime code only from src/client and src/shared", () => {
    const sources = files("src/client");
    expect(sources.length).toBeGreaterThan(0);
    const bad = sources.flatMap((f) =>
      imports(f).filter(([s, typeOnly]) => {
        const t = target(f, s);
        return !typeOnly && !t.startsWith("src/client/") && !t.startsWith("src/shared/");
      }).map(([s]) => `${f}: ${s}`));
    expect(bad).toEqual([]);
  });
});
