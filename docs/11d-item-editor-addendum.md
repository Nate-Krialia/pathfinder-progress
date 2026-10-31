# 11d — Item editor + Material creator addendum (decisions from the 2026-10-31 design chat)

Where this disagrees with earlier design files, THIS FILE WINS. Numbers are Stage 12 placeholders.

## Round plan change
- **11d = Item editor + Material creator + effect builder** (this file), plus the must-do fixes below.
- **11e = Explore + Workshop** (see `11e-explore-workshop-addendum.md`, including the real gate for gather summaries).
- **11f = Commissions + GM Downtime Control.** Then Stage 12 tuning.
- Reason: Nate wants to design real materials now, and everything after the editor can then be built and tested with real content instead of throwaway "Gate" data.

## Must-do fixes carried into the first 11d prompt (from the 11c gate)
1. `api.discovery.tracks.clear` must work for an ORPHANED overlay (key whose item no longer exists); today it throws `unknown item "material:g7-plain"`. Deleting a material in the editor makes this a real case.
2. Gate 19 CLEANUP (and SETUP's refusal message) must be able to clear the Gate overlay after the GM window was reloaded and the fake definitions are gone.

## Scope of v1
- One GM-only window that edits **materials and notes** (plan notes and research notes). The existing Discovery tracks editor folds into it as the "Research track" section.
- Later rounds: recipes/formulae next (they need materials to exist), then creatures, regions, node types and stations.

## Material creator
- Creates BOTH halves in one step: the **definition** (all fields below) and a **real Foundry item linked to it**, so the GM can drag it into a loot actor, chest, find or inventory. Notes work the same way.

## Editing rules
- A definition is referenced by id; the Foundry item only points at it. **Editing a definition changes every existing copy** immediately.
- The editor warns before changing something players may already know (tag, theme, class effects).
- Deleting a material that is in use is blocked, or at least shows what uses it.

## Material fields (v1)
- Basics: name, image, description players read, **category** (which recipe slots it fits), tier (T1 to T4), fixed gold value, bulk.
- Discovery: tag + theme (the plain-words text learned at the properties milestone), optional research track (milestones; "Add the default track" stays: 4 steps properties, 8 steps T1 formula).
- Effects: class effects (per item class, default general per class) and optional per-recipe overrides.

## Effect builder (inside the editor)
- Effects are assembled from building blocks:
  - **Apply a condition** (condition + value), e.g. Mitflit parts: Frightened 1; giant insect parts: Sickened.
  - **Apply an affliction** (poison or disease with stages: save type, tick rate, what happens at each stage), following PF2e's affliction format. e.g. scorpion parts in a weapon or bomb apply a poison.
  - **Add damage** (type + dice), e.g. extra poison damage.
  - **Grant resistance** (type + amount), e.g. scorpion parts in armor: poison resistance.
  - **Adjust** (replaces the old "Amplify"), three modes: *more damage* (flat bonus or bigger dice), *push an affliction's stage forward*, *push an affliction's stage back* (also covers antidote-style materials). e.g. scorpion parts in a trinket.
- **The item class decides the trigger**: weapon on hit, bomb/consumable on use, armor and trinket passively while worn. Build once per class.
- **Values can scale with material tier** (e.g. Frightened 1 at T1, 2 at T3), set per tier in the builder.
- **Conditions and afflictions allow a saving throw** (decided): the builder picks the save type per effect (e.g. Will for Frightened, Fortitude for Sickened); the DC comes from the crafted item.
- The builder generates the **plain-words line** players see ("makes the target fearful"), never numbers they should not see.
- The builder can only offer blocks the craft engine can actually apply. Claude Code's plan must report what effect shapes the engine supports today, and whether PF2e 8.6.1 exposes afflictions in a form the module can apply and shift. If not, fall back to damage-only Adjust and say so.

## Window layout
- Left: list of materials and notes with search, filter chips and collapsible groups (as the tracks window works today; must scale to hundreds of items).
- Middle: editor sections (Basics, Discovery, Research track, Effects).
- Right: a live **"What players see" preview panel** showing the player's view of the item at each stage (before research, after the properties milestone, after a craft teaches the class effect): plain-words lines, never numbers or thresholds.

## Export / import (not yet decided for v1)
- Proposed: export selected or all materials and notes to a JSON file; import into this or another world with a preview of what would be added or overwritten. Nate has not decided whether it is in v1. The plan should cost it as a separate item so the decision can be made with real numbers.

## Still open
- Category matching is an ASSUMPTION from the design docs (slots accept materials by category); Claude Code to confirm how materials match slots today.
- Where editor content is stored: the working assumption is the WORLD, never the public repo.
- Recipe editor design (next after 11d).
