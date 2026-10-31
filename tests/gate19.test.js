/**
 * The Stage 11c gate (docs/19-stage11c-gate.md): every code block is extracted and run, in order, as the right client, in a fake Foundry where the Player and the GM
 * have their OWN api.definitions. The [Player] click steps are played on the REAL Hub window (strict ApplicationV2 stand-in, jsdom): the test clicks what the step tells
 * the person to click, then runs the step's check block against what is on the page. What it cannot show: the real window, fonts, focus rings, real PF2e rolls, the real
 * Tab key, and a GM that is connected but never answers (tests/hub-discovery.test.js covers that with a fake that never replies).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { as, env, getApi, getUsers, makeActor, measure, quietly, snapshot, world } from "./fake-world.js";
import { build } from "../scripts/hub/app.js";
import { build as buildEditor } from "../scripts/discovery/editor-app.js";
import { installFakeApplication } from "./fake-application.js";
import { chatLeaks } from "./helpers.js";

const gateDoc = readFileSync("docs/19-stage11c-gate.md", "utf8");
const MODULE_VERSION = JSON.parse(readFileSync("module.json", "utf8")).version;
const GATE = new Map();
for (const match of gateDoc.matchAll(/^## Step (\d+) ((?:\[[^\]]+\](?: and )?)+)[^\n]*\n([\s\S]*?)(?=^## Step |^## Group |(?![\s\S]))/gm)) {
  const block = match[3].match(/```js\n([\s\S]*?)```/);
  GATE.set(Number(match[1]), { who: match[2], code: block?.[1] ?? null, text: match[3] });
}
function runBlock(step, user) {
  const entry = GATE.get(step);
  assert.ok(entry?.code, `docs/19-stage11c-gate.md needs a code block in Step ${step}`);
  const code = entry.code.replace(/^(\/\/[^\n]*\n)*\s*await \(/, match => match.replace("await (", "("));
  return as(user, () => (0, eval)(code));
}
const gateWorld = options => world({ downtime: 0, iron: 0, fang: 0, perClientDefinitions: true, ...options });
const wait = ms => new Promise(r => setTimeout(r, ms));
const roll = (degree, total = 25, natural = 15) => ({ options: { degreeOfSuccess: degree }, total, dice: [{ faces: 20, results: [{ result: natural, active: true }] }] });

test("the stage 11c gate doc: steps are labelled, click-through steps say what you should see, screenshots are asked for only where layout matters", () => {
  assert.deepEqual([...GATE.keys()], Array.from({ length: 17 }, (_, i) => i + 1));
  for (const [step, entry] of GATE) {
    assert.match(entry.who, /^\[(GM|Player)\]( and \[(GM|Player)\])?\s*$/, `step ${step} says who runs it`);
    assert.equal(entry.code !== null, step !== 15, `step ${step} code block (only "log the GM out" has none)`);
    if (entry.code) assert.equal((entry.text.match(/```js/g) ?? []).length, 1, `step ${step} has ONE code block`);
    if (/\[Player\]/.test(entry.who) && step > 3) assert.match(entry.text, /What you should see|What to do|you should see/i, `click-through step ${step} says what to see`);
  }
  const screenshots = [...GATE].filter(([, e]) => /send me a screenshot/i.test(e.text)).map(([n]) => n);
  assert.deepEqual(screenshots, [4, 7, 12, 14], "screenshots: the Research tab, the Gate Blade formula, the editor, the narrow layout");
  assert.match(gateDoc, /version must be \*\*\d+\.\d+\.\d+\*\*/);
  assert.match(gateDoc, /Force-reload BOTH windows first/);
  assert.match(MODULE_VERSION, /^\d+\.\d+\.\d+$/);
  for (const must of [/Getting somewhere/, /Just started/, /Nearly there|Getting somewhere/, /Your progress is kept/, /Materials are worth about/, /You save about/, /Not open to you yet/, /Couldn't share this/, /Couldn't start researching/, /Couldn't put this aside/, /Discovery tracks/, /Gate Blade II/]) assert.match(gateDoc, must);
  assert.doesNotMatch(gateDoc.replace(/DC\b[^\n]*never/gi, ""), /\bDC \d|odds of|\d+% chance/i, "the gate text itself never talks about difficulty to the player");
});

test("GATE 19: every code step runs, in order, and the click-through steps are played by real clicks on the real window", async () => {
  const w = await gateWorld();
  const api = getApi();
  const { gm, testUser } = getUsers();
  const logged = console.log;
  const expectPass = async (step, user) => {
    const sink = [];
    console.log = (...args) => sink.push(args.map(String).join(" "));
    try { assert.equal(await runBlock(step, user), "ALL PASS", `step ${step} did not report ALL PASS:\n${sink.join("\n").split("\n").filter(l => l.startsWith("FAIL")).join("\n")}`); } finally { console.log = logged; }
  };
  installFakeApplication();
  await quietly(async () => {
    assert.deepEqual(await runBlock(1, gm), ["GM", true, MODULE_VERSION]);
    assert.deepEqual(await runBlock(1, testUser), ["Test", false, MODULE_VERSION]);
    const setup = await runBlock(2, gm);
    assert.deepEqual([setup.scholar, setup.friend, setup.testUsersCharacter], ["Gate Scholar", "Gate Friend", "Gate Scholar"]);
    const scholar = game.actors.getName("Gate Scholar");
    const refresh = () => as(testUser, () => api.definitions.refresh({ force: true }));
    await refresh();
    await expectPass(3, testUser);

    const Hub = build();
    let app;
    const click = async (action, where = "") => {
      const target = [...app.element.querySelectorAll(`[data-action="${action}"]${where}`)].find(b => b.getAttribute("aria-disabled") !== "true");
      assert.ok(target, `a live ${action}${where} button is on the page`);
      await as(testUser, async () => { target.click(); await wait(25); });
    };
    const text = () => app.element.querySelector(".pfp-main").textContent.replace(/\s+/g, " ");
    const seen = pattern => assert.match(text(), pattern);
    const redraw = async () => { await refresh(); await as(testUser, () => app.redraw()); };

    // Step 4: open the Hub on the Research tab
    await as(testUser, async () => { app = new Hub(api, scholar); await app.render({ force: true }); });
    await click("switch-tab", '[data-tab="research"]');
    await expectPass(4, testUser);
    // Step 5: follow Gate Ore B and queue two checks
    await click("follow-lead", '[data-lead="item:material:g7-b"]');
    seen(/Studying this can teach you what it is good for, and perhaps more\./);
    await click("set-skill", '[data-skill="crafting"]');
    await click("days-up");
    seen(/2 days \(2 checks\)/);
    await click("queue-research");
    await expectPass(5, testUser);
    // Step 6: the GM resolves (scripted rolls), then tops up
    scholar.rolls.push(roll(3), roll(2));
    await expectPass(6, gm);
    await redraw();
    // Step 7: Compendium, then Formulae
    await click("switch-tab", '[data-tab="compendium"]');
    await click("select-entry", '[data-entry="g7-b"]');
    seen(/What you know[\s\S]*Gate ore: a theme of cowardice\.[\s\S]*It works with frightened\./);
    await click("select-entry", '[data-entry="g7-a"]');
    seen(/What you know[\s\S]*You haven't studied this yet\./);
    assert.doesNotMatch(text(), /cowardice/, "no theme before the study");
    await click("switch-tab", '[data-tab="formulae"]');
    await click("select-recipe", '[data-recipe="g7-blade"]');
    await click("pick-material", '[data-slot="body"][data-material="g7-plain"]');
    await expectPass(7, testUser);
    // Steps 8-10: Gate Ore A finishes; the higher version is a lead; follow it; the GM finishes it
    await expectPass(8, gm);
    await redraw();
    await click("switch-tab", '[data-tab="research"]');
    const versionLead = scholar.getFlag("pathfinder-progress", "leads").find(l => l.recipeId === "g7-blade2").id;
    seen(/Gate Blade II[\s\S]*What you have learned about Gate ore materials shows how to make a better version\./);
    await click("follow-lead", `[data-lead="${versionLead}"]`);
    await expectPass(9, testUser);
    await expectPass(10, gm);
    await redraw();
    // Step 11: Put aside keeps a study's progress
    await click("select-project", '[data-project="study:note:g7-page"]');
    await click("put-aside");
    assert.equal(document.activeElement?.dataset?.focusKey, "keep-aside", "focus lands on Keep");
    seen(/Put aside\? Your progress is kept\./);
    await click("confirm-aside");
    await wait(30);
    seen(/Gate Page[\s\S]*You've started studying Gate Page\. Pick it up again whenever you like\.[\s\S]*Pick the study up again/);
    await click("follow-lead", '[data-lead="item:note:g7-page"]');
    seen(/Study: Gate Page[\s\S]*Getting somewhere/);
    await expectPass(11, testUser);
    // Step 12: the Discovery tracks window (GM), played on the strict fake
    const Editor = buildEditor();
    const editor = new Editor(api, "material:g7-plain");
    await as(gm, () => editor.render({ force: true }));
    const eclick = async (action, where = "") => { const t = [...editor.element.querySelectorAll(`[data-action="${action}"]${where}`)].find(b => b.getAttribute("aria-disabled") !== "true"); assert.ok(t, `${action} is live`); await as(gm, async () => { t.click(); await wait(15); }); };
    const etype = async (field, index, value) => { const input = editor.element.querySelector(`[data-field="${field}"][data-index="${index}"]`); input.value = value; await as(gm, async () => { input.dispatchEvent(new window.Event("change", { bubbles: true })); await wait(15); }); };
    const etext = () => editor.element.textContent.replace(/\s+/g, " ");
    assert.match(etext(), /Gate Plain[\s\S]*No track yet/);
    await eclick("add-default");
    assert.match(etext(), /Pick a formula that exists\./);
    assert.equal(editor.element.querySelector('[data-action="save-track"]').getAttribute("aria-disabled"), "true");
    await etype("recipe", 1, "g7-trinket");
    await etype("steps", 1, "4");
    assert.match(etext(), /must be more than the milestone before it \(4\)/);
    await etype("steps", 1, "10");
    await eclick("save-track");
    assert.match(etext(), /Saved the track for Gate Plain\./);
    await eclick("use-definition");
    assert.match(etext(), /now uses the definition's track/);
    await as(gm, () => editor.close());
    await expectPass(12, gm);
    await redraw();
    await expectPass(13, testUser);
    // Step 14: keyboard and a narrow window (jsdom has no layout engine: the geometry is stubbed here; the real values are what the person checks)
    await as(testUser, () => app.element.querySelector('[data-action="toggle-display"]').focus());
    const root = app.element.querySelector(".pfp-hub");
    for (const watched of globalThis.__fakeDom.observers.flatMap(o => [...o.targets])) globalThis.__fakeDom.resize(watched, 300);
    Object.defineProperty(root, "scrollWidth", { value: 300, configurable: true });
    Object.defineProperty(root, "clientWidth", { value: 300, configurable: true });
    (app.element.closest(".application") ?? app.element).getBoundingClientRect = () => ({ width: 300 });
    await wait(20);
    await expectPass(14, testUser);
    // Steps 15-16: no GM connected
    await click("switch-tab", '[data-tab="research"]');
    await click("follow-lead", '[data-lead="item:note:g7-letter"]');          // Step 15: while the GM is still connected
    env.noGM = true;
    await click("switch-tab", '[data-tab="compendium"]');
    await click("select-entry", '[data-entry="g7-plain"]');
    await click("share-entry");
    await click("switch-tab", '[data-tab="research"]');
    await click("follow-lead", '[data-lead="item:material:g7-plain"]');       // Gate Plain has a track since Step 12
    await click("select-project", '[data-project="study:note:g7-letter"]');
    await click("put-aside");
    await click("confirm-aside");
    await click("set-skill", '[data-skill="crafting"]');
    await click("queue-research");
    await expectPass(16, testUser);
    env.noGM = false;
    // Step 17: CLEANUP
    assert.deepEqual(chatLeaks(env.chat), [], "no chat message carries a DC or a roll");
    const cleanup = await runBlock(17, gm);
    assert.deepEqual(cleanup, { problems: [], actorsLeft: 0, downtimeOpen: false, testUsersCharacter: null, tracksLeft: 0, audit: [] });
    await as(testUser, () => app.close());
    globalThis.__p7rec?.observer.disconnect();
  });
  for (const name of ["Gate Scholar", "Gate Friend"]) assert.equal(game.actors.getName(name), undefined, name);
  assert.deepEqual(env.values.downtime, {});
  assert.deepEqual(env.values.discoveryTracks ?? {}, {});
  for (const [kind, id] of [["recipe", "g7-blade"], ["recipe", "g7-blade2"], ["material", "g7-a"], ["tag", "g7-ore"], ["note", "g7-page"], ["town", "g7-town"]]) assert.equal(api.definitions[kind].has(id), false, `${id} is removed`);
  assert.deepEqual(measure(w.ann), { copper: 2000, stash: {}, freeDays: 0, reservedDays: 0, totalDays: 0, items: [] });
  assert.equal(globalThis.__g7, undefined);
  console.log = logged;
  void makeActor; void snapshot;
});

test("GATE 19: SETUP refuses to run against real data, and runs twice; CLEANUP works from the middle and twice", async () => {
  for (const [label, prepare, expected] of [
    ["open downtime", async w => { await getApi().downtime.start({ days: 3, actorIds: [w.ann.id] }); }, /downtime is already open/],
    ["a character holding days", async w => { await getApi().grantDays(w.ann, 2); }, /these characters hold downtime days: Ann/],
    ["a real actor named like a gate one", async () => { game.actors.push(makeActor("Gate Scholar")); }, /already exists and was not made by this check/],
    ["leftover tracks", async () => { env.values.discoveryTracks = { "material:g7-a": { milestones: [{ steps: 2, grants: { type: "properties" } }] } }; }, /an earlier run left tracks/]
  ]) {
    const w = await gateWorld();
    await prepare(w);
    const before = snapshot(w);
    await quietly(async () => assert.rejects(Promise.resolve(runBlock(2, getUsers().gm)), expected, label));
    assert.equal(snapshot(w), before, `${label}: nothing changed`);
    delete globalThis.__g7;
  }
  const w = await gateWorld();
  const { gm, testUser } = getUsers();
  await quietly(async () => {
    await runBlock(2, gm);
    assert.equal((await runBlock(2, gm)).already, "set up");
    await as(testUser, () => getApi().definitions.refresh({ force: true }));
    const lines = [];
    const saved = console.log;
    console.log = (...a) => lines.push(a.join(" "));
    try { assert.equal(await runBlock(3, testUser), "ALL PASS", lines.join("\n")); } finally { console.log = saved; }
    assert.deepEqual((await runBlock(17, gm)).problems, []);
    assert.deepEqual((await runBlock(17, gm)).problems, []);
  });
  assert.equal(game.actors.getName("Gate Scholar"), undefined);
  assert.deepEqual(measure(w.ann).stash, {});
  globalThis.__p7rec?.observer.disconnect();
});
