/**
 * PF2e adapter.
 *
 * The ONE file allowed to read PF2e-specific data (items, actors, level DCs,
 * creature level/traits). A PF2e update should only ever break this file.
 * Everything else calls these functions instead of touching PF2e internals.
 *
 * Targets: Foundry 14.369, PF2e 8.6.1 (see TARGETS in ../config.js).
 */
import { MODULE_ID, TARGETS } from "../config.js";

// Damage types ----------------------------------------------------------------
// PF2e (Remaster) damage types. checkVersions() compares this with the live
// CONFIG.PF2E.damageTypes so drift shows up as a warning, not a silent bug.
export const DAMAGE_TYPES = [
  "acid", "bleed", "bludgeoning", "cold", "electricity", "fire", "force", "mental",
  "piercing", "poison", "slashing", "sonic", "spirit", "vitality", "void"
];

// Level-based DCs -----------------------------------------------------------
// PF2e "DCs by Level" table (Core Rulebook, Table 10-5). It is fixed rules
// data and the system does not expose it as a stable API, so it lives here.
const DC_BY_LEVEL = [
  14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30,
  31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50
];

/** Standard DC for a character/creature level (0 to 25). */
export function levelDC(level) {
  if (!Number.isInteger(level) || level < 0 || level >= DC_BY_LEVEL.length) {
    throw new RangeError(`levelDC: level must be an integer from 0 to ${DC_BY_LEVEL.length - 1} (got ${level})`);
  }
  return DC_BY_LEVEL[level];
}

// Material items ------------------------------------------------------------
// Materials are real PF2e Items carrying module flags: { materialId, tier }.

/** The material flags on an item, or null if it is not a material. */
export function getMaterialFlags(item) {
  const flags = item?.getFlag?.(MODULE_ID, "material");
  return flags?.materialId ? { materialId: flags.materialId, tier: flags.tier } : null;
}

export function isMaterialItem(item) {
  return getMaterialFlags(item) !== null;
}

export function setMaterialFlags(item, { materialId, tier }) {
  return item.setFlag(MODULE_ID, "material", { materialId, tier });
}

/** Every material stack an actor owns, with its quantity. */
export function getMaterialStacks(actor) {
  return actor.items
    .map(item => ({ item, flags: getMaterialFlags(item) }))
    .filter(entry => entry.flags)
    .map(({ item, flags }) => ({
      item,
      materialId: flags.materialId,
      tier: flags.tier,
      quantity: item.system?.quantity ?? 1
    }));
}

// Creatures (for corpse yields, later stages) ------------------------------
/** Level and trait slugs for a creature actor. */
export function getCreatureInfo(actor) {
  const level = actor?.system?.details?.level?.value ?? actor?.level ?? 0;
  const raw = actor?.system?.traits?.value ?? [...(actor?.traits ?? [])];
  return { level, traits: raw.map(String) };
}

// Version check -------------------------------------------------------------
const toNumbers = v => String(v).split(".").map(n => parseInt(n, 10) || 0);

/** True when `version` is at least `minimum`, comparing dotted numbers. */
export function versionAtLeast(version, minimum) {
  const a = toNumbers(version);
  const b = toNumbers(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}

/** Returns a list of human-readable warnings (empty when versions are fine). */
export function checkVersions() {
  const warnings = [];
  if (game.system.id !== "pf2e") {
    warnings.push(`This module needs the pf2e system (found "${game.system.id}").`);
    return warnings;
  }
  if (!versionAtLeast(game.system.version, TARGETS.pf2e)) {
    warnings.push(`Built for PF2e ${TARGETS.pf2e} or newer; running ${game.system.version}.`);
  }
  if (!versionAtLeast(game.version, TARGETS.foundry)) {
    warnings.push(`Built for Foundry ${TARGETS.foundry} or newer; running ${game.version}.`);
  }
  const live = CONFIG.PF2E?.damageTypes;
  if (live) {
    const missing = DAMAGE_TYPES.filter(type => !(type in live));
    if (missing.length) warnings.push(`Damage types not known to this PF2e version: ${missing.join(", ")}.`);
  }
  return warnings;
}

// Crafted item data (pure: plain objects in, plain objects out) ---------------
// The core code describes WHAT a crafted item gets; this section is the only
// place that knows HOW PF2e expresses it (rule elements on system.rules).

/**
 * Selector that limits a rule to this one item's own damage rolls. PF2e's docs
 * show both `{item|_id}` and `{item|id}`; confirm at the Stage 2 gate.
 */
export const ITEM_DAMAGE_SELECTOR = "{item|_id}-damage";

export const DEGREES = ["criticalFailure", "failure", "success", "criticalSuccess"];

/** Turn a raw PF2e degree (0 to 3, or a name) into one of DEGREES, else null. */
export function normalizeDegree(raw) {
  if (Number.isInteger(raw) && raw >= 0 && raw <= 3) return DEGREES[raw];
  return DEGREES.includes(raw) ? raw : null;
}

/** Neutral description -> PF2e rule element JSON. */
export function buildRuleElements(description) {
  const rules = [];

  for (const bonus of description.damageBonuses ?? []) {
    const [count, die] = bonus.dice.split("d");
    rules.push({
      key: "DamageDice",
      selector: ITEM_DAMAGE_SELECTOR,
      diceNumber: Number(count),
      dieSize: `d${die}`,
      damageType: bonus.type,
      ...(bonus.persistent ? { category: "persistent" } : {}),
      ...(bonus.versus ? { predicate: [`target:trait:${bonus.versus}`] } : {}),
      label: bonus.label ?? "Crafted"
    });
  }

  for (const ability of description.abilities ?? []) {
    rules.push({
      key: "Note",
      selector: ITEM_DAMAGE_SELECTOR,
      title: ability.title,
      text: ability.text,
      outcome: ability.on === "criticalHit" ? ["criticalSuccess"] : ["success", "criticalSuccess"]
    });
  }

  for (const resistance of description.resistances ?? []) {
    rules.push({ key: "Resistance", type: resistance.type, value: resistance.value });
  }

  return rules;
}

const escapeHtml = text => String(text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** A readable summary appended to the crafted item's description. */
export function buildDescriptionHtml(description) {
  const items = [];
  for (const b of description.damageBonuses ?? []) {
    const extra = [b.persistent ? "persistent" : null, b.versus ? `vs ${b.versus}` : null].filter(Boolean).join(", ");
    items.push(`+${escapeHtml(b.dice)} ${escapeHtml(b.type)}${extra ? ` (${escapeHtml(extra)})` : ""}`);
  }
  for (const a of description.abilities ?? []) items.push(`<strong>${escapeHtml(a.title)}:</strong> ${a.text}`);
  for (const r of description.resistances ?? []) items.push(`Resistance ${escapeHtml(r.type)} ${r.value}`);
  if (description.spellSlots) items.push(`Spell slots: +${description.spellSlots}`);
  if (!items.length) return "";
  return `<hr><p><strong>Crafted properties</strong></p><ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>`;
}

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/** Set a dotted path on a plain object. Only `system.*` (never rules) is allowed. */
export function setPath(target, path, value) {
  const segments = path.split(".");
  if (segments[0] !== "system" || segments.length < 2 || segments[1] === "rules" || segments.some(seg => !seg || FORBIDDEN_SEGMENTS.has(seg))) {
    throw new Error(`adapter: refusing to write to "${path}" (custom roles may only modify system.* other than system.rules)`);
  }
  let node = target;
  for (const seg of segments.slice(0, -1)) {
    if (typeof node[seg] !== "object" || node[seg] === null) node[seg] = {};
    node = node[seg];
  }
  node[segments.at(-1)] = value;
}

/**
 * Build the item data for a crafted item from the base item's source data.
 * @param {object} baseData    item.toObject() of the output item
 * @param {object} description neutral effects description from the plan
 * @param {object} provenance  { recipeId, materials, crafter, degree }
 * @param {{name?: string}} [options]
 */
export function buildCraftedItemData(baseData, description, provenance, options = {}) {
  const data = structuredClone(baseData);
  delete data._id;
  delete data.folder;
  delete data.ownership;
  if (options.name) data.name = options.name;

  data.system ??= {};
  data.system.rules = [...(data.system.rules ?? []), ...buildRuleElements(description)];
  data.system.quantity = 1;

  const extra = buildDescriptionHtml(description);
  if (extra) {
    data.system.description ??= {};
    data.system.description.value = `${data.system.description.value ?? ""}${extra}`;
  }
  for (const field of description.fields ?? []) setPath(data, field.path, field.value);

  data.flags ??= {};
  data.flags[MODULE_ID] = { ...(data.flags[MODULE_ID] ?? {}), crafted: provenance };
  return data;
}

// Foundry-bound functions (thin; exercised by the in-Foundry gate) ------------

/** Look an item up by UUID. Returns { found, name, type, isPhysical }. */
export async function describeItemUuid(uuid) {
  const doc = await fromUuid(uuid);
  if (!doc) return { found: false };
  return { found: true, name: doc.name, type: doc.type, isPhysical: doc.isOfType?.("physical") ?? false };
}

/** The PF2e item type a recipe category should produce, or null for "any physical item". */
export function expectedItemType(category) {
  if (category === "weapon") return "weapon";
  if (category === "armor" || category === "robes") return "armor";
  return null;
}

/** Find an item in the PF2e equipment compendium by exact name; returns its UUID(s). */
export async function findItemUuid(name, packId = "pf2e.equipment-srd") {
  const pack = game.packs.get(packId);
  if (!pack) throw new Error(`adapter.findItemUuid: pack "${packId}" not found`);
  const index = await pack.getIndex();
  return index.filter(entry => entry.name === name).map(entry => `Compendium.${packId}.Item.${entry._id}`);
}

/** Ids of every Item compendium in this world (PF2e's, other modules', and world packs). */
export function listItemPackIds() {
  return game.packs.filter(pack => pack.documentName === "Item").map(pack => pack.collection);
}

const packIndexCache = new Map();

/** Forget cached pack indexes (call when the item packs may have changed). */
export function clearItemIndexCache() {
  packIndexCache.clear();
}

/**
 * Index the named Item packs for name lookup: [{ id, label, entries: [{ name, uuid, type }] }].
 * Indexes are cached for the session; unknown ids are skipped (the caller reports them).
 */
export async function loadItemPackSources(packIds) {
  const sources = [];
  for (const id of packIds) {
    const pack = game.packs.get(id);
    if (!pack) continue;
    if (!packIndexCache.has(id)) {
      const index = await pack.getIndex();
      packIndexCache.set(id, index.map(entry => ({ name: entry.name, uuid: `Compendium.${id}.Item.${entry._id}`, type: entry.type })));
    }
    sources.push({ id, label: pack.title, entries: packIndexCache.get(id) });
  }
  return sources;
}

export async function loadItemSource(uuid) {
  const doc = await fromUuid(uuid);
  if (!doc) throw new Error(`adapter.loadItemSource: no item found for ${uuid}`);
  return doc.toObject();
}

export async function createItemOnActor(actor, data) {
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  return created;
}

/** Remove material units: byStack is { <itemId>: units }. Deletes a stack when it reaches 0. */
export async function consumeMaterialStacks(actor, byStack) {
  for (const [itemId, units] of Object.entries(byStack)) {
    const item = actor.items.get(itemId);
    if (!item) throw new Error(`adapter.consumeMaterialStacks: item ${itemId} not found on ${actor.name}`);
    const quantity = item.system?.quantity ?? 1;
    if (units >= quantity) await item.delete();
    else await item.update({ "system.quantity": quantity - units });
  }
}

export function canAffordGp(actor, gp) {
  const coins = actor.inventory?.coins;
  const held = coins?.goldValue ?? (coins?.copperValue !== undefined ? coins.copperValue / 100 : undefined);
  if (held === undefined) throw new Error("adapter.canAffordGp: cannot read actor.inventory.coins (PF2e API changed?)");
  return held >= gp;
}

export async function removeGp(actor, gp) {
  if (!actor.inventory?.removeCoins) throw new Error("adapter.removeGp: actor.inventory.removeCoins is missing (PF2e API changed?)");
  const removed = await actor.inventory.removeCoins({ gp });
  if (removed === false) throw new Error(`adapter.removeGp: could not remove ${gp} gp from ${actor.name}`);
}

// Skills -------------------------------------------------------------------------
export const SKILL_SLUGS = [
  "acrobatics", "arcana", "athletics", "crafting", "deception", "diplomacy", "intimidation", "medicine",
  "nature", "occultism", "performance", "religion", "society", "stealth", "survival", "thievery"
];

/** A PF2e skill slug: a standard skill, or a lore like "herbalism-lore". */
export const isSkillSlug = slug => typeof slug === "string" && (SKILL_SLUGS.includes(slug) || /^[a-z][a-z0-9-]*-lore$/.test(slug));

/** The player-facing name of a skill (falls back to the slug). */
export function skillLabel(slug) {
  const label = CONFIG.PF2E?.skills?.[slug]?.label;
  return label ? game.i18n.localize(label) : slug;
}

/** An actor's total modifier for a skill. */
export function getSkillModifier(actor, slug) {
  const mod = actor?.skills?.[slug]?.mod;
  if (typeof mod !== "number") throw new Error(`adapter.getSkillModifier: ${actor?.name ?? "actor"} has no "${slug}" skill (PF2e API changed?)`);
  return mod;
}

/** The natural (kept) d20 from a PF2e check roll, or null if it cannot be read. */
export function readNaturalD20(roll) {
  const d20 = roll?.dice?.find?.(die => die.faces === 20);
  if (!d20) return null;
  const kept = d20.results?.find?.(r => r.active !== false);
  const natural = kept?.result ?? d20.total;
  return Number.isInteger(natural) ? natural : null;
}

/**
 * Roll a skill check against a DC through PF2e's own check, so modifiers,
 * dialogs and the chat card behave normally. Pass { createMessage: false } to ask PF2e not to
 * post its own chat card (research posts one summary instead).
 * Returns { degree, total, natural, modifier, dc }, where modifier = total - natural.
 */
export async function rollSkillCheck(actor, slug, dc, { createMessage } = {}) {
  const skill = actor.skills?.[slug];
  if (!skill?.check?.roll) throw new Error(`adapter.rollSkillCheck: ${actor.name} has no "${slug}" skill check (PF2e API changed?)`);
  const result = await skill.check.roll({ dc: { value: dc }, skipDialog: true, ...(createMessage === false ? { createMessage: false } : {}) });
  const degree = normalizeDegree(result?.options?.degreeOfSuccess ?? result?.degreeOfSuccess);
  if (!degree) throw new Error("adapter.rollSkillCheck: could not read the degree of success from PF2e's roll result");
  const natural = readNaturalD20(result);
  if (natural === null) throw new Error("adapter.rollSkillCheck: could not read the natural d20 from PF2e's roll result (result.dice has no d20)");
  return { degree, total: result.total, natural, modifier: result.total - natural, dc };
}

/**
 * Roll a character's Perception (no DC). Returns { total, natural }. The roll is made without a chat card:
 * a search must not announce its result to the table.
 */
export async function rollPerception(actor, { createMessage } = {}) {
  const statistic = actor.perception;
  const roll = statistic?.check?.roll ?? statistic?.roll;
  if (!roll) throw new Error(`adapter.rollPerception: ${actor?.name ?? "actor"} has no Perception check (PF2e API changed?)`);
  const result = await roll.call(statistic?.check?.roll ? statistic.check : statistic, { skipDialog: true, ...(createMessage === false ? { createMessage: false } : {}) });
  if (typeof result?.total !== "number") throw new Error("adapter.rollPerception: could not read the total from PF2e's roll result");
  return { total: result.total, natural: readNaturalD20(result) };
}

/** Roll the Crafting skill against a DC. Returns { degree, total, dc }. Pass { createMessage: false } to keep PF2e's own chat card off the table. */
export async function rollCraftCheck(actor, dc, options) {
  const { degree, total } = await rollSkillCheck(actor, "crafting", dc, options);
  return { degree, total, dc };
}

/**
 * Add `quantity` units of a material to an actor: tops up the existing stack
 * if there is one, otherwise creates a "treasure" item carrying the flags.
 */
export async function giveMaterial(actor, material, quantity) {
  const existing = getMaterialStacks(actor).find(s => s.materialId === material.id);
  if (existing) {
    await existing.item.update({ "system.quantity": existing.quantity + quantity });
    return existing.item;
  }
  const [created] = await actor.createEmbeddedDocuments("Item", [{
    name: material.name,
    type: "treasure",
    system: { quantity },
    flags: { [MODULE_ID]: { material: { materialId: material.id, tier: material.tier } } }
  }]);
  return created;
}


// Resource Node actor -----------------------------------------------------------------------------------
// The one neutral PF2e "loot" actor every node token is made from. PF2e's actor type name stays in this file.

/**
 * Actor data for the shared node actor: nobody but the GM can open it, and its token is
 * unlinked, neutral, name-on-hover, 1x1, with no vision or bars.
 */
export function nodeActorData({ name, img, flagScope, flagKey }) {
  const display = globalThis.CONST?.TOKEN_DISPLAY_MODES?.HOVER ?? 30;
  const neutral = globalThis.CONST?.TOKEN_DISPOSITIONS?.NEUTRAL ?? 0;
  const none = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.NONE ?? 0;
  return {
    name, img, type: "loot",
    ownership: { default: none },
    flags: { [flagScope]: { [flagKey]: true } },
    prototypeToken: {
      name, actorLink: false, disposition: neutral, displayName: display, displayBars: 0,
      width: 1, height: 1, lockRotation: true, sight: { enabled: false }, texture: { src: img }
    }
  };
}

export const isNodeActor = (actor, flagScope, flagKey) => actor?.type === "loot" && actor.getFlag?.(flagScope, flagKey) === true;

export const findNodeActor = (actors, flagScope, flagKey) => [...actors].find(actor => isNodeActor(actor, flagScope, flagKey)) ?? null;

export const createNodeActor = data => Actor.create(data);

/**
 * The update that fixes a created node actor whose safe defaults did not stick (Foundry/PF2e
 * rewrite some defaults when an actor is created), or null if it is already right.
 * Returns { update, problems } where problems describes what was wrong.
 */
export function nodeActorRepair(actor) {
  const none = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.NONE ?? 0;
  const update = {};
  const problems = [];
  if (actor.ownership?.default !== none) {
    update["ownership.default"] = none;
    problems.push(`default ownership was ${actor.ownership?.default}`);
  }
  if (actor.prototypeToken?.actorLink !== false) {
    update["prototypeToken.actorLink"] = false;
    problems.push(`prototype token actorLink was ${actor.prototypeToken?.actorLink}`);
  }
  return problems.length ? { update, problems } : null;
}

// Coins in whole copper pieces (commissions move gold between actors) --------------------------------------
/** Split copper into PF2e coin parts. */
export const coinsFromCopper = copper => ({ gp: Math.floor(copper / 100), sp: Math.floor((copper % 100) / 10), cp: copper % 10 });

/** An actor's total coins, in copper pieces. */
export function getCopper(actor) {
  const coins = actor.inventory?.coins;
  if (typeof coins?.copperValue === "number") return coins.copperValue;
  if (typeof coins?.goldValue === "number") return Math.round(coins.goldValue * 100);
  throw new Error(`adapter.getCopper: cannot read ${actor?.name ?? "actor"}'s coins (PF2e API changed?)`);
}

export async function addCopper(actor, copper) {
  if (!actor.inventory?.addCoins) throw new Error("adapter.addCopper: actor.inventory.addCoins is missing (PF2e API changed?)");
  await actor.inventory.addCoins(coinsFromCopper(copper));
}

export async function removeCopper(actor, copper) {
  if (!actor.inventory?.removeCoins) throw new Error("adapter.removeCopper: actor.inventory.removeCoins is missing (PF2e API changed?)");
  const removed = await actor.inventory.removeCoins(coinsFromCopper(copper), { byValue: true });
  if (removed === false) throw new Error(`adapter.removeCopper: could not remove ${copper / 100} gp from ${actor.name}`);
}
