/**
 * Builds the compendium packs.
 *
 *   content/definitions/*.json   public definitions (materials, node types, towns, stations, ...)
 *   content/recipes/*.json       recipes (a pack hidden from players' interface; an honor system)
 *     -> ALL validated together (the build FAILS on any bad definition)
 *     -> wrapped as Journal entries (JSON in a Markdown page)
 *     -> compiled to packs/definitions and packs/recipes (LevelDB), then read back and counted
 *
 * Also creates the empty packs/crafted-items Item pack.
 * Run with: npm run build:packs
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compilePack, extractPack } from "@foundryvtt/foundryvtt-cli";
import { loadDefinitionsOrThrow } from "../scripts/data/validate.js";

const OUT = "packs";
const PACKS = [
  { name: "definitions", source: "content/definitions", id: "pathfinder-progress.definitions" },
  { name: "recipes", source: "content/recipes", id: "pathfinder-progress.recipes" }
];

const foundryId = (...parts) => createHash("sha1").update(parts.join("/")).digest("hex").slice(0, 16);

const loaded = [];
for (const pack of PACKS) {
  const files = (await readdir(pack.source)).filter(f => f.endsWith(".json")).sort();
  for (const file of files) loaded.push({ pack, file, data: JSON.parse(await readFile(join(pack.source, file), "utf8")) });
}

// Validate exactly as the module will at runtime (all packs together), so a bad seed never ships.
loadDefinitionsOrThrow(loaded.map(({ pack, file, data }) => ({
  pack: pack.id,
  entry: file,
  text: "```json\n" + JSON.stringify(data) + "\n```"
})));

for (const pack of PACKS) {
  const records = loaded.filter(item => item.pack === pack);
  const generated = `build/generated/${pack.name}`;
  await rm(generated, { recursive: true, force: true });
  await mkdir(generated, { recursive: true });

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
    await writeFile(join(generated, `${data.id}.json`), JSON.stringify(entry, null, 2));
  }

  await mkdir(OUT, { recursive: true });
  await compilePack(generated, join(OUT, pack.name), { log: true, recursive: true });

  // Read the pack back and confirm every definition (and its page) made it in.
  const check = `build/generated/_verify-${pack.name}`;
  await rm(check, { recursive: true, force: true });
  await extractPack(join(OUT, pack.name), check, { documentType: "JournalEntry", log: false });
  const packed = (await readdir(check)).filter(f => f.endsWith(".json"));
  let pages = 0;
  for (const f of packed) pages += JSON.parse(await readFile(join(check, f), "utf8")).pages?.length ?? 0;
  await rm(check, { recursive: true, force: true });
  if (packed.length !== records.length || pages !== records.length) {
    throw new Error(`Pack verification failed for ${pack.name}: expected ${records.length} entries/pages, found ${packed.length} entries and ${pages} pages.`);
  }
  console.log(`Built ${records.length} definition(s) into ${OUT}/${pack.name}`);
}

const CRAFTED_SOURCE = "build/generated/crafted-items";
await rm(CRAFTED_SOURCE, { recursive: true, force: true });
await mkdir(CRAFTED_SOURCE, { recursive: true });
await compilePack(CRAFTED_SOURCE, join(OUT, "crafted-items"), { log: true });
