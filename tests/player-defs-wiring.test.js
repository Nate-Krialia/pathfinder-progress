/**
 * Stage 16 through the REAL main.js in the fake Foundry WITH per-client definitions: a player starts with nothing and gets
 * what the GM client sends over the (fake) socket, exactly as in real Foundry.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DAGGER, M, SEL, addNode, as, env, fireHookAs, getApi, getUsers, loudly, makeActor, makeRegistry, quietly, world } from "./fake-world.js";
import { defsState } from "../scripts/data/playerState.js";
import { settled, refresh } from "../scripts/data/playerDefs.js";
import { GENERIC_FAILURE } from "../scripts/queue/relay.js";

const api = () => getApi();
const defs = user => as(user, () => api().definitions);
const kindIds = (user, kind) => [...defs(user)[kind].keys()].sort();
const world2 = options => world({ perClientDefinitions: true, downtime: 6, ...options });
const loads = user => as(user, () => defsState().loads);
const handlerCalls = () => { let n = 0; const real = env.handlers.get("definitionsFor"); env.handlers.set("definitionsFor", function counted(...args) { n++; return real.apply(this, args); }); return () => n; };

test("a player starts with NO definitions, and the GM client keeps everything", async () => {
  const w = await world2();
  assert.equal(defs(w.annUser).recipe.size, 0);
  assert.equal(defs(w.annUser).material.size, 0);
  assert.ok(defs(w.gm).recipe.size >= 2 && defs(w.gm).region.size >= 2 && defs(w.gm).material.size > 1, "the GM registry is the full one");
  assert.equal(typeof defs(w.annUser).refresh, "function", "api.definitions.refresh() exists on a player registry");
});

test("HOLDS the formula: refresh loads that recipe (and what it needs) and previewCraft works; a recipe not held is NOT loaded", async () => {
  const w = await world2();
  const result = await as(w.annUser, () => api().definitions.refresh());
  assert.equal(result.changed, true);
  assert.deepEqual(kindIds(w.annUser, "recipe"), [DAGGER]);
  assert.ok(kindIds(w.annUser, "material").includes("iron") && kindIds(w.annUser, "material").includes("spider-fang"), "the materials in the inventory");
  assert.ok(kindIds(w.annUser, "station").length >= 1 && kindIds(w.annUser, "town").includes("oakhaven"), "the stations of the town the party is in");
  assert.equal(defs(w.annUser).recipe.has("longsword-basic"), false);
  assert.equal(defs(w.annUser).station.has("redhollow-forge"), false);
  assert.equal(defs(w.annUser).region.size, 0, "no region is in play");
  const preview = as(w.annUser, () => api().previewCraft(w.ann, DAGGER, SEL, "oakhaven-forge"));
  assert.equal(preview.ok, true, JSON.stringify(preview.errors));
  assert.equal(preview.plan.fee, 5);
  // the GM's own copy did not change
  assert.ok(defs(w.gm).recipe.has("longsword-basic") && defs(w.gm).station.has("redhollow-forge"));
});

test("DOES NOT hold it: a plain refusal that is never 'unknown recipe' or 'orphaned', whether or not the recipe exists", async () => {
  const w = await world2();
  await as(w.bobUser, () => api().definitions.refresh());
  for (const recipe of [DAGGER, "longsword-basic", "never-existed"]) {
    const result = as(w.bobUser, () => api().previewCraft(w.bob, recipe, SEL));
    assert.deepEqual([result.ok, result.errors], [false, ["Bob does not know this formula."]], recipe);
  }
  assert.equal(defs(w.bobUser).recipe.size, 0);
});

test("ORPHANED: only a formula that is HELD and has no recipe on the GM says 'orphaned formula'", async () => {
  const w = await world2();
  await w.ann.update({ [`flags.${M}.formulas`]: [...w.ann.getFlag(M, "formulas"), { recipeId: "ghost", access: "owned", source: "gm" }] });
  await as(w.annUser, () => api().definitions.refresh());
  const ghost = as(w.annUser, () => api().previewCraft(w.ann, "ghost", {}));
  assert.match(ghost.errors[0], /^Ann holds an orphaned formula for this \(its recipe no longer exists\): ask the GM to remove it or restore the recipe\.$/);
  const never = as(w.annUser, () => api().previewCraft(w.ann, "never-existed", {}));
  assert.deepEqual(never.errors, ["Ann does not know this formula."], "not held: never 'orphaned'");
  assert.deepEqual(as(w.annUser, () => api().definitionsStatus()).orphaned, ["ghost"]);
  // the GM's own message is exactly what it was
  assert.match(as(w.gm, () => api().previewCraft(w.ann, "ghost", {})).errors[0], /unknown recipe "ghost"; Ann holds an orphaned formula for it/);
});

test("STILL LOADING / GM NOT CONNECTED are plain sentences, not 'unknown'", async () => {
  const w = await world2();
  const early = as(w.annUser, () => api().previewCraft(w.ann, DAGGER, SEL));
  assert.deepEqual(early.errors, ["Your recipes are still loading; try again in a moment."]);
  env.noGM = true;
  await assert.rejects(as(w.annUser, () => api().definitions.refresh()), error => error.message === "The GM isn't connected right now, so this can't be done yet.");
  assert.equal(as(w.annUser, () => api().definitionsStatus()).status, "no-gm");
  assert.deepEqual(as(w.annUser, () => api().previewCraft(w.ann, DAGGER, SEL)).errors, ["The GM isn't connected, so your recipes can't be loaded yet."]);
  env.noGM = false;
  await as(w.annUser, () => api().definitions.refresh());
  assert.equal(as(w.annUser, () => api().definitionsStatus()).status, "ready");
  assert.equal(as(w.annUser, () => api().previewCraft(w.ann, DAGGER, SEL)).ok, true);
});

test("RELOAD: a formula the GM grants shows up without a reload (the hook, debounced); one taken away is dropped", async () => {
  const w = await world2();
  await as(w.bobUser, () => api().definitions.refresh());
  assert.equal(defs(w.bobUser).recipe.size, 0);
  await api().grantFormula(w.bob, DAGGER);                                                  // GM tool; Foundry then fires updateActor on Bob's client
  await as(w.bobUser, async () => { await fireHookAs(w.bobUser, "updateActor", [w.bob], { flags: { [M]: { formulas: [] } } }); await settled(); });
  assert.deepEqual(kindIds(w.bobUser, "recipe"), [DAGGER]);
  assert.equal(as(w.bobUser, () => api().previewCraft(w.bob, DAGGER, SEL)).ok, false, "no materials, but the recipe is known: not 'unknown'");
  const errors = as(w.bobUser, () => api().previewCraft(w.bob, DAGGER, SEL)).errors;
  assert.ok(!errors.some(e => /unknown|does not know this formula|orphaned/.test(e)), errors.join(" | "));
  assert.ok(errors.some(e => /slot "blade": you do not have "iron"/.test(e)), "a material the character has not met is 'you do not have', not 'unknown'");
  await api().removeFormula(w.bob, DAGGER);
  await as(w.bobUser, async () => { await fireHookAs(w.bobUser, "updateActor", [w.bob], { flags: { [M]: { formulas: [] } } }); await settled(); });
  assert.deepEqual(kindIds(w.bobUser, "recipe"), []);
});

test("LOANED formula: a loan loads the recipe too", async () => {
  const w = await world2();
  await api().grantFormula(w.bob, DAGGER, { access: "loan", source: "gm" });
  await as(w.bobUser, () => api().definitions.refresh());
  assert.deepEqual(kindIds(w.bobUser, "recipe"), [DAGGER]);
});

test("BLUEPRINT: a held design (or one being researched) loads that blueprint; another character's design does not", async () => {
  const w = await world2();
  await api().workshop.grantDesign(w.ann, "camp-forge");
  await as(w.annUser, () => api().definitions.refresh());
  await as(w.bobUser, () => api().definitions.refresh());
  assert.deepEqual(kindIds(w.annUser, "blueprint"), ["camp-forge"]);
  assert.deepEqual(kindIds(w.bobUser, "blueprint"), []);
  await as(w.bobUser, () => api().workshop.startDesign(w.bob, { blueprint: "camp-forge" }));
  await as(w.bobUser, () => api().definitions.refresh());
  assert.deepEqual(kindIds(w.bobUser, "blueprint"), ["camp-forge"], "an active design project needs it too");
});

test("REGION IN PLAY: tagged on the scene the character is on, it loads WITHOUT its spawn table; explore submit validates it from the loaded set", async () => {
  const w = await world2();
  await api().tagScene(w.table, "oak-wood");
  await as(w.annUser, () => api().definitions.refresh());
  assert.deepEqual(kindIds(w.annUser, "region"), ["oak-wood"]);
  const region = defs(w.annUser).region.get("oak-wood");
  assert.equal("spawnTable" in region, false);
  assert.equal(region.explorationDC, 18, "the DC stays (api.queue.list() already shows it to a player)");
  assert.equal(region.name, "Oak Wood");
  assert.ok(defs(w.gm).region.get("oak-wood").spawnTable && defs(w.gm).region.get("oak-wood").explorationDC, "the GM copy still has both");
  await api().placeAnchors(3, { scene: w.table });
  const action = await as(w.annUser, () => api().queue.submit(w.ann, "explore", { region: "oak-wood", skill: "survival" }, 2));
  assert.deepEqual([action.type, action.daysReserved, action.params.region], ["explore", 2, "oak-wood"]);
  // Bob's token is on a scene that is not tagged: he cannot explore it, and is told plainly
  await assert.rejects(as(w.bobUser, () => api().queue.submit(w.bob, "explore", { region: "oak-wood", skill: "survival" }, 2)),
    error => /^submit: there is no region "oak-wood" you can explore from where your characters are/.test(error.message));
  assert.equal(defs(w.bobUser).region.size, 0);
});

test("NODE TYPES: those of revealed nodes in play load without ladders or charges; the GM's stay whole", async () => {
  const w = await world2();
  await addNode(w.table, { nodeType: "herb", state: "active", revealed: true });
  await as(w.annUser, () => api().definitions.refresh());
  const herb = defs(w.annUser).nodeType.get("herb");
  assert.ok(herb && !("ladders" in herb) && !("charges" in herb));
  assert.ok(defs(w.gm).nodeType.get("herb").ladders && defs(w.gm).nodeType.get("herb").charges);
  assert.equal(defs(w.annUser).nodeType.has("ore"), false);
});

test("STRIPPED FIELDS: the player copy and the GM copy differ exactly as designed (and only there)", async () => {
  const w = await world2();
  await api().tagScene(w.table, "oak-wood");
  await addNode(w.table, { nodeType: "herb", state: "active", revealed: true });
  const gmRegion = structuredClone(defs(w.gm).region.get("oak-wood"));
  const gmHerb = structuredClone(defs(w.gm).nodeType.get("herb"));
  await as(w.annUser, () => api().definitions.refresh());
  const pr = defs(w.annUser).region.get("oak-wood"), ph = defs(w.annUser).nodeType.get("herb");
  const { spawnTable, ...regionRest } = gmRegion; void spawnTable;
  const { ladders, charges, ...herbRest } = gmHerb; void ladders; void charges;
  assert.deepEqual(pr, regionRest);
  assert.deepEqual(ph, herbRest);
  assert.deepEqual(defs(w.gm).region.get("oak-wood"), gmRegion, "GM copy untouched");
  assert.deepEqual(defs(w.gm).nodeType.get("herb"), gmHerb, "GM copy untouched");
});

test("CHEAP: nothing changed means no request; an irrelevant hook costs nothing; a burst of changes is one request", async () => {
  const w = await world2();
  const calls = handlerCalls();
  await as(w.annUser, () => api().definitions.refresh());
  assert.equal(calls(), 1);
  await as(w.annUser, () => api().definitions.refresh());
  await as(w.annUser, () => api().definitions.refresh());
  assert.equal(calls(), 1, "same facts, same revision: the GM is not asked");
  await as(w.annUser, async () => {
    await fireHookAs(w.annUser, "updateActor", [w.ann], { system: { attributes: { hp: { value: 3 } } } });          // not ours
    await fireHookAs(w.annUser, "updateActor", [w.ann], { flags: { [M]: { downtimeDays: 3 } } });                   // not a thing that decides the set
    await settled();
  });
  assert.equal(calls(), 1, "irrelevant events schedule nothing");
  await w.ann.update({ [`flags.${M}.formulas`]: [...w.ann.getFlag(M, "formulas"), { recipeId: "longsword-basic", access: "owned", source: "gm" }] });
  await as(w.annUser, async () => {
    for (let i = 0; i < 5; i++) await fireHookAs(w.annUser, "updateActor", [w.ann], { flags: { [M]: { formulas: [] } } });
    await settled();
  });
  assert.equal(calls(), 2, "five events in a row, one request");
  assert.deepEqual(kindIds(w.annUser, "recipe"), [DAGGER, "longsword-basic"].sort());
  // a GM hook is a no-op
  const before = calls();
  await as(w.gm, async () => { await fireHookAs(w.gm, "updateActor", [w.ann], { flags: { [M]: { formulas: [] } } }); await settled(); });
  assert.equal(calls(), before);
});

test("OTHER TRIGGERS: a scene change, a token, the party's town and the GM's revision each cause a refresh", async () => {
  const w = await world2();
  await as(w.annUser, () => api().definitions.refresh());
  const base = loads(w.annUser);
  await api().tagScene(w.table, "oak-wood");
  await as(w.annUser, async () => { await fireHookAs(w.annUser, "updateScene", [w.table], { flags: { [M]: { sceneTags: ["oak-wood"] } } }); await settled(); });
  assert.deepEqual(kindIds(w.annUser, "region"), ["oak-wood"]);
  await api().setLocation("redhollow");
  await as(w.annUser, async () => { await fireHookAs(w.annUser, "updateSetting", [{ key: `${M}.partyLocation` }]); await settled(); });
  assert.ok(kindIds(w.annUser, "station").includes("redhollow-forge") && !kindIds(w.annUser, "station").includes("oakhaven-forge"));
  assert.equal(loads(w.annUser), base + 2);
  // a GM reload of the definitions is published, and a player refreshes on it even though no fact changed
  const first = await api().publishDefinitions();
  assert.equal(first.changed, true);
  assert.equal((await api().publishDefinitions()).changed, false, "nothing changed: no new revision");
  await as(w.annUser, async () => { await fireHookAs(w.annUser, "updateSetting", [{ key: `${M}.definitionsRevision` }]); await settled(); });
  assert.equal(loads(w.annUser), base + 3);
  env.values.definitionsRevision = "";                                                                     // (a different revision again)
  api().definitions.recipe.set("extra", { ...api().definitions.recipe.get(DAGGER), id: "extra" });
  assert.equal((await api().publishDefinitions()).changed, true, "an edited registry is a new revision");
});

test("OWNERSHIP: a character the user no longer owns stops contributing; a new owner starts to", async () => {
  const w = await world2();
  await as(w.bobUser, () => api().definitions.refresh());
  assert.deepEqual(kindIds(w.bobUser, "recipe"), []);
  const ann2 = makeActor("Ann Two", { owners: [w.bobUser.id] });
  game.actors.push(ann2);
  await api().grantFormula(ann2, DAGGER);
  await as(w.bobUser, async () => { await fireHookAs(w.bobUser, "updateActor", [ann2], { ownership: { [w.bobUser.id]: 3 } }); await settled(); });
  assert.deepEqual(kindIds(w.bobUser, "recipe"), [DAGGER]);
  ann2.owners.length = 0;
  await as(w.bobUser, async () => { await fireHookAs(w.bobUser, "updateActor", [ann2], { ownership: { [w.bobUser.id]: 0 } }); await settled(); });
  assert.deepEqual(kindIds(w.bobUser, "recipe"), []);
});

test("GM UNAFFECTED: a GM client refreshes to nothing, loads everything, and its registry is the full one", async () => {
  const w = await world2();
  const full = Object.fromEntries(Object.entries(defs(w.gm)).map(([kind, map]) => [kind, map.size]));
  assert.deepEqual(await as(w.gm, () => api().definitions.refresh()), { changed: false, gm: true });
  assert.deepEqual(Object.fromEntries(Object.entries(defs(w.gm)).map(([kind, map]) => [kind, map.size])), full);
  assert.equal(as(w.gm, () => api().definitionsStatus()).status, "ready");
  // the GM's own preview of any recipe is exactly as before
  assert.equal(as(w.gm, () => api().previewCraft(w.ann, "longsword-basic", {})).errors.some(e => /does not know the formula/.test(e)), true);
});

test("IDENTITY: the handler trusts socketlib's sender and IGNORES the id in the payload; with no sender it falls back to the payload's", async () => {
  const w = await world2();
  const handler = env.handlers.get("definitionsFor");
  const bySocketlib = await handler.call({ socketdata: { userId: w.annUser.id } }, { userId: w.bobUser.id });          // Bob's id sent, Ann's is the real sender
  assert.ok(bySocketlib.records.some(r => r.kind === "recipe" && r.data.id === DAGGER), "Ann's set, not Bob's");
  const forgedGM = await handler.call({ socketdata: { userId: w.annUser.id } }, { userId: w.gm.id });
  assert.ok(Array.isArray(forgedGM.records), "a forged GM id in the payload changes nothing");
  assert.deepEqual(await handler.call({ socketdata: { userId: w.gm.id } }, {}), { __relay: "refused", message: "The GM client loads every definition itself; there is nothing to fetch." });
  const noSender = await handler.call(undefined, { userId: w.bobUser.id });
  assert.deepEqual(noSender.records.filter(r => r.kind === "recipe"), [], "Bob holds none");
  assert.deepEqual(await handler.call(undefined, { userId: "nobody" }), { __relay: "refused", message: 'the GM client does not know the user "nobody"' });
  assert.deepEqual(env.handlerThrows, []);
});

test("the handler never throws and hides bugs behind the generic line (the walk-all-handlers test covers the nonsense payloads)", async () => {
  const w = await world2();
  const realGet = api().definitions.recipe;
  const gmDefs = defs(w.gm);
  gmDefs.recipe = { has() { throw new TypeError("kaboom"); }, get() { throw new TypeError("kaboom"); }, values() { throw new TypeError("kaboom"); }, keys() { throw new TypeError("kaboom"); } };
  try {
    const [error, logged] = await loudly(async seen => [await as(w.annUser, () => api().definitions.refresh()).catch(e => e), seen]);
    assert.equal(error.message, GENERIC_FAILURE);
    assert.ok(logged.some(l => /"definitionsFor" socket handler hit an unexpected error/.test(l)));
  } finally { gmDefs.recipe = realGet; }
  assert.equal(as(w.annUser, () => api().definitionsStatus()).status, "failed");
});

test("a player's api.reload() reads no pack, and then asks the GM", async () => {
  const w = await world2();
  await quietly(() => as(w.annUser, () => api().reload()));
  assert.deepEqual(kindIds(w.annUser, "recipe"), [DAGGER]);
  assert.deepEqual(as(w.annUser, () => api().errors), []);
  void refresh; void getUsers; void addNode; void makeRegistry;
});
