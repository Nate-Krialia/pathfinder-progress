/**
 * The cut-down Item tags window gate (docs/23-tags-window-gate.md): every code block is extracted and run, in order, in a fake Foundry with the real Item tags window on the strict ApplicationV2 stand-in
 * (jsdom), a fake scene-controls button, and a fake item sheet that fires the header-controls hook the way an ApplicationV2 sheet does. What it cannot show: whether PF2e's REAL item sheet is an
 * ApplicationV2 and shows the header button, the real scene controls, Foundry's own styles and events.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { as, getApi, getUsers, listeners, quietly, world } from "./fake-world.js";
import { asPage, seedRecords } from "./helpers.js";
import { installFakeApplication } from "./fake-application.js";
import script from "../e2e/steps/gate23.steps.mjs";
import { makeDomDriver, playStep } from "../e2e/driver-dom.mjs";

const gateDoc = readFileSync("docs/23-tags-window-gate.md", "utf8");
const MODULE_VERSION = JSON.parse(readFileSync("module.json", "utf8")).version;
const GATE = new Map();
for (const match of gateDoc.matchAll(/^## Step (\d+) ((?:\[[^\]]+\](?: and )?)+)[^\n]*\n([\s\S]*?)(?=^## Step |^## Group |(?![\s\S]))/gm)) {
  const block = match[3].match(/```js\n([\s\S]*?)```/);
  GATE.set(Number(match[1]), { who: match[2], code: block?.[1] ?? null, text: match[3] });
}
function runBlock(step, user) {
  const entry = GATE.get(step);
  assert.ok(entry?.code, `docs/23-tags-window-gate.md needs a code block in Step ${step}`);
  const code = entry.code.replace(/^(\/\/[^\n]*\n)*\s*await \(/, match => match.replace("await (", "("));
  return as(user, () => (0, eval)(code));
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const sink = async fn => {
  const lines = [], logged = console.log;
  console.log = (...args) => lines.push(args.map(String).join(" "));
  try { return { result: await fn(), lines: lines.join("\n").split("\n").filter(Boolean) }; } finally { console.log = logged; }
};

/**
 * What the real window sits in: scene controls with the module's button drawn (when the module's hook put the tool in), items that know their own uuid and have a sheet. `v2: false` makes the sheet an old-style
 * (ApplicationV1-like) one with a jQuery-like element that fires get<Class>HeaderButtons for its class chain (`v1Hooks: false` makes it fire nothing, the case the gate must report with its cause); `button: false` leaves the scene-controls button undrawn.
 */
function fakeWindowWorld({ v2 = true, button = true, v1Hooks = true, v1BindMs = 500 } = {}) {
  const { ApplicationV2 } = foundry.applications.api;
  const gm = getUsers().gm;
  globalThis.jQuery = { fn: { jquery: "3.7.1" }, _data: (el, type) => (type === "events" ? el.__events : undefined) };
  const controls = { tokens: { tools: { select: { name: "select" } } } };
  Hooks.events = new Proxy({}, { get: (_, name) => listeners[name] ?? undefined, ownKeys: () => Object.keys(listeners), getOwnPropertyDescriptor: (_, name) => (name in listeners ? { enumerable: true, configurable: true, value: listeners[name] } : undefined) });
  return as(gm, async () => {
    for (const fn of listeners.getSceneControlButtons ?? []) fn(controls);
    globalThis.ui = { controls: { controls } };
    window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 640, height: 480 });      // jsdom has no layout engine: every drawn element gets a size
    document.querySelectorAll('[data-tool="pfpItemTags"]').forEach(b => b.remove());
    const tool = controls.tokens.tools.pfpItemTags;
    if (button && tool) { const b = document.createElement("button"); b.dataset.tool = "pfpItemTags"; b.addEventListener("click", () => tool.onChange()); document.body.append(b); }
    const sheetFor = item => {
      if (!v2) {
        // An ApplicationV1-like sheet: `element` is jQuery-like (array-like, NO querySelector), the header buttons come from _getHeaderButtons, which calls get<Class>HeaderButtons for each class of the chain
        // (like Application#_getHeaderButtons does), and a click on a drawn <a class="header-button"> runs that button's onclick.
        const chain = ["FakeEquipmentSheet", "ItemSheet", "DocumentSheet", "FormApplication", "Application"];
        const sheet = {
          constructor: { name: "FakeEquipmentSheet" }, item, document: item, rendered: false, element: null,
          _getHeaderButtons() { const list = [{ class: "close", label: "Close" }]; if (v1Hooks) for (const cls of chain) for (const fn of listeners[`get${cls}HeaderButtons`] ?? []) fn(sheet, list); return list; },
          async render() {
            // Foundry's V1 window (as the gate's real run shows it): a header button is drawn as <a class="header-button control {class}">, the click handler is bound a little AFTER the draw (v1BindMs),
            // and a click finds its button object by `classList.contains(button.class)`; a class with a space in it never matches.
            const buttons = sheet._getHeaderButtons();
            const root = document.createElement("div");
            root.innerHTML = `<header class="window-header">${buttons.map(b => `<a class="header-button control ${b.class}">${b.label ?? ""}</a>`).join("")}</header>`;
            const bind = () => root.querySelectorAll(".header-button").forEach(a => {
              const handler = event => { event.preventDefault?.(); buttons.find(b => a.classList.contains(b.class)).onclick(event); };
              a.addEventListener("click", handler);
              a.__events = { click: [handler] };
            });
            setTimeout(bind, v1BindMs).unref?.();
            sheet.element = { 0: root, length: 1, find: sel => root.querySelectorAll(sel) };
            sheet.rendered = true;
          },
          async close() { sheet.rendered = false; }
        };
        return sheet;
      }
      class FakeItemSheet extends ApplicationV2 {
        static DEFAULT_OPTIONS = { id: `item-sheet-${item.id}`, classes: [], tag: "div", window: { title: item.name }, actions: { "pfp-item-tags"() { return this.controls.find(c => c.action === "pfp-item-tags")?.onClick(); } } };
        get document() { return item; }
        _getHeaderControls() { const list = [{ action: "configure", label: "Configure" }]; for (const fn of listeners.getHeaderControlsApplicationV2 ?? []) fn(this, list); return list; }
        async _renderHTML() { this.controls = this._getHeaderControls(); return `<header>${this.controls.map(c => `<button type="button" data-action="${c.action}">${c.label ?? c.action}</button>`).join("")}</header>`; }
        _replaceHTML(result, content) { content.innerHTML = result; }
      }
      return new FakeItemSheet();
    };
    const baseCreate = Actor.create;
    Actor.create = async data => {
      const actor = await baseCreate(data);
      const embed = actor.createEmbeddedDocuments;
      actor.createEmbeddedDocuments = async (type, datas) => (await embed(type, datas)).map(item => {
        item.uuid = `Actor.${actor.id}.Item.${item.id}`; item.documentName = "Item";
        let sheet = null;
        Object.defineProperty(item, "sheet", { get: () => (sheet ??= sheetFor(item)) });
        return item;
      });
      return actor;
    };
    globalThis.fromUuid = async uuid => game.actors.flatMap(a => [...a.items]).find(i => i.uuid === uuid) ?? null;
  });
}

test("the Item tags window gate doc: steps are labelled, bullets are short, the standing format holds, every FAIL prints what it compared", () => {
  assert.deepEqual([...GATE.keys()], Array.from({ length: 7 }, (_, i) => i + 1));
  for (const [step, entry] of GATE) {
    assert.match(entry.who, step === 1 ? /^\[GM\] and \[Player\]\s*$/ : step === 6 ? /^\[Player\]\s*$/ : /^\[GM\]\s*$/, `step ${step} says who runs it`);
    assert.ok(entry.code, `step ${step} has a code block`);
    assert.equal((entry.text.match(/```js/g) ?? []).length, 1, `step ${step} has ONE code block`);
    const section = entry.text.split("```js")[0];
    const bullets = section.split("\n").filter(l => /^- /.test(l));
    assert.ok(bullets.length >= 2, `step ${step} lists its instructions as bullets`);
    assert.ok(bullets.every(b => b.length <= 700), `step ${step}: every bullet is short (one action)`);
    assert.doesNotMatch(section.replace(/^- .*$/gm, ""), /\n[A-Z][^\n]{200,}/, `step ${step} has no long paragraph of instructions outside the bullets`);
    if (!/Nothing to click/i.test(section) && step !== 2) assert.ok(bullets.some(b => /You should see:/.test(b)), `step ${step} has a "You should see:" bullet`);
    if (step > 1) assert.match(entry.code, /ALL PASS|done\(\)|already|planted|problems/, `step ${step} ends in a result line the person can paste back`);
  }
  assert.match(gateDoc, new RegExp(`version must be \\*\\*${MODULE_VERSION.replace(/\./g, "\\.")}\\*\\*`));
  assert.match(gateDoc, /Force-reload BOTH windows first/);
  assert.match(gateDoc, /Every FAIL line prints each value it compared/);
  assert.match(gateDoc, /closes the windows it opened before it ends/);
  assert.match(gateDoc, /inside the window's root element/);
  assert.doesNotMatch(gateDoc.replace(/DC\b[^\n]*never/gi, ""), /\bDC \d|odds of|\d+% chance/i, "the gate text itself never talks about difficulty to a player");
  for (const [step, { code }] of GATE) if (step > 1) {
    for (const line of code.split("\n").filter(l => /\bg\.check\(|\bcheck\(/.test(l) && !/const check|const g = |check: \(/.test(l))) assert.match(line, /JSON\.stringify|\bdetail\b|\$\{|\.join\(|\.slice\(/, `step ${step}: a check prints what it compared: ${line.trim().slice(0, 90)}`);
    // never a bare document-wide [data-action] click: the blocks look inside the window
    assert.doesNotMatch(code, /document\.querySelector\(\s*['"`]\[data-action/, `step ${step} does not click a document-wide [data-action]`);
  }
  assert.equal([...GATE.values()].filter(e => e.code && /closeAll\(\)/.test(e.code)).length, 3, "Steps 3, 4 and 5 close what they opened");
});

test("the steps file obeys the runner's rules and picks by ids", () => {
  const source = readFileSync("e2e/steps/gate23.steps.mjs", "utf8");
  assert.doesNotMatch(source, /\bimport\b|require\(|process\.|fetch\(|eval\(|new Function|nth-child/, "no import, require, process, fetch, eval or Function");
  assert.deepEqual(Object.keys(script), ["before"]);
  assert.deepEqual(Object.keys(script.before), ["6"]);
  assert.match(source, /data-recipe="dagger-spider-fang"/);
});

async function playGate(options) {
  await world({ downtime: 0, iron: 0, fang: 0, perClientDefinitions: true });
  const { gm, testUser } = getUsers();
  const api = getApi();
  api.baseSources = seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }));
  api.editorLeftovers = [];
  installFakeApplication();
  await fakeWindowWorld(options);
  // A real save resolves a moment AFTER the ledger shows the entry (the setting write): the window finishes by resetting its form. The fake models that gap (`saveMs`), so a step that changes a field the moment the ledger changes is caught.
  const realSetEntry = api.tags.setEntry, saveMs = options?.saveMs ?? 400;
  api.tags.setEntry = async (...args) => { const out = await realSetEntry.apply(api.tags, args); await wait(saveMs); return out; };
  const base = { drivers: { gm: makeDomDriver({ as, user: gm }), player: makeDomDriver({ as, user: testUser }) }, state: {}, assert, wait, extras: {} };
  const results = {};
  const play = async (n, who) => { const out = await sink(() => playStep({ script, n, who, base, runBlock: async () => { results[n] = await runBlock(n, who === "player" ? testUser : gm); } })); results[`lines${n}`] = out.lines; return results[n]; };
  const expectPass = async (n, who = "gm") => assert.equal(await play(n, who), "ALL PASS", `step ${n}:\n${results[`lines${n}`].join("\n")}`);
  return { api, gm, testUser, results, play, expectPass };
}

test("GATE 23: SETUP, the scene-controls button, the header button of an ApplicationV2 item sheet, tagging through the window with read-backs, the Player's names-only view, CLEANUP twice", async () => {
  const { api, gm, results, expectPass } = await playGate({});
  await quietly(async () => {
    assert.deepEqual(await runBlock(1, gm), ["GM", true, MODULE_VERSION, true]);
    const setup = await runBlock(2, gm);
    assert.equal(setup.planted.length, 5);
    assert.equal((await runBlock(2, gm)).already, "set up", "SETUP runs twice");
    await expectPass(3);
    assert.match(results.lines3.join("\n"), /"selector":"\[data-tool=\\"pfpItemTags\\"\]"/, "the structure of the scene controls is printed");
    assert.equal([...foundry.applications.instances.keys()].some(k => /pathfinder-progress/.test(k)), false, "Step 3 left no window open");
    await expectPass(4);
    assert.match(results.lines4.join("\n"), /"warning":"Heads up: Copies of this item will not match this tag/);
    assert.equal([...foundry.applications.instances.keys()].some(k => /pathfinder-progress|item-sheet/.test(k)), false, "Step 4 left no window open");
    await expectPass(5);
    assert.match(results.lines5.join("\n"), /"refsOf":\{"candidates":\["Actor\.[^"]+"\],"matched":"Actor\.[^"]+","tags":\["[^"]+"\],"tier":2,"fitsBySlot":\{/, "refsOf is printed whole");
    assert.equal([...foundry.applications.instances.keys()].some(k => /pathfinder-progress/.test(k)), false, "Step 5 left no window open");
    assert.ok(api.definitions.recipe.get("dagger-spider-fang").slots.find(s => s.name === "fang").needs, "the slot need was saved through the window");
    await as(getUsers().testUser, () => api.definitions.refresh({ force: true }));
    await expectPass(6, "player");
    const clean = { problems: [], actorsLeft: 0, ledgerLeft: 0, tagLeft: false, recipeEdited: false, slotNeeds: null, flagLeft: false, windowOpen: false, audit: [] };
    assert.deepEqual(await runBlock(7, gm), clean);
    assert.deepEqual(await runBlock(7, gm), clean, "CLEANUP runs twice");
    await as(getUsers().testUser, () => foundry.applications.instances.get("pathfinder-progress-hub")?.close());
  });
  assert.equal(game.actors.getName("Gate G23 Scout"), undefined);
  assert.equal(api.definitions.material.has("g23-iron"), false);
  assert.deepEqual(Object.keys(await as(gm, () => api.tags.ledger().items)), []);
  assert.equal(api.definitions.recipe.get("dagger-spider-fang").slots.find(s => s.name === "fang").needs, undefined, "the real recipe is back as the pack has it");
});

test("GATE 23 Step 4 on an ApplicationV1 sheet that fires no header hook: a clean FAIL that prints the cause (sheet class, ApplicationV2 or not, the controls and buttons, the registered header hooks), never a throw", async () => {
  const { gm, results, play } = await playGate({ v2: false, v1Hooks: false });
  await quietly(async () => {
    await runBlock(2, gm);
    const out = await play(4, "gm");
    assert.match(out, /FAILED/);
    const line = results.lines4.find(l => /^FAIL: the item sheet shows the module's header button/.test(l));
    assert.ok(line, results.lines4.join("\n"));
    assert.match(line, /"sheetClass":"FakeEquipmentSheet".*"isApplicationV2":false.*"elementIsJQuery":true.*"headerButtonsV1":\["close"\],"headerButtonsDrawn":\[\{"tag":"a","class":"header-button control close".*"headerHooksRegistered":\{[^}]*"getItemSheetHeaderButtons":\d/, "the cause is printed in full");
    await runBlock(7, gm);
  });
});

test("GATE 23 Step 3 without the module's scene-controls button: a clean FAIL that prints every group of the controls and its tools", async () => {
  const { gm, results, play } = await playGate({ button: false });
  await quietly(async () => {
    await runBlock(2, gm);
    assert.match(await play(3, "gm"), /FAILED/);
    const line = results.lines3.find(l => /^FAIL: the module's scene-controls button is drawn/.test(l));
    assert.ok(line, results.lines3.join("\n"));
    assert.match(line, /"found":false,"groups":\{"tokens":\[[^\]]*"pfpItemTags"\]\}/, "the structure of the scene controls is printed");
    await runBlock(7, gm);
  });
});

test("GATE 23 Step 4 on an ApplicationV1 item sheet (jQuery element): the module's button is drawn, clicking it opens the window aimed at the item", async () => {
  const { gm, results, expectPass } = await playGate({ v2: false });
  await quietly(async () => {
    await runBlock(2, gm);
    await expectPass(4);
    assert.match(results.lines4.join("\n"), /"isApplicationV2":false,"elementIsJQuery":true/, "the sheet is printed as V1 with a jQuery element");
    await runBlock(7, gm);
  });
});

test("GATE 23 Step 4: the V1 header button's click opens ONE Item tags window aimed at that sheet's item (V2 too); the report prints both window lists, the returned value and the module's debug lines on a pass", async () => {
  for (const v2 of [false, true]) {
    const { gm, results, play } = await playGate({ v2 });
    await quietly(async () => {
      await runBlock(2, gm);
      assert.equal(await play(4, "gm"), "ALL PASS", results.lines4.join("\n"));
      const report = results.lines4.find(l => /^REPORT what the click did: /.test(l));
      assert.ok(report, "the report is printed on a pass too");
      const data = JSON.parse(report.replace(/^REPORT what the click did: /, ""));
      const t = data.windowsAroundTheClick;
      assert.deepEqual(Object.keys(t), ["before", "0s", "1s", "3s"]);
      assert.equal(t.before.filter(w => /tagger/.test(w.id)).length, 0, "no Item tags window before the click");
      assert.equal(t["3s"].filter(w => w.id === "pathfinder-progress-tagger").length, 1, "exactly one Item tags window");
      assert.equal(t["3s"].find(w => w.id === "pathfinder-progress-tagger").list, "instances");
      assert.equal(data.directCallReturned.type, v2 ? "undefined" : "object");
      if (!v2) assert.equal(data.directCallReturned.constructorName, "TaggerWindow");
      assert.deepEqual(data.openedFor, { name: data.itemExpected.name, uuid: data.itemExpected.uuid }, "the window opened for the sheet's own item");
      const debug = data.consoleDuringBoth.filter(c => c.kind === "console.debug").map(c => c.message).join("\n");
      if (!v2) { assert.match(debug, /Item tags button clicked.*"name":"[^"]+","uuid":"Actor\.[^"]+","type":/); assert.match(debug, /opening the Item tags window with.*"uuid":"Actor\./); assert.match(debug, /finished drawing/); }
      assert.deepEqual(data.consoleDuringBoth.filter(c => c.kind !== "console.debug"), []);
      if (!v2) { assert.equal(data.handler.buttonObjectOnclick, "function"); assert.match(data.drawnButton.attributes.class, /header-button.*pfp-item-tags/); }
      assert.equal([...foundry.applications.instances.keys()].filter(k => /pathfinder-progress/.test(k)).length, 0, "closed again");
      await runBlock(7, gm);
    });
  }
});

test("GATE 23 Step 4: a window that is only in ui.windows (ApplicationV1 list) is found by the check, and the report prints that list", async () => {
  const { gm, results, play } = await playGate({ v2: false });
  const proto = foundry.applications.api.ApplicationV2.prototype, realRender = proto.render;
  await quietly(async () => {
    await runBlock(2, gm);
    ui.windows = {};
    // after the Item tags window draws, move it from foundry.applications.instances to ui.windows, the other place Foundry keeps windows
    proto.render = async function (...args) {
      const out = await realRender.apply(this, args);
      if (this.id === "pathfinder-progress-tagger" && foundry.applications.instances.has(this.id)) { foundry.applications.instances.delete(this.id); ui.windows[9] = this; }
      return out;
    };
    try {
      await play(4, "gm");
      const lines = results.lines4.join("\n");
      assert.match(lines, /PASS: clicking it opens the Item tags window/, lines);
      assert.match(lines, /"list":"ui\.windows","id":"9","cls":"[^"]*","title":"Item tags"/, "the V1 list is printed with the window's class and title");
    } finally { proto.render = realRender; for (const w of Object.values(ui.windows)) await w.close?.(); delete ui.windows; }
    await runBlock(7, gm);
  });
});

test("GATE 23 Step 4: the report prints the drawn class, the button object's class and classList.contains (true), and how long after the draw the click was made; the class is ONE token", async () => {
  const { gm, results, play } = await playGate({ v2: false });
  await quietly(async () => {
    await runBlock(2, gm);
    assert.equal(await play(4, "gm"), "ALL PASS", results.lines4.join("\n"));
    const line = results.lines4.find(l => /^REPORT the button's class and the timing: /.test(l));
    assert.ok(line, results.lines4.join("\n"));
    const c = JSON.parse(line.replace(/^REPORT the button's class and the timing: /, ""));
    assert.equal(c.buttonClassAttribute, "header-button control pfp-item-tags");
    assert.equal(c.buttonObjectClass, "pfp-item-tags");
    assert.doesNotMatch(c.buttonObjectClass, /\s/, "a single token");
    assert.equal(c.classListContainsButtonObjectClass, true);
    assert.ok(c.msSinceDrawAtClick >= 1200, `the click waited for the window's own handlers: ${c.msSinceDrawAtClick} ms`);
    const data = JSON.parse(results.lines4.find(l => /^REPORT what the click did: /.test(l)).replace(/^REPORT what the click did: /, ""));
    assert.equal(data.handler.jqueryClickHandlers, 1);
    await runBlock(7, gm);
  });
});

test("GATE 23 Step 4: when Foundry never binds the header click, the report says so (no handlers, the class check true, the wait) and the step FAILs cleanly", async () => {
  const { gm, results, play } = await playGate({ v2: false, v1BindMs: 600000 });
  await quietly(async () => {
    await runBlock(2, gm);
    assert.match(await play(4, "gm"), /FAILED/);
    const line = results.lines4.find(l => /^FAIL: clicking it opens the Item tags window/.test(l));
    assert.ok(line, results.lines4.join("\n"));
    assert.match(line, /"classCheck":\{"buttonClassAttribute":"header-button control pfp-item-tags","buttonObjectClass":"pfp-item-tags","classListContainsButtonObjectClass":true/);
    assert.match(line, /"jqueryClickHandlers":null/);
    await runBlock(7, gm);
  });
});

test("GATE 23 Step 5: every tab switch is printed whole (tabs offered, tabGroups, active tab, data-field names, the tab active when the field was looked for, page errors); each field is found on its own tab", async () => {
  const { gm, results, expectPass } = await playGate({});
  await quietly(async () => {
    await runBlock(2, gm);
    await expectPass(5);
    const opened = results.lines5.find(l => /^REPORT the window when it opened: /.test(l));
    assert.ok(opened, results.lines5.join("\n"));
    const first = JSON.parse(opened.replace(/^REPORT the window when it opened: /, ""));
    assert.ok(first.tabButtons.length >= 3 && first.tabButtons.every(b => typeof b.tab === "string" && "group" in b));
    assert.ok(Array.isArray(first.dataFields) && first.activeTab === "items");
    for (const [tab, field] of [["tags", "new-tag-name"], ["items", "material"], ["slots", "recipe"]]) {
      const line = results.lines5.find(l => l.startsWith(`REPORT switch to the ${tab} tab: `));
      assert.ok(line, `a report for the ${tab} switch`);
      const d = JSON.parse(line.replace(/^REPORT switch to the [a-z]+ tab: /, ""));
      assert.equal(d.found, true);
      assert.equal(d.activeTabWhenLooked, tab);
      assert.ok(d.after.dataFields.includes(field), `${field} is in the DOM after the switch`);
      assert.deepEqual(d.pageErrors, []);
      assert.ok("tabGroups" in d.before && "tabGroups" in d.after);
    }
    await runBlock(7, gm);
  });
});

test("GATE 23 Step 5: the Source dropdown's options and the source change are printed (redraw, draft source, every data-field), and the save messages are waited for; the item is picked with the Item UUID box", async () => {
  const { gm, results, expectPass } = await playGate({});
  await quietly(async () => {
    await runBlock(2, gm);
    await expectPass(5);
    const lines = results.lines5.join("\n");
    const change = results.lines5.find(l => /^REPORT source changed to item: /.test(l));
    assert.ok(change, lines);
    const d = JSON.parse(change.replace(/^REPORT source changed to item: /, ""));
    assert.deepEqual(d.sourceBefore.options.map(o => o.value), ["material", "item"]);
    assert.ok(d.sourceBefore.options.every(o => o.label.length > 0), "labels are printed");
    assert.equal(d.sourceBefore.value, "material");
    assert.equal(d.sourceAfter.value, "item");
    assert.equal(d.redrew, true);
    assert.equal(d.draftSourceNow, "item");
    assert.ok(d.dataFieldsNow.includes("uuid") && d.dataFieldsNow.includes("name") && d.dataFieldsNow.includes("source"), JSON.stringify(d.dataFieldsNow));
    assert.match(d.pickedWith, /Item UUID/);
    for (const name of ["Gate G23 Iron", "Gate G23 Charm"]) {
      const saved = results.lines5.find(l => l.startsWith(`REPORT the window's save message for ${name}: `));
      assert.ok(saved, `a save report for ${name}`);
      assert.equal(JSON.parse(saved.replace(/^REPORT [^:]+: /, "")).shown, true);
    }
    await runBlock(7, gm);
  });
});
