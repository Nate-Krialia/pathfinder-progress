/**
 * Every word the Downtime Hub shows, in plain language, in one place (Stage 11a). No DC, odds, percentage or difficulty wording:
 * a test walks every string and every function result here for those (tests/hub-viewmodels.test.js).
 */
export const S = {
  appTitle: "Downtime",
  closeLabel: "Close",
  displayButton: "Display",
  switchButton: "Switch character",
  switchTitle: "Whose downtime?",
  noCharacter: "You don't have a character to show. Ask the GM to make you the owner of one.",
  charactersHeading: "Your characters",

  // Status strip
  daysLabel: "Downtime days",
  daysValue: (free, reserved) => `${free} free, ${reserved} reserved`,
  locationLabel: "Party location",
  locationUnknown: "Not set",
  locationLoading: "Looking it up",
  stationsHere: names => (names.length ? `Workshops here: ${names.join(", ")}` : "No workshops here"),
  waitingLabel: "Waiting on the GM",
  waitingValue: count => (count === 0 ? "Nothing queued" : `${count} queued`),
  viewQueue: "View queue",
  hideQueue: "Hide queue",
  queueHeading: "Your queue",
  queueEmpty: "Nothing is waiting on the GM.",
  queueRowDays: days => (days === 1 ? "1 day reserved" : `${days} days reserved`),
  queueCancel: "Cancel",
  queueCancelled: label => `Cancelled: ${label}. Your days and materials are back.`,

  // Downtime gate
  closed: "Downtime isn't open right now",
  notHere: "Downtime is open, but you weren't here for it",
  closedNote: "You can look around, but anything that uses days is switched off until the GM opens downtime.",

  // Tabs
  comingLater: "Coming in a later stage",
  tabLabel: (label, working) => (working ? label : `${label} (coming later)`),

  // Formulae: list
  formulaeHeading: "Formulae",
  filterLabel: "Show",
  noFormulae: "This character doesn't know any formulae yet. Research one to start crafting.",
  noFormulaeInFilter: "No formulae in this group.",
  pillKnown: "Known",
  pillResearching: "Researching",
  progressText: (progress, needed) => `Progress ${progress} of ${needed}`,
  openInResearch: "Open in Research",
  openInResearchWhy: "The Research tab arrives in a later stage.",
  formulaLoading: "Loading what this formula needs from the GM. This takes a moment.",
  formulaMissing: "This formula's details aren't available right now. Ask the GM.",

  // Formulae: detail
  pickRecipe: "Pick a formula on the left to start.",
  researchingNote: "You're still researching this. You can craft it once you've learned it.",
  slotsHeading: "What goes in",
  slotEmpty: "Nothing chosen yet",
  slotChosen: name => `Using ${name}`,
  clearSlot: "Empty this slot",
  slotNoOptions: "You have no materials that fit this slot yet.",
  slotRole: { basePower: noun => `sets the ${noun}'s power`, bonusDamage: () => "adds bonus damage", specialAbility: () => "gives a special ability", resistance: () => "gives resistance", spellPower: noun => `sets the ${noun}'s spell power`, spellSlots: () => "adds spell slots" },
  slotRoleCustom: role => `sets its ${role}`,
  slotRoleLine: (slotName, parts) => `${slotName.charAt(0).toUpperCase()}${slotName.slice(1)} ${parts.join(" and ")}.`,
  categoryNoun: { weapon: "weapon", armor: "armor", robes: "robes", focus: "focus", consumable: "item" },
  genericNoun: "item",

  // Material options
  tierText: tier => `Tier ${tier}`,
  stockOk: (need, have) => `Uses ${need} of ${have}`,
  stockShort: (need, have) => `Need ${need}, you have ${have}`,
  stockShortWord: "Not enough",
  effectUnknown: "You haven't tried this here yet",
  effectKnownHeading: "What you've learned",

  // What you will get
  outcomeHeading: "What you will get",
  outcomePickAll: "Choose a material for every slot to see what you will get.",
  outcomeResultUnknown: "The result is unknown. Craft it to find out.",
  outcomeResultKnown: (tier, name) => `A tier ${tier} ${name}`,
  outcomeEffectLine: (material, effect) => `${material} ${effect}`,
  outcomeEffectUnknown: (slot, material) => `${slot.charAt(0).toUpperCase()}${slot.slice(1)}, ${material}: You haven't tried this here yet`,
  outcomeFee: (fee, station) => (fee === 0 ? `No station fee at ${station}` : `Station fee: ${fee} gp at ${station}`),
  outcomeDays: days => (days === 1 ? "Takes 1 day" : `Takes ${days} days`),
  outcomeMaterials: "Materials used",
  outcomeMaterialLine: (units, name) => `${units} × ${name}`,
  failureNote: "A failed craft can lose some materials and teaches you nothing.",
  // The player copy carries no gold values for materials, so the Hub cannot say what they are worth (docs/17: reported, not invented).
  costNote: "Costs shown are the station fee, the days and the materials listed.",

  // Stations
  stationHeading: "Workshop",
  stationNone: "No workshop you can use is within reach for this.",
  stationFee: fee => (fee === 0 ? "No fee" : `${fee} gp`),
  stationTier: tier => `Tier ${tier}`,
  stationCheapest: "Cheapest",

  // Buttons
  queueCraft: "Queue the craft",
  askCrafter: "Ask a crafter instead",
  askCrafterWhy: "Commissions arrive in a later stage.",
  reasonSlotEmpty: "Choose a material for every slot first.",
  reasonShort: names => `You don't have enough ${names.join(" and ")}.`,
  reasonNoStation: "No workshop you can use is within reach for this.",
  reasonNoDays: (need, have) => `This takes ${need} ${need === 1 ? "day" : "days"} and you have ${have} free.`,
  reasonNoGold: (fee, have) => `The station fee is ${fee} gp and you have ${have} gp.`,
  reasonNotKnown: "You haven't learned this formula yet.",
  reasonPreview: message => message,
  queued: (recipe, days) => `Craft queued: ${recipe}. ${days === 1 ? "1 day" : `${days} days`} reserved.`,
  queueFailed: message => `Couldn't queue the craft: ${message}`,
  loadingNote: "Loading",

  // Display settings
  displayHeading: "Display",
  textSizeLabel: "Text size",
  textSizeOption: percent => `${percent}%`,
  themeLabel: "Colours",
  themeNames: { parchment: "Parchment", dark: "Dark", contrast: "High contrast" },
  fontLabel: "Font",
  fontNames: { standard: "Standard", hyperlegible: "Easy-read (Atkinson Hyperlegible)" },
  resetDisplay: "Reset to defaults",
  displayDone: "Done",
  selectedWord: "selected",

  liveRegionLabel: "Updates",
  noActions: "This part isn't ready yet."
};
