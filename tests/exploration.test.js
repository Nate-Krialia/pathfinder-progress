import test from "node:test";
import assert from "node:assert/strict";
import { loadDefinitions, validateRecord } from "../scripts/data/validate.js";
import { EXPLORATION } from "../scripts/config.js";
import { chooseScene, exploreOdds, pickMany, pickSpawn, planExpedition, rollAnchorCount, simulateExpeditions } from "../scripts/exploration/plan.js";
import { activationUpdate, anchorTokenData, nodeImage, nodeTokenData, randomPositions, revertUpdate } from "../scripts/exploration/tokens.js";
import { formatGmSummary, formatPublicSummary } from "../scripts/exploration/summary.js";
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
const sceneWith = (id, n) => ({ id, name: `Scene ${id}`, preparedCount: 0, anchors: Array.from({ length: n }, (_, i) => ({ id: `${id}-t${i}`, record: clone(anchorRecord) })) });

test("planExpedition activates the rolled number of distinct anchors with valid explored nodes", () => {
  const result = planExpedition({ region, registry, degree: "success", scenes: [sceneWith("s", 8)], rng: seeded(7) });
  assert.ok(result.ok);
  const { plan } = result;
  assert.ok(plan.rolled >= 2 && plan.rolled <= 4);
  assert.equal(plan.activations.length, plan.rolled);
  assert.equal(new Set(plan.activations.map(a => a.tokenId)).size, plan.rolled);
  assert.deepEqual([plan.freeBefore, plan.freeAfter, plan.shortfall], [8, 8 - plan.rolled, 0]);
  for (const a of plan.activations) {
    assert.deepEqual([a.record.state, a.record.source, a.record.region], ["active", "explored", "oak-wood"]);
    assert.ok(region.spawnTable.some(e => e.nodeType === a.nodeType && e.tier === a.tier));
  }
});

test("planExpedition reports a shortfall, no scene, and no anchors with a fixing hint", () => {
  const few = planExpedition({ region, registry, degree: "criticalSuccess", scenes: [sceneWith("s", 1)], rng: seeded(3) });
  assert.deepEqual([few.plan.activations.length, few.plan.freeAfter], [1, 0]);
  assert.ok(few.plan.shortfall >= 2);
  const none = planExpedition({ region, registry, degree: "success", scenes: [], rng: seeded(3) });
  assert.deepEqual([none.ok, none.kind], [false, "noScene"]);
  assert.match(none.errors[0], /no scene is tagged "oak-wood" \(tag one with api\.tagScene/);
  const empty = planExpedition({ region, registry, degree: "success", scenes: [sceneWith("s", 0)], rng: seeded(3) });
  assert.equal(empty.kind, "noAnchors");
  assert.match(empty.errors[0], /Scene s\) have no free anchors/);
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
  assert.ok(Math.abs(sim.meanAnchors - exploreOdds(8, 18).expectedAnchors) < 0.02, `${sim.meanAnchors} vs ${exploreOdds(8, 18).expectedAnchors}`);
  assert.equal(sim.expectedMeanAnchors, exploreOdds(8, 18).expectedAnchors);
  const chances = exploreOdds(8, 18).chances;
  for (const [degree, p] of Object.entries(chances)) assert.ok(Math.abs(sim.degrees[degree] - p) < 0.01, degree);
  for (const s of sim.spawn) assert.ok(Math.abs(s.observed - s.expected) < 0.01, `${s.nodeType}: ${s.observed} vs ${s.expected}`);
  assert.throws(() => simulateExpeditions({ region, runs: 10, rng: seeded(1) }), /give a degree or a modifier/);
  assert.throws(() => simulateExpeditions({ region, runs: 0, degree: "success", rng: seeded(1) }), /runs must be/);
});

// Tokens ------------------------------------------------------------------------------------------------------------
test("token data: anchors are hidden and default-looking; nodes use their nodeType's image or the default", () => {
  const anchor = anchorTokenData({ x: 100, y: 200, record: anchorRecord });
  assert.deepEqual([anchor.name, anchor.hidden, anchor.texture.src, anchor.x, anchor.y], ["Anchor", true, EXPLORATION.anchorImg, 100, 200]);
  assert.deepEqual(anchor.flags["pathfinder-progress"].node, anchorRecord);
  const ore = registry.nodeType.get("ore");
  const herb = registry.nodeType.get("herb");
  assert.equal(nodeTokenData({ x: 0, y: 0, record: {}, nodeType: ore }).texture.src, ore.img);
  assert.equal(nodeImage(herb), EXPLORATION.defaultNodeImg, "no img: the default core icon");
  assert.equal(nodeTokenData({ x: 0, y: 0, record: {}, nodeType: herb }).name, "Herb Patch");
});

test("activationUpdate renames and re-images only a default-looking anchor; revertUpdate undoes it, removing added keys", () => {
  const ore = registry.nodeType.get("ore");
  const record = { ...anchorRecord, state: "active", source: "explored", nodeType: "ore", tier: 1, charges: 3 };
  const fresh = activationUpdate({ tokenId: "t1", record, nodeType: ore, currentName: "Anchor" });
  assert.deepEqual([fresh._id, fresh.hidden, fresh.name, fresh["texture.src"]], ["t1", false, "Ore Vein", ore.img]);
  const custom = activationUpdate({ tokenId: "t1", record, nodeType: ore, currentName: "My marker" });
  assert.equal(custom.name, undefined);
  assert.equal(custom["texture.src"], undefined);
  const undo = revertUpdate({ tokenId: "t1", before: { hidden: true, name: "Anchor", img: "a.svg", record: anchorRecord, addedKeys: ["nodeType", "tier", "charges"] } });
  assert.equal(undo["flags.pathfinder-progress.node.-=nodeType"], null);
  assert.equal(undo["flags.pathfinder-progress.node.state"], "anchor");
  assert.equal(undo.hidden, true);
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
test("the public line gives no scene name or node details; the GM summary has them, escaped", () => {
  const plan = { degree: "success", rolled: 3, scene: { name: "<b>Secret Grove</b>", preparedCount: 1 }, activations: [{ tokenId: "x" }], freeBefore: 2, freeAfter: 1, shortfall: 1 };
  const pub = formatPublicSummary({ actorName: "Aelwyn", regionName: "Oak Wood", degree: "success", days: 2 });
  assert.ok(!pub.includes("Secret Grove"));
  assert.match(pub, /Oak Wood/);
  const gm = formatGmSummary({ actorName: "Aelwyn", regionName: "Oak Wood", plan, skillName: "Survival", natural: 14, total: 22, dc: 18, nodes: [{ name: "Herb Patch", nodeType: "herb", tier: 1 }] });
  assert.ok(!gm.includes("<b>"), "escaped");
  assert.match(gm, /natural 14, total 22 vs DC 18/);
  assert.match(gm, /Rolled 3 anchor\(s\) but the scene only had 2/);
  assert.match(gm, /already prepared 1 time/);
  assert.match(gm, /Scene prepared, not launched/);
  assert.match(formatGmSummary({ actorName: "A", regionName: "R", plan, skillName: "S", natural: null, total: null, dc: 1, nodes: [] }), /forced result/);
});

// Queue handler (pure) ------------------------------------------------------------------------------------------------
test("explore validateSubmit: region, exact days, skill, and (GM only) scenes", () => {
  const v = (extra = {}) => HANDLERS.explore.validateSubmit({ params: { region: "oak-wood" }, days: 2, region, scenes: null, ...extra });
  assert.equal(v().ok, false, "two skills allowed: one must be named");
  assert.match(v().errors[0], /choose one with skill/);
  assert.deepEqual(v({ params: { region: "oak-wood", skill: "nature" } }), { ok: true, params: { region: "oak-wood", skill: "nature" } });
  assert.match(v({ params: { region: "oak-wood", skill: "arcana" } }).errors[0], /not allowed/);
  assert.match(v({ days: 1, params: { region: "oak-wood", skill: "nature" } }).errors[0], /take 2 day\(s\); reserve exactly that many \(got 1\)/);
  assert.match(v({ region: undefined }).errors[0], /unknown region/);
  const ok = { params: { region: "oak-wood", skill: "nature" } };
  assert.match(v({ ...ok, scenes: [] }).errors[0], /no scene is tagged "oak-wood"/);
  assert.match(v({ ...ok, scenes: [{ name: "S", anchors: [] }] }).errors[0], /no free anchors/);
  assert.equal(v({ ...ok, scenes: [{ name: "S", anchors: [1] }] }).ok, true);
});

test("explore describe shows the region, odds, expected nodes and the scene pool, and flags problems", () => {
  const action = { id: "q", type: "explore", params: { region: "oak-wood", skill: "nature" }, daysReserved: 2, submittedAt: 1 };
  const info = { region, skill: "nature", modifier: 8, odds: exploreOdds(8, 18), scenes: 2, freeAnchors: 5 };
  const d = HANDLERS.explore.describe({ action, info });
  assert.equal(d.label, "Explore: Oak Wood");
  assert.match(d.detail, /nature \+8 vs DC 18: crit \d+% \/ success \d+% \/ fail \d+% \/ crit-fail \d+%, expect ~\d\.\d nodes; 2 day\(s\); 2 tagged scene\(s\), 5 free anchor\(s\)/);
  assert.equal(d.problem, null);
  assert.match(HANDLERS.explore.describe({ action, info: { ...info, scenes: 0, freeAnchors: 0 } }).problem, /no scene is tagged "oak-wood"/);
  assert.match(HANDLERS.explore.describe({ action, info: { ...info, freeAnchors: 0 } }).problem, /no free anchors/);
  assert.match(HANDLERS.explore.describe({ action, info: { region: null } }).problem, /no longer exists/);
});
