/**
 * The maths of an expedition. Pure; no Foundry globals. Randomness is injected: `rng()` returns
 * a number in [0, 1), like Math.random.
 *
 * Order: the check's degree decides how many anchors activate; a scene is chosen; that many
 * free anchors are picked at random; each rolls the region's spawn table for a node type and tier.
 */
import { EXPLORATION } from "../config.js";
import { degreeChances, degreeIndex, DEGREE_NAMES } from "../checks.js";
import { activateRecord } from "../gathering/node.js";

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
 * Plan an expedition without touching anything.
 * @param {object} args
 * @param {object} args.region    a validated region definition
 * @param {object} args.registry  loaded definitions (to validate the nodes it builds)
 * @param {string} args.degree    the exploration check's degree
 * @param {Array<{ id: string, name: string, anchors: Array<{ id: string, record: object }>, preparedCount?: number }>} args.scenes
 *        the scenes tagged for this region
 * @returns {{ ok: true, plan: object } | { ok: false, kind: "noScene" | "noAnchors" | "invalidNode", errors: string[] }}
 */
export function planExpedition({ region, registry, degree, scenes, rng, config = EXPLORATION }) {
  if (!scenes.length) return { ok: false, kind: "noScene", errors: [`no scene is tagged "${region.sceneTag}" (tag one with api.tagScene(scene, "${region.sceneTag}"))`] };
  if (!scenes.some(s => s.anchors.length)) {
    return { ok: false, kind: "noAnchors", errors: [`the scene(s) tagged "${region.sceneTag}" (${scenes.map(s => s.name).join(", ")}) have no free anchors (place some with api.placeAnchors, or api.resetScene)`] };
  }
  const rolled = rollAnchorCount(degree, rng, config);
  const scene = chooseScene(scenes, rolled, rng);
  const anchors = pickMany(scene.anchors, rolled, rng);
  const activations = [];
  for (const anchor of anchors) {
    const spawn = pickSpawn(region.spawnTable, rng);
    const built = activateRecord(anchor.record, { nodeType: spawn.nodeType, tier: spawn.tier, source: "explored", region: region.id }, registry);
    if (!built.ok) return { ok: false, kind: "invalidNode", errors: [`${scene.name}: ${built.errors.join("; ")}`] };
    activations.push({ tokenId: anchor.id, nodeType: spawn.nodeType, tier: spawn.tier, record: built.record });
  }
  return {
    ok: true,
    plan: {
      degree, rolled, scene: { id: scene.id, name: scene.name, preparedCount: scene.preparedCount ?? 0 },
      activations, freeBefore: scene.anchors.length, freeAfter: scene.anchors.length - activations.length,
      shortfall: Math.max(0, rolled - activations.length)
    }
  };
}

// Odds -------------------------------------------------------------------------------------------------
const mean = range => (range.min + range.max) / 2;

/** Degree chances and the average number of anchors one expedition activates. */
export function exploreOdds(modifier, dc, config = EXPLORATION) {
  const chances = degreeChances(modifier, dc);
  const expectedAnchors = DEGREE_NAMES.reduce((sum, degree) => sum + chances[degree] * mean(config.anchorCounts[degree]), 0);
  return { chances, expectedAnchors };
}

/**
 * Simulate many expeditions' anchor counts and node rolls (no scenes, no writes), to compare
 * the observed numbers with the expected ones.
 * Give a fixed `degree`, or a `modifier` to roll the check each run.
 */
export function simulateExpeditions({ region, runs, degree, modifier, rng, config = EXPLORATION }) {
  if (!Number.isInteger(runs) || runs < 1) throw new Error(`simulateExpeditions: runs must be a whole number of at least 1 (got ${runs})`);
  if (degree === undefined && typeof modifier !== "number") throw new Error("simulateExpeditions: give a degree or a modifier");
  const countTally = {};
  const degreeTally = Object.fromEntries(DEGREE_NAMES.map(d => [d, 0]));
  const spawnTally = new Map(region.spawnTable.map(e => [`${e.nodeType}/${e.tier}`, 0]));
  let nodes = 0;
  for (let i = 0; i < runs; i++) {
    const d = degree ?? DEGREE_NAMES[degreeIndex(Math.floor(rng() * 20) + 1, modifier, region.explorationDC)];
    degreeTally[d]++;
    const count = rollAnchorCount(d, rng, config);
    countTally[count] = (countTally[count] ?? 0) + 1;
    for (let n = 0; n < count; n++) {
      const spawn = pickSpawn(region.spawnTable, rng);
      spawnTally.set(`${spawn.nodeType}/${spawn.tier}`, spawnTally.get(`${spawn.nodeType}/${spawn.tier}`) + 1);
      nodes++;
    }
  }
  const totalWeight = region.spawnTable.reduce((sum, e) => sum + e.weight, 0);
  const expectedMean = degree !== undefined ? mean(config.anchorCounts[degree]) : exploreOdds(modifier, region.explorationDC, config).expectedAnchors;
  return {
    runs, nodes,
    meanAnchors: nodes / runs,
    expectedMeanAnchors: expectedMean,
    counts: Object.fromEntries(Object.entries(countTally).map(([n, c]) => [n, c / runs])),
    degrees: Object.fromEntries(Object.entries(degreeTally).map(([d, c]) => [d, c / runs])),
    spawn: region.spawnTable.map(e => ({
      nodeType: e.nodeType, tier: e.tier,
      observed: nodes ? spawnTally.get(`${e.nodeType}/${e.tier}`) / nodes : 0,
      expected: e.weight / totalWeight
    }))
  };
}
