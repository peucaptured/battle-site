import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  fallbackPowerRuleFromMove,
  mergeLiveMoveIntoPowerRule,
  normalizePowerName,
} from "../mm-power-catalog.js";
import { validatePowerRule } from "../mm-rulebook.js?v=20260504mm10";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const sheetsPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, ".codex-artifacts/sheets-export-decoded.json");
const outputBase = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(root, ".codex-artifacts/firebase-sheets-mm-move-analysis-after-debuff-fix");

function safeStr(value) {
  return value == null ? "" : String(value).trim();
}

function normalizeText(value) {
  return safeStr(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildCatalogIndex(catalog) {
  const byName = new Map();
  for (const rule of catalog.moves || []) {
    const key = normalizePowerName(rule.name);
    if (!key) continue;
    const bucket = byName.get(key) || [];
    bucket.push(rule);
    byName.set(key, bucket);
  }
  return byName;
}

function findCatalogRule(index, move) {
  const key = normalizePowerName(move?.name || move?.Nome || move?.nome);
  const candidates = key ? (index.get(key) || []) : [];
  if (candidates.length <= 1) return candidates[0] || null;
  const moveType = normalizePowerName(move?.meta?.type || move?.type || "");
  const category = normalizePowerName(move?.meta?.category || move?.category || "");
  return candidates.find((rule) => {
    const sameType = !moveType || normalizePowerName(rule.type) === moveType;
    const sameCategory = !category || normalizePowerName(rule.category) === category;
    return sameType && sameCategory;
  }) || candidates[0];
}

function moveDisplayContext(sheet, move) {
  const pokemon = sheet?.pokemon || {};
  return {
    path: safeStr(sheet?._path),
    trainer: safeStr(sheet?.trainer_name),
    pokemon: safeStr(pokemon.name || pokemon.species || pokemon.nickname || sheet?.linked_pid),
    move: safeStr(move?.name || move?.Nome || move?.nome),
  };
}

function hasRuntimeDecision(validation, rule) {
  const issueCodes = (validation.issues || []).map((issue) => issue.code || "");
  return (validation.pendingDecisionTemplates || []).length > 0
    || (rule.effects || []).some((effect) => effect.requiresChoice)
    || issueCodes.includes("unreliable_50_percent");
}

function isGenericFallback(rule) {
  return rule?.schemaVersion === 1 && normalizePowerName(rule?.id).startsWith("fallback");
}

function classifyMove({ matched, rule, validation }) {
  const status = safeStr(validation.status).replace(/-/g, "_");
  const issueCodes = (validation.issues || []).map((issue) => issue.code || issue.severity || "");
  const needsReviewIssue = issueCodes.some((code) => !["unreliable_50_percent"].includes(code));
  if (status === "unsupported" || status === "invalid") return "unsupported";
  if (needsReviewIssue) return "needsReview";
  if (hasRuntimeDecision(validation, rule)) return "requiresRuntimeDecision";
  if (status === "needs_review") return "needsReview";
  if (isGenericFallback(rule)) return "genericHandlerOnly";
  if (!matched || rule.source === "sheet_build") return "automatedWithFallback";
  return "fullyAutomated";
}

function statShiftNotes(rule) {
  const notes = safeStr(rule?.audit?.notes || rule?.notes || "");
  const match = notes.match(/Stat shifts:\s*([^|]+)/i);
  const out = {};
  if (!match) return out;
  for (const part of match[1].split(",")) {
    const m = part.match(/(.+?)\s*([+-]\d+)\s*$/);
    if (!m) continue;
    const traits = m[1]
      .replace(/\b(?:and|e)\b/gi, "&")
      .split(/&|\/|,/)
      .map((trait) => normalizePowerName(trait).replace(/-/g, "_"))
      .filter(Boolean);
    for (const trait of traits) out[trait] = Number.parseInt(m[2], 10);
  }
  return out;
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

function selfDebuffIssues(rule) {
  const shifts = statShiftNotes(rule);
  const expected = Object.entries(shifts).filter(([, delta]) => delta < 0);
  if (!expected.length || !notesDescribeUserStatLoss(rule)) return [];
  const issues = [];
  for (const [trait, delta] of expected) {
    const hasSelfShift = (rule.effects || []).some((effect) => (
      effect.type === "enhanced_trait"
      && effect.target === "self"
      && (effect.traits || []).includes(trait)
      && Number(effect.statDeltas?.[trait] ?? effect.statDelta) === delta
    ));
    const hasTargetWeaken = (rule.effects || []).some((effect) => (
      effect.type === "weaken"
      && effect.target === "target"
      && (effect.traits || []).includes(trait)
    ));
    if (!hasSelfShift) issues.push(`missing self ${trait} ${delta}`);
    if (hasTargetWeaken) issues.push(`target weaken still present for ${trait}`);
  }
  return issues;
}

function csvEscape(value) {
  const text = safeStr(value);
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function mapToObject(map) {
  return Object.fromEntries(Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function addExample(examples, category, row) {
  const bucket = examples[category] || (examples[category] = []);
  if (bucket.length >= 8) return;
  if (bucket.some((item) => item.move === row.move)) return;
  bucket.push({
    move: row.move,
    trainer: row.trainer,
    pokemon: row.pokemon,
    source: row.source,
    effects: row.effects,
    validationStatus: row.validationStatus,
    decisions: row.decisions,
  });
}

function categoryRank(category) {
  return {
    unsupported: 6,
    needsReview: 5,
    requiresRuntimeDecision: 4,
    genericHandlerOnly: 3,
    automatedWithFallback: 2,
    fullyAutomated: 1,
  }[category] || 0;
}

const sheets = readJson(sheetsPath);
const catalog = readJson(path.join(root, "assets/rules/moves-mm.json"));
const catalogIndex = buildCatalogIndex(catalog);
const rows = [];
const counts = new Map();
const unique = new Map();
const sourceCounts = new Map();
const effectCounts = new Map();
const issueCounts = new Map();
const examples = {};
const selfDebuffProblems = [];

for (const sheet of sheets) {
  const moves = Array.isArray(sheet.moves) ? sheet.moves : [];
  for (let moveIndex = 0; moveIndex < moves.length; moveIndex += 1) {
    const move = moves[moveIndex];
    const matched = findCatalogRule(catalogIndex, move);
    const rule = matched ? mergeLiveMoveIntoPowerRule(matched, move) : fallbackPowerRuleFromMove(move);
    const validation = validatePowerRule(rule);
    const category = classifyMove({ matched, rule, validation });
    const effects = (rule.effects || []).map((effect) => effect.type).join("+") || "none";
    const decisions = (validation.pendingDecisionTemplates || []).map((decision) => decision.effectType || decision.decisionType).join("+");
    const row = {
      ...moveDisplayContext(sheet, move),
      moveIndex,
      catalogMatched: !!matched,
      source: safeStr(rule.source || (isGenericFallback(rule) ? "schema_v1_generic_fallback" : "catalog")),
      category,
      validationStatus: validation.status,
      effects,
      decisions,
      issues: (validation.issues || []).map((issue) => issue.code || issue.message).join("|"),
      selfDebuffIssues: selfDebuffIssues(rule).join("|"),
    };

    if (row.selfDebuffIssues) selfDebuffProblems.push(row);
    rows.push(row);
    increment(counts, category);
    increment(sourceCounts, row.source);
    for (const effect of rule.effects || []) increment(effectCounts, effect.type || "custom");
    for (const issue of validation.issues || []) increment(issueCounts, issue.code || issue.severity || "issue");
    addExample(examples, category, row);

    const uniqueKey = normalizePowerName(row.move);
    const prev = unique.get(uniqueKey);
    if (!prev || categoryRank(category) > categoryRank(prev.category)) unique.set(uniqueKey, row);
  }
}

const uniqueCounts = new Map();
for (const row of unique.values()) increment(uniqueCounts, row.category);

const report = {
  schema: "FirebaseSheetsMmMoveAudit",
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  input: path.relative(root, sheetsPath),
  totals: {
    sheets: sheets.length,
    moveOccurrences: rows.length,
    uniqueMoves: unique.size,
    catalogMoves: catalog.moveCount || (catalog.moves || []).length,
    selfDebuffProblemCount: selfDebuffProblems.length,
  },
  categories: mapToObject(counts),
  uniqueCategories: mapToObject(uniqueCounts),
  sources: mapToObject(sourceCounts),
  effects: mapToObject(effectCounts),
  validationIssues: mapToObject(issueCounts),
  examples,
  selfDebuffProblems,
  rows,
};

fs.mkdirSync(path.dirname(outputBase), { recursive: true });
fs.writeFileSync(`${outputBase}.json`, `${JSON.stringify(report, null, 2)}\n`);

const csvHeader = [
  "category",
  "move",
  "trainer",
  "pokemon",
  "path",
  "catalogMatched",
  "source",
  "validationStatus",
  "effects",
  "decisions",
  "issues",
  "selfDebuffIssues",
];
const csv = [
  csvHeader.join(","),
  ...rows.map((row) => csvHeader.map((key) => csvEscape(row[key])).join(",")),
].join("\n");
fs.writeFileSync(`${outputBase}.csv`, `${csv}\n`);

const md = [
  "# Firebase Sheets M&M Move Audit",
  "",
  `Input: \`${path.relative(root, sheetsPath)}\``,
  "",
  "## Totals",
  "",
  `- Sheets: ${report.totals.sheets}`,
  `- Move occurrences: ${report.totals.moveOccurrences}`,
  `- Unique moves: ${report.totals.uniqueMoves}`,
  `- Catalog moves: ${report.totals.catalogMoves}`,
  `- Self-debuff problems after normalization: ${report.totals.selfDebuffProblemCount}`,
  "",
  "## Categories",
  "",
  ...Object.entries(report.categories).map(([key, value]) => `- ${key}: ${value}`),
  "",
  "## Unique Categories",
  "",
  ...Object.entries(report.uniqueCategories).map(([key, value]) => `- ${key}: ${value}`),
  "",
  "## Sources",
  "",
  ...Object.entries(report.sources).map(([key, value]) => `- ${key}: ${value}`),
  "",
  "## Example Moves",
  "",
  ...Object.entries(report.examples).flatMap(([category, items]) => [
    `### ${category}`,
    "",
    ...items.map((item) => `- ${item.move} (${item.pokemon || item.trainer || "sem ficha"}) - ${item.source}; effects: ${item.effects || "none"}${item.decisions ? `; decisions: ${item.decisions}` : ""}`),
    "",
  ]),
].join("\n");
fs.writeFileSync(`${outputBase}.md`, `${md}\n`);

console.log(JSON.stringify({
  totals: report.totals,
  categories: report.categories,
  uniqueCategories: report.uniqueCategories,
  sources: report.sources,
  selfDebuffProblemCount: report.totals.selfDebuffProblemCount,
  outputBase: path.relative(root, outputBase),
}, null, 2));

if (selfDebuffProblems.length || (report.categories.unsupported || 0) > 0) {
  process.exitCode = 1;
}
