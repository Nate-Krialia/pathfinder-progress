# Changelog

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
