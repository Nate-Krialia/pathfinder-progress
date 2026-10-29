/**
 * Foundry-side loading of definitions from compendium packs.
 * Reads every text page of every Journal entry in the definitions pack (plus
 * any packs named in the "extraPacks" setting) and validates them together.
 */
import { MODULE_ID, PACKS } from "../config.js";
import { clearItemIndexCache, describeItemUuid, expectedItemType, listItemPackIds, loadItemPackSources } from "../adapter/pf2e.js";
import { createRefCache, expandPackPatterns, parsePackList, resolveRefCached } from "./outputRefs.js";
import { formatError, loadDefinitions } from "./validate.js";

export function packIds() {
  const extra = (game.settings.get(MODULE_ID, "extraPacks") ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
  return [PACKS.definitions, PACKS.recipes, ...extra];
}

/**
 * Read every definition pack. A PLAYER client reads none of them (Stage 16): it gets the definitions its characters need from
 * the GM client instead (data/playerDefs.js). Foundry itself does not stop a player reading a pack from the console; this
 * is an honor system, not secrecy.
 */
export async function collectSources() {
  const sources = [];
  const problems = [];
  if (!game.user.isGM) return { sources, problems };
  for (const id of packIds()) {
    const pack = game.packs.get(id);
    if (!pack) {
      if (game.user.isGM) problems.push({ pack: id, entry: "(pack)", field: "(pack)", message: "was not found; check the pack id" });
      continue; // players are not shown configuration problems
    }
    if (pack.documentName !== "JournalEntry") {
      problems.push({ pack: id, entry: "(pack)", field: "(pack)", message: `must be a Journal Entry pack (is ${pack.documentName})` });
      continue;
    }
    if (!game.user.isGM && pack.visible === false) continue;
    let documents;
    try {
      documents = await pack.getDocuments();
    } catch (error) {
      if (!game.user.isGM) continue; // a player who cannot read the pack
      problems.push({ pack: id, entry: "(pack)", field: "(pack)", message: `could not be read: ${error.message}` });
      continue;
    }
    for (const entry of documents) {
      for (const page of entry.pages) {
        if (page.type !== "text") continue;
        const label = entry.pages.size > 1 ? `${entry.name} / ${page.name}` : entry.name;
        sources.push({ pack: id, entry: label, text: page.text?.markdown ?? page.text?.content ?? "" });
      }
    }
  }
  return { sources, problems };
}

const refCache = createRefCache();

/** Forget resolved output references and pack indexes (done by reload({ fresh: true })). */
export function clearOutputCache() {
  refCache.clear();
  clearItemIndexCache();
}

/**
 * Resolve each recipe's output references (names, "Pack: Name" or UUIDs) to
 * real PF2e items, and check their type. A recipe with ANY unresolved output
 * is uncraftable; other recipes are unaffected. Never guesses: no match or
 * several matches is an error naming the recipe, the reference and what was found.
 * Returns { errors, uncraftable, resolved } where resolved is recipeId -> { tier: uuid }.
 */
export async function checkOutputs(registry, contexts) {
  const errors = [];
  const uncraftable = new Set();
  const resolved = new Map();

  const { ids, missing } = expandPackPatterns(parsePackList(game.settings.get(MODULE_ID, "itemPacks")), listItemPackIds());
  for (const id of missing) {
    errors.push({ pack: "(settings)", entry: "Item packs", field: "itemPacks", message: `names pack "${id}", which was not found` });
  }
  const sources = await loadItemPackSources(ids);

  for (const recipe of registry.recipe.values()) {
    const ctx = contexts.get(recipe.id) ?? { pack: "(unknown pack)", entry: recipe.id };
    const wanted = expectedItemType(recipe.category);
    const outputs = {};

    for (const [tier, ref] of Object.entries(recipe.output)) {
      const field = `output.${tier}`;
      const fail = message => {
        errors.push({ ...ctx, field, message: `${message}; recipe "${recipe.id}" is uncraftable until fixed` });
        uncraftable.add(recipe.id);
      };

      const result = resolveRefCached(ref, sources, refCache);
      if (!result.ok) { fail(`output "${ref}": ${result.message}`); continue; }

      let info;
      try {
        info = await describeItemUuid(result.uuid);
      } catch (err) {
        info = { found: false, error: err.message };
      }
      if (!info.found) fail(`output "${ref}": item ${result.uuid} was not found${info.error ? ` (${info.error})` : ""}`);
      else if (!info.isPhysical) fail(`output "${ref}": "${info.name}" is a ${info.type}, not a physical item`);
      else if (wanted && info.type !== wanted) fail(`output "${ref}": "${info.name}" is a ${info.type}, but a ${recipe.category} recipe needs a ${wanted}`);
      else outputs[tier] = result.uuid;
    }

    if (!uncraftable.has(recipe.id)) resolved.set(recipe.id, outputs);
  }
  return { errors, uncraftable, resolved };
}

/** Load and validate everything. Returns { registry, errors, contexts, uncraftable, resolved }. Never throws. */
export async function loadAll({ fresh = false } = {}) {
  if (fresh) clearOutputCache();
  const { sources, problems } = await collectSources();
  const { registry, errors, contexts } = loadDefinitions(sources);
  const outputs = await checkOutputs(registry, contexts);
  return { registry, errors: [...problems, ...errors, ...outputs.errors], contexts, uncraftable: outputs.uncraftable, resolved: outputs.resolved };
}

/** Report errors loudly: console for everyone, a notification for the GM. */
export function reportErrors(errors) {
  if (!errors.length) return;
  console.error(`${MODULE_ID} | ${errors.length} definition problem(s):\n${errors.map(formatError).join("\n")}`);
  if (game.user.isGM) {
    ui.notifications.error(`${MODULE_ID}: ${errors.length} definition problem(s). Press F12 for details.`, { permanent: true });
  }
}
