/**
 * Resolving a craft once the check has been rolled. Pure and deterministic:
 * the degree of success and the random function are INPUTS, so tests can drive
 * every outcome and every loss roll exactly.
 *
 * | Degree           | Result                                              |
 * | criticalSuccess  | item made; all materials used (thrifty refund, if on) |
 * | success          | item made; all materials and the fee consumed       |
 * | failure          | no item; fee lost; each unit rolls d100 for loss    |
 * | criticalFailure  | no item; everything lost; NO loss rolls             |
 */
import { CRAFTING } from "../config.js";
import { DEGREES } from "../adapter/pf2e.js";
import { resolveLayers } from "../data/resolver.js";

/** Loss chance for one use: slot override > material override > default. */
export function lossChanceFor(use, config = CRAFTING) {
  return resolveLayers([
    { source: "slot", value: use.slotLossChance },
    { source: "material", value: use.materialLossChance },
    { source: "default", value: config.lossChance }
  ]).value;
}

/** Spread `units` consumed units across a use's stacks, in order. */
function allocate(from, units) {
  const byStack = {};
  let left = units;
  for (const { stackId, units: available } of from) {
    if (left === 0) break;
    const take = Math.min(left, available);
    if (take > 0) { byStack[stackId] = take; left -= take; }
  }
  return byStack;
}

/**
 * @param {object} args
 * @param {object} args.plan     from planCraft
 * @param {string} args.degree   one of DEGREES
 * @param {() => number} args.rng  returns an integer 1..100 (a d100)
 * @param {object} [args.config]
 */
export function resolveOutcome({ plan, degree, rng, config = CRAFTING }) {
  if (!DEGREES.includes(degree)) throw new Error(`resolveOutcome: unknown degree "${degree}"`);

  const made = degree === "success" || degree === "criticalSuccess";
  const consumed = [];
  const kept = [];
  const consumeByStack = {};
  const lossRolls = []; // GM-only detail; never shown to players

  for (const use of plan.uses) {
    let consumedUnits = use.units;

    if (degree === "failure") {
      const chance = lossChanceFor(use, config);
      consumedUnits = 0;
      for (let unit = 0; unit < use.units; unit++) {
        const roll = rng();
        if (!Number.isInteger(roll) || roll < 1 || roll > 100) {
          throw new Error(`resolveOutcome: rng must return an integer from 1 to 100 (got ${roll})`);
        }
        const lost = roll <= chance;
        if (lost) consumedUnits++;
        lossRolls.push({ slot: use.slot, materialId: use.materialId, roll, chance, lost });
      }
    } else if (degree === "criticalSuccess" && config.thrifty.enabled) {
      consumedUnits = use.units - Math.floor(use.units * config.thrifty.refundFraction);
    }

    const keptUnits = use.units - consumedUnits;
    consumed.push({ slot: use.slot, materialId: use.materialId, units: consumedUnits });
    kept.push({ slot: use.slot, materialId: use.materialId, units: keptUnits });
    for (const [stackId, units] of Object.entries(allocate(use.from, consumedUnits))) {
      consumeByStack[stackId] = (consumeByStack[stackId] ?? 0) + units;
    }
  }

  return {
    degree,
    made,
    feeConsumed: plan.fee, // the fee is spent whatever happens
    consumed,
    kept,
    consumeByStack,
    lossRolls,
    summary: {
      unitsUsed: consumed.reduce((n, c) => n + c.units, 0),
      unitsKept: kept.reduce((n, k) => n + k.units, 0)
    }
  };
}
