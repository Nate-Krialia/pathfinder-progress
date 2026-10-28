/**
 * Commission rules. Pure; no Foundry globals.
 *
 * States: requested -> accepted -> inProgress -> delivered, or cancelled / declined.
 * "requested" means the commission exists and is waiting for the crafter's answer. A failed craft
 * keeps it open (inProgress); a successful craft delivers it.
 */
import { COMMISSIONS } from "../config.js";
import { check } from "../data/schema.js";
import { LIVE_SCHEMAS } from "../data/schemas.js";

export const OPEN_STATUSES = ["requested", "accepted", "inProgress"];
export const isOpen = commission => OPEN_STATUSES.includes(commission.status);

// Money ----------------------------------------------------------------------------------------------
/** Gold amounts are whole copper pieces (0.01 gp), so nothing is lost to floating point. */
export const isMoney = gp => typeof gp === "number" && Number.isFinite(gp) && gp >= 0 && Math.abs(gp * 100 - Math.round(gp * 100)) < 1e-6;
export const toCopper = gp => Math.round(gp * 100);
export const gpText = copper => `${Number((copper / 100).toFixed(2))} gp`;

// Who may do what -------------------------------------------------------------------------------------
const RULES = {
  accept: { from: ["requested"], by: ["crafter", "gm"], verb: "accepted" },
  decline: { from: ["requested"], by: ["crafter", "gm"], verb: "declined" },
  cancel: { from: OPEN_STATUSES, by: ["patron", "gm"], verb: "cancelled" },
  craft: { from: ["accepted", "inProgress"], by: ["crafter", "gm"], verb: "crafted" }
};
export const STEPS = ["request", ...Object.keys(RULES)];

/** The roles an actor (and a GM) hold on a commission: any of "patron", "crafter", "gm". */
export function rolesFor(commission, actorId, isGM) {
  const roles = [];
  if (commission.patron.type === "actor" && commission.patron.actorId === actorId) roles.push("patron");
  if (commission.crafter === actorId) roles.push("crafter");
  if (isGM) roles.push("gm");
  return roles;
}

/** May this actor take this step on the commission right now? */
export function checkStep(commission, step, actorId, isGM) {
  const rule = RULES[step];
  if (!rule) return { ok: false, errors: [`unknown commission step "${step}" (steps: ${STEPS.join(", ")})`] };
  if (!rule.from.includes(commission.status)) return { ok: false, errors: [`commission "${commission.id}" is ${commission.status}, so it cannot be ${rule.verb}`] };
  const roles = rolesFor(commission, actorId, isGM);
  if (!rule.by.some(role => roles.includes(role))) return { ok: false, errors: [`only the ${rule.by.filter(r => r !== "gm").join(" or ")} (or the GM) can ${step} this commission`] };
  return { ok: true };
}

// Building and checking a record -----------------------------------------------------------------------
/** Rules between fields that the shape check cannot see. */
export function consistencyErrors(c) {
  const errors = [];
  if (c.patron.type === "actor" && c.patron.actorId === c.crafter) errors.push("the patron and the crafter must be different characters");
  if (c.patron.type === "lightweight" && c.materialsFrom === "patron") errors.push('a patron without a character cannot supply materials (use materialsFrom "npc" or "crafter")');
  if (c.patron.type === "actor" && c.materialsFrom !== "patron") errors.push('a character patron supplies the materials (materialsFrom "patron")');
  if (c.materialsFrom !== "crafter" && !c.selection) errors.push(`materialsFrom "${c.materialsFrom}" needs a selection (which material goes in each slot)`);
  if (!isMoney(c.payout)) errors.push(`the payout must be a gold amount in whole copper pieces, like 12 or 2.5 (got ${c.payout})`);
  if (c.learnRoll && c.access !== "loan") errors.push("the learn roll only applies to a loan");
  if (c.source === "player" && c.teaches.type !== "none") errors.push("only GM-issued commissions can teach");
  return errors;
}

/** Shape plus consistency. */
export function validateCommission(c) {
  const shape = check(LIVE_SCHEMAS.commission, c).map(e => `${e.field} ${e.message}`);
  return shape.length ? shape : consistencyErrors(c);
}

/**
 * Build a new commission from a request.
 * @param {object} spec  { source, patron, crafter, recipeId, access?, selection?, stationId?, materialsFrom?, payout, teaches?, learnRoll? }
 * @param {{ id: string, now: number, slotNames?: string[] }} context  slotNames (when known) are used to check the selection
 * @returns {{ ok: true, commission: object } | { ok: false, errors: string[] }}
 */
export function buildCommission(spec, { id, now, slotNames }) {
  const errors = [];
  if (!["player", "gm"].includes(spec.source)) errors.push(`source must be "player" or "gm" (got ${JSON.stringify(spec.source)})`);
  const access = spec.access ?? "loan";
  const patronIsActor = spec.patron?.type === "actor";
  const materialsFrom = spec.materialsFrom ?? (patronIsActor ? "patron" : "crafter");
  const learnRoll = spec.learnRoll ?? (spec.source === "gm" && access === "loan");
  if (spec.source === "player" && !patronIsActor) errors.push("a player commission needs a character as the patron");

  const commission = {
    id, source: spec.source, status: "requested", patron: spec.patron, crafter: spec.crafter, formulaId: spec.recipeId, access,
    ...(spec.selection ? { selection: spec.selection } : {}), ...(spec.stationId ? { stationId: spec.stationId } : {}),
    materialsFrom, payout: spec.payout ?? 0, teaches: spec.teaches ?? { type: "none" }, learnRoll, learnAttempted: false,
    attempts: 0, createdAt: now, log: []
  };
  errors.push(...validateCommission(commission));

  if (spec.selection && slotNames) {
    for (const key of Object.keys(spec.selection)) if (!slotNames.includes(key)) errors.push(`"${key}" is not a slot of this recipe (slots: ${slotNames.join(", ")})`);
    for (const name of slotNames) if (!spec.selection[name]) errors.push(`slot "${name}" has no material in the selection`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, commission };
}

/** Things that will have no effect, for the GM to see (not errors). */
export function commissionWarnings(c, crafterAccess) {
  const warnings = [];
  if (crafterAccess === "owned") {
    warnings.push("the crafter already knows this formula, so the handoff does nothing");
    if (c.learnRoll) warnings.push("the learn roll will be skipped");
    if (c.teaches.type !== "none") warnings.push(`"teaches" (${c.teaches.type}) will have no effect`);
  }
  return warnings;
}

/** A suggested payout: the materials' value plus the station fee, plus a margin, rounded up to whole gold. */
export function suggestPayout({ recipe, selection, registry, feeGp = 0, config = COMMISSIONS }) {
  let value = 0;
  for (const slot of recipe.slots) {
    const material = registry.material.get(selection?.[slot.name]);
    if (!material) return { ok: false, error: `slot "${slot.name}": no known material selected` };
    value += slot.qty * (material.value ?? config.valueByTier[material.tier] ?? 0);
  }
  return { ok: true, payout: Math.ceil((value + feeGp) * (1 + config.payoutMargin)), materialValue: value, fee: feeGp, margin: config.payoutMargin };
}
