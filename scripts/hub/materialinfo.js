/** What the properties milestone teaches about one material, for the Compendium (Stage 11c). Pure. Shared by the Hub's facts and the Item editor's preview, so they cannot differ. */

/**
 * @param {object} playerDef  the material as the player's client holds it (hasTrack, tag only once known)
 * @param {boolean} known     does the character know what it is good for (propertiesOpen)?
 * @param {object|null} tagDef the tag definition, when the character may see it
 */
export function materialInfoFor(playerDef, known, tagDef) {
  const tag = known && playerDef.tag && tagDef ? { name: tagDef.name, theme: tagDef.theme, worksWith: tagDef.worksWith ?? null } : null;
  return { hasTrack: Boolean(playerDef.hasTrack), known, tag };
}
