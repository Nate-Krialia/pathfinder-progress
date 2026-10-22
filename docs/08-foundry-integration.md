# 08 Foundry Integration & UI

## Targets
Confirm the Foundry and PF2e system versions with the user before building. Use ApplicationV2 for all windows and socketlib for socket relay.

## PF2e adapter
Materials are **real PF2e Items** (treasure/equipment) with module flags (`materialId`, `tier`). All reading of PF2e items, actors, level DCs, and creature level/traits goes through ONE adapter file. A PF2e update should only break that file.

## Permissions and sockets
Players cannot write world settings, scenes, or compendiums. Actions that need those writes (gathering charges on scene tokens, commissions in the world list, exploration scene prep) are relayed to the **active GM client** via socketlib. Hidden rung rolls and loss rolls run there too.

## Offline queue (players submit any time)
Sockets only reach online clients, so the queue lives in data players can write:
1. Each player's actor has a `pendingActions` flag.
2. Days are **reserved at submission** (cannot over-book).
3. On GM login, the module scans all actors and lists pending actions.
4. **GM reviews first**: a GM window lists pending actions with "Resolve all" plus edit/reject per row. Resolution runs in submission order via the GM client.
5. Resolving an expedition **prepares** the scene only; the GM launches it.
6. Commissions are two queued steps in player-to-player flow (patron submits, crafter accepts).
7. Players receive a results summary per resolved action.

## UI surfaces
**Player: Downtime Hub** (standalone ApplicationV2 window, opened from a button; optionally a header button on the PF2e sheet later). Tabs: Research, Explore, Commissions, Workshop, Formulas. Shows day budget and queue.

**Gather dialog**: opened by clicking a node token in the scene; small dialog for skill choice and roll.

**GM tools**
- Review queue window (see above).
- Commission creator form: patron name, item, `materialsFrom`, payout, `teaches`.
- Definitions are edited directly in the compendium packs (no custom editor).
- GM-only "Save to compendium" button on crafted item sheets.
- Anchor placement: GM drops hidden node tokens on scenes.

## Tokens
Nodes (anchors, active nodes, corpses) are tokens with flags. Hidden tokens are anchors; activation unhides them. Filter node tokens from the combat tracker and token lists.
