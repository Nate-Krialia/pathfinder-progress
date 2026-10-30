/** The GM resolve log (Stage 11a): memory only, newest first, capped, GM only through the api, never a chat message or a saved value. */
import test from "node:test";
import assert from "node:assert/strict";
import * as gmLog from "../scripts/gm-log.js";
import { GM_LOG } from "../scripts/config.js";
import { as, env, getApi, world } from "./fake-world.js";

test("record and list: newest first, filtered by kind and actor, limited, and copies (a caller cannot edit the log)", () => {
  gmLog.clear();
  gmLog.record({ kind: "research", actorId: "a", text: "one", detail: { dc: 14 } });
  gmLog.record({ kind: "craft", actorId: "b", text: "two" });
  gmLog.record({ kind: "research", actorId: "b", text: "three" });
  assert.deepEqual(gmLog.list().map(e => e.text), ["three", "two", "one"]);
  assert.deepEqual(gmLog.list({ kind: "research" }).map(e => e.text), ["three", "one"]);
  assert.deepEqual(gmLog.list({ actorId: "b", limit: 1 }).map(e => e.text), ["three"]);
  gmLog.list()[2].detail.dc = 99;
  assert.equal(gmLog.list()[2].detail.dc, 14);
});

test("the log is capped at the configured size, dropping the oldest", () => {
  gmLog.clear();
  for (let i = 0; i < GM_LOG.maxEntries + 5; i++) gmLog.record({ kind: "x", text: `n${i}` });
  const rows = gmLog.list();
  assert.equal(rows.length, GM_LOG.maxEntries);
  assert.equal(rows[0].text, `n${GM_LOG.maxEntries + 4}`);
  assert.equal(rows.at(-1).text, "n5");
});

test("plainText turns the summary HTML into one readable line", () => {
  assert.equal(gmLog.plainText("<strong>Ann</strong> researches <em>X</em><br>Day 1: 8 vs DC 14: Failure (+0)<br>Progress: 1/4."), "Ann researches X; Day 1: 8 vs DC 14: Failure (+0); Progress: 1/4.");
});

test("a new entry fires the local hook so the GM window can re-render", () => {
  const calls = [];
  const saved = globalThis.Hooks;
  globalThis.Hooks = { ...saved, callAll: (name, entry) => calls.push([name, entry.text]) };
  try { gmLog.record({ kind: "x", text: "hello" }); } finally { globalThis.Hooks = saved; }
  assert.deepEqual(calls, [[GM_LOG.changedHook, "hello"]]);
});

test("api.gm.log is GM only, and recording writes nothing: no setting, no flag, no chat", async () => {
  const w = await world({});
  const api = getApi();
  gmLog.clear();
  const before = JSON.stringify(env.values);
  const chatBefore = env.chat.length;
  gmLog.record({ kind: "research", text: "Ann: 8 vs DC 14", detail: { dc: 14 } });
  assert.equal(JSON.stringify(env.values), before, "nothing was saved");
  assert.equal(env.chat.length, chatBefore, "and nothing was posted");
  assert.equal(api.gm.log().length, 1);
  assert.throws(() => as(w.annUser, () => api.gm.log()), /GM only/);
  assert.throws(() => as(w.annUser, () => api.gm.clearLog()), /GM only/);
  api.gm.clearLog();
  assert.deepEqual(api.gm.log(), []);
});
