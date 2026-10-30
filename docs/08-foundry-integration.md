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
- **What is stripped (Stage 10d, `docs/11b-hub-addendum.md`: nothing a player holds carries a DC, an effect or a percentage).** The player copy of each kind has EXACTLY these fields; it is validated against a strict player schema, so a record that still carried anything else is rejected, and the GM's records are never touched.
  - **recipe**: `kind, id, name, category, baseRole?, slots[{name, drives, tierFloor, qty}], stationCategory, stationTierMin, skillWhitelist, days{default, byStation}`. `days` is worked out on the GM (craft level, the station's craft-day upgrades, the 1-day floor), so the copy needs no `craftLevel`. No `overrides`, `output`, `resultName`, `itemTemplate`, `researchProject`, `craftLevel` or per-slot `lossChance`; the resolved output items are not sent either.
  - **material**: `kind, id, name, tier, value?`. No `effects`, no `lossChance`.
  - **region**: `kind, id, name, sceneTag, skillWhitelist, daysRequired, danger?`. No `spawnTable`, no `explorationDC`.
  - **nodeType**: `kind, id, name, skills, img?`. No `ladders`, no `charges`.
  - **blueprint**: no `researchProject`. Station, town: whole.
  The formula snapshot on the actor no longer carries `craftLevel` either (older snapshots are accepted, then rewritten by the GM's load).
- **What is not sent.** Recipes the character does not hold, blueprints not yet designed (whether the Hub should show a designer a "known to exist" list is an **open Stage 11 question**; nothing is built for it), other regions, other towns' stations, unmet materials, every spawn table and ladder. Corpse yield tables live in token flags, not definitions, so they are not covered by this.
- **When it reloads.** At load, then (debounced 300 ms, and only if the facts that decide the set changed, or the GM's revision changed) on: an owned character's formulas, blueprints, projects, queue, Compendium, stations or location flag changing; a character's ownership changing; a material item created or deleted on an owned character; the user's character changing; a scene's flags, the viewed scene, or tokens changing; the party location, station state, party workshops, shared Compendium or `definitionsRevision` settings changing; a GM connecting. `definitionsRevision` is a world setting the GM client writes after `api.reload()` (and with `api.publishDefinitions()`) only when the registry really changed. Nothing recomputes per render: `previewCraft` and the rest read the loaded registry directly.
- **Previews.** A player's `previewCraft` is MECHANICAL (`planCraft({ mechanical: true })`): slot validity, tier floors, quantities, the station and its fee, `days`, the materials used. A material's effect is shown only if the character has learned it for that recipe (their Compendium's Experiments, the party's, or the formula's baseline); otherwise the slot is valid and its effect is `{ known: false }`. The GM checks the effects when the craft is queued. The plan carries no result name, output, craft level or loss chance. The GM's own `previewCraft` is unchanged (the full plan).
- **Queue rows, project info and chat (Stage 10d).** `api.queue.list()` and `api.projectInfo()` take the viewer: a GM gets the DC, the odds and the expected days; a player gets a plain row (skill, days, progress current/needed) and no `info` computed at all. A project a relay hands a player has no `dc`. The research summary is a whisper to the owners and the GM with degree words only; the totals and the DC go in a separate GM-only whisper. `api.audit.scan/accept/ledger` are GM-only. Direct GM tools (`api.gather`, `api.craft`, a direct commission craft) roll without PF2e's own card by default (it shows the DC); pass `rollCard: true` to post one.
- **Not fixable (honor system).** Data Foundry stores on an actor, a token or a world setting is delivered to every client that can read it: a project's stored `dc` and `threshold` in the actor flag `projects`, a node token's `perceptionDC` and `ladder`, the GM-written settings. The module no longer hands any of it over in a return value, row or message, but a player's console can still read what Foundry sends their client.
- **Messages.** A character that does not hold a formula: "`<name>` does not know this formula." (whether or not the recipe exists). Held but the recipe exists nowhere (the GM says so): "holds an orphaned formula for this ...". Not loaded yet / no GM: "Your recipes are still loading ..." / "The GM isn't connected ...". An explore submit for a region not in play: refused plainly after one fresh ask to the GM. Anything a player client cannot check is relayed to the GM, whose validation is authoritative (craft, gather, share, build, upgrade and design all already are).
- **GM clients are unchanged**: they still load every pack, and `api.definitions.refresh()` on a GM returns at once.

## The Downtime Hub and the GM log (Stage 11a, v0.18.0)

- `scripts/hub/`: `viewmodels.js` (every rule, pure), `strings.js` (every word), `render.js` (pure HTML), `facts.js` (the only Foundry-bound reader, through the player APIs), `live.js` (what redraws the window), `app.js` (the ApplicationV2 window, built lazily), `entry.js` (scene button and sheet header button). Client settings `hubWindow` and `hubDisplay` hold a player's size and display choices.
- No chat message carries a DC or a roll total. Those go to `scripts/gm-log.js` (memory only, GM client), read with `api.gm.log()` (GM only).

## Research and Compendium tabs, and leads (Stage 11b round, v0.19.0)

- **Research tab** (`viewmodels-research.js`): the character's active projects (read ONLY through `api.projectInfo`, never the raw project flag), step boxes up to `HUB.research.maxStepBoxes` (20), a bar beyond, always "Progress n of m". Roll-with skills show the character's own modifier, never odds. Days are a stepper clamped to [1, free]; Queue N checks submits ONE `research` queue item (`daysReserved` = N). The check log shows degree words and the progress change only: a GM's free-text note is dropped in `facts.js`, before any view-model sees it. Hints are filtered with `safeText` (`DIFFICULTY_WORDS`). **Put the project aside** (formulae only) has a confirm step ("Put aside? Progress is not kept.", Keep gets the focus); it is off while checks are queued, and station-upgrade and design projects are queueable but have no Put aside here. No pace line: any expected figure would need the DC.
- **Leads.** Actor flag `leads` (`LIVE_SCHEMAS.lead`: `id, recipeId, name, note, at`), watched by the Hub. `api.research.giveLead(actor, recipeId, note)` is GM only (note up to `HUB.research.leadNoteMax`; refuses unknown, already-known, already-researching and duplicate leads). The player's **Start researching** calls `api.research.follow(actor, leadId)`, relayed to the GM client by the guarded `researchFollow` handler (7 handlers in all). The GM-client handler refuses, with a plain reason as data: a sender who does not own the actor, a lead that is not on the actor, a lead already used ("The lead is already used up."), a recipe that no longer exists.
- **The sender rule (`senderOf`, `scripts/queue/common.js`).** A relayed handler takes the sender from the socket's own `socketdata.userId`. A `userId` inside the payload is accepted ONLY when it equals the local GM's id (a GM calling on their own client). Never trust a client-supplied id.
- **Compendium tab** (`viewmodels-compendium.js`): Materials, Creatures, Regions, Experiments; only what the character has experienced (no "???"). Sharing is **Only you / Queued / Shared**, worked out by comparing the character's entry to the shared book; Share queues a `share` item for the GM, Cancel removes it. A rejected share cannot be told apart from a cancel or a force-end (all just remove the queue row), so the Hub shows NO "Not shared" line: the entry simply goes back to "Only you".
- Focus: auto-selecting the only project moves no focus; Open in Research, Put aside, Keep and Start researching each set a one-shot focus request (`#wantFocus`) consumed on the next draw.

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

**Keyboard (any window we build).** Foundry's KeyboardManager cancels Tab (its "cycle view" binding) and similar keys before the browser can move focus, so inside an ApplicationV2 window Tab does nothing and Space scrolls the page behind it. Every ApplicationV2 window we build must stop Tab, Enter and Space from bubbling out of its root (never `preventDefault`: the browser still moves focus and presses the button), only for events that came from inside the window, once per frame, removed on close, and give the root `tabindex="-1"` so a click on blank space focuses the window rather than the page. The Hub does this in one place (`scripts/hub/app.js`, `HUB.keysKeptInside`); Escape and other keys stay untouched. The strict test fake cannot reproduce Foundry's own handler, so the proof is the gate (`docs/17`, Step 38).

**Gather dialog**: opened by clicking a node token in the scene; small dialog for skill choice and roll.

**GM tools**
- Review queue window (see above).
- Commission creator form: patron name, item, `materialsFrom`, payout, `teaches`.
- Definitions are edited directly in the compendium packs (no custom editor).
- GM-only "Save to compendium" button on crafted item sheets.
- Anchor placement: GM drops hidden node tokens on scenes.

## Tokens
Nodes (anchors, active nodes, corpses) are tokens with flags. Hidden tokens are anchors; activation unhides them. Filter node tokens from the combat tracker and token lists.
