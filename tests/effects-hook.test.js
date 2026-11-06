/**
 * Effects that act on a target (v0.22.0), the hook half: PF2e 8.6.1's message shapes as the real-Foundry probe recorded them
 * (docs/probes/11d-targets-probe.md, Results), the real adapter file over a fake world, the card, Apply and the secrecy of the save.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as adapter from "../scripts/adapter/pf2e-effects.js";
import { createEffects } from "../scripts/effects/hook.js";
import { findLeaks, EFFECT_SECRET_KEYS, LEAK_WORDS } from "../scripts/effects/plain.js";
import { levelDC } from "../scripts/adapter/pf2e.js";
import { EFFECTS } from "../scripts/config.js";
import { loadDefinitions } from "../scripts/data/validate.js";
import { CHAT_LEAK, asPage } from "./helpers.js";

const M = "pathfinder-progress";
const MITFLIT = { kind: "material", id: "g21-mitflit", name: "Gate G21 Mitflit", tier: 2, effects: { basePower: "T1" }, classEffects: { weapon: { applyCondition: [{ condition: "frightened", value: 1, save: "will" }, { condition: "prone", save: "none" }] }, bomb: { applyCondition: [{ condition: "sickened", value: 2, save: "fortitude" }] }, consumable: { applyCondition: [{ condition: "dazzled", save: "reflex" }] } } };
const IRON = { kind: "material", id: "g21-iron", name: "Gate G21 Iron", tier: 1, effects: { basePower: "T1" } };
const OUT = { 1: "Compendium.pf2e.equipment-srd.Item.AAAAAAAAAAAAAAAA", 2: "Compendium.pf2e.equipment-srd.Item.AAAAAAAAAAAAAAAA", 3: "Compendium.pf2e.equipment-srd.Item.AAAAAAAAAAAAAAAA" };
const recipe = (id, category, extra = {}) => ({ kind: "recipe", id, name: id, category, output: OUT, craftLevel: 5, slots: [{ name: "blade", drives: "basePower", tierFloor: 1, qty: 1 }, { name: "fang", drives: ["applyCondition"], tierFloor: 2, qty: 1 }], stationCategory: "smithing", stationTierMin: 1, skillWhitelist: ["crafting"], researchProject: { tier: 1 }, ...extra });
const registry = () => {
  const r = loadDefinitions([MITFLIT, IRON, recipe("g21-sword", "weapon"), recipe("g21-bomb", "bomb"), recipe("g21-potion", "consumable")].map((d, i) => ({ pack: "t", entry: `e${i}`, text: asPage(d) })));
  assert.deepEqual(r.errors, []);
  return r.registry;
};
const flagFor = recipeId => ({ recipeId, materials: [{ slot: "fang", materialId: "g21-mitflit", units: 1 }] });

// A fake world: actors with PF2e's condition semantics (increaseCondition ADDS, the cap is max), saves that return a chosen degree, items, tokens.
let seq = 0;
function actorOf(name, { degree = 1 } = {}) {
  const conds = new Map(), items = new Map(), a = { name, id: `A${++seq}`, items, conds, rolls: [] };
  a.getCondition = slug => (conds.has(slug) ? { slug, value: conds.get(slug) } : null);
  a.increaseCondition = async (slug, { value = 1, max = Infinity } = {}) => { const had = conds.get(slug); if (had === null) return null; conds.set(slug, ["prone", "off-guard", "dazzled", "fatigued"].includes(slug) ? null : Math.min((had ?? 0) + value, max)); return a.getCondition(slug); };
  a.decreaseCondition = async (slug, { forceRemove = false } = {}) => { if (forceRemove) conds.delete(slug); else if (conds.get(slug) > 1) conds.set(slug, conds.get(slug) - 1); else conds.delete(slug); };
  a.saves = Object.fromEntries(["will", "fortitude", "reflex"].map(type => [type, { check: { roll: async opts => { a.rolls.push([type, opts]); return { total: 12, options: { degreeOfSuccess: a.degree }, dice: [{ faces: 20, results: [{ result: 7, active: true }] }] }; } } }]));
  a.degree = degree;
  return a;
}
const documents = new Map();
const addItem = (actor, id, name, flag) => { const item = { id, name, uuid: `Actor.${actor.id}.Item.${id}`, getFlag: (scope, key) => (flag && scope === M && key === "crafted" ? structuredClone(flag) : undefined) }; actor.items.set(id, item); documents.set(item.uuid, item); return item; };
function token(name, actor, linked = false) {
  const t = { name, uuid: `Scene.S.Token.${name.replace(/\W/g, "")}`, actor, document: null };
  t.document = t; documents.set(t.uuid, t);
  if (linked) documents.set(`Actor.${actor.id}`, actor);
  return t;
}
globalThis.fromUuid = async uuid => documents.get(uuid) ?? null;
globalThis.game = { user: { targets: new Set() } };

function chatWorld() {
  const messages = new Map(), log = [], warnings = [];
  const make = data => {
    const m = { id: `M${++seq}`, ...structuredClone(data), getFlag: (scope, key) => m.flags?.[scope]?.[key] };
    m.update = async changes => { for (const [path, value] of Object.entries(changes)) { const keys = path.split("."); let node = m; while (keys.length > 1) { node = node[keys[0]] ??= {}; keys.shift(); } node[keys[0]] = value; } };
    return m;
  };
  const chat = { create: async data => { const m = make(data); messages.set(m.id, m); return m; }, get: id => messages.get(id), gmIds: () => ["GM1"] };
  return { messages, log, warnings, chat, all: () => [...messages.values()] };
}
function setup() {
  const w = chatWorld();
  let clock = 1000;
  const effects = createEffects({ adapter, registry, chat: w.chat, log: e => w.log.push(e), levelDC, notify: { warn: t => w.warnings.push(t), info() {} }, now: () => clock });
  return { ...w, effects, tick: ms => { clock += ms; } };
}

// The probe's shapes ---------------------------------------------------------------------------------------------------
function attackMessage({ actor, tokenUuid, itemId, outcome, target, authorTargets = [], originUuid }) {
  return {
    id: `P${++seq}`, flags: { pf2e: { context: { type: "attack-roll", outcome, target: target ? { token: target.uuid, actor: `${target.uuid}.Actor.Z` } : undefined, origin: { actor: `Actor.${actor.id}`, token: tokenUuid }, action: "strike", identifier: `${itemId}.longsword.melee` }, origin: { actor: `Actor.${actor.id}`, uuid: originUuid ?? `Actor.${actor.id}.Item.${itemId}`, type: "weapon" } } },
    author: { targets: new Set(authorTargets.map(t => ({ document: t }))) }
  };
}
const damageMessage = (a, id, target) => ({ id: `P${++seq}`, flags: { pf2e: { context: { type: "damage-roll", outcome: "success", target: { token: target.uuid }, origin: { actor: `Actor.${a.id}`, token: "x" } }, target: { token: target.uuid }, origin: { actor: `Actor.${a.id}`, uuid: `Actor.${a.id}.Item.${id}`, type: "weapon" } } }, author: { targets: new Set() } });
const consumableMessage = (a, id, authorTargets = []) => ({ id: `P${++seq}`, flags: { pf2e: { origin: { actor: `Actor.${a.id}`, uuid: `Actor.${a.id}.Item.${id}`, type: "consumable" } } }, author: { targets: new Set(authorTargets.map(t => ({ document: t }))) } });
const plainMessage = id => ({ id: `P${++seq}`, flags: {}, author: { targets: new Set() }, content: "hello", item: null, _id: id });

test("readMessage reads the probe's shapes: attack, damage, the first consumable card, and everything else", () => {
  const hero = actorOf("Hero"), goblin = token("Goblin A", actorOf("Goblin A"));
  const attack = adapter.readMessage(attackMessage({ actor: hero, tokenUuid: "Scene.S.Token.Hero", itemId: "I1", outcome: "success", target: goblin }));
  assert.equal(attack.kind, "attack"); assert.equal(attack.outcome, "success"); assert.equal(attack.itemId, "I1"); assert.equal(attack.targetTokenUuid, goblin.uuid); assert.equal(attack.tokenUuid, "Scene.S.Token.Hero");
  assert.equal(adapter.readMessage(damageMessage(hero, "I1", goblin)).kind, "damage");
  assert.equal(adapter.readMessage(consumableMessage(hero, "C1")).kind, "consumable");
  assert.equal(adapter.readMessage(plainMessage("x")).kind, "none");
  assert.equal(adapter.readMessage(null).kind, "none");
  assert.equal(adapter.readMessage({ flags: { pf2e: { context: { type: "spell-cast" }, origin: { uuid: "Actor.a.Item.s", type: "spell" } } } }).kind, "other");
  assert.equal(adapter.readMessage({ get flags() { throw new Error("PF2e drift"); } }).kind, "other", "a message that cannot be read never throws");
});

test("a weapon hit: one whisper card to the GM with the target's name and plain words, ids only in the flag; a miss, a damage roll and a plain message give nothing", async () => {
  const t = setup();
  const hero = actorOf("Hero"), gob = token("Goblin A", actorOf("Goblin A"));
  addItem(hero, "I1", "Mitflit Fang", flagFor("g21-sword"));
  const hit = attackMessage({ actor: hero, tokenUuid: "Scene.S.Token.Hero", itemId: "I1", outcome: "success", target: gob });
  const card = await t.effects.onMessage(hit);
  assert.equal(card.whisper[0], "GM1");
  assert.match(card.content, /Mitflit Fang hit Goblin A: makes the target fearful and knocks the target down\./);
  assert.deepEqual(card.flags[M].fx.targets, [gob.uuid]); assert.deepEqual(card.flags[M].fx.effects, [0, 1]); assert.equal(card.flags[M].fx.state, "pending");
  assert.doesNotMatch(card.content + JSON.stringify(card.flags), LEAK_WORDS);
  assert.deepEqual(findLeaks(card, "$", EFFECT_SECRET_KEYS), []);
  assert.equal(await t.effects.onMessage(hit), null, "the same message twice is one card");
  assert.equal(await t.effects.onMessage(attackMessage({ actor: hero, tokenUuid: "Scene.S.Token.Hero", itemId: "I1", outcome: "failure", target: gob })), null, "a miss");
  assert.equal(await t.effects.onMessage(attackMessage({ actor: hero, tokenUuid: "Scene.S.Token.Hero", itemId: "I1", outcome: "criticalFailure", target: gob })), null);
  assert.equal(await t.effects.onMessage(damageMessage(hero, "I1", gob)), null, "a damage roll is never a trigger");
  assert.equal(await t.effects.onMessage(plainMessage("x")), null);
  assert.equal(t.all().length, 1);
});

test("a bomb: any outcome except a critical failure gives a card, a miss says so", async () => {
  const t = setup();
  const hero = actorOf("Hero"), gob = token("Goblin A", actorOf("Goblin A"));
  addItem(hero, "B1", "Mitflit Bomb", flagFor("g21-bomb"));
  const shot = outcome => attackMessage({ actor: hero, tokenUuid: "Scene.S.Token.Hero", itemId: "B1", outcome, target: gob });
  assert.match((await t.effects.onMessage(shot("failure"))).content, /missed Goblin A, but you can still apply it: makes the target sick\./);
  assert.match((await t.effects.onMessage(shot("success"))).content, /Mitflit Bomb hit Goblin A/);
  assert.equal(await t.effects.onMessage(shot("criticalFailure")), null);
});

test("a consumable: ONE card for the first use card (the second within ~10 s is the same use), targets from the roller's targets, no targets = the fallback card", async () => {
  const t = setup();
  const hero = actorOf("Hero"), a = token("Goblin A", actorOf("Goblin A")), b = token("Goblin B", actorOf("Goblin B"));
  addItem(hero, "C1", "Mitflit Draught", flagFor("g21-potion"));
  const first = await t.effects.onMessage(consumableMessage(hero, "C1", [a, b]));
  assert.match(first.content, /Mitflit Draught was used on Goblin A and Goblin B: /);
  assert.deepEqual(first.flags[M].fx.targets, [a.uuid, b.uuid], "a two-target case: both are on the card");
  t.tick(4000);
  assert.equal(await t.effects.onMessage(consumableMessage(hero, "C1", [a, b])), null, "Use pressed on the card posts a second consumable message: no second card");
  t.tick(7000);
  const again = await t.effects.onMessage(consumableMessage(hero, "C1", []));
  assert.equal(again.flags[M].fx.fallback, true, "a later use with no one targeted is the fallback card");
  assert.deepEqual(again.flags[M].fx.targets, []);
  assert.match(again.content, /no one is targeted/);
  assert.equal(t.all().length, 2);
});

test("two consumable cards that arrive together (no await between them) make exactly ONE card", async () => {
  const t = setup();
  const hero = actorOf("Hero"), a = token("Goblin A", actorOf("Goblin A"));
  addItem(hero, "C1", "Mitflit Draught", flagFor("g21-potion"));
  const [one, two] = await Promise.all([t.effects.onMessage(consumableMessage(hero, "C1", [a])), t.effects.onMessage(consumableMessage(hero, "C1", [a]))]);
  assert.equal([one, two].filter(Boolean).length, 1, JSON.stringify({ first: Boolean(one), second: Boolean(two), cards: t.all().length }));
  assert.equal(t.all().length, 1, "one card in the chat");
});

test("a second Use AFTER the 10 second window is a second use: a second card (the window is EFFECTS.dedupeMs)", async () => {
  const t = setup();
  const hero = actorOf("Hero"), a = token("Goblin A", actorOf("Goblin A"));
  addItem(hero, "C1", "Mitflit Draught", flagFor("g21-potion"));
  assert.ok(await t.effects.onMessage(consumableMessage(hero, "C1", [a])));
  t.tick(EFFECTS.dedupeMs - 1);
  assert.equal(await t.effects.onMessage(consumableMessage(hero, "C1", [a])), null, "just inside the window: the same use");
  t.tick(EFFECTS.dedupeMs + 1);
  assert.ok(await t.effects.onMessage(consumableMessage(hero, "C1", [a])), "after the window: a new use, a new card");
  assert.equal(t.all().length, 2);
});

test("a fallback card with two GM targets and mixed saves: only the one that fails gets the condition, the other's line says it shrugs it off", async () => {
  const t = setup();
  const hero = actorOf("Hero"), failer = actorOf("Goblin A", { degree: 1 }), passer = actorOf("Goblin B", { degree: 2 });
  addItem(hero, "C1", "Mitflit Draught", flagFor("g21-potion"));
  const card = await t.effects.onMessage(consumableMessage(hero, "C1", []));
  assert.equal(card.flags[M].fx.fallback, true);
  game.user.targets = new Set([{ document: token("Goblin A", failer) }, { document: token("Goblin B", passer) }]);
  const out = await t.effects.applyCard(card.id);          // no forceDegree: each goblin's own save is rolled, A fails and B passes
  game.user.targets = new Set();
  const text = card.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const seen = JSON.stringify({ ok: out.ok, results: out.results, text: text.slice(-160), a: [...failer.conds], b: [...passer.conds] });
  assert.equal(out.ok, true, seen);
  assert.ok(failer.conds.has("dazzled") && !passer.conds.has("dazzled"), seen);
  assert.match(text, /Goblin A is dazzled\./, seen);
  assert.match(text, /Goblin B shrugs it off\./, seen);
  assert.deepEqual(failer.rolls.map(r => r[0]), ["reflex"]); assert.deepEqual(passer.rolls.map(r => r[0]), ["reflex"]);
});

test("an unlinked token: the item is found through the token's actor (origin.uuid points at the world actor's item), and the condition lands on the token's actor", async () => {
  const t = setup();
  const world = actorOf("Hero (world)"), synthetic = actorOf("Hero (token)");
  addItem(world, "I1", "Plain Sword", null);                                        // origin.uuid resolves to THIS one: no crafted flag
  addItem(synthetic, "I1", "Mitflit Fang", flagFor("g21-sword"));                  // the token's own item carries the flag
  const hero = token("Hero", synthetic);
  const targetWorld = actorOf("Goblin (world)"), targetSynthetic = actorOf("Goblin (token)", { degree: 1 });
  const gob = token("Goblin U", targetSynthetic);
  const msg = attackMessage({ actor: world, tokenUuid: hero.uuid, itemId: "I1", outcome: "success", target: gob, originUuid: `Actor.${world.id}.Item.I1` });
  const card = await t.effects.onMessage(msg);
  assert.ok(card, "found through the token first");
  assert.equal(card.flags[M].fx.itemUuid, `Actor.${synthetic.id}.Item.I1`);
  const result = await t.effects.applyCard(card.id, { forceDegree: "failure" });
  assert.equal(result.ok, true);
  assert.equal(targetSynthetic.conds.get("frightened"), 1, "on the token's actor");
  assert.equal(targetWorld.conds.size, 0, "never the world actor");
});

test("an unknown message about a crafted item (and a parse failure) gives the fallback card; a non-crafted item gives nothing", async () => {
  const t = setup();
  const hero = actorOf("Hero");
  const item = addItem(hero, "I1", "Mitflit Fang", flagFor("g21-sword"));
  addItem(hero, "I2", "Ordinary Sword", null);
  const spell = { id: "P9", flags: { pf2e: { context: { type: "spell-cast" }, origin: { actor: `Actor.${hero.id}`, uuid: item.uuid, type: "spell" } } }, author: { targets: new Set() } };
  const fallback = await t.effects.onMessage(spell);
  assert.equal(fallback.flags[M].fx.fallback, true);
  assert.match(fallback.content, /could not place/);
  // a weapon attack whose outcome PF2e changed the name of: the fallback, not silence
  const odd = attackMessage({ actor: hero, tokenUuid: "x", itemId: "I1", outcome: "kaboom", target: token("G", actorOf("G")) });
  assert.equal((await t.effects.onMessage(odd)).flags[M].fx.fallback, true);
  assert.equal(await t.effects.onMessage(attackMessage({ actor: hero, tokenUuid: "x", itemId: "I2", outcome: "success", target: token("G2", actorOf("G2")) })), null);
  // something throws after the item is known: still a fallback card
  const broken = createEffects({ adapter: { ...adapter, authorTargets() { throw new Error("targets API drifted"); } }, registry, chat: t.chat, log() {}, levelDC, notify: { warn() {} } });
  const hit = { ...attackMessage({ actor: hero, tokenUuid: "x", itemId: "I1", outcome: "success" }), item };
  const card = await broken.onMessage(hit);
  assert.equal(card.flags[M].fx.fallback, true);
});

test("Apply: the save is rolled on the TARGET's actor with the item's craft-level DC, secretly; nothing in chat carries a DC or a total; the GM log has them", async () => {
  const t = setup();
  const hero = actorOf("Hero"), gobActor = actorOf("Goblin A", { degree: 1 });
  addItem(hero, "I1", "Mitflit Fang", flagFor("g21-sword"));
  const gob = token("Goblin A", gobActor);
  const card = await t.effects.onMessage(attackMessage({ actor: hero, tokenUuid: "x", itemId: "I1", outcome: "success", target: gob }));
  const result = await t.effects.applyCard(card.id);
  assert.equal(result.ok, true);
  assert.equal(gobActor.rolls.length, 1, "one save: prone has none");
  assert.deepEqual(gobActor.rolls[0], ["will", { dc: { value: levelDC(5) }, skipDialog: true, createMessage: false }], "the recipe's craft level 5 through the PF2e level-DC table, no chat card");
  assert.equal(gobActor.conds.get("frightened"), 1); assert.ok(gobActor.conds.has("prone"));
  assert.match(card.content, /Goblin A is fearful, is knocked down\./); assert.doesNotMatch(card.content, /data-pfp-fx/);
  assert.equal(card.flags[M].fx.state, "done");
  assert.equal(CHAT_LEAK.test(JSON.stringify(t.all())), false, "no chat message carries a DC, a total or odds");
  assert.doesNotMatch(JSON.stringify(t.all()), /Will|Fortitude|Reflex/i);
  assert.ok(t.log[0].text.includes(`will save vs DC ${levelDC(5)}: failure (total 12)`));
  assert.equal((await t.effects.applyCard(card.id)).ok, false, "a handled card cannot be applied again");
});

test("a save that succeeds shrugs it off; a critical failure raises the value by one; the cap and an existing higher value are respected; Skip works", async () => {
  const t = setup();
  const hero = actorOf("Hero");
  addItem(hero, "I1", "Mitflit Fang", flagFor("g21-sword"));
  const fresh = async (degree, before) => {
    const actor = actorOf("G", { degree });
    for (const [slug, v] of Object.entries(before ?? {})) actor.conds.set(slug, v);
    const card = await t.effects.onMessage(attackMessage({ actor: hero, tokenUuid: "x", itemId: "I1", outcome: "success", target: token(`G${++seq}`, actor) }));
    await t.effects.applyCard(card.id);
    return { actor, card };
  };
  assert.equal((await fresh(2)).actor.conds.get("frightened"), undefined, "success: no effect");
  assert.equal((await fresh(3)).actor.conds.get("frightened"), undefined, "critical success: no effect");
  assert.equal((await fresh(0)).actor.conds.get("frightened"), 2, "critical failure: value + 1");
  assert.equal((await fresh(1, { frightened: 3 })).actor.conds.get("frightened"), 3, "never lowered, never stacked");
  assert.equal((await fresh(0, { frightened: 4 })).actor.conds.get("frightened"), 4, "capped at 4");
  const shrug = await fresh(2);
  assert.match(shrug.card.content, /Goblin|G\d+ shrugs it off, is knocked down/, "a no-save condition still applies");
  const hit = await t.effects.onMessage(attackMessage({ actor: hero, tokenUuid: "x", itemId: "I1", outcome: "success", target: token("GS", actorOf("GS")) }));
  assert.equal((await t.effects.skipCard(hit.id)).ok, true);
  assert.match(hit.content, /Skipped\./); assert.equal(hit.flags[M].fx.state, "skipped");
});

test("Apply twice at once rolls once (the card is in flight); the adapter can also remove the condition again", async () => {
  const t = setup();
  const hero = actorOf("Hero"), actor = actorOf("G");
  addItem(hero, "I1", "Mitflit Fang", flagFor("g21-sword"));
  const card = await t.effects.onMessage(attackMessage({ actor: hero, tokenUuid: "x", itemId: "I1", outcome: "success", target: token("GG", actor) }));
  const [a, b] = await Promise.all([t.effects.applyCard(card.id), t.effects.applyCard(card.id)]);
  assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
  assert.equal(actor.rolls.length, 1);
  assert.equal(await adapter.removeCondition(actor, "frightened"), true);
  assert.equal(actor.getCondition("frightened"), null);
  assert.equal(await adapter.removeCondition(actor, "frightened"), false);
});

test("a fallback card applies to the GM's own targets, and says so when there are none", async () => {
  const t = setup();
  const hero = actorOf("Hero"), actor = actorOf("G");
  addItem(hero, "C1", "Mitflit Draught", flagFor("g21-potion"));
  const card = await t.effects.onMessage(consumableMessage(hero, "C1", []));
  game.user.targets = new Set();
  globalThis.canvas = { tokens: { controlled: [] } };
  assert.equal((await t.effects.applyCard(card.id)).ok, false);
  assert.match(t.warnings[0], /Target or select a token first/);
  assert.equal(card.flags[M].fx.state, "pending", "the card is still usable");
  game.user.targets = new Set([{ document: token("Picked", actor) }]);
  assert.equal((await t.effects.applyCard(card.id, { forceDegree: "failure" })).ok, true);
  assert.ok(actor.conds.has("dazzled"));
  game.user.targets = new Set();
});

test("the card's buttons: drawn and wired for a GM while pending, disabled when handled, removed for a player", async () => {
  const t = setup();
  const hero = actorOf("Hero"), actor = actorOf("G");
  addItem(hero, "I1", "Mitflit Fang", flagFor("g21-sword"));
  const card = await t.effects.onMessage(attackMessage({ actor: hero, tokenUuid: "x", itemId: "I1", outcome: "success", target: token("GB", actor) }));
  const html = () => new JSDOM(`<div>${card.content}</div>`).window.document.body.firstElementChild;
  let root = html();
  t.effects.onRender(card, root, { isGM: true });
  const [apply, skip] = [...root.querySelectorAll("button")];
  assert.equal(apply.disabled, false);
  apply.dispatchEvent(new root.ownerDocument.defaultView.Event("click"));
  assert.equal(apply.disabled && skip.disabled, true, "both buttons are off at once, while the roll is in flight");
  await new Promise(r => setTimeout(r, 20));
  assert.equal(card.flags[M].fx.state, "done");
  assert.equal(html().querySelectorAll("button").length, 0, "the result replaces the buttons");
  const busy = await t.effects.onMessage(attackMessage({ actor: hero, tokenUuid: "x", itemId: "I1", outcome: "success", target: token("GC", actorOf("GC")) }));
  await busy.update({ [`flags.${M}.fx.state`]: "working" });
  const working = new JSDOM(`<div>${busy.content}</div>`).window.document.body.firstElementChild;
  t.effects.onRender(busy, working, { isGM: true });
  assert.deepEqual([...working.querySelectorAll("button")].map(b => b.disabled), [true, true], "a card being handled is disabled");
  const player = new JSDOM(`<div>${busy.content}</div>`).window.document.body.firstElementChild;
  t.effects.onRender(busy, player, { isGM: false });
  assert.equal(player.querySelectorAll("button").length, 0);
});
