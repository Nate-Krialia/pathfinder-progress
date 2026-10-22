# 05 Exploration

## Concept
Exploration is an **expedition**: the party goes out, fights what they find, and the map comes seeded with gathering nodes. It produces a scene, not a single node.

## Regions
A region record: `sceneTag`, `spawnTable` (weighted list of node types), `explorationDC`, `daysRequired`.
- The scene pool is a Foundry query: all scenes tagged with the region's `sceneTag`. No separate list to sync.
- `daysRequired` is region-defined (nearby wood = 1, distant mountain = 3). Reserved from the player's downtime days when queued.

## Anchors
**Anchor points** are hidden node tokens the GM places on scenes ("a node could spawn here"). Hand-made maps stay hand-made.

## Expedition flow
1. Player queues an expedition (region chosen; days reserved).
2. On GM resolution: roll the exploration check vs the region DC (resolve on GM client).
3. Pick a random scene from the region's tagged pool.
4. The degree of success decides **how many anchors activate** (crit success = many, success = normal, failure = few, crit failure = one). Roll the spawn table to decide each activated node's type.
5. **Prepare only; do not launch.** The module stops after preparing the scene. The GM activates the scene when the party is ready.
6. Combat is whatever the scene was built to be. The check does not alter encounters.
7. Corpses created during the fight become corpse nodes (see `04-gathering.md`), so one expedition can yield all three node sources.

## Deferred
- Procedural map generation.
- Fallback blank scene if a region has no tagged scenes (not decided; raise with the user before building).
- Anchor counts per degree are placeholders in config.
