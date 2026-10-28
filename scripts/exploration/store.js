/**
 * Foundry-bound exploration: scene tags, anchors and node tokens, the shared Resource Node actor,
 * and the two halves of an expedition (planRun: roll and plan, writes nothing; applyPlan: write
 * the scene and return an undo). The rules live in plan.js, tokens.js and summary.js; the queue
 * (queue/store.js) decides when an expedition runs and commits the actor.
 *
 * Preparing a scene NEVER launches or activates it.
 */
import { EXPLORATION, MODULE_ID, NODE_ACTOR, NODE_FLAG } from "../config.js";
import * as adapter from "../adapter/pf2e.js";
import { loadDefinitions } from "../data/validate.js";
import { DEFINITION_KINDS } from "../data/schemas.js";
import { makeAnchorRecord, makeNodeRecord } from "../gathering/node.js";
import { pickSkill } from "../gathering/resolve.js";
import { isNodeToken, saveNodeRecord } from "../gathering/store.js";
import { exploreOdds, planExpedition, simulateExpeditions } from "./plan.js";
import { activationUpdate, anchorTokenData, nodeTokenData, randomPositions, revertUpdate } from "./tokens.js";
import { formatGmSummary, formatPublicSummary } from "./summary.js";

/** A request that can never succeed as stated (the region no longer exists, the skill is not allowed). The queue refunds these. */
export class ExploreRefused extends Error {}

const requireGM = what => { if (!game.user.isGM) throw new Error(`${what}: GM only`); };
const rng = () => CONFIG.Dice.randomUniform();
const readRecord = doc => doc.getFlag(MODULE_ID, NODE_FLAG);
const listOf = value => (Array.isArray(value) ? value : []);

// Scenes --------------------------------------------------------------------------------------------
function sceneOf(ref) {
  const scene = ref === undefined ? globalThis.canvas?.scene : typeof ref === "string" ? (game.scenes.get(ref) ?? game.scenes.getName(ref)) : ref;
  if (!scene?.tokens) throw new Error(`no scene found${typeof ref === "string" ? ` for "${ref}"` : " (open a scene, or pass one)"}`);
  return scene;
}

const tagsOf = scene => listOf(scene.getFlag(MODULE_ID, EXPLORATION.sceneTagsFlag));

export async function tagScene(scene, tag) {
  requireGM("tagScene");
  if (typeof tag !== "string" || !tag.trim()) throw new Error("tagScene: give the tag as text, e.g. api.tagScene(scene, \"oak-wood\")");
  const doc = sceneOf(scene);
  await doc.setFlag(MODULE_ID, EXPLORATION.sceneTagsFlag, [...new Set([...tagsOf(doc), tag.trim()])]);
  return tagsOf(doc);
}

export async function untagScene(scene, tag) {
  requireGM("untagScene");
  const doc = sceneOf(scene);
  const next = tagsOf(doc).filter(t => t !== tag);
  if (next.length) await doc.setFlag(MODULE_ID, EXPLORATION.sceneTagsFlag, next);
  else await doc.unsetFlag(MODULE_ID, EXPLORATION.sceneTagsFlag);
  return next;
}

/** The free anchors on a scene: [{ id, name, record, doc }]. */
function freeAnchors(scene) {
  return [...scene.tokens].map(doc => ({ doc, record: readRecord(doc) }))
    .filter(({ record }) => record?.state === "anchor")
    .map(({ doc, record }) => ({ id: doc.id, name: doc.name, record, doc }));
}

/** Every scene tagged with the region's tag, with its free anchors. */
export function poolFor(region) {
  return [...game.scenes].filter(scene => tagsOf(scene).includes(region.sceneTag)).map(scene => ({
    id: scene.id, name: scene.name, anchors: freeAnchors(scene), preparedCount: listOf(scene.getFlag(MODULE_ID, EXPLORATION.preparedFlag)).length
  }));
}

/** The scenes tagged for a region, with how many free anchors each has. */
export function scenesFor(api, regionId) {
  const region = api.definitions?.region.get(regionId);
  if (!region) throw new Error(`scenesFor: unknown region "${regionId}" (known: ${[...(api.definitions?.region.keys() ?? [])].join(", ") || "none"})`);
  return poolFor(region).map(s => ({ id: s.id, name: s.name, freeAnchors: s.anchors.length, timesPrepared: s.preparedCount }));
}

// Resource Node actor ---------------------------------------------------------------------------------
/** The shared neutral actor all node tokens are made from. Created (or recreated) on demand. GM only. */
export async function ensureNodeActor() {
  requireGM("ensureNodeActor");
  const remembered = game.settings.get(MODULE_ID, NODE_ACTOR.setting) || "";
  let actor = remembered ? game.actors.get(remembered) : null;
  if (actor && adapter.isNodeActor(actor, MODULE_ID, NODE_ACTOR.flag)) return actor;
  actor = adapter.findNodeActor(game.actors, MODULE_ID, NODE_ACTOR.flag);
  if (!actor) {
    actor = await adapter.createNodeActor(adapter.nodeActorData({ name: NODE_ACTOR.name, img: NODE_ACTOR.img, flagScope: MODULE_ID, flagKey: NODE_ACTOR.flag }));
    // Foundry/PF2e can rewrite defaults during creation: read the saved actor back and correct it.
    const repair = adapter.nodeActorRepair(actor);
    if (repair) {
      await actor.update(repair.update);
      if (adapter.nodeActorRepair(actor)) throw new Error(`ensureNodeActor: could not set the "${NODE_ACTOR.name}" actor's safe defaults (${repair.problems.join("; ")}); fix its ownership and token link by hand`);
      ui.notifications.info(`${MODULE_ID}: corrected the new "${NODE_ACTOR.name}" actor's defaults (${repair.problems.join("; ")}).`);
    }
    ui.notifications[remembered ? "warn" : "info"](remembered
      ? `${MODULE_ID}: the "${NODE_ACTOR.name}" actor was deleted, so it was created again. Node tokens placed before keep their node data.`
      : `${MODULE_ID}: created the "${NODE_ACTOR.name}" actor that node tokens are made from.`);
  }
  if (actor.id !== remembered) await game.settings.set(MODULE_ID, NODE_ACTOR.setting, actor.id);
  return actor;
}

const tokenObject = async (actor, data) => (await actor.getTokenDocument(data)).toObject();

// Placing tokens ---------------------------------------------------------------------------------------
function sceneArea(scene) {
  const d = scene.dimensions;
  return { x: d.sceneX, y: d.sceneY, width: d.sceneWidth, height: d.sceneHeight };
}

/** Drop one hidden anchor. spec: { x?, y?, region? } (default: the middle of the scene). */
export async function placeAnchor(api, scene, { x, y, region } = {}) {
  requireGM("placeAnchor");
  const doc = sceneOf(scene);
  const area = sceneArea(doc);
  const made = makeAnchorRecord({ source: "placed", region }, api.definitions);
  if (!made.ok) throw new Error(`placeAnchor: ${made.errors.join("; ")}`);
  const actor = await ensureNodeActor();
  const data = await tokenObject(actor, anchorTokenData({ x: x ?? area.x + area.width / 2, y: y ?? area.y + area.height / 2, record: made.record }));
  const [token] = await doc.createEmbeddedDocuments("Token", [data]);
  return token;
}

/** Drop `n` hidden anchors at random free grid squares. Returns the tokens made. */
export async function placeAnchors(api, n, { scene, region } = {}) {
  requireGM("placeAnchors");
  if (!Number.isInteger(n) || n < 1) throw new Error(`placeAnchors: n must be a whole number of at least 1 (got ${n})`);
  const doc = sceneOf(scene);
  const positions = randomPositions(n, { area: sceneArea(doc), gridSize: doc.grid.size, occupied: [...doc.tokens].map(t => ({ x: t.x, y: t.y })), rng });
  if (!positions.length) throw new Error("placeAnchors: the scene has no free grid squares to place anchors on");
  const made = makeAnchorRecord({ source: "placed", region }, api.definitions);
  if (!made.ok) throw new Error(`placeAnchors: ${made.errors.join("; ")}`);
  const actor = await ensureNodeActor();
  const data = await Promise.all(positions.map(p => tokenObject(actor, anchorTokenData({ ...p, record: structuredClone(made.record) }))));
  const tokens = await doc.createEmbeddedDocuments("Token", data);
  if (positions.length < n) ui.notifications.warn(`${MODULE_ID}: placed ${positions.length} of ${n} anchors (the scene ran out of free squares).`);
  return tokens;
}

/** Drop a ready-to-gather node. spec: { nodeType, tier, x?, y?, charges?, region? } */
export async function placeNode(api, scene, { nodeType: typeId, tier, x, y, charges, region } = {}) {
  requireGM("placeNode");
  const doc = sceneOf(scene);
  const area = sceneArea(doc);
  const type = api.definitions?.nodeType.get(typeId);
  const made = makeNodeRecord({ source: "placed", nodeType: typeId, tier, charges, region }, api.definitions);
  if (!made.ok) throw new Error(`placeNode: ${made.errors.join("; ")}`);
  const actor = await ensureNodeActor();
  const data = await tokenObject(actor, nodeTokenData({ x: x ?? area.x + area.width / 2, y: y ?? area.y + area.height / 2, record: made.record, nodeType: type }));
  const [token] = await doc.createEmbeddedDocuments("Token", [data]);
  return token;
}

/** The node tokens on a scene. By default only anchors; { all: true } includes active and depleted nodes. */
export function listAnchors(scene, { all = false } = {}) {
  const doc = sceneOf(scene);
  return [...doc.tokens].map(t => ({ t, record: readRecord(t) })).filter(({ record }) => record && (all || record.state === "anchor"))
    .map(({ t, record }) => ({
      id: t.id, name: t.name, state: record.state, source: record.source, nodeType: record.nodeType ?? null, tier: record.tier ?? null,
      charges: record.charges ?? null, region: record.region ?? null, x: t.x, y: t.y, hidden: t.hidden
    }));
}

/** Delete this scene's anchors (anchor-state tokens only). Needs { confirm: true }. */
export async function clearAnchors(scene, { confirm } = {}) {
  requireGM("clearAnchors");
  const doc = sceneOf(scene);
  const ids = freeAnchors(doc).map(a => a.id);
  if (confirm !== true) throw new Error(`clearAnchors: this would delete ${ids.length} anchor token(s) from "${doc.name}". Run it again with { confirm: true } to go ahead.`);
  if (ids.length) await doc.deleteEmbeddedDocuments("Token", ids);
  return ids.length;
}

/** Turn explored nodes back into hidden anchors and forget the scene's prepared history. Returns how many were reset. */
export async function resetScene(api, scene) {
  requireGM("resetScene");
  const doc = sceneOf(scene);
  let count = 0;
  for (const token of [...doc.tokens]) {
    const record = readRecord(token);
    if (!record || record.source !== "explored") continue;
    const made = makeAnchorRecord({ source: "placed", region: record.region }, api.definitions);
    if (!made.ok) throw new Error(`resetScene: ${made.errors.join("; ")}`);
    await saveNodeRecord(token, made.record);
    await token.update({ hidden: true, name: EXPLORATION.anchorName, "texture.src": EXPLORATION.anchorImg });
    count++;
  }
  await doc.unsetFlag(MODULE_ID, EXPLORATION.preparedFlag);
  return count;
}

// Odds and simulation --------------------------------------------------------------------------------------
/** Before queueing: the DC, your modifier, the odds, the expected node count, and the scenes (GM only sees scenes). */
export function previewExplore(api, actor, regionId, skill) {
  const region = api.definitions?.region.get(regionId);
  if (!region) throw new Error(`previewExplore: unknown region "${regionId}" (known: ${[...(api.definitions?.region.keys() ?? [])].join(", ") || "none"})`);
  const skills = skill ? [skill] : region.skillWhitelist;
  const perSkill = skills.map(slug => {
    if (!region.skillWhitelist.includes(slug)) return { skill: slug, modifier: null, problem: `not allowed here (allowed: ${region.skillWhitelist.join(", ")})` };
    let modifier = null;
    try { modifier = adapter.getSkillModifier(actor, slug); } catch { /* the actor lacks this skill */ }
    return modifier === null ? { skill: slug, modifier: null } : { skill: slug, modifier, ...exploreOdds(modifier, region.explorationDC) };
  });
  return {
    region: { id: region.id, name: region.name, dc: region.explorationDC, days: region.daysRequired },
    perSkill,
    scenes: game.user.isGM ? scenesFor(api, regionId) : null
  };
}

/** Simulate many expeditions (no scene, no writes) and compare observed numbers with expected. */
export function simulateExplore(api, { region: regionId, runs = 5000, degree, modifier } = {}) {
  const region = api.definitions?.region.get(regionId);
  if (!region) throw new Error(`simulateExplore: unknown region "${regionId}"`);
  return simulateExpeditions({ region, runs, degree, modifier, rng });
}

/** Check a definition against the loaded ones WITHOUT loading it. Returns the problems found in it. */
export function checkDefinition(api, record) {
  const page = data => "```json\n" + JSON.stringify(data) + "\n```";
  const sources = DEFINITION_KINDS.flatMap(kind => [...(api.definitions?.[kind].values() ?? [])].map(d => ({ pack: "loaded", entry: d.id, text: page(d) })));
  const { errors } = loadDefinitions([...sources, { pack: "console", entry: record?.id ?? "(candidate)", text: page(record) }]);
  return errors.filter(e => e.pack === "console").map(e => `${e.field} ${e.message}`);
}

// The expedition ---------------------------------------------------------------------------------------------
/** What the review window needs to describe an explore action. */
export function describeInfo(api, actor, action) {
  const region = api.definitions?.region.get(action.params?.region);
  if (!region) return { region: null };
  let modifier = null;
  try { modifier = adapter.getSkillModifier(actor, action.params.skill); } catch { /* the actor lacks this skill */ }
  const odds = modifier === null ? null : exploreOdds(modifier, region.explorationDC);
  const pool = poolFor(region);
  return { region, skill: action.params.skill, modifier, odds, scenes: pool.length, freeAnchors: pool.reduce((n, s) => n + s.anchors.length, 0) };
}

/**
 * Roll the check and plan the expedition. Writes nothing. Throws ExploreRefused when the request can
 * never succeed (region gone, skill not allowed); any other Error leaves the action queued for a Retry.
 * @param {{ degree?: string }} options  degree: TEST OVERRIDE for the check
 */
export async function planRun(api, actor, action, { degree } = {}) {
  const region = api.definitions?.region.get(action.params?.region);
  if (!region) throw new ExploreRefused(`region "${action.params?.region}" no longer exists`);
  const picked = pickSkill(region.skillWhitelist, action.params.skill, `"${region.name}"`, "exploration");
  if (!picked.ok) throw new ExploreRefused(picked.error);

  let roll;
  if (degree !== undefined) {
    const forced = adapter.normalizeDegree(degree);
    if (!forced) throw new Error(`unknown degree "${degree}"`);
    roll = { degree: forced, natural: null, total: null };
  } else {
    roll = await adapter.rollSkillCheck(actor, picked.skill, region.explorationDC, { createMessage: false });
  }

  const result = planExpedition({ region, registry: api.definitions, degree: roll.degree, scenes: poolFor(region), rng });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return { region, skill: picked.skill, roll, plan: result.plan };
}

/**
 * Write the plan to the scene: the activated tokens in ONE batched update, then the scene's
 * prepared log. Returns an async undo() that puts everything back. If the log write fails the
 * tokens are reverted before the error propagates.
 */
export async function applyPlan(api, actor, run) {
  const scene = sceneOf(run.plan.scene.id);
  const before = [];
  const updates = [];
  for (const act of run.plan.activations) {
    const token = scene.tokens.get(act.tokenId);
    const record = readRecord(token);
    if (record?.state !== "anchor") throw new Error(`anchor "${act.tokenId}" on ${scene.name} is no longer a free anchor; try again`);
    before.push({ tokenId: act.tokenId, before: { hidden: token.hidden, name: token.name, img: token.texture.src, record: structuredClone(record), addedKeys: Object.keys(act.record).filter(k => !(k in record)) } });
    updates.push(activationUpdate({ tokenId: act.tokenId, record: act.record, nodeType: api.definitions.nodeType.get(act.nodeType), currentName: token.name }));
  }
  const revertTokens = () => scene.updateEmbeddedDocuments("Token", before.map(revertUpdate));
  await scene.updateEmbeddedDocuments("Token", updates);

  const previous = listOf(scene.getFlag(MODULE_ID, EXPLORATION.preparedFlag));
  const entry = { at: Date.now(), actorId: actor.id, actorName: actor.name, region: run.region.id, degree: run.plan.degree, rolled: run.plan.rolled, nodes: run.plan.activations.length };
  try {
    await scene.setFlag(MODULE_ID, EXPLORATION.preparedFlag, [...previous, entry].slice(-EXPLORATION.preparedLogMax));
  } catch (error) {
    await revertTokens();
    throw error;
  }
  return async function undo() {
    await revertTokens();
    if (previous.length) await scene.setFlag(MODULE_ID, EXPLORATION.preparedFlag, previous);
    else await scene.unsetFlag(MODULE_ID, EXPLORATION.preparedFlag);
  };
}

/** Post the public flavour line and the GM-only details. A chat failure never undoes the expedition. */
export async function postExploreChat(api, actor, run, days) {
  const scene = sceneOf(run.plan.scene.id);
  const nodes = run.plan.activations.map(a => ({ name: api.definitions.nodeType.get(a.nodeType).name, nodeType: a.nodeType, tier: a.tier }));
  try {
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: formatPublicSummary({ actorName: actor.name, regionName: run.region.name, degree: run.plan.degree, days }) });
    await ChatMessage.create({
      whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
      content: formatGmSummary({ actorName: actor.name, regionName: run.region.name, plan: run.plan, skillName: adapter.skillLabel(run.skill), natural: run.roll.natural, total: run.roll.total, dc: run.region.explorationDC, nodes })
    });
  } catch (error) {
    console.error(`${MODULE_ID} | the expedition was prepared on "${scene.name}", but the chat message failed`, error);
  }
}
