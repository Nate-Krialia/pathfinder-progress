/**
 * "The party": every character an ordinary (non-GM) user owns at Owner level. This ONE definition is used everywhere
 * (who may read the shared Compendium, who may use a party-owned workshop).
 */
export const isPartyCharacter = actor => actor?.type === "character" && [...(game.users ?? [])].some(user => !user.isGM && actor.testUserPermission(user, "OWNER"));

export const partyCharacterIds = () => [...(game.actors ?? [])].filter(isPartyCharacter).map(actor => actor.id);
