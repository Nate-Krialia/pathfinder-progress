// Gate 23 (docs/23-tags-window-gate.md), the cut-down gate for the Item tags window. Steps 1 to 5 and 7 are plain blocks in the GM window: they find the window's own elements by their data-action and
// data-field ids INSIDE the window's root element, send the same change event a person's edit sends and click with the element's own click(); the scene-controls button and the item sheet's header button are
// found and clicked the same way. No kit action is needed for them. Step 6 is the Player's window: the Hub is opened and the formula chosen first (below), then the block looks at the Fang slot.
// Everything is picked by a stable id or name (the recipe id, the slot name, the item's uuid), never by list position.
// No imports, no Node, no closures over the page: only the ctx the runner hands in.

const MAIN = ".pfp-main";

export default {
  before: {
    6: async ctx => {
      const p = ctx.drivers.player;
      await p.evaluate(() => game.modules.get("pathfinder-progress").api.definitions.refresh({ force: true }));
      await p.evaluate(() => { game.modules.get("pathfinder-progress").api.hub.open(game.actors.getName("Gate G23 Scout")); });
      await p.evaluate(() => { const app = foundry.applications.instances.get("pathfinder-progress-hub"); return app?.redraw?.() && undefined; });
      await p.seen(/Spider Fang Dagger/, MAIN);      // the list draws a moment after the window opens
      await p.click("select-recipe", '[data-recipe="dagger-spider-fang"]');
    }
  }
};
