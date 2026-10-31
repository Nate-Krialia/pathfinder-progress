/**
 * The Stage 11d gate (docs/20-stage11d-gate.md): every code block is extracted and run, in order, in a fake Foundry, and the click steps are played by real clicks on the
 * real item editor window (strict ApplicationV2 stand-in, jsdom): the test clicks what the step tells the person to click, then runs the step's block against what is on
 * the page and in the world. What it cannot show: the real window, fonts, focus rings, real PF2e item sheets and prices, the real Tab key, a file download or the file picker.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { M, as, env, getApi, getUsers, makeActor, quietly, world } from "./fake-world.js";
import { asPage, chatLeaks, seedRecords } from "./helpers.js";
import { installFakeApplication } from "./fake-application.js";

const gateDoc = readFileSync("docs/20-stage11d-gate.md", "utf8");
const MODULE_VERSION = JSON.parse(readFileSync("module.json", "utf8")).version;
const GATE = new Map();
for (const match of gateDoc.matchAll(/^## Step (\d+) ((?:\[[^\]]+\](?: and )?)+)[^\n]*\n([\s\S]*?)(?=^## Step |^## Group |(?![\s\S]))/gm)) {
  const block = match[3].match(/```js\n([\s\S]*?)```/);
  GATE.set(Number(match[1]), { who: match[2], code: block?.[1] ?? null, text: match[3] });
}
function runBlock(step, user) {
  const entry = GATE.get(step);
  assert.ok(entry?.code, `docs/20-stage11d-gate.md needs a code block in Step ${step}`);
  const code = entry.code.replace(/^(\/\/[^\n]*\n)*\s*await \(/, match => match.replace("await (", "("));
  return as(user, () => (0, eval)(code));
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const gateWorld = async () => {
  const w = await world({ downtime: 0, iron: 0, fang: 0, perClientDefinitions: true });
  getApi().baseSources = seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }));
  getApi().editorLeftovers = [];
  return w;
};
const clean = () => ({ records: Object.keys(getApi().editor.records()).length, items: game.items.length, folders: game.folders.length, overlay: Object.keys(env.values.discoveryTracks ?? {}).length });

test("the stage 11d gate doc: steps are labelled, click-through steps say what you should see, screenshots are asked for only where layout matters", () => {
  assert.deepEqual([...GATE.keys()], Array.from({ length: 21 }, (_, i) => i + 1));
  for (const [step, entry] of GATE) {
    assert.match(entry.who, /^\[(GM|Player)\]( and \[(GM|Player)\])?\s*$/, `step ${step} says who runs it`);
    assert.ok(entry.code, `step ${step} has a code block`);
    assert.equal((entry.text.match(/```js/g) ?? []).length, 1, `step ${step} has ONE code block`);
    if (!/no clicks|Nothing to click/i.test(entry.text) && step > 2 && step !== 21) assert.match(entry.text, /What to do and see|What you should see|What to do/i, `click-through step ${step} says what to see`);
  }
  assert.deepEqual([...GATE].filter(([, e]) => /send me a screenshot/i.test(e.text)).map(([n]) => n), [3, 20], "screenshots: the whole window with its three panes, and the narrow layout");
  assert.match(gateDoc, new RegExp(`version must be \\*\\*${MODULE_VERSION.replace(/\./g, "\\.")}\\*\\*`));
  assert.match(gateDoc, /Force-reload BOTH windows first/);
  assert.match(gateDoc, /\(v0\.21\.0\)/);
  for (const must of [/What SETUP plants/, /orphaned research track/, /material:g20-orphan/, /preflight/i, /Leftovers/, /Push to copies/, /Plan note/, /Research note/, /already knows something this changes/, /Take back my edits/, /Show retired/, /still in use/]) assert.match(gateDoc, must);
  assert.doesNotMatch(gateDoc.replace(/DC\b[^\n]*never/gi, ""), /\bDC \d|odds of|\d+% chance/i, "the gate text itself never talks about difficulty to the player");
});

test("GATE 20: every step runs in order, and the click steps are played by real clicks on the real editor window", async () => {
  const w = await gateWorld();
  const api = getApi();
  const { gm, testUser } = getUsers();
  const logged = console.log;
  const expectPass = async (step, user = gm) => {
    const sink = [];
    console.log = (...args) => sink.push(args.map(String).join(" "));
    try { assert.equal(await runBlock(step, user), "ALL PASS", `step ${step} did not report ALL PASS:\n${sink.join("\n").split("\n").filter(l => l.startsWith("FAIL")).join("\n")}`); } finally { console.log = logged; }
  };
  installFakeApplication();
  foundry.utils.saveDataToFile = () => {};
  let app;
  const el = () => app.element;
  const text = () => el().textContent.replace(/\s+/g, " ");
  const click = async (action, where = "") => {
    const target = [...el().querySelectorAll(`[data-action="${action}"]${where}`)].find(b => b.getAttribute("aria-disabled") !== "true");
    assert.ok(target, `a live ${action}${where} button is on the page`);
    await as(gm, async () => { target.click(); await wait(30); });
  };
  const set = async (selector, value, event = "change") => {
    const input = el().querySelector(selector);
    assert.ok(input, `${selector} is on the page`);
    input.value = value;
    await as(gm, async () => { input.dispatchEvent(new window.Event(event, { bubbles: true })); await wait(30); });
  };
  const seen = pattern => assert.match(text(), pattern);
  const basic = name => `[data-field="basic"][data-name="${name}"]`;
  const block = (cls, type, name) => `[data-field="block"][data-cls="${cls}"][data-type="${type}"][data-name="${name}"]`;
  const create = name => `[data-field="create"][data-name="${name}"]`;
  const gateKey = "material:gate-g20-fang";
  const pick = key => click("pick-item", `[data-key="${key}"]`);

  await quietly(async () => {
    // Steps 1-2
    assert.deepEqual(await runBlock(1, gm), ["GM", true, MODULE_VERSION]);
    assert.deepEqual(await runBlock(1, testUser), ["Test", false, MODULE_VERSION]);
    const setup = await runBlock(2, gm);
    assert.equal(setup.planted.length, 3);
    assert.match(setup.planted[0], /material:g20-orphan/);
    assert.match(setup.notes, /Steps 12 and 13 edit and restore the pack material/);
    assert.equal((await runBlock(2, gm)).already, "set up");
    const packKey = testUser.getFlag(M, "gateSetup20").pack.key;
    const packName = testUser.getFlag(M, "gateSetup20").pack.name;
    const recipeId = testUser.getFlag(M, "gateSetup20").recipeId;

    // Step 3: open the editor and pick the pack material
    await as(gm, async () => { app = api.discovery.openEditor(); await wait(30); });
    await pick(packKey);
    await expectPass(3);
    // Step 4: make a material
    await click("new-material");
    assert.equal(el().querySelector('[data-action="do-create"]').getAttribute("aria-disabled"), "true");
    seen(/Give it a name first\./);
    await set(create("name"), "Gate G20 Fang");
    await set(create("tier"), "2");
    await click("do-create");
    seen(/Made Gate G20 Fang and an item for it in the world's Items\./);
    await expectPass(4);
    // Step 5: Basics, Save, Push to copies
    await set(basic("value"), "12");
    await set(basic("bulk"), "1");
    await set(basic("label"), "Parts");
    await set(basic("description"), "A fang from a throwaway beast.");
    seen(/You have unsaved changes/);
    seen(/Worth 12 gp each/);
    await click("save");
    seen(/Saved Gate G20 Fang\. Use Push to copies/);
    await click("push-copies");
    seen(/Write this item's name, image, description, bulk and price onto every copy/);
    assert.equal(document.activeElement?.dataset?.action, "confirm-no", "focus lands on the safe answer");
    await click("confirm-yes");
    await expectPass(5);
    // Step 6: the Weapon class
    await click("effect-class", '[data-cls="weapon"]');
    await click("add-block", '[data-cls="weapon"][data-type="damage"]');
    assert.equal(el().querySelector('[data-action="add-block"][data-type="damage"]').getAttribute("aria-disabled"), "true");
    assert.match(el().querySelector('[data-part="preview"]').textContent, /Gate G20 Fang adds \+1d6 fire damage/);
    await click("add-block", '[data-cls="weapon"][data-type="ability"]');
    await set(block("weapon", "ability", "title"), "Gate Bite");
    await set(block("weapon", "ability", "text"), "The bite lingers.");
    assert.match(el().querySelector('[data-part="preview"]').textContent, /Gate G20 Fang gives Gate Bite: The bite lingers\./);
    await click("tier-mode", '[data-name="dice"][data-mode="table"]');
    assert.equal(el().querySelectorAll('[data-field="cell"]').length, 5);
    await set('[data-field="cell"][data-tier="2"]', "2d6");
    assert.match(el().querySelector('[data-part="preview"]').textContent, /adds \+2d6 fire damage/);
    await click("save");
    await expectPass(6);
    // Step 7: other classes, base power, the picker
    await click("effect-class", '[data-cls="bomb"]');
    await click("add-block", '[data-cls="bomb"][data-type="damage"]');
    await set(block("bomb", "damage", "dice"), "1d4");
    await set(block("bomb", "damage", "damageType"), "acid");
    await click("effect-class", '[data-cls="trinket"]');
    assert.equal(el().querySelector('[data-action="add-block"][data-type="damage"]').getAttribute("aria-disabled"), "true", "a trinket has no damage block");
    await click("add-block", '[data-cls="trinket"][data-type="resistance"]');
    await set(block("trinket", "resistance", "value"), "5");
    await click("effect-class", '[data-cls="weapon"]');
    await set('[data-field="power"][data-cls="weapon"]', "2");
    await click("save");
    await set('[data-field="preview-class"]', "trinket");
    assert.match(el().querySelector('[data-part="preview"]').textContent, /Gate G20 Fang gives resistance 5 to fire/);
    assert.doesNotMatch(el().querySelector('[data-part="preview"]').textContent, /fire damage/);
    await set('[data-field="preview-class"]', "weapon");
    await expectPass(7);
    // Step 8: notes
    await click("new-note");
    await set(create("name"), "Gate G20 Plan");
    await set(create("recipeId"), recipeId);
    await set(create("preset"), "plan");
    await click("do-create");
    seen(/Made Gate G20 Plan and an item for it/);
    await click("new-note");
    await set(create("name"), "Gate G20 Research");
    await set(create("recipeId"), recipeId);
    await set(create("preset"), "research");
    await click("do-create");
    await expectPass(8);
    // Steps 9-11: a character who knows it; Save asks; No, then Yes
    await expectPass(9);
    await pick(gateKey);
    await click("effect-class", '[data-cls="general"]');
    await set('[data-field="power"][data-cls="general"]', "1");
    await click("save");
    seen(/Gate G20 Scholar already knows something this changes \(what it does in crafts\)\. Save anyway\?/);
    await click("confirm-no");
    await expectPass(10);
    await click("save");
    await click("confirm-yes");
    seen(/Saved Gate G20 Fang\./);
    await expectPass(11);
    // Steps 12-13: a pack item gets a world patch, and takes it back
    await pick(packKey);
    await set(basic("name"), `${packName} (G20)`);
    await click("save");
    seen(/From the packs, with edits made here\. Edited here: name\./);
    await expectPass(12);
    await click("revert");
    seen(/Take back every edit made here/);
    await click("confirm-yes");
    seen(/Back to the packs' version\./);
    await expectPass(13);
    // Steps 14-16: retire and delete
    await expectPass(14);
    await set('[data-field="search"]', "delete me", "input");
    await pick("material:gate-g20-delete-me");
    await click("delete");
    seen(/Delete this item and its world item\? This cannot be undone/);
    await click("confirm-yes");
    seen(/It is still in use \(held as 1 in Gate G20 Scholar\), so it was not deleted\. Retire it instead/);
    await click("retire");
    seen(/Retired\. It no longer shows in the lists unless you turn on Show retired\./);
    assert.equal(el().querySelectorAll('[data-action="pick-item"][data-key="material:gate-g20-delete-me"]').length, 0, "retired items leave the list");
    await click("toggle-chip", '[data-chip="show:retired"]');
    assert.equal(el().querySelectorAll('[data-action="pick-item"][data-key="material:gate-g20-delete-me"]').length, 1, "Show retired brings it back to the list");
    seen(/Gate G20 Delete Me \(Tier 1\)[^▾]*· retired/);
    await click("retire");
    seen(/Brought back\./);
    await click("toggle-chip", '[data-chip="show:retired"]');
    await expectPass(15);
    await click("delete");
    await click("confirm-yes");
    seen(/Deleted\./);
    await expectPass(16);
    // Step 17: export / import
    await click("export");
    seen(/Exported \d+ records?\./);
    await expectPass(17);
    // Step 18: the orphan, through Leftovers
    await set('[data-field="search"]', "", "input");
    seen(/Leftovers \(1\)[\s\S]*material:g20-orphan is a research track for an item that no longer exists/);
    await click("clear-leftover", '[data-key="material:g20-orphan"]');
    seen(/Removed material:g20-orphan\./);
    await expectPass(18);
    // Step 19: the Player window
    await as(testUser, () => api.definitions.refresh({ force: true })).catch(error => { throw new Error(`${error.message} :: ${JSON.stringify(env.handlerThrows)}`); });
    await expectPass(19, testUser);
    // Step 20: keyboard and a narrow window (jsdom has no layout engine: the geometry is stubbed here, the real values are what the person checks)
    await pick(gateKey);
    for (const watched of globalThis.__fakeDom.observers.flatMap(o => [...o.targets])) globalThis.__fakeDom.resize(watched, 300);
    await wait(30);
    await expectPass(20);
    // Step 21: CLEANUP
    const cleanup = await runBlock(21, gm);
    assert.deepEqual(cleanup, { problems: [], actorsLeft: 0, recordsLeft: 0, itemsLeft: 0, tracksLeft: 0, audit: [] });
  });
  assert.deepEqual(clean(), { records: 0, items: 0, folders: 0, overlay: 0 }, "the world is as it was: no record, no item, no folder the gate made, no track");
  assert.equal(game.actors.getName("Gate G20 Scholar"), undefined);
  assert.equal(api.definitions.material.has("g20-memory"), false);
  assert.equal(api.definitions.material.get(testUser.getFlag?.(M, "x") ?? "iron").name, "Iron", "the pack material has its own name again");
  assert.equal(globalThis.__g20, undefined);
  assert.deepEqual(chatLeaks(env.chat), [], "nothing the editor did put a DC, a roll or a percentage in chat");
  assert.equal(foundry.applications.instances.has("pathfinder-progress-item-editor"), false, "the window was closed by CLEANUP");
  void w;
});

test("GATE 20: SETUP refuses to run on top of an earlier run or real data, and runs twice; CLEANUP works from the middle, twice, and after a reload", async () => {
  const { gm } = getUsers();
  for (const [label, prepare, expected] of [
    ["an editor record left behind", async () => { await as(getUsers().gm, () => getApi().editor.create("material", { name: "Gate G20 Left", tier: 1 }, { makeItem: false })); }, /an earlier run left editor records behind \(material:gate-g20-left\)/],
    ["a world item left behind", async () => { await Item.create({ name: "Gate G20 Stray", type: "treasure", system: {}, flags: {} }); }, /an earlier run left world items behind \(Gate G20 Stray\)/],
    ["a real actor named like a gate one", async () => { game.actors.push(makeActor("Gate G20 Scholar")); }, /already exists and was not made by this check/],
    ["a leftover research track", async () => { env.values.discoveryTracks = { "material:g20-orphan": { milestones: [{ steps: 2, grants: { type: "properties" } }] } }; }, /an earlier run left a research track behind/]
  ]) {
    await gateWorld();
    await prepare();
    const before = JSON.stringify({ ...clean(), actors: game.actors.map(a => a.name) });
    await quietly(async () => assert.rejects(Promise.resolve(runBlock(2, gm)), expected, label));
    assert.equal(JSON.stringify({ ...clean(), actors: game.actors.map(a => a.name) }), before, `${label}: nothing changed`);
    if (label === "a leftover research track") {
      // MUST-DO: after a GM reload the planted orphan's item is long gone but its track is still saved; CLEANUP clears it all the same.
      const result = await quietly(() => runBlock(21, gm));
      assert.deepEqual(result.problems, [], "CLEANUP copes with a track whose item is gone");
      assert.deepEqual(env.values.discoveryTracks, {}, "the orphan is cleared");
    }
    delete globalThis.__g20;
  }
  await gateWorld();
  await quietly(async () => {
    const first = await runBlock(2, gm);
    assert.equal(Object.keys(env.values.discoveryTracks).join(), "material:g20-orphan", "SETUP planted the orphan, and says so");
    assert.match(first.planted.join(" "), /orphan|research track/);
    // a reload of the GM window: the in-memory material and the globals are gone, the saved things are not
    getApi().definitions.material.delete("g20-memory");
    delete globalThis.__g20;
    const again = await runBlock(2, gm);
    assert.equal(again.already, "set up");
    assert.equal(getApi().definitions.material.has("g20-memory"), true, "SETUP puts the in-memory material back");
    assert.equal(Object.keys(env.values.discoveryTracks).length, 1, "and does not plant a second orphan");
    // CLEANUP from the middle (the editor never opened), then again
    getApi().definitions.material.delete("g20-memory");
    delete globalThis.__g20;
    assert.deepEqual((await runBlock(21, gm)).problems, []);
    assert.deepEqual((await runBlock(21, gm)).problems, []);
  });
  assert.deepEqual(clean(), { records: 0, items: 0, folders: 0, overlay: 0 });
  assert.equal(game.actors.getName("Gate G20 Scholar"), undefined);
});
