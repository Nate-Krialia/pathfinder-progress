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

const requireGM = what => { if (!game.user.isGM) throw new Error(`${what}: GM only`); };
const flagKey = key => `flags.${MODULE_ID}.${key}`;
const noun = "research";

// Reading -------------------------------------------------------------------------------
/** The raw list stored in an actor flag. A non-list flag is a loud error, never silently replaced. */
function rawList(actor, key) {
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
    throw new Error(`${actor.name} has no project "${projectId}" (projects: ${list.map(p => p?.id).join(", ") || "none"})`);
  }
  const problems = check(LIVE_SCHEMAS.project, list[index]);
  if (problems.length) throw new Error(`project "${projectId}" is invalid: ${problems.map(p => `${p.field} ${p.message}`).join("; ")}`);
  return { list, index, project: list[index] };
}

function requireUnlockProject(project, what) {
  if (project.outcome.type !== "unlockFormula") throw new Error(`${what}: only unlockFormula projects can be researched for now (upgradeStation arrives in Stage 9)`);
}

// Days -----------------------------------------------------------------------------------
export const days = actor => readDays(actor);

export async function grantDays(actor, n) {
  requireGM("grantDays");
  const total = afterGrant(readDays(actor), n);
  await actor.setFlag(MODULE_ID, K.daysFlag, total);
  return total;
}

export async function setDays(actor, n) {
  requireGM("setDays");
  await actor.setFlag(MODULE_ID, K.daysFlag, validateSetDays(n));
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
  await actor.update({ [flagKey(K.projectsFlag)]: [...projects.filter(p => p?.id !== built.project.id), built.project] });
  return built.project;
}

/** Stop a project (it keeps its progress record but can no longer be researched). */
export async function abandonProject(actor, projectId) {
  requireGM("abandonProject");
  const { list, index, project } = findProject(actor, projectId);
  const next = [...list];
  next[index] = abandonRecord(project, "abandoned by the GM");
  await actor.update({ [flagKey(K.projectsFlag)]: next });
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
  const recipe = project.outcome.type === "unlockFormula" ? api.definitions?.recipe.get(project.outcome.recipeId) : null;
  if (project.outcome.type === "unlockFormula" && !recipe) hints.push(`recipe "${project.outcome.recipeId}" no longer exists; abandon this project`);
  if (recipe && recipe.researchProject.tier !== project.tier) hints.push(`the recipe's research tier is now ${recipe.researchProject.tier}, but this project began at tier ${project.tier}`);
  return { project, daysAvailable: readDays(actor), perSkill, hints };
}

/**
 * Research a project for up to `days` downtime days (one check per day). Stops early when the
 * project completes and does not spend the leftover days. GM only.
 * @param {object} options { actor, project, days, skill?, degree?, chat? }
 *   degree (TEST OVERRIDE): a degree name for every day, or an array with one per day.
 */
export async function research({ actor, project: projectId, days: dayCount, skill, degree, chat = true }, api) {
  requireGM("research");
  const { list, index, project } = findProject(actor, projectId);
  requireUnlockProject(project, "research");
  if (project.status !== "active") throw new Error(`research: project "${projectId}" is ${project.status}, not active`);
  const recipe = api.definitions?.recipe.get(project.outcome.recipeId);
  if (!recipe) throw new Error(`research: recipe "${project.outcome.recipeId}" no longer exists; abandon the project with api.abandonProject`);

  const picked = pickSkill(project.skillWhitelist, skill, `"${project.goalName}"`, noun);
  if (!picked.ok) throw new Error(`research: ${picked.error}`);

  if (!Number.isInteger(dayCount) || dayCount < 1) throw new Error(`research: days must be a whole number of at least 1 (got ${dayCount})`);

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

  const available = readDays(actor);
  const result = await resolveResearch({ project, skill: picked.skill, days: dayCount, daysAvailable: available, rollDay });
  if (!result.ok) throw new Error(`research: ${result.errors.join("; ")}`);

  // Commit everything in ONE update: progress, days, and (on completion) the formula.
  const nextProjects = [...list];
  nextProjects[index] = result.project;
  const update = { [flagKey(K.projectsFlag)]: nextProjects, [flagKey(K.daysFlag)]: result.daysRemaining };
  if (result.completed) update[flagKey(K.formulasFlag)] = unlockedFormulas(actor, recipe, "research");
  await actor.update(update);

  if (chat) {
    await postChat(actor, formatResearchSummary({
      actorName: actor.name, project: result.project, skillName: adapter.skillLabel(picked.skill), results: result.results, completed: result.completed
    }));
  }
  return {
    ok: true, project: result.project, skill: picked.skill, results: result.results,
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
  const update = { [flagKey(K.projectsFlag)]: nextProjects };
  if (applied.completed) update[flagKey(K.formulasFlag)] = unlockedFormulas(actor, recipe, "research");
  await actor.update(update);

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

  const update = { [flagKey(K.formulasFlag)]: added.list };
  // An owned formula makes any running project for it pointless: close it.
  if (access === "owned") {
    const projects = rawList(actor, K.projectsFlag);
    const open = projects.findIndex(p => p?.status === "active" && p?.outcome?.recipeId === recipeId);
    if (open >= 0) {
      const next = [...projects];
      next[open] = abandonRecord(projects[open], "formula granted by the GM");
      update[flagKey(K.projectsFlag)] = next;
    }
  }
  await actor.update(update);
  return { entry: findFormula(added.list, recipeId), change: added.change };
}

export async function removeFormula(actor, recipeId) {
  requireGM("removeFormula");
  const removed = removeFromList(rawList(actor, K.formulasFlag), recipeId);
  if (!removed.ok) throw new Error(`removeFormula: ${removed.error}`);
  await actor.setFlag(MODULE_ID, K.formulasFlag, removed.list);
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
      await a.setFlag(MODULE_ID, K.formulasFlag, raw.map(entry => refreshedSet.get(entry?.recipeId) ?? entry));
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
