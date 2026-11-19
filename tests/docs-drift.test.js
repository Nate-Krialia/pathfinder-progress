/**
 * Round 5 (docs and wording): a few statements the docs and the UI used to get wrong, and the API lists that drifted. They fail if the text goes back, or if an API is added to main.js
 * without the docs naming it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(path, "utf8");
const main = read("scripts/main.js");
/** The keys of one api block in main.js ("    tags: {" ... "    },"), as written at six spaces of indent. */
const keysOf = block => {
  const start = main.indexOf(`    ${block}: {`);
  assert.ok(start > 0, `api.${block} is in main.js`);
  const end = main.indexOf("\n    },", start);
  return [...main.slice(start, end).matchAll(/\n      ([A-Za-z]+):/g)].map(m => m[1]);
};

test("docs/22 lists every api.tags function (and says what repairFrozen does)", () => {
  const line = read("docs/22-tags-slice1.md").split("\n").find(l => l.startsWith("`api.tags` (GM only):"));
  assert.ok(line, "the api.tags line is there");
  const missing = keysOf("tags").filter(key => !new RegExp("`" + key + "`").test(line));
  assert.deepEqual(missing, [], "an api.tags function the doc does not name");
  assert.match(read("docs/22-tags-slice1.md"), /api\.tags\.repairFrozen\(\{ reset \}\)/);
});

test("docs/08 names the three repair tools and the backup keys", () => {
  const text = read("docs/08-foundry-integration.md");
  for (const name of ["api.tags.repairFrozen", "api.editor.repair", "api.compendium.repairShared"]) assert.ok(text.includes(name), `${name} is documented`);
  for (const key of ["ledger", "caps", "frozen", "editor", "shared"]) assert.match(text, new RegExp("`" + key + "`"), `the backup key ${key} is documented`);
  assert.ok(keysOf("editor").includes("repair") && keysOf("compendium").includes("repairShared"), "and the APIs exist");
});

test("wording that disagreed with the code is gone", () => {
  const changelog = read("CHANGELOG.md");
  assert.doesNotMatch(changelog, /Not yet: nested inheritance/, "nested inheritance is built");
  assert.doesNotMatch(changelog, /Players never receive the ledger/, "world settings reach every client: the honor system, not secrecy");
  assert.doesNotMatch(changelog, /priority`? \(stored and edited only\)/, "priority is used");
  assert.doesNotMatch(read("scripts/tags/model.js"), /for now it is stored/, "the window's priority hint");
  assert.doesNotMatch(read("docs/22-tags-slice1.md"), /Stored and edited only; later it breaks ties/);
  assert.doesNotMatch(read("docs/22-tags-slice1.md"), /not covered \(UNVERIFIED\)/, "the commission rollback is fixed");
  assert.doesNotMatch(read("docs/22-tags-slice1.md"), /not unlinked token actors, so it is never automatic/, "pruneFrozen searches unlinked token actors");
  assert.doesNotMatch(read("docs/06-commissions.md"), /Owner may \*\*revoke\*\* a loan/, "there is no revoke action");
  assert.doesNotMatch(read("docs/06-commissions.md"), /materials appear in crafter's inventory on accept/, "an NPC supplies at craft time");
  assert.match(read("docs/04-gathering.md"), /resolveCorpseYield/, "docs/04 says the corpse resolver has no caller");
  for (const tab of ["Commissions", "Explore", "Workshop"]) assert.match(read("docs/11-hub-design.md"), new RegExp(`### ${tab}\\n- \\*\\*Status today \\(v0\\.22\\.0\\): a placeholder tab`), `docs/11 says ${tab} is a placeholder`);
  assert.doesNotMatch(read("scripts/tags/state.js").split("\n").slice(0, 6).join("\n"), /never receives it/, "state.js header");
});
