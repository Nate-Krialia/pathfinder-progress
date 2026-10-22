# 07 Stations

## Concept
The "small cost for the station and misc stuff" lives here. A station is a **data record**, not a map object, so crafting works anywhere. It can be linked to a map tile later.

## Record
`name`, `category` (smithing, alchemy, ...), `tier`, `location`, `owner`, `access`.
- `location: fixed` (in a town; available to anyone there, or per access list) or `carried` (goes with its holder; usable by the holder or whoever they allow).
- Craft code is location-agnostic: it asks "which stations can this crafter reach right now?"

## Roles of category and tier
- `category` decides what can be crafted (a forge cannot brew potions).
- `tier` caps which recipes it can handle (`stationTierMin`) and **sets the fee**.
- **Fee is a pure function of tier** (config table).

## Portable stations
Portable kits have a **lower tier cap** (initially tier 1 or 2; configurable). This keeps commissions to proper workshops valuable. Upgraded kits can come as loot or purchases later.

## Player-owned workshops
- Fixed station with an `owner` (PC, NPC, or none for public forges) and a permission list (`access`), so owners can let party crafters use it.
- Workshops start at tier 1 and **upgrade via projects** on the research engine: `outcome: upgradeStation`, same daily check/threshold/skill whitelist, and consumed materials plus a fee (see `02-research.md`).

## Fee timing
The fee is consumed on craft (lost on failure; see `03-crafting.md`). Exact fee amounts per tier are tunable and not yet set.
