/**
 * PF2e adapter.
 *
 * The ONE file allowed to read PF2e-specific data (items, actors, level DCs,
 * creature level/traits). A PF2e update should only ever break this file.
 * Everything else in the module calls these functions instead of touching
 * PF2e internals directly.
 *
 * Stage 1 fills this in: item flags, level-based DC, creature level/traits.
 */
