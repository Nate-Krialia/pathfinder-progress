/**
 * Resolving research days. Pure: the daily roll is an injected function, so tests
 * script every degree and a future relay can plug in. One check per downtime day.
 */
import { RESEARCH } from "../config.js";
import { DEGREE_NAMES } from "../checks.js";
import { applyProgress, deltaFor } from "./project.js";

/**
 * @param {object} args
 * @param {object} args.project        an active project
 * @param {string} args.skill          the skill used for every day of this call
 * @param {number} args.days           how many days the researcher wants to spend (at most)
 * @param {number} args.daysAvailable  the downtime days the actor has
 * @param {(day: number) => Promise<{degree: string, total?: number}>} args.rollDay
 * @returns {Promise<{ok: false, errors: string[]} | {ok: true, project, results, daysSpent, daysRemaining, completed}>}
 */
export async function resolveResearch({ project, skill, days, daysAvailable, rollDay, config = RESEARCH }) {
  const errors = [];
  if (project.status !== "active") errors.push(`project "${project.id}" is ${project.status}, not active`);
  if (!Number.isInteger(days) || days < 1) errors.push(`days must be a whole number of at least 1 (got ${days})`);
  else if (days > daysAvailable) errors.push(`needs ${days} downtime day(s) but only ${daysAvailable} available`);
  if (errors.length) return { ok: false, errors };

  let current = project;
  const results = [];
  for (let day = 1; day <= days; day++) {
    const rolled = await rollDay(day);
    if (!DEGREE_NAMES.includes(rolled?.degree)) throw new Error(`resolveResearch: rollDay(${day}) must return a degree (got ${JSON.stringify(rolled)})`);

    const before = current.progress;
    const applied = applyProgress(current, { delta: deltaFor(rolled.degree, config), source: "research", skill, degree: rolled.degree }, config);
    current = applied.project;
    results.push({ day, skill, degree: rolled.degree, total: rolled.total ?? null, delta: current.progress - before, progressAfter: current.progress });
    if (applied.completed) break; // the goal is reached: the remaining days are not spent
  }

  return {
    ok: true, project: current, results,
    daysSpent: results.length,
    daysRemaining: daysAvailable - results.length,
    completed: current.status === "complete"
  };
}
