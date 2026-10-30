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
import { craftRequest, emptyState, hubModel, openProject, pickMaterial, selectEntry, selectProject, selectRecipe, setCategory, setSkill, stepDays } from "./viewmodels.js";
import { researchRequest } from "./viewmodels-research.js";
import { shareRequest } from "./viewmodels-compendium.js";
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
        "switch-tab"(event, target) { return this.#set({ tab: target.dataset.tab, confirmAside: false }); },
        "set-filter"(event, target) { return this.#set({ filter: target.dataset.filter }); },
        "select-recipe"(event, target) { return this.#replace(selectRecipe(this.hubState, target.dataset.recipe || null)); },
        "pick-material"(event, target) { return this.#replace(pickMaterial(this.hubState, target.dataset.slot, target.dataset.material)); },
        "clear-slot"(event, target) { return this.#replace(pickMaterial(this.hubState, target.dataset.slot, null)); },
        "pick-station"(event, target) { return this.#set({ stationId: target.dataset.station }); },
        "toggle-queue"() { return this.#set({ showQueue: !this.hubState.showQueue }); },
        "toggle-display"() { return this.#set({ showDisplay: !this.hubState.showDisplay }); },
        "toggle-switch"() { return this.#set({ showSwitch: !this.hubState.showSwitch }); },
        "switch-character"(event, target) { return this.showCharacter(game.actors.get(target.dataset.actor)); },
        "set-text-size"(event, target) { return this.#display({ textSize: Number(target.dataset.value) }); },
        "set-theme"(event, target) { return this.#display({ theme: target.dataset.value }); },
        "set-font"(event, target) { return this.#display({ font: target.dataset.value }); },
        "reset-display"() { return this.#display(HUB.defaultDisplay); },
        "queue-craft"(event, target) { return this.#queueCraft(target); },
        "cancel-queued"(event, target) { return this.#cancel(target.dataset.actionId); },
        // Research
        "open-in-research"(event, target) { this.#requestFocus(`project:${target.dataset.project}`); return this.#replace(openProject(this.hubState, target.dataset.project)); },
        "select-project"(event, target) { return this.#replace(selectProject(this.hubState, target.dataset.project)); },
        "set-skill"(event, target) { return this.#replace(setSkill(this.hubState, target.dataset.skill)); },
        "days-down"() { return this.#replace(stepDays(this.hubState, -1, this.#compose().facts.days.free)); },
        "days-up"() { return this.#replace(stepDays(this.hubState, 1, this.#compose().facts.days.free)); },
        "queue-research"() { return this.#queueResearch(); },
        "put-aside"() { this.#requestFocus("keep-aside"); return this.#set({ confirmAside: true }); },
        "keep-aside"() { this.#requestFocus("put-aside"); return this.#set({ confirmAside: false }); },
        "confirm-aside"() { return this.#putAside(); },
        "follow-lead"(event, target) { return this.#followLead(target.dataset.lead); },
        // Compendium
        "set-category"(event, target) { return this.#replace(setCategory(this.hubState, target.dataset.category)); },
        "select-entry"(event, target) { return this.#replace(selectEntry(this.hubState, target.dataset.entry)); },
        "share-entry"() { return this.#shareEntry(); },
        // Placeholder: the button is aria-disabled and says why; nothing happens.
        "ask-crafter"() {}
      }
    };

    constructor(api, actor, options = {}) {
      super({ position: { ...HUB.defaultSize, ...savedPosition() }, ...options });
      this.api = api;
      this.actor = actor;
      this.hubState = { ...emptyState(), display: normalizeDisplay(readSetting(HUB.displaySetting)) };
      this.hubStatus = null;           // the one visible status line: { text, kind: "queued" | "cancelled" | "error", actionId?, seen? }
    }

    /** The visible (and spoken) status lines: none, or the one current line. */
    get announcements() { return this.hubStatus ? [this.hubStatus.text] : []; }

    get title() { return this.actor ? `${S.appTitle}: ${this.actor.name}` : S.appTitle; }

    /** Which character is on screen (the live-update hooks ask this). */
    get viewedId() { return this.actor?.id ?? null; }

    showCharacter(actor) {
      if (!actor) return undefined;
      this.actor = actor;
      this.#setStatus(null);
      this.hubState = { ...emptyState(), display: this.hubState.display, tab: this.hubState.tab, layout: this.hubState.layout };
      // ApplicationV2 reads the title when the frame is BUILT; a later title change has to be asked for: render option window.title (documented in
      // WindowRenderOptions) refreshes the frame's title, and _onRender below keeps it in step on every draw (belt and braces).
      return this.render({ force: true, window: { title: this.title } });
    }

    /** Interrupting a click on an aria-disabled button: it stays focusable (its reason is on screen) but does nothing. */
    _onRender() {
      this.#syncTitle();
      const root = this.element?.querySelector(".pfp-hub");
      if (root) this.#installKeys(root);
      // First open: focus goes to the Hub's root, not to a control, so Tab lands on the first control (Display) and no ring appears by itself.
      if (root && !this.#focused) { this.#focused = true; root.focus({ preventScroll: true }); }
      if (this.#wired) return;
      this.#wired = true;
      this.element.addEventListener("click", event => {
        this.#wantFocus = null;          // the person acted: a focus request from an earlier action is stale (this runs before the action's own handler)
        const target = event.target?.closest?.("[aria-disabled='true']");
        if (target) { event.preventDefault(); event.stopImmediatePropagation(); }
      }, true);
      this.#observer = new ResizeObserver(entries => {
        const width = entries[0]?.contentRect?.width ?? 0;
        const layout = width > 0 && width < HUB.stackBelowPx ? "narrow" : "wide";
        if (layout !== this.hubState.layout) { this.hubState = { ...this.hubState, layout }; this.#paint(); }
      });
      this.#observer.observe(this.element);
    }

    /** The frame's title follows the viewed character (the frame only reads the title when it is built). */
    #syncTitle() {
      const heading = this.window?.title;
      if (heading && heading.textContent !== this.title) heading.textContent = this.title;
    }

    /**
     * Foundry's KeyboardManager cancels Tab (its "cycle view" binding) and similar keys before the browser can move focus, and a Space then scrolls the page. So
     * Tab, Enter and Space are stopped from bubbling OUT of the Hub root (never preventDefault: the browser still moves focus and presses the button), and only
     * when the event came from inside the Hub. One listener per frame (not per render); removed on close. Escape and every other key are untouched.
     */
    #installKeys(root) {
      if (this.#root === root) return;
      this.#removeKeys();
      this.#root = root;
      this.#keyHandler = event => { if (event.key === "Tab") this.#wantFocus = null; if (HUB.keysKeptInside.includes(event.key) && root.contains(event.target)) event.stopPropagation(); };
      root.addEventListener("keydown", this.#keyHandler);
    }

    #removeKeys() {
      if (this.#root && this.#keyHandler) this.#root.removeEventListener("keydown", this.#keyHandler);
      this.#root = null;
      this.#keyHandler = null;
    }

    #wantFocus = null;      // { key, until }: a control to focus once it is drawn ("window" = the Hub root). Set by an action whose own button is about to go away.

    /**
     * Ask for focus on a control. It is applied by the first draw that HAS that control, not just the next draw: a relayed write's update echo can arrive after the handler
     * is done, so the draw that follows the handler may still be the old data (v0.19.1). It gives up after HUB.focusWaitMs, and any click or Tab of the person's own cancels it.
     */
    #requestFocus(key) { this.#wantFocus = { key, until: Date.now() + HUB.focusWaitMs }; }
    #root = null;
    #keyHandler = null;
    #focused = false;
    #statusTimer = null;
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
      this.#removeKeys();
      clearTimeout(this.#saveTimer);
      clearTimeout(this.#statusTimer);
      cancelAnimationFrame(this.#paintFrame);
    }

    async _renderHTML() {
      return this.#compose();
    }

    _replaceHTML(result, content) {
      this.#ensureShell(content);
      this.#apply(content, result);
    }

    #compose() {
      const facts = readFacts(this.api, this.actor, this.hubState);
      this.#reconcileStatus(facts);
      return { model: hubModel(facts, this.hubState), facts };
    }

    /** A "Craft queued" line stops being true when its action leaves the queue (resolved, cancelled, gone): drop it then. (Not before it has been seen there: the write can arrive a moment after the submit returns.) */
    #reconcileStatus(facts) {
      const status = this.hubStatus;
      if (status?.kind !== "queued" || !status.actionId) return;
      if (facts.queue.some(q => q.id === status.actionId)) status.seen = true;
      else if (status.seen) this.#setStatus(null);
    }

    /** Set (or clear) the visible status line. It also clears by itself after HUB.statusMs. Clearing never re-announces: the live region only changes when the text does. */
    #setStatus(status) {
      clearTimeout(this.#statusTimer);
      this.hubStatus = status;
      if (status) this.#statusTimer = setTimeout(() => { this.hubStatus = null; this.redraw(); }, HUB.statusMs);
    }

    #ensureShell(content) {
      if (content.querySelector(".pfp-hub")) return;
      // tabindex -1: a click on blank space inside the window puts focus INSIDE the Hub (not on the page body), so Tab starts from here.
      content.innerHTML = `<div class="pfp-hub" tabindex="-1"><div class="pfp-main"></div><div class="pfp-live" role="status" aria-live="polite" aria-label="${S.liveRegionLabel}"></div></div>`;
    }

    /** Replace the main part only if it changed, and put focus and scroll back where they were. */
    #apply(content, { model }) {
      const root = content.querySelector(".pfp-hub");
      for (const [name, value] of Object.entries(rootAttributes(model))) if (root.getAttribute(name) !== value) root.setAttribute(name, value);
      const main = root.querySelector(".pfp-main");
      const html = renderHubMain(model);
      if (main.dataset.html !== html) {
        const hadFocus = main.contains(document.activeElement);
        const focusKey = hadFocus ? document.activeElement?.dataset?.focusKey : null;
        const scrolls = Object.fromEntries([...main.querySelectorAll("[data-scroll-key]")].map(el => [el.dataset.scrollKey, el.scrollTop]));
        main.innerHTML = html;
        main.dataset.html = html;
        for (const el of main.querySelectorAll("[data-scroll-key]")) el.scrollTop = scrolls[el.dataset.scrollKey] ?? 0;
        // Focus the player had stays where it was; if its control is gone (a panel closed, a row left the queue) it falls back to the Hub root, not the page body.
        // Focus that was NOT in the Hub is never taken.
        if (hadFocus) ([...main.querySelectorAll("[data-focus-key]")].find(el => focusKey && el.dataset.focusKey === focusKey) ?? root).focus({ preventScroll: true });
      }
      if (this.#wantFocus) {
        const { key, until } = this.#wantFocus;
        const wanted = key === "window" ? root : [...main.querySelectorAll("[data-focus-key]")].find(el => el.dataset.focusKey === key);
        if (wanted) { this.#wantFocus = null; wanted.focus({ preventScroll: false }); }
        else if (Date.now() > until) this.#wantFocus = null;
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

    #set(change) { this.hubState = { ...this.hubState, ...change }; this.redraw(); }
    #replace(state) { this.hubState = state; this.redraw(); }
    #display(change) {
      this.hubState = { ...this.hubState, display: withDisplay(this.hubState.display, change) };
      writeSetting(HUB.displaySetting, this.hubState.display);
      this.redraw();
    }

    #announce(status) {
      this.#setStatus(status);
      this.redraw();
    }

    async #queueCraft() {
      const { facts } = this.#compose();
      const request = craftRequest(facts, this.hubState);
      const model = hubModel(facts, this.hubState);
      const button = model.body.detail?.buttons?.queue;
      if (!request || !button || button.disabled) return;      // an aria-disabled button never gets here; this is the belt to that brace
      this.#announce({ text: S.working, kind: "working" });
      try {
        const recipe = facts.recipes[request.recipe];
        const action = await this.api.queue.submit(this.actor, "craft", { recipe: request.recipe, selection: request.selection, stationId: request.stationId });
        this.hubState = { ...this.hubState, picks: {}, stationId: null };
        this.#announce({ text: S.queued(recipe.name, action?.daysReserved ?? request.days), kind: "queued", actionId: action?.id ?? null, seen: false });
      } catch (error) {
        this.#announce({ text: S.queueFailed(error.message), kind: "error" });
      }
    }

    async #queueResearch() {
      const { facts } = this.#compose();
      const request = researchRequest(facts, this.hubState);
      if (!request) return;                                      // an aria-disabled button never gets here; this is the belt to that brace
      this.#announce({ text: S.working, kind: "working" });
      try {
        const action = await this.api.queue.submit(this.actor, "research", { projectId: request.projectId, skill: request.skill }, request.days);
        this.#announce({ text: S.researchQueued(request.days, request.name, action?.daysReserved ?? request.days), kind: "queued", actionId: action?.id ?? null, seen: false });
      } catch (error) {
        this.#announce({ text: S.queueFailed(error.message), kind: "error" });
      }
    }

    async #putAside() {
      const { facts } = this.#compose();
      const project = facts.projects.find(p => p.id === this.hubState.projectId) ?? (facts.projects.length === 1 ? facts.projects[0] : null);
      this.hubState = { ...this.hubState, confirmAside: false };
      if (!project) { this.redraw(); return; }
      this.#announce({ text: S.working, kind: "working" });
      try {
        await this.api.research.putAside(this.actor, project.id);
        this.hubState = { ...this.hubState, projectId: null };
        this.#requestFocus("window");
        this.#announce({ text: S.asideDone(project.goalName), kind: "aside" });
      } catch (error) {
        this.#announce({ text: S.queueFailed(error.message), kind: "error" });
      }
    }

    async #followLead(leadId) {
      this.#announce({ text: S.working, kind: "working" });
      try {
        const project = await this.api.research.follow(this.actor, leadId);
        this.hubState = { ...this.hubState, projectId: project.id, skill: null, checkDays: 1, confirmAside: false };
        this.#requestFocus(`project:${project.id}`);
        this.#announce({ text: S.leadStarted(project.goalName), kind: "started" });
      } catch (error) {
        this.#announce({ text: S.queueFailed(error.message), kind: "error" });
      }
    }

    async #shareEntry() {
      const { facts } = this.#compose();
      const request = shareRequest(facts, this.hubState);
      if (!request) return;
      this.#announce({ text: S.working, kind: "working" });
      try {
        const action = await this.api.queue.submit(this.actor, "share", { kind: request.kind, key: request.key });
        this.#announce({ text: S.shareQueued(request.name), kind: "queued", actionId: action?.id ?? null, seen: false });
      } catch (error) {
        this.#announce({ text: S.queueFailed(error.message), kind: "error" });
      }
    }

    async #cancel(actionId) {
      if (!actionId) return;
      try {
        const rows = this.api.queue.list([this.actor]);
        const row = rows.find(r => r.action.id === actionId);
        const label = row?.label ?? "";
        this.#announce({ text: S.working, kind: "working" });
        await this.api.queue.cancel(this.actor, actionId);
        this.#announce({ text: row?.action.type === "share" ? S.shareCancelled(row.action.params?.name ?? label) : S.queueCancelled(label), kind: "cancelled" });
      } catch (error) {
        this.#announce({ text: S.queueFailed(error.message), kind: "error" });
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
