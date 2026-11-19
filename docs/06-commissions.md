# 06 Commissions

## Concept
A **commission** lets one party (the *patron*) ask a *crafter* to produce an item from a formula. Formulae are transferable entities; the owner chooses per handoff.

## Formula handoff (owner's choice)
- **Copy (shared)**: crafter learns the formula permanently.
- **Loan (commissioned)**: crafter may use it only for that commission; formula stays with the owner. Declining a copy means a loan, never a refusal.
- A loan ends when its commission ends: **cancelled** (by the patron or the GM, before delivery) or **delivered**. There is no separate "revoke" action in the code (nothing named revoke exists); the patron's way to take a loan back is to cancel the commission before it is delivered. (The first design said the owner may revoke; this is what was built.)
- The craft check is always rolled by the crafter.

## Flows
- **Player-to-player**: patron submits, then crafter accepts (two queued steps).
- **GM-issued on behalf of an NPC**: GM creates it directly; the player only accepts or declines (one step). No socket relay needed (GM writes directly).
- **Patron can be a lightweight record** (just a name, e.g. "Old Brannock, the miller"); no NPC actor required.
- An NPC may supply a formula as a loan, so a player can craft a recipe they never researched for that job.

## Commission record settings (set by GM for GM-issued jobs)
- `materialsFrom`: `crafter` (the crafter spends their own stock), `patron` (a character patron's stock; the default for a character patron) or `npc` (the NPC supplies the materials at craft time: nothing ever appears in the crafter's inventory, the crafter needs none and keeps none; it needs a `selection`). **Default: crafter** for an NPC or lightweight patron, `patron` for a character patron. A patron without a character cannot supply from stock.
- `payout`: GM-set; module suggests a default from material cost + station fee + margin. When the crafter supplies materials, the payout rewards that cost, so players can earn more.
- `teaches`: `none` (default) | `progress` (with an amount; adds research progress on that formula, the "discovery" source) | `fullCopy` (permanent formula on completion).
  - The loan always works regardless of `teaches`.
  - If the crafter already knows the formula, hide the option or show a warning; it does nothing.

## Storage
One world-level list (GM-owned, single source of truth). The UI filters per player. Player writes are relayed to the GM client (see `08-foundry-integration.md`).

## Open
- Whether crafting from a loaned formula banks practice insight (unconfirmed).
- Decided (Stage 8): a failed craft follows the `03-crafting.md` rules (fee lost, loss rolls on the supplier's materials), the commission stays open, and the payout is paid only on delivery. See `10-stage2-decisions.md`.
