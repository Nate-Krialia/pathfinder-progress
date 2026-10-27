import test from "node:test";
import assert from "node:assert/strict";
import { pendingTotal, planEdit, planReject, planResolve, planSubmit, totalDays } from "../scripts/queue/reservation.js";
import { orderRows, runBatch } from "../scripts/queue/queue.js";
import { HANDLERS } from "../scripts/queue/handlers.js";
import { renderReview, esc } from "../scripts/queue/review.js";
import { applyChange, baselineEntry, compare, emptyEntry } from "../scripts/audit/audit.js";

const act = (id, daysReserved, submittedAt = 1) => ({ id, type: "research", params: { projectId: "p" }, daysReserved, submittedAt });
const project = (extra = {}) => ({
  id: "p", goalName: "Goal", outcome: { type: "unlockFormula", recipeId: "r" }, tier: 1, dc: 14, threshold: 8, progress: 0,
  skillWhitelist: ["arcana"], status: "active", log: [], ...extra
});

// Reservation arithmetic ---------------------------------------------------------------------------
test("submit, reject and edit only MOVE days: the total never changes", () => {
  let counter = 10;
  let pending = [];
  const total = () => totalDays(counter, pending);
  assert.equal(total(), 10);

  const s = planSubmit(counter, 4);
  counter = s.counter; pending = [act("a", 4)];
  assert.equal(total(), 10);

  const raise = planEdit(counter, pending[0], 6);
  counter = raise.counter; pending = [{ ...pending[0], daysReserved: raise.daysReserved }];
  assert.deepEqual([counter, pending[0].daysReserved, total()], [4, 6, 10]);

  const cut = planEdit(counter, pending[0], 2);
  counter = cut.counter; pending = [{ ...pending[0], daysReserved: cut.daysReserved }];
  assert.deepEqual([counter, total()], [8, 10]);

  counter = planReject(counter, pending[0]).counter; pending = [];
  assert.deepEqual([counter, total()], [10, 10]);
});

test("resolving spends only what was used and refunds the rest", () => {
  assert.deepEqual(planResolve(3, 5, 2), { counter: 6, refunded: 3 });
  assert.deepEqual(planResolve(0, 4, 0), { counter: 4, refunded: 4 });
  assert.throws(() => planResolve(0, 4, 5), RangeError);
  assert.throws(() => planResolve(0, 4, -1), RangeError);
});

test("overbooking is refused with a clear message, and bad day counts too", () => {
  assert.match(planSubmit(2, 3).error, /cannot reserve 3 day\(s\): only 2 unreserved/);
  assert.equal(planSubmit(3, 3).counter, 0);
  for (const bad of [0, -1, 1.5, "2", NaN]) assert.equal(planSubmit(5, bad).ok, false, String(bad));
  assert.equal(planEdit(5, act("a", 2), 0).ok, false);
  assert.match(planEdit(1, act("a", 2), 5).error, /1 unreserved day\(s\) available, 3 more needed/);
  assert.equal(pendingTotal([act("a", 2), { daysReserved: -4 }, null]), 2);
});

// Ordering and failure isolation ----------------------------------------------------------------------
test("rows resolve in submission order; ties break by action id, then actor id", () => {
  const rows = [
    { actorId: "z", action: act("b", 1, 5) }, { actorId: "a", action: act("c", 1, 1) },
    { actorId: "y", action: act("a", 1, 5) }, { actorId: "x", action: act("a", 1, 5) }
  ];
  assert.deepEqual(orderRows(rows).map(r => `${r.actorId}${r.action.id}`), ["ac", "xa", "ya", "zb"]);
  assert.equal(rows[0].actorId, "z", "the input is not mutated");
});

test("runBatch isolates failures: one throwing action does not stop the others", async () => {
  const rows = ["1", "2", "3", "4"].map((id, i) => ({ actorId: "a", action: act(id, 1, i) }));
  const seen = [];
  const { results, summary } = await runBatch(rows, async row => {
    seen.push(row.action.id);
    if (row.action.id === "2") throw new Error("boom");
    if (row.action.id === "3") return { status: "invalid", message: "gone" };
    if (row.action.id === "4") return { nope: true };
    return { status: "resolved" };
  });
  assert.deepEqual(seen, ["1", "2", "3", "4"]);
  assert.deepEqual(results.map(r => r.status), ["resolved", "error", "invalid", "error"]);
  assert.match(results[1].message, /boom/);
  assert.match(results[3].message, /unexpected result/);
  assert.deepEqual(summary, { resolved: 1, invalid: 1, skipped: 0, errors: 2 });
});

// Research handler -----------------------------------------------------------------------------------------
test("research validateSubmit needs a real, active unlockFormula project and an allowed skill", () => {
  const v = (projects, params) => HANDLERS.research.validateSubmit({ projects, params });
  assert.deepEqual(v([project()], { projectId: "p" }), { ok: true, params: { projectId: "p", skill: "arcana" } });
  assert.match(v([project()], { projectId: "nope" }).errors[0], /no project "nope"/);
  assert.match(v([project({ status: "complete" })], { projectId: "p" }).errors[0], /complete, not active/);
  assert.match(v([project({ skillWhitelist: ["arcana", "occultism"] })], { projectId: "p" }).errors[0], /choose one with skill/);
  assert.match(v([project()], { projectId: "p", skill: "crafting" }).errors[0], /not allowed/);
  assert.match(v([project({ outcome: { type: "upgradeStation", stationId: "s" } })], { projectId: "p" }).errors[0], /unlockFormula/);
});

// Review window --------------------------------------------------------------------------------------------------
test("the review HTML escapes everything that came from data and offers Retry only on errors", () => {
  const evil = `<img src=x onerror="alert(1)">`;
  const row = { actorId: "a1", actorName: evil, action: act("q1", 2), label: evil, detail: evil, problem: evil };
  const html = renderReview({
    rows: [row],
    results: [{ actorId: "a1", actionId: "q1", actorName: evil, label: evil, status: "error", message: evil }],
    audit: [{ actorId: "a1", name: evil, mismatches: [{ kind: "days", message: evil }], history: [{ at: 1, text: evil }] }]
  });
  assert.ok(!html.includes("<img"), "raw markup must not survive");
  assert.match(html, /data-action="retry"/);
  assert.match(html, /data-action="accept"/);
  assert.match(html, /data-action="resolve-all"/);
  assert.ok(!renderReview({ rows: [row] }).includes('data-action="retry"'), "no Retry without an error");
  assert.match(renderReview({ rows: [] }), /Nothing is waiting/);
  assert.match(renderReview({ rows: [] }), /data-action="resolve-all" disabled/);
  assert.equal(esc(`<&>"'`), "&lt;&amp;&gt;&quot;&#39;");
});

// Audit (pure) -------------------------------------------------------------------------------------------------------
const stateOf = (extra = {}) => ({ counter: 0, pending: [], formulas: [], projects: [], ...extra });
const formula = (recipeId, access = "owned") => ({ recipeId, access, source: "gm" });

test("audit: matching state reports nothing; reserving days is NOT a mismatch", () => {
  let entry = applyChange(emptyEntry("A"), { type: "days", delta: 10 });
  assert.deepEqual(compare(stateOf({ counter: 10 }), entry), []);
  assert.deepEqual(compare(stateOf({ counter: 6, pending: [act("q", 4)] }), entry), []);
});

test("audit: extra days, an extra or changed formula, an edited project and a deleted record are all caught", () => {
  let entry = emptyEntry("A");
  entry = applyChange(entry, { type: "days", delta: 4 });
  entry = applyChange(entry, { type: "formulaAdd", recipeId: "dagger", access: "loan" });
  entry = applyChange(entry, { type: "projectSet", project: project({ progress: 3 }) });
  const good = stateOf({ counter: 4, formulas: [formula("dagger", "loan")], projects: [project({ progress: 3 })] });
  assert.deepEqual(compare(good, entry), []);

  const kinds = state => compare(state, entry).map(m => m.kind);
  assert.deepEqual(kinds({ ...good, counter: 40 }), ["days"]);
  assert.deepEqual(kinds({ ...good, formulas: [...good.formulas, formula("sword")] }), ["formulaExtra"]);
  assert.deepEqual(kinds({ ...good, formulas: [formula("dagger", "owned")] }), ["formulaAccess"]);
  assert.deepEqual(kinds({ ...good, formulas: [] }), ["formulaMissing"]);
  assert.deepEqual(kinds({ ...good, projects: [project({ progress: 8, status: "complete" })] }), ["projectEdited"]);
  assert.deepEqual(kinds({ ...good, projects: [] }), ["projectMissing"]);
  assert.deepEqual(kinds({ ...good, projects: [...good.projects, project({ id: "q" })] }), ["projectUnknown"]);
  assert.deepEqual(kinds({ ...good, counter: -3 }), ["invalid"]);
  assert.ok(kinds({ ...good, pending: [{ id: "x" }] }).includes("invalid"));
});

test("audit: module changes are applied as CHANGES, so an earlier tamper stays visible", () => {
  let entry = applyChange(emptyEntry("A"), { type: "days", delta: 5 });
  const tampered = stateOf({ counter: 55 });
  assert.equal(compare(tampered, entry).length, 1);
  // The module then spends 2 days: expected 3. The actor holds 53 (55 - 2): still off by 50.
  entry = applyChange(entry, { type: "days", delta: -2 });
  assert.match(compare(stateOf({ counter: 53 }), entry)[0].message, /holds 53 .* expects 3/);
});

test("audit: baseline matches today's state and history is capped", () => {
  const state = stateOf({ counter: 2, pending: [act("q", 3)], formulas: [formula("dagger")], projects: [project()] });
  const entry = baselineEntry(state, "A", "start");
  assert.equal(entry.days, 5);
  assert.deepEqual(compare(state, entry), []);
  let big = emptyEntry("A");
  for (let i = 0; i < 50; i++) big = applyChange(big, { type: "days", delta: 1 });
  assert.equal(big.history.length, 20);
  assert.throws(() => applyChange(emptyEntry("A"), { type: "nope" }), /unknown change type/);
});
