// Gate 18 (docs/18-stage11b-gate.md): the Hub's Research and Compendium tabs, played against the driver contract (e2e/README.md).
// Player = the Hub; GM = the queue review window (Step 21). Target actions (ctx.extras, all optional where marked):
//   scriptRolls(actorName, [[degree, total, natural], ...])   fake only: queue the dice the GM's resolve will use (a real Foundry rolls its own)
//   statusMs(ms)                                              fake only: shorten how long the Hub's status line lasts (a real line lasts about 10 s)
//   clearChat()                                               fake only: forget earlier chat so Step 22 sees only what the rejection posted
//   resize(width)                                             the Hub window's width (jsdom has no layout engine; a real window is moved with setPosition)
const MAIN = ".pfp-main";
const LIVE = ".pfp-live";

const redraw = ctx => ctx.drivers.player.evaluate(() => { const app = foundry.applications.instances.get("pathfinder-progress-hub"); return app?.redraw?.() && undefined; });
const resize = (ctx, width) => (ctx.extras?.resize ? ctx.extras.resize(width) : ctx.drivers.player.evaluate(w => foundry.applications.instances.get("pathfinder-progress-hub").setPosition({ width: w }), width));

export default {
  before: {
    3: async ctx => { await ctx.drivers.player.evaluate(() => game.modules.get("pathfinder-progress").api.definitions.refresh()); },
    4: async ctx => {
      const p = ctx.drivers.player;
      await p.evaluate(() => { game.modules.get("pathfinder-progress").api.hub.open(game.actors.getName("Gate Scholar")); });
      await p.click("switch-tab", '[data-tab="research"]');
      await p.seen(/Gate Draught[\s\S]*Gate Giant|Gate Giant[\s\S]*Gate Draught/, MAIN);
      await p.seen(/Leads you could follow/, MAIN);
    },
    5: async ctx => {
      const p = ctx.drivers.player;
      await p.click("select-project", '[data-project="unlock-g6-draught"]');
      await p.seen(/Finishing teaches you the formula for Gate Draught\./, MAIN);
      await p.seen(/Crafting[\s\S]*Your modifier [+-]\d+[\s\S]*Nature[\s\S]*Your modifier [+-]\d+/, MAIN);
      ctx.assert.equal(await p.attr('[data-action="queue-research"]', "aria-disabled"), "true");
      await p.seen(/Choose a skill to roll with first\./, MAIN);
      await p.click("set-skill", '[data-skill="crafting"]');
      await p.click("days-up"); await p.click("days-up");
      await p.seen(/3 days \(3 checks\)/, MAIN);
      await ctx.extras.statusMs?.(60);                  // the real line lasts 10 s; here it is gone long before the block runs, as when the tester is slow
      await p.click("queue-research");
      if (ctx.extras.statusMs) { await ctx.wait(250); ctx.assert.equal(await p.text(LIVE), "", "the line has timed out on screen"); }   // ... and the block still passes: it reads the recorder
    },
    6: async ctx => { await ctx.extras.statusMs?.(10000); await ctx.extras.scriptRolls?.("Gate Scholar", [[3, 31, 19], [2, 22, 11], [1, 9, 4]]); },
    7: async ctx => { await redraw(ctx); },
    8: async ctx => { const p = ctx.drivers.player; await p.click("queue-research"); await p.click("cancel-queued"); },
    9: async ctx => {
      const p = ctx.drivers.player;
      await p.click("select-project", '[data-project="unlock-g6-giant"]');
      await p.click("put-aside");
      ctx.assert.equal(await p.evaluate(() => document.activeElement?.dataset?.focusKey), "keep-aside", "focus lands on Keep");
      await p.seen(/Put aside\? Progress is not kept\./, MAIN);
      await p.click("keep-aside");
      ctx.assert.equal(await p.evaluate(() => document.activeElement?.dataset?.focusKey), "put-aside", "Keep returns focus to the Put aside button");
      await p.click("put-aside");
      await p.click("confirm-aside");
    },
    10: async ctx => { await ctx.drivers.player.click("follow-lead"); },
    11: async ctx => {
      const p = ctx.drivers.player;
      await p.click("switch-tab", '[data-tab="formulae"]');
      await p.click("open-in-research", '[data-project="unlock-g6-draught"]');
    },
    13: async ctx => { await redraw(ctx); },
    15: async ctx => { const p = ctx.drivers.player; await p.click("switch-tab", '[data-tab="compendium"]'); await p.seen(/Materials 2/, MAIN); },
    16: async ctx => {
      const p = ctx.drivers.player;
      await p.click("select-entry", '[data-entry="g6-ore"]');
      await p.seen(/Tier 1[\s\S]*Gate Field[\s\S]*a basic find[\s\S]*a better find/, MAIN);
      await p.click("select-entry", '[data-entry="g6-star"]');
      await p.seen(/No places recorded yet\.[\s\S]*You haven't gathered it from a node yet\./, MAIN);
      await p.click("set-category", '[data-category="creatures"]');
      await p.click("select-entry", '[data-entry="gate-wolf"]');
      await p.seen(/Type: beast[\s\S]*Gate Fang/, MAIN);
      await p.click("set-category", '[data-category="regions"]');
      await p.click("select-entry", '[data-entry="g6-field"]');
      await p.seen(/Gate Bush/, MAIN);
      await p.click("set-category", '[data-category="experiments"]');
      await p.click("select-entry", '[data-entry="g6-blade"]');
    },
    17: async ctx => {
      const p = ctx.drivers.player;
      await p.click("set-category", '[data-category="materials"]');
      await p.click("select-entry", '[data-entry="g6-ore"]');
      await p.click("share-entry");
      await p.seen(/Waiting for the GM to approve sharing it\./, MAIN);
      ctx.assert.match(await p.text(LIVE), /^Share queued: Gate Ore\. Waiting for the GM\.$/);
      await p.click("cancel-queued");
      ctx.assert.match(await p.text(LIVE), /^Share cancelled: Gate Ore\. It stays private\.$/);
      await p.click("share-entry");
      await p.click("select-entry", '[data-entry="g6-star"]');
      await p.click("share-entry");
    },
    19: async ctx => {
      const p = ctx.drivers.player;
      await ctx.wait(40);
      await redraw(ctx);
      await p.seen(/Shared[\s\S]*Everyone in the party can read this\.|Only you/, MAIN);
    },
    20: async ctx => {
      const p = ctx.drivers.player;
      await p.click("set-category", '[data-category="creatures"]');
      await p.click("select-entry", '[data-entry="gate-wolf"]');
      await p.click("share-entry");
    },
    // Step 21 has no block: the GM rejects the wolf share by CLICKING in the queue review window.
    21: async ctx => {
      const g = ctx.drivers.gm;
      const row = await g.evaluate(() => { const api = game.modules.get("pathfinder-progress").api; const r = api.queue.list([game.actors.getName("Gate Scholar")]).find(x => x.action.type === "share"); return { id: r.action.id, label: r.label }; });
      ctx.assert.match(row.label, /^Share: Gate Wolf \(creature\)$/);
      await ctx.extras.clearChat?.();
      await g.evaluate(() => { game.modules.get("pathfinder-progress").api.openReview(); });
      await g.click("reject", `[data-action-id="${row.id}"]`);
      ctx.assert.equal(await g.evaluate(() => game.modules.get("pathfinder-progress").api.queue.list([game.actors.getName("Gate Scholar")]).length), 0, "the row left the queue window");
      await g.evaluate(() => foundry.applications.instances.get("pathfinder-progress-review")?.close() && undefined);
      await redraw(ctx);                                                   // (in Foundry the live update does this)
    },
    22: async ctx => { await redraw(ctx); },
    23: async ctx => { await ctx.drivers.player.evaluate(() => document.querySelector('[data-action="toggle-display"]').focus()); },
    24: async ctx => { await resize(ctx, 300); }
  },
  after: {
    6: async ctx => { await ctx.wait(40); },
    22: async ctx => { await ctx.drivers.player.seen(/Gate Wolf[\s\S]*Only you can read this\./, MAIN); }
  }
};
