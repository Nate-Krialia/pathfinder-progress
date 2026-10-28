/**
 * Foundry-bound commissions: the GM tools, the queue steps, and the craft-time escrow.
 *
 * Players never write the commission list. A patron's request and a crafter's accept, decline,
 * cancel or craft are queue actions (type "commission", no days); the GM resolves them at review and
 * THIS file writes the list. The rules live in commission.js, escrow.js, loans.js and changes.js.
 *
 * Nothing is held in escrow before crafting. A craft checks everything first, rolls everything,
 * and only then writes, with an undo for every write, so a failure leaves the world as it was.
 */
import { COMMISSIONS, CRAFTING, MODULE_ID, RESEARCH_KEYS as K } from "../config.js";
import * as adapter from "../adapter/pf2e.js";
import { commit } from "../audit/store.js";
import { prepareCraft } from "../crafting/prepare.js";
import { resolveOutcome } from "../crafting/outcome.js";
import { formatSummary } from "../crafting/summary.js";
import { pickSkill } from "../gathering/resolve.js";
import { applyProgress, buildProject, deltaFor } from "../research/project.js";
import { addFormula, findFormula } from "../research/formulas.js";
import { rawList, readFormulaList } from "../research/store.js";
import { feeForTier } from "../stations/fees.js";
import { actorNameOf, readStations, townOfActor } from "../stations/store.js";
import { esc } from "../queue/review.js";
import { buildCommission, checkStep, commissionWarnings, gpText, isOpen, suggestPayout, toCopper } from "./commission.js";
import { ledgerChanges } from "./changes.js";
import { affordabilityErrors, buildSteps } from "./escrow.js";
import { addLoan, dropLoan } from "./loans.js";
import { readCommissions, writeCommissions } from "./list.js";

/** A request that can never succeed as stated (wrong status, missing record). The queue removes these. */
export class CommissionRefused extends Error {}
const refuse = message => { throw new CommissionRefused(message); };

const requireGM = what => { if (!game.user.isGM) throw new Error(`${what}: GM only`); };
const flagKey = key => `flags.${MODULE_ID}.${key}`;
const d100 = () => Math.floor(CONFIG.Dice.randomUniform() * 100) + 1;
const nameOf = id => actorNameOf(id);
const patronName = c => (c.patron.type === "actor" ? nameOf(c.patron.actorId) : c.patron.name);

/** An actor from a document, an id or a name. */
export function actorOf(ref) {
  const actor = typeof ref === "string" ? (game.actors.get(ref) ?? game.actors.getName(ref)) : ref;
  if (!actor?.id) throw new Error(`no character found for "${ref?.name ?? ref}"`);
  return actor;
}

// Reading ---------------------------------------------------------------------------------------------------
export { readCommissions };

export function getCommission(id) {
  const found = readCommissions().find(c => c.id === id);
  if (!found) throw new Error(`no commission "${id}" (known: ${readCommissions().map(c => c.id).join(", ") || "none"})`);
  return found;
}

/** The GM sees every commission; a player sees those whose patron or crafter they own. */
export function listCommissions({ status, open } = {}) {
  return readCommissions().filter(c => {
    if (status && c.status !== status) return false;
    if (open !== undefined && isOpen(c) !== open) return false;
    if (game.user.isGM) return true;
    return [c.crafter, c.patron.type === "actor" ? c.patron.actorId : null].some(id => id && game.actors.get(id)?.isOwner);
  });
}

const stacksFor = actor => adapter.getMaterialStacks(actor).map(s => ({ stackId: s.item.id, materialId: s.materialId, quantity: s.quantity }));

// Writing a record, with a way back -------------------------------------------------------------------------
function logEntry(c, entry, now = Date.now()) {
  return [...c.log, { at: now, ...entry }].slice(-COMMISSIONS.logMax);
}

/** Write the list with `next` in it, run `after`, and put the list back if `after` fails. */
async function withRecord(next, after) {
  const before = readCommissions();
  const exists = before.some(c => c.id === next.id);
  await writeCommissions(exists ? before.map(c => (c.id === next.id ? next : c)) : [...before, next]);
  try {
    await after();
  } catch (error) {
    try {
      await writeCommissions(before);
    } catch (restoreError) {
      console.error(`${MODULE_ID} | a commission step failed AND the commission list could not be restored`, restoreError);
    }
    throw error;
  }
}

/** Update an actor's formula and project lists (plus any extra flat update) through the audit commit. */
async function commitCrafter(actor, { formulas, projects, extra = {}, note }) {
  const formulasBefore = rawList(actor, K.formulasFlag);
  const projectsBefore = rawList(actor, K.projectsFlag);
  const update = { ...extra };
  if (formulas) update[flagKey(K.formulasFlag)] = formulas;
  if (projects) update[flagKey(K.projectsFlag)] = projects;
  const changes = ledgerChanges({
    formulasBefore, formulasAfter: formulas ?? formulasBefore, projectsBefore, projectsAfter: projects ?? projectsBefore, note
  });
  await commit(actor, update, changes);
}

const recipeOf = (api, id) => {
  const recipe = api.definitions?.recipe.get(id);
  if (!recipe) throw new CommissionRefused(`the recipe "${id}" no longer exists`);
  return recipe;
};

// Creating --------------------------------------------------------------------------------------------------
function ownedFormula(actor, recipeId) {
  const entry = findFormula(readFormulaList(actor), recipeId);
  return entry?.access === "owned";
}

/**
 * GM issues a commission directly (usually for an NPC patron). spec:
 * { patron: "Old Brannock" | Actor, crafter, recipe, access?, selection?, materialsFrom?, payout?, teaches?, learnRoll?, stationId? }
 * Without a payout, the suggested one is used (needs a selection).
 */
export async function issue(api, spec) {
  requireGM("issue");
  const crafter = actorOf(spec.crafter);
  const recipe = recipeOf(api, spec.recipe);
  const patron = typeof spec.patron === "string" ? { type: "lightweight", name: spec.patron } : { type: "actor", actorId: actorOf(spec.patron).id };
  let payout = spec.payout;
  let suggestion = null;
  if (payout === undefined) {
    if (!spec.selection) throw new Error("issue: give a payout, or a selection so a payout can be suggested");
    suggestion = suggestPayout({ recipe, selection: spec.selection, registry: api.definitions, feeGp: feeForTier(recipe.stationTierMin) });
    if (!suggestion.ok) throw new Error(`issue: ${suggestion.error}`);
    payout = suggestion.payout;
  }
  const built = buildCommission({ ...spec, source: "gm", patron, crafter: crafter.id, recipeId: recipe.id, payout }, {
    id: `c-${foundry.utils.randomID()}`, now: Date.now(), slotNames: recipe.slots.map(s => s.name)
  });
  if (!built.ok) throw new Error(`issue: ${built.errors.join("; ")}`);
  const access = findFormula(readFormulaList(crafter), recipe.id)?.access ?? null;
  const commission = { ...built.commission, log: [{ at: Date.now(), text: "issued by the GM" }] };
  await writeCommissions([...readCommissions(), commission]);
  return { commission, warnings: commissionWarnings(commission, access), suggestion };
}

/** Resolve a player's queued request into a commission (GM, at review). Idempotent by action id. */
export async function createFromRequest(api, patronActor, action) {
  requireGM("request");
  const id = `c-${action.id}`;
  const existing = readCommissions().find(c => c.id === id);
  if (existing) return existing;
  const p = action.params;
  const crafter = game.actors.get(p.crafter);
  if (!crafter) refuse(`the crafter (${p.crafter}) no longer exists`);
  const recipe = recipeOf(api, p.recipe);
  if (!ownedFormula(patronActor, recipe.id)) refuse(`${patronActor.name} does not hold the formula for "${recipe.name}" (only an owner can offer it)`);
  const built = buildCommission({
    source: "player", patron: { type: "actor", actorId: patronActor.id }, crafter: crafter.id, recipeId: recipe.id, access: p.access,
    selection: p.selection, stationId: p.stationId, payout: p.payout, learnRoll: p.learnRoll
  }, { id, now: Date.now(), slotNames: recipe.slots.map(s => s.name) });
  if (!built.ok) refuse(built.errors.join("; "));
  const commission = { ...built.commission, log: [{ at: Date.now(), text: `requested by ${patronActor.name}` }] };
  await writeCommissions([...readCommissions(), commission]);
  return commission;
}

// Accept, decline, cancel ------------------------------------------------------------------------------------
function openOrRefuse(id, step, actorId, isGM) {
  const c = readCommissions().find(x => x.id === id);
  if (!c) refuse(`commission "${id}" does not exist`);
  const ok = checkStep(c, step, actorId, isGM);
  if (!ok.ok) refuse(ok.errors.join("; "));
  return c;
}

/**
 * The crafter accepts. A copy is learned for good now; a loan appears on the crafter for this commission.
 * options.as = "loan" turns a copy offer into a loan. options.extraUpdate is merged into the crafter's update.
 */
export async function acceptStep(api, id, { as, actorId, extraUpdate = {} } = {}) {
  requireGM("accept");
  const c = openOrRefuse(id, "accept", actorId ?? readCommissions().find(x => x.id === id)?.crafter, true);
  if (as !== undefined && as !== "loan") throw new Error('accept: "as" can only be "loan"');
  if (as === "loan" && c.access !== "copy") throw new Error("accept: only a copy offer can be taken as a loan instead");
  const crafter = actorOf(c.crafter);
  const recipe = recipeOf(api, c.formulaId);
  if (c.patron.type === "actor") {
    const patron = game.actors.get(c.patron.actorId);
    if (!patron || !ownedFormula(patron, recipe.id)) refuse(`${patronName(c)} no longer holds the formula for "${recipe.name}"`);
  }
  const access = as === "loan" ? "loan" : c.access;
  const before = rawList(crafter, K.formulasFlag);
  let formulas;
  if (access === "copy") {
    const added = addFormula(before, recipe, { access: "owned", source: "commission" });
    if (!added.ok) throw new Error(added.error);
    formulas = added.list;
  } else {
    formulas = addLoan(before, recipe, c.id).list;
  }
  const next = {
    ...c, status: "accepted", access, learnRoll: access === "loan" ? c.learnRoll : false,
    log: logEntry(c, { text: as === "loan" ? "accepted as a loan instead of a copy" : `accepted (${access})` })
  };
  await withRecord(next, () => commitCrafter(crafter, { formulas, extra: extraUpdate, note: `commission ${c.id}` }));
  return next;
}

export async function declineStep(id, { actorId } = {}) {
  requireGM("decline");
  const c = openOrRefuse(id, "decline", actorId ?? readCommissions().find(x => x.id === id)?.crafter, true);
  const next = { ...c, status: "declined", log: logEntry(c, { text: "declined" }) };
  await withRecord(next, async () => {});
  return next;
}

/** Cancel before delivery. Nothing was held, so nothing is refunded; a loan disappears, a copy stays. */
export async function cancelStep(id, { actorId, reason } = {}) {
  requireGM("cancel");
  const c = openOrRefuse(id, "cancel", actorId ?? "", true);
  const next = { ...c, status: "cancelled", log: logEntry(c, { text: `cancelled${reason ? `: ${reason}` : ""}` }) };
  const crafter = game.actors.get(c.crafter);
  await withRecord(next, async () => {
    if (!crafter) return;
    const dropped = dropLoan(rawList(crafter, K.formulasFlag), c.id);
    if (dropped.dropped) await commitCrafter(crafter, { formulas: dropped.list, note: `commission ${c.id} cancelled` });
  });
  return next;
}

// Crafting --------------------------------------------------------------------------------------------------
/**
 * Everything that must be true before a commission craft, without rolling or writing anything.
 * Returns { ok, errors, ctx } where ctx has what the craft needs.
 */
export function prepareCommissionCraft(api, id, options = {}) {
  const c = readCommissions().find(x => x.id === id);
  if (!c) return { ok: false, errors: [`no commission "${id}"`] };
  const errors = [];
  if (!["accepted", "inProgress"].includes(c.status)) errors.push(`commission "${id}" is ${c.status}; only an accepted or in-progress commission can be crafted`);
  const crafter = game.actors.get(c.crafter);
  if (!crafter) errors.push(`the crafter (${c.crafter}) no longer exists`);
  const patronActor = c.patron.type === "actor" ? game.actors.get(c.patron.actorId) : null;
  if (c.patron.type === "actor" && !patronActor) errors.push(`the patron (${c.patron.actorId}) no longer exists`);
  const recipe = api.definitions?.recipe.get(c.formulaId);
  if (!recipe) errors.push(`the recipe "${c.formulaId}" no longer exists`);
  else if (api.uncraftable?.has(recipe.id)) errors.push(`recipe "${recipe.id}" is uncraftable: its output item could not be resolved`);
  if (errors.length) return { ok: false, errors };

  const selection = c.selection ?? options.selection;
  if (!selection) return { ok: false, errors: ["the crafter supplies the materials: pick them with selection ({ slot: materialId })"] };
  if (patronActor && !ownedFormula(patronActor, recipe.id)) errors.push(`${patronActor.name} no longer holds the formula for "${recipe.name}"`);

  // Who supplies the materials.
  let supplierKind = c.materialsFrom;
  let supplierActor = null;
  let stacks;
  if (supplierKind === "npc") {
    stacks = recipe.slots.map(slot => ({ stackId: `npc:${slot.name}`, materialId: selection[slot.name], quantity: slot.qty }));
  } else {
    supplierActor = supplierKind === "patron" ? patronActor : crafter;
    stacks = stacksFor(supplierActor);
  }
  const { stations } = readStations(api);
  const prep = prepareCraft({
    recipe, registry: api.definitions, selection, stacks, outputs: api.resolvedOutputs?.get(recipe.id), stations,
    crafterId: crafter.id, townOf: townOfActor, townName: tid => api.definitions.town.get(tid)?.name ?? tid, nameOf,
    requestedStationId: c.stationId ?? options.station, formulas: readFormulaList(crafter), crafterName: crafter.name, commissionId: c.id
  });
  if (!prep.ok) {
    const source = supplierActor ? `${supplierActor.name}'s materials` : "the NPC's materials";
    errors.push(...prep.errors.map(e => `${e} (checked against ${source})`));
  }

  // Gold. An NPC patron's fee is waived; a character patron pays the fee and must cover the payout too.
  if (prep.ok && patronActor) {
    errors.push(...affordabilityErrors({
      patronCopper: adapter.getCopper(patronActor), feeCopper: toCopper(prep.plan.fee), payoutCopper: toCopper(c.payout), patronName: patronActor.name
    }));
  }

  // The learn roll: one attempt, only on a loan the crafter does not already own.
  const crafterEntry = findFormula(readFormulaList(crafter), recipe.id);
  const learn = { eligible: Boolean(c.learnRoll && !c.learnAttempted && c.access === "loan" && crafterEntry && crafterEntry.access !== "owned"), skill: null };
  if (learn.eligible) {
    const picked = pickSkill(recipe.skillWhitelist, options.learnSkill, `"${recipe.name}"`, "learn roll");
    if (picked.ok) learn.skill = picked.skill;
    else errors.push(`learn roll: ${picked.error}`);
  }

  return {
    ok: errors.length === 0, errors,
    ctx: errors.length ? null : { c, crafter, patronActor, recipe, selection, supplierKind, supplierActor, plan: prep.plan, learn }
  };
}

// Applying steps, with an undo for each --------------------------------------------------------------------------
async function rollBack(undos) {
  const failures = [];
  for (const undo of [...undos].reverse()) {
    try { await undo.run(); } catch (error) { failures.push(`${undo.what} (${error.message})`); }
  }
  if (failures.length) throw new Error(`could not undo: ${failures.join("; ")}. Check these by hand.`);
}

async function applySteps(steps, actors) {
  const undos = [];
  try {
    for (const step of steps) {
      const actor = actors.get(step.actorId);
      if (step.op === "consume") {
        // One stack at a time, each with its own undo, so a failure part-way through is fully reversible.
        for (const [stackId, units] of Object.entries(step.byStack)) {
          const item = actor.items.get(stackId);
          const snapshot = { quantity: item.system?.quantity ?? 1, data: item.toObject() };
          await adapter.consumeMaterialStacks(actor, { [stackId]: units });
          undos.push({
            what: `materials on ${actor.name}`,
            run: async () => {
              const existing = actor.items.get(stackId);
              if (existing) await existing.update({ "system.quantity": snapshot.quantity });
              else await adapter.createItemOnActor(actor, snapshot.data);
            }
          });
        }
      } else if (step.op === "gold") {
        const apply = step.copper < 0 ? () => adapter.removeCopper(actor, -step.copper) : () => adapter.addCopper(actor, step.copper);
        const reverse = step.copper < 0 ? () => adapter.addCopper(actor, -step.copper) : () => adapter.removeCopper(actor, step.copper);
        await apply();
        undos.push({ what: `${step.copper / 100} gp on ${actor.name}`, run: reverse });
      } else if (step.op === "item") {
        const created = await adapter.createItemOnActor(actor, step.data);
        undos.push({ what: `the item on ${actor.name}`, run: () => created.delete() });
      }
    }
  } catch (error) {
    await rollBack(undos).catch(rollbackError => { throw new Error(`${error.message}. ${rollbackError.message}`); });
    throw error;
  }
  return undos;
}

const inFlight = new Set();

/**
 * Craft for a commission (GM client). Order: check everything, roll everything, then write with an
 * undo for each write; the crafter's own update (formulas, project, queue) is last, because it is
 * already all-or-nothing. A failed craft keeps the commission open; a success delivers and pays.
 * @param {object} options { selection?, station?, degree?, learnSkill?, learnDegree?, chat?, extraUpdate? }
 */
export async function craftForCommission(api, id, options = {}) {
  requireGM("craft");
  if (inFlight.has(id)) throw new Error(`craft: commission "${id}" is already being crafted`);
  inFlight.add(id);
  try {
    return await craftLocked(api, id, options);
  } finally {
    inFlight.delete(id);
  }
}

async function craftLocked(api, id, options) {
  const ready = prepareCommissionCraft(api, id, options);
  if (!ready.ok) throw new Error(`craft: cannot craft commission "${id}":\n- ${ready.errors.join("\n- ")}`);
  const { c, crafter, patronActor, recipe, plan, learn } = ready.ctx;
  const now = Date.now();

  // ---- Rolls (nothing is written yet) ----
  let degree = options.degree;
  if (degree) {
    if (!adapter.normalizeDegree(degree)) throw new Error(`craft: unknown degree "${degree}"`);
  } else {
    degree = (await adapter.rollCraftCheck(crafter, adapter.levelDC(plan.craftLevel))).degree;
  }
  const outcome = resolveOutcome({ plan, degree, rng: d100, config: CRAFTING });

  let formulas = rawList(crafter, K.formulasFlag);
  let projects = rawList(crafter, K.projectsFlag);
  const learnLog = {};
  const progressTo = (project, delta, source, skill, why) => applyProgress(project, { delta, source, skill, note: why });
  let project = projects.find(p => p?.outcome?.recipeId === recipe.id && p.status === "active");
  const ensureProject = () => {
    if (project) return project;
    const built = buildProject(recipe);
    if (!built.ok) throw new Error(`craft: cannot start a research project for the learn roll: ${built.errors.join("; ")}`);
    learnLog.started = true;
    return built.project;
  };
  const saveProject = updated => {
    projects = [...projects.filter(p => p?.id !== updated.id), updated];
    project = updated.status === "active" ? updated : null;
  };
  const learned = new Set();

  if (learn.eligible) {
    const target = ensureProject();
    let learnDegree = options.learnDegree;
    let natural = null;
    if (learnDegree) {
      if (!adapter.normalizeDegree(learnDegree)) throw new Error(`craft: unknown learn degree "${learnDegree}"`);
    } else {
      const roll = await adapter.rollSkillCheck(crafter, learn.skill, target.dc, { createMessage: false });
      learnDegree = roll.degree;
      natural = roll.natural;
    }
    const applied = progressTo(target, deltaFor(learnDegree), "commission", learn.skill, `learn roll (commission ${c.id})`);
    if (!applied.ok) throw new Error(`craft: learn roll: ${applied.errors.join("; ")}`);
    saveProject(applied.project);
    Object.assign(learnLog, { skill: learn.skill, degree: learnDegree, natural, progress: applied.project.progress, threshold: applied.project.threshold, completed: applied.completed });
    if (applied.completed) learned.add("research");
  }

  // Delivery effects on the crafter's own lists.
  let delivered = false;
  if (outcome.made) {
    delivered = true;
    if (c.teaches.type === "progress" && !learned.size && findFormula(formulas, recipe.id)?.access !== "owned") {
      const applied = progressTo(ensureProject(), c.teaches.amount, "commission", undefined, `taught by commission ${c.id}`);
      if (applied.ok) {
        saveProject(applied.project);
        learnLog.taught = c.teaches.amount;
        if (applied.completed) learned.add("research");
      }
    }
    if (c.teaches.type === "fullCopy") learned.add("copy");
  }
  if (learned.size) {
    const added = addFormula(formulas, recipe, { access: "owned", source: learned.has("copy") ? "commission" : "commission-learn" });
    if (!added.ok) throw new Error(added.error);
    formulas = added.list;
    learnLog.formulaLearned = true;
  }
  if (delivered) formulas = dropLoan(formulas, c.id).list;

  // ---- The steps that move gold and items ----
  let itemData = null;
  if (outcome.made && patronActor) {
    const base = await adapter.loadItemSource(plan.outputUuid);
    itemData = adapter.buildCraftedItemData(base, plan.description, {
      ...plan.provenance, crafter: crafter.id, degree: outcome.degree, commission: c.id, patron: patronActor.id
    }, { name: plan.resultName ?? undefined });
  }
  const supplier = c.materialsFrom === "npc" ? { kind: "npc" } : { kind: c.materialsFrom, actorId: ready.ctx.supplierActor.id };
  const steps = buildSteps({ patron: c.patron, crafterId: crafter.id, supplier, outcome, payoutCopper: toCopper(c.payout), itemData });

  const consumedUnits = outcome.consumed.filter(u => u.units > 0).map(u => ({ materialId: u.materialId, units: u.units }));
  const entry = {
    at: now, type: "craft", degree: outcome.degree, made: outcome.made,
    feeGp: patronActor ? plan.fee : 0, feePayer: patronActor ? patronActor.name : "waived (NPC patron)",
    materialsFrom: c.materialsFrom, materialsConsumed: consumedUnits, materialsKept: outcome.kept.filter(u => u.units > 0).map(u => ({ materialId: u.materialId, units: u.units })),
    ...(outcome.made ? { itemName: plan.resultName ?? plan.recipeName, itemTo: patronActor ? patronActor.name : "no item (NPC patron)", payoutGp: c.payout, payoutFrom: patronActor ? patronActor.name : "the NPC" } : {}),
    ...(Object.keys(learnLog).length ? { learn: learnLog } : {})
  };
  const next = {
    ...c, attempts: c.attempts + 1, learnAttempted: c.learnAttempted || learn.eligible,
    status: outcome.made ? "delivered" : "inProgress",
    ...(outcome.made ? { delivered: { itemName: plan.resultName ?? plan.recipeName, degree: outcome.degree, at: now } } : {}),
    log: logEntry(c, entry, now)
  };

  // ---- Writes ----
  const actors = new Map([[crafter.id, crafter], ...(patronActor ? [[patronActor.id, patronActor]] : [])]);
  const undos = await applySteps(steps, actors);
  try {
    await withRecord(next, () => commitCrafter(crafter, { formulas, projects, extra: options.extraUpdate, note: `commission ${c.id}` }));
  } catch (error) {
    await rollBack(undos).catch(rollbackError => { throw new Error(`${error.message}. ${rollbackError.message}`); });
    throw error;
  }

  if (options.chat !== false) await postCraftChat({ c, crafter, patronActor, plan, outcome, entry, next });
  console.log(`${MODULE_ID} | commission craft`, { id: c.id, degree: outcome.degree, made: outcome.made });
  return { outcome, commission: next, delivered, learn: learnLog, steps };
}

async function postCraftChat({ c, crafter, patronActor, plan, outcome, entry, next }) {
  const lines = [formatSummary({ crafterName: esc(crafter.name), plan, outcome, itemName: next.delivered?.itemName })];
  lines.push(`Commission for <strong>${esc(patronName(c))}</strong>: ${outcome.made ? `delivered${patronActor ? "" : " (no item changes hands for an NPC patron)"}; payout ${esc(gpText(toCopper(c.payout)))}.` : "still open; no payout yet."}`);
  if (entry.learn?.degree) lines.push(`Learn roll: progress ${entry.learn.progress}/${entry.learn.threshold}${entry.learn.completed ? " - formula learned!" : ""}.`);
  try {
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: crafter }), content: lines.join("<br>") });
  } catch (error) {
    console.error(`${MODULE_ID} | the commission craft is saved, but the chat message failed`, error);
  }
}

// The queue ------------------------------------------------------------------------------------------------------
/** What a player's client can check before queueing a commission step (also used by the GM on resolve). */
export function submitContext(actor, params) {
  const crafterRef = params?.crafter;
  let crafterId;
  if (crafterRef !== undefined) {
    const found = typeof crafterRef === "string" ? (game.actors.get(crafterRef) ?? game.actors.getName(crafterRef)) : crafterRef;
    crafterId = found?.id;
  }
  return {
    actorId: actor.id, isGM: game.user.isGM, commissions: readCommissions(), formulas: rawList(actor, K.formulasFlag), crafterId
  };
}

/** The text for the review window: { label, detail, problem }. */
export function describeInfo(api, actor, action) {
  const p = action.params ?? {};
  if (p.step === "request") {
    const crafter = game.actors.get(p.crafter);
    const recipe = api.definitions?.recipe.get(p.recipe);
    const holds = ownedFormula(actor, p.recipe);
    const parts = [`${p.access ?? "loan"}, payout ${gpText(toCopper(p.payout ?? 0))}`, `${actor.name} ${holds ? "holds" : "DOES NOT HOLD"} the formula`, `${actor.name} has ${gpText(adapter.getCopper(actor))}`];
    if (crafter && recipe && findFormula(readFormulaList(crafter), recipe.id)?.access === "owned") parts.push(`${crafter.name} already knows this formula`);
    return { label: `Commission request: ${actor.name} asks ${crafter?.name ?? "?"} to craft ${recipe?.name ?? p.recipe}`, detail: parts.join("; "), problem: !crafter ? "the crafter no longer exists" : !recipe ? "the recipe no longer exists" : !holds ? "the patron does not hold the formula" : null };
  }
  const c = readCommissions().find(x => x.id === p.id);
  if (!c) return { label: `Commission ${p.step}: ${p.id ?? "?"}`, detail: "commission not found", problem: "the commission no longer exists" };
  const base = `${patronName(c)} -> ${nameOf(c.crafter)}: ${api.definitions?.recipe.get(c.formulaId)?.name ?? c.formulaId} (${c.access}, ${gpText(toCopper(c.payout))}, ${c.status})`;
  if (p.step === "craft") {
    const ready = prepareCommissionCraft(api, c.id, { selection: p.selection, station: p.station, learnSkill: p.learnSkill });
    return { label: `Commission craft: ${nameOf(c.crafter)} for ${patronName(c)}`, detail: base, problem: ready.ok ? null : ready.errors.join("; ") };
  }
  const note = p.step === "accept" && p.as === "loan" ? "; takes it as a loan instead of a copy" : "";
  const warn = commissionWarnings(c, findFormula(readFormulaList(game.actors.get(c.crafter) ?? actor), c.formulaId)?.access ?? null);
  return { label: `Commission ${p.step}: ${base}${note}`, detail: warn.join("; ") || `${c.materialsFrom} supplies the materials`, problem: null };
}

/**
 * Resolve one queued commission step (GM client). Returns { status, message } or throws.
 * options: { chat?, degree? (forces the craft check, a test override) }
 */
export async function resolveStep(api, actor, action, pending, options = {}) {
  requireGM("resolve");
  const p = action.params;
  const others = pending.filter(a => a.id !== action.id);
  const pendingUpdate = { [flagKey("pendingActions")]: others };
  const finish = () => commit(actor, pendingUpdate);
  try {
    // The action's own character must hold the right role (patron to cancel, crafter to accept, decline or craft).
    if (p.step !== "request") openOrRefuse(p.id, p.step, actor.id, false);
    switch (p.step) {
      case "request": {
        const c = await createFromRequest(api, actor, action);
        await finish();
        return { status: "resolved", message: `commission "${c.id}" created; waiting for ${nameOf(c.crafter)} to accept.` };
      }
      case "accept": {
        const c = await acceptStep(api, p.id, { as: p.as, actorId: actor.id, extraUpdate: pendingUpdate });
        return { status: "resolved", message: `${actor.name} accepted (${c.access}).` };
      }
      case "decline": {
        await declineStep(p.id, { actorId: actor.id });
        await finish();
        return { status: "resolved", message: `${actor.name} declined.` };
      }
      case "cancel": {
        const c = readCommissions().find(x => x.id === p.id);
        await cancelStep(p.id, { actorId: actor.id, reason: `cancelled by ${actor.name}` });
        await finish();
        return { status: "resolved", message: `commission "${p.id}" cancelled${c?.access === "copy" ? " (the crafter keeps the copy)" : ""}.` };
      }
      case "craft": {
        const result = await craftForCommission(api, p.id, {
          selection: p.selection, station: p.station, learnSkill: p.learnSkill, degree: options.degree, chat: options.chat, extraUpdate: pendingUpdate
        });
        return { status: "resolved", message: `${result.outcome.made ? "delivered" : "failed, still open"} (${result.outcome.degree}).` };
      }
      default:
        return refuse(`unknown commission step "${p.step}"`);
    }
  } catch (error) {
    if (!(error instanceof CommissionRefused)) throw error;
    await finish();
    return { status: "invalid", message: `${error.message}. The request was removed.` };
  }
}
