# 11b Hub addendum (decisions after v0.16.0)

These decisions were confirmed by the project owner after the real-Foundry gates for Stages 10a to 16. **Where this file disagrees with `docs/10-stage2-decisions.md` or `docs/11-hub-design.md`, THIS FILE WINS.** It is built in Stage 10d (v0.17.0). "Honor system" means what it has always meant here: Foundry sends a client everything it can read, so this decides what the module computes, carries and shows, not what a determined player could dig out of the console.

## A. Hidden difficulty, everywhere

- Players NEVER see a DC, odds, a percentage or any difficulty wording, anywhere: exploring, gathering, crafting, research. The GM sees everything.
- Every player-facing output is audited and fixed: `previewCraft` and its plan fields, research previews, build and upgrade previews, queue rows and their details, refusal messages, result messages, chat cards and whispers, Compendium entries, and every api surface the Hub will call. A Compendium gather entry may say a rung was REACHED, never its DC. A player may see their own visible modifiers only where the PF2e sheet already shows them.
- Because players can read whatever reaches their client, the player copy of a preview, a queue row or a definition should not CARRY a DC at all. It is stripped at the source (built on the GM client and relayed, or filtered before it is returned), not hidden in the UI. Where that cannot be done (data Foundry stores on an actor, a token or a world setting and delivers to every client) it is reported, not pretended.
- Tests scan player-facing strings and objects for DC, odds, percent and difficulty words, with a mutation check that a re-added DC is caught.

Supersedes: `docs/10` "Players see no odds" and "Players are shown no odds or results" (they were not fully true: an explore row of `api.queue.list()`, a research row, `api.projectInfo`, the research chat message and the project returned by a relayed upgrade or design start carried the DC and the odds); `docs/10` Stage 16 note that a region's `explorationDC` stays in the player copy (it goes when the row stops carrying it); `docs/11` lines that show odds "in words and percent", "real odds of progress each", and "difficulty scales with tier".

## B. Experiments (a new Compendium category, per character, shareable)

- Craft slots start EMPTY in the Hub (UI later). The backend supports previewing a selection whose effect is unknown.
- `previewCraft` ALWAYS returns the mechanical facts: slot validity, tier floors, station fee, days, materials used. It returns a material's EFFECT only if that character has experienced it for that recipe; otherwise the slot is valid and its effect is the clear field "unknown" (a field, never a placeholder such as "???" in the Compendium).
- Knowledge is recorded PER MATERIAL, PER RECIPE (for example "T2 liquid in the healing potion: +4"), NOT per exact combination. Once a material has been used in a recipe its effect there is known, and any pairing can be worked out from the known parts.
- Only a SUCCESSFUL craft teaches. Failure (including loss of materials) teaches nothing. A critical success teaches the same as a success.
- Finishing a formula's research reveals its BASELINE result (what the cheapest valid materials make). Anything stronger is discovered by crafting.
- Effects come from the ONE shared resolver (recipe override > material default); no effect logic is duplicated.
- Recording is idempotent, best-effort and additive in either order, like the other Compendium categories. It happens at craft resolve on the GM client and through the existing hooks pattern.
- Loaned formula: crafting from a loan teaches the CRAFTER (the one who made it).
- Share: a new queue "share" kind for experiments, same flow as materials, creatures and regions (0 days, no downtime, the GM approves into the shared Compendium). Shared knowledge is read-only for the party and merges additively with private knowledge.
- `api.compendium.view(actor)` gains an experiments section. The player copy carries only what was experienced.

## C. Confirmed at the Stage 10d go-ahead

- Research progress stays as `current/needed` (step boxes): it is progress, not difficulty.
- Knowledge is keyed by (recipe, slot, material).
- One `experiment` share = all known facts of one recipe at queue time, merged additively.
- The player copy gets precomputed `days` (station upgrades and the 1-day floor included) and NO `craftLevel`.
- Direct GM tools (`api.gather`, `api.craft`) roll without PF2e's own card by default (it shows the DC); the GM opts in with `rollCard: true`.
- Stored project DCs in actor flags are NOT removed (honor system, reported).
- Baseline: the cheapest valid material per slot (lowest tier at or above the floor, then lowest gp value, then lowest id), computed on the GM, stored without material names, revealed when a character gains an OWNED formula (research, a GM grant, a commission that teaches); a loan does not reveal it.
- Loaned formula: only the crafter learns; `EXPERIMENTS.ownerLearnsFromLoan` (default false) is the tunable.
- The player copy strips a region's `explorationDC` and `spawnTable`, a material's `effects`, a recipe's `overrides`, `output`, `itemTemplate`, `researchProject`, and the resolved outputs.
- Research summary chat: a whisper to the owners and the GM with degree words only, plus a GM-only whisper with the total and the DC. `audit.scan/accept/ledger` are GM-only.

## D. Still open

- Whether blueprints a character has not designed should be visible so the Hub can offer "research a design" (open since Stage 16; decided for Stage 11).
- Whether the Hub should show the result of a partly known selection as an assembled item description (Stage 10d returns per-slot facts and the result's base tier only).
