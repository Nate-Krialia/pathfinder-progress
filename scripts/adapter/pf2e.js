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
  return warnings;
}
