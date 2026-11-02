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
- **The item class decides the trigger**: weapon on hit, bomb/consumable on use, armor and trinket passively while worn. Build once per class. (Corrected in v0.22.0 decisions below: worn classes cannot apply a condition.)
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

## Built as (v0.21.0, first half): interpretations to review
Added by Claude Code while building; the numbered answers that came with the approval win over anything here. Anything marked **check** is a reading of the brief that is worth a second look.
- **Tier tables follow the material's own tier.** A material has ONE tier, so a T1 to T5 table for the dice or a resistance amount compiles to the row for that material's tier. The other rows are kept in the saved blocks (so changing the tier changes the result), but only one row is ever applied. **check**
- **The power tier is a field of the effect set**, not a block: "Base power tier" compiles to `basePower`, and to `spellPower` on a focus (a focus drives spell power). "Every class" means base power.
- **One block per type per class** (a role holds one value). A second Add damage in the same class is refused (the button turns off).
- **Blocks the engine can apply today:** Add damage (`bonusDamage`), Grant resistance (`resistance`), Special ability text (`specialAbility`). Conditions, afflictions and Adjust are 0.22.0. Spell slots and custom roles written by hand are kept untouched ("kept as it was").
- **Classes.** weapon, bomb, consumable, armor, robes, focus, trinket (`ITEM_CLASSES` in config, with when each applies: on a hit, when used, while worn). Bomb, consumable and trinket have no recipes yet; the role tables for them are in `data/roles.js`.
- **Slot fit is derived,** as agreed: a material fits a slot when its tier is high enough and it has an effect for every role the slot drives. The preview says which roles it fills for the picked class. There is no category field.
- **The preview has the three stages from the design** (v0.21.1; 0.21.0 built only the last): just picked up, after studying, after a successful craft in the picked class, each built from `stripForPlayer` and the Hub's own Compendium view-model. An item whose study has no properties milestone says that studying teaches formulas, not what it is good for. **check**
- **A DC in ability text is allowed but flagged** in the preview ("players would read it on the item; the Hub hides it"), because an item's own description cannot hide it.
- **Players-may-know confirmation** covers a material's tag, its effects (blocks, class table) and a tag's theme/name, when any character's Compendium (or the shared book) shows the material learned or its properties milestone reached.
- **Edits of pack items are world patches** (`mode: "patch"`); nothing is ever written to the packs. Definitions that exist only in memory are left alone and cannot be edited.
- **Deleting** is allowed only for something made in the editor and unused; a pack item can only be retired.
- **Notes:** a Plan note is a short study (3 steps) that teaches its formula, a Research note a longer one (8 steps); both numbers are `DISCOVERY.notePresets`.
- **Export / import** shipped in 0.21.0 (plain JSON, clashes skipped with a reason unless replace).
- **The old Discovery tracks window is gone;** its rows, validation and layout live in the editor, and its overlay is folded in (`api.editor.foldOverlay`) with a **Leftovers** list for anything whose item no longer exists.

## v0.22.0 decisions (2026-11-01, Nate's answers to the 0.22.0 plan; THESE WIN over everything above)
Afflictions are OUT (PF2e 8.6.1 refuses to construct them). There is no "Apply an affliction" block and no "push stage". Persistent poison is an Add damage block with Persistent ticked. Hidden difficulty stands: `stripForPlayer` is the only gate, and condition values, save types and DCs never reach anything a player can read.
- **Split.** 0.22.0 = Apply a condition + GM hook + card + plain words. 0.22.1 = Adjust + trinket.
- **Probe first.** `docs/probes/11d-targets-probe.md` (console snippets, not module code) settles the PF2e 8.6.1 message shapes, targeting, condition API, persistent damage and FlatModifier questions before 0.22.0 is built.
- **Worn classes (armor, robes, focus, trinket) cannot use Apply a condition.** `setProblems` refuses it and the builder hides the block. This corrects the earlier "while worn" trigger line. Triggers: weapon, bomb and consumable only.
- **Adjust is CROSS-MATERIAL.** It amplifies the damage blocks supplied by OTHER slots in the same craft (a plan-time pass). If no other slot adds damage it does nothing, and the preview says so.
- **Trinket.** New role `wornDamage { type, flat }`, compiled to a PF2e `FlatModifier` on the wearer's damage of that type (persistent included if the probe says it works). Flat only.
- **Several Apply a condition blocks per class are allowed.** One Apply on the card runs all of them: one secret save per effect per target.
- **"No save" option.** The condition applies automatically when the GM presses Apply.
- **Save outcomes.** Critical failure: condition value +1 (capped at 4). Failure: the value. Success and critical success: no effect. Valueless conditions: same as failure.
- **Duration.** PF2e's normal rules; the GM removes it by hand. No timers in 0.22.0.
- **Condition dropdown is a short curated list, not all 44.** Proposed (Nate vets it): valued Frightened, Sickened, Clumsy, Enfeebled, Stupefied, Slowed; valueless Off-guard, Prone, Dazzled, Fatigued. Slugs are checked against `CONFIG.PF2E.conditionTypes` in the probe.
- **Triggers.** Weapon = attack roll with outcome success or critical success. Bomb = attack roll with any outcome except critical failure (the GM decides on the card). Consumable = the use card. An unknown or targetless message = the fallback card.
- **Target.** Roll the save and apply the condition on the TARGET TOKEN's actor (`token.actor`), never the world actor, so unlinked tokens work.
- **The Apply result stays GM-only.** The whisper card is edited to show it. Nothing public.
- **Item text.** At craft the item description gets the plain-words line (for example "makes the target fearful"). Never condition values, save types or DCs.
- **Recipes.** Edit only throwaway / `g21-` recipes. For anything under `content/recipes` that looks like real campaign content, do not edit it; list the exact one-line `drives` change instead.
- **Persistent poison already works natively** (probe results, 2026-11-01): the Add damage block with Persistent ticked makes the damage roll carry a persistent poison term, and applying the damage card adds a persistent-damage condition. Poison needs no hook.
- **Secrecy note for the build.** `recordClassFact` copies full role values into the player-readable Compendium book, so a `forPlayer(role, value)` filter must turn `applyCondition` into a plain marker before anything is written there, to the preview or to an item.

## Built as (v0.22.0): interpretations to review
Added by Claude Code while building. Anything marked **check** is a reading worth a second look.
- **Roles and recipes.** `applyCondition` is a new role (an array) for weapon, bomb and consumable. A recipe slot must list it in `drives`; the real recipes under `content/recipes` were NOT edited (for the Spider Fang Dagger the change is one line, listed in `docs/21`). The gate uses in-memory `g21-` recipes.
- **No "Every class" condition.** `setProblems` refuses it on the general set (a general effect would reach worn classes); the builder offers the block on Weapon, Bomb and Consumable only. **check**
- **Blocks are told apart by position.** Several condition blocks per class are addressed by `data-index` (the nth block of that type); the other block types still allow one per class.
- **One condition once per class.** Setting the same condition twice in one class is a problem the editor names. **check**
- **Value 1 to 4.** `EFFECTS.maxValue`; a valueless condition (Off-guard, Prone, Dazzled, Fatigued) has no value control and applies on any failure; "No save" applies at once with no bump.
- **Several targets.** A weapon or bomb card names the attack's own target (`context.target` holds only the first). A consumable card names every target the roller has targeted. A fallback card takes the GM's own targets, else the tokens the GM has selected, when Apply is pressed.
- **Dedupe.** By message id for everything, and by the item's `origin.uuid` for ten seconds for a consumable (PF2e posts a second card when Use is pressed on the first).
- **The result stays on the card.** The whisper is edited to "Gate Goblin A is fearful, is knocked down." / "shrugs it off", plain words only, no value, save, degree or DC; those are in `api.gm.log`.
- **The Compendium book** stores `applyCondition` as `{ plain: [lines] }` in all three places a role value is written (a class fact, a per-recipe fact, a formula's baseline), so the preview and the Hub show "makes the target fearful" and nothing else. The item description gets the same line at craft.
- **The card is a `.pfp-hub`** (so the Hub's reset and button rules apply in the chat log); the layout harness draws it pending and done at 900 to 220px in every hostile sheet.
