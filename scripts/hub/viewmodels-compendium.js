/**
 * The Compendium tab's view-model (Stage 11b round). Pure. Per character; every fact is one the character experienced (no placeholders, no "???").
 *
 * facts.compendium: { entries: { materials, creatures, regions, experiments }, own: { ... }, shared: { ... } }  (api.compendium.view(actor), or null if it could not be read)
 * facts.shares: [{ actionId, kind, key }]  the character's queued shares     state: category, entryKey
 */
import { S } from "./strings.js";
import { cap, effectLines } from "./common.js";

export const CATEGORIES = ["materials", "creatures", "regions", "experiments"];
const KIND = { materials: "material", creatures: "creature", regions: "region", experiments: "experiment" };
const KEY = { material: e => e.id, creature: e => e.key, region: e => e.id, experiment: e => e.recipeId };
const keyOf = (kind, entry) => KEY[kind](entry);
const asList = x => (Array.isArray(x) ? x : []);

const has = (list, test) => asList(list).some(test);
/** Is everything of `own` already in `shared`? (The same idea as the server's merge, on the lists the view gives.) */
function coveredBy(kind, own, shared) {
  if (!shared) return false;
  if (kind === "material") return asList(own.places).every(p => has(shared.places, q => q.key === p.key)) && asList(own.rungs).every(r => has(shared.rungs, q => q.nodeType === r.nodeType && q.tier === r.tier && q.rung === r.rung));
  if (kind === "creature") return asList(own.yields).every(y => has(shared.yields, q => q.materialId === y.materialId));
  if (kind === "region") return asList(own.nodeTypes).every(t => has(shared.nodeTypes, q => q.id === t.id));
  return asList(own.known).every(k => has(shared.known, q => q.slot === k.slot && q.materialId === k.materialId)) && (!own.baseline || Boolean(shared.baseline));
}

/** "private" (Only you), "queued" (waiting for the GM), or "shared" (the party can read everything the character knows of it). */
export function shareState(facts, kind, key) {
  if (asList(facts.shares).some(s => s.kind === kind && s.key === key)) return "queued";
  const category = Object.keys(KIND).find(c => KIND[c] === kind);
  const find = list => asList(list?.[category]).find(e => keyOf(kind, e) === key);
  const own = find(facts.compendium?.own);
  if (!own) return "shared";                       // nothing of the character's own to share: it came from the party
  return coveredBy(kind, own, find(facts.compendium?.shared)) ? "shared" : "private";
}

const lines = (heading, items, empty) => ({ heading, items, empty: items.length === 0 ? empty : null });

function detailOf(kind, entry, facts) {
  if (kind === "material") {
    const rungs = [...new Set(asList(entry.rungs).map(r => r.rung))].filter(r => S.rungWords[r]).map(r => S.rungWords[r]);
    return {
      kind, title: entry.name, meta: entry.tier === undefined || entry.tier === null ? null : S.tierLine(entry.tier),
      sections: [
        lines(S.foundAt, asList(entry.places).map(p => p.label), S.foundAtNone),
        lines(S.gatheredAs, rungs, S.gatheredNone),
        lines(S.usedIn, asList(entry.usedIn).map(u => u.name), S.usedInNone)
      ]
    };
  }
  if (kind === "creature") return { kind, title: entry.name, meta: S.creatureType(entry.type), sections: [lines(S.takenFrom, asList(entry.yields).map(y => y.name), S.takenNone)] };
  if (kind === "region") return { kind, title: entry.name, meta: null, sections: [lines(S.nodesFound, asList(entry.nodeTypes).map(t => t.name), S.nodesNone)] };
  // experiment: the baseline (what the cheapest valid materials make), then each material learned in each slot
  const recipe = facts.recipes?.[entry.recipeId];
  const baseline = entry.baseline ? [
    ...(entry.baseline.baseTier ? [S.baselineTier(entry.baseline.baseTier)] : [S.baselineKnown]),
    ...asList(entry.baseline.slots).flatMap(s => [
      S.baselineSlot(s.slot, s.needs), ...(effectLines(s.material ?? S.baselineMaterialUnnamed, { known: true, effects: s.effects }, recipe) ?? []), ...(s.material ? [S.baselineMaterial(s.material)] : [])
    ])
  ] : [];
  const known = asList(entry.known).map(k => ({ head: S.knownLine(k.slot, k.material), via: S.knownVia[k.source] ?? "", effects: effectLines(k.material, { known: true, effects: k.effects }, recipe) ?? [] }));
  return {
    kind, title: entry.name, meta: null,
    sections: [lines(S.baselineHeading, baseline, S.knownNone)],
    known: { heading: S.knownHeading, items: known, empty: known.length === 0 ? S.knownNone : null }
  };
}

export function compendiumTab(facts, state) {
  const book = facts.compendium;
  const category = CATEGORIES.includes(state.category) ? state.category : "materials";
  const kind = KIND[category];
  if (!book) return { heading: S.compendiumHeading, unavailable: S.compendiumUnavailable, chips: [], list: { cards: [], empty: null }, detail: { kind: "empty", text: S.pickEntry }, countLine: "" };
  const entries = Object.fromEntries(CATEGORIES.map(c => [c, asList(book.entries?.[c])]));
  const total = CATEGORIES.reduce((n, c) => n + entries[c].length, 0);
  const cards = entries[category].map(e => {
    const key = keyOf(kind, e);
    const share = shareState(facts, kind, key);
    return { key: `entry:${kind}:${key}`, entryKey: key, name: e.name, sub: kind === "material" && e.tier !== undefined ? S.tierLine(e.tier) : (kind === "creature" ? S.creatureType(e.type) : ""), share, pill: S.sharePill[share], selected: key === state.entryKey };
  });
  const entry = entries[category].find(e => keyOf(kind, e) === state.entryKey) ?? null;
  let detail = { kind: "empty", text: S.pickEntry };
  if (entry) {
    const key = keyOf(kind, entry);
    const share = shareState(facts, kind, key);
    const queued = asList(facts.shares).find(s => s.kind === kind && s.key === key) ?? null;
    detail = {
      ...detailOf(kind, entry, facts), entryKey: key, share,
      sharing: {
        pill: S.sharePill[share],
        text: share === "queued" ? S.shareTextQueued : share === "shared" ? S.shareTextShared : S.shareTextPrivate,
        button: share === "private" ? { text: S.shareButton } : null,
        cancel: share === "queued" ? { text: S.shareCancel, actionId: queued?.actionId ?? null } : null
      }
    };
  }
  return {
    heading: S.compendiumHeading, countLine: S.countLine(total), categoryLabel: S.categoryLabel,
    chips: CATEGORIES.map(c => ({ id: c, label: S.categoryNames[c], count: entries[c].length, selected: c === category })),
    list: { cards, empty: cards.length === 0 ? S.categoryEmpty[category] : null },
    detail, category
  };
}

/** What api.queue.submit needs to share the selected entry, or null. */
export function shareRequest(facts, state) {
  const tab = compendiumTab(facts, state);
  if (tab.detail.kind === "empty" || !tab.detail.sharing?.button) return null;
  return { kind: tab.detail.kind, key: tab.detail.entryKey, name: tab.detail.title };
}

export { cap };
