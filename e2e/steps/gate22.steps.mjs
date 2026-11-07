// Gate 22 (docs/22-tags-item-refs-gate.md): how an item reaches a tagged slot on a real Foundry. Steps 1 to 3, 5 to 8 and 16 are plain blocks (no clicks). Steps 4 and 9 are real DROPS on a
// character sheet: by hand, or by the target's own action when it has one. Steps 10 to 14 click the Player's Hub (open it, choose the formula and what goes in each slot, queue, cancel).
// Target action (ctx.extras), optional:
//   dropOnSheet(actorName, dropData)   drop `dropData` ({ type: "Item", uuid }) on the open or opened character sheet of the named actor through the sheet's real drop handler, so PF2e's own code
//                                      (stacking, _stats) runs; resolves when the created item or the merged quantity can be read. A fake target may create the item itself.
// Without that action Steps 4 and 9 are HAND steps: the runner does nothing there and the person drags (see the bullets in the doc); the block still prints whatever is on the sheet.
// Everything is picked by a stable id (the recipe id, slot name + material id, station id, the queued action's id, or a uuid SETUP saved on the user Test), never by list position.
// No imports, no Node, no closures over the page: only the ctx the runner hands in.

const SMITH = "Gate G22 Smith";
const COMP_UUID = "Compendium.pf2e.equipment-srd.Item.8Jdw4yAzWYylGePS";
const MAIN = ".pfp-main";
const LIVE = ".pfp-live";          // the line at the bottom of the window ("Craft queued", "Cancelled") is the live region, outside the main area
const QUEUED = /Craft queued: Gate G22 Trinket\. (1 day|\d+ days) reserved\./;
const setup = ctx => ctx.state.setup ?? (ctx.state.setup = ctx.driver.evaluate(() => game.users.getName("Test").getFlag("pathfinder-progress", "gateSetup22")));

// Open (or re-target) the Player's Hub on Gate G22 Smith with fresh definitions.
const openHub = async p => {
  await p.evaluate(() => game.modules.get("pathfinder-progress").api.definitions.refresh({ force: true }));
  await p.evaluate(() => { game.modules.get("pathfinder-progress").api.hub.open(game.actors.getName("Gate G22 Smith")); });
  await p.evaluate(() => { const app = foundry.applications.instances.get("pathfinder-progress-hub"); return app?.redraw?.() && undefined; });
};
const choose = async p => {
  await openHub(p);
  await p.seen(/Gate G22 Trinket/, MAIN);      // the list draws a moment after the window opens
  await p.click("select-recipe", '[data-recipe="g22-trinket"]');
};
const fill = async p => {
  await choose(p);
  await p.click("pick-material", '[data-slot="body"][data-material="g22-iron"]');
  await p.click("pick-material", `[data-slot="charm"][data-material="${COMP_UUID}"]`);
  await p.seen(/Gate G22 Bench/, MAIN);
  await p.click("pick-station", '[data-station="g22-bench"]');
};
const queueCraft = async p => {
  await fill(p);
  await p.click("queue-craft");
  await p.seen(QUEUED, LIVE);
};
// The id of the queued craft, read from the character's own queue flag (plain data, no DC): the Cancel button is picked by it.
const queuedCraftId = p => p.evaluate(() => (game.actors.getName("Gate G22 Smith").getFlag("pathfinder-progress", "pendingActions") ?? []).find(a => a.type === "craft")?.id ?? null);
const cancel = async (ctx, p) => {
  const id = await queuedCraftId(p);
  ctx.assert.ok(id, "a craft is queued to cancel");
  if (!/Your queue/.test(await p.text(MAIN))) await p.click("toggle-queue");
  await p.click("cancel-queued", `[data-action-id="${id}"]`);
  await p.seen(/Cancelled: .* Your days and materials are back\./, LIVE);
};

export default {
  before: {
    4: async ctx => {
      if (!ctx.extras?.dropOnSheet) return;
      const s = await setup(ctx);
      await ctx.extras.dropOnSheet(SMITH, { type: "Item", uuid: s.compendium.uuid });      // 7a: the compendium item
      await ctx.extras.dropOnSheet(SMITH, { type: "Item", uuid: s.worldItemUuid });        // 7b: the world item imported from it
      await ctx.extras.dropOnSheet(SMITH, { type: "Item", uuid: s.compendium.uuid });      // 7c: the compendium item again (does PF2e merge the stack?)
    },
    9: async ctx => {
      if (!ctx.extras?.dropOnSheet) return;
      const s = await setup(ctx);
      await ctx.extras.dropOnSheet(SMITH, { type: "Item", uuid: s.worldPlainUuid });       // the PLAIN world item (no source)
    },
    10: async ctx => { await choose(ctx.drivers.player); },
    11: async ctx => { await queueCraft(ctx.drivers.player); },
    12: async ctx => { await cancel(ctx, ctx.drivers.player); },
    13: async ctx => { await queueCraft(ctx.drivers.player); },
    14: async ctx => { await queueCraft(ctx.drivers.player); }
  }
};
