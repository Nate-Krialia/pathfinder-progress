/**
 * The tags item-reference PROBE gate (docs/22-tags-item-refs-gate.md): every code block is extracted and run, in order, in a fake Foundry that is given just enough pretend compendium,
 * world items and drop functions for the blocks to run. It proves the blocks run, print ONE line per route with the full values, can be run twice, and clean up after themselves.
 * What it cannot show, and the real gate exists for: what real Foundry and PF2e write into `_stats` when an item is copied onto an actor.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { as, env, getApi, getUsers, quietly, world } from "./fake-world.js";
import script from "../e2e/steps/gate22.steps.mjs";
import { makeDomDriver, playStep } from "../e2e/driver-dom.mjs";

const gateDoc = readFileSync("docs/22-tags-item-refs-gate.md", "utf8");
const MODULE_VERSION = JSON.parse(readFileSync("module.json", "utf8")).version;
const GATE = new Map();
for (const match of gateDoc.matchAll(/^## Step (\d+) ((?:\[[^\]]+\](?: and )?)+)[^\n]*\n([\s\S]*?)(?=^## Step |^## Group |(?![\s\S]))/gm)) {
  const block = match[3].match(/```js\n([\s\S]*?)```/);
  GATE.set(Number(match[1]), { who: match[2], code: block?.[1] ?? null, text: match[3] });
}
function runBlock(step, user) {
  const entry = GATE.get(step);
  assert.ok(entry?.code, `docs/22-tags-item-refs-gate.md needs a code block in Step ${step}`);
  const code = entry.code.replace(/^(\/\/[^\n]*\n)*\s*await \(/, match => match.replace("await (", "("));
  return as(user, () => (0, eval)(code));
}
const ROUTES = ["0a", "0b", "1a", "1b", "1c", "2a", "2b", "2c", "2d", "3a", "3b", "4", "5a", "5b", "5c", "6"];
const COMP_UUID = "Compendium.pf2e.equipment-srd.Item.8Jdw4yAzWYylGePS";

/** Just enough of Foundry's item side for the probe: a pretend compendium, item uuids, toObject with _stats, clone with addSource, drop data, fromCompendium. */
function installProbeFake() {
  const comp = { name: "Torch", uuid: COMP_UUID, toObject: () => ({ name: "Torch", type: "equipment", system: { quantity: 1 }, flags: {}, _stats: { compendiumSource: null } }) };
  game.packs = { ...game.packs, get: id => (id === "pf2e.equipment-srd" ? { getIndex: async () => [{ name: "Torch", _id: "8Jdw4yAzWYylGePS" }], getDocument: async () => comp } : undefined) };
  const decorate = (item, owner) => {
    item.uuid = owner ? `Actor.${owner.id}.Item.${item.id}` : `Item.${item.id}`;
    item.toObject = () => structuredClone({ name: item.name, type: item.type, system: item.system, flags: item.flags, _stats: item._stats });
    item.clone = async (changes = {}, { parent, addSource } = {}) => {
      const data = { ...item.toObject(), ...changes, ...(addSource ? { _stats: { ...item._stats, duplicateSource: item.uuid } } : {}) };
      return parent ? (await parent.createEmbeddedDocuments("Item", [data]))[0] : Item.create(data);
    };
    return item;
  };
  const create = Item.create;
  Item.create = async data => decorate(await create(data), null);
  Item.implementation = Item;
  Item.fromDropData = async ({ uuid }) => {
    if (uuid === COMP_UUID) return comp;
    const found = [...game.items, ...game.actors.flatMap(a => [...a.items])].find(i => i.uuid === uuid);
    if (!found) throw new Error(`no document for ${uuid}`);
    return found;
  };
  game.items.fromCompendium = doc => ({ ...doc.toObject(), _stats: { compendiumSource: doc.uuid } });
  const actorCreate = Actor.create;
  Actor.create = async data => {
    const actor = await actorCreate(data);
    const original = actor.createEmbeddedDocuments.bind(actor);
    actor.createEmbeddedDocuments = async (type, datas) => (await original(type, datas)).map(item => decorate(item, actor));
    return actor;
  };
  return comp;
}

const sink = async fn => {
  const lines = [], logged = console.log;
  console.log = (...args) => lines.push(args.map(String).join(" "));
  try { return { result: await fn(), lines: lines.join("\n").split("\n").filter(Boolean) }; } finally { console.log = logged; }
};

test("the tags item-reference probe gate doc: steps are labelled, bullets are short, one block each, nothing is asked beyond the probe", () => {
  assert.deepEqual([...GATE.keys()], Array.from({ length: 16 }, (_, i) => i + 1));
  const PLAYER_STEPS = [10, 11, 12, 15];
  for (const [step, entry] of GATE) {
    assert.match(entry.who, PLAYER_STEPS.includes(step) ? /^\[Player\]\s*$/ : /^\[GM\]\s*$/, `step ${step} says who runs it`);
    assert.ok(entry.code, `step ${step} has a code block`);
    assert.equal((entry.text.match(/```js/g) ?? []).length, 1, `step ${step} has ONE code block`);
    // The standing format (CLAUDE.md): a short bullet list, one action per bullet; what to see is its own bullet starting "You should see:".
    const section = entry.text.split("```js")[0];
    const bullets = section.split("\n").filter(l => /^- /.test(l));
    assert.ok(bullets.length >= 2, `step ${step} lists its instructions as bullets`);
    assert.ok(bullets.every(b => b.length <= 700), `step ${step}: every bullet is short (one action)`);
    assert.doesNotMatch(section.replace(/^- .*$/gm, ""), /\n[A-Z][^\n]{200,}/, `step ${step} has no long paragraph of instructions outside the bullets`);
    if (!/Nothing to click/i.test(section)) assert.ok(bullets.some(b => /You should see:/.test(b)), `step ${step} has a "You should see:" bullet`);
  }
  assert.match(gateDoc, new RegExp(`version must be \\*\\*${MODULE_VERSION.replace(/\./g, "\\.")}\\*\\*`));
  assert.match(gateDoc, /Steps 1 to 5 are a PROBE, not a test/);
  assert.match(gateDoc, /What the later steps depend on \(they are NOT written yet\)/);
  for (const id of ROUTES) assert.match(gateDoc, new RegExp(`\\b${id}\\b`), `the doc names route ${id}`);
  assert.match(gateDoc, /No fallback code|\*\*Decision: no fallback code\.\*\*/);
  assert.match(gateDoc, /Steps are never renumbered/);
  assert.match(gateDoc, /Compendium\.pf2e\.equipment-srd\.Item\.8Jdw4yAzWYylGePS/);
  assert.equal(GATE.get(16).text.includes("Safe to run twice"), true, "CLEANUP 2 says it is safe to run twice");
  assert.doesNotMatch(gateDoc, /stack-merge step is written|merge the stack\?\)\s*\n- Run/, "no stack-merge step was added");
  assert.doesNotMatch(gateDoc.replace(/DC\b[^\n]*never/gi, ""), /\bDC \d|odds of|\d+% chance/i, "the gate text never talks about difficulty to a player");
  assert.equal(GATE.get(5).text.includes("Safe to run twice"), true, "CLEANUP says it is safe to run twice");
});

test("the steps file obeys the runner's rules and picks by the saved uuids, never by position", () => {
  const source = readFileSync("e2e/steps/gate22.steps.mjs", "utf8");
  assert.doesNotMatch(source, /\bimport\b|require\(|process\.|fetch\(|eval\(|new Function|nth-child/, "no import, require, process, fetch, eval or Function");
  assert.match(source, /dropOnSheet/);
  assert.match(source, /s\.compendium\.uuid/);
  assert.match(source, /s\.worldItemUuid/);
  assert.deepEqual(Object.keys(script), ["before"]);
  assert.deepEqual(Object.keys(script.before), ["4", "9", "10", "11", "12", "13", "14"]);
  assert.match(source, /data-recipe="g22-trinket"/);
  assert.match(source, /data-station="g22-bench"/);
  assert.match(source, /data-action-id=/, "Cancel is picked by the queued action's id");
});

test("GATE 22: SETUP, the probe (one full line per route, runs twice), the drop step with and without the runner's drop action, CLEANUP twice", async () => {
  const w = await world({ downtime: 0, iron: 0, fang: 0, perClientDefinitions: true });
  const { gm, testUser } = getUsers();
  installProbeFake();
  const baseItems = game.items.length, baseActors = game.actors.length;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await quietly(async () => {
    assert.deepEqual(await runBlock(1, gm), ["GM", true, MODULE_VERSION, true]);
    const setup = await runBlock(2, gm);
    assert.deepEqual(setup.actors, ["Gate G22 Smith", "Gate G22 Friend"]);
    assert.equal(setup.compendium.uuid, COMP_UUID);
    assert.equal(game.actors.getName("Gate G22 Smith").ownership?.[testUser.id], 3, "Smith is owned by Test");
    assert.equal((await runBlock(2, gm)).already, "set up", "SETUP runs twice");
    // nothing is tagged by this gate
    assert.deepEqual(await as(gm, () => getApi().tags.ledger().items), {}, "the probe tags nothing");

    const first = await sink(() => runBlock(3, gm));
    assert.equal(first.result, "ALL PASS", first.lines.join("\n"));
    const rows = first.lines.filter(l => /^(PASS|FAIL): /.test(l));
    assert.equal(rows.length, ROUTES.length, `one line per route:\n${rows.join("\n")}`);
    ROUTES.forEach((id, i) => assert.match(rows[i], new RegExp(`^PASS: ${id} `), `line ${i} is route ${id}`));
    for (const row of rows) {
      for (const part of ["name=", "uuid=", "_stats=", "flags.core=", "quantity=", "refsOf="]) assert.ok(row.includes(` | ${part}`), `${row.slice(0, 60)} shows ${part}`);
      const refs = JSON.parse(row.slice(row.indexOf(" | refsOf=") + " | refsOf=".length));
      assert.deepEqual(Object.keys(refs), ["candidates", "matched", "tags", "tier", "fitsBySlot"], "refsOf is printed whole");
      assert.equal(refs.matched, null, "the probe tags nothing, so nothing matches");
      assert.ok(!/\.\.\.|…/.test(row), "no line is cut");
    }
    // the values the fake's routes should give, so a line is not just decoration
    const by = id => rows.find(r => new RegExp(`^PASS: ${id} `).test(r));
    assert.match(by("1b"), new RegExp(`"compendiumSource":"${COMP_UUID}"`));
    assert.match(by("5b"), /"duplicateSource":"Item\./);
    assert.match(by("6"), /flags\.core=\{"sourceId":"Compendium/);
    const probeItems = () => [...game.items, ...game.actors.flatMap(a => [...a.items])].filter(i => /^Gate G22 probe /.test(i.name)).length;
    const count = probeItems();
    assert.equal(count, ROUTES.length - 2, "the probe made one copy per route (not the two world items themselves)");
    const second = await sink(() => runBlock(3, gm));
    assert.equal(second.result, "ALL PASS");
    assert.equal(probeItems(), count, "a second run replaces the first run's copies");

    // Step 4 without the runner's drop action: a hand step. Nothing was dragged, so the block says so plainly.
    const none = await sink(() => runBlock(4, gm));
    assert.match(none.result, /1 FAILED/);
    assert.ok(none.lines.some(l => /^FAIL: at least one hand-dragged item/.test(l)), none.lines.join("\n"));
    // Step 4 with the drop action (the fake's own version: it uses the same drop data the real sheet would)
    const smith = game.actors.getName("Gate G22 Smith");
    const dropped = [];
    const extras = { dropOnSheet: async (actorName, data) => { dropped.push([actorName, data]); const doc = await Item.implementation.fromDropData(data); await game.actors.getName(actorName).createEmbeddedDocuments("Item", [{ ...doc.toObject(), name: doc.name }]); } };
    const base = { drivers: { gm: makeDomDriver({ as, user: gm }), player: makeDomDriver({ as, user: testUser }) }, state: {}, assert, wait, extras };
    const four = await sink(() => playStep({ script, n: 4, who: "gm", base, runBlock: () => runBlock(4, gm).then(r => { base.state.result = r; }) }));
    assert.deepEqual(dropped.map(([n, d]) => [n, d.uuid]), [["Gate G22 Smith", COMP_UUID], ["Gate G22 Smith", game.items.getName("Gate G22 World Item").uuid], ["Gate G22 Smith", COMP_UUID]]);
    assert.equal(base.state.result, "ALL PASS", four.lines.join("\n"));
    const dragRows = four.lines.filter(l => /^PASS: 7/.test(l));
    assert.ok(dragRows.length >= 3 && dragRows.every(r => r.includes(" | refsOf=")), dragRows.join("\n"));
    void smith;

    const clean = await runBlock(5, gm);
    assert.deepEqual(clean, { problems: [], actorsLeft: 0, itemsLeft: 0, flagLeft: false });
    assert.deepEqual(await runBlock(5, gm), { problems: [], actorsLeft: 0, itemsLeft: 0, flagLeft: false }, "CLEANUP runs twice");
  });
  assert.equal(game.items.length, baseItems);
  assert.equal(game.actors.length, baseActors);
  assert.equal(globalThis.__g22, undefined);
  void w; void env;
});

test("GATE 22: SETUP refuses to run over something it did not make, and says why", async () => {
  await world({ downtime: 0, iron: 0, fang: 0, perClientDefinitions: true });
  const { gm } = getUsers();
  installProbeFake();
  await Item.create({ name: "Gate G22 World Plain", type: "equipment", system: { quantity: 1 } });
  await quietly(async () => assert.rejects(Promise.resolve(runBlock(2, gm)), /already exists and was not made by this check/));
  const noItem = GATE.get(2).code.replace('NAME = "Torch"', 'NAME = "No Such Thing"');
  await game.items.getName("Gate G22 World Plain").delete();
  await quietly(async () => assert.rejects(Promise.resolve(as(gm, () => (0, eval)(noItem.replace(/^(\/\/[^\n]*\n)*\s*await \(/, m => m.replace("await (", "("))))), /has no item named "No Such Thing"/));
  assert.equal(game.actors.getName("Gate G22 Smith"), undefined, "a refused SETUP made nothing");
});

test("GATE 22: a route that real Foundry refuses prints 'not possible here: <reason>' and the probe goes on", async () => {
  await world({ downtime: 0, iron: 0, fang: 0, perClientDefinitions: true });
  const { gm } = getUsers();
  installProbeFake();
  await quietly(async () => {
    await runBlock(2, gm);
    game.items.fromCompendium = () => { throw new Error("fromCompendium is not a function here"); };
    const out = await sink(() => runBlock(3, gm));
    assert.equal(out.result, "ALL PASS", out.lines.join("\n"));
    const rows = out.lines.filter(l => /^(PASS|FAIL): /.test(l));
    assert.equal(rows.length, ROUTES.length, "still one line per route");
    assert.ok(rows.some(r => /^PASS: 1b .* \| not possible here: fromCompendium is not a function here$/.test(r)), rows.join("\n"));
    await runBlock(5, gm);
  });
});

// Steps 6 to 16 (added after the probe): tag the compendium item, the player's window, queue / cancel / fail / succeed on a real-shaped craft, the leak scan, CLEANUP 2 --------------------------------------
import { installFakeApplication } from "./fake-application.js";

test("GATE 22 steps 6 to 16: tag the compendium item, the Player's window, queue and cancel, a forced failure, a success, the leak scan, CLEANUP 2 twice", async () => {
  await world({ downtime: 0, iron: 0, fang: 0, perClientDefinitions: true });
  const { gm, testUser } = getUsers();
  installFakeApplication();
  installProbeFake();
  const api = getApi();
  const baseItems = game.items.length, baseActors = game.actors.length;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const dropped = [];
  const extras = { dropOnSheet: async (actorName, data) => { dropped.push(data.uuid); const doc = await Item.implementation.fromDropData(data); await game.actors.getName(actorName).createEmbeddedDocuments("Item", [{ ...doc.toObject(), name: doc.name }]); } };
  const base = { drivers: { gm: makeDomDriver({ as, user: gm }), player: makeDomDriver({ as, user: testUser }) }, state: {}, assert, wait, extras };
  const results = {};
  const play = async (n, who) => { const out = await sink(() => playStep({ script, n, who, base, runBlock: async () => { results[n] = await runBlock(n, who === "player" ? testUser : gm); } })); results[`lines${n}`] = out.lines; return results[n]; };
  const expectPass = async (n, who) => assert.equal(await play(n, who), "ALL PASS", `step ${n}:\n${results[`lines${n}`].join("\n")}`);
  await quietly(async () => {
    await runBlock(2, gm);
    const six = await runBlock(6, gm);
    assert.equal(six.planted.length, 7);
    assert.equal(game.users.getName("Test").character?.name, "Gate G22 Smith", "SETUP 2 makes Smith Test's character");
    assert.equal((await runBlock(6, gm)).already, "set up", "SETUP 2 runs twice");
    assert.deepEqual(await as(gm, () => api.tags.ledger().items), {}, "nothing is tagged before Step 7");

    await expectPass(7, "gm");
    await expectPass(8, "gm");
    const ledgerAfter8 = Object.keys(await as(gm, () => api.tags.ledger().items));
    assert.deepEqual(ledgerAfter8, [COMP_UUID], "Step 8 leaves only the compendium item tagged");
    assert.match(results.lines7.join("\n"), /PASS: the compendium copy carries _stats\.compendiumSource/);
    assert.match(results.lines8.join("\n"), /printed, not judged: the COPY of the world item/);

    await play(9, "gm");
    assert.equal(results[9], "ALL PASS", results.lines9.join("\n"));
    assert.ok(results.lines9.some(l => /^PASS: ANSWER \(issue 27\): .*NO source, so a tag on the world item never matches its copies/.test(l)), results.lines9.join("\n"));
    assert.equal(dropped.at(-1), game.items.getName("Gate G22 World Plain").uuid, "the steps file dropped the PLAIN world item by its saved uuid");

    await as(testUser, () => api.definitions.refresh({ force: true }));
    await expectPass(10, "player");
    await expectPass(11, "player");
    await expectPass(12, "player");
    await expectPass(13, "gm");
    await expectPass(14, "gm");
    await expectPass(15, "player");
    assert.match(results.lines15.join("\n"), /recorded, not judged: a player client can read the tagLedger/);

    const clean = { problems: [], actorsLeft: 0, itemsLeft: 0, frozenLeft: 0, ledgerLeft: 0, downtimeOpen: false, sharedLeft: 0, flagLeft: false, audit: [] };
    assert.deepEqual(await runBlock(16, gm), clean);
    assert.deepEqual(await runBlock(16, gm), clean, "CLEANUP 2 runs twice");
    await as(testUser, () => foundry.applications.instances.get("pathfinder-progress-hub")?.close());
  });
  assert.equal(game.items.length, baseItems);
  assert.equal(game.actors.length, baseActors);
  assert.equal(globalThis.__g22, undefined);
  assert.deepEqual(Object.keys(await as(gm, () => api.tags.ledger().items)), [], "the tags are off again");
  for (const [kind, id] of [["recipe", "g22-trinket"], ["tag", "g22-tooth"], ["material", "g22-iron"], ["station", "g22-bench"], ["town", "g22-town"]]) assert.equal(api.definitions[kind].has(id), false, `${kind} ${id} is gone`);
});
