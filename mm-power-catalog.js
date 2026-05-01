const CATALOG_URL = "./assets/rules/moves-mm.json";

import { isMmSupportEffect, isMmTrackableActiveEffect, validatePowerRule } from "./mm-rulebook.js?v=20260501mm8";

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

export function normalizePowerName(value) {
  return safeStr(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
  const liveRank = safeInt(move?.rank ?? move?.damage ?? move?.power ?? move?.lvl, 0);
  const liveAccuracy = safeInt(move?.accuracy ?? move?.acc ?? move?.acerto ?? move?.modificador, 0);
  const liveType = safeStr(move?.meta?.type || move?.type);
  const liveCategory = safeStr(move?.meta?.category || move?.category);
  const cloned = structuredCloneCompat(rule || {});
  cloned.live = {
    rank: liveRank,
    accuracy: liveAccuracy,
    type: liveType,
    category: liveCategory,
    moveIdx: Number.isInteger(move?._move_idx) ? move._move_idx : null,
  };
  if (liveType && !safeStr(cloned.type)) cloned.type = liveType;
  if (liveCategory && !safeStr(cloned.category)) cloned.category = liveCategory;
  cloned.validation = validatePowerRule(cloned);
  return cloned;
}

function structuredCloneCompat(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value || null));
}

export function fallbackPowerRuleFromMove(move) {
  const name = safeStr(move?.name || move?.Nome || move?.nome || "Golpe");
  const category = safeStr(move?.meta?.category || move?.category || "");
  const type = safeStr(move?.meta?.type || move?.type || "");
  const rank = safeInt(move?.rank ?? move?.damage ?? move?.power ?? move?.lvl, 0);
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
