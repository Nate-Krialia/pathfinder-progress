import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A definition wrapped the way it appears in a Journal page. */
export const asPage = data => "```json\n" + JSON.stringify(data, null, 2) + "\n```";

export const source = (data, pack = "test.pack", entry = data?.id ?? "entry") => ({ pack, entry, text: asPage(data) });

/** Every seed definition: the public ones and the recipes. */
export function seedRecords() {
  return ["content/definitions", "content/recipes"].flatMap(dir =>
    readdirSync(dir).filter(f => f.endsWith(".json")).sort()
      .map(file => ({ file, data: JSON.parse(readFileSync(join(dir, file), "utf8")) })));
}

export const clone = v => JSON.parse(JSON.stringify(v));

export const UUID = "Compendium.pf2e.equipment-srd.Item.AAAAAAAAAAAAAAAA";
export const UUID_2 = "Compendium.pf2e.equipment-srd.Item.BBBBBBBBBBBBBBBB";

export const MATERIAL = { kind: "material", id: "iron", name: "Iron", tier: 1, effects: { basePower: "T1" } };
export const SILVER = {
  kind: "material", id: "silver", name: "Silver", tier: 2,
  effects: { basePower: "T2", bonusDamage: { dice: "1d4", type: "spirit", versus: "fiend" } }
};
export const FANG = {
  kind: "material", id: "spider-fang", name: "Spider Fang", tier: 2,
  effects: {
    bonusDamage: { dice: "1d4", type: "poison" },
    specialAbility: { title: "Spider Venom", text: "Fortitude DC 18 or sickened 1.", on: "hit" }
  }
};
export const RECIPE = {
  kind: "recipe", id: "blade", name: "Blade", category: "weapon",
  output: { "1": UUID, "2": UUID_2 },
  craftLevel: 1,
  slots: [{ name: "edge", drives: "basePower", tierFloor: 1, qty: 1 }],
  stationCategory: "smithing", stationTierMin: 1,
  skillWhitelist: ["crafting"], researchProject: { tier: 1 }
};
/** Dagger plus a fang slot that drives two roles. */
export const FANG_RECIPE = {
  ...RECIPE, id: "fang-dagger", name: "Fang Dagger",
  slots: [
    { name: "blade", drives: "basePower", tierFloor: 1, qty: 1 },
    { name: "fang", drives: ["bonusDamage", "specialAbility"], tierFloor: 2, qty: 1 }
  ]
};

/** A downtime period that is open for these characters (test fakes use it so queue actions are allowed). */
export const openDowntime = ids => ({ open: true, days: 99, startedAt: 1, participants: Object.fromEntries(ids.map(id => [id, { granted: 99, spent: 0 }])), log: [] });

/**
 * The leak scanner for CHAT (docs/11b, Stage 11a). Real Foundry hands EVERY message to EVERY client, a whisper included, so a message
 * with a DC or a roll in it leaks whoever it is whispered to. Pass env.chat (all messages, visible or not). Returns the offenders.
 */
export const CHAT_LEAK = /vs DC|\bDC\b|GM only|\bnatural\b|d100|d20=|Perception total|total \d|\d\s?%|\bodds\b|\bchance\b/i;
export const chatLeaks = messages => messages.filter(m => CHAT_LEAK.test(m.content ?? "")).map(m => m.content);

/**
 * The tag leak scan (Slice 1): what in a PLAYER payload (the records the GM relays, or a whole player registry) must never be there.
 *   - any `needs`, `tags`, `tagLedger`, `ledger` or `priority` key anywhere;
 *   - a `tier` on a record whose id is an item only the ledger knows (PF2e items have no tier of their own; the GM's word stays on the GM client);
 *   - an entry of a slot's `fits` with anything but { id, name };
 *   - a needed tag's id anywhere in a recipe slot outside `fits`.
 * @param {object[]|object} payload  records ([{ kind, data }] or bare records) or a registry of Maps
 * @param {{ ledgerOnlyRefs?: string[], neededTags?: string[] }} known  what the GM actually holds
 */
export function findTagLeaks(payload, { ledgerOnlyRefs = [], neededTags = [] } = {}) {
  const leaks = [];
  const forbidden = new Set(["needs", "tags", "tagLedger", "ledger", "priority", "effectBlocks", "effectSets", "caps", "tagCaps", "contributions", "capNotes", "bySlot", "tagOverrides", "tagCrafted", "inherited", "passCap", "outputTags", "native"]);
  const walk = (node, path) => {
    if (node instanceof Map) return walk([...node.values()], path);
    if (Array.isArray(node)) return node.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (!node || typeof node !== "object") return undefined;
    if (typeof node.id === "string" && ledgerOnlyRefs.includes(node.id) && "tier" in node) leaks.push(`${path}.tier (a ledger item's tier)`);
    for (const [k, v] of Object.entries(node)) {
      if (forbidden.has(k)) leaks.push(`${path}.${k}`);
      if (k === "slots" && Array.isArray(v)) v.forEach((slot, i) => {
        if (slot && "kind" in slot) leaks.push(`${path}.slots[${i}].kind (a slot kind)`);
        const { fits, ...rest } = slot;
        const text = JSON.stringify(rest);
        for (const t of neededTags) if (text.includes(`"${t}"`)) leaks.push(`${path}.slots[${i}] names the needed tag "${t}"`);
        for (const f of fits ?? []) if (Object.keys(f).sort().join() !== "id,name") leaks.push(`${path}.slots[${i}].fits has more than id and name`);
      });
      walk(v, `${path}.${k}`);
    }
    return undefined;
  };
  walk(Array.isArray(payload) ? payload.map(r => r?.data ?? r) : payload, "payload");
  return leaks;
}

/**
 * The canary scan (Slice 2a): author GM-only tag data with CANARY values nobody would write by accident (a resistance of 37, an ability text, a die count nobody uses), then
 * prove none of them appears anywhere a player can read. `payloads` is { name: anything JSON-able }; returns the places where a canary showed up.
 */
export function findCanaries(payloads, canaries) {
  const hits = [];
  for (const [name, payload] of Object.entries(payloads)) {
    const text = typeof payload === "string" ? payload : JSON.stringify(payload ?? null);
    for (const canary of canaries) if (text.includes(String(canary))) hits.push(`${name} contains ${canary}`);
  }
  return hits;
}
