/**
 * The Stage 10d gate (docs/16-stage10d-gate.md): every code block is extracted and run, in order, as the right client, in a fake Foundry
 * where the Player and the GM have their OWN api.definitions. Between a GM step and the next Player step the test fires the hooks Foundry
 * would fire on the Player's client, so the debounced refresh is what delivers the change.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { as, env, events, fireHookAs, getApi, getUsers, makeActor, makeRegistry, measure, M, quietly, snapshot, world } from "./fake-world.js";

const gateDoc = readFileSync("docs/16-stage10d-gate.md", "utf8");
const MODULE_VERSION = JSON.parse(readFileSync("module.json", "utf8")).version;
const GATE = new Map();
for (const match of gateDoc.matchAll(/^## Step (\d+) ((?:\[[^\]]+\](?: and )?)+)[^\n]*\n([\s\S]*?)(?=^## Step |(?![\s\S]))/gm)) {
  const block = match[3].match(/```js\n([\s\S]*?)```/);
  GATE.set(Number(match[1]), { who: match[2], code: block?.[1] ?? null, text: match[3] });
}
function runBlock(step, user) {
  const entry = GATE.get(step);
  assert.ok(entry?.code, `docs/16-stage10d-gate.md needs a code block in Step ${step}`);
  const code = entry.code.replace(/^(\/\/[^\n]*\n)*\s*await \(/, match => match.replace("await (", "("));
  return as(user, () => (0, eval)(code));
}
const gateWorld = options => world({ downtime: 0, iron: 0, fang: 0, perClientDefinitions: true, ...options });
const WHO = new Map([[1, "both"], [2, "gm"], [3, "player"], [4, "player"], [5, "gm"], [6, "player"], [7, "gm"], [8, "player"], [9, "player"], [10, "player"], [11, "gm"], [12, "player"],
  [13, "gm"], [14, "player"], [15, "player"], [16, "player"], [17, "gm"], [18, "player"], [19, "gm"], [20, "player"], [21, "gm"], [22, "gm"]]);
const roll = (degree, total, natural) => ({ options: { degreeOfSuccess: degree }, total, dice: [{ faces: 20, results: [{ result: natural, active: true }] }] });

test("the stage 10d gate has exactly one code block per step, every step says who runs it, and step 1 asks for 0.17.0", () => {
  assert.equal(GATE.size, 22);
  for (const [step, { who, code, text }] of GATE) {
    assert.match(who, /^\[(GM|Player)\]( and \[(GM|Player)\])?$/, `step ${step}`);
    assert.ok(code, `step ${step} needs its code block`);
    assert.equal((text.match(/```js/g) ?? []).length, 1, `step ${step} has exactly one code block`);
    const expected = WHO.get(step);
    assert.equal(expected === "both" ? /GM.*Player/.test(who) : who === (expected === "gm" ? "[GM]" : "[Player]"), true, `step ${step} is labelled ${who}`);
  }
  assert.match(gateDoc, /game\.user\.name, game\.user\.isGM/);
  assert.match(gateDoc, /Force-reload BOTH windows first/);
  assert.match(gateDoc, /version must be \*\*0\.17\.0\*\*/);
  assert.equal(MODULE_VERSION, "0.17.0");
});

test("GATE 16: every step runs, in order, as the right client, and reports ALL PASS", async () => {
  const w = await gateWorld();
  const api = getApi();
  const { gm, testUser } = getUsers();
  await quietly(async () => {
    assert.deepEqual(await runBlock(1, gm), ["GM", true, MODULE_VERSION]);
    assert.deepEqual(await runBlock(1, testUser), ["Test", false, MODULE_VERSION]);
    const setup = await runBlock(2, gm);
    assert.deepEqual([setup.smith, setup.friend, setup.scene, setup.testUsersCharacter], ["Gate Smith", "Gate Friend", "Gate Forge", "Gate Smith"]);
    const first = await runBlock(3, testUser);
    assert.deepEqual([first.loaded, first.status], [true, "ready"]);

    const actor = name => game.actors.getName(name);
    const afterGM = {
      17: () => fireHookAs(testUser, "updateActor", [actor("Gate Friend")], { flags: { [M]: { formulas: [] } } })
    };
    const run = async (step, user) => {
      // In real Foundry a player client refreshes itself a moment after the hooks fire; a person takes longer than that between steps.
      if (!user.isGM && globalThis.__p4) await as(user, () => api.definitions.refresh());
      if (step === 7) actor("Gate Smith").rolls.push(roll(2, 22, 12));
      const lines = [];
      const saved = console.log;
      console.log = (...args) => lines.push(args.map(String).join(" "));
      try { assert.equal(await runBlock(step, user), "ALL PASS", `step ${step} did not report ALL PASS:\n${lines.join("\n").split("\n").filter(l => l.startsWith("FAIL")).join("\n")}`); } finally { console.log = saved; }
      await afterGM[step]?.();
    };
    for (let step = 4; step <= 21; step++) {
      if (step === 9) { api.definitions = makeRegistry(); delete globalThis.__g4; await runBlock(2, gm); }   // a GM window reload midway: SETUP rebuilds the helper and re-registers the fakes
      await run(step, WHO.get(step) === "gm" ? gm : testUser);
    }
    const cleanup = await runBlock(22, gm);
    assert.deepEqual(cleanup, { problems: [], actorsLeft: 0, sceneLeft: false, downtimeOpen: false, testUsersCharacter: null, sharedLeft: 0, audit: [] });
  });
  assert.equal(game.scenes.getName("Gate Forge"), undefined);
  for (const name of ["Gate Smith", "Gate Friend"]) assert.equal(game.actors.getName(name), undefined, name);
  assert.equal(env.values.partyLocation, "oakhaven", "the party location is put back");
  assert.deepEqual(env.values.downtime, {});
  assert.deepEqual(Object.keys(env.values.sharedCompendium?.experiments ?? {}), [], "the shared entries are removed");
  for (const [kind, id] of [["recipe", "g4-blade"], ["recipe", "g4-axe"], ["region", "g4-field"], ["nodeType", "g4-bush"], ["station", "g4-bench"], ["material", "g4-ore"], ["material", "g4-steel"], ["material", "g4-ember"], ["material", "g4-star"], ["town", "g4-town"]]) {
    assert.equal(api.definitions[kind].has(id), false, `${id} is removed`);
  }
  assert.ok(!events().some(t => /Gate /.test(t)), "the world events that name the gate things are gone");
  assert.deepEqual(measure(w.ann), { copper: 2000, stash: {}, freeDays: 0, reservedDays: 0, totalDays: 0, items: [] });
  assert.equal(globalThis.__g4, undefined);
  delete globalThis.__p4;
});

test("GATE 16: SETUP refuses to run against real data, changing nothing", async () => {
  for (const [label, prepare, expected] of [
    ["open downtime", async w => { await getApi().downtime.start({ days: 3, actorIds: [w.ann.id] }); }, /downtime is already open/],
    ["a character holding days", async w => { await getApi().grantDays(w.ann, 2); }, /these characters hold downtime days: Ann/],
    ["a real actor named like a gate one", async () => { game.actors.push(makeActor("Gate Smith")); }, /already exists and was not made by this check/],
    ["leftover shared entries", async () => { env.values.sharedCompendium = { v: 1, materials: {}, creatures: {}, regions: {}, experiments: { "g4-blade": { recipeId: "g4-blade", name: "x", firstAt: 1, slots: {} } } }; }, /an earlier run left shared Compendium entries/]
  ]) {
    const w = await gateWorld();
    await prepare(w);
    const before = snapshot(w);
    await quietly(async () => assert.rejects(Promise.resolve(runBlock(2, getUsers().gm)), expected, label));
    assert.equal(snapshot(w), before, `${label}: nothing changed`);
    delete globalThis.__g4;
  }
});

test("GATE 16: SETUP can be run twice, and CLEANUP works from the middle of the gate and twice in a row", async () => {
  const w = await gateWorld();
  const { gm, testUser } = getUsers();
  await quietly(async () => {
    await runBlock(2, gm);
    assert.equal((await runBlock(2, gm)).already, "set up");
    await runBlock(3, testUser);
    assert.equal(await runBlock(4, testUser), "ALL PASS");
    const cleanup = await runBlock(22, gm);
    assert.deepEqual(cleanup.problems, []);
    assert.deepEqual((await runBlock(22, gm)).problems, []);
  });
  assert.equal(game.actors.getName("Gate Smith"), undefined);
  assert.deepEqual(measure(w.ann).stash, {});
});
