/**
 * Workshop rules. Pure; no Foundry globals.
 *
 * UPGRADES (research projects on a station): "tier" raises the station's tier (up to a cap), "craftDays" cuts craft days
 * by one per level, "hearth" adds a hearth. A hearth is a stored counter with NO EFFECT YET; Stage 12 decides what it
 * does. The materials an upgrade needs are of the TARGET tier (the tier it reaches, or the level it reaches), in
 * placeholder amounts, and there is no gold cost. BUILDING a workshop spends real materials, gold and days.
 */
import { RESEARCH, STATIONS, WORKSHOP } from "../config.js";
import { levelDC } from "../adapter/pf2e.js";

export const UPGRADE_KINDS = ["tier", "craftDays", "hearth"];

const KIND_TEXT = {
  tier: to => `tier ${to}`,
  craftDays: to => `craft days cut by ${to}`,
  hearth: to => `hearth ${to} (${WORKSHOP.hearthNote})`
};
export const upgradeLabel = (kind, to) => KIND_TEXT[kind]?.(to) ?? `${kind} ${to}`;

/** The station's current level for each upgrade kind. */
export const levelsOf = station => ({ tier: station.tier, craftDays: station.upgrades?.craftDays ?? 0, hearth: station.upgrades?.hearths ?? 0 });

/** The highest tier this station can reach: a carried kit is capped lower than a town workshop. */
export const tierCap = (station, config = { ...WORKSHOP, portableTierCap: STATIONS.portableTierCap }) => (station.location.type === "carried" ? config.portableTierCap : config.townTierCap);

/**
 * Can this upgrade be started, and what does it need?
 * @returns {{ ok: true, kind, from, to, targetTier, units } | { ok: false, error: string }}
 */
export function planUpgrade(station, kind, config = WORKSHOP) {
  if (!UPGRADE_KINDS.includes(kind)) return { ok: false, error: `unknown upgrade "${kind}" (choose one of ${UPGRADE_KINDS.join(", ")})` };
  const from = levelsOf(station)[kind];
  const to = from + 1;
  if (kind === "tier") {
    const cap = tierCap(station, { ...config, portableTierCap: STATIONS.portableTierCap });
    if (to > cap) return { ok: false, error: `${station.name} is already at tier ${from}, the highest ${station.location.type === "carried" ? "a carried kit" : "a workshop"} can reach (${cap})` };
  } else {
    const max = config.maxLevel[kind];
    if (to > max) return { ok: false, error: `${station.name} already has the most ${kind === "craftDays" ? "craft-day cuts" : "hearths"} it can have (${max})` };
  }
  const targetTier = Math.min(to, Math.max(...Object.keys(config.upgradeUnits).map(Number)));
  return { ok: true, kind, from, to, targetTier, units: config.upgradeUnits[targetTier] };
}

/**
 * Check a player's chosen materials against what the upgrade needs: each material must be of the target tier, the units
 * must add up exactly, and the character must have them. Returns every problem together.
 * @param {Object<string, number>} selection  materialId -> units
 * @param {Array<{ materialId: string, quantity: number }>} stacks  the character's material stacks
 * @param {Map<string, object>} materialDefs
 */
export function checkUpgradeMaterials({ selection, targetTier, units, stacks, materialDefs }) {
  const errors = [];
  const chosen = Object.entries(selection ?? {}).filter(([, n]) => n !== 0);
  let total = 0;
  for (const [materialId, qty] of chosen) {
    const def = materialDefs.get(materialId);
    if (!def) { errors.push(`unknown material "${materialId}"`); continue; }
    if (!Number.isInteger(qty) || qty < 1) { errors.push(`${def.name}: give a whole number of units (got ${qty})`); continue; }
    if (def.tier !== targetTier) { errors.push(`${def.name} is tier ${def.tier}, but this upgrade needs materials of tier ${targetTier}`); continue; }
    total += qty;
    const have = stacks.filter(s => s.materialId === materialId).reduce((n, s) => n + s.quantity, 0);
    if (have < qty) errors.push(`needs ${qty} ${def.name} but only ${have} available`);
  }
  if (!errors.length && total !== units) errors.push(`this upgrade needs ${units} unit(s) of tier-${targetTier} materials (you chose ${total})`);
  return { ok: errors.length === 0, errors, materials: errors.length ? [] : chosen.map(([materialId, qty]) => ({ materialId, qty })) };
}

/** Take `selection` out of the stacks in order. Returns { byStack } for the escrow take. */
export function allocateFromStacks(materials, stacks) {
  const remaining = new Map(stacks.map(s => [s.stackId, s.quantity]));
  const byStack = {};
  for (const { materialId, qty } of materials) {
    let need = qty;
    for (const stack of stacks.filter(s => s.materialId === materialId)) {
      if (!need) break;
      const take = Math.min(need, remaining.get(stack.stackId));
      if (take > 0) { byStack[stack.stackId] = (byStack[stack.stackId] ?? 0) + take; remaining.set(stack.stackId, remaining.get(stack.stackId) - take); need -= take; }
    }
  }
  return byStack;
}

const researchTier = tier => Math.min(Math.max(tier, 1), Math.max(...Object.keys(RESEARCH.tiers).map(Number)));

/** The research project for an upgrade: DC and threshold scale with the target tier. */
export function buildUpgradeProject({ station, plan, materials, config = WORKSHOP, research = RESEARCH }) {
  const tier = researchTier(plan.targetTier);
  const tierConfig = research.tiers[tier];
  return {
    id: `upgrade-${station.id}-${plan.kind}-${plan.to}`,
    goalName: `${station.name}: ${upgradeLabel(plan.kind, plan.to)}`,
    outcome: { type: "upgradeStation", stationId: station.id, kind: plan.kind, from: plan.from, to: plan.to },
    tier,
    dc: levelDC(config.levelByTier[tier]) + tierConfig.dcOffset,
    threshold: tierConfig.threshold,
    progress: 0,
    skillWhitelist: [...config.researchSkills],
    materials: materials.map(m => ({ ...m })),
    status: "active",
    log: []
  };
}

/** The research project that designs a blueprint. */
export function buildDesignProject({ blueprint, config = WORKSHOP, research = RESEARCH }) {
  const tier = researchTier(blueprint.researchProject.tier);
  const tierConfig = research.tiers[tier];
  return {
    id: `design-${blueprint.id}`,
    goalName: `Design: ${blueprint.name}`,
    outcome: { type: "designBlueprint", blueprintId: blueprint.id },
    tier,
    dc: levelDC(config.levelByTier[Math.min(blueprint.tier, Math.max(...Object.keys(config.levelByTier).map(Number)))]) + tierConfig.dcOffset,
    threshold: tierConfig.threshold,
    progress: 0,
    skillWhitelist: [...config.researchSkills],
    status: "active",
    log: []
  };
}

/** The change a finished upgrade makes to a station's stored state. tier: { tier }, others: { upgrades } (merged by the caller). */
export function upgradePatch(kind, to) {
  if (kind === "tier") return { tier: to };
  return { upgrades: kind === "craftDays" ? { craftDays: to } : { hearths: to } };
}

/** Craft-day reductions a station's upgrades give (for craftDays(); the 1-day floor is applied there, after ALL of them). */
export function stationReductions(station) {
  const days = station?.upgrades?.craftDays ?? 0;
  return days > 0 ? [{ days, source: "workshop upgrades" }] : [];
}

// Building a workshop ---------------------------------------------------------------------------------------------
/**
 * Match materials to a blueprint's slots (any material of at least the slot's tier floor; one material type per slot),
 * the same way a craft does. Returns the plan's `uses` in the shape the escrow code reads.
 * @returns {{ ok: true, uses: object[] } | { ok: false, errors: string[] }}
 */
export function planBuild({ blueprint, selection, stacks, materialDefs }) {
  const errors = [];
  const remaining = new Map(stacks.map(s => [s.stackId, s.quantity]));
  const uses = [];
  for (const unknown of Object.keys(selection ?? {})) if (!blueprint.slots.some(s => s.name === unknown)) errors.push(`"${unknown}" is not a slot of this blueprint`);
  for (const slot of blueprint.slots) {
    const materialId = selection?.[slot.name];
    if (!materialId) { errors.push(`slot "${slot.name}": no material selected`); continue; }
    const material = materialDefs.get(materialId);
    if (!material) { errors.push(`slot "${slot.name}": unknown material "${materialId}"`); continue; }
    if (material.tier < slot.tierFloor) { errors.push(`slot "${slot.name}": ${material.name} is tier ${material.tier} but the slot needs tier ${slot.tierFloor} or higher`); continue; }
    const from = [];
    let need = slot.qty;
    for (const stack of stacks.filter(s => s.materialId === materialId)) {
      if (!need) break;
      const take = Math.min(need, remaining.get(stack.stackId));
      if (take > 0) { from.push({ stackId: stack.stackId, units: take }); remaining.set(stack.stackId, remaining.get(stack.stackId) - take); need -= take; }
    }
    if (need > 0) { errors.push(`slot "${slot.name}": needs ${slot.qty} ${material.name} but only ${slot.qty - need} available`); continue; }
    uses.push({ slot: slot.name, materialId, materialName: material.name, units: slot.qty, from });
  }
  return errors.length ? { ok: false, errors } : { ok: true, uses };
}
