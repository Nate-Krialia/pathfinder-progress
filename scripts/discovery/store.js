/**
 * The discovery chain, Foundry side (Stage 11c, docs/11c-discovery-addendum.md): studying materials and notes in milestones, the leads that offer a study,
 * and the higher formula versions that appear once enough tagged materials are understood.
 *
 * The ledger (actor flag `discoveries`) holds the steps put in and the milestones reached, never a threshold. Thresholds live in the GM's definitions (and the
 * Discovery tracks window's overlay) and are read at each check, so editing a track applies to studies already running.
 */
import { DISCOVERY, MODULE_ID, QUEUE_KEYS, RESEARCH, RESEARCH_KEYS as K } from "../config.js";
import * as adapter from "../adapter/pf2e.js";
import { commit, logWorldEvent } from "../audit/store.js";
import { whisper, resultRecipients } from "../chat.js";
import * as gmLog from "../gm-log.js";
import { check } from "../data/schema.js";
import { LIVE_SCHEMAS, TRACK_SCHEMA } from "../data/schemas.js";
import { emit } from "../events.js";
import { recordSpent } from "../downtime/store.js";
import { booksFor, hasMaterial } from "../compendium/store.js";
import { resolveResearch } from "../research/daily.js";
import { addFormula, findFormula } from "../research/formulas.js";
import { ResearchRefused, rawList, readDays } from "../research/store.js";
import { pickSkill } from "../gathering/resolve.js";
import { W } from "./words.js";
import { finalSteps, itemKey, newlyReached, parseKey, propertiesKnown, stageOf, trackOf, versionCandidates } from "./track.js";

const requireGM = what => { if (!game.user.isGM) throw new Error(`${what}: GM only`); };
const flagKey = key => `flags.${MODULE_ID}.${key}`;
const refuse = message => { throw new ResearchRefused(message); };

// Reading -----------------------------------------------------------------------------------------------------------
/** An actor's ledger. A damaged flag is a loud error, never silently replaced. */
export function readLedger(actor) {
  const raw = actor.getFlag(MODULE_ID, K.discoveriesFlag);
  if (raw === undefined) return { v: 1, items: {} };
  const problems = check(LIVE_SCHEMAS.discoveries, raw);
  if (problems.length) throw new Error(`${actor.name}'s discoveries are invalid: ${problems.map(p => `${p.field} ${p.message}`).join("; ")}`);
  return structuredClone(raw);
}

/** The Discovery tracks window's edits (GM data): { "<kind>:<id>": track }. */
export const overlay = () => game.settings.get(MODULE_ID, DISCOVERY.overlaySetting) ?? {};

const definitionOf = (api, kind, id) => api.definitions?.[kind]?.get(id) ?? null;

/** The track of an item (GM client): the overlay, then the definition. A player copy has only `hasTrack`. */
export const trackFor = (api, key) => { const { kind, id } = parseKey(key); return trackOf(definitionOf(api, kind, id), overlay(), key); };
export const hasTrack = (api, kind, id) => {
  const def = definitionOf(api, kind, id);
  if (!def) return false;
  return game.user.isGM ? Boolean(trackOf(def, overlay(), itemKey(kind, id))) : Boolean(def.hasTrack ?? def.research);
};

/** The materials and notes a character holds that the module defines: [{ key, kind, id, name }]. */
export function heldItems(api, actor) {
  const out = [];
  const seen = new Set();
  for (const s of adapter.getMaterialStacks(actor)) {
    const def = definitionOf(api, "material", s.materialId);
    if (def && !seen.has(s.materialId) && (s.quantity ?? 1) > 0) { seen.add(s.materialId); out.push({ key: itemKey("material", def.id), kind: "material", id: def.id, name: def.name }); }
  }
  for (const s of adapter.getNoteStacks(actor)) {
    const def = definitionOf(api, "note", s.noteId);
    if (def && !seen.has(`n:${s.noteId}`)) { seen.add(`n:${s.noteId}`); out.push({ key: itemKey("note", def.id), kind: "note", id: def.id, name: def.name }); }
  }
  return out;
}

/** The leads that come from what the character CARRIES: an item with a track they have not started studying. Derived live, never stored. */
export function itemLeads(api, actor) {
  const ledger = readLedger(actor);
  return heldItems(api, actor)
    .filter(item => hasTrack(api, item.kind, item.id) && (!ledger.items[item.key] || ledger.items[item.key].paused))
    .map(item => ({ id: `item:${item.key}`, source: "item", itemKind: item.kind, itemId: item.id, name: item.name, ...(ledger.items[item.key]?.paused ? { paused: true } : {}) }));
}

/** Studies in progress, as projects for the queue (the queue's research item takes a project id): no counts, no thresholds. */
export function studyProjects(actor) {
  return Object.values(readLedger(actor).items).filter(e => e.status === "active" && !e.paused).map(e => ({
    id: `study:${e.key}`, goalName: W.studyName(e.name), status: "active", outcome: { type: "study", key: e.key }, skillWhitelist: [...DISCOVERY.skills], stage: e.stage, log: []
  }));
}
export const isStudyId = id => typeof id === "string" && id.startsWith("study:");
export const keyOfStudy = id => id.slice("study:".length);

/** The player's view of one study: what it is and a plain stage. */
export const playerStudy = entry => ({ id: `study:${entry.key}`, goalName: W.studyName(entry.name), kind: "study", status: entry.status, stage: entry.stage, stageWord: W.stages[entry.stage] });

// Starting ----------------------------------------------------------------------------------------------------------
const nameOf = (def) => def?.name ?? "?";

/** GM: start studying an item. The item has to be in hand (a version lead's recipe does not). Costs nothing until days are spent. */
export async function startStudy(api, actor, key) {
  requireGM("startStudy");
  const { kind, id } = parseKey(key);
  const def = definitionOf(api, kind, id);
  if (!def) throw new Error(`startStudy: unknown ${kind} "${id}"`);
  if (!trackFor(api, key)) throw new Error(`startStudy: ${def.name} has no research track`);
  if (kind !== "recipe" && !heldItems(api, actor).some(i => i.key === key)) throw new Error(`startStudy: ${actor.name} does not hold ${def.name}`);
  const ledger = readLedger(actor);
  const existing = ledger.items[key];
  if (existing?.paused) {                       // put aside earlier: its progress was kept, so starting again picks it up
    const { paused, ...resumed } = existing; void paused;
    ledger.items[key] = resumed;
    await actor.update({ [flagKey(K.discoveriesFlag)]: ledger });
    return resumed;
  }
  if (existing) throw new Error(existing.status === "complete" ? W.alreadyStudied(def.name) : W.alreadyStudying(def.name));
  if (kind === "recipe" && findFormula(rawList(actor, K.formulasFlag), id)) throw new Error(`startStudy: ${actor.name} already knows that formula.`);
  const entry = { key, kind, id, name: def.name, steps: 0, reached: [], stage: 0, status: "active", startedAt: Date.now() };
  ledger.items[key] = entry;
  await actor.update({ [flagKey(K.discoveriesFlag)]: ledger });
  await logWorldEvent(`study started: ${def.name} by ${actor.name}`);
  return entry;
}

/** Put a study aside: unlike a formula project it KEEPS its progress. It becomes a lead again; following it picks the study up where it stopped. */
export async function pauseStudy(actor, key) {
  const ledger = readLedger(actor);
  const entry = ledger.items[key];
  if (!entry || entry.status !== "active") throw new Error(`${actor.name} is not studying that.`);
  if (rawList(actor, QUEUE_KEYS.pendingFlag).some(a => a?.type === "research" && a.params?.projectId === `study:${key}`)) throw new Error(`Cancel the queued research for "${entry.name}" first, then put it aside.`);
  ledger.items[key] = { ...entry, paused: true };
  await actor.update({ [flagKey(K.discoveriesFlag)]: ledger });
  return { kept: true };
}

// Checking ----------------------------------------------------------------------------------------------------------
function tierFor(api, kind, def) {
  const raw = kind === "material" ? def.tier : kind === "note" ? definitionOf(api, "recipe", def.recipeId)?.researchProject?.tier : def.researchProject?.tier;
  return Math.min(Math.max(raw ?? 1, 1), Math.max(...Object.keys(RESEARCH.tiers).map(Number)));
}

/**
 * Work out a run of study checks WITHOUT writing anything (like planResearch). Throws ResearchRefused for what can never succeed, so a queued action is
 * refunded: the item is gone from the inventory, or the track was taken away.
 */
export async function planStudy(api, { actor, key, days: dayCount, daysAvailable, skill, degree }) {
  const ledger = readLedger(actor);
  const entry = ledger.items[key];
  if (!entry || entry.status !== "active") refuse(`study: there is no study "${key}" in progress`);
  const { kind, id } = parseKey(key);
  const def = definitionOf(api, kind, id);
  if (!def) refuse(`study: ${entry.name} no longer exists`);
  if (kind !== "recipe" && !heldItems(api, actor).some(i => i.key === key)) refuse(W.needItem(entry.name));
  const track = trackFor(api, key);
  if (!track) refuse(W.trackGone(entry.name));

  const picked = pickSkill(DISCOVERY.skills, skill, `"${entry.name}"`, "study");
  if (!picked.ok) refuse(`study: ${picked.error}`);
  if (!Number.isInteger(dayCount) || dayCount < 1) refuse(`study: days must be a whole number of at least 1 (got ${dayCount})`);

  let forced = null;
  if (degree !== undefined) {
    const perDay = Array.isArray(degree) ? degree : Array(dayCount).fill(degree);
    if (perDay.length < dayCount) throw new Error(`study: ${perDay.length} forced degree(s) given for ${dayCount} day(s)`);
    for (const d of perDay) if (!adapter.normalizeDegree(d)) throw new Error(`study: unknown degree "${d}"`);
    forced = perDay;
  }
  const tier = tierFor(api, kind, def);
  const dc = adapter.levelDC(DISCOVERY.levelByTier[tier] ?? 1) + RESEARCH.tiers[tier].dcOffset;
  const synthetic = { id: key, goalName: W.studyName(entry.name), outcome: { type: "study" }, tier, dc, threshold: finalSteps(track), progress: entry.steps, skillWhitelist: [...DISCOVERY.skills], status: "active", log: [] };
  const rollDay = forced
    ? async day => ({ degree: forced[day - 1] })
    : async () => { const roll = await adapter.rollSkillCheck(actor, picked.skill, dc, { createMessage: false }); return { degree: roll.degree, total: roll.total, natural: roll.natural }; };
  const result = await resolveResearch({ project: synthetic, skill: picked.skill, days: dayCount, daysAvailable, rollDay });
  if (!result.ok) {
    const message = `study: ${result.errors.join("; ")}`;
    if (daysAvailable < dayCount) refuse(message);
    throw new Error(message);
  }

  const steps = result.project.progress;
  const newly = newlyReached(track, steps, entry.reached);
  const granted = newly.map(({ m, index }) => ({ index, type: m.grants.type, ...(m.grants.type === "formula" ? { recipeId: m.grants.recipeId ?? (kind === "note" ? def.recipeId : id) } : {}) }));
  const next = { ...entry, steps, reached: [...entry.reached, ...granted], stage: stageOf(track, steps), status: steps >= finalSteps(track) ? "complete" : "active" };
  ledger.items[key] = next;

  // Formula milestones teach the formula in the SAME commit (like a finished project does).
  let formulas = rawList(actor, K.formulasFlag);
  const changes = [];
  if (result.daysSpent) changes.push({ type: "days", delta: -result.daysSpent, note: `study: ${entry.name}` });
  const taught = [];
  for (const g of granted.filter(x => x.type === "formula")) {
    const recipe = definitionOf(api, "recipe", g.recipeId);
    if (!recipe) { console.error(`${MODULE_ID} | study: ${entry.name} teaches "${g.recipeId}", which no longer exists`); continue; }
    const added = addFormula(formulas, recipe, { access: "owned", source: "research" });
    if (!added.ok) continue;                      // already known: nothing to add
    formulas = added.list;
    taught.push(recipe);
    changes.push({ type: "formulaAdd", recipeId: recipe.id, access: "owned", note: "study completed" });
  }
  const update = { [flagKey(K.discoveriesFlag)]: ledger };
  if (taught.length) update[flagKey(K.formulasFlag)] = formulas;
  return { result, skill: picked.skill, key, entry: next, granted, taught, update, changes, dc };
}

/** After a study plan is committed: tell the world what was learned, and look for higher versions that just became possible. */
export async function afterStudy(api, actor, plan) {
  for (const recipe of plan.taught) await emit("formulaOwned", { actor, recipeId: recipe.id });
  if (plan.granted.length) await refreshVersionLeads(api, actor);
}

/** The whisper to the owners and the GM (degree words and what was learned; never a number), and the GM log line with the totals and the DC. */
export async function postStudyChat(api, actor, plan) {
  const degreeWord = { criticalSuccess: "critical success", success: "success", failure: "failure", criticalFailure: "critical failure" };
  const lines = [W.summary(actor.name, plan.entry.name, plan.result.results.map(r => degreeWord[r.degree] ?? r.degree))];
  const def = definitionOf(api, plan.entry.kind, plan.entry.id);
  for (const g of plan.granted) {
    if (g.type === "properties") {
      const tag = def?.tag ? definitionOf(api, "tag", def.tag) : null;
      lines.push(W.learnedProperties(plan.entry.name, tag?.name, tag?.theme));
    } else lines.push(W.learnedFormula(definitionOf(api, "recipe", g.recipeId)?.name ?? g.recipeId));
  }
  await whisper(resultRecipients(actor), `<p>${lines.join("<br>")}</p>`);
  if (plan.result.results.some(r => r.total !== null)) {
    gmLog.record({
      kind: "research", actorId: actor.id, actorName: actor.name,
      text: `${actor.name} studied ${plan.entry.name} vs DC ${plan.dc}: ${plan.result.results.map(r => `${r.total} (${r.degree})`).join(", ")}`,
      detail: { goal: plan.entry.name, dc: plan.dc, results: plan.result.results.map(r => ({ day: r.day, degree: r.degree, total: r.total, delta: r.delta })) }
    });
  }
}

/** GM tool: spend the character's own free days on a study (like api.research). Returns { entry, results, daysSpent, granted }. */
export async function study({ actor, key, days: dayCount, skill, degree, chat = true }, api) {
  requireGM("study");
  const plan = await planStudy(api, { actor, key, days: dayCount, daysAvailable: readDays(actor), skill, degree });
  await commit(actor, { ...plan.update, [flagKey(K.daysFlag)]: plan.result.daysRemaining }, plan.changes);
  await recordSpent(actor, plan.result.daysSpent);
  await afterStudy(api, actor, plan);
  if (chat) await postStudyChat(api, actor, plan);
  return { entry: plan.entry, results: plan.result.results, daysSpent: plan.result.daysSpent, granted: plan.granted };
}

// Higher formula versions ------------------------------------------------------------------------------------------------
/**
 * GM: add a stored lead for every higher formula version the character has earned (its previous version known, enough distinct tagged materials understood).
 * Idempotent. It is only a LEAD: the version still has to be researched, with the thresholds the GM set on that version.
 */
export async function refreshVersionLeads(api, actor) {
  requireGM("refreshVersionLeads");
  const ledger = readLedger(actor);
  const books = booksFor(actor);
  const leads = rawList(actor, K.leadsFlag);
  const projects = rawList(actor, K.projectsFlag);
  const taken = new Set([
    ...leads.map(l => l?.recipeId),
    ...Object.values(ledger.items).filter(e => e.kind === "recipe").map(e => e.id),
    ...projects.filter(p => p?.status !== "abandoned").map(p => p?.outcome?.recipeId)
  ]);
  const formulaIds = rawList(actor, K.formulasFlag).filter(f => f.access === "owned").map(f => f.recipeId);
  const found = versionCandidates({
    registry: api.definitions, formulaIds, taken,
    met: m => hasMaterial(actor, m.id),
    propsKnown: m => propertiesKnown({ ledger, books, materialId: m.id, hasTrack: Boolean(trackOf(m, overlay(), itemKey("material", m.id))) })
  });
  if (!found.length) return [];
  const added = found.map(c => {
    const recipe = definitionOf(api, "recipe", c.recipeId);
    const tag = definitionOf(api, "tag", recipe.requiresTag);
    return { id: foundry.utils.randomID(), recipeId: c.recipeId, name: c.name, note: W.leadVersion(tag?.name ?? recipe.requiresTag), at: Date.now(), source: "version" };
  });
  await actor.update({ [flagKey(K.leadsFlag)]: [...leads, ...added] });
  for (const lead of added) await logWorldEvent(`lead earned: ${lead.name} for ${actor.name}`);
  return added;
}

/** Does the character know this material's properties (so its tag and theme, and crafting with it, are open)? Works on a player client too. */
export function propertiesOpen(api, actor, materialId) {
  const def = definitionOf(api, "material", materialId);
  if (!def) return false;
  return propertiesKnown({ ledger: readLedger(actor), books: booksFor(actor), materialId, hasTrack: hasTrack(api, "material", materialId) });
}

// The Discovery tracks window's storage -----------------------------------------------------------------------------------
/** GM: set (or with null clear) the overlay track of one item. The track is validated like a definition's. */
export async function setTrack(api, key, track) {
  requireGM("setTrack");
  const { kind, id } = parseKey(key);
  if (!["material", "note", "recipe"].includes(kind) || !definitionOf(api, kind, id)) throw new Error(`setTrack: unknown item "${key}"`);
  const next = { ...overlay() };
  if (track === null) delete next[key];
  else {
    const problems = check(TRACK_SCHEMA, track);
    if (problems.length) throw new Error(`setTrack: ${problems.map(p => `${p.field} ${p.message}`).join("; ")}`);
    track.milestones.forEach((m, i) => {
      if (m.grants.type === "properties" && kind !== "material") throw new Error(`setTrack: milestone ${i + 1}: only a material has a properties milestone`);
      if (m.grants.type === "formula") {
        const recipeId = m.grants.recipeId ?? (kind === "note" ? definitionOf(api, "note", id).recipeId : kind === "recipe" ? id : null);
        if (!recipeId || !definitionOf(api, "recipe", recipeId)) throw new Error(`setTrack: milestone ${i + 1}: pick a formula that exists`);
      }
    });
    next[key] = track;
  }
  await game.settings.set(MODULE_ID, DISCOVERY.overlaySetting, next);
  return next;
}

// projectInfo ------------------------------------------------------------------------------------------------------------
/**
 * `api.projectInfo`, with studies. Without an id: the actor's projects plus its studies (a study has a plain stage and no counts). With a study id: its player view
 * (the GM also sees the steps put in). Any other id goes to the ordinary project info.
 */
export function projectInfoWithStudies(api, actor, projectId, ordinary) {
  if (!projectId) {
    const list = ordinary(api, actor);
    const studies = Object.values(readLedger(actor).items).filter(e => e.status === "active" && !e.paused).map(e => ({ ...playerStudy(e), progress: undefined, threshold: undefined }));
    return [...list, ...studies];
  }
  if (!isStudyId(projectId)) return ordinary(api, actor, projectId);
  const entry = readLedger(actor).items[keyOfStudy(projectId)];
  if (!entry) throw new Error(`${actor.name} has no study "${projectId}"`);
  const modifierFor = skill => { try { return adapter.getSkillModifier(actor, skill); } catch { return null; } };
  return {
    project: { ...playerStudy(entry), skillWhitelist: [...DISCOVERY.skills], ...(game.user.isGM ? { steps: entry.steps } : {}) },
    daysAvailable: readDays(actor),
    perSkill: DISCOVERY.skills.map(skill => ({ skill, modifier: modifierFor(skill) })),
    hints: []
  };
}
