/**
 * Foundry-side loading of definitions from compendium packs.
 * Reads every text page of every Journal entry in the definitions pack (plus
 * any packs named in the "extraPacks" setting) and validates them together.
 */
import { MODULE_ID, PACKS } from "../config.js";
import { formatError, loadDefinitions } from "./validate.js";

export function packIds() {
  const extra = (game.settings.get(MODULE_ID, "extraPacks") ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
  return [PACKS.definitions, ...extra];
}

async function collectSources() {
  const sources = [];
  const problems = [];
  for (const id of packIds()) {
    const pack = game.packs.get(id);
    if (!pack) {
      problems.push({ pack: id, entry: "(pack)", field: "(pack)", message: "was not found; check the pack id" });
      continue;
    }
    if (pack.documentName !== "JournalEntry") {
      problems.push({ pack: id, entry: "(pack)", field: "(pack)", message: `must be a Journal Entry pack (is ${pack.documentName})` });
      continue;
    }
    for (const entry of await pack.getDocuments()) {
      for (const page of entry.pages) {
        if (page.type !== "text") continue;
        const label = entry.pages.size > 1 ? `${entry.name} / ${page.name}` : entry.name;
        sources.push({ pack: id, entry: label, text: page.text?.markdown ?? page.text?.content ?? "" });
      }
    }
  }
  return { sources, problems };
}

/** Load and validate everything. Returns { registry, errors }. Never throws. */
export async function loadAll() {
  const { sources, problems } = await collectSources();
  const { registry, errors } = loadDefinitions(sources);
  return { registry, errors: [...problems, ...errors] };
}

/** Report errors loudly: console for everyone, a notification for the GM. */
export function reportErrors(errors) {
  if (!errors.length) return;
  console.error(`${MODULE_ID} | ${errors.length} definition problem(s):\n${errors.map(formatError).join("\n")}`);
  if (game.user.isGM) {
    ui.notifications.error(`${MODULE_ID}: ${errors.length} definition problem(s). Press F12 for details.`, { permanent: true });
  }
}
