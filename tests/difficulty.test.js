/**
 * Hidden difficulty (docs/11b, A): players NEVER see a DC, odds, a percentage or difficulty wording; the GM does. These tests walk the
 * RETURN VALUES (keys at any depth, and strings) of everything a player can call, the messages a player is sent, and the definitions a
 * player client holds, and prove the GM gets the full detail for the same items.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DAGGER, M, SEL, as, craft, env, getApi, loudly, makeActor, resolve, world } from "./fake-world.js";
import * as gmLog from "../scripts/gm-log.js";
import { chatLeaks } from "./helpers.js";
import { HIDDEN_FIELDS, playerProject, withoutDifficulty } from "../scripts/difficulty.js";
import { BAD, findings } from "./scan.js";

const api = () => getApi();
const roll = (degree, total, natural) => ({ options: { degreeOfSuccess: degree }, total, dice: [{ faces: 20, results: [{ result: natural, active: true }] }] });

async function playerWorld(options = {}) {
  const w = await world({ perClientDefinitions: true, downtime: 12, iron: 5, fang: 5, copper: 20000, ...options });
  await api().giveMaterial(w.ann, "silver", 4);
  await api().giveMaterial(w.ann, "starmetal", 4);
  await api().tagScene(w.table, "oak-wood");
  await api().placeAnchors(3, { scene: w.table });
  await addNodeFor(w);
  await as(w.annUser, () => api().definitions.refresh());
  return w;
}
async function addNodeFor(w) {
  const { addNode } = await import("./fake-world.js");
  const { token } = await addNode(w.table, { nodeType: "herb", region: "oak-wood", charges: 3 });
  w.herb = token;
}

test("the scanner itself: it catches a hidden field and a DC, an odds figure, a percentage or a difficulty word, and spares an item's own rules text", () => {
  assert.deepEqual(findings({ detail: "survival +5; 2 day(s)", status: "ok" }), []);
  assert.equal(findings({ dc: 18 }).length, 1);
  assert.equal(findings({ nested: [{ odds: {} }] }).length, 1);
  for (const text of ["vs DC 18", "crit 5% / success 35%", "about 65 %", "the odds are good", "a 10% chance", "difficulty scales", "expect ~3 nodes", "expected days 4"]) assert.equal(findings({ detail: text }).length, 1, text);
  assert.deepEqual(findings({ effects: { specialAbility: { text: "a DC 18 Fortitude save" } } }), [], "the item's own save DC is its rule text, not the roll's difficulty");
});

test("GM vs PLAYER, the SAME explore item: the GM's row has the DC and the odds, the player's row is plain (days, skill, status)", async () => {
  const w = await playerWorld();
  const action = await as(w.annUser, () => api().queue.submit(w.ann, "explore", { region: "oak-wood", skill: "survival" }, 2));
  const rowOf = user => as(user, () => api().queue.list()).find(r => r.action.id === action.id);
  const gm = rowOf(w.gm), player = rowOf(w.annUser);
  assert.match(gm.detail, /survival \+5 vs DC 18: crit \d+% \/ success \d+% \/ fail \d+% \/ crit-fail \d+%, expect ~\d+\.\d nodes/, "the GM still sees everything");
  assert.equal(gm.label, "Explore: Oak Wood");
  assert.deepEqual([player.label, player.detail, player.problem], ["Explore: Oak Wood", "survival; 2 day(s)", null]);
  assert.deepEqual(findings(player), []);
  assert.deepEqual(findings(player.action), [], "and the action object it carries");
  assert.deepEqual(findings(action), [], "and the action the submit returned");
});

test("GM vs PLAYER, the SAME research item: the GM's row has the DC; the player's keeps the progress (current/needed) but not the DC", async () => {
  const w = await playerWorld();
  const project = await api().startProject({ actor: w.ann, recipe: "longsword-basic" });
  const action = await as(w.annUser, () => api().queue.submit(w.ann, "research", { projectId: project.id, skill: "crafting" }, 1));
  const rowOf = user => as(user, () => api().queue.list()).find(r => r.action.id === action.id);
  assert.match(rowOf(w.gm).detail, /^crafting, DC \d+, progress 0\/\d+$/);
  assert.match(rowOf(w.annUser).detail, /^crafting, progress 0\/\d+$/);
  assert.deepEqual(findings(rowOf(w.annUser)), []);
});

test("projectInfo: the GM gets the DC, the per-skill chances and the expected days; a player gets the project without its DC and only their own modifier", async () => {
  const w = await playerWorld();
  const project = await api().startProject({ actor: w.ann, recipe: "longsword-basic" });
  const gm = as(w.gm, () => api().projectInfo(w.ann, project.id));
  assert.ok(gm.project.dc > 0, "the DC"); const crafting = gm.perSkill.find(s => s.skill === "crafting"); assert.ok(crafting.chances && crafting.expectedDaysToFinish > 0, JSON.stringify(gm.perSkill));
  const player = as(w.annUser, () => api().projectInfo(w.ann, project.id));
  assert.deepEqual(findings(player), []);
  assert.deepEqual(player.perSkill, [{ skill: "arcana", modifier: null }, { skill: "crafting", modifier: 5 }, { skill: "occultism", modifier: null }]);
  assert.equal(player.project.progress, 0);
  assert.equal(player.project.threshold, gm.project.threshold, "progress stays: it is progress, not difficulty");
  assert.deepEqual(findings(as(w.annUser, () => api().projectInfo(w.ann))), [], "the list form too");
});

test("a project a player is handed over the socket (upgrade, design) has no DC; the stored record and the GM's copy keep it", async () => {
  const w = await playerWorld();
  const upgrade = await as(w.annUser, () => api().workshop.startUpgrade(w.ann, { stationId: "oakhaven-forge", kind: "craftDays", materials: { iron: 2 } }));
  const design = await as(w.annUser, () => api().workshop.startDesign(w.ann, { blueprint: "camp-forge" }));
  assert.deepEqual([findings(upgrade), findings(design)], [[], []]);
  assert.ok(upgrade.threshold > 0 && upgrade.progress === 0);
  const stored = w.ann.getFlag(M, "projects").find(p => p.id === upgrade.id);
  assert.ok(stored.dc > 0, "honor system: Foundry stores it on the actor and delivers it; the module simply does not hand it over");
  const asGM = await as(w.gm, () => api().workshop.startUpgrade(w.bob, { stationId: "oakhaven-forge", kind: "craftDays", materials: { iron: 2 } }).catch(e => e));
  void asGM;
  assert.deepEqual(withoutDifficulty(playerProject(stored)), withoutDifficulty(stored));
});

test("EVERYTHING A PLAYER CAN CALL: the return values carry no hidden field and no difficulty wording", async () => {
  const w = await playerWorld();
  const seen = {};
  const take = (label, value) => { seen[label] = value; };
  const ann = w.annUser;
  take("previewCraft unknown", as(ann, () => api().previewCraft(w.ann, DAGGER, { blade: "silver", fang: "spider-fang" }, "oakhaven-forge")));
  take("previewCraft errors", as(ann, () => api().previewCraft(w.ann, DAGGER, { blade: "iron" }, "oakhaven-forge")));
  take("previewCraft not held", as(ann, () => api().previewCraft(w.ann, "longsword-basic", {})));
  take("stationsFor", as(ann, () => api().stationsFor(w.ann, DAGGER)));
  take("formulasFor", as(ann, () => api().formulasFor(w.ann)));
  const craftAction = await craft(w, ann, w.ann, {});
  take("craft submit", craftAction);
  const gatherAction = await as(ann, () => api().queue.submit(w.ann, "gather", { sceneId: w.table.id, tokenId: w.herb.id, skill: "survival" }));
  take("gather submit", gatherAction);
  const exploreAction = await as(ann, () => api().queue.submit(w.ann, "explore", { region: "oak-wood", skill: "survival" }, 2));
  take("explore submit", exploreAction);
  const project = await api().startProject({ actor: w.ann, recipe: "longsword-basic" });
  take("research submit", await as(ann, () => api().queue.submit(w.ann, "research", { projectId: project.id, skill: "crafting" }, 1)));
  take("projectInfo", as(ann, () => api().projectInfo(w.ann, project.id)));
  take("projectInfo list", as(ann, () => api().projectInfo(w.ann)));
  take("queue.list", as(ann, () => api().queue.list()));
  take("startUpgrade", await as(ann, () => api().workshop.startUpgrade(w.ann, { stationId: "oakhaven-forge", kind: "hearth", materials: { iron: 2 } })));
  take("startDesign", await as(ann, () => api().workshop.startDesign(w.ann, { blueprint: "camp-forge" })));
  take("putAside", await as(ann, () => api().workshop.putAside(w.ann, "upgrade-oakhaven-forge-hearth-1")));
  take("cancel", await as(ann, () => api().queue.cancel(w.ann, gatherAction.id)));
  take("compendium.view", as(ann, () => api().compendium.view(w.ann)));
  take("definitionsStatus", as(ann, () => api().definitionsStatus()));
  take("the player's definitions", Object.fromEntries(Object.entries(as(ann, () => api().definitions)).map(([k, m]) => [k, [...m.values()]])));
  // a result played through, then what the player's queue and Compendium say
  await resolve(w.ann, craftAction.id, { degree: "success" });
  take("previewCraft after a success", as(ann, () => api().previewCraft(w.ann, DAGGER, SEL, "oakhaven-forge")));
  take("compendium.view after a success", as(ann, () => api().compendium.view(w.ann)));
  const problems = Object.entries(seen).flatMap(([label, value]) => findings(value, label));
  assert.deepEqual(problems, []);
  assert.ok(Object.keys(seen).length >= 20, "the walk covered the surfaces");
});

test("EVERYTHING A PLAYER IS SENT: NO chat message has a DC or a total, whoever it is whispered to; the GM reads them from the GM log", async () => {
  const w = await playerWorld();
  gmLog.clear();
  const project = await api().startProject({ actor: w.ann, recipe: "longsword-basic" });
  await api().grantDays(w.ann, 10);
  w.ann.rolls.push(roll(3, 31, 19), roll(2, 22, 11));
  await api().research({ actor: w.ann, project: project.id, days: 2, skill: "crafting" });
  const craftAction = await craft(w, w.annUser, w.ann, {});
  await api().queue.resolve(w.ann, craftAction.id, { degree: "success", chat: true });
  const gatherAction = await as(w.annUser, () => api().queue.submit(w.ann, "gather", { sceneId: w.table.id, tokenId: w.herb.id, skill: "survival" }));
  await api().queue.resolve(w.ann, gatherAction.id, { degree: "success", chat: true });
  assert.equal(env.chat.length, 3, "research, craft and gather: one player-facing line each, nothing else");
  for (const message of env.chat) {
    assert.ok(Array.isArray(message.whisper) && message.whisper.length > 0, "nothing is posted publicly");
    assert.doesNotMatch(message.content, /GM only/, "no GM-only message exists any more");
    assert.deepEqual(findings(message.content), [], `in chat: ${message.content}`);
  }
  assert.deepEqual(chatLeaks(env.chat), [], "scanned over ALL messages, whoever they are whispered to");
  const log = api().gm.log();
  assert.ok(log.some(e => e.kind === "research" && /vs DC/.test(e.text)), "the GM still gets the totals and the DC (research)");
  assert.ok(log.some(e => e.kind === "craft"), "and the craft detail");
  assert.ok(log.some(e => e.kind === "gather" && /vs DC/.test(e.text)), "and the gather rung rolls");
  assert.throws(() => as(w.annUser, () => api().gm.log()), /GM only/);
});

test("AUDIT: the ledger and the mismatch rows carry project DCs, so scan, accept and ledger are GM-only", async () => {
  const w = await playerWorld();
  for (const call of [() => api().audit.scan(), () => api().audit.ledger(), () => api().audit.accept(w.ann)]) {
    assert.throws(() => as(w.annUser, call), /GM only/);
  }
  assert.deepEqual(as(w.gm, () => api().audit.scan()), []);
  assert.ok(as(w.gm, () => api().audit.ledger()));
});

test("ROLL CARDS: the GM's direct tools roll without PF2e's own card (it shows the DC) unless the GM asks for one", async () => {
  const w = await playerWorld();
  w.ann.rolls.push(roll(3, 20, 15), roll(3, 20, 15), roll(3, 20, 15), roll(3, 20, 15));
  await api().gather({ actor: w.ann, node: w.herb, skill: "survival", chat: false });
  assert.equal(w.ann.rollArgs.at(-1).createMessage, false, "gather: no card by default");
  const { token } = await (await import("./fake-world.js")).addNode(w.table, { nodeType: "herb", region: "oak-wood", charges: 3 });
  await api().gather({ actor: w.ann, node: token, skill: "survival", chat: false, rollCard: true });
  assert.notEqual(w.ann.rollArgs.at(-1).createMessage, false, "gather: a card when the GM opts in");
  await api().craft({ actor: w.ann, recipeId: DAGGER, selection: SEL, station: "oakhaven-forge" });
  assert.equal(w.ann.rollArgs.at(-1).createMessage, false, "craft: no card by default");
  await api().giveMaterial(w.ann, "iron", 2); await api().giveMaterial(w.ann, "spider-fang", 2);
  await api().craft({ actor: w.ann, recipeId: DAGGER, selection: SEL, station: "oakhaven-forge", rollCard: true });
  assert.notEqual(w.ann.rollArgs.at(-1).createMessage, false, "craft: a card when the GM opts in");
});

test("THE PLAYER COPY of definitions: nothing in it carries a hidden field (and the exact fields of a recipe are the ones listed in docs/08)", async () => {
  const w = await playerWorld();
  const defs = as(w.annUser, () => api().definitions);
  assert.deepEqual(findings(Object.fromEntries(Object.entries(defs).map(([k, m]) => [k, [...m.values()]]))), []);
  const recipe = defs.recipe.get(DAGGER);
  assert.deepEqual(Object.keys(recipe).sort(), ["category", "days", "id", "kind", "name", "skillWhitelist", "slots", "stationCategory", "stationTierMin"]);
  assert.deepEqual(Object.keys(recipe.slots[0]).sort(), ["drives", "name", "qty", "tierFloor"]);
  assert.deepEqual(recipe.days, { default: 2, byStation: { "oakhaven-forge": 2, "oakhaven-apothecary": 2 } });
  assert.deepEqual(Object.keys(defs.material.get("iron")).sort(), ["hasTrack", "id", "kind", "name", "tier", "value"], "no effects, no class effects, no research track: only whether there is a study, and the gold value");
  const gm = as(w.gm, () => api().definitions);
  assert.ok(gm.recipe.get(DAGGER).craftLevel === 2 && gm.recipe.get(DAGGER).output && gm.material.get("iron").effects, "the GM's copy is untouched");
});

test("craft days in the player copy include the station's upgrades and the 1-day floor", async () => {
  const w = await playerWorld();
  const { applyStationUpgrade } = await import("../scripts/stations/store.js");
  await applyStationUpgrade(api(), "oakhaven-forge", { kind: "craftDays", from: 0, to: 1 });
  await applyStationUpgrade(api(), "oakhaven-forge", { kind: "craftDays", from: 1, to: 2 });
  await as(w.annUser, () => api().definitions.refresh({ force: true }));
  assert.deepEqual(as(w.annUser, () => api().definitions).recipe.get(DAGGER).days, { default: 2, byStation: { "oakhaven-forge": 1, "oakhaven-apothecary": 2 } }, "2 days minus 2 cuts, floored at 1");
  assert.equal(as(w.annUser, () => api().previewCraft(w.ann, DAGGER, SEL, "oakhaven-forge")).plan.days, 1);
});

test("MUTATION: if a DC were put back into a player's row, or a hidden field into a preview, the scanner would say so", async () => {
  const w = await playerWorld();
  const action = await as(w.annUser, () => api().queue.submit(w.ann, "explore", { region: "oak-wood", skill: "survival" }, 2));
  const row = as(w.annUser, () => api().queue.list()).find(r => r.action.id === action.id);
  assert.equal(findings({ ...row, detail: `${row.detail}; vs DC 18` }).length, 1);
  assert.equal(findings({ ...row, detail: "crit 5% / success 35%" }).length, 1);
  const preview = as(w.annUser, () => api().previewCraft(w.ann, DAGGER, SEL, "oakhaven-forge"));
  assert.equal(findings({ ...preview, plan: { ...preview.plan, craftLevel: 2 } }).length, 1);
  assert.equal(findings({ ...preview, plan: { ...preview.plan, uses: [{ ...preview.plan.uses[0], slotLossChance: 50 }] } }).length, 1);
  void makeActor; void loudly;
});
