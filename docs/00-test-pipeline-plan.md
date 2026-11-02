# 00 Real-Foundry test pipeline: PLAN (Round 0, nothing built yet)

Status: **plan only, waiting for approval.** No source file was changed and no runner code exists. This document is the only thing this round adds.

Goal (Nate's rule): *anything that needs specific button presses in a specific order is tested by code. The human only judges how things LOOK, by reviewing screenshots.* The agent runs the tests and reads a few lines of result without Nate being hands-on after a one-time setup.

Words used below, in plain terms:
- **Gate**: a numbered doc in `docs/` (13 to 20) with steps; each step has a code block Nate pastes into the browser console. **Block**: one of those code blocks.
- **Runner**: a small program (Node.js + Playwright) that does what Nate does by hand.
- **Playwright**: a library that remote-controls a real browser (Chromium) from code. **Headless** = the browser runs with no visible window.
- **Browser context**: Playwright's version of an incognito window (own cookies, own login). One for the GM, one for the player "Test".
- **Self-hosted runner**: a program on your own machine that GitHub Actions hands jobs to, instead of GitHub's own servers.
- **Clone / test instance**: a second, private copy of the Foundry container, with its own port and its own User Data folder.

---

## 0. Summary and recommendations (read this first)

1. **Topology: (a), a self-hosted GitHub Actions runner** in a small unprivileged container on the same Proxmox host, outbound-only to GitHub, reaching the clone over the LAN. Reason: the test run costs zero agent usage, nothing on the LAN is exposed to the internet, and the agent only needs GitHub (which it already reaches). Option (b) (the agent's CLI on the LAN) costs more, is riskier and gains nothing (section 3).
2. **Put the runner and its config in a PRIVATE repository** (call it `foundry-e2e-kit`), not in this public one. A self-hosted runner attached to a public repo is the classic way to let strangers run code on your LAN; a private repo removes that whole class of risk, and it is also where the module-agnostic "shared test kit" should live anyway. The public module repo keeps only what it already has (the gate docs and the unit tests). Details and the fallback in section 4.
3. **Three layers inside the runner**, each cheap on its own:
   - **Block runner**: runs the existing gate blocks exactly as written, reads `PASS:`/`FAIL:` lines. Works for the 100 steps that are pure state sequences.
   - **Click-script driver**: the click orders that already live in `tests/gate18.test.js`, `gate19`, `gate20` (they click `[data-action]` buttons in a fake window). Move them into one shared "steps" module that runs against **two targets**: the fake window (today's tests) and the real page (Playwright). One script, two targets: the sequence is written once.
   - **Gallery**: deterministic screenshots at named states, for Nate to judge by eye.
4. **Two stages.** Stage A is everything that can be built and verified without the clone (config, the world-id safety check, gate parsing and block running against the existing fake Foundry, summary and gallery generation, using the real Chromium and the hostile-CSS harness pages as the stand-in target). Stage B is the real run after Nate builds the clone. Section 8.
5. **Zero-usage reading**: the run ends by writing one tiny `summary.txt` / `summary.json`. It is delivered where the agent can read it with one cheap call and **without polling** (section 9).
6. **Four questions block the start** (section 11): does the clone exist, how do GM and Test log in, GM-only or GM+Player first, and is Nate willing to make the tests repo private.

---

## 1. What exists TODAY

### 1.1 The test layers and what each one catches

| Layer | What it is | What it catches | What it cannot catch |
|---|---|---|---|
| **A. Unit and wiring tests** (`npm test`, 64 files, 1135 tests) | `node --test` against a **fake Foundry** (`tests/fake-world.js`: actors, items, flags, settings, hooks, sockets with latency, chat, a GM and two players) plus a **strict ApplicationV2 fake** (`tests/fake-application.js`, real DOM through jsdom). Runs the real `scripts/main.js`. | Logic, data validation, queue/relay behaviour, leak scans (no DC/odds to players), window click-throughs on the fake, module wiring (every import and `namespace.member` exists), docs consistency, gate docs (`tests/gate14..gate20.test.js` extract every block and run it in the fake, in order). | Anything only real Foundry does: real flag merge semantics (this hid the 0.20.1 resume bug until the fake was taught to merge), update-echo timing, socket latency, real PF2e item data and prices, real compendium (LevelDB) packs, real ApplicationV2 rendering, real permissions, real dice, real `Hooks` shapes, real CSS. |
| **B. Hostile-CSS Chromium harness** (`build/harness.mjs`, `build/layout-check.mjs`, 4 tests in `tests/hub-layout.test.js`) | Real headless Chromium (Playwright) draws every Hub and Item-editor state from the real `styles/hub.css`, on a page that imitates how Foundry restyles controls (buttons, inputs, headings, now checkboxes), at 4 widths, 3 themes, text sizes up to 175%. Checks real geometry (overflow, overlap, tap targets, clipping, mid-word breaks, narrow-editor pane heights, checkbox look). | Layout and "Foundry restyles my control" regressions, deterministically, in seconds. | The IMITATION of Foundry's CSS is only as good as my guess of it (the 0.21.1 checkbox bug shipped because I had not imitated Foundry's checkbox styling). It cannot see Foundry's real stylesheet, real fonts, the real window frame, scrolling inside the real app window, or any behaviour. |
| **C. CI** (`.github/workflows/release.yml`) | On every push to `main` and `claude/**`: `npm ci`, `npm test`, build packs, zip, publish the rolling `dev` pre-release (`module.json`, `module.zip`). GitHub-hosted `ubuntu-latest`. | A red unit-test run before a dev build is published. | **It does not run layer B.** Evidence from the real log of run #49 (v0.21.1): `# tests 1134`, `# pass 1130`, `# skipped 4`, whole test step 34 s. The 4 skips are the Chromium layout tests: `playwright` is not a declared dependency, so `launchChromium()` throws on the runner and `tests/hub-layout.test.js` skips with a message (unless `REQUIRE_CHROMIUM=1`). So the layout matrix only ever ran in the cloud workspace, never in CI. (Cheap fix, separate from this plan: add Playwright to the CI job, or run layer B on the new runner; see 3.4.) CI also cannot reach Foundry, the LAN, a licence or PF2e. |
| **D. Manual gates** (docs 13 to 20) | Nate force-reloads two real windows (GM, and an incognito one logged in as "Test"), pastes each block into the F12 console, reads `PASS:`/`FAIL:` lines and `ALL PASS`, performs the click steps and looks at the screen, sends screenshots. | Everything real Foundry shows. It found: flag-merge resume bug, relayed answers arriving in tens of ms (so the "Working..." line was wrong), the Hub status-line focus bug, the public-chat leak on a rejected share, the unusable narrow editor, the checkbox that renders wrong. | It is manual, slow, easy to mis-order, and costs Nate's time every round. |

### 1.2 How gate blocks are executed today

- Each step has **one** ```` ```js ```` block that is an async IIFE written for the F12 console (top-level `await ( async () => { ... } )();`). The block prints `PASS: ...` / `FAIL: ...` with `console.log` and **returns** `"ALL PASS"` or `"N FAILED: scroll up for the lines"` (older gates: same convention).
- `tests/gateNN.test.js` extract blocks with one regex over the doc (`^## Step N [GM]|[Player]...` then the first ```` ```js ```` fence) and run them with `(0, eval)(code)` after stripping the leading `await (` so the promise can be awaited. **The runner will use exactly the same extraction and evaluation** (Playwright `page.evaluate` awaits a returned promise), so what the fake-world tests prove runs is what runs in real Foundry.
- **Globals the blocks depend on** (all set by that gate's SETUP or helper step, all lost on a window reload):

| Gate | GM helper | Player helper | Notes |
|---|---|---|---|
| 13 | `globalThis.__gate` | `__p` | in-memory fake definitions (`gate-blade`, `gate-ore`, ...) registered by SETUP |
| 14 | `__g2` | `__p2` | |
| 15 | `__g3` | `__p3` | |
| 16 | `__g4` | `__p4` | |
| 17 | `__g5` | `__pfpObserver`, `__pfpRedraws` | MutationObserver counting Hub redraws |
| 18 | `__g6` | `__p6`, **`__p6rec`** | recorder of the Hub's status line |
| 19 | `__g7` | `__p7`, **`__p7rec`** | recorder; `p.said(/regex/)`, `p.lines`, `p.until` |
| 20 | `__g20` | none (one self-contained Player block) | `g.screen({selected, tab, confirm})` preflight reads the open editor window |

- **What is lost on a window reload:** the helper object (`__gN`), the Player recorder (a `MutationObserver` that exists only so the Hub's status line, which clears after about 10 s, can be read later), the in-memory fake definitions registered by SETUP (`api.definitions[kind].set(...)`, GM window only), any open Hub or editor window and its draft, scroll and focus. What survives: everything saved in actor/user flags, world settings, world Items (the editor's records and items), the downtime period. SETUP is written to be **re-runnable**: on a second run it takes an "already set up" path that rebuilds `__gN` and re-registers the fakes. The Player must also call `api.definitions.refresh({ force: true })` after the GM changes definitions (the helper steps do).
- **Opening windows:** blocks never open the Hub or editor for you; the click steps say "press the scene-controls button". Programmatic equivalents exist and are what the fake tests use: `game.modules.get("pathfinder-progress").api.hub.open(actor)` and `api.discovery.openEditor(key)`. The real buttons (scene controls, sheet headers) are worth clicking once per gate as an entry-point check.

### 1.3 Every gate step: automate, or judge by eye?

Classes: **A** = pure state/API step (a block alone; no clicks, no screen). **B** = clicks then a block that checks state or the screen (fully automatable with Playwright clicks on `[data-action]`; the click sequences already exist in the gate tests for 18, 19 and 20). **S** = like B plus Nate is asked for a screenshot (automate the clicks and the block, **capture the screenshot for the gallery**). **C** = no code block: a "look at the screen" step or a manual action (log the GM out).

| Gate | Steps | A (just run the block) | B (clicks + block) | S (clicks + block + screenshot) | C (look / manual) |
|---|---|---|---|---|---|
| 13 | 25 | 1-25 | none | none | none |
| 14 | 31 | 1-3, 5-31 | 4 | none | none |
| 15 | 18 | 1-9, 11, 13, 15, 17-18 | 10, 12, 14, 16 | none | none |
| 16 | 22 | 1-17, 19-22 | 18 | none | none |
| 17 | 40 | 1-3, 13, 15, 17, 19, 21, 24, 27, 29-32, 40 | 28 | 4-5, 11, 33-34, 37 | 6-10, 12, 14, 16, 18, 20, 22-23, 25-26, 35-36, 38-39 |
| 18 | 25 | 1-2, 6-7, 12, 14, 18, 25 | 3, 5, 8-11, 13, 15, 17, 19-20, 22-23 | 4, 16, 24 | 21 |
| 19 | 17 | 1-2, 6, 8, 10, 12-13, 17 | 3, 5, 9, 11, 16 | 4, 7, 14 | 15 |
| 20 | 27 | 1, 9, 14, 19, 21-22, 27 | 2, 4-8, 10-13, 15-18, 23, 26 | 3, 20, 24-25 | none |

(Classified by script from the gate docs: a step is B if its instructions contain click verbs or its block reads the screen; S if it asks for a screenshot; C if it has no block. Treat it as a first cut; Stage A confirms each step by running it.)

What this means:
- **Gates 13 to 16 (96 steps) are entirely API-level**: GM block, Player block, GM block... They need two logged-in browser contexts and nothing else. This is the cheapest, most valuable first target.
- **Gate 17 (40 steps)**: 24 steps are "look at the screen" with the expected text written in "You should see:" bullets. Today they have no automation even in the fake. Plan: **screenshot every one of them for the gallery**, and turn the "You should see" strings into DOM-text assertions where the bullet quotes exact text (Stage B2, only where cheap; a text assertion never replaces the eye on layout).
- **Gates 18 to 20**: click sequences already exist as code in the gate tests; the runner reuses them (section 2.2).
- **Gate 18 step 21** (class C) is a GM click in the queue review window ("reject it THROUGH THE QUEUE WINDOW, a click, not code"): automatable by clicking that window's own `data-action` buttons, so it joins the click-script layer rather than the look-only pile.
- **Visual-only judgements stay with Nate**: font, spacing, colour, "does it look right", and anything that needs real eyes on a real window. The runner's job is to put these in front of him as organised screenshots, not to decide.

### 1.4 What the runner will assert beyond the blocks (cheap, generic)

Every gate run also checks: no uncaught `pageerror` and no `console.error` from the module (a whitelist file for known Foundry noise); the module version in the page equals the deployed version; `game.system.version` and `game.version` equal the config's expected values; **no chat message in `game.messages` carries a DC, a roll total or a percentage** (the project's own rule, scanned on the real data with the same regex the tests use); **a Player context never sees `api.definitions.material.get(...).effects`** (the relay audit steps already do this).

---

## 2. Design

### 2.1 Principles

1. **Reuse, don't rewrite.** The doc extraction regex, the block evaluation trick and the click scripts already exist and are proven in the fake world.
2. **Fail loudly, clean up always.** Exit code non-zero on any `FAIL:`, any step timeout, any uncaught page error. CLEANUP is in a `finally`; if CLEANUP itself fails, a second layer (restoring the pristine world, 5.4) still guarantees a clean next run.
3. **Deterministic or it is not a test.** Fixed viewport, fixed device scale, reduced motion, wait for `document.fonts.ready`, fixed Hub display setting per screenshot, same pinned Playwright and Chromium on the same runner image every time.
4. **The config is data.** Module id, world id, users, gate files, step selections, screenshot list, selectors: all in a JSON config, so a second module is a second config file.

### 2.2 One click script, two targets

Today `tests/gate20.test.js` contains helpers such as `click("new-material")`, `set('[data-field="create"][data-name="name"]', "Gate G20 Fang")`, `seen(/Made Gate G20 Fang/)`. The proposal is a small **driver interface** (`click(action, where)`, `set(selector, value, event)`, `text()`, `seen(regex)`, `expectPass(step)`), implemented twice:
- the jsdom driver (what the tests do now, with fixed `wait(25)` sleeps), and
- the Playwright driver (real clicks on the same `[data-action]` selectors with auto-waiting instead of sleeps).

The step sequences move into `e2e/steps/gateNN.steps.mjs`, imported by both the fake-world test and the real runner. This is the one refactor of existing tests in the plan; it is behaviour-preserving and every existing assertion stays.

### 2.3 Where the work runs

```
Nate/agent push or "run" button  ->  GitHub  ->  self-hosted runner (LXC on the Proxmox host)
                                                   |  1. checkout the module branch (read-only) + kit
                                                   |  2. build packs, deploy into the CLONE's modules folder  (restricted SSH command)
                                                   |  3. restart the clone, restore the pristine test world
                                                   |  4. Playwright: GM context + Player context -> http://clone:30001
                                                   |  5. run gates, capture screenshots, write summary + gallery
                                                   v  6. upload artifacts + post the compact summary where the agent reads it
```

---

## 3. Topology comparison

### 3.1 (a) Self-hosted GitHub Actions runner on the Proxmox host (recommended)

- **Setup effort**: one small LXC or VM (Debian, Node 22, Playwright + Chromium, git), register it once with a token from GitHub, add a firewall rule set. About an evening, once. Then rebuildable from a Proxmox snapshot or template.
- **Security**: outbound-only connection to GitHub (the runner polls GitHub; nothing connects in). The LAN is not exposed. Risk is confined to "code that GitHub tells the runner to run", which section 4 closes down.
- **Agent usage cost**: **zero for the run** (plain scripts). The agent pays only to trigger (one API call) and read the summary (one small read).
- **Agent access**: the agent already uses GitHub's API tools (list/read/trigger workflows, read files, subscribe to PR activity). No new network path, no secret handed to the agent.
- **Weak points**: GitHub must be reachable from the runner; runner updates; one more machine to keep patched.

### 3.2 (b) The agent's CLI in a container on the LAN, running tests locally

- **Setup effort**: higher. Install and authenticate the agent CLI inside the container, expose it to a trigger path (SSH? chat?), decide where API credentials live.
- **Security**: worse. An LLM-driven process with a shell on a LAN that also holds Foundry, driven by text that can include untrusted content (issue bodies, file contents): a prompt-injection surface next to your servers. Credentials for the agent service sit on the LAN box.
- **Usage cost**: every run is an agent session; even if the tests are plain scripts, the agent is the thing running and watching them, so you pay for the waiting and the reading. This is exactly what the rule "the test run must cost zero agent usage" rules out.
- **What it would buy**: the agent could poke at the live Foundry interactively (explore a failing state). That is real value, but it can be had later as an *optional* interactive mode (a one-off, not the pipeline).

### 3.3 Verdict

(a), with the runner and kit in a private repo (section 4). (b) is not recommended for the pipeline; revisit only as an interactive debugging aid.

### 3.4 Side finding to fix separately: CI does not run the layout harness

Either add `npx playwright install --with-deps chromium` and a `playwright` devDependency to the existing GitHub-hosted job (adds a few minutes, no LAN needed), or run layer B on the new runner as a gate before the real-Foundry run. Not part of Round 0; recorded so it is not lost.

---

## 4. Security (the module repo is PUBLIC)

The danger: a self-hosted runner on a public repo will run whatever a workflow says, and a stranger's pull request can change the workflow. Everything below is required; the first item removes most of the risk by itself.

1. **Runner attached to a PRIVATE repo only.** The kit repo `foundry-e2e-kit` (private) owns the workflow and the runner. It checks out the public module repo's branch as plain read-only *data* (the module's scripts and docs are copied into the clone and executed by Foundry's browser pages, and the gate blocks run inside the clone's browser, not on the runner's shell). Strangers cannot open pull requests against a private repo, and cannot trigger its workflows.
   - **If Nate refuses a private repo**: keep everything in the public repo, but then *all* of the following must hold, and I would call the residual risk "acceptable but not comfortable".
2. **No pull-request triggers.** The workflow's `on:` is only `workflow_dispatch` (manual/agent trigger) and, if wanted, `push` restricted to Nate's own branches (`claude/**`, `main`). There is no `pull_request` or `pull_request_target` trigger at all. In repo settings (Actions, General): "Fork pull request workflows from outside collaborators" set to *Require approval for all outside collaborators* (or runs disabled for forks).
3. **Actor guard in every job**: `if: github.repository == 'Nate-Krialia/<kit repo>' && github.actor == 'Nate-Krialia'` (agent pushes already appear as Nate-Krialia in the run list, so this does not block the agent).
4. **Runner isolation**: unprivileged LXC (or a small VM), non-root user, no Docker socket, no access to the Proxmox API, no shared folders with Foundry except what the restricted deploy command allows. **Firewall (PVE firewall on the container)**: egress allow-list = GitHub (github.com, api.github.com, `*.actions.githubusercontent.com`, the Actions artifact and blob hosts), the package registries only during image build (npm, Playwright CDN), and **the clone's IP and port only**. Everything else dropped, including the rest of the LAN, the production Foundry, and Proxmox's management port. Ingress: none.
5. **Rebuildable**: a Proxmox snapshot of the clean runner; optionally an `--ephemeral` runner (it takes one job, then deregisters; a small script restores the snapshot and re-registers). A compromised runner is then a restore, not a clean-up.
6. **No secrets in any repo.** Foundry passwords ("access keys") and the optional admin password live only in a root-owned, mode-0600 environment file on the runner (`/etc/foundry-e2e/env`), read by the runner process; nothing is passed through GitHub Secrets (so even a workflow edit cannot exfiltrate them through GitHub), and the config files hold only the *names* of environment variables. The runner redacts those values from every log and from every artifact.
7. **The deploy path is narrow.** The runner reaches the clone host through **one SSH key restricted with `command="/usr/local/bin/pfp-deploy"`**: the only things it can do are "stop the test Foundry, restore the pristine world, copy the module in, start it". No shell, no other paths.
8. **Pin and review**: third-party actions pinned by commit SHA; Playwright pinned to one version; the runner image rebuilt from a documented script, not by hand.
9. **The world-id guard** (section 5.2) is a second, independent fence: even if everything above failed, the runner refuses to act on any world that is not the dedicated test world, and refuses any URL that is not on the allow-list.
10. **Foundry's licence terms**: Foundry's FAQ allows a second private instance on one licence as long as nobody else can reach it past the login screen. That means: no port-forward, no reverse proxy entry, no DNS name on the internet, firewalled from everything except the runner and Nate's own machine, and the test accounts' access keys stay private. (Nate confirms by reading the FAQ himself; I am restating the rule as he gave it.)

---

## 5. How a run works (detail)

### 5.1 Signing in as GM and as "Test"

- Two Playwright contexts from one headless Chromium: `gm` and `player`. Fresh contexts every run, so nothing is cached (this is the automated "force reload both windows").
- For each: open `${baseUrl}/join`, choose the user in the user dropdown by its visible name, type the access key from the environment, press Join, then wait until `await page.waitForFunction(() => globalThis.game?.ready === true)`.
- **To verify in Stage B discovery (I cannot see v14.369 from here)**: the exact selectors of the join page (in v10 to v13 these were `select[name=userid]`, `input[name=password]`, `button[name=join]`), and whether v14 changed them. Stage B starts with a throwaway discovery script that logs the join page's form controls to the config once. Everything after that uses `game.ready` and the module's own `[data-action]` selectors, which we control.
- **One session per user**: Foundry will not let the same user join twice. If a crashed run left a session, the next login is refused. Handling: the deploy step restarts the clone before every run (this also clears it), and the runner calls `game.logOut()` in `finally`.

### 5.2 The safety check (before anything is changed)

The runner reads the truth from the **page**, not from config: after login it evaluates `game.world.id`, `game.world.title`, `game.user.name`, `game.version`, `game.system.id/version`, `location.origin`, and refuses unless **all** of these hold:
- `location.origin` is exactly one of the config's `allowedOrigins` (the clone's address and port);
- `game.world.id` equals `config.target.worldId` **and** the world title starts with the configured test prefix;
- the logged-in user names are the configured GM and Player names, and `game.users.size` is no more than a small configured maximum (a world with a lot of real users is not the test world);
- Foundry and system versions equal the expected ones (a mismatch is a warning, not a refusal, so an upgrade does not brick it);
- there is no real campaign data in the way: SETUP's existing refusals ("a real actor named like a gate one", "downtime open", "queue not empty") already stop the run, and the pristine-world restore makes them moot.
It also refuses to start if `config.target.denyOrigins` contains the origin (a list of the production Foundry's addresses, kept in the runner env, never in the repo). Unit-tested in Stage A, including mutation tests (a world id off by one character, a wrong port, a missing prefix must each be refused).

### 5.3 Getting the branch into the clone

- The runner checks out the module branch at the requested SHA, runs `npm ci` and `npm run build:packs` (packs are gitignored and built from `content/` by `@foundryvtt/foundryvtt-cli`; the existing CI does the same), and calls the restricted `pfp-deploy` command on the clone host, which: (1) stops the test Foundry process/container, (2) restores the **pristine world folder** (and wipes the module's old folder), (3) copies `module.json scripts styles packs README.md` into `Data/modules/pathfinder-progress/`, (4) starts Foundry with the test world auto-launched.
- **Why stop Foundry first**: the packs are LevelDB folders with `LOCK` files; copying them under a running Foundry is unsafe, and a changed `module.json` (new packs, scripts) needs a server restart anyway.
- Alternative rejected: installing through the module's manifest URL (the rolling `dev` release). It races with the next push (the `dev` tag is overwritten by every build) and cannot test an arbitrary SHA. The runner deploys its own build of the exact SHA instead.
- The clone must already have the **PF2e system** (8.6.1) and the **socketlib** module installed (the module requires it), and the module enabled in the test world (done once, by Nate, and preserved in the pristine world).

### 5.4 The world and the clean-state guarantee

- A dedicated world, e.g. id `pfp-e2e`, title starting `E2E`, with: the GM user, the player user `Test` (a Player role), PF2e, socketlib and the module enabled, and no real characters.
- A **pristine copy** of that world's folder is kept next to it. Every run starts by restoring it (`rsync --delete`). That is the safety net under CLEANUP: even if a step crashes and CLEANUP cannot run, the next run is still clean. CLEANUP still runs, in `finally`, because it is also a test (the gates assert `problems: []`).
- Between gates inside one run the world is left as CLEANUP leaves it; each gate begins with its own SETUP.

### 5.5 Running a block, and reloads

- The block runner evaluates the gate block in the right context (`gm` or `player`), listening to `page.on('console')` for the duration so `PASS:`/`FAIL:` lines are captured per step, with the returned string (`ALL PASS` or `N FAILED`) as the verdict. A step has a timeout (default 30 s, per-step override in config).
- **Reload rule**: the runner never reloads a page in the middle of a gate unless the gate says so. After any reload it re-runs that gate's SETUP (GM) and helper step (Player) to rebuild `__gN` and the recorder; the config lists them per gate (`helperSteps`). Because the recorder disappears with the page, the runner can also install an init script (`page.addInitScript`) that re-creates the status-line recorder on every page load, so a reload never loses it. (Stage B decision: init script, or re-run the helper step. The helper step is simpler and matches what Nate does.)
- **"No GM connected" steps** (gate 19 steps 15 and 16): the runner **closes the GM context**, runs the Player steps, then opens a new GM context, logs in, and re-runs SETUP's "already set up" path. This automates the one scenario that is the most awkward by hand.
- **Timing**: after a GM action that the Player must see, blocks already call `api.definitions.refresh({ force: true })`. For click steps the Playwright driver waits on state (`expect.poll` on the page's text or on `api.definitionsStatus()`), never on fixed sleeps. The 10-second status line is read through the recorder (`p.said(/regex/)`), not by racing a screenshot.

### 5.6 Screenshots and the gallery

- Fixed viewport per shot (config: e.g. 1280x900 for the Hub window, 420x900 for the narrow editor), `deviceScaleFactor: 1`, `reducedMotion: "reduce"`, `colorScheme: "dark"`, `document.fonts.ready` awaited, and the Foundry canvas hidden or blurred so a moving map never enters a diff (a `page.addStyleTag` that hides `#board`; the Hub is a window, not canvas).
- **What is shot, by name** (config `screenshots`, one entry each): gate, "after step N", target (a CSS selector for the window, e.g. `.pfp-hub-window`), and a matrix: themes `parchment | dark | contrast` x text sizes `100 | 175` where the state is visual (the runner sets the Hub's own display setting through `game.settings.set("pathfinder-progress", HUB.displaySetting, {...})` before the shot, the same setting the Hub's own display buttons write). Initial list (Stage B): Hub Formulae tab, Research tab, Compendium tab; each gate-17 "look" step; gate 18/19 screenshot steps; the Item editor wide and at about 400 px wide (tall and short), the three preview stages, the Persistent checkbox unticked and ticked.
- Output: a folder `gallery/` with `index.html` (static, no server, opens from a file or an artifact), one thumbnail per image grouped by gate and step with the caption copied from the gate doc ("Gate 20 Step 24: the narrow layout"), a link to the full image, and a `?compare` layout showing the previous run's image beside the current one when the previous run's folder is available (same name, same viewport). Nate scrolls it and says "good" or "bad" per image; the agent never needs the images.

### 5.7 Headed or headless

**Headless** by default (no display on the runner). Foundry's canvas needs WebGL; headless Chromium provides it in software (SwiftShader), pinned by Playwright flags. A **headed debug mode** is available with `xvfb-run` for a person watching, off by default. On any failure the runner saves a Playwright **trace** (a zip: DOM snapshots, network, console) for that step only, plus the failure screenshot; these are artifacts, never part of the summary.

---

## 6. Risks and how each is handled

| Risk | Handling |
|---|---|
| **Flaky timing** (a relay answer lands in tens of ms; an update echo arrives later than a handler) | Never use fixed sleeps in the driver; wait on state with a timeout (`expect.poll`). Keep the gates' own `refresh` calls. A failed step is retried **once at the step level only if the step is marked `idempotent`**, otherwise the run records the failure and continues to CLEANUP; a retry is reported as "flaky" in the summary, never hidden. |
| **Foundry restyling controls** (buttons, inputs, checkboxes) | The real run is exactly the check the hostile harness cannot make; screenshots plus a `getComputedStyle` probe on named controls (the Step 25 `STYLE` line is the model) go in the gallery. |
| **Reloads lose helper state** (`__gN`, recorder, fake definitions) | Section 5.5: no mid-gate reloads unless the step says so; re-run SETUP and the helper step after one; optional init-script recorder. SETUP is already re-runnable. |
| **The status line auto-clears after about 10 s** | Read through the recorder, never a screenshot race. A shot of a transient line is taken by the recorder's callback or after re-triggering the action, not by timing. |
| **A step needs a state the earlier steps left** (gates are ordered) | The runner runs a gate top to bottom in one browser session; "run only steps N to M" is allowed only where config says the step is self-contained (the gate 20 new-steps rule), and always preceded by that gate's SETUP. |
| **A failed step leaves data behind** | CLEANUP in `finally`; world restore at the start of the next run; the SETUP refusals ("an earlier run left ...") as the third fence. |
| **Session already logged in** | Restart the clone before each run; `game.logOut()` in `finally`. |
| **v14 selectors differ from what I remember** | Stage B discovery script records them into config once; the rest of the runner depends only on `game.ready` and our own `data-action` attributes. |
| **Canvas/WebGL unavailable in the container** | Verify in Stage B discovery; fall back to the client setting that disables the canvas (the module's gates do not need it, but the scene-based exploration steps create tokens, so I would test that the gates still pass with it off; if not, keep software WebGL). |
| **Screenshots differ between machines** (fonts, antialiasing) | One pinned runner image; the gallery is for human review, not pixel diffs. The "compare" view is advisory. No pixel-diff gate in v1. |
| **The runner dies mid-run / hangs** | Job timeout; the deploy step's restore makes the next run clean; the summary reports `status: "aborted"` with the last step. |
| **A gate doc changes and a step silently stops being run** | The runner asserts the step list it parsed equals the config's expectation for each gate (`stepCount`), and fails loudly on a mismatch; the doc test already guards the doc's format. |
| **Secrets leak into artifacts** | Redaction pass on logs and the trace files; passwords are never passed to the page except by typing them into the login form. |
| **Test world gets stale vs the real one** | It is a throwaway; its only job is to run the gates. The pristine world is rebuilt whenever Foundry or PF2e is upgraded (a documented 10-minute task). |

---

## 7. Proposed files, commands, config, outputs

### 7.1 File layout (in the private `foundry-e2e-kit` repo; the public module repo keeps its docs and unit tests)

```
foundry-e2e-kit/
  kit/                         module-agnostic engine (the part to share later)
    run.mjs                    CLI entry
    config.mjs                 load + validate config; resolve env secrets by NAME
    safety.mjs                 world / origin / user guard (+ its tests)
    foundry.mjs                login, game.ready wait, context management, logOut
    gate-doc.mjs               parse docs/NN-...gate.md into steps (the existing regex)
    block.mjs                  run one block in a page, capture PASS/FAIL, timeout
    driver.mjs                 click/set/seen/expectPass interface + Playwright adapter
    shots.mjs                  deterministic screenshot rules
    report.mjs                 summary.json / summary.txt / gallery/
    deploy.mjs                 call the restricted deploy command, restore pristine world
    redact.mjs                 secret redaction
  modules/
    pathfinder-progress/
      config.json              non-secret config (this module)
      steps/gate18.steps.mjs   click scripts shared with the module's jsdom tests
      steps/gate19.steps.mjs
      steps/gate20.steps.mjs
      screenshots.json         the named screenshot list
  tests/                       unit tests for the kit (fake page, fake clock, no Foundry needed)
  .github/workflows/e2e.yml    workflow_dispatch + restricted push, self-hosted runner
  docs/SETUP.md                Nate's one-time guide (section 10 below)
  .env.example                 variable NAMES only, no values
```
The click scripts are written once and consumed by both repos: the module repo's tests import them through a small published path (git submodule, or the steps are simply kept in the module repo under `e2e/steps/` and the kit imports them by path from the checked-out module). **Recommendation: keep `steps/` in the public module repo** (they are test code for that module, they already live next to the gate tests, and they contain only throwaway "Gate ..." data), and keep only the engine, the config with hostnames, and the workflow in the private kit.

### 7.2 Commands

```
npm run e2e                          all gates, GM + Player
npm run e2e -- --gates 20            one gate
npm run e2e -- --gates 20 --steps 22-27
npm run e2e -- --check-config        Stage A: validate config + safety only, touch nothing
npm run e2e -- --dry-run             Stage A: parse the gate docs, print the plan, no browser
npm run e2e -- --headed              debug (needs xvfb or a display)
npm run e2e -- --shots-only          just the gallery states
```
Exit codes: `0` all PASS, `1` any FAIL or timeout, `2` safety refusal, `3` setup/infrastructure problem (could not log in, deploy failed). The agent distinguishes "my code is wrong" (1) from "the lab is broken" (2/3) at a glance.

### 7.3 Config shape (non-secret; module-agnostic)

```jsonc
{
  "module":  { "id": "pathfinder-progress", "repo": "Nate-Krialia/pathfinder-progress",
               "deployInclude": ["module.json", "scripts", "styles", "packs", "README.md"],
               "buildCommands": ["npm ci", "npm run build:packs"] },
  "target":  { "allowedOrigins": ["http://FOUNDRY-TEST-HOST:30001"],          // names/addresses of the CLONE only
               "denyOriginsEnv": "PFP_E2E_DENY_ORIGINS",                       // production addresses live in the runner env
               "worldId": "pfp-e2e", "worldTitlePrefix": "E2E",
               "expect": { "foundry": "14.369", "system": "pf2e", "systemVersion": "8.6.1" },
               "maxUsers": 6 },
  "users":   { "gm":     { "name": "GM",   "accessKeyEnv": "PFP_E2E_GM_KEY" },
               "player": { "name": "Test", "accessKeyEnv": "PFP_E2E_TEST_KEY" } },
  "gates": [
    { "id": 20, "doc": "docs/20-stage11d-gate.md", "stepCount": 27, "setup": 2, "cleanup": [21, 27],
      "helperSteps": [], "contexts": ["gm", "player"], "stepsSelfContained": "22-27", "steps": "all" },
    { "id": 19, "doc": "docs/19-stage11c-gate.md", "stepCount": 17, "setup": 2, "cleanup": [17], "helperSteps": [3], "contexts": ["gm", "player"] }
  ],
  "screenshots": "modules/pathfinder-progress/screenshots.json",
  "limits":  { "stepTimeoutMs": 30000, "runTimeoutMin": 45 },
  "viewport": { "width": 1280, "height": 900 },
  "output":  { "dir": "e2e-out" }
}
```

### 7.4 Secrets handling

- Repo: names only (`PFP_E2E_GM_KEY`, `PFP_E2E_TEST_KEY`, optional `PFP_E2E_ADMIN_KEY`, `PFP_E2E_DENY_ORIGINS`). `.env`, `e2e-out/`, `gallery/` and any `*.env` are gitignored in both repos; a unit test greps the whole repo for the strings "password", a 16+ character secret-looking value and the configured access keys, and fails if any is found.
- Runner: `/etc/foundry-e2e/env`, owner root, mode 0600, loaded by the runner service; never echoed (`set +x`, redaction on).
- The agent never sees any value.

### 7.5 The compact summary (what the agent reads)

`summary.txt` (about 10 to 30 lines, always the same shape) and the same data as `summary.json`:

```
E2E pfp-e2e @ 2e9eb0f  v0.21.2  2026-11-02T06:10Z  duration 14m  STATUS FAIL
gate 13  25/25  PASS
gate 14  31/31  PASS
gate 15  18/18  PASS
gate 16  22/22  PASS
gate 17  40/40  PASS   (24 look-steps shot)
gate 18  24/25  FAIL   step 9
gate 19  17/17  PASS
gate 20  27/27  PASS
cleanup  OK  world restored
-- failures ------------------------------------------------------------
gate 18 step 9 [Player] "the lead card": FAIL: Studying this can teach you...  (expected /.../)
  shot: failures/g18-s09.png   trace: failures/g18-s09.zip
-- warnings: 1 flaky retry (gate 17 step 28) ; 0 console errors ; 0 chat leaks
gallery: <artifact link>   (full logs and all screenshots are in the artifact, not here)
```
- **Per gate:** PASS or FAIL, `passed/total`. **Details only for failed steps**: who, step, the failing `FAIL:` line(s) trimmed to one line each, and the names of the failure screenshot and trace. Nothing else.
- Exit-code-style one-word `STATUS` on line 1 (`PASS | FAIL | REFUSED | ABORTED`).
- All screenshots are saved for the gallery; **only failure screenshots** are referenced from the summary.

### 7.6 The gallery

`gallery/index.html` plus `images/`, built by `report.mjs`: sections per gate and step, thumbnails, full-size links, the caption from the gate doc, theme and text-size badges, a pass/fail badge for the step beside its image, and an optional previous-run comparison. It is one folder, uploaded as one artifact, opened by double-clicking `index.html`. Nate's judgement is recorded by him replying with the image names that look wrong; the agent turns those into fixes.

---

## 8. Staged build order

### Stage A: no clone needed (build and verify in the cloud workspace)

| # | Piece | How it is verified without Foundry |
|---|---|---|
| A1 | Config loader and validator (schema, env-name resolution, redaction) | unit tests; a missing variable, an unknown key, a secret-looking value in the file are each rejected |
| A2 | Safety guard (`safety.mjs`) | unit tests with a fake page: right world passes; wrong id, wrong prefix, wrong origin, a denied origin, too many users, a missing user are each refused; mutation tests prove each rule matters |
| A3 | Gate doc parser (`gate-doc.mjs`) | run against docs 13 to 20: step counts and classes match section 1.3; a doc with a dropped step fails the `stepCount` check |
| A4 | Block runner (`block.mjs`) against **the existing fake Foundry** through a `FakePage` adapter that implements `evaluate` and `on('console')` | the runner reproduces what `tests/gateNN.test.js` already proves: every block of every gate returns `ALL PASS`; a deliberately broken block exits 1; CLEANUP still runs after a failing step; a timeout is reported, not hung |
| A5 | Driver + shared click scripts (`steps/gateNN.steps.mjs`) with the jsdom adapter | the existing gate 18/19/20 tests are switched to the shared scripts and stay green (a pure refactor) |
| A6 | Summary writer and the failure-only attachment rule | golden-file tests of `summary.txt`/`.json` for PASS, FAIL, REFUSED, ABORTED |
| A7 | Gallery generator and screenshot rules | run with real Chromium (already available in the cloud workspace) against the **hostile-CSS harness pages** as the stand-in target: produces a real gallery of Hub and editor states at 100% and 175% and three themes; checks determinism by rendering twice and comparing bytes |
| A8 | `--check-config`, `--dry-run`, exit codes | CLI tests |
| A9 | Workflow YAML and the runner setup script, both **written but not enabled**, plus `docs/SETUP.md` (section 10) | reviewed by Nate; the YAML is linted (`actionlint`) in CI |
| A10 | **Discovery script** (read-only) that Nate runs once against the clone in Stage B to learn the real join-page selectors, `game.ready` timing, WebGL availability | n/a until Stage B |

What Stage A delivers: a runner that is fully tested against fakes and a stand-in page, and a gallery Nate can already look at (from the harness) to confirm the format is what he wants.

### Nate's work between the stages (one time, section 10)

Create the clone and the test world with the two accounts; create the runner container; register the runner; set the firewall rules; put the secrets file on the runner; create the private repo and settings; give the agent the answers to section 11. Estimated: an evening.

### Stage B: the real Foundry

| # | Piece | Exit criterion |
|---|---|---|
| B0 | Run the discovery script; record selectors, `game.ready` time, WebGL result, the canvas setting; fix config | a one-page report |
| B1 | Deploy path: restricted SSH command, stop/restore/copy/start, world auto-launch | the module loads in the clone (version string matches the SHA) |
| B2 | Login for GM and Player; the safety check against the real page | a no-op run prints the world id and exits 0; pointing the config at a wrong world id exits 2 |
| B3 | **Gates 13 to 16** (all API-level, 96 steps) | all PASS, or real failures investigated: these are the first time these blocks have run unattended; expect some timing issues |
| B4 | **Gate 20, then 19, then 18**: shared click scripts on the real page | all PASS; screenshots at the named states |
| B5 | **Gate 17** (look-steps): screenshots for all 24, text assertions where the bullets quote text | gallery reviewed by Nate |
| B6 | Summary delivery and the agent's single read (section 9); artifacts | the agent triggers once and reads the summary once |
| B7 | Stabilise: flaky-step list, retry policy, the CI-side Playwright fix (3.4), docs for extraction to a shared kit | three consecutive green runs from a cold clone |

---

## 9. Usage cost, and how the agent gets the result without polling

- The run is plain scripts on the runner: **zero agent usage**.
- **Trigger**: the agent calls the GitHub API to run the workflow (`workflow_dispatch`) once, passing the module repo, ref and gate list. (Needs access to the private repo; it is added to the agent's session scope with `add_repo`, which needs Nate's approval once.)
- **Delivery of the result, three channels, all produced by the same final workflow step:**
  1. **A check run on the module repo's commit** (created with the workflow's token through the Checks API) whose *output summary* is the compact `summary.txt`. If the agent is subscribed to that branch's pull request, a check result **wakes the session with the summary text**: no polling at all. (Needs a pull request for the branch; the project rule is that I open none unless Nate asks, so this is an option Nate switches on by asking for one long-lived draft PR as the "e2e sandbox".)
  2. **A file on a results branch** of the kit repo (`results/<sha>.txt`, the same 10 to 30 lines). The agent reads it with one cheap file read.
  3. **Artifacts**: the full logs, all screenshots and the gallery, for Nate (and the agent only if it chooses to download a single failure image).
- **No polling, ever**: the agent triggers, then ends its turn; it either wakes on the check-run event (1) or does one scheduled check-in (the platform's `send_later` once, about the expected run length, then reads (2) once). It never loops on status.
- **What stays small**: the summary has a fixed shape and a hard length cap (about 40 lines): per-gate verdicts, and details only for failures; logs are never inlined.
- Rough per-run reading cost: a handful of lines (a few hundred tokens), against thousands for pasting a gate's output by hand.

---

## 10. One-time setup guide for Nate (Proxmox), in order

Plain-language terms first:
- **Proxmox**: the program that runs your containers/VMs. **LXC container**: a light "mini computer" inside Proxmox (shares the host's kernel). **VM**: a full virtual computer (a bit heavier, a bit safer). **Clone**: an exact copy of an existing container. **Snapshot**: a saved moment you can roll back to. **Template**: a container you can stamp copies from. **Firewall (PVE firewall)**: Proxmox's per-container network rules. **Access key**: Foundry's word for a user's password. **User Data folder**: where Foundry stores worlds, modules and settings. **Self-hosted runner**: a little service that takes jobs from GitHub and runs them on your machine. **Port**: the number after the colon in an address (Foundry's default is 30000).

> Keep this order. Each step is short. Anything that says "write it down" goes into your password manager, not into any repo or chat with me.

### Part 1: the private test Foundry

1. In Proxmox, **take a snapshot of your normal Foundry container** (name it `before-test-clone`). This is your undo button.
2. **Clone** the Foundry container: right-click it, Clone, mode **Full Clone**, name it `foundry-test`. A full clone has its own disk, so it can never touch your real data. Do **not** start it yet.
3. In the clone's settings, open **Network** and give it its own IP address (or a different DHCP reservation) so it is never confused with the real one. Write the new address down.
4. Start the clone. Open it in a console and find where Foundry's **User Data** folder lives and how Foundry is started (a Docker image? a systemd service? which port?). Write it down for me (this answers Question 2 in section 11).
5. Change the clone's **port** to a different one, for example `30001`, so even by accident it cannot collide with the real instance.
6. **Licence**: Foundry's FAQ allows a second private instance on one licence **only if nobody else can reach it past the login screen**. So: no port forwarding, no reverse-proxy entry, no public DNS name for it. Read the FAQ line yourself and tell me you are comfortable.
7. In the clone's **User Data**, make the test world (next part) and remove (or never copy) your real worlds: in the clone, delete worlds you do not need. A clone that holds no real campaign is also the safest clone.

### Part 2: the test world and the two accounts

8. Log in to the clone's `/setup` page (the Foundry admin page). Create a new world: title `E2E Gate World`, id `pfp-e2e` (the id is the folder name; it must match the config), system **Pathfinder Second Edition** (8.6.1).
9. In the clone, install the module **socketlib**, and install this module (the `pathfinder-progress` development build; the runner will overwrite it each run). Launch the world once.
10. In the world, open **Game Settings, Manage Modules**: enable **socketlib** and **Pathfinder Progress**.
11. Create exactly two users: a **Gamemaster** called `GM`, and a **Player** called `Test`. Give each an **access key** (Foundry's password for that user). Make them long and random, different from any real password. Write both down.
12. Log in once as `GM` and once as `Test` in a private browser window to confirm both can join. Log out of both.
13. **Stop the world and take a copy**: on the clone's host, copy the whole world folder `Data/worlds/pfp-e2e` to `Data/worlds-pristine/pfp-e2e` (same disk, outside `worlds`). This is the "pristine" copy the runner restores before every run. Then take a **Proxmox snapshot** of the clone called `pristine`.

### Part 3: the runner

14. Create a new small **LXC container** (Debian 12, 2 CPU, 4 GB RAM, 20 GB disk), name `e2e-runner`, **unprivileged** (the default), with its own IP. Do not give it any "features" (no nesting, no fuse).
15. Inside it: create a normal user `runner` (no sudo), install Node 22, git, and the Chromium that Playwright wants (a script I will give you does this and pins the versions).
16. In the **GitHub private repo** (the kit repo): Settings, Actions, Runners, **New self-hosted runner**: GitHub shows a few commands and a one-time token; run them inside the container as user `runner`. Give it the label `pfp-e2e`. Turn on `--ephemeral` if you want a fresh runner per job.
17. Create `/etc/foundry-e2e/env` as root, mode `600`, with the variable **names** from `.env.example` and the **values** you wrote down in step 11 (and the production addresses to deny).
18. Make the restricted deploy key: on the runner, create an SSH key for user `runner`; on the **clone host**, add its public key to the deploy user's `authorized_keys` as `command="/usr/local/bin/pfp-deploy",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA...`. I will provide `pfp-deploy` (stop Foundry, restore pristine world, copy the module, start Foundry).
19. **Snapshot** the runner (`runner-clean`).

### Part 4: the firewall

20. On the **runner container**, Firewall tab, turn the firewall **on** and set the **Output policy to DROP**. Add ACCEPT rules for: GitHub's addresses (an alias `github` that I will list), DNS to your router, and **the clone's IP and port only**. Input policy DROP, no input rules.
21. On the **clone**, allow inbound on its Foundry port **only from the runner's IP and from your own computer's IP**, nothing else.
22. On your router, confirm there is **no port forward** to the clone. (Check once, write it down.)
23. Test: from the runner, `curl` the clone (works), `curl` your real Foundry (must **fail**), `curl` github.com (works), `curl` anything else (fails).

### Part 5: GitHub

24. Create the **private** repo `foundry-e2e-kit` (or tell me to use the module repo if you refuse a private one, section 11 Q4).
25. In its Settings, Actions: **"Allow only actions from this repository and selected actions"**; "Fork pull request workflows": require approval or disable; no secrets needed.
26. Add the repo to the agent's session scope when I ask (`add_repo`).
27. Tell me the answers to section 11; I run **Stage B0** (discovery) and report back.

---

## 11. Questions for Nate (numbered)

1. **Does the test clone or test world exist yet?** If not, Stage A proceeds without it (section 8); Stage B waits for Part 1 to 3 of the guide.
2. **How is the Foundry container packaged and run?** (Docker image such as `felddy/foundryvtt`, a bare Node install under systemd, something else? Which port? Where is the User Data folder? Can I assume `FOUNDRY_WORLD`-style auto-launch of a named world, or must the runner launch it from `/setup`, which needs the admin password?)
3. **How do the GM and Test users log in?** (User names exactly as written in Foundry? Do both have access keys? Are they ordinary Foundry users in the test world and not your real accounts? I will refuse to run against anything else.)
4. **Will you make the tests repo private?** My recommendation is a private `foundry-e2e-kit` for the engine, config and workflow, with the click-script steps staying in the public module repo (section 7.1). If not, I will keep everything public and enforce every item in section 4, accepting a higher residual risk.
5. **First version: GM-only, or GM plus Player?** Gates 13 to 20 are all two-client (114 of the 205 steps involve the Player context). My recommendation is GM plus Player from the start (it is two logins, not much extra) but I will build the GM-only path first inside Stage B so a login problem for `Test` does not block everything.
6. **How should the agent receive results without polling?** (a) subscribe to a long-lived draft "e2e sandbox" pull request so a check result wakes the session (needs your OK to open one), (b) one scheduled check-in then one file read, (c) both. My recommendation: (c).
7. **May the agent trigger runs on the private repo?** That needs the private repo added to the session scope once. Also: should runs be allowed on every push to `claude/**`, or **only when I trigger them manually** (recommended: manual or "when a round's work is done", to avoid a run on every commit)?
8. **How long may a full run take and how often will you want one?** (Full gates 13 to 20 are roughly 180 steps; I estimate 10 to 20 minutes unattended once stable.) Is overnight acceptable for the heaviest run?
9. **Is the Foundry canvas needed in the test world?** (Headless software WebGL works but is slow; the gates mostly do not need the map. Stage B0 checks whether the gates pass with the canvas disabled; if so I would disable it to speed up and de-flake runs.)
10. **Do you want pixel-diff against a baseline later, or only eyeball review?** (I recommend eyeball-only for v1, with the side-by-side compare view; pixel diffs across machines are noisy.)
11. **Where should the gallery live?** As a downloadable GitHub artifact (simplest, retained for a limited time) or also served on your LAN from the runner (a tiny static server only reachable from your PC)? Recommendation: artifact first.
12. **Which other modules are planned first?** (So the config and the kit's `steps` interface fit a second module without a rewrite; names and whether they also need a Player context.)
13. **PF2e content**: is it acceptable that the test world's PF2e compendium (used for item lookups like "Dagger") is the same one your real world uses, installed fresh in the clone?

---

## Appendix: what Round 0 verified from the repository and CI (not assumed)

- `package.json`: scripts `test` (`node --test "tests/*.test.js"`) and `build:packs`; devDependencies `@foundryvtt/foundryvtt-cli`, `jsdom` only (**no Playwright**).
- `.github/workflows/release.yml`: triggers on push to `main` and `claude/**`; `ubuntu-latest`; `npm ci`, `npm test`, `npm run build:packs`, `zip -r module.zip module.json scripts styles packs README.md`, publish the rolling `dev` pre-release. `packs/` is **gitignored** (built in CI), so a deploy must build them.
- `module.json`: v0.21.2, compatibility min 14, verified 14.369; system `pf2e` 8.6.1; requires module `socketlib`; esmodules `scripts/main.js`; manifest and download point at the rolling `dev` release.
- CI evidence: run #49 job log summary `# tests 1134 / # pass 1130 / # skipped 4`, test step 34 s.
- Gate docs 13 to 20: 25, 31, 18, 22, 40, 25, 17, 27 steps (205 in all), globals as in 1.2, classification as in 1.3.
- Entry points: `api.hub.open(actor)`, `api.discovery.openEditor(key)`, scene-controls buttons, actor-sheet header controls.
- **Not verified (cannot be from here)**: Foundry v14.369's join-page selectors, whether `game.ready` and the canvas behave in headless Chromium, the Foundry container's packaging. Each has a named Stage B0 check.
