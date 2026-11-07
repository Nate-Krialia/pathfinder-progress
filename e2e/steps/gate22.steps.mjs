// Gate 22 (docs/22-tags-item-refs-gate.md): a PROBE of how an item reaches a tagged slot. Steps 1 to 3 and 5 are plain blocks (no clicks). Step 4 is a real DROP on a character sheet:
// by hand, or by the target's own action when it has one.
// Target action (ctx.extras), optional:
//   dropOnSheet(actorName, dropData)   drop `dropData` ({ type: "Item", uuid }) on the open or opened character sheet of the named actor through the sheet's real drop handler, so PF2e's own code
//                                      (stacking, _stats) runs; resolves when the created item or the merged quantity can be read. A fake target may create the item itself.
// Without that action step 4 is a HAND step: the runner does nothing here and the person drags (see the bullets in the doc); the block still prints whatever is on the sheet.
// The uuids come from SETUP's flag on the user Test (by uuid, never by list position). No imports, no Node, no closures over the page: only the ctx the runner hands in.

const SMITH = "Gate G22 Smith";
const setup = ctx => ctx.state.setup ?? (ctx.state.setup = ctx.driver.evaluate(() => game.users.getName("Test").getFlag("pathfinder-progress", "gateSetup22")));

export default {
  before: {
    4: async ctx => {
      if (!ctx.extras?.dropOnSheet) return;
      const s = await setup(ctx);
      await ctx.extras.dropOnSheet(SMITH, { type: "Item", uuid: s.compendium.uuid });      // 7a: the compendium item
      await ctx.extras.dropOnSheet(SMITH, { type: "Item", uuid: s.worldItemUuid });        // 7b: the world item imported from it
      await ctx.extras.dropOnSheet(SMITH, { type: "Item", uuid: s.compendium.uuid });      // 7c: the compendium item again (does PF2e merge the stack?)
    }
  }
};
