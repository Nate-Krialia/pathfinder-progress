# 22 Tag system, Slice 1: the ledger, slots that match by tag, GM tagging

Decisions from Nate (2026-11), on top of the plan in the planning chat. Slice 1 only: tag effects, stacking, caps, nested inheritance, the veto twist, charges and crafter-choice effects are LATER slices. Gathering outputs stay specific.

## Data model (option C)
- **Tag ledger**: a GM-only WORLD setting `tagLedger` = `{ v: 1, items: { "<itemRef>": { tags: [tagId], tier?: 1..5, name?: string } } }`. `itemRef` = a material id for a material, a recipe id for a crafted item (a later slice), an item UUID for any other PF2e item. Read only by the GM client (`scripts/tags/state.js`, `current.js`); a player client never reads it and never receives it.
- **An item can carry several tags.** A material's single `tag` keeps working: it is read as the FIRST of the material's tags (migration on read, `effectiveTags`); nothing stored is rewritten.
- **A PF2e item with no material record** can fill a slot only once the GM has tagged it AND given it a tier (PF2e items have none; effects will scale by the contributing item's tier) and a name to show. The editor (`api.tags.setEntry`) refuses to save an entry without a tier or a name. A material's entry may leave the tier out (it keeps its own); a ledger tier beats the material's.
- **Tag definition** gains `priority` (whole number -1000..1000, default 0, GM-set). Stored and edited only; later it breaks ties between equal-tier tags when tags are passed up in nested crafts (highest tier, then priority, then alphabetical). A player's copy of a tag drops it.
- **Recipe slot** gains `needs: { all: [tagId], optional?: bool }`. A slot WITHOUT `needs` behaves exactly as before (tier floor, any material). With `needs`: the item must carry every tag and be at or above `tierFloor`. A required tagged slot must be filled; an optional one may stay empty. Validation: every needed tag must exist, no tag twice.

## `tierFloor` is optional
On every slot, tagged or not: left out it is 1 (no floor). The loader writes the 1 in (`validate.js`), so everything downstream still sees a number. An out-of-range value is still an error.

## What fills a tagged slot
`scripts/tags/ledger.js` `slotFit`. The player picks one item id per slot as before (`selection: slot -> id`; for an ordinary item the id is its UUID). `planCraft` (`scripts/crafting/plan.js`) uses a stand-in material for a ledger-only item: it has NO effects, so in S1 such an item fills a slot and adds nothing for the roles the slot drives (an old slot, or a material, still errors on a missing effect). The recipe still needs a material in its base-power slot to pick the output tier.
- Ordinary items count as stacks (`adapter.getMaterialStacks`) while tagged. An item can be tagged under any of its references, tried in this order (`adapter.itemRefCandidates`), the first one in the ledger wins:
  1. `_stats.compendiumSource` (PRIMARY): Foundry's "compendium document this was imported from" (v14 DocumentStats; v13 migrates the old flag into it).
  2. `_stats.duplicateSource`: the document this one was duplicated from. **UNVERIFIED** that Foundry sets it when a WORLD item is dropped on an actor; if it names another actor's copy it matches nothing.
  3. `flags.core.sourceId`: the legacy field `compendiumSource` replaced; kept as a fallback.
  4. the item's own `uuid`.
  What that means: **a compendium item** is one shared entry, so tagging its uuid tags every copy on every actor; **a world item** tagged by its uuid (`Item.<id>`) matches copies only through `duplicateSource`/`sourceId` (UNVERIFIED) and always matches itself; **an item copied onto an actor** matches through its `compendiumSource` (a compendium copy), else `duplicateSource`/`sourceId`, else only if the GM tagged that exact actor copy by its own uuid. The Item tags header button aims the window at the first of these that is already tagged, else at the first that exists.

## Copies that share a source are interchangeable (issue 31)
Several items can carry the same source (copies of one compendium item, all matched by the one tag). Each copy is its own stack under the same reference, and the player picks a REFERENCE, not a copy (the Hub lists one option per source). A craft therefore takes the **first copy in the bag that shares the source**, and the next one if it needs more units (`scripts/crafting/plan.js`, "Take units from this material's stacks"); the player cannot choose, and escrow records only that first copy's data (`scripts/queue/work.js`, `heldOf`), so a cancel or a failed craft hands back copies of it. By design: if two copies must not be interchangeable (a modified one, a renamed one), do not tag them under one source. Gate 22 Steps 11 to 14 print which copy was escrowed and prove it is a copy of the right source and that it comes back, without assuming it is a particular one.

## Players
Never receive the ledger, a tag list, `needs`, a ledger tier or a priority. A player's recipe slot that matches by tag carries `optional` and `fits: [{ id, name }]`: what THIS character holds that fits, computed on the GM client at relay time (`playerDefs.js`, `fitsFor`). The ledger is part of the definitions revision (only its fingerprint is published), so tagging an item makes the lists be worked out again; with a tagged slot in play, a change in how many items a character owns also asks again. The Hub lists exactly `fits` for such a slot and names a stand-in item with no tier or price. Tags a player sees on an item still come only from the existing discovery system (a material's `tag`, once known); S1 shows no tag of a ledger-only item to a player. The leak scan (`findTagLeaks` in `tests/helpers.js`, used by `tests/tags-*.test.js`) fails on any of: a `needs`/`tags`/`ledger`/`priority` key, a tier on a ledger-only item, an extra key in `fits`, a needed tag id inside a slot outside `fits`; its own test plants each leak and checks it is caught.

## GM interface
`api.tags` (GM only): `ledger`, `setEntry`, `removeEntry`, `setSlotNeeds`, `tagsOf`, `tierOf`, `fits`, `open`. The **Item tags** window (scene-controls button, and a header button on any Item sheet that opens it aimed at that item): tag a material or any item by UUID with several tags and a tier, create tags on the fly, set a tag's priority, and set a recipe slot's needs (an editor patch of the recipe, revertable with `api.editor.revert`). Not in the Item editor window itself (S1 decision: a separate small window; the editor's model is large).

## Out of scope in S1 (unchanged)
Tag effects, stacking, caps, inheritance in nested crafts, the veto twist, charges, crafter-choice effects, tag-based gathering.

---

# Slice 2a: tag effects, stacking, caps (decisions from Nate, 2026-11)

Scope: tag effect data and its builder, the stacking engine, the GM's caps, the five existing roles (`basePower`/`spellPower`, `bonusDamage`, `resistance`, `specialAbility`, `applyCondition`) in TAGGED slots. NOT in 2a: slot `kind` (2b), the frozen per-craft store and its cleanup (2b), new roles such as heal / AC / thorns / duration (2c), what players learn by crafting (2d), per-recipe caps, tags adding any condition beyond the curated list.

## Data
- A tag gets `effectBlocks` (`{ general?, byClass? }`, exactly a material's shape: damage, resistance, ability and condition blocks with `{ all }` / `{ byTier }` values, and a base-power `power`). Written through the editor (a patch or a world record), validated at load for every tier T1 to T5. GM-only: a player's copy of a tag drops it (and `priority`).
- Damage and resistance blocks may carry a PF2e `bonusType` (`untyped` default, `item`, `status`, `circumstance`). In 2a it is stored, validated and carried on the stacked result (mixed types in one group read as untyped); no typed modifier is emitted yet (2c).
- **Caps**: world setting `tagCaps` = `{ v: 1, roles: { <role>: { <cap>: n } } }`, over the placeholder defaults in `TAGS.defaultCaps`. Caps: `basePower.maxTier`, `bonusDamage.maxDicePerType`, `resistance.maxValue`, `specialAbility.maxCount`, `applyCondition.maxValue` / `maxCount`. GM only (`api.tags.caps()` / `setCaps()`); edited in the Item tags window. One world-wide table; per-recipe overrides are a later slice.

## What contributes (scripts/tags/contributions.js)
In a slot with `needs`, each ingredient contributes ONCE (quantity is a cost, not a multiplier): its OWN effects (a material's, as before) AND the effects of every tag it carries, each tag at the ingredient's tier (ledger tier, else the material's), for the roles the slot `drives` only. Within one tag the item class's set beats the general set per role. A slot without `needs` never reads a tag and keeps its old one-entry-per-material behaviour; the tagged slots' contributions are merged with each other, not with the old slots'.

## Stacking (scripts/tags/stack.js), then the cap for that role
- power: the HIGHEST tier wins (tiers pick the output item; they do not add).
- damage: same type, die size, persistence and versus: dice counts add (1d4 + 1d4 = 2d4); other die sizes or types stay separate. Cap: dice per damage type; the biggest die is kept first.
- resistance: same type adds. Cap: value per type.
- abilities: all apply; the same title once. Cap: count (first in slot order).
- conditions: all apply; the same condition twice keeps the HIGHER value (and its save). Cap: value per condition and count.
- A cap clamps only its own role. What a cap cut is a GM-only text in `plan.capNotes`, written to the GM log when the craft resolves (`gm.log()`), never to chat.

## Where the result goes
`planCraft` puts the stack into the same `description` buckets (damage dice and rule elements, abilities, resistances, plain condition lines, base tier), so the item, the chat summary and the adapter are unchanged. The effects engine (`effects/resolve.js`) uses the SAME `stackedCraft` for a tagged slot's conditions, resolved again from the CURRENT registry, ledger and caps (2b freezes them per craft).

## A crafted weapon's rules load only while it is held
PF2e ignores the rule elements of a weapon that is not held (`requiresEquipped`), so a freshly crafted weapon shows its `DamageDice` rules as `ignored: true` until the character holds it (`actor.changeCarryType(item, { carryType: "held", handsHeld: 1 })`, or the sheet's carry control). The module does not equip a crafted weapon: the player decides. The rules themselves are valid (proven on real Foundry); gate 24 holds the weapon once before it checks them.

## Players
The crafted item shows its own final stacked numbers, like any material today. Tag lists, tiers, tier tables, caps, effect sets, contributions, priorities and DCs stay GM-only. The canary tests (`tests/tags-wiring.test.js`, `findCanaries`) put odd values into a used tag's other tiers, an unused tag and the caps table and prove none appears in the player's definitions, preview, queue rows, Compendium, actor flags, chat or the crafted item's flags; a planted leak must be found.

## UNVERIFIED
How PF2e treats several `DamageDice` rule elements from one item (the mechanism is the existing one); the use card applying stacked conditions on a real canvas (the S2a gate); typed PF2e bonuses (nothing is emitted yet).

---

# Slice 2b: slot kinds, recipe overrides, frozen craft results, clamp order (decisions from Nate, 2026-11)

## Slot kind
A recipe slot may carry `kind` (a lowercase key such as `blade` or `decoration`); left out, the kind is the slot's own name. A tag's `effectBlocks` gain `bySlot: { <kind>: { general?, byClass? } }`. For one tag, one item class and one slot kind the sets are layered, MOST SPECIFIC FIRST, with ONE WINNER PER ROLE: the recipe's own override, then `bySlot[kind].byClass[class]`, `bySlot[kind].general`, `byClass[class]`, `general` (`scripts/tags/contributions.js` `tagRoles`). Old recipes have no kinds and no `bySlot`, so nothing changes for them. Players never receive a slot's `kind` (the player copy lists its fields by name).

## Recipe override per (tag, slot kind)
`recipe.tagOverrides: [{ tag, slot: <kind>, power?, blocks }]` (the effect builder's blocks): this recipe's own word on what that tag does in that slot kind. It beats the tag's own sets for the roles it names; a role it does not name falls through to the tag's sets. Validated at load: the tag exists, the kind is one of the recipe's slot kinds, a (tag, kind) pair once, every tier T1 to T5 makes a valid value. GM API: `api.tags.setSlotKind`, `setTagOverride`, `removeTagOverride` (editor patches of the recipe: validated, revertable). There is no window for overrides yet; the tag window sets a slot's kind and a tag's per-kind sets.

## Frozen craft results
When a craft with at least one TAGGED slot resolves (the queue and the commission path), the GM client writes `{ recipeId, at, uses[{slot, ref, name, tier, tags}], roles, contributions }` to the GM-only world setting `tagCrafted`, keyed by an OPAQUE id (`freezeId`) that the crafted item carries in its `crafted` flag (nothing else about tags or tiers is on the item). The effects engine (`effects/resolve.js` `effectsOf`) reads the conditions from that record: editing a tag, the ledger or the caps afterwards does not change an item that exists. The write is undone with the rest of the craft if the item cannot be created.
- **Cleanup:** the active GM client removes a record when the last item carrying its id is deleted (hook `deleteItem`). `api.tags.pruneFrozen()` (GM, by hand) removes records no item in the world carries; it searches actors and world items, not unlinked token actors, so it is never automatic.
- **A missing record** (cleaned up, a restored world, an edited setting): the item's tagged conditions are skipped, nothing throws, and the GM log says so once per id.
- **Items made before this slice** have no `freezeId` and keep being worked out live from the current registry, ledger and caps.
- Crafts with no tagged slot are not frozen and get no id.

## Clamp order (a change from 2a)
When a cap cuts abilities or conditions, the contributors kept first are the HIGHEST tier, then the higher tag priority, then alphabetical (by tag name, else ingredient name), then slot order. A repeated condition is ranked by the contributor whose value won. The dice rule is unchanged: the biggest die is kept first.

## Players
Slot kinds, `tagOverrides`, `bySlot` sets, the frozen store and its contents are GM-only. `findTagLeaks` and `findCanaries` cover them; the canary test puts odd values in a kind, an override and a tier table and finds none in a player's definitions, preview, queue rows, Compendium, actor flags, item flags or chat.

## UNVERIFIED
That Foundry fires `deleteItem` for an item deleted along with its actor (the prune is the safety net); `foundry.utils.randomID` as the freeze id on the real client (the fake returns a short id); the commission path was changed the same way as the queue path but is covered by the same freeze helper, not by a commission-specific test.

# Slice 3a: a crafted item as an ingredient

## What it does
- A crafted item that has a frozen record (Slice 2b) is an ingredient under its own reference `crafted:<freezeId>` (first in the item's reference candidates, `adapter/pf2e.js`). It is a stack like any other and can fill a tagged slot.
- Its tags are the ones it was crafted WITH: `native` (the GM's recipe-id ledger tags) now; `inherited` (Slice 3b) later. A ledger entry for a `crafted:` reference is ignored. Its tier is the record's tier, and each tag counts at that tier (`tagTiers`, `tags/ledger.js`).
- Record tier: the GM's ledger tier for the recipe id, else the craft's `baseTier` (the power role), else the highest input tier (a recipe with no base role). NOT the crafter's level.
- A craft freezes when it has a tagged slot, a crafted ingredient, or a ledger entry for its recipe id. The record also holds `depth`: 1 + the deepest crafted ingredient.
- Depth limit: GM setting `limits.maxDepth` (default `TAGS.maxDepth` = 3, whole number 1-6, in the Item tags window's caps panel). Checked in `planCraft`, so it refuses in plain words before anything is spent.
- The outer record keeps a small provenance copy of each crafted ingredient (`uses[i].from`: recipe id, name, tier, depth, native, inherited, uses), so deleting the inner item (and its record) does not break the outer record.
- An old crafted item (no freeze id) or one whose record is gone is simply not an ingredient.

## Escrow
- Queueing a craft takes the crafted item out of the bag. The queued action (an actor flag) carries the item's data and its opaque `freezeId` ONLY. The frozen record stays in the GM-only store, marked `held` (so the delete hook and `pruneFrozen` leave it alone).
- Cancel, reject or a failed craft: THE ITEM comes back (same name, same crafted flag) and its record is released. A used-up ingredient takes its held record with it. This also fixes a Slice 1 gap: a returned tagged ordinary item used to come back as a stand-in material.
- Commission path: freezes the same way; rollback of a crafted ingredient inside a commission craft is not covered (UNVERIFIED).

## Players
- Nothing new reaches a player: the `fits` entry for a crafted ingredient is an opaque reference and the item's name. `findTagLeaks` now also forbids `inherited`, `passCap`, `outputTags` and `native`; the wiring test scans definitions, previews, queue rows, the Compendium, actor and item flags and chat with canaries.

## UNVERIFIED
- Nothing here has run against real Foundry. Held records across a real reload, and a crafted item dragged between actors, are untested.

# Slice 3b: tag inheritance

## Rules (Nate's answers)
- Opt-in per recipe slot: `passCap: true` (the default, `TAGS.passCap` = 2) or a whole number 1-6. A slot without it inherits nothing. A slot can only pass what actually fills it (an empty optional slot passes nothing).
- The cap is per INPUT slot. Each filled slot offers its ingredient's tags, best first: highest tier, then tag `priority`, then alphabetical by tag name; the first `passCap` go up. `scripts/tags/inherit.js` (pure).
- Only TAGS pass, never a stacked effect. Each keeps the tier of the ingredient that brought it; a crafted ingredient passes its own native and inherited tags at THEIR tiers (native at its tier, inherited at the tier stored with them).
- The same tag from two slots is kept once, at the higher tier. A tag the registry no longer has is dropped.
- The GM's recipe-id ledger tags (`native`) sit ON TOP of the cap: they are not counted against it.
- Where it lands: the frozen record's `inherited: [{ tag, tier }]` (GM-only). A craft with a `passCap` slot is frozen even if nothing else is tagged. The item's inherited tags matter when IT is used as an ingredient (its `tagTiers` = native, then inherited); they do not re-apply in the craft that made it.
- `outputTags` (tags a recipe gives its item outright) is deferred to Slice 3c; a load-time cycle warning too.

## Players
- `passCap` is stripped from player recipe copies (the strip builds slots field by field); inherited tags, their tiers and the embedded provenance never leave the GM-only store. `findTagLeaks` and the canary scan cover them.

## UNVERIFIED
- Not run against real Foundry. No editor UI for `passCap`: recipes are authored as text (like `needs`).
