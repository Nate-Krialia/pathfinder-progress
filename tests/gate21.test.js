/**
 * The Stage 11d effects gate (docs/21-stage11d-effects-gate.md): every code block is extracted and run, in order, in a fake Foundry. The click steps are played by real
 * clicks on the real item editor window (strict ApplicationV2 stand-in, jsdom). The real-Foundry steps (12 to 24) are played by feeding the hook the message shapes the
 * probe recorded (docs/probes/11d-targets-probe.md) exactly as the createChatMessage hook would, and pressing Apply through the card's own api; the blocks then run
 * against what that left in the chat and on the actors.
 * What it cannot show, and the person must in real Foundry: a real Strike, a real item Use, PF2e's real save roll, the real chat log and the real token canvas.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { M, as, env, getApi, getUsers, quietly, world } from "./fake-world.js";
import { asPage, seedRecords } from "./helpers.js";
import { installFakeApplication } from "./fake-application.js";
import script from "../e2e/steps/gate21.steps.mjs";
import { makeDomDriver, playStep } from "../e2e/driver-dom.mjs";

const gateDoc = readFileSync("docs/21-stage11d-effects-gate.md", "utf8");
const MODULE_VERSION = JSON.parse(readFileSync("module.json", "utf8")).version;
const GATE = new Map();
for (const match of gateDoc.matchAll(/^## Step (\d+) ((?:\[[^\]]+\](?: and )?)+)[^\n]*\n([\s\S]*?)(?=^## Step |(?![\s\S]))/gm)) {
  const block = match[3].match(/```js\n([\s\S]*?)```/);
  GATE.set(Number(match[1]), { who: match[2], code: block?.[1] ?? null, text: match[3] });
}
function runBlock(step, user) {
  const entry = GATE.get(step);
  assert.ok(entry?.code, `docs/21-stage11d-effects-gate.md needs a code block in Step ${step}`);
  const code = entry.code.replace(/^(\/\/[^\n]*\n)*\s*await \(/, match => match.replace("await (", "("));
  return as(user, () => (0, eval)(code));
}
const wait = ms => new Promise(r => setTimeout(r, ms));

// A fake PF2e: conditions that behave as the probe found (increaseCondition ADDS, max caps, a valueless one already there gives null), saves with a chosen degree, a scene with tokens.
let seq = 0;
function pf2eify(actor) {
  const conds = new Map();
  Object.assign(actor, { conds, degree: 1, saveRolls: [] });
  actor.getCondition = slug => (conds.has(slug) ? { slug, value: conds.get(slug) } : null);
  actor.increaseCondition = async (slug, { value = 1, max = Infinity } = {}) => {
    const valueless = ["prone", "off-guard", "dazzled", "fatigued"].includes(slug), had = conds.get(slug);
    if (valueless) { if (conds.has(slug)) return null; conds.set(slug, null); return actor.getCondition(slug); }
    conds.set(slug, Math.min((had ?? 0) + value, max));
    return actor.getCondition(slug);
  };
  actor.decreaseCondition = async (slug, { forceRemove = false } = {}) => { if (forceRemove || !(conds.get(slug) > 1)) conds.delete(slug); else conds.set(slug, conds.get(slug) - 1); };
  actor.saves = Object.fromEntries(["will", "fortitude", "reflex"].map(type => [type, { check: { roll: async opts => { actor.saveRolls.push([type, opts]); return { total: 11, options: { degreeOfSuccess: actor.degree }, dice: [{ faces: 20, results: [{ result: 8, active: true }] }] }; } } }]));
  Object.defineProperty(actor, "flags", { configurable: true, value: { [M]: actor.rawFlags() } });   // real Foundry: actor.flags[module]
  return actor;
}
function fakeFoundry() {
  const chat = [];
  const make = data => {
    const m = { id: `chat${++seq}`, timestamp: Date.now(), ...structuredClone(data), getFlag: (scope, key) => m.flags?.[scope]?.[key] };
    m.update = async changes => { for (const [path, value] of Object.entries(changes)) { const keys = path.split("."); let node = m; while (keys.length > 1) { node = node[keys[0]] ??= {}; keys.shift(); } node[keys[0]] = value; } };
    return m;
  };
  globalThis.ChatMessage = { create: async data => { const m = make(data); chat.push(m); return m; }, deleteDocuments: async ids => { for (const id of ids) chat.splice(chat.findIndex(m => m.id === id), 1); }, getSpeaker: () => ({}), getWhisperRecipients: () => [getUsers().gm] };
  game.messages = Object.assign(chat, { get: id => chat.find(m => m.id === id) });
  const baseCreate = Actor.create;
  Actor.create = async data => {
    const actor = pf2eify(await baseCreate(data));
    const embed = actor.createEmbeddedDocuments;
    actor.createEmbeddedDocuments = async (type, datas) => { const made = await embed(type, datas); for (const item of made) Object.defineProperty(item, "uuid", { value: `Actor.${actor.id}.Item.${item.id}` }); return made; };
    return actor;
  };
  const scene = { id: "S", name: "Gate Scene", flags: {}, tokens: [] };
  const tokenOf = (data) => {
    const world = game.actors.get(data.actorId);
    const t = { id: `tk${++seq}`, name: data.name, actorId: data.actorId, linked: Boolean(data.actorLink) };
    t.uuid = `Scene.S.Token.${t.id}`;
    t.actor = t.linked ? world : pf2eify(Object.assign(Object.create(null), { id: world.id, name: world.name, items: world.items, system: structuredClone(world.system), rawFlags: () => ({}), degree: 1 }));
    return t;
  };
  scene.createEmbeddedDocuments = async (type, datas) => datas.map(d => { const t = tokenOf(d); scene.tokens.push(t); return t; });
  scene.deleteEmbeddedDocuments = async (type, ids) => { for (const id of ids) scene.tokens.splice(scene.tokens.findIndex(t => t.id === id), 1); };
  game.scenes.push(scene);
  globalThis.canvas = { scene, grid: { size: 100 }, dimensions: { sceneX: 0, sceneY: 0 }, tokens: { controlled: [] } };
  globalThis.fromUuid = async uuid => {
    let m;
    if ((m = /^Scene\.S\.Token\.(\w+)$/.exec(uuid))) return scene.tokens.find(t => t.id === m[1]) ?? null;
    if ((m = /^Actor\.(\w+)\.Item\.(\w+)$/.exec(uuid))) return game.actors.get(m[1])?.items.get(m[2]) ?? null;
    return null;
  };
  ChatMessage.chat = chat;
  return { chat, scene };
}

test("the effects gate doc: steps are labelled, bullets are short, every step has one block, the real-Foundry steps and the screenshots are where they should be", () => {
  assert.deepEqual([...GATE.keys()], Array.from({ length: 25 }, (_, i) => i + 1));
  for (const [step, entry] of GATE) {
    assert.match(entry.who, /^\[(GM|Player)\]( and \[(GM|Player)\])?\s*$/, `step ${step} says who runs it`);
    assert.ok(entry.code, `step ${step} has a code block`);
    assert.equal((entry.text.match(/```js/g) ?? []).length, 1, `step ${step} has ONE code block`);
    const section = entry.text.split("```js")[0];
    const bullets = section.split("\n").filter(l => /^- /.test(l));
    assert.ok(bullets.length >= 2, `step ${step} lists its instructions as bullets`);
    assert.ok(bullets.every(b => b.length <= 700), `step ${step}: every bullet is short (one action)`);
    assert.doesNotMatch(section.replace(/^- .*$/gm, ""), /\n[A-Z][^\n]{200,}/, `step ${step} has no long paragraph of instructions outside the bullets`);
    if (!/Nothing to click/i.test(section) && step !== 1 && step !== 2) assert.ok(bullets.some(b => /You should see:/.test(b)), `step ${step} has a "You should see:" bullet`);
    if (step > 1) assert.match(entry.code, /ALL PASS|done\(\)|already|planted|problems/, `step ${step} ends in a result line the person can paste back`);
  }
  assert.deepEqual([...GATE].filter(([, e]) => /send me a screenshot/i.test(e.text)).map(([n]) => n), [5, 9]);
  assert.match(gateDoc, new RegExp(`version must be \\*\\*${MODULE_VERSION.replace(/\./g, "\\.")}\\*\\*`));
  assert.match(gateDoc, /Force-reload BOTH windows first/);
  assert.match(gateDoc, /\(v0\.22\.0\)/);
  assert.match(gateDoc, /What SETUP plants/);
  assert.match(gateDoc, /"drives": \["bonusDamage", "specialAbility", "applyCondition"\]/, "the real recipe is not edited: the one-line change is listed");
  assert.match(gateDoc, /Steps 12 to 24/);
  for (const must of [/unlinked/i, /two-target|both goblins|two targets/i, /ONE card/, /fallback/i, /Apply/, /Skip/]) assert.match(gateDoc, must);
  assert.ok(MODULE_VERSION === "0.22.0");
});

test("GATE 21: every step runs in order (the click steps by real clicks on the editor window; the real-Foundry steps from probe-shaped messages and Apply)", async () => {
  await world({ downtime: 0, iron: 0, fang: 0, perClientDefinitions: true });
  const api = getApi();
  api.baseSources = seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }));
  api.editorLeftovers = [];
  const { gm, testUser } = getUsers();
  const { chat, scene } = fakeFoundry();
  gm.targets = new Set(); testUser.targets = new Set();
  const realNow = Date.now; let skew = 0;
  Date.now = () => realNow() + skew;
  const logged = console.log;
  const expectPass = async (step, user = gm) => {
    const sink = [];
    console.log = (...args) => sink.push(args.map(String).join(" "));
    try { assert.equal(await runBlock(step, user), "ALL PASS", `step ${step} did not report ALL PASS:\n${sink.join("\n")}`); } finally { console.log = logged; }
  };
  installFakeApplication();
  const hero = () => game.actors.getName("Gate G21 Hero");
  const tok = name => scene.tokens.find(t => t.name === `Gate G21 ${name}`);
  const handle = async message => api.effects.handle(message);
  const newest = test => chat.filter(test).at(-1);
  const attackAs = (outcome, itemName, target) => {
    const item = hero().items.find(i => i.name === `Gate G21 Mitflit ${itemName}`), t = tok(target);
    return { id: `real${++seq}`, flags: { pf2e: { context: { type: "attack-roll", outcome, target: { token: t.uuid, actor: `${t.uuid}.Actor.${t.actorId}` }, origin: { actor: `Actor.${hero().id}`, token: tok("Hero").uuid }, action: "strike", identifier: `${item.id}.sword.melee` }, origin: { actor: `Actor.${hero().id}`, uuid: item.uuid, type: "weapon" } } }, author: { targets: new Set([{ document: t }]) } };
  };
  const useAs = targets => {
    const item = hero().items.find(i => i.name === "Gate G21 Mitflit Draught");
    return { id: `real${++seq}`, flags: { pf2e: { origin: { actor: `Actor.${hero().id}`, uuid: item.uuid, type: "consumable" } } }, author: { targets: new Set(targets.map(n => ({ document: tok(n) }))) } };
  };
  let strikeTarget = "Goblin A";
  // The fake Foundry's version of the shared script's named actions (the real runner clicks the canvas and rolls real PF2e instead).
  const extras = {
    resize: async width => { for (const watched of globalThis.__fakeDom.observers.flatMap(o => [...o.targets])) globalThis.__fakeDom.resize(watched, width); await wait(30); },
    advance: async ms => { skew += ms; },
    selectToken: async name => { canvas.tokens.controlled = [tok(name)]; gm.targets = new Set(); },
    targetTokens: async (who, names) => {
      const set = new Set(names.map(n => tok(n)));
      if (who === "gm") gm.targets = new Set(names.map(n => ({ document: tok(n) })));
      else { testUser.targets = set; strikeTarget = names[0] ?? strikeTarget; }
    },
    strike: async (outcome, itemName) => { const m = attackAs(outcome, itemName, "Goblin A"); chat.push({ ...m, getFlag: () => undefined, content: "PF2e attack card" }); return handle(m); },
    useConsumable: async names => {
      const post = m => { chat.push({ ...m, getFlag: () => undefined, content: "PF2e consumable card" }); return handle(m); };
      if (!names.length) return handle(useAs([]));
      await post(useAs(names)); await post(useAs(names));      // PF2e posts the use card, a second card, then a damage-taken message
      await post({ id: "dmg-taken", flags: { pf2e: { context: { type: "damage-taken" } } }, author: { targets: new Set() } });
    },
    pressApply: async (match, { degree, fallback } = {}) => {
      const card = newest(m => m.getFlag?.(M, "fx")?.state === "pending" && (fallback ? m.getFlag(M, "fx").fallback && match && new RegExp(match).test(m.content) : new RegExp(match).test(m.getFlag(M, "fx").text)));
      assert.ok(card, `a pending card matching "${match}" is there`);
      if (!fallback && degree) tok("Goblin A").actor.degree = 1;
      assert.equal((await api.effects.applyCard(card.id, degree && fallback ? { forceDegree: degree } : undefined)).ok, true);
    },
    pressApplyRefused: async () => {
      const fallback = newest(m => m.getFlag?.(M, "fx")?.fallback && m.getFlag(M, "fx").state === "pending" && /no one is targeted/.test(m.content));
      assert.ok(fallback, "the fallback card is there");
      canvas.tokens.controlled = [];
      gm.targets = new Set();
      assert.equal((await api.effects.applyCard(fallback.id)).ok, false, "with nothing targeted Apply refuses and the card stays");
      assert.equal(fallback.getFlag(M, "fx").state, "pending");
    }
  };
  const base = { drivers: { gm: makeDomDriver({ as, user: gm }), player: makeDomDriver({ as, user: testUser }) }, state: {}, assert, wait, extras };
  const whoOf = step => (GATE.get(step).who.includes("[Player]") && !GATE.get(step).who.includes("[GM]") ? "player" : "gm");
  const play = n => playStep({ script, n, who: whoOf(n), base, runBlock: (step, who) => expectPass(step, who === "player" ? testUser : gm) });


  await quietly(async () => {
    // Steps 1-2
    assert.deepEqual(await runBlock(1, gm), ["GM", true, MODULE_VERSION]);
    assert.deepEqual(await runBlock(1, testUser), ["Test", false, MODULE_VERSION]);
    const setup = await runBlock(2, gm);
    assert.equal(setup.planted.length, 4);
    assert.equal(setup.tokens, 3);
    assert.equal(hero().items.length, 3);
    assert.equal(tok("Goblin A").linked, false); assert.equal(tok("Goblin B").linked, true);
    assert.equal((await runBlock(2, gm)).already, "set up");
    assert.equal(scene.tokens.length, 3, "a rerun does not place the tokens twice");
    assert.ok(api.definitions.recipe.has("g21-sword") && api.definitions.material.has("g21-mitflit"));
    // Steps 3-6: the builder, played by the SHARED click script (e2e/steps/gate21.steps.mjs)
    for (const n of [3, 4, 5, 6]) await play(n);
    // Steps 7-8: teach the Hero; the Player sees plain words only
    await expectPass(7);
    await expectPass(8, testUser);
    // Steps 9-10: the card from recorded shapes; Apply with forced degrees
    await expectPass(9);
    assert.equal(chat.length, 4);
    for (const m of chat) assert.deepEqual(m.whisper, ["gm1"]);
    await expectPass(10);
    // Steps 11-24: the real-Foundry part, from probe-shaped messages; the shared script names each action, the fake supplies it
    await expectPass(11);
    gm.targets = new Set();
    for (const n of [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]) await play(n);
    assert.deepEqual(tok("Goblin A").actor.saveRolls.length > 0, true);
    assert.deepEqual(tok("Goblin A").actor.saveRolls.find(([, o]) => o.dc.value === 20)?.[1], { dc: { value: 20 }, skipDialog: true, createMessage: false }, "levelDC(5) = 20, and the roll makes no chat card");
    // The secret save never reached chat: every save the module rolled was rolled with createMessage false
    for (const actor of [tok("Goblin A").actor, tok("Goblin B").actor]) for (const [, opts] of actor.saveRolls) assert.equal(opts.createMessage, false);
    // Step 25: CLEANUP, twice, and the third time after a "reload" (the globals and the in-memory definitions gone)
    const cleanup = await runBlock(25, gm);
    assert.deepEqual(cleanup.problems, []);
    assert.deepEqual([cleanup.actorsLeft, cleanup.tokensLeft, cleanup.itemsLeft, cleanup.recordsLeft, cleanup.cardsLeft], [0, 0, 0, 0, 0]);
    assert.deepEqual(cleanup.audit, []);
    assert.ok(!api.definitions.recipe.has("g21-sword") && !api.definitions.material.has("g21-mitflit"));
    assert.deepEqual((await runBlock(25, gm)).problems, []);
    assert.equal(globalThis.__g21, undefined);
    assert.equal(testUser.getFlag(M, "gateSetup21"), undefined);
  });
  Date.now = realNow;
});

test("GATE 21: SETUP refuses to run on top of someone else's actor, and CLEANUP is safe from the middle and after a reload", async () => {
  await world({ downtime: 0, iron: 0, fang: 0, perClientDefinitions: true });
  const api = getApi();
  api.baseSources = seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }));
  api.editorLeftovers = [];
  const { gm } = getUsers();
  fakeFoundry();
  await quietly(async () => {
    await Actor.create({ name: "Gate G21 Hero", type: "character", flags: {} });
    await assert.rejects(runBlock(2, gm), /already exists and was not made by this check/);
    await game.actors.getName("Gate G21 Hero").delete();
    await runBlock(2, gm);
    delete globalThis.__g21;                            // a reload of the GM window: the globals are gone
    api.definitions.material.delete("g21-mitflit");     // ...and so are the in-memory definitions
    const cleanup = await runBlock(25, gm);
    assert.deepEqual(cleanup.problems, []);
    assert.equal(cleanup.actorsLeft, 0);
    const again = await runBlock(2, gm);                // SETUP works again afterwards
    assert.equal(again.tokens, 3);
    assert.deepEqual((await runBlock(25, gm)).problems, []);
  });
});
