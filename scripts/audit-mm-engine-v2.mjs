import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getRulesEngineRegistry,
  validatePowerRule,
} from "../mm-rules-engine.js";
import {
  normalizeMmLabel,
  normalizeMmModifier,
} from "../mm-rulebook.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const catalogPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, "assets/rules/moves-mm.json");

const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const registry = getRulesEngineRegistry();
const statusCounts = new Map();
const issueCounts = new Map();
const unsupported = [];
const runtimeDecisionCounts = new Map();
const effectCounts = new Map();
const modifierCounts = new Map();
const modifierRawExamples = new Map();

for (const rule of catalog.moves || []) {
  const validation = validatePowerRule(rule);
  statusCounts.set(validation.status, (statusCounts.get(validation.status) || 0) + 1);
  for (const issue of validation.issues || []) {
    issueCounts.set(issue.code, (issueCounts.get(issue.code) || 0) + 1);
  }
  for (const decision of validation.pendingDecisionTemplates || []) {
    runtimeDecisionCounts.set(decision.effectType, (runtimeDecisionCounts.get(decision.effectType) || 0) + 1);
  }
  if (validation.status === "unsupported") {
    unsupported.push({
      id: rule.id,
      name: rule.name,
      issues: validation.issues,
    });
  }
  for (const effect of rule.effects || []) {
    const effectType = normalizeMmLabel(effect?.type || "custom") || "custom";
    effectCounts.set(effectType, (effectCounts.get(effectType) || 0) + 1);
    const labels = [
      ...(Array.isArray(rule.extras) ? rule.extras : []),
      ...(Array.isArray(rule.flaws) ? rule.flaws : []),
      ...(Array.isArray(effect?.extras) ? effect.extras : []),
      ...(Array.isArray(effect?.flaws) ? effect.flaws : []),
    ];
    for (const label of labels) {
      const key = normalizeMmModifier(label);
      if (!key) continue;
      modifierCounts.set(key, (modifierCounts.get(key) || 0) + 1);
      if (!modifierRawExamples.has(key)) modifierRawExamples.set(key, new Set());
      if (modifierRawExamples.get(key).size < 8) modifierRawExamples.get(key).add(String(label));
    }
  }
}

function sortedObject(map) {
  return Object.fromEntries(Array.from(map.entries()).sort((a, b) => b[1] - a[1]));
}

const report = {
  schema: "MmEngineCoverageAudit",
  schemaVersion: 2,
  engineVersion: registry.engineVersion,
  catalog: {
    moveCount: catalog.moveCount,
    errorCount: catalog.errorCount,
    source: catalog.source,
  },
  validationStatus: sortedObject(statusCounts),
  effectCoverage: {
    uniqueCount: effectCounts.size,
    missingHandlers: Array.from(effectCounts.keys())
      .filter((type) => !registry.effects[type])
      .sort(),
    counts: sortedObject(effectCounts),
  },
  modifierCoverage: {
    uniqueCount: modifierCounts.size,
    missingHandlers: Array.from(modifierCounts.keys())
      .filter((key) => !registry.modifiers[key])
      .sort(),
    counts: sortedObject(modifierCounts),
    examples: Object.fromEntries(Array.from(modifierRawExamples.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, values]) => [key, Array.from(values)])),
  },
  runtimeDecisions: sortedObject(runtimeDecisionCounts),
  issues: sortedObject(issueCounts),
  unsupportedCount: unsupported.length,
  unsupported,
};

console.log(JSON.stringify(report, null, 2));
if (
  unsupported.length
  || report.effectCoverage.missingHandlers.length
  || report.modifierCoverage.missingHandlers.length
) process.exitCode = 1;
