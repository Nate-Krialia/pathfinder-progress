/**
 * Round 4 / 1b #4: a source scan so a NEW unescaped interpolation in a chat message fails. Every `${...}` inside a template literal that builds chat HTML (a line with <strong>, <em>,
 * <p>, <li>, <ul> or <br>) must be wrapped in esc(...) or be on the short list of expressions that cannot carry a name (numbers, fixed words, text already escaped). The Hub, the editor
 * and the tags window draw their own DOM with their own escaping (and are tested by their own suites); adapter/pf2e.js builds item descriptions (GM-authored definition text), not chat.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP_DIRS = ["scripts/tags", "scripts/editor", "scripts/hub"];
const SKIP_FILES = ["scripts/adapter/pf2e.js", "scripts/queue/review.js", "scripts/queue/review-app.js"];
const walk = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : path.endsWith(".js") ? [path] : [];
});

/** The top-level ${...} expressions of a line (braces matched, strings and nested templates skipped over). */
function expressions(line) {
  const out = [];
  for (let at = line.indexOf("${"); at !== -1; at = line.indexOf("${", at + 1)) {
    let depth = 1, i = at + 2;
    for (; i < line.length && depth; i++) {
      if (line[i] === "{") depth++;
      else if (line[i] === "}") depth--;
    }
    out.push(line.slice(at + 2, i - 1));
    at = i - 1;
  }
  return out;
}

// Expressions that cannot carry a name: numbers, fixed words, markup the module built from escaped parts. Anything else must be esc(...).
const SAFE = [
  /^results\.length\b/, /^Math\.abs\(applied\)$/, /^project\.progress$/, /^project\.threshold$/, /^applied < 0 \? /, /^DEGREE_LABEL\[outcome\.degree\]$/, /^result\.passed \? "Success" : "Failure"$/,
  /^plan\.station\.tier$/, /^unitsUsed\b/, /^outcome\.feeConsumed$/, /^action\.daysReserved$/, /^lines\.join\("<br>"\)$/, /^summary$/, /^who$/, /^message \? /,
  /^formatGatherSummary\(/, /^patronActor \? "" : /, /^outcome\.made \? /, /^entry\.learn\./, /^text \? ` \$\{esc\(text\)\}\.` : ""$/, /^button/, /^buttons\(\)$/, /^n\.tier$/, /^n\.perceptionDC$/,
  /^results\.map\(r => `<li>\$\{esc\(r\.name\)\} \$\{esc\(r\.lines\.join\(", "\)\)\}\.<\/li>`\)\.join\(""\)$/
];
const isSafe = expr => /^esc\(/.test(expr.trim()) || SAFE.some(re => re.test(expr.trim()));

test("every interpolation in a chat-HTML template is escaped or cannot carry a name", () => {
  const files = walk("scripts").filter(f => !SKIP_DIRS.some(d => f.startsWith(d + "/")) && !SKIP_FILES.includes(f.replaceAll("\\", "/")));
  const found = [];
  for (const file of files) {
    readFileSync(file, "utf8").split("\n").forEach((line, n) => {
      if (!/<(strong|em|p|li|ul|br)\b/.test(line) || !line.includes("`")) return;
      for (const expr of expressions(line)) if (!isSafe(expr)) found.push(`${file}:${n + 1}: \${${expr}}`);
    });
  }
  assert.deepEqual(found, [], "an unescaped interpolation in chat HTML (wrap it in esc(...), or add it to SAFE if it cannot carry a name)");
});

test("the scan itself works: it flags a planted unescaped name and passes an escaped one", () => {
  assert.deepEqual(expressions("`<p>${actor.name} and ${esc(item.name)} and ${a ? `${b}` : 1}</p>`"), ["actor.name", "esc(item.name)", "a ? `${b}` : 1"]);
  assert.equal(isSafe("actor.name"), false);
  assert.equal(isSafe("esc(actor.name)"), true);
});
