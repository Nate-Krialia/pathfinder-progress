/**
 * How many downtime days a craft takes. Pure; no Foundry globals.
 *
 * THE one place craft time is worked out: every reduction (station upgrades, tools) is applied first,
 * then the result is clamped so a craft never takes less than `minDays`. The queued craft (queue/work.js) calls it;
 * nothing else works craft time out.
 */
import { CRAFT_DAYS } from "../config.js";

/**
 * @param {object} recipe  needs craftLevel
 * @param {Array<number|{ days: number, source?: string }>} [reductions]  days to take off, each 0 or more
 * @returns {{ days: number, base: number, reduction: number, floored: boolean }}
 */
export function craftDays(recipe, reductions = [], config = CRAFT_DAYS) {
  if (!Number.isInteger(recipe?.craftLevel) || recipe.craftLevel < 0) throw new RangeError(`craftDays: the recipe needs a craftLevel of 0 or more (got ${recipe?.craftLevel})`);
  const base = config.baseDays + Math.floor(recipe.craftLevel / config.levelsPerExtraDay);
  let reduction = 0;
  for (const r of reductions) {
    const days = typeof r === "number" ? r : r?.days;
    if (!Number.isInteger(days) || days < 0) throw new RangeError(`craftDays: a reduction must be a whole number of days, 0 or more (got ${JSON.stringify(r)})`);
    reduction += days;
  }
  const raw = base - reduction;
  const days = Math.max(config.minDays, raw);
  return { days, base, reduction, floored: raw < config.minDays };
}
