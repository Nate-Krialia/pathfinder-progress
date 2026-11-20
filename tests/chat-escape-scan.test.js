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
  /^results\.map\(r => `<li>\$\{esc\(r\.name\)\} \$\{esc\(r\.lines\.join\(", "\)\)\}\.<\/li>`\)\.join\(""\)$/,
  // exploration/summary.js (the GM-only summary; it goes to the in-memory GM log, never to chat): two counts, the list built from esc() parts, and notes escaped one by one
  /^rolls\.length$/, /^nodes\.length$/, /^list$/, /^notes\.map\(esc\)\.join\(" "\)$/
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

// Stage 1c: the line scan above only sees a `${...}` on a line that ALSO holds a tag and a backtick, so a name on a continuation line of a multi-line template slipped past it. This scan reads the
// whole file as source (strings, comments, regexes and nested templates skipped properly), finds every template literal whose own text holds a tag, and checks EVERY `${...}` in it, on any line.
const TAG = /<(strong|em|p|li|ul|br)\b/;
const REGEX_BEFORE = /[(,=:[!&|?{};+\-*%<>~^]$|^$/;
export function templatesOf(src) {
  const out = [];
  const skipString = (i, quote) => { i++; while (i < src.length && src[i] !== quote) { if (src[i] === "\\") i++; i++; } return i + 1; };
  const skipRegex = i => { let inClass = false; i++; while (i < src.length) { const c = src[i]; if (c === "\\") { i += 2; continue; } if (c === "[") inClass = true; else if (c === "]") inClass = false; else if (c === "/" && !inClass) return i + 1; i++; } return i; };
  const skipComment = i => (src[i + 1] === "/" ? (src.indexOf("\n", i) === -1 ? src.length : src.indexOf("\n", i)) : (src.indexOf("*/", i + 2) === -1 ? src.length : src.indexOf("*/", i + 2) + 2));
  const lineOf = pos => src.slice(0, pos).split("\n").length;
  function code(i, until) {                       // scan code from i; stop at the `}` that closes depth 0 when `until` is set
    let depth = 0, last = "";
    while (i < src.length) {
      const c = src[i];
      if (c === "`") { i = template(i); last = "`"; continue; }
      if (c === '"' || c === "'") { i = skipString(i, c); last = c; continue; }
      if (c === "/" && (src[i + 1] === "/" || src[i + 1] === "*")) { i = skipComment(i); continue; }
      if (c === "/" && REGEX_BEFORE.test(last)) { i = skipRegex(i); last = "/"; continue; }
      if (c === "{") depth++;
      if (c === "}") { if (until && depth === 0) return i; depth--; }
      if (!/\s/.test(c)) last = c;
      i++;
    }
    return i;
  }
  function template(i) {
    const start = i, exprs = [];
    let text = "";
    i++;
    while (i < src.length && src[i] !== "`") {
      if (src[i] === "\\") { text += src.slice(i, i + 2); i += 2; continue; }
      if (src[i] === "$" && src[i + 1] === "{") {
        const from = i + 2;
        i = code(from, true);
        exprs.push({ text: src.slice(from, i), line: lineOf(from) });
        i++;
        continue;
      }
      text += src[i++];
    }
    out.push({ line: lineOf(start), text, exprs });
    return i + 1;
  }
  code(0, false);
  return out;
}

test("every interpolation in a chat-HTML template is escaped or cannot carry a name, on ANY line of a multi-line template (stage 1c)", () => {
  const files = walk("scripts").filter(f => !SKIP_DIRS.some(d => f.startsWith(d + "/")) && !SKIP_FILES.includes(f.replaceAll("\\", "/")));
  const found = [];
  for (const file of files) {
    for (const t of templatesOf(readFileSync(file, "utf8"))) {
      if (!TAG.test(t.text)) continue;
      for (const e of t.exprs) if (!isSafe(e.text)) found.push(`${file}:${e.line}: \${${e.text.replace(/\s+/g, " ").slice(0, 90)}}`);
    }
  }
  assert.deepEqual(found, [], "an unescaped interpolation in a multi-line chat HTML template (wrap it in esc(...), or add it to SAFE if it cannot carry a name)");
});

test("the multi-line scan itself works: it flags a name on a continuation line, passes an escaped one, and is not fooled by strings, comments, regexes or nested templates", () => {
  const bad = "const html = `\n  <p>\n    ${actor.name}\n  </p>`;";
  const hits = templatesOf(bad).filter(t => TAG.test(t.text)).flatMap(t => t.exprs.filter(e => !isSafe(e.text)).map(e => [e.line, e.text]));
  assert.deepEqual(hits, [[3, "actor.name"]], "the unescaped name on line 3 is found");
  const good = "const html = `\n  <p>\n    ${esc(actor.name)}\n  </p>`;";
  assert.deepEqual(templatesOf(good).filter(t => TAG.test(t.text)).flatMap(t => t.exprs.filter(e => !isSafe(e.text))), []);
  const tricky = "const a = \"`\"; // `<p>${x}</p>`\nconst re = /[`\"]<p>/g; const b = `<li>${items.map(i => `<b>${esc(i)}</b>`).join(\"\")}</li>`;";
  const found = templatesOf(tricky);
  assert.equal(found.length, 2, "the backtick in a string, a comment and a regex does not start a template; the nested template is its own entry");
  assert.deepEqual(found.map(t => t.exprs.map(e => e.text)), [["esc(i)"], ["items.map(i => `<b>${esc(i)}</b>`).join(\"\")"]]);
});
