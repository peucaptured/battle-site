const CATALOG_URL = "./assets/rules/moves-mm.json";

import { isMmSupportEffect, isMmTrackableActiveEffect, validatePowerRule } from "./mm-rulebook.js?v=20260504mm10";
import {
  getPokemonBasePowerDamageBonus,
  getPokemonMoveBasePower,
} from "./pokemon-move-power-bonus.js?v=20260504mm1";

let catalogPromise = null;
let catalogCache = null;
let nameIndex = null;

function safeStr(value) {
  return value == null ? "" : String(value).trim();
}

function safeInt(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || null));
}

export function normalizePowerName(value) {
  return safeStr(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeText(value) {
  return safeStr(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function splitTopLevel(value) {
  const text = safeStr(value);
  const out = [];
  let start = 0;
  let paren = 0;
  let bracket = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") paren += 1;
    else if (ch === ")") paren = Math.max(0, paren - 1);
    else if (ch === "[") bracket += 1;
    else if (ch === "]") bracket = Math.max(0, bracket - 1);
    else if (ch === ";" && paren === 0 && bracket === 0) {
      const piece = text.slice(start, i).trim();
      if (piece) out.push(piece);
      start = i + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) out.push(last);
  return out;
}

const EFFECT_LABELS = Object.freeze([
  ["damage", "Strength-based Damage"],
  ["damage", "Damage"],
  ["affliction", "Affliction"],
  ["affliction", "Dazzle"],
  ["weaken", "Weaken"],
  ["enhanced_trait", "Enhanced Trait"],
  ["enhanced_trait", "Enhanced"],
  ["enhanced_trait", "Seize Initiative"],
  ["healing", "Healing"],
  ["environment", "Environment"],
  ["create", "Create"],
  ["move_object", "Move Object"],
  ["movement", "Movement"],
  ["teleport", "Teleport"],
  ["nullify", "Nullify"],
  ["deflect", "Deflect"],
  ["concealment", "Concealment"],
  ["summon", "Summon"],
  ["transform", "Transform"],
  ["transform", "Morph"],
  ["immunity", "Immunity"],
  ["variable", "Variable"],
  ["protection", "Protection"],
  ["regeneration", "Regeneration"],
  ["illusion", "Illusion"],
  ["mind_reading", "Mind Reading"],
  ["insubstantial", "Insubstantial"],
  ["growth", "Growth"],
  ["shrinking", "Shrinking"],
  ["quickness", "Quickness"],
  ["elongation", "Elongation"],
  ["immortality", "Immortality"],
  ["luck_control", "Luck Control"],
  ["extra_limbs", "Extra Limbs"],
  ["senses", "Senses"],
  ["speed", "Speed"],
  ["flight", "Flight"],
  ["burrowing", "Burrowing"],
  ["swimming", "Swimming"],
  ["leaping", "Leaping"],
  ["communication", "Communication"],
  ["comprehend", "Comprehend"],
  ["remote_sensing", "Remote Sensing"],
  ["feature", "Feature"],
]);

function effectKeywordRegex() {
  return new RegExp(`\\b(?:${EFFECT_LABELS.map(([, label]) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");
}

const EFFECT_KEYWORD_RE = effectKeywordRegex();

function isModifierOnlySegment(segment) {
  const text = normalizeText(segment);
  if (!text) return false;
  if (EFFECT_KEYWORD_RE.test(segment)) return false;
  return /\b(?:dc|resisted by|affects|1st degree|2nd degree|3rd degree|limited|custom|cumulative|progressive|area|increased range|extended range|triggered|reflect|redirect|redirection|energizing|restorative)\b/.test(text);
}

function mergeModifierOnlySegments(segments) {
  const out = [];
  for (const segment of segments) {
    if (isModifierOnlySegment(segment) && out.length) {
      out[out.length - 1] = `${out[out.length - 1]}; ${segment}`;
    } else {
      out.push(segment);
    }
  }
  return out;
}

function normalizeResistanceLabel(value) {
  const raw = normalizePowerName(value).replace(/-/g, " ");
  const aliases = {
    toughness: "thg",
    resistencia: "thg",
    resistance: "thg",
    thg: "thg",
    defense: "thg",
    def: "thg",
    fortitude: "fort",
    fort: "fort",
    will: "will",
    dodge: "dodge",
    parry: "parry",
  };
  return aliases[raw] || raw.replace(/\s+/g, "_") || "";
}

function normalizeStatLabel(value) {
  const raw = normalizePowerName(value).replace(/-/g, " ");
  const aliases = {
    stgr: "stgr",
    strength: "stgr",
    attack: "stgr",
    atk: "stgr",
    thg: "thg",
    toughness: "thg",
    defense: "thg",
    def: "thg",
    will: "will",
    "sp def": "will",
    spdef: "will",
    "special defense": "will",
    int: "int",
    intelect: "int",
    intellect: "int",
    "special attack": "int",
    spatk: "int",
    dodge: "dodge",
    evasion: "dodge",
    initiative: "initiative",
    speed: "initiative",
    parry: "parry",
    fortitude: "fortitude",
    fort: "fortitude",
    accuracy: "acerto",
    acerto: "acerto",
  };
  return aliases[raw] || raw.replace(/\s+/g, "_") || "";
}

function splitTraitList(value) {
  return safeStr(value)
    .replace(/\b(?:and|e)\b/gi, "&")
    .split(/&|\/|,/)
    .map((item) => normalizeStatLabel(item.replace(/\b-?\d+\b/g, "")))
    .filter(Boolean);
}

function selfOnlyText(value) {
  const text = normalizeText(value);
  return /\baffects only self\b/.test(text)
    || /\bonly self\b/.test(text)
    || /\bself only\b/.test(text)
    || /\bapenas (?:o )?(?:proprio )?usuario\b/.test(text)
    || /\bso (?:o )?(?:proprio )?usuario\b/.test(text)
    || /\bapenas em si\b/.test(text);
}

function parseRank(segment, label, fallback = null) {
  const labels = Array.from(new Set([label, label === "Damage" ? "Strength-based Damage" : "", "Rank"].filter(Boolean)));
  for (const item of labels) {
    const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = segment.match(new RegExp(`\\b${escaped}\\s*[=:]?\\s*(-?\\d+)\\b`, "i"));
    if (match) return { source: "fixed", value: safeInt(match[1], 0) };
  }
  if (["Weaken", "Enhanced Trait", "Enhanced"].includes(label)) {
    const traitRank = segment.match(/\b(?:Weaken|Enhanced(?: Trait)?)\b[^\d;[\]]*(-?\d+)\b/i);
    if (traitRank) return { source: "fixed", value: safeInt(traitRank[1], 0) };
  }
  const rankMatch = segment.match(/\bRank\s*=\s*(-?\d+)\b/i);
  if (rankMatch) return { source: "fixed", value: safeInt(rankMatch[1], 0) };
  if (Number.isFinite(Number(fallback)) && Number(fallback) !== 0) {
    return { source: "fixed", value: safeInt(fallback, 0) };
  }
  return { source: "move", value: null };
}

function stripBuildPrefix(segment) {
  let text = safeStr(segment);
  text = text.replace(/^Linked\s+/i, "");
  text = text.replace(/^AE\d+\s*(?:\([^)]*\))?\s*:\s*/i, "");
  const colon = text.indexOf(":");
  if (colon >= 0 && EFFECT_KEYWORD_RE.test(text.slice(colon + 1))) {
    text = text.slice(colon + 1).trim();
  }
  text = text.replace(/^(?:Cumulative|Progressive|Broad|Concentration|Simultaneous|Perception|Close|Ranged|Cloud|Line|Cone|Burst|Area)\s+/ig, "");
  text = text.replace(/^(?:Perception\s+Area|Close\s+Area|Ranged\s+Area|Cloud\s+Area|Line\s+Area|Cone\s+Area|Burst\s+Area|Area)\s+/i, "");
  return text.trim();
}

function effectTypeFromSegment(segment, moveName = "") {
  const candidates = [stripBuildPrefix(segment), safeStr(moveName)];
  for (const candidate of candidates) {
    for (const [type, label] of EFFECT_LABELS) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`^${escaped}\\b`, "i").test(candidate) || (label === "Deflect" && /\bdeflect\b/i.test(candidate))) {
        return { type, label: label === "Strength-based Damage" ? "Damage" : label };
      }
    }
  }
  return { type: "custom", label: "Custom" };
}

function parseModifiers(segment) {
  const extras = [];
  const flaws = [];
  const canonicalModifierText = (value) => safeStr(value).replace(/\bUnrealible\b/gi, "Unreliable");
  const pushMatchedModifier = (bucket, label) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const match = segment.match(new RegExp(`\\b${escaped}(?:\\s+\\d+)?\\b`, "i"));
    const value = safeStr(match?.[0] || label);
    if (value && !bucket.some((item) => normalizePowerName(item).startsWith(normalizePowerName(label)))) {
      bucket.push(value);
    }
  };
  const flags = {
    linked: /\bLinked\b/i.test(segment),
    secondaryEffect: /\bSecondary Effect\b/i.test(segment),
    fades: /\bFades\b/i.test(segment),
    unreliable: /\b(?:Unreliable|Unrealible)\b/i.test(segment),
    reaction: /\bReaction\b/i.test(segment),
    selective: /\bSelective\b/i.test(segment),
    limited: /\bLimited\b/i.test(segment),
    progressive: /\bProgressive\b/i.test(segment),
    cumulative: /\bCumulative\b/i.test(segment),
    multiattack: /\bMultiattack\b/i.test(segment),
  };
  for (const match of segment.matchAll(/\[Extra:\s*([^\]]+)\]/gi)) extras.push(match[1].trim());
  for (const match of segment.matchAll(/\[Flaw:\s*([^\]]+)\]/gi)) flaws.push(canonicalModifierText(match[1].trim()));
  for (const [key, label] of [
    ["secondaryEffect", "Secondary Effect"],
    ["reaction", "Reaction"],
    ["selective", "Selective"],
    ["progressive", "Progressive"],
    ["cumulative", "Cumulative"],
    ["multiattack", "Multiattack"],
  ]) {
    if (flags[key] && !extras.includes(label)) extras.push(label);
  }
  for (const label of [
    "Accurate",
    "Affects Others",
    "Affects Objects",
    "Alternate Resistance",
    "Broad",
    "Counter",
    "Extra Condition",
    "Increased Range",
    "Extended Range",
    "Increased Duration",
    "Improved Critical",
    "Indirect",
    "Penetrating",
    "Persistent",
    "Precise",
    "Resurrection",
    "Stackable",
    "Subtle",
    "Triggered",
    "Variable Descriptor",
    "Reflect",
    "Redirect",
    "Redirection",
  ]) {
    if (new RegExp(`\\b${label.replace(/\s+/g, "\\s+")}\\b`, "i").test(segment)) {
      pushMatchedModifier(extras, label);
    }
  }
  for (const label of ["Inaccurate", "Check Required", "Sense Dependent", "Side Effect", "Reduced Range", "Diminished Range", "Increased Action", "Tiring", "Uncontrolled", "Recharge", "Delayed", "Quirk"]) {
    if (new RegExp(`\\b${label.replace(/\s+/g, "\\s+")}\\b`, "i").test(segment)) {
      pushMatchedModifier(flaws, label);
    }
  }
  if ((/\b(?:Perception|Cloud|Line|Cone|Burst)\s+Area\b/i.test(segment) || /\bArea\s*:/i.test(segment)) && !extras.some((item) => normalizePowerName(item).includes("area"))) {
    const area = segment.match(/\b(Perception|Cloud|Line|Cone|Burst)\s+Area\b/i)?.[0]
      || segment.match(/\bArea\s*:\s*([^;()[\]]+)/i)?.[1]
      || "Area";
    extras.push(/\barea\b/i.test(area) ? area : `Area: ${area}`);
  }
  if (flags.unreliable && !flaws.includes("Unreliable")) flaws.push("Unreliable");
  if (flags.fades && !flaws.includes("Fades")) flaws.push("Fades");
  if (flags.limited && !flaws.some((item) => normalizePowerName(item).startsWith("limited"))) flaws.push("Limited");
  return { extras, flaws, flags };
}

function parseArea(segment) {
  const match = segment.match(/\b(Perception|Cloud|Line|Cone|Burst)\s+Area\b/i);
  if (!match && !/\[Area:/i.test(segment) && !/\bArea\s*:/i.test(segment)) return null;
  const explicit = segment.match(/\[Area:\s*([^\]]+)\]/i)?.[1]
    || segment.match(/\bArea\s*:\s*([^;()[\]]+)/i)?.[1];
  return {
    type: safeStr(explicit || match?.[0] || "Area"),
    perception: /\bPerception\s+Area\b/i.test(segment),
    selective: /\bSelective\b/i.test(segment),
  };
}

function parseRange(segment) {
  if (/\bperception\b/i.test(segment)) return "perception";
  if (/\branged\b|\[ranged\]/i.test(segment)) return "ranged";
  return "close";
}

function parseResistance(segment, fallback = "") {
  const alt = segment.match(/Alternate Resistance:\s*([A-Za-z ]+)/i);
  if (alt) return normalizeResistanceLabel(alt[1]);
  const resisted = segment.match(/Resisted by:?\s*([A-Za-z ]+)/i);
  if (resisted) return normalizeResistanceLabel(resisted[1]);
  return normalizeResistanceLabel(fallback);
}

function parseTraits(segment, effectType) {
  const affects = segment.match(/Affects:\s*([^;()[\]]+)/i);
  if (affects) return splitTraitList(affects[1]);
  if (!["weaken", "enhanced_trait", "damage"].includes(effectType)) return [];
  let text = stripBuildPrefix(segment);
  text = text.replace(/^Strength-based\s+Damage\b/i, "Damage");
  text = text.replace(/^(?:Weaken|Enhanced Trait|Enhanced|Damage)\b/i, "").trim();
  text = text.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  const beforeStop = text.split(/;|,|Resisted by|Alternate Resistance|Custom:/i)[0];
  const beforeRank = beforeStop.replace(/\b-?\d+\b/g, " ");
  return splitTraitList(beforeRank);
}

function parseAfflictionConditions(segment) {
  const explicit = [];
  for (const match of segment.matchAll(/([123])(?:st|nd|rd)?\s+degree:\s*([^,;]+)/gi)) {
    explicit.push({ degree: safeInt(match[1], explicit.length + 1), condition: normalizePowerName(match[2]) });
  }
  if (explicit.length) return explicit;
  const inside = segment.match(/Affliction\s+\d*\s*\(([^)]*)\)/i)?.[1] || "";
  const first = inside.split(/;|Resisted by|Custom:/i)[0];
  const tokens = first.split(",").map((item) => normalizePowerName(item)).filter(Boolean);
  if (tokens.length) {
    while (tokens.length < 3) tokens.push(tokens[tokens.length - 1]);
    return tokens.slice(0, 3).map((condition, index) => ({ degree: index + 1, condition }));
  }
  return [
    { degree: 1, condition: "dazed" },
    { degree: 2, condition: "stunned" },
    { degree: 3, condition: "incapacitated" },
  ];
}

function defaultTargetForEffect(effectType, segment) {
  if (selfOnlyText(segment)) return "self";
  if (["enhanced_trait", "healing", "regeneration", "protection", "concealment", "senses", "speed", "flight", "burrowing", "swimming", "leaping", "movement", "insubstantial", "growth", "shrinking", "quickness", "elongation", "immortality", "extra_limbs", "comprehend", "communication", "remote_sensing"].includes(effectType)) return "self";
  if (["environment", "create", "illusion", "summon"].includes(effectType)) return "field";
  return "target";
}

function parseEffectFromBuild(move, segment, index) {
  const { type, label } = effectTypeFromSegment(segment, move?.name);
  if (type === "custom" && !EFFECT_KEYWORD_RE.test(segment) && !/\bdeflect\b/i.test(move?.name || "")) return null;
  const { extras, flaws, flags } = parseModifiers(segment);
  const rank = parseRank(segment, label, move?.rank ?? move?.damage ?? move?.power ?? null);
  const fallbackResistance = type === "damage" ? "thg"
    : ["affliction", "weaken", "transform"].includes(type) ? "fort"
      : ["mind_reading", "nullify"].includes(type) ? "will"
        : ["move_object", "teleport"].includes(type) ? "dodge"
          : "";
  const effect = {
    id: `e${index}`,
    type,
    label,
    raw: segment,
    rank,
    range: parseRange(segment),
    action: "standard",
    duration: "instant",
    resistance: parseResistance(segment, fallbackResistance),
    target: defaultTargetForEffect(type, segment),
    descriptors: [safeStr(move?.meta?.type || move?.type)].filter(Boolean),
    extras,
    flaws,
    linked: flags.linked || index > 0,
    secondaryEffect: flags.secondaryEffect,
    fades: flags.fades,
    unreliable: flags.unreliable,
    reaction: flags.reaction,
    selective: flags.selective,
    limited: flags.limited,
    progressive: flags.progressive,
    cumulative: flags.cumulative,
    area: parseArea(segment),
  };
  const traits = parseTraits(segment, type);
  if (traits.length) effect.traits = traits;
  if (type === "affliction") effect.conditions = parseAfflictionConditions(segment);
  if (["create", "move_object", "teleport", "summon", "transform", "variable", "nullify", "deflect", "immunity", "environment", "illusion", "mind_reading", "growth", "shrinking", "luck_control"].includes(type)) {
    effect.requiresChoice = ["create", "move_object", "teleport", "summon", "transform", "variable", "illusion", "mind_reading", "growth", "shrinking", "luck_control"].includes(type);
  }
  return effect;
}

function deriveTargetingFromEffects(effects, move) {
  const area = effects.find((effect) => effect.area)?.area || null;
  const mode = area
    ? "area"
    : effects.length && effects.every((effect) => effect.target === "self")
      ? "self"
      : effects.length && effects.every((effect) => effect.target === "field")
        ? "field"
        : "target";
  return {
    mode,
    range: effects.some((effect) => ["ranged", "perception"].includes(effect.range)) ? "ranged" : "close",
    area,
    source: safeStr(move?.build) ? "sheet_build" : "fallback",
  };
}

function parseStatShiftNotes(rule) {
  const notes = safeStr(rule?.audit?.notes || rule?.notes || "");
  const match = notes.match(/Stat shifts:\s*([^|]+)/i);
  const source = safeStr(match?.[1] || "");
  const shifts = {};
  if (!source) return shifts;
  for (const part of source.split(",")) {
    const m = part.match(/(.+?)\s*([+-]\d+)\s*$/);
    if (!m) continue;
    const delta = safeInt(m[2], 0);
    for (const trait of splitTraitList(m[1])) {
      if (trait) shifts[trait] = delta;
    }
  }
  return shifts;
}

function notesDescribeUserStatLoss(rule) {
  const text = normalizeText(`${safeStr(rule?.audit?.notes)} ${safeStr(rule?.description)} ${safeStr(rule?.buildText)}`);
  return /\blowers? (?:the )?user\b/.test(text)
    || /\blower(?:s|ing)? user/.test(text)
    || /\buser.?s [a-z ]+ by/.test(text)
    || /\breduz .*usuario\b/.test(text)
    || /\bapenas (?:o )?(?:proprio )?usuario\b/.test(text)
    || /\baffects only self\b/.test(text);
}

function supportShiftEffectFromWeaken(effect, trait, delta, index) {
  const magnitude = Math.max(1, Math.abs(safeInt(delta, -1)));
  return {
    ...effect,
    id: safeStr(effect?.id) || `self_shift_${trait}_${index}`,
    type: "enhanced_trait",
    label: "Self Stat Shift",
    raw: `${safeStr(effect?.raw || "Stat shift")} [Pokemon/GaAl self ${trait} ${delta}]`,
    rank: { source: "fixed", value: magnitude },
    resistance: "",
    target: "self",
    traits: [trait],
    statDelta: safeInt(delta, -magnitude),
    statDeltas: { [trait]: safeInt(delta, -magnitude) },
    extras: Array.isArray(effect?.extras) ? effect.extras : [],
    flaws: Array.isArray(effect?.flaws) ? effect.flaws : [],
    linked: effect?.linked !== false,
    limited: !!effect?.limited,
  };
}

function moveLiveRank(move) {
  return safeInt(move?.rank ?? move?.damage ?? move?.lvl, 0);
}

function firstPositiveInt(values) {
  for (const value of values) {
    const n = safeInt(value, 0);
    if (n > 0) return n;
  }
  return 0;
}

function moveNameCandidates(move, baseRule, rule) {
  const raw = [
    move?.name,
    move?.Nome,
    move?.nome,
    move?.meta?.api_name,
    move?.meta?.raw_power_name,
    baseRule?.name,
    rule?.name,
  ].map(safeStr).filter(Boolean);
  const out = [];
  for (const item of raw) {
    out.push(item);
    out.push(item.split(":")[0]);
    out.push(item.replace(/\s*\([^)]*\)\s*$/g, ""));
  }
  return Array.from(new Set(out.map(safeStr).filter(Boolean)));
}

function inferPokemonBasePower(move, baseRule, rule) {
  const explicit = firstPositiveInt([
    move?.basePower,
    move?.base_power,
    move?.pokemonBasePower,
    move?.pokemon_base_power,
    move?.meta?.basePower,
    move?.meta?.base_power,
    move?.meta?.pokemonBasePower,
    move?.meta?.pokemon_base_power,
    baseRule?.basePower,
    baseRule?.base_power,
    rule?.basePower,
    rule?.base_power,
  ]);
  if (explicit) return { basePower: explicit, source: "explicit" };
  for (const candidate of moveNameCandidates(move, baseRule, rule)) {
    const basePower = getPokemonMoveBasePower(candidate);
    if (basePower) return { basePower, source: "pokeapi_name" };
  }
  return { basePower: 0, source: "" };
}

function parseLegacyDamageBonusText(move, baseRule, rule) {
  const text = `${safeStr(move?.build)} ${safeStr(move?.meta?.build_base)} ${safeStr(baseRule?.buildText)} ${safeStr(baseRule?.audit?.build)} ${safeStr(baseRule?.audit?.notes)} ${safeStr(rule?.buildText)}`;
  let maxBonus = 0;
  for (const match of text.matchAll(/(?:b[oô]nus(?:\s+de)?\s+dano|damage\s+bonus|power\s+attack\s+obrigat[oó]rio)[^+\d-]*\+?\s*(\d+)/gi)) {
    maxBonus = Math.max(maxBonus, safeInt(match[1], 0));
  }
  if (/\bpower\s*(?:>=|>|maior que)\s*150\b/i.test(text) || /\bpower\s*151\+/.test(text)) {
    maxBonus = Math.max(maxBonus, 10);
  } else if (/\bpower\s*(?:>=|>|maior que)\s*100\b/i.test(text) || /\bpower\s*101\+/.test(text)) {
    maxBonus = Math.max(maxBonus, 5);
  }
  if (maxBonus >= 10) return 10;
  if (maxBonus >= 5) return 5;
  return 0;
}

function inferDamageBonusInfo(move, baseRule, rule) {
  const { basePower, source } = inferPokemonBasePower(move, baseRule, rule);
  const bonus = getPokemonBasePowerDamageBonus(basePower);
  if (bonus) {
    return {
      bonus,
      basePower,
      source,
      rule: basePower >= 151 ? "base_power_151_plus" : "base_power_101_plus",
    };
  }
  const legacyBonus = parseLegacyDamageBonusText(move, baseRule, rule);
  if (legacyBonus) {
    return {
      bonus: legacyBonus,
      basePower: 0,
      source: "build_text",
      rule: "legacy_damage_bonus_text",
    };
  }
  return { bonus: 0, basePower: 0, source: "", rule: "" };
}

function applyPokemonGaAlMoveRules(rule, move, baseRule = null) {
  if (!rule || !Array.isArray(rule.effects)) return rule;
  const liveRank = moveLiveRank(move);
  const damageBonus = inferDamageBonusInfo(move, baseRule, rule);
  let damageBonusApplied = false;

  for (const effect of rule.effects) {
    const type = normalizePowerName(effect?.type).replace(/-/g, "_");
    if (liveRank > 0 && effect?.linked) {
      effect.rank = { source: "linked_main", value: liveRank };
      effect.linkedRankSource = "move.rank";
    }
    if (type === "damage" && damageBonus.bonus > 0 && !damageBonusApplied) {
      effect.damageBonus = damageBonus.bonus;
      effect.damageBonusRule = damageBonus.rule;
      effect.basePower = damageBonus.basePower || null;
      effect.damageBonusSource = damageBonus.source;
      damageBonusApplied = true;
    }
  }

  if (damageBonus.bonus > 0) {
    rule.damageBonus = damageBonus;
  }
  return rule;
}

function normalizeSelfStatShiftEffects(rule) {
  if (!rule || !Array.isArray(rule.effects)) return rule;
  const shifts = parseStatShiftNotes(rule);
  const negativeTraits = Object.entries(shifts).filter(([, delta]) => safeInt(delta, 0) < 0);
  const hasExplicitUserLoss = negativeTraits.length > 0 && notesDescribeUserStatLoss(rule);
  const replacementEffects = [];
  const consumedTraits = new Set();
  const keep = [];

  for (const effect of rule.effects) {
    const type = normalizePowerName(effect?.type).replace(/-/g, "_");
    if (type !== "enhanced_trait" || safeStr(effect?.target).toLowerCase() !== "self") continue;
    const traits = Array.isArray(effect?.traits) ? effect.traits.map(normalizeStatLabel).filter(Boolean) : [];
    for (const trait of traits) {
      const delta = safeInt(effect?.statDeltas?.[trait] ?? effect?.statDelta ?? effect?.delta, 0);
      if (delta < 0) consumedTraits.add(trait);
    }
  }

  for (const effect of rule.effects) {
    const type = normalizePowerName(effect?.type).replace(/-/g, "_");
    const traits = Array.isArray(effect?.traits) ? effect.traits.map(normalizeStatLabel).filter(Boolean) : [];
    const rawSelfOnly = selfOnlyText(effect?.raw) || selfOnlyText((effect?.flaws || []).join(" "));
    const shouldConvertSelfWeaken = type === "weaken" && traits.length && rawSelfOnly;
    const shouldConvertPokemonUserLoss = type === "weaken"
      && hasExplicitUserLoss
      && traits.some((trait) => safeInt(shifts[trait], 0) < 0);

    if (!shouldConvertSelfWeaken && !shouldConvertPokemonUserLoss) {
      keep.push(effect);
      continue;
    }

    const selectedTraits = (hasExplicitUserLoss
      ? negativeTraits.map(([trait]) => trait).filter((trait) => traits.includes(trait) || rawSelfOnly)
      : traits);
    const uniqueTraits = Array.from(new Set(selectedTraits.length ? selectedTraits : traits));
    for (const trait of uniqueTraits) {
      const fallbackDelta = -Math.max(1, safeInt(effect?.rank?.value ?? effect?.rank, 1));
      const delta = safeInt(shifts[trait], fallbackDelta);
      if (consumedTraits.has(trait) && hasExplicitUserLoss) continue;
      consumedTraits.add(trait);
      replacementEffects.push(supportShiftEffectFromWeaken(effect, trait, delta, replacementEffects.length));
    }
  }

  if (hasExplicitUserLoss) {
    for (const [trait, delta] of negativeTraits) {
      if (consumedTraits.has(trait)) continue;
      replacementEffects.push(supportShiftEffectFromWeaken({
        id: `self_shift_${trait}`,
        linked: true,
        raw: `Stat shifts: ${trait} ${delta}`,
      }, trait, delta, replacementEffects.length));
    }
  }

  if (!replacementEffects.length) return rule;
  rule.effects = keep.concat(replacementEffects);
  rule.linkedEffects = rule.effects.filter((effect) => effect.linked).map((effect) => effect.id);
  rule.targeting = deriveTargetingFromEffects(rule.effects, { build: rule.buildText });
  rule.range = rule.targeting.range;
  rule.area = rule.targeting.area;
  return rule;
}

function buildPowerRuleFromMoveBuild(move, baseRule = null) {
  const explicitBuild = safeStr(move?.build || move?.buildText || move?.raw || "");
  const moveName = safeStr(move?.name || move?.Nome || move?.nome);
  const nameHasEffect = EFFECT_KEYWORD_RE.test(moveName);
  const buildHasEffect = EFFECT_KEYWORD_RE.test(explicitBuild);
  const nameBuild = nameHasEffect
    ? moveName
    : "";
  const build = explicitBuild
    ? (nameHasEffect && !buildHasEffect ? `${nameBuild}; ${explicitBuild}` : explicitBuild)
    : nameBuild;
  if (!build) return null;
  const segments = mergeModifierOnlySegments(splitTopLevel(build));
  const effects = [];
  for (const segment of segments) {
    const effect = parseEffectFromBuild(move, segment, effects.length);
    if (effect) effects.push(effect);
  }
  if (!effects.length) return null;
  const descriptors = [safeStr(move?.meta?.type || move?.type || baseRule?.type)].filter(Boolean);
  const targeting = deriveTargetingFromEffects(effects, move);
  const rule = {
    ...(baseRule ? structuredCloneCompat(baseRule) : {}),
    schema: "PowerRule",
    schemaVersion: baseRule?.schemaVersion || 2,
    id: safeStr(baseRule?.id) || `build:${normalizePowerName(move?.name) || "move"}`,
    name: safeStr(baseRule?.name || move?.name || "Golpe"),
    type: safeStr(baseRule?.type || move?.meta?.type || move?.type),
    category: safeStr(baseRule?.category || move?.meta?.category || move?.category),
    rank: { source: "move", value: safeInt(move?.rank ?? move?.damage ?? move?.power, 0) || null },
    range: targeting.range,
    action: "standard",
    duration: "instant",
    resistance: baseRule?.resistance || (effects[0]?.resistance || "thg"),
    descriptors,
    targeting,
    area: targeting.area,
    extras: Array.from(new Set(effects.flatMap((effect) => effect.extras || []))),
    flaws: Array.from(new Set(effects.flatMap((effect) => effect.flaws || []))),
    flags: {
      linkedEffects: effects.some((effect) => effect.linked),
      reaction: effects.some((effect) => effect.reaction || effect.type === "deflect"),
      limited: effects.some((effect) => effect.limited),
      secondaryEffect: effects.some((effect) => effect.secondaryEffect),
    },
    effects,
    linkedEffects: effects.filter((effect) => effect.linked).map((effect) => effect.id),
    buildText: build,
    rulesText: safeStr(baseRule?.rulesText),
    description: safeStr(baseRule?.description || move?.description || move?.desc),
    audit: baseRule?.audit || {},
    requiresChoices: [],
    source: baseRule ? "catalog+sheet_build" : (explicitBuild ? (nameHasEffect && !buildHasEffect ? "name_build+sheet_modifiers" : "sheet_build") : "name_build"),
  };
  return applyPokemonGaAlMoveRules(normalizeSelfStatShiftEffects(rule), move, baseRule);
}

function buildIndex(catalog) {
  const byId = new Map();
  const byName = new Map();
  for (const rule of catalog?.moves || []) {
    if (!rule?.id) continue;
    byId.set(rule.id, rule);
    const key = normalizePowerName(rule.name);
    if (!key) continue;
    const arr = byName.get(key) || [];
    arr.push(rule);
    byName.set(key, arr);
  }
  return { byId, byName };
}

export async function loadMmPowerCatalog() {
  if (catalogCache) return catalogCache;
  if (!catalogPromise) {
    catalogPromise = fetch(CATALOG_URL, { cache: "no-cache" })
      .then((res) => {
        if (!res.ok) throw new Error(`moves-mm catalog HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        catalogCache = json;
        nameIndex = buildIndex(json);
        return json;
      });
  }
  return catalogPromise;
}

function getCatalogIndexSync() {
  return nameIndex || (catalogCache ? (nameIndex = buildIndex(catalogCache)) : null);
}

export function getPowerRuleForMoveSync(move) {
  const idx = getCatalogIndexSync();
  if (!idx) return fallbackPowerRuleFromMove(move);
  const name = safeStr(move?.name || move?.Nome || move?.nome);
  const key = normalizePowerName(name);
  const candidates = key ? (idx.byName.get(key) || []) : [];
  if (candidates.length === 1) return mergeLiveMoveIntoPowerRule(candidates[0], move);

  const moveType = normalizePowerName(move?.meta?.type || move?.type || "");
  const category = normalizePowerName(move?.meta?.category || move?.category || "");
  const matched = candidates.find((rule) => {
    const sameType = !moveType || normalizePowerName(rule.type) === moveType;
    const sameCategory = !category || normalizePowerName(rule.category) === category;
    return sameType && sameCategory;
  }) || candidates[0];
  return matched ? mergeLiveMoveIntoPowerRule(matched, move) : fallbackPowerRuleFromMove(move);
}

export async function getPowerRuleForMove(move) {
  try {
    await loadMmPowerCatalog();
    return getPowerRuleForMoveSync(move);
  } catch (err) {
    console.warn("[mm-power-catalog] fallback:", err);
    return fallbackPowerRuleFromMove(move);
  }
}

export function mergeLiveMoveIntoPowerRule(rule, move) {
  const liveRank = moveLiveRank(move);
  const liveAccuracy = safeInt(move?.accuracy ?? move?.acc ?? move?.acerto ?? move?.modificador, 0);
  const liveType = safeStr(move?.meta?.type || move?.type);
  const liveCategory = safeStr(move?.meta?.category || move?.category);
  const cloned = buildPowerRuleFromMoveBuild(move, rule) || structuredCloneCompat(rule || {});
  cloned.live = {
    rank: liveRank,
    accuracy: liveAccuracy,
    type: liveType,
    category: liveCategory,
    moveIdx: Number.isInteger(move?._move_idx) ? move._move_idx : null,
  };
  if (liveType && !safeStr(cloned.type)) cloned.type = liveType;
  if (liveCategory && !safeStr(cloned.category)) cloned.category = liveCategory;
  normalizeSelfStatShiftEffects(cloned);
  applyPokemonGaAlMoveRules(cloned, move, rule);
  cloned.validation = validatePowerRule(cloned);
  return cloned;
}

function structuredCloneCompat(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return cloneJson(value);
}

export function fallbackPowerRuleFromMove(move) {
  const buildRule = buildPowerRuleFromMoveBuild(move);
  if (buildRule) {
    buildRule.live = {
      rank: moveLiveRank(move),
      accuracy: safeInt(move?.accuracy ?? move?.acc ?? move?.acerto, 0),
      type: safeStr(move?.meta?.type || move?.type),
      category: safeStr(move?.meta?.category || move?.category),
    };
    buildRule.validation = validatePowerRule(buildRule);
    return buildRule;
  }

  const name = safeStr(move?.name || move?.Nome || move?.nome || "Golpe");
  const category = safeStr(move?.meta?.category || move?.category || "");
  const type = safeStr(move?.meta?.type || move?.type || "");
  const rank = moveLiveRank(move);
  const isStatus = category.toLowerCase().includes("status") || move?.meta?.is_effect === true;
  const effectType = isStatus ? "affliction" : "damage";
  const resistance = isStatus ? "fort" : "thg";
  const rule = {
    schema: "PowerRule",
    schemaVersion: 1,
    id: `fallback:${normalizePowerName(name) || "move"}`,
    sourceRow: null,
    name,
    type,
    category,
    rank: { source: "move", value: rank || null },
    range: move?.meta?.is_area ? "ranged" : "close",
    action: "standard",
    duration: "instant",
    resistance,
    descriptors: [type].filter(Boolean),
    targeting: {
      mode: move?.meta?.affects_user ? "self" : (move?.meta?.is_area ? "area" : "target"),
      range: move?.meta?.is_area ? "ranged" : "close",
      area: move?.meta?.is_area ? { type: "Area", perception: false, selective: false } : null,
    },
    area: move?.meta?.is_area ? { type: "Area", perception: false, selective: false } : null,
    extras: [],
    flaws: [],
    flags: {},
    effects: [{
      id: "e0",
      type: effectType,
      label: isStatus ? "Affliction" : "Damage",
      raw: isStatus ? "Affliction (fallback)" : "Damage (fallback)",
      rank: { source: "move", value: rank || null },
      range: "close",
      action: "standard",
      duration: "instant",
      resistance,
      target: move?.meta?.affects_user ? "self" : "target",
      descriptors: [type].filter(Boolean),
      extras: [],
      flaws: [],
      linked: false,
      area: null,
      conditions: isStatus ? [
        { degree: 1, condition: "dazed" },
        { degree: 2, condition: "stunned" },
        { degree: 3, condition: "incapacitated" },
      ] : undefined,
    }],
    linkedEffects: [],
    buildText: "",
    rulesText: "",
    description: safeStr(move?.description || move?.desc || ""),
    audit: {},
    requiresChoices: [],
    live: {
      rank,
      accuracy: safeInt(move?.accuracy ?? move?.acc ?? move?.acerto, 0),
      type,
      category,
    },
  };
  applyPokemonGaAlMoveRules(rule, move);
  rule.validation = validatePowerRule(rule);
  return rule;
}

export function isSelfPowerRule(rule) {
  const mode = safeStr(rule?.targeting?.mode);
  if (mode === "self") return true;
  const effects = Array.isArray(rule?.effects) ? rule.effects : [];
  return effects.length > 0 && effects.every((effect) => safeStr(effect?.target) === "self");
}

export function hasResolvableImmediateEffects(rule) {
  return (Array.isArray(rule?.effects) ? rule.effects : []).some((effect) => {
    const type = safeStr(effect?.type);
    return isMmSupportEffect(type) || isMmTrackableActiveEffect(type);
  });
}
