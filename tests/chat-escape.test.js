/**
 * Round 4 / stage 1 #10 and 1b #4: a name that came from data is HTML-escaped wherever it goes into a chat message. Whether Foundry sanitises chat HTML itself is not relied on:
 * the fix is harmless either way (a name like <b>x</b> must read as text, once, in every message).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { formatSummary } from "../scripts/crafting/summary.js";
import { formatProgressSummary, formatResearchSummary } from "../scripts/research/summary.js";
import { formatGatherSummary } from "../scripts/gathering/summary.js";
import { plainText } from "../scripts/gm-log.js";

const NAME = "<b>x</b>";
const ESCAPED = "&lt;b&gt;x&lt;/b&gt;";
const outcome = { degree: "success", made: true, summary: { unitsUsed: 2, unitsKept: 0 }, feeConsumed: 1 };

test("the craft summary escapes the crafter, the recipe, the item and the station", () => {
  const html = formatSummary({ crafterName: NAME, plan: { recipeName: NAME, resultName: NAME, station: { name: NAME, tier: 1 } }, outcome, itemName: NAME });
  assert.doesNotMatch(html, /<b>/);
  assert.equal(html.split(ESCAPED).length - 1, 4, "all four names are there, escaped once each");
  assert.doesNotMatch(html, /&amp;lt;/, "and not twice");
});

test("the research summaries escape the character, the goal, the skill and a GM's reason", () => {
  const project = { goalName: NAME, dc: 15, progress: 1, threshold: 5 };
  const text = formatResearchSummary({ actorName: NAME, project, skillName: NAME, results: [{ day: 1, degree: "success", delta: 1, total: 20 }], completed: true });
  assert.doesNotMatch(text, /<b>/);
  assert.equal(text.split(ESCAPED).length - 1, 5, "the header names three, the 'has learned' line two");
  const progress = formatProgressSummary({ actorName: NAME, project, applied: 2, reason: NAME, completed: false });
  assert.doesNotMatch(progress, /<b>/);
  assert.equal(progress.split(ESCAPED).length - 1, 3);
});

test("the gather summary escapes the character, the node, the skill and the materials", () => {
  const html = formatGatherSummary({ gathererName: NAME, node: { name: NAME }, skillName: NAME, result: { passed: true, gains: [{ materialId: "m", quantity: 2 }], stateAfter: "active" }, materialNames: { m: NAME } });
  assert.doesNotMatch(html, /<b>/);
  assert.equal(html.split(ESCAPED).length - 1, 4);
});

test("the GM log reads the escaped names back as the names they are (and never decodes twice)", () => {
  const html = formatResearchSummary({ actorName: `A&B "<i>" it's`, project: { goalName: "&lt;", dc: 1, progress: 0, threshold: 1 }, skillName: "Crafting", results: [{ day: 1, degree: "success", delta: 1, total: 3 }], completed: false, forGM: true });
  const text = plainText(html);
  assert.match(text, /A&B "<i>" it's researches &lt; \(Crafting/, text);
});
