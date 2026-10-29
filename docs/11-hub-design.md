# 11 — Downtime Hub design (decisions from the design chat)

This is the agreed design for everything the player and GM see. It supersedes older notes where they disagree (especially node refill, which is REMOVED). All numbers are placeholders for Stage 12 tuning.

## Global rules

- **Downtime is a GM-started period.** GM presses Start downtime, sets a number of days, and ticks which player characters take part (connected players ticked by default, GM can tick anyone). Only ticked characters get the day pool.
- **Presence is the reward.** No bonus-day grants. Unspent days EXPIRE when the GM ends downtime. No catch-up for absent players.
- **Late joiners:** GM can "Add with N days" mid-period. N = the most free days any participant still has.
- **End downtime:** warn if anything but a gather is queued (offer Resolve all first), then expire everyone's days. Gathers cost charges, not days, so they never block it and stay queued (and resolvable) afterwards.
- **Outside downtime:** the Hub still opens and everything is browsable. Anything that spends days (research, exploring, crafting) is disabled with the reason "Downtime isn't open right now". Non-participants see "Downtime is open, but you weren't here for it". **Gathering is not affected:** it needs no downtime.
- **Craft time floor:** every reduction to craft days (station upgrades etc.) is clamped so a craft never takes less than 1 day. Enforced in ONE place (`craftDays`, `scripts/crafting/days.js`), applied after all reductions, and used by the queue.
- **Gold:** only the station fee leaves the purse. Materials come from the character's stash. NO buying missing materials, anywhere. When short, tell the player what is missing and point at the Compendium for where it can be found. **Escrow:** queueing a craft takes the materials and the fee and reserves the days immediately; cancelling returns all of it; resolving only spends the fee and days and returns the unused materials (on a failure the fee and days are still spent).
- **Costs are shown honestly:** per-material gold value, "materials are worth X", station fee paid now, "buying this in a shop would be about Y", "you save about Z". (Shop price formula is a placeholder.)
- **Results are plain language** ("Success: +1 step. Wardstone Pike is now 4 of 5."), never raw rolls in the player UI.
- **Live updates:** the Hub re-renders by itself when relevant data changes (queue resolved, commission updated, days changed). Only re-render for the viewed actor and the shared queue/downtime state. No flicker, no full re-render on unrelated actor updates.

## Entry points

- Scene controls button (all users) and a "Downtime" button in the PF2e character sheet header (opens the Hub for that actor).
- GM also gets a separate GM-only window, "Downtime Control" (opened from scene controls).
- Optional, low priority: keybind and a chat command.

## Window

- ApplicationV2, resizable. Size and position remembered per player (client setting).
- Layout: title bar (title, character name, Display button, Switch character, close), status strip, tab row, body.
- Body is list-left, detail-right. When narrow, the panes stack.
- Status strip: Downtime days (free · reserved), Party location (with stations available there), Waiting on the GM (queued count + View queue).

## Display settings (accessibility), per player, client setting

- Text size: 100 / 125 / 150 / 175%. Layout reflows, lists scroll. Scale real font sizes (not CSS zoom) in the real module.
- Colours: Parchment (default), Dark, High contrast (black and yellow). Implement with CSS custom properties on the app root so every Hub window picks them up.
- Font: Standard, or Atkinson Hyperlegible (easy-read).
- Reset to defaults.
- Also: real `<button>` elements, visible focus ring, 44px minimum targets, status never conveyed by colour alone (always a word), an aria-live region that announces results ("Craft queued, 4 days reserved"), a reduced-motion option for any animation.

## Tabs

### Formulae
- Left: filter chips (All, Weapon, Armor, Consumable), cards with status pill (Known / Researching).
- Right (known formula): slots, each with a one-line role ("Metal sets the weapon's power"). Each slot offers material option cards: name, effect in plain words, stock line ("Uses 3 of 5" or "Need 1, you have 0" in red).
- Only offer options for materials the character has DISCOVERED (see Compendium). Assumption, flag if wrong.
- "What you will get" box updates live: result text, odds in words and percent ("succeed on 8 or higher, about 65%"), failure explanation (roll decides if it works; on failure you may lose some materials, rolled per unit), and the "What it costs" breakdown.
- Buttons: Queue the craft (disabled with reason if short on materials; queueing takes the materials, fee and days at once), Ask a crafter instead (jumps to Commissions).
- Unknown formula: shows research progress bar and "Open in Research".

### Research
- Left: Active projects, and Leads you could follow (leads come from exploration finds, commissions, shared Compendium notes).
- Right: progress as step boxes, plain line on what finishing gives, "Roll with" skill cards (modifier and real odds of progress each), difficulty scales with tier.
- Each downtime day spent = one check. Outcomes (placeholder): big success +2 steps (cap +2/day), success +1, failure 0, bad failure 0.
- Days stepper, pace line ("about N days to finish"), recent checks log (includes learn rolls from commission loans), Queue N checks, Put the project aside.
- Station upgrades and own-workshop design are projects here too.

### Commissions
- Left: Ask a crafter / Take a job, list with status pills (Needs your answer, Ready to craft, Waiting on crafter, Delivered).
- Right: payout, handover (loan returned / copy / delivered record only for NPC patrons), time needed, materials list "supplied by the patron" with Escrowed at craft / Missing tags, station fee, "what the crafter may learn" with the optional once-per-loan learn roll, primary and secondary buttons, a reason line for every disabled button.
- Rules as built in Stage 8 (patron supplies everything at craft-time escrow, loans, learn roll, NPC patrons, movement log).

### Explore
- Left: Regions you can reach (danger pill Low/Moderate/High).
- Right: days stepper, **Force combat** checkbox, nodes found on the map, last expedition log, Queue N days of exploring.
- **Flow:** (1) player queues days and optionally ticks Force combat. (2) GM client rolls in secret; the player is NOT shown odds or results. (3) GM opens the region's tagged scene; there may or may not be an encounter. (4) Players use Perception on the map to spot nodes and materials; nodes are hidden tokens with a Perception DC. (5) Only when spotted does a node appear on the sheet (and in the Compendium).
- **Force combat** = a guaranteed encounter. It is how players go hunting monster materials; some materials exist only on creature corpses.
- **Nodes are temporary and never respawn.** REMOVE all refill timers, "refilling" state and refill APIs. When the GM presses Clear map the scene's nodes are deleted completely, including from character sheets. Gathered materials already in inventories stay. Compendium knowledge (types, places, ladder rungs) stays.
- Gather button per revealed node on the scene the character is in. **Gathering uses charges, not days:** queueing claims one charge on the node (so two players cannot queue the last one), it needs no downtime, and it never blocks End downtime. When the last charge is spent the node's token is deleted (only a small depleted record stays until Clear map); the anchor stays occupied.

### Workshop
- Left: stations with status (Here now / Travels with you / Away), Build your own workshop.
- Right: tier ladder (1 to 4) and plain line of what tier allows, station fee, who can use it, where it is, Upgrades list, Craft here (jumps to Formulae with station chosen; disabled with reason if party is not there).
- Upgrades are research projects on a station: raise its tier (1 to 4 in a town), cut craft days (never below 1 day in total), or add a hearth. **A hearth is a counter with no effect yet** (show it as "no effect yet"). They cost research days plus materials of the target tier and **no gold**; the materials are taken when the project starts, returned if the project is put aside, and spent when it finishes (`api.workshop.startUpgrade` / `putAside`; no downtime needed, never blocks End downtime).
- Traveling stations have a lower tier cap than town stations.
- **Build your own workshop** = research the design first, THEN queue a Build item: materials, gold and days are taken at queue time, it blocks End downtime like a craft, the GM resolves it with no roll, and it is invalid (everything returned) if the party has moved on. Result is a party-owned station at the town the party is in, usable by every party character, with **no station fee** (other stations still charge theirs).

### Compendium
- Per character. Categories: Materials, Creatures, Regions. Count line "N entries discovered. New ones appear as you find them."
- **No "???" placeholders anywhere.** Entries are created on first experience and extended as more is learned: where it can be found (only places experienced), how it is gathered (only ladder rungs reached), what can be taken from a creature (only yields seen), used in (formulae the character knows).
- Creature entries matter: some materials come only from creatures. A creature gets a barebones entry (name and type) when the character is in a combat with it; what it yields stays locked (not shown) until the character collects it from a corpse.
- Share with party: private by default ("Only you"). Pressing Share creates a GM queue item ("Queued"); cancel while queued; once approved "Shared" and the whole party (every character an ordinary user owns) can read it. Resolved by the same Resolve all. A share needs no days or downtime and never blocks End downtime.
- GM sees everything (full list and per-player progress).

## Queue panel (View queue)
- Lists the player's queued actions with title, days, status pill (Waiting for GM / Resolved).
- Waiting items: "No result yet. The GM rolls it in secret." with "Cancel and get everything back" (the days, a craft's materials and fee, a gather's charge). Cancelling is `api.queue.cancel(actor, actionId)`.
- Resolved items show the plain-language result and stay until dismissed, so an absent player doesn't miss them.
- Updates live when the GM resolves.

## GM "Downtime Control" window
- Start downtime (day stepper, presence checklist), or when open: granted days, queue count with Resolve all, End downtime.
- Who is taking part: per-character free and reserved days, "Add with N days" for anyone who missed the start.
- Region map card: tagged scene, nodes placed (found / hidden), encounter state, **Clear map** button (disabled when already clean) with a note that it removes every node from the scene and from sheets and nothing respawns. It also reports how many gathers were still waiting on those nodes (they resolve as invalid).
