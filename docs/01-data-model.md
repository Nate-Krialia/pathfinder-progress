# 01 Data Model

## Storage by kind

| Data | Kind | Home |
|---|---|---|
| Material definitions, regions, spawn tables, creature yield overrides, custom roles, towns, stations, node types | Definition | Compendium packs of flagged Journal entries (GM-editable, importable, shippable) |
| Recipes | Definition | A separate Journal pack (`recipes`), **hidden from players' interface** (an honor system; see the note below) |
| Crafted/archived finished items | Output | Separate Item compendium pack (compendiums hold one document type each) |
| Material stacks a character owns | Live | Real PF2e Items in actor inventory carrying module flags |
| Research / upgrade project | Live | Flag on the researcher's actor (current shape: `10-stage2-decisions.md`) |
| `pendingActions` queue | Live | Flag on each player's own actor |
| Node (anchor or active) | Live | Token with module flags on its scene |
| Corpse node | Live | Token/actor flags (creature that died) |
| Player-owned station | Live | Flag on owner's actor |
| Public/fixed station | Definition + live | Journal entry in compendium, location data |
| Commission | Live | One world-level setting list (single source of truth); UI filters per player |
| Formulae owned | Live | Flag on actor: `{ recipeId, access, source, snapshot }`; the snapshot is a display copy |

**Visibility is an honor system.** Foundry does not enforce read permissions on compendium or world Journal contents: a player can read them from the browser console (verified in Foundry 14.369). "Hidden from players" here means hidden from the interface and skipped by the module's loader. It is not secrecy; do not rely on it for anything that must stay hidden.

## Records (shapes are indicative; finalize in code with validation)

Shapes that changed while building (projects, formulas, nodes, stations, recipes) are recorded in `10-stage2-decisions.md`, which is newer than this file.

**Material** (definition and item flag)
```
id, name, tier (int),
effects: { <role>: <value> }   // e.g. basePower: T2, bonusDamage: "+1d4 vs fiends"
```
Item flag carries `materialId` and `tier`; effects resolved via the layered resolver.

**Recipe**
```
id, name, category (weapon|armor|focus|...), itemTemplate,
slots: [{ name, drives: <role>, tierFloor, qty }],
overrides: [{ materialId, slot, effect }],     // optional
stationCategory, stationTierMin,
skillWhitelist (research), researchProject: { tier, ... }
```

**Role vocabulary**
- Weapon: `basePower`, `bonusDamage`, `specialAbility`
- Armor/robes: `basePower`, `resistance`, `specialAbility`
- Focus (wand/staff): `spellPower`, `spellSlots`, `specialAbility`
- Custom role: `{ id, appliesTo, modifies (target field), effect }`. REJECT on load if `modifies` is missing.

**Project**
```
id, owner (actor), outcome: unlockFormula{formulaId} | upgradeStation{stationId, fromTier, toTier},
tier, dc, threshold, progress, skillWhitelist[], materials/fee (optional, consumed), status
```

**Node**
```
id, source: explored | placed | corpse,
tier, region, charges, discoveredBy[], state: anchor | active | depleted,
ladder: [{ materialId, dcOffset, quantity ("1d4"), guaranteed }],
decayTimer (corpse only)
```

**Region**
```
id, sceneTag, spawnTable (weighted node types), explorationDC, daysRequired
```

**Station**
```
id, name, category, tier,
location: fixed{town} | carried{holder},
owner (actor|null), access (permission list)
```

**Commission**
```
id, patron (actor OR lightweight {name}), crafter (actor), formulaId, itemSpec,
status, materialsFrom: npc|crafter (default crafter), payout,
teaches: none|progress{amount}|fullCopy (default none), formulaAccess: loan|copy
```

**PendingAction**
```
id, actor, type (research|explore|upgrade|commissionStep|...), params, daysReserved, submittedAt
```

## Validation
Run schema validation whenever definitions load. Errors must name the pack, entry, and field.
