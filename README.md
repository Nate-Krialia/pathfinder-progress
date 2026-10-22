# Pathfinder Progress

A Foundry VTT module for Pathfinder 2e (Foundry 14, PF2e 8.6.1): use-based skill mastery, plus a downtime system of gathering, research, and slot-based crafting.

Specs live in `docs/`; start with `CLAUDE.md`.

## Development

```
npm ci
npm test              # schema, validation, resolver and adapter tests (plain Node)
npm run build:packs   # validates content/ and compiles packs/ (also run by CI)
```

Seed definitions are plain JSON in `content/definitions/`. The build wraps each one in a Journal entry (JSON in a Markdown page) and compiles the compendium. A dev build is published to the `dev` release on every push.
