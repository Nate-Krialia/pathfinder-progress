/**
 * The maths of an expedition. Pure; no Foundry globals. Randomness is injected: `rng()` returns
 * a number in [0, 1), like Math.random.
 *
 * Order: the check's degree decides how many anchors activate; a scene is chosen; that many
 * free anchors are picked at random; each rolls the region's spawn table for a node type and tier.
 */
import { EXPLORATION } from "../config.js";
import { degreeChances, degreeIndex, DEGREE_NAMES } from "../checks.js";
import { makeNodeRecord } from "../gathering/node.js";
import { check } from "../data/schema.js";
import { LIVE_SCHEMAS } from "../data/schemas.js";

const randomInt = (min, max, rng) => min + Math.floor(rng() * (max - min + 1));

/** How many anchors this degree activates (a uniform roll inside the configured range). */
export function rollAnchorCount(degree, rng, config = EXPLORATION) {
  const range = config.anchorCounts[degree];
  if (!range) throw new Error(`rollAnchorCount: unknown degree "${degree}"`);
  return randomInt(range.min, range.max, rng);
}

/** Pick one spawn-table entry by weight. Entries with weight 0 are never picked. */
export function pickSpawn(table, rng) {
  const total = table.reduce((sum, e) => sum + e.weight, 0);
  if (!(total > 0)) throw new Error("pickSpawn: the spawn table has no weight");
  let roll = rng() * total;
  for (const entry of table) {
    if (entry.weight <= 0) continue;
    if (roll < entry.weight) return entry;
    roll -= entry.weight;
  }
  return [...table].reverse().find(e => e.weight > 0); // rounding guard: rng() is below 1, but be safe
}

/** `n` distinct items picked at random (or all of them if there are fewer). */
export function pickMany(items, n, rng) {
  const pool = [...items];
  const picked = [];
  while (picked.length < n && pool.length) picked.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return picked;
}

/**
 * Choose the scene: among scenes with free anchors, prefer those with at least `count`; if none
 * has that many, use the ones with the most. Then pick one at random.
 * @param {Array<{ anchors: any[] }>} scenes
 */
export function chooseScene(scenes, count, rng) {
  const usable = scenes.filter(s => s.anchors.length > 0);
  if (!usable.length) return null;
  const roomy = usable.filter(s => s.anchors.length >= count);
  const best = roomy.length ? roomy : usable.filter(s => s.anchors.length === Math.max(...usable.map(u => u.anchors.length)));
  return best[Math.floor(rng() * best.length)];
}

/**
 * The encounter is rolled ONCE per expedition (a long trip must not make a fight near-certain).
 * forceCombat guarantees it. @returns {{ encounter: boolean, forced: boolean, chance: number, roll: number|null }}
 */
export function rollEncounter({ danger = "moderate", forceCombat = false, rng, config = EXPLORATION }) {
  if (forceCombat) return { encounter: true, forced: true, chance: 1, roll: null };
  const chance = config.encounterChance[danger];
  if (typeof chance !== "number") throw new Error(`rollEncounter: unknown danger "${danger}" (use ${Object.keys(config.encounterChance).join(", ")})`);
  const roll = rng();
  return { encounter: roll < chance, forced: false, chance, roll };
}

/** The Perception DC to spot a hidden node of this tier. */
export function perceptionDcFor(tier, config = EXPLORATION) {
  const dc = config.perceptionDcByTier[tier];
  if (!Number.isInteger(dc)) throw new Error(`perceptionDcFor: no Perception DC configured for node tier ${tier}`);
  return dc;
}

/**
 * Plan an expedition without touching anything. One degree per day of exploring; each day's degree rolls
 * its own anchor count, and the counts add up. The nodes are placed HIDDEN, on new tokens at free anchors'
 * positions; the anchors stay (marked occupied by the caller) and extra nodes with no free anchor are simply
 * not placed.
 * @param {object} args
 * @param {object} args.region    a validated region definition
 * @param {object} args.registry  loaded definitions (to validate the nodes it builds)
 * @param {string[]} args.degrees one exploration-check degree per day
 * @param {Array<{ id: string, name: string, totalAnchors: number, preparedCount?: number, anchors: Array<{ id: string, x: number, y: number }> }>} args.scenes
 *        the scenes tagged for this region; `anchors` are the FREE ones
 * @returns {{ ok: true, plan: object } | { ok: false, kind: "noScene" | "noAnchors" | "invalidNode", errors: string[] }}
 */
export function planExpedition({ region, registry, degrees, scenes, rng, config = EXPLORATION }) {
  if (!scenes.length) return { ok: false, kind: "noScene", errors: [`no scene is tagged "${region.sceneTag}" (tag one with api.tagScene(scene, "${region.sceneTag}"))`] };
  if (!scenes.some(s => s.totalAnchors > 0)) {
    return { ok: false, kind: "noAnchors", errors: [`the scene(s) tagged "${region.sceneTag}" (${scenes.map(s => s.name).join(", ")}) have no anchors at all (place some with api.placeAnchors)`] };
  }
  const rolled = degrees.reduce((sum, degree) => sum + rollAnchorCount(degree, rng, config), 0);
  const scene = chooseScene(scenes, rolled, rng) ?? scenes.find(s => s.totalAnchors > 0);
  const anchors = pickMany(scene.anchors, rolled, rng);
  const activations = [];
  for (const anchor of anchors) {
    const spawn = pickSpawn(region.spawnTable, rng);
    const built = makeNodeRecord({ source: "explored", nodeType: spawn.nodeType, tier: spawn.tier, region: region.id }, registry);
    if (!built.ok) return { ok: false, kind: "invalidNode", errors: [`${scene.name}: ${built.errors.join("; ")}`] };
    const perceptionDC = perceptionDcFor(spawn.tier, config);
    const record = { ...built.record, perceptionDC, revealed: false, anchorId: anchor.id };
    const problems = check(LIVE_SCHEMAS.node, record);
    if (problems.length) return { ok: false, kind: "invalidNode", errors: [`${scene.name}: ${problems.map(p => `${p.field} ${p.message}`).join("; ")}`] };
    activations.push({ anchorId: anchor.id, x: anchor.x, y: anchor.y, nodeType: spawn.nodeType, tier: spawn.tier, perceptionDC, record });
  }
  return {
    ok: true,
    plan: {
      degrees, rolled, scene: { id: scene.id, name: scene.name, preparedCount: scene.preparedCount ?? 0 },
      activations, freeBefore: scene.anchors.length, freeAfter: scene.anchors.length - activations.length,
      notPlaced: rolled - activations.length
    }
  };
}

// Odds -------------------------------------------------------------------------------------------------
const mean = range => (range.min + range.max) / 2;

/** Degree chances and the average number of nodes one DAY of exploring finds (multiply by the days for a trip). */
export function exploreOdds(modifier, dc, config = EXPLORATION) {
  const chances = degreeChances(modifier, dc);
  const expectedAnchors = DEGREE_NAMES.reduce((sum, degree) => sum + chances[degree] * mean(config.anchorCounts[degree]), 0);
  return { chances, expectedAnchors };
}

/**
 * Simulate many expeditions' node counts, node rolls and encounters (no scenes, no writes), to compare the
 * observed numbers with the expected ones. Give a fixed `degree` for every day, or a `modifier` to roll each
 * day's check. `days` is the length of each trip.
 */
export function simulateExpeditions({ region, runs, degree, modifier, days = 1, forceCombat = false, rng, config = EXPLORATION }) {
  if (!Number.isInteger(runs) || runs < 1) throw new Error(`simulateExpeditions: runs must be a whole number of at least 1 (got ${runs})`);
  if (!Number.isInteger(days) || days < 1) throw new Error(`simulateExpeditions: days must be a whole number of at least 1 (got ${days})`);
  if (degree === undefined && typeof modifier !== "number") throw new Error("simulateExpeditions: give a degree or a modifier");
  const totalTally = {};
  const degreeTally = Object.fromEntries(DEGREE_NAMES.map(d => [d, 0]));
  const spawnTally = new Map(region.spawnTable.map(e => [`${e.nodeType}/${e.tier}`, 0]));
  let nodes = 0;
  let encounters = 0;
  for (let i = 0; i < runs; i++) {
    let found = 0;
    for (let day = 0; day < days; day++) {
      const d = degree ?? DEGREE_NAMES[degreeIndex(Math.floor(rng() * 20) + 1, modifier, region.explorationDC)];
      degreeTally[d]++;
      found += rollAnchorCount(d, rng, config);
    }
    totalTally[found] = (totalTally[found] ?? 0) + 1;
    for (let n = 0; n < found; n++) {
      const spawn = pickSpawn(region.spawnTable, rng);
      spawnTally.set(`${spawn.nodeType}/${spawn.tier}`, spawnTally.get(`${spawn.nodeType}/${spawn.tier}`) + 1);
      nodes++;
    }
    if (rollEncounter({ danger: region.danger, forceCombat, rng, config }).encounter) encounters++;
  }
  const totalWeight = region.spawnTable.reduce((sum, e) => sum + e.weight, 0);
  const perDay = degree !== undefined ? mean(config.anchorCounts[degree]) : exploreOdds(modifier, region.explorationDC, config).expectedAnchors;
  return {
    runs, days, nodes,
    meanNodes: nodes / runs,
    expectedMeanNodes: perDay * days,
    counts: Object.fromEntries(Object.entries(totalTally).map(([n, c]) => [n, c / runs])),
    degrees: Object.fromEntries(Object.entries(degreeTally).map(([d, c]) => [d, c / (runs * days)])),
    encounterRate: encounters / runs,
    expectedEncounterRate: forceCombat ? 1 : (config.encounterChance[region.danger ?? "moderate"]),
    spawn: region.spawnTable.map(e => ({
      nodeType: e.nodeType, tier: e.tier,
      observed: nodes ? spawnTally.get(`${e.nodeType}/${e.tier}`) / nodes : 0,
      expected: e.weight / totalWeight
    }))
  };
}
