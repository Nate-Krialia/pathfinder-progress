import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A definition wrapped the way it appears in a Journal page. */
export const asPage = data => "```json\n" + JSON.stringify(data, null, 2) + "\n```";

export const source = (data, pack = "test.pack", entry = data?.id ?? "entry") => ({ pack, entry, text: asPage(data) });

export function seedRecords() {
  const dir = "content/definitions";
  return readdirSync(dir).filter(f => f.endsWith(".json")).sort()
    .map(file => ({ file, data: JSON.parse(readFileSync(join(dir, file), "utf8")) }));
}

export const clone = v => JSON.parse(JSON.stringify(v));

export const MATERIAL = { kind: "material", id: "iron", name: "Iron", tier: 1, effects: { basePower: "T1" } };
export const SILVER = { kind: "material", id: "silver", name: "Silver", tier: 2, effects: { basePower: "T2", bonusDamage: "+1d4 vs fiends" } };
export const RECIPE = {
  kind: "recipe", id: "blade", name: "Blade", category: "weapon",
  itemTemplate: "Item.abc",
  slots: [{ name: "edge", drives: "basePower", tierFloor: 1, qty: 1 }],
  stationCategory: "smithing", stationTierMin: 1,
  skillWhitelist: ["crafting"], researchProject: { tier: 1 }
};
