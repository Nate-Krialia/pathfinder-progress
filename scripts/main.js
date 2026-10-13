const MODULE_ID = "pathfinder-progress";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | ready`);
  ui.notifications.info("Pathfinder Progress is loaded!");
});
