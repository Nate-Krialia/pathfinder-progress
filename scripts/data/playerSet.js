/**
 * What a PLAYER client loads (Stage 16). Pure; no Foundry globals.
 *
 * Players do not read the definition packs. The GM client works out, from the FACTS about the characters a user owns and
 * where the party is, which definitions that user needs, strips the fields they do not need, and sends them over the
 * `definitionsFor` socket handler. This is an honor system, not secrecy (docs/10): Foundry cannot hide data from a client,
 * so this decides what the module LOADS and SHOWS, not what a determined player could read from the console.
 *
 * facts = {
 *   actors: [{ id, formulas: [recipeId], blueprints: [blueprintId], designs: [blueprintId], materials: [materialId],
 *              stations: [stationId], towns: [townId] }],
 *   location: townId | null,          // where the party is
 *   sceneTags: [string],              // tags of the scenes the user's characters stand on, and the scene they are viewing
 *   nodeTypes: [nodeTypeId],          // node types of revealed nodes on those scenes
 *   stationTowns: [townId],           // towns of the user's own and the party's workshops
 *   stateStations: [stationId]        // public stations whose saved state names one of the user's characters
 * }
 */
import { PLAYER_SCHEMAS } from "./schemas.js";
import { check } from "./schema.js";

const unique = list => [...new Set(list.filter(x => typeof x === "string" && x !== ""))].sort();

/** The facts in a fixed shape (sorted, de-duplicated), so two equal situations compare equal. */
export function normalizeFacts(facts = {}) {
  return {
    actors: (facts.actors ?? []).map(a => ({
      id: String(a.id),
      formulas: unique(a.formulas ?? []), blueprints: unique(a.blueprints ?? []), designs: unique(a.designs ?? []),
      materials: unique(a.materials ?? []), stations: unique(a.stations ?? []), towns: unique(a.towns ?? [])
    })).sort((a, b) => a.id.localeCompare(b.id)),
    location: facts.location || null,
    sceneTags: unique(facts.sceneTags ?? []),
    nodeTypes: unique(facts.nodeTypes ?? []),
    stationTowns: unique(facts.stationTowns ?? []),
    stateStations: unique(facts.stateStations ?? [])
  };
}

/** A string that changes exactly when the facts change. The player client asks the GM again only when this changes. */
export const factsKey = facts => JSON.stringify(normalizeFacts(facts));

/** The player's copy of one record: a region without its spawn table, a node type without ladders and charges. Others whole. (The region's DC stays: see schemas.js.) */
export function stripForPlayer(kind, record) {
  const copy = structuredClone(record);
  if (kind === "region") delete copy.spawnTable;
  if (kind === "nodeType") { delete copy.ladders; delete copy.charges; }
  return copy;
}

const KINDS_SENT = ["recipe", "blueprint", "material", "station", "town", "region", "nodeType"];

/**
 * Which definitions this set of facts needs, from the GM's full registry (kind -> Map(id -> record)).
 * @returns {{ records: Array<{ kind: string, data: object }>, missingRecipes: string[], recipeIds: string[] }}
 *   missingRecipes = formulas held with no recipe in the GM's registry (a truly orphaned formula).
 */
export function selectRecords(rawFacts, registry) {
  const facts = normalizeFacts(rawFacts);
  const pick = (kind, ids) => ids.map(id => registry[kind]?.get(id)).filter(Boolean).map(data => ({ kind, data }));
  const all = key => unique(facts.actors.flatMap(a => a[key]));

  const formulaIds = all("formulas");
  const missingRecipes = formulaIds.filter(id => !registry.recipe?.has(id));
  const recipes = pick("recipe", formulaIds);
  const blueprints = pick("blueprint", unique([...all("blueprints"), ...all("designs")]));
  const materials = pick("material", all("materials"));

  // Stations: those in the town the party is in, the user's own and the party's workshops' towns, any whose saved state names the
  // user's characters, and any a project of theirs is about. Towns follow the stations, plus the places the party or a build names.
  const stationTowns = new Set([facts.location, ...facts.stationTowns].filter(Boolean));
  const stationIds = new Set([...facts.stateStations, ...all("stations")]);
  const stations = [...(registry.station?.values() ?? [])].filter(s => stationTowns.has(s.town) || stationIds.has(s.id)).map(data => ({ kind: "station", data }));
  const townIds = unique([...stationTowns, ...all("towns"), ...stations.map(s => s.data.town)]);
  const towns = pick("town", townIds);

  const regions = [...(registry.region?.values() ?? [])].filter(r => facts.sceneTags.includes(r.sceneTag)).map(data => ({ kind: "region", data: stripForPlayer("region", data) }));
  const nodeTypes = pick("nodeType", facts.nodeTypes).map(r => ({ kind: "nodeType", data: stripForPlayer("nodeType", r.data) }));

  return { records: [...recipes, ...blueprints, ...materials, ...stations, ...towns, ...regions, ...nodeTypes], missingRecipes, recipeIds: formulaIds };
}

/** An empty registry for a client that has loaded nothing yet. */
export const emptyRegistry = () => Object.fromEntries([...Object.keys(PLAYER_SCHEMAS)].map(kind => [kind, new Map()]));

/**
 * The player side: put delivered records into a registry. Each is checked against the PLAYER schema for its kind (strict, so a record
 * that still carried a stripped field is rejected). Cross-references are not rechecked: the GM validated the whole set when it loaded.
 * @returns {{ registry, errors: string[] }}
 */
export function loadPlayerRecords(records) {
  const registry = emptyRegistry();
  const errors = [];
  for (const { kind, data } of Array.isArray(records) ? records : []) {
    const schema = PLAYER_SCHEMAS[kind];
    if (!schema || !KINDS_SENT.includes(kind)) { errors.push(`the GM sent a record of kind "${kind}", which players do not load`); continue; }
    const problems = check(schema, data);
    if (problems.length) { errors.push(`${kind} "${data?.id ?? "?"}": ${problems.map(p => `${p.field} ${p.message}`).join("; ")}`); continue; }
    registry[kind].set(data.id, data);
  }
  return { registry, errors };
}

/** The kinds a player copy can hold. */
export const PLAYER_KINDS = KINDS_SENT;
