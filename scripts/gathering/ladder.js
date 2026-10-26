/**
 * The DC ladder. Pure.
 *
 * A ladder is a list of rungs { materialId, dcOffset, quantity, guaranteed? }.
 * The ONE guaranteed rung is the base rung: the visible roll is against it, and
 * it must be the easiest (lowest dcOffset). Every other rung gets a hidden roll.
 */
import { GATHERING } from "../config.js";

/**
 * Structural problems with a ladder. `field` is relative to the ladder
 * ("" for the ladder itself, "[2].materialId" for a rung's field).
 * @returns {Array<{field: string, message: string}>}
 */
export function validateLadder(rungs) {
  const errors = [];
  const guaranteed = rungs.map((r, i) => (r.guaranteed ? i : -1)).filter(i => i >= 0);
  if (guaranteed.length !== 1) {
    errors.push({ field: "", message: `must have exactly one guaranteed rung (the base rung); found ${guaranteed.length}` });
  } else {
    const base = rungs[guaranteed[0]];
    const easier = rungs.find((r, i) => i !== guaranteed[0] && r.dcOffset < base.dcOffset);
    if (easier) {
      errors.push({
        field: `[${guaranteed[0]}].dcOffset`,
        message: `the guaranteed base rung (${base.materialId}, offset ${base.dcOffset}) must have the lowest dcOffset, but "${easier.materialId}" has ${easier.dcOffset}`
      });
    }
  }
  const seen = new Set();
  rungs.forEach((rung, i) => {
    if (seen.has(rung.materialId)) errors.push({ field: `[${i}].materialId`, message: `duplicate material "${rung.materialId}" in the ladder` });
    seen.add(rung.materialId);
  });
  return errors;
}

export function baseDcFor(tier, config = GATHERING) {
  const dc = config.baseDcByTier[tier];
  if (typeof dc !== "number" || !Number.isFinite(dc)) {
    throw new RangeError(`baseDcFor: no base DC configured for node tier ${tier} (check GATHERING.baseDcByTier)`);
  }
  return dc;
}

/**
 * Turn a ladder into absolute DCs for a node tier.
 * @returns {{ baseDc: number, base: object, higher: object[], rungs: object[] }}
 *   each rung: { materialId, dcOffset, dc, quantity, base: boolean }
 */
export function resolveRungs(ladder, tier, config = GATHERING) {
  const baseDc = baseDcFor(tier, config);
  const rungs = ladder.map(r => ({
    materialId: r.materialId,
    dcOffset: r.dcOffset,
    dc: baseDc + r.dcOffset,
    quantity: r.quantity,
    base: r.guaranteed === true
  }));
  return { baseDc, base: rungs.find(r => r.base), higher: rungs.filter(r => !r.base), rungs };
}
