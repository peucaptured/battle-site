function safeStr(value) {
  return value == null ? "" : String(value).trim();
}

export function normalizePokemonMoveKey(value) {
  return safeStr(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

// PokeAPI base power data for moves at or above the Ga'Al high-power threshold.
// Only threshold-relevant moves are listed; unlisted moves have no automatic bonus.
const HIGH_BASE_POWER_BY_KEY = Object.freeze({
  megakick: 120,
  thrash: 120,
  doubleedge: 120,
  hydropump: 110,
  blizzard: 110,
  hyperbeam: 150,
  solarbeam: 120,
  petaldance: 120,
  thunder: 110,
  selfdestruct: 200,
  fireblast: 110,
  skullbash: 130,
  highjumpkick: 130,
  skyattack: 140,
  explosion: 250,
  zapcannon: 120,
  outrage: 120,
  megahorn: 120,
  futuresight: 120,
  focuspunch: 150,
  superpower: 120,
  eruption: 150,
  blastburn: 150,
  hydrocannon: 150,
  overheat: 130,
  waterspout: 150,
  frenzyplant: 150,
  volttackle: 120,
  doomdesire: 140,
  psychoboost: 140,
  closecombat: 120,
  lastresort: 140,
  flareblitz: 120,
  focusblast: 120,
  bravebird: 120,
  gigaimpact: 150,
  dracometeor: 130,
  leafstorm: 130,
  powerwhip: 120,
  rockwrecker: 150,
  gunkshot: 120,
  woodhammer: 120,
  headsmash: 150,
  roaroftime: 150,
  seedflare: 120,
  shadowforce: 120,
  synchronoise: 120,
  hurricane: 110,
  headcharge: 120,
  technoblast: 120,
  boltstrike: 130,
  blueflare: 130,
  freezeshock: 140,
  iceburn: 140,
  vcreate: 180,
  belch: 120,
  boomburst: 140,
  steameruption: 110,
  lightofruin: 140,
  originpulse: 110,
  precipiceblades: 120,
  dragonascent: 120,
  catastropika: 210,
  solarblade: 125,
  burnup: 130,
  clangingscales: 110,
  sinisterarrowraid: 180,
  maliciousmoonsault: 180,
  oceanicoperetta: 195,
  soulstealing7starstrike: 195,
  stokedsparksurfer: 175,
  pulverizingpancake: 210,
  genesissupernova: 185,
  shelltrap: 150,
  fleurcannon: 130,
  prismaticlaser: 160,
  multiattack: 120,
  "10000000voltthunderbolt": 195,
  mindblown: 150,
  lightthatburnsthesky: 200,
  searingsunrazesmash: 200,
  menacingmoonrazemaelstrom: 200,
  letssnuggleforever: 190,
  splinteredstormshards: 190,
  clangoroussoulblaze: 185,
  sparklyswirl: 120,
  pyroball: 120,
  aurawheel: 110,
  meteorassault: 150,
  eternabeam: 160,
  steelbeam: 140,
  steelroller: 130,
  meteorbeam: 120,
  poltergeist: 110,
  dragonenergy: 150,
  glaciallance: 120,
  astralbarrage: 120,
  ragingfury: 120,
  wavecrash: 120,
  chloroblast: 150,
  headlongrush: 120,
  axekick: 120,
  glaiverush: 120,
  makeitrain: 120,
  armorcannon: 120,
  doubleshock: 120,
  gigatonhammer: 160,
  bloodmoon: 140,
  electroshot: 130,
  terastarstorm: 120,
  shadowend: 120,
});

export function getPokemonMoveBasePower(name) {
  return HIGH_BASE_POWER_BY_KEY[normalizePokemonMoveKey(name)] || 0;
}

export function getPokemonBasePowerDamageBonus(basePower) {
  const power = Number(basePower);
  if (!Number.isFinite(power)) return 0;
  if (power >= 151) return 10;
  if (power >= 101) return 5;
  return 0;
}
