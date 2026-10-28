/**
 * Resolving a gather. Pure: the visible roll's outcome and the random source are
 * INPUTS, so tests can script every case and a socket relay can plug in later
 * (it only needs to run this on the GM client with the roller's visible result).
 */
import { rollQuantity } from "./dice.js";
import { degreeCounts } from "../checks.js";

/** Why this node cannot be gathered right now, or null. Checked BEFORE any dice. */
export function checkGatherable(node) {
  if (node.state === "anchor") return `${node.name} is an anchor ("a node could spawn here") and cannot be gathered until it is activated`;
  if (node.revealed === false) return `${node.name} has not been found yet (a hidden node must be spotted before it can be gathered)`;
  if (node.state === "depleted" || node.charges < 1) return `${node.name} is depleted`;
  return null;
}

/** Pick the skill. Never guesses: with several allowed skills one must be named. */
export function pickSkill(allowed, requested, typeName = "this", noun = "nodes") {
  if (requested) {
    if (!allowed.includes(requested)) {
      return { ok: false, error: `skill "${requested}" is not allowed for ${typeName} ${noun} (allowed: ${allowed.join(", ")})` };
    }
    return { ok: true, skill: requested };
  }
  if (allowed.length === 1) return { ok: true, skill: allowed[0] };
  return { ok: false, error: `${typeName} ${noun} allow several skills (${allowed.join(", ")}); choose one with skill: "<name>"` };
}

/** Chance that d20 + modifier meets or beats dc (a hidden rung roll). */
export function hiddenSuccessChance(modifier, dc) {
  return Math.min(1, Math.max(0, (21 - (dc - modifier)) / 20));
}

/** The lowest natural d20 that succeeds, or null when no roll can. */
export function neededD20(modifier, dc) {
  const needed = Math.max(1, dc - modifier);
  return needed > 20 ? null : needed;
}

/**
 * Chance the VISIBLE roll passes (PF2e success or better): degree from total vs DC,
 * a natural 20 moves it up a step, a natural 1 down a step. Exact, by enumeration.
 */
export function visiblePassChance(modifier, dc) {
  const counts = degreeCounts(modifier, dc);
  return (counts.success + counts.criticalSuccess) / 20;
}

/**
 * @param {object} args
 * @param {object} args.node      a normalised node view (see normalizeNode)
 * @param {{ passed: boolean, degree?: string }} args.visible   the visible roll's result vs the base rung
 * @param {number} args.modifier  the roller's modifier, used for every hidden roll
 * @param {() => number} args.d20 returns an integer 1..20
 * @param {(sides: number) => number} args.die  returns an integer 1..sides (for quantity dice)
 */
export function resolveGather({ node, visible, modifier, d20, die }) {
  const problem = checkGatherable(node);
  if (problem) throw new Error(`resolveGather: ${problem}`);

  const { base, higher } = node.ladder;
  const gains = [];
  const hidden = []; // GM-only detail; never shown to players

  if (visible.passed) {
    const quantity = rollQuantity(base.quantity, die);
    if (quantity > 0) gains.push({ materialId: base.materialId, quantity, rung: "base" });

    for (const rung of higher) {
      const roll = d20();
      if (!Number.isInteger(roll) || roll < 1 || roll > 20) throw new Error(`resolveGather: d20 must return an integer from 1 to 20 (got ${roll})`);
      const total = roll + modifier;
      const success = total >= rung.dc;
      hidden.push({ materialId: rung.materialId, dc: rung.dc, roll, modifier, total, success });
      if (success) {
        const amount = rollQuantity(rung.quantity, die);
        if (amount > 0) gains.push({ materialId: rung.materialId, quantity: amount, rung: "higher" });
      }
    }
  }

  // Every attempt spends one charge, pass or fail.
  const chargesAfter = node.charges - 1;
  return {
    passed: visible.passed,
    degree: visible.degree ?? null,
    modifier,
    gains,
    hidden,
    chargesBefore: node.charges,
    chargesAfter,
    stateAfter: chargesAfter === 0 ? "depleted" : "active"
  };
}
