# Changelog

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
