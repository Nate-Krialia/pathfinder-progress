/**
 * The Stage 11b round gate (docs/18-stage11b-gate.md): every code block is extracted and run, in order, as the right client, in a fake Foundry
 * where the Player and the GM have their OWN api.definitions. The [Player] click steps are played on the REAL Hub window (strict ApplicationV2
 * stand-in, jsdom): the test clicks what the step tells the person to click, then runs the step's check block against what is on the page.
 * What it cannot show: the real window, fonts, focus rings, real PF2e rolls and the real Tab key.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { as, env, getApi, getUsers, makeActor, measure, quietly, snapshot, world } from "./fake-world.js";
import { build } from "../scripts/hub/app.js";
import { installFakeApplication } from "./fake-application.js";
import { chatLeaks } from "./helpers.js";

const gateDoc = readFileSync("docs/18-stage11b-gate.md", "utf8");
const MODULE_VERSION = JSON.parse(readFileSync("module.json", "utf8")).version;
const GATE = new Map();
for (const match of gateDoc.matchAll(/^## Step (\d+) ((?:\[[^\]]+\](?: and )?)+)[^\n]*\n([\s\S]*?)(?=^## Step |^## Group |(?![\s\S]))/gm)) {
  const block = match[3].match(/```js\n([\s\S]*?)```/);
  GATE.set(Number(match[1]), { who: match[2], code: block?.[1] ?? null, text: match[3] });
}
function runBlock(step, user) {
  const entry = GATE.get(step);
  assert.ok(entry?.code, `docs/18-stage11b-gate.md needs a code block in Step ${step}`);
  const code = entry.code.replace(/^(\/\/[^\n]*\n)*\s*await \(/, match => match.replace("await (", "("));
  return as(user, () => (0, eval)(code));
}
const gateWorld = options => world({ downtime: 0, iron: 0, fang: 0, perClientDefinitions: true, ...options });
const wait = ms => new Promise(r => setTimeout(r, ms));

test("the stage 11b gate doc: steps are labelled, click-through steps say what you should see, screenshots are asked for only where layout matters", () => {
  assert.deepEqual([...GATE.keys()], Array.from({ length: 22 }, (_, i) => i + 1));
  for (const [step, entry] of GATE) {
    assert.match(entry.who, /^\[(GM|Player)\]( and \[(GM|Player)\])?\s*$/, `step ${step} says who runs it`);
    assert.ok(entry.code, `step ${step} has a code block`);
    assert.equal((entry.text.match(/```js/g) ?? []).length, 1, `step ${step} has ONE code block`);
    if (/\[Player\]/.test(entry.who) && step > 3) assert.match(entry.text, /What you should see|you should see/i, `click-through step ${step} says what to see`);
  }
  const screenshots = [...GATE].filter(([, e]) => /send me a screenshot/i.test(e.text)).map(([n]) => n);
  assert.deepEqual(screenshots, [4, 16, 21], "screenshots: the Research tab, a Compendium experiment entry, the narrow layout");
  assert.match(gateDoc, /version must be \*\*0\.19\.0\*\*/);
  assert.match(gateDoc, /Force-reload BOTH windows first/);
  assert.match(gateDoc, /game\.user\.name, game\.user\.isGM/);
  assert.match(MODULE_VERSION, /^\d+\.\d+\.\d+$/);
  for (const must of [/Put aside\? Progress is not kept\./, /Keep/, /Confirm/, /Start researching/, /Share with the party/, /Tab/, /175%/, /Open in Research/, /Not shared/]) assert.match(gateDoc, must);
  assert.doesNotMatch(gateDoc, /\bDC \d|odds of|\d+% chance/i, "the gate text itself never talks about difficulty to the player");
});

test("GATE 18: every code step runs, in order, and the click-through steps are played by real clicks on the real window", async () => {
  const w = await gateWorld();
  const api = getApi();
  const { gm, testUser } = getUsers();
  const logged = console.log;
  const expectPass = async (step, user) => {
    const sink = [];
    console.log = (...args) => sink.push(args.map(String).join(" "));
    try { assert.equal(await runBlock(step, user), "ALL PASS", `step ${step} did not report ALL PASS:\n${sink.filter(l => l.startsWith("FAIL")).join("\n")}`); } finally { console.log = logged; }
  };
  installFakeApplication();
  await quietly(async () => {
    assert.deepEqual(await runBlock(1, gm), ["GM", true, MODULE_VERSION]);
    assert.deepEqual(await runBlock(1, testUser), ["Test", false, MODULE_VERSION]);
    const setup = await runBlock(2, gm);
    assert.deepEqual([setup.scholar, setup.friend, setup.testUsersCharacter], ["Gate Scholar", "Gate Friend", "Gate Scholar"]);
    await as(testUser, () => api.definitions.refresh());
    await expectPass(3, testUser);

    const scholar = game.actors.getName("Gate Scholar");
    const Hub = build();
    let app;
    const click = async (action, where = "") => {
      const target = [...app.element.querySelectorAll(`[data-action="${action}"]${where}`)].find(b => b.getAttribute("aria-disabled") !== "true");
      assert.ok(target, `a live ${action}${where} button is on the page`);
      await as(testUser, async () => { target.click(); await wait(20); });
    };
    const read = () => app.element.querySelector(".pfp-main").textContent.replace(/\s+/g, " ");
    const seen = pattern => assert.match(read(), pattern);
    // Step 4: open the Hub and the Research tab
    await as(testUser, async () => { app = new Hub(api, scholar); await app.render({ force: true }); });
    await click("switch-tab", '[data-tab="research"]');
    seen(/Gate Draught[\s\S]*Gate Giant|Gate Giant[\s\S]*Gate Draught/);
    seen(/Leads you could follow/);
    await expectPass(4, testUser);
    // Step 5: queue three checks
    await click("select-project", '[data-project="unlock-g6-draught"]');
    seen(/Finishing teaches you the formula for Gate Draught\./);
    seen(/Crafting[\s\S]*Your modifier [+-]\d+[\s\S]*Nature[\s\S]*Your modifier [+-]\d+/);
    assert.equal(app.element.querySelector('[data-action="queue-research"]').getAttribute("aria-disabled"), "true");
    seen(/Choose a skill to roll with first\./);
    await click("set-skill", '[data-skill="crafting"]');
    await click("days-up"); await click("days-up");
    seen(/3 days \(3 checks\)/);
    await click("queue-research");
    await expectPass(5, testUser);
    // Step 6: the GM resolves, with queued fake rolls (the real one rolls PF2e)
    const roll = (degree, total, natural) => ({ options: { degreeOfSuccess: degree }, total, dice: [{ faces: 20, results: [{ result: natural, active: true }] }] });
    scholar.rolls.push(roll(3, 31, 19), roll(2, 22, 11), roll(1, 9, 4));
    await expectPass(6, gm);
    await wait(40);
    // Step 7: the window followed by itself
    await as(testUser, () => app.redraw());
    await expectPass(7, testUser);
    // Step 8: queue one check and cancel it
    await click("queue-research");
    await click("cancel-queued");
    await expectPass(8, testUser);
    // Step 9: put aside, Keep first, then Confirm
    await click("select-project", '[data-project="unlock-g6-giant"]');
    await click("put-aside");
    assert.equal(document.activeElement?.dataset?.focusKey, "keep-aside", "focus lands on Keep");
    seen(/Put aside\? Progress is not kept\./);
    await click("keep-aside");
    assert.equal(document.activeElement?.dataset?.focusKey, "put-aside", "Keep returns focus to the Put aside button");
    await click("put-aside");
    await click("confirm-aside");
    await expectPass(9, testUser);
    // Step 10: follow the lead
    await click("follow-lead");
    await expectPass(10, testUser);
    // Step 11: Open in Research from the Formulae tab
    await click("switch-tab", '[data-tab="formulae"]');
    await click("open-in-research", '[data-project="unlock-g6-draught"]');
    await expectPass(11, testUser);
    // Steps 12-14: close and reopen downtime
    await expectPass(12, gm);
    await as(testUser, () => app.redraw());
    await expectPass(13, testUser);
    await expectPass(14, gm);
    // Group B: the Compendium
    await click("switch-tab", '[data-tab="compendium"]');
    seen(/Materials 2/);
    await expectPass(15, testUser);
    await click("select-entry", '[data-entry="g6-ore"]');
    seen(/Tier 1[\s\S]*Gate Field[\s\S]*a basic find[\s\S]*a better find/);
    await click("select-entry", '[data-entry="g6-star"]');
    seen(/No places recorded yet\.[\s\S]*You haven't gathered it from a node yet\./);
    await click("set-category", '[data-category="creatures"]');
    await click("select-entry", '[data-entry="gate-wolf"]');
    seen(/Type: beast[\s\S]*Gate Fang/);
    await click("set-category", '[data-category="regions"]');
    await click("select-entry", '[data-entry="g6-field"]');
    seen(/Gate Bush/);
    await click("set-category", '[data-category="experiments"]');
    await click("select-entry", '[data-entry="g6-blade"]');
    await expectPass(16, testUser);
    // Step 17: share two
    await click("set-category", '[data-category="materials"]');
    await click("select-entry", '[data-entry="g6-ore"]');
    await click("share-entry");
    seen(/Waiting for the GM to approve sharing it\./);
    assert.match(app.element.querySelector(".pfp-live").textContent, /^Share queued: Gate Ore\. Waiting for the GM\.$/);
    await click("cancel-queued");
    assert.match(app.element.querySelector(".pfp-live").textContent, /^Share cancelled: Gate Ore\. It stays private\.$/);
    await click("share-entry");
    await click("select-entry", '[data-entry="g6-star"]');
    await click("share-entry");
    await expectPass(17, testUser);
    await expectPass(18, gm);
    await wait(40);
    await as(testUser, () => app.redraw());
    seen(/Shared[\s\S]*Everyone in the party can read this\.|Only you/);
    await expectPass(19, testUser);
    // Group C: keyboard, and the narrow layout. jsdom has no layout engine or stylesheet, so the ring and the geometry are stubbed here; the real values are what the person checks.
    globalThis.getComputedStyle = () => ({ outlineStyle: "solid", outlineWidth: "2px" });
    await as(testUser, () => app.element.querySelector('[data-action="toggle-display"]').focus());
    await expectPass(20, testUser);
    const root = app.element.querySelector(".pfp-hub");
    for (const watched of globalThis.__fakeDom.observers.flatMap(o => [...o.targets])) globalThis.__fakeDom.resize(watched, 300);
    Object.defineProperty(root, "scrollWidth", { value: 300, configurable: true });
    Object.defineProperty(root, "clientWidth", { value: 300, configurable: true });
    const frame = app.element.closest(".application") ?? app.element;
    frame.getBoundingClientRect = () => ({ width: 300 });
    await wait(20);
    await expectPass(21, testUser);
    delete globalThis.getComputedStyle;
    assert.deepEqual(chatLeaks(env.chat), [], "no chat message carries a DC or a roll");
    const cleanup = await runBlock(22, gm);
    assert.deepEqual(cleanup, { problems: [], actorsLeft: 0, downtimeOpen: false, testUsersCharacter: null, sharedLeft: 0, audit: [] });
    await as(testUser, () => app.close());
  });
  for (const name of ["Gate Scholar", "Gate Friend"]) assert.equal(game.actors.getName(name), undefined, name);
  assert.deepEqual(env.values.downtime, {});
  for (const [kind, id] of [["recipe", "g6-blade"], ["recipe", "g6-draught"], ["recipe", "g6-giant"], ["recipe", "g6-lantern"], ["material", "g6-ore"], ["material", "g6-star"], ["town", "g6-town"]]) assert.equal(api.definitions[kind].has(id), false, `${id} is removed`);
  assert.deepEqual(measure(w.ann), { copper: 2000, stash: {}, freeDays: 0, reservedDays: 0, totalDays: 0, items: [] });
  assert.equal(globalThis.__g6, undefined);
  console.log = logged;
  void makeActor; void snapshot;
});

test("GATE 18: SETUP refuses to run against real data, and runs twice; CLEANUP works from the middle and twice", async () => {
  for (const [label, prepare, expected] of [
    ["open downtime", async w => { await getApi().downtime.start({ days: 3, actorIds: [w.ann.id] }); }, /downtime is already open/],
    ["a character holding days", async w => { await getApi().grantDays(w.ann, 2); }, /these characters hold downtime days: Ann/],
    ["a real actor named like a gate one", async () => { game.actors.push(makeActor("Gate Scholar")); }, /already exists and was not made by this check/],
    ["leftover shared entries", async () => { env.values.sharedCompendium = { v: 1, materials: { "g6-ore": { id: "g6-ore", name: "x", tier: 1, firstAt: 1, places: [], rungs: [] } }, creatures: {}, regions: {}, experiments: {} }; }, /an earlier run left shared Compendium entries/]
  ]) {
    const w = await gateWorld();
    await prepare(w);
    const before = snapshot(w);
    await quietly(async () => assert.rejects(Promise.resolve(runBlock(2, getUsers().gm)), expected, label));
    assert.equal(snapshot(w), before, `${label}: nothing changed`);
    delete globalThis.__g6;
  }
  const w = await gateWorld();
  const { gm, testUser } = getUsers();
  await quietly(async () => {
    await runBlock(2, gm);
    assert.equal((await runBlock(2, gm)).already, "set up");
    await as(testUser, () => getApi().definitions.refresh());
    assert.equal(await runBlock(3, testUser), "ALL PASS");
    assert.deepEqual((await runBlock(22, gm)).problems, []);
    assert.deepEqual((await runBlock(22, gm)).problems, []);
  });
  assert.equal(game.actors.getName("Gate Scholar"), undefined);
  assert.deepEqual(measure(w.ann).stash, {});
});
