/**
 * The tag window's model and markup (Slice 1, GM only). Pure; no Foundry globals. The window class (app.js) keeps the little UI state and calls these.
 * Tabs: Items (tag any item), Recipe slots (what each slot needs), Tags (create, theme, priority).
 */
import { TIER_RANGES } from "../config.js";
import { effectiveTags, effectiveTier, itemName } from "./ledger.js";
import { rootAttributes } from "../hub/render.js";
import { BLOCK_LABELS, BLOCK_TYPES } from "../editor/blocks.js";
import { DAMAGE_TYPES } from "../adapter/pf2e.js";
import { EFFECT_CONDITIONS, EFFECT_SAVES, TAGS } from "../config.js";
import { CLASSES, fxPreview, fxProblems, fxSet, valueAt } from "./fx.js";
import { CAP_ROLES } from "./stack.js";
import { normalizeDisplay } from "../hub/display.js";

export const T = {
  title: "Item tags",
  tabs: { items: "Tagged items", slots: "Recipe slots", tags: "Tags" },
  intro: "Tag any item with several tags and a tier. Only you see this: players are only ever told that an item fits a slot.",
  materialSource: "A material", itemSource: "Any other item (by UUID)",
  needTier: "A tier is required for an item that is not a material: tag effects will scale by it.",
  saved: name => `Saved ${name}.`, removed: name => `${name} is no longer tagged.`
};

export const esc = text => String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const opt = (value, label, selected) => `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;
const tierOptions = selected => [opt("", "(its own)", selected === "" || selected === undefined || selected === null), ...Array.from({ length: TIER_RANGES.material.max }, (_, i) => opt(i + 1, `Tier ${i + 1}`, Number(selected) === i + 1))].join("");

/** The sorted tag list of a registry: [{ id, name, theme, priority }]. */
export const tagList = registry => [...(registry.tag?.values() ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map(t => ({ id: t.id, name: t.name, theme: t.theme, priority: t.priority ?? 0 }));

/** @param {object} ui the window's state; registry/ledger from the GM client */
export function taggerModel(ui, registry, ledger, caps) {
  const tags = tagList(registry);
  const nameOfTag = id => registry.tag?.get(id)?.name ?? id;
  const refs = [...new Set([...Object.keys(ledger.items), ...[...registry.material.values()].filter(m => m.tag).map(m => m.id)])];
  const items = refs.map(ref => ({ ref, name: itemName(ref, registry, ledger), tags: effectiveTags(ref, registry, ledger).map(nameOfTag), tier: effectiveTier(ref, registry, ledger), material: registry.material.has(ref), inLedger: Boolean(ledger.items[ref]) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const recipes = [...registry.recipe.values()].sort((a, b) => a.name.localeCompare(b.name));
  const recipe = recipes.find(r => r.id === ui.recipeId) ?? null;
  return { ui, caps, tags, items, recipes, recipe, materials: [...registry.material.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

function itemsTab(m) {
  const d = m.ui.draft;
  const rows = m.items.map(i => `<li class="pfp-row"><span><strong>${esc(i.name)}</strong> ${i.tags.map(t => `<span class="pfp-tagchip">${esc(t)}</span>`).join(" ")} <span class="pfp-badge">Tier ${esc(i.tier ?? "?")}</span>${i.material ? "" : ' <span class="pfp-badge">item</span>'}</span>
    <span class="pfp-row-buttons"><button type="button" data-action="edit-entry" data-ref="${esc(i.ref)}">Edit</button>${i.inLedger ? `<button type="button" data-action="remove-entry" data-ref="${esc(i.ref)}">Untag</button>` : ""}</span></li>`).join("");
  const form = `<fieldset data-part="entry-form"><legend>${d.editing ? "Edit tags" : "Tag an item"}</legend>
    <label>Source <select data-field="source" ${d.editing ? "disabled" : ""}>${opt("material", T.materialSource, d.source === "material")}${opt("item", T.itemSource, d.source === "item")}</select></label>
    ${d.source === "material"
      ? `<label>Material <select data-field="material" ${d.editing ? "disabled" : ""}>${opt("", "Pick one…", !d.ref)}${m.materials.map(x => opt(x.id, x.name, d.ref === x.id)).join("")}</select></label>`
      : `<label>Item UUID <input type="text" data-field="uuid" value="${esc(d.uuid)}" ${d.editing ? "disabled" : ""} placeholder="Item.… or Compendium.…"></label>
         ${d.editing ? "" : '<button type="button" data-action="lookup">Look it up</button>'} <label>Name <input type="text" data-field="name" value="${esc(d.name)}"></label>`}
    <div data-part="tag-pick" role="group" aria-label="Tags">${m.tags.length ? m.tags.map(t => `<label class="pfp-check"><input type="checkbox" data-field="tag" data-tag="${esc(t.id)}"${d.tags.includes(t.id) ? " checked" : ""}> ${esc(t.name)}</label>`).join(" ") : "<em>No tags yet: make one on the Tags tab.</em>"}</div>
    <label>Tier <select data-field="tier">${tierOptions(d.tier)}</select></label>
    ${d.source === "item" ? `<p class="pfp-hint">${esc(T.needTier)}</p>` : ""}
    <button type="button" data-action="save-entry">Save tags</button> ${d.editing ? '<button type="button" data-action="cancel-entry">Cancel</button>' : ""}
  </fieldset>`;
  return `<ul class="pfp-list" data-part="entries">${rows || "<li><em>Nothing tagged yet.</em></li>"}</ul>${form}`;
}

function slotsTab(m) {
  const picker = `<label>Recipe <select data-field="recipe">${opt("", "Pick a recipe…", !m.recipe)}${m.recipes.map(r => opt(r.id, r.name, m.recipe?.id === r.id)).join("")}</select></label>`;
  if (!m.recipe) return picker;
  const hint = '<p class="pfp-hint" id="kind-hint">A kind is a shared key for what sort of part a slot is (blade, decoration...). A tag can do different things in different kinds. Left empty, the kind is the slot\'s own name.</p>';
  const rows = m.recipe.slots.map(slot => {
    const draft = m.ui.slotDrafts?.[slot.name] ?? { all: slot.needs?.all ?? [], optional: Boolean(slot.needs?.optional) };
    return `<fieldset data-part="slot" data-slot="${esc(slot.name)}"><legend>${esc(slot.name)} <span class="pfp-badge">tier ${esc(slot.tierFloor)}+</span> <span class="pfp-badge">${slot.needs ? "by tag" : "any material"}</span></legend>
      <div role="group" aria-label="Tags the ${esc(slot.name)} slot needs">${m.tags.map(t => `<label class="pfp-check"><input type="checkbox" data-field="slot-tag" data-slot="${esc(slot.name)}" data-tag="${esc(t.id)}"${draft.all.includes(t.id) ? " checked" : ""}> ${esc(t.name)}</label>`).join(" ") || "<em>No tags yet.</em>"}</div>
      <label>Kind <input type="text" data-field="slot-kind" data-slot="${esc(slot.name)}" value="${esc(m.ui.slotKinds?.[slot.name] ?? slot.kind ?? "")}" placeholder="${esc(slot.name)}" aria-describedby="kind-hint"></label>
      <label class="pfp-check"><input type="checkbox" data-field="slot-optional" data-slot="${esc(slot.name)}"${draft.optional ? " checked" : ""}> May stay empty</label>
      <button type="button" data-action="save-slot" data-slot="${esc(slot.name)}">Save this slot</button>${slot.needs ? `<button type="button" data-action="clear-slot" data-slot="${esc(slot.name)}">Back to the tier rule</button>` : ""}</fieldset>`;
  }).join("");
  return picker + hint + rows;
}

function tagsTab(m) {
  const rows = m.tags.map(t => `<li class="pfp-row"><span><strong>${esc(t.name)}</strong> <em>${esc(t.theme)}</em></span>
    <label>Priority <input type="number" data-field="priority" data-tag="${esc(t.id)}" value="${esc(m.ui.priorities?.[t.id] ?? t.priority)}" min="-1000" max="1000" step="1"></label>
    <button type="button" data-action="save-priority" data-tag="${esc(t.id)}">Save</button>
    <button type="button" data-action="edit-effects" data-tag="${esc(t.id)}">${m.ui.fx?.tagId === t.id ? "Editing effects" : "Effects"}</button></li>`).join("");
  const nt = m.ui.newTag ?? { name: "", theme: "" };
  return `<ul class="pfp-list" data-part="tags">${rows || "<li><em>No tags yet.</em></li>"}</ul>
    <fieldset data-part="new-tag"><legend>New tag</legend><label>Name <input type="text" data-field="new-tag-name" value="${esc(nt.name)}"></label>
    <label>What it stands for <input type="text" data-field="new-tag-theme" value="${esc(nt.theme)}" placeholder="(defaults to the name)"></label>
    <button type="button" data-action="create-tag">Create tag</button></fieldset>
    ${m.ui.fx ? fxPanel(m) : ""}${capsPanel(m)}
    <p class="pfp-hint">Priority breaks ties between equal-tier tags when tags are passed up in a nested craft (highest tier, then priority, then alphabetical). It only does that in a later slice; for now it is stored.</p>`;
}

const sel = (name, value, options, data = "") => `<select data-field="${name}" ${data}>${options.map(([v, l]) => opt(v, l, String(value ?? "") === String(v))).join("")}</select>`;
const FIELD_NAMES = { dice: "Dice", value: "Amount" };

/** A tier-dependent field: one value for every tier, or a T1 to T5 table. */
function tierField(b, name, cls, i, kind) {
  const f = b[name];
  const data = `data-cls="${esc(cls)}" data-index="${i}" data-name="${name}"`;
  const mode = f?.byTier ? "table" : "all";
  const input = (tier, v) => `<input type="${kind === "dice" ? "text" : "number"}" data-field="fx-tiervalue" ${data} data-tier="${tier}" value="${esc(v ?? "")}" ${kind === "dice" ? 'size="6"' : 'min="1" step="1"'} aria-label="${esc(FIELD_NAMES[name])} ${tier === "all" ? "for every tier" : `at tier ${tier}`}">`;
  return `<span class="pfp-tierfield">${sel("fx-tiermode", mode, [["all", "Same for every tier"], ["table", "By tier"]], data)}
    ${mode === "all" ? input("all", f?.all) : [1, 2, 3, 4, 5].map(t => `<label>T${t} ${input(t, f?.byTier?.[t])}</label>`).join(" ")}</span>`;
}

function blockHtml(b, cls, i) {
  const data = `data-cls="${esc(cls)}" data-index="${i}"`;
  const text = (name, label, v) => `<label>${label} <input type="text" data-field="fx-field" ${data} data-name="${name}" value="${esc(v ?? "")}"></label>`;
  const dt = `<label>Damage type ${sel("fx-field", b.damageType, DAMAGE_TYPES.map(d => [d, d]), `${data} data-name="damageType"`)}</label>`;
  const bt = `<label>PF2e bonus type ${sel("fx-field", b.bonusType ?? "untyped", TAGS.bonusTypes.map(x => [x, x]), `${data} data-name="bonusType"`)}</label>`;
  let body = "";
  if (b.type === "damage") body = `<label>${FIELD_NAMES.dice} ${tierField(b, "dice", cls, i, "dice")}</label>${dt}<label class="pfp-check"><input type="checkbox" data-field="fx-field" ${data} data-name="persistent"${b.persistent ? " checked" : ""}> Persistent</label>${text("versus", "Only versus (trait)", b.versus)}${bt}`;
  if (b.type === "resistance") body = `${dt}<label>${FIELD_NAMES.value} ${tierField(b, "value", cls, i, "number")}</label>${bt}`;
  if (b.type === "ability") body = `${text("title", "Title", b.title)}${text("text", "Text", b.text)}<label>When ${sel("fx-field", b.on ?? "hit", [["hit", "on a hit"], ["criticalHit", "on a critical hit"]], `${data} data-name="on"`)}</label>`;
  if (b.type === "condition") body = `<label>Condition ${sel("fx-field", b.condition, Object.entries(EFFECT_CONDITIONS).map(([k, v]) => [k, v.label]), `${data} data-name="condition"`)}</label>${EFFECT_CONDITIONS[b.condition]?.valued ? `<label>Value ${tierField(b, "value", cls, i, "number")}</label>` : ""}<label>Save ${sel("fx-field", b.save, Object.entries(EFFECT_SAVES), `${data} data-name="save"`)}</label>`;
  return `<fieldset data-part="fx-block" ${data}><legend>${esc(BLOCK_LABELS[b.type])}</legend>${body}<button type="button" data-action="fx-remove" ${data}>Remove</button></fieldset>`;
}

function fxPanel(m) {
  const fx = m.ui.fx, tag = m.tags.find(t => t.id === fx.tagId);
  if (!tag) return "";
  const set = fxSet(fx.draft, fx.cls, fx.kind ?? "");
  const problems = fxProblems(fx.draft);
  const classes = CLASSES.map(c => `<button type="button" data-action="fx-class" data-cls="${c}" aria-pressed="${fx.cls === c}">${c === "general" ? "Any item" : c}</button>`).join(" ");
  const adds = BLOCK_TYPES.filter(t => fx.cls !== "general" || t !== "condition").map(t => `<button type="button" data-action="fx-add" data-cls="${esc(fx.cls)}" data-type="${t}">Add: ${esc(BLOCK_LABELS[t])}</button>`).join(" ");
  const prev = fxPreview(tag.name, fx.draft, fx.cls, fx.kind ?? "").map(p => `<li><strong>Tier ${p.tier}</strong> ${p.lines.length ? p.lines.map(esc).join("; ") : "<em>nothing</em>"}</li>`).join("");
  return `<fieldset data-part="fx"><legend>What ${esc(tag.name)} does</legend>
    <p class="pfp-hint">Applies only in a recipe slot that matches by tag, at the tier of the ITEM that carries the tag, and only for the roles that slot drives. Amounts from different ingredients are added up, then the caps below clamp them. Players never see any of this.</p>
    <label>Only in slots of kind <input type="text" data-field="fx-kind" value="${esc(fx.kind ?? "")}" placeholder="(any slot)"></label>
    <div role="group" aria-label="Item class">${classes}</div>
    <label>Base power tier ${sel("fx-power", set.power ?? "", [["", "none"], ...[1, 2, 3, 4, 5].map(n => [n, `Tier ${n}`])], `data-cls="${esc(fx.cls)}"`)}</label>
    ${(set.blocks ?? []).map((b, i) => blockHtml(b, fx.cls, i)).join("")}
    <div>${adds}</div>
    <ul data-part="fx-problems" role="alert">${problems.map(p => `<li>${esc(p)}</li>`).join("")}</ul>
    <details open><summary>What it gives, by tier (your view)</summary><ul data-part="fx-preview">${prev}</ul></details>
    <button type="button" data-action="fx-save"${problems.length ? ' aria-disabled="true"' : ""}>Save effects</button> <button type="button" data-action="fx-discard">Discard</button>
    <div data-part="fx-message" role="status">${esc(fx.message ?? "")}</div></fieldset>`;
}

function capsPanel(m) {
  const eff = m.caps ?? TAGS.defaultCaps;
  const rows = CAP_ROLES.filter(r => eff[r]).flatMap(role => Object.entries(eff[role]).map(([name, v]) =>
    `<label>${esc(role)} ${esc(name)} <input type="number" min="1" step="1" data-field="cap" data-role="${role}" data-name="${name}" value="${esc(m.ui.capsDraft?.[role]?.[name] ?? v)}"></label>`));
  return `<fieldset data-part="caps"><legend>Caps</legend>
    <p class="pfp-hint">Each cap clamps only its own role, after everything has been added up. What a cap cuts is noted in your GM log, never to players.</p>
    ${rows.join("")}<button type="button" data-action="caps-save">Save caps</button> <button type="button" data-action="caps-reset">Back to the defaults</button></fieldset>`;
}

export function renderTagger(m) {
  const tab = m.ui.tab;
  const body = tab === "slots" ? slotsTab(m) : tab === "tags" ? tagsTab(m) : itemsTab(m);
  const root = Object.entries(rootAttributes({ display: m.ui.display ?? normalizeDisplay({}), layout: m.ui.layout ?? "wide" })).map(([k, v]) => `${k}="${esc(v)}"`).join(" ");
  return `<div class="pfp-hub pfp-tagger" tabindex="-1" ${root}><p>${esc(T.intro)}</p>
    <nav role="tablist">${Object.entries(T.tabs).map(([id, label]) => `<button type="button" role="tab" data-action="tab" data-tab="${id}" aria-selected="${tab === id}">${esc(label)}</button>`).join("")}</nav>
    <div data-part="message" role="status" aria-live="polite">${esc(m.ui.message)}</div>
    <div data-part="body" class="pfp-tagger-body">${body}</div></div>`;
}
