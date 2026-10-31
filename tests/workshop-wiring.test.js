/**
 * Stage 10c: workshop upgrades and building your own workshop, through the REAL scripts/main.js in the fake Foundry
 * (tests/fake-world.js). Players' calls are relayed to a GM context like real socketlib; every world write counts so a failure
 * can be injected at each one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DAGGER, M, SEL, as, craft, env, events, getApi, loudly, makeActor, measure, pendingOf, snapshot, stashOf, world, everyFailureLeavesNothingHalfDone, clone
} from "./fake-world.js";
import { GENERIC_FAILURE } from "../scripts/queue/relay.js";
import { applyStationUpgrade } from "../scripts/stations/store.js";
import { setCraftReductions } from "../scripts/queue/work.js";
import { UUID, UUID_2 } from "./helpers.js";
import { withoutDifficulty } from "../scripts/difficulty.js";

const api = () => getApi();
const crit = () => ({ options: { degreeOfSuccess: 3 }, total: 30, dice: [{ faces: 20, results: [{ result: 15, active: true }] }] });
const FORGE = "oakhaven-forge";
const forgeRow = actor => api().stationsFor(actor).find(s => s.id === FORGE);
const clean = () => assert.deepEqual(api().audit.scan(), []);
const projectOf = (actor, id) => (actor.getFlag(M, "projects") ?? []).find(p => p.id === id);
const start = (user, actor, params) => as(user, () => api().workshop.startUpgrade(actor, params));
const aside = (user, actor, id) => as(user, () => api().workshop.putAside(actor, id));

/** A world where Ann has tier-3 starmetal for a tier upgrade and tier-1 iron, no downtime needed to start. */
const forgeWorld = async (options = {}) => {
  const w = await world({ downtime: 0, iron: 4, fang: 0, ...options });
  await api().giveMaterial(w.ann, "starmetal", 6);
  return w;
};
const TIER3 = { stationId: FORGE, kind: "tier", materials: { starmetal: 4 } };

// UPGRADE PROJECTS: start, escrow, put aside --------------------------------------------------------------------------------
test("UPGRADE: starting a project holds the TARGET-tier materials in escrow on it; no gold, no downtime, no queue item", async () => {
  const w = await forgeWorld();
  const before = measure(w.ann);
  const project = await start(w.annUser, w.ann, TIER3);
  assert.deepEqual([project.id, project.goalName, project.status, project.progress], ["upgrade-oakhaven-forge-tier-3", "Oakhaven Forge: tier 3", "active", 0]);
  assert.deepEqual(project.outcome, { type: "upgradeStation", stationId: FORGE, kind: "tier", from: 2, to: 3 });
  assert.deepEqual(project.materials, [{ materialId: "starmetal", qty: 4 }]);
  assert.equal(project.tier, 3);
  assert.equal(project.fee, undefined, "no gold cost");
  assert.deepEqual(stashOf(w.ann), { iron: 4, starmetal: 2 }, "4 starmetal left the stash");
  assert.equal(measure(w.ann).copper, before.copper, "no gold moved");
  assert.equal(api().downtime.isOpen(), false, "no downtime was needed");
  assert.deepEqual(api().queue.list(), [], "and nothing is queued");
  assert.ok(events().includes("upgrade started: Oakhaven Forge: tier 3 by Ann; escrow taken: 4x Starmetal"), events().join(" | "));
  assert.deepEqual(withoutDifficulty(projectOf(w.ann, project.id)), project, "a player is handed the project without its DC (docs/11b); the stored record still has it");
  assert.equal("dc" in project, false);
  clean();
});

test("UPGRADE: difficulty SCALES with the target tier (research DC and progress needed rise)", async () => {
  const w = await forgeWorld();
  await api().giveMaterial(w.ann, "silver", 4);
  const low = await start(w.annUser, w.ann, { stationId: FORGE, kind: "craftDays", materials: { iron: 2 } });            // target tier 1
  const high = await start(w.annUser, w.ann, { ...TIER3 });                                                            // target tier 3
  const [lowStored, highStored] = [projectOf(w.ann, low.id), projectOf(w.ann, high.id)];                                // the stored (GM) record has the DC; the player's copy does not
  assert.ok(highStored.dc > lowStored.dc && high.threshold > low.threshold, `${lowStored.dc}/${low.threshold} < ${highStored.dc}/${high.threshold}`);
  assert.deepEqual([low.tier, high.tier], [1, 3]);
});

test("UPGRADE refusals reach the player as the real plain message and change nothing", async () => {
  const w = await forgeWorld();
  await as(w.gm, () => api().setStationState(FORGE, { owner: w.bob.id, access: [] }));
  const refusedFor = async (call, message) => { const before = snapshot(w); await assert.rejects(call, e => e.message === message && !/exception occured/.test(e.message), message); assert.equal(snapshot(w), before, message); };
  await refusedFor(start(w.annUser, w.ann, TIER3), "Ann may not use Oakhaven Forge, so cannot upgrade it.");
  await as(w.gm, () => api().clearStationState(FORGE));
  await refusedFor(start(w.annUser, w.ann, { ...TIER3, stationId: "nope" }), 'There is no workshop "nope".');
  await refusedFor(start(w.annUser, w.ann, { ...TIER3, kind: "gold" }), 'Unknown upgrade "gold" (choose one of tier, craftDays, hearth).');
  await refusedFor(start(w.annUser, w.ann, { ...TIER3, materials: { iron: 4 } }), "Cannot start this upgrade (Oakhaven Forge: tier): Iron is tier 1, but this upgrade needs materials of tier 3.");
  await refusedFor(start(w.annUser, w.ann, { ...TIER3, materials: { starmetal: 3 } }), "Cannot start this upgrade (Oakhaven Forge: tier): this upgrade needs 4 unit(s) of tier-3 materials (you chose 3).");
  await refusedFor(start(w.annUser, w.ann, { ...TIER3, materials: { starmetal: 9 } }), "Cannot start this upgrade (Oakhaven Forge: tier): needs 9 Starmetal but only 6 available. Nothing can be bought: check the Compendium for where to find what you are missing.");
  await refusedFor(start(w.bobUser, w.ann, TIER3), "workshop: Bob does not own Ann");
  await start(w.annUser, w.ann, TIER3);
  await refusedFor(start(w.annUser, w.ann, TIER3), "Ann is already researching that upgrade for Oakhaven Forge.");
  assert.deepEqual(env.handlerThrows, [], "every refusal travelled as data");
});

test("UPGRADE: the tier cap stops a town workshop at 4 and a carried kit at the portable cap", async () => {
  const w = await forgeWorld();
  await applyStationUpgrade(api(), FORGE, { kind: "tier", from: 2, to: 3 });
  await applyStationUpgrade(api(), FORGE, { kind: "tier", from: 3, to: 4 });
  await assert.rejects(start(w.annUser, w.ann, { stationId: FORGE, kind: "tier", materials: { starmetal: 4 } }), e => e.message === "Oakhaven Forge is already at tier 4, the highest a workshop can reach (4).");
  const kit = await as(w.gm, () => api().giveStation(w.ann, { name: "Travel Kit", category: "smithing", tier: 2, id: "kit" }));
  await assert.rejects(start(w.annUser, w.ann, { stationId: kit.id, kind: "tier", materials: { starmetal: 4 } }), e => e.message === "Travel Kit is already at tier 2, the highest a carried kit can reach (2).");
});

test("PUT ASIDE: the escrow comes back exactly, once; the project is closed; a queued research item must be cancelled first", async () => {
  const w = await forgeWorld({ downtime: 6 });
  const project = await start(w.annUser, w.ann, TIER3);
  const research = await as(w.annUser, () => api().queue.submit(w.ann, "research", { projectId: project.id, skill: "crafting" }, 1));
  w.ann.rolls.push(crit());
  await assert.rejects(aside(w.annUser, w.ann, project.id), e => e.message === 'Cancel the queued research for "Oakhaven Forge: tier 3" first, then put it aside.');
  assert.deepEqual(stashOf(w.ann), { iron: 4, starmetal: 2 }, "nothing was returned yet");
  await as(w.annUser, () => api().queue.cancel(w.ann, research.id));
  const result = await aside(w.annUser, w.ann, project.id);
  assert.deepEqual(result, { returned: [{ materialId: "starmetal", units: 4 }] });
  assert.deepEqual(stashOf(w.ann), { iron: 4, starmetal: 6 });
  assert.equal(projectOf(w.ann, project.id).status, "abandoned");
  assert.ok(events().includes("project put aside: Oakhaven Forge: tier 3 by Ann; escrow returned: 4x Starmetal"), events().join(" | "));
  await assert.rejects(aside(w.annUser, w.ann, project.id), e => e.message === '"Oakhaven Forge: tier 3" is abandoned, not active.');
  assert.deepEqual(stashOf(w.ann), { iron: 4, starmetal: 6 }, "never returned twice");
  await assert.rejects(aside(w.bobUser, w.ann, project.id), e => e.message === "workshop: Bob does not own Ann");
  await assert.rejects(aside(w.annUser, w.ann, "nope"), e => e.message === 'Ann has no project "nope".');
  clean();
  // The same upgrade can be started again afterwards.
  assert.equal((await start(w.annUser, w.ann, TIER3)).status, "active");
});

test("PUT ASIDE: a stack that was emptied into escrow is recreated; the GM's plain abandonProject refuses a project that holds escrow", async () => {
  const w = await world({ downtime: 0, iron: 0, fang: 0 });
  await api().giveMaterial(w.ann, "starmetal", 4);
  const project = await start(w.annUser, w.ann, TIER3);
  assert.deepEqual(stashOf(w.ann), {});
  await assert.rejects(as(w.gm, () => api().abandonProject(w.ann, project.id)), /holds escrowed materials; put it aside with api.workshop.putAside/);
  await aside(w.annUser, w.ann, project.id);
  assert.deepEqual(stashOf(w.ann), { starmetal: 4 });
});

test("UPGRADE: starting and putting aside need no downtime and never block End downtime", async () => {
  const w = await forgeWorld({ downtime: 6 });
  const project = await start(w.annUser, w.ann, TIER3);
  const ended = await api().downtime.end();
  assert.deepEqual([ended.ended, ended.rejected], [true, 0]);
  await aside(w.annUser, w.ann, project.id);
  assert.equal(api().downtime.isOpen(), false);
});

// COMPLETION: the research days, then the station changes -------------------------------------------------------------------
test("UPGRADE: researching it (crafting, the ordinary research queue item) finishes it and APPLIES it to the station; the escrow is spent, not returned", async () => {
  const w = await forgeWorld({ downtime: 6 });
  const project = await start(w.annUser, w.ann, { stationId: FORGE, kind: "craftDays", materials: { iron: 2 } });
  assert.deepEqual(forgeRow(w.ann).upgrades, { craftDays: 0, hearths: 0, hearthNote: "no effect yet" });
  const item = await as(w.annUser, () => api().queue.submit(w.ann, "research", { projectId: project.id, skill: "crafting" }, 4));
  for (let i = 0; i < 4; i++) w.ann.rolls.push(crit());
  const outcome = await api().queue.resolve(w.ann, item.id, { chat: false });
  assert.equal(outcome.status, "resolved");
  assert.equal(projectOf(w.ann, project.id).status, "complete");
  assert.deepEqual(forgeRow(w.ann).upgrades.craftDays, 1, "applied to the station");
  assert.deepEqual(stashOf(w.ann), { iron: 2, starmetal: 6 }, "the 2 escrowed iron were spent (4 -> 2)");
  assert.ok(events().includes("upgrade finished: Oakhaven Forge: craft days cut by 1 (researched by Ann)"), events().join(" | "));
  await assert.rejects(aside(w.annUser, w.ann, project.id), e => e.message === '"Oakhaven Forge: craft days cut by 1" is complete, not active.', "a finished upgrade cannot be put aside for a refund");
  clean();
  // and the second craft-day level now needs tier-2 materials
  await api().giveMaterial(w.ann, "silver", 3);
  const second = await start(w.annUser, w.ann, { stationId: FORGE, kind: "craftDays", materials: { silver: 3 } });
  assert.equal(second.id, "upgrade-oakhaven-forge-craftDays-2");
});

test("UPGRADE: a TIER upgrade changes the tier (and so the fee), and every fee is still read from the station's tier", async () => {
  const w = await forgeWorld({ downtime: 12 });
  await api().giveMaterial(w.ann, "spider-fang", 2);
  assert.equal(api().previewCraft(w.ann, DAGGER, SEL, FORGE).plan.fee, 5, "tier 2: 5 gp");
  const project = await start(w.annUser, w.ann, TIER3);
  await as(w.gm, () => api().grantDays(w.ann, 6));
  const item = await as(w.annUser, () => api().queue.submit(w.ann, "research", { projectId: project.id, skill: "crafting" }, 9));
  for (let i = 0; i < 9; i++) w.ann.rolls.push(crit());
  assert.equal((await api().queue.resolve(w.ann, item.id, { chat: false })).status, "resolved");
  assert.equal(forgeRow(w.ann).tier, 3);
  assert.equal(api().previewCraft(w.ann, DAGGER, SEL, FORGE).plan.fee, 20, "tier 3: 20 gp");
  clean();
});

test("UPGRADE: two characters finishing the SAME upgrade at the same moment: exactly one applies it (the station lock), the other is not lost", async () => {
  const w = await forgeWorld({ downtime: 6 });
  await api().giveMaterial(w.bob, "iron", 2);
  const params = { stationId: FORGE, kind: "craftDays", materials: { iron: 2 } };
  const annProject = await start(w.annUser, w.ann, params);
  const bobProject = await start(w.bobUser, w.bob, params);
  const annItem = await as(w.annUser, () => api().queue.submit(w.ann, "research", { projectId: annProject.id, skill: "crafting" }, 4));
  const bobItem = await as(w.bobUser, () => api().queue.submit(w.bob, "research", { projectId: bobProject.id, skill: "crafting" }, 4));
  for (let i = 0; i < 4; i++) { w.ann.rolls.push(crit()); w.bob.rolls.push(crit()); }
  const results = await Promise.allSettled([api().queue.resolve(w.ann, annItem.id, { chat: false }), api().queue.resolve(w.bob, bobItem.id, { chat: false })]);
  assert.equal(forgeRow(w.ann).upgrades.craftDays, 1, "applied exactly once, never to level 2");
  const done = results.filter(r => r.status === "fulfilled" && r.value.status === "resolved");
  assert.equal(done.length, 1);
  const loser = results.find(r => !(r.status === "fulfilled" && r.value.status === "resolved"));
  const loserActor = pendingOf(w.ann).length ? w.ann : w.bob;
  const loserProject = loserActor === w.ann ? annProject : bobProject;
  assert.equal(pendingOf(loserActor).length, 1, "the other one is still queued, nothing was lost");
  const retried = await api().queue.resolve(loserActor, pendingOf(loserActor)[0].id, { chat: false });
  assert.equal(retried.status, "invalid");
  assert.match(retried.message, /Oakhaven Forge is already at craftDays level 1, but this project began at 0; put it aside to get your materials back\. 4 day\(s\) refunded\./);
  await aside(loserActor === w.ann ? w.annUser : w.bobUser, loserActor, loserProject.id);
  assert.deepEqual(stashOf(loserActor).iron, loserActor === w.ann ? 4 : 2, "the loser got their materials back");
  void loser;
  clean();
});

test("UPGRADE: a project whose station has vanished cannot be researched (days refunded), and putting it aside returns the materials", async () => {
  const w = await forgeWorld({ downtime: 6 });
  const kit = await as(w.gm, () => api().giveStation(w.ann, { name: "Travel Kit", category: "smithing", tier: 1, id: "kit" }));
  const project = await start(w.annUser, w.ann, { stationId: kit.id, kind: "craftDays", materials: { iron: 2 } });
  const item = await as(w.annUser, () => api().queue.submit(w.ann, "research", { projectId: project.id, skill: "crafting" }, 2));
  await as(w.gm, () => api().removeStation(w.ann, kit.id));
  w.ann.rolls.push(crit(), crit());
  const outcome = await api().queue.resolve(w.ann, item.id, { chat: false });
  assert.equal(outcome.status, "invalid");
  assert.match(outcome.message, /the workshop "kit" no longer exists; put the project aside to get your materials back\. 2 day\(s\) refunded\./);
  assert.equal(measure(w.ann).freeDays, 6);
  await aside(w.annUser, w.ann, project.id);
  assert.equal(stashOf(w.ann).iron, 4);
});

test("HEARTH: an upgrade that is a counter with NO EFFECT YET, labelled so everywhere it shows", async () => {
  const w = await forgeWorld({ downtime: 6 });
  const project = await start(w.annUser, w.ann, { stationId: FORGE, kind: "hearth", materials: { iron: 2 } });
  assert.equal(project.goalName, "Oakhaven Forge: hearth 1 (no effect yet)");
  assert.match(api().queue.list().length ? "" : "no row yet", /no row/);
  const item = await as(w.annUser, () => api().queue.submit(w.ann, "research", { projectId: project.id, skill: "crafting" }, 4));
  assert.match(api().queue.list()[0].label, /Research: Oakhaven Forge: hearth 1 \(no effect yet\)/);
  for (let i = 0; i < 4; i++) w.ann.rolls.push(crit());
  await api().queue.resolve(w.ann, item.id, { chat: false });
  assert.deepEqual(forgeRow(w.ann).upgrades, { craftDays: 0, hearths: 1, hearthNote: "no effect yet" });
  await api().giveMaterial(w.ann, "spider-fang", 2);
  const before = api().previewCraft(w.ann, DAGGER, SEL, FORGE).plan;
  assert.equal(before.fee, 5, "a hearth changes no fee");
  const action = await craft(w);
  assert.equal(action.daysReserved, 2, "and no craft time");
});

// CRAFT DAYS: real upgrades, stacked, through the craft queue path ----------------------------------------------------------
test("CRAFT DAYS: real stacked upgrades cut the days through the queue path, and a craft never takes less than 1 day after ALL reductions", async () => {
  try {
    const w = await world({ downtime: 12 });
    const recipe = { ...clone(api().definitions.recipe.get(DAGGER)), id: "great-blade", name: "Great Blade", craftLevel: 8 };   // 1 + 8/2 = 5 days
    api().definitions.recipe.set("great-blade", recipe);
    api().resolvedOutputs.set("great-blade", { 1: UUID, 2: UUID_2, 3: UUID });
    await api().grantFormula(w.ann, "great-blade");
    await api().giveMaterial(w.ann, "iron", 20);
    await api().giveMaterial(w.ann, "spider-fang", 20);
    const queued = async (levels, tools = []) => {
      setCraftReductions(tools.length ? () => tools : null);
      const action = await craft(w, w.annUser, w.ann, { recipe: "great-blade", stationId: FORGE });
      await as(w.annUser, () => api().queue.cancel(w.ann, action.id));
      return action.daysReserved;
    };
    assert.equal(await queued(0), 5);
    for (const [level, expected] of [[1, 4], [2, 3], [3, 2]]) {
      await applyStationUpgrade(api(), FORGE, { kind: "craftDays", from: level - 1, to: level });
      assert.equal(await queued(level), expected, `craft-day level ${level}`);
    }
    assert.equal(await queued(3, [{ days: 1, source: "tools" }]), 1, "3 from the workshop + 1 from tools = 4 off 5");
    assert.equal(await queued(3, [{ days: 2, source: "tools" }, { days: 3, source: "bench" }]), 1, "stacked far past the base: still 1, never 0 or negative");
    // The reserved days are what the escrow says, and the audit agrees.
    setCraftReductions(null);
    const action = await craft(w, w.annUser, w.ann, { recipe: "great-blade", stationId: FORGE });
    assert.deepEqual([action.daysReserved, action.params.escrow.days, measure(w.ann).reservedDays], [2, 2, 2]);
    clean();
  } finally { setCraftReductions(null); }
});

// BUILD YOUR OWN WORKSHOP ---------------------------------------------------------------------------------------------------
const BUILD = { blueprint: "camp-forge", selection: { anvil: "iron", hearthstone: "silver" } };
const build = (user, actor, over = {}, days) => as(user, () => api().queue.submit(actor, "build", { ...BUILD, ...over }, days));

/** Ann has researched the design (granted by the GM here; the research run has its own test) and holds the materials and gold. */
async function builderWorld(options = {}) {
  const w = await world({ downtime: 12, iron: 5, fang: 0, copper: 5000, ...options });
  await api().giveMaterial(w.ann, "silver", 2);
  await as(w.gm, () => api().workshop.grantDesign(w.ann, "camp-forge"));
  return w;
}

test("DESIGN: researching a blueprint is an ordinary research project; finishing it gives the researcher the design", async () => {
  const w = await world({ downtime: 12, iron: 0, fang: 0 });
  const project = await as(w.annUser, () => api().workshop.startDesign(w.ann, { blueprint: "camp-forge" }));
  assert.deepEqual([project.id, project.goalName, project.outcome], ["design-camp-forge", "Design: Camp Forge", { type: "designBlueprint", blueprintId: "camp-forge" }]);
  assert.equal(project.materials, undefined);
  await assert.rejects(as(w.annUser, () => api().workshop.startDesign(w.ann, { blueprint: "camp-forge" })), e => e.message === "Ann is already designing Camp Forge.");
  await assert.rejects(as(w.annUser, () => api().workshop.startDesign(w.ann, { blueprint: "nope" })), e => e.message === 'There is no blueprint "nope".');
  const item = await as(w.annUser, () => api().queue.submit(w.ann, "research", { projectId: project.id, skill: "crafting" }, 4));
  for (let i = 0; i < 4; i++) w.ann.rolls.push(crit());
  assert.equal((await api().queue.resolve(w.ann, item.id, { chat: false })).status, "resolved");
  assert.deepEqual(w.ann.getFlag(M, "blueprints").map(b => [b.blueprintId, b.source]), [["camp-forge", "research"]]);
  await assert.rejects(as(w.annUser, () => api().workshop.startDesign(w.ann, { blueprint: "camp-forge" })), e => e.message === "Ann already holds the design for Camp Forge.");
  assert.equal(w.bob.getFlag(M, "blueprints"), undefined, "the design is the researcher's, not the party's");
  clean();
});

test("BUILD: rejecting a build is a whisper to the owner and the GM, never public (the blueprint's name is private)", async () => {
  const w = await builderWorld();
  const action = await build(w.annUser, w.ann);
  env.chat.length = 0;
  await as(w.gm, () => api().queue.reject(w.ann, action.id));
  assert.ok(env.chat.length >= 1 && env.chat.every(m => Array.isArray(m.whisper) && m.whisper.length > 0), "no public message");
  assert.deepEqual([...env.chat[0].whisper].sort(), [w.annUser.id, w.gm.id].sort());
  assert.match(env.chat[0].content, /Build: Camp Forge/);
  clean();
});

test("BUILD: queueing takes the materials AND gold now and reserves the days; it BLOCKS End downtime; cancelling returns everything once", async () => {
  const w = await builderWorld();
  const before = measure(w.ann);
  const action = await build(w.annUser, w.ann);
  const after = measure(w.ann);
  assert.deepEqual([action.type, action.daysReserved, action.params.blueprintName, action.params.townName], ["build", 3, "Camp Forge", "Oakhaven"]);
  assert.equal(before.copper - after.copper, 2500, "the 25 gp");
  assert.deepEqual([after.stash.iron, after.stash.silver], [before.stash.iron - 3, before.stash.silver - 1]);
  assert.deepEqual([after.freeDays, after.reservedDays, after.totalDays], [before.freeDays - 3, 3, before.totalDays]);
  const [row] = api().queue.list();
  assert.equal(row.label, "Build: Camp Forge");
  assert.match(row.detail, /3 day\(s\) reserved; to be built in Oakhaven; escrow: 3x Iron, 1x Silver and a 25 gp fee/);
  assert.doesNotMatch(row.detail, /%|\bDC\b|odds|chance/i);
  assert.deepEqual(await api().downtime.end(), { blocked: 1 }, "a build spends days, so it blocks End downtime");
  assert.ok(events().includes("queued build: Camp Forge in Oakhaven for Ann; escrow: taken".replace("escrow: taken", "escrow taken: 3x Iron, 1x Silver and a 25 gp fee; 3 day(s) reserved")), events().join(" | "));
  await as(w.annUser, () => api().queue.cancel(w.ann, action.id));
  assert.deepEqual(measure(w.ann), before, "gold, materials and days exactly as before");
  await assert.rejects(as(w.annUser, () => api().queue.cancel(w.ann, action.id)), /has no queued action/);
  assert.deepEqual(measure(w.ann), before);
  assert.deepEqual(env.values.partyStations ?? [], [], "nothing was built");
  clean();
});

test("BUILD refusals reach the player as the real plain message and change nothing", async () => {
  const w = await builderWorld();
  const refusedFor = async (call, message) => { const before = snapshot(w); await assert.rejects(call(), e => e.message === message && !/exception occured/.test(e.message), message); assert.equal(snapshot(w), before, message); };
  await refusedFor(() => build(w.bobUser, w.bob), "Bob has not designed Camp Forge yet: research the design first.");
  await refusedFor(() => build(w.annUser, w.ann, { blueprint: "nope" }), 'There is no blueprint "nope".');
  await refusedFor(() => build(w.annUser, w.ann, {}, 9), "build: this build takes 3 day(s) (got 9); the time is set by the blueprint, leave days out");
  await refusedFor(() => build(w.annUser, w.ann, { selection: { anvil: "iron" } }), "Cannot queue this build (Camp Forge): slot \"hearthstone\": no material selected. Nothing can be bought: check the Compendium for where to find what you are missing.");
  await refusedFor(() => build(w.annUser, w.ann, { selection: { anvil: "iron", hearthstone: "iron" } }), 'Cannot queue this build (Camp Forge): slot "hearthstone": Iron is tier 1 but the slot needs tier 2 or higher.');
  env.values.partyLocation = "";
  await refusedFor(() => build(w.annUser, w.ann), "The party's location is not set, so there is nowhere to build. Ask the GM to set where the party is.");
  env.values.partyLocation = "oakhaven";
  const poor = await builderWorld({ copper: 1000 });
  await assert.rejects(build(poor.annUser, poor.ann), e => e.message === "Ann cannot afford the 25 gp the build costs (has 10 gp).");
  const short = await builderWorld();
  await short.ann.update({ [`flags.${M}.downtimeDays`]: 2 });
  await assert.rejects(build(short.annUser, short.ann), e => e.message === "Not enough free downtime days: this build takes 3 and Ann has 2 free.");
  const closed = await builderWorld({ downtime: 0 });
  await as(closed.gm, () => api().grantDays(closed.ann, 3));
  await assert.rejects(build(closed.annUser, closed.ann), e => e.message === "Downtime isn't open right now");
  assert.deepEqual(env.handlerThrows, []);
});

test("BUILD: the GM resolves it (NO roll): the escrow is converted once, days are spent, and a party-owned workshop appears at the party's CURRENT town, fixed there", async () => {
  const w = await builderWorld();
  const start0 = measure(w.ann);
  const action = await build(w.annUser, w.ann);
  const queued = measure(w.ann);
  w.ann.rolls.length = 0;
  const outcome = await api().queue.resolve(w.ann, action.id, { chat: true });
  assert.equal(outcome.status, "resolved");
  assert.equal(w.ann.rollArgs.length, 0, "no roll was made");
  const done = measure(w.ann);
  assert.equal(done.copper, queued.copper, "no second payment");
  assert.deepEqual(done.stash, queued.stash, "no second material charge");
  assert.equal(start0.totalDays - done.totalDays, 3, "3 days spent, once");
  assert.equal(done.reservedDays, 0);
  const [station] = env.values.partyStations;
  assert.match(station.id, /^party-camp-forge-[a-z0-9]+$/);
  assert.deepEqual({ ...station, id: "x", builtAt: 0 }, { id: "x", name: "Camp Forge", category: "smithing", tier: 1, town: "oakhaven", builtBy: w.ann.id, blueprintId: "camp-forge", builtAt: 0 });
  const row = api().stationsFor(w.ann).find(s => s.id === station.id);
  assert.deepEqual([row.source, row.tier, row.where, row.reachable], ["party", 1, "Oakhaven", true]);
  assert.ok(events().some(t => new RegExp(`^resolved build: Camp Forge built in Oakhaven for the party by Ann; 3x Iron, 1x Silver and a 25 gp fee and 3 day\\(s\\) spent; station ${station.id}$`).test(t)), events().join(" | "));
  assert.ok(env.chat.every(m => Array.isArray(m.whisper)), "only whispers");
  assert.equal(api().downtime.state().participants[w.ann.id].spent, 3);
  clean();
});

test("BUILD: if the party has moved on (or the design or blueprint is gone) when the GM resolves it, it is INVALID and everything is returned", async () => {
  const w = await builderWorld();
  const start0 = measure(w.ann);
  const action = await build(w.annUser, w.ann);
  env.values.partyLocation = "redhollow";
  const outcome = await api().queue.resolve(w.ann, action.id, { chat: false });
  assert.equal(outcome.status, "invalid");
  assert.equal(outcome.message, "The party is no longer in Oakhaven (it is in Redhollow). Your days, materials and gold were returned.");
  assert.deepEqual(measure(w.ann), start0, "gold, materials and days all back");
  assert.deepEqual(env.values.partyStations ?? [], []);
  env.values.partyLocation = "oakhaven";
  const second = await build(w.annUser, w.ann);
  await w.ann.update({ [`flags.${M}.blueprints`]: [] });
  assert.match((await api().queue.resolve(w.ann, second.id, { chat: false })).message, /^Ann no longer holds the design for Camp Forge\. Your days, materials and gold were returned\.$/);
  assert.deepEqual(measure(w.ann), start0);
  clean();
});

test("OWN WORKSHOP: usable by every party character, NO station fee, while other stations still charge; the location rule still applies", async () => {
  const w = await builderWorld();
  const action = await build(w.annUser, w.ann);
  await api().queue.resolve(w.ann, action.id, { chat: false });
  const partyId = env.values.partyStations[0].id;
  await api().grantFormula(w.bob, DAGGER);
  const stranger = makeActor("Stranger", { copper: 5000, owners: [] });
  Object.assign(stranger, { type: "character" });
  game.actors.push(stranger);
  await api().grantFormula(stranger, DAGGER);
  for (const actor of [w.ann, w.bob, stranger]) { await api().giveMaterial(actor, "iron", 3); await api().giveMaterial(actor, "spider-fang", 3); }

  // fees
  assert.equal(api().previewCraft(w.ann, DAGGER, SEL, partyId).plan.fee, 0, "the own workshop charges nothing");
  assert.equal(api().previewCraft(w.ann, DAGGER, SEL, FORGE).plan.fee, 5, "the town forge still charges its fee");
  const gold = measure(w.bob).copper;
  const free = await craft(w, w.bobUser, w.bob, { stationId: partyId });
  assert.equal(free.params.escrow.feeCopper, 0);
  assert.equal(measure(w.bob).copper, gold, "no fee left Bob's purse");
  await as(w.bobUser, () => api().queue.cancel(w.bob, free.id));
  const paid = await craft(w, w.bobUser, w.bob, { stationId: FORGE });
  assert.equal(paid.params.escrow.feeCopper, 500);
  await as(w.bobUser, () => api().queue.cancel(w.bob, paid.id));

  // who may use it: any party character, nobody else
  assert.equal(api().previewCraft(w.bob, DAGGER, SEL, partyId).ok, true);
  const refused = api().previewCraft(stranger, DAGGER, SEL, partyId);
  assert.equal(refused.ok, false);
  assert.match(refused.errors.join(" "), /you are not on its access list \(owner: party\)/);

  // the location rule
  env.values.partyLocation = "redhollow";
  const away = api().previewCraft(w.ann, DAGGER, SEL, partyId);
  assert.equal(away.ok, false);
  assert.match(away.errors.join(" "), /you are in Redhollow, but it is in Oakhaven/);
  env.values.partyLocation = "oakhaven";
  assert.equal(api().previewCraft(w.ann, DAGGER, SEL, partyId).ok, true);
  // "party" is ONE definition: a character owned by a user at Observer level only is not part of it
  assert.deepEqual(api().stationsFor(stranger).find(s => s.id === partyId).reachable, false);
  clean();
});

test("OWN WORKSHOP: it can be upgraded like any station: its craft days drop and its fee stays 0", async () => {
  const w = await builderWorld();
  await api().queue.resolve(w.ann, (await build(w.annUser, w.ann)).id, { chat: false });
  const partyId = env.values.partyStations[0].id;
  await api().giveMaterial(w.ann, "iron", 2);
  await api().giveMaterial(w.ann, "spider-fang", 2);
  await applyStationUpgrade(api(), partyId, { kind: "craftDays", from: 0, to: 1 });
  await applyStationUpgrade(api(), partyId, { kind: "tier", from: 1, to: 2 });
  assert.deepEqual([env.values.partyStations[0].tier, env.values.partyStations[0].upgrades], [2, { craftDays: 1 }]);
  assert.equal(api().previewCraft(w.ann, DAGGER, SEL, partyId).plan.fee, 0, "still free at tier 2");
  const action = await craft(w, w.annUser, w.ann, { stationId: partyId });
  assert.equal(action.daysReserved, 1, "the dagger takes 2 days; the workshop cuts 1");
  await assert.rejects(applyStationUpgrade(api(), partyId, { kind: "craftDays", from: 0, to: 1 }), /is at craftDays level 1 now, not 0/);
});

test("OWN WORKSHOP: two builds resolved at the same moment both land: neither station is lost from the party list", async () => {
  const w = await builderWorld({ iron: 8 });
  await api().giveMaterial(w.ann, "silver", 2);
  await as(w.gm, () => api().workshop.grantDesign(w.bob, "camp-forge"));
  await api().giveMaterial(w.bob, "iron", 4);
  await api().giveMaterial(w.bob, "silver", 1);
  const a = await build(w.annUser, w.ann);
  const b = await build(w.bobUser, w.bob);
  const results = await Promise.all([api().queue.resolve(w.ann, a.id, { chat: false }), api().queue.resolve(w.bob, b.id, { chat: false })]);
  assert.deepEqual(results.map(r => r.status), ["resolved", "resolved"]);
  assert.equal(env.values.partyStations.length, 2);
  assert.notEqual(env.values.partyStations[0].id, env.values.partyStations[1].id);
  assert.deepEqual(env.values.partyStations.map(s => s.builtBy).sort(), [w.ann.id, w.bob.id].sort());
});

test("BUILD: a GM queuing it during closed downtime is allowed and logged as an override; the days must still exist", async () => {
  const w = await builderWorld({ downtime: 0 });
  await as(w.gm, () => api().grantDays(w.ann, 3));
  const action = await as(w.gm, () => api().queue.submit(w.ann, "build", BUILD));
  assert.equal(action.type, "build");
  assert.ok(events().some(t => /^GM override: queued a build for Ann \(Downtime isn't open right now\)$/.test(t)), events().join(" | "));
});

// FAULT INJECTION: every escrow path of 10c ----------------------------------------------------------------------------------
test("FAULT INJECTION: a failure at ANY write while starting an upgrade leaves nothing taken and no project", async () => {
  const messages = [];
  await everyFailureLeavesNothingHalfDone("start upgrade", () => forgeWorld(), async w => { try { await start(w.annUser, w.ann, TIER3); } catch (e) { messages.push(e.message); throw e; } }, 3);
  assert.deepEqual([...new Set(messages)], [GENERIC_FAILURE], "an unexpected failure is only ever the generic line");
});

test("FAULT INJECTION: a failure at ANY write while putting a project aside leaves the escrow held and the project active", async () => {
  await everyFailureLeavesNothingHalfDone("put aside",
    async () => { const w = await forgeWorld(); w.project = await start(w.annUser, w.ann, TIER3); env.ops = 0; return w; },
    w => aside(w.annUser, w.ann, w.project.id), 3);
  await everyFailureLeavesNothingHalfDone("put aside, exact stack",
    async () => { const w = await world({ downtime: 0, iron: 0, fang: 0 }); await api().giveMaterial(w.ann, "starmetal", 4); w.project = await start(w.annUser, w.ann, TIER3); env.ops = 0; return w; },
    w => aside(w.annUser, w.ann, w.project.id), 3);
});

test("FAULT INJECTION: a failure at ANY write while finishing an upgrade leaves the station un-upgraded, the days unspent and the project as it was", async () => {
  await everyFailureLeavesNothingHalfDone("finish upgrade",
    async () => {
      const w = await forgeWorld({ downtime: 6 });
      const project = await start(w.annUser, w.ann, { stationId: FORGE, kind: "craftDays", materials: { iron: 2 } });
      w.item = await as(w.annUser, () => api().queue.submit(w.ann, "research", { projectId: project.id, skill: "crafting" }, 4));
      for (let i = 0; i < 4; i++) w.ann.rolls.push(crit());
      env.ops = 0;
      return w;
    },
    async w => { await api().queue.resolve(w.ann, w.item.id, { chat: false }); },
    4);
});

test("FAULT INJECTION: a failure at ANY write while queueing, cancelling or resolving a build leaves nothing half-done", async () => {
  const make = queued => async () => { const w = await builderWorld(); if (queued) w.action = await build(w.annUser, w.ann); env.ops = 0; return w; };
  await everyFailureLeavesNothingHalfDone("queue build", make(false), w => build(w.annUser, w.ann), 4);
  await everyFailureLeavesNothingHalfDone("cancel build", make(true), w => as(w.annUser, () => api().queue.cancel(w.ann, w.action.id)), 4);
  await everyFailureLeavesNothingHalfDone("resolve build", make(true), async w => { await api().queue.resolve(w.ann, w.action.id, { chat: false }); }, 3);
  await everyFailureLeavesNothingHalfDone("resolve an invalid build", async () => { const w = await make(true)(); env.values.partyLocation = "redhollow"; return w; },
    async w => { await api().queue.resolve(w.ann, w.action.id, { chat: false }); }, 3);
});

// RELAY ------------------------------------------------------------------------------------------------------------------------------
test("RELAY: the workshop handlers never throw, whatever they are given, and a bug in one reaches the player only as the generic line", async () => {
  const w = await forgeWorld();
  const payloads = [undefined, null, {}, { userId: "gm1" }, { userId: "u-ann", actorId: "nope" }, { userId: "u-ann", actorId: w.ann.id, mode: "nope" },
    { userId: "u-ann", actorId: w.ann.id, mode: "upgrade", params: null }, { userId: "u-bob", actorId: w.ann.id, mode: "upgrade", params: TIER3 }, { userId: "u-ann", actorId: w.ann.id, params: { projectId: 7 } }];
  await loudly(async () => {
    for (const name of ["workshopStart", "workshopAside"]) for (const payload of payloads) for (const user of [w.gm, w.annUser]) {
      const result = await as(user, () => env.handlers.get(name).call(undefined, payload));
      assert.ok(result === undefined || typeof result === "object", `${name} returned something odd`);
    }
  });
  assert.deepEqual(env.handlerThrows, []);
  const realGet = api().definitions.material.get.bind(api().definitions.material);
  api().definitions.material.get = () => { throw new TypeError("kaboom"); };
  try {
    const [error, logged] = await loudly(async seen => [await start(w.annUser, w.ann, TIER3).catch(e => e), seen]);
    assert.equal(error.message, GENERIC_FAILURE);
    assert.ok(logged.some(l => /"workshopStart" socket handler hit an unexpected error/.test(l)));
    const direct = await as(w.gm, () => api().workshop.startUpgrade(w.ann, TIER3)).catch(e => e);
    assert.match(direct.message, /kaboom/, "a GM calling directly still gets the original error");
  } finally { api().definitions.material.get = realGet; }
  assert.deepEqual(stashOf(w.ann), { iron: 4, starmetal: 6 }, "nothing was taken");
});

// LOCKS ------------------------------------------------------------------------------------------------------------------------------
test("LOCKS: upgrades finishing on two DIFFERENT public workshops at once both land (they share one world setting, so one lock covers its list)", async () => {
  await world({ downtime: 0 });
  await Promise.all([
    applyStationUpgrade(api(), FORGE, { kind: "craftDays", from: 0, to: 1 }),
    applyStationUpgrade(api(), "redhollow-forge", { kind: "craftDays", from: 0, to: 1 }),
    applyStationUpgrade(api(), "oakhaven-apothecary", { kind: "craftDays", from: 0, to: 1 })
  ]);
  const list = env.values.stationState;
  assert.deepEqual(list.map(e => [e.stationId, e.upgrades?.craftDays]).sort(), [["oakhaven-apothecary", 1], [FORGE, 1], ["redhollow-forge", 1]]);
});

test("LOCKS: an upgrade and a new party workshop landing at once do not drop each other", async () => {
  const w = await builderWorld();
  await api().queue.resolve(w.ann, (await build(w.annUser, w.ann)).id, { chat: false });
  const first = env.values.partyStations[0].id;
  await api().giveMaterial(w.bob, "iron", 4);
  await api().giveMaterial(w.bob, "silver", 1);
  await as(w.gm, () => api().workshop.grantDesign(w.bob, "camp-forge"));
  const second = await build(w.bobUser, w.bob);
  await Promise.all([applyStationUpgrade(api(), first, { kind: "craftDays", from: 0, to: 1 }), api().queue.resolve(w.bob, second.id, { chat: false })]);
  assert.equal(env.values.partyStations.length, 2);
  assert.equal(env.values.partyStations.find(s => s.id === first).upgrades.craftDays, 1);
});
