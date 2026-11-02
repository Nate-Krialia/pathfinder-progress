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
import { installFakeApplication } from "./fake-application.js";
import script from "../e2e/steps/gate19.steps.mjs";
import { makeDomDriver, playStep } from "../e2e/driver-dom.mjs";
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
const whoOf = step => (GATE.get(step).who.includes("[Player]") && !GATE.get(step).who.includes("[GM]") ? "player" : "gm");
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
  assert.deepEqual(screenshots, [4, 7, 14], "screenshots: the Research tab, the Gate Blade formula, the narrow layout");
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
  const base = {
    drivers: { gm: makeDomDriver({ as, user: gm }), player: makeDomDriver({ as, user: testUser }) }, state: {}, assert, wait,
    extras: {
      scriptRolls: async (name, specs) => { for (const [degree, total, natural] of specs) game.actors.getName(name).rolls.push({ options: { degreeOfSuccess: degree }, total, dice: [{ faces: 20, results: [{ result: natural, active: true }] }] }); },
      noGm: async on => { env.noGM = on; },
      resize: async width => {          // jsdom has no layout engine, so the geometry is stubbed; the real values are what the person checks
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
    // Steps 3 to 16 with their clicks from the SHARED click script (e2e/steps/gate19.steps.mjs); Step 15 (the GM goes away) has no block
    for (let n = 3; n <= 16; n++) await play(n);
    assert.deepEqual(chatLeaks(env.chat), [], "no chat message carries a DC or a roll");
    const cleanup = await runBlock(17, gm);
    assert.deepEqual(cleanup, { problems: [], actorsLeft: 0, downtimeOpen: false, testUsersCharacter: null, tracksLeft: 0, audit: [] });
    await as(testUser, () => foundry.applications.instances.get("pathfinder-progress-hub")?.close());
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
    if (label === "leftover tracks") {
      // MUST-DO: after a GM reload the fake definitions are gone but the tracks stay; CLEANUP still clears them (an orphaned key has no item to look up).
      assert.equal(Object.keys(env.values.discoveryTracks).length, 1);
      assert.deepEqual((await quietly(() => runBlock(17, getUsers().gm))).problems, [], "CLEANUP copes with a track whose item is gone");
      assert.deepEqual(env.values.discoveryTracks, {}, "the orphaned track is cleared");
    }
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
