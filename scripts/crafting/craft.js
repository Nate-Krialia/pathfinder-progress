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
import { prepareCraft } from "./prepare.js";
import { actorNameOf, readStations, townOfActor } from "../stations/store.js";
import { readFormulaList } from "../research/store.js";
import { defsState, notLoadedText } from "../data/playerState.js";
import { booksFor, noteCrafted } from "../compendium/store.js";
import { effectKnown, knownResult } from "../compendium/experiments.js";
import { propertiesOpen } from "../discovery/store.js";
import { W } from "../discovery/words.js";

const d100 = () => Math.floor(CONFIG.Dice.randomUniform() * 100) + 1;

function stacksFor(actor) {
  return adapter.getMaterialStacks(actor).map(s => ({ stackId: s.item.id, materialId: s.materialId, quantity: s.quantity }));
}

/**
 * A player client has only the recipes its characters hold a formula for (data/playerDefs.js). A HELD formula whose recipe is not
 * loaded is one of: not loaded yet, or held with no recipe anywhere (the GM reported it as orphaned). Only the last says "orphaned".
 */
function playerMissingRecipe(actor, recipeId) {
  if (defsState().missing.has(recipeId)) return `${actor.name} holds an orphaned formula for this (its recipe no longer exists): ask the GM to remove it or restore the recipe.`;
  return notLoadedText();
}

/**
 * Dry run: check materials, station and fee, and show what would be made.
 * Changes nothing. Returns { ok, errors, plan, stations: { verdicts, chosen } }.
 * `stacks` replaces the character's own stash (a queued craft resolves against what it put in escrow).
 */
export function previewCraft(actor, recipeId, selection, api, stationId, { stacks } = {}) {
  const recipe = api.definitions?.recipe.get(recipeId);
  // On a player client a formula the character does not hold gets ONE plain answer, whether or not the recipe happens to be loaded
  // (a sibling character may hold it) or even exists. It never says "unknown".
  if (!game.user.isGM && !readFormulaList(actor).some(entry => entry.recipeId === recipeId)) {
    return { ok: false, errors: [`${actor.name} does not know this formula.`], plan: null, stations: { verdicts: [], chosen: null } };
  }
  if (!recipe && !game.user.isGM) return { ok: false, errors: [playerMissingRecipe(actor, recipeId)], plan: null, stations: { verdicts: [], chosen: null } };
  if (!recipe) {
    const orphaned = readFormulaList(actor).some(entry => entry.recipeId === recipeId);
    const hint = orphaned ? `; ${actor.name} holds an orphaned formula for it (its recipe no longer exists), so the GM should remove it with api.removeFormula or restore the recipe` : "";
    return { ok: false, errors: [`unknown recipe "${recipeId}"${hint}`], plan: null, stations: { verdicts: [], chosen: null } };
  }
  if (api.uncraftable?.has(recipeId)) {
    return { ok: false, errors: [`recipe "${recipeId}" is uncraftable: its output item could not be resolved (see the console errors)`], plan: null, stations: { verdicts: [], chosen: null } };
  }
  if (!game.user.isGM) return playerPreview(actor, recipe, selection, api, stationId, stacks);
  const { stations } = readStations(api);
  const prepared = prepareCraft({
    recipe,
    registry: api.definitions,
    selection,
    stacks: stacks ?? stacksFor(actor),
    outputs: api.resolvedOutputs?.get(recipeId),
    stations,
    crafterId: actor.id,
    townOf: townOfActor,
    townName: id => api.definitions.town.get(id)?.name ?? id,
    nameOf: actorNameOf,
    requestedStationId: stationId,
    formulas: readFormulaList(actor),
    crafterName: actor.name
  });
  return studyGate(actor, selection, api, prepared) ?? prepared;
}

/**
 * A material with a research track stays out of crafts until the character has studied it (its properties milestone), or has already crafted with it
 * (Stage 11c). Enforced here, on whichever client previews, and again by the GM client at queue and resolve time because they call this too.
 * @returns a failed preview, or null when every material in the selection is open to this character
 */
function studyGate(actor, selection, api, prepared) {
  if (!prepared.ok) return null;
  const errors = [];
  for (const materialId of new Set(Object.values(selection ?? {}))) {
    let open = true;
    try { open = propertiesOpen(api, actor, materialId); } catch (error) { console.error(`${MODULE_ID} | could not check whether ${actor.name} has studied "${materialId}"`, error); }
    if (!open) errors.push(W.notStudied(api.definitions?.material.get(materialId)?.name ?? materialId));
  }
  return errors.length ? { ok: false, errors, plan: null, stations: prepared.stations ?? { verdicts: [], chosen: null } } : null;
}

/**
 * A player's preview (docs/11b). It carries the MECHANICAL facts only: slot validity, tier floors, quantities, the station and its fee,
 * the craft days, the materials used. A material's EFFECT is included only where the character has learned it for this recipe
 * (by crafting it, from the shared Compendium, or from the formula's baseline); otherwise that slot is valid and its effect is
 * `{ known: false }`. Nothing here carries a loss chance, a craft level, an output item or the result's name.
 */
function playerPreview(actor, recipe, selection, api, stationId, stacks) {
  const { stations } = readStations(api);
  const prepared = prepareCraft({
    recipe, registry: api.definitions, selection, stacks: stacks ?? stacksFor(actor), stations, crafterId: actor.id, townOf: townOfActor,
    townName: id => api.definitions.town.get(id)?.name ?? id, nameOf: actorNameOf, requestedStationId: stationId,
    formulas: readFormulaList(actor), crafterName: actor.name, mechanical: true
  });
  // A player client only knows the materials the character has met: a material it does not have is "you do not have it", not "unknown".
  if (!prepared.ok) return { ...prepared, errors: prepared.errors.map(e => e.replace(/unknown material "([^"]+)"/, 'you do not have "$1"')) };
  const blocked = studyGate(actor, selection, api, prepared);
  if (blocked) return blocked;

  let books;
  try { books = booksFor(actor); } catch (error) { console.error(`${MODULE_ID} | ${actor.name}'s Compendium could not be read, so no effect is shown as known`, error); books = { own: {}, shared: {} }; }
  const facts = {};
  const slots = recipe.slots.map(slot => {
    const use = prepared.plan.uses.find(u => u.slot === slot.name);
    const fact = effectKnown(books, recipe, slot.name, use.materialId);
    facts[slot.name] = fact;
    return {
      slot: slot.name, materialId: use.materialId, materialName: use.materialName, tier: api.definitions.material.get(use.materialId)?.tier ?? null, units: use.units,
      effect: fact.known ? { known: true, roles: fact.effects, via: fact.via } : { known: false }
    };
  });
  const station = prepared.plan.station;
  const plan = {
    recipeId: recipe.id, recipeName: recipe.name, station, fee: prepared.plan.fee,
    days: recipe.days?.byStation?.[station?.id] ?? recipe.days?.default ?? null,
    uses: prepared.plan.uses, slots, result: knownResult(recipe, facts), effectsKnown: slots.filter(s => s.effect.known).length, formulaAccess: prepared.plan.formulaAccess
  };
  return { ok: true, errors: [], plan, stations: prepared.stations };
}

/**
 * Craft something. GM only.
 * @param {object} options
 * @param {Actor} options.actor
 * @param {string} options.recipeId
 * @param {Object<string,string>} options.selection  slot name -> material id
 * @param {string} [options.station]  station id; needed only when several stations are usable
 * @param {string} [options.degree]  TEST OVERRIDE: skip the roll and force a degree
 * @param {boolean} [options.rollCard]  post PF2e's own roll card (it shows the DC to the table). Default false.
 */
export async function craft({ actor, recipeId, selection, station, degree: forcedDegree, rollCard = false }, api) {
  if (!game.user.isGM) throw new Error("craft: only the GM client can run a craft (hidden rolls). Player requests arrive in a later stage.");

  const preview = previewCraft(actor, recipeId, selection, api, station);
  if (!preview.ok) throw new Error(`craft: cannot craft:\n- ${preview.errors.join("\n- ")}`);
  const { plan } = preview;

  if (!adapter.canAffordGp(actor, plan.fee)) throw new Error(`craft: ${actor.name} cannot afford the ${plan.fee} gp fee`);

  // The craft check: PF2e's own Crafting roll, unless a degree is forced for testing.
  let degree = forcedDegree;
  if (degree) {
    if (!adapter.normalizeDegree(degree)) throw new Error(`craft: unknown degree "${degree}"`);
  } else {
    degree = (await adapter.rollCraftCheck(actor, adapter.levelDC(plan.craftLevel), rollCard ? {} : { createMessage: false })).degree;   // PF2e's own card shows the DC: only if the GM asks (rollCard: true)
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

  if (outcome.made) await noteCrafted(api.definitions, actor, api.definitions.recipe.get(recipeId), plan.uses);   // only a success teaches; best-effort

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: formatSummary({ crafterName: actor.name, plan, outcome, itemName: created?.name })
  });

  console.log(`${MODULE_ID} | craft`, { recipe: recipeId, degree, made: outcome.made, lossRolls: outcome.lossRolls });
  return { outcome, item: created };
}
