/**
 * The Discovery tracks window's model and markup (Stage 11c). GM only, so its words live here, not in the Hub's strings. Pure: no Foundry globals.
 *
 * The GM picks a material, a note or a higher formula version, edits its track as rows (steps + what it grants) and saves it. Saving writes the
 * world-setting overlay (api.discovery.tracks.set), which beats the definition's own track.
 */
import { check } from "../data/schema.js";
import { TRACK_SCHEMA } from "../data/schemas.js";
import { DISCOVERY } from "../config.js";
import { defaultTrack, itemKey, trackOf } from "./track.js";
import { normalizeDisplay } from "../hub/display.js";
import { rootAttributes } from "../hub/render.js";

export const E = {
  title: "Discovery tracks",
  intro: "A track is a list of milestones for one item. Players only ever see a plain stage (Just started, Getting somewhere, Nearly there), never these numbers.",
  pick: "Pick an item on the left.",
  groups: { material: "Materials", note: "Notes", recipe: "Higher formula versions" },
  noTrack: "No track yet. Without one, this item is usable and known on pickup and never offers a lead.",
  fromDefinition: "This track comes from the definition. Saving here overrides it; Use the definition's track puts it back.",
  fromOverlay: "This track was set in this window and overrides the definition.",
  addMilestone: "Add a milestone",
  addDefault: "Add the default track",
  removeRow: "Remove",
  save: "Save",
  revert: "Discard changes",
  useDefinition: "Use the definition's track",
  stepsLabel: "Steps",
  grantsLabel: "Grants",
  properties: "Properties (what it is good for, and its tag)",
  formula: "A formula",
  formulaPick: "Pick a formula",
  tagLine: tag => `Tag: ${tag}`,
  valueLine: gp => `Gold value: ${gp} gp each`,
  saved: name => `Saved the track for ${name}.`,
  cleared: name => `${name} now uses the definition's track.`,
  needFormula: "pick a formula that exists",
  noUnsaved: "Nothing to save.",
  unsaved: "You have unsaved changes.",
  searchLabel: "Search items",
  searchHint: "Type part of a name",
  filtersLabel: "Show",
  chipKinds: { material: "Materials", note: "Notes", recipe: "Higher versions" },
  chipTrack: { has: "Has a track", none: "No track" },
  groupCount: (shown, total) => (shown === total ? `${total}` : `${shown} of ${total}`),
  noMatches: "Nothing matches. Clear the search or a filter.",
  collapse: "Hide this group",
  expand: "Show this group"
};

const KIND_LABEL = { material: "Material", note: "Note", recipe: "Formula version" };

/** The items that can carry a track: [{ key, kind, id, name, sub }]. */
export function listItems(registry, overlay = {}) {
  const items = [];
  for (const m of registry.material.values()) items.push({ key: itemKey("material", m.id), kind: "material", id: m.id, name: m.name, sub: m.tag ? E.tagLine(registry.tag?.get(m.tag)?.name ?? m.tag) : "" });
  for (const n of registry.note.values()) items.push({ key: itemKey("note", n.id), kind: "note", id: n.id, name: n.name, sub: registry.recipe.get(n.recipeId)?.name ?? "" });
  for (const r of registry.recipe.values()) if ((r.version ?? 1) >= 2) items.push({ key: itemKey("recipe", r.id), kind: "recipe", id: r.id, name: r.name, sub: `Version ${r.version}` });
  return items.map(i => ({ ...i, hasTrack: Boolean(trackOf(registry[i.kind].get(i.id), overlay, i.key)), edited: Boolean(overlay[i.key]) }));
}

/** A draft is an editable copy of a track: rows of { steps (text, as typed), type, recipeId }. */
export const draftOf = track => (track ? track.milestones.map(m => ({ steps: String(m.steps), type: m.grants.type, recipeId: m.grants.recipeId ?? "" })) : []);

export function trackOfDraft(draft) {
  return { milestones: draft.map(r => ({ steps: Number(r.steps), grants: r.type === "formula" ? { type: "formula", ...(r.recipeId ? { recipeId: r.recipeId } : {}) } : { type: "properties" } })) };
}

/** Edits, each returning a new draft. */
export const edit = {
  setSteps: (draft, index, value) => draft.map((r, i) => (i === index ? { ...r, steps: String(value) } : r)),
  setGrants: (draft, index, type, recipeId = "") => draft.map((r, i) => (i === index ? { ...r, type, recipeId: type === "formula" ? recipeId : "" } : r)),
  setRecipe: (draft, index, recipeId) => draft.map((r, i) => (i === index ? { ...r, recipeId } : r)),
  remove: (draft, index) => draft.filter((_, i) => i !== index),
  add: (draft, kind) => {
    const last = draft.at(-1);
    const next = last ? Number(last.steps) + 4 : 4;
    const type = kind === "material" && !draft.some(r => r.type === "properties") ? "properties" : "formula";
    return [...draft, { steps: String(Number.isFinite(next) ? next : 4), type, recipeId: "" }];
  },
  addDefault: (kind, recipeId) => draftOf(defaultTrack(recipeId, kind))
};

/** What is wrong with a draft, as plain sentences: [{ index|null, text }]. Empty means it can be saved. */
export function problemsOf(draft, kind, itemId, registry) {
  const problems = [];
  draft.forEach((r, index) => {
    if (!/^\d+$/.test(String(r.steps).trim()) || Number(r.steps) < 1) problems.push({ index, text: "Steps must be a whole number of at least 1." });
    if (r.type === "formula") {
      const recipeId = r.recipeId || (kind === "note" ? registry.note.get(itemId)?.recipeId : kind === "recipe" ? itemId : "");
      if (!recipeId || !registry.recipe.has(recipeId)) problems.push({ index, text: E.needFormula[0].toUpperCase() + E.needFormula.slice(1) + "." });
    }
    if (r.type === "properties" && kind !== "material") problems.push({ index, text: "Only a material has a properties milestone." });
  });
  if (!problems.length && draft.length) for (const p of check(TRACK_SCHEMA, trackOfDraft(draft))) problems.push({ index: null, text: `${p.field.replace(/^milestones/, "Milestone ").replace(/\[(\d+)\]/g, (_, n) => `${Number(n) + 1}`)} ${p.message}.`.replace(/\s+/g, " ") });
  return problems;
}

/** Apply the search box and the filter chips. `filters`: { search, kinds: [kind...] (none = all), track: "all" | "has" | "none" }. */
export function filterItems(items, filters = {}) {
  const text = String(filters.search ?? "").trim().toLowerCase();
  const kinds = filters.kinds?.length ? new Set(filters.kinds) : null;
  return items.filter(i => (!kinds || kinds.has(i.kind))
    && (filters.track === "has" ? i.hasTrack : filters.track === "none" ? !i.hasTrack : true)
    && (!text || `${i.name} ${i.sub}`.toLowerCase().includes(text)));
}

/**
 * The window's model.
 * @param {{ registry, overlay, selectedKey, draft, dirty, message, filters, collapsed, layout, display }} input
 */
export function editorModel({ registry, overlay = {}, selectedKey = null, draft = null, dirty = false, message = "", filters = {}, collapsed = [], layout = "wide", display }) {
  const all = listItems(registry, overlay);
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
      ...["has", "none"].map(t => ({ id: `track:${t}`, label: E.chipTrack[t], selected: filters.track === t }))
    ],
    groups, empty: shown.length === 0 ? E.noMatches : null
  };
  const base = { title: E.title, intro: E.intro, list, message, layout, display };
  const item = all.find(i => i.key === selectedKey) ?? null;
  if (!item) return { ...base, detail: { kind: "empty", text: E.pick } };
  const def = registry[item.kind].get(item.id);
  const rows = draft ?? draftOf(trackOf(def, overlay, item.key));
  const problems = problemsOf(rows, item.kind, item.id, registry);
  const recipeChoices = [...registry.recipe.values()].map(r => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name));
  return {
    ...base,
    detail: {
      kind: "item", key: item.key, itemKind: item.kind, name: item.name, label: KIND_LABEL[item.kind],
      facts: [def.tag ? E.tagLine(registry.tag?.get(def.tag)?.name ?? def.tag) : null, item.kind === "material" && Number.isFinite(def.value) ? E.valueLine(def.value) : null].filter(Boolean),
      source: overlay[item.key] ? E.fromOverlay : def.research ? E.fromDefinition : E.noTrack,
      rows: rows.map((r, index) => ({ index, steps: r.steps, type: r.type, recipeId: r.recipeId, problem: problems.find(p => p.index === index)?.text ?? null })),
      recipeChoices, allowProperties: item.kind === "material",
      problems: problems.filter(p => p.index === null).map(p => p.text),
      canSave: dirty && problems.length === 0 && rows.length > 0,
      canRevert: dirty, canUseDefinition: Boolean(overlay[item.key]),
      state: dirty ? E.unsaved : "", max: DISCOVERY.maxMilestones, canAdd: rows.length < DISCOVERY.maxMilestones
    }
  };
}

// Markup --------------------------------------------------------------------------------------------------------------
const esc = text => String(text ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const button = ({ action, label, data = {}, disabled = false, pressed, expanded }) =>
  `<button type="button" class="pfp-btn${disabled ? " is-disabled" : ""}" data-action="${action}"${Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("")}${pressed === undefined ? "" : ` aria-pressed="${pressed}"`}${expanded === undefined ? "" : ` aria-expanded="${expanded}"`}${disabled ? ' aria-disabled="true"' : ""}>${esc(label)}</button>`;

export function renderEditor(model) {
  const l = model.list;
  const chips = l.chips.map(c => button({ action: "toggle-chip", label: c.label, pressed: c.selected, data: { chip: c.id } })).join("");
  const groups = l.groups.map(g => `<section class="pfp-editor-group" aria-label="${esc(g.heading)}"><h3>${button({ action: "toggle-group", label: `${g.collapsed ? "▸" : "▾"} ${g.heading} (${g.count})`, data: { kind: g.kind }, pressed: undefined, expanded: !g.collapsed })}</h3>
    ${g.collapsed ? "" : `<ul class="pfp-cards">${g.items.map(i => `<li>${button({
      action: "pick-item", pressed: i.selected, data: { key: i.key },
      label: `${i.name}${i.sub ? ` (${i.sub})` : ""}${i.hasTrack ? " · has a track" : ""}${i.edited ? " · edited here" : ""}`
    })}</li>`).join("")}</ul>`}</section>`).join("");
  const d = model.detail;
  let detail, actions = "";
  if (d.kind === "empty") detail = `<p class="pfp-empty">${esc(d.text)}</p>`;
  else {
    const rows = d.rows.map(r => `<li class="pfp-milestone"><label>${esc(E.stepsLabel)} <input type="number" min="1" step="1" data-field="steps" data-index="${r.index}" value="${esc(r.steps)}" aria-label="${esc(E.stepsLabel)} ${r.index + 1}"></label>
      <label>${esc(E.grantsLabel)} <select data-field="grants" data-index="${r.index}" aria-label="${esc(E.grantsLabel)} ${r.index + 1}">${d.allowProperties ? `<option value="properties"${r.type === "properties" ? " selected" : ""}>${esc(E.properties)}</option>` : ""}<option value="formula"${r.type === "formula" ? " selected" : ""}>${esc(E.formula)}</option></select></label>
      ${r.type === "formula" ? `<label>${esc(E.formula)} <select data-field="recipe" data-index="${r.index}" aria-label="${esc(E.formula)} ${r.index + 1}"><option value="">${esc(E.formulaPick)}</option>${d.recipeChoices.map(c => `<option value="${esc(c.id)}"${c.id === r.recipeId ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>` : ""}
      ${button({ action: "remove-row", label: E.removeRow, data: { index: r.index } })}${r.problem ? `<span class="pfp-why">${esc(r.problem)}</span>` : ""}</li>`).join("");
    detail = `<h2>${esc(d.name)}</h2><p class="pfp-note">${esc(d.label)}</p>${d.facts.map(f => `<p class="pfp-note">${esc(f)}</p>`).join("")}<p class="pfp-note">${esc(d.source)}</p>
      ${rows ? `<ol class="pfp-milestones">${rows}</ol>` : ""}${d.problems.map(p => `<p class="pfp-why" role="alert">${esc(p)}</p>`).join("")}
      <div class="pfp-row">${button({ action: "add-row", label: E.addMilestone, disabled: !d.canAdd })}${button({ action: "add-default", label: E.addDefault })}</div>
      ${d.state ? `<p class="pfp-note">${esc(d.state)}</p>` : ""}`;
    // Save, Discard and Use the definition's track sit OUTSIDE the scrolling part: they are always on screen, however long the list or the rows are.
    actions = `<div class="pfp-row pfp-editor-actions">${button({ action: "save-track", label: E.save, disabled: !d.canSave })}${button({ action: "revert-track", label: E.revert, disabled: !d.canRevert })}${button({ action: "use-definition", label: E.useDefinition, disabled: !d.canUseDefinition })}</div>`;
  }
  const attrs = Object.entries(rootAttributes({ display: model.display ?? normalizeDisplay({}), layout: model.layout })).map(([k, v]) => `${k}="${esc(v)}"`).join(" ");
  return `<div class="pfp-hub pfp-editor" tabindex="-1" ${attrs}><header class="pfp-editor-head"><p class="pfp-note">${esc(model.intro)}</p>${model.message ? `<p class="pfp-result" role="status">${esc(model.message)}</p>` : ""}</header>
    <div class="pfp-body pfp-editor-body"><div class="pfp-pane pfp-list pfp-editor-list" data-scroll-key="list">
      <label class="pfp-search">${esc(l.searchLabel)} <input type="search" data-field="search" value="${esc(l.search)}" placeholder="${esc(E.searchHint)}" aria-label="${esc(l.searchLabel)}"></label>
      <div class="pfp-row" role="group" aria-label="${esc(l.filtersLabel)}">${chips}</div>
      <div class="pfp-editor-scroll" data-scroll-key="items">${groups}${l.empty ? `<p class="pfp-empty">${esc(l.empty)}</p>` : ""}</div></div>
      <div class="pfp-pane pfp-detail pfp-editor-detail"><div class="pfp-editor-scroll" data-scroll-key="detail">${detail}</div>${actions}</div></div></div>`;
}
