/**
 * Queue-time escrow for a queued craft. Pure; no Foundry globals.
 *
 * Queueing a craft TAKES the materials out of the stash and the station fee out of the purse (and reserves the
 * days) right away. Nothing is bought, nothing is taken twice: resolving only CONVERTS what was taken (spent
 * for good, or the unused materials handed back), and cancelling hands it all back. The record of what was
 * taken rides inside the queued action (`params.escrow`), so any later step can return exactly that.
 *
 *   escrow = { days, feeCopper, station: { id, name }, units: [{ materialId, name, tier, units }] }
 *
 * (Stage 8 commissions hold nothing until craft time; only the "what is short" helpers are shared with them.)
 */
import { gpText } from "../commissions/commission.js";

const copperOf = gp => Math.round(gp * 100);

/** The id of the pretend stack a resolve plans against: everything in escrow, per material. */
export const escrowStackId = materialId => `escrow:${materialId}`;

/**
 * What a planned craft takes. `tierOf(materialId)` gives the material's tier (so a returned stack can be recreated).
 * @param {object} args
 * @param {object} args.plan  from planCraft (needs uses, fee, station)
 * @param {number} args.days  craft days, from craftDays()
 * @returns {{ escrow: object, byStack: Object<string, number> }}  byStack = units to take from each real stack
 */
export function escrowFromPlan({ plan, days, tierOf }) {
  const byMaterial = new Map();
  const byStack = {};
  for (const use of plan.uses) {
    const entry = byMaterial.get(use.materialId) ?? { materialId: use.materialId, name: use.materialName, tier: tierOf(use.materialId), units: 0 };
    entry.units += use.units;
    byMaterial.set(use.materialId, entry);
    for (const { stackId, units } of use.from) byStack[stackId] = (byStack[stackId] ?? 0) + units;
  }
  return {
    escrow: {
      days,
      feeCopper: copperOf(plan.fee ?? 0),
      station: plan.station ? { id: plan.station.id, name: plan.station.name } : null,
      units: [...byMaterial.values()]
    },
    byStack
  };
}

/** The escrowed materials as stacks planCraft can read at resolve time. */
export const virtualStacks = escrow => escrow.units.map(u => ({ stackId: escrowStackId(u.materialId), materialId: u.materialId, quantity: u.units }));

/**
 * After a resolve: what to hand back. Everything in escrow minus what the outcome consumed (a failure rolls per
 * unit; a critical failure loses it all). `consumeByStack` is the outcome's, keyed by the pretend stack ids.
 */
export function unusedUnits(escrow, consumeByStack) {
  return escrow.units
    .map(u => ({ ...u, units: u.units - (consumeByStack[escrowStackId(u.materialId)] ?? 0) }))
    .filter(u => u.units > 0);
}

/** Problems with an action's escrow record (empty when fine). Used by the audit scan and before returning anything. */
export function escrowProblems(action) {
  const escrow = action?.params?.escrow;
  if (!escrow || typeof escrow !== "object") return ["a queued craft has no escrow record"];
  const problems = [];
  if (!Number.isInteger(escrow.feeCopper) || escrow.feeCopper < 0) problems.push(`the fee in escrow is not a whole number of copper (${JSON.stringify(escrow.feeCopper)})`);
  if (escrow.days !== action.daysReserved) problems.push(`the escrow says ${escrow.days} day(s) but ${action.daysReserved} are reserved`);
  if (!Array.isArray(escrow.units) || !escrow.units.length) problems.push("no materials are recorded in escrow");
  else {
    escrow.units.forEach((u, i) => {
      if (typeof u?.materialId !== "string" || !Number.isInteger(u?.units) || u.units < 1) problems.push(`escrow material #${i + 1} is not valid (${JSON.stringify(u)})`);
    });
  }
  return problems;
}

/** "3x Iron, 1x Spider Fang and a 5 gp fee" for logs and the review window. */
export function describeEscrow(escrow) {
  const parts = escrow.units.map(u => `${u.units}x ${u.name ?? u.materialId}`);
  return `${parts.join(", ") || "no materials"}${escrow.feeCopper ? ` and a ${gpText(escrow.feeCopper)} fee` : ""}`;
}

/**
 * Turn the problems of a refused craft into one plain sentence. A shortage points at the Compendium: nothing is bought.
 */
export function refusalText(errors) {
  const short = errors.some(e => /available|no material selected/.test(e));
  return `Cannot queue this craft: ${errors.join("; ")}.${short ? " Nothing can be bought: check the Compendium for where to find what you are missing." : ""}`;
}
