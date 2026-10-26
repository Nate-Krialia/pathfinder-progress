import { MODULE_ID } from "./config.js";
import * as adapter from "./adapter/pf2e.js";
import { loadAll, reportErrors } from "./data/loader.js";
import { resolveMaterialEffect } from "./data/resolver.js";
import { craft, previewCraft } from "./crafting/craft.js";
import * as stations from "./stations/store.js";
import * as gathering from "./gathering/store.js";
import * as researchStore from "./research/store.js";
import { STATION_KEYS } from "./config.js";
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
    refillNode: (node, charges) => gathering.refillNode(api, node, charges),
    makeCorpseNode: (node, spec) => gathering.makeCorpseNode(api, node, spec),
    clearNode: node => gathering.clearNode(node),
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

  for (const warning of adapter.checkVersions()) {
    console.warn(`${MODULE_ID} | ${warning}`);
    if (game.user.isGM) ui.notifications.warn(`${MODULE_ID}: ${warning}`);
  }

  try {
    await api.reload();
  } catch (err) {
    console.error(`${MODULE_ID} | failed to load definitions`, err);
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
