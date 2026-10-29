/**
 * The per-character Compendium. Pure; no Foundry globals.
 *
 * A book is { v: 1, materials: {id: entry}, creatures: {key: entry}, regions: {id: entry} }. An entry holds ONLY facts the
 * character has experienced: there are no placeholders, and nothing locked is stored. Every function here is ADDITIVE and
 * IDEMPOTENT: it returns a new book, adding what is new and changing nothing else, so recording the same fact twice, or
 * two different facts in either order (a bare "it landed in the inventory" and a contextual "gathered here, at this rung"),
 * gives the same book.
 */
import { COMPENDIUM } from "../config.js";

export const emptyBook = () => ({ v: COMPENDIUM.version, materials: {}, creatures: {}, regions: {} });

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const own = (object, key) => Object.hasOwn(object, key);

/** Keys are used as object keys: never let a name become a prototype key. */
function safeKey(key) {
  if (typeof key !== "string" || !key.trim() || FORBIDDEN.has(key)) throw new RangeError(`compendium: "${key}" cannot be used as an entry key`);
  return key;
}

/** The stable key of a creature entry: its name, lowercased. */
export const creatureKey = name => safeKey(String(name ?? "").trim().toLowerCase());

const addTo = (list, item, same) => (list.some(existing => same(existing, item)) ? list : [...list, item]);
/** Like addTo, but an item first recorded WITHOUT its proper name (its name is its id) takes the proper name when it is known. */
const addNamed = (list, item, same, idOf) => {
  const index = list.findIndex(existing => same(existing, item));
  if (index < 0) return [...list, item];
  if (list[index].name === idOf(list[index]) && item.name !== idOf(item)) return list.map((existing, i) => (i === index ? { ...existing, name: item.name } : existing));
  return list;
};
const clone = value => structuredClone(value);

// Materials ----------------------------------------------------------------------------------------------------
/**
 * The material landed in the character's inventory. With `place` ({ key, label }) and/or `rung` ({ nodeType, tier, rung }),
 * also the place it was found and the ladder rung reached. Without them, just the bare entry.
 */
export function recordMaterial(book, { materialId, name, tier, place, rung, at = Date.now() }) {
  safeKey(materialId);
  const next = clone(book);
  const entry = own(next.materials, materialId)
    ? next.materials[materialId]
    : { id: materialId, name: name ?? materialId, ...(tier === undefined ? {} : { tier }), firstAt: at, places: [], rungs: [] };
  if (name && entry.name === entry.id) entry.name = name;           // a bare entry made before the name was known
  if (tier !== undefined && entry.tier === undefined) entry.tier = tier;
  if (place) entry.places = addTo(entry.places, { key: place.key, label: place.label }, (a, b) => a.key === b.key);
  if (rung) entry.rungs = addTo(entry.rungs, { nodeType: rung.nodeType, tier: rung.tier, rung: rung.rung }, (a, b) => a.nodeType === b.nodeType && a.tier === b.tier && a.rung === b.rung);
  next.materials[materialId] = entry;
  return next;
}

export const hasMaterial = (book, materialId) => own(book.materials, materialId);

// Creatures ----------------------------------------------------------------------------------------------------
/** The character was in a combat with this creature: a barebones entry (name and type), nothing about yields. */
export function recordCreature(book, { name, type, at = Date.now() }) {
  const key = creatureKey(name);
  if (own(book.creatures, key)) {
    // an entry made from a corpse before the creature's type was known takes the type when it is
    if (book.creatures[key].type === "creature" && type && type !== "creature") { const next = clone(book); next.creatures[key].type = String(type); return next; }
    return book;
  }
  const next = clone(book);
  next.creatures[key] = { key, name: String(name).trim(), type: String(type ?? "creature"), firstAt: at, yields: [] };
  return next;
}

/** The character took this material from one of the creature's corpses: now the yield is on the entry (and the entry exists). */
export function recordCreatureYield(book, { name, type, materialId, materialName, at = Date.now() }) {
  const key = creatureKey(name);
  const withEntry = recordCreature(book, { name, type, at });
  const next = clone(withEntry);
  next.creatures[key].yields = addNamed(next.creatures[key].yields, { materialId, name: materialName ?? materialId }, (a, b) => a.materialId === b.materialId, e => e.materialId);
  return next;
}

// Regions ------------------------------------------------------------------------------------------------------
/** The character explored the region. */
export function recordRegion(book, { regionId, name, at = Date.now() }) {
  safeKey(regionId);
  if (own(book.regions, regionId)) {
    // an entry made from a found node before the region's name was known takes the name when it is
    if (book.regions[regionId].name === regionId && name && name !== regionId) { const next = clone(book); next.regions[regionId].name = name; return next; }
    return book;
  }
  const next = clone(book);
  next.regions[regionId] = { id: regionId, name: name ?? regionId, firstAt: at, nodeTypes: [] };
  return next;
}

/** The character found a node of this type in the region (it also makes the region entry if it was missing). */
export function recordRegionNodeType(book, { regionId, regionName, nodeType, nodeTypeName, at = Date.now() }) {
  const withEntry = recordRegion(book, { regionId: safeKey(regionId), name: regionName, at });
  const next = clone(withEntry);
  next.regions[regionId].nodeTypes = addNamed(next.regions[regionId].nodeTypes, { id: nodeType, name: nodeTypeName ?? nodeType }, (a, b) => a.id === b.id, e => e.id);
  return next;
}

// Reading -------------------------------------------------------------------------------------------------------
/**
 * Which formulae could use this material? Worked out from the formula snapshots the character holds: a slot takes a
 * material of at least its tier floor that has an effect for every role the slot drives. (Derived when viewing; never stored.)
 */
export function usedIn(material, formulas) {
  if (!material) return [];
  return formulas
    .filter(f => (f?.snapshot?.slots ?? []).some(slot => {
      const roles = Array.isArray(slot.drives) ? slot.drives : [slot.drives];
      return (material.tier ?? 0) >= slot.tierFloor && roles.every(role => role in (material.effects ?? {}));
    }))
    .map(f => ({ recipeId: f.recipeId, name: f.snapshot?.name ?? f.recipeId }));
}

const sorted = (object, field) => Object.values(object).sort((a, b) => a.firstAt - b.firstAt || String(a[field]).localeCompare(String(b[field])));

/**
 * The entries of one book, structured for a UI: lists by category, oldest first. A creature shows only the yields that
 * were recorded (the others stay locked, and nothing shows for them, not even a count).
 * @param {object} book
 * @param {{ materialDefs?: Map<string, object>, formulas?: object[], shared?: boolean }} [options]
 */
export function describeBook(book, { materialDefs = new Map(), formulas = [], shared = false } = {}) {
  return {
    materials: sorted(book.materials, "name").map(e => ({ ...clone(e), shared, usedIn: usedIn(materialDefs.get(e.id), formulas) })),
    creatures: sorted(book.creatures, "name").map(e => ({ ...clone(e), shared })),
    regions: sorted(book.regions, "name").map(e => ({ ...clone(e), shared }))
  };
}

/** How much a book holds (for the GM's per-character progress). */
export const countBook = book => ({ materials: Object.keys(book.materials).length, creatures: Object.keys(book.creatures).length, regions: Object.keys(book.regions).length });

// Sharing -------------------------------------------------------------------------------------------------------
/** The facts of one entry, for a share request. Returns null when the character has no such entry. */
export function pickEntry(book, kind, key) {
  const category = { material: "materials", creature: "creatures", region: "regions" }[kind];
  if (!category || typeof key !== "string" || !own(book[category], key)) return null;
  return clone(book[category][key]);
}

/**
 * Merge shared facts into a book (the world-level shared Compendium). Additive and idempotent: the union of places,
 * rungs, yields and node types; the earliest first-seen time.
 */
export function mergeShared(book, kind, entry) {
  const category = { material: "materials", creature: "creatures", region: "regions" }[kind];
  if (!category) throw new RangeError(`compendium: unknown entry kind "${kind}"`);
  const key = kind === "material" ? entry.id : kind === "creature" ? entry.key : entry.id;
  safeKey(key);
  const next = clone(book);
  const have = own(next[category], key) ? next[category][key] : null;
  const merged = have ?? { ...clone(entry), ...(kind === "material" ? { places: [], rungs: [] } : kind === "creature" ? { yields: [] } : { nodeTypes: [] }) };
  merged.firstAt = Math.min(merged.firstAt, entry.firstAt);
  if (kind === "material") {
    for (const p of entry.places) merged.places = addTo(merged.places, p, (a, b) => a.key === b.key);
    for (const r of entry.rungs) merged.rungs = addTo(merged.rungs, r, (a, b) => a.nodeType === b.nodeType && a.tier === b.tier && a.rung === b.rung);
  } else if (kind === "creature") {
    for (const y of entry.yields) merged.yields = addTo(merged.yields, y, (a, b) => a.materialId === b.materialId);
  } else {
    for (const n of entry.nodeTypes) merged.nodeTypes = addTo(merged.nodeTypes, n, (a, b) => a.id === b.id);
  }
  next[category][key] = merged;
  return next;
}
