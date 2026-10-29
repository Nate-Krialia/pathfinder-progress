/**
 * BUILD YOUR OWN WORKSHOP (Stage 10c): a queue item of type "build". The builder must hold the design (researched
 * first), then queues the build from real materials PLUS gold; they are taken (escrowed) when it is queued, exactly like a
 * craft, and the days are reserved. There is NO roll: when the GM resolves it, the escrow is converted and a party-owned
 * workshop appears at the party's CURRENT town, fixed there. If the party is no longer in that town (or the design or
 * blueprint is gone) the item is "invalid" and everything is returned, like a craft whose station moved.
 * A build spends days, so it BLOCKS "End downtime".
 */
import { MODULE_ID, QUEUE_KEYS, RESEARCH_KEYS as K } from "../config.js";
import * as adapter from "../adapter/pf2e.js";
import { commit } from "../audit/store.js";
import { gpText } from "../commissions/commission.js";
import * as downtime from "../downtime/store.js";
import { daysFrom } from "../research/days.js";
import { describeEscrow, escrowFromPlan, escrowProblems, refusalText } from "../queue/escrow.js";
import { actorKey, withLocks } from "../queue/lock.js";
import { appendAction, flagKey, gmIds, note, ownerIds, undoThenThrow, takeEscrow, whisper } from "../queue/common.js";
import { refusal } from "../queue/relay.js";
import { planSubmit } from "../queue/reservation.js";
import { addPartyStation, partyTown } from "../stations/store.js";
import { planBuild } from "./rules.js";
import { holdsDesign } from "./targets.js";

const stacksOf = actor => adapter.getMaterialStacks(actor).map(s => ({ stackId: s.item.id, materialId: s.materialId, quantity: s.quantity }));

/** On the GM client: queue a build. { blueprint, selection: { slot: materialId } }. Refusals are plain and change nothing. */
export function submitBuild(api, actor, user, params, days) {
  return withLocks([actorKey(actor)], async () => {
    const gate = downtime.gateReason(actor);
    if (gate) {
      if (!user.isGM) throw refusal(gate);
      await downtime.noteOverride(actor, "queued a build");
    }
    const blueprint = api.definitions?.blueprint.get(params?.blueprint);
    if (!blueprint) throw refusal(`There is no blueprint "${params?.blueprint}".`);
    if (!holdsDesign(actor, blueprint.id)) throw refusal(`${actor.name} has not designed ${blueprint.name} yet: research the design first.`);
    const town = partyTown();
    if (!town) throw refusal("The party's location is not set, so there is nowhere to build. Ask the GM to set where the party is.");
    const townName = api.definitions.town.get(town)?.name ?? town;
    if (days !== undefined && days !== null && days !== 0 && days !== blueprint.buildDays) {
      throw refusal(`build: this build takes ${blueprint.buildDays} day(s) (got ${days}); the time is set by the blueprint, leave days out`);
    }
    const planned = planBuild({ blueprint, selection: params.selection, stacks: stacksOf(actor), materialDefs: api.definitions.material });
    if (!planned.ok) throw refusal(refusalText(planned.errors, `queue this build (${blueprint.name})`));

    const counter = actor.getFlag(MODULE_ID, K.daysFlag);
    const reserved = planSubmit(counter, blueprint.buildDays);
    if (!reserved.ok) throw refusal(`Not enough free downtime days: this build takes ${blueprint.buildDays} and ${actor.name} has ${daysFrom(counter)} free.`);

    const { escrow, byStack } = escrowFromPlan({ plan: { fee: blueprint.gold, station: null, uses: planned.uses }, days: blueprint.buildDays, tierOf: id => api.definitions.material.get(id)?.tier });
    if (adapter.getCopper(actor) < escrow.feeCopper) throw refusal(`${actor.name} cannot afford the ${gpText(escrow.feeCopper)} the build costs (has ${gpText(adapter.getCopper(actor))}).`);

    const action = {
      id: foundry.utils.randomID(), type: "build", daysReserved: blueprint.buildDays, submittedAt: Date.now(),
      params: { blueprint: blueprint.id, blueprintName: blueprint.name, selection: { ...params.selection }, town, townName, escrow }
    };
    const undos = await takeEscrow(actor, byStack, escrow.feeCopper);
    try {
      await appendAction(actor, action, { [flagKey(K.daysFlag)]: reserved.counter });
    } catch (error) {
      await undoThenThrow(undos, error);
    }
    await note(`queued build: ${blueprint.name} in ${townName} for ${actor.name}; escrow taken: ${describeEscrow(escrow)}; ${blueprint.buildDays} day(s) reserved`);
    return action;
  });
}

/** The review-window text for a queued build. */
export function describeBuild(action) {
  const p = action.params ?? {};
  const problems = escrowProblems(action);
  return {
    label: `Build: ${p.blueprintName ?? p.blueprint ?? "?"}`,
    detail: `${action.daysReserved} day(s) reserved; to be built in ${p.townName ?? p.town ?? "?"}; ${p.escrow ? `escrow: ${describeEscrow(p.escrow)}` : "no escrow record"}`,
    problem: problems[0] ?? null
  };
}

/**
 * The GM resolves a build. No roll. If the design, the blueprint or the party's location no longer fit, it is invalid and
 * `drop` (work.js dropAction) returns everything. Otherwise the party workshop is created (with an undo if the actor's
 * commit then fails) and the days are spent; the materials and gold were taken when it was queued and are not taken again.
 */
export async function resolveBuild(api, actor, action, pending, { chat }, drop) {
  const problems = escrowProblems(action);
  if (problems.length) throw new Error(`the escrow on this build is damaged (${problems.join("; ")}); reject it to try to return what is left`);
  const { blueprint: blueprintId, blueprintName, town, townName, escrow } = action.params;
  const blueprint = api.definitions?.blueprint.get(blueprintId);
  if (!blueprint) return drop(actor, action, pending, `The blueprint "${blueprintName ?? blueprintId}" no longer exists`);
  if (!holdsDesign(actor, blueprintId)) return drop(actor, action, pending, `${actor.name} no longer holds the design for ${blueprint.name}`);
  if (!api.definitions.town.has(town)) return drop(actor, action, pending, `The town "${townName ?? town}" no longer exists`);
  const here = partyTown();
  if (here !== town) return drop(actor, action, pending, `The party is no longer in ${townName ?? town} (it is in ${here ? (api.definitions.town.get(here)?.name ?? here) : "nowhere in particular"})`);

  const record = {
    id: `party-${blueprint.id}-${foundry.utils.randomID(6).toLowerCase()}`,
    name: blueprint.name, category: blueprint.category, tier: blueprint.tier, town,
    builtBy: actor.id, blueprintId: blueprint.id, builtAt: Date.now()
  };
  const undoStation = await addPartyStation(record);
  try {
    await commit(actor, { [flagKey(QUEUE_KEYS.pendingFlag)]: pending.filter(a => a.id !== action.id) },
      [{ type: "days", delta: -action.daysReserved, note: `build: ${blueprint.name}` }]);
  } catch (error) {
    await undoStation();
    throw error;
  }
  await note(`resolved build: ${blueprint.name} built in ${townName ?? town} for the party by ${actor.name}; ${describeEscrow(escrow)} and ${action.daysReserved} day(s) spent; station ${record.id}`);
  if (chat) await whisper([...new Set([...ownerIds(actor), ...gmIds()])], `<p><strong>${actor.name}</strong> built <em>${blueprint.name}</em> in ${townName ?? town}: a workshop the whole party can use, with no station fee.</p>`);
  return { status: "resolved", daysSpent: action.daysReserved, message: `built "${blueprint.name}" in ${townName ?? town} for the party (station ${record.id}); ${describeEscrow(escrow)} and ${action.daysReserved} day(s) spent.` };
}
