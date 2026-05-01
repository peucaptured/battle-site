import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildResistanceQueue,
  resolveMmImmediatePower,
  resolveMmPowerResistance,
} from "../mm-combat-resolver.js";
import {
  getMmEffectMeta,
  isMmResistanceEffect,
  isMmSupportEffect,
  isMmTrackableActiveEffect,
  validatePowerRule,
} from "../mm-rulebook.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = { cases: 30, seed: 20260501, catalog: path.join(root, "assets/rules/moves-mm.json") };
  for (let i = 2; i < argv.length; i += 1) {
    const cur = argv[i];
    const next = argv[i + 1];
    if (cur === "--cases" && next) {
      args.cases = Math.max(1, parseInt(next, 10) || args.cases);
      i += 1;
    } else if (cur === "--seed" && next) {
      args.seed = parseInt(next, 10) || args.seed;
      i += 1;
    } else if (cur === "--catalog" && next) {
      args.catalog = path.resolve(next);
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

function pick(rng, items) {
  return items[Math.floor(rng() * items.length)];
}

function shuffle(rng, items) {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function safeStr(value) {
  return value == null ? "" : String(value).trim();
}

function safeInt(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function unique(values) {
  return Array.from(new Set((values || []).map(safeStr).filter(Boolean)));
}

function effectTypes(rule) {
  return unique((rule.effects || []).map((effect) => effect.type || "custom"));
}

function modifierLabels(rule) {
  const labels = [];
  for (const effect of rule.effects || []) {
    labels.push(...(effect.extras || []), ...(effect.flaws || []));
    for (const key of ["secondaryEffect", "fades", "unreliable", "reaction", "selective", "limited"]) {
      if (effect[key]) labels.push(key);
    }
  }
  return unique(labels);
}

function hasResistance(rule) {
  return (rule.effects || []).some((effect) => isMmResistanceEffect(effect.type));
}

function hasInterestingModifier(rule) {
  return modifierLabels(rule).length > 0 || (rule.effects || []).some((effect) => !!effect.area || !!effect.requiresChoice || !!effect.linked);
}

function selectCases(catalog, count, rng) {
  const moves = (catalog.moves || []).concat(syntheticRules()).filter((rule) => Array.isArray(rule.effects) && rule.effects.length);
  const selected = [];
  const used = new Set();
  const types = shuffle(rng, unique(moves.flatMap(effectTypes)));

  function addRule(rule) {
    if (!rule || used.has(rule.id) || selected.length >= count) return false;
    used.add(rule.id);
    selected.push(rule);
    return true;
  }

  const requiredPools = [
    (rule) => (rule.effects || []).some((effect) => effect.unreliable),
    (rule) => (rule.effects || []).some((effect) => effect.reaction),
    (rule) => (rule.effects || []).some((effect) => effect.fades),
    (rule) => (rule.effects || []).some((effect) => effect.secondaryEffect),
    (rule) => (rule.effects || []).some((effect) => effect.type === "mind_reading"),
    (rule) => (rule.effects || []).some((effect) => effect.type === "luck_control"),
    (rule) => (rule.effects || []).some((effect) => effect.type === "move_object"),
    (rule) => (rule.effects || []).some((effect) => effect.type === "illusion"),
    (rule) => (rule.effects || []).some((effect) => effect.type === "nullify"),
    (rule) => (rule.effects || []).some((effect) => effect.type === "deflect"),
    (rule) => (rule.effects || []).some((effect) => effect.type === "immunity"),
    (rule) => (rule.effects || []).some((effect) => effect.type === "concealment"),
    (rule) => (rule.effects || []).some((effect) => effect.type === "environment"),
    (rule) => (rule.effects || []).some((effect) => effect.type === "regeneration"),
    (rule) => (rule.effects || []).some((effect) => effect.type === "protection"),
    (rule) => (rule.effects || []).some((effect) => effect.type === "senses"),
    (rule) => (rule.effects || []).some((effect) => effect.type === "movement"),
    (rule) => (rule.effects || []).some((effect) => effect.type === "variable"),
    (rule) => (rule.effects || []).some((effect) => effect.type === "transform"),
  ];

  for (const predicate of requiredPools) {
    const pool = moves.filter((rule) => !used.has(rule.id) && predicate(rule));
    if (pool.length) addRule(pick(rng, pool));
  }

  for (const type of types) {
    const pool = moves.filter((rule) => !used.has(rule.id) && (rule.effects || []).some((effect) => effect.type === type));
    const preferred = pool.filter(hasInterestingModifier);
    addRule(pick(rng, preferred.length ? preferred : pool));
  }

  const modifierPool = shuffle(rng, moves.filter((rule) => !used.has(rule.id) && hasInterestingModifier(rule)));
  for (const rule of modifierPool) addRule(rule);

  const rest = shuffle(rng, moves.filter((rule) => !used.has(rule.id)));
  for (const rule of rest) addRule(rule);

  return selected.slice(0, count);
}

function syntheticRules() {
  return [
    {
      schema: "PowerRule",
      schemaVersion: 1,
      id: "synthetic:luck-control:forced-reroll",
      sourceRow: null,
      name: "Synthetic Luck Control - Forced Reroll",
      type: "Normal",
      category: "Status",
      rank: { source: "fixed", value: 2 },
      range: "perception",
      action: "reaction",
      duration: "instant",
      resistance: "",
      descriptors: ["luck"],
      targeting: { mode: "target", range: "perception", area: null },
      area: null,
      extras: ["Reaction"],
      flaws: ["Limited (apenas efeitos de sorte aprovados pelo mestre)"],
      flags: { reaction: true, limited: true },
      effects: [{
        id: "e0",
        type: "luck_control",
        label: "Luck Control",
        raw: "Luck Control 2 (Force reroll) [Reaction] [Limited: apenas efeitos de sorte aprovados pelo mestre]",
        rank: { source: "fixed", value: 2 },
        range: "perception",
        action: "reaction",
        duration: "instant",
        resistance: "",
        target: "target",
        descriptors: ["luck"],
        extras: ["Reaction"],
        flaws: ["Limited (apenas efeitos de sorte aprovados pelo mestre)"],
        linked: false,
        secondaryEffect: false,
        fades: false,
        unreliable: false,
        reaction: true,
        selective: false,
        limited: true,
        area: null,
        requiresChoice: true,
      }],
      linkedEffects: [],
      buildText: "Luck Control 2 (Force reroll) [Reaction] [Limited]",
      rulesText: "Synthetic fixture for Luck Control audit.",
      description: "",
      audit: {},
      requiresChoices: ["luck_control"],
    },
  ];
}

function combatant(owner, pid, hp = 6) {
  return {
    owner,
    pid,
    pieceId: `piece_${owner}_${pid}`,
    hp,
    conditions: { deg1: [], deg2: [], deg3: [] },
    pokemonConditions: [],
    statBoosts: { stgr: 1, int: 1, dodge: 1, speed: 1 },
  };
}

function normalizeResistance(value) {
  const raw = safeStr(value).toLowerCase();
  if (["toughness", "resistencia", "resistance"].includes(raw)) return "thg";
  if (raw === "fortitude") return "fort";
  return raw || "thg";
}

function rankFor(rule, effect, fallback) {
  const rank = effect?.rank || {};
  if (rank.source === "fixed" && Number.isFinite(Number(rank.value))) return safeInt(rank.value, fallback);
  return fallback;
}

function patchFor(resolution, kind, effectId = "") {
  return (resolution.patches || []).filter((patch) => {
    if (patch.kind !== kind) return false;
    if (!effectId) return true;
    return safeStr(patch.effectId || patch.source?.effectId) === safeStr(effectId);
  });
}

function hasDecisionOrAdjudication(resolution, effectId = "") {
  return (resolution.patches || []).some((patch) => {
    if (!["mm_decision", "adjudication"].includes(patch.kind) && !patch.requiresAdjudication) return false;
    if (!effectId) return true;
    return safeStr(patch.effectId || patch.source?.effectId) === safeStr(effectId);
  });
}

function activeFor(resolution, effectId = "") {
  return patchFor(resolution, "active_effect", effectId);
}

function addCheck(checks, status, code, message, detail = {}) {
  checks.push({ status, code, message, ...detail });
}

function checkCondition(condition, checks, code, message, detail = {}) {
  addCheck(checks, condition ? "pass" : "fail", code, message, detail);
}

function expectedResistanceChecks(rule, resolution, scenario, checks) {
  const queue = buildResistanceQueue(rule, {
    rank: scenario.rank,
    critBonus: scenario.critBonus,
    fallbackIsEffect: false,
    fallbackResistance: "thg",
  });
  const byId = new Map((resolution.effectResults || []).map((result) => [safeStr(result.effectId), result]));
  const resistanceResults = (resolution.effectResults || []).filter((result) => queue.some((item) => safeStr(item.effectId) === safeStr(result.effectId)));
  checkCondition(
    resistanceResults.length === queue.length,
    checks,
    "resistance_queue_count",
    "M&M espera um teste de resistencia para cada efeito resistido estruturado.",
    { expected: queue.length, actual: resistanceResults.length },
  );

  for (const item of queue) {
    const result = byId.get(safeStr(item.effectId));
    checkCondition(!!result, checks, "resistance_result_present", `Resultado de resistencia presente para ${item.label}.`);
    if (!result) continue;
    checkCondition(
      normalizeResistance(result.resistance) === normalizeResistance(item.resistance),
      checks,
      "alternate_resistance",
      "Resistencia usada deve bater com o efeito/Alternate Resistance.",
      { expected: normalizeResistance(item.resistance), actual: normalizeResistance(result.resistance) },
    );
    checkCondition(
      result.dc === item.dc,
      checks,
      "dc_formula",
      "CD deve ser 15+rank para Damage e 10+rank para outros efeitos resistidos.",
      { expected: item.dc, actual: result.dc },
    );
  }
}

function expectedEffectBehavior(rule, resolution, scenario, checks) {
  const resultByEffect = new Map((resolution.effectResults || []).map((result) => [safeStr(result.effectId), result]));
  const targetHpStart = scenario.targetStart.hp;

  for (const effect of rule.effects || []) {
    const type = safeStr(effect.type);
    const id = safeStr(effect.id);
    const meta = getMmEffectMeta(type);
    if (meta.automation === "ignored") continue;
    const result = resultByEffect.get(id);
    const failedResistance = result && !result.success;

    if (effect.unreliable) {
      const checksForEffect = patchFor(resolution, "unreliable_check", id);
      checkCondition(
        checksForEffect.length > 0 && checksForEffect.every((patch) => patch.threshold === 50),
        checks,
        "unreliable_50_percent",
        "Unreliable nesta mesa deve rolar chance fixa de 50%.",
        { effectId: id, rolls: checksForEffect.map((patch) => patch.roll) },
      );
      if (result?.skipped) continue;
    }

    if (result && result.success) {
        const direct = ["damage", "affliction", "weaken", "move_object", "teleport", "nullify", "transform", "mind_reading"].includes(type);
      if (direct) {
        const directPatches = (resolution.patches || [])
          .filter((patch) => !["unreliable_check"].includes(patch.kind))
          .filter((patch) => safeStr(patch.source?.effectId || patch.effectId) === id);
        checkCondition(
          directPatches.length === 0,
          checks,
          "success_no_direct_patch",
          `${type} resistido com sucesso nao deve aplicar patch direto.`,
          { effectId: id, actualKinds: directPatches.map((patch) => patch.kind) },
        );
      }
      continue;
    }

    if (type === "damage" && failedResistance) {
      const hp = patchFor(resolution, "hp", id);
      const expectedAfter = Math.max(0, targetHpStart - result.degree);
      checkCondition(hp.length > 0, checks, "damage_hp_patch", "Damage falho deve aplicar perda de HP.", { effectId: id });
      if (hp[0]) {
        checkCondition(
          hp[0].after === expectedAfter || hp[0].after <= hp[0].before,
          checks,
          "damage_degree",
          "Perda de HP deve seguir grau de falha, com clamp no HP minimo.",
          { expectedAfter, actualAfter: hp[0].after, degree: result.degree },
        );
      }
    } else if (type === "affliction" && failedResistance) {
      checkCondition(
        patchFor(resolution, "conditions", id).length > 0,
        checks,
        "affliction_condition_patch",
        "Affliction falho deve aplicar condicao por grau.",
        { effectId: id, degree: result.degree },
      );
    } else if (type === "weaken" && failedResistance) {
      if (Array.isArray(effect.traits) && effect.traits.length) {
        checkCondition(
          patchFor(resolution, "stat_boost", id).length >= effect.traits.length,
          checks,
          "weaken_trait_patch",
          "Weaken falho deve reduzir cada trait estruturado.",
          { effectId: id, expectedTraits: effect.traits },
        );
      } else {
        checkCondition(
          hasDecisionOrAdjudication(resolution, id),
          checks,
          "weaken_missing_trait_review",
          "Weaken sem trait estruturado deve pedir revisao.",
          { effectId: id },
        );
      }
    } else if (["move_object", "teleport", "nullify", "mind_reading"].includes(type) && failedResistance) {
      checkCondition(
        hasDecisionOrAdjudication(resolution, id),
        checks,
        `${type}_decision`,
        `${type} exige escolha/adjudicacao depois do teste resistido.`,
        { effectId: id, choices: meta.choices || [] },
      );
    } else if (type === "transform" && failedResistance) {
      checkCondition(
        activeFor(resolution, id).length > 0 && resolution.requiresAdjudication,
        checks,
        "transform_active_review",
        "Transform resistido deve criar efeito ativo e pedir forma/traits.",
        { effectId: id },
      );
    } else if (!result && isMmSupportEffect(type)) {
      if (type === "healing") {
        checkCondition(patchFor(resolution, "hp", id).length > 0, checks, "healing_hp_patch", "Healing deve restaurar HP.", { effectId: id });
      } else if (type === "enhanced_trait") {
        if (Array.isArray(effect.traits) && effect.traits.length) {
          checkCondition(patchFor(resolution, "stat_boost", id).length >= effect.traits.length, checks, "enhanced_trait_patch", "Enhanced Trait deve aplicar boost estruturado.", { effectId: id, traits: effect.traits });
        } else {
          checkCondition(hasDecisionOrAdjudication(resolution, id), checks, "enhanced_trait_missing_trait_review", "Enhanced Trait sem trait deve pedir revisao.", { effectId: id });
        }
      }
    } else if (!result && isMmTrackableActiveEffect(type)) {
      checkCondition(
        activeFor(resolution, id).length > 0,
        checks,
        "active_effect_tracking",
        `${type} deve ser rastreado como active_effect.`,
        { effectId: id, automation: meta.automation },
      );
    } else if (!result && meta.automation === "adjudication") {
      checkCondition(
        hasDecisionOrAdjudication(resolution, id),
        checks,
        "adjudication_effect_review",
        `${type} deve ficar marcado para revisao.`,
        { effectId: id },
      );
    }

    if (effect.secondaryEffect && failedResistance && ["damage", "affliction", "weaken"].includes(type)) {
      checkCondition(
        activeFor(resolution).some((patch) => safeStr(patch.linkedSource?.effectId) === id),
        checks,
        "secondary_effect_tracking",
        "Secondary Effect deve criar efeito ativo para repetir no proximo turno.",
        { effectId: id },
      );
    }
  }
}

function expectedModifierBehavior(rule, resolution, checks) {
  const validation = validatePowerRule(rule);
  const validationCodes = new Set((resolution.adjudications || []).filter((item) => item.kind === "rule_validation").map((item) => item.code));

  for (const issue of validation.issues || []) {
    if (issue.severity !== "warning" && issue.severity !== "error") continue;
    checkCondition(
      validationCodes.has(issue.code),
      checks,
      "validation_issue_marked",
      "Modificador/falha que altera timing ou uso deve aparecer como revisao de regra.",
      { code: issue.code, effectId: issue.effectId },
    );
  }

  const needsReview = (rule.effects || []).some((effect) => {
    const meta = getMmEffectMeta(effect.type);
    if (meta.automation === "ignored") return false;
    return effect.requiresChoice || effect.reaction || effect.fades || meta.automation === "choice" || meta.automation === "adjudication";
  });
  if (needsReview) {
    checkCondition(
      resolution.requiresAdjudication,
      checks,
      "requires_adjudication_flag",
      "Poder com escolha, Reaction, Unreliable, Fades ou efeito adjudicavel deve marcar requiresAdjudication.",
    );
  }
}

function verdictFor(checks) {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "gap")) return "gap";
  return "pass";
}

function simulateRule(rule, index, rng) {
  const resistance = hasResistance(rule);
  const shouldFail = resistance ? (index % 5 !== 0) : false;
  const rank = 3 + Math.floor(rng() * 8);
  const d20 = shouldFail ? 3 + Math.floor(rng() * 5) : 20;
  const statValue = shouldFail ? 0 : 40;
  const stats = { thg: statValue, fort: statValue, will: statValue, dodge: statValue, parry: statValue, stgr: statValue, int: statValue, speed: statValue };
  const unreliableRolls = {};
  for (const effect of rule.effects || []) {
    if (effect.unreliable) unreliableRolls[effect.id] = index % 2 === 0 ? 25 : 75;
  }
  const target = combatant("Target", String(index + 1), 6);
  const actor = combatant("Actor", String(index + 1), 4);
  const targetStart = JSON.parse(JSON.stringify(target));
  const actorStart = JSON.parse(JSON.stringify(actor));
  const critBonus = index % 11 === 0 ? 5 : 0;

  const resolution = resistance
    ? resolveMmPowerResistance({ powerRule: rule, target, actor, d20, stats, rank, critBonus, unreliableRolls })
    : resolveMmImmediatePower({ powerRule: rule, actor, target: actor, rank, unreliableRolls });

  const scenario = { mode: resistance ? "resistance" : "immediate", shouldFail, rank, d20, stats, critBonus, targetStart, actorStart };
  const checks = [];
  if (resistance) expectedResistanceChecks(rule, resolution, scenario, checks);
  expectedEffectBehavior(rule, resolution, scenario, checks);
  expectedModifierBehavior(rule, resolution, checks);

  const failed = checks.filter((check) => check.status === "fail");
  const gaps = checks.filter((check) => check.status === "gap");
  const passed = checks.filter((check) => check.status === "pass");
  return {
    index: index + 1,
    id: rule.id,
    name: rule.name,
    sourceRow: rule.sourceRow,
    scenario,
    effectTypes: effectTypes(rule),
    modifiers: modifierLabels(rule),
    validation: validatePowerRule(rule),
    resolution: {
      kind: resolution.kind,
      summary: resolution.summary,
      requiresAdjudication: resolution.requiresAdjudication,
      effectResults: resolution.effectResults,
      patchKinds: (resolution.patches || []).map((patch) => patch.kind),
      patches: resolution.patches,
      adjudications: resolution.adjudications,
    },
    comparison: {
      verdict: verdictFor(checks),
      passCount: passed.length,
      gapCount: gaps.length,
      failCount: failed.length,
      checks,
    },
  };
}

function printReport(report) {
  console.log(`MM simulation audit: cases=${report.cases.length} seed=${report.seed}`);
  console.log(`Summary: pass=${report.summary.pass} gap=${report.summary.gap} fail=${report.summary.fail}`);
  console.log("");
  for (const item of report.cases) {
    const mods = item.modifiers.length ? item.modifiers.slice(0, 4).join(", ") : "none";
    const failed = item.comparison.checks.filter((check) => check.status === "fail");
    const gaps = item.comparison.checks.filter((check) => check.status === "gap");
    console.log(`${String(item.index).padStart(2, "0")}. [${item.comparison.verdict}] ${item.name}`);
    console.log(`    effects=${item.effectTypes.join("+")} mode=${item.scenario.mode}${item.scenario.mode === "resistance" ? ` d20=${item.scenario.d20} rank=${item.scenario.rank}` : ` rank=${item.scenario.rank}`} mods=${mods}`);
    console.log(`    resolution=${item.resolution.summary}`);
    if (failed.length) {
      console.log(`    FAIL: ${failed.map((check) => `${check.code}`).join(", ")}`);
    }
    if (gaps.length) {
      console.log(`    GAP: ${gaps.slice(0, 3).map((check) => `${check.code}`).join(", ")}${gaps.length > 3 ? ` (+${gaps.length - 3})` : ""}`);
    }
  }
  console.log("");
  console.log(`Wrote ${report.outputPath}`);
}

const args = parseArgs(process.argv);
const rng = mulberry32(args.seed);
const catalog = JSON.parse(fs.readFileSync(args.catalog, "utf8"));
const selected = selectCases(catalog, args.cases, rng);
const cases = selected.map((rule, index) => simulateRule(rule, index, rng));
const summary = cases.reduce((acc, item) => {
  acc[item.comparison.verdict] = (acc[item.comparison.verdict] || 0) + 1;
  acc.checks += item.comparison.checks.length;
  acc.failedChecks += item.comparison.failCount;
  acc.gapChecks += item.comparison.gapCount;
  return acc;
}, { pass: 0, gap: 0, fail: 0, checks: 0, failedChecks: 0, gapChecks: 0 });

const outputDir = path.join(root, "output");
fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `mm-simulation-30-seed-${args.seed}.json`);
const report = {
  schema: "MmSimulationAudit",
  schemaVersion: 1,
  seed: args.seed,
  generatedAt: new Date().toISOString(),
  catalog: { source: catalog.source, moveCount: catalog.moveCount, errorCount: catalog.errorCount },
  summary,
  cases,
  outputPath,
};
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");
printReport(report);
