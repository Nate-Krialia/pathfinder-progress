/**
 * Round 5 / stage 1 #28: an export that nothing refers to (not another script, not its own file, not a test, not a click script) is dead code. The six that were found are gone, and this scan
 * fails on any new one. Exports that only a test uses are NOT flagged here (they are listed in the round report; a test-only export is a seam, not dead code).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = dir => readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : /\.m?js$/.test(path) ? [path] : []; });
const count = (text, name) => (text.match(new RegExp(`(?<![A-Za-z0-9_$])${name.replace(/\$/g, "\\$")}(?![A-Za-z0-9_$])`, "g")) ?? []).length;

test("no exported function, class or constant is referenced nowhere at all", () => {
  const scripts = walk("scripts"), others = [...walk("tests"), ...walk("e2e")];
  const text = Object.fromEntries([...scripts, ...others].map(f => [f, readFileSync(f, "utf8")]));
  const dead = [];
  for (const file of scripts) {
    for (const m of text[file].matchAll(/^export\s+(?:async\s+)?(?:const|let|function\*?|class)\s+([A-Za-z0-9_$]+)/gm)) {
      const name = m[1];
      const used = count(text[file], name) > 1 || [...scripts, ...others].some(f => f !== file && count(text[f], name) > 0);
      if (!used) dead.push(`${file}: ${name}`);
    }
  }
  assert.deepEqual(dead, [], "an export nobody refers to: delete it, or use it");
});

test("the scan itself works: a name referenced once is found, a name referenced twice is not", () => {
  assert.equal(count("export const lonely = 1;", "lonely"), 1);
  assert.equal(count("export const used = 1; used + 1", "used"), 2);
  assert.equal(count("export const usedAlot = 1", "used"), 0, "a longer name is not a use");
});
