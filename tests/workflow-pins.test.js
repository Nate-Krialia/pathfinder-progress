/**
 * Round 5: the workflow does not float. Every `uses:` is pinned to a full commit sha with its version tag in a comment, and the runner image is a named version (never ubuntu-latest, which moved
 * to 26.04 under us once). Node 22 and the apt packages Playwright installs are left floating on purpose.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const FILES = readdirSync(".github/workflows").filter(f => /\.ya?ml$/.test(f));

test("every action in every workflow is pinned to a full commit sha, with its tag in a comment", () => {
  assert.ok(FILES.length > 0);
  const found = [];
  for (const file of FILES) {
    readFileSync(`.github/workflows/${file}`, "utf8").split("\n").forEach((line, n) => {
      const m = /^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/.exec(line);
      if (!m) return;
      const [, ref, rest] = m;
      if (!/@[0-9a-f]{40}$/.test(ref)) found.push(`${file}:${n + 1}: ${ref} is not pinned to a 40-character commit sha`);
      else if (!/#\s*v\d/.test(rest)) found.push(`${file}:${n + 1}: ${ref} has no version tag in a comment`);
    });
  }
  assert.deepEqual(found, []);
});

test("no workflow runs on a floating runner image", () => {
  for (const file of FILES) assert.doesNotMatch(readFileSync(`.github/workflows/${file}`, "utf8"), /runs-on:\s*\S*-latest/, `${file} runs on a floating image`);
});

test("the pin check itself works: a tag, a short sha and a missing comment are all caught", () => {
  const check = line => { const m = /^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/.exec(line); return m && /@[0-9a-f]{40}$/.test(m[1]) && /#\s*v\d/.test(m[2]); };
  assert.equal(Boolean(check("      - uses: actions/checkout@v4")), false);
  assert.equal(Boolean(check("      - uses: actions/checkout@11d5960")), false);
  assert.equal(Boolean(check("      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262")), false);
  assert.equal(Boolean(check("      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0")), true);
});
