/**
 * The DOM driver (e2e/README.md): the driver contract over jsdom and the module's fake Foundry. `as(user, fn)` runs `fn` as that fake user (tests/fake-world.js).
 * Reads are retried for up to `seenMs` (a real window redraws a moment after a click), clicks wait `settleMs` for the redraw.
 */
const norm = text => String(text ?? "").replace(/\s+/g, " ");

export function makeDomDriver({ as, user, settleMs = 30, seenMs = 1000 }) {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const run = fn => as(user, fn);
  const live = (action, where = "") => [...document.querySelectorAll(`[data-action="${action}"]${where}`)].find(b => b.getAttribute("aria-disabled") !== "true");
  const textOf = selector => norm(document.querySelector(selector)?.textContent);
  const driver = {
    kind: "dom",
    async click(action, where = "") {
      const target = live(action, where);
      if (!target) throw new Error(`a live ${action}${where} button is not on the page`);
      await run(async () => { target.click(); await wait(settleMs); });
    },
    async clickSelector(selector) {
      const target = document.querySelector(selector);
      if (!target) throw new Error(`${selector} is not on the page`);
      await run(async () => { target.click(); await wait(settleMs); });
    },
    async set(selector, value, event = "change") {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`${selector} is not on the page`);
      if (el.type === "checkbox") el.checked = Boolean(value); else el.value = value;
      await run(async () => { el.dispatchEvent(new window.Event(event, { bubbles: true })); await wait(settleMs); });
    },
    async text(selector = "body") { return textOf(selector); },
    async seen(regex, selector = "body") {
      const until = Date.now() + seenMs;
      for (;;) {
        if (regex.test(textOf(selector))) return;
        if (Date.now() > until) throw new Error(`expected ${regex} on the page; saw: ${textOf(selector).slice(0, 300)}`);
        await wait(20);
      }
    },
    async unseen(regex, selector = "body") {
      if (regex.test(textOf(selector))) throw new Error(`did not expect ${regex} on the page`);
    },
    async count(selector) { return document.querySelectorAll(selector).length; },
    async attr(selector, name) { return document.querySelector(selector)?.getAttribute(name) ?? null; },
    async prop(selector, name) { return document.querySelector(selector)?.[name]; },
    async pick(key) { return driver.click("pick-item", `[data-key="${key}"]`); },
    async evaluate(fn, arg) { return run(async () => { const result = await fn(arg); await wait(settleMs); return result; }); }
  };
  return driver;
}

/** Play one step of a click script: before-clicks, then the block (supplied by the caller), then after-clicks. */
export async function playStep({ script, n, who = "gm", base, runBlock }) {
  const ctx = { ...base, step: n, driver: base.drivers[who] };
  await script?.before?.[n]?.(ctx);
  await runBlock(n, who);
  await script?.after?.[n]?.(ctx);
}
