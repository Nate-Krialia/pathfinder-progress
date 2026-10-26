/**
 * Foundry-bound gathering: node tokens, the GM tools, and api.gather().
 * The rules live in the pure modules (node.js, resolve.js, ladder.js, dice.js);
 * this file reads and writes token flags and calls the PF2e adapter.
 */
import { MODULE_ID, NODE_FLAG } from "../config.js";
import * as adapter from "../adapter/pf2e.js";
import { activateRecord, makeAnchorRecord, makeCorpseRecord, makeNodeRecord, normalizeNode, refillRecord } from "./node.js";
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
 * Save a node record. setFlag MERGES objects, so when the new record has dropped
 * keys the old one had (e.g. replacing a node with an anchor) the old flag is
 * cleared first; otherwise stale keys would survive.
 */
async function writeRecord(doc, record) {
  const old = readRecord(doc);
  if (old !== undefined && Object.keys(old).some(key => !(key in record))) await doc.unsetFlag(MODULE_ID, NODE_FLAG);
  await doc.setFlag(MODULE_ID, NODE_FLAG, record);
}

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

/** Bring a node back to `charges` (default: its nodeType's) and make it active. */
export async function refillNode(api, token, charges) {
  requireGM("refillNode");
  const doc = resolveToken(token);
  const current = readRecord(doc);
  if (!current) throw new Error(`refillNode: ${doc.name} is not a node`);
  const record = failIf(refillRecord(current, charges, api.definitions), "refillNode");
  await writeRecord(doc, record);
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
  return describe(resolveToken(token), api);
}

// Gathering -----------------------------------------------------------------------------------
/** A dry run: shows DCs, your modifier and the odds, and any reason the gather would be refused. Spends nothing. */
export function previewGather(api, actor, token, skill) {
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

  // Burn the charge first, so a later failure can never leave a free attempt.
  await writeRecord(doc, { ...readRecord(doc), charges: result.chargesAfter, state: result.stateAfter });

  const materialNames = {};
  for (const gain of result.gains) {
    const material = api.definitions.material.get(gain.materialId);
    materialNames[gain.materialId] = material.name;
    await adapter.giveMaterial(actor, material, gain.quantity);
  }

  if (chat) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: formatGatherSummary({ gathererName: actor.name, node, skillName: adapter.skillLabel(picked.skill), result, materialNames })
    });
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
