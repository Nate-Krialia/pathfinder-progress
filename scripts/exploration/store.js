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
import { exploreOdds, planExpedition, rollEncounter, simulateExpeditions } from "./plan.js";
import { anchorTokenData, nodeTokenData, occupyUpdate, randomPositions, revealUpdate, unrevealUpdate, vacateUpdate } from "./tokens.js";
import { formatGmSummary } from "./summary.js";
import { SEARCHED_ALREADY_TEXT, SEARCH_TEXT, searchMessage, spottedIds } from "./search.js";

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

// GM-only per-scene state ---------------------------------------------------------------------------------
// One world setting keyed by scene id: { encounter, prepared[], searches{}, revealed[] }. Nothing about an
// expedition is kept in a scene flag or shown in chat. (Foundry cannot enforce read access to settings or
// flags: this keeps the information out of every screen, which is an honor system, like recipe visibility.)
const emptySceneState = () => ({ encounter: null, prepared: [], searches: {}, revealed: [] });
const readAllState = () => {
  const raw = game.settings.get(MODULE_ID, EXPLORATION.stateSetting);
  return raw && typeof raw === "object" && !Array.isArray(raw) ? structuredClone(raw) : {};
};
export const sceneState = sceneId => ({ ...emptySceneState(), ...(readAllState()[sceneId] ?? {}) });
async function writeSceneState(sceneId, state) {
  const all = readAllState();
  if (state === null) delete all[sceneId];
  else all[sceneId] = state;
  await game.settings.set(MODULE_ID, EXPLORATION.stateSetting, all);
}

/** The free anchors on a scene (not occupied by a node): [{ id, name, x, y, record, doc }]. */
function freeAnchors(scene) {
  return [...scene.tokens].map(doc => ({ doc, record: readRecord(doc) }))
    .filter(({ record }) => record?.state === "anchor" && !record.occupiedBy)
    .map(({ doc, record }) => ({ id: doc.id, name: doc.name, x: doc.x, y: doc.y, record, doc }));
}
const countAnchors = scene => [...scene.tokens].filter(doc => readRecord(doc)?.state === "anchor").length;

/** Every scene tagged with the region's tag, with its free anchors. */
export function poolFor(region) {
  return [...game.scenes].filter(scene => tagsOf(scene).includes(region.sceneTag)).map(scene => ({
    id: scene.id, name: scene.name, anchors: freeAnchors(scene), totalAnchors: countAnchors(scene), preparedCount: sceneState(scene.id).prepared.length
  }));
}

/** The scenes tagged for a region, with how many free anchors each has. GM only. */
export function scenesFor(api, regionId) {
  requireGM("scenesFor");
  const region = api.definitions?.region.get(regionId);
  if (!region) throw new Error(`scenesFor: unknown region "${regionId}" (known: ${[...(api.definitions?.region.keys() ?? [])].join(", ") || "none"})`);
  return poolFor(region).map(s => ({ id: s.id, name: s.name, freeAnchors: s.anchors.length, totalAnchors: s.totalAnchors, timesPrepared: s.preparedCount }));
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
  requireGM("listAnchors");
  const doc = sceneOf(scene);
  return [...doc.tokens].map(t => ({ t, record: readRecord(t) })).filter(({ record }) => record && (all || record.state === "anchor"))
    .map(({ t, record }) => ({
      id: t.id, name: t.name, state: record.state, source: record.source, nodeType: record.nodeType ?? null, tier: record.tier ?? null,
      charges: record.charges ?? null, region: record.region ?? null, x: t.x, y: t.y, hidden: t.hidden,
      occupiedBy: record.occupiedBy ?? null, revealed: record.state === "anchor" ? null : record.revealed !== false, perceptionDC: record.perceptionDC ?? null
    }));
}

/** Delete this scene's anchors (anchor-state tokens only). Needs { confirm: true }. */
export async function clearAnchors(scene, { confirm } = {}) {
  requireGM("clearAnchors");
  const doc = sceneOf(scene);
  const ids = [...doc.tokens].filter(t => readRecord(t)?.state === "anchor").map(t => t.id);
  if (confirm !== true) throw new Error(`clearAnchors: this would delete ${ids.length} anchor token(s) from "${doc.name}". Run it again with { confirm: true } to go ahead.`);
  if (ids.length) await doc.deleteEmbeddedDocuments("Token", ids);
  return ids.length;
}

/** Let every character search the scene again (the one-attempt-per-visit rule). Returns how many attempts were cleared. */
export async function resetSearches(scene) {
  requireGM("resetSearches");
  const doc = sceneOf(scene);
  const state = sceneState(doc.id);
  const count = Object.keys(state.searches).length;
  if (count) await writeSceneState(doc.id, { ...state, searches: {} });
  return count;
}

/**
 * Clear the map: delete every node token the module placed here (found or still hidden; the token's own
 * actor goes with it), free the anchors they stood on, take the nodes out of every character's known-node
 * list, and reset the scene's encounter, searches and expedition history. Never touches the shared
 * Resource Node actor, anchors, hand-made node tokens, corpse nodes or anything already in inventories.
 * Safe to run again if it stopped part-way. Returns { removed, found, hidden, skipped, knownNodesCleared }.
 */
export async function clearMap(scene) {
  requireGM("clearMap");
  const doc = sceneOf(scene);
  const nodeActorId = game.settings.get(MODULE_ID, NODE_ACTOR.setting) || null;
  const tokens = [...doc.tokens].map(t => ({ t, record: readRecord(t) })).filter(({ record }) => record && record.state !== "anchor");
  const mine = tokens.filter(({ t, record }) => record.source === "explored" || (nodeActorId && t.actorId === nodeActorId));
  const found = mine.filter(({ record }) => record.revealed !== false).length;
  const hidden = mine.length - found;

  if (mine.length) await doc.deleteEmbeddedDocuments("Token", mine.map(({ t }) => t.id));
  const occupied = [...doc.tokens].filter(t => readRecord(t)?.state === "anchor" && readRecord(t).occupiedBy);
  if (occupied.length) await doc.updateEmbeddedDocuments("Token", occupied.map(t => vacateUpdate(t.id)));

  let knownNodesCleared = 0;
  for (const actor of game.actors) {
    const known = listOf(actor.getFlag(MODULE_ID, "knownNodes"));
    const kept = known.filter(entry => entry.sceneId !== doc.id);
    if (kept.length !== known.length) {
      knownNodesCleared += known.length - kept.length;
      await actor.update({ [`flags.${MODULE_ID}.knownNodes`]: kept });
    }
  }
  await writeSceneState(doc.id, null);
  return { removed: mine.length, found, hidden, skipped: tokens.length - mine.length, knownNodesCleared };
}

// Odds and simulation (GM only: players are never shown odds or results) ------------------------------------------
/** The DC, the GM-side modifier per skill, the odds, the expected nodes per day, and the scenes. GM only. */
export function previewExplore(api, actor, regionId, skill) {
  requireGM("previewExplore");
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
    region: { id: region.id, name: region.name, dc: region.explorationDC, minDays: region.daysRequired, danger: region.danger ?? "moderate", encounterChance: EXPLORATION.encounterChance[region.danger ?? "moderate"] },
    perSkill,
    scenes: scenesFor(api, regionId)
  };
}

/** Simulate many expeditions (no scene, no writes) and compare observed numbers with expected. GM only. */
export function simulateExplore(api, { region: regionId, runs = 5000, degree, modifier, days = 1, forceCombat = false } = {}) {
  requireGM("simulateExplore");
  const region = api.definitions?.region.get(regionId);
  if (!region) throw new Error(`simulateExplore: unknown region "${regionId}"`);
  return simulateExpeditions({ region, runs, degree, modifier, days, forceCombat, rng });
}

/** Check a definition against the loaded ones WITHOUT loading it. Returns the problems found in it. */
export function checkDefinition(api, record) {
  requireGM("checkDefinition");
  const page = data => "```json\n" + JSON.stringify(data) + "\n```";
  const sources = DEFINITION_KINDS.flatMap(kind => [...(api.definitions?.[kind].values() ?? [])].map(d => ({ pack: "loaded", entry: d.id, text: page(d) })));
  const { errors } = loadDefinitions([...sources, { pack: "console", entry: record?.id ?? "(candidate)", text: page(record) }]);
  return errors.filter(e => e.pack === "console").map(e => `${e.field} ${e.message}`);
}

// The expedition ---------------------------------------------------------------------------------------------
/** What the review window needs to describe an explore action (GM only: the queue is resolved by a GM). */
export function describeInfo(api, actor, action) {
  const region = api.definitions?.region.get(action.params?.region);
  if (!region) return { region: null };
  let modifier = null;
  try { modifier = adapter.getSkillModifier(actor, action.params.skill); } catch { /* the actor lacks this skill */ }
  const odds = modifier === null ? null : exploreOdds(modifier, region.explorationDC);
  const pool = poolFor(region);
  return {
    region, skill: action.params.skill, modifier, odds, scenes: pool.length,
    freeAnchors: pool.reduce((n, s) => n + s.anchors.length, 0), totalAnchors: pool.reduce((n, s) => n + s.totalAnchors, 0)
  };
}

/**
 * Roll the checks and plan the expedition. Writes nothing. One hidden check per day, one encounter roll for the
 * whole trip. Throws ExploreRefused when the request can never succeed (region gone, skill not allowed); any other
 * Error leaves the action queued for a Retry.
 * @param {{ degree?: string|string[] }} options  degree: TEST OVERRIDE for the checks (one for every day, or one per day)
 */
export async function planRun(api, actor, action, { degree } = {}) {
  const region = api.definitions?.region.get(action.params?.region);
  if (!region) throw new ExploreRefused(`region "${action.params?.region}" no longer exists`);
  const picked = pickSkill(region.skillWhitelist, action.params.skill, `"${region.name}"`, "exploration");
  if (!picked.ok) throw new ExploreRefused(picked.error);
  const days = action.daysReserved;

  const rolls = [];
  if (degree !== undefined) {
    const forced = Array.isArray(degree) ? degree : Array(days).fill(degree);
    if (forced.length < days) throw new Error(`${forced.length} forced degree(s) given for ${days} day(s)`);
    for (const d of forced.slice(0, days)) {
      const normalized = adapter.normalizeDegree(d);
      if (!normalized) throw new Error(`unknown degree "${d}"`);
      rolls.push({ degree: normalized, natural: null, total: null });
    }
  } else {
    for (let day = 0; day < days; day++) {
      const roll = await adapter.rollSkillCheck(actor, picked.skill, region.explorationDC, { createMessage: false });
      rolls.push({ degree: roll.degree, natural: roll.natural, total: roll.total });
    }
  }

  const encounter = rollEncounter({ danger: region.danger ?? "moderate", forceCombat: action.params.forceCombat === true, rng });
  const result = planExpedition({ region, registry: api.definitions, degrees: rolls.map(r => r.degree), scenes: poolFor(region), rng });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return { region, skill: picked.skill, rolls, encounter, plan: result.plan, days };
}

async function rollBack(undos) {
  const failures = [];
  for (const undo of [...undos].reverse()) {
    try { await undo.run(); } catch (error) { failures.push(`${undo.what} (${error.message})`); }
  }
  if (failures.length) throw new Error(`could not undo: ${failures.join("; ")}. Check the scene by hand (api.clearMap clears what an expedition placed).`);
}

/**
 * Write the plan to the scene: the hidden node tokens (new tokens at the anchors' positions), the anchors marked
 * occupied, then the scene's GM-only state. Returns an async undo() that puts everything back; a failure part-way
 * undoes the earlier writes before the error propagates.
 */
export async function applyPlan(api, actor, run) {
  const scene = sceneOf(run.plan.scene.id);
  for (const act of run.plan.activations) {
    const anchor = scene.tokens.get(act.anchorId);
    if (readRecord(anchor)?.state !== "anchor" || readRecord(anchor)?.occupiedBy) throw new Error(`anchor "${act.anchorId}" on ${scene.name} is no longer free; try again`);
  }
  const nodeActor = await ensureNodeActor();
  const undos = [];
  const previousState = sceneState(scene.id);
  const hadState = scene.id in readAllState();
  try {
    let created = [];
    if (run.plan.activations.length) {
      const data = await Promise.all(run.plan.activations.map(act =>
        tokenObject(nodeActor, nodeTokenData({ x: act.x, y: act.y, record: act.record, nodeType: api.definitions.nodeType.get(act.nodeType), hidden: true }))));
      created = await scene.createEmbeddedDocuments("Token", data);
      undos.push({ what: "the new node tokens", run: () => scene.deleteEmbeddedDocuments("Token", created.map(t => t.id)) });
      const occupy = run.plan.activations.map((act, i) => occupyUpdate(act.anchorId, created[i].id));
      await scene.updateEmbeddedDocuments("Token", occupy);
      undos.push({ what: "the occupied anchors", run: () => scene.updateEmbeddedDocuments("Token", run.plan.activations.map(act => vacateUpdate(act.anchorId))) });
    }
    const entry = { at: Date.now(), actorName: actor.name, region: run.region.id, days: run.days, placed: run.plan.activations.length, encounter: run.encounter.encounter };
    const next = {
      ...previousState,
      encounter: { active: run.encounter.encounter, forced: run.encounter.forced, at: entry.at, by: actor.name },
      prepared: [...previousState.prepared, entry].slice(-EXPLORATION.preparedLogMax)
    };
    await writeSceneState(scene.id, next);
    undos.push({ what: "the scene's expedition state", run: () => writeSceneState(scene.id, hadState ? previousState : null) });
  } catch (error) {
    await rollBack(undos).catch(rollbackError => { throw new Error(`${error.message}. ${rollbackError.message}`); });
    throw error;
  }
  return () => rollBack(undos);
}

/** Tell the GMs what happened. Players are told nothing here: their result stays with the GM. */
export async function postExploreChat(api, actor, run) {
  const scene = sceneOf(run.plan.scene.id);
  const nodes = run.plan.activations.map(a => ({ name: api.definitions.nodeType.get(a.nodeType).name, nodeType: a.nodeType, tier: a.tier, perceptionDC: a.perceptionDC }));
  const searchedBy = Object.keys(sceneState(scene.id).searches).map(id => game.actors.get(id)?.name ?? id);
  try {
    await ChatMessage.create({
      whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
      content: formatGmSummary({ actorName: actor.name, regionName: run.region.name, plan: run.plan, skillName: adapter.skillLabel(run.skill), dc: run.region.explorationDC, rolls: run.rolls, encounter: run.encounter, nodes, searchedBy })
    });
  } catch (error) {
    console.error(`${MODULE_ID} | the expedition was prepared on "${scene.name}", but the chat message failed`, error);
  }
}

// Searching ---------------------------------------------------------------------------------------------------
let socket = null;
let socketProvider = null;
/** Set by socket.js once the module has registered with socketlib. */
export function setSocket(s) { socket = s; }
/** socket.js gives this a way to register lazily, the first time a relay is needed. */
export function setSocketProvider(fn) { socketProvider = fn; }

const ownerUserIds = actor => [...game.users].filter(u => !u.isGM && actor.testUserPermission(u, "OWNER")).map(u => u.id);

/**
 * Run a search on the GM client: roll the character's Perception HERE (so a player cannot report a better total),
 * compare it to the Perception DCs of the scene's hidden nodes, reveal what it beats, and tell the player only what
 * was spotted. One attempt per character per scene visit; the attempt is used up even if nothing was there.
 * @returns {{ message: string, spotted: string[] }}
 */
export async function runSearch({ actorId, sceneId, userId }) {
  requireGM("runSearch");
  const actor = game.actors.get(actorId);
  const scene = game.scenes.get(sceneId);
  const user = game.users.get(userId);
  const generic = { message: SEARCH_TEXT, spotted: [] };
  if (!actor || !scene || !user) return generic;
  if (!user.isGM && !actor.testUserPermission(user, "OWNER")) return { message: "You can only search with a character you own.", spotted: [] };
  if (![...scene.tokens].some(t => t.actorId === actor.id)) return generic; // not on this scene: nothing happens, nothing is used up

  const state = sceneState(scene.id);
  if (state.searches[actor.id]) return { message: SEARCHED_ALREADY_TEXT, spotted: [] };
  await writeSceneState(scene.id, { ...state, searches: { ...state.searches, [actor.id]: Date.now() } }); // used up first: a crash cannot give a free retry

  const { total, natural } = await adapter.rollPerception(actor, { createMessage: false });
  const hiddenNodes = [...scene.tokens].map(t => ({ t, record: readRecord(t) }))
    .filter(({ record }) => record && record.state !== "anchor" && record.revealed === false)
    .map(({ t, record }) => ({ id: t.id, dc: record.perceptionDC, token: t, record }));
  const spottedNodes = hiddenNodes.filter(n => spottedIds(total, hiddenNodes).includes(n.id));

  if (spottedNodes.length) {
    const now = Date.now();
    const known = listOf(actor.getFlag(MODULE_ID, "knownNodes"));
    const afterState = sceneState(scene.id);
    const entries = spottedNodes.map(n => ({ sceneId: scene.id, tokenId: n.id, name: n.token.name, nodeType: n.record.nodeType, tier: n.record.tier, at: now }));
    await writeSceneState(scene.id, { ...afterState, revealed: [...afterState.revealed, ...entries.map(e => ({ tokenId: e.tokenId, name: e.name, nodeType: e.nodeType, by: actor.name, at: now }))] });
    try {
      await actor.update({ [`flags.${MODULE_ID}.knownNodes`]: [...known, ...entries] });
      await scene.updateEmbeddedDocuments("Token", spottedNodes.map(n => revealUpdate(n.id, actor.name)));
    } catch (error) {
      await actor.update({ [`flags.${MODULE_ID}.knownNodes`]: known }).catch(() => {});
      await writeSceneState(scene.id, afterState).catch(() => {});
      throw error;
    }
  }

  const names = spottedNodes.map(n => n.token.name);
  const message = searchMessage(names);
  try {
    const owners = ownerUserIds(actor);
    if (owners.length) await ChatMessage.create({ whisper: owners, speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${message}</p>` });
    await ChatMessage.create({
      whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
      content: `<p>GM only: ${actor.name} searched ${scene.name}: Perception total ${total}${natural === null ? "" : ` (natural ${natural})`}. Found ${names.length} of ${hiddenNodes.length} hidden node(s)${spottedNodes.length ? `: ${spottedNodes.map(n => `${n.token.name} (DC ${n.dc})`).join(", ")}` : ""}.</p>`
    });
  } catch (error) {
    console.error(`${MODULE_ID} | the search was resolved, but the chat message failed`, error);
  }
  return { message, spotted: names };
}

/** The player's button: ask the GM client to search the area the character is standing in. */
export async function searchArea(actor) {
  const sceneId = globalThis.canvas?.scene?.id;
  if (!sceneId) throw new Error("searchArea: open the scene you are on first");
  if (game.user.isGM) return runSearch({ actorId: actor.id, sceneId, userId: game.user.id });
  if (!actor.isOwner) throw new Error("You can only search with a character you own.");
  const relay = socket ?? socketProvider?.() ?? null;
  if (!relay) throw new Error("searchArea: the module's socket is not ready (is socketlib installed and active? api.socketStatus() shows what is missing)");
  try {
    return await relay.executeAsGM("search", { actorId: actor.id, sceneId, userId: game.user.id });
  } catch (error) {
    console.error(`${MODULE_ID} | search relay failed`, error);
    throw new Error("The GM isn't available to run your search right now.");
  }
}
