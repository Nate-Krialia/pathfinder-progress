import test from "node:test";
import assert from "node:assert/strict";
import { loadDefinitions, validateRecord } from "../scripts/data/validate.js";
import { EXPLORATION } from "../scripts/config.js";
import { chooseScene, exploreOdds, perceptionDcFor, pickMany, pickSpawn, planExpedition, rollAnchorCount, rollEncounter, simulateExpeditions } from "../scripts/exploration/plan.js";
import { anchorTokenData, nodeImage, nodeTokenData, occupyUpdate, randomPositions, revealUpdate, unrevealUpdate, vacateUpdate } from "../scripts/exploration/tokens.js";
import { formatGmSummary } from "../scripts/exploration/summary.js";
import * as summaryModule from "../scripts/exploration/summary.js";
import { SEARCHED_ALREADY_TEXT, SEARCH_TEXT, searchMessage, spottedIds } from "../scripts/exploration/search.js";
import { nodeActorData } from "../scripts/adapter/pf2e.js";
import { HANDLERS } from "../scripts/queue/handlers.js";
import { asPage, clone, seedRecords } from "./helpers.js";

const seeds = seedRecords();
const registry = loadDefinitions(seeds.map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }))).registry;
const region = registry.region.get("oak-wood");

/** Seeded random numbers (mulberry32), so statistical tests are repeatable. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sequence = values => { let i = 0; return () => values[i++ % values.length]; };

// Definitions --------------------------------------------------------------------------------------
test("the seed regions load cleanly and only use node types and tiers that have ladders", () => {
  const { errors } = loadDefinitions(seeds.map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) })));
  assert.deepEqual(errors, []);
  assert.deepEqual([...registry.region.keys()].sort(), ["barren-ridge", "oak-wood"]);
  for (const r of registry.region.values()) {
    for (const e of r.spawnTable) assert.ok(registry.nodeType.get(e.nodeType).ladders[String(e.tier)], `${r.id}: ${e.nodeType} tier ${e.tier}`);
  }
});

const loadWith = record => loadDefinitions([...seeds.map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) })), { pack: "test", entry: "r", text: asPage(record) }]);
const withTable = spawnTable => ({ ...clone(region), id: "test-region", spawnTable });

test("a region naming an unknown nodeType or a tier with no ladder is rejected, naming the entry and field", () => {
  const unknown = loadWith(withTable([{ nodeType: "geode", tier: 1, weight: 1 }])).errors;
  assert.equal(unknown.length, 1);
  assert.match(unknown[0].field, /^spawnTable\[0\]\.nodeType$/);
  assert.match(unknown[0].message, /unknown nodeType "geode" \(known: .*herb/);

  const noTier = loadWith(withTable([{ nodeType: "herb", tier: 3, weight: 1 }])).errors;
  assert.match(noTier[0].field, /^spawnTable\[0\]\.tier$/);
  assert.match(noTier[0].message, /nodeType "herb" has no tier-3 ladder \(tiers with a ladder: 1\)/);

  const corpse = loadWith(withTable([{ nodeType: "corpse", tier: 1, weight: 1 }])).errors;
  assert.match(corpse[0].message, /has no tier-1 ladder \(tiers with a ladder: none\)/, "corpse nodes cannot spawn");
  assert.equal(loadWith(withTable([{ nodeType: "herb", tier: 3, weight: 1 }])).registry.region.has("test-region"), false, "a bad region is not usable");
});

test("region schema: weights, duplicates, skills, name and days", () => {
  const ctx = { pack: "p", entry: "e" };
  const bad = patch => validateRecord("region", { ...clone(region), ...patch }, ctx).map(e => `${e.field} ${e.message}`);
  assert.deepEqual(bad({}), []);
  assert.match(bad({ spawnTable: [{ nodeType: "herb", tier: 1, weight: 0 }] }).join(), /at least one entry with a weight above 0/);
  assert.match(bad({ spawnTable: [{ nodeType: "herb", tier: 1, weight: 1 }, { nodeType: "herb", tier: 1, weight: 2 }] }).join(), /repeats nodeType "herb" at tier 1/);
  assert.match(bad({ spawnTable: [{ nodeType: "herb", tier: 1, weight: -1 }] }).join(), /weight/);
  assert.match(bad({ skillWhitelist: ["jumping"] }).join(), /not a PF2e skill/);
  assert.match(bad({ skillWhitelist: [] }).join(), /skillWhitelist/);
  assert.match(bad({ name: undefined }).join(), /name/);
  assert.match(bad({ daysRequired: 0 }).join(), /daysRequired/);
  for (const ok of ["low", "moderate", "high"]) assert.deepEqual(bad({ danger: ok }), [], ok);
  assert.match(bad({ danger: "deadly" }).join(), /danger/);
  assert.deepEqual(bad({ danger: undefined }), [], "danger is optional (moderate)");
  assert.match(bad({ spawnTable: [{ nodeType: "herb", tier: 9, weight: 1 }] }).join(), /tier/);
});

// Counts and spawns -----------------------------------------------------------------------------------
test("anchor counts stay inside the configured range for each degree, and hit both ends", () => {
  for (const [degree, { min, max }] of Object.entries(EXPLORATION.anchorCounts)) {
    assert.equal(rollAnchorCount(degree, () => 0), min, `${degree} low`);
    assert.equal(rollAnchorCount(degree, () => 0.999999), max, `${degree} high`);
  }
  assert.throws(() => rollAnchorCount("wonderful", () => 0), /unknown degree/);
});

test("pickSpawn follows the weights exactly at the boundaries and never picks weight 0", () => {
  const table = [{ nodeType: "a", tier: 1, weight: 5 }, { nodeType: "z", tier: 1, weight: 0 }, { nodeType: "b", tier: 1, weight: 3 }];
  const pick = r => pickSpawn(table, () => r).nodeType;
  assert.deepEqual([0, 0.62, 0.625, 0.99].map(pick), ["a", "a", "b", "b"]);
  assert.throws(() => pickSpawn([{ nodeType: "a", tier: 1, weight: 0 }], () => 0), /no weight/);
});

test("pickMany returns distinct items, all of them when asked for more than exist", () => {
  const picked = pickMany([1, 2, 3, 4, 5], 3, seeded(1));
  assert.equal(new Set(picked).size, 3);
  assert.deepEqual(pickMany([1, 2], 5, seeded(1)).sort(), [1, 2]);
  assert.deepEqual(pickMany([], 2, seeded(1)), []);
});

test("chooseScene prefers scenes with enough anchors, else the roomiest; none usable gives null", () => {
  const scene = (id, n) => ({ id, name: id, anchors: Array.from({ length: n }, (_, i) => ({ id: `${id}${i}` })) });
  const scenes = [scene("a", 1), scene("b", 4), scene("c", 6), scene("d", 0)];
  for (let i = 0; i < 20; i++) assert.ok(["b", "c"].includes(chooseScene(scenes, 3, seeded(i)).id));
  assert.equal(chooseScene(scenes, 9, seeded(1)).id, "c", "nobody has 9: the roomiest wins");
  assert.equal(chooseScene([scene("d", 0)], 1, seeded(1)), null);
  assert.equal(chooseScene([], 1, seeded(1)), null);
});

// planExpedition ----------------------------------------------------------------------------------------
const anchorRecord = { source: "placed", state: "anchor", discoveredBy: [] };
const sceneWith = (id, free, { occupied = 0 } = {}) => ({
  id, name: `Scene ${id}`, preparedCount: 0, totalAnchors: free + occupied,
  anchors: Array.from({ length: free }, (_, i) => ({ id: `${id}-t${i}`, x: 100 * i, y: 200, record: clone(anchorRecord) }))
});

test("planExpedition places hidden nodes on distinct free anchors, with Perception DCs, at the anchors' positions", () => {
  const result = planExpedition({ region, registry, degrees: ["success"], scenes: [sceneWith("s", 8)], rng: seeded(7) });
  assert.ok(result.ok);
  const { plan } = result;
  assert.ok(plan.rolled >= 2 && plan.rolled <= 4);
  assert.equal(plan.activations.length, plan.rolled);
  assert.equal(new Set(plan.activations.map(a => a.anchorId)).size, plan.rolled);
  assert.deepEqual([plan.freeBefore, plan.freeAfter, plan.notPlaced], [8, 8 - plan.rolled, 0]);
  for (const a of plan.activations) {
    assert.deepEqual([a.record.state, a.record.source, a.record.region, a.record.revealed, a.record.anchorId], ["active", "explored", "oak-wood", false, a.anchorId]);
    assert.equal(a.record.perceptionDC, perceptionDcFor(a.tier));
    assert.equal(a.y, 200);
    assert.ok(region.spawnTable.some(e => e.nodeType === a.nodeType && e.tier === a.tier));
  }
});

test("each day of exploring is its own roll and the counts add up", () => {
  const one = planExpedition({ region, registry, degrees: ["criticalFailure"], scenes: [sceneWith("s", 30)], rng: seeded(1) }).plan;
  assert.equal(one.rolled, 1);
  const three = planExpedition({ region, registry, degrees: ["criticalFailure", "criticalFailure", "criticalFailure"], scenes: [sceneWith("s", 30)], rng: seeded(1) }).plan;
  assert.equal(three.rolled, 3, "3 days of critical failures = 3 nodes");
  const mixed = planExpedition({ region, registry, degrees: ["criticalSuccess", "criticalFailure"], scenes: [sceneWith("s", 30)], rng: seeded(2) }).plan;
  assert.ok(mixed.rolled >= 4 && mixed.rolled <= 6);
});

test("fewer free anchors than nodes: the extra nodes are simply not placed; no scene and no anchors are errors", () => {
  const few = planExpedition({ region, registry, degrees: ["criticalSuccess"], scenes: [sceneWith("s", 1)], rng: seeded(3) });
  assert.deepEqual([few.plan.activations.length, few.plan.freeAfter], [1, 0]);
  assert.ok(few.plan.notPlaced >= 2);
  const allTaken = planExpedition({ region, registry, degrees: ["success"], scenes: [sceneWith("s", 0, { occupied: 4 })], rng: seeded(3) });
  assert.ok(allTaken.ok, "every anchor occupied is not an error");
  assert.deepEqual([allTaken.plan.activations.length, allTaken.plan.notPlaced > 0], [0, true]);
  const none = planExpedition({ region, registry, degrees: ["success"], scenes: [], rng: seeded(3) });
  assert.deepEqual([none.ok, none.kind], [false, "noScene"]);
  assert.match(none.errors[0], /no scene is tagged "oak-wood" \(tag one with api\.tagScene/);
  const empty = planExpedition({ region, registry, degrees: ["success"], scenes: [sceneWith("s", 0)], rng: seeded(3) });
  assert.equal(empty.kind, "noAnchors");
  assert.match(empty.errors[0], /Scene s\) have no anchors at all/);
});

// The encounter is ONE roll per expedition ------------------------------------------------------------------------
test("rollEncounter: force combat is certain; otherwise the region's danger sets the chance, rolled once", () => {
  assert.deepEqual(rollEncounter({ danger: "low", forceCombat: true, rng: () => 0.999 }), { encounter: true, forced: true, chance: 1, roll: null });
  assert.deepEqual(rollEncounter({ danger: "low", rng: () => 0.19 }), { encounter: true, forced: false, chance: 0.2, roll: 0.19 });
  assert.equal(rollEncounter({ danger: "low", rng: () => 0.2 }).encounter, false);
  assert.equal(rollEncounter({ danger: "moderate", rng: () => 0.34 }).encounter, true);
  assert.equal(rollEncounter({ danger: "high", rng: () => 0.49 }).encounter, true);
  assert.equal(rollEncounter({ danger: "high", rng: () => 0.5 }).encounter, false);
  assert.equal(rollEncounter({ rng: () => 0.34 }).chance, 0.35, "no danger set means moderate");
  assert.throws(() => rollEncounter({ danger: "deadly", rng: () => 0 }), /unknown danger "deadly"/);
  let draws = 0;
  rollEncounter({ danger: "high", rng: () => { draws++; return 0.9; } });
  assert.equal(draws, 1);
});

test("STATISTICS: encounter frequency matches the danger, and a long trip does not make a fight likelier", () => {
  for (const [danger, p] of [["low", 0.2], ["moderate", 0.35], ["high", 0.5]]) {
    const rng = seeded(77);
    const n = 100_000;
    let hits = 0;
    for (let i = 0; i < n; i++) if (rollEncounter({ danger, rng }).encounter) hits++;
    assert.ok(Math.abs(hits / n - p) < 4 * Math.sqrt(p * (1 - p) / n), `${danger}: ${hits / n}`);
  }
  const short = simulateExpeditions({ region, runs: 60_000, degree: "success", days: 1, rng: seeded(5) });
  const long = simulateExpeditions({ region, runs: 60_000, degree: "success", days: 10, rng: seeded(6) });
  assert.ok(Math.abs(short.encounterRate - 0.35) < 0.012 && Math.abs(long.encounterRate - 0.35) < 0.012, `${short.encounterRate} vs ${long.encounterRate}`);
  assert.equal(simulateExpeditions({ region, runs: 500, degree: "success", forceCombat: true, rng: seeded(1) }).encounterRate, 1);
});

// Odds and statistics -----------------------------------------------------------------------------------------
test("exploreOdds: +8 vs DC 20 is 10/45/40/5 (crit fail/fail/success/crit success) and 2.175 anchors", () => {
  const { chances, expectedAnchors } = exploreOdds(8, 20);
  assert.deepEqual(chances, { criticalFailure: 0.1, failure: 0.45, success: 0.4, criticalSuccess: 0.05 });
  assert.ok(Math.abs(expectedAnchors - 2.175) < 1e-9, "0.05*4 + 0.4*3 + 0.45*1.5 + 0.1*1");
});

test("STATISTICS: spawn frequencies match weight / total within 4 sigma", () => {
  const n = 200_000;
  const rng = seeded(2024);
  const tally = new Map();
  for (let i = 0; i < n; i++) { const e = pickSpawn(region.spawnTable, rng); tally.set(e.nodeType, (tally.get(e.nodeType) ?? 0) + 1); }
  const total = region.spawnTable.reduce((s, e) => s + e.weight, 0);
  for (const e of region.spawnTable) {
    const p = e.weight / total;
    const sigma = Math.sqrt(p * (1 - p) / n);
    assert.ok(Math.abs(tally.get(e.nodeType) / n - p) < 4 * sigma, `${e.nodeType}: ${tally.get(e.nodeType) / n} vs ${p}`);
  }
});

test("STATISTICS: each count in a degree's range is equally likely, and the mean matches", () => {
  const n = 120_000;
  for (const [degree, { min, max }] of Object.entries(EXPLORATION.anchorCounts)) {
    const rng = seeded(11);
    const tally = {};
    let sum = 0;
    for (let i = 0; i < n; i++) { const c = rollAnchorCount(degree, rng); tally[c] = (tally[c] ?? 0) + 1; sum += c; }
    assert.deepEqual(Object.keys(tally).map(Number).sort(), Array.from({ length: max - min + 1 }, (_, i) => min + i), degree);
    const p = 1 / (max - min + 1);
    if (max > min) for (const c of Object.values(tally)) assert.ok(Math.abs(c / n - p) < 4 * Math.sqrt(p * (1 - p) / n), `${degree} uniform`);
    assert.ok(Math.abs(sum / n - (min + max) / 2) < 0.02, `${degree} mean`);
  }
});

test("STATISTICS: simulateExpeditions with a modifier matches the exact expected mean and spawn weights", () => {
  const sim = simulateExpeditions({ region, runs: 100_000, modifier: 8 - 0, rng: seeded(99) });
  // oak-wood is DC 18, so recompute the exact expectation for +8 vs DC 18.
  assert.ok(Math.abs(sim.meanNodes - exploreOdds(8, 18).expectedAnchors) < 0.02, `${sim.meanNodes} vs ${exploreOdds(8, 18).expectedAnchors}`);
  assert.equal(sim.expectedMeanNodes, exploreOdds(8, 18).expectedAnchors);
  const trip = simulateExpeditions({ region, runs: 60_000, modifier: 8, days: 3, rng: seeded(12) });
  assert.ok(Math.abs(trip.meanNodes - 3 * exploreOdds(8, 18).expectedAnchors) < 0.05, `${trip.meanNodes} vs ${trip.expectedMeanNodes}`);
  assert.ok(Math.abs(trip.expectedMeanNodes - 3 * exploreOdds(8, 18).expectedAnchors) < 1e-9);
  const chances = exploreOdds(8, 18).chances;
  for (const [degree, p] of Object.entries(chances)) assert.ok(Math.abs(sim.degrees[degree] - p) < 0.01, degree);
  for (const s of sim.spawn) assert.ok(Math.abs(s.observed - s.expected) < 0.01, `${s.nodeType}: ${s.observed} vs ${s.expected}`);
  assert.throws(() => simulateExpeditions({ region, runs: 10, rng: seeded(1) }), /give a degree or a modifier/);
  assert.throws(() => simulateExpeditions({ region, runs: 0, degree: "success", rng: seeded(1) }), /runs must be/);
});

// Tokens ------------------------------------------------------------------------------------------------------------
test("token data: anchors are hidden and default-looking; nodes use their nodeType's image and can be made hidden", () => {
  const anchor = anchorTokenData({ x: 100, y: 200, record: anchorRecord });
  assert.deepEqual([anchor.name, anchor.hidden, anchor.texture.src, anchor.x, anchor.y], ["Anchor", true, EXPLORATION.anchorImg, 100, 200]);
  assert.deepEqual(anchor.flags["pathfinder-progress"].node, anchorRecord);
  const ore = registry.nodeType.get("ore");
  const herb = registry.nodeType.get("herb");
  assert.equal(nodeTokenData({ x: 0, y: 0, record: {}, nodeType: ore }).texture.src, ore.img);
  assert.equal(nodeImage(herb), EXPLORATION.defaultNodeImg, "no img: the default core icon");
  assert.equal(nodeTokenData({ x: 0, y: 0, record: {}, nodeType: herb }).name, "Herb Patch");
  assert.equal(nodeTokenData({ x: 0, y: 0, record: {}, nodeType: herb }).hidden, false);
  assert.equal(nodeTokenData({ x: 0, y: 0, record: {}, nodeType: herb, hidden: true }).hidden, true);
});

test("occupy / vacate / reveal / unreveal updates touch only the keys they mean to", () => {
  const p = "flags.pathfinder-progress.node";
  assert.deepEqual(occupyUpdate("a1", "n1"), { _id: "a1", [`${p}.occupiedBy`]: "n1" });
  assert.deepEqual(vacateUpdate("a1"), { _id: "a1", [`${p}.-=occupiedBy`]: null });
  assert.deepEqual(revealUpdate("n1", "Aelwyn"), { _id: "n1", hidden: false, [`${p}.revealed`]: true, [`${p}.revealedBy`]: "Aelwyn" });
  assert.deepEqual(unrevealUpdate("n1"), { _id: "n1", hidden: true, [`${p}.revealed`]: false, [`${p}.-=revealedBy`]: null });
});

test("randomPositions: grid-snapped, inside the padding, distinct, avoiding occupied squares, fewer when full", () => {
  const area = { x: 100, y: 100, width: 500, height: 500 }; // 5x5 squares of 100
  const pts = randomPositions(5, { area, gridSize: 100, padding: 1, rng: seeded(5) });
  assert.equal(pts.length, 5);
  assert.equal(new Set(pts.map(p => `${p.x},${p.y}`)).size, 5);
  for (const p of pts) assert.ok(p.x >= 200 && p.x <= 400 && p.y >= 200 && p.y <= 400 && (p.x - 100) % 100 === 0, JSON.stringify(p));
  assert.equal(randomPositions(50, { area, gridSize: 100, padding: 1, rng: seeded(5) }).length, 9, "3x3 usable squares");
  const left = randomPositions(9, { area, gridSize: 100, padding: 1, occupied: [{ x: 300, y: 300 }], rng: seeded(5) });
  assert.equal(left.length, 8);
  assert.ok(!left.some(p => p.x === 300 && p.y === 300));
  assert.deepEqual(randomPositions(3, { area: { x: 0, y: 0, width: 100, height: 100 }, gridSize: 100, padding: 1, rng: seeded(1) }), []);
});

// Resource Node actor data ------------------------------------------------------------------------------------------
test("the node actor is a neutral, unlinked, hover-named, ownerless loot actor found by flag", () => {
  const data = nodeActorData({ name: "Resource Node", img: "i.svg", flagScope: "pathfinder-progress", flagKey: "nodeActor" });
  assert.equal(data.type, "loot");
  assert.equal(data.ownership.default, 0);
  assert.equal(data.flags["pathfinder-progress"].nodeActor, true);
  const t = data.prototypeToken;
  assert.deepEqual([t.actorLink, t.disposition, t.displayName, t.displayBars, t.width, t.height, t.lockRotation, t.sight.enabled], [false, 0, 30, 0, 1, 1, true, false]);
});

// Summaries -----------------------------------------------------------------------------------------------------------
test("an expedition has NO public summary; the GM summary has everything, escaped, and nothing leaks into a player-facing function", () => {
  assert.equal(summaryModule.formatPublicSummary, undefined, "there is no public flavour line any more");
  const plan = { degrees: ["success"], rolled: 3, scene: { name: "<b>Secret Grove</b>", preparedCount: 1 }, activations: [{ tokenId: "x" }], freeBefore: 2, freeAfter: 1, notPlaced: 1 };
  const gm = formatGmSummary({
    actorName: "Aelwyn", regionName: "Oak Wood", plan, skillName: "Survival", dc: 18,
    rolls: [{ degree: "success", natural: 14, total: 22 }, { degree: "failure", natural: null, total: null }],
    encounter: { encounter: true, forced: true, chance: 1 }, nodes: [{ name: "Herb Patch", nodeType: "herb", tier: 1, perceptionDC: 14 }], searchedBy: ["Borin"]
  });
  assert.ok(!gm.includes("<b>"), "escaped");
  assert.match(gm, /day 1: natural 14, total 22 vs DC 18 = success; day 2: forced = failure/);
  assert.match(gm, /ENCOUNTER \(the party forced combat\)/);
  assert.match(gm, /Herb Patch: herb, tier 1, hidden, Perception DC 14/);
  assert.match(gm, /3 node\(s\) were found but only 2 free anchor\(s\) were left, so 1 were not placed/);
  assert.match(gm, /Already searched here: Borin\. Reset with api\.resetSearches/);
  assert.match(gm, /Scene prepared, not launched/);
  const calm = formatGmSummary({ actorName: "A", regionName: "R", plan, skillName: "S", dc: 1, rolls: [{ degree: "success", natural: 5, total: 9 }], encounter: { encounter: false, forced: false, chance: 0.35 }, nodes: [] });
  assert.match(calm, /no encounter \(35% chance\)/);
});

// Searching -----------------------------------------------------------------------------------------------------------------
test("a search spots every hidden node whose DC the Perception total meets", () => {
  const nodes = [{ id: "a", dc: 14 }, { id: "b", dc: 20 }, { id: "c", dc: 14 }];
  assert.deepEqual(spottedIds(13, nodes), []);
  assert.deepEqual(spottedIds(14, nodes), ["a", "c"]);
  assert.deepEqual(spottedIds(25, nodes), ["a", "b", "c"]);
  assert.deepEqual(spottedIds(99, []), []);
});

test("the player's message is IDENTICAL for a failed search and an empty scene, and never counts what is left", () => {
  assert.equal(searchMessage([]), SEARCH_TEXT);
  assert.equal(SEARCH_TEXT, "You search the area.");
  assert.equal(searchMessage(["Herb Patch"]), "You search the area. You spot: Herb Patch.");
  assert.equal(searchMessage(["Herb Patch", "Ore Vein"]), "You search the area. You spot: Herb Patch, Ore Vein.");
  for (const text of [searchMessage([]), searchMessage(["X"]), SEARCHED_ALREADY_TEXT]) {
    assert.doesNotMatch(text, /remain|left|more|other|hidden|\d/i, `"${text}" must not hint at what else is out there`);
  }
});

// Queue handler (pure) ------------------------------------------------------------------------------------------------
test("explore validateSubmit: region, days from the region's minimum, force combat, skill, and (GM only) scenes", () => {
  const v = (extra = {}) => HANDLERS.explore.validateSubmit({ params: { region: "oak-wood" }, days: 2, region, scenes: null, ...extra });
  assert.equal(v().ok, false, "two skills allowed: one must be named");
  assert.match(v().errors[0], /choose one with skill/);
  const nature = { region: "oak-wood", skill: "nature" };
  assert.deepEqual(v({ params: nature }), { ok: true, params: { region: "oak-wood", skill: "nature", forceCombat: false } });
  assert.deepEqual(v({ params: { ...nature, forceCombat: true }, days: 5 }).params, { region: "oak-wood", skill: "nature", forceCombat: true });
  assert.match(v({ params: nature, days: 1 }).errors[0], /takes at least 2 day\(s\) to explore \(got 1\)/);
  assert.match(v({ params: nature, days: 11 }).errors[0], /at most 10 days/);
  assert.match(v({ params: nature, days: 2.5 }).errors[0], /at least 2/);
  assert.match(v({ params: { ...nature, forceCombat: "yes" } }).errors[0], /true or false/);
  assert.match(v({ params: { region: "oak-wood", skill: "arcana" } }).errors[0], /not allowed/);
  assert.match(v({ region: undefined }).errors[0], /unknown region/);
  assert.match(v({ params: nature, scenes: [] }).errors[0], /no scene is tagged "oak-wood"/);
  assert.match(v({ params: nature, scenes: [{ name: "S", anchors: [], totalAnchors: 0 }] }).errors[0], /have no anchors/);
  assert.equal(v({ params: nature, scenes: [{ name: "S", anchors: [], totalAnchors: 3 }] }).ok, true, "all anchors occupied is allowed");
});

test("explore describe shows the region, odds for the whole trip, force combat, and the scene pool, and flags problems", () => {
  const action = { id: "q", type: "explore", params: { region: "oak-wood", skill: "nature", forceCombat: true }, daysReserved: 3, submittedAt: 1 };
  const info = { region, skill: "nature", modifier: 8, odds: exploreOdds(8, 18), scenes: 2, freeAnchors: 5, totalAnchors: 7 };
  const d = HANDLERS.explore.describe({ action, info });
  assert.equal(d.label, "Explore: Oak Wood");
  assert.match(d.detail, /nature \+8 vs DC 18: crit \d+% \/ success \d+% \/ fail \d+% \/ crit-fail \d+%, expect ~\d+\.\d nodes; 3 day\(s\); FORCE COMBAT; 2 tagged scene\(s\), 5 free anchor\(s\) of 7/);
  assert.equal(d.problem, null);
  assert.match(HANDLERS.explore.describe({ action, info: { ...info, scenes: 0, freeAnchors: 0, totalAnchors: 0 } }).problem, /no scene is tagged "oak-wood"/);
  assert.match(HANDLERS.explore.describe({ action, info: { ...info, totalAnchors: 0, freeAnchors: 0 } }).problem, /no anchors/);
  assert.match(HANDLERS.explore.describe({ action, info: { region: null } }).problem, /no longer exists/);
});
