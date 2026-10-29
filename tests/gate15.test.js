/**
 * The definitions gate (docs/15-stage-defs-gate.md): every code block is extracted and run, in order, as the right client, in a fake
 * Foundry where the Player and the GM have their OWN api.definitions and the Player gets only what the GM sends over the socket.
 * Between a GM step and the next Player step the test fires the hooks Foundry would fire on the Player's client, so the debounced
 * refresh is what delivers the change (the Player steps wait for it exactly as a person would).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { as, env, events, fireHookAs, getApi, getUsers, makeActor, makeRegistry, measure, M, quietly, snapshot, world } from "./fake-world.js";
import { _resetDefsStateForTests } from "../scripts/data/playerState.js";

const gateDoc = readFileSync("docs/15-stage-defs-gate.md", "utf8");
const MODULE_VERSION = JSON.parse(readFileSync("module.json", "utf8")).version;
const GATE = new Map();
for (const match of gateDoc.matchAll(/^## Step (\d+) ((?:\[[^\]]+\](?: and )?)+)[^\n]*\n([\s\S]*?)(?=^## Step |(?![\s\S]))/gm)) {
  const block = match[3].match(/```js\n([\s\S]*?)```/);
  GATE.set(Number(match[1]), { who: match[2], code: block?.[1] ?? null, text: match[3] });
}

function runBlock(step, user) {
  const entry = GATE.get(step);
  assert.ok(entry?.code, `docs/15-stage-defs-gate.md needs a code block in Step ${step}`);
  const code = entry.code.replace(/^(\/\/[^\n]*\n)*\s*await \(/, match => match.replace("await (", "("));
  return as(user, () => (0, eval)(code));
}
const gateWorld = options => world({ downtime: 0, iron: 0, fang: 0, perClientDefinitions: true, ...options });

const WHO = new Map([[1, "both"], [2, "gm"], [3, "player"], [4, "player"], [5, "gm"], [6, "player"], [7, "player"], [8, "player"], [9, "gm"], [10, "player"], [11, "gm"], [12, "player"],
  [13, "gm"], [14, "player"], [15, "gm"], [16, "player"], [17, "player"], [18, "gm"]]);

test("the definitions gate has exactly one code block per step, every step says who runs it, and the doc says what is unit-test only", () => {
  assert.equal(GATE.size, 18);
  for (const [step, { who, code, text }] of GATE) {
    assert.match(who, /^\[(GM|Player)\]( and \[(GM|Player)\])?$/, `step ${step}`);
    assert.ok(code, `step ${step} needs its code block`);
    assert.equal((text.match(/```js/g) ?? []).length, 1, `step ${step} has exactly one code block`);
    const expected = WHO.get(step);
    assert.equal(expected === "both" ? /GM.*Player/.test(who) : who === (expected === "gm" ? "[GM]" : "[Player]"), true, `step ${step} is labelled ${who}`);
  }
  assert.match(gateDoc, /game\.user\.name, game\.user\.isGM/);
  assert.match(gateDoc, /Force-reload BOTH windows first/);
  assert.match(gateDoc, /version must be \*\*0\.16\.0\*\*/);
  assert.match(gateDoc, /Not provable in a live world \(unit tests only/);
  assert.match(gateDoc, /GM isn't connected/);
  assert.equal(MODULE_VERSION, "0.16.0");
});

test("GATE 15: every step runs, in order, as the right client, and reports ALL PASS", async () => {
  const w = await gateWorld();
  const api = getApi();
  const { gm, testUser } = getUsers();
  await quietly(async () => {
    assert.deepEqual(await runBlock(1, gm), ["GM", true, MODULE_VERSION]);
    assert.deepEqual(await runBlock(1, testUser), ["Test", false, MODULE_VERSION]);
    const setup = await runBlock(2, gm);
    assert.deepEqual([setup.weaver, setup.idler, setup.scene, setup.testUsersCharacter], ["Gate Weaver", "Gate Idler", "Gate Meadow", "Gate Weaver"]);
    assert.ok(setup.published.changed);
    const first = await runBlock(3, testUser);
    assert.deepEqual([first.before.recipe, first.before.material, first.before.region, first.loaded, first.status], [0, 0, 0, true, "ready"], "the Player window starts with nothing and loads what it needs");

    const weaver = () => game.actors.getName("Gate Weaver");
    const afterGM = {
      9: () => fireHookAs(testUser, "updateActor", [weaver()], { flags: { [M]: { formulas: [] } } }),
      11: () => fireHookAs(testUser, "updateActor", [weaver()], { flags: { [M]: { formulas: [] } } }),
      13: () => fireHookAs(testUser, "updateActor", [weaver()], { flags: { [M]: { formulas: [] } } }),
      15: () => fireHookAs(testUser, "updateSetting", [{ key: `${M}.definitionsRevision` }])
    };
    const run = async (step, user) => {
      const lines = [];
      const saved = console.log;
      console.log = (...args) => lines.push(args.map(String).join(" "));
      try { assert.equal(await runBlock(step, user), "ALL PASS", `step ${step} did not report ALL PASS:\n${lines.join("\n").split("\n").filter(l => l.startsWith("FAIL")).join("\n")}`); } finally { console.log = saved; }
      await afterGM[step]?.();
    };
    for (let step = 4; step <= 17; step++) {
      if (step === 8) { api.definitions = makeRegistry(); delete globalThis.__g3; await runBlock(2, gm); }   // a GM window reload midway: SETUP rebuilds the helper and re-registers the fakes
      await run(step, WHO.get(step) === "gm" ? gm : testUser);
    }
    const cleanup = await runBlock(18, gm);
    assert.deepEqual(cleanup, { problems: [], actorsLeft: 0, sceneLeft: false, downtimeOpen: false, testUsersCharacter: null, audit: [] });
  });
  assert.equal(game.scenes.getName("Gate Meadow"), undefined);
  for (const name of ["Gate Weaver", "Gate Idler"]) assert.equal(game.actors.getName(name), undefined, name);
  assert.equal(env.values.partyLocation, "oakhaven", "the party location is put back");
  assert.deepEqual(env.values.downtime, {});
  for (const [kind, id] of [["blueprint", "g3-hut"], ["recipe", "g3-loom-blade"], ["recipe", "g3-secret-blade"], ["region", "g3-meadow"], ["region", "g3-cave"], ["nodeType", "g3-bush"], ["station", "g3-loom"], ["material", "g3-thread"], ["material", "g3-silk"], ["town", "g3-town"]]) {
    assert.equal(api.definitions[kind].has(id), false, `${id} is removed from the GM registry`);
  }
  assert.ok(!events().some(t => /Gate /.test(t)), "the world events that name the gate things are gone");
  assert.deepEqual(measure(w.ann), { copper: 2000, stash: {}, freeDays: 0, reservedDays: 0, totalDays: 0, items: [] });
  assert.equal(globalThis.__g3, undefined);
  delete globalThis.__p3;
});

test("GATE 15: SETUP refuses to run against real data, changing nothing", async () => {
  for (const [label, prepare, expected] of [
    ["open downtime", async w => { await getApi().downtime.start({ days: 3, actorIds: [w.ann.id] }); }, /downtime is already open/],
    ["a character holding days", async w => { await getApi().grantDays(w.ann, 2); }, /these characters hold downtime days: Ann/],
    ["a real actor named like a gate one", async () => { game.actors.push(makeActor("Gate Weaver")); }, /already exists and was not made by this check/]
  ]) {
    const w = await gateWorld();
    await prepare(w);
    const before = snapshot(w);
    await quietly(async () => assert.rejects(Promise.resolve(runBlock(2, getUsers().gm)), expected, label));
    assert.equal(snapshot(w), before, `${label}: nothing changed`);
    delete globalThis.__g3;
  }
});

test("GATE 15: SETUP can be run twice, and CLEANUP works from the middle of the gate and twice in a row", async () => {
  const w = await gateWorld();
  const { gm, testUser } = getUsers();
  await quietly(async () => {
    await runBlock(2, gm);
    assert.equal((await runBlock(2, gm)).already, "set up");
    await runBlock(3, testUser);
    assert.equal(await runBlock(8, testUser), "ALL PASS");
    const cleanup = await runBlock(18, gm);
    assert.deepEqual(cleanup.problems, []);
    assert.deepEqual((await runBlock(18, gm)).problems, []);
  });
  assert.equal(game.actors.getName("Gate Weaver"), undefined);
  assert.deepEqual(measure(w.ann).stash, {});
  _resetDefsStateForTests();
});
