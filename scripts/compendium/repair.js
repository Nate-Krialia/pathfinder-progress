/**
 * Putting a damaged shared Compendium right (pure). The world's shared Compendium is one setting that every approved share is merged into. If any record in it fails validation, the
 * whole setting used to be refused (every approval then failed with no way out). `salvageShared` keeps every sound record and names the damaged ones, so a GM repair can write back
 * just the sound ones (after the raw value was kept once in the backup).
 */
import { check } from "../data/schema.js";
import { LIVE_SCHEMAS } from "../data/schemas.js";
import { emptyBook } from "./entries.js";

const isPlain = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
/** How deep a "record" sits under each category: materials.<id>, classes.<class>.<materialId>, ... */
const RECORD_DEPTH = { materials: 1, creatures: 1, regions: 1, experiments: 1, classes: 2 };

/** The problems of a shared book as stored (an unset or empty setting is healthy), as { field, message } rows. */
export function sharedProblems(raw) {
  if (raw === undefined || raw === null || (isPlain(raw) && Object.keys(raw).length === 0)) return [];
  return check(LIVE_SCHEMAS.compendium, raw);
}

const soundRecord = (category, path, value) => {
  let probe = value;
  for (const key of [...path].reverse()) probe = { [key]: probe };
  return check(LIVE_SCHEMAS.compendium, { ...emptyBook(), [category]: probe }).length === 0;
};

/**
 * @returns {{ usable: boolean, book: object, dropped: string[] }}  `usable` is false when the outer shape is wrong (not an object, a category that is not an object, a wrong version):
 * there is then nothing to salvage record by record and `book` is an empty book. Otherwise `book` holds every sound record and `dropped` names the damaged ones ("materials.iron").
 */
export function salvageShared(raw) {
  if (!isPlain(raw) || raw.v !== 1) return { usable: false, book: emptyBook(), dropped: [] };
  const book = { v: 1, materials: {}, creatures: {}, regions: {} };
  const dropped = [];
  for (const [category, depth] of Object.entries(RECORD_DEPTH)) {
    const group = raw[category];
    if (group === undefined) continue;
    if (!isPlain(group)) return { usable: false, book: emptyBook(), dropped: [] };
    book[category] ??= {};
    const visit = (node, path, level) => {
      for (const [key, value] of Object.entries(node)) {
        const here = [...path, key];
        if (level < depth) {
          if (!isPlain(value)) { dropped.push(`${category}.${here.join(".")}`); continue; }
          let target = book[category];
          for (const step of path) target = target[step];
          target[key] = {};
          visit(value, here, level + 1);
        } else if (soundRecord(category, here, value)) {
          let target = book[category];
          for (const step of path) target = target[step];
          target[key] = structuredClone(value);
        } else dropped.push(`${category}.${here.join(".")}`);
      }
    };
    visit(group, [], 1);
  }
  if (check(LIVE_SCHEMAS.compendium, book).length) return { usable: false, book: emptyBook(), dropped: [] };
  return { usable: true, book, dropped };
}
