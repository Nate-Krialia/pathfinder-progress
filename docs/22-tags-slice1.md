# 22 Tag system, Slice 1: the ledger, slots that match by tag, GM tagging

Decisions from Nate (2026-11), on top of the plan in the planning chat. Slice 1 only: tag effects, stacking, caps, nested inheritance, the veto twist, charges and crafter-choice effects are LATER slices. Gathering outputs stay specific.

## Data model (option C)
- **Tag ledger**: a GM-only WORLD setting `tagLedger` = `{ v: 1, items: { "<itemRef>": { tags: [tagId], tier?: 1..5, name?: string } } }`. `itemRef` = a material id for a material, a recipe id for a crafted item (a later slice), an item UUID for any other PF2e item. Read only by the GM client (`scripts/tags/state.js`, `current.js`); a player client never reads it and never receives it.
- **An item can carry several tags.** A material's single `tag` keeps working: it is read as the FIRST of the material's tags (migration on read, `effectiveTags`); nothing stored is rewritten.
- **A PF2e item with no material record** can fill a slot only once the GM has tagged it AND given it a tier (PF2e items have none; effects will scale by the contributing item's tier) and a name to show. The editor (`api.tags.setEntry`) refuses to save an entry without a tier or a name. A material's entry may leave the tier out (it keeps its own); a ledger tier beats the material's.
- **Tag definition** gains `priority` (whole number -1000..1000, default 0, GM-set). Stored and edited only; later it breaks ties between equal-tier tags when tags are passed up in nested crafts (highest tier, then priority, then alphabetical). A player's copy of a tag drops it.
- **Recipe slot** gains `needs: { all: [tagId], optional?: bool }`. A slot WITHOUT `needs` behaves exactly as before (tier floor, any material). With `needs`: the item must carry every tag and be at or above `tierFloor` (still required in the schema; write 1 for "no floor"). A required tagged slot must be filled; an optional one may stay empty. Validation: every needed tag must exist, no tag twice.

## What fills a tagged slot
`scripts/tags/ledger.js` `slotFit`. The player picks one item id per slot as before (`selection: slot -> id`; for an ordinary item the id is its UUID). `planCraft` (`scripts/crafting/plan.js`) uses a stand-in material for a ledger-only item: it has NO effects, so in S1 such an item fills a slot and adds nothing for the roles the slot drives (an old slot, or a material, still errors on a missing effect). The recipe still needs a material in its base-power slot to pick the output tier.
- Ordinary items count as stacks (`adapter.getMaterialStacks`) while tagged, matched by `item._stats.compendiumSource` (else `flags.core.sourceId`, else its own uuid). **UNVERIFIED against real PF2e items.**

## Players
Never receive the ledger, a tag list, `needs`, a ledger tier or a priority. A player's recipe slot that matches by tag carries `optional` and `fits: [{ id, name }]`: what THIS character holds that fits, computed on the GM client at relay time (`playerDefs.js`, `fitsFor`). The ledger is part of the definitions revision (only its fingerprint is published), so tagging an item makes the lists be worked out again; with a tagged slot in play, a change in how many items a character owns also asks again. The Hub lists exactly `fits` for such a slot and names a stand-in item with no tier or price. Tags a player sees on an item still come only from the existing discovery system (a material's `tag`, once known); S1 shows no tag of a ledger-only item to a player. The leak scan (`findTagLeaks` in `tests/helpers.js`, used by `tests/tags-*.test.js`) fails on any of: a `needs`/`tags`/`ledger`/`priority` key, a tier on a ledger-only item, an extra key in `fits`, a needed tag id inside a slot outside `fits`; its own test plants each leak and checks it is caught.

## GM interface
`api.tags` (GM only): `ledger`, `setEntry`, `removeEntry`, `setSlotNeeds`, `tagsOf`, `tierOf`, `fits`, `open`. The **Item tags** window (scene-controls button, and a header button on any Item sheet that opens it aimed at that item): tag a material or any item by UUID with several tags and a tier, create tags on the fly, set a tag's priority, and set a recipe slot's needs (an editor patch of the recipe, revertable with `api.editor.revert`). Not in the Item editor window itself (S1 decision: a separate small window; the editor's model is large).

## Out of scope in S1 (unchanged)
Tag effects, stacking, caps, inheritance in nested crafts, the veto twist, charges, crafter-choice effects, tag-based gathering.
