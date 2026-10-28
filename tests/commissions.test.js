import test from "node:test";
import assert from "node:assert/strict";
import { loadDefinitions } from "../scripts/data/validate.js";
import { buildCommission, checkStep, commissionWarnings, consistencyErrors, gpText, isMoney, rolesFor, suggestPayout, toCopper, validateCommission } from "../scripts/commissions/commission.js";
import { affordabilityErrors, applySteps, buildSteps, missingMaterials } from "../scripts/commissions/escrow.js";
import { addLoan, dropLoan, hasLoanFor } from "../scripts/commissions/loans.js";
import { ledgerChanges } from "../scripts/commissions/changes.js";
import { compareLoans } from "../scripts/audit/audit.js";
import { formulaRequirement } from "../scripts/research/formulas.js";
import { resolveOutcome } from "../scripts/crafting/outcome.js";
import { HANDLERS } from "../scripts/queue/handlers.js";
import { DEGREES } from "../scripts/adapter/pf2e.js";
import { asPage, clone, seedRecords } from "./helpers.js";

const registry = loadDefinitions(seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }))).registry;
const dagger = registry.recipe.get("dagger-spider-fang");
const SLOTS = dagger.slots.map(s => s.name);
const SEL = { blade: "iron", fang: "spider-fang" };

function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const player = (extra = {}) => ({ source: "player", patron: { type: "actor", actorId: "pat" }, crafter: "cra", recipeId: "dagger-spider-fang", selection: SEL, payout: 12, ...extra });
const build = (spec, slotNames = SLOTS) => buildCommission(spec, { id: "c1", now: 5, slotNames });

// Money ---------------------------------------------------------------------------------------------------------
test("money is whole copper pieces: 0.01 steps are fine, 0.001 and negatives are not", () => {
  for (const ok of [0, 1, 2.5, 12.34, 0.07, 100]) assert.equal(isMoney(ok), true, String(ok));
  for (const bad of [-1, 0.001, 1.005, NaN, Infinity, "5", null]) assert.equal(isMoney(bad), false, String(bad));
  assert.equal(toCopper(12.34), 1234);
  assert.equal(toCopper(0.07), 7);
  assert.equal(gpText(1250), "12.5 gp");
  assert.equal(gpText(500), "5 gp");
});

// Building ---------------------------------------------------------------------------------------------------------
test("a player commission: the patron supplies the materials, teaching is off, the learn roll defaults off", () => {
  const { ok, commission } = build(player());
  assert.ok(ok);
  assert.deepEqual([commission.materialsFrom, commission.access, commission.status, commission.learnRoll, commission.teaches, commission.attempts], ["patron", "loan", "requested", false, { type: "none" }, 0]);
  assert.deepEqual(validateCommission(commission), []);
  assert.equal(build(player({ learnRoll: true })).commission.learnRoll, true);
});

test("a GM commission for an NPC: the crafter supplies the materials by default and the learn roll defaults on (loans)", () => {
  const spec = { source: "gm", patron: { type: "lightweight", name: "Old Brannock" }, crafter: "cra", recipeId: "dagger-spider-fang", payout: 30 };
  const { ok, commission } = build(spec);
  assert.ok(ok);
  assert.deepEqual([commission.materialsFrom, commission.learnRoll, commission.selection], ["crafter", true, undefined]);
  assert.equal(build({ ...spec, access: "copy" }).commission.learnRoll, false, "a copy has nothing to learn");
  assert.equal(build({ ...spec, materialsFrom: "npc" }).ok, false, 'materialsFrom "npc" needs a selection');
  assert.equal(build({ ...spec, materialsFrom: "npc", selection: SEL }).ok, true);
  assert.equal(build({ ...spec, teaches: { type: "progress", amount: 2 } }).ok, true);
});

test("building refuses inconsistent requests, each with a clear message", () => {
  const msg = (spec, slots) => build(spec, slots).errors?.join(" | ") ?? "ok";
  assert.match(msg(player({ crafter: "pat" })), /patron and the crafter must be different/);
  assert.match(msg(player({ payout: 1.005 })), /gold amount in whole copper pieces/);
  assert.match(msg(player({ payout: -3 })), /payout/);
  assert.match(msg(player({ selection: undefined })), /needs a selection/);
  assert.match(msg(player({ selection: { blade: "iron" } })), /slot "fang" has no material/);
  assert.match(msg(player({ selection: { ...SEL, hilt: "iron" } })), /"hilt" is not a slot of this recipe/);
  assert.match(msg(player({ access: "copy", learnRoll: true })), /learn roll only applies to a loan/);
  assert.match(msg(player({ teaches: { type: "fullCopy" } })), /only GM-issued commissions can teach/);
  assert.match(msg(player({ patron: { type: "lightweight", name: "x" } })), /player commission needs a character/);
  assert.match(msg({ ...player(), source: "gm", patron: { type: "lightweight", name: "x" }, materialsFrom: "patron" }), /cannot supply materials/);
  assert.match(msg({ ...player(), source: "gm", materialsFrom: "npc" }), /character patron supplies the materials/);
  assert.match(msg(player({ access: "gift" })), /access/);
});

test("warnings: a crafter who already owns the formula makes the handoff, learn roll and teaches pointless", () => {
  const c = build({ source: "gm", patron: { type: "lightweight", name: "x" }, crafter: "cra", recipeId: "dagger-spider-fang", payout: 1, teaches: { type: "fullCopy" } }).commission;
  assert.deepEqual(commissionWarnings(c, null), []);
  assert.equal(commissionWarnings(c, "owned").length, 3);
});

test("suggestPayout = (material value + fee) + margin, rounded up; materials can set their own value", () => {
  const s = suggestPayout({ recipe: dagger, selection: SEL, registry, feeGp: 5 });
  // iron T1 = 5, spider-fang T2 = 25 -> 30 + 5 fee = 35 -> x1.25 = 43.75 -> 44
  assert.deepEqual([s.ok, s.materialValue, s.payout], [true, 30, 44]);
  const priced = { ...registry, material: new Map(registry.material) };
  priced.material.set("iron", { ...registry.material.get("iron"), value: 1 });
  assert.equal(suggestPayout({ recipe: dagger, selection: SEL, registry: priced, feeGp: 0 }).materialValue, 26);
  assert.match(suggestPayout({ recipe: dagger, selection: { blade: "iron" }, registry, feeGp: 0 }).error, /slot "fang"/);
});

// Who may do what ----------------------------------------------------------------------------------------------------
const commissionAt = (status, extra = {}) => ({ ...build(player()).commission, status, ...extra });

test("roles: patron, crafter and GM; a stranger has none", () => {
  const c = commissionAt("requested");
  assert.deepEqual(rolesFor(c, "pat", false), ["patron"]);
  assert.deepEqual(rolesFor(c, "cra", false), ["crafter"]);
  assert.deepEqual(rolesFor(c, "zed", true), ["gm"]);
  assert.deepEqual(rolesFor(c, "zed", false), []);
  assert.deepEqual(rolesFor({ ...c, patron: { type: "lightweight", name: "x" } }, "pat", false), []);
});

test("the transition table: every step, status and role", () => {
  const ok = (status, step, actor, gm = false) => checkStep(commissionAt(status), step, actor, gm).ok;
  // accept / decline: crafter or GM, requested only
  for (const step of ["accept", "decline"]) {
    assert.equal(ok("requested", step, "cra"), true);
    assert.equal(ok("requested", step, "zed", true), true);
    assert.equal(ok("requested", step, "pat"), false, "the patron cannot accept for the crafter");
    for (const status of ["accepted", "inProgress", "delivered", "cancelled", "declined"]) assert.equal(ok(status, step, "cra"), false, `${step} from ${status}`);
  }
  // cancel: patron or GM, until delivered
  for (const status of ["requested", "accepted", "inProgress"]) {
    assert.equal(ok(status, "cancel", "pat"), true, status);
    assert.equal(ok(status, "cancel", "zed", true), true);
    assert.equal(ok(status, "cancel", "cra"), false, "the crafter cannot cancel");
  }
  for (const status of ["delivered", "cancelled", "declined"]) assert.equal(ok(status, "cancel", "pat"), false, `cancel from ${status}`);
  // craft: crafter or GM, accepted or in progress
  for (const status of ["accepted", "inProgress"]) { assert.equal(ok(status, "craft", "cra"), true); assert.equal(ok(status, "craft", "pat"), false); }
  for (const status of ["requested", "delivered", "cancelled", "declined"]) assert.equal(ok(status, "craft", "cra"), false, `craft from ${status}`);
  assert.match(checkStep(commissionAt("delivered"), "cancel", "pat", false).errors[0], /is delivered, so it cannot be cancelled/);
  assert.match(checkStep(commissionAt("requested"), "accept", "pat", false).errors[0], /only the crafter \(or the GM\) can accept/);
  assert.match(checkStep(commissionAt("requested"), "dance", "pat", false).errors[0], /unknown commission step/);
});

// Loans -----------------------------------------------------------------------------------------------------------------
test("a commission loan is added once, shared by several commissions, and removed when the last one ends", () => {
  let list = [];
  let r = addLoan(list, dagger, "c1");
  assert.equal(r.change, "added");
  assert.deepEqual(r.list[0].commissions, ["c1"]);
  assert.deepEqual([r.list[0].access, r.list[0].source], ["loan", "commission"]);
  r = addLoan(r.list, dagger, "c2");
  assert.deepEqual([r.change, r.list[0].commissions], ["joined", ["c1", "c2"]]);
  assert.equal(addLoan(r.list, dagger, "c2").list[0].commissions.length, 2, "no duplicates");
  assert.equal(r.list.length, 1);
  assert.equal(hasLoanFor(r.list, "c2"), true);
  let d = dropLoan(r.list, "c1");
  assert.deepEqual([d.dropped, d.entryRemoved, d.list[0].commissions], [true, false, ["c2"]]);
  d = dropLoan(d.list, "c2");
  assert.deepEqual([d.dropped, d.entryRemoved, d.list], [true, true, []]);
  assert.deepEqual(dropLoan(d.list, "c2"), { list: [], dropped: false, entryRemoved: false });
});

test("loans never downgrade an owned formula and never touch a GM-granted loan", () => {
  const owned = [{ recipeId: dagger.id, access: "owned", source: "research" }];
  assert.deepEqual(addLoan(owned, dagger, "c1"), { list: owned, change: "owned" });
  assert.deepEqual(dropLoan(owned, "c1").list, owned);
  const gm = [{ recipeId: dagger.id, access: "loan", source: "gm" }];
  assert.deepEqual(addLoan(gm, dagger, "c1"), { list: gm, change: "gmLoan" });
  assert.deepEqual(dropLoan(gm, "c1").list, gm);
});

test("formulaRequirement: a commission loan only works through its commission; owned and GM loans work as before", () => {
  const loan = addLoan([], dagger, "c1").list;
  assert.match(formulaRequirement(loan, dagger, "Borin").error, /on loan for a commission, so it can only be crafted through that commission/);
  assert.match(formulaRequirement(loan, dagger, "Borin", { commissionId: "c9" }).error, /not for commission "c9"/);
  assert.deepEqual(formulaRequirement(loan, dagger, "Borin", { commissionId: "c1" }), { ok: true, access: "loan" });
  assert.equal(formulaRequirement([{ recipeId: dagger.id, access: "owned", source: "x" }], dagger, "B").ok, true);
  assert.equal(formulaRequirement([{ recipeId: dagger.id, access: "loan", source: "gm" }], dagger, "B").ok, true);
  assert.equal(formulaRequirement([], dagger, "B").ok, false);
});

test("ledgerChanges: what a flow did to formulas and projects, derived rather than listed", () => {
  const proj = (progress, status = "active") => ({ id: "unlock-x", tier: 1, dc: 12, threshold: 8, progress, status });
  const changes = ledgerChanges({
    formulasBefore: [{ recipeId: "a", access: "loan" }, { recipeId: "gone", access: "owned" }],
    formulasAfter: [{ recipeId: "a", access: "owned" }, { recipeId: "new", access: "loan" }],
    projectsBefore: [proj(1)], projectsAfter: [proj(2)], note: "n"
  });
  assert.deepEqual(changes.filter(c => c.type === "formulaAdd").map(c => `${c.recipeId}:${c.access}`).sort(), ["a:owned", "new:loan"]);
  assert.deepEqual(changes.filter(c => c.type === "formulaRemove").map(c => c.recipeId), ["gone"]);
  assert.equal(changes.filter(c => c.type === "projectSet").length, 1);
  assert.deepEqual(ledgerChanges({ formulasBefore: [], formulasAfter: [], projectsBefore: [proj(1)], projectsAfter: [proj(1)] }), [], "no change, no entries");
});

// Affordability ------------------------------------------------------------------------------------------------------------
test("affordability names which part the patron cannot cover", () => {
  const e = a => affordabilityErrors({ patronName: "Aelwyn", ...a });
  assert.deepEqual(e({ patronCopper: 2000, feeCopper: 500, payoutCopper: 1200 }), []);
  assert.deepEqual(e({ patronCopper: 1700, feeCopper: 500, payoutCopper: 1200 }), []);
  assert.deepEqual(e({ patronCopper: 300, feeCopper: 500, payoutCopper: 1200 }), ["Aelwyn cannot cover the 5 gp fee (has 3 gp)"]);
  assert.deepEqual(e({ patronCopper: 1000, feeCopper: 500, payoutCopper: 1200 }), ["Aelwyn cannot cover the 5 gp fee plus the 12 gp payout (needs 17 gp, has 10 gp)"]);
  assert.deepEqual(e({ patronCopper: 0, feeCopper: 0, payoutCopper: 0 }), []);
});

test("missing materials are listed with what is held", () => {
  const uses = [{ materialId: "iron", units: 3 }, { materialId: "fang", units: 1 }];
  assert.deepEqual(missingMaterials({ uses, stacks: [{ materialId: "iron", quantity: 1 }, { materialId: "iron", quantity: 1 }, { materialId: "fang", quantity: 1 }] }), ["3x iron (has 2)"]);
  assert.deepEqual(missingMaterials({ uses, stacks: [] }), ["3x iron (has 0)", "1x fang (has 0)"]);
  assert.deepEqual(missingMaterials({ uses, stacks: [{ materialId: "iron", quantity: 3 }, { materialId: "fang", quantity: 2 }] }), []);
});

// Property tests: gold and materials are conserved --------------------------------------------------------------------------
function randomScenario(rng) {
  const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const slots = int(1, 3);
  const uses = [];
  const stackQty = {};
  for (let i = 0; i < slots; i++) {
    const units = int(1, 4);
    const stackIds = Array.from({ length: int(1, 2) }, (_, k) => `s${i}${k}`);
    const from = [];
    let left = units;
    for (const stackId of stackIds) {
      const have = int(left, left + 3);
      stackQty[stackId] = have;
      from.push({ stackId, units: have });
    }
    uses.push({ slot: `slot${i}`, materialId: `m${i}`, units, from });
  }
  const feeCp = int(0, 4) * 100;
  const payoutCp = int(0, 5000);
  const patronIsActor = rng() < 0.7;
  const supplierKind = patronIsActor ? "patron" : ["crafter", "npc"][int(0, 1)];
  const degree = DEGREES[int(0, 3)];
  const rolls = Array.from({ length: 40 }, () => int(1, 100));
  let k = 0;
  return { uses, stackQty, feeCp, payoutCp, patronIsActor, supplierKind, degree, rng: () => rolls[k++ % rolls.length], patronGold: feeCp + payoutCp + int(0, 3000), crafterGold: int(0, 2000) };
}

test("PROPERTY: over 600 random crafts, gold and materials are conserved and nothing goes negative", () => {
  const rng = seeded(8008);
  for (let i = 0; i < 600; i++) {
    const s = randomScenario(rng);
    const plan = { uses: s.uses, fee: s.feeCp / 100 };
    const outcome = resolveOutcome({ plan, degree: s.degree, rng: s.rng });
    const supplierId = s.supplierKind === "patron" ? "pat" : "cra";
    const world = {
      gold: { pat: s.patronGold, cra: s.crafterGold },
      stacks: { [supplierId]: { ...s.stackQty } }, items: {}
    };
    const patron = s.patronIsActor ? { type: "actor", actorId: "pat" } : { type: "lightweight", name: "NPC" };
    const steps = buildSteps({
      patron, crafterId: "cra", supplier: s.supplierKind === "npc" ? { kind: "npc" } : { kind: s.supplierKind, actorId: supplierId },
      outcome, payoutCopper: s.payoutCp, itemData: outcome.made && s.patronIsActor ? { name: "Item" } : null
    });
    const after = applySteps(world, steps);
    const label = `scenario ${i} (${s.degree}, ${s.supplierKind}, patron ${patron.type})`;

    // Gold: the fee leaves the patron and is destroyed; the payout moves patron -> crafter (success only).
    const fee = s.patronIsActor ? s.feeCp : 0;
    const paid = outcome.made ? s.payoutCp : 0;
    assert.equal(world.gold.pat - after.gold.pat, s.patronIsActor ? fee + paid : 0, `${label}: patron paid`);
    assert.equal(after.gold.cra - world.gold.cra, paid, `${label}: crafter received`);
    const totalBefore = world.gold.pat + world.gold.cra;
    const totalAfter = after.gold.pat + after.gold.cra;
    assert.equal(totalBefore - totalAfter, fee - (s.patronIsActor ? 0 : paid), `${label}: gold only leaves as the fee (an NPC payout is created)`);
    if (!outcome.made) assert.equal(after.gold.cra, world.gold.cra, `${label}: no payout without delivery`);

    // Materials: used + kept = planned, stacks never go negative, an NPC supply touches nothing.
    const planned = s.uses.reduce((n, u) => n + u.units, 0);
    assert.equal(outcome.summary.unitsUsed + outcome.summary.unitsKept, planned, `${label}: used + kept = planned`);
    const before = Object.values(world.stacks[supplierId]).reduce((n, q) => n + q, 0);
    const left = Object.values(after.stacks[supplierId]).reduce((n, q) => n + q, 0);
    if (s.supplierKind === "npc") assert.equal(left, before, `${label}: the NPC supply leaves no trace`);
    else assert.equal(before - left, outcome.summary.unitsUsed, `${label}: the supplier lost exactly the units used`);
    for (const q of Object.values(after.stacks[supplierId])) assert.ok(q >= 0);
    if (s.degree === "criticalFailure") assert.equal(outcome.summary.unitsUsed, planned, `${label}: a critical failure loses everything`);
    if (outcome.made) assert.equal(outcome.summary.unitsUsed, planned, `${label}: success uses everything`);

    // The item goes to a character patron only, and only on success.
    assert.equal((after.items.pat ?? []).length, outcome.made && s.patronIsActor ? 1 : 0, `${label}: item`);
    assert.equal((after.items.cra ?? []).length, 0, `${label}: the crafter never receives the item`);
  }
});

test("PROPERTY: affordability agrees with the steps: if the patron passes the check the steps never overdraw, and a failed check names a real shortfall", () => {
  const rng = seeded(31337);
  for (let i = 0; i < 400; i++) {
    const fee = Math.floor(rng() * 6) * 100;
    const payout = Math.floor(rng() * 4000);
    const gold = Math.floor(rng() * 6000);
    const errors = affordabilityErrors({ patronCopper: gold, feeCopper: fee, payoutCopper: payout, patronName: "P" });
    const outcome = { made: true, consumeByStack: {}, feeConsumed: fee / 100 };
    const steps = buildSteps({ patron: { type: "actor", actorId: "pat" }, crafterId: "cra", supplier: { kind: "patron", actorId: "pat" }, outcome, payoutCopper: payout, itemData: { name: "x" } });
    if (!errors.length) assert.doesNotThrow(() => applySteps({ gold: { pat: gold, cra: 0 }, stacks: {}, items: {} }, steps), `gold ${gold} fee ${fee} payout ${payout}`);
    else {
      assert.ok(gold < fee + payout);
      assert.doesNotMatch(errors[0], /undefined|NaN/);
    }
  }
});

// The audit's view of loans ----------------------------------------------------------------------------------------------------
test("compareLoans: a loan needs an accepted loan commission, and an accepted loan commission needs its loan", () => {
  const c = commissionAt("accepted", { id: "c1" });
  const loan = addLoan([], dagger, "c1").list;
  const run = (formulas, commissions = [c], actorId = "cra") => compareLoans({ actorId, formulas, commissions }).map(m => m.kind);
  assert.deepEqual(run(loan), []);
  assert.deepEqual(run([]), ["commissionNoLoan"], "the loan was deleted");
  assert.deepEqual(run(loan, []), ["loanNoCommission"], "a loan with no commission");
  assert.deepEqual(run(loan, [commissionAt("delivered", { id: "c1" })]), ["loanNoCommission"], "a finished commission leaves no loan");
  assert.deepEqual(run(loan, [commissionAt("requested", { id: "c1" })]), ["loanNoCommission"], "not accepted yet");
  assert.deepEqual(run(loan, [{ ...c, crafter: "other" }]), ["loanNoCommission"], "someone else's commission");
  assert.deepEqual(run([{ recipeId: dagger.id, access: "owned", source: "research" }]), [], "an owned formula needs no loan");
  assert.deepEqual(run([{ recipeId: dagger.id, access: "loan", source: "gm" }]), [], "a GM loan serves it too");
  assert.deepEqual(run([{ recipeId: dagger.id, access: "loan", source: "x", commissions: ["nope"] }]), ["loanNoCommission", "commissionNoLoan"], "a forged loan");
  assert.deepEqual(run([], [commissionAt("accepted", { id: "c2", access: "copy" })]), [], "a copy commission has no loan");
});

// Queue handler (pure) -----------------------------------------------------------------------------------------------------------
const owned = { recipeId: dagger.id, access: "owned", source: "research", snapshot: { slots: dagger.slots.map(s => ({ name: s.name })) } };
const ctx = (extra = {}) => ({ params: { step: "request", crafter: "Borin", recipe: dagger.id, access: "loan", selection: SEL, payout: 12 }, days: 0, actorId: "pat", isGM: false, commissions: [], formulas: [owned], crafterId: "cra", ...extra });

test("commission request validation: free of days, the patron must OWN the formula, the selection must fit its slots", () => {
  const v = extra => HANDLERS.commission.validateSubmit(ctx(extra));
  assert.equal(v().ok, true);
  assert.deepEqual(v().params, { step: "request", crafter: "cra", recipe: dagger.id, access: "loan", selection: SEL, stationId: undefined, payout: 12, learnRoll: false });
  assert.match(v({ days: 1 }).errors[0], /cost no days/);
  assert.match(v({ crafterId: undefined }).errors[0], /cannot find the crafter "Borin"/);
  assert.match(v({ formulas: [] }).errors[0], /you do not own the formula/);
  assert.match(v({ formulas: [{ ...owned, access: "loan" }] }).errors[0], /you do not own the formula/, "a borrowed formula cannot be re-lent");
  assert.match(v({ params: { ...ctx().params, selection: { blade: "iron" } } }).errors.join(), /slot "fang"/);
  assert.match(v({ params: { ...ctx().params, payout: 0.001 } }).errors.join(), /copper pieces/);
  assert.match(v({ crafterId: "pat" }).errors.join(), /different characters/);
});

test("accept / decline / cancel / craft validation uses the real transition table", () => {
  const requested = commissionAt("requested", { id: "c1" });
  const accepted = commissionAt("accepted", { id: "c1" });
  const step = (c, s, actorId, params = {}) => HANDLERS.commission.validateSubmit({ params: { step: s, id: "c1", ...params }, days: 0, actorId, isGM: false, commissions: [c], formulas: [], crafterId: undefined });
  assert.equal(step(requested, "accept", "cra").ok, true);
  assert.equal(step(requested, "accept", "pat").ok, false);
  assert.equal(step(accepted, "accept", "cra").ok, false);
  assert.equal(step(accepted, "cancel", "pat").ok, true);
  assert.equal(step(accepted, "cancel", "cra").ok, false);
  assert.equal(step(accepted, "craft", "cra", { selection: SEL }).ok, true);
  assert.equal(step({ ...accepted, selection: SEL }, "craft", "cra").ok, true);
  assert.match(step({ ...accepted, selection: undefined }, "craft", "cra").errors[0], /supplies the materials/);
  assert.match(step(requested, "accept", "cra", { as: "loan" }).errors[0], /only on a copy offer/);
  assert.equal(step({ ...requested, access: "copy" }, "accept", "cra", { as: "loan" }).ok, true);
  assert.match(step(requested, "accept", "cra", { id: "zzz" }).errors[0], /no commission "zzz"/);
});
