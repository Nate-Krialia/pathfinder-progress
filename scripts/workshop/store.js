/**
 * Foundry-bound workshop calls that run on the GM client (Stage 10c): starting an upgrade project (its higher-tier
 * materials go into escrow on the project), starting a blueprint design, and putting a project aside (the materials come
 * back). A player's call is relayed over the socket (`workshopStart`, `workshopAside`), exactly like craft and gather:
 * refusals are plain `Refusal`s, unexpected errors are logged on the GM and the player sees the generic line.
 *
 * These are immediate (not GM-approved queue items), need no downtime, and never block "End downtime". The research
 * DAYS an upgrade needs are spent later, through the ordinary research queue item.
 */
import { MODULE_ID, RESEARCH_KEYS as K } from "../config.js";
import * as adapter from "../adapter/pf2e.js";
import { commit } from "../audit/store.js";
import { check } from "../data/schema.js";
import { LIVE_SCHEMAS } from "../data/schemas.js";
import { abandonProject as abandonRecord } from "../research/project.js";
import { rawList } from "../research/store.js";
import { describeEscrow, refusalText } from "../queue/escrow.js";
import { actorKey, withLocks } from "../queue/lock.js";
import { assertOwner, callerOf, flagKey, giveBack, note, pendingOf, recordReturned, takeEscrow, undoThenThrow } from "../queue/common.js";
import { refusal } from "../queue/relay.js";
import { asGM } from "../queue/work.js";
import { mayUse, readStations } from "../stations/store.js";
import { allocateFromStacks, buildDesignProject, buildUpgradeProject, checkUpgradeMaterials, planUpgrade } from "./rules.js";
import { BLUEPRINTS_FLAG, heldDesigns, holdsDesign, withDesign } from "./targets.js";
import { playerProject } from "../difficulty.js";
import { isStudyId, keyOfStudy, pauseStudy } from "../discovery/store.js";

let boundApi = null;
/** Give the workshop calls the module api (definitions). */
export function bind(api) { boundApi = api; }

const stacksOf = actor => adapter.getMaterialStacks(actor).map(s => ({ stackId: s.item.id, materialId: s.materialId, quantity: s.quantity }));
const unitsText = materials => materials.map(m => `${m.qty}x ${boundApi.definitions.material.get(m.materialId)?.name ?? m.materialId}`).join(", ");
const checkedProject = project => {
  const problems = check(LIVE_SCHEMAS.project, project);
  if (problems.length) throw new Error(`built an invalid project: ${problems.map(p => `${p.field} ${p.message}`).join("; ")}`);
  return project;
};

/** Start an upgrade project: { stationId, kind: "tier"|"craftDays"|"hearth", materials: { materialId: units } }. */
export function startUpgrade(api, actor, params) {
  return withLocks([actorKey(actor)], async () => {
    const station = readStations(api).stations.find(s => s.id === params?.stationId);
    if (!station) throw refusal(`There is no workshop "${params?.stationId}".`);
    if (!mayUse(station, actor)) throw refusal(`${actor.name} may not use ${station.name}, so cannot upgrade it.`);
    const plan = planUpgrade(station, params.kind);
    if (!plan.ok) throw refusal(`${plan.error[0].toUpperCase()}${plan.error.slice(1)}.`);
    const projects = rawList(actor, K.projectsFlag);
    if (projects.some(p => p?.status === "active" && p.outcome?.type === "upgradeStation" && p.outcome.stationId === station.id && p.outcome.kind === plan.kind)) {
      throw refusal(`${actor.name} is already researching that upgrade for ${station.name}.`);
    }
    const stacks = stacksOf(actor);
    const checked = checkUpgradeMaterials({ selection: params.materials, targetTier: plan.targetTier, units: plan.units, stacks, materialDefs: api.definitions.material });
    if (!checked.ok) throw refusal(refusalText(checked.errors, `start this upgrade (${station.name}: ${plan.kind})`));

    const project = checkedProject(buildUpgradeProject({ station, plan, materials: checked.materials }));
    const undos = await takeEscrow(actor, allocateFromStacks(checked.materials, stacks), 0);
    try {
      await commit(actor, { [flagKey(K.projectsFlag)]: [...projects.filter(p => p?.id !== project.id), project] }, [{ type: "projectSet", project, note: "started" }]);
    } catch (error) {
      await undoThenThrow(undos, error);
    }
    await note(`upgrade started: ${project.goalName} by ${actor.name}; escrow taken: ${unitsText(checked.materials)}`);
    return project;
  });
}

/** Start designing a blueprint: { blueprint }. Research days only; building comes later. */
export function startDesign(api, actor, params) {
  return withLocks([actorKey(actor)], async () => {
    const blueprint = api.definitions?.blueprint.get(params?.blueprint);
    if (!blueprint) throw refusal(`There is no blueprint "${params?.blueprint}".`);
    if (holdsDesign(actor, blueprint.id)) throw refusal(`${actor.name} already holds the design for ${blueprint.name}.`);
    const projects = rawList(actor, K.projectsFlag);
    const project = checkedProject(buildDesignProject({ blueprint }));
    if (projects.some(p => p?.id === project.id && p.status === "active")) throw refusal(`${actor.name} is already designing ${blueprint.name}.`);
    await commit(actor, { [flagKey(K.projectsFlag)]: [...projects.filter(p => p?.id !== project.id), project] }, [{ type: "projectSet", project, note: "started" }]);
    await note(`design started: ${project.goalName} by ${actor.name}`);
    return project;
  });
}

/** Put an active project aside: escrowed materials come back exactly as they were taken. { projectId } */
export function putAside(api, actor, params) {
  return withLocks([actorKey(actor)], async () => {
    // A study (Stage 11c) is paused, not abandoned: its progress is kept.
    if (isStudyId(params?.projectId)) {
      try { return await pauseStudy(actor, keyOfStudy(params.projectId)); } catch (error) { throw refusal(error.message); }
    }
    const projects = rawList(actor, K.projectsFlag);
    const index = projects.findIndex(p => p?.id === params?.projectId);
    if (index < 0) throw refusal(`${actor.name} has no project "${params?.projectId}".`);
    const project = projects[index];
    if (project.status !== "active") throw refusal(`"${project.goalName}" is ${project.status}, not active.`);
    if (pendingOf(actor).some(a => a?.type === "research" && a.params?.projectId === project.id)) {
      throw refusal(`Cancel the queued research for "${project.goalName}" first, then put it aside.`);
    }
    const units = (project.materials ?? []).map(m => {
      const def = api.definitions?.material.get(m.materialId);
      return { materialId: m.materialId, name: def?.name, tier: def?.tier, units: m.qty };
    });
    const undos = units.length ? await giveBack(actor, units, 0) : [];
    const next = [...projects];
    next[index] = abandonRecord(project, "put aside");
    try {
      await commit(actor, { [flagKey(K.projectsFlag)]: next }, [{ type: "projectSet", project: next[index], note: "put aside" }]);
    } catch (error) {
      await undoThenThrow(undos, error);
    }
    await recordReturned(actor, units);
    await note(`project put aside: ${project.goalName} by ${actor.name}${units.length ? `; escrow returned: ${describeEscrow({ units, feeCopper: 0 })}` : ""}`);
    return { returned: units.map(u => ({ materialId: u.materialId, units: u.units })) };
  });
}

/** GM testing tool: give a character a design without the research. */
export async function grantDesign(api, actor, blueprintId) {
  if (!game.user.isGM) throw new Error("grantDesign: GM only");
  const blueprint = api.definitions?.blueprint.get(blueprintId);
  if (!blueprint) throw new Error(`grantDesign: unknown blueprint "${blueprintId}"`);
  await actor.update({ [flagKey(BLUEPRINTS_FLAG)]: withDesign(actor, blueprint, "gm") });
  return heldDesigns(actor);
}

// The relays ---------------------------------------------------------------------------------------------------------
/** On the GM client (also the socket handler): check who is asking, then start. */
export async function runWorkshopStart(payload, context) {
  const user = callerOf(payload, context);
  const actor = game.actors.get(payload?.actorId);
  if (!actor) throw refusal(`There is no character with id "${payload?.actorId}".`);
  assertOwner(actor, user, "workshop");
  if (!boundApi) throw new Error("workshop: not bound to the module api yet");
  // The GM client builds the project, then a player is handed a copy without its DC (docs/11b); a GM keeps the full record.
  const shown = project => (user.isGM ? project : playerProject(project));
  if (payload.mode === "upgrade") return shown(await startUpgrade(boundApi, actor, payload.params));
  if (payload.mode === "design") return shown(await startDesign(boundApi, actor, payload.params));
  throw refusal(`Unknown workshop request "${payload.mode}".`);
}

export async function runWorkshopAside(payload, context) {
  const user = callerOf(payload, context);
  const actor = game.actors.get(payload?.actorId);
  if (!actor) throw refusal(`There is no character with id "${payload?.actorId}".`);
  assertOwner(actor, user, "workshop");
  if (!boundApi) throw new Error("workshop: not bound to the module api yet");
  return putAside(boundApi, actor, payload.params);
}

export const relayStartUpgrade = (actor, params) => asGM("workshopStart", { actorId: actor.id, mode: "upgrade", params }, payload => runWorkshopStart(payload));
export const relayStartDesign = (actor, params) => asGM("workshopStart", { actorId: actor.id, mode: "design", params }, payload => runWorkshopStart(payload));
export const relayPutAside = (actor, projectId) => asGM("workshopAside", { actorId: actor.id, params: { projectId } }, payload => runWorkshopAside(payload));
