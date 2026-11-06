// Gate 17 (docs/17-stage11a-gate.md): the Hub's queue clicks (steps 20, 23, 26) and the wait for the "Craft queued" line to clear (step 22), written ONCE against the driver
// contract (e2e/README.md). Every other step of gate 17 stays a hand step (the 24 look steps are a screenshot gallery for a person to review; step 38 is keyboard-only).
// Every control is picked by a stable id from the doc (data-recipe, data-slot + data-material, data-station, data-action-id), never by position in a list.
// No imports, no Node, no closures over the page: only the ctx the runner hands in.

const SMITH = "Gate Smith";
const BLADE = "g5-blade";
const STATION = "g5-bench";
const QUEUED = /Craft queued: Gate Blade\. (1 day|\d+ days) reserved\./;
const MAIN = ".pfp-main";
const LIVE = ".pfp-live";          // the line at the bottom of the window ("Craft queued", "Cancelled") is the live region, outside the main area

// Open (or re-target) the Hub on Gate Smith, then fill Gate Blade's two slots and the workshop. The clicks are the ones the step tells a person to make.
const fill = async (ctx, body, edge) => {
  const p = ctx.drivers.player;
  await p.evaluate(name => { game.modules.get("pathfinder-progress").api.hub.open(game.actors.getName(name)); }, SMITH);
  await p.click("select-recipe", `[data-recipe="${BLADE}"]`);
  await p.click("pick-material", `[data-slot="body"][data-material="${body}"]`);
  await p.click("pick-material", `[data-slot="edge"][data-material="${edge}"]`);
  // The player's definitions follow the GM's change of town by themselves in a real world; asking again here makes the fake and a slow real run agree, then the window redraws.
  await p.evaluate(() => game.modules.get("pathfinder-progress").api.definitions.refresh({ force: true }));
  await p.evaluate(() => { const app = foundry.applications.instances.get("pathfinder-progress-hub"); return app?.redraw?.() && undefined; });
  await p.seen(/Gate Bench/, MAIN);
  await p.click("pick-station", `[data-station="${STATION}"]`);
};

// The id of the queued craft, read from the character's own queue flag (plain data, no DC): the Cancel button is picked by it.
const queuedCraftId = ctx => ctx.drivers.player.evaluate(
  name => (game.actors.getName(name).getFlag("pathfinder-progress", "pendingActions") ?? []).find(a => a.type === "craft")?.id ?? null, SMITH);

export default {
  after: {
    20: async ctx => {
      await fill(ctx, "g5-ore", "g5-steel");
      await ctx.drivers.player.click("queue-craft");
      await ctx.drivers.player.seen(QUEUED, LIVE);
      ctx.assert.ok(await queuedCraftId(ctx), "step 20 queued a craft");
      await ctx.drivers.player.click("toggle-queue");
      await ctx.drivers.player.seen(/Your queue/, MAIN);
    },
    // The GM resolved it (step 21); the line must clear by itself. Up to 12 seconds (it also fades on its own after about 10).
    22: async ctx => {
      const p = ctx.drivers.player;
      let line = await p.text(LIVE);
      for (let waited = 0; QUEUED.test(line) && waited < 12000; waited += 250) { await ctx.wait(250); line = await p.text(LIVE); }
      ctx.assert.ok(!QUEUED.test(line), "the 'Craft queued' line cleared by itself");
      ctx.assert.match(await p.text(MAIN), /Nothing queued/);
    },
    23: async ctx => {
      await fill(ctx, "g5-ore", "g5-star");
      await ctx.drivers.player.click("queue-craft");
      await ctx.drivers.player.seen(QUEUED, LIVE);
      await ctx.drivers.player.seen(/1 queued/, MAIN);
      ctx.assert.ok(await queuedCraftId(ctx), "step 23 queued a craft");
    },
    26: async ctx => {
      const p = ctx.drivers.player;
      await fill(ctx, "g5-ore", "g5-ember");
      await p.click("queue-craft");
      await p.seen(QUEUED, LIVE);
      const id = await queuedCraftId(ctx);
      ctx.assert.ok(id, "step 26 queued a craft");
      if (!/Your queue/.test(await p.text(MAIN))) await p.click("toggle-queue");
      await p.click("cancel-queued", `[data-action-id="${id}"]`);
      await p.seen(/Cancelled: .* Your days and materials are back\./, LIVE);
      await p.seen(/Nothing queued/, MAIN);
      ctx.assert.equal(await queuedCraftId(ctx), null, "the queue is empty again");
    }
  }
};
