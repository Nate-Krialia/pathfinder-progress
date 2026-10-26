/**
 * Wiring checks: catches "X is not a function" and "no such export" bugs without
 * Foundry. Foundry modules are glued together with namespace imports
 * (`import * as adapter from ...`), which Node does NOT check at load time, so a
 * missing function only blows up when that line finally runs. These tests read
 * every source file and verify each `namespace.member` and each named import
 * really exists in the module it points at.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve("scripts");

function sourceFiles(dir = ROOT) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : name.endsWith(".js") ? [path] : [];
  });
}

/** Strip comments and string/template contents so only real code is scanned for `ns.member`. */
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

const exportsOf = async path => Object.keys(await import(pathToFileURL(path).href));

const files = sourceFiles();
const isEntry = path => path.endsWith("main.js"); // main.js registers Hooks at load, so it is scanned, not imported

test("the scanner sees the source tree", () => {
  assert.ok(files.length >= 25, `only found ${files.length} files`);
  assert.ok(files.some(isEntry));
});

test("every module (except main.js) loads in plain Node with no missing named imports", async () => {
  for (const path of files.filter(f => !isEntry(f))) {
    await assert.doesNotReject(import(pathToFileURL(path).href), path);
  }
});

test("every `namespace.member` used actually exists in the module the namespace imports", async () => {
  let checked = 0;
  for (const path of files) {
    const raw = readFileSync(path, "utf8");
    const code = codeOnly(raw);
    for (const [, name, from] of raw.matchAll(/import \* as (\w+) from "([^"]+)"/g)) {
      const target = resolve(dirname(path), from);
      const available = new Set(await exportsOf(target));
      const used = new Set([...code.matchAll(new RegExp(`\\b${name}\\.(\\w+)`, "g"))].map(m => m[1]));
      for (const member of used) {
        checked++;
        assert.ok(available.has(member), `${path.replace(ROOT, "scripts")}: ${name}.${member} is used, but ${from} does not export "${member}"`);
      }
    }
  }
  assert.ok(checked > 30, `only checked ${checked} uses; the scanner may be broken`);
});

test("every named import (including in main.js) exists in its module", async () => {
  let checked = 0;
  for (const path of files) {
    const raw = readFileSync(path, "utf8");
    for (const [, names, from] of raw.matchAll(/import \{([^}]+)\} from "([^"]+)"/g)) {
      if (!from.startsWith(".")) continue;
      const available = new Set(await exportsOf(resolve(dirname(path), from)));
      for (const spec of names.split(",").map(s => s.trim()).filter(Boolean)) {
        const imported = spec.split(/\s+as\s+/)[0].trim();
        checked++;
        assert.ok(available.has(imported), `${path.replace(ROOT, "scripts")}: imports "${imported}" from ${from}, which does not export it`);
      }
    }
  }
  assert.ok(checked > 40, `only checked ${checked} imports`);
});

test("the scanner really does catch a missing member (self-test)", async () => {
  const available = new Set(await exportsOf(resolve(ROOT, "adapter/pf2e.js")));
  assert.ok(available.has("giveMaterial"), "giveMaterial must be exported by the adapter");
  assert.ok(!available.has("thisFunctionDoesNotExist"));
});
