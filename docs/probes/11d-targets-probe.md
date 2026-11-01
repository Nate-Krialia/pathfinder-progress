# Probe: targets, messages, conditions and persistent damage (before 0.22.0)

**This is a probe, not module code.** No version bump, no release, nothing shipped. You paste snippets into the browser console and paste the short results back. Foundry v14.369, PF2e 8.6.1. The snippets were written without a running Foundry, so **if one throws, paste the error back**; that is a useful answer too.

It answers, for 0.22.0: (a) what PF2e's chat messages hold for a hit, miss, crit, damage, consumable, bomb and spell; (b) how targets appear in a message and whether the GM window can see the roller's targets; (c) the condition API on a token's actor; (d) what a persistent damage term does when damage is applied; (e) whether a worn `FlatModifier` adds persistent poison; (f, optional) an effect with a duration that grants a condition.

Everything is made with throwaway names starting **Gate Probe**. Step 9 removes all of it, and is safe to run twice or after a reload.

**Output rules.** Every line the snippets print is short on purpose, so the console does not fold it at "...". Paste the lines back as plain text.

**What the short names mean in a `dump` line:** `ctx/out` = the message's context type and outcome; the next word = the origin type; then the item (`type:group`); `tg=` the target actor / token ids (last 8 characters); `rt=[..]` the roller's targets as the GM window sees them (A or B); `gm=` how many tokens the GM's own window has targeted.

## Step 1 [GM]: Install the recorder and the helpers

**What to do and see:**
- Open the browser console in the GM window (F12, Console tab).
- Paste the block below and press Enter.
- You should see: `recorder on`.
- Safe to paste again; it replaces the old recorder (the records are cleared).

```js
// [GM] Probe recorder. Stores compact records of every chat message; nothing else is touched.
await (async () => {
  if (globalThis.__p?.hookId) Hooks.off("createChatMessage", globalThis.__p.hookId);
  const sh = u => (u ? String(u).slice(-8) : "-");
  const p = globalThis.__p = { rec: [], t0: game.time.worldTime };
  const find = n => canvas.tokens.placeables.find(t => t.name === `Gate Probe Goblin ${n}`);
  p.hookId = Hooks.on("createChatMessage", m => {
    const f = m.flags?.pf2e ?? {}, c = f.context ?? {}, o = f.origin ?? {}, it = m.item;
    const rt = [...(m.author?.targets ?? [])].map(t => String(t.name).slice(-1)).join("");
    p.rec.push({ id: m.id, i: p.rec.length + 1, who: m.author?.name ?? "?", ctx: c.type ?? "-", out: c.outcome ?? "-", otype: o.type ?? "-", item: it ? `${it.type}${it.system?.group ? ":" + it.system.group : ""}` : "-", tg: `${sh(c.target?.actor)}/${sh(c.target?.token)}`, rt, gm: game.user.targets.size });
  });
  p.dump = (from = 1) => p.rec.filter(r => r.i >= from).forEach(r => console.log(`${r.i} ${r.who.slice(0, 5)} ${r.ctx}/${r.out} ${r.otype} ${r.item} tg=${r.tg} rt=[${r.rt}] gm=${r.gm}`));
  p.show = (i, grep = "") => {   // the PF2e flags of record i, one short line per value
    const m = game.messages.get(p.rec[i - 1]?.id), out = [];
    if (!m) return console.log("no such record");
    const walk = (v, k, d) => {
      if (v && typeof v === "object" && !Array.isArray(v) && d < 4) for (const [kk, vv] of Object.entries(v)) walk(vv, `${k}.${kk}`, d + 1);
      else out.push(`${k}=${Array.isArray(v) ? `[${v.length}]${JSON.stringify(v).slice(0, 40)}` : String(v).slice(0, 50)}`);
    };
    walk(m.flags?.pf2e ?? {}, "pf2e", 0);
    out.filter(l => l.includes(grep)).forEach(l => console.log(l.slice(0, 100)));
  };
  p.rolls = i => {   // the rolls of record i: formula, persistent or not, and the modifiers PF2e listed
    const m = game.messages.get(p.rec[i - 1]?.id);
    if (!m) return console.log("no such record");
    (m.rolls ?? []).forEach((r, k) => {
      console.log(`roll${k} ${r.constructor.name} total=${r.total}`);
      String(r.formula).match(/.{1,90}/g)?.forEach(l => console.log(`  f: ${l}`));
      (r.instances ?? []).forEach(x => console.log(`  inst ${x.type ?? "?"} ${x.persistent ? "PERSISTENT" : "normal"} ${String(x.formula ?? "").slice(0, 50)}`));
    });
    (m.flags?.pf2e?.modifiers ?? []).forEach(x => console.log(`  mod ${String(x.label).slice(0, 28)} ${x.modifier} ${x.damageType ?? "-"} ${x.damageCategory ?? "-"} ${x.enabled ? "on" : "off"}`));
  };
  p.conds = n => {   // a goblin token's actor: hp, conditions (persistent ones with their formula), effects
    const a = find(n)?.actor;
    if (!a) return console.log(`no token ${n}`);
    const c = a.itemTypes.condition.map(x => `${x.slug}${x.value ?? ""}${x.system.persistent ? ":" + x.system.persistent.formula + "/" + x.system.persistent.damageType : ""}`).join(",") || "none";
    console.log(`${n} hp=${a.system.attributes.hp.value} cond=${c}`.slice(0, 100));
    console.log(`${n} eff=${a.itemTypes.effect.map(e => e.name.replace("Gate Probe ", "") + (e.isExpired ? "(expired)" : "")).join(",") || "none"}`);
  };
  p.ac = async n => { for (const x of ["A", "B"]) await game.actors.getName(`Gate Probe Goblin ${x}`)?.update({ "system.attributes.ac.value": n }); console.log(`goblin AC is now ${n}`); };
  p.setRules = async rules => { const sword = game.actors.getName("Gate Probe Hero")?.items.find(i => i.type === "weapon" && /Longsword/.test(i.name)); await sword?.update({ "system.rules": rules }); console.log(`sword rules: ${rules.length}`); };
  p.flat = async withCategory => {   // the worn FlatModifier test: an effect on the Hero
    const hero = game.actors.getName("Gate Probe Hero");
    await hero.deleteEmbeddedDocuments("Item", hero.itemTypes.effect.filter(e => e.name === "Gate Probe Boost").map(e => e.id));
    const rule = { key: "FlatModifier", selector: "damage", damageType: "poison", value: 3, label: "Gate Probe", ...(withCategory ? { damageCategory: "persistent" } : {}) };
    await hero.createEmbeddedDocuments("Item", [{ name: "Gate Probe Boost", type: "effect", img: "icons/svg/aura.svg", system: { slug: "gate-probe-boost", duration: { value: -1, unit: "unlimited", sustained: false, expiry: null }, rules: [rule] } }]);
    console.log(`boost on: poison +3, damageCategory ${withCategory ? "persistent" : "not set"}`);
  };
  p.seen = () => {   // which of the messages we need have been recorded yet
    const has = (ctx, out, item) => p.rec.some(r => r.ctx === ctx && (out === "*" || r.out === out) && (!item || r.item.includes(item)));
    const want = [["strike success", () => has("attack-roll", "success", "melee") || has("attack-roll", "success", "weapon")], ["strike failure", () => has("attack-roll", "failure")], ["strike crit", () => has("attack-roll", "criticalSuccess")], ["strike crit fail", () => has("attack-roll", "criticalFailure")], ["damage roll", () => has("damage-roll", "*")], ["bomb hit", () => has("attack-roll", "success", "bomb") || has("attack-roll", "criticalSuccess", "bomb")], ["bomb miss", () => has("attack-roll", "failure", "bomb") || has("attack-roll", "criticalFailure", "bomb")], ["consumable use", () => p.rec.some(r => r.otype === "consumable")], ["spell", () => p.rec.some(r => r.otype === "spell" || r.ctx === "spell-cast")]];
    want.forEach(([label, ok]) => console.log(`${ok() ? "have" : "NEED"}: ${label}`));
  };
  console.log("recorder on");
})();
```

## Step 2 [GM]: Plant the throwaway cast

**What to do and see:**
- Open the scene you play on and make sure it is the **active** scene (right-click it in the Scenes tab, Activate), so the Player window shows it.
- Paste the block below and press Enter.
- You should see: a short summary line: the Hero, two goblins, and which items were made.
- You should see: three tokens on the scene: **Gate Probe Hero**, **Gate Probe Goblin A** (an *unlinked* token) and **Gate Probe Goblin B** (a *linked* token).
- If it says `Already planted`, run Step 9 (CLEANUP) first.
- If a pack item is "not found", paste the line back; the rest still gets made.

```js
// [GM] PLANT: Gate Probe Hero (owned by the user Test), two goblins and their tokens. Items come from the PF2e packs.
await (async () => {
  if (game.actors.some(a => /^Gate Probe /.test(a.name))) return "Already planted: run Step 9 (CLEANUP) first.";
  if (!canvas.scene) return "Open a scene first.";
  const test = game.users.getName("Test"), made = [];
  const fromPack = async (pack, name) => {
    const index = await game.packs.get(pack).getIndex();
    const entry = index.find(e => e.name === name);
    if (!entry) throw new Error(`${name} not in ${pack}`);
    const data = (await game.packs.get(pack).getDocument(entry._id)).toObject();
    delete data._id;
    return data;
  };
  const hero = await Actor.create({ name: "Gate Probe Hero", type: "character", ownership: { default: 0, ...(test ? { [test.id]: 3 } : {}) }, prototypeToken: { actorLink: true } });
  const tryItem = async (what, fn) => { try { await fn(); made.push(what); } catch (e) { made.push(`${what} FAILED (${e.message.slice(0, 60)})`); } };
  await tryItem("sword", async () => { const d = await fromPack("pf2e.equipment-srd", "Longsword"); d.system.equipped = { carryType: "held", handsHeld: 1, inSlot: false }; await hero.createEmbeddedDocuments("Item", [d]); });
  await tryItem("bomb", async () => { const d = await fromPack("pf2e.equipment-srd", "Alchemist's Fire (Lesser)"); d.system.quantity = 20; d.system.equipped = { carryType: "held", handsHeld: 1, inSlot: false }; await hero.createEmbeddedDocuments("Item", [d]); });
  await tryItem("potion", async () => { const d = await fromPack("pf2e.equipment-srd", "Healing Potion (Minor)"); d.system.quantity = 5; await hero.createEmbeddedDocuments("Item", [d]); });
  await tryItem("spell", async () => {
    const [entry] = await hero.createEmbeddedDocuments("Item", [{ name: "Gate Probe Casting", type: "spellcastingEntry", system: { ability: { value: "int" }, tradition: { value: "arcane" }, prepared: { value: "spontaneous" }, proficiency: { value: 1 } } }]);
    const d = await fromPack("pf2e.spells-srd", "Electric Arc");
    d.system.location = { value: entry.id };
    await hero.createEmbeddedDocuments("Item", [d]);
  });
  const goblin = (n, linked) => Actor.create({ name: `Gate Probe Goblin ${n}`, type: "npc", system: { attributes: { hp: { value: 60, max: 60 }, ac: { value: 12 } } }, prototypeToken: { actorLink: linked } });
  const a = await goblin("A", false), b = await goblin("B", true);
  const s = canvas.grid.size, x0 = canvas.dimensions.sceneX + s * 3, y0 = canvas.dimensions.sceneY + s * 3;
  const docs = [];
  for (const [actor, dx] of [[hero, 0], [a, 3], [b, 6]]) docs.push((await actor.getTokenDocument({ x: x0 + dx * s, y: y0 })).toObject());
  await canvas.scene.createEmbeddedDocuments("Token", docs);
  return `planted: Hero, Goblin A (unlinked token), Goblin B (linked token). Items: ${made.join("; ")}`;
})();
```

## Step 3 (a, b): Strikes with 0, 1 and 2 targets

**What to do and see:**
- In the **Player** window (user Test), open the Actors tab and open **Gate Probe Hero**.
- Open the **Actions** tab (Strikes). You should see the Longsword and the Alchemist's Fire.
- Close the sheet or move it aside so the canvas is visible.
- Click the Hero token on the canvas so it is controlled.
- **0 targets:** make sure no token is targeted (no red marks). On the sheet, click the Longsword's **Strike** button. Do it once.
- **1 target:** click **Goblin A** on the canvas and press **T** (a target mark appears). Click Strike again, twice.
- **2 targets:** also click **Goblin B** and press **T** (so A and B are both targeted). Click Strike once.
- Back in the **GM** window, paste the line below and press Enter.
- You should see: one line per chat message so far.
- For the 0-target Strike: `tg=-/-`. For the 1-target Strikes: `tg=` shows ids. Check `rt=[A]`, then `rt=[AB]` for the two-target Strike.
- **The key question:** is `rt` filled in while `gm=0`? If yes, the GM window can see the roller's targets.
- Paste back the whole dump.

```js
__p.dump();
```

- If the 2-target Strike line shows only one `tg=` id, that means the message holds one target even with two selected. To see all the target-related values, run the next line with the number of that record (the number at the start of its dump line):

```js
__p.show(1, "target");
```

## Step 4 (a): Collect every outcome the module needs

**What to do and see:**
- In the **GM** window, paste the line below and press Enter.
- You should see: a list of `have:` and `NEED:` lines.
- To get a hit, set the goblins' AC low. To get a miss or a critical failure, set it high (paste one of the two lines below as needed).
- Keep Goblin A targeted. In the **Player** window click **Strike** with the Longsword until the list shows `have: strike success`, `strike failure`, `strike crit` and `strike crit fail` (change the AC between tries; the Hero is untrained, so a high AC gives critical failures and AC 12 to 14 gives a mix).
- Then in the **Player** window, on the Actions tab, click the **Alchemist's Fire** strike (a throw) with Goblin A targeted, until you have both a bomb hit and a bomb miss.
- In the **Player** window, on a chat card where the Strike hit, click **Damage**. Do it once. On a card with a critical hit, click **Critical** damage. You need at least one damage roll.
- In the **Player** window, open the **Inventory** tab, find **Healing Potion (Minor)**, and click its **Use** (hand) button. Confirm any prompt.
- In the **Player** window, open the **Spells** tab and cast **Electric Arc** (click it). If a dialog asks for targets or a rank, accept the default. If casting fails, paste the error and skip this one.
- You should see, after all of that, `have:` on every line of `__p.seen()`.

```js
__p.seen();
```

```js
await __p.ac(1);    // goblins are very easy to hit
```

```js
await __p.ac(40);   // goblins are almost impossible to hit
```

```js
await __p.ac(12);   // a middle value
```

- When the checklist is full, paste back the full dump (it may be about 20 lines):

```js
__p.dump();
```

- Then pick one line of each kind and show its flags, one at a time, pasting back what appears. Use the record number from the start of the line. The five kinds: a Strike hit, a Damage roll, the consumable use, the bomb throw, the spell:

```js
__p.show(1);   // change 1 to the record number
```

## Step 5 (c): The condition API on a token's actor

**What to do and see:**
- Make sure you have **not** deleted the tokens. **Do not select anything.**
- In the **GM** window, paste the block below and press Enter.
- You should see: first `missing slugs: none` (or a list; paste it back), then a short line per call for Goblin A (the unlinked token) and then for Goblin B (the linked token).
- Each line reads: the call, what it returned, then `f=` the token actor's frightened value, `p=` its prone, and `w=` frightened on the **world** actor (the Actors sidebar one).
- You should see for Goblin A that `f` changes but `w` stays `none` (an unlinked token has its own copy). For Goblin B the two should match.
- Paste back all the lines.

```js
// [GM] Condition API on a token's actor. Changes only the Gate Probe goblins.
await (async () => {
  const want = ["frightened", "sickened", "clumsy", "enfeebled", "stupefied", "slowed", "off-guard", "prone", "dazzled", "fatigued"];
  console.log(`missing slugs: ${want.filter(s => !(s in CONFIG.PF2E.conditionTypes)).join(",") || "none"}`);
  const tok = n => canvas.tokens.placeables.find(t => t.name === `Gate Probe Goblin ${n}`);
  const cur = (a, slug) => { const c = a?.getCondition?.(slug); return c ? `${c.value ?? "y"}` : "-"; };
  const what = r => (r === null ? "null" : r === undefined ? "undef" : `${r.constructor?.name ?? typeof r}:${r.slug ?? ""}${r.value ?? ""}`);
  for (const n of ["A", "B"]) {
    const t = tok(n), a = t.actor, world = game.actors.get(t.document.actorId);
    console.log(`${n} linked=${t.document.actorLink} isToken=${a.isToken} sameObj=${a === world}`);
    const run = async (label, fn) => {
      let r;
      try { r = what(await fn()); } catch (e) { r = `ERR ${e.message.slice(0, 40)}`; }
      console.log(`${n} ${label} -> ${r} f=${cur(a, "frightened")} p=${cur(a, "prone")} w=${cur(world, "frightened")}`.slice(0, 100));
    };
    await run("inc fright", () => a.increaseCondition("frightened"));
    await run("inc fright v3", () => a.increaseCondition("frightened", { value: 3 }));
    await run("inc fright v5", () => a.increaseCondition("frightened", { value: 5 }));
    await run("inc v6 max4", () => a.increaseCondition("frightened", { value: 6, max: 4 }));
    await run("dec fright", () => a.decreaseCondition("frightened"));
    await run("toggle fright", () => a.toggleCondition("frightened"));
    await run("toggle fright 2", () => a.toggleCondition("frightened"));
    await run("dec force", () => a.decreaseCondition("frightened", { forceRemove: true }));
    await run("inc prone", () => a.increaseCondition("prone"));
    await run("inc prone again", () => a.increaseCondition("prone"));
    await run("inc prone v3", () => a.increaseCondition("prone", { value: 3 }));
    await run("toggle prone", () => a.toggleCondition("prone"));
    await run("toggle prone 2", () => a.toggleCondition("prone"));
    await run("dec prone", () => a.decreaseCondition("prone"));
    await run("dec prone force", () => a.decreaseCondition("prone", { forceRemove: true }));
  }
})();
```

## Step 6 (d): Persistent damage through the damage card

**What to do and see:**
- In the **GM** window, paste the block below and press Enter.
- You should see: `sword rules: 1`. The Hero's Longsword now carries a `DamageDice` rule with category persistent: 1d6 persistent poison (the same shape the module writes today).
- In the **Player** window, make sure only **Goblin A** is targeted and the Hero token is controlled. Set the goblins' AC low first (`await __p.ac(1)` in the GM window).
- Click the Longsword **Strike** until it hits, then click **Damage** on that card.
- In the **GM** window, run `__p.dump(N)` where N is the record number just after your last dump (the count so far: `__p.rec.length`). The newest line should be `damage-roll`.
- Run `__p.rolls(R)` with that record number R. You should see the formula, and one `inst` line per damage term, saying PERSISTENT or normal. Paste back the lines. **Question: is the poison term listed as PERSISTENT?**
- Now apply it: in the **GM** window, click the **Goblin A** token on the canvas so it is selected.
- On the damage chat card, click the **full damage** (heart/shield) button. If the card has a separate persistent or "apply persistent" button, click that too and tell me it exists.
- Run `__p.conds("A")` before and after those clicks.
- You should see: `hp=` went down, and `cond=` either still `none` or it now lists `persistent-damage:1d6/poison`.
- Paste back both `conds` lines and the `rolls` output.

```js
await __p.setRules([{ key: "DamageDice", selector: "{item|_id}-damage", diceNumber: 1, dieSize: "d6", damageType: "poison", category: "persistent", label: "Gate Probe" }]);
```

```js
__p.rec.length;   // the number of messages so far
```

```js
__p.conds("A");
```

## Step 7 (e): A worn FlatModifier for persistent poison

**What to do and see:**
- In the **GM** window, paste the first line below and press Enter. It removes the sword's own rule so only the worn effect is tested. You should see: `sword rules: 0`.
- Paste the second line. You should see: `boost on: poison +3, damageCategory persistent`.
- In the **Player** window, with Goblin A targeted and AC low, click the Longsword **Strike** until it hits, then click **Damage**.
- In the **GM** window, run `__p.rolls(N)` for that damage message (the newest `damage-roll`; use `__p.dump(__p.rec.length - 3)` to find it).
- You should see: `mod Gate Probe 3 poison persistent on` among the `mod` lines (or not; that is the answer), and the formula, plus whether an `inst` line says PERSISTENT.
- Paste the third line (no category), then repeat the Strike and Damage in the Player window, and run `__p.rolls(N)` again for the new message.
- Paste back both `rolls` outputs, and say which one showed persistent poison.

```js
await __p.setRules([]);
```

```js
await __p.flat(true);
```

```js
await __p.flat(false);
```

## Step 8 (f, optional): An effect that expires and grants a condition

**Skip this step if you do not want the world clock to move 90 seconds.** Step 9 tries to put the clock back.

**What to do and see:**
- In the **GM** window, paste the block below and press Enter.
- You should see: a creation line, then `before:` showing `cond=frightened2` and an effect, then `after:` showing whether the effect and the condition are gone.
- Paste back the lines. **Questions: did the condition appear at value 2? Did it disappear after 90 seconds? Is the effect `(expired)` or gone?**

```js
// [GM] Optional: a 1-minute effect on Goblin A that grants Frightened 2; then the world clock moves 90 seconds.
await (async () => {
  const a = canvas.tokens.placeables.find(t => t.name === "Gate Probe Goblin A")?.actor;
  if (!a) return "no Goblin A token";
  const index = await game.packs.get("pf2e.conditionitems").getIndex();
  const frightened = index.find(e => e.name === "Frightened");
  if (!frightened) return "Frightened not found in pf2e.conditionitems";
  const uuid = `Compendium.pf2e.conditionitems.Item.${frightened._id}`;
  await a.createEmbeddedDocuments("Item", [{ name: "Gate Probe Fright", type: "effect", img: "icons/svg/aura.svg", system: { slug: "gate-probe-fright", duration: { value: 1, unit: "minutes", sustained: false, expiry: null }, rules: [{ key: "GrantItem", uuid, alterations: [{ mode: "override", property: "badge-value", value: 2 }] }] } }]);
  console.log("created the effect");
  await new Promise(r => setTimeout(r, 1500));
  console.log("before:"); __p.conds("A");
  await game.time.advance(90);
  await new Promise(r => setTimeout(r, 3000));
  console.log("after:"); __p.conds("A");
})();
```

## Step 9 [GM]: CLEANUP (always safe, also after a reload)

**What to do and see:**
- Paste the block below in the **GM** window and press Enter. Run it twice if you like.
- You should see: `problems: []` and every `...Left` count `0`.
- It removes the Gate Probe actors, their tokens and chat messages, switches the recorder off, and puts the world clock back if Step 8 moved it. It works even after a reload (then the recorder is already gone).

```js
// [GM] CLEANUP: deletes everything the probe made. Safe to run twice and safe after a reload.
await (async () => {
  const p = globalThis.__p, problems = [];
  const attempt = async (what, fn) => { try { await fn(); } catch (e) { problems.push(`${what}: ${e.message}`); } };
  if (p?.hookId) Hooks.off("createChatMessage", p.hookId);
  const actors = game.actors.filter(a => /^Gate Probe /.test(a.name)), ids = new Set(actors.map(a => a.id));
  await attempt("tokens", async () => {
    for (const scene of game.scenes) {
      const del = scene.tokens.filter(t => ids.has(t.actorId) || /^Gate Probe /.test(t.name)).map(t => t.id);
      if (del.length) await scene.deleteEmbeddedDocuments("Token", del);
    }
  });
  await attempt("messages", async () => {
    const del = game.messages.filter(m => ids.has(m.speaker?.actor) || /^Gate Probe /.test(m.speaker?.alias ?? "")).map(m => m.id);
    if (del.length) await ChatMessage.deleteDocuments(del);
  });
  for (const a of actors) await attempt(`delete ${a.name}`, () => a.delete());
  await attempt("world time", async () => { if (p?.t0 !== undefined && game.time.worldTime !== p.t0) await game.time.advanceTo(p.t0); });
  delete globalThis.__p;
  return {
    problems,
    actorsLeft: game.actors.filter(a => /^Gate Probe /.test(a.name)).length,
    tokensLeft: game.scenes.reduce((n, s) => n + s.tokens.filter(t => /^Gate Probe /.test(t.name)).length, 0),
    itemsLeft: game.items.filter(i => /^Gate Probe /.test(i.name)).length
  };
})();
```

## What I will do with the answers

| Probe | Settles |
|---|---|
| Steps 3 and 4 | Which message and which fields the GM hook reads for a hit, a bomb throw, a use card, and the fallback card for the rest |
| Step 3 `rt=` | Whether the GM window can read the roller's targets, or only the message context |
| Step 5 | The exact condition calls, their return values, the value cap, and that `token.actor` is the right actor |
| Step 6 | Whether persistent poison from Add damage already makes a condition on the target |
| Step 7 | Whether the trinket's `wornDamage` can be persistent, and with which rule fields |
| Step 8 | Whether a timed condition is cheap enough to offer after 0.22.0 |
