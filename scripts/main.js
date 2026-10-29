import { MODULE_ID } from "./config.js";
import * as adapter from "./adapter/pf2e.js";
import { loadAll, reportErrors } from "./data/loader.js";
import { resolveMaterialEffect } from "./data/resolver.js";
import { craft, previewCraft } from "./crafting/craft.js";
import * as stations from "./stations/store.js";
import * as gathering from "./gathering/store.js";
import * as researchStore from "./research/store.js";
import * as auditStore from "./audit/store.js";
import * as queueStore from "./queue/store.js";
import { openReview, refreshReview } from "./queue/review-app.js";
import * as exploration from "./exploration/store.js";
import * as commissions from "./commissions/store.js";
import * as downtime from "./downtime/store.js";
import { installSocketHooks, socketStatus } from "./socket.js";
import { suggestPayout } from "./commissions/commission.js";
import { feeForTier } from "./stations/fees.js";
import { AUDIT, COMMISSIONS, COMPENDIUM, DOWNTIME, EXPLORATION, NODE_ACTOR, QUEUE_KEYS, STATION_KEYS, WORKSHOP } from "./config.js";
import * as compendium from "./compendium/store.js";
import * as workshop from "./workshop/store.js";
import { UPGRADE_KINDS } from "./workshop/rules.js";
import { handleChatMessage, addGrantButton, getXp, getTier } from "./skill-xp/xp.js";

Hooks.once("init", () => {
  gathering.registerNodeHooks();
  // Skill XP track
  game.settings.register(MODULE_ID, "paused", {
    name: "Pause XP awards",
    hint: "When ticked, no skill XP is awarded.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "awardMode", {
    name: "Award mode",
    hint: "GM grants: a button appears on skill checks for the GM. Automatic: rolls with a DC award XP instantly.",
    scope: "world",
    config: true,
    type: String,
    choices: { gm: "GM grants", auto: "Automatic" },
    default: "gm"
  });

  // Downtime system
  game.settings.register(MODULE_ID, "itemPacks", {
    name: "Item packs for recipe outputs",
    hint: 'Comma-separated Item compendium ids searched when a recipe names its output item (e.g. "Dagger"). "world.*" means every world Item compendium.',
    scope: "world",
    config: true,
    type: String,
    default: "pf2e.equipment-srd, world.*"
  });

  game.settings.register(MODULE_ID, STATION_KEYS.partyLocationSetting, {
    name: "Party location",
    hint: 'The town the party is in (a town id such as "oakhaven"). Decides which stations are reachable. Normally set with the console tool api.setLocation().',
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, STATION_KEYS.stationStateSetting, {
    scope: "world",
    config: false,
    type: new foundry.data.fields.ArrayField(new foundry.data.fields.ObjectField()),
    default: []
  });

  // The Compendium entries the GM approved for the whole party, and the workshops the party built (both written only by a GM client).
  game.settings.register(MODULE_ID, COMPENDIUM.sharedSetting, {
    scope: "world",
    config: false,
    type: new foundry.data.fields.ObjectField(),
    default: {}
  });

  game.settings.register(MODULE_ID, WORKSHOP.partyStationsSetting, {
    scope: "world",
    config: false,
    type: new foundry.data.fields.ArrayField(new foundry.data.fields.ObjectField()),
    default: []
  });

  game.settings.register(MODULE_ID, QUEUE_KEYS.autoOpenSetting, {
    name: "Open the review window automatically",
    hint: "GM only. When players have queued actions (or the audit finds a mismatch), open the review window on login and when new actions arrive.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, DOWNTIME.stateSetting, {
    scope: "world",
    config: false,
    type: new foundry.data.fields.ObjectField(),
    default: {}
  });

  game.settings.register(MODULE_ID, EXPLORATION.stateSetting, {
    scope: "world",
    config: false,
    type: new foundry.data.fields.ObjectField(),
    default: {}
  });

  game.settings.register(MODULE_ID, COMMISSIONS.settingKey, {
    scope: "world",
    config: false,
    type: new foundry.data.fields.ArrayField(new foundry.data.fields.ObjectField()),
    default: []
  });

  game.settings.register(MODULE_ID, NODE_ACTOR.setting, {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, AUDIT.ledgerSetting, {
    scope: "world",
    config: false,
    type: new foundry.data.fields.ObjectField(),
    default: {}
  });

  game.settings.register(MODULE_ID, "extraPacks", {
    name: "Extra definition packs",
    hint: "Comma-separated ids of extra Journal Entry compendiums to load definitions from (e.g. world.my-materials).",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });
});

Hooks.once("ready", async () => {
  const api = {
    getXp,
    getTier,
    adapter,
    resolveMaterialEffect,
    definitions: null,
    errors: [],
    uncraftable: new Set(),
    resolvedOutputs: new Map(),
    contexts: new Map(),
    // Stations (GM tools; see scripts/stations/store.js)
    /** Which stations can this actor reach? Pass a recipe id to include category/tier checks. */
    stationsFor: (actor, recipeId) => stations.stationRows(api, actor, recipeId),
    setLocation: townId => stations.setLocation(api, townId),
    setActorLocation: (actor, townId) => stations.setActorLocation(api, actor, townId),
    setStationState: (stationId, state) => stations.setStationState(api, stationId, state),
    clearStationState: stationId => stations.clearStationState(stationId),
    giveStation: (actor, spec) => stations.giveStation(api, actor, spec),
    removeStation: (actor, stationId) => stations.removeStation(actor, stationId),
    transferStation: (stationId, toActor) => stations.transferStation(api, stationId, toActor),
    // Gathering (GM tools; see scripts/gathering/store.js)
    /** Gather from a node token. GM only. Options: { actor, node, skill?, degree?, chat? } */
    gather: options => gathering.gather(options, api),
    /** Dry run: DCs, your modifier and the odds. Spends nothing. */
    previewGather: (actor, node, skill) => gathering.previewGather(api, actor, node, skill),
    /** The resolved node with absolute DCs. */
    nodeInfo: node => gathering.nodeInfo(api, node),
    createNode: (node, spec) => gathering.createNode(api, node, spec),
    createAnchor: (node, spec) => gathering.createAnchor(api, node, spec),
    activateNode: (node, spec) => gathering.activateNode(api, node, spec),
    makeCorpseNode: (node, spec) => gathering.makeCorpseNode(api, node, spec),
    clearNode: node => gathering.clearNode(node),
    // Queue and review (see scripts/queue/store.js). Any owner can submit; the rest is GM only.
    queue: {
      /**
       * Queue an action and reserve its days: submit(actor, "research", { projectId, skill? }, days). Players can call this.
       * "craft": submit(actor, "craft", { recipe, selection, stationId? }) takes the materials and station fee now and reserves the craft days.
       * "gather": submit(actor, "gather", { sceneId, tokenId, skill? }) claims one charge on the node (no days, no downtime needed).
       */
      submit: (actor, type, params, days) => queueStore.submit(actor, type, params, days),
      /** Every queued action across all actors, in submission order. */
      list: actors => queueStore.list(actors),
      /** Cancel your own queued action and get everything back (days, a craft's materials and fee, a gather's charge). Players can call this. */
      cancel: (actor, actionId) => queueStore.cancel(actor, actionId),
      reject: (actor, actionId, options) => queueStore.reject(actor, actionId, options),
      editDays: (actor, actionId, days) => queueStore.editDays(actor, actionId, days),
      resolve: (actor, actionId, options) => queueStore.resolveAction(api, actor, actionId, options),
      resolveAll: options => queueStore.resolveAll(api, options)
    },
    /**
     * The per-character Compendium (Stage 10b). view(actor): the character's own entries plus the party's shared ones
     * (the owner or a GM only: an API courtesy, not security). all(): GM only, every character's progress.
     * hasMaterial(actor, id): has the character discovered it? Share an entry with api.queue.submit(actor, "share", { kind, key }).
     */
    compendium: {
      view: actor => compendium.view(api.definitions, actor),
      all: () => compendium.all(api.definitions),
      hasMaterial: (actor, materialId) => compendium.hasMaterial(actor, materialId)
    },
    /**
     * Workshops (Stage 10c). Players can call startUpgrade / startDesign / putAside (relayed to the GM client; immediate; no downtime needed).
     * startUpgrade(actor, { stationId, kind: "tier"|"craftDays"|"hearth", materials: { materialId: units } }) holds the target-tier materials in escrow on the
     * research project (no gold); putAside(actor, projectId) gives them back; the research days go through the ordinary research queue item.
     * Hearths are a counter with NO EFFECT YET. startDesign(actor, { blueprint }) researches a workshop design; build it with
     * api.queue.submit(actor, "build", { blueprint, selection }) (materials + gold + days; no roll; a party-owned workshop at the party's town, no station fee).
     */
    workshop: {
      upgradeKinds: UPGRADE_KINDS,
      startUpgrade: (actor, params) => workshop.relayStartUpgrade(actor, params),
      startDesign: (actor, params) => workshop.relayStartDesign(actor, params),
      putAside: (actor, projectId) => workshop.relayPutAside(actor, projectId),
      /** GM testing tool: give a character a design without the research. */
      grantDesign: (actor, blueprintId) => workshop.grantDesign(api, actor, blueprintId)
    },
    /** GM only: open the review window. */
    openReview: () => openReview(api),
    /** GM only: compare what players hold with what the module granted. */
    audit: {
      scan: actors => auditStore.scan(actors),
      accept: actor => auditStore.accept(actor),
      ledger: () => auditStore.readLedger()
    },
    // Commissions (see scripts/commissions/store.js). Players use the queue-based calls; the rest is GM only.
    commissions: {
      /** Commissions you may see: a GM sees all, a player those of characters they own. { status?, open? } */
      list: filter => commissions.listCommissions(filter),
      get: id => commissions.getCommission(id),
      /** GM: issue a commission, usually for an NPC patron: { patron: "Old Brannock" | actor, crafter, recipe, access?, selection?, materialsFrom?, payout?, teaches?, learnRoll? } */
      issue: spec => commissions.issue(api, spec),
      /** Player (patron): ask a crafter. spec: { crafter, recipe, access?: "loan"|"copy", selection: { slot: materialId }, payout, learnRoll? } */
      request: (patron, spec) => queueStore.submit(patron, "commission", { step: "request", ...spec }, 0),
      /** Player (crafter): accept, optionally { as: "loan" } on a copy offer. */
      queueAccept: (crafter, id, options) => queueStore.submit(crafter, "commission", { step: "accept", id, ...options }, 0),
      queueDecline: (crafter, id) => queueStore.submit(crafter, "commission", { step: "decline", id }, 0),
      /** Player (patron): cancel before delivery. */
      queueCancel: (patron, id) => queueStore.submit(patron, "commission", { step: "cancel", id }, 0),
      /** Player (crafter): ask the GM to run the craft. options: { selection?, station?, learnSkill? } */
      queueCraft: (crafter, id, options) => queueStore.submit(crafter, "commission", { step: "craft", id, ...options }, 0),
      /** GM, directly (no queue): accept, decline, cancel, craft. */
      accept: (id, options) => commissions.acceptStep(api, id, options),
      decline: id => commissions.declineStep(id),
      cancel: (id, options) => commissions.cancelStep(id, options),
      /** GM: craft for a commission. options: { selection?, station?, degree?, learnSkill?, learnDegree?, chat? } */
      craft: (id, options) => commissions.craftForCommission(api, id, options),
      /** Dry run of the craft checks: { ok, errors }. */
      preview: (id, options) => { const r = commissions.prepareCommissionCraft(api, id, options); return { ok: r.ok, errors: r.errors }; },
      /** A suggested payout for a recipe and a selection of materials. */
      suggestPayout: (recipeId, selection) => {
        const recipe = api.definitions?.recipe.get(recipeId);
        if (!recipe) throw new Error(`suggestPayout: unknown recipe "${recipeId}"`);
        return suggestPayout({ recipe, selection, registry: api.definitions, feeGp: feeForTier(recipe.stationTierMin) });
      }
    },
    // Exploration (GM tools; see scripts/exploration/store.js). Queue an expedition with api.queue.submit(actor, "explore", { region, skill? }, days).
    /** Mark a scene as belonging to a region: tagScene(scene, "oak-wood"). Pass a scene, its id or its name. */
    tagScene: (scene, tag) => exploration.tagScene(scene, tag),
    untagScene: (scene, tag) => exploration.untagScene(scene, tag),
    /** The scenes tagged for a region, with their free anchors. */
    scenesFor: regionId => exploration.scenesFor(api, regionId),
    placeAnchor: (scene, spec) => exploration.placeAnchor(api, scene, spec),
    /** Drop n hidden anchors at random free squares: placeAnchors(5, { scene? }). */
    placeAnchors: (n, options) => exploration.placeAnchors(api, n, options),
    placeNode: (scene, spec) => exploration.placeNode(api, scene, spec),
    /** Anchors on a scene (default: the current one). { all: true } includes active and depleted nodes. */
    listAnchors: (scene, options) => exploration.listAnchors(scene, options),
    clearAnchors: (scene, options) => exploration.clearAnchors(scene, options),
    /** GM: delete every node the module placed on a scene (found or hidden), free the anchors, clear known-node lists, the encounter and the searches. Nothing respawns. */
    clearMap: scene => exploration.clearMap(scene),
    /** GM: let every character search the scene again (one attempt per character per visit). */
    resetSearches: scene => exploration.resetSearches(scene),
    /** Troubleshooting: is the socket registered on this client? */
    socketStatus: () => socketStatus(),
    /** Players: search the area your character is in (the GM client rolls your Perception). Returns { message, spotted }. */
    searchArea: actor => exploration.searchArea(actor),
    /** The shared Resource Node actor (created, or recreated with a notice, if missing). */
    ensureNodeActor: () => exploration.ensureNodeActor(),
    /** Before queueing: DC, your modifier per skill, the odds, the expected node count, and the scenes (GM only). */
    previewExplore: (actor, regionId, skill) => exploration.previewExplore(api, actor, regionId, skill),
    /** Simulate many expeditions (no writes): { region, runs?, degree? | modifier? }. */
    simulateExplore: options => exploration.simulateExplore(api, options),
    /** Check a definition against the loaded ones without loading it. Returns its problems. */
    checkDefinition: record => exploration.checkDefinition(api, record),
    // Downtime periods (see scripts/downtime/store.js). Only a GM client changes the period.
    downtime: {
      /** GM: open a period. { days, actorIds? } (default: connected players' characters). */
      start: options => downtime.start(options),
      /** GM: close it. Returns { blocked: n } (changing nothing) while anything but a gather is queued, unless { force: true } (which returns those items, escrow included). */
      end: options => downtime.end(options, { queueCount: () => queueStore.blockingCount(), rejectAll: () => queueStore.rejectAll({ keepGathers: true }) }),
      /** GM: add a late joiner with the most free days any participant still has. */
      addLate: actor => downtime.addLate(actor),
      state: () => downtime.state(),
      isOpen: () => downtime.isOpen()
    },
    // Research and formulas (GM tools; see scripts/research/store.js)
    /** Downtime days the actor has. Stage 6 replaces this counter with queue reservation. */
    days: actor => researchStore.days(actor),
    grantDays: (actor, n) => researchStore.grantDays(actor, n),
    setDays: (actor, n) => researchStore.setDays(actor, n),
    /** Start researching a recipe: { actor, recipe, dc?, threshold? } (dc and threshold tune one project). */
    startProject: options => researchStore.startProject(api, options),
    /** One check per day, up to `days` days; stops when the project completes. { actor, project, days, skill?, degree?, chat? } */
    research: options => researchStore.research(options, api),
    /** Progress, DC, your modifiers and the per-day odds. Without a project id, lists the actor's projects. */
    projectInfo: (actor, projectId) => researchStore.projectInfo(api, actor, projectId),
    /** The hook for other progress sources. A reason is required and is logged. */
    addProgress: (actor, projectId, amount, reason, options) => researchStore.addProgress(api, actor, projectId, amount, reason, options),
    abandonProject: (actor, projectId) => researchStore.abandonProject(actor, projectId),
    grantFormula: (actor, recipeId, options) => researchStore.grantFormula(api, actor, recipeId, options),
    removeFormula: (actor, recipeId) => researchStore.removeFormula(actor, recipeId),
    /** Formulas an actor holds, and whether each copy is ok, stale, or orphaned. */
    formulasFor: actor => researchStore.formulasFor(api, actor),
    refreshFormulas: actor => researchStore.refreshFormulas(api, actor),
    formulaNotices: [],
    /** GM only. See scripts/crafting/craft.js. */
    craft: options => craft(options, api),
    /** GM helper: put `quantity` units of a defined material into an actor's inventory. */
    async giveMaterial(actor, materialId, quantity = 1) {
      const material = api.definitions?.material.get(materialId);
      if (!material) throw new Error(`giveMaterial: unknown material "${materialId}"`);
      return adapter.giveMaterial(actor, material, quantity);
    },
    /** Dry run: validates a selection and shows what would be made. */
    previewCraft: (actor, recipeId, selection, stationId) => previewCraft(actor, recipeId, selection, api, stationId),
    /** Reload definitions. Pass { fresh: true } to also forget cached item lookups. */
    async reload(options) {
      const { registry, errors, uncraftable, resolved, contexts } = await loadAll(options);
      api.definitions = registry;
      api.contexts = contexts;
      api.errors = [...errors, ...stations.readStations(api).errors];
      api.uncraftable = uncraftable;
      api.resolvedOutputs = resolved;
      reportErrors(api.errors);
      api.formulaNotices = await researchStore.refreshAllFormulas(api);
      return { registry, errors: api.errors };
    }
  };
  game.modules.get(MODULE_ID).api = api;
  queueStore.bind(api);
  workshop.bind(api);

  for (const warning of adapter.checkVersions()) {
    console.warn(`${MODULE_ID} | ${warning}`);
    if (game.user.isGM) ui.notifications.warn(`${MODULE_ID}: ${warning}`);
  }

  try {
    await api.reload();
  } catch (err) {
    console.error(`${MODULE_ID} | failed to load definitions`, err);
  }

  if (game.user.isGM) {
    try {
      const added = await auditStore.bootstrap();
      if (added.length) console.log(`${MODULE_ID} | audit baseline created for: ${added.join(", ")}`);
      await announce(api);
    } catch (err) {
      console.error(`${MODULE_ID} | queue/audit startup failed`, err);
    }
  }

  const d = api.definitions;
  console.log(`${MODULE_ID} | ready`, d
    ? `(${d.material.size} materials, ${d.recipe.size} recipes, ${api.errors.length} errors)`
    : "(definitions unavailable)");
});

Hooks.on("createChatMessage", message => {
  handleChatMessage(message).catch(err => console.error(`${MODULE_ID} |`, err));
});

Hooks.on("renderChatMessageHTML", (message, html) => addGrantButton(message, html));

// Compendium recording (best-effort and idempotent; only the one active GM client records, so it happens once).
const isActiveGM = () => game.user.isGM && game.users.activeGM?.id === game.user.id;
Hooks.on("createItem", item => (isActiveGM() ? compendium.onItemCreated(item) : undefined));   // the promise is returned so a test can wait for it; Foundry ignores it
Hooks.on("createCombatant", combatant => (isActiveGM() ? compendium.noteCombat(combatant.parent ?? combatant.combat) : undefined));

/** Tell the GM what is waiting, and open the review window if that is switched on. */
async function announce(api) {
  const rows = queueStore.list();
  const mismatches = auditStore.scan();
  if (rows.length) ui.notifications.info(`${MODULE_ID}: ${rows.length} queued action(s) waiting for review.`);
  if (mismatches.length) ui.notifications.warn(`${MODULE_ID}: audit found ${mismatches.length} actor(s) that do not match the module's log (${mismatches.map(m => m.name).join(", ")}).`);
  if ((rows.length || mismatches.length) && game.settings.get(MODULE_ID, QUEUE_KEYS.autoOpenSetting)) openReview(api);
  else refreshReview();
}

// A player queued something (or an actor's module data changed): the one active GM reacts.
Hooks.on("updateActor", (actor, changes, options, userId) => {
  if (!changes?.flags?.[MODULE_ID] || !game.user.isGM) return;
  if (game.users.activeGM?.id !== game.user.id) return;
  const api = game.modules.get(MODULE_ID).api;
  if (!api) return;
  const run = userId === game.user.id ? () => refreshReview() : () => announce(api);
  Promise.resolve().then(run).catch(err => console.error(`${MODULE_ID} |`, err));
});

// The search relay (socket.js registers it on every client, GM or player, at every moment it could work).
installSocketHooks();
