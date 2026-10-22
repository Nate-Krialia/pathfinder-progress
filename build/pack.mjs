/**
 * Builds the compendium packs.
 *
 *   content/definitions/*.json  (plain definition records)
 *     -> validated (the build FAILS on any bad definition)
 *     -> wrapped as Journal entries (JSON in a Markdown page)
 *     -> compiled to packs/definitions (LevelDB)
 *
 * Also creates the empty packs/crafted-items Item pack.
 * Run with: npm run build:packs
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compilePack, extractPack } from "@foundryvtt/foundryvtt-cli";
import { loadDefinitionsOrThrow } from "../scripts/data/validate.js";

const CONTENT = "content/definitions";
const SOURCE = "build/generated/definitions";
const OUT = "packs";
const PACK = "pathfinder-progress.definitions";

const foundryId = (...parts) => createHash("sha1").update(parts.join("/")).digest("hex").slice(0, 16);

const files = (await readdir(CONTENT)).filter(f => f.endsWith(".json")).sort();
const records = [];
for (const file of files) records.push({ file, data: JSON.parse(await readFile(join(CONTENT, file), "utf8")) });

// Validate exactly as the module will at runtime, so a bad seed never ships.
loadDefinitionsOrThrow(records.map(({ file, data }) => ({
  pack: PACK,
  entry: file,
  text: "```json\n" + JSON.stringify(data) + "\n```"
})));

await rm(SOURCE, { recursive: true, force: true });
await mkdir(SOURCE, { recursive: true });
for (const { data } of records) {
  const entryId = foundryId("entry", data.id);
  const pageId = foundryId("page", data.id);
  const entry = {
    _id: entryId,
    // Without _key the compiler silently skips the document.
    _key: `!journal!${entryId}`,
    name: data.name ?? data.id,
    pages: [{
      _id: pageId,
      _key: `!journal.pages!${entryId}.${pageId}`,
      name: "Definition",
      type: "text",
      // format 2 = Markdown
      text: { format: 2, markdown: "```json\n" + JSON.stringify(data, null, 2) + "\n```" },
      sort: 0,
      flags: {}
    }],
    flags: { "pathfinder-progress": { kind: data.kind } },
    folder: null,
    sort: 0
  };
  await writeFile(join(SOURCE, `${data.id}.json`), JSON.stringify(entry, null, 2));
}

await mkdir(OUT, { recursive: true });
await compilePack(SOURCE, join(OUT, "definitions"), { log: true, recursive: true });

// Read the pack back and confirm every definition (and its page) made it in.
const CHECK = "build/generated/_verify";
await rm(CHECK, { recursive: true, force: true });
await extractPack(join(OUT, "definitions"), CHECK, { documentType: "JournalEntry", log: false });
const packed = (await readdir(CHECK)).filter(f => f.endsWith(".json"));
let pages = 0;
for (const f of packed) pages += JSON.parse(await readFile(join(CHECK, f), "utf8")).pages?.length ?? 0;
await rm(CHECK, { recursive: true, force: true });
if (packed.length !== records.length || pages !== records.length) {
  throw new Error(`Pack verification failed: expected ${records.length} entries/pages, found ${packed.length} entries and ${pages} pages.`);
}

const CRAFTED_SOURCE = "build/generated/crafted-items";
await rm(CRAFTED_SOURCE, { recursive: true, force: true });
await mkdir(CRAFTED_SOURCE, { recursive: true });
await compilePack(CRAFTED_SOURCE, join(OUT, "crafted-items"), { log: true });
console.log(`Built ${records.length} definition(s) into ${OUT}/definitions`);
