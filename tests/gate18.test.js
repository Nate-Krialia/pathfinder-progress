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
import { HUB } from "../scripts/config.js";
import { installFakeApplication } from "./fake-application.js";
import script from "../e2e/steps/gate18.steps.mjs";
import { makeDomDriver, playStep } from "../e2e/driver-dom.mjs";
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
const whoOf = step => (GATE.get(step).who.includes("[Player]") && !GATE.get(step).who.includes("[GM]") ? "player" : "gm");

test("the stage 11b gate doc: steps are labelled, click-through steps say what you should see, screenshots are asked for only where layout matters", () => {
  assert.deepEqual([...GATE.keys()], Array.from({ length: 25 }, (_, i) => i + 1));
  for (const [step, entry] of GATE) {
    assert.match(entry.who, /^\[(GM|Player)\]( and \[(GM|Player)\])?\s*$/, `step ${step} says who runs it`);
    assert.equal(entry.code !== null, step !== 21, `step ${step} code block (only the GM's click-through in the queue window has none)`);
    if (entry.code) assert.equal((entry.text.match(/```js/g) ?? []).length, 1, `step ${step} has ONE code block`);
    if ((/\[Player\]/.test(entry.who) && step > 3) || step === 21) assert.match(entry.text, /What you should see|you should see/i, `click-through step ${step} says what to see`);
  }
  const screenshots = [...GATE].filter(([, e]) => /send me a screenshot/i.test(e.text)).map(([n]) => n);
  assert.deepEqual(screenshots, [4, 16, 24], "screenshots: the Research tab, a Compendium experiment entry, the narrow layout");
  assert.match(gateDoc, /version must be \*\*\d+\.\d+\.\d+\*\*/);
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
    try { assert.equal(await runBlock(step, user), "ALL PASS", `step ${step} did not report ALL PASS:\n${sink.join("\n").split("\n").filter(l => l.startsWith("FAIL")).join("\n")}`); } finally { console.log = logged; }
  };
  installFakeApplication();
  const base = {
    drivers: { gm: makeDomDriver({ as, user: gm }), player: makeDomDriver({ as, user: testUser }) }, state: {}, assert, wait,
    extras: {
      scriptRolls: async (name, specs) => { for (const [degree, total, natural] of specs) game.actors.getName(name).rolls.push({ options: { degreeOfSuccess: degree }, total, dice: [{ faces: 20, results: [{ result: natural, active: true }] }] }); },
      statusMs: async ms => { HUB.statusMs = ms; },
      clearChat: async () => { env.chat.length = 0; },
      resize: async width => {          // jsdom has no layout engine or stylesheet, so the geometry is stubbed here; the real values (and the focus ring) are what the person checks
        const app = foundry.applications.instances.get("pathfinder-progress-hub");
        const root = app.element.querySelector(".pfp-hub");
        for (const watched of globalThis.__fakeDom.observers.flatMap(o => [...o.targets])) globalThis.__fakeDom.resize(watched, width);
        Object.defineProperty(root, "scrollWidth", { value: width, configurable: true });
        Object.defineProperty(root, "clientWidth", { value: width, configurable: true });
        (app.element.closest(".application") ?? app.element).getBoundingClientRect = () => ({ width });
        await wait(20);
      }
    }
  };
  const play = n => playStep({ script, n, who: whoOf(n), base, runBlock: (step, who) => (GATE.get(step).code ? expectPass(step, who === "player" ? testUser : gm) : undefined) });
  await quietly(async () => {
    assert.deepEqual(await runBlock(1, gm), ["GM", true, MODULE_VERSION]);
    assert.deepEqual(await runBlock(1, testUser), ["Test", false, MODULE_VERSION]);
    const setup = await runBlock(2, gm);
    assert.deepEqual([setup.scholar, setup.friend, setup.testUsersCharacter], ["Gate Scholar", "Gate Friend", "Gate Scholar"]);
    const scholar = game.actors.getName("Gate Scholar");
    // Steps 3 to 24, each with its before/after clicks from the SHARED click script (e2e/steps/gate18.steps.mjs); Step 21 is the GM's click in the queue window and has no block
    for (let n = 3; n <= 24; n++) await play(n);
    assert.deepEqual(chatLeaks(env.chat), [], "no chat message carries a DC or a roll");
    // the recorder survives the Hub being closed and opened again, and a re-run of the helper replaces it
    const hub = () => foundry.applications.instances.get("pathfinder-progress-hub");
    assert.ok(globalThis.__p6.said(/^Research started: Gate Lantern\.$/), "the recorder kept the earlier lines");
    await as(testUser, () => hub().close());
    await as(testUser, async () => { api.hub.open(scholar); await wait(30); });
    const probe = Object.assign(document.createElement("div"), { className: "pfp-live", textContent: "after reopen" });
    document.body.append(probe);
    await wait(30);
    assert.ok(globalThis.__p6.said(/^after reopen$/), "and it still records after the reopen");
    probe.remove();
    const recorder = globalThis.__p6rec;
    await expectPass(3, testUser);
    assert.notEqual(globalThis.__p6rec, recorder, "re-running the helper installs a new recorder");
    assert.equal(globalThis.__p6.said(/Research started/), false, "which starts empty");
    const cleanup = await runBlock(25, gm);
    assert.deepEqual(cleanup, { problems: [], actorsLeft: 0, downtimeOpen: false, testUsersCharacter: null, sharedLeft: 0, audit: [] });
    await as(testUser, () => hub().close());
    globalThis.__p6rec?.observer.disconnect();
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
    { const lines = []; const saved = console.log; console.log = (...a) => lines.push(a.join(" ")); try { assert.equal(await runBlock(3, testUser), "ALL PASS", lines.join("\n")); } finally { console.log = saved; } }
    assert.deepEqual((await runBlock(25, gm)).problems, []);
    assert.deepEqual((await runBlock(25, gm)).problems, []);
  });
  assert.equal(game.actors.getName("Gate Scholar"), undefined);
  assert.deepEqual(measure(w.ann).stash, {});
});
