import test from "node:test";
import assert from "node:assert/strict";
import { check, classifyEffectValue, obj, int, str, arr } from "../scripts/data/schema.js";

test("effect values: number, tier, and string are all accepted; others classified null", () => {
  assert.equal(classifyEffectValue(2), "number");
  assert.equal(classifyEffectValue("T2"), "tier");
  assert.equal(classifyEffectValue("+1d4 vs fiends"), "string");
  assert.equal(classifyEffectValue(""), null);
  assert.equal(classifyEffectValue(NaN), null);
  assert.equal(classifyEffectValue({}), null);
  assert.equal(classifyEffectValue(["T2"]), null);
});

test("validator reports nested field paths", () => {
  const spec = obj({ list: arr(obj({ n: int({ min: 1 }) })), name: str() });
  const errors = check(spec, { list: [{ n: 1 }, { n: 0 }], name: "x" });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "list[1].n");
  assert.match(errors[0].message, /at least 1/);
});

test("validator rejects unknown fields and missing required ones", () => {
  const spec = obj({ a: str() });
  const errors = check(spec, { b: 1 });
  const fields = errors.map(e => e.field).sort();
  assert.deepEqual(fields, ["a", "b"]);
});

test("integers reject fractions; numbers accept them", () => {
  assert.equal(check(int(), 1.5).length, 1);
  assert.equal(check(int(), 2).length, 0);
});
