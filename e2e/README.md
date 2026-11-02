# e2e/: click scripts shared by the fake-Foundry tests and the real-Foundry runner

A gate step that needs button presses in a specific order is written ONCE here, as a **click script**, and played against two targets:

| Target | Who plays it | Driver |
|---|---|---|
| the fake Foundry + jsdom window | `tests/gateNN.test.js` (this repo, CI) | `e2e/driver-dom.mjs` (this repo) |
| a real Foundry in Chromium | the private `foundry-e2e-kit` runner | its Playwright driver (same contract) |

## The contract

A script module's default export is `{ before: { [stepNumber]: async ctx => {} }, after: { [stepNumber]: async ctx => {} } }`. `before` runs the clicks that come
before the step's code block; `after` runs clicks that come after it. The block itself is the one in `docs/NN-...-gate.md`, run by the player or the runner.

`ctx` = `{ driver, drivers: { gm, player, ... }, state, extras, assert, wait, step }`

A **driver** (one per browser context / user) has: `click(action, where?)`, `set(selector, value, event?)`, `clickSelector(selector)`, `seen(regex, selector?)`,
`unseen(regex, selector?)`, `text(selector?)`, `count(selector)`, `attr(selector, name)`, `prop(selector, name)`, `pick(key)`, `evaluate(fn, arg)`.
`evaluate` runs a PURE function (no closures) inside the page; use it for anything else. `state` is a plain object that lives for one gate run.
`extras` are the target's own actions for things a script must not do directly (resize a window, script a fake dice roll, post a fake chat message, strike with a real PF2e actor).

## Rules for a script (the runner REFUSES a file that breaks them)

No `import`, no `require`, no `process`, no `fetch`, no `eval`, no `Function`. Scripts only call the `ctx` they are given. They run on the runner machine, so they are treated
as untrusted-by-construction: the runner lints each file before loading it.
