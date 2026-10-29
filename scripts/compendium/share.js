/**
 * Sharing a Compendium entry with the party: a queue item of type "share" (0 days, no downtime, never blocks End
 * downtime). The player queues it (relayed to the GM client like craft and gather); the GM approves it by resolving it
 * (Resolve all handles shares) and the facts are merged into the world's shared Compendium, or rejects it and the entry
 * stays private. The owner can cancel while it waits. What is shared is a snapshot taken when it was queued.
 */
import { COMPENDIUM, MODULE_ID, QUEUE_KEYS } from "../config.js";
import { commit } from "../audit/store.js";
import { actorKey, withLocks } from "../queue/lock.js";
import { appendAction, flagKey, gmIds, note, ownerIds, pendingOf, whisper } from "../queue/common.js";
import { refusal } from "../queue/relay.js";
import { mergeShared, pickEntry } from "./entries.js";
import { experimentFactsText } from "./experiments.js";
import { mergeIntoShared, readBook, readShared } from "./store.js";

const KINDS = ["material", "creature", "region", "experiment"];
const labelOf = (kind, entry) => `${entry.name} (${kind})`;

/** One line of what an entry holds, for the review row. Facts only. */
function factsText(kind, entry) {
  if (kind === "experiment") return experimentFactsText(entry);
  if (kind === "material") return `${entry.places.length} place(s), ${entry.rungs.length} ladder rung(s)`;
  if (kind === "creature") return `${entry.yields.length} yield(s) collected`;
  return `${entry.nodeTypes.length} node type(s) found`;
}

/** On the GM client: queue a share. Refusals are plain; nothing is changed until the GM approves. */
export function submitShare(actor, params, days) {
  if (days !== undefined && days !== null && days !== 0) return Promise.reject(refusal(`share: sharing costs no days (got ${days}); leave days out`));
  const { kind, key } = params ?? {};
  if (!KINDS.includes(kind)) return Promise.reject(refusal(`share: say what to share: kind must be one of ${KINDS.join(", ")} (got ${JSON.stringify(kind)})`));
  if (typeof key !== "string" || !key) return Promise.reject(refusal("share: say which entry (its id; for a creature its key; for an experiment the recipe id)"));
  return withLocks([actorKey(actor)], async () => {
    const entry = pickEntry(readBook(actor), kind, key);
    if (!entry) throw refusal(`${actor.name} has not discovered that yet, so there is nothing to share.`);
    if (pendingOf(actor).some(a => a?.type === "share" && a.params?.kind === kind && a.params?.key === key)) {
      throw refusal(`${entry.name} is already waiting for the GM to approve sharing it.`);
    }
    const shared = readShared();
    if (JSON.stringify(mergeShared(shared, kind, entry)) === JSON.stringify(shared)) throw refusal(`Everything ${actor.name} knows about ${entry.name} is already shared with the party.`);
    const action = {
      id: foundry.utils.randomID(), type: "share", daysReserved: 0, submittedAt: Date.now(),
      params: { kind, key, name: entry.name, entry }
    };
    await appendAction(actor, action);
    await note(`queued share: ${labelOf(kind, entry)} from ${actor.name}`);
    return action;
  });
}

/** Review-window text for a queued share (the facts, never anything hidden). */
export function describeShare(action) {
  const p = action.params ?? {};
  return {
    label: `Share: ${p.name ?? p.key ?? "?"} (${p.kind ?? "?"})`,
    detail: `${p.entry ? factsText(p.kind, p.entry) : "no facts recorded"}; no days, no downtime needed; approve to share with the party`,
    problem: p.entry ? null : "this share has no entry attached"
  };
}

/** The GM approves (resolves) a share: merge the facts into the shared Compendium, then drop the item. Caller holds the actor lock. */
export async function resolveShare(api, actor, action, pending, { chat }) {
  const { kind, entry, name } = action.params;
  const before = structuredClone(game.settings.get(MODULE_ID, COMPENDIUM.sharedSetting));   // the exact stored value, so a failed approve puts back exactly that
  const changed = await mergeIntoShared(kind, entry);
  try {
    await commit(actor, { [flagKey(QUEUE_KEYS.pendingFlag)]: pending.filter(a => a.id !== action.id) });
  } catch (error) {
    if (changed) await game.settings.set(MODULE_ID, COMPENDIUM.sharedSetting, before).catch(restoreError => console.error(`${MODULE_ID} | the share failed AND the shared Compendium could not be put back`, restoreError));
    throw error;
  }
  await note(`share approved: ${labelOf(kind, entry)} from ${actor.name}${changed ? "" : " (nothing new to add)"}`);
  if (chat) await whisper([...new Set([...ownerIds(actor), ...gmIds()])], `<p>The GM shared <strong>${name}</strong> (${kind}) with the party.</p>`);
  return { status: "resolved", daysSpent: 0, message: `approved: ${labelOf(kind, entry)} is now shared with the party${changed ? "" : " (nothing new)"}.` };
}
