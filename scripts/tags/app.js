/**
 * The tag window (Slice 1, GM only): tag any item with several tags and a tier, say what a recipe slot needs, create tags, set a tag's priority. ApplicationV2, built lazily.
 * Everything it writes goes through api.tags / api.editor (so the same validation and the same GM-only checks apply); this class keeps the draft and turns clicks into calls.
 */
import { HUB, MODULE_ID } from "../config.js";
import { renderTagger, taggerModel, T } from "./model.js";
import { getLedger } from "./current.js";

export const TAGGER_ID = `${MODULE_ID}-tagger`;
let TaggerApp = null;
const blankDraft = () => ({ source: "material", ref: "", uuid: "", name: "", tags: [], tier: "", editing: false });

export function build() {
  const { ApplicationV2 } = foundry.applications.api;
  return class TaggerWindow extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: TAGGER_ID, classes: ["pfp-hub-window", "pfp-tagger-window"], tag: "div",
      window: { title: T.title, resizable: true }, position: { width: 720, height: 600 },
      actions: {
        tab(event, target) { this.ui.tab = target.dataset.tab; this.ui.message = ""; return this.render(); },
        lookup() { return this.#lookup(); },
        "save-entry"() { return this.#saveEntry(); },
        "cancel-entry"() { this.ui.draft = blankDraft(); return this.render(); },
        "edit-entry"(event, target) { return this.#edit(target.dataset.ref); },
        "remove-entry"(event, target) { return this.#run(async () => { const name = this.api.definitions.material.get(target.dataset.ref)?.name ?? getLedger().items[target.dataset.ref]?.name ?? target.dataset.ref; await this.api.tags.removeEntry(target.dataset.ref); return T.removed(name); }); },
        "save-slot"(event, target) { return this.#saveSlot(target.dataset.slot, false); },
        "clear-slot"(event, target) { return this.#saveSlot(target.dataset.slot, true); },
        "create-tag"() { return this.#createTag(); },
        "save-priority"(event, target) { return this.#savePriority(target.dataset.tag); }
      }
    };

    constructor(api, options = {}) {
      super(options);
      this.api = api;
      this.ui = { layout: "wide", tab: "items", draft: blankDraft(), recipeId: "", slotDrafts: {}, newTag: { name: "", theme: "" }, priorities: {}, message: "" };
    }
    #wired = false;
    #observer = null;

    /** Point the form at one item (from its sheet): a material by id, any other item by UUID and name. */
    aim({ materialId, uuid, name }) {
      this.ui.tab = "items"; this.ui.message = "";
      if (materialId && this.api.definitions.material.has(materialId)) return this.#edit(materialId, true);
      const entry = getLedger().items[uuid];
      this.ui.draft = { source: "item", ref: uuid, uuid, name: entry?.name ?? name ?? "", tags: [...(entry?.tags ?? [])], tier: entry?.tier ?? "", editing: Boolean(entry) };
      return undefined;
    }

    #model() { return taggerModel(this.ui, this.api.definitions, getLedger()); }

    async #run(fn) {
      try { this.ui.message = await fn(); }
      catch (error) { this.ui.message = error.message; if (!error.details) console.warn(`${MODULE_ID} | item tags: ${error.message}`); }
      return this.render();
    }

    async #lookup() {
      const d = this.ui.draft;
      return this.#run(async () => {
        const doc = await fromUuid(String(d.uuid).trim()).catch(() => null);
        if (!doc || doc.documentName !== "Item") throw new Error("No item found with that UUID.");
        d.name = doc.name; d.ref = doc.uuid;
        return `Found ${doc.name}.`;
      });
    }

    #edit(ref, quiet = false) {
      const material = this.api.definitions.material.has(ref);
      const entry = getLedger().items[ref];
      this.ui.draft = { source: material ? "material" : "item", ref, uuid: material ? "" : ref, name: entry?.name ?? "", tags: [...(entry?.tags ?? this.api.tags.tagsOf(ref))], tier: entry?.tier ?? "", editing: true };
      this.ui.message = ""; this.ui.tab = "items";
      return quiet ? undefined : this.render();
    }

    #saveEntry() {
      const d = this.ui.draft;
      return this.#run(async () => {
        const ref = d.source === "material" ? d.ref : String(d.ref || d.uuid).trim();
        const name = this.api.definitions.material.get(ref)?.name ?? d.name;
        await this.api.tags.setEntry(ref, { tags: d.tags, ...(d.tier !== "" ? { tier: Number(d.tier) } : {}), ...(d.source === "item" ? { name: d.name } : {}) });
        this.ui.draft = blankDraft();
        return T.saved(name || ref);
      });
    }

    #saveSlot(slotName, clear) {
      return this.#run(async () => {
        const draft = this.ui.slotDrafts[slotName] ?? {};
        const recipe = this.api.definitions.recipe.get(this.ui.recipeId);
        const current = recipe.slots.find(s => s.name === slotName);
        const needs = clear ? null : { all: draft.all ?? current.needs?.all ?? [], optional: draft.optional ?? Boolean(current.needs?.optional) };
        await this.api.tags.setSlotNeeds(this.ui.recipeId, slotName, needs);
        delete this.ui.slotDrafts[slotName];
        return clear ? `${slotName} goes back to the tier rule.` : `Saved ${slotName}.`;
      });
    }

    #createTag() {
      const { name, theme } = this.ui.newTag;
      return this.#run(async () => {
        const made = await this.api.editor.create("tag", { name: String(name).trim(), theme: String(theme).trim() || String(name).trim() }, { makeItem: false });
        this.ui.newTag = { name: "", theme: "" };
        return `Made the tag ${made.record.name}.`;
      });
    }

    #savePriority(tagId) {
      return this.#run(async () => {
        const raw = this.ui.priorities[tagId];
        const value = raw === undefined || raw === "" ? undefined : Number(raw);
        if (value !== undefined && !Number.isInteger(value)) throw new Error("Priority must be a whole number.");
        await this.api.editor.update(`tag:${tagId}`, { priority: value }, { confirmed: true });
        delete this.ui.priorities[tagId];
        return "Saved the priority.";
      });
    }

    #onField(el) {
      const f = el.dataset.field, d = this.ui.draft;
      if (f === "source") { this.ui.draft = { ...blankDraft(), source: el.value, tags: d.tags }; return this.render(); }
      if (f === "material") { d.ref = el.value; d.tags = el.value ? [...this.api.tags.tagsOf(el.value)] : []; return this.render(); }
      if (f === "uuid") { d.uuid = el.value; d.ref = ""; return undefined; }
      if (f === "name") { d.name = el.value; return undefined; }
      if (f === "tag") { d.tags = el.checked ? [...new Set([...d.tags, el.dataset.tag])] : d.tags.filter(t => t !== el.dataset.tag); return undefined; }
      if (f === "tier") { d.tier = el.value; return undefined; }
      if (f === "recipe") { this.ui.recipeId = el.value; this.ui.slotDrafts = {}; return this.render(); }
      if (f === "slot-tag" || f === "slot-optional") {
        const recipe = this.api.definitions.recipe.get(this.ui.recipeId), slot = recipe.slots.find(s => s.name === el.dataset.slot);
        const draft = this.ui.slotDrafts[slot.name] ??= { all: [...(slot.needs?.all ?? [])], optional: Boolean(slot.needs?.optional) };
        if (f === "slot-optional") draft.optional = el.checked;
        else draft.all = el.checked ? [...new Set([...draft.all, el.dataset.tag])] : draft.all.filter(t => t !== el.dataset.tag);
        return undefined;
      }
      if (f === "new-tag-name") { this.ui.newTag.name = el.value; return undefined; }
      if (f === "new-tag-theme") { this.ui.newTag.theme = el.value; return undefined; }
      if (f === "priority") { this.ui.priorities[el.dataset.tag] = el.value; return undefined; }
      return undefined;
    }

    async _renderHTML() { return game.user.isGM ? renderTagger(this.#model()) : "<p>GM only.</p>"; }
    _replaceHTML(result, content) { content.innerHTML = result; }
    _onClose() { this.#observer?.disconnect(); }
    _onRender() {
      if (this.#wired || !this.element) return;
      this.#wired = true;
      this.#observer = new ResizeObserver(entries => {
        const width = entries[0]?.contentRect?.width ?? 0;
        const layout = width > 0 && width < HUB.stackBelowPx ? "narrow" : "wide";
        if (layout !== this.ui.layout) { this.ui.layout = layout; this.render(); }
      });
      this.#observer.observe(this.element);
      this.element.addEventListener("change", event => { if (event.target?.dataset?.field) this.#onField(event.target); });
      this.element.addEventListener("keydown", event => { if (["Tab", "Enter", " "].includes(event.key) && this.element.contains(event.target)) event.stopPropagation(); });
    }
  };
}

/** Open the tag window. GM only. */
export function openTagger(api, prefill = null) {
  if (!game.user.isGM) throw new Error("the item tags window is GM only");
  TaggerApp ??= build();
  const existing = foundry.applications.instances.get(TAGGER_ID);
  const app = existing ?? new TaggerApp(api);
  if (prefill) app.aim(prefill);
  app.render({ force: true });
  return app;
}
