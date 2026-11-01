/**
 * The item editor window's model and markup (Stage 11d, docs/11d-item-editor-addendum.md). GM only, so its words live here, not in the Hub's strings. Pure: no Foundry globals.
 *
 * Three panes: a list (search, filter chips, collapsible groups, leftovers), the editor (Basics, Discovery, Research track, Effects) and "What players see" (a live
 * preview in the Hub's own wording, for the item class picked at the top). The window keeps a DRAFT; everything the draft means (what is dirty, what is wrong, what to
 * save) is worked out here from the draft and the live registry, so there is no separate "dirty" flag to get out of step.
 */
import { DISCOVERY, EFFECT_CONDITIONS, EFFECT_SAVES, EFFECTS, ITEM_CLASSES, TRIGGER_WORDS } from "../config.js";
import { DAMAGE_TYPES } from "../adapter/pf2e.js";
import { rolesForCategory } from "../data/roles.js";
import { normalizeDisplay } from "../hub/display.js";
import { rootAttributes } from "../hub/render.js";
import { W } from "../discovery/words.js";
import { isDifficultyText } from "../difficulty.js";
import { itemKey, parseKey, trackOf } from "../discovery/track.js";
import { BLOCK_LABELS, BLOCK_TYPES, MULTI_BLOCKS, TIERS, classRoles, powerRole, collapse, decompileRecord, describeRoles, fitsRoles, flat, newBlock, setProblems, spread, valueAt } from "./blocks.js";
import { rowEdit, rowProblems, rowsOf, trackOfRows } from "./rows.js";
import { NO_STUDY, STAGES as PREVIEW_STAGES, STAGE_LABELS, stageOf } from "./preview.js";
import { S } from "../hub/strings.js";

export const E = {
  title: "Item editor",
  intro: "Make and edit materials and notes. Changes are saved in this world, never in the module's packs, and players only ever see the plain words in the right-hand pane.",
  pick: "Pick an item on the left, or make a new one.",
  groups: { material: "Materials", note: "Notes", recipe: "Higher formula versions", leftover: "Leftovers" },
  newMaterial: "New material", newNote: "New note", exportAll: "Export", importAll: "Import",
  chipKinds: { material: "Materials", note: "Notes", recipe: "Higher versions" },
  chipTrack: { has: "Has a track", none: "No track" },
  chipShow: { retired: "Show retired" },
  searchLabel: "Search items", searchHint: "Type part of a name", filtersLabel: "Show",
  groupCount: (shown, total) => (shown === total ? `${total}` : `${shown} of ${total}`),
  noMatches: "Nothing matches. Clear the search or a filter.",
  madeHere: "made here", editedHere: "edited here", retiredTag: "retired", hasTrack: "has a track",
  leftoverHelp: "Saved edits or tracks that match nothing now. Remove them once you are sure you do not need them.",
  removeLeftover: "Remove",
  sections: { basics: "Basics", discovery: "Discovery", track: "Research track", effects: "Effects" },
  fields: { name: "Name", tier: "Tier", value: "Gold value (gp each)", bulk: "Bulk", img: "Image path", description: "Description", label: "Label (optional, like Parts)", tag: "Tag", recipe: "Formula it teaches", preset: "Kind of note" },
  noTag: "No tag",
  tagTheme: (tag, theme) => `Once a character knows it: ${tag}, a theme of ${theme}.`,
  noTagLine: "Without a tag, its theme is not part of what players learn.",
  origin: { pack: "From the module's packs.", world: "Made in this world's editor.", edited: "From the packs, with edits made here." },
  editedFields: names => `Edited here: ${names.join(", ")}.`,
  presets: { plan: "Plan note (a short study teaches the formula)", research: "Research note (a longer study)" },
  trackNone: "No study. The item is known and usable on pickup and never offers a lead.",
  trackFrom: "This item has a research track.",
  addMilestone: "Add a milestone", addDefault: "Add the default track", removeRow: "Remove", stepsLabel: "Steps", grantsLabel: "Grants",
  properties: "Properties (what it is good for, and its tag)", formula: "A formula", formulaPick: "Pick a formula",
  classTabs: "Item class", general: "Every class", generalHelp: "Applies to every class unless a class has its own setting below.",
  classHelp: cls => `${ITEM_CLASSES[cls].label} items: effects ${TRIGGER_WORDS[ITEM_CLASSES[cls].trigger]}. These win over "Every class" for the same effect.`,
  power: "Base power tier", spellPower: "Spell power tier", noPower: "None",
  addBlock: "Add a block", blockLabels: BLOCK_LABELS, removeBlock: "Remove this block",
  dice: "Dice", damageType: "Damage type", persistent: "Persistent", versus: "Only against (optional)", amount: "Amount",
  condition: "Condition", conditionValue: "Value", conditionSave: "Saving throw", conditionHelp: "The target gets a saving throw when the GM presses Apply on the card. Only you see this, never players.",
  abilityTitle: "Ability name", abilityText: "What it does", abilityOn: "When", abilityOnAny: "Whenever it applies", abilityOnHit: "On a hit", abilityOnCrit: "On a critical hit",
  sameForAll: "Same for every tier", perTier: "Table by tier", tierCell: tier => `Tier ${tier}`,
  tableNote: "A material has one tier, so the table row for its own tier is the one that counts.",
  extraKept: roles => `Also kept as it was: ${roles.join(", ")}.`,
  nothingYet: "Nothing set for this class yet.",
  save: "Save", discard: "Discard changes", revert: "Take back my edits", retire: "Retire", unretire: "Bring back", delete: "Delete", pushCopies: "Push to copies", makeItem: "Make an item",
  unsaved: "You have unsaved changes.", saved: name => `Saved ${name}.`, nothingToSave: "Nothing to save.",
  create: "Create", cancel: "Cancel", chooseTier: "Choose a tier", chooseFormula: "Choose a formula", chooseKind: "Choose a kind of note", creatingMaterial: "New material", creatingNote: "New note",
  preview: "What players see", previewStage: "Stage", previewNoEffectsYet: "No effects yet: a player learns what it does by crafting with it.", previewClass: "Item class", previewIn: "In a", previewNothing: "Players would see no effect from this yet.",
  previewWorth: gp => `Worth ${gp} gp each`, previewBulk: bulk => `Bulk ${bulk}`, previewTier: tier => `Tier ${tier}`,
  previewFits: roles => `Fills slots that need: ${roles.join(", ")}`, previewFitsNone: "Fills no slots yet.",
  previewStudy: `Study: ${W.stages.join(" → ")}`, previewNoStudy: "No study: known and usable on pickup.",
  previewSheet: "On the item sheet",
  previewDifficulty: "This text mentions a DC or odds. The Hub hides that wording from players, but the item's own description would not.",
  confirmYes: "Yes, do it", confirmNo: "No, keep things as they are",
  roleWords: { basePower: "base power", spellPower: "spell power", bonusDamage: "bonus damage", specialAbility: "a special ability", resistance: "resistance", spellSlots: "spell slots", applyCondition: "a condition on the target" }
};

const KIND_LABEL = { material: "Material", note: "Note", recipe: "Formula version" };
export const BULKS = ["L", ...Array.from({ length: 10 }, (_, i) => String(i + 1))];
export const CLASS_IDS = Object.keys(ITEM_CLASSES);
const NOTE_PRESETS = ["plan", "research"];

// The list ---------------------------------------------------------------------------------------------------------------
/** The items that can be listed: [{ key, kind, id, name, sub, hasTrack, origin, retired }]. */
export function listItems(registry, overlay = {}, records = {}) {
  const items = [];
  for (const m of registry.material.values()) items.push({ key: itemKey("material", m.id), kind: "material", id: m.id, name: m.name, sub: m.label ?? `Tier ${m.tier}`, retired: Boolean(m.retired) });
  for (const n of registry.note.values()) items.push({ key: itemKey("note", n.id), kind: "note", id: n.id, name: n.name, sub: registry.recipe.get(n.recipeId)?.name ?? "", retired: Boolean(n.retired) });
  for (const r of registry.recipe.values()) if ((r.version ?? 1) >= 2) items.push({ key: itemKey("recipe", r.id), kind: "recipe", id: r.id, name: r.name, sub: `Version ${r.version}`, retired: false });
  return items.map(i => ({ ...i, hasTrack: Boolean(trackOf(registry[i.kind].get(i.id), overlay, i.key)), origin: records[i.key]?.mode === "new" ? "world" : records[i.key] ? "edited" : "pack" }));
}

/** Apply the search box and the filter chips. `filters`: { search, kinds: [kind...] (none = all), track: "all" | "has" | "none", retired: bool }. */
export function filterItems(items, filters = {}) {
  const text = String(filters.search ?? "").trim().toLowerCase();
  const kinds = filters.kinds?.length ? new Set(filters.kinds) : null;
  return items.filter(i => (filters.retired || !i.retired)
    && (!kinds || kinds.has(i.kind))
    && (filters.track === "has" ? i.hasTrack : filters.track === "none" ? !i.hasTrack : true)
    && (!text || `${i.name} ${i.sub}`.toLowerCase().includes(text)));
}

// The draft --------------------------------------------------------------------------------------------------------------
const TEXT_FIELDS = { material: ["name", "tier", "value", "bulk", "img", "description", "label", "tag"], note: ["name", "recipeId", "preset", "bulk", "img", "description", "label"], recipe: [] };

/** An editable copy of an item: { kind, fields (text, as typed), rows, blocks }. */
export function draftFor(registry, overlay, key) {
  const { kind, id } = parseKey(key);
  const def = registry[kind]?.get(id);
  if (!def) return null;
  const fields = {};
  for (const name of TEXT_FIELDS[kind]) fields[name] = def[name] === undefined || def[name] === null ? "" : String(def[name]);
  if (kind !== "recipe" && !fields.bulk) fields.bulk = "L";
  if (kind === "note" && !fields.preset) fields.preset = "research";
  return { kind, id, fields, rows: rowsOf(trackOf(def, overlay, key)), blocks: kind === "material" ? structuredClone(def.effectBlocks ?? decompileRecord(def)) : null };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const isDirty = (draft, base) => Boolean(draft && base) && !same(draft, base);

/** The definition fields that differ from `base`, ready for api.editor.update: text blanks remove an optional field. */
export function changesOf(draft, base) {
  const out = {};
  for (const name of TEXT_FIELDS[draft.kind]) {
    if (draft.fields[name] === base.fields[name]) continue;
    const raw = String(draft.fields[name] ?? "").trim();
    if (name === "tier") out.tier = Number(raw);
    else if (name === "value") out.value = raw === "" ? undefined : Number(raw);
    else out[name] = raw === "" && !["name", "bulk", "recipeId"].includes(name) ? undefined : raw;
  }
  if (!same(draft.rows, base.rows)) out.research = draft.rows.length ? trackOfRows(draft.rows) : undefined;
  if (draft.blocks && !same(draft.blocks, base.blocks)) out.effectBlocks = draft.blocks;
  return out;
}

/** What is wrong with a draft, as plain sentences: { fields: [text], rows: [{ index|null, text }], effects: { <class|general>: [text] } }. */
export function draftProblems(draft, registry) {
  const fields = [], effects = {};
  const f = draft.fields;
  if (!String(f.name ?? "").trim()) fields.push("Give it a name.");
  if (draft.kind === "material") {
    if (!/^[1-5]$/.test(String(f.tier).trim())) fields.push("Tier must be a whole number from 1 to 5.");
    if (String(f.value ?? "").trim() !== "" && !(Number(f.value) >= 0)) fields.push("Gold value must be a number, zero or more.");
    const tier = Number(f.tier) || 1;
    for (const cls of ["general", ...CLASS_IDS]) {
      const set = cls === "general" ? draft.blocks?.general : draft.blocks?.byClass?.[cls];
      const problems = setProblems(set, cls, tier);
      if (problems.length) effects[cls] = problems;
    }
  }
  if (draft.kind === "note" && !registry.recipe.has(f.recipeId)) fields.push("Pick the formula this note teaches.");
  const rows = draft.kind === "recipe" || draft.rows.length ? rowProblems(draft.rows, draft.kind, draft.id, registry) : [];
  return { fields, rows, effects, any: fields.length > 0 || rows.length > 0 || Object.keys(effects).length > 0 };
}

// Edits (pure; each returns a new draft) ----------------------------------------------------------------------------------
const setOf = (draft, cls) => (cls === "general" ? draft.blocks.general : draft.blocks.byClass?.[cls]) ?? { blocks: [] };
const emptySet = set => !set || (!set.blocks?.length && set.power === undefined && !Object.keys(set.extra ?? {}).length);
function withSet(draft, cls, set) {
  const blocks = structuredClone(draft.blocks);
  if (cls === "general") blocks.general = set;
  else {
    const byClass = { ...(blocks.byClass ?? {}) };
    if (emptySet(set)) delete byClass[cls]; else byClass[cls] = set;     // a class with nothing set is no entry at all, so an untouched class never makes the draft dirty
    blocks.byClass = byClass;
  }
  return { ...draft, blocks };
}
/** Map the `index`th block of `type` (blocks of a type that allows several are told apart by their position among that type). */
const mapBlock = (set, type, fn, index = 0) => { let n = -1; return { ...set, blocks: set.blocks.map(b => (b.type === type && ++n === index ? fn(b) : b)) }; };
const hasBlock = (draft, cls, type, index = 0) => setOf(draft, cls).blocks.filter(b => b.type === type).length > index;
const nth = (draft, cls, type, index = 0) => setOf(draft, cls).blocks.filter(b => b.type === type)[index];
/** The first condition of the curated list this class has not used yet. */
const freeCondition = set => Object.keys(EFFECT_CONDITIONS).find(c => !set.blocks.some(b => b.type === "condition" && b.condition === c));
const numeric = raw => (raw === "" || raw === null || raw === undefined ? "" : Number.isFinite(Number(raw)) ? Number(raw) : raw);

export const edit = {
  field: (draft, name, value) => ({ ...draft, fields: { ...draft.fields, [name]: String(value) } }),
  rowsDo: (draft, fn) => ({ ...draft, rows: fn(draft.rows) }),
  addBlock: (draft, cls, type) => {
    const set = setOf(draft, cls);
    if (MULTI_BLOCKS.includes(type)) {
      const condition = freeCondition(set);
      if (!condition || cls === "general") return draft;
      return withSet(draft, cls, { ...set, blocks: [...set.blocks, { ...newBlock(type), condition }] });
    }
    return set.blocks.some(b => b.type === type) ? draft : withSet(draft, cls, { ...set, blocks: [...set.blocks, newBlock(type)] });
  },
  removeBlock: (draft, cls, type, index = 0) => { let n = -1; const set = setOf(draft, cls); return withSet(draft, cls, { ...set, blocks: set.blocks.filter(b => !(b.type === type && ++n === index)) }); },
  power: (draft, cls, value) => { const set = { ...setOf(draft, cls) }; if (value === "" || value === "none") delete set.power; else set.power = Number(value); return withSet(draft, cls, set); },
  blockField: (draft, cls, type, name, value, index = 0) => !hasBlock(draft, cls, type, index) ? draft : withSet(draft, cls, mapBlock(setOf(draft, cls), type, b => {
    const next = { ...b };
    if (type === "condition" && name === "condition") { next.condition = value; if (EFFECT_CONDITIONS[value]?.valued && !b.value) next.value = flat(1); return next; }
    if (name === "persistent") { if (value === true || value === "true") next.persistent = true; else delete next.persistent; }
    else if (["versus", "on"].includes(name)) { if (value === "" || value === undefined) delete next[name]; else next[name] = value; }
    else if (name === "dice" || name === "value") next[name] = b[name]?.byTier ? { byTier: { ...b[name].byTier } } : flat(name === "value" ? numeric(value) : value);
    else next[name] = value;
    return next;
  }, index)),
  tierMode: (draft, cls, type, name, mode, tier, index = 0) => !hasBlock(draft, cls, type, index) ? draft : withSet(draft, cls, mapBlock(setOf(draft, cls), type, b => ({ ...b, [name]: mode === "table" ? spread(b[name], name === "dice" ? "1d6" : 1) : collapse(b[name], tier) }), index)),
  tierCell: (draft, cls, type, name, tier, value, index = 0) => !hasBlock(draft, cls, type, index) || !nth(draft, cls, type, index)[name]?.byTier ? draft : withSet(draft, cls, mapBlock(setOf(draft, cls), type, b => ({ ...b, [name]: { byTier: { ...b[name].byTier, [tier]: name === "value" ? numeric(value) : value } } }), index))
};

/**
 * One edit from a changed form control. `d` is the control's dataset: { field, name, index, cls, type, tier }. Returns the new draft.
 * (A single place maps the markup to the pure edits, so the tests can drive the window without a browser.)
 */
export function applyControl(draft, d, value) {
  const tier = Number(draft.fields.tier) || 1;
  switch (d.field) {
    case "basic": return edit.field(draft, d.name, value);
    case "row-steps": return edit.rowsDo(draft, rows => rowEdit.setSteps(rows, Number(d.index), value));
    case "row-grants": return edit.rowsDo(draft, rows => rowEdit.setGrants(rows, Number(d.index), value));
    case "row-recipe": return edit.rowsDo(draft, rows => rowEdit.setRecipe(rows, Number(d.index), value));
    case "power": return edit.power(draft, d.cls, value);
    case "block": return edit.blockField(draft, d.cls, d.type, d.name, value, Number(d.index ?? 0));
    case "cell": return edit.tierCell(draft, d.cls, d.type, d.name, Number(d.tier), value, Number(d.index ?? 0));
    case "tier-mode": return edit.tierMode(draft, d.cls, d.type, d.name, value, tier, Number(d.index ?? 0));
    default: return draft;
  }
}

// Preview ----------------------------------------------------------------------------------------------------------------
/** The class the preview opens on: the first class the material gives its own effects, else the first with any effect, else the first class. */
export function defaultPreviewClass(blocks) {
  const own = CLASS_IDS.find(cls => (blocks?.byClass?.[cls]?.blocks?.length ?? 0) > 0 || blocks?.byClass?.[cls]?.power !== undefined);
  if (own) return own;
  return CLASS_IDS[0];
}

/**
 * "What players see" for the draft: one of three stages (just picked up, after studying, after a successful craft) and, for the craft stage, one item class.
 * A material's stage comes from scripts/editor/preview.js (stripForPlayer + the Hub's own Compendium view-model); a note has no stages.
 */
export function previewOf(registry, draft, itemClass, stage = "crafted") {
  const f = draft.fields;
  const name = String(f.name || "this item").trim();
  const classes = CLASS_IDS.map(id => ({ id, label: ITEM_CLASSES[id].label, selected: id === itemClass }));
  const out = { title: E.preview, classes, name, lines: [], facts: [], know: null, note: null, sheet: String(f.description ?? "").trim(), stages: null, stage: null, showClasses: false };
  if (draft.kind === "material") {
    const st = PREVIEW_STAGES.includes(stage) ? stage : "crafted";
    const view = stageOf(registry, draft, st, itemClass);
    out.stage = st;
    out.stages = PREVIEW_STAGES.map(id => ({ id, label: STAGE_LABELS[id], selected: id === st }));
    out.showClasses = st === "crafted";
    out.name = view.title;
    out.facts = [view.meta, ...view.facts];
    out.know = view.know;
    out.note = view.note;
    out.lines = view.effects;
    // Players read the ability text on the item itself; a DC or odds in it is shown to them there (the Hub hides such wording, an item sheet cannot).
    if (st === "crafted" && view.effects.some(isDifficultyText)) out.warning = E.previewDifficulty;
    if (st === "crafted") out.fits = view.fits ? E.previewFits(view.fits.map(r => E.roleWords[r] ?? r)) : E.previewFitsNone;
  } else if (draft.kind === "note") {
    const recipe = registry.recipe.get(f.recipeId);
    out.facts.push(recipe ? `Teaches ${recipe.name} once studied.` : "Teaches nothing yet: pick a formula.");
    out.facts.push(E.previewBulk(f.bulk || "L"));
  }
  return out;
}

// The window's model -----------------------------------------------------------------------------------------------------
const opts = (values, selected) => values.map(([value, label]) => ({ value: String(value), label, selected: String(value) === String(selected) }));
/** A required choice starts on a disabled placeholder, never on the first real option (a silent default let a wrong formula through). */
const required = (placeholder, values, selected) => [{ value: "", label: placeholder, selected: String(selected ?? "") === "", disabled: true }, ...opts(values, selected)];

function effectsModel(draft, effectClass, problems) {
  const tier = Number(draft.fields.tier) || 1;
  const cls = effectClass === "general" || CLASS_IDS.includes(effectClass) ? effectClass : "general";
  const set = setOf(draft, cls);
  const allowed = type => type === "condition" ? cls !== "general" && rolesForCategory(cls).has("applyCondition") : cls === "general" || rolesForCategory(cls).has({ damage: "bonusDamage", resistance: "resistance", ability: "specialAbility" }[type]);
  const tabs = ["general", ...CLASS_IDS].map(id => {
    const s = id === "general" ? draft.blocks?.general : draft.blocks?.byClass?.[id];
    return { id, label: id === "general" ? E.general : ITEM_CLASSES[id].label, selected: id === cls, hasEffects: Boolean(s && (s.blocks?.length || s.power !== undefined)) };
  });
  const seenOfType = {};
  const blocks = set.blocks.map(b => {
    const base = { type: b.type, label: BLOCK_LABELS[b.type], index: (seenOfType[b.type] = (seenOfType[b.type] ?? -1) + 1) };
    if (b.type === "condition") {
      const valued = Boolean(EFFECT_CONDITIONS[b.condition]?.valued);
      return { ...base, condition: opts(Object.entries(EFFECT_CONDITIONS).map(([id, c]) => [id, c.label]), b.condition), valued, value: valued ? tierField(b.value, tier) : null, save: opts(Object.entries(EFFECT_SAVES), b.save) };
    }
    if (b.type === "damage") return { ...base, dice: tierField(b.dice, tier), damageType: opts(DAMAGE_TYPES.map(t => [t, t]), b.damageType), persistent: Boolean(b.persistent), versus: b.versus ?? "" };
    if (b.type === "resistance") return { ...base, damageType: opts(DAMAGE_TYPES.map(t => [t, t]), b.damageType), value: tierField(b.value, tier) };
    return { ...base, title: b.title, text: b.text, on: opts([["", E.abilityOnAny], ["hit", E.abilityOnHit], ["criticalHit", E.abilityOnCrit]], b.on ?? "") };
  });
  return {
    tabs, cls, help: cls === "general" ? E.generalHelp : E.classHelp(cls),
    power: cls === "general" || rolesForCategory(cls).has(powerRole(cls)) ? { label: powerRole(cls) === "spellPower" ? E.spellPower : E.power, value: set.power ?? "", options: opts([["", E.noPower], ...TIERS.map(t => [t, `T${t}`])], set.power ?? "") } : null,
    blocks,
    // A block the class cannot take (a condition on armor, a worn class or "Every class") is not offered at all.
    add: BLOCK_TYPES.filter(type => type !== "condition" || allowed(type)).map(type => ({ type, label: BLOCK_LABELS[type], disabled: MULTI_BLOCKS.includes(type) ? !freeCondition(set) : set.blocks.some(b => b.type === type) || !allowed(type) })),
    extra: set.extra && Object.keys(set.extra).length ? E.extraKept(Object.keys(set.extra).map(r => E.roleWords[r] ?? r)) : null,
    empty: !set.blocks.length && set.power === undefined ? E.nothingYet : null,
    problems: problems.effects[cls] ?? [], tier
  };
}
function tierField(field, tier) {
  return field?.byTier
    ? { mode: "table", cells: TIERS.map(t => ({ tier: t, label: E.tierCell(t), value: String(field.byTier[t] ?? ""), own: t === tier })) }
    : { mode: "flat", value: String(field?.all ?? "") };
}

/**
 * @param {object} input
 *   registry, overlay, records (the editor store's records), leftovers, selectedKey, draft, base, message, filters, collapsed, layout, display,
 *   effectClass (the Effects tab), previewClass (null = the default), previewStage (picked | studied | crafted), creating ({ kind, name, tier, recipeId, preset } or null), confirm ({ text, action } or null),
 *   origin ({ origin, editedFields, retired, hasItem } for the selected item)
 */
export function editorModel(input) {
  const { registry, overlay = {}, records = {}, leftovers = [], selectedKey = null, draft = null, base = null, message = "", filters = {}, collapsed = [], layout = "wide", display, effectClass = "general", previewClass = null, previewStage = "crafted", creating = null, confirm = null, origin = null } = input;
  const all = listItems(registry, overlay, records);
  const shown = filterItems(all, filters);
  const hidden = new Set(collapsed);
  const groups = ["material", "note", "recipe"].map(kind => {
    const total = all.filter(i => i.kind === kind).length;
    const items = shown.filter(i => i.kind === kind);
    return { kind, heading: E.groups[kind], total, count: E.groupCount(items.length, total), collapsed: hidden.has(kind), items: items.map(i => ({ ...i, selected: i.key === selectedKey })) };
  }).filter(g => g.total);
  const list = {
    searchLabel: E.searchLabel, search: filters.search ?? "", filtersLabel: E.filtersLabel,
    chips: [
      ...Object.keys(E.chipKinds).map(kind => ({ id: `kind:${kind}`, label: E.chipKinds[kind], selected: Boolean(filters.kinds?.includes(kind)) })),
      ...["has", "none"].map(t => ({ id: `track:${t}`, label: E.chipTrack[t], selected: filters.track === t })),
      { id: "show:retired", label: E.chipShow.retired, selected: Boolean(filters.retired) }
    ],
    groups, leftovers: { heading: E.groups.leftover, help: E.leftoverHelp, collapsed: hidden.has("leftover"), items: leftovers.map(l => ({ key: l.key, text: `${l.key} ${l.message}` })) },
    empty: shown.length === 0 ? E.noMatches : null
  };
  const base0 = { title: E.title, intro: E.intro, list, message, layout, display, confirm };
  if (creating) return { ...base0, detail: creatorModel(creating, registry), preview: null };
  if (!draft) return { ...base0, detail: { kind: "empty", text: E.pick }, preview: null };

  const def = registry[draft.kind].get(draft.id);
  const problems = draftProblems(draft, registry);
  const dirty = isDirty(draft, base);
  const f = draft.fields;
  const recipeChoices = [...registry.recipe.values()].map(r => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name));
  const detail = {
    kind: "item", key: itemKey(draft.kind, draft.id), itemKind: draft.kind, id: draft.id, name: f.name || def.name, label: KIND_LABEL[draft.kind],
    originLine: origin ? [E.origin[origin.origin === "world" ? "world" : origin.origin === "edited" ? "edited" : "pack"], origin.editedFields?.length ? E.editedFields(origin.editedFields) : null].filter(Boolean).join(" ") : "",
    retired: Boolean(origin?.retired),
    basics: draft.kind === "recipe" ? null : {
      heading: E.sections.basics, problems: problems.fields,
      name: f.name, tier: draft.kind === "material" ? opts(TIERS.map(t => [t, `Tier ${t}`]), f.tier) : null, value: draft.kind === "material" ? f.value : null,
      bulk: opts(BULKS.map(b => [b, b === "L" ? "L (light)" : b]), f.bulk), img: f.img, description: f.description, label: f.label,
      recipe: draft.kind === "note" ? opts([["", E.formulaPick], ...recipeChoices.map(r => [r.id, r.name])], f.recipeId) : null,
      preset: draft.kind === "note" ? opts(NOTE_PRESETS.map(p => [p, E.presets[p]]), f.preset) : null
    },
    discovery: draft.kind === "material" ? {
      heading: E.sections.discovery,
      tag: opts([["", E.noTag], ...[...(registry.tag?.values() ?? [])].map(t => [t.id, t.name])], f.tag),
      line: registry.tag?.get(f.tag) ? E.tagTheme(registry.tag.get(f.tag).name, registry.tag.get(f.tag).theme) : E.noTagLine
    } : null,
    track: {
      heading: E.sections.track, source: draft.rows.length ? E.trackFrom : E.trackNone, allowProperties: draft.kind === "material", recipeChoices,
      rows: draft.rows.map((r, index) => ({ index, steps: r.steps, type: r.type, recipeId: r.recipeId, problem: problems.rows.find(p => p.index === index)?.text ?? null })),
      problems: problems.rows.filter(p => p.index === null).map(p => p.text), canAdd: draft.rows.length < DISCOVERY.maxMilestones, max: DISCOVERY.maxMilestones
    },
    effects: draft.kind === "material" ? { heading: E.sections.effects, ...effectsModel(draft, effectClass, problems) } : null,
    actions: {
      canSave: dirty && !problems.any, canDiscard: dirty,
      canRevert: Boolean(origin?.editedFields?.length), canPush: draft.kind !== "recipe" && !dirty,
      canMakeItem: draft.kind !== "recipe" && !origin?.hasItem, canRetire: draft.kind !== "recipe", retired: Boolean(origin?.retired),
      canDelete: draft.kind !== "recipe" && origin?.origin === "world",
      state: dirty ? E.unsaved : "",
      // Why Save is off, in the action row itself (always on screen), so a disabled button never leaves the GM guessing.
      why: dirty ? whyList([...problems.fields, ...problems.rows.map(r => r.text), ...Object.values(problems.effects).flat()]) : []
    }
  };
  const cls = previewClass && CLASS_IDS.includes(previewClass) ? previewClass : defaultPreviewClass(draft.blocks);
  return { ...base0, detail, preview: draft.kind === "recipe" ? null : previewOf(registry, draft, cls, previewStage) };
}

const whyList = list => (list.length > 3 ? [...list.slice(0, 3), `…and ${list.length - 3} more.`] : list);

function creatorModel(creating, registry) {
  const isMaterial = creating.kind === "material";
  const recipeChoices = [...registry.recipe.values()].map(r => [r.id, r.name]).sort((a, b) => a[1].localeCompare(b[1]));
  const problems = [];
  if (!String(creating.name ?? "").trim()) problems.push("Give it a name first.");
  if (isMaterial && !/^[1-5]$/.test(String(creating.tier ?? ""))) problems.push("Choose a tier first.");
  if (!isMaterial && !registry.recipe.has(creating.recipeId)) problems.push("Pick a formula first.");
  if (!isMaterial && !NOTE_PRESETS.includes(creating.preset)) problems.push("Choose a kind of note first.");
  return {
    kind: "create", itemKind: creating.kind, heading: isMaterial ? E.creatingMaterial : E.creatingNote, name: creating.name ?? "",
    tier: isMaterial ? required(E.chooseTier, TIERS.map(t => [t, `Tier ${t}`]), creating.tier) : null,
    recipe: isMaterial ? null : required(E.chooseFormula, recipeChoices, creating.recipeId),
    preset: isMaterial ? null : required(E.chooseKind, NOTE_PRESETS.map(p => [p, E.presets[p]]), creating.preset),
    problems, canCreate: problems.length === 0
  };
}

// Markup -----------------------------------------------------------------------------------------------------------------
const esc = text => String(text ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const attrs = data => Object.entries(data).filter(([, v]) => v !== undefined).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("");
const button = ({ action, label, data = {}, disabled = false, pressed, expanded, extra = "" }) =>
  `<button type="button" class="pfp-btn${disabled ? " is-disabled" : ""}${extra}" data-action="${action}"${attrs(data)}${pressed === undefined ? "" : ` aria-pressed="${pressed}"`}${expanded === undefined ? "" : ` aria-expanded="${expanded}"`}${disabled ? ' aria-disabled="true"' : ""}>${esc(label)}</button>`;
const select = (label, options, data, id) => `<label>${esc(label)} <select data-field="${data.field}"${attrs(Object.fromEntries(Object.entries(data).filter(([k]) => k !== "field")))} aria-label="${esc(id ?? label)}">${options.map(o => `<option value="${esc(o.value)}"${o.selected ? " selected" : ""}${o.disabled ? " disabled" : ""}>${esc(o.label)}</option>`).join("")}</select></label>`;
const input = (label, value, data, { type = "text", min, step, wide = false } = {}) => `<label${wide ? ' class="pfp-wide"' : ""}>${esc(label)} <input type="${type}"${min !== undefined ? ` min="${min}"` : ""}${step ? ` step="${step}"` : ""} data-field="${data.field}"${attrs(Object.fromEntries(Object.entries(data).filter(([k]) => k !== "field")))} value="${esc(value)}" aria-label="${esc(label)}"></label>`;
const area = (label, value, data, rows = 2) => `<label class="pfp-wide">${esc(label)} <textarea rows="${rows}" data-field="${data.field}"${attrs(Object.fromEntries(Object.entries(data).filter(([k]) => k !== "field")))} aria-label="${esc(label)}">${esc(value)}</textarea></label>`;
const why = items => items.map(p => `<p class="pfp-why" role="alert">${esc(p)}</p>`).join("");

function renderTier(label, field, d) {
  const base = { cls: d.cls, type: d.type, name: d.name, index: d.index };
  if (field.mode === "table") {
    return `<fieldset class="pfp-tiers"><legend>${esc(label)}</legend><p class="pfp-note">${esc(E.tableNote)}</p><div class="pfp-row">${field.cells.map(c => input(c.label + (c.own ? " (this material)" : ""), c.value, { field: "cell", ...base, tier: c.tier })).join("")}</div>
      ${button({ action: "tier-mode", label: E.sameForAll, data: { ...base, mode: "flat" } })}</fieldset>`;
  }
  return `<div class="pfp-row">${input(label, field.value, { field: "block", ...base })}${button({ action: "tier-mode", label: E.perTier, data: { ...base, mode: "table" } })}</div>`;
}

function renderBlock(b, cls) {
  const common = { cls, type: b.type, ...(MULTI_BLOCKS.includes(b.type) ? { index: b.index } : {}) };
  let body;
  if (b.type === "condition") body = `<div class="pfp-row">${select(E.condition, b.condition, { field: "block", ...common, name: "condition" })}${select(E.conditionSave, b.save, { field: "block", ...common, name: "save" })}</div>${b.valued ? renderTier(E.conditionValue, b.value, { ...common, name: "value" }) : ""}<p class="pfp-note">${esc(E.conditionHelp)}</p>`;
  else if (b.type === "damage") body = `${renderTier(E.dice, b.dice, { ...common, name: "dice" })}<div class="pfp-row">${select(E.damageType, b.damageType, { field: "block", ...common, name: "damageType" })}
    <label class="pfp-check"><input type="checkbox" data-field="block" data-cls="${cls}" data-type="damage" data-name="persistent"${b.persistent ? " checked" : ""} aria-label="${esc(E.persistent)}"> ${esc(E.persistent)}</label></div>${area(E.versus, b.versus, { field: "block", ...common, name: "versus" })}`;
  else if (b.type === "resistance") body = `<div class="pfp-row">${select(E.damageType, b.damageType, { field: "block", ...common, name: "damageType" })}</div>${renderTier(E.amount, b.value, { ...common, name: "value" })}`;
  else body = `${area(E.abilityTitle, b.title, { field: "block", ...common, name: "title" })}<div class="pfp-row">${select(E.abilityOn, b.on, { field: "block", ...common, name: "on" })}</div>
    ${area(E.abilityText, b.text, { field: "block", ...common, name: "text" }, 3)}`;
  return `<li class="pfp-block"><h4>${esc(b.label)}</h4>${body}${button({ action: "remove-block", label: E.removeBlock, data: common })}</li>`;
}

function renderEffects(e) {
  const tabs = e.tabs.map(t => button({ action: "effect-class", label: `${t.label}${t.hasEffects ? " •" : ""}`, pressed: t.selected, data: { cls: t.id } })).join("");
  return `<section class="pfp-section" aria-label="${esc(e.heading)}"><h3>${esc(e.heading)}</h3>
    <div class="pfp-row" role="group" aria-label="${esc(E.classTabs)}">${tabs}</div><p class="pfp-note">${esc(e.help)}</p>
    ${e.power ? select(e.power.label, e.power.options, { field: "power", cls: e.cls }) : ""}
    ${e.blocks.length ? `<ul class="pfp-blocks">${e.blocks.map(b => renderBlock(b, e.cls)).join("")}</ul>` : ""}${e.empty ? `<p class="pfp-empty">${esc(e.empty)}</p>` : ""}${why(e.problems)}
    <div class="pfp-row" role="group" aria-label="${esc(E.addBlock)}">${e.add.map(a => button({ action: "add-block", label: `+ ${a.label}`, disabled: a.disabled, data: { type: a.type, cls: e.cls } })).join("")}</div>
    ${e.extra ? `<p class="pfp-note">${esc(e.extra)}</p>` : ""}</section>`;
}

function renderDetail(d, confirmHtml = "") {
  if (d.kind === "empty") return { body: `<p class="pfp-empty">${esc(d.text)}</p>`, actions: "" };
  if (d.kind === "create") {
    const body = `<h2>${esc(d.heading)}</h2>${input(E.fields.name, d.name, { field: "create", name: "name" })}
      ${d.tier ? select(E.fields.tier, d.tier, { field: "create", name: "tier" }) : ""}${d.recipe ? select(E.fields.recipe, d.recipe, { field: "create", name: "recipeId" }) : ""}${d.preset ? select(E.fields.preset, d.preset, { field: "create", name: "preset" }) : ""}${why(d.problems)}`;
    return { body, actions: `<div class="pfp-row pfp-editor-actions">${button({ action: "do-create", label: E.create, disabled: !d.canCreate })}${button({ action: "cancel-create", label: E.cancel })}</div>` };
  }
  const b = d.basics;
  const basics = b ? `<section class="pfp-section" aria-label="${esc(b.heading)}"><h3>${esc(b.heading)}</h3>
    <div class="pfp-row">${input(E.fields.name, b.name, { field: "basic", name: "name" })}${b.tier ? select(E.fields.tier, b.tier, { field: "basic", name: "tier" }) : ""}${b.value !== null ? input(E.fields.value, b.value, { field: "basic", name: "value" }, { type: "number", min: 0, step: "any" }) : ""}${select(E.fields.bulk, b.bulk, { field: "basic", name: "bulk" })}</div>
    ${b.recipe ? `<div class="pfp-row">${select(E.fields.recipe, b.recipe, { field: "basic", name: "recipeId" })}${select(E.fields.preset, b.preset, { field: "basic", name: "preset" })}</div>` : ""}
    <div class="pfp-row">${input(E.fields.img, b.img, { field: "basic", name: "img" })}${input(E.fields.label, b.label, { field: "basic", name: "label" })}</div>
    <label class="pfp-wide">${esc(E.fields.description)} <textarea rows="3" data-field="basic" data-name="description" aria-label="${esc(E.fields.description)}">${esc(b.description)}</textarea></label>${why(b.problems)}</section>` : "";
  const disc = d.discovery ? `<section class="pfp-section" aria-label="${esc(d.discovery.heading)}"><h3>${esc(d.discovery.heading)}</h3>${select(E.fields.tag, d.discovery.tag, { field: "basic", name: "tag" })}<p class="pfp-note">${esc(d.discovery.line)}</p></section>` : "";
  const t = d.track;
  const rows = t.rows.map(r => `<li class="pfp-milestone"><label>${esc(E.stepsLabel)} <input type="number" min="1" step="1" data-field="row-steps" data-index="${r.index}" value="${esc(r.steps)}" aria-label="${esc(E.stepsLabel)} ${r.index + 1}"></label>
      <label>${esc(E.grantsLabel)} <select data-field="row-grants" data-index="${r.index}" aria-label="${esc(E.grantsLabel)} ${r.index + 1}">${t.allowProperties ? `<option value="properties"${r.type === "properties" ? " selected" : ""}>${esc(E.properties)}</option>` : ""}<option value="formula"${r.type === "formula" ? " selected" : ""}>${esc(E.formula)}</option></select></label>
      ${r.type === "formula" ? `<label>${esc(E.formula)} <select data-field="row-recipe" data-index="${r.index}" aria-label="${esc(E.formula)} ${r.index + 1}"><option value="">${esc(E.formulaPick)}</option>${t.recipeChoices.map(c => `<option value="${esc(c.id)}"${c.id === r.recipeId ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>` : ""}
      ${button({ action: "remove-row", label: E.removeRow, data: { index: r.index } })}${r.problem ? `<span class="pfp-why">${esc(r.problem)}</span>` : ""}</li>`).join("");
  const track = `<section class="pfp-section" aria-label="${esc(t.heading)}"><h3>${esc(t.heading)}</h3><p class="pfp-note">${esc(t.source)}</p>${rows ? `<ol class="pfp-milestones">${rows}</ol>` : ""}${why(t.problems)}
    <div class="pfp-row">${button({ action: "add-row", label: E.addMilestone, disabled: !t.canAdd })}${button({ action: "add-default", label: E.addDefault })}</div></section>`;
  const body = `<h2>${esc(d.name)}</h2><p class="pfp-note">${esc(d.label)}${d.retired ? ` · ${esc(E.retiredTag)}` : ""}</p><p class="pfp-note">${esc(d.originLine)}</p>${basics}${disc}${track}${d.effects ? renderEffects(d.effects) : ""}`;
  const a = d.actions;
  const actions = `<div class="pfp-editor-actions-part" data-part="actions">${confirmHtml}${a.state ? `<p class="pfp-note">${esc(a.state)}</p>` : ""}${why(a.why)}<div class="pfp-row pfp-editor-actions">${button({ action: "save", label: E.save, disabled: !a.canSave })}${button({ action: "discard", label: E.discard, disabled: !a.canDiscard })}
    ${button({ action: "push-copies", label: E.pushCopies, disabled: !a.canPush })}${a.canMakeItem ? button({ action: "make-item", label: E.makeItem }) : ""}
    ${a.canRevert ? button({ action: "revert", label: E.revert }) : ""}${a.canRetire ? button({ action: "retire", label: a.retired ? E.unretire : E.retire }) : ""}${a.canDelete ? button({ action: "delete", label: E.delete }) : ""}</div></div>`;
  return { body, actions };
}

function renderPreview(p) {
  if (!p) return "";
  const stages = p.stages ? `<div class="pfp-row" role="group" aria-label="${esc(E.previewStage)}">${p.stages.map(st => button({ action: "preview-stage", label: st.label, pressed: st.selected, data: { stage: st.id } })).join("")}</div>` : "";
  const picker = p.showClasses || !p.stages ? `<label>${esc(E.previewClass)} <select data-field="preview-class" aria-label="${esc(E.previewClass)}">${p.classes.map(c => `<option value="${esc(c.id)}"${c.selected ? " selected" : ""}>${esc(c.label)}</option>`).join("")}</select></label>` : "";
  const know = p.know ? `<h4>${esc(S.whatYouKnow)}</h4>${p.know.items.length ? `<ul class="pfp-lines">${p.know.items.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}${p.know.empty ? `<p class="pfp-empty">${esc(p.know.empty)}</p>` : ""}` : "";
  const effects = p.stage === null || p.stage === "crafted"
    ? (p.lines.length ? `<ul class="pfp-lines">${p.lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : `<p class="pfp-empty">${esc(E.previewNothing)}</p>`)
    : `<p class="pfp-empty">${esc(E.previewNoEffectsYet)}</p>`;
  return `<h2>${esc(p.title)}</h2>${stages}${picker}<h3>${esc(p.name)}</h3>${p.facts.map(f => `<p class="pfp-note">${esc(f)}</p>`).join("")}${know}${p.note ? `<p class="pfp-note">${esc(p.note)}</p>` : ""}
    ${p.stage === "studied" && p.note === NO_STUDY ? "" : effects}
    ${p.warning ? `<p class="pfp-why" role="status">${esc(p.warning)}</p>` : ""}${p.fits ? `<p class="pfp-note">${esc(p.fits)}</p>` : ""}
    ${p.sheet ? `<h4>${esc(E.previewSheet)}</h4><p class="pfp-note">${esc(p.sheet)}</p>` : ""}`;
}

export function renderEditor(model) {
  const l = model.list;
  const chips = l.chips.map(c => button({ action: "toggle-chip", label: c.label, pressed: c.selected, data: { chip: c.id } })).join("");
  const item = i => `<li>${button({ action: "pick-item", pressed: i.selected, data: { key: i.key }, label: `${i.name}${i.sub ? ` (${i.sub})` : ""}${i.hasTrack ? ` · ${E.hasTrack}` : ""}${i.origin === "world" ? ` · ${E.madeHere}` : i.origin === "edited" ? ` · ${E.editedHere}` : ""}${i.retired ? ` · ${E.retiredTag}` : ""}` })}</li>`;
  const groups = l.groups.map(g => `<section class="pfp-editor-group" aria-label="${esc(g.heading)}"><h3>${button({ action: "toggle-group", label: `${g.collapsed ? "▸" : "▾"} ${g.heading} (${g.count})`, data: { kind: g.kind }, expanded: !g.collapsed })}</h3>
    ${g.collapsed ? "" : `<ul class="pfp-cards">${g.items.map(item).join("")}</ul>`}</section>`).join("");
  const lo = l.leftovers;
  const leftovers = lo.items.length ? `<section class="pfp-editor-group" aria-label="${esc(lo.heading)}"><h3>${button({ action: "toggle-group", label: `${lo.collapsed ? "▸" : "▾"} ${lo.heading} (${lo.items.length})`, data: { kind: "leftover" }, expanded: !lo.collapsed })}</h3>
    ${lo.collapsed ? "" : `<p class="pfp-note">${esc(lo.help)}</p><ul class="pfp-cards">${lo.items.map(i => `<li class="pfp-leftover"><span>${esc(i.text)}</span>${button({ action: "clear-leftover", label: E.removeLeftover, data: { key: i.key } })}</li>`).join("")}</ul>`}</section>` : "";
  const confirm = model.confirm ? `<div class="pfp-editor-confirm" role="alertdialog" aria-label="${esc(model.confirm.text)}"><p>${esc(model.confirm.text)}</p><div class="pfp-row">${button({ action: "confirm-yes", label: E.confirmYes })}${button({ action: "confirm-no", label: E.confirmNo })}</div></div>` : "";
  const detail = renderDetail(model.detail, confirm);
  const root = Object.entries(rootAttributes({ display: model.display ?? normalizeDisplay({}), layout: model.layout })).map(([k, v]) => `${k}="${esc(v)}"`).join(" ");
  return `<div class="pfp-hub pfp-editor" tabindex="-1" ${root}><header class="pfp-editor-head"><p class="pfp-note">${esc(model.intro)}</p>${model.message ? `<p class="pfp-result" role="status">${esc(model.message)}</p>` : ""}
    <div class="pfp-row">${button({ action: "new-material", label: E.newMaterial })}${button({ action: "new-note", label: E.newNote })}${button({ action: "export", label: E.exportAll })}${button({ action: "import", label: E.importAll })}</div></header>
    <div class="pfp-body pfp-editor-body pfp-editor-three"><div class="pfp-pane pfp-list pfp-editor-list" data-scroll-key="list">
      <label class="pfp-search">${esc(l.searchLabel)} <input type="search" data-field="search" value="${esc(l.search)}" placeholder="${esc(E.searchHint)}" aria-label="${esc(l.searchLabel)}"></label>
      <div class="pfp-row" role="group" aria-label="${esc(l.filtersLabel)}">${chips}</div>
      <div class="pfp-editor-scroll" data-scroll-key="items">${groups}${leftovers}${l.empty ? `<p class="pfp-empty">${esc(l.empty)}</p>` : ""}</div></div>
      <div class="pfp-pane pfp-detail pfp-editor-detail"><div class="pfp-editor-scroll" data-scroll-key="detail">${detail.body}</div>${detail.actions}</div>
      ${model.preview ? `<div class="pfp-pane pfp-editor-preview" data-part="preview"><div class="pfp-editor-scroll" data-scroll-key="preview">${renderPreview(model.preview)}</div></div>` : ""}</div></div>`;
}

export { valueAt };
