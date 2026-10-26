# 02 Research

## Purpose
Formulae are unlocked by accumulating progress toward a known goal. The same engine also runs workshop upgrades (see `07-stations.md`).

## Loop
- A **project** has a goal (`outcome`), a **tier**, a **threshold**, and a **progress** track.
- **Time is the backbone**: one check per downtime day, fully automated. A day spent researching cannot be spent elsewhere.
- The roller picks any skill from the project's **skill whitelist** (e.g. `["arcana","crafting","occultism"]`). Research skill does not need to match the later Crafting check.
- When progress >= threshold, the outcome fires (formula unlocks, or station upgrades).

## Scaling by tier (placeholders)
Both DC and threshold scale with tier; threshold does most of the work.

| Tier | DC | Threshold |
|---|---|---|
| 1 Simple | level DC - 2 | 8 |
| 2 Standard | level DC | 12 |
| 3 Advanced | level DC + 2 | 18 |
| 4 Master | level DC + 4 | 26 |
| 5 Legendary | level DC + 6 | 40 |

Use PF2e's level-based DC table via the adapter.

## Degree of success -> progress (placeholders)
| Degree | Progress |
|---|---|
| Critical success | 2 |
| Success | 1 |
| Failure | 0 (may grant 1 insight toward practice) |
| Critical failure | 0, possible setback |

## Supplements (only sketched, design before building)
- **Practice**: crafting things related to the goal grants banked insight or a bonus to the next research check.
- **Discovery**: specimens, a master's notes, or a ruined forge grant a chunk of progress or lower the threshold. Commissions with `teaches: progress` use this path (see `06-commissions.md`).

## Optional costs
A project may list materials and a fee consumed at start or completion (required for station upgrades).

## Notes
- Days are reserved when the action is queued so players cannot over-book.
- Resolution occurs via the GM-reviewed queue (see `08-foundry-integration.md`).
- The project's goal (the recipe's name) is visible to the researcher. The recipe's contents are hidden from players' interface only, as an honor system: Foundry does not stop a player reading them from the browser console (see `10-stage2-decisions.md`).
- Each research result records the natural d20 and the total, so a degree can be audited. The built shape of projects and the tier table is in `10-stage2-decisions.md`.
