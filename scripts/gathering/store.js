/**
 * Foundry-bound gathering: node tokens, the GM tools, and api.gather().
 * The rules live in the pure modules (node.js, resolve.js, ladder.js, dice.js);
 * this file reads and writes token flags and calls the PF2e adapter.
 */
import { MODULE_ID, NODE_FLAG } from "../config.js";
import { forcedDeletion } from "../exploration/tokens.js";
import * as adapter from "../adapter/pf2e.js";
import { check } from "../data/schema.js";
import { LIVE_SCHEMAS } from "../data/schemas.js";
import { activateRecord, makeAnchorRecord, makeCorpseRecord, makeNodeRecord, normalizeNode } from "./node.js";
import { checkGatherable, hiddenSuccessChance, neededD20, pickSkill, resolveGather, visiblePassChance } from "./resolve.js";
import { formatGatherSummary } from "./summary.js";

const rollDie = sides => Math.floor(CONFIG.Dice.randomUniform() * sides) + 1;
const PASS = ["success", "criticalSuccess"];

const requireGM = what => { if (!game.user.isGM) throw new Error(`${what}: GM only`); };

/** Accept a TokenDocument, a canvas Token, or a token UUID. */
export function resolveToken(ref) {
  const doc = typeof ref === "string" ? fromUuidSync(ref) : (ref?.document ?? ref);
  if (doc?.documentName !== "Token") throw new Error("expected a token: pass a TokenDocument, a token from the canvas, or a token UUID");
  return doc;
}

const readRecord = doc => doc.getFlag(MODULE_ID, NODE_FLAG);
export const isNodeToken = doc => readRecord(doc) !== undefined;
/**
 * Save a node record. Refuses a record that breaks the node rules (for example
 * 0 charges while still "active"), so an inconsistent node can never be stored.
 * Foundry MERGES objects, so keys the old record had and the new one dropped (a released reservedCharges, an anchor
 * becoming a node) are deleted explicitly with ForcedDeletion, in the SAME update: never "clear the flag, then write
 * it", because a failure between the two would leave the node with no record at all.
 */
export async function saveNodeRecord(doc, record) {
  const problems = check(LIVE_SCHEMAS.node, record);
  if (problems.length) {
    throw new Error(`refusing to save an inconsistent node record for ${doc.name}: ${problems.map(p => `${p.field} ${p.message}`).join("; ")}`);
  }
  const old = readRecord(doc);
  if (old === undefined) {
    await doc.setFlag(MODULE_ID, NODE_FLAG, record);
    return;
  }
  const base = `flags.${MODULE_ID}.${NODE_FLAG}`;
  const update = Object.fromEntries(Object.entries(record).map(([key, value]) => [`${base}.${key}`, value]));
  for (const key of Object.keys(old)) if (!(key in record)) update[`${base}.${key}`] = forcedDeletion();
  await doc.update(update);
}
const writeRecord = saveNodeRecord;

function describe(doc, api) {
  const record = readRecord(doc);
  if (!record) return { ok: false, errors: [`${doc.name} is not a gathering node`] };
  return normalizeNode({ record, token: { uuid: doc.uuid, name: doc.name }, registry: api.definitions });
}

function viewOrThrow(doc, api, what) {
  const result = describe(doc, api);
  if (!result.ok) throw new Error(`${what}: ${result.errors.join("; ")}`);
  return result.node;
}

function guardFresh(doc, replace, what) {
  if (isNodeToken(doc) && !replace) throw new Error(`${what}: ${doc.name} is already a node (pass replace: true to overwrite it, or use clearNode first)`);
}

function failIf(result, what) {
  if (!result.ok) throw new Error(`${what}: ${result.errors.join("; ")}`);
  return result.record;
}

// GM tools ------------------------------------------------------------------------------------
/** Mark a token as an anchor: hidden, "a node could spawn here". */
export async function createAnchor(api, token, { replace, ...spec } = {}) {
  requireGM("createAnchor");
  const doc = resolveToken(token);
  guardFresh(doc, replace, "createAnchor");
  const record = failIf(makeAnchorRecord(spec, api.definitions), "createAnchor");
  await writeRecord(doc, record);
  await doc.update({ hidden: true });
  return record;
}

/** Make a token a ready-to-gather node. spec: { nodeType, tier, charges?, source?, region?, replace? } */
export async function createNode(api, token, { replace, ...spec } = {}) {
  requireGM("createNode");
  const doc = resolveToken(token);
  guardFresh(doc, replace, "createNode");
  const record = failIf(makeNodeRecord(spec, api.definitions), "createNode");
  await writeRecord(doc, record);
  return record;
}

/** Activate an anchor: fill it from its nodeType and unhide the token. spec: { nodeType, tier, charges?, source? } */
export async function activateNode(api, token, spec = {}) {
  requireGM("activateNode");
  const doc = resolveToken(token);
  const current = readRecord(doc);
  if (!current) throw new Error(`activateNode: ${doc.name} is not a node`);
  const record = failIf(activateRecord(current, spec, api.definitions), "activateNode");
  await writeRecord(doc, record);
  await doc.update({ hidden: false });
  return record;
}

/** Make a token a corpse node with a hand-authored ladder. spec: { tier, ladder, charges?, decayTimer, region?, replace? } */
export async function makeCorpseNode(api, token, { replace, ...spec } = {}) {
  requireGM("makeCorpseNode");
  const doc = resolveToken(token);
  guardFresh(doc, replace, "makeCorpseNode");
  const record = failIf(makeCorpseRecord(spec, api.definitions), "makeCorpseNode");
  await writeRecord(doc, record);
  return record;
}

/** Remove the node record from a token (the token itself stays). */
export async function clearNode(token) {
  requireGM("clearNode");
  await resolveToken(token).unsetFlag(MODULE_ID, NODE_FLAG);
}

/** The resolved node: type, tier, charges, and the ladder with absolute DCs. */
export function nodeInfo(api, token) {
  requireGM("nodeInfo");
  return describe(resolveToken(token), api);
}

// Gathering -----------------------------------------------------------------------------------
/**
 * Give the actor every gain, or none: if one fails, the ones already given are taken
 * back (a new stack is deleted; a topped-up stack goes back to its old quantity).
 */
export async function grantAll(actor, gains, definitions) {
  const done = [];
  try {
    for (const gain of gains) {
      const material = definitions.material.get(gain.materialId);
      const before = adapter.getMaterialStacks(actor).find(s => s.materialId === gain.materialId)?.quantity ?? 0;
      const item = await adapter.giveMaterial(actor, material, gain.quantity);
      done.push({ item, before });
    }
  } catch (error) {
    const undoFailures = [];
    for (const { item, before } of done.reverse()) {
      try {
        if (before === 0) await item.delete();
        else await item.update({ "system.quantity": before });
      } catch (undoError) {
        undoFailures.push(undoError.message);
      }
    }
    error.undoFailures = undoFailures;
    throw error;
  }
  // The caller can still take everything back if a later step fails.
  return async () => {
    for (const { item, before } of [...done].reverse()) {
      if (before === 0) await item.delete();
      else await item.update({ "system.quantity": before });
    }
  };
}

/** A dry run: shows DCs, your modifier and the odds, and any reason the gather would be refused. Spends nothing. */
export function previewGather(api, actor, token, skill) {
  requireGM("previewGather");
  const doc = resolveToken(token);
  const described = describe(doc, api);
  if (!described.ok) return { ok: false, errors: described.errors };
  const node = described.node;

  const errors = [];
  const problem = checkGatherable(node);
  if (problem) errors.push(problem);
  if (node.state === "anchor") return { ok: false, errors, node };

  const picked = pickSkill(node.skills, skill, node.nodeTypeName ?? node.nodeType);
  if (!picked.ok) errors.push(picked.error);

  const modifier = picked.ok ? adapter.getSkillModifier(actor, picked.skill) : null;
  const rungs = node.ladder.rungs.map(r => ({
    materialId: r.materialId, dc: r.dc, quantity: r.quantity, base: r.base,
    ...(modifier === null ? {} : r.base
      ? { passChance: visiblePassChance(modifier, r.dc) }
      : { neededD20: neededD20(modifier, r.dc), chance: hiddenSuccessChance(modifier, r.dc) })
  }));
  return { ok: errors.length === 0, errors, node, skill: picked.ok ? picked.skill : null, modifier, baseDc: node.ladder.baseDc, rungs };
}

/**
 * Gather from a node. GM only (hidden rolls). Spends one charge whatever happens.
 * @param {object} options
 * @param {Actor} options.actor
 * @param {TokenDocument|Token|string} options.node
 * @param {string} [options.skill]    required when the node allows several skills
 * @param {string} [options.degree]   TEST OVERRIDE: skip the roll and force a visible result
 * @param {boolean} [options.chat=true]  false skips the chat summary (for test loops)
 */
export async function gather({ actor, node: nodeRef, skill, degree: forced, chat = true }, api) {
  requireGM("gather");
  const doc = resolveToken(nodeRef);
  const node = viewOrThrow(doc, api, "gather");

  const problem = checkGatherable(node);
  if (problem) throw new Error(`gather: ${problem}`);
  const picked = pickSkill(node.skills, skill, node.nodeTypeName ?? node.nodeType);
  if (!picked.ok) throw new Error(`gather: ${picked.error}`);

  // The visible roll, against the base rung only.
  let visible, modifier;
  if (forced) {
    if (!adapter.normalizeDegree(forced)) throw new Error(`gather: unknown degree "${forced}"`);
    visible = { degree: forced, passed: PASS.includes(forced), total: null, natural: null };
    modifier = adapter.getSkillModifier(actor, picked.skill); // a forced result has no roll, so use the static modifier
  } else {
    const roll = await adapter.rollSkillCheck(actor, picked.skill, node.ladder.base.dc);
    visible = { degree: roll.degree, passed: PASS.includes(roll.degree), total: roll.total, natural: roll.natural };
    modifier = roll.modifier;
  }

  const result = resolveGather({ node, visible, modifier, d20: () => rollDie(20), die: rollDie });

  // Burn the charge first, so a crash can never leave a free attempt. Charges and
  // state are written together (and checked), so they can never disagree.
  const previous = structuredClone(readRecord(doc));
  await writeRecord(doc, { ...previous, charges: result.chargesAfter, state: result.stateAfter });

  // Grant every gain or none. A grant that fails is not a gathering attempt, so the charge is refunded.
  const materialNames = {};
  try {
    await grantAll(actor, result.gains, api.definitions);
  } catch (error) {
    let refunded = true;
    try { await writeRecord(doc, previous); } catch { refunded = false; }
    const undone = error.undoFailures?.length ? ` Some materials already given could not be taken back: ${error.undoFailures.join("; ")}.` : "";
    throw new Error(
      `gather: could not grant the materials (${error.message}). `
      + (refunded
        ? "The charge was refunded and nothing was given."
        : `The charge could NOT be refunded: ${doc.name} now has ${result.chargesAfter} charge(s); set flags.${MODULE_ID}.${NODE_FLAG}.charges back to ${previous.charges} (and state to \"${previous.state}\") on that token by hand.`)
      + undone,
      { cause: error }
    );
  }
  for (const gain of result.gains) materialNames[gain.materialId] = api.definitions.material.get(gain.materialId).name;

  if (chat) {
    try {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: formatGatherSummary({ gathererName: actor.name, node, skillName: adapter.skillLabel(picked.skill), result, materialNames })
      });
    } catch (error) {
      // The gather itself succeeded; do not lose its result over a chat failure.
      console.error(`${MODULE_ID} | gather succeeded but the chat summary failed`, error);
    }
    console.log(`${MODULE_ID} | gather (GM only: these hidden rolls are never shown to players)`, result.hidden);
  }

  return {
    ok: true, skill: picked.skill, visible, modifier,
    passed: result.passed, gains: result.gains, hidden: result.hidden,
    chargesBefore: result.chargesBefore, chargesAfter: result.chargesAfter, state: result.stateAfter
  };
}

// Hooks ----------------------------------------------------------------------------------------
/** Keep node tokens out of the combat tracker (docs/08-foundry-integration.md). */
export function registerNodeHooks() {
  Hooks.on("preCreateCombatant", (combatant, data) => {
    const scene = combatant.parent?.scene ?? game.scenes.get(data?.sceneId) ?? canvas.scene;
    const doc = scene?.tokens.get(data?.tokenId ?? combatant.tokenId);
    if (doc && isNodeToken(doc)) {
      if (game.user.isGM) ui.notifications.info(`${doc.name} is a gathering node and was kept out of combat.`);
      return false;
    }
  });
}
