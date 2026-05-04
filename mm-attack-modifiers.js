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

function normalizeText(value) {
  return safeStr(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function structuredModifierText(powerRule) {
  const parts = [
    ...(Array.isArray(powerRule?.extras) ? powerRule.extras : []),
    ...(Array.isArray(powerRule?.flaws) ? powerRule.flaws : []),
  ];
  for (const effect of Array.isArray(powerRule?.effects) ? powerRule.effects : []) {
    parts.push(
      safeStr(effect?.raw),
      ...(Array.isArray(effect?.extras) ? effect.extras : []),
      ...(Array.isArray(effect?.flaws) ? effect.flaws : []),
    );
  }
  return parts.filter(Boolean).join("; ");
}

function modifierText(powerRule) {
  return safeStr(powerRule?.buildText)
    || safeStr(powerRule?.audit?.build)
    || structuredModifierText(powerRule);
}

function allRuleText(powerRule) {
  return [
    modifierText(powerRule),
    safeStr(powerRule?.rulesText),
    safeStr(powerRule?.description),
    safeStr(powerRule?.audit?.notes),
  ].filter(Boolean).join("; ");
}

function sumModifierRanks(text, label, defaultRank = 1) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const re = new RegExp(`(^|[^A-Za-z])${escaped}(?:\\s+(\\d+))?\\b`, "gi");
  let total = 0;
  for (const match of safeStr(text).matchAll(re)) {
    total += Math.max(1, safeInt(match[2], defaultRank));
  }
  return total;
}

function hasHighCriticalText(text) {
  const raw = normalizeText(text);
  return /\bhigh critical hit ratio\b/.test(raw)
    || /\bincreased chance (?:for|of).*critical hit\b/.test(raw)
    || /\balta chance de critico\b/.test(raw)
    || /\bmaior chance de critico\b/.test(raw);
}

function hasGuaranteedCriticalText(text) {
  const raw = normalizeText(text);
  return /\balways (?:scores?|results? in) a critical hit\b/.test(raw)
    || /\bguarantees? a critical hit\b/.test(raw)
    || /\bsempre.*critico\b/.test(raw)
    || /\bcritico garantido\b/.test(raw)
    || /\bacertos? contam? como critico\b/.test(raw)
    || /\bacerto conta como critico\b/.test(raw);
}

export function getAttackModifierSummary(powerRule = {}, attackerStats = {}) {
  const primaryText = modifierText(powerRule);
  const fullText = allRuleText(powerRule);
  const accurateRanks = sumModifierRanks(primaryText, "Accurate");
  const inaccurateRanks = sumModifierRanks(primaryText, "Inaccurate");
  let improvedCriticalRanks = sumModifierRanks(primaryText, "Improved Critical");
  if (!improvedCriticalRanks && hasHighCriticalText(fullText)) improvedCriticalRanks = 1;

  const statCriticalRanks = Math.max(0, safeInt(
    attackerStats?.critical ?? attackerStats?.crit ?? attackerStats?.critico,
    0,
  ));
  const criticalRanks = Math.max(0, improvedCriticalRanks + statCriticalRanks);
  const criticalThreshold = criticalRanks > 0 ? clamp(20 - criticalRanks, 2, 20) : 20;
  const guaranteedCritical = hasGuaranteedCriticalText(fullText);
  const attackBonus = (accurateRanks * 2) - (inaccurateRanks * 2);

  return {
    accurateRanks,
    inaccurateRanks,
    attackBonus,
    improvedCriticalRanks,
    statCriticalRanks,
    criticalRanks,
    criticalThreshold,
    guaranteedCritical,
  };
}

export function resolveAttackHitAndCritical({ roll, totalAtk, needed, powerRule = {}, attackerStats = {} } = {}) {
  const d20 = safeInt(roll, 0);
  const summary = getAttackModifierSummary(powerRule, attackerStats);
  let hit = false;
  if (d20 === 1) hit = false;
  else if (d20 === 20) hit = true;
  else hit = safeInt(totalAtk, 0) >= safeInt(needed, 0);

  const critical = hit && d20 !== 1 && (
    d20 === 20
    || summary.guaranteedCritical
    || (summary.criticalRanks > 0 && d20 >= summary.criticalThreshold)
  );

  return {
    hit,
    critical,
    critBonus: critical ? 5 : 0,
    ...summary,
  };
}
