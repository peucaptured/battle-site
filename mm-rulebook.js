function safeStr(value) {
  return value == null ? "" : String(value).trim();
}

function normalizeLabel(value) {
  return safeStr(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeMmLabel(value) {
  return normalizeLabel(value);
}

function unique(values) {
  return Array.from(new Set((values || []).map(safeStr).filter(Boolean)));
}

export const MM_EFFECTS = Object.freeze({
  affliction: { kind: "resistance", automation: "automatic" },
  burrowing: { kind: "active", automation: "tracked" },
  communication: { kind: "active", automation: "tracked" },
  comprehend: { kind: "active", automation: "tracked" },
  concealment: { kind: "active", automation: "tracked" },
  create: { kind: "active", automation: "choice", choices: ["shape", "location", "toughness"] },
  damage: { kind: "resistance", automation: "automatic" },
  deflect: { kind: "active", automation: "choice", choices: ["protectedTarget", "defenseRoll"] },
  elongation: { kind: "active", automation: "tracked" },
  enhanced_trait: { kind: "support", automation: "automatic" },
  environment: { kind: "field", automation: "tracked" },
  extra_limbs: { kind: "active", automation: "tracked" },
  feature: { kind: "meta", automation: "adjudication" },
  flight: { kind: "active", automation: "tracked" },
  growth: { kind: "active", automation: "adjudication" },
  healing: { kind: "support", automation: "automatic" },
  illusion: { kind: "field", automation: "choice", choices: ["subject", "area", "senses"] },
  immortality: { kind: "passive", automation: "tracked" },
  immunity: { kind: "active", automation: "tracked" },
  insubstantial: { kind: "active", automation: "tracked" },
  leaping: { kind: "active", automation: "tracked" },
  luck_control: { kind: "reaction", automation: "choice", choices: ["rerollTarget", "forceReroll", "negateLuck", "transferLuck"] },
  mind_reading: { kind: "resistance", automation: "choice", choices: ["surfaceThoughts", "deepThoughts", "mentalControl"] },
  move_object: { kind: "resistance", automation: "choice", choices: ["direction", "distance", "collision"] },
  movement: { kind: "active", automation: "tracked" },
  nullify: { kind: "resistance", automation: "choice", choices: ["effectToNullify"] },
  protection: { kind: "active", automation: "tracked" },
  quickness: { kind: "active", automation: "tracked" },
  regeneration: { kind: "active", automation: "tracked" },
  remote_sensing: { kind: "active", automation: "tracked" },
  senses: { kind: "active", automation: "tracked" },
  shrinking: { kind: "active", automation: "adjudication" },
  speed: { kind: "active", automation: "tracked" },
  summon: { kind: "active", automation: "choice", choices: ["template", "control"] },
  swimming: { kind: "active", automation: "tracked" },
  teleport: { kind: "resistance", automation: "choice", choices: ["destination"] },
  transform: { kind: "resistance", automation: "choice", choices: ["form", "traits"] },
  variable: { kind: "active", automation: "choice", choices: ["configuration"] },
  weaken: { kind: "resistance", automation: "automatic" },
  custom: { kind: "custom", automation: "adjudication" },
});

export const MM_EXTRAS = Object.freeze([
  "accurate",
  "affects_corporeal",
  "affects_incorporeal",
  "affects_objects",
  "affects_others",
  "alternate_effect",
  "alternate_resistance",
  "area",
  "attack",
  "contagious",
  "cumulative",
  "dimensional",
  "extended_range",
  "feature",
  "homing",
  "improved_critical",
  "impervious",
  "increased_duration",
  "increased_mass",
  "increased_range",
  "incurable",
  "indirect",
  "innate",
  "insidious",
  "linked",
  "move_by_action",
  "multiattack",
  "penetrating",
  "precise",
  "progressive",
  "reach",
  "redirect",
  "reflect",
  "reaction",
  "reversible",
  "ricochet",
  "secondary_effect",
  "selective",
  "sleep",
  "split",
  "subtle",
  "sustained",
  "triggered",
  "variable_descriptor",
  "broad",
  "continuous",
  "counter",
  "extra_condition",
  "persistent",
  "resurrection",
  "stackable",
  "custom",
]);

export const MM_FLAWS = Object.freeze([
  "activation",
  "check_required",
  "concentration",
  "diminished_range",
  "distracting",
  "fades",
  "feedback",
  "grab_based",
  "inaccurate",
  "increased_action",
  "limited",
  "noticeable",
  "permanent",
  "quirk",
  "delayed",
  "reduced_range",
  "removable",
  "resistible",
  "sense_dependent",
  "side_effect",
  "progressive",
  "tiring",
  "uncontrolled",
  "unreliable",
  "recharge",
  "custom",
]);

const TRACKED_ACTIVE = new Set(Object.entries(MM_EFFECTS)
  .filter(([, meta]) => ["active", "field", "passive", "reaction"].includes(meta.kind))
  .map(([type]) => type));

const RESISTANCE_EFFECTS = new Set(Object.entries(MM_EFFECTS)
  .filter(([, meta]) => meta.kind === "resistance")
  .map(([type]) => type));

const SUPPORT_EFFECTS = new Set(Object.entries(MM_EFFECTS)
  .filter(([, meta]) => meta.kind === "support")
  .map(([type]) => type));

export function normalizeMmModifier(value) {
  const raw = normalizeLabel(value);
  if (!raw) return "";
  if (raw.startsWith("limited")) return "limited";
  if (raw.startsWith("custom")) return "custom";
  if (raw.startsWith("area")) return "area";
  if (raw.startsWith("perception_area")) return "area";
  if (raw.startsWith("reaction")) return "reaction";
  if (raw.startsWith("multiattack")) return "multiattack";
  if (raw.startsWith("improved_critical")) return "improved_critical";
  if (raw.startsWith("move_by_action")) return "move_by_action";
  if (raw.startsWith("extra_condition")) return "extra_condition";
  if (raw.startsWith("counter")) return "counter";
  if (raw.startsWith("broad")) return "broad";
  if (raw.startsWith("continuous")) return "continuous";
  if (raw.startsWith("persistent")) return "persistent";
  if (raw.startsWith("resurrection")) return "resurrection";
  if (raw.startsWith("stackable")) return "stackable";
  if (raw.startsWith("immunity")) return "custom";
  if (raw.startsWith("quirk")) return "quirk";
  if (raw.startsWith("recharge")) return "recharge";
  if (raw.startsWith("delayed")) return "delayed";
  if (raw.startsWith("alternate_resistance")) return "alternate_resistance";
  if (raw.startsWith("alternate_effect")) return "alternate_effect";
  if (raw.startsWith("increased_range")) return "increased_range";
  if (raw.startsWith("extended_range")) return "extended_range";
  if (raw.startsWith("increased_duration")) return "increased_duration";
  if (raw.startsWith("increased_mass")) return "increased_mass";
  if (raw.startsWith("secondary_effect")) return "secondary_effect";
  if (raw.startsWith("variable_descriptor")) return "variable_descriptor";
  if (raw.startsWith("affects_others")) return "affects_others";
  if (raw.startsWith("affects_objects")) return "affects_objects";
  if (raw.startsWith("affects_corporeal")) return "affects_corporeal";
  if (raw.startsWith("affects_incorporeal")) return "affects_incorporeal";
  if (raw.startsWith("grab_based")) return "grab_based";
  if (raw.startsWith("check_required")) return "check_required";
  if (raw.startsWith("sense_dependent")) return "sense_dependent";
  if (raw.startsWith("side_effect")) return "side_effect";
  if (raw.startsWith("reduced_range")) return "reduced_range";
  if (raw.startsWith("diminished_range")) return "diminished_range";
  if (raw.startsWith("increased_action")) return "increased_action";
  return raw.replace(/_\d+$/, "");
}

export function getMmEffectMeta(type) {
  return MM_EFFECTS[normalizeLabel(type)] || MM_EFFECTS.custom;
}

export function isMmResistanceEffect(type) {
  return RESISTANCE_EFFECTS.has(normalizeLabel(type));
}

export function isMmSupportEffect(type) {
  return SUPPORT_EFFECTS.has(normalizeLabel(type));
}

export function isMmTrackableActiveEffect(type) {
  return TRACKED_ACTIVE.has(normalizeLabel(type));
}

export function effectRequiresMmDecision(effect) {
  const type = normalizeLabel(effect?.type || "custom");
  const meta = getMmEffectMeta(type);
  if (type === "custom") return true;
  if (meta.automation === "ignored") return false;
  if (meta.automation === "choice" || meta.automation === "adjudication") return true;
  if (effect?.requiresChoice) return true;
  return false;
}

function modifierReport(effect, issues) {
  const extras = unique(effect?.extras);
  const flaws = unique(effect?.flaws);
  for (const extra of extras) {
    const key = normalizeMmModifier(extra);
    if (!MM_EXTRAS.includes(key)) {
      issues.push({ severity: "warning", code: "unknown_extra", effectId: safeStr(effect?.id), label: extra });
    }
  }
  for (const flaw of flaws) {
    const key = normalizeMmModifier(flaw);
    if (!MM_FLAWS.includes(key)) {
      issues.push({ severity: "warning", code: "unknown_flaw", effectId: safeStr(effect?.id), label: flaw });
    }
  }
}

export function validatePowerRule(rule) {
  const effects = Array.isArray(rule?.effects) ? rule.effects : [];
  const issues = [];
  const effectReports = [];
  let automatic = 0;
  let tracked = 0;
  let choices = 0;
  let adjudication = 0;

  if (!effects.length) {
    issues.push({ severity: "error", code: "no_effects", message: "PowerRule sem efeitos." });
  }

  effects.forEach((effect, index) => {
    const type = normalizeLabel(effect?.type || "custom") || "custom";
    const meta = getMmEffectMeta(type);
    const requiresDecision = effectRequiresMmDecision(effect);
    const report = {
      effectId: safeStr(effect?.id) || `e${index}`,
      type,
      kind: meta.kind,
      automation: meta.automation,
      requiresDecision,
      choices: meta.choices || [],
    };
    effectReports.push(report);

    if (type === "custom") {
      issues.push({ severity: "warning", code: "custom_effect", effectId: report.effectId, message: "Efeito fora do registro M&M estruturado." });
    }
    if (effect?.linked && effects.length < 2) {
      issues.push({ severity: "warning", code: "dangling_linked", effectId: report.effectId, message: "Linked sem outro efeito no mesmo poder." });
    }
    if (effect?.selective && !effect?.area && !rule?.area) {
      issues.push({ severity: "warning", code: "selective_without_area", effectId: report.effectId, message: "Selective normalmente depende de area ou alvo multiplo." });
    }
    if (effect?.secondaryEffect && !isMmResistanceEffect(type)) {
      issues.push({ severity: "warning", code: "secondary_without_resistance", effectId: report.effectId, message: "Secondary Effect precisa de handler de repeticao." });
    }
    if (effect?.reaction) {
      issues.push({ severity: "warning", code: "reaction_needs_trigger", effectId: report.effectId, message: "Reaction exige gatilho/evento antes da resolucao automatica." });
    }
    if (effect?.fades && meta.kind === "resistance") {
      issues.push({ severity: "warning", code: "fades_on_instant", effectId: report.effectId, message: "Fades exige consumo de rank/uso antes da resolucao autoritativa." });
    }
    if (effect?.unreliable) {
      issues.push({ severity: "info", code: "unreliable_50_percent", effectId: report.effectId, message: "Unreliable usa chance fixa de 50% nesta mesa." });
    }
    modifierReport(effect, issues);

    if (meta.automation === "ignored") tracked += 1;
    else if (meta.automation === "automatic" && !requiresDecision) automatic += 1;
    else if (meta.automation === "tracked" && !requiresDecision) tracked += 1;
    else if (meta.automation === "choice" || requiresDecision) choices += 1;
    else adjudication += 1;
  });

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const status = errors
    ? "invalid"
    : (choices || adjudication || issues.some((issue) => issue.severity === "warning"))
      ? "needs_review"
      : tracked
        ? "partial"
        : "automatic";

  return {
    schema: "MmRuleValidation",
    schemaVersion: 1,
    status,
    automatic,
    tracked,
    choices,
    adjudication,
    issueCount: issues.length,
    issues,
    effects: effectReports,
  };
}

export function inferMmDurationTurns(effect, powerRule) {
  const raw = `${safeStr(effect?.raw)} ${safeStr(effect?.duration)} ${safeStr(powerRule?.duration)}`;
  const match = raw.match(/\b(\d+)\s*(?:turnos?|turns?|rodadas?|rounds?)\b/i);
  if (match) return Math.max(1, parseInt(match[1], 10) || 1);
  if (effect?.secondaryEffect) return 1;
  if (safeStr(effect?.duration || powerRule?.duration).toLowerCase() === "instant") return null;
  return null;
}

function stableSerialize(value) {
  if (value == null) return "null";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableHash(value) {
  const raw = stableSerialize(value);
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(36);
}

export function normalizeRuleEnv(env = {}) {
  if (typeof env === "function") return { rng: env, clock: null, idFactory: null };
  const src = env?.env && typeof env.env === "object" ? env.env : env;
  return {
    rng: typeof src?.rng === "function" ? src.rng : null,
    clock: typeof src?.clock === "function" ? src.clock : null,
    idFactory: typeof src?.idFactory === "function" ? src.idFactory : null,
  };
}

export function makeRuleId(prefix = "id", env = {}, parts = []) {
  const resolved = normalizeRuleEnv(env);
  const safePrefix = normalizeLabel(prefix) || "id";
  if (resolved.idFactory) {
    const provided = resolved.idFactory(safePrefix, parts);
    if (safeStr(provided)) return safeStr(provided);
  }
  return `${safePrefix}_${stableHash([safePrefix, parts])}`;
}

export function readRuleClock(env = {}) {
  const resolved = normalizeRuleEnv(env);
  if (!resolved.clock) return null;
  const value = resolved.clock();
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value?.toISOString === "function") return value.toISOString();
  return value;
}

export function rollRuleDie(sides, env = {}) {
  const resolved = normalizeRuleEnv(env);
  if (!resolved.rng) return null;
  const raw = resolved.rng();
  if (!Number.isFinite(Number(raw))) return null;
  return Math.max(1, Math.min(Math.floor(Number(raw) * sides) + 1, sides));
}

export function makeMmActiveEffectId(prefix = "ae", env = {}, parts = []) {
  return makeRuleId(prefix, env, parts);
}
