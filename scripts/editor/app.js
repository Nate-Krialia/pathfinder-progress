/**
 * The item editor window (Stage 11d, GM only). ApplicationV2, built lazily like the review window. Every decision is in model.js; this class keeps the draft and the
 * little UI state (selection, filters, confirmations), turns clicks and field changes into pure edits and saves through api.editor.
 *
 * Typing in a text box refreshes only the preview and the action row, never the box or the buttons around it: a full redraw between a field losing focus and the click
 * that caused it would replace the button under the pointer and lose the click.
 */
import { HUB, MODULE_ID } from "../config.js";
import { E, applyControl, changesOf, draftFor, draftProblems, edit, editorModel, isDirty, renderEditor } from "./model.js";
import { rowEdit } from "./rows.js";
import { parseKey } from "../discovery/track.js";

export const EDITOR_ID = `${MODULE_ID}-item-editor`;
let EditorApp = null;
const kebab = name => name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
/** A selector that finds the same control again after a redraw. */
const selectorOf = el => `${el.tagName.toLowerCase()}${Object.entries(el.dataset ?? {}).map(([k, v]) => `[data-${kebab(k)}="${String(v).replace(/"/g, '\\"')}"]`).join("")}`;
const LIGHT_TYPES = new Set(["text", "number", "search", "textarea"]);

export function build() {
  const { ApplicationV2 } = foundry.applications.api;
  return class ItemEditorWindow extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: EDITOR_ID,
      classes: ["pfp-hub-window", "pfp-editor-window"],
      tag: "div",
      window: { title: E.title, resizable: true },
      position: { width: 1180, height: 640 },
      actions: {
        "pick-item"(event, target) { return this.#pick(target.dataset.key); },
        "toggle-chip"(event, target) { return this.#chip(target.dataset.chip); },
        "toggle-group"(event, target) { return this.#group(target.dataset.kind); },
        "preview-stage"(event, target) { this.previewStage = target.dataset.stage; return this.render(); },
        "effect-class"(event, target) { this.effectClass = target.dataset.cls; return this.render(); },
        "add-block"(event, target) { return this.#change(d => edit.addBlock(d, target.dataset.cls, target.dataset.type)); },
        "remove-block"(event, target) { return this.#change(d => edit.removeBlock(d, target.dataset.cls, target.dataset.type)); },
        "tier-mode"(event, target) { return this.#change(d => applyControl(d, { field: "tier-mode", ...target.dataset }, target.dataset.mode)); },
        "add-row"() { return this.#change(d => edit.rowsDo(d, rows => rowEdit.add(rows, d.kind))); },
        "add-default"() { return this.#change(d => edit.rowsDo(d, () => rowEdit.addDefault(d.kind, this.#defaultRecipe(d)))); },
        "remove-row"(event, target) { return this.#change(d => edit.rowsDo(d, rows => rowEdit.remove(rows, Number(target.dataset.index)))); },
        "save"() { return this.#save(false); },
        "discard"() { this.draft = null; this.message = ""; return this.render(); },
        "push-copies"() { return this.#ask("Write this item's name, image, description, bulk and price onto every copy, including the ones in characters' inventories?", "push"); },
        "make-item"() { return this.#run(async () => { await this.api.editor.makeItem(this.selectedKey); return "Made an item for it in the world's Items."; }); },
        "revert"() { return this.#ask("Take back every edit made here to this item and go back to the packs' version?", "revert"); },
        "retire"() { return this.#toggleRetire(); },
        "delete"() { return this.#ask("Delete this item and its world item? This cannot be undone. If anything uses it, it will be refused and you can retire it instead.", "delete"); },
        "new-material"() { return this.#startCreate("material"); },
        "new-note"() { return this.#startCreate("note"); },
        "do-create"() { return this.#create(); },
        "cancel-create"() { this.creating = null; return this.render(); },
        "export"() { return this.#export(); },
        "import"() { return this.#import(); },
        "clear-leftover"(event, target) { return this.#run(async () => { await this.api.editor.clearLeftover(target.dataset.key); return `Removed ${target.dataset.key}.`; }); },
        "confirm-yes"() { return this.#confirmYes(); },
        "confirm-no"() { this.confirm = null; return this.render(); }
      }
    };

    constructor(api, key = null, options = {}) {
      super(options);
      this.api = api;
      this.selectedKey = key;
      this.draft = null;                      // null = untouched (the model shows the stored definition)
      this.message = "";
      this.filters = { search: "", kinds: [], track: "all", retired: false };
      this.collapsed = [];
      this.layout = "wide";
      this.effectClass = "general";
      this.previewClass = null;
      this.previewStage = "crafted";
      this.creating = null;
      this.confirm = null;
    }

    #wired = false;
    #observer = null;
    #focusAfter = null;
    #saving = false;
    #asked = false;

    #registry() { return this.api.definitions; }
    #overlay() { try { return this.api.discovery.tracks.overlay(); } catch { return {}; } }
    #base() { return this.selectedKey ? draftFor(this.#registry(), this.#overlay(), this.selectedKey) : null; }
    #current() { return this.draft ?? this.#base(); }
    #defaultRecipe(draft) { return draft.kind === "note" ? draft.fields.recipeId : draft.kind === "recipe" ? draft.id : undefined; }    // a material's formula is the GM's choice: no guess

    #pick(key) { this.selectedKey = key; this.draft = null; this.message = ""; this.confirm = null; this.creating = null; this.effectClass = "general"; this.previewClass = null; return this.render(); }
    #change(fn) { const d = this.#current(); if (!d) return undefined; this.draft = fn(d); this.message = ""; return this.render(); }
    #chip(id) {
      const [type, value] = id.split(":");
      if (type === "kind") this.filters = { ...this.filters, kinds: this.filters.kinds.includes(value) ? this.filters.kinds.filter(k => k !== value) : [...this.filters.kinds, value] };
      else if (type === "show") this.filters = { ...this.filters, [value]: !this.filters[value] };
      else this.filters = { ...this.filters, track: this.filters.track === value ? "all" : value };
      return this.render();
    }
    #group(kind) { this.collapsed = this.collapsed.includes(kind) ? this.collapsed.filter(k => k !== kind) : [...this.collapsed, kind]; return this.render(); }
    #ask(text, action, data = {}) { this.confirm = { text, action, ...data }; return this.render(); }
    #startCreate(kind) { this.creating = { kind, name: "", tier: "", recipeId: "", preset: "" }; this.selectedKey = null; this.draft = null; this.confirm = null; this.message = ""; return this.render(); }

    /** Run a backend call, show its result line (or its plain-words refusal), and redraw. */
    async #run(fn) {
      try { this.message = await fn(); this.confirm = null; }
      catch (error) { this.message = error.message; this.confirm = null; if (!error.details) console.warn(`${MODULE_ID} | item editor: ${error.message}`); }
      return this.render();
    }

    async #save(confirmed) {
      const draft = this.#current(), base = this.#base();
      if (!draft || !isDirty(draft, base) || this.#saving) return undefined;
      if (draftProblems(draft, this.#registry()).any) return this.render();
      this.#saving = true;
      const key = this.selectedKey, name = draft.fields.name || key, changes = changesOf(draft, base);
      try {
        await this.api.editor.update(key, changes, { confirmed });
        this.draft = null; this.confirm = null;
        // What the item itself shows (name, price, tier...) only reaches existing copies when the GM pushes it.
        const touchesCopies = ["name", "img", "description", "bulk", "value", "tier"].some(f => f in changes);
        this.message = E.saved(name) + (touchesCopies ? " Use Push to copies to update the items that already exist." : "");
      } catch (error) {
        if (error.details?.needsConfirm) this.confirm = { text: `${error.message} Save anyway?`, action: "save" };
        else this.message = error.message;
      } finally { this.#saving = false; }
      return this.render();
    }

    async #confirmYes() {
      const c = this.confirm;
      this.confirm = null;
      if (!c) return this.render();
      if (c.action === "save") return this.#save(true);
      const key = this.selectedKey;
      if (c.action === "push") return this.#run(async () => { const r = await this.api.editor.pushCopies(key); return `Updated ${r.updated} cop${r.updated === 1 ? "y" : "ies"}.${r.skippedTokens ? ` ${r.skippedTokens} copy${r.skippedTokens === 1 ? "" : "ies"} on unlinked tokens ${r.skippedTokens === 1 ? "was" : "were"} skipped; change those by hand.` : ""}`; });
      if (c.action === "revert") return this.#run(async () => { await this.api.editor.revert(key); this.draft = null; return "Back to the packs' version."; });
      if (c.action === "delete") {
        return this.#run(async () => {
          try { await this.api.editor.remove(key); this.selectedKey = null; this.draft = null; return "Deleted."; }
          catch (error) {
            const u = error.details?.usage;
            if (!u) throw error;
            const where = [u.copies.length ? `held as ${u.copies.map(c2 => `${c2.count} in ${c2.where}`).join(", ")}` : null, u.recipes.length ? `a recipe override in ${u.recipes.join(", ")}` : null, u.nodes.length ? `gathered at ${u.nodes.join(", ")}` : null, u.yields.length ? `a yield of ${u.yields.join(", ")}` : null, u.tagged?.length ? `the tag of ${u.tagged.join(", ")}` : null].filter(Boolean);
            throw new Error(`It is still in use (${where.join("; ")}), so it was not deleted. Retire it instead and it disappears from the lists.`);
          }
        });
      }
      return this.render();
    }

    async #toggleRetire() {
      const retired = Boolean(this.#registry()[parseKey(this.selectedKey).kind]?.get(parseKey(this.selectedKey).id)?.retired);
      return this.#run(async () => { await this.api.editor.retire(this.selectedKey, !retired); return retired ? "Brought back." : "Retired. It no longer shows in the lists unless you turn on Show retired."; });
    }

    async #create() {
      const c = this.creating;
      if (!c) return undefined;
      try {
        const fields = c.kind === "material" ? { name: c.name, tier: Number(c.tier) || 1 } : { name: c.name, recipeId: c.recipeId, preset: c.preset };
        const made = await this.api.editor.create(c.kind, fields);
        this.creating = null; this.selectedKey = made.key; this.draft = null; this.effectClass = "general"; this.previewClass = null;
        this.message = `Made ${made.record.name} and an item for it in the world's Items.`;
      } catch (error) { this.message = error.message; }
      return this.render();
    }

    async #export() {
      try {
        const bundle = this.api.editor.exportRecords();
        foundry.utils.saveDataToFile(JSON.stringify(bundle, null, 2), "application/json", `${MODULE_ID}-editor.json`);
        this.message = `Exported ${bundle.records.length} record${bundle.records.length === 1 ? "" : "s"}.`;
      } catch (error) { this.message = error.message; }
      return this.render();
    }

    #import() {
      const picker = document.createElement("input");
      picker.type = "file"; picker.accept = ".json,application/json";
      picker.addEventListener("change", async () => {
        const file = picker.files?.[0];
        if (!file) return;
        await this.#run(async () => {
          let bundle;
          try { bundle = JSON.parse(await file.text()); } catch { throw new Error("That file is not valid JSON."); }
          const r = await this.api.editor.importRecords(bundle);
          return `Imported ${r.added.length + r.replaced.length}.${r.skipped.length ? ` Skipped ${r.skipped.length}: ${r.skipped.map(s => `${s.key} (${s.reason})`).join("; ")}.` : ""}`;
        });
      });
      picker.click();
      return undefined;
    }

    // Rendering -----------------------------------------------------------------------------------------------------------
    #model() {
      const selected = this.selectedKey ? parseKey(this.selectedKey) : null;
      const def = selected ? this.#registry()[selected.kind]?.get(selected.id) : null;
      if (this.selectedKey && !def) { this.selectedKey = null; this.draft = null; }           // it was deleted (here or on another GM client)
      const records = this.api.editor.records?.() ?? {};
      const entry = this.selectedKey ? this.api.editor.entry(this.selectedKey) : null;
      const base = this.#base();
      return editorModel({
        registry: this.#registry(), overlay: this.#overlay(), records, leftovers: this.api.editor.leftovers(), selectedKey: this.selectedKey, draft: this.draft ?? base, base,
        message: this.message, filters: this.filters, collapsed: this.collapsed, layout: this.layout, effectClass: this.effectClass, previewClass: this.previewClass, previewStage: this.previewStage,
        creating: this.creating, confirm: this.confirm,
        origin: entry ? { origin: entry.origin === "world" ? "world" : entry.origin === "pack" ? "pack" : "edited", editedFields: entry.editedFields, retired: entry.retired, hasItem: this.api.editor.hasItem?.(this.selectedKey) ?? true } : null
      });
    }

    async _renderHTML() {
      if (!game.user.isGM) return `<p>GM only.</p>`;
      return renderEditor(this.#model());
    }

    _onRender() {
      const root = this.element?.querySelector(".pfp-editor");
      if (root && !root.dataset.keys) {
        root.dataset.keys = "1";
        root.addEventListener("keydown", event => { if (HUB.keysKeptInside.includes(event.key) && root.contains(event.target)) event.stopPropagation(); });
      }
      if (this.#wired) return;
      this.#wired = true;
      // Narrow window: the panes stack (same rule as the Hub).
      this.#observer = new ResizeObserver(entries => {
        const width = entries[0]?.contentRect?.width ?? 0;
        const layout = width > 0 && width < HUB.stackBelowPx ? "narrow" : "wide";
        if (layout !== this.layout) { this.layout = layout; this.render(); }
      });
      this.#observer.observe(this.element);
      this.element.addEventListener("input", event => {
        const t = event.target;
        if (t?.dataset?.field === "search") { this.#focusAfter = { selector: selectorOf(t), caret: t.selectionStart }; this.filters = { ...this.filters, search: t.value }; this.render(); }
      });
      this.element.addEventListener("change", event => this.#onChange(event.target));
    }

    #onChange(t) {
      const field = t?.dataset?.field;
      if (!field || field === "search") return;
      const value = t.type === "checkbox" ? String(t.checked) : t.value;
      const light = LIGHT_TYPES.has(t.type) || t.tagName === "TEXTAREA";
      if (field === "preview-class") { this.previewClass = value; return this.render(); }
      if (field === "create") { this.creating = { ...this.creating, [t.dataset.name]: value }; this.#focusAfter = { selector: selectorOf(t) }; return this.render(); }
      const draft = this.#current();
      if (!draft) return undefined;
      this.draft = applyControl(draft, { ...t.dataset }, value);
      this.message = "";
      if (light) return this.#refreshLight();
      this.#focusAfter = { selector: selectorOf(t) };
      return this.render();
    }

    /** Redraw only the preview and the action row (what a typed value can change), so the box being typed in and the buttons nearby stay put. */
    async #refreshLight() {
      const html = renderEditor(this.#model());
      const template = document.createElement("template");
      template.innerHTML = html;
      const next = template.content;
      for (const part of ["preview", "actions"]) {
        const fresh = next.querySelector(`[data-part="${part}"]`), live = this.element.querySelector(`[data-part="${part}"]`);
        if (!fresh || !live) return this.render();
        const scrolls = [...live.querySelectorAll("[data-scroll-key]")].map(el => [el.dataset.scrollKey, el.scrollTop]);
        live.replaceWith(document.importNode(fresh, true));
        for (const [key, top] of scrolls) { const el = this.element.querySelector(`[data-part="${part}"] [data-scroll-key="${key}"]`); if (el) el.scrollTop = top; }
      }
      return undefined;
    }

    _replaceHTML(result, content) {
      // A redraw replaces the markup: keep the scroll of the list, the editor and the preview, and the focus (and the caret in the search box) where they were.
      const scrolls = Object.fromEntries([...content.querySelectorAll("[data-scroll-key]")].map(el => [el.dataset.scrollKey, el.scrollTop]));
      const focused = content.contains(document.activeElement) ? document.activeElement : null;
      const keep = focused && Object.keys(focused.dataset ?? {}).length ? selectorOf(focused) : null;
      content.innerHTML = result;
      for (const el of content.querySelectorAll("[data-scroll-key]")) el.scrollTop = scrolls[el.dataset.scrollKey] ?? 0;
      if (this.#focusAfter) {
        const { selector, caret } = this.#focusAfter;
        this.#focusAfter = null;
        const target = content.querySelector(selector);
        target?.focus?.();
        if (caret !== undefined && target?.setSelectionRange) { try { target.setSelectionRange(caret, caret); } catch { /* a type that has no caret */ } }
      } else if (keep) content.querySelector(keep)?.focus?.();
      // A question just appeared: focus lands on the safe answer (No), so a keyboard user hears it and Enter does nothing by accident.
      const asking = Boolean(this.confirm);
      if (asking && !this.#asked) content.querySelector('[data-action="confirm-no"]')?.focus?.();
      this.#asked = asking;
    }

    _onClose() { this.#observer?.disconnect(); }
  };
}

/** Open (or re-aim) the item editor. GM only. `key` selects an item ("material:iron"). */
export function openEditor(api, key = null) {
  if (!game.user.isGM) throw new Error("the item editor is GM only");
  EditorApp ??= build();
  const existing = foundry.applications.instances.get(EDITOR_ID);
  if (existing) { if (key) { existing.selectedKey = key; existing.draft = null; existing.creating = null; } existing.render({ force: true }); return existing; }
  const app = new EditorApp(api, key);
  app.render({ force: true });
  return app;
}
