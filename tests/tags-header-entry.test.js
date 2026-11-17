/** The Item tags header button on item sheets: ApplicationV2 (getHeaderControlsApplicationV2) and ApplicationV1 (getItemSheetHeaderButtons, what PF2e's item sheets are). GM only, never twice. */
import test from "node:test";
import assert from "node:assert/strict";
import { as, getUsers, world } from "./fake-world.js";
import { installTagEntryPoints, V1_HOOK } from "../scripts/tags/entry.js";
import { installFakeApplication } from "./fake-application.js";

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
  const mine = v1.find(b => b.class === "pfp-item-tags");
  assert.doesNotMatch(mine.class, /\s/, "the class is ONE token: V1 finds a clicked button with classList.contains(button.class), which a class with a space never matches");
  assert.equal(`header-button control ${mine.class}`.split(" ").includes(mine.class), true, "the drawn anchor's class list holds the button object's class");
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

const capture = async fn => {
  const lines = [], saved = { debug: console.debug, error: console.error };
  console.debug = (...a) => lines.push(["debug", a.map(x => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" ")]);
  console.error = (...a) => lines.push(["error", a.map(String).join(" ")]);
  try { return { value: await fn(), lines }; } finally { console.debug = saved.debug; console.error = saved.error; }
};

test("ENTRY: every guard that keeps the V1 button off a sheet says which one (console.debug, module prefix); a Player says nothing", async () => {
  const { handlers, gm, testUser } = await setup();
  const hook = handlers.get(V1_HOOK);
  const run = (user, sheet, buttons) => capture(() => as(user, () => hook(sheet, buttons)));
  const notItem = await run(gm, { item: { documentName: "Actor" } }, []);
  assert.match(notItem.lines.map(l => l[1]).join("\n"), /^pathfinder-progress \| Item tags button not added: the sheet's document is not an Item/);
  const notList = await run(gm, { item }, {});
  assert.match(notList.lines.map(l => l[1]).join("\n"), /^pathfinder-progress \| Item tags button not added: the header buttons are not a list/);
  const list = [];
  await run(gm, { item }, list);
  const again = await run(gm, { item }, list);
  assert.match(again.lines.map(l => l[1]).join("\n"), /^pathfinder-progress \| Item tags button not added again: this sheet already has it/);
  assert.equal(list.length, 1);
  const player = await run(testUser, { item }, []);
  assert.deepEqual(player.lines, [], "a Player is the normal case and says nothing");
});

test("ENTRY: the V1 onclick logs what it resolved, a failed window draw is reported (console.error) and the click still ends", async () => {
  const { handlers, gm } = await setup();
  installFakeApplication();
  const buttons = [];
  as(gm, () => handlers.get(V1_HOOK)({ item, constructor: { name: "FakeSheet" } }, buttons));
  // the entry point is given an api with no definitions, so the window cannot draw: the failure must be reported
  const out = await capture(() => as(gm, () => buttons[0].onclick({ preventDefault() {} })));
  const text = out.lines.map(l => `${l[0]}: ${l[1]}`).join("\n");
  assert.match(text, /debug: pathfinder-progress \| Item tags button clicked \{"sheetClass":"FakeSheet","name":"Gate Charm","uuid":"Actor\.a\.Item\.b"/);
  assert.match(text, /debug: pathfinder-progress \| opening the Item tags window with \{"uuid":"Actor\.a\.Item\.b","name":"Gate Charm","noSource":/);
  assert.match(text, /error: pathfinder-progress \| the Item tags window failed to render/);
  assert.equal(out.value, undefined);
});
