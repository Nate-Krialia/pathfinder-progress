/**
 * The ONE place that reads PF2e 8.6.1's chat-message shapes for effects that act on a target, and the ONE place that rolls the target's save and puts a condition on it
 * (Stage 11d, v0.22.0). If PF2e changes a message shape, this file is the only one to fix; a message it cannot read degrades to the fallback card, never to silence.
 * The shapes below are what the real-Foundry probe found (docs/probes/11d-targets-probe.md, Results 2026-11-01):
 *   attack roll    flags.pf2e.context = { type:"attack-roll", outcome, target:{ token, actor }, origin:{ actor, token } }, flags.pf2e.origin = { actor, uuid, type }.
 *                  context.target is only the FIRST target; message.author.targets (read on the GM client) holds all of them.
 *   damage roll    context.type "damage-roll": NEVER a trigger.
 *   consumable use a first card with ONLY flags.pf2e.origin { actor, uuid, type:"consumable" } (no context); a second card follows when Use is pressed on it.
 *   origin.uuid    is "Actor.<worldActorId>.Item.<id>": for an unlinked token that is not the token's item, so resolve it through context.origin.token first.
 * Foundry-bound, so exercised by the fake in the tests and by the real-Foundry gate (docs/21).
 */
import { EFFECTS, MODULE_ID } from "../config.js";
import { normalizeDegree, readNaturalD20 } from "./pf2e.js";

const itemIdOf = uuid => (/\.Item\.([A-Za-z0-9]+)$/.exec(String(uuid ?? "")) ?? [])[1] ?? null;

/**
 * A PF2e chat message as a neutral event, or { kind: "none" } when it is not an item message. Never throws.
 * kind: "attack" | "damage" | "consumable" | "other" | "none".
 */
export function readMessage(message) {
  try {
    const pf2e = message?.flags?.pf2e;
    const origin = pf2e?.origin, context = pf2e?.context;
    if (!origin?.uuid && !context) return { kind: "none" };
    const base = { messageId: message.id, originUuid: origin?.uuid ?? null, originType: origin?.type ?? null, itemId: itemIdOf(origin?.uuid), tokenUuid: context?.origin?.token ?? null, outcome: context?.outcome ?? null };
    if (context?.type === "attack-roll") return { ...base, kind: "attack", targetTokenUuid: context.target?.token ?? null };
    if (context?.type === "damage-roll") return { ...base, kind: "damage" };
    if (!context && origin?.type === "consumable") return { ...base, kind: "consumable" };
    return { ...base, kind: origin?.uuid ? "other" : "none" };
  } catch {
    return { kind: "other", messageId: message?.id ?? null, originUuid: null, itemId: null, tokenUuid: null, outcome: null };
  }
}

/** Every token the roller has targeted, as seen from the GM's client (message.author.targets), as token UUIDs. */
export function authorTargets(message) {
  try { return [...(message?.author?.targets ?? [])].map(t => t.document?.uuid ?? t.uuid).filter(Boolean); } catch { return []; }
}

/** The GM's own targets, else the tokens the GM has selected: the fallback card's target. */
export function gmPicks() {
  const targeted = [...(game.user?.targets ?? [])].map(t => t.document?.uuid ?? t.uuid).filter(Boolean);
  if (targeted.length) return targeted;
  return (globalThis.canvas?.tokens?.controlled ?? []).map(t => t.document?.uuid ?? t.uuid).filter(Boolean);
}

/** The item a message is about: through the token's actor first (an unlinked token's synthetic actor), then the origin UUID, then message.item. */
export async function resolveItem(event, message) {
  try {
    if (event.tokenUuid && event.itemId) {
      const tokenDoc = await fromUuid(event.tokenUuid);
      const item = tokenDoc?.actor?.items?.get?.(event.itemId);
      if (item) return item;
    }
    if (event.originUuid) { const item = await fromUuid(event.originUuid); if (item) return item; }
  } catch { /* fall through */ }
  return message?.item ?? null;
}
export const itemByUuid = async uuid => (uuid ? fromUuid(uuid) : null);

/** The crafted-item flag ({ recipeId, materials, ... }) on an item, or null. */
export const craftedFlag = item => item?.getFlag?.(MODULE_ID, EFFECTS.craftedFlag) ?? null;

/** A token UUID as { uuid, name, actor } (the TARGET TOKEN's actor, never the world actor). */
export async function tokenInfo(uuid) {
  try {
    const doc = await fromUuid(uuid);
    return doc?.actor ? { uuid, name: doc.name ?? doc.actor.name, actor: doc.actor } : null;
  } catch { return null; }
}

/** Roll a saving throw for `actor` against `dc`, without a chat card. Returns { degree, total, natural }. */
export async function rollSave(actor, type, dc) {
  const save = actor?.saves?.[type];
  if (!save?.check?.roll) throw new Error(`adapter.rollSave: ${actor?.name ?? "the target"} has no "${type}" save (PF2e API changed?)`);
  const result = await save.check.roll({ dc: { value: dc }, skipDialog: true, createMessage: false });
  const degree = normalizeDegree(result?.options?.degreeOfSuccess ?? result?.degreeOfSuccess);
  if (!degree) throw new Error("adapter.rollSave: could not read the degree of success from PF2e's roll result");
  return { degree, total: result.total, natural: readNaturalD20(result) };
}

/** The condition's current value on the actor: null = not there, 0 = there without a value (valueless), n = valued. */
export function conditionValue(actor, slug) {
  const c = actor?.getCondition?.(slug);
  return c ? (c.value ?? 0) : null;
}

/**
 * Put a condition on an actor. A valued one is raised to `value` (never stacked: increaseCondition ADDS to the existing value, so only the difference is added, with a cap).
 * A valueless one is added if it is not there. Returns { changed, to }.
 */
export async function applyCondition(actor, slug, value, max = EFFECTS.maxValue) {
  const now = conditionValue(actor, slug);
  if (value === null || value === undefined) {
    if (now !== null) return { changed: false, to: null };
    await actor.increaseCondition(slug);
    return { changed: true, to: null };
  }
  const want = Math.min(value, max), have = now ?? 0;
  if (want <= have) return { changed: false, to: have };
  await actor.increaseCondition(slug, { value: want - have, max });
  return { changed: true, to: want };
}

/** Take a condition off an actor entirely. */
export async function removeCondition(actor, slug) {
  if (conditionValue(actor, slug) === null) return false;
  await actor.decreaseCondition(slug, { forceRemove: true });
  return true;
}
