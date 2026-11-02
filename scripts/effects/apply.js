/**
 * Apply a card's effects (v0.22.0), on the GM's client. Pure over injected dependencies, so the tests drive it with plain objects and the module wires the adapter in.
 *
 * Per decisions (docs/11d-item-editor-addendum.md, "v0.22.0 decisions"): the DC is the crafted item's recipe craft-level DC alone; one SECRET save per effect per target,
 * rolled on the TARGET TOKEN's actor; critical failure puts the condition on at value + 1 (capped); failure at its value; success and critical success nothing; "No save"
 * applies by itself; a valueless condition applies on any failure. DCs, totals and degrees go to the GM log, never to chat.
 */
import { EFFECTS } from "../config.js";
import { conditionResult, SHRUGS } from "./plain.js";
import { effectsOf } from "./resolve.js";

/** The value a valued condition ends up at after a save of this degree, or null for no effect. `value` is null for a valueless condition (which applies on any failure). */
export function outcomeFor(degree, value, max = EFFECTS.maxValue) {
  if (degree === null || degree === "failure") return { applies: true, value };
  if (degree === "criticalFailure") return { applies: true, value: value === null ? null : Math.min(value + 1, max) };
  return { applies: false, value: null };
}

/**
 * @param {object} args
 * @param {{ itemUuid: string, targets: string[], effects: number[] }} args.flag
 * @param {object} args.registry
 * @param {object} args.deps  { itemByUuid, craftedFlag, tokenInfo, rollSave, applyCondition, levelDC, log }
 * @param {string} [args.forceDegree]  a save degree to use instead of rolling (the gate and the tests)
 * @returns {Promise<{ ok: true, results: Array<{ name: string, lines: string[] }> } | { ok: false, reason: string }>}
 */
export async function runApply({ flag, registry, deps, forceDegree }) {
  const item = await deps.itemByUuid(flag.itemUuid);
  if (!item) return { ok: false, reason: "I could not find the item any more." };
  const { recipe, effects } = effectsOf(deps.craftedFlag(item), registry);
  const chosen = effects.filter(e => (flag.effects ?? []).includes(e.index));
  if (!recipe || !chosen.length) return { ok: false, reason: "That item no longer has those effects." };
  const dc = deps.levelDC(recipe.craftLevel);
  const results = [];
  for (const uuid of flag.targets) {
    const info = await deps.tokenInfo(uuid);
    if (!info) { results.push({ name: "A target", lines: ["could not be found"] }); continue; }
    const lines = [];
    for (const effect of chosen) {
      try {
        const value = EFFECTS_VALUED(effect) ? effect.value : null;
        let degree = null, rolled = null;
        if (effect.save !== "none") {
          rolled = forceDegree ? { degree: forceDegree, total: null, natural: null } : await deps.rollSave(info.actor, effect.save, dc);
          degree = rolled.degree;
        }
        const outcome = outcomeFor(degree, value);
        let applied = null;
        if (outcome.applies) applied = await deps.applyCondition(info.actor, effect.condition, outcome.value, EFFECTS.maxValue);
        deps.log({ kind: "effect", actorName: info.name, text: `${item.name}: ${effect.condition}${value === null ? "" : ` ${value}`} on ${info.name}, ${effect.save === "none" ? "no save" : `${effect.save} save vs DC ${dc}: ${degree}${rolled.total === null ? "" : ` (total ${rolled.total})`}`}, ${outcome.applies ? `applied${outcome.value === null ? "" : ` at ${applied?.to ?? outcome.value}`}` : "no effect"}`, detail: { item: item.name, material: effect.materialName, condition: effect.condition, save: effect.save, dc, degree, total: rolled?.total ?? null, natural: rolled?.natural ?? null, applied: outcome.applies, to: applied?.to ?? null } });
        lines.push(outcome.applies ? conditionResult(effect.condition) : SHRUGS);
      } catch (error) {
        deps.log({ kind: "effect", actorName: info.name, text: `${item.name}: ${effect.condition} on ${info.name} FAILED: ${error.message}`, detail: { error: error.message } });
        lines.push("could not be affected (see the GM log)");
      }
    }
    results.push({ name: info.name, lines: [...new Set(lines)] });
  }
  return { ok: true, results };
}

const EFFECTS_VALUED = effect => effect.value !== undefined && effect.value !== null;
