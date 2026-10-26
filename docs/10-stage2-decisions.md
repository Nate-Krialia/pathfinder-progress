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
- The fee is spent on every degree. Stage 2 uses a fixed stub (`CRAFTING.stubFeeGp`); Stage 3 replaces it.
- **Thrifty craft is OFF** (`CRAFTING.thrifty.enabled`) until confirmed.
- Stage 2 entry point is GM-only: `api.craft({ actor, recipeId, selection, degree? })`. `degree` forces a result for testing. Player-facing flow comes in later stages.
