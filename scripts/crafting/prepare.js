/**
 * Everything that must be true BEFORE a craft is rolled, in one pure function:
 * materials (planCraft), a reachable station of the right category and tier, and
 * the fee. All problems are reported together. No Foundry globals.
 */
import { evaluateForRecipe, evaluateStations, selectStation } from "../stations/reach.js";
import { planCraft } from "./plan.js";
import { formulaRequirement } from "../research/formulas.js";

/**
 * @param {object} args
 * @param {object} args.recipe
 * @param {object} args.registry
 * @param {Object<string,string>} args.selection
 * @param {Array} args.stacks
 * @param {Object<string,string>} [args.outputs]
 * @param {object[]} args.stations         normalised stations
 * @param {string} args.crafterId
 * @param {(actorId: string) => string|null} args.townOf
 * @param {(townId: string) => string} [args.townName]
 * @param {(actorId: string) => string} [args.nameOf]
 * @param {object[]} args.formulas        the crafter's formula entries (owned and loaned)
 * @param {string} [args.crafterName]
 * @param {string} [args.commissionId]  craft is for this commission: a commission loan is then allowed
 * @param {string} [args.requestedStationId]
 * @param {object} [args.config]
 * @returns {{ ok: boolean, errors: string[], plan: object|null, stations: { verdicts: object[], chosen: object|null } }}
 */
export function prepareCraft({
  recipe, registry, selection, stacks, outputs, stations, crafterId, townOf, townName, nameOf, requestedStationId, formulas, crafterName, config, commissionId
}) {
  const formula = formulaRequirement(formulas ?? [], recipe, crafterName ?? nameOf?.(crafterId) ?? crafterId, { commissionId });
  const verdicts = evaluateForRecipe(evaluateStations({ crafterId, stations, townOf, townName, nameOf }), recipe);
  const picked = selectStation({ verdicts, recipe, requestedId: requestedStationId });
  const planned = planCraft({ recipe, registry, selection, stacks, outputs, station: picked.ok ? picked.station : undefined, config });

  const errors = [...(formula.ok ? [] : [formula.error]), ...(picked.ok ? [] : picked.errors), ...(planned.ok ? [] : planned.errors)];
  if (errors.length === 0) {
    planned.plan.formulaAccess = formula.access;
    planned.plan.provenance.formulaAccess = formula.access;
  }
  return {
    ok: errors.length === 0,
    errors,
    plan: errors.length === 0 ? planned.plan : null,
    stations: { verdicts, chosen: picked.ok ? picked.station : null }
  };
}
