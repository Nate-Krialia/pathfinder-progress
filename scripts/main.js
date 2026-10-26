import { MODULE_ID } from "./config.js";
import * as adapter from "./adapter/pf2e.js";
import { loadAll, reportErrors } from "./data/loader.js";
import { resolveMaterialEffect } from "./data/resolver.js";
import { craft, previewCraft } from "./crafting/craft.js";
import { handleChatMessage, addGrantButton, getXp, getTier } from "./skill-xp/xp.js";

Hooks.once("init", () => {
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
    /** GM only. See scripts/crafting/craft.js. */
    craft: options => craft(options, api),
    /** GM helper: put `quantity` units of a defined material into an actor's inventory. */
    async giveMaterial(actor, materialId, quantity = 1) {
      const material = api.definitions?.material.get(materialId);
      if (!material) throw new Error(`giveMaterial: unknown material "${materialId}"`);
      return adapter.giveMaterial(actor, material, quantity);
    },
    /** Dry run: validates a selection and shows what would be made. */
    previewCraft: (actor, recipeId, selection) => previewCraft(actor, recipeId, selection, api),
    /** Reload definitions. Pass { fresh: true } to also forget cached item lookups. */
    async reload(options) {
      const { registry, errors, uncraftable, resolved } = await loadAll(options);
      api.definitions = registry;
      api.errors = errors;
      api.uncraftable = uncraftable;
      api.resolvedOutputs = resolved;
      reportErrors(errors);
      return { registry, errors };
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
