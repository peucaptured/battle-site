import {
  MM_EFFECTS,
  MM_EXTRAS,
  MM_FLAWS,
  getMmEffectMeta,
  isMmResistanceEffect,
  isMmSupportEffect,
  isMmTrackableActiveEffect,
  makeRuleId,
  normalizeMmLabel,
  normalizeMmModifier,
  normalizeRuleEnv,
  readRuleClock,
  rollRuleDie,
  validatePowerRule as validatePowerRuleLegacy,
} from "./mm-rulebook.js";
import {
  buildResistanceQueue,
  resolveMmImmediatePower,
  resolveMmPowerResistance,
} from "./mm-combat-resolver.js";

export const MM_RULES_ENGINE_VERSION = "20260504-mm-engine-v2";

function safeStr(value) {
  return value == null ? "" : String(value).trim();
}

function safeInt(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value == null ? null : value));
}

function uid(prefix = "id", env = {}, parts = []) {
  return makeRuleId(prefix, env, parts);
}

function normalizeResistance(value) {
  const raw = safeStr(value).toLowerCase();
  if (["toughness", "resistencia", "resistance"].includes(raw)) return "thg";
  if (raw === "fortitude") return "fort";
  return raw || "thg";
}

function effectRank(effect, fallbackRank = 1) {
  const rank = effect?.rank || {};
  if (rank.source === "fixed" && Number.isFinite(Number(rank.value))) {
    return safeInt(rank.value, fallbackRank);
  }
  if (Number.isFinite(Number(effect?.rank))) return safeInt(effect.rank, fallbackRank);
  return Math.max(1, safeInt(fallbackRank, 1));
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readChoiceBucket(effect) {
  return {
    ...(isObject(effect?.parameters) ? effect.parameters : {}),
    ...(isObject(effect?.config) ? effect.config : {}),
    ...(isObject(effect?.automation) ? effect.automation : {}),
    ...(isObject(effect?.choices) ? effect.choices : {}),
    ...(isObject(effect?.choiceData) ? effect.choiceData : {}),
  };
}

function hasChoiceValue(effect, key) {
  const bucket = readChoiceBucket(effect);
  if (bucket[key] !== undefined && bucket[key] !== null && safeStr(bucket[key]) !== "") return true;
  if (effect?.[key] !== undefined && effect?.[key] !== null && safeStr(effect?.[key]) !== "") return true;
  return false;
}

const EFFECT_RUNTIME_CHOICES = Object.freeze({
  create: ["shape", "location", "toughness"],
  deflect: ["protectedTarget"],
  illusion: ["subject", "area", "senses"],
  luck_control: ["mode", "rerollTarget"],
  mind_reading: ["contactLevel"],
  move_object: ["direction", "distance"],
  nullify: ["effectToNullify"],
  summon: ["template", "control"],
  teleport: ["destination"],
  transform: ["form", "traits"],
  variable: ["configuration"],
  growth: ["configuration"],
  shrinking: ["configuration"],
});

const EFFECT_HANDLER_KIND = Object.freeze(Object.fromEntries(
  Object.entries(MM_EFFECTS)
    .filter(([type]) => type !== "custom")
    .map(([type, meta]) => {
      if (meta.kind === "resistance") return [type, "resistance"];
      if (meta.kind === "support") return [type, "support"];
      if (["active", "field", "passive", "reaction"].includes(meta.kind)) return [type, "active"];
      if (meta.kind === "meta") return [type, "decision"];
      return [type, "decision"];
    }),
));

const MODIFIER_HANDLER_KIND = Object.freeze({
  accurate: "attackModifier",
  affects_corporeal: "eligibility",
  affects_incorporeal: "eligibility",
  affects_objects: "targeting",
  affects_others: "targeting",
  alternate_effect: "choice",
  alternate_resistance: "resistance",
  area: "targeting",
  attack: "targeting",
  broad: "scope",
  check_required: "precheck",
  concentration: "duration",
  contagion: "propagation",
  contagious: "propagation",
  continuous: "duration",
  counter: "reaction",
  cumulative: "conditionStacking",
  delayed: "timing",
  dimensional: "targeting",
  diminished_range: "range",
  distracting: "sideEffect",
  extended_range: "range",
  extra_condition: "conditionStacking",
  fades: "resource",
  feature: "metadata",
  feedback: "sideEffect",
  grab_based: "eligibility",
  homing: "retry",
  impervious: "resistance",
  improved_critical: "attackModifier",
  inaccurate: "attackModifier",
  increased_action: "action",
  increased_duration: "duration",
  increased_mass: "mass",
  increased_range: "range",
  incurable: "healingRestriction",
  indirect: "targeting",
  innate: "metadata",
  insidious: "visibility",
  limited: "eligibility",
  linked: "composition",
  move_by_action: "action",
  multiattack: "attackModifier",
  noticeable: "visibility",
  penetrating: "resistance",
  permanent: "duration",
  persistent: "healingRestriction",
  precise: "control",
  progressive: "conditionStacking",
  quirk: "metadata",
  reach: "range",
  recharge: "resource",
  reaction: "reaction",
  redirect: "reaction",
  reduced_range: "range",
  reflect: "reaction",
  removable: "equipment",
  resistible: "resistance",
  resurrection: "healing",
  reversible: "control",
  ricochet: "targeting",
  secondary_effect: "timing",
  selective: "targeting",
  sense_dependent: "eligibility",
  side_effect: "sideEffect",
  sleep: "condition",
  split: "targeting",
  stackable: "conditionStacking",
  subtle: "visibility",
  sustained: "duration",
  tiring: "resource",
  triggered: "reaction",
  uncontrolled: "control",
  unreliable: "resource",
  variable_descriptor: "descriptor",
  custom: "custom",
});

export function getRulesEngineRegistry() {
  return {
    schema: "MmRulesEngineRegistry",
    schemaVersion: 2,
    engineVersion: MM_RULES_ENGINE_VERSION,
    effects: Object.fromEntries(Object.keys(MM_EFFECTS).map((type) => [
      type,
      {
        ...(MM_EFFECTS[type] || {}),
        handler: EFFECT_HANDLER_KIND[type] || (type === "custom" ? "unsupported" : "decision"),
        runtimeChoices: EFFECT_RUNTIME_CHOICES[type] || [],
      },
    ])),
    modifiers: MODIFIER_HANDLER_KIND,
  };
}

function modifierKeysForEffect(effect) {
  const out = [];
  for (const label of [...(effect?.extras || []), ...(effect?.flaws || [])]) {
    const key = normalizeMmModifier(label);
    if (key) out.push({ key, label });
  }
  for (const [flag, key] of [
    ["linked", "linked"],
    ["secondaryEffect", "secondary_effect"],
    ["fades", "fades"],
    ["unreliable", "unreliable"],
    ["reaction", "reaction"],
    ["selective", "selective"],
    ["limited", "limited"],
    ["progressive", "progressive"],
    ["cumulative", "cumulative"],
  ]) {
    if (effect?.[flag]) out.push({ key, label: flag });
  }
  return out;
}

function requiredRuntimeChoices(effect) {
  const type = normalizeMmLabel(effect?.type || "custom") || "custom";
  const required = EFFECT_RUNTIME_CHOICES[type] || [];
  return required.filter((choice) => !hasChoiceValue(effect, choice));
}

function rawTextDeclaresArea(effect, rule) {
  const raw = `${safeStr(effect?.raw)} ${(effect?.extras || []).join(" ")} ${safeStr(rule?.buildText)}`;
  return /\b(?:Perception|Cloud|Line|Cone|Burst)\s+Area\b/i.test(raw)
    || /\bArea\s*:/i.test(raw)
    || /\[Area\s*:/i.test(raw);
}

function pendingDecisionTemplate(powerRule, effect, choices, reason, env = {}, index = 0) {
  const ownerHint = safeStr(effect?.target) || safeStr(powerRule?.targeting?.mode) || "target";
  return {
    schema: "PendingDecision",
    schemaVersion: 2,
    id: uid("pd", env, [
      "validation",
      safeStr(powerRule?.id),
      safeStr(effect?.id) || `e${index}`,
      normalizeMmLabel(effect?.type || "custom") || "custom",
      choices,
      reason,
    ]),
    status: "pending",
    decisionType: "missingPowerData",
    powerRuleId: safeStr(powerRule?.id),
    powerName: safeStr(powerRule?.name || "Power"),
    effectId: safeStr(effect?.id),
    effectType: normalizeMmLabel(effect?.type || "custom") || "custom",
    ownerHint,
    choices,
    reason,
    acceptLabel: "Preencher dado",
    ignoreLabel: "Marcar para revisão",
  };
}

function pokemonCoreDecisionTemplate(powerRule, conflict, env = {}, index = 0) {
  return {
    schema: "PendingDecision",
    schemaVersion: 2,
    id: uid("pd", env, [
      "pokemon_core",
      safeStr(powerRule?.id),
      safeStr(conflict?.effectId) || `conflict${index}`,
      safeStr(conflict?.condition),
      safeStr(conflict?.type),
    ]),
    status: "pending",
    decisionType: "pokemon_core_conflict",
    powerRuleId: safeStr(powerRule?.id),
    powerName: safeStr(powerRule?.name || "Power"),
    effectId: safeStr(conflict?.effectId),
    effectType: normalizeMmLabel(conflict?.effectType || "custom") || "custom",
    conflictType: safeStr(conflict?.type || "pokemon_core_conflict"),
    condition: safeStr(conflict?.condition),
    choices: ["approve_custom_effect", "replace_with_canonical", "ignore_effect"],
    reason: safeStr(conflict?.message || "Build M&M contradiz o nucleo Pokemon do golpe."),
    acceptLabel: "Aprovar custom",
    ignoreLabel: "Ignorar efeito",
    data: conflict,
  };
}

function pokemonCoreDecisionTemplates(powerRule, env = {}) {
  const conflicts = Array.isArray(powerRule?.pokemonCore?.conflicts) ? powerRule.pokemonCore.conflicts : [];
  return conflicts.map((conflict, index) => pokemonCoreDecisionTemplate(powerRule, conflict, env, index));
}

export function validatePowerRule(rule, context = {}) {
  const env = normalizeRuleEnv(context?.env);
  const legacy = validatePowerRuleLegacy(rule || {});
  const effects = Array.isArray(rule?.effects) ? rule.effects : [];
  const issues = [];
  const pendingDecisionTemplates = [];
  let unsupported = false;
  let invalid = false;
  let needsReview = false;

  if (!effects.length) {
    invalid = true;
    issues.push({ severity: "error", code: "no_effects", message: "PowerRule sem efeitos." });
  }

  for (let effectIndex = 0; effectIndex < effects.length; effectIndex += 1) {
    const effect = effects[effectIndex];
    const effectId = safeStr(effect?.id);
    const type = normalizeMmLabel(effect?.type || "custom") || "custom";
    const meta = getMmEffectMeta(type);
    if (type === "custom" || !MM_EFFECTS[type]) {
      unsupported = true;
      issues.push({
        severity: "error",
        code: "unsupported_effect",
        effectId,
        effectType: type,
        message: "Efeito sem handler no Rules Engine.",
      });
      continue;
    }

    const handler = EFFECT_HANDLER_KIND[type];
    if (!handler) {
      unsupported = true;
      issues.push({
        severity: "error",
        code: "missing_effect_handler",
        effectId,
        effectType: type,
        message: "Efeito registrado, mas sem handler conectado.",
      });
    }

    for (const modifier of modifierKeysForEffect(effect)) {
      if (!MODIFIER_HANDLER_KIND[modifier.key]) {
        unsupported = true;
        issues.push({
          severity: "error",
          code: "unsupported_modifier",
          effectId,
          modifier: modifier.label,
          normalized: modifier.key,
          message: "Modificador/falha sem handler no pipeline comum.",
        });
      }
    }

    const missingChoices = requiredRuntimeChoices(effect);
    if (missingChoices.length && meta.automation === "choice") {
      pendingDecisionTemplates.push(pendingDecisionTemplate(
        rule,
        effect,
        missingChoices,
        `Dados obrigatorios ausentes para automatizar ${type}.`,
        env,
        effectIndex,
      ));
    }
  }

  const pokemonCoreTemplates = pokemonCoreDecisionTemplates(rule, env);
  if (pokemonCoreTemplates.length) {
    needsReview = true;
    pendingDecisionTemplates.push(...pokemonCoreTemplates);
    for (const decision of pokemonCoreTemplates) {
      issues.push({
        severity: "warning",
        code: "pokemon_core_conflict",
        effectId: decision.effectId,
        effectType: decision.effectType,
        condition: decision.condition,
        message: decision.reason,
      });
    }
  }

  for (const issue of legacy.issues || []) {
    if (issue.code === "unknown_extra" || issue.code === "unknown_flaw" || issue.code === "custom_effect") continue;
    if (issue.severity === "error") {
      invalid = true;
      issues.push(issue);
    } else if (issue.code === "selective_without_area" && rawTextDeclaresArea(effects.find((effect) => safeStr(effect?.id) === safeStr(issue.effectId)), rule)) {
      issues.push({ ...issue, severity: "info", handledByEngine: true, code: "selective_area_inferred" });
    } else if (
      ["dangling_linked", "selective_without_area", "secondary_without_resistance"].includes(issue.code)
    ) {
      needsReview = true;
      issues.push({ ...issue, severity: "warning" });
    } else if (
      ["reaction_needs_trigger", "fades_on_instant", "unreliable_50_percent"].includes(issue.code)
    ) {
      issues.push({ ...issue, severity: issue.severity || "info", handledByEngine: true });
    }
  }

  const status = invalid
    ? "invalid"
    : unsupported
      ? "unsupported"
      : needsReview
        ? "needsReview"
        : "automatic";

  return {
    schema: "RuleValidation",
    schemaVersion: 2,
    engineVersion: MM_RULES_ENGINE_VERSION,
    status,
    legacyStatus: legacy.status,
    automatic: status === "automatic" ? effects.length : 0,
    needsReview: status === "needsReview",
    unsupported,
    invalid,
    issueCount: issues.length,
    runtimeDecisionCount: pendingDecisionTemplates.length,
    issues,
    pendingDecisionTemplates,
    effects: effects.map((effect, index) => {
      const type = normalizeMmLabel(effect?.type || "custom") || "custom";
      return {
        effectId: safeStr(effect?.id) || `e${index}`,
        type,
        kind: getMmEffectMeta(type).kind,
        handler: EFFECT_HANDLER_KIND[type] || "unsupported",
        runtimeChoices: EFFECT_RUNTIME_CHOICES[type] || [],
        missingRuntimeChoices: requiredRuntimeChoices(effect),
      };
    }),
    legacy,
    context: context?.includeContext ? context : undefined,
  };
}

function normalizeCombatant(raw) {
  const piece = raw?.piece || raw || {};
  return {
    owner: safeStr(raw?.owner || piece?.owner),
    pid: safeStr(raw?.pid || piece?.pid),
    pieceId: safeStr(raw?.pieceId || piece?.id),
    row: Number(raw?.row ?? piece?.row),
    col: Number(raw?.col ?? piece?.col),
    hp: safeInt(raw?.hp ?? raw?.state?.hp, 6),
    stats: raw?.stats || {},
    conditions: raw?.conditions || piece?.mm_conditions || { deg1: [], deg2: [], deg3: [] },
    pokemonConditions: raw?.pokemonConditions || piece?.pokemon_conditions || [],
    initiative: safeInt(raw?.initiative ?? raw?.stats?.initiative ?? raw?.stats?.speed, 0),
    powers: Array.isArray(raw?.powers) ? raw.powers : [],
    activeEffects: Array.isArray(raw?.activeEffects) ? raw.activeEffects : [],
  };
}

function samePiece(a, b) {
  const aId = safeStr(a?.pieceId || a?.id);
  const bId = safeStr(b?.pieceId || b?.id);
  if (aId && bId) return aId === bId;
  return safeStr(a?.owner) === safeStr(b?.owner) && safeStr(a?.pid) === safeStr(b?.pid);
}

function distanceSquares(a, b) {
  const ar = Number(a?.row);
  const ac = Number(a?.col);
  const br = Number(b?.row);
  const bc = Number(b?.col);
  if (![ar, ac, br, bc].every(Number.isFinite)) return null;
  return Math.max(Math.abs(ar - br), Math.abs(ac - bc));
}

function parseRangeLimit(powerRule, effect) {
  const bucket = readChoiceBucket(effect);
  const direct = bucket.rangeSquares ?? effect?.rangeSquares ?? powerRule?.rangeSquares ?? powerRule?.targeting?.rangeSquares;
  if (direct != null && Number.isFinite(Number(direct))) return Math.max(0, Number(direct));
  const raw = `${safeStr(effect?.raw)} ${safeStr(effect?.range)} ${safeStr(powerRule?.range)} ${(effect?.extras || []).join(" ")}`;
  const match = raw.match(/\b(\d+)\s*(?:quadrados?|squares?|tiles?)\b/i);
  if (match) return Math.max(0, parseInt(match[1], 10) || 0);
  const range = safeStr(effect?.range || powerRule?.range).toLowerCase();
  if (range === "close" || range === "perto") return 1;
  return null;
}

function isSelfOnly(effect, powerRule) {
  const raw = `${safeStr(effect?.raw)} ${safeStr(powerRule?.buildText)} ${safeStr(powerRule?.rulesText)}`.toLowerCase();
  return safeStr(effect?.target).toLowerCase() === "self"
    || safeStr(powerRule?.targeting?.mode).toLowerCase() === "self"
    || raw.includes("affects only self")
    || raw.includes("apenas em si")
    || raw.includes("only self");
}

function reactionLimitText(powerRule, effect) {
  const parts = [];
  if (effect?.limited || powerRule?.flags?.limited) parts.push("Limited");
  if (effect?.fades) parts.push("Fades");
  if (effect?.unreliable) parts.push("Unreliable 50%");
  for (const flaw of effect?.flaws || []) {
    const key = normalizeMmModifier(flaw);
    if (["limited", "tiring", "unreliable", "fades", "check_required", "sense_dependent"].includes(key)) {
      parts.push(safeStr(flaw));
    }
  }
  return parts.length ? Array.from(new Set(parts)).join("; ") : "sem limite automatico fixo";
}

function powerEffects(power) {
  return Array.isArray(power?.effects) ? power.effects : [];
}

function powerHasReaction(power) {
  return !!power?.flags?.reaction
    || safeStr(power?.action).toLowerCase() === "reaction"
    || powerEffects(power).some((effect) => (
      normalizeMmLabel(effect?.type) === "deflect"
      || !!effect?.reaction
      || safeStr(effect?.action).toLowerCase() === "reaction"
    ));
}

function deflectEligible(effect, powerRule, reactor, attack) {
  const defense = normalizeResistance(attack?.defenseKey || attack?.defense || attack?.defenseUsed);
  if (attack?.isArea) return { ok: false, reason: "Deflect nao funciona contra efeitos de area." };
  if (attack?.isPerception) return { ok: false, reason: "Deflect nao funciona contra ataques de percepcao." };
  if (!["dodge", "parry"].includes(defense)) {
    return { ok: false, reason: "Deflect so protege ataques contra Dodge ou Parry." };
  }
  const protectedTarget = attack?.target || {};
  if (isSelfOnly(effect, powerRule) && !samePiece(reactor, protectedTarget)) {
    return { ok: false, reason: "Deflect limitado a proteger o proprio usuario." };
  }
  const rangeLimit = parseRangeLimit(powerRule, effect);
  const distance = distanceSquares(reactor, protectedTarget);
  if (rangeLimit != null && distance != null && distance > rangeLimit) {
    return { ok: false, reason: `Alvo protegido fora do alcance de Deflect (${distance} > ${rangeLimit}).` };
  }
  return { ok: true, distance, rangeLimit };
}

function validDeflectTargets(effect, powerRule, reactor, attack) {
  const target = attack?.target || {};
  const eligible = deflectEligible(effect, powerRule, reactor, attack);
  if (!eligible.ok) return [];
  return [{
    owner: safeStr(target.owner),
    pid: safeStr(target.pid),
    pieceId: safeStr(target.pieceId),
    label: safeStr(target.label || target.name || target.pieceId || target.pid || "alvo"),
    distance: eligible.distance,
    rangeLimit: eligible.rangeLimit,
  }];
}

export function collectPendingReactions(event, battleState = {}, envInput = {}) {
  const env = normalizeRuleEnv(envInput);
  const attack = event?.attack || event;
  if (!["attackDeclared", "attackRoll", "attack"].includes(safeStr(event?.type || attack?.type))) return [];
  const combatants = (battleState.combatants || []).map(normalizeCombatant);
  const activeEffects = Array.isArray(battleState.activeEffects) ? battleState.activeEffects : [];
  const reactions = [];
  let reactionOrdinal = 0;

  for (let combatantIndex = 0; combatantIndex < combatants.length; combatantIndex += 1) {
    const combatant = combatants[combatantIndex];
    if (!combatant.owner || samePiece(combatant, attack?.actor)) continue;

    const powers = combatant.powers || [];
    for (let powerIndex = 0; powerIndex < powers.length; powerIndex += 1) {
      const powerEntry = powers[powerIndex];
      const powerRule = powerEntry?.powerRule || powerEntry?.rule || powerEntry;
      if (!powerRule || !powerHasReaction(powerRule)) continue;
      const effects = powerEffects(powerRule);
      for (let effectIndex = 0; effectIndex < effects.length; effectIndex += 1) {
        const effect = effects[effectIndex];
        const type = normalizeMmLabel(effect?.type || "custom") || "custom";
        const isDeflect = type === "deflect";
        const isReaction = isDeflect || effect?.reaction || safeStr(effect?.action).toLowerCase() === "reaction" || powerRule?.flags?.reaction;
        if (!isReaction) continue;

        const validTargets = isDeflect
          ? validDeflectTargets(effect, powerRule, combatant, attack)
          : [{
              owner: safeStr(attack?.target?.owner),
              pid: safeStr(attack?.target?.pid),
              pieceId: safeStr(attack?.target?.pieceId),
              label: safeStr(attack?.target?.label || "alvo do evento"),
            }];
        if (!validTargets.length) continue;

        reactionOrdinal += 1;
        reactions.push({
          schema: "PendingReaction",
          schemaVersion: 2,
          id: uid("rx", env, [
            "power",
            safeStr(event?.id || attack?.id),
            combatantIndex,
            powerIndex,
            effectIndex,
            reactionOrdinal,
            combatant.owner,
            combatant.pid,
            combatant.pieceId,
            safeStr(powerRule.id),
            safeStr(effect?.id),
            type,
          ]),
          status: "pending",
          reactor: {
            owner: combatant.owner,
            pid: combatant.pid,
            pieceId: combatant.pieceId,
          },
          powerRuleId: safeStr(powerRule.id),
          powerName: safeStr(powerRule.name || powerEntry?.moveName || "Power"),
          moveIndex: powerEntry?.moveIndex ?? null,
          moveName: safeStr(powerEntry?.moveName || powerRule.name),
          effectId: safeStr(effect?.id),
          effectType: type,
          trigger: safeStr(effect?.trigger || powerRule?.trigger || "attackDeclared"),
          eventId: safeStr(event?.id || attack?.id),
          eventSummary: safeStr(event?.summary || `${safeStr(attack?.actor?.owner)} atacou ${safeStr(attack?.target?.owner)}`),
          cost: reactionLimitText(powerRule, effect),
          limitation: reactionLimitText(powerRule, effect),
          validTargets,
          accept: {
            label: isDeflect ? "Rolar Deflect" : "Ativar reacao",
            outcome: isDeflect
              ? "rola d20 + rank de Deflect; se superar o ataque, o ataque e bloqueado"
              : "cria uma decisao pendente para resolver o efeito da reacao",
          },
          ignore: {
            label: "Ignorar",
            outcome: "o ataque segue sem esta reacao",
          },
          powerRule,
          effect,
          sort: {
            initiative: combatant.initiative,
            owner: combatant.owner,
          },
        });
      }
    }
  }

  for (let activeIndex = 0; activeIndex < activeEffects.length; activeIndex += 1) {
    const active = activeEffects[activeIndex];
    const type = normalizeMmLabel(active?.effectType || active?.type);
    if (type !== "deflect" && !active?.reaction) continue;
    const reactor = combatants.find((item) => safeStr(item.pieceId) === safeStr(active.pieceId))
      || normalizeCombatant(active);
    const pseudoPower = {
      id: safeStr(active.powerRuleId || active.id),
      name: safeStr(active.powerName || active.label || "Efeito ativo"),
      range: active.range,
      effects: [{
        id: safeStr(active.effectId || active.id),
        type,
        rank: { source: "fixed", value: safeInt(active.rank, 1) },
        range: active.range,
        raw: active.raw,
        target: active.target,
        reaction: true,
      }],
    };
    const effect = pseudoPower.effects[0];
    const validTargets = type === "deflect" ? validDeflectTargets(effect, pseudoPower, reactor, attack) : [];
    if (!validTargets.length) continue;
    reactionOrdinal += 1;
    reactions.push({
      schema: "PendingReaction",
      schemaVersion: 2,
      id: uid("rx", env, [
        "active",
        safeStr(event?.id || attack?.id),
        activeIndex,
        reactionOrdinal,
        reactor.owner,
        reactor.pid,
        reactor.pieceId,
        pseudoPower.id,
        effect.id,
        type,
      ]),
      status: "pending",
      reactor: { owner: reactor.owner, pid: reactor.pid, pieceId: reactor.pieceId },
      powerRuleId: pseudoPower.id,
      powerName: pseudoPower.name,
      effectId: effect.id,
      effectType: type,
      trigger: "attackDeclared",
      eventId: safeStr(event?.id || attack?.id),
      eventSummary: safeStr(event?.summary || "ataque recebido"),
      cost: reactionLimitText(pseudoPower, effect),
      limitation: reactionLimitText(pseudoPower, effect),
      validTargets,
      accept: { label: "Rolar Deflect", outcome: "pode bloquear o ataque" },
      ignore: { label: "Ignorar", outcome: "o ataque segue" },
      powerRule: pseudoPower,
      effect,
      sort: { initiative: reactor.initiative, owner: reactor.owner },
    });
  }

  reactions.sort((a, b) => (
    safeInt(b.sort?.initiative) - safeInt(a.sort?.initiative)
    || safeStr(a.sort?.owner).localeCompare(safeStr(b.sort?.owner))
  ));
  return reactions.map(({ sort, ...reaction }) => reaction);
}

function pendingDecisionsFromResolution(resolution, powerRule, event, env = {}) {
  const decisions = [];
  const seen = new Set();
  const add = (decision) => {
    const key = `${safeStr(decision.effectId)}|${safeStr(decision.decisionType)}|${safeStr(decision.reason)}`;
    if (seen.has(key)) return;
    seen.add(key);
    decisions.push({
      schema: "PendingDecision",
      schemaVersion: 2,
      id: decision.id || uid("pd", env, [
        "resolution",
        safeStr(event?.id),
        safeStr(powerRule?.id),
        safeStr(decision.effectId),
        safeStr(decision.decisionType),
        safeStr(decision.reason),
      ]),
      status: "pending",
      powerRuleId: safeStr(powerRule?.id),
      powerName: safeStr(powerRule?.name || "Power"),
      eventId: safeStr(event?.id),
      ...decision,
    });
  };

  for (const patch of resolution?.patches || []) {
    if (patch.kind === "mm_decision") {
      add({
        decisionType: "effectChoice",
        effectId: safeStr(patch.effectId),
        effectType: normalizeMmLabel(patch.effectType || "custom"),
        owner: safeStr(patch.owner),
        pid: safeStr(patch.pid),
        pieceId: safeStr(patch.pieceId),
        choices: Array.isArray(patch.choices) ? patch.choices : [],
        reason: safeStr(patch.reason || "Efeito exige escolha para continuar."),
        data: patch,
      });
    } else if (patch.kind === "adjudication") {
      const effect = (powerRule?.effects || []).find((item) => safeStr(item?.id) === safeStr(patch.effectId)) || {};
      add({
        decisionType: "missingPowerData",
        effectId: safeStr(patch.effectId),
        effectType: normalizeMmLabel(patch.effectType || effect?.type || "custom"),
        owner: safeStr(patch.owner),
        pid: safeStr(patch.pid),
        choices: requiredRuntimeChoices(effect),
        reason: safeStr(patch.reason || "Efeito precisa de dado estruturado."),
        data: patch,
      });
    } else if (patch.kind === "active_effect" && patch.requiresAdjudication) {
      const effect = (powerRule?.effects || []).find((item) => safeStr(item?.id) === safeStr(patch.effectId)) || {};
      add({
        decisionType: "activeEffectChoice",
        effectId: safeStr(patch.effectId),
        effectType: normalizeMmLabel(patch.effectType || effect?.type || "custom"),
        owner: safeStr(patch.owner),
        pid: safeStr(patch.pid),
        pieceId: safeStr(patch.pieceId),
        choices: requiredRuntimeChoices(effect).length ? requiredRuntimeChoices(effect) : (getMmEffectMeta(effect?.type).choices || []),
        reason: `Complete os parametros do efeito ativo ${safeStr(patch.label || patch.effectType)}.`,
        data: patch,
      });
    }
  }

  const validation = validatePowerRule(powerRule || {}, { env });
  for (const decision of validation.pendingDecisionTemplates || []) {
    add(decision);
  }

  return decisions;
}

function rollEntriesFromResolution(resolution) {
  const rolls = [];
  for (const item of resolution?.effectResults || []) {
    if (item.d20 != null) {
      rolls.push({
        kind: "resistance",
        effectId: safeStr(item.effectId),
        d20: safeInt(item.d20),
        modifier: safeInt(item.statVal),
        total: safeInt(item.total),
        dc: safeInt(item.dc),
        degree: safeInt(item.degree),
        resistance: normalizeResistance(item.resistance),
      });
    }
    if (item.unreliable) {
      rolls.push({
        kind: "unreliable",
        effectId: safeStr(item.effectId),
        d100: safeInt(item.unreliable.roll),
        threshold: safeInt(item.unreliable.threshold),
        success: !!item.unreliable.success,
      });
    }
  }
  for (const patch of resolution?.patches || []) {
    if (patch.kind === "unreliable_check") {
      rolls.push({
        kind: "unreliable",
        effectId: safeStr(patch.effectId),
        d100: safeInt(patch.roll),
        threshold: safeInt(patch.threshold),
        success: !!patch.success,
      });
    }
  }
  return rolls;
}

export function buildCombatLog(input = {}) {
  const resolution = input.resolution || input;
  const event = input.event || {};
  const patches = resolution?.patches || [];
  const reactions = input.reactions || resolution?.pendingReactions || [];
  const pendingDecisions = input.pendingDecisions || resolution?.pendingDecisions || [];
  const entries = [];

  entries.push({
    kind: "power",
    powerRuleId: safeStr(resolution?.powerRuleId || input.powerRule?.id),
    powerName: safeStr(resolution?.powerName || input.powerRule?.name || event?.powerName || "Power"),
    actor: resolution?.actor || event?.actor || null,
    target: resolution?.target || event?.target || null,
  });

  for (const normalization of input.powerRule?.pokemonCore?.normalizations || []) {
    entries.push({
      kind: "pokemonCoreNormalization",
      type: safeStr(normalization?.type),
      move: safeStr(normalization?.move || input.powerRule?.pokemonCore?.move),
      traits: Array.isArray(normalization?.traits) ? normalization.traits : [],
      delta: Number.isFinite(Number(normalization?.delta)) ? safeInt(normalization.delta, 0) : null,
      removedEffectIds: Array.isArray(normalization?.removedEffectIds) ? normalization.removedEffectIds : [],
      appliedEffectIds: Array.isArray(normalization?.appliedEffectIds) ? normalization.appliedEffectIds : [],
      message: safeStr(normalization?.message),
    });
  }

  for (const roll of rollEntriesFromResolution(resolution)) {
    entries.push({ ...roll, rollKind: roll.kind, kind: "roll" });
  }

  for (const item of resolution?.effectResults || []) {
    entries.push({
      kind: "resistance",
      effectId: safeStr(item.effectId),
      effectType: safeStr(item.type),
      resistance: normalizeResistance(item.resistance),
      dc: safeInt(item.dc),
      degree: safeInt(item.degree),
      success: !!item.success,
      skipped: !!item.skipped,
    });
  }

  for (const patch of patches) {
    if (patch.kind === "hp") {
      entries.push({ kind: "damage", target: { owner: patch.owner, pid: patch.pid, pieceId: patch.pieceId }, before: patch.before, after: patch.after, delta: patch.delta });
    } else if (patch.kind === "conditions") {
      entries.push({ kind: "condition", target: { owner: patch.owner, pid: patch.pid, pieceId: patch.pieceId }, before: patch.before, after: patch.after, source: patch.source });
    } else if (patch.kind === "stat_boost") {
      entries.push({ kind: "trait", target: { owner: patch.owner, pid: patch.pid }, stat: patch.stat, before: patch.before, after: patch.after, delta: patch.delta });
    } else if (patch.kind === "active_effect") {
      entries.push({ kind: "activeEffect", activeEffectId: patch.id, effectType: patch.effectType, label: patch.label, owner: patch.owner, pid: patch.pid, duration: patch.duration });
    } else if (patch.kind === "attack_blocked") {
      entries.push({ kind: "blocked", by: patch.by, reason: patch.reason, attackTotal: patch.attackTotal, defenseTotal: patch.defenseTotal });
    }
  }

  for (const reaction of reactions) {
    entries.push({
      kind: "reactionAvailable",
      reactionId: reaction.id,
      reactor: reaction.reactor,
      powerName: reaction.powerName,
      effectType: reaction.effectType,
      trigger: reaction.trigger,
      cost: reaction.cost,
      validTargets: reaction.validTargets,
    });
  }

  for (const decision of pendingDecisions) {
    entries.push({
      kind: "pendingDecision",
      decisionId: decision.id,
      decisionType: decision.decisionType,
      effectType: decision.effectType,
      choices: decision.choices,
      reason: decision.reason,
    });
  }

  return {
    schema: "CombatLog",
    schemaVersion: 2,
    engineVersion: MM_RULES_ENGINE_VERSION,
    eventId: safeStr(event?.id),
    kind: safeStr(resolution?.kind || event?.type || "resolution"),
    summary: safeStr(resolution?.summary || input.summary || "Resolvido."),
    entries,
  };
}

function augmentResolution(resolution, powerRule, event, extra = {}, env = {}) {
  const validationV2 = validatePowerRule(powerRule || {}, { env });
  const pendingDecisions = pendingDecisionsFromResolution(resolution, powerRule, event, env);
  const pendingReactions = extra.pendingReactions || [];
  const combatLog = buildCombatLog({ resolution, powerRule, event, pendingDecisions, reactions: pendingReactions });
  return {
    ...resolution,
    schema: "CombatResolution",
    schemaVersion: 2,
    engineVersion: MM_RULES_ENGINE_VERSION,
    validationV2,
    pendingDecisions,
    pendingReactions,
    combatLog,
    requiresAdjudication: !!resolution?.requiresAdjudication || pendingDecisions.length > 0 || validationV2.status === "needsReview" || validationV2.status === "unsupported",
    unsupported: validationV2.status === "unsupported",
    needsReview: validationV2.status === "needsReview",
    ...extra,
  };
}

function emptyResolution(kind, event, extra = {}, env = {}) {
  const resolution = {
    schema: "CombatResolution",
    schemaVersion: 2,
    engineVersion: MM_RULES_ENGINE_VERSION,
    kind,
    powerRuleId: safeStr(event?.powerRule?.id),
    powerName: safeStr(event?.powerRule?.name),
    actor: event?.actor || event?.attack?.actor || null,
    target: event?.target || event?.attack?.target || null,
    effectResults: [],
    patches: [],
    undoPatches: [],
    adjudications: [],
    pendingDecisions: [],
    pendingReactions: [],
    requiresAdjudication: false,
    summary: safeStr(extra.summary || "Evento resolvido."),
    createdAtLocal: readRuleClock(env),
    ...extra,
  };
  resolution.combatLog = buildCombatLog({ resolution, event, reactions: resolution.pendingReactions });
  return resolution;
}

function resolveDeflectReaction(event, battleState = {}, decision = {}, envInput = {}) {
  const env = normalizeRuleEnv(envInput);
  const reaction = decision.reaction || event?.reaction;
  const attack = event?.attack || decision.attack || {};
  const effect = reaction?.effect || {};
  const powerRule = reaction?.powerRule || {};
  const rank = effectRank(effect, safeInt(reaction?.rank || powerRule?.live?.rank, 1));
  const manualMod = safeInt(decision.deflectMod ?? decision.modifier, 0);
  const generatedD20 = decision.d20 == null ? rollRuleDie(20, env) : null;
  if (decision.d20 == null && generatedD20 == null) {
    return emptyResolution("reaction", event, {
      powerRuleId: safeStr(reaction?.powerRuleId || powerRule?.id),
      powerName: safeStr(reaction?.powerName || powerRule?.name || "Deflect"),
      actor: reaction?.reactor || null,
      target: attack?.target || null,
      pendingDecisions: [{
        schema: "PendingDecision",
        schemaVersion: 2,
        id: uid("pd", env, [
          "deflectRoll",
          safeStr(event?.id),
          safeStr(reaction?.id),
          safeStr(reaction?.powerRuleId || powerRule?.id),
        ]),
        status: "pending",
        decisionType: "deflectRoll",
        powerRuleId: safeStr(reaction?.powerRuleId || powerRule?.id),
        powerName: safeStr(reaction?.powerName || powerRule?.name || "Deflect"),
        effectId: safeStr(reaction?.effectId || effect?.id),
        effectType: "deflect",
        owner: safeStr(reaction?.reactor?.owner),
        choices: ["d20"],
        reason: "Deflect precisa de rolagem d20 ou env.rng para resolver.",
      }],
      requiresAdjudication: true,
      summary: `${safeStr(reaction?.powerName || "Deflect")}: aguardando rolagem.`,
    }, env);
  }
  const rawD20 = decision.d20 == null
    ? generatedD20
    : clamp(safeInt(decision.d20, 1), 1, 20);
  const effectiveDie = rawD20 <= 10 ? rawD20 + 10 : rawD20;
  const deflectTotal = effectiveDie + rank + manualMod;
  const attackTotal = safeInt(attack.totalAtk ?? attack.attackTotal ?? attack.total_atk, 0);
  const attackTarget = attack?.target || {
    owner: safeStr(attack?.target_owner),
    pid: safeStr(attack?.target_pid),
    pieceId: safeStr(attack?.target_id),
  };
  const blocked = deflectTotal > attackTotal;
  const patch = {
    kind: blocked ? "attack_blocked" : "reaction_failed",
    reactionId: safeStr(reaction?.id),
    effectType: "deflect",
    by: reaction?.reactor || null,
    powerRuleId: safeStr(reaction?.powerRuleId || powerRule?.id),
    powerName: safeStr(reaction?.powerName || powerRule?.name || "Deflect"),
    attackTotal,
    defenseTotal: deflectTotal,
    d20: rawD20,
    effectiveDie,
    rank,
    manualMod,
    reason: blocked ? "Deflect superou o ataque." : "Ataque igualou ou superou Deflect.",
  };
  const resolution = emptyResolution("reaction", event, {
    powerRuleId: safeStr(reaction?.powerRuleId || powerRule?.id),
    powerName: safeStr(reaction?.powerName || powerRule?.name || "Deflect"),
    actor: reaction?.reactor || null,
    target: attackTarget || null,
    patches: [patch],
    effectResults: [{
      effectId: safeStr(reaction?.effectId || effect?.id),
      type: "deflect",
      d20: rawD20,
      effectiveDie,
      rank,
      total: deflectTotal,
      attackTotal,
      success: blocked,
      blocked,
    }],
    summary: blocked
      ? `${safeStr(reaction?.powerName || "Deflect")}: ataque bloqueado (${deflectTotal} > ${attackTotal})`
      : `${safeStr(reaction?.powerName || "Deflect")}: falhou (${deflectTotal} <= ${attackTotal})`,
    blocked,
  }, env);
  resolution.combatLog = buildCombatLog({ resolution, event });
  return resolution;
}

function resolveGenericReaction(event, decision = {}, env = {}) {
  const reaction = decision.reaction || event?.reaction;
  const resolution = emptyResolution("reaction", event, {
    powerRuleId: safeStr(reaction?.powerRuleId),
    powerName: safeStr(reaction?.powerName || "Reacao"),
    actor: reaction?.reactor || null,
    target: event?.attack?.target || null,
    pendingDecisions: [{
      schema: "PendingDecision",
      schemaVersion: 2,
      id: uid("pd", env, [
        "reactionEffect",
        safeStr(event?.id),
        safeStr(reaction?.id),
        safeStr(reaction?.powerRuleId),
        safeStr(reaction?.effectId),
      ]),
      status: "pending",
      decisionType: "reactionEffect",
      powerRuleId: safeStr(reaction?.powerRuleId),
      powerName: safeStr(reaction?.powerName),
      effectId: safeStr(reaction?.effectId),
      effectType: safeStr(reaction?.effectType),
      owner: safeStr(reaction?.reactor?.owner),
      choices: getMmEffectMeta(reaction?.effectType).choices || [],
      reason: "Reacao aceita; complete os dados do efeito para resolver pelo pipeline normal.",
    }],
    requiresAdjudication: true,
    summary: `${safeStr(reaction?.powerName || "Reacao")}: aguardando dados da reacao.`,
  }, env);
  resolution.combatLog = buildCombatLog({ resolution, event, pendingDecisions: resolution.pendingDecisions });
  return resolution;
}

export function resolveCombatEvent(event = {}, battleState = {}, decisions = {}, envInput = {}) {
  const env = normalizeRuleEnv(envInput);
  const type = safeStr(event.type);
  if (["attackDeclared", "attackRoll", "attack"].includes(type)) {
    const pendingReactions = collectPendingReactions(event, battleState, env);
    return emptyResolution("attackDeclared", event, {
      pendingReactions,
      requiresAdjudication: pendingReactions.length > 0,
      summary: pendingReactions.length
        ? `${pendingReactions.length} reacao(oes) elegivel(is).`
        : "Nenhuma reacao elegivel.",
    }, env);
  }

  if (type === "reactionDecision") {
    const reaction = decisions.reaction || event.reaction;
    if (!decisions.accept) {
      return emptyResolution("reaction", event, {
        actor: reaction?.reactor || null,
        target: event?.attack?.target || null,
        patches: [{
          kind: "reaction_ignored",
          reactionId: safeStr(reaction?.id),
          by: reaction?.reactor || null,
          powerName: safeStr(reaction?.powerName),
        }],
        summary: `${safeStr(reaction?.powerName || "Reacao")}: ignorada.`,
      }, env);
    }
    if (safeStr(reaction?.effectType) === "deflect") {
      return resolveDeflectReaction(event, battleState, decisions, env);
    }
    return resolveGenericReaction(event, decisions, env);
  }

  if (type === "resistanceCheck") {
    const input = {
      powerRule: event.powerRule,
      target: clone(event.target || {}),
      actor: event.actor || null,
      d20: event.d20,
      stats: event.stats || {},
      rank: event.rank,
      critBonus: event.critBonus,
      fallbackIsEffect: event.fallbackIsEffect,
      fallbackResistance: event.fallbackResistance,
      unreliableRolls: event.unreliableRolls,
      unreliableRoll: event.unreliableRoll,
      env,
    };
    const resolution = resolveMmPowerResistance(input);
    return augmentResolution(resolution, event.powerRule, event, {}, env);
  }

  if (type === "immediatePower") {
    const input = {
      powerRule: event.powerRule,
      actor: clone(event.actor || {}),
      target: clone(event.target || event.actor || {}),
      rank: event.rank,
      unreliableRolls: event.unreliableRolls,
      unreliableRoll: event.unreliableRoll,
      env,
    };
    const resolution = resolveMmImmediatePower(input);
    return augmentResolution(resolution, event.powerRule, event, {}, env);
  }

  return emptyResolution("unsupportedEvent", event, {
    requiresAdjudication: true,
    pendingDecisions: [{
      schema: "PendingDecision",
      schemaVersion: 2,
      id: uid("pd", env, ["unsupportedEvent", safeStr(event?.id), type]),
      status: "pending",
      decisionType: "unsupportedEvent",
      reason: `Evento ${type || "(vazio)"} ainda nao possui handler.`,
    }],
    summary: `Evento ${type || "(vazio)"} sem handler.`,
  }, env);
}

function applyPatchToCombatant(combatant, patch) {
  const next = { ...(combatant || {}) };
  if (patch.kind === "hp") {
    next.hp = safeInt(patch.after, safeInt(next.hp, 6));
  } else if (patch.kind === "conditions") {
    next.conditions = clone(patch.after?.mm_conditions || next.conditions || {});
    next.pokemonConditions = clone(patch.after?.pokemon_conditions || next.pokemonConditions || []);
  } else if (patch.kind === "stat_boost") {
    next.statBoosts = { ...(next.statBoosts || {}), [patch.stat]: safeInt(patch.after) };
  }
  return next;
}

export function applyCombatPatches(state = {}, patches = []) {
  const next = clone(state || {});
  const combatants = Array.isArray(next.combatants) ? next.combatants.map((item) => ({ ...(item || {}) })) : [];
  const activeEffects = Array.isArray(next.activeEffects) ? next.activeEffects.slice() : [];

  for (const patch of patches || []) {
    if (!patch || patch.kind === "adjudication" || patch.kind === "mm_decision") continue;
    if (["hp", "conditions", "stat_boost"].includes(patch.kind)) {
      const idx = combatants.findIndex((item) => (
        (patch.pieceId && safeStr(item.pieceId || item.id) === safeStr(patch.pieceId))
        || (safeStr(item.owner) === safeStr(patch.owner) && safeStr(item.pid) === safeStr(patch.pid))
      ));
      if (idx >= 0) combatants[idx] = applyPatchToCombatant(combatants[idx], patch);
    } else if (patch.kind === "active_effect") {
      activeEffects.push(clone(patch));
    } else if (patch.kind === "active_effect_remove") {
      const id = safeStr(patch.activeEffectId);
      const removeIdx = activeEffects.findIndex((item) => safeStr(item.id) === id);
      if (removeIdx >= 0) activeEffects.splice(removeIdx, 1);
    }
  }

  next.combatants = combatants;
  next.activeEffects = activeEffects;
  return next;
}

export { buildResistanceQueue };
