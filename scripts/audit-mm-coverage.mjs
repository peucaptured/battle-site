import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getMmEffectMeta, validatePowerRule } from "../mm-rulebook.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, "../assets/rules/moves-mm.json");

const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const effectCounts = new Map();
const statusCounts = new Map();
const issueCounts = new Map();
const choiceCounts = new Map();

for (const rule of catalog.moves || []) {
  const validation = validatePowerRule(rule);
  statusCounts.set(validation.status, (statusCounts.get(validation.status) || 0) + 1);
  for (const issue of validation.issues || []) {
    issueCounts.set(issue.code, (issueCounts.get(issue.code) || 0) + 1);
  }
  for (const effect of rule.effects || []) {
    const type = effect.type || "custom";
    effectCounts.set(type, (effectCounts.get(type) || 0) + 1);
    if (effect.requiresChoice && getMmEffectMeta(type).automation !== "ignored") {
      choiceCounts.set(type, (choiceCounts.get(type) || 0) + 1);
    }
  }
}

function sortedObject(map) {
  return Object.fromEntries(Array.from(map.entries()).sort((a, b) => b[1] - a[1]));
}

console.log(JSON.stringify({
  catalog: {
    moveCount: catalog.moveCount,
    errorCount: catalog.errorCount,
    source: catalog.source,
  },
  validationStatus: sortedObject(statusCounts),
  effectCounts: sortedObject(effectCounts),
  requiresChoice: sortedObject(choiceCounts),
  issues: sortedObject(issueCounts),
}, null, 2));
