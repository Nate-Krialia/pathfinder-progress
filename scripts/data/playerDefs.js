/**
 * Foundry-bound half of "players load only what they need" (Stage 16; the pure half is playerSet.js).
 *
 *   GM client:     `runDefinitionsFor` is the guarded socket handler `definitionsFor`. It reads the FACTS about the characters the
 *                  calling user owns, picks and strips the definitions they need, and returns them.
 *   Player client: `refresh()` asks for them and swaps them into `api.definitions`. It runs once at load and again, debounced,
 *                  when something that decides the set changes (a hook, below). Nothing recomputes per render: callers read the
 *                  loaded registry synchronously.
 *
 * This is an honor system, not secrecy (docs/10): Foundry cannot hide data from a client.
 */
import { COMPENDIUM, DEFINITIONS_SYNC, EXPLORATION, MODULE_ID, NODE_FLAG, QUEUE_KEYS, RESEARCH_KEYS, STATION_KEYS, WORKSHOP } from "../config.js";
import * as adapter from "../adapter/pf2e.js";
import { callerOf } from "../queue/common.js";
import { asGM } from "../queue/work.js";
import { refusal } from "../queue/relay.js";
import { defsState } from "./playerState.js";
import { factsKey, loadPlayerRecords, normalizeFacts, selectRecords } from "./playerSet.js";

let boundApi = null;
export const bind = api => { boundApi = api; };

const list = value => (Array.isArray(value) ? value : []);
const ids = (entries, field) => list(entries).map(e => e?.[field]).filter(id => typeof id === "string");

// Facts -------------------------------------------------------------------------------------------------------------
/** The characters a user owns at Owner level. */
export const ownedCharacters = user => (user.isGM ? [] : [...game.actors].filter(a => a.type === "character" && a.testUserPermission(user, "OWNER")));

function actorFacts(actor, sharedMaterials) {
  const projects = list(actor.getFlag(MODULE_ID, RESEARCH_KEYS.projectsFlag)).filter(p => p?.status === "active");
  const pending = list(actor.getFlag(MODULE_ID, QUEUE_KEYS.pendingFlag));
  const book = actor.getFlag(MODULE_ID, COMPENDIUM.flag);
  let stacks = [];
  try { stacks = adapter.getMaterialStacks(actor).map(s => s.materialId); } catch { /* an actor with no inventory yet */ }
  const stationRecords = list(actor.getFlag(MODULE_ID, STATION_KEYS.actorStationsFlag));
  return {
    id: actor.id,
    formulas: ids(actor.getFlag(MODULE_ID, RESEARCH_KEYS.formulasFlag), "recipeId"),
    blueprints: ids(actor.getFlag(MODULE_ID, "blueprints"), "blueprintId"),
    designs: projects.filter(p => p.outcome?.type === "designBlueprint").map(p => p.outcome.blueprintId),
    materials: [
      ...stacks,
      ...Object.keys(book?.materials ?? {}),
      ...sharedMaterials,
      ...projects.flatMap(p => ids(p.materials, "materialId")),
      ...pending.flatMap(a => ids(a.params?.escrow?.units, "materialId"))
    ],
    stations: projects.filter(p => p.outcome?.type === "upgradeStation").map(p => p.outcome.stationId),
    towns: [
      ...pending.filter(a => a.type === "build").map(a => a.params?.town),
      actor.getFlag(MODULE_ID, STATION_KEYS.actorLocationFlag),
      ...stationRecords.map(r => r?.location?.town)
    ]
  };
}

/**
 * Everything that decides which definitions a user needs, read from the world (see playerSet.js for the shape). The GM runs it
 * for the calling user; a player client runs the same function on itself to know WHEN to ask again.
 */
export function gatherFacts(user) {
  const owned = ownedCharacters(user);
  const ownedIds = new Set(owned.map(a => a.id));
  const partyOwned = owned.some(a => [...game.users].some(u => !u.isGM && a.testUserPermission(u, "OWNER")));
  const shared = partyOwned ? Object.keys(game.settings.get(MODULE_ID, COMPENDIUM.sharedSetting)?.materials ?? {}) : [];

  const viewed = user.viewedScene ?? (user.id === game.user.id ? globalThis.canvas?.scene?.id : undefined);
  const sceneTags = [];
  const nodeTypes = [];
  for (const scene of game.scenes) {
    const tokens = [...scene.tokens];
    if (scene.id !== viewed && !tokens.some(t => ownedIds.has(t.actorId))) continue;
    sceneTags.push(...list(scene.getFlag(MODULE_ID, EXPLORATION.sceneTagsFlag)));
    for (const token of tokens) {
      const record = token.getFlag(MODULE_ID, NODE_FLAG);
      if (record && record.state !== "anchor" && record.revealed !== false && typeof record.nodeType === "string") nodeTypes.push(record.nodeType);
    }
  }

  const state = list(game.settings.get(MODULE_ID, STATION_KEYS.stationStateSetting));
  return {
    actors: owned.map(a => actorFacts(a, shared)),
    location: game.settings.get(MODULE_ID, STATION_KEYS.partyLocationSetting) || null,
    sceneTags,
    nodeTypes,
    stationTowns: list(game.settings.get(MODULE_ID, WORKSHOP.partyStationsSetting)).map(s => s?.town),
    stateStations: state.filter(e => (e?.owner && ownedIds.has(e.owner)) || list(e?.access).some(id => ownedIds.has(id))).map(e => e.stationId)
  };
}

// GM side ---------------------------------------------------------------------------------------------------------------
/**
 * The `definitionsFor` socket handler. The caller is whoever socketlib says sent the message (`this.socketdata.userId`; real
 * socketlib takes it from Foundry's own socket event, not from the payload). The payload's `userId` is used only when there is no
 * socketdata at all (a direct call on a GM client). Honor system: see docs/10.
 */
export async function runDefinitionsFor(payload, context) {
  if (!game.user.isGM) throw new Error("definitionsFor: GM only");
  const user = callerOf(payload, context);
  if (user.isGM) throw refusal("The GM client loads every definition itself; there is nothing to fetch.");
  const api = boundApi;
  if (!api?.definitions) throw refusal("The GM's definitions are not loaded yet; try again in a moment.");
  const facts = normalizeFacts(gatherFacts(user));
  const { records, missingRecipes, recipeIds } = selectRecords(facts, api.definitions);
  const resolvedOutputs = {};
  for (const id of recipeIds) if (api.resolvedOutputs?.has(id)) resolvedOutputs[id] = api.resolvedOutputs.get(id);
  return {
    records,
    missingRecipes,
    resolvedOutputs,
    uncraftable: recipeIds.filter(id => api.uncraftable?.has(id)),
    revision: game.settings.get(MODULE_ID, DEFINITIONS_SYNC.revisionSetting) ?? ""
  };
}

/** A short fingerprint of the GM's registry, so the revision only changes when a definition really did. */
export function digestOf(registry, uncraftable) {
  const text = JSON.stringify([...Object.entries(registry)].sort(([a], [b]) => a.localeCompare(b)).map(([kind, map]) => [kind, [...map.values()].sort((a, b) => a.id.localeCompare(b.id))]))
    + JSON.stringify([...(uncraftable ?? [])].sort());
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}

/** GM: tell every player client the definitions may have changed. Writes the setting only if the registry really is different. */
export async function publishDefinitions(api) {
  if (!game.user.isGM) throw new Error("publishDefinitions: GM only");
  const digest = digestOf(api.definitions, api.uncraftable);
  if ((game.settings.get(MODULE_ID, DEFINITIONS_SYNC.revisionSetting) ?? "") === digest) return { changed: false, revision: digest };
  await game.settings.set(MODULE_ID, DEFINITIONS_SYNC.revisionSetting, digest);
  return { changed: true, revision: digest };
}

// Player side -----------------------------------------------------------------------------------------------------------
const revisionNow = () => String(game.settings.get(MODULE_ID, DEFINITIONS_SYNC.revisionSetting) ?? "");

let inflight = null;
let again = null;        // { force } wanted while a load was running

async function loadOnce({ force }) {
  const state = defsState();
  const key = `${factsKey(gatherFacts(game.user))}|r${revisionNow()}`;
  if (!force && state.status === "ready" && state.key === key) return { changed: false };
  if (state.status !== "ready") state.status = "loading";
  let result;
  try {
    result = await asGM(DEFINITIONS_SYNC.socketHandler, {}, () => { throw new Error("definitionsFor: a GM client loads everything itself"); });
  } catch (error) {
    const noGM = /GM isn't connected/.test(error.message);
    if (state.status !== "ready") { state.status = noGM ? "no-gm" : "failed"; state.message = error.message; }
    throw error;
  }
  const { registry, errors } = loadPlayerRecords(result?.records);
  if (errors.length) console.error(`${MODULE_ID} | the GM sent definitions this client could not load:\n${errors.join("\n")}`);
  boundApi.definitions = attachRefresh(registry);
  boundApi.resolvedOutputs = new Map(Object.entries(result?.resolvedOutputs ?? {}));
  boundApi.uncraftable = new Set(result?.uncraftable ?? []);
  boundApi.contexts = new Map();
  boundApi.errors = [];
  Object.assign(state, { status: "ready", message: "", key, missing: new Set(result?.missingRecipes ?? []), loadedAt: Date.now(), loads: state.loads + 1 });
  return { changed: true };
}

/**
 * Player client: fetch the definitions this user's characters need. Several callers share one request; a request made while one is
 * running runs once more afterwards. A GM client has everything already and returns at once. Throws a plain Error when it cannot
 * (for example "The GM isn't connected right now ...").
 * @param {{ force?: boolean }} [options]  force: ask even if nothing that decides the set seems to have changed
 */
export function refresh(options = {}) {
  if (game.user.isGM) return Promise.resolve({ changed: false, gm: true });
  if (inflight) { again = { force: Boolean(again?.force || options.force) }; return inflight; }
  inflight = (async () => {
    try {
      let result = await loadOnce({ force: Boolean(options.force) });
      while (again) { const next = again; again = null; const r = await loadOnce(next); result = { changed: result.changed || r.changed }; }
      return result;
    } finally { inflight = null; again = null; }
  })();
  return inflight;
}

/** Put `refresh` on a registry so a player (or a gate step) can call `api.definitions.refresh()`. Not enumerable: it is not a kind. */
export function attachRefresh(registry) {
  Object.defineProperty(registry, "refresh", { value: refresh, enumerable: false, configurable: true, writable: true });
  return registry;
}

let timer = null;
/** Ask again soon (debounced): many changes in a row cost one request. Errors are logged, not thrown (nobody is waiting on them). */
export function schedule(reason) {
  if (game.user.isGM) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = null;
    try { await refresh(); } catch (error) { console.warn(`${MODULE_ID} | could not refresh definitions (${reason}): ${error.message}`); }
  }, DEFINITIONS_SYNC.debounceMs);
}

/** Resolves when no refresh is scheduled or running. For tests and for steps that must wait for a hook-driven refresh. */
export async function settled() {
  while (timer || inflight) await new Promise(resolve => setTimeout(resolve, 20));
}

// Hooks -----------------------------------------------------------------------------------------------------------------
const WATCHED_SETTINGS = new Set([STATION_KEYS.partyLocationSetting, STATION_KEYS.stationStateSetting, WORKSHOP.partyStationsSetting, COMPENDIUM.sharedSetting, DEFINITIONS_SYNC.revisionSetting]
  .map(key => `${MODULE_ID}.${key}`));
const MODULE_FLAGS_THAT_MATTER = [RESEARCH_KEYS.formulasFlag, RESEARCH_KEYS.projectsFlag, QUEUE_KEYS.pendingFlag, COMPENDIUM.flag, STATION_KEYS.actorStationsFlag, STATION_KEYS.actorLocationFlag, "blueprints"];

/** Player clients: the events that can change what is needed. Each only schedules a debounced check; the key decides whether to ask. */
export function installPlayerHooks(hooks = globalThis.Hooks) {
  const mine = actor => actor?.type === "character" && actor.isOwner;
  const on = (name, fn) => hooks.on(name, (...args) => { if (!game.user.isGM) fn(...args); });
  on("updateActor", (actor, changes) => {
    // An ownership change counts even when this user has just LOST the character (then it is no longer "mine").
    if (changes?.ownership && actor?.type === "character") return schedule("ownership");
    if (!mine(actor)) return;
    const flags = changes?.flags?.[MODULE_ID];
    if (flags && MODULE_FLAGS_THAT_MATTER.some(key => key in flags)) schedule("character");
  });
  on("createItem", item => { if (mine(item?.parent) && item.getFlag?.(MODULE_ID, "material")) schedule("inventory"); });
  on("deleteItem", item => { if (mine(item?.parent) && item.getFlag?.(MODULE_ID, "material")) schedule("inventory"); });
  on("updateUser", (user, changes) => { if (user?.id === game.user.id && changes && "character" in changes) schedule("character"); });
  on("canvasReady", () => schedule("scene"));
  on("updateScene", (scene, changes) => { if (changes?.flags?.[MODULE_ID]) schedule("scene tags"); });
  on("createToken", () => schedule("tokens"));
  on("deleteToken", () => schedule("tokens"));
  on("updateToken", (token, changes) => { if (changes?.flags?.[MODULE_ID]) schedule("tokens"); });
  on("updateSetting", setting => { if (WATCHED_SETTINGS.has(setting?.key)) schedule("setting"); });
  on("createSetting", setting => { if (WATCHED_SETTINGS.has(setting?.key)) schedule("setting"); });
  on("userConnected", (user, connected) => {
    const s = defsState();
    if (user?.isGM && connected && s.status !== "ready") schedule("GM connected");
  });
}
