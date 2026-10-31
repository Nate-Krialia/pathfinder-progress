# 11c Discovery addendum (Stage 11c, v0.20.0)

**Where this file disagrees with `docs/11b-hub-addendum.md`, THIS FILE WINS.** The rest of the Stage 11c design (the discovery chain, the gold value, the leftovers) is recorded in `CHANGELOG.md` 0.20.0 and `docs/19-stage11c-gate.md` as it is built.

## Material effects: tag themes and item classes (decided 2026-10-31, supersedes 11b where they differ)
- A material's TAG carries a theme (e.g. Mitflit parts: cowardice, which works with "frightened"). Reaching the properties milestone teaches the player the tag and its theme in plain words. It does NOT teach how the material behaves in each item class.
- How a material behaves in each item class (weapon, armor, consumable, ...) is for the players to discover by crafting (Experiments).
- Default: the effect is GENERAL per item class. All armors get the same effect from a material unless a recipe says otherwise.
- Knowledge is recorded per material per item CLASS (not per exact recipe), so one successful armor craft teaches the effect for all armors. Only a successful craft teaches (11b rule stays).
- Specific recipes may define an OVERRIDE for a material. Overrides are learned per material per recipe by a successful craft, as in 11b.
- Items with no research track: tag and theme known on pickup; class behaviour is still discovered by crafting.
- This replaces 11b's "per material, per recipe only" recording and the earlier idea that properties reveal the default effect everywhere.
