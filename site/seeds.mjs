/* Curated seeds shared with the original Python prototype. */
export const BASICS = {
  "W": "Plains",
  "U": "Island",
  "B": "Swamp",
  "R": "Mountain",
  "G": "Forest",
  "C": "Wastes"
};
export const ROLE_SEEDS = {
  "ramp": [
    "Sol Ring",
    "Arcane Signet",
    "Fellwar Stone",
    "Mind Stone",
    "Thought Vessel",
    "Wayfarer's Bauble",
    "Expedition Map",
    "Everflowing Chalice",
    "Worn Powerstone",
    "Commander's Sphere",
    "Chromatic Lantern",
    "Coalition Relic",
    "Burnished Hart",
    "Cultivate",
    "Kodama's Reach",
    "Nature's Lore",
    "Three Visits",
    "Farseek",
    "Rampant Growth",
    "Sakura-Tribe Elder",
    "Birds of Paradise",
    "Llanowar Elves",
    "Elvish Mystic",
    "Bloom Tender",
    "Delighted Halfling",
    "Wild Growth",
    "Utopia Sprawl",
    "Smothering Tithe",
    "Knight of the White Orchid",
    "Deep Gnome Terramancer",
    "Jeska's Will",
    "Dockside Chef",
    "Dark Ritual",
    "Cabal Ritual"
  ],
  "draw": [
    "Skullclamp",
    "The One Ring",
    "Tome of Legends",
    "Idol of Oblivion",
    "Esper Sentinel",
    "Welcoming Vampire",
    "Tocasia's Welcome",
    "Mangara, the Diplomat",
    "Rhystic Study",
    "Mystic Remora",
    "Fact or Fiction",
    "Ponder",
    "Preordain",
    "Brainstorm",
    "Consider",
    "Windfall",
    "Kindred Discovery",
    "Bident of Thassa",
    "Phyrexian Arena",
    "Night's Whisper",
    "Sign in Blood",
    "Read the Bones",
    "Necropotence",
    "Black Market Connections",
    "Village Rites",
    "Deadly Dispute",
    "Faithless Looting",
    "Reckless Impulse",
    "Light Up the Stage",
    "Big Score",
    "Harmonize",
    "Guardian Project",
    "Beast Whisperer",
    "The Great Henge",
    "Rishkar's Expertise",
    "Return of the Wildspeaker",
    "Garruk's Uprising"
  ],
  "removal": [
    "Swords to Plowshares",
    "Path to Exile",
    "Generous Gift",
    "Stroke of Midnight",
    "Get Lost",
    "Return to Dust",
    "Beast Within",
    "Krosan Grip",
    "Nature's Claim",
    "Return to Nature",
    "Song of the Dryads",
    "Counterspell",
    "Swan Song",
    "Pongify",
    "Rapid Hybridization",
    "Reality Shift",
    "Cyclonic Rift",
    "Arcane Denial",
    "Feed the Swarm",
    "Go for the Throat",
    "Infernal Grasp",
    "Hero's Downfall",
    "Deadly Rollick",
    "Chaos Warp",
    "Abrade",
    "Vandalblast",
    "Lightning Bolt",
    "Chaos Defiler",
    "Assassin's Trophy",
    "Anguished Unmaking",
    "Wear // Tear",
    "Despark",
    "Drown in the Loch",
    "Utter End",
    "Vindicate",
    "Bedevil"
  ],
  "protection": [
    "Lightning Greaves",
    "Swiftfoot Boots",
    "Mithril Coat",
    "Darksteel Plate",
    "Heroic Intervention",
    "Tamiyo's Safekeeping",
    "Snakeskin Veil",
    "Tyvar's Stand",
    "Teferi's Protection",
    "Flawless Maneuver",
    "Clever Concealment",
    "Deflecting Swat",
    "Bolt Bend",
    "Slip Out the Back",
    "March of Swirling Mist",
    "Malakir Rebirth",
    "Not Dead After All",
    "Loran's Escape"
  ],
  "wipe": [
    "Blasphemous Act",
    "Chain Reaction",
    "Austere Command",
    "Farewell",
    "Wrath of God",
    "Vanquish the Horde",
    "Supreme Verdict",
    "Damn",
    "Toxic Deluge",
    "Damnation",
    "Crux of Fate",
    "Black Sun's Zenith",
    "Cyclonic Rift",
    "Nevinyrral's Disk",
    "All Is Dust",
    "Perilous Vault",
    "Ezuri's Predation",
    "Aetherize",
    "River's Rebuke",
    "Hour of Revelation"
  ],
  "finisher": [
    "Craterhoof Behemoth",
    "Overwhelming Stampede",
    "Triumph of the Hordes",
    "Finale of Devastation",
    "Torment of Hailfire",
    "Exsanguinate",
    "Rise of the Dark Realms",
    "Insurrection",
    "Comet Storm",
    "Banefire",
    "Approach of the Second Sun",
    "Akroma's Will",
    "Moonshaker Cavalry",
    "Aetherflux Reservoir",
    "Thassa's Oracle",
    "Laboratory Maniac",
    "Psychosis Crawler",
    "Altar of Dementia",
    "Shared Animosity",
    "Coat of Arms",
    "Kindred Charge"
  ]
};
export const ROLE_QUERIES = {
  "ramp": [
    "(o:\"add one mana\" or o:\"add {\" or o:\"search your library for a basic land\") -t:land"
  ],
  "draw": [
    "(o:\"draw a card\" or o:\"draw two cards\" or o:\"draw three cards\") -t:land"
  ],
  "removal": [
    "(o:\"destroy target\" or o:\"exile target\" or o:\"counter target spell\") -t:land"
  ],
  "protection": [
    "(o:\"hexproof\" or o:\"indestructible\" or o:\"phase out\") -t:land"
  ],
  "wipe": [
    "(o:\"destroy all creatures\" or o:\"exile all creatures\" or o:\"deals 13 damage to each\") -t:land"
  ]
};
export const THEMES = {
  "blink": [
    "exile",
    "enters",
    "return"
  ],
  "flicker": [
    "exile",
    "enters",
    "return"
  ],
  "aristocrats": [
    "sacrifice",
    "dies",
    "death"
  ],
  "sacrifice": [
    "sacrifice",
    "dies"
  ],
  "mill": [
    "mill",
    "graveyard"
  ],
  "spellslinger": [
    "instant",
    "sorcery",
    "magecraft"
  ],
  "storm": [
    "storm",
    "instant",
    "sorcery",
    "copy"
  ],
  "landfall": [
    "landfall",
    "land enters",
    "land"
  ],
  "lands": [
    "landfall",
    "land enters",
    "land"
  ],
  "tokens": [
    "token",
    "populate",
    "create"
  ],
  "counters": [
    "counter",
    "proliferate"
  ],
  "voltron": [
    "equipment",
    "aura",
    "equipped"
  ],
  "reanimator": [
    "graveyard",
    "return target creature",
    "reanimate"
  ],
  "lifegain": [
    "gain life",
    "life you gain",
    "lifelink"
  ],
  "artifacts": [
    "artifact",
    "construct"
  ],
  "enchantments": [
    "enchantment",
    "constellation"
  ],
  "treasure": [
    "treasure",
    "artifact token"
  ],
  "discard": [
    "discard",
    "madness"
  ],
  "+1/+1 counters": [
    "+1/+1 counter",
    "proliferate"
  ],
  "infect": [
    "infect",
    "poison",
    "toxic"
  ]
};
