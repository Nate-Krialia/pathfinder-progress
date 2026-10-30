/**
 * A stricter stand-in for Foundry v14's ApplicationV2 (checked against the v14.369 declarations in @league-of-foundry-developers/foundry-vtt-types,
 * which mirror the real class). The first fake (`class { constructor(o) {...} async render() {} }`) let `this.state = ...` through, and
 * the real class defines `state` as a read-only getter, so it threw in real Foundry. This one:
 *  - has READ-ONLY getters where the real class has getters (state, id, element, rendered, title, window, classList, form, minimized,
 *    hasFrame, children, parent). Assigning to one throws a TypeError (all our code is strict), exactly like Foundry;
 *  - freezes `options` (shallowly, as the real constructor does) and keeps `position` and `tabGroups` plain;
 *  - runs the real render lifecycle: render() is a no-op on an unrendered app unless { force: true }, state goes NONE -> RENDERING ->
 *    RENDERED (-> CLOSING -> CLOSED), and _prepareContext, _renderHTML, _renderFrame, _replaceHTML, _onFirstRender/_onRender/_postRender
 *    (and _preClose/_onClose) are called in the real order with the real arguments;
 *  - draws into a REAL DOM (jsdom) and routes clicks on `[data-action]` to `options.actions[name]` with `this` bound to the app and
 *    (event, target) as arguments, like the real frame listener does.
 */
import { JSDOM } from "jsdom";

export const RENDER_STATES = Object.freeze({ ERROR: -3, CLOSING: -2, CLOSED: -1, NONE: 0, RENDERING: 1, RENDERED: 2 });

/** Every member the real ApplicationV2 (and its EventEmitter mixin) defines, by kind. Used by the collision check. */
export const REAL_MEMBERS = Object.freeze({
  getters: ["window", "classList", "id", "title", "element", "form", "minimized", "rendered", "state", "hasFrame", "children", "parent"],
  properties: ["options", "tabGroups", "position"],
  methods: ["render", "close", "setPosition", "minimize", "maximize", "bringToFront", "changeTab", "submit", "attachWindow", "detachWindow", "addEventListener", "removeEventListener", "dispatchEvent",
    "_initializeApplicationOptions", "_configureRenderOptions", "_prepareContext", "_prepareTabs", "_getTabsConfig", "_getFrameButtons", "_getHeaderControls", "_headerControlButtons", "_headerControlContextEntries",
    "_renderHTML", "_replaceHTML", "_renderFrame", "_renderFrameButtons", "_renderHeaderControl", "_updateFrame", "_insertElement", "_removeElement", "_tearDown", "_updatePosition", "_refit", "_canAttach", "_canDetach",
    "_canRender", "_preFirstRender", "_onFirstRender", "_preRender", "_onRender", "_postRender", "_preClose", "_onClose", "_prePosition", "_onPosition", "_onAttach", "_onDetach", "_attachFrameListeners",
    "_onConfigurePlugins", "_onClickTab", "_onClickAction", "_onSubmitForm", "_onChangeForm", "_awaitTransition", "_createContextMenu"],
  // The ones a subclass is MEANT to override (documented extension points). Anything else a subclass defines with a real member's name is a collision.
  overridable: ["title", "_prepareContext", "_renderHTML", "_replaceHTML", "_onFirstRender", "_onRender", "_postRender", "_preRender", "_preFirstRender", "_onClose", "_preClose", "_onPosition", "_prePosition", "_canRender", "_getHeaderControls", "_initializeApplicationOptions", "_configureRenderOptions", "_attachFrameListeners", "_onClickAction", "tabGroups"]
});

/** Install a jsdom document and the browser globals the Hub touches. Returns { dom, resizeObservers }. Safe to call twice. */
export function installDom() {
  if (globalThis.__fakeDom) return globalThis.__fakeDom;
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
  const w = dom.window;
  const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  for (const name of ["document", "HTMLElement", "Element", "Node", "MouseEvent", "KeyboardEvent", "MutationObserver", "DOMTokenList"]) define(name, w[name]);
  define("window", w);
  define("requestAnimationFrame", cb => setTimeout(() => cb(Date.now()), 0));
  define("cancelAnimationFrame", id => clearTimeout(id));
  const observers = [];
  define("ResizeObserver", class {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
    observe(element) { this.targets.add(element); }
    unobserve(element) { this.targets.delete(element); }
    disconnect() { this.targets.clear(); }
  });
  globalThis.__fakeDom = { dom, observers, resize: (element, width) => { for (const o of observers) if (o.targets.has(element)) o.callback([{ target: element, contentRect: { width, height: 600 } }]); } };
  return globalThis.__fakeDom;
}

const isPlain = value => value && typeof value === "object" && !Array.isArray(value);
const mergeDeep = (base, extra) => {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra ?? {})) out[key] = isPlain(value) && isPlain(out[key]) ? mergeDeep(out[key], value) : (isPlain(value) ? mergeDeep({}, value) : value);
  return out;
};

let appCounter = 0;

export class FakeApplicationV2 {
  static DEFAULT_OPTIONS = { id: "app-{id}", classes: [], tag: "div", window: { frame: true, positioned: true, title: "", icon: false, controls: [], minimizable: true, resizable: false, contentTag: "section", contentClasses: [] }, actions: {}, position: { width: "auto", height: "auto" } };
  static RENDER_STATES = RENDER_STATES;

  #state = RENDER_STATES.NONE;
  #element = undefined;
  #id;
  #queue = Promise.resolve();

  constructor(options = {}) {
    const chain = [];
    for (let cls = this.constructor; cls && cls !== Function.prototype; cls = Object.getPrototypeOf(cls)) if (Object.hasOwn(cls, "DEFAULT_OPTIONS")) chain.unshift(cls.DEFAULT_OPTIONS);
    const merged = [...chain, options].reduce((acc, next) => mergeDeep(acc, next), {});
    this.options = Object.freeze(merged);                                  // shallow, like the real constructor
    this.#id = String(this.options.id).replace("{id}", ++appCounter);
    this.position = { top: undefined, left: undefined, width: "auto", height: "auto", scale: 1, zIndex: 100, ...this.options.position };
    this.tabGroups = {};
  }

  // Read-only getters, as in Foundry v14.
  get state() { return this.#state; }
  get id() { return this.#id; }
  get element() { return this.#element; }
  get rendered() { return this.#state === RENDER_STATES.RENDERED; }
  get title() { return this.options.window.title; }
  get window() { return { header: this.#element?.querySelector(".window-header"), title: this.#element?.querySelector(".window-title"), content: this.#element?.querySelector(".window-content") }; }
  get classList() { return this.#element?.classList; }
  get form() { return null; }
  get minimized() { return false; }
  get hasFrame() { return this.options.window.frame; }
  get children() { return new Map(); }
  get parent() { return null; }

  render(options = {}, _options = {}) {
    if (typeof options === "boolean") options = { ..._options, force: options };
    const run = () => this.#render(options);
    const result = this.#queue.then(run, run);                              // the real class serialises renders
    this.#queue = result.catch(() => {});
    return result;
  }

  async #render(options) {
    if (!options.force && this.#state <= RENDER_STATES.NONE) return this;    // a plain render() never opens a closed window
    if (this._canRender(options) === false) return this;
    const first = this.#state <= RENDER_STATES.NONE;
    const ro = { force: false, parts: [], isFirstRender: first, ...options };
    this.#state = RENDER_STATES.RENDERING;
    try {
      if (first) await this._preFirstRender({}, ro);
      const context = await this._prepareContext(ro);
      if (first) await this._preRender(context, ro); else await this._preRender(context, ro);
      const result = await this._renderHTML(context, ro);
      if (first) { this.#element = await this._renderFrame(ro); }
      if (!first) this._updateFrame(ro);
      const content = this.#element.querySelector(".window-content");
      await this._replaceHTML(result, content, ro);
      if (first) { document.body.append(this.#element); globalThis.foundry?.applications?.instances?.set(this.#id, this); this._attachFrameListeners(); }
      if (first) await this._onFirstRender(context, ro);
      await this._onRender(context, ro);
      await this._postRender(context, ro);
      this.#state = RENDER_STATES.RENDERED;
    } catch (error) {
      this.#state = RENDER_STATES.ERROR;
      throw error;
    }
    return this;
  }

  async close(options = {}) {
    if (this.#state <= RENDER_STATES.NONE) return this;
    await this._preClose(options);
    this.#state = RENDER_STATES.CLOSING;
    this.#element?.remove();
    globalThis.foundry?.applications?.instances?.delete(this.#id);
    this.#element = undefined;
    this.#state = RENDER_STATES.CLOSED;
    await this._onClose(options);
    return this;
  }

  setPosition(position = {}) {
    Object.assign(this.position, position);
    this._onPosition(this.position);
    return this.position;
  }

  _canRender() { return true; }
  async _preFirstRender() {}
  async _onFirstRender() {}
  async _preRender() {}
  async _onRender() {}
  async _postRender() {}
  async _preClose() {}
  _onClose() {}
  _onPosition() {}
  _prePosition() {}
  _attachFrameListeners() {
    this.#element.addEventListener("click", event => {
      const target = event.target?.closest?.("[data-action]");
      if (!target) return;
      const config = this.options.actions[target.dataset.action];
      const handler = typeof config === "function" ? config : config?.handler;
      if (typeof handler === "function") handler.call(this, event, target);
    });
  }
  async _prepareContext() { return {}; }
  async _renderHTML() { throw new Error("subclasses must implement _renderHTML"); }
  _replaceHTML() { throw new Error("subclasses must implement _replaceHTML"); }
  /** Like the real class: the frame's title is read when the frame is BUILT, and again only if the render options ask for it (options.window.title). */
  _updateFrame(options) {
    if (options.window && "title" in options.window) this.#element.querySelector(".window-title").textContent = this.title;
  }
  async _renderFrame() {
    const frame = document.createElement(this.options.tag);
    frame.id = this.#id;
    frame.className = ["application", ...(this.options.classes ?? [])].join(" ");
    frame.innerHTML = `<header class="window-header"><h1 class="window-title"></h1></header><section class="window-content"></section>`;
    frame.querySelector(".window-title").textContent = this.title;
    return frame;
  }
}

/** Put the strict fake in place of foundry.applications.api.ApplicationV2 (and an empty instances map). Returns the DOM helpers. */
export function installFakeApplication() {
  const dom = installDom();
  const foundry = (globalThis.foundry ??= {});
  foundry.applications = { ...(foundry.applications ?? {}), api: { ...(foundry.applications?.api ?? {}), ApplicationV2: FakeApplicationV2 }, instances: new Map() };
  document.body.innerHTML = "";
  return dom;
}

/**
 * The collision check: names a subclass defines (prototype methods and accessors anywhere between it and ApplicationV2, plus the own
 * fields its constructor set) that are also members of the real ApplicationV2 and are NOT documented extension points.
 */
export function collisions(instance) {
  const real = new Set([...REAL_MEMBERS.getters, ...REAL_MEMBERS.properties, ...REAL_MEMBERS.methods]);
  const allowed = new Set(REAL_MEMBERS.overridable);
  const names = new Set();
  for (let proto = Object.getPrototypeOf(instance); proto && proto !== FakeApplicationV2.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) if (name !== "constructor") names.add(name);
  }
  const baseFields = new Set(Object.keys(new FakeApplicationV2({ id: "baseline" })));
  for (const name of Object.keys(instance)) if (!baseFields.has(name)) names.add(name);
  return [...names].filter(name => real.has(name) && !allowed.has(name)).sort();
}
