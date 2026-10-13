import { MODULE_ID } from "./config.js";
import { handleChatMessage, getXp, getTier } from "./xp.js";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "paused", {
    name: "Pause XP awards",
    hint: "When ticked, no skill XP is awarded.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
});

Hooks.once("ready", () => {
  game.modules.get(MODULE_ID).api = { getXp, getTier };
  console.log(`${MODULE_ID} | ready`);
});

Hooks.on("createChatMessage", message => {
  handleChatMessage(message).catch(err => console.error(`${MODULE_ID} |`, err));
});
