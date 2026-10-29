/**
 * Foundry-bound research: the day budget, projects and formulas stored on actors, and
 * the GM tools. The rules live in the pure modules (project.js, daily.js, odds.js,
 * days.js, formulas.js); this file reads and writes actor flags and calls the PF2e adapter.
 *
 * Every write that spends days or changes progress is ONE actor update, so a failure
 * part-way changes nothing.
 */
import { MODULE_ID, RESEARCH_KEYS as K } from "../config.js";
import * as adapter from "../adapter/pf2e.js";
import { commit, logWorldEvent } from "../audit/store.js";
import { noteOverride, recordSpent } from "../downtime/store.js";
import { check } from "../data/schema.js";
import { LIVE_SCHEMAS } from "../data/schemas.js";
import { pickSkill } from "../gathering/resolve.js";
import { degreeChances } from "../checks.js";
import { abandonProject as abandonRecord, applyProgress, buildProject } from "./project.js";
import { resolveResearch } from "./daily.js";
import { afterGrant, daysFrom, validateSetDays } from "./days.js";
import { expectedDaysToFinish, expectedProgressPerDay } from "./odds.js";
import { addFormula, findFormula, refreshSnapshots, removeFormula as removeFromList, reportFormulas } from "./formulas.js";
import { formatProgressSummary, formatResearchSummary } from "./summary.js";
import { applyStationUpgrade } from "../stations/store.js";
import { targetProblem, withDesign, BLUEPRINTS_FLAG } from "../workshop/targets.js";

const requireGM = what => { if (!game.user.isGM) throw new Error(`${what}: GM only`); };

/**
 * A request that can never succeed as stated (the project is gone or finished, the recipe was
 * deleted, the skill is not allowed). The queue refunds the days for these. Anything else that
 * goes wrong is unexpected and leaves a queued action untouched.
 */
export class ResearchRefused extends Error {}
const refuse = message => { throw new ResearchRefused(message); };
const flagKey = key => `flags.${MODULE_ID}.${key}`;
const noun = "research";

// Reading -------------------------------------------------------------------------------
/** The raw list stored in an actor flag. A non-list flag is a loud error, never silently replaced. */
export function rawList(actor, key) {
  const raw = actor.getFlag(MODULE_ID, key);
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`${actor.name}'s "${key}" flag is not a list; fix or clear it first`);
  return raw;
}

export const readDays = actor => daysFrom(actor.getFlag(MODULE_ID, K.daysFlag));
/** Formula entries as stored (for craft's formula check). Invalid entries are ignored here and reported by formulasFor. */
export const readFormulaList = actor => rawList(actor, K.formulasFlag).filter(entry => check(LIVE_SCHEMAS.formula, entry).length === 0);

function findProject(actor, projectId) {
  const list = rawList(actor, K.projectsFlag);
  const index = list.findIndex(p => p?.id === projectId);
  if (index < 0) {
    refuse(`${actor.name} has no project "${projectId}" (projects: ${list.map(p => p?.id).join(", ") || "none"})`);
  }
  const problems = check(LIVE_SCHEMAS.project, list[index]);
  if (problems.length) refuse(`project "${projectId}" is invalid: ${problems.map(p => `${p.field} ${p.message}`).join("; ")}`);
  return { list, index, project: list[index] };
}

function requireUnlockProject(project, what) {
  if (project.outcome.type !== "unlockFormula") refuse(`${what}: this works on formula projects only (an upgrade or a design is researched, not given progress by hand)`);
}

const flagUpdate = (key, value) => ({ [flagKey(key)]: value });

// Days -----------------------------------------------------------------------------------
export const days = actor => readDays(actor);

export async function grantDays(actor, n, note = "granted by the GM") {
  requireGM("grantDays");
  const total = afterGrant(readDays(actor), n);
  await commit(actor, flagUpdate(K.daysFlag, total), [{ type: "days", delta: n, note }]);
  return total;
}

export async function setDays(actor, n) {
  requireGM("setDays");
  const total = validateSetDays(n);
  await commit(actor, flagUpdate(K.daysFlag, total), [{ type: "days", delta: total - readDays(actor), note: "set by the GM" }]);
  return n;
}

// Projects --------------------------------------------------------------------------------
/** Start researching a recipe. Options: { actor, recipe, dc?, threshold? } (dc/threshold tune this one project). */
export async function startProject(api, { actor, recipe: recipeId, dc, threshold }) {
  requireGM("startProject");
  const recipe = api.definitions?.recipe.get(recipeId);
  if (!recipe) throw new Error(`startProject: unknown recipe "${recipeId}"`);
  if (findFormula(rawList(actor, K.formulasFlag), recipe.id)) throw new Error(`startProject: ${actor.name} already knows the formula for "${recipe.name}"`);

  const projects = rawList(actor, K.projectsFlag);
  const built = buildProject(recipe, { overrides: { dc, threshold } });
  if (!built.ok) throw new Error(`startProject: ${built.errors.join("; ")}`);
  const existing = projects.find(p => p?.id === built.project.id);
  if (existing?.status === "active") throw new Error(`startProject: ${actor.name} already has an active project for "${recipe.name}"`);

  const problems = check(LIVE_SCHEMAS.project, built.project);
  if (problems.length) throw new Error(`startProject: built an invalid project: ${problems.map(p => `${p.field} ${p.message}`).join("; ")}`);
  await commit(actor, flagUpdate(K.projectsFlag, [...projects.filter(p => p?.id !== built.project.id), built.project]),
    [{ type: "projectSet", project: built.project, note: "started" }]);
  return built.project;
}

/** Stop a project (it keeps its progress record but can no longer be researched). */
export async function abandonProject(actor, projectId) {
  requireGM("abandonProject");
  const { list, index, project } = findProject(actor, projectId);
  if (project.status === "active" && project.materials?.length) {
    throw new Error(`abandonProject: "${project.goalName}" holds escrowed materials; put it aside with api.workshop.putAside so they come back to ${actor.name}`);
  }
  const next = [...list];
  next[index] = abandonRecord(project, "abandoned by the GM");
  await commit(actor, flagUpdate(K.projectsFlag, next), [{ type: "projectSet", project: next[index], note: "abandoned" }]);
  return next[index];
}

/**
 * With a project id: the full picture (progress, DC, and for each allowed skill your modifier,
 * the per-day odds, and the expected days to finish). Without one: a short list of the actor's projects.
 */
export function projectInfo(api, actor, projectId) {
  if (!projectId) {
    return rawList(actor, K.projectsFlag).map(p => ({ id: p?.id, goalName: p?.goalName, status: p?.status, progress: p?.progress, threshold: p?.threshold }));
  }
  const { project } = findProject(actor, projectId);
  const perSkill = project.skillWhitelist.map(skill => {
    let modifier = null;
    try { modifier = adapter.getSkillModifier(actor, skill); } catch { /* the actor lacks this skill */ }
    if (modifier === null) return { skill, modifier, chances: null, expectedProgressPerDay: null, expectedDaysToFinish: null };
    const finish = expectedDaysToFinish({ modifier, dc: project.dc, threshold: project.threshold, progress: project.progress });
    return {
      skill, modifier,
      chances: degreeChances(modifier, project.dc),
      expectedProgressPerDay: expectedProgressPerDay(modifier, project.dc),
      expectedDaysToFinish: finish.days,
      approximate: finish.approximate
    };
  });

  const hints = [];
  if (project.outcome.type !== "unlockFormula") {
    const problem = project.status === "active" ? targetProblem(api, actor, project) : null;
    if (problem) hints.push(problem);
  }
  const recipe = project.outcome.type === "unlockFormula" ? api.definitions?.recipe.get(project.outcome.recipeId) : null;
  if (project.outcome.type === "unlockFormula" && !recipe) hints.push(`recipe "${project.outcome.recipeId}" no longer exists; abandon this project`);
  if (recipe && recipe.researchProject.tier !== project.tier) hints.push(`the recipe's research tier is now ${recipe.researchProject.tier}, but this project began at tier ${project.tier}`);
  return { project, daysAvailable: readDays(actor), perSkill, hints };
}

/**
 * Work out a research run WITHOUT writing anything: validate, roll the days, apply the rules.
 * The caller commits the plan (research() below spends the actor's counter; the queue spends
 * the days an action reserved). Throws ResearchRefused for requests that can never succeed.
 * @param {object} options { actor, project, days, daysAvailable, skill?, degree? }
 *   degree (TEST OVERRIDE): a degree name for every day, or an array with one per day.
 */
export async function planResearch(api, { actor, project: projectId, days: dayCount, daysAvailable, skill, degree }) {
  const { list, index, project } = findProject(actor, projectId);
  if (project.status !== "active") refuse(`research: project "${projectId}" is ${project.status}, not active`);
  // A recipe project needs its recipe; an upgrade or a design needs its target (the workshop at the right level, the blueprint).
  let recipe = null;
  if (project.outcome.type === "unlockFormula") {
    recipe = api.definitions?.recipe.get(project.outcome.recipeId);
    if (!recipe) refuse(`research: recipe "${project.outcome.recipeId}" no longer exists; abandon the project with api.abandonProject`);
  } else {
    const problem = targetProblem(api, actor, project);
    if (problem) refuse(`research: ${problem}`);
  }

  const picked = pickSkill(project.skillWhitelist, skill, `"${project.goalName}"`, noun);
  if (!picked.ok) refuse(`research: ${picked.error}`);

  if (!Number.isInteger(dayCount) || dayCount < 1) refuse(`research: days must be a whole number of at least 1 (got ${dayCount})`);

  // Forced results (testing): one degree for all days, or an array with one per day.
  let forced = null;
  if (degree !== undefined) {
    const perDay = Array.isArray(degree) ? degree : Array(dayCount).fill(degree);
    if (perDay.length < dayCount) throw new Error(`research: ${perDay.length} forced degree(s) given for ${dayCount} day(s)`);
    for (const d of perDay) if (!adapter.normalizeDegree(d)) throw new Error(`research: unknown degree "${d}"`);
    forced = perDay;
  }

  const rollDay = forced
    ? async day => ({ degree: forced[day - 1] })
    : async () => {
      const roll = await adapter.rollSkillCheck(actor, picked.skill, project.dc, { createMessage: false });
      return { degree: roll.degree, total: roll.total, natural: roll.natural };
    };

  const result = await resolveResearch({ project, skill: picked.skill, days: dayCount, daysAvailable, rollDay });
  if (!result.ok) {
    // Running out of days is a refusal the caller can act on; the rest is unexpected.
    const message = `research: ${result.errors.join("; ")}`;
    if (daysAvailable < dayCount) refuse(message);
    throw new Error(message);
  }

  const nextProjects = [...list];
  nextProjects[index] = result.project;
  const changes = [];
  if (result.daysSpent) changes.push({ type: "days", delta: -result.daysSpent, note: `research: ${project.goalName}` });
  changes.push({ type: "projectSet", project: result.project, note: "researched" });
  if (result.completed && recipe) changes.push({ type: "formulaAdd", recipeId: recipe.id, access: "owned", note: "research completed" });
  const outcome = project.outcome;
  return {
    result, skill: picked.skill, projects: nextProjects,
    formulas: result.completed && recipe ? unlockedFormulas(actor, recipe, "research") : null,
    // A finished design is held by the researcher; a finished upgrade is applied to the station by whoever commits the plan.
    blueprints: result.completed && outcome.type === "designBlueprint" ? withDesign(actor, api.definitions.blueprint.get(outcome.blueprintId), "research") : null,
    stationEffect: result.completed && outcome.type === "upgradeStation" ? { stationId: outcome.stationId, kind: outcome.kind, from: outcome.from, to: outcome.to } : null,
    changes
  };
}

/** The actor-flag changes a plan makes (projects and, on completion, formulas). The caller adds the days. */
export function planUpdate(plan) {
  const update = flagUpdate(K.projectsFlag, plan.projects);
  if (plan.formulas) Object.assign(update, flagUpdate(K.formulasFlag, plan.formulas));
  if (plan.blueprints) Object.assign(update, flagUpdate(BLUEPRINTS_FLAG, plan.blueprints));
  return update;
}

/** One summary chat message for a planned run (call after it is committed). */
export function postResearchChat(actor, plan) {
  return postChat(actor, formatResearchSummary({
    actorName: actor.name, project: plan.result.project, skillName: adapter.skillLabel(plan.skill), results: plan.result.results, completed: plan.result.completed
  }));
}

/**
 * Research a project for up to `days` downtime days (one check per day), spending the actor's
 * unreserved days. Stops early when the project completes and does not spend the leftover days. GM only.
 * @param {object} options { actor, project, days, skill?, degree?, chat? }
 */
export async function research({ actor, project: projectId, days: dayCount, skill, degree, chat = true }, api) {
  requireGM("research");
  await noteOverride(actor, "research"); // the GM tool goes around the downtime gate; the ledger says so
  const plan = await planResearch(api, { actor, project: projectId, days: dayCount, daysAvailable: readDays(actor), skill, degree });
  const { result } = plan;

  // A finished upgrade is applied to the station FIRST (with an undo), then everything is committed in ONE update: progress, days, and (on completion) the formula or design.
  const undoStation = plan.stationEffect ? await applyStationUpgrade(api, plan.stationEffect.stationId, plan.stationEffect) : null;
  try {
    await commit(actor, { ...planUpdate(plan), ...flagUpdate(K.daysFlag, result.daysRemaining) }, plan.changes);
  } catch (error) {
    if (undoStation) await undoStation();
    throw error;
  }
  await recordSpent(actor, result.daysSpent);
  if (plan.stationEffect) {
    try { await logWorldEvent(`upgrade finished: ${result.project.goalName} (researched by ${actor.name})`); } catch (error) { console.error(`${MODULE_ID} | could not log the finished upgrade`, error); }
  }

  if (chat) await postResearchChat(actor, plan);
  return {
    ok: true, project: result.project, skill: plan.skill, results: result.results,
    daysSpent: result.daysSpent, daysRemaining: result.daysRemaining, completed: result.completed
  };
}

/**
 * The hook for other progress sources (Stage 8 commissions, discoveries). A reason is required
 * and goes in the project log. A negative amount is a setback (progress never goes below 0).
 */
export async function addProgress(api, actor, projectId, amount, reason, { chat = true } = {}) {
  requireGM("addProgress");
  if (typeof reason !== "string" || !reason.trim()) throw new Error("addProgress: a reason is required (it is recorded in the project log)");
  const { list, index, project } = findProject(actor, projectId);
  requireUnlockProject(project, "addProgress");
  const recipe = api.definitions?.recipe.get(project.outcome.recipeId);
  if (!recipe) throw new Error(`addProgress: recipe "${project.outcome.recipeId}" no longer exists; abandon the project with api.abandonProject`);

  const applied = applyProgress(project, { delta: amount, source: "addProgress", note: reason.trim() });
  if (!applied.ok) throw new Error(`addProgress: ${applied.errors.join("; ")}`);

  const nextProjects = [...list];
  nextProjects[index] = applied.project;
  const update = flagUpdate(K.projectsFlag, nextProjects);
  const changes = [{ type: "projectSet", project: applied.project, note: `progress ${amount >= 0 ? "+" : ""}${amount}: ${reason.trim()}` }];
  if (applied.completed) {
    update[flagKey(K.formulasFlag)] = unlockedFormulas(actor, recipe, "research");
    changes.push({ type: "formulaAdd", recipeId: recipe.id, access: "owned", note: "research completed" });
  }
  await commit(actor, update, changes);

  if (chat) {
    await postChat(actor, formatProgressSummary({ actorName: actor.name, project: applied.project, applied: applied.applied, reason: reason.trim(), completed: applied.completed }));
  }
  return { ok: true, project: applied.project, applied: applied.applied, completed: applied.completed };
}

// Formulas ----------------------------------------------------------------------------------
/** The formula list after unlocking `recipe` (owned replaces a loan). */
function unlockedFormulas(actor, recipe, source) {
  const added = addFormula(rawList(actor, K.formulasFlag), recipe, { access: "owned", source });
  if (!added.ok) throw new Error(added.error);
  return added.list;
}

/** Give an actor a formula directly (GM testing, rewards). access: "owned" (default) or "loan". */
export async function grantFormula(api, actor, recipeId, { access = "owned", source = "gm" } = {}) {
  requireGM("grantFormula");
  const recipe = api.definitions?.recipe.get(recipeId);
  if (!recipe) throw new Error(`grantFormula: unknown recipe "${recipeId}"`);
  const added = addFormula(rawList(actor, K.formulasFlag), recipe, { access, source });
  if (!added.ok) throw new Error(`grantFormula: ${added.error}`);

  const update = flagUpdate(K.formulasFlag, added.list);
  const changes = [{ type: "formulaAdd", recipeId, access, note: `granted (${source})` }];
  // An owned formula makes any running project for it pointless: close it.
  if (access === "owned") {
    const projects = rawList(actor, K.projectsFlag);
    const open = projects.findIndex(p => p?.status === "active" && p?.outcome?.recipeId === recipeId);
    if (open >= 0) {
      const next = [...projects];
      next[open] = abandonRecord(projects[open], "formula granted by the GM");
      update[flagKey(K.projectsFlag)] = next;
      changes.push({ type: "projectSet", project: next[open], note: "closed by a granted formula" });
    }
  }
  await commit(actor, update, changes);
  return { entry: findFormula(added.list, recipeId), change: added.change };
}

export async function removeFormula(actor, recipeId) {
  requireGM("removeFormula");
  const removed = removeFromList(rawList(actor, K.formulasFlag), recipeId);
  if (!removed.ok) throw new Error(`removeFormula: ${removed.error}`);
  await commit(actor, flagUpdate(K.formulasFlag, removed.list), [{ type: "formulaRemove", recipeId, note: "removed by the GM" }]);
}

/** What an actor holds: owned/loan, and whether each copy is ok, stale, or orphaned. */
export function formulasFor(api, actor) {
  const raw = rawList(actor, K.formulasFlag);
  const valid = raw.filter(entry => check(LIVE_SCHEMAS.formula, entry).length === 0);
  const rows = reportFormulas(valid, api.definitions);
  for (const entry of raw) {
    const problems = check(LIVE_SCHEMAS.formula, entry);
    if (problems.length) rows.push({ recipeId: entry?.recipeId ?? "(unknown)", name: "(invalid entry)", access: entry?.access ?? null, source: entry?.source ?? null, status: "invalid", problem: problems.map(p => `${p.field} ${p.message}`).join("; ") });
  }
  return rows;
}

/** Bring stale snapshots up to date for one actor, or every actor. Returns what changed. */
export async function refreshFormulas(api, actor) {
  requireGM("refreshFormulas");
  const actors = actor ? [actor] : [...game.actors];
  const changes = [];
  for (const a of actors) {
    const raw = a.getFlag(MODULE_ID, K.formulasFlag);
    if (!Array.isArray(raw) || !raw.length) continue;
    const valid = raw.filter(entry => check(LIVE_SCHEMAS.formula, entry).length === 0);
    const { list, refreshed, orphaned } = refreshSnapshots(valid, api.definitions);
    if (refreshed.length) {
      const refreshedSet = new Map(list.map(entry => [entry.recipeId, entry]));
      // Display snapshots only; the audit tracks ownership, which does not change.
      await commit(a, flagUpdate(K.formulasFlag, raw.map(entry => refreshedSet.get(entry?.recipeId) ?? entry)), []);
    }
    if (refreshed.length || orphaned.length) changes.push({ actor: a.name, refreshed, orphaned });
  }
  return changes;
}

/** On load: refresh stale copies and tell the GM, so a recipe edit never silently leaves players with old copies. */
export async function refreshAllFormulas(api) {
  if (!game.user.isGM || !api.definitions) return [];
  const changes = await refreshFormulas(api);
  const refreshed = changes.filter(c => c.refreshed.length);
  const orphaned = changes.filter(c => c.orphaned.length);
  if (refreshed.length) {
    const text = refreshed.map(c => `${c.actor}: ${c.refreshed.join(", ")}`).join("; ");
    console.log(`${MODULE_ID} | refreshed formula copies after a recipe change: ${text}`);
    ui.notifications.info(`${MODULE_ID}: refreshed ${refreshed.reduce((n, c) => n + c.refreshed.length, 0)} formula copy(ies) after a recipe change (${text}).`);
  }
  if (orphaned.length) {
    const text = orphaned.map(c => `${c.actor}: ${c.orphaned.join(", ")}`).join("; ");
    console.warn(`${MODULE_ID} | orphaned formulas (their recipe no longer exists): ${text}`);
    ui.notifications.warn(`${MODULE_ID}: orphaned formula(s), their recipe no longer exists (${text}). Crafting them is refused; remove them with api.removeFormula.`);
  }
  return changes;
}

async function postChat(actor, content) {
  try {
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content });
  } catch (error) {
    // The change itself is saved; a chat failure must not undo or hide it.
    console.error(`${MODULE_ID} | research saved, but the chat message failed`, error);
  }
}
