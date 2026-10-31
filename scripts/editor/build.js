/** Registry building shared by the loader and the editor's in-memory rebuild (Stage 11d). Pure: sources + the editor's store in, a validated registry out. */
import { loadDefinitions } from "../data/validate.js";
import { layerSources } from "./layer.js";

/** @returns {{ registry, errors, contexts, leftovers }} the layered, validated definitions; `leftovers` are saved edits that no longer match anything. */
export function buildRegistry(sources, store) {
  const layered = layerSources(sources, store);
  const { registry, errors, contexts } = loadDefinitions(layered.sources);
  return { registry, errors, contexts, leftovers: layered.leftovers };
}
