/**
 * arena-combat.js — Combat overlay system on the Arena
 *
 * Click enemy token on map → attack overlay at cursor → radial menu /
 * compact move list → auto-roll → floating feedback on map → pending
 * prompt for defender → reroll toast → stage chips.
 *
 * Agora com cálculos completos unificados com o combat.js:
 * STAB, Fraqueza/Vantagem de Tipo, Bônus de Acerto e Efeito Secundário.
 */

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit as fbLimit,
  onSnapshot,
  arrayUnion,
  serverTimestamp,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

import { TYPE_COLORS, getMoveType, getTypeDamageBonus, normalizeType } from "./type-data.js";
import { getPowerRuleForMove, isSelfPowerRule, hasResolvableImmediateEffects } from "./mm-power-catalog.js?v=20260505rollfx1";
import {
  buildResistanceQueue,
  resolveMmImmediatePower,
  resolveMmPowerResistance,
} from "./mm-combat-resolver.js?v=20260504mm10";
import {
  collectPendingReactions,
  resolveCombatEvent,
} from "./mm-rules-engine.js?v=20260504mm10";
import {
  getAttackModifierSummary,
  resolveAttackStatValue,
  resolveAttackHitAndCritical,
} from "./mm-attack-modifiers.js?v=20260504mm11";

// ─── helpers ──────────────────────────────────────────────────────
function safeStr(x) { return (x == null ? "" : String(x)).trim(); }
function safeInt(x, fb = 0) { const n = parseInt(x, 10); return Number.isFinite(n) ? n : fb; }
function firestoreSafeValue(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => firestoreSafeValue(item));
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) out[key] = firestoreSafeValue(child);
  }
  return out;
}
function getBaseMoveDataLegacy(mv) {
  return {
    // Garante que pega o Rank base do golpe
    rank: safeInt(mv?.rank ?? mv?.damage ?? mv?.power ?? mv?.lvl ?? 0),
    // Pega o modificador de acerto específico DO GOLPE
    acc: safeInt(mv?.accuracy ?? mv?.acc ?? mv?.acerto ?? mv?.modificador ?? 0),
    // Pega possíveis bônus extras de dano salvos direto no golpe
    modDano: safeInt(mv?.damage_mod ?? mv?.mod_dano ?? mv?.mod ?? 0)
  };
}
function resolveMoveIndex(moves, move, preferredIdx = null) {
  if (Number.isInteger(preferredIdx) && preferredIdx >= 0 && preferredIdx < (moves?.length || 0)) {
    return preferredIdx;
  }
  if (!Array.isArray(moves) || !move) return -1;
  const refIdx = moves.indexOf(move);
  if (refIdx >= 0) return refIdx;

  const moveName = safeStr(move?.name);
  if (!moveName) return -1;

  const moveDesc = safeStr(move?.description ?? move?.desc ?? move?.build);
  const exactIdx = moves.findIndex((candidate) => (
    safeStr(candidate?.name) === moveName &&
    safeStr(candidate?.description ?? candidate?.desc ?? candidate?.build) === moveDesc
  ));
  if (exactIdx >= 0) return exactIdx;

  return moves.findIndex((candidate) => safeStr(candidate?.name) === moveName);
}

function getMoveTempMods(pid, moveIdx, sheet = null) {
  try {
    if (typeof window.getSheetMoveTempModifiers === "function") {
      const mods = window.getSheetMoveTempModifiers(pid, moveIdx, sheet) || {};
      return {
        acc: safeInt(mods.acc, 0),
        dmg: safeInt(mods.dmg, 0),
      };
    }
  } catch {}
  return { acc: 0, dmg: 0 };
}

function getMoveData(mv, extraMods = null) {
  const tempAcc = safeInt(extraMods?.acc, 0);
  const tempDmg = safeInt(extraMods?.dmg, 0);
  const baseAcc = safeInt(mv?.accuracy ?? mv?.acc ?? mv?.acerto ?? mv?.modificador ?? 0);
  const baseModDano = safeInt(mv?.damage_mod ?? mv?.mod_dano ?? mv?.mod ?? 0);
  return {
    rank: safeInt(mv?.rank ?? mv?.damage ?? mv?.power ?? mv?.lvl ?? 0),
    acc: baseAcc + tempAcc,
    baseAcc,
    tempAcc,
    modDano: baseModDano + tempDmg,
    baseModDano,
    tempDmg,
  };
}

function safeDocId(name) {
  const s = safeStr(name) || "user";
  return s.replace(/[^a-zA-Z0-9_\-\.]/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "user";
}
function d20Roll() { return Math.floor(Math.random() * 20) + 1; }
function escHtml(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function uid() { return `ac_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`; }
function mmRuntimeEnv() {
  return {
    rng: Math.random,
    clock: () => new Date().toISOString(),
    idFactory: (prefix = "id") => `${prefix}_${uid()}`,
  };
}
function signedMod(value) { return value >= 0 ? `+${value}` : `${value}`; }
function targetIconHtml(kind) {
  if (kind === "area") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>`;
  }
  if (kind === "melee") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4l6 6-2.8 2.8-2.2-2.2-7.9 7.9H4.5v-2.6l7.9-7.9-2.2-2.2L14 4z"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M22 12h-4M6 12H2M12 2v4M12 18v4"/></svg>`;
}
function moveTargetLabel(kind, fallback = "") {
  if (kind === "area") return "Área";
  if (kind === "melee") return "Corpo a corpo";
  if (kind === "self") return "Usuário";
  if (kind === "ranged") return "Distância";
  return safeStr(fallback) || "Distância";
}
function hexToRgb(hex) {
  const raw = safeStr(hex).replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(raw)) return null;
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16),
  };
}
function moveTypeChipStyle(typeName) {
  const normalized = normalizeType(typeName);
  const color = TYPE_COLORS?.[normalized] || "";
  const rgb = hexToRgb(color);
  if (!rgb) return "";
  const textColor = ["Dark", "Ghost", "Poison"].includes(normalized) ? "#f8fafc" : color;
  return [
    `--move-type-color:${color}`,
    `--move-type-rgb:${rgb.r},${rgb.g},${rgb.b}`,
    `color:${textColor}`,
    `border-color:rgba(${rgb.r},${rgb.g},${rgb.b},.58)`,
    `background:linear-gradient(180deg, rgba(${rgb.r},${rgb.g},${rgb.b},.34), rgba(${rgb.r},${rgb.g},${rgb.b},.16))`,
    `box-shadow:inset 0 1px 0 rgba(255,255,255,.10), 0 0 12px rgba(${rgb.r},${rgb.g},${rgb.b},.18)`,
  ].join(";");
}
function movePokeApiSlug(move) {
  return safeStr(
    move?.pokeapi_name
    ?? move?.pokeapiName
    ?? move?.api_name
    ?? move?.apiName
    ?? move?.slug
    ?? move?.meta?.pokeapi_name
    ?? move?.meta?.pokeapiName
    ?? move?.meta?.api_name
    ?? move?.meta?.apiName
    ?? move?.name
  )
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function cleanMoveDescriptionText(text) {
  return safeStr(text)
    .replace(/\f/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\$effect_chance/g, "")
    .trim();
}
function getSavedMoveDescription(move) {
  const meta = (move?.meta && typeof move.meta === "object") ? move.meta : {};
  return cleanMoveDescriptionText(
    move?.description
    ?? move?.descricao
    ?? move?.descrição
    ?? move?.desc
    ?? move?.effect
    ?? move?.efeito
    ?? move?.notes
    ?? meta.description
    ?? meta.descricao
    ?? meta.descrição
    ?? meta.desc
    ?? meta.effect
    ?? meta.efeito
    ?? meta.notes
    ?? ""
  );
}
const MOVE_DESCRIPTION_EXACT_PT = new Map([
  ["the user restores its own hp. the amount of hp regained varies with the weather.", "O usuário recupera seu próprio HP. A quantidade recuperada varia conforme o clima."],
  ["the user coils up and concentrates. this raises its attack and defense stats as well as its accuracy.", "O usuário se enrola e se concentra. Isso aumenta seu Ataque, Defesa e Acerto."],
  ["a nutrient-draining attack. the user's hp is restored by half the damage taken by the target.", "Um ataque que drena nutrientes. O HP do usuário é restaurado em metade do dano causado ao alvo."],
  ["a nutrient-draining attack. the user's hp is restored by up to half the damage taken by the target.", "Um ataque que drena nutrientes. O HP do usuário é restaurado em até metade do dano causado ao alvo."],
  ["the target is slashed with scythes or claws. this attack becomes more powerful if it hits in succession.", "O alvo é cortado com lâminas ou garras. O golpe fica mais forte se acertar em sequência."],
  ["the user attacks by slashing the target with scythes, claws, or the like. this attack becomes more powerful if it hits in succession.", "O usuário ataca cortando o alvo com lâminas, garras ou algo parecido. O golpe fica mais forte se acertar em sequência."],
  ["the user scatters bursts of spores that induce sleep.", "O usuário espalha esporos que induzem sono."],
  ["the user slaps down the target's held item, making it unusable for that battle. this move does more damage if the target has a held item.", "O usuário derruba o item segurado do alvo, tornando-o inutilizável nessa batalha. O golpe causa mais dano se o alvo estiver segurando um item."],
  ["the user covers the target in a combustible powder. if the target uses a fire-type move, the powder explodes and damages the target.", "O usuário cobre o alvo com um pó combustível. Se o alvo usar um golpe do tipo Fogo, o pó explode e causa dano ao alvo."],
  ["the user scatters a cloud of irritating powder to draw attention to itself. opposing pokémon aim only at the user.", "O usuário espalha uma nuvem de pó irritante para chamar atenção para si. Pokémon oponentes miram apenas no usuário."],
  ["the user slashes at the target by crossing its scythes or claws as if they were a pair of scissors.", "O usuário corta o alvo cruzando lâminas ou garras como uma tesoura."],
]);
const MOVE_DESCRIPTION_SLUG_PT = new Map([
  ["synthesis", "O usuário recupera seu próprio HP. A quantidade recuperada varia conforme o clima."],
  ["coil", "O usuário se enrola e se concentra. Isso aumenta seu Ataque, Defesa e Acerto."],
  ["giga-drain", "Um ataque que drena nutrientes. O HP do usuário é restaurado em até metade do dano causado ao alvo."],
  ["fury-cutter", "O usuário ataca cortando o alvo com lâminas, garras ou algo parecido. O golpe fica mais forte se acertar em sequência."],
  ["spore", "O usuário espalha esporos que induzem sono."],
  ["x-scissor", "O usuário corta o alvo cruzando lâminas ou garras como uma tesoura."],
  ["knock-off", "O usuário derruba o item segurado do alvo, tornando-o inutilizável nessa batalha. O golpe causa mais dano se o alvo estiver segurando um item."],
  ["powder", "O usuário cobre o alvo com um pó combustível. Se o alvo usar um golpe do tipo Fogo, o pó explode e causa dano ao alvo."],
  ["rage-powder", "O usuário espalha uma nuvem de pó irritante para chamar atenção para si. Pokémon oponentes miram apenas no usuário."],
]);
function translatePokeApiMoveDescriptionToPt(text) {
  const cleaned = cleanMoveDescriptionText(text);
  if (!cleaned) return "";
  const exact = MOVE_DESCRIPTION_EXACT_PT.get(cleaned.toLowerCase());
  if (exact) return exact;
  return cleaned
    .replace(/\bThe user\b/g, "O usuário")
    .replace(/\bthe user\b/g, "o usuário")
    .replace(/\bThe target\b/g, "O alvo")
    .replace(/\bthe target\b/g, "o alvo")
    .replace(/\btarget\b/g, "alvo")
    .replace(/\bopposing Pokémon\b/g, "Pokémon oponente")
    .replace(/\bopponent\b/g, "oponente")
    .replace(/\bits own HP\b/g, "seu próprio HP")
    .replace(/\bthe user's HP\b/g, "o HP do usuário")
    .replace(/\buser's HP\b/g, "HP do usuário")
    .replace(/\brestores\b/g, "recupera")
    .replace(/\bis restored\b/g, "é restaurado")
    .replace(/\bregained\b/g, "recuperada")
    .replace(/\bvaries with the weather\b/g, "varia conforme o clima")
    .replace(/\bweather\b/g, "clima")
    .replace(/\bdamage\b/g, "dano")
    .replace(/\bdamaged\b/g, "danificado")
    .replace(/\bmay\b/g, "pode")
    .replace(/\bhas a chance to\b/g, "tem chance de")
    .replace(/\bcauses\b/g, "causa")
    .replace(/\bcause\b/g, "causar")
    .replace(/\bdoes more dano\b/g, "causa mais dano")
    .replace(/\battack\b/g, "ataque")
    .replace(/\battacks\b/g, "ataca")
    .replace(/\bAttack\b/g, "Ataque")
    .replace(/\bDefense\b/g, "Defesa")
    .replace(/\baccuracy\b/g, "Acerto")
    .replace(/\bspeed\b/g, "Velocidade")
    .replace(/\braises\b/g, "aumenta")
    .replace(/\blowers\b/g, "reduz")
    .replace(/\bsharply\b/g, "bastante")
    .replace(/\bstats\b/g, "atributos")
    .replace(/\bstat\b/g, "atributo")
    .replace(/\bas well as\b/g, "assim como")
    .replace(/\bpoison\b/g, "envenenar")
    .replace(/\bburn\b/g, "queimar")
    .replace(/\bparalyze\b/g, "paralisar")
    .replace(/\bsleep\b/g, "sono")
    .replace(/\bflinch\b/g, "recuar")
    .replace(/\bhalf\b/g, "metade")
    .replace(/\bamount\b/g, "quantidade")
    .replace(/\btaken by\b/g, "causado a")
    .replace(/\bby up to\b/g, "em até")
    .replace(/\bheld item\b/g, "item segurado")
    .replace(/\bmaking it unusable for that battle\b/g, "tornando-o inutilizável nessa batalha")
    .replace(/\bslaps down\b/g, "derruba")
    .replace(/\bcovers\b/g, "cobre")
    .replace(/\bcombustible powder\b/g, "pó combustível")
    .replace(/\bFire-type move\b/g, "golpe do tipo Fogo")
    .replace(/\bexplodes\b/g, "explode")
    .replace(/\bdamages\b/g, "causa dano a")
    .replace(/\bslashing\b/g, "cortando")
    .replace(/\bscythes\b/g, "lâminas")
    .replace(/\bclaws\b/g, "garras")
    .replace(/\bor the like\b/g, "ou algo parecido")
    .replace(/\s+/g, " ")
    .trim();
}
function getKnownPokeApiMoveDescriptionPt(move) {
  const slug = movePokeApiSlug(move);
  return slug ? (MOVE_DESCRIPTION_SLUG_PT.get(slug) || "") : "";
}
const MOVE_DESCRIPTION_CACHE = new Map();
async function fetchPokeApiMoveDescriptionPt(move) {
  const slug = movePokeApiSlug(move);
  if (!slug) return "";
  const known = getKnownPokeApiMoveDescriptionPt(move);
  if (known) return known;
  if (MOVE_DESCRIPTION_CACHE.has(slug)) return MOVE_DESCRIPTION_CACHE.get(slug);
  const promise = (async () => {
    try {
      const res = await fetch(`https://pokeapi.co/api/v2/move/${encodeURIComponent(slug)}`);
      if (!res.ok) return "";
      const data = await res.json();
      const flavorEntries = Array.isArray(data?.flavor_text_entries) ? data.flavor_text_entries : [];
      const preferFlavor = (langs) => {
        for (let i = flavorEntries.length - 1; i >= 0; i -= 1) {
          const entry = flavorEntries[i];
          if (langs.includes(safeStr(entry?.language?.name).toLowerCase())) {
            return cleanMoveDescriptionText(entry?.flavor_text);
          }
        }
        return "";
      };
      const ptText = preferFlavor(["pt-br", "pt"]);
      if (ptText) return ptText;
      const enText = preferFlavor(["en"]);
      if (enText) return translatePokeApiMoveDescriptionToPt(enText);
      const effectEntries = Array.isArray(data?.effect_entries) ? data.effect_entries : [];
      const effect = effectEntries.find((entry) => safeStr(entry?.language?.name).toLowerCase() === "en");
      return translatePokeApiMoveDescriptionToPt(effect?.short_effect || effect?.effect || "");
    } catch {
      return "";
    }
  })();
  MOVE_DESCRIPTION_CACHE.set(slug, promise);
  return promise;
}
function moveDescriptionHtml(move) {
  const saved = getSavedMoveDescription(move);
  if (saved) return `<div class="ac-move-desc">${escHtml(saved)}</div>`;
  const known = getKnownPokeApiMoveDescriptionPt(move);
  if (known) return `<div class="ac-move-desc">${escHtml(known)}</div>`;
  const slug = movePokeApiSlug(move);
  if (!slug) return "";
  return `<div class="ac-move-desc ac-move-desc-loading" data-pokeapi-move-desc="${escHtml(slug)}">Carregando descrição...</div>`;
}
function describeExtraAttackMods(accMod = 0, dmgMod = 0) {
  const parts = [];
  if (accMod !== 0) parts.push(`Acerto ${signedMod(accMod)}`);
  if (dmgMod !== 0) parts.push(`Dano ${signedMod(dmgMod)}`);
  return parts.join(" • ");
}
function buildManualSecondaryPowerRule(rank, isEffect) {
  const resolvedRank = Math.max(0, safeInt(rank, 0));
  const type = isEffect ? "affliction" : "damage";
  const label = isEffect ? "Secondary Affliction" : "Secondary Damage";
  const effect = {
    id: "secondary_effect",
    type,
    label,
    raw: label,
    rank: { source: "fixed", value: resolvedRank },
    range: "close",
    action: "standard",
    duration: "instant",
    resistance: isEffect ? "fort" : "thg",
    target: "target",
    descriptors: ["secondary"],
    extras: [],
    flaws: [],
    linked: false,
    area: null,
  };
  if (isEffect) {
    effect.conditions = [
      { degree: 1, condition: "dazed" },
      { degree: 2, condition: "stunned" },
      { degree: 3, condition: "incapacitated" },
    ];
  }
  return {
    schema: "PowerRule",
    schemaVersion: 2,
    id: `manual:secondary:${type}`,
    name: label,
    mode: "target",
    range: "close",
    extras: [],
    flaws: [],
    flags: { manual: true, secondary: true },
    effects: [effect],
    linkedEffects: [],
    live: { rank: resolvedRank },
  };
}
function canOfferSecondaryEffect(battle, by) {
  const logs = Array.isArray(battle?.logs) ? battle.logs : [];
  return !!battle
    && safeStr(battle.status) === "idle"
    && safeStr(battle.attacker) === safeStr(by)
    && !!safeStr(battle.target_id)
    && logs.length > 0
    && battle.secondary_available === true
    && battle.secondary_active !== true;
}
function isAreaBattleState(battle) {
  const range = safeStr(battle?.attack_range).toLowerCase();
  return !!(battle?.aoe_source || safeInt(battle?.aoe_dc, 0) || range.includes("area"));
}
function shouldOfferSecondaryAfterResistance(battle) {
  if (!battle || battle.secondary_active === true) return false;
  if (battle.secondary_available === false) return false;
  if (isAreaBattleState(battle)) return false;
  return true;
}
function buildAttackRollText(baseAtkMod, extraAccMod, aceiroBonus, ruleAttackMod = 0) {
  const parts = [`${safeInt(baseAtkMod, 0)}`];
  if (safeInt(extraAccMod, 0) !== 0) parts.push(signedMod(safeInt(extraAccMod, 0)));
  if (safeInt(ruleAttackMod, 0) !== 0) parts.push(signedMod(safeInt(ruleAttackMod, 0)));
  if (safeInt(aceiroBonus, 0) !== 0) parts.push(signedMod(safeInt(aceiroBonus, 0)));
  return parts.join("");
}

function normalizeStatKey(key) {
  const k = safeStr(key).toLowerCase();
  if (k === "fortitude") return "fort";
  if (k === "toughness") return "thg";
  if (k === "intel" || k === "intelligence") return "int";
  if (k === "crit" || k === "critico" || k === "crítico") return "critical";
  return k;
}

function normalizeStats(stats) {
  const raw = stats || {};
  const norm = {
    stgr: safeInt(raw.stgr),
    int:  safeInt(raw.int ?? raw.intel ?? raw.intelligence),
    dodge: safeInt(raw.dodge),
    parry: safeInt(raw.parry),
    fort:  safeInt(raw.fort ?? raw.fortitude),
    will:  safeInt(raw.will),
    thg:   safeInt(raw.thg ?? raw.toughness),
    cap:   safeInt(raw.cap ?? raw.capability),
  };
  if (norm.thg <= 0 && norm.cap > 0) norm.thg = Math.round(norm.cap / 2);
  if (norm.dodge <= 0 && norm.cap > 0 && norm.thg > 0) norm.dodge = Math.max(0, norm.cap - norm.thg);
  norm.fortitude = norm.fort;
  norm.toughness = norm.thg;
  return { ...raw, ...norm };
}

function hasMeaningfulBaseStats(stats) {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return false;
  const keys = ["stgr", "strg", "int", "intel", "intelligence", "dodge", "parry", "fort", "fortitude", "will", "thg", "toughness", "cap", "capability"];
  return keys.some((key) => {
    const raw = stats[key];
    if (raw == null || raw === "") return false;
    const n = Number(raw);
    return Number.isFinite(n) && n !== 0;
  });
}

function shouldUsePartyBaseStats(partyStats, sheetStats, hasSheetFallback = false) {
  const hasPartyStats = !!(partyStats && typeof partyStats === "object" && !Array.isArray(partyStats) && Object.keys(partyStats).length > 0);
  if (!hasPartyStats) return false;
  if (hasMeaningfulBaseStats(partyStats)) return true;
  return !hasSheetFallback && !(sheetStats && typeof sheetStats === "object" && !Array.isArray(sheetStats) && Object.keys(sheetStats).length > 0);
}

function isTrainerPiece(pieceOrPid) {
  const pid = typeof pieceOrPid === "object" ? safeStr(pieceOrPid?.pid) : safeStr(pieceOrPid);
  const kind = typeof pieceOrPid === "object" ? safeStr(pieceOrPid?.kind).toLowerCase() : "";
  return kind === "trainer" || /^trainer_/i.test(pid);
}

function trainerCacheKey(trainerName) {
  return safeStr(trainerName).toLowerCase();
}

function pickTrainerRpgStat(src, ...keys) {
  const data = (src && typeof src === "object" && !Array.isArray(src)) ? src : {};
  const entries = Object.entries(data);
  for (const key of keys) {
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(data, key)) return data[key];
    const wanted = safeStr(key).toLowerCase();
    const found = entries.find(([entryKey]) => safeStr(entryKey).toLowerCase() === wanted);
    if (found) return found[1];
  }
  return undefined;
}

function normalizeTrainerRpgStats(stats) {
  return normalizeStats({
    stgr: safeInt(pickTrainerRpgStat(stats, "stgr", "Stgr", "STGR", "strg", "Strg"), 0),
    int: safeInt(pickTrainerRpgStat(stats, "int", "Int", "INT", "intel", "Intel", "intelligence", "Intelligence"), 0),
    dodge: safeInt(pickTrainerRpgStat(stats, "dodge", "Dodge", "DODGE"), 0),
    parry: safeInt(pickTrainerRpgStat(stats, "parry", "Parry", "PARRY"), 0),
    fort: safeInt(pickTrainerRpgStat(stats, "fortitude", "Fortitude", "FORTITUDE", "fort", "Fort", "FORT"), 0),
    will: safeInt(pickTrainerRpgStat(stats, "will", "Will", "WILL"), 0),
    thg: safeInt(pickTrainerRpgStat(stats, "thg", "Thg", "THG", "toughness", "Toughness"), 0),
  });
}

function normalizeTrainerRpgSheetData(sheet, trainerName = "") {
  if (!sheet || typeof sheet !== "object" || Array.isArray(sheet)) return null;
  const statsSource = (sheet.stats && typeof sheet.stats === "object" && !Array.isArray(sheet.stats))
    ? sheet.stats
    : sheet;
  return {
    trainer_name: safeStr(sheet.trainer_name || sheet.trainerName || trainerName),
    stats: normalizeTrainerRpgStats(statsSource),
    updated_at: sheet.updated_at || null,
  };
}

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function safePidValue(x) {
  let v = safeStr(x);
  if (!v) return "";
  if (v.startsWith("EXT:")) return v;
  if (v.startsWith("PID:")) v = v.slice(4);
  if (/^\d+$/.test(v)) return (v.replace(/^0+/, "") || "0");
  return v;
}

function pidKey(x) {
  const v = safePidValue(x);
  if (!v) return "";
  if (/^EXT:/i.test(v)) return `ext:${v.slice(4).trim().toLowerCase()}`;
  return v;
}

function sheetKind(sheet) {
  const explicit = safeStr(sheet?.sheet_kind).toLowerCase();
  if (explicit) return explicit;
  return safeStr(sheet?.mega_slug) ? "mega" : "base";
}

function sheetIsMega(sheet) {
  return sheetKind(sheet) === "mega";
}

function sheetDocId(sheet) {
  return safeStr(sheet?._sheet_id || sheet?.sheet_id || sheet?.id);
}

function pushLookupKey(out, value) {
  const raw = safePidValue(value);
  if (!raw) return;
  const push = (entry) => {
    if (entry && !out.includes(entry)) out.push(entry);
  };
  push(pidKey(raw));
  if (/^\d+$/.test(raw)) push(String(Number(raw)));
  push(safeStr(raw).toLowerCase());
}

function partyLookupKeys(value) {
  const out = [];
  if (value && typeof value === "object") {
    pushLookupKey(out, value?.entry_id);
    pushLookupKey(out, value?.entryId);
    pushLookupKey(out, value?.hub_entry_id);
    pushLookupKey(out, value?.hubEntryId);
    pushLookupKey(out, value?.party_slot);
    pushLookupKey(out, value?.partySlot);
    pushLookupKey(out, value?._party_slot);
    pushLookupKey(out, value?.sheet_id);
    pushLookupKey(out, value?._sheet_id);
    pushLookupKey(out, value?.pid);
    pushLookupKey(out, value?.pokemon?.id);
    pushLookupKey(out, value?.pokemon?.name);
    pushLookupKey(out, value?.name);
    return out;
  }
  pushLookupKey(out, value);
  return out;
}

function sheetIdFromEntryId(value) {
  const raw = safeStr(value);
  const match = raw.match(/^sheet:(.+)$/i);
  return match ? safeStr(match[1]) : "";
}

function getTrainerBucket(source, trainerName) {
  const data = (source && typeof source === "object") ? source : {};
  if (data?.[trainerName] && typeof data[trainerName] === "object") return data[trainerName];
  const target = safeStr(trainerName).toLowerCase();
  for (const [rawKey, value] of Object.entries(data)) {
    if (safeStr(rawKey).toLowerCase() !== target) continue;
    if (value && typeof value === "object") return value;
  }
  return {};
}

function getPartyStateEntry(partyStates, trainerName, pidLike) {
  const targetKeys = partyLookupKeys(pidLike);
  if (!targetKeys.length) return null;
  const bucket = getTrainerBucket(partyStates, trainerName);
  const payloadMatches = [];
  for (const [rawKey, entry] of Object.entries(bucket || {})) {
    if (targetKeys.includes(pidKey(rawKey))) return entry || {};
    const entryKeys = partyLookupKeys(entry);
    if (entryKeys.some((key) => targetKeys.includes(key))) payloadMatches.push(entry || {});
  }
  if (payloadMatches.length === 1) return payloadMatches[0];
  return null;
}

function getSnapshotEntry(trainerName, pidLike) {
  const players = Array.isArray(window.appState?.players) ? window.appState.players : [];
  const targetTrainer = safeStr(trainerName).toLowerCase();
  const targetKeys = partyLookupKeys(pidLike);
  if (!targetTrainer || !targetKeys.length) return null;
  for (const player of players) {
    if (safeStr(player?.trainer_name).toLowerCase() !== targetTrainer) continue;
    const snapshot = Array.isArray(player?.party_snapshot) ? player.party_snapshot : [];
    for (const entry of snapshot) {
      const entryKeys = partyLookupKeys(entry);
      if (entryKeys.some((key) => targetKeys.includes(key))) return entry;
    }
  }
  return null;
}

function sheetLookupValuesForTrainer(partyStates, trainerName, pidLike) {
  const out = [];
  const push = (value) => {
    if (value == null || value === "") return;
    if (!out.includes(value)) out.push(value);
    const sheetId = sheetIdFromEntryId(value);
    if (sheetId && !out.includes(sheetId)) out.push(sheetId);
  };
  const pushIdentity = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      push(value);
      return;
    }
    push(value);
    push(value?.entry_id);
    push(value?.entryId);
    push(value?.hub_entry_id);
    push(value?.hubEntryId);
    push(value?.party_slot);
    push(value?.partySlot);
    push(value?._party_slot);
    push(value?.sheet_id);
    push(value?._sheet_id);
    push(value?.pid);
    push(value?.pokemon?.id);
    push(value?.pokemon?.name);
    push(value?.name);
  };
  pushIdentity(pidLike);
  pushIdentity(getPartyStateEntry(partyStates, trainerName, pidLike));
  pushIdentity(getSnapshotEntry(trainerName, pidLike));
  return out;
}

function resolveTrainerPokemonTypes(trainerName, pidLike, options = {}) {
  if (typeof window.getResolvedTypesForTrainerPid === "function") {
    const resolved = window.getResolvedTypesForTrainerPid(trainerName, pidLike, options);
    if (Array.isArray(resolved) && resolved.length) return resolved;
  }
  return Array.isArray(options?.sheet?.pokemon?.types) ? options.sheet.pokemon.types : [];
}

function getBattleMegaState(partyStates, trainerName, pidLike) {
  const state = getPartyStateEntry(partyStates, trainerName, pidLike) || {};
  const snapshot = getSnapshotEntry(trainerName, pidLike) || {};
  const hasExplicitMega = hasOwn(state, "active_mega_slug");
  const activeMegaSlug = hasExplicitMega ? safeStr(state?.active_mega_slug) : safeStr(snapshot?.active_mega_slug);
  const explicitCancel = hasExplicitMega && !activeMegaSlug;
  const pick = (key) => {
    if (hasOwn(state, key)) return state?.[key];
    if (explicitCancel) return null;
    return snapshot?.[key] ?? null;
  };
  return {
    activeMegaSlug: safeStr(activeMegaSlug),
    effectiveSheetId: explicitCancel ? "" : safeStr(pick("effective_sheet_id")),
  };
}

function buildSheetCollections(sheets) {
  const baseByKey = new Map();
  const byId = new Map();
  const megaByBaseSheetId = new Map();
  const megaByBaseKey = new Map();
  const pushBase = (rawKey, sheet) => {
    for (const key of partyLookupKeys(rawKey)) {
      if (key && !baseByKey.has(key)) baseByKey.set(key, sheet);
    }
  };
  const pushMega = (rawKey, sheet) => {
    for (const key of partyLookupKeys(rawKey)) {
      if (!key) continue;
      if (!megaByBaseKey.has(key)) megaByBaseKey.set(key, []);
      megaByBaseKey.get(key).push(sheet);
    }
  };
  for (const sheet of (Array.isArray(sheets) ? sheets : [])) {
    const docId = sheetDocId(sheet);
    if (docId && !byId.has(docId)) byId.set(docId, sheet);
    if (sheetIsMega(sheet)) {
      const baseSheetId = safeStr(sheet?.base_sheet_id);
      if (baseSheetId) {
        if (!megaByBaseSheetId.has(baseSheetId)) megaByBaseSheetId.set(baseSheetId, []);
        megaByBaseSheetId.get(baseSheetId).push(sheet);
      }
      pushMega(sheet?.base_pokemon_id, sheet);
      pushMega(sheet?.base_pokemon_name, sheet);
      pushMega(sheet?.linked_pid, sheet);
      continue;
    }
    pushBase(docId, sheet);
    if (docId) pushBase(`sheet:${docId}`, sheet);
    pushBase(sheet?.pokemon?.id, sheet);
    pushBase(sheet?.linked_pid, sheet);
    pushBase(sheet?.pokemon?.name, sheet);
  }
  return { baseByKey, byId, megaByBaseSheetId, megaByBaseKey };
}

function getBaseSheetFromCollections(collections, pidLike) {
  const values = Array.isArray(pidLike) ? pidLike : [pidLike];
  for (const value of values) {
    const keys = partyLookupKeys(value);
    for (const key of keys) {
      if (collections?.baseByKey?.has?.(key)) return collections.baseByKey.get(key);
    }
  }
  return null;
}

function getMegaSheetsForBase(collections, baseSheet, pidLike) {
  const out = [];
  const seen = new Set();
  const add = (sheet) => {
    const key = sheetDocId(sheet) || safeStr(sheet?.mega_slug || sheet?.pokemon?.name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(sheet);
  };
  const baseSheetId = sheetDocId(baseSheet);
  if (baseSheetId) {
    for (const sheet of (collections?.megaByBaseSheetId?.get?.(baseSheetId) || [])) add(sheet);
  }
  for (const rawKey of [pidLike, baseSheet?.pokemon?.id, baseSheet?.pokemon?.name, baseSheet?.linked_pid]) {
    for (const key of partyLookupKeys(rawKey)) {
      for (const sheet of (collections?.megaByBaseKey?.get?.(key) || [])) add(sheet);
    }
  }
  return out;
}

function moveBasedStat(meta) {
  meta = meta || {};
  const cat = safeStr(meta.category).toLowerCase();
  if (meta.is_special === true) return "Int";
  if (meta.is_special === false) return "Stgr";
  if (cat.includes("status")) return "—";
  if (cat.includes("especial") || cat.includes("special")) return "Int";
  if (cat.includes("físico") || cat.includes("fisico") || cat.includes("physical")) return "Stgr";
  return "Stgr";
}

function moveStatValue(meta, stats) {
  const based = moveBasedStat(meta);
  stats = stats || {};
  if (based === "Int") return [based, safeInt(stats["int"])];
  if (based === "Stgr") return [based, safeInt(stats.stgr)];
  return [based, 0];
}

function spriteUrl(pid, opts) {
  try {
    if (typeof window.getSpriteUrlFromPid === "function") {
      return safeStr(window.getSpriteUrlFromPid(pid, opts));
    }
  } catch {}
  const k = safeStr(pid);
  if (!k) return "";
  const type = opts?.type || "art";
  const shiny = !!opts?.shiny;
  if (typeof window.localSpriteUrl === "function" && typeof window.spriteSlugFromPokemonName === "function") {
    const slug = window.spriteSlugFromPokemonName(k);
    if (slug) return window.localSpriteUrl(slug, type, shiny) || "";
  }
  if (/^\d+$/.test(k)) return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${Number(k)}.png`;
  return "";
}

function displayName(pid) {
  const k = safeStr(pid);
  if (!k) return "???";
  if (k.startsWith("EXT:")) return k.slice(4).trim() || "???";
  try {
    if (window.dexMap) {
      const name = window.dexMap[k] || window.dexMap[String(Number(k))];
      if (safeStr(name)) return safeStr(name);
    }
  } catch {}
  return "???";
}

const SIZE_LABELS = Object.freeze({
  tiny: "Miúdo",
  small: "Pequeno",
  medium: "Médio",
  large: "Grande",
  huge: "Enorme",
  gargantuan: "Colossal",
});

function titleWords(raw) {
  return safeStr(raw)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function getEffectivePresentation(ownerName, pidLike, options = {}) {
  try {
    if (typeof window.getEffectivePokemonPresentationForTrainerPid === "function") {
      const out = window.getEffectivePokemonPresentationForTrainerPid(ownerName, pidLike, options);
      if (out && typeof out === "object") return out;
    }
  } catch {}
  return null;
}

function effectiveSpriteUrl(ownerName, pidLike, opts = {}) {
  try {
    if (typeof window.getEffectiveSpriteUrlForTrainerPid === "function") {
      const out = safeStr(window.getEffectiveSpriteUrlForTrainerPid(ownerName, pidLike, opts));
      if (out) return out;
    }
  } catch {}
  return spriteUrl(pidLike?.pid ?? pidLike, opts);
}

function pieceSizeLabel(piece) {
  let sizeCategory = safeStr(piece?.sizeCategory).toLowerCase();
  if (!sizeCategory) {
    try {
      if (typeof window.getPieceSizeCategory === "function") {
        sizeCategory = safeStr(window.getPieceSizeCategory(piece)).toLowerCase();
      }
    } catch {}
  }
  return SIZE_LABELS[sizeCategory] || titleWords(sizeCategory);
}

function formLabelFromPresentation(presentation, fallbackName = "") {
  const formSlug = safeStr(presentation?.form_slug).toLowerCase();
  const display = safeStr(presentation?.display_name);
  const baseName = safeStr(fallbackName);
  if (!formSlug) {
    return display && baseName && display.toLowerCase() !== baseName.toLowerCase() ? display : "";
  }
  if (!formSlug.includes("-")) return "";
  let baseSlug = "";
  try {
    if (typeof window.spriteSlugFromPokemonName === "function") {
      baseSlug = safeStr(window.spriteSlugFromPokemonName(baseName)).toLowerCase();
    }
  } catch {}
  if (baseSlug && formSlug.startsWith(`${baseSlug}-`)) {
    return titleWords(formSlug.slice(baseSlug.length + 1));
  }
  return titleWords(formSlug);
}

function pieceBattleIdentity(piece, sheet = null) {
  const owner = safeStr(piece?.owner);
  const baseName = safeStr(sheet?.pokemon?.name) || displayName(piece?.pid);
  const presentation = owner ? getEffectivePresentation(owner, piece, { piece, sheet }) : null;
  const name = safeStr(presentation?.display_name) || baseName;
  const formLabel = formLabelFromPresentation(presentation, baseName);
  const sizeLabel = pieceSizeLabel(piece);
  return {
    owner,
    presentation,
    name,
    formLabel,
    sizeLabel,
  };
}

function pieceBattleLabel(piece, sheet = null) {
  const info = pieceBattleIdentity(piece, sheet);
  const form = safeStr(info.formLabel);
  const name = safeStr(info.name) || displayName(piece?.pid);
  if (!form) return name;
  return name.toLowerCase().includes(form.toLowerCase()) ? name : `${name} (${form})`;
}

function pieceBattleMetaLine(piece, sheet = null, { includeOwner = true } = {}) {
  const info = pieceBattleIdentity(piece, sheet);
  const parts = [];
  if (includeOwner && info.owner) parts.push(info.owner);
  if (info.sizeLabel) parts.push(`Tamanho ${info.sizeLabel}`);
  if (info.formLabel) parts.push(`Forma ${info.formLabel}`);
  return parts.join(" • ");
}

// ─── CSS injection ────────────────────────────────────────────────
let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const s = document.createElement("style");
  s.id = "arena-combat-css";
  s.textContent = CSS_TEXT;
  document.head.appendChild(s);
}

const CSS_TEXT = `
/* ═══════════════════════════════════════════════════════════
   ARENA COMBAT — Overlay, Radial Menu, Floating Feedback
   ═══════════════════════════════════════════════════════════ */

#arena-combat-overlay {
  position: absolute; inset: 0;
  pointer-events: none;
  z-index: 5000;
  overflow: hidden;
}

/* ── Attack overlay panel ── */
.ac-overlay {
  position: absolute;
  pointer-events: auto;
  z-index: 60;
  min-width: 260px;
  max-width: 340px;
  border-radius: 16px;
  border: 1px solid rgba(56,189,248,.4);
  background: rgba(10,18,32,.92);
  backdrop-filter: blur(12px);
  box-shadow: 0 16px 40px rgba(2,6,23,.5), 0 0 0 1px rgba(56,189,248,.15);
  padding: 14px;
  animation: acFadeIn .2s ease-out;
}
@keyframes acFadeIn {
  from { opacity:0; transform:scale(.92) translateY(6px); }
  to { opacity:1; transform:scale(1) translateY(0); }
}
.ac-overlay-header {
  display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
}
.ac-overlay-sprite {
  width: 48px; height: 48px; border-radius: 12px;
  border: 1px solid rgba(226,232,240,.15);
  background: rgba(255,255,255,.04);
  object-fit: contain; image-rendering: pixelated; padding: 3px;
}
.ac-overlay-name {
  font-weight: 900; font-size: 14px; color: rgba(226,232,240,.95);
}
.ac-overlay-sub {
  font-size: 11px; color: rgba(148,163,184,.7); margin-top: 2px;
}
.ac-overlay-close {
  margin-left: auto; appearance: none; border: none;
  background: rgba(248,113,113,.12); color: rgba(248,113,113,.85);
  border-radius: 8px; width: 28px; height: 28px;
  font-size: 14px; font-weight: 900; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.ac-overlay-close:hover { background: rgba(248,113,113,.25); }

/* ── Quick actions ── */
.ac-quick-actions {
  display: flex; gap: 6px; margin-bottom: 10px;
}
.ac-quick-btn {
  flex: 1; appearance: none; cursor: pointer;
  padding: 8px 6px; border-radius: 10px;
  border: 1px solid rgba(148,163,184,.22);
  background: rgba(2,6,23,.3); color: rgba(226,232,240,.85);
  font-size: 11.5px; font-weight: 800; text-align: center;
  transition: all .15s;
}
.ac-quick-btn:hover {
  background: rgba(56,189,248,.14); border-color: rgba(56,189,248,.4);
  transform: translateY(-1px);
}
.ac-quick-btn.ac-active {
  background: rgba(56,189,248,.2); border-color: rgba(56,189,248,.55);
  color: rgba(56,189,248,1);
}

/* ── Radial menu ── */
.ac-radial {
  position: absolute;
  pointer-events: auto;
  z-index: 65;
  width: 0; height: 0;
  animation: acFadeIn .2s ease-out;
}
.ac-radial-slot {
  position: absolute;
  width: 72px; height: 72px;
  border-radius: 50%;
  border: 1.5px solid rgba(56,189,248,.35);
  background: rgba(10,18,32,.9);
  backdrop-filter: blur(8px);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  cursor: pointer;
  transition: all .15s;
  transform: translate(-50%, -50%);
  pointer-events: auto;
  box-shadow: 0 4px 16px rgba(2,6,23,.4);
}
.ac-radial-slot:hover {
  border-color: rgba(56,189,248,.7);
  background: rgba(56,189,248,.15);
  transform: translate(-50%, -50%) scale(1.1);
  box-shadow: 0 8px 24px rgba(2,6,23,.5);
}
.ac-radial-slot.ac-disabled {
  opacity: .35; cursor: default;
  pointer-events: none;
}
.ac-radial-slot .ac-slot-name {
  font-size: 9px; font-weight: 800; color: rgba(226,232,240,.9);
  text-align: center; line-height: 1.15;
  max-width: 60px; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap;
}
.ac-radial-slot .ac-slot-icon {
  font-size: 16px; margin-bottom: 2px;
}
.ac-radial-slot .ac-slot-sub {
  font-size: 8px; color: rgba(148,163,184,.7); margin-top: 1px;
}
.ac-radial-center {
  position: absolute;
  width: 52px; height: 52px;
  border-radius: 50%;
  border: 2px solid rgba(248,113,113,.4);
  background: rgba(248,113,113,.12);
  display: flex; align-items: center; justify-content: center;
  transform: translate(-50%, -50%);
  pointer-events: auto; cursor: pointer;
}
.ac-radial-center:hover { background: rgba(248,113,113,.25); }
.ac-radial-center img {
  width: 36px; height: 36px; object-fit: contain;
  image-rendering: pixelated; border-radius: 8px;
}

/* ── Compact move list ── */
.ac-movelist {
  max-height: 260px; overflow-y: auto;
  margin-top: 6px;
}
.ac-movelist::-webkit-scrollbar { width: 4px; }
.ac-movelist::-webkit-scrollbar-thumb { background: rgba(148,163,184,.2); border-radius: 4px; }
.ac-search {
  width: 100%; padding: 7px 10px; border-radius: 10px;
  border: 1px solid rgba(148,163,184,.22);
  background: rgba(0,0,0,.25); color: rgba(226,232,240,.9);
  font-size: 12px; outline: none; margin-bottom: 6px;
}
.ac-search:focus { border-color: rgba(56,189,248,.45); }
.ac-move-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 10px;
  border: 1px solid rgba(148,163,184,.12);
  background: rgba(2,6,23,.2);
  margin-bottom: 4px; cursor: pointer;
  transition: all .12s;
}
.ac-move-item:hover {
  background: rgba(56,189,248,.1); border-color: rgba(56,189,248,.3);
  transform: translateX(2px);
}
.ac-move-name { font-weight: 800; font-size: 12px; color: rgba(226,232,240,.9); flex: 1; }
.ac-move-meta { font-size: 10px; color: rgba(148,163,184,.7); }
.ac-move-dmg {
  font-size: 11px; font-weight: 800; color: rgba(56,189,248,.85);
  padding: 2px 6px; border-radius: 6px;
  background: rgba(56,189,248,.1); border: 1px solid rgba(56,189,248,.2);
}
.ac-move-item.ac-attacker-move {
  align-items: flex-start;
  gap: 10px;
}
.ac-move-main {
  min-width: 0;
  flex: 1;
}
.ac-move-topline {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ac-move-desc {
  margin-top: 4px;
  color: rgba(203,213,225,.82);
  font-size: 10.5px;
  font-weight: 600;
  line-height: 1.35;
}
.ac-move-desc-loading {
  color: rgba(148,163,184,.62);
  font-style: italic;
}
.ac-move-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
}
.ac-move-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 18px;
  padding: 2px 6px;
  border-radius: 999px;
  border: 1px solid rgba(148,163,184,.22);
  background: rgba(15,23,42,.55);
  color: rgba(226,232,240,.84);
  font-size: 9.5px;
  font-weight: 850;
  line-height: 1;
  white-space: nowrap;
}
.ac-move-chip svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.ac-move-chip.ac-type-chip {
  text-shadow: 0 1px 1px rgba(2,6,23,.55);
}
.ac-move-chip.ac-chip-melee { color: #fdba74; border-color: rgba(251,146,60,.35); background: rgba(251,146,60,.12); }
.ac-move-chip.ac-chip-ranged { color: #7dd3fc; border-color: rgba(14,165,233,.35); background: rgba(14,165,233,.12); }
.ac-move-chip.ac-chip-area { color: #c084fc; border-color: rgba(192,132,252,.35); background: rgba(192,132,252,.12); }
.ac-move-chip.ac-chip-self { color: #c084fc; border-color: rgba(192,132,252,.35); background: rgba(192,132,252,.12); }
.ac-target-hint {
  font-size: 11px;
  color: rgba(148,163,184,.86);
  line-height: 1.35;
  margin: -2px 0 8px;
}
.ac-prompt svg {
  width: 14px;
  height: 14px;
  vertical-align: -2px;
  margin-right: 4px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.ac-move-dmg.bonus-high {
  background: rgba(34,197,94,.15); border-color: rgba(34,197,94,.4); color: rgba(34,197,94,.95);
}

/* ── Range selector (in overlay) ── */
.ac-range-row {
  display: flex; gap: 6px; margin-bottom: 8px;
  flex-wrap: wrap;
}
.ac-range-btn {
  flex: 1 1 30%; appearance: none; cursor: pointer;
  padding: 6px; border-radius: 8px;
  border: 1px solid rgba(148,163,184,.22);
  background: rgba(2,6,23,.2); color: rgba(226,232,240,.75);
  font-size: 11px; font-weight: 700; text-align: center;
  transition: all .12s;
}
.ac-range-btn:hover { border-color: rgba(56,189,248,.3); }
.ac-range-btn.ac-active {
  background: rgba(56,189,248,.15); border-color: rgba(56,189,248,.45);
  color: rgba(56,189,248,.95);
}

/* ── Floating feedback ── */
.ac-float {
  position: absolute;
  pointer-events: none;
  z-index: 55;
  transform: translate(-50%, -100%);
  padding: 8px 14px;
  border-radius: 12px;
  font-weight: 800; font-size: 13px;
  white-space: nowrap;
  animation: acFloatUp 4s ease-out forwards;
  box-shadow: 0 6px 24px rgba(2,6,23,.45);
}
@keyframes acFloatUp {
  0% { opacity: 0; transform: translate(-50%, -80%); }
  8% { opacity: 1; transform: translate(-50%, -110%); }
  75% { opacity: 1; transform: translate(-50%, -130%); }
  100% { opacity: 0; transform: translate(-50%, -160%); }
}
.ac-float-hit {
  background: rgba(34,197,94,.18); border: 1px solid rgba(34,197,94,.45);
  color: rgba(34,197,94,.95);
}
.ac-float-miss {
  background: rgba(248,113,113,.18); border: 1px solid rgba(248,113,113,.45);
  color: rgba(248,113,113,.95);
}
.ac-float-crit {
  background: rgba(251,191,36,.18); border: 1px solid rgba(251,191,36,.45);
  color: rgba(251,191,36,.95);
}
.ac-float-resist {
  background: rgba(168,85,247,.18); border: 1px solid rgba(168,85,247,.45);
  color: rgba(168,85,247,.95);
}
.ac-float-stage {
  background: rgba(56,189,248,.15); border: 1px solid rgba(56,189,248,.35);
  color: rgba(56,189,248,.9);
  font-size: 12px; padding: 5px 10px;
  animation: acFloatUp 5s ease-out forwards;
}
.ac-float-pending {
  background: rgba(251,191,36,.12); border: 1px solid rgba(251,191,36,.35);
  color: rgba(251,191,36,.9);
  animation: acPulse 2s ease-in-out infinite;
  pointer-events: auto; cursor: default;
}
@keyframes acPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(251,191,36,.25); }
  50% { box-shadow: 0 0 0 8px rgba(251,191,36,0); }
}

/* ── Pending prompt (defender / attacker small panel) ── */
/* Dice / coin animation layer */
.ac-roll-layer {
  position: absolute;
  inset: 0;
  z-index: 86;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(2,6,23,.28);
}
.ac-roll-panel {
  width: min(290px, calc(100% - 28px));
  border-radius: 14px;
  border: 1px solid rgba(148,163,184,.28);
  background: rgba(10,18,32,.95);
  box-shadow: 0 18px 46px rgba(2,6,23,.55);
  backdrop-filter: blur(12px);
  padding: 14px;
  text-align: center;
  animation: acFadeIn .16s ease-out;
}
.ac-roll-title {
  font-size: 13px;
  font-weight: 900;
  color: rgba(226,232,240,.95);
  margin-bottom: 8px;
}
.ac-roll-sub {
  font-size: 11px;
  color: rgba(148,163,184,.82);
  line-height: 1.35;
  margin-bottom: 12px;
}
.ac-roll-sprite {
  width: 96px;
  height: 96px;
  margin: 0 auto 10px;
  image-rendering: auto;
  background-repeat: no-repeat;
  background-position: 0 0;
}
.ac-coin-sprite {
  background-image: url("./assets/ui/coin-flip-sprite.svg");
  background-size: 1536px 96px;
}
.ac-d20-sprite {
  background-image: url("./assets/ui/d20-roll-sprite.svg");
  background-size: 1920px 96px;
}
.ac-coin-sprite.ac-rolling {
  animation: acCoinFlip 1s steps(15) 2;
}
.ac-d20-sprite.ac-rolling {
  animation: acD20Roll 1s steps(19);
}
@keyframes acCoinFlip {
  from { background-position: 0 0; }
  to { background-position: -1440px 0; }
}
@keyframes acD20Roll {
  from { background-position: 0 0; }
  to { background-position: -1824px 0; }
}
.ac-coin-choice-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.ac-roll-choice {
  appearance: none;
  cursor: pointer;
  padding: 10px 8px;
  border-radius: 10px;
  border: 1px solid rgba(148,163,184,.24);
  background: rgba(2,6,23,.35);
  color: rgba(226,232,240,.88);
  font-size: 12px;
  font-weight: 900;
  transition: all .14s ease;
}
.ac-roll-choice:hover {
  border-color: rgba(251,191,36,.48);
  background: rgba(251,191,36,.14);
  transform: translateY(-1px);
}
.ac-roll-choice:disabled {
  opacity: .45;
  cursor: default;
  transform: none;
}
.ac-roll-result {
  min-height: 20px;
  font-size: 12px;
  font-weight: 900;
  color: rgba(226,232,240,.9);
}
.ac-roll-result.ac-success { color: rgba(34,197,94,.96); }
.ac-roll-result.ac-fail { color: rgba(248,113,113,.96); }
.ac-roll-value {
  font-size: 30px;
  font-weight: 1000;
  color: rgba(248,250,252,.96);
  margin-top: -4px;
}

.ac-prompt {
  position: absolute;
  pointer-events: auto;
  z-index: 62;
  min-width: 220px; max-width: 300px;
  border-radius: 14px;
  border: 1.5px solid rgba(168,85,247,.4);
  background: rgba(10,18,32,.92);
  backdrop-filter: blur(12px);
  padding: 12px;
  animation: acFadeIn .25s ease-out;
  box-shadow: 0 12px 32px rgba(2,6,23,.5);
}
.ac-prompt-title {
  font-weight: 900; font-size: 13px; margin-bottom: 8px;
  color: rgba(226,232,240,.95);
}
.ac-prompt-dc {
  padding: 8px 10px; border-radius: 10px;
  background: rgba(56,189,248,.1); border: 1px solid rgba(56,189,248,.25);
  font-weight: 800; font-size: 13px; margin-bottom: 10px;
  color: rgba(56,189,248,.9);
}
.ac-prompt-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
}
.ac-prompt-btn {
  appearance: none; cursor: pointer;
  padding: 10px 8px; border-radius: 10px;
  border: 1px solid rgba(148,163,184,.22);
  background: rgba(2,6,23,.3); color: rgba(226,232,240,.85);
  font-size: 12px; font-weight: 800; text-align: center;
  transition: all .15s;
}
.ac-prompt-btn:hover {
  background: rgba(168,85,247,.15); border-color: rgba(168,85,247,.45);
  transform: translateY(-1px);
}
.ac-prompt-btn:disabled { opacity:.35; cursor: default; transform: none; }
.ac-prompt-btn.ac-wide { grid-column: span 2; }
.ac-prompt-btn.ac-special { background: rgba(251,191,36,.15); border-color: rgba(251,191,36,.4); color: rgba(251,191,36,.95); }
.ac-prompt-btn.ac-special:hover { background: rgba(251,191,36,.25); }

/* ── Reroll toast ── */
.ac-reroll-toast {
  position: absolute;
  bottom: 16px; left: 50%;
  transform: translateX(-50%);
  pointer-events: auto;
  z-index: 70;
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px;
  border-radius: 14px;
  border: 1px solid rgba(251,191,36,.4);
  background: rgba(10,18,32,.92);
  backdrop-filter: blur(12px);
  box-shadow: 0 12px 32px rgba(2,6,23,.5);
  animation: acSlideUp .25s ease-out;
  white-space: nowrap;
}
@keyframes acSlideUp {
  from { opacity:0; transform: translateX(-50%) translateY(20px); }
  to { opacity:1; transform: translateX(-50%) translateY(0); }
}
.ac-reroll-text {
  font-weight: 800; font-size: 13px; color: rgba(251,191,36,.9);
}
.ac-reroll-btn {
  appearance: none; cursor: pointer;
  padding: 7px 14px; border-radius: 10px;
  border: 1px solid rgba(148,163,184,.22);
  background: rgba(2,6,23,.3); color: rgba(226,232,240,.85);
  font-weight: 800; font-size: 12px;
  transition: all .15s;
}
.ac-reroll-btn:hover {
  background: rgba(251,191,36,.15); border-color: rgba(251,191,36,.45);
  transform: translateY(-1px);
}
.ac-reroll-btn.ac-primary {
  background: rgba(251,191,36,.2); border-color: rgba(251,191,36,.45);
  color: rgba(251,191,36,.95);
}
.ac-reroll-timer {
  width: 60px; height: 4px; border-radius: 2px;
  background: rgba(148,163,184,.2); overflow: hidden;
}
.ac-reroll-timer-bar {
  height: 100%; background: rgba(251,191,36,.7);
  border-radius: 2px;
  transition: width .1s linear;
}

/* ── Context menu ── */
.ac-context {
  position: absolute;
  pointer-events: auto;
  z-index: 75;
  min-width: 180px;
  border-radius: 12px;
  border: 1px solid rgba(148,163,184,.28);
  background: rgba(10,18,32,.94);
  backdrop-filter: blur(12px);
  box-shadow: 0 12px 32px rgba(2,6,23,.5);
  padding: 4px;
  animation: acFadeIn .15s ease-out;
}
.ac-ctx-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 8px;
  cursor: pointer; transition: background .1s;
  font-size: 12px; font-weight: 700;
  color: rgba(226,232,240,.85);
}
.ac-ctx-item:hover { background: rgba(56,189,248,.1); }
.ac-ctx-item .ac-ctx-icon { font-size: 14px; width: 20px; text-align: center; }
.ac-ctx-item .ac-ctx-kbd {
  margin-left: auto; font-size: 10px; color: rgba(148,163,184,.5);
  font-family: monospace;
}
.ac-ctx-sep {
  height: 1px; background: rgba(148,163,184,.15); margin: 4px 8px;
}
.ac-ctx-title {
  padding: 8px 10px 6px;
  font-size: 11px;
  font-weight: 800;
  color: rgba(148,163,184,.82);
}
.ac-ctx-meta {
  margin-left: auto;
  font-size: 10px;
  color: rgba(148,163,184,.65);
  text-transform: uppercase;
  letter-spacing: .02em;
}

/* ── Mini turn timeline ── */
.ac-timeline {
  position: absolute;
  top: 6px; left: 50%; transform: translateX(-50%);
  pointer-events: none; z-index: 45;
  display: flex; align-items: center; gap: 4px;
  padding: 4px 10px;
  border-radius: 10px;
  background: rgba(2,6,23,.7);
  border: 1px solid rgba(148,163,184,.15);
  backdrop-filter: blur(6px);
}
.ac-tl-step {
  display: flex; align-items: center; gap: 4px;
  font-size: 10px; font-weight: 700;
  color: rgba(148,163,184,.6);
}
.ac-tl-step.ac-tl-done { color: rgba(34,197,94,.8); }
.ac-tl-step.ac-tl-active { color: rgba(251,191,36,.9); }
.ac-tl-arrow { font-size: 8px; color: rgba(148,163,184,.3); }

/* ── Repeat last move button ── */
.ac-repeat-btn {
  position: absolute;
  bottom: 16px; right: 16px;
  pointer-events: auto; z-index: 45;
  appearance: none; cursor: pointer;
  padding: 8px 14px; border-radius: 12px;
  border: 1px solid rgba(56,189,248,.3);
  background: rgba(10,18,32,.85);
  backdrop-filter: blur(8px);
  color: rgba(56,189,248,.9);
  font-weight: 800; font-size: 12px;
  box-shadow: 0 6px 18px rgba(2,6,23,.35);
  transition: all .15s;
  display: none;
}
.ac-repeat-btn:hover {
  background: rgba(56,189,248,.15);
  border-color: rgba(56,189,248,.55);
  transform: translateY(-2px);
}


/* ── Sidebar ficha preview (Arena context menu) ── */
#arena_sheet_preview {
  margin: 10px 0 12px;
  /* Evita que a ficha domine toda a altura da sidebar quando tem muitos
     golpes/campos; o próprio preview rola se passar desse limite. */
  max-height: clamp(360px, 52vh, 640px);
  overflow-y: auto;
  padding-right: 2px;
}
#arena_sheet_preview::-webkit-scrollbar { width: 5px; }
#arena_sheet_preview::-webkit-scrollbar-thumb {
  background: rgba(148,163,184,.22);
  border-radius: 999px;
}
.arena-sheet-card {
  border-radius: 12px;
  border: 1px solid rgba(120,210,255,.2);
  background: linear-gradient(160deg, rgba(30,46,86,.92), rgba(20,35,70,.86));
  padding: 10px;
  color: #e8f6ff;
  box-shadow: 0 8px 20px rgba(2,6,23,.25);
  height: auto;
  min-height: 0;
}
.arena-sheet-card .sheet-name { font-weight: 900; font-size: 14px; line-height: 1.1; }
.arena-sheet-card .sheet-sub { font-size: 11px; opacity: .82; margin-top: 2px; }
.arena-sheet-card .sheet-top { display: flex; gap: 10px; align-items: flex-start; }
.arena-sheet-card .sheet-art { width: 76px; height: 76px; object-fit: contain; border-radius: 10px; background: rgba(0,0,0,.22); border: 1px solid rgba(255,255,255,.14); padding: 4px; }
.arena-sheet-card .chip-row { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
.arena-sheet-card .chip { font-size: 10px; font-weight: 800; border: 1px solid rgba(255,255,255,.2); border-radius: 999px; padding: 2px 7px; background: rgba(0,0,0,.2); }
.arena-sheet-card .hp-row { display:flex; justify-content:space-between; font-size: 11px; font-weight: 800; margin: 8px 0 4px; }
.arena-sheet-card .hp-track { height: 6px; border-radius: 999px; background: rgba(2,6,23,.55); overflow: hidden; }
.arena-sheet-card .hp-fill { height: 100%; border-radius: inherit; }
.arena-sheet-card .sheet-move-summary { display:grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap:6px; margin:9px 0 8px; }
.arena-sheet-card .sheet-move-metric { display:flex; align-items:center; gap:7px; min-width:0; padding:7px 8px; border-radius:10px; border:1px solid rgba(56,189,248,.24); background:linear-gradient(135deg, rgba(56,189,248,.13), rgba(15,23,42,.30)); box-shadow: inset 0 1px 0 rgba(255,255,255,.05); }
.arena-sheet-card .sheet-move-metric.sheet-tiles { border-color:rgba(45,212,191,.24); background:linear-gradient(135deg, rgba(45,212,191,.12), rgba(15,23,42,.30)); }
.arena-sheet-card .sheet-move-icon { width:24px; height:24px; flex:0 0 24px; display:grid; place-items:center; border-radius:8px; color:#7dd3fc; background:rgba(2,6,23,.34); border:1px solid rgba(125,211,252,.22); }
.arena-sheet-card .sheet-tiles .sheet-move-icon { color:#5eead4; border-color:rgba(94,234,212,.22); }
.arena-sheet-card .sheet-move-icon svg { width:17px; height:17px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
.arena-sheet-card .sheet-move-copy { display:flex; flex-direction:column; gap:1px; min-width:0; line-height:1.05; }
.arena-sheet-card .sheet-move-copy span { font-size:8px; font-weight:950; letter-spacing:.06em; text-transform:uppercase; color:rgba(203,213,225,.82); }
.arena-sheet-card .sheet-move-copy strong { font-size:13px; color:rgba(248,250,252,.98); white-space:nowrap; }
.arena-sheet-card .stat-grid { display:grid; grid-template-columns: repeat(4,1fr); gap: 4px; margin: 8px 0; }
.arena-sheet-card .stat-box { border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.05); padding: 4px 2px; text-align:center; }
.arena-sheet-card .stat-label { font-size: 9px; opacity: .75; text-transform: uppercase; font-weight: 800; }
.arena-sheet-card .stat-val { font-size: 14px; font-weight: 900; line-height: 1; }
.arena-sheet-card .section-title { font-size: 11px; font-weight: 900; margin: 8px 0 4px; }
.arena-sheet-card .move-row { border: 1px solid rgba(255,255,255,.14); border-radius: 9px; padding: 6px; margin-bottom: 5px; background: rgba(0,0,0,.14); }
.arena-sheet-card .move-head { display:flex; align-items:center; gap:4px; }
.arena-sheet-card .move-name { font-size: 11px; font-weight: 900; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.arena-sheet-card .mv-pill { font-size: 9px; border-radius: 999px; border: 1px solid rgba(255,255,255,.18); padding: 1px 4px; }
.arena-sheet-card .muted { opacity: .75; font-size: 10px; }
.arena-sheet-card .trainer-rpg-list { display:flex; flex-direction:column; gap:4px; margin-top:4px; }
.arena-sheet-card .trainer-rpg-line { font-size: 10px; line-height: 1.35; color: rgba(226,232,240,.92); }
.ac-resolution-toast {
  position: absolute;
  right: 14px;
  bottom: 18px;
  width: min(320px, calc(100vw - 28px));
  z-index: 5100;
  pointer-events: auto;
  border: 1px solid rgba(56,189,248,.34);
  border-radius: 12px;
  background: rgba(2,6,23,.94);
  box-shadow: 0 18px 45px rgba(0,0,0,.34);
  padding: 12px;
  color: rgba(226,232,240,.94);
}
.ac-resolution-title { font-size: 12px; font-weight: 950; color: #38bdf8; margin-bottom: 4px; }
.ac-resolution-summary { font-size: 12px; line-height: 1.35; }
.ac-resolution-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:10px; }
.ac-mini-btn {
  border: 1px solid rgba(148,163,184,.28);
  background: rgba(15,23,42,.86);
  color: rgba(226,232,240,.92);
  border-radius: 8px;
  padding: 6px 9px;
  font-size: 11px;
  font-weight: 850;
  cursor: pointer;
}
.ac-mini-btn:hover { border-color: rgba(56,189,248,.48); color:#fff; }
.ac-mini-btn:disabled { opacity:.45; cursor:wait; }
`;

// localStorage keys
const FAV_KEY_PREFIX = "pvp_fav_moves_";
const LAST_MOVE_KEY = "pvp_last_move";

// ═══════════════════════════════════════════════════════════════════
// ArenaCombatUI — main class
// ═══════════════════════════════════════════════════════════════════
export class ArenaCombatUI {
  constructor(opts) {
    this.container = opts.arenaWrap;
    this.getDb     = opts.getDb;
    this.getRid    = opts.getRid;
    this.getBy     = opts.getBy;
    this.getRole   = opts.getRole;
    this.getBattle = opts.getBattle;
    this.getPieces = opts.getPieces;

    this._partyStates = {};
    this._sheets = new Map();
    this._sheetsMap = new Map();
    this._sheetCollections = new Map();
    this._trainerRpgSheets = new Map();
    this._trainerRpgUnsubs = new Map();
    this._partyStatesUnsub = null;

    this._overlayRoot = null;
    this._currentOverlay = null;
    this._currentRadial = null;
    this._currentPrompt = null;
    this._currentContext = null;
    this._currentReroll = null;
    this._currentRollAnimation = null;
    this._floats = [];
    this._pendingBadge = null;
    this._repeatBtn = null;
    this._timeline = null;
    this._lastMove = null;
    this._kbBound = false;
    this._attackTargetMode = null;
    try { window.__arenaAttackTargetMode = null; } catch {}

    try {
      this._lastMove = JSON.parse(localStorage.getItem(LAST_MOVE_KEY));
    } catch { this._lastMove = null; }

    injectCSS();
    this._init();
    this.startListening();
  }

  _init() {
    this._overlayRoot = document.createElement("div");
    this._overlayRoot.id = "arena-combat-overlay";
    this.container.appendChild(this._overlayRoot);

    this._repeatBtn = document.createElement("button");
    this._repeatBtn.className = "ac-repeat-btn";
    this._repeatBtn.style.display = "none";
    this._overlayRoot.appendChild(this._repeatBtn);
    this._repeatBtn.addEventListener("click", () => this._repeatLastMove());

    this._bindCanvasClick();
    this._bindContextMenu();
    this._bindKeyboard();
    this._updateRepeatBtn();
  }

  _battleRef() {
    const db = this.getDb(); const rid = this.getRid();
    if (!db || !rid) return null;
    return doc(db, "rooms", rid, "public_state", "battle");
  }

  _partyStatesRef() {
    const db = this.getDb(); const rid = this.getRid();
    if (!db || !rid) return null;
    return doc(db, "rooms", rid, "public_state", "party_states");
  }

  _trainerRpgSheetRef(trainerName) {
    const db = this.getDb();
    const tid = safeDocId(trainerName);
    if (!db || !tid) return null;
    return doc(db, "trainers", tid, "profile", "rpg_sheet");
  }

  _loadTrainerRpgSheet(trainerName, forceReload = false) {
    const name = safeStr(trainerName);
    const key = trainerCacheKey(name);
    if (!name || !key) return;
    if (!forceReload && this._trainerRpgUnsubs.has(key)) return;
    if (forceReload && this._trainerRpgUnsubs.has(key)) {
      try { this._trainerRpgUnsubs.get(key)?.(); } catch {}
      this._trainerRpgUnsubs.delete(key);
    }
    const ref = this._trainerRpgSheetRef(name);
    if (!ref) return;
    const unsub = onSnapshot(ref, (snap) => {
      this._trainerRpgSheets.set(key, snap.exists() ? normalizeTrainerRpgSheetData(snap.data() || {}, name) : null);
    }, () => {
      this._trainerRpgSheets.set(key, null);
    });
    this._trainerRpgUnsubs.set(key, unsub);
  }

  _getTrainerRpgSheet(trainerName) {
    const key = trainerCacheKey(trainerName);
    return key ? (this._trainerRpgSheets.get(key) || null) : null;
  }

  async _publishRoll(value, label = "d20") {
    const db = this.getDb(); const rid = this.getRid();
    const by = safeStr(this.getBy()) || "—";
    if (!db || !rid) return;
    try {
      const rollValue = safeInt(value, 0);
      const rollLabel = safeStr(label) || "d20";
      if (typeof window !== "undefined" && typeof window.publishPublicD20Roll === "function") {
        const ref = await window.publishPublicD20Roll({
          by,
          value: rollValue,
          rawValue: rollValue,
          label: rollLabel,
          animationLabel: rollLabel,
          final: true,
        });
        if (ref) return ref;
      }

      const requestId = `arena_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const ref = await addDoc(collection(db, "rooms", rid, "rolls"), {
        by,
        trainer: by,
        value: rollValue,
        rawValue: rollValue,
        label: rollLabel,
        animationLabel: rollLabel,
        requestId,
        final: true,
        kind: "dice",
        die: "d20",
        clientCreatedAt: Date.now(),
        createdAt: serverTimestamp(),
      });
      if (typeof window !== "undefined" && typeof window.waitForSharedRollAnimation === "function") {
        await window.waitForSharedRollAnimation(requestId, { label: rollLabel, value: rollValue });
      }
      return ref;
    } catch (err) {}
  }

  startListening() {
    this.stopListening();
    const ref = this._partyStatesRef();
    if (!ref) return;
    this._partyStatesUnsub = onSnapshot(ref, (snap) => {
      this._partyStates = snap.exists() ? (snap.data() || {}) : {};
      for (const trainerName of Object.keys(this._partyStates)) {
        if (trainerName && !this._sheets.has(trainerName)) {
          this._loadSheets(trainerName);
        }
        if (trainerName && !this._trainerRpgUnsubs.has(trainerCacheKey(trainerName))) {
          this._loadTrainerRpgSheet(trainerName);
        }
      }
    }, () => {});

    setTimeout(() => {
      const players = window.appState?.players || [];
      for (const pl of players) {
        const name = safeStr(pl?.trainer_name);
        if (name && !this._sheets.has(name)) this._loadSheets(name);
        if (name && !this._trainerRpgUnsubs.has(trainerCacheKey(name))) this._loadTrainerRpgSheet(name);
      }
      const by = this.getBy?.();
      if (by && !this._sheets.has(by)) this._loadSheets(by);
      if (by && !this._trainerRpgUnsubs.has(trainerCacheKey(by))) this._loadTrainerRpgSheet(by);
    }, 400);
  }

  stopListening() {
    if (this._partyStatesUnsub) { try { this._partyStatesUnsub(); } catch {} }
    this._partyStatesUnsub = null;
    for (const [trainerKey, unsub] of this._trainerRpgUnsubs.entries()) {
      try { unsub(); } catch {}
      this._trainerRpgUnsubs.delete(trainerKey);
    }
  }

  async _loadSheets(trainerName) {
    if (this._sheets.has(trainerName) && (this._sheets.get(trainerName) || []).length > 0) return;
    const db = this.getDb();
    if (!db) return;
    const tid = safeDocId(trainerName);
    try {
      const col = collection(db, "trainers", tid, "sheets");
      const q = query(col, orderBy("updated_at", "desc"), fbLimit(200));
      const snap = await getDocs(q);
      const sheets = [];
      const map = new Map();

      snap.forEach((d) => {
        const s = d.data() || {};
        s._sheet_id = d.id;
        sheets.push(s);

        const pid = safeStr(s.pokemon?.id);
        const lpid = safeStr(s.linked_pid);
        const pname = safeStr(s.pokemon?.name).toLowerCase();

        if (pid && !map.has(pid)) map.set(pid, s);
        if (pid && /^\d+$/.test(pid)) {
          const num = String(Number(pid));
          if (!map.has(num)) map.set(num, s);
        }
        if (lpid && !map.has(lpid)) map.set(lpid, s);
        if (pname && !map.has(pname)) map.set(pname, s);
      });
      this._sheets.set(trainerName, sheets);
      this._sheetsMap.set(trainerName, map);
      this._sheetCollections.set(trainerName, buildSheetCollections(sheets));
    } catch (e) {}
  }

  _getSheet(trainerName, pid) {
    const collections = this._sheetCollections.get(trainerName) || null;
    const identity = (pid && typeof pid === "object" && !Array.isArray(pid))
      ? pid
      : (this._findPieceByOwnerPid(trainerName, pid) || pid);
    const baseSheet = getBaseSheetFromCollections(
      collections,
      sheetLookupValuesForTrainer(this._partyStates, trainerName, identity)
    );
    if (!baseSheet) return null;
    const megaState = getBattleMegaState(this._partyStates, trainerName, identity);
    const megaSheets = getMegaSheetsForBase(collections, baseSheet, identity);
    const activeSlug = safeStr(megaState?.activeMegaSlug).toLowerCase();
    if (activeSlug) {
      const megaSheet = megaSheets.find((sheet) => safeStr(sheet?.mega_slug).toLowerCase() === activeSlug);
      if (megaSheet) return megaSheet;
    }
    const effectiveSheetId = safeStr(megaState?.effectiveSheetId);
    if (effectiveSheetId && collections?.byId?.has?.(effectiveSheetId)) {
      const byIdSheet = collections.byId.get(effectiveSheetId);
      if (sheetIsMega(byIdSheet)) return byIdSheet;
    }
    return baseSheet;
  }

  // Novo _getEffectiveStats incluindo boosts temporários (espelha o combat.js)
  _getEffectiveStats(trainerName, pid) {
    const identity = (pid && typeof pid === "object" && !Array.isArray(pid))
      ? pid
      : (this._findPieceByOwnerPid(trainerName, pid) || pid);
    const tData = getTrainerBucket(this._partyStates, trainerName);
    const key = safeStr(identity?.pid ?? identity?.pokemon?.id ?? pid);
    
    let pData = getPartyStateEntry(this._partyStates, trainerName, identity) || tData[key];
    if (!pData && /^\d+$/.test(key)) pData = tData[String(Number(key))];
    if (!pData) {
      for (const k of Object.keys(tData)) {
        if (/^\d+$/.test(k) && Number(k) === Number(key)) { pData = tData[k]; break; }
      }
    }
    pData = pData || {};

    if (isTrainerPiece(pid)) {
      if (!this._trainerRpgUnsubs.has(trainerCacheKey(trainerName))) this._loadTrainerRpgSheet(trainerName);
      const boosts = pData.stat_boosts || {};
      const trainerSheet = this._getTrainerRpgSheet(trainerName);
      const result = normalizeStats(trainerSheet?.stats || {});

      for (const [k, v] of Object.entries(boosts)) {
        const statKey = normalizeStatKey(k);
        if (result[statKey] !== undefined || statKey === "acerto" || statKey === "critical") {
          result[statKey] = (safeInt(result[statKey]) + safeInt(v));
        }
      }

      result.fortitude = safeInt(result.fort);
      result.toughness = safeInt(result.thg);
      return result;
    }

    const sheet = this._getSheet(trainerName, identity);
    const sheetStats = (sheet && sheet.stats && typeof sheet.stats === "object" && !Array.isArray(sheet.stats)) ? sheet.stats : {};
    const np = safeInt(sheet?.np ?? sheet?.pokemon?.np ?? sheet?.pokemon?.NP);
    const hasPartyStats = shouldUsePartyBaseStats(pData.stats, sheetStats, np > 0);
    const base = hasPartyStats ? pData.stats : sheetStats;

    let baseFixed = base;
    if (!hasPartyStats) {
      const hasCap = safeInt(sheetStats.cap ?? sheetStats.capability) > 0;
      baseFixed = (!hasCap && np > 0) ? { ...sheetStats, cap: 2 * np } : sheetStats;
    }

    const boosts = pData.stat_boosts || {};
    const result = normalizeStats(baseFixed);

    // Aplica modificadores (ex: acerto +2, parry -1)
    for (const [k, v] of Object.entries(boosts)) {
      const statKey = normalizeStatKey(k);
      if (result[statKey] !== undefined || statKey === "acerto" || statKey === "critical") {
        result[statKey] = (safeInt(result[statKey]) + safeInt(v));
      }
    }

    result.fortitude = safeInt(result.fort);
    result.toughness = safeInt(result.thg);

    // THG Fallback baseado no dodge já boostado
    if (safeInt(result.thg) <= 0 && np > 0) {
      result.thg = Math.max(0, (2 * np) - safeInt(result.dodge));
      result.toughness = safeInt(result.thg);
    }

    return result;
  }

  // Calculador centralizado de dano com STAB, Tipo e mods temporários do golpe
  _calcMoveContext(move, atkStats, by, atkPid, tOwner, tPid, opts = {}) {
    const atkIdentity = opts.atkIdentity || this._findPieceByOwnerPid(by, atkPid) || atkPid;
    const targetIdentity = opts.targetIdentity || this._findPieceByOwnerPid(tOwner, tPid) || tPid;
    const atkSheet = opts.atkSheet || this._getSheet(by, atkIdentity);
    const moveIdx = resolveMoveIndex(atkSheet?.moves || [], move, opts.moveIdx);
    const tempMods = getMoveTempMods(atkPid, moveIdx, atkSheet);
    const mData = opts.moveData || getMoveData(move, tempMods);
    const rank = mData.rank;
    const extraDmg = mData.modDano;

    const [based, statVal] = resolveAttackStatValue(move || {}, opts.powerRule || {}, atkStats);

    const moveName = safeStr(move.name) || "Golpe";
    const moveType = getMoveType(moveName) || safeStr(move.meta?.type) || safeStr(move.type) || "";

    const atkTypes = resolveTrainerPokemonTypes(by, atkIdentity, { sheet: atkSheet, piece: atkIdentity });
    const tSheet = this._getSheet(tOwner, targetIdentity);
    const tgtTypes = resolveTrainerPokemonTypes(tOwner, targetIdentity, { sheet: tSheet, piece: targetIdentity });

    const typeBonus = moveType && tgtTypes.length > 0 ? getTypeDamageBonus(moveType, tgtTypes) : 0;
    const stabBonus = (moveType && atkTypes.some(t => normalizeType(t) === moveType)) ? 2 : 0;

    return {
      baseDmg: rank + statVal + extraDmg,
      totalDmg: rank + statVal + typeBonus + stabBonus + extraDmg,
      typeBonus,
      stabBonus,
      moveType,
      based,
      statVal,
      rank,
      atkMod: mData.acc,
      extraDmg,
      moveIdx,
      tempAcc: mData.tempAcc,
      tempDmg: mData.tempDmg,
      baseModDano: mData.baseModDano,
    };
  }

  _getFavorites(trainerName, pidLike = "") {
    try {
      if (typeof window.getFavoriteMoveNamesForTrainerPid === "function") {
        const remote = window.getFavoriteMoveNamesForTrainerPid(trainerName, pidLike);
        if (Array.isArray(remote) && remote.length) return remote;
      }
    } catch {}
    try {
      const raw = localStorage.getItem(FAV_KEY_PREFIX + trainerName);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }

  _saveFavorites(trainerName, arr) {
    try { localStorage.setItem(FAV_KEY_PREFIX + trainerName, JSON.stringify(arr)); } catch {}
  }

  _tileToScreen(row, col) {
    const v = window._arenaView;
    if (!v) return { x: 0, y: 0 };
    return {
      x: v.offX + col * v.scale + v.scale / 2,
      y: v.offY + row * v.scale + v.scale / 2,
    };
  }

  _pieceScreenPos(piece) {
    if (!piece) return { x: 0, y: 0 };
    return this._tileToScreen(Number(piece.row), Number(piece.col));
  }

  _clampPos(x, y, w, h) {
    const cr = this.container.getBoundingClientRect();
    const maxX = cr.width - w - 8;
    const maxY = cr.height - h - 8;
    return {
      x: Math.max(8, Math.min(x, maxX)),
      y: Math.max(8, Math.min(y, maxY)),
    };
  }

  _isMine(piece) {
    const owner = safeStr(piece?.owner).toLowerCase();
    const by = safeStr(this.getBy?.()).toLowerCase();
    return !!owner && !!by && owner === by;
  }

  _resolvePiece(pieceOrId) {
    if (pieceOrId && typeof pieceOrId === "object") return pieceOrId;
    const id = safeStr(pieceOrId);
    if (!id) return null;
    return (this.getPieces() || []).find((piece) => safeStr(piece?.id) === id) || null;
  }

  _moveTargetingInfo(move, powerRule = null) {
    try {
      if (typeof window.getMoveTargetingInfo === "function") {
        const info = window.getMoveTargetingInfo(move, powerRule);
        if (info?.kind) return info;
      }
    } catch {}
    const meta = (move && typeof move === "object" && move.meta && typeof move.meta === "object") ? move.meta : {};
    const targetingMode = safeStr(powerRule?.targeting?.mode || powerRule?.mode || "").toLowerCase();
    if (meta.affects_user || targetingMode === "self" || targetingMode === "user" || isSelfPowerRule(powerRule)) {
      return { kind: "self", rangeStr: "self", label: "Usuario", areaLabel: "Sem area", defense: "", defenseLabel: "" };
    }
    if (meta.is_area || meta.perception_area || meta.area_type || meta.areaType) {
      return { kind: "area", rangeStr: "area", label: "Area", areaLabel: "Area", defense: "Dodge", defenseLabel: "Defesa: Dodge" };
    }
    if (meta.ranged === false || safeStr(meta.distance_type || meta.distanceType).toLowerCase() === "melee") {
      return { kind: "melee", rangeStr: "melee", label: "Corpo a corpo", areaLabel: "Sem area", defense: "Parry", defenseLabel: "Defesa: Parry" };
    }
    return { kind: "ranged", rangeStr: "distance", label: "A distancia", areaLabel: "Sem area", defense: "Dodge", defenseLabel: "Defesa: Dodge" };
  }

  _movePpText(move) {
    const cur = move?.pp_current ?? move?.current_pp ?? move?.ppCurrent ?? move?.pp;
    const max = move?.pp_max ?? move?.max_pp ?? move?.ppMax ?? move?.PP ?? move?.pp;
    if (cur != null && max != null) return `${safeStr(cur)}/${safeStr(max)}`;
    if (max != null) return safeStr(max);
    return "-";
  }

  _attackerMoveRowHtml(move, idx, stats, by, atkPid, atkSheet, attackerPiece = null, powerRule = null) {
    const name = safeStr(move?.name) || "Golpe";
    const moveIdx = resolveMoveIndex(atkSheet?.moves || [], move, idx);
    const moveData = getMoveData(move, getMoveTempMods(atkPid, moveIdx, atkSheet));
    const [, statVal] = resolveAttackStatValue(move || {}, powerRule || {}, stats || {});
    const rank = moveData.rank;
    const moveType = getMoveType(name) || safeStr(move?.meta?.type || move?.type || move?.Type || "");
    const atkIdentity = attackerPiece || this._findPieceByOwnerPid(by, atkPid) || atkPid;
    const atkTypes = resolveTrainerPokemonTypes(by, atkIdentity, { sheet: atkSheet, piece: atkIdentity });
    const stabBonus = moveType && atkTypes.some((type) => normalizeType(type) === normalizeType(moveType)) ? 2 : 0;
    const finalRank = rank + statVal + moveData.modDano + stabBonus;
    const ruleAccuracy = getAttackModifierSummary(powerRule || {}, stats || {}).attackBonus;
    const finalAccuracy = moveData.acc + safeInt(stats?.acerto || 0) + safeInt(ruleAccuracy, 0);
    const target = this._moveTargetingInfo(move, powerRule);
    const cat = safeStr(move?.meta?.category || move?.category || "").toLowerCase();
    const dot = cat.includes("status") ? "#c084fc" : cat.includes("special") || cat.includes("especial") ? "#60a5fa" : "#fb7185";
    const chipKind = target.kind === "area" ? "area" : (target.kind === "melee" ? "melee" : (target.kind === "self" ? "self" : "ranged"));
    const showAccuracy = !(target.kind === "area" || target.kind === "self");
    const targetLabel = moveTargetLabel(target.kind, target.label);
    const typeChipStyle = moveTypeChipStyle(moveType);
    return `<div class="ac-move-item ac-attacker-move" data-idx="${idx}">
      <span style="width:10px;height:10px;margin-top:5px;border-radius:999px;background:${dot};box-shadow:0 0 12px ${dot}99"></span>
      <div class="ac-move-main">
        <div class="ac-move-topline">
          <span class="ac-move-name">${escHtml(name)}</span>
          <span class="ac-move-dmg">Rank Final ${finalRank}</span>
        </div>
        ${moveDescriptionHtml(move)}
        <div class="ac-move-chips">
          ${moveType ? `<span class="ac-move-chip ac-type-chip" style="${escHtml(typeChipStyle)}">Tipo: ${escHtml(normalizeType(moveType).toUpperCase())}</span>` : ""}
          ${showAccuracy ? `<span class="ac-move-chip">Acerto ${finalAccuracy >= 0 ? "+" : ""}${escHtml(finalAccuracy)}</span>` : ""}
          <span class="ac-move-chip ac-chip-${chipKind}">${target.kind === "self" ? "" : targetIconHtml(chipKind)}${escHtml(targetLabel)}</span>
        </div>
      </div>
    </div>`;
  }

  async openAttackFlowForAttacker(pieceOrId, clientX = null, clientY = null) {
    const attackerPiece = this._resolvePiece(pieceOrId);
    if (!attackerPiece || !this._isMine(attackerPiece) || isTrainerPiece(attackerPiece)) return;
    const canStart = !!window.canCurrentPlayerStartCombat?.() || !!window.canCurrentPlayerStartCombat?.({ ignoreTurn: true });
    if (!canStart) {
      this._showFloat(attackerPiece, "Fora do turno", "miss");
      return;
    }

    this._closeOverlay();
    const by = this.getBy();
    await this._loadSheets(by);
    const atkPid = safeStr(attackerPiece.pid);
    const atkSheet = this._getSheet(by, attackerPiece) || this._getSheet(by, atkPid);
    const moves = Array.isArray(atkSheet?.moves) ? atkSheet.moves : [];
    const stats = this._getEffectiveStats(by, attackerPiece);
    const name = pieceBattleLabel(attackerPiece, atkSheet);
    const sprite = effectiveSpriteUrl(by, attackerPiece, { type: "battle" });
    const movePowerRules = await Promise.all(moves.map(async (move, idx) => {
      try {
        return await getPowerRuleForMove({ ...move, _move_idx: idx });
      } catch {
        return null;
      }
    }));

    const wrapRect = this.container.getBoundingClientRect();
    let localX = Number(clientX) - wrapRect.left;
    let localY = Number(clientY) - wrapRect.top;
    if (!Number.isFinite(localX) || !Number.isFinite(localY)) {
      const pos = this._pieceScreenPos(attackerPiece);
      localX = pos.x;
      localY = pos.y;
    }

    const el = document.createElement("div");
    el.className = "ac-overlay";
    el.innerHTML = `
      <div class="ac-overlay-header">
        <img class="ac-overlay-sprite" src="${escHtml(sprite)}" alt="${escHtml(name)}" onerror="this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'" />
        <div>
          <div class="ac-overlay-name">Atacar com ${escHtml(name)}</div>
          <div class="ac-overlay-sub">Escolha o golpe; depois clique no alvo.</div>
        </div>
        <button class="ac-overlay-close" title="Fechar (Esc)">✕</button>
      </div>
      <div id="ac-overlay-body"></div>
    `;
    const pos = this._clampPos(localX + 14, localY - 24, 330, 430);
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    this._overlayRoot.appendChild(el);
    this._currentOverlay = el;
    el.querySelector(".ac-overlay-close").addEventListener("click", () => this._closeOverlay());

    const closeHandler = (e) => {
      if (!el.contains(e.target)) {
        this._closeOverlay();
        document.removeEventListener("mousedown", closeHandler, true);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", closeHandler, true), 50);

    this._renderAttackerMovePicker(el.querySelector("#ac-overlay-body"), {
      attackerPiece,
      atkPid,
      atkSheet,
      moves,
      stats,
      by,
      movePowerRules,
    });
  }

  _renderAttackerMovePicker(body, ctx) {
    const { attackerPiece, atkPid, atkSheet, moves, stats, by, movePowerRules = [] } = ctx || {};
    let html = `<input class="ac-search" placeholder="/ buscar golpe..." id="ac-attacker-move-search" />`;
    html += `<div class="ac-movelist" id="ac-attacker-move-list">`;
    moves.forEach((move, idx) => {
      html += this._attackerMoveRowHtml(move, idx, stats, by, atkPid, atkSheet, attackerPiece, movePowerRules[idx] || null);
    });
    if (!moves.length) {
      html += `<div style="padding:12px;text-align:center;color:rgba(148,163,184,.55);font-size:12px">Nenhum golpe encontrado.</div>`;
    }
    html += `</div>`;
    body.innerHTML = html;

    const search = body.querySelector("#ac-attacker-move-search");
    search?.addEventListener("input", () => {
      const q = safeStr(search.value).toLowerCase();
      body.querySelectorAll(".ac-move-item[data-idx]").forEach((el) => {
        const haystack = safeStr(el.textContent).toLowerCase();
        el.style.display = haystack.includes(q) ? "" : "none";
      });
    });
    this._hydratePokeApiMoveDescriptions(body, moves);

    body.querySelectorAll(".ac-move-item[data-idx]").forEach((el) => {
      el.addEventListener("click", async () => {
        const idx = safeInt(el.dataset.idx, -1);
        const move = moves[idx];
        if (!move) return;
        const powerRule = movePowerRules[idx] || await getPowerRuleForMove({ ...move, _move_idx: idx });
        if (isSelfPowerRule(powerRule) || (hasResolvableImmediateEffects(powerRule) && safeStr(powerRule?.targeting?.mode) === "self")) {
          await this._executeImmediatePower(atkPid, move, stats, { moveIdx: idx, powerRule });
          return;
        }
        const targeting = this._moveTargetingInfo(move, powerRule);
        this._armAttackTargetMode({
          attackerPiece,
          atkPid,
          move,
          moveIdx: idx,
          stats,
          powerRule,
          targeting,
        });
      });
    });
  }

  _hydratePokeApiMoveDescriptions(body, moves) {
    body.querySelectorAll(".ac-move-desc-loading[data-pokeapi-move-desc]").forEach((el) => {
      const row = el.closest(".ac-move-item[data-idx]");
      const idx = safeInt(row?.dataset?.idx, -1);
      const move = moves?.[idx];
      if (!move) return;
      fetchPokeApiMoveDescriptionPt(move).then((desc) => {
        if (!desc || !el.isConnected) return;
        el.textContent = desc;
        el.classList.remove("ac-move-desc-loading");
      }).catch(() => {});
    });
  }

  _publishAttackTargetModeState() {
    const mode = this._attackTargetMode || null;
    if (!mode?.attackerPiece) {
      try { window.__arenaAttackTargetMode = null; } catch {}
      try { window.requestArenaRefresh?.(true); } catch {}
      return;
    }
    try {
      window.__arenaAttackTargetMode = {
        active: true,
        attackerPieceId: safeStr(mode.attackerPiece?.id),
        attackerOwner: safeStr(mode.attackerPiece?.owner),
        moveName: safeStr(mode.move?.name),
        kind: safeStr(mode.targeting?.kind),
        rangeStr: safeStr(mode.targeting?.rangeStr),
      };
      window.requestArenaRefresh?.(true);
    } catch {}
  }

  _armAttackTargetMode(config) {
    this._attackTargetMode = config || null;
    this._publishAttackTargetModeState();
    this._closeOverlay();
    this._closePrompt();
    if (!this._attackTargetMode?.attackerPiece) return;
    const targeting = this._attackTargetMode.targeting || {};
    const pos = this._pieceScreenPos(this._attackTargetMode.attackerPiece);
    const el = document.createElement("div");
    el.className = "ac-prompt";
    const cpos = this._clampPos(pos.x + 42, pos.y - 36, 282, 155);
    el.style.left = `${cpos.x}px`;
    el.style.top = `${cpos.y}px`;
    el.innerHTML = `
      <div style="font-weight:900;margin-bottom:6px">Escolha o alvo</div>
      <div style="font-size:12px;color:rgba(226,232,240,.86);line-height:1.35;margin-bottom:10px">
        ${targetIconHtml(targeting.kind === "area" ? "area" : targeting.kind === "melee" ? "melee" : "ranged")}
        ${escHtml(safeStr(this._attackTargetMode.move?.name) || "Golpe")} - ${escHtml(targeting.label || "")}
        ${targeting.defenseLabel ? `<br><span style="color:rgba(148,163,184,.9)">${escHtml(targeting.defenseLabel)}</span>` : ""}
      </div>
      <button class="ac-quick-btn" id="ac-cancel-target-mode" style="width:100%">Cancelar</button>
    `;
    this._overlayRoot.appendChild(el);
    this._currentPrompt = el;
    el.querySelector("#ac-cancel-target-mode")?.addEventListener("click", () => {
      this._attackTargetMode = null;
      this._publishAttackTargetModeState();
      this._closePrompt();
    });
    this._showFloat(this._attackTargetMode.attackerPiece, "Escolha o alvo", "pending");
  }

  async _executeAttackTargetMode(targetPiece) {
    const mode = this._attackTargetMode;
    if (!mode || !targetPiece) return;
    if (this._isMine(targetPiece)) {
      this._showFloat(targetPiece, "Alvo invalido", "miss");
      return;
    }
    this._attackTargetMode = null;
    this._publishAttackTargetModeState();
    this._closePrompt();
    const targeting = mode.targeting || this._moveTargetingInfo(mode.move, mode.powerRule);
    if (targeting.kind === "area" || targeting.rangeStr === "area") {
      await this._launchAreaAttack(mode.atkPid, targetPiece, mode.move, mode.stats, {
        moveIdx: mode.moveIdx,
        powerRule: mode.powerRule,
      });
      return;
    }
    await this._executeAttack(mode.atkPid, targetPiece, mode.move, mode.stats, targeting.rangeStr || "distance", {
      sneakAttack: false,
      moveIdx: mode.moveIdx,
      powerRule: mode.powerRule,
    });
  }

  _bindCanvasClick() {
    const canvas = document.getElementById("arena");
    if (!canvas) return;

    const _isMine = (piece) => {
      const owner = safeStr(piece?.owner).toLowerCase();
      const by = safeStr(this.getBy?.()).toLowerCase();
      return !!owner && !!by && owner === by;
    };

    const _getEnemyPieces = (ev) => {
      if (window.appState?.placingPid) return null;
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const tile = window.screenToTile?.(x, y);
      if (!tile) return null;
      const all = (window.getPiecesAt?.(tile.row, tile.col) || []).filter(Boolean);
      if (!all.length) return null;
      const by = safeStr(this.getBy?.()).toLowerCase();
      const role = this.getRole();
      const canStartCombat = !!window.canCurrentPlayerStartCombat?.();
      const canStartCombatOffTurn = !canStartCombat && !!window.canCurrentPlayerStartCombat?.({ ignoreTurn: true });
      const isPlayer = (role === "owner" || role === "challenger" || role === "gm" || canStartCombat || canStartCombatOffTurn);
      if (!isPlayer || (!canStartCombat && !canStartCombatOffTurn)) return null;
      return all.filter((piece) => {
        const owner = safeStr(piece.owner).toLowerCase();
        return !!owner && owner !== by;
      });
    };

    canvas.addEventListener("click", (ev) => {
      if (window.appState?.drag?.justDropped) return;
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const tile = window.screenToTile?.(x, y);
      if (!tile) return;
      const piecesOnTile = (window.getPiecesAt?.(tile.row, tile.col) || []).filter(Boolean);
      if (this._attackTargetMode) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        const by = safeStr(this.getBy?.()).toLowerCase();
        const enemies = piecesOnTile.filter((piece) => {
          const owner = safeStr(piece?.owner).toLowerCase();
          if (!owner || owner === by) return false;
          if (safeStr(piece?.status || "active") !== "active") return false;
          try {
            if (typeof window.isPieceVisibleToMe === "function" && !window.isPieceVisibleToMe(piece)) return false;
          } catch {}
          return true;
        });
        if (!enemies.length) {
          this._showFloat(this._attackTargetMode.attackerPiece, "Clique em um alvo inimigo", "miss");
          return;
        }
        if (enemies.length === 1) {
          this._executeAttackTargetMode(enemies[0]);
          return;
        }
        const mode = this._attackTargetMode;
        this._showPieceChoiceMenu(enemies, ev.clientX, ev.clientY, {
          title: "Escolha o alvo do golpe",
          onSelect: (piece) => {
            this._attackTargetMode = mode;
            this._executeAttackTargetMode(piece);
          },
        });
        this._attackTargetMode = mode;
        return;
      }
      if (piecesOnTile.some(_isMine)) return;
      const enemies = _getEnemyPieces(ev);
      if (!Array.isArray(enemies) || enemies.length === 0) return;
      ev.stopPropagation();
      if (enemies.length === 1) {
        window.selectPiece?.(safeStr(enemies[0].id));
        return;
      }
      this._showPieceChoiceMenu(
        enemies,
        ev.clientX,
        ev.clientY,
        {
          title: "Há mais de uma peça aqui. Com qual deseja interagir?",
          onSelect: (piece) => {
            this._closeAll();
            window.selectPiece?.(safeStr(piece.id));
          },
        },
      );
    }, true);
  }

  _bindContextMenu() {
    const canvas = document.getElementById("arena");
    if (!canvas) return;

    const _isMine = (piece) => {
      const owner = safeStr(piece?.owner).toLowerCase();
      const by = safeStr(this.getBy?.()).toLowerCase();
      return !!owner && !!by && owner === by;
    };

    canvas.addEventListener("contextmenu", (ev) => {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const tile = window.screenToTile?.(x, y);
      if (!tile) return;

      const wrapRect = this.container.getBoundingClientRect();
      const cx = ev.clientX - wrapRect.left;
      const cy = ev.clientY - wrapRect.top;
      const piecesOnTile = (window.getPiecesAt?.(tile.row, tile.col) || []).filter(Boolean);
      const interactable = piecesOnTile.filter(Boolean);
      const mine = interactable.filter((piece) => _isMine(piece));
      if (mine.length > 0) return;
      const enemies = interactable.filter((piece) => !_isMine(piece));
      if (enemies.length === 0) return;

      ev.preventDefault();
      ev.stopImmediatePropagation();
      this._closeAll();

      return;

      this._showPieceChoiceMenu(enemies, ev.clientX, ev.clientY, {
        title: "Escolha uma peça para abrir as ações",
        onSelect: (piece) => this._showContextMenu(piece, tile, cx, cy),
      });
    }, true);
  }

  _showPieceChoiceMenu(pieces, clientX, clientY, opts = {}) {
    const list = Array.isArray(pieces) ? pieces.filter(Boolean) : [];
    if (!list.length) return;
    if (list.length === 1) {
      opts?.onSelect?.(list[0]);
      return;
    }

    this._closeAll();

    const title = safeStr(opts.title) || "Escolha o pokémon";
    const wrapRect = this.container.getBoundingClientRect();
    const x = clientX - wrapRect.left;
    const y = clientY - wrapRect.top;

    const el = document.createElement("div");
    el.className = "ac-context";
    el.innerHTML = [
      `<div class="ac-ctx-title">${escHtml(title)}</div>`,
      ...list.map((piece) => {
        const name = pieceBattleLabel(piece);
        const owner = safeStr(piece.owner) || "sem dono";
        return `<div class="ac-ctx-item" data-piece-id="${escHtml(safeStr(piece.id))}"><span class="ac-ctx-icon">🎯</span>${escHtml(name)}<span class="ac-ctx-meta">${escHtml(owner)}</span></div>`;
      }),
    ].join("");

    const pos = this._clampPos(x, y, 260, 44 + list.length * 36);
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    this._overlayRoot.appendChild(el);
    this._currentContext = el;

    el.querySelectorAll(".ac-ctx-item[data-piece-id]").forEach((itemEl) => {
      itemEl.addEventListener("click", () => {
        const id = safeStr(itemEl.dataset.pieceId);
        const picked = list.find((piece) => safeStr(piece.id) === id) || null;
        if (!picked) return;
        this._closeContext();
        opts?.onSelect?.(picked);
      });
    });

    const closeHandler = (e) => {
      if (!el.contains(e.target)) {
        this._closeContext();
        document.removeEventListener("click", closeHandler, true);
      }
    };
    setTimeout(() => document.addEventListener("click", closeHandler, true), 10);
  }

  _showContextMenu(piece, tile, x, y) {
    const by = this.getBy();
    const role = this.getRole();
    const canStartCombat = !!window.canCurrentPlayerStartCombat?.();
    const canStartCombatOffTurn = !canStartCombat && !!window.canCurrentPlayerStartCombat?.({ ignoreTurn: true });
    const isPlayer = (role === "owner" || role === "challenger" || role === "gm" || canStartCombat || canStartCombatOffTurn);
    const el = document.createElement("div");
    el.className = "ac-context";

    let items = [];

    if (piece) {
      const owner = safeStr(piece.owner);
      const isEnemy = owner && by && owner.toLowerCase() !== by.toLowerCase();
      const isMine  = owner && by && owner.toLowerCase() === by.toLowerCase();
      const name = pieceBattleLabel(piece);

      if (isEnemy && isPlayer && canStartCombat) {
        items.push({ icon: "⚔️", label: `Atacar ${name}`, action: () => { this._closeAll(); this._openAttackOverlay(piece, x, y); } });
        if (this._lastMove) {
          items.push({ icon: "🔄", label: `Repetir: ${this._lastMove.moveName}`, kbd: "", action: () => { this._closeAll(); this._executeRepeatOnTarget(piece); } });
        }
        items.push({ icon: "🌀", label: "Ataque em Área", action: () => { this._closeAll(); this._openAttackOverlay(piece, x, y, "area"); } });
        items.push({ type: "sep" });
      }

      if (isEnemy && isPlayer && canStartCombatOffTurn) {
        items.push({ icon: "⚠️", label: "Ataque fora do turno", action: () => { this._closeAll(); this._openAttackOverlay(piece, x, y); } });
        items.push({ type: "sep" });
      }

      if (isMine) {
        const pieceId = safeStr(piece.id);
        const isRevealed = !!piece.revealed;
        items.push({ icon: "🎯", label: "Selecionar peça", action: () => { this._closeAll(); window.selectPiece?.(pieceId); } });
        items.push({
          icon: isRevealed ? "🙈" : "👁️",
          label: isRevealed ? "Ocultar peça" : "Revelar peça",
          action: () => { this._closeAll(); window.togglePieceRevealed?.(pieceId); },
        });
        items.push({ icon: "💔", label: "Reduzir 1 HP", action: () => { this._closeAll(); window.handlePieceMenuAction?.("hp-down", pieceId); } });
        items.push({ icon: "❌", label: "Retirar da arena", action: () => { this._closeAll(); window.removePieceFromBoard?.(pieceId); } });
        items.push({ type: "sep" });
        items.push({ icon: "📋", label: `Ver ficha de ${name}`, action: () => { this._closeAll(); this._viewSheet(piece); } });
      }
    } else if (isPlayer && window.appState?.selectedPieceId) {
      items.push({ icon: "🚶", label: `Mover para (${tile.row}, ${tile.col})`, action: () => { this._closeAll(); } });
    }

    if (!items.length) return;

    el.innerHTML = items.map(it => {
      if (it.type === "sep") return `<div class="ac-ctx-sep"></div>`;
      return `<div class="ac-ctx-item"><span class="ac-ctx-icon">${it.icon}</span>${escHtml(it.label)}${it.kbd ? `<span class="ac-ctx-kbd">${it.kbd}</span>` : ""}</div>`;
    }).join("");

    const pos = this._clampPos(x, y, 200, items.length * 36);
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    this._overlayRoot.appendChild(el);
    this._currentContext = el;

    let idx = 0;
    el.querySelectorAll(".ac-ctx-item").forEach(itemEl => {
      while (idx < items.length && items[idx].type === "sep") idx++;
      if (idx >= items.length) return;
      const action = items[idx].action;
      itemEl.addEventListener("click", () => { if (action) action(); });
      idx++;
    });

    const closeHandler = (e) => {
      if (!el.contains(e.target)) {
        this._closeContext();
        document.removeEventListener("click", closeHandler, true);
      }
    };
    setTimeout(() => document.addEventListener("click", closeHandler, true), 10);
  }

  _bindKeyboard() {
    if (this._kbBound) return;
    this._kbBound = true;
    document.addEventListener("keydown", (ev) => {
      const tag = (ev.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") {
        if (ev.key !== "Escape") return;
      }
      if (ev.key === "Escape") {
        if (this._currentOverlay || this._currentRadial || this._currentPrompt || this._currentContext || this._currentReroll) {
          ev.preventDefault();
          this._closeAll();
        }
        return;
      }
      if (this._currentReroll) {
        if (ev.key === "r" || ev.key === "R") { ev.preventDefault(); this._doReroll(); return; }
        if (ev.key === "Enter") { ev.preventDefault(); this._keepRoll(); return; }
      }
      if (ev.key === "/" && this._currentOverlay) {
        const search = this._currentOverlay.querySelector(".ac-search");
        if (search) { ev.preventDefault(); search.focus(); }
      }
    });
  }

  async _openAttackOverlay(targetPiece, x, y, forceMode = null) {
    this._closeOverlay();

    const by = this.getBy();
    await this._loadSheets(by);

    const pieces = this.getPieces() || [];
    const myPieces = pieces.filter(p =>
      safeStr(p.owner) === by && safeStr(p.kind) !== "trainer" && safeStr(p.pid) && safeStr(p.status || "active") === "active"
    );

    const tPid = safeStr(targetPiece.pid);
    const tOwner = safeStr(targetPiece.owner);
    const tName = pieceBattleLabel(targetPiece);
    const tMeta = pieceBattleMetaLine(targetPiece);
    const _tPs = ((this._partyStates && this._partyStates[tOwner]) ? this._partyStates[tOwner] : {})[tPid] || {};
    const tSprite = effectiveSpriteUrl(tOwner, targetPiece, { type: "battle", shiny: !!_tPs.shiny });

    const el = document.createElement("div");
    el.className = "ac-overlay";

    el.innerHTML = `
      <div class="ac-overlay-header">
        <img class="ac-overlay-sprite" src="${escHtml(tSprite)}" alt="${escHtml(tName)}" onerror="this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'" />
        <div>
          <div class="ac-overlay-name">${escHtml(tName)}</div>
          <div class="ac-overlay-sub">${escHtml(tMeta || tOwner || tName)}</div>
        </div>
        <button class="ac-overlay-close" title="Fechar (Esc)">✕</button>
      </div>
      <div id="ac-overlay-body"></div>
    `;

    const pos = this._clampPos(x + 10, y - 20, 300, 400);
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;

    this._overlayRoot.appendChild(el);
    this._currentOverlay = el;

    el.querySelector(".ac-overlay-close").addEventListener("click", () => this._closeOverlay());

    const closeHandler = (e) => {
      if (!el.contains(e.target) && !e.target.closest(".ac-radial")) {
        this._closeOverlay();
        document.removeEventListener("mousedown", closeHandler, true);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", closeHandler, true), 50);

    const body = el.querySelector("#ac-overlay-body");
    this._buildOverlayBody(body, targetPiece, myPieces, forceMode);
  }

  _buildOverlayBody(body, targetPiece, myPieces, forceMode) {
    const by = this.getBy();

    let atkHtml = "";
    if (myPieces.length === 1) {
      const p = myPieces[0];
      atkHtml = `<div style="font-size:11px;color:rgba(148,163,184,.7);margin-bottom:6px">Atacante: <strong style="color:rgba(226,232,240,.9)">${escHtml(pieceBattleLabel(p))}</strong></div>`;
    } else if (myPieces.length > 1) {
      atkHtml = `<select class="ac-search" id="ac-atk-select" style="margin-bottom:8px">
        ${myPieces.map(p => {
          const pid = safeStr(p.pid);
          return `<option value="${escHtml(pid)}">${escHtml(pieceBattleLabel(p))}</option>`;
        }).join("")}
      </select>`;
    }

    const rangeHtml = `
      <div class="ac-range-row">
        <button class="ac-range-btn ac-active" data-range="distance">🏹 Distância (Dodge)</button>
        <button class="ac-range-btn" data-range="melee">⚔️ Melee (Parry)</button>
        <button class="ac-range-btn" data-range="area">🌀 Área (Dodge CD)</button>
      </div>
    `;

    body.innerHTML = `
      ${atkHtml}
      ${rangeHtml}
      <div style="display:flex;align-items:center;gap:8px;margin:8px 0 10px;padding:8px 10px;border-radius:10px;background:rgba(168,85,247,.10);border:1px solid rgba(168,85,247,.28)">
        <input type="checkbox" id="ac-sneak-attack" style="accent-color:#a855f7;width:16px;height:16px;cursor:pointer" />
        <label for="ac-sneak-attack" style="font-size:12px;font-weight:700;cursor:pointer;color:rgba(226,232,240,.9)">🥷 Furtivo <span style="font-weight:400;color:rgba(148,163,184,.9)">(oponente usa def/2)</span></label>
      </div>
      <div id="ac-moves-area"></div>
    `;

    const getSneakAttack = () => !!body.querySelector("#ac-sneak-attack")?.checked;

    let currentRange = "distance";
    body.querySelectorAll(".ac-range-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        currentRange = btn.dataset.range;
        body.querySelectorAll(".ac-range-btn").forEach(b => b.classList.toggle("ac-active", b === btn));
      });
    });

    const getAtkPid = () => {
      if (myPieces.length === 1) return safeStr(myPieces[0].pid);
      const sel = body.querySelector("#ac-atk-select");
      return sel ? sel.value : (myPieces[0] ? safeStr(myPieces[0].pid) : "");
    };

    const loadMoves = () => {
      const atkPid = getAtkPid();
      const sheet = this._getSheet(by, atkPid);
      const moves = sheet?.moves || [];
      const stats = this._getEffectiveStats(by, atkPid);
      const favorites = this._getFavorites(by, atkPid);

      const movesArea = body.querySelector("#ac-moves-area");

      const favMoves = favorites.length > 0
        ? favorites.map(name => moves.find(m => safeStr(m.name) === name)).filter(Boolean)
        : [];

      if (favMoves.length >= 3 && !forceMode) {
        movesArea.innerHTML = `
          <div class="ac-quick-actions">
            <button class="ac-quick-btn" id="ac-open-radial">🎯 Favoritos (${favMoves.length})</button>
            <button class="ac-quick-btn" id="ac-open-list">📋 Todos os Golpes</button>
            <button class="ac-quick-btn" id="ac-open-manual">✍️ Input manual</button>
          </div>
        `;
        movesArea.querySelector("#ac-open-radial")?.addEventListener("click", () => {
          this._openRadialMenu(targetPiece, favMoves, moves, stats, getAtkPid, currentRange, getSneakAttack);
        });
        movesArea.querySelector("#ac-open-list")?.addEventListener("click", () => {
          this._renderMoveList(movesArea, moves, stats, targetPiece, getAtkPid, () => currentRange, getSneakAttack);
        });
        movesArea.querySelector("#ac-open-manual")?.addEventListener("click", () => {
          this._openManualInputDialog(targetPiece, getAtkPid(), currentRange, getSneakAttack());
        });
      } else {
        this._renderMoveList(movesArea, moves, stats, targetPiece, getAtkPid, () => currentRange, getSneakAttack);
      }
    };

    body.querySelector("#ac-atk-select")?.addEventListener("change", loadMoves);
    loadMoves();
  }

  _renderMoveList(container, moves, stats, targetPiece, getAtkPid, getRange, getSneakAttack = () => false) {
    const by = this.getBy();
    const atkPid = getAtkPid();
    const atkSheet = this._getSheet(by, atkPid);
    let html = `<input class="ac-search" placeholder="/ buscar golpe..." id="ac-move-search" />`;
    html += `<button class="ac-quick-btn" id="ac-manual-input" style="width:100%;margin-bottom:6px">✍️ Input manual</button>`;
    html += `<div class="ac-movelist" id="ac-movelist-inner">`;

    html += `<div class="ac-move-item" data-mode="area">
      <span style="font-size:14px">🌀</span>
      <span class="ac-move-name">Ataque em Área</span>
      <span class="ac-move-meta">Dodge CD</span>
    </div>`;

    moves.forEach((mv, i) => {
      const name = safeStr(mv.name) || "Golpe";
      const cat = safeStr(mv.meta?.category || mv.category || "").toLowerCase();
      const icon = cat.includes("status") ? "🟣" : cat.includes("special") || cat.includes("especial") ? "🔵" : "🔴";
      
      const moveData = getMoveData(mv, getMoveTempMods(atkPid, i, atkSheet));
      const ctx = this._calcMoveContext(mv, stats, by, atkPid, targetPiece.owner, targetPiece.pid, {
        moveIdx: i,
        atkSheet,
        moveData,
      });
      const aceiroBonus = safeInt(stats.acerto || 0);
      const acc = ctx.atkMod + aceiroBonus;
      const modeInfo = (typeof window.getMoveModeInfo === "function") ? (window.getMoveModeInfo(mv) || null) : null;
      const modeText = safeStr(modeInfo?.label || `Acerto ${acc}`) || `Acerto ${acc}`;
      const extraTxt = (ctx.typeBonus !== 0 || ctx.stabBonus > 0) ? ` (+)` : ``;
      const dmgClass = (ctx.typeBonus > 0 || ctx.stabBonus > 0) ? "bonus-high" : "";

      html += `<div class="ac-move-item" data-idx="${i}">
        <span style="font-size:14px">${icon}</span>
        <span class="ac-move-name">${escHtml(name)}</span>
        <span class="ac-move-meta">${escHtml(modeText)} • R${ctx.rank}</span>
        <span class="ac-move-dmg ${dmgClass}">${ctx.totalDmg}${extraTxt}</span>
      </div>`;
    });

    if (!moves.length) {
      html += `<div style="padding:12px;text-align:center;color:rgba(148,163,184,.5);font-size:12px">Nenhum golpe encontrado.</div>`;
    }

    html += `</div>`;
    container.innerHTML = html;
    if (getRange() === "area") {
      container.querySelector('.ac-move-item[data-mode="area"]')?.remove();
    }

    const searchInput = container.querySelector("#ac-move-search");
    searchInput?.addEventListener("input", () => {
      const q = searchInput.value.toLowerCase();
      container.querySelectorAll(".ac-move-item[data-idx]").forEach(el => {
        const name = el.querySelector(".ac-move-name")?.textContent?.toLowerCase() || "";
        el.style.display = name.includes(q) ? "" : "none";
      });
    });

    container.querySelectorAll(".ac-move-item[data-idx]").forEach(el => {
      el.addEventListener("click", async () => {
        const idx = parseInt(el.dataset.idx);
        const mv = moves[idx];
        if (!mv) return;
        const powerRule = await getPowerRuleForMove({ ...mv, _move_idx: idx });
        if (isSelfPowerRule(powerRule) || (hasResolvableImmediateEffects(powerRule) && safeStr(powerRule?.targeting?.mode) === "self")) {
          await this._executeImmediatePower(getAtkPid(), mv, stats, { moveIdx: idx, powerRule });
          return;
        }
        if (getRange() === "area") {
          this._launchAreaAttack(getAtkPid(), targetPiece, mv, stats, {
            moveIdx: idx,
            powerRule,
          });
          return;
        }
        this._executeAttack(getAtkPid(), targetPiece, mv, stats, getRange(), {
          sneakAttack: getSneakAttack(),
          moveIdx: idx,
          powerRule,
        });
      });
    });

    container.querySelector('.ac-move-item[data-mode="area"]')?.addEventListener("click", () => {
      this._openAreaDialog(targetPiece, getAtkPid());
    });

    container.querySelector("#ac-manual-input")?.addEventListener("click", () => {
      this._openManualInputDialog(targetPiece, getAtkPid(), getRange(), getSneakAttack());
    });
  }

  _isEffectMove(move) {
    const category = safeStr(move?.meta?.category || move?.category || "").toLowerCase();
    return category.includes("status") || move?.meta?.is_effect === true;
  }

  _openAreaDialog(targetPiece, atkPid, defaults = {}) {
    this._closeOverlay();
    const pos = this._pieceScreenPos(targetPiece);
    const el = document.createElement("div");
    el.className = "ac-prompt";
    const cpos = this._clampPos(pos.x + 30, pos.y - 50, 260, 200);
    el.style.left = `${cpos.x}px`;
    el.style.top = `${cpos.y}px`;

    el.innerHTML = `
      <div class="ac-prompt-title">🌀 Ataque em Área</div>
      <div style="margin-bottom:8px">
        <label style="font-size:11px;color:rgba(148,163,184,.7)">Nível do Efeito / Dano</label>
        <input class="ac-search" id="ac-area-level" type="number" value="${safeInt(defaults.level, 1)}" min="1" style="margin-top:4px" />
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
        <input type="checkbox" id="ac-area-effect" ${defaults.isEffect ? "checked" : ""} />
        <label for="ac-area-effect" style="font-size:12px;font-weight:700;color:rgba(226,232,240,.85)">É Efeito? (Affliction)</label>
      </div>
      <button class="ac-prompt-btn ac-wide" id="ac-area-launch">🚀 Lançar Área</button>
    `;

    this._overlayRoot.appendChild(el);
    this._currentPrompt = el;

    el.querySelector("#ac-area-launch").addEventListener("click", async () => {
      const btn = el.querySelector("#ac-area-launch");
      btn.disabled = true; btn.textContent = "⏳...";

      const lvl = safeInt(el.querySelector("#ac-area-level").value, 1);
      const isEff = el.querySelector("#ac-area-effect").checked;
      const by = this.getBy();
      const tId = safeStr(targetPiece.id);
      const tOwner = safeStr(targetPiece.owner);
      const tPid = safeStr(targetPiece.pid);

      const ref = this._battleRef();
      if (!ref) return;

      await this._writeBattle({
        status: "aoe_defense",
        attacker: by,
        attacker_pid: atkPid,
        target_id: tId,
        target_owner: tOwner,
        target_pid: tPid,
        aoe_dc: lvl + 10,
        dmg_base: lvl,
        is_effect: isEff,
        aoe_source: true,
        last_attack_outcome: "area_pending",
        secondary_available: false,
        secondary_active: false,
        pendingFor: tOwner,
        prompt: { type: "ROLL_RESIST", options: { dc: lvl + 10, isEffect: isEff, isAoe: true, aoePhase: "dodge" } },
        logs: [`${by} lançou Área (Rank ${lvl}). Defensor rola Dodge obrigatório (CD ${lvl + 10}).`],
      });

      this._showFloat(targetPiece, `🌀 Área Nv${lvl} — CD ${lvl + 10}`, "pending");
      this._closePrompt();
    });
  }

  _openManualInputDialog(targetPiece, atkPid, rangeStr, sneakAttack = false) {
    this._closeOverlay();
    const pos = this._pieceScreenPos(targetPiece);
    const el = document.createElement("div");
    el.className = "ac-prompt";
    const cpos = this._clampPos(pos.x + 30, pos.y - 50, 280, 260);
    el.style.left = `${cpos.x}px`;
    el.style.top = `${cpos.y}px`;

    el.innerHTML = `
      <div class="ac-prompt-title">✍️ Input manual</div>
      <div style="display:grid;gap:8px;margin-bottom:10px">
        <label style="font-size:11px;color:rgba(148,163,184,.7)">Acerto (Accuracy)
          <input class="ac-search" id="ac-manual-acc" type="number" value="0" style="margin-top:4px" />
        </label>
        <label style="font-size:11px;color:rgba(148,163,184,.7)">Rank
          <input class="ac-search" id="ac-manual-rank" type="number" value="1" min="1" style="margin-top:4px" />
        </label>
        <label style="font-size:11px;color:rgba(148,163,184,.7)">Tipo
          <select class="ac-search" id="ac-manual-type" style="margin-top:4px">
            <option value="damage">Dano</option>
            <option value="effect">Affliction</option>
          </select>
        </label>
      </div>
      <button class="ac-prompt-btn ac-wide" id="ac-manual-send">✅ Confirmar</button>
    `;

    this._overlayRoot.appendChild(el);
    this._currentPrompt = el;

    el.querySelector("#ac-manual-send")?.addEventListener("click", async () => {
      const acc = safeInt(el.querySelector("#ac-manual-acc")?.value, 0);
      const rank = Math.max(1, safeInt(el.querySelector("#ac-manual-rank")?.value, 1));
      const manualType = safeStr(el.querySelector("#ac-manual-type")?.value) || "damage";
      const isEffect = manualType === "effect";

      if (rangeStr === "area") {
        const by = this.getBy();
        const tId = safeStr(targetPiece.id);
        const tOwner = safeStr(targetPiece.owner);
        const tPid = safeStr(targetPiece.pid);

        await this._writeBattle({
          status: "aoe_defense",
          attacker: by,
          attacker_pid: atkPid,
          target_id: tId,
          target_owner: tOwner,
          target_pid: tPid,
          aoe_dc: rank + 10,
          dmg_base: rank,
          is_effect: isEffect,
          aoe_source: true,
          last_attack_outcome: "area_pending",
          secondary_available: false,
          secondary_active: false,
          pendingFor: tOwner,
          prompt: { type: "ROLL_RESIST", options: { dc: rank + 10, isEffect, isAoe: true, aoePhase: "dodge" } },
          logs: [`${by} lançou Área manual (Rank ${rank}, Acc ${acc}). Defensor rola Dodge obrigatório (CD ${rank + 10}).`],
        });
        this._showFloat(targetPiece, `🌀 Área Nv${rank} — CD ${rank + 10}`, "pending");
        this._closePrompt();
        return;
      }

      const manualMove = {
        name: `Input Manual (${isEffect ? "Affliction" : "Dano"})`,
        accuracy: acc,
        rank,
        meta: { category: isEffect ? "Status" : "Physical", is_effect: isEffect },
      };

      this._closePrompt();
      await this._executeAttack(atkPid, targetPiece, manualMove, {}, rangeStr || "distance", { sneakAttack });
    });
  }

  _promptExtraAttackModifiers(move, options = {}) {
    this._closeOverlay();
    this._closeRadial();
    this._closePrompt();

    return new Promise((resolve) => {
      const moveName = safeStr(move?.name) || "Golpe";
      const allowAccuracy = options.allowAccuracy !== false;
      const allowDamage = options.allowDamage !== false;
      const introText = safeStr(options.introText)
        || `Ajuste bônus ou penalidades manuais para ${moveName}. Se não houver modificadores extras, confirme abaixo e o combate continua normalmente.`;
      const backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop";
      backdrop.setAttribute("role", "dialog");
      backdrop.setAttribute("aria-modal", "true");
      backdrop.setAttribute("aria-labelledby", "ac_extra_mod_title");
      backdrop.innerHTML = `
        <div class="modal-box">
          <div class="modal-header">
            <span id="ac_extra_mod_title">⚖️ Modificadores extras</span>
            <button class="btn ghost modal-close" type="button" id="ac-extra-mod-close" title="Fechar">✕</button>
          </div>
          <div class="modal-body">
            <p class="modal-hint">
              Ajuste bônus ou penalidades manuais para <strong>${escHtml(moveName)}</strong>.
              Se não houver modificadores extras, confirme abaixo e o combate continua normalmente.
            </p>
            <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
              <label style="display:grid;gap:4px;font-size:12px;font-weight:700;color:rgba(226,232,240,.9)">
                Mod. de Acerto
                <input class="ac-search" id="ac-extra-acc" type="number" value="0" />
                <span style="font-size:11px;font-weight:400;color:rgba(148,163,184,.85)">Use valores positivos ou negativos.</span>
              </label>
              <label style="display:grid;gap:4px;font-size:12px;font-weight:700;color:rgba(226,232,240,.9)">
                Mod. de Dano
                <input class="ac-search" id="ac-extra-dmg" type="number" value="0" />
                <span style="font-size:11px;font-weight:400;color:rgba(148,163,184,.85)">Será somado ou subtraído do rank final.</span>
              </label>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn secondary" type="button" id="ac-extra-mod-none">Sem modificadores</button>
            <button class="btn secondary" type="button" id="ac-extra-mod-confirm">Aplicar e continuar</button>
            <button class="btn ghost" type="button" id="ac-extra-mod-cancel">Cancelar</button>
          </div>
        </div>
      `;
      const hintEl = backdrop.querySelector(".modal-hint");
      if (hintEl) hintEl.textContent = introText;

      const accField = backdrop.querySelector("#ac-extra-acc")?.closest("label");
      const dmgField = backdrop.querySelector("#ac-extra-dmg")?.closest("label");
      if (!allowAccuracy) accField?.remove();
      if (!allowDamage) dmgField?.remove();

      const fieldsGrid = backdrop.querySelector(".modal-body > div");
      if (fieldsGrid && (!allowAccuracy || !allowDamage)) {
        fieldsGrid.style.gridTemplateColumns = "minmax(0,1fr)";
      }

      const readMods = () => ({
        acc: allowAccuracy ? safeInt(backdrop.querySelector("#ac-extra-acc")?.value, 0) : 0,
        dmg: allowDamage ? safeInt(backdrop.querySelector("#ac-extra-dmg")?.value, 0) : 0,
      });

      backdrop._acOnClose = (result = null) => resolve(result);
      document.body.appendChild(backdrop);
      this._currentPrompt = backdrop;

      const firstInput = backdrop.querySelector("#ac-extra-acc") || backdrop.querySelector("#ac-extra-dmg");
      firstInput?.focus();
      firstInput?.select();

      backdrop.querySelector("#ac-extra-mod-close")?.addEventListener("click", () => this._closePrompt(null));
      backdrop.querySelector("#ac-extra-mod-cancel")?.addEventListener("click", () => this._closePrompt(null));
      backdrop.querySelector("#ac-extra-mod-none")?.addEventListener("click", () => this._closePrompt({ acc: 0, dmg: 0 }));
      backdrop.querySelector("#ac-extra-mod-confirm")?.addEventListener("click", () => this._closePrompt(readMods()));

      backdrop.addEventListener("click", (ev) => {
        if (ev.target === backdrop) this._closePrompt(null);
      });
      backdrop.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          this._closePrompt(readMods());
        }
      });
    });
  }

  _openRadialMenu(targetPiece, favMoves, allMoves, stats, getAtkPid, currentRange, getSneakAttack = () => false) {
    this._closeRadial();

    const pos = this._pieceScreenPos(targetPiece);
    const el = document.createElement("div");
    el.className = "ac-radial";
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;

    const tPid = safeStr(targetPiece.pid);
    const _tOwnerRadial = safeStr(targetPiece.owner);
    const _tPsRadial = ((this._partyStates && this._partyStates[_tOwnerRadial]) ? this._partyStates[_tOwnerRadial] : {})[tPid] || {};
    const tLabel = pieceBattleLabel(targetPiece);
    const tSprite = effectiveSpriteUrl(_tOwnerRadial, targetPiece, { type: "battle", shiny: !!_tPsRadial.shiny });
    el.innerHTML = `
      <div class="ac-radial-center" title="${escHtml(tLabel)}">
        <img src="${escHtml(tSprite)}" alt="" onerror="this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'" />
      </div>
    `;

    const radius = 90;
    const slotCount = Math.min(favMoves.length + 2, 8);
    const totalSlots = slotCount;

    const displayMoves = [...favMoves.slice(0, 6)];
    const by = this.getBy();
    const atkPid = getAtkPid();
    const atkSheet = this._getSheet(by, atkPid);

    for (let i = 0; i < totalSlots; i++) {
      const angle = (i / totalSlots) * 2 * Math.PI - Math.PI / 2;
      const sx = Math.cos(angle) * radius;
      const sy = Math.sin(angle) * radius;

      const slot = document.createElement("div");
      slot.className = "ac-radial-slot";
      slot.style.left = `${sx}px`;
      slot.style.top = `${sy}px`;

      if (i < displayMoves.length) {
        const mv = displayMoves[i];
        const moveIdx = resolveMoveIndex(allMoves, mv);
        const moveData = getMoveData(mv, getMoveTempMods(atkPid, moveIdx, atkSheet));
        const ctx = this._calcMoveContext(mv, stats, by, atkPid, targetPiece.owner, targetPiece.pid, {
          moveIdx,
          atkSheet,
          moveData,
        });
        const cat = safeStr(mv.meta?.category || mv.category || "").toLowerCase();
        const icon = cat.includes("status") ? "🟣" : cat.includes("special") || cat.includes("especial") ? "🔵" : "🔴";

        const slotAcc = ctx.atkMod + safeInt(stats.acerto || 0);
        const slotModeInfo = (typeof window.getMoveModeInfo === "function") ? (window.getMoveModeInfo(mv) || null) : null;
        const slotModeLabel = safeStr(slotModeInfo?.compactLabel || slotModeInfo?.label || `Ac ${slotAcc}`) || `Ac ${slotAcc}`;
        slot.innerHTML = `
          <span class="ac-slot-icon">${icon}</span>
          <span class="ac-slot-name">${escHtml(safeStr(mv.name).slice(0, 10))}</span>
          <span class="ac-slot-sub">${escHtml(slotModeLabel)} • R${ctx.rank}</span>
        `;
        slot.title = `${safeStr(mv.name)} - ${safeStr(slotModeInfo?.label || `Acerto ${slotAcc}`)}, Rank ${ctx.rank}, Dano ${ctx.totalDmg}`;
        slot.addEventListener("click", async () => {
          this._closeRadial();
          this._closeOverlay();
          const powerRule = await getPowerRuleForMove({ ...mv, _move_idx: moveIdx });
          if (isSelfPowerRule(powerRule) || (hasResolvableImmediateEffects(powerRule) && safeStr(powerRule?.targeting?.mode) === "self")) {
            await this._executeImmediatePower(getAtkPid(), mv, stats, { moveIdx, powerRule });
            return;
          }
          if (currentRange === "area") {
            this._launchAreaAttack(getAtkPid(), targetPiece, mv, stats, {
              moveIdx,
              powerRule,
            });
            return;
          }
          this._executeAttack(getAtkPid(), targetPiece, mv, stats, currentRange, {
            sneakAttack: getSneakAttack(),
            moveIdx,
            powerRule,
          });
        });
      } else if (i === totalSlots - 2) {
        slot.innerHTML = `<span class="ac-slot-icon">➕</span><span class="ac-slot-name">Todos</span>`;
        slot.title = "Ver todos os golpes";
        slot.addEventListener("click", () => {
          this._closeRadial();
          if (this._currentOverlay) {
            const body = this._currentOverlay.querySelector("#ac-overlay-body #ac-moves-area");
            if (body) this._renderMoveList(body, allMoves, stats, targetPiece, getAtkPid, () => currentRange, getSneakAttack);
          }
        });
      } else {
        slot.innerHTML = `<span class="ac-slot-icon">🌀</span><span class="ac-slot-name">Área</span>`;
        slot.title = "Ataque em Área";
        slot.addEventListener("click", () => {
          this._closeRadial();
          this._closeOverlay();
          this._openAreaDialog(targetPiece, getAtkPid());
        });
      }

      el.appendChild(slot);
    }

    this._overlayRoot.appendChild(el);
    this._currentRadial = el;

    const closeHandler = (e) => {
      if (!el.contains(e.target) && !this._currentOverlay?.contains(e.target)) {
        this._closeRadial();
        document.removeEventListener("mousedown", closeHandler, true);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", closeHandler, true), 50);
  }

  _buildResolvedMovePayload(move, ctx, extraAttackMods = {}) {
    const extraAccMod = safeInt(extraAttackMods.acc, 0);
    const extraDmgMod = safeInt(extraAttackMods.dmg, 0);
    const atkMod = ctx.atkMod + extraAccMod;
    const totalDmg = Math.max(0, ctx.totalDmg + extraDmgMod);
    const totalModDano = ctx.extraDmg + extraDmgMod;

    return {
      atkMod,
      totalDmg,
      extraAccMod,
      extraDmgMod,
      totalModDano,
      movePayload: {
        name: safeStr(move?.name) || "Golpe",
        accuracy: atkMod,
        damage: totalDmg,
        rank: ctx.rank,
        based_stat: ctx.based,
        stat_value: ctx.statVal,
        move_type: ctx.moveType,
        type_bonus: ctx.typeBonus,
        stab_bonus: ctx.stabBonus,
        modDano: totalModDano,
        move_idx: ctx.moveIdx,
        temp_mod_acc: ctx.tempAcc,
        temp_mod_dano: ctx.tempDmg,
        manual_acc_mod: extraAccMod,
        manual_dmg_mod: extraDmgMod,
        meta: move?.meta || {},
      },
    };
  }

  _findPieceByOwnerPid(ownerName, pidLike) {
    const owner = safeStr(ownerName);
    const targetKeys = partyLookupKeys(pidLike);
    if (!owner || !targetKeys.length) return null;
    const pieces = this.getPieces() || [];
    return pieces.find((piece) => (
      safeStr(piece?.owner) === owner
      && partyLookupKeys(piece).some((key) => targetKeys.includes(key))
    )) || null;
  }

  _partyStateFor(ownerName, pidLike) {
    const owner = safeStr(ownerName);
    const identity = (pidLike && typeof pidLike === "object" && !Array.isArray(pidLike))
      ? pidLike
      : (this._findPieceByOwnerPid(ownerName, pidLike) || pidLike);
    const pid = safeStr(identity?.pid ?? identity?.pokemon?.id ?? pidLike);
    const bucket = getTrainerBucket(this._partyStates, owner);
    const resolved = getPartyStateEntry(this._partyStates, owner, identity);
    if (resolved) return resolved || {};
    if (bucket[pid]) return bucket[pid] || {};
    if (/^\d+$/.test(pid) && bucket[String(Number(pid))]) return bucket[String(Number(pid))] || {};
    return {};
  }

  _combatantSnapshot(ownerName, pidLike, piece = null) {
    const owner = safeStr(ownerName);
    const pid = safeStr(pidLike || piece?.pid);
    const resolvedPiece = piece || this._findPieceByOwnerPid(owner, pid);
    const pData = this._partyStateFor(owner, pid);
    const hp = (typeof window.getPartyHp === "function")
      ? safeInt(window.getPartyHp(owner, resolvedPiece || { pid }), 6)
      : safeInt(pData.hp, 6);
    const mmConditions = (resolvedPiece?.mm_conditions && typeof resolvedPiece.mm_conditions === "object")
      ? resolvedPiece.mm_conditions
      : { deg1: [], deg2: [], deg3: [] };
    const pokemonConditions = Array.isArray(resolvedPiece?.pokemon_conditions) ? resolvedPiece.pokemon_conditions : [];
    return {
      owner,
      pid,
      pieceId: safeStr(resolvedPiece?.id),
      hp,
      conditions: mmConditions,
      pokemonConditions,
      statBoosts: (pData.stat_boosts && typeof pData.stat_boosts === "object") ? pData.stat_boosts : {},
    };
  }

  _ruleHasReaction(powerRule) {
    const effects = Array.isArray(powerRule?.effects) ? powerRule.effects : [];
    return !!powerRule?.flags?.reaction
      || safeStr(powerRule?.action).toLowerCase() === "reaction"
      || effects.some((effect) => (
        safeStr(effect?.type).toLowerCase() === "deflect"
        || !!effect?.reaction
        || safeStr(effect?.action).toLowerCase() === "reaction"
      ));
  }

  async _buildReactionBattleState(attackEvent) {
    const pieces = (this.getPieces() || []).filter((piece) => safeStr(piece?.status || "active") === "active");
    const owners = Array.from(new Set(pieces.map((piece) => safeStr(piece?.owner)).filter(Boolean)));
    await Promise.all(owners.map((owner) => this._loadSheets(owner)));

    const combatants = [];
    for (const piece of pieces) {
      const owner = safeStr(piece?.owner);
      const pid = safeStr(piece?.pid);
      if (!owner || !pid) continue;
      const sheet = this._getSheet(owner, pid);
      const moves = Array.isArray(sheet?.moves) ? sheet.moves : [];
      const powers = [];
      for (let idx = 0; idx < moves.length; idx += 1) {
        const move = moves[idx];
        try {
          const powerRule = await getPowerRuleForMove({ ...move, _move_idx: idx });
          if (!this._ruleHasReaction(powerRule)) continue;
          powers.push({
            moveIndex: idx,
            moveName: safeStr(move?.name || powerRule?.name),
            powerRule,
          });
        } catch (err) {
          console.warn("[arena-combat] reaction power load failed:", err);
        }
      }
      if (!powers.length) continue;
      const stats = this._getEffectiveStats(owner, pid);
      combatants.push({
        ...this._combatantSnapshot(owner, pid, piece),
        row: Number(piece?.row),
        col: Number(piece?.col),
        stats,
        initiative: safeInt(stats.initiative ?? stats.speed),
        powers,
      });
    }

    const battle = this.getBattle() || {};
    return {
      combatants,
      activeEffects: Array.isArray(battle.active_effects) ? battle.active_effects : [],
      attack: attackEvent?.attack || null,
    };
  }

  async _collectPendingReactionsForAttack(attackEvent) {
    const battleState = await this._buildReactionBattleState(attackEvent);
    const resolution = resolveCombatEvent(attackEvent, battleState, {}, mmRuntimeEnv());
    return {
      pendingReactions: Array.isArray(resolution.pendingReactions) ? resolution.pendingReactions : [],
      combatLog: resolution.combatLog || null,
      summary: resolution.summary || "",
    };
  }

  _firstPendingReaction(reactions = []) {
    return (Array.isArray(reactions) ? reactions : []).find((reaction) => safeStr(reaction?.status || "pending") === "pending") || null;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _coinLabel(value) {
    return value === "heads" ? "Cara" : "Coroa";
  }

  _hasUnreliablePowerRule(powerRule, move = null) {
    const hasUnreliableText = (items = []) => (Array.isArray(items) ? items : [items])
      .some((item) => /\b(?:unreliable|unrealible)\b/i.test(safeStr(item)));
    if (powerRule?.flags?.unreliable || hasUnreliableText(powerRule?.flaws)) return true;
    if (hasUnreliableText([
      powerRule?.name,
      powerRule?.build,
      powerRule?.raw,
      powerRule?.description,
      move?.name,
      move?.build,
      move?.description,
      move?.desc,
      move?.notes,
      move?.efeito,
    ])) return true;
    return (Array.isArray(powerRule?.effects) ? powerRule.effects : []).some((effect) => (
      !!effect?.unreliable ||
      hasUnreliableText(effect?.flaws) ||
      hasUnreliableText(effect?.modifiers)
    ));
  }

  _unreliableRollFromCoin(success) {
    return success ? 1 : 100;
  }

  _formatUnreliableGateLog(gate) {
    if (!gate?.applies) return "";
    return `Unreliable: ${gate.choiceLabel} escolhido; moeda caiu ${gate.resultLabel}; ${gate.success ? "golpe continua" : "golpe falha"}.`;
  }

  async _promptUnreliableCoin({ move, powerRule, actorPiece, targetPiece } = {}) {
    this._closePrompt();
    const moveName = safeStr(move?.name || powerRule?.name || "Golpe");
    const actorName = pieceBattleLabel(actorPiece) || displayName(actorPiece?.pid || this.getBy());
    const targetName = targetPiece ? pieceBattleLabel(targetPiece) : "";

    return new Promise((resolve) => {
      const layer = document.createElement("div");
      layer.className = "ac-roll-layer";
      layer.innerHTML = `
        <div class="ac-roll-panel">
          <div class="ac-roll-title">Unreliable: ${escHtml(moveName)}</div>
          <div class="ac-roll-sub">
            ${escHtml(actorName)} escolhe cara ou coroa antes do golpe.
            ${targetName ? `<br>Alvo: ${escHtml(targetName)}` : ""}
          </div>
          <div class="ac-roll-sprite ac-coin-sprite" data-coin-sprite></div>
          <div class="ac-roll-result" data-coin-result>Escolha um lado.</div>
          <div class="ac-coin-choice-row">
            <button class="ac-roll-choice" data-choice="heads">Cara</button>
            <button class="ac-roll-choice" data-choice="tails">Coroa</button>
          </div>
        </div>
      `;
      layer._acOnClose = resolve;
      (this._overlayRoot || document.body).appendChild(layer);
      this._currentPrompt = layer;

      const sprite = layer.querySelector("[data-coin-sprite]");
      const resultEl = layer.querySelector("[data-coin-result]");
      layer.querySelectorAll("[data-choice]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const choice = btn.dataset.choice === "tails" ? "tails" : "heads";
          layer.querySelectorAll("[data-choice]").forEach((choiceBtn) => { choiceBtn.disabled = true; });
          if (resultEl) resultEl.textContent = `Voce escolheu ${this._coinLabel(choice)}.`;

          const result = Math.random() < 0.5 ? "heads" : "tails";
          sprite?.classList.add("ac-rolling");
          await this._sleep(2000);
          if (sprite) {
            sprite.classList.remove("ac-rolling");
            sprite.style.animation = "none";
            sprite.style.backgroundPosition = result === "heads" ? "-1152px 0" : "-1440px 0";
          }

          const success = choice === result;
          if (resultEl) {
            resultEl.textContent = `${this._coinLabel(result)}: ${success ? "golpe continua" : "golpe falha"}.`;
            resultEl.classList.toggle("ac-success", success);
            resultEl.classList.toggle("ac-fail", !success);
          }
          await this._sleep(700);
          this._closePrompt({
            applies: true,
            choice,
            result,
            choiceLabel: this._coinLabel(choice),
            resultLabel: this._coinLabel(result),
            success,
            unreliableRoll: this._unreliableRollFromCoin(success),
          });
        }, { once: true });
      });
    });
  }

  async _runUnreliableGate({ move, powerRule, actorPiece, targetPiece, opts = {} } = {}) {
    if (opts.unreliableGateResult) return opts.unreliableGateResult;
    if (!this._hasUnreliablePowerRule(powerRule, move)) {
      return { applies: false, success: true, unreliableRoll: null };
    }
    const gate = await this._promptUnreliableCoin({ move, powerRule, actorPiece, targetPiece });
    if (!gate) return { applies: true, success: false, cancelled: true, blocked: true, unreliableRoll: 100 };
    return { ...gate, blocked: !gate.success };
  }

  async _writeUnreliableFailure({ by, atkPid, move, powerRule, gate, actorPiece, targetPiece, tOwner = "", tPid = "", tId = "" } = {}) {
    const moveName = safeStr(move?.name || powerRule?.name || "Golpe");
    const line = `${safeStr(by) || "Jogador"} tentou ${moveName}: ${this._formatUnreliableGateLog(gate) || "Unreliable falhou."} O golpe nao acontece.`;
    await this._writeBattle({
      status: "idle",
      attacker: safeStr(by),
      attacker_pid: safeStr(atkPid),
      target_id: safeStr(tId || targetPiece?.id || actorPiece?.id),
      target_owner: safeStr(tOwner || targetPiece?.owner || actorPiece?.owner || by),
      target_pid: safeStr(tPid || targetPiece?.pid || actorPiece?.pid || atkPid),
      attack_move: firestoreSafeValue(move || null),
      power_rule: firestoreSafeValue(powerRule || null),
      unreliable_roll: safeInt(gate?.unreliableRoll, 100),
      unreliable_gate: firestoreSafeValue(gate || null),
      last_attack_outcome: "unreliable_failed",
      secondary_available: false,
      secondary_active: false,
      pendingFor: null,
      prompt: null,
      logs: arrayUnion(line),
    });
    const floatPiece = targetPiece || actorPiece;
    if (floatPiece) this._showFloat(floatPiece, "Unreliable falhou", "miss");
  }

  async _rollD20Animated(label = "d20") {
    return d20Roll();
  }

  _reactionLogLine(reaction, resolution, choiceLabel) {
    const name = safeStr(reaction?.powerName || "Reacao");
    const owner = safeStr(reaction?.reactor?.owner || "jogador");
    if (choiceLabel === "ignored") return `${owner} ignorou ${name}.`;
    const result = resolution?.effectResults?.[0] || {};
    if (resolution?.blocked || result.blocked) {
      return `${owner} ativou ${name}: Deflect ${safeInt(result.total)} bloqueou ataque ${safeInt(result.attackTotal)}.`;
    }
    if (safeStr(reaction?.effectType) === "deflect") {
      return `${owner} ativou ${name}: Deflect ${safeInt(result.total)} nao superou ataque ${safeInt(result.attackTotal)}.`;
    }
    return `${owner} ativou ${name}: aguardando decisao do efeito.`;
  }

  async _advanceOrContinuePendingAttack(battle, reactions, extraLogs = []) {
    const nextReaction = this._firstPendingReaction(reactions);
    if (nextReaction) {
      await this._writeBattle({
        status: "pending_reaction",
        pending_reactions: firestoreSafeValue(reactions),
        pendingFor: safeStr(nextReaction.reactor?.owner),
        prompt: { type: "MM_REACTION", reactionId: safeStr(nextReaction.id) },
        logs: (Array.isArray(battle?.logs) ? battle.logs : []).concat(extraLogs),
      });
      return;
    }
    await this._continuePendingAttack({ ...(battle || {}), pending_reactions: reactions }, extraLogs);
  }

  async _continuePendingAttack(battle, extraLogs = []) {
    const pending = battle?.pending_attack || {};
    const by = safeStr(pending.attacker);
    const atkPid = safeStr(pending.attacker_pid);
    const tOwner = safeStr(pending.target_owner);
    const tPid = safeStr(pending.target_pid);
    const tId = safeStr(pending.target_id);
    const targetPiece = (this.getPieces() || []).find((piece) => safeStr(piece?.id) === tId);
    const roll = safeInt(pending.d20);
    const totalAtk = safeInt(pending.total_atk);
    const needed = safeInt(pending.needed);
    const critBonus = safeInt(pending.crit_bonus);
    const totalDmg = safeInt(pending.dmg_base);
    const isEffect = !!pending.is_effect;
    const powerRule = pending.power_rule || pending.attack_move?.power_rule || await getPowerRuleForMove(pending.attack_move || {});
    const attackMove = pending.attack_move || {};
    const atkModStr = safeStr(pending.atk_mod_text) || buildAttackRollText(safeInt(pending.atk_mod), safeInt(pending.extra_acc_mod), safeInt(pending.aceiro_bonus));
    const defenseVal = safeInt(pending.defense_val);
    const sneakTxt = pending.sneak_attack ? " 🥷 Furtivo (def/2)" : "";

    let hit;
    if (roll === 1) hit = false;
    else if (roll === 20) hit = true;
    else hit = totalAtk >= needed;

    const rollText = `d20=${roll}+${atkModStr}=${totalAtk} vs DEF ${needed}`;
    if (targetPiece) {
      if (hit) {
        const critTxt = critBonus ? " CRIT!" : "";
        this._showFloat(targetPiece, `ACERTOU ✅ (${rollText})${critTxt}`, critBonus ? "crit" : "hit");
      } else {
        this._showFloat(targetPiece, `ERROU ❌ (${rollText})`, "miss");
      }
    }

    const resultMsg = hit ? "ACERTOU! ✅" : "ERROU! ❌";
    const critTxt = critBonus ? " (CRÍTICO +5)" : "";
    const baseLogs = (Array.isArray(battle?.logs) ? battle.logs : []).concat(extraLogs);

    if (hit) {
      const critFloat = critBonus ? " CRIT!" : "";
      this._showFloat(targetPiece, `ACERTOU (${rollText})${critFloat}`, critBonus ? "crit" : "hit");
    } else {
      this._showFloat(targetPiece, `ERROU (${rollText})`, "miss");
    }

    if (hit) {
      const resistanceQueue = buildResistanceQueue(powerRule, {
        rank: totalDmg,
        critBonus,
        fallbackIsEffect: isEffect,
        fallbackResistance: isEffect ? "fort" : "thg",
      });
      const dcTotal = safeInt(resistanceQueue?.[0]?.dc, (isEffect ? 10 : 15) + totalDmg + critBonus);
      const logs = baseLogs.concat([
        `${by} rolou ${roll}+${atkModStr}=${totalAtk} (vs Def ${needed} [${defenseVal}+10])${critTxt}${sneakTxt}... ${resultMsg}`,
        `Rank/Dano: ${totalDmg}${isEffect ? " (Affliction)" : ""}. Aguardando resistência... (CD ${dcTotal})`,
      ]);

      await this._writeBattle({
        status: "waiting_defense",
        attacker: by,
        attacker_pid: atkPid,
        target_id: tId,
        target_owner: tOwner,
        target_pid: tPid,
        attack_move: attackMove,
        power_rule: powerRule,
        unreliable_roll: safeInt(pending.unreliable_roll, 0) || null,
        unreliable_gate: firestoreSafeValue(pending.unreliable_gate || null),
        resistance_queue: resistanceQueue,
        attack_range: safeStr(pending.attack_range),
        atk_mod: safeInt(pending.atk_mod),
        atk_base_mod: safeInt(pending.atk_base_mod),
        rule_attack_mod: safeInt(pending.rule_attack_mod),
        attack_modifier_summary: firestoreSafeValue(pending.attack_modifier_summary || null),
        aceiro_bonus: safeInt(pending.aceiro_bonus),
        d20: roll,
        defense_val: defenseVal,
        needed,
        total_atk: totalAtk,
        crit_bonus: critBonus,
        sneak_attack: !!pending.sneak_attack,
        dmg_base: totalDmg,
        is_effect: isEffect,
        extra_acc_mod: safeInt(pending.extra_acc_mod),
        extra_dmg_mod: safeInt(pending.extra_dmg_mod),
        last_attack_outcome: "hit_pending_resistance",
        secondary_available: true,
        secondary_active: false,
        pending_reactions: [],
        pending_attack: null,
        pendingFor: tOwner,
        prompt: {
          type: "ROLL_RESIST",
          options: { dc: dcTotal, isEffect, rank: totalDmg, critBonus, powerRule, resistanceQueue },
        },
        logs,
      });
      if (targetPiece) this._showFloat(targetPiece, `🛡️ Resistência pendente (${tOwner})`, "pending");
    } else {
      const logs = baseLogs.concat([
        `${by} rolou ${roll}+${atkModStr}=${totalAtk} (vs Def ${needed} [${defenseVal}+10])${sneakTxt}... ${resultMsg}`,
      ]);
      await this._writeBattle({
        status: "idle",
        attacker: by,
        attacker_pid: atkPid,
        target_id: tId,
        target_owner: tOwner,
        target_pid: tPid,
        attack_move: attackMove,
        power_rule: powerRule,
        unreliable_roll: safeInt(pending.unreliable_roll, 0) || null,
        unreliable_gate: firestoreSafeValue(pending.unreliable_gate || null),
        attack_range: safeStr(pending.attack_range),
        atk_mod: safeInt(pending.atk_mod),
        atk_base_mod: safeInt(pending.atk_base_mod),
        rule_attack_mod: safeInt(pending.rule_attack_mod),
        attack_modifier_summary: firestoreSafeValue(pending.attack_modifier_summary || null),
        aceiro_bonus: safeInt(pending.aceiro_bonus),
        d20: roll,
        defense_val: defenseVal,
        needed,
        total_atk: totalAtk,
        crit_bonus: 0,
        sneak_attack: !!pending.sneak_attack,
        dmg_base: totalDmg,
        is_effect: isEffect,
        extra_acc_mod: safeInt(pending.extra_acc_mod),
        extra_dmg_mod: safeInt(pending.extra_dmg_mod),
        last_attack_outcome: "miss",
        secondary_available: false,
        secondary_active: false,
        pending_reactions: [],
        pending_attack: null,
        pendingFor: null,
        prompt: null,
        logs,
      });
    }
  }

  async _executeImmediatePower(atkPid, move, stats, opts = {}) {
    this._closeAll();
    const by = this.getBy();
    if (by) await this._loadSheets(by);

    const atkStats = Object.keys(stats || {}).length > 0 ? stats : this._getEffectiveStats(by, atkPid);
    const atkSheet = this._getSheet(by, atkPid);
    const moveIdx = resolveMoveIndex(atkSheet?.moves || [], move, opts.moveIdx);
    const powerRule = opts.powerRule || await getPowerRuleForMove({ ...move, _move_idx: moveIdx });
    const ctx = this._calcMoveContext(move, atkStats, by, atkPid, by, atkPid, {
      moveIdx,
      atkSheet,
      powerRule,
    });
    const actorPiece = this._findPieceByOwnerPid(by, atkPid);
    const actor = this._combatantSnapshot(by, atkPid, actorPiece);
    const unreliableGate = await this._runUnreliableGate({ move, powerRule, actorPiece, targetPiece: actorPiece, opts });
    if (unreliableGate?.cancelled) return;
    if (unreliableGate?.blocked) {
      await this._writeUnreliableFailure({ by, atkPid, move, powerRule, gate: unreliableGate, actorPiece });
      return;
    }
    const resolution = resolveCombatEvent({
      type: "immediatePower",
      powerRule,
      actor,
      target: actor,
      rank: Math.max(1, ctx.totalDmg || ctx.rank || safeInt(move?.rank, 1)),
      unreliableRoll: unreliableGate?.unreliableRoll || undefined,
    }, {}, {}, mmRuntimeEnv());

    await this._applyMmPatches(resolution.patches);
    const resolutionId = await this._persistMmResolution(resolution, { applied: true });
    this._showResolutionToast(resolution, resolutionId);

    const logs = [
      `${by} usou ${safeStr(move?.name) || "Power"} (${safeStr(powerRule?.id)}).`,
      resolution.summary,
    ];
    const unreliableLog = this._formatUnreliableGateLog(unreliableGate);
    if (unreliableLog) logs.splice(1, 0, unreliableLog);
    if (resolution.requiresAdjudication) logs.push("Há efeito(s) marcados para revisão do mestre.");
    await this._writeBattle({
      status: "idle",
      attacker: by,
      attacker_pid: atkPid,
      target_owner: by,
      target_pid: atkPid,
      target_id: safeStr(actorPiece?.id),
      power_rule: powerRule,
      attack_move: firestoreSafeValue(move || null),
      attack_range: null,
      resistance_queue: null,
      pending_attack: null,
      pending_reactions: null,
      pending_reaction_log: null,
      aoe_dc: null,
      dmg_base: null,
      is_effect: false,
      atk_mod: null,
      atk_base_mod: null,
      rule_attack_mod: null,
      attack_modifier_summary: null,
      d20: null,
      defense_val: null,
      needed: null,
      total_atk: null,
      crit_bonus: 0,
      unreliable_roll: unreliableGate?.unreliableRoll || null,
      unreliable_gate: firestoreSafeValue(unreliableGate?.applies ? unreliableGate : null),
      last_resolution_id: resolutionId || null,
      pending_review: !!resolution.requiresAdjudication,
      last_attack_outcome: "immediate_power",
      secondary_available: false,
      secondary_active: false,
      pendingFor: null,
      prompt: null,
      logs,
    });

    if (actorPiece) this._showFloat(actorPiece, resolution.summary, resolution.requiresAdjudication ? "pending" : "stage");
  }

  async _finalizeMmResistance({ battle, prompt, roll, defType, targetPiece }) {
    const powerRule = battle?.power_rule || battle?.attack_move?.power_rule || await getPowerRuleForMove(battle?.attack_move || {});
    const tOwner = safeStr(battle?.target_owner);
    const tPid = safeStr(battle?.target_pid);
    const target = this._combatantSnapshot(tOwner, tPid, targetPiece);
    const aOwner = safeStr(battle?.attacker);
    const aPid = safeStr(battle?.attacker_pid);
    const actor = this._combatantSnapshot(aOwner, aPid, this._findPieceByOwnerPid(aOwner, aPid));
    const stats = this._getEffectiveStats(tOwner, tPid);
    const resolution = resolveCombatEvent({
      type: "resistanceCheck",
      powerRule,
      target,
      d20: roll,
      stats,
      rank: safeInt(battle?.dmg_base, safeInt(prompt?.options?.rank, 0)),
      critBonus: safeInt(battle?.crit_bonus),
      fallbackIsEffect: !!(battle?.is_effect || prompt?.options?.isEffect),
      fallbackResistance: defType || "thg",
      actor,
      unreliableRoll: safeInt(battle?.unreliable_roll, 0) || undefined,
    }, {}, {}, mmRuntimeEnv());

    await this._applyMmPatches(resolution.patches);
    const resolutionId = await this._persistMmResolution(resolution, { applied: true });
    this._showResolutionToast(resolution, resolutionId);
    return { resolution, resolutionId };
  }

  async _applyMmPatches(patches = []) {
    const activeEffects = [];
    const removeActiveEffectIds = [];
    for (const patch of patches || []) {
      if (!patch || patch.kind === "adjudication") continue;
      if (patch.kind === "hp") {
        const piece = patch.pieceId ? (this.getPieces() || []).find(p => safeStr(p?.id) === safeStr(patch.pieceId)) : null;
        if (typeof window.updatePartyStateHp === "function") {
          await window.updatePartyStateHp(patch.owner, piece || { pid: patch.pid }, patch.after);
        }
      } else if (patch.kind === "conditions") {
        if (typeof window.setPieceConditions === "function" && patch.pieceId) {
          await window.setPieceConditions(patch.pieceId, patch.after?.mm_conditions, patch.after?.pokemon_conditions);
        }
      } else if (patch.kind === "stat_boost") {
        if (typeof window.updateStatBoost === "function") {
          const delta = safeInt(patch.delta, safeInt(patch.after) - safeInt(patch.before));
          if (delta) await window.updateStatBoost(patch.owner, patch.pid, patch.stat, delta);
        }
      } else if (patch.kind === "active_effect") {
        activeEffects.push({
          ...patch,
          id: safeStr(patch.id) || `ae_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
          createdAt: patch.createdAt || Date.now(),
        });
      } else if (patch.kind === "active_effect_remove") {
        const id = safeStr(patch.activeEffectId);
        if (id) removeActiveEffectIds.push(id);
      }
    }
    if (activeEffects.length) {
      await this._writeBattle({ active_effects: arrayUnion(...activeEffects) });
    }
    if (removeActiveEffectIds.length) {
      await this._removeMmActiveEffects(removeActiveEffectIds);
    }
  }

  async _removeMmActiveEffects(ids = []) {
    const db = this.getDb();
    const rid = this.getRid();
    const idSet = new Set((ids || []).map(safeStr).filter(Boolean));
    if (!db || !rid || !idSet.size) return;
    const ref = doc(db, "rooms", rid, "public_state", "battle");
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists() ? snap.data() : {};
        const active = Array.isArray(data.active_effects) ? data.active_effects : [];
        const next = active.filter((effect) => !idSet.has(safeStr(effect?.id)));
        const nextRev = (safeInt(data.rev) || 0) + 1;
        tx.set(ref, { active_effects: next, rev: nextRev }, { merge: true });
      });
    } catch (err) {
      console.warn("[arena-combat] active effect remove failed:", err);
    }
  }

  async _persistMmResolution(resolution, extra = {}) {
    const db = this.getDb();
    const rid = this.getRid();
    if (!db || !rid || !resolution) return "";
    const payload = firestoreSafeValue({
      ...resolution,
      ...extra,
      by: safeStr(this.getBy()),
    });
    try {
      const docRef = await addDoc(collection(db, "rooms", rid, "combat_resolutions"), {
        ...payload,
        createdAt: serverTimestamp(),
      });
      return docRef.id;
    } catch (err) {
      console.warn("[arena-combat] combat_resolutions write failed:", err);
      return await this._persistMmResolutionFallback(payload, err);
    }
  }

  async _persistMmResolutionFallback(payload, cause = null) {
    const id = `battle:${uid()}`;
    const errorText = safeStr(cause?.code || cause?.message || cause);
    const record = firestoreSafeValue({
      ...payload,
      id,
      storage: "battle_doc_fallback",
      persistError: errorText || null,
      createdAtMs: Date.now(),
    });
    try {
      await this._writeBattle({
        mm_resolution_history: arrayUnion(record),
        last_resolution_fallback: record,
      });
      return id;
    } catch (err) {
      console.warn("[arena-combat] battle doc resolution fallback failed:", err);
      return "";
    }
  }

  _showResolutionToast(resolution, resolutionId = "") {
    if (!resolution) return;
    const el = document.createElement("div");
    el.className = "ac-resolution-toast";
    el.innerHTML = `
      <div class="ac-resolution-title">Resolução M&M</div>
      <div class="ac-resolution-summary">${escHtml(resolution.summary || "Resolvido.")}</div>
      <div class="ac-resolution-actions">
        ${resolutionId ? `<button class="ac-mini-btn" data-act="undo">Desfazer</button>` : ""}
        <button class="ac-mini-btn" data-act="close">OK</button>
      </div>
    `;
    this._overlayRoot.appendChild(el);
    el.querySelector('[data-act="close"]')?.addEventListener("click", () => el.remove());
    el.querySelector('[data-act="undo"]')?.addEventListener("click", async () => {
      const btn = el.querySelector('[data-act="undo"]');
      if (btn) { btn.disabled = true; btn.textContent = "Desfazendo..."; }
      await this._undoMmResolution(resolutionId);
      el.remove();
    });
    setTimeout(() => { try { el.remove(); } catch {} }, 12000);
  }

  async _undoMmResolution(resolutionId) {
    const db = this.getDb();
    const rid = this.getRid();
    const id = safeStr(resolutionId);
    if (!db || !rid || !id) return;
    if (id.startsWith("battle:")) {
      await this._undoMmResolutionFallback(id);
      return;
    }
    const ref = doc(db, "rooms", rid, "combat_resolutions", id);
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) return;
      const data = snap.data() || {};
      if (data.undoneAt) return;
      await this._applyMmPatches(data.undoPatches || []);
      await updateDoc(ref, {
        undoneAt: serverTimestamp(),
        undoneBy: safeStr(this.getBy()),
      });
      await this._writeBattle({
        logs: arrayUnion(`↩ Resolução ${id} desfeita por ${safeStr(this.getBy()) || "jogador"}.`),
      });
    } catch (err) {
      console.warn("[arena-combat] undo failed:", err);
    }
  }

  async _undoMmResolutionFallback(id) {
    const ref = this._battleRef();
    if (!ref || !id) return;
    try {
      const snap = await getDoc(ref);
      const data = snap.exists() ? (snap.data() || {}) : {};
      const history = Array.isArray(data.mm_resolution_history) ? data.mm_resolution_history : [];
      const record = history.find((item) => safeStr(item?.id) === id);
      if (!record || record.undoneAtMs) return;
      await this._applyMmPatches(record.undoPatches || []);
      const nextHistory = history.map((item) => {
        if (safeStr(item?.id) !== id) return item;
        return {
          ...item,
          undoneAtMs: Date.now(),
          undoneBy: safeStr(this.getBy()),
        };
      });
      const lastFallback = safeStr(data.last_resolution_fallback?.id) === id
        ? { ...data.last_resolution_fallback, undoneAtMs: Date.now(), undoneBy: safeStr(this.getBy()) }
        : data.last_resolution_fallback;
      await this._writeBattle({
        mm_resolution_history: firestoreSafeValue(nextHistory),
        last_resolution_fallback: firestoreSafeValue(lastFallback),
        logs: arrayUnion(`↩ Resolução ${id} desfeita por ${safeStr(this.getBy()) || "jogador"}.`),
      });
    } catch (err) {
      console.warn("[arena-combat] fallback undo failed:", err);
    }
  }

  async _launchAreaAttack(atkPid, targetPiece, move, stats, opts = {}) {
    const extraAttackMods = opts.askExtraMods === false
      ? { acc: 0, dmg: 0 }
      : (opts.extraAttackMods || await this._promptExtraAttackModifiers(move, {
          allowAccuracy: false,
          introText: `Ajuste apenas o modificador final de dano para ${safeStr(move?.name) || "o golpe"}. Ataques em área usam Dodge obrigatório e não rolam acerto.`,
        }));
    if (extraAttackMods == null) return;

    this._closeAll();

    const by = this.getBy();
    const tId = safeStr(targetPiece.id);
    const tOwner = safeStr(targetPiece.owner);
    const tPid = safeStr(targetPiece.pid);

    if (by) await this._loadSheets(by);
    if (tOwner) await this._loadSheets(tOwner);
    if (isTrainerPiece(targetPiece)) this._loadTrainerRpgSheet(tOwner);

    const atkStats = Object.keys(stats || {}).length > 0 ? stats : this._getEffectiveStats(by, atkPid);
    const atkSheet = this._getSheet(by, atkPid);
    const moveIdx = resolveMoveIndex(atkSheet?.moves || [], move, opts.moveIdx);
    const powerRule = opts.powerRule || await getPowerRuleForMove({ ...move, _move_idx: moveIdx });
    const ctx = this._calcMoveContext(move, atkStats, by, atkPid, tOwner, tPid, {
      moveIdx,
      atkSheet,
      powerRule,
    });
    const resolved = this._buildResolvedMovePayload(move, ctx, extraAttackMods);
    const totalDmg = resolved.totalDmg;
    const aoeDc = totalDmg + 10;
    const firstEffectType = safeStr(powerRule?.effects?.[0]?.type);
    const isEffect = this._isEffectMove(move) || (!!firstEffectType && firstEffectType !== "damage");
    const extraModsTxt = describeExtraAttackMods(0, resolved.extraDmgMod);
    const actorPiece = this._findPieceByOwnerPid(by, atkPid);
    const unreliableGate = await this._runUnreliableGate({ move, powerRule, actorPiece, targetPiece, opts });
    if (unreliableGate?.cancelled) return;
    if (unreliableGate?.blocked) {
      await this._writeUnreliableFailure({ by, atkPid, move: resolved.movePayload, powerRule, gate: unreliableGate, actorPiece, targetPiece, tOwner, tPid, tId });
      return;
    }

    this._lastMove = {
      moveName: safeStr(move?.name),
      moveIdx: ctx.moveIdx,
      attackerPid: atkPid,
      mode: "area",
      rangeStr: "area",
      sneakAttack: false,
    };
    try { localStorage.setItem(LAST_MOVE_KEY, JSON.stringify(this._lastMove)); } catch {}
    this._updateRepeatBtn();

    const logs = [
      `${by} lançou Área com ${safeStr(move?.name) || "Golpe"} (Rank ${totalDmg}). Defensor rola Dodge obrigatório (CD ${aoeDc}).`,
    ];
    const unreliableLog = this._formatUnreliableGateLog(unreliableGate);
    if (unreliableLog) logs.push(unreliableLog);
    if (extraModsTxt) logs.push(`Modificadores extras aplicados: ${extraModsTxt}.`);

    await this._writeBattle({
      status: "aoe_defense",
      attacker: by,
      attacker_pid: atkPid,
      target_id: tId,
      target_owner: tOwner,
      target_pid: tPid,
      attack_move: resolved.movePayload,
      power_rule: powerRule,
      unreliable_roll: unreliableGate?.unreliableRoll || null,
      unreliable_gate: firestoreSafeValue(unreliableGate?.applies ? unreliableGate : null),
      attack_range: "Área (Dodge)",
      aoe_dc: aoeDc,
      dmg_base: totalDmg,
      is_effect: isEffect,
      extra_acc_mod: 0,
      extra_dmg_mod: resolved.extraDmgMod,
      aoe_source: true,
      last_attack_outcome: "area_pending",
      secondary_available: false,
      secondary_active: false,
      pendingFor: tOwner,
      prompt: { type: "ROLL_RESIST", options: { dc: aoeDc, isEffect, isAoe: true, aoePhase: "dodge" } },
      logs,
    });

    this._showFloat(targetPiece, `🌀 ${safeStr(move?.name) || "Área"} R${totalDmg} — CD ${aoeDc}`, "pending");
  }

  async _executeAttack(atkPid, targetPiece, move, stats, rangeStr, opts = {}) {
    const extraAttackMods = opts.askExtraMods === false
      ? { acc: 0, dmg: 0 }
      : (opts.extraAttackMods || await this._promptExtraAttackModifiers(move));
    if (extraAttackMods == null) return;

    this._closeAll();

    const by = this.getBy();
    const tId = safeStr(targetPiece.id);
    const tOwner = safeStr(targetPiece.owner);
    const tPid = safeStr(targetPiece.pid);

    if (by) await this._loadSheets(by);
    if (tOwner) await this._loadSheets(tOwner);
    if (isTrainerPiece(targetPiece)) this._loadTrainerRpgSheet(tOwner);

    const atkStats = this._getEffectiveStats(by, atkPid);
    const tStats = this._getEffectiveStats(tOwner, tPid);

    const aceiroBonus = safeInt(atkStats.acerto || 0);
    const extraAccMod = safeInt(extraAttackMods.acc, 0);
    const extraDmgMod = safeInt(extraAttackMods.dmg, 0);
    const extraModsTxt = describeExtraAttackMods(extraAccMod, extraDmgMod);

    const isDistance = rangeStr === "distance";
    const defenseKey = isDistance ? "dodge" : "parry";
    const isSneakAttack = !!opts.sneakAttack;
    const baseDefenseVal = safeInt(tStats[defenseKey]);
    const defenseVal = isSneakAttack ? Math.floor(baseDefenseVal / 2) : baseDefenseVal;
    const needed = defenseVal + 10;

    const atkSheet = this._getSheet(by, atkPid);
    const moveIdx = resolveMoveIndex(atkSheet?.moves || [], move, opts.moveIdx);
    const powerRule = opts.powerRule || await getPowerRuleForMove({ ...move, _move_idx: moveIdx });
    const ctx = this._calcMoveContext(move, atkStats, by, atkPid, tOwner, tPid, {
      moveIdx,
      atkSheet,
      powerRule,
    });
    const attackModifierSummary = getAttackModifierSummary(powerRule, atkStats);
    const resolved = this._buildResolvedMovePayload(move, ctx, extraAttackMods);
    if (attackModifierSummary.attackBonus) {
      resolved.atkMod += attackModifierSummary.attackBonus;
      resolved.movePayload.accuracy = resolved.atkMod;
      resolved.movePayload.rule_attack_mod = attackModifierSummary.attackBonus;
    }
    resolved.movePayload.attack_modifier_summary = attackModifierSummary;
    const atkMod = resolved.atkMod;
    const totalDmg = resolved.totalDmg;
    const firstEffectType = safeStr(powerRule?.effects?.[0]?.type);
    const isEffect = this._isEffectMove(move) || (!!firstEffectType && firstEffectType !== "damage");
    const actorPiece = this._findPieceByOwnerPid(by, atkPid);
    const unreliableGate = await this._runUnreliableGate({ move, powerRule, actorPiece, targetPiece, opts });
    if (unreliableGate?.cancelled) return;
    if (unreliableGate?.blocked) {
      await this._writeUnreliableFailure({ by, atkPid, move: resolved.movePayload, powerRule, gate: unreliableGate, actorPiece, targetPiece, tOwner, tPid, tId });
      return;
    }
    const unreliableLog = this._formatUnreliableGateLog(unreliableGate);

    const roll = await this._rollD20Animated(`Ataque - ${displayName(atkPid)}`);
    await this._publishRoll(roll, `Ataque • ${displayName(atkPid)}`);

    const totalAtk = atkMod + aceiroBonus + roll;
    const attackOutcome = resolveAttackHitAndCritical({ roll, totalAtk, needed, powerRule, attackerStats: atkStats });
    const hit = attackOutcome.hit;
    const critBonus = attackOutcome.critBonus;

    const atkModStr = buildAttackRollText(ctx.atkMod, extraAccMod, aceiroBonus, attackModifierSummary.attackBonus);
    const rollText = `d20=${roll}+${atkModStr}=${totalAtk} vs DEF ${needed}`;
    if (false && hit) {
      const critTxt = critBonus ? " CRIT!" : "";
      this._showFloat(targetPiece, `ACERTOU ✅ (${rollText})${critTxt}`, critBonus ? "crit" : "hit");
    } else if (false) {
      this._showFloat(targetPiece, `ERROU ❌ (${rollText})`, "miss");
    }

    this._lastMove = {
      moveName: safeStr(move.name),
      moveIdx: ctx.moveIdx,
      attackerPid: atkPid,
      mode: "normal",
      rangeStr,
      sneakAttack: isSneakAttack,
    };
    try { localStorage.setItem(LAST_MOVE_KEY, JSON.stringify(this._lastMove)); } catch {}
    this._updateRepeatBtn();

    const movePayload = resolved.movePayload;

    if (hit) {
      const reactionAtkRange = isDistance ? "Distancia (Dodge)" : "Corpo-a-corpo (Parry)";
      const actor = {
        ...this._combatantSnapshot(by, atkPid, actorPiece),
        row: Number(actorPiece?.row),
        col: Number(actorPiece?.col),
      };
      const target = {
        ...this._combatantSnapshot(tOwner, tPid, targetPiece),
        row: Number(targetPiece?.row),
        col: Number(targetPiece?.col),
      };
      const pendingAttack = {
        attacker: by,
        attacker_pid: atkPid,
        target_id: tId,
        target_owner: tOwner,
        target_pid: tPid,
        attack_move: movePayload,
        power_rule: powerRule,
        attack_range: reactionAtkRange,
        range_str: rangeStr,
        atk_mod: atkMod,
        atk_base_mod: ctx.atkMod,
        rule_attack_mod: attackModifierSummary.attackBonus,
        attack_modifier_summary: attackModifierSummary,
        atk_mod_text: atkModStr,
        aceiro_bonus: aceiroBonus,
        d20: roll,
        defense_key: defenseKey,
        defense_val: defenseVal,
        needed,
        total_atk: totalAtk,
        crit_bonus: critBonus,
        sneak_attack: isSneakAttack,
        dmg_base: totalDmg,
        is_effect: isEffect,
        extra_acc_mod: extraAccMod,
        extra_dmg_mod: extraDmgMod,
        extra_mods_text: extraModsTxt,
        unreliable_roll: unreliableGate?.unreliableRoll || null,
        unreliable_gate: firestoreSafeValue(unreliableGate?.applies ? unreliableGate : null),
        manual_context_mods: opts.manualContextMods || {},
      };
      const attackEvent = {
        type: "attackDeclared",
        id: `atk_${uid()}`,
        summary: `${by} atacou ${tOwner} com ${safeStr(move?.name || powerRule?.name || "Golpe")}.`,
        attack: {
          actor,
          target,
          powerRule,
          attackTotal: totalAtk,
          totalAtk,
          d20: roll,
          defenseKey,
          isArea: false,
          isPerception: safeStr(powerRule?.range).toLowerCase() === "perception",
          range: rangeStr,
          manualContextMods: pendingAttack.manual_context_mods,
        },
      };
      const reactionResolution = await this._collectPendingReactionsForAttack(attackEvent);
      if (reactionResolution.pendingReactions.length) {
        const firstReaction = this._firstPendingReaction(reactionResolution.pendingReactions);
        const logs = [
          `${by} rolou ${roll}+${atkModStr}=${totalAtk} contra ${tOwner}; aguardando reacao antes de confirmar o acerto.`,
          `${reactionResolution.pendingReactions.length} reacao(oes) elegivel(is) adicionada(s) a fila.`,
        ];
        if (unreliableLog) logs.push(unreliableLog);
        if (extraModsTxt) logs.push(`Modificadores extras aplicados: ${extraModsTxt}.`);
        await this._writeBattle({
          status: "pending_reaction",
          attacker: by,
          attacker_pid: atkPid,
          target_id: tId,
          target_owner: tOwner,
          target_pid: tPid,
          attack_move: movePayload,
          power_rule: powerRule,
          unreliable_roll: unreliableGate?.unreliableRoll || null,
          unreliable_gate: firestoreSafeValue(unreliableGate?.applies ? unreliableGate : null),
          attack_range: reactionAtkRange,
          atk_base_mod: ctx.atkMod,
          rule_attack_mod: attackModifierSummary.attackBonus,
          attack_modifier_summary: attackModifierSummary,
          pending_attack: firestoreSafeValue(pendingAttack),
          pending_reactions: firestoreSafeValue(reactionResolution.pendingReactions),
          pending_reaction_log: firestoreSafeValue(reactionResolution.combatLog),
          last_attack_outcome: "pending_reaction",
          secondary_available: false,
          secondary_active: false,
          pendingFor: safeStr(firstReaction?.reactor?.owner),
          prompt: { type: "MM_REACTION", reactionId: safeStr(firstReaction?.id) },
          logs,
        });
        this._showFloat(targetPiece, `Reacao pendente (${safeStr(firstReaction?.reactor?.owner)})`, "pending");
        return;
      }
    }

    const atkRange = isDistance ? "Distância (Dodge)" : "Corpo-a-corpo (Parry)";
    const critTxt = critBonus ? " (CRÍTICO +5)" : "";
    const sneakTxt = isSneakAttack ? " 🥷 Furtivo (def/2)" : "";
    const resultMsg = hit ? "ACERTOU! ✅" : "ERROU! ❌";

    if (hit) {
      const resistanceQueue = buildResistanceQueue(powerRule, {
        rank: totalDmg,
        critBonus,
        fallbackIsEffect: isEffect,
        fallbackResistance: isEffect ? "fort" : "thg",
      });
      const dcTotal = safeInt(resistanceQueue?.[0]?.dc, (isEffect ? 10 : 15) + totalDmg + critBonus);
      const logs = [
        `${by} rolou ${roll}+${atkModStr}=${totalAtk} (vs Def ${needed} [${defenseVal}+10])${critTxt}${sneakTxt}... ${resultMsg}`,
      ];
      if (extraModsTxt) logs.push(`Modificadores extras aplicados: ${extraModsTxt}.`);
      if (unreliableLog) logs.push(unreliableLog);
      logs.push(`Rank/Dano: ${totalDmg}${isEffect ? " (Affliction)" : ""}. Aguardando resistência... (CD ${dcTotal})`);

      await this._writeBattle({
        status: "waiting_defense",
        attacker: by,
        attacker_pid: atkPid,
        target_id: tId,
        target_owner: tOwner,
        target_pid: tPid,
        attack_move: movePayload,
        power_rule: powerRule,
        unreliable_roll: unreliableGate?.unreliableRoll || null,
        unreliable_gate: firestoreSafeValue(unreliableGate?.applies ? unreliableGate : null),
        resistance_queue: resistanceQueue,
        attack_range: atkRange,
        atk_mod: atkMod,
        atk_base_mod: ctx.atkMod,
        rule_attack_mod: attackModifierSummary.attackBonus,
        attack_modifier_summary: attackModifierSummary,
        aceiro_bonus: aceiroBonus,
        d20: roll,
        defense_val: defenseVal,
        needed,
        total_atk: totalAtk,
        crit_bonus: critBonus,
        sneak_attack: isSneakAttack,
        dmg_base: totalDmg,
        is_effect: isEffect,
        extra_acc_mod: extraAccMod,
        extra_dmg_mod: extraDmgMod,
        last_attack_outcome: "hit_pending_resistance",
        secondary_available: true,
        secondary_active: false,
        pendingFor: tOwner,
        prompt: {
          type: "ROLL_RESIST",
          options: { dc: dcTotal, isEffect, rank: totalDmg, critBonus, powerRule, resistanceQueue },
        },
        logs,
      });

      this._showFloat(targetPiece, `🛡️ Resistência pendente (${tOwner})`, "pending");
    } else {
      const logs = [
        `${by} rolou ${roll}+${atkModStr}=${totalAtk} (vs Def ${needed} [${defenseVal}+10])${sneakTxt}... ${resultMsg}`,
      ];
      if (unreliableLog) logs.push(unreliableLog);
      if (extraModsTxt) logs.push(`Modificadores extras aplicados: ${extraModsTxt}.`);

      await this._writeBattle({
        status: "idle",
        attacker: by,
        attacker_pid: atkPid,
        target_id: tId,
        target_owner: tOwner,
        target_pid: tPid,
        attack_move: movePayload,
        power_rule: powerRule,
        unreliable_roll: unreliableGate?.unreliableRoll || null,
        unreliable_gate: firestoreSafeValue(unreliableGate?.applies ? unreliableGate : null),
        attack_range: atkRange,
        atk_mod: atkMod,
        atk_base_mod: ctx.atkMod,
        rule_attack_mod: attackModifierSummary.attackBonus,
        attack_modifier_summary: attackModifierSummary,
        aceiro_bonus: aceiroBonus,
        d20: roll,
        defense_val: defenseVal,
        needed,
        total_atk: totalAtk,
        crit_bonus: 0,
        sneak_attack: isSneakAttack,
        dmg_base: totalDmg,
        is_effect: isEffect,
        extra_acc_mod: extraAccMod,
        extra_dmg_mod: extraDmgMod,
        last_attack_outcome: "miss",
        secondary_available: false,
        secondary_active: false,
        pendingFor: null,
        prompt: null,
        logs,
      });
    }
  }

  async _executeRepeatOnTarget(targetPiece) {
    if (!this._lastMove) return;
    const by = this.getBy();
    await this._loadSheets(by);

    const atkPid = this._lastMove.attackerPid;
    const sheet = this._getSheet(by, atkPid);
    const moves = sheet?.moves || [];
    const stats = this._getEffectiveStats(by, atkPid);
    const preferredIdx = safeInt(this._lastMove.moveIdx, -1);
    const indexedMove = (preferredIdx >= 0 && preferredIdx < moves.length) ? moves[preferredIdx] : null;
    const mv = indexedMove || moves.find(m => safeStr(m.name) === this._lastMove.moveName);
    if (!mv) {
      this._showFloat(targetPiece, `❌ Golpe "${this._lastMove.moveName}" não encontrado`, "miss");
      return;
    }
    const moveIdx = resolveMoveIndex(moves, mv, preferredIdx);
    if (safeStr(this._lastMove.mode) === "area" || safeStr(this._lastMove.rangeStr) === "area") {
      this._launchAreaAttack(atkPid, targetPiece, mv, stats, { moveIdx });
      return;
    }
    this._executeAttack(atkPid, targetPiece, mv, stats, this._lastMove.rangeStr || "distance", {
      sneakAttack: !!this._lastMove.sneakAttack,
      moveIdx,
    });
  }

  _repeatLastMove() {
    const battle = this.getBattle();
    if (!battle || !this._lastMove) return;

    const tId = safeStr(battle.target_id);
    const pieces = this.getPieces() || [];
    const target = pieces.find(p => safeStr(p.id) === tId);
    if (!target) return;

    this._executeRepeatOnTarget(target);
  }

  _updateRepeatBtn() {
    if (!this._repeatBtn) return;
    if (this._lastMove && this._lastMove.moveName) {
      this._repeatBtn.textContent = `🔄 Repetir: ${this._lastMove.moveName}`;
      this._repeatBtn.style.display = "";
    } else {
      this._repeatBtn.style.display = "none";
    }
  }

  _sheetMoveMeta(move) {
    const rk = safeInt(move?.rank ?? move?.damage ?? move?.power ?? move?.lvl ?? 0, 0);
    const acc = safeInt(move?.accuracy ?? move?.acc ?? move?.acerto ?? 0, 0);
    const modeInfo = (typeof window.getMoveModeInfo === "function") ? (window.getMoveModeInfo(move) || null) : null;
    const area = modeInfo ? modeInfo.kind === "area" : !!(move?.is_area || move?.area || safeStr(move?.target).toLowerCase().includes("area"));
    return { rk, acc, area, modeInfo };
  }

  _renderSidebarSheet(piece, sheet) {
    const root = document.getElementById("arena_sheet_preview");
    if (!root) return;
    if (!piece || !sheet) {
      root.innerHTML = `<div class="arena-sheet-card"><div class="muted">Ficha não encontrada para esta peça.</div></div>`;
      return;
    }

    const by = this.getBy();
    const pid = safeStr(piece.pid);
    const owner = safeStr(piece.owner) || by;
    const identity = pieceBattleIdentity(piece, sheet);
    const effectiveSheet = identity.presentation?.effective_sheet || sheet;
    const pkm = effectiveSheet?.pokemon || sheet.pokemon || {};
    const name = safeStr(identity.name) || safeStr(pkm.name) || displayName(pid);
    const np = safeInt(effectiveSheet?.np || sheet?.np || pkm.np || 0, 0);
    const types = Array.isArray(identity.presentation?.resolved_types) && identity.presentation.resolved_types.length
      ? identity.presentation.resolved_types
      : (Array.isArray(pkm.types) ? pkm.types : []);
    const abilities = Array.isArray(identity.presentation?.resolved_abilities) && identity.presentation.resolved_abilities.length
      ? identity.presentation.resolved_abilities
      : (Array.isArray(pkm.abilities) ? pkm.abilities : []);
    const st = this._getEffectiveStats(owner, pid);
    const stgr = safeInt(st.stgr), intel = safeInt(st.int), thg = safeInt(st.thg), dodge = safeInt(st.dodge);
    const parry = safeInt(st.parry), fort = safeInt(st.fort), will = safeInt(st.will);

    const tData = this._partyStates[owner] || {};
    const pData = tData[pid] || {};
    const hp = (typeof window.getPartyHp === "function")
      ? safeInt(window.getPartyHp(owner, piece || { pid }), 6)
      : safeInt(pData.hp, 6);
    const hpMax = 6;
    const hpPct = Math.max(0, Math.min(100, (hp / hpMax) * 100));
    const hpCol = hp >= 5 ? "rgba(34,197,94,1)" : hp >= 3 ? "rgba(234,179,8,1)" : "rgba(239,68,68,1)";

    const movesRaw = Array.isArray(effectiveSheet?.moves) ? effectiveSheet.moves : (effectiveSheet?.moves ? Object.values(effectiveSheet.moves) : []);
    const moves = (typeof window.getPreferredMovesForTrainerPid === "function")
      ? window.getPreferredMovesForTrainerPid(owner, pid, movesRaw, 4)
      : movesRaw.filter((m) => m && typeof m === "object").slice(0, 4);
    const movesHtml = moves.length
      ? moves.map((mv) => {
          const mName = safeStr(mv.name || mv.nome || mv.Nome || "Golpe");
          const { rk, acc, area, modeInfo } = this._sheetMoveMeta(mv);
          const modeLabel = safeStr(modeInfo?.compactLabel || modeInfo?.label || (area ? "Área" : `Ac ${acc}`)) || `Ac ${acc}`;
          const modeStyle = safeStr(modeInfo?.style || (area ? "background:rgba(168,85,247,.12);border:1px solid rgba(168,85,247,.32);color:#a855f7;" : "background:rgba(56,189,248,.12);border:1px solid rgba(56,189,248,.32);color:#38bdf8;"));
          return `<div class="move-row"><div class="move-head"><span class="move-name">${escHtml(mName)}</span><span class="mv-pill" style="background:rgba(234,179,8,.12);border:1px solid rgba(234,179,8,.32);color:#eab308;">R${rk}</span><span class="mv-pill" style="${escHtml(modeStyle)}" title="${escHtml(safeStr(modeInfo?.label || modeLabel))}">${escHtml(modeLabel)}</span></div></div>`;
        }).join("")
      : `<div class="muted">Sem golpes nesta ficha.</div>`;

    const typeHtml = types.map((t) => `<span class="chip">${escHtml(safeStr(t))}</span>`).join("");
    const metaHtml = [
      identity.sizeLabel ? `<span class="chip">Tamanho ${escHtml(identity.sizeLabel)}</span>` : "",
      identity.formLabel ? `<span class="chip">Forma ${escHtml(identity.formLabel)}</span>` : "",
    ].filter(Boolean).join("");
    const abHtml = abilities.slice(0, 3).map((a) => `<span class="chip">${escHtml(safeStr(a))}</span>`).join("");
    const art = effectiveSpriteUrl(owner, piece, { type: "art", shiny: !!pData.shiny });

    root.innerHTML = `
      <div class="arena-sheet-card">
        <div class="sheet-top">
          <img class="sheet-art" src="${escHtml(art)}" alt="${escHtml(name)}" />
          <div style="flex:1;min-width:0;">
            <div class="sheet-name">${escHtml(name)}</div>
            <div class="sheet-sub">#${escHtml(pid)} • NP ${np}${identity.sizeLabel ? ` • ${escHtml(identity.sizeLabel)}` : ""}</div>
            ${metaHtml ? `<div class="chip-row">${metaHtml}</div>` : ""}
            <div class="chip-row">${typeHtml || `<span class="muted">Sem tipo</span>`}</div>
          </div>
        </div>
        ${abHtml ? `<div class="chip-row">${abHtml}</div>` : ""}
        <div class="hp-row"><span>HP</span><span>${hp}/${hpMax}</span></div>
        <div class="hp-track"><div class="hp-fill" style="width:${hpPct}%;background:${hpCol};"></div></div>
        <div class="stat-grid">
          <div class="stat-box"><div class="stat-label">Stgr</div><div class="stat-val">${stgr}</div></div>
          <div class="stat-box"><div class="stat-label">Int</div><div class="stat-val">${intel}</div></div>
          <div class="stat-box"><div class="stat-label">Thg</div><div class="stat-val">${thg}</div></div>
          <div class="stat-box"><div class="stat-label">Dodge</div><div class="stat-val">${dodge}</div></div>
          <div class="stat-box"><div class="stat-label">Parry</div><div class="stat-val">${parry}</div></div>
          <div class="stat-box"><div class="stat-label">Fort</div><div class="stat-val">${fort}</div></div>
          <div class="stat-box"><div class="stat-label">Will</div><div class="stat-val">${will}</div></div>
          <div class="stat-box"><div class="stat-label">Cap</div><div class="stat-val">${np * 2}</div></div>
        </div>
        <div class="section-title">Golpes</div>
        ${movesHtml}
      </div>
    `;
  }

  async _viewSheet(piece) {
    if (!piece) return;
    const by = (this.getBy() || "").toLowerCase();
    const owner = safeStr(piece.owner).toLowerCase();
    if (!by || owner !== by) return;

    if (piece?.id && typeof window.selectPiece === "function") {
      window.selectPiece(piece.id);
    }
    if (safeStr(piece?.kind) === "trainer" || safeStr(piece?.pid).startsWith("trainer_")) {
      return;
    }
    await this._loadSheets(safeStr(piece.owner) || this.getBy());
    const pid = safeStr(piece.pid);
    const sheet = this._getSheet(safeStr(piece.owner) || this.getBy(), pid);
    this._renderSidebarSheet(piece, sheet);
  }

  _showFloat(piece, text, type = "hit") {
    const pos = this._pieceScreenPos(piece);
    const offset = this._floats.filter(f => !f._removed).length * 35;

    const el = document.createElement("div");
    el.className = `ac-float ac-float-${type}`;
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y - offset}px`;
    el.textContent = text;

    this._overlayRoot.appendChild(el);

    const entry = { el, _removed: false };
    this._floats.push(entry);

    if (type !== "pending") {
      const duration = type === "stage" ? 5000 : 4000;
      setTimeout(() => {
        entry._removed = true;
        try { el.remove(); } catch {}
        this._floats = this._floats.filter(f => f !== entry);
      }, duration);
    }

    return entry;
  }

  _clearPendingFloats() {
    this._floats = this._floats.filter(f => {
      if (f.el.classList.contains("ac-float-pending")) {
        try { f.el.remove(); } catch {}
        f._removed = true;
        return false;
      }
      return true;
    });
  }

  renderCombatTab(root, battle = this.getBattle()) {
    if (!root || !battle) return false;

    const by = safeStr(this.getBy());
    const status = safeStr(battle.status) || "idle";
    const prompt = battle.prompt || null;
    const pendingFor = safeStr(battle.pendingFor);
    const canSecondary = status === "idle" && canOfferSecondaryEffect(battle, by);
    const arenaStatuses = new Set([
      "aoe_defense",
      "waiting_defense",
      "pending_reaction",
      "pending_reaction_review",
    ]);
    const shouldHandle = canSecondary || !!prompt || !!pendingFor || arenaStatuses.has(status);
    if (!shouldHandle || status === "setup") return false;

    this._syncBattlePrompts(battle);
    root.innerHTML = this._renderCombatTabArenaFlow(battle, {
      by,
      status,
      prompt,
      pendingFor,
      canSecondary,
    });
    this._bindCombatTabArenaFlow(root, battle);
    return true;
  }

  _renderCombatTabArenaFlow(battle, ctx = {}) {
    const logs = Array.isArray(battle?.logs) ? battle.logs : [];
    const lastLog = safeStr(logs[logs.length - 1] || "");
    const moveName = safeStr(battle?.attack_move?.name || battle?.power_rule?.name || "Golpe");
    const attacker = safeStr(battle?.attacker) || "-";
    const targetOwner = safeStr(battle?.target_owner) || "-";
    const targetName = displayName(battle?.target_pid || battle?.target_id || "");
    const status = safeStr(ctx.status) || "idle";
    const pendingFor = safeStr(ctx.pendingFor);
    const prompt = ctx.prompt || null;

    let actionHtml = "";
    if (ctx.canSecondary) {
      actionHtml = this._renderCombatTabSecondaryPrompt();
    } else if (pendingFor && pendingFor === safeStr(ctx.by) && prompt) {
      actionHtml = this._renderCombatTabPrompt(battle, prompt);
    } else if (pendingFor) {
      actionHtml = `
        <div class="card" style="margin-top:10px">
          <div style="font-weight:950;margin-bottom:6px">Aguardando acao</div>
          <div class="muted">Aguardando <strong>${escHtml(pendingFor)}</strong> responder pelo fluxo da arena.</div>
        </div>
      `;
    } else if (status === "pending_reaction_review") {
      actionHtml = `
        <div class="card" style="margin-top:10px">
          <div style="font-weight:950;margin-bottom:6px">Reacao aguardando revisao</div>
          <div class="muted">A resolucao precisa de revisao antes de continuar.</div>
        </div>
      `;
    } else {
      actionHtml = `
        <div class="card" style="margin-top:10px">
          <div style="font-weight:950;margin-bottom:6px">Fluxo da arena ativo</div>
          <div class="muted">As regras e o estado estao sincronizados com a arena.</div>
        </div>
      `;
    }

    return `
      <div class="card">
        <div style="font-weight:950;margin-bottom:8px">Fluxo unificado da arena</div>
        <div class="muted" style="margin-bottom:8px">
          Status: <strong>${escHtml(status)}</strong> &bull;
          Ataque: <strong>${escHtml(moveName)}</strong>
        </div>
        <div class="muted" style="margin-bottom:8px">
          ${escHtml(attacker)} -> ${escHtml(targetOwner)}${targetName && targetName !== "???" ? ` (${escHtml(targetName)})` : ""}
        </div>
        ${lastLog ? `<div class="cb-log-msg">${escHtml(lastLog)}</div>` : ""}
      </div>
      ${actionHtml}
    `;
  }

  _renderCombatTabPrompt(battle, prompt) {
    const type = safeStr(prompt?.type);
    if (type === "ROLL_RESIST") return this._renderCombatTabResistPrompt(prompt);
    if (type === "CONFIRM_HIT_RANK") return this._renderCombatTabRankPrompt(battle);
    if (type === "MM_REACTION") return this._renderCombatTabReactionPrompt(battle, prompt);
    if (type === "REROLL") return this._renderCombatTabRerollPrompt();
    return `
      <div class="card" style="margin-top:10px">
        <div style="font-weight:950;margin-bottom:6px">Opcao pendente</div>
        <div class="muted">Prompt da arena: ${escHtml(type || "desconhecido")}</div>
      </div>
    `;
  }

  _renderCombatTabResistPrompt(prompt) {
    const dc = safeInt(prompt?.options?.dc);
    const isEffect = !!prompt?.options?.isEffect;
    const isAoe = !!prompt?.options?.isAoe;
    return `
      <div class="card" style="margin-top:10px">
        <div style="font-weight:950;margin-bottom:6px">Resistir ao ataque</div>
        <div class="muted" style="margin-bottom:10px">
          CD ${dc} ${isEffect ? "(Efeito)" : "(Dano)"}${isAoe ? " - Area" : ""}
        </div>
        <div class="cb-defense-grid">
          <button class="btn secondary" data-ac-tab-def="dodge">Dodge</button>
          ${isAoe ? "" : `
          <button class="btn secondary" data-ac-tab-def="parry">Parry</button>
          <button class="btn secondary" data-ac-tab-def="fort">Fort</button>
          <button class="btn secondary" data-ac-tab-def="will">Will</button>
          <button class="btn secondary" data-ac-tab-def="thg">THG</button>
          `}
        </div>
      </div>
    `;
  }

  _renderCombatTabRankPrompt(battle) {
    const atk = battle?.attack_move || {};
    const moveDmg = safeInt(atk?.damage, safeInt(battle?.dmg_base));
    const parts = [];
    if (atk && atk.rank != null) {
      parts.push(`R${safeInt(atk.rank)} base`);
      if (atk.stat_value) parts.push(`+${safeInt(atk.stat_value)} ${safeStr(atk.based_stat)}`);
      if (atk.stab_bonus) parts.push(`+${safeInt(atk.stab_bonus)} STAB`);
      if (atk.type_bonus && safeInt(atk.type_bonus) !== 0) parts.push(`${signedMod(safeInt(atk.type_bonus))} tipo`);
      if (safeInt(atk.modDano, 0) !== 0) parts.push(`${signedMod(safeInt(atk.modDano, 0))} mod`);
      if (safeInt(battle?.crit_bonus)) parts.push(`+${safeInt(battle.crit_bonus)} crit`);
    }
    return `
      <div class="card" style="margin-top:10px">
        <div style="font-weight:950;margin-bottom:8px">Confirmar rank</div>
        ${parts.length ? `<div class="muted" style="margin-bottom:8px">${escHtml(parts.join(" "))}</div>` : ""}
        <label class="label" for="ac_tab_rank_input">Rank do Dano / Efeito</label>
        <input class="input" id="ac_tab_rank_input" type="number" value="${moveDmg}" min="0" style="margin-bottom:10px" />
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
          <input type="checkbox" id="ac_tab_rank_effect" />
          <label for="ac_tab_rank_effect" style="font-size:13px;font-weight:700">E efeito? (Affliction)</label>
        </div>
        <button class="btn" data-ac-tab-rank-confirm style="width:100%">Confirmar Rank</button>
      </div>
    `;
  }

  _renderCombatTabReactionPrompt(battle, prompt) {
    const reactions = Array.isArray(battle?.pending_reactions) ? battle.pending_reactions : [];
    const reaction = reactions.find((item) => safeStr(item?.id) === safeStr(prompt?.reactionId)) || this._firstPendingReaction(reactions);
    if (!reaction) {
      return `
        <div class="card" style="margin-top:10px">
          <div style="font-weight:950;margin-bottom:6px">Reacao pendente</div>
          <div class="muted">Fila de reacao vazia ou ja resolvida.</div>
        </div>
      `;
    }
    const validTargets = (reaction.validTargets || [])
      .map((target) => safeStr(target.label || target.pieceId || target.pid))
      .filter(Boolean)
      .join(", ") || "alvo do ataque";
    return `
      <div class="card" style="margin-top:10px">
        <div style="font-weight:950;margin-bottom:6px">Reacao disponivel</div>
        <div style="font-weight:800;margin-bottom:6px">${escHtml(reaction.powerName || "Power")}</div>
        <div class="muted" style="margin-bottom:10px">
          ${escHtml(reaction.eventSummary || "Ataque recebido")}<br>
          Custo/limite: ${escHtml(reaction.cost || "sem limite fixo")}<br>
          Alvos validos: ${escHtml(validTargets)}
        </div>
        <div class="cb-defense-grid">
          <button class="btn" data-ac-tab-reaction="accept">${escHtml(reaction.accept?.label || "Ativar")}</button>
          <button class="btn secondary" data-ac-tab-reaction="ignore">${escHtml(reaction.ignore?.label || "Ignorar")}</button>
        </div>
      </div>
    `;
  }

  _renderCombatTabRerollPrompt() {
    return `
      <div class="card" style="margin-top:10px">
        <div style="font-weight:950;margin-bottom:6px">Deseja usar Re-roll?</div>
        <div class="cb-defense-grid">
          <button class="btn" data-ac-tab-reroll="yes">Rerollar</button>
          <button class="btn secondary" data-ac-tab-reroll="no">Manter</button>
        </div>
      </div>
    `;
  }

  _renderCombatTabSecondaryPrompt() {
    return `
      <div class="card" style="margin-top:10px">
        <div style="font-weight:950;margin-bottom:6px">Efeito secundario?</div>
        <div class="muted" style="margin-bottom:10px">Ative se o ataque tambem causar envenenar, paralisar ou outro efeito.</div>
        <div class="cb-defense-grid">
          <button class="btn" data-ac-tab-secondary="yes">Ativar Efeito</button>
          <button class="btn secondary" data-ac-tab-secondary="no">Encerrar</button>
        </div>
      </div>
    `;
  }

  _bindCombatTabArenaFlow(root, battle) {
    root.querySelectorAll("[data-ac-tab-def]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._disableCombatTabButtons(root, "Rolando...");
        const clicked = this._clickArenaPromptControl(battle, `[data-def="${btn.dataset.acTabDef}"]`);
        if (!clicked) this._restoreCombatTabButtons(root);
      });
    });

    root.querySelector("[data-ac-tab-rank-confirm]")?.addEventListener("click", () => {
      this._disableCombatTabButtons(root, "Confirmando...");
      const rankValue = safeInt(root.querySelector("#ac_tab_rank_input")?.value);
      const isEffect = !!root.querySelector("#ac_tab_rank_effect")?.checked;
      this._clickArenaPromptControl(battle, "#ac-rank-confirm", {
        prepare: (promptEl) => {
          const input = promptEl.querySelector("#ac-rank-input");
          const check = promptEl.querySelector("#ac-rank-effect");
          if (input) input.value = String(rankValue);
          if (check) check.checked = isEffect;
        },
      }) || this._restoreCombatTabButtons(root);
    });

    root.querySelectorAll("[data-ac-tab-reaction]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._disableCombatTabButtons(root, btn.dataset.acTabReaction === "accept" ? "Ativando..." : "Ignorando...");
        const clicked = this._clickArenaPromptControl(battle, `[data-act="${btn.dataset.acTabReaction}"]`);
        if (!clicked) this._restoreCombatTabButtons(root);
      });
    });

    root.querySelectorAll("[data-ac-tab-reroll]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._disableCombatTabButtons(root, btn.dataset.acTabReroll === "yes" ? "Rerolando..." : "Mantendo...");
        this._syncBattlePrompts(battle);
        const selector = btn.dataset.acTabReroll === "yes" ? "#ac-reroll-yes" : "#ac-reroll-no";
        const sourceBtn = this._currentReroll?.querySelector(selector);
        if (sourceBtn) sourceBtn.click();
        else if (btn.dataset.acTabReroll === "yes") this._doReroll();
        else this._keepRoll();
      });
    });

    root.querySelectorAll("[data-ac-tab-secondary]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._disableCombatTabButtons(root, btn.dataset.acTabSecondary === "yes" ? "Ativando..." : "Encerrando...");
        const selector = btn.dataset.acTabSecondary === "yes" ? "#ac-sec-yes" : "#ac-sec-no";
        const clicked = this._clickArenaPromptControl(battle, selector);
        if (!clicked) this._restoreCombatTabButtons(root);
      });
    });
  }

  _disableCombatTabButtons(root, text = "...") {
    root.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
      if (!button.dataset.acOriginalText) button.dataset.acOriginalText = button.textContent || "";
      button.textContent = text;
      button.style.opacity = "0.6";
    });
  }

  _restoreCombatTabButtons(root) {
    root.querySelectorAll("button").forEach((button) => {
      button.disabled = false;
      if (button.dataset.acOriginalText) button.textContent = button.dataset.acOriginalText;
      button.style.opacity = "";
    });
  }

  _clickArenaPromptControl(battle, selector, opts = {}) {
    this._syncBattlePrompts(battle);
    const promptEl = this._currentPrompt;
    const sourceBtn = promptEl?.querySelector(selector);
    if (!sourceBtn) return false;
    if (typeof opts.prepare === "function") opts.prepare(promptEl, sourceBtn);
    sourceBtn.click();
    return true;
  }

  _syncBattlePrompts(battle) {
    if (!battle) {
      this._clearPendingFloats();
      this._closePrompt();
      this._closeReroll();
      return;
    }

    const by = this.getBy();
    const pendingFor = safeStr(battle.pendingFor);
    const prompt = battle.prompt;
    const status = safeStr(battle.status);

    if (status === "idle") {
      this._clearPendingFloats();
      this._closePrompt();
      this._closeReroll();

      const canSecondary = canOfferSecondaryEffect(battle, by);
      if (canSecondary && !this._currentPrompt) {
        this._renderSecondaryEffectPrompt(battle);
      }
      return;
    }

    if (pendingFor === by && prompt) {
      const promptKey = this._battlePromptKey(battle, prompt);
      if (this._currentPrompt && this._currentPrompt._acPromptKey !== promptKey) {
        this._closePrompt();
      }
      if (prompt.type === "ROLL_RESIST" && !this._currentPrompt) {
        this._renderResistPrompt(battle, prompt);
      } else if (prompt.type === "CONFIRM_HIT_RANK" && !this._currentPrompt) {
        this._renderRankPrompt(battle, prompt);
      } else if (prompt.type === "MM_REACTION" && !this._currentPrompt) {
        this._renderReactionPrompt(battle, prompt);
      } else if (prompt.type === "REROLL" && !this._currentReroll) {
        this._renderRerollToast(battle, prompt);
      }
    } else if (pendingFor && pendingFor !== by) {
      this._closePrompt();
      this._closeReroll();
    }
  }

  render() {
    const battle = this.getBattle();
    if (!battle) { this._clearPendingFloats(); this._closePrompt(); this._closeReroll(); return; }

    const by = this.getBy();
    const pendingFor = safeStr(battle.pendingFor);
    const prompt = battle.prompt;
    const status = safeStr(battle.status);

    this._updateTimeline(battle);

    if (status === "idle") {
      this._clearPendingFloats();
      this._closePrompt();
      this._closeReroll();

      // Verifica se há combate anterior para Efeito Secundário
      const canSecondary = canOfferSecondaryEffect(battle, by);
      if (canSecondary && !this._currentPrompt) {
        this._renderSecondaryEffectPrompt(battle);
      }
      return;
    }

    if (pendingFor === by && prompt) {
      const promptKey = this._battlePromptKey(battle, prompt);
      if (this._currentPrompt && this._currentPrompt._acPromptKey !== promptKey) {
        this._closePrompt();
      }
      if (prompt.type === "ROLL_RESIST" && !this._currentPrompt) {
        this._renderResistPrompt(battle, prompt);
      } else if (prompt.type === "CONFIRM_HIT_RANK" && !this._currentPrompt) {
        this._renderRankPrompt(battle, prompt);
      } else if (prompt.type === "MM_REACTION" && !this._currentPrompt) {
        this._renderReactionPrompt(battle, prompt);
      } else if (prompt.type === "REROLL" && !this._currentReroll) {
        this._renderRerollToast(battle, prompt);
      }
    } else if (pendingFor && pendingFor !== by) {
      this._closePrompt();
      this._closeReroll();
    }
  }

  _battlePromptKey(battle, prompt) {
    const options = prompt?.options || {};
    const queue = Array.isArray(options.resistanceQueue)
      ? options.resistanceQueue.map((item) => [
          safeStr(item?.effectId),
          safeStr(item?.type),
          safeStr(item?.resistance),
          safeInt(item?.dc),
          safeInt(item?.rank),
        ].join(":")).join(",")
      : "";
    return [
      safeStr(battle?.status),
      safeStr(battle?.pendingFor),
      safeStr(prompt?.type),
      safeStr(prompt?.reactionId),
      prompt?.secondary === true ? "secondary" : "",
      safeInt(options.dc),
      options.isEffect ? "effect" : "damage",
      options.isAoe ? "aoe" : "single",
      safeStr(options.aoePhase),
      safeInt(options.rank, safeInt(battle?.dmg_base)),
      safeInt(options.critBonus, safeInt(battle?.crit_bonus)),
      queue,
    ].join("|");
  }

  _markBattlePrompt(el, battle, prompt) {
    if (el) el._acPromptKey = this._battlePromptKey(battle, prompt);
  }

  _renderReactionPrompt(battle, prompt) {
    this._closePrompt();
    const reactions = Array.isArray(battle?.pending_reactions) ? battle.pending_reactions : [];
    const reaction = reactions.find((item) => safeStr(item?.id) === safeStr(prompt?.reactionId)) || this._firstPendingReaction(reactions);
    if (!reaction) {
      this._advanceOrContinuePendingAttack(battle, reactions, ["Fila de reacao vazia; ataque retomado."]);
      return;
    }

    const anchorId = safeStr(reaction?.validTargets?.[0]?.pieceId || battle?.target_id);
    const anchorPiece = (this.getPieces() || []).find((piece) => safeStr(piece?.id) === anchorId);
    const pos = anchorPiece ? this._pieceScreenPos(anchorPiece) : { x: 220, y: 220 };
    const el = document.createElement("div");
    el.className = "ac-prompt";
    const cpos = this._clampPos(pos.x + 42, pos.y - 34, 292, 230);
    el.style.left = `${cpos.x}px`;
    el.style.top = `${cpos.y}px`;

    const validTargets = (reaction.validTargets || [])
      .map((target) => safeStr(target.label || target.pieceId || target.pid))
      .filter(Boolean)
      .join(", ") || "alvo do ataque";
    el.innerHTML = `
      <div class="ac-prompt-title">Reacao disponivel</div>
      <div class="ac-prompt-dc">${escHtml(reaction.powerName || "Power")}</div>
      <div style="font-size:11px;color:rgba(148,163,184,.78);margin-bottom:8px">
        ${escHtml(reaction.eventSummary || "Ataque recebido")}<br>
        Custo/limite: ${escHtml(reaction.cost || "sem limite fixo")}<br>
        Alvos validos: ${escHtml(validTargets)}
      </div>
      <div class="ac-prompt-grid">
        <button class="ac-prompt-btn ac-special" data-act="accept">${escHtml(reaction.accept?.label || "Ativar")}</button>
        <button class="ac-prompt-btn" data-act="ignore">${escHtml(reaction.ignore?.label || "Ignorar")}</button>
      </div>
    `;
    this._overlayRoot.appendChild(el);
    this._currentPrompt = el;
    this._markBattlePrompt(el, battle, prompt);

    el.querySelector('[data-act="ignore"]')?.addEventListener("click", async () => {
      el.querySelectorAll("button").forEach((btn) => { btn.disabled = true; });
      const nextReactions = reactions.map((item) => (
        safeStr(item?.id) === safeStr(reaction.id)
          ? { ...item, status: "ignored", resolvedAtLocal: new Date().toISOString() }
          : item
      ));
      this._closePrompt();
      await this._advanceOrContinuePendingAttack(battle, nextReactions, [this._reactionLogLine(reaction, null, "ignored")]);
    });

    el.querySelector('[data-act="accept"]')?.addEventListener("click", async () => {
      el.querySelectorAll("button").forEach((btn) => { btn.disabled = true; });
      const roll = await this._rollD20Animated(`Reacao - ${safeStr(reaction.powerName || "Power")}`);
      await this._publishRoll(roll, `Reacao • ${safeStr(reaction.powerName || "Power")}`);
      const resolution = resolveCombatEvent({
        type: "reactionDecision",
        reaction,
        attack: battle?.pending_attack || {},
      }, {}, {
        accept: true,
        reaction,
        attack: battle?.pending_attack || {},
        d20: roll,
      }, mmRuntimeEnv());
      const resolutionId = await this._persistMmResolution(resolution, { applied: true, reaction: true });
      this._showResolutionToast(resolution, resolutionId);
      const reactionNeedsReview = !resolution?.blocked
        && (!!resolution?.requiresAdjudication || (Array.isArray(resolution?.pendingDecisions) && resolution.pendingDecisions.length > 0));
      const nextReactions = reactions.map((item) => (
        safeStr(item?.id) === safeStr(reaction.id)
          ? {
              ...item,
              status: resolution?.blocked ? "blocked" : (reactionNeedsReview ? "awaiting_decision" : "resolved"),
              resolutionId: resolutionId || null,
              result: firestoreSafeValue(resolution?.effectResults?.[0] || {}),
              resolvedAtLocal: new Date().toISOString(),
            }
          : item
      ));
      const line = this._reactionLogLine(reaction, resolution, "accepted");
      this._closePrompt();
      if (resolution?.blocked) {
        await this._writeBattle({
          status: "idle",
          pending_reactions: firestoreSafeValue(nextReactions),
          pending_attack: null,
          last_resolution_id: resolutionId || null,
          last_attack_outcome: "blocked",
          secondary_available: false,
          secondary_active: false,
          pending_review: false,
          pendingFor: null,
          prompt: null,
          logs: (Array.isArray(battle?.logs) ? battle.logs : []).concat([line, resolution.summary]),
        });
        const targetPiece = (this.getPieces() || []).find((piece) => safeStr(piece?.id) === safeStr(battle?.target_id));
        if (targetPiece) this._showFloat(targetPiece, "Ataque bloqueado", "resist");
        return;
      }
      if (reactionNeedsReview) {
        await this._writeBattle({
          status: "pending_reaction_review",
          pending_reactions: firestoreSafeValue(nextReactions),
          pending_attack: firestoreSafeValue(battle?.pending_attack || null),
          pending_decisions: firestoreSafeValue(resolution?.pendingDecisions || []),
          last_resolution_id: resolutionId || null,
          last_attack_outcome: "reaction_pending_review",
          secondary_available: false,
          secondary_active: false,
          pending_review: true,
          pendingFor: null,
          prompt: null,
          logs: (Array.isArray(battle?.logs) ? battle.logs : []).concat([line, resolution.summary]),
        });
        const targetPiece = (this.getPieces() || []).find((piece) => safeStr(piece?.id) === safeStr(battle?.target_id));
        if (targetPiece) this._showFloat(targetPiece, "Reacao aguardando revisao", "pending");
        return;
      }
      await this._advanceOrContinuePendingAttack(battle, nextReactions, [line]);
    });
  }

  _renderSecondaryEffectPrompt(battle) {
    const tId = safeStr(battle.target_id);
    const pieces = this.getPieces() || [];
    const targetPiece = pieces.find(p => safeStr(p.id) === tId);
    if (!targetPiece) return;

    const pos = this._pieceScreenPos(targetPiece);
    const el = document.createElement("div");
    el.className = "ac-prompt";
    const cpos = this._clampPos(pos.x + 40, pos.y - 30, 260, 150);
    el.style.left = `${cpos.x}px`;
    el.style.top = `${cpos.y}px`;

    el.innerHTML = `
      <div class="ac-prompt-title">⚡ Efeito Secundário?</div>
      <div style="font-size:11px;color:rgba(148,163,184,.7);margin-bottom:8px">Ative se o seu ataque causar também envenenar, paralisar, etc.</div>
      <div class="ac-prompt-grid">
        <button class="ac-prompt-btn ac-special" id="ac-sec-yes">⚡ Ativar Efeito</button>
        <button class="ac-prompt-btn" id="ac-sec-no">Encerrar</button>
      </div>
    `;

    this._overlayRoot.appendChild(el);
    this._currentPrompt = el;

    el.querySelector("#ac-sec-yes").addEventListener("click", async () => {
      el.querySelector("#ac-sec-yes").disabled = true;
      const ref = this._battleRef(); if (!ref) return;
      this._closePrompt();
      await this._writeBattle({
        status: "hit_confirmed",
        secondary_active: true,
        secondary_available: false,
        secondary_parent_power_rule: firestoreSafeValue(battle?.power_rule || battle?.attack_move?.power_rule || null),
        last_attack_outcome: "secondary_pending_rank",
        pendingFor: this.getBy(),
        prompt: { type: "CONFIRM_HIT_RANK", secondary: true },
        logs: arrayUnion("⚡ Efeito secundário ativado — defina o rank do efeito.")
      });
    });

    el.querySelector("#ac-sec-no").addEventListener("click", () => {
      this._closePrompt();
      const ref = this._battleRef();
      if (ref) this._writeBattle({ target_id: "", secondary_available: false, secondary_active: false });
    });
  }

  _renderResistPrompt(battle, prompt) {
    this._closePrompt();
    this._clearPendingFloats();

    const tPid = safeStr(battle.target_pid);
    const tOwner = safeStr(battle.target_owner);
    const tId = safeStr(battle.target_id);
    const pieces = this.getPieces() || [];
    const targetPiece = pieces.find(p => safeStr(p.id) === tId);

    const dc = safeInt(prompt.options?.dc);
    const isEffect = !!prompt.options?.isEffect;
    const isAoe = !!prompt.options?.isAoe;

    const pos = targetPiece ? this._pieceScreenPos(targetPiece) : { x: 200, y: 200 };
    const el = document.createElement("div");
    el.className = "ac-prompt";
    const cpos = this._clampPos(pos.x + 40, pos.y - 30, 260, 250);
    el.style.left = `${cpos.x}px`;
    el.style.top = `${cpos.y}px`;

    el.innerHTML = `
      <div class="ac-prompt-title">🛡️ Resistir ao ataque!</div>
      <div class="ac-prompt-dc">CD ${dc} ${isEffect ? "(Efeito)" : "(Dano)"}${isAoe ? " — Área" : ""}</div>
      <div style="font-size:11px;color:rgba(148,163,184,.7);margin-bottom:8px">${isAoe ? "Dodge obrigatório da área:" : "Escolha a resistência:"}</div>
      <div class="ac-prompt-grid">
        <button class="ac-prompt-btn" data-def="dodge">Dodge</button>
        ${isAoe ? "" : `
        <button class="ac-prompt-btn" data-def="parry">Parry</button>
        <button class="ac-prompt-btn" data-def="fort">Fort</button>
        <button class="ac-prompt-btn" data-def="will">Will</button>
        <button class="ac-prompt-btn ac-wide" data-def="thg">THG (Toughness)</button>
        `}
      </div>
    `;

    this._overlayRoot.appendChild(el);
    this._currentPrompt = el;
    this._markBattlePrompt(el, battle, prompt);

    el.querySelectorAll("[data-def]").forEach(btn => {
      btn.addEventListener("click", async () => {
        el.querySelectorAll("[data-def]").forEach(b => { b.disabled = true; b.style.opacity = "0.4"; });
        btn.textContent = "⏳ Rolando...";

        const defType = btn.dataset.def;
        const by = this.getBy();
        const tOwner = safeStr(battle?.target_owner) || by;
        const tStats = this._getEffectiveStats(tOwner, tPid);
        const statVal = safeInt(tStats[defType]);

        const roll = await this._rollD20Animated(`Defesa - ${defType.toUpperCase()}`);
        await this._publishRoll(roll, `Defesa • ${defType.toUpperCase()}`);
        const checkTotal = roll + statVal;

        if (isAoe) {
          const baseRank = safeInt(battle.dmg_base);
          let finalRank, msg;
          if (checkTotal >= dc) {
            finalRank = baseRank <= 0 ? 0 : Math.max(1, Math.floor(baseRank / 2));
            msg = `Sucesso no Dodge! (${checkTotal} vs ${dc}). Rank: ${baseRank}→${finalRank}`;
          } else {
            finalRank = baseRank;
            msg = `Falha no Dodge! (${checkTotal} vs ${dc}). Rank total: ${finalRank}`;
          }

          if (targetPiece) this._showFloat(targetPiece, `🛡️ ${msg}`, "resist");

          this._closePrompt();

          const isEff = !!battle.is_effect;
          const powerRule = battle?.power_rule || battle?.attack_move?.power_rule || await getPowerRuleForMove(battle?.attack_move || {});
          const resistanceQueue = buildResistanceQueue(powerRule, {
            rank: finalRank,
            critBonus: safeInt(battle.crit_bonus),
            fallbackIsEffect: isEff,
            fallbackResistance: isEff ? "fort" : "thg",
          });
          const newDc = safeInt(resistanceQueue?.[0]?.dc, (isEff ? 10 : 15) + finalRank + safeInt(battle.crit_bonus));

          await this._writeBattle({
            status: "waiting_defense",
            dmg_base: finalRank,
            unreliable_roll: safeInt(battle?.unreliable_roll, 0) || null,
            unreliable_gate: firestoreSafeValue(battle?.unreliable_gate || null),
            pendingFor: tOwner,
            resistance_queue: resistanceQueue,
            aoe_source: true,
            last_attack_outcome: "area_dodge_resolved",
            secondary_available: false,
            secondary_active: false,
            prompt: { type: "ROLL_RESIST", options: { dc: newDc, isEffect: isEff, isAoe: false, powerRule, resistanceQueue } },
            logs: arrayUnion(`${msg}. Agora escolha como resistir (CD ${newDc}).`),
          });
        } else {
          const diff = dc - checkTotal;
          let barsLost, resMsg;
          if (diff <= 0) {
            barsLost = 0;
            resMsg = "SUCESSO! Nenhum dano.";
          } else {
            barsLost = Math.ceil(diff / 5);
            resMsg = `FALHA por ${diff} — ${barsLost} barra(s)`;
          }

          let finalMsg = `🛡️ ${roll}+${statVal}=${checkTotal} (${defType.toUpperCase()}) vs CD ${dc}. ${resMsg}`;

          if (targetPiece) {
            this._showFloat(targetPiece, `🛡️ ${checkTotal} vs ${dc} — ${barsLost > 0 ? "FALHA" : "SUCESSO"}`, "resist");
            if (barsLost > 0) {
              setTimeout(() => {
                if (targetPiece) this._showFloat(targetPiece, `−${barsLost} barra(s)`, "stage");
              }, 600);
            }
          }

          const { resolution, resolutionId } = await this._finalizeMmResistance({
            battle,
            prompt,
            roll,
            defType,
            targetPiece,
          });
          const reviewMsg = resolution?.requiresAdjudication
            ? `${resolution.summary}. RevisÃ£o do mestre necessÃ¡ria.`
            : resolution.summary;
          const allowSecondaryAfterResistance = shouldOfferSecondaryAfterResistance(battle);

          await this._writeBattle({
            status: "idle",
            last_resolution_id: resolutionId || null,
            pending_review: !!resolution?.requiresAdjudication,
            last_attack_outcome: battle?.secondary_active ? "secondary_resolved" : "hit_resolved",
            secondary_available: allowSecondaryAfterResistance,
            secondary_active: false,
            pendingFor: null,
            prompt: null,
            logs: arrayUnion(finalMsg, reviewMsg),
          });
          this._closePrompt();
        }
      });
    });
  }

  _renderRankPrompt(battle, prompt) {
    this._closePrompt();

    const tId = safeStr(battle.target_id);
    const pieces = this.getPieces() || [];
    const targetPiece = pieces.find(p => safeStr(p.id) === tId);

    const atk = battle.attack_move;
    const moveDmg = atk?.damage || 0;
    
    // Breakdown de como o Dano final foi gerado
    let breakdownHtml = "";
    if (atk && atk.rank != null) {
      const parts = [];
      parts.push(`R${atk.rank} base`);
      if (atk.stat_value) parts.push(`+${atk.stat_value} ${atk.based_stat || ""}`);
      if (atk.stab_bonus) parts.push(`+${atk.stab_bonus} STAB`);
      if (atk.type_bonus && atk.type_bonus !== 0) parts.push(`${atk.type_bonus > 0 ? '+' : ''}${atk.type_bonus} tipo`);
      if (safeInt(atk.modDano, 0) !== 0) parts.push(`${signedMod(safeInt(atk.modDano, 0))} mod`);
      const critBonus = safeInt(battle.crit_bonus);
      if (critBonus) parts.push(`+${critBonus} crit`);
      breakdownHtml = `<div style="font-size:10px;color:rgba(56,189,248,.8);margin:4px 0 6px">${escHtml(parts.join(" "))}</div>`;
    }

    const pos = targetPiece ? this._pieceScreenPos(targetPiece) : { x: 200, y: 200 };
    const el = document.createElement("div");
    el.className = "ac-prompt";
    const cpos = this._clampPos(pos.x + 40, pos.y - 30, 260, 210);
    el.style.left = `${cpos.x}px`;
    el.style.top = `${cpos.y}px`;

    el.innerHTML = `
      <div class="ac-prompt-title">✅ Acerto Confirmado!</div>
      <div style="margin-bottom:8px">
        <label style="font-size:11px;color:rgba(148,163,184,.7)">Rank do Dano / Efeito</label>
        ${breakdownHtml}
        <input class="ac-search" id="ac-rank-input" type="number" value="${safeInt(moveDmg)}" min="0" style="margin-top:2px" />
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
        <input type="checkbox" id="ac-rank-effect" />
        <label for="ac-rank-effect" style="font-size:12px;font-weight:700;color:rgba(226,232,240,.85)">É efeito? (Affliction)</label>
      </div>
      <button class="ac-prompt-btn ac-wide" id="ac-rank-confirm">Confirmar Rank</button>
    `;

    this._overlayRoot.appendChild(el);
    this._currentPrompt = el;
    this._markBattlePrompt(el, battle, prompt);

    el.querySelector("#ac-rank-confirm").addEventListener("click", async () => {
      const btn = el.querySelector("#ac-rank-confirm");
      btn.disabled = true; btn.textContent = "⏳...";

      const dmg = safeInt(el.querySelector("#ac-rank-input").value);
      const isEff = el.querySelector("#ac-rank-effect").checked;
      const tOwner = safeStr(battle.target_owner);
      const isSecondary = battle?.secondary_active === true || prompt?.secondary === true;
      const critBonus = isSecondary ? 0 : safeInt(battle.crit_bonus);
      const powerRule = isSecondary
        ? buildManualSecondaryPowerRule(dmg, isEff)
        : (battle?.power_rule || battle?.attack_move?.power_rule || null);
      const resistanceQueue = buildResistanceQueue(powerRule, {
        rank: dmg,
        critBonus,
        fallbackIsEffect: isEff,
        fallbackResistance: isEff ? "fort" : "thg",
      });
      const dcTotal = safeInt(resistanceQueue?.[0]?.dc, (isEff ? 10 : 15) + dmg + critBonus);
      const secondaryMove = isSecondary ? {
        name: isEff ? "Secondary Affliction" : "Secondary Damage",
        accuracy: 0,
        damage: dmg,
        rank: dmg,
        based_stat: "",
        stat_value: 0,
        modDano: 0,
        source_attack_name: safeStr(atk?.name),
        meta: { secondary: true, category: isEff ? "Status" : "Physical", is_effect: isEff },
        power_rule: powerRule,
      } : null;

      this._closePrompt();
      await this._writeBattle({
        status: "waiting_defense",
        ...(isSecondary ? { attack_move: firestoreSafeValue(secondaryMove) } : {}),
        power_rule: firestoreSafeValue(powerRule || null),
        resistance_queue: firestoreSafeValue(resistanceQueue),
        dmg_base: dmg,
        is_effect: isEff,
        crit_bonus: critBonus,
        last_attack_outcome: isSecondary ? "secondary_pending_resistance" : "hit_pending_resistance",
        secondary_active: isSecondary,
        secondary_available: false,
        pendingFor: tOwner,
        prompt: { type: "ROLL_RESIST", options: { dc: dcTotal, isEffect: isEff, rank: dmg, critBonus, powerRule, resistanceQueue } },
        logs: arrayUnion(`Rank/Dano: ${dmg} (${isEff ? "Efeito" : "Dano"}). CD ${dcTotal}. Aguardando resistência...`),
      });
    });
  }

  _renderRerollToast(battle, prompt) {
    this._closeReroll();

    const el = document.createElement("div");
    el.className = "ac-reroll-toast";
    el.innerHTML = `
      <span class="ac-reroll-text">🎲 Deseja usar Re-roll?</span>
      <button class="ac-reroll-btn ac-primary" id="ac-reroll-yes">Rerollar (R)</button>
      <button class="ac-reroll-btn" id="ac-reroll-no">Manter (Enter)</button>
      <div class="ac-reroll-timer"><div class="ac-reroll-timer-bar" id="ac-reroll-bar" style="width:100%"></div></div>
    `;

    this._overlayRoot.appendChild(el);
    this._currentReroll = el;

    const TIMEOUT = 8000;
    const start = Date.now();
    this._rerollInterval = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.max(0, 1 - elapsed / TIMEOUT) * 100;
      const bar = el.querySelector("#ac-reroll-bar");
      if (bar) bar.style.width = `${pct}%`;
      if (elapsed >= TIMEOUT) {
        this._keepRoll();
      }
    }, 50);

    el.querySelector("#ac-reroll-yes").addEventListener("click", () => this._doReroll());
    el.querySelector("#ac-reroll-no").addEventListener("click", () => this._keepRoll());
  }

  async _doReroll() {
    this._closeReroll();
    const battle = this.getBattle();
    if (!battle) return;

    const roll = await this._rollD20Animated("Re-roll");
    await this._publishRoll(roll, "Re-roll");

    const atkMod = safeInt(battle.atk_mod);
    const aceiroBonus = safeInt(battle.aceiro_bonus);
    const extraAccMod = safeInt(battle.extra_acc_mod, 0);
    const totalAtk = atkMod + aceiroBonus + roll;
    const needed = safeInt(battle.needed);
    const powerRule = battle?.power_rule || battle?.attack_move?.power_rule || {};
    const attackerStats = this._getEffectiveStats(safeStr(battle.attacker), safeStr(battle.attacker_pid));
    const attackOutcome = resolveAttackHitAndCritical({ roll, totalAtk, needed, powerRule, attackerStats });
    const hit = attackOutcome.hit;
    const critBonus = attackOutcome.critBonus;

    const tId = safeStr(battle.target_id);
    const pieces = this.getPieces() || [];
    const targetPiece = pieces.find(p => safeStr(p.id) === tId);

    const ruleAttackMod = safeInt(battle.rule_attack_mod, 0);
    const atkBaseMod = safeInt(battle.atk_base_mod, atkMod - extraAccMod - ruleAttackMod);
    const atkModStr = buildAttackRollText(atkBaseMod, extraAccMod, aceiroBonus, ruleAttackMod);
    const rollText = `Re-roll d20=${roll}+${atkModStr}=${totalAtk} vs DEF ${needed}`;
    
    if (hit) {
      if (targetPiece) this._showFloat(targetPiece, `🔄 ACERTOU ✅ (${rollText})`, critBonus ? "crit" : "hit");
      const damage = safeInt(battle.dmg_base) || safeInt(battle.attack_move?.damage);
      const dcTotal = 15 + damage + critBonus;

      await this._writeBattle({
        status: "waiting_defense",
        d20: roll, total_atk: totalAtk, crit_bonus: critBonus,
        attack_modifier_summary: firestoreSafeValue(attackOutcome || null),
        unreliable_roll: safeInt(battle?.unreliable_roll, 0) || null,
        unreliable_gate: firestoreSafeValue(battle?.unreliable_gate || null),
        last_attack_outcome: "hit_pending_resistance",
        secondary_available: true,
        secondary_active: false,
        pendingFor: safeStr(battle.target_owner),
        prompt: { type: "ROLL_RESIST", options: { dc: dcTotal, isEffect: false } },
        logs: arrayUnion(`Re-roll: ${roll}+${atkModStr}=${totalAtk} vs ${needed}. ACERTOU!`),
      });
    } else {
      if (targetPiece) this._showFloat(targetPiece, `🔄 ERROU ❌ (${rollText})`, "miss");
      await this._writeBattle({
        status: "idle",
        d20: roll, total_atk: totalAtk, crit_bonus: 0,
        attack_modifier_summary: firestoreSafeValue(attackOutcome || null),
        unreliable_roll: null,
        unreliable_gate: null,
        last_attack_outcome: "miss",
        secondary_available: false,
        secondary_active: false,
        pendingFor: null, prompt: null,
        logs: arrayUnion(`Re-roll: ${roll}+${atkModStr}=${totalAtk} vs ${needed}. ERROU!`),
      });
    }
  }

  async _keepRoll() {
    this._closeReroll();
  }

  _updateTimeline(battle) {
    const status = safeStr(battle.status);
    if (status === "idle") {
      if (this._timeline) { this._timeline.remove(); this._timeline = null; }
      return;
    }

    if (!this._timeline) {
      this._timeline = document.createElement("div");
      this._timeline.className = "ac-timeline";
      this._overlayRoot.appendChild(this._timeline);
    }

    const steps = [
      { label: "Golpe", done: ["setup", "hit_confirmed", "waiting_defense", "missed", "aoe_defense"].includes(status) },
      { label: "Ataque", done: ["hit_confirmed", "waiting_defense", "missed", "aoe_defense"].includes(status) },
      { label: "Resistência", done: false, active: status === "waiting_defense" || status === "aoe_defense" },
      { label: "Resultado", done: false },
    ];

    this._timeline.innerHTML = steps.map((s, i) => {
      const cls = s.done ? "ac-tl-done" : s.active ? "ac-tl-active" : "";
      const arrow = i < steps.length - 1 ? `<span class="ac-tl-arrow">→</span>` : "";
      return `<span class="ac-tl-step ${cls}">${s.done ? "✅" : s.active ? "⏳" : "○"} ${s.label}</span>${arrow}`;
    }).join("");
  }

  async _writeBattle(updates) {
    const db = this.getDb();
    const rid = this.getRid();
    if (!db || !rid) return;
    const ref = doc(db, "rooms", rid, "public_state", "battle");

    const hasFieldValue = Object.values(updates).some(v =>
      v != null && typeof v === "object" && typeof v.isEqual === "function"
    );

    if (hasFieldValue) {
      try {
        const snap = await getDoc(ref);
        const current = snap.exists() ? snap.data() : {};
        const nextRev = (safeInt(current.rev) || 0) + 1;
        await updateDoc(ref, { ...updates, rev: nextRev });
      } catch (err) {
        try { await updateDoc(ref, updates); } catch (err2) {}
      }
    } else {
      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          const current = snap.exists() ? snap.data() : {};
          const nextRev = (safeInt(current.rev) || 0) + 1;
          tx.set(ref, { ...current, ...updates, rev: nextRev });
        });
      } catch (err) {
        try { await setDoc(ref, updates, { merge: true }); } catch (err2) {}
      }
    }
  }

  _closeOverlay() {
    if (this._currentOverlay) {
      try { this._currentOverlay.remove(); } catch {}
      this._currentOverlay = null;
    }
    this._closeRadial();
  }

  _closeRadial() {
    if (this._currentRadial) {
      try { this._currentRadial.remove(); } catch {}
      this._currentRadial = null;
    }
  }

  _closePrompt(result = null) {
    if (this._currentPrompt) {
      const prompt = this._currentPrompt;
      this._currentPrompt = null;
      if (typeof prompt._acOnClose === "function") {
        const onClose = prompt._acOnClose;
        prompt._acOnClose = null;
        try { onClose(result); } catch {}
      }
      try { prompt.remove(); } catch {}
    }
  }

  _closeContext() {
    if (this._currentContext) {
      try { this._currentContext.remove(); } catch {}
      this._currentContext = null;
    }
  }

  _closeReroll() {
    if (this._rerollInterval) { clearInterval(this._rerollInterval); this._rerollInterval = null; }
    if (this._currentReroll) {
      try { this._currentReroll.remove(); } catch {}
      this._currentReroll = null;
    }
  }

  _closeAll() {
    try { this._currentRollAnimation?.remove?.(); } catch {}
    this._currentRollAnimation = null;
    this._attackTargetMode = null;
    this._publishAttackTargetModeState();
    this._closeOverlay();
    this._closeRadial();
    this._closePrompt();
    this._closeContext();
    this._closeReroll();
  }

  destroy() {
    this._closeAll();
    this._clearPendingFloats();
    this.stopListening();
    if (this._overlayRoot) {
      try { this._overlayRoot.remove(); } catch {}
    }
    if (this._timeline) {
      try { this._timeline.remove(); } catch {}
    }
  }
}
