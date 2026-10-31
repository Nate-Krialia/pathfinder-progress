/**
 * The Discovery tracks window (Stage 11c, GM only). ApplicationV2, built lazily like the review window. All decisions are in editor-model.js; this class
 * keeps the draft, turns clicks and field changes into edits and saves through api.discovery.tracks. Tab, Enter and Space stay inside the window like the Hub's.
 */
import { HUB, MODULE_ID } from "../config.js";
import { E, draftOf, edit, editorModel, renderEditor, trackOfDraft } from "./editor-model.js";
import { itemKey, trackOf } from "./track.js";

export const EDITOR_ID = `${MODULE_ID}-discovery-tracks`;
let EditorApp = null;

export function build() {
  const { ApplicationV2 } = foundry.applications.api;
  return class DiscoveryTracksWindow extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: EDITOR_ID,
      classes: ["pfp-hub-window", "pfp-editor-window"],
      tag: "div",
      window: { title: E.title, resizable: true },
      position: { width: 860, height: 560 },
      actions: {
        "pick-item"(event, target) { return this.#pick(target.dataset.key); },
        "add-row"() { return this.#change(draft => edit.add(draft, this.#kind())); },
        "add-default"() { return this.#change(() => edit.addDefault(this.#kind(), this.#defaultRecipe())); },
        "remove-row"(event, target) { return this.#change(draft => edit.remove(draft, Number(target.dataset.index))); },
        "save-track"() { return this.#save(); },
        "revert-track"() { return this.#reset(); },
        "use-definition"() { return this.#useDefinition(); },
        "toggle-chip"(event, target) { return this.#chip(target.dataset.chip); },
        "toggle-group"(event, target) { return this.#group(target.dataset.kind); }
      }
    };

    constructor(api, key = null, options = {}) {
      super(options);
      this.api = api;
      this.selectedKey = key;
      this.draft = null;
      this.dirty = false;
      this.message = "";
      this.filters = { search: "", kinds: [], track: "all" };     // the search box and the filter chips
      this.collapsed = [];                                       // group headings folded shut
      this.layout = "wide";
    }

    #wired = false;
    #observer = null;
    #focusAfter = null;

    #registry() { return this.api.definitions; }
    #kind() { return this.selectedKey?.split(":")[0] ?? "material"; }
    #defaultRecipe() {
      const key = this.selectedKey;
      const [kind, id] = [key?.split(":")[0], key?.split(":").slice(1).join(":")];
      return kind === "note" ? this.#registry().note.get(id)?.recipeId : kind === "recipe" ? id : undefined;     // a material's formula is the GM's choice: no guess
    }
    #current() {
      const [kind, ...rest] = (this.selectedKey ?? "").split(":");
      const def = this.#registry()?.[kind]?.get(rest.join(":"));
      return this.draft ?? draftOf(trackOf(def, this.api.discovery.tracks.overlay(), this.selectedKey));
    }

    /** A chip toggles: a kind chip adds or drops that kind (none chosen = all); the two track chips are exclusive and a second press clears. */
    #chip(id) {
      const [type, value] = id.split(":");
      if (type === "kind") this.filters = { ...this.filters, kinds: this.filters.kinds.includes(value) ? this.filters.kinds.filter(k => k !== value) : [...this.filters.kinds, value] };
      else this.filters = { ...this.filters, track: this.filters.track === value ? "all" : value };
      return this.render();
    }
    #group(kind) { this.collapsed = this.collapsed.includes(kind) ? this.collapsed.filter(k => k !== kind) : [...this.collapsed, kind]; return this.render(); }

    #pick(key) { this.selectedKey = key; this.draft = null; this.dirty = false; this.message = ""; return this.render(); }
    #change(fn) { this.draft = fn(this.#current()); this.dirty = true; this.message = ""; return this.render(); }
    #reset() { this.draft = null; this.dirty = false; this.message = ""; return this.render(); }

    async #save() {
      const registry = this.#registry();
      const name = registry[this.#kind()]?.get(this.selectedKey.split(":").slice(1).join(":"))?.name ?? this.selectedKey;
      try {
        await this.api.discovery.tracks.set(this.selectedKey, trackOfDraft(this.#current()));
        this.draft = null; this.dirty = false; this.message = E.saved(name);
        await this.api.publishDefinitions?.();
      } catch (error) {
        ui.notifications.error(`${MODULE_ID}: ${error.message}`);
      }
      return this.render();
    }

    async #useDefinition() {
      const registry = this.#registry();
      const name = registry[this.#kind()]?.get(this.selectedKey.split(":").slice(1).join(":"))?.name ?? this.selectedKey;
      try { await this.api.discovery.tracks.clear(this.selectedKey); this.draft = null; this.dirty = false; this.message = E.cleared(name); await this.api.publishDefinitions?.(); } catch (error) { ui.notifications.error(`${MODULE_ID}: ${error.message}`); }
      return this.render();
    }

    _onRender() {
      const root = this.element?.querySelector(".pfp-editor");
      if (root && !root.dataset.keys) {
        root.dataset.keys = "1";
        root.addEventListener("keydown", event => { if (HUB.keysKeptInside.includes(event.key) && root.contains(event.target)) event.stopPropagation(); });
      }
      if (this.#wired) return;
      this.#wired = true;
      // Narrow window: the two panes stack (same rule as the Hub).
      this.#observer = new ResizeObserver(entries => {
        const width = entries[0]?.contentRect?.width ?? 0;
        const layout = width > 0 && width < HUB.stackBelowPx ? "narrow" : "wide";
        if (layout !== this.layout) { this.layout = layout; this.render(); }
      });
      this.#observer.observe(this.element);
      // Field edits (a number typed, a choice made) arrive as `change` events; the draft takes them and the window redraws with the same field focused.
      this.element.addEventListener("input", event => {
        if (event.target?.dataset?.field !== "search") return;
        this.#focusAfter = { field: "search", index: undefined, caret: event.target.selectionStart };
        this.filters = { ...this.filters, search: event.target.value };
        this.render();
      });
      this.element.addEventListener("change", event => {
        const field = event.target?.dataset?.field;
        if (!field) return;
        const index = Number(event.target.dataset.index);
        this.#focusAfter = { field, index };
        if (field === "steps") this.#change(draft => edit.setSteps(draft, index, event.target.value));
        else if (field === "grants") this.#change(draft => edit.setGrants(draft, index, event.target.value));
        else if (field === "recipe") this.#change(draft => edit.setRecipe(draft, index, event.target.value));
      });
    }

    async _renderHTML() {
      if (!game.user.isGM) return `<p>GM only.</p>`;
      return renderEditor(editorModel({ registry: this.#registry(), overlay: this.api.discovery.tracks.overlay(), selectedKey: this.selectedKey, draft: this.draft, dirty: this.dirty, message: this.message, filters: this.filters, collapsed: this.collapsed, layout: this.layout }));
    }

    _replaceHTML(result, content) {
      // A redraw replaces the markup: keep the scroll of the list and the editor, and the focus (and the caret in the search box) where they were.
      const scrolls = Object.fromEntries([...content.querySelectorAll("[data-scroll-key]")].map(el => [el.dataset.scrollKey, el.scrollTop]));
      const focused = content.contains(document.activeElement) ? document.activeElement : null;
      const keep = focused?.dataset?.action ? `[data-action="${focused.dataset.action}"]${focused.dataset.key ? `[data-key="${focused.dataset.key}"]` : ""}${focused.dataset.kind ? `[data-kind="${focused.dataset.kind}"]` : ""}${focused.dataset.chip ? `[data-chip="${focused.dataset.chip}"]` : ""}` : null;
      content.innerHTML = result;
      for (const el of content.querySelectorAll("[data-scroll-key]")) el.scrollTop = scrolls[el.dataset.scrollKey] ?? 0;
      if (this.#focusAfter) {
        const { field, index, caret } = this.#focusAfter;
        this.#focusAfter = null;
        const target = content.querySelector(`[data-field="${field}"]${index === undefined ? "" : `[data-index="${index}"]`}`);
        target?.focus?.();
        if (caret !== undefined && target?.setSelectionRange) { try { target.setSelectionRange(caret, caret); } catch { /* a type that has no caret */ } }
      } else if (keep) content.querySelector(keep)?.focus?.();
    }

    _onClose() { this.#observer?.disconnect(); }
  };
}

/** Open (or re-aim) the Discovery tracks window. GM only. `key` selects an item ("material:iron"). */
export function openEditor(api, key = null) {
  if (!game.user.isGM) throw new Error("the Discovery tracks window is GM only");
  EditorApp ??= build();
  const existing = foundry.applications.instances.get(EDITOR_ID);
  if (existing) { if (key) existing.selectedKey = key; existing.draft = null; existing.dirty = false; existing.render({ force: true }); return existing; }
  const app = new EditorApp(api, key);
  app.render({ force: true });
  return app;
}

export { itemKey };
