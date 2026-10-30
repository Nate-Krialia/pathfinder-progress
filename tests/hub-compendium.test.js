/** The Compendium tab's view-model (Stage 11b round): every category and state, the share states, and the leak scanner. */
import test from "node:test";
import assert from "node:assert/strict";
import { S } from "../scripts/hub/strings.js";
import { hubModel, selectEntry, setCategory } from "../scripts/hub/viewmodels.js";
import { CATEGORIES, compendiumTab, shareRequest, shareState } from "../scripts/hub/viewmodels-compendium.js";
import { renderHubMain, renderHubPage } from "../scripts/hub/render.js";
import { BAD, scanClean, sizeFree } from "./scan.js";
import { BOOK_ENTRIES, STAR_EFFECT, compendiumFacts, compendiumState, makeBook, makeFacts } from "./hub-fixtures.js";

const text = html => html.replace(/<[^>]*>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const tab = (facts, state) => compendiumTab(facts, state);
const emptyLists = { materials: [], creatures: [], regions: [], experiments: [] };

test("COMPENDIUM: the four categories with counts, and the count line says how many you have found", () => {
  const t = tab(compendiumFacts(), compendiumState());
  assert.deepEqual(t.chips.map(c => `${c.label} ${c.count}${c.selected ? "*" : ""}`), ["Materials 2*", "Creatures 2", "Regions 1", "Experiments 1"]);
  assert.equal(t.countLine, "6 entries discovered. New ones appear as you find them.");
  const one = tab(compendiumFacts({ compendium: makeBook({ entries: { ...emptyLists, regions: BOOK_ENTRIES.regions } }) }), compendiumState());
  assert.equal(one.countLine, "1 entry discovered. New ones appear as you find them.");
  assert.deepEqual(CATEGORIES, ["materials", "creatures", "regions", "experiments"]);
});

test("COMPENDIUM: an empty category says plainly what you have not done yet, and never shows a placeholder", () => {
  const empty = compendiumFacts({ compendium: makeBook({ entries: emptyLists, own: emptyLists }) });
  for (const [category, line] of [["materials", "You haven't found any materials yet."], ["creatures", "You haven't met any creatures yet."], ["regions", "You haven't explored any regions yet."], ["experiments", "You haven't learned anything from crafting yet."]]) {
    const t = tab(empty, compendiumState({ category }));
    assert.deepEqual([t.list.empty, t.list.cards.length, t.detail.text], [line, 0, "Pick an entry on the left."], category);
  }
  assert.doesNotMatch(JSON.stringify(tab(compendiumFacts(), compendiumState())), /\?\?\?/);
  assert.equal(tab(empty, compendiumState()).countLine, "0 entries discovered. New ones appear as you find them.");
});

test("COMPENDIUM: a material shows its tier, where you found it, how you gathered it (in words, never a number), and what uses it", () => {
  const d = tab(compendiumFacts(), compendiumState({ entryKey: "gate-iron" })).detail;
  assert.deepEqual([d.title, d.meta], ["Gate Iron", "Tier 1"]);
  assert.deepEqual(d.sections.map(s => [s.heading, s.items, s.empty]), [["Where you found it", ["Gate Field"], null], ["How you gathered it", ["a basic find", "a better find"], null], ["Used in", ["Gate Blade"], null]]);
  const bare = tab(compendiumFacts(), compendiumState({ entryKey: "gate-star" })).detail;
  assert.deepEqual(bare.sections.map(s => s.empty), ["No places recorded yet.", "You haven't gathered it from a node yet.", "None of your formulae use it yet."]);
  assert.doesNotMatch(JSON.stringify(d), /gate-bush|nodeType|"rung"/, "no node tier or id leaks into the text");
});

test("COMPENDIUM: a creature shows only what you took from it; a region only the node types you found", () => {
  const wolf = tab(compendiumFacts(), compendiumState({ category: "creatures", entryKey: "gate-wolf" })).detail;
  assert.deepEqual([wolf.title, wolf.meta, wolf.sections[0].items], ["Gate Wolf", "Type: beast", ["Gate Fang"]]);
  const bat = tab(compendiumFacts(), compendiumState({ category: "creatures", entryKey: "gate-bat" })).detail;
  assert.deepEqual([bat.sections[0].items, bat.sections[0].empty], [[], "Nothing collected yet."]);
  const field = tab(compendiumFacts(), compendiumState({ category: "regions", entryKey: "gate-field" })).detail;
  assert.deepEqual([field.sections[0].heading, field.sections[0].items], ["Node types you found here", ["Gate Bush"]]);
});

test("COMPENDIUM: an experiment shows the baseline and each material learned per slot, in the craft form's own words", () => {
  const d = tab(compendiumFacts(), compendiumState({ category: "experiments", entryKey: "gate-blade" })).detail;
  assert.equal(d.title, "Gate Blade");
  assert.deepEqual(d.sections[0].items, [
    "A tier 1 result", "Blade needs tier 1 or higher", "Gate Iron sets the weapon's power (tier 1)", "Uses Gate Iron",
    "Edge needs tier 2 or higher", "A material you have not met adds +1d6 fire damage"
  ]);
  assert.deepEqual(d.known.items.map(k => [k.head, k.via, k.effects]), [
    ["Edge, Gate Star", "you crafted it", ["Gate Star adds +1d8 spirit damage"]],
    ["Blade, Gate Steel", "shared by the party", ["Gate Steel sets the weapon's power (tier 2)"]]
  ]);
  const noBaseline = tab(compendiumFacts({ compendium: makeBook({ entries: { ...BOOK_ENTRIES, experiments: [{ ...BOOK_ENTRIES.experiments[0], baseline: null, known: [] }] } }) }), compendiumState({ category: "experiments", entryKey: "gate-blade" })).detail;
  assert.deepEqual([noBaseline.sections[0].items, noBaseline.sections[0].empty, noBaseline.known.empty], [[], "Nothing learned beyond the basic recipe yet.", "Nothing learned beyond the basic recipe yet."]);
  assert.ok(STAR_EFFECT);
});

test("SHARING: Only you, Queued or Shared, always a word; the party's own entries read as Shared", () => {
  const facts = compendiumFacts();
  assert.equal(shareState(facts, "material", "gate-iron"), "private");
  assert.equal(shareState({ ...facts, shares: [{ actionId: "s1", kind: "material", key: "gate-iron" }] }, "material", "gate-iron"), "queued");
  // everything the character knows is already in the party's book
  const shared = makeBook({ shared: { ...emptyLists, materials: [{ ...BOOK_ENTRIES.materials[0] }] } });
  assert.equal(shareState({ ...facts, compendium: shared }, "material", "gate-iron"), "shared");
  // the character knows MORE than the party's copy: still private
  const behind = makeBook({ shared: { ...emptyLists, materials: [{ ...BOOK_ENTRIES.materials[0], places: [], rungs: [] }] } });
  assert.equal(shareState({ ...facts, compendium: behind }, "material", "gate-iron"), "private");
  // an entry only the party has
  const partyOnly = makeBook({ entries: { ...BOOK_ENTRIES, materials: [...BOOK_ENTRIES.materials, { id: "gate-moon", name: "Gate Moon", tier: 2, firstAt: 3, places: [], rungs: [], shared: true, usedIn: [] }] } });
  assert.equal(shareState({ ...facts, compendium: partyOnly }, "material", "gate-moon"), "shared");
  const pills = tab(facts, compendiumState()).list.cards.map(c => c.pill);
  assert.deepEqual(pills, ["Only you", "Only you"]);
  assert.deepEqual(Object.values(S.sharePill), ["Only you", "Queued", "Shared"]);
});

test("SHARING: the button shows only while there is something to share, becomes Cancel while queued, and the request exists only then", () => {
  const facts = compendiumFacts();
  const state = compendiumState({ entryKey: "gate-iron" });
  assert.deepEqual(tab(facts, state).detail.sharing, { pill: "Only you", text: "Only you can read this.", button: { text: "Share with the party" }, cancel: null });
  assert.deepEqual(shareRequest(facts, state), { kind: "material", key: "gate-iron", name: "Gate Iron" });
  const queued = { ...facts, shares: [{ actionId: "s1", kind: "material", key: "gate-iron" }] };
  assert.deepEqual(tab(queued, state).detail.sharing, { pill: "Queued", text: "Waiting for the GM to approve sharing it.", button: null, cancel: { text: "Cancel the share", actionId: "s1" } });
  assert.equal(shareRequest(queued, state), null, "no second share while one is waiting");
  const done = { ...facts, compendium: makeBook({ shared: { ...emptyLists, materials: [{ ...BOOK_ENTRIES.materials[0] }] } }) };
  assert.deepEqual(tab(done, state).detail.sharing, { pill: "Shared", text: "Everyone in the party can read this.", button: null, cancel: null });
  assert.equal(shareRequest(done, state), null, "nothing new to share");
  assert.equal(shareRequest(facts, compendiumState()), null, "no entry chosen");
  // kinds and keys match what the queue handler expects
  assert.deepEqual([["creatures", "gate-wolf"], ["regions", "gate-field"], ["experiments", "gate-blade"]].map(([category, entryKey]) => shareRequest(facts, compendiumState({ category, entryKey })).kind), ["creature", "region", "experiment"]);
});

test("SHARING: a creature, region or experiment that gained facts since it was shared is offered again", () => {
  const facts = compendiumFacts({ compendium: makeBook({ shared: { ...emptyLists, creatures: [{ ...BOOK_ENTRIES.creatures[0], yields: [] }], regions: [{ ...BOOK_ENTRIES.regions[0], nodeTypes: [] }], experiments: [{ ...BOOK_ENTRIES.experiments[0], known: [], baseline: null }] } }) });
  assert.deepEqual([shareState(facts, "creature", "gate-wolf"), shareState(facts, "region", "gate-field"), shareState(facts, "experiment", "gate-blade")], ["private", "private", "private"]);
});

test("COMPENDIUM: switching category clears the chosen entry; an unreadable Compendium says so; the list scrolls, it is never capped", () => {
  const state = compendiumState({ entryKey: "gate-iron" });
  assert.equal(setCategory(state, "creatures").entryKey, null);
  assert.equal(setCategory(state, "materials"), state);
  assert.equal(setCategory(state, "nonsense"), state);
  assert.equal(selectEntry(state, "gate-star").entryKey, "gate-star");
  const unreadable = tab(compendiumFacts({ compendium: null }), compendiumState());
  assert.equal(unreadable.unavailable, "The Compendium could not be read right now.");
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `gate-m${i}`, name: `Gate Material ${i}`, tier: 1 + (i % 5), firstAt: i, places: [], rungs: [], shared: false, usedIn: [] }));
  assert.equal(tab(compendiumFacts({ compendium: makeBook({ entries: { ...BOOK_ENTRIES, materials: many }, own: { ...emptyLists, materials: many } }) }), compendiumState()).list.cards.length, 60);
});

test("COMPENDIUM LEAK SCANNER: no category, no entry, no page and no string has a DC, odds, a percentage or difficulty wording", () => {
  const facts = [compendiumFacts(), compendiumFacts({ compendium: null }), compendiumFacts({ shares: [{ actionId: "s1", kind: "material", key: "gate-iron" }] }), makeFacts({ compendium: makeBook({ entries: emptyLists, own: emptyLists }), shares: [] })];
  let n = 0;
  for (const f of facts) for (const category of CATEGORIES) for (const entryKey of [null, "gate-iron", "gate-star", "gate-wolf", "gate-bat", "gate-field", "gate-blade"]) {
    const model = hubModel(f, compendiumState({ category, entryKey }));
    assert.deepEqual(scanClean(model), [], `${category}/${entryKey}`);
    assert.doesNotMatch(sizeFree(text(renderHubPage(model, ["Share queued: Gate Iron. Waiting for the GM."]))), BAD);
    assert.doesNotMatch(JSON.stringify(model), /\?\?\?/);
    n++;
  }
  assert.equal(n, 112);
});

test("COMPENDIUM: every control is a real button; an entry card names the entry it opens; the page has the sharing word beside every pill colour", () => {
  const html = renderHubMain(hubModel(compendiumFacts({ shares: [{ actionId: "s1", kind: "material", key: "gate-star" }] }), compendiumState({ entryKey: "gate-iron" })));
  assert.doesNotMatch(html, /<div[^>]*(onclick|role="button")|<a [^>]*href/);
  const actions = new Set([...html.matchAll(/data-action="([a-z-]+)"/g)].map(m => m[1]));
  for (const a of ["set-category", "select-entry", "share-entry"]) assert.ok(actions.has(a), a);
  assert.match(html, /data-action="select-entry"[^>]*data-entry="gate-iron"/);
  assert.match(text(html), /Only you/);
  assert.match(text(html), /Queued/);
});
