// Gate 20 (docs/20-stage11d-gate.md): the Item editor's click steps, written ONCE against the driver contract (e2e/README.md).
// `before[n]` is what Nate clicks before Step n's block, `after[n]` what he clicks after it. Played by tests/gate20.test.js on the fake Foundry and by the real-Foundry runner.
// No imports, no Node, no closures over the page: only the ctx the player hands in.

const basic = name => `[data-field="basic"][data-name="${name}"]`;
const block = (cls, type, name) => `[data-field="block"][data-cls="${cls}"][data-type="${type}"][data-name="${name}"]`;
const create = name => `[data-field="create"][data-name="${name}"]`;
const PREVIEW = '[data-part="preview"]';
const GATE_KEY = "material:gate-g20-fang";
const EDITOR_ID = "pathfinder-progress-item-editor";

/** Resize the editor window: the target may supply its own (the fake window has no layout engine); a real Foundry window is moved with setPosition. */
const resize = (ctx, width) => (ctx.extras?.resize
  ? ctx.extras.resize(width)
  : ctx.driver.evaluate(w => foundry.applications.instances.get("pathfinder-progress-item-editor").setPosition({ width: w }), width));

const setup = ctx => ctx.state.setup ?? (ctx.state.setup = ctx.driver.evaluate(() => game.users.getName("Test").getFlag("pathfinder-progress", "gateSetup20")));
/** The formula SETUP chose (saved in Test's flag by id), never "the first one in the list": the list order differs between worlds. */
const setupRecipe = async ctx => (await setup(ctx)).recipeId;

export default {
  before: {
    3: async ctx => {
      const d = ctx.driver;
      ctx.state.setup = await setup(ctx);
      await d.evaluate(() => { game.modules.get("pathfinder-progress").api.discovery.openEditor(); });
      await d.pick(ctx.state.setup.pack.key);
    },
    4: async ctx => {
      const d = ctx.driver;
      await d.click("new-material");
      ctx.assert.equal(await d.attr('[data-action="do-create"]', "aria-disabled"), "true");
      await d.seen(/Give it a name first\./);
      await d.set(create("name"), "Gate G20 Fang");
      await d.set(create("tier"), "2");
      await d.click("do-create");
      await d.seen(/Made Gate G20 Fang and an item for it in the world's Items\./);
    },
    5: async ctx => {
      const d = ctx.driver;
      await d.set(basic("value"), "12");
      await d.set(basic("bulk"), "1");
      await d.set(basic("label"), "Parts");
      await d.set(basic("description"), "A fang from a throwaway beast.");
      await d.seen(/You have unsaved changes/);
      await d.seen(/Worth 12 gp each/);
      await d.click("save");
      await d.seen(/Saved Gate G20 Fang\. Use Push to copies/);
      await d.click("push-copies");
      await d.seen(/Write this item's name, image, description, bulk and price onto every copy/);
      ctx.assert.equal(await d.evaluate(() => document.activeElement?.dataset?.action), "confirm-no", "focus lands on the safe answer");
      await d.click("confirm-yes");
    },
    6: async ctx => {
      const d = ctx.driver;
      await d.click("effect-class", '[data-cls="weapon"]');
      await d.click("add-block", '[data-cls="weapon"][data-type="damage"]');
      ctx.assert.equal(await d.attr('[data-action="add-block"][data-type="damage"]', "aria-disabled"), "true");
      await d.seen(/Gate G20 Fang adds \+1d6 fire damage/, PREVIEW);
      await d.click("add-block", '[data-cls="weapon"][data-type="ability"]');
      await d.set(block("weapon", "ability", "title"), "Gate Bite");
      await d.set(block("weapon", "ability", "text"), "The bite lingers.");
      await d.seen(/Gate G20 Fang gives Gate Bite: The bite lingers\./, PREVIEW);
      await d.click("tier-mode", '[data-name="dice"][data-mode="table"]');
      ctx.assert.equal(await d.count('[data-field="cell"]'), 5);
      await d.set('[data-field="cell"][data-tier="2"]', "2d6");
      await d.seen(/adds \+2d6 fire damage/, PREVIEW);
      await d.click("save");
    },
    7: async ctx => {
      const d = ctx.driver;
      await d.click("effect-class", '[data-cls="bomb"]');
      await d.click("add-block", '[data-cls="bomb"][data-type="damage"]');
      await d.set(block("bomb", "damage", "dice"), "1d4");
      await d.set(block("bomb", "damage", "damageType"), "acid");
      await d.click("effect-class", '[data-cls="trinket"]');
      ctx.assert.equal(await d.attr('[data-action="add-block"][data-type="damage"]', "aria-disabled"), "true", "a trinket has no damage block");
      await d.click("add-block", '[data-cls="trinket"][data-type="resistance"]');
      await d.set(block("trinket", "resistance", "value"), "5");
      await d.click("effect-class", '[data-cls="weapon"]');
      await d.set('[data-field="power"][data-cls="weapon"]', "2");
      await d.click("save");
      await d.set('[data-field="preview-class"]', "trinket");
      await d.seen(/Gate G20 Fang gives resistance 5 to fire/, PREVIEW);
      await d.unseen(/fire damage/, PREVIEW);
      await d.set('[data-field="preview-class"]', "weapon");
    },
    8: async ctx => {
      const d = ctx.driver;
      const recipeId = await setupRecipe(ctx);
      await d.click("new-note");
      await d.set(create("name"), "Gate G20 Plan");
      await d.set(create("recipeId"), recipeId);
      await d.set(create("preset"), "plan");
      await d.click("do-create");
      await d.seen(/Made Gate G20 Plan and an item for it/);
      await d.click("new-note");
      await d.set(create("name"), "Gate G20 Research");
      await d.set(create("recipeId"), recipeId);
      await d.set(create("preset"), "research");
      await d.click("do-create");
    },
    10: async ctx => {
      const d = ctx.driver;
      await d.pick(GATE_KEY);
      await d.click("effect-class", '[data-cls="general"]');
      await d.set('[data-field="power"][data-cls="general"]', "1");
      await d.click("save");
      await d.seen(/Gate G20 Scholar already knows something this changes \(what it does in crafts\)\. Save anyway\?/);
      await d.click("confirm-no");
    },
    11: async ctx => {
      const d = ctx.driver;
      await d.click("save");
      await d.click("confirm-yes");
      await d.seen(/Saved Gate G20 Fang\./);
    },
    12: async ctx => {
      const d = ctx.driver;
      await d.pick(ctx.state.setup.pack.key);
      await d.set(basic("name"), `${ctx.state.setup.pack.name} (G20)`);
      await d.click("save");
      await d.seen(/From the packs, with edits made here\. Edited here: name\./);
    },
    13: async ctx => {
      const d = ctx.driver;
      await d.click("revert");
      await d.seen(/Take back every edit made here/);
      await d.click("confirm-yes");
      await d.seen(/Back to the packs' version\./);
    },
    15: async ctx => {
      const d = ctx.driver;
      const entry = '[data-action="pick-item"][data-key="material:gate-g20-delete-me"]';
      await d.set('[data-field="search"]', "delete me", "input");
      await d.pick("material:gate-g20-delete-me");
      await d.click("delete");
      await d.seen(/Delete this item and its world item\? This cannot be undone/);
      await d.click("confirm-yes");
      await d.seen(/It is still in use \(held as 1 in Gate G20 Scholar\), so it was not deleted\. Retire it instead/);
      await d.click("retire");
      await d.seen(/Retired\. It no longer shows in the lists unless you turn on Show retired\./);
      ctx.assert.equal(await d.count(entry), 0, "retired items leave the list");
      await d.click("toggle-chip", '[data-chip="show:retired"]');
      ctx.assert.equal(await d.count(entry), 1, "Show retired brings it back to the list");
      await d.seen(/Gate G20 Delete Me \(Tier 1\)[^▾]*· retired/);
      await d.click("retire");
      await d.seen(/Brought back\./);
      await d.click("toggle-chip", '[data-chip="show:retired"]');
    },
    16: async ctx => {
      const d = ctx.driver;
      await d.click("delete");
      await d.click("confirm-yes");
      await d.seen(/Deleted\./);
    },
    17: async ctx => {
      await ctx.driver.click("export");
      await ctx.driver.seen(/Exported \d+ records?\./);
    },
    18: async ctx => {
      const d = ctx.driver;
      await d.set('[data-field="search"]', "", "input");
      await d.seen(/Leftovers \(1\)[\s\S]*material:g20-orphan is a research track for an item that no longer exists/);
      await d.click("clear-leftover", '[data-key="material:g20-orphan"]');
      await d.seen(/Removed material:g20-orphan\./);
    },
    20: async ctx => {
      await ctx.driver.pick(GATE_KEY);
      await resize(ctx, 300);
    },
    // Steps 22 to 26 (new in 0.21.1; self-contained after a fresh SETUP)
    23: async ctx => {
      const d = ctx.driver;
      // A run of only Steps 22 to 27 has not opened the editor (Step 3 did, in a full run): open it if it is not open.
      await d.evaluate(() => { if (!foundry.applications.instances.get("pathfinder-progress-item-editor")) game.modules.get("pathfinder-progress").api.discovery.openEditor(); });
      const stage = id => d.click("preview-stage", `[data-stage="${id}"]`);
      await d.set('[data-field="search"]', "stage", "input");
      await d.pick("material:gate-g20-study-stage");
      await stage("picked");
      await d.seen(/Tier 2/, PREVIEW); await d.seen(/Worth 25 gp each/, PREVIEW); await d.seen(/Bulk L/, PREVIEW);
      await d.seen(/You haven't studied this yet\./, PREVIEW);
      await d.unseen(/cowardice|1d6|Gate Sting/, PREVIEW);
      await d.seen(/No effects yet: a player learns what it does by crafting with it\./, PREVIEW);
      ctx.assert.equal(await d.count('[data-field="preview-class"]'), 0);
      await stage("studied");
      await d.seen(/Gate G20 Ore: a theme of cowardice\./, PREVIEW); await d.seen(/It works with frightened\./, PREVIEW);
      await d.unseen(/1d6|Gate Sting/, PREVIEW);
      await stage("crafted");
      ctx.assert.equal(await d.count('[data-field="preview-class"]'), 1);
      await d.seen(/Gate G20 Study Stage adds \+1d6 fire damage/, PREVIEW);
      await d.seen(/gives Gate Sting: The sting lingers\./, PREVIEW);
      await d.seen(/sets the weapon's power \(tier 1\)/, PREVIEW);
      await d.set('[data-field="preview-class"]', "armor");
      await d.unseen(/1d6|Gate Sting/, PREVIEW);
      await d.seen(/sets the armor's power \(tier 1\)/, PREVIEW);
      await d.set('[data-field="preview-class"]', "weapon");
      await d.pick("material:gate-g20-plain-stage");
      await stage("picked");
      await d.seen(/Gate G20 Ore: a theme of cowardice\./, PREVIEW);
      await d.unseen(/haven't studied|1d6/, PREVIEW);
      await stage("studied");
      await d.seen(/No study: known on pickup\./, PREVIEW);
      await d.unseen(/cowardice/, PREVIEW);
      await stage("crafted");
    },
    24: async ctx => {
      await ctx.driver.pick("material:gate-g20-study-stage");
      await resize(ctx, 400);
    },
    25: async ctx => {
      const d = ctx.driver;
      await resize(ctx, 1000);
      await d.set('[data-field="search"]', "", "input");
      await d.set('[data-field="search"]', "stage", "input");
      await d.pick("material:gate-g20-study-stage");
      await d.click("effect-class", '[data-cls="weapon"]');
      ctx.assert.match(await d.text("label.pfp-check"), /Persistent/, "the word Persistent is in the label");
      await d.clickSelector("label.pfp-check");
      ctx.assert.equal(await d.prop('input[type="checkbox"]', "checked"), true, "clicking the word ticks the box");
      ctx.assert.equal(await d.evaluate(() => [...document.querySelectorAll('[data-action="save"]')].some(b => b.getAttribute("aria-disabled") !== "true")), true, "Save turns on");
      await d.clickSelector("label.pfp-check");
      ctx.assert.equal(await d.prop('input[type="checkbox"]', "checked"), false);
      await d.clickSelector("label.pfp-check");
      await d.click("discard");
    },
    26: async ctx => {
      const d = ctx.driver;
      await d.click("new-note");
      await d.set(create("name"), "Gate G20 Placeholder");
      await d.seen(/Pick a formula first\./);
    }
  },
  after: {
    26: async ctx => {
      const d = ctx.driver;
      await d.set(create("preset"), "plan");
      await d.set(create("recipeId"), await setupRecipe(ctx));
      ctx.assert.equal(await d.attr('[data-action="do-create"]', "aria-disabled"), null, "Create turns on once a formula is chosen");
      await d.click("cancel-create");
      ctx.assert.equal(await d.evaluate(() => game.modules.get("pathfinder-progress").api.definitions.note.has("gate-g20-placeholder")), false, "Cancel creates nothing");
      await d.click("new-material");
      ctx.assert.equal(await d.evaluate(() => document.querySelector('[data-field="create"][data-name="tier"]').selectedOptions[0].textContent), "Choose a tier");
      await d.seen(/Choose a tier first\./);
      await d.click("cancel-create");
    }
  }
};
