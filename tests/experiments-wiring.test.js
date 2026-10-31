/**
 * Experiments (docs/11b, B) through the real main.js in the fake Foundry with per-client definitions: a player starts with nothing,
 * gets the recipe and the materials over the socket, and previews/crafts/shares like a real player would.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DAGGER, M, SEL, addNode, as, craft, env, events, fireHookAs, getApi, loudly, makeActor, measure, resolve, snapshot, world } from "./fake-world.js";
import { EXPERIMENTS } from "../scripts/config.js";
import { HIDDEN_FIELDS } from "../scripts/difficulty.js";

const api = () => getApi();
const SEL2 = { blade: "silver", fang: "spider-fang" };
const book = actor => actor.getFlag(M, "compendium");
const exp = (actor, recipe = DAGGER) => book(actor)?.experiments?.[recipe];
// Stage 11c: a successful craft teaches the material's behaviour in the recipe's ITEM CLASS (the dagger is a "weapon"), not just this recipe.
const taught = (actor, category = "weapon") => Object.keys(book(actor)?.classes?.[category] ?? {}).sort();
const classFact = (actor, materialId, category = "weapon") => book(actor)?.classes?.[category]?.[materialId];
const refresh = user => as(user, () => api().definitions.refresh());
const preview = (user, actor, selection, recipe = DAGGER, station = "oakhaven-forge") => as(user, () => api().previewCraft(actor, recipe, selection, station));
const worldWith = async (options = {}) => {
  const w = await world({ perClientDefinitions: true, downtime: 6, iron: 3, fang: 3, ...options });
  await api().giveMaterial(w.ann, "silver", 3);
  await refresh(w.annUser);
  return w;
};
const keysDeep = value => (Array.isArray(value) ? value.flatMap(keysDeep) : value && typeof value === "object" ? Object.entries(value).flatMap(([k, v]) => [k, ...(k === "effects" || k === "roles" ? [] : keysDeep(v))]) : []);

test("PREVIEW without experience: the facts are all there, every effect is the clear field 'unknown', and no difficulty or result leaks", async () => {
  const w = await worldWith();
  const result = preview(w.annUser, w.ann, SEL2);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const { plan } = result;
  assert.deepEqual([plan.recipeName, plan.fee, plan.days, plan.station.name], ["Spider Fang Dagger", 5, 2, "Oakhaven Forge"]);
  assert.deepEqual(plan.slots.map(s => [s.slot, s.materialId, s.materialName, s.tier, s.units, s.effect]), [["blade", "silver", "Silver", 2, 1, { known: false }], ["fang", "spider-fang", "Spider Fang", 2, 1, { known: false }]]);
  assert.deepEqual(plan.result, { known: false });
  assert.equal(plan.effectsKnown, 0);
  assert.deepEqual(plan.uses.map(u => [u.slot, u.materialId, u.units]), [["blade", "silver", 1], ["fang", "spider-fang", 1]]);
  assert.doesNotMatch(JSON.stringify(result), /\?\?\?|description|outputUuid|resultName|baseTier|craftLevel|LossChance/);
  assert.deepEqual(keysDeep(result).filter(k => HIDDEN_FIELDS.includes(k)), []);
});

test("PREVIEW: mechanical facts still say what is wrong, with the player's plain words", async () => {
  const w = await worldWith();
  assert.match(preview(w.annUser, w.ann, { blade: "iron", fang: "iron" }).errors.join(" "), /slot "fang": Iron is tier 1 but the slot needs tier 2 or higher/);
  assert.match(preview(w.annUser, w.ann, { blade: "silver" }).errors.join(" "), /slot "fang": no material selected/);
  assert.match(preview(w.annUser, w.ann, { blade: "starmetal", fang: "spider-fang" }).errors.join(" "), /slot "blade": you do not have "starmetal"/);
  assert.match(preview(w.annUser, w.ann, { blade: "silver", fang: "spider-fang", extra: "iron" }).errors.join(" "), /"extra" is not a slot/);
});

test("BASELINE: owning a formula reveals what the cheapest valid materials make; nothing stronger", async () => {
  const w = await worldWith();
  await api().grantFormula(w.ann, DAGGER);
  const baseline = exp(w.ann).baseline;
  assert.deepEqual(baseline.slots.map(s => [s.slot, s.materialId]), [["blade", "iron"], ["fang", "spider-fang"]]);
  const cheap = preview(w.annUser, w.ann, { blade: "iron", fang: "spider-fang" }).plan;
  assert.deepEqual(cheap.slots.map(s => [s.effect.known, s.effect.via]), [[true, "baseline"], [true, "baseline"]]);
  assert.deepEqual(cheap.result, { known: true, baseTier: 1 });
  const stronger = preview(w.annUser, w.ann, SEL2).plan;
  assert.deepEqual(stronger.slots.map(s => s.effect.known), [false, true], "silver is not the baseline material; the fang is");
  assert.deepEqual(stronger.result, { known: false });
});

test("BASELINE: a character who has never met a valid material sees the result and the tier needed, but no material name", async () => {
  const w = await worldWith();
  await api().grantFormula(w.bob, DAGGER);
  await refresh(w.bobUser);
  const view = as(w.bobUser, () => api().compendium.view(w.bob));
  assert.deepEqual(view.entries.experiments.map(e => [e.recipeId, e.source, e.known.length]), [[DAGGER, "own", 0]]);
  assert.deepEqual(view.entries.experiments[0].baseline.slots.map(s => [s.slot, s.needs, s.material]), [["blade", "tier 1 or higher", null], ["fang", "tier 2 or higher", null]]);
  assert.equal(view.entries.experiments[0].baseline.baseTier, 1);
  assert.doesNotMatch(JSON.stringify(view.entries.experiments), /Iron|\?\?\?|unknown|locked/);
});

test("BASELINE: finishing the RESEARCH reveals it, with no material ever handed over", async () => {
  const w = await worldWith();
  await api().grantDays(w.bob, 30);
  const project = await api().startProject({ actor: w.bob, recipe: "longsword-basic" });
  assert.equal(exp(w.bob, "longsword-basic"), undefined);
  const out = await api().research({ actor: w.bob, project: project.id ?? "unlock-longsword-basic", days: 20, skill: "crafting", degree: "criticalSuccess", chat: false });
  assert.equal(out.completed, true);
  assert.deepEqual(exp(w.bob, "longsword-basic").baseline.slots.map(s => [s.slot, s.materialId]), [["blade", "iron"], ["coating", "silver"], ["core", "starmetal"]]);
  assert.equal(exp(w.bob, "longsword-basic").baseline.baseTier, 1);
});

test("A SUCCESSFUL craft teaches each slot's material; the preview knows it at once, with no reload", async () => {
  const w = await worldWith();
  const action = await craft(w, w.annUser, w.ann, { selection: SEL2 });
  await resolve(w.ann, action.id, { degree: "success" });
  assert.deepEqual(taught(w.ann), ["silver", "spider-fang"]);
  assert.deepEqual(classFact(w.ann, "silver").effects, { basePower: "T2" });
  assert.equal(classFact(w.ann, "spider-fang").effects.bonusDamage.dice, "1d4");
  assert.ok(exp(w.ann), "the recipe is listed (and can be shared) even though what was learned belongs to the class");
  const now = preview(w.annUser, w.ann, SEL2).plan;
  assert.deepEqual(now.slots.map(s => [s.effect.known, s.effect.via]), [[true, "class"], [true, "class"]], "learned as the weapon class's behaviour");
  assert.deepEqual(now.result, { known: true, baseTier: 2 });
  assert.equal(now.effectsKnown, 2);
  assert.ok(events().some(t => /^resolved craft: Spider Fang Dagger for Ann/.test(t)));
});

test("ONLY A SUCCESS TEACHES: a failure (and a critical failure, even when materials are lost) teaches nothing; a critical success teaches the same", async () => {
  for (const degree of ["failure", "criticalFailure"]) {
    const w = await worldWith();
    const action = await craft(w, w.annUser, w.ann, { selection: SEL2 });
    const before = JSON.stringify(book(w.ann));
    await resolve(w.ann, action.id, { degree });
    assert.equal(JSON.stringify(book(w.ann)?.experiments ?? null), JSON.stringify(JSON.parse(before)?.experiments ?? null), `${degree}: no experiment recorded`);
    assert.equal(exp(w.ann), undefined, degree);
    assert.deepEqual(preview(w.annUser, w.ann, SEL2).plan.slots.map(s => s.effect.known), [false, false], degree);
  }
  const learned = {};
  for (const degree of ["success", "criticalSuccess"]) {
    const w = await worldWith();
    await resolve(w.ann, (await craft(w, w.annUser, w.ann, { selection: SEL2 })).id, { degree });
    learned[degree] = JSON.stringify(Object.entries(book(w.ann).classes.weapon).map(([id, f]) => [id, f.effects]));
  }
  assert.equal(learned.criticalSuccess, learned.success, "a critical success teaches exactly what a success does");
});

test("PER MATERIAL, NOT PER COMBINATION: learned in one pairing, known in another; a different recipe or slot is not", async () => {
  const w = await worldWith();
  await api().giveMaterial(w.ann, "starmetal", 2);
  await refresh(w.annUser);
  await resolve(w.ann, (await craft(w, w.annUser, w.ann, { selection: SEL2 })).id, { degree: "success" });
  const other = preview(w.annUser, w.ann, { blade: "silver", fang: "starmetal" }).plan;
  assert.deepEqual(other.slots.map(s => [s.materialId, s.effect.known]), [["silver", true], ["starmetal", false]], "silver in the blade slot is known whatever sits in the fang slot");
  assert.deepEqual(other.result, { known: true, baseTier: 2 }, "the base slot is known, so the result tier is");
  assert.deepEqual(as(w.annUser, () => api().compendium.knownEffect(w.ann, api().definitions.recipe.get(DAGGER), "fang", "silver")), { known: false }, "the same material in another slot");
  const longsword = api().definitions.recipe.get("longsword-basic");
  assert.equal(as(w.annUser, () => api().compendium.knownEffect(w.ann, longsword, "blade", "silver")).known, true, "the same item class (weapon): another recipe's blade slot is known too");
  assert.equal(as(w.annUser, () => api().compendium.knownEffect(w.ann, longsword, "coating", "silver")).known, false, "but not where that recipe gives silver its own effect (an override is learned in that recipe)");
  assert.equal(as(w.annUser, () => api().compendium.knownEffect(w.ann, api().definitions.recipe.get(DAGGER), "blade", "silver")).known, true);
});

test("IDEMPOTENT: crafting the same thing again changes nothing in the Compendium", async () => {
  const w = await worldWith();
  await resolve(w.ann, (await craft(w, w.annUser, w.ann, { selection: SEL2 })).id, { degree: "success" });
  const first = JSON.stringify(exp(w.ann));
  await resolve(w.ann, (await craft(w, w.annUser, w.ann, { selection: SEL2 })).id, { degree: "success" });
  assert.equal(JSON.stringify(exp(w.ann)), first);
});

test("the GM's own direct craft teaches the crafter too (success only)", async () => {
  const failed = await worldWith();
  await api().craft({ actor: failed.ann, recipeId: DAGGER, selection: SEL2, station: "oakhaven-forge", degree: "failure" });
  assert.equal(exp(failed.ann), undefined);
  const w = await worldWith();
  await api().craft({ actor: w.ann, recipeId: DAGGER, selection: SEL2, station: "oakhaven-forge", degree: "success" });
  assert.deepEqual(taught(w.ann), ["silver", "spider-fang"]);
});

test("a Compendium write that fails never fails or undoes the craft it follows", async () => {
  const w = await worldWith();
  const action = await craft(w, w.annUser, w.ann, { selection: SEL2 });
  const realUpdate = w.ann.update.bind(w.ann);
  w.ann.update = async data => { if (JSON.stringify(Object.keys(data)).includes("compendium")) throw new Error("the Compendium is down"); return realUpdate(data); };
  const [out, logged] = await loudly(async seen => [await resolve(w.ann, action.id, { degree: "success" }), seen]);
  assert.equal(out.status, "resolved");
  assert.ok(logged.some(l => /could not record in the Compendium \(experiments\)/.test(l)));
  assert.equal(measure(w.ann).items.length, 1, "the item was made");
});

test("SHARE: an experiment share is a 0-day queue item; approving it merges the recipe's facts into the party's book and a party member's preview knows them", async () => {
  const w = await worldWith();
  await api().grantFormula(w.bob, DAGGER);
  await api().giveMaterial(w.bob, "silver", 1);
  await api().giveMaterial(w.bob, "spider-fang", 1);
  await refresh(w.bobUser);
  await resolve(w.ann, (await craft(w, w.annUser, w.ann, { selection: SEL2 })).id, { degree: "success" });
  assert.deepEqual(preview(w.bobUser, w.bob, SEL2).plan.slots.map(s => s.effect.known), [false, true], "private until approved (only the baseline fang is known to Bob)");
  const before = measure(w.ann);
  const action = await as(w.annUser, () => api().queue.submit(w.ann, "share", { kind: "experiment", key: DAGGER }));
  assert.deepEqual([action.type, action.daysReserved, action.params.name], ["share", 0, "Spider Fang Dagger"]);
  assert.deepEqual(measure(w.ann).freeDays, before.freeDays);
  const [row] = api().queue.list().filter(r => r.action.type === "share");
  assert.equal(row.label, "Share: Spider Fang Dagger (experiment)");
  assert.match(row.detail, /^2 material effect\(s\) learned.*no days, no downtime needed/);
  assert.deepEqual(env.values.sharedCompendium?.experiments ?? {}, {}, "nothing shared while it waits");
  const batch = await api().queue.resolveAll({ chat: false });
  assert.match(batch.results[0].message, /approved: Spider Fang Dagger \(experiment\) is now shared with the party/);
  assert.deepEqual(Object.keys(env.values.sharedCompendium.classes.weapon).sort(), ["silver", "spider-fang"], "the item class's facts travel with the recipe's share");
  assert.deepEqual(preview(w.bobUser, w.bob, SEL2).plan.slots.map(s => [s.effect.known, s.effect.via]), [[true, "shared"], [true, "shared"]]);
  const view = as(w.bobUser, () => api().compendium.view(w.bob)).entries.experiments.find(e => e.recipeId === DAGGER);
  assert.equal(view.source, "both", "Bob has his own baseline for it and the party's facts");
  assert.deepEqual(view.known.map(k => [k.slot, k.material, k.source]).sort(), [["blade", "Silver", "shared"], ["fang", "Spider Fang", "shared"]]);
});

test("SHARE: re-sharing what is already shared is refused plainly; a rejection leaves it private; the shared knowledge is read-only for the party and does not reach a non-party character", async () => {
  const w = await worldWith();
  await resolve(w.ann, (await craft(w, w.annUser, w.ann, { selection: SEL2 })).id, { degree: "success" });
  const first = await as(w.annUser, () => api().queue.submit(w.ann, "share", { kind: "experiment", key: DAGGER }));
  await api().queue.reject(w.ann, first.id, { chat: false });
  assert.deepEqual(env.values.sharedCompendium?.experiments ?? {}, {}, "rejected: still private");
  const again = await as(w.annUser, () => api().queue.submit(w.ann, "share", { kind: "experiment", key: DAGGER }));
  await api().queue.resolveAll({ chat: false });
  await assert.rejects(as(w.annUser, () => api().queue.submit(w.ann, "share", { kind: "experiment", key: DAGGER })), /Everything Ann knows about Spider Fang Dagger is already shared with the party\./);
  await assert.rejects(as(w.annUser, () => api().queue.submit(w.ann, "share", { kind: "experiment", key: "longsword-basic" })), /Ann has not discovered that yet, so there is nothing to share\./);
  void again;
  const stranger = makeActor("Stranger", { owners: [] });
  game.actors.push(stranger);
  await api().grantFormula(stranger, DAGGER);
  assert.deepEqual(as(w.gm, () => api().compendium.view(stranger)).entries.experiments.map(e => e.known.length), [0], "not in the party: the shared facts do not reach them");
});

test("VIEW: the GM sees every character's experiments; a player sees only their own and the party's, and only what was experienced", async () => {
  const w = await worldWith();
  await resolve(w.ann, (await craft(w, w.annUser, w.ann, { selection: SEL2 })).id, { degree: "success" });
  const gm = as(w.gm, () => api().compendium.all());
  assert.deepEqual(gm.characters.find(c => c.name === "Ann").experiments.map(e => [e.recipeId, e.known.length]), [[DAGGER, 2]], "two materials learned for the weapon class apply to the dagger's two slots");
  const bobView = as(w.bobUser, () => api().compendium.view(w.bob));
  assert.deepEqual(bobView.entries.experiments, [], "Bob knows nothing, and nothing of Ann's is shown");
  await assert.rejects(Promise.resolve().then(() => as(w.bobUser, () => api().compendium.view(w.ann))), /You can only read the Compendium of a character you own\./);
  const own = as(w.annUser, () => api().compendium.view(w.ann));
  assert.doesNotMatch(JSON.stringify(own.entries.experiments), /\?\?\?|locked|unknown/);
  assert.deepEqual(own.own.experiments.map(e => e.recipeId), [DAGGER]);
  assert.deepEqual(own.shared.experiments, []);
});

test("the GM's own preview keeps the FULL plan (result, effects, loss chances, craft level)", async () => {
  const w = await worldWith();
  const full = as(w.gm, () => api().previewCraft(w.ann, DAGGER, SEL, "oakhaven-forge"));
  assert.equal(full.ok, true);
  assert.ok(full.plan.description && full.plan.craftLevel === 2 && full.plan.outputUuid && "slotLossChance" in full.plan.uses[0]);
});

test("LOAN: crafting from a loaned formula teaches the CRAFTER, not the owner (unless the tunable says so)", async () => {
  for (const ownerLearns of [false, true]) {
    const w = await worldWith();
    await api().giveMaterial(w.bob, "silver", 1);
    await api().giveMaterial(w.bob, "spider-fang", 1);
    const saved = EXPERIMENTS.ownerLearnsFromLoan;
    EXPERIMENTS.ownerLearnsFromLoan = ownerLearns;
    try {
      const id = await loanedCommission(w);
      await api().commissions.craft(id, { selection: SEL2, station: "oakhaven-forge", degree: "success", chat: false });
      assert.deepEqual(taught(w.bob), ["silver", "spider-fang"], "the crafter learns");
      assert.equal(taught(w.ann).length > 0, ownerLearns, ownerLearns ? "the owner learns too when the tunable is on" : "the owner learns nothing");
    } finally { EXPERIMENTS.ownerLearnsFromLoan = saved; }
  }
});

async function loanedCommission(w) {
  // Ann (owner of the formula) asks Bob to craft it for her on loan; Bob accepts; the GM crafts it for them.
  const request = await as(w.annUser, () => api().queue.submit(w.ann, "commission", { step: "request", crafter: w.bob.id, recipe: DAGGER, access: "loan", payout: 1, selection: SEL2, stationId: "oakhaven-forge" }, 0));
  await api().queue.resolve(w.ann, request.id, { chat: false });
  const id = api().commissions.list()[0].id;
  const accept = await as(w.bobUser, () => api().queue.submit(w.bob, "commission", { step: "accept", id }, 0));
  await api().queue.resolve(w.bob, accept.id, { chat: false });
  return id;
}

test("FOR THE RECORD: the experiments recorder and the snapshot helper never touch the world outside the Compendium flag", async () => {
  const w = await worldWith();
  const before = snapshot(w);
  await api().compendium.revealBaselines(w.ann);
  const after = JSON.parse(snapshot(w)), was = JSON.parse(before);
  const strip = s => ({ ...s, actors: s.actors.map(a => ({ ...a, flags: { ...a.flags, compendium: undefined } })) });
  assert.deepEqual(strip(after), strip(was));
  void fireHookAs; void addNode;
});
