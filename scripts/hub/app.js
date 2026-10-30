/**
 * The Downtime Hub window (ApplicationV2). Built lazily like the review window, so loading the module never touches ApplicationV2.
 * All decisions live in viewmodels.js; this class gathers facts (facts.js), draws render.js, and turns clicks into state changes and
 * existing player API calls. One character at a time; a redraw replaces only the changed parts and keeps focus and scroll.
 */
import { HUB, MODULE_ID } from "../config.js";
import { S } from "./strings.js";
import { normalizeDisplay, withDisplay } from "./display.js";
import { defaultCharacter, ownedCharacters, readFacts } from "./facts.js";
import { renderHubMain, rootAttributes } from "./render.js";
import { craftRequest, emptyState, hubModel, pickMaterial, selectRecipe } from "./viewmodels.js";
import { installHubHooks } from "./live.js";

export const HUB_ID = `${MODULE_ID}-hub`;
let HubApp = null;
let hooksInstalled = false;

const readSetting = key => { try { return game.settings.get(MODULE_ID, key); } catch { return null; } };
const writeSetting = (key, value) => { try { return game.settings.set(MODULE_ID, key, value); } catch (error) { console.warn(`${MODULE_ID} | could not save ${key}`, error); return undefined; } };

/** The saved window box, kept only if it is a sensible size. */
export function savedPosition() {
  const raw = readSetting(HUB.sizeSetting);
  const box = {};
  for (const key of ["left", "top", "width", "height"]) if (Number.isFinite(raw?.[key])) box[key] = raw[key];
  if (box.width !== undefined) box.width = Math.max(HUB.minSize.width, box.width);
  if (box.height !== undefined) box.height = Math.max(HUB.minSize.height, box.height);
  return box;
}

export function build() {
  const { ApplicationV2 } = foundry.applications.api;

  return class HubWindow extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: HUB_ID,
      classes: ["pfp-hub-window"],
      tag: "div",
      window: { title: S.appTitle, resizable: true },
      position: { ...HUB.defaultSize },
      actions: {
        // Keys must match the buttons' data-action values EXACTLY (kebab-case).
        "switch-tab"(event, target) { return this.#set({ tab: target.dataset.tab }); },
        "set-filter"(event, target) { return this.#set({ filter: target.dataset.filter }); },
        "select-recipe"(event, target) { return this.#replace(selectRecipe(this.state, target.dataset.recipe || null)); },
        "pick-material"(event, target) { return this.#replace(pickMaterial(this.state, target.dataset.slot, target.dataset.material)); },
        "clear-slot"(event, target) { return this.#replace(pickMaterial(this.state, target.dataset.slot, null)); },
        "pick-station"(event, target) { return this.#set({ stationId: target.dataset.station }); },
        "toggle-queue"() { return this.#set({ showQueue: !this.state.showQueue }); },
        "toggle-display"() { return this.#set({ showDisplay: !this.state.showDisplay }); },
        "toggle-switch"() { return this.#set({ showSwitch: !this.state.showSwitch }); },
        "switch-character"(event, target) { return this.showCharacter(game.actors.get(target.dataset.actor)); },
        "set-text-size"(event, target) { return this.#display({ textSize: Number(target.dataset.value) }); },
        "set-theme"(event, target) { return this.#display({ theme: target.dataset.value }); },
        "set-font"(event, target) { return this.#display({ font: target.dataset.value }); },
        "reset-display"() { return this.#display(HUB.defaultDisplay); },
        "queue-craft"(event, target) { return this.#queueCraft(target); },
        "cancel-queued"(event, target) { return this.#cancel(target.dataset.actionId); },
        // Placeholders: the button is aria-disabled and says why; nothing happens.
        "ask-crafter"() {},
        "open-research"() {}
      }
    };

    constructor(api, actor, options = {}) {
      super({ position: { ...HUB.defaultSize, ...savedPosition() }, ...options });
      this.api = api;
      this.actor = actor;
      this.state = { ...emptyState(), display: normalizeDisplay(readSetting(HUB.displaySetting)) };
      this.announcements = [];
    }

    get title() { return this.actor ? `${S.appTitle}: ${this.actor.name}` : S.appTitle; }

    /** Which character is on screen (the live-update hooks ask this). */
    get viewedId() { return this.actor?.id ?? null; }

    showCharacter(actor) {
      if (!actor) return undefined;
      this.actor = actor;
      this.state = { ...emptyState(), display: this.state.display, tab: this.state.tab, layout: this.state.layout };
      return this.render({ force: true });
    }

    /** Interrupting a click on an aria-disabled button: it stays focusable (its reason is on screen) but does nothing. */
    _onRender() {
      if (this.#wired) return;
      this.#wired = true;
      this.element.addEventListener("click", event => {
        const target = event.target?.closest?.("[aria-disabled='true']");
        if (target) { event.preventDefault(); event.stopImmediatePropagation(); }
      }, true);
      this.#observer = new ResizeObserver(entries => {
        const width = entries[0]?.contentRect?.width ?? 0;
        const layout = width > 0 && width < HUB.stackBelowPx ? "narrow" : "wide";
        if (layout !== this.state.layout) { this.state = { ...this.state, layout }; this.#paint(); }
      });
      this.#observer.observe(this.element);
    }

    #wired = false;
    #observer = null;
    #saveTimer = null;
    #paintFrame = null;

    _onPosition(position) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = setTimeout(() => {
        const { left, top, width, height } = position ?? this.position;
        writeSetting(HUB.sizeSetting, { left, top, width, height });
      }, HUB.saveDebounceMs);
    }

    _onClose() {
      this.#observer?.disconnect();
      clearTimeout(this.#saveTimer);
    }

    async _renderHTML() {
      return this.#compose();
    }

    _replaceHTML(result, content) {
      this.#ensureShell(content);
      this.#apply(content, result);
    }

    #compose() {
      const facts = readFacts(this.api, this.actor, this.state);
      return { model: hubModel(facts, this.state), facts };
    }

    #ensureShell(content) {
      if (content.querySelector(".pfp-hub")) return;
      content.innerHTML = `<div class="pfp-hub"><div class="pfp-main"></div><div class="pfp-live" role="status" aria-live="polite" aria-label="${S.liveRegionLabel}"></div></div>`;
    }

    /** Replace the main part only if it changed, and put focus and scroll back where they were. */
    #apply(content, { model }) {
      const root = content.querySelector(".pfp-hub");
      for (const [name, value] of Object.entries(rootAttributes(model))) if (root.getAttribute(name) !== value) root.setAttribute(name, value);
      const main = root.querySelector(".pfp-main");
      const html = renderHubMain(model);
      if (main.dataset.html !== html) {
        const focusKey = main.contains(document.activeElement) ? document.activeElement?.dataset?.focusKey : null;
        const scrolls = Object.fromEntries([...main.querySelectorAll("[data-scroll-key]")].map(el => [el.dataset.scrollKey, el.scrollTop]));
        main.innerHTML = html;
        main.dataset.html = html;
        for (const el of main.querySelectorAll("[data-scroll-key]")) el.scrollTop = scrolls[el.dataset.scrollKey] ?? 0;
        if (focusKey) [...main.querySelectorAll("[data-focus-key]")].find(el => el.dataset.focusKey === focusKey)?.focus({ preventScroll: true });
      }
      const live = root.querySelector(".pfp-live");
      const text = this.announcements.map(a => `<p>${a.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])}</p>`).join("");
      if (live.dataset.html !== text) { live.innerHTML = text; live.dataset.html = text; }
    }

    #paint() {
      cancelAnimationFrame(this.#paintFrame);
      this.#paintFrame = requestAnimationFrame(() => { if (this.element) this.#apply(this.element, this.#compose()); });
    }

    /** Redraw now with the data as it is (live updates, a click). No flicker: only changed parts are replaced. */
    redraw() { if (this.element) this.#apply(this.element, this.#compose()); }

    #set(change) { this.state = { ...this.state, ...change }; this.redraw(); }
    #replace(state) { this.state = state; this.redraw(); }
    #display(change) {
      this.state = { ...this.state, display: withDisplay(this.state.display, change) };
      writeSetting(HUB.displaySetting, this.state.display);
      this.redraw();
    }

    #announce(text) {
      this.announcements = [text, ...this.announcements].slice(0, HUB.announceMax);
      this.redraw();
    }

    async #queueCraft() {
      const { facts } = this.#compose();
      const request = craftRequest(facts, this.state);
      const model = hubModel(facts, this.state);
      const button = model.body.detail?.buttons?.queue;
      if (!request || !button || button.disabled) return;      // an aria-disabled button never gets here; this is the belt to that brace
      try {
        const recipe = facts.recipes[request.recipe];
        const action = await this.api.queue.submit(this.actor, "craft", { recipe: request.recipe, selection: request.selection, stationId: request.stationId });
        this.state = { ...this.state, picks: {}, stationId: null };
        this.#announce(S.queued(recipe.name, action?.daysReserved ?? request.days));
      } catch (error) {
        this.#announce(S.queueFailed(error.message));
      }
    }

    async #cancel(actionId) {
      try {
        const rows = this.api.queue.list([this.actor]);
        const label = rows.find(r => r.action.id === actionId)?.label ?? "";
        await this.api.queue.cancel(this.actor, actionId);
        this.#announce(S.queueCancelled(label));
      } catch (error) {
        this.#announce(S.queueFailed(error.message));
      }
    }
  };
}

/** Open (or re-target) the Hub for a character. Any user. */
export function openHub(api, actor = defaultCharacter()) {
  HubApp ??= build();
  if (!hooksInstalled) {
    hooksInstalled = true;
    installHubHooks({ viewed: () => foundry.applications.instances.get(HUB_ID)?.viewedId ?? null, redraw: () => foundry.applications.instances.get(HUB_ID)?.redraw?.() });
  }
  const existing = foundry.applications.instances.get(HUB_ID);
  if (existing) {
    if (actor && actor.id !== existing.actor?.id) existing.showCharacter(actor); else existing.render({ force: true });
    return existing;
  }
  const app = new HubApp(api, actor ?? null);
  app.render({ force: true });
  return app;
}

export { ownedCharacters };
