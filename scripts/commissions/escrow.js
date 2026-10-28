/**
 * The money and material side of a commission craft. Pure; no Foundry globals.
 *
 * Nothing is held before crafting. At craft time the patron (a character) pays the station fee and
 * supplies the materials, and on delivery pays the crafter. This file works out WHAT would move,
 * as a list of steps, so the same list can be applied to a model of the world (the property tests)
 * and to the real actors (store.js).
 */
import { gpText } from "./commission.js";

/**
 * Can the patron cover the gold? Fee and payout both come out of the patron's gold, so the
 * payout must be covered up front even though it is paid only on success.
 * @returns {string[]} what is short (empty when fine)
 */
export function affordabilityErrors({ patronCopper, feeCopper, payoutCopper, patronName }) {
  if (patronCopper < feeCopper) return [`${patronName} cannot cover the ${gpText(feeCopper)} fee (has ${gpText(patronCopper)})`];
  if (patronCopper < feeCopper + payoutCopper) {
    return [`${patronName} cannot cover the ${gpText(feeCopper)} fee plus the ${gpText(payoutCopper)} payout (needs ${gpText(feeCopper + payoutCopper)}, has ${gpText(patronCopper)})`];
  }
  return [];
}

/** Which materials are missing from a supplier's stacks? Returns lines like "2x iron (has 1)". */
export function missingMaterials({ uses, stacks }) {
  const have = new Map();
  for (const s of stacks) have.set(s.materialId, (have.get(s.materialId) ?? 0) + s.quantity);
  const need = new Map();
  for (const u of uses) need.set(u.materialId, (need.get(u.materialId) ?? 0) + u.units);
  return [...need].filter(([id, n]) => (have.get(id) ?? 0) < n).map(([id, n]) => `${n}x ${id} (has ${have.get(id) ?? 0})`);
}

/**
 * The steps a finished craft applies, in order.
 *   consume: units out of a supplier's stacks (nothing for an NPC's virtual supply)
 *   gold:    copper in (+) or out (-) of an actor
 *   item:    the finished item goes to the patron's inventory (never for an NPC patron)
 *
 * @param {object} args
 * @param {{ type: "actor", actorId: string } | { type: "lightweight" }} args.patron
 * @param {string} args.crafterId
 * @param {{ kind: "patron"|"crafter"|"npc", actorId?: string }} args.supplier
 * @param {{ made: boolean, consumeByStack: Object<string,number>, feeConsumed: number }} args.outcome
 * @param {number} args.payoutCopper
 * @param {object|null} args.itemData  data for the finished item (when made, for a character patron)
 */
export function buildSteps({ patron, crafterId, supplier, outcome, payoutCopper, itemData }) {
  const steps = [];
  const patronActor = patron.type === "actor" ? patron.actorId : null;
  if (supplier.kind !== "npc" && Object.keys(outcome.consumeByStack).length) {
    steps.push({ op: "consume", actorId: supplier.actorId, byStack: { ...outcome.consumeByStack } });
  }
  // The fee is spent whatever happens. An NPC patron's fee is waived.
  const feeCopper = Math.round((outcome.feeConsumed ?? 0) * 100);
  if (patronActor && feeCopper > 0) steps.push({ op: "gold", actorId: patronActor, copper: -feeCopper, why: "fee" });
  if (outcome.made) {
    if (patronActor && itemData) steps.push({ op: "item", actorId: patronActor, data: itemData });
    if (payoutCopper > 0) {
      if (patronActor) steps.push({ op: "gold", actorId: patronActor, copper: -payoutCopper, why: "payout" });
      steps.push({ op: "gold", actorId: crafterId, copper: payoutCopper, why: "payout" });
    }
  }
  return steps;
}

/**
 * Apply steps to a model of the world and return the new model. Throws if anything would go
 * negative. world = { gold: {actorId: copper}, stacks: {actorId: {stackId: qty}}, items: {actorId: string[]} }.
 */
export function applySteps(world, steps) {
  const next = structuredClone(world);
  for (const step of steps) {
    if (step.op === "gold") {
      next.gold[step.actorId] = (next.gold[step.actorId] ?? 0) + step.copper;
      if (next.gold[step.actorId] < 0) throw new Error(`${step.actorId} would go below 0 gold`);
    } else if (step.op === "consume") {
      for (const [stackId, units] of Object.entries(step.byStack)) {
        const have = next.stacks[step.actorId]?.[stackId] ?? 0;
        if (units > have) throw new Error(`${step.actorId} would use ${units} of stack ${stackId} but has ${have}`);
        next.stacks[step.actorId][stackId] = have - units;
      }
    } else if (step.op === "item") {
      (next.items[step.actorId] ??= []).push(step.data?.name ?? "item");
    } else {
      throw new Error(`unknown step "${step.op}"`);
    }
  }
  return next;
}
