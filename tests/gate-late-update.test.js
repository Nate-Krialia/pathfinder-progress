/**
 * A Player window reads the GM's write as a LATER update (real Foundry: the update message arrives after the GM client's write resolved).
 * Gate steps that run on the Player's window straight after a GM step must wait for it (the steps' p.until), not read at once.
 * The fake models the late update with `enableEcho` (fake-world.js): the player's reads of the actor's flags are refreshed `delay` ms after a write.
 *
 * Each case plays the real gate blocks up to the GM step, switches the echo on for the Player's character, runs the GM step, then runs the
 * Player step AT ONCE. The step as written must pass; the same step with its wait taken out must fail (the mutation the tests below prove).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { as, enableEcho, fireHookAs, getApi, getUsers, M, makeRegistry, quietly, world } from "./fake-world.js";

/** A gate doc's blocks by step number, run like a browser console (top-level await wrapped, the last expression is the value). */
function gateBlocks(file) {
  const doc = readFileSync(file, "utf8");
  const steps = new Map();
  for (const match of doc.matchAll(/^## Step (\d+) ((?:\[[^\]]+\](?: and )?)+)[^\n]*\n([\s\S]*?)(?=^## Step |(?![\s\S]))/gm)) {
    steps.set(Number(match[1]), match[3].match(/```js\n([\s\S]*?)```/)?.[1] ?? null);
  }
  return steps;
}
const wrap = code => code.replace(/^(\/\/[^\n]*\n)*\s*await \(/, match => match.replace("await (", "("));

/** Run a block as a user, collecting every console line it prints. Returns { value, lines }. */
async function runCollecting(code, user) {
  const lines = [];
  const saved = console.log;
  console.log = (...args) => lines.push(args.map(String).join(" "));
  try { const value = await as(user, () => (0, eval)(wrap(code))); return { value, lines: lines.flatMap(l => l.split("\n")) }; } finally { console.log = saved; }
}

// ---- gate 14 -------------------------------------------------------------------------------------------------------------------------------
const GATE14 = gateBlocks("docs/14-stage10bc-gate.md");

/** Play gate 14 up to (not including) `stopBefore`, each step as the client that owns it. Returns what the late-update cases need. */
async function playGate14({ stopBefore, echoFrom, delay = 250, hold = false }) {
  const w = await world({ downtime: 0, iron: 0, fang: 0, perClientDefinitions: true });
  const api = getApi();
  const { gm, testUser } = getUsers();
  const WHO_GM = new Set([5, 7, 9, 11, 13]);        // the GM steps before step 14
  let echo = null;
  await quietly(async () => {
    await as(gm, () => (0, eval)(wrap(GATE14.get(2))));
    await as(testUser, () => (0, eval)(wrap(GATE14.get(3))));
    for (let step = 4; step < stopBefore; step++) {
      if (step === 9) { api.definitions = makeRegistry(); delete globalThis.__g2; await as(gm, () => (0, eval)(wrap(GATE14.get(2)))); }
      if (step === echoFrom) { echo = enableEcho(game.actors.getName("Gate Smith"), testUser, delay); echo.held = hold; }
      const user = WHO_GM.has(step) ? gm : testUser;
      if (!user.isGM && globalThis.__p2) await as(user, () => api.definitions.refresh());
      const { value, lines } = await runCollecting(GATE14.get(step), user);
      assert.equal(value, "ALL PASS", `step ${step}: ${lines.filter(l => l.startsWith("FAIL")).join("\n")}`);
    }
  });
  return { w, api, gm, testUser, echo };
}

const finish = () => { delete globalThis.__p2; delete globalThis.__g2; };

test("GATE 14 step 14: the Player's window gets the GM's approve and reject later; the step waits for it, prints what it first held, and says how long it waited", async () => {
  const { api, testUser, echo } = await playGate14({ stopBefore: 14, echoFrom: 13, delay: 250 });
  try {
    const smith = game.actors.getName("Gate Smith");
    const player = await runCollecting(GATE14.get(14), testUser);
    assert.equal(player.value, "ALL PASS", player.lines.join("\n"));
    const report = player.lines.find(l => l.startsWith("REPORT pending at first read:"));
    assert.ok(report, "the REPORT line is printed");
    const first = JSON.parse(report.slice("REPORT pending at first read: ".length));
    assert.deepEqual(first.map(a => [a.type, a.key]).sort(), [["share", "g2-ore"], ["share", "g2-wood"]], "the first read still held both shares (the update had not arrived)");
    assert.ok(first.every(a => typeof a.id === "string" && a.id));
    const pass = player.lines.find(l => /^PASS: no share is waiting/.test(l));
    assert.match(pass, /waited \d+ ms for the update/);
    assert.ok(Number(/waited (\d+) ms/.exec(pass)[1]) > 0, "it really waited");
    assert.equal(smith.getFlag("pathfinder-progress", "pendingActions").filter(a => a.type === "share").length, 0);
    void api;
  } finally { finish(); }
});

test("GATE 14 step 14, mutation: the same step with the wait taken out FAILS on the late update (no share is waiting)", async () => {
  const { testUser } = await playGate14({ stopBefore: 14, echoFrom: 13, delay: 250 });
  try {
    const noWait = GATE14.get(14).replace(/const noShare = await p\.until\([^\n]*\n/, "const noShare = !p.pending().some(a => a.type === \"share\");\n");
    assert.notEqual(noWait, GATE14.get(14), "the mutation changed the block");
    const player = await runCollecting(noWait, testUser);
    assert.notEqual(player.value, "ALL PASS");
    assert.ok(player.lines.some(l => /^FAIL: no share is waiting/.test(l)), player.lines.join("\n"));
  } finally { finish(); }
});

test("GATE 14 step 14: if the update never arrives the step FAILS and prints every pending action left (id, type, key), the character and the user", async () => {
  const { testUser } = await playGate14({ stopBefore: 14, echoFrom: 13, hold: true });   // the update is never delivered
  try {
    const player = await runCollecting(GATE14.get(14), testUser);
    assert.notEqual(player.value, "ALL PASS");
    const fail = player.lines.find(l => /^FAIL: no share is waiting/.test(l));
    assert.ok(fail, player.lines.join("\n"));
    assert.match(fail, /still pending after \d+ ms/);
    const detail = JSON.parse(/ms: (\{.*\})\)$/.exec(fail)[1]);
    assert.equal(detail.character, "Gate Smith");
    assert.equal(detail.user, "Test");
    assert.deepEqual(detail.pending.map(a => [a.type, a.key]).sort(), [["share", "g2-ore"], ["share", "g2-wood"]]);
    assert.ok(detail.pending.every(a => a.id));
  } finally { finish(); }
}, { timeout: 20000 });

test("GATE 14 step 8: the region the GM's expedition recorded reaches the Player's window later; the step waits for it (and fails without the wait)", async () => {
  const { testUser } = await playGate14({ stopBefore: 8, echoFrom: 7, delay: 250 });
  try {
    const smith = game.actors.getName("Gate Smith");
    const withWait = await runCollecting(GATE14.get(8), testUser);
    assert.equal(withWait.value, "ALL PASS", withWait.lines.join("\n"));
    assert.ok(smith.getFlag("pathfinder-progress", "compendium").regions["g2-wood"], "the region really was recorded");
  } finally { finish(); }
  const again = await playGate14({ stopBefore: 8, echoFrom: 7, delay: 250 });
  try {
    const noWait = GATE14.get(8).replace(/  await p\.until\([^\n]*\n/, "");
    assert.notEqual(noWait, GATE14.get(8), "the mutation changed the block");
    const player = await runCollecting(noWait, again.testUser);
    assert.notEqual(player.value, "ALL PASS");
    assert.ok(player.lines.some(l => /^FAIL: 2 materials, 1 creature, 1 region/.test(l)), player.lines.join("\n"));
  } finally { finish(); }
});

// ---- gate 13 -------------------------------------------------------------------------------------------------------------------------------
const GATE13 = gateBlocks("docs/13-stage10a-gate.md");

/** Play gate 13 up to (not including) `stopBefore` (the step order is the one tests/work-wiring.test.js plays). */
async function playGate13({ stopBefore, echoFrom, echoActor, delay = 250 }) {
  const w = await world({ downtime: 0, iron: 0, fang: 0 });
  const api = getApi();
  const { gm, testUser } = getUsers();
  const ORDER = [[4, testUser], [5, gm], [6, testUser], [7, testUser], [8, testUser], [9, gm], [10, testUser], [11, gm], [12, testUser], [13, gm], [14, testUser], [15, testUser], [16, gm], [17, gm], [18, testUser]];
  await quietly(async () => {
    await as(gm, () => (0, eval)(wrap(GATE13.get(2))));
    await as(testUser, () => (0, eval)(wrap(GATE13.get(3))));
    for (const [step, user] of ORDER) {
      if (step >= stopBefore) break;
      if (step === 9) { api.definitions = makeRegistry(); delete globalThis.__gate; await as(gm, () => (0, eval)(wrap(GATE13.get(2)))); }
      if (step === echoFrom) enableEcho(game.actors.getName(echoActor), testUser, delay);
      const { value, lines } = await runCollecting(GATE13.get(step), user);
      assert.equal(value, "ALL PASS", `gate 13 step ${step}: ${lines.filter(l => l.startsWith("FAIL")).join("\n")}`);
    }
  });
  return { w, testUser };
}
const finish13 = () => { delete globalThis.__p; delete globalThis.__gate; };

test("GATE 13 step 18: Gate Absent's queued gather, put there by the GM's step 17, reaches the Player's window later; the step waits for it (and fails without the wait)", async () => {
  const { testUser } = await playGate13({ stopBefore: 18, echoFrom: 17, echoActor: "Gate Absent" });
  try {
    const player = await runCollecting(GATE13.get(18), testUser);
    assert.equal(player.value, "ALL PASS", player.lines.join("\n"));
  } finally { finish13(); }
  const again = await playGate13({ stopBefore: 18, echoFrom: 17, echoActor: "Gate Absent" });
  try {
    const noWait = GATE13.get(18).replace(/  const patience = [^\n]*\n  while \([^\n]*\n/, "");
    assert.notEqual(noWait, GATE13.get(18), "the mutation changed the block");
    const player = await runCollecting(noWait, again.testUser);
    assert.notEqual(player.value, "ALL PASS");
    assert.ok(player.lines.some(l => /^FAIL: Gate Absent has a queued gather to try to cancel/.test(l)), player.lines.join("\n"));
  } finally { finish13(); }
});

// ---- gate 16 -------------------------------------------------------------------------------------------------------------------------------
const GATE16 = gateBlocks("docs/16-stage10d-gate.md");
const roll16 = (degree, total, natural) => ({ options: { degreeOfSuccess: degree }, total, dice: [{ faces: 20, results: [{ result: natural, active: true }] }] });

/** Play gate 16 up to (not including) `stopBefore`, as tests/gate16.test.js plays it (steps 7 and 9 and 17 have their own fake-side work). */
async function playGate16({ stopBefore, echoFrom, echoActor, delay = 250 }) {
  const w = await world({ downtime: 0, iron: 0, fang: 0, perClientDefinitions: true });
  const api = getApi();
  const { gm, testUser } = getUsers();
  const GM_STEPS = new Set([5, 7, 11, 13, 17, 19]);
  await quietly(async () => {
    await as(gm, () => (0, eval)(wrap(GATE16.get(2))));
    await as(testUser, () => (0, eval)(wrap(GATE16.get(3))));
    for (let step = 4; step < stopBefore; step++) {
      if (step === 9) { api.definitions = makeRegistry(); delete globalThis.__g4; await as(gm, () => (0, eval)(wrap(GATE16.get(2)))); }
      if (step === echoFrom) enableEcho(game.actors.getName(echoActor), testUser, delay);
      const user = GM_STEPS.has(step) ? gm : testUser;
      if (!user.isGM && globalThis.__p4) await as(user, () => api.definitions.refresh());
      if (step === 7) game.actors.getName("Gate Smith").rolls.push(roll16(2, 22, 12));
      const { value, lines } = await runCollecting(GATE16.get(step), user);
      assert.equal(value, "ALL PASS", `gate 16 step ${step}: ${lines.filter(l => l.startsWith("FAIL")).join("\n")}`);
      if (step === 17) await fireHookAs(testUser, "updateActor", [game.actors.getName("Gate Friend")], { flags: { [M]: { formulas: [] } } });
    }
  });
  return { testUser };
}
const finish16 = () => { delete globalThis.__p4; delete globalThis.__g4; };

test("GATE 16 step 14: what the GM's step 13 craft taught reaches the Player's window later; the step waits for it (and fails without the wait)", async () => {
  const { testUser } = await playGate16({ stopBefore: 14, echoFrom: 13, echoActor: "Gate Smith" });
  try {
    const player = await runCollecting(GATE16.get(14), testUser);
    assert.equal(player.value, "ALL PASS", player.lines.join("\n"));
  } finally { finish16(); }
  const again = await playGate16({ stopBefore: 14, echoFrom: 13, echoActor: "Gate Smith" });
  try {
    const noWait = GATE16.get(14).replace(/  await p\.until\([^\n]*\n/, "");
    assert.notEqual(noWait, GATE16.get(14), "the mutation changed the block");
    const player = await runCollecting(noWait, again.testUser);
    assert.notEqual(player.value, "ALL PASS");
    assert.ok(player.lines.some(l => /^FAIL: both effects are known, learned by crafting/.test(l)), player.lines.join("\n"));
  } finally { finish16(); }
});

test("GATE 16 step 20: the Gate Axe entry the GM's step 19 research made reaches the Player's window later; the step waits for it (and fails without the wait)", async () => {
  const { testUser } = await playGate16({ stopBefore: 20, echoFrom: 19, echoActor: "Gate Friend" });
  try {
    const player = await runCollecting(GATE16.get(20), testUser);
    assert.equal(player.value, "ALL PASS", player.lines.join("\n"));
  } finally { finish16(); }
  const again = await playGate16({ stopBefore: 20, echoFrom: 19, echoActor: "Gate Friend" });
  try {
    const noWait = GATE16.get(20).replace(/  await p\.until\([^\n]*\n/, "");
    assert.notEqual(noWait, GATE16.get(20), "the mutation changed the block");
    const player = await runCollecting(noWait, again.testUser);
    assert.notEqual(player.value, "ALL PASS");
    assert.ok(player.lines.some(l => /^FAIL: the Gate Axe entry exists with its baseline/.test(l)), player.lines.join("\n"));
  } finally { finish16(); }
});
