/** Throwaway "Gate" facts for the Hub tests and screenshots. No campaign data. */
import { emptyState } from "../scripts/hub/viewmodels.js";

export const BLADE = {
  kind: "recipe", id: "gate-blade", name: "Gate Blade", category: "weapon",
  slots: [{ name: "blade", drives: "basePower", tierFloor: 1, qty: 1 }, { name: "edge", drives: ["bonusDamage", "specialAbility"], tierFloor: 2, qty: 1 }],
  stationCategory: "smithing", stationTierMin: 1, skillWhitelist: ["crafting"], days: { default: 2, byStation: {} }
};
export const VEST = {
  kind: "recipe", id: "gate-vest", name: "Gate Vest", category: "armor",
  slots: [{ name: "hide", drives: "basePower", tierFloor: 1, qty: 2 }],
  stationCategory: "smithing", stationTierMin: 1, skillWhitelist: ["crafting"], days: { default: 1, byStation: {} }
};
export const DRAUGHT = {
  kind: "recipe", id: "gate-draught", name: "Gate Draught", category: "consumable",
  slots: [{ name: "base", drives: "basePower", tierFloor: 1, qty: 1 }],
  stationCategory: "alchemy", stationTierMin: 1, skillWhitelist: ["crafting"], days: { default: 1, byStation: {} }
};
export const IRON = { kind: "material", id: "gate-iron", name: "Gate Iron", tier: 1 };
export const STEEL = { kind: "material", id: "gate-steel", name: "Gate Steel", tier: 2 };
export const STAR = { kind: "material", id: "gate-star", name: "Gate Star", tier: 3 };
export const BENCH = { id: "gate-bench", name: "Gate Bench", tier: 1, where: "Gate Town", reachable: true, usable: true, fee: 1 };
export const FORGE = { id: "gate-forge", name: "Gate Forge", tier: 2, where: "Gate Town", reachable: true, usable: true, fee: 5 };

export const STAR_EFFECT = { bonusDamage: { dice: "1d8", type: "spirit" } };
export const STEEL_EFFECT = { basePower: "T2" };

export function makeFacts(over = {}) {
  return {
    actor: { id: "gate-ann", name: "Gate Ann" },
    characters: [{ id: "gate-ann", name: "Gate Ann" }],
    downtime: { open: true, participant: true },
    days: { free: 6, reserved: 0 }, gp: 50,
    location: { name: "Gate Town", stations: ["Gate Bench"] },
    queue: [],
    formulas: [{ recipeId: "gate-blade", name: "Gate Blade", access: "owned" }, { recipeId: "gate-vest", name: "Gate Vest", access: "owned" }],
    researching: [],
    recipes: { "gate-blade": BLADE, "gate-vest": VEST, "gate-draught": DRAUGHT },
    materials: { "gate-iron": IRON, "gate-steel": STEEL, "gate-star": STAR },
    inventory: { "gate-iron": 5, "gate-steel": 1, "gate-star": 1 },
    met: ["gate-iron", "gate-steel", "gate-star"],
    learned: {},
    stations: [BENCH],
    preview: null,
    definitions: "ready",
    ...over
  };
}

export const makeState = over => ({ ...emptyState(), recipeId: "gate-blade", ...over });
