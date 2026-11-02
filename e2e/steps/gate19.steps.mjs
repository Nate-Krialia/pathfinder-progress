// Gate 19 (docs/19-stage11c-gate.md): the discovery chain in the Hub, played against the driver contract (e2e/README.md).
// Target actions (ctx.extras): scriptRolls(actorName, [[degree, total, natural], ...]) fake only; resize(width) the Hub window; noGm(on) take the GM away (a real run closes the GM's
// browser context and reopens it with SETUP's "already set up" path) or bring it back.
const MAIN = ".pfp-main";
const redraw = async ctx => {
  const p = ctx.drivers.player;
  await p.evaluate(() => game.modules.get("pathfinder-progress").api.definitions.refresh({ force: true }));
  await p.evaluate(() => { const app = foundry.applications.instances.get("pathfinder-progress-hub"); return app?.redraw?.() && undefined; });
};
const resize = (ctx, width) => (ctx.extras?.resize ? ctx.extras.resize(width) : ctx.drivers.player.evaluate(w => foundry.applications.instances.get("pathfinder-progress-hub").setPosition({ width: w }), width));

export default {
  before: {
    3: async ctx => { await ctx.drivers.player.evaluate(() => game.modules.get("pathfinder-progress").api.definitions.refresh({ force: true })); },
    4: async ctx => {
      const p = ctx.drivers.player;
      await p.evaluate(() => { game.modules.get("pathfinder-progress").api.hub.open(game.actors.getName("Gate Scholar")); });
      await p.click("switch-tab", '[data-tab="research"]');
    },
    5: async ctx => {
      const p = ctx.drivers.player;
      await p.click("follow-lead", '[data-lead="item:material:g7-b"]');
      await p.seen(/Studying this can teach you what it is good for, and perhaps more\./, MAIN);
      await p.click("set-skill", '[data-skill="crafting"]');
      await p.click("days-up");
      await p.seen(/2 days \(2 checks\)/, MAIN);
      await p.click("queue-research");
    },
    6: async ctx => { await ctx.extras.scriptRolls?.("Gate Scholar", [[3, 25, 15], [2, 25, 15]]); },
    7: async ctx => {
      const p = ctx.drivers.player;
      await p.click("switch-tab", '[data-tab="compendium"]');
      await p.click("select-entry", '[data-entry="g7-b"]');
      await p.seen(/What you know[\s\S]*Gate ore: a theme of cowardice\.[\s\S]*It works with frightened\./, MAIN);
      await p.click("select-entry", '[data-entry="g7-a"]');
      await p.seen(/What you know[\s\S]*You haven't studied this yet\./, MAIN);
      await p.unseen(/cowardice/, MAIN);
      await p.click("switch-tab", '[data-tab="formulae"]');
      await p.click("select-recipe", '[data-recipe="g7-blade"]');
      await p.click("pick-material", '[data-slot="body"][data-material="g7-plain"]');
    },
    9: async ctx => {
      const p = ctx.drivers.player;
      await p.click("switch-tab", '[data-tab="research"]');
      const lead = await p.evaluate(() => game.actors.getName("Gate Scholar").getFlag("pathfinder-progress", "leads").find(l => l.recipeId === "g7-blade2").id);
      await p.seen(/Gate Blade II[\s\S]*What you have learned about Gate ore materials shows how to make a better version\./, MAIN);
      await p.click("follow-lead", `[data-lead="${lead}"]`);
    },
    11: async ctx => {
      const p = ctx.drivers.player;
      await p.click("select-project", '[data-project="study:note:g7-page"]');
      await p.click("put-aside");
      ctx.assert.equal(await p.evaluate(() => document.activeElement?.dataset?.focusKey), "keep-aside", "focus lands on Keep");
      await p.seen(/Put aside\? Your progress is kept\./, MAIN);
      await p.click("confirm-aside");
      await p.seen(/Gate Page[\s\S]*You've started studying Gate Page\. Pick it up again whenever you like\.[\s\S]*Pick the study up again/, MAIN);
      await p.click("follow-lead", '[data-lead="item:note:g7-page"]');
      await p.seen(/Study: Gate Page[\s\S]*Getting somewhere/, MAIN);
    },
    14: async ctx => {
      await ctx.drivers.player.evaluate(() => document.querySelector('[data-action="toggle-display"]').focus());
      await resize(ctx, 300);
    },
    // Step 15 (no block): while the GM is still connected the Player starts Gate Letter, then the GM goes away.
    15: async ctx => {
      const p = ctx.drivers.player;
      await p.click("switch-tab", '[data-tab="research"]');
      await p.click("follow-lead", '[data-lead="item:note:g7-letter"]');
      await ctx.extras.noGm?.(true);
    },
    16: async ctx => {
      const p = ctx.drivers.player;
      await p.click("switch-tab", '[data-tab="compendium"]');
      await p.click("select-entry", '[data-entry="g7-plain"]');
      await p.click("share-entry");
      await p.click("switch-tab", '[data-tab="research"]');
      await p.click("follow-lead", '[data-lead="item:material:g7-plain"]');       // Gate Plain has a track since Step 12
      await p.click("select-project", '[data-project="study:note:g7-letter"]');
      await p.click("put-aside");
      await p.click("confirm-aside");
      await p.click("set-skill", '[data-skill="crafting"]');
      await p.click("queue-research");
    }
  },
  after: {
    6: async ctx => { await redraw(ctx); },
    8: async ctx => { await redraw(ctx); },
    10: async ctx => { await redraw(ctx); },
    12: async ctx => { await redraw(ctx); },
    16: async ctx => { await ctx.extras.noGm?.(false); }
  }
};
