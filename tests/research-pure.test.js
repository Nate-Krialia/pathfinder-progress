import test from "node:test";
import assert from "node:assert/strict";
import { RESEARCH, TIER_RANGES } from "../scripts/config.js";
import { DEGREE_NAMES, degreeChances, degreeCounts, degreeIndex } from "../scripts/checks.js";
import { levelDC } from "../scripts/adapter/pf2e.js";
import { abandonProject, applyProgress, buildProject, deltaFor } from "../scripts/research/project.js";
import { resolveResearch } from "../scripts/research/daily.js";
import { expectedDaysToFinish, expectedProgressPerDay } from "../scripts/research/odds.js";
import { afterGrant, afterSpend, daysFrom, validateSetDays } from "../scripts/research/days.js";
import { formatProgressSummary, formatResearchSummary } from "../scripts/research/summary.js";
import { check } from "../scripts/data/schema.js";
import { LIVE_SCHEMAS } from "../scripts/data/schemas.js";
import { loadDefinitions } from "../scripts/data/validate.js";
import { asPage, seedRecords } from "./helpers.js";

const registry = loadDefinitions(seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }))).registry;
const dagger = registry.recipe.get("dagger-spider-fang");
const longsword = registry.recipe.get("longsword-basic");

/** mulberry32 seeded generator returning 1..sides. */
function seeded(seed) {
  let a = seed >>> 0;
  return sides => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor(((t ^ (t >>> 14)) >>> 0) / 4294967296 * sides) + 1;
  };
}

const project = (extra = {}) => ({
  id: "unlock-x", goalName: "X", outcome: { type: "unlockFormula", recipeId: "x" },
  tier: 1, dc: 14, threshold: 8, progress: 0, skillWhitelist: ["crafting"], status: "active", log: [], ...extra
});
const fixed = degrees => { const queue = [...degrees]; return async () => ({ degree: queue.shift() }); };

// Check arithmetic ------------------------------------------------------------------------
test("degrees: total vs DC, with natural 20 up a step and natural 1 down a step", () => {
  assert.equal(degreeIndex(10, 5, 15), 2, "meets the DC: success");
  assert.equal(degreeIndex(9, 5, 15), 1, "one short: failure");
  assert.equal(degreeIndex(5, 5, 15), 1, "5 short: failure");
  assert.equal(degreeIndex(15, 10, 15), 3, "10 over: critical success");
  assert.equal(degreeIndex(15, 5, 15), 2, "5 over is only a success");
  assert.equal(degreeIndex(2, -8, 15), 0, "10 under: critical failure");
  assert.equal(degreeIndex(20, -10, 15), 2, "natural 20 lifts a failure to a success");
  assert.equal(degreeIndex(1, 30, 15), 2, "natural 1 drops a critical success to a success");
  assert.equal(degreeIndex(1, 20, 15), 1, "natural 1 drops a success to a failure");
  assert.equal(degreeIndex(20, 40, 15), 3, "cannot go above a critical success");
  assert.equal(degreeIndex(1, -40, 15), 0, "cannot go below a critical failure");
});

test("degreeCounts always sum to 20 and chances to 1", () => {
  for (const modifier of [-30, -1, 0, 4, 9, 30]) {
    for (const dc of [5, 14, 18, 30]) {
      const counts = degreeCounts(modifier, dc);
      assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 20);
      assert.ok(Math.abs(Object.values(degreeChances(modifier, dc)).reduce((a, b) => a + b, 0) - 1) < 1e-12);
    }
  }
});

test("Bottlespeaker at -1 vs DC 14: 25% crit failure, 45% failure, 25% success, 5% crit success", () => {
  assert.deepEqual(degreeCounts(-1, 14), { criticalFailure: 5, failure: 9, success: 5, criticalSuccess: 1 });
  assert.equal(expectedProgressPerDay(-1, 14), 0.35);
});

// Config -----------------------------------------------------------------------------------------
test("config sanity: every research tier has a DC offset and threshold; thresholds rise and offsets never fall", () => {
  const { min, max } = TIER_RANGES.research;
  let previousThreshold = 0, previousOffset = -Infinity;
  for (let tier = min; tier <= max; tier++) {
    const t = RESEARCH.tiers[tier];
    assert.ok(t, `tier ${tier}`);
    assert.ok(t.threshold > previousThreshold, `tier ${tier} threshold must rise`);
    assert.ok(t.dcOffset >= previousOffset, `tier ${tier} offset must not fall`);
    [previousThreshold, previousOffset] = [t.threshold, t.dcOffset];
  }
  assert.deepEqual(RESEARCH.tiers[1], { dcOffset: -2, threshold: 8 }, "the spec's placeholder table");
  assert.deepEqual(RESEARCH.tiers[5], { dcOffset: 6, threshold: 40 });
});

test("config sanity: progress never falls as the degree improves, and the setback is off by default", () => {
  const values = DEGREE_NAMES.map(d => RESEARCH.progressByDegree[d]);
  assert.deepEqual(values, [0, 0, 1, 2]);
  assert.equal(RESEARCH.critFailureSetback, 0);
});

// buildProject --------------------------------------------------------------------------------------
test("a project's DC is the recipe's level DC plus the tier offset; threshold comes from the tier", () => {
  const d = buildProject(dagger);
  assert.ok(d.ok, d.errors?.join("|"));
  assert.deepEqual(
    [d.project.id, d.project.goalName, d.project.tier, d.project.dc, d.project.threshold, d.project.progress, d.project.status],
    ["unlock-dagger-spider-fang", "Spider Fang Dagger", 1, levelDC(2) - 2, 8, 0, "active"]
  );
  assert.equal(d.project.dc, 14);
  const l = buildProject(longsword).project;
  assert.deepEqual([l.tier, l.dc, l.threshold, l.skillWhitelist], [2, levelDC(3), 12, ["arcana", "crafting", "occultism"]]);
  assert.equal(l.dc, 18);
});

test("every tier produces levelDC(craftLevel) + offset and the tier's threshold", () => {
  for (let tier = 1; tier <= 5; tier++) {
    const recipe = { ...dagger, craftLevel: 4, researchProject: { tier } };
    const { project: p } = buildProject(recipe);
    assert.equal(p.dc, levelDC(4) + RESEARCH.tiers[tier].dcOffset, `tier ${tier}`);
    assert.equal(p.threshold, RESEARCH.tiers[tier].threshold);
  }
});

test("a built project is schema-valid, and its skill list is a copy", () => {
  const { project: p } = buildProject(dagger);
  assert.deepEqual(check(LIVE_SCHEMAS.project, p), []);
  p.skillWhitelist.push("x");
  assert.deepEqual(dagger.skillWhitelist, ["crafting"]);
});

test("GM overrides tune one project and are validated", () => {
  const { project: p } = buildProject(dagger, { overrides: { dc: 22, threshold: 500 } });
  assert.deepEqual([p.dc, p.threshold], [22, 500]);
  for (const bad of [{ dc: 0 }, { threshold: -1 }, { dc: 1.5 }]) assert.equal(buildProject(dagger, { overrides: bad }).ok, false);
  assert.match(buildProject({ ...dagger, researchProject: { tier: 9 } }).errors[0], /research tier 9/);
  assert.match(buildProject({ ...dagger, craftLevel: 99 }).errors[0], /levelDC/);
});

// applyProgress -----------------------------------------------------------------------------------------
test("progress adds up, logs the change, and completes at the threshold", () => {
  let p = project();
  const a = applyProgress(p, { delta: 3, source: "research", skill: "crafting", degree: "success" });
  assert.deepEqual([a.project.progress, a.completed, a.applied, a.project.status], [3, false, 3, "active"]);
  assert.deepEqual(a.project.log, [{ source: "research", delta: 3, skill: "crafting", degree: "success" }]);
  const b = applyProgress(a.project, { delta: 5, source: "addProgress", note: "found notes" });
  assert.deepEqual([b.project.progress, b.completed, b.project.status], [8, true, "complete"]);
  assert.deepEqual(check(LIVE_SCHEMAS.project, b.project), []);
});

test("progress can overshoot the threshold and still completes", () => {
  const result = applyProgress(project({ progress: 7 }), { delta: 2, source: "research" });
  assert.deepEqual([result.project.progress, result.completed], [9, true]);
});

test("progress never goes below 0, and the log records what was actually applied", () => {
  const result = applyProgress(project({ progress: 2 }), { delta: -5, source: "addProgress", note: "setback" });
  assert.deepEqual([result.project.progress, result.applied, result.project.log[0].delta], [0, -2, -2]);
  assert.equal(applyProgress(project(), { delta: -3, source: "addProgress", note: "x" }).project.progress, 0);
});

test("a project that is not active cannot gain progress; non-integers are refused", () => {
  for (const status of ["complete", "abandoned"]) assert.match(applyProgress(project({ status, progress: status === "complete" ? 8 : 0 }), { delta: 1, source: "research" }).errors[0], /not active/);
  assert.match(applyProgress(project(), { delta: 1.5, source: "research" }).errors[0], /whole number/);
});

test("the log keeps only the newest entries", () => {
  let p = project({ threshold: 1000 });
  for (let i = 0; i < 60; i++) p = applyProgress(p, { delta: 1, source: "research", note: `n${i}` }, { ...RESEARCH, maxLog: 50 }).project;
  assert.equal(p.log.length, 50);
  assert.equal(p.log[0].note, "n10");
  assert.equal(p.log.at(-1).note, "n59");
});

test("abandoning keeps the record and notes why", () => {
  const p = abandonProject(project({ progress: 3 }), "gave up");
  assert.deepEqual([p.status, p.progress, p.log.at(-1)], ["abandoned", 3, { source: "gm", delta: 0, note: "gave up" }]);
  assert.deepEqual(check(LIVE_SCHEMAS.project, p), []);
});

test("schema: status and progress must agree", () => {
  assert.match(check(LIVE_SCHEMAS.project, project({ progress: 8 }))[0].message, /should be complete/);
  assert.match(check(LIVE_SCHEMAS.project, project({ status: "complete", progress: 3 }))[0].message, /below the threshold/);
});

// The setback --------------------------------------------------------------------------------------------
test("a critical failure is plain 0 progress by default, and a setback only when configured", () => {
  assert.equal(deltaFor("criticalFailure"), 0);
  const config = { ...RESEARCH, critFailureSetback: 1 };
  assert.equal(deltaFor("criticalFailure", config), -1);
  assert.equal(deltaFor("failure", config), 0);
  assert.throws(() => deltaFor("meh"), /unknown degree/);
});

test("with a setback, progress dips but never below 0", async () => {
  const config = { ...RESEARCH, critFailureSetback: 2 };
  const result = await resolveResearch({ project: project({ progress: 1 }), skill: "crafting", days: 3, daysAvailable: 3, rollDay: fixed(["criticalFailure", "criticalFailure", "success"]), config });
  assert.deepEqual(result.results.map(r => [r.delta, r.progressAfter]), [[-1, 0], [0, 0], [1, 1]]);
});

// Days -----------------------------------------------------------------------------------------------------
test("the day budget: grants add, spends subtract, and it can never go below 0", () => {
  assert.equal(afterGrant(0, 5), 5);
  assert.equal(afterGrant(undefined, 2), 2);
  assert.equal(afterSpend(5, 3), 2);
  assert.equal(afterSpend(3, 3), 0);
  assert.throws(() => afterSpend(2, 3), /cannot spend 3 day\(s\): only 2 available/);
  assert.equal(daysFrom(-4), 0);
  assert.equal(daysFrom("5"), 0);
  assert.equal(daysFrom(2.5), 0);
  for (const bad of [0, -1, 1.5, "2"]) assert.throws(() => afterGrant(1, bad), RangeError, String(bad));
  assert.equal(validateSetDays(0), 0);
  assert.throws(() => validateSetDays(-1), RangeError);
});

test("property: no sequence of grants and spends ever leaves a negative balance", () => {
  const die = seeded(2024);
  let balance = 0;
  for (let i = 0; i < 5000; i++) {
    const n = die(6);
    if (die(2) === 1) balance = afterGrant(balance, n);
    else { try { balance = afterSpend(balance, n); } catch { /* refused, balance unchanged */ } }
    assert.ok(balance >= 0 && Number.isInteger(balance));
  }
});

// Daily resolution -------------------------------------------------------------------------------------------
test("each day rolls once and adds its degree's progress", async () => {
  const result = await resolveResearch({ project: project(), skill: "crafting", days: 4, daysAvailable: 10, rollDay: fixed(["success", "success", "criticalSuccess", "failure"]) });
  assert.ok(result.ok);
  assert.deepEqual(result.results.map(r => [r.day, r.degree, r.delta, r.progressAfter]), [[1, "success", 1, 1], [2, "success", 1, 2], [3, "criticalSuccess", 2, 4], [4, "failure", 0, 4]]);
  assert.deepEqual([result.daysSpent, result.daysRemaining, result.completed, result.project.progress], [4, 6, false, 4]);
});

test("it stops the moment the project completes and does not spend the rest", async () => {
  let rolls = 0;
  const rollDay = async () => { rolls++; return { degree: "criticalSuccess" }; };
  const result = await resolveResearch({ project: project({ progress: 4 }), skill: "crafting", days: 4, daysAvailable: 6, rollDay });
  assert.deepEqual([result.daysSpent, result.daysRemaining, result.completed, result.project.status], [2, 4, true, "complete"]);
  assert.equal(rolls, 2, "no rolls for the days after completion");
});

test("asking for more days than available is refused BEFORE any roll", async () => {
  let rolls = 0;
  const result = await resolveResearch({ project: project(), skill: "crafting", days: 3, daysAvailable: 1, rollDay: async () => { rolls++; return { degree: "success" }; } });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /needs 3 downtime day\(s\) but only 1 available/);
  assert.equal(rolls, 0);
});

test("bad day counts and inactive projects are refused", async () => {
  for (const days of [0, -1, 1.5, undefined]) {
    assert.equal((await resolveResearch({ project: project(), skill: "x", days, daysAvailable: 5, rollDay: fixed([]) })).ok, false, String(days));
  }
  const done = await resolveResearch({ project: project({ status: "abandoned" }), skill: "x", days: 1, daysAvailable: 5, rollDay: fixed(["success"]) });
  assert.match(done.errors[0], /abandoned, not active/);
});

test("a roll that returns no degree is a loud error", async () => {
  await assert.rejects(resolveResearch({ project: project(), skill: "x", days: 1, daysAvailable: 1, rollDay: async () => ({ degree: "great" }) }), /must return a degree/);
});

test("the input project is never mutated", async () => {
  const p = project();
  const before = JSON.stringify(p);
  await resolveResearch({ project: p, skill: "x", days: 3, daysAvailable: 3, rollDay: fixed(["success", "success", "success"]) });
  assert.equal(JSON.stringify(p), before);
});

test("rolled totals and natural d20s are carried into the results, so a degree can be audited", async () => {
  const result = await resolveResearch({ project: project(), skill: "crafting", days: 1, daysAvailable: 1, rollDay: async () => ({ degree: "success", total: 15, natural: 16 }) });
  assert.deepEqual([result.results[0].total, result.results[0].natural], [15, 16]);
});

test("a forced degree has no roll to audit: total and natural are null", async () => {
  const result = await resolveResearch({ project: project(), skill: "crafting", days: 1, daysAvailable: 1, rollDay: fixed(["success"]) });
  assert.deepEqual([result.results[0].total, result.results[0].natural], [null, null]);
});

test("audit: every simulated day's reported degree matches its natural d20, total and DC", async () => {
  const rng = seeded(4242);
  const modifier = 3, dc = 15;
  const result = await resolveResearch({
    project: project({ dc, threshold: 1_000_000 }), skill: "crafting", days: 2000, daysAvailable: 2000,
    rollDay: async () => { const natural = rng(20); return { degree: DEGREE_NAMES[degreeIndex(natural, modifier, dc)], total: natural + modifier, natural }; }
  });
  for (const r of result.results) {
    assert.equal(r.total - r.natural, modifier, "total = natural + modifier");
    assert.equal(r.degree, DEGREE_NAMES[degreeIndex(r.natural, r.total - r.natural, dc)], `day ${r.day}: the degree must follow from the natural d20, the total and the DC`);
  }
});

// Summary --------------------------------------------------------------------------------------------------------
test("the research summary lists each day and the progress, naming the goal but nothing else", async () => {
  const result = await resolveResearch({ project: project({ goalName: "Spider Fang Dagger" }), skill: "crafting", days: 2, daysAvailable: 2,
    rollDay: fixed(["success", "failure"]) });
  const text = formatResearchSummary({ actorName: "Aelwyn", project: result.project, skillName: "Crafting", results: result.results, completed: false });
  assert.match(text, /Aelwyn.*researches.*Spider Fang Dagger.*\(Crafting, 2 days\)/);
  assert.match(text, /Day 1: Success \(\+1\)/);
  assert.match(text, /Day 2: Failure \(\+0\)/);
  assert.match(text, /Progress: 1\/8\./);
});

test("the summary shows the roll when there is one, and announces an unlock", () => {
  const p = project({ progress: 8, status: "complete", goalName: "Blade" });
  const text = formatResearchSummary({ actorName: "Aelwyn", project: p, skillName: "Crafting", completed: true,
    results: [{ day: 1, degree: "criticalSuccess", total: 26, delta: 2 }] });
  assert.match(text, /Day 1: 26 vs DC 14: Critical Success \(\+2\)/);
  assert.match(text, /Aelwyn.*has learned.*Blade/);
  assert.doesNotMatch(text, /Progress:/);
});

test("the addProgress summary includes the reason; setbacks read as losses", () => {
  const p = project({ progress: 3, goalName: "Blade" });
  assert.match(formatProgressSummary({ actorName: "A", project: p, applied: 3, reason: "found notes", completed: false }), /advances by 3 \(found notes\)\..*Progress: 3\/8\./);
  assert.match(formatProgressSummary({ actorName: "A", project: p, applied: -2, reason: "fire", completed: false }), /loses 2 \(fire\)/);
});

// Odds --------------------------------------------------------------------------------------------------------------
test("expected progress per day follows the degree table", () => {
  assert.equal(expectedProgressPerDay(-1, 14), 0.35);
  assert.equal(expectedProgressPerDay(30, 10), 1.95);
  assert.equal(expectedProgressPerDay(-100, 10), 0);
  assert.ok(expectedProgressPerDay(-1, 14, { ...RESEARCH, critFailureSetback: 1 }) < 0.35);
});

test("expected days: impossible progress is Infinity, a finished project is 0", () => {
  assert.equal(expectedDaysToFinish({ modifier: -100, dc: 10, threshold: 8 }).days, Infinity);
  assert.equal(expectedDaysToFinish({ modifier: 30, dc: 10, threshold: 8, progress: 8 }).days, 0);
});

test("expected days: matches hand calculations in simple cases", () => {
  // Only a natural 20 ever succeeds (+1, or +2 as a lifted critical): +20 mod vs DC 40 gives crit on 20 only? check via counts.
  const counts = degreeCounts(-100, 10);
  assert.equal(counts.criticalFailure, 19, "sanity: all but the natural 20 are critical failures");
  // Threshold 1 means one day with probability p of any progress, so E = 1/p.
  const chances = degreeChances(-1, 14);
  const p = chances.success + chances.criticalSuccess;
  const { days } = expectedDaysToFinish({ modifier: -1, dc: 14, threshold: 1 });
  assert.ok(Math.abs(days - 1 / p) < 1e-9, `${days} vs ${1 / p}`);
});

test("expected days: large thresholds use the average and say so", () => {
  const exact = expectedDaysToFinish({ modifier: 10, dc: 14, threshold: 100 });
  const big = expectedDaysToFinish({ modifier: 10, dc: 14, threshold: 500 });
  assert.equal(exact.approximate, false);
  assert.equal(big.approximate, true);
  assert.ok(Math.abs(big.days - 500 / expectedProgressPerDay(10, 14)) < 1e-9);
});

// Statistics -----------------------------------------------------------------------------------------------------------
function simulateDay(rng, modifier, dc) {
  return { degree: DEGREE_NAMES[degreeIndex(rng(20), modifier, dc)] };
}

test("statistics: per-day degree frequencies match the exact chances (20,000 days each)", async () => {
  const n = 20000;
  for (const [modifier, dc] of [[-1, 14], [-1, 18], [4, 18], [9, 16], [15, 14]]) {
    const rng = seeded(900 + modifier * 7 + dc);
    const tally = Object.fromEntries(DEGREE_NAMES.map(d => [d, 0]));
    const p = project({ threshold: 1_000_000, dc });
    const result = await resolveResearch({ project: p, skill: "crafting", days: n, daysAvailable: n, rollDay: async () => { const r = simulateDay(rng, modifier, dc); tally[r.degree]++; return r; } });
    assert.equal(result.daysSpent, n);
    const chances = degreeChances(modifier, dc);
    for (const degree of DEGREE_NAMES) {
      assert.ok(Math.abs(tally[degree] / n - chances[degree]) < 0.012, `+${modifier} vs ${dc} ${degree}: ${(tally[degree] / n).toFixed(4)} vs ${chances[degree]}`);
    }
  }
});

test("statistics: progress per day averages the expected rate", async () => {
  const n = 20000;
  const rng = seeded(31);
  const result = await resolveResearch({ project: project({ threshold: 1_000_000 }), skill: "crafting", days: n, daysAvailable: n, rollDay: async () => simulateDay(rng, -1, 14) });
  assert.ok(Math.abs(result.project.progress / n - 0.35) < 0.015, `${result.project.progress / n}`);
});

async function meanDaysToFinish({ modifier, dc, threshold, config = RESEARCH, runs, seed }) {
  const rng = seeded(seed);
  let total = 0;
  for (let i = 0; i < runs; i++) {
    const result = await resolveResearch({
      project: project({ dc, threshold }), skill: "crafting", days: 100000, daysAvailable: 100000, config,
      rollDay: async () => simulateDay(rng, modifier, dc)
    });
    assert.ok(result.completed);
    total += result.daysSpent;
  }
  return total / runs;
}

test("statistics: mean days to finish matches the exact calculation for each tier", async () => {
  for (const [tier, modifier, seed] of [[1, 4, 11], [2, 6, 12], [3, 8, 13], [4, 10, 14], [5, 14, 15]]) {
    const dc = levelDC(4) + RESEARCH.tiers[tier].dcOffset;
    const threshold = RESEARCH.tiers[tier].threshold;
    const expected = expectedDaysToFinish({ modifier, dc, threshold }).days;
    const observed = await meanDaysToFinish({ modifier, dc, threshold, runs: 3000, seed });
    assert.ok(Math.abs(observed - expected) / expected < 0.035, `tier ${tier}: observed ${observed.toFixed(2)}, expected ${expected.toFixed(2)}`);
  }
});

test("statistics: mean days to finish matches the exact calculation with a setback", async () => {
  const config = { ...RESEARCH, critFailureSetback: 1 };
  const modifier = 2, dc = 14, threshold = 12;
  const expected = expectedDaysToFinish({ modifier, dc, threshold, config }).days;
  const noSetback = expectedDaysToFinish({ modifier, dc, threshold }).days;
  assert.ok(expected > noSetback, "a setback must slow research down");
  const observed = await meanDaysToFinish({ modifier, dc, threshold, config, runs: 4000, seed: 77 });
  assert.ok(Math.abs(observed - expected) / expected < 0.04, `observed ${observed.toFixed(2)}, expected ${expected.toFixed(2)}`);
});

test("statistics: Bottlespeaker's dagger project (crafting -1 vs DC 14, threshold 8) takes about 23 days", async () => {
  const expected = expectedDaysToFinish({ modifier: -1, dc: 14, threshold: 8 }).days;
  assert.ok(expected > 22 && expected < 24.5, `${expected}`);
  const observed = await meanDaysToFinish({ modifier: -1, dc: 14, threshold: 8, runs: 3000, seed: 5 });
  assert.ok(Math.abs(observed - expected) / expected < 0.035, `${observed}`);
});
