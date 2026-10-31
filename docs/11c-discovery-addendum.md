# 11c — Discovery chain addendum (decisions from the 2026-10-31 design chat)

Where this disagrees with `11-hub-design.md` or `11b-hub-addendum.md`, THIS FILE WINS. Numbers are Stage 12 placeholders.

## Round plan change
- **11c = discovery chain** (this file) plus the two 0.19.2 leftovers and the gold-value fix.
- **11d = Explore + Workshop** (the old 11c, including the real gate for gather summaries).
- **11e = Commissions + GM Downtime Control.** Then Stage 12 tuning.

## How a player learns a blueprint exists (answers the old open question)
Two routes only. Neither unlocks anything instantly; both end in a Research project.
1. **Researching a material they hold.** A material item in the character's inventory that has a research track and has not been researched is offered as a lead in "Leads you could follow". Following it costs nothing until days are spent.
2. **A blueprint / research note held as a Foundry item in inventory.** The Hub reads the item and offers the matching lead. The note can carry its own research thresholds too. (The GM-only `api.research.giveLead` stays as a backup route.)

## Research thresholds are GM-configurable data, per item (decided)
- Item creation (materials and notes) gets an OPTIONAL research block: an ordered list of milestones, each with a step threshold and what it grants (e.g. properties, a blueprint).
- Items WITHOUT a research block have no track: they never offer a lead. Their properties are **known on pickup** and they are usable straight away (decided; e.g. common iron needs no research).
- Items can have only some milestones (e.g. properties but no blueprint).
- The 4 steps (properties) and 8 steps (T1 blueprint) below are only the DEFAULTS the GM starts from when adding a track, not rules.
- Thresholds are GM-only data. Players never see them, not even in the relayed definitions (hidden difficulty).

## The default research track for a material (one project, milestones)
- **Default 4 steps:** the material's properties are learned. It gets a Compendium entry, and its general crafting use is unlocked.
- **Default 8 steps:** the **tier 1** blueprint it can make is learned (example: Mitflit Brain -> Cowardice Bomb, T1 only).
- "Steps" are the existing research steps (a big success is +2). Researching does NOT consume the item.
- Players only see plain words about what a part seems related to. No thresholds, counts or "N more materials" anywhere (hidden difficulty still holds).

## Two separate axes (do not merge them)
- **Material tier** changes how strong a craft is, through slot effects learned via Experiments. A T2 material in the T1 bomb makes a better T1 bomb.
- **Blueprint version** is a different recipe with its own slots (Cowardice Bomb vs Greater Cowardice Bomb). It is earned separately.

## Tags and higher versions
- A tag (e.g. cowardice) is a data field on the material definition; the GM controls which materials share one.
- Researching OTHER materials that carry the same tag can open a higher version of the blueprint family.
- Default (placeholder, tune in Stage 12): finishing the properties milestone on a second, different tagged material makes the greater version appear as a NEW lead, which still has to be researched. It never unlocks instantly. The GM-set thresholds on the blueprint version decide how long that research takes.

## Source of materials: corpse loot is not a node
- Looting a corpse and gathering from a node are different things. Corpse loot is not a Node: no hidden token, no Perception DC, no charges, no downtime days.
- The discovery chain keys off items in inventory, so it does not care where the item came from. How corpse loot is generated (GM places it by hand, or the Stage 12 trait-to-material table) is out of scope for 11c.

## Gold value (answers the old open question)
- Every material definition carries a FIXED gold value. The GM relays it with the materials a character owns, so the player copy now has it.
- Restores "materials are worth X", "buying this in a shop would be about Y", "you save about Z". The shop price formula stays a placeholder.
- Shown only for materials the character has discovered.

## Small leftovers from the 0.19.2 report (also in 11c)
1. With no GM connected, Share / Cancel / Put aside / Start researching say "Couldn't queue the craft..." Wording must fit the action.
2. A relay that never answers shows nothing and leaves buttons pressable: disable the button while a request is in flight, and after a few seconds show "The GM didn't answer, try again".

## Material effects: tag themes and item classes (decided 2026-10-31, supersedes 11b where they differ)
- A material's TAG carries a theme (e.g. Mitflit parts: cowardice, which works with "frightened"). Reaching the properties milestone teaches the player the tag and its theme in plain words. It does NOT teach how the material behaves in each item class.
- How a material behaves in each item class (weapon, armor, consumable, ...) is for the players to discover by crafting (Experiments).
- Default: the effect is GENERAL per item class. All armors get the same effect from a material unless a recipe says otherwise.
- Knowledge is recorded per material per item CLASS (not per exact recipe), so one successful armor craft teaches the effect for all armors. Only a successful craft teaches (11b rule stays).
- Specific recipes may define an OVERRIDE for a material. Overrides are learned per material per recipe by a successful craft, as in 11b.
- Items with no research track: tag and theme known on pickup; class behaviour is still discovered by crafting.
- This replaces 11b's "per material, per recipe only" recording and the earlier idea that properties reveal the default effect everywhere.

## How 11c was built (v0.20.0)
Details are in `CHANGELOG.md` 0.20.0, `docs/08-foundry-integration.md` (the discovery chain section) and `docs/19-stage11c-gate.md`. In the code a "blueprint" in this chain is a recipe formula (the Hub says Formula); workshop designs are not part of 11c.
