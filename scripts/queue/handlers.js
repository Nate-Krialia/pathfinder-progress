/**
 * What each queued action type needs. Pure. A type is "wired" once it has an entry here AND a
 * resolver in queue/store.js. Research, explore, commission, craft and gather are wired (workshop
 * upgrades arrive in a later stage).
 *
 * validateSubmit uses only data a player's client can see (the actor's projects, public region
 * definitions; scenes only on a GM client), never the recipes, so a player can submit. Craft and gather
 * are the exception: they need the recipes and the node tokens, so they are relayed to the GM client
 * (queue/work.js) and only described here.
 */

import { EXPLORATION } from "../config.js";
import { pickSkill } from "../gathering/resolve.js";

/** Look up a project in the actor's raw projects list. */
const findProject = (projects, id) => projects.find(p => p?.id === id);

const research = {
  /** @returns {{ ok: true, params: object } | { ok: false, errors: string[] }} */
  validateSubmit({ projects, params }) {
    const project = findProject(projects, params?.projectId);
    if (!project) return { ok: false, errors: [`no project "${params?.projectId}" (projects: ${projects.map(p => p?.id).join(", ") || "none"})`] };
    if (project.outcome?.type !== "unlockFormula") return { ok: false, errors: ["only unlockFormula projects can be researched for now"] };
    if (project.status !== "active") return { ok: false, errors: [`project "${project.id}" is ${project.status}, not active`] };

    const allowed = project.skillWhitelist ?? [];
    let skill = params.skill;
    if (skill === undefined) {
      if (allowed.length !== 1) return { ok: false, errors: [`"${project.goalName}" research allows several skills (${allowed.join(", ")}); choose one with skill`] };
      skill = allowed[0];
    } else if (!allowed.includes(skill)) {
      return { ok: false, errors: [`skill "${skill}" is not allowed for "${project.goalName}" research (allowed: ${allowed.join(", ")})`] };
    }
    return { ok: true, params: { projectId: project.id, skill } };
  },

  /** A short label and detail for the review window. */
  describe({ action, projects }) {
    const project = findProject(projects, action.params?.projectId);
    if (!project) return { label: `Research: ${action.params?.projectId ?? "?"}`, detail: "project not found", problem: "the project no longer exists" };
    const detail = `${action.params.skill ?? "?"}, DC ${project.dc}, progress ${project.progress}/${project.threshold}`;
    const problem = project.status !== "active" ? `project is ${project.status}` : null;
    return { label: `Research: ${project.goalName}`, detail, problem };
  }
};

import { buildCommission, checkStep } from "../commissions/commission.js";

const pct = x => `${Math.round(x * 100)}%`;

const explore = {
  /**
   * ctx: { params, days, region, scenes } where scenes is the region's scene pool as
   * [{ name, anchors, totalAnchors }] for a GM client, or null on a player's client (players may not see scenes).
   * params: { region (or regionId), skill?, forceCombat? }; days = how many days to explore (at least the region's daysRequired).
   */
  validateSubmit({ params, days, region, scenes }) {
    if (!region) return { ok: false, errors: [`unknown region "${params?.region ?? params?.regionId}"`] };
    if (!Number.isInteger(days) || days < region.daysRequired) return { ok: false, errors: [`"${region.name}" takes at least ${region.daysRequired} day(s) to explore (got ${days})`] };
    if (days > EXPLORATION.maxDays) return { ok: false, errors: [`an expedition lasts at most ${EXPLORATION.maxDays} days (got ${days})`] };
    if (params.forceCombat !== undefined && typeof params.forceCombat !== "boolean") return { ok: false, errors: ["forceCombat must be true or false"] };
    const picked = pickSkill(region.skillWhitelist, params.skill, `"${region.name}"`, "exploration");
    if (!picked.ok) return { ok: false, errors: [picked.error] };
    if (scenes !== null && scenes !== undefined) {
      if (!scenes.length) return { ok: false, errors: [`no scene is tagged "${region.sceneTag}" for "${region.name}"; tag one with api.tagScene(scene, "${region.sceneTag}")`] };
      if (!scenes.some(s => s.totalAnchors > 0)) return { ok: false, errors: [`the scene(s) tagged "${region.sceneTag}" have no anchors; place some with api.placeAnchors`] };
    }
    return { ok: true, params: { region: region.id, skill: picked.skill, forceCombat: params.forceCombat === true } };
  },

  /** ctx: { action, info } where info comes from exploration/store.js describeInfo. */
  describe({ action, info }) {
    if (!info?.region) return { label: `Explore: ${action.params?.region ?? "?"}`, detail: "region not found", problem: "the region no longer exists" };
    const { region } = info;
    const odds = info.odds
      ? `${action.params.skill} ${info.modifier >= 0 ? "+" : ""}${info.modifier} vs DC ${region.explorationDC}: crit ${pct(info.odds.chances.criticalSuccess)} / success ${pct(info.odds.chances.success)} / fail ${pct(info.odds.chances.failure)} / crit-fail ${pct(info.odds.chances.criticalFailure)}, expect ~${(info.odds.expectedAnchors * action.daysReserved).toFixed(1)} nodes`
      : `${action.params.skill} (no modifier found) vs DC ${region.explorationDC}`;
    const force = action.params.forceCombat ? "; FORCE COMBAT" : "";
    const detail = `${odds}; ${action.daysReserved} day(s)${force}; ${info.scenes} tagged scene(s), ${info.freeAnchors} free anchor(s) of ${info.totalAnchors}`;
    const problem = !info.scenes ? `no scene is tagged "${region.sceneTag}"` : !info.totalAnchors ? "no anchors on the tagged scene(s)" : null;
    return { label: `Explore: ${region.name}`, detail, problem };
  }
};

const commission = {
  /** Commission steps cost no downtime days. */
  freeOfDays: true,

  /**
   * ctx: { params, days, actorId, isGM, commissions, formulas, crafterId } (see commissions/store.js submitContext).
   * `formulas` is the submitting character's own formula list: a patron can only offer a formula they own.
   */
  validateSubmit({ params, days, actorId, isGM, commissions, formulas, crafterId }) {
    if (days !== 0) return { ok: false, errors: [`commission steps cost no days (reserve 0, got ${days})`] };
    const step = params?.step;
    if (step === "request") {
      if (!crafterId) return { ok: false, errors: [`cannot find the crafter "${params.crafter}" (give their name or id)`] };
      const entry = formulas.find(f => f?.recipeId === params.recipe);
      if (!entry || entry.access !== "owned") return { ok: false, errors: [`you do not own the formula for "${params.recipe}"; only an owner can offer it`] };
      const slotNames = entry.snapshot?.slots?.map(s => s.name);
      const built = buildCommission({
        source: "player", patron: { type: "actor", actorId }, crafter: crafterId, recipeId: params.recipe, access: params.access,
        selection: params.selection, stationId: params.stationId, payout: params.payout, learnRoll: params.learnRoll
      }, { id: "check", now: 0, slotNames });
      if (!built.ok) return { ok: false, errors: built.errors };
      const c = built.commission;
      return { ok: true, params: { step, crafter: crafterId, recipe: c.formulaId, access: c.access, selection: c.selection, stationId: c.stationId, payout: c.payout, learnRoll: c.learnRoll } };
    }
    const found = commissions.find(c => c.id === params?.id);
    if (!found) return { ok: false, errors: [`no commission "${params?.id}"`] };
    const allowed = checkStep(found, step, actorId, isGM);
    if (!allowed.ok) return allowed;
    if (step === "accept" && params.as !== undefined && (params.as !== "loan" || found.access !== "copy")) {
      return { ok: false, errors: ['"as" can only be "loan", and only on a copy offer'] };
    }
    if (step === "craft" && !found.selection && !params.selection) {
      return { ok: false, errors: ["the crafter supplies the materials: give a selection ({ slot: materialId })"] };
    }
    return { ok: true, params: { step, id: found.id, ...(params.as ? { as: params.as } : {}), ...(params.selection ? { selection: params.selection } : {}), ...(params.station ? { station: params.station } : {}), ...(params.learnSkill ? { learnSkill: params.learnSkill } : {}) } };
  },

  /** ctx: { action, info } where info = { label, detail, problem } from commissions/store.js describeInfo. */
  describe({ action, info }) {
    return info ?? { label: `Commission ${action.params?.step ?? "?"}`, detail: "", problem: null };
  }
};

import { describeEscrow, escrowProblems } from "./escrow.js";

/** Craft and gather are queued on the GM client (queue/work.js), so there is no player-side validation here, only a description. */
const relayedOnly = type => () => ({ ok: false, errors: [`${type} actions are queued through the GM client (queue.submit relays them)`] });

const craft = {
  validateSubmit: relayedOnly("craft"),
  /** Plain description for the review window. No odds: the roll is the GM's. */
  describe({ action }) {
    const p = action.params ?? {};
    const problems = escrowProblems(action);
    return {
      label: `Craft: ${p.recipeName ?? p.recipe ?? "?"}`,
      detail: `${action.daysReserved} day(s) reserved; station ${p.stationName ?? "?"}; ${p.escrow ? `escrow: ${describeEscrow(p.escrow)}` : "no escrow record"}`,
      problem: problems[0] ?? null
    };
  }
};

const gather = {
  /** A gather costs charges, not days. */
  freeOfDays: true,
  validateSubmit: relayedOnly("gather"),
  describe({ action }) {
    const p = action.params ?? {};
    return { label: `Gather: ${p.nodeName ?? p.tokenId ?? "?"}`, detail: `${p.nodeTypeName ?? "node"}, ${p.skill ?? "?"}; 1 charge claimed, no days`, problem: null };
  }
};

export const HANDLERS = { research, explore, commission, craft, gather };
export const wiredTypes = () => Object.keys(HANDLERS);
