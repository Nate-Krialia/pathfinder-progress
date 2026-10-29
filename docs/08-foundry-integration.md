# 08 Foundry Integration & UI

## Targets
Confirm the Foundry and PF2e system versions with the user before building. Use ApplicationV2 for all windows and socketlib for socket relay.

## PF2e adapter
Materials are **real PF2e Items** (treasure/equipment) with module flags (`materialId`, `tier`). All reading of PF2e items, actors, level DCs, and creature level/traits goes through ONE adapter file. A PF2e update should only break that file.

## Permissions and sockets
Players cannot write world settings, scenes, or compendiums. Actions that need those writes (gathering charges on scene tokens, commissions in the world list, exploration scene prep) are relayed to the **active GM client** via socketlib. Hidden rung rolls and loss rolls run there too.

## What a player client loads (Stage 16, v0.16.0)
A player client reads **no definition pack** (both packs are hidden from players' interface, an honor system, not secrecy: see `docs/10`). The GM client sends each player only what their characters need, over one more guarded socket handler, `definitionsFor`.
- **Who is asking.** The handler uses `this.socketdata.userId`, which socketlib fills from Foundry's own socket event (the sender), and ignores the `userId` in the payload. Only a direct call on a GM client (no socketdata) falls back to the payload's id. A GM caller is refused ("The GM client loads every definition itself"). The characters are those the caller owns at Owner level.
- **What is sent.** Recipes the character holds a formula for (own and loaned); blueprints they hold or are designing; materials in their inventory, their Compendium (own, and the party's if they are in the party), an active project's escrow or a queued action; stations in the party's town, in the town of any workshop they own or the party built, named in a saved station state for their characters, or the subject of their upgrade project; the towns those stations stand in; regions whose scene tag is on a scene one of their characters has a token on, or that they are viewing; node types of revealed nodes on those scenes. Plus the resolved output items and `uncraftable` ids for those recipes, and which held formulas have no recipe at all on the GM (`missingRecipes`).
- **What is stripped.** A region loses `spawnTable`; a node type loses `ladders` and `charges`. Everything else is sent whole. A region's `explorationDC` is deliberately NOT stripped: `api.queue.list()` is not GM-gated and already shows it (with the odds) in an explore row's text, so stripping it would only turn that text into "DC undefined"; gating that row is a Stage 11 question. The player copy is validated against a strict player schema, so a record that still carried a stripped field is rejected. The GM's records are never touched.
- **What is not sent.** Recipes the character does not hold, blueprints not yet designed (whether the Hub should show a designer a "known to exist" list is an **open Stage 11 question**; nothing is built for it), other regions, other towns' stations, unmet materials, every spawn table and ladder. Corpse yield tables live in token flags, not definitions, so they are not covered by this.
- **When it reloads.** At load, then (debounced 300 ms, and only if the facts that decide the set changed, or the GM's revision changed) on: an owned character's formulas, blueprints, projects, queue, Compendium, stations or location flag changing; a character's ownership changing; a material item created or deleted on an owned character; the user's character changing; a scene's flags, the viewed scene, or tokens changing; the party location, station state, party workshops, shared Compendium or `definitionsRevision` settings changing; a GM connecting. `definitionsRevision` is a world setting the GM client writes after `api.reload()` (and with `api.publishDefinitions()`) only when the registry really changed. Nothing recomputes per render: `previewCraft` and the rest read the loaded registry directly.
- **Messages.** A character that does not hold a formula: "`<name>` does not know this formula." (whether or not the recipe exists). Held but the recipe exists nowhere (the GM says so): "holds an orphaned formula for this ...". Not loaded yet / no GM: "Your recipes are still loading ..." / "The GM isn't connected ...". An explore submit for a region not in play: refused plainly after one fresh ask to the GM. Anything a player client cannot check is relayed to the GM, whose validation is authoritative (craft, gather, share, build, upgrade and design all already are).
- **GM clients are unchanged**: they still load every pack, and `api.definitions.refresh()` on a GM returns at once.

## Offline queue (players submit any time)
Sockets only reach online clients, so the queue lives in data players can write:
1. Each player's actor has a `pendingActions` flag.
2. Days are **reserved at submission** (cannot over-book).
3. On GM login, the module scans all actors and lists pending actions.
4. **GM reviews first**: a GM window lists pending actions with "Resolve all" plus edit/reject per row. Resolution runs in submission order via the GM client.
5. Resolving an expedition **prepares** the scene only; the GM launches it.
6. Commissions are two queued steps in player-to-player flow (patron submits, crafter accepts).
7. Players receive a results summary per resolved action.

## UI surfaces
**Player: Downtime Hub** (standalone ApplicationV2 window, opened from a button; optionally a header button on the PF2e sheet later). Tabs: Research, Explore, Commissions, Workshop, Formulas. Shows day budget and queue.

**Gather dialog**: opened by clicking a node token in the scene; small dialog for skill choice and roll.

**GM tools**
- Review queue window (see above).
- Commission creator form: patron name, item, `materialsFrom`, payout, `teaches`.
- Definitions are edited directly in the compendium packs (no custom editor).
- GM-only "Save to compendium" button on crafted item sheets.
- Anchor placement: GM drops hidden node tokens on scenes.

## Tokens
Nodes (anchors, active nodes, corpses) are tokens with flags. Hidden tokens are anchors; activation unhides them. Filter node tokens from the combat tracker and token lists.
