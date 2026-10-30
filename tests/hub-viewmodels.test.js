/** The Downtime Hub's view-models (Stage 11a): every rule the window shows, in Node, plus the leak scanner over all of it. */
import test from "node:test";
import assert from "node:assert/strict";
import { HUB } from "../scripts/config.js";
import { S } from "../scripts/hub/strings.js";
import { DEFAULT_DISPLAY, fontPx, normalizeDisplay, rootStyle, withDisplay } from "../scripts/hub/display.js";
import {
  allSlotsPicked, characterSwitcher, craftRequest, downtimeGate, formulaList, formulaeTab, hubModel, learnedKey, outcomeBox, pickMaterial, queueButton, queuePanel,
  roleText, selectRecipe, slotPane, slotRoleLine, stationChoices, statusStrip, tabRow
} from "../scripts/hub/viewmodels.js";
import { renderHubMain, renderHubPage } from "../scripts/hub/render.js";
import { BAD, findings } from "./scan.js";
import { BENCH, BLADE, FORGE, STAR_EFFECT, STEEL_EFFECT, VEST, makeFacts, makeState } from "./hub-fixtures.js";

const text = html => html.replace(/<[^>]*>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ");
// A text-size label ("125%") is the one percentage the Hub shows; it is a size, not odds. Everything else must stay clean.
const SIZE_LABEL = new RegExp(`\\b(${HUB.textSizes.join("|")})%`, "g");
const sizeFree = value => (typeof value === "string" ? value.replace(SIZE_LABEL, "") : value);
const scanClean = (value, path = "$") => findings(JSON.parse(JSON.stringify(value), (k, v) => sizeFree(v)), path);
const learnedStar = { [learnedKey("gate-blade", "edge", "gate-star")]: { known: true, effects: STAR_EFFECT } };
const optionOf = (pane, slot, id) => pane.find(s => s.name === slot).options.find(o => o.id === id);

// Gate, status, tabs -------------------------------------------------------------------------------------------------
test("the downtime gate: closed, open but you weren't there, or open", () => {
  assert.deepEqual(downtimeGate({ open: false, participant: false }), { open: false, reason: "Downtime isn't open right now", note: S.closedNote });
  assert.equal(downtimeGate({ open: true, participant: false }).reason, "Downtime is open, but you weren't here for it");
  assert.deepEqual(downtimeGate({ open: true, participant: true }), { open: true, reason: null, note: null });
});

test("the status strip: days free and reserved, the party's town and its workshops, and how many are waiting on the GM", () => {
  const strip = statusStrip(makeFacts({ days: { free: 4, reserved: 2 }, queue: [{ id: "a", label: "Craft", days: 2 }, { id: "b", label: "Craft", days: 0 }] }));
  assert.equal(strip.days.value, "4 free, 2 reserved");
  assert.deepEqual([strip.location.value, strip.location.stations], ["Gate Town", "Workshops here: Gate Bench"]);
  assert.deepEqual([strip.waiting.count, strip.waiting.value], [2, "2 queued"]);
  assert.equal(statusStrip(makeFacts({ queue: [] })).waiting.value, "Nothing queued");
  assert.equal(statusStrip(makeFacts({ location: { name: null, stations: [] } })).location.value, "Not set");
  assert.equal(statusStrip(makeFacts({ location: { name: null, stations: [] } })).location.stations, "No workshops here");
});

test("the character switcher shows only when there is more than one character", () => {
  assert.equal(characterSwitcher([{ id: "a", name: "A" }], "a").show, false);
  const two = characterSwitcher([{ id: "a", name: "A" }, { id: "b", name: "B" }], "b");
  assert.equal(two.show, true);
  assert.deepEqual(two.options.map(o => [o.id, o.current]), [["a", false], ["b", true]]);
});

test("ALL tabs are listed; Formulae, Research and Compendium work, the others say they are coming later", () => {
  const tabs = tabRow("formulae");
  assert.deepEqual(tabs.map(t => t.id), ["formulae", "research", "commissions", "explore", "workshop", "compendium"]);
  assert.deepEqual(tabs.filter(t => t.working).map(t => t.id), ["formulae", "research", "compendium"]);
  assert.ok(tabs.filter(t => !t.working).every(t => /coming later/.test(t.text)));
  const model = hubModel(makeFacts(), makeState({ tab: "explore" }));
  assert.deepEqual([model.body.kind, model.body.text], ["placeholder", "Coming in a later stage"]);
});

// The list ---------------------------------------------------------------------------------------------------------------
test("the formula list: a card per held recipe with a Known pill, filter chips with counts, and the filter works", () => {
  const facts = makeFacts();
  const all = formulaList(facts, makeState({ filter: "all" }));
  assert.deepEqual(all.chips.map(c => [c.id, c.count, c.selected]), [["all", 2, true], ["weapon", 1, false], ["armor", 1, false], ["consumable", 0, false]]);
  assert.deepEqual(all.cards.map(c => [c.name, c.pill, c.status]), [["Gate Blade", "Known", "known"], ["Gate Vest", "Known", "known"]]);
  assert.deepEqual(formulaList(facts, makeState({ filter: "armor" })).cards.map(c => c.name), ["Gate Vest"]);
  assert.equal(formulaList(facts, makeState({ filter: "consumable" })).empty, "No formulae in this group.");
  assert.match(formulaList(makeFacts({ formulas: [] }), makeState()).empty, /doesn't know any formulae/);
});

test("a formula still being researched shows a Researching pill with progress and a disabled Open in Research", () => {
  const facts = makeFacts({ researching: [{ id: "p1", goalName: "Gate Draught", recipeId: "gate-draught", progress: 3, threshold: 8 }] });
  const list = formulaList(facts, makeState({ filter: "all" }));
  const card = list.cards.find(c => c.status === "researching");
  assert.deepEqual([card.name, card.pill, card.progress.value, card.progress.max, card.progress.text], ["Gate Draught", "Researching", 3, 8, "Progress 3 of 8"]);
  assert.deepEqual([card.openInResearch.disabled, card.openInResearch.text, card.openInResearch.projectId], [false, "Open in Research", "p1"]);
  assert.deepEqual(formulaList(facts, makeState({ filter: "consumable" })).cards.map(c => c.name), ["Gate Draught"]);
  // research for something the character now holds is not shown twice
  const held = makeFacts({ researching: [{ id: "p1", goalName: "Gate Blade", recipeId: "gate-blade", progress: 8, threshold: 8 }] });
  assert.equal(formulaList(held, makeState()).cards.filter(c => c.name === "Gate Blade").length, 1);
  // a recipe whose category is not loaded yet appears under All only
  const unloaded = makeFacts({ researching: [{ id: "p2", goalName: "Gate Unknown", recipeId: null, progress: 1, threshold: 4 }] });
  assert.equal(formulaList(unloaded, makeState({ filter: "weapon" })).cards.some(c => c.name === "Gate Unknown"), false);
  assert.equal(formulaList(unloaded, makeState({ filter: "all" })).cards.some(c => c.name === "Gate Unknown"), true);
});

test("a researching formula opens a note and its progress, never a craft form", () => {
  const facts = makeFacts({ formulas: [], researching: [{ id: "p1", goalName: "Gate Draught", recipeId: "gate-draught", progress: 3, threshold: 8 }] });
  const tab = formulaeTab(facts, makeState({ recipeId: "gate-draught" }));
  assert.equal(tab.detail.kind, "researching");
  assert.match(tab.detail.text, /still researching/);
});

// Slots and materials ----------------------------------------------------------------------------------------------------
test("EVERY SLOT STARTS EMPTY: choosing a formula never fills a slot, even when only one material fits", () => {
  const facts = makeFacts({ inventory: { "gate-iron": 5 }, met: ["gate-iron"] });
  let state = selectRecipe(makeState({ recipeId: null }), "gate-blade");
  assert.deepEqual(state.picks, {});
  const pane = slotPane(facts, BLADE, state.picks);
  assert.ok(pane.every(s => s.chosen === null && s.statusText === "Nothing chosen yet"), "empty");
  assert.ok(pane.every(s => s.options.every(o => o.selected === false)), "nothing is selected for the player");
  assert.deepEqual(pane.find(s => s.name === "blade").options.map(o => o.id), ["gate-iron"], "the only fit is offered, not chosen");
  // switching formula clears picks again
  state = pickMaterial(state, "blade", "gate-iron");
  assert.deepEqual(state.picks, { blade: "gate-iron" });
  assert.deepEqual(selectRecipe(state, "gate-vest").picks, {});
  assert.equal(selectRecipe(state, "gate-blade"), state, "selecting the same formula keeps the picks");
});

test("picking the same material again empties the slot; a different one replaces it", () => {
  let state = makeState();
  state = pickMaterial(state, "blade", "gate-iron");
  state = pickMaterial(state, "blade", "gate-steel");
  assert.equal(state.picks.blade, "gate-steel");
  state = pickMaterial(state, "blade", "gate-steel");
  assert.deepEqual(state.picks, {});
});

test("a slot says in one line what it does, from what it drives", () => {
  assert.equal(slotRoleLine(BLADE, BLADE.slots[0]), "Blade sets the weapon's power.");
  assert.equal(slotRoleLine(BLADE, BLADE.slots[1]), "Edge adds bonus damage and gives a special ability.");
  assert.equal(slotRoleLine(VEST, VEST.slots[0]), "Hide sets the armor's power.");
});

test("a slot offers only materials the character HAS and has MET, at or above the slot's tier floor, lowest tier first", () => {
  const facts = makeFacts({ inventory: { "gate-iron": 5, "gate-steel": 1, "gate-star": 0 }, met: ["gate-iron", "gate-steel"] });
  const pane = slotPane(facts, BLADE, {});
  assert.deepEqual(pane.find(s => s.name === "blade").options.map(o => o.id), ["gate-iron", "gate-steel"]);
  assert.deepEqual(pane.find(s => s.name === "edge").options.map(o => o.id), ["gate-steel"], "edge needs tier 2 or better");
  const unmet = slotPane(makeFacts({ met: ["gate-iron"] }), BLADE, {});
  assert.deepEqual(unmet.find(s => s.name === "blade").options.map(o => o.id), ["gate-iron"], "in the bag but never met: not offered");
  const none = slotPane(makeFacts({ inventory: {} }), BLADE, {});
  assert.equal(none[0].noOptions, S.slotNoOptions);
});

test("stock reads 'Uses 3 of 5', or 'Need 2, you have 1' with the word Not enough (never colour alone)", () => {
  const ok = optionOf(slotPane(makeFacts(), BLADE, {}), "blade", "gate-iron");
  assert.deepEqual([ok.stock.text, ok.stock.short, ok.stock.word], ["Uses 1 of 5", false, ""]);
  const vest = slotPane(makeFacts({ inventory: { "gate-iron": 1 } }), VEST, {});
  const short = optionOf(vest, "hide", "gate-iron");
  assert.deepEqual([short.stock.text, short.stock.short, short.stock.word], ["Need 2, you have 1", true, "Not enough"]);
});

test("a material chosen for two slots must cover both", () => {
  const both = { ...BLADE, slots: [{ name: "blade", drives: "basePower", tierFloor: 1, qty: 1 }, { name: "edge", drives: "bonusDamage", tierFloor: 1, qty: 1 }] };
  const facts = makeFacts({ inventory: { "gate-iron": 1 } });
  assert.equal(optionOf(slotPane(facts, both, { blade: "gate-iron" }), "edge", "gate-iron").stock.text, "Need 2, you have 1", "choosing it for the edge too would need 2");
  const pane = slotPane(facts, both, { blade: "gate-iron", edge: "gate-iron" });
  assert.equal(optionOf(pane, "blade", "gate-iron").stock.text, "Need 2, you have 1");
  assert.equal(optionOf(pane, "edge", "gate-iron").stock.text, "Need 2, you have 1");
  assert.equal(optionOf(slotPane(facts, both, {}), "blade", "gate-iron").stock.text, "Uses 1 of 1", "nothing else chosen: it covers this slot");
});

test("an effect is shown ONLY if learned; otherwise the plain 'You haven't tried this here yet', never '???'", () => {
  const unknown = optionOf(slotPane(makeFacts(), BLADE, {}), "edge", "gate-star");
  assert.deepEqual(unknown.effect, { known: false, text: "You haven't tried this here yet" });
  const known = optionOf(slotPane(makeFacts({ learned: learnedStar }), BLADE, {}), "edge", "gate-star");
  assert.deepEqual(known.effect, { known: true, effects: ["Gate Star adds +1d8 spirit damage"] });
  // a record that says "not known" never shows its effects, even if it carries them
  const decoy = optionOf(slotPane(makeFacts({ learned: { [learnedKey("gate-blade", "edge", "gate-star")]: { known: false, effects: STAR_EFFECT } } }), BLADE, {}), "edge", "gate-star");
  assert.equal(decoy.effect.known, false);
  assert.doesNotMatch(JSON.stringify(decoy), /1d8|spirit/);
  assert.doesNotMatch(JSON.stringify(slotPane(makeFacts(), BLADE, {})), /\?\?\?/);
});

test("effects are written in plain words for every built-in role", () => {
  assert.equal(roleText("basePower", "T2", BLADE), "sets the weapon's power (tier 2)");
  assert.equal(roleText("bonusDamage", { dice: "1d6", type: "fire", persistent: true, versus: "fiend" }, BLADE), "adds +1d6 persistent fire damage against fiend");
  assert.equal(roleText("specialAbility", { title: "Keen", text: "Sharper edge.", on: "criticalHit" }, BLADE), "gives Keen: Sharper edge. (on a critical hit)");
  assert.equal(roleText("resistance", { type: "cold", value: 5 }, VEST), "gives resistance 5 to cold");
  assert.equal(roleText("spellSlots", 2, BLADE), "adds 2 spell slots");
  assert.equal(roleText("glow", "bright", BLADE), "glow: bright");
});

// Stations ---------------------------------------------------------------------------------------------------------------
test("stations: only reachable ones that fit, cheapest first and chosen by default, fee shown; a party workshop has no fee", () => {
  const party = { id: "gate-hall", name: "Gate Hall", tier: 1, where: "Gate Town", reachable: true, usable: true, fee: 0 };
  const far = { id: "gate-far", name: "Gate Far", tier: 1, where: "Faraway", reachable: false, usable: false, fee: 1 };
  const wrong = { id: "gate-wrong", name: "Gate Wrong", tier: 1, where: "Gate Town", reachable: true, usable: false, fee: 1 };
  const choices = stationChoices([FORGE, BENCH, party, far, wrong], null);
  assert.deepEqual(choices.options.map(o => [o.id, o.feeText, o.selected]), [["gate-hall", "No fee", true], ["gate-bench", "1 gp", false], ["gate-forge", "5 gp", false]]);
  assert.equal(choices.options[0].cheapest, "Cheapest");
  assert.equal(stationChoices([FORGE, BENCH], "gate-forge").chosenId, "gate-forge");
  assert.equal(stationChoices([FORGE, BENCH], "gate-gone").chosenId, "gate-bench", "a station that is gone falls back to the cheapest");
  assert.deepEqual([stationChoices([far], null).none, stationChoices([far], null).chosenId], [S.stationNone, null]);
});

// What you will get ------------------------------------------------------------------------------------------------------
const FULL = { blade: "gate-steel", edge: "gate-star" };
const okPlan = (over = {}) => ({
  ok: true, errors: [], stations: {},
  plan: {
    recipeId: "gate-blade", recipeName: "Gate Blade", station: { id: "gate-bench", name: "Gate Bench", tier: 1 }, fee: 1, days: 2,
    uses: [{ slot: "blade", materialId: "gate-steel", materialName: "Gate Steel", units: 1 }, { slot: "edge", materialId: "gate-star", materialName: "Gate Star", units: 1 }],
    slots: [
      { slot: "blade", materialId: "gate-steel", materialName: "Gate Steel", tier: 2, units: 1, effect: { known: false } },
      { slot: "edge", materialId: "gate-star", materialName: "Gate Star", tier: 3, units: 1, effect: { known: false } }
    ],
    result: { known: false }, effectsKnown: 0, formulaAccess: "owned", ...over
  }
});

test("the outcome box before every slot is chosen asks for a material per slot and invents nothing", () => {
  const box = outcomeBox(makeFacts(), BLADE, { blade: "gate-iron" }, null);
  assert.deepEqual([box.result.state, box.result.text], ["incomplete", "Choose a material for every slot to see what you will get."]);
  assert.equal(box.failureNote, "A failed craft can lose some materials and teaches you nothing.");
});

test("an unknown result says so; the station fee, the days and the materials used are listed", () => {
  const box = outcomeBox(makeFacts({ preview: okPlan() }), BLADE, FULL, null);
  assert.deepEqual([box.result.state, box.result.text], ["unknown", "The result is unknown. Craft it to find out."]);
  assert.deepEqual([box.fee, box.days], ["Station fee: 1 gp at Gate Bench", "Takes 2 days"]);
  assert.deepEqual(box.materials, ["1 × Gate Steel", "1 × Gate Star"]);
  assert.deepEqual(box.effects.map(e => [e.slot, e.known, e.text]), [["blade", false, "Blade, Gate Steel: You haven't tried this here yet"], ["edge", false, "Edge, Gate Star: You haven't tried this here yet"]]);
});

test("a known result is written in plain words and the learned effects of the chosen materials are listed", () => {
  const plan = okPlan({
    result: { known: true, baseTier: 2 },
    slots: [
      { slot: "blade", materialId: "gate-steel", materialName: "Gate Steel", tier: 2, units: 1, effect: { known: true, roles: STEEL_EFFECT, via: "crafted" } },
      { slot: "edge", materialId: "gate-star", materialName: "Gate Star", tier: 3, units: 1, effect: { known: true, roles: STAR_EFFECT, via: "baseline" } }
    ]
  });
  const box = outcomeBox(makeFacts({ preview: plan }), BLADE, FULL, null);
  assert.deepEqual([box.result.state, box.result.text], ["known", "A tier 2 Gate Blade"]);
  assert.deepEqual(box.effects.flatMap(e => e.effects), ["Gate Steel sets the weapon's power (tier 2)", "Gate Star adds +1d8 spirit damage"]);
});

test("UNLEARNED EFFECTS NEVER APPEAR: one learned part is listed, the other says it has not been tried", () => {
  const plan = okPlan({
    result: { known: true, baseTier: 2 },
    slots: [
      { slot: "blade", materialId: "gate-steel", materialName: "Gate Steel", tier: 2, units: 1, effect: { known: true, roles: STEEL_EFFECT, via: "crafted" } },
      { slot: "edge", materialId: "gate-star", materialName: "Gate Star", tier: 3, units: 1, effect: { known: false, roles: STAR_EFFECT } }   // even a stray `roles` must not leak
    ]
  });
  const box = outcomeBox(makeFacts({ preview: plan, learned: { [learnedKey("gate-blade", "edge", "gate-star")]: { known: false, effects: STAR_EFFECT } } }), BLADE, FULL, null);
  const shown = JSON.stringify(box);
  assert.match(shown, /sets the weapon's power \(tier 2\)/);
  assert.doesNotMatch(shown, /1d8|spirit|Star adds/);
  assert.equal(box.effects.find(e => e.slot === "edge").text, "Edge, Gate Star: You haven't tried this here yet");
  const html = text(renderHubMain(hubModel(makeFacts({ preview: plan }), makeState({ picks: FULL }))));
  assert.doesNotMatch(html, /1d8|spirit/);
});

test("before the preview arrives, learned effects of the chosen materials still come from the same learned data as the picker", () => {
  const box = outcomeBox(makeFacts({ learned: learnedStar }), BLADE, { blade: "gate-iron", edge: "gate-star" }, null);
  assert.equal(box.effects.find(e => e.slot === "edge").effects[0], "Gate Star adds +1d8 spirit damage");
  assert.equal(box.effects.find(e => e.slot === "blade").known, false);
});

test("a preview that says no shows its first message", () => {
  const bad = { ok: false, errors: ["The blade needs a material of tier 1 or better."], plan: null };
  const box = outcomeBox(makeFacts({ preview: bad }), BLADE, FULL, null);
  assert.deepEqual([box.result.state, box.result.text], ["problem", "The blade needs a material of tier 1 or better."]);
});

test("a party workshop shows 'No station fee'", () => {
  const hall = { id: "gate-hall", name: "Gate Hall", tier: 1, where: "Gate Town", reachable: true, usable: true, fee: 0 };
  assert.equal(outcomeBox(makeFacts({ stations: [hall], preview: okPlan({ fee: 0 }) }), BLADE, FULL, null).fee, "No station fee at Gate Hall");
});

// The buttons ------------------------------------------------------------------------------------------------------------
test("Queue the craft is off with a plain reason, checked in the order a player fixes things", () => {
  const ready = makeFacts({ preview: okPlan() });
  const q = (facts, picks = FULL, stationId = null) => queueButton(facts, BLADE, picks, stationId).queue;
  assert.deepEqual(q(ready), { text: "Queue the craft", disabled: false, reason: null });
  assert.equal(q({ ...ready, downtime: { open: false, participant: false } }).reason, "Downtime isn't open right now");
  assert.equal(q({ ...ready, downtime: { open: true, participant: false } }).reason, "Downtime is open, but you weren't here for it");
  assert.equal(q(ready, { blade: "gate-steel" }).reason, "Choose a material for every slot first.");
  assert.equal(q({ ...ready, inventory: { "gate-steel": 1, "gate-star": 0 } }).reason, "You don't have enough Gate Star.");
  assert.equal(q({ ...ready, inventory: { "gate-steel": 0, "gate-star": 0 } }).reason, "You don't have enough Gate Steel and Gate Star.");
  assert.equal(q({ ...ready, stations: [] }).reason, "No workshop you can use is within reach for this.");
  assert.equal(q({ ...ready, days: { free: 1, reserved: 0 } }).reason, "This takes 2 days and you have 1 free.");
  assert.equal(q({ ...ready, gp: 0 }).reason, "The station fee is 1 gp and you have 0 gp.");
  assert.equal(q({ ...ready, gp: 1 }).disabled, false, "exactly enough gold is enough");
  assert.equal(q({ ...ready, preview: { ok: false, errors: ["Something is wrong."], plan: null } }).reason, "Something is wrong.");
  assert.equal(q({ ...ready, days: { free: 2, reserved: 0 } }).disabled, false, "exactly enough days is enough");
});

test("Ask a crafter instead is always off for now, with its reason", () => {
  const ask = queueButton(makeFacts({ preview: okPlan() }), BLADE, FULL, null).ask;
  assert.deepEqual([ask.text, ask.disabled, ask.why], ["Ask a crafter instead", true, "Commissions arrive in a later stage."]);
});

test("the craft request is what api.queue.submit needs, and only once every slot is chosen", () => {
  const facts = makeFacts({ preview: okPlan(), stations: [FORGE, BENCH] });
  assert.equal(craftRequest(facts, makeState({ picks: { blade: "gate-steel" } })), null);
  assert.deepEqual(craftRequest(facts, makeState({ picks: FULL })), { recipe: "gate-blade", selection: FULL, stationId: "gate-bench", days: 2 });
  assert.equal(craftRequest(facts, makeState({ picks: FULL, stationId: "gate-forge" })).stationId, "gate-forge");
  assert.equal(allSlotsPicked(BLADE, FULL), true);
});

// The whole window -------------------------------------------------------------------------------------------------------
test("a formula whose details have not arrived yet says it is loading, or that the GM should be asked", () => {
  const facts = makeFacts({ recipes: {}, definitions: "loading" });
  assert.equal(formulaeTab(facts, makeState()).detail.text, S.formulaLoading);
  assert.equal(formulaeTab({ ...facts, definitions: "ready" }, makeState()).detail.text, S.formulaMissing);
  assert.equal(formulaeTab(makeFacts(), makeState({ recipeId: null })).detail.text, S.pickRecipe);
});

test("the queue panel lists what is waiting, with its reserved days", () => {
  const panel = queuePanel([{ id: "a", label: "Craft Gate Blade", days: 2 }, { id: "b", label: "Gather", days: 0 }], true);
  assert.deepEqual(panel.rows.map(r => [r.label, r.daysText]), [["Craft Gate Blade", "2 days reserved"], ["Gather", ""]]);
  assert.equal(queuePanel([], true).empty, true);
});

test("display settings: text size, theme and font fall back one by one, and the font size is REAL (the base size scaled)", () => {
  assert.deepEqual(normalizeDisplay(null), DEFAULT_DISPLAY);
  assert.deepEqual(normalizeDisplay({ textSize: 999, theme: "dark", font: "comic" }), { textSize: 100, theme: "dark", font: "standard" });
  assert.deepEqual(HUB.textSizes.map(p => fontPx({ textSize: p })), [14, 17.5, 21, 24.5]);
  assert.deepEqual(withDisplay(DEFAULT_DISPLAY, { theme: "contrast", textSize: 175 }), { textSize: 175, theme: "contrast", font: "standard" });
  assert.equal(rootStyle({ textSize: 150 }).css, "--pfp-font-size:21px;");
  const model = hubModel(makeFacts(), makeState({ display: { textSize: 125, theme: "dark", font: "hyperlegible" }, showDisplay: true }));
  assert.deepEqual(model.displayPanel.textSize.options.map(o => [o.value, o.selected]), [[100, false], [125, true], [150, false], [175, false]]);
  assert.deepEqual(model.displayPanel.theme.options.map(o => o.text), ["Parchment", "Dark", "High contrast"]);
  assert.deepEqual(model.displayPanel.font.options.map(o => o.text), ["Standard", "Easy-read (Atkinson Hyperlegible)"]);
});

test("an empty character list is a plain message, not a broken window", () => {
  const model = hubModel({ ...makeFacts(), actor: null, characters: [] }, makeState());
  assert.equal(model.character, null);
  assert.match(text(renderHubMain(model)), /don't have a character/);
});

// Rendering --------------------------------------------------------------------------------------------------------------
test("every control is a real button; an off control keeps aria-disabled and is described by its reason", () => {
  const model = hubModel(makeFacts({ downtime: { open: false, participant: false } }), makeState({ picks: FULL }));
  const html = renderHubMain(model);
  assert.doesNotMatch(html, /<div[^>]*(onclick|role="button")|<a [^>]*href/);
  const queueButtonHtml = html.match(/<button[^>]*data-action="queue-craft"[^>]*>/)[0];
  assert.match(queueButtonHtml, /aria-disabled="true"/);
  assert.match(queueButtonHtml, /aria-describedby="why-queue"/);
  assert.doesNotMatch(queueButtonHtml, /\sdisabled[\s>]/);
  assert.match(html, /id="why-queue"[^>]*>Downtime isn&#39;t open right now/);
  const ask = html.match(/<button[^>]*data-action="ask-crafter"[^>]*>/)[0];
  assert.match(ask, /aria-disabled="true"/);
});

test("status is never colour alone: a short stock, the selected option and the gate each carry a word", () => {
  const facts = makeFacts({ inventory: { "gate-iron": 1, "gate-steel": 1 }, downtime: { open: false, participant: false } });
  const html = renderHubMain(hubModel(facts, makeState({ recipeId: "gate-vest", picks: { hide: "gate-iron" } })));
  assert.match(text(html), /Not enough\. Need 2, you have 1/);
  assert.match(text(html), /selected/);
  assert.match(text(html), /Downtime isn't open right now\./);
});

test("the page has one live region for announcements, outside the part that is replaced", () => {
  const model = hubModel(makeFacts(), makeState());
  assert.doesNotMatch(renderHubMain(model), /aria-live/);
  const page = renderHubPage(model, ["Craft queued: Gate Blade. 2 days reserved."]);
  assert.match(page, /<div class="pfp-live" role="status" aria-live="polite"[^>]*><p>Craft queued: Gate Blade\. 2 days reserved\.<\/p>/);
  assert.match(page, /data-theme="parchment" data-font="standard" data-layout="wide" style="--pfp-font-size:14px;"/);
});

test("every data-action the page uses is one the window handles", () => {
  const facts = makeFacts({ characters: [{ id: "a", name: "A" }, { id: "b", name: "B" }], queue: [{ id: "q", label: "Craft", days: 1 }], preview: okPlan(), researching: [{ id: "p", goalName: "Gate Draught", recipeId: "gate-draught", progress: 1, threshold: 4 }] });
  const html = renderHubMain(hubModel(facts, makeState({ picks: FULL, showQueue: true, showDisplay: true, showSwitch: true })));
  const used = new Set([...html.matchAll(/data-action="([a-z-]+)"/g)].map(m => m[1]));
  const handled = new Set(["switch-tab", "set-filter", "select-recipe", "pick-material", "clear-slot", "pick-station", "queue-craft", "ask-crafter", "toggle-queue", "cancel-queued", "toggle-display", "toggle-switch", "switch-character", "set-text-size", "set-theme", "set-font", "reset-display", "open-in-research"]);
  assert.deepEqual([...used].filter(a => !handled.has(a)), []);
  assert.ok(used.size >= 15, `covered ${used.size}`);
});

// THE LEAK SCANNER: no DC, odds, percentage or difficulty wording anywhere a player can read ---------------------------
test("LEAK SCANNER: no view-model, no string and no page has a DC, odds, a percentage or difficulty wording", () => {
  const states = [
    makeState(), makeState({ picks: FULL }), makeState({ recipeId: "gate-vest", picks: { hide: "gate-iron" } }), makeState({ tab: "research" }),
    makeState({ showQueue: true, showDisplay: true, showSwitch: true, layout: "narrow" })
  ];
  const factsList = [
    makeFacts(), makeFacts({ preview: okPlan(), learned: learnedStar }), makeFacts({ downtime: { open: false, participant: false } }), makeFacts({ recipes: {}, definitions: "loading" }),
    makeFacts({ preview: { ok: false, errors: ["Gate Star is too far from the Gate Bench."], plan: null }, queue: [{ id: "q", label: "Craft Gate Blade", days: 2 }], researching: [{ id: "p", goalName: "Gate Draught", recipeId: "gate-draught", progress: 3, threshold: 8 }] })
  ];
  let walked = 0;
  for (const facts of factsList) for (const state of states) {
    const model = hubModel(facts, state);
    assert.deepEqual(scanClean(model), [], JSON.stringify(state));
    const page = renderHubPage(model, ["Craft queued: Gate Blade. 2 days reserved."]);
    assert.doesNotMatch(sizeFree(text(page)), BAD, `page for ${JSON.stringify(state)}`);
    assert.doesNotMatch(page, /\?\?\?/);
    walked++;
  }
  assert.equal(walked, 25);
});

test("LEAK SCANNER: every string in strings.js, and what its functions say with sample words, is clean", () => {
  const seen = [];
  const walk = (value, path) => {
    if (typeof value === "string") seen.push([path, value]);
    else if (typeof value === "function") {
      const samples = [["Gate", "Star", "Test", 3, 4], [["Gate", "Star"], "Star", 3], ["Gate", ["sets the weapon's power"]], [3, "Gate"]];
      const said = samples.map(args => { try { return value(...args); } catch { return null; } }).find(x => typeof x === "string");
      assert.ok(said !== undefined, `${path} could not be called with any sample`);
      seen.push([path, said]);
    }
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
  };
  walk(S, "S");
  for (const noun of ["weapon", "armor"]) for (const role of Object.keys(S.slotRole)) seen.push([`slotRole.${role}`, S.slotRole[role](noun)]);
  seen.push(["reasonShort", S.reasonShort(["Gate Iron", "Gate Star"])], ["stationsHere", S.stationsHere(["Gate Bench"])], ["slotRoleLine", S.slotRoleLine("blade", ["sets the weapon's power"])]);
  assert.ok(seen.length > 60, `walked ${seen.length}`);
  assert.deepEqual(seen.filter(([, line]) => BAD.test(sizeFree(line))), []);
});
