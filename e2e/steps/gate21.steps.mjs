// Gate 21 (docs/21-stage11d-effects-gate.md): the effect builder's click steps (3-6) and the real-Foundry steps (12-24), written ONCE against the driver contract (e2e/README.md).
// Steps 3-6 are plain clicks on the Item editor. Steps 12-24 act on the canvas (select a token, target a token), make a real Strike, use a real consumable and press Apply
// on the GM's card: those are NAMED ACTIONS the target supplies as `ctx.extras` (the fake Foundry feeds probe-shaped messages; the real runner clicks the canvas and rolls real PF2e).
// The actions (all take plain names of tokens/items from SETUP; none carries a DC or a save):
//   selectToken(name)                      the Player selects this token on the canvas (only it)
//   targetTokens(who, names[])             that user targets exactly these tokens ([] = nobody)
//   strike(outcome, itemName)              the selected token Strikes the targeted one with the item; outcome is the die result to force (success / criticalFailure), a real run rolls until it gets it or asks the GM to
//   useConsumable(names[])                 the selected token uses the Draught on these targets ([] = nobody targeted)
//   pressApply(match, { degree, degrees }) the GM presses Apply on the newest pending effect card whose text matches (degree forces the secret save's result for every target;
//                                          degrees is { "Goblin A": "failure", "Goblin B": "success" }: it forces each NAMED goblin's save on its own, a real run sets each target's roll before pressing Apply)
//   pressApplyRefused()                    the GM presses Apply on the fallback card with nothing targeted: it must refuse and leave the card
//   advance(ms)                            let the "same card" window pass (the module's duplicate guard)
// No imports, no Node, no closures over the page: only the ctx the player hands in.

const block = (cls, name, index) => `[data-field="block"][data-cls="${cls}"][data-type="condition"][data-name="${name}"][data-index="${index}"]`;
const create = name => `[data-field="create"][data-name="${name}"]`;
const resize = (ctx, width) => (ctx.extras?.resize
  ? ctx.extras.resize(width)
  : ctx.driver.evaluate(w => foundry.applications.instances.get("pathfinder-progress-item-editor").setPosition({ width: w }), width));
const x = (ctx, name, ...args) => ctx.extras[name](...args);

export default {
  before: {
    3: async ctx => {
      const d = ctx.driver;
      await d.evaluate(() => { game.modules.get("pathfinder-progress").api.discovery.openEditor(); });
      await d.click("new-material");
      await d.set(create("name"), "Gate G21 Fang");
      await d.set(create("tier"), "2");
      await d.click("do-create");
      await d.click("effect-class", '[data-cls="weapon"]');
      await d.click("add-block", '[data-cls="weapon"][data-type="condition"]');
      ctx.assert.equal(await d.prop(block("weapon", "condition", 0), "value"), "frightened");
      ctx.assert.equal(await d.prop(block("weapon", "save", 0), "value"), "will");
      await d.click("add-block", '[data-cls="weapon"][data-type="condition"]');
      ctx.assert.equal(await d.prop(block("weapon", "condition", 1), "value"), "sickened");
      await d.set(block("weapon", "save", 0), "fortitude");
      await d.click("tier-mode", '[data-index="0"][data-type="condition"][data-mode="table"]');
      await d.set('input[data-field="cell"][data-type="condition"][data-index="0"][data-tier="2"]', "2");
      await d.set(block("weapon", "condition", 1), "prone");
      await d.set(block("weapon", "save", 1), "none");
      ctx.assert.equal(await d.count('[data-type="condition"][data-index="1"][data-name="value"]'), 0, "a condition with no save has no value box");
    },
    5: async ctx => { await resize(ctx, 400); },
    6: async ctx => { await resize(ctx, 1000); await ctx.driver.click("save"); },
    // 12-13: two misses
    12: async ctx => { await x(ctx, "selectToken", "Hero"); await x(ctx, "targetTokens", "player", ["Goblin A"]); },
    14: async ctx => { await x(ctx, "targetTokens", "player", ["Goblin A"]); },
    16: async ctx => { await x(ctx, "targetTokens", "player", ["Goblin A"]); },
    18: async ctx => { await x(ctx, "targetTokens", "player", ["Goblin A"]); },
    20: async ctx => { await x(ctx, "advance", 20000); await x(ctx, "targetTokens", "player", ["Goblin A"]); },
    22: async ctx => { await x(ctx, "advance", 20000); await x(ctx, "targetTokens", "player", []); }
  },
  after: {
    12: async ctx => { await x(ctx, "strike", "criticalFailure", "Sword"); await x(ctx, "strike", "criticalFailure", "Sword"); },
    14: async ctx => { await x(ctx, "strike", "success", "Sword"); await x(ctx, "pressApply", "Mitflit Sword", { degree: "failure" }); },
    16: async ctx => { await x(ctx, "strike", "success", "Bomb"); await x(ctx, "pressApply", "Mitflit Bomb", {}); },
    18: async ctx => { await x(ctx, "strike", "criticalFailure", "Bomb"); },
    20: async ctx => { await x(ctx, "useConsumable", ["Goblin A"]); await x(ctx, "pressApply", "Draught", {}); },
    22: async ctx => {
      await x(ctx, "useConsumable", []);
      await x(ctx, "pressApplyRefused");
      await x(ctx, "targetTokens", "gm", ["Goblin A", "Goblin B"]);
      // Step 23's mixed result: A fails its save, B passes. Both are cleared first so the condition is the card's own work; the block then expects exactly that.
      await ctx.drivers.gm.evaluate(async () => { const g = globalThis.__g21; g.forcedMixed = true; for (const name of ["Goblin A", "Goblin B"]) await g.clear(g.token(name).actor); });
      await x(ctx, "pressApply", "no one is targeted", { degrees: { "Goblin A": "failure", "Goblin B": "success" }, fallback: true });
    }
  }
};
