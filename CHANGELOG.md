# Changelog

## 0.18.1

Fix: the Downtime Hub did not open in real Foundry (gate 17 Step 4). `TypeError: Cannot set property state of #<ApplicationV2> which has only a getter`.

- **Root cause.** `HubWindow` kept its own window state in `this.state`, but `ApplicationV2.state` is a read-only getter (its render lifecycle: NONE, RENDERING, RENDERED, CLOSING, CLOSED), so the constructor threw. The first fake `ApplicationV2` in the tests had no such getter, so every test passed. The window's own state is now `this.hubState` (a name nothing in Foundry uses).
- **Audit.** Every name `HubWindow` and the review window define or assign was checked against the v14.369 `ApplicationV2` declarations (the community `foundry-vtt-types` package for 14.369; foundryvtt.com itself is not reachable from the build sandbox). `state` was the only collision. The scene-controls tool, the sheet header control (`onClick` on a header entry is in the v14 types), `DEFAULT_OPTIONS`, `actions` binding, `_renderHTML`/`_replaceHTML`/`_onRender`/`_onPosition`/`_onClose`, `render({ force: true })` and `foundry.applications.instances` match the declarations.
- **A stricter fake.** `tests/fake-application.js` mirrors the real class: read-only getters (state, id, element, rendered, title, window, classList, form, minimized, hasFrame, children, parent) that throw on assignment, a frozen `options`, the real render lifecycle and its order (a plain `render()` never opens a closed window), clicks on `[data-action]` routed to `actions` with the real `this` and arguments, and a real DOM (jsdom, a new dev dependency). Both the Hub tests and the review-window tests now run on it (the review test used to assign `app.element`, which the real class also forbids). A collision check compares what the windows define with the full member list of the real class, and a static test refuses any assignment to a read-only member.
- Tests: 926 in all (6 new). `tests/hub-wiring.test.js` now renders the Hub for real and clicks every action in `actions` through the DOM.
- No manifest change (the version only): a force-reload of both windows is enough if you already restarted for 0.18.0.

## 0.18.0

The Downtime Hub window (frame and Formulae tab) and one leak fix (Stage 11a; `docs/11-hub-design.md` with `docs/11b-hub-addendum.md` winning).

- **Leak fix.** A GM-only whisper is still delivered to EVERY client's `game.messages` (only hidden from a player's chat log), so no chat message carries a DC, a roll total or a percentage any more, whoever it is whispered to. The totals, DCs, loss rolls and hidden rolls go to the **GM log** instead: memory only on the resolving GM's client, never saved, newest first, read with `api.gm.log({ limit?, kind?, actorId? })` (GM only; `api.gm.clearLog()`); each new entry fires the local hook `pfpGmLogChanged` (the Stage 11b GM window will read it). Sites changed: the research GM whisper (`research/store.js`), the craft loss rolls and the gather hidden rung rolls (`queue/work.js`), the expedition summary and the search Perception total (`exploration/store.js`; the GM also gets a local notice, no chat). The player-facing messages (degree words and progress) stay. Gate 16 Step 8 now scans every message, visible or not; the fake Foundry now delivers every message to every client like the real one.
- **The Hub.** `api.hub.open(actor?)`; a scene-controls button (any user) and a Downtime button in the character sheet header. One character at a time (a switcher when you own several), a status strip (days free and reserved, party location and workshops there, how many are waiting on the GM, a read-only queue panel with Cancel), six tabs (only Formulae works), live updates for the viewed character only (debounced, no polling, nothing replaced if nothing changed, focus and scroll kept), size and position remembered per player, Display settings per player (text size 100 to 175% as real font size, Parchment, Dark or High contrast, Standard or bundled Atkinson Hyperlegible, reset), real buttons, 44px targets, status never by colour alone, an aria-live line for results, reduced motion respected. The two panes stack when the window is narrower than 700px.
- **Formulae tab.** Cards for held formulae (Known) and ones being researched (Researching, progress, a placeholder Open in Research); filter chips. Every slot starts EMPTY; a slot offers only materials the character has AND has met, at or above the slot's tier floor; each option shows tier, stock ("Uses 3 of 5", or "Not enough. Need 1, you have 0") and its effect ONLY if learned ("You haven't tried this here yet" otherwise). "What you will get" lists the result if known, the learned effects of the chosen materials, the station fee, the days and the materials used. Workshops fitting the recipe, cheapest chosen by default, fee shown. Queue the craft (through `api.queue.submit`) says in words why it is off. Ask a crafter instead is a placeholder until Commissions.
- Reported gaps, not invented: the player copy carries no gold value for materials, so "the materials are worth X" is not shown; a formula being researched appears under All only (its category is not on the player copy).
- New: `scripts/hub/` (view-models, strings, render, window, facts, live updates, entry points), `scripts/gm-log.js`, `stations/fees.js feeForStation` (one rule for a station's fee), `styles/hub.css`, the bundled font in `styles/fonts/` (SIL OFL), the `definitionsRefreshed` event (player client), `HUB` and `GM_LOG` in config.
- **The manifest gained a stylesheet and a font: restart the Foundry server.** No pack changed.
- Tests: 920 in all (61 new): the GM log, the Hub view-models and leak scanner, the wired window, live updates, entry points, and the gate. Older tests changed on purpose: the research, craft, gather, exploration and search chat tests (a GM whisper is now a GM log entry), `difficulty.test.js` and `gate16.test.js` (the all-messages scan, the version check).
- Screenshots of the window with throwaway data: `docs/screens/` (`node build/screens.mjs`).
- Gate: new `docs/17-stage11a-gate.md` (a click-through).

## 0.17.0

Hidden difficulty everywhere, and the Experiments knowledge system (Stage 10d; the decisions are in `docs/11b-hub-addendum.md`).

- **Players never see a DC, odds, a percentage or difficulty wording.** Fixed at the source: the explore and research rows of `api.queue.list()` (a player's row is plain; the GM's keeps the DC and the odds), `api.projectInfo`, the research summary (now a whisper with degree words; the total and DC go in a GM-only whisper), the project a relayed upgrade or design start returns, `api.audit.*` (GM-only), and the player copy of definitions (a region loses its DC and spawn table; a material its effects and loss chance; a recipe its overrides, outputs, craft level, research tier and loss chances, and gains precomputed craft `days`). The GM's direct tools (`api.gather`, `api.craft`) roll without PF2e's own card by default; pass `rollCard: true` to post one. The formula snapshot on the actor no longer holds `craftLevel`. Not fixable (honor system): a project's stored DC in the actor flag, a node's `perceptionDC`.
- **Experiments**, a new Compendium category, per character and shareable: what a material gives in a recipe slot is learned by a SUCCESSFUL craft (per recipe, slot and material, never per combination; a failure teaches nothing). A player's `previewCraft` always shows the mechanical facts and shows an effect only if it is known, otherwise `{ known: false }`. A formula's baseline (what the cheapest valid materials make) is revealed when it is owned (research, a GM grant, a commission that teaches); a loan does not reveal it. A loaned formula teaches the crafter (`EXPERIMENTS.ownerLearnsFromLoan`, default false). New share kind `experiment`. `api.compendium.view` gains `entries.experiments`; new `api.compendium.knownEffect` and `revealBaselines` (GM: for formulas gained before this version).
- Existing formula snapshots are rewritten without `craftLevel` the first time a GM loads; the GM sees one "refreshed N formula copy(ies)" notice.
- Tests: 859 in all (46 new): the return-value scanner (`tests/difficulty.test.js`), Experiments (pure and wired), and the two gates. Older tests changed on purpose where they pinned the old behaviour: the public research chat (`research-wiring`, `research-pure`, `queue-wiring`), the formula snapshot's `craftLevel` (`research-formulas`, `research-wiring`), the player copy of definitions and its region DC (`player-defs-*`), the share kinds text and an escrow-return write count (`compendium-wiring`), and one fault-injection loop (`commissions-wiring`) that now allows for the best-effort Compendium write after a successful craft.
- Gate: new `docs/16-stage10d-gate.md`.

## 0.16.0

Players load only the definitions they need.

- A player client no longer reads any definition pack. Both packs (recipes and the rest) are hidden from players' interface (`module.json` pack ownership; **restart the Foundry server once**), and the GM client sends each player the definitions their characters need over a new guarded socket handler, `definitionsFor`: recipes they hold a formula for (own and loaned), blueprints they hold or are designing, the materials they have, the stations and towns in play, the regions tagged on their scene and the node types out there. Honor system, not secrecy.
- Stripped from the player copy: a region's spawn table, a node type's ladders and charges. A region's DC is kept on purpose (`api.queue.list()` already shows it to players; see `docs/10`).
- The copy refreshes by itself (debounced) when a formula, blueprint, ownership, scene, token, party location, or the GM's definitions change. New: `api.definitions.refresh()` (player), `api.publishDefinitions()` (GM), `api.definitionsStatus()`.
- Fixed in a player window: previewing a recipe the character holds said "unknown recipe"; exploring a region in play said `unknown region`. A recipe the character does not hold now says "`<name>` does not know this formula."; "orphaned formula" is said only when a held formula has no recipe on the GM; a material the character has never met is "you do not have ...", not "unknown".
- Tests: 34 new (pure selection and stripping, per-client wiring, the two gates). The fake Foundry can give every client its own definitions (off by default). The 10a/10b/10c suites run as before; only the handler counts (6 handlers now), the "a player skips the recipes pack" rule and the definitions-pack ownership guard changed with the rule.
- Gate: `docs/14` Step 3 loads the Player's definitions; new `docs/15-stage-defs-gate.md`.

## 0.15.0

The Compendium, workshop upgrades and building your own workshop (Stage 10b + 10c). See `docs/10-stage2-decisions.md` and `docs/14-stage10bc-gate.md`.

## 0.14.1

Refusals reach players through the socket as data (Stage 10a fix).

## 0.14.0

Queued craft and gather (Stage 10a).
