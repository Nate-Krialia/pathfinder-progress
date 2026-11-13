/**
 * The frozen-record life-cycle gate (docs/25-tags-frozen-gate.md): every code block is extracted and run, in order, in a fake Foundry with PF2e-like actors and tokens, a fake chat log, items that fire
 * `deleteItem` when deleted (an actor's deletion does NOT fire it for its items unless asked to, the case the gate prints rather than judges), and (as real Foundry does) a dotted key rewritten into nested
 * objects when it is saved. A reload is simulated by reading the saved store in again. What it cannot show: what real Foundry does on a deleted actor, a real reload, the real saved setting.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { as, fireHookAs, getApi, getUsers, quietly, world } from "./fake-world.js";
import { asPage, seedRecords } from "./helpers.js";
import { installFakeApplication } from "./fake-application.js";
import { loadFrozen } from "../scripts/tags/state.js";
import script from "../e2e/steps/gate25.steps.mjs";
import { makeDomDriver, playStep } from "../e2e/driver-dom.mjs";

const gateDoc = readFileSync("docs/25-tags-frozen-gate.md", "utf8");
const MODULE_VERSION = JSON.parse(readFileSync("module.json", "utf8")).version;
const GATE = new Map();
for (const match of gateDoc.matchAll(/^## Step (\d+) ((?:\[[^\]]+\](?: and )?)+)[^\n]*\n([\s\S]*?)(?=^## Step |^## Group |(?![\s\S]))/gm)) {
  const block = match[3].match(/```js\n([\s\S]*?)```/);
  GATE.set(Number(match[1]), { who: match[2], code: block?.[1] ?? null, text: match[3] });
}
function runBlock(step, user) {
  const entry = GATE.get(step);
  assert.ok(entry?.code, `docs/25-tags-frozen-gate.md needs a code block in Step ${step}`);
  const code = entry.code.replace(/^(\/\/[^\n]*\n)*\s*await \(/, match => match.replace("await (", "("));
  return as(user, () => (0, eval)(code));
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const DAGGER = "Compendium.pf2e.equipment-srd.Item.DAGGERDAGGERDAGG";
const sink = async fn => {
  const lines = [], logged = console.log;
  console.log = (...args) => lines.push(args.map(String).join(" "));
  try { return { result: await fn(), lines: lines.join("\n").split("\n").filter(Boolean) }; } finally { console.log = logged; }
};
function expandDots(value) {
  if (Array.isArray(value) || value === null || typeof value !== "object") return value;
  const out = {};
  for (const [key, inner] of Object.entries(value)) { let node = out; const path = key.split("."); for (const part of path.slice(0, -1)) node = node[part] ??= {}; node[path.at(-1)] = expandDots(inner); }
  return out;
}

// A fake PF2e: conditions as the probe found them, saves with a chosen degree, a scene with tokens, a chat log, a pretend compendium and items that carry a source.
let seq = 0;
function pf2eify(actor) {
  const conds = new Map();
  Object.assign(actor, { conds, degree: 1, saveRolls: [] });
  actor.getCondition = slug => (conds.has(slug) ? { slug, value: conds.get(slug) } : null);
  actor.increaseCondition = async (slug, { value = 1, max = Infinity } = {}) => { const had = conds.get(slug); conds.set(slug, Math.min((had ?? 0) + value, max)); return actor.getCondition(slug); };
  actor.decreaseCondition = async (slug, { forceRemove = false } = {}) => { if (forceRemove || !(conds.get(slug) > 1)) conds.delete(slug); else conds.set(slug, conds.get(slug) - 1); };
  actor.saves = Object.fromEntries(["will", "fortitude", "reflex"].map(type => [type, { check: { roll: async opts => { actor.saveRolls.push([type, opts]); return { total: 11, options: { degreeOfSuccess: actor.degree }, dice: [{ faces: 20, results: [{ result: 8, active: true }] }] }; } } }]));
  Object.defineProperty(actor, "flags", { configurable: true, value: { pathfinder_progress: null, "pathfinder-progress": actor.rawFlags() } });
  return actor;
}
const decorate = (item, owner) => {
  item.uuid = owner ? `Actor.${owner.id}.Item.${item.id}` : `Item.${item.id}`;
  item.toObject = () => structuredClone({ name: item.name, type: item.type, system: item.system, flags: item.flags, _stats: item._stats });
  // as real PF2e: a weapon's rule elements are ignored until it is held (requiresEquipped)
  Object.defineProperty(item, "isEquipped", { configurable: true, get: () => item.system?.equipped?.carryType === "held" });
  Object.defineProperty(item, "rules", { configurable: true, get: () => (item.system?.rules ?? []).map(r => ({ key: r.key, ignored: !item.isEquipped })) });
  // real Foundry fires deleteItem when an item is deleted
  const remove = item.delete.bind(item);
  item.delete = async () => { await remove(); await fireHookAs(getUsers().gm, "deleteItem", [item]); };
  return item;
};
function fakePf2e({ cascade = false } = {}) {
  const chat = [];
  const make = data => {
    const m = { id: `chat${++seq}`, timestamp: Date.now(), ...structuredClone(data), getFlag: (scope, key) => m.flags?.[scope]?.[key] };
    m.update = async changes => { for (const [path, value] of Object.entries(changes)) { const keys = path.split("."); let node = m; while (keys.length > 1) { node = node[keys[0]] ??= {}; keys.shift(); } node[keys[0]] = value; } };
    return m;
  };
  globalThis.ChatMessage = { create: async data => { const m = make(data); chat.push(m); return m; }, deleteDocuments: async ids => { for (const id of ids) chat.splice(chat.findIndex(m => m.id === id), 1); }, getSpeaker: () => ({}), getWhisperRecipients: () => [getUsers().gm] };
  Object.defineProperty(chat, "contents", { get: () => chat });
  game.messages = Object.assign(chat, { get: id => chat.find(m => m.id === id) });
  const docs = { [DAGGER]: "Dagger" };
  const compDoc = uuid => ({ name: docs[uuid], uuid, toObject: () => ({ name: docs[uuid], type: uuid === DAGGER ? "weapon" : "equipment", system: { quantity: 1, rules: [] }, flags: {}, _stats: { compendiumSource: null } }) });
  game.packs = { ...game.packs, get: id => (id === "pf2e.equipment-srd" ? { getIndex: async () => Object.entries(docs).map(([uuid, name]) => ({ name, _id: uuid.split(".").pop() })), getDocument: async docId => compDoc(`Compendium.pf2e.equipment-srd.Item.${docId}`) } : undefined) };
  game.items.fromCompendium = doc => ({ ...doc.toObject(), _stats: { compendiumSource: doc.uuid } });
  const baseCreate = Actor.create;
  Actor.create = async data => {
    const actor = pf2eify(await baseCreate(data));
    const embed = actor.createEmbeddedDocuments;
    actor.createEmbeddedDocuments = async (type, datas) => (await embed(type, datas)).map(item => decorate(item, actor));
    actor.changeCarryType = async (item, { carryType, handsHeld = 0 }) => { item.system.equipped = { ...(item.system.equipped ?? {}), carryType, handsHeld }; };
    // deleting an actor: real Foundry may or may not fire deleteItem for the items it held (the gate prints the answer); the fake does it only when asked to
    const removeActor = actor.delete.bind(actor);
    actor.delete = async () => { const items = [...actor.items]; await removeActor(); if (cascade) for (const item of items) await fireHookAs(getUsers().gm, "deleteItem", [item]); };
    return actor;
  };
  const scene = { id: "S", name: "Gate Scene", flags: {}, tokens: [], getFlag: (scope, key) => structuredClone(scene.flags[scope]?.[key]), async setFlag(scope, key, value) { (scene.flags[scope] ??= {})[key] = structuredClone(value); }, async unsetFlag(scope, key) { delete scene.flags[scope]?.[key]; } };
  const tokenOf = data => {
    const worldActor = game.actors.get(data.actorId);
    const t = { id: `tk${++seq}`, name: data.name, actorId: data.actorId, linked: Boolean(data.actorLink) };
    t.uuid = `Scene.S.Token.${t.id}`;
    t.flags = {}; t.getFlag = (scope, key) => structuredClone(t.flags[scope]?.[key]); t.setFlag = async (scope, key, value) => { (t.flags[scope] ??= {})[key] = structuredClone(value); }; t.unsetFlag = async (scope, key) => { delete t.flags[scope]?.[key]; };
    t.actor = t.linked ? worldActor : pf2eify(Object.assign(Object.create(null), { id: worldActor.id, name: worldActor.name, items: worldActor.items, system: structuredClone(worldActor.system), rawFlags: () => ({}), degree: 1 }));
    return t;
  };
  scene.createEmbeddedDocuments = async (type, datas) => datas.map(d => { const t = tokenOf(d); scene.tokens.push(t); return t; });
  scene.deleteEmbeddedDocuments = async (type, ids) => { for (const id of ids) scene.tokens.splice(scene.tokens.findIndex(t => t.id === id), 1); };
  game.scenes.push(scene);
  globalThis.canvas = { scene, grid: { size: 100 }, dimensions: { sceneX: 0, sceneY: 0 }, tokens: { controlled: [] } };
  globalThis.fromUuid = async uuid => {
    let m;
    if (docs[uuid]) return compDoc(uuid);
    if ((m = /^Scene\.S\.Token\.(\w+)$/.exec(uuid))) return scene.tokens.find(t => t.id === m[1]) ?? null;
    if ((m = /^Actor\.(\w+)\.Item\.(\w+)$/.exec(uuid))) return game.actors.get(m[1])?.items.get(m[2]) ?? null;
    return null;
  };
  // real Foundry reads a dot in a key as a path: the fake does the same to the ledger and the shared Compendium (settings) and to a flag write
  const set = game.settings.set;
  game.settings.set = async (scope, key, value) => {
    const out = await set(scope, key, ["tagLedger", "tagCaps", "tagCrafted", "sharedCompendium"].includes(key) ? expandDots(value) : value);
    // real Foundry fires updateSetting on the client that wrote it too: the module reads the frozen store in again when it hears it (tags/state.js installFrozenHooks)
    if (key === "tagCrafted") await fireHookAs(getUsers().gm, "updateSetting", [{ key: `pathfinder-progress.${key}` }]);
    return out;
  };
  return { chat, scene, restore: () => { game.settings.set = set; } };
}


test("the frozen-record gate doc: steps are labelled, bullets are short, the standing format holds, every FAIL prints what it compared", () => {
  assert.deepEqual([...GATE.keys()], Array.from({ length: 12 }, (_, i) => i + 1));
  for (const [step, entry] of GATE) {
    assert.match(entry.who, step === 1 ? /^\[GM\] and \[Player\]\s*$/ : step === 11 ? /^\[Player\]\s*$/ : /^\[GM\]\s*$/, `step ${step} says who runs it`);
    assert.ok(entry.code, `step ${step} has a code block`);
    assert.equal((entry.text.match(/```js/g) ?? []).length, 1, `step ${step} has ONE code block`);
    const section = entry.text.split("```js")[0];
    const bullets = section.split("\n").filter(l => /^- /.test(l));
    assert.ok(bullets.length >= 2, `step ${step} lists its instructions as bullets`);
    assert.ok(bullets.every(b => b.length <= 700), `step ${step}: every bullet is short (one action)`);
    assert.doesNotMatch(section.replace(/^- .*$/gm, ""), /\n[A-Z][^\n]{200,}/, `step ${step} has no long paragraph of instructions outside the bullets`);
    if (!/Nothing to click/i.test(section) && step !== 2) assert.ok(bullets.some(b => /You should see:/.test(b)), `step ${step} has a "You should see:" bullet`);
    if (step > 1) assert.match(entry.code, /ALL PASS|done\(\)|already|planted|problems/, `step ${step} ends in a result line the person can paste back`);
  }
  assert.match(gateDoc, new RegExp(`version must be \\*\\*${MODULE_VERSION.replace(/\./g, "\\.")}\\*\\*`));
  assert.match(gateDoc, /Force-reload BOTH windows first/);
  assert.match(gateDoc, /What SETUP plants/);
  assert.match(gateDoc, /Every FAIL line prints each value it compared/);
  assert.match(gateDoc, /changeCarryType\(item, \{ carryType: "held", handsHeld: 1 \}\)/, "the doc says how to hold a weapon before reading its rules");
  assert.match(GATE.get(9).code, /return result === "ALL PASS" \? "HANDOFF: reload the GM window now/, "Step 9 hands off to the reload only when its own checks passed");
  assert.doesNotMatch(gateDoc.replace(/DC\b[^\n]*never/gi, ""), /\bDC \d|odds of|\d+% chance/i, "the gate text itself never talks about difficulty to a player");
  // every check in a block prints what it compared
  for (const [step, { code }] of GATE) if (step > 1) for (const line of code.split("\n").filter(l => /\bg\.check\(|\bcheck\(/.test(l) && !/const check|const g = |check: \(/.test(l))) assert.match(line, /JSON\.stringify|\bdetail\b|\$\{|\.join\(|\.slice\(|\w+Text\b|g\.conds\(/, `step ${step}: a check prints what it compared: ${line.trim().slice(0, 90)}`);
});

test("the steps file obeys the runner's rules", () => {
  const source = readFileSync("e2e/steps/gate25.steps.mjs", "utf8");
  assert.doesNotMatch(source, /\bimport\b|require\(|process\.|fetch\(|eval\(|new Function|nth-child/, "no import, require, process, fetch, eval or Function");
  assert.deepEqual(Object.keys(script), ["after"]);
  assert.deepEqual(Object.keys(script.after), ["9"]);
  assert.match(source, /reload/);
});

async function playGate({ cascade, reload = true }) {
  await world({ downtime: 0, iron: 0, fang: 0, perClientDefinitions: true });
  const { gm, testUser } = getUsers();
  const api = getApi();
  api.baseSources = seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }));
  api.editorLeftovers = [];
  installFakeApplication();
  const fake = fakePf2e({ cascade });
  gm.targets = new Set(); testUser.targets = new Set();
  let reloads = 0;
  const extras = reload ? { reload: async who => { assert.equal(who, "gm"); reloads++; delete globalThis.__g25; for (const [kind, id] of [["recipe", "g25-blade"], ["station", "g25-bench"], ["town", "g25-town"], ["material", "g25-fang"], ["material", "g25-iron"], ["tag", "g25-bite"]]) api.definitions[kind].delete(id); loadFrozen(); } } : {};
  const base = { drivers: { gm: makeDomDriver({ as, user: gm }), player: makeDomDriver({ as, user: testUser }) }, state: {}, assert, wait, extras };
  const results = {};
  const play = async (n, who) => { const out = await sink(() => playStep({ script, n, who, base, runBlock: async () => { results[n] = await runBlock(n, who === "player" ? testUser : gm); } })); results[`lines${n}`] = out.lines; return results[n]; };
  const expectPass = async (n, who = "gm") => assert.equal(await play(n, who), "ALL PASS", `step ${n}:\n${results[`lines${n}`].join("\n")}`);
  return { api, gm, testUser, fake, results, play, expectPass, reloads: () => reloads };
}

for (const cascade of [false, true]) {
  test(`GATE 25 (deleting an actor ${cascade ? "fires" : "does not fire"} deleteItem for its items): SETUP, craft, edit then use card, delete, duplicate, prune, missing record, reload, Player note, CLEANUP twice`, async () => {
    const { api, gm, fake, results, play, expectPass, reloads } = await playGate({ cascade });
    await quietly(async () => {
      assert.deepEqual(await runBlock(1, gm), ["GM", true, MODULE_VERSION, true]);
      const setup = await runBlock(2, gm);
      assert.equal(setup.planted.length, 7);
      assert.equal(setup.tokens, 2);
      assert.equal((await runBlock(2, gm)).already, "set up", "SETUP runs twice");
      await expectPass(3);
      assert.match(results.lines3.join("\n"), /the saved tagCrafted setting holds a record/);
      await expectPass(4);
      assert.match(results.lines4.join("\n"), /Goblin A has the OLD condition/);
      await expectPass(5);
      await expectPass(6);
      await expectPass(7);
      assert.match(results.lines7.join("\n"), new RegExp(`removed the record by itself: ${cascade ? "yes" : "no"}`), "the answer about a deleted actor is printed");
      await expectPass(8);
      const nine = await play(9, "gm");
      assert.match(nine, /^HANDOFF: reload the GM window now/);
      assert.equal(reloads(), 1, "the runner's reload action ran after Step 9");
      assert.equal(globalThis.__g25, undefined, "the reload dropped the page's globals");
      await expectPass(10);
      await expectPass(11, "player");
      assert.match(results.lines11.join("\n"), /recorded, not judged: a Player client can read the tagCrafted world setting from the console: yes/);
      const clean = { problems: [], actorsLeft: 0, tokensLeft: 0, frozenLeft: 0, capsLeft: 0, downtimeOpen: false, flagLeft: false, audit: [] };
      assert.deepEqual(await runBlock(12, gm), clean);
      assert.deepEqual(await runBlock(12, gm), clean, "CLEANUP runs twice");
    });
    fake.restore();
    assert.equal(game.actors.getName("Gate G25 Hero"), undefined);
    assert.deepEqual(Object.keys(await as(gm, () => api.tags.ledger().items)), []);
    for (const [kind, id] of [["recipe", "g25-blade"], ["tag", "g25-bite"], ["material", "g25-fang"], ["material", "g25-iron"], ["station", "g25-bench"], ["town", "g25-town"]]) assert.equal(api.definitions[kind].has(id), false, `${kind} ${id} is gone`);
  });
}

test("GATE 25 Step 9 is a hand step without the runner's reload action: it returns the HANDOFF and Step 10 compares after a reload the person does", async () => {
  const { gm, fake, results, play, expectPass } = await playGate({ cascade: false, reload: false });
  await quietly(async () => {
    await runBlock(2, gm);
    await expectPass(3);
    assert.match(await play(9, "gm"), /^HANDOFF: reload the GM window now/);
    assert.ok(globalThis.__g25, "nothing reloaded: the globals are still there");
    delete globalThis.__g25; loadFrozen();         // the person reloads
    await expectPass(10);
    assert.match(results.lines10.join("\n"), /the stored setting is exactly what was saved before the reload/);
    await runBlock(12, gm);
  });
  fake.restore();
});
