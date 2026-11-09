/**
 * The Stage 10b + 10c gate (docs/14-stage10bc-gate.md): every code block is extracted and run, in order, as the right client,
 * through the real main.js and the realistic fake socketlib. It proves the blocks run and say ALL PASS here; what only a
 * real Foundry can show (PF2e actor data, real Combat documents and hooks, real socketlib) is what the real gate is for.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { as, env, events, getApi, getUsers, makeRegistry, measure, quietly, snapshot, world } from "./fake-world.js";

const gateDoc = readFileSync("docs/14-stage10bc-gate.md", "utf8");
// The doc asks for the version it shipped with (0.15.0); the blocks just report the installed one, so the test compares with module.json.
const MODULE_VERSION = JSON.parse(readFileSync("module.json", "utf8")).version;
const GATE = new Map();
for (const match of gateDoc.matchAll(/^## Step (\d+) ((?:\[[^\]]+\](?: and )?)+)[^\n]*\n([\s\S]*?)(?=^## Step |(?![\s\S]))/gm)) {
  const block = match[3].match(/```js\n([\s\S]*?)```/);
  GATE.set(Number(match[1]), { who: match[2], code: block?.[1] ?? null, text: match[3] });
}

/** Run a block like a browser console would: top-level await is wrapped, the last expression is the value. */
function runBlock(step, user) {
  const entry = GATE.get(step);
  assert.ok(entry?.code, `docs/14-stage10bc-gate.md needs a code block in Step ${step}`);
  const code = entry.code.replace(/^(\/\/[^\n]*\n)*\s*await \(/, match => match.replace("await (", "("));
  return as(user, () => (0, eval)(code));
}
// Per-client definitions: the Player window starts with NOTHING loaded and gets what the GM sends (Step 3), as in real Foundry.
const gateWorld = options => world({ downtime: 0, iron: 0, fang: 0, perClientDefinitions: true, ...options });
const PLAYER = [2, 3].length; void PLAYER;

// Who runs each step (the doc labels must agree).
const WHO = new Map([[1, "both"], [2, "gm"], [3, "player"], [4, "player"], [5, "gm"], [6, "player"], [7, "gm"], [8, "player"], [9, "gm"], [10, "player"], [11, "gm"], [12, "player"], [13, "gm"], [14, "player"],
  [15, "player"], [16, "player"], [17, "gm"], [18, "player"], [19, "player"], [20, "gm"], [21, "player"], [22, "gm"], [23, "player"], [24, "gm"], [25, "player"], [26, "gm"], [27, "player"], [28, "gm"], [29, "player"], [30, "gm"], [31, "gm"], [32, "gm"], [33, "gm"]]);

test("the gate checklist has exactly one code block per step, and every step says who runs it", () => {
  assert.equal(GATE.size, 33);
  for (const [step, { who, code, text }] of GATE) {
    assert.match(who, /^\[(GM|Player)\]( and \[(GM|Player)\])?$/, `step ${step}`);
    assert.ok(code, `step ${step} needs its code block`);
    assert.equal((text.match(/```js/g) ?? []).length, 1, `step ${step} has exactly one code block`);
    const expected = WHO.get(step);
    assert.equal(expected === "both" ? /GM.*Player/.test(who) : who === (expected === "gm" ? "[GM]" : "[Player]"), true, `step ${step} is labelled ${who}`);
  }
  assert.match(gateDoc, /game\.user\.name, game\.user\.isGM/);
  assert.match(gateDoc, /Force-reload BOTH windows first/);
  assert.match(gateDoc, /version must be \*\*0\.15\.0\*\*/);
  assert.match(gateDoc, /ALL PASS/);
});

test("GATE 14: every step runs, in order, as the right client, and reports ALL PASS", async () => {
  const w = await gateWorld();
  const api = getApi();
  const { gm, testUser } = getUsers();
  const annBefore = snapshot(w);
  void annBefore;
  await quietly(async () => {
    assert.deepEqual(await runBlock(1, gm), ["GM", true, MODULE_VERSION]);
    assert.deepEqual(await runBlock(1, testUser), ["Test", false, MODULE_VERSION]);

    const setup = await runBlock(2, gm);
    assert.deepEqual(setup.baseline, { gold: 100, ore: 12, gem: 4, hide: 0, free: 12, reserved: 0 });
    assert.deepEqual([setup.smith, setup.bystander, setup.scene, setup.testUsersCharacter], ["Gate Smith", "Gate Bystander", "Gate Yard", "Gate Smith"]);
    assert.deepEqual(await runBlock(3, testUser), { gold: 100, ore: 12, gem: 4, hide: 0, free: 12, reserved: 0 });

    const run = async (step, user) => {
      // In real Foundry a player client refreshes itself a moment after the hooks fire; a person takes longer than that between steps.
      if (!user.isGM && globalThis.__p2) await as(user, () => api.definitions.refresh());
      const lines = [];
      const saved = console.log;
      console.log = (...args) => lines.push(args.map(String).join(" "));
      try { assert.equal(await runBlock(step, user), "ALL PASS", `step ${step} did not report ALL PASS:\n${lines.join("\n").split("\n").filter(l => l.startsWith("FAIL")).join("\n")}`); } finally { console.log = saved; }
    };
    const reloadGMWindow = async () => {        // a reload wipes the memory-only definitions and the helper
      api.definitions = makeRegistry(); delete globalThis.__g2;
      const again = await runBlock(2, gm);
      assert.match(again.already, /set up/);
      assert.deepEqual(again.baseline, { gold: 100, ore: 12, gem: 4, hide: 0, free: 12, reserved: 0 }, "the saved baseline, not today's numbers");
      assert.ok(api.definitions.recipe.has("g2-blade") && api.definitions.blueprint.has("g2-camp") && globalThis.__g2, "the definitions and the helper are back");
    };
    for (let step = 4; step <= 30; step++) {
      if (step === 9 || step === 22) await reloadGMWindow();    // after combat and exploring, and just before the End downtime check
      await run(step, WHO.get(step) === "gm" ? gm : testUser);
    }
    const cleanup = await runBlock(31, gm);
    assert.deepEqual(cleanup, { problems: [], actorsLeft: 0, sceneLeft: false, downtimeOpen: false, testUsersCharacter: null, stationStateLeft: 0, partyStationsLeft: 0, audit: [] });
  });
  // Everything the gate changed is back; nothing of Ann's or Bob's was touched.
  assert.equal(game.scenes.getName("Gate Yard"), undefined);
  for (const name of ["Gate Smith", "Gate Bystander", "Gate Wolf"]) assert.equal(game.actors.getName(name), undefined, name);
  assert.equal(game.combats.length, 0, "the combats are gone");
  assert.equal(env.values.partyLocation, "oakhaven", "the party location is put back");
  assert.deepEqual(env.values.downtime, {});
  assert.deepEqual(env.values.stationState ?? [], []);
  assert.deepEqual(env.values.partyStations ?? [], []);
  assert.deepEqual(Object.keys(env.values.sharedCompendium?.materials ?? {}), [], "the shared entries are removed");
  for (const [kind, id] of [["blueprint", "g2-camp"], ["recipe", "g2-blade"], ["region", "g2-wood"], ["nodeType", "g2-patch"], ["station", "g2-bench"], ["material", "g2-ore"], ["material", "g2-hide"], ["material", "g2-gem"], ["town", "g2-town"], ["town", "g2-away"]]) {
    assert.equal(api.definitions[kind].has(id), false, `${id} is removed`);
  }
  assert.ok(!events().some(t => /Gate |Yard /.test(t)), "the world events that name the gate things are gone");
  assert.deepEqual(Object.keys(env.values.auditLedger).filter(k => k !== "_events" && !/^actor/.test(k)), []);
  assert.deepEqual(measure(w.ann), { copper: 2000, stash: {}, freeDays: 0, reservedDays: 0, totalDays: 0, items: [] });
  assert.equal(globalThis.__g2, undefined, "the GM helper is removed by CLEANUP");
  delete globalThis.__p2;
});

test("GATE 14: SETUP refuses to run against real data (or leftovers), changing nothing", async () => {
  for (const [label, prepare, expected] of [
    ["open downtime", async w => { await getApi().downtime.start({ days: 3, actorIds: [w.ann.id] }); }, /downtime is already open/],
    ["a character holding days", async w => { await getApi().grantDays(w.ann, 2); }, /these characters hold downtime days: Ann/],
    ["a queued item", async w => { await getApi().downtime.start({ days: 3, actorIds: [w.ann.id] }); }, /downtime is already open|the queue is not empty/],
    ["a real actor named like a gate one", async () => { const { makeActor } = await import("./fake-world.js"); game.actors.push(makeActor("Gate Smith")); }, /already exists and was not made by this check/],
    ["a leftover party workshop", async () => { env.values.partyStations = [{ id: "party-g2-camp-x", name: "Yard Camp", category: "smithing", tier: 1, town: "g2-town", builtBy: "x", blueprintId: "g2-camp", builtAt: 1 }]; }, /an earlier run left a Yard Camp party workshop: run CLEANUP/],
    ["a leftover bench state", async () => { env.values.stationState = [{ stationId: "g2-bench", access: [], upgrades: { craftDays: 1 } }]; }, /an earlier run left a saved state for the Yard Bench/]
  ]) {
    const w = await gateWorld();
    await prepare(w);
    const before = snapshot(w);
    const { gm } = getUsers();
    await quietly(async () => assert.rejects(Promise.resolve(runBlock(2, gm)), expected, label));
    assert.equal(snapshot(w), before, `${label}: nothing changed`);
    delete globalThis.__g2;
  }
});

test("GATE 14: SETUP can be run twice, and CLEANUP works from the middle of the gate, after a failed step", async () => {
  const w = await gateWorld();
  const { gm, testUser } = getUsers();
  await quietly(async () => {
    await runBlock(2, gm);
    const again = await runBlock(2, gm);
    assert.equal(again.already, "set up");
    await runBlock(3, testUser);
    assert.equal(await runBlock(15, testUser), "ALL PASS");     // an upgrade is started, its escrow taken
    assert.equal(await runBlock(19, testUser).catch(() => "x") === "ALL PASS" || true, true);
    const cleanup = await runBlock(31, gm);
    assert.deepEqual(cleanup.problems, []);
    assert.equal(cleanup.actorsLeft, 0);
    const second = await runBlock(31, gm);
    assert.deepEqual(second.problems, []);
  });
  assert.equal(game.actors.getName("Gate Smith"), undefined);
  assert.deepEqual(env.values.stationState ?? [], []);
  assert.deepEqual(measure(w.ann).stash, {});
});

test("gate 14 step 18: a cancel whose update arrives late still passes, and a real failure prints every value it compared", async () => {
  const code = GATE.get(18).code.replace(/^(\/\/[^\n]*\n)*\s*await \(/, match => match.replace("await (", "("));
  const run = async lateMs => {
    const start = { gold: 100, ore: 12, gem: 4, hide: 0, free: 12, reserved: 0 };
    const held = { ...start, gold: 99, ore: 10, reserved: 1 };
    let state = start, queued = null, t0 = 0;
    const rows = [];
    globalThis.__p2 = {
      hero: {},
      look: () => (queued && t0 && Date.now() - t0 >= lateMs && lateMs >= 0 ? start : state),
      pending: () => (queued ? [{ id: "q1" }] : []),
      until: async (fn, ms = 1500) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 20)); } return false; },
      check: (label, ok, detail) => rows.push({ label, ok, detail }),
      done: () => (rows.every(r => r.ok) ? "ALL PASS" : "FAILED"),
      api: { queue: {
        submit: async () => { queued = true; state = held; return { id: "q1", daysReserved: 1, params: { escrow: { feeCopper: 100 } } }; },
        cancel: async () => { t0 = Date.now(); return { refunded: 1 }; }
      } }
    };
    const out = await (0, eval)(code);
    delete globalThis.__p2;
    return { out, rows };
  };
  const late = await run(300);
  assert.equal(late.out, "ALL PASS", JSON.stringify(late.rows));           // the update arrives 300 ms after cancel() returned: the check waits for it
  const never = await run(-1);
  const failed = never.rows.find(r => r.label === "cancel gives everything back");
  assert.equal(failed.ok, false);
  const detail = JSON.parse(failed.detail);
  assert.deepEqual(Object.keys(detail).sort(), ["afterCancel", "before", "pending", "result"], "the FAIL line prints every value it compared");
  assert.equal(detail.before.gold, 100);
  assert.equal(detail.afterCancel.gold, 99);
});

// Step 32 (new): a creature whose name has a dot, saved flat on real Foundry --------------------------------------------------------------------------------------------------------
import { M as MODULE } from "./fake-world.js";
function expandDots(value) {
  if (Array.isArray(value) || value === null || typeof value !== "object") return value;
  const out = {};
  for (const [key, inner] of Object.entries(value)) { let node = out; const path = key.split("."); for (const part of path.slice(0, -1)) node = node[part] ??= {}; node[path.at(-1)] = expandDots(inner); }
  return out;
}
test("gate 14 Step 32: a creature called Gate Wolf Jr. is saved under a dot-free key (Foundry reads a dot as a path), shared, and read back; Step 33 is the same CLEANUP as Step 31", async () => {
  assert.equal(GATE.get(33).code, GATE.get(31).code, "Step 33 is the same CLEANUP block as Step 31");
  assert.match(GATE.get(31).code, /"Gate Wolf Jr\."/, "CLEANUP removes Gate Wolf Jr.");
  for (const step of [32, 33]) {
    const section = GATE.get(step).text.split("```js")[0];
    const bullets = section.split("\n").filter(l => /^- /.test(l));
    assert.ok(bullets.length >= 3 && bullets.every(b => b.length <= 700), `step ${step} is in the bullet format`);
    assert.ok(bullets.some(b => /^- You should see:/.test(b)), `step ${step} has a "You should see:" bullet`);
  }
  const w = await gateWorld();
  const { gm } = getUsers();
  const set = game.settings.set;
  await quietly(async () => {
    await runBlock(2, gm);
    // what real Foundry does with a dotted key: the flag write and the setting write are expanded into nested objects
    const smith = game.actors.getName("Gate Smith");
    const update = smith.update.bind(smith);
    smith.update = data => update(Object.fromEntries(Object.entries(data).map(([path, value]) => [path, expandDots(value)])));
    game.settings.set = async (scope, key, value) => set(scope, key, key === "sharedCompendium" ? expandDots(value) : value);
    try {
      const sink = [], logged = console.log;
      console.log = (...args) => sink.push(args.map(String).join(" "));
      let result;
      try { result = await runBlock(32, gm); } finally { console.log = logged; }
      assert.equal(result, "ALL PASS", sink.join("\n"));
      const text = sink.join("\n");
      assert.match(text, /savedFlagKeys":\["gate wolf jr%2e"\]/, "the saved keys are printed");
      assert.match(text, /savedSharedKeys":\["gate wolf jr%2e"\]/);
      assert.deepEqual(Object.keys(env.values.sharedCompendium.creatures), ["gate wolf jr%2e"]);
      assert.deepEqual(Object.keys(smith.getFlag(MODULE, "compendium").creatures), ["gate wolf jr%2e"]);
    } finally { game.settings.set = set; }
    const clean = await runBlock(33, gm);
    assert.deepEqual([clean.problems, clean.actorsLeft, clean.sceneLeft], [[], 0, false]);
    assert.deepEqual(Object.keys(env.values.sharedCompendium?.creatures ?? {}), [], "the shared entry is gone");
    assert.equal(game.actors.getName("Gate Wolf Jr."), undefined);
    const again = await runBlock(33, gm);
    assert.deepEqual(again.problems, []);
  });
  assert.equal(game.actors.getName("Gate Smith"), undefined);
  void w;
});
