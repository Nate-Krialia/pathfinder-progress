/**
 * The audit: what the module expects each actor to hold, compared with what the actor
 * holds. Pure; no Foundry globals.
 *
 * The ledger stores EXPECTED state, changed only by module operations on a GM client:
 *   days:     TOTAL downtime days (unreserved counter + days reserved by queued actions)
 *   formulas: { recipeId: "owned" | "loan" }
 *   projects: { id: { tier, dc, threshold, progress, status } }
 *   history:  the last few changes, to explain a mismatch
 * A player's own submission only moves days from the counter into a reservation, so the
 * TOTAL is unchanged and nothing false-alarms.
 *
 * Module writes apply CHANGES to the expected values, never copy the actor's current state,
 * so an earlier tamper stays visible until the GM accepts it.
 *
 * What this can catch: days, formulas and projects edited outside the module. What it
 * cannot: anything else (items, coins, kits), edits reverted before a check, who did it.
 */
import { AUDIT } from "../config.js";
import { check } from "../data/schema.js";
import { LIVE_SCHEMAS } from "../data/schemas.js";
import { pendingTotal } from "../queue/reservation.js";

export const emptyEntry = name => ({ name, days: 0, formulas: {}, projects: {}, history: [] });

const projectView = p => ({ tier: p.tier, dc: p.dc, threshold: p.threshold, progress: p.progress, status: p.status });

function pushHistory(entry, text, now) {
  entry.history = [...entry.history, { at: now, text }].slice(-AUDIT.historyMax);
}

/**
 * Apply one module change to an expected entry (returns a new entry).
 * Changes: { type: "days", delta } | { type: "formulaAdd", recipeId, access } | { type: "formulaRemove", recipeId }
 *        | { type: "projectSet", project } | { type: "projectRemove", id }   (each may carry a `note`)
 */
export function applyChange(entry, change, now = Date.now(), name = entry.name) {
  const next = { ...structuredClone(entry), name };
  switch (change.type) {
    case "days":
      next.days += change.delta;
      pushHistory(next, `${change.delta >= 0 ? "+" : ""}${change.delta} day(s)${change.note ? ` (${change.note})` : ""}`, now);
      break;
    case "formulaAdd":
      next.formulas[change.recipeId] = change.access;
      pushHistory(next, `formula ${change.recipeId} (${change.access})${change.note ? ` (${change.note})` : ""}`, now);
      break;
    case "formulaRemove":
      delete next.formulas[change.recipeId];
      pushHistory(next, `formula ${change.recipeId} removed${change.note ? ` (${change.note})` : ""}`, now);
      break;
    case "projectSet":
      next.projects[change.project.id] = projectView(change.project);
      pushHistory(next, `project ${change.project.id}: ${change.project.status}, ${change.project.progress}/${change.project.threshold}${change.note ? ` (${change.note})` : ""}`, now);
      break;
    case "projectRemove":
      delete next.projects[change.id];
      pushHistory(next, `project ${change.id} removed`, now);
      break;
    default:
      throw new Error(`applyChange: unknown change type "${change.type}"`);
  }
  return next;
}

/** An entry that matches what an actor holds right now (used for the first baseline and for "accept"). */
export function baselineEntry(state, name, text, now = Date.now()) {
  const entry = emptyEntry(name);
  const counter = Number.isInteger(state.counter) && state.counter >= 0 ? state.counter : 0;
  entry.days = counter + pendingTotal(validOnly(state.pending, "pendingAction"));
  for (const f of validOnly(state.formulas, "formula")) entry.formulas[f.recipeId] = f.access;
  for (const p of validOnly(state.projects, "project")) entry.projects[p.id] = projectView(p);
  pushHistory(entry, text, now);
  return entry;
}

const validOnly = (list, kind) => (Array.isArray(list) ? list : []).filter(item => check(LIVE_SCHEMAS[kind], item).length === 0);

/** Does the actor hold any module data at all? */
export const hasModuleData = state => (Number.isInteger(state.counter) && state.counter > 0)
  || (state.pending?.length ?? 0) > 0 || (state.formulas?.length ?? 0) > 0 || (state.projects?.length ?? 0) > 0;

/**
 * Compare what an actor holds with what the module expects.
 * @param {{ counter: any, pending: any[], formulas: any[], projects: any[] }} state  raw flag values
 * @param {object} expected  a ledger entry (use emptyEntry for an actor with none)
 * @returns {Array<{ kind: string, message: string }>}  empty when everything matches
 */
export function compare(state, expected) {
  const mismatches = [];
  const add = (kind, message) => mismatches.push({ kind, message });
  const recent = expected.history.at(-1) ? ` (the module's last change: ${expected.history.at(-1).text})` : "";

  // Days: the TOTAL (unreserved + reserved) must equal what the module granted and spent.
  const counterOk = state.counter === undefined || (Number.isInteger(state.counter) && state.counter >= 0);
  if (!counterOk) add("invalid", `the unreserved day counter is not a whole number of at least 0 (it is ${JSON.stringify(state.counter)})`);
  const pending = Array.isArray(state.pending) ? state.pending : [];
  pending.forEach((action, i) => {
    const problems = check(LIVE_SCHEMAS.pendingAction, action);
    if (problems.length) add("invalid", `queued action #${i + 1} is invalid: ${problems.map(p => `${p.field} ${p.message}`).join("; ")}`);
  });
  if (counterOk) {
    const counter = state.counter ?? 0;
    const reserved = pendingTotal(validOnly(pending, "pendingAction"));
    if (counter + reserved !== expected.days) {
      add("days", `holds ${counter + reserved} downtime day(s) in total (${counter} unreserved + ${reserved} reserved), but the module's log expects ${expected.days}${recent}`);
    }
  }

  // Formulas.
  const formulas = new Map();
  for (const entry of Array.isArray(state.formulas) ? state.formulas : []) {
    const problems = check(LIVE_SCHEMAS.formula, entry);
    if (problems.length) add("invalid", `formula entry "${entry?.recipeId ?? "?"}" is invalid: ${problems.map(p => `${p.field} ${p.message}`).join("; ")}`);
    else formulas.set(entry.recipeId, entry.access);
  }
  for (const [recipeId, access] of formulas) {
    if (!(recipeId in expected.formulas)) add("formulaExtra", `holds the formula "${recipeId}" (${access}), which the module did not grant`);
    else if (expected.formulas[recipeId] !== access) add("formulaAccess", `holds the formula "${recipeId}" as ${access}, but the module granted it as ${expected.formulas[recipeId]}`);
  }
  for (const [recipeId, access] of Object.entries(expected.formulas)) {
    if (!formulas.has(recipeId)) add("formulaMissing", `no longer holds the formula "${recipeId}" (${access}) that the module granted`);
  }

  // Projects.
  const projects = new Map();
  for (const project of Array.isArray(state.projects) ? state.projects : []) {
    const problems = check(LIVE_SCHEMAS.project, project);
    if (problems.length) add("invalid", `project "${project?.id ?? "?"}" is invalid: ${problems.map(p => `${p.field} ${p.message}`).join("; ")}`);
    else projects.set(project.id, project);
  }
  for (const [id, project] of projects) {
    const want = expected.projects[id];
    if (!want) { add("projectUnknown", `has the project "${id}", which the module did not create`); continue; }
    const have = projectView(project);
    const changed = Object.keys(want).filter(key => want[key] !== have[key]).map(key => `${key} ${have[key]} (expected ${want[key]})`);
    if (changed.length) add("projectEdited", `project "${id}" was edited outside the module: ${changed.join(", ")}`);
  }
  for (const id of Object.keys(expected.projects)) {
    if (!projects.has(id)) add("projectMissing", `no longer has the project "${id}" that the module created`);
  }
  return mismatches;
}
