/**
 * The Downtime Hub's view-models (Stage 11a). Pure: plain facts in, plain data out, no Foundry globals. Every rule the window shows is
 * decided HERE so it can be tested in Node; the window only draws these and sends clicks back.
 *
 * facts (gathered by hub/facts.js from the player APIs; nothing here reads a definition pack or adds data the player copy lacks):
 *   actor: { id, name }                       characters: [{ id, name }]            gp: the character's gold in gp
 *   downtime: { open, participant }           days: { free, reserved }
 *   location: { name|null, stations: [name] } queue: [{ id, label, days }]
 *   formulas: [{ recipeId, name, access }]    researching: [{ id, goalName, recipeId|null, progress, threshold }]
 *   recipes: { id: player recipe }            materials: { id: player material }
 *   inventory: { materialId: units }          met: [materialId]
 *   learned: { "recipeId|slot|materialId": { known, effects } }      what compendium.knownEffect said
 *   stations: [{ id, name, tier, where, reachable, usable, fee }]     for the selected recipe
 *   preview: the player previewCraft result for the current picks, or null
 *   definitions: "ready" | "loading"
 * state: { tab, filter, recipeId, picks: { slot: materialId }, stationId, showQueue, showDisplay, showSwitch, layout, display }
 */
import { HUB } from "../config.js";
import { S } from "./strings.js";
import { normalizeDisplay } from "./display.js";
import { parseTier, slotRoles } from "../data/roles.js";

const cap = text => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
export const learnedKey = (recipeId, slot, materialId) => `${recipeId}|${slot}|${materialId}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Gate and status ------------------------------------------------------------------------------------------------
/** Whether anything that spends days may be used: { open, reason, note }. */
export function downtimeGate(downtime) {
  if (!downtime?.open) return { open: false, reason: S.closed, note: S.closedNote };
  if (!downtime.participant) return { open: false, reason: S.notHere, note: S.closedNote };
  return { open: true, reason: null, note: null };
}

export function statusStrip(facts) {
  const count = facts.queue.length;
  return {
    days: { label: S.daysLabel, free: facts.days.free, reserved: facts.days.reserved, value: S.daysValue(facts.days.free, facts.days.reserved) },
    location: { label: S.locationLabel, value: facts.location.name ?? S.locationUnknown, stations: S.stationsHere(facts.location.stations) },
    waiting: { label: S.waitingLabel, count, value: S.waitingValue(count), button: S.viewQueue },
    gate: downtimeGate(facts.downtime)
  };
}

export function characterSwitcher(characters, currentId) {
  return {
    show: characters.length > 1,
    heading: S.switchTitle,
    options: characters.map(c => ({ id: c.id, name: c.name, current: c.id === currentId }))
  };
}

export function tabRow(active) {
  return HUB.tabs.map(tab => ({ id: tab.id, label: tab.label, working: tab.working, text: S.tabLabel(tab.label, tab.working), selected: tab.id === active }));
}

export function queuePanel(rows, open) {
  return {
    open, heading: S.queueHeading, empty: rows.length === 0, emptyText: S.queueEmpty,
    rows: rows.map(r => ({ id: r.id, label: r.label, daysText: r.days > 0 ? S.queueRowDays(r.days) : "", cancel: S.queueCancel }))
  };
}

export function displaySettings(display, open) {
  const d = normalizeDisplay(display);
  return {
    open, heading: S.displayHeading, reset: S.resetDisplay, done: S.displayDone,
    textSize: { label: S.textSizeLabel, options: HUB.textSizes.map(p => ({ value: p, text: S.textSizeOption(p), selected: p === d.textSize })) },
    theme: { label: S.themeLabel, options: HUB.themes.map(id => ({ value: id, text: S.themeNames[id], selected: id === d.theme })) },
    font: { label: S.fontLabel, options: HUB.fonts.map(id => ({ value: id, text: S.fontNames[id], selected: id === d.font })) }
  };
}

// Formulae: the list ---------------------------------------------------------------------------------------------
const categoryOf = (facts, recipeId) => facts.recipes[recipeId]?.category ?? null;
const inFilter = (filterId, category) => {
  const filter = HUB.filters.find(f => f.id === filterId) ?? HUB.filters[0];
  return filter.categories === null || (category !== null && filter.categories.includes(category));
};

export function formulaList(facts, state) {
  const known = facts.formulas.map(f => {
    const recipe = facts.recipes[f.recipeId];
    return {
      key: `recipe:${f.recipeId}`, recipeId: f.recipeId, name: recipe?.name ?? f.name, category: recipe?.category ?? null, status: "known", pill: S.pillKnown,
      loaded: Boolean(recipe), note: f.access === "loan" ? "On loan" : "", selected: state.recipeId === f.recipeId
    };
  });
  // Research in progress for a formula the character does not hold yet.
  const heldIds = new Set(facts.formulas.map(f => f.recipeId));
  const researching = facts.researching.filter(p => !(p.recipeId && heldIds.has(p.recipeId))).map(p => ({
    key: `project:${p.id}`, recipeId: p.recipeId, projectId: p.id, name: p.goalName, category: categoryOf(facts, p.recipeId), status: "researching", pill: S.pillResearching,
    progress: { value: p.progress, max: p.threshold, text: S.progressText(p.progress, p.threshold) }, openInResearch: { text: S.openInResearch, disabled: true, why: S.openInResearchWhy },
    selected: state.recipeId === p.recipeId && p.recipeId !== null
  }));
  const all = [...known, ...researching];
  const cards = all.filter(c => inFilter(state.filter, c.category));
  return {
    heading: S.formulaeHeading, filterLabel: S.filterLabel,
    chips: HUB.filters.map(f => ({ id: f.id, label: f.label, selected: f.id === (HUB.filters.some(x => x.id === state.filter) ? state.filter : "all"), count: all.filter(c => inFilter(f.id, c.category)).length })),
    cards,
    empty: all.length === 0 ? S.noFormulae : cards.length === 0 ? S.noFormulaeInFilter : null
  };
}

// Formulae: slots and materials ----------------------------------------------------------------------------------
/** A slot's one-line role from what it drives ("Blade sets the weapon's power."). */
export function slotRoleLine(recipe, slot) {
  const noun = S.categoryNoun[recipe.category] ?? S.genericNoun;
  const parts = slotRoles(slot).map(role => (S.slotRole[role] ? S.slotRole[role](noun) : S.slotRoleCustom(role)));
  return S.slotRoleLine(slot.name, parts);
}

/** One learned role effect in plain words ("adds +1d8 spirit damage"). */
export function roleText(role, value, recipe) {
  const noun = S.categoryNoun[recipe?.category] ?? S.genericNoun;
  switch (role) {
    case "basePower": return `${S.slotRole.basePower(noun)} (tier ${parseTier(value)})`;
    case "spellPower": return `${S.slotRole.spellPower(noun)} (tier ${parseTier(value)})`;
    case "bonusDamage": return `adds +${value.dice} ${value.persistent ? "persistent " : ""}${value.type} damage${value.versus ? ` against ${value.versus}` : ""}`;
    case "specialAbility": return `gives ${value.title}: ${value.text}${value.on ? ` (on a ${value.on === "criticalHit" ? "critical hit" : "hit"})` : ""}`;
    case "resistance": return `gives resistance ${value.value} to ${value.type}`;
    case "spellSlots": return `adds ${plural(value, "spell slot")}`;
    default: return `${role}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`;
  }
}

/** The learned effect lines for a material, or null when the character has not learned it here. Only known facts ever produce text. */
export function effectLines(materialName, fact, recipe) {
  if (!fact?.known) return null;
  return Object.entries(fact.effects ?? {}).map(([role, value]) => S.outcomeEffectLine(materialName, roleText(role, value, recipe)));
}

/** Units of `materialId` all the chosen slots together need (a material used in two slots must cover both). */
function unitsNeeded(recipe, picks, materialId) {
  return recipe.slots.reduce((sum, slot) => sum + (picks[slot.name] === materialId ? slot.qty : 0), 0);
}

/** The materials that may be offered for a slot: in the bag, met in the Compendium, at or above the slot's floor. */
function optionsFor(facts, recipe, slot, picks) {
  const met = new Set(facts.met);
  return Object.keys(facts.inventory)
    .filter(id => facts.inventory[id] > 0 && met.has(id) && facts.materials[id] && facts.materials[id].tier >= slot.tierFloor)
    .map(id => facts.materials[id])
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name))
    .map(material => {
      const have = facts.inventory[material.id] ?? 0;
      const need = unitsNeeded(recipe, { ...picks, [slot.name]: material.id }, material.id);
      const short = have < need;
      const fact = facts.learned[learnedKey(recipe.id, slot.name, material.id)];
      const effects = effectLines(material.name, fact, recipe);
      return {
        id: material.id, name: material.name, tier: material.tier, tierText: S.tierText(material.tier),
        stock: { have, need, short, text: short ? S.stockShort(need, have) : S.stockOk(need, have), word: short ? S.stockShortWord : "" },
        effect: effects ? { known: true, effects } : { known: false, text: S.effectUnknown },
        selected: picks[slot.name] === material.id
      };
    });
}

export function slotPane(facts, recipe, picks) {
  return recipe.slots.map(slot => {
    const options = optionsFor(facts, recipe, slot, picks);
    const chosen = picks[slot.name] ? facts.materials[picks[slot.name]] ?? null : null;
    return {
      name: slot.name, label: cap(slot.name), roleLine: slotRoleLine(recipe, slot), qty: slot.qty,
      chosen: chosen ? { id: chosen.id, name: chosen.name } : null,
      statusText: chosen ? S.slotChosen(chosen.name) : S.slotEmpty, clear: S.clearSlot,
      options, noOptions: options.length === 0 ? S.slotNoOptions : null
    };
  });
}

// Formulae: stations, outcome, button ----------------------------------------------------------------------------
export function stationChoices(stations, stationId) {
  const usable = stations.filter(s => s.reachable && s.usable !== false).sort((a, b) => a.fee - b.fee || a.tier - b.tier || a.name.localeCompare(b.name));
  const chosen = usable.find(s => s.id === stationId) ?? usable[0] ?? null;
  return {
    heading: S.stationHeading, none: usable.length === 0 ? S.stationNone : null, chosenId: chosen?.id ?? null,
    options: usable.map((s, i) => ({ id: s.id, name: s.name, where: s.where, tierText: S.stationTier(s.tier), fee: s.fee, feeText: S.stationFee(s.fee), selected: s.id === chosen?.id, cheapest: i === 0 ? S.stationCheapest : "" }))
  };
}

export const allSlotsPicked = (recipe, picks) => recipe.slots.every(slot => Boolean(picks[slot.name]));

function craftDays(recipe, stationId, preview) {
  if (preview?.ok && Number.isFinite(preview.plan?.days)) return preview.plan.days;
  return recipe.days?.byStation?.[stationId] ?? recipe.days?.default ?? 1;
}

/** "What you will get". Learned effects only; an unlearned one says so and never shows a guess. */
export function outcomeBox(facts, recipe, picks, stationId) {
  const stations = stationChoices(facts.stations, stationId);
  const preview = allSlotsPicked(recipe, picks) ? facts.preview : null;
  const plan = preview?.ok ? preview.plan : null;
  const lines = [];
  for (const slot of recipe.slots) {
    const id = picks[slot.name];
    if (!id) continue;
    const material = facts.materials[id];
    if (!material) continue;
    const fromPlan = plan?.slots?.find(s => s.slot === slot.name)?.effect;
    const fact = fromPlan ? (fromPlan.known ? { known: true, effects: fromPlan.roles } : { known: false }) : facts.learned[learnedKey(recipe.id, slot.name, id)];
    const effects = effectLines(material.name, fact, recipe);
    lines.push(effects ? { slot: slot.name, known: true, effects } : { slot: slot.name, known: false, text: S.outcomeEffectUnknown(slot.name, material.name) });
  }
  const chosenStation = stations.options.find(o => o.selected) ?? null;
  const days = craftDays(recipe, stations.chosenId, preview);
  let result;
  if (!allSlotsPicked(recipe, picks)) result = { state: "incomplete", text: S.outcomePickAll };
  else if (!preview) result = { state: "loading", text: S.outcomePickAll };
  else if (!preview.ok) result = { state: "problem", text: preview.errors[0] ?? S.outcomePickAll, problems: preview.errors };
  else if (plan.result?.known) result = { state: "known", text: S.outcomeResultKnown(plan.result.baseTier, recipe.name) };
  else result = { state: "unknown", text: S.outcomeResultUnknown };
  const used = plan ? plan.uses.map(u => S.outcomeMaterialLine(u.units, u.materialName)) : recipe.slots.filter(s => picks[s.name] && facts.materials[picks[s.name]]).map(s => S.outcomeMaterialLine(s.qty, facts.materials[picks[s.name]].name));
  return {
    heading: S.outcomeHeading, result, effects: lines,
    fee: chosenStation ? S.outcomeFee(chosenStation.fee, chosenStation.name) : null,
    days: S.outcomeDays(days), materialsHeading: S.outcomeMaterials, materials: used,
    failureNote: S.failureNote, costNote: S.costNote
  };
}

const chosenFee = stations => stations.options.find(o => o.selected)?.fee ?? 0;

/** The Queue button and why it may be off. Reasons are checked in the order a player would fix them. */
export function queueButton(facts, recipe, picks, stationId) {
  const gate = downtimeGate(facts.downtime);
  const stations = stationChoices(facts.stations, stationId);
  const days = craftDays(recipe, stations.chosenId, allSlotsPicked(recipe, picks) ? facts.preview : null);
  const picked = recipe.slots.filter(s => picks[s.name]);
  const short = [...new Set(picked.filter(s => (facts.inventory[picks[s.name]] ?? 0) < unitsNeeded(recipe, picks, picks[s.name])).map(s => facts.materials[picks[s.name]]?.name ?? picks[s.name]))];
  let reason = null;
  if (!gate.open) reason = gate.reason;
  else if (!allSlotsPicked(recipe, picks)) reason = S.reasonSlotEmpty;
  else if (short.length) reason = S.reasonShort(short);
  else if (stations.none) reason = S.reasonNoStation;
  else if (days > facts.days.free) reason = S.reasonNoDays(days, facts.days.free);
  else if (chosenFee(stations) > facts.gp) reason = S.reasonNoGold(chosenFee(stations), facts.gp);
  else if (facts.preview && !facts.preview.ok) reason = S.reasonPreview(facts.preview.errors[0]);
  else if (!facts.preview) reason = S.loadingNote;
  return {
    queue: { text: S.queueCraft, disabled: reason !== null, reason },
    ask: { text: S.askCrafter, disabled: true, why: S.askCrafterWhy }
  };
}

/** What api.queue.submit needs for the current picks, or null while the button is off. */
export function craftRequest(facts, state) {
  const recipe = facts.recipes[state.recipeId];
  if (!recipe || !allSlotsPicked(recipe, state.picks)) return null;
  const stations = stationChoices(facts.stations, state.stationId);
  return { recipe: recipe.id, selection: { ...state.picks }, stationId: stations.chosenId, days: craftDays(recipe, stations.chosenId, facts.preview) };
}

// The Formulae tab as a whole ------------------------------------------------------------------------------------
export function formulaeTab(facts, state) {
  const list = formulaList(facts, state);
  const held = facts.formulas.some(f => f.recipeId === state.recipeId);
  const researching = list.cards.find(c => c.status === "researching" && c.recipeId === state.recipeId);
  const recipe = facts.recipes[state.recipeId];
  let detail;
  if (!state.recipeId) detail = { kind: "empty", text: S.pickRecipe };
  else if (!held && researching) detail = { kind: "researching", name: researching.name, text: S.researchingNote, progress: researching.progress };
  else if (!held) detail = { kind: "empty", text: S.pickRecipe };
  else if (!recipe) detail = { kind: "loading", text: facts.definitions === "loading" ? S.formulaLoading : S.formulaMissing };
  else {
    detail = {
      kind: "recipe", recipeId: recipe.id, name: recipe.name, slotsHeading: S.slotsHeading,
      slots: slotPane(facts, recipe, state.picks), stations: stationChoices(facts.stations, state.stationId),
      outcome: outcomeBox(facts, recipe, state.picks, state.stationId), buttons: queueButton(facts, recipe, state.picks, state.stationId)
    };
  }
  return { list, detail };
}

/** The whole window as plain data. */
export function hubModel(facts, state) {
  const display = normalizeDisplay(state.display);
  return {
    title: S.appTitle, character: facts.actor ? { id: facts.actor.id, name: facts.actor.name } : null,
    closeLabel: S.closeLabel, displayButton: S.displayButton, switchButton: S.switchButton,
    switcher: characterSwitcher(facts.characters, facts.actor?.id), showSwitch: Boolean(state.showSwitch),
    display, displayPanel: displaySettings(display, Boolean(state.showDisplay)),
    layout: state.layout === "narrow" ? "narrow" : "wide",
    tabs: tabRow(state.tab), activeTab: state.tab,
    status: statusStrip(facts), queue: queuePanel(facts.queue, Boolean(state.showQueue)),
    body: state.tab === "formulae" ? { kind: "formulae", ...formulaeTab(facts, state) } : { kind: "placeholder", text: S.comingLater, tab: HUB.tabs.find(t => t.id === state.tab)?.label ?? "" },
    liveLabel: S.liveRegionLabel
  };
}

export const emptyState = () => ({ tab: "formulae", filter: "all", recipeId: null, picks: {}, stationId: null, showQueue: false, showDisplay: false, showSwitch: false, layout: "wide", display: normalizeDisplay(null) });

/** When the viewed formula changes, its picks start EMPTY again (nothing is ever filled in for the player). */
export function selectRecipe(state, recipeId) {
  return state.recipeId === recipeId ? state : { ...state, recipeId, picks: {}, stationId: null };
}

/** A pick; picking the same material again empties the slot. */
export function pickMaterial(state, slot, materialId) {
  const picks = { ...state.picks };
  if (!materialId || picks[slot] === materialId) delete picks[slot]; else picks[slot] = materialId;
  return { ...state, picks };
}
