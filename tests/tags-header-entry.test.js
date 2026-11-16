/** The Item tags header button on item sheets: ApplicationV2 (getHeaderControlsApplicationV2) and ApplicationV1 (getItemSheetHeaderButtons, what PF2e's item sheets are). GM only, never twice. */
import test from "node:test";
import assert from "node:assert/strict";
import { as, getUsers, world } from "./fake-world.js";
import { installTagEntryPoints, V1_HOOK } from "../scripts/tags/entry.js";

const item = { documentName: "Item", name: "Gate Charm", uuid: "Actor.a.Item.b", getFlag: () => undefined };
async function setup() {
  await world({});
  const handlers = new Map();
  installTagEntryPoints(() => ({}), { on: (name, fn) => handlers.set(name, fn) });
  return { handlers, ...getUsers() };
}

test("ENTRY: an ApplicationV1 item sheet gets exactly one GM-only Item tags button, a Player none, a V2 sheet still exactly one", async () => {
  const { handlers, gm, testUser } = await setup();
  assert.equal(V1_HOOK, "getItemSheetHeaderButtons");
  assert.deepEqual([...handlers.keys()].sort(), ["getHeaderControlsApplicationV2", "getItemSheetHeaderButtons", "getSceneControlButtons"]);
  const v1 = [{ class: "close" }];
  as(gm, () => handlers.get(V1_HOOK)({ item, element: { 0: {}, length: 1 } }, v1));
  as(gm, () => handlers.get(V1_HOOK)({ item }, v1));
  assert.deepEqual(v1.filter(b => b.class === "pfp-item-tags").map(b => [b.label, typeof b.onclick]), [["Item tags", "function"]], "exactly one, never twice");
  const player = [{ class: "close" }];
  as(testUser, () => handlers.get(V1_HOOK)({ item }, player));
  assert.equal(player.length, 1, "a Player gets none");
  const notItem = [];
  as(gm, () => handlers.get(V1_HOOK)({ item: { documentName: "Actor" } }, notItem));
  assert.equal(notItem.length, 0, "an Actor sheet gets none");
  const v2 = [];
  as(gm, () => handlers.get("getHeaderControlsApplicationV2")({ document: item }, v2));
  as(gm, () => handlers.get("getHeaderControlsApplicationV2")({ document: item }, v2));
  assert.deepEqual(v2.map(c => [c.action, c.label]), [["pfp-item-tags", "Item tags"]]);
  const asPlayer2 = [];
  as(testUser, () => handlers.get("getHeaderControlsApplicationV2")({ document: item }, asPlayer2));
  assert.equal(asPlayer2.length, 0);
});

test("ENTRY: the V1 button's onclick runs the open function, and a failure is reported (console.error) instead of vanishing", async () => {
  const { handlers, gm } = await setup();
  const broken = { ...item, getFlag: () => { throw new Error("flag read failed"); } };
  const buttons = [];
  as(gm, () => handlers.get(V1_HOOK)({ item: broken }, buttons));
  const logged = [];
  const spy = console.error; console.error = (...a) => logged.push(a.map(String).join(" "));
  try { as(gm, () => buttons[0].onclick({ preventDefault() {} })); } finally { console.error = spy; }
  assert.match(logged.join("\n"), /could not open the window for Gate Charm/);
});
