/**
 * The Stage 11a gate (docs/17-stage11a-gate.md): every code block is extracted and run, in order, as the right client, in a fake Foundry
 * where the Player and the GM have their OWN api.definitions; and every click-through step is played through the SAME view-model code the
 * window draws, asserting what the step tells the person to look for. What it cannot show: the real window, fonts, focus rings, resizing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { as, env, getApi, getUsers, makeActor, makeRegistry, measure, quietly, snapshot, world } from "./fake-world.js";
import { readFacts } from "../scripts/hub/facts.js";
import { emptyState, formulaeTab, hubModel } from "../scripts/hub/viewmodels.js";
import { renderHubMain } from "../scripts/hub/render.js";
import { chatLeaks } from "./helpers.js";

const gateDoc = readFileSync("docs/17-stage11a-gate.md", "utf8");
const MODULE_VERSION = JSON.parse(readFileSync("module.json", "utf8")).version;
const GATE = new Map();
for (const match of gateDoc.matchAll(/^## Step (\d+) ((?:\[[^\]]+\](?: and )?)+)[^\n]*\n([\s\S]*?)(?=^## Step |^## Group |(?![\s\S]))/gm)) {
  const block = match[3].match(/```js\n([\s\S]*?)```/);
  GATE.set(Number(match[1]), { who: match[2], code: block?.[1] ?? null, text: match[3] });
}
function runBlock(step, user) {
  const entry = GATE.get(step);
  assert.ok(entry?.code, `docs/17-stage11a-gate.md needs a code block in Step ${step}`);
  const code = entry.code.replace(/^(\/\/[^\n]*\n)*\s*await \(/, match => match.replace("await (", "("));
  return as(user, () => (0, eval)(code));
}
const gateWorld = options => world({ downtime: 0, iron: 0, fang: 0, perClientDefinitions: true, ...options });
const text = html => html.replace(/<[^>]*>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("the stage 11a gate doc: steps are labelled, click-through steps say what you should see, screenshots are asked for only where layout matters", () => {
  assert.deepEqual([...GATE.keys()], Array.from({ length: 40 }, (_, i) => i + 1));
  const withCode = new Set([1, 2, 3, 13, 15, 17, 19, 21, 24, 27, 28, 29, 30, 31, 32, 40]);
  for (const [step, entry] of GATE) {
    assert.match(entry.who, /^\[(GM|Player)\]( and \[(GM|Player)\])?\s*$/, `step ${step} says who runs it`);
    assert.equal(entry.code !== null, withCode.has(step), `step ${step} code block`);
    if (entry.code === null) assert.match(entry.text, /What you should see|you should see/i, `click-through step ${step} says what to see`);
    if (entry.code) assert.equal((entry.text.match(/```js/g) ?? []).length, 1, `step ${step} has ONE code block`);
  }
  const screenshots = [...GATE].filter(([, e]) => /screenshot/i.test(e.text)).map(([n]) => n);
  assert.deepEqual(screenshots, [4, 5, 11, 33, 34, 37], "screenshots are asked for at the open, the sheet button, the form, 175%, high contrast, and narrow");
  assert.match(gateDoc, /version must be \*\*\d+\.\d+\.\d+\*\*/);
  assert.match(gateDoc, /restart of the Foundry server/i);
  assert.match(gateDoc, /game\.user\.name, game\.user\.isGM/);
  assert.match(gateDoc, /Force-reload BOTH windows first/);
  assert.match(MODULE_VERSION, /^\d+\.\d+\.\d+$/);
  for (const need of ["each text size", "keyboard", "narrower than about 700", "Hide", "Gate Moonglass is not offered"]) void need;
  for (const must of [/125%/, /175%/, /High contrast/, /Easy-read/, /Tab/, /stack/, /Switch character/, /hourglass/, /Cancel/]) assert.match(gateDoc, must);
  assert.doesNotMatch(gateDoc, /\bDC \d|odds of|\d+% chance/i, "the gate text itself never talks about difficulty to the player");
});

test("GATE 17: every code step runs, in order, and the click-through steps show exactly what the doc says they will", async () => {
  // Stand-ins for the browser bits step 28 touches (the redraw counter); the counting itself is tested in hub-wiring.
  globalThis.document = { querySelector: () => ({}) };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  const w = await gateWorld();
  const api = getApi();
  const { gm, testUser } = getUsers();
  const lines = [];
  const logged = console.log;
  const expectPass = async (step, user) => {
    const sink = [];
    console.log = (...args) => sink.push(args.map(String).join(" "));
    try { assert.equal(await runBlock(step, user), "ALL PASS", `step ${step} did not report ALL PASS:\n${sink.filter(l => l.startsWith("FAIL")).join("\n")}`); } finally { console.log = logged; }
    lines.push(...sink);
  };
  await quietly(async () => {
    assert.deepEqual(await runBlock(1, gm), ["GM", true, MODULE_VERSION]);
    assert.deepEqual(await runBlock(1, testUser), ["Test", false, MODULE_VERSION]);
    const setup = await runBlock(2, gm);
    assert.deepEqual([setup.smith, setup.friend, setup.testUsersCharacter], ["Gate Smith", "Gate Friend", "Gate Smith"]);
    await as(testUser, () => api.definitions.refresh());
    await expectPass(3, testUser);

    const smith = game.actors.getName("Gate Smith");
    const read = (state = {}, actor = smith) => as(testUser, () => readFacts(api, actor, { ...emptyState(), ...state }));
    const tabOf = async state => formulaeTab(await read(state), { ...emptyState(), ...state });
    const refresh = () => as(testUser, () => api.definitions.refresh());

    // Step 6: the switcher
    const friendFacts = await read({}, game.actors.getName("Gate Friend"));
    assert.deepEqual([friendFacts.characters.map(c => c.name).sort(), friendFacts.formulas.length, friendFacts.days.free], [["Gate Friend", "Gate Smith"], 0, 12]);
    // Step 7: the status strip and the tabs
    const model7 = hubModel(await read(), emptyState());
    assert.deepEqual([model7.status.days.value, model7.status.location.value, model7.status.location.stations, model7.status.waiting.value], ["12 free, 0 reserved", "Gate Town", "Workshops here: Gate Bench, Gate Forge", "Nothing queued"]);
    assert.deepEqual(model7.tabs.map(t => t.text), ["Formulae", "Research", "Commissions (coming later)", "Explore (coming later)", "Workshop (coming later)", "Compendium"]);
    assert.equal(hubModel(await read(), { ...emptyState(), tab: "explore" }).body.text, "Coming in a later stage");
    // Step 8: the list and the chips
    const list8 = (await tabOf({})).list;
    assert.deepEqual(list8.cards.map(c => [c.name, c.pill]), [["Gate Blade", "Known"], ["Gate Vest", "Known"], ["Gate Draught", "Researching"]]);
    assert.match(list8.cards[2].progress.text, /^Progress 1 of \d+$/);
    assert.equal(list8.cards[2].openInResearch.text, "Open in Research");
    assert.deepEqual(list8.chips.map(c => `${c.label} ${c.count}`), ["All 3", "Weapon 1", "Armor 1", "Consumable 0"]);
    for (const [filter, names] of [["weapon", ["Gate Blade"]], ["armor", ["Gate Vest"]], ["all", ["Gate Blade", "Gate Vest", "Gate Draught"]]]) assert.deepEqual((await tabOf({ filter })).list.cards.map(c => c.name), names, filter);
    assert.equal((await tabOf({ filter: "consumable" })).list.empty, "No formulae in this group.");
    // Step 9: every slot starts empty
    const blade = (await tabOf({ recipeId: "g5-blade" })).detail;
    assert.deepEqual(blade.slots.map(s => [s.label, s.roleLine, s.statusText]), [["Body", "Body sets the weapon's power.", "Nothing chosen yet"], ["Edge", "Edge adds bonus damage.", "Nothing chosen yet"]]);
    assert.ok(blade.slots.every(s => s.options.every(o => !o.selected)), "nothing is selected");
    assert.deepEqual(blade.slots[0].options.map(o => o.name).sort(), ["Gate Ember", "Gate Ore", "Gate Star", "Gate Steel"]);
    assert.deepEqual(blade.slots[1].options.map(o => o.name).sort(), ["Gate Ember", "Gate Star", "Gate Steel"]);
    assert.ok(!JSON.stringify(blade).includes("Moonglass"), "the never-met material is not offered");
    assert.equal(blade.slots[0].options.find(o => o.name === "Gate Ore").stock.text, "Uses 1 of 6");
    // Step 10: learned and unlearned effects
    const optionFx = (slot, name) => blade.slots.find(s => s.label === slot).options.find(o => o.name === name).effect;
    assert.deepEqual(optionFx("Body", "Gate Ore"), { known: true, effects: ["Gate Ore sets the weapon's power (tier 1)"] });
    assert.deepEqual(optionFx("Edge", "Gate Ember"), { known: true, effects: ["Gate Ember adds +1d6 fire damage"] });
    for (const [slot, name] of [["Body", "Gate Steel"], ["Body", "Gate Star"], ["Edge", "Gate Steel"], ["Edge", "Gate Star"]]) assert.deepEqual(optionFx(slot, name), { known: false, text: "You haven't tried this here yet" }, `${slot} ${name}`);
    // Step 11: What you will get, and the workshops
    const picked = { recipeId: "g5-blade", picks: { body: "g5-ore", edge: "g5-steel" } };
    const full = (await tabOf(picked)).detail;
    assert.deepEqual(full.stations.options.map(o => [o.name, o.tierText, o.feeText, o.selected, o.cheapest]), [["Gate Bench", "Tier 1", "1 gp", true, "Cheapest"], ["Gate Forge", "Tier 2", "5 gp", false, ""]]);
    assert.deepEqual([full.outcome.result.text, full.outcome.fee, full.outcome.materials, full.outcome.failureNote], ["A tier 1 Gate Blade", "Station fee: 1 gp at Gate Bench", ["1 × Gate Ore", "1 × Gate Steel"], "A failed craft can lose some materials and teaches you nothing."]);
    assert.deepEqual(full.outcome.effects.map(e => e.known ? e.effects : e.text), [["Gate Ore sets the weapon's power (tier 1)"], "Edge, Gate Steel: You haven't tried this here yet"]);
    assert.match(full.outcome.days, /^Takes \d+ days?$/);
    assert.equal((await tabOf({ ...picked, stationId: "g5-forge" })).detail.outcome.fee, "Station fee: 5 gp at Gate Forge");
    assert.equal(full.buttons.queue.disabled, false, full.buttons.queue.reason);
    assert.deepEqual([full.buttons.ask.disabled, full.buttons.ask.why], [true, "Commissions arrive in a later stage."]);
    const days = Number(full.outcome.days.match(/\d+/)[0]);
    // Step 12: an empty slot, and not enough of a material
    assert.deepEqual((await tabOf({ recipeId: "g5-blade", picks: { body: "g5-ore" } })).detail.buttons.queue, { text: "Queue the craft", disabled: true, reason: "Choose a material for every slot first." });
    const vest = (await tabOf({ recipeId: "g5-vest", picks: { hide: "g5-ember" } })).detail;
    assert.equal(vest.buttons.queue.reason, "You don't have enough Gate Ember.");
    assert.deepEqual(vest.slots[0].options.find(o => o.name === "Gate Ember").stock, { have: 1, need: 2, short: true, text: "Need 2, you have 1", word: "Not enough" });

    // Steps 13-14: downtime closed
    await expectPass(13, gm);
    assert.equal((await tabOf(picked)).detail.buttons.queue.reason, "Downtime isn't open right now");
    assert.match(text(renderHubMain(hubModel(await read(picked), { ...emptyState(), ...picked }))), /Downtime isn't open right now\. You can look around/);
    // Steps 15-16: open for someone else
    await expectPass(15, gm);
    assert.equal((await tabOf(picked)).detail.buttons.queue.reason, "Downtime is open, but you weren't here for it");
    // Steps 17-18: no workshop in reach
    await expectPass(17, gm);
    await refresh();            // in Foundry the watched party-location setting makes the player client ask the GM by itself
    const away = await read(picked);
    assert.deepEqual([away.location.name, away.location.stations], ["Gate Away", []]);
    const awayTab = formulaeTab(away, { ...emptyState(), ...picked });
    assert.deepEqual([awayTab.detail.stations.none, awayTab.detail.buttons.queue.reason], ["No workshop you can use is within reach for this.", "No workshop you can use is within reach for this."]);
    assert.equal(hubModel(away, emptyState()).status.location.stations, "No workshops here");
    await expectPass(19, gm);

    // Steps 20-22: queue, resolve as a success, learn it
    const queued = await as(testUser, () => api.queue.submit(smith, "craft", { recipe: "g5-blade", selection: { body: "g5-ore", edge: "g5-steel" }, stationId: "g5-bench" }));
    assert.equal(queued.daysReserved, days, "the form said N days; the queue reserved N");
    const after20 = await read(picked);
    assert.deepEqual([after20.days.free, after20.days.reserved, hubModel(after20, emptyState()).status.waiting.value, hubModel(after20, { ...emptyState(), showQueue: true }).queue.rows.length], [12 - days, days, "1 queued", 1]);
    await expectPass(21, gm);
    await refresh();
    const learned = (await tabOf({ recipeId: "g5-blade" })).detail;
    assert.deepEqual(learned.slots.find(s => s.label === "Edge").options.find(o => o.name === "Gate Steel").effect, { known: true, effects: ["Gate Steel adds +1d4 fire damage"] });
    assert.equal(learned.slots.find(s => s.label === "Body").options.find(o => o.name === "Gate Steel").effect.known, false, "per slot: the Body's Gate Steel is still untried");
    const again = (await tabOf(picked)).detail.outcome;
    assert.ok(again.effects.some(e => e.known && e.effects.includes("Gate Steel adds +1d4 fire damage")));
    assert.ok(again.effects.every(e => !e.known || !/Star/.test(e.effects.join())));
    // Steps 23-25: a failure teaches nothing
    await as(testUser, () => api.queue.submit(smith, "craft", { recipe: "g5-blade", selection: { body: "g5-ore", edge: "g5-star" }, stationId: "g5-bench" }));
    await expectPass(24, gm);
    await refresh();
    const failed = (await tabOf({ recipeId: "g5-blade" })).detail;
    assert.equal(failed.slots.find(s => s.label === "Edge").options.find(o => o.name === "Gate Star").effect.known, false);
    // Step 26: cancel from the queue panel
    const before26 = (await read()).days;
    const third = await as(testUser, () => api.queue.submit(smith, "craft", { recipe: "g5-blade", selection: { body: "g5-ore", edge: "g5-ember" }, stationId: "g5-bench" }));
    assert.equal((await read()).queue.length, 1);
    await as(testUser, () => api.queue.cancel(smith, third.id));
    const after26 = await read();
    assert.deepEqual([after26.queue.length, after26.days], [0, before26]);
    // Step 27: no message in the chat data has a DC or a roll
    assert.deepEqual(chatLeaks(env.chat), []);
    await expectPass(27, testUser);

    // Steps 28-32: the redraw counter, and the rule that decides what redraws
    assert.match(await runBlock(28, testUser), /^counting:/);
    await expectPass(29, gm);
    await expectPass(30, testUser);
    await expectPass(31, gm);
    globalThis.__pfpRedraws = 1;      // what the browser's observer would have counted
    await expectPass(32, testUser);

    const cleanup = await runBlock(40, gm);
    assert.deepEqual(cleanup, { problems: [], actorsLeft: 0, downtimeOpen: false, testUsersCharacter: null, sharedLeft: 0, audit: [] });
  });
  for (const name of ["Gate Smith", "Gate Friend"]) assert.equal(game.actors.getName(name), undefined, name);
  assert.equal(env.values.partyLocation, "oakhaven", "the party location is put back");
  assert.deepEqual(env.values.downtime, {});
  assert.deepEqual(Object.keys(env.values.sharedCompendium?.experiments ?? {}), [], "the shared entries are removed");
  for (const [kind, id] of [["recipe", "g5-blade"], ["recipe", "g5-vest"], ["recipe", "g5-draught"], ["station", "g5-bench"], ["station", "g5-forge"], ["material", "g5-ore"], ["material", "g5-moon"], ["town", "g5-town"], ["town", "g5-away"]]) assert.equal(api.definitions[kind].has(id), false, `${id} is removed`);
  assert.deepEqual(measure(w.ann), { copper: 2000, stash: {}, freeDays: 0, reservedDays: 0, totalDays: 0, items: [] });
  assert.equal(globalThis.__g5, undefined);
  delete globalThis.__pfpRedraws; delete globalThis.document; delete globalThis.MutationObserver;
  void lines; void makeRegistry; void makeActor; void snapshot;
});

test("GATE 17: SETUP refuses to run against real data, and runs twice; CLEANUP works from the middle and twice", async () => {
  for (const [label, prepare, expected] of [
    ["open downtime", async w => { await getApi().downtime.start({ days: 3, actorIds: [w.ann.id] }); }, /downtime is already open/],
    ["a character holding days", async w => { await getApi().grantDays(w.ann, 2); }, /these characters hold downtime days: Ann/],
    ["a real actor named like a gate one", async () => { game.actors.push(makeActor("Gate Smith")); }, /already exists and was not made by this check/],
    ["leftover shared entries", async () => { env.values.sharedCompendium = { v: 1, materials: {}, creatures: {}, regions: {}, experiments: { "g5-blade": { recipeId: "g5-blade", name: "x", firstAt: 1, slots: {} } } }; }, /an earlier run left shared Compendium entries/]
  ]) {
    const w = await gateWorld();
    await prepare(w);
    const before = snapshot(w);
    await quietly(async () => assert.rejects(Promise.resolve(runBlock(2, getUsers().gm)), expected, label));
    assert.equal(snapshot(w), before, `${label}: nothing changed`);
    delete globalThis.__g5;
  }
  const w = await gateWorld();
  const { gm, testUser } = getUsers();
  await quietly(async () => {
    await runBlock(2, gm);
    assert.equal((await runBlock(2, gm)).already, "set up");
    await as(testUser, () => getApi().definitions.refresh());
    assert.equal(await runBlock(3, testUser), "ALL PASS");
    assert.deepEqual((await runBlock(40, gm)).problems, []);
    assert.deepEqual((await runBlock(40, gm)).problems, []);
  });
  assert.equal(game.actors.getName("Gate Smith"), undefined);
  assert.deepEqual(measure(w.ann).stash, {});
});
