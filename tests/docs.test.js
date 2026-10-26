/**
 * Keeps the documentation honest about recipe visibility. Foundry does not enforce read
 * permissions on compendium or world Journal contents (verified in Foundry 14.369), so the
 * recipes pack is an honor system. These checks stop wording that promises more than that.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = path => readFileSync(path, "utf8");
const DOCS = ["CLAUDE.md", "docs/01-data-model.md", "docs/02-research.md", "docs/10-stage2-decisions.md"];

test("each doc that mentions recipe visibility calls it an honor system", () => {
  for (const path of DOCS) assert.match(read(path), /honor system/i, `${path} must say recipe visibility is an honor system`);
});

test("no doc, comment or label promises secrecy for recipes", () => {
  const files = [...DOCS, "README.md", "module.json", "build/pack.mjs", ...readdirSync("scripts", { recursive: true }).filter(f => f.endsWith(".js")).map(f => `scripts/${f}`)];
  const banned = [/GM-only (compendium|pack)/i, /spoiler protection/i, /recipes? (are|is) secret/i, /cannot be read by players/i, /players (can|could) not read/i, /players never hold recipes/i, /Recipes \(GM only\)/];
  for (const path of files) {
    const text = read(path);
    for (const pattern of banned) assert.doesNotMatch(text, pattern, `${path} promises secrecy: ${pattern}`);
  }
});

test("the decision record states the verified finding and the decision", () => {
  const text = read("docs/10-stage2-decisions.md");
  assert.match(text, /does not enforce this as access control/);
  assert.match(text, /getDocuments\(\)/);
  assert.match(text, /Decision: keep it as an honor system/);
  assert.match(text, /403 by URL/);
});

test("the research docs say each result records the natural d20", () => {
  assert.match(read("docs/10-stage2-decisions.md"), /`natural` \(the natural d20\)/);
});
