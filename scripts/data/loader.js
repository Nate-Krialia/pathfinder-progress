/**
 * Foundry-side loading of definitions from compendium packs.
 * Reads every text page of every Journal entry in the definitions pack (plus
 * any packs named in the "extraPacks" setting) and validates them together.
 */
import { MODULE_ID, PACKS } from "../config.js";
import { describeItemUuid, expectedItemType } from "../adapter/pf2e.js";
import { formatError, loadDefinitions } from "./validate.js";

export function packIds() {
  const extra = (game.settings.get(MODULE_ID, "extraPacks") ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
  return [PACKS.definitions, ...extra];
}

async function collectSources() {
  const sources = [];
  const problems = [];
  for (const id of packIds()) {
    const pack = game.packs.get(id);
    if (!pack) {
      problems.push({ pack: id, entry: "(pack)", field: "(pack)", message: "was not found; check the pack id" });
      continue;
    }
    if (pack.documentName !== "JournalEntry") {
      problems.push({ pack: id, entry: "(pack)", field: "(pack)", message: `must be a Journal Entry pack (is ${pack.documentName})` });
      continue;
    }
    for (const entry of await pack.getDocuments()) {
      for (const page of entry.pages) {
        if (page.type !== "text") continue;
        const label = entry.pages.size > 1 ? `${entry.name} / ${page.name}` : entry.name;
        sources.push({ pack: id, entry: label, text: page.text?.markdown ?? page.text?.content ?? "" });
      }
    }
  }
  return { sources, problems };
}

/**
 * Confirm each recipe's output UUIDs point at real PF2e items of a sensible
 * type. A recipe with a bad output is marked uncraftable (other recipes are
 * unaffected). Returns { errors, uncraftable }.
 */
export async function checkOutputs(registry, contexts) {
  const errors = [];
  const uncraftable = new Set();
  for (const recipe of registry.recipe.values()) {
    const ctx = contexts.get(recipe.id) ?? { pack: "(unknown pack)", entry: recipe.id };
    const wanted = expectedItemType(recipe.category);
    for (const [tier, uuid] of Object.entries(recipe.output)) {
      const field = `output.${tier}`;
      let info;
      try {
        info = await describeItemUuid(uuid);
      } catch (err) {
        info = { found: false, error: err.message };
      }
      let problem = null;
      if (!info.found) problem = `item ${uuid} was not found${info.error ? ` (${info.error})` : ""}`;
      else if (!info.isPhysical) problem = `item "${info.name}" is a ${info.type}, not a physical item`;
      else if (wanted && info.type !== wanted) problem = `item "${info.name}" is a ${info.type}, but a ${recipe.category} recipe needs a ${wanted}`;
      if (problem) {
        errors.push({ ...ctx, field, message: `${problem}; recipe "${recipe.id}" is uncraftable until fixed` });
        uncraftable.add(recipe.id);
      }
    }
  }
  return { errors, uncraftable };
}

/** Load and validate everything. Returns { registry, errors, contexts, uncraftable }. Never throws. */
export async function loadAll() {
  const { sources, problems } = await collectSources();
  const { registry, errors, contexts } = loadDefinitions(sources);
  const outputs = await checkOutputs(registry, contexts);
  return { registry, errors: [...problems, ...errors, ...outputs.errors], contexts, uncraftable: outputs.uncraftable };
}

/** Report errors loudly: console for everyone, a notification for the GM. */
export function reportErrors(errors) {
  if (!errors.length) return;
  console.error(`${MODULE_ID} | ${errors.length} definition problem(s):\n${errors.map(formatError).join("\n")}`);
  if (game.user.isGM) {
    ui.notifications.error(`${MODULE_ID}: ${errors.length} definition problem(s). Press F12 for details.`, { permanent: true });
  }
}
