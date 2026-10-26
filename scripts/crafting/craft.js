/**
 * The GM-run crafting entry point (Stage 2). Players cannot call this yet:
 * hidden loss rolls must run on the GM client, and the queue/UI that relays
 * player requests arrives in later stages.
 */
import { CRAFTING, MODULE_ID } from "../config.js";
import * as adapter from "../adapter/pf2e.js";
import { planCraft } from "./plan.js";
import { resolveOutcome } from "./outcome.js";
import { formatSummary } from "./summary.js";

const d100 = () => Math.ceil(CONFIG.Dice.randomUniform() * 100);

function stacksFor(actor) {
  return adapter.getMaterialStacks(actor).map(s => ({ stackId: s.item.id, materialId: s.materialId, quantity: s.quantity }));
}

/** Dry run: validate a selection and show what would be made. Changes nothing. */
export function previewCraft(actor, recipeId, selection, api) {
  const recipe = api.definitions?.recipe.get(recipeId);
  if (!recipe) return { ok: false, errors: [`unknown recipe "${recipeId}"`] };
  if (api.uncraftable?.has(recipeId)) return { ok: false, errors: [`recipe "${recipeId}" is uncraftable: its output item could not be resolved (see the console errors)`] };
  return planCraft({ recipe, registry: api.definitions, selection, stacks: stacksFor(actor), outputs: api.resolvedOutputs?.get(recipeId) });
}

/**
 * Craft something. GM only.
 * @param {object} options
 * @param {Actor} options.actor
 * @param {string} options.recipeId
 * @param {Object<string,string>} options.selection  slot name -> material id
 * @param {string} [options.degree]  TEST OVERRIDE: skip the roll and force a degree
 */
export async function craft({ actor, recipeId, selection, degree: forcedDegree }, api) {
  if (!game.user.isGM) throw new Error("craft: only the GM client can run a craft (hidden rolls). Player requests arrive in a later stage.");

  const preview = previewCraft(actor, recipeId, selection, api);
  if (!preview.ok) throw new Error(`craft: cannot craft:\n- ${preview.errors.join("\n- ")}`);
  const { plan } = preview;

  if (!adapter.canAffordGp(actor, plan.fee)) throw new Error(`craft: ${actor.name} cannot afford the ${plan.fee} gp fee`);

  // The craft check: PF2e's own Crafting roll, unless a degree is forced for testing.
  let degree = forcedDegree;
  if (degree) {
    if (!adapter.normalizeDegree(degree)) throw new Error(`craft: unknown degree "${degree}"`);
  } else {
    degree = (await adapter.rollCraftCheck(actor, adapter.levelDC(plan.craftLevel))).degree;
  }

  const outcome = resolveOutcome({ plan, degree, rng: d100, config: CRAFTING });

  // Apply: fee, materials, then the item.
  await adapter.removeGp(actor, outcome.feeConsumed);
  await adapter.consumeMaterialStacks(actor, outcome.consumeByStack);

  let created = null;
  if (outcome.made) {
    const base = await adapter.loadItemSource(plan.outputUuid);
    const data = adapter.buildCraftedItemData(base, plan.description, {
      ...plan.provenance,
      crafter: actor.id,
      degree: outcome.degree
    }, { name: plan.resultName ?? undefined });
    created = await adapter.createItemOnActor(actor, data);
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: formatSummary({ crafterName: actor.name, plan, outcome, itemName: created?.name })
  });

  console.log(`${MODULE_ID} | craft`, { recipe: recipeId, degree, made: outcome.made, lossRolls: outcome.lossRolls });
  return { outcome, item: created };
}
