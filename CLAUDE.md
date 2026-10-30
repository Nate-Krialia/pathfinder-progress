# PF2e Gathering & Crafting Module (Foundry VTT)

A full replacement for Pathfinder 2e's crafting rules. Modular, slot-based recipes; formulae are *earned* through research; real material costs plus a station fee; node-based gathering; crafting and research are decoupled so one character can research what another makes.

Read this file first on every task. Then load only the system file(s) the task touches.

## Spec files

| File | Covers |
|---|---|
| `docs/01-data-model.md` | Record shapes, where each lives, validation |
| `docs/02-research.md` | Projects, daily checks, thresholds, formula unlocks, workshop upgrades |
| `docs/03-crafting.md` | Slots, roles, quality, craft check, failure/loss |
| `docs/04-gathering.md` | Nodes, DC ladder, hidden rung rolls, charges |
| `docs/05-exploration.md` | Regions, expeditions, anchors, scenes |
| `docs/06-commissions.md` | Patron/crafter flow, formula loans, GM-issued jobs, teaching |
| `docs/07-stations.md` | Fixed/portable stations, tiers, fees, ownership |
| `docs/08-foundry-integration.md` | Adapter, sockets, action queue, permissions, UI surfaces |
| `docs/09-build-order.md` | Staged build plan with test gates |

## Design pillars (non-negotiable)

1. Full replacement of PF2e crafting. Do not call or depend on PF2e's crafting rules.
2. Modular: recipes are built from slots that accept any material meeting the requirement.
3. Formulae are earned via research progress, never found or bought directly (commission `teaches` is the sanctioned exception, GM-controlled).
4. Honest costs: real materials plus a small station fee.
5. Research and crafting are decoupled. The formula owner need not be the crafter.
6. **Materials decide what you get; rolls decide whether you get it.** A roll never upgrades quality, and quality never eases a roll.
7. One quality axis: a material's tier is baked into its type (iron T1, silver T2, starmetal T3). No separate grades.
8. Automate bookkeeping. Players should never track days, charges, or hidden rolls by hand.

## Global rules for every task

- **Layered resolution**: most specific rule wins. Used for material effects (recipe override > material default) and corpse yields (creature override > trait/level mapping). Implement ONE shared resolver and reuse it.
- **Schema validation on load**: all definitions are validated when read. Bad data fails loudly (clear error naming the entry), never silently.
- **All PF2e item/actor reading goes through one adapter file** (`adapter/pf2e.js` or equivalent). No other file touches PF2e data structures directly.
- **Hidden rolls run on the GM client only.** Players must never see or influence them. No chat message carries a DC, a roll total or a percentage, even a GM-only whisper (Foundry delivers every message to every client): those go to the in-memory GM log (`api.gm.log()`, `scripts/gm-log.js`).
- **Players cannot write world settings, scenes, or compendiums.** Any such write is relayed to the GM client (see `docs/08-foundry-integration.md`).
- **Recipe and definition visibility is an honor system, not secrecy.** Both definition packs (recipes and the rest) are hidden from players' interface and a player client reads NO pack. Instead the GM client sends each player only the definitions their characters need (recipes they hold a formula for, own and loaned; blueprints they hold or are designing; materials they have; stations in the party's town; regions tagged on the scene they are on; and so on), with everything that carries a DC, an effect or a percentage removed (a region's spawn table and DC, a node type's ladders and charges, a material's effects, a recipe's overrides, outputs, craft level and loss chances; the exact fields are in `docs/08`). The `definitionsFor` socket handler is the one path (`docs/08`, `docs/10`). Foundry does not enforce read access: a player using the browser console can read the packs and anything else Foundry sends their client (verified in Foundry 14.369, also for a world Journal set to None). Never describe it as secret, and never rely on it for anything that must stay hidden. See `docs/10-stage2-decisions.md`.
- **Difficulty is hidden from players, everywhere** (`docs/11b-hub-addendum.md`, which wins over `docs/10` and `docs/11`): a player is never shown a DC, odds, a percentage or difficulty wording, in a return value, a queue row, a preview, a chat message or the Compendium. It is stripped at the source, not hidden in a UI. The GM sees everything. The honor system applies to data Foundry stores and delivers (an actor flag, a token flag, a world setting).
- **Experiments**: a material's effect in a recipe is shown to a character only if they have learned it (a successful craft teaches it, per recipe, slot and material; a formula's baseline is revealed when it is owned; the party's shared book counts). Effects come from the ONE resolver.
- Each downtime day goes to exactly one activity (research, exploring, crafting, workshop upgrade). Gathering costs node charges, not days, and needs no downtime.
- Prefer Foundry-native building blocks: Items, compendium packs, flags, tokens, ApplicationV2, socketlib. Foundry cancels Tab and similar keys before the browser acts: an ApplicationV2 window we build stops Tab/Enter/Space bubbling out of its root (`docs/08`, UI surfaces).
- Keep tunable numbers in one config object/file, never hardcoded in logic.
- Every resolved action produces a human-readable result record (chat card and/or summary) for the players.

## Tunable numbers (placeholders, expect changes)

Research progress per degree, tier thresholds, DC offsets, station fee per tier, loss chance (default 50%), exploration anchor counts per degree, portable tier cap. All live in config.

## Deferred / not yet designed

- Practice and discovery bonuses to research are only sketched (see `docs/02-research.md`).
- Trait-to-material mapping table for corpse yields must be authored.
- Procedural map generation (explicitly deferred).
- Per-grade materials (explicitly rejected for now; keep the item flag schema extensible).

## Unconfirmed assumptions (ask the user before relying on them)

- Crit success on a craft refunds some materials ("thrifty craft").
- The craft check always uses the Crafting skill.
- Crafting from a loaned formula may bank practice insight toward researching it.
- Foundry and PF2e system target versions (confirm before building).
