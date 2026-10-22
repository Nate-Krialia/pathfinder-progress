# 09 Build Order

Build in stages. Each stage must pass its test gate before the next begins. Load only the relevant spec files per stage.

## Stage 0: Scaffold
Module manifest, config file for tunables, socketlib dependency, empty adapter file.
**Gate:** module loads in a test world with no errors.

## Stage 1: Data model + adapter + validation
Schemas, layered resolver, compendium pack definitions, PF2e adapter (item flags, level DC, creature level/traits). Seed a few materials (iron, silver, starmetal) and one recipe.
Specs: `01`, `08`.
**Gate:** invalid entries fail loudly with clear messages; resolver returns override over default.

## Stage 2: Crafting core
Slot matching, tier floors, role-driven effects, craft check, success/failure/crit, per-unit loss rolls, provenance flags. Test without stations first (fixed fee stub).
Spec: `03`.
**Gate:** unit tests for each degree of success and the loss roll distribution.

## Stage 3: Stations
Station records, fixed vs carried, tier cap, fee by tier, access list.
Spec: `07`.
**Gate:** crafting is blocked when category or tier mismatches; fee deducted correctly.

## Stage 4: Gathering
Node tokens with flags, DC ladder, visible roll + hidden rung rolls (GM client), charge burn, node tier scaling.
Spec: `04`.
**Gate:** a scripted gather produces iron always on pass, nothing on fail, higher rungs only on their hidden rolls; charge burns on every attempt.

## Stage 5: Research engine + formulae
Projects, daily check, degree-to-progress mapping, skill whitelist, threshold unlock, formula ownership.
Spec: `02`.
**Gate:** a project unlocks its formula at threshold; tier scales DC and threshold.

## Stage 6: Queue + GM review
`pendingActions`, day reservation, GM login scan, review window, resolve in order.
Spec: `08`.
**Gate:** offline submission resolves correctly on GM login; no over-booking.

## Stage 7: Exploration
Regions, scene-tag pool, anchor activation by degree, prepare-without-launch.
Spec: `05`.
**Gate:** expedition prepares a tagged scene with the right number of active nodes; corpse nodes created after a fight.

## Stage 8: Commissions
World list, player-to-player flow, GM-issued flow, formula loan/copy, `materialsFrom`, `payout`, `teaches`.
Spec: `06`.
**Gate:** loan lets a crafter craft once without keeping the formula; `teaches: progress` adds progress; duplicates handled.

## Stage 9: Workshop upgrades
`upgradeStation` outcome on the research engine, consumed materials and fee.
Specs: `02`, `07`.
**Gate:** upgrading raises tier and fee.

## Stage 10: Downtime Hub UI
Tabs for Research, Explore, Commissions, Workshop, Formulas; gather dialog polish; GM commission creator; "Save to compendium".
Spec: `08`.
**Gate:** full play-through of one research, one expedition, one gather, one commission.

## Stage 11: Tuning
Replace placeholder numbers in config; author trait-to-material mapping for corpses.
