// Gate 24 (docs/24-tags-effects-gate.md): stacking, caps and effects on a real craft. Steps 1 to 3, 10 and 11 are plain blocks (no clicks). Steps 4, 6, 7 and 8 start with the Player queueing the craft in the
// Hub (open it, choose the formula, what goes in each slot, the workshop, Queue the craft); Step 5 reads the weapon's damage formula; Step 9 is two real Strikes and two presses of Apply on the GM's cards.
// Target actions (ctx.extras). Names are the FULL token or item names SETUP made ("Gate G24 Hero"); a target that also takes the short names of gate 21 may accept either:
//   selectToken(name)                      the Player selects this token on the canvas (only it)
//   targetTokens(who, names[])             that user targets exactly these tokens ([] = nobody)
//   strike(outcome, itemName)              the selected token Strikes the targeted one with the item; outcome is the die result to force (success), a real run rolls until it gets it
//   pressApply(match, { degrees })         the GM presses Apply on the newest pending effect card whose text matches; `degrees` is { "<token name>": "failure" | "success" | ... } and forces each NAMED
//                                          target's secret save on its own (the gate 21 `degree` option forces every target alike)
//   damageFormula(tokenName, itemName)     OPTIONAL. The damage formula of the item's strike for that token, as a string, WITHOUT posting a chat card (a real run asks PF2e for the strike's damage
//                                          roll with createMessage false and reads its formula). Without it Step 5 is a hand step: roll damage by hand and read the card.
// Everything is picked by a stable id or name (the recipe id, slot name + uuid, station id, the weapon's name), never by list position. The two uuids come from SETUP's flag on the user Test.
// No imports, no Node, no closures over the page: only the ctx the runner hands in.

const HERO = "Gate G24 Hero";
const WEAPON = "Gate G24 Blade";
const MAIN = ".pfp-main";
const LIVE = ".pfp-live";          // the line at the bottom of the window ("Craft queued") is the live region, outside the main area
const QUEUED = /Craft queued: Gate G24 Blade\. (1 day|\d+ days) reserved\./;
const setup = ctx => ctx.state.setup ?? (ctx.state.setup = ctx.driver.evaluate(() => game.users.getName("Test").getFlag("pathfinder-progress", "gateSetup24")));

const openHub = async p => {
  await p.evaluate(() => game.modules.get("pathfinder-progress").api.definitions.refresh({ force: true }));
  await p.evaluate(() => { game.modules.get("pathfinder-progress").api.hub.open(game.actors.getName("Gate G24 Hero")); });
  await p.evaluate(() => { const app = foundry.applications.instances.get("pathfinder-progress-hub"); return app?.redraw?.() && undefined; });
};
const queueCraft = async (p, s) => {
  await openHub(p);
  await p.seen(/Gate G24 Blade/, MAIN);      // the list draws a moment after the window opens
  await p.click("select-recipe", '[data-recipe="g24-blade"]');
  await p.click("pick-material", '[data-slot="body"][data-material="g24-iron"]');
  await p.click("pick-material", `[data-slot="edge"][data-material="${s.edge}"]`);
  await p.click("pick-material", `[data-slot="charm"][data-material="${s.charm}"]`);
  await p.seen(/Gate G24 Bench/, MAIN);
  await p.click("pick-station", '[data-station="g24-bench"]');
  await p.click("queue-craft");
  await p.seen(QUEUED, LIVE);
};

export default {
  before: {
    4: async ctx => { await queueCraft(ctx.drivers.player, await setup(ctx)); },
    5: async ctx => {
      if (!ctx.extras?.damageFormula) return;
      const formula = await ctx.extras.damageFormula(HERO, WEAPON);
      await ctx.driver.evaluate(value => { globalThis.__g24.formula = value; }, formula);
    },
    6: async ctx => { await queueCraft(ctx.drivers.player, await setup(ctx)); },
    7: async ctx => { await queueCraft(ctx.drivers.player, await setup(ctx)); },
    8: async ctx => { await queueCraft(ctx.drivers.player, await setup(ctx)); },
    9: async ctx => {
      const x = (name, ...args) => ctx.extras[name](...args);
      await x("selectToken", HERO);
      await x("targetTokens", "player", ["Gate G24 Goblin A"]);
      await x("strike", "success", WEAPON);
      await x("pressApply", WEAPON, { degrees: { "Gate G24 Goblin A": "failure" } });
      await x("targetTokens", "player", ["Gate G24 Goblin B"]);
      await x("strike", "success", WEAPON);
      await x("pressApply", WEAPON, { degrees: { "Gate G24 Goblin B": "success" } });
    }
  }
};
