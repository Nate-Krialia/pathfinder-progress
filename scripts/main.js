import { MODULE_ID } from "./config.js";
import * as adapter from "./adapter.js";
import { handleChatMessage, addGrantButton, getXp, getTier } from "./xp.js";

Hooks.once("init", () => {
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
});

Hooks.once("ready", () => {
  game.modules.get(MODULE_ID).api = { getXp, getTier, adapter };
  console.log(`${MODULE_ID} | ready`);
});

Hooks.on("createChatMessage", message => {
  handleChatMessage(message).catch(err => console.error(`${MODULE_ID} |`, err));
});

Hooks.on("renderChatMessageHTML", (message, html) => addGrantButton(message, html));
