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
    projects: [], leads: [], queuedResearch: [], shares: [], compendium: null,
    ...over
  };
}

export const makeState = over => ({ ...emptyState(), recipeId: "gate-blade", ...over });

// Research and Compendium (Stage 11b round): throwaway "Gate" data -------------------------------------------------------------------------------------
export const PROJECT = {
  id: "unlock-gate-draught", goalName: "Gate Draught", kind: "unlockFormula", recipeId: "gate-draught", progress: 3, threshold: 8,
  skills: [{ skill: "crafting", label: "Crafting", modifier: 7 }, { skill: "arcana", label: "Arcana", modifier: -1 }],
  log: [{ source: "research", degree: "success", delta: 1, skill: "crafting" }, { source: "research", degree: "criticalSuccess", delta: 2, skill: "crafting" }, { source: "research", degree: "failure", delta: 0, skill: "crafting" }],
  hint: null
};
export const UPGRADE = {
  id: "upgrade-gate-bench", goalName: "Gate Bench: tier upgrade", kind: "upgradeStation", recipeId: null, progress: 2, threshold: 12,
  skills: [{ skill: "crafting", label: "Crafting", modifier: 7 }], log: [], hint: null
};
export const BIG_PROJECT = { ...PROJECT, id: "unlock-gate-giant", goalName: "Gate Giant", recipeId: "gate-giant", progress: 17, threshold: 40, skills: [{ skill: "crafting", label: "Crafting", modifier: null }] };
export const LEAD = { id: "lead-1", recipeId: "gate-lantern", name: "Gate Lantern", note: "A glassblower in Gate Town mentioned it." };

export const researchFacts = over => makeFacts({ projects: [PROJECT, UPGRADE], leads: [LEAD], ...over });
export const researchState = over => makeState({ tab: "research", recipeId: null, ...over });

const place = { key: "region:gate-field", label: "Gate Field" };
export const BOOK_ENTRIES = {
  materials: [
    { id: "gate-iron", name: "Gate Iron", tier: 1, firstAt: 1, places: [place], rungs: [{ nodeType: "gate-bush", tier: 1, rung: "base" }, { nodeType: "gate-bush", tier: 1, rung: "higher" }], shared: false, usedIn: [{ recipeId: "gate-blade", name: "Gate Blade" }] },
    { id: "gate-star", name: "Gate Star", tier: 3, firstAt: 2, places: [], rungs: [], shared: false, usedIn: [] }
  ],
  creatures: [{ key: "gate-wolf", name: "Gate Wolf", type: "beast", firstAt: 1, yields: [{ materialId: "gate-fang", name: "Gate Fang" }], shared: false }, { key: "gate-bat", name: "Gate Bat", type: "beast", firstAt: 2, yields: [], shared: false }],
  regions: [{ id: "gate-field", name: "Gate Field", firstAt: 1, nodeTypes: [{ id: "gate-bush", name: "Gate Bush" }], shared: false }],
  experiments: [{
    recipeId: "gate-blade", name: "Gate Blade", source: "own",
    baseline: { baseTier: 1, slots: [{ slot: "blade", needs: "tier 1 or higher", effects: { basePower: "T1" }, material: "Gate Iron" }, { slot: "edge", needs: "tier 2 or higher", effects: { bonusDamage: { dice: "1d6", type: "fire" } }, material: null }] },
    known: [{ slot: "edge", materialId: "gate-star", material: "Gate Star", tier: 3, effects: STAR_EFFECT, source: "crafted" }, { slot: "blade", materialId: "gate-steel", material: "Gate Steel", tier: 2, effects: STEEL_EFFECT, source: "shared" }]
  }]
};
const strip = list => list.map(({ source, ...rest }) => rest);
export const makeBook = (over = {}) => ({
  entries: BOOK_ENTRIES,
  own: { materials: strip(BOOK_ENTRIES.materials), creatures: strip(BOOK_ENTRIES.creatures), regions: strip(BOOK_ENTRIES.regions), experiments: BOOK_ENTRIES.experiments },
  shared: { materials: [], creatures: [], regions: [], experiments: [] },
  ...over
});
export const compendiumFacts = over => makeFacts({ compendium: makeBook(), shares: [], ...over });
export const compendiumState = over => makeState({ tab: "compendium", recipeId: null, ...over });
