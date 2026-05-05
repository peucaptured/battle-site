import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildResistanceQueue,
  resolveCombatEvent,
  validatePowerRule,
} from "../mm-rules-engine.js";
import {
  fallbackPowerRuleFromMove,
  normalizePowerName,
} from "../mm-power-catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const RESISTED_TYPES = new Set([
  "damage",
  "affliction",
  "weaken",
  "move_object",
  "teleport",
  "nullify",
  "transform",
  "mind_reading",
]);

const TYPES = [
  "Fire",
  "Water",
  "Electric",
  "Grass",
  "Ice",
  "Fighting",
  "Poison",
  "Ground",
  "Flying",
  "Psychic",
  "Bug",
  "Rock",
  "Ghost",
  "Dragon",
  "Dark",
  "Steel",
  "Fairy",
  "Force",
  "Cosmic",
  "Sonic",
  "Shadow",
  "Light",
];

const TRAIT_SETS = [
  ["Stgr"],
  ["Dodge"],
  ["Parry"],
  ["Thg"],
  ["Fortitude"],
  ["Will"],
  ["Int"],
  ["Initiative", "Dodge"],
  ["Stgr", "Thg"],
  ["Dodge", "Parry"],
  ["Fortitude", "Will"],
  ["Int", "Initiative"],
];

const AFFLICTION_SETS = [
  ["Dazed", "Stunned", "Incapacitated"],
  ["Impaired", "Disabled", "Incapacitated"],
  ["Vulnerable", "Defenseless", "Incapacitated"],
  ["Entranced", "Compelled", "Controlled"],
  ["Hindered", "Prone", "Incapacitated"],
  ["Fatigued", "Exhausted", "Incapacitated"],
  ["Dazed", "Stunned", "Transformed"],
];

const RESISTANCES = ["Toughness", "Fortitude", "Will", "Dodge", "Parry"];
const AREA_TYPES = ["Cloud", "Burst", "Cone", "Line", "Perception"];
const DESCRIPTORS = ["fire", "ice", "electric", "gravity", "sonic", "light", "shadow", "plant", "psychic", "metal", "water"];
const NAME_A = ["Prism", "Vector", "Aegis", "Pulse", "Cipher", "Nova", "Echo", "Lattice", "Crown", "Relay", "Mirage", "Anchor", "Circuit", "Bloom", "Ward"];
const NAME_B = ["Strike", "Veil", "Engine", "Field", "Bloom", "Lock", "Surge", "Frame", "Lance", "Shell", "Halo", "Step", "Bind", "Burst", "Signal"];

function parseArgs(argv) {
  const args = {
    generic: 120,
    pokemon: 120,
    seed: 20260505,
    outDir: path.join(root, "output"),
  };
  for (let i = 2; i < argv.length; i += 1) {
    const cur = argv[i];
    const next = argv[i + 1];
    if (cur === "--generic" && next) {
      args.generic = Math.max(0, parseInt(next, 10) || args.generic);
      i += 1;
    } else if (cur === "--pokemon" && next) {
      args.pokemon = Math.max(0, parseInt(next, 10) || args.pokemon);
      i += 1;
    } else if (cur === "--seed" && next) {
      args.seed = parseInt(next, 10) || args.seed;
      i += 1;
    } else if (cur === "--out" && next) {
      args.outDir = path.resolve(next);
      i += 1;
    }
  }
  return args;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function safeStr(value) {
  return value == null ? "" : String(value).trim();
}

function safeInt(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function pick(rng, values) {
  return values[Math.floor(rng() * values.length)];
}

function chance(rng, p) {
  return rng() < p;
}

function unique(values) {
  return Array.from(new Set((values || []).map(safeStr).filter(Boolean)));
}

function rank(rng, min = 1, max = 14) {
  return min + Math.floor(rng() * (max - min + 1));
}

function traits(rng) {
  return pick(rng, TRAIT_SETS).join(" & ");
}

function affliction(rng) {
  return pick(rng, AFFLICTION_SETS).join(", ");
}

function modifierSuffix(rng, kind = "general") {
  const mods = [];
  if (kind === "resistance") {
    if (chance(rng, 0.28)) mods.push("[Extra: Increased Range 1]");
    if (chance(rng, 0.20)) mods.push("[Extra: Accurate 2]");
    if (chance(rng, 0.18)) mods.push("[Extra: Improved Critical 1]");
    if (chance(rng, 0.16)) mods.push("[Extra: Multiattack]");
    if (chance(rng, 0.14)) mods.push("[Extra: Secondary Effect]");
    if (chance(rng, 0.12)) mods.push(`Area: ${pick(rng, AREA_TYPES)}`);
    if (chance(rng, 0.12)) mods.push("[Flaw: Unreliable]");
    if (chance(rng, 0.10)) mods.push("[Flaw: Limited (only against marked targets)]");
    if (chance(rng, 0.08)) mods.push("[Flaw: Recharge]");
  } else if (kind === "affliction") {
    if (chance(rng, 0.35)) mods.push("[Extra: Cumulative]");
    if (chance(rng, 0.18)) mods.push("[Extra: Progressive]");
    if (chance(rng, 0.16)) mods.push("[Extra: Increased Range 1]");
    if (chance(rng, 0.14)) mods.push(`Area: ${pick(rng, AREA_TYPES)}`);
    if (chance(rng, 0.10)) mods.push("[Flaw: Sense Dependent]");
    if (chance(rng, 0.08)) mods.push("[Flaw: Limited (only while target can perceive the user)]");
  } else {
    if (chance(rng, 0.22)) mods.push("[Extra: Increased Duration 2]");
    if (chance(rng, 0.18)) mods.push("[Extra: Affects Others]");
    if (chance(rng, 0.16)) mods.push(`Area: ${pick(rng, AREA_TYPES)}`);
    if (chance(rng, 0.12)) mods.push("[Extra: Selective]");
    if (chance(rng, 0.12)) mods.push("[Flaw: Fades]");
    if (chance(rng, 0.10)) mods.push("[Flaw: Limited (requires prepared focus)]");
    if (chance(rng, 0.08)) mods.push("[Flaw: Unreliable]");
  }
  return mods.length ? ` ${mods.join(" ")}` : "";
}

const GENERIC_EFFECTS = [
  {
    label: "Damage",
    family: "resistance",
    build: (rng, r) => `Damage ${r} (Resisted by Toughness)${modifierSuffix(rng, "resistance")}`,
  },
  {
    label: "Affliction",
    family: "affliction",
    build: (rng, r) => `Affliction ${r} (${affliction(rng)}; Resisted by ${pick(rng, ["Fortitude", "Will", "Dodge"])})${modifierSuffix(rng, "affliction")}`,
  },
  {
    label: "Weaken",
    family: "resistance",
    build: (rng, r) => `Weaken ${traits(rng)} ${Math.max(1, Math.floor(r / 2))} (Resisted by ${pick(rng, ["Fortitude", "Will"])})${modifierSuffix(rng, "resistance")}`,
  },
  {
    label: "Enhanced",
    family: "support",
    build: (rng, r) => `Enhanced ${traits(rng)} ${Math.max(1, Math.floor(r / 2))}${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Healing",
    family: "support",
    build: (rng, r) => `Healing ${Math.max(1, Math.floor(r / 2))}${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Environment",
    family: "active",
    build: (rng, r) => `Environment ${Math.max(1, Math.floor(r / 2))} (${pick(rng, DESCRIPTORS)})${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Create",
    family: "choice",
    build: (rng, r) => `Create ${r}${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Move Object",
    family: "resistance",
    build: (rng, r) => `Move Object ${r} (Resisted by Dodge)${modifierSuffix(rng, "resistance")}`,
  },
  {
    label: "Teleport",
    family: "resistance",
    build: (rng, r) => `Teleport ${Math.max(1, Math.floor(r / 2))} (Attack; Resisted by Dodge)${modifierSuffix(rng, "resistance")}`,
  },
  {
    label: "Nullify",
    family: "resistance",
    build: (rng, r) => `Nullify ${r} (${pick(rng, DESCRIPTORS)} effects; Resisted by Will)${modifierSuffix(rng, "resistance")}`,
  },
  {
    label: "Deflect",
    family: "reaction",
    build: (rng, r) => `Deflect ${r} [Extra: Reflect] [Extra: Redirect]${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Concealment",
    family: "active",
    build: (rng, r) => `Concealment ${Math.max(1, Math.floor(r / 2))}${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Summon",
    family: "choice",
    build: (rng, r) => `Summon ${Math.max(1, Math.floor(r / 2))}${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Transform",
    family: "resistance",
    build: (rng, r) => `Transform ${r} (Resisted by Fortitude)${modifierSuffix(rng, "resistance")}`,
  },
  {
    label: "Immunity",
    family: "active",
    build: (rng, r) => `Immunity ${Math.max(1, Math.floor(r / 3))} (${pick(rng, DESCRIPTORS)} descriptor)${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Variable",
    family: "choice",
    build: (rng, r) => `Variable ${Math.max(1, Math.floor(r / 2))} (${pick(rng, DESCRIPTORS)} array)${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Protection",
    family: "support",
    build: (rng, r) => `Protection ${Math.max(1, Math.floor(r / 2))}${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Regeneration",
    family: "support",
    build: (rng, r) => `Regeneration ${Math.max(1, Math.floor(r / 2))}${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Illusion",
    family: "choice",
    build: (rng, r) => `Illusion ${Math.max(1, Math.floor(r / 2))}${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Mind Reading",
    family: "resistance",
    build: (rng, r) => `Mind Reading ${r} (Resisted by Will)${modifierSuffix(rng, "resistance")}`,
  },
  {
    label: "Insubstantial",
    family: "active",
    build: (rng, r) => `Insubstantial ${Math.max(1, Math.floor(r / 3))}${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Growth",
    family: "choice",
    build: (rng, r) => `Growth ${Math.max(1, Math.floor(r / 3))}${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Shrinking",
    family: "choice",
    build: (rng, r) => `Shrinking ${Math.max(1, Math.floor(r / 3))}${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Quickness",
    family: "support",
    build: (rng, r) => `Quickness ${Math.max(1, Math.floor(r / 2))}${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Senses",
    family: "support",
    build: (rng, r) => `Senses ${Math.max(1, Math.floor(r / 2))} (${pick(rng, ["darkvision", "radius hearing", "danger sense"])})${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Speed",
    family: "support",
    build: (rng, r) => `Speed ${Math.max(1, Math.floor(r / 2))}${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Flight",
    family: "support",
    build: (rng, r) => `Flight ${Math.max(1, Math.floor(r / 2))}${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Burrowing",
    family: "support",
    build: (rng, r) => `Burrowing ${Math.max(1, Math.floor(r / 2))}${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Swimming",
    family: "support",
    build: (rng, r) => `Swimming ${Math.max(1, Math.floor(r / 2))}${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Leaping",
    family: "support",
    build: (rng, r) => `Leaping ${Math.max(1, Math.floor(r / 2))}${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Communication",
    family: "support",
    build: (rng, r) => `Communication ${Math.max(1, Math.floor(r / 3))} (${pick(rng, ["radio", "mental", "sonic"])})${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Comprehend",
    family: "support",
    build: (rng, r) => `Comprehend ${Math.max(1, Math.floor(r / 3))} (${pick(rng, ["languages", "machines", "plants"])})${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Remote Sensing",
    family: "support",
    build: (rng, r) => `Remote Sensing ${Math.max(1, Math.floor(r / 2))} (${pick(rng, ["visual", "auditory", "mental"])})${modifierSuffix(rng, "support")}`,
  },
  {
    label: "Feature",
    family: "support",
    build: (rng) => `Feature 1 (${pick(rng, ["micro-tool", "secure badge", "breathing filter", "signal tag"])})`,
  },
];

const POKEMON_BLUEPRINTS = [
  { move: "Overheat", type: "Fire", category: "Especial", build: (rng, r) => `Damage ${r} [Extra: Increased Range 1]${chance(rng, 0.45) ? " [Flaw: Unreliable]" : ""}` },
  { move: "Draco Meteor", type: "Dragon", category: "Especial", build: (rng, r) => `Damage ${r} Area: Burst [Flaw: Limited (open sky)]` },
  { move: "Leaf Storm", type: "Grass", category: "Especial", build: (rng, r) => `Damage ${r}; Linked Move Object ${Math.max(1, Math.floor(r / 2))} (Resisted by Dodge)` },
  { move: "Superpower", type: "Fighting", category: "Fisico", build: (rng, r) => `Damage ${r}; Linked Weaken Thg ${Math.max(1, Math.floor(r / 3))} (Resisted by Fortitude)` },
  { move: "Close Combat", type: "Fighting", category: "Fisico", build: (rng, r) => `Damage ${r} [Extra: Multiattack] [Flaw: Limited (adjacent only)]` },
  { move: "Ice Hammer", type: "Ice", category: "Fisico", build: (rng, r) => `Damage ${r}; Linked Weaken Initiative & Dodge 1 (Resisted by Fortitude)` },
  { move: "V-create", type: "Fire", category: "Fisico", build: (rng, r) => `Damage ${r} Area: Cone [Flaw: Recharge]` },
  { move: "Thunder Shock", type: "Electric", category: "Especial", build: (rng, r) => chance(rng, 0.75)
    ? `Affliction ${r} (Dazed, Stunned, Paralyzed; Resisted by Fortitude) [Extra: Cumulative]`
    : `Affliction ${r} (Dazed, Stunned, Burn; Resisted by Fortitude) [Extra: Cumulative]` },
  { move: "Thunderbolt", type: "Electric", category: "Especial", build: (rng, r) => `Damage ${r}; Linked Affliction ${Math.max(1, Math.floor(r / 2))} (Dazed, Stunned, Paralyzed; Resisted by Fortitude)` },
  { move: "Ember", type: "Fire", category: "Especial", build: (rng, r) => `Damage ${r}; Linked Affliction ${Math.max(1, Math.floor(r / 2))} (Dazed, Stunned, Burn; Resisted by Fortitude) [Extra: Secondary Effect]` },
  { move: "Will-O-Wisp", type: "Fire", category: "Status", build: (rng, r) => `Affliction ${r} (Impaired, Disabled, Burn; Resisted by Dodge) [Extra: Increased Range 1]` },
  { move: "Toxic", type: "Poison", category: "Status", build: (rng, r) => `Affliction ${r} (Dazed, Stunned, Poisoned; Resisted by Fortitude) [Extra: Progressive]` },
  { move: "Recover", type: "Normal", category: "Status", build: (rng, r) => `Healing ${Math.max(1, Math.floor(r / 2))} [Flaw: Limited (self only)]` },
  { move: "Aqua Ring", type: "Water", category: "Status", build: (rng, r) => `Regeneration ${Math.max(1, Math.floor(r / 3))} [Extra: Sustained]` },
  { move: "Protect", type: "Normal", category: "Status", build: (rng, r) => `Deflect ${r} [Extra: Reflect] [Flaw: Unreliable]` },
  { move: "Rain Dance", type: "Water", category: "Status", build: (rng, r) => `Environment ${Math.max(1, Math.floor(r / 2))} (rain) Area: Burst [Extra: Selective]` },
  { move: "Sandstorm", type: "Rock", category: "Status", build: (rng, r) => `Environment ${Math.max(1, Math.floor(r / 2))} (sand) Area: Cloud; Linked Damage ${Math.max(1, Math.floor(r / 3))} [Flaw: Limited (non-rock targets)]` },
  { move: "Swords Dance", type: "Normal", category: "Status", build: (rng, r) => `Enhanced Stgr ${Math.max(1, Math.floor(r / 2))} [Flaw: Limited (self only)]` },
  { move: "Agility", type: "Psychic", category: "Status", build: (rng, r) => `Enhanced Initiative & Dodge ${Math.max(1, Math.floor(r / 2))} [Extra: Increased Duration 2]` },
  { move: "Iron Defense", type: "Steel", category: "Status", build: (rng, r) => `Protection ${Math.max(1, Math.floor(r / 2))}; Enhanced Thg ${Math.max(1, Math.floor(r / 3))}` },
  { move: "Growl", type: "Normal", category: "Status", build: (rng, r) => `Weaken Stgr ${Math.max(1, Math.floor(r / 2))} (Resisted by Will) Area: Cone [Extra: Selective]` },
  { move: "Teleport", type: "Psychic", category: "Status", build: (rng, r) => `Teleport ${Math.max(1, Math.floor(r / 2))} [Extra: Increased Range 1]` },
  { move: "Volt Switch", type: "Electric", category: "Especial", build: (rng, r) => `Damage ${r}; Linked Movement ${Math.max(1, Math.floor(r / 3))} [Flaw: Limited (must reposition)]` },
  { move: "U-turn", type: "Bug", category: "Fisico", build: (rng, r) => `Damage ${r}; Linked Movement ${Math.max(1, Math.floor(r / 3))} [Flaw: Limited (must return)]` },
  { move: "Hyper Beam", type: "Normal", category: "Especial", build: (rng, r) => `Damage ${r} [Extra: Penetrating 1] [Flaw: Recharge]` },
  { move: "Solar Beam", type: "Grass", category: "Especial", build: (rng, r) => `Damage ${r} [Extra: Increased Range 1] [Flaw: Increased Action]` },
  { move: "Explosion", type: "Normal", category: "Fisico", build: (rng, r) => `Damage ${r} Area: Burst [Flaw: Side Effect (Incapacitated Self)]` },
  { move: "Leech Seed", type: "Grass", category: "Status", build: (rng, r) => `Weaken Fortitude ${Math.max(1, Math.floor(r / 2))} (Resisted by Fortitude); Linked Regeneration ${Math.max(1, Math.floor(r / 4))}` },
  { move: "Confuse Ray", type: "Ghost", category: "Status", build: (rng, r) => `Affliction ${r} (Dazed, Compelled, Controlled; Resisted by Will) [Extra: Cumulative]` },
  { move: "Roost", type: "Flying", category: "Status", build: (rng, r) => `Healing ${Math.max(1, Math.floor(r / 2))}; Linked Protection ${Math.max(1, Math.floor(r / 4))} [Flaw: Limited (grounded)]` },
];

function buildGenericMove(index, rng) {
  const r = rank(rng, 2, 14);
  const primary = pick(rng, GENERIC_EFFECTS);
  const segments = [primary.build(rng, r)];
  if (chance(rng, 0.42)) {
    const secondaryPool = GENERIC_EFFECTS.filter((effect) => effect.label !== primary.label);
    const secondary = pick(rng, secondaryPool);
    const raw = secondary.build(rng, Math.max(1, Math.floor(r * (0.45 + rng() * 0.45))));
    segments.push(`${RESISTED_TYPES.has(normalizePowerName(secondary.label).replace(/-/g, "_")) ? "Linked " : ""}${raw}`);
  }
  if (chance(rng, 0.18)) {
    segments.push(`Feature 1 (${pick(rng, ["control rune", "tracking spark", "recall mark", "safe channel"])})`);
  }

  return {
    group: "generic_mm3e",
    name: `${pick(rng, NAME_A)} ${pick(rng, NAME_B)} ${String(index + 1).padStart(3, "0")}`,
    rank: r,
    type: pick(rng, TYPES),
    category: pick(rng, ["Attack", "Defense", "Utility", "Movement", "Sensory", "Control"]),
    build: segments.join("; "),
  };
}

function buildPokemonMove(index, rng) {
  const r = rank(rng, 4, 18);
  const blueprint = POKEMON_BLUEPRINTS[index % POKEMON_BLUEPRINTS.length];
  const codename = `${pick(rng, NAME_A)} ${pick(rng, NAME_B)}`;
  return {
    group: "pokemon_move",
    name: `${blueprint.move}: Generated ${codename} ${String(index + 1).padStart(3, "0")}`,
    rank: r,
    type: blueprint.type,
    category: blueprint.category,
    build: blueprint.build(rng, r),
    pokemonMove: blueprint.move,
  };
}

function hasResistanceEffect(rule) {
  return (rule.effects || []).some((effect) => RESISTED_TYPES.has(safeStr(effect?.type)));
}

function combatant(owner, index, hp = 6) {
  return {
    owner,
    pid: String(index + 1),
    pieceId: `${owner}-${index + 1}`,
    hp,
    conditions: { deg1: [], deg2: [], deg3: [] },
    pokemonConditions: [],
    statBoosts: {},
    stats: { speed: 8, initiative: 8, dodge: 8, parry: 8, thg: 8, fort: 8, will: 8 },
  };
}

function runCase(input, index) {
  const rule = fallbackPowerRuleFromMove({
    name: input.name,
    rank: input.rank,
    type: input.type,
    category: input.category,
    build: input.build,
  });
  const validation = validatePowerRule(rule);
  const resistance = hasResistanceEffect(rule);
  const shouldFailResistance = resistance && index % 4 !== 0;
  const statValue = shouldFailResistance ? 0 : 50;
  const event = {
    type: resistance ? "resistanceCheck" : "immediatePower",
    id: `generated:${index + 1}`,
    powerRule: rule,
    actor: combatant("Actor", index, 5),
    target: combatant("Target", index, 6),
    d20: shouldFailResistance ? 3 + (index % 3) : 20,
    stats: { thg: statValue, fort: statValue, will: statValue, dodge: statValue, parry: statValue },
    rank: input.rank,
    unreliableRolls: Object.fromEntries((rule.effects || []).filter((effect) => effect.unreliable).map((effect, effectIndex) => [effect.id, effectIndex % 2 ? 75 : 25])),
  };

  let resolution = null;
  let thrown = null;
  try {
    resolution = resolveCombatEvent(event);
  } catch (err) {
    thrown = err;
  }

  const checks = [];
  const addCheck = (ok, code, message, detail = {}) => {
    checks.push({ status: ok ? "pass" : "fail", code, message, ...detail });
  };

  const conflictCount = rule.pokemonCore?.conflicts?.length || 0;
  addCheck((rule.effects || []).length > 0 || conflictCount > 0, "parsed_or_quarantined", "Build parsed into effects or quarantined by Pokemon core conflict.");
  addCheck(!thrown, "resolution_no_throw", "Resolution must not throw.", thrown ? { error: thrown.message } : {});
  addCheck(!["invalid", "unsupported"].includes(validation.status), "validation_supported", "Validation must not be invalid or unsupported.", { status: validation.status });
  if (resistance && resolution) {
    const expected = buildResistanceQueue(rule, { rank: input.rank }).filter((item) => item.effect);
    addCheck(
      (resolution.effectResults || []).length >= Math.min(expected.length, 1) || expected.length === 0,
      "resistance_result_present",
      "At least one structured resisted effect should produce an effect result.",
      { expected: expected.length, actual: (resolution.effectResults || []).length },
    );
  }
  if (conflictCount) {
    addCheck(
      (validation.pendingDecisionTemplates || []).some((decision) => decision.decisionType === "pokemon_core_conflict")
        || (resolution?.pendingDecisions || []).some((decision) => decision.decisionType === "pokemon_core_conflict"),
      "pokemon_core_decision_present",
      "Pokemon core conflicts must surface as pending decisions.",
    );
  }

  const failCount = checks.filter((check) => check.status === "fail").length;
  const pendingCount = (validation.pendingDecisionTemplates || []).length + (resolution?.pendingDecisions || []).length;
  const decisionLike = pendingCount > 0 || validation.status === "needsReview" || !!resolution?.requiresAdjudication;
  const result = failCount > 0
    ? "not_working"
    : decisionLike
      ? "needs_decision"
      : "working";

  return {
    index: index + 1,
    group: input.group,
    name: input.name,
    pokemonMove: input.pokemonMove || "",
    build: input.build,
    parsed: {
      id: rule.id,
      source: rule.source,
      effectTypes: unique((rule.effects || []).map((effect) => effect.type)),
      modifiers: unique((rule.effects || []).flatMap((effect) => [
        ...(effect.extras || []),
        ...(effect.flaws || []),
        effect.cumulative ? "Cumulative" : "",
        effect.secondaryEffect ? "Secondary Effect" : "",
        effect.unreliable ? "Unreliable" : "",
        effect.limited ? "Limited" : "",
      ])),
      pokemonCore: rule.pokemonCore || null,
    },
    validation: {
      status: validation.status,
      issueCodes: unique((validation.issues || []).map((issue) => issue.code)),
      pendingDecisionTypes: unique((validation.pendingDecisionTemplates || []).map((decision) => decision.decisionType)),
    },
    simulation: resolution ? {
      kind: resolution.kind,
      requiresAdjudication: !!resolution.requiresAdjudication,
      pendingDecisionTypes: unique((resolution.pendingDecisions || []).map((decision) => decision.decisionType)),
      patchKinds: unique((resolution.patches || []).map((patch) => patch.kind)),
      summary: resolution.summary,
    } : {
      kind: "thrown",
      error: thrown?.message || "unknown error",
    },
    result,
    checks,
  };
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item);
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function mdEscape(value) {
  return safeStr(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function writeMarkdown(report, outputPath) {
  const lines = [];
  lines.push("# Random M&M 3e Build Validation");
  lines.push("");
  lines.push(`Seed: \`${report.seed}\``);
  lines.push(`Generated: \`${report.generatedAt}\``);
  lines.push(`Total builds: \`${report.total}\``);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Bucket | Count |");
  lines.push("|---|---:|");
  for (const [key, value] of Object.entries(report.summary.result)) lines.push(`| ${key} | ${value} |`);
  lines.push("");
  lines.push("## By Group");
  lines.push("");
  lines.push("| Group | Count |");
  lines.push("|---|---:|");
  for (const [key, value] of Object.entries(report.summary.group)) lines.push(`| ${key} | ${value} |`);
  lines.push("");
  lines.push("## Cases");
  lines.push("");
  lines.push("| # | Group | Result | Validation | Effects | Decisions | Name | Build |");
  lines.push("|---:|---|---|---|---|---|---|---|");
  for (const item of report.cases) {
    const decisions = unique([
      ...item.validation.pendingDecisionTypes,
      ...item.simulation.pendingDecisionTypes,
    ]).join(", ") || "-";
    lines.push(`| ${item.index} | ${item.group} | ${item.result} | ${item.validation.status} | ${mdEscape(item.parsed.effectTypes.join("+") || "-")} | ${mdEscape(decisions)} | ${mdEscape(item.name)} | ${mdEscape(item.build)} |`);
  }
  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
}

const args = parseArgs(process.argv);
const rng = mulberry32(args.seed);
const generated = [];
for (let i = 0; i < args.generic; i += 1) generated.push(buildGenericMove(i, rng));
for (let i = 0; i < args.pokemon; i += 1) generated.push(buildPokemonMove(i, rng));

const cases = generated.map((item, index) => runCase(item, index));
const total = cases.length;
const outputBase = `random-mm-build-validation-${total}-seed-${args.seed}`;
fs.mkdirSync(args.outDir, { recursive: true });
const jsonPath = path.join(args.outDir, `${outputBase}.json`);
const mdPath = path.join(args.outDir, `${outputBase}.md`);

const report = {
  schema: "RandomMmBuildValidation",
  schemaVersion: 1,
  seed: args.seed,
  generatedAt: new Date().toISOString(),
  requestedMinimum: 200,
  total,
  generator: {
    generic: args.generic,
    pokemon: args.pokemon,
    note: "Generated builds are synthetic and are not copied from the catalog.",
  },
  summary: {
    result: countBy(cases, (item) => item.result),
    group: countBy(cases, (item) => item.group),
    validation: countBy(cases, (item) => item.validation.status),
    effectTypes: countBy(cases.flatMap((item) => item.parsed.effectTypes), (item) => item || "none"),
    decisionTypes: countBy(cases.flatMap((item) => [...item.validation.pendingDecisionTypes, ...item.simulation.pendingDecisionTypes]), (item) => item || "none"),
  },
  cases,
};

fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
writeMarkdown(report, mdPath);

console.log(`Generated ${total} random builds.`);
console.log(`Result: ${JSON.stringify(report.summary.result)}`);
console.log(`Validation: ${JSON.stringify(report.summary.validation)}`);
console.log(`JSON: ${jsonPath}`);
console.log(`Markdown: ${mdPath}`);

if (total < 200) process.exitCode = 1;
