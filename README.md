# Pathfinder Progress

A Foundry VTT module for Pathfinder 2e (Foundry 14, PF2e 8.6.1): use-based skill mastery, plus a downtime system of gathering, research, and slot-based crafting.

Specs live in `docs/`; start with `CLAUDE.md`.

## Installing and updating

Install from the manifest URL (`https://github.com/Nate-Krialia/pathfinder-progress/releases/download/dev/module.json`). The module needs the **socketlib** module, which Foundry offers to install with it.

**After installing a version whose changelog or `module.json` adds or changes a manifest-level setting, fully restart the Foundry SERVER** (stop and start the Foundry process or service). Returning to the setup screen, relaunching the world, or reloading the browser is NOT enough: Foundry reads `module.json` once when the server starts. This applies to the `"socket": true` flag that v0.13.2 added; until the server restarts, players cannot "Search the area" (`api.socketStatus()` shows `registered: false` and the console says socketlib could not register the module).

v0.14.0 (queued crafting and gathering), v0.14.1, v0.15.0 (the Compendium, workshop upgrades and building your own workshop; APIs only, no screens yet) and v0.16.0 (players load only the definitions they need) change no manifest-level setting, but v0.16.0 changes pack ownership in `module.json`, which Foundry also reads only when the SERVER starts: restart the Foundry server once so both packs are hidden from players' interface, so a browser force-reload (Ctrl+Shift+R) in every window is enough; check `game.modules.get("pathfinder-progress").version` afterwards.

## Known limit: secrecy is an honour-system rule

Foundry cannot hide data from a player's browser. Hidden node tokens and their flags (including their Perception DCs), the GM-only world settings (the audit ledger, the downtime period, per-scene expedition state, the commission list), and the recipes pack are all technically readable from a player's browser console. The module keeps this information off every screen, chat message and sheet, and refuses its GM tools to players, but a player who goes looking in the console can find it. Treat it as a table rule, the same as for recipe visibility.

## Development

```
npm ci
npm test              # schema, validation, resolver and adapter tests (plain Node)
npm run build:packs   # validates content/ and compiles packs/ (also run by CI)
```

Seed definitions are plain JSON in `content/definitions/`. The build wraps each one in a Journal entry (JSON in a Markdown page) and compiles the compendium. A dev build is published to the `dev` release on every push.
