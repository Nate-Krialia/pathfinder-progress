/**
 * Foundry-bound Compendium: reading and writing the per-character book (an actor flag) and the shared one (a world
 * setting), the recorders that fill it in, and the read APIs.
 *
 * RECORDING IS BEST-EFFORT AND IDEMPOTENT. Every recorder runs inside `safely()`: a failure is logged on the GM and
 * never fails or undoes the action it follows. Writes happen under a per-actor lock, only when something is NEW, and
 * always from a freshly read book, so two recorders running in either order give the same book.
 *
 * Honor system: `view` refuses a caller who does not own the actor, but that is an API courtesy, not security. Foundry
 * cannot hide an actor's flags from a client, so a player using the browser console can read any Compendium (docs/10).
 */
import { COMPENDIUM, MODULE_ID } from "../config.js";
import * as adapter from "../adapter/pf2e.js";
import { check } from "../data/schema.js";
import { LIVE_SCHEMAS } from "../data/schemas.js";
import { isPartyCharacter } from "../party.js";
import { readFormulaList } from "../research/store.js";
import { withLock } from "../queue/lock.js";
import { resolveSlotEffects } from "../crafting/plan.js";
import { computeBaseline, describeExperiments, effectKnown, isOverridden, migrateToClasses, recordBaseline, recordClassFact, recordExperiment, touchExperiment } from "./experiments.js";
import {
  countBook, describeBook, emptyBook, hasMaterial as bookHasMaterial, mergeShared, recordCreature, recordCreatureYield,
  recordMaterial, recordRegion, recordRegionNodeType
} from "./entries.js";

const flagPath = `flags.${MODULE_ID}.${COMPENDIUM.flag}`;
const requireGM = what => { if (!game.user.isGM) throw new Error(`${what}: GM only`); };

// Reading ----------------------------------------------------------------------------------------------------------
/** An actor's book. A damaged flag is a loud error (never silently replaced). */
export function readBook(actor) {
  const raw = actor.getFlag(MODULE_ID, COMPENDIUM.flag);
  if (raw === undefined) return emptyBook();
  const problems = check(LIVE_SCHEMAS.compendium, raw);
  if (problems.length) throw new Error(`${actor.name}'s Compendium is invalid: ${problems.map(p => `${p.field} ${p.message}`).join("; ")}`);
  return raw;
}

export function readShared() {
  const raw = game.settings.get(MODULE_ID, COMPENDIUM.sharedSetting);
  if (raw === undefined || raw === null || (typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length === 0)) return emptyBook();
  const problems = check(LIVE_SCHEMAS.compendium, raw);
  if (problems.length) throw new Error(`the shared Compendium is invalid: ${problems.map(p => `${p.field} ${p.message}`).join("; ")}`);
  return structuredClone(raw);
}

// Writing ----------------------------------------------------------------------------------------------------------
/** Log a failure on the GM and carry on: recording never fails the action it follows. Returns false on failure. */
export async function safely(what, fn) {
  try {
    return await fn();
  } catch (error) {
    console.error(`${MODULE_ID} | could not record in the Compendium (${what}); the action it follows is unaffected`, error);
    return false;
  }
}

/** Apply `change(book)` to an actor's book under the actor's Compendium lock; writes only if something changed. */
export function mutate(actor, change) {
  return withLock(`compendium:${actor.id}`, async () => {
    const before = readBook(actor);
    const after = change(before);
    if (after === before || JSON.stringify(after) === JSON.stringify(before)) return false;
    const problems = check(LIVE_SCHEMAS.compendium, after);
    if (problems.length) throw new Error(`built an invalid Compendium: ${problems.map(p => `${p.field} ${p.message}`).join("; ")}`);
    await actor.update({ [flagPath]: after });
    return true;
  });
}

// Recorders (each one is best-effort and idempotent) ------------------------------------------------------------------
const materialFacts = (definitions, materialId) => {
  const def = definitions?.material.get(materialId);
  return { name: def?.name, tier: def?.tier };
};

/**
 * A gather resolved: record each material that landed, with the place and the ladder rung it came from, and, from a
 * corpse, the yield on that creature's entry. `node` is the node record; `scene` is where it stands.
 */
export function noteGather(definitions, actor, { gains, node, scene, at = Date.now() }) {
  return safely("gather", () => mutate(actor, book => {
    const regionName = node.region ? (definitions?.region.get(node.region)?.name ?? node.region) : null;
    const place = node.region ? { key: `region:${node.region}`, label: regionName } : scene ? { key: `scene:${scene.id}`, label: scene.name } : undefined;
    let next = book;
    for (const gain of gains) {
      const facts = materialFacts(definitions, gain.materialId);
      next = recordMaterial(next, { materialId: gain.materialId, ...facts, place, rung: node.nodeType ? { nodeType: node.nodeType, tier: node.tier, rung: gain.rung } : undefined, at });
      if (node.creature) next = recordCreatureYield(next, { ...node.creature, materialId: gain.materialId, materialName: facts.name, at });
    }
    return next;
  }));
}

/** A material landed in the inventory with no other context (the createItem hook, or a return): just the bare entry if missing. */
export function noteLanded(actor, { id, name, tier }, at = Date.now()) {
  return safely("material landed", () => mutate(actor, book => recordMaterial(book, { materialId: id, name, tier, at })));
}

/** The characters in a combat each get a barebones entry for every creature in it (name and type, nothing else). */
export function noteCombat(combat, at = Date.now()) {
  return safely("combat", async () => {
    const members = [...(combat?.combatants ?? [])].map(c => c.actor).filter(Boolean);
    const characters = members.filter(a => a.type === "character");
    const creatures = members.filter(a => a.type === "npc").map(a => adapter.getCreatureIdentity(a)).filter(c => c.name);
    if (!creatures.length) return false;
    for (const actor of characters) {
      await safely(`combat for ${actor.name}`, () => mutate(actor, book => creatures.reduce((next, creature) => recordCreature(next, { ...creature, at }), book)));
    }
    return true;
  });
}

/** The character explored the region. */
export function noteRegionExplored(definitions, actor, regionId, at = Date.now()) {
  return safely("region explored", () => mutate(actor, book => recordRegion(book, { regionId, name: definitions?.region.get(regionId)?.name, at })));
}

/** The character found nodes of these types (each { nodeType, region }) while searching. */
export function noteNodesFound(definitions, actor, nodes, at = Date.now()) {
  return safely("nodes found", () => mutate(actor, book => nodes.filter(n => n.region).reduce((next, n) => recordRegionNodeType(next, {
    regionId: n.region, regionName: definitions?.region.get(n.region)?.name, nodeType: n.nodeType, nodeTypeName: definitions?.nodeType.get(n.nodeType)?.name, at
  }), book)));
}

// Items the module hands over itself: it records them (or not) itself, once the operation has committed ---------------------
const handled = new Set();
/** True while the module itself is putting this material into the character's inventory (the createItem hook skips it). */
export const isHandled = (actorId, materialId) => handled.has(`${actorId}:${materialId}`);
/**
 * Run `fn` (which adds these materials to a character) without the createItem hook recording them: a gather records them
 * itself, with their place and rung, only after it has committed (so a gather that fails and is undone records nothing);
 * an escrow return records nothing new (see ensureMaterials).
 */
export async function whileHandled(actorId, materialIds, fn) {
  const keys = materialIds.map(id => `${actorId}:${id}`);
  keys.forEach(key => handled.add(key));
  try { return await fn(); } finally { keys.forEach(key => handled.delete(key)); }
}

/**
 * After the module handed materials back: record a material ONLY if the character has no entry for it yet (an escrow
 * return must never leave a material unrecorded that the character did not already have). A material already recorded
 * is not touched, so a return changes nothing.
 */
export function ensureMaterials(actor, materials) {
  return safely("escrow return", () => mutate(actor, book => materials.reduce((next, m) => (bookHasMaterial(next, m.id) ? next : recordMaterial(next, { materialId: m.id, name: m.name, tier: m.tier })), book)));
}

/** The createItem hook: a module material item appeared on a character (dragged, traded, paid out). */
export function onItemCreated(item) {
  const actor = item?.parent;
  if (!actor || actor.type !== "character") return;
  const flags = adapter.getMaterialFlags(item);
  if (!flags?.materialId || isHandled(actor.id, flags.materialId)) return;
  return noteLanded(actor, { id: flags.materialId, name: item.name, tier: flags.tier });
}

// Experiments (docs/11b, B) ---------------------------------------------------------------------------------------------
/**
 * A craft MADE the item (a success or a critical success; a failure teaches nothing): the crafter learns, for each slot, what the
 * material they used gives there. Effects come from the shared resolver. Best-effort and idempotent; call it after the craft committed.
 * @param {object} recipe  the full recipe (GM registry)
 * @param {Array<{ slot: string, materialId: string }>} uses  what went into the craft
 */
export function noteCrafted(definitions, actor, recipe, uses, at = Date.now()) {
  return safely("experiments", () => mutate(actor, book => uses.reduce((next, use) => {
    const slot = recipe.slots.find(s => s.name === use.slot);
    const material = definitions?.material.get(use.materialId);
    if (!slot || !material) return next;
    const { resolved, missing } = resolveSlotEffects(recipe, slot, material);
    if (missing.length) return next;
    // Where the recipe gives this material its own effect, the craft teaches THAT recipe (an override); otherwise it teaches the whole item class (armor, weapon, ...).
    if (isOverridden(recipe, slot.name, material.id)) return recordExperiment(next, { recipeId: recipe.id, recipeName: recipe.name, category: recipe.category, slot: slot.name, materialId: material.id, materialName: material.name, tier: material.tier, effects: resolved, at });
    return recordClassFact(touchExperiment(next, { recipeId: recipe.id, recipeName: recipe.name, category: recipe.category, at }), { category: recipe.category, materialId: material.id, materialName: material.name, tier: material.tier, effects: resolved, at });
  }, book)));
}

/** A character gained an OWNED formula (research done, a GM grant, a commission that teaches): reveal its baseline. Best-effort; a loan does not call this. */
export function noteFormulaOwned(definitions, actor, recipeId, at = Date.now()) {
  return safely("baseline", () => {
    const recipe = definitions?.recipe.get(recipeId);
    const baseline = recipe ? computeBaseline(recipe, definitions) : null;
    if (!recipe || !baseline) return false;
    return mutate(actor, book => recordBaseline(book, { recipeId, recipeName: recipe.name, category: recipe.category, baseline, at }));
  });
}

/** GM tool: reveal the baselines of the OWNED formulas a character (or every character) already holds. Returns how many were revealed. */
export async function revealBaselines(definitions, actor) {
  requireGM("compendium.revealBaselines");
  let revealed = 0;
  for (const target of actor ? [actor] : [...game.actors].filter(a => a.type === "character")) {
    for (const formula of readFormulaList(target).filter(f => f.access === "owned")) {
      if (readBook(target).experiments?.[formula.recipeId]?.baseline) continue;
      if (await noteFormulaOwned(definitions, target, formula.recipeId)) revealed++;
    }
  }
  return revealed;
}

/** Has the character learned what `materialId` gives in `slot` of the recipe? Their own book, the party's, or the formula's baseline. `recipe` is the recipe (for its class) or its id. */
export function knownEffect(actor, recipe, slot, materialId) {
  return effectKnown(booksFor(actor), recipe, slot, materialId);
}

/**
 * GM tool: fold the old per-recipe facts into item classes, for every character and the shared book (Stage 11c, idempotent: it writes only what is new).
 * Returns how many books changed. The module runs it once when the GM client is ready.
 */
export async function migrateClasses(definitions) {
  requireGM("compendium.migrateClasses");
  const recipeOf = id => definitions?.recipe.get(id);
  let changed = 0;
  for (const actor of [...game.actors].filter(a => a.type === "character" && a.getFlag(MODULE_ID, COMPENDIUM.flag) !== undefined)) {
    if (await mutate(actor, book => migrateToClasses(book, recipeOf))) changed++;
  }
  const shared = readShared();
  const folded = migrateToClasses(shared, recipeOf);
  if (JSON.stringify(folded) !== JSON.stringify(shared)) {
    await withLock("compendium:shared", async () => game.settings.set(MODULE_ID, COMPENDIUM.sharedSetting, migrateToClasses(readShared(), recipeOf)));
    changed++;
  }
  return changed;
}

/** What a character knows, for a preview: their own book and, for a party character, the shared one. */
export const booksFor = actor => ({ own: readBook(actor), shared: isPartyCharacter(actor) ? readShared() : emptyBook() });

// Reading API ---------------------------------------------------------------------------------------------------------
const toList = (definitions, actor, book, shared) => describeBook(book, { materialDefs: definitions?.material, formulas: actor ? readFormulaList(actor) : [], shared });

/**
 * A character's Compendium for a UI: their own entries, the party's shared entries (party characters only), and the two
 * merged by entry (`source` is "own", "shared" or "both"). Only the character's owner (or the GM) may read it: an API
 * courtesy, not security (docs/10).
 */
export function view(definitions, actor) {
  if (!game.user.isGM && !actor.isOwner) throw new Error("You can only read the Compendium of a character you own.");
  const own = readBook(actor);
  const shared = isPartyCharacter(actor) ? readShared() : emptyBook();
  const merged = structuredClone(own);
  for (const [kind, category] of [["material", "materials"], ["creature", "creatures"], ["region", "regions"]]) {
    for (const entry of Object.values(shared[category])) {
      const key = kind === "creature" ? entry.key : entry.id;
      if (!Object.hasOwn(merged[category], key)) merged[category][key] = structuredClone(entry);
      else Object.assign(merged, mergeShared(merged, kind, entry));
    }
  }
  const mark = (list, category, keyField) => list.map(e => {
    const inOwn = Object.hasOwn(own[category], e[keyField]);
    const inShared = Object.hasOwn(shared[category], e[keyField]);
    return { ...e, source: inOwn && inShared ? "both" : inOwn ? "own" : "shared" };
  });
  const entries = toList(definitions, actor, merged, false);
  const experiments = describeExperiments({ own, shared, recipes: definitions?.recipe });
  return {
    actor: { id: actor.id, name: actor.name },
    entries: { materials: mark(entries.materials, "materials", "id"), creatures: mark(entries.creatures, "creatures", "key"), regions: mark(entries.regions, "regions", "id"), experiments },
    own: { ...toList(definitions, actor, own, false), experiments: describeExperiments({ own, shared: emptyBook(), recipes: definitions?.recipe }) },
    shared: { ...toList(definitions, null, shared, true), experiments: describeExperiments({ own: emptyBook(), shared, recipes: definitions?.recipe }) }
  };
}

/** GM only: every character's progress and entries, and what is shared with the party. */
export function all(definitions) {
  requireGM("compendium.all");
  const characters = [...game.actors].filter(a => a.type === "character" && a.getFlag(MODULE_ID, COMPENDIUM.flag) !== undefined);
  return {
    characters: characters.map(actor => ({ actorId: actor.id, name: actor.name, counts: countBook(readBook(actor)), ...toList(definitions, actor, readBook(actor), false), experiments: describeExperiments({ own: readBook(actor), shared: emptyBook(), recipes: definitions?.recipe }) })),
    shared: { counts: countBook(readShared()), ...toList(definitions, null, readShared(), true), experiments: describeExperiments({ own: emptyBook(), shared: readShared(), recipes: definitions?.recipe }) }
  };
}

/** Has the character discovered this material (their own entry, or one shared with the party)? For the future "formulae only offer discovered materials" rule. */
export function hasMaterial(actor, materialId) {
  if (bookHasMaterial(readBook(actor), materialId)) return true;
  return isPartyCharacter(actor) && bookHasMaterial(readShared(), materialId);
}

/** Merge one shared entry into the world's shared Compendium (the GM approved a share). Idempotent. */
export function mergeIntoShared(kind, entry) {
  return withLock("compendium:shared", async () => {
    const before = readShared();
    const after = mergeShared(before, kind, entry);
    if (JSON.stringify(after) === JSON.stringify(before)) return false;
    await game.settings.set(MODULE_ID, COMPENDIUM.sharedSetting, after);
    return true;
  });
}
