/**
 * v0.22.0 layout: the condition blocks in the Item editor (several per class, a table by tier, a valueless one with no value control) and the GM's effect card in the chat
 * log, against the hostile Foundry styles, in narrow windows. The big matrix (tests/hub-layout.test.js) also draws every scene in build/harness.mjs; these checks make sure the
 * new scenes really contain what they claim (so a clean matrix means something) and cover the narrow, short-window cases.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HOSTILE, launchChromium, openHarness, renderState } from "../build/harness.mjs";

let browser = null, skip = false;
try { browser = await launchChromium(); } catch (error) { skip = process.env.REQUIRE_CHROMIUM === "1" ? false : `Chromium is not available (${String(error.message).split("\n")[0]})`; if (skip === false) throw error; }
if (browser) await browser.close();

test("EDITOR LAYOUT (conditions): three condition blocks with their selects and a tier table stay clean in wide, narrow and short windows against every hostile style", { skip, timeout: 240000 }, async () => {
  const b = await launchChromium();
  try {
    const page = await openHarness(b);
    for (const hostile of [null, ...Object.keys(HOSTILE)]) for (const [width, height] of [[900, 820], [400, 600], [400, 300], [280, 500]]) for (const textSize of [100, 175]) {
      const { problems } = await renderState(page, { scene: "editorConditions", theme: "dark", width, height, textSize, hostile });
      assert.deepEqual(problems, [], `editorConditions ${width}x${height} ${textSize}% hostile=${hostile}`);
    }
    await renderState(page, { scene: "editorConditions", width: 900, hostile: "important 2.5rem" });
    const found = await page.evaluate(() => ({
      conditions: document.querySelectorAll('select[data-name="condition"]').length, saves: document.querySelectorAll('select[data-name="save"]').length,
      indexes: [...document.querySelectorAll('select[data-name="condition"]')].map(s => s.dataset.index),
      cells: document.querySelectorAll('input[data-field="cell"][data-type="condition"]').length,
      valueInputs: document.querySelectorAll('input[data-field="block"][data-type="condition"][data-name="value"]').length,
      removes: document.querySelectorAll('[data-action="remove-block"][data-type="condition"]').length,
      addCondition: document.querySelectorAll('[data-action="add-block"][data-type="condition"]').length,
      heights: [...document.querySelectorAll('.pfp-block select')].map(s => s.getBoundingClientRect().height)
    }));
    assert.deepEqual([found.conditions, found.saves, found.indexes], [3, 3, ["0", "1", "2"]]);
    assert.equal(found.cells, 5, "the frightened block shows a T1 to T5 table");
    assert.equal(found.valueInputs, 1, "the stupefied block has one value box; off-guard (valueless) has none, and frightened shows its table instead");
    assert.equal(found.removes, 3); assert.equal(found.addCondition, 1);
    assert.ok(found.heights.every(h => h >= 40), "selects are real targets, not Foundry's 2rem");
    // a worn class is not offered the block at all
    await renderState(page, { scene: "editorConditionsArmor", width: 900 });
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-action="add-block"][data-type="condition"]').length), 0);
  } finally { await b.close(); }
});

test("CARD LAYOUT: the GM's effect card (pending with Apply and Skip, and done) fits at 300px and narrower with long names, in every hostile style; the buttons are 44px targets", { skip, timeout: 240000 }, async () => {
  const b = await launchChromium();
  try {
    const page = await openHarness(b);
    for (const scene of ["fxCardPending", "fxCardDone"]) for (const hostile of [null, ...Object.keys(HOSTILE)]) for (const width of [900, 400, 300, 280, 220]) for (const textSize of [100, 175]) for (const theme of ["parchment", "dark", "contrast"]) {
      const { problems } = await renderState(page, { scene, theme, width, textSize, hostile });
      assert.deepEqual(problems, [], `${scene} ${theme} ${width}px ${textSize}% hostile=${hostile}`);
    }
    await renderState(page, { scene: "fxCardPending", width: 280, hostile: "important 2.5rem" });
    const buttons = await page.evaluate(() => [...document.querySelectorAll("[data-pfp-fx]")].map(el => { const r = el.getBoundingClientRect(); return [el.textContent, Math.round(r.width), Math.round(r.height), r.right <= innerWidth]; }));
    assert.deepEqual(buttons.map(x => x[0]), ["Apply", "Skip"]);
    assert.ok(buttons.every(x => x[1] >= 44 && x[2] >= 44 && x[3]), `both buttons are on screen and at least 44px: ${JSON.stringify(buttons)}`);
    await renderState(page, { scene: "fxCardDone", width: 280, hostile: "important 2.5rem" });
    assert.equal(await page.evaluate(() => document.querySelectorAll("button").length), 0, "a handled card has no buttons");
  } finally { await b.close(); }
});
