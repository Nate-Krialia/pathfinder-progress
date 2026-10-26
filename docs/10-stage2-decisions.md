# 10 Stage 2 Decisions (crafting core)

Decisions made while building Stage 2. Where this file and `01-data-model.md` / `03-crafting.md` disagree, this file is newer.

## Recipe changes (replaces parts of `01-data-model.md`)
- `itemTemplate` is **removed**. `output` replaces it: a map of base-tier -> item reference, e.g. `{ "1": "Dagger", "2": "Dagger" }`.
- The tier used is the one the recipe's **base role** resolves to (`basePower` for weapon/armor/robes, `spellPower` for focus; override with `baseRole`). Exactly one slot may drive it.
- A recipe with no base role uses `output: { "default": uuid }`.
- Every tier a qualifying material could produce must have an `output` entry (checked on load). Each reference is also resolved against PF2e at ready time; a bad one marks that recipe uncraftable.
- `craftLevel` (0 to 25) sets the craft DC via the PF2e level-DC table. It is constant per recipe, so material quality never changes the DC.
- `resultName` (optional) names the crafted item; default is the base item's name.
- `slots[].drives` is a role name **or an array of roles** (one fang can drive `bonusDamage` and `specialAbility`). An override on a multi-role slot must name its `role`.
- Optional `lossChance` (0 to 100) on a slot or a material.
- **One material type per slot.**

## Output references
An `output` value is one of:
- an item **name**: `"Dagger"`
- **`"Pack: Name"`** to disambiguate: the prefix is a pack id or label, and counts only if it names a searched pack (`"world.homebrew: Dagger"`)
- a full **UUID** (escape hatch): `"Compendium.pf2e.equipment-srd.Item.<16-char id>"`

Names resolve at ready time against the **"Item packs for recipe outputs"** setting (default `pf2e.equipment-srd, world.*`; `world.*` means every world Item compendium). Matching is exact, ignoring case and surrounding spaces.

- **Zero matches or several matches never guess.** The recipe is marked uncraftable and the error names the recipe, the reference, and what was found (every candidate with pack, type and UUID). Other recipes keep working.
- A string that starts `Compendium.` or `Item.` must be a well-formed UUID; it is never treated as a name.
- Resolved references are cached for the session. Failures are not cached. `api.reload({ fresh: true })` clears the cache.
- Resolved UUIDs live in `api.resolvedOutputs` (recipe id -> tier -> UUID); the core code only ever crafts from those.

## Role value shapes
| Role | Value |
|---|---|
| `basePower`, `spellPower` | tier reference `"T1"` to `"T5"` (picks the output item) |
| `bonusDamage` | `{ dice: "1d4", type: <damage type>, persistent?: bool, versus?: <trait slug> }` |
| `specialAbility` | `{ title, text, on?: "hit" or "criticalHit" }` |
| `resistance` | `{ type: <damage type>, value: 1..50 }` |
| `spellSlots` | integer >= 1 (recorded in the description only for now) |
| custom role | number, string or boolean written to its `modifies` path (`system.*`, never `system.rules`) |

`basePower` and `spellPower` allow one slot. The other roles stack.

## How effects reach the PF2e item
Done only in `scripts/adapter/pf2e.js`, as rule elements on `system.rules`, scoped to the crafted item's own damage rolls:
- `bonusDamage` -> `DamageDice` (`category: persistent`, `predicate: target:trait:<versus>`)
- `specialAbility` -> `Note`
- `resistance` -> `Resistance`

Rule elements cannot apply a condition on a hit by themselves (`GrantItem` does not work on physical items), so an on-hit effect appears as note text on the damage roll.

## Craft rules as built
- Loss chance per unit: slot override > material override > default (50%). A unit is lost when its d100 is <= the chance.
- The fee is spent on every degree. It comes from the station's tier (Stage 3; the Stage 2 `stubFeeGp` is gone).
- **Thrifty craft is OFF** (`CRAFTING.thrifty.enabled`) until confirmed.
- Stage 2 entry point is GM-only: `api.craft({ actor, recipeId, selection, degree? })`. `degree` forces a result for testing. Player-facing flow comes in later stages.

# Stage 3 decisions (stations)

## Locations without a map
- A **town** is a definition kind (`{ kind: "town", id, name }`). A station's `town` must name a defined town, so a typo fails at load.
- A crafter's location is resolved most-specific-first: **actor override** (flag `location`) > **party location** (world setting `partyLocation`) > nowhere. Set them with `api.setLocation(townId)` and `api.setActorLocation(actor, townId | null)`.

## Where station data lives, and the join
- Compendium `station` definition: fixed facts `{ id, name, category, tier, town }`. Public unless the world state says otherwise.
- World setting `stationState`: `{ stationId, owner?, access[], tier? }` per public station. `tier` (optional) overrides the read-only compendium tier, so Stage 9 upgrades have somewhere to write.
- Actor flag `stations`: player-owned workshops and carried kits as full records. A record's `owner` (and a kit's `holder`) must be the actor that stores it.
- `buildStationList` joins them. Problems are reported with pack/entry/field and the station is left out. A broken state entry removes its station entirely (**fail closed**), so a private workshop can never fall back to public.

## Reach rules
- **fixed:** crafter is in the station's town AND (no owner, or is the owner, or is on `access`).
- **carried:** the holder always; otherwise someone on `access` who is in the same place as the holder ("no location" counts as together).
- The station must also match the recipe's `stationCategory` and have tier >= `stationTierMin`.

## Choosing a station and the fee
- Exactly one usable station is chosen automatically. Several: the caller must pass `station: "<id>"` (never guessed). None: the error gives each station's reason.
- Fee = `STATIONS.feeByTier[station tier]` (placeholders 1/5/20/80/300 gp). It is spent on every degree and is **not** paid to the owner.
- Carried kits above `STATIONS.portableTierCap` (2) are an **error and excluded**, never clamped.
- The chosen station is recorded in the summary and the crafted item's provenance.

## GM console tools
`stationsFor(actor, recipeId?)`, `setLocation`, `setActorLocation`, `setStationState`, `clearStationState`, `giveStation`, `removeStation`, `transferStation`. All writes are GM-only and validated before anything is saved.

# Stage 4 decisions (gathering)

## Node records
- A node is a **token flag** (`flags.pathfinder-progress.node`); the token is its identity (no stored id). `explored`, `placed` and `corpse` nodes share one shape: `{ source, state, nodeType, tier, charges, region?, discoveredBy[], ladder?, decayTimer? }`.
- States: `anchor` (hidden marker; only `source`, `state`, `region`, `discoveredBy`), `active` (charges >= 1), `depleted` (charges 0). A mismatch is a load error. A corpse cannot be an anchor and must carry its own `ladder` and a `decayTimer`.
- `nodeType` is a definition kind: `{ id, name, skills[], charges, ladders?: { "<tier>": [rung] } }`. Skills are checked against PF2e skill slugs (lores allowed). A type may have no ladders (corpse).
- The ladder is resolved lazily: the node's own `ladder` beats `nodeType.ladders[tier]`, so edits to a nodeType reach existing nodes.

## Ladders and DCs
- A rung is `{ materialId, dcOffset, quantity, guaranteed? }`. **Exactly one rung is `guaranteed`: the base rung**, and it must have the **lowest `dcOffset`** (ties allowed). No duplicate materials.
- Rung DC = `GATHERING.baseDcByTier[node tier] + dcOffset` (placeholders 10/15/20/25/30; spec tiers 1 to 3, 4 and 5 extend the pattern).

## Resolving a gather
1. Refuse anchors and depleted nodes before any dice. The skill must be on the node type's list; with one allowed skill it is picked automatically, otherwise it must be named.
2. **Visible roll** (PF2e check) against the base rung: a pass is PF2e success or better.
3. A failure yields nothing and rolls **no** hidden dice.
4. A pass grants the base material (quantity dice). Each higher rung then gets its own hidden `d20 + modifier` (modifier = total - natural d20 of the visible roll); the total meeting the DC succeeds (plain arithmetic, no nat-20 upgrade).
5. **Every attempt spends one charge** (burned before materials are granted). 0 charges = depleted.
6. A quantity that rolls 0 or less grants nothing.
- Forced test degrees skip the roll and use the character's static skill modifier for the hidden rolls.
- Hidden rolls are returned to the GM and logged to the console (not when `chat: false`); they never appear in chat.

## When a grant fails (policy)
- The charge is burned first, deliberately: a crash can then never leave a free attempt.
- But a crash is not a gathering attempt. If granting materials throws, the **charge is refunded** and any materials already given in the same gather are **taken back** (a new stack is deleted, a topped-up stack returns to its old quantity), so a gather is all-or-nothing.
- If the refund itself fails, the error says so and gives the exact `api.refillNode(token, n)` to repair it.
- Charges and state are always written together and checked against the node schema, so a node can never be saved with 0 charges while "active" (or charges while "depleted").
- A chat failure after a successful gather is logged; it does not undo or hide the result.

## Tools
`gather`, `previewGather`, `nodeInfo`, `createNode`, `createAnchor`, `activateNode` (unhides the token), `refillNode`, `makeCorpseNode`, `clearNode`. Node tokens are kept out of the combat tracker.

## Deferred
Corpse yield derived from creature level/traits, auto-creating corpse nodes on death, decay ticking, the click-on-token dialog and the player relay (Stages 6 and 10).

# Notes for later stages

## Stage 7 (and any placed or explored node): a dedicated "Resource Node" actor
Stage 4's test token borrows whatever actor is handy, so it shows that actor's art and sheet. Real nodes should use one neutral PF2e **loot** actor.

What the module needs:
1. **One shared actor, found by flag, not name.** The adapter (the only file that knows PF2e's `loot` type) gets `createNodeActor()`, `isNodeActor(actor)` and `findNodeActor()`. The actor carries `flags.pathfinder-progress.nodeActor = true`. `ensureNodeActor()` reuses it, remembers its id in a world setting, and recreates it (with a GM notice) if it was deleted. Creation is GM-only.
2. **Safe defaults on that actor.** Default ownership NONE so players cannot open its sheet (the click opens the gather dialog in Stage 10, and sheet rendering for node tokens is suppressed). A neutral name and image. Prototype token: unlinked, neutral disposition, name on hover, no vision, no bars, 1x1, rotation locked.
3. **Per-nodeType token art.** `nodeType` gains an optional `img` (a path; default to Foundry's core `icons/...` so the module ships no art). `createNode` and `activateNode` set the TOKEN's texture from it, so one actor serves every nodeType. The token name defaults to the nodeType's name unless the GM named it.
4. **A token builder.** `placeAnchor` and `placeNode(scene, { x, y, nodeType, tier })` create tokens from the shared actor, so GMs never hand-make them and Stage 7 can spawn explored nodes at anchor positions with the same call. Anchors (hidden) use it too.
5. **Corpse nodes do not use it.** A corpse is the dead creature's own token and keeps its own actor.
6. **Tests.** The token-data builder and the actor-data builder are pure and unit-tested; ensure/reuse/recreate runs against fake documents like `tests/gather-wiring.test.js`. If PF2e renames the `loot` type, only the adapter breaks, and `ensureNodeActor()` fails loudly.
