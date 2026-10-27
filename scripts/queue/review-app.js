/**
 * The GM review window (ApplicationV2). Built lazily the first time it is opened, so loading
 * the module on a player's client never touches the ApplicationV2 classes.
 */
import { MODULE_ID } from "../config.js";
import * as audit from "../audit/store.js";
import * as queue from "./store.js";
import { renderReview } from "./review.js";

let ReviewApp = null;

/** Foundry's own window buttons (header controls); never ours to handle. */
const FOUNDRY_ACTIONS = new Set(["close", "minimize", "maximize", "toggleControls", "configure", "pin", "unpin"]);

/**
 * The data-action of a clicked button inside OUR content that has no handler, else null.
 * Foundry's built-in header actions and anything outside the review content are ignored.
 */
export function unhandledAction(target, actions) {
  const button = target?.closest?.("[data-action]");
  const name = button?.dataset?.action;
  if (!name || FOUNDRY_ACTIONS.has(name) || !button.closest(".pfp-review")) return null;
  return name in actions ? null : name;
}


export function build() {
  const { ApplicationV2 } = foundry.applications.api;

  return class ReviewWindow extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: `${MODULE_ID}-review`,
      classes: ["pfp-review-window"],
      tag: "div",
      window: { title: "Pathfinder Progress: Review", resizable: true },
      position: { width: 720, height: 560 },
      actions: {
        refresh() { return this.render(); },
        // Keys must match the buttons' data-action values EXACTLY (kebab-case); ApplicationV2 ignores unknown names.
        "resolve-all"() {
          return this.#run(async () => {
            if (!queue.list().length) { ui.notifications.info(`${MODULE_ID}: nothing is queued, so there is nothing to resolve.`); return; }
            const batch = await queue.resolveAll(this.api);
            this.results = batch.results;
            this.#note(batch.summary);
          });
        },
        resolve(event, target) { return this.#resolveOne(target); },
        retry(event, target) { return this.#resolveOne(target); },
        reject(event, target) { return this.#run(() => queue.reject(this.#actor(target), target.dataset.actionId)); },
        "edit-days"(event, target) {
          const input = this.element.querySelector(`input[data-days-for="${CSS.escape(target.dataset.actionId)}"]`);
          return this.#run(() => queue.editDays(this.#actor(target), target.dataset.actionId, Number(input?.value)));
        },
        accept(event, target) { return this.#run(() => audit.accept(this.#actor(target))); }
      }
    };

    constructor(api, options) {
      super(options);
      this.api = api;
      this.results = [];
    }

    /** A button whose data-action has no handler must say so, never fail silently. */
    _onRender(context, options) {
      if (this.#guarded) return;
      this.#guarded = true;
      this.element.addEventListener("click", event => {
        const name = unhandledAction(event.target, this.options.actions);
        if (name) {
          ui.notifications.error(`${MODULE_ID}: the "${name}" button has no handler (a bug in the module).`);
        }
      }, true);
    }

    #guarded = false;

    #actor(target) {
      const actor = game.actors.get(target.dataset.actor);
      if (!actor) throw new Error(`no actor with id "${target.dataset.actor}"`);
      return actor;
    }

    #note(summary) {
      ui.notifications.info(`${MODULE_ID}: ${summary.resolved} resolved, ${summary.invalid} refused, ${summary.skipped} skipped, ${summary.errors} error(s).`);
    }

    /** Run a GM action, show any failure, and redraw. A failure never closes the window. */
    async #run(fn) {
      try {
        await fn();
      } catch (error) {
        console.error(`${MODULE_ID} |`, error);
        ui.notifications.error(`${MODULE_ID}: ${error.message}`);
      }
      return this.render();
    }

    #resolveOne(target) {
      const actorId = target.dataset.actor;
      const actionId = target.dataset.actionId;
      return this.#run(async () => {
        const row = queue.list().find(r => r.actorId === actorId && r.action.id === actionId);
        const base = { actorId, actionId, actorName: row?.actorName, label: row?.label };
        try {
          const outcome = await queue.resolveAction(this.api, this.#actor(target), actionId);
          this.results = [...this.results.filter(r => !(r.actorId === actorId && r.actionId === actionId)), { ...base, ...outcome }];
        } catch (error) {
          this.results = [...this.results.filter(r => !(r.actorId === actorId && r.actionId === actionId)), { ...base, status: "error", message: error.message }];
        }
      });
    }

    async _renderHTML() {
      if (!game.user.isGM) return `<p>GM only.</p>`;
      // Keep only error results whose action is still queued, plus this session's other results.
      return renderReview({ rows: queue.list(), results: this.results, audit: audit.scan() });
    }

    _replaceHTML(result, content) {
      content.innerHTML = result;
    }
  };
}

/** Open (or re-render) the review window. GM only. */
export function openReview(api) {
  if (!game.user.isGM) throw new Error("the review window is GM only");
  ReviewApp ??= build();
  const existing = foundry.applications.instances.get(`${MODULE_ID}-review`);
  if (existing) { existing.render({ force: true }); return existing; }
  const app = new ReviewApp(api);
  app.render({ force: true });
  return app;
}

/** Redraw the window if it is open (called when queue data changes). */
export function refreshReview() {
  foundry.applications.instances.get(`${MODULE_ID}-review`)?.render();
}
