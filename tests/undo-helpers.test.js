/**
 * Round 3 (stage 1 #27): ONE undo loop and ONE give / consume pattern. The queue, the commissions, the direct craft, the gather and the expedition all roll back through undoAll; a stack
 * is taken (consumeStackWithUndo) or given (giveWithUndo) by the same two helpers wherever it happens.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { as, getApi, world } from "./fake-world.js";
import { giveWithUndo, undoAll } from "../scripts/queue/common.js";

const walk = dir => readdirSync(dir).flatMap(f => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : f.endsWith(".js") ? [join(dir, f)] : []));

test("UNDO LOOP: undoAll runs every undo in reverse even when one fails, then throws ONE error that lists the failures and ends with the advice it was given", async () => {
  const ran = [];
  const undos = [
    { what: "first", run: async () => { ran.push("first"); } },
    { what: "second", run: async () => { ran.push("second"); throw new Error("no luck"); } },
    { what: "third", run: async () => { ran.push("third"); } },
    { what: "fourth", run: async () => { ran.push("fourth"); throw new Error("also no luck"); } }
  ];
  const error = await undoAll(undos).then(() => null, e => e);
  assert.deepEqual(ran, ["fourth", "third", "second", "first"], "reverse order, and the failing ones did not stop the rest");
  assert.equal(error.message, "could not undo: fourth (also no luck); second (no luck). Check these by hand.");
  assert.deepEqual(error.failures, ["fourth (also no luck)", "second (no luck)"]);
  const scene = await undoAll(undos, "Check the scene by hand (api.clearMap clears what an expedition placed).").then(() => null, e => e);
  assert.match(scene.message, /Check the scene by hand \(api\.clearMap clears what an expedition placed\)\.$/);
  assert.equal(await undoAll([{ what: "ok", run: async () => {} }]), undefined, "nothing failed: nothing thrown");
  assert.equal(await undoAll([]), undefined);
});

test("UNDO LOOP: the loop lives in ONE place (queue/common.js); no other file walks an undo list by itself", () => {
  const files = walk("scripts").filter(f => /undo\.run\(\)/.test(readFileSync(f, "utf8")));
  assert.deepEqual(files, [join("scripts", "queue", "common.js")]);
  for (const f of ["scripts/commissions/store.js", "scripts/exploration/store.js", "scripts/gathering/store.js"]) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /function rollBack|\.reverse\(\)/, `${f} has no loop of its own`);
    assert.match(readFileSync(f, "utf8"), /undoAll/, `${f} uses the shared helper`);
  }
});

test("GIVE PATTERN: giveWithUndo makes a new stack and its undo deletes it; onto an existing stack its undo puts the old quantity back", async () => {
  const w = await world({ iron: 0, fang: 0 });
  const iron = { id: "iron", name: "Iron", tier: 1 };
  const total = () => w.ann.items.filter(i => i.getFlag("pathfinder-progress", "material")?.materialId === "iron").reduce((n, i) => n + (i.system?.quantity ?? 1), 0);
  const undos = [];
  await giveWithUndo(w.ann, iron, 2, undos);
  assert.equal(total(), 2);
  await giveWithUndo(w.ann, iron, 3, undos);
  assert.equal(total(), 5);
  assert.deepEqual(undos.map(u => u.what), ["2x iron on Ann", "3x iron on Ann"]);
  await undoAll(undos);
  assert.equal(total(), 0, "both gives were taken back, in reverse (the top-up first, then the new stack)");
});

test("GATHER GRANT: a grant that fails part-way takes back what it gave, and a failing undo is reported in error.undoFailures", async () => {
  const w = await world({ iron: 0, fang: 0 });
  const { grantAll } = await import("../scripts/gathering/store.js");
  const definitions = getApi().definitions;
  const iron = () => w.ann.items.filter(i => i.getFlag("pathfinder-progress", "material")?.materialId === "iron").length;
  const real = w.ann.createEmbeddedDocuments;
  let calls = 0;
  w.ann.createEmbeddedDocuments = async (...args) => { if (++calls === 2) throw new Error("boom: the second stack would not be made"); return real.apply(w.ann, args); };
  try {
    const error = await as(w.gm, () => grantAll(w.ann, [{ materialId: "iron", quantity: 2 }, { materialId: "spider-fang", quantity: 1 }], definitions)).then(() => null, e => e);
    assert.match(error.message, /boom/);
    assert.equal(iron(), 0, "the iron that had been given was taken back");
    assert.equal(error.undoFailures, undefined, "nothing failed to undo");
  } finally { w.ann.createEmbeddedDocuments = real; }
});
