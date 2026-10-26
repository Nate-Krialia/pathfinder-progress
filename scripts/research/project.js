/**
 * Research projects. Pure; no Foundry globals.
 *
 * A project is stored on the researcher's actor. Its DC and threshold are worked out
 * once, when it starts, and stored, so later config or recipe edits do not change a
 * project that is already running.
 */
import { RESEARCH } from "../config.js";
import { levelDC } from "../adapter/pf2e.js";
import { DEGREE_NAMES } from "../checks.js";

/** Progress change for one daily check: the degree's progress, minus the setback on a critical failure. */
export function deltaFor(degree, config = RESEARCH) {
  if (!DEGREE_NAMES.includes(degree)) throw new Error(`deltaFor: unknown degree "${degree}"`);
  const gain = config.progressByDegree[degree];
  return degree === "criticalFailure" ? gain - config.critFailureSetback : gain;
}

/**
 * Build a project that unlocks `recipe`.
 * DC = the recipe's level DC (from its craftLevel) + the tier's offset; threshold comes from the tier.
 * `overrides` ({ dc?, threshold? }) are GM tools for tuning one project.
 * @returns {{ ok: true, project: object } | { ok: false, errors: string[] }}
 */
export function buildProject(recipe, { config = RESEARCH, overrides = {} } = {}) {
  const errors = [];
  const tier = recipe.researchProject?.tier;
  const tierConfig = config.tiers[tier];
  if (!tierConfig) errors.push(`recipe "${recipe.id}" has research tier ${tier}, which is not in the research tier table`);

  let baseDc = null;
  try {
    baseDc = levelDC(recipe.craftLevel);
  } catch (error) {
    errors.push(`recipe "${recipe.id}": ${error.message}`);
  }
  for (const key of ["dc", "threshold"]) {
    const value = overrides[key];
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) errors.push(`override ${key} must be a whole number of at least 1 (got ${value})`);
  }
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    project: {
      id: `unlock-${recipe.id}`,
      goalName: recipe.name,
      outcome: { type: "unlockFormula", recipeId: recipe.id },
      tier,
      dc: overrides.dc ?? baseDc + tierConfig.dcOffset,
      threshold: overrides.threshold ?? tierConfig.threshold,
      progress: 0,
      skillWhitelist: [...recipe.skillWhitelist],
      status: "active",
      log: []
    }
  };
}

/**
 * Add (or, with a negative delta, remove) progress. Never goes below 0, and completes
 * the project when the threshold is reached. The single place progress changes.
 * @returns {{ ok: true, project: object, completed: boolean, applied: number } | { ok: false, errors: string[] }}
 */
export function applyProgress(project, { delta, source, skill, degree, note }, config = RESEARCH) {
  if (project.status !== "active") return { ok: false, errors: [`project "${project.id}" is ${project.status}, not active`] };
  if (!Number.isInteger(delta)) return { ok: false, errors: [`progress change must be a whole number (got ${delta})`] };

  const progress = Math.max(0, project.progress + delta);
  const applied = progress - project.progress;
  const completed = progress >= project.threshold;
  const entry = { source, delta: applied, ...(skill ? { skill } : {}), ...(degree ? { degree } : {}), ...(note ? { note } : {}) };
  const log = [...project.log, entry].slice(-config.maxLog);
  return { ok: true, project: { ...project, progress, status: completed ? "complete" : "active", log }, completed, applied };
}

export function abandonProject(project, note = "abandoned") {
  return { ...project, status: "abandoned", log: [...project.log, { source: "gm", delta: 0, note }] };
}
