# 03 Crafting

## Principle
Materials = what you get. Roll = whether you get it.

## Recipe structure
A recipe is a set of **slots**. Each slot has:
- `drives`: the role it controls (e.g. `basePower`, `bonusDamage`, `specialAbility`)
- `tierFloor`: minimum material tier accepted
- `qty`: how many units

Any material meeting the floor can fill the slot. Different slots control different parts of the item (e.g. blade metal sets base power, coating sets bonus damage, core sets special ability).

## Effect resolution
Each material carries default effects tagged by role, and may carry effects of its own for an item class (a recipe's category). A recipe may override any material's effect for a given slot. Use the shared layered resolver (recipe override > the material's item-class effects > material default; `docs/11c-discovery-addendum.md`, `scripts/data/resolver.js`).

## Preconditions
- Crafter has the formula (owned copy, or a loan for an open commission).
- Crafter can reach a station whose `category` matches and whose `tier` >= the recipe's `stationTierMin` (see `07-stations.md`).
- Required materials are in the crafter's inventory (or supplied per commission rules).
- Station fee available.

## The craft check
- One check, always the **Crafting** skill, rolled by the **crafter** (the patron's skill is irrelevant).
- Material quality never changes the DC; roll never changes quality.

## Outcomes
| Degree | Result |
|---|---|
| Critical success | Item made; some materials refunded ("thrifty craft", UNCONFIRMED) |
| Success | Item made; all materials and the fee consumed |
| Failure | No item; fee lost; each unit of material rolls loss |
| Critical failure | No item; everything lost, no loss rolls |

## Failure loss roll
On a failure, **each individual unit** of material gets its own d100 roll against the loss chance (default 50%, configurable, overridable per material or slot). Lost units are consumed; survivors are kept. Rolls run on the GM client and are not shown at the table (show a results summary).

## Output
- Created item is a real PF2e item with provenance flags: `recipeId`, `materials used`, `crafter`.
- A GM-only action "Save to compendium" (archive a snapshot into the Item output pack for later campaigns) is WANTED and NOT BUILT yet. The pack exists in the manifest; nothing writes to it.
