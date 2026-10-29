# 10 Stage 2 Decisions (crafting core)

Decisions made while building Stage 2. Where this file and `01-data-model.md` / `03-crafting.md` disagree, this file is newer.

## Recipe changes (replaces parts of `01-data-model.md`)
- `itemTemplate` is **removed**. `output` replaces it: a map of base-tier -> item reference, e.g. `{ "1": "Dagger", "2": "Dagger" }`.
- The tier used is the one the recipe's **base role** resolves to (`basePower` for weapon/armor/robes, `spellPower` for focus; override with `baseRole`). Exactly one slot may drive it.
- A recipe with no base role uses `output: { "default": uuid }`.
- Every tier a qualifying material could produce must have an `output` entry (checked on load). Each reference is also resolved against PF2e at ready time; a bad one marks that recipe uncraftable.
- `craftLevel` (0 to 25) sets the craft DC via the PF2e level-DC table. It is constant per recipe, so material quality never changes the DC.
- `resultName` (optional) names the crafted item; default is the base item's name.
- `slots[].drives` is a role name **or an array of roles** (one fang can drive `bonusDamage` and `specialAbility`). An override on a multi-role slot must name its `role`.
- Optional `lossChance` (0 to 100) on a slot or a material.
- **One material type per slot.**

## Output references
An `output` value is one of:
- an item **name**: `"Dagger"`
- **`"Pack: Name"`** to disambiguate: the prefix is a pack id or label, and counts only if it names a searched pack (`"world.homebrew: Dagger"`)
- a full **UUID** (escape hatch): `"Compendium.pf2e.equipment-srd.Item.<16-char id>"`

Names resolve at ready time against the **"Item packs for recipe outputs"** setting (default `pf2e.equipment-srd, world.*`; `world.*` means every world Item compendium). Matching is exact, ignoring case and surrounding spaces.

- **Zero matches or several matches never guess.** The recipe is marked uncraftable and the error names the recipe, the reference, and what was found (every candidate with pack, type and UUID). Other recipes keep working.
- A string that starts `Compendium.` or `Item.` must be a well-formed UUID; it is never treated as a name.
- Resolved references are cached for the session. Failures are not cached. `api.reload({ fresh: true })` clears the cache.
- Resolved UUIDs live in `api.resolvedOutputs` (recipe id -> tier -> UUID); the core code only ever crafts from those.

## Role value shapes
| Role | Value |
|---|---|
| `basePower`, `spellPower` | tier reference `"T1"` to `"T5"` (picks the output item) |
| `bonusDamage` | `{ dice: "1d4", type: <damage type>, persistent?: bool, versus?: <trait slug> }` |
| `specialAbility` | `{ title, text, on?: "hit" or "criticalHit" }` |
| `resistance` | `{ type: <damage type>, value: 1..50 }` |
| `spellSlots` | integer >= 1 (recorded in the description only for now) |
| custom role | number, string or boolean written to its `modifies` path (`system.*`, never `system.rules`) |

`basePower` and `spellPower` allow one slot. The other roles stack.

## How effects reach the PF2e item
Done only in `scripts/adapter/pf2e.js`, as rule elements on `system.rules`, scoped to the crafted item's own damage rolls:
- `bonusDamage` -> `DamageDice` (`category: persistent`, `predicate: target:trait:<versus>`)
- `specialAbility` -> `Note`
- `resistance` -> `Resistance`

Rule elements cannot apply a condition on a hit by themselves (`GrantItem` does not work on physical items), so an on-hit effect appears as note text on the damage roll.

## Craft rules as built
- Loss chance per unit: slot override > material override > default (50%). A unit is lost when its d100 is <= the chance.
- The fee is spent on every degree. It comes from the station's tier (Stage 3; the Stage 2 `stubFeeGp` is gone).
- **Thrifty craft is OFF** (`CRAFTING.thrifty.enabled`) until confirmed.
- Stage 2 entry point is GM-only: `api.craft({ actor, recipeId, selection, degree? })`. `degree` forces a result for testing. Player-facing flow comes in later stages.

# Stage 3 decisions (stations)

## Locations without a map
- A **town** is a definition kind (`{ kind: "town", id, name }`). A station's `town` must name a defined town, so a typo fails at load.
- A crafter's location is resolved most-specific-first: **actor override** (flag `location`) > **party location** (world setting `partyLocation`) > nowhere. Set them with `api.setLocation(townId)` and `api.setActorLocation(actor, townId | null)`.

## Where station data lives, and the join
- Compendium `station` definition: fixed facts `{ id, name, category, tier, town }`. Public unless the world state says otherwise.
- World setting `stationState`: `{ stationId, owner?, access[], tier? }` per public station. `tier` (optional) overrides the read-only compendium tier, so Stage 9 upgrades have somewhere to write.
- Actor flag `stations`: player-owned workshops and carried kits as full records. A record's `owner` (and a kit's `holder`) must be the actor that stores it.
- `buildStationList` joins them. Problems are reported with pack/entry/field and the station is left out. A broken state entry removes its station entirely (**fail closed**), so a private workshop can never fall back to public.

## Reach rules
- **fixed:** crafter is in the station's town AND (no owner, or is the owner, or is on `access`).
- **carried:** the holder always; otherwise someone on `access` who is in the same place as the holder ("no location" counts as together).
- The station must also match the recipe's `stationCategory` and have tier >= `stationTierMin`.

## Choosing a station and the fee
- Exactly one usable station is chosen automatically. Several: the caller must pass `station: "<id>"` (never guessed). None: the error gives each station's reason.
- Fee = `STATIONS.feeByTier[station tier]` (placeholders 1/5/20/80/300 gp). It is spent on every degree and is **not** paid to the owner.
- Carried kits above `STATIONS.portableTierCap` (2) are an **error and excluded**, never clamped.
- The chosen station is recorded in the summary and the crafted item's provenance.

## GM console tools
`stationsFor(actor, recipeId?)`, `setLocation`, `setActorLocation`, `setStationState`, `clearStationState`, `giveStation`, `removeStation`, `transferStation`. All writes are GM-only and validated before anything is saved.

# Stage 4 decisions (gathering)

## Node records
- A node is a **token flag** (`flags.pathfinder-progress.node`); the token is its identity (no stored id). `explored`, `placed` and `corpse` nodes share one shape: `{ source, state, nodeType, tier, charges, region?, discoveredBy[], ladder?, decayTimer? }`.
- States: `anchor` (hidden marker; only `source`, `state`, `region`, `discoveredBy`), `active` (charges >= 1), `depleted` (charges 0). A mismatch is a load error. A corpse cannot be an anchor and must carry its own `ladder` and a `decayTimer`.
- `nodeType` is a definition kind: `{ id, name, skills[], charges, ladders?: { "<tier>": [rung] } }`. Skills are checked against PF2e skill slugs (lores allowed). A type may have no ladders (corpse).
- The ladder is resolved lazily: the node's own `ladder` beats `nodeType.ladders[tier]`, so edits to a nodeType reach existing nodes.

## Ladders and DCs
- A rung is `{ materialId, dcOffset, quantity, guaranteed? }`. **Exactly one rung is `guaranteed`: the base rung**, and it must have the **lowest `dcOffset`** (ties allowed). No duplicate materials.
- Rung DC = `GATHERING.baseDcByTier[node tier] + dcOffset` (placeholders 10/15/20/25/30; spec tiers 1 to 3, 4 and 5 extend the pattern).

## Resolving a gather
1. Refuse anchors and depleted nodes before any dice. The skill must be on the node type's list; with one allowed skill it is picked automatically, otherwise it must be named.
2. **Visible roll** (PF2e check) against the base rung: a pass is PF2e success or better.
3. A failure yields nothing and rolls **no** hidden dice.
4. A pass grants the base material (quantity dice). Each higher rung then gets its own hidden `d20 + modifier` (modifier = total - natural d20 of the visible roll); the total meeting the DC succeeds (plain arithmetic, no nat-20 upgrade).
5. **Every attempt spends one charge** (burned before materials are granted). 0 charges = depleted.
6. A quantity that rolls 0 or less grants nothing.
- Forced test degrees skip the roll and use the character's static skill modifier for the hidden rolls.
- Hidden rolls are returned to the GM and logged to the console (not when `chat: false`); they never appear in chat.

## When a grant fails (policy)
- The charge is burned first, deliberately: a crash can then never leave a free attempt.
- But a crash is not a gathering attempt. If granting materials throws, the **charge is refunded** and any materials already given in the same gather are **taken back** (a new stack is deleted, a topped-up stack returns to its old quantity), so a gather is all-or-nothing.
- If the refund itself fails, the error says so and tells the GM to set the node's `charges` (and `state`) back by hand. Nodes never refill (see Stage 9).
- Charges and state are always written together and checked against the node schema, so a node can never be saved with 0 charges while "active" (or charges while "depleted").
- A chat failure after a successful gather is logged; it does not undo or hide the result.

## Tools
`gather`, `previewGather`, `nodeInfo`, `createNode`, `createAnchor`, `activateNode` (unhides the token), `makeCorpseNode`, `clearNode`. Node tokens are kept out of the combat tracker.

## Deferred
Corpse yield derived from creature level/traits, auto-creating corpse nodes on death, decay ticking, the click-on-token dialog and the player relay (Stages 6 and 10).

# Stage 5 decisions (research and formulae)

## Recipe visibility (an honor system, not secrecy)
- Recipes live in their own compendium, `pathfinder-progress.recipes` (labelled "Recipes (hidden from players)"). The manifest sets Players and Trusted Players to NONE and Assistant to OWNER. That **hides it from players' interface**, and the module's loader skips it for non-GMs. Everything else stays in the public `definitions` pack.
- **Foundry does not enforce this as access control.** Verified in Foundry 14.369 / PF2e 8.6.1 with a plain player account: `game.packs.get("pathfinder-progress.recipes").getDocuments()` returns the recipes with their full text, and a world Journal whose default ownership is None also delivers its full text to the player's client. Only the compiled pack files are protected from direct access (403 by URL). So a player using the browser console can read every recipe. **Decision: keep it as an honor system.** Do not describe recipes as secret, and do not rely on this for anything that must stay hidden.
- The seed recipes in `content/recipes/` are also committed to the public repo and ship in the public release, so they are samples. Recipes you author for a campaign can live in a world Journal compendium (list its id under "Extra definition packs") for organisation; that is no more secret than the module's pack. Do not commit recipes you do not want public.
- A character holds a **display snapshot** of each formula it owns or is lent (name, category, craft level, slots with roles/tier floors/quantities, station), so the interface can show a player their own formulae. The snapshot deliberately excludes `overrides`, `output`, `skillWhitelist` and `researchProject`; a test guards that list.
- **Crafting always uses the live recipe.** A formula only authorises; editing a recipe applies at once. Snapshots are refreshed on GM load (with a notice) or with `api.refreshFormulas`. Editing hidden fields does not make a snapshot stale. A formula whose recipe is gone is **orphaned**: kept, reported, and crafting is refused.

## Projects
- Stored on the actor (`flags.pathfinder-progress.projects`): `{ id: "unlock-<recipeId>", goalName, outcome: { type: "unlockFormula", recipeId }, tier, dc, threshold, progress, skillWhitelist, status: active|complete|abandoned, log[] }`. `formulaId` was renamed `recipeId`. `upgradeStation` stays in the schema; starting one is refused until Stage 9.
- At start: tier = `recipe.researchProject.tier`; DC = `levelDC(recipe.craftLevel)` + the tier's offset; threshold from the tier table (`RESEARCH.tiers`, placeholders 8/12/18/26/40, offsets -2/0/+2/+4/+6); skills = `recipe.skillWhitelist`. These are stored, so later edits do not change a running project. `startProject` accepts `dc` and `threshold` overrides for tuning one project.

## The daily check
- One PF2e check per downtime day against the project DC; progress by degree (critical success 2, success 1, failure 0, critical failure 0). A critical failure can cost progress through `RESEARCH.critFailureSetback` (default 0, off); progress never goes below 0.
- Research **stops when the project completes**; leftover days are not spent. One summary chat message per call (PF2e is asked not to post a card per day).
- Each result in `research()`'s return value carries `degree`, `total`, `natural` (the natural d20) and `delta`, so a degree can be audited (forced test degrees have `null` for total and natural).
- Progress, days and (on completion) the formula are saved in **one actor update**, so a failure part-way changes nothing.
- `api.addProgress(actor, project, amount, reason)` is the hook for other sources; a reason is required and is logged. Practice and discovery are not built.

## Days and formulas
- Days: actor flag `downtimeDays`; `grantDays` (positive), `setDays` (0 or more); research needs the days up front and can never take the balance below 0. Stage 6 turned the counter into the UNRESERVED days (see Stage 6).
- Formulas: actor flag `formulas` = `{ recipeId, access: "owned" | "loan", source, snapshot }`. One entry per recipe: owned replaces a loan, a loan never replaces owned. A loan counts as having the formula (the loan flow is Stage 8); plan and provenance record `formulaAccess`.
- Granting an owned formula closes any running project for it.

# Stage 6 decisions (queue and GM review)

## The queue
- Stored in the actor flag `pendingActions`: `{ id, type, params, daysReserved, submittedAt }`. The actor is implied by where the flag lives. `type` is `research | explore | upgrade | commissionStep`; **only `research` is wired** (`queue/handlers.js` + a resolver in `queue/store.js`). Submitting any other type is refused; a hand-injected one shows as an error row until the GM rejects it.
- **Submission is console-style for now**: `api.queue.submit(actor, "research", { projectId, skill? }, days)`. Any owner can call it (it works with no GM online). A player-facing button comes in Stage 10.
- **Days**: the `downtimeDays` flag is now the UNRESERVED counter. Submit moves days counter -> reservation, reject refunds all, edit moves the difference, resolve spends what the action used and refunds the rest. Submit, reject and edit never change the TOTAL (counter + reserved). Overbooking is refused (`cannot reserve N day(s): only M unreserved`).
- **Resolution** (GM client only, so rolls stay hidden): `api.queue.resolve(actor, id)` or `resolveAll()` in submission order (`submittedAt`, then action id, then actor id). Each action is isolated:
  - `resolved`: ran, removed.
  - `invalid`: can never succeed (project gone, abandoned or finished, recipe deleted, skill not allowed). Days refunded, action removed, reported.
  - `error`: anything unexpected (a failed roll, a corrupt flag, an unwired type). The action is left exactly as it was; the review window shows **Retry**.
- Research is split into `planResearch` (rolls and rules, writes nothing) and a commit. `api.research` spends the counter; the queue spends the reservation. Same rules either way.

## Review window
- `api.openReview()` (GM only, ApplicationV2, built lazily). Shows the queue (edit days, Resolve, Reject, Retry on errors, Resolve all), this session's results, and the audit panel. Failures show a notification and never close the window.
- `autoOpenReview` (client setting, default on): on GM login and when another user changes module data, a notice appears and the window opens if there is something to review. One active GM reacts.
- Button names: ApplicationV2 matches `data-action` EXACTLY. The buttons use kebab-case (`resolve-all`, `edit-days`) and the actions map uses the same quoted keys. A click on a name with no handler shows an error notice instead of doing nothing, and `tests/review-app.test.js` checks every rendered `data-action` has a handler.
- CSS: `styles/review.css`, listed in the manifest `styles` and in the workflow zip.

## Audit (an honor-system aid, not security)
- Players own their actor, so a determined player can edit flags. The audit makes that visible, it does not prevent it.
- The ledger is a world setting `auditLedger`, written only by a GM client. It stores EXPECTED state per actor: total days (counter + reserved), formulas `{ recipeId: access }`, projects (tier, dc, threshold, progress, status), and the last 20 changes.
- Every GM-side write goes through `audit/store.js` `commit`: ledger first, then the actor, and the ledger is put back if the actor update fails. Module writes apply CHANGES to the expected values (they never copy the actor's current state), so a tamper stays visible after later module changes until the GM clicks **Accept**.
- First run: `bootstrap` gives actors that already hold module data a baseline (entries already tampered with before Stage 6 are accepted as they are).
- Catches: days, formulas and projects edited outside the module, and malformed records. Cannot catch: items, coins, kits, materials, edits reverted before a check, or who did it. Players can READ the ledger in the console; they cannot write it.

# Stage 7 decisions (exploration)

## Regions
- `{ kind:"region", id, name, sceneTag, skillWhitelist, explorationDC, daysRequired, spawnTable:[{ nodeType, tier, weight }] }`. `name`, `skillWhitelist` and the per-entry `tier` were added to the spec's shape (the spec never said which skill rolls the check, and a node needs a tier).
- Checked at load against the loaded definitions: the nodeType must exist and must have a ladder for that tier (so `corpse` can never spawn), weights are >= 0 with a total above 0, and a nodeType/tier pair appears once. A bad region is reported by pack, entry and field and is not usable; other regions still load. `api.checkDefinition(record)` runs the same checks on a candidate without loading it.
- Seed regions: `oak-wood` (DC 18, 2 days, herb/ore/salvage tier 1) and `barren-ridge` (DC 15, 1 day, ore tiers 1 and 2, salvage).

## Scenes and anchors
- A scene belongs to a region through a module flag `sceneTags: string[]` (no reliance on a native tag feature). No tagged scene means the expedition is refused; there is no blank-scene fallback. A GM's submit is refused up front; a player's client may not see scenes, so a player's submit checks the region only and the scene check happens at resolve time (an error row the GM can fix and Retry).
- GM tools: `tagScene`, `untagScene`, `scenesFor`, `placeAnchor`, `placeAnchors(n)` (random free grid squares), `placeNode`, `listAnchors` (`{ all }`), `clearAnchors` (needs `{ confirm: true }`), `resetScene`.
- A scene remembers its last 10 expeditions in the flag `prepared`.

## The expedition
- Queue type `explore`, params `{ region, skill }`, days = the region's `daysRequired` exactly. The days are spent in full whatever the degree.
- Resolve (GM client): roll the check against the region DC (hidden, natural d20 recorded), roll the anchor count from the degree, choose a scene (tagged, with free anchors; prefer one with enough, else the roomiest), pick that many free anchors at random, and roll the spawn table for each. Every node record is built and validated BEFORE anything is written.
- Anchor counts (placeholders, `EXPLORATION.anchorCounts`, uniform within the range): critical success 3-5, success 2-4, failure 1-2, critical failure 1. With a modifier m against DC d: expected anchors = sum over degrees of P(degree) x average count; +8 against DC 20 is 10% / 45% / 40% / 5% (critical failure / failure / success / critical success) and 2.175 anchors.
- Writes, in order: (1) the activated tokens in one batched update, (2) the scene's prepared log, (3) the actor (days, queue, ledger). A failure at (2) reverts the tokens; a failure at (3) reverts the tokens and the log. The action stays queued. Preparing never activates, views or pulls the scene.
- Fewer free anchors than rolled: all are activated and the GM is told. Preparing the same scene twice uses only the anchors still free; earlier nodes are untouched. `resetScene` turns explored nodes back into anchors.
- Chat: a public flavour line (region and days; no scene name, no node details) and a whisper to the GMs with the scene, the natural d20, the nodes and the anchors left.
- `api.queue.resolve/resolveAll` accept `{ degree }` for explore actions (a test override, like research).

## The Resource Node actor
- One PF2e `loot` actor, found by the flag `nodeActor` (never by name), its id remembered in the world setting `nodeActorId`. Ownership default NONE; prototype token unlinked, neutral, name on hover, no bars or vision, 1x1, rotation locked. `api.ensureNodeActor()` reuses it, finds it by flag if the setting is lost, and recreates it with a warning if it was deleted. Only the adapter knows the `loot` type name.
- Tokens: `placeAnchor` / `placeAnchors` / `placeNode` create tokens from it. An anchor looks like `icons/svg/mystery-man.svg` named "Anchor"; activation renames and re-images a still-default anchor after its nodeType. `nodeType.img` (optional) sets the image; the default is a Foundry core icon. Hand-made Stage 4 tokens keep working.
- Corpse nodes still use the dead creature's own token.

# Stage 8 decisions (commissions)

## The record and the list
- One world setting `commissions` (a list), written only by a GM client; players can read it (an honor-system aid, like the audit ledger, so keep no secrets in it). A player sees the commissions of characters they own.
- `{ id, source: player|gm, status, patron: {actor}|{lightweight name}, crafter, formulaId, access: loan|copy, selection?, stationId?, materialsFrom: patron|npc|crafter, payout, teaches, learnRoll, learnAttempted, attempts, delivered?, log[] }`. A character patron always supplies the materials; an NPC patron uses `npc` (materials appear for the job) or `crafter` (default).
- States: requested -> accepted -> inProgress -> delivered, or cancelled / declined. A failed craft keeps it open. `commission.js` holds the table of who may do what: accept/decline = the crafter or the GM, cancel = the patron or the GM (until delivered), craft = the crafter or the GM.

## The queue
- One queue type `commission` (it replaced the `commissionStep` placeholder) with `params.step`: `request`, `accept` (optionally `as: "loan"` on a copy offer), `decline`, `cancel`, `craft`. These steps cost no days (`daysReserved` 0; research and explore still need at least 1). A player's client validates what it can see; the GM re-validates at review, and a request that can no longer succeed is removed as `invalid`.
- A request is created idempotently (id `c-<action id>`), so a half-finished resolve is safe to retry.

## The loan
- Accepting adds `{ access: "loan", commissions: [id] }` to the crafter's formulas (several commissions for one recipe share the entry). A copy is learned for good (`owned`) at accept, and cancelling does not take it back. The generic craft refuses a formula entry that carries a `commissions` list; the commission craft accepts it only for a listed id. GM-granted loans (no list) behave as before.
- The loan ends on delivery or cancel; if the crafter has learned the formula meanwhile, nothing is removed.

## The craft (escrow at craft time)
- Nothing is held earlier. A craft first checks everything (formula held by crafter, patron still owns it, recipe, station reachable by the crafter, materials in the supplier's stock, and for a character patron fee + payout in gold; a refusal names the shortfall), then rolls everything (craft check, loss rolls, learn roll), then writes with an undo for every write: consume materials (one stack at a time), take the fee, create the item on the patron, move the payout, write the commission record, and last the crafter's own update (formulas, project, queue) which is already all-or-nothing. Any failure undoes the earlier writes in reverse; if an undo itself fails the error lists what to check by hand.
- Fee: a character patron pays it; an NPC patron's fee is waived. Materials come from the patron's stock, the crafter's stock, or an NPC's virtual supply (which leaves nothing behind, even after a failed attempt). The finished item goes to a character patron; an NPC-patron job creates no item, only the `delivered` record. The payout is paid only on delivery: patron -> crafter, or created for an NPC patron. A failed craft follows the normal rules (fee lost, per-unit loss rolls, critical failure loses everything) and the commission stays open.
- Delivery is automatic on a successful craft. Gold moves in whole copper pieces.

## Learn roll and teaches
- Learn roll: per commission, one attempt, rolled at the first craft attempt (whatever its result), only on a loan the crafter does not own, with the project's skills and DC. No project (or an abandoned one) starts a fresh research project; progress follows the research degrees through the same `applyProgress` that `addProgress` uses, inside the craft's all-or-nothing update. Completing the project makes the formula owned. Default: on for GM-issued loans, off for player jobs.
- `teaches` (GM-issued): `progress{amount}` adds progress on delivery (starting a project if needed); `fullCopy` makes the formula owned on delivery. Both are skipped when the crafter already owns the formula (warned at issue time).

## Cancel
- Nothing is held, so nothing is refunded. Fees, material losses and the crafter's own spent stock from failed attempts are sunk; the payout is never paid; a loan disappears, a copy stays. The GM can compensate by hand.

## The audit
- Loans and copies are formula changes, so the ledger tracks them; every GM write goes through the ledger-first commit. A new check compares loans with the commission list: a loan must belong to an accepted loan commission of that crafter, and an accepted loan commission must have its loan (unless the crafter owns the formula or a GM loan serves it).
- NOT tracked, and not trackable: gold, materials and items (players earn and spend them outside the module and sheets are editable). Each commission keeps a movement log (fee, materials used and kept, payout, item, learn roll) so a dispute can be settled by hand.

# Stage 9 decisions (downtime periods, hidden exploration, temporary nodes)

`docs/11-hub-design.md` overrides older notes where they disagree.

## Downtime periods
- A period is a GM-started window: `api.downtime.start({ days, actorIds? })`, `addLate(actor)`, `end({ force })`, `state()`, `isOpen()`. State is one world setting `downtime` = `{ open, days, startedAt, endedAt?, participants: { actorId: { granted, spent, late? } }, log[] }`, written only by a GM client. No socket is needed: players only read it.
- Default participants: each connected non-GM user's assigned character, else the player characters they own; the GM can pass anyone. `start` grants `days` to each through the audit commit and takes the grants back if any step fails.
- `addLate` gives the most FREE (unreserved) days any participant still has. `end` is blocked (`{ blocked: n }`, nothing changes) while anything is queued, unless `{ force: true }`, which returns every queued item (days refunded) and then expires everyone's days. Presence is the reward: nothing carries over and nobody catches up. `end` is safe to run again if it stopped part-way.
- The gate: anything that reserves days, and a commission craft step, is refused by `queue.submit` outside a period ("Downtime isn't open right now") or for a non-participant ("Downtime is open, but you weren't here for it"); it is checked again when the GM resolves (a survivor is refunded, not run). Commission requests, answers and cancels spend no time and are not gated.
- GM tools (`api.research`, a direct commission craft, a GM calling `queue.submit` for someone) bypass the gate, and each bypass writes a "GM override" note to the audit ledger (world events under the key `_events`). `grantDays` / `setDays` stay GM tools. Start, late join and expiry appear in each character's ledger history and as world events.
- **Craft and gather in Stage 9:** not queue types yet (built in Stage 10a, below). A commission craft step still spends no days. The downtime gate covers research, explore and the commission craft step.

## Hidden exploration
- A player queues `{ region, skill?, forceCombat? }` with `days` (at least the region's `daysRequired`, at most `EXPLORATION.maxDays`). Each day is one hidden roll for nodes (the degree rolls that day's node count); the ENCOUNTER is rolled ONCE per expedition (`forceCombat` makes it certain; otherwise the region's `danger` low/moderate/high gives 20/35/50%, placeholders; players see the label later, never the chance).
- Nodes are NEW tokens, HIDDEN, placed at free anchors' positions, each with a Perception DC from the node's tier (`EXPLORATION.perceptionDcByTier`). Anchors stay and are marked `occupiedBy` until `clearMap`; with fewer free anchors than nodes the extra nodes are not placed (and the GM log says so). The scene is prepared, never launched.
- Players are shown no odds or results: `previewExplore`, `simulateExplore`, `scenesFor`, `listAnchors` and `checkDefinition` are GM-only, there is no public chat line, and the encounter, expedition log, searches and revealed list live in the GM-written world setting `explorationState` (keyed by scene id), not in scene flags. **Honest limit:** Foundry cannot enforce read access to settings, flags or hidden tokens, so a player using the browser console could read them. This keeps everything off every screen; it is an honor system, like recipe visibility.

## Spotting nodes: "Search the area"
- Options considered: (A) PF2e's native Seek. My search found only third-party modules automating Seek against hidden tokens (for example PF2e Visioner); nothing confirmed core PF2e does, and it was not verified in Foundry. (B) A module action. **Chosen: B.** `api.searchArea(actor)`: a player's call is relayed with socketlib to the GM client (socketlib was declared from the start and is now used). The GM client rolls the character's Perception itself (so a player cannot send a better total), compares it with every hidden node's DC on the scene, and reveals the ones it beats.
- **The socket (`scripts/socket.js`):** every client, GM or player, registers the same socketlib functions once, on `socketlib.ready` (socketlib's documented way). **The manifest must contain `"socket": true`**: without it socketlib logs `Failed to register socket for module ...` and `registerModule` returns nothing (v0.13.0 and v0.13.1 shipped without the flag, so no client could register; v0.13.1's multi-hook retry was a wrong guess and was removed again in v0.13.2). The flag is only read when the Foundry SERVER starts, so after installing a version that adds it the server must be fully restarted (returning to setup or reloading the browser is not enough). If registration fails, the console says why, the GM gets a notice at `ready`, and `api.socketStatus()` shows `{ registered, socketlibActive, socketlibGlobal, client, activeGM }`. Tests guard the flag, the required `socketlib` dependency (`relationships.requires`, with a reason), and that any source file using socketlib implies both. `searchArea` is the only code that relays to the GM through a socket; every other player-to-GM path is a queue action in the player's own actor flag, resolved by the GM.
- One attempt per character per scene visit (`api.resetSearches(scene)` gives them back; `clearMap` does too; a new expedition does NOT reset them, and the GM summary says who already searched). The attempt is used up even if nothing was there.
- The player's message is identical whether the search failed or nothing was there: "You search the area." followed only by what was spotted. It never says how many hidden nodes remain. "You have already searched this area." is the only other line.
- A spotted node becomes visible to everyone on the scene, is listed in that scene's revealed list, and is added to the spotter's `knownNodes` flag. A hidden node cannot be gathered ("has not been found yet").

## Temporary nodes, no respawn
- Removed: `api.refillNode`, `refillRecord` and the refund hint that pointed at them. (There were no refill timers or "depleted until" states.) A depleted node stays depleted; the corpse `decayTimer` is unrelated and stays.
- `api.clearMap(scene)` (GM): deletes every node token the module placed on the scene (explored nodes and nodes made from the shared Resource Node actor, found or hidden; each token's own synthetic actor goes with it), frees the anchors, removes this scene's entries from every character's `knownNodes`, and resets the scene's encounter, searches, revealed list and history. Returns `{ removed, found, hidden, skipped, knownNodesCleared, depletedCleared, orphanedGathers }` (see Stage 10a for the last two). It never deletes the shared Resource Node actor, anchors, inventories, hand-made node tokens made from other actors, or corpse nodes (these are counted in `skipped`). Safe to run again. It replaces `resetScene`.

## Stage 10a: the work loop (craft and gather as queue items)
Where this section and `docs/11-hub-design.md` disagree, this section wins (11 was corrected in the same change).

**Relay and identity.** `queue.submit(actor, "craft" | "gather", params)` and the new `queue.cancel(actor, actionId)` run on the GM client: a player cannot read the recipes or write a node token. A player's call is relayed with socketlib (`queueSubmit`, `queueCancel`, registered in `socket.js` next to `search`); on a GM client it runs directly. The GM client checks that the requesting user owns the character (or is a GM) BEFORE reading or writing anything; another player's cancel is refused with "Bob does not own Ann". **Honest limit:** Foundry gives a module no way to prove who sent a socket message, so the handler uses the sender socketlib reports if it reports one (`this.socketdata.userId`) and otherwise the `userId` the client sent. That stops the buttons and the API being used on someone else's character; a player determined to forge a user id from the console is the same honor-system limit as everywhere else in this module. Refusals keep their plain text through the relay; "no GM connected" and "socket not registered" get their own plain messages. All writes that touch one actor's queue, or one node, run one at a time on the GM client (`queue/lock.js`, in-memory, always node first then actor), so two players cannot take the same last charge and two simultaneous crafts cannot overwrite each other's queue entry.

**Craft (type `craft`, `params: { recipe, selection, stationId? }`).**
- Spends downtime days: `craftDays(recipe, reductions)` is the single day calculation (every reduction is applied first, then the result is clamped to at least 1). `queue/work.js` asks `craftReductions(actor, station)` for the reductions; since Stage 10c it returns the station's craft-day upgrades, and `setCraftReductions(fn)` adds any other source on top (tests use it). The caller may pass `days`, but it must equal the computed number.
- Refused, in plain words, with nothing changed: downtime closed or not a participant (GM override allowed and logged), formula not known, an empty or unknown slot, no station that can make it, short materials (the message points at the Compendium: nothing is bought), short gold for the fee, short free days.
- **Escrow at queue time.** Queueing takes the chosen materials out of the stash, the station fee out of the purse, and reserves the days. The record of what was taken rides inside the action (`params.escrow = { days, feeCopper, station, units: [{ materialId, name, tier, units }] }`, plus `recipeName`/`stationName` so the row reads without the recipes). Order of writes: materials and fee first, each with its own undo, then ONE actor update (action and day counter); a failed step undoes the earlier ones. Stage 8's commission escrow does NOT fit (it holds nothing until craft time); only its "what is short" helpers and its apply-with-undo pattern were reused.
- **Cancel / GM reject / forced End downtime** all use the same return path: the days go back to the counter, the materials go back to the stash (a stack that was emptied is recreated), the fee goes back to the purse, and a ledger event says so. A second cancel finds nothing queued, so nothing is returned twice.
- **Resolve (GM client).** It re-checks the formula, the recipe and the station against what is in escrow; if the party has left the station, the formula is gone, the recipe is gone, or the station fee changed since queueing, the action is **invalid** and everything is returned. Otherwise the escrow is CONVERTED, never taken again: nothing leaves the purse or the stash at resolve; the days and the fee are spent; the roll decides whether the item is made and, on a failure, rolls loss PER UNIT (a critical failure loses every unit, no rolls) and the unused units go back. A damaged escrow record is an **error** (the action stays queued; reject returns what it can).
- **On a craft failure the station fee and the days are still spent. The roll only decides whether the item is made and how many materials are lost per unit.** This is deliberate: a failed craft costs the time and the workshop's fee, and the dice only decide the materials. Do not "fix" it by refunding either.
- The result goes by whisper to the owners and the GM in plain language ("Success", the item, the fee and days); the loss rolls go to the GM only.
- Craft items block "End downtime"; a commission craft step still costs 0 days (unchanged in 10a).

**Gather (type `gather`, `params: { sceneId, tokenId, skill? }` or `node: <token>`).**
- Costs charges only: no days, no downtime needed, never blocks "End downtime". Any REVEALED node can be gathered by any character with a token on the node's scene (not the scene the GM is viewing); an anchor, a hidden node or a depleted node is refused. `knownNodes` on the character stays as it was (the sheet and the Stage 10b Compendium use it).
- **Reservation.** Queueing claims one charge: the node record gains `reservedCharges` (never more than `charges`; the key is dropped at zero). Free charges are `charges - reservedCharges`, so a second player is told "every charge it has is already claimed by a queued gather". Cancel, an invalid gather and a GM reject release the claim; resolving turns it into a spent charge. The direct GM tool `api.gather` refuses a node whose free charges are all claimed.
- **Resolve (GM client).** Visible roll, hidden rung rolls and the yield are the existing placeholder dice (tuned in Stage 12); materials are added to the inventory; the claimed charge is spent. The charge is burned first and everything is undone if a later write fails.
- **A node that reaches 0 charges is deleted**: the token (and its own synthetic actor) goes, and only a small record `{ tokenId, name, nodeType, tier, anchorId, by, at }` stays in the scene's GM-only `explorationState.depleted` until Clear map. The anchor it stood on stays `occupiedBy` until Clear map, so nothing respawns. If the token cannot be deleted the record is taken back and the node stays as a depleted token. A hand-made node (not placed by an expedition or made from the shared Resource Node actor) is never deleted; it stays as a depleted token, as before. `api.gather` (the direct GM tool) still leaves a depleted token; only queued gathers delete.
- **Clear map with gathers waiting.** `clearMap` now also returns `depletedCleared` (the small records it cleared) and `orphanedGathers` (queued gathers aimed at the nodes it deleted). Those gathers later resolve as **invalid**: "<node> is gone (the map was cleared), so there is nothing to gather. Nothing was spent." Nothing is left claimed, because the node and its claim are gone together.
- A gather whose character is no longer on the scene resolves as invalid and its claim is released.

**End downtime.** `end()` is blocked by anything queued except gathers (and, since 10b, shares); `end({ force: true })` returns every queued item except those (a craft's or build's escrow comes back with it). Gathers and shares left queued need no downtime and stay resolvable. The one thing this does not cover: Clear map between End downtime and the resolve (see above).

**Audit.** World events for queued, cancelled, returned by the GM, resolved, and invalid craft and gather items (with the escrow taken or returned). `audit.scan()` also reports a queued craft whose escrow record is damaged, and a node whose `reservedCharges` does not equal the gathers queued for it (a leaked or forged claim; the row is marked `node: true` and has no "Accept" button). A queued gather whose node is gone is NOT a mismatch. World-event writes are best-effort: a failed log line never fails the operation it describes.

**Players see no odds.** The queued actions hold only plain data (recipe, selection, escrow, node name, skill); the review rows carry no odds; `previewGather` and `nodeInfo` (they showed DCs and odds) are now GM-only like `previewExplore`; results are whispers.

**A bug the fault injection found, in code that predates 10a:** saving a node record that dropped a key did "clear the flag, then set it", two writes; a failure between them would have destroyed the node's record. It is one atomic update now (dropped keys deleted with `ForcedDeletion`).

## Stage 10b + 10c: the Compendium, and workshops
Where this section and `docs/11-hub-design.md` disagree, this section wins (11 was corrected in the same change). Rules and APIs only; the Hub screens are Stage 11.

### Compendium (10b)
**Storage.** Each character's book is the actor flag `compendium` `{ v: 1, materials, creatures, regions }` (schema-validated on every write). The party's shared book is the world setting `sharedCompendium` (same shape). Entries only ever hold facts the character experienced: no placeholders, no "???". Merging is additive and idempotent, so any order of events, and the same event twice, gives the same book (`compendium/entries.js`, pure).

**What makes an entry.** A material: the first time it lands in an inventory (a `createItem` hook on the active GM client, so a GM gift, a dragged item or a trade all count) or, with more context, when a gather yields it (the node's place and the ladder rung reached). A creature: being in a combat with it (barebones: name and type, from the PF2e adapter's `getCreatureIdentity`), for the characters in that combat only. A region: exploring it; the node types spotted while searching are added to it. A creature's **yields stay locked** (absent from the entry, nothing shown) until the character takes that material from one of its corpses; then it is recorded on that creature. Corpse records carry an optional `creature { name, type }` (a half-made one is refused); auto-creating corpses on a creature's death is out of scope.

**One choke point, with one exception.** Materials the module itself hands out (gather yields, escrow returns) run inside `whileHandled(...)` so the hook skips them; the caller records them with its own context AFTER the commit (`noteGather`, `recordReturned`). So a gather that fails and is undone leaves no entry, and the hook and the contextual call can arrive in either order (tests cover both orders and a double call). `recordReturned` records a returned material only if the character has no entry for it yet, so a skipped return can never leave an unrecorded material that the character did not already have. Recording is best-effort (`safely()`): a failed Compendium write is logged on the GM and never fails or undoes the action that caused it.

**Reading it.** `api.compendium.view(actor)` gives the character's own entries plus the party's shared ones (party characters only), each marked `source` own / shared / both; `all()` is the GM's view; `hasMaterial(actor, id)` answers "has this character discovered it" for the future crafting rule. **The ownership check in `view` is an API courtesy, not security.** The flag and the setting are readable from any player's browser console; this is the same honour-system limit as recipe visibility (see "Known limit" below).

**Sharing (queue type `share`).** `params { kind, key }`. Private by default. Queueing is immediate and free: no days, no downtime, and a share NEVER blocks End downtime (it stays queued through a forced end). It captures the entry as it was when queued. The GM approves with Resolve (the facts are merged into `sharedCompendium`; the exact previous raw setting is restored if anything fails) or rejects ("rejected by the GM"; the entry stays private); the owner can cancel while it waits. Refusals (already waiting, nothing to share) are plain messages.

### Workshops (10c)
**"The party"** is one definition everywhere (`party.js`): every character an ordinary (non-GM) user owns at Owner level. It decides who reads the shared Compendium and who may use a party workshop.

**Tiers.** 1 to 4 for a workshop in a town; a carried kit stays at the lower portable cap.

**Upgrades are research projects on a station.** Three kinds: `tier`, `craftDays` (cuts a craft's days by one per level, to level 3) and `hearth`. **A hearth is only a stored counter with NO EFFECT YET**; it is labelled "(no effect yet)" in the project name and in every API row (`hearthNote`), and Stage 12 decides what it does. They cost research days (an ordinary research queue item, crafting skill; DC and threshold scale with the target tier) plus materials of the TARGET tier, and **no gold**. The materials are **escrowed when the project starts** (`api.workshop.startUpgrade(actor, { stationId, kind, materials })`), stay on the project, and are spent when it finishes; `api.workshop.putAside(actor, projectId)` returns them exactly (a stack that was emptied is recreated), once. Starting and putting aside are immediate relayed calls (`workshopStart`, `workshopAside`, guarded like every handler), need no downtime, are audit-logged ("upgrade started", "project put aside"), never block End downtime, and refuse in plain words (a shortage points at the Compendium; nothing can be bought). A queued research item for the project must be cancelled before it can be put aside, and the GM's `abandonProject` refuses a project that holds escrow.
- **Storage.** An upgrade lives on the station: a public station's `stationState` entry (`tier` via the existing tier override, `upgrades { craftDays, hearths }`), an owned station's actor record, or the party list. When research finishes, the GM client applies it under the station's lock (and the lock of the list it is stored in, because every public station shares one world setting and every party workshop another) after re-checking the station is still at the level the project began from; if not (someone else finished it first, or the station is gone) the day is refunded as **invalid**, and the player puts the project aside to get the materials back.
- **Craft days.** `craftDays()` applies every reduction (the station's upgrades plus any extra source) and THEN clamps to at least 1 day.

**Build your own workshop.** A `blueprint` definition (slots like a recipe, a gold cost, build days, a research project tier). 1) Research the design (`api.workshop.startDesign`; an ordinary research project; finishing it puts the design in the researcher's `blueprints` flag, like a formula). 2) Queue a `build` item (`queue.submit(actor, "build", { blueprint, selection })`): the materials AND the gold are taken now, the days reserved (the build time is the blueprint's), and the item records the party's current town. It **blocks End downtime** like a craft; cancelling returns everything once. 3) The GM resolves it. **No roll.** If the builder no longer holds the design, the blueprint is gone, or the party is not at that town any more, the item is **invalid** and everything is returned. Otherwise the escrow is converted (nothing is taken again), the days are spent, and a **party-owned fixed station** appears at that town (`partyStations` setting, id `party-<blueprint>-…`). It is used like any station: any party character may craft there and the location rule applies (the party must be in its town), but **it charges no station fee**; every other station still charges its tier's fee. It can be upgraded like any station.

**Rules kept.** Every new socket handler is wrapped in `guard()` (the handler walk covers `workshopStart` and `workshopAside`); refusals are `Refusal`s, anything else reaches the player only as the generic line. Locks per actor, station and list (always node, then station, then actor, with a list lock innermost). Fault injection fails the Nth write on every new escrow path (start, put aside, finish, queue / cancel / resolve a build, share) and proves nothing is left half-done. Hidden rolls stay on the GM client; no new roll was added. No "-=" keys.

**Known limits.** A hearth does nothing yet. Creature entries are made only from a combat (not from a death, and corpses are still made by hand). The first player to finish an upgrade wins; a second project for the same level is invalid and must be put aside.

# Known limit: Foundry cannot hide data from a client

Everything the module calls "hidden" or "GM-only" is hidden from the interface, not from the browser. A player who opens the browser console can read hidden node tokens and their flags (including each node's Perception DC and whether it was found), the GM-written world settings (`auditLedger`, `downtime`, `explorationState`, `commissions`), actor and scene flags, and the recipes pack. This is the same honour-system rule as recipe visibility (verified on Foundry 14.369, also for a world Journal set to None). What the module does guarantee:
- nothing is shown to a player on a screen, in chat, or on a sheet that they should not see (no odds, results, encounters or node counts);
- every GM tool refuses a non-GM client, and rolls that matter (hidden rung rolls, loss rolls, exploration checks, searches) run on the GM client, so a player cannot influence them or send a better total;
- the audit makes tampering with days, formulas and projects visible to the GM.
It does not, and cannot, stop a determined player from reading data that Foundry delivers to their client. Never put anything in a flag, setting or hidden token that must stay secret from the players.

# Maintenance notes

## v0.13.3: ForcedDeletion
Foundry v14 deprecates the old "minus-equals key" syntax for deleting a key in an update (removal in v16). The only production use was `vacateUpdate` in `exploration/tokens.js` (used by `clearMap` and by the expedition rollback), now `new foundry.data.operators.ForcedDeletion()`. `unrevealUpdate` used it too but had no caller (only an unused import and its own test), so it was deleted. A test scans `scripts/` and fails on the old syntax; the fake Foundry in the tests throws on it, so only the new operator can pass.

## v0.14.1: refusals travel as data, and nothing reloads the page
**Relayed refusals.** Real socketlib hides the message of anything a GM-side handler throws: the player gets only "An exception occured during remote execution of handler 'queueSubmit'. Please see Gamemaster's error console for details." (found in the real-Foundry gate; the fake socketlib used to pass the message through, so the tests missed it). Now (`queue/relay.js`):
- `refusal(message)` makes a `Refusal`, an Error meant for a player. ONLY a `Refusal` is ever shown to a player. Every deliberate plain-language refusal is one (the downtime gate, a craft shortfall, bad `days`, free-days and gold shortfalls, the gather refusals, "does not own", "has no queued action", unknown character).
- Every registered socket handler is wrapped in `guard()`: a `Refusal` comes back as `{ __relay: "refused", message }`; ANY other exception (including a plain Error from a pure helper, even one with friendly text) is a bug: it is logged on the GM with `console.error` and comes back as `{ __relay: "failed" }`. A guarded handler never throws, so socketlib has nothing to swallow. The player-side `asGM` and `searchArea` call `unwrap()`: a refusal is rethrown as a plain Error with the real text, a failure as the single line "Something went wrong; tell the GM."
- Only the relayed (socket) path is guarded. A GM calling `api.queue.submit`/`cancel` directly (no relay) still gets a thrown Error with the real message, exactly as before; an unexpected error there is the original error.
- The handlers were `search`, `queueSubmit` and `queueCancel` (all in `socket.js`); 10c adds `workshopStart` and `workshopAside`. The fake socketlib in the tests now behaves like the real one (a throwing handler gives the caller only the generic text above), a test walks every registered handler with refusals, nonsense and bugs and fails if one can throw, and a source scan fails on an unguarded `register(` or on a relaying file that does not `unwrap`. An unexpected failure midway through an escrow step still runs the existing undo, which the fault-injection tests prove through the relay too.

**Does anything in the module reload the page?** No. A search of `scripts/` finds no `requiresReload` setting, no `debouncedReload`, no `location.reload`, no `onChange` handler, and no hook that rebuilds the definitions. The registry is loaded once, at `ready` (`api.reload()`), and again only when a person calls `api.reload()`. Changing `partyLocation`, starting or ending downtime, changing a user's character, or creating actors and scenes does not touch it. The module's only hooks are `init`, `ready`, `createChatMessage`, `renderChatMessageHTML`, `updateActor` (which only refreshes the GM review window) and `preCreateCombatant`. The Hub's live updates (Stage 11) re-render windows; they do not reload the page. What CAN wipe memory-only data is a reload of the GM window by anything else (the browser, another module, Foundry asking for a reload after a setting that requires one in some other package, a world relaunch): the fake gate definitions (`api.definitions` entries added by the SETUP block) and `globalThis.__gate` live only in that page. SETUP now rebuilds both when run again: it re-registers the definitions and rebuilds the helper from the ids and baseline it saved on Gate Scene.

# Notes for later stages

## Stage 7 (built, see above): a dedicated "Resource Node" actor
Stage 4's test token borrows whatever actor is handy, so it shows that actor's art and sheet. Real nodes should use one neutral PF2e **loot** actor.

What the module needs:
1. **One shared actor, found by flag, not name.** The adapter (the only file that knows PF2e's `loot` type) gets `createNodeActor()`, `isNodeActor(actor)` and `findNodeActor()`. The actor carries `flags.pathfinder-progress.nodeActor = true`. `ensureNodeActor()` reuses it, remembers its id in a world setting, and recreates it (with a GM notice) if it was deleted. Creation is GM-only.
2. **Safe defaults on that actor.** Default ownership NONE so players cannot open its sheet (the click opens the gather dialog in Stage 10, and sheet rendering for node tokens is suppressed). A neutral name and image. Prototype token: unlinked, neutral disposition, name on hover, no vision, no bars, 1x1, rotation locked.
3. **Per-nodeType token art.** `nodeType` gains an optional `img` (a path; default to Foundry's core `icons/...` so the module ships no art). `createNode` and `activateNode` set the TOKEN's texture from it, so one actor serves every nodeType. The token name defaults to the nodeType's name unless the GM named it.
4. **A token builder.** `placeAnchor` and `placeNode(scene, { x, y, nodeType, tier })` create tokens from the shared actor, so GMs never hand-make them and Stage 7 can spawn explored nodes at anchor positions with the same call. Anchors (hidden) use it too.
5. **Corpse nodes do not use it.** A corpse is the dead creature's own token and keeps its own actor.
6. **Tests.** The token-data builder and the actor-data builder are pure and unit-tested; ensure/reuse/recreate runs against fake documents like `tests/gather-wiring.test.js`. If PF2e renames the `loot` type, only the adapter breaks, and `ensureNodeActor()` fails loudly.
