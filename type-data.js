/**
 * type-data.js — Tabela de tipos Pokémon
 *
 * Exporta:
 *   TYPE_COLORS     — { typeName: hexColor }
 *   TYPE_CHART      — matriz de efetividade: TYPE_CHART[atacante][defensor] = 0|0.5|1|2
 *   getMoveType(moveName) — retorna tipo do golpe a partir do nome (lookup no dicionário embutido)
 *   getTypeAdvantage(attackType, defenderTypes) — retorna multiplicador total
 *   getTypeDamageBonus(attackType, defenderTypes) — retorna +2 / -2 / -4 / 0
 *   getSuperEffectiveAgainst(type) — tipos que este type bate super efetivo
 *   getWeakAgainst(type)           — tipos que batem super efetivo neste type
 */

export const TYPE_COLORS = {
  Normal:    "#A8A878",
  Fire:      "#F08030",
  Water:     "#6890F0",
  Electric:  "#F8D030",
  Grass:     "#78C850",
  Ice:       "#98D8D8",
  Fighting:  "#C03028",
  Poison:    "#A040A0",
  Ground:    "#E0C068",
  Flying:    "#A890F0",
  Psychic:   "#F85888",
  Bug:       "#A8B820",
  Rock:      "#B8A038",
  Ghost:     "#705898",
  Dragon:    "#7038F8",
  Dark:      "#705848",
  Steel:     "#B8B8D0",
  Fairy:     "#EE99AC",
  // Português
  Fogo:      "#F08030",
  Água:      "#6890F0",
  Elétrico:  "#F8D030",
  Planta:    "#78C850",
  Gelo:      "#98D8D8",
  Lutador:   "#C03028",
  Veneno:    "#A040A0",
  Terra:     "#E0C068",
  Voador:    "#A890F0",
  Psíquico:  "#F85888",
  Inseto:    "#A8B820",
  Pedra:     "#B8A038",
  Fantasma:  "#705898",
  Dragão:    "#7038F8",
  Sombrio:   "#705848",
  Aço:       "#B8B8D0",
  Fada:      "#EE99AC",
};

// Normaliza nomes PT→EN para uso interno
const PT_TO_EN = {
  Fogo:"Fire", Água:"Water", Elétrico:"Electric", Planta:"Grass", Gelo:"Ice",
  Lutador:"Fighting", Veneno:"Poison", Terra:"Ground", Voador:"Flying",
  Psíquico:"Psychic", Inseto:"Bug", Pedra:"Rock", Fantasma:"Ghost",
  Dragão:"Dragon", Sombrio:"Dark", Aço:"Steel", Fada:"Fairy", Normal:"Normal",
};

export function normalizeType(t) {
  if (!t) return "";
  const s = String(t).trim();
  return PT_TO_EN[s] || s;
}

/**
 * TYPE_CHART[attacker_EN][defender_EN] = multiplier
 * 0 = immune, 0.5 = not very effective, 2 = super effective (1 = neutral, omitted)
 */
export const TYPE_CHART = {
  Normal:   { Rock:0.5, Ghost:0, Steel:0.5 },
  Fire:     { Fire:0.5, Water:0.5, Grass:2, Ice:2, Bug:2, Rock:0.5, Dragon:0.5, Steel:2 },
  Water:    { Fire:2, Water:0.5, Grass:0.5, Ground:2, Rock:2, Dragon:0.5 },
  Electric: { Water:2, Electric:0.5, Grass:0.5, Ground:0, Flying:2, Dragon:0.5 },
  Grass:    { Fire:0.5, Water:2, Grass:0.5, Poison:0.5, Ground:2, Flying:0.5, Bug:0.5, Rock:2, Dragon:0.5, Steel:0.5 },
  Ice:      { Water:0.5, Grass:2, Ice:0.5, Ground:2, Flying:2, Dragon:2, Steel:0.5 },
  Fighting: { Normal:2, Ice:2, Poison:0.5, Flying:0.5, Psychic:0.5, Bug:0.5, Rock:2, Ghost:0, Dark:2, Steel:2, Fairy:0.5 },
  Poison:   { Grass:2, Poison:0.5, Ground:0.5, Rock:0.5, Ghost:0.5, Steel:0, Fairy:2 },
  Ground:   { Fire:2, Electric:2, Grass:0.5, Poison:2, Flying:0, Bug:0.5, Rock:2, Steel:2 },
  Flying:   { Electric:0.5, Grass:2, Fighting:2, Bug:2, Rock:0.5, Steel:0.5 },
  Psychic:  { Fighting:2, Poison:2, Psychic:0.5, Dark:0, Steel:0.5 },
  Bug:      { Fire:0.5, Grass:2, Fighting:0.5, Flying:0.5, Psychic:2, Ghost:0.5, Dark:2, Steel:0.5, Fairy:0.5 },
  Rock:     { Fire:2, Ice:2, Fighting:0.5, Ground:0.5, Flying:2, Bug:2, Steel:0.5 },
  Ghost:    { Normal:0, Psychic:2, Ghost:2, Dark:0.5 },
  Dragon:   { Dragon:2, Steel:0.5, Fairy:0 },
  Dark:     { Fighting:0.5, Psychic:2, Ghost:2, Dark:0.5, Fairy:0.5 },
  Steel:    { Fire:0.5, Water:0.5, Electric:0.5, Ice:2, Rock:2, Steel:0.5, Fairy:2 },
  Fairy:    { Fire:0.5, Fighting:2, Poison:0.5, Dragon:2, Dark:2, Steel:0.5 },
};

/**
 * Retorna o multiplicador de dano do golpe (tipo atacante) contra um defensor (array de tipos).
 * Imunidate: 0, fraco: 0.5, normal: 1, super: 2 (ou 4 para dual-weak)
 */
export function getTypeAdvantage(attackType, defenderTypes) {
  const atk = normalizeType(attackType);
  if (!atk || !TYPE_CHART[atk]) return 1;
  const chart = TYPE_CHART[atk];
  let mult = 1;
  for (const dt of (defenderTypes || [])) {
    const def = normalizeType(dt);
    if (def && chart[def] !== undefined) mult *= chart[def];
  }
  return mult;
}

/**
 * Converte multiplicador de efetividade para bônus de dano M&M:
 *   vantagem 2x  -> +2
 *   vantagem 4x  -> +4
 *   resistência /2 -> -2
 *   resistência /4 -> -4
 *   imunidade 0x -> -4
 *   neutro -> 0
 */
export function getTypeDamageBonus(attackType, defenderTypes) {
  const mult = getTypeAdvantage(attackType, defenderTypes);
  if (mult === 0) return -4;
  if (mult >= 4) return +4;
  if (mult >= 2) return +2;
  if (mult <= 0.25) return -4;
  if (mult < 1) return -2;
  return 0;
}

/**
 * Retorna lista de tipos (EN) que o type dado bate super efetivo (2x).
 */
export function getSuperEffectiveAgainst(type) {
  const atk = normalizeType(type);
  if (!atk || !TYPE_CHART[atk]) return [];
  return Object.entries(TYPE_CHART[atk])
    .filter(([, v]) => v === 2)
    .map(([t]) => t);
}

/**
 * Retorna lista de tipos (EN) que batem super efetivo neste type (fraquezas).
 */
export function getWeakAgainst(type) {
  const def = normalizeType(type);
  if (!def) return [];
  const weaknesses = [];
  for (const [atk, targets] of Object.entries(TYPE_CHART)) {
    if (targets[def] === 2) weaknesses.push(atk);
  }
  return weaknesses;
}

/**
 * Retorna lista de tipos (EN) que causam dano 0 neste type (imunidades).
 */
export function getImmuneTo(type) {
  const def = normalizeType(type);
  if (!def) return [];
  const immune = [];
  for (const [atk, targets] of Object.entries(TYPE_CHART)) {
    if (targets[def] === 0) immune.push(atk);
  }
  return immune;
}

// ── Dicionário Nome do Golpe → Tipo ──────────────────────────────────────
// Gerado automaticamente a partir da planilha golpes_pokemon_MM_reescritos.xlsx
// 1054 golpes — busca por nome base (ignora "(Alternativo...)" etc.)
const MOVE_TYPE_MAP_RAW = {
  "Absorb": "Grass", "Accelerock": "Rock", "Acid": "Poison", "Acid Armor": "Poison",
  "Acid Spray": "Poison", "Acrobatics": "Flying", "Aerial Ace": "Flying",
  "Agility": "Psychic", "Agillity": "Psychic", "Air Cutter": "Flying",
  "Air Slash": "Flying", "Alluring Voice": "Fairy", "Ally Switch": "Psychic",
  "Amnesia": "Psychic", "Anchor Shot": "Steel", "Ancient Power": "Rock",
  "Apple Acid": "Grass", "Aqua Cutter": "Water", "Aqua Jet": "Water",
  "Aqua Ring": "Water", "Aqua Step": "Water", "Aqua Tail": "Water",
  "Armor Cannon": "Fire", "Aromatherapy": "Grass", "Assist": "Normal",
  "Astonish": "Ghost", "Attack Order": "Bug", "Attract": "Normal",
  "Aura Sphere": "Fighting", "Aurora Beam": "Ice", "Aurora Veil": "Ice",
  "Automize": "Steel", "Avalanche": "Ice", "Axe Kick": "Fighting",
  "Baneful Bunker": "Poison", "Barb Barrage": "Poison", "Barrage": "Normal",
  "Barrier": "Psychic", "Baton Pass": "Normal", "Beak Blast": "Flying",
  "Behemoth Bash": "Steel", "Behemoth Blade": "Steel", "Belch": "Poison",
  "Belly Drum": "Normal", "Bestow": "Normal", "Bide": "Normal",
  "Bind": "Normal", "Bite": "Dark", "Bitter Blade": "Fire", "Bitter Malice": "Ghost",
  "Blazing Torque": "Fire", "Blizzard": "Ice", "Block": "Normal",
  "Blood Moon": "Normal", "Blue Flare": "Fire", "Body Press": "Fighting",
  "Body Slam": "Normal", "Bolt Strike": "Electric", "Bone Club": "Ground",
  "Bone Rush": "Ground", "Bonemerang": "Ground", "Boomburst": "Normal",
  "Bounce": "Flying", "Brave Bird": "Flying", "Breaking Swipe": "Dragon",
  "Brick Break": "Fighting", "Brine": "Water", "Brutal Swing": "Dark",
  "Bubble": "Water", "Bubble Beam": "Water", "Bug Bite": "Bug", "Bug Buzz": "Bug",
  "Bulk Up": "Fighting", "Bulldoze": "Ground", "Bullet Punch": "Steel",
  "Bullet Seed": "Grass", "Burn Up": "Fire", "Burning Bulwark": "Fire",
  "Burning Jealousy": "Fire", "Calm Mind": "Psychic", "Camouflage": "Normal",
  "Ceaseless Edge": "Dark", "Charge": "Electric", "Charge Beam": "Electric",
  "Charm": "Fairy", "Chilling Water": "Water", "Chilly Reception": "Ice",
  "Chip Away": "Normal", "Chloroblast": "Grass", "Circle Throw": "Fighting",
  "Clamp": "Water", "Clear Smog": "Poison", "Close Combat": "Fighting",
  "Coaching": "Fighting", "Coil": "Poison", "Collision Course": "Fighting",
  "Combat Torque": "Fighting", "Comet Punch": "Normal", "Comeuppance": "Dark",
  "Confide": "Normal", "Confuse Ray": "Ghost", "Confusion": "Psychic",
  "Constrict": "Normal", "Conversion": "Normal", "Conversion 2": "Normal",
  "Copycat": "Normal", "Core Enforcer": "Dragon", "Corrosive Gas": "Poison",
  "Cosmic Power": "Psychic", "Cotton Guard": "Grass", "Cotton Spore": "Grass",
  "Counter": "Fighting", "Court Change": "Normal", "Covet": "Normal",
  "Crabhammer": "Water", "Crafty Shield": "Fairy", "Cross Poison": "Poison",
  "Crunch": "Dark", "Crush Claw": "Normal", "Crush Grip": "Normal",
  "Curse": "Ghost", "Dark Pulse": "Dark", "Dazzling Gleam": "Fairy",
  "Decorate": "Fairy", "Defend Order": "Bug", "Defense Curl": "Normal",
  "Defense Order": "Bug", "Defog": "Flying", "Destiny Bond": "Ghost",
  "Detect": "Fighting", "Dig": "Ground", "Dire Claw": "Poison",
  "Disable": "Normal", "Discharge": "Electric", "Dive": "Water",
  "Dizzy Punch": "Normal", "Doodle": "Normal", "Doom Desire": "Steel",
  "Double Hit": "Normal", "Double Kick": "Fighting", "Double Shock": "Electric",
  "Double Slap": "Normal", "Double Team": "Normal", "Double-Edge": "Normal",
  "Draco Meteor": "Dragon", "Dragon Ascent": "Flying", "Dragon Breath": "Dragon",
  "Dragon Cheer": "Dragon", "Dragon Claw": "Dragon", "Dragon Dance": "Dragon",
  "Dragon Darts": "Dragon", "Dragon Hammer": "Dragon", "Dragon Pulse": "Dragon",
  "Dragon Rage": "Dragon", "Dragon Rush": "Dragon", "Dragon Tail": "Dragon",
  "Drain Punch": "Fighting", "Draining Kiss": "Fairy", "Drill Peck": "Flying",
  "Drill Run": "Ground", "Drum Beating": "Grass", "Dual Wingbeat": "Flying",
  "Dynamic Punch": "Fighting", "Earth Power": "Ground", "Earthquake": "Ground",
  "Echoed Voice": "Normal", "Eerie Impulse": "Electric", "Electric Terrain": "Electric",
  "Electrify": "Electric", "Electro Ball": "Electric", "Electro Drift": "Electric",
  "Electro Shot": "Electric", "Electroweb": "Electric", "Embargo": "Dark",
  "Ember": "Fire", "Encore": "Normal", "Endeavor": "Normal", "Endure": "Normal",
  "Energy Ball": "Grass", "Entrainment": "Normal", "Eruption": "Fire",
  "Esper Wing": "Psychic", "Eternabeam": "Dragon", "Expanding Force": "Psychic",
  "Explosion": "Normal", "Extreme Speed": "Normal", "Facade": "Normal",
  "Fairy Lock": "Fairy", "Fake Out": "Normal", "Fake Tears": "Dark",
  "False Surrender": "Dark", "False Swipe": "Normal", "Feint": "Normal",
  "Feint Attack": "Dark", "Fell Stinger": "Bug", "Fickle Beam": "Dragon",
  "Fiery Dance": "Fire", "Fillet Away": "Normal", "Final Gambit": "Fighting",
  "Fire Blast": "Fire", "Fire Spin": "Fire", "First Impression": "Bug",
  "Fissure": "Ground", "Flame Charge": "Fire", "Flame Wheel": "Fire",
  "Flamethrower": "Fire", "Flare Blitz": "Fire", "Flash": "Normal",
  "Flash Cannon": "Steel", "Fleur Cannon": "Fairy", "Fling": "Dark",
  "Flip Turn": "Water", "Flower Trick": "Grass", "Fly": "Flying",
  "Flying Press": "Fighting", "Focus Blast": "Fighting", "Focus Energy": "Normal",
  "Focus Punch": "Fighting", "Follow Me": "Normal", "Force Palm": "Fighting",
  "Foresight": "Normal", "Forest's Curse": "Grass", "Foul Play": "Dark",
  "Freeze Shock": "Ice", "Freeze-Dry": "Ice", "Frost Breath": "Ice",
  "Fury Attack": "Normal", "Fury Cutter": "Bug", "Fury Swipes": "Normal",
  "Fusion Bolt": "Electric", "Fusion Flare": "Fire", "Future Sight": "Psychic",
  "Gastro Acid": "Poison", "Giga Drain": "Grass", "Giga Impact": "Normal",
  "Gigaton Hammer": "Steel", "Glaciate": "Ice", "Glaive Rush": "Dragon",
  "Glare": "Normal", "Grass Knot": "Grass", "Grassy Glide": "Grass",
  "Grassy Terrain": "Grass", "Grav Apple": "Grass", "Gravity": "Psychic",
  "Growl": "Normal", "Growth": "Normal", "Grudge": "Ghost", "Guard Swap": "Psychic",
  "Guillotine": "Normal", "Gunk Shot": "Poison", "Gyro Ball": "Steel",
  "Hail": "Ice", "Hammer Arm": "Fighting", "Hard Press": "Steel",
  "Harden": "Normal", "Haze": "Ice", "Head Smash": "Rock",
  "Headlong Rush": "Ground", "Heal Bell": "Normal", "Heal Block": "Psychic",
  "Heal Order": "Bug", "Heal Pulse": "Psychic", "Healing Wish": "Psychic",
  "Heart Swap": "Psychic", "Heat Crash": "Fire", "Heat Wave": "Fire",
  "Heavy Slam": "Steel", "Helping Hand": "Normal", "Hex": "Ghost",
  "High Horsepower": "Ground", "High Jump Kick": "Fighting", "Hone Claws": "Dark",
  "Horn Drill": "Normal", "Horn Leech": "Grass", "Howl": "Normal",
  "Hurricane": "Flying", "Hydro Cannon": "Water", "Hydro Pump": "Water",
  "Hydro Steam": "Water", "Hyper Beam": "Normal", "Hyper Drill": "Normal",
  "Hyper Fang": "Normal", "Hyper Voice": "Normal", "Hyperspace Fury": "Dark",
  "Hyperspace Hole": "Psychic", "Hypnosis": "Psychic", "Ice Ball": "Ice",
  "Ice Beam": "Ice", "Ice Burn": "Ice", "Ice Fang": "Ice", "Ice Hammer": "Ice",
  "Ice Punch": "Ice", "Ice Shard": "Ice", "Ice Spinner": "Ice", "Ice Wind": "Ice",
  "Icicle Crash": "Ice", "Icicle Spear": "Ice", "Icy Wind": "Ice",
  "Imprison": "Psychic", "Inferno": "Fire", "Infestation": "Bug",
  "Ingrain": "Grass", "Instruct": "Psychic", "Ion Deluge": "Electric",
  "Iron Defense": "Steel", "Iron Head": "Steel", "Iron Tail": "Steel",
  "Ivy Cudgel": "Grass", "Jaw Lock": "Dark", "Jet Punch": "Water",
  "Judgment": "Normal", "Jump Kick": "Fighting", "Jungle Healing": "Grass",
  "Karate Chop": "Fighting", "Kinesis": "Psychic", "King's Shield": "Steel",
  "Knock Off": "Dark", "Kowtow Cleave": "Dark", "Laser Focus": "Normal",
  "Lash Out": "Dark", "Last Respects": "Ghost", "Lava Plume": "Fire",
  "Leaf Blade": "Grass", "Leaf Storm": "Grass", "Leaf Tornado": "Grass",
  "Leech Life": "Bug", "Leech Seed": "Grass", "Leer": "Normal", "Lick": "Ghost",
  "Life Dew": "Water", "Light Screen": "Psychic", "Liquidation": "Water",
  "Lock On": "Normal", "Low Kick": "Fighting", "Low Sweep": "Fighting",
  "Lucky Chant": "Normal", "Lumina Crash": "Psychic", "Lunar Blessing": "Psychic",
  "Lunar Dance": "Psychic", "Lunge": "Bug", "Mach Punch": "Fighting",
  "Magic Coat": "Psychic", "Magic Powder": "Psychic", "Magic Room": "Psychic",
  "Magical Torque": "Fairy", "Magnet Rise": "Electric", "Make It Rain": "Steel",
  "Malignant Chain": "Poison", "Mat Block": "Fighting", "Matcha Gotcha": "Grass",
  "Me First": "Normal", "Mean Look": "Normal", "Meditate": "Psychic",
  "Mega Drain": "Grass", "Mega Kick": "Normal", "Mega Punch": "Normal",
  "Megahorn": "Bug", "Memento": "Dark", "Metal Burst": "Steel",
  "Metal Claw": "Steel", "Metal Sound": "Steel", "Meteor Assault": "Fighting",
  "Meteor Beam": "Rock", "Meteor Mash": "Steel", "Metronome": "Normal",
  "Mighty Cleave": "Rock", "Milk Drink": "Normal", "Mimic": "Normal",
  "Mind Blown": "Fire", "Mind Reader": "Normal", "Minimize": "Normal",
  "Miracle Eye": "Psychic", "Mirror Coat": "Psychic", "Mirror Move": "Flying",
  "Mist": "Ice", "Misty Explosion": "Fairy", "Misty Terrain": "Fairy",
  "Moonblast": "Fairy", "Moongeist Beam": "Ghost", "Moonlight": "Fairy",
  "Morning Sun": "Normal", "Mortal Spin": "Poison", "Mud Bomb": "Ground",
  "Mud Shot": "Ground", "Mud-Slap": "Ground", "Multi-Attack": "Normal",
  "Mystical Fire": "Fire", "Mystical Power": "Psychic", "Nasty Plot": "Dark",
  "Nature Power": "Normal", "Nature's Madness": "Fairy", "Needle Arm": "Grass",
  "Night Shade": "Ghost", "Night Slash": "Dark", "Nihil Light": "Dragon",
  "No Retreat": "Fighting", "Noble Roar": "Normal", "Noxious Torque": "Poison",
  "Nuzzle": "Electric", "Obstruct": "Dark", "Octazooka": "Water",
  "Octolock": "Fighting", "Odor Sleuth": "Normal", "Ominous Wind": "Ghost",
  "Order Up": "Dragon", "Origin Pulse": "Water", "Outrage": "Dragon",
  "Overdrive": "Electric", "Overheat": "Fire", "Pain Split": "Normal",
  "Parabolic Charge": "Electric", "Parting Shot": "Dark", "Pay Day": "Normal",
  "Payback": "Dark", "Perish Song": "Normal", "Petal Blizzard": "Grass",
  "Petal Dance": "Grass", "Phantom Force": "Ghost", "Photon Geyser": "Psychic",
  "Pin Missile": "Bug", "Play Nice": "Normal", "Play Rough": "Fairy",
  "Poison Fang": "Poison", "Poison Gas": "Poison", "Poison Jab": "Poison",
  "Poison Powder": "Poison", "Poison Tail": "Poison", "Pollen Puff": "Bug",
  "Poltergeist": "Ghost", "Population Bomb": "Normal", "Pounce": "Bug",
  "Pound": "Normal", "Powder": "Bug", "Power Gem": "Rock", "Power Split": "Psychic",
  "Power Swap": "Psychic", "Power Trip": "Dark", "Power Whip": "Grass",
  "Power-Up Punch": "Fighting", "Precipice Blades": "Ground",
  "Prismatic Laser": "Psychic", "Protect": "Normal", "Psybeam": "Psychic",
  "Psyblade": "Psychic", "Psychic": "Psychic", "Psychic Noise": "Psychic",
  "Psychic Terrain": "Psychic", "Psycho Cut": "Psychic", "Psyshock": "Psychic",
  "Psywave": "Psychic", "Punishment": "Dark", "Pursuit": "Dark",
  "Pyro Ball": "Fire", "Quash": "Dark", "Quick Attack": "Normal",
  "Quick Guard": "Fighting", "Quiver Dance": "Bug", "Rage": "Normal",
  "Rage Fist": "Ghost", "Rage Powder": "Bug", "Raging Bull": "Normal",
  "Raging Fury": "Fire", "Rain Dance": "Water", "Rapid Spin": "Normal",
  "Razor Leaf": "Grass", "Razor Shell": "Water", "Razor Wind": "Normal",
  "Recover": "Normal", "Recycle": "Normal", "Reflect": "Psychic",
  "Reflect Type": "Normal", "Relic Song": "Normal", "Rest": "Psychic",
  "Revival Blessing": "Normal", "Rising Voltage": "Electric", "Roar": "Normal",
  "Roar of Time": "Dragon", "Rock Blast": "Rock", "Rock Climb": "Normal",
  "Rock Polish": "Rock", "Rock Slide": "Rock", "Rock Smash": "Fighting",
  "Rock Tomb": "Rock", "Rock Wrecker": "Rock", "Role Play": "Psychic",
  "Rollout": "Rock", "Roost": "Flying", "Rototiller": "Ground",
  "Ruination": "Dark", "Safeguard": "Normal", "Salt Cure": "Rock",
  "Sand Attack": "Ground", "Sand Tomb": "Ground", "Sandstorm": "Rock",
  "Scald": "Water", "Scale Shot": "Dragon", "Scorching Sands": "Ground",
  "Scratch": "Normal", "Screech": "Normal", "Searing Shot": "Fire",
  "Seed Bomb": "Grass", "Seed Flare": "Grass", "Seismic Toss": "Fighting",
  "Self-Destruct": "Normal", "Shadow Ball": "Ghost", "Shadow Bone": "Ghost",
  "Shadow Claw": "Ghost", "Shadow Force": "Ghost", "Shadow Sneak": "Ghost",
  "Sharpen": "Normal", "Shed Tail": "Normal", "Sheer Cold": "Ice",
  "Shell Side Arm": "Poison", "Shell Smash": "Normal", "Shell Trap": "Fire",
  "Shelter": "Steel", "Shock Wave": "Electric", "Shore Up": "Ground",
  "Signal Beam": "Bug", "Silk Trap": "Bug", "Silver Wind": "Bug",
  "Simple Beam": "Normal", "Sing": "Normal", "Sketch": "Normal",
  "Skill Swap": "Psychic", "Skitter Smack": "Bug", "Skull Bash": "Normal",
  "Sky Attack": "Flying", "Sky Drop": "Flying", "Slack Off": "Normal",
  "Slash": "Normal", "Sleep Powder": "Grass", "Sleep Talk": "Normal",
  "Sludge Bomb": "Poison", "Sludge Wave": "Poison", "Smack Down": "Rock",
  "Smart Strike": "Steel", "Smelling Salts": "Normal", "Smog": "Poison",
  "Snap Trap": "Grass", "Snarl": "Dark", "Snatch": "Dark", "Snipe Shot": "Water",
  "Snowscape": "Ice", "Soak": "Water", "Soft-Boiled": "Normal",
  "Solar Beam": "Grass", "Sonic Boom": "Normal", "Spacial Rend": "Dragon",
  "Spark": "Electric", "Spectral Thief": "Ghost", "Spicy Extract": "Grass",
  "Spider Web": "Bug", "Spike Cannon": "Normal", "Spikes": "Ground",
  "Spiky Shield": "Grass", "Spin Out": "Steel", "Spirit Break": "Fairy",
  "Spirit Shackle": "Ghost", "Spite": "Ghost", "Spore": "Grass",
  "Spotlight": "Normal", "Stealth Rock": "Rock", "Steel Beam": "Steel",
  "Steel Roller": "Steel", "Steel Wing": "Steel", "Sticky Web": "Bug",
  "Stockpile": "Normal", "Stomping Tantrum": "Ground", "Stone Axe": "Rock",
  "Stone Edge": "Rock", "Stored Power": "Psychic", "Strange Steam": "Fairy",
  "Strength Sap": "Grass", "String Shot": "Bug", "Struggle": "Normal",
  "Struggle Bug": "Bug", "Stun Spore": "Grass", "Submission": "Fighting",
  "Substitute": "Normal", "Sucker Punch": "Dark", "Sunny Day": "Fire",
  "Sunsteel Strike": "Steel", "Super Fang": "Normal", "Supercell Slam": "Electric",
  "Superpower": "Fighting", "Supersonic": "Normal", "Surf": "Water",
  "Surging Strikes": "Water", "Swagger": "Normal", "Swallow": "Normal",
  "Sweet Scent": "Normal", "Swift": "Normal", "Switcheroo": "Dark",
  "Swords Dance": "Normal", "Synthesis": "Grass", "Syrup Bomb": "Grass",
  "Tachyon Cutter": "Steel", "Tackle": "Normal", "Tail Glow": "Bug",
  "Tail Slap": "Normal", "Tail Whip": "Normal", "Tailwind": "Flying",
  "Take Down": "Normal", "Take Heart": "Psychic", "Tar Shot": "Rock",
  "Taunt": "Dark", "Tearful Look": "Normal", "Teleport": "Psychic",
  "Temper Flare": "Fire", "Tera Blast": "Normal", "Tera Starstorm": "Normal",
  "Terrain Pulse": "Normal", "Thief": "Dark", "Thrash": "Normal",
  "Throat Chop": "Dark", "Thunder": "Electric", "Thunder Cage": "Electric",
  "Thunder Fang": "Electric", "Thunder Punch": "Electric", "Thunder Wave": "Electric",
  "Thunderbolt": "Electric", "Thunderclap": "Electric", "Tickle": "Normal",
  "Tidy Up": "Normal", "Topsy-Turvy": "Dark", "Torch Song": "Fire",
  "Torment": "Dark", "Toxic": "Poison", "Toxic Spikes": "Poison",
  "Toxic Thread": "Poison", "Trailblaze": "Grass", "Transform": "Normal",
  "Tri Attack": "Normal", "Trick": "Psychic", "Trick Room": "Psychic",
  "Triple Axel": "Ice", "Triple Dive": "Water", "Triple Kick": "Fighting",
  "Trop Kick": "Grass", "Twin Beam": "Psychic", "Twister": "Dragon",
  "U-turn": "Bug", "Upper Hand": "Fighting", "Uproar": "Normal",
  "V-create": "Fire", "Vacuum Wave": "Fighting", "Venom Drench": "Poison",
  "Venoshock": "Poison", "Vine Whip": "Grass", "Vital Throw": "Fighting",
  "Volt Switch": "Electric", "Wake-Up Slap": "Fighting", "Water Gun": "Water",
  "Water Pulse": "Water", "Waterfall": "Water", "Wave Crash": "Water",
  "Weather Ball": "Normal", "Whirlpool": "Water", "Whirlwind": "Normal",
  "Wicked Blow": "Dark", "Wicked Torque": "Dark", "Wide Guard": "Rock",
  "Wild Charge": "Electric", "Will-O-Wisp": "Fire", "Wish": "Normal",
  "Withdraw": "Water", "Wonder Room": "Psychic", "Wood Hammer": "Grass",
  "Work Up": "Normal", "Worry Seed": "Grass", "Wrap": "Normal",
  "Wring Out": "Normal", "X-Scissor": "Bug", "Yawn": "Normal",
  "Zap Cannon": "Electric", "Zen Headbutt": "Psychic",
  // Golpes em português (comuns nas fichas)
  "Raio": "Electric", "Trovão": "Electric", "Tempestade Elétrica": "Electric",
  "Bola de Fogo": "Fire", "Jato de Fogo": "Fire", "Vendaval Flamejante": "Fire",
  "Surfar": "Water", "Cachoeira": "Water", "Hidrobomba": "Water",
  "Terremoto": "Ground", "Escavação": "Ground", "Poder da Terra": "Ground",
  "Psicocinese": "Psychic", "Psicotropia": "Psychic", "Corte Psíquico": "Psychic",
  "Garra de Dragão": "Dragon", "Pulso do Dragão": "Dragon", "Dança do Dragão": "Dragon",
  "Bola Sombria": "Ghost", "Garra Sombria": "Ghost", "Força Fantasma": "Ghost",
  "Hiperespaço": "Normal", "Hiper Feixe": "Normal", "Impacto Giga": "Normal",
  "Folha Navalha": "Grass", "Tempestade de Folhas": "Grass", "Lâmina de Folha": "Grass",
  "Bola de Gelo": "Ice", "Soco de Gelo": "Ice",
  "Voo": "Flying", "Acrobacias": "Flying", "Ar Cortante": "Flying",
  "Luta Livre": "Fighting", "Soco de Trovão": "Fighting", "Destruidor": "Fighting",
  "Picada Venenosa": "Poison", "Bomba de Gosma": "Poison", "Tiro Tóxico": "Poison",
  "Cannon de Ferro": "Steel", "Cabeçada de Ferro": "Steel", "Asa de Aço": "Steel",
  "Fada Vento": "Fairy", "Brincadeira Selvagem": "Fairy",
  "Mordida": "Dark", "Triturar": "Dark", "Pulso Sombrio": "Dark",
  "Acelerador de Pedra": "Rock", "Deslize de Pedra": "Rock", "Queda de Pedra": "Rock",
  "Rajada de Inseto": "Bug", "Zumbido de Inseto": "Bug", "Tesoura": "Bug",
};

const MOVE_TYPE_MAP = new Map(
  Object.entries(MOVE_TYPE_MAP_RAW).map(([k, v]) => [k.toLowerCase().trim(), v])
);

/**
 * Retorna o tipo EN do golpe pelo nome, ou "" se não encontrado.
 */
export function getMoveType(moveName) {
  if (!moveName) return "";
  const key = String(moveName).toLowerCase().trim();
  return MOVE_TYPE_MAP.get(key) || "";
}

/**
 * Retorna a cor hex do tipo.
 */
export function getTypeColor(type) {
  return TYPE_COLORS[type] || TYPE_COLORS[normalizeType(type)] || "#666";
}
