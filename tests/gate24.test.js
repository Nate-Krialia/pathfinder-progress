/**
 * The tags stacking / caps / effects gate (docs/24-tags-effects-gate.md): every code block is extracted and run, in order, in a fake Foundry with a pretend compendium, items that carry a source, PF2e-like
 * actors and tokens, a fake chat log, and (as real Foundry does) a dotted key rewritten into nested objects when it is saved. The click steps are played from the shared script e2e/steps/gate24.steps.mjs on the
 * real Hub window. What it cannot show: what real PF2e does with the crafted weapon's rule elements, the real strike and damage roll, the real stack on a cancel.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { as, env, getApi, getUsers, makeActor, quietly, world } from "./fake-world.js";
import { asPage, seedRecords } from "./helpers.js";
import { installFakeApplication } from "./fake-application.js";
import script from "../e2e/steps/gate24.steps.mjs";
import { makeDomDriver, playStep } from "../e2e/driver-dom.mjs";

const gateDoc = readFileSync("docs/24-tags-effects-gate.md", "utf8");
const MODULE_VERSION = JSON.parse(readFileSync("module.json", "utf8")).version;
const GATE = new Map();
for (const match of gateDoc.matchAll(/^## Step (\d+) ((?:\[[^\]]+\](?: and )?)+)[^\n]*\n([\s\S]*?)(?=^## Step |^## Group |(?![\s\S]))/gm)) {
  const block = match[3].match(/```js\n([\s\S]*?)```/);
  GATE.set(Number(match[1]), { who: match[2], code: block?.[1] ?? null, text: match[3] });
}
function runBlock(step, user) {
  const entry = GATE.get(step);
  assert.ok(entry?.code, `docs/24-tags-effects-gate.md needs a code block in Step ${step}`);
  const code = entry.code.replace(/^(\/\/[^\n]*\n)*\s*await \(/, match => match.replace("await (", "("));
  return as(user, () => (0, eval)(code));
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const TORCH = "Compendium.pf2e.equipment-srd.Item.8Jdw4yAzWYylGePS", ROPE = "Compendium.pf2e.equipment-srd.Item.ROPEROPEROPEROPE", DAGGER = "Compendium.pf2e.equipment-srd.Item.DAGGERDAGGERDAGG";
const sink = async fn => {
  const lines = [], logged = console.log;
  console.log = (...args) => lines.push(args.map(String).join(" "));
  try { return { result: await fn(), lines: lines.join("\n").split("\n").filter(Boolean) }; } finally { console.log = logged; }
};
/** Expand every dotted key of a plain object into nested objects (arrays are left alone), the way Foundry expands the data of a save. */
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
  return item;
};
function fakePf2e() {
  const chat = [];
  const make = data => {
    const m = { id: `chat${++seq}`, timestamp: Date.now(), ...structuredClone(data), getFlag: (scope, key) => m.flags?.[scope]?.[key] };
    m.update = async changes => { for (const [path, value] of Object.entries(changes)) { const keys = path.split("."); let node = m; while (keys.length > 1) { node = node[keys[0]] ??= {}; keys.shift(); } node[keys[0]] = value; } };
    return m;
  };
  globalThis.ChatMessage = { create: async data => { const m = make(data); chat.push(m); return m; }, deleteDocuments: async ids => { for (const id of ids) chat.splice(chat.findIndex(m => m.id === id), 1); }, getSpeaker: () => ({}), getWhisperRecipients: () => [getUsers().gm] };
  Object.defineProperty(chat, "contents", { get: () => chat });
  game.messages = Object.assign(chat, { get: id => chat.find(m => m.id === id) });
  const docs = { [TORCH]: "Torch", [ROPE]: "Rope", [DAGGER]: "Dagger" };
  const compDoc = uuid => ({ name: docs[uuid], uuid, toObject: () => ({ name: docs[uuid], type: uuid === DAGGER ? "weapon" : "equipment", system: { quantity: 1, rules: [] }, flags: {}, _stats: { compendiumSource: null } }) });
  game.packs = { ...game.packs, get: id => (id === "pf2e.equipment-srd" ? { getIndex: async () => Object.entries(docs).map(([uuid, name]) => ({ name, _id: uuid.split(".").pop() })), getDocument: async docId => compDoc(`Compendium.pf2e.equipment-srd.Item.${docId}`) } : undefined) };
  game.items.fromCompendium = doc => ({ ...doc.toObject(), _stats: { compendiumSource: doc.uuid } });
  const baseCreate = Actor.create;
  Actor.create = async data => {
    const actor = pf2eify(await baseCreate(data));
    const embed = actor.createEmbeddedDocuments;
    actor.createEmbeddedDocuments = async (type, datas) => (await embed(type, datas)).map(item => decorate(item, actor));
    actor.changeCarryType = async (item, { carryType, handsHeld = 0 }) => { item.system.equipped = { ...(item.system.equipped ?? {}), carryType, handsHeld }; };
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
  game.settings.set = async (scope, key, value) => set(scope, key, ["tagLedger", "tagCaps", "tagCrafted", "sharedCompendium"].includes(key) ? expandDots(value) : value);
  return { chat, scene, restore: () => { game.settings.set = set; } };
}

test("the tags stacking, caps and effects gate doc: steps are labelled, bullets are short, the standing format holds", () => {
  assert.deepEqual([...GATE.keys()], Array.from({ length: 11 }, (_, i) => i + 1));
  const PLAYER = [10];
  for (const [step, entry] of GATE) {
    assert.match(entry.who, step === 1 ? /^\[GM\] and \[Player\]\s*$/ : PLAYER.includes(step) ? /^\[Player\]\s*$/ : /^\[GM\]\s*$/, `step ${step} says who runs it`);
    assert.ok(entry.code, `step ${step} has a code block`);
    assert.equal((entry.text.match(/```js/g) ?? []).length, 1, `step ${step} has ONE code block`);
    // The standing format (CLAUDE.md): a short bullet list, one action per bullet; what to see is its own bullet starting "You should see:".
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
  assert.match(gateDoc, /several real copies that share one compendium source/);
  assert.ok(GATE.get(8).text.includes("what a cancel does to a stack"), "Step 8 says it prints what a cancel does to a stack");
  assert.doesNotMatch(gateDoc.replace(/DC\b[^\n]*never/gi, ""), /\bDC \d|odds of|\d+% chance/i, "the gate text itself never talks about difficulty to a player");
  // every check in a block prints what it compared: its line carries a detail (a JSON dump, a named value or a template)
  for (const [step, { code }] of GATE) if (step > 1) for (const line of code.split("\n").filter(l => /\bg\.check\(|\bcheck\(/.test(l) && !/const check|const g = /.test(l))) assert.match(line, /JSON\.stringify|\bvalues\b|\bdetail\b|\$\{|stored\b|show\(|out\.message|\w+Text\b|\.slice\(/, `step ${step}: a check prints what it compared: ${line.trim().slice(0, 90)}`);
});

test("the steps file obeys the runner's rules and picks by stable ids and names, never by position", () => {
  const source = readFileSync("e2e/steps/gate24.steps.mjs", "utf8");
  assert.doesNotMatch(source, /\bimport\b|require\(|process\.|fetch\(|eval\(|new Function|nth-child/, "no import, require, process, fetch, eval or Function");
  assert.deepEqual(Object.keys(script), ["before"]);
  assert.deepEqual(Object.keys(script.before), ["4", "5", "6", "7", "8", "9"]);
  for (const need of [/data-recipe="g24-blade"/, /data-station="g24-bench"/, /data-slot="edge"/, /data-slot="charm"/, /degrees:/, /damageFormula/]) assert.match(source, need);
});

test("GATE 24: SETUP, tag, craft with stacked numbers, the damage formula, two caps, a cancel, the Strikes, the player's leak scan, CLEANUP twice", async () => {
  await world({ downtime: 0, iron: 0, fang: 0, perClientDefinitions: true });
  const { gm, testUser } = getUsers();
  const api = getApi();
  api.baseSources = seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }));
  api.editorLeftovers = [];
  installFakeApplication();
  const { chat, scene, restore } = fakePf2e();
  gm.targets = new Set(); testUser.targets = new Set();
  const hero = () => game.actors.getName("Gate G24 Hero");
  const tok = name => scene.tokens.find(t => t.name === name);
  let strikeTarget = "Gate G24 Goblin A", formulaCalls = 0;
  const attackAs = (outcome, itemName, target) => {
    const item = hero().items.find(i => i.name === itemName), t = tok(target);
    return { id: `real${++seq}`, flags: { pf2e: { context: { type: "attack-roll", outcome, target: { token: t.uuid, actor: `${t.uuid}.Actor.${t.actorId}` }, origin: { actor: `Actor.${hero().id}`, token: tok("Gate G24 Hero").uuid }, action: "strike", identifier: `${item.id}.dagger.melee` }, origin: { actor: `Actor.${hero().id}`, uuid: item.uuid, type: "weapon" } } }, author: { targets: new Set([{ document: t }]) } };
  };
  const extras = {
    selectToken: async name => { canvas.tokens.controlled = [tok(name)]; gm.targets = new Set(); },
    targetTokens: async (who, names) => { const set = new Set(names.map(n => ({ document: tok(n) }))); if (who === "gm") gm.targets = set; else { testUser.targets = new Set(names.map(n => tok(n))); strikeTarget = names[0] ?? strikeTarget; } },
    strike: async (outcome, itemName) => { const m = attackAs(outcome, itemName, strikeTarget); chat.push({ ...m, getFlag: () => undefined, content: "PF2e attack card" }); return api.effects.handle(m); },
    pressApply: async (match, { degrees } = {}) => {
      const card = chat.filter(m => m.getFlag?.("pathfinder-progress", "fx")?.state === "pending" && new RegExp(match).test(m.getFlag("pathfinder-progress", "fx").text)).at(-1);
      assert.ok(card, `a pending card matching "${match}" is there`);
      for (const [name, result] of Object.entries(degrees ?? {})) tok(name).actor.degree = { criticalFailure: 0, failure: 1, success: 2, criticalSuccess: 3 }[result];
      assert.equal((await api.effects.applyCard(card.id)).ok, true);
    },
    damageFormula: async (tokenName, itemName) => {
      formulaCalls++;
      const rules = hero().items.find(i => i.name === itemName).toObject().system.rules.filter(r => r.key === "DamageDice");
      return rules.map(r => `${r.diceNumber}${r.dieSize} ${r.damageType}`).join(" + ");
    }
  };
  const base = { drivers: { gm: makeDomDriver({ as, user: gm }), player: makeDomDriver({ as, user: testUser }) }, state: {}, assert, wait, extras };
  const results = {};
  const play = async (n, who) => { const out = await sink(() => playStep({ script, n, who, base, runBlock: async () => { results[n] = await runBlock(n, who === "player" ? testUser : gm); } })); results[`lines${n}`] = out.lines; return results[n]; };
  const expectPass = async (n, who) => assert.equal(await play(n, who), "ALL PASS", `step ${n}:\n${results[`lines${n}`].join("\n")}`);
  await quietly(async () => {
    assert.deepEqual(await runBlock(1, gm), ["GM", true, MODULE_VERSION, true]);
    const setup = await runBlock(2, gm);
    assert.equal(setup.planted.length, 8);
    assert.equal(setup.tokens, 3);
    assert.equal(game.users.getName("Test").character?.name, "Gate G24 Hero");
    assert.equal((await runBlock(2, gm)).already, "set up", "SETUP runs twice");
    assert.deepEqual(await as(gm, () => api.tags.ledger().items), {}, "nothing is tagged before Step 3");
    await expectPass(3, "gm");
    assert.match(results.lines3.join("\n"), /copiesSharingTheEdgeSource":\["Gate G24 Torch Stack x3","Gate G24 Torch Single x1"\]/);
    await as(testUser, () => api.definitions.refresh({ force: true }));
    await expectPass(4, "gm");
    assert.match(results.lines4.join("\n"), /which copies were escrowed.*"Gate G24 Torch Stack"/, "the first copy sharing the Torch source was escrowed");
    assert.match(results.lines4.join("\n"), /"copiesStillInTheBag":\{"torch":2,"rope":2\}/);
    await expectPass(5, "gm");
    // a weapon that is not held is a clean FAIL in Steps 5 and 9 (carryType, isEquipped and each rule's ignored state printed), not a TypeError
    const weapon = hero().items.find(i => i.name === "Gate G24 Blade");
    assert.deepEqual([weapon.system.equipped.carryType, weapon.system.equipped.handsHeld, weapon.isEquipped], ["held", 1, true], "Step 4 held the weapon");
    await hero().changeCarryType(weapon, { carryType: "worn", handsHeld: 0 });
    for (const step of [5, 9]) {
      const unheld = await sink(() => runBlock(step, gm));
      assert.match(unheld.result, /FAILED/, `step ${step} fails cleanly on an unheld weapon`);
      const line = unheld.lines.find(l => /^FAIL: the weapon is (still )?held/.test(l));
      assert.ok(line, `step ${step} says the weapon is not held: ${unheld.lines.join(" | ")}`);
      assert.match(line, /"carryType":"worn".*"isEquipped":false.*"ignored":true/, `step ${step} prints carryType, isEquipped and each rule's ignored state`);
    }
    await hero().changeCarryType(weapon, { carryType: "held", handsHeld: 1 });
    assert.equal(formulaCalls, 1);
    assert.match(results.lines5.join("\n"), /strike's damage formula shows/);
    await expectPass(6, "gm");
    await expectPass(7, "gm");
    await expectPass(8, "gm");
    assert.match(results.lines8.join("\n"), /what a cancel did to the copies sharing a source/);
    await expectPass(9, "gm");
    await expectPass(10, "player");
    const clean = { problems: [], actorsLeft: 0, tokensLeft: 0, frozenLeft: 0, ledgerLeft: 0, capsLeft: 0, downtimeOpen: false, sharedLeft: 0, flagLeft: false, audit: [] };
    assert.deepEqual(await runBlock(11, gm), clean);
    assert.deepEqual(await runBlock(11, gm), clean, "CLEANUP runs twice");
    await as(testUser, () => foundry.applications.instances.get("pathfinder-progress-hub")?.close());
  });
  restore();
  assert.equal(game.actors.getName("Gate G24 Hero"), undefined);
  assert.deepEqual(Object.keys(await as(gm, () => api.tags.ledger().items)), [], "the tags are off again");
  assert.deepEqual(Object.keys(await as(gm, () => api.tags.caps().table?.roles ?? {})), [], "the caps are back");
  for (const [kind, id] of [["recipe", "g24-blade"], ["tag", "g24-fang"], ["tag", "g24-venom"], ["material", "g24-iron"], ["station", "g24-bench"], ["town", "g24-town"]]) assert.equal(api.definitions[kind].has(id), false, `${kind} ${id} is gone`);
  void env;
});
