# 04 Gathering

## Nodes
Gathering is node-based. A node is a persistent entity with `source`: `explored`, `placed`, or `corpse`. All three share one record and one interaction path. Nodes are **tokens** with module flags; players click the token to open the gather dialog. Node tokens are filtered out of the combat tracker.

## Node fields
`tier`, `region`, `charges`, `discoveredBy`, `state` (anchor | active | depleted), `ladder`, plus `decayTimer` for corpses.

## The DC ladder
Each node has a ladder of entries: `{ materialId, dcOffset, quantity, guaranteed }`.
The **node tier sets a base DC**; each rung = base DC + offset.

Example offsets: iron +0 (guaranteed), silver +5, starmetal +11.

| Node tier | Base DC | Rungs (+0 / +5 / +11) |
|---|---|---|
| 1 | 10 | 10 / 15 / 21 |
| 2 | 15 | 15 / 20 / 26 |
| 3 | 20 | 20 / 25 / 31 |

Higher-tier nodes also list higher-tier materials on their ladder (e.g. T2 base, T3 second rung, T4 third) so working better nodes pays off. Numbers are placeholders; tie base DC to PF2e level DCs later.

## Gather resolution
1. Player picks a skill from the node type's whitelist (e.g. herbs: Nature/Survival; ore: Athletics/Crafting; corpses: Medicine/Survival/Nature) and rolls (visible).
2. **Pass/fail on the base rung.** Failure yields nothing.
3. On success: grant the base material (quantity dice, e.g. 1d4 iron).
4. **For each higher rung, run a hidden roll** (d20 + the same modifier) against that rung's DC. Success grants that rung's quantity dice (e.g. 1d2 silver, 1 starmetal). The visible roll does NOT automatically unlock higher rungs.
5. **Every gather attempt, pass or fail, spends one charge.** Depleted nodes cannot be gathered, and **nodes never refill** (see `10-stage2-decisions.md`, Stage 9). A hidden node found by an expedition cannot be gathered until it is spotted.

Hidden rolls run on the GM client (via socket relay). No guaranteed floor beyond the base material.

## Corpse nodes
- Source tokens are creatures that died. Few charges; decay timer so they spoil.
- **Yield is auto-derived** from creature level (quality tier) and traits (material type, e.g. dragon -> scales) via a mapping table.
- **Per-creature override** (`yieldOverride`) wins when present. Use the shared layered resolver.
- Read creature level/traits only through the PF2e adapter.
- The trait-to-material mapping table must be authored (not yet designed).
