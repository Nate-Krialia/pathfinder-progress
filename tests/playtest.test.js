/**
 * The playtest seed (docs/29-playtest-seed.md): the SETUP and CLEANUP blocks, taken from the doc as TEXT (the exact text the owner pastes into a Script Macro) and run in the fake Foundry.
 * The fake has a pretend PF2e compendium (Torch, Rope, Dagger, Longsword), items that carry a source, actors that take a level, a scene with tokens and users you can rename.
 *
 * What the fake CANNOT show (so these tests do not claim it): that real Foundry creates a user-owned character with this ownership shape, that it keeps a token on a scene and a manifest flag
 * across a reload, that PF2e accepts `system.details.level.value` on a character, that an actor deleted in a real world takes its embedded items and flags with it, or what the Hub then draws.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { as, env, getApi, getUsers, world } from "./fake-world.js";
import { asPage, seedRecords } from "./helpers.js";

const doc = readFileSync("docs/29-playtest-seed.md", "utf8");
const M = "pathfinder-progress";
const blockOf = heading => {
  const section = doc.split(new RegExp(`^## ${heading}\\n`, "m"))[1]?.split(/^## /m)[0] ?? "";
  return section.match(/```js\n([\s\S]*?)```/)?.[1] ?? null;
};
export const SETUP = blockOf("Part 2: SETUP");
export const CLEANUP = blockOf("Part 3: CLEANUP");
const api = () => getApi();
const compId = name => `${name.toUpperCase().replace(/[^A-Z]/g, "").padEnd(16, "X").slice(0, 16)}`;
const NAMES = ["Torch", "Rope", "Dagger", "Longsword"];

/** Run a block like a browser console would (the top-level await wrapped), as a user, collecting what it prints. */
async function run(code, user, { patch = text => text } = {}) {
  assert.ok(code, "the doc has this code block");
  const text = patch(code).replace(/^(\/\/[^\n]*\n)*\s*await \(/, match => match.replace("await (", "("));
  const lines = [], logged = console.log;
  console.log = (...args) => lines.push(args.map(String).join(" "));
  try { return { value: await as(user, () => (0, eval)(text)), lines: lines.join("\n").split("\n").filter(Boolean) }; } finally { console.log = logged; }
}
const failure = async (code, user, options) => { try { await run(code, user, options); return null; } catch (error) { return error.message; } };

/** A fake PF2e compendium: four items found by name, copies that carry their source, a level on a character. */
function fakePf2e() {
  const uuidOf = name => `Compendium.pf2e.equipment-srd.Item.${compId(name)}`;
  const docs = Object.fromEntries(NAMES.map(name => [uuidOf(name), name]));
  const compDoc = uuid => ({ name: docs[uuid], uuid, toObject: () => ({ name: docs[uuid], type: ["Dagger", "Longsword"].includes(docs[uuid]) ? "weapon" : "equipment", system: { quantity: 1, rules: [] }, flags: {}, _stats: { compendiumSource: null } }) });
  const real = game.packs;
  game.packs = { ...real, get: id => (id === "pf2e.equipment-srd" ? { getIndex: async () => NAMES.map(name => ({ name, _id: compId(name) })), getDocument: async docId => compDoc(uuidOf(NAMES.find(n => compId(n) === docId))) } : real.get?.(id)) };
  game.items.fromCompendium = d => ({ ...d.toObject(), _stats: { compendiumSource: d.uuid } });
  const baseCreate = Actor.create;
  Actor.create = async data => {
    const actor = await baseCreate(data);
    actor.system = actor.system ?? {};
    actor.update = (original => async change => { for (const [path, value] of Object.entries(change)) if (path === "system.details.level.value") { actor.system.details = { level: { value } }; delete change[path]; } return Object.keys(change).length ? original(change) : undefined; })(actor.update);
    return actor;
  };
  const stock = globalThis.fromUuid;
  globalThis.fromUuid = async uuid => (docs[uuid] ? compDoc(uuid) : stock(uuid));
  return { uuidOf, docs, restore: () => { game.packs = real; Actor.create = baseCreate; globalThis.fromUuid = stock; } };
}

/** A fresh world with two Player users named as SETUP expects, the editor ready, and the fake compendium. */
async function playtestWorld({ users = true, names = NAMES } = {}) {
  const w = await world({ downtime: 0, iron: 0, fang: 0, copper: 0, perClientDefinitions: true });
  api().baseSources = seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }));
  api().editorLeftovers = [];
  const { gm, annUser, bobUser } = getUsers();
  for (const user of [annUser, bobUser]) user.update = async change => { if ("character" in change) user.character = change.character ? game.actors.get(change.character) ?? null : null; };   // like a real User
  annUser.name = users ? "Playtest Alice" : "Somebody Else";
  bobUser.name = users ? "Playtest Bob" : "Somebody Too";
  const compendium = fakePf2e();
  if (names !== NAMES) {
    const get = game.packs.get;
    game.packs.get = id => { const pack = get(id); return id === "pf2e.equipment-srd" ? { ...pack, getIndex: async () => (await pack.getIndex()).filter(e => names.includes(e.name)) } : pack; };
  }
  return { w, gm, annUser, bobUser, compendium };
}
const flagged = () => ({ actors: game.actors.filter(a => a.getFlag(M, "playtestSeed") === true), items: game.items.filter(i => i.getFlag(M, "playtestSeed") === true), scene: game.scenes.find(s => s.getFlag(M, "playtestSeed") === true) });

test("the doc has a SETUP block and a CLEANUP block, and the test runs their exact text", () => {
  assert.ok(SETUP && SETUP.length > 2000, "SETUP block found");
  assert.ok(CLEANUP && CLEANUP.length > 1000, "CLEANUP block found");
});

test("SETUP: plants the data, saves a manifest on the scene, and prints what it planted", async () => {
  const { gm, annUser } = await playtestWorld();
  const out = await run(SETUP, gm);
  assert.deepEqual(out.value.warnings, [], out.value.warnings.join("\n"));
  const { actors, scene } = flagged();
  assert.deepEqual(actors.map(a => a.name).sort(), ["Playtest Alice", "Playtest Bob", "Playtest Patron", "Playtest Wolf"]);
  assert.ok(scene, "the scene exists");
  assert.equal(scene.getFlag(M, "playtestManifest").complete, true);
  assert.ok(out.lines.some(l => /^PLAYTEST SETUP planted/.test(l)));
  void annUser;
});

// ---- helpers for the rest ------------------------------------------------------------------------------------------------------------------
const mutate = (code, from, to) => { assert.equal(code.split(from).length - 1, 1, `the mutation target appears exactly once: ${from.slice(0, 70)}`); return code.replace(from, to); };
const fingerprint = () => JSON.stringify({
  actors: game.actors.filter(a => a.name !== "Resource Node").map(a => a.name).sort(), items: game.items.map(i => i.name).sort(), scenes: game.scenes.map(s => s.name).sort(),
  folders: game.folders.map(f => f.name).sort(), location: env.values.partyLocation, party: (env.values.partyStations ?? []).map(r => r.id).sort(),
  editor: Object.keys(api().editor.records()).sort(), ledger: Object.keys(api().tags.ledger().items).sort(),
  defs: ["tag", "material", "recipe"].map(kind => [...api().definitions[kind].keys()].sort()),
  characters: [...game.users].map(u => [u.name, u.character?.name ?? null]),
  audit: Object.keys(api().audit.ledger()).filter(k => k !== "_events").map(id => game.actors.get(id)?.name ?? "gone").sort()
});
const counts = () => ({ actors: game.actors.length, items: game.items.length, tokens: game.scenes.reduce((n, s) => n + s.tokens.length, 0), scenes: game.scenes.length, editor: Object.keys(api().editor.records()).length, ledger: Object.keys(api().tags.ledger().items).length, party: (env.values.partyStations ?? []).length });
const ofName = name => game.actors.getName(name);

test("SETUP plants every area, with the right owners, tokens, tags, workshops and research", async () => {
  const { gm, annUser, bobUser } = await playtestWorld();
  const out = await run(SETUP, gm);
  const alice = ofName("Playtest Alice"), bob = ofName("Playtest Bob"), patron = ofName("Playtest Patron");
  // people: the two Player users own their character (Owner = 3); the patron is the GM's only; each user's character is set
  assert.equal(alice.ownership[annUser.id], 3);
  assert.equal(bob.ownership[bobUser.id], 3);
  assert.deepEqual([annUser.character?.name, bobUser.character?.name], ["Playtest Alice", "Playtest Bob"]);
  assert.deepEqual(patron.ownership, { default: 0 });
  assert.deepEqual([alice.system.details.level.value, bob.system.details.level.value], [3, 5], "two different levels");
  assert.deepEqual(out.value.levelNotes.map(n => /asked for level/.test(n)), [true, true]);
  // gathering: three visible nodes, one hidden node, a corpse node, the characters' tokens, the party in Oakhaven
  const scene = game.scenes.getName("Playtest Field");
  const token = name => scene.tokens.find(t => t.name === name);
  for (const name of ["Playtest Herb Patch", "Playtest Ore Vein", "Playtest Salvage Pile"]) assert.equal(token(name)?.getFlag(M, "node")?.state, "active", name);
  assert.equal(token("Playtest Hidden Herb").hidden, true);
  assert.equal(token("Playtest Hidden Herb").getFlag(M, "node").revealed, false);
  assert.equal(token("Playtest Wolf Corpse").getFlag(M, "node").creature.name, "Playtest Wolf");
  assert.deepEqual(["Playtest Alice", "Playtest Bob", "Playtest Patron"].map(n => Boolean(token(n))), [true, true, true]);
  assert.equal(env.values.partyLocation, "oakhaven");
  // crafting: editor records (kept in the world), the one in-memory recipe, real copies that share a source, the tags on them
  assert.deepEqual(Object.keys(api().editor.records()).sort(), ["material:playtest-ember", "material:playtest-study-ore", "tag:playtest-charm", "tag:playtest-edge"]);
  assert.equal(api().editor.canEdit("recipe:playtest-blade"), false, "the recipe exists only in memory");
  assert.equal(api().editor.canEdit("tag:playtest-edge"), true, "the tags are kept by the editor");
  const sources = actor => actor.items.filter(i => i._stats?.compendiumSource).map(i => `${i.name} x${i.system.quantity} <- ${i._stats.compendiumSource.split(".").pop()}`).sort();
  assert.deepEqual(sources(alice), ["Playtest Rope A x2 <- ROPEXXXXXXXXXXXX", "Playtest Rope B x2 <- ROPEXXXXXXXXXXXX", "Playtest Torch Single x1 <- TORCHXXXXXXXXXXX", "Playtest Torch Stack x3 <- TORCHXXXXXXXXXXX"]);
  const ledger = api().tags.ledger().items;
  assert.deepEqual([ledger["Compendium.pf2e.equipment-srd.Item.TORCHXXXXXXXXXXX"].tags, ledger["Compendium.pf2e.equipment-srd.Item.ROPEXXXXXXXXXXXX"].tags], [["playtest-edge"], ["playtest-charm"]]);
  assert.ok(bob.items.some(i => i.type === "weapon" && i.getFlag(M, "crafted")), "Bob holds a crafted weapon (a Spider Fang Dagger)");
  assert.ok(alice.getFlag(M, "formulas").some(f => f.recipeId === "playtest-blade") && alice.getFlag(M, "formulas").some(f => f.recipeId === "dagger-spider-fang"));
  // workshops: the public bench, Alice's owned workshop, the party's workshop
  const reachable = api().stationsFor(alice).map(s => `${s.id}:${s.source}`).sort();
  assert.deepEqual(reachable.filter(s => /playtest|oakhaven-forge/.test(s)), ["oakhaven-forge:public", "party-playtest-camp:party", "playtest-anvil:owned"]);
  assert.equal(alice.items.filter(i => i.getFlag(M, "material")?.materialId === "iron").reduce((n, i) => n + i.system.quantity, 0), 8, "iron for the upgrade and the crafts");
  // the patron (GM only) can back a commission: it holds the formula, the materials and the gold
  assert.ok(patron.getFlag(M, "formulas").some(f => f.recipeId === "dagger-spider-fang"));
  assert.deepEqual(patron.items.filter(i => i.getFlag(M, "material")).map(i => `${i.getFlag(M, "material").materialId}x${i.system.quantity}`).sort(), ["ironx2", "spider-fangx1"]);
  // research: a study (the ore with a track), a formula project, a lead
  assert.ok(api().research.leadsFor(alice).some(l => /Study Ore/.test(l.name)), JSON.stringify(api().research.leadsFor(alice).map(l => l.name)));
  assert.ok(api().research.leadsFor(alice).some(l => l.recipeId === "longsword-basic"), "the GM's lead");
  assert.deepEqual(api().projectInfo(bob).map(p => p.id), ["unlock-longsword-basic"]);
  // the Compendium: an entry Alice can share
  assert.ok(alice.getFlag(M, "compendium").materials.iron, "an entry ready to share");
  // world items for the GM tools
  assert.ok(game.items.getName("Playtest Torch Sample")?._stats.compendiumSource, "a copy that carries its source, for the Item tags window");
  assert.ok(game.items.getName("Playtest Ember"), "the editor's world item, for the Item editor");
  // every document SETUP made is flagged
  const { actors, items } = flagged();
  assert.equal(actors.length, 4);
  assert.deepEqual(items.map(i => i.name), ["Playtest Torch Sample"]);
  assert.equal(scene.getFlag(M, "playtestManifest").complete, true);
  // it never makes a user, never opens downtime, never puts an unflagged thing in the world
  assert.deepEqual([...game.users].map(u => u.name).sort(), ["GM", "Playtest Alice", "Playtest Bob", "Test"]);
  assert.equal(api().downtime.isOpen(), false);
  assert.ok(out.lines.some(l => /found these PF2e items/.test(l)) && out.lines.some(l => /planted/.test(l)));
});

test("the blocks never type in a PF2e uuid, and never create a user", () => {
  for (const [name, code] of [["SETUP", SETUP], ["CLEANUP", CLEANUP]]) {
    assert.doesNotMatch(code, /Compendium\.pf2e\.[A-Za-z0-9._-]*\.Item\.[A-Za-z0-9]{16}/, `${name}: no uuid is typed in`);
    assert.doesNotMatch(code, /User\.create|users\.create|createDocuments\("User"|new User\b/, `${name}: it never makes a user`);
  }
  assert.doesNotMatch(SETUP + CLEANUP, /Hooks\.(on|once)|setTimeout\(\(\) =>[^)]*setup/i, "nothing runs by itself");
});

test("SETUP printed each uuid it found, and a rerun plants nothing new and puts the in-memory definition back after a reload", async () => {
  const { gm } = await playtestWorld();
  const first = await run(SETUP, gm);
  assert.ok(first.lines.some(l => /TORCHXXXXXXXXXXX/.test(l) && /ROPEXXXXXXXXXXXX/.test(l) && /DAGGERXXXXXXXXXX/.test(l) && /LONGSWORDXXXXXXX/.test(l)), "every uuid is printed");
  const before = counts(), print = fingerprint();
  const again = await run(SETUP, gm);
  assert.equal(again.value.already, "set up");
  assert.deepEqual(counts(), before, "no duplicates");
  assert.equal(fingerprint(), print);
  api().definitions.recipe.delete("playtest-blade");                        // what a reload or a server restart does to an in-memory definition
  const third = await run(SETUP, gm);
  assert.deepEqual(third.value.rebuilt, ["recipe:playtest-blade"]);
  assert.ok(api().definitions.recipe.has("playtest-blade"));
  assert.deepEqual(counts(), before);
});

test("SETUP without the Player users: the characters have no owner and it says what the owner must do; it does not fail", async () => {
  const { gm } = await playtestWorld({ users: false });
  const out = await run(SETUP, gm);
  assert.equal(out.value.warnings.length, 2);
  assert.match(out.value.warnings[0], /There is no user named "Playtest Alice".*Make a Player user with that name.*Owner permission.*User Configuration/);
  assert.deepEqual([ofName("Playtest Alice").ownership, ofName("Playtest Bob").ownership], [{ default: 0 }, { default: 0 }]);
  assert.ok(out.lines.some(l => /WARNINGS/.test(l)));
  assert.equal(game.scenes.getName("Playtest Field").getFlag(M, "playtestManifest").complete, true);
});

test("SETUP: one plain message lists every missing PF2e name, and nothing is made", async () => {
  const { gm } = await playtestWorld({ names: ["Torch", "Rope"] });
  const start = counts();
  const message = await failure(SETUP, gm);
  assert.equal(message, 'the compendium "pf2e.equipment-srd" has no item named "Dagger", "Longsword": change NAMES at the top of this block to equipment items that exist there');
  assert.deepEqual(counts(), start, "nothing was made");
  assert.deepEqual([game.actors.filter(a => /^Playtest/.test(a.name)).length, Object.keys(api().editor.records()).length], [0, 0]);
});

test("SETUP: a level the sheet will not take does not stop it, and says plainly what happened", async () => {
  const { gm } = await playtestWorld();
  const real = Actor.create;
  Actor.create = async data => { const actor = await real(data); const update = actor.update; actor.update = async change => { if ("system.details.level.value" in change) throw new Error("the sheet refused it"); return update(change); }; return actor; };
  const out = await run(SETUP, gm);
  assert.deepEqual(out.value.levelNotes.map(n => /could not be set \(the sheet refused it\); set it on the character sheet by hand/.test(n)), [true, true]);
  assert.equal(game.scenes.getName("Playtest Field").getFlag(M, "playtestManifest").complete, true);
});

test("SETUP refuses (and makes nothing) when a document named like one of its own exists without the flag, or a player runs it", async () => {
  const { gm, annUser } = await playtestWorld();
  const stranger = await Actor.create({ name: "Playtest Bob", type: "character", ownership: { default: 0 } });          // not made by the macro
  const withStranger = counts();
  assert.match(await failure(SETUP, gm), /"Playtest Bob" already exists and was not made by this macro; rename or delete it first/);
  assert.deepEqual(counts(), withStranger);
  await stranger.delete();
  const before = counts();
  assert.equal(await failure(SETUP, annUser), "run this in the GM window");
  assert.equal(await failure(CLEANUP, annUser), "run this in the GM window");
  assert.deepEqual(counts(), before, "a player's attempt changed nothing");
});

test("a SETUP that stops half way leaves a manifest: a rerun says to run CLEANUP, CLEANUP removes everything made so far, and SETUP then works", async () => {
  const { gm } = await playtestWorld();
  const before = fingerprint();
  const real = api().giveStation;
  api().giveStation = async () => { throw new Error("injected: giveStation failed"); };
  assert.equal(await failure(SETUP, gm), "injected: giveStation failed");
  api().giveStation = real;
  assert.ok(Object.keys(api().editor.records()).length === 4, "the editor records were made before the stop");
  assert.match(await failure(SETUP, gm), /part of the seed is missing .*run CLEANUP, then SETUP again/);
  const cleaned = await run(CLEANUP, gm);
  assert.deepEqual(cleaned.value.problems, [], cleaned.value.problems.join("\n"));
  assert.equal(fingerprint(), before, "the world is as it was");
  const ok = await run(SETUP, gm);
  assert.deepEqual(ok.value.warnings, []);
});

test("CLEANUP removes only what SETUP made, prints each removal, leaves the owner's own 'Playtest' things alone, and the second run says nothing to remove", async () => {
  const { gm, annUser } = await playtestWorld();
  // the owner's own things that look like ours: no flag, not in the manifest
  await Actor.create({ name: "Playtest Alice Notes", type: "character", ownership: { default: 0 } });
  await Item.create({ name: "Playtest Mine", type: "equipment", system: {}, flags: {} });
  await api().editor.create("material", { name: "Playtest Mine Too", tier: 1 }, { makeItem: false });
  await Scene.create({ name: "Playtest Other Scene", width: 500, height: 500, grid: { size: 100 }, flags: {} });
  annUser.character = game.actors.getName("Ann");
  env.values.partyLocation = "redhollow";
  const before = fingerprint();
  await run(SETUP, gm);
  assert.notEqual(fingerprint(), before);
  const first = await run(CLEANUP, gm);
  assert.deepEqual(first.value.problems, [], first.value.problems.join("\n"));
  assert.equal(fingerprint(), before, "the world is exactly as it was: the owner's things, the party location and the user's character included");
  assert.ok(game.actors.getName("Playtest Alice Notes") && game.items.getName("Playtest Mine") && api().editor.entry("material:playtest-mine-too") && game.scenes.getName("Playtest Other Scene"), "the owner's own things are still there");
  const printed = first.lines.filter(l => /^PLAYTEST CLEANUP removed: /.test(l)).map(l => l.replace("PLAYTEST CLEANUP removed: ", ""));
  assert.deepEqual(printed, first.value.removed, "every removal is printed");
  for (const expected of [/the scene Playtest Field/, /the character Playtest Alice /, /the character Playtest Wolf /, /the world item Playtest Torch Sample/, /the party workshop party-playtest-camp/, /the Item tags entry/, /the editor record material:playtest-ember/, /the editor record tag:playtest-charm/, /in-memory definition/]) assert.ok(printed.some(p => expected.test(p)), `printed: ${expected}`);
  assert.ok(first.lines.some(l => /put back: the party location/.test(l)) && first.lines.some(l => /put back: Playtest Alice's character/.test(l)));
  assert.ok(printed.findIndex(p => /material:playtest-study-ore/.test(p)) < printed.findIndex(p => /tag:playtest-edge/.test(p)), "the editor's tags are removed last");
  const second = await run(CLEANUP, gm);
  assert.equal(second.value.nothingToRemove, true);
  assert.ok(second.lines.includes("PLAYTEST CLEANUP: nothing to remove"));
  assert.deepEqual([second.value.removed, second.value.restored, second.value.problems], [[], [], []]);
  assert.equal(fingerprint(), before);
});

test("CLEANUP when the scene is already gone: the flagged documents still go, but no editor record is touched and the leftovers are listed", async () => {
  const { gm } = await playtestWorld();
  await run(SETUP, gm);
  await game.scenes.getName("Playtest Field").delete();
  const out = await run(CLEANUP, gm);
  assert.equal(game.actors.filter(a => a.getFlag(M, "playtestSeed")).length, 0);
  assert.deepEqual(Object.keys(api().editor.records()).sort(), ["material:playtest-ember", "material:playtest-study-ore", "tag:playtest-charm", "tag:playtest-edge"], "no manifest, so the editor records stay");
  assert.ok(out.value.notes.some(n => /No manifest was found .*material:playtest-ember.*were NOT touched/.test(n)), out.value.notes.join("\n"));
});

// ---- the mutation checks: each rule the doc claims is broken on purpose in the pasted text, and the scenario that guards it must notice -----------------------------------------
/** The owner-with-things scenario: the owner's own look-alikes, a user's own character and another party location, then SETUP, CLEANUP, CLEANUP again. */
async function ownerScenario(setup = SETUP, cleanup = CLEANUP) {
  const { gm, annUser } = await playtestWorld();
  await Actor.create({ name: "Playtest Alice Notes", type: "character", ownership: { default: 0 } });
  await api().editor.create("material", { name: "Playtest Mine Too", tier: 1 }, { makeItem: false });
  annUser.character = game.actors.getName("Ann");
  env.values.partyLocation = "redhollow";
  const before = fingerprint();
  await run(setup, gm);
  const first = await run(cleanup, gm);
  const afterFirst = fingerprint();
  const second = await run(cleanup, gm);
  return {
    same: afterFirst === before, ownerStays: Boolean(game.actors.getName("Playtest Alice Notes") && api().editor.entry("material:playtest-mine-too")), problems: first.value.problems,
    location: env.values.partyLocation, character: annUser.character?.name ?? null,
    printedAll: first.value.removed.length > 0 && first.lines.filter(l => /^PLAYTEST CLEANUP removed: /.test(l)).length === first.value.removed.length,
    secondSays: second.lines.includes("PLAYTEST CLEANUP: nothing to remove"), noEditorLeft: Object.keys(api().editor.records()).every(k => k === "material:playtest-mine-too")
  };
}
const holds = {
  gmOnly: async (setup) => { const { annUser } = await playtestWorld(); return (await failure(setup, annUser)) === "run this in the GM window"; },
  flagGuard: async (setup) => { const { gm } = await playtestWorld(); await Actor.create({ name: "Playtest Bob", type: "character", ownership: { default: 0 } }); return /was not made by this macro/.test((await failure(setup, gm)) ?? ""); },
  rerun: async (setup) => { const { gm } = await playtestWorld(); await run(setup, gm); const before = counts(); try { const again = await run(setup, gm); return again.value.already === "set up" && JSON.stringify(counts()) === JSON.stringify(before); } catch { return false; } },
  missingNames: async (setup) => { const { gm } = await playtestWorld({ names: ["Torch", "Rope"] }); return /has no item named "Dagger", "Longsword": change NAMES/.test((await failure(setup, gm)) ?? ""); },
  levelSoft: async (setup) => { const { gm } = await playtestWorld(); const real = Actor.create; Actor.create = async data => { const a = await real(data); const u = a.update; a.update = async c => { if ("system.details.level.value" in c) throw new Error("no"); return u(c); }; return a; }; try { await run(setup, gm); return true; } catch { return false; } },
  missingUserSoft: async (setup) => { const { gm } = await playtestWorld({ users: false }); try { const out = await run(setup, gm); return out.value.warnings.length === 2; } catch { return false; } },
  manifestKeys: async (setup) => { const { gm } = await playtestWorld(); const before = fingerprint(); await run(setup, gm); await run(CLEANUP, gm); return fingerprint() === before; },
  partial: async (setup) => {
    const { gm } = await playtestWorld(); const before = fingerprint();
    const real = api().editor.create; let calls = 0;
    api().editor.create = async (...args) => { if (++calls === 2) throw new Error("injected: the second editor record failed"); return real(...args); };     // the stop comes right after the FIRST record
    await failure(setup, gm); api().editor.create = real; await run(CLEANUP, gm); return fingerprint() === before;
  }
};
const MUTATIONS = [
  ["SETUP is GM-only", SETUP, 'if (!game.user.isGM) stop("run this in the GM window");', "", s => holds.gmOnly(s)],
  ["SETUP refuses a document that is not its own", SETUP, "const mine = doc => !doc || doc.getFlag(M, SEED) === true;", "const mine = () => true;", s => holds.flagGuard(s)],
  ["SETUP is rerun-safe (no duplicates)", SETUP, "if (sceneOld || anyOld.length) {", "if (false) {", s => holds.rerun(s)],
  ["one plain message lists every missing PF2e name", SETUP, "${missing.join('\", \"')}", "${missing[0]}", s => holds.missingNames(s)],
  ["a level the sheet refuses never fails SETUP", SETUP, "catch (error) { levelNotes.push(", "catch (error) { throw error; levelNotes.push(", s => holds.levelSoft(s)],
  ["a missing Player user never fails SETUP (the character is left unowned)", SETUP, "warnings.push(`There is no user named", "stop(`There is no user named", s => holds.missingUserSoft(s)],
  ["SETUP writes every editor record into the manifest", SETUP, "man.editorKeys.push(out.key);", "", s => holds.manifestKeys(s)],
  ["SETUP writes the manifest step by step (a half-made seed can be cleaned)", SETUP, "man.editorKeys.push(out.key); await save();", "man.editorKeys.push(out.key);", s => holds.partial(s)],
  ["every document SETUP makes carries the flag (the actors)", SETUP, "const flags = { [M]: { [SEED]: true } };", "const flags = { [M]: {} };", async s => (await ownerScenario(s)).same],
  ["every document SETUP makes carries the flag (the world item)", SETUP, 'name: "Playtest Torch Sample", flags });', 'name: "Playtest Torch Sample" });', async s => (await ownerScenario(s)).same],
  ["CLEANUP removes by flag, never by name", CLEANUP, "const flagged = doc => doc?.getFlag?.(M, SEED) === true;", 'const flagged = doc => /^Playtest/.test(doc?.name ?? "");', async (_, c) => (await ownerScenario(SETUP, c)).ownerStays],
  ["CLEANUP restores the party location", CLEANUP, 'await game.settings.set(M, "partyLocation", man.location ?? "");', "", async (_, c) => (await ownerScenario(SETUP, c)).location === "redhollow"],
  ["CLEANUP restores a user's character", CLEANUP, 'await user.update({ character: original !== "none" && game.actors.get(original) && !flagged(game.actors.get(original)) ? original : null });', "", async (_, c) => (await ownerScenario(SETUP, c)).character === "Ann"],
  ["CLEANUP removes the editor's tags last", CLEANUP, '.sort((a, b) => a.startsWith("tag:") - b.startsWith("tag:"))', "", async (_, c) => { const r = await ownerScenario(SETUP, c); return r.problems.length === 0 && r.noEditorLeft; }],
  ["CLEANUP removes only the editor records the manifest names", CLEANUP, "const keys = [...man.editorKeys]", 'const keys = Object.keys(api.editor.records()).filter(k => /playtest/.test(k))', async (_, c) => (await ownerScenario(SETUP, c)).ownerStays],
  ["CLEANUP prints each removal", CLEANUP, "const done = text => { removed.push(text); console.log(`PLAYTEST CLEANUP removed: ${text}`); };", "const done = text => { removed.push(text); };", async (_, c) => (await ownerScenario(SETUP, c)).printedAll],
  ["a second CLEANUP says nothing to remove", CLEANUP, 'if (nothing) console.log("PLAYTEST CLEANUP: nothing to remove");', "", async (_, c) => (await ownerScenario(SETUP, c)).secondSays]
];
for (const [rule, code, from, to, probe] of MUTATIONS) {
  test(`MUTATION: ${rule}: true on the real text, false when the line is broken`, async () => {
    const isSetup = code === SETUP;
    const real = await probe(isSetup ? SETUP : SETUP, isSetup ? SETUP : CLEANUP);
    assert.equal(real, true, "the rule holds on the real text");
    const broken = mutate(code, from, to);
    const mutated = await probe(isSetup ? broken : SETUP, isSetup ? broken : broken);
    assert.equal(mutated, false, "the guarding scenario notices the broken line");
  });
}
test("MUTATION: a SETUP that makes a user is caught by the static check", () => {
  const broken = SETUP.replace("const stop =", 'const makeUser = () => User.create({ name: "x" });\n  const stop =');
  assert.match(broken, /User\.create/);
  assert.doesNotMatch(SETUP, /User\.create/);
});

// ---- the doc: the INSTALL section and the TEST SHEET, and the console blocks the sheet gives the owner ---------------------------------------------------------------------
const part = n => doc.split(new RegExp(`^## Part ${n}: [^\\n]*\\n`, "m"))[1]?.split(/^## Part /m)[0] ?? "";
const INSTALL = part(1), SHEET = part(4);
const stepsOf = (text, prefix) => [...text.matchAll(new RegExp(`^### ${prefix} (\\d+) (\\[[^\\]]+\\]): ([^\\n]*)\\n([\\s\\S]*?)(?=^### |(?![\\s\\S]))`, "gm"))].map(m => ({ n: Number(m[1]), who: m[2], title: m[3], text: m[4] }));

test("DOC: INSTALL and the TEST SHEET are in the standing gate format (short bullets, one action each, a 'You should see:' bullet per step)", () => {
  const install = stepsOf(INSTALL, "Install"), sheet = stepsOf(SHEET, "Sheet");
  assert.deepEqual(install.map(s => s.n), Array.from({ length: 10 }, (_, i) => i + 1), "ten install steps, numbered");
  assert.deepEqual(sheet.map(s => s.n), Array.from({ length: 12 }, (_, i) => i + 1), "twelve sheet steps, numbered");
  for (const step of [...install, ...sheet]) {
    const section = step.text.split("```js")[0];
    const bullets = section.split("\n").filter(l => /^- /.test(l));
    assert.ok(bullets.length >= 2, `${step.title}: bullets`);
    assert.ok(bullets.every(b => b.length <= 800), `${step.title}: every bullet is short`);
    assert.ok(bullets.some(b => /You should see/.test(b)), `${step.title}: a "You should see" bullet`);
    assert.doesNotMatch(section.replace(/^- .*$/gm, "").replace(/\*\*What to do and see:\*\*/, ""), /\n[A-Z][^\n]{200,}/, `${step.title}: no long paragraph of instructions outside the bullets`);
  }
  assert.match(SHEET, /do the steps in order/);
});

test("DOC: INSTALL says everything the owner needs, plainly", () => {
  for (const [what, pattern] of [
    ["the honour-system warning (hidden DCs, thresholds and GM settings reach every client)", /Perception DCs, a project's stored DC and threshold, the tag ledger and every other GM setting[\s\S]*throwaway data only/],
    ["the Foundry and PF2e versions", /Foundry 14\.369\*\* and \*\*PF2e 8\.6\.1/],
    ["a backup of the Data folder", /### Install 1 \[Owner\]: back up the Foundry data folder[\s\S]*Copy the whole Data folder/],
    ["the exact dev manifest URL", /https:\/\/github\.com\/Nate-Krialia\/pathfinder-progress\/releases\/download\/dev\/module\.json/],
    ["the SHA-256 comparison with module.zip.sha256 from artifact module-<sha>", /module\.zip\.sha256[\s\S]*module-<full sha>|module-<full sha>[\s\S]*module\.zip\.sha256/],
    ["Get-FileHash and sha256sum", /Get-FileHash module\.zip -Algorithm SHA256[\s\S]*sha256sum module\.zip/],
    ["unzipping the artifact into Data/modules/pathfinder-progress/", /Data\/modules\/pathfinder-progress\//],
    ["restarting the server because of socket true", /"socket": true[\s\S]*only when the server starts/],
    ["a NEW world on the pf2e system, modules enabled in that world only", /Create World[\s\S]*Pathfinder Second Edition[\s\S]*Manage Modules[\s\S]*Pathfinder Progress\*\* and \*\*socketlib/],
    ["the socketlib versions", /1\.1\.3[\s\S]*1\.1\.4/],
    ["why Update is not offered, and how to reinstall", /version stays `0\.22\.0`[\s\S]*will NOT offer an Update[\s\S]*Uninstall/],
    ["setLocation", /api\.setLocation\("oakhaven"\)/],
    ["downtime.start", /api\.downtime\.start\(\{ days: 12 \}\)/],
    ["Owner level for the Player users", /non-GM user owns it at \*\*Owner\*\* level/],
    ["the macro never makes users", /never makes users/]
  ]) assert.match(INSTALL, pattern, what);
});

test("DOC: the TEST SHEET marks the NEW paths, says what a Player sees and must NOT see, and is honest about what cannot be hand-tested", () => {
  for (const [what, pattern] of [
    ["NEW: giving a workshop", /\*\*NEW: giving a workshop\.\*\*/], ["NEW: an owned workshop's upgrade", /\*\*NEW: an owned workshop's upgrade\.\*\*/], ["NEW: transfer, then remove", /\*\*NEW: transfer, then remove\.\*\*/],
    ["NEW: the Hub fee error", /Sheet 9 \[Player: Alice\]: the Hub fee error \(NEW, guessed, untried\)/], ["NEW: the commission engine", /Sheet 10 \[GM\]: the commission engine \(NEW, GM API only\)/],
    ["NEW: untitled abilities, with the honest reason", /\*\*NEW, no hand-test \(untitled abilities\):\*\*[^\n]*must be a non-empty string/], ["NEW: the tier-1 fallback, with the honest reason", /\*\*NEW, no hand-test \(the tier-1 fallback\):\*\*[^\n]*cannot be built by hand/],
    ["NEW: the editor discard prompt", /Discard your unsaved changes[^\n]*\*\*NEW\*\*/], ["the damaged stations flag is not hand-testable", /damaged `stations` flag skip is not hand-testable/],
    ["the damaged-store and __proto__ cases are left out", /damaged-store and `__proto__` cases\*\* are left out/], ["the fee console route is guessed, untried", /This route is \*\*guessed, untried\*\*/], ["the fee console route says how to undo it", /\*\*Undo it:\*\* reload Alice's browser page/],
    ["what is in memory only, and why", /in memory only: the recipe \*\*`playtest-blade`\*\*[\s\S]*cannot make a recipe[\s\S]*After a \*\*reload of the GM window or a server restart\*\*/]
  ]) assert.match(SHEET, pattern, what);
  const areas = stepsOf(SHEET, "Sheet").filter(s => [2, 3, 4, 5, 6, 7, 8, 10].includes(s.n));
  for (const step of areas) assert.match(step.text, /\*\*Player sees:?\*\*|\*\*Players never see\*\*/, `${step.title}: says what a Player sees`);
  for (const step of areas.filter(s => s.n !== 7)) assert.match(step.text, /\*\*Must NOT see:?\*\*/, `${step.title}: says what a Player must NOT see`);
  assert.match(SHEET, /\*\*Players must NEVER see\*\* a DC, odds, a percentage, a tag, a tag's effects, a cap, or a study's thresholds/);
  assert.doesNotMatch(SHEET.replace(/Must NOT see[^\n]*/g, "").replace(/\*\*Players must NEVER see\*\*[^\n]*/, ""), /\bDC \d|\d+% chance|odds of/i, "the sheet never states a difficulty");
});

test("the claim 'only the recipe is in memory': after SETUP every Playtest definition the editor can edit is kept in the world, and the recipe is the only one that is not", async () => {
  const { gm } = await playtestWorld();
  await run(SETUP, gm);
  const ours = [["tag", "playtest-edge"], ["tag", "playtest-charm"], ["material", "playtest-ember"], ["material", "playtest-study-ore"], ["recipe", "playtest-blade"]];
  const inMemory = ours.filter(([kind, id]) => !api().editor.canEdit(`${kind}:${id}`)).map(([kind, id]) => `${kind}:${id}`);
  assert.deepEqual(inMemory, ["recipe:playtest-blade"]);
  const everyPlaytest = ["tag", "material", "recipe", "station", "town", "nodeType"].flatMap(kind => [...api().definitions[kind].keys()].filter(id => /^playtest-/.test(id)).map(id => `${kind}:${id}`)).sort();
  assert.deepEqual(everyPlaytest, ours.map(([kind, id]) => `${kind}:${id}`).sort(), "no other Playtest definition exists");
});

/** Run every console block of a sheet text as written, in the sheet's order, each as the user the sheet names. Throws when one of them does not do what the sheet says. */
async function runSheetBlocks(sheetText) {
  const { gm, annUser } = await playtestWorld();
  await run(SETUP, gm);
  const blocks = [...sheetText.matchAll(/```js\n([\s\S]*?)```/g)].map(m => m[1].trim());
  const find = needle => { const hits = blocks.filter(b => b.includes(needle)); assert.equal(hits.length, 1, `exactly one sheet block has ${needle}`); return hits[0]; };
  const exec = (code, user) => as(user, () => (0, eval)(`(async () => { ${code} })()`));
  canvas.scene = game.scenes.getName("Playtest Field");
  // Sheet 1: open downtime
  await exec(find("api.downtime.start"), gm);
  assert.equal(api().downtime.isOpen(), true);
  // Sheet 4: Alice gathers (queued), the GM resolves, Alice searches, the GM clears the map
  const roll = (degree, total, natural) => ({ options: { degreeOfSuccess: degree }, total, dice: [{ faces: 20, results: [{ result: natural, active: true }] }] });
  ofName("Playtest Alice").rolls.push(roll(2, 20, 12));
  (ofName("Playtest Alice").perceptionRolls ??= []).push(roll(2, 3, 1));
  await exec(find('t.name === "Playtest Herb Patch"'), annUser);
  assert.equal(api().queue.list().filter(r => r.action.type === "gather").length, 1, "the gather is queued");
  const resolved = await as(gm, () => api().queue.resolveAll({ chat: false }));
  assert.ok(resolved.results.every(r => r.status === "resolved"), JSON.stringify(resolved.results));
  assert.ok(ofName("Playtest Alice").items.some(i => i.getFlag(M, "material")?.materialId === "moonpetal" || /moonpetal|herb/i.test(i.name) || i.getFlag(M, "material")), "she gathered something");
  await exec(find("api.searchArea"), annUser);
  const cleared = await exec(find("api.clearMap"), gm);
  void cleared;
  assert.equal(game.scenes.getName("Playtest Field").tokens.some(t => t.name === "Playtest Herb Patch"), false, "the placed nodes are gone");
  assert.equal(game.scenes.getName("Playtest Field").tokens.some(t => t.name === "Playtest Wolf Corpse"), true, "the hand-made corpse node stays");
  // Sheet 8: the stations list, an owned workshop's upgrade (Alice asks, the GM resolves), transfer then remove
  await exec(find("api.stationsFor"), gm);
  await exec(find("workshop.startUpgrade"), annUser);
  await exec(find("project: \"upgrade-playtest-anvil-craftDays-1\""), gm);
  assert.equal(api().stationsFor(ofName("Playtest Alice")).find(s => s.id === "playtest-anvil").upgrades.craftDays, 1, "the owned workshop was upgraded");
  await exec(find("api.transferStation"), gm);
  for (const name of ["Playtest Alice", "Playtest Bob"]) assert.equal((ofName(name).getFlag(M, "stations") ?? []).length, 0, `${name} no longer lists the anvil`);
  // Sheet 10: the commission engine
  await exec(find("api.commissions.issue"), gm);
  assert.equal(api().commissions.list()[0].status, "requested");
  await exec(find("api.commissions.craft"), gm);
  const patron = ofName("Playtest Patron");
  assert.equal(patron.items.filter(i => i.type === "weapon" && i.getFlag(M, "crafted")).length, 1, "the patron holds the delivered dagger");
  assert.deepEqual(patron.items.filter(i => i.getFlag(M, "material")).map(i => `${i.getFlag(M, "material").materialId}x${i.system.quantity}`), ["ironx1"], "the patron's spider fang and one iron were used");
  assert.equal(api().commissions.list()[0].status, "delivered");
}

test("the console blocks the sheet gives the owner run as written, in the order of the sheet", async () => { await runSheetBlocks(SHEET); });

test("what a Player's Hub is built from carries no tag, need, cap or difficulty, and an unknown fee shows as unusable on the seed's own workshops (the sheet's console route)", async () => {
  const { gm, annUser } = await playtestWorld();
  await run(SETUP, gm);
  await as(annUser, () => api().definitions.refresh());
  const { readFacts } = await import("../scripts/hub/facts.js");
  const { emptyState, formulaeTab } = await import("../scripts/hub/viewmodels.js");
  const { findTagLeaks } = await import("./helpers.js");
  const { findings } = await import("./scan.js");
  const { STATIONS } = await import("../scripts/config.js");
  const state = { ...emptyState(), recipeId: "playtest-blade" };
  const facts = await as(annUser, () => readFacts(api(), ofName("Playtest Alice"), state));
  assert.deepEqual(findTagLeaks({ recipes: facts.recipes, materials: facts.materials, stations: facts.stations }), [], "no tag, need, cap or tier in what a player's window reads");
  assert.deepEqual(findings(facts.recipes), [], "no difficulty field in the recipes a player reads");
  const fitsOf = slot => facts.recipes["playtest-blade"].slots.find(s => s.name === slot).fits.map(f => f.name).sort();
  assert.deepEqual([fitsOf("edge"), fitsOf("charm")], [["Playtest Study Ore", "Playtest Torch"], ["Playtest Rope"]], "a tagged slot reaches the player as the NAMES of her own items that fit (the two Torch stacks share one source, so they are one choice)");
  // the sheet's console route: take tier 2's fee away on the Player's side
  const saved = STATIONS.feeByTier[2];
  const quiet = console.error; console.error = () => {};
  try {
    delete STATIONS.feeByTier[2];
    const broken = await as(annUser, () => readFacts(api(), ofName("Playtest Alice"), state));
    const forge = broken.stations.find(s => s.id === "oakhaven-forge");
    assert.deepEqual([forge.usable, forge.feeUnknown], [false, true]);
    const tab = formulaeTab(broken, state);
    assert.ok(tab.detail.stations.blocked.some(b => /Oakhaven Forge: its fee could not be worked out, so it cannot be used right now\. Ask the GM\./.test(b.reason)));
    assert.ok(tab.detail.stations.options.every(o => o.id !== "oakhaven-forge") && tab.detail.stations.options.length >= 1, "the other workshops are still offered");
  } finally { console.error = quiet; STATIONS.feeByTier[2] = saved; }
});

test("MUTATION: break a sheet block (a station left out of the commission craft, a wrong project id, a missing skill) and the run of the sheet's blocks fails", async () => {
  for (const [from, to] of [[', station: "oakhaven-forge" })', " })"], ["upgrade-playtest-anvil-craftDays-1", "upgrade-playtest-anvil-craftDays-9"], ['tokenId: node.id, skill: "survival" }', "tokenId: node.id }"]]) {
    await assert.rejects(runSheetBlocks(mutate(SHEET, from, to)), undefined, `the sheet run notices: ${from}`);
  }
});

test("MUTATION: remove one claim from the INSTALL or the TEST SHEET text and the check for that claim fails (each check is specific)", () => {
  const claims = [
    [SHEET, /\*\*NEW: giving a workshop\.\*\*/], [SHEET, /\*\*NEW: an owned workshop's upgrade\.\*\*/], [SHEET, /\*\*NEW: transfer, then remove\.\*\*/], [SHEET, /the Hub fee error \(NEW, guessed, untried\)/], [SHEET, /the commission engine \(NEW, GM API only\)/],
    [SHEET, /\*\*NEW, no hand-test \(untitled abilities\):\*\*/], [SHEET, /\*\*NEW, no hand-test \(the tier-1 fallback\):\*\*/], [SHEET, /damaged `stations` flag skip is not hand-testable/], [SHEET, /This route is \*\*guessed, untried\*\*/],
    [SHEET, /\*\*Undo it:\*\* reload Alice's browser page/], [SHEET, /\*\*Players must NEVER see\*\* a DC/], [INSTALL, /socketlib \*\*1\.1\.3\*\*/], [INSTALL, /Get-FileHash module\.zip -Algorithm SHA256/], [INSTALL, /only when the server starts/], [INSTALL, /throwaway data only/], [INSTALL, /api\.setLocation\("oakhaven"\)/], [INSTALL, /non-GM user owns it at \*\*Owner\*\* level/]
  ];
  for (const [text, pattern] of claims) {
    assert.match(text, pattern, `the real text has: ${pattern}`);
    assert.doesNotMatch(text.replace(new RegExp(pattern.source, "g"), ""), pattern, `without it the check fails: ${pattern}`);
  }
  // a step with no "You should see" bullet is caught by the format check
  const step = stepsOf(SHEET, "Sheet")[0];
  assert.ok(/You should see/.test(step.text) && !/You should see/.test(step.text.replace(/You should see/g, "")), "the format check looks for the bullet");
});

test("MUTATION: a recipe or material that leaked a tag, a need or a cap into a player's data is caught by the scan the Hub test uses", async () => {
  const { findTagLeaks } = await import("./helpers.js");
  assert.deepEqual(findTagLeaks({ recipes: { r: { slots: [{ name: "edge", fits: [{ id: "x", name: "Torch" }] }] } } }), []);
  assert.ok(findTagLeaks({ recipes: { r: { slots: [{ name: "edge", needs: { all: ["playtest-edge"] } }] } } }).length > 0, "a need is a leak");
  assert.ok(findTagLeaks({ materials: { m: { id: "m", tags: ["playtest-edge"] } } }).length > 0, "a tag list is a leak");
});
