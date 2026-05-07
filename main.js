import { getMoveType, getTypeColor, getTypeDamageBonus, getSuperEffectiveAgainst, getWeakAgainst, getImmuneTo, getTypeAdvantage, TYPE_CHART, TYPE_COLORS as TYPE_COLORS_DATA, normalizeType } from "./type-data.js";
import { getSizeCategory, getSizeDimensions, getPieceFootprint, getPiecesOccupyingTile, canPieceLandOn, isTileFullyBlocked, getTinySlotPosition, isFootprintWithinGrid, SIZE_CATEGORIES } from "./size-rules.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  collection,
  onSnapshot,
  addDoc,
  serverTimestamp,
  query,// Mantém window.currentRid e window.currentDb sincronizados com appState
  orderBy,
  limit,
  getDoc,
  getDocs,
  runTransaction,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getAuth, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

const DEFAULT_CAPTURE_BALL_API_NAME = "poke-ball";
const DEFAULT_CAPTURE_BALL_ICON_URL = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${DEFAULT_CAPTURE_BALL_API_NAME}.png`;
const LOCAL_MAP_EDITOR_CATALOG_URL = "./assets/map-editor/catalog.json";

function createCaptureBallTheme(config = {}) {
  return Object.freeze({
    topA: String(config.topA || "#ef4444"),
    topB: String(config.topB || config.topA || "#991b1b"),
    bottomA: String(config.bottomA || "#f8fafc"),
    bottomB: String(config.bottomB || config.bottomA || "#cbd5e1"),
    band: String(config.band || "#0f172a"),
    core: String(config.core || "#f8fafc"),
    coreRing: String(config.coreRing || "#0f172a"),
    glow: String(config.glow || "rgba(248,113,113,.42)"),
    accent: String(config.accent || "rgba(255,255,255,.72)"),
    outline: String(config.outline || config.band || "#0f172a"),
  });
}

const CAPTURE_BALL_THEME_PRESETS = Object.freeze({
  "poke-ball": createCaptureBallTheme({ topA: "#ef4444", topB: "#991b1b", bottomA: "#f8fafc", bottomB: "#cbd5e1", band: "#0f172a", core: "#f8fafc", coreRing: "#0f172a", glow: "rgba(248,113,113,.42)", accent: "rgba(255,255,255,.78)" }),
  "great-ball": createCaptureBallTheme({ topA: "#2563eb", topB: "#1e3a8a", bottomA: "#f8fafc", bottomB: "#dbeafe", band: "#0f172a", core: "#f8fafc", coreRing: "#dc2626", glow: "rgba(59,130,246,.46)", accent: "rgba(248,113,113,.36)" }),
  "ultra-ball": createCaptureBallTheme({ topA: "#111827", topB: "#000000", bottomA: "#fefce8", bottomB: "#e5e7eb", band: "#111827", core: "#fde68a", coreRing: "#111827", glow: "rgba(250,204,21,.45)", accent: "rgba(255,255,255,.68)" }),
  "master-ball": createCaptureBallTheme({ topA: "#a855f7", topB: "#6d28d9", bottomA: "#fdf2f8", bottomB: "#e9d5ff", band: "#4c1d95", core: "#f8fafc", coreRing: "#ec4899", glow: "rgba(192,132,252,.48)", accent: "rgba(244,114,182,.42)" }),
  "premier-ball": createCaptureBallTheme({ topA: "#f8fafc", topB: "#e2e8f0", bottomA: "#ffffff", bottomB: "#e5e7eb", band: "#cbd5e1", core: "#ffffff", coreRing: "#dc2626", glow: "rgba(248,113,113,.34)", accent: "rgba(255,255,255,.82)", outline: "#e2e8f0" }),
  "luxury-ball": createCaptureBallTheme({ topA: "#111827", topB: "#000000", bottomA: "#fef3c7", bottomB: "#d4af37", band: "#7c2d12", core: "#fde68a", coreRing: "#b45309", glow: "rgba(251,191,36,.44)", accent: "rgba(248,113,113,.34)" }),
  "quick-ball": createCaptureBallTheme({ topA: "#2563eb", topB: "#0f172a", bottomA: "#fefce8", bottomB: "#dbeafe", band: "#ca8a04", core: "#fef08a", coreRing: "#1d4ed8", glow: "rgba(56,189,248,.46)", accent: "rgba(250,204,21,.44)" }),
  "timer-ball": createCaptureBallTheme({ topA: "#ef4444", topB: "#7f1d1d", bottomA: "#ffffff", bottomB: "#e5e7eb", band: "#1f2937", core: "#f8fafc", coreRing: "#111827", glow: "rgba(248,113,113,.42)", accent: "rgba(255,255,255,.7)" }),
  "repeat-ball": createCaptureBallTheme({ topA: "#f97316", topB: "#ea580c", bottomA: "#fef3c7", bottomB: "#fde68a", band: "#7c2d12", core: "#fde68a", coreRing: "#b91c1c", glow: "rgba(249,115,22,.46)", accent: "rgba(248,113,113,.34)" }),
  "nest-ball": createCaptureBallTheme({ topA: "#84cc16", topB: "#3f6212", bottomA: "#fef3c7", bottomB: "#ecfccb", band: "#365314", core: "#fef08a", coreRing: "#166534", glow: "rgba(132,204,22,.44)", accent: "rgba(250,204,21,.34)" }),
  "net-ball": createCaptureBallTheme({ topA: "#0f766e", topB: "#155e75", bottomA: "#e0f2fe", bottomB: "#bfdbfe", band: "#082f49", core: "#f8fafc", coreRing: "#0f766e", glow: "rgba(45,212,191,.42)", accent: "rgba(96,165,250,.36)" }),
  "dive-ball": createCaptureBallTheme({ topA: "#38bdf8", topB: "#0369a1", bottomA: "#f8fafc", bottomB: "#bae6fd", band: "#0f172a", core: "#f8fafc", coreRing: "#dc2626", glow: "rgba(56,189,248,.46)", accent: "rgba(255,255,255,.72)" }),
  "dusk-ball": createCaptureBallTheme({ topA: "#84cc16", topB: "#14532d", bottomA: "#d1fae5", bottomB: "#a3e635", band: "#052e16", core: "#fef3c7", coreRing: "#166534", glow: "rgba(163,230,53,.44)", accent: "rgba(74,222,128,.34)" }),
  "heal-ball": createCaptureBallTheme({ topA: "#f9a8d4", topB: "#ec4899", bottomA: "#fdf2f8", bottomB: "#fbcfe8", band: "#be185d", core: "#ffffff", coreRing: "#f472b6", glow: "rgba(244,114,182,.44)", accent: "rgba(255,255,255,.74)" }),
  "cherish-ball": createCaptureBallTheme({ topA: "#dc2626", topB: "#7f1d1d", bottomA: "#fef2f2", bottomB: "#fee2e2", band: "#111827", core: "#f8fafc", coreRing: "#111827", glow: "rgba(239,68,68,.46)", accent: "rgba(255,255,255,.72)" }),
  "safari-ball": createCaptureBallTheme({ topA: "#65a30d", topB: "#4d7c0f", bottomA: "#fef3c7", bottomB: "#fde68a", band: "#3f6212", core: "#fef08a", coreRing: "#365314", glow: "rgba(132,204,22,.4)", accent: "rgba(250,204,21,.34)" }),
  "sport-ball": createCaptureBallTheme({ topA: "#fb923c", topB: "#9a3412", bottomA: "#fff7ed", bottomB: "#fed7aa", band: "#7c2d12", core: "#fef3c7", coreRing: "#ea580c", glow: "rgba(251,146,60,.44)", accent: "rgba(255,255,255,.68)" }),
  "friend-ball": createCaptureBallTheme({ topA: "#22c55e", topB: "#166534", bottomA: "#f8fafc", bottomB: "#dcfce7", band: "#14532d", core: "#f8fafc", coreRing: "#dc2626", glow: "rgba(74,222,128,.42)", accent: "rgba(248,113,113,.3)" }),
  "love-ball": createCaptureBallTheme({ topA: "#fb7185", topB: "#e11d48", bottomA: "#fff1f2", bottomB: "#ffe4e6", band: "#be185d", core: "#ffffff", coreRing: "#f472b6", glow: "rgba(251,113,133,.44)", accent: "rgba(255,255,255,.74)" }),
  "level-ball": createCaptureBallTheme({ topA: "#f59e0b", topB: "#b45309", bottomA: "#fef3c7", bottomB: "#ffedd5", band: "#7c2d12", core: "#f8fafc", coreRing: "#dc2626", glow: "rgba(245,158,11,.42)", accent: "rgba(248,113,113,.32)" }),
  "lure-ball": createCaptureBallTheme({ topA: "#38bdf8", topB: "#1d4ed8", bottomA: "#eff6ff", bottomB: "#dbeafe", band: "#0f172a", core: "#ffffff", coreRing: "#dc2626", glow: "rgba(56,189,248,.44)", accent: "rgba(255,255,255,.72)" }),
  "moon-ball": createCaptureBallTheme({ topA: "#312e81", topB: "#1e1b4b", bottomA: "#e0e7ff", bottomB: "#c7d2fe", band: "#0f172a", core: "#f8fafc", coreRing: "#4338ca", glow: "rgba(129,140,248,.46)", accent: "rgba(191,219,254,.42)" }),
  "fast-ball": createCaptureBallTheme({ topA: "#facc15", topB: "#ea580c", bottomA: "#fff7ed", bottomB: "#fef3c7", band: "#7c2d12", core: "#ffffff", coreRing: "#1d4ed8", glow: "rgba(250,204,21,.44)", accent: "rgba(56,189,248,.32)" }),
  "heavy-ball": createCaptureBallTheme({ topA: "#334155", topB: "#0f172a", bottomA: "#e2e8f0", bottomB: "#cbd5e1", band: "#0f172a", core: "#f8fafc", coreRing: "#475569", glow: "rgba(148,163,184,.38)", accent: "rgba(255,255,255,.62)" }),
  "dream-ball": createCaptureBallTheme({ topA: "#f9a8d4", topB: "#c084fc", bottomA: "#fdf2f8", bottomB: "#e9d5ff", band: "#7e22ce", core: "#ffffff", coreRing: "#ec4899", glow: "rgba(244,114,182,.46)", accent: "rgba(192,132,252,.38)" }),
  "beast-ball": createCaptureBallTheme({ topA: "#111827", topB: "#030712", bottomA: "#dbeafe", bottomB: "#93c5fd", band: "#0f172a", core: "#f8fafc", coreRing: "#ec4899", glow: "rgba(56,189,248,.44)", accent: "rgba(244,114,182,.4)" }),
  "park-ball": createCaptureBallTheme({ topA: "#16a34a", topB: "#14532d", bottomA: "#fef3c7", bottomB: "#fdba74", band: "#365314", core: "#fef08a", coreRing: "#ea580c", glow: "rgba(74,222,128,.4)", accent: "rgba(251,146,60,.34)" }),
  "strange-ball": createCaptureBallTheme({ topA: "#64748b", topB: "#1e293b", bottomA: "#f1f5f9", bottomB: "#d8f99d", band: "#0f172a", core: "#ffffff", coreRing: "#4ade80", glow: "rgba(148,163,184,.42)", accent: "rgba(74,222,128,.32)" }),
});

/**
 * PvP Arena (HTML/JS) — Realtime Firestore
 *
 * Regras importantes:
 * - Movimento atualiza public_state/state diretamente; a fila MOVE_PIECE legada
 *   nao e consumida pelo cliente atual.
 * - ✅ Nesta etapa (migração do Streamlit), Ocultar/Revelar e Retirar do campo
 *   atualizam o public_state/state diretamente (igual ao app.py), via transaction.
 *   (Depois dá para trocar por actions quando o backend suportar.)
 */

// -------------------------
// DOM helpers
// -------------------------
const $ = (id) => document.getElementById(id);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// UI elements
const statusEl = $("status");
const ridBadge = $("rid_badge");
const phaseBadge = $("phase_badge");
const syncBadge = $("sync_badge");
const meBadge = $("me_badge");
const roleBadge = $("role_badge");
const ridCardBadge = $("rid_card_badge");
const byCardBadge = $("by_card_badge");
const trainerNameEl = $("trainer_name");
const avatarIcon = $("avatar_icon");
const arenaMeta = $("arena_meta");
const selBadge = $("sel_badge");
const hoverBadge = $("hover_badge");
const logList = $("log_list");
const logCount = $("log_count");
const oppCount = $("opp_count");
const playersCount = $("players_count");
const lastActionEl = $("last_action");
const actionsLogEl = $("actions_log");
const topRollBtn = $("top_roll_btn");
const passTurnBtn = $("pass_turn_btn");
const turnBadge = $("turn_badge");
const cancelPlaceBtn = $("btn_cancel_place");

const playersPre = $("players");
const statePre = $("state");
const battlePre = $("battle");

// inputs
const ridInput = $("rid");
const byInput = $("by");
const pwInput = $("pw");
const entryLoginLoading = $("entry_login_loading");
const entryLoginLoadingText = $("entry_login_loading_text");
// tenta pré-preencher "by" com o último login
try {
  const cache = loadLoginCache();
  if (cache?.name && byInput && !safeStr(byInput.value)) byInput.value = String(cache.name);
} catch {}

function applyConnectionParamsFromUrl() {
  const result = { rid: "", trainer: "", autoConnect: false, launchToken: "" };
  let params = null;
  try {
    params = new URLSearchParams(window.location.search || "");
  } catch {
    params = null;
  }
  if (!params) return result;

  const urlRid = safeStr(
    params.get("rid") ||
    params.get("room") ||
    params.get("roomId") ||
    params.get("sala")
  );
  const urlTrainer = safeStr(
    params.get("trainer") ||
    params.get("by") ||
    params.get("player") ||
    params.get("name")
  );
  const autoConnectRaw = safeStr(
    params.get("connect") ||
    params.get("autoconnect") ||
    params.get("autoConnect") ||
    params.get("auto")
  ).toLowerCase();
  const autoConnect =
    ["1", "true", "yes", "sim", "on"].includes(autoConnectRaw) ||
    (params.has("connect") && !autoConnectRaw);
  const launchToken = safeStr(params.get("launch") || params.get("launchToken") || params.get("battleLaunch"));

  if (urlRid && ridInput) ridInput.value = urlRid;
  if (urlTrainer && byInput) byInput.value = urlTrainer;

  result.rid = urlRid;
  result.trainer = urlTrainer;
  result.autoConnect = autoConnect;
  result.launchToken = launchToken;

  if (urlRid || urlTrainer) {
    setStatus(
      "warn",
      autoConnect
        ? "dados da URL preenchidos; conectando automaticamente"
        : "dados da URL preenchidos; informe a senha e conecte"
    );
  }
  return result;
}

const initialConnectionParams = applyConnectionParamsFromUrl();

const connectBtn = $("connect");
const disconnectBtn = $("disconnect");
const disconnectPanelBtn = $("disconnect_panel");
const entryDisconnectBtn = $("entry_disconnect");
const addLogBtn = $("btn_add_log");
const logTextInput = $("log_text");
// (debug antigo) painel de mover peça manualmente
const moveBtn = $("btn_move_piece");
const pieceIdInput = $("pieceId");
const rowInput = $("row");
const colInput = $("col");

// ✅ Remover da tela os painéis de debug "Mover peça" e "Últimas actions"
// (sem quebrar o resto do app, mesmo que o HTML ainda contenha esses blocos)
function hideLegacyDebugPanels() {
  const hideClosestBlock = (el) => {
    if (!el) return;
    const block = el.closest?.(".card") || el.closest?.("details") || el.closest?.(".panel") || el.parentElement;
    if (block) block.style.display = "none";
    else el.style.display = "none";
  };
  // "Mover peça (MOVE_PIECE)"
  hideClosestBlock(moveBtn);
  // "Últimas actions (para ver rejected/erro)"
  hideClosestBlock(actionsLogEl);
}

hideLegacyDebugPanels();

// arena render target
const canvas = $("arena");
const canvasWrap = $("arena_wrap");
const arenaDom = $("arena_dom");
const pieceContextMenu = $("piece_context_menu");
const pieceContextSummary = $("piece_context_summary");
const arenaLeftShell = $("arena_left_shell");
const arenaLeftToggle = $("arena_left_toggle");
const arenaLeftDrawer = $("arena_left_drawer");
const arenaToolsShell = $("arena_tools_shell");
const arenaToolsToggle = $("arena_tools_toggle");
const arenaToolsMenu = $("arena_tools_menu");
const arenaHoverCard = $("arena_hover_card");
const arenaHoverCardBody = $("arena_hover_card_body");

// Canvas pode falhar por CSP, webview, permissões, etc.
let ctx = null;
let useCanvas = false;
try {
  ctx = canvas?.getContext?.("2d", { alpha: false, desynchronized: true }) || null;
  useCanvas = !!ctx;
} catch {
  ctx = null;
  useCanvas = false;
}
let arenaRenderMode = useCanvas ? "canvas" : "dom";
let arenaRenderReason = useCanvas ? "boot-canvas" : (canvas ? "context-failure" : "boot-dom");
let arenaFrameHandle = 0;

// ── Sprite overlay layer (renders GIFs as HTML <img> over canvas) ──
const _spriteOverlay = document.createElement("div");
_spriteOverlay.id = "sprite_overlay";
_spriteOverlay.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2;";
if (canvasWrap) canvasWrap.appendChild(_spriteOverlay);
const _pieceFxOverlay = document.createElement("div");
_pieceFxOverlay.id = "piece_fx_overlay";
_pieceFxOverlay.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:4;border-radius:var(--radius);";
if (canvasWrap) canvasWrap.appendChild(_pieceFxOverlay);
const _spritePool = new Map(); // pieceId -> {el, url}
const PIECE_FIELD_FX_MS = 420;
let _pieceScreenBounds = new Map(); // pieceId -> { left, top, width, height, hitZIndex }
let _piecePresenceCache = new Map(); // pieceId -> piece snapshot
let _pieceFieldFxBootstrapped = false;
const _pieceEnteringIds = new Map(); // pieceId -> startedAt

// -------------------------
// Firebase config (fixo)
// -------------------------
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyD2YZfQc-qeqMT3slk0ouvPC08d901te-Q",
  authDomain: "batalhas-de-gaal.firebaseapp.com",
  projectId: "batalhas-de-gaal",
  storageBucket: "batalhas-de-gaal.firebasestorage.app",
  messagingSenderId: "676094077702",
  appId: "1:676094077702:web:31095aa7dd2100b17d0c87",
  measurementId: "G-1Q0TB1YPFG",
};

// -------------------------
// Firebase Storage (public URL helper)
// -------------------------
function storageMediaUrl(path) {
  const bucket = (DEFAULT_FIREBASE_CONFIG && DEFAULT_FIREBASE_CONFIG.storageBucket) || "";
  // gs:// URLs não funcionam no <img>. Use o endpoint HTTP do Storage.
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;
}


function cloneJson(value) {
  if (typeof structuredClone === "function") {
    try { return structuredClone(value); } catch {}
  }
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function mapEditorIsOwner() {
  return safeStr(appState.role) === "owner";
}

function shouldUseMapTerrainPreview() {
  if (!mapDataState.baseData) return false;
  if (mapEditorIsOwner()) {
    return (
      mapEditorState.enabled ||
      isMapEditorDirty() ||
      mapEditorState.saving ||
      hasMapEditChanges(mapEditorState.published || createEmptyMapEdits())
    );
  }
  return hasMapEditChanges(mapEditorState.published || createEmptyMapEdits());
}

function isMapEditorActive() {
  return mapEditorIsOwner() && !!mapEditorState.enabled;
}

window.isMapEditorActive = isMapEditorActive;

function mapEditorPoolLabel(poolName) {
  const name = safeStr(poolName);
  if (name.startsWith("biome:")) return `Bioma ${name.slice(6)}`;
  return name.replaceAll("_", " ");
}

function getCurrentMapBaseSpec() {
  const board = appState.board || {};
  return {
    grid: Number(appState.gridSize) || 10,
    themeKey: safeStr(appState.theme) || "biome_grass",
    seed: Number(board?.seed || 0) || 0,
    noWater: !!board?.noWater,
    includeBeachDocks: !!board?.includeBeachDocks,
  };
}

function sameMapBaseSpec(a, b) {
  return (
    Number(a?.grid || 0) === Number(b?.grid || 0) &&
    safeStr(a?.themeKey) === safeStr(b?.themeKey) &&
    Number(a?.seed || 0) === Number(b?.seed || 0) &&
    !!a?.noWater === !!b?.noWater &&
    !!a?.includeBeachDocks === !!b?.includeBeachDocks
  );
}

function createEmptyMapEdits(baseSpec = getCurrentMapBaseSpec()) {
  return {
    baseSignature: safeStr(appState.board?.mapEditBaseSignature),
    baseSpec: {
      grid: Number(baseSpec?.grid || 0),
      themeKey: safeStr(baseSpec?.themeKey),
      seed: Number(baseSpec?.seed || 0) || 0,
      noWater: !!baseSpec?.noWater,
      includeBeachDocks: !!baseSpec?.includeBeachDocks,
    },
    removedObjectIds: [],
    addedObjects: [],
    revision: 0,
    updatedBy: "",
    updatedAt: null,
  };
}

function normalizeMapObject(raw = {}) {
  const footprint = raw?.footprint || {};
  const support = raw?.support || {};
  const render = raw?.render || {};
  const x = Number(raw?.x || 0) || 0;
  const y = Number(raw?.y || 0) || 0;
  const fw = Math.max(1, Number(footprint?.w || 1) || 1);
  const fh = Math.max(1, Number(footprint?.h || 1) || 1);
  return {
    id: safeStr(raw?.id) || `manual_${Math.random().toString(36).slice(2, 10)}`,
    kind: safeStr(raw?.kind) || "manual_asset",
    x,
    y,
    assetId: safeStr(raw?.assetId),
    assetPool: safeStr(raw?.assetPool),
    origin: safeStr(raw?.origin) || "manual",
    sprite: safeStr(raw?.sprite),
    anchor: {
      ax: Number(raw?.anchor?.ax ?? 0.5) || 0.5,
      ay: Number(raw?.anchor?.ay ?? 1.0) || 1.0,
    },
    footprint: { w: fw, h: fh },
    support: {
      w: Math.max(1, Number(support?.w || fw) || fw),
      baseY: Number(support?.baseY ?? (y + fh - 1)) || (y + fh - 1),
    },
    blocks: raw?.blocks !== false,
    occludes: !!raw?.occludes,
    splitSprite: !!raw?.splitSprite,
    topSprite: safeStr(raw?.topSprite),
    render: {
      pxX: Number(render?.pxX || 0) || 0,
      pxY: Number(render?.pxY || 0) || 0,
      offsetX: Number(render?.offsetX || 0) || 0,
      offsetY: Number(render?.offsetY || 0) || 0,
      w: Number(render?.w || 0) || 0,
      h: Number(render?.h || 0) || 0,
    },
  };
}

function normalizeMapEdits(raw, baseSpec = getCurrentMapBaseSpec()) {
  const out = createEmptyMapEdits(baseSpec);
  if (!raw || typeof raw !== "object") return out;
  if (raw.baseSpec && !sameMapBaseSpec(raw.baseSpec, baseSpec)) return out;
  out.baseSignature = safeStr(raw.baseSignature || out.baseSignature);
  out.removedObjectIds = Array.from(new Set((Array.isArray(raw.removedObjectIds) ? raw.removedObjectIds : []).map((v) => safeStr(v)).filter(Boolean))).sort();
  out.addedObjects = (Array.isArray(raw.addedObjects) ? raw.addedObjects : []).filter(Boolean).map(normalizeMapObject);
  out.revision = Math.max(0, Number(raw.revision || 0) || 0);
  out.updatedBy = safeStr(raw.updatedBy);
  out.updatedAt = raw.updatedAt || null;
  if (!hasMapEditChanges(out)) {
    out.revision = 0;
  }
  return out;
}

function serializeMapEdits(edits) {
  return JSON.stringify(normalizeMapEdits(edits, getCurrentMapBaseSpec()));
}

function areMapEditsEqual(a, b) {
  return serializeMapEdits(a) === serializeMapEdits(b);
}

function isMapEditorDirty() {
  if (!mapEditorState.draft) return false;
  return !areMapEditsEqual(mapEditorState.draft, mapEditorState.published || createEmptyMapEdits());
}

function hasMapEditChanges(edits) {
  return !!((edits?.removedObjectIds?.length || 0) || (edits?.addedObjects?.length || 0));
}

function getMapObjectRect(obj) {
  const x = Number(obj?.x || 0) || 0;
  const y = Number(obj?.y || 0) || 0;
  const fw = Math.max(1, Number(obj?.footprint?.w || 1) || 1);
  const fh = Math.max(1, Number(obj?.footprint?.h || 1) || 1);
  return { x0: x, y0: y, x1: x + fw, y1: y + fh };
}

function applyMapEditsToMapData(mapData, edits) {
  const result = cloneJson(mapData || {}) || {};
  const normalizedEdits = normalizeMapEdits(edits, getCurrentMapBaseSpec());
  let objects = (Array.isArray(result.objects) ? result.objects : []).map(normalizeMapObject);
  const removedIds = new Set((normalizedEdits.removedObjectIds || []).map((id) => safeStr(id)).filter(Boolean));
  if (removedIds.size) {
    objects = objects.filter((obj) => !removedIds.has(safeStr(obj.id)));
  }
  for (const obj of normalizedEdits.addedObjects || []) {
    objects.push(normalizeMapObject(obj));
  }
  result.objects = objects;
  result.meta = { ...(result.meta || {}) };
  result.meta.mapEdited = hasMapEditChanges(normalizedEdits);
  result.meta.mapEditRevision = Number(normalizedEdits.revision || 0) || 0;
  result.meta.mapEditBaseSignature = safeStr(normalizedEdits.baseSignature);
  return result;
}

async function computeMapBaseSignature(baseSpec = getCurrentMapBaseSpec()) {
  const payload = JSON.stringify({
    grid: Number(baseSpec?.grid || 0) || 0,
    includeBeachDocks: !!baseSpec?.includeBeachDocks,
    noWater: !!baseSpec?.noWater,
    seed: Number(baseSpec?.seed || 0) || 0,
    themeKey: safeStr(baseSpec?.themeKey),
  });
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-1", new TextEncoder().encode(payload));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  }
  let hash = 0;
  for (let i = 0; i < payload.length; i++) hash = ((hash << 5) - hash + payload.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(16).padStart(16, "0").slice(0, 16);
}

function getEffectiveMapTilePx() {
  const current = Number(mapDataState.data?.tile_px || 0);
  if (current > 0) return current;
  const base = Number(mapDataState.baseData?.tile_px || 0);
  if (base > 0) return base;
  return Number(mapEditorState.catalog?.baseTilePx || 32) || 32;
}

function getActiveMapTerrainUrl() {
  const b = appState.board || {};
  const urls = [];
  pushUniqueString(urls, b.mapTerrainTokenUrl);
  pushUniqueString(urls, b.map_terrain_token_url);
  pushUniqueString(urls, b.mapTerrainUrl);
  pushUniqueString(urls, b.map_terrain_url);
  const storagePath = safeStr(b.mapTerrainStoragePath || b.map_terrain_storage_path);
  if (storagePath) pushUniqueString(urls, storageMediaUrl(storagePath));
  return urls[0] || "";
}

function getActiveMapBaseDataUrl() {
  const b = appState.board || {};
  const urls = [];
  pushUniqueString(urls, b.mapBaseDataTokenUrl);
  pushUniqueString(urls, b.map_base_data_token_url);
  pushUniqueString(urls, b.mapBaseDataUrl);
  pushUniqueString(urls, b.map_base_data_url);
  const storagePath = safeStr(b.mapBaseDataStoragePath || b.map_base_data_storage_path);
  if (storagePath) pushUniqueString(urls, storageMediaUrl(storagePath));
  return urls[0] || "";
}

function getActiveMapAssetCatalogUrl() {
  return LOCAL_MAP_EDITOR_CATALOG_URL;
}



// -------------------------
// Login (mesma lógica do Streamlit, mas sem expor Service Account no browser)
// IMPORTANTE: o front NÃO pode usar gspread/ServiceAccountCredentials.
// Então aqui o main.js chama um endpoint SERVER-SIDE (Apps Script / Cloud Function)
// que lê a planilha "SaveData_RPG" e aplica a mesma validação (A=nome, B=json, C=senha).
//
// ✅ Retornos esperados (idênticos ao app.py):
// - { status: "OK", data: <json da coluna B> }
// - { status: "NOT_FOUND" }
// - { status: "WRONG_PASS" }
// - { status: "ERROR", message?: "..." }
//
// 1) Crie um endpoint (exemplo de Apps Script está no fim da resposta) e cole a URL abaixo.
const SHEET_ID = "1Z887EqYOatQ6ebMjYcjsCX4ZcTWi30F6Gf4zbCC_WZ8";
const SHEET_AUTH_URL = "https://us-central1-batalhas-de-gaal.cloudfunctions.net/sheetAuth"; // <-- COLE AQUI a URL do seu endpoint (obrigatório p/ login no site)

// cache simples (sessão)
const LOGIN_CACHE_KEY = "pvp_login_cache_v1"; // { name, userData, savedAt }

function loadLoginCache() {
  try {
    const raw = localStorage.getItem(LOGIN_CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    // cache de sessão "bobo": 12h
    const ageMs = Date.now() - Number(obj.savedAt || 0);
    if (!Number.isFinite(ageMs) || ageMs > 12 * 60 * 60 * 1000) return null;
    return obj;
  } catch {
    return null;
  }
}

function saveLoginCache(name, userData, uid, customToken, authUid = "") {
  try {
    localStorage.setItem(
      LOGIN_CACHE_KEY,
      JSON.stringify({
        name,
        userData,
        uid: uid || null,
        authUid: authUid || null,
        customToken: customToken || null,
        savedAt: Date.now(),
      })
    );
  } catch {}
}

function clearLoginCache() {
  try { localStorage.removeItem(LOGIN_CACHE_KEY); } catch {}
}

function getFirebaseAuthUid(auth = null) {
  try {
    const activeAuth = auth || (getApps().length ? getAuth(getApps()[0]) : null);
    return safeStr(activeAuth?.currentUser?.uid || "");
  } catch {
    return "";
  }
}

function getSelfFirebaseAuthUid(auth = null) {
  return getFirebaseAuthUid(auth) || safeStr(appState.selfAuthUid || "");
}

async function sheetAuthenticateUser(name, password) {
  const nm = safeStr(name);
  const pw = password == null ? "" : String(password);
  if (!nm) return { status: "ERROR", message: "faltou nome" };

  if (!SHEET_AUTH_URL) {
    return { status: "ERROR", message: "SHEET_AUTH_URL não configurado" };
  }

  if (!SHEET_ID) {
    return { status: "ERROR", message: "SHEET_ID não configurado" };
  }
try {
    const res = await fetch(SHEET_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "auth", sheetId: SHEET_ID, name: nm, password: pw }),
    });

    const json = await res.json().catch(() => null);
    if (!json || typeof json !== "object") return { status: "ERROR", message: "resposta inválida do endpoint" };

    // normaliza
    const st = safeStr(json.status || json.result || "");
    if (st === "OK") {
      return {
        status: "OK",
        data: json.data,
        uid: safeStr(json.uid || json.trainerId || ""),
        customToken: safeStr(json.customToken || json.token || ""),
      };
    }
    if (st === "NOT_FOUND") return { status: "NOT_FOUND" };
    if (st === "WRONG_PASS") return { status: "WRONG_PASS" };

    return { status: "ERROR", message: safeStr(json.message || "erro desconhecido") || "erro desconhecido" };
  } catch (e) {
    return { status: "ERROR", message: e?.message || String(e) };
  }
}

function clampPartyHp(rawHp, fallback = 6) {
  const n = Number(rawHp);
  const f = Number(fallback);
  const value = Number.isFinite(n) ? n : (Number.isFinite(f) ? f : 6);
  return Math.max(0, Math.min(6, Math.trunc(value)));
}

async function buildPartySnapshotFromFirestore(db, trainerName, userData, limitSheets = 120) {
  const tn = safeStr(trainerName);
  if (!tn || !db) return [];

  const partyRaw = (userData && Array.isArray(userData.party)) ? userData.party : [];
  const hubPartyEntryIds = (userData && Array.isArray(userData.hub_party_entries))
    ? userData.hub_party_entries.map((x) => safeStr(x)).filter(Boolean)
    : [];
  const captureRegistry = (userData && userData.hub_capture_registry && typeof userData.hub_capture_registry === "object")
    ? userData.hub_capture_registry
    : {};
  const entryMeta = (userData && userData.hub_entry_meta && typeof userData.hub_entry_meta === "object")
    ? userData.hub_entry_meta
    : {};
  let partyEntries = _normalizePartyList(partyRaw);
  const hubMeta = (userData && typeof userData.hub_pokemon_meta === "object" && userData.hub_pokemon_meta)
    ? userData.hub_pokemon_meta
    : {};

  // replica app.py: pega fichas mais recentes e casa por pokemon.id (primeira ocorrência, pois já está order desc)
  const byPid = new Map();
  const byEntryId = new Map();
  try {
    const trainerId = safeStr(appState.selfTrainerId) || safeDocId(tn);
    const q = query(
      collection(db, "trainers", trainerId, "sheets"),
      orderBy("updated_at", "desc"),
      limit(Number(limitSheets) || 120),
    );

    const snap = await getDocs(q);
    snap.forEach((d) => {
      const sh = d.data() || {};
      const p = sh.pokemon || {};
      const pid = safeStr(p.id);
      if (!pid) return;
      const sheetEntry = {
        sheet_id: d.id,
        pokemon: { id: p.id, name: p.name, types: p.types },
        np: sh.np,
        updated_at: sh.updated_at,
      };
      if (!byPid.has(pid)) byPid.set(pid, sheetEntry);
      byEntryId.set(`sheet:${d.id}`, sheetEntry);
    });
  } catch {}

  if (hubPartyEntryIds.length) {
    partyEntries = hubPartyEntryIds.map((entryId, index) => {
      let pid = "";
      if (entryId.startsWith("cap:")) {
        pid = normalizePartyPid(captureRegistry?.[entryId]?.pid || partyRaw[index]);
      } else if (entryId.startsWith("sheet:")) {
        pid = normalizePartyPid(byEntryId.get(entryId)?.pokemon?.id || partyRaw[index]);
      } else {
        pid = normalizePartyPid(partyRaw[index]);
      }
      if (!pid) return null;
      return _normalizePartyEntry({
        pid,
        entry_id: entryId,
        party_slot: `slot_${index}`,
        hp: clampPartyHp(entryMeta?.[entryId]?.hp, 6),
      }, index);
    }).filter(Boolean);
  }

  return partyEntries.map((entry) => {
    const pid = entry.pid;
    const heldItem = entry?.held_item || entry?.heldItem || _getHeldItemFromHubMeta(hubMeta, entry);
    const captureBall = entry?.capture_ball || entry?.captureBall || _getCaptureBallFromHubMeta(hubMeta, entry);
    const entryTypes = _extractResolvedTypesFromSource(entry);
    const resolvedTypes = entryTypes.length ? entryTypes : _getResolvedTypesFromHubMeta(hubMeta, entry);
    const base = Object.assign({}, entry);
    if (heldItem && !base.held_item && !base.heldItem) base.held_item = heldItem;
    if (captureBall && !base.capture_ball && !base.captureBall) base.capture_ball = captureBall;
    if (resolvedTypes.length) {
      base.resolved_types = resolvedTypes;
      if (!base.type_override && !base.typeOverride) base.type_override = resolvedTypes;
    }
    const extra = byPid.get(pid);
    const merged = extra ? Object.assign(base, extra) : base;
    if (resolvedTypes.length) {
      merged.pokemon = Object.assign({}, merged?.pokemon || {}, {
        id: merged?.pokemon?.id || pid,
        types: resolvedTypes,
      });
    }
    return merged;
  });
}

async function tryLoginWithLaunchToken(db, auth, typedName) {
  const launchToken = safeStr(initialConnectionParams?.launchToken);
  const rid = safeStr(ridInput?.value || initialConnectionParams?.rid || "");
  const tn = safeStr(typedName || initialConnectionParams?.trainer || byInput?.value || "");
  if (!launchToken || !rid || !tn || !db || !auth) return null;

  try {
    const snap = await getDoc(doc(db, "rooms", rid, "public_state", `launch_${safeDocId(launchToken)}`));
    if (!snap.exists()) {
      console.warn("battle launch token nao encontrado");
      return null;
    }

    const data = snap.data() || {};
    const docTrainer = safeStr(data.trainer_name || data.trainer || data.name);
    if (docTrainer && docTrainer !== tn) {
      console.warn("battle launch token pertence a outro treinador");
      return null;
    }

    const expiresAtMs = Number(data.expiresAtMs || data.expires_at_ms || 0);
    if (Number.isFinite(expiresAtMs) && expiresAtMs > 0 && Date.now() > expiresAtMs) {
      console.warn("battle launch token expirado");
      return null;
    }

    const customToken = safeStr(data.customToken || data.custom_token);
    if (!customToken) return null;

    const cred = await signInWithCustomToken(auth, customToken);
    const authUid = safeStr(cred?.user?.uid || getFirebaseAuthUid(auth));
    const uid = safeStr(data.uid || authUid || safeDocId(tn));
    const userData = data.userData && typeof data.userData === "object" ? data.userData : {};

    appState.selfAuthUid = authUid || uid;
    appState.selfTrainerId = uid;
    appState.selfUserData = userData;
    appState.selfAuthStatus = "OK_LAUNCH";
    appState.selfPartySnapshot = await buildPartySnapshotFromFirestore(db, tn, userData);
    saveLoginCache(tn, userData, uid, customToken, authUid || uid);
    return { ok: true, name: tn };
  } catch (e) {
    console.warn("battle launch token falhou:", e);
    return null;
  }
}

// Faz login antes de conectar
async function ensureLoggedInIfNeeded(db, auth, typedName, typedPassword = "") {

  const tn = safeStr(typedName);

  // se não preencheu nome, deixa conectar como espectador
  if (!tn) {
    appState.selfUserData = null;
    appState.selfPartySnapshot = null;
    appState.selfAuthStatus = null;
    appState.selfTrainerId = null;
    appState.selfAuthUid = null;
    return { ok: true, name: "" };
  }

  // Se você ainda não configurou o endpoint, não bloqueia o app (mantém modo legado).
  // Nesse caso, a party pode vir de party_snapshot/users_raw se existir.
  if (!SHEET_AUTH_URL) {
    appState.selfUserData = null;
    appState.selfPartySnapshot = null;
    appState.selfAuthStatus = "SKIPPED_NO_ENDPOINT";
    return { ok: true, name: tn };
  }

  // 1) cache (se o usuário já logou antes)
  const cache = loadLoginCache();
  const launchLogin = await tryLoginWithLaunchToken(db, auth, tn);
  if (launchLogin?.ok) return launchLogin;

  if (cache && safeStr(cache.name) === tn && cache.userData) {
    // tenta restaurar Auth sem pedir senha
    const tok = safeStr(cache.customToken);
    let cacheAuthOk = !auth;
    if (auth && tok) {
      try {
        const cred = await signInWithCustomToken(auth, tok);
        const authUid = safeStr(cred?.user?.uid || getFirebaseAuthUid(auth));
        appState.selfAuthUid = authUid || safeStr(cache.authUid || "");
        appState.selfTrainerId = safeStr(cache.uid || authUid || "");
        cacheAuthOk = !!authUid;
        if (authUid && authUid !== safeStr(cache.authUid || "")) {
          saveLoginCache(tn, cache.userData, appState.selfTrainerId, tok, authUid);
        }
      } catch (e) {
        // token inválido/expirado -> força relogar
        clearLoginCache();
      }
    } else if (auth) {
      const currentUid = getFirebaseAuthUid(auth);
      const cachedUid = safeStr(cache.authUid || cache.uid || "");
      cacheAuthOk = !!currentUid && (!cachedUid || currentUid === cachedUid);
    }
  
    // se não conseguiu restaurar auth, cai pra prompt de senha abaixo
    if (auth && !cacheAuthOk) {
      // continua fluxo normal (vai pedir senha)
    } else {
      const authUid = getFirebaseAuthUid(auth);
      appState.selfAuthUid = authUid || safeStr(cache.authUid || "");
      appState.selfTrainerId = safeStr(appState.selfTrainerId || cache.uid || authUid || "");
      appState.selfUserData = cache.userData;
      appState.selfAuthStatus = "OK";
      if (db) appState.selfPartySnapshot = await buildPartySnapshotFromFirestore(db, tn, appState.selfUserData);
      return { ok: true, name: tn };
    }

  }

  // 2) usa a senha digitada na tela; se não vier preenchida, mantém prompt como fallback
  let pw = safeStr(typedPassword);
  if (!pw) {
    pw = window.prompt(`Senha do treinador "${tn}" (mesma da planilha):`, "");
    if (pw == null) return { ok: false, cancel: true };
  }

  const result = await sheetAuthenticateUser(tn, pw);
  appState.selfAuthStatus = result.status;
  
  if (result.status !== "OK") {
    appState.selfUserData = null;
    appState.selfPartySnapshot = null;
    appState.selfTrainerId = null;
    appState.selfAuthUid = null;
    clearLoginCache();
    return { ok: false, status: result.status, message: result.message };
  }
  
  // 🔐 loga no Firebase Auth com custom token (necessário pras rules opção B)
  const token = safeStr(result.customToken);
  if (!auth || !token) {
    appState.selfUserData = null;
    appState.selfPartySnapshot = null;
    appState.selfTrainerId = null;
    appState.selfAuthUid = null;
    clearLoginCache();
    return { ok: false, status: "ERROR", message: "endpoint não retornou customToken (Auth obrigatório para rules B)" };
  }
  
  const cred = await signInWithCustomToken(auth, token);
  const authUid = safeStr(cred?.user?.uid || getFirebaseAuthUid(auth));
  appState.selfAuthUid = authUid;
  appState.selfTrainerId = safeStr(result.uid || authUid || "");
  
  // segue igual
  appState.selfUserData = result.data || {};
  if (db) appState.selfPartySnapshot = await buildPartySnapshotFromFirestore(db, tn, appState.selfUserData);
  
  // cache agora guarda uid+token também (pra não pedir senha toda hora)
  saveLoginCache(tn, appState.selfUserData, appState.selfTrainerId, token, authUid);
  
  return { ok: true, name: tn };
}

// -------------------------
// Local state (update incremental)
// -------------------------
const appState = {
  connected: false,
  activeTab: "arena",
  rid: null,
  by: "",
  // login (Google Sheet)
  selfUserData: null,      // JSON da coluna B (após login)
  selfPartySnapshot: null, // snapshot da party com ficha mais recente
  selfTrainerRpgSheet: null, // ficha RPG do treinador logado
  selfAuthStatus: null,    // "OK" | "NOT_FOUND" | "WRONG_PASS" | "ERROR"
  selfTrainerId: null,
  selfAuthUid: null,
  role: "—",
  players: [],
  userProfiles: new Map(), // uid -> {profile, raw}
  globalHpRevision: 0,
  // docs
  board: null, // public_state/state
  battle: null, // public_state/battle
  publicPlayers: null,
  pokemonForms: null,
  // derived
  gridSize: 10,
  theme: "biome_grass",
  piecesRaw: [],
  pieces: [],
  traps: [],   // armadilhas por célula (field-zones-patch)
  zones: [],   // zonas de clima/terreno (field-zones-patch)
  // UI selection
  selectedPieceId: null,
  placing: null, // { mode: "pokemon", trainer, pid, party_slot }
  placingPid: null,
  placingTrainer: null, // trainer name when placing trainer avatar
  hover: { row: null, col: null },
  hoveredPieceId: null,
  hoverCardPieceId: null,
  lastInteractedPieceId: null,
  leftOverlayOpen: false,
  toolsMenuOpen: false,
  // drag
  drag: {
    active: false,
    justDropped: false,
    pieceId: null,
    startRow: null,
    startCol: null,
    x: 0,
    y: 0,
  },
  // logs
  renderedLogKeys: new Set(),
  activeLogSubtab: "battle",
  movement: {
    dashByPieceId: {},
    freeByPieceId: {},
    halfStepIntentByPieceId: {},
    turnKey: "",
  },
};

const mapEditorState = {
  enabled: false,
  mode: "remove", // "remove" | "add"
  rawPublished: null,
  published: null,
  draft: null,
  history: [],
  saving: false,
  selectedPool: "",
  selectedAssetId: "",
  catalog: null,
  catalogUrl: "",
  catalogLoading: false,
  assetIndex: new Map(),
  panelReady: false,
};


// Local UI state (não vai pro Firestore)
let armedPokemonId = null; // modo posicionamento via pokébola
let armedPokemonSlot = null;

// -------------------------
// Dex / Map overrides (localStorage)
// -------------------------
const STORAGE_KEYS = {
  dexMap: 'pvp_dex_map_json',
  mapUrl: 'pvp_map_url_override',
};

let dexMap = null; // { pidStr: name }
let mapUrlOverride = '';

function pushUniqueString(list, value) {
  const v = safeStr(value);
  if (!v || list.includes(v)) return;
  list.push(v);
}

function setDexMap(obj) {
  dexMap = (obj && typeof obj === 'object') ? obj : null;
  window.dexMap = dexMap;
}

const pieceMenuState = {
  pieceId: null,
  clientX: 0,
  clientY: 0,
};

function loadDexMapFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.dexMap);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj;
  } catch {}
  return null;
}

function saveDexMapToStorage(obj) {
  try {
    localStorage.setItem(STORAGE_KEYS.dexMap, JSON.stringify(obj || {}));
  } catch {}
}

function loadMapOverrideFromStorage() {
  try {
    return localStorage.getItem(STORAGE_KEYS.mapUrl) || '';
  } catch {
    return '';
  }
}

function saveMapOverrideToStorage(url) {
  try {
    if (url) localStorage.setItem(STORAGE_KEYS.mapUrl, url);
    else localStorage.removeItem(STORAGE_KEYS.mapUrl);
  } catch {}
}

async function tryLoadDexSlugMapFromAssets() {
  try {
    const res = await fetch('./assets/pokedex_map_slug_to_id.json', { cache: 'no-cache' });
    if (!res.ok) return null;
    const obj = await res.json();
    if (obj && typeof obj === 'object') return obj;
  } catch {}
  return null;
}

async function tryLoadDexMapFromAssets() {
  // Fallback: carrega mapas exportados da sua Pokédex
  try {
    const res = await fetch('./assets/pokedex_map_id_to_name.json', { cache: 'no-cache' });
    if (res.ok) {
      const obj = await res.json();
      if (obj && typeof obj === 'object') return obj;
    }
  } catch {}
  // compat: arquivo antigo
  try {
    const res2 = await fetch('./assets/pokedex.json', { cache: 'no-cache' });
    if (!res2.ok) return null;
    const obj2 = await res2.json();
    if (obj2 && typeof obj2 === 'object') return obj2;
  } catch {}
  return null;
}

let _pokemonFormManifestRaw = { available_slugs: [], art_map: {}, shiny_art_map: {}, gif_map: {} };
let _pokemonFormManifestList = [];
let _pokemonFormManifestSet = new Set();
let _pokemonFormManifestGroups = new Map();
let _pokemonFormManifestArtMap = new Map();
let _pokemonFormManifestShinyArtMap = new Map();
let _pokemonFormManifestGifMap = new Map();
let _pokemonFormManifestArtBasenameSet = new Set();
let _pokemonFormManifestShinyArtBasenameSet = new Set();

async function tryLoadPokemonFormManifestFromAssets() {
  try {
    const res = await fetch("./assets/pokemon_form_manifest.json", { cache: "no-cache" });
    if (!res.ok) return null;
    const obj = await res.json();
    if (obj && typeof obj === "object") return obj;
  } catch {}
  return null;
}

// Inicializa overrides
(function initOverrides() {
  setDexMap(loadDexMapFromStorage());
  mapUrlOverride = loadMapOverrideFromStorage();
  // tenta assets apenas se ainda não tem nada no storage
  if (!dexMap) {
    tryLoadDexMapFromAssets().then((obj) => {
      if (obj && !dexMap) {
        setDexMap(obj);
        updateSidePanels();
      }
    });
  }
  tryLoadDexSlugMapFromAssets().then((obj) => {
    if (obj && typeof obj === 'object') window.dexSlugToId = obj;
  });
  tryLoadPokemonFormManifestFromAssets().then((obj) => {
    if (obj && typeof obj === "object") _setPokemonFormManifest(obj);
  });
})();

let currentDb = null;
let currentRid = null;
let unsub = [];
let userUnsub = new Map(); // uid -> unsubscribe

// Converte nome de treinador para ID no formato usado pelas Cloud Functions (lowercase + sem-acento)
function safeIdLower(name) {
  return safeStr(name).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
    .slice(0, 80) || "user";
}

function ensureUserSubscriptions() {
  if (!currentDb) return;
  const wanted = new Map(); // uid/docId -> trainer_name
  const addWanted = (uid, tn) => {
    const key = safeStr(uid);
    const name = safeStr(tn);
    if (!key || !name) return;
    wanted.set(key, name);
  };
  const by = safeStr(appState.by);
  if (by) {
    addWanted(safeDocId(by), by);
    // Cloud Functions e sync HTTP usam chave lowercase — assina também essa variante
    addWanted(safeIdLower(by), by);
    addWanted(appState.selfTrainerId, by);
    addWanted(appState.selfAuthUid, by);
  }
  for (const p of (appState.players || [])) {
    const tn = safeStr(p?.trainer_name);
    if (!tn) continue;
    addWanted(safeDocId(tn), tn);
    addWanted(safeIdLower(tn), tn);
    addWanted(p?.uid, tn);
    addWanted(p?.id, tn);
  }
  for (const p of (appState.pieces || [])) {
    const tn = safeStr(p?.owner);
    if (!tn) continue;
    addWanted(safeDocId(tn), tn);
    addWanted(safeIdLower(tn), tn);
  }

  // unsubscribe removidos
  for (const [uid, fn] of Array.from(userUnsub.entries())) {
    if (!wanted.has(uid)) {
      try { fn(); } catch {}
      userUnsub.delete(uid);
      try { appState.userProfiles.delete(uid); } catch {}
    }
  }

  // subscribe novos
  for (const [uid, tn] of wanted.entries()) {
    if (userUnsub.has(uid)) continue;
    try {
      const rawDoc = doc(currentDb, "users_raw", uid);
      const profileDoc = doc(currentDb, "users", uid);
      const pokemonMetaDoc = doc(currentDb, "users", uid, "trainer_hub", "pokemon_meta");
      const un1 = onSnapshot(rawDoc, (snap) => {
        const data = snap.exists() ? snap.data() : null;
        const cur = appState.userProfiles.get(uid) || {};
        cur.raw = data;
        appState.userProfiles.set(uid, cur);

        // 🔄 Se este uid corresponde ao treinador logado, atualiza selfUserData em tempo real.
        // Isso garante que mudanças feitas no Ga'Al Dex (party, itens…) reflitam na batalha
        // sem precisar reconectar.
        const selfBy = safeStr(appState.by);
        if (selfBy && data && (uid === safeDocId(selfBy) || uid === safeIdLower(selfBy))) {
          const freshData = data.data || data; // users_raw pode ter campo .data
          if (freshData && typeof freshData === "object" && Array.isArray(freshData.party)) {
            appState.selfUserData = freshData;
            updateTopBadges();
          }
        }

        updateSidePanels();
        window.requestScoreboardRefresh?.();
      }, () => {});
      const un2 = onSnapshot(profileDoc, (snap) => {
        const data = snap.exists() ? snap.data() : null;
        const cur = appState.userProfiles.get(uid) || {};
        cur.profile = data;
        appState.userProfiles.set(uid, cur);
        if (safeStr(appState.by) === safeStr(tn)) updateTopBadges();
        updateSidePanels();
        window.requestScoreboardRefresh?.();
      }, () => {});
      const un3 = onSnapshot(pokemonMetaDoc, (snap) => {
        const data = snap.exists() ? (snap.data() || {}) : null;
        const cur = appState.userProfiles.get(uid) || {};
        cur.hubPokemonMeta = _extractHubPokemonMetaMap(data) || null;
        cur.hubPokemonEntries = _extractHubPokemonEntriesMap(data) || null;
        appState.userProfiles.set(uid, cur);
        appState.globalHpRevision = (Number(appState.globalHpRevision) || 0) + 1;
        window.__globalHpRevision = appState.globalHpRevision;
        updateSidePanels();
        window.requestScoreboardRefresh?.();
        try { requestArenaRefresh(true); } catch {}
      }, () => {});
      userUnsub.set(uid, () => { try { un1(); } catch {} ; try { un2(); } catch {} ; try { un3(); } catch {} });
    } catch {}
  }
}


// -------------------------
// UI helpers
// -------------------------
function setStatus(kind, text) {
  // Não quebra o app se o HTML ainda não tiver o pill de status
  if (!statusEl) {
    try { console.warn("[pvp] statusEl ausente:", kind, text); } catch {}
    return;
  }
  statusEl.className = `pill ${kind}`;
  statusEl.textContent = text;
}

function setEntryLoginLoading(isLoading, text = "Validando login...") {
  if (entryLoginLoading) entryLoginLoading.hidden = !isLoading;
  if (entryLoginLoadingText) entryLoginLoadingText.textContent = text;
  if (connectBtn) {
    connectBtn.disabled = isLoading;
    connectBtn.textContent = isLoading ? "Entrando..." : "Conectar";
  }
  for (const el of [ridInput, byInput, pwInput, entryDisconnectBtn]) {
    if (el) el.disabled = isLoading;
  }
}

function pretty(x) {
  try {
    return JSON.stringify(x ?? null, null, 2);
  } catch {
    return String(x);
  }
}

function safeStr(x) {
  return (x == null ? "" : String(x)).trim();
}

function safeInt(x, fallback = 0) {
  const n = parseInt(x, 10);
  return Number.isFinite(n) ? n : fallback;
}

function safeDocId(name) {
  const s = safeStr(name) || "user";
  return s.replace(/[^a-zA-Z0-9_\-\.]/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "user";
}

function toTitleWords(value) {
  return safeStr(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (word.length <= 3 && word === word.toUpperCase()) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function humanizeInternalLabel(value) {
  let label = safeStr(value);
  if (!label) return "";
  if (label.startsWith("EXT:")) label = label.slice(4);
  label = label.replace(/^trainer_/i, "");
  label = label.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return toTitleWords(label);
}

function isTrainerPiece(pieceOrPid) {
  const pid = typeof pieceOrPid === "object" ? safeStr(pieceOrPid?.pid) : safeStr(pieceOrPid);
  const kind = typeof pieceOrPid === "object" ? safeStr(pieceOrPid?.kind) : "";
  return kind === "trainer" || /^trainer_/i.test(pid);
}

function displayNameFromPid(pid, opts = {}) {
  const rawPid = safeStr(pid?.pid ?? pid?.pokemon?.id ?? pid);
  const owner = safeStr(opts.owner);
  if (!rawPid) return owner || "Peca";
  const effectiveName = owner ? _getEffectivePokemonName(owner, pid) : "";
  if (effectiveName) return effectiveName;
  const mapped = safeStr(dexNameFromPid(rawPid) || resolvePokemonNameFromPid(rawPid));
  if (mapped) return mapped;
  if (/^trainer_/i.test(rawPid)) return owner || humanizeInternalLabel(rawPid) || "Treinador";
  return humanizeInternalLabel(rawPid) || owner || rawPid;
}

function displayNameFromPiece(piece, opts = {}) {
  const p = piece || {};
  const mine = opts.isMine != null ? !!opts.isMine : isPieceMine(p);
  const revealed = p?.revealed != null ? !!p.revealed : true;
  if (!opts.allowHiddenIdentity && !mine && !revealed) return "???";
  const owner = safeStr(opts.owner || p?.owner);
  if (isTrainerPiece(p)) return owner || displayNameFromPid(p?.pid, { owner });
  return displayNameFromPid({ pid: p?.pid, entry_id: _getEntryId(p), party_slot: _getPartySlot(p) }, { owner });
}

function pieceTypeLabel(piece) {
  return isTrainerPiece(piece) ? "Treinador" : "Pokemon";
}

function shortLabelFromPiece(piece, maxLen = 4) {
  const label = displayNameFromPiece(piece, { allowHiddenIdentity: false }) || "?";
  const compact = safeStr(label).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return (compact || "?").slice(0, Math.max(1, maxLen));
}

function battlePhaseLabel(phase) {
  const key = safeStr(phase).toLowerCase();
  if (!key || key === "idle") return "Aguardando iniciativa";
  if (key === "preprep_asking") return "Preprep";
  if (key === "active") return "Em andamento";
  return humanizeInternalLabel(key) || "Arena";
}

function trainerProfileStoragePath(trainerName) {
  const tn = safeStr(trainerName);
  return tn ? `trainer_photos/${safeDocId(tn)}/profile.png` : "";
}

function trainerAvatarStoragePath(trainerName, avatarChoice) {
  const tn = safeStr(trainerName);
  const choice = safeStr(avatarChoice);
  if (!tn || !choice) return "";
  return `trainer_avatars/${safeDocId(tn)}/avatar_${safeDocId(choice)}.png`;
}

function applyTrainerMediaFields(target, src) {
  if (!target || !src || typeof src !== "object") return;
  const nestedAvatar = src.avatar;
  const obj = (nestedAvatar && typeof nestedAvatar === "object" && !Array.isArray(nestedAvatar)) ? nestedAvatar : src;
  const pick = (key) => safeStr(obj?.[key] ?? src?.[key] ?? "");

  if (!target.photoThumbB64)     target.photoThumbB64 = pick("photo_thumb_b64");
  if (!target.photoStoragePath)  target.photoStoragePath = pick("photo_storage_path");
  if (!target.avatarChoice)      target.avatarChoice = pick("avatar_choice");
  if (!target.avatarStoragePath) target.avatarStoragePath = pick("avatar_storage_path");
  if (!target.avatarUrl)         target.avatarUrl = pick("avatar_url");
}

function getPublicPlayerEntryByTrainer(trainerName) {
  const tn = safeStr(trainerName);
  const ps = appState.publicPlayers;
  if (!tn || !ps || typeof ps !== "object") return null;

  const directKeys = [tn, safeStr(tn).trim(), safeStr(tn).toLowerCase(), safeDocId(tn), safeIdLower(tn)];
  for (const key of directKeys) {
    const direct = ps[key];
    if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;
  }

  const byId = (ps.byId && typeof ps.byId === "object") ? ps.byId : null;
  if (!byId) return null;

  for (const key of directKeys) {
    const entry = byId[key];
    if (entry && typeof entry === "object" && !Array.isArray(entry)) return entry;
  }

  for (const entry of Object.values(byId)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const entryName = safeStr(entry.trainer_name || entry.name || entry.by || entry.owner);
    if (entryName === tn) return entry;
  }
  return null;
}

function getTrainerCandidateIds(trainerName) {
  const tn = safeStr(trainerName);
  const ids = new Set();
  if (!tn) return [];

  ids.add(safeDocId(tn));
  ids.add(safeIdLower(tn));

  if (_trainerLookupKey(tn) === _trainerLookupKey(appState.by)) {
    ids.add(safeStr(appState.selfTrainerId));
    ids.add(safeStr(appState.selfAuthUid));
  }

  const player = (appState.players || []).find((p) => safeStr(p?.trainer_name) === tn);
  if (player) {
    ids.add(safeStr(player.uid));
    ids.add(safeStr(player.id));
  }

  const publicEntry = getPublicPlayerEntryByTrainer(tn);
  if (publicEntry) {
    ids.add(safeStr(publicEntry.uid));
    ids.add(safeStr(publicEntry.id));
    ids.add(safeStr(publicEntry.trainer_id));
  }

  return Array.from(ids).filter(Boolean);
}

function getTrainerMedia(trainerName) {
  const tn = safeStr(trainerName);
  const media = {
    trainerName: tn,
    photoThumbB64: "",
    photoStoragePath: "",
    avatarChoice: "",
    avatarStoragePath: "",
    avatarUrl: "",
    photoThumbSrc: "",
    profilePhotoSrc: "",
    profilePhotoFallbackSrc: "",
    avatarSrc: "",
  };
  if (!tn) return media;

  const player = (appState.players || []).find((p) => safeStr(p?.trainer_name) === tn);
  if (player?.avatar) applyTrainerMediaFields(media, player.avatar);

  const publicEntry = getPublicPlayerEntryByTrainer(tn);
  if (publicEntry) applyTrainerMediaFields(media, publicEntry);

  if (safeStr(appState.by) === tn && appState.selfUserData?.trainer_profile) {
    applyTrainerMediaFields(media, appState.selfUserData.trainer_profile);
  }

  for (const uid of getTrainerCandidateIds(tn)) {
    const entry = appState.userProfiles?.get?.(uid);
    if (!entry) continue;
    if (entry.profile) applyTrainerMediaFields(media, entry.profile);

    const raw = entry.raw?.data || entry.raw;
    if (raw?.trainer_profile) applyTrainerMediaFields(media, raw.trainer_profile);
  }

  media.photoThumbSrc = media.photoThumbB64 ? `data:image/png;base64,${media.photoThumbB64}` : "";
  media.profilePhotoSrc = media.photoStoragePath ? storageMediaUrl(media.photoStoragePath) : "";
  media.profilePhotoFallbackSrc = trainerProfileStoragePath(tn) ? storageMediaUrl(trainerProfileStoragePath(tn)) : "";

  const avatarStorageSrc = media.avatarStoragePath ? storageMediaUrl(media.avatarStoragePath) : "";
  const avatarChoicePath = trainerAvatarStoragePath(tn, media.avatarChoice);
  const avatarChoiceSrc = avatarChoicePath ? storageMediaUrl(avatarChoicePath) : "";
  media.avatarSrc = media.avatarUrl || avatarStorageSrc || avatarChoiceSrc;

  return media;
}

function getTrainerProfilePhotoSrc(trainerName, opts = {}) {
  const media = getTrainerMedia(trainerName);
  return media.photoThumbSrc
    || media.profilePhotoSrc
    || (opts.allowAvatarFallback ? media.avatarSrc : "")
    || media.profilePhotoFallbackSrc
    || "";
}

function getTrainerAvatarSrc(trainerName, opts = {}) {
  const media = getTrainerMedia(trainerName);
  return media.avatarSrc
    || (opts.allowProfileFallback
      ? (media.photoThumbSrc || media.profilePhotoSrc || media.profilePhotoFallbackSrc)
      : "")
    || "";
}

function trainerLetterDataUrl(trainerName) {
  const letter = (safeStr(trainerName).slice(0, 1).toUpperCase() || "?")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0f172a"/><stop offset="1" stop-color="#1d4ed8"/></linearGradient></defs><circle cx="32" cy="32" r="29" fill="url(#g)" stroke="#38bdf8" stroke-width="3"/><text x="32" y="41" text-anchor="middle" font-size="30" font-family="Arial,sans-serif" font-weight="700" fill="#e2e8f0">${letter}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function getTrainerSpriteSources(piece) {
  const pidStr = safeStr(piece?.pid);
  const owner = safeStr(piece?.owner || pidStr.replace(/^trainer_/, ""));
  const avatarObj = (piece?.avatar && typeof piece.avatar === "object" && !Array.isArray(piece.avatar)) ? piece.avatar : null;
  const avatarChoice = safeStr(piece?.avatar_choice || avatarObj?.avatar_choice || (typeof piece?.avatar === "string" ? piece.avatar : ""));
  const media = getTrainerMedia(owner);
  const candidates = [];
  const push = (value) => {
    const v = safeStr(value);
    if (v && !candidates.includes(v)) candidates.push(v);
  };

  push(media.avatarUrl);
  push(piece?.avatar_url);
  push(avatarObj?.avatar_url);

  // Local pokemon sprite — same source used in panels/party bar (must match)
  const effectiveChoice = avatarChoice || media.avatarChoice;
  if (effectiveChoice) push(`./pokemon/${effectiveChoice}.png`);

  const storageCandidates = [
    media.avatarStoragePath,
    piece?.avatar_storage_path,
    avatarObj?.avatar_storage_path,
    trainerAvatarStoragePath(owner, avatarChoice),
    trainerAvatarStoragePath(owner, media.avatarChoice),
  ];
  for (const path of storageCandidates) {
    const clean = safeStr(path);
    if (clean) push(storageMediaUrl(clean));
  }

  push(getTrainerProfilePhotoSrc(owner, { allowAvatarFallback: false }));

  const letterFallback = trainerLetterDataUrl(owner);
  push(letterFallback);

  return {
    primary: candidates[0] || letterFallback,
    fallback: candidates[1] || letterFallback,
  };
}

function getSpriteFallbackUrlForPiece(p) {
  const pidStr = safeStr(p?.pid);
  if (safeStr(p?.kind) === "trainer" || pidStr.startsWith("trainer_")) {
    return getTrainerSpriteSources(p).fallback || "";
  }

  const owner = safeStr(p?.owner);
  const effectiveCtx = owner ? _getEffectivePokemonContext(owner, p) : null;
  const effectiveSlug = _normalizePokemonFormSlug(effectiveCtx?.formSlug || (owner ? _getEffectivePokemonSlug(owner, pidStr) : ""));
  const remoteArtSlug = _getRemoteArtSlugForSprite(effectiveSlug, { sex: effectiveCtx?.sex });
  if (remoteArtSlug) {
    return `https://img.pokemondb.net/sprites/home/normal/${remoteArtSlug}.png`;
  }

  const name = resolvePokemonNameFromPid(p?.pid);
  const slug = _normalizePokemonFormSlug(name ? spriteSlugFromPokemonName(name) : "");
  const fallbackSlug = _getRemoteArtSlugForSprite(slug);
  return fallbackSlug ? `https://img.pokemondb.net/sprites/home/normal/${fallbackSlug}.png` : "";
}

window.getTrainerMedia = getTrainerMedia;
window.getTrainerProfilePhotoSrc = getTrainerProfilePhotoSrc;
window.getTrainerAvatarSrc = getTrainerAvatarSrc;

function inferRoleFromPlayers(players, by) {
  const name = safeStr(by);
  if (!name) return "—";
  const found = players.find((p) => safeStr(p.trainer_name) === name);
  return found?.role || "—";
}

function updateTopBadges() {
  if (ridBadge) ridBadge.textContent = appState.rid || "—";
  if (ridCardBadge) ridCardBadge.textContent = appState.rid || "—";
  if (meBadge) meBadge.textContent = `by: ${safeStr(appState.by) || "—"}`;
  if (byCardBadge) byCardBadge.textContent = safeStr(appState.by) || "—";
  if (roleBadge) roleBadge.textContent = `role: ${appState.role || "—"}`;

  const phase = safeStr(appState.battle?.status) || "idle";
  if (phaseBadge) phaseBadge.textContent = battlePhaseLabel(phase);
  if (trainerNameEl) trainerNameEl.textContent = safeStr(appState.by) || "—";
  if (avatarIcon) {
    const tn = safeStr(appState.by);
    if (!tn) {
      avatarIcon.textContent = "ðŸ™‚";
    } else {
      const letter = tn.slice(0, 1).toUpperCase();
      const mediaSrc = getTrainerProfilePhotoSrc(tn, { allowAvatarFallback: true });
      if (mediaSrc) {
        avatarIcon.innerHTML = `<img src="${escapeAttr(mediaSrc)}" alt="${escapeAttr(tn)}"
          style="width:26px;height:26px;border-radius:999px;object-fit:cover;display:block"
          onerror="var p=this.parentElement;this.remove();if(p)p.textContent='${letter}';">`;
      } else {
        avatarIcon.textContent = letter;
      }
    }
  }
  if (avatarIcon && false) {
    const tn = safeStr(appState.by);
    if (!tn) {
      avatarIcon.textContent = "🙂";
    } else {
      const url1 = storageMediaUrl(`trainer_photos/${tn}/profile.png`);
      const url2 = storageMediaUrl(`trainer_photos/${safeDocId(tn)}/profile.png`);
      const letter = tn.slice(0, 1).toUpperCase();
      // Verifica se existe foto base64 ou avatar_choice no selfUserData
      const prof = appState.selfUserData?.trainer_profile || {};
      const thumb  = safeStr(prof.photo_thumb_b64 || "");
      const choice = safeStr(prof.avatar_choice   || "");
      if (thumb) {
        // foto real (base64 thumb)
        avatarIcon.innerHTML = `<img src="data:image/png;base64,${escapeAttr(thumb)}" alt="${escapeAttr(tn)}"
          style="width:26px;height:26px;border-radius:999px;object-fit:cover;display:block">`;
      } else if (choice) {
        // sprite de treinador do Ga'Al Dex
        avatarIcon.innerHTML = `<img src="${escapeAttr(`./pokemon/${choice}.png`)}" alt="${escapeAttr(tn)}"
          style="width:26px;height:26px;border-radius:999px;object-fit:cover;display:block"
          onerror="var p=this.parentElement;this.remove();if(p)p.textContent='${letter}';">`;
      } else {
        // Render foto do treinador (Storage). Fallback: tenta pasta "safe" → letra.
        avatarIcon.innerHTML = `<img src="${escapeAttr(url1)}" alt="${escapeAttr(tn)}"
          style="width:26px;height:26px;border-radius:999px;object-fit:cover;display:block"
          onerror="if(this.dataset.fallback!=='1'){this.dataset.fallback='1';this.src='${escapeAttr(url2)}';}else{var p=this.parentElement;this.remove();if(p)p.textContent='${letter}';}">`;
      }
    }
  }

  const synced = appState.connected ? "Sincronizado ✓" : "Offline";
  if (syncBadge) syncBadge.textContent = synced;

  if (turnBadge) {
    const turnState = syncTurnStateWithCurrentBoard(appState.battle?.turn_state || null, appState.pieces);
    if (!turnState || !Array.isArray(turnState.order) || !turnState.order.length) {
      turnBadge.textContent = "Rodada — • aguardando iniciativa";
    } else if (safeStr(turnState.phase) === "preprep_asking") {
      turnBadge.textContent = `Rodada ${Number(turnState.round) || 1} • 📋 fase de preprep`;
    } else if (safeStr(turnState.phase) !== "active") {
      turnBadge.textContent = `Rodada ${Number(turnState.round) || 1} • aguardando nova iniciativa`;
    } else {
      const cur = getCurrentTurnActor();
      if (!cur) {
        turnBadge.textContent = `Rodada ${Number(turnState.round) || 1} • aguardando próxima ação`;
      } else {
        const owner = humanizeInternalLabel(cur.owner) || safeStr(cur.owner || "—");
        const mon = displayNameFromPid(cur.display || cur.pid || cur.pieceId || "Pokemon", { owner });
        const ownerSuffix = owner && owner !== "—" && owner !== mon ? ` (${owner})` : "";
        turnBadge.textContent = `Rodada ${Number(turnState.round) || 1} • Turno: ${mon}${ownerSuffix}`;
      }
    }
  }

  if (passTurnBtn) {
    passTurnBtn.disabled = !canCurrentPlayerPassTurn();
  }
}

function getBattleDocRef() {
  if (!currentDb || !currentRid) return null;
  return doc(currentDb, "rooms", currentRid, "public_state", "battle");
}

function isPieceInTurnRotation(piece) {
  if (!piece) return false;
  if (safeStr(piece?.status || "active") !== "active") return false;
  return Number.isFinite(Number(piece?.row)) && Number.isFinite(Number(piece?.col));
}

function getCurrentBoardTurnPieces(pieces = appState.pieces) {
  const list = Array.isArray(pieces) ? pieces : [];
  return list.filter(isPieceInTurnRotation);
}

function buildTurnOrderFromPieces(pieces, initiativeStore = appState.battle?.initiative || {}) {
  const activePieces = getCurrentBoardTurnPieces(pieces);
  const init = initiativeStore || {};
  const order = activePieces.map((p) => {
    const pieceId = safeStr(p?.id);
    const pieceKind = safeStr(p?.kind || "piece");
    const pid = safeStr(p?.pid);
    const owner = safeStr(p?.owner);
    const legacyKey = `piece:${pieceId}`;
    const keyedByKind = `${pieceKind}:${pieceId}`;
    const savedInit = init?.[keyedByKind] ?? init?.[legacyKey] ?? null;
    const initVal = Number(savedInit?.initiative);
    const display = safeStr((window.dexMap && (window.dexMap[pid] || window.dexMap[String(Number(pid))])) || p?.name || p?.display_name || pid || pieceId);
    return {
      pieceId,
      pieceKind,
      pid,
      owner,
      display,
      initiative: Number.isFinite(initVal) ? initVal : 0,
    };
  });

  order.sort((a, b) => {
    if (b.initiative !== a.initiative) return b.initiative - a.initiative;
    const byOwner = a.owner.localeCompare(b.owner);
    if (byOwner !== 0) return byOwner;
    return a.display.localeCompare(b.display);
  });
  return order;
}

function isTurnOrderEntryOnCurrentBoard(entry, pieces = appState.pieces) {
  const activePieces = getCurrentBoardTurnPieces(pieces);
  const pieceId = safeStr(entry?.pieceId);
  const pieceKind = safeStr(entry?.pieceKind || "piece");
  const owner = safeStr(entry?.owner);
  const pid = safeStr(entry?.pid);

  return activePieces.some((piece) => {
    const sameId = pieceId && safeStr(piece?.id) === pieceId;
    if (sameId) {
      const liveKind = safeStr(piece?.kind || "piece");
      return !pieceKind || pieceKind === "piece" || liveKind === pieceKind;
    }
    return !!owner && !!pid && safeStr(piece?.owner) === owner && safeStr(piece?.pid) === pid;
  });
}

function syncTurnStateWithCurrentBoard(turnState, pieces = appState.pieces) {
  const base = turnState && typeof turnState === "object" ? turnState : {};
  const order = Array.isArray(base.order) ? base.order : [];
  if (!order.length) return { ...base, order: [], index: 0 };

  const validFlags = order.map((entry) => isTurnOrderEntryOnCurrentBoard(entry, pieces));
  const syncedOrder = order.filter((_, idx) => validFlags[idx]);
  if (!syncedOrder.length) return { ...base, order: [], index: 0 };

  const originalIndex = Math.max(0, Number(base.index) || 0);
  let syncedIndex = 0;
  if (originalIndex < order.length && validFlags[originalIndex]) {
    syncedIndex = validFlags.slice(0, originalIndex).filter(Boolean).length;
  } else {
    const nextValidOriginalIndex = validFlags.findIndex((isValid, idx) => idx > originalIndex && isValid);
    syncedIndex = nextValidOriginalIndex >= 0
      ? validFlags.slice(0, nextValidOriginalIndex).filter(Boolean).length
      : 0;
  }
  syncedIndex = Math.max(0, Math.min(syncedOrder.length - 1, syncedIndex));

  return {
    ...base,
    order: syncedOrder,
    index: syncedIndex,
  };
}

function getCurrentTurnActor() {
  const turnState = syncTurnStateWithCurrentBoard(appState.battle?.turn_state, appState.pieces);
  const phase = safeStr(turnState?.phase);
  if (!turnState || (phase !== "active" && phase !== "preprep_asking")) return null;
  const order = Array.isArray(turnState.order) ? turnState.order : [];
  if (!order.length) return null;
  const idx = Math.max(0, Number(turnState.index) || 0);
  return order[idx] || null;
}

function isCurrentTurnOwnerMe() {
  const me = safeStr(appState.by);
  const cur = getCurrentTurnActor();
  return !!me && !!cur && safeStr(cur.owner) === me;
}

function canCurrentPlayerPassTurn() {
  return isCurrentTurnOwnerMe();
}

function currentTrainerOwnsBoardPiece() {
  const me = safeStr(appState.by);
  if (!me) return false;
  return (appState.pieces || []).some((piece) => safeStr(piece?.owner) === me);
}

function canCurrentPlayerStartCombat() {
  const opts = arguments[0] || {};
  const role = safeStr(appState.role);
  const isPlayer = role === "owner" || role === "challenger" || role === "gm" || currentTrainerOwnsBoardPiece();
  return isPlayer && (!!opts.ignoreTurn || isCurrentTurnOwnerMe());
}

function buildTurnOrderFromCurrentBoard() {
  return buildTurnOrderFromPieces(appState.pieces, appState.battle?.initiative || {});
}

function ensureHudTabLayoutStyleOnce() {
  if (document.getElementById("hud_tab_layout_style")) return;
  const st = document.createElement("style");
  st.id = "hud_tab_layout_style";
  st.textContent = `
    .hud-center [role="tabpanel"].panel{
      flex:0 0 clamp(380px, calc(var(--hud-viewport-height, 780px) - 12px), 840px) !important;
      height:clamp(380px, calc(var(--hud-viewport-height, 780px) - 12px), 840px) !important;
    }
    .hud-center [role="tabpanel"].panel .panel-inner{
      display:flex;
      flex-direction:column;
      min-height:0;
    }
    body.tab-arena-active .sidebar-left{
      display:block !important;
    }
    body:not(.tab-arena-active) .hud-body{
      grid-template-columns:minmax(0,1fr);
    }
    body:not(.tab-arena-active) .sidebar-left{
      display:none !important;
    }
    body[data-active-tab="sheets"] .hud-body{
      max-width:none;
      padding-left:10px;
      padding-right:10px;
    }
    @media (max-width: 1024px){
      .hud-center [role="tabpanel"].panel{
        flex:0 0 auto !important;
        height:auto !important;
        min-height:min(70vh, 720px) !important;
      }
    }
    @media (max-width: 700px){
      .hud-center [role="tabpanel"].panel{
        min-height:min(72vh, 560px) !important;
      }
    }
  `;
  document.head.appendChild(st);
}

function setTab(tabName) {
  ensureHudTabLayoutStyleOnce();
  const map = {
    arena: $("tab_arena"),
    combat: $("tab_combat"),
    initiative: $("tab_initiative"),
    sheets: $("tab_sheets"),
    log: $("tab_log"),
  };
  for (const [k, el] of Object.entries(map)) {
    if (!el) continue;
    el.style.display = k === tabName ? "" : "none";
  }
  qsa(".tab").forEach((t) => {
    const isActive = t.dataset.tab === tabName;
    t.classList.toggle("active", isActive);
    t.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  if (document.body) {
    document.body.classList.toggle("tab-arena-active", tabName === "arena");
    document.body.dataset.activeTab = tabName;
  }

  appState.activeTab = tabName;
  const inspectorRoot = $("inspector_root");
  if (inspectorRoot) {
    inspectorRoot.innerHTML = "";
    inspectorRoot.appendChild(renderInspectorCard());
  }
  if (tabName === "arena" && useCanvas) {
    view.autoFit = true;
    scheduleViewportStabilization({ includeArena: true, includeSheets: false, passes: 5 });
  } else if (tabName === "sheets") {
    scheduleViewportStabilization({ includeArena: false, includeSheets: true, passes: 3 });
  }
}

function supportsHoverTabs() {
  try {
    return !!window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches;
  } catch {
    return false;
  }
}

function moveNodeIntoContainer(node, container) {
  if (!node || !container || container.contains(node)) return;
  container.appendChild(node);
}

function syncArenaOverlayLayout() {
  moveNodeIntoContainer($("btn_draw_mode"), arenaToolsMenu);
  moveNodeIntoContainer($("draw-toolbar"), arenaToolsMenu);
  moveNodeIntoContainer($("field_conditions"), arenaToolsMenu);
  moveNodeIntoContainer($("fc_zone_panel"), arenaToolsMenu);
  ensureMapEditorPanel();
  renderMapEditorPanel();
}

function setArenaLeftOverlayOpen(open) {
  const next = !!open;
  appState.leftOverlayOpen = next;
  arenaLeftShell?.classList.toggle("is-open", next);
  arenaLeftToggle?.setAttribute("aria-expanded", next ? "true" : "false");
  arenaLeftDrawer?.setAttribute("aria-hidden", next ? "false" : "true");
}

function setArenaToolsMenuOpen(open) {
  const next = !!open;
  appState.toolsMenuOpen = next;
  arenaToolsShell?.classList.toggle("is-open", next);
  arenaToolsToggle?.setAttribute("aria-expanded", next ? "true" : "false");
  arenaToolsMenu?.setAttribute("aria-hidden", next ? "false" : "true");
  renderArenaHoverCard();
}

function ensureMapEditorPanel() {
  if (!arenaToolsMenu) return null;
  let panel = document.getElementById("map_editor_panel");
  if (panel) return panel;

  if (!document.getElementById("map_editor_style")) {
    const st = document.createElement("style");
    st.id = "map_editor_style";
    st.textContent = `
      .map-editor-panel{
        margin-top:12px;
        padding-top:12px;
        border-top:1px solid rgba(148,163,184,.16);
        display:flex;
        flex-direction:column;
        gap:10px;
      }
      .map-editor-panel[hidden]{display:none !important;}
      .map-editor-head{display:flex;align-items:center;justify-content:space-between;gap:10px;}
      .map-editor-title{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#e2e8f0;}
      .map-editor-sub{font-size:11px;color:#94a3b8;}
      .map-editor-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}
      .map-editor-btn{
        border:1px solid rgba(148,163,184,.24);
        background:rgba(15,23,42,.55);
        color:#e2e8f0;
        border-radius:10px;
        padding:7px 10px;
        font:inherit;
        cursor:pointer;
      }
      .map-editor-btn[disabled]{opacity:.45;cursor:not-allowed;}
      .map-editor-btn.is-active{
        border-color:rgba(56,189,248,.55);
        background:rgba(14,116,144,.22);
        box-shadow:0 0 0 1px rgba(56,189,248,.22) inset;
      }
      .map-editor-select{
        width:100%;
        border-radius:10px;
        border:1px solid rgba(148,163,184,.18);
        background:rgba(2,6,23,.72);
        color:#e2e8f0;
        padding:8px 10px;
      }
      .map-editor-grid{
        display:grid;
        grid-template-columns:repeat(auto-fill,minmax(92px,1fr));
        gap:8px;
        max-height:320px;
        overflow:auto;
        padding-right:4px;
      }
      .map-editor-asset{
        display:flex;
        flex-direction:column;
        gap:6px;
        align-items:center;
        justify-content:flex-start;
        min-height:110px;
        border:1px solid rgba(148,163,184,.18);
        border-radius:12px;
        background:rgba(2,6,23,.74);
        color:#e2e8f0;
        padding:8px 6px;
        cursor:pointer;
      }
      .map-editor-asset.is-active{
        border-color:rgba(34,197,94,.55);
        box-shadow:0 0 0 1px rgba(34,197,94,.22) inset;
        background:rgba(6,78,59,.2);
      }
      .map-editor-asset img{
        max-width:70px;
        max-height:70px;
        image-rendering:pixelated;
        object-fit:contain;
      }
      .map-editor-asset-label{
        font-size:10px;
        line-height:1.2;
        text-align:center;
        word-break:break-word;
      }
      .map-editor-note{
        font-size:11px;
        color:#cbd5e1;
        line-height:1.35;
      }
      .map-editor-disabled{
        opacity:.55;
        pointer-events:none;
      }
    `;
    document.head.appendChild(st);
  }

  panel = document.createElement("section");
  panel.id = "map_editor_panel";
  panel.className = "map-editor-panel";
  arenaToolsMenu.appendChild(panel);
  return panel;
}

function getMapEditorSelectedAsset() {
  return mapEditorState.assetIndex.get(`${safeStr(mapEditorState.selectedPool)}::${safeStr(mapEditorState.selectedAssetId)}`) || null;
}

function getMapEditorPools() {
  return (Array.isArray(mapEditorState.catalog?.pools) ? mapEditorState.catalog.pools : [])
    .filter((pool) => Number(pool?.count || 0) > 0);
}

function getMapEditorAssetsForPool(poolName) {
  return (Array.isArray(mapEditorState.catalog?.assets) ? mapEditorState.catalog.assets : [])
    .filter((asset) => safeStr(asset.assetPool) === safeStr(poolName));
}

function getCurrentBiomePoolName() {
  const biome = safeStr(mapDataState.baseData?.biome || mapDataState.currentData?.biome || "");
  return biome ? `biome:${biome}` : "";
}

function ensureMapEditorSelection() {
  const pools = getMapEditorPools();
  if (!pools.length) {
    mapEditorState.selectedPool = "";
    mapEditorState.selectedAssetId = "";
    return;
  }
  const biomePool = getCurrentBiomePoolName();
  const hasCurrentPool = pools.some((pool) => safeStr(pool.name) === safeStr(mapEditorState.selectedPool) && getMapEditorAssetsForPool(pool.name).length);
  if (!hasCurrentPool) {
    mapEditorState.selectedPool =
      pools.find((pool) => safeStr(pool.name) === biomePool && getMapEditorAssetsForPool(pool.name).length)?.name
      || pools.find((pool) => getMapEditorAssetsForPool(pool.name).length)?.name
      || "";
  }
  const assets = getMapEditorAssetsForPool(mapEditorState.selectedPool);
  if (!assets.some((asset) => safeStr(asset.assetId) === safeStr(mapEditorState.selectedAssetId))) {
    mapEditorState.selectedAssetId = safeStr(assets[0]?.assetId);
  }
}

function closeConflictingArenaModes() {
  try { clearPokemonPlacingMode(); } catch {}
  try { selectPiece(null); } catch {}
  try { hidePieceContextMenu(); } catch {}
  try { hidePiecePickerMenu(); } catch {}
  try { window.setArenaDrawMode?.(false); } catch {}
  try { window.clearArenaZoneAndTrapModes?.(); } catch {}
}

function setMapEditorEnabled(active) {
  if (!mapEditorIsOwner()) return;
  mapEditorState.enabled = !!active;
  if (mapEditorState.enabled) {
    closeConflictingArenaModes();
    maybeLoadMapData();
  }
  renderMapEditorPanel();
  refreshEffectiveMapData();
}

function setMapEditorMode(mode) {
  mapEditorState.mode = mode === "add" ? "add" : "remove";
  if (mapEditorState.mode === "add") ensureMapEditorSelection();
  renderMapEditorPanel();
}

function pushMapEditorHistory() {
  mapEditorState.history.push(cloneJson(mapEditorState.draft || createEmptyMapEdits()));
  if (mapEditorState.history.length > 30) {
    mapEditorState.history = mapEditorState.history.slice(-30);
  }
}

function updateMapEditorDraft(mutator) {
  const currentBase = getCurrentMapBaseSpec();
  if (!mapEditorState.draft || !sameMapBaseSpec(mapEditorState.draft.baseSpec, currentBase)) {
    mapEditorState.draft = normalizeMapEdits(mapEditorState.published, currentBase);
  }
  pushMapEditorHistory();
  const nextDraft = normalizeMapEdits(cloneJson(mapEditorState.draft), currentBase);
  mutator(nextDraft);
  mapEditorState.draft = normalizeMapEdits(nextDraft, currentBase);
  renderMapEditorPanel();
  refreshEffectiveMapData();
}

function undoMapEditorDraft() {
  if (!mapEditorState.history.length) return;
  mapEditorState.draft = normalizeMapEdits(mapEditorState.history.pop(), getCurrentMapBaseSpec());
  renderMapEditorPanel();
  refreshEffectiveMapData();
}

function discardMapEditorDraft() {
  mapEditorState.history = [];
  mapEditorState.draft = normalizeMapEdits(mapEditorState.published, getCurrentMapBaseSpec());
  renderMapEditorPanel();
  refreshEffectiveMapData();
}

function handlePublishedMapEdits(raw) {
  mapEditorState.rawPublished = raw || null;
  const baseSpec = getCurrentMapBaseSpec();
  const published = normalizeMapEdits(raw, baseSpec);
  mapEditorState.published = published;
  const shouldResetDraft =
    !mapEditorState.draft ||
    !sameMapBaseSpec(mapEditorState.draft.baseSpec, baseSpec) ||
    !isMapEditorDirty() ||
    published.revision >= Number(mapEditorState.draft?.revision || 0);
  if (shouldResetDraft) {
    mapEditorState.draft = cloneJson(published);
    mapEditorState.history = [];
  }
  renderMapEditorPanel();
  refreshEffectiveMapData();
}

function getMapEditorAnchorMask(assetPool, terrainGrid) {
  const grid = Array.isArray(terrainGrid) ? terrainGrid : [];
  if (!grid.length) return [];
  const pool = safeStr(assetPool);
  if (pool === "water_flora" || pool === "beach_corals") {
    return grid.map((row) => row.map((cell) => Number(cell) === 2));
  }
  if (["beach_shells", "beach_starfish", "beach_palms", "beach_ai_palms", "desert_ai_dunes"].includes(pool)) {
    return grid.map((row) => row.map((cell) => Number(cell) === 1));
  }
  return grid.map((row) => row.map((cell) => Number(cell) !== 2));
}

function canPlaceMapEditorAsset(mapData, assetMeta, x, y) {
  const terrain = Array.isArray(mapData?.terrain_grid) ? mapData.terrain_grid : [];
  if (!terrain.length) return { ok: false, reason: "Sem terreno carregado." };
  const height = terrain.length;
  const width = Array.isArray(terrain[0]) ? terrain[0].length : 0;
  const fw = Math.max(1, Number(assetMeta?.footprint?.w || 1) || 1);
  const fh = Math.max(1, Number(assetMeta?.footprint?.h || 1) || 1);
  if (x < 0 || y < 0 || x + fw > width || y + fh > height) {
    return { ok: false, reason: "Fora do mapa." };
  }
  const anchorMask = getMapEditorAnchorMask(assetMeta?.assetPool, terrain);
  const baseY = y + fh - 1;
  if (!anchorMask[baseY]?.slice(x, x + fw).every(Boolean)) {
    return { ok: false, reason: "Terreno incompatível para esse asset." };
  }
  if (safeStr(assetMeta?.sizeClass) !== "micro") {
    for (let row = y; row < y + fh; row++) {
      if (!anchorMask[row]?.slice(x, x + fw).every(Boolean)) {
        return { ok: false, reason: "O footprint do asset não cabe nesse terreno." };
      }
    }
  }
  const x1 = x + fw;
  const y1 = y + fh;
  for (const obj of Array.isArray(mapData?.objects) ? mapData.objects : []) {
    const rect = getMapObjectRect(obj);
    if (x < rect.x1 && x1 > rect.x0 && y < rect.y1 && y1 > rect.y0) {
      return { ok: false, reason: "Já existe um asset ocupando essa área." };
    }
  }
  return { ok: true, reason: "" };
}

function buildManualMapObject(assetMeta, x, y) {
  const tilePx = getEffectiveMapTilePx();
  const baseTilePx = Number(assetMeta?.baseTilePx || 32) || 32;
  const scale = tilePx / baseTilePx;
  const spriteW = Math.max(1, Math.round((Number(assetMeta?.image?.w || 1) || 1) * scale));
  const spriteH = Math.max(1, Math.round((Number(assetMeta?.image?.h || 1) || 1) * scale));
  const fw = Math.max(1, Number(assetMeta?.footprint?.w || 1) || 1);
  const fh = Math.max(1, Number(assetMeta?.footprint?.h || 1) || 1);
  const areaW = fw * tilePx;
  const areaH = fh * tilePx;
  const offX = Math.round((areaW - spriteW) / 2);
  const offY = Math.round(areaH - spriteH);
  return normalizeMapObject({
    id: `manual_${Math.random().toString(36).slice(2, 10)}`,
    kind: safeStr(assetMeta?.assetPool || "manual_asset").replaceAll(":", "_"),
    x,
    y,
    assetId: safeStr(assetMeta?.assetId),
    assetPool: safeStr(assetMeta?.assetPool),
    origin: "manual",
    sprite: "",
    anchor: { ax: 0.5, ay: 1.0 },
    footprint: { w: fw, h: fh },
    support: { w: Math.max(1, Number(assetMeta?.support?.w || fw) || fw), baseY: y + fh - 1 },
    blocks: assetMeta?.blocks !== false,
    occludes: !!assetMeta?.occludes,
    splitSprite: false,
    topSprite: "",
    render: {
      pxX: x * tilePx + offX,
      pxY: y * tilePx + offY,
      offsetX: offX,
      offsetY: offY,
      w: spriteW,
      h: spriteH,
    },
  });
}

function removeMapObjectAt(row, col) {
  const objects = getMapObjectsAt(row, col);
  if (!objects.length) {
    setStatus("warn", "Nenhum asset nesse tile.");
    return;
  }
  const target = objects[0];
  updateMapEditorDraft((draft) => {
    if (safeStr(target.origin) === "manual") {
      draft.addedObjects = (draft.addedObjects || []).filter((obj) => safeStr(obj.id) !== safeStr(target.id));
      draft.removedObjectIds = (draft.removedObjectIds || []).filter((id) => safeStr(id) !== safeStr(target.id));
    } else {
      const ids = new Set((draft.removedObjectIds || []).map((id) => safeStr(id)).filter(Boolean));
      ids.add(safeStr(target.id));
      draft.removedObjectIds = Array.from(ids).sort();
    }
  });
  setStatus("ok", "Asset removido do rascunho.");
}

function addMapObjectAt(row, col) {
  const assetMeta = getMapEditorSelectedAsset();
  if (!assetMeta) {
    setStatus("warn", "Selecione um asset antes de adicionar.");
    return;
  }
  const effectiveMap = mapDataState.data || mapDataState.baseData;
  const placement = canPlaceMapEditorAsset(effectiveMap, assetMeta, col, row);
  if (!placement.ok) {
    setStatus("warn", placement.reason);
    return;
  }
  updateMapEditorDraft((draft) => {
    draft.addedObjects = Array.isArray(draft.addedObjects) ? draft.addedObjects : [];
    draft.addedObjects.push(buildManualMapObject(assetMeta, col, row));
  });
  setStatus("ok", "Asset adicionado ao rascunho.");
}

async function saveMapEditorDraft() {
  if (!currentDb || !currentRid || !mapEditorIsOwner()) return;
  const baseSpec = getCurrentMapBaseSpec();
  let draft = normalizeMapEdits(mapEditorState.draft, baseSpec);
  const published = normalizeMapEdits(mapEditorState.published, baseSpec);
  if (areMapEditsEqual(draft, published)) return;

  draft.baseSignature = await computeMapBaseSignature(baseSpec);
  draft.baseSpec = cloneJson(baseSpec);
  if (hasMapEditChanges(draft)) {
    draft.revision = Math.max(Number(published.revision || 0), Number(draft.revision || 0), Number(appState.board?.mapEditRevision || 0)) + 1;
  } else {
    draft.revision = 0;
  }
  draft.updatedBy = safeStr(appState.by);
  draft.updatedAt = null;

  const editsRef = doc(currentDb, "rooms", currentRid, "public_state", "map_edits");
  const stateRef = doc(currentDb, "rooms", currentRid, "public_state", "state");

  mapEditorState.saving = true;
  renderMapEditorPanel();
  refreshEffectiveMapData();
  try {
    const batch = writeBatch(currentDb);
    batch.set(editsRef, {
      baseSignature: draft.baseSignature,
      baseSpec: draft.baseSpec,
      removedObjectIds: draft.removedObjectIds || [],
      addedObjects: draft.addedObjects || [],
      revision: draft.revision,
      updatedBy: draft.updatedBy,
      updatedAt: serverTimestamp(),
    });
    batch.set(stateRef, {
      mapEdited: hasMapEditChanges(draft),
      mapEditRevision: Number(draft.revision || 0) || 0,
      mapEditBaseSignature: hasMapEditChanges(draft) ? safeStr(draft.baseSignature) : "",
      mapEditPublishPending: false,
      mapEditRequestedRevision: Number(draft.revision || 0) || 0,
      mapEditRequestedBy: safeStr(appState.by),
      mapEditRequestedAt: serverTimestamp(),
      mapEditPublishError: "",
    }, { merge: true });
    await batch.commit();

    mapEditorState.draft = normalizeMapEdits(draft, baseSpec);
    mapEditorState.history = [];
    setStatus("ok", "Edição do mapa salva.");
  } catch (err) {
    console.error("[map-editor] save error:", err);
    setStatus("err", `Falha ao salvar edição do mapa: ${err?.message || err}`);
  } finally {
    mapEditorState.saving = false;
    renderMapEditorPanel();
    refreshEffectiveMapData();
  }
}

function handleMapEditorTileAction(row, col) {
  if (!mapEditorIsOwner()) return false;
  if (!mapEditorState.enabled) return false;
  if (mapEditorState.mode === "add") {
    addMapObjectAt(row, col);
  } else {
    removeMapObjectAt(row, col);
  }
  return true;
}

function renderMapEditorPanel() {
  const panel = ensureMapEditorPanel();
  if (!panel) return;
  const owner = mapEditorIsOwner();
  panel.hidden = !owner;
  if (!owner) return;

  ensureMapEditorSelection();
  const dirty = isMapEditorDirty();
  const publishedRevision = Number(mapEditorState.published?.revision || 0);
  const baseReady = !!mapDataState.baseData && !!getActiveMapTerrainUrl();
  const catalogReady = !!mapEditorState.catalog;
  const statusText = mapEditorState.saving
    ? "Salvando..."
    : dirty
      ? "Rascunho pendente"
      : publishedRevision > 0
        ? "Publicado"
        : "Sem edições publicadas";
  const pools = getMapEditorPools();
  const assets = getMapEditorAssetsForPool(mapEditorState.selectedPool);
  const selectedAssetId = safeStr(mapEditorState.selectedAssetId);
  const disableAdd = !baseReady || !catalogReady;

  panel.innerHTML = `
    <div class="map-editor-head">
        <div>
          <div class="map-editor-title">Edição de Assets</div>
          <div class="map-editor-sub">${escapeHtml(statusText)} • rev ${publishedRevision}</div>
        </div>
      <button type="button" class="map-editor-btn ${mapEditorState.enabled ? "is-active" : ""}" id="map_editor_toggle_btn">
        ${mapEditorState.enabled ? "Desativar" : "Modo edição"}
      </button>
    </div>
    <div class="map-editor-row">
      <button type="button" class="map-editor-btn ${mapEditorState.mode === "remove" ? "is-active" : ""}" id="map_editor_mode_remove" ${mapEditorState.enabled ? "" : "disabled"}>Remover</button>
      <button type="button" class="map-editor-btn ${mapEditorState.mode === "add" ? "is-active" : ""}" id="map_editor_mode_add" ${mapEditorState.enabled ? "" : "disabled"}>Adicionar</button>
      <button type="button" class="map-editor-btn" id="map_editor_undo" ${(mapEditorState.history.length && mapEditorState.enabled) ? "" : "disabled"}>Desfazer</button>
      <button type="button" class="map-editor-btn" id="map_editor_discard" ${dirty ? "" : "disabled"}>Descartar rascunho</button>
      <button type="button" class="map-editor-btn" id="map_editor_save" ${dirty && !mapEditorState.saving ? "" : "disabled"}>Salvar/Publicar</button>
    </div>
    <div class="map-editor-note">
      ${baseReady ? "Clique no mapa para remover ou adicionar assets decorativos." : "Esta sala ainda não tem o bundle base do mapa publicado."}
    </div>
    <div class="${(!mapEditorState.enabled || disableAdd || mapEditorState.mode !== "add") ? "map-editor-disabled" : ""}">
      <select class="map-editor-select" id="map_editor_pool_select" ${(!mapEditorState.enabled || disableAdd) ? "disabled" : ""}>
        ${pools.map((pool) => `<option value="${escapeAttr(pool.name)}" ${safeStr(pool.name) === safeStr(mapEditorState.selectedPool) ? "selected" : ""}>${escapeHtml(pool.label || mapEditorPoolLabel(pool.name))} (${Number(pool.count || 0)})</option>`).join("")}
      </select>
      <div class="map-editor-grid" id="map_editor_asset_grid">
        ${assets.map((asset) => `
          <button type="button" class="map-editor-asset ${safeStr(asset.assetId) === selectedAssetId ? "is-active" : ""}" data-map-asset-id="${escapeAttr(asset.assetId)}" ${(!mapEditorState.enabled || disableAdd) ? "disabled" : ""}>
            <img src="${escapeAttr(safeStr(asset.thumbnailUrl || asset.spriteUrl || ""))}" alt="${escapeAttr(asset.label || asset.assetId)}">
            <span class="map-editor-asset-label">${escapeHtml(asset.label || asset.assetId)}</span>
          </button>
        `).join("") || `<div class="map-editor-note">Nenhum asset disponível nesse pool.</div>`}
      </div>
    </div>
  `;

  panel.querySelector("#map_editor_toggle_btn")?.addEventListener("click", () => setMapEditorEnabled(!mapEditorState.enabled));
  panel.querySelector("#map_editor_mode_remove")?.addEventListener("click", () => setMapEditorMode("remove"));
  panel.querySelector("#map_editor_mode_add")?.addEventListener("click", () => setMapEditorMode("add"));
  panel.querySelector("#map_editor_undo")?.addEventListener("click", undoMapEditorDraft);
  panel.querySelector("#map_editor_discard")?.addEventListener("click", discardMapEditorDraft);
  panel.querySelector("#map_editor_save")?.addEventListener("click", () => { saveMapEditorDraft(); });
  panel.querySelector("#map_editor_pool_select")?.addEventListener("change", (ev) => {
    mapEditorState.selectedPool = safeStr(ev.target?.value);
    mapEditorState.selectedAssetId = "";
    ensureMapEditorSelection();
    renderMapEditorPanel();
  });
  panel.querySelectorAll("[data-map-asset-id]").forEach((button) => {
    button.addEventListener("click", () => {
      mapEditorState.selectedAssetId = safeStr(button.dataset.mapAssetId);
      mapEditorState.mode = "add";
      renderMapEditorPanel();
    });
  });
}

function setArenaHoverPiece(pieceOrId, { persist = false } = {}) {
  const id = safeStr(typeof pieceOrId === "string" ? pieceOrId : pieceOrId?.id);
  appState.hoveredPieceId = id || null;
  if (persist && id) appState.lastInteractedPieceId = id;
  renderArenaHoverCard();
}

function bindTabInteractions() {
  qsa(".tab").forEach((t) => {
    t.addEventListener("click", (ev) => {
      ev.preventDefault();
      setTab(t.dataset.tab);
    });
  });
}

arenaLeftToggle?.addEventListener("click", (ev) => {
  ev.preventDefault();
  ev.stopPropagation();
  syncArenaOverlayLayout();
  setArenaLeftOverlayOpen(!appState.leftOverlayOpen);
});

arenaToolsToggle?.addEventListener("click", (ev) => {
  ev.preventDefault();
  ev.stopPropagation();
  syncArenaOverlayLayout();
  setArenaToolsMenuOpen(!appState.toolsMenuOpen);
});

bindTabInteractions();

// -------------------------
// Firestore actions
// -------------------------
async function sendAction(type, by, payload) {
  if (!currentDb || !currentRid) {
    setStatus("err", "conecte antes de enviar ações");
    return false;
  }
  try {
    const ref = await addDoc(collection(currentDb, "rooms", currentRid, "actions"), {
      type,
      by,
      payload: payload || {},
      createdAt: serverTimestamp(),
      status: "new",
    });
    if (lastActionEl) lastActionEl.textContent = ref?.id ? `id: ${ref.id}` : "—";
    setStatus("ok", `ação enviada: ${type}`);
    return true;
  } catch (e) {
    setStatus("err", `erro ao enviar ação: ${e?.message || e}`);
    return false;
  }
}

addLogBtn?.addEventListener("click", async () => {
  const by = safeStr(byInput?.value || "Anon") || "Anon";
  const text = safeStr(logTextInput?.value || "") || "teste";
  await sendAction("ADD_LOG", by, { text });
  logTextInput.value = "";
});

// ─────────────────────────────────────────────────────────────────────────────
// Auto-log de eventos da arena
// Dispara ADD_LOG automaticamente quando o jogador local coloca/move/recolhe
// uma peça sua, ou quando o HP de um pokémon seu muda. Só o cliente dono da
// peça emite para evitar duplicação entre clientes.
// ─────────────────────────────────────────────────────────────────────────────
let _arenaLogPiecesBootstrapped = false;
let _arenaLogLastPieces = new Map(); // id -> { row, col, owner, pid, name }
let _arenaLogHpBootstrapped = false;
let _arenaLogLastHp = new Map(); // `${owner}|${pid}` -> hp
const _arenaLogRecentKeys = new Map(); // key -> timestamp (dedupe window)

function _arenaLogPieceLabel(piece) {
  try {
    const name = displayNameFromPiece(piece, { allowHiddenIdentity: true, isMine: true });
    const raw = safeStr(name) || safeStr(piece?.pid) || "Pokémon";
    return raw;
  } catch {
    return safeStr(piece?.pid) || "Pokémon";
  }
}

function _arenaLogShouldEmit(key, windowMs = 2500) {
  const now = Date.now();
  const prev = _arenaLogRecentKeys.get(key) || 0;
  if (now - prev < windowMs) return false;
  _arenaLogRecentKeys.set(key, now);
  // GC ocasional
  if (_arenaLogRecentKeys.size > 120) {
    for (const [k, t] of _arenaLogRecentKeys) {
      if (now - t > 30000) _arenaLogRecentKeys.delete(k);
    }
  }
  return true;
}

function autoLogArenaEvent(text, { dedupeKey = "" } = {}) {
  const msg = safeStr(text);
  if (!msg) return;
  if (!currentDb || !currentRid || !appState.connected) return;
  const by = safeStr(appState.by || byInput?.value || "") || "";
  if (!by) return;
  const key = dedupeKey || msg;
  if (!_arenaLogShouldEmit(key)) return;
  // fire-and-forget
  sendAction("ADD_LOG", by, { text: msg, auto: true }).catch(() => {});
}

function autoLogPiecesDiff(nextPieces) {
  const nextMap = new Map();
  const byName = safeStr(appState.by).toLowerCase();
  for (const p of Array.isArray(nextPieces) ? nextPieces : []) {
    const id = safeStr(p?.id);
    if (!id) continue;
    nextMap.set(id, {
      row: Number(p?.row),
      col: Number(p?.col),
      owner: safeStr(p?.owner),
      pid: safeStr(p?.pid),
      revealed: !!p?.revealed,
      _raw: p,
    });
  }

  if (!_arenaLogPiecesBootstrapped) {
    _arenaLogLastPieces = nextMap;
    _arenaLogPiecesBootstrapped = true;
    return;
  }

  // Entradas (novas peças)
  for (const [id, cur] of nextMap) {
    if (_arenaLogLastPieces.has(id)) continue;
    if (cur.owner.toLowerCase() !== byName) continue; // só a peça minha
    const label = _arenaLogPieceLabel(cur._raw);
    autoLogArenaEvent(`➕ ${label} entrou no campo em (${cur.row + 1},${cur.col + 1})`, {
      dedupeKey: `enter|${id}`,
    });
  }

  // Saídas (peças removidas)
  for (const [id, prev] of _arenaLogLastPieces) {
    if (nextMap.has(id)) continue;
    if (prev.owner.toLowerCase() !== byName) continue;
    const label = _arenaLogPieceLabel(prev._raw);
    autoLogArenaEvent(`↩️ ${label} foi recolhido do campo`, {
      dedupeKey: `exit|${id}`,
    });
  }

  // Movimentos (mesma peça mudou row/col)
  for (const [id, cur] of nextMap) {
    const prev = _arenaLogLastPieces.get(id);
    if (!prev) continue;
    if (cur.owner.toLowerCase() !== byName) continue;
    if (prev.row === cur.row && prev.col === cur.col) continue;
    const label = _arenaLogPieceLabel(cur._raw);
    autoLogArenaEvent(
      `🚶 ${label} moveu-se de (${prev.row + 1},${prev.col + 1}) para (${cur.row + 1},${cur.col + 1})`,
      { dedupeKey: `move|${id}|${cur.row}:${cur.col}` }
    );
  }

  _arenaLogLastPieces = nextMap;
}

function autoLogPartyStatesDiff(nextPartyStates) {
  const byName = safeStr(appState.by).toLowerCase();
  if (!byName) {
    _arenaLogHpBootstrapped = true;
    return;
  }
  const nextHp = new Map();
  const ownerBucket = (nextPartyStates && nextPartyStates[safeStr(appState.by)]) || {};
  for (const [pid, ps] of Object.entries(ownerBucket || {})) {
    if (!ps || typeof ps !== "object") continue;
    const hp = Number(ps.hp);
    if (Number.isFinite(hp)) nextHp.set(safeStr(pid), hp);
  }
  if (!_arenaLogHpBootstrapped) {
    _arenaLogLastHp = nextHp;
    _arenaLogHpBootstrapped = true;
    return;
  }
  for (const [pid, hp] of nextHp) {
    const prev = _arenaLogLastHp.get(pid);
    if (prev == null || prev === hp) continue;
    // Só loga mudanças significativas (inteiros distintos)
    const delta = hp - prev;
    // Usa o pid como label básico (nome amigável pode ser resolvido via sheets)
    let name = pid;
    try {
      const piece = (appState.pieces || []).find(
        (p) => safeStr(p?.owner) === safeStr(appState.by) && safeStr(p?.pid) === pid
      );
      if (piece) name = _arenaLogPieceLabel(piece);
    } catch {}
    if (hp <= 0 && prev > 0) {
      autoLogArenaEvent(`💥 ${name} foi nocauteado (HP 0)`, { dedupeKey: `ko|${pid}` });
    } else if (delta < 0) {
      autoLogArenaEvent(`💢 ${name} perdeu ${Math.abs(delta)} HP (${prev}→${hp})`, {
        dedupeKey: `dmg|${pid}|${hp}`,
      });
    } else if (delta > 0) {
      autoLogArenaEvent(`💚 ${name} recuperou ${delta} HP (${prev}→${hp})`, {
        dedupeKey: `heal|${pid}|${hp}`,
      });
    }
  }
  _arenaLogLastHp = nextHp;
}

function resetAutoArenaLogState() {
  _arenaLogPiecesBootstrapped = false;
  _arenaLogLastPieces = new Map();
  _arenaLogHpBootstrapped = false;
  _arenaLogLastHp = new Map();
  _arenaLogRecentKeys.clear();
}

// Sub-aba de Log: batalha / movimento / dados
document.getElementById("log_subtabs")?.addEventListener("click", (ev) => {
  const btn = ev.target.closest?.("[data-log-kind]");
  if (!btn) return;
  _setActiveLogSubtab(btn.dataset.logKind);
});

// Expor no console (compatibilidade com debug antigo)
window.sendAddLog = async (by, text) => sendAction("ADD_LOG", by || "Anon", { text: text || "teste" });

const ROLL_FX_D20_MS = 2000;
const ROLL_FX_D20_FRAME_BY_VALUE = Object.freeze({
  1: 0, 7: 1, 13: 2, 4: 3, 18: 4,
  2: 5, 9: 6, 15: 7, 5: 8, 20: 9,
  3: 10, 11: 11, 6: 12, 17: 13, 8: 14,
  14: 15, 10: 16, 16: 17, 12: 18, 19: 19,
});
let currentRollFxLayer = null;
const rollFxAnimationWaiters = new Map();
const rollFxCompletedKeys = new Set();
const rollFxPlayedKeys = new Set();
const rollFxPlayingPromises = new Map();
const recentLocalRollFxPlays = [];

function d20Roll() {
  return Math.floor(Math.random() * 20) + 1;
}

function makeRollRequestId(prefix = "roll") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sleepRollFx(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rememberLocalRollFxPlay(value) {
  const roll = safeInt(value, 0);
  if (!roll) return;
  const now = Date.now();
  recentLocalRollFxPlays.push({ value: roll, at: now });
  while (recentLocalRollFxPlays.length && now - recentLocalRollFxPlays[0].at > 8000) {
    recentLocalRollFxPlays.shift();
  }
}

function hasRecentLocalRollFxPlay(value) {
  const roll = safeInt(value, 0);
  if (!roll) return false;
  const now = Date.now();
  while (recentLocalRollFxPlays.length && now - recentLocalRollFxPlays[0].at > 8000) {
    recentLocalRollFxPlays.shift();
  }
  return recentLocalRollFxPlays.some((entry) => entry.value === roll && now - entry.at <= 8000);
}

function ensureRollFxStyles() {
  if (document.getElementById("roll_fx_styles")) return;
  const st = document.createElement("style");
  st.id = "roll_fx_styles";
  st.textContent = `
.roll-fx-layer {
  position: fixed;
  inset: 0;
  z-index: 10050;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(2,6,23,.28);
}
.roll-fx-panel {
  width: min(290px, calc(100% - 28px));
  border-radius: 14px;
  border: 1px solid rgba(148,163,184,.28);
  background: rgba(10,18,32,.95);
  box-shadow: 0 18px 46px rgba(2,6,23,.55);
  backdrop-filter: blur(12px);
  padding: 14px;
  text-align: center;
  animation: rollFxFadeIn .16s ease-out;
}
.roll-fx-title {
  font-size: 13px;
  font-weight: 900;
  color: rgba(226,232,240,.95);
  margin-bottom: 8px;
}
.roll-fx-sprite {
  width: 96px;
  height: 96px;
  margin: 0 auto 10px;
  image-rendering: auto;
  background-repeat: no-repeat;
  background-position: 0 0;
}
.roll-fx-d20 {
  background-image: url("./assets/ui/d20-roll-sprite.svg");
  background-size: 1920px 96px;
}
.roll-fx-d20.roll-fx-rolling {
  animation: rollFxD20 1s steps(19) 2;
}
.roll-fx-value {
  min-height: 38px;
  font-size: 30px;
  font-weight: 1000;
  color: rgba(248,250,252,.96);
  margin-top: -4px;
}
.roll-fx-note {
  min-height: 18px;
  margin-top: -2px;
  color: rgba(203,213,225,.86);
  font-size: 12px;
  font-weight: 750;
}
.roll-fx-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.roll-fx-btn {
  border: 1px solid rgba(148,163,184,.28);
  border-radius: 999px;
  background: rgba(15,23,42,.88);
  color: rgba(226,232,240,.96);
  padding: 8px 12px;
  font: inherit;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}
.roll-fx-btn:hover {
  border-color: rgba(56,189,248,.56);
  background: rgba(30,41,59,.94);
}
.roll-fx-btn.roll-fx-primary {
  border-color: rgba(250,204,21,.55);
  background: linear-gradient(180deg, rgba(250,204,21,.22), rgba(245,158,11,.16));
  color: #fef3c7;
}
.roll-fx-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  border: 1px solid rgba(148,163,184,.22);
  border-radius: 999px;
  padding: 8px 12px;
  color: rgba(226,232,240,.94);
  background: rgba(2,6,23,.34);
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}
.roll-fx-toggle input {
  width: 16px;
  height: 16px;
  accent-color: #f59e0b;
}
@keyframes rollFxFadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes rollFxD20 {
  from { background-position: 0 0; }
  to { background-position: -1824px 0; }
}`;
  document.head.appendChild(st);
}

function d20FrameForRollFx(value) {
  const roll = safeInt(value, 0);
  return ROLL_FX_D20_FRAME_BY_VALUE[roll] ?? Math.max(0, Math.min(19, roll - 1));
}

async function playDiceRollAnimation({ label = "d20", value = null, shared = false } = {}) {
  try {
    if (!shared) rememberLocalRollFxPlay(value);
    ensureRollFxStyles();
    try { currentRollFxLayer?.remove?.(); } catch {}

    const layer = document.createElement("div");
    layer.className = "roll-fx-layer";
    layer.innerHTML = `
      <div class="roll-fx-panel">
        <div class="roll-fx-title">${escapeHtml(safeStr(label) || "d20")}</div>
        <div class="roll-fx-sprite roll-fx-d20 roll-fx-rolling" data-roll-fx-sprite></div>
        <div class="roll-fx-value" data-roll-fx-value></div>
      </div>
    `;
    document.body.appendChild(layer);
    currentRollFxLayer = layer;

    await sleepRollFx(ROLL_FX_D20_MS);
    const sprite = layer.querySelector("[data-roll-fx-sprite]");
    const valueEl = layer.querySelector("[data-roll-fx-value]");
    if (sprite) {
      sprite.classList.remove("roll-fx-rolling");
      sprite.style.animation = "none";
      sprite.style.backgroundPosition = `-${d20FrameForRollFx(value) * 96}px 0`;
    }
    if (valueEl && value != null) valueEl.textContent = String(safeInt(value, 0));
    await sleepRollFx(420);

    if (currentRollFxLayer === layer) currentRollFxLayer = null;
    try { layer.remove(); } catch {}
  } catch {}
  return value;
}

window.playDiceRollAnimation = playDiceRollAnimation;

function resolveRollFxWaiter(key) {
  const waitKey = safeStr(key);
  if (!waitKey) return;
  rollFxCompletedKeys.add(waitKey);
  const waiter = rollFxAnimationWaiters.get(waitKey);
  if (!waiter) return;
  rollFxAnimationWaiters.delete(waitKey);
  try { clearTimeout(waiter.timeout); } catch {}
  try { waiter.resolve(); } catch {}
}

function waitForSharedRollAnimation(key, fallback = {}) {
  const waitKey = safeStr(key);
  if (!waitKey || rollFxCompletedKeys.has(waitKey)) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(async () => {
      rollFxAnimationWaiters.delete(waitKey);
      try {
        await playDiceRollAnimation(fallback);
      } finally {
        rollFxCompletedKeys.add(waitKey);
        resolve();
      }
    }, Math.max(ROLL_FX_D20_MS + 1800, 3600));
    rollFxAnimationWaiters.set(waitKey, { resolve, timeout });
  });
}

async function playSharedRollAnimationFromDoc(docId, roll) {
  const requestId = safeStr(roll?.requestId || roll?.rollId || docId);
  const explicitRequestId = safeStr(roll?.requestId || roll?.rollId);
  const playKey = requestId || safeStr(docId);
  if (!playKey) return;
  if (rollFxPlayingPromises.has(playKey)) return rollFxPlayingPromises.get(playKey);
  if (rollFxPlayedKeys.has(playKey)) return;
  const rawValue = roll?.rawValue != null ? roll.rawValue : roll?.value;
  const value = safeInt(rawValue, 0);
  const label = safeStr(roll?.animationLabel || roll?.label || "Dado") || "Dado";
  const trainer = safeStr(roll?.trainer || roll?.by);
  if (!explicitRequestId && trainer && trainer === safeStr(appState.by) && hasRecentLocalRollFxPlay(value)) {
    rollFxPlayedKeys.add(playKey);
    resolveRollFxWaiter(requestId);
    resolveRollFxWaiter(docId);
    return;
  }
  rollFxPlayedKeys.add(playKey);
  const playPromise = (async () => {
    try {
      await playDiceRollAnimation({ label, value, shared: true });
    } finally {
      rollFxPlayingPromises.delete(playKey);
      resolveRollFxWaiter(requestId);
      resolveRollFxWaiter(docId);
    }
  })();
  rollFxPlayingPromises.set(playKey, playPromise);
  return playPromise;
}

function playLocalSharedRollAnimation(key, { label = "Dado", value = null } = {}) {
  const playKey = safeStr(key);
  if (!playKey) return playDiceRollAnimation({ label, value, shared: true });
  if (rollFxPlayingPromises.has(playKey)) return rollFxPlayingPromises.get(playKey);
  if (rollFxPlayedKeys.has(playKey)) return Promise.resolve();
  rollFxPlayedKeys.add(playKey);
  const playPromise = (async () => {
    try {
      await playDiceRollAnimation({ label, value, shared: true });
    } finally {
      rollFxPlayingPromises.delete(playKey);
      resolveRollFxWaiter(playKey);
    }
  })();
  rollFxPlayingPromises.set(playKey, playPromise);
  return playPromise;
}

function removeRollDecisionLayer(layer) {
  if (currentRollFxLayer === layer) currentRollFxLayer = null;
  try { layer.remove(); } catch {}
}

function showRollRerollPrompt(value) {
  return new Promise((resolve) => {
    ensureRollFxStyles();
    try { currentRollFxLayer?.remove?.(); } catch {}
    const layer = document.createElement("div");
    layer.className = "roll-fx-layer";
    layer.innerHTML = `
      <div class="roll-fx-panel">
        <div class="roll-fx-title">Resultado do Dado</div>
        <div class="roll-fx-value">${safeInt(value, 0)}</div>
        <div class="roll-fx-note">Escolha se este resultado será mantido.</div>
        <div class="roll-fx-actions">
          <button type="button" class="roll-fx-btn roll-fx-primary" data-roll-decision="reroll">Rejogar Dado</button>
          <button type="button" class="roll-fx-btn" data-roll-decision="keep">Manter Dado</button>
        </div>
      </div>
    `;
    document.body.appendChild(layer);
    currentRollFxLayer = layer;

    layer.querySelector('[data-roll-decision="reroll"]')?.addEventListener("click", () => {
      removeRollDecisionLayer(layer);
      resolve(true);
    });
    layer.querySelector('[data-roll-decision="keep"]')?.addEventListener("click", () => {
      removeRollDecisionLayer(layer);
      resolve(false);
    });
  });
}

function applyHeroPointReroll(rawValue, heroPoint) {
  const raw = safeInt(rawValue, 0);
  return heroPoint && raw > 0 && raw <= 10 ? raw + 10 : raw;
}

function showRollHeroPointPrompt(rawValue) {
  return new Promise((resolve) => {
    ensureRollFxStyles();
    try { currentRollFxLayer?.remove?.(); } catch {}
    const raw = safeInt(rawValue, 0);
    const layer = document.createElement("div");
    layer.className = "roll-fx-layer";
    layer.innerHTML = `
      <div class="roll-fx-panel">
        <div class="roll-fx-title">Segundo Resultado</div>
        <div class="roll-fx-value" data-roll-final-value>${raw}</div>
        <label class="roll-fx-toggle">
          <input type="checkbox" data-roll-ph>
          <span>Foi PH</span>
        </label>
        <div class="roll-fx-note" data-roll-ph-note>Resultado bruto do segundo dado.</div>
        <div class="roll-fx-actions">
          <button type="button" class="roll-fx-btn roll-fx-primary" data-roll-decision="accept">Adotar Resultado</button>
        </div>
      </div>
    `;
    document.body.appendChild(layer);
    currentRollFxLayer = layer;

    const phInput = layer.querySelector("[data-roll-ph]");
    const valueEl = layer.querySelector("[data-roll-final-value]");
    const noteEl = layer.querySelector("[data-roll-ph-note]");
    const refresh = () => {
      const heroPoint = !!phInput?.checked;
      const finalValue = applyHeroPointReroll(raw, heroPoint);
      if (valueEl) valueEl.textContent = String(finalValue);
      if (noteEl) {
        noteEl.textContent = heroPoint
          ? (finalValue !== raw ? `PH: ${raw} + 10 = ${finalValue}.` : "PH marcado; dado acima de 10 não muda.")
          : "Resultado bruto do segundo dado.";
      }
    };
    phInput?.addEventListener("change", refresh);
    refresh();

    layer.querySelector('[data-roll-decision="accept"]')?.addEventListener("click", () => {
      const heroPoint = !!phInput?.checked;
      removeRollDecisionLayer(layer);
      resolve({ heroPoint, finalValue: applyHeroPointReroll(raw, heroPoint) });
    });
  });
}

async function publishRoomRoll({ by, value, rawValue = value, label = "d20", animationLabel = "Dado", requestId = "", rollRound = 1, sourceRollId = "", final = false, heroPoint = false } = {}) {
  return addDoc(collection(currentDb, "rooms", currentRid, "rolls"), {
    by,
    trainer: by,
    value,
    rawValue,
    label,
    animationLabel,
    requestId,
    rollRound,
    sourceRollId,
    final,
    heroPoint,
    kind: "dice",
    clientCreatedAt: Date.now(),
    createdAt: serverTimestamp(),
  });
}

async function finishTopRollResult(finalValue) {
  const battleRef = getBattleDocRef();
  if (!battleRef) throw new Error("estado da batalha indisponivel");

  const turnState = appState.battle?.turn_state || null;
  const phase = safeStr(turnState?.phase);
  if (phase !== "active") {
    const order = buildTurnOrderFromCurrentBoard();
    if (order.length) {
      const currentRound = Number(turnState?.round) || 0;
      const nextTurnState = {
        round: currentRound + 1,
        phase: "active",
        index: 0,
        order,
        updatedAt: Date.now(),
      };
      await runTransaction(currentDb, async (tx) => {
        tx.set(battleRef, { turn_state: nextTurnState }, { merge: true });
      });
      setStatus("ok", `dado rolado: ${finalValue} • Rodada ${currentRound + 1} iniciada!`);
      return;
    }
  }
  setStatus("ok", `dado rolado: ${finalValue}`);
}
// window.sendMovePiece removido (debug antigo) — mover agora é por clique/arrasto no grid.

topRollBtn?.addEventListener("click", async () => {
  if (!currentDb || !currentRid || !appState.connected) {
    setStatus("err", "conecte antes de rolar dado");
    return;
  }

  const by = safeStr(appState.by || byInput?.value || "Anon") || "Anon";
  const value = d20Roll();

  const prevDisabled = topRollBtn.disabled;
  const prevLabel = topRollBtn.textContent;
  topRollBtn.disabled = true;
  topRollBtn.textContent = "⏳ Rolando...";

  try {
    const firstRequestId = makeRollRequestId("roll");
    const firstRef = await publishRoomRoll({
      by,
      value,
      rawValue: value,
      label: "d20",
      animationLabel: "Dado",
      requestId: firstRequestId,
      rollRound: 1,
      final: true,
    });
    await playLocalSharedRollAnimation(firstRequestId, { label: "Dado", value });

    let finalValue = value;
    const shouldReroll = await showRollRerollPrompt(value);
    if (shouldReroll) {
      await setDoc(firstRef, { final: false, rerolled: true, supersededAt: serverTimestamp() }, { merge: true });

      const rerollValue = d20Roll();
      const secondRequestId = makeRollRequestId("reroll");
      const secondRef = await publishRoomRoll({
        by,
        value: rerollValue,
        rawValue: rerollValue,
        label: "d20",
        animationLabel: "Rejogar Dado",
        requestId: secondRequestId,
        rollRound: 2,
        sourceRollId: firstRef.id,
        final: false,
      });
      await playLocalSharedRollAnimation(secondRequestId, { label: "Rejogar Dado", value: rerollValue });

      const phDecision = await showRollHeroPointPrompt(rerollValue);
      finalValue = safeInt(phDecision?.finalValue, rerollValue);
      const heroPoint = !!phDecision?.heroPoint;
      await setDoc(secondRef, {
        value: finalValue,
        rawValue: rerollValue,
        label: heroPoint ? "d20 PH" : "d20",
        heroPoint,
        final: true,
        finalizedAt: serverTimestamp(),
      }, { merge: true });
    }

    await finishTopRollResult(finalValue);
  } catch (e) {
    setStatus("err", `erro ao rolar dado: ${e?.message || e}`);
  } finally {
    topRollBtn.disabled = prevDisabled;
    topRollBtn.textContent = prevLabel || "🎲 Rolar Dado";
  }
});

function tickMmActiveEffectsOnTurnPass(activeEffects, currentTurn, roundEnded) {
  const currentOwner = safeStr(currentTurn?.owner);
  const currentPid = safeStr(currentTurn?.pid);
  const expired = [];
  const next = [];

  for (const effect of Array.isArray(activeEffects) ? activeEffects : []) {
    if (!effect || typeof effect !== "object") continue;
    const tickPolicy = safeStr(effect.tickPolicy || "owner_turn_end");
    const remainingRaw = effect.remainingTurns;
    const remaining = Number(remainingRaw);
    const hasCounter = remainingRaw !== null && remainingRaw !== undefined && remainingRaw !== "" && Number.isFinite(remaining);
    const ownerMatch = safeStr(effect.owner) === currentOwner && (!safeStr(effect.pid) || safeStr(effect.pid) === currentPid);
    const shouldTick = tickPolicy === "round_end" ? !!roundEnded : ownerMatch;

    if (!hasCounter || !shouldTick) {
      next.push(effect);
      continue;
    }

    const after = remaining - 1;
    if (after <= 0) {
      expired.push(effect);
    } else {
      next.push({ ...effect, remainingTurns: after });
    }
  }

  return { active_effects: next, expired };
}

passTurnBtn?.addEventListener("click", async () => {
  if (!currentDb || !currentRid || !appState.connected) {
    setStatus("err", "conecte antes de passar o turno");
    return;
  }
  if (!canCurrentPlayerPassTurn()) {
    setStatus("err", "apenas o jogador do turno pode passar");
    return;
  }

  const battleRef = getBattleDocRef();
  if (!battleRef) {
    setStatus("err", "estado da batalha indisponivel");
    return;
  }

  try {
    await runTransaction(currentDb, async (tx) => {
      const stateRef = getStateDocRef();
      const snap = await tx.get(battleRef);
      const battleData = snap.exists() ? snap.data() : {};
      const stateSnap = stateRef ? await tx.get(stateRef) : null;
      const stateData = stateSnap?.exists?.() ? stateSnap.data() : {};
      const livePieces = Array.isArray(stateData?.pieces) ? stateData.pieces : [];
      const turnState = syncTurnStateWithCurrentBoard(battleData?.turn_state || {}, livePieces);
      const phase = safeStr(turnState.phase);
      const order = Array.isArray(turnState.order) ? turnState.order : [];
      if (phase === "preprep_asking") throw new Error("aguardando fase de preprep");
      if (phase !== "active" || !order.length) throw new Error("não há rodada ativa");

      const me = safeStr(appState.by);
      const idx = Math.max(0, Number(turnState.index) || 0);
      const cur = order[idx] || null;
      if (!cur || safeStr(cur.owner) !== me) throw new Error("não é seu turno");

      let nextIndex = idx + 1;
      let nextRound = Number(turnState.round) || 1;
      let nextPhase = "active";
      let nextOrder = order;
      let roundEnded = false;
      if (nextIndex >= order.length) {
        nextRound += 1;
        nextOrder = buildTurnOrderFromPieces(livePieces, battleData?.initiative || {});
        nextIndex = 0;
        nextPhase = nextOrder.length ? "preprep_asking" : "awaiting_initiative";
        roundEnded = true;
      }

      const _updatePayload = {
        turn_state: {
          ...turnState,
          round: nextRound,
          index: nextIndex,
          order: nextOrder,
          phase: nextPhase,
          updatedAt: Date.now(),
        },
      };
      if (roundEnded && nextOrder.length) {
        _updatePayload.preprep = { phase: "asking", responses: {}, data: {} };
      }
      const tickedEffects = tickMmActiveEffectsOnTurnPass(battleData?.active_effects, cur, roundEnded);
      if (tickedEffects.expired.length || tickedEffects.active_effects.length !== (Array.isArray(battleData?.active_effects) ? battleData.active_effects.length : 0)) {
        _updatePayload.active_effects = tickedEffects.active_effects;
      }

      tx.set(
        battleRef,
        _updatePayload,
        { merge: true }
      );
    });

    setStatus("ok", "turno avançado");
  } catch (e) {
    setStatus("err", `erro ao passar turno: ${e?.message || e}`);
  }
});

// -------------------------
// Connect / disconnect
// -------------------------
function cleanup() {
  try { teardownSheetsRealtime(); } catch {}

  unsub.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
  unsub = [];
  currentDb = null;
  currentRid = null;

  appState.connected = false;
  appState.rid = null;
  appState.players = [];
  appState.board = null;
  appState.battle = null;
  appState.publicPlayers = null;
  appState.pokemonForms = null;
  appState.piecesRaw = [];
  appState.pieces = [];
  appState.selectedPieceId = null;
  appState.selfUserData = null;
  appState.selfPartySnapshot = null;
  appState.selfAuthStatus = null;
  appState.selfTrainerId = null;
  appState.selfAuthUid = null;
  appState.renderedLogKeys = new Set();
  appState.placing = null;
  appState.placingPid = null;
  resetPieceFieldFx();
  resetAutoArenaLogState();

  if (playersPre) playersPre.textContent = "—";
  if (statePre) statePre.textContent = "—";
  if (battlePre) battlePre.textContent = "—";
  if (actionsLogEl) actionsLogEl.textContent = "—";
  if (lastActionEl) lastActionEl.textContent = "—";
  if (logList) logList.innerHTML = "";
  if (logCount) logCount.textContent = "0";

  updateSidePanels();
  updateTopBadges();
  setTab("arena");
  document.body.classList.add("preconnect");
  setStatus("warn", "desconectado");
}

disconnectBtn?.addEventListener("click", cleanup);
disconnectPanelBtn?.addEventListener("click", cleanup);
entryDisconnectBtn?.addEventListener("click", cleanup);

connectBtn?.addEventListener("click", async () => {
  if (connectBtn?.disabled) return;
  cleanup();
  const rid = safeStr(ridInput?.value || "");
  if (!rid) {
    setStatus("err", "faltou rid");
    return;
  }

  const app = getApps().length ? getApps()[0] : initializeApp(DEFAULT_FIREBASE_CONFIG);
  const db = getFirestore(app);
  const auth = getAuth(app);
  
  // login
  const typedName = safeStr(byInput?.value || "");
  const typedPassword = String(pwInput?.value || "");
  setEntryLoginLoading(true, "Validando login...");
  let login;
  try {
    login = await ensureLoggedInIfNeeded(db, auth, typedName, typedPassword);
  } catch (e) {
    setEntryLoginLoading(false);
    setStatus("err", `erro no login: ${e?.message || e || "desconhecido"}`);
    return;
  }
  if (!login.ok) {
    setEntryLoginLoading(false);
    if (login.cancel) {
      setStatus("warn", "login cancelado");
    } else if (login.status === "NOT_FOUND") {
      setStatus("err", "usuário não encontrado na planilha");
    } else if (login.status === "WRONG_PASS") {
      setStatus("err", "senha incorreta");
    } else {
      setStatus("err", `erro no login: ${login.message || login.status || "desconhecido"}`);
    }
    return;
  }
  setEntryLoginLoading(false);

  const by = safeStr(login.name || "");
  appState.by = by;
  if (byInput && by) byInput.value = by;
  if (pwInput) pwInput.value = "";
  updateTopBadges();

  currentDb = db;
  currentRid = rid;
  window._combatDb = db;
  appState.connected = true;
  appState.rid = rid;
  setTab("arena");
  document.body.classList.remove("preconnect");
  setStatus("ok", "conectado");
  updateTopBadges();
  // ✅ iniciar realtime das fichas do treinador logado
  try {
    ensureSheetsRealtime?.();
  } catch (e) {
    console.warn("ensureSheetsRealtime falhou:", e);
  }

  // players (suporta 2 formatos: subcoleção rooms/{rid}/players e/ou campos no doc rooms/{rid})
  try {
    ensureSelfTrainerRpgSheetRealtime?.();
  } catch (e) {
    console.warn("ensureSelfTrainerRpgSheetRealtime falhou:", e);
  }

  let playersFromCol = [];
  let playersFromRoom = [];
  const commitPlayers = () => {
    // merge por (role+trainer_name)
    const seen = new Set();
    const merged = [];
    for (const arr of [playersFromRoom, playersFromCol]) {
      for (const p of arr) {
        const key = `${safeStr(p.role)}::${safeStr(p.trainer_name)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(p);
      }
    }
    merged.sort(
      (a, b) => (a.role || "").localeCompare(b.role || "") || (a.trainer_name || "").localeCompare(b.trainer_name || "")
    );
    appState.players = merged;
    appState.role = inferRoleFromPlayers(merged, appState.by);
    if (playersPre) playersPre.textContent = pretty(merged);
    if (playersCount) playersCount.textContent = String(merged.length);
    updateTopBadges();
    updateSidePanels();
    renderMapEditorPanel?.();
    window.requestScoreboardRefresh?.();
    ensureUserSubscriptions();
    _refreshResolvedRoomPieces();
    requestArenaRefresh(true);
  };

  // A) subcoleção rooms/{rid}/players
  try {
    const playersCol = collection(db, "rooms", rid, "players");
    unsub.push(
      onSnapshot(
        playersCol,
        (qs) => {
          const out = [];
          qs.forEach((d) => {
            const p = d.data() || {};
            const role = safeStr(p.role) || "player";
            const trainer_name = safeStr(p.trainer_name || p.name || p.by || d.id);
            out.push({ role, trainer_name, id: d.id, uid: safeStr(p.uid || d.id), avatar: p.avatar || null, party_snapshot: Array.isArray(p.party_snapshot) ? p.party_snapshot : [] });
          });
          playersFromCol = out;
          commitPlayers();
        },
        (err) => {
          // não falha o app; só loga no devtools
          if (playersPre) playersPre.textContent = "Erro (players col): " + err.message;
        }
      )
    );
  } catch {}

  // B) doc rooms/{rid} (formato do debug antigo: owner/challengers/spectators)
  const roomDoc = doc(db, "rooms", rid);
  unsub.push(
    onSnapshot(
      roomDoc,
      (snap) => {
        const data = snap.exists() ? snap.data() : null;
        const out = [];
        if (data?.owner?.name) out.push({ role: "owner", trainer_name: safeStr(data.owner.name) });
        if (Array.isArray(data?.challengers)) {
          for (const ch of data.challengers) {
            const nm = ch && (ch.name ?? ch.trainer_name);
            if (nm) out.push({ role: "challenger", trainer_name: safeStr(nm) });
          }
        }
        if (Array.isArray(data?.spectators)) {
          for (const sp of data.spectators) {
            const nm = typeof sp === "string" ? sp : sp && (sp.name ?? sp.trainer_name);
            if (nm) out.push({ role: "spectator", trainer_name: safeStr(nm) });
          }
        }
        playersFromRoom = out;
        commitPlayers();
      },
      () => {}
    )
  );

  // public_state/state
  const stateDoc = doc(db, "rooms", rid, "public_state", "state");
  unsub.push(
    onSnapshot(
      stateDoc,
      (snap) => {
        const data = snap.exists() ? snap.data() : null;
        appState.board = data;
        appState.gridSize = Number(data?.gridSize) || 10;
        appState.theme = safeStr(data?.theme) || "biome_grass";
        appState.piecesRaw = Array.isArray(data?.pieces) ? data.pieces : [];
        _refreshResolvedRoomPieces();
        try { autoLogPiecesDiff(appState.pieces); } catch {}
        appState.traps  = Array.isArray(data?.traps)  ? data.traps  : [];
        appState.zones  = Array.isArray(data?.zones)  ? data.zones  : [];
        if (statePre) statePre.textContent = pretty(data);
        handlePublishedMapEdits(mapEditorState.rawPublished);
        updateArenaMeta();
        updateSidePanels();
        try { renderSheetsTab(); } catch {}
        renderMapEditorPanel?.();
        // Garante que treinadores que entraram só via peças (sem registro em players) também têm
        // users_raw/users assinados, permitindo carregar party e avatar corretamente.
        ensureUserSubscriptions();
        requestArenaRefresh(true);
        if (useCanvas && view.autoFit) fitToView();
      },
      (err) => {
        if (statePre) statePre.textContent = "Erro: " + err.message;
      }
    )
  );

  const mapEditsDoc = doc(db, "rooms", rid, "public_state", "map_edits");
  unsub.push(
    onSnapshot(
      mapEditsDoc,
      (snap) => {
        const raw = snap.exists() ? snap.data() : null;
        handlePublishedMapEdits(raw);
      },
      (err) => {
        console.warn("public_state/map_edits error:", err?.message || err);
        handlePublishedMapEdits(null);
      }
    )
  );

  // public_state/players  ✅ (parties prontas por treinador)
const playersDoc = doc(db, "rooms", rid, "public_state", "players");
unsub.push(
  onSnapshot(
    playersDoc,
    (snap) => {
      appState.publicPlayers = snap.exists() ? snap.data() : null;
      _refreshResolvedRoomPieces();
      const pp = $("players_preview");
      if (pp) pp.textContent = pretty(appState.publicPlayers);

      // re-render UI que usa party (scoreboard/painéis)
      updateSidePanels?.();
      try { renderSheetsTab(); } catch {}
      updateArenaMeta?.();
      window.requestScoreboardRefresh?.();
      requestArenaRefresh(true);
    },
    (err) => {
      console.warn("public_state/players error:", err?.message || err);
    }
  )
);

  // public_state/battle
  const battleDoc = doc(db, "rooms", rid, "public_state", "battle");
  unsub.push(
    onSnapshot(
      battleDoc,
      (snap) => {
        const data = snap.exists() ? snap.data() : null;
        appState.battle = data;
        if (battlePre) battlePre.textContent = pretty(data);
        const bp = $("battle_preview");
        if (bp) bp.textContent = pretty(data);
        const ip = $("initiative_preview");
        if (ip) ip.textContent = pretty(data?.initiative || null);
        const sp = $("sheets_preview");
        if (sp) sp.textContent = pretty({ selectedPieceId: appState.selectedPieceId });
        updateTopBadges();
        updateFieldConditionsUI?.();
        renderLogsIncremental();
      },
      (err) => {
        if (battlePre) battlePre.textContent = "Erro: " + err.message;
      }
    )
  );

  const pokemonFormsDoc = doc(db, "rooms", rid, "public_state", "pokemon_forms");
  unsub.push(
    onSnapshot(
      pokemonFormsDoc,
      (snap) => {
        appState.pokemonForms = snap.exists() ? (snap.data() || {}) : {};
        try { updateSidePanels?.(); } catch {}
        try { renderSheetsTab?.(); } catch {}
        try { window.requestScoreboardRefresh?.(); } catch {}
        try { requestArenaRefresh(true); } catch {}
      },
      () => {}
    )
  );

  // (debug antigo) listener de "Últimas actions" removido.

// ── HUD de Rolagens Globais ────────────────────────────────────────
const rollsBanner = $("rolls_banner");
const rollPillText = $("roll_pill_text"); // (vamos criar no HTML já já)

if (rollsBanner) {
  try {
    const rollsCol = collection(db, "rooms", rid, "rolls");
    const rollsQ = query(rollsCol, orderBy("createdAt", "desc"), limit(1));
    let rollBannerTimer = null;
    let rollsSnapshotReady = false;
    let latestRollDocId = "";
    const rollsListenerStartedAt = Date.now();
    const hideRollBanner = () => {
      if (rollBannerTimer) {
        clearTimeout(rollBannerTimer);
        rollBannerTimer = null;
      }
      rollsBanner.style.display = "none";
      document.body.classList.remove("has-roll-banner");
    };
    const renderRollBanner = (roll) => {
      const trainer = safeStr(roll.trainer || roll.by) || "???";
      const value = roll.value != null ? roll.value : "?";
      const rawValue = roll.rawValue != null ? roll.rawValue : value;
      const label = safeStr(roll.label);
      const heroPoint = !!roll.heroPoint;
      const renderedValue = heroPoint && safeInt(rawValue, 0) !== safeInt(value, 0)
        ? `${rawValue}+10=${value}`
        : `${value}`;

      const msg = `${trainer} ${renderedValue}${label ? " (" + label + ")" : ""}`;

      // atualiza pill fixo
      if (rollPillText) rollPillText.textContent = msg;

      // mantém banner (opcional)
      rollsBanner.textContent = `🎲 ${trainer} rolou ${renderedValue}${label ? " (" + label + ")" : ""}`;
      rollsBanner.style.display = "block";
      document.body.classList.add("has-roll-banner");

      if (rollBannerTimer) clearTimeout(rollBannerTimer);
      rollBannerTimer = setTimeout(() => {
        rollsBanner.style.display = "none";
        document.body.classList.remove("has-roll-banner");
      }, 8000);
    };

    unsub.push(
      onSnapshot(
        rollsQ,
        (qs) => {
          const wasRollsSnapshotReady = rollsSnapshotReady;
          rollsSnapshotReady = true;
          if (qs.empty) {
            // se quiser, deixa o pill mostrando "—"
            if (rollPillText) rollPillText.textContent = "—";
            return;
          }

          const latestDoc = qs.docs[0];
          const latestRoll = latestDoc.data();
          const docId = safeStr(latestDoc.id);
          const clientCreatedAt = Number(latestRoll.clientCreatedAt) || 0;
          const freshInitialRoll = !latestRollDocId
            && !wasRollsSnapshotReady
            && clientCreatedAt >= rollsListenerStartedAt - 2000;
          const shouldAnimateRoll = !!(docId && (latestRollDocId ? docId !== latestRollDocId : (wasRollsSnapshotReady || freshInitialRoll)));
          if (shouldAnimateRoll) {
            hideRollBanner();
            void Promise.resolve(playSharedRollAnimationFromDoc(docId, latestRoll))
              .then(() => renderRollBanner(latestRoll))
              .catch(() => renderRollBanner(latestRoll));
          } else {
            renderRollBanner(latestRoll);
          }
          latestRollDocId = docId;
        },
        (err) => {
          console.warn("rolls onSnapshot error:", err);
          // Mostra no topo que deu erro (pra ficar óbvio)
          if (rollPillText) rollPillText.textContent = "erro (veja console)";
        }
      )
    );
  } catch (e) {
    console.warn("rolls listener error:", e);
    if (rollPillText) rollPillText.textContent = "erro (try/catch)";
  }
} // <- fecha o if (rollsBanner)
}); 

if (initialConnectionParams?.autoConnect && connectBtn && safeStr(ridInput?.value || "")) {
  window.setTimeout(() => {
    if (appState.connected) return;
    setStatus("warn", "conectando pela URL...");
    connectBtn.click();
  }, 50);
}

// Keep badges updated when user edits inputs
byInput?.addEventListener("input", () => {
  appState.by = safeStr(byInput.value);
  appState.role = inferRoleFromPlayers(appState.players, appState.by);
  updateTopBadges();
  updateSidePanels();
  updateFieldConditionsUI?.();
});

function updateArenaMeta() {
  if (!arenaMeta) return;
  const gs = appState.gridSize || 10;
  arenaMeta.textContent = `grid ${gs}×${gs} • tema ${appState.theme || "—"}`;
}

// ── Field Conditions UI ──────────────────────────────────────────────────────
const fieldConditionsEl = $("field_conditions");

function updateFieldConditionsUI() {
  if (!fieldConditionsEl) return;
  const role = safeStr(appState.role);
  const isSpectator = role === "spectator";
  fieldConditionsEl.classList.toggle("fc-hidden", isSpectator);

  const weather = safeStr(appState.battle?.weather || appState.board?.weather || "").toLowerCase();
  const terrain = safeStr(appState.battle?.terrain || appState.board?.terrain || "").toLowerCase();

  fieldConditionsEl.querySelectorAll(".fc-btn").forEach(btn => {
    const type  = btn.dataset.fcType;
    const value = btn.dataset.fcValue;
    const active = (type === "weather" && weather === value) ||
                   (type === "terrain" && terrain === value);
    btn.classList.toggle("fc-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}

if (fieldConditionsEl) {
  fieldConditionsEl.addEventListener("click", async e => {
    const btn = e.target.closest(".fc-btn");
    if (!btn) return;
    const role = safeStr(appState.role);
    if (role === "spectator") return;

    const type  = btn.dataset.fcType;   // "weather" | "terrain"
    const value = btn.dataset.fcValue;

    // Toggle: if already active → clear, otherwise set
    const current = safeStr(
      type === "weather"
        ? (appState.battle?.weather || appState.board?.weather || "")
        : (appState.battle?.terrain || appState.board?.terrain || "")
    ).toLowerCase();
    const newValue = current === value ? null : value;

    const battleRef = getBattleDocRef();
    if (!battleRef) return;
    try {
      await setDoc(battleRef, { [type]: newValue }, { merge: true });
    } catch (err) {
      console.error("field-conditions write error:", err);
    }
  });
}
// ────────────────────────────────────────────────────────────────────────────

// -------------------------
// Side panels (DOM incremental)
// -------------------------
function dexNameFromPid(pid) {
  const k = safeStr(pid);
  if (!k) return "";
  if (k.startsWith("EXT:")) return safeStr(k.slice(4));
  if (dexMap && (dexMap[k] || dexMap[String(Number(k))])) return dexMap[k] || dexMap[String(Number(k))];
  return "";
}

function getSpriteUrlFromPid(pid, opts) {
  // opts: { type: "battle"|"art", shiny: bool }
  const type = opts?.type || "art";
  const shiny = !!opts?.shiny;
  const k = safeStr(pid);
  if (!k) return "";

  // 1) EXT:Nome (convenção do seu app)
  if (k.startsWith("EXT:")) {
    const nm = safeStr(k.slice(4));
    if (!nm) return "";
    const slug = spriteSlugFromPokemonName(nm);
    return localSpriteUrl(slug, type, shiny)
      || (type === "art"
          ? `https://img.pokemondb.net/artwork/large/${slug}.jpg`
          : `https://img.pokemondb.net/sprites/home/normal/${slug}.png`);
  }

  // 2) ✅ Regional Dex: id -> name -> slug -> sprite
  const nm = dexNameFromPid(k);
  if (nm) {
    const slug = spriteSlugFromPokemonName(nm);
    return localSpriteUrl(slug, type, shiny)
      || (type === "art"
          ? `https://img.pokemondb.net/artwork/large/${slug}.jpg`
          : `https://img.pokemondb.net/sprites/home/normal/${slug}.png`);
  }

  // 3) Se vier um nome/slug direto, tenta sprite por nome (ex.: "Muk-A")
  if (!/^\d+$/.test(k)) {
    const slug = spriteSlugFromPokemonName(k);
    return localSpriteUrl(slug, type, shiny)
      || `https://img.pokemondb.net/sprites/home/normal/${slug}.png`;
  }

  // 4) Fallback: trata como NatDex (último recurso)
  const n = Number(k);
  if (Number.isFinite(n) && n > 0 && n < 20000) {
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${n}.png`;
  }
  return "";
}

function pieceDisplayName(p) {
  const pid = p?.pid != null ? String(p.pid) : "?";
  const id = safeStr(p?.id) || "—";
  const owner = safeStr(p?.owner) || "—";
  return { pid, id, owner };
}

function slugifyPokemonNameLegacy(name) {
  return safeStr(name)
    .toLowerCase()
    .replaceAll("♀", "f")
    .replaceAll("♂", "m")
    .replace(/[’‘‛′'`\.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function canonicalizePokemonSlug(rawSlug) {
  const slug = safeStr(rawSlug).toLowerCase();
  const aliases = {
    "nidoranf": "nidoran-f",
    "nidoranm": "nidoran-m",
    "nidoran-female": "nidoran-f",
    "nidoran-male": "nidoran-m",
  };
  return aliases[slug] || slug;
}

function normalizeGenderMarkersForSlug(name) {
  return safeStr(name)
    .replace(/nidoran\s*(?:\u2640|\u00e2\u2122\u20ac)/ig, "nidoran-f")
    .replace(/nidoran\s*(?:\u2642|\u00e2\u2122\u201a)/ig, "nidoran-m")
    .replace(/(?:\u2640|\u00e2\u2122\u20ac)/g, "-f")
    .replace(/(?:\u2642|\u00e2\u2122\u201a)/g, "-m");
}

function slugifyPokemonName(name) {
  return canonicalizePokemonSlug(
    normalizeGenderMarkersForSlug(name)
      .toLowerCase()
      .replace(/['`\.]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
  );
}

function normalizePokemonFormName(name) {
  let n = safeStr(name);
  if (!n) return "";

  // Formatos tipo: "Muk (Alola)" / "Ponyta (Galar)"
  n = n.replace(/\s*\(\s*galar\s*\)\s*/ig, "-Galar");
  n = n.replace(/\s*\(\s*alola\s*\)\s*/ig, "-Alola");
  n = n.replace(/\s*\(\s*hisui\s*\)\s*/ig, "-Hisui");
  n = n.replace(/\s*\(\s*paldea\s*\)\s*/ig, "-Paldea");

  // Adjetivos tipo: "Alolan Muk" / "Galarian Ponyta"
  if (/\bgalarian\b/i.test(n)) n = n.replace(/\bgalarian\b/ig, "").trim() + "-Galar";
  if (/\balolan\b/i.test(n))   n = n.replace(/\balolan\b/ig, "").trim() + "-Alola";
  if (/\bhisuian\b/i.test(n))  n = n.replace(/\bhisuian\b/ig, "").trim() + "-Hisui";
  if (/\bpaldean\b/i.test(n))  n = n.replace(/\bpaldean\b/ig, "").trim() + "-Paldea";

  // Atalhos: Muk-A / A-Muk / Mr-Mime-A
  n = n.replace(/\b([a-zA-Z-]+)\s*-\s*a\b/g, "$1-Alola");
  n = n.replace(/\b([a-zA-Z-]+)\s*-\s*g\b/g, "$1-Galar");
  n = n.replace(/\b([a-zA-Z-]+)\s*-\s*h\b/g, "$1-Hisui");
  n = n.replace(/\b([a-zA-Z-]+)\s*-\s*p\b/g, "$1-Paldea");

  n = n.replace(/\ba\s*-\s*([a-zA-Z-]+)\b/g, "$1-Alola");
  n = n.replace(/\bg\s*-\s*([a-zA-Z-]+)\b/g, "$1-Galar");
  n = n.replace(/\bh\s*-\s*([a-zA-Z-]+)\b/g, "$1-Hisui");
  n = n.replace(/\bp\s*-\s*([a-zA-Z-]+)\b/g, "$1-Paldea");

  return n;
}

function resolvePokemonNameFromPid(pid) {
  const pidStr = safeStr(pid);
  if (!pidStr) return "";
  // Convenção do seu app: EXT:Nome
  if (pidStr.startsWith("EXT:")) return safeStr(pidStr.slice(4));
  // Mapeamento local (pokedex.json carregado pelo usuário)
  if (dexMap && Object.prototype.hasOwnProperty.call(dexMap, pidStr)) return safeStr(dexMap[pidStr]);
  return "";
}

function spriteSlugFromPokemonName(name) {
  let n = normalizePokemonFormName(name);
  if (!n) return "";

  // Gera o slug base usando a sua slugify
  let slug = slugifyPokemonName(n);
  if (!slug) return "";

  // Se já vier "muk-a" (ou similar), converte também
  if (slug.endsWith("-a")) slug = slug.slice(0, -2) + "-alola";
  if (slug.endsWith("-g")) slug = slug.slice(0, -2) + "-galar";
  if (slug.endsWith("-h")) slug = slug.slice(0, -2) + "-hisui";
  if (slug.endsWith("-p")) slug = slug.slice(0, -2) + "-paldea";

  if (slug.startsWith("a-")) slug = slug.slice(2) + "-alola";
  if (slug.startsWith("g-")) slug = slug.slice(2) + "-galar";
  if (slug.startsWith("h-")) slug = slug.slice(2) + "-hisui";
  if (slug.startsWith("p-")) slug = slug.slice(2) + "-paldea";

  // Exceções (default forms)
  const EX = {
    "mimikyu": "mimikyu-disguised",
    "aegislash": "aegislash-blade",
    "giratina": "giratina-origin",
    "wishiwashi": "wishiwashi-solo",
    "pumpkaboo": "pumpkaboo-average",
    "gourgeist": "gourgeist-average",
    "lycanroc": "lycanroc-midday",
    "deoxys": "deoxys-normal",
    "wormadam": "wormadam-plant",
    "shaymin": "shaymin-land",
    "toxtricity": "toxtricity-amped",
    "eiscue": "eiscue-ice",
    "indeedee": "indeedee-male",
    "morpeko": "morpeko-full-belly",
    "urshifu": "urshifu-single-strike",
    "basculegion": "basculegion-male",
    "enamorus": "enamorus-incarnate",
    "keldeo": "keldeo-ordinary",
    "meloetta": "meloetta-aria",
    "darmanitan": "darmanitan-standard",
    "minior": "minior-red-meteor",
  };
  if (EX[slug]) slug = EX[slug];

  // Correções de nomes invertidos
  if (["eternal-floette", "floette-eternal-forme", "floette-eternal-form"].includes(slug)) {
    slug = "floette-eternal";
  }
  if (["bloodmoon-ursaluna", "blood-moon-ursaluna", "ursaluna-blood-moon"].includes(slug)) {
    slug = "ursaluna-bloodmoon";
  }

  return canonicalizePokemonSlug(slug);
}

function spriteUrlFromPokemonName(name) {
  const slug = spriteSlugFromPokemonName(name);
  if (!slug) return "";
  return spriteUrlWithFallback(slug, "art", false);
}

// ── Local sprite repo ─────────────────────────────────────────────
// Base paths relative to the site root for static artwork and field GIFs.
const LOCAL_POKEMON_ART_BASE = "poke/home";
const LOCAL_POKEMON_SHINY_ART_BASE = "poke/home-shiny";
const LOCAL_BATTLE_GIF_BASE = "sprites";

function _normalizeLocalArtBasename(value) {
  return canonicalizePokemonSlug(
    safeStr(value)
      .toLowerCase()
      .replace(/\.png$/i, "")
  );
}

function _appendUniqueSpriteSlugCandidate(out, seen, value) {
  const normalized = _normalizePokemonFormSlug(value);
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  out.push(normalized);
}

function _appendUniqueArtBasenameCandidate(out, seen, value) {
  const normalized = _normalizeLocalArtBasename(value);
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  out.push(normalized);
}

function _normalizePokemonSex(value) {
  const normalized = safeStr(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!normalized) return "";
  if (["f", "female", "femea"].includes(normalized)) return "female";
  if (["m", "male", "macho"].includes(normalized)) return "male";
  return "";
}

function _inferPokemonSexFromSlug(slug) {
  const normalized = _normalizePokemonFormSlug(slug);
  if (!normalized) return "";
  if (/-female(?:-|$)/i.test(normalized) || /-f$/i.test(normalized)) return "female";
  if (/-male(?:-|$)/i.test(normalized) || /-m$/i.test(normalized)) return "male";
  return "";
}

function _buildRemoteArtSlugCandidates(slug, options = {}) {
  const normalizedSlug = _normalizePokemonFormSlug(slug);
  if (!normalizedSlug) return [];
  const sex = _normalizePokemonSex(options?.sex) || _inferPokemonSexFromSlug(normalizedSlug);
  const rootSlug = _inferCanonicalFormRoot(normalizedSlug) || normalizedSlug;
  const defaultSlug = rootSlug ? _defaultFormSlugForRoot(rootSlug) : "";
  const out = [];
  const seen = new Set();
  const maybeFemaleSlug = rootSlug ? `${rootSlug}-female` : "";
  const maybeMaleSlug = rootSlug ? `${rootSlug}-male` : "";

  if (sex === "female") _appendUniqueSpriteSlugCandidate(out, seen, maybeFemaleSlug);
  _appendUniqueSpriteSlugCandidate(out, seen, normalizedSlug);
  if (sex === "male") _appendUniqueSpriteSlugCandidate(out, seen, maybeMaleSlug);
  _appendUniqueSpriteSlugCandidate(out, seen, rootSlug);
  _appendUniqueSpriteSlugCandidate(out, seen, defaultSlug);
  return out;
}

function _getRemoteArtSlugForSprite(slug, options = {}) {
  const candidates = _buildRemoteArtSlugCandidates(slug, options);
  return candidates[0] || "";
}

function _buildLocalArtBasenameCandidates(slug, options = {}) {
  const normalizedSlug = _normalizePokemonFormSlug(slug);
  if (!normalizedSlug) return [];
  const sex = _normalizePokemonSex(options?.sex) || _inferPokemonSexFromSlug(normalizedSlug);
  const rootSlug = _inferCanonicalFormRoot(normalizedSlug) || normalizedSlug;
  const defaultSlug = rootSlug ? _defaultFormSlugForRoot(rootSlug) : "";
  const out = [];
  const seen = new Set();

  const pushBasename = (value) => _appendUniqueArtBasenameCandidate(out, seen, value);
  const pushSlug = (value) => _appendUniqueArtBasenameCandidate(out, seen, value);

  pushSlug(normalizedSlug);
  if (sex === "female" && rootSlug) {
    pushBasename(`${rootSlug}-f`);
    pushSlug(`${rootSlug}-female`);
  }
  if (sex === "male" && rootSlug) {
    pushBasename(`${rootSlug}-m`);
    pushSlug(`${rootSlug}-male`);
  }
  if (/-female(?:-|$)/i.test(normalizedSlug)) pushBasename(normalizedSlug.replace(/-female(?=-|$)/i, "-f"));
  if (/-male(?:-|$)/i.test(normalizedSlug)) {
    pushBasename(normalizedSlug.replace(/-male(?=-|$)/i, ""));
    pushBasename(normalizedSlug.replace(/-male(?=-|$)/i, "-m"));
  }
  pushSlug(rootSlug);
  pushSlug(defaultSlug);
  return out;
}

function _getLocalArtManifestForVariant(shiny) {
  return shiny
    ? { map: _pokemonFormManifestShinyArtMap, basenameSet: _pokemonFormManifestShinyArtBasenameSet, basePath: LOCAL_POKEMON_SHINY_ART_BASE }
    : { map: _pokemonFormManifestArtMap, basenameSet: _pokemonFormManifestArtBasenameSet, basePath: LOCAL_POKEMON_ART_BASE };
}

function _resolveLocalArtBasename(slug, shiny, options = {}) {
  const normalizedSlug = _normalizePokemonFormSlug(slug);
  if (!normalizedSlug) return "";
  const manifest = _getLocalArtManifestForVariant(shiny);
  const candidateSlugs = _buildRemoteArtSlugCandidates(normalizedSlug, options);
  for (const candidateSlug of candidateSlugs) {
    const mapped = _normalizeLocalArtBasename(manifest.map.get(candidateSlug));
    if (mapped) return mapped;
  }
  for (const basename of _buildLocalArtBasenameCandidates(normalizedSlug, options)) {
    if (manifest.basenameSet.has(basename)) return basename;
  }
  return "";
}

function localArtSpriteUrl(slug, shiny, options = {}) {
  const basename = _resolveLocalArtBasename(slug, shiny, options);
  if (!basename) return "";
  const manifest = _getLocalArtManifestForVariant(shiny);
  return `${manifest.basePath}/${basename}.png`;
}

function _normalizeBattleGifBasename(value) {
  return canonicalizePokemonSlug(
    safeStr(value)
      .toLowerCase()
      .replace(/\.gif$/i, "")
  );
}

function _getBattleGifBasenameForSlug(slug) {
  const rawSlug = canonicalizePokemonSlug(safeStr(slug).toLowerCase());
  const normalizedSlug = _normalizePokemonFormSlug(slug) || rawSlug;
  const rootSlug = rawSlug ? _inferCanonicalFormRoot(rawSlug) : "";
  const defaultSlug = rootSlug ? _defaultFormSlugForRoot(rootSlug) : "";
  const candidates = [normalizedSlug, rawSlug, defaultSlug];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const mapped = safeStr(_pokemonFormManifestGifMap.get(candidate));
    if (mapped) return _normalizeBattleGifBasename(mapped);
  }
  return _normalizeBattleGifBasename(defaultSlug || normalizedSlug || rawSlug);
}

function localBattleSpriteUrl(slug, shiny) {
  const basename = _getBattleGifBasenameForSlug(slug);
  if (!basename) return "";
  // Local GIFs do not have shiny variants; reuse the base animation when available.
  return `${LOCAL_BATTLE_GIF_BASE}/${basename}.gif`;
}

function localSpriteUrl(slug, type, shiny, options = {}) {
  if (!slug) return "";
  return type === "battle"
    ? localBattleSpriteUrl(slug, shiny)
    : localArtSpriteUrl(slug, shiny, options);
}

/**
 * Full sprite URL with local-first, remote fallback.
 * For non-battle contexts (art): local official_artwork → pokemondb → pokeapi
 * For battle context: local showdown gif → pokemondb → pokeapi
 */
function spriteUrlWithFallback(slug, type, shiny, options = {}) {
  if (!slug) return "";
  const normalizedSlug = _normalizePokemonFormSlug(slug);
  const remoteArtSlug = _getRemoteArtSlugForSprite(normalizedSlug, options) || normalizedSlug;
  return localSpriteUrl(normalizedSlug, type, shiny, options)
    || (type === "art"
        ? `https://img.pokemondb.net/artwork/large/${remoteArtSlug}.jpg`
        : `https://img.pokemondb.net/sprites/home/normal/${normalizedSlug}.png`);
}




function getSpriteUrlForPiece(p, opts) {
  // opts: { type: "battle"|"art", shiny: bool }
  const type = opts?.type || "battle";
  const shiny = !!(opts?.shiny ?? p?.shiny);
  const kind = safeStr(p?.kind);
  const pidStr = safeStr(p?.pid);

  if (kind === "trainer" || pidStr.startsWith("trainer_")) {
    return getTrainerSpriteSources(p).primary || "";
  }

  const owner = safeStr(p?.owner);
  const effectiveCtx = owner ? _getEffectivePokemonContext(owner, p) : null;
  const effectiveSlug = _normalizePokemonFormSlug(effectiveCtx?.formSlug || (owner ? _getEffectivePokemonSlug(owner, p) : ""));
  if (effectiveSlug) {
    return localSpriteUrl(effectiveSlug, type, shiny, { sex: effectiveCtx?.sex })
      || (type === "art" ? safeStr(effectiveCtx?.image) : "")
      || spriteUrlWithFallback(effectiveSlug, type, shiny, { sex: effectiveCtx?.sex });
  }

  // 1) Prefer explicit spriteUrl if present (only for remote URLs)
  const direct = safeStr(p?.spriteUrl || p?.sprite_url || "");
  if (direct && (direct.startsWith("http://") || direct.startsWith("https://"))) return direct;

  // 2) Try resolve by name via Dex mapping, with form variant support
  let name = resolvePokemonNameFromPid(p?.pid);
  const form = safeStr(p?.form);
  if (name) {
    // Se a peça possui um campo "form", concatena ao nome (ex: "Rotom" + "Wash" -> "Rotom-Wash")
    if (form && !name.toLowerCase().includes(form.toLowerCase())) {
      name = name + "-" + form;
    }
    const slug = spriteSlugFromPokemonName(name);
    return localSpriteUrl(slug, type, shiny)
      || (type === "art"
          ? `https://img.pokemondb.net/artwork/large/${slug}.jpg`
          : `https://img.pokemondb.net/sprites/home/normal/${slug}.png`);
  }

  // 3) Fallback: treat pid as NatDex number
  const pidRaw = Number(p?.pid);
  if (Number.isFinite(pidRaw) && pidRaw > 0 && pidRaw < 20000) {
    // Se tiver form, tenta buscar via slug do PokeAPI (ex: rotom-wash)
    if (form) {
      const baseName = dexNameFromPid(p?.pid) || "";
      if (baseName) {
        const slug = spriteSlugFromPokemonName(baseName + "-" + form);
        return localSpriteUrl(slug, type, shiny)
          || `https://img.pokemondb.net/sprites/home/normal/${slug}.png`;
      }
    }
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pidRaw}.png`;
  }
  return "";
}

const FORM_ROOT_DEFAULT_SLUGS = {
  aegislash: "aegislash-blade",
  arceus: "arceus-normal",
  basculin: "basculin-red-striped",
  basculegion: "basculegion-male",
  darmanitan: "darmanitan-standard",
  deoxys: "deoxys-normal",
  eiscue: "eiscue-ice",
  enamorus: "enamorus-incarnate",
  giratina: "giratina-altered",
  gourgeist: "gourgeist-average",
  indeedee: "indeedee-male",
  keldeo: "keldeo-ordinary",
  landorus: "landorus-incarnate",
  lycanroc: "lycanroc-midday",
  maushold: "maushold-family-of-four",
  meloetta: "meloetta-aria",
  meowstic: "meowstic-male",
  mimikyu: "mimikyu-disguised",
  minior: "minior-red-meteor",
  morpeko: "morpeko-full-belly",
  oricorio: "oricorio-baile",
  palafin: "palafin-zero",
  pumpkaboo: "pumpkaboo-average",
  sawsbuck: "sawsbuck-spring",
  shaymin: "shaymin-land",
  silvally: "silvally-normal",
  squawkabilly: "squawkabilly-green-plumage",
  tatsugiri: "tatsugiri-curly",
  thundurus: "thundurus-incarnate",
  tornadus: "tornadus-incarnate",
  toxtricity: "toxtricity-amped",
  urshifu: "urshifu-single-strike",
  wishiwashi: "wishiwashi-solo",
  wormadam: "wormadam-plant",
  zygarde: "zygarde-50",
};
const FORM_SPECIAL_ROOTS = Object.keys(FORM_ROOT_DEFAULT_SLUGS).sort((a, b) => b.length - a.length);

function _normalizePartySlot(slotLike, fallbackIndex = null) {
  const raw = safeStr(slotLike).trim();
  if (raw) {
    const prefixed = raw.match(/^slot[_-]?(\d+)$/i);
    if (prefixed) return `slot_${Number(prefixed[1])}`;
    if (/^\d+$/.test(raw)) return `slot_${Number(raw)}`;
  }
  if (fallbackIndex != null && Number.isFinite(Number(fallbackIndex)) && Number(fallbackIndex) >= 0) {
    return `slot_${Number(fallbackIndex)}`;
  }
  return "";
}

function _looksLikePartySlotKey(slotLike) {
  return /^slot[_-]?\d+$/i.test(safeStr(slotLike).trim());
}

function _getPartySlot(entryLike, fallbackIndex = null) {
  if (entryLike && typeof entryLike === "object") {
    return _normalizePartySlot(
      entryLike.party_slot
      ?? entryLike.partySlot
      ?? entryLike.slot_key
      ?? entryLike.slotKey
      ?? entryLike.slot
      ?? entryLike.index
      ?? entryLike._party_slot,
      fallbackIndex
    );
  }
  if (_looksLikePartySlotKey(entryLike)) return _normalizePartySlot(entryLike, fallbackIndex);
  return _normalizePartySlot("", fallbackIndex);
}

function _getPartySlotIndex(entryLike, fallbackIndex = -1) {
  const slot = _getPartySlot(entryLike, fallbackIndex);
  const match = slot.match(/^slot_(\d+)$/i);
  return match ? Number(match[1]) : -1;
}

function _getEntryId(entryLike) {
  if (!entryLike || typeof entryLike !== "object") return "";
  return safeStr(
    entryLike.entry_id
    ?? entryLike.entryId
    ?? entryLike.hub_entry_id
    ?? entryLike.hubEntryId
    ?? entryLike._entry_id
  );
}

function _defaultFormSlugForRoot(rootSlug) {
  const root = canonicalizePokemonSlug(safeStr(rootSlug).toLowerCase());
  if (!root) return "";
  if (_pokemonFormManifestArtMap.has(root) || _pokemonFormManifestArtBasenameSet.has(root)) return root;
  return FORM_ROOT_DEFAULT_SLUGS[root] || root;
}

function _normalizePokemonFormSlug(value) {
  const raw = safeStr(value);
  if (!raw) return "";
  const slug = raw.includes(" ")
    ? safeStr(spriteSlugFromPokemonName(raw))
    : raw.toLowerCase();
  return _normalizePokeApiSlug(slug || raw);
}

function _humanizePokemonFormSlug(slug) {
  const normalized = safeStr(slug).replace(/[_/]+/g, "-");
  if (!normalized) return "";
  const key = safeStr(window.dexSlugToId?.[normalized]);
  const mapped = key ? safeStr(dexNameFromPid(key)) : "";
  if (mapped) return mapped;
  return toTitleWords(normalized.replace(/-/g, " "));
}

function _manifestFormFamilyCount(candidate) {
  const root = canonicalizePokemonSlug(safeStr(candidate).toLowerCase());
  if (!root) return 0;
  let count = 0;
  for (const slug of _pokemonFormManifestList) {
    if (slug === root || slug.startsWith(`${root}-`)) count += 1;
  }
  return count;
}

function _inferCanonicalFormRoot(formSlug) {
  const slug = canonicalizePokemonSlug(safeStr(formSlug).toLowerCase());
  if (!slug) return "";

  for (const root of FORM_SPECIAL_ROOTS) {
    if (slug === root || slug.startsWith(`${root}-`)) return root;
  }

  if (_pokemonFormManifestSet.has(slug) && !slug.includes("-")) return slug;

  const parts = slug.split("-").filter(Boolean);
  for (let i = parts.length - 1; i > 0; i -= 1) {
    const candidate = parts.slice(0, i).join("-");
    if (_pokemonFormManifestSet.has(candidate)) return candidate;
  }

  for (let i = 1; i < parts.length; i += 1) {
    const candidate = parts.slice(0, i).join("-");
    if (_manifestFormFamilyCount(candidate) > 1) return candidate;
  }

  return slug;
}

function _sortPokemonFormSlugs(slugs, rootSlug) {
  const root = canonicalizePokemonSlug(safeStr(rootSlug).toLowerCase());
  const preferred = _defaultFormSlugForRoot(root);
  const unique = Array.from(new Set((Array.isArray(slugs) ? slugs : []).filter(Boolean)));
  unique.sort((a, b) => {
    if (a === preferred && b !== preferred) return -1;
    if (b === preferred && a !== preferred) return 1;
    if (a === root && b !== root) return -1;
    if (b === root && a !== root) return 1;
    return _humanizePokemonFormSlug(a).localeCompare(_humanizePokemonFormSlug(b));
  });
  return unique;
}

function _rebuildPokemonFormManifestIndexes() {
  const manifestList = Array.isArray(_pokemonFormManifestRaw?.available_slugs)
    ? _pokemonFormManifestRaw.available_slugs
    : [];
  const artMapEntries = (_pokemonFormManifestRaw?.art_map && typeof _pokemonFormManifestRaw.art_map === "object" && !Array.isArray(_pokemonFormManifestRaw.art_map))
    ? Object.entries(_pokemonFormManifestRaw.art_map)
    : [];
  const shinyArtMapEntries = (_pokemonFormManifestRaw?.shiny_art_map && typeof _pokemonFormManifestRaw.shiny_art_map === "object" && !Array.isArray(_pokemonFormManifestRaw.shiny_art_map))
    ? Object.entries(_pokemonFormManifestRaw.shiny_art_map)
    : [];
  const gifMapEntries = (_pokemonFormManifestRaw?.gif_map && typeof _pokemonFormManifestRaw.gif_map === "object" && !Array.isArray(_pokemonFormManifestRaw.gif_map))
    ? Object.entries(_pokemonFormManifestRaw.gif_map)
    : [];
  _pokemonFormManifestList = Array.from(new Set(
    manifestList
      .concat(artMapEntries.map(([slug]) => slug))
      .concat(shinyArtMapEntries.map(([slug]) => slug))
      .concat(gifMapEntries.map(([slug]) => slug))
      .map((slug) => canonicalizePokemonSlug(safeStr(slug).toLowerCase()))
      .filter(Boolean)
  ));
  _pokemonFormManifestSet = new Set(_pokemonFormManifestList);
  _pokemonFormManifestGroups = new Map();
  _pokemonFormManifestArtMap = new Map();
  _pokemonFormManifestShinyArtMap = new Map();
  _pokemonFormManifestGifMap = new Map();
  _pokemonFormManifestArtBasenameSet = new Set();
  _pokemonFormManifestShinyArtBasenameSet = new Set();

  for (const [slug, basename] of artMapEntries) {
    const normalizedSlug = canonicalizePokemonSlug(safeStr(slug).toLowerCase());
    const normalizedBasename = _normalizeLocalArtBasename(basename);
    if (!normalizedSlug || !normalizedBasename) continue;
    _pokemonFormManifestArtMap.set(normalizedSlug, normalizedBasename);
    _pokemonFormManifestArtBasenameSet.add(normalizedBasename);
  }

  for (const [slug, basename] of shinyArtMapEntries) {
    const normalizedSlug = canonicalizePokemonSlug(safeStr(slug).toLowerCase());
    const normalizedBasename = _normalizeLocalArtBasename(basename);
    if (!normalizedSlug || !normalizedBasename) continue;
    _pokemonFormManifestShinyArtMap.set(normalizedSlug, normalizedBasename);
    _pokemonFormManifestShinyArtBasenameSet.add(normalizedBasename);
  }

  for (const [slug, basename] of gifMapEntries) {
    const normalizedSlug = canonicalizePokemonSlug(safeStr(slug).toLowerCase());
    const normalizedBasename = _normalizeBattleGifBasename(basename);
    if (!normalizedSlug || !normalizedBasename) continue;
    _pokemonFormManifestGifMap.set(normalizedSlug, normalizedBasename);
  }

  for (const slug of _pokemonFormManifestList) {
    const root = _inferCanonicalFormRoot(slug);
    if (!root) continue;
    if (!_pokemonFormManifestGroups.has(root)) _pokemonFormManifestGroups.set(root, []);
    _pokemonFormManifestGroups.get(root).push(slug);
  }

  for (const [root, list] of _pokemonFormManifestGroups.entries()) {
    _pokemonFormManifestGroups.set(root, _sortPokemonFormSlugs(list, root));
  }
}

function _setPokemonFormManifest(payload) {
  const next = (payload && typeof payload === "object" && !Array.isArray(payload))
    ? payload
    : { available_slugs: [], art_map: {}, shiny_art_map: {}, gif_map: {} };
  _pokemonFormManifestRaw = next;
  _rebuildPokemonFormManifestIndexes();
  window.pokemonFormManifest = {
    raw: _pokemonFormManifestRaw,
    available_slugs: _pokemonFormManifestList.slice(),
    groups: Object.fromEntries(Array.from(_pokemonFormManifestGroups.entries())),
    art_map: Object.fromEntries(Array.from(_pokemonFormManifestArtMap.entries()).sort(([a], [b]) => a.localeCompare(b))),
    shiny_art_map: Object.fromEntries(Array.from(_pokemonFormManifestShinyArtMap.entries()).sort(([a], [b]) => a.localeCompare(b))),
    gif_map: Object.fromEntries(Array.from(_pokemonFormManifestGifMap.entries()).sort(([a], [b]) => a.localeCompare(b))),
  };
  try { updateSidePanels(); } catch {}
  try { renderSheetsTab(); } catch {}
  try { window.requestScoreboardRefresh?.(); } catch {}
  try { requestArenaRefresh(true); } catch {}
}

function _shouldHideGenericFormSlug(slug, options = {}) {
  const normalizedSlug = _normalizePokemonFormSlug(slug);
  if (!normalizedSlug) return true;
  if (/-mega(?:-|$)/i.test(normalizedSlug)) return true;
  if (!options?.allowGmax && /-gmax(?:-|$)/i.test(normalizedSlug)) return true;
  return false;
}

function _getPokemonFormOptionsForRoot(rootSlug, options = {}) {
  const root = canonicalizePokemonSlug(safeStr(rootSlug).toLowerCase());
  const slugs = _pokemonFormManifestGroups.get(root) || [];
  return slugs
    .filter((slug) => !_shouldHideGenericFormSlug(slug, options))
    .map((slug) => ({
      form_slug: slug,
      root_slug: root,
      display_name: _humanizePokemonFormSlug(slug),
      image: spriteUrlWithFallback(slug, "art", false),
    }));
}

function _inferPokemonSpeciesSlug(trainerName, pidLike, options = {}) {
  const owner = safeStr(trainerName);
  const piece = options?.piece || null;
  const sheet = options?.sheet || null;
  const rawPid = safeStr(pidLike?.pid ?? pidLike?.pokemon?.id ?? pidLike);
  const fromDex = dexNameFromPid(rawPid) || resolvePokemonNameFromPid(rawPid);
  const normalizedDex = _normalizePokemonFormSlug(fromDex);
  if (normalizedDex) return _inferCanonicalFormRoot(normalizedDex);

  const fromBaseSheet = _normalizePokemonFormSlug(
    sheet?.base_pokemon_name
    || sheet?.basePokemonName
    || sheet?.base_pokemon_id
    || sheet?.pokemon?.id
  );
  if (fromBaseSheet) return _inferCanonicalFormRoot(fromBaseSheet);

  const inferredForm = _inferBasePokemonFormSlug(owner, piece || pidLike, { piece, sheet, source: options?.source });
  if (inferredForm) return _inferCanonicalFormRoot(inferredForm);

  return _inferCanonicalFormRoot(_normalizePokemonFormSlug(rawPid));
}

function _folderFormSuffixLabel(speciesSlug, formSlug) {
  const species = canonicalizePokemonSlug(safeStr(speciesSlug).toLowerCase());
  const form = canonicalizePokemonSlug(safeStr(formSlug).toLowerCase());
  if (!species || !form) return "";
  const defaultForm = _defaultFormSlugForRoot(species);
  if (form === species || form === defaultForm) return "Normal";
  const prefix = `${species}-`;
  if (form.startsWith(prefix)) return toTitleWords(form.slice(prefix.length).replace(/-/g, " "));
  return _humanizePokemonFormSlug(form);
}

function _getPokemonFolderOptionsForSpecies(speciesSlug, options = {}) {
  const species = canonicalizePokemonSlug(safeStr(speciesSlug).toLowerCase());
  if (!species) return [];
  const matches = _pokemonFormManifestList.filter((slug) => slug === species || slug.startsWith(`${species}-`));
  return matches
    .filter((slug) => !_shouldHideGenericFormSlug(slug, options))
    .map((slug) => ({
      form_slug: slug,
      root_slug: species,
      display_name: _folderFormSuffixLabel(species, slug),
      image: spriteUrlWithFallback(slug, "art", false),
    }));
}

function normalizePartyPid(x) {
  // aceita: "887", 887, {pid}, {pokemon:{id}}, "Weavile", "Muk-A", "EXT:Hydreigon", "PID 887"
  let v = safeStr(x?.pid ?? x?.id ?? x?.pokemon?.id ?? x?.pokemon ?? x);
  if (!v) return "";
  v = v.trim();

  // remove prefixos comuns
  v = v.replace(/^pid\s*[:#-]?\s*/i, "").trim();

  // EXT:Nome
  if (/^ext\s*:/i.test(v)) {
    const nm = v.split(":").slice(1).join(":").trim();
    return nm ? `EXT:${nm}` : "";
  }

  // número (já é o ID regional do seu app)
  if (/^\d+$/.test(v)) return String(Number(v));

  // normaliza atalhos/formas (ex.: Muk-A -> Muk-Alola)
  v = normalizePokemonFormName(v);

  // tenta mapear nome/slug -> id regional
  const slug = slugifyPokemonName(v);
  const slugMap = window.dexSlugToId;
  if (slug && slugMap && slugMap[slug]) return String(Number(slugMap[slug]));

  // fallback: mantém como está (a UI ainda consegue mostrar sprite por nome)
  return v;
}

function _normalizePartyEntry(entryLike, index = 0) {
  const pid = normalizePartyPid(entryLike?.pid ?? entryLike?.pokemon?.id ?? entryLike?.pokemon ?? entryLike);
  if (!pid) return null;
  const hasStructuredSlot = entryLike && typeof entryLike === "object" && !Array.isArray(entryLike);
  const partySlot = hasStructuredSlot ? _getPartySlot(entryLike, index) : _normalizePartySlot("", index);
  const entryId = _getEntryId(entryLike);
  if (hasStructuredSlot) {
    return Object.assign({}, entryLike, {
      pid,
      entry_id: entryId,
      party_slot: partySlot,
      _party_slot: partySlot,
      _party_slot_index: _getPartySlotIndex(partySlot, index),
    });
  }
  return { pid, entry_id: entryId, party_slot: partySlot, _party_slot: partySlot, _party_slot_index: _getPartySlotIndex(partySlot, index) };
}

function _normalizePartyList(list) {
  return (Array.isArray(list) ? list : []).map((entry, index) => _normalizePartyEntry(entry, index)).filter((entry) => entry?.pid);
}

function getPartyForTrainer(trainerName) {
  const tn = safeStr(trainerName);
  if (!tn) return [];

  // 0) Se este é o usuário logado via planilha, usa o dado direto do login
  if (safeStr(appState.by) && tn === safeStr(appState.by) && appState.selfUserData) {
    const partyRaw = Array.isArray(appState.selfUserData?.party) ? appState.selfUserData.party : [];
    if (partyRaw.length) {
      // se já montou snapshot com fichas, melhor
      if (Array.isArray(appState.selfPartySnapshot) && appState.selfPartySnapshot.length) return appState.selfPartySnapshot;
      return _normalizePartyList(partyRaw);
    }
  }
    // 0.5) ✅ public_state/players (arrays de pid por treinador)
  const ps = appState.publicPlayers;
  if (ps) {
    // tenta por nome exato e por variações (por causa de maiúsculas/minúsculas)
    const direct =
      ps[tn] ||
      ps[safeStr(tn)] ||
      ps[safeStr(tn).trim()] ||
      ps[safeStr(tn).toLowerCase()] ||
      ps[safeDocId(tn)];

    if (Array.isArray(direct) && direct.length) return _normalizePartyList(direct);

    // byId: Cloud Functions gravam com safeId (lowercase+sem-acento); Ga'Al Dex com safe_doc_id (case).
    // Tentamos múltiplas variações de chave para cobrir ambos os casos.
    const byId = ps.byId || {};
    const tnLower = safeStr(tn).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const entry = byId[safeDocId(tn)] || byId[tn] || byId[tnLower] || byId[safeStr(tn).toLowerCase()];
    const party2 = (Array.isArray(entry?.party_snapshot) && entry.party_snapshot.length)
      ? entry.party_snapshot
      : (Array.isArray(entry?.party) ? entry.party : []);
    if (party2.length) {
      return _normalizePartyList(party2);
    }
  }

  // 1) party_snapshot vindo da sala
  const snapParty = _getPartySnapshotForTrainer(tn);

  // 2) users_raw/users (espelhado pelo Streamlit ou por outro processo)
  const player = (appState.players || []).find(x => safeStr(x?.trainer_name) === tn);
  const uidCandidates = [
    safeStr(player?.uid),
    safeStr(player?.id),
    safeDocId(tn),
  ].filter(Boolean);
  let rawParty = [];
  for (const uid of uidCandidates) {
    const entry = appState.userProfiles?.get?.(uid);
    const raw = entry?.raw;
    const data = raw?.data || raw;
    const party = Array.isArray(data?.party) ? data.party : [];
    if (party.length) {
      rawParty = party;
      break;
    }
  }

  // ✅ se users_raw tem party, ela manda (fonte de verdade)
  if (rawParty.length) {
    return _normalizePartyList(rawParty);
  }

  // fallback: usa party_snapshot (caso users_raw não tenha)
  if (snapParty.length) return snapParty;

  return [];
}

const _heldItemEffectCache = new Map(); // api_name -> text | Promise<string>
let _heldItemRefreshQueued = false;

function _queueHeldItemUiRefresh() {
  if (_heldItemRefreshQueued) return;
  _heldItemRefreshQueued = true;
  setTimeout(() => {
    _heldItemRefreshQueued = false;
    try { updateSidePanels(); } catch {}
    try { renderSheetsTab(); } catch {}
    try { window.requestScoreboardRefresh?.(); } catch {}
  }, 0);
}

function _trainerLookupKey(name) {
  return safeStr(name)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function _pushPartyLookupValue(out, value) {
  const raw = safeStr(value);
  const formName = normalizePokemonFormName(raw);
  const slug = raw && !/^EXT:/i.test(raw) ? slugifyPokemonName(formName || raw) : "";
  const candidates = [raw, safePidValue(raw), normalizePartyPid(raw), formName, slug];
  for (const candidate of candidates) {
    if (candidate && !out.includes(candidate)) out.push(candidate);
  }
}

function _pushPartyLookupKey(out, value) {
  const candidates = [];
  _pushPartyLookupValue(candidates, value);
  for (const candidate of candidates) {
    const key = pidKey(candidate);
    if (key && !out.includes(key)) out.push(key);
  }
}

function _partyEntryLookupValues(entryLike) {
  const out = [];
  if (entryLike && typeof entryLike === "object") {
    _pushPartyLookupValue(out, entryLike?.pid);
    _pushPartyLookupValue(out, entryLike?.pokemon?.id);
    _pushPartyLookupValue(out, entryLike?.pokemon?.name);
    _pushPartyLookupValue(out, entryLike?.name);
    return out;
  }
  _pushPartyLookupValue(out, entryLike);
  return out;
}

function _partyEntryLookupKeys(entryLike) {
  const out = [];
  if (entryLike && typeof entryLike === "object") {
    _pushPartyLookupKey(out, _getEntryId(entryLike));
    _pushPartyLookupKey(out, _getPartySlot(entryLike));
    _pushPartyLookupKey(out, entryLike?.pid);
    _pushPartyLookupKey(out, entryLike?.pokemon?.id);
    _pushPartyLookupKey(out, entryLike?.pokemon?.name);
    _pushPartyLookupKey(out, entryLike?.name);
    return out;
  }
  _pushPartyLookupKey(out, entryLike);
  return out;
}

function _samePartySlot(a, b) {
  const left = _getPartySlot(a);
  const right = _getPartySlot(b);
  return !!left && !!right && left === right;
}

function _matchesPartyIdentity(candidateLike, targetLike) {
  const targetEntryId = _getEntryId(targetLike);
  const candidateEntryId = _getEntryId(candidateLike);
  if (targetEntryId && candidateEntryId) return targetEntryId === candidateEntryId;
  const targetSlot = _getPartySlot(targetLike);
  if (targetSlot) return _getPartySlot(candidateLike) === targetSlot;
  const targetKeys = _partyEntryLookupKeys(targetLike);
  if (!targetKeys.length) return false;
  const candidateKeys = _partyEntryLookupKeys(candidateLike);
  return candidateKeys.some((key) => targetKeys.includes(key));
}

function _pieceMatchesPid(pieceLike, pidLike) {
  return _matchesPartyIdentity(pieceLike, pidLike);
}

function findBoardPieceForTrainer(ownerName, pidLike, options = {}) {
  const ownerKey = _trainerLookupKey(ownerName);
  const pieces = Array.isArray(options.pieces) ? options.pieces : (appState.pieces || []);
  if (!ownerKey || !Array.isArray(pieces) || !pieces.length) return null;
  return pieces.find((piece) => {
    if (_trainerLookupKey(piece?.owner) !== ownerKey) return false;
    if (!options.includeInactive && safeStr(piece?.status || "active") !== "active") return false;
    if (_getPartySlot(pidLike) && !_getPartySlot(piece)) return false;
    return _matchesPartyIdentity(piece, pidLike);
  }) || null;
}

function _activeOwnerPieces(ownerName, options = {}) {
  const ownerKey = _trainerLookupKey(ownerName);
  const pieces = Array.isArray(options.pieces) ? options.pieces : (appState.pieces || []);
  if (!ownerKey || !Array.isArray(pieces) || !pieces.length) return [];
  return pieces.filter((piece) => {
    if (_trainerLookupKey(piece?.owner) !== ownerKey) return false;
    if (!options.includeInactive && safeStr(piece?.status || "active") !== "active") return false;
    return true;
  });
}

function _getPartySnapshotForTrainer(trainerName) {
  const targetKey = _trainerLookupKey(trainerName);
  if (!targetKey) return [];
  for (const player of (appState.players || [])) {
    if (_trainerLookupKey(player?.trainer_name) !== targetKey) continue;
    const snapshot = Array.isArray(player?.party_snapshot) ? player.party_snapshot : [];
    if (snapshot.length) return _normalizePartyList(snapshot);
  }
  const publicEntry = getPublicPlayerEntryByTrainer(trainerName);
  const publicSnapshot = Array.isArray(publicEntry?.party_snapshot) ? publicEntry.party_snapshot : [];
  if (publicSnapshot.length) return _normalizePartyList(publicSnapshot);
  return [];
}

function getPartySnapshotEntryForTrainerPid(trainerName, pidLike) {
  const snapshot = _getPartySnapshotForTrainer(trainerName);
  for (const entry of snapshot) {
    if (_matchesPartyIdentity(entry, pidLike)) return entry;
  }
  return null;
}

function _getPartyEntryForTrainerPid(trainerName, pidLike) {
  const party = getPartyForTrainer(trainerName);
  for (const entry of party) {
    if (_matchesPartyIdentity(entry, pidLike)) return entry;
  }
  return null;
}

function _pieceSlotSortValue(piece) {
  return [
    safeInt(piece?.createdAt, 0),
    safeInt(piece?.updatedAt, 0),
    safeInt(piece?.row, 0),
    safeInt(piece?.col, 0),
    safeStr(piece?.id),
  ];
}

function _resolveRoomPiecesPartySlots(rawPieces = appState.piecesRaw) {
  const source = Array.isArray(rawPieces) ? rawPieces : [];
  const resolved = source.map((piece) => ((piece && typeof piece === "object") ? { ...piece } : piece));
  const ownerBuckets = new Map();

  resolved.forEach((piece, index) => {
    if (!piece || typeof piece !== "object" || isTrainerPiece(piece)) return;
    const ownerKey = _trainerLookupKey(piece?.owner);
    if (!ownerKey) return;
    if (!ownerBuckets.has(ownerKey)) ownerBuckets.set(ownerKey, []);
    ownerBuckets.get(ownerKey).push({ piece, index });
  });

  for (const [, ownerEntries] of ownerBuckets.entries()) {
    const ownerName = safeStr(ownerEntries[0]?.piece?.owner);
    const party = getPartyForTrainer(ownerName);
    if (!party.length) {
      ownerEntries.forEach(({ piece }) => {
        piece.party_slot = _getPartySlot(piece);
        piece._party_slot = piece.party_slot || "";
        piece._party_slot_inferred = false;
        piece._party_slot_ambiguous = !piece.party_slot;
      });
      continue;
    }

    const freeSlotsByLookupKey = new Map();
    const validPartySlots = new Set();
    const usedSlots = new Set();
    for (const entry of party) {
      const slot = _getPartySlot(entry);
      if (!slot) continue;
      validPartySlots.add(slot);
      for (const key of _partyEntryLookupKeys(entry)) {
        if (!key) continue;
        if (!freeSlotsByLookupKey.has(key)) freeSlotsByLookupKey.set(key, []);
        freeSlotsByLookupKey.get(key).push(slot);
      }
    }

    ownerEntries.forEach(({ piece }) => {
      const explicitSlot = _getPartySlot(piece);
      if (!explicitSlot) return;
      if (!validPartySlots.has(explicitSlot)) {
        piece._party_slot_invalid = explicitSlot;
        piece.party_slot = "";
        piece._party_slot = "";
        piece._party_slot_inferred = false;
        piece._party_slot_ambiguous = true;
        return;
      }
      usedSlots.add(explicitSlot);
      piece.party_slot = explicitSlot;
      piece._party_slot = explicitSlot;
      piece._party_slot_inferred = false;
      piece._party_slot_ambiguous = false;
    });

    ownerEntries
      .filter(({ piece }) => !_getPartySlot(piece))
      .sort((left, right) => {
        const a = _pieceSlotSortValue(left.piece);
        const b = _pieceSlotSortValue(right.piece);
        for (let i = 0; i < a.length; i += 1) {
          if (a[i] === b[i]) continue;
          return a[i] > b[i] ? 1 : -1;
        }
        return 0;
      })
      .forEach(({ piece }) => {
        const candidates = [];
        for (const key of _partyEntryLookupKeys(piece)) {
          const slots = freeSlotsByLookupKey.get(key) || [];
          for (const slot of slots) {
            if (slot && !candidates.includes(slot) && !usedSlots.has(slot)) candidates.push(slot);
          }
        }
        const pickedSlot = candidates[0] || "";
        if (pickedSlot) usedSlots.add(pickedSlot);
        piece.party_slot = pickedSlot;
        piece._party_slot = pickedSlot;
        piece._party_slot_inferred = !!pickedSlot;
        piece._party_slot_ambiguous = !pickedSlot;
      });
  }

  return resolved;
}

function _refreshResolvedRoomPieces() {
  appState.pieces = resolvePiecesSizeForRules(_resolveRoomPiecesPartySlots(appState.piecesRaw));
  return appState.pieces;
}

function _getUserDataForTrainer(trainerName) {
  const tn = safeStr(trainerName);
  if (!tn) return null;
  if (_trainerLookupKey(tn) === _trainerLookupKey(appState.by) && appState.selfUserData) {
    return appState.selfUserData;
  }

  const uidCandidates = new Set([safeDocId(tn), safeIdLower(tn)]);
  if (_trainerLookupKey(tn) === _trainerLookupKey(appState.by)) {
    uidCandidates.add(safeStr(appState.selfTrainerId));
    uidCandidates.add(safeStr(appState.selfAuthUid));
  }
  for (const player of (appState.players || [])) {
    if (_trainerLookupKey(player?.trainer_name) !== _trainerLookupKey(tn)) continue;
    uidCandidates.add(safeStr(player?.uid));
    uidCandidates.add(safeStr(player?.id));
  }

  for (const uid of uidCandidates) {
    if (!uid) continue;
    const entry = appState.userProfiles?.get?.(uid);
    const profile = entry?.profile;
    if (profile && typeof profile === "object") return profile;
    const raw = entry?.raw;
    const data = raw?.data || raw;
    if (data && typeof data === "object") return data;
  }
  return null;
}

function _extractUserFormsMap(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  if (source.forms && typeof source.forms === "object" && !Array.isArray(source.forms)) {
    return source.forms;
  }
  if (source.user_forms && typeof source.user_forms === "object" && !Array.isArray(source.user_forms)) {
    return source.user_forms;
  }
  if (source.userForms && typeof source.userForms === "object" && !Array.isArray(source.userForms)) {
    return source.userForms;
  }
  if (source.profile && typeof source.profile === "object" && !Array.isArray(source.profile)) {
    const nestedProfile = _extractUserFormsMap(source.profile);
    if (nestedProfile) return nestedProfile;
  }
  if (source.data && typeof source.data === "object" && !Array.isArray(source.data)) {
    const nestedData = _extractUserFormsMap(source.data);
    if (nestedData) return nestedData;
  }
  return null;
}

function _getUserFormsForTrainer(trainerName) {
  const tn = safeStr(trainerName);
  if (!tn) return null;

  const fromUserData = _extractUserFormsMap(_getUserDataForTrainer(tn));
  if (fromUserData) return fromUserData;

  for (const uid of getTrainerCandidateIds(tn)) {
    const entry = appState.userProfiles?.get?.(uid);
    const mapped = _extractUserFormsMap(entry);
    if (mapped) return mapped;
  }

  return null;
}

function _extractHubPokemonMetaMap(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  if (source.hubPokemonMeta && typeof source.hubPokemonMeta === "object" && !Array.isArray(source.hubPokemonMeta)) {
    return source.hubPokemonMeta;
  }
  if (source.hub_pokemon_meta && typeof source.hub_pokemon_meta === "object" && !Array.isArray(source.hub_pokemon_meta)) {
    return source.hub_pokemon_meta;
  }
  if (source.data && typeof source.data === "object" && !Array.isArray(source.data)) {
    const nested = _extractHubPokemonMetaMap(source.data);
    if (nested) return nested;
  }
  if (source.pokemons && typeof source.pokemons === "object" && !Array.isArray(source.pokemons)) {
    return source.pokemons;
  }
  return null;
}

function _extractHubPokemonEntriesMap(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  if (source.hubPokemonEntries && typeof source.hubPokemonEntries === "object" && !Array.isArray(source.hubPokemonEntries)) {
    return source.hubPokemonEntries;
  }
  if (source.entries && typeof source.entries === "object" && !Array.isArray(source.entries)) {
    return source.entries;
  }
  if (source.pokemon_meta && typeof source.pokemon_meta === "object" && !Array.isArray(source.pokemon_meta)) {
    const nestedMeta = _extractHubPokemonEntriesMap(source.pokemon_meta);
    if (nestedMeta) return nestedMeta;
  }
  if (source.data && typeof source.data === "object" && !Array.isArray(source.data)) {
    const nested = _extractHubPokemonEntriesMap(source.data);
    if (nested) return nested;
  }
  return null;
}

function _getHubPokemonMetaForTrainer(trainerName) {
  const tn = safeStr(trainerName);
  if (!tn) return null;

  const fromUserData = _extractHubPokemonMetaMap(_getUserDataForTrainer(tn));
  if (fromUserData) return fromUserData;

  for (const uid of getTrainerCandidateIds(tn)) {
    const entry = appState.userProfiles?.get?.(uid);
    const mapped = _extractHubPokemonMetaMap(entry);
    if (mapped) return mapped;
  }

  return null;
}

function _getHubPokemonEntriesForTrainer(trainerName) {
  const tn = safeStr(trainerName);
  if (!tn) return null;

  const fromUserData = _extractHubPokemonEntriesMap(_getUserDataForTrainer(tn));
  if (fromUserData) return fromUserData;

  for (const uid of getTrainerCandidateIds(tn)) {
    const entry = appState.userProfiles?.get?.(uid);
    const mapped = _extractHubPokemonEntriesMap(entry);
    if (mapped) return mapped;
  }

  return null;
}

function _getHubPokemonMetaEntry(hubMeta, pidLike) {
  if (!hubMeta || typeof hubMeta !== "object") return null;
  const targetKeys = _partyEntryLookupKeys(pidLike);
  if (!targetKeys.length) return null;
  for (const [rawKey, meta] of Object.entries(hubMeta)) {
    if (!targetKeys.includes(pidKey(rawKey))) continue;
    if (meta && typeof meta === "object" && !Array.isArray(meta)) return meta;
  }
  return null;
}

function _getUserEntryMetaHp(trainerName, entryId) {
  const tn = safeStr(trainerName);
  const eid = safeStr(entryId);
  if (!tn || !eid) return null;
  const data = _getUserDataForTrainer(tn);
  const meta = data?.hub_entry_meta;
  const hp = meta?.[eid]?.hp;
  return hp == null ? null : clampPartyHp(hp, 6);
}

function _entryPidMatches(entryPayload, pidLike) {
  if (!entryPayload || typeof entryPayload !== "object") return false;
  const keys = _partyEntryLookupKeys(pidLike);
  if (!keys.length) return false;
  return keys.includes(pidKey(entryPayload.pid ?? entryPayload.pokemon?.id));
}

function _resolvePartyEntryIdentity(ownerName, pidLike) {
  const pid = normalizePartyPid(pidLike?.pid ?? pidLike?.pokemon?.id ?? pidLike);
  let entryId = _getEntryId(pidLike);
  let partySlot = (pidLike && typeof pidLike === "object" && !Array.isArray(pidLike)) || _looksLikePartySlotKey(pidLike)
    ? _getPartySlot(pidLike)
    : "";
  let partyEntry = null;
  const party = getPartyForTrainer(ownerName);

  if (entryId) {
    partyEntry = party.find((entry) => _getEntryId(entry) === entryId) || null;
    const matchedSlot = _getPartySlot(partyEntry);
    if (matchedSlot && partySlot !== matchedSlot) partySlot = matchedSlot;
  }

  if (!entryId && partySlot) {
    partyEntry = party.find((entry) => _getPartySlot(entry) === partySlot) || null;
    if (partyEntry) {
      entryId = _getEntryId(partyEntry);
    } else if (party.length) {
      partySlot = "";
    }
  }

  if (!entryId && pid) {
    const matches = party.filter((entry) => _matchesPartyIdentity(entry, { pid }));
    if (matches.length === 1) {
      partyEntry = matches[0];
      entryId = _getEntryId(partyEntry);
      partySlot = partySlot || _getPartySlot(partyEntry);
    }
  }

  return {
    pid: pid || normalizePartyPid(partyEntry?.pid ?? partyEntry?.pokemon?.id ?? pidLike),
    entryId: safeStr(entryId),
    partySlot: safeStr(partySlot),
    partyEntry,
  };
}

function _findGlobalEntryByPidUnambiguous(ownerName, pidLike) {
  const entries = _getHubPokemonEntriesForTrainer(ownerName);
  if (!entries || typeof entries !== "object") return null;
  const matches = [];
  for (const [entryId, payload] of Object.entries(entries)) {
    if (_entryPidMatches(payload, pidLike)) matches.push([safeStr(entryId), payload]);
  }
  return matches.length === 1 ? matches[0] : null;
}

function _getGlobalEntryHpPayload(ownerName, pidLike) {
  const resolved = _resolvePartyEntryIdentity(ownerName, pidLike);
  const entries = _getHubPokemonEntriesForTrainer(ownerName);
  if (resolved.entryId && entries?.[resolved.entryId]?.hp != null) {
    return entries[resolved.entryId];
  }
  if (resolved.entryId) {
    const localHp = _getUserEntryMetaHp(ownerName, resolved.entryId);
    if (localHp != null) return { entry_id: resolved.entryId, pid: resolved.pid, hp: localHp };
  }
  if (resolved.partyEntry?.hp != null) return resolved.partyEntry;
  const unambiguous = _findGlobalEntryByPidUnambiguous(ownerName, resolved.pid || pidLike);
  if (unambiguous?.[1]?.hp != null) return unambiguous[1];
  return null;
}

function _getGlobalEntryHp(ownerName, pidLike) {
  const payload = _getGlobalEntryHpPayload(ownerName, pidLike);
  if (payload?.hp != null) return clampPartyHp(payload.hp, 6);
  return null;
}

function _hpStateTimestampMs(payload) {
  const raw = payload?.hpUpdatedAt ?? payload?.updatedAt ?? payload?.last_update ?? null;
  if (!raw) return 0;
  if (typeof raw.toMillis === "function") return Number(raw.toMillis()) || 0;
  if (typeof raw.seconds === "number") {
    return (Number(raw.seconds) * 1000) + Math.floor(Number(raw.nanoseconds || 0) / 1000000);
  }
  const parsed = Date.parse(safeStr(raw));
  return Number.isFinite(parsed) ? parsed : 0;
}

function _resolveHpValue(roomState, globalPayload) {
  const hasRoom = roomState?.hp != null;
  const hasGlobal = globalPayload?.hp != null;
  if (hasRoom && hasGlobal) {
    const roomTs = _hpStateTimestampMs(roomState);
    const globalTs = _hpStateTimestampMs(globalPayload);
    if (roomTs > 0 && (!globalTs || roomTs >= globalTs)) return clampPartyHp(roomState.hp, 6);
    return clampPartyHp(globalPayload.hp, 6);
  }
  if (hasGlobal) return clampPartyHp(globalPayload.hp, 6);
  if (hasRoom) return clampPartyHp(roomState.hp, 6);
  return null;
}

function _normalizeResolvedTypeName(value) {
  const normalized = normalizeType(value);
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "";
}

function _appendResolvedTypes(out, seen, value) {
  if (value == null) return;

  const push = (typeLike) => {
    const label = _normalizeResolvedTypeName(typeLike);
    if (!label) return;
    const key = normalizeType(label);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(label);
  };

  if (Array.isArray(value)) {
    value.forEach((entry) => _appendResolvedTypes(out, seen, entry));
    return;
  }

  if (typeof value === "string") {
    value
      .split(/[,\|/]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach(push);
    return;
  }

  if (typeof value !== "object") {
    push(value);
    return;
  }

  if (Array.isArray(value.types)) {
    _appendResolvedTypes(out, seen, value.types);
    return;
  }
  if (Array.isArray(value.resolved_types)) {
    _appendResolvedTypes(out, seen, value.resolved_types);
    return;
  }

  for (const key of ["primary", "secondary", "type1", "type2", "type_1", "type_2", "slot1", "slot2", "first", "second"]) {
    if (value[key] != null) push(value[key]);
  }

  if (!out.length) {
    for (const candidate of Object.values(value)) {
      if (typeof candidate === "string" || Array.isArray(candidate)) {
        _appendResolvedTypes(out, seen, candidate);
      }
    }
  }
}

function _coerceResolvedTypes(value) {
  const out = [];
  const seen = new Set();
  _appendResolvedTypes(out, seen, value);
  return out;
}

function _extractResolvedTypesFromSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return [];
  const fromResolved = _coerceResolvedTypes(source?.resolved_types ?? source?.resolvedTypes);
  if (fromResolved.length) return fromResolved;
  return _coerceResolvedTypes(source?.type_override ?? source?.typeOverride);
}

function _getResolvedTypesFromHubMeta(hubMeta, pidLike) {
  if (!hubMeta || typeof hubMeta !== "object") return [];
  const targetKeys = _partyEntryLookupKeys(pidLike);
  if (!targetKeys.length) return [];
  for (const [rawKey, meta] of Object.entries(hubMeta)) {
    if (!targetKeys.includes(pidKey(rawKey))) continue;
    const resolved = _extractResolvedTypesFromSource(meta);
    if (resolved.length) return resolved;
  }
  return [];
}

function _normalizeResolvedAbilityName(value) {
  return toTitleWords(safeStr(value).replace(/[_-]+/g, " ").trim());
}

function _appendResolvedAbilities(out, seen, value) {
  if (value == null) return;

  const push = (abilityLike) => {
    const label = _normalizeResolvedAbilityName(abilityLike);
    if (!label) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(label);
  };

  if (Array.isArray(value)) {
    value.forEach((entry) => _appendResolvedAbilities(out, seen, entry));
    return;
  }

  if (typeof value === "string") {
    value
      .split(/[,\|/]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach(push);
    return;
  }

  if (typeof value !== "object") {
    push(value);
    return;
  }

  if (Array.isArray(value.abilities)) {
    _appendResolvedAbilities(out, seen, value.abilities);
    return;
  }
  if (Array.isArray(value.resolved_abilities)) {
    _appendResolvedAbilities(out, seen, value.resolved_abilities);
    return;
  }

  for (const key of ["primary", "secondary", "hidden", "ability1", "ability2", "ability_1", "ability_2"]) {
    if (value[key] != null) push(value[key]);
  }

  if (!out.length) {
    for (const candidate of Object.values(value)) {
      if (typeof candidate === "string" || Array.isArray(candidate)) {
        _appendResolvedAbilities(out, seen, candidate);
      }
    }
  }
}

function _coerceResolvedAbilities(value) {
  const out = [];
  const seen = new Set();
  _appendResolvedAbilities(out, seen, value);
  return out;
}

function _extractResolvedAbilitiesFromSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return [];
  const fromResolved = _coerceResolvedAbilities(source?.resolved_abilities ?? source?.resolvedAbilities);
  if (fromResolved.length) return fromResolved;
  return _coerceResolvedAbilities(source?.ability_override ?? source?.abilityOverride ?? source?.abilities);
}

function _extractPokemonFormSlugFromSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return "";
  const nestedForm = (source?.form && typeof source.form === "object" && !Array.isArray(source.form))
    ? source.form
    : null;
  return _normalizePokemonFormSlug(
    source?.form_slug
    ?? source?.formSlug
    ?? source?.selected_form
    ?? source?.selectedForm
    ?? nestedForm?.slug
    ?? nestedForm?.form_slug
    ?? nestedForm?.pokemon_api_name
    ?? nestedForm?.pokemonApiName
    ?? nestedForm?.species_api_name
    ?? nestedForm?.speciesApiName
    ?? (nestedForm ? "" : source?.form)
  );
}

function _extractPokemonDisplayNameFromSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return "";
  return safeStr(
    source?.display_name
    ?? source?.displayName
    ?? source?.form_display_name
    ?? source?.formDisplayName
    ?? source?.resolved_name
    ?? source?.resolvedName
  );
}

function _extractPokemonImageFromSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return "";
  return safeStr(
    source?.image
    ?? source?.image_url
    ?? source?.imageUrl
    ?? source?.sprite
    ?? source?.sprite_url
    ?? source?.spriteUrl
  );
}

function _coerceBooleanFlag(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = safeStr(value).trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "y", "sim", "s"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "nao", "não"].includes(normalized)) return false;
  return null;
}

function _extractPokemonSexFromSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return _inferPokemonSexFromSlug(source);
  }
  const direct = _normalizePokemonSex(
    source?.sex
    ?? source?.gender
    ?? source?.pokemon?.sex
    ?? source?.pokemon?.gender
    ?? source?.form?.sex
    ?? source?.form?.gender
  );
  if (direct) return direct;
  const isFemale = _coerceBooleanFlag(source?.is_female ?? source?.isFemale ?? source?.female);
  if (isFemale === true) return "female";
  const isMale = _coerceBooleanFlag(source?.is_male ?? source?.isMale ?? source?.male);
  if (isMale === true) return "male";
  return _inferPokemonSexFromSlug(_extractPokemonFormSlugFromSource(source));
}

function _extractPokemonGmaxAllowedFromSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  for (const value of [
    source?.gmax_available,
    source?.gmaxAvailable,
    source?.gigantamax_available,
    source?.gigantamaxAvailable,
    source?.can_gmax,
    source?.canGmax,
    source?.pokemon?.gmax_available,
    source?.pokemon?.gigantamax_available,
    source?.pokemon?.can_gmax,
  ]) {
    const coerced = _coerceBooleanFlag(value);
    if (coerced != null) return coerced;
  }
  return null;
}

function _buildPokemonFormSource(source, sourceKind = "") {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const formSlug = _extractPokemonFormSlugFromSource(source);
  const displayName = _extractPokemonDisplayNameFromSource(source);
  const image = _extractPokemonImageFromSource(source);
  const sex = _extractPokemonSexFromSource(source);
  const gmaxAllowed = _extractPokemonGmaxAllowedFromSource(source);
  const resolvedTypes = _extractResolvedTypesFromSource(source);
  const resolvedAbilities = _extractResolvedAbilitiesFromSource(source);
  if (!(formSlug || displayName || image || resolvedTypes.length || resolvedAbilities.length)) return null;
  return {
    sourceKind,
    formSlug,
    sex,
    gmaxAllowed,
    displayName: displayName || (formSlug ? _humanizePokemonFormSlug(formSlug) : ""),
    image: image || (formSlug ? spriteUrlWithFallback(formSlug, "art", false, { sex }) : ""),
    resolvedTypes,
    resolvedAbilities,
    raw: source,
  };
}

function _getPokemonFormsBucket(trainerName) {
  return _getTrainerBucket(appState.pokemonForms, trainerName);
}

function _getPokemonFormEntry(trainerName, pidLike) {
  const slot = _getPartySlot(pidLike);
  if (!slot) return null;
  const bucket = _getPokemonFormsBucket(trainerName);
  const direct = bucket?.[slot];
  return (direct && typeof direct === "object" && !Array.isArray(direct)) ? direct : null;
}

function _getPokemonFormSourceFromHubMeta(hubMeta, pidLike) {
  return _buildPokemonFormSource(_getHubPokemonMetaEntry(hubMeta, pidLike), "hub");
}

function _getUserFormSourceForTrainerPid(trainerName, pidLike) {
  const formsMap = _getUserFormsForTrainer(trainerName);
  if (!formsMap || typeof formsMap !== "object") return null;
  const targetKeys = _partyEntryLookupKeys(pidLike);
  if (!targetKeys.length) return null;
  for (const [rawKey, value] of Object.entries(formsMap)) {
    if (!targetKeys.includes(pidKey(rawKey))) continue;
    const source = (value && typeof value === "object" && !Array.isArray(value))
      ? value
      : { form_slug: value };
    const built = _buildPokemonFormSource(source, "user");
    if (built) return built;
  }
  return null;
}

function _getPreferredPokemonSexForTrainerPid(trainerName, pidLike) {
  const owner = safeStr(trainerName);
  for (const source of [
    _getPokemonFormEntry(owner, pidLike),
    getPartySnapshotEntryForTrainerPid(owner, pidLike),
    _getPartyEntryForTrainerPid(owner, pidLike),
  ]) {
    const sex = _extractPokemonSexFromSource(source);
    if (sex) return sex;
  }
  const userFormSource = _getUserFormSourceForTrainerPid(owner, pidLike);
  if (userFormSource?.sex) return userFormSource.sex;
  return _extractPokemonSexFromSource(_getHubPokemonMetaEntry(_getHubPokemonMetaForTrainer(owner), pidLike));
}

function _canShowGmaxForTrainerPid(trainerName, pidLike, options = {}) {
  const owner = safeStr(trainerName);
  const piece = options?.piece || null;
  const sheet = options?.sheet || null;
  const selfResolved = options?.resolvedSheetEntry
    || (_trainerLookupKey(owner) === _trainerLookupKey(appState.by)
      ? _resolveSelfEffectiveSheet(pidLike, owner, { ignoreMega: true })
      : null);
  for (const source of [
    _getPokemonFormEntry(owner, pidLike),
    getPartySnapshotEntryForTrainerPid(owner, pidLike),
    _getPartyEntryForTrainerPid(owner, pidLike),
    piece,
    _getHubPokemonMetaEntry(_getHubPokemonMetaForTrainer(owner), pidLike),
    sheet?.pokemon,
    sheet,
    selfResolved?.baseSheet?.pokemon,
    selfResolved?.baseSheet,
    selfResolved?.effectiveSheet?.pokemon,
    selfResolved?.effectiveSheet,
  ]) {
    const allowed = _extractPokemonGmaxAllowedFromSource(source);
    if (allowed != null) return allowed;
  }
  return false;
}

function _getPreferredPokemonFormSource(trainerName, pidLike) {
  const owner = safeStr(trainerName);
  const userFormSource = _getUserFormSourceForTrainerPid(owner, pidLike);
  for (const [kind, source] of [
    ["room", _getPokemonFormEntry(owner, pidLike)],
    ["snapshot", getPartySnapshotEntryForTrainerPid(owner, pidLike)],
    ["party", _getPartyEntryForTrainerPid(owner, pidLike)],
    ["user", userFormSource?.raw],
  ]) {
    const built = _buildPokemonFormSource(source, kind);
    if (built) return built;
  }
  return _getPokemonFormSourceFromHubMeta(_getHubPokemonMetaForTrainer(owner), pidLike);
}

function _inferBasePokemonFormSlug(trainerName, pidLike, options = {}) {
  const owner = safeStr(trainerName);
  const piece = options?.piece || null;
  const sheet = options?.sheet || null;

  for (const source of [
    options?.source || null,
    getPartySnapshotEntryForTrainerPid(owner, pidLike),
    _getPartyEntryForTrainerPid(owner, pidLike),
    _getUserFormSourceForTrainerPid(owner, pidLike)?.raw,
    _getHubPokemonMetaEntry(_getHubPokemonMetaForTrainer(owner), pidLike),
    piece,
    sheet?.pokemon,
    sheet,
  ]) {
    const fromForm = _extractPokemonFormSlugFromSource(source);
    if (fromForm) return fromForm;
    const fromName = _normalizePokemonFormSlug(source?.pokemon?.name || source?.name);
    if (fromName) return fromName;
  }

  const rawPid = safeStr(pidLike?.pid ?? pidLike?.pokemon?.id ?? pidLike);
  const dexName = dexNameFromPid(rawPid) || resolvePokemonNameFromPid(rawPid);
  const inferred = dexName ? _normalizePokemonFormSlug(dexName) : (rawPid && !/^\d+$/.test(rawPid) ? _normalizePokemonFormSlug(rawPid) : "");
  if (inferred) {
    const root = _inferCanonicalFormRoot(inferred);
    const optionsForRoot = _getPokemonFormOptionsForRoot(root);
    if (!_pokemonFormManifestSet.has(inferred) && optionsForRoot.length) return _defaultFormSlugForRoot(root);
    return inferred;
  }
  return "";
}

function getResolvedTypesForTrainerPid(trainerName, pidLike, options = {}) {
  const owner = safeStr(trainerName);
  const pid = safeStr(pidLike?.pid ?? pidLike?.pokemon?.id ?? pidLike);
  const piece = options?.piece || null;
  const sheet = options?.sheet || null;
  const effectiveIdentity = piece || pidLike;
  const formSource = _getPreferredPokemonFormSource(owner, piece || pidLike);
  const canUseSelfSheets = _trainerLookupKey(owner) === _trainerLookupKey(appState.by);

  if (formSource?.resolvedTypes?.length) return formSource.resolvedTypes;

  if (formSource?.formSlug) {
    const formSheet = canUseSelfSheets
      ? _resolveSelfEffectiveSheet(piece || pidLike, owner, { preferredFormSlug: formSource.formSlug, ignoreMega: true })?.baseSheet
      : null;
    const fromFormSheet = _coerceResolvedTypes(formSheet?.pokemon?.types);
    if (fromFormSheet.length) return fromFormSheet;
    const cachedForm = _getPokeApiCached(formSource.formSlug);
    if (cachedForm && Array.isArray(cachedForm.types) && cachedForm.types.length) return cachedForm.types;
    if (_pokeApiCache.get(formSource.formSlug) !== "pending") fetchPokeApiData(formSource.formSlug);
  }

  for (const source of [
    getPartySnapshotEntryForTrainerPid(owner, pidLike),
    _getPartyEntryForTrainerPid(owner, pidLike),
    piece,
  ]) {
    const resolved = _extractResolvedTypesFromSource(source);
    if (resolved.length) return resolved;
  }

  const fromHubMeta = _getResolvedTypesFromHubMeta(_getHubPokemonMetaForTrainer(owner), pidLike);
  if (fromHubMeta.length) return fromHubMeta;

  const fromSheet = _coerceResolvedTypes(sheet?.pokemon?.types);
  if (fromSheet.length) return fromSheet;

  const fromPiece = _coerceResolvedTypes(piece?.types);
  if (fromPiece.length) return fromPiece;

  const slug = _getEffectivePokeApiSlug(owner, effectiveIdentity);
  if (slug) {
    const cached = _getPokeApiCached(slug);
    if (cached && Array.isArray(cached.types) && cached.types.length) return cached.types;
    if (_pokeApiCache.get(slug) !== "pending") fetchPokeApiData(slug);
  }

  const displayName = displayNameFromPid(effectiveIdentity, { owner }) || dexNameFromPid(pid) || pid;
  if (displayName && displayName !== "???" && displayName !== "â€”") {
    const nameSlug = _normalizePokeApiSlug(displayName);
    if (nameSlug) {
      const cached = _getPokeApiCached(nameSlug);
      if (cached && Array.isArray(cached.types) && cached.types.length) return cached.types;
      if (_pokeApiCache.get(nameSlug) !== "pending") fetchPokeApiData(nameSlug);
    }
  }

  return [];
}

function getResolvedAbilitiesForTrainerPid(trainerName, pidLike, options = {}) {
  const owner = safeStr(trainerName);
  const piece = options?.piece || null;
  const sheet = options?.sheet || null;
  const formSource = _getPreferredPokemonFormSource(owner, piece || pidLike);
  const canUseSelfSheets = _trainerLookupKey(owner) === _trainerLookupKey(appState.by);

  if (formSource?.resolvedAbilities?.length) return formSource.resolvedAbilities;

  if (formSource?.formSlug) {
    const formSheet = canUseSelfSheets
      ? _resolveSelfEffectiveSheet(piece || pidLike, owner, { preferredFormSlug: formSource.formSlug, ignoreMega: true })?.baseSheet
      : null;
    const fromFormSheet = _coerceResolvedAbilities(formSheet?.pokemon?.abilities);
    if (fromFormSheet.length) return fromFormSheet;
    const cachedForm = _getPokeApiCached(formSource.formSlug);
    if (cachedForm && Array.isArray(cachedForm.abilities) && cachedForm.abilities.length) {
      return _coerceResolvedAbilities(cachedForm.abilities.map((item) => item?.ability?.name || item?.name || item));
    }
    if (_pokeApiCache.get(formSource.formSlug) !== "pending") fetchPokeApiData(formSource.formSlug);
  }

  for (const source of [
    getPartySnapshotEntryForTrainerPid(owner, pidLike),
    _getPartyEntryForTrainerPid(owner, pidLike),
    piece,
  ]) {
    const resolved = _extractResolvedAbilitiesFromSource(source);
    if (resolved.length) return resolved;
  }

  const fromHubMeta = _getPokemonFormSourceFromHubMeta(_getHubPokemonMetaForTrainer(owner), pidLike);
  if (fromHubMeta?.resolvedAbilities?.length) return fromHubMeta.resolvedAbilities;

  const fromSheet = _coerceResolvedAbilities(sheet?.pokemon?.abilities);
  if (fromSheet.length) return fromSheet;

  const cached = _getPokeApiCached(_inferBasePokemonFormSlug(owner, pidLike, { piece, sheet }));
  if (cached && Array.isArray(cached.abilities) && cached.abilities.length) {
    return _coerceResolvedAbilities(cached.abilities.map((item) => item?.ability?.name || item?.name || item));
  }

  return [];
}

function _trainerRpgPickStat(src, ...keys) {
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

function _normalizeTrainerRpgStats(stats) {
  const src = (stats && typeof stats === "object" && !Array.isArray(stats)) ? stats : {};
  return {
    stgr: safeInt(_trainerRpgPickStat(src, "stgr", "Stgr", "STGR", "strg", "Strg"), 0),
    int: safeInt(_trainerRpgPickStat(src, "int", "Int", "INT", "intel", "Intel", "intelligence", "Intelligence"), 0),
    dodge: safeInt(_trainerRpgPickStat(src, "dodge", "Dodge", "DODGE"), 0),
    parry: safeInt(_trainerRpgPickStat(src, "parry", "Parry", "PARRY"), 0),
    will: safeInt(_trainerRpgPickStat(src, "will", "Will", "WILL"), 0),
    fortitude: safeInt(_trainerRpgPickStat(src, "fortitude", "Fortitude", "FORTITUDE", "fort", "Fort", "FORT"), 0),
    thg: safeInt(_trainerRpgPickStat(src, "thg", "Thg", "THG"), 0),
  };
}

function _normalizeTrainerRpgTextList(value) {
  const out = [];
  const pushLine = (line) => {
    const clean = safeStr(line);
    if (clean) out.push(clean);
  };
  const pushValue = (item) => {
    if (item == null) return;
    if (typeof item === "string") {
      item.split(/\r?\n+/).forEach(pushLine);
      return;
    }
    if (typeof item === "object" && !Array.isArray(item)) {
      const label = safeStr(item.text || item.name || item.label || item.value);
      const ranks = safeStr(item.ranks);
      pushLine(label ? `${label}${ranks ? ` R${ranks}` : ""}` : "");
      return;
    }
    pushLine(item);
  };

  if (Array.isArray(value)) {
    value.forEach(pushValue);
    return out;
  }

  pushValue(value);
  return out;
}

function normalizeTrainerRpgSheet(sheet, trainerName = "") {
  if (!sheet || typeof sheet !== "object" || Array.isArray(sheet)) return null;
  const statsSource = (sheet.stats && typeof sheet.stats === "object" && !Array.isArray(sheet.stats))
    ? sheet.stats
    : sheet;
  return {
    trainer_name: safeStr(sheet.trainer_name || sheet.trainerName || trainerName || appState.by),
    stats: _normalizeTrainerRpgStats(statsSource),
    skills: _normalizeTrainerRpgTextList(sheet.skills),
    advantages: _normalizeTrainerRpgTextList(sheet.advantages),
    updated_at: sheet.updated_at || null,
  };
}

function _getSelfTrainerRpgSheetFallback() {
  const direct = appState.selfUserData?.trainer_profile?.rpg_sheet;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;

  const tn = safeStr(appState.by);
  for (const uid of getTrainerCandidateIds(tn)) {
    const entry = appState.userProfiles?.get?.(uid);
    const raw = entry?.raw?.data || entry?.raw;
    const rawSheet = raw?.trainer_profile?.rpg_sheet;
    if (rawSheet && typeof rawSheet === "object" && !Array.isArray(rawSheet)) return rawSheet;
  }
  return null;
}

function getSelfTrainerRpgSheet() {
  const rawSheet = appState.selfTrainerRpgSheet || _getSelfTrainerRpgSheetFallback();
  return normalizeTrainerRpgSheet(rawSheet, safeStr(appState.by));
}

function _moveNameValue(mv) {
  return safeStr(mv?.name || mv?.Nome || mv?.nome || "Golpe");
}

function _moveNameKey(name) {
  return safeStr(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function _getFavoriteMoveNamesForTrainerPid(trainerName, pidLike) {
  const userData = _getUserDataForTrainer(trainerName);
  const favoriteMoves = userData?.favorite_moves;
  if (!favoriteMoves || typeof favoriteMoves !== "object") return [];

  const targetKeys = _partyEntryLookupKeys(pidLike);
  if (!targetKeys.length) return [];

  for (const [rawKey, names] of Object.entries(favoriteMoves)) {
    if (!targetKeys.includes(pidKey(rawKey))) continue;
    if (!Array.isArray(names)) return [];
    return names.map((name) => safeStr(name)).filter(Boolean).slice(0, 4);
  }
  return [];
}

function _getPreferredMovesForTrainerPid(trainerName, pidLike, moves, limit = 4) {
  const moveList = (Array.isArray(moves) ? moves : []).filter((mv) => mv && typeof mv === "object");
  const maxItems = Math.max(0, parseInt(limit, 10) || 0);
  if (!moveList.length || !maxItems) return [];

  const favoriteNames = _getFavoriteMoveNamesForTrainerPid(trainerName, pidLike);
  if (!favoriteNames.length) return moveList.slice(0, maxItems);

  const remaining = moveList.slice();
  const out = [];
  for (const favoriteName of favoriteNames) {
    const favoriteKey = _moveNameKey(favoriteName);
    if (!favoriteKey) continue;
    const idx = remaining.findIndex((mv) => _moveNameKey(_moveNameValue(mv)) === favoriteKey);
    if (idx < 0) continue;
    out.push(remaining[idx]);
    remaining.splice(idx, 1);
    if (out.length >= maxItems) return out;
  }

  for (const mv of remaining) {
    out.push(mv);
    if (out.length >= maxItems) break;
  }
  return out;
}

function _getHeldItemFromHubMeta(hubMeta, pidLike) {
  if (!hubMeta || typeof hubMeta !== "object") return null;
  const targetKeys = _partyEntryLookupKeys(pidLike);
  if (!targetKeys.length) return null;
  for (const [rawKey, meta] of Object.entries(hubMeta)) {
    if (!targetKeys.includes(pidKey(rawKey))) continue;
    const heldItem = meta?.held_item || meta?.heldItem || null;
    if (heldItem) return heldItem;
  }
  return null;
}

function _slugifyCaptureBallName(value) {
  return safeStr(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function _captureBallApiName(rawBall) {
  return _slugifyCaptureBallName(rawBall?.api_name || rawBall?.name || rawBall?.backpack_name || rawBall || "");
}

function _getCaptureBallIconUrl(rawBall) {
  const direct = safeStr(rawBall?.icon_url || rawBall?.iconUrl || rawBall?.image_url || rawBall?.sprite_url || "");
  if (direct) return direct;
  const apiName = _captureBallApiName(rawBall) || DEFAULT_CAPTURE_BALL_API_NAME;
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${apiName}.png`;
}

function _getCaptureBallFromHubMeta(hubMeta, pidLike) {
  if (!hubMeta || typeof hubMeta !== "object") return null;
  const targetKeys = _partyEntryLookupKeys(pidLike);
  if (!targetKeys.length) return null;
  for (const [rawKey, meta] of Object.entries(hubMeta)) {
    if (!targetKeys.includes(pidKey(rawKey))) continue;
    const captureBall = meta?.capture_ball || meta?.captureBall || null;
    if (captureBall) return captureBall;
  }
  return null;
}

function normalizeCaptureBall(rawBall, { fallbackToDefault = true } = {}) {
  const source = rawBall && typeof rawBall === "object"
    ? rawBall
    : (safeStr(rawBall) ? { name: safeStr(rawBall) } : null);
  if (!source && !fallbackToDefault) return null;

  const apiName = _captureBallApiName(source) || (fallbackToDefault ? DEFAULT_CAPTURE_BALL_API_NAME : "");
  if (!apiName) return null;

  const themeKey = CAPTURE_BALL_THEME_PRESETS[apiName] ? apiName : DEFAULT_CAPTURE_BALL_API_NAME;
  const fallbackTheme = CAPTURE_BALL_THEME_PRESETS[themeKey] || CAPTURE_BALL_THEME_PRESETS[DEFAULT_CAPTURE_BALL_API_NAME];
  return {
    name: safeStr(source?.name || source?.backpack_name || "Poké Ball") || "Poké Ball",
    api_name: apiName,
    icon_url: _getCaptureBallIconUrl(source || { api_name: apiName }) || DEFAULT_CAPTURE_BALL_ICON_URL,
    backpack_name: safeStr(source?.backpack_name || source?.name || "Poké Ball") || "Poké Ball",
    category: safeStr(source?.category || "pokeballs") || "pokeballs",
    themeKey,
    theme: fallbackTheme,
  };
}

function getCaptureBallTheme(rawBall) {
  const ball = normalizeCaptureBall(rawBall);
  const theme = ball?.theme || CAPTURE_BALL_THEME_PRESETS[DEFAULT_CAPTURE_BALL_API_NAME];
  return {
    ball,
    topA: theme.topA,
    topB: theme.topB,
    bottomA: theme.bottomA,
    bottomB: theme.bottomB,
    band: theme.band,
    core: theme.core,
    coreRing: theme.coreRing,
    glow: theme.glow,
    accent: theme.accent,
    outline: theme.outline,
  };
}

function getCaptureBallCssVarMap(rawBall) {
  const theme = getCaptureBallTheme(rawBall);
  return {
    "--ball-top-a": theme.topA,
    "--ball-top-b": theme.topB,
    "--ball-bottom-a": theme.bottomA,
    "--ball-bottom-b": theme.bottomB,
    "--ball-band": theme.band,
    "--ball-core": theme.core,
    "--ball-core-ring": theme.coreRing,
    "--ball-glow": theme.glow,
    "--ball-accent": theme.accent,
    "--ball-outline": theme.outline,
  };
}

function _cssVarStyleAttr(rawVars) {
  return Object.entries(rawVars || {})
    .filter(([, value]) => value != null && String(value) !== "")
    .map(([key, value]) => `${key}:${String(value)}`)
    .join(";");
}

function applyCaptureBallThemeToElement(el, rawBall) {
  if (!el) return normalizeCaptureBall(rawBall);
  const ball = normalizeCaptureBall(rawBall);
  const vars = getCaptureBallCssVarMap(rawBall);
  for (const [key, value] of Object.entries(vars)) {
    el.style.setProperty(key, value);
  }
  const apiName = safeStr(ball?.api_name || DEFAULT_CAPTURE_BALL_API_NAME);
  if (apiName) {
    try { el.setAttribute("data-capture-ball", apiName); } catch {}
  }
  return ball;
}

// ─────────────────────────────────────────────────────────────────────────────
// Negative-condition visual FX helpers
// Maps a piece's current conditions to a single "dominant" negative effect
// used to drive the looping battlefield aura animation.
// ─────────────────────────────────────────────────────────────────────────────
const _NEGATIVE_CONDITION_PRIORITY = [
  "freeze", "sleep", "asleep", "paralyze", "paralyzed", "burn",
  "poison", "confusion", "fearful", "panicked", "insane",
  "bound", "restrained", "immobile", "prone", "blind", "deaf",
  "stunned", "dazed", "hindered", "vulnerable", "defenseless",
  "impaired", "disabled", "compelled", "controlled", "entranced",
  "fatigued", "exhausted", "incapacitated", "transformed",
];

function _pieceDominantNegativeCondition(piece) {
  if (!piece || typeof piece !== "object") return "";
  const mm = piece.mm_conditions || {};
  const all = [];
  const pushList = (arr) => {
    if (Array.isArray(arr)) for (const id of arr) {
      const k = safeStr(id).toLowerCase();
      if (k) all.push(k);
    }
  };
  pushList(mm.deg3);
  pushList(mm.deg2);
  pushList(mm.deg1);
  pushList(piece.pokemon_conditions);
  if (!all.length) return "";
  for (const pref of _NEGATIVE_CONDITION_PRIORITY) {
    if (all.includes(pref)) return pref;
  }
  return all[0] || "generic";
}

function applyPieceConditionFxToElement(el, piece) {
  if (!el) return;
  const key = _pieceDominantNegativeCondition(piece);
  if (key) {
    if (el.getAttribute("data-negative-condition") !== key) {
      el.setAttribute("data-negative-condition", key);
    }
    el.classList.add("has-negative-condition");
  } else {
    if (el.hasAttribute("data-negative-condition")) el.removeAttribute("data-negative-condition");
    el.classList.remove("has-negative-condition");
  }
}

function renderCaptureBallBackdropHtml(rawBall) {
  const ball = normalizeCaptureBall(rawBall);
  const iconUrl = _getCaptureBallIconUrl(ball);
  if (!iconUrl) return "";
  return `
    <span class="slot-ball-mark" aria-hidden="true">
      <img src="${escapeAttr(iconUrl)}" alt="" loading="lazy" onerror="this.parentElement && (this.parentElement.style.display='none')"/>
    </span>
  `;
}

function _slugifyHeldItemName(value) {
  return safeStr(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function _extractHeldItemEffect(raw) {
  if (!raw) return "";
  const direct = safeStr(
    raw.effect ||
    raw.short_effect ||
    raw.shortEffect ||
    raw.description ||
    raw.desc ||
    raw.tooltip ||
    raw.flavor_text
  );
  if (direct) return direct;
  const entries = Array.isArray(raw.effect_entries) ? raw.effect_entries : [];
  const preferred = entries.find((entry) => safeStr(entry?.language?.name) === "en") || entries[0];
  return safeStr(preferred?.short_effect || preferred?.effect || "");
}

function _getHeldItemCacheKey(item) {
  return _slugifyHeldItemName(item?.api_name || item?.name || item?.backpack_name || "");
}

function _getHeldItemIconUrl(item) {
  const direct = safeStr(item?.icon_url || item?.iconUrl || item?.sprite_url || item?.image_url || "");
  if (direct) return direct;
  const apiName = _getHeldItemCacheKey(item);
  return apiName ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${apiName}.png` : "";
}

function _ensureHeldItemEffectLoaded(item) {
  const cacheKey = _getHeldItemCacheKey(item);
  if (!cacheKey) return;
  const cached = _heldItemEffectCache.get(cacheKey);
  if (typeof cached === "string" || cached) return;

  const pending = fetch(`https://pokeapi.co/api/v2/item/${encodeURIComponent(cacheKey)}`)
    .then((resp) => (resp.ok ? resp.json() : null))
    .then((json) => {
      const effect = _extractHeldItemEffect(json) || "Efeito indisponivel.";
      _heldItemEffectCache.set(cacheKey, effect);
      _queueHeldItemUiRefresh();
      return effect;
    })
    .catch(() => {
      const fallback = "Efeito indisponivel.";
      _heldItemEffectCache.set(cacheKey, fallback);
      _queueHeldItemUiRefresh();
      return fallback;
    });

  _heldItemEffectCache.set(cacheKey, pending);
}

function normalizeHeldItem(rawItem) {
  if (!rawItem) return null;
  const source = (typeof rawItem === "string") ? { name: rawItem } : rawItem;
  const cacheKey = _getHeldItemCacheKey(source);
  const cachedEffect = cacheKey && typeof _heldItemEffectCache.get(cacheKey) === "string"
    ? _heldItemEffectCache.get(cacheKey)
    : "";
  const item = {
    name: safeStr(source?.name || source?.backpack_name || source?.api_name || "Item"),
    api_name: cacheKey,
    icon_url: _getHeldItemIconUrl(source),
    backpack_name: safeStr(source?.backpack_name || ""),
    category: safeStr(source?.category || ""),
    effect: _extractHeldItemEffect(source) || cachedEffect,
  };
  if (!item.effect && item.api_name) _ensureHeldItemEffectLoaded(item);
  return item;
}

function getHeldItemForTrainerPid(trainerName, pidLike) {
  const snapshotEntry = getPartySnapshotEntryForTrainerPid(trainerName, pidLike);
  const snapshotItem = snapshotEntry?.held_item || snapshotEntry?.heldItem || null;
  if (snapshotItem) return normalizeHeldItem(snapshotItem);

  const partyEntry = _getPartyEntryForTrainerPid(trainerName, pidLike);
  const partyItem = partyEntry?.held_item || partyEntry?.heldItem || null;
  if (partyItem) return normalizeHeldItem(partyItem);

  const userData = _getUserDataForTrainer(trainerName);
  return normalizeHeldItem(_getHeldItemFromHubMeta(userData?.hub_pokemon_meta, pidLike));
}

function getCaptureBallForTrainerPid(trainerName, pidLike) {
  const snapshotEntry = getPartySnapshotEntryForTrainerPid(trainerName, pidLike);
  const snapshotBall = snapshotEntry?.capture_ball || snapshotEntry?.captureBall || null;
  if (snapshotBall) return normalizeCaptureBall(snapshotBall);

  const partyEntry = _getPartyEntryForTrainerPid(trainerName, pidLike);
  const partyBall = partyEntry?.capture_ball || partyEntry?.captureBall || null;
  if (partyBall) return normalizeCaptureBall(partyBall);

  const userData = _getUserDataForTrainer(trainerName);
  return normalizeCaptureBall(_getCaptureBallFromHubMeta(userData?.hub_pokemon_meta, pidLike));
}

function getHeldItemEffectText(rawItem) {
  const item = normalizeHeldItem(rawItem);
  if (!item) return "";
  if (item.effect) return item.effect;
  if (item.api_name) return "Carregando efeito...";
  return "Efeito indisponivel.";
}

function renderHeldItemBadgeHtml(rawItem, options = {}) {
  const item = normalizeHeldItem(rawItem);
  if (!item) return "";
  const effect = getHeldItemEffectText(item);
  const iconUrl = _getHeldItemIconUrl(item);
  const sizeClass = options.size ? `held-item-badge-${options.size}` : "held-item-badge-sm";
  const extraClass = safeStr(options.className || "");
  const title = [item.name, effect].filter(Boolean).join(" - ");
  return `
    <span class="held-item-badge ${sizeClass} ${extraClass}" tabindex="0" title="${escapeAttr(title)}">
      ${
        iconUrl
          ? `<img class="held-item-icon" src="${escapeAttr(iconUrl)}" alt="${escapeAttr(item.name)}" loading="lazy" onerror="this.onerror=null;this.style.display='none';this.nextElementSibling && (this.nextElementSibling.style.display='flex');"/>`
          : ""
      }
      <span class="held-item-fallback" ${iconUrl ? `style="display:none"` : ""}>i</span>
      <span class="held-item-tooltip" role="tooltip">
        <span class="held-item-tooltip-name">${escapeHtml(item.name)}</span>
        <span class="held-item-tooltip-effect">${escapeHtml(effect)}</span>
      </span>
    </span>
  `;
}

function renderHeldItemSummaryHtml(rawItem, options = {}) {
  const item = normalizeHeldItem(rawItem);
  if (!item) return "";
  const label = safeStr(options.label || "Item equipado");
  const effect = getHeldItemEffectText(item);
  return `
    <div class="held-item-row ${safeStr(options.className || "")}">
      ${renderHeldItemBadgeHtml(item, { size: options.size || "md" })}
      <div class="held-item-row-copy">
        <div class="held-item-row-label">${escapeHtml(label)}</div>
        <div class="held-item-row-name">${escapeHtml(item.name)}</div>
        <div class="held-item-row-effect">${escapeHtml(effect)}</div>
      </div>
    </div>
  `;
}

function renderPartyCard(it, ownerName) {
  const pid = safeStr(it?.pid || it?.pokemon?.id || it);
  const partySlot = _getPartySlot(it);
  const identity = partySlot ? { ...(it && typeof it === "object" ? it : {}), pid, party_slot: partySlot } : (it || pid);
  const name = displayNameFromPid(identity, { owner: ownerName }) || (pid.startsWith("EXT:") ? pid.slice(4) : `PID ${pid}`);
  const _psPartyCard = _getPartyStateEntry(ownerName, identity) || {};
  const spriteUrl = getSpriteUrlForPiece({ owner: ownerName, pid, party_slot: partySlot }, { type: "art", shiny: !!_psPartyCard.shiny });
  const mine = safeStr(ownerName) && safeStr(ownerName) === safeStr(appState.by);
  const p = findBoardPieceForTrainer(ownerName, identity);
  const onMap = !!p?.id;
  const isExt = pid.startsWith("EXT:");
  const megaState = _getBattleMegaStateForTrainerPid(ownerName, identity);
  const ps = _getPartyStateEntry(ownerName, identity) || {};
  const hp = getPartyHp(ownerName, identity);
  const maxHp = 6;
  const cond = Array.isArray(ps.cond) ? ps.cond : [];
  const hpUi = getHpUiState(hp);
  const hpPct = hpUi.pct;
  const hpCol = hpUi.color;
  const hpIcon = hpUi.icon;
  const card = document.createElement("div");
  card.className = "pvp-party-card";
  card.dataset.pid = pid;
  card.dataset.owner = ownerName;
  if (hp <= 0) card.classList.add("pvp-fainted");
  const imgHtml = spriteUrl
    ? `<img class="pvp-sprite" src="${escapeAttr(spriteUrl)}" alt="${escapeAttr(name)}" loading="lazy" onerror="this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'"/>`
    : `<div class="pvp-sprite pvp-sprite-fallback">?</div>`;
  const locBadge = onMap
    ? `<span class="pvp-loc-badge pvp-loc-field">⚔️</span>`
    : `<span class="pvp-loc-badge pvp-loc-bag">🎒</span>`;
  const condHtml = cond.length
    ? cond.slice(0, 3).map(c => `<span class="pvp-cond-pill">${escapeHtml(c)}</span>`).join("")
    : `<span class="pvp-no-cond">Sem status negativos.</span>`;
  const extBadge = isExt ? `<span class="pvp-ext-badge">EXT</span>` : "";
  const megaBadge = megaState?.activeMegaSlug ? `<span class="pvp-ext-badge">MEGA</span>` : "";
  const actionsHtml = mine ? `
    <div class="pvp-actions">
      <button class="pvp-btn" data-act="${onMap ? "select" : "place"}">${onMap ? "🎯 Selecionar" : (((partySlot && getPlacingPokemonPartySlot() === partySlot) || (!partySlot && getPlacingPokemonPid() === pid)) ? "📍 Clique no mapa" : "➕ Colocar")}</button>
      <button class="pvp-btn pvp-btn-icon" data-act="toggle"${onMap ? "" : " disabled"}>👁️</button>
      <button class="pvp-btn pvp-btn-icon pvp-btn-danger" data-act="remove"${onMap ? "" : " disabled"}>❌</button>
    </div>` : "";
  card.innerHTML = `
    <div class="pvp-card-row">
      <div class="pvp-sprite-wrap">
        ${imgHtml}
        ${locBadge}
      </div>
      <div class="pvp-card-info">
        <div class="pvp-card-name">${escapeHtml(name)} ${megaBadge}${extBadge}</div>
        <div class="pvp-card-sub">PID ${escapeHtml(pid)} &bull; ${onMap ? "No campo" : "Mochila"}</div>
        <div class="pvp-hp-row">
          <span class="pvp-hp-icon">${hpIcon}</span>
          <div class="pvp-hp-track" style="--hp-pct:${hpPct}%;--hp-col:${hpCol};"></div>
          <span class="pvp-hp-label">${hp}/${maxHp}</span>
        </div>
        <div class="pvp-cond-row">${condHtml}</div>
      </div>
    </div>
    ${actionsHtml}
  `;
  card.addEventListener("click", (ev) => {
    if (ev.target.closest("button")) return;
    if (p?.id) selectPiece(String(p.id));
  });
  card.querySelector('[data-act="select"]')?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (p?.id) selectPiece(String(p.id));
    else setStatus("warn", "esse Pokemon nao esta no campo");
  });
  card.querySelector('[data-act="place"]')?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    // toggle: clicar na mesma pokébola desarma
    if ((partySlot && getPlacingPokemonPartySlot() === partySlot) || (!partySlot && getPlacingPokemonPid() === pid)) {
      clearPokemonPlacingMode();
      updateSidePanels();
      setStatus("ok", "posicionamento cancelado");
      return;
    }
    startPlacePokemon(identity);
    updateSidePanels();
  });
  card.querySelector('[data-act="toggle"]')?.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    if (p?.id) await togglePieceRevealed(String(p.id));
  });
  card.querySelector('[data-act="remove"]')?.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    if (p?.id) await removePieceFromBoard(String(p.id));
  });
  return card;
}

// ── Boost temporário de stat (dura enquanto o pokémon está em campo) ────────
async function updateStatBoost(ownerName, pid, stat, delta) {
  const db  = currentDb;
  const rid = currentRid;
  const trainer = safeStr(ownerName);
  const monPid  = safeStr(pid);
  const statKey = safeStr(stat).trim().toLowerCase();
  const step = Number(delta);
  if (!db || !rid || !trainer || !monPid || !statKey || !Number.isFinite(step) || step === 0) return 0;

  const psRef = doc(db, "rooms", rid, "public_state", "party_states");
  let newVal = 0;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(psRef);
    const data = snap.exists() ? snap.data() : {};
    const psData = data?.[trainer]?.[monPid]?.stat_boosts || {};
    const current = Number(psData[statKey] || 0);
    newVal = current + step;
    const patch = { [trainer]: { [monPid]: { stat_boosts: { [statKey]: newVal === 0 ? null : newVal } } } };
    tx.set(psRef, patch, { merge: true });
  });

  const root = (_partyStates && typeof _partyStates === "object") ? _partyStates : {};
  const bucket = root[trainer] && typeof root[trainer] === "object" ? root[trainer] : {};
  const monState = bucket[monPid] && typeof bucket[monPid] === "object" ? { ...bucket[monPid] } : {};
  const boosts = monState.stat_boosts && typeof monState.stat_boosts === "object" ? { ...monState.stat_boosts } : {};
  if (newVal === 0) delete boosts[statKey];
  else boosts[statKey] = newVal;
  monState.stat_boosts = Object.keys(boosts).length ? boosts : null;
  root[trainer] = { ...bucket, [monPid]: monState };
  _partyStates = root;
  try { window._partyStates = _partyStates; } catch {}
  return newVal;
}
// ────────────────────────────────────────────────────────────────────────────

function _trainerUidForGlobalHp(ownerName) {
  const trainer = safeStr(ownerName);
  if (!trainer) return "";
  if (_trainerLookupKey(trainer) === _trainerLookupKey(appState.by)) {
    return getSelfFirebaseAuthUid() || safeStr(appState.selfTrainerId);
  }
  const candidates = getTrainerCandidateIds(trainer);
  for (const uid of candidates) {
    const entry = appState.userProfiles?.get?.(uid);
    if (entry?.hubPokemonEntries) return uid;
  }
  return safeDocId(trainer);
}

function _touchLocalGlobalHpCache(ownerName, entryId, pid, hp) {
  const trainer = safeStr(ownerName);
  const eid = safeStr(entryId);
  if (!trainer || !eid) return;
  const payload = { entry_id: eid, pid: safeStr(pid), hp: clampPartyHp(hp, 6) };
  const candidates = getTrainerCandidateIds(trainer);
  if (!candidates.includes(safeDocId(trainer))) candidates.push(safeDocId(trainer));
  for (const uid of candidates) {
    const cur = appState.userProfiles.get(uid) || {};
    const entries = cur.hubPokemonEntries && typeof cur.hubPokemonEntries === "object" ? cur.hubPokemonEntries : {};
    cur.hubPokemonEntries = { ...entries, [eid]: { ...(entries[eid] || {}), ...payload } };
    appState.userProfiles.set(uid, cur);
  }
  appState.globalHpRevision = (Number(appState.globalHpRevision) || 0) + 1;
  window.__globalHpRevision = appState.globalHpRevision;
}

function _touchLocalRoomHpCache(ownerName, stateKey, hp) {
  const trainer = safeStr(ownerName);
  const key = safeStr(stateKey);
  if (!trainer || !key) return;
  const root = (_partyStates && typeof _partyStates === "object") ? _partyStates : {};
  const bucket = root[trainer] && typeof root[trainer] === "object" ? root[trainer] : {};
  root[trainer] = { ...bucket, [key]: { ...(bucket[key] || {}), hp: clampPartyHp(hp, 6) } };
  _partyStates = root;
  try { window._partyStates = _partyStates; } catch {}
}

function _roomPartyStateHpKey(resolved) {
  return safeStr(resolved?.entryId || resolved?.partySlot || resolved?.pid);
}

function _isPartyPidUnambiguous(ownerName, resolved) {
  const pid = normalizePartyPid(resolved?.pid);
  if (!pid) return false;
  const party = getPartyForTrainer(ownerName);
  if (!Array.isArray(party) || !party.length) return true;
  const matches = party.filter((entry) => normalizePartyPid(entry?.pid ?? entry?.pokemon?.id ?? entry) === pid);
  return matches.length <= 1;
}

async function _writeRoomPartyStateHp(ownerName, resolved, hp) {
  const db = currentDb;
  const rid = currentRid;
  const trainer = safeStr(ownerName);
  const stateKey = _roomPartyStateHpKey(resolved);
  if (!db || !rid || !trainer || !stateKey) return false;

  const payload = {
    hp: clampPartyHp(hp, 6),
    hpUpdatedAt: serverTimestamp(),
  };
  if (safeStr(resolved?.pid)) payload.pid = safeStr(resolved.pid);
  if (safeStr(resolved?.entryId)) payload.entry_id = safeStr(resolved.entryId);
  if (safeStr(resolved?.partySlot)) payload.party_slot = safeStr(resolved.partySlot);

  const psRef = doc(db, "rooms", rid, "public_state", "party_states");
  const trainerPatch = { [stateKey]: payload };
  const pidAlias = safeStr(resolved?.pid);
  if (pidAlias && pidAlias !== stateKey && _isPartyPidUnambiguous(trainer, resolved)) {
    trainerPatch[pidAlias] = { ...payload };
  }
  await setDoc(psRef, { [trainer]: trainerPatch }, { merge: true });
  _touchLocalRoomHpCache(trainer, stateKey, payload.hp);
  if (pidAlias && pidAlias !== stateKey && trainerPatch[pidAlias]) {
    _touchLocalRoomHpCache(trainer, pidAlias, payload.hp);
  }
  return true;
}

async function updatePartyStateHp(ownerName, pidLike, hp) {
  const db = currentDb;
  const trainer = safeStr(ownerName);
  if (!db || !trainer) return;
  if (safeStr(appState.by) !== trainer) {
    setStatus("warn", "apenas o dono do Pokemon pode alterar o HP");
    return;
  }
  const resolved = _resolvePartyEntryIdentity(trainer, pidLike);
  const monPid = safeStr(resolved.pid || pidLike?.pid || pidLike?.pokemon?.id || pidLike);
  const entryId = safeStr(resolved.entryId);
  if (!monPid) {
    setStatus("err", "HP indisponivel: Pokemon sem identificador");
    return;
  }
  const newHp = clampPartyHp(hp, 6);
  if (!entryId) {
    try {
      if (await _writeRoomPartyStateHp(trainer, resolved, newHp)) {
        setStatus("warn", `HP atualizado nesta sala: ${newHp}/6 (entry_id ausente)`);
        try { renderSheetsTab(); } catch {}
        try { updateSidePanels(); } catch {}
        try { window.requestScoreboardRefresh?.(); } catch {}
        try { requestArenaRefresh(true); } catch {}
        return;
      }
    } catch (fallbackErr) {
      console.warn("[hp-room] falha ao salvar HP na sala:", fallbackErr);
    }
    setStatus("err", "HP indisponivel: nao foi possivel salvar na sala");
    return;
  }
  const uid = _trainerUidForGlobalHp(trainer);
  if (!uid) {
    try {
      if (await _writeRoomPartyStateHp(trainer, resolved, newHp)) {
        setStatus("warn", `HP atualizado nesta sala: ${newHp}/6 (login Firebase sem UID global)`);
        try { renderSheetsTab(); } catch {}
        try { updateSidePanels(); } catch {}
        try { window.requestScoreboardRefresh?.(); } catch {}
        try { requestArenaRefresh(true); } catch {}
        return;
      }
    } catch (fallbackErr) {
      console.warn("[hp-room] falha ao salvar HP na sala:", fallbackErr);
    }
    setStatus("err", "HP global indisponivel: login Firebase sem UID");
    return;
  }
  const ref = doc(db, "users", uid, "trainer_hub", "pokemon_meta");
  const patch = {
    entries: {
      [entryId]: {
        entry_id: entryId,
        pid: monPid,
        hp: newHp,
        hpUpdatedAt: serverTimestamp(),
      },
    },
    updatedAt: serverTimestamp(),
  };
  try {
    await setDoc(ref, patch, { merge: true });
  } catch (e) {
    try {
      if (await _writeRoomPartyStateHp(trainer, resolved, newHp)) {
        console.warn("[hp-global] falha ao salvar HP global; usando HP da sala:", e);
        setStatus("warn", `HP atualizado nesta sala: ${newHp}/6 (global bloqueado pelas regras)`);
        try { renderSheetsTab(); } catch {}
        try { updateSidePanels(); } catch {}
        try { window.requestScoreboardRefresh?.(); } catch {}
        try { requestArenaRefresh(true); } catch {}
        return;
      }
    } catch (fallbackErr) {
      console.warn("[hp-room] falha ao salvar HP na sala:", fallbackErr);
    }
    console.error("[hp-global] falha ao salvar HP:", e);
    setStatus("err", `falha ao salvar HP global: ${e?.message || e?.code || "erro desconhecido"}`);
    return;
  }
  _touchLocalGlobalHpCache(trainer, entryId, monPid, newHp);
  try { await _writeRoomPartyStateHp(trainer, resolved, newHp); } catch (roomErr) {
    console.warn("[hp-room] falha ao espelhar HP na sala:", roomErr);
  }
  setStatus("ok", `HP atualizado: ${newHp}/6`);
  try { renderSheetsTab(); } catch {}
  try { updateSidePanels(); } catch {}
  try { window.requestScoreboardRefresh?.(); } catch {}
  try { requestArenaRefresh(true); } catch {}
}

function _renderTrainerRpgListHtml(items, emptyText) {
  const lines = Array.isArray(items) ? items.map((item) => safeStr(item)).filter(Boolean) : [];
  if (!lines.length) return `<div class="muted">${escapeHtml(emptyText)}</div>`;
  return `
    <div class="trainer-rpg-list">
      ${lines.map((item) => `<div class="trainer-rpg-line">&bull; ${escapeHtml(item)}</div>`).join("")}
    </div>
  `;
}

function _renderTrainerArenaSheetPreview(root, piece) {
  const owner = safeStr(piece?.owner) || safeStr(appState.by);
  const ownerLabel = humanizeInternalLabel(owner) || owner || "Treinador";
  const sheet = getSelfTrainerRpgSheet();
  const trainerName = safeStr(sheet?.trainer_name || ownerLabel) || ownerLabel;
  const mediaSrc = getTrainerProfilePhotoSrc(owner, { allowAvatarFallback: true })
    || getTrainerAvatarSrc(owner, { allowProfileFallback: true })
    || getSpriteUrlForPiece(piece, { type: "art" })
    || trainerLetterDataUrl(owner);

  if (!sheet) {
    root.innerHTML = `
      <div class="arena-sheet-card">
        <div class="sheet-top">
          <img class="sheet-art" src="${escapeAttr(mediaSrc)}" alt="${escapeAttr(trainerName)}" />
          <div style="flex:1;min-width:0;">
            <div class="sheet-name">${escapeHtml(trainerName)}</div>
            <div class="sheet-sub">${escapeHtml(ownerLabel)} &bull; Treinador em campo</div>
          </div>
        </div>
        <div class="muted" style="margin-top:8px">Ficha RPG do treinador ainda não disponível.</div>
      </div>
    `;
    return;
  }

  const stats = _normalizeTrainerRpgStats(sheet.stats);
  const skillsHtml = _renderTrainerRpgListHtml(sheet.skills, "Sem skills.");
  const advantagesHtml = _renderTrainerRpgListHtml(sheet.advantages, "Sem advantages.");

  root.innerHTML = `
    <div class="arena-sheet-card">
      <div class="sheet-top">
        <img class="sheet-art" src="${escapeAttr(mediaSrc)}" alt="${escapeAttr(trainerName)}" />
        <div style="flex:1;min-width:0;">
          <div class="sheet-name">${escapeHtml(trainerName)}</div>
          <div class="sheet-sub">${escapeHtml(ownerLabel)} &bull; Treinador em campo</div>
        </div>
      </div>
      <div class="stat-grid">
        <div class="stat-box"><div class="stat-label">Stgr</div><div class="stat-val">${stats.stgr}</div></div>
        <div class="stat-box"><div class="stat-label">Int</div><div class="stat-val">${stats.int}</div></div>
        <div class="stat-box"><div class="stat-label">Thg</div><div class="stat-val">${stats.thg}</div></div>
        <div class="stat-box"><div class="stat-label">Dodge</div><div class="stat-val">${stats.dodge}</div></div>
        <div class="stat-box"><div class="stat-label">Parry</div><div class="stat-val">${stats.parry}</div></div>
        <div class="stat-box"><div class="stat-label">Fort</div><div class="stat-val">${stats.fortitude}</div></div>
        <div class="stat-box"><div class="stat-label">Will</div><div class="stat-val">${stats.will}</div></div>
      </div>
      <div class="section-title">Skills</div>
      ${skillsHtml}
      <div class="section-title">Advantages</div>
      ${advantagesHtml}
    </div>
  `;
}

function renderArenaSheetPreview() {
  const root = $("arena_sheet_preview");
  if (!root) return;
  const selId = safeStr(appState.selectedPieceId);
  if (!selId) {
    root.innerHTML = `<div class="arena-sheet-card"><div class="muted">Clique em um pokémon na arena para abrir a ficha resumida.</div></div>`;
    return;
  }

  const piece = (appState.pieces || []).find((item) => safeStr(item?.id) === selId) || null;
  if (!piece || !isPieceVisibleToMe(piece)) {
    root.innerHTML = `<div class="arena-sheet-card"><div class="muted">A peça selecionada não está visível.</div></div>`;
    return;
  }

  if (isTrainerPiece(piece) && isPieceMine(piece)) {
    _renderTrainerArenaSheetPreview(root, piece);
    return;
  }

  const owner = safeStr(piece?.owner);
  const pid = safeStr(piece?.pid);
  const isMine = isPieceMine(piece);
  const sheet = isMine ? getSheetForPiece(piece) : null;
  const pkm = sheet?.pokemon || {};
  const ctx = _getEffectivePokemonContext(owner, piece, { piece, sheet });
  const name = safeStr(ctx?.displayName || displayNameFromPiece(piece, { allowHiddenIdentity: true, isMine })) || "Pokémon";
  const ownerLabel = humanizeInternalLabel(owner) || owner || "—";
  const spriteState = _getPartyStateEntry(owner, pid) || {};
  const sprite = getSpriteUrlForPiece(piece, { type: "art", shiny: !!spriteState.shiny })
    || getSpriteFallbackUrlForPiece(piece)
    || "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png";
  const hpUi = getHpUiState(getPartyHp(owner, piece));
  const types = (ctx?.resolvedTypes?.length ? ctx.resolvedTypes : getResolvedTypesForTrainerPid(owner, piece, { piece, sheet })) || [];
  const typeHtml = (types || []).map((type) => {
    const color = getTypeColor(type);
    return `<span class="chip" style="border-color:${color}66;color:${color};background:${color}22;">${escapeHtml(type)}</span>`;
  }).join("");
  const moveBudget = getPieceMovementBudget(piece);
  const moveSummary = `Velocidade ${moveBudget.speed} • deslocamento ${moveBudget.maxTiles % 1 ? "1/2" : moveBudget.maxTiles} quadrado(s)`;
  const stateBucket = sheet ? _getPartyStateForSheet(owner, sheet, piece) : spriteState;
  const cond = Array.isArray(stateBucket?.cond) ? stateBucket.cond : [];
  const condHtml = cond.length
    ? `<div class="chip-row">${cond.slice(0, 4).map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}</div>`
    : "";

  if (!sheet) {
    root.innerHTML = `
      <div class="arena-sheet-card">
        <div class="sheet-top">
          <img class="sheet-art" src="${escapeAttr(sprite)}" alt="${escapeAttr(name)}" />
          <div style="flex:1;min-width:0;">
            <div class="sheet-name">${escapeHtml(name)}</div>
            <div class="sheet-sub">${escapeHtml(ownerLabel)} • ${escapeHtml(pid || "—")}</div>
            <div class="chip-row">${typeHtml || `<span class="muted">Tipo indisponível</span>`}</div>
          </div>
        </div>
        <div class="hp-row"><span>HP</span><span>${hpUi.value}/6</span></div>
        <div class="hp-track"><div class="hp-fill" style="width:${hpUi.pct}%;background:${hpUi.color};"></div></div>
        ${condHtml}
        <div class="section-title">Resumo</div>
        <div class="muted">${escapeHtml(moveSummary)}</div>
        <div class="muted" style="margin-top:8px">${isMine ? "Ficha não encontrada para esta peça." : "Ficha completa privada. Apenas o resumo da arena está disponível."}</div>
      </div>
    `;
    return;
  }

  const pidLabel = _sheetDisplayPid(sheet, sheet?._party_pid_raw || pid) || pid || "—";
  const np = safeInt(sheet?.np ?? pkm?.np ?? 0, 0);
  const abilities = (ctx?.resolvedAbilities?.length ? ctx.resolvedAbilities : getResolvedAbilitiesForTrainerPid(owner, piece, { piece, sheet })) || [];
  const st = sheet?.stats || {};
  const stgr = safeInt(st.stgr, 0);
  const intel = safeInt(st.int, 0);
  let thg = safeInt(st.thg, 0);
  let dodge = safeInt(st.dodge, 0);
  const parry = safeInt(st.parry, 0);
  const fort = safeInt(st.fortitude ?? st.fort, 0);
  const will = safeInt(st.will, 0);
  const cap = np * 2;
  if (thg <= 0 && cap > 0) thg = Math.round(cap / 2);
  if (dodge <= 0 && cap > 0 && thg > 0) dodge = Math.max(0, cap - thg);
  const heldItem = getHeldItemForTrainerPid(owner, pid || name);
  const movesRaw = Array.isArray(sheet?.moves) ? sheet.moves : (sheet?.moves ? Object.values(sheet.moves) : []);
  const moves = _getPreferredMovesForTrainerPid(owner, pid || name, movesRaw, 4);
  const movesHtml = moves.length
    ? moves.map((mv) => {
        const moveName = _moveNameValue(mv);
        const { rk, area } = _mvSum(mv, st);
        const mvType = getMoveType(moveName) || safeStr(mv?.meta?.type) || safeStr(mv?.type) || "";
        const mvColor = mvType ? getTypeColor(mvType) : "";
        const typeTag = mvType ? `<span class="mv-pill" style="background:${mvColor}22;border:1px solid ${mvColor}66;color:${mvColor}">${escapeHtml(mvType)}</span>` : "";
        const modePill = _renderMoveModePill(mv, { compact: true });
        return `
          <div class="move-row">
            <div class="move-head">
              <span class="move-name">${escapeHtml(moveName)}</span>
              ${typeTag}
              <span class="mv-pill rk">R${rk}</span>
              <span class="mv-pill">${area ? "Área" : "Alvo"}</span>
            </div>
          </div>
        `;
      }).join("")
    : `<div class="muted">Sem golpes nesta ficha.</div>`;

  const skills = Array.isArray(sheet?.skills) ? sheet.skills : [];
  const skillChips = skills
    .filter((x) => x && typeof x === "object" && safeStr(x.name) && parseInt(x.ranks || 0))
    .map((x) => `<span class="chip">${escapeHtml(x.name)} R${parseInt(x.ranks || 0)}</span>`);
  const skillsHtml = skillChips.length
    ? `<div class="chip-row">${skillChips.join("")}</div>`
    : `<span class="muted">Sem skills.</span>`;

  const advantages = Array.isArray(sheet?.advantages) ? sheet.advantages : [];
  const advChips = advantages.filter((a) => safeStr(a)).map((a) => `<span class="chip">${escapeHtml(a)}</span>`);
  const advsHtml = advChips.length
    ? `<div class="chip-row">${advChips.join("")}</div>`
    : `<span class="muted">Sem advantages.</span>`;

  root.innerHTML = `
    <div class="arena-sheet-card">
      <div class="sheet-top">
        <img class="sheet-art" src="${escapeAttr(sprite)}" alt="${escapeAttr(name)}" />
        <div style="flex:1;min-width:0;">
          <div class="sheet-name">${escapeHtml(name)}</div>
          <div class="sheet-sub">#${escapeHtml(pidLabel)} • NP ${np}</div>
          <div class="chip-row">${typeHtml || `<span class="muted">Sem tipo</span>`}</div>
        </div>
      </div>
      ${abilities.length ? `<div class="chip-row">${abilities.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}</div>` : ""}
      ${renderHeldItemSummaryHtml(heldItem, { label: "Item", size: "sm" })}
      <div class="hp-row"><span>HP</span><span>${hpUi.value}/6</span></div>
      <div class="hp-track"><div class="hp-fill" style="width:${hpUi.pct}%;background:${hpUi.color};"></div></div>
      ${condHtml}
      <div class="muted" style="margin-top:8px">${escapeHtml(moveSummary)}</div>
      <div class="stat-grid">
        <div class="stat-box"><div class="stat-label">Stgr</div><div class="stat-val">${stgr}</div></div>
        <div class="stat-box"><div class="stat-label">Int</div><div class="stat-val">${intel}</div></div>
        <div class="stat-box"><div class="stat-label">Thg</div><div class="stat-val">${thg}</div></div>
        <div class="stat-box"><div class="stat-label">Dodge</div><div class="stat-val">${dodge}</div></div>
        <div class="stat-box"><div class="stat-label">Parry</div><div class="stat-val">${parry}</div></div>
        <div class="stat-box"><div class="stat-label">Fort</div><div class="stat-val">${fort}</div></div>
        <div class="stat-box"><div class="stat-label">Will</div><div class="stat-val">${will}</div></div>
        <div class="stat-box cap"><div class="stat-label">Cap</div><div class="stat-val">${cap}</div></div>
      </div>
      <div class="section-title">Skills</div>
      ${skillsHtml}
      <div class="section-title">Advantages</div>
      ${advsHtml}
      <div class="section-title">Golpes</div>
      ${movesHtml}
    </div>
  `;
  root.querySelectorAll(".move-row").forEach((row, idx) => {
    const mv = moves[idx];
    if (!mv) return;
    const pills = Array.from(row.querySelectorAll(".mv-pill"));
    const statusPill = pills[pills.length - 1];
    if (statusPill) statusPill.outerHTML = _renderMoveModePill(mv, { compact: true });
  });
}


function renderPartyWindow() {
  const root = $("party_window");
  if (!root) return;
  const by = safeStr(appState.by);
  const party = by ? getPartyForTrainer(by) : [];
  const placingPid = getPlacingPokemonPid();
  const placingSlot = getPlacingPokemonPartySlot();

  const slots = [];
  for (let i = 0; i < 8; i++) slots.push(party[i] || null);
  root.innerHTML = slots.map((entry, idx) => {
    const pid = safeStr(entry?.pid || entry || "");
    if (!pid) return `<button type="button" class="party-slot empty" data-slot="${idx}" disabled></button>`;
    const partySlot = _getPartySlot(entry, idx);
    const identity = partySlot ? { ...(entry && typeof entry === "object" ? entry : {}), pid, party_slot: partySlot } : (entry || pid);
    const _psSlot = ((_partyStates && _partyStates[by]) ? _partyStates[by] : {})[pid] || {};
    const sprite = getEffectiveSpriteUrlForTrainerPid(by, identity, { type: "art", shiny: !!_psSlot.shiny }) || getSpriteUrlFromPid(pid);
    const heldItem = getHeldItemForTrainerPid(by, entry || pid);
    const captureBall = getCaptureBallForTrainerPid(by, entry || pid);
    const captureBallStyle = _cssVarStyleAttr(getCaptureBallCssVarMap(captureBall));
    const captureBallLabel = safeStr(captureBall?.name || "Poké Ball") || "Poké Ball";
    const hp = getPartyHp(by, identity);
    const ko = hp <= 0;
    const onBoard = isPokemonAlreadyOnBoard(by, identity);
    const placing = (partySlot && placingSlot === partySlot) || (!partySlot && placingPid && placingPid === pid);
    const disabled = ko && !onBoard;
    return `<button type="button" class="party-slot ${ko ? 'ko' : ''} ${placing ? 'placing' : ''}" data-slot="${idx}" data-pid="${escapeAttr(pid)}" data-entry-id="${escapeAttr(_getEntryId(entry))}" data-party-slot="${escapeAttr(partySlot)}" data-capture-ball="${escapeAttr(captureBall?.api_name || DEFAULT_CAPTURE_BALL_API_NAME)}" title="${escapeAttr(captureBallLabel)}" style="${escapeAttr(captureBallStyle)}" ${disabled ? 'disabled' : ''}>
      ${renderCaptureBallBackdropHtml(captureBall)}
      ${renderHeldItemBadgeHtml(heldItem, { className: "held-item-anchor-slot", size: "sm" })}
      ${sprite ? `<img class="party-slot-sprite" src="${escapeAttr(sprite)}" alt="${escapeAttr(pid)}" loading="lazy" onerror="this.style.display='none'"/>` : ''}
    </button>`;
  }).join('');

  if (root.dataset.bound === "1") return;
  root.dataset.bound = "1";
  root.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.(".party-slot[data-pid]");
    if (!btn) return;
    const pid = safeStr(btn.dataset.pid);
    const entryId = safeStr(btn.dataset.entryId);
    const partySlot = _normalizePartySlot(btn.dataset.partySlot);
    const identity = { pid, entry_id: entryId, party_slot: partySlot || "" };
    if (!pid) return;

    const ownerName = safeStr(appState.by);

    const activePieceId = getActivePieceIdForPokemon(ownerName, identity);
    if (activePieceId) {
      removePieceFromBoard(activePieceId);
      return;
    }

    if ((partySlot && getPlacingPokemonPartySlot() === partySlot) || (!partySlot && getPlacingPokemonPid() === pid)) {
      clearPokemonPlacingMode();
      updateSidePanels();
      setStatus("ok", "posicionamento cancelado");
      return;
    }

    startPlacePokemon(identity);
  });
}

function renderSelectedControlsCard() {
  const card = document.createElement("div");
  card.className = "card";
  const selId = safeStr(appState.selectedPieceId);

  if (!selId) {
    card.innerHTML = `
      <div style="font-weight:950;margin-bottom:6px">Selecionado</div>
      <div class="muted">Clique em um token no mapa ou em um card para selecionar.</div>
      <div class="tiny" style="margin-top:10px">Mover: clique no destino (ou arraste o token). Ocultar/Retirar aparecem quando houver seleção.</div>
    `;
    return card;
  }

  const p = (appState.pieces || []).find((x) => safeStr(x?.id) === selId) || null;
  if (!p) {
    card.innerHTML = `
      <div style="font-weight:950;margin-bottom:6px">Selecionado</div>
      <div class="muted">Peça não encontrada no state (talvez foi removida).</div>
    `;
    return card;
  }

  const mine = isPieceMine(p);
  const revealed = p?.revealed != null ? !!p.revealed : true;
  const row = Number(p?.row);
  const col = Number(p?.col);
  const ownerLabel = humanizeInternalLabel(safeStr(p?.owner)) || safeStr(p?.owner) || "—";
  const displayName = displayNameFromPiece(p, { allowHiddenIdentity: false, isMine: mine });
  const kind = pieceTypeLabel(p);
  const pid = displayName;

  const title = mine ? "🎒 Sua peça" : "🆚 Peça do oponente";
  const _psOwner1 = ((_partyStates && _partyStates[safeStr(p?.owner)]) ? _partyStates[safeStr(p?.owner)] : {})[safeStr(p?.pid)] || {};
  const spriteUrl = getSpriteUrlForPiece(p, { type: "art", shiny: !!_psOwner1.shiny });
  const spriteFallbackUrl = getSpriteFallbackUrlForPiece(p);

  card.innerHTML = `
    <div class="row spread" style="align-items:flex-start; gap:10px">
      <div class="row" style="gap:10px;align-items:flex-start">
        ${
          spriteUrl
            ? `<img class="mini" src="${escapeAttr(spriteUrl)}" alt="sprite" loading="lazy" data-fallback="${escapeAttr(spriteFallbackUrl)}" onerror="if(this.dataset.fallback && this.src!==this.dataset.fallback){this.src=this.dataset.fallback;}else{this.style.display='none'}"/>`
            : `<div class="avatar" style="width:40px;height:40px;border-radius:14px">#</div>`
        }
        <div style="min-width:0">
          <div style="font-weight:950;line-height:1.1">${escapeHtml(title)}</div>
          <div class="tiny">${escapeHtml(displayName)}</div>
          <div class="tiny">owner: <span class="mono">${escapeHtml(safeStr(p?.owner) || "—")}</span> • kind: <span class="mono">${escapeHtml(kind)}</span></div>
          <div class="tiny">pid: <span class="mono">${escapeHtml(pid)}</span> • pos: <span class="mono">(${Number.isFinite(row)?row:"?"}, ${Number.isFinite(col)?col:"?"})</span></div>
          <div class="tiny">revelado: <span class="mono">${revealed ? "sim" : "não"}</span></div>
        </div>
      </div>
    </div>

    <div class="row" style="gap:10px;margin-top:10px;flex-wrap:wrap">
      <button class="btn ghost" data-act="move" title="Mover (clique/arraste no mapa)">🚶 Mover</button>
      <button class="btn ghost" data-act="toggle" ${mine ? "" : "disabled"} title="Revelar/Esconder">👁️ ${revealed ? "Ocultar" : "Revelar"}</button>
      <button class="btn ghost" data-act="remove" ${mine ? "" : "disabled"} title="Retirar do campo">❌ Retirar</button>
    </div>

    <div class="tiny muted" style="margin-top:8px">
      Dica: para mover, arraste o token ou selecione e clique no tile destino.
    </div>
  `;

  card.querySelector('[data-act="move"]')?.addEventListener("click", () => {
    // Só uma dica visual (o mapa já permite mover ao clicar/arrastar)
    setStatus("ok", "mover: clique no tile destino (ou arraste)");
  });

  card.querySelector('[data-act="toggle"]')?.addEventListener("click", async () => {
    await togglePieceRevealed(selId);
  });

  card.querySelector('[data-act="remove"]')?.addEventListener("click", async () => {
    await removePieceFromBoard(selId);
  });

  return card;
}


// ─────────────────────────────────────────────────────────────────────────────
// Inspector — Condições (tracking) — usa afflictions.json
// - M&M: conditions_mm (cada condição tem id, name_pt/en, what_it_does_pt, mechanics_pt)
// - Pokémon: pokemon_status_builds (id, name_pt, rules_pt, etc.)
// Persistência: public_state/state.pieces[*].mm_conditions / pokemon_conditions
// ─────────────────────────────────────────────────────────────────────────────

let _AFFLICTIONS_CATALOG = null;
let _AFFLICTIONS_CATALOG_PROMISE = null;

async function _loadAfflictionsCatalogOnce() {
  if (_AFFLICTIONS_CATALOG) return _AFFLICTIONS_CATALOG;
  if (_AFFLICTIONS_CATALOG_PROMISE) return _AFFLICTIONS_CATALOG_PROMISE;
  _AFFLICTIONS_CATALOG_PROMISE = (async () => {
    // OBS: este arquivo precisa estar acessível pelo servidor (mesma pasta pública do main.js)
    const res = await fetch("./afflictions.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`afflictions.json HTTP ${res.status}`);
    const j = await res.json();
    _AFFLICTIONS_CATALOG = j;
    return j;
  })();
  return _AFFLICTIONS_CATALOG_PROMISE;
}

function _getPieceMmConditions(p) {
  const mm = (p && typeof p === "object") ? p.mm_conditions : null;
  return {
    deg1: Array.isArray(mm?.deg1) ? mm.deg1.map(safeStr).filter(Boolean) : [],
    deg2: Array.isArray(mm?.deg2) ? mm.deg2.map(safeStr).filter(Boolean) : [],
    deg3: Array.isArray(mm?.deg3) ? mm.deg3.map(safeStr).filter(Boolean) : [],
  };
}

function _getPiecePokemonConditions(p) {
  return Array.isArray(p?.pokemon_conditions) ? p.pokemon_conditions.map(safeStr).filter(Boolean) : [];
}

function renderConditionInfoPlaceholder() {
  return `
    <div class="ins-conds-info-empty">
      Passe o mouse ou selecione uma condição para ver o efeito e a regra aplicada.
    </div>
  `;
}

function renderConditionInfoHtml(entry, { kind = "mm" } = {}) {
  if (!entry) return renderConditionInfoPlaceholder();
  const name = safeStr(entry?.name_pt) || safeStr(entry?.id) || "Condição";
  if (kind === "pkm") {
    const rules = Array.isArray(entry?.rules_pt) ? entry.rules_pt : [];
    return `
      <div class="ins-conds-info-title">${escapeHtml(name)}</div>
      <div class="ins-conds-info-copy">
        ${rules.length
          ? rules.map((rule) => `<div>${escapeHtml(String(rule))}</div>`).join("")
          : `<div>Sem regras detalhadas cadastradas.</div>`}
      </div>
    `;
  }
  const does = safeStr(entry?.what_it_does_pt) || safeStr(entry?.what_it_does_en);
  const mech = safeStr(entry?.mechanics_pt) || safeStr(entry?.mechanics_en);
  return `
    <div class="ins-conds-info-title">${escapeHtml(name)}</div>
    <div class="ins-conds-info-copy">
      ${does ? `<div>${escapeHtml(does)}</div>` : `<div>Sem resumo descritivo cadastrado.</div>`}
      ${mech ? `<div class="ins-conds-info-rule">${escapeHtml(mech)}</div>` : ""}
    </div>
  `;
}

function renderConditionSelectionSummaryHtml(mmState, pkmState, { mmLookup = new Map(), pkmLookup = new Map() } = {}) {
  const chips = [];
  [
    ["1º", Array.isArray(mmState?.deg1) ? mmState.deg1 : []],
    ["2º", Array.isArray(mmState?.deg2) ? mmState.deg2 : []],
    ["3º", Array.isArray(mmState?.deg3) ? mmState.deg3 : []],
  ].forEach(([label, ids]) => {
    ids.forEach((id) => {
      const entry = mmLookup.get(safeStr(id));
      const name = safeStr(entry?.name_pt) || safeStr(entry?.id) || safeStr(id) || "Condição";
      chips.push(`<span class="chip warn">${escapeHtml(label)} • ${escapeHtml(name)}</span>`);
    });
  });
  (Array.isArray(pkmState) ? pkmState : []).forEach((id) => {
    const entry = pkmLookup.get(safeStr(id));
    const name = safeStr(entry?.name_pt) || safeStr(entry?.id) || safeStr(id) || "Condição";
    chips.push(`<span class="chip">${escapeHtml(name)}</span>`);
  });
  return chips.length
    ? `<div class="chip-row">${chips.join("")}</div>`
    : `<div class="muted">Nenhuma condição aplicada.</div>`;
}

function renderInspectorConditionsPanelHTML(piece, { isMine }) {
  const mm = _getPieceMmConditions(piece);
  const pkm = _getPiecePokemonConditions(piece);
  const owner = safeStr(piece?.owner) || "—";
  const ownerLabel = humanizeInternalLabel(owner) || owner || "—";
  const sheet = isMine ? getSheetForPiece(piece) : null;
  const ctx = _getEffectivePokemonContext(owner, piece, { piece, sheet });
  const name = safeStr(ctx?.displayName || displayNameFromPiece(piece, { allowHiddenIdentity: true, isMine }));
  const types = (ctx?.resolvedTypes?.length ? ctx.resolvedTypes : getResolvedTypesForTrainerPid(owner, piece, { piece, sheet })) || [];
  const spriteState = _getPartyStateEntry(owner, safeStr(piece?.pid)) || {};
  const spriteUrl = getSpriteUrlForPiece(piece, { type: "art", shiny: !!spriteState.shiny });
  const spriteFallbackUrl = getSpriteFallbackUrlForPiece(piece);
  const typeChips = types.map((type) => _typePill(type)).join("");
  return `
    <div class="ins-conds">
      <div class="ins-conds-hero">
        <div class="ins-conds-hero-media">
          ${spriteUrl ? `<img src="${escapeAttr(spriteUrl)}" alt="${escapeAttr(name)}" loading="lazy" data-fallback="${escapeAttr(spriteFallbackUrl)}" onerror="if(this.dataset.fallback && this.src!==this.dataset.fallback){this.src=this.dataset.fallback;}else{this.style.display='none'}"/>` : `<span>#</span>`}
        </div>
        <div class="ins-conds-hero-copy">
          <div class="ins-conds-title">Condições</div>
          <div class="ins-conds-hero-sub">${escapeHtml(name)} • ${escapeHtml(ownerLabel)} • ${escapeHtml(pieceTypeLabel(piece))}</div>
          <div class="chip-row">
            <span class="chip">${escapeHtml(isMine ? "Editável" : "Somente leitura")}</span>
            ${typeChips || `<span class="chip">Tipos indisponíveis</span>`}
          </div>
        </div>
      </div>

      <div class="ins-conds-shell">
        <div class="ins-conds-groups">
          <section class="ins-conds-card" data-cond-group="mm-deg1">
            <div class="ins-conds-card-head">
              <div class="ins-conds-degree">1º Grau</div>
              <div class="ins-conds-count" data-ins-count="mm-deg1">0 selecionadas</div>
            </div>
            <div class="custom-cond-list cond-grid" data-ins-cond="mm-deg1" ${isMine ? "" : "data-disabled='true'"}></div>
          </section>
          <section class="ins-conds-card" data-cond-group="mm-deg2">
            <div class="ins-conds-card-head">
              <div class="ins-conds-degree">2º Grau</div>
              <div class="ins-conds-count" data-ins-count="mm-deg2">0 selecionadas</div>
            </div>
            <div class="custom-cond-list cond-grid" data-ins-cond="mm-deg2" ${isMine ? "" : "data-disabled='true'"}></div>
          </section>
          <section class="ins-conds-card" data-cond-group="mm-deg3">
            <div class="ins-conds-card-head">
              <div class="ins-conds-degree">3º Grau</div>
              <div class="ins-conds-count" data-ins-count="mm-deg3">0 selecionadas</div>
            </div>
            <div class="custom-cond-list cond-grid" data-ins-cond="mm-deg3" ${isMine ? "" : "data-disabled='true'"}></div>
          </section>
          <section class="ins-conds-card is-wide" data-cond-group="pkm">
            <div class="ins-conds-card-head">
              <div class="ins-conds-degree">Condições Pokémon</div>
              <div class="ins-conds-count" data-ins-count="pkm">0 selecionadas</div>
            </div>
            <div class="custom-cond-list pkm-list cond-grid" data-ins-cond="pkm" ${isMine ? "" : "data-disabled='true'"}></div>
          </section>
        </div>

        <aside class="ins-conds-side">
          <div class="ins-conds-side-block">
            <div class="ins-conds-side-title">Descrição</div>
            <div class="ins-conds-info" id="ins_conds_info_panel">${renderConditionInfoPlaceholder()}</div>
          </div>
          <div class="ins-conds-side-block">
            <div class="ins-conds-side-title">Aplicadas agora</div>
            <div class="ins-conds-current" id="ins_conds_current">${renderConditionSelectionSummaryHtml(mm, pkm)}</div>
          </div>
          <div class="ins-conds-actions">
            <button type="button" class="btn secondary" data-ins-act="conds-save" ${isMine ? "" : "disabled"}>💾 Salvar</button>
            <button type="button" class="btn danger" data-ins-act="conds-clear" ${isMine ? "" : "disabled"}>🧹 Limpar tudo</button>
          </div>
        </aside>
      </div>
    </div>
  `;
}

async function mountInspectorConditionsPanel(wrap, piece, { isMine }) {
  const panel = wrap.querySelector(".ins-conds");
  if (!panel) return;

  const catalog = await _loadAfflictionsCatalogOnce();
  const mmAll = Array.isArray(catalog?.conditions_mm) ? catalog.conditions_mm : [];
  const pkmAll = Array.isArray(catalog?.pokemon_status_builds) ? catalog.pokemon_status_builds : [];
  const mmLookup = new Map(mmAll.map((entry) => [safeStr(entry?.id), entry]));
  const pkmLookup = new Map(pkmAll.map((entry) => [safeStr(entry?.id), entry]));

  const degFilters = {
    "mm-deg1": mmAll.filter((entry) => entry.affliction_degree === 1 || (entry.degree_suggestions && entry.degree_suggestions["1"])),
    "mm-deg2": mmAll.filter((entry) => entry.affliction_degree === 2 || (entry.degree_suggestions && entry.degree_suggestions["2"]) || entry.id === "bound" || entry.id === "restrained"),
    "mm-deg3": mmAll.filter((entry) => entry.affliction_degree === 3 || entry.affliction_degree === null || (entry.degree_suggestions && entry.degree_suggestions["3"])),
  };

  const mmState = _getPieceMmConditions(piece);
  const selected = {
    "mm-deg1": new Set(mmState.deg1),
    "mm-deg2": new Set(mmState.deg2),
    "mm-deg3": new Set(mmState.deg3),
  };
  const pkmSelected = new Set(_getPiecePokemonConditions(piece));
  const infoPanel = wrap.querySelector("#ins_conds_info_panel");
  const currentPanel = wrap.querySelector("#ins_conds_current");
  const countEls = {
    "mm-deg1": wrap.querySelector('[data-ins-count="mm-deg1"]'),
    "mm-deg2": wrap.querySelector('[data-ins-count="mm-deg2"]'),
    "mm-deg3": wrap.querySelector('[data-ins-count="mm-deg3"]'),
    pkm: wrap.querySelector('[data-ins-count="pkm"]'),
  };
  const setInfoPanel = (html) => {
    if (infoPanel) infoPanel.innerHTML = html || renderConditionInfoPlaceholder();
  };
  const refreshSelectionSummary = () => {
    Object.entries(selected).forEach(([key, store]) => {
      const countEl = countEls[key];
      if (countEl) countEl.textContent = `${store.size} selecionada${store.size === 1 ? "" : "s"}`;
    });
    if (countEls.pkm) countEls.pkm.textContent = `${pkmSelected.size} selecionada${pkmSelected.size === 1 ? "" : "s"}`;
    if (currentPanel) {
      currentPanel.innerHTML = renderConditionSelectionSummaryHtml(
        {
          deg1: Array.from(selected["mm-deg1"]),
          deg2: Array.from(selected["mm-deg2"]),
          deg3: Array.from(selected["mm-deg3"]),
        },
        Array.from(pkmSelected),
        { mmLookup, pkmLookup },
      );
    }
  };

  Object.keys(degFilters).forEach((key) => {
    const listContainer = wrap.querySelector(`[data-ins-cond="${key}"]`);
    if (!listContainer) return;
    const sorted = degFilters[key]
      .slice()
      .sort((a, b) => String(a?.name_pt || a?.id).localeCompare(String(b?.name_pt || b?.id), "pt"));
    listContainer.innerHTML = sorted.map((entry) => {
      const id = safeStr(entry?.id);
      const isSelected = selected[key].has(id);
      const namePt = safeStr(entry?.name_pt) || id;
      const nameEn = safeStr(entry?.name_en);
      return `
        <button type="button" class="cond-item ${isSelected ? "selected" : ""}" data-id="${escapeAttr(id)}" data-degree="${key}" aria-pressed="${isSelected ? "true" : "false"}">
          <span class="cond-item-name">${escapeHtml(namePt)}</span>
          ${nameEn && nameEn !== namePt ? `<small>${escapeHtml(nameEn)}</small>` : ""}
        </button>
      `;
    }).join("");
  });

  const pkmWrap = wrap.querySelector('[data-ins-cond="pkm"]');
  if (pkmWrap) {
    const pkmSorted = pkmAll
      .slice()
      .filter((entry) => entry && entry.id != null)
      .sort((a, b) => String(a?.name_pt || a?.id || "").localeCompare(String(b?.name_pt || b?.id || ""), "pt"));
    pkmWrap.innerHTML = pkmSorted.map((entry) => {
      const id = safeStr(entry?.id);
      const isSelected = pkmSelected.has(id);
      const namePt = safeStr(entry?.name_pt) || id;
      return `
        <button type="button" class="cond-item pkm-item ${isSelected ? "selected" : ""}" data-pkm-id="${escapeAttr(id)}" aria-pressed="${isSelected ? "true" : "false"}">
          <span class="cond-item-name">${escapeHtml(namePt)}</span>
        </button>
      `;
    }).join("");
  }

  const bindInfoPreview = (item, htmlFactory) => {
    item.addEventListener("mouseenter", () => setInfoPanel(htmlFactory()));
    item.addEventListener("focus", () => setInfoPanel(htmlFactory()));
  };

  wrap.querySelectorAll(".cond-item[data-degree]").forEach((item) => {
    const condId = safeStr(item.dataset.id);
    const degKey = safeStr(item.dataset.degree);
    const condData = mmLookup.get(condId) || null;
    bindInfoPreview(item, () => renderConditionInfoHtml(condData, { kind: "mm" }));
    item.addEventListener("click", () => {
      setInfoPanel(renderConditionInfoHtml(condData, { kind: "mm" }));
      if (!isMine) return;
      item.classList.toggle("selected");
      item.setAttribute("aria-pressed", item.classList.contains("selected") ? "true" : "false");
      if (item.classList.contains("selected")) selected[degKey].add(condId);
      else selected[degKey].delete(condId);
      refreshSelectionSummary();
    });
  });

  wrap.querySelectorAll(".cond-item[data-pkm-id]").forEach((item) => {
    const pkmId = safeStr(item.dataset.pkmId);
    const pkmData = pkmLookup.get(pkmId) || null;
    bindInfoPreview(item, () => renderConditionInfoHtml(pkmData, { kind: "pkm" }));
    item.addEventListener("click", () => {
      setInfoPanel(renderConditionInfoHtml(pkmData, { kind: "pkm" }));
      if (!isMine) return;
      item.classList.toggle("selected");
      item.setAttribute("aria-pressed", item.classList.contains("selected") ? "true" : "false");
      if (item.classList.contains("selected")) pkmSelected.add(pkmId);
      else pkmSelected.delete(pkmId);
      refreshSelectionSummary();
    });
  });

  refreshSelectionSummary();

  wrap.querySelector('[data-ins-act="conds-save"]')?.addEventListener("click", async () => {
    if (!isMine) return;
    const mm_conditions = {
      deg1: Array.from(selected["mm-deg1"]),
      deg2: Array.from(selected["mm-deg2"]),
      deg3: Array.from(selected["mm-deg3"]),
    };
    const pokemon_conditions = Array.from(pkmSelected);
    await setPieceConditions(piece.id, mm_conditions, pokemon_conditions);
    updateSidePanels();
  });

  wrap.querySelector('[data-ins-act="conds-clear"]')?.addEventListener("click", async () => {
    if (!isMine) return;
    await setPieceConditions(piece.id, { deg1: [], deg2: [], deg3: [] }, []);
    Object.values(selected).forEach((store) => store.clear());
    pkmSelected.clear();
    wrap.querySelectorAll(".cond-item.selected").forEach((item) => {
      item.classList.remove("selected");
      item.setAttribute("aria-pressed", "false");
    });
    setInfoPanel(renderConditionInfoPlaceholder());
    refreshSelectionSummary();
    updateSidePanels();
  });
}

function resolvePieceInspectorTypes(piece, { isMine = isPieceMine(piece) } = {}) {
  const owner = safeStr(piece?.owner) || "—";
  const pid = safeStr(piece?.pid) || "—";
  const slug = _getEffectivePokeApiSlug(owner, pid);
  const fromSheet = getSheetForPiece(piece)?.pokemon?.types;
  if (Array.isArray(fromSheet) && fromSheet.length) return fromSheet;
  if (Array.isArray(piece?.types) && piece.types.length) return piece.types;
  if (slug) {
    const cached = _getPokeApiCached(slug);
    if (cached && Array.isArray(cached.types) && cached.types.length) return cached.types;
    const pending = _pokeApiCache.get(slug);
    if (pending !== "pending") fetchPokeApiData(slug);
  }
  const displayName = dexNameFromPid(pid) || pid;
  if (displayName && displayName !== "???" && displayName !== "—") {
    const nameSlug = _normalizePokeApiSlug(displayName);
    if (nameSlug) {
      const cached = _getPokeApiCached(nameSlug);
      if (cached && Array.isArray(cached.types) && cached.types.length) return cached.types;
      const pending = _pokeApiCache.get(nameSlug);
      if (pending !== "pending") fetchPokeApiData(nameSlug);
    }
  }
  return [];
}

function resolveActiveArenaHoverPiece() {
  const candidates = [];
  if (safeStr(appState.hoveredPieceId)) candidates.push(appState.hoveredPieceId);
  if (!supportsHoverTabs()) {
    if (safeStr(appState.selectedPieceId)) candidates.push(appState.selectedPieceId);
    if (safeStr(appState.lastInteractedPieceId)) candidates.push(appState.lastInteractedPieceId);
  }
  for (const id of candidates) {
    const piece = (appState.pieces || []).find((p) => safeStr(p?.id) === safeStr(id)) || null;
    if (piece && isPieceVisibleToMe(piece)) return piece;
  }
  return null;
}

function renderArenaHoverCard() {
  if (!arenaHoverCard || !arenaHoverCardBody) return;
  if (appState.toolsMenuOpen) {
    appState.hoverCardPieceId = null;
    arenaHoverCard.classList.remove("visible");
    arenaHoverCard.setAttribute("aria-hidden", "true");
    return;
  }
  const piece = resolveActiveArenaHoverPiece();
  if (!piece) {
    appState.hoverCardPieceId = null;
    arenaHoverCard.classList.remove("visible");
    arenaHoverCard.setAttribute("aria-hidden", "true");
    return;
  }

  const owner = safeStr(piece?.owner) || "—";
  const pid = safeStr(piece?.pid) || "—";
  const isMine = isPieceMine(piece);
  const revealed = (piece?.revealed != null) ? !!piece.revealed : true;
  const ownerLabel = humanizeInternalLabel(owner) || owner || "-";
  const canSeeIdentity = isMine || revealed;
  const sheet = isMine ? getSheetForPiece(piece) : null;
  const ctx = _getEffectivePokemonContext(owner, piece, { piece, sheet });
  const name = canSeeIdentity ? (safeStr(ctx?.displayName) || displayNameFromPiece(piece, { allowHiddenIdentity: true, isMine })) : "???";
  const types = (ctx?.resolvedTypes?.length ? ctx.resolvedTypes : getResolvedTypesForTrainerPid(owner, piece, { piece, sheet })) || [];
  const typeChips = types.map((type) => _typePill(type)).join("");
  const moveBudget = getPieceMovementBudget(piece);
  const moveSummary = `Velocidade ${moveBudget.speed} • deslocamento ${moveBudget.maxTiles % 1 ? "1/2" : moveBudget.maxTiles} quadrado(s)`;
  const offenseH = _typeOffenseHtml(types);
  const matchupH = _typeMatchupHtml(types);
  const spriteState = _getPartyStateEntry(owner, pid) || {};
  const spriteUrl = getSpriteUrlForPiece(piece, { type: "art", shiny: !!spriteState.shiny });
  const spriteFallbackUrl = getSpriteFallbackUrlForPiece(piece);
  const identityChip = revealed ? "Revelado" : "Oculto";

  arenaHoverCardBody.innerHTML = `
    <div class="inspector">
      <div class="arena-hover-head">
        <div class="arena-hover-media">
          ${spriteUrl ? `<img src="${escapeAttr(spriteUrl)}" alt="${escapeAttr(name)}" loading="lazy" data-fallback="${escapeAttr(spriteFallbackUrl)}" onerror="if(this.dataset.fallback && this.src!==this.dataset.fallback){this.src=this.dataset.fallback;}else{this.style.display='none'}"/>` : `<span>#</span>`}
        </div>
        <div style="min-width:0;flex:1">
          <div class="arena-hover-title">${escapeHtml(name)}</div>
          <div class="arena-hover-sub">${escapeHtml(ownerLabel)} • ${escapeHtml(pieceTypeLabel(piece))}</div>
          <div class="chip-row">
            <span class="chip">${escapeHtml(identityChip)}</span>
            <span class="chip">${escapeHtml(isMine ? "Sua peça" : "Em campo")}</span>
          </div>
          ${typeChips ? `<div class="chip-row">${typeChips}</div>` : ""}
        </div>
      </div>
      <div class="arena-hover-motion">${escapeHtml(moveSummary)}</div>
      ${offenseH || `<div class="section-title">Super efetivo</div><div class="arena-hover-empty">Tipos ainda não disponíveis.</div>`}
      ${matchupH || ""}
    </div>
  `;

  appState.hoverCardPieceId = safeStr(piece?.id) || null;
  arenaHoverCard.classList.add("visible");
  arenaHoverCard.setAttribute("aria-hidden", "false");
}

let pieceActionModalRefs = null;

function ensurePieceActionModal() {
  if (pieceActionModalRefs) return pieceActionModalRefs;
  const backdrop = document.createElement("div");
  backdrop.id = "piece_action_modal_backdrop";
  backdrop.className = "modal-backdrop";
  backdrop.style.display = "none";
  backdrop.innerHTML = `
    <div class="modal-box" style="max-width:780px;width:min(92vw,780px);">
      <div class="modal-header">
        <span id="piece_action_modal_title">Detalhes</span>
        <button class="btn ghost modal-close" id="piece_action_modal_close" title="Fechar">✕</button>
      </div>
      <div class="modal-body">
        <div id="piece_action_modal_content"></div>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const title = backdrop.querySelector("#piece_action_modal_title");
  const content = backdrop.querySelector("#piece_action_modal_content");
  const close = () => { backdrop.style.display = "none"; };
  backdrop.querySelector("#piece_action_modal_close")?.addEventListener("click", close);
  backdrop.addEventListener("click", (ev) => {
    if (ev.target === backdrop) close();
  });
  pieceActionModalRefs = { backdrop, title, content, close };
  return pieceActionModalRefs;
}

function closePieceActionModal() {
  ensurePieceActionModal().close();
}

const MM3E_ROLL_TEST_CATALOG_VERSION = "mm3e-core-attributes-defenses-skills-v1";

const MM3E_ROLL_TEST_ABILITIES = Object.freeze([
  { key: "stgr", label: "Stgr", aliases: ["stgr", "strg", "str", "strength", "forca"], boostKeys: ["stgr", "str", "strength"] },
  { key: "stamina", label: "Stamina", aliases: ["stamina", "sta", "vigor"], boostKeys: ["stamina", "sta"] },
  { key: "agility", label: "Agility", aliases: ["agility", "agl", "agilidade"], boostKeys: ["agility", "agl"] },
  { key: "dexterity", label: "Dexterity", aliases: ["dexterity", "dex", "destreza"], boostKeys: ["dexterity", "dex"] },
  { key: "fighting", label: "Fighting", aliases: ["fighting", "fgt", "luta"], boostKeys: ["fighting", "fgt"] },
  { key: "int", label: "Int", aliases: ["int", "intellect", "intel", "intelligence", "intelecto", "inteligencia"], boostKeys: ["int", "intellect", "intel"] },
  { key: "awareness", label: "Awareness", aliases: ["awareness", "awe", "prontidao"], boostKeys: ["awareness", "awe"] },
  { key: "presence", label: "Presence", aliases: ["presence", "pre", "presenca"], boostKeys: ["presence", "pre"] },
]);

const MM3E_ROLL_TEST_DEFENSES = Object.freeze([
  { key: "dodge", label: "Dodge", aliases: ["dodge", "esquiva"], boostKeys: ["dodge"] },
  { key: "parry", label: "Parry", aliases: ["parry", "aparar"], boostKeys: ["parry"] },
  { key: "fort", label: "Fort", aliases: ["fort", "fortitude"], boostKeys: ["fort", "fortitude"] },
  { key: "will", label: "Will", aliases: ["will", "vontade"], boostKeys: ["will"] },
  { key: "thg", label: "Thg", aliases: ["thg", "toughness", "resistencia"], boostKeys: ["thg", "toughness"] },
]);

const MM3E_ROLL_TEST_SKILLS = Object.freeze([
  { key: "acrobatics", label: "Acrobatics", aliases: ["acrobatics", "acrobacia"] },
  { key: "athletics", label: "Athletics", aliases: ["athletics", "atletismo"] },
  { key: "close-combat", label: "Close Combat", aliases: ["close combat", "combate corpo a corpo"] },
  { key: "deception", label: "Deception", aliases: ["deception", "enganacao"] },
  { key: "expertise", label: "Expertise", aliases: ["expertise", "especialidade"] },
  { key: "insight", label: "Insight", aliases: ["insight", "intuicao"] },
  { key: "intimidation", label: "Intimidation", aliases: ["intimidation", "intimidacao"] },
  { key: "investigation", label: "Investigation", aliases: ["investigation", "investigacao"] },
  { key: "perception", label: "Perception", aliases: ["perception", "percepcao"] },
  { key: "persuasion", label: "Persuasion", aliases: ["persuasion", "persuasao"] },
  { key: "ranged-combat", label: "Ranged Combat", aliases: ["ranged combat", "combate a distancia"] },
  { key: "sleight-of-hand", label: "Sleight of Hand", aliases: ["sleight of hand", "prestidigitacao"] },
  { key: "stealth", label: "Stealth", aliases: ["stealth", "furtividade"] },
  { key: "technology", label: "Technology", aliases: ["technology", "tecnologia"] },
  { key: "treatment", label: "Treatment", aliases: ["treatment", "tratamento"] },
  { key: "vehicles", label: "Vehicles", aliases: ["vehicles", "veiculos"] },
]);

function normalizeRollTestKey(value) {
  return safeStr(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compactRollTestKey(value) {
  return normalizeRollTestKey(value).replace(/\s+/g, "");
}

function signedRollTestValue(value) {
  const n = safeInt(value, 0);
  return n >= 0 ? `+${n}` : `${n}`;
}

function parseRollTestNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  const text = safeStr(value);
  if (!text) return null;
  const match = text.replace(",", ".").match(/[+-]?\d+/);
  return match ? parseInt(match[0], 10) : null;
}

function makeRollTestAliasSet(aliases) {
  const out = new Set();
  (Array.isArray(aliases) ? aliases : []).forEach((alias) => {
    const normalized = normalizeRollTestKey(alias);
    const compact = compactRollTestKey(alias);
    if (normalized) out.add(normalized);
    if (compact) out.add(compact);
  });
  return out;
}

function readRollTestStat(sources, aliases) {
  const wanted = makeRollTestAliasSet(aliases);
  for (const source of (Array.isArray(sources) ? sources : [])) {
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    for (const [rawKey, rawValue] of Object.entries(source)) {
      const keyA = normalizeRollTestKey(rawKey);
      const keyB = compactRollTestKey(rawKey);
      if (!wanted.has(keyA) && !wanted.has(keyB)) continue;
      const parsed = parseRollTestNumber(rawValue);
      if (parsed != null) return { value: parsed, sourceKey: rawKey };
    }
  }
  return { value: 0, sourceKey: "" };
}

function readRollTestBoost(boosts, keys) {
  if (!boosts || typeof boosts !== "object" || Array.isArray(boosts)) return 0;
  const wanted = makeRollTestAliasSet(keys);
  for (const [rawKey, rawValue] of Object.entries(boosts)) {
    const keyA = normalizeRollTestKey(rawKey);
    const keyB = compactRollTestKey(rawKey);
    if (!wanted.has(keyA) && !wanted.has(keyB)) continue;
    return safeInt(rawValue, 0);
  }
  return 0;
}

function rollTestSkillValueFromObject(item) {
  for (const key of ["total", "bonus", "modifier", "mod", "value", "ranks", "rank", "score"]) {
    const parsed = parseRollTestNumber(item?.[key]);
    if (parsed != null) return parsed;
  }
  return 0;
}

function parseRollTestSkillLine(line) {
  const text = safeStr(line);
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^(.*?)(?:\s*(?:\(|\[)?\s*(?:R|Rank|Ranks|Bonus|Mod)?\s*([+-]?\d+)\s*(?:\)|\])?)$/i);
  if (match) {
    const name = safeStr(match[1]).replace(/[:\-–]+$/, "").trim();
    if (name) return { name, value: safeInt(match[2], 0), raw: line };
  }
  return { name: cleaned, value: 0, raw: line };
}

function parseRollTestSkills(rawSkills) {
  const out = [];
  const pushSkill = (name, value, raw) => {
    const clean = safeStr(name);
    if (!clean) return;
    out.push({ name: clean, value: safeInt(value, 0), raw });
  };

  const visit = (item) => {
    if (item == null) return;
    if (typeof item === "string") {
      item.split(/\r?\n+|;/).forEach((line) => {
        const parsed = parseRollTestSkillLine(line);
        if (parsed) pushSkill(parsed.name, parsed.value, parsed.raw);
      });
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (typeof item === "object") {
      const named = safeStr(item.name || item.label || item.skill || item.text);
      if (named) {
        pushSkill(named, rollTestSkillValueFromObject(item), item);
        return;
      }
      for (const [key, value] of Object.entries(item)) {
        if (value && typeof value === "object" && !Array.isArray(value)) pushSkill(key, rollTestSkillValueFromObject(value), value);
        else pushSkill(key, parseRollTestNumber(value) ?? 0, value);
      }
    }
  };

  visit(rawSkills);
  const byName = new Map();
  out.forEach((entry) => {
    const key = normalizeRollTestKey(entry.name);
    const current = byName.get(key);
    if (!current || safeInt(entry.value, 0) > safeInt(current.value, 0)) byName.set(key, entry);
  });
  return Array.from(byName.values()).sort((a, b) => safeStr(a.name).localeCompare(safeStr(b.name)));
}

function findRollTestSkillMatch(parsedSkills, catalogEntry) {
  const wanted = makeRollTestAliasSet([catalogEntry.label, catalogEntry.key].concat(catalogEntry.aliases || []));
  return (parsedSkills || []).find((skill) => {
    const keyA = normalizeRollTestKey(skill.name);
    const keyB = compactRollTestKey(skill.name);
    return wanted.has(keyA) || wanted.has(keyB);
  }) || null;
}

function buildPieceRollTestState(piece) {
  const owner = safeStr(piece?.owner);
  const sheet = isPieceMine(piece) ? getSheetForPiece(piece) : null;
  const pkm = sheet?.pokemon || {};
  const name = safeStr(_getEffectivePokemonContext(owner, piece, { piece, sheet })?.displayName)
    || displayNameFromPiece(piece, { allowHiddenIdentity: true, isMine: isPieceMine(piece) })
    || safeStr(pkm.name)
    || safeStr(piece?.pid)
    || "Pokemon";
  const statsSources = [sheet?.stats, pkm?.stats, sheet, piece?.stats, piece];
  const stateBucket = sheet ? _getPartyStateForSheet(owner, sheet, piece) : (_getPartyStateEntry(owner, piece) || {});
  const boosts = (stateBucket?.stat_boosts && typeof stateBucket.stat_boosts === "object") ? stateBucket.stat_boosts : {};
  const np = safeInt(sheet?.np ?? pkm?.np, 0);
  const cap = Math.max(0, np * 2);
  const choices = [];

  const makeStatChoice = (entry, group, overrideBase = null) => {
    const read = overrideBase == null ? readRollTestStat(statsSources, [entry.key, entry.label].concat(entry.aliases || [])) : { value: safeInt(overrideBase, 0), sourceKey: entry.key };
    const boost = readRollTestBoost(boosts, [entry.key, entry.label].concat(entry.boostKeys || []));
    choices.push({
      key: `${group}:${entry.key}`,
      statKey: entry.key,
      label: entry.label,
      group,
      base: safeInt(read.value, 0),
      boost,
      value: safeInt(read.value, 0) + boost,
      sourceKey: safeStr(read.sourceKey),
    });
  };

  MM3E_ROLL_TEST_ABILITIES.forEach((entry) => makeStatChoice(entry, "Atributos"));

  const rawDodge = readRollTestStat(statsSources, ["dodge", "esquiva"]).value;
  const rawThg = readRollTestStat(statsSources, ["thg", "toughness", "resistencia"]).value;
  const derivedThg = rawThg <= 0 && cap > 0 ? Math.round(cap / 2) : rawThg;
  const derivedDodge = rawDodge <= 0 && cap > 0 && derivedThg > 0 ? Math.max(0, cap - derivedThg) : rawDodge;
  MM3E_ROLL_TEST_DEFENSES.forEach((entry) => {
    if (entry.key === "dodge") makeStatChoice(entry, "Defesas", derivedDodge);
    else if (entry.key === "thg") makeStatChoice(entry, "Defesas", derivedThg);
    else makeStatChoice(entry, "Defesas");
  });

  const parsedSkills = parseRollTestSkills(sheet?.skills || piece?.skills || []);
  const catalogSkillKeys = new Set();
  MM3E_ROLL_TEST_SKILLS.forEach((entry) => {
    const match = findRollTestSkillMatch(parsedSkills, entry);
    catalogSkillKeys.add(normalizeRollTestKey(entry.label));
    (entry.aliases || []).forEach((alias) => catalogSkillKeys.add(normalizeRollTestKey(alias)));
    choices.push({
      key: `skill:${entry.key}`,
      statKey: entry.key,
      label: entry.label,
      group: "Skills M&M 3e",
      base: safeInt(match?.value, 0),
      boost: 0,
      value: safeInt(match?.value, 0),
      sourceKey: match ? safeStr(match.name) : "",
    });
  });

  parsedSkills.forEach((skill, idx) => {
    const normalized = normalizeRollTestKey(skill.name);
    if (!normalized || catalogSkillKeys.has(normalized)) return;
    choices.push({
      key: `sheet-skill:${idx}:${normalized}`,
      statKey: normalized,
      label: skill.name,
      group: "Skills da ficha",
      base: safeInt(skill.value, 0),
      boost: 0,
      value: safeInt(skill.value, 0),
      sourceKey: skill.name,
    });
  });

  return {
    owner,
    pieceId: safeStr(piece?.id),
    pid: safeStr(piece?.pid),
    name,
    sheet,
    sheetId: safeStr(sheet?._sheet_id || sheet?.sheet_id || sheet?.id),
    catalogVersion: MM3E_ROLL_TEST_CATALOG_VERSION,
    choices,
  };
}

function renderRollTestOptions(choices, selectedKey = "") {
  const groups = [];
  const byGroup = new Map();
  (choices || []).forEach((choice) => {
    const group = safeStr(choice.group) || "Outros";
    if (!byGroup.has(group)) {
      byGroup.set(group, []);
      groups.push(group);
    }
    byGroup.get(group).push(choice);
  });
  return groups.map((group) => {
    const options = byGroup.get(group).map((choice) => {
      const selected = choice.key === selectedKey ? " selected" : "";
      return `<option value="${escapeAttr(choice.key)}"${selected}>${escapeHtml(choice.label)} (${signedRollTestValue(choice.value)})</option>`;
    }).join("");
    return `<optgroup label="${escapeAttr(group)}">${options}</optgroup>`;
  }).join("");
}

function findRollTestChoice(state, key) {
  return (state?.choices || []).find((choice) => safeStr(choice.key) === safeStr(key)) || state?.choices?.[0] || null;
}

async function rollPieceTest(pieceId, choiceKey) {
  if (!currentDb || !currentRid || !appState.connected) {
    setStatus("err", "conecte antes de rolar teste");
    return null;
  }
  const piece = (appState.pieces || []).find((p) => safeStr(p?.id) === safeStr(pieceId)) || null;
  if (!piece) {
    setStatus("warn", "peca nao encontrada para rolar teste");
    return null;
  }
  if (!isPieceMine(piece) || isTrainerPiece(piece)) {
    setStatus("err", "voce so pode rolar teste dos seus Pokemon");
    return null;
  }

  const state = buildPieceRollTestState(piece);
  const choice = findRollTestChoice(state, choiceKey);
  if (!choice) {
    setStatus("warn", "escolha um atributo ou skill para rolar");
    return null;
  }

  const by = safeStr(appState.by || byInput?.value || "Anon") || "Anon";
  const natural = Math.floor(Math.random() * 20) + 1;
  const modifier = safeInt(choice.value, 0);
  const total = natural + modifier;
  const label = `${choice.label} ${signedRollTestValue(modifier)} = ${total}`;
  const result = {
    by,
    trainer: by,
    owner: state.owner,
    pieceId: state.pieceId,
    pid: state.pid,
    pokemon: state.name,
    statKey: choice.statKey,
    statLabel: choice.label,
    statGroup: choice.group,
    modifier,
    natural,
    value: natural,
    total,
    label,
    catalogVersion: state.catalogVersion,
    sheetId: state.sheetId,
  };

  await playDiceRollAnimation({ label: `Teste - ${choice.label}`, value: natural });

  await addDoc(collection(currentDb, "rooms", currentRid, "rolls"), {
    ...result,
    kind: "test",
    createdAt: serverTimestamp(),
    audit: {
      flow: "Rolar Teste",
      catalogVersion: state.catalogVersion,
      source: choice.sourceKey ? "sheet" : "catalog-default",
      sourceKey: choice.sourceKey || null,
      base: safeInt(choice.base, 0),
      boost: safeInt(choice.boost, 0),
    },
  });

  const logText = `${state.name} rolou teste de ${choice.label}: d20 ${natural} ${signedRollTestValue(modifier)} = ${total}.`;
  try {
    await sendAction("ADD_LOG", by, {
      text: logText,
      kind: "dice",
      rollTest: result,
    });
  } catch {}
  setStatus("ok", `teste rolado: ${choice.label} ${total}`);
  return result;
}

function openPieceRollTestModal(piece) {
  if (!piece || !safeStr(piece?.id)) return;
  if (!isPieceMine(piece) || isTrainerPiece(piece)) {
    setStatus("err", "voce so pode rolar teste dos seus Pokemon");
    return;
  }
  const refs = ensurePieceActionModal();
  const state = buildPieceRollTestState(piece);
  const firstKey = state.choices[0]?.key || "";
  refs.title.textContent = `Rolar Teste - ${state.name}`;
  refs.content.innerHTML = `
    <div class="inspector roll-test-panel" data-roll-test-piece="${escapeAttr(state.pieceId)}">
      <div class="section-title" style="margin-top:0;">Escolha o atributo, defesa ou skill</div>
      <div class="muted" style="margin-bottom:10px;">
        Catalogo M&M 3e: atributos, defesas e todas as skills basicas. Skills extras da ficha aparecem no final.
      </div>
      <label style="display:block;font-weight:900;font-size:.78rem;margin-bottom:6px;">Teste</label>
      <select id="roll_test_select" class="input" style="width:100%;max-width:100%;margin-bottom:10px;">
        ${renderRollTestOptions(state.choices, firstKey)}
      </select>
      <div id="roll_test_preview" class="card" style="margin:0 0 10px;padding:10px;"></div>
      <div class="row" style="justify-content:flex-end;gap:8px;">
        <button type="button" class="btn ghost" id="roll_test_cancel">Cancelar</button>
        <button type="button" class="btn" id="roll_test_confirm">Rolar Teste</button>
      </div>
      <div id="roll_test_result" style="margin-top:10px;"></div>
    </div>
  `;
  refs.backdrop.style.display = "";

  const panel = refs.content.querySelector(".roll-test-panel");
  const select = refs.content.querySelector("#roll_test_select");
  const preview = refs.content.querySelector("#roll_test_preview");
  const resultEl = refs.content.querySelector("#roll_test_result");
  const rollBtn = refs.content.querySelector("#roll_test_confirm");
  const cancelBtn = refs.content.querySelector("#roll_test_cancel");

  const refreshPreview = () => {
    const freshPiece = (appState.pieces || []).find((p) => safeStr(p?.id) === state.pieceId) || piece;
    const freshState = buildPieceRollTestState(freshPiece);
    const choice = findRollTestChoice(freshState, select?.value);
    if (!choice || !preview) return;
    preview.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:900;">${escapeHtml(choice.label)}</div>
          <div class="muted">${escapeHtml(choice.group)}${choice.sourceKey ? ` - ficha: ${escapeHtml(choice.sourceKey)}` : " - catalogo/base"}</div>
        </div>
        <div class="stat-box" style="margin:0;min-width:96px;">
          <div class="stat-label">Bonus</div>
          <div class="stat-val">${signedRollTestValue(choice.value)}</div>
        </div>
      </div>
    `;
  };

  select?.addEventListener("change", refreshPreview);
  cancelBtn?.addEventListener("click", () => refs.close());
  rollBtn?.addEventListener("click", async () => {
    const prevDisabled = rollBtn.disabled;
    const prevText = rollBtn.textContent;
    rollBtn.disabled = true;
    rollBtn.textContent = "Rolando...";
    try {
      const roll = await rollPieceTest(panel?.dataset?.rollTestPiece || state.pieceId, select?.value || firstKey);
      if (roll && resultEl) {
        resultEl.innerHTML = `
          <div class="card" style="padding:10px;border-color:rgba(56,189,248,.35);">
            <div style="font-weight:900;">${escapeHtml(roll.pokemon)} - ${escapeHtml(roll.statLabel)}</div>
            <div class="stat-val" style="font-size:1.45rem;">d20 ${roll.natural} ${signedRollTestValue(roll.modifier)} = ${roll.total}</div>
          </div>
        `;
      }
    } catch (e) {
      setStatus("err", `erro ao rolar teste: ${e?.message || e}`);
    } finally {
      rollBtn.disabled = prevDisabled;
      rollBtn.textContent = prevText || "Rolar Teste";
      refreshPreview();
    }
  });
  refreshPreview();
}

async function openPieceConditionsModal(piece) {
  const refs = ensurePieceActionModal();
  const isMine = isPieceMine(piece);
  const name = displayNameFromPiece(piece, { allowHiddenIdentity: true, isMine });
  refs.title.textContent = `Condições • ${name}`;
  refs.content.innerHTML = `<div class="inspector">${renderInspectorConditionsPanelHTML(piece, { isMine })}</div>`;
  refs.backdrop.style.display = "";
  await mountInspectorConditionsPanel(refs.content, piece, { isMine });
}

function getPieceMegaUiState(piece) {
  const owner = safeStr(piece?.owner);
  const pid = safeStr(piece?.pid);
  const entry = isPieceMine(piece) ? _resolveSelfEffectiveSheet(pid, owner) : null;
  const megaSheets = _getUniqueMegaSheets(entry?.megaSheets);
  const baseSheet = entry?.baseSheet || entry?.effectiveSheet;
  return {
    owner,
    pid,
    entry,
    megaSheets,
    canMega: isPieceMine(piece) && (!!megaSheets.length || !!baseSheet?.mega_available),
  };
}

function openPieceMegaModal(piece) {
  const megaState = getPieceMegaUiState(piece);
  if (!megaState.canMega) {
    setStatus("warn", "essa peça não possui Mega Evolução disponível");
    return;
  }
  const refs = ensurePieceActionModal();
  refs.title.textContent = `Mega Evolução • ${displayNameFromPiece(piece, { allowHiddenIdentity: true, isMine: true })}`;
  refs.content.innerHTML = `<div class="inspector">${_renderMegaControlsHtml(megaState.owner, megaState.pid, megaState.entry, { title: "Mega Evolução" })}</div>`;
  refs.backdrop.style.display = "";
  _bindMegaControlButtons(refs.content);
}

async function triggerPieceMegaAction(piece) {
  const megaState = getPieceMegaUiState(piece);
  if (!megaState.canMega) {
    setStatus("warn", "essa peça não possui Mega Evolução disponível");
    return;
  }

  const activeSlug = safeStr(megaState.entry?.activeMegaSlug);
  if (activeSlug) {
    await setBattleMegaEvolutionForTrainerPid(megaState.owner, megaState.pid, "");
    return;
  }

  if (megaState.megaSheets.length === 1) {
    const slug = safeStr(megaState.megaSheets[0]?.mega_slug);
    if (slug) {
      await setBattleMegaEvolutionForTrainerPid(megaState.owner, megaState.pid, slug);
      return;
    }
  }

  openPieceMegaModal(piece);
}

function renderInspectorCard() {
  updateMovementTurnState();
  const wrap = document.createElement("div");
  wrap.className = "inspector";

  if (safeStr(appState.activeTab) === "sheets") {
    return renderSheetsInspectorCard(wrap);
  }

  const selId = safeStr(appState.selectedPieceId);
  if (!selId) {
    wrap.innerHTML = `
      <div class="inspector-empty">
        <div class="inspector-title">Detalhes</div>
        <div class="muted">Clique em um Pokémon no mapa para inspecionar.</div>
      </div>
    `;
    return wrap;
  }

  const p = (appState.pieces || []).find((x) => safeStr(x?.id) === selId) || null;
  if (!p) {
    wrap.innerHTML = `
      <div class="inspector-empty">
        <div class="inspector-title">Detalhes</div>
        <div class="muted">Peça não encontrada (talvez foi removida).</div>
      </div>
    `;
    return wrap;
  }

  const owner = safeStr(p?.owner) || "—";
  const pid = safeStr(p?.pid) || "—";
  const isMine = isPieceMine(p);
  const revealed = (p?.revealed != null) ? !!p.revealed : true; // default compat: sem flag = revelado
  const canSeeIdentity = isMine || revealed;
  const ownerLabel = humanizeInternalLabel(owner) || owner || "-";
  const name = canSeeIdentity ? displayNameFromPiece(p, { allowHiddenIdentity: true, isMine }) : "???";
  const heldItem = canSeeIdentity ? getHeldItemForTrainerPid(owner, p) : null;
  const _psInspector = _getPartyStateEntry(owner, p) || {};
  const spriteUrl = getSpriteUrlForPiece(p, { type: "art", shiny: !!_psInspector.shiny });
  const spriteFallbackUrl = getSpriteFallbackUrlForPiece(p);

  const hp = Number(getPartyHp(owner, p) ?? 0);
  const hpMax = 6;
  const hpUi = getHpUiState(hp);
  const hpPct = hpUi.pct;
  const hpCol = hpUi.color;

  const chips = [
    `<span class="chip">${escapeHtml(ownerLabel)}</span>`,
    `<span class="chip">${escapeHtml(isMine ? "Sua peca" : "Peca em campo")}</span>`,
    `<span class="chip">${escapeHtml(pieceTypeLabel(p))}</span>`,
    `<span class="chip ${revealed ? "ok" : "warn"}">${revealed ? "Revelado" : "Oculto"}</span>`,
  ].join("");

  // ✅ Dono-only: só o dono pode puxar/usar a ficha completa
  const sh2 = isMine ? getSheetForPiece(p) : null;
  const megaInfo = isMine ? _resolveSelfEffectiveSheet(pid, owner) : null;
  const megaControlsHtml = isMine
    ? _renderMegaControlsHtml(owner, pid, megaInfo || { baseSheet: sh2, effectiveSheet: sh2, megaSheets: [], activeMegaSlug: "" }, { title: "Mega Evolucao" })
    : "";

  const mvBudget = isMine ? getPieceMovementBudget(p) : { speed: 0, maxTiles: 0, dash: false };
  const freeMove = !!appState.movement?.freeByPieceId?.[selId];

  const slug = _getEffectivePokeApiSlug(owner, pid);
  const apiCachedEntry = (isMine && slug) ? _getPokeApiCached(slug) : null;
  const apiCached = apiCachedEntry ? apiCachedEntry.speed : undefined;
  const megaFxActive = !!getMegaEvolutionFxState(owner, pid);

  // Tipos: ficha → peça → cache PokeAPI (mesma lógica para dono e adversário)
  const _hasValidTypes = (arr) => Array.isArray(arr) && arr.length && arr.some(t => normalizeType(t));
  const insTypes = (() => {
    // Tenta ficha local (só disponível para peças próprias)
    if (isMine) {
      const fromSheet = sh2?.pokemon?.types;
      if (_hasValidTypes(fromSheet)) return fromSheet;
      if (_hasValidTypes(p?.types)) return p.types;
    }
    // Inspector público: qualquer peça — busca PokeAPI (dados de tipo são públicos)
    if (slug) {
      const cached = _getPokeApiCached(slug);
      if (cached && Array.isArray(cached.types) && cached.types.length) return cached.types;
      const v = _pokeApiCache.get(slug);
      if (v !== "pending") fetchPokeApiData(slug); // fire-and-forget
    }
    // Fallback: tenta pelo nome de exibição (ex: "Charizard" → "charizard")
    const displayName = dexNameFromPid(pid) || pid;
    if (!slug && displayName && displayName !== "???" && displayName !== "—") {
      const nameSlug = _normalizePokeApiSlug(displayName);
      if (nameSlug) {
        const cached = _getPokeApiCached(nameSlug);
        if (cached && Array.isArray(cached.types) && cached.types.length) return cached.types;
        const v = _pokeApiCache.get(nameSlug);
        if (v !== "pending") fetchPokeApiData(nameSlug);
      }
    }
    return [];
  })();

  // Tabela de fraquezas visível para todos os jogadores (público)
  const offenseH = _typeOffenseHtml(insTypes);
  const matchupH = _typeMatchupHtml(insTypes);

  // Tracking de condições (M&M por degree + Pokémon)
  // UI: painel opcional no Inspector. Persistência: public_state/state.pieces[*].mm_conditions / pokemon_conditions
  const condsOpen = !!appState.inspectorCondsOpen;

const psOwner = _getPartyStateEntry(owner, pid) || {};
const sheetHasSpeed = isMine ? [
  readSpeedFromStats(sh2?.stats), readSpeedFromStats(sh2?.pokemon?.stats),
  readSpeedFromStats(sh2?.poke_stats), Number(sh2?.speed), Number(sh2?.pokemon?.speed),
  readSpeedFromStats(psOwner?.stats), readSpeedFromStats(p?.stats), Number(p?.speed),
].some(c => Number.isFinite(Number(c)) && Number(c) > 0) : false;
  const speedSource = apiCached === "pending" ? "buscando…" : (!sheetHasSpeed && apiCached > 0) ? "PokeAPI" : "sheet";
  const moveSummary = isMine
    ? `Speed ${mvBudget.speed} (${speedSource}) • deslocamento ${mvBudget.maxTiles % 1 ? "1/2" : mvBudget.maxTiles} quadrado(s)`
    : `🔒 Ficha privada — apenas o dono pode ver stats/golpes.`;

  const uiMoveSummary = isMine
    ? `Velocidade ${mvBudget.speed} • deslocamento ${mvBudget.maxTiles % 1 ? "1/2" : mvBudget.maxTiles} quadrado(s)`
    : `Detalhes completos disponiveis apenas para o dono da ficha.`;
  const inspectorSubtitle = isMine ? "Sua peca selecionada" : "Peca selecionada na arena";

  wrap.innerHTML = `
    <div class="inspector-head">
      <div class="inspector-title">Detalhes</div>
      <div class="inspector-sub">${escapeHtml(inspectorSubtitle)}</div>
    </div>

    <div class="inspector-card">
      <div class="inspector-media">
        ${spriteUrl ? `<img class="${megaFxActive ? "mega-evolving" : ""}" src="${escapeAttr(spriteUrl)}" alt="sprite" loading="lazy" data-fallback="${escapeAttr(spriteFallbackUrl)}" onerror="if(this.dataset.fallback && this.src!==this.dataset.fallback){this.src=this.dataset.fallback;}else{this.style.display='none'}"/>` : `<div class="inspector-sprite-fallback">#</div>`}
      </div>
      <div class="inspector-body">
        <div class="inspector-name">${escapeHtml(name)}</div>
        <div class="inspector-chips">${chips}</div>
        ${renderHeldItemSummaryHtml(heldItem, { label: "Item", size: "md" })}
        ${megaControlsHtml}
        <div class="muted" style="margin-top:6px">${escapeHtml(uiMoveSummary)}</div>
        ${offenseH}
        ${matchupH}

        ${condsOpen ? renderInspectorConditionsPanelHTML(p, { isMine }) : ""}

        <div class="ins-hp-section">
          <div class="ins-hp-label-row">
            <span class="ins-hp-title">HP</span>
            <span class="ins-hp-count ${hp <= 0 ? "hp-ko" : hp <= 2 ? "hp-low" : hp <= 4 ? "hp-mid" : "hp-full"}">${hp}/${hpMax}</span>
          </div>
          <div class="ins-hp-bars" data-ins-hpbars>
            ${Array.from({length: hpMax}, (_, i) => {
              const bar = i + 1;
              let cls;
              if (hp <= 0) cls = "seg-ko";
              else if (bar > hp) cls = "seg-empty";
              else if (hp <= 2) cls = "seg-low";
              else if (hp <= 4) cls = "seg-mid";
              else cls = "seg-full";
              return `<div class="ins-hp-bar ${cls}" data-ins-act="hp-seg" data-seg="${bar}" title="Definir HP: ${bar}"></div>`;
            }).join("")}
          </div>
        </div>

        <div class="inspector-actions">
          <button type="button" class="btn primary" data-ins-act="move">Mover</button>
          <button type="button" class="btn secondary" data-ins-act="roll-test" ${isMine && !isTrainerPiece(p) ? "" : "disabled"}>Rolar Teste</button>
          <button type="button" class="btn ${freeMove ? "primary" : "secondary"}" data-ins-act="free" ${isMine ? "" : "disabled"}>🧭 Deslocamento livre ${freeMove ? "ON" : "OFF"}</button>
          <button type="button" class="btn ${mvBudget.dash ? "primary" : "secondary"}" data-ins-act="dash" ${isMine ? "" : "disabled"}>${mvBudget.dash ? "⚡ Standard gasta (x2)" : "⚡ Abrir mão da Standard (x2)"}</button>
          <button type="button" class="btn ${condsOpen ? "primary" : "secondary"}" data-ins-act="toggle-conds">🧷 Condições</button>
          <button type="button" class="btn secondary" data-ins-act="toggle" ${isMine ? "" : "disabled"}>Ocultar</button>
          <button type="button" class="btn danger" data-ins-act="remove" ${isMine ? "" : "disabled"}>Retirar da arena</button>
        </div>
      </div>
    </div>
  `;

  // handlers
  wrap.querySelector('[data-ins-act="move"]')?.addEventListener("click", () => {
    setStatus("ok", freeMove
      ? "deslocamento livre ativo: clique em qualquer lugar da arena para reposicionar o pokémon"
      : "Mover: clique no tile de destino na arena");
    // nada além disso: o click no tile já move a seleção atual
  });
  wrap.querySelector('[data-ins-act="roll-test"]')?.addEventListener("click", () => {
    if (!isMine || isTrainerPiece(p)) return;
    openPieceRollTestModal(p);
  });
  wrap.querySelector('[data-ins-act="free"]')?.addEventListener("click", () => {
    if (!isMine) return;
    togglePieceFreeMovement(selId, { select: false });
  });
  wrap.querySelector('[data-ins-act="dash"]')?.addEventListener("click", () => {
    if (!isMine) return;
    const cur = !!appState.movement.dashByPieceId[selId];
    appState.movement.dashByPieceId[selId] = !cur;
    if (!cur) setStatus("ok", "Standard aberta mão: deslocamento dobrado neste turno");
    else setStatus("ok", "deslocamento voltou ao valor base");
    updateSidePanels();
  });

  // Condições — tracking apenas
  wrap.querySelector('[data-ins-act="toggle-conds"]')?.addEventListener("click", () => {
    appState.inspectorCondsOpen = !appState.inspectorCondsOpen;
    updateSidePanels();
  });
  if (condsOpen) {
    mountInspectorConditionsPanel(wrap, p, { isMine }).catch((e) => {
      console.error(e);
      setStatus("err", "Falha ao carregar condições (afflictions.json)");
    });
  }
  wrap.querySelector('[data-ins-act="toggle"]')?.addEventListener("click", async () => {
    await togglePieceRevealed(selId);
  });
  wrap.querySelector('[data-ins-act="remove"]')?.addEventListener("click", async () => {
    await removePieceFromBoard(selId);
  });
  // HP segment bars — click sets HP to that segment value (dono only)
  wrap.querySelector('[data-ins-hpbars]')?.addEventListener("click", async (ev) => {
    if (!isMine) return; // apenas o dono pode alterar o HP
    const seg = ev.target.closest('[data-ins-act="hp-seg"]');
    if (!seg) return;
    const newHp = Number(seg.dataset.seg);
    if (!Number.isFinite(newHp)) return;
    // clicking active segment (= current hp) decrements by 1 (toggle off)
    const nextHp = newHp === hp ? Math.max(0, hp - 1) : newHp;
    await updatePartyStateHp(owner, p, nextHp);
  });

  _bindMegaControlButtons(wrap);
  return wrap;
}

function renderSheetsInspectorCard(wrap) {
  const by = safeStr(appState.by);
  const { partyPids, entries: sheetEntries } = _buildSelfSheetEntries(by);

  const byPid = {};
  for (const sh of (_allSheetsLatest || [])) {
    const pid = safePidValue(sh?.pokemon?.id);
    if (pid && !byPid[pid]) byPid[pid] = sh;
    const lp = safePidValue(sh?.linked_pid);
    if (lp && !byPid[lp]) byPid[lp] = sh;
    const nameKey = safePidValue(sh?.pokemon?.name);
    if (nameKey && !byPid[nameKey]) byPid[nameKey] = sh;
  }

  const seen = new Set();
  const sheets = [];
  for (const rawPid of partyPids) {
    const pid = safePidValue(rawPid);
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    const sh = byPid[pid] || byPid[(safeStr(pid).replace(/^0+/, "") || "0")];
    if (sh) sheets.push(Object.assign({}, sh, { _party_pid_raw: rawPid }));
  }

  if (!_sheetsSelectedPid || !sheetEntries.some((entry) => entry._selection_id === _sheetsSelectedPid)) {
    _sheetsSelectedPid = sheetEntries[0]?._selection_id || null;
  }

  const activeEntry = sheetEntries.find((entry) => entry._selection_id === _sheetsSelectedPid) || sheetEntries[0] || null;
  if (!activeEntry) {
    wrap.innerHTML = `
      <div class="inspector-empty">
        <div class="inspector-title">Fichas</div>
        <div class="muted">Selecione um card em Fichas para ver os detalhes completos.</div>
      </div>
    `;
    return wrap;
  }

  const sh = activeEntry.effectiveSheet || activeEntry.baseSheet;
  const baseSheet = activeEntry.baseSheet || sh;
  const pkm = sh?.pokemon || {};
  const pid = activeEntry._base_pid;
  const partyIdentity = activeEntry._party_entry || { pid, party_slot: activeEntry._party_slot };
  const ctx = _getEffectivePokemonContext(by, partyIdentity, { sheet: sh });
  const pidLabel = _sheetDisplayPid(sh, sh?._party_pid_raw) || "—";
  const pname = safeStr(ctx?.displayName || pkm.name) || "Pokémon";
  const types = (ctx?.resolvedTypes?.length ? ctx.resolvedTypes : getResolvedTypesForTrainerPid(by, partyIdentity, { sheet: sh })) || [];
  const abilities = (ctx?.resolvedAbilities?.length ? ctx.resolvedAbilities : getResolvedAbilitiesForTrainerPid(by, partyIdentity, { sheet: sh })) || [];
  const np = parseInt(sh.np || pkm.np || 0) || 0;
  const st = sh.stats || {};

  const movesRaw = Array.isArray(sh.moves) ? sh.moves : (sh.moves ? Object.values(sh.moves) : []);
  const moves = (movesRaw || []).filter((m) => m && typeof m === "object");
  const advantages = Array.isArray(sh.advantages) ? sh.advantages : [];
  const skills = Array.isArray(sh.skills) ? sh.skills : [];

  const stgr = parseInt(st.stgr || 0) || 0;
  const intel = parseInt(st["int"] || 0) || 0;
  let dodge = parseInt(st.dodge || 0) || 0;
  const parry = parseInt(st.parry || 0) || 0;
  const fort = parseInt(st.fortitude || 0) || 0;
  const will = parseInt(st.will || 0) || 0;
  let thg = parseInt(st.thg || 0) || 0;
  const cap = 2 * np;
  if (thg <= 0 && cap > 0) thg = Math.round(cap / 2);
  if (dodge <= 0 && cap > 0 && thg > 0) dodge = Math.max(0, cap - thg);

  const ps = _getPartyStateForSheet(by, baseSheet, partyIdentity);
  const hp = (ps.hp ?? 6);
  const cond = Array.isArray(ps.cond) ? ps.cond : [];
  const hpMax = 6;
  const hpUi = getHpUiState(hp);
  const hpPct = hpUi.pct;
  const hpCol = hpUi.color;
  const heldItem = getHeldItemForTrainerPid(by, activeEntry._party_entry || pid || activeEntry._party_pid_raw || pname);
  const megaControlsHtml = _renderMegaControlsHtml(by, pid, activeEntry);
  const megaFxActive = !!getMegaEvolutionFxState(by, pid);
  // Boosts temporários de stat
  const statBoosts = ps.stat_boosts || {};
  const sheetBoardPiece = findBoardPieceForSheet(by, sh, activeEntry._party_entry || sh?._party_pid_raw);
  const isOnBoard = !!sheetBoardPiece;
  // Resumo de movimento (velocidade/deslocamento) — usa peça em campo se existir,
  // senão calcula a partir da ficha para que a info fique disponível mesmo fora do mapa.
  const _mvBudgetSheet = sheetBoardPiece
    ? getPieceMovementBudget(sheetBoardPiece)
    : getPieceMovementBudget({ owner: by, pid, sheet: sh });
  const moveSummarySheet = (_mvBudgetSheet && Number.isFinite(Number(_mvBudgetSheet.speed)))
    ? `Velocidade ${_mvBudgetSheet.speed} • deslocamento ${_mvBudgetSheet.maxTiles % 1 ? "1/2" : _mvBudgetSheet.maxTiles} quadrado(s)`
    : "";

  const tp = (types || []).map((t) => _typePill(t)).join("");
  const abH = abilities.length ? `<div class="chip-row">${abilities.map((a) => `<span class="chip">${escapeHtml(a)}</span>`).join("")}</div>` : `<span class="muted">Sem abilities.</span>`;
  const condH = cond.length ? `<div class="chip-row">${cond.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join("")}</div>` : "";
  const matchupH = _typeMatchupHtml(types);

  let skH = `<span class="muted">Sem skills.</span>`;
  if (skills.length) {
    const chips = skills
      .filter((x) => x && typeof x === "object" && safeStr(x.name) && parseInt(x.ranks || 0))
      .map((x) => `<span class="chip">${escapeHtml(x.name)} R${parseInt(x.ranks || 0)}</span>`);
    if (chips.length) skH = `<div class="chip-row">${chips.join("")}</div>`;
  }

  const advChips = advantages.filter((a) => safeStr(a)).map((a) => `<span class="chip">${escapeHtml(a)}</span>`);
  const advH = advChips.length ? `<div class="chip-row">${advChips.join("")}</div>` : `<span class="muted">Sem advantages.</span>`;

  // Tenta obter tipos do alvo selecionado na arena para cálculo de tipo automático
  const _calcTarget = (() => {
    const selId = safeStr(appState.selectedPieceId);
    if (!selId) return { types: [], name: "" };
    const tp = (appState.pieces || []).find(p => p.id === selId);
    if (!tp) return { types: [], name: "" };
    const tpRevealed = (tp?.revealed != null) ? !!tp.revealed : true;
    if (!isPieceMine(tp) && !tpRevealed) return { types: [], name: "" };
    const tsh = getSheetForPiece(tp);
    const resolvedTypes = getResolvedTypesForTrainerPid(safeStr(tp?.owner), tp, { piece: tp, sheet: tsh });
    return { types: resolvedTypes, name: safeStr(tsh?.pokemon?.name || tp.pid) };
  })();

  // Aplica boosts de stats ao cálculo de dano da ficha
  const boostedSt = { ...st };
  for (const [k, v] of Object.entries(statBoosts)) {
    boostedSt[k] = (parseInt(boostedSt[k] || 0) || 0) + (parseInt(v || 0) || 0);
  }

  let mvH = "";
  if (!moves.length) {
    mvH = `<span class="muted">Sem golpes nesta ficha.</span>`;
  } else {
    moves.forEach((mv, mvIdx) => {
      const n = safeStr(mv.name || mv.Nome || mv.nome || "Golpe");
      // Usa stats com boosts ativos (se boost de Stgr/Int ativo, reflete no dano)
      const sum = _mvSum(mv, boostedSt);
      const { rk, acc, area, br, val, label: statLabel } = sum;
      const notesH = _sheetMoveNotesHtml(mv);
      const desc = safeStr(mv.description || mv.desc || mv.build || "Descrição não disponível.");
      // Resolve tipo do golpe: nome + fallback mv.meta.type / mv.type
      const mvType = getMoveType(n) || safeStr(mv?.meta?.type) || safeStr(mv?.type) || "";
      const mvColor = mvType ? getTypeColor(mvType) : "";
      const isStab = _isMoveStab(n, types) || (mvType && types.some(t => normalizeType(t) === normalizeType(mvType)));
      const stabBonus = isStab ? 2 : 0;
      const stabClass = isStab ? " move-stab" : "";
      const typeTag = mvType ? `<span class="mv-type-pill" style="background:${mvColor}33;border:1px solid ${mvColor}66;color:${mvColor}">${mvType}</span>` : "";

      // Bônus de tipo automático vs alvo selecionado
      const typeBonus = (_calcTarget.types.length && mvType) ? getTypeDamageBonus(mvType, _calcTarget.types) : 0;
      const targetBonusHtml = (_calcTarget.types.length && mvType)
        ? `<div class="dmg-row dmg-type-row"><span class="dmg-row-lbl">Tipo vs <em>${escapeHtml(_calcTarget.name)}</em></span><span class="dmg-row-val ${typeBonus > 0 ? 'dmg-pos' : typeBonus < 0 ? 'dmg-neg' : ''}">${typeBonus >= 0 ? '+' : ''}${typeBonus}</span></div>`
        : `<div class="dmg-row dmg-muted-row"><span class="dmg-row-lbl">Tipo <span class="muted">(selecione alvo na arena)</span></span><span class="dmg-row-val muted">±?</span></div>`;

      // Recupera modificadores persistidos entre trocas de aba
      const savedMod = getSheetMoveTempModifiers(pid, mvIdx, sh);
      const modKey = savedMod.key || `${pid || safeStr(sh?.sheet_id || sh?.id || pname)}::${mvIdx}`;
      const isMoveOpen = _sheetsOpenMoveKeys.has(modKey);
      const autoTotal = rk + stabBonus + typeBonus + savedMod.dmg;
      const aceiroTotal = acc + (statBoosts.acerto||0) + savedMod.acc;

      mvH += `
        <div class="move-expander${stabClass}${isMoveOpen ? " open" : ""}"${isStab ? ` style="--stab-color:${mvColor}"` : ""}
          data-mod-key="${escapeAttr(modKey)}">
          <div class="move-header">
            <span class="arrow">▶</span>
            <span class="move-h-name" style="${mvColor ? `color:${mvColor}` : ""}">${escapeHtml(n)}</span>
            ${typeTag}
            <span class="mv-pill rk">R${rk}</span>
            <span class="mv-pill area">${area ? "Área" : "Alvo"}</span>
          </div>
          <div class="move-body">
            <div class="mv-desc-text">${escapeHtml(desc)}</div>
            ${notesH}
            <div class="dmg-calc"
              data-dmg-calc
              data-mod-key="${escapeAttr(modKey)}"
              data-base-rk="${rk}"
              data-base-acc="${acc}"
              data-stab="${stabBonus}"
              data-type-bonus="${typeBonus}"
              data-aceiro-boost="${statBoosts.acerto||0}">
              <div class="dmg-calc-header">⚔️ Calcular Ação</div>
              <div class="dmg-breakdown">
                <div class="dmg-row dmg-base-row">
                  <span class="dmg-row-lbl">R${br} + ${escapeHtml(statLabel || "—")} ${val}${(statLabel === 'Stgr' && (statBoosts.stgr||0) !== 0) ? ` <span style="color:#4ade80;font-size:10px">(+${statBoosts.stgr} boost)</span>` : (statLabel === 'Int' && (statBoosts.int||0) !== 0) ? ` <span style="color:#4ade80;font-size:10px">(+${statBoosts.int} boost)</span>` : ''}</span>
                  <span class="dmg-row-val">= ${rk}</span>
                </div>
                ${isStab ? `<div class="dmg-row dmg-stab-row"><span class="dmg-row-lbl">STAB (mesmo tipo)</span><span class="dmg-row-val dmg-pos">+2</span></div>` : ""}
                ${targetBonusHtml}
                ${(statBoosts.acerto||0) !== 0 ? `<div class="dmg-row" style="opacity:.8"><span class="dmg-row-lbl">Boost Acerto</span><span class="dmg-row-val dmg-pos">${(statBoosts.acerto||0) > 0 ? '+' : ''}${statBoosts.acerto||0}</span></div>` : ""}
              </div>
              <div class="dmg-modifiers">
                <label class="dmg-mod-lbl">
                  <span>Mod. Acerto</span>
                  <input class="dmg-mod-input" type="number" value="${savedMod.acc}" data-mod="acc" step="1" placeholder="0">
                </label>
                <label class="dmg-mod-lbl">
                  <span>Mod. Dano</span>
                  <input class="dmg-mod-input" type="number" value="${savedMod.dmg}" data-mod="dmg" step="1" placeholder="0">
                </label>
              </div>
              <div class="dmg-result">
                <span class="dmg-res-chip dmg-acc-chip">Acerto: <strong class="dmg-live-acc">A+${aceiroTotal}</strong></span>
                <span class="dmg-res-chip dmg-dmg-chip">Dano: <strong class="dmg-live-dmg">R${autoTotal}</strong></span>
              </div>
            </div>
          </div>
        </div>
      `;
    });
  }

  const art = getSpriteUrlForPiece({ owner: by, pid, party_slot: activeEntry._party_slot }, { type: "art", shiny: !!ps.shiny })
    || _artUrlFromPidForSheets(pname || pid, ps.shiny)
    || _spriteUrlFromPidForSheets(pname || pid)
    || "";
  const inspTypeBgStyle = _fichaTypeBg(types);

  wrap.innerHTML = `
    <div class="inspector-head">
      <div class="inspector-title">Ficha completa</div>
      <div class="inspector-sub mono">#${escapeHtml(pidLabel)} • NP ${np}</div>
    </div>
    <div class="inspector-card ficha-v2" style="display:block;${inspTypeBgStyle}">
      <div class="sheet-header">
        <div class="sheet-art-frame"><img class="sheet-art ${megaFxActive ? "mega-evolving" : ""}" src="${escapeAttr(art)}" alt="art" onerror="this.src='${escapeAttr(_spriteUrlFromPidForSheets(pid || pname))}'"/></div>
        <div style="flex:1; min-width:0;">
          <div class="sheet-name">${escapeHtml(pname)}</div>
          <div class="pill-row" style="margin-top:6px;">${tp}</div>
          ${matchupH}
          <div class="pill-row" style="margin-top:8px;">${abilities.map((a) => `<span class="chip ability-pill">${escapeHtml(a)}</span>`).join("")}</div>${condH}
          ${renderHeldItemSummaryHtml(heldItem, { label: "Item", size: "md" })}
          <div style="margin-top:10px;">
            <div class="hp-row"><span>HP</span><span>${hp} / ${hpMax}</span></div>
            <div class="hp-track"><div class="hp-fill" style="width:${hpPct}%;background:${hpCol};"></div></div>
          </div>
          ${moveSummarySheet ? `<div class="muted sheet-move-summary" style="margin-top:8px;font-size:13px">${escapeHtml(moveSummarySheet)}</div>` : ""}
          ${megaControlsHtml}
        </div>
      </div>
      <div class="stat-grid">
        <div class="stat-box"><div class="stat-label">Stgr</div><div class="stat-val">${stgr + (statBoosts.stgr||0)}<span class="stat-boost-badge" data-stat="stgr">${statBoosts.stgr ? (statBoosts.stgr>0?'+':'')+statBoosts.stgr : ''}</span></div></div>
        <div class="stat-box"><div class="stat-label">Int</div><div class="stat-val">${intel + (statBoosts.int||0)}<span class="stat-boost-badge" data-stat="int">${statBoosts.int ? (statBoosts.int>0?'+':'')+statBoosts.int : ''}</span></div></div>
        <div class="stat-box"><div class="stat-label">Thg</div><div class="stat-val">${thg + (statBoosts.thg||0)}<span class="stat-boost-badge" data-stat="thg">${statBoosts.thg ? (statBoosts.thg>0?'+':'')+statBoosts.thg : ''}</span></div></div>
        <div class="stat-box"><div class="stat-label">Dodge</div><div class="stat-val">${dodge + (statBoosts.dodge||0)}<span class="stat-boost-badge" data-stat="dodge">${statBoosts.dodge ? (statBoosts.dodge>0?'+':'')+statBoosts.dodge : ''}</span></div></div>
        <div class="stat-box"><div class="stat-label">Parry</div><div class="stat-val">${parry + (statBoosts.parry||0)}<span class="stat-boost-badge" data-stat="parry">${statBoosts.parry ? (statBoosts.parry>0?'+':'')+statBoosts.parry : ''}</span></div></div>
        <div class="stat-box"><div class="stat-label">Fort</div><div class="stat-val">${fort + (statBoosts.fort||0)}<span class="stat-boost-badge" data-stat="fort">${statBoosts.fort ? (statBoosts.fort>0?'+':'')+statBoosts.fort : ''}</span></div></div>
        <div class="stat-box"><div class="stat-label">Will</div><div class="stat-val">${will + (statBoosts.will||0)}<span class="stat-boost-badge" data-stat="will">${statBoosts.will ? (statBoosts.will>0?'+':'')+statBoosts.will : ''}</span></div></div>
        <div class="stat-box cap"><div class="stat-label">Cap</div><div class="stat-val">${cap}</div></div>
      </div>
      ${isOnBoard ? `
      <div class="stat-boost-panel" data-boost-owner="${escapeAttr(by)}" data-boost-pid="${escapeAttr(pid)}">
        <div class="stat-boost-title">⚡ Boost Temporário <span class="muted" style="font-weight:400;font-size:11px">(zera ao recolher)</span></div>
        <div class="stat-boost-grid">
          ${['dodge','parry','fort','will','thg','stgr','int','acerto'].map(s => `
            <div class="stat-boost-row">
              <span class="stat-boost-name">${s === 'int' ? 'Int' : s === 'acerto' ? 'Acerto' : s.charAt(0).toUpperCase()+s.slice(1)}</span>
              <button type="button" class="btn ghost stat-boost-btn" data-boost-stat="${s}" data-boost-delta="-1">−</button>
              <span class="stat-boost-val ${(statBoosts[s]||0) > 0 ? 'boost-pos' : (statBoosts[s]||0) < 0 ? 'boost-neg' : ''}">${(statBoosts[s]||0) > 0 ? '+' : ''}${statBoosts[s]||0}</span>
              <button type="button" class="btn ghost stat-boost-btn" data-boost-stat="${s}" data-boost-delta="1">+</button>
            </div>
          `).join('')}
        </div>
        ${Object.keys(statBoosts).length > 0 ? `<button type="button" class="btn ghost" style="width:100%;margin-top:6px;font-size:11px" data-boost-reset>↺ Zerar todos os boosts</button>` : ''}
      </div>` : `<div class="muted" style="font-size:11px;margin:6px 0;padding:6px;text-align:center">💤 Pokémon não está em campo — boosts indisponíveis</div>`}
      <div class="sheet-divider"></div>
      <div class="section-title">Skills</div>${skH}
      <div class="section-title">Advantages</div>${advH}
      <div class="sheet-divider"></div>
      <div class="section-title">Golpes</div>${mvH}
    </div>
  `;
  wrap.querySelectorAll(".move-expander .move-header").forEach((header, idx) => {
    const mv = moves[idx];
    if (!mv) return;
    const pills = Array.from(header.querySelectorAll(".mv-pill"));
    const statusPill = pills[pills.length - 1];
    if (statusPill) statusPill.outerHTML = _renderMoveModePill(mv);
  });

  wrap.querySelectorAll(".move-header").forEach((h) => {
    h.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const parent = h.parentElement;
      if (!parent) return;
      const now = Date.now();
      const lastToggleAt = Number(parent.dataset.lastToggleAt || 0);
      if (now - lastToggleAt < 220) return;
      parent.dataset.lastToggleAt = String(now);
      const nextOpen = !parent.classList.contains("open");
      parent.classList.toggle("open", nextOpen);
      const modKey = safeStr(parent.dataset.modKey);
      if (!modKey) return;
      if (nextOpen) _sheetsOpenMoveKeys.add(modKey);
      else _sheetsOpenMoveKeys.delete(modKey);
    });
  });
  _bindMegaControlButtons(wrap);

  // ── Calculadora de dano — atualização ao vivo + persistência de mods ──
  wrap.querySelectorAll("[data-dmg-calc]").forEach((calcDiv) => {
    const baseRk      = parseInt(calcDiv.dataset.baseRk)      || 0;
    const baseAcc     = parseInt(calcDiv.dataset.baseAcc)     || 0;
    const stab        = parseInt(calcDiv.dataset.stab)        || 0;
    const typeB       = parseInt(calcDiv.dataset.typeBonus)   || 0;
    const aceiroBoost = parseInt(calcDiv.dataset.aceiroBoost) || 0;
    const modKey      = calcDiv.dataset.modKey || "";
    const liveAcc  = calcDiv.querySelector(".dmg-live-acc");
    const liveDmg  = calcDiv.querySelector(".dmg-live-dmg");
    const update = () => {
      const modAcc = parseInt(calcDiv.querySelector('[data-mod="acc"]')?.value) || 0;
      const modDmg = parseInt(calcDiv.querySelector('[data-mod="dmg"]')?.value) || 0;
      // Persiste para sobreviver a trocas de aba
      if (modKey) _sheetsMods[modKey] = { acc: modAcc, dmg: modDmg };
      // Acerto: base do golpe + boost de acerto global + modificador manual
      if (liveAcc) liveAcc.textContent = `A+${baseAcc + aceiroBoost + modAcc}`;
      // Dano: base (já inclui stat boost) + STAB + tipo + modificador manual
      if (liveDmg) liveDmg.textContent = `R${baseRk + stab + typeB + modDmg}`;
    };
    calcDiv.querySelectorAll(".dmg-mod-input").forEach(inp => inp.addEventListener("input", update));
  });
  // ─────────────────────────────────────────────────────────────────────

  // ── Handlers de boost temporário ──────────────────────────────────
  const boostPanel = wrap.querySelector(".stat-boost-panel");
  if (boostPanel) {
    const boostOwner = boostPanel.dataset.boostOwner;
    const boostPid   = boostPanel.dataset.boostPid;

    boostPanel.querySelectorAll(".stat-boost-btn").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const stat  = btn.dataset.boostStat;
        const delta = Number(btn.dataset.boostDelta);
        if (!stat || !delta) return;
        btn.disabled = true;
        try {
          await updateStatBoost(boostOwner, boostPid, stat, delta);
          try { renderSheetsTab(); } catch {}
          try { updateSidePanels(); } catch {}
        } finally {
          btn.disabled = false;
        }
      });
    });

    const resetBtn = boostPanel.querySelector("[data-boost-reset]");
    if (resetBtn) {
      resetBtn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        resetBtn.disabled = true;
        const db  = currentDb;
        const rid = currentRid;
        if (!db || !rid) {
          resetBtn.disabled = false;
          return;
        }
        const psRef = doc(db, "rooms", rid, "public_state", "party_states");
        try {
          await setDoc(psRef, { [boostOwner]: { [boostPid]: { stat_boosts: null } } }, { merge: true });
          const root = (_partyStates && typeof _partyStates === "object") ? _partyStates : {};
          const bucket = root[boostOwner] && typeof root[boostOwner] === "object" ? root[boostOwner] : {};
          root[boostOwner] = { ...bucket, [boostPid]: { ...(bucket[boostPid] || {}), stat_boosts: null } };
          _partyStates = root;
          try { window._partyStates = _partyStates; } catch {}
          try { renderSheetsTab(); } catch {}
          try { updateSidePanels(); } catch {}
        } finally {
          resetBtn.disabled = false;
        }
      });
    }
  }
  // ──────────────────────────────────────────────────────────────────

  return wrap;
}

function updateSidePanels() {
  const by = safeStr(appState.by);
  const pieces = Array.isArray(appState.pieces) ? appState.pieces : [];
  syncArenaOverlayLayout();

  // Render pokébolas (Time / posicionamento)
  renderPartyWindow();
  renderArenaSheetPreview();

  // Botão de cancelar: só aparece quando estiver armado
  try {
    const placingPid = getPlacingPokemonPid();
    const placingIdentity = getPlacingPokemonPartySlot()
      ? { pid: placingPid, party_slot: getPlacingPokemonPartySlot() }
      : placingPid;
    if (cancelPlaceBtn) cancelPlaceBtn.style.display = placingPid ? "" : "none";
    const armedLabel = document.getElementById("armed_label");
    if (armedLabel) {
      armedLabel.textContent = placingPid ? `Pronto: ${displayNameFromPid(placingIdentity, { owner: by })}` : "—";
    }
  } catch {}

  // Inspector (direita)
  const inspectorRoot = $("inspector_root");
  if (inspectorRoot) {
    inspectorRoot.innerHTML = "";
    inspectorRoot.appendChild(renderInspectorCard());
  }

  // Oponentes (secundário, colapsável)
  const oppPiecesRaw = by
    ? pieces.filter((p) => safeStr(p?.owner) && safeStr(p?.owner) !== by && safeStr(p?.status || "active") !== "deleted")
    : pieces;
  const oppPieces = (oppPiecesRaw || []).filter((p) => isPieceVisibleToMe(p));

  const oppRoot = $("opp_list");
  if (oppRoot) {
    oppRoot.innerHTML = "";
    const grouped = new Map();
    for (const p of oppPieces) {
      const o = safeStr(p?.owner) || "—";
      if (!grouped.has(o)) grouped.set(o, []);
      grouped.get(o).push(p);
    }
    const knownOwners = new Set(Array.from(grouped.keys()));
    for (const p of (oppPiecesRaw || [])) {
      const o = safeStr(p?.owner);
      if (o && o !== by) knownOwners.add(o);
    }
    for (const pl of (appState.players || [])) {
      const o = safeStr(pl?.trainer_name);
      if (o && o !== by) knownOwners.add(o);
    }
    const oppOwners = Array.from(knownOwners).sort((a, b) => a.localeCompare(b));
    if (oppCount) oppCount.textContent = String(oppOwners.length);

    for (const owner of oppOwners) {
      const ownerBox = document.createElement("div");
      ownerBox.className = "pvp-opp-group";
      const initial = owner.charAt(0).toUpperCase();
      const hdr = document.createElement("div");
      hdr.className = "pvp-opp-header";
      const visiblePieces = grouped.get(owner) || [];
      hdr.innerHTML = `<div class="pvp-opp-avatar">${escapeHtml(initial)}</div><div class="pvp-opp-name">🔴 ${escapeHtml(owner)}</div><div class="pvp-opp-count">${Math.max(visiblePieces.length, getPartyForTrainer(owner).length)}</div>`;
      ownerBox.appendChild(hdr);

      const oppParty = getPartyForTrainer(owner);
      if (oppParty.length > 0) {
        for (const it of oppParty) {
          const oppPid = safeStr(it?.pid || it);
          const oppPiece = findBoardPieceForTrainer(owner, it || oppPid, { pieces: visiblePieces });
          const oppOnMap = !!oppPiece?.id;
          const oppRevealed = oppPiece ? !!oppPiece.revealed : false;
          const oppName = displayNameFromPid(it || oppPid, { owner }) || (oppPid.startsWith("EXT:") ? oppPid.slice(4) : oppPid);
          const row = document.createElement("div");
          row.className = "pvp-opp-row";
          row.innerHTML = `
            <div class="pvp-opp-mini">${oppRevealed ? "👁️" : "❔"}</div>
            <div class="pvp-opp-mon">${escapeHtml(oppRevealed ? oppName : "???" )}</div>
            <div class="pvp-opp-tag">${oppOnMap ? "em campo" : "fora"}</div>
          `;
          ownerBox.appendChild(row);
        }
      } else {
        const empty = document.createElement("div");
        empty.className = "muted tiny";
        empty.style.padding = "8px 10px";
        empty.textContent = "Sem party_snapshot";
        ownerBox.appendChild(empty);
      }

      oppRoot.appendChild(ownerBox);
    }
  }
  renderArenaHoverCard();
}


function renderPieceCard(p, isMine) {
  const { pid, id } = pieceDisplayName(p);
  const row = Number(p?.row);
  const col = Number(p?.col);
  const revealed = (p?.revealed != null) ? !!p.revealed : true; // default compat: sem flag = revelado
  const selected = safeStr(appState.selectedPieceId) && safeStr(appState.selectedPieceId) === safeStr(id);

  const card = document.createElement("div");
  card.className = `card ${selected ? "selected" : ""}`;
  card.dataset.pieceId = id;

  const _psCard = ((_partyStates && _partyStates[safeStr(p?.owner)]) ? _partyStates[safeStr(p?.owner)] : {})[safeStr(p?.pid)] || {};
  const spriteUrl = getSpriteUrlForPiece(p, { type: "art", shiny: !!_psCard.shiny });
  const spriteFallbackUrl = getSpriteFallbackUrlForPiece(p);
  const imgHtml = spriteUrl
    ? `<img class="mini" src="${escapeAttr(spriteUrl)}" alt="sprite" loading="lazy" data-fallback="${escapeAttr(spriteFallbackUrl)}" onerror="if(this.dataset.fallback && this.src!==this.dataset.fallback){this.src=this.dataset.fallback;}else{this.style.display='none'}"/>`
    : `<div class="avatar" style="width:40px;height:40px;border-radius:14px">#</div>`;

  card.innerHTML = `
    <div class="row" style="align-items:flex-start">
      ${imgHtml}
      <div style="flex:1; min-width:0">
        <div style="font-weight:950; line-height:1.1">${revealed ? `PID ${escapeHtml(pid)}` : "???"}</div>
        <div class="muted">id: <span class="mono">${escapeHtml(id)}</span></div>
        <div class="tiny" style="margin-top:6px">pos: <span class="mono">(${Number.isFinite(row) ? row : "?"}, ${Number.isFinite(col) ? col : "?"})</span> • ${safeStr(p?.status) || "active"}</div>
      </div>
      <button class="btn ghost" style="padding:8px 10px" title="Selecionar">🎯</button>
    </div>
  `;
  const btn = card.querySelector("button");
  btn?.addEventListener("click", () => selectPiece(id));
  card.addEventListener("click", (ev) => {
    // Evita duplo disparo se clicar no botão
    if (ev.target?.tagName?.toLowerCase() === "button") return;
    selectPiece(id);
  });
  return card;
}

function renderPieceMiniRow(p) {
  const { pid, id } = pieceDisplayName(p);
  const row = Number(p?.row);
  const col = Number(p?.col);
  const revealed = (p?.revealed != null) ? !!p.revealed : true; // default compat: sem flag = revelado
  const _psMini = ((_partyStates && _partyStates[safeStr(p?.owner)]) ? _partyStates[safeStr(p?.owner)] : {})[safeStr(p?.pid)] || {};
  const spriteUrl = getSpriteUrlForPiece(p, { type: "art", shiny: !!_psMini.shiny });
  const spriteFallbackUrl = getSpriteFallbackUrlForPiece(p);

  const wrap = document.createElement("div");
  wrap.className = "row";
  wrap.style.padding = "8px 0";
  wrap.style.borderTop = "1px dashed rgba(148,163,184,.14)";

  const img = document.createElement("img");
  img.className = "mini";
  img.style.width = "34px";
  img.style.height = "34px";
  if (spriteUrl) img.src = spriteUrl;
  img.alt = "sprite";
  img.loading = "lazy";
  img.dataset.fallback = spriteFallbackUrl;
  img.onerror = () => {
    if (img.dataset.fallback && img.src !== img.dataset.fallback) img.src = img.dataset.fallback;
    else img.style.display = "none";
  };
  wrap.appendChild(img);

  const mid = document.createElement("div");
  mid.style.flex = "1";
  mid.style.minWidth = "0";
  mid.innerHTML = `
    <div style="font-weight:900">${revealed ? `PID ${escapeHtml(pid)}` : "???"}</div>
    <div class="tiny mono">${escapeHtml(id)} • (${Number.isFinite(row) ? row : "?"}, ${Number.isFinite(col) ? col : "?"})</div>
  `;
  wrap.appendChild(mid);

  const btn = document.createElement("button");
  btn.className = "btn ghost";
  btn.style.padding = "8px 10px";
  btn.textContent = "👁️";
  btn.title = "Selecionar";
  btn.addEventListener("click", () => selectPiece(id));
  wrap.appendChild(btn);

  return wrap;
}

// -------------------------
// Logs (incremental append)
// -------------------------
function logKey(l, idx) {
  const at = l?.at?.seconds != null ? `${l.at.seconds}:${l.at.nanoseconds || 0}` : "";
  const by = safeStr(l?.by) || "";
  const text = safeStr(l?.text || l?.payload?.text || "");
  return `${idx}|${at}|${by}|${text}`;
}

function fmtTimestamp(at) {
  try {
    if (!at) return "";
    if (typeof at === "string") return at;
    if (at?.seconds != null) {
      const ms = Number(at.seconds) * 1000 + Math.floor(Number(at.nanoseconds || 0) / 1e6);
      const d = new Date(ms);
      return d.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }
  } catch {}
  return "";
}

// Classifica um log em "dice" (dados/rolagens), "move" (movimento) ou "battle" (padrão).
function classifyLog(l) {
  const raw = safeStr(l?.text || l?.payload?.text || "");
  const t = raw.toLowerCase();
  const kind = safeStr(l?.kind || l?.type || l?.category || "").toLowerCase();
  if (kind === "dice" || kind === "roll" || kind === "dado" || kind === "dados") return "dice";
  if (kind === "move" || kind === "movement" || kind === "movimento") return "move";
  if (kind === "battle" || kind === "combat" || kind === "batalha") return "battle";
  // Heurísticas por texto
  if (/\b(rolou|rolagem|d20|d\d{1,3}\b|🎲|iniciativa)/i.test(t)) return "dice";
  if (/\b(moveu|movimento|movimentou|deslocou|deslocamento|mover(?:-se)?|anda para|andou|→\s*\(|posi[çc][aã]o|quadrado[s]?\b)/i.test(t)) return "move";
  return "battle";
}

// Tenta extrair um pieceId / pid do texto do log — usado para esconder o movimento
// de Pokémon ocultos (que não foram revelados) para jogadores que não são donos da peça.
function _logReferencesHiddenPiece(l) {
  const by = safeStr(appState.by);
  const author = safeStr(l?.by);
  // Se o usuário atual é o autor (ou dono da peça), sempre mostra
  if (author && author === by) return false;

  const text = safeStr(l?.text || l?.payload?.text || "");
  const payloadPieceId = safeStr(l?.payload?.pieceId || l?.payload?.piece_id || l?.pieceId || "");
  const pieces = Array.isArray(appState.pieces) ? appState.pieces : [];

  // 1) Se o payload traz pieceId, verifica direto
  if (payloadPieceId) {
    const p = pieces.find((pc) => safeStr(pc?.id) === payloadPieceId);
    if (p) {
      const revealed = (p?.revealed != null) ? !!p.revealed : true;
      if (!revealed && !isPieceMine(p)) return true;
      return false;
    }
  }
  // 2) Busca no texto qualquer pid/id de peça oculta que seja do adversário
  for (const p of pieces) {
    if (isPieceMine(p)) continue;
    const revealed = (p?.revealed != null) ? !!p.revealed : true;
    if (revealed) continue;
    const pid = safeStr(p?.pid);
    const id = safeStr(p?.id);
    if (pid && text.includes(pid)) return true;
    if (id && text.includes(id)) return true;
  }
  // 3) Por autor: se o autor é um oponente e o log é sobre uma peça oculta dele
  if (author && author !== by) {
    const hasHidden = pieces.some((p) => safeStr(p?.owner) === author && !(p?.revealed != null ? !!p.revealed : true));
    // Heurística: logs de movimento sem identificação explícita ainda podem revelar a
    // posição de uma peça oculta do oponente → esconda por segurança.
    if (hasHidden && /\b(moveu|movimento|deslocou|→\s*\()/i.test(text)) return true;
  }
  return false;
}

// Seleciona a sub-aba de log ativa. Persiste em appState.
function _setActiveLogSubtab(kind) {
  const valid = ["battle", "move", "dice"];
  const k = valid.includes(kind) ? kind : "battle";
  appState.activeLogSubtab = k;
  const root = document.getElementById("log_subtabs");
  if (root) {
    root.querySelectorAll(".log-subtab").forEach((btn) => {
      const on = btn.dataset.logKind === k;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }
  // Re-renderiza a lista com o filtro novo
  if (logList) {
    logList.innerHTML = "";
    appState.renderedLogKeys = new Set();
    renderLogsIncremental({ force: true });
  }
}

function renderLogsIncremental(opts = {}) {
  const logs = Array.isArray(appState.battle?.logs) ? appState.battle.logs : [];
  if (logCount) logCount.textContent = String(logs.length);
  if (!logList) return;

  const activeKind = safeStr(appState.activeLogSubtab) || "battle";

  // Pré-classifica para atualizar contadores por categoria
  const counts = { battle: 0, move: 0, dice: 0, hidden: 0 };
  for (const l of logs) {
    if (_logReferencesHiddenPiece(l)) { counts.hidden += 1; continue; }
    const k = classifyLog(l);
    counts[k] = (counts[k] || 0) + 1;
  }
  document.querySelectorAll("[data-log-count]").forEach((el) => {
    const k = el.dataset.logCount;
    if (k && counts[k] != null) el.textContent = String(counts[k]);
  });

  // primeira carga: renderiza os mais recentes (até 200) do filtro atual
  const max = 200;
  const startIdx = Math.max(0, logs.length - max);
  const fragment = document.createDocumentFragment();

  for (let i = startIdx; i < logs.length; i++) {
    const l = logs[i] || {};
    // Filtra movimentos de peças ocultas (antes de tudo, nunca aparecem)
    if (_logReferencesHiddenPiece(l)) continue;
    // Filtra por aba ativa
    if (classifyLog(l) !== activeKind) continue;
    const key = `${activeKind}|${logKey(l, i)}`;
    if (!opts.force && appState.renderedLogKeys.has(key)) continue;
    appState.renderedLogKeys.add(key);
    fragment.appendChild(renderLogItem(l));
  }

  if (fragment.childNodes.length) {
    logList.appendChild(fragment);
    // auto-scroll se estiver no final
    const nearBottom = logList.scrollHeight - logList.scrollTop - logList.clientHeight < 80;
    if (nearBottom) logList.scrollTop = logList.scrollHeight;
  }
}

function renderLogItem(l) {
  const box = document.createElement("div");
  const kind = classifyLog(l);
  box.className = `log-item log-item-${kind}`;
  const by = safeStr(l?.by) || "manual";
  const at = fmtTimestamp(l?.at);
  const text = safeStr(l?.text || l?.payload?.text || "");
  const kindLabel = kind === "battle" ? "⚔️" : kind === "move" ? "🚶" : "🎲";
  box.innerHTML = `
    <div class="head">
      <div class="by">${kindLabel} ${escapeHtml(by)}</div>
      <div class="at">${escapeHtml(at)}</div>
    </div>
    <div class="text">${escapeHtml(text)}</div>
  `;
  return box;
}

// -------------------------
// Arena canvas (render loop)
// -------------------------
const spriteCache = new Map(); // url -> {img, ready, failed}

function loadSprite(url) {
  if (!url) return null;
  if (spriteCache.has(url)) return spriteCache.get(url);
  const img = new Image();
  img.decoding = "async";
  const rec = { img, ready: false, failed: false };
  img.onload = () => (rec.ready = true);
  img.onerror = () => (rec.failed = true);
  img.src = url;
  spriteCache.set(url, rec);
  return rec;
}

const view = {
  // world -> screen transform
  scale: 1,
  offX: 0,
  offY: 0,
  autoFit: true,
  showGrid: true,
};

window.__arenaView = view; // expõe o view para patches (drawing, etc)

function canUseArenaCanvas() {
  return !!(canvas && ctx && useCanvas);
}

function getArenaRenderMode() {
  return arenaRenderMode;
}

function getArenaBoardLayout() {
  const gs = Math.max(1, Number(appState.gridSize) || 10);
  const wrapRect = canvasWrap?.getBoundingClientRect?.();
  if (!wrapRect || wrapRect.width <= 0 || wrapRect.height <= 0) return null;
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

  if (arenaRenderMode === "canvas" && Number.isFinite(view.scale) && view.scale > 0) {
    return {
      mode: "canvas",
      gs,
      width: gs * view.scale,
      height: gs * view.scale,
      tile: view.scale,
      clientLeft: wrapRect.left + Number(view.offX || 0),
      clientTop: wrapRect.top + Number(view.offY || 0),
      relLeft: Number(view.offX || 0),
      relTop: Number(view.offY || 0),
      dpr,
    };
  }

  const board = getArenaBoardMetrics();
  return {
    mode: arenaRenderMode === "dom" ? "dom" : "fallback",
    gs,
    width: board.side,
    height: board.side,
    tile: board.tile,
    clientLeft: wrapRect.left + board.left,
    clientTop: wrapRect.top + board.top,
    relLeft: board.left,
    relTop: board.top,
    dpr,
  };
}

function syncArenaPresentation() {
  if (canvas) canvas.style.display = arenaRenderMode === "canvas" ? "block" : "none";
  if (arenaDom) arenaDom.style.display = arenaRenderMode === "dom" ? "grid" : "none";
  syncSpriteOverlayVisibility();
}

function cancelArenaCanvasFrame() {
  if (!arenaFrameHandle) return;
  cancelAnimationFrame(arenaFrameHandle);
  arenaFrameHandle = 0;
}

function requestArenaCanvasFrame() {
  if (!canUseArenaCanvas()) return;
  if (arenaRenderMode !== "canvas") return;
  if (arenaFrameHandle) return;
  arenaFrameHandle = requestAnimationFrame(draw);
}

function activateCanvasMode(reason = "boot-canvas") {
  if (!canUseArenaCanvas()) {
    activateDomMode("context-failure");
    return;
  }
  arenaRenderMode = "canvas";
  arenaRenderReason = reason;
  syncArenaPresentation();
  requestArenaCanvasFrame();
}

function activateDomMode(reason = "manual-dom", error = null) {
  const wasMode = arenaRenderMode;
  const wasReason = arenaRenderReason;
  arenaRenderMode = "dom";
  arenaRenderReason = reason;
  cancelArenaCanvasFrame();
  syncArenaPresentation();
  syncArenaDomIfNeeded(true);
  if (error) {
    console.error("[arena] DOM fallback reason:", reason, error);
  } else if (wasMode !== "dom" || wasReason !== reason) {
    console.warn("[arena] DOM fallback reason:", reason);
  }
  if ((wasMode !== "dom" || wasReason !== reason) && (reason === "context-failure" || reason === "frame-error")) {
    try {
      setStatus("warn", "canvas indisponivel; fallback DOM ativado");
    } catch {}
  }
}

function requestArenaRefresh(force = false) {
  syncSpriteOverlayVisibility();
  if (arenaRenderMode === "dom") {
    syncArenaDomIfNeeded(force);
  } else if (arenaRenderMode === "canvas") {
    requestArenaCanvasFrame();
  }
}


// DOM fallback grid cache
let domGridSize = 0;
let domCells = []; // flat [row*gs+col] -> element

function updateHudViewportHeight() {
  const hero = document.querySelector(".hero-header");
  const scoreboard = document.getElementById("scoreboard");

  const heroH = hero?.offsetHeight || 0;
  const scoreH = (scoreboard && scoreboard.classList.contains("sb-visible")) ? (scoreboard.offsetHeight || 0) : 0;

  const viewport = window.innerHeight || document.documentElement.clientHeight || 0;
  const hudH = Math.max(320, viewport - heroH - scoreH - 16);

  document.documentElement.style.setProperty("--hud-viewport-height", `${hudH}px`);
}

function scheduleViewportStabilization({ includeSheets = false, includeArena = true, passes = 4 } = {}) {
  let remaining = Math.max(1, Number(passes) || 1);
  const run = () => {
    updateHudViewportHeight();
    if (useCanvas) {
      resizeCanvasToContainer();
      if (includeArena && safeStr(appState.activeTab) === "arena" && view.autoFit) fitToView();
    }
    if (includeArena) requestArenaRefresh(true);
    if (includeSheets) {
      try { renderSheetsTab(); } catch {}
    }
    remaining -= 1;
    if (remaining > 0) requestAnimationFrame(run);
  };
  requestAnimationFrame(run);
}

function resizeCanvasToContainer() {
  if (!canvasWrap || !canvas || !ctx) return false;
  const rect = canvasWrap.getBoundingClientRect();
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const w = Math.max(320, Math.floor(rect.width));
  const h = Math.max(320, Math.floor(rect.height));
  const targetW = Math.floor(w * dpr);
  const targetH = Math.floor(h * dpr);
  // IMPORTANTE: atribuir canvas.width/height LIMPA o buffer.
  // Só fazemos isso se o tamanho realmente mudou — caso contrário, o canvas
  // ficaria piscando preto em cada ResizeObserver/stabilization pass que chamar
  // esta função sem precisar (causa raiz do flicker da arena).
  const sizeChanged = (canvas.width !== targetW) || (canvas.height !== targetH);
  if (sizeChanged) {
    canvas.width = targetW;
    canvas.height = targetH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (view.autoFit) fitToView();
    requestArenaCanvasFrame();
  }
  return sizeChanged;
}

  if (typeof ResizeObserver !== "undefined") {
    const onArenaViewportChange = () => {
      updateHudViewportHeight();
      if (useCanvas) resizeCanvasToContainer();
      if (useCanvas && view.autoFit) fitToView();
      requestArenaRefresh(true);
    };
  const ro = new ResizeObserver(() => {
    onArenaViewportChange();
  });
  ro.observe(canvasWrap);
  window.addEventListener("resize", () => {
    onArenaViewportChange();
  });
}

if (typeof MutationObserver !== "undefined") {
  const scoreboard = document.getElementById("scoreboard");
  if (scoreboard) {
    const mo = new MutationObserver(() => {
      scheduleViewportStabilization({
        includeArena: safeStr(appState.activeTab) === "arena",
        includeSheets: safeStr(appState.activeTab) === "sheets",
        passes: 4,
      });
    });
    mo.observe(scoreboard, { attributes: true, attributeFilter: ["class"] });
  }
}

updateHudViewportHeight();
window.addEventListener("load", () => {
  scheduleViewportStabilization({ includeArena: true, includeSheets: true, passes: 5 });
});
try {
  document.fonts?.ready?.then?.(() => {
    scheduleViewportStabilization({ includeArena: true, includeSheets: true, passes: 3 });
  });
} catch {}

function fitToView() {
  if (!canvasWrap) return false;
  const gs = appState.gridSize || 10;
  if (!Number.isFinite(gs) || gs <= 0) {
    view.scale = 0;
    view.offX = 0;
    view.offY = 0;
    return false;
  }
  const rect = canvasWrap.getBoundingClientRect();
  const pad = 20;
  const w = rect.width - pad * 2;
  const h = rect.height - pad * 2;
  const tile = Math.floor(Math.min(w / gs, h / gs));
  if (!Number.isFinite(tile) || tile <= 0) {
    view.scale = 0;
    view.offX = 0;
    view.offY = 0;
    return false;
  }
  view.scale = tile;
  view.offX = Math.floor((rect.width - gs * tile) / 2);
  view.offY = Math.floor((rect.height - gs * tile) / 2);
  return true;
}

$("btn_zoom_fit")?.addEventListener("click", () => {
  view.autoFit = true;
  const b = $("btn_zoom_fit");
  if (b) b.setAttribute("aria-pressed", "true");
  fitToView();
});
$("btn_center")?.addEventListener("click", () => {
  view.autoFit = false;
  const b = $("btn_zoom_fit");
  if (b) b.setAttribute("aria-pressed", "false");
  fitToView();
});

// Cancelar posicionamento (pokébola armada)
cancelPlaceBtn?.addEventListener("click", () => {
  if (!getPlacingPokemonPid()) return;
  clearPokemonPlacingMode();
  updateSidePanels();
  setStatus("ok", "posicionamento cancelado");
});

// Zoom manual (+ / -)
$("btn_zoom_in")?.addEventListener("click", () => {
  view.autoFit = false;
  const b = $("btn_zoom_fit");
  if (b) b.setAttribute("aria-pressed", "false");
  view.scale = Math.min(128, Math.floor(view.scale * 1.15));
});
$("btn_zoom_out")?.addEventListener("click", () => {
  view.autoFit = false;
  const b = $("btn_zoom_fit");
  if (b) b.setAttribute("aria-pressed", "false");
  view.scale = Math.max(16, Math.floor(view.scale / 1.15));
});

// Toggle grid
$("btn_toggle_grid")?.addEventListener("click", () => {
  view.showGrid = !view.showGrid;
  const b = $("btn_toggle_grid");
  if (b) b.setAttribute("aria-pressed", view.showGrid ? "true" : "false");
});

function screenToTile(x, y) {
  const gs = appState.gridSize || 10;
  const tx = Math.floor((x - view.offX) / view.scale);
  const ty = Math.floor((y - view.offY) / view.scale);
  if (tx < 0 || ty < 0 || tx >= gs || ty >= gs) return null;
  return { row: ty, col: tx };
}

function getPieceAt(row, col) {
  // Footprint-aware: retorna o piece mais "em cima" (maior z-index = menor size)
  const all = getPiecesAt(row, col);
  return all.length ? all[0] : null;
}

function getPiecesAt(row, col) {
  // Retorna todos os pieces visíveis cujo footprint inclui (row, col), ordenados por z-index desc
  const pieces = appState.pieces || [];
  const candidates = getPiecesOccupyingTile(row, col, pieces)
    .filter(p => isPieceVisibleToMe(p));
  candidates.sort((a, b) => {
    const za = getSizeDimensions(getPieceSizeCategory(a)).zIndex;
    const zb = getSizeDimensions(getPieceSizeCategory(b)).zIndex;
    return zb - za; // maior z-index (menor peça) primeiro
  });
  return candidates;
}

function buildPieceSpritePlacement(piece, allPieces = appState.pieces || [], opts = {}) {
  const row = Number(piece?.row);
  const col = Number(piece?.col);
  const tile = Number(opts.tile ?? view.scale);
  const ox = Number(opts.ox ?? view.offX);
  const oy = Number(opts.oy ?? view.offY);
  if (!Number.isFinite(row) || !Number.isFinite(col) || !Number.isFinite(tile) || tile <= 0) return null;

  const sizeCategory = getPieceSizeCategory(piece);
  const { tileW, tileH, zIndex } = getSizeDimensions(sizeCategory);
  const x = ox + col * tile;
  const y = oy + row * tile;
  const pad = Math.max(6, Math.floor(tile * 0.12));

  let spriteX = x + pad;
  let spriteY = y + pad;
  let spriteW = tile - pad * 2;
  let spriteH = tile - pad * 2;

  if (sizeCategory === SIZE_CATEGORIES.tiny) {
    const tinyOnTile = getPiecesOccupyingTile(row, col, allPieces)
      .filter((candidate) => getPieceSizeCategory(candidate) === SIZE_CATEGORIES.tiny && isPieceVisibleToMe(candidate));
    const slotIndex = Math.max(0, tinyOnTile.findIndex((candidate) => safeStr(candidate?.id) === safeStr(piece?.id)));
    const slot = getTinySlotPosition(slotIndex);
    spriteX = x + slot.offsetXRatio * tile;
    spriteY = y + slot.offsetYRatio * tile;
    spriteW = slot.sizeRatio * tile;
    spriteH = slot.sizeRatio * tile;
  } else if (sizeCategory === SIZE_CATEGORIES.large || sizeCategory === SIZE_CATEGORIES.huge) {
    const pad2 = Math.max(4, Math.floor(tile * 0.06));
    spriteX = x + pad2;
    spriteY = y + pad2;
    spriteW = tile * tileW - pad2 * 2;
    spriteH = tile * tileH - pad2 * 2;
  }

  const hitZIndex = mapLayersState.version === 2 && Number.isFinite(opts.sortY)
    ? 100 + Math.round(Number(opts.sortY) * 100)
    : zIndex;

  return {
    row,
    col,
    x,
    y,
    tileW,
    tileH,
    sizeCategory,
    spriteX,
    spriteY,
    spriteW,
    spriteH,
    hitZIndex,
  };
}

function resetPieceFieldFx() {
  _pieceScreenBounds = new Map();
  _piecePresenceCache = new Map();
  _pieceEnteringIds.clear();
  _pieceFieldFxBootstrapped = false;
  _spriteOverlay?.querySelectorAll?.(".piece-exit-ghost")?.forEach?.((node) => node.remove());
  _pieceFxOverlay?.querySelectorAll?.(".piece-exit-ghost")?.forEach?.((node) => node.remove());
  for (const entry of _spritePool.values()) {
    entry?.el?.classList?.remove?.("piece-entering");
  }
}

function spawnPieceExitGhost(piece, bounds) {
  if (!_pieceFxOverlay || !piece || !bounds) return;
  const liveEntry = _spritePool.get(safeStr(piece?.id));
  const _psPiece = ((_partyStates && _partyStates[safeStr(piece?.owner)]) ? _partyStates[safeStr(piece?.owner)] : {})[safeStr(piece?.pid)] || {};
  const src = liveEntry?.el?.currentSrc || liveEntry?.el?.src || getSpriteUrlForPiece(piece, { type: "battle", shiny: !!_psPiece.shiny }) || getSpriteFallbackUrlForPiece(piece);
  if (!src) return;

  const ghost = document.createElement("img");
  ghost.className = "spr-overlay-img piece-exit-ghost piece-exiting";
  ghost.draggable = false;
  ghost.loading = "eager";
  ghost.decoding = "async";
  ghost.alt = "";
  ghost.src = src;
  ghost.style.left = `${bounds.left}px`;
  ghost.style.top = `${bounds.top}px`;
  ghost.style.width = `${bounds.width}px`;
  ghost.style.height = `${bounds.height}px`;
  ghost.style.zIndex = String(bounds.hitZIndex || 1);
  ghost.setAttribute("aria-hidden", "true");
  applyCaptureBallThemeToElement(ghost, getCaptureBallForTrainerPid(safeStr(piece?.owner), piece));
  _pieceFxOverlay.appendChild(ghost);

  const cleanupGhost = () => ghost.remove();
  ghost.addEventListener("animationend", cleanupGhost, { once: true });
  window.setTimeout(cleanupGhost, PIECE_FIELD_FX_MS + 120);
}

function updatePieceFieldFx(activePieces, now = (window.performance?.now?.() ?? Date.now())) {
  const nextPresence = new Map();
  for (const piece of activePieces || []) {
    const id = safeStr(piece?.id);
    if (!id) continue;
    nextPresence.set(id, { ...piece });
  }

  if (!_pieceFieldFxBootstrapped) {
    if (appState.board == null) return;
    _piecePresenceCache = nextPresence;
    _pieceFieldFxBootstrapped = true;
    return;
  }

  for (const [id, prevPiece] of _piecePresenceCache) {
    if (nextPresence.has(id)) continue;
    _pieceEnteringIds.delete(id);
    spawnPieceExitGhost(prevPiece, _pieceScreenBounds.get(id) || null);
  }

  for (const [id] of nextPresence) {
    if (_piecePresenceCache.has(id)) continue;
    _pieceEnteringIds.set(id, now);
  }

  _piecePresenceCache = nextPresence;
}

function syncPieceEnteringClass(el, pieceId, now = (window.performance?.now?.() ?? Date.now())) {
  if (!el) return;
  const id = safeStr(pieceId);
  const startedAt = _pieceEnteringIds.get(id);
  if (!startedAt) {
    el.classList.remove("piece-entering");
    return;
  }
  if ((now - startedAt) >= PIECE_FIELD_FX_MS) {
    _pieceEnteringIds.delete(id);
    el.classList.remove("piece-entering");
    return;
  }
  el.classList.add("piece-entering");
}

function getCanvasPieceHitAtPoint(x, y, { mineOnly = false } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const hits = [];
  for (const piece of (appState.pieces || [])) {
    if (safeStr(piece?.status || "active") !== "active") continue;
    if (!isPieceVisibleToMe(piece)) continue;
    if (mineOnly && !isPieceMine(piece)) continue;

    const id = safeStr(piece?.id);
    if (!id) continue;
    const bounds = _pieceScreenBounds.get(id) || null;
    if (!bounds) continue;

    if (x < bounds.left || y < bounds.top) continue;
    if (x > (bounds.left + bounds.width) || y > (bounds.top + bounds.height)) continue;

    hits.push({ piece, bounds });
  }

  hits.sort((a, b) => {
    const zDelta = Number(b.bounds.hitZIndex || 0) - Number(a.bounds.hitZIndex || 0);
    if (zDelta !== 0) return zDelta;
    const areaA = Number(a.bounds.width || 0) * Number(a.bounds.height || 0);
    const areaB = Number(b.bounds.width || 0) * Number(b.bounds.height || 0);
    return areaA - areaB;
  });

  return hits[0]?.piece || null;
}

function getDomClickedPiece(ev, { mineOnly = false } = {}) {
  const token = ev.target?.closest?.(".token[data-piece-id]");
  if (!token) return null;
  const pieceId = safeStr(token.dataset.pieceId);
  if (!pieceId) return null;
  const piece = (appState.pieces || []).find((p) => safeStr(p?.id) === pieceId) || null;
  if (!piece || !isPieceVisibleToMe(piece)) return null;
  if (mineOnly && !isPieceMine(piece)) return null;
  return piece;
}

/**
 * Returns v2 map objects whose footprint includes grid tile (row, col).
 * Objects are sorted by descending sortY (topmost-rendered object first).
 */
function getMapObjectsAt(row, col) {
  if (mapLayersState.version !== 2) return [];
  const result = [];
  for (const obj of mapLayersState.objects) {
    const ox = Number(obj.x ?? -1);
    const oy = Number(obj.y ?? -1);
    const fw = Number(obj.footprint?.w ?? 1);
    const fh = Number(obj.footprint?.h ?? 1);
    if (col >= ox && col < ox + fw && row >= oy && row < oy + fh) {
      result.push(obj);
    }
  }
  // Sort by sortY descending so topmost (last-drawn) object is first
  result.sort((a, b) => {
    const sa = Number(a.y ?? 0) + (a.anchor?.ay ?? 1) * (a.footprint?.h ?? 1);
    const sb = Number(b.y ?? 0) + (b.anchor?.ay ?? 1) * (b.footprint?.h ?? 1);
    return sb - sa;
  });
  return result;
}

function getTurnKey() {
  const ts = appState?.battle?.turn_state || {};
  const round = Number(ts?.round || 0);
  const index = Number(ts?.index || 0);
  return `${round}:${index}`;
}

function normalizeDirection(delta) {
  const n = Number(delta);
  if (!Number.isFinite(n) || n === 0) return 0;
  return n > 0 ? 1 : -1;
}

function clampDirection(dr, dc) {
  return { dr: normalizeDirection(dr), dc: normalizeDirection(dc) };
}

function getSheetForPiece(piece) {
  if (!_partyEntryLookupKeys(piece).length) return null;
  const owner = safeStr(piece?.owner || appState.by);
  const resolved = _resolveSelfEffectiveSheet(piece, owner);
  return resolved?.effectiveSheet || resolved?.baseSheet || null;
}

function _hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function _sheetKind(sheet) {
  const explicit = safeStr(sheet?.sheet_kind).toLowerCase();
  if (explicit) return explicit;
  return safeStr(sheet?.mega_slug) ? "mega" : "base";
}

function _sheetIsMega(sheet) {
  return _sheetKind(sheet) === "mega";
}

function _sheetDocId(sheet) {
  return safeStr(sheet?._sheet_id || sheet?.sheet_id || sheet?.id);
}

function _getTrainerBucket(source, trainerName) {
  const data = (source && typeof source === "object") ? source : {};
  const direct = data?.[trainerName];
  if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;
  const targetKey = _trainerLookupKey(trainerName);
  for (const [rawKey, value] of Object.entries(data)) {
    if (_trainerLookupKey(rawKey) !== targetKey) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  }
  return {};
}

function _getPartyStateBucket(trainerName) {
  return _getTrainerBucket(_partyStates, trainerName);
}

function _getRoomPartyStateEntry(trainerName, pidLike) {
  const targetKeys = _partyEntryLookupKeys(pidLike);
  const resolved = _resolvePartyEntryIdentity(trainerName, pidLike);
  _pushPartyLookupKey(targetKeys, resolved?.entryId);
  _pushPartyLookupKey(targetKeys, resolved?.partySlot);
  _pushPartyLookupKey(targetKeys, resolved?.pid);
  if (!targetKeys.length) return null;
  const bucket = _getPartyStateBucket(trainerName);
  const payloadMatches = [];
  for (const [rawKey, entry] of Object.entries(bucket || {})) {
    if (targetKeys.includes(pidKey(rawKey))) {
      return entry || {};
    }
    const entryKeys = _partyEntryLookupKeys(entry);
    if (entryKeys.some((key) => targetKeys.includes(key))) {
      if (resolved?.entryId || resolved?.partySlot || _getEntryId(pidLike) || _getPartySlot(pidLike)) {
        return entry || {};
      }
      payloadMatches.push(entry || {});
    }
  }
  if (payloadMatches.length === 1) return payloadMatches[0];
  return null;
}

function _getPartyStateEntry(trainerName, pidLike) {
  const roomState = _getRoomPartyStateEntry(trainerName, pidLike);
  const globalPayload = _getGlobalEntryHpPayload(trainerName, pidLike);
  const hp = _resolveHpValue(roomState, globalPayload);
  if (hp != null) return { ...(roomState || {}), hp };
  return roomState;
}

function _getBattleMegaStateForTrainerPid(trainerName, pidLike) {
  const state = _getPartyStateEntry(trainerName, pidLike) || {};
  const snapshot = getPartySnapshotEntryForTrainerPid(trainerName, pidLike) || {};
  const hasExplicitMega = _hasOwn(state, "active_mega_slug");
  const activeMegaSlug = hasExplicitMega ? safeStr(state?.active_mega_slug) : safeStr(snapshot?.active_mega_slug);
  const explicitCancel = hasExplicitMega && !activeMegaSlug;
  const pick = (key) => {
    if (_hasOwn(state, key)) return state?.[key];
    if (explicitCancel) return null;
    return snapshot?.[key] ?? null;
  };
  return {
    state,
    snapshot,
    hasExplicitMega,
    activeMegaSlug,
    effectiveSheetId: explicitCancel ? "" : safeStr(pick("effective_sheet_id")),
    effectiveSheetKind: explicitCancel ? "" : safeStr(pick("effective_sheet_kind")),
    effectivePokemon: explicitCancel ? null : (pick("effective_pokemon") || null),
    effectiveNp: explicitCancel ? null : pick("effective_np"),
  };
}

function _buildSheetCollections(sheets) {
  const list = Array.isArray(sheets) ? sheets : [];
  const baseByKey = new Map();
  const baseListsByKey = new Map();
  const byId = new Map();
  const megaByBaseSheetId = new Map();
  const megaByBaseKey = new Map();
  const baseSheets = [];
  const pushMega = (map, rawKey, sheet) => {
    const keys = [];
    _pushPartyLookupKey(keys, rawKey);
    for (const key of keys) {
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(sheet);
    }
  };
  const pushBase = (rawKey, sheet) => {
    const keys = [];
    _pushPartyLookupKey(keys, rawKey);
    for (const key of keys) {
      if (!key) continue;
      if (!baseByKey.has(key)) baseByKey.set(key, sheet);
      if (!baseListsByKey.has(key)) baseListsByKey.set(key, []);
      const bucket = baseListsByKey.get(key);
      if (!bucket.includes(sheet)) bucket.push(sheet);
    }
  };
  for (const sheet of list) {
    const docId = _sheetDocId(sheet);
    if (docId && !byId.has(docId)) byId.set(docId, sheet);
    if (_sheetIsMega(sheet)) {
      const baseSheetId = safeStr(sheet?.base_sheet_id);
      if (baseSheetId) {
        if (!megaByBaseSheetId.has(baseSheetId)) megaByBaseSheetId.set(baseSheetId, []);
        megaByBaseSheetId.get(baseSheetId).push(sheet);
      }
      pushMega(megaByBaseKey, sheet?.base_pokemon_id, sheet);
      pushMega(megaByBaseKey, sheet?.base_pokemon_name, sheet);
      pushMega(megaByBaseKey, sheet?.linked_pid, sheet);
      continue;
    }
    baseSheets.push(sheet);
    pushBase(docId, sheet);
    if (docId) pushBase(`sheet:${docId}`, sheet);
    pushBase(sheet?.pokemon?.id, sheet);
    pushBase(sheet?.linked_pid, sheet);
    pushBase(sheet?.pokemon?.name, sheet);
  }
  return { baseByKey, baseListsByKey, baseSheets, byId, megaByBaseSheetId, megaByBaseKey };
}

function _sheetPokemonFormSlug(sheet) {
  return _normalizePokemonFormSlug(sheet?.pokemon?.name || sheet?.linked_pid || sheet?.pokemon?.id);
}

function _findBaseSheetInCollections(collections, pidLike, options = {}) {
  const targetKeys = _partyEntryLookupKeys(pidLike);
  if (!targetKeys.length) return null;
  const preferredFormSlug = _normalizePokemonFormSlug(options?.preferredFormSlug);
  const candidates = [];
  const seen = new Set();
  const push = (sheet) => {
    const key = _sheetDocId(sheet) || _sheetPokemonFormSlug(sheet) || safeStr(sheet?.pokemon?.name);
    if (!sheet || !key || seen.has(key)) return;
    seen.add(key);
    candidates.push(sheet);
  };
  for (const key of targetKeys) {
    for (const sheet of (collections?.baseListsByKey?.get?.(key) || [])) push(sheet);
  }
  if (preferredFormSlug) {
    const byForm = candidates.find((sheet) => _sheetPokemonFormSlug(sheet) === preferredFormSlug);
    if (byForm) return byForm;
  }
  return candidates[0] || null;
}

function _getMegaSheetsForBase(collections, baseSheet, pidLike) {
  const out = [];
  const seen = new Set();
  const add = (sheet) => {
    const key = _sheetDocId(sheet) || safeStr(sheet?.mega_slug || sheet?.pokemon?.name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(sheet);
  };
  const baseSheetId = _sheetDocId(baseSheet);
  if (baseSheetId) {
    for (const sheet of (collections?.megaByBaseSheetId?.get?.(baseSheetId) || [])) add(sheet);
  }
  const baseKeys = [];
  for (const rawKey of [pidLike, baseSheet?.pokemon?.id, baseSheet?.pokemon?.name, baseSheet?.linked_pid]) {
    _pushPartyLookupKey(baseKeys, rawKey);
  }
  for (const key of baseKeys) {
    for (const sheet of (collections?.megaByBaseKey?.get?.(key) || [])) add(sheet);
  }
  return out;
}

function _resolveEffectiveSheetFromCollections(collections, ownerName, pidLike, options = {}) {
  const requestedFormSlug = _normalizePokemonFormSlug(
    options?.preferredFormSlug
    || _getPreferredPokemonFormSource(ownerName, pidLike)?.formSlug
    || _inferBasePokemonFormSlug(ownerName, pidLike, options)
  );
  const baseSheet = _findBaseSheetInCollections(collections, pidLike, { preferredFormSlug: requestedFormSlug });
  const megaState = _getBattleMegaStateForTrainerPid(ownerName, pidLike);
  const megaSheets = baseSheet ? _getMegaSheetsForBase(collections, baseSheet, pidLike) : [];
  let effectiveSheet = baseSheet;
  const activeMegaSlug = options?.ignoreMega ? "" : safeStr(megaState?.activeMegaSlug).toLowerCase();
  if (activeMegaSlug) {
    const bySlug = megaSheets.find((sheet) => safeStr(sheet?.mega_slug).toLowerCase() === activeMegaSlug);
    if (bySlug) effectiveSheet = bySlug;
  }
  const effectiveSheetId = safeStr(megaState?.effectiveSheetId);
  if (!options?.ignoreMega && (!effectiveSheet || effectiveSheet === baseSheet) && effectiveSheetId && collections?.byId?.has?.(effectiveSheetId)) {
    const byIdSheet = collections.byId.get(effectiveSheetId);
    if (_sheetIsMega(byIdSheet)) effectiveSheet = byIdSheet;
  }
  const baseSheetFormSlug = _sheetPokemonFormSlug(baseSheet);
  return {
    baseSheet,
    effectiveSheet: effectiveSheet || baseSheet || null,
    megaSheets,
    activeMegaSlug: safeStr(activeMegaSlug || ""),
    megaState,
    requestedFormSlug,
    baseSheetFormSlug,
    baseSheetMatchesRequestedForm: !!requestedFormSlug && !!baseSheetFormSlug && baseSheetFormSlug === requestedFormSlug,
  };
}

function _resolveSelfEffectiveSheet(pidLike, ownerName = safeStr(appState.by), options = {}) {
  return _resolveEffectiveSheetFromCollections(_allSheetsCollections, ownerName, pidLike, options);
}

function _displayNameFromMegaSlug(slug) {
  const raw = safeStr(slug);
  if (!raw) return "";
  return humanizeInternalLabel(raw.replace(/\//g, "-")) || raw;
}

function _getEffectivePokemonContext(ownerName, pidLike, options = {}) {
  const owner = safeStr(ownerName);
  const piece = options?.piece || ((pidLike && typeof pidLike === "object" && !Array.isArray(pidLike) && safeStr(pidLike?.pid)) ? pidLike : null);
  const targetLike = piece || pidLike;
  const formSource = _getPreferredPokemonFormSource(owner, targetLike);
  const sex = _normalizePokemonSex(
    options?.sex
    || formSource?.sex
    || _getPreferredPokemonSexForTrainerPid(owner, targetLike)
  );
  const preferredFormSlug = _normalizePokemonFormSlug(
    options?.preferredFormSlug
    || formSource?.formSlug
    || _inferBasePokemonFormSlug(owner, targetLike, { piece, sheet: options?.sheet, source: formSource?.raw })
  );
  const isMine = _trainerLookupKey(ownerName) === _trainerLookupKey(appState.by);
  let resolved = null;
  let baseSheet = null;
  let effectiveSheet = null;
  if (isMine) {
    resolved = _resolveSelfEffectiveSheet(targetLike, ownerName, { preferredFormSlug });
    baseSheet = resolved?.baseSheet || null;
    effectiveSheet = resolved?.effectiveSheet || baseSheet || null;
  }
  const megaState = resolved?.megaState || _getBattleMegaStateForTrainerPid(ownerName, targetLike);
  const activeMegaSlug = safeStr(resolved?.activeMegaSlug || megaState?.activeMegaSlug);
  const effectivePokemon = megaState?.effectivePokemon;
  const matchedFormSheet = !!resolved?.baseSheetMatchesRequestedForm && !activeMegaSlug;
  const pokemon = activeMegaSlug
    ? (effectiveSheet?.pokemon || (effectivePokemon && typeof effectivePokemon === "object" ? effectivePokemon : null))
    : (effectiveSheet?.pokemon || baseSheet?.pokemon || null);
  const fallbackFormSlug = preferredFormSlug || _sheetPokemonFormSlug(baseSheet) || _sheetPokemonFormSlug(effectiveSheet);
  const formSlug = activeMegaSlug
    ? (_normalizePokemonFormSlug(pokemon?.name) || _normalizePokemonFormSlug(activeMegaSlug))
    : (matchedFormSheet ? (_sheetPokemonFormSlug(baseSheet) || fallbackFormSlug) : fallbackFormSlug);
  const displayName = activeMegaSlug
    ? (safeStr(pokemon?.name) || _displayNameFromMegaSlug(activeMegaSlug))
    : (matchedFormSheet ? safeStr(pokemon?.name) : safeStr(formSource?.displayName))
      || safeStr(pokemon?.name)
      || _humanizePokemonFormSlug(formSlug);
  const image = (!activeMegaSlug && !matchedFormSheet ? safeStr(formSource?.image) : "")
    || safeStr(_extractPokemonImageFromSource(pokemon))
    || (formSlug ? spriteUrlWithFallback(formSlug, "art", false, { sex }) : "");
  const resolvedTypes = activeMegaSlug
    ? _coerceResolvedTypes(pokemon?.types)
    : (matchedFormSheet ? _coerceResolvedTypes(pokemon?.types) : (formSource?.resolvedTypes || []));
  const resolvedAbilities = activeMegaSlug
    ? _coerceResolvedAbilities(pokemon?.abilities)
    : (matchedFormSheet ? _coerceResolvedAbilities(pokemon?.abilities) : (formSource?.resolvedAbilities || []));
  return {
    owner,
    pid: safeStr(targetLike?.pid ?? targetLike?.pokemon?.id ?? targetLike),
    partySlot: _getPartySlot(targetLike) || _getPartySlot(_getPartyEntryForTrainerPid(owner, targetLike)),
    pokemon,
    sheet: effectiveSheet || baseSheet || null,
    baseSheet,
    effectiveSheet: effectiveSheet || baseSheet || null,
    activeMegaSlug,
    megaState,
    formSource,
    sex,
    formSlug,
    displayName,
    image,
    resolvedTypes,
    resolvedAbilities,
    baseSheetMatchesRequestedForm: matchedFormSheet,
  };
}

function _getEffectivePokemonName(ownerName, pidLike) {
  return safeStr(_getEffectivePokemonContext(ownerName, pidLike)?.displayName);
}

function _getEffectivePokemonSlug(ownerName, pidLike) {
  const ctx = _getEffectivePokemonContext(ownerName, pidLike);
  return _normalizePokemonFormSlug(ctx?.formSlug || ctx?.pokemon?.name || ctx?.activeMegaSlug);
}

function _normalizePokeApiSlug(raw) {
  const input = safeStr(raw);
  if (!input) return "";

  const sharedSlug = (typeof spriteSlugFromPokemonName === "function")
    ? safeStr(spriteSlugFromPokemonName(input))
    : "";
  const base = sharedSlug || input;

  return canonicalizePokemonSlug(
    base
      .toLowerCase()
      .replace(/-alolan$/, "-alola")
      .replace(/-galarian$/, "-galar")
      .replace(/-hisuian$/, "-hisui")
      .replace(/-paldean$/, "-paldea")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
  );
}

function _getEffectivePokeApiSlug(ownerName, pidLike) {
  const effectiveSlug = _normalizePokeApiSlug(_getEffectivePokemonSlug(ownerName, pidLike));
  if (effectiveSlug) return effectiveSlug;
  return _pokeApiSlugFromPid(pidLike?.pid ?? pidLike?.pokemon?.id ?? pidLike);
}

function getEffectivePokemonPresentationForTrainerPid(ownerName, pidLike, options = {}) {
  const ctx = _getEffectivePokemonContext(ownerName, pidLike, options);
  return {
    owner: safeStr(ownerName),
    pid: safeStr(pidLike?.pid ?? pidLike?.pokemon?.id ?? pidLike),
    party_slot: safeStr(ctx?.partySlot),
    form_slug: safeStr(ctx?.formSlug),
    sex: safeStr(ctx?.sex),
    display_name: safeStr(ctx?.displayName),
    image: safeStr(ctx?.image),
    resolved_types: Array.isArray(ctx?.resolvedTypes) ? ctx.resolvedTypes.slice() : [],
    resolved_abilities: Array.isArray(ctx?.resolvedAbilities) ? ctx.resolvedAbilities.slice() : [],
    effective_sheet: ctx?.effectiveSheet || null,
    active_mega_slug: safeStr(ctx?.activeMegaSlug),
  };
}

function getEffectiveSpriteUrlForTrainerPid(ownerName, pidLike, options = {}) {
  const owner = safeStr(ownerName);
  const pid = safeStr(pidLike?.pid ?? pidLike?.pokemon?.id ?? pidLike);
  if (!pid) return "";
  return getSpriteUrlForPiece({ owner, pid, party_slot: _getPartySlot(pidLike) }, options);
}

function readSpeedFromStats(statsObj) {
  if (!statsObj || typeof statsObj !== "object") return 0;
  const keys = ["speed", "spe", "spd", "Speed", "velocidade", "vel"];
  for (const k of keys) {
    const n = Number(statsObj?.[k]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

// ── PokeAPI unified cache & fetcher ──────────────────────────────
// Unifica types, speed e height em um único fetch por slug.
const _pokeApiCache = new Map(); // slug → { speed, types, height } | "pending" | "error"
const _pokeApiPending = new Map(); // slug → Promise<{ speed, types, height } | null>

function _pokeApiSlugFromPid(pid) {
  const k = safeStr(pid);
  if (!k) return "";
  if (/^trainer_/i.test(k)) return "";
  let name = "";
  if (k.startsWith("EXT:")) {
    name = k.slice(4).trim();
  } else {
    name = dexNameFromPid(k) || k;
  }
  if (!name) return "";
  return _normalizePokeApiSlug(name);
}

function _pushPokeApiSlugCandidate(out, value) {
  const slug = _normalizePokeApiSlug(value);
  if (slug && !out.includes(slug)) out.push(slug);
}

function _pokeApiSlugCandidatesFromPiece(piece) {
  const out = [];
  const owner = safeStr(piece?.owner);
  if (owner) {
    const effectiveSlug = _getEffectivePokeApiSlug(owner, piece);
    _pushPokeApiSlugCandidate(out, effectiveSlug);
    const rootSlug = _inferCanonicalFormRoot(effectiveSlug);
    _pushPokeApiSlugCandidate(out, rootSlug);
    if (rootSlug) _pushPokeApiSlugCandidate(out, _defaultFormSlugForRoot(rootSlug));
  }
  _pushPokeApiSlugCandidate(out, _pokeApiSlugFromPid(piece?.pid ?? piece?.pokemon?.id ?? piece));
  return out;
}

function _getPokeApiCached(slug) {
  const v = _pokeApiCache.get(slug);
  return (v && v !== "pending" && v !== "error") ? v : null;
}

async function fetchPokeApiData(slug) {
  if (!slug) return null;
  const cached = _getPokeApiCached(slug);
  if (cached) return cached;
  if (_pokeApiCache.get(slug) === "error") return null;
  const pending = _pokeApiPending.get(slug);
  if (pending) return pending;

  const request = (async () => {
    _pokeApiCache.set(slug, "pending");
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const types = (data.types || [])
      .sort((a, b) => a.slot - b.slot)
      .map(t => { const n = String(t.type?.name || ""); return n.charAt(0).toUpperCase() + n.slice(1); })
      .filter(Boolean);
    const speedStat = data?.stats?.find(s => s.stat?.name === "speed");
    const entry = {
      speed:  speedStat ? Number(speedStat.base_stat) : 0,
      types,
      height: Number(data.height) || 0,
    };
    _pokeApiCache.set(slug, entry);
    try { _refreshResolvedRoomPieces(); } catch {}
    if (typeof updateSidePanels === "function") updateSidePanels();
    try { requestArenaRefresh(true); } catch {}
    try { window.requestScoreboardRefresh?.(); } catch {}
    return entry;
  })();

  _pokeApiPending.set(slug, request);
  try {
    return await request;
  } catch {
    _pokeApiCache.set(slug, "error");
    return null;
  } finally {
    _pokeApiPending.delete(slug);
  }
}

// Shims de compatibilidade — callers antigos continuam funcionando
async function fetchPokeApiTypes(slug) {
  if (!slug) return [];
  const cached = _getPokeApiCached(slug);
  if (cached) return cached.types;
  const v = _pokeApiCache.get(slug);
  if (v === "pending") return [];
  const data = await fetchPokeApiData(slug);
  return data?.types || [];
}

async function fetchPokeApiSpeed(pid) {
  const slug = _pokeApiSlugFromPid(pid);
  if (!slug) return 0;
  const cached = _getPokeApiCached(slug);
  if (cached) return cached.speed || 0;
  const v = _pokeApiCache.get(slug);
  if (v === "pending") return 0;
  const data = await fetchPokeApiData(slug);
  return data?.speed || 0;
}

// ── Size category resolver ───────────────────────────────────────
function getPieceSizeCategory(piece) {
  if (piece?.kind === "trainer") return SIZE_CATEGORIES.medium;
  const slugs = _pokeApiSlugCandidatesFromPiece(piece);
  for (const slug of slugs) {
    const cached = _getPokeApiCached(slug);
    if (cached && cached.height > 0) return getSizeCategory(cached.height);
  }
  const slugToFetch = slugs.find((slug) => {
    const v = _pokeApiCache.get(slug);
    return v !== "pending" && v !== "error";
  });
  if (slugToFetch) fetchPokeApiData(slugToFetch); // fire-and-forget
  if (isKnownSizeCategory(piece?.sizeCategory)) return safeStr(piece.sizeCategory);
  return SIZE_CATEGORIES.medium;
}

function isKnownSizeCategory(value) {
  return Object.values(SIZE_CATEGORIES).includes(safeStr(value));
}

function resolvePieceSizeForRules(piece) {
  if (!piece || typeof piece !== "object") return piece;
  const sizeCategory = getPieceSizeCategory(piece);
  return piece.sizeCategory === sizeCategory ? piece : { ...piece, sizeCategory };
}

function resolvePiecesSizeForRules(pieces) {
  return (pieces || []).map((piece) => resolvePieceSizeForRules(piece));
}

async function getPieceSizeCategoryAsync(piece) {
  if (piece?.kind === "trainer") return SIZE_CATEGORIES.medium;
  const slugs = _pokeApiSlugCandidatesFromPiece(piece);
  for (const slug of slugs) {
    const cached = _getPokeApiCached(slug);
    if (cached && cached.height > 0) return getSizeCategory(cached.height);
    const data = await fetchPokeApiData(slug);
    if (data && data.height > 0) return getSizeCategory(data.height);
  }
  return getPieceSizeCategory(piece);
}

function getPieceSpeed(piece) {
  const sh = getSheetForPiece(piece);
  const pid = safePidValue(piece?.pid);
  const owner = safeStr(piece?.owner);
  const ps = ((_partyStates && _partyStates[owner]) ? _partyStates[owner] : {})[pid] || {};
  const megaState = _getBattleMegaStateForTrainerPid(owner, pid);
  const effectiveSlug = _getEffectivePokeApiSlug(owner, pid);

  const candidates = [
    readSpeedFromStats(sh?.stats),
    readSpeedFromStats(sh?.pokemon?.stats),
    readSpeedFromStats(sh?.poke_stats),
    Number(sh?.speed),
    Number(sh?.pokemon?.speed),
    readSpeedFromStats(ps?.stats),
    readSpeedFromStats(piece?.stats),
    Number(piece?.speed),
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (megaState?.activeMegaSlug && effectiveSlug) {
      const cachedMega = _getPokeApiCached(effectiveSlug);
      if (cachedMega && cachedMega.speed > 0) return cachedMega.speed;
      const pendingMega = _pokeApiCache.get(effectiveSlug);
      if (pendingMega !== "pending") fetchPokeApiData(effectiveSlug);
    }
    return n;
  }

  // Try PokeAPI unified cache (sync read, async fetch if missing)
  const slug = effectiveSlug || _pokeApiSlugFromPid(pid);
  if (slug) {
    const cached = _getPokeApiCached(slug);
    if (cached && cached.speed > 0) return cached.speed;
    const v = _pokeApiCache.get(slug);
    if (v !== "pending") fetchPokeApiData(slug); // fire-and-forget
  }

  return 80; // default while fetching
}

function movementBySpeed(speed) {
  const spd = Number(speed) || 0;
  if (spd <= 40) return 0.5;
  if (spd <= 80) return 1;
  if (spd <= 100) return 2;
  if (spd <= 120) return 4;
  return 5;
}

function getPieceMovementBudget(piece) {
  const pieceId = safeStr(piece?.id);
  const speed = getPieceSpeed(piece);
  const baseTiles = movementBySpeed(speed);
  const dash = !!appState.movement?.dashByPieceId?.[pieceId];
  const maxTiles = dash ? baseTiles * 2 : baseTiles;
  return { speed, baseTiles, dash, maxTiles };
}

function isPieceFreeMovementEnabled(pieceId) {
  const pid = safeStr(pieceId);
  return !!pid && !!appState.movement?.freeByPieceId?.[pid];
}

function togglePieceFreeMovement(pieceId, opts = {}) {
  const pid = safeStr(pieceId);
  if (!pid) return false;
  const piece = (appState.pieces || []).find((item) => safeStr(item?.id) === pid) || null;
  if (!piece) {
    setStatus("warn", "peça não encontrada");
    return false;
  }
  if (!isPieceMine(piece)) {
    setStatus("err", "você só pode liberar deslocamento nas suas peças");
    return false;
  }

  const cur = isPieceFreeMovementEnabled(pid);
  if (cur) delete appState.movement.freeByPieceId[pid];
  else appState.movement.freeByPieceId[pid] = true;

  if (opts.select !== false) selectPiece(pid);

  setStatus(
    "ok",
    cur
      ? "deslocamento livre desativado: voltou a respeitar turno e alcance"
      : "deslocamento livre ativado: clique em qualquer lugar da arena para reposicionar o pokémon"
  );
  updateSidePanels();
  requestArenaRefresh(true);
  return !cur;
}

function updateMovementTurnState() {
  const next = getTurnKey();
  if (appState.movement.turnKey === next) return;
  appState.movement.turnKey = next;
  appState.movement.dashByPieceId = {};
}

function getReachableTileMap(piece) {
  const out = new Map();
  if (!piece) return out;
  const pieceId = safeStr(piece?.id);
  const row = Number(piece.row);
  const col = Number(piece.col);
  if (!Number.isFinite(row) || !Number.isFinite(col)) return out;

  const gs = Number(appState.gridSize) || 0;
  if (gs <= 0) return out;

  const sizeCategory = getPieceSizeCategory(piece);
  const allPieces = appState.pieces || [];
  const movingPiece = resolvePieceSizeForRules(piece);

  // Helper: checa se piece pode pousar no destino (footprint + stacking)
  const _canLand = (tr, tc) => {
    if (!isFootprintWithinGrid(tr, tc, sizeCategory, gs)) return false;
    return canPieceLandOn(movingPiece, tr, tc, allPieces).allowed;
  };

  if (pieceId && appState.movement?.freeByPieceId?.[pieceId]) {
    for (let r = 0; r < gs; r++) {
      for (let c = 0; c < gs; c++) {
        if (r === row && c === col) continue;
        if (!_canLand(r, c)) continue;
        out.set(`${r}:${c}`, { row: r, col: c, halfStep: false, free: true });
      }
    }
    return out;
  }

  const { maxTiles } = getPieceMovementBudget(piece);

  if (maxTiles < 1) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = row + dr;
        const nc = col + dc;
        if (!_canLand(nr, nc)) continue;
        out.set(`${nr}:${nc}`, { row: nr, col: nc, dr, dc, halfStep: true });
      }
    }
    return out;
  }

  const limit = Math.floor(maxTiles);
  for (let r = 0; r < gs; r++) {
    for (let c = 0; c < gs; c++) {
      const cheb = Math.max(Math.abs(r - row), Math.abs(c - col));
      if (cheb <= 0 || cheb > limit) continue;
      if (!_canLand(r, c)) continue;
      out.set(`${r}:${c}`, { row: r, col: c, halfStep: false });
    }
  }
  return out;
}

function selectPiece(pieceId) {
  const id = safeStr(pieceId);
  appState.selectedPieceId = id || null;
  appState.lastInteractedPieceId = id || null;

  if (selBadge) {
    const piece = (appState.pieces || []).find((item) => safeStr(item?.id) === id) || null;
    const selectionLabel = piece ? displayNameFromPiece(piece, { allowHiddenIdentity: false }) : "—";
    selBadge.textContent = `seleção: ${selectionLabel}`;
  }

  // preenche devtools move
  if (pieceIdInput) pieceIdInput.value = id || "";

  // atualiza cards selecionados (se existirem no HTML)
  try { updateSidePanels(); } catch (e) {
    // Se o layout ainda não tem os painéis, não deve travar o restante
    try { console.warn("[pvp] updateSidePanels falhou:", e); } catch {}
  }
  renderArenaHoverCard();
}

async function sendMoveSelected(toRow, toCol) {
  updateMovementTurnState();
  const pieceId = safeStr(appState.selectedPieceId);
  if (!pieceId) return;
  if (!canCurrentPlayerMovePiece(pieceId)) {
    if (!isCurrentTurnOwnerMe()) setStatus("err", "somente o jogador do turno pode mover");
    else setStatus("err", "você só pode mover peças suas");
    return;
  }

  const piece = (appState.pieces || []).find((p) => safeStr(p?.id) === pieceId) || null;
  if (!piece) return;

  const tileKey = `${Number(toRow)}:${Number(toCol)}`;
  const reach = getReachableTileMap(piece);
  const canReach = reach.get(tileKey);
  if (!canReach) {
    setStatus("err", "tile fora do deslocamento máximo permitido");
    return;
  }

  if (canReach.free) {
    await movePieceOnBoard(pieceId, Number(toRow), Number(toCol), { free: true });
    return;
  }

  const { maxTiles } = getPieceMovementBudget(piece);
  if (maxTiles < 1) {
    const fromRow = Number(piece.row);
    const fromCol = Number(piece.col);
    const first = clampDirection(Number(toRow) - fromRow, Number(toCol) - fromCol);
    if (first.dr === 0 && first.dc === 0) {
      setStatus("warn", "escolha uma direção adjacente para preparar o meio deslocamento");
      return;
    }

    const pending = appState.movement.halfStepIntentByPieceId[pieceId] || null;
    if (!pending) {
      appState.movement.halfStepIntentByPieceId[pieceId] = { ...first, turnKey: appState.movement.turnKey };
      setStatus("ok", "meio deslocamento preparado. No próximo turno, clique outra direção para completar o movimento.");
      return;
    }
    if (safeStr(pending.turnKey) === safeStr(appState.movement.turnKey)) {
      setStatus("warn", "meio deslocamento: aguarde o próximo turno para completar o vetor");
      return;
    }

    const vec = clampDirection((pending.dr || 0) + first.dr, (pending.dc || 0) + first.dc);
    const targetRow = fromRow + vec.dr;
    const targetCol = fromCol + vec.dc;
    const pSize = getPieceSizeCategory(piece);
    if (!isFootprintWithinGrid(targetRow, targetCol, pSize, Number(appState.gridSize) || 10)) {
      setStatus("err", "vetor final de meio deslocamento saiu da arena");
      appState.movement.halfStepIntentByPieceId[pieceId] = { ...first, turnKey: appState.movement.turnKey };
      return;
    }
    if (!canPieceLandOn(resolvePieceSizeForRules(piece), targetRow, targetCol, appState.pieces || []).allowed) {
      setStatus("err", "tile final ocupado para meio deslocamento");
      appState.movement.halfStepIntentByPieceId[pieceId] = { ...first, turnKey: appState.movement.turnKey };
      return;
    }

    delete appState.movement.halfStepIntentByPieceId[pieceId];
    await movePieceOnBoard(pieceId, targetRow, targetCol, { halfStep: true });
    return;
  }

  await movePieceOnBoard(pieceId, Number(toRow), Number(toCol));
}


function makePieceId() {
  return `pc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getPlacingPokemonPid() {
  // Prioridade: estado local do HUD (pokébola selecionada)
  if (armedPokemonId) return safeStr(armedPokemonId);
  // Backward compat: state antigo
  if (appState.placing && appState.placing.mode === "pokemon") return safeStr(appState.placing.pid);
  return safeStr(appState.placingPid);
}

function getPlacingPokemonPartySlot() {
  if (armedPokemonSlot) return _normalizePartySlot(armedPokemonSlot);
  if (appState.placing && appState.placing.mode === "pokemon") return _getPartySlot(appState.placing);
  return "";
}


function clearPokemonPlacingMode() {
  armedPokemonId = null;
  armedPokemonSlot = null;
  if (appState.placing && appState.placing.mode === "pokemon") appState.placing = null;
  appState.placingPid = null;
}


function startPlacePokemon(pidLike, options = {}) {
  const monPid = safeStr(pidLike?.pid ?? pidLike?.pokemon?.id ?? pidLike);
  const partySlot = _normalizePartySlot(options?.party_slot ?? options?.partySlot) || _getPartySlot(pidLike);
  const entryId = _getEntryId(pidLike);
  const identity = { pid: monPid, party_slot: partySlot || "", entry_id: entryId || "" };
  if (!monPid) return;
  armedPokemonId = monPid;
  armedPokemonSlot = partySlot;
  if (!appState.connected || !appState.rid) {
    setStatus("err", "conecte antes de colocar pokémon no mapa");
    return;
  }
  if (!safeStr(appState.by)) {
    setStatus("err", "preencha o campo by para colocar pokémon");
    return;
  }
  if (isPokemonKo(appState.by, identity)) {
    setStatus("err", "pokémon com HP 0 não pode ser posicionado");
    return;
  }
  if (isPokemonAlreadyOnBoard(appState.by, identity)) {
    setStatus("warn", "esse pokémon já está no campo");
    return;
  }
  appState.placing = { mode: "pokemon", trainer: safeStr(appState.by), pid: monPid, party_slot: partySlot, entry_id: entryId || "" };
  appState.placingPid = monPid;
  setStatus("ok", `Posicionamento ativo: ${displayNameFromPid(identity, { owner: appState.by })}. Clique em um tile vazio no mapa.`);
  updateSidePanels();
}

async function placePokemonOnBoardAt(pidLike, row, col) {
  const monPid = safeStr(pidLike?.pid ?? pidLike?.pokemon?.id ?? pidLike);
  const partySlot = _getPartySlot(pidLike) || getPlacingPokemonPartySlot();
  const entryId = _getEntryId(pidLike) || safeStr(appState.placing?.entry_id);
  const identity = { pid: monPid, party_slot: partySlot || "", entry_id: entryId || "" };
  const by = safeStr(appState.by);
  if (!monPid || !by) return;

  const r = Number(row);
  const c = Number(col);
  const sizeCategory = await getPieceSizeCategoryAsync({ pid: monPid });
  const gs = Number(appState.gridSize) || 10;

  if (!isFootprintWithinGrid(r, c, sizeCategory, gs)) {
    setStatus("err", "tile inválido ou pokémon não cabe na borda da arena");
    return;
  }
  if (isPokemonKo(by, identity)) {
    setStatus("err", "pokémon com HP 0 não pode ser posicionado");
    clearPokemonPlacingMode();
    updateSidePanels();
    try { renderSheetsTab(); } catch {}
    return;
  }
  if (isPokemonAlreadyOnBoard(by, identity)) {
    setStatus("warn", "esse pokémon já está no campo");
    clearPokemonPlacingMode();
    updateSidePanels();
    return;
  }

  // Pré-validação de stacking com size-rules
  const fakePiece = { id: "__placing__", pid: monPid, entry_id: entryId || null, party_slot: partySlot, sizeCategory };
  const preCheck = canPieceLandOn(fakePiece, r, c, appState.pieces || []);
  if (!preCheck.allowed) {
    setStatus("err", `tile ocupado: ${preCheck.reason}`);
    return;
  }

  try {
    const stateRef = getStateDocRef();
    if (!stateRef || !currentDb) {
      setStatus("err", "sem conexao com a sala");
      return;
    }

    const newId = makePieceId();
    const newPiece = {
      id: newId,
      owner: by,
      pid: monPid,
      entry_id: entryId || null,
      party_slot: partySlot || null,
      row: r,
      col: c,
      status: "active",
      revealed: true,
      sizeCategory,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await runTransaction(currentDb, async (tx) => {
      const snap = await tx.get(stateRef);
      const data = snap.exists() ? snap.data() : {};
      const pieces = Array.isArray(data?.pieces) ? data.pieces : [];
      const resolvedPieces = _resolveRoomPiecesPartySlots(pieces);
      const piecesForRules = resolvePiecesSizeForRules(resolvedPieces);
      const seen = Array.isArray(data?.seen) ? data.seen : [];

      // Revalida dentro da transaction com size-rules (evita corrida)
      const txFake = { id: "__placing__", pid: monPid, entry_id: entryId || null, party_slot: partySlot, sizeCategory };
      const txCheck = canPieceLandOn(txFake, r, c, piecesForRules);
      if (!txCheck.allowed) throw new Error(txCheck.reason);

      const already = !!findBoardPieceForTrainer(by, identity, { pieces: resolvedPieces });
      if (already) throw new Error("esse pokémon já está no campo");

      const nextPieces = pieces.concat([newPiece]);
      const nextSeen = seen.slice();
      if (newPiece.revealed) {
        const seenPid = safeStr(newPiece.pid);
        if (seenPid && !nextSeen.includes(seenPid)) nextSeen.push(seenPid);
      }
      tx.set(
        stateRef,
        {
          pieces: nextPieces,
          seen: nextSeen,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    });

    // Optimistic UI (o snapshot vai confirmar logo em seguida)
    try {
      appState.piecesRaw = Array.isArray(appState.piecesRaw) ? appState.piecesRaw : [];
      appState.piecesRaw = appState.piecesRaw.concat([newPiece]);
      _refreshResolvedRoomPieces();
      requestArenaRefresh(true);
      // canvas: o loop de render já vai pegar no próximo frame
    } catch {}

    clearPokemonPlacingMode();
    updateSidePanels();
    try { renderSheetsTab(); } catch {}
    setStatus("ok", "pokémon posicionado no campo");
  } catch (e) {
    setStatus("err", `falha ao colocar pokémon: ${e?.message || e}`);
  }
}

function isTileWithinGrid(row, col) {
  const gs = Number(appState.gridSize) || 0;
  return Number.isFinite(row) && Number.isFinite(col) && row >= 0 && col >= 0 && row < gs && col < gs;
}

function isTileOccupied(row, col) {
  // Delegado para size-rules: retorna true apenas se NADA pode entrar (fully blocked)
  return isTileFullyBlocked(row, col, appState.pieces || []);
}

function getPartyHp(ownerName, pidLike) {
  const roomState = _getRoomPartyStateEntry(ownerName, pidLike);
  const globalPayload = _getGlobalEntryHpPayload(ownerName, pidLike);
  const hp = _resolveHpValue(roomState, globalPayload);
  return hp == null ? 6 : hp;
}

function isPokemonKo(ownerName, pidLike) {
  return getPartyHp(ownerName, pidLike) <= 0;
}

function isPokemonAlreadyOnBoard(ownerName, pidLike) {
  return !!findBoardPieceForTrainer(ownerName, pidLike);
}

function getActivePieceIdForPokemon(ownerName, pidLike) {
  const found = findBoardPieceForTrainer(ownerName, pidLike);
  return safeStr(found?.id);
}

// Interações Arena
// - Canvas (preferencial)
// - DOM fallback (se Canvas falhar)


// -------------------------
// Mutations on public_state/state (Streamlit parity)
// -------------------------
function getStateDocRef() {
  if (!currentDb || !currentRid) return null;
  return doc(currentDb, "rooms", currentRid, "public_state", "state");
}

function isPieceMine(p) {
  const by = safeStr(appState.by).toLowerCase();
  return !!by && safeStr(p?.owner).toLowerCase() === by;
}

function canCurrentPlayerMovePiece(pieceId) {
  const pid = safeStr(pieceId);
  if (!pid) return false;
  const pieces = Array.isArray(appState.pieces) ? appState.pieces : [];
  const piece = pieces.find((p) => safeStr(p?.id) === pid);
  if (!piece) return false;
  if (safeStr(piece?.status || "active") !== "active") return false;
  if (!isPieceMine(piece)) return false;
  if (appState.movement?.freeByPieceId?.[pid]) return true;
  return isCurrentTurnOwnerMe();
}

function isTurnStateOwnedBy(turnState, pieces, ownerName) {
  const owner = safeStr(ownerName).toLowerCase();
  if (!owner) return false;
  const synced = syncTurnStateWithCurrentBoard(turnState || {}, pieces);
  if (safeStr(synced?.phase) !== "active") return false;
  const order = Array.isArray(synced?.order) ? synced.order : [];
  if (!order.length) return false;
  const idx = Math.max(0, Number(synced.index) || 0);
  const current = order[Math.min(idx, order.length - 1)] || null;
  return !!current && safeStr(current.owner).toLowerCase() === owner;
}

async function movePieceOnBoard(pieceId, row, col, options = {}) {
  const pid = safeStr(pieceId);
  const by = safeStr(appState.by || byInput?.value || "");
  const r = Number(row);
  const c = Number(col);
  if (!pid || !by) return false;

  const stateRef = getStateDocRef();
  if (!stateRef || !currentDb) {
    setStatus("err", "sem conexao com a sala");
    return false;
  }

  try {
    let movedPiece = null;
    await runTransaction(currentDb, async (tx) => {
      const snap = await tx.get(stateRef);
      const data = snap.exists() ? snap.data() : {};
      const pieces = Array.isArray(data?.pieces) ? data.pieces : [];
      const battleRef = getBattleDocRef();
      const battleSnap = battleRef && !options.free ? await tx.get(battleRef) : null;
      const battleData = battleSnap?.exists?.() ? battleSnap.data() : {};

      const piecesForRules = resolvePiecesSizeForRules(pieces);
      const nextPieces = pieces.map((p) => ({ ...(p || {}) }));
      const idx = nextPieces.findIndex((p) => safeStr(p?.id) === pid);
      if (idx < 0) throw new Error("peca nao encontrada no state");

      const piece = resolvePieceSizeForRules(nextPieces[idx] || {});
      if (safeStr(piece?.status || "active") !== "active") throw new Error("peca inativa");
      if (safeStr(piece?.owner).toLowerCase() !== by.toLowerCase()) throw new Error("voce so pode mover pecas suas");

      if (!options.free && !isTurnStateOwnedBy(battleData?.turn_state || appState.battle?.turn_state || {}, pieces, by)) {
        throw new Error("somente o jogador do turno pode mover");
      }

      const sizeCategory = getPieceSizeCategory(piece);
      const gs = Number(data?.gridSize) || Number(appState.gridSize) || 10;
      if (!isFootprintWithinGrid(r, c, sizeCategory, gs)) {
        throw new Error("tile invalido ou peca nao cabe na borda da arena");
      }

      if (!options.free) {
        const fromRow = Number(piece.row);
        const fromCol = Number(piece.col);
        const cheb = Math.max(Math.abs(r - fromRow), Math.abs(c - fromCol));
        const { maxTiles } = getPieceMovementBudget(piece);
        const limit = options.halfStep && maxTiles < 1 ? 1 : Math.floor(maxTiles);
        if (cheb <= 0 || cheb > limit) throw new Error("tile fora do deslocamento maximo permitido");
      }

      const movingPiece = { ...piece, sizeCategory };
      const landing = canPieceLandOn(movingPiece, r, c, piecesForRules);
      if (!landing.allowed) throw new Error(landing.reason || "tile ocupado");

      movingPiece.row = r;
      movingPiece.col = c;
      movingPiece.updatedAt = Date.now();
      nextPieces[idx] = movingPiece;
      movedPiece = movingPiece;

      tx.set(stateRef, { pieces: nextPieces, updatedAt: serverTimestamp() }, { merge: true });
    });

    if (movedPiece) {
      appState.piecesRaw = (Array.isArray(appState.piecesRaw) ? appState.piecesRaw : [])
        .map((p) => safeStr(p?.id) === pid ? { ...(p || {}), row: r, col: c, updatedAt: movedPiece.updatedAt } : p);
      _refreshResolvedRoomPieces();
      selectPiece(pid);
      updateSidePanels();
      requestArenaRefresh(true);
    }
    setStatus("ok", "pokemon movido");
    return true;
  } catch (e) {
    setStatus("err", `falha ao mover pokemon: ${e?.message || e}`);
    return false;
  }
}

// Visibilidade no mapa (mesma lógica do app.py):
// - Jogador vê tudo dele
// - Vê do outro apenas o que estiver revealed=true
// - Spectator (ou sem "by"): apenas revealed=true
function isPieceVisibleToMe(p) {
  if (!p) return false;
  if (isPieceMine(p)) return true;
  const role = safeStr(appState.role);
  if (!safeStr(appState.by) || role === "spectator") return !!p?.revealed;
  return !!p?.revealed;
}

async function togglePieceRevealed(pieceId) {
  const pid = safeStr(pieceId);
  if (!pid) return;
  const ref = getStateDocRef();
  if (!ref) {
    setStatus("err", "conecte antes de alterar peças");
    return;
  }
  try {
    await runTransaction(currentDb, async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists() ? snap.data() : {};
      const pieces = Array.isArray(data?.pieces) ? data.pieces : [];
      const seen = Array.isArray(data?.seen) ? data.seen : [];

      const nextPieces = pieces.map((p) => ({ ...(p || {}) }));
      const idx = nextPieces.findIndex((p) => safeStr(p?.id) === pid);
      if (idx < 0) throw new Error("peça não encontrada no state");
      const cur = nextPieces[idx] || {};
      if (!isPieceMine(cur)) throw new Error("você só pode ocultar/revelar peças suas");

      const curRev = cur?.revealed != null ? !!cur.revealed : true;
      const nextRev = !curRev;
      cur.revealed = nextRev;
      nextPieces[idx] = cur;

      // Se revelou, marca como "seen" (igual ao app.py)
      let nextSeen = seen.slice();
      if (nextRev) {
        const pidSeen = safeStr(cur?.pid);
        if (pidSeen && !nextSeen.includes(String(pidSeen))) nextSeen.push(String(pidSeen));
      }

      tx.set(
        ref,
        { pieces: nextPieces, seen: nextSeen, updatedAt: serverTimestamp() },
        { merge: true }
      );
    });
    setStatus("ok", "visibilidade atualizada");
  } catch (e) {
    setStatus("err", `falha ao alternar visibilidade: ${e?.message || e}`);
  }
}

// Condições (tracking) — persistência em public_state/state
// piece.mm_conditions = {deg1:[],deg2:[],deg3:[]}
// piece.pokemon_conditions = []
async function setPieceConditions(pieceId, mm_conditions, pokemon_conditions) {
  const pid = safeStr(pieceId);
  if (!pid) return;
  const ref = getStateDocRef();
  if (!ref) {
    setStatus("err", "conecte antes de alterar peças");
    return;
  }

  const mm = (mm_conditions && typeof mm_conditions === "object")
    ? {
        deg1: Array.isArray(mm_conditions.deg1) ? mm_conditions.deg1.map(safeStr).filter(Boolean) : [],
        deg2: Array.isArray(mm_conditions.deg2) ? mm_conditions.deg2.map(safeStr).filter(Boolean) : [],
        deg3: Array.isArray(mm_conditions.deg3) ? mm_conditions.deg3.map(safeStr).filter(Boolean) : [],
      }
    : { deg1: [], deg2: [], deg3: [] };

  const pkm = Array.isArray(pokemon_conditions) ? pokemon_conditions.map(safeStr).filter(Boolean) : [];

  try {
    await runTransaction(currentDb, async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists() ? snap.data() : {};
      const pieces = Array.isArray(data?.pieces) ? data.pieces : [];

      const nextPieces = pieces.map((p) => ({ ...(p || {}) }));
      const idx = nextPieces.findIndex((p) => safeStr(p?.id) === pid);
      if (idx < 0) throw new Error("peça não encontrada no state");

      const cur = nextPieces[idx] || {};
      if (!isPieceMine(cur)) throw new Error("você só pode editar condições das suas peças");

      cur.mm_conditions = mm;
      cur.pokemon_conditions = pkm;
      nextPieces[idx] = cur;

      tx.set(ref, { pieces: nextPieces, updatedAt: serverTimestamp() }, { merge: true });
    });
    setStatus("ok", "condições atualizadas");
  } catch (e) {
    setStatus("err", `falha ao atualizar condições: ${e?.message || e}`);
  }
}

async function removePieceFromBoard(pieceId) {
  const pid = safeStr(pieceId);
  if (!pid) return;
  const ref = getStateDocRef();
  if (!ref) {
    setStatus("err", "conecte antes de alterar peças");
    return;
  }
  try {
    await runTransaction(currentDb, async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists() ? snap.data() : {};
      const pieces = Array.isArray(data?.pieces) ? data.pieces : [];
      const seen = Array.isArray(data?.seen) ? data.seen : [];

      const target = pieces.find((p) => safeStr(p?.id) === pid) || null;
      if (!target) return;
      if (!isPieceMine(target)) throw new Error("você só pode remover peças suas");

      const nextPieces = pieces.filter((p) => safeStr(p?.id) !== pid);
      const nextSeen = seen.slice();
      if (target?.revealed) {
        const seenPid = safeStr(target?.pid);
        if (seenPid && !nextSeen.includes(seenPid)) nextSeen.push(seenPid);
      }
      tx.set(ref, { pieces: nextPieces, seen: nextSeen, updatedAt: serverTimestamp() }, { merge: true });

      // Zera boosts temporários ao recolher para a pokébola
      const pokePid = safeStr(target.pid);
      const owner   = safeStr(target.owner);
      if (pokePid && owner && currentDb && currentRid) {
        const psRef = doc(currentDb, "rooms", currentRid, "public_state", "party_states");
        setDoc(psRef, { [owner]: { [pokePid]: { stat_boosts: null } } }, { merge: true }).catch(() => {});
      }
    });

    // limpa seleção local se removeu
    if (safeStr(appState.selectedPieceId) === pid) {
      appState.selectedPieceId = null;
      selBadge.textContent = `seleção: —`;
    }
    updateSidePanels();
    try { renderSheetsTab(); } catch {}
    requestArenaRefresh(true);
    setStatus("ok", "peça removida do campo");
  } catch (e) {
    setStatus("err", `falha ao remover peça: ${e?.message || e}`);
  }
}

function hidePieceContextMenu() {
  if (!pieceContextMenu) return;
  pieceContextMenu.style.display = "none";
  pieceMenuState.pieceId = null;
  pieceMenuState.clientX = 0;
  pieceMenuState.clientY = 0;
}

function _getPieceFormPickerState(piece) {
  if (!piece || isTrainerPiece(piece)) {
    return { canShow: false, options: [], currentFormSlug: "", partySlot: "", speciesSlug: "" };
  }
  const owner = safeStr(piece?.owner);
  const partyEntry = _getPartyEntryForTrainerPid(owner, piece);
  const partySlot = _getPartySlot(piece) || _getPartySlot(partyEntry);
  const identity = partySlot ? { pid: piece?.pid, party_slot: partySlot } : piece;
  const formSource = _getPreferredPokemonFormSource(owner, identity);
  const sheet = isPieceMine(piece) ? getSheetForPiece(piece) : null;
  const resolvedSheetEntry = isPieceMine(piece)
    ? _resolveSelfEffectiveSheet(identity, owner, { ignoreMega: true })
    : null;
  const baseSheet = isPieceMine(piece)
    ? (resolvedSheetEntry?.baseSheet || sheet)
    : sheet;
  let currentFormSlug = _normalizePokemonFormSlug(
    formSource?.formSlug
    || _sheetPokemonFormSlug(baseSheet)
    || _inferBasePokemonFormSlug(owner, identity, { piece, sheet: baseSheet, source: formSource?.raw })
  );
  const speciesSlug = _inferPokemonSpeciesSlug(owner, identity, { piece, sheet: baseSheet, source: formSource?.raw });
  const allowGmax = _canShowGmaxForTrainerPid(owner, identity, { piece, sheet: baseSheet, resolvedSheetEntry });
  let options = _getPokemonFolderOptionsForSpecies(speciesSlug, { allowGmax });
  const rootSlug = speciesSlug || _inferCanonicalFormRoot(currentFormSlug);
  if (currentFormSlug && !_pokemonFormManifestSet.has(currentFormSlug) && options.length) {
    currentFormSlug = _defaultFormSlugForRoot(rootSlug);
  }
  if (currentFormSlug && !_shouldHideGenericFormSlug(currentFormSlug, { allowGmax }) && !options.some((option) => option.form_slug === currentFormSlug)) {
    options = _sortPokemonFormSlugs(options.map((option) => option.form_slug).concat([currentFormSlug]), rootSlug).map((slug) => ({
      form_slug: slug,
      root_slug: rootSlug,
      display_name: _folderFormSuffixLabel(rootSlug, slug),
      image: spriteUrlWithFallback(slug, "art", false),
    }));
  }
  return {
    canShow: options.length > 1,
    options,
    rootSlug,
    speciesSlug,
    currentFormSlug,
    allowGmax,
    partySlot,
    identity,
    unresolved: !partySlot,
  };
}

function _buildPokemonFormOverridePayload(ownerName, piece, formSlug) {
  const owner = safeStr(ownerName);
  const normalizedFormSlug = _normalizePokemonFormSlug(formSlug);
  const currentSource = _getPreferredPokemonFormSource(owner, piece);
  const sex = _getPreferredPokemonSexForTrainerPid(owner, piece);
  const canUseSelfSheets = _trainerLookupKey(owner) === _trainerLookupKey(appState.by);
  const formSheet = canUseSelfSheets
    ? _resolveSelfEffectiveSheet(piece, owner, { preferredFormSlug: normalizedFormSlug, ignoreMega: true })?.baseSheet
    : null;
  const cached = _getPokeApiCached(normalizedFormSlug);
  if (normalizedFormSlug && _pokeApiCache.get(normalizedFormSlug) !== "pending") fetchPokeApiData(normalizedFormSlug);
  const resolvedTypes = _coerceResolvedTypes(
    formSheet?.pokemon?.types
    || (currentSource?.formSlug === normalizedFormSlug ? currentSource?.resolvedTypes : [])
    || cached?.types
    || []
  );
  const resolvedAbilities = _coerceResolvedAbilities(
    formSheet?.pokemon?.abilities
    || (currentSource?.formSlug === normalizedFormSlug ? currentSource?.resolvedAbilities : [])
    || (cached?.abilities || []).map((item) => item?.ability?.name || item?.name || item)
    || []
  );
  return {
    form_slug: normalizedFormSlug,
    display_name: safeStr(formSheet?.pokemon?.name)
      || (currentSource?.formSlug === normalizedFormSlug ? safeStr(currentSource?.displayName) : "")
      || _humanizePokemonFormSlug(normalizedFormSlug),
    image: safeStr(_extractPokemonImageFromSource(formSheet?.pokemon))
      || (currentSource?.formSlug === normalizedFormSlug ? safeStr(currentSource?.image) : "")
      || spriteUrlWithFallback(normalizedFormSlug, "art", false, { sex }),
    resolved_types: resolvedTypes,
    resolved_abilities: resolvedAbilities,
    updated_at: serverTimestamp(),
  };
}

async function setBattlePokemonFormForPiece(piece, formSlug) {
  const owner = safeStr(piece?.owner);
  const formState = _getPieceFormPickerState(piece);
  const normalizedFormSlug = _normalizePokemonFormSlug(formSlug);
  if (!owner || !normalizedFormSlug) return;
  if (!formState.partySlot) {
    setStatus("warn", "não foi possível resolver o slot desse pokémon nesta sala. Recoloque-o no campo e tente novamente.");
    return;
  }
  const payload = _buildPokemonFormOverridePayload(owner, { ...piece, party_slot: formState.partySlot }, normalizedFormSlug);
  const ref = (currentDb && currentRid)
    ? doc(currentDb, "rooms", currentRid, "public_state", "pokemon_forms")
    : null;
  if (!ref) {
    setStatus("err", "sala desconectada");
    return;
  }
  await setDoc(ref, {
    [owner]: {
      [formState.partySlot]: payload,
    },
    updated_at: serverTimestamp(),
  }, { merge: true });
  setStatus("ok", `${payload.display_name}: forma atualizada na sala.`);
}

let _formPickerEl = null;
let _formPickerState = { pieceId: null, options: [], currentFormSlug: "", clientX: 0, clientY: 0 };

function _ensureFormPickerEl() {
  if (_formPickerEl) return _formPickerEl;
  _formPickerEl = document.createElement("div");
  _formPickerEl.id = "piece_form_menu";
  _formPickerEl.className = "piece-context-menu";
  _formPickerEl.style.display = "none";
  _formPickerEl.style.flexDirection = "column";
  _formPickerEl.style.maxHeight = "240px";
  _formPickerEl.style.overflowY = "auto";
  canvasWrap?.appendChild(_formPickerEl);
  _formPickerEl.addEventListener("click", async (ev) => {
    const btn = ev.target?.closest("[data-form-slug]");
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    const piece = (appState.pieces || []).find((entry) => safeStr(entry?.id) === safeStr(_formPickerState.pieceId));
    const formSlug = safeStr(btn.dataset.formSlug);
    hidePieceFormPickerMenu();
    if (!piece || !formSlug) return;
    await setBattlePokemonFormForPiece(piece, formSlug);
  });
  return _formPickerEl;
}

function openPieceFormPickerMenu(piece, clientX, clientY) {
  const el = _ensureFormPickerEl();
  const state = _getPieceFormPickerState(piece);
  if (!state.canShow) {
    setStatus("warn", "esse pokémon não tem outras formas disponíveis no repositório.");
    return;
  }
  if (!state.partySlot) {
    setStatus("warn", "não foi possível resolver o slot desse pokémon nesta sala. Recoloque-o no campo e tente novamente.");
    return;
  }
  _formPickerState = {
    pieceId: safeStr(piece?.id),
    options: state.options,
    currentFormSlug: state.currentFormSlug,
    clientX,
    clientY,
  };
  el.innerHTML = `
    <div class="menu-caption">Trocar forma</div>
    <div class="menu-summary">Selecione a forma visível apenas nesta sala.</div>
    <div class="menu-divider"></div>
    ${state.options.map((option) => {
      const active = option.form_slug === state.currentFormSlug;
      return `
        <button type="button" data-form-slug="${escapeAttr(option.form_slug)}"${active ? " disabled" : ""}>
          ${active ? "✓ " : ""}${escapeHtml(option.display_name)}
        </button>
      `;
    }).join("")}
  `;
  const wrapRect = canvasWrap.getBoundingClientRect();
  const localX = Math.max(0, Math.min(wrapRect.width - 8, clientX - wrapRect.left + 12));
  const localY = Math.max(0, Math.min(wrapRect.height - 8, clientY - wrapRect.top));
  el.style.display = "flex";
  el.style.left = `${localX}px`;
  el.style.top = `${localY}px`;
  const menuRect = el.getBoundingClientRect();
  const overflowX = menuRect.right - wrapRect.right;
  const overflowY = menuRect.bottom - wrapRect.bottom;
  if (overflowX > 0) el.style.left = `${Math.max(8, localX - overflowX - 8)}px`;
  if (overflowY > 0) el.style.top = `${Math.max(8, localY - overflowY - 8)}px`;
}

function hidePieceFormPickerMenu() {
  if (_formPickerEl) _formPickerEl.style.display = "none";
  _formPickerState = { pieceId: null, options: [], currentFormSlug: "", clientX: 0, clientY: 0 };
}

openPieceContextMenu = function(piece, x, y) {
  if (!pieceContextMenu || !piece || !canvasWrap) return;
  const id = safeStr(piece?.id);
  if (!id) return;
  pieceMenuState.pieceId = id;
  pieceMenuState.clientX = x;
  pieceMenuState.clientY = y;
  hidePieceFormPickerMenu();
  selectPiece(id);
  setArenaHoverPiece(id, { persist: true });

  const isMine = isPieceMine(piece);
  const revealed = (piece?.revealed != null) ? !!piece.revealed : true;
  const ownerLabel = humanizeInternalLabel(safeStr(piece?.owner)) || safeStr(piece?.owner) || "—";
  const name = displayNameFromPiece(piece, { allowHiddenIdentity: true, isMine });
  const budget = getPieceMovementBudget(piece);
  const freeMove = isPieceFreeMovementEnabled(id);
  const movementText = `🧭 Deslocamento • ${budget.speed} SPD • ${budget.maxTiles % 1 ? "1/2" : budget.maxTiles} quad.`;
  if (pieceContextSummary) {
    pieceContextSummary.textContent = `${name} • ${ownerLabel}`;
  }

  const moveBtn = pieceContextMenu.querySelector('[data-menu-act="move"]');
  const movementBtn = pieceContextMenu.querySelector('[data-menu-act="movement"]');
  const formBtn = pieceContextMenu.querySelector('[data-menu-act="form"]');
  const megaBtn = pieceContextMenu.querySelector('[data-menu-act="mega"]');
  const conditionsBtn = pieceContextMenu.querySelector('[data-menu-act="conditions"]');
  const toggleBtn = pieceContextMenu.querySelector('[data-menu-act="toggle"]');
  const removeBtn = pieceContextMenu.querySelector('[data-menu-act="remove"]');
  if (moveBtn) moveBtn.disabled = !isMine;
  if (movementBtn) {
    movementBtn.disabled = !isMine;
    movementBtn.textContent = `🧭 Deslocamento livre ${freeMove ? "ON" : "OFF"}`;
    movementBtn.title = isMine
      ? `${movementText}. Clique para ${freeMove ? "voltar ao alcance normal" : "liberar posicionamento em qualquer lugar da arena"}.`
      : movementText;
  }
  const formState = _getPieceFormPickerState(piece);
  if (formBtn) {
    formBtn.hidden = !isMine || !formState.canShow;
    formBtn.disabled = !isMine || !formState.canShow;
    formBtn.textContent = "🧬 Trocar forma";
  }
  const megaState = getPieceMegaUiState(piece);
  if (megaBtn) {
    megaBtn.disabled = !megaState.canMega;
    megaBtn.hidden = !megaState.canMega;
    megaBtn.textContent = megaState.canMega && safeStr(megaState.entry?.activeMegaSlug)
      ? "✨ Cancelar Mega Evolução"
      : "✨ Mega Evoluir";
  }
  if (conditionsBtn) conditionsBtn.disabled = !isMine;
  if (toggleBtn) {
    toggleBtn.disabled = !isMine;
    toggleBtn.textContent = revealed ? "👁️ Ocultar" : "👁️ Revelar";
  }
  if (removeBtn) removeBtn.disabled = !isMine;

  const wrapRect = canvasWrap.getBoundingClientRect();
  const localX = Math.max(0, Math.min(wrapRect.width - 8, x - wrapRect.left));
  const localY = Math.max(0, Math.min(wrapRect.height - 8, y - wrapRect.top));

  pieceContextMenu.style.display = "flex";
  pieceContextMenu.style.left = `${localX}px`;
  pieceContextMenu.style.top = `${localY}px`;

  const menuRect = pieceContextMenu.getBoundingClientRect();
  const overflowX = menuRect.right - wrapRect.right;
  const overflowY = menuRect.bottom - wrapRect.bottom;
  if (overflowX > 0) pieceContextMenu.style.left = `${Math.max(8, localX - overflowX - 8)}px`;
  if (overflowY > 0) pieceContextMenu.style.top = `${Math.max(8, localY - overflowY - 8)}px`;
}

// ── Piece Picker Menu (seleção de peça quando há stacking) ───────
let _pickerEl = null;
let _pickerState = { pieces: [], afterPick: "select", clientX: 0, clientY: 0 };

function _ensurePickerEl() {
  if (_pickerEl) return _pickerEl;
  _pickerEl = document.createElement("div");
  _pickerEl.id = "piece_picker_menu";
  _pickerEl.className = "piece-context-menu";
  _pickerEl.style.display = "none";
  _pickerEl.style.flexDirection = "column";
  _pickerEl.style.maxHeight = "200px";
  _pickerEl.style.overflowY = "auto";
  canvasWrap?.appendChild(_pickerEl);
  _pickerEl.addEventListener("click", (ev) => {
    const btn = ev.target?.closest("[data-picker-id]");
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    const pickedId = safeStr(btn.dataset.pickerId);
    const afterPick = _pickerState.afterPick;
    const cx = _pickerState.clientX;
    const cy = _pickerState.clientY;
    hidePiecePickerMenu();
    const piece = (appState.pieces || []).find(p => safeStr(p?.id) === pickedId);
    if (!piece) return;
    if (afterPick === "context" && isPieceMine(piece)) {
      openPieceContextMenu(piece, cx, cy);
    } else {
      selectPiece(pickedId);
    }
  });
  return _pickerEl;
}

function openPiecePickerMenu(piecesArr, clientX, clientY, opts) {
  const el = _ensurePickerEl();
  _pickerState = { pieces: piecesArr, afterPick: (opts && opts.afterPick) || "select", clientX, clientY };
  el.innerHTML = piecesArr.map(p => {
    const name = (p?.revealed ? (dexNameFromPid(safeStr(p.pid)) || safeStr(p.pid)) : "???").slice(0, 16);
    const size = getPieceSizeCategory(p);
    const mine = isPieceMine(p);
    return `<button type="button" data-picker-id="${safeStr(p.id)}" style="text-align:left;padding:4px 8px;font-size:13px;">${mine ? "★ " : ""}${name} <span style="opacity:0.5;font-size:11px;">(${size})</span></button>`;
  }).join("");
  const wrapRect = canvasWrap.getBoundingClientRect();
  const localX = Math.max(0, Math.min(wrapRect.width - 8, clientX - wrapRect.left));
  const localY = Math.max(0, Math.min(wrapRect.height - 8, clientY - wrapRect.top));
  el.style.display = "flex";
  el.style.left = `${localX}px`;
  el.style.top = `${localY}px`;
  // Ajusta overflow
  requestAnimationFrame(() => {
    if (!_pickerEl) return;
    const menuRect = _pickerEl.getBoundingClientRect();
    const overX = menuRect.right - wrapRect.right;
    const overY = menuRect.bottom - wrapRect.bottom;
    if (overX > 0) _pickerEl.style.left = `${Math.max(8, localX - overX - 8)}px`;
    if (overY > 0) _pickerEl.style.top = `${Math.max(8, localY - overY - 8)}px`;
  });
}

function hidePiecePickerMenu() {
  if (_pickerEl) _pickerEl.style.display = "none";
}

const arenaLongPress = {
  timer: null,
  startX: 0,
  startY: 0,
  suppressUntil: 0,
};

function clearArenaLongPress() {
  if (arenaLongPress.timer) clearTimeout(arenaLongPress.timer);
  arenaLongPress.timer = null;
}

function armArenaLongPress(piece, clientX, clientY) {
  if (!piece) return;
  clearArenaLongPress();
  arenaLongPress.startX = clientX;
  arenaLongPress.startY = clientY;
  arenaLongPress.timer = window.setTimeout(() => {
    arenaLongPress.timer = null;
    arenaLongPress.suppressUntil = Date.now() + 280;
    openPieceContextMenu(piece, clientX, clientY);
  }, 430);
}

function cancelArenaLongPressIfMoved(clientX, clientY) {
  if (!arenaLongPress.timer) return;
  const dx = Math.abs(Number(clientX) - arenaLongPress.startX);
  const dy = Math.abs(Number(clientY) - arenaLongPress.startY);
  if (dx > 10 || dy > 10) clearArenaLongPress();
}

async function handlePieceMenuAction(action, pieceId) {
  const id = safeStr(pieceId);
  if (!id) return;
  const piece = (appState.pieces || []).find((p) => safeStr(p?.id) === id) || null;
  if (!piece) {
    setStatus("warn", "peça não encontrada");
    return;
  }
  const mine = isPieceMine(piece);
  if (!mine && (action === "move" || action === "movement" || action === "mega" || action === "conditions" || action === "toggle" || action === "remove")) {
    setStatus("err", "você só pode usar ações do menu em peças suas");
    return;
  }
  if (action === "move") {
    selectPiece(id);
    setStatus("ok", isPieceFreeMovementEnabled(id)
      ? "deslocamento livre ativo: clique em qualquer lugar da arena para reposicionar o pokémon"
      : "Mover: clique no tile de destino na arena");
    return;
  }
  if (action === "movement") {
    togglePieceFreeMovement(id);
    return;
  }
  if (action === "mega") {
    await triggerPieceMegaAction(piece);
    return;
  }
  if (action === "conditions") {
    await openPieceConditionsModal(piece);
    return;
  }
  if (action === "toggle") {
    await togglePieceRevealed(id);
    return;
  }
  if (action === "remove") {
    await removePieceFromBoard(id);
    return;
  }
}

function openPieceContextMenu(piece, x, y) {
  if (!pieceContextMenu || !piece || !canvasWrap) return;
  const id = safeStr(piece?.id);
  if (!id) return;
  pieceMenuState.pieceId = id;
  selectPiece(id);
  setArenaHoverPiece(id, { persist: true });

  const isMine = isPieceMine(piece);
  const revealed = piece?.revealed != null ? !!piece.revealed : true;
  const ownerLabel = humanizeInternalLabel(safeStr(piece?.owner)) || safeStr(piece?.owner) || "—";
  const name = displayNameFromPiece(piece, { allowHiddenIdentity: true, isMine });
  const budget = getPieceMovementBudget(piece);
  const freeMove = isPieceFreeMovementEnabled(id);
  const hpValue = getPartyHp(safeStr(piece?.owner), piece);
  const movementText = `Deslocamento • ${budget.speed} SPD • ${budget.maxTiles % 1 ? "1/2" : budget.maxTiles} quad.`;
  if (pieceContextSummary) {
    pieceContextSummary.textContent = `${name} • ${ownerLabel} • HP ${hpValue}/6`;
  }

  const moveBtn = pieceContextMenu.querySelector('[data-menu-act="move"]');
  const movementBtn = pieceContextMenu.querySelector('[data-menu-act="movement"]');
  const summaryBtn = pieceContextMenu.querySelector('[data-menu-act="summary"]');
  const rollTestBtn = pieceContextMenu.querySelector('[data-menu-act="roll-test"]');
  const hpDownBtn = pieceContextMenu.querySelector('[data-menu-act="hp-down"]');
  const hpUpBtn = pieceContextMenu.querySelector('[data-menu-act="hp-up"]');
  const megaBtn = pieceContextMenu.querySelector('[data-menu-act="mega"]');
  const conditionsBtn = pieceContextMenu.querySelector('[data-menu-act="conditions"]');
  const toggleBtn = pieceContextMenu.querySelector('[data-menu-act="toggle"]');
  const removeBtn = pieceContextMenu.querySelector('[data-menu-act="remove"]');

  if (moveBtn) moveBtn.disabled = !isMine;
  if (movementBtn) {
    movementBtn.disabled = !isMine;
    movementBtn.textContent = `🧭 ${movementText}`;
    movementBtn.title = movementText;
    movementBtn.textContent = `🧭 Deslocamento livre ${freeMove ? "ON" : "OFF"}`;
    movementBtn.title = isMine
      ? `${movementText}. Clique para ${freeMove ? "voltar ao alcance normal" : "liberar posicionamento em qualquer lugar da arena"}.`
      : movementText;
  }
  if (summaryBtn) summaryBtn.disabled = false;
  if (rollTestBtn) rollTestBtn.disabled = !isMine || isTrainerPiece(piece);
  if (hpDownBtn) hpDownBtn.disabled = !isMine || hpValue <= 0;
  if (hpUpBtn) hpUpBtn.disabled = !isMine || hpValue >= 6;

  const megaState = getPieceMegaUiState(piece);
  if (megaBtn) {
    megaBtn.disabled = !megaState.canMega;
    megaBtn.hidden = !megaState.canMega;
    megaBtn.textContent = megaState.canMega && safeStr(megaState.entry?.activeMegaSlug)
      ? "✨ Cancelar Mega Evolução"
      : "✨ Mega Evoluir";
  }
  if (conditionsBtn) conditionsBtn.disabled = !isMine;
  if (toggleBtn) {
    toggleBtn.disabled = !isMine;
    toggleBtn.textContent = revealed ? "👁️ Ocultar" : "👁️ Revelar";
  }
  if (removeBtn) removeBtn.disabled = !isMine;

  const wrapRect = canvasWrap.getBoundingClientRect();
  const localX = Math.max(0, Math.min(wrapRect.width - 8, x - wrapRect.left));
  const localY = Math.max(0, Math.min(wrapRect.height - 8, y - wrapRect.top));

  pieceContextMenu.style.display = "flex";
  pieceContextMenu.style.left = `${localX}px`;
  pieceContextMenu.style.top = `${localY}px`;

  const menuRect = pieceContextMenu.getBoundingClientRect();
  const overflowX = menuRect.right - wrapRect.right;
  const overflowY = menuRect.bottom - wrapRect.bottom;
  if (overflowX > 0) pieceContextMenu.style.left = `${Math.max(8, localX - overflowX - 8)}px`;
  if (overflowY > 0) pieceContextMenu.style.top = `${Math.max(8, localY - overflowY - 8)}px`;
};

_ensurePickerEl = function() {
  if (_pickerEl) return _pickerEl;
  _pickerEl = document.createElement("div");
  _pickerEl.id = "piece_picker_menu";
  _pickerEl.className = "piece-context-menu";
  _pickerEl.style.display = "none";
  _pickerEl.style.flexDirection = "column";
  _pickerEl.style.maxHeight = "200px";
  _pickerEl.style.overflowY = "auto";
  canvasWrap?.appendChild(_pickerEl);
  _pickerEl.addEventListener("click", (ev) => {
    const btn = ev.target?.closest("[data-picker-id]");
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    const pickedId = safeStr(btn.dataset.pickerId);
    const afterPick = _pickerState.afterPick;
    const cx = _pickerState.clientX;
    const cy = _pickerState.clientY;
    hidePiecePickerMenu();
    const piece = (appState.pieces || []).find((p) => safeStr(p?.id) === pickedId);
    if (!piece) return;
    if (afterPick === "context") {
      openPieceContextMenu(piece, cx, cy);
    } else {
      selectPiece(pickedId);
    }
  });
  return _pickerEl;
};

handlePieceMenuAction = async function(action, pieceId) {
  const id = safeStr(pieceId);
  if (!id) return;
  const piece = (appState.pieces || []).find((p) => safeStr(p?.id) === id) || null;
  if (!piece) {
    setStatus("warn", "peça não encontrada");
    return;
  }

  const mine = isPieceMine(piece);
  if (!mine && ["move", "movement", "form", "mega", "conditions", "toggle", "remove", "hp-down", "hp-up", "roll-test"].includes(action)) {
    setStatus("err", "você só pode usar essas ações em peças suas");
    return;
  }

  if (action === "move") {
    selectPiece(id);
    setStatus("ok", isPieceFreeMovementEnabled(id)
      ? "deslocamento livre ativo: clique em qualquer lugar da arena para reposicionar o pokémon"
      : "Mover: clique no tile de destino na arena");
    return;
  }
  if (action === "movement") {
    togglePieceFreeMovement(id);
    return;
  }
  if (action === "form") {
    openPieceFormPickerMenu(piece, pieceMenuState.clientX, pieceMenuState.clientY);
    return;
  }
  if (action === "summary") {
    selectPiece(id);
    renderArenaSheetPreview();
    requestArenaRefresh(true);
    return;
  }
  if (action === "roll-test") {
    openPieceRollTestModal(piece);
    return;
  }
  if (action === "hp-down" || action === "hp-up") {
    const owner = safeStr(piece?.owner);
    const pid = safeStr(piece?.pid);
    if (!owner || !pid) {
      setStatus("warn", "hp indisponível para esta peça");
      return;
    }
    const delta = action === "hp-up" ? 1 : -1;
    await updatePartyStateHp(owner, piece, getPartyHp(owner, piece) + delta);
    return;
  }
  if (action === "mega") {
    await triggerPieceMegaAction(piece);
    return;
  }
  if (action === "conditions") {
    await openPieceConditionsModal(piece);
    return;
  }
  if (action === "toggle") {
    await togglePieceRevealed(id);
    return;
  }
  if (action === "remove") {
    await removePieceFromBoard(id);
  }
};

window.handlePieceMenuAction = handlePieceMenuAction;
window.openPieceRollTestModal = openPieceRollTestModal;
window.rollPieceTest = rollPieceTest;
window.buildPieceRollTestState = buildPieceRollTestState;

pieceContextMenu?.addEventListener("click", async (ev) => {
  const btn = ev.target?.closest?.("[data-menu-act]");
  if (!btn) return;
  ev.preventDefault();
  ev.stopPropagation();
  const act = safeStr(btn.dataset.menuAct);
  const pieceId = pieceMenuState.pieceId;
  const clientX = pieceMenuState.clientX;
  const clientY = pieceMenuState.clientY;
  hidePieceContextMenu();
  pieceMenuState.clientX = clientX;
  pieceMenuState.clientY = clientY;
  await handlePieceMenuAction(act, pieceId);
});

document.addEventListener("click", (ev) => {
  // Fecha picker se clicar fora
  if (_pickerEl && _pickerEl.style.display === "flex" && !ev.target?.closest?.("#piece_picker_menu")) {
    hidePiecePickerMenu();
  }
  if (_formPickerEl && _formPickerEl.style.display === "flex" && !ev.target?.closest?.("#piece_form_menu")) {
    hidePieceFormPickerMenu();
  }
  if (!pieceContextMenu || pieceContextMenu.style.display !== "flex") return;
  if (ev.target?.closest?.("#piece_context_menu")) return;
  hidePieceContextMenu();
});
document.addEventListener("click", (ev) => {
  if (appState.leftOverlayOpen && !ev.target?.closest?.("#arena_left_shell")) {
    setArenaLeftOverlayOpen(false);
  }
  if (appState.toolsMenuOpen && !ev.target?.closest?.("#arena_tools_shell")) {
    setArenaToolsMenuOpen(false);
  }
});
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  // 1) fecha menus
  hidePieceContextMenu();
  hidePiecePickerMenu();
  setArenaLeftOverlayOpen(false);
  setArenaToolsMenuOpen(false);
  if (pieceActionModalRefs) pieceActionModalRefs.close();

  // 2) cancela movimento por clique/arrasto
  if (appState.drag.active || appState.selectedPieceId) {
    appState.drag.active = false;
    appState.drag.justDropped = false;
    appState.drag.pieceId = null;
    appState.drag.startRow = null;
    appState.drag.startCol = null;
    selectPiece(null);
    setStatus("ok", "movimento cancelado");
    return;
  }

  // 3) cancela modo posicionamento (pokébola armada)
  if (getPlacingPokemonPid()) {
    clearPokemonPlacingMode();
    updateSidePanels();
    setStatus("ok", "posicionamento cancelado");
  }
});
function bindArenaInteractionsCanvas() {
  if (!useCanvas) return;

  canvas.addEventListener("pointerdown", (ev) => {
    if (isMapEditorActive()) return;
    if (supportsHoverTabs() || ev.pointerType !== "touch") return;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const piece = getCanvasPieceHitAtPoint(x, y);
    armArenaLongPress(piece, ev.clientX, ev.clientY);
  });
  canvas.addEventListener("pointermove", (ev) => {
    cancelArenaLongPressIfMoved(ev.clientX, ev.clientY);
  });
  canvas.addEventListener("pointerup", clearArenaLongPress);
  canvas.addEventListener("pointercancel", clearArenaLongPress);

  canvas.addEventListener("mousemove", (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const tile = screenToTile(x, y);
    if (tile) {
      appState.hover = tile;
      hoverBadge.textContent = `tile: (${tile.row}, ${tile.col})`;
    } else {
      appState.hover = { row: null, col: null };
      hoverBadge.textContent = `tile: —`;
    }
    setArenaHoverPiece(tile ? getCanvasPieceHitAtPoint(x, y) : null);
    if (appState.drag.active) {
      appState.drag.x = x;
      appState.drag.y = y;
    }
  });

  canvas.addEventListener("mouseleave", () => {
    appState.hover = { row: null, col: null };
    hoverBadge.textContent = `tile: —`;
    setArenaHoverPiece(null);
  });

  canvas.addEventListener("mousedown", (ev) => {
    if (isMapEditorActive()) return;
    if (getPlacingPokemonPid()) return;
    if (appState.placingTrainer) return;
    if (ev.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const tile = screenToTile(x, y);
    if (!tile) return;
    const p = getCanvasPieceHitAtPoint(x, y, { mineOnly: true }) || getPieceAt(tile.row, tile.col);
    if (!p) return;
    if (!isPieceMine(p)) return;
    const id = safeStr(p.id);
    selectPiece(id);
    appState.drag.active = true;
    appState.drag.justDropped = false;
    appState.drag.pieceId = id;
    appState.drag.startRow = tile.row;
    appState.drag.startCol = tile.col;
    appState.drag.x = x;
    appState.drag.y = y;
  });

  window.addEventListener("mouseup", (ev) => {
    if (isMapEditorActive()) {
      appState.drag.active = false;
      appState.drag.justDropped = false;
      return;
    }
    if (!appState.drag.active) return;
    appState.drag.active = false;
    appState.drag.justDropped = true;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const tile = screenToTile(x, y);
    if (!tile) return;
    sendMoveSelected(tile.row, tile.col);
  });

  canvas.addEventListener("click", (ev) => {
    if (Date.now() < arenaLongPress.suppressUntil) {
      arenaLongPress.suppressUntil = 0;
      return;
    }
    hidePieceContextMenu();
    hidePiecePickerMenu();
    // Se acabou de soltar um drag, ignore o click que vem logo depois
    if (appState.drag.justDropped) {
      appState.drag.justDropped = false;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const tile = screenToTile(x, y);
    if (!tile) return;

    if (handleMapEditorTileAction(tile.row, tile.col)) {
      ev.preventDefault?.();
      return;
    }

    if (appState.placingTrainer) return; // handled by scoreboard-patch.js capture
    const placingPid = getPlacingPokemonPid();
    if (placingPid) {
      placePokemonOnBoardAt(appState.placing || placingPid, tile.row, tile.col);
      return;
    }

    const clickedPiece = getCanvasPieceHitAtPoint(x, y);
    if (clickedPiece) {
      selectPiece(clickedPiece.id);
      return;
    }

    // Stacking: se múltiplos pieces no tile, abre picker
    const candidates = getPiecesAt(tile.row, tile.col);
    if (candidates.length === 0) {
      if (appState.selectedPieceId) sendMoveSelected(tile.row, tile.col);
      return;
    }
    if (candidates.length === 1) {
      selectPiece(candidates[0].id);
      return;
    }
    openPiecePickerMenu(candidates, ev.clientX, ev.clientY);
  });

  canvas.addEventListener("contextmenu", (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const tile = screenToTile(x, y);
    if (!tile) return;
    if (isMapEditorActive()) {
      ev.preventDefault();
      return;
    }
    const clickedPiece = getCanvasPieceHitAtPoint(x, y);
    if (clickedPiece) {
      ev.preventDefault();
      openPieceContextMenu(clickedPiece, ev.clientX, ev.clientY);
      return;
    }
    const candidates = getPiecesAt(tile.row, tile.col).filter((p) => isPieceVisibleToMe(p));
    if (candidates.length === 0) return;
    ev.preventDefault();
    if (candidates.length === 1) {
      openPieceContextMenu(candidates[0], ev.clientX, ev.clientY);
      return;
    }
    // Múltiplas peças próprias: picker primeiro, depois context menu
    openPiecePickerMenu(candidates, ev.clientX, ev.clientY, { afterPick: "context" });
  });
}

function bindArenaInteractionsDom() {
  if (!arenaDom) return;

  arenaDom.addEventListener("pointerdown", (ev) => {
    if (isMapEditorActive()) return;
    if (supportsHoverTabs() || ev.pointerType !== "touch") return;
    armArenaLongPress(getDomClickedPiece(ev), ev.clientX, ev.clientY);
  });
  arenaDom.addEventListener("pointermove", (ev) => {
    cancelArenaLongPressIfMoved(ev.clientX, ev.clientY);
  });
  arenaDom.addEventListener("pointerup", clearArenaLongPress);
  arenaDom.addEventListener("pointercancel", clearArenaLongPress);

  // Delegação de eventos nas células
  arenaDom.addEventListener("mousemove", (ev) => {
    const cell = ev.target?.closest?.(".cell");
    if (!cell) return;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    appState.hover = { row, col };
    hoverBadge.textContent = `tile: (${row}, ${col})`;
    updateArenaDomHover();
    setArenaHoverPiece(getDomClickedPiece(ev));
  });

  arenaDom.addEventListener("mouseleave", () => {
    appState.hover = { row: null, col: null };
    hoverBadge.textContent = `tile: —`;
    updateArenaDomHover();
    setArenaHoverPiece(null);
  });

  arenaDom.addEventListener("click", (ev) => {
    if (Date.now() < arenaLongPress.suppressUntil) {
      arenaLongPress.suppressUntil = 0;
      return;
    }
    hidePieceContextMenu();
    hidePiecePickerMenu();
    const cell = ev.target?.closest?.(".cell");
    if (!cell) return;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);

    if (handleMapEditorTileAction(row, col)) {
      ev.preventDefault();
      requestArenaRefresh(true);
      return;
    }

    if (appState.placingTrainer) return; // handled by scoreboard-patch.js capture
    const placingPid = getPlacingPokemonPid();
    if (placingPid) {
      placePokemonOnBoardAt(appState.placing || placingPid, row, col);
      return;
    }

    const clickedPiece = getDomClickedPiece(ev);
    if (clickedPiece) {
      selectPiece(clickedPiece.id);
      requestArenaRefresh(true);
      return;
    }

    const candidates = getPiecesAt(row, col);
    if (candidates.length === 0) {
      if (appState.selectedPieceId) sendMoveSelected(row, col);
      return;
    }
    if (candidates.length === 1) {
      selectPiece(candidates[0].id);
      requestArenaRefresh(true);
      return;
    }
    openPiecePickerMenu(candidates, ev.clientX, ev.clientY);
  });

  arenaDom.addEventListener("contextmenu", (ev) => {
    const cell = ev.target?.closest?.(".cell");
    if (!cell) return;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    if (isMapEditorActive()) {
      ev.preventDefault();
      return;
    }
    const clickedPiece = getDomClickedPiece(ev);
    if (clickedPiece) {
      ev.preventDefault();
      openPieceContextMenu(clickedPiece, ev.clientX, ev.clientY);
      return;
    }
    const candidates = getPiecesAt(row, col).filter((p) => isPieceVisibleToMe(p));
    if (candidates.length === 0) return;
    ev.preventDefault();
    if (candidates.length === 1) {
      openPieceContextMenu(candidates[0], ev.clientX, ev.clientY);
      return;
    }
    openPiecePickerMenu(candidates, ev.clientX, ev.clientY, { afterPick: "context" });
  });
}

function ensureDomGrid() {
  if (!arenaDom) return;
  const gs = appState.gridSize || 10;
  if (gs === domGridSize && domCells.length === gs * gs) return;

  domGridSize = gs;
  domCells = new Array(gs * gs);
  arenaDom.style.gridTemplateColumns = `repeat(${gs}, 1fr)`;
  arenaDom.style.gridTemplateRows = `repeat(${gs}, 1fr)`;
  arenaDom.innerHTML = "";

  const frag = document.createDocumentFragment();
  for (let r = 0; r < gs; r++) {
    for (let c = 0; c < gs; c++) {
      const idx = r * gs + c;
      const cell = document.createElement("div");
      cell.className = "cell" + ((r + c) % 2 === 0 ? " alt" : "");
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      domCells[idx] = cell;
      frag.appendChild(cell);
    }
  }
  arenaDom.appendChild(frag);
}

let arenaDomRenderKey = "";
let arenaDomSyncTimer = null;

function getArenaDomRenderKey() {
  const wrapRect = canvasWrap?.getBoundingClientRect?.() || { width: 0, height: 0 };
  const wrapKey = `${Math.round(wrapRect.width)}x${Math.round(wrapRect.height)}`;
  const bgKey = getActiveMapImageCandidates().join("|");
  const pieceKey = (appState.pieces || [])
    .filter(Boolean)
    .map((p) => [
      safeStr(p?.id),
      safeStr(p?.pid),
      safeStr(p?.owner),
      safeStr(p?.kind),
      safeStr(p?.status || "active"),
      Number(p?.row),
      Number(p?.col),
      safeStr(getPieceSizeCategory(p)),
      p?.revealed ? "1" : "0",
    ].join(":"))
    .join("|");
  return [
    String(appState.gridSize || 10),
    wrapKey,
    bgKey,
    pieceKey,
    safeStr(appState.selectedPieceId),
    safeStr(getPlacingPokemonPid()),
    safeStr(appState.by),
    safeStr(appState.role),
  ].join("~");
}

function isArenaDomActive() {
  return !!arenaDom && arenaRenderMode === "dom";
}

function getArenaBoardMetrics() {
  const gs = Math.max(1, Number(appState.gridSize) || 10);
  const rect = canvasWrap?.getBoundingClientRect?.() || { width: 0, height: 0 };
  const pad = 20;
  const usableW = Math.max(0, rect.width - pad * 2);
  const usableH = Math.max(0, rect.height - pad * 2);
  const tile = Math.max(1, Math.floor(Math.min(usableW / gs, usableH / gs)));
  const side = gs * tile;
  const left = Math.floor((rect.width - side) / 2);
  const top = Math.floor((rect.height - side) / 2);
  return { gs, rect, pad, tile, side, left, top };
}

function syncSpriteOverlayVisibility() {
  if (!_spriteOverlay) return;
  const allowDomMapObjects = arenaRenderMode === "dom" && shouldUseMapTerrainPreview();
  _spriteOverlay.style.display = (arenaRenderMode === "dom" && !allowDomMapObjects) ? "none" : "";
}

function syncArenaDomIfNeeded(force = false) {
  if (!arenaDom || arenaRenderMode !== "dom") return;
  const nextKey = getArenaDomRenderKey();
  if (!force && nextKey === arenaDomRenderKey) return;
  renderArenaDom();
}

function renderArenaDom() {
  if (!arenaDom) return;
  _trimMegaEvolutionFx();
  ensureDomGrid();
  const board = getArenaBoardMetrics();
  const frameNow = window.performance?.now?.() ?? Date.now();
  arenaDom.style.left = `${board.left}px`;
  arenaDom.style.top = `${board.top}px`;
  arenaDom.style.width = `${board.side}px`;
  arenaDom.style.height = `${board.side}px`;
  syncSpriteOverlayVisibility();
  const bgCandidates = getActiveMapImageCandidates({ preferTerrain: shouldUseMapTerrainPreview() });
  const bgImageCss = bgCandidates
    .map((url) => `url("${String(url).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}")`)
    .join(", ");
  arenaDom.classList.toggle("has-map-bg", !!bgImageCss);
  arenaDom.style.backgroundImage = bgImageCss || "";
  arenaDom.style.backgroundSize = bgImageCss ? "100% 100%" : "";
  arenaDom.style.backgroundRepeat = bgImageCss ? "no-repeat" : "";
  arenaDom.style.backgroundPosition = bgImageCss ? "center center" : "";

  const gs = domGridSize;
  // limpa tokens e classes
  for (let i = 0; i < domCells.length; i++) {
    const cell = domCells[i];
    if (!cell) continue;
    cell.classList.remove("hover");
    cell.classList.remove("sel");
    cell.classList.remove("place-ok");
    cell.classList.remove("move-ok");
    cell.classList.remove("move-no");
    // remove todos os tokens (stacking pode ter múltiplos)
    cell.querySelectorAll(":scope > .token").forEach(t => t.remove());
  }


  // placing mode highlight (tiles válidos, size-aware)
  const placingPid = getPlacingPokemonPid();
  if (placingPid) {
    const placingSize = getPieceSizeCategory({ pid: placingPid });
    const fakePiece = { id: "__placing__", pid: placingPid, sizeCategory: placingSize };
    for (let r = 0; r < gs; r++) {
      for (let c = 0; c < gs; c++) {
        const cell = domCells[r * gs + c];
        if (!cell) continue;
        if (!isFootprintWithinGrid(r, c, placingSize, gs)) continue;
        if (!canPieceLandOn(fakePiece, r, c, appState.pieces || []).allowed) continue;
        cell.classList.add("place-ok");
      }
    }
  }

  updateMovementTurnState();
  const activePieces = (appState.pieces || []).filter((piece) => safeStr(piece?.status || "active") === "active");
  updatePieceFieldFx(activePieces, frameNow);
  const selPiece = (appState.pieces || []).find((p) => safeStr(p?.id) === safeStr(appState.selectedPieceId)) || null;
  if (!placingPid && selPiece && canCurrentPlayerMovePiece(selPiece.id)) {
    const reach = getReachableTileMap(selPiece);
    for (let r = 0; r < gs; r++) {
      for (let c = 0; c < gs; c++) {
        if (r === Number(selPiece.row) && c === Number(selPiece.col)) continue;
        const cell = domCells[r * gs + c];
        if (!cell) continue;
        if (reach.has(`${r}:${c}`)) cell.classList.add("move-ok");
        else cell.classList.add("move-no");
      }
    }
  }

  // coloca tokens (ordenados por z-index: grandes primeiro, pequenos por cima)
  const domSortedPieces = [...(appState.pieces || [])].filter(p =>
    safeStr(p?.status || "active") === "active" && isPieceVisibleToMe(p)
  ).sort((a, b) => {
    const za = getSizeDimensions(getPieceSizeCategory(a)).zIndex;
    const zb = getSizeDimensions(getPieceSizeCategory(b)).zIndex;
    return za - zb;
  });
  for (const p of domSortedPieces) {
    const r = Number(p?.row);
    const c = Number(p?.col);
    if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
    if (r < 0 || c < 0 || r >= gs || c >= gs) continue;
    const cell = domCells[r * gs + c];
    if (!cell) continue;
    const token = document.createElement("div");
    token.className = "token";
    token.dataset.pieceId = safeStr(p?.id);
    applyCaptureBallThemeToElement(token, getCaptureBallForTrainerPid(safeStr(p?.owner), p));
    applyPieceConditionFxToElement(token, p);
    syncPieceEnteringClass(token, safeStr(p?.id), frameNow);
    if (getMegaEvolutionFxState(p?.owner, p?.pid)) token.classList.add("mega-evolving");
    const sizeCategory = getPieceSizeCategory(p);
    const { tileW, tileH } = getSizeDimensions(sizeCategory);
    const label = p?.revealed ? shortLabelFromPiece(p, 4) : "?";
    const spriteUrl = p?.revealed
      ? (getSpriteUrlForPiece(p, { type: "battle" }) || getSpriteUrlForPiece(p, { type: "art" }))
      : "";
    token.classList.add(`size-${sizeCategory}`);
    if (safeStr(p?.kind) === "trainer") token.classList.add("trainer");
    if (spriteUrl) token.classList.add("has-sprite");

    const pad = Math.max(6, Math.floor(board.tile * 0.12));
    let tokenLeft = pad;
    let tokenTop = pad;
    let tokenWidth = board.tile - pad * 2;
    let tokenHeight = board.tile - pad * 2;
    if (sizeCategory === SIZE_CATEGORIES.tiny) {
      const tinyOnTile = getPiecesOccupyingTile(r, c, appState.pieces || [])
        .filter((q) => getPieceSizeCategory(q) === SIZE_CATEGORIES.tiny && isPieceVisibleToMe(q));
      const slotIndex = Math.max(0, tinyOnTile.findIndex((q) => safeStr(q?.id) === safeStr(p?.id)));
      const slot = getTinySlotPosition(slotIndex);
      tokenLeft = Math.round(slot.offsetXRatio * board.tile);
      tokenTop = Math.round(slot.offsetYRatio * board.tile);
      tokenWidth = Math.round(slot.sizeRatio * board.tile);
      tokenHeight = Math.round(slot.sizeRatio * board.tile);
    } else if (sizeCategory === SIZE_CATEGORIES.large || sizeCategory === SIZE_CATEGORIES.huge) {
      const pad2 = Math.max(4, Math.floor(board.tile * 0.06));
      tokenLeft = pad2;
      tokenTop = pad2;
      tokenWidth = board.tile * tileW - pad2 * 2;
      tokenHeight = board.tile * tileH - pad2 * 2;
    }
    token.style.left = `${tokenLeft}px`;
    token.style.top = `${tokenTop}px`;
    token.style.width = `${tokenWidth}px`;
    token.style.height = `${tokenHeight}px`;
    const tokenHpValue = safeStr(p?.kind) !== "trainer" ? getPartyHp(safeStr(p?.owner), p) : 6;
    if (tokenHpValue <= 0) token.classList.add("hp-ko");

    if (spriteUrl) {
      const img = document.createElement("img");
      img.className = "token-sprite";
      img.alt = label;
      img.loading = "eager";
      img.decoding = "async";
      const fallbackUrl = getSpriteFallbackUrlForPiece(p);
      img.onerror = function () {
        const fallback = this.dataset.fallback || "";
        if (fallback && this.src !== fallback) this.src = fallback;
        else this.style.display = "none";
      };
      img.dataset.fallback = fallbackUrl;
      img.src = spriteUrl;
      token.appendChild(img);
    }
    const labelEl = document.createElement("span");
    labelEl.className = "token-label";
    labelEl.textContent = label;
    if (!spriteUrl) {
      token.textContent = label;
    }
    if (sizeCategory === SIZE_CATEGORIES.tiny) {
      labelEl.style.left = "2px";
      labelEl.style.top = "2px";
      labelEl.style.padding = "1px 4px";
      labelEl.style.fontSize = "8px";
    }
    token.appendChild(labelEl);
    if (safeStr(p?.kind) !== "trainer") {
      const hpUi = getHpUiState(tokenHpValue);
      const hpTrack = document.createElement("div");
      hpTrack.className = "token-hp";
      const hpFill = document.createElement("div");
      hpFill.className = "token-hp-fill";
      hpFill.style.width = `${hpUi.pct}%`;
      hpFill.style.background = hpUi.color;
      hpTrack.appendChild(hpFill);
      token.appendChild(hpTrack);
    }
    cell.appendChild(token);

    if (safeStr(appState.selectedPieceId) && safeStr(appState.selectedPieceId) === safeStr(p?.id)) {
      cell.classList.add("sel");
    }
  }

  if (shouldUseMapTerrainPreview() && mapLayersState.version === 2) {
    syncMapObjectOverlays(board.left, board.top, board.tile);
  } else {
    _cleanObjSpritePool();
  }

  updateArenaDomHover();
  arenaDomRenderKey = getArenaDomRenderKey();
}

function updateArenaDomHover() {
  if (!arenaDom) return;
  const gs = domGridSize;
  // remove hover
  for (const cell of domCells) cell?.classList.remove("hover");
  if (appState.hover.row == null) return;
  const r = Number(appState.hover.row);
  const c = Number(appState.hover.col);
  if (!Number.isFinite(r) || !Number.isFinite(c)) return;
  if (r < 0 || c < 0 || r >= gs || c >= gs) return;
  domCells[r * gs + c]?.classList.add("hover");
}


// -------------------------
// Map background (procedural) + optional URL override
// -------------------------
const mapCache = {
  key: "",
  gs: 10,
  theme: "biome_grass",
  seed: 0,
  tiles: null, // Float32 shade noise [gs*gs]
  deco: [], // {row,col,type,variant}
  bgUrl: "",
  bgUrls: [],
  bgUrlIndex: 0,
  bgRec: null,
};

// ── Structured map data (BiomeGenerator JSON) ─────────────────────────────
const mapDataState = {
  url: "",          // URL do mapa efetivo hoje renderizado
  data: null,       // JSON efetivo usado pelo renderer (base + edits locais ou JSON publicado)
  loading: false,
  borderMap: null,  // Map<"row,col", land_mask> do mapa efetivo
  currentUrl: "",   // JSON publicado atual (mapDataUrl)
  currentData: null,
  currentLoading: false,
  currentBorderMap: null,
  baseUrl: "",      // JSON base sem edits (mapBaseDataUrl)
  baseData: null,
  baseLoading: false,
  baseBorderMap: null,
};

// ── v2 map layers state ─────────────────────────────────────────────────────
// Populated when a v2 JSON (meta.version === 2) is loaded.
// Sprites are loaded asynchronously via loadSprite() and tracked here.
const mapLayersState = {
  version: 1,          // 1 = legacy, 2 = new layers format
  objects: [],         // Array of v2 object descriptors from JSON
  _objSpritePool: new Map(), // id → {el: HTMLImageElement, url: string}
  _usedObjIds: new Set(),
};

// ── Offscreen ground-layer cache ───────────────────────────────────────────
// Caches the static (non-animated) ground layer so draw() doesn't rebuild it
// every frame.  Rebuilt only when map key or zoom level changes.
const _groundLayerCache = {
  canvas: null,   // HTMLCanvasElement
  ctx: null,
  key: "",        // last cache key: `{mapCache.key}|{Math.round(tile)}`
};

/**
 * Ensure the offscreen ground cache is up-to-date and return its canvas.
 * @param {number} gs   grid size (cells)
 * @param {number} tile tile size in pixels (current zoom)
 * @returns {HTMLCanvasElement}
 */
function _ensureGroundCache(gs, tile) {
  const tileInt = Math.round(tile);
  const bg = ensureMapBackgroundRecord();
  const bgUrl = safeStr(mapCache.bgUrl);
  // Include PNG load state in key so cache rebuilds once the image finishes loading
  const bgState = bg && bg.ready && !bg.failed ? "r" : bg && bg.failed ? "f" : "p";
  const key = `${mapCache.key}|${tileInt}|${bgUrl}|${bgState}`;
  if (key === _groundLayerCache.key && _groundLayerCache.canvas) {
    return _groundLayerCache.canvas;
  }
  const w = gs * tileInt;
  const h = gs * tileInt;
  if (!_groundLayerCache.canvas) {
    _groundLayerCache.canvas = document.createElement("canvas");
  }
  _groundLayerCache.canvas.width  = w;
  _groundLayerCache.canvas.height = h;
  _groundLayerCache.ctx = _groundLayerCache.canvas.getContext("2d");
  const lctx = _groundLayerCache.ctx;
  lctx.clearRect(0, 0, w, h);

  if (bg && bg.ready && !bg.failed) {
    lctx.globalAlpha = 0.92;
    lctx.drawImage(bg.img, 0, 0, w, h);
    lctx.globalAlpha = 1;
    lctx.fillStyle = "rgba(2,6,23,0.10)";
    lctx.fillRect(0, 0, w, h);
  } else {
    // drawProceduralMap already accepts an arbitrary ctx and ox/oy=0
    drawProceduralMap(lctx, 0, 0, gs, tileInt);
  }
  _groundLayerCache.key = key;
  return _groundLayerCache.canvas;
}

function ensureMapBackgroundRecord() {
  const urls = Array.isArray(mapCache.bgUrls) ? mapCache.bgUrls : [];
  if (!urls.length) {
    mapCache.bgUrl = "";
    mapCache.bgUrlIndex = 0;
    mapCache.bgRec = null;
    return null;
  }

  let idx = Math.max(0, Number(mapCache.bgUrlIndex) || 0);
  while (idx < urls.length) {
    const url = urls[idx];
    const rec = loadSprite(url);
    mapCache.bgUrlIndex = idx;
    mapCache.bgUrl = url;
    mapCache.bgRec = rec;
    if (!rec || rec.failed) {
      idx += 1;
      continue;
    }
    return rec;
  }

  mapCache.bgUrl = "";
  mapCache.bgUrlIndex = urls.length;
  mapCache.bgRec = null;
  return null;
}

/**
 * Parse v2 map JSON, populate mapLayersState, and begin loading object sprites.
 * Resolves sprite URLs relative to the JSON URL.
 * Safe to call on v1 JSON — does nothing in that case.
 */
function buildBorderMapFromData(data) {
  if (!Array.isArray(data?.water_cells)) return null;
  return new Map(
    data.water_cells
      .filter((cell) => cell?.kind === "border")
      .map((cell) => [`${cell.grid_y},${cell.grid_x}`, cell.land_mask || 0])
  );
}

function getCatalogAssetMeta(assetPool, assetId) {
  return mapEditorState.assetIndex.get(`${safeStr(assetPool)}::${safeStr(assetId)}`) || null;
}

function resolveObjectSpriteUrl(obj, jsonUrl) {
  const spriteValue = safeStr(obj?.sprite);
  if (spriteValue) {
    try {
      return jsonUrl ? new URL(spriteValue, jsonUrl).href : spriteValue;
    } catch {
      return spriteValue;
    }
  }
  const assetMeta = getCatalogAssetMeta(obj?.assetPool, obj?.assetId);
  return safeStr(assetMeta?.spriteUrl || "");
}

function _initMapLayersFromData(data, jsonUrl) {
  const ver = data?.meta?.version;
  if (ver !== 2 || !Array.isArray(data.objects)) {
    mapLayersState.version = 1;
    mapLayersState.objects = [];
    return;
  }
  mapLayersState.version = 2;
  mapLayersState.objects = data.objects.map((rawObj) => {
    const obj = normalizeMapObject(rawObj);
    const spriteUrl = resolveObjectSpriteUrl(obj, jsonUrl);
    if (spriteUrl) {
      obj._spriteUrl = spriteUrl;
      loadSprite(spriteUrl);
    }
    const assetMeta = getCatalogAssetMeta(obj.assetPool, obj.assetId);
    if (assetMeta) obj._assetMeta = assetMeta;
    return obj;
  });

  mapLayersState._usedObjIds.clear();
}

const MAP_OBJECT_VISUAL_SCALE = 0.54;

function getMapObjectVisualScale(obj) {
  const assetMeta = obj?._assetMeta || getCatalogAssetMeta(obj?.assetPool, obj?.assetId) || null;
  const rawScale = Number(assetMeta?.renderScale ?? assetMeta?.visualScale ?? obj?.renderScale ?? obj?.visualScale);
  if (Number.isFinite(rawScale) && rawScale > 0) {
    return Math.max(0.2, Math.min(1.5, rawScale));
  }
  return MAP_OBJECT_VISUAL_SCALE;
}

function scaleMapObjectRectToAnchor(rect, obj, ox, oy, tile) {
  const visualScale = getMapObjectVisualScale(obj);
  if (!Number.isFinite(visualScale) || visualScale === 1) return rect;
  const fw = Number(obj?.footprint?.w || 1) || 1;
  const fh = Number(obj?.footprint?.h || 1) || 1;
  const ax = Number(obj?.anchor?.ax ?? 0.5) || 0.5;
  const ay = Number(obj?.anchor?.ay ?? 1.0) || 1.0;
  const anchorX = ox + (Number(obj?.x || 0) + ax * fw) * tile;
  const anchorY = oy + (Number(obj?.y || 0) + ay * fh) * tile;
  return {
    x: anchorX - (anchorX - rect.x) * visualScale,
    y: anchorY - (anchorY - rect.y) * visualScale,
    w: rect.w * visualScale,
    h: rect.h * visualScale,
  };
}

/**
 * Draw one map object sprite onto ctx at grid position (ox/oy origin, tile px).
 * Returns false if the sprite isn't loaded yet.
 */
function getMapObjectDrawRect(obj, ox, oy, tile) {
  const render = obj?.render || {};
  const mapTilePx = getEffectiveMapTilePx();
  const renderW = Number(render?.w || 0);
  const renderH = Number(render?.h || 0);
  if (renderW > 0 && renderH > 0 && mapTilePx > 0) {
    const scale = tile / mapTilePx;
    return scaleMapObjectRectToAnchor({
      x: ox + Number(render?.pxX || 0) * scale,
      y: oy + Number(render?.pxY || 0) * scale,
      w: renderW * scale,
      h: renderH * scale,
    }, obj, ox, oy, tile);
  }

  const assetMeta = obj?._assetMeta || getCatalogAssetMeta(obj?.assetPool, obj?.assetId) || null;
  const baseTilePx = Number(assetMeta?.baseTilePx || 32) || 32;
  const imageW = Number(assetMeta?.image?.w || 0) || Math.max(1, Number(obj?.footprint?.w || 1) * baseTilePx);
  const imageH = Number(assetMeta?.image?.h || 0) || Math.max(1, Number(obj?.footprint?.h || 1) * baseTilePx);
  const scale = tile / baseTilePx;
  const drawW = imageW * scale;
  const drawH = imageH * scale;
  const fw = Number(obj?.footprint?.w || 1) || 1;
  const fh = Number(obj?.footprint?.h || 1) || 1;
  const ax = Number(obj?.anchor?.ax ?? 0.5) || 0.5;
  const ay = Number(obj?.anchor?.ay ?? 1.0) || 1.0;
  const footX = ox + (Number(obj?.x || 0) + ax * fw) * tile;
  const footY = oy + (Number(obj?.y || 0) + ay * fh) * tile;
  return scaleMapObjectRectToAnchor({
    x: footX - ax * drawW,
    y: footY - ay * drawH,
    w: drawW,
    h: drawH,
  }, obj, ox, oy, tile);
}

function _drawMapObject(ctx, obj, ox, oy, tile) {
  const url = obj._spriteUrl;
  if (!url) return false;
  const rec = loadSprite(url);
  if (!rec || !rec.ready || rec.failed) return false;
  const rect = getMapObjectDrawRect(obj, ox, oy, tile);
  ctx.drawImage(rec.img, rect.x, rect.y, rect.w, rect.h);
  return true;
}

/**
 * Manage HTML <img> overlay for a map object (for z-index Y-sort via CSS stacking).
 * Similar to the entity _spritePool pattern.
 * Returns the HTMLImageElement entry (may not be ready yet).
 */
function _getObjSpriteOverlayEntry(obj, spriteOverlayEl) {
  const id   = safeStr(obj.id || "");
  const url  = safeStr(obj._spriteUrl || "");
  if (!id || !url) return null;

  mapLayersState._usedObjIds.add(id);

  let entry = mapLayersState._objSpritePool.get(id);
  if (!entry) {
    const el = document.createElement("img");
    el.className      = "spr-overlay-img";
    el.draggable      = false;
    el.loading        = "eager";
    el.decoding       = "async";
    el.alt            = "";
    el.style.pointerEvents = "none";
    el.onerror = function() { this.style.display = "none"; };
    spriteOverlayEl.appendChild(el);
    entry = { el, url: "" };
    mapLayersState._objSpritePool.set(id, entry);
  }
  if (entry.url !== url) {
    entry.el.src            = url;
    entry.el.style.display  = "";
    entry.url               = url;
  }
  return entry;
}

function renderMapObjectOverlay(obj, spriteOverlayEl, ox, oy, tile) {
  if (!obj?._spriteUrl) return;
  const entry = _getObjSpriteOverlayEntry(obj, spriteOverlayEl);
  if (!entry) return;
  const rect = getMapObjectDrawRect(obj, ox, oy, tile);
  const st = entry.el.style;
  st.left = `${rect.x}px`;
  st.top = `${rect.y}px`;
  st.width = `${rect.w}px`;
  st.height = `${rect.h}px`;
  st.zIndex = `${Math.round((Number(obj?.y || 0) + (Number(obj?.anchor?.ay ?? 1) || 1) * (Number(obj?.footprint?.h || 1) || 1)) * 10)}`;
}

function syncMapObjectOverlays(ox, oy, tile) {
  if (!_spriteOverlay) return;
  for (const obj of mapLayersState.objects || []) {
    renderMapObjectOverlay(obj, _spriteOverlay, ox, oy, tile);
  }
  _cleanObjSpritePool();
}

/**
 * Remove stale object overlay elements (objects no longer in the active set).
 */
function _cleanObjSpritePool() {
  for (const [id, entry] of mapLayersState._objSpritePool) {
    if (!mapLayersState._usedObjIds.has(id)) {
      entry.el.remove();
      mapLayersState._objSpritePool.delete(id);
    }
  }
  mapLayersState._usedObjIds.clear();
}

// Autotile coordinate lookup: land_mask (0-15) → {r, c} within one 5×3 frame block.
// Mirrors Python's _BLOCK_3X3 + _BLOCK_EXT layout (N=1,E=2,S=4,W=8).
// The ocean-autotiles-anim.png has 3 animation frames side by side, each 5 cols wide.
const OCEAN_AUTOTILE_MAP = {
   0: {r:1, c:1},  1: {r:0, c:1},  2: {r:1, c:2},  3: {r:0, c:2},
   4: {r:2, c:1},  5: {r:0, c:4},  6: {r:2, c:2},  8: {r:1, c:0},
   9: {r:0, c:0}, 10: {r:1, c:3}, 11: {r:0, c:3}, 12: {r:2, c:0},
  13: {r:2, c:4}, 14: {r:2, c:3}, 15: {r:1, c:4},
};

// ── Shore-foam overlay (sand tiles bordering water) ───────────────────────
// Each entry maps water_mask → top-left pixel of the 4-frame strip (128×32)
// in ocean-autotiles-anim.png. N=1, E=2, S=4, W=8.
const SHORE = {
  4:  { x: 151, y: 9   },  // water south
  2:  { x: 7,   y: 57  },  // water east
  8:  { x: 439, y: 57  },  // water west
  1:  { x: 151, y: 105 },  // water north
  3:  { x: 7,   y: 105 },  // N+E
  9:  { x: 295, y: 105 },  // N+W
  6:  { x: 7,   y: 9   },  // S+E
  12: { x: 295, y: 9   },  // S+W
};
const SHORE_FPS  = 6;
const SHORE_TILE = 32;

/** 4-dir water mask for a SAND cell at grid column cx, row ry. */
function waterMask(grid, cx, ry) {
  const gh = grid.length;
  const gw = grid[0]?.length ?? 0;
  let mask = 0;
  if (ry > 0      && grid[ry - 1][cx] === 2) mask |= 1; // N
  if (cx < gw - 1 && grid[ry][cx + 1] === 2) mask |= 2; // E
  if (ry < gh - 1 && grid[ry + 1][cx] === 2) mask |= 4; // S
  if (cx > 0      && grid[ry][cx - 1] === 2) mask |= 8; // W
  return mask;
}

/** Frame index for tile at (cx, ry) at time nowMs, with per-tile phase desync. */
function animFrame(nowMs, cx, ry) {
  const globalFrame = Math.floor((nowMs / 1000) * SHORE_FPS) % 4;
  const phase       = (((cx * 73856093) ^ (ry * 19349663)) >>> 0) % 4;
  return (globalFrame + phase) % 4;
}

/**
 * drawShoreOverlay — renders animated shore-foam on SAND tiles (==1) that
 * border WATER tiles (==2). Call this AFTER drawWaterCells.
 */
function drawShoreOverlay(ctx, ox, oy, gs, tile) {
  if (!oceanAnim.ready) return;
  const md = mapDataState.data;
  if (!md || !Array.isArray(md.terrain_grid)) return;

  const grid = md.terrain_grid;
  const gh   = grid.length;
  const gw   = gh > 0 ? grid[0].length : 0;
  if (!gh || !gw) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, gs * tile, gs * tile);
  ctx.clip();

  // Ajuste de cor: desloca o azul-cyan do spritesheet (H≈201°)
  // para próximo do azul-periwinkle do beach.png (H≈223°).
  // Sem brightness para não amplificar o fundo amarelo/creme do sprite.
  // globalAlpha deixa assets abaixo transparecerem.
  ctx.filter = 'hue-rotate(22deg) saturate(0.65)';
  ctx.globalAlpha = 0.85;

  for (let ry = 0; ry < Math.min(gh, gs); ry++) {
    for (let cx = 0; cx < Math.min(gw, gs); cx++) {
      if (grid[ry][cx] !== 1) continue; // only sand cells

      const mask = waterMask(grid, cx, ry);
      if (mask === 0) continue;          // no water neighbor

      const entry = SHORE[mask];
      if (!entry) continue;              // mask combo not in table

      const fi = animFrame(Date.now(), cx, ry);
      const sx    = entry.x + fi * SHORE_TILE;
      const sy    = entry.y;
      const dx    = ox + cx * tile;
      const dy    = oy + ry * tile;

      ctx.drawImage(
        oceanAnim.img,
        sx, sy, SHORE_TILE, SHORE_TILE,
        dx, dy, tile, tile
      );
    }
  }

  ctx.restore(); // restaura filter, globalAlpha e clip de uma vez
}

/**
 * drawWaterBorderFoam — desenha o padrão de bolhas/espuma (do ocean-autotiles-anim.png)
 * nos cells de ÁGUA (==2) que tocam cells de AREIA (==1) ou terra.
 * Usa OCEAN_AUTOTILE_MAP com land_mask (vizinho não-água = bit ligado).
 * Ciclo lento de 2 frames (800ms cada) sem dessincronia — espuma uniforme.
 */
function drawWaterBorderFoam(ctx, ox, oy, gs, tile) {
  if (!oceanAnim.ready) return;
  const md = mapDataState.data;
  if (!md || !Array.isArray(md.terrain_grid)) return;

  const grid = md.terrain_grid;
  const gh   = grid.length;
  const gw   = gh > 0 ? grid[0].length : 0;
  if (!gh || !gw) return;

  const nowMs = Date.now();

  // helper: desenha só 1 quadrante (16×16 source -> tile/2 destino) de um tile de máscara
  const drawQuad = (dstX, dstY, corner, srcMask, cx, ry) => {
    // corner: "nw" | "ne" | "sw" | "se"
    const fi = animFrame(nowMs, cx, ry);
    const { sx: baseX, sy: baseY } = oceanSrcForMask(srcMask, fi);

    const halfS = OCEAN_TS / 2;          // 16
    const halfD = tile / 2;

    const offX = (corner === "ne" || corner === "se") ? halfS : 0;
    const offY = (corner === "sw" || corner === "se") ? halfS : 0;

    const dx = dstX + ((corner === "ne" || corner === "se") ? halfD : 0);
    const dy = dstY + ((corner === "sw" || corner === "se") ? halfD : 0);

    ctx.drawImage(
      oceanAnim.img,
      baseX + offX, baseY + offY, halfS, halfS,
      dx, dy, halfD, halfD
    );
  };

  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, gs * tile, gs * tile);
  ctx.clip();

  // Harmoniza com beach.png
  ctx.filter = 'hue-rotate(22deg) saturate(0.65)';
  ctx.globalAlpha = 0.78;

  for (let r = 0; r < Math.min(gh, gs); r++) {
    for (let c = 0; c < Math.min(gw, gs); c++) {
      if (grid[r][c] !== 2) continue; // água

      const dx = ox + c * tile;
      const dy = oy + r * tile;

      // land_mask: bit liga se o vizinho NÃO é água (N=1,E=2,S=4,W=8)
      let mask = 0;
      const nWater = !(r > 0)      ? true : (grid[r - 1][c] === 2);
      const eWater = !(c < gw - 1) ? true : (grid[r][c + 1] === 2);
      const sWater = !(r < gh - 1) ? true : (grid[r + 1][c] === 2);
      const wWater = !(c > 0)      ? true : (grid[r][c - 1] === 2);

      if (!nWater) mask |= 1;
      if (!eWater) mask |= 2;
      if (!sWater) mask |= 4;
      if (!wWater) mask |= 8;

      // 1) Célula de água de BORDA (toque cardinal com terra): desenha tile inteiro animado
      if (mask !== 0) {
        const fi = animFrame(nowMs, c, r);
        const { sx, sy } = oceanSrcForMask(mask, fi);
        ctx.drawImage(oceanAnim.img, sx, sy, OCEAN_TS, OCEAN_TS, dx, dy, tile, tile);
        continue;
      }

      // 2) Célula de água INTERIOR: normalmente não desenha nada aqui.
      // Mas: se existir terra apenas na diagonal, precisamos desenhar SÓ o quadradinho de quina.
      // Isso corrige o "buraco" de quina (como no print do Malamar).
      const nwLand = (r > 0 && c > 0) && (grid[r - 1][c - 1] !== 2);
      const neLand = (r > 0 && c < gw - 1) && (grid[r - 1][c + 1] !== 2);
      const swLand = (r < gh - 1 && c > 0) && (grid[r + 1][c - 1] !== 2);
      const seLand = (r < gh - 1 && c < gw - 1) && (grid[r + 1][c + 1] !== 2);

      // Só aplica se os dois cardinais adjacentes forem água (diagonal "pura")
      if (nwLand && nWater && wWater) drawQuad(dx, dy, "nw", 9,  c, r);   // N+W
      if (neLand && nWater && eWater) drawQuad(dx, dy, "ne", 3,  c, r);   // N+E
      if (swLand && sWater && wWater) drawQuad(dx, dy, "sw", 12, c, r);   // S+W
      if (seLand && sWater && eWater) drawQuad(dx, dy, "se", 6,  c, r);   // S+E
    }
  }

  ctx.restore();
}


function refreshEffectiveMapData() {
  let effectiveData = null;
  let effectiveUrl = "";
  let effectiveBorderMap = null;

  if (shouldUseMapTerrainPreview() && mapDataState.baseData) {
    effectiveData = applyMapEditsToMapData(mapDataState.baseData, mapEditorState.draft || mapEditorState.published || createEmptyMapEdits());
    effectiveUrl = mapDataState.baseUrl || mapDataState.currentUrl || "";
    effectiveBorderMap = buildBorderMapFromData(effectiveData);
  } else if (mapDataState.currentData) {
    effectiveData = cloneJson(mapDataState.currentData);
    effectiveUrl = mapDataState.currentUrl || "";
    effectiveBorderMap = mapDataState.currentBorderMap;
  } else if (mapDataState.baseData) {
    effectiveData = applyMapEditsToMapData(mapDataState.baseData, mapEditorState.published || createEmptyMapEdits());
    effectiveUrl = mapDataState.baseUrl || "";
    effectiveBorderMap = buildBorderMapFromData(effectiveData);
  }

  mapDataState.data = effectiveData;
  mapDataState.url = effectiveUrl;
  mapDataState.borderMap = effectiveBorderMap;

  if (effectiveData) {
    _initMapLayersFromData(effectiveData, effectiveUrl);
  } else {
    mapLayersState.version = 1;
    mapLayersState.objects = [];
  }

  renderMapEditorPanel?.();
  try { requestArenaRefresh(true); } catch {}
}

async function maybeLoadMapAssetCatalog() {
  const url = getActiveMapAssetCatalogUrl();
  if (!url || url === mapEditorState.catalogUrl || mapEditorState.catalogLoading) return;
  mapEditorState.catalogLoading = true;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`catalog http ${res.status}`);
    const data = await res.json();
    mapEditorState.catalogUrl = url;
    mapEditorState.catalog = data;
    mapEditorState.assetIndex = new Map(
      (Array.isArray(data?.assets) ? data.assets : []).map((asset) => [`${safeStr(asset.assetPool)}::${safeStr(asset.assetId)}`, asset])
    );
    if (!safeStr(mapEditorState.selectedPool)) {
      const nonEmptyPool = (Array.isArray(data?.pools) ? data.pools : []).find((pool) => Number(pool?.count || 0) > 0);
      mapEditorState.selectedPool = safeStr(nonEmptyPool?.name);
    }
    refreshEffectiveMapData();
  } catch (err) {
    console.warn("[mapEditorCatalog] fetch failed:", err);
  } finally {
    mapEditorState.catalogLoading = false;
  }
}

async function maybeLoadCurrentMapData() {
  const url = getActiveMapDataUrl();
  if (!url || url === mapDataState.currentUrl || mapDataState.currentLoading) return;
  mapDataState.currentLoading = true;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`mapData http ${res.status}`);
    const data = await res.json();
    mapDataState.currentUrl = url;
    mapDataState.currentData = data;
    mapDataState.currentBorderMap = buildBorderMapFromData(data);
    refreshEffectiveMapData();
  } catch (err) {
    console.warn("[mapData/current] fetch failed:", err);
    mapDataState.currentData = null;
    mapDataState.currentBorderMap = null;
    refreshEffectiveMapData();
  } finally {
    mapDataState.currentLoading = false;
  }
}

async function maybeLoadMapBaseData() {
  const url = getActiveMapBaseDataUrl();
  if (!url || url === mapDataState.baseUrl || mapDataState.baseLoading) return;
  mapDataState.baseLoading = true;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`baseMapData http ${res.status}`);
    const data = await res.json();
    mapDataState.baseUrl = url;
    mapDataState.baseData = data;
    mapDataState.baseBorderMap = buildBorderMapFromData(data);
    refreshEffectiveMapData();
  } catch (err) {
    console.warn("[mapData/base] fetch failed:", err);
    mapDataState.baseData = null;
    mapDataState.baseBorderMap = null;
    refreshEffectiveMapData();
  } finally {
    mapDataState.baseLoading = false;
  }
}

async function maybeLoadMapData() {
  await Promise.allSettled([
    maybeLoadCurrentMapData(),
    maybeLoadMapBaseData(),
    maybeLoadMapAssetCatalog(),
  ]);
}

// ── Ocean-autotiles-anim sprite sheet ──────────────────────────────────────
// Layout (this PNG): 3 animation frames stacked vertically.
// Each frame is a single row of 22 tiles (32px). There is 7px left padding, 9px top padding,
// and a 16px vertical gap between frames. We keep using OCEAN_AUTOTILE_MAP (5×3 coords),
// but flatten it to a single row index: col = r*5 + c (0..14).
const oceanAnim = {
  img: null,
  ready: false,
};

// Source slicing params for ./assets/ocean-autotiles-anim.png
// Layout real do PNG:
// - 3 linhas de *blocos* (r=0..2), espaçados por 16px no eixo Y
// - 5 colunas de *blocos* (c=0..4), espaçados por 16px no eixo X
// - cada bloco tem 4 frames horizontais (4×32px = 128px) e altura 32px
// Portanto: para um land_mask -> {r,c}, pegamos o bloco e escolhemos o frame (0..3).
const OCEAN_TS = 32;
const OCEAN_FRAME_COUNT = 4;

const OCEAN_BLOCK_W = OCEAN_TS * OCEAN_FRAME_COUNT; // 128
const OCEAN_BLOCK_H = OCEAN_TS;                      // 32
const OCEAN_GAP_X   = 16;
const OCEAN_GAP_Y   = 16;

const OCEAN_BLOCK_X0 = 7;  // primeiro bloco começa em x=7
const OCEAN_BLOCK_Y0 = 9;  // primeiro bloco começa em y=9
const OCEAN_BLOCK_STRIDE_X = OCEAN_BLOCK_W + OCEAN_GAP_X; // 144
const OCEAN_BLOCK_STRIDE_Y = OCEAN_BLOCK_H + OCEAN_GAP_Y; // 48

function oceanSrcForMask(mask, frameIndex) {
  const tc = OCEAN_AUTOTILE_MAP[mask] || { r: 1, c: 1 };
  const fi = ((frameIndex % OCEAN_FRAME_COUNT) + OCEAN_FRAME_COUNT) % OCEAN_FRAME_COUNT;

  const sx = OCEAN_BLOCK_X0 + tc.c * OCEAN_BLOCK_STRIDE_X + fi * OCEAN_TS;
  const sy = OCEAN_BLOCK_Y0 + tc.r * OCEAN_BLOCK_STRIDE_Y;
  return { sx, sy };
}


(function loadOceanAnim() {
  const img = new Image();
  img.onload = () => {
    oceanAnim.img = img;
    oceanAnim.ready = true;
    console.log('[oceanAnim] ocean-autotiles-anim.png loaded.');
  };
  img.onerror = () => console.warn('[oceanAnim] failed to load ocean-autotiles-anim.png');
  img.src = './assets/ocean-autotiles-anim.png';
})();

function _u32(n) {
  return (Number(n) >>> 0);
}

function mulberry32(a) {
  let t = _u32(a);
  return function () {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function getActiveMapImageCandidates(options = {}) {
  const preferTerrain = !!options.preferTerrain;
  const urls = [];
  const b = appState.board || {};
  if (!preferTerrain) {
    pushUniqueString(urls, mapUrlOverride);
    pushUniqueString(urls, b.mapTokenUrl);
    pushUniqueString(urls, b.map_token_url);
    pushUniqueString(urls, b.mapUrl);
    pushUniqueString(urls, b.map_url);
    pushUniqueString(urls, b.backgroundTokenUrl);
    pushUniqueString(urls, b.background_token_url);
    pushUniqueString(urls, b.backgroundUrl);
    pushUniqueString(urls, b.background_url);
    const storagePath = safeStr(
      b.mapStoragePath || b.map_storage_path || b.backgroundStoragePath || b.background_storage_path
    );
    if (storagePath) pushUniqueString(urls, storageMediaUrl(storagePath));
  }
  pushUniqueString(urls, getActiveMapTerrainUrl());
  if (!preferTerrain) {
    pushUniqueString(urls, getActiveMapTerrainUrl());
  }
  return urls;
}

function getActiveMapUrl() {
  return getActiveMapImageCandidates()[0] || "";
}

function getActiveMapDataUrl() {
  const b = appState.board || {};
  const urls = [];
  pushUniqueString(urls, b.mapDataTokenUrl);
  pushUniqueString(urls, b.map_data_token_url);
  pushUniqueString(urls, b.mapDataUrl);
  pushUniqueString(urls, b.map_data_url);
  const storagePath = safeStr(b.mapDataStoragePath || b.map_data_storage_path);
  if (storagePath) pushUniqueString(urls, storageMediaUrl(storagePath));
  return urls[0] || "";
}

function maybeRebuildMapCache() {
  // Fire-and-forget fetch of structured map JSON when mapDataUrl changes
  maybeLoadMapData();

  const gs = appState.gridSize || 10;
  const theme = safeStr(appState.theme) || "biome_grass";
  const seed = _u32(appState.board?.seed || 0);
  const bgUrls = getActiveMapImageCandidates({ preferTerrain: shouldUseMapTerrainPreview() });
  const bgKey = bgUrls.join("|");
  const key = `${gs}|${theme}|${seed}|${bgKey}|${safeStr(getActiveMapDataUrl())}|${safeStr(getActiveMapBaseDataUrl())}|${Number(appState.board?.mapEditRevision || 0)}`;
  if (key === mapCache.key) return;

  mapCache.key = key;
  mapCache.gs = gs;
  mapCache.theme = theme;
  mapCache.seed = seed;
  mapCache.bgUrls = bgUrls;
  mapCache.bgUrlIndex = 0;
  mapCache.bgUrl = bgUrls[0] || "";
  mapCache.bgRec = mapCache.bgUrl ? loadSprite(mapCache.bgUrl) : null;

  // Procedural: per-tile noise + decorations based on seed
  const rng = mulberry32(seed ^ 0xA5A5A5A5);
  const tiles = new Float32Array(gs * gs);
  const deco = [];

  for (let r = 0; r < gs; r++) {
    for (let c = 0; c < gs; c++) {
      const i = r * gs + c;
      // noise in [-1..1]
      tiles[i] = (rng() * 2 - 1) * 0.35 + (rng() * 2 - 1) * 0.15;
    }
  }

  // simple dirt patch (like road)
  const patchW = Math.max(2, Math.floor(gs * 0.28));
  const patchH = Math.max(2, Math.floor(gs * 0.28));
  const patchR = Math.floor(gs * (0.55 + rng() * 0.25)) - patchH // center-ish
  const patchC = Math.floor(gs * (0.55 + rng() * 0.25)) - patchW
  mapCache.patch = { r: Math.max(0, patchR), c: Math.max(0, patchC), w: patchW, h: patchH };

  // decorations
  const decoCount = Math.max(6, Math.floor(gs * gs * 0.08));
  const types = theme.includes('cave') ? ['rock', 'rock', 'crystal'] : ['tree', 'bush', 'rock'];
  for (let i = 0; i < decoCount; i++) {
    const row = Math.floor(rng() * gs);
    const col = Math.floor(rng() * gs);
    const t = types[Math.floor(rng() * types.length)];
    // avoid patch area
    const P = mapCache.patch;
    if (row >= P.r && row < P.r + P.h && col >= P.c && col < P.c + P.w) continue;
    deco.push({ row, col, type: t, variant: Math.floor(rng() * 3) });
  }

  mapCache.tiles = tiles;
  mapCache.deco = deco;
}

/**
 * Retorna true se a célula (r,c) é borda de água (adjacente a terreno não-água
 * ou a uma borda do grid).  Fallback quando water_border_cells não está no JSON.
 */
function _isBorderWaterCell(grid, r, c, gh, gw) {
  // A water cell is a border only if it is adjacent to a non-water (land/sand)
  // cell.  Map edges are NOT treated as borders — outer-ocean cells far from
  // shore must not show the beach animation.
  if (r > 0      && grid[r - 1][c] !== 2) return true;
  if (r < gh - 1 && grid[r + 1][c] !== 2) return true;
  if (c > 0      && grid[r][c - 1] !== 2) return true;
  if (c < gw - 1 && grid[r][c + 1] !== 2) return true;
  return false;
}

/**
 * Overlay animado de água sobreposto ao PNG base (mapUrl).
 *
 * - Células de BORDA (water_border_cells do JSON, ou calculadas on-the-fly):
 *   animadas em loop usando os frames da ocean-autotiles-anim.png.
 *   A fase de cada célula é deslocada deterministicamente para eliminar o efeito
 *   de "todos piscando juntos".
 *
 * - Células INTERIORES (água cercada de água em todos os lados):
 *   shimmer suave com duas ondas de fase independente (calm water).
 *
 * Não faz nada se não houver terrain_grid disponível (mapDataState.data null).
 */
function drawWaterCells(ctx, ox, oy, gs, tile) {
  const md = mapDataState.data;
  if (!md || !Array.isArray(md.terrain_grid)) return;

  const grid = md.terrain_grid;
  const gh = grid.length;
  const gw = gh > 0 ? grid[0].length : 0;
  if (!gh || !gw) return;

  const t   = Date.now() / 1000;

  // ── Wave timing constants ───────────────────────────────────────────────
  // WAVE_PERIOD: seconds for one complete crash-and-recede cycle.
  // The cycle uses sin²: ~55% of the time the wave is fully receded (frame 0),
  // ~30% transitioning (frame 2), and only ~15% at peak crash (frame 1).
  const WAVE_PERIOD = 3.2;

  const borderMap = mapDataState.borderMap;  // Map<"r,c", land_mask> or null
  const hasPrebuilt = borderMap !== null;

  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, gs * tile, gs * tile);
  ctx.clip();

  for (let r = 0; r < Math.min(gh, gs); r++) {
    for (let c = 0; c < Math.min(gw, gs); c++) {
      if (grid[r][c] !== 2) continue;

      const cx = ox + c * tile;
      const cy = oy + r * tile;

      let isBorder = false;
      let mask = 0;
      if (hasPrebuilt) {
        const key = `${r},${c}`;
        if (borderMap.has(key)) {
          isBorder = true;
          mask = borderMap.get(key) || 0;
        }
      } else {
        // Fallback: compute mask on-the-fly (N=1,E=2,S=4,W=8)
        if (r > 0      && grid[r - 1][c] !== 2) { mask |= 1; isBorder = true; }
        if (c < gw - 1 && grid[r][c + 1] !== 2) { mask |= 2; isBorder = true; }
        if (r < gh - 1 && grid[r + 1][c] !== 2) { mask |= 4; isBorder = true; }
        if (c > 0      && grid[r][c - 1] !== 2) { mask |= 8; isBorder = true; }
      }

      // Stagger with smaller coefficients so neighbouring cells share a
      // nearly-identical phase → wave appears to travel smoothly rather
      // than each tile flickering independently.
      // At 0.15/0.20 step, cells adjacent in the same row differ by only
      // 0.20 s (≈6 % of the 3.2 s cycle), creating a clear rolling front.
      const stagger  = ((r * 0.15 + c * 0.20) % WAVE_PERIOD + WAVE_PERIOD) % WAVE_PERIOD;
      const rawT     = ((t + stagger) % WAVE_PERIOD) / WAVE_PERIOD; // 0→1
      const sinVal   = Math.sin(rawT * Math.PI * 2);
      const wavePeak = sinVal > 0 ? sinVal * sinVal : 0;

      if (isBorder) {
        // ── BORDA: animação removida — drawShoreOverlay cuida do lado areia ──
        // Cells de água na borda apenas deixam o background (beach.png) aparecer.
        continue;

      } else {
        // ── INTERIOR: shimmer suave (calm water) ─────────────────────────
        const w1 = Math.sin(t * 1.6 + c * 0.85 + r * 0.55 + stagger * 0.5) * 0.5 + 0.5;
        const w2 = Math.sin(t * 2.3 + c * 1.25 - r * 0.75 + 1.7 + stagger * 0.35) * 0.5 + 0.5;
        const shimmer = w1 * 0.55 + w2 * 0.45;

        ctx.fillStyle = `rgba(70,170,240,${0.06 + shimmer * 0.11})`;
        ctx.fillRect(cx, cy, tile, tile);

        // Linha ondulada de reflexo
        const lineY = cy + tile * (0.38 + w1 * 0.11);
        const alpha = 0.10 + shimmer * 0.17;
        ctx.strokeStyle = `rgba(200,240,255,${alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx + 4, lineY);
        ctx.lineTo(cx + tile - 4, lineY + (w2 - 0.5) * tile * 0.06);
        ctx.stroke();

        // Segunda linha mais tenue para profundidade
        const lineY2 = cy + tile * (0.64 + w2 * 0.09);
        ctx.strokeStyle = `rgba(180,230,255,${alpha * 0.50})`;
        ctx.beginPath();
        ctx.moveTo(cx + 6, lineY2);
        ctx.lineTo(cx + tile - 6, lineY2 - (w1 - 0.5) * tile * 0.05);
        ctx.stroke();
      }
    }
  }

  ctx.restore();
}

function drawProceduralMap(ctx, ox, oy, gs, tile) {
  const theme = mapCache.theme;
  const tiles = mapCache.tiles;
  const patch = mapCache.patch;

  // theme palette (base RGB)
  let base = { r: 80, g: 160, b: 80 };
  if (theme.includes('grass')) base = { r: 100, g: 175, b: 90 };
  if (theme.includes('desert')) base = { r: 180, g: 160, b: 95 };
  if (theme.includes('snow')) base = { r: 200, g: 220, b: 230 };
  if (theme.includes('cave')) base = { r: 70, g: 80, b: 95 };

  for (let r = 0; r < gs; r++) {
    for (let c = 0; c < gs; c++) {
      const i = r * gs + c;
      const n = tiles ? tiles[i] : 0;
      let rr = base.r + n * 30;
      let gg = base.g + n * 30;
      let bb = base.b + n * 30;

      // dirt patch
      if (patch && r >= patch.r && r < patch.r + patch.h && c >= patch.c && c < patch.c + patch.w) {
        rr = 130 + n * 18;
        gg = 115 + n * 18;
        bb = 85 + n * 18;
      }

      ctx.fillStyle = `rgb(${rr|0},${gg|0},${bb|0})`;
      ctx.fillRect(ox + c * tile, oy + r * tile, tile, tile);

      // subtle overlay
      ctx.fillStyle = ((r + c) % 2 === 0) ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
      ctx.fillRect(ox + c * tile, oy + r * tile, tile, tile);
    }
  }

  // decorations
  for (const d of mapCache.deco || []) {
    const x = ox + d.col * tile;
    const y = oy + d.row * tile;
    const cx = x + tile * 0.5;
    const cy = y + tile * 0.52;

    if (d.type === 'tree') {
      // canopy
      ctx.fillStyle = 'rgba(16,90,45,0.85)';
      ctx.beginPath();
      ctx.arc(cx, cy - tile * 0.10, tile * 0.26, 0, Math.PI * 2);
      ctx.fill();
      // trunk
      ctx.fillStyle = 'rgba(92,54,30,0.9)';
      ctx.fillRect(cx - tile * 0.06, cy + tile * 0.06, tile * 0.12, tile * 0.20);
    } else if (d.type === 'bush') {
      ctx.fillStyle = 'rgba(20,120,60,0.75)';
      ctx.beginPath();
      ctx.arc(cx - tile * 0.10, cy, tile * 0.16, 0, Math.PI * 2);
      ctx.arc(cx + tile * 0.05, cy - tile * 0.02, tile * 0.18, 0, Math.PI * 2);
      ctx.arc(cx + tile * 0.18, cy + tile * 0.02, tile * 0.14, 0, Math.PI * 2);
      ctx.fill();
    } else if (d.type === 'rock') {
      ctx.fillStyle = 'rgba(148,163,184,0.55)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, tile * 0.22, tile * 0.14, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(30,41,59,0.25)';
      ctx.stroke();
    } else if (d.type === 'crystal') {
      ctx.fillStyle = 'rgba(125,211,252,0.55)';
      ctx.beginPath();
      ctx.moveTo(cx, cy - tile * 0.22);
      ctx.lineTo(cx + tile * 0.12, cy);
      ctx.lineTo(cx, cy + tile * 0.22);
      ctx.lineTo(cx - tile * 0.12, cy);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(14,116,144,0.35)';
      ctx.stroke();
    }
  }
}

// =============================================================================
// BATTLE EFFECTS — weather_effects.js
// Adicione este bloco ao main.js, logo ANTES da função draw()
// =============================================================================

// -------------------------
// Partículas de clima (estado persistente entre frames)
// -------------------------
const weatherParticles = {
  rain:   [],  // gotas de chuva
  snow:   [],  // flocos de neve
  sand:   [],  // grãos de areia
  sun:    [],  // raios de sol / partículas de calor
  hail:   [],  // pedras de granizo (tempestade de neve)
};

// Inicializa partículas de chuva
function initRainParticles(count = 120) {
  weatherParticles.rain = [];
  for (let i = 0; i < count; i++) {
    weatherParticles.rain.push({
      x: Math.random() * 1600,
      y: Math.random() * 1200,
      speed: 6 + Math.random() * 6,
      len: 10 + Math.random() * 8,
      alpha: 0.3 + Math.random() * 0.4,
    });
  }
}

// Inicializa flocos de neve / granizo
function initSnowParticles(count = 80, isHail = false) {
  const arr = isHail ? weatherParticles.hail : weatherParticles.snow;
  arr.length = 0;
  for (let i = 0; i < count; i++) {
    arr.push({
      x: Math.random() * 1600,
      y: Math.random() * 1200,
      r: isHail ? (2 + Math.random() * 3) : (2 + Math.random() * 4),
      speed: isHail ? (4 + Math.random() * 4) : (0.8 + Math.random() * 1.5),
      phase: Math.random() * Math.PI * 2,
      alpha: 0.5 + Math.random() * 0.5,
    });
  }
}

// Inicializa partículas de areia
function initSandParticles(count = 90) {
  weatherParticles.sand = [];
  for (let i = 0; i < count; i++) {
    weatherParticles.sand.push({
      x: Math.random() * 1600,
      y: Math.random() * 1200,
      speed: 5 + Math.random() * 8,
      len: 6 + Math.random() * 12,
      alpha: 0.15 + Math.random() * 0.25,
      r: 190 + Math.random() * 40 | 0,
      g: 150 + Math.random() * 30 | 0,
    });
  }
}

// Garante que as partículas existam para o clima ativo
function ensureWeatherParticles(weather) {
  if (weather === 'rain'  && weatherParticles.rain.length  === 0) initRainParticles();
  if (weather === 'snow'  && weatherParticles.snow.length  === 0) initSnowParticles(80, false);
  if (weather === 'hail'  && weatherParticles.hail.length  === 0) initSnowParticles(60, true);
  if (weather === 'sand'  && weatherParticles.sand.length  === 0) initSandParticles();
}

// =============================================================================
// FUNÇÃO PRINCIPAL: drawWeatherOverlay
// Chame dentro de draw(), DEPOIS do mapa e ANTES das peças
// Parâmetros: ctx, ox, oy, gs (grid size), tile (tile size em px), w, h (canvas)
// =============================================================================
function drawWeatherOverlay(ctx, ox, oy, gs, tile, w, h, sourceState = null) {
  const battleState = sourceState && typeof sourceState === "object"
    ? sourceState
    : appState.battle;
  // Lê o clima e terreno do Firestore (public_state/battle) ou de um override explícito.
  const weather = safeStr(battleState?.weather  || appState.board?.weather  || '').toLowerCase();
  const terrain = safeStr(battleState?.terrain  || appState.board?.terrain  || '').toLowerCase();

  const t = Date.now() / 1000; // segundos
  const gridW = gs * tile;
  const gridH = gs * tile;

  // Salva o estado do canvas para restaurar depois
  ctx.save();
  // Recorta os efeitos dentro do grid
  ctx.beginPath();
  ctx.rect(ox, oy, gridW, gridH);
  ctx.clip();

  // -------------------------------------------------------------------
  // ☀️  DIA ENSOLARADO (sun / harsh_sun / sunny)
  // -------------------------------------------------------------------
  if (weather === 'sun' || weather === 'sunny' || weather === 'harsh_sun' || weather === 'harshsun') {
    // Overlay amarelo pulsante
    const pulse = 0.07 + Math.abs(Math.sin(t * 0.9)) * 0.06;
    ctx.fillStyle = `rgba(255,220,60,${pulse})`;
    ctx.fillRect(ox, oy, gridW, gridH);

    // Raios de luz saindo do canto superior direito
    const cx = ox + gridW * 1.1;
    const cy = oy - gridH * 0.15;
    const rayCount = 9;
    for (let i = 0; i < rayCount; i++) {
      const angle = Math.PI * 0.55 + (i / (rayCount - 1)) * Math.PI * 0.45;
      const len = Math.min(gridW, gridH) * (0.7 + Math.sin(t * 0.7 + i) * 0.15);
      const alpha = 0.04 + Math.abs(Math.sin(t * 0.5 + i * 0.7)) * 0.04;
      ctx.strokeStyle = `rgba(255,240,100,${alpha})`;
      ctx.lineWidth = tile * 0.6;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
      ctx.stroke();
    }

    // Brilho de calor (shimmer) — linhas horizontais onduladas
    ctx.strokeStyle = 'rgba(255,200,50,0.07)';
    ctx.lineWidth = 1;
    for (let row = 0; row < gs; row++) {
      const y = oy + row * tile + tile * 0.5;
      const shimmer = Math.sin(t * 2 + row * 0.7) * tile * 0.08;
      ctx.beginPath();
      ctx.moveTo(ox, y + shimmer);
      ctx.lineTo(ox + gridW, y - shimmer);
      ctx.stroke();
    }
  }

  // -------------------------------------------------------------------
  // 🌧️  CHUVA (rain / heavy_rain)
  // -------------------------------------------------------------------
  else if (weather === 'rain' || weather === 'heavy_rain' || weather === 'heavyrain') {
    ensureWeatherParticles('rain');
    const heavy = weather !== 'rain';

    // Overlay azul levemente escurecido
    ctx.fillStyle = heavy ? 'rgba(30,60,120,0.12)' : 'rgba(30,60,100,0.07)';
    ctx.fillRect(ox, oy, gridW, gridH);

    // Desenha e move as gotas
    ctx.lineCap = 'round';
    for (const d of weatherParticles.rain) {
      ctx.strokeStyle = `rgba(147,210,255,${d.alpha})`;
      ctx.lineWidth = heavy ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(ox + d.x,              oy + d.y);
      ctx.lineTo(ox + d.x - d.len * 0.3, oy + d.y + d.len);
      ctx.stroke();

      // Avança a gota
      d.x -= d.speed * 0.3;
      d.y += d.speed;

      // Reseta quando sai do grid
      if (d.y > gridH + d.len || d.x < -d.len) {
        d.x = Math.random() * gridW + d.len;
        d.y = -d.len;
      }
    }
  }

  // -------------------------------------------------------------------
  // ❄️  TEMPESTADE DE NEVE (snow / blizzard)
  // -------------------------------------------------------------------
  else if (weather === 'snow' || weather === 'blizzard') {
    ensureWeatherParticles('snow');

    // Overlay azul-gelo
    ctx.fillStyle = 'rgba(200,230,255,0.08)';
    ctx.fillRect(ox, oy, gridW, gridH);

    for (const f of weatherParticles.snow) {
      ctx.beginPath();
      ctx.arc(ox + f.x, oy + f.y, f.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(220,240,255,${f.alpha})`;
      ctx.fill();

      // Flocos caem com oscilação suave
      f.y += f.speed;
      f.x += Math.sin(t * 0.8 + f.phase) * 0.6;

      if (f.y > gridH + f.r * 2) {
        f.y = -f.r * 2;
        f.x = Math.random() * gridW;
      }
      if (f.x < 0) f.x += gridW;
      if (f.x > gridW) f.x -= gridW;
    }

    // Névoa branca no fundo para dar sensação de blizzard
    if (weather === 'blizzard') {
      const fogAlpha = 0.06 + Math.abs(Math.sin(t * 0.4)) * 0.05;
      ctx.fillStyle = `rgba(220,235,255,${fogAlpha})`;
      ctx.fillRect(ox, oy, gridW, gridH);
    }
  }

  // -------------------------------------------------------------------
  // 🌪️  TEMPESTADE DE AREIA (sandstorm / sand)
  // -------------------------------------------------------------------
  else if (weather === 'sand' || weather === 'sandstorm') {
    ensureWeatherParticles('sand');

    // Overlay bege-laranja
    const sandBase = 0.06 + Math.abs(Math.sin(t * 0.6)) * 0.04;
    ctx.fillStyle = `rgba(180,130,60,${sandBase})`;
    ctx.fillRect(ox, oy, gridW, gridH);

    ctx.lineCap = 'round';
    for (const s of weatherParticles.sand) {
      ctx.strokeStyle = `rgba(${s.r},${s.g},80,${s.alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ox + s.x,          oy + s.y);
      ctx.lineTo(ox + s.x + s.len,  oy + s.y + s.len * 0.15);
      ctx.stroke();

      s.x += s.speed;
      s.y += (Math.random() - 0.5) * 1.5;

      if (s.x > gridW + s.len) {
        s.x = -s.len;
        s.y = Math.random() * gridH;
      }
    }
  }

  // -------------------------------------------------------------------
  // 🌨️  GRANIZO (hail — Tempestade de Neve com granizo)
  // -------------------------------------------------------------------
  else if (weather === 'hail') {
    ensureWeatherParticles('hail');

    ctx.fillStyle = 'rgba(180,210,240,0.08)';
    ctx.fillRect(ox, oy, gridW, gridH);

    for (const f of weatherParticles.hail) {
      // Granizo: hexágono simples
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * Math.PI * 2 - Math.PI / 6;
        const px = ox + f.x + Math.cos(ang) * f.r;
        const py = oy + f.y + Math.sin(ang) * f.r;
        k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(200,225,255,${f.alpha})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(150,200,255,${f.alpha * 0.5})`;
      ctx.lineWidth = 0.5;
      ctx.stroke();

      f.y += f.speed;
      f.x += Math.sin(t + f.phase) * 0.3;

      if (f.y > gridH + f.r * 2) {
        f.y = -f.r * 2;
        f.x = Math.random() * gridW;
      }
    }
  }

  // -------------------------------------------------------------------
  // ⚡  TERRENO ELÉTRICO (electric_terrain)
  // -------------------------------------------------------------------
  if (terrain === 'electric' || terrain === 'electric_terrain') {
    // Overlay amarelo-elétrico pulsante
    const pulse = 0.08 + Math.abs(Math.sin(t * 2.5)) * 0.06;
    ctx.fillStyle = `rgba(250,230,0,${pulse})`;
    ctx.fillRect(ox, oy, gridW, gridH);

    // Borda elétrica ao redor do grid
    const borderGlow = 1 + Math.abs(Math.sin(t * 3));
    ctx.strokeStyle = `rgba(255,240,0,${0.5 + Math.sin(t * 4) * 0.3})`;
    ctx.lineWidth = borderGlow * 2;
    ctx.strokeRect(ox + 1, oy + 1, gridW - 2, gridH - 2);

    // Mini-raios aleatórios (flickering)
    // Usamos t como seed discreta para variar os raios a cada ~0.3s
    const seed = Math.floor(t * 3);
    const pseudo = (n) => ((Math.sin(n * 127.1 + seed * 311.7) * 43758.5453) % 1 + 1) % 1;
    const boltCount = 4;
    for (let b = 0; b < boltCount; b++) {
      const bx = ox + pseudo(b * 7 + 1) * gridW;
      const by = oy + pseudo(b * 7 + 2) * gridH;
      const blen = tile * (0.4 + pseudo(b * 7 + 3) * 0.6);
      const bang = pseudo(b * 7 + 4) * Math.PI * 2;
      const alpha = 0.4 + pseudo(b * 7 + 5) * 0.5;

      ctx.strokeStyle = `rgba(255,255,100,${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      // zigue-zague de 3 segmentos
      const mid1x = bx + Math.cos(bang + 0.5) * blen * 0.4;
      const mid1y = by + Math.sin(bang + 0.5) * blen * 0.4;
      const mid2x = bx + Math.cos(bang - 0.4) * blen * 0.7;
      const mid2y = by + Math.sin(bang - 0.4) * blen * 0.7;
      const endx  = bx + Math.cos(bang) * blen;
      const endy  = by + Math.sin(bang) * blen;
      ctx.lineTo(mid1x, mid1y);
      ctx.lineTo(mid2x, mid2y);
      ctx.lineTo(endx, endy);
      ctx.stroke();
    }
  }

  // -------------------------------------------------------------------
  // 🌸  TERRENO DAS FADAS (fairy_terrain / misty_terrain)
  // -------------------------------------------------------------------
  if (terrain === 'fairy' || terrain === 'fairy_terrain' || terrain === 'misty' || terrain === 'misty_terrain') {
    // Overlay rosado suave
    const pulse = 0.06 + Math.abs(Math.sin(t * 1.2)) * 0.04;
    ctx.fillStyle = `rgba(255,180,220,${pulse})`;
    ctx.fillRect(ox, oy, gridW, gridH);

    // Borda rosa brilhante
    ctx.strokeStyle = `rgba(255,130,200,${0.4 + Math.sin(t * 2) * 0.2})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + 1, oy + 1, gridW - 2, gridH - 2);

    // Partículas de brilho subindo (sparkles)
    // Posições geradas por seed baseada no tempo — evita alocar array
    const sparkCount = 20;
    for (let s = 0; s < sparkCount; s++) {
      // Progresso cíclico de cada sparkle (0..1)
      const cycleLen = 2.5 + (s % 5) * 0.4;
      const prog = ((t / cycleLen) + s / sparkCount) % 1;
      const sx = ox + (((s * 173.17) % gridW + gridW) % gridW);
      const sy = oy + gridH * (1 - prog);
      const sr = 1.5 + Math.sin(prog * Math.PI) * 2;
      const alpha = Math.sin(prog * Math.PI) * 0.8;

      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,200,240,${alpha})`;
      ctx.fill();

      // Cruz brilhante pequena
      if (sr > 2.5) {
        ctx.strokeStyle = `rgba(255,240,255,${alpha * 0.7})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(sx - sr * 1.5, sy);
        ctx.lineTo(sx + sr * 1.5, sy);
        ctx.moveTo(sx, sy - sr * 1.5);
        ctx.lineTo(sx, sy + sr * 1.5);
        ctx.stroke();
      }
    }
  }

  // -------------------------------------------------------------------
  // 🔮  TERRENO PSÍQUICO (psychic_terrain)
  // -------------------------------------------------------------------
  if (terrain === 'psychic' || terrain === 'psychic_terrain') {
    // Overlay roxo suave
    const pulse = 0.07 + Math.abs(Math.sin(t * 1.5)) * 0.05;
    ctx.fillStyle = `rgba(180,100,255,${pulse})`;
    ctx.fillRect(ox, oy, gridW, gridH);

    // Borda roxo vibrante
    ctx.strokeStyle = `rgba(200,120,255,${0.5 + Math.sin(t * 2.5) * 0.3})`;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(ox + 1, oy + 1, gridW - 2, gridH - 2);

    // Ondas concêntricas expandindo do centro
    const centerX = ox + gridW / 2;
    const centerY = oy + gridH / 2;
    const maxR = Math.max(gridW, gridH) * 0.75;
    const waveCount = 3;
    for (let w = 0; w < waveCount; w++) {
      const phase = (t * 0.5 + w / waveCount) % 1;
      const r = phase * maxR;
      const alpha = (1 - phase) * 0.25;
      ctx.beginPath();
      ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(210,150,255,${alpha})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // -------------------------------------------------------------------
  // 🌿  TERRENO DE GRAMA (grassy_terrain)
  // -------------------------------------------------------------------
  if (terrain === 'grass' || terrain === 'grassy' || terrain === 'grassy_terrain') {
    // Overlay verde suave
    const pulse = 0.06 + Math.abs(Math.sin(t * 1.0)) * 0.04;
    ctx.fillStyle = `rgba(80,200,100,${pulse})`;
    ctx.fillRect(ox, oy, gridW, gridH);

    // Borda verde brilhante
    ctx.strokeStyle = `rgba(60,180,80,${0.45 + Math.sin(t * 1.8) * 0.2})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + 1, oy + 1, gridW - 2, gridH - 2);

    // Partículas de folhas / pontos subindo
    const leafCount = 18;
    for (let l = 0; l < leafCount; l++) {
      const cycleLen = 3.0 + (l % 6) * 0.5;
      const prog = ((t / cycleLen) + l / leafCount) % 1;
      const lx = ox + (((l * 211.31) % gridW + gridW) % gridW);
      const ly = oy + gridH * (1 - prog);
      const lr = 1.5 + Math.sin(prog * Math.PI) * 2.5;
      const alpha = Math.sin(prog * Math.PI) * 0.7;
      const sway = Math.sin(t * 1.2 + l * 0.8) * tile * 0.1;

      // Folha: elipse pequena inclinada
      ctx.save();
      ctx.translate(lx + sway, ly);
      ctx.rotate(Math.sin(t * 0.8 + l) * 0.4);
      ctx.beginPath();
      ctx.ellipse(0, 0, lr * 0.7, lr * 1.4, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(50,200,80,${alpha})`;
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.restore();
}

// =============================================================================
// FUNÇÃO: drawCellEffects
// Desenha efeitos por CÉLULA (Stealth Rock, Spikes, Toxic Spikes, etc.)
// Substitui os PNGs por shapes desenhados no canvas
// Chame DEPOIS do drawWeatherOverlay e ANTES das peças
// =============================================================================
window.drawWeatherOverlay = drawWeatherOverlay;
function drawCellEffects(ctx, ox, oy, tile, _override) {
  const effects = Array.isArray(_override) ? _override : appState.board?.effects;
  if (!Array.isArray(effects) || effects.length === 0) return;

  const t = Date.now() / 1000;

  for (const eff of effects) {
    const row = Number(eff?.row);
    const col = Number(eff?.col);
    if (!Number.isFinite(row) || !Number.isFinite(col)) continue;

    const x = ox + col * tile;
    const y = oy + row * tile;
    const cx = x + tile * 0.5;
    const cy = y + tile * 0.5;
    const icon = safeStr(eff?.icon || '');

    ctx.save();

    // ---------------------------------------------------------------
    // Efeitos de TERRENO / CLIMA (usam ícone emoji do app.py antigo)
    // Esses agora são campo todo → só mostra indicador pequeno na célula
    // se quiser manter retrocompatibilidade com efeitos antigos por célula
    // ---------------------------------------------------------------

    // 🪨 Stealth Rock
    if (icon === '🪨' || icon.toLowerCase().includes('rock')) {
      _drawStealthRock(ctx, x, y, cx, cy, tile, t);
    }
    // ⬇️ Spikes (normal)
    else if (icon === '🔺' || icon.toLowerCase() === 'spikes' || icon === '△') {
      _drawSpikes(ctx, x, y, cx, cy, tile, 3, '#c8a96e', '#8a6a3c');
    }
    // ☠️ Toxic Spikes
    else if (icon === '☠️' || icon.toLowerCase().includes('toxic') || icon === '💜') {
      _drawSpikes(ctx, x, y, cx, cy, tile, 3, '#c084fc', '#7e22ce');
    }
    // 🕸️ Sticky Web
    else if (icon === '🕸️' || icon.toLowerCase().includes('web')) {
      _drawStickyWeb(ctx, cx, cy, tile, t);
    }
    // 🔥 Fogo / Fire Spin
    else if (icon === '🔥') {
      _drawFireCell(ctx, cx, cy, tile, t);
    }
    // 🧊 Gelo
    else if (icon === '🧊') {
      _drawIceCell(ctx, x, y, cx, cy, tile);
    }
    // 💧 Água
    else if (icon === '💧') {
      _drawWaterCell(ctx, cx, cy, tile, t);
    }
    // ☁️ Nuvem (ex: Haze local ou efeito legado)
    else if (icon === '☁️') {
      _drawCloudCell(ctx, cx, cy, tile, t);
    }
    // ⚡ Raio (terreno elétrico por célula — legado)
    else if (icon === '⚡') {
      _drawElectricCell(ctx, cx, cy, tile, t);
    }
    // ☀️ Sol (terreno sol por célula — legado)
    else if (icon === '☀️') {
      _drawSunCell(ctx, cx, cy, tile, t);
    }
    // 🍃 Grama (terreno grama por célula — legado)
    else if (icon === '🍃') {
      _drawGrassCell(ctx, cx, cy, tile, t);
    }
    // Fallback: exibe o emoji diretamente no canvas
    else if (icon) {
      ctx.font = `${Math.max(10, tile * 0.38)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.85;
      ctx.fillText(icon, cx, cy);
    }

    ctx.restore();
  }
}

// ---------------------------------------------------------------
// Helpers de shapes por célula
// ---------------------------------------------------------------

// 🪨 Stealth Rock — fragmentos de rocha flutuando no canto
function _drawStealthRock(ctx, x, y, cx, cy, tile, t) {
  const positions = [
    { dx: -0.28, dy: -0.28, r: 0.10, rot: 0.3 },
    { dx:  0.25, dy: -0.22, r: 0.08, rot: -0.6 },
    { dx: -0.18, dy:  0.25, r: 0.09, rot: 1.0 },
    { dx:  0.28, dy:  0.22, r: 0.07, rot: 0.5 },
  ];
  for (const p of positions) {
    const px = cx + p.dx * tile + Math.sin(t * 0.8 + p.rot * 5) * tile * 0.02;
    const py = cy + p.dy * tile + Math.cos(t * 0.7 + p.rot * 3) * tile * 0.02;
    const pr = p.r * tile;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(p.rot + t * 0.2);

    // Sombra
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(pr * 0.2, pr * 0.2, pr, pr * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Rocha principal (polígono irregular)
    ctx.fillStyle = '#7c6550';
    ctx.beginPath();
    ctx.moveTo(-pr, 0);
    ctx.lineTo(-pr * 0.3, -pr * 0.9);
    ctx.lineTo(pr * 0.6, -pr * 0.7);
    ctx.lineTo(pr, 0);
    ctx.lineTo(pr * 0.5, pr * 0.8);
    ctx.lineTo(-pr * 0.5, pr * 0.6);
    ctx.closePath();
    ctx.fill();

    // Highlight
    ctx.fillStyle = 'rgba(200,170,130,0.4)';
    ctx.beginPath();
    ctx.moveTo(-pr * 0.3, -pr * 0.7);
    ctx.lineTo(pr * 0.3, -pr * 0.5);
    ctx.lineTo(-pr * 0.1, 0);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  // Label pequeno no canto
  ctx.fillStyle = 'rgba(200,180,140,0.7)';
  ctx.font = `bold ${Math.max(7, tile * 0.12)}px system-ui`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('SR', x + tile * 0.05, y + tile * 0.04);
}

// 🔺 Spikes / Toxic Spikes — triângulos apontados para cima
function _drawSpikes(ctx, x, y, cx, cy, tile, count, colorFill, colorStroke) {
  const spacing = tile / (count + 1);
  const h = tile * 0.30;
  const base = tile * 0.18;

  for (let i = 0; i < count; i++) {
    const sx = x + spacing * (i + 1);
    const sy = cy + tile * 0.15;

    // Sombra
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + h * 0.15, base * 0.5, base * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();

    // Triângulo principal
    ctx.fillStyle = colorFill;
    ctx.strokeStyle = colorStroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, sy - h);
    ctx.lineTo(sx + base, sy);
    ctx.lineTo(sx - base, sy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Brilho no triângulo
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.moveTo(sx, sy - h);
    ctx.lineTo(sx + base * 0.4, sy - h * 0.4);
    ctx.lineTo(sx, sy - h * 0.5);
    ctx.closePath();
    ctx.fill();
  }
}

// 🕸️ Sticky Web — teia de aranha
function _drawStickyWeb(ctx, cx, cy, tile, t) {
  const r = tile * 0.38;
  const rings = 3;
  const spokes = 8;

  ctx.strokeStyle = 'rgba(200,200,200,0.55)';
  ctx.lineWidth = 0.8;

  // Raios (spokes)
  for (let s = 0; s < spokes; s++) {
    const ang = (s / spokes) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
    ctx.stroke();
  }

  // Anéis concêntricos
  for (let ring = 1; ring <= rings; ring++) {
    const rr = r * (ring / rings);
    ctx.beginPath();
    for (let s = 0; s <= spokes; s++) {
      const ang = (s / spokes) * Math.PI * 2;
      const px = cx + Math.cos(ang) * rr;
      const py = cy + Math.sin(ang) * rr;
      s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Brilho central
  const pulse = 0.3 + Math.abs(Math.sin(t * 1.5)) * 0.2;
  ctx.beginPath();
  ctx.arc(cx, cy, tile * 0.05, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(220,220,220,${pulse})`;
  ctx.fill();
}

// 🔥 Fogo
function _drawFireCell(ctx, cx, cy, tile, t) {
  const flicker = Math.sin(t * 8) * tile * 0.02;
  ctx.fillStyle = 'rgba(255,80,0,0.25)';
  ctx.beginPath();
  ctx.arc(cx, cy, tile * 0.32, 0, Math.PI * 2);
  ctx.fill();

  // Chamas
  const flames = [
    { dx: 0,     h: 0.30, w: 0.12, color: 'rgba(255,200,0,0.8)'  },
    { dx: -0.12, h: 0.22, w: 0.09, color: 'rgba(255,120,0,0.7)'  },
    { dx:  0.12, h: 0.20, w: 0.09, color: 'rgba(255,60,0,0.7)'   },
  ];
  for (const f of flames) {
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.moveTo(cx + f.dx * tile, cy + tile * 0.15);
    ctx.quadraticCurveTo(
      cx + (f.dx + 0.08) * tile,
      cy - (f.h * 0.5 + flicker * 0.5) * tile,
      cx + f.dx * tile,
      cy - (f.h + flicker) * tile
    );
    ctx.quadraticCurveTo(
      cx + (f.dx - 0.08) * tile,
      cy - (f.h * 0.5) * tile,
      cx + f.dx * tile,
      cy + tile * 0.15
    );
    ctx.fill();
  }
}

// 🧊 Gelo
function _drawIceCell(ctx, x, y, cx, cy, tile) {
  // Cristais de gelo nos cantos
  ctx.fillStyle = 'rgba(180,230,255,0.35)';
  ctx.fillRect(x + 1, y + 1, tile - 2, tile - 2);

  ctx.strokeStyle = 'rgba(150,210,255,0.6)';
  ctx.lineWidth = 1;

  // Cruz central (cristal)
  const arms = 4;
  const r = tile * 0.35;
  for (let a = 0; a < arms; a++) {
    const ang = (a / arms) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(ang) * r, cy - Math.sin(ang) * r);
    ctx.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
    ctx.stroke();

    // Ramificações
    const bLen = r * 0.35;
    for (const side of [-1, 1]) {
      const bAng = ang + side * Math.PI / 4;
      for (const frac of [0.4, 0.65]) {
        const bx = cx + Math.cos(ang) * r * frac;
        const by = cy + Math.sin(ang) * r * frac;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(bAng) * bLen, by + Math.sin(bAng) * bLen);
        ctx.stroke();
      }
    }
  }
}

// 💧 Água (onda)
function _drawWaterCell(ctx, cx, cy, tile, t) {
  ctx.fillStyle = 'rgba(60,130,200,0.20)';
  ctx.beginPath();
  ctx.arc(cx, cy, tile * 0.38, 0, Math.PI * 2);
  ctx.fill();

  // Onda animada
  ctx.strokeStyle = 'rgba(100,180,255,0.7)';
  ctx.lineWidth = 1.5;
  const waveW = tile * 0.6;
  const amp = tile * 0.06;
  const waveY = cy + Math.sin(t * 2) * tile * 0.04;
  ctx.beginPath();
  for (let i = 0; i <= 20; i++) {
    const wx = cx - waveW / 2 + (i / 20) * waveW;
    const wy = waveY + Math.sin((i / 20) * Math.PI * 2 + t * 3) * amp;
    i === 0 ? ctx.moveTo(wx, wy) : ctx.lineTo(wx, wy);
  }
  ctx.stroke();
}

// ☁️ Nuvem
function _drawCloudCell(ctx, cx, cy, tile, t) {
  const drift = Math.sin(t * 0.8) * tile * 0.04;
  ctx.fillStyle = 'rgba(200,215,230,0.55)';

  const puffs = [
    { dx: 0,     dy: 0.04, r: 0.20 },
    { dx: -0.15, dy: 0.10, r: 0.14 },
    { dx:  0.16, dy: 0.10, r: 0.13 },
    { dx:  0.06, dy: 0.14, r: 0.12 },
    { dx: -0.06, dy: 0.14, r: 0.11 },
  ];
  for (const p of puffs) {
    ctx.beginPath();
    ctx.arc(cx + p.dx * tile + drift, cy + p.dy * tile, p.r * tile, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ⚡ Elétrico (célula)
function _drawElectricCell(ctx, cx, cy, tile, t) {
  ctx.fillStyle = 'rgba(255,230,0,0.18)';
  ctx.fillRect(cx - tile / 2, cy - tile / 2, tile, tile);

  // Raio central
  ctx.strokeStyle = `rgba(255,240,80,${0.6 + Math.sin(t * 6) * 0.3})`;
  ctx.lineWidth = 2;
  const bh = tile * 0.38;
  ctx.beginPath();
  ctx.moveTo(cx + tile * 0.05, cy - bh);
  ctx.lineTo(cx - tile * 0.06, cy - bh * 0.1);
  ctx.lineTo(cx + tile * 0.04, cy - bh * 0.1);
  ctx.lineTo(cx - tile * 0.05, cy + bh);
  ctx.stroke();
}

// ☀️ Sol (célula)
function _drawSunCell(ctx, cx, cy, tile, t) {
  ctx.fillStyle = 'rgba(255,220,0,0.18)';
  ctx.fillRect(cx - tile / 2, cy - tile / 2, tile, tile);

  const r = tile * 0.16;
  const rayLen = tile * 0.10;
  const rayCount = 8;
  ctx.strokeStyle = `rgba(255,200,0,${0.5 + Math.sin(t * 2) * 0.2})`;
  ctx.lineWidth = 1.5;

  for (let i = 0; i < rayCount; i++) {
    const ang = (i / rayCount) * Math.PI * 2 + t * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
    ctx.lineTo(cx + Math.cos(ang) * (r + rayLen), cy + Math.sin(ang) * (r + rayLen));
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,220,50,${0.6 + Math.sin(t * 2) * 0.2})`;
  ctx.fill();
}

// 🍃 Grama (célula)
function _drawGrassCell(ctx, cx, cy, tile, t) {
  ctx.fillStyle = 'rgba(50,180,80,0.15)';
  ctx.fillRect(cx - tile / 2, cy - tile / 2, tile, tile);

  const bladeCount = 5;
  ctx.strokeStyle = 'rgba(60,190,90,0.75)';
  ctx.lineWidth = 1.5;
  for (let b = 0; b < bladeCount; b++) {
    const bx = cx - tile * 0.3 + b * tile * (0.6 / (bladeCount - 1));
    const sway = Math.sin(t * 1.5 + b * 0.9) * tile * 0.07;
    ctx.beginPath();
    ctx.moveTo(bx, cy + tile * 0.22);
    ctx.quadraticCurveTo(bx + sway, cy - tile * 0.02, bx + sway * 1.3, cy - tile * 0.22);
    ctx.stroke();
  }
}


// =============================================================================
// INTEGRAÇÃO: Adicione estas duas chamadas dentro da função draw()
// no main.js, logo APÓS as linhas do grid e ANTES do loop de pieces.
//
// Encontre o trecho:
//   // grid lines
//   ...
//   // pieces
//
// E insira:
//   // efeitos de clima (overlay animado sobre o mapa)
//   drawWeatherOverlay(ctx, ox, oy, gs, tile, w, h);
//   // efeitos por célula (Spikes, Stealth Rock, etc.)
//   drawCellEffects(ctx, ox, oy, tile);
//
// =============================================================================

// ── drawTraps: armadilhas por célula ────────────────────────────────────────
// Armadilhas com revealed:false → visíveis só ao owner (pontilhado + alfa baixo)
// Armadilhas com revealed:true  → desenhadas para todos via drawCellEffects inline
function drawTraps(ctx, ox, oy, tile) {
  const traps = appState.traps;
  if (!Array.isArray(traps) || traps.length === 0) return;
  const by = safeStr(appState.by);
  for (const trap of traps) {
    const row = Number(trap.row);
    const col = Number(trap.col);
    if (!Number.isFinite(row) || !Number.isFinite(col)) continue;
    const x  = ox + col * tile;
    const y  = oy + row * tile;
    const cx = x + tile * 0.5;
    const cy = y + tile * 0.5;

    if (trap.revealed) {
      // Armadilha revelada: renderiza para todos usando drawCellEffects inline
      drawCellEffects(ctx, ox, oy, tile, [{ row, col, icon: safeStr(trap.icon || "🪨") }]);
      continue;
    }

    // Armadilha oculta: só visível ao owner
    if (safeStr(trap.owner) !== by) continue;
    ctx.save();
    // Fundo levemente tingido + borda pontilhada
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = "rgba(251,146,60,0.15)";
    ctx.fillRect(x + 1, y + 1, tile - 2, tile - 2);
    ctx.strokeStyle = "rgba(251,146,60,0.7)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(x + 2, y + 2, tile - 4, tile - 4);
    ctx.setLineDash([]);
    // Ícone central
    ctx.globalAlpha = 0.7;
    ctx.font = `${Math.max(10, tile * 0.36)}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(safeStr(trap.icon || "🪨"), cx, cy);
    ctx.restore();
  }
}
// ────────────────────────────────────────────────────────────────────────────


function draw() {
  arenaFrameHandle = 0;
  if (arenaRenderMode !== "canvas") return;
  try {
  const rect = canvasWrap.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
// CORREÇÃO: Se a aba estiver escondida (largura 0), não tenta desenhar
  if (w <= 0 || h <= 0 || view.scale <= 0) {
    requestArenaCanvasFrame();
    return;
  }
  syncSpriteOverlayVisibility();
  _trimMegaEvolutionFx();
  // background
  ctx.clearRect(0, 0, w, h);
  // soft vignette
  const g = ctx.createRadialGradient(w * 0.2, h * 0.1, 40, w * 0.5, h * 0.5, Math.max(w, h));
  g.addColorStop(0, "rgba(56,189,248,0.06)");
  g.addColorStop(1, "rgba(2,6,23,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const gs = appState.gridSize || 10;
  const tile = view.scale;
  const ox = view.offX;
  const oy = view.offY;

  // board base
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(ox - 2, oy - 2, gs * tile + 4, gs * tile + 4);

  // ── Pass 1: ground layer (terrain PNG or procedural) — cached ────────────
  maybeRebuildMapCache();
  const bg = ensureMapBackgroundRecord();
  if (bg && bg.ready && !bg.failed) {
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.drawImage(bg.img, ox, oy, gs * tile, gs * tile);
    ctx.restore();
    ctx.fillStyle = "rgba(2,6,23,0.10)";
    ctx.fillRect(ox, oy, gs * tile, gs * tile);
  } else {
    const groundCacheCanvas = _ensureGroundCache(gs, tile);
    ctx.drawImage(groundCacheCanvas, ox, oy);
  }

  // ── Pass 2: overlayLow — animated water + shore foam ─────────────────────
  if (bg && bg.ready && !bg.failed) {
    // Animação de água sobre as células de terreno hídrico (terrain_grid == 2)
    drawWaterCells(ctx, ox, oy, gs, tile);
    // Espuma/bolhas no lado da água que toca a animação (lado água)
    drawWaterBorderFoam(ctx, ox, oy, gs, tile);
  }




  // placing mode highlight (tiles válidos, size-aware)
  const placingPid = getPlacingPokemonPid();
  if (placingPid) {
    const placingSize = getPieceSizeCategory({ pid: placingPid });
    const { tileW: pw, tileH: ph } = getSizeDimensions(placingSize);
    const fakePiece = { id: "__placing__", pid: placingPid, sizeCategory: placingSize };
    ctx.fillStyle = "rgba(163, 230, 53, 0.10)";
    for (let rr = 0; rr < gs; rr++) {
      for (let cc = 0; cc < gs; cc++) {
        if (!isFootprintWithinGrid(rr, cc, placingSize, gs)) continue;
        if (!canPieceLandOn(fakePiece, rr, cc, appState.pieces || []).allowed) continue;
        const xh = ox + cc * tile;
        const yh = oy + rr * tile;
        ctx.fillRect(xh + 1, yh + 1, tile * pw - 2, tile * ph - 2);
      }
    }
  }

  // hover highlight
  if (appState.hover.row != null) {
    const x = ox + appState.hover.col * tile;
    const y = oy + appState.hover.row * tile;
    ctx.fillStyle = "rgba(56,189,248,0.10)";
    ctx.fillRect(x, y, tile, tile);
    ctx.strokeStyle = "rgba(56,189,248,0.45)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, tile - 2, tile - 2);
  }

  updateMovementTurnState();
  const selPiece = (appState.pieces || []).find((p) => safeStr(p?.id) === safeStr(appState.selectedPieceId)) || null;
  if (!placingPid && selPiece && canCurrentPlayerMovePiece(selPiece.id)) {
    const reach = getReachableTileMap(selPiece);
    for (let r = 0; r < gs; r++) {
      for (let c = 0; c < gs; c++) {
        if (r === Number(selPiece.row) && c === Number(selPiece.col)) continue;
        const xh = ox + c * tile;
        const yh = oy + r * tile;
        const canReach = reach.has(`${r}:${c}`);
        if (canReach) {
          // Alcance possível: ciano/verde (mais claro e distinto do "bloqueado")
          ctx.fillStyle = "rgba(45, 212, 191, 0.24)";
          ctx.fillRect(xh + 1, yh + 1, tile - 2, tile - 2);

          ctx.strokeStyle = "rgba(20, 184, 166, 0.52)";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(xh + 2, yh + 2, tile - 4, tile - 4);
        } else {
          // Fora de alcance: cinza-azulado com hatch discreto (evita o vermelho "erro")
          ctx.fillStyle = "rgba(100, 116, 139, 0.16)";
          ctx.fillRect(xh + 1, yh + 1, tile - 2, tile - 2);

          ctx.strokeStyle = "rgba(148, 163, 184, 0.26)";
          ctx.lineWidth = 1;
          for (let i = -tile; i < tile; i += 8) {
            ctx.beginPath();
            ctx.moveTo(xh + i, yh + tile - 1);
            ctx.lineTo(xh + i + tile, yh + 1);
            ctx.stroke();
          }
        }
      }
    }
  }

  // grid lines
  if (view.showGrid) {
    ctx.strokeStyle = "rgba(148,163,184,0.22)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= gs; i++) {
      const x = ox + i * tile;
      const y = oy + i * tile;
      ctx.beginPath();
      ctx.moveTo(x, oy);
      ctx.lineTo(x, oy + gs * tile);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ox, y);
      ctx.lineTo(ox + gs * tile, y);
      ctx.stroke();
    }
  }

// efeitos de clima (overlay animado sobre o mapa inteiro)
drawWeatherOverlay(ctx, ox, oy, gs, tile, w, h);
// efeitos por célula (Spikes, Stealth Rock, Sticky Web, etc.)
drawCellEffects(ctx, ox, oy, tile);
// armadilhas ocultas: visíveis só para o owner (pontilhado); reveladas usam drawCellEffects via drawTraps
drawTraps(ctx, ox, oy, tile);


  // pieces — dynamic borders per owner
  const pieces = appState.pieces || [];
  const activePieces = pieces.filter((piece) => safeStr(piece?.status || "active") === "active");
  const visiblePieces = activePieces.filter((piece) => isPieceVisibleToMe(piece));
  const frameNow = window.performance?.now?.() ?? Date.now();
  updatePieceFieldFx(activePieces, frameNow);
  const nextPieceScreenBounds = new Map();
  const _by = safeStr(appState.by);

  // Build stable opponent color map
  const _oppColors = [
    { border: "rgba(248,113,113,0.75)", fill: "rgba(248,113,113,0.10)", glow: "rgba(248,113,113,0.25)" }, // red
    { border: "rgba(251,191,36,0.75)",  fill: "rgba(251,191,36,0.10)",  glow: "rgba(251,191,36,0.25)"  }, // amber
    { border: "rgba(168,85,247,0.75)",  fill: "rgba(168,85,247,0.10)",  glow: "rgba(168,85,247,0.25)"  }, // purple
    { border: "rgba(236,72,153,0.75)",  fill: "rgba(236,72,153,0.10)",  glow: "rgba(236,72,153,0.25)"  }, // pink
  ];
  const _myColor = { border: "rgba(34,197,94,0.65)", fill: "rgba(34,197,94,0.08)", glow: "rgba(34,197,94,0.20)" };
  const _selColor = { border: "rgba(56,189,248,0.85)", fill: "rgba(56,189,248,0.18)", glow: "rgba(56,189,248,0.35)" };
  const _defaultColor = { border: "rgba(148,163,184,0.22)", fill: "rgba(0,0,0,0.18)", glow: "transparent" };

  // Map unique opponent names to colors (stable ordering)
  const oppOwners = [...new Set(activePieces
    .filter(p => safeStr(p?.owner) && safeStr(p?.owner) !== _by)
    .map(p => safeStr(p.owner))
  )].sort();
  const _oppColorMap = {};
  for (let i = 0; i < oppOwners.length; i++) {
    _oppColorMap[oppOwners[i]] = _oppColors[i % _oppColors.length];
  }

  // Track which sprite overlay elements are used this frame
  const _usedSpriteIds = new Set();

  // ── Pass 3: Y-sort stack (v2 map objects + entities) ─────────────────────
  // sortY = grid row of the item's "foot" (drawn last = visually in front).
  // Entities:    sortY = piece.row + tileH  (bottom edge of footprint)
  // v2 Objects:  sortY = obj.y + anchor.ay * footprint.h  (anchor foot)
  const _yStack = [];

  for (const p of visiblePieces) {
    const r = Number(p?.row);
    if (!Number.isFinite(r)) continue;
    const { tileH } = getSizeDimensions(getPieceSizeCategory(p));
    _yStack.push({ _isObj: false, piece: p, sortY: r + tileH });
  }

  // v2: interleave map objects in the draw stack for proper depth ordering
  if (mapLayersState.version === 2) {
    for (const obj of mapLayersState.objects) {
      const sortY = Number(obj.y ?? 0)
        + (obj.anchor?.ay ?? 1.0) * (obj.footprint?.h ?? 1);
      _yStack.push({ _isObj: true, obj, sortY });
    }
  }

  // Sort ascending: lower sortY drawn first (farther from viewer = behind)
  // Tie-break: objects before entities so entities appear on top of same-row objects.
  _yStack.sort((a, b) => {
    if (a.sortY !== b.sortY) return a.sortY - b.sortY;
    return a._isObj ? -1 : 1;
  });

  for (const _item of _yStack) {
    // ── v2 map object ───────────────────────────────────────────────────────
    if (_item._isObj) {
      const obj = _item.obj;
      // Draw on canvas (fallback / shadow; also shown if HTML sprite not yet loaded)
      _drawMapObject(ctx, obj, ox, oy, tile);
      // HTML overlay for CSS z-index stacking with entity sprites
      if (obj._spriteUrl) {
        renderMapObjectOverlay(obj, _spriteOverlay, ox, oy, tile);
      }
      continue;
    }

    // ── entity (piece) ──────────────────────────────────────────────────────
    const p = _item.piece;
    const row = Number(p?.row);
    const col = Number(p?.col);
    if (!Number.isFinite(row) || !Number.isFinite(col)) continue;
    const id = safeStr(p?.id);
    const owner = safeStr(p?.owner);
    const isSel = safeStr(appState.selectedPieceId) && safeStr(appState.selectedPieceId) === id;
    const isMine = _by && owner === _by;
    const megaFx = getMegaEvolutionFxState(owner, p?.pid);
    const pieceHpValue = safeStr(p?.kind) !== "trainer" ? getPartyHp(owner, p) : 6;

    const spritePlacement = buildPieceSpritePlacement(p, visiblePieces, { ox, oy, tile, sortY: _item.sortY });
    if (!spritePlacement) continue;
    const { sizeCategory, tileW, tileH, x, y, spriteX: placementSpriteX, spriteY: placementSpriteY, spriteW: placementSpriteW, spriteH: placementSpriteH, hitZIndex } = spritePlacement;
    if (id) {
      nextPieceScreenBounds.set(id, {
        left: placementSpriteX,
        top: placementSpriteY,
        width: placementSpriteW,
        height: placementSpriteH,
        hitZIndex,
      });
    }

    // Determine color scheme
    let colorScheme;
    if (isSel) {
      colorScheme = _selColor;
    } else if (isMine) {
      colorScheme = _myColor;
    } else if (_oppColorMap[owner]) {
      colorScheme = _oppColorMap[owner];
    } else {
      colorScheme = _defaultColor;
    }

    // token base fill — spans full footprint for multi-tile pieces
    ctx.fillStyle = colorScheme.fill;
    ctx.fillRect(x + 2, y + 2, tile * tileW - 4, tile * tileH - 4);

    // sprite — rendered as HTML <img> overlay for GIF animation support
    const _psPiece = ((_partyStates && _partyStates[owner]) ? _partyStates[owner] : {})[safeStr(p?.pid)] || {};
    const sprUrl = getSpriteUrlForPiece(p, { type: "battle", shiny: !!_psPiece.shiny });
    const pad = Math.max(6, Math.floor(tile * 0.12));

    // Calcula posição e tamanho do sprite conforme sizeCategory
    let spriteX, spriteY, spriteW, spriteH;
    if (sizeCategory === SIZE_CATEGORIES.tiny) {
      // Quadrante: encontra slot entre tinies no mesmo tile
      const tinyOnTile = getPiecesOccupyingTile(row, col, visiblePieces)
        .filter(q => getPieceSizeCategory(q) === SIZE_CATEGORIES.tiny && isPieceVisibleToMe(q));
      const slotIndex = Math.max(0, tinyOnTile.findIndex(q => safeStr(q.id) === id));
      const slot = getTinySlotPosition(slotIndex);
      spriteX = x + slot.offsetXRatio * tile;
      spriteY = y + slot.offsetYRatio * tile;
      spriteW = slot.sizeRatio * tile;
      spriteH = slot.sizeRatio * tile;
    } else if (sizeCategory === SIZE_CATEGORIES.large || sizeCategory === SIZE_CATEGORIES.huge) {
      // Multi-tile: sprite cobre todo o footprint
      const pad2 = Math.max(4, Math.floor(tile * 0.06));
      spriteX = x + pad2;
      spriteY = y + pad2;
      spriteW = tile * tileW - pad2 * 2;
      spriteH = tile * tileH - pad2 * 2;
    } else {
      // Medium: 1 tile inteiro (comportamento original)
      spriteX = x + pad;
      spriteY = y + pad;
      spriteW = tile - pad * 2;
      spriteH = tile - pad * 2;
    }

    if (sprUrl && id) {
      _usedSpriteIds.add(id);
      let entry = _spritePool.get(id);
      if (!entry) {
        const el = document.createElement("img");
        el.className = "spr-overlay-img";
        el.draggable = false;
        el.loading = "eager";
        el.decoding = "async";
        el.alt = "";
        el.dataset.pieceId = id;
        el.onerror = function () {
          const cur = this.getAttribute("src") || "";
          const fb = this.dataset.fallback || "";
          if (fb && cur !== fb) {
            this.src = fb;
          } else {
            this.style.display = "none";
          }
        };
        _spriteOverlay.appendChild(el);
        entry = { el, url: "", fallback: "" };
        _spritePool.set(id, entry);
      }
      const remoteFb = getSpriteFallbackUrlForPiece(p);
      if (entry.url !== sprUrl) {
        entry.el.dataset.fallback = remoteFb;
        entry.el.src = sprUrl;
        entry.el.style.display = "";
        entry.url = sprUrl;
        entry.fallback = remoteFb;
      } else if (entry.fallback !== remoteFb) {
        entry.el.dataset.fallback = remoteFb;
        entry.fallback = remoteFb;
      }
      const st = entry.el.style;
      st.left   = spriteX + "px";
      st.top    = spriteY + "px";
      st.width  = spriteW + "px";
      st.height = spriteH + "px";
      st.zIndex = String(hitZIndex);
      applyCaptureBallThemeToElement(entry.el, getCaptureBallForTrainerPid(owner, p));
      applyPieceConditionFxToElement(entry.el, p);
      syncPieceEnteringClass(entry.el, id, frameNow);
      entry.el.classList.toggle("mega-evolving", !!megaFx);
      entry.el.classList.toggle("hp-ko", pieceHpValue <= 0);
    } else {
      // fallback glyph
      ctx.fillStyle = "rgba(226,232,240,0.85)";
      const fontSize = sizeCategory === SIZE_CATEGORIES.tiny
        ? Math.max(8, Math.floor(spriteW * 0.35))
        : Math.max(10, Math.floor(tile * 0.22));
      ctx.font = `900 ${fontSize}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = safeStr(p?.kind) === "trainer"
        ? (safeStr(p?.owner).slice(0, 1).toUpperCase() || "?")
        : (p?.revealed ? shortLabelFromPiece(p, 4) : "?");
      ctx.fillText(label, spriteX + spriteW / 2, spriteY + spriteH / 2);
    }

    // Dynamic border — spans full footprint
    ctx.strokeStyle = colorScheme.border;
    ctx.lineWidth = isSel ? 3 : (isMine || _oppColorMap[owner]) ? 2 : 1;
    ctx.strokeRect(x + 2, y + 2, tile * tileW - 4, tile * tileH - 4);

    // Glow effect for selected piece
    if (isSel) {
      ctx.save();
      ctx.shadowColor = _selColor.glow;
      ctx.shadowBlur = 8;
      ctx.strokeStyle = _selColor.border;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, tile * tileW - 2, tile * tileH - 2);
      ctx.restore();
    }

    if (safeStr(p?.kind) !== "trainer") {
      const hpUi = getHpUiState(pieceHpValue);
      const barHeight = sizeCategory === SIZE_CATEGORIES.tiny ? 3 : Math.max(4, Math.round(tile * 0.07));
      const barWidth = Math.max(12, Math.min(tile * tileW - 8, spriteW));
      const barX = x + Math.max(4, (tile * tileW - barWidth) / 2);
      const barY = y + tile * tileH - barHeight - 4;
      ctx.save();
      ctx.fillStyle = "rgba(2,6,23,0.72)";
      ctx.fillRect(barX, barY, barWidth, barHeight);
      if (hpUi.value > 0) {
        ctx.fillStyle = hpUi.color;
        ctx.fillRect(barX, barY, (barWidth * hpUi.pct) / 100, barHeight);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.strokeRect(barX + 0.5, barY + 0.5, Math.max(0, barWidth - 1), Math.max(0, barHeight - 1));
      ctx.restore();
    }

    if (megaFx) {
      const pulse = Math.sin(megaFx.progress * Math.PI);
      const fxPad = Math.max(6, tile * 0.08);
      ctx.save();
      ctx.strokeStyle = `rgba(96,165,250,${0.35 + pulse * 0.45})`;
      ctx.fillStyle = `rgba(251,191,36,${0.08 + pulse * 0.12})`;
      ctx.lineWidth = 2 + pulse * 2;
      ctx.shadowColor = "rgba(250,204,21,0.65)";
      ctx.shadowBlur = 12 + pulse * 18;
      ctx.fillRect(x + fxPad, y + fxPad, tile * tileW - fxPad * 2, tile * tileH - fxPad * 2);
      ctx.strokeRect(x - pulse * 6, y - pulse * 6, tile * tileW + pulse * 12, tile * tileH + pulse * 12);
      ctx.restore();
    }
  }

  _pieceScreenBounds = nextPieceScreenBounds;

  // Remove stale overlay sprites (pieces no longer visible)
  for (const [pid, entry] of _spritePool) {
    if (!_usedSpriteIds.has(pid)) {
      entry.el.remove();
      _spritePool.delete(pid);
    }
  }

  // ── Pass 4: overlayHigh ────────────────────────────────────────────────────
  // Reserved for elements that occlude entities (tree canopies, bridge tops, etc.).
  // Currently empty; v2 JSON may populate layers.overlayHigh in future iterations.
  // _drawOverlayHigh(ctx, ox, oy, gs, tile);  // TODO when overlayHigh is non-zero

  // Clean up stale v2 object overlay sprites
  _cleanObjSpritePool();

  // drag ghost — retângulo para large/huge, círculo para tiny/medium
  if (appState.drag.active && appState.selectedPieceId) {
    const dragPiece = (appState.pieces || []).find(q => safeStr(q?.id) === safeStr(appState.selectedPieceId));
    const dragSize = getPieceSizeCategory(dragPiece);
    const { tileW: dw, tileH: dh } = getSizeDimensions(dragSize);
    ctx.fillStyle = "rgba(56,189,248,0.10)";
    if (dw > 1 || dh > 1) {
      // Retângulo ghost multi-tile
      const hx = appState.drag.x - (dw * tile) / 2;
      const hy = appState.drag.y - (dh * tile) / 2;
      ctx.fillRect(hx, hy, dw * tile, dh * tile);
      ctx.strokeStyle = "rgba(56,189,248,0.35)";
      ctx.lineWidth = 1;
      ctx.strokeRect(hx, hy, dw * tile, dh * tile);
    } else {
      ctx.beginPath();
      ctx.arc(appState.drag.x, appState.drag.y, Math.max(10, tile * 0.32), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  } catch (err) {
    activateDomMode("frame-error", err);
    return;
  }
  requestArenaCanvasFrame();
}

// Start arena
bindArenaInteractionsCanvas();
bindArenaInteractionsDom();
if (!arenaDomSyncTimer) {
  arenaDomSyncTimer = window.setInterval(() => {
    try { requestArenaRefresh(); } catch {}
  }, 250);
}

if (useCanvas) {
  updateHudViewportHeight();
  resizeCanvasToContainer();
  fitToView();
  activateCanvasMode("boot-canvas");
} else {
  // fallback DOM (sempre mostra algo, mesmo se o canvas falhar)
  activateDomMode("context-failure");
}

// -------------------------
// Utilities
// -------------------------
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function escapeAttr(s) {
  return escapeHtml(s);
}

function _sheetMoveNotesHtml(mv) {
  const notes = safeStr(mv?.notes ?? mv?.Notes ?? "");
  if (!notes.trim()) return "";
  const notesHtml = escapeHtml(notes).replace(/\r?\n/g, "<br>");
  return `
    <div class="move-notes">
      <div class="move-notes-label">Anotações</div>
      <div class="move-notes-box">${notesHtml}</div>
    </div>
  `;
}

// Local overrides init (Dex/Map)
(function initLocalOverrides(){
  setDexMap(loadDexMapFromStorage());
  mapUrlOverride = loadMapOverrideFromStorage();

  const dexFile = document.getElementById('dex_json_file');
  const dexClear = document.getElementById('dex_clear');
  dexFile?.addEventListener('change', async (ev) => {
    const f = ev.target?.files?.[0];
    if (!f) return;
    try {
      const raw = await f.text();
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') throw new Error('JSON inválido');
      setDexMap(obj);
      saveDexMapToStorage(obj);
      setStatus('ok', 'Dex carregada (local)');
      updateSidePanels();
    } catch (e) {
      setStatus('err', 'Falha ao carregar Dex: ' + (e?.message || e));
    }
  });
  dexClear?.addEventListener('click', () => {
    setDexMap(null);
    saveDexMapToStorage({});
    setStatus('ok', 'Dex limpa');
    updateSidePanels();
  });

  const mapUrlInput = document.getElementById('map_url_override');
  const mapApply = document.getElementById('map_url_apply');
  const mapClear = document.getElementById('map_url_clear');
  if (mapUrlInput) mapUrlInput.value = mapUrlOverride || '';

  mapApply?.addEventListener('click', () => {
    const url = safeStr(mapUrlInput?.value || '');
    mapUrlOverride = url;
    saveMapOverrideToStorage(url);
    setStatus('ok', url ? 'Mapa override aplicado' : 'Mapa override vazio');
  });
  mapClear?.addEventListener('click', () => {
    mapUrlOverride = '';
    if (mapUrlInput) mapUrlInput.value = '';
    saveMapOverrideToStorage('');
    setStatus('ok', 'Mapa override limpo');
  });
})();

// Initial UI
syncArenaOverlayLayout();
setTab("arena");
updateArenaMeta();
updateFieldConditionsUI();
updateTopBadges();
updateSidePanels();
setStatus("warn", "desconectado");


// =====================================================
// FICHAS (Cards + Painel lateral) — integrado do battle-site-fichas.html
// - injeta UI/CSS no #tab_sheets se ainda não existir
// - assina trainers/{uid}/sheets (tempo real)
// - usa rooms/{rid}/public_state/party_states (HP/cond) se existir
// =====================================================

let _sheetsRtKey = null;
let _sheetsUnsub = null;
let _partyStatesUnsub = null;
let _trainerRpgSheetUnsub = null;
let _trainerRpgSheetRtKey = null;

let _allSheetsLatest = [];   // lista (desc por updated_at) do trainer logado
let _allSheetsCollections = _buildSheetCollections([]);
let _partyStates = {};
let _partyStatesBootstrapped = false;
let _sheetsSelectedPid = null;
let _sheetsRenderedDetailPid = null;
let _sheetsLastError = "";
const _sheetsOpenMoveKeys = new Set();
// Persiste modificadores temporários de dano/acerto por golpe entre trocas de aba
// chave: `${pid}::${moveIndex}`, valor: { acc: 0, dmg: 0 }
const _sheetsMods = {};
const _megaEvolutionFx = new Map();

function _megaFxKey(ownerName, pidLike) {
  const owner = _trainerLookupKey(ownerName);
  const pid = pidKey(pidLike);
  return owner && pid ? `${owner}::${pid}` : "";
}

function _trimMegaEvolutionFx(now = Date.now()) {
  for (const [key, rec] of _megaEvolutionFx.entries()) {
    if (!rec || now - Number(rec.startedAt || 0) > Number(rec.durationMs || 1200)) {
      _megaEvolutionFx.delete(key);
    }
  }
}

function getMegaEvolutionFxState(ownerName, pidLike) {
  const key = _megaFxKey(ownerName, pidLike);
  if (!key) return null;
  const rec = _megaEvolutionFx.get(key);
  if (!rec) return null;
  const now = Date.now();
  const elapsed = now - Number(rec.startedAt || 0);
  const durationMs = Math.max(1, Number(rec.durationMs || 1200));
  if (elapsed >= durationMs) {
    _megaEvolutionFx.delete(key);
    return null;
  }
  return {
    progress: Math.max(0, Math.min(1, elapsed / durationMs)),
    durationMs,
    elapsed,
  };
}

function triggerMegaEvolutionFx(ownerName, pidLike, options = {}) {
  const key = _megaFxKey(ownerName, pidLike);
  if (!key) return;
  const now = Date.now();
  const existing = _megaEvolutionFx.get(key);
  if (existing && now - Number(existing.startedAt || 0) < 250) return;
  _megaEvolutionFx.set(key, {
    startedAt: now,
    durationMs: Number(options.durationMs) > 0 ? Number(options.durationMs) : 1250,
  });
  try { updateSidePanels?.(); } catch {}
  try { requestArenaRefresh(true); } catch {}
}

function _collectActiveMegaMap(source) {
  const out = new Map();
  const data = (source && typeof source === "object") ? source : {};
  for (const [ownerName, bucket] of Object.entries(data)) {
    if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) continue;
    for (const [pidLike, entry] of Object.entries(bucket)) {
      const slug = safeStr(entry?.active_mega_slug);
      if (!slug) continue;
      const key = _megaFxKey(ownerName, pidLike);
      if (key) out.set(key, slug);
    }
  }
  return out;
}

function _detectMegaEvolutionTransitions(prevState, nextState) {
  const prevMap = _collectActiveMegaMap(prevState);
  const nextMap = _collectActiveMegaMap(nextState);
  for (const [key, nextSlug] of nextMap.entries()) {
    const prevSlug = safeStr(prevMap.get(key));
    if (prevSlug === nextSlug) continue;
    const [ownerName, pidLike] = key.split("::");
    if (ownerName && pidLike) triggerMegaEvolutionFx(ownerName, pidLike);
  }
}

function safePidValue(x) {
  let v = safeStr(x);
  if (!v) return "";
  if (v.startsWith("EXT:")) return v;
  if (v.startsWith("PID:")) v = v.slice(4);
  // tira zeros à esquerda apenas se for número
  if (/^\d+$/.test(v)) return (v.replace(/^0+/, "") || "0");
  return v;
}

function _getSheetMoveModKey(pid, moveIndex, sh = null) {
  const keys = _getSheetMoveModKeys(pid, moveIndex, sh);
  return keys[0] || "";
}

function _getSheetMoveModKeys(pid, moveIndex, sh = null) {
  const idx = safeInt(moveIndex, -1);
  if (idx < 0) return [];

  const bases = [];
  const pushBase = (value) => {
    const normalized = safePidValue(value);
    if (!normalized || bases.includes(normalized)) return;
    bases.push(normalized);
  };

  // Prioriza o identificador estável da ficha para que Ficha e Arena usem a mesma chave.
  pushBase(sh?.pokemon?.id);
  pushBase(sh?.linked_pid);
  pushBase(pid);
  pushBase(sh?._party_pid_raw);
  pushBase(sh?.pokemon?.name);
  pushBase(sh?._sheet_id || sh?.sheet_id || sh?.id);

  return bases.map((base) => `${base}::${idx}`);
}

function getSheetMoveTempModifiers(pid, moveIndex, sh = null) {
  const keys = _getSheetMoveModKeys(pid, moveIndex, sh);
  const key = keys[0] || "";
  const matchedKey = keys.find((candidate) => candidate && _sheetsMods[candidate]);
  const saved = matchedKey ? _sheetsMods[matchedKey] : null;
  if (saved && key && matchedKey && matchedKey !== key && !_sheetsMods[key]) {
    _sheetsMods[key] = saved;
  }
  return {
    key,
    acc: safeInt(saved?.acc, 0),
    dmg: safeInt(saved?.dmg, 0),
  };
}

// Normaliza PID para matching (EXT: case-insensitive)
function pidKey(x) {
  const v = safePidValue(x);
  if (!v) return "";
  if (/^EXT:/i.test(v)) return "ext:" + v.slice(4).trim().toLowerCase();
  return v;
}

function _injectSheetsStyleOnce() {
  if (document.getElementById("sheets_tab_style")) return;
  const st = document.createElement("style");
  st.id = "sheets_tab_style";
  st.textContent = "\n/* ─── FICHAS TAB (injetado pelo main.js) ─── */\n#tab_sheets .sheets-status-bar{\n  display:flex;align-items:center;gap:8px;flex-wrap:wrap;\n  padding:10px 14px;border-radius:14px;border:1px solid rgba(255,255,255,.12);\n  background:rgba(15,23,42,.55);margin-bottom:16px;\n}\n#tab_sheets .fichas-layout{display:flex;flex-direction:column;gap:12px;}\n#tab_sheets .cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;}\n#tab_sheets .poke-card{border-radius:14px;padding:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);\n  cursor:pointer;transition:all .2s;position:relative;overflow:hidden;}\n#tab_sheets .poke-card::before{content:'';position:absolute;inset:0;background:var(--card-bg,transparent);opacity:.12;pointer-events:none;border-radius:inherit;}\n#tab_sheets .poke-card:hover{border-color:rgba(255,255,255,.2);transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.3);}\n#tab_sheets .poke-card.selected{border-color:rgba(59,130,246,.5);box-shadow:0 0 0 2px rgba(59,130,246,.3) inset,0 10px 30px rgba(0,0,0,.3);}\n#tab_sheets .card-head{display:flex;gap:10px;align-items:center;position:relative;z-index:1;}\n#tab_sheets .card-head img{width:64px;height:64px;object-fit:contain;border-radius:12px;border:1px solid rgba(255,255,255,.12);\n  background:rgba(0,0,0,.15);padding:4px;image-rendering:pixelated;}\n#tab_sheets .card-info{flex:1;min-width:0;}\n#tab_sheets .card-name{font-weight:900;font-size:.95rem;line-height:1.15;}\n#tab_sheets .card-sub{font-size:.78rem;opacity:.75;margin-top:2px;}\n#tab_sheets .pill-row,.inspector .pill-row,#inspector_root .pill-row{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;}\n#tab_sheets .type-pill,.inspector .type-pill,#inspector_root .type-pill{padding:2px 8px;border-radius:999px;font-size:.68rem;font-weight:900;text-transform:uppercase;\n  border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.2);}\n#tab_sheets .card-divider{height:1px;background:rgba(255,255,255,.12);margin:8px 0;position:relative;z-index:1;}\n#tab_sheets .card-moves-label{font-weight:900;font-size:.78rem;opacity:.8;margin-bottom:4px;position:relative;z-index:1;}\n#tab_sheets .card-move-row{display:flex;align-items:center;gap:6px;padding:3px 0;position:relative;z-index:1;}\n#tab_sheets .card-move-name{font-weight:700;font-size:.82rem;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n#tab_sheets .mv-pill,.inspector .mv-pill,#inspector_root .mv-pill{padding:1px 6px;border-radius:999px;font-size:.66rem;font-weight:900;font-family:monospace;border:1px solid rgba(255,255,255,.12);}\n#tab_sheets .mv-pill.acc,.inspector .mv-pill.acc,#inspector_root .mv-pill.acc{background:rgba(56,189,248,.12);border-color:rgba(56,189,248,.3);color:#38bdf8;}\n#tab_sheets .mv-pill.rk,.inspector .mv-pill.rk,#inspector_root .mv-pill.rk{background:rgba(234,179,8,.12);border-color:rgba(234,179,8,.3);color:#eab308;}\n#tab_sheets .mv-pill.area,.inspector .mv-pill.area,#inspector_root .mv-pill.area{background:rgba(168,85,247,.12);border-color:rgba(168,85,247,.3);color:#a855f7;}\n#tab_sheets .card-open{display:block;text-align:right;font-weight:900;font-size:.78rem;color:#38bdf8;margin-top:6px;position:relative;z-index:1;cursor:pointer;}\n#tab_sheets .sheet-panel,.inspector .sheet-panel,#inspector_root .sheet-panel{border-radius:14px;border:1px solid rgba(255,255,255,.12);background:rgba(17,24,39,.9);padding:18px;position:sticky;top:16px;}\n#tab_sheets .sheet-header,.inspector .sheet-header,#inspector_root .sheet-header{display:flex;gap:16px;align-items:flex-start;margin-bottom:14px;}\n#tab_sheets .sheet-art,.inspector .sheet-art,#inspector_root .sheet-art{width:130px;height:130px;object-fit:contain;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.2);padding:8px;}\n#inspector_root .sheet-art{width:100px;height:100px;}\n#inspector_root .inspector-card{border-radius:14px;border:1px solid rgba(255,255,255,.12);background:rgba(17,24,39,.9);padding:14px;}\n#tab_sheets .sheet-name,.inspector .sheet-name,#inspector_root .sheet-name{font-weight:900;font-size:1.2rem;}\n#tab_sheets .sheet-sub,.inspector .sheet-sub,#inspector_root .sheet-sub{font-size:.85rem;opacity:.75;margin-top:2px;}\n#tab_sheets .stat-grid,.inspector .stat-grid,#inspector_root .stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:12px 0;}\n#tab_sheets .stat-box,.inspector .stat-box,#inspector_root .stat-box{text-align:center;padding:8px 4px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);}\n#tab_sheets .stat-label,.inspector .stat-label,#inspector_root .stat-label{font-size:.68rem;font-weight:700;opacity:.75;text-transform:uppercase;}\n#tab_sheets .stat-val,.inspector .stat-val,#inspector_root .stat-val{font-size:1.1rem;font-weight:900;margin-top:2px;}\n#tab_sheets .section-title,.inspector .section-title,#inspector_root .section-title{font-weight:900;font-size:.88rem;margin:14px 0 6px;}\n#tab_sheets .chip-row,.inspector .chip-row,#inspector_root .chip-row{display:flex;flex-wrap:wrap;gap:5px;}\n#tab_sheets .chip,.inspector .chip,#inspector_root .chip{padding:3px 10px;border-radius:999px;font-size:.75rem;font-weight:700;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);}\n#tab_sheets .sheet-divider,.inspector .sheet-divider,#inspector_root .sheet-divider{height:1px;background:rgba(255,255,255,.12);margin:12px 0;}\n#tab_sheets .move-expander,.inspector .move-expander,#inspector_root .move-expander{border:1px solid rgba(255,255,255,.12);border-radius:10px;margin-bottom:6px;overflow:hidden;}\n#tab_sheets .move-header,.inspector .move-header,#inspector_root .move-header{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;background:rgba(255,255,255,.04);transition:background .15s;}\n#tab_sheets .move-header:hover,.inspector .move-header:hover,#inspector_root .move-header:hover{background:rgba(255,255,255,.08);}\n#tab_sheets .move-header .arrow,.inspector .move-header .arrow,#inspector_root .move-header .arrow{font-size:.7rem;transition:transform .2s;opacity:.75;}\n#tab_sheets .move-expander.open .arrow,.inspector .move-expander.open .arrow,#inspector_root .move-expander.open .arrow{transform:rotate(90deg);}\n#tab_sheets .move-h-name,.inspector .move-h-name,#inspector_root .move-h-name{font-weight:900;font-size:.85rem;flex:1;}\n#tab_sheets .move-body,.inspector .move-body,#inspector_root .move-body{padding:10px 12px;border-top:1px solid rgba(255,255,255,.12);display:none;font-size:.82rem;opacity:.85;}\n#tab_sheets .move-expander.open .move-body,.inspector .move-expander.open .move-body,#inspector_root .move-expander.open .move-body{display:block;}\n#tab_sheets .notes-input,.inspector .notes-input,#inspector_root .notes-input{width:100%;padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.25);color:inherit;font-size:.82rem;margin-top:8px;}\n#tab_sheets .hp-track,.inspector .hp-track,#inspector_root .hp-track{height:8px;border-radius:4px;background:rgba(0,0,0,.25);overflow:hidden;}\n#tab_sheets .hp-fill,.inspector .hp-fill,#inspector_root .hp-fill{height:100%;border-radius:4px;transition:width .3s;}\n#tab_sheets .sheets-empty{ text-align:center; padding:40px 20px; opacity:.75;}\n#tab_sheets .spinner{width:24px;height:24px;border:3px solid rgba(255,255,255,.12);border-top-color:#38bdf8;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto;}\n@keyframes spin{to{transform:rotate(360deg);}}\n";
  document.head.appendChild(st);

  const stFicha = document.createElement("style");
  stFicha.id = "sheets_tab_style_ficha_v2";
  stFicha.textContent = `
  #tab_sheets .sheet-panel.ficha-v2,
  #inspector_root .inspector-card.ficha-v2 {
    background: #223355;
    border: 1px solid rgba(255,255,255,.14);
    border-radius: 24px;
    padding: 18px;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
  }
  #inspector_root .inspector-title {
    font-size: 48px;
    line-height: 1;
    font-weight: 900;
    margin-bottom: 10px;
  }
  .ficha-v2 .sheet-header { gap: 18px; margin-bottom: 12px; }
  .ficha-v2 .sheet-art-frame {
    border-radius: 22px;
    padding: 10px;
    border: 1px solid rgba(255,255,255,.2);
    background: rgba(20,31,56,.72);
  }
  .ficha-v2 .sheet-art { width: 160px; height: 160px; background: #f3f4f6; border-radius: 14px; }
  #inspector_root .ficha-v2 .sheet-art { width: 150px; height: 150px; }
  .ficha-v2 .sheet-name { font-size: 54px; line-height: .95; }
  .ficha-v2 .sheet-sub { font-size: 38px; font-weight: 800; opacity: .9; }
  .ficha-v2 .pill-row { gap: 8px; margin-top: 8px; }
  .ficha-v2 .type-pill,.ficha-v2 .chip {
    padding: 4px 14px;
    border-radius: 999px;
    font-size: 30px;
    font-weight: 900;
    background: rgba(20,31,56,.8);
    border: 2px solid rgba(255,255,255,.16);
    text-transform: uppercase;
  }
  .ficha-v2 .ability-pill { color: #57e5ff; border-color: rgba(87,229,255,.75); }
  .ficha-v2 .hp-row { display:flex; justify-content:space-between; font-size: 40px; font-weight: 900; margin: 12px 0 6px; }
  .ficha-v2 .hp-track { height: 16px; border-radius: 999px; background: rgba(9,14,30,.55); }
  .ficha-v2 .stat-grid { gap: 10px; margin: 16px 0 14px; }
  .ficha-v2 .stat-box { border-radius: 16px; background: rgba(56,74,108,.72); padding: 12px 6px; border-color: rgba(255,255,255,.2); }
  .ficha-v2 .stat-label { font-size: 28px; opacity: .95; font-weight: 900; }
  .ficha-v2 .stat-val { font-size: 52px; line-height: .95; }
  .ficha-v2 .stat-box.cap { border-color: rgba(87,229,255,.9); }
  .ficha-v2 .stat-box.cap .stat-label, .ficha-v2 .stat-box.cap .stat-val { color: #57e5ff; }
  .ficha-v2 .section-title { font-size: 50px; margin: 14px 0 8px; }
  .ficha-v2 .chip-row { gap: 8px; }
  .ficha-v2 .move-expander { border-radius: 16px; background: rgba(52,69,102,.8); border-color: rgba(255,255,255,.18); margin-bottom: 10px; }
  .ficha-v2 .move-header { background: transparent; padding: 12px 14px; }
  .ficha-v2 .move-h-name { font-size: 44px; }
  .ficha-v2 .mv-pill { font-size: 30px; padding: 3px 12px; border-width: 2px; }
  .ficha-v2 .move-notes { margin-top: 10px; }
  .ficha-v2 .move-notes-label { font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: .03em; opacity: .74; margin-bottom: 4px; }
  .ficha-v2 .move-notes-box { padding: 8px 10px; border-radius: 12px; border: 1px solid rgba(255,255,255,.14); background: rgba(20,31,56,.72); white-space: pre-wrap; line-height: 1.45; }
  .ficha-v2 .sheet-divider { margin: 12px 0; }

  /* ── Stat Boosts Temporários ─────────────────────────────── */
  .stat-boost-badge {
    display:inline-block; font-size:0.55em; font-weight:900;
    color:#fbbf24; margin-left:3px; vertical-align:super;
  }
  .stat-boost-panel {
    margin: 8px 0 10px;
    padding: 10px 12px;
    border-radius: 14px;
    background: rgba(168,85,247,.08);
    border: 1px solid rgba(168,85,247,.3);
  }
  .stat-boost-title {
    font-size: 13px; font-weight: 900; margin-bottom: 8px; color: #c084fc;
  }
  .stat-boost-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 6px;
  }
  .stat-boost-row {
    display: grid;
    grid-template-columns: minmax(42px, 1fr) 28px 34px 28px;
    align-items: center;
    gap: 4px;
    min-width: 0;
    overflow: hidden;
    background: rgba(255,255,255,.04); border-radius: 10px; padding: 4px 6px;
  }
  .stat-boost-name { font-size: 11px; font-weight: 700; min-width: 0; text-align:right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .stat-boost-val {
    font-size: 14px; font-weight: 900; min-width: 0; text-align: center;
  }
  .stat-boost-val.boost-pos { color: #4ade80; }
  .stat-boost-val.boost-neg { color: #f87171; }
  .stat-boost-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    min-width: 28px;
    padding: 0;
    font-size: 14px;
    line-height: 1;
    border-radius: 6px;
    box-shadow: none;
    position: relative;
    z-index: 1;
  }
  .stat-boost-btn:hover,
  .stat-boost-btn:active {
    transform: none;
  }
  /* versão compacta no inspector */
  #inspector_root .stat-boost-panel { margin: 6px 0; }
  #inspector_root .stat-boost-grid { grid-template-columns: repeat(auto-fit, minmax(116px, 1fr)); gap: 4px; }
  #inspector_root .stat-boost-row { grid-template-columns: minmax(36px, 1fr) 26px 30px 26px; padding: 4px 5px; }
  #inspector_root .stat-boost-btn { width: 26px; height: 26px; min-width: 26px; }
  #inspector_root .stat-boost-title, #inspector_root .stat-boost-name, #inspector_root .stat-boost-val { font-size: 11px; }

/* ── Inspector: Condições (tracking) ─────────────────────── */
  #inspector_root .ins-conds {
    margin-top: 10px;
    padding: 12px;
    border-radius: 16px;
    border: 1px solid rgba(130, 169, 255, .22);
    background: linear-gradient(180deg, rgba(15,25,50,.55) 0%, rgba(8,14,34,.75) 100%);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
  }
  #inspector_root .ins-conds-title { font-weight: 900; font-size: .96rem; margin-bottom: 10px; letter-spacing: .01em; }
  #inspector_root .ins-conds-subtitle { font-weight: 900; font-size: .84rem; margin-top: 12px; margin-bottom: 6px; opacity: .92; }
  
  #inspector_root .ins-conds-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }
  
  #inspector_root .ins-conds-col {
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 14px;
    background: rgba(255,255,255,.03);
    padding: 8px;
    display: flex;
    flex-direction: column;
  }
  
  #inspector_root .ins-conds-degree {
    font-size: .75rem;
    font-weight: 950;
    text-transform: uppercase;
    color: #94a3b8;
    margin-bottom: 8px;
    text-align: center;
  }

  /* Listas Customizadas (Substituem os Selects) */
  #inspector_root .custom-cond-list {
    height: 180px;
    overflow-y: auto;
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    margin-bottom: 8px;
    scrollbar-color: rgba(148,163,184,.6) rgba(15,23,42,.4);
  }
  
  #inspector_root .custom-cond-list.pkm-list {
    height: 140px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 4px;
    padding: 6px;
  }

  #inspector_root .cond-item {
    padding: 6px 10px;
    font-size: .8rem;
    cursor: pointer;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    transition: all 0.2s;
    user-select: none;
  }

  #inspector_root .cond-item:hover {
    background: rgba(56, 189, 248, 0.15);
    color: #38bdf8;
  }

  #inspector_root .cond-item.selected {
    background: rgba(56, 189, 248, 0.25);
    border-left: 3px solid #38bdf8;
    color: #bae6fd;
    font-weight: 800;
  }
  
  #inspector_root .cond-item.pkm-item {
    border: 1px solid rgba(255,255,255,.05);
    border-radius: 6px;
    text-align: center;
  }

  #inspector_root .custom-cond-list[data-disabled='true'] .cond-item {
    pointer-events: none;
    opacity: 0.6;
  }

  /* Caixa de Descrição Dinâmica */
  #inspector_root .ins-conds-desc {
    min-height: 65px;
    font-size: .75rem;
    line-height: 1.35;
    padding: 8px 10px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 6px;
    border-left: 3px solid rgba(148, 163, 184, 0.5);
    color: #cbd5e1;
    transition: border-color 0.2s;
  }
  
  #inspector_root .ins-conds-col:hover .ins-conds-desc {
    border-left-color: #38bdf8;
  }

  #inspector_root .ins-conds-actions {
    display:flex;
    gap:8px;
    margin-top: 14px;
    flex-wrap: wrap;
  }
  
  #inspector_root .ins-conds-actions .btn {
    min-width: 0;
    flex: 1 1 150px;
  }

  #inspector_root .ins-conds-current {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px dashed rgba(148,163,184,.35);
  }
  
  @media (max-width: 900px) {
    /* MANTÉM A RESPONSIVIDADE ANTIGA DA FICHA */
    #inspector_root .inspector-title, .ficha-v2 .section-title { font-size: 28px; }
    .ficha-v2 .sheet-name { font-size: 34px; }
    .ficha-v2 .sheet-sub, .ficha-v2 .hp-row { font-size: 24px; }
    .ficha-v2 .type-pill, .ficha-v2 .chip, .ficha-v2 .mv-pill, .ficha-v2 .stat-label { font-size: 16px; }
    .ficha-v2 .stat-val { font-size: 28px; }
    .ficha-v2 .move-h-name { font-size: 24px; }
    .ficha-v2 .sheet-art { width: 118px; height: 118px; }

    /* ADICIONA A RESPONSIVIDADE DAS NOVAS CONDIÇÕES */
    #inspector_root .ins-conds-grid { grid-template-columns: 1fr; }
    #inspector_root .custom-cond-list { height: 120px; }
  }

  /* ── Tipo dos golpes ──────────────────────────────────────── */
  .mv-type-pill {
    padding: 1px 7px;
    border-radius: 999px;
    font-size: .65rem;
    font-weight: 900;
    font-family: monospace;
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: .04em;
    flex-shrink: 0;
  }
  .ficha-v2 .mv-type-pill {
    font-size: 24px;
    padding: 3px 12px;
    border-width: 2px;
  }

  /* ── STAB — golpe do mesmo tipo do pokémon ───────────────── */
  .move-stab {
    position: relative;
    border-color: var(--stab-color, rgba(255,220,100,.45)) !important;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--stab-color, #fbbf24) 30%, transparent);
  }
  .move-stab::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(90deg, color-mix(in srgb, var(--stab-color, #fbbf24) 8%, transparent) 0%, transparent 60%);
    pointer-events: none;
  }
  .move-stab .move-header {
    background: color-mix(in srgb, var(--stab-color, #fbbf24) 6%, rgba(255,255,255,.04)) !important;
  }
  /* Animação sutil de brilho para STAB */
  @keyframes stab-pulse {
    0%, 100% { box-shadow: 0 0 0 1px color-mix(in srgb, var(--stab-color, #fbbf24) 30%, transparent); }
    50% { box-shadow: 0 0 8px 2px color-mix(in srgb, var(--stab-color, #fbbf24) 50%, transparent); }
  }
  .move-stab {
    animation: stab-pulse 2.5s ease-in-out infinite;
  }

  /* ── Tabela de matchups de tipo (inspector) ───────────────── */
  .type-matchup-mini {
    font-size: .72rem;
  }
  `;

  /* versão ficha-v2 para type-pill colorida */
  const stTypePill = document.createElement("style");
  stTypePill.id = "sheets_tab_style_type_pill";
  stTypePill.textContent = `
  /* Override type-pill para usar cor do tipo */
  .ficha-v2 .type-pill {
    background: rgba(0,0,0,.3) !important;
  }
  `;
  document.head.appendChild(stFicha);
  if (!document.getElementById("sheets_tab_style_type_pill")) {
    document.head.appendChild(stTypePill);
  }
  if (!document.getElementById("sheets_tab_style_overrides_20260409")) {
    const stOverrides = document.createElement("style");
    stOverrides.id = "sheets_tab_style_overrides_20260409";
    stOverrides.textContent = `
    #tab_sheets{
      min-width:0;
      min-height:0;
      flex:0 0 clamp(460px, calc(var(--hud-viewport-height, 780px) - 12px), 840px) !important;
      height:clamp(460px, calc(var(--hud-viewport-height, 780px) - 12px), 840px) !important;
      display:flex;
      flex-direction:column;
      overflow:hidden;
    }
    #tab_sheets #sheetsContent{
      flex:1 1 auto;
      min-height:0;
    }
    #tab_sheets .fichas-layout{
      display:grid;
      grid-template-columns:minmax(0,1.34fr) clamp(460px, 34vw, 620px);
      gap:18px;
      align-items:stretch;
      min-height:0;
      height:100%;
    }
    #tab_sheets .fichas-layout[data-has-detail="0"]{
      grid-template-columns:minmax(0,1fr);
    }
    #tab_sheets .sheets-column{
      min-width:0;
      min-height:0;
      height:100%;
      display:flex;
      flex-direction:column;
      gap:12px;
      overflow:hidden;
      padding:14px;
      border-radius:20px;
      border:1px solid rgba(255,255,255,.1);
      background:linear-gradient(180deg, rgba(10,18,34,.82), rgba(7,14,29,.94));
      box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
    }
    #tab_sheets .sheets-column-head{
      display:flex;
      flex-direction:column;
      gap:4px;
    }
    #tab_sheets .sheets-column-title{
      font-size:1rem;
      font-weight:950;
      letter-spacing:.01em;
    }
    #tab_sheets .sheets-column-sub{
      font-size:.8rem;
      line-height:1.4;
      color:rgba(148,163,184,.95);
    }
    #tab_sheets .sheets-column-list{
      align-self:stretch;
    }
    #tab_sheets .sheets-column-detail{
      position:relative;
      top:auto;
    }
    #tab_sheets .sheets-column-detail .sheets-column-head{
      gap:2px;
      padding-bottom:2px;
    }
    #tab_sheets .sheets-column-detail .sheets-column-title{
      font-size:2.2rem;
      line-height:.95;
      letter-spacing:-0.02em;
    }
    #tab_sheets .sheets-column-detail .sheets-column-sub{
      font-size:.82rem;
      font-family:monospace;
      letter-spacing:.02em;
    }
    #tab_sheets .cards-grid{
      display:grid;
      grid-template-columns:repeat(auto-fit, minmax(min(100%, 280px), 320px));
      justify-content:start;
      grid-auto-flow:row;
      align-content:start;
      flex:1 1 auto;
      min-height:0;
      overflow:auto;
      padding-right:6px;
      gap:14px;
    }
    #tab_sheets .poke-card{
      display:flex;
      flex-direction:column;
      gap:12px;
      min-height:344px;
      padding:14px;
      border-radius:22px;
      border:1px solid rgba(255,255,255,.12);
      background:linear-gradient(180deg, rgba(17,24,39,.88), rgba(10,16,30,.98));
      box-shadow:inset 0 1px 0 rgba(255,255,255,.05), 0 20px 36px rgba(2,6,23,.24);
      isolation:isolate;
    }
    #tab_sheets .poke-card::before{
      opacity:.18;
      background:
        radial-gradient(circle at top right, rgba(255,255,255,.12), transparent 42%),
        linear-gradient(180deg, var(--card-bg, transparent), transparent 72%);
    }
    #tab_sheets .poke-card::after{
      content:"";
      position:absolute;
      inset:9px;
      border-radius:16px;
      border:1px solid rgba(255,255,255,.06);
      pointer-events:none;
      z-index:0;
    }
    #tab_sheets .poke-card:hover{
      border-color:rgba(255,255,255,.22);
      transform:translateY(-3px);
      box-shadow:inset 0 1px 0 rgba(255,255,255,.06), 0 24px 40px rgba(2,6,23,.32);
    }
    #tab_sheets .poke-card.selected{
      border-color:rgba(59,130,246,.58);
      box-shadow:inset 0 0 0 1px rgba(96,165,250,.32), inset 0 1px 0 rgba(255,255,255,.06), 0 24px 42px rgba(2,6,23,.32);
    }
    #tab_sheets .card-head{
      align-items:flex-start;
      gap:12px;
    }
    #tab_sheets .card-art-shell{
      width:80px;
      height:80px;
      flex:0 0 80px;
      display:flex;
      align-items:center;
      justify-content:center;
      padding:8px;
      border-radius:18px;
      border:1px solid rgba(255,255,255,.16);
      background:linear-gradient(180deg, rgba(24,36,64,.86), rgba(12,18,34,.96));
      box-shadow:inset 0 1px 0 rgba(255,255,255,.06);
      position:relative;
      z-index:1;
    }
    #tab_sheets .card-head img{
      width:100%;
      height:100%;
      border-radius:14px;
      padding:4px;
      background:rgba(11,17,31,.92);
      border:1px solid rgba(255,255,255,.1);
      filter:drop-shadow(0 10px 18px rgba(2,6,23,.32));
    }
    #tab_sheets .card-info{
      display:flex;
      flex-direction:column;
      gap:4px;
      flex:1;
      min-height:0;
      position:relative;
      z-index:1;
    }
    #tab_sheets .card-name{
      font-size:1.14rem;
      line-height:1;
      letter-spacing:-.02em;
      display:-webkit-box;
      -webkit-line-clamp:2;
      -webkit-box-orient:vertical;
      overflow:hidden;
    }
    #tab_sheets .card-sub{
      font-size:.76rem;
      line-height:1.3;
      letter-spacing:.05em;
      text-transform:uppercase;
      color:rgba(191,219,254,.76);
    }
    #tab_sheets .pill-row{
      gap:6px;
      margin-top:2px;
    }
    #tab_sheets .type-pill,
    #tab_sheets .chip{
      padding:3px 8px;
      font-size:.64rem;
      letter-spacing:.04em;
    }
    #tab_sheets .card-stat-grid{
      position:relative;
      z-index:1;
      display:grid;
      grid-template-columns:repeat(4, minmax(0, 1fr));
      gap:8px;
    }
    #tab_sheets .card-stat{
      text-align:center;
      padding:8px 4px;
      border-radius:14px;
      border:1px solid rgba(148,163,184,.16);
      background:linear-gradient(180deg, rgba(30,41,59,.62), rgba(15,23,42,.82));
      box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
    }
    #tab_sheets .card-stat.cap{
      border-color:rgba(56,189,248,.32);
      background:linear-gradient(180deg, rgba(8,47,73,.44), rgba(12,24,44,.88));
    }
    #tab_sheets .card-stat-label{
      font-size:.62rem;
      font-weight:900;
      letter-spacing:.08em;
      text-transform:uppercase;
      color:rgba(191,219,254,.82);
    }
    #tab_sheets .card-stat-val{
      margin-top:4px;
      font-size:1.12rem;
      line-height:1;
      font-weight:950;
      color:rgba(241,245,249,.98);
    }
    #tab_sheets .card-stat.cap .card-stat-label,
    #tab_sheets .card-stat.cap .card-stat-val{
      color:#67e8f9;
    }
    #tab_sheets .card-footer{
      position:relative;
      z-index:1;
      margin-top:auto;
      display:flex;
      flex-direction:column;
      gap:8px;
      padding-top:10px;
      border-top:1px solid rgba(255,255,255,.1);
    }
    #tab_sheets .card-footer-label{
      font-size:.64rem;
      font-weight:900;
      letter-spacing:.08em;
      text-transform:uppercase;
      color:rgba(148,163,184,.88);
    }
    #tab_sheets .card-featured{
      display:flex;
      flex-direction:column;
      gap:6px;
      padding:10px 12px;
      border-radius:15px;
      border:1px solid rgba(148,163,184,.16);
      background:linear-gradient(180deg, rgba(15,23,42,.48), rgba(2,6,23,.36));
      overflow:hidden;
      position:relative;
    }
    #tab_sheets .card-featured.is-stab::before{
      content:"";
      position:absolute;
      inset:0;
      background:linear-gradient(90deg, color-mix(in srgb, var(--stab-color, #fbbf24) 12%, transparent), transparent 58%);
      pointer-events:none;
    }
    #tab_sheets .card-featured-head,
    #tab_sheets .card-featured-meta{
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap:8px;
      position:relative;
      z-index:1;
    }
    #tab_sheets .card-featured-meta{
      align-items:center;
      flex-wrap:wrap;
    }
    #tab_sheets .card-featured-name{
      flex:1;
      min-width:0;
      font-size:.9rem;
      font-weight:850;
      line-height:1.2;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }
    #tab_sheets .card-featured-note{
      font-size:.7rem;
      font-weight:800;
      line-height:1.25;
      color:rgba(191,219,254,.74);
    }
    #tab_sheets .card-featured .mv-pill{
      flex:0 0 auto;
    }
    #tab_sheets .card-open{
      margin-top:0;
      padding-top:0;
      font-size:.76rem;
      letter-spacing:.02em;
    }
    #tab_sheets #sheetDetailWrap{
      display:flex;
      flex-direction:column;
      height:100%;
      min-width:0;
      align-self:stretch;
    }
    #tab_sheets #sheetDetail{
      flex:1 1 auto;
      position:static;
      min-width:0;
      min-height:0;
      max-height:none;
      overflow:auto;
      padding-right:6px;
    }
    #tab_sheets #sheetDetail .inspector{
      min-width:0;
    }
    #tab_sheets #sheetDetail .inspector-head{
      display:none;
    }
    #tab_sheets #sheetDetail .inspector-card.ficha-v2{
      background:#223355;
      border:1px solid rgba(255,255,255,.14);
      border-radius:24px;
      padding:22px 24px;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.05);
    }
    #tab_sheets #sheetDetail .inspector-head{
      display:none;
    }
    #tab_sheets #sheetDetail .inspector-title{
      font-size:1.25rem;
      font-weight:950;
    }
    #tab_sheets #sheetDetail .inspector-sub{
      font-size:.82rem;
      opacity:.78;
    }
    #tab_sheets #sheetDetail .ficha-v2 .sheet-art{
      width:140px;
      height:140px;
      padding:4px;
    }
    #tab_sheets #sheetDetail .ficha-v2 .sheet-name{
      font-size:42px;
      line-height:1;
    }
    #tab_sheets #sheetDetail .ficha-v2 .sheet-sub{
      font-size:26px;
    }
    #tab_sheets #sheetDetail .ficha-v2 .type-pill,
    #tab_sheets #sheetDetail .ficha-v2 .chip{
      font-size:15px;
      padding:5px 12px;
      border-width:1px;
    }
    #tab_sheets #sheetDetail .ficha-v2 .hp-row{
      font-size:22px;
      margin:10px 0 6px;
    }
    #tab_sheets #sheetDetail .ficha-v2 .hp-track{
      height:12px;
    }
    #tab_sheets #sheetDetail .ficha-v2 .stat-grid{
      gap:10px;
      margin:14px 0;
    }
    #tab_sheets #sheetDetail .ficha-v2 .stat-box{
      padding:12px 6px;
      border-radius:14px;
    }
    #tab_sheets #sheetDetail .ficha-v2 .stat-label{
      font-size:13px;
    }
    #tab_sheets #sheetDetail .ficha-v2 .stat-val{
      font-size:30px;
    }
    #tab_sheets #sheetDetail .ficha-v2 .section-title{
      font-size:20px;
      margin:14px 0 10px;
    }
    #tab_sheets #sheetDetail .ficha-v2 .move-expander{
      margin-bottom:10px;
      border-radius:14px;
    }
    #tab_sheets #sheetDetail .ficha-v2 .move-header{
      padding:12px 14px;
      gap:8px;
    }
    #tab_sheets #sheetDetail .ficha-v2 .move-h-name{
      font-size:22px;
    }
    #tab_sheets #sheetDetail .ficha-v2 .mv-pill,
    #tab_sheets #sheetDetail .ficha-v2 .mv-type-pill{
      font-size:13px;
      padding:3px 10px;
      border-width:1px;
    }
    #tab_sheets #sheetDetail .ficha-v2 .move-notes-box{
      font-size:.86rem;
    }
    #tab_sheets #sheetDetail .stat-boost-grid{
      grid-template-columns:repeat(auto-fit,minmax(132px,1fr));
      gap:6px;
    }
    #tab_sheets #sheetDetail .stat-boost-row{
      grid-template-columns:minmax(42px,1fr) 28px 34px 28px;
      padding:5px 8px;
    }
    #tab_sheets #sheetDetail .stat-boost-name,
    #tab_sheets #sheetDetail .stat-boost-title,
    #tab_sheets #sheetDetail .stat-boost-val{
      font-size:12px;
    }
    .ins-conds{
      display:flex;
      flex-direction:column;
      gap:16px;
      color:rgba(226,232,240,.96);
    }
    .ins-conds-hero{
      display:flex;
      align-items:center;
      gap:14px;
      padding:14px;
      border-radius:18px;
      border:1px solid rgba(120,210,255,.16);
      background:linear-gradient(180deg, rgba(12,20,38,.92), rgba(8,14,28,.82));
      box-shadow:inset 0 1px 0 rgba(255,255,255,.05);
    }
    .ins-conds-hero-media{
      width:86px;
      height:86px;
      flex:0 0 86px;
      display:flex;
      align-items:center;
      justify-content:center;
      border-radius:20px;
      border:1px solid rgba(255,255,255,.12);
      background:radial-gradient(circle at top, rgba(56,189,248,.18), transparent 60%), rgba(15,23,42,.78);
    }
    .ins-conds-hero-media img{
      width:70px;
      height:70px;
      object-fit:contain;
      filter:drop-shadow(0 10px 18px rgba(0,0,0,.35));
    }
    .ins-conds-hero-copy{
      min-width:0;
      flex:1;
    }
    .ins-conds-title{
      font-size:1.1rem;
      font-weight:950;
      line-height:1.05;
    }
    .ins-conds-hero-sub{
      margin-top:4px;
      font-size:.82rem;
      color:rgba(148,163,184,.9);
    }
    .ins-conds-shell{
      display:grid;
      grid-template-columns:minmax(0,1.3fr) minmax(280px,.85fr);
      gap:16px;
      align-items:start;
    }
    .ins-conds-groups{
      display:grid;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:12px;
    }
    .ins-conds-card{
      display:flex;
      flex-direction:column;
      gap:10px;
      padding:12px;
      border-radius:18px;
      border:1px solid rgba(148,163,184,.14);
      background:linear-gradient(180deg, rgba(15,23,42,.78), rgba(10,16,30,.88));
      box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
    }
    .ins-conds-card.is-wide{
      grid-column:1 / -1;
    }
    .ins-conds-card-head{
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap:10px;
    }
    .ins-conds-degree{
      font-size:.76rem;
      font-weight:950;
      letter-spacing:.08em;
      text-transform:uppercase;
      color:rgba(186,230,253,.9);
    }
    .ins-conds-count{
      font-size:.72rem;
      font-weight:800;
      color:rgba(148,163,184,.88);
      white-space:nowrap;
    }
    .custom-cond-list.cond-grid{
      display:grid;
      grid-template-columns:repeat(auto-fit,minmax(170px,1fr));
      gap:8px;
      padding:4px;
      max-height:260px;
      overflow:auto;
      scrollbar-color:rgba(148,163,184,.6) rgba(15,23,42,.35);
    }
    .custom-cond-list.pkm-list.cond-grid{
      grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
    }
    .cond-item{
      width:100%;
      display:flex;
      flex-direction:column;
      align-items:flex-start;
      gap:4px;
      padding:10px 12px;
      border-radius:14px;
      border:1px solid rgba(148,163,184,.16);
      background:rgba(15,23,42,.62);
      color:rgba(226,232,240,.96);
      cursor:pointer;
      text-align:left;
      transition:border-color .16s ease, transform .16s ease, background .16s ease, box-shadow .16s ease;
    }
    .cond-item small{
      color:rgba(148,163,184,.78);
      font-size:.72rem;
      line-height:1.25;
    }
    .cond-item:hover,
    .cond-item:focus-visible{
      border-color:rgba(56,189,248,.46);
      background:rgba(10,36,58,.75);
      box-shadow:0 0 0 1px rgba(56,189,248,.18);
      transform:translateY(-1px);
      outline:none;
    }
    .cond-item.selected{
      border-color:rgba(56,189,248,.62);
      background:linear-gradient(180deg, rgba(15,51,86,.88), rgba(10,25,45,.92));
      box-shadow:0 0 0 1px rgba(56,189,248,.22), 0 12px 22px rgba(2,6,23,.28);
    }
    .cond-item.pkm-item{
      justify-content:center;
      min-height:66px;
    }
    .cond-item-name{
      font-size:.84rem;
      font-weight:850;
      line-height:1.25;
    }
    .custom-cond-list[data-disabled='true'] .cond-item{
      opacity:.88;
    }
    .ins-conds-side{
      display:flex;
      flex-direction:column;
      gap:12px;
      position:sticky;
      top:0;
    }
    .ins-conds-side-block{
      padding:12px;
      border-radius:18px;
      border:1px solid rgba(148,163,184,.14);
      background:linear-gradient(180deg, rgba(12,20,38,.82), rgba(8,14,28,.92));
      box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
    }
    .ins-conds-side-title{
      font-size:.72rem;
      font-weight:950;
      letter-spacing:.08em;
      text-transform:uppercase;
      color:rgba(148,163,184,.9);
      margin-bottom:8px;
    }
    .ins-conds-info{
      min-height:160px;
      border-radius:14px;
      border:1px solid rgba(255,255,255,.08);
      background:rgba(2,6,23,.35);
      padding:12px;
    }
    .ins-conds-info-empty{
      color:rgba(148,163,184,.9);
      line-height:1.5;
      font-size:.84rem;
    }
    .ins-conds-info-title{
      font-size:1rem;
      font-weight:950;
      margin-bottom:8px;
    }
    .ins-conds-info-copy{
      display:flex;
      flex-direction:column;
      gap:8px;
      line-height:1.45;
      font-size:.84rem;
    }
    .ins-conds-info-rule{
      color:#7dd3fc;
      font-weight:700;
    }
    .ins-conds-current{
      min-height:88px;
    }
    .ins-conds-actions{
      display:flex;
      flex-wrap:wrap;
      gap:8px;
    }
    .ins-conds-actions .btn{
      flex:1 1 150px;
    }
    @media (max-width: 1180px){
      #tab_sheets #sheetsContent{
        overflow:auto;
      }
      #tab_sheets .fichas-layout{
        grid-template-columns:1fr;
        height:auto;
      }
      #tab_sheets .sheets-column{
        height:auto;
        overflow:visible;
      }
      #tab_sheets .cards-grid{
        overflow:visible;
        padding-right:0;
        gap:10px;
      }
      #tab_sheets .sheets-column-detail{
        position:static;
      }
      #tab_sheets .sheets-column-detail .sheets-column-title{
        font-size:1.45rem;
        letter-spacing:0;
      }
      #tab_sheets #sheetDetail{
        overflow:visible;
        padding-right:0;
      }
    }
    @media (max-width: 900px){
      #tab_sheets .cards-grid{
        grid-template-columns:repeat(2, minmax(0, 1fr));
        justify-content:stretch;
      }
      #tab_sheets .sheets-column{
        padding:12px;
      }
      .ins-conds-shell{
        grid-template-columns:1fr;
      }
      .ins-conds-groups{
        grid-template-columns:1fr;
      }
      .ins-conds-side{
        position:static;
      }
      .custom-cond-list.cond-grid{
        max-height:190px;
        grid-template-columns:1fr;
      }
      .custom-cond-list.pkm-list.cond-grid{
        grid-template-columns:repeat(auto-fit,minmax(132px,1fr));
      }
      .ins-conds-hero{
        align-items:flex-start;
      }
    }
    @media (max-width: 640px){
      #tab_sheets .cards-grid{
        grid-template-columns:1fr;
      }
      #tab_sheets .poke-card{
        min-height:0;
      }
    }
    `;
    document.head.appendChild(stOverrides);
  }
}

function ensureSheetsUI() {
  const root = $("tab_sheets");
  if (!root) return false;

  // já existe?
  if (
    root.querySelector("#cardsGrid") &&
    root.querySelector("#sheetDetail") &&
    root.querySelector("#sheetsLoading") &&
    root.querySelector(".sheets-column-list") &&
    root.querySelector(".sheets-column-detail")
  ) {
    _injectSheetsStyleOnce();
    return true;
  }

  _injectSheetsStyleOnce();

  // UI mínima (idempotente)
  root.innerHTML = `
    <div class="sheets-status-bar">
      <span class="pill mono" id="ridBadgeSheets">sala: —</span>
      <span class="pill mono" id="phaseBadgeSheets">idle</span>
      <span class="pill" id="syncBadgeSheets">—</span>
      <span class="pill mono" id="meBadgeSheets">by: —</span>
    </div>

    <div class="row spread" style="align-items:center; margin-bottom: 12px;">
      <div style="font-weight: 950; font-size: 1.05rem;">📋 Fichas</div>
      <span class="pill mono" id="sheetsCount">0</span>
    </div>

    <div id="sheetsLoading" style="padding: 24px 0; text-align:center; opacity:.8;">
      <div class="spinner"></div>
      <div style="margin-top:10px;">Conecte numa sala para ver as fichas da sua party.</div>
    </div>

    <div id="sheetsContent" style="display:none;">
      <div class="fichas-layout">
        <section class="sheets-column sheets-column-list" aria-label="Todas as fichas">
          <div class="sheets-column-head">
            <div class="sheets-column-title">Todas as fichas</div>
            <div class="sheets-column-sub">Escolha um pokémon na lista para abrir a ficha completa na coluna ao lado.</div>
          </div>
          <div class="cards-grid" id="cardsGrid"></div>
        </section>
        <section class="sheets-column sheets-column-detail" id="sheetDetailWrap" style="display:none;" aria-label="Ficha completa">
          <div class="sheets-column-head">
            <div class="sheets-column-title">Ficha completa</div>
            <div class="sheets-column-sub" id="sheetDetailHint">Selecione uma ficha da lista.</div>
          </div>
          <div id="sheetDetail">
            <div class="sheets-empty">Selecione um card.</div>
          </div>
        </section>
      </div>
    </div>

    <div id="sheetsError" style="display:none; margin-top: 12px; color: #ef4444; font-weight: 800;"></div>
  `;
  return true;
}

function teardownSheetsRealtime() {
  try { if (_sheetsUnsub) _sheetsUnsub(); } catch {}
  try { if (_partyStatesUnsub) _partyStatesUnsub(); } catch {}
  try { if (_trainerRpgSheetUnsub) _trainerRpgSheetUnsub(); } catch {}
  _sheetsUnsub = null;
  _partyStatesUnsub = null;
  _trainerRpgSheetUnsub = null;
  _sheetsRtKey = null;
  _trainerRpgSheetRtKey = null;

  _allSheetsLatest = [];
  _allSheetsCollections = _buildSheetCollections([]);
  _partyStates = {};
  try { window._partyStates = _partyStates; } catch {}
  _partyStatesBootstrapped = false;
  _megaEvolutionFx.clear();
  _sheetsSelectedPid = null;
  _sheetsLastError = "";
  appState.selfTrainerRpgSheet = null;
}

function ensureSelfTrainerRpgSheetRealtime() {
  const db = currentDb;
  const by = safeStr(appState.by);
  if (!appState.connected || !db || !by) {
    try { if (_trainerRpgSheetUnsub) _trainerRpgSheetUnsub(); } catch {}
    _trainerRpgSheetUnsub = null;
    _trainerRpgSheetRtKey = null;
    appState.selfTrainerRpgSheet = null;
    return;
  }

  const uid = safeDocId(by);
  const key = uid;
  if (_trainerRpgSheetRtKey === key && _trainerRpgSheetUnsub) return;

  try { if (_trainerRpgSheetUnsub) _trainerRpgSheetUnsub(); } catch {}
  _trainerRpgSheetUnsub = null;
  _trainerRpgSheetRtKey = key;

  try {
    const rpgSheetDoc = doc(db, "trainers", uid, "profile", "rpg_sheet");
    _trainerRpgSheetUnsub = onSnapshot(rpgSheetDoc, (snap) => {
      appState.selfTrainerRpgSheet = snap.exists()
        ? normalizeTrainerRpgSheet(snap.data() || {}, by)
        : null;
      try { updateSidePanels(); } catch {}
    }, () => {
      appState.selfTrainerRpgSheet = null;
      try { updateSidePanels(); } catch {}
    });
  } catch {
    appState.selfTrainerRpgSheet = null;
  }
}

function ensureSheetsRealtime() {
  // só monta se existir tab_sheets na página
  if (!$("tab_sheets")) return;

  const db = currentDb;
  const rid = currentRid;
  const by = safeStr(appState.by);

  if (!appState.connected || !db || !rid || !by) {
    teardownSheetsRealtime();
    renderSheetsTab(); // limpa UI se existir
    return;
  }

  const uid = safeDocId(by);
  const key = `${rid}::${uid}`;
  if (_sheetsRtKey === key) {
    try { ensureSelfTrainerRpgSheetRealtime(); } catch {}
    return;
  }

  teardownSheetsRealtime();
  ensureSheetsUI();
  _sheetsRtKey = key;
  try { ensureSelfTrainerRpgSheetRealtime(); } catch {}

  // party_states (HP/cond) — opcional
  try {
    const psDoc = doc(db, "rooms", rid, "public_state", "party_states");
    _partyStatesUnsub = onSnapshot(psDoc, (snap) => {
      const nextPartyStates = snap.exists() ? (snap.data() || {}) : {};
      if (_partyStatesBootstrapped) {
        _detectMegaEvolutionTransitions(_partyStates, nextPartyStates);
      } else {
        _partyStatesBootstrapped = true;
      }
      _partyStates = nextPartyStates;
      try { window._partyStates = _partyStates; } catch {}
      try { autoLogPartyStatesDiff(nextPartyStates); } catch {}
      _trimMegaEvolutionFx();
      renderSheetsTab();
      try { updateSidePanels(); } catch {}
      try { window.requestScoreboardRefresh?.(); } catch {}
      try { requestArenaRefresh(true); } catch {}
    }, () => {});
  } catch {}

  // trainers/{uid}/sheets — realtime
  try {
    const q = query(
      collection(db, "trainers", uid, "sheets"),
      orderBy("updated_at", "desc"),
      limit(200),
    );

    _sheetsUnsub = onSnapshot(q, (qs) => {
      const all = [];
      qs.forEach((d) => {
        const x = d.data() || {};
        x._sheet_id = d.id;
        all.push(x);
      });
      _allSheetsLatest = all;
      _allSheetsCollections = _buildSheetCollections(all);
      _sheetsLastError = "";
      renderSheetsTab();
    }, (err) => {
      _sheetsLastError = err?.message || String(err);
      renderSheetsTab();
    });
  } catch (e) {
    _sheetsLastError = e?.message || String(e);
    renderSheetsTab();
  }
}

// ---- helpers visuais/matemática de golpes (espelha app.py/_mv_summary)
const _TYPE_COLORS = TYPE_COLORS_DATA;
const _tc = (t) => getTypeColor(safeStr(t));
function _typeBg(types) {
  if (!types || !types.length) return "";
  return types.length === 1 ? _tc(types[0]) : `linear-gradient(135deg,${_tc(types[0])},${_tc(types[1])})`;
}

// Retorna cor hex do tipo do golpe (pelo nome)
function _moveTypeColor(moveName) {
  const t = getMoveType(safeStr(moveName));
  return t ? getTypeColor(t) : "";
}

// Checa se golpe é STAB (mesmo tipo que o pokémon)
function _isMoveStab(moveName, pokemonTypes) {
  const moveType = getMoveType(safeStr(moveName));
  if (!moveType || !pokemonTypes || !pokemonTypes.length) return false;
  const mt = normalizeType(moveType);
  return pokemonTypes.some(pt => normalizeType(pt) === mt);
}

// Renderiza pill de tipo colorida
function _typePill(type) {
  const c = _tc(type);
  return `<span class="type-pill" style="background:${c}33;border:1px solid ${c}66;color:${c};padding:2px 7px;border-radius:8px;font-size:.72rem;font-weight:700;">${escapeHtml(type)}</span>`;
}

// Tabela moderna de fraquezas/resistências de um pokémon (por seus tipos)
function _typeMatchupHtml(types) {
  if (!types || !types.length) return "";
  const normalizedTypes = types.map(t => normalizeType(t)).filter(Boolean);
  if (!normalizedTypes.length) return "";

  const groups = {
    4:    { label: "Fraqueza 4×",    bonus: "+4", icon: "💀", bg: "rgba(239,68,68,.14)",   border: "rgba(239,68,68,.50)",   text: "#f87171", types: [] },
    2:    { label: "Fraqueza 2×",    bonus: "+2", icon: "⚠️",  bg: "rgba(251,146,60,.12)",  border: "rgba(251,146,60,.45)",  text: "#fb923c", types: [] },
    0.5:  { label: "Resistência ½",  bonus: "−2", icon: "🛡",  bg: "rgba(74,222,128,.10)",  border: "rgba(74,222,128,.40)",  text: "#4ade80", types: [] },
    0.25: { label: "Resistência ¼",  bonus: "−4", icon: "🛡🛡", bg: "rgba(34,197,94,.12)",   border: "rgba(34,197,94,.50)",   text: "#22c55e", types: [] },
    0:    { label: "Imunidade 0×",   bonus: "−6", icon: "🚫",  bg: "rgba(100,116,139,.12)", border: "rgba(100,116,139,.40)", text: "#94a3b8", types: [] },
  };

  Object.keys(TYPE_CHART).forEach((atkType) => {
    const mult = getTypeAdvantage(atkType, normalizedTypes);
    if (mult === 0)         groups[0].types.push(atkType);
    else if (mult >= 4)     groups[4].types.push(atkType);
    else if (mult >= 2)     groups[2].types.push(atkType);
    else if (mult <= 0.25)  groups[0.25].types.push(atkType);
    else if (mult < 1)      groups[0.5].types.push(atkType);
  });

  const rows = [4, 2, 0.5, 0.25, 0].map(key => {
    const g = groups[key];
    if (!g.types.length) return "";
    const pills = g.types.map(t => {
      const c = getTypeColor(t);
      return `<span class="tmt-pill" style="background:${c}28;border:1px solid ${c}55;color:${c}">${t}</span>`;
    }).join("");
    return `
      <div class="tmt-row" style="background:${g.bg};border-left:3px solid ${g.border};">
        <div class="tmt-row-head">
          <span class="tmt-icon">${g.icon}</span>
          <span class="tmt-label" style="color:${g.text}">${g.label}</span>
          <span class="tmt-bonus" style="background:${g.border};color:#0a0f1e">${g.bonus}</span>
        </div>
        <div class="tmt-pills">${pills}</div>
      </div>`;
  }).filter(Boolean).join("");

  const hasAny = rows.length > 0;
  return `
    <div class="type-matchup-table">
      <div class="tmt-header">⚔️ Fraquezas &amp; Resistências</div>
      ${hasAny ? rows : `<div class="tmt-empty">Nenhuma fraqueza ou resistência especial.</div>`}
    </div>`;
}



// Tabela de ofensiva: tipos que o pokémon acerta super efetivo (considerando STAB pelos próprios tipos)
function _typeOffenseHtml(types) {
  if (!types || !types.length) return "";
  const atkTypes = Array.from(new Set(types.map(t => normalizeType(t)).filter(Boolean)));
  if (!atkTypes.length) return "";

  const rows = atkTypes.map(atk => {
    const se = (getSuperEffectiveAgainst(atk) || []).map(t => normalizeType(t)).filter(Boolean);
    if (!se.length) return "";
    const pills = se.map(t => {
      const c = getTypeColor(t);
      return `<span class="tmt-pill" style="background:${c}28;border:1px solid ${c}55;color:${c}">${t}</span>`;
    }).join("");
    const cAtk = getTypeColor(atk);
    return `
      <div class="tmt-row" style="background:${cAtk}12;border-left:3px solid ${cAtk}55;">
        <div class="tmt-row-head">
          <span class="tmt-icon">🎯</span>
          <span class="tmt-label" style="color:${cAtk}">${atk} (STAB)</span>
          <span class="tmt-bonus" style="background:${cAtk}55;color:#0a0f1e">2×</span>
        </div>
        <div class="tmt-pills">${pills}</div>
      </div>`;
  }).filter(Boolean).join("");

  if (!rows) return "";

  return `
    <div class="type-matchup-table type-offense-table">
      <div class="tmt-header">🎯 Superefetivo (por tipo)</div>
      ${rows}
    </div>`;
}

// Gera estilos de fundo para fichas baseado nos tipos (diagonal para 2 tipos)
function _fichaTypeBg(types) {
  if (!types || !types.length) return "";
  const c1 = _tc(types[0]);
  if (types.length === 1) {
    return `background: linear-gradient(180deg, ${c1}18 0%, ${c1}08 40%, transparent 70%); border: 1px solid ${c1}33;`;
  }
  const c2 = _tc(types[1]);
  return `background: linear-gradient(135deg, ${c1}22 0%, ${c1}12 49%, ${c2}12 51%, ${c2}22 100%); border-left: 2px solid ${c1}55; border-right: 2px solid ${c2}55; border-top: 1px solid rgba(255,255,255,.08); border-bottom: 1px solid rgba(255,255,255,.08);`;
}

function _mvInferBasedFromText(...texts) {
  const blob = texts.map((txt) => safeStr(txt).toLowerCase()).join(" ").trim();
  if (!blob) return "";
  if (blob.includes("status")) return "—";
  const intTokens = [
    "intelect based", "intellect based", "int based",
    "special-based", "special based", "especial", "special",
    "intelect", "intellect"
  ];
  const stgrTokens = [
    "stgr based", "strength based", "strength-based",
    "physical-based", "physical based", "fisico", "physical",
    "stgr", "strength"
  ];
  if (intTokens.some((token) => blob.includes(token))) return "Int";
  if (stgrTokens.some((token) => blob.includes(token))) return "Stgr";
  return "";
}
function _mvStat(mvOrMeta, stats) {
  const mv = (mvOrMeta && typeof mvOrMeta === "object" && (
    "meta" in mvOrMeta || "build" in mvOrMeta || "description" in mvOrMeta || "desc" in mvOrMeta || "name" in mvOrMeta
  )) ? mvOrMeta : { meta: mvOrMeta || {} };
  const meta = (mv && typeof mv === "object" && mv.meta && typeof mv.meta === "object") ? mv.meta : (mvOrMeta || {});
  stats = stats || {};
  const override = safeStr(meta.based_stat_override || meta.basedStatOverride || "");
  const cat = safeStr(meta.category || meta.categoria || mv?.category || mv?.categoria || "").toLowerCase();
  let label = "";
  if (override === "Stgr" || override === "Int" || override === "—") label = override;
  else if (meta.is_special === true) label = "Int";
  else if (meta.is_special === false) label = "Stgr";
  else if (cat.includes("status")) label = "—";
  else if (cat.includes("special") || cat.includes("especial")) label = "Int";
  else if (cat.includes("physical") || cat.includes("físic") || cat.includes("fisic")) label = "Stgr";
  else {
    label = _mvInferBasedFromText(
      mv?.name,
      mv?.build,
      mv?.description,
      mv?.desc,
      meta.raw_power_name,
      meta.category,
    ) || "";
  }
  const val = label === "Stgr"
    ? (parseInt(stats.stgr || 0) || 0)
    : (label === "Int" ? (parseInt(stats["int"] || 0) || 0) : 0);
  return { label: label || "—", val };
}
function _moveRawAccuracy(mv) {
  return parseInt(mv?.accuracy || mv?.Accuracy || mv?.acerto || 0) || 0;
}
function _moveAreaInfo(mv) {
  const meta = (mv && typeof mv === "object" && mv.meta && typeof mv.meta === "object") ? mv.meta : {};
  const buildText = safeStr(mv?.build).toLowerCase();
  const areaTypeRaw = safeStr(meta.area_type || meta.areaType || "");
  const areaType = areaTypeRaw && areaTypeRaw !== "—" ? areaTypeRaw : "";
  const areaExtended = !!(meta.area_extended || meta.areaExtended);
  const perceptionArea = !!meta.perception_area;
  const isArea = !!(
    perceptionArea
    || areaType
    || meta.is_area
    || meta.area
    || buildText.includes("[area:")
    || buildText.includes("perception area")
    || buildText.includes("área")
    || buildText.includes("area")
    || buildText.includes("aoe")
  );
  return { isArea, areaType, areaExtended, perceptionArea };
}
function _formatMoveAreaLabel(areaInfo, { compact = false } = {}) {
  const info = areaInfo || {};
  if (!info.isArea) return compact ? "Acerto" : "Acerto";
  const baseLabel = info.areaType
    ? `Área: ${info.areaType}`
    : (info.perceptionArea ? (compact ? "Percepção" : "Área de Percepção") : "Área");
  const extras = [];
  if (info.areaExtended) extras.push("+1r");
  if (!compact && info.perceptionArea && info.areaType) extras.push("Percepção");
  return extras.length ? `${baseLabel} ${extras.join(" • ")}` : baseLabel;
}
function _getMoveModeInfo(mv) {
  const meta = (mv && typeof mv === "object" && mv.meta && typeof mv.meta === "object") ? mv.meta : {};
  const acc = _moveRawAccuracy(mv);
  if (meta.affects_user) {
    return {
      kind: "self",
      label: "Afeta o Usuário",
      compactLabel: "Usuário",
      pillClass: "self",
      style: "background:rgba(192,132,252,.14);border:1px solid rgba(192,132,252,.38);color:#c084fc;",
      value: "Afeta o Usuário",
    };
  }
  const areaInfo = _moveAreaInfo(mv);
  if (areaInfo.isArea) {
    return {
      kind: "area",
      label: _formatMoveAreaLabel(areaInfo),
      compactLabel: _formatMoveAreaLabel(areaInfo, { compact: true }),
      pillClass: "area",
      style: "",
      value: _formatMoveAreaLabel(areaInfo),
    };
  }
  return {
    kind: "accuracy",
    label: `Acerto ${acc}`,
    compactLabel: `Ac ${acc}`,
    pillClass: "acc",
    style: "",
    value: String(acc),
  };
}
function _renderMoveModePill(mv, options = {}) {
  const info = _getMoveModeInfo(mv);
  const label = options.compact ? (info.compactLabel || info.label) : info.label;
  return `<span class="mv-pill ${escapeAttr(info.pillClass || "")}"${info.style ? ` style="${escapeAttr(info.style)}"` : ""} title="${escapeAttr(info.label)}">${escapeHtml(label)}</span>`;
}
function _mvIsArea(mv) {
  return _moveAreaInfo(mv).isArea;
}
function _mvSum(mv, stats) {
  const br = parseInt(mv?.rank || mv?.Rank || 0) || 0;
  const acc = _moveRawAccuracy(mv);
  const { label, val } = _mvStat(mv, stats);
  return { rk: br + val, acc, label, val, area: _mvIsArea(mv), br };
}

function _spriteUrlFromPidForSheets(pid) {
  try { return getSpriteUrlFromPid(pid) || ""; } catch { return ""; }
}

function _artUrlFromPidForSheets(pid, shiny) {
  const k = safeStr(pid);
  if (!k) return "";
  const isShiny = !!shiny;
  if (k.startsWith("EXT:")) {
    const nm = safeStr(k.slice(4));
    if (!nm) return "";
    const slug = (typeof spriteSlugFromPokemonName === "function") ? spriteSlugFromPokemonName(nm) : slugifyPokemonName(nm);
    return slug
      ? localSpriteUrl(slug, "art", isShiny) || `https://img.pokemondb.net/artwork/large/${slug}.jpg`
      : "";
  }
  const nm = (typeof resolvePokemonNameFromPid === "function") ? resolvePokemonNameFromPid(k) : "";
  if (nm) {
    const slug = (typeof spriteSlugFromPokemonName === "function") ? spriteSlugFromPokemonName(nm) : slugifyPokemonName(nm);
    if (slug) return localSpriteUrl(slug, "art", isShiny) || `https://img.pokemondb.net/artwork/large/${slug}.jpg`;
  }
  if (!/^\d+$/.test(k)) {
    const slug = (typeof spriteSlugFromPokemonName === "function") ? spriteSlugFromPokemonName(k) : slugifyPokemonName(k);
    if (slug) return localSpriteUrl(slug, "art", isShiny) || `https://img.pokemondb.net/artwork/large/${slug}.jpg`;
  }
  if (/^\d+$/.test(k)) {
    const n = Number(k);
    if (Number.isFinite(n) && n > 0 && n < 20000) {
      return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${n}.png`;
    }
  }
  return "";
}

function _sheetLookupCandidates(sh, fallbackPid) {
  const out = [];
  const push = (value) => {
    const key = safePidValue(value);
    if (!key || out.includes(key)) return;
    out.push(key);
  };
  const pushFallback = (value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      push(value?.pid);
      push(value?.pokemon?.id);
      push(value?.pokemon?.name);
      push(value?.name);
      return;
    }
    push(value);
  };
  push(sh?.pokemon?.id);
  push(sh?.linked_pid);
  pushFallback(fallbackPid);
  push(sh?.pokemon?.name);
  return out;
}

function _sheetLookupKeys(sh, fallbackPid) {
  const out = [];
  for (const candidate of _sheetLookupCandidates(sh, fallbackPid)) {
    _pushPartyLookupKey(out, candidate);
  }
  return out;
}

function _sheetMatchesPid(sh, pidLike, fallbackPid, options = {}) {
  const entryTarget = _getEntryId(fallbackPid);
  const entryCandidate = _getEntryId(pidLike);
  if (entryTarget && entryCandidate) return entryCandidate === entryTarget;

  const slotTarget = _getPartySlot(fallbackPid || pidLike);
  const slotCandidate = _getPartySlot(pidLike);
  if (slotTarget) {
    if (slotCandidate) return slotCandidate === slotTarget;
    if (!options.allowSlotlessFallback) return false;
  }
  if (entryTarget && !options.allowSlotlessFallback) return false;

  const targetKeys = _partyEntryLookupKeys(pidLike);
  if (!targetKeys.length) return false;
  const sheetKeys = _sheetLookupKeys(sh, fallbackPid);
  return sheetKeys.some((key) => targetKeys.includes(key));
}

function findBoardPieceForSheet(ownerName, sh, fallbackPid, options = {}) {
  const pieces = _activeOwnerPieces(ownerName, options);
  if (!sh || !pieces.length) return null;

  const strict = pieces.find((piece) => _sheetMatchesPid(sh, piece, fallbackPid));
  if (strict) return strict;

  // Compatibilidade com peças antigas criadas antes de salvar party_slot/entry_id.
  // Só aceita esse fallback quando há uma única peça possível, evitando confundir duplicatas.
  if (_getPartySlot(fallbackPid) || _getEntryId(fallbackPid)) {
    const slotlessMatches = pieces.filter((piece) => {
      if (_getPartySlot(piece) || _getEntryId(piece)) return false;
      return _sheetMatchesPid(sh, piece, fallbackPid, { allowSlotlessFallback: true });
    });
    if (slotlessMatches.length === 1) return slotlessMatches[0];
  }

  return null;
}

function _sheetStateCandidates(sh, fallbackPid) {
  const out = [];
  const push = (value) => {
    const key = safePidValue(value);
    if (!key || out.includes(key)) return;
    out.push(key);
  };
  if (fallbackPid && typeof fallbackPid === "object" && !Array.isArray(fallbackPid)) {
    push(_getEntryId(fallbackPid));
    push(_getPartySlot(fallbackPid));
    push(fallbackPid?.pid);
    push(fallbackPid?.pokemon?.id);
    push(fallbackPid?.pokemon?.name);
    push(fallbackPid?.name);
  } else {
    push(fallbackPid);
  }
  push(sh?.linked_pid);
  push(sh?.pokemon?.id);
  push(sh?.pokemon?.name);
  return out;
}

function _mergePartyStateEntry(base, entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return base || {};
  const next = { ...(base || {}), ...entry };
  const baseBoosts = (base?.stat_boosts && typeof base.stat_boosts === "object" && !Array.isArray(base.stat_boosts)) ? base.stat_boosts : {};
  const entryBoosts = (entry?.stat_boosts && typeof entry.stat_boosts === "object" && !Array.isArray(entry.stat_boosts)) ? entry.stat_boosts : {};
  const entryHasBoosts = Object.prototype.hasOwnProperty.call(entry, "stat_boosts");
  if (entryHasBoosts && entry.stat_boosts == null) {
    next.stat_boosts = null;
  } else if (Object.keys(baseBoosts).length || Object.keys(entryBoosts).length) {
    next.stat_boosts = { ...baseBoosts, ...entryBoosts };
  }
  return next;
}

function _sheetResolvedPid(sh, fallbackPid) {
  const candidates = _sheetLookupCandidates(sh, fallbackPid);
  return candidates.find((key) => key !== "0") || candidates[0] || "";
}

function _sheetDisplayPid(sh, fallbackPid) {
  const direct = safePidValue(sh?.pokemon?.id);
  if (direct && direct !== "0") return direct;
  const resolved = _sheetResolvedPid(sh, fallbackPid);
  return /^\d+$/.test(resolved) && resolved !== "0" ? resolved : "";
}

function _getPartyStateForSheet(ownerName, sh, fallbackPid) {
  const stateBucket = _getPartyStateBucket(ownerName) || {};
  const fallbackKey = (fallbackPid && typeof fallbackPid === "object")
    ? (fallbackPid.pid ?? fallbackPid.pokemon?.id ?? fallbackPid.name)
    : fallbackPid;
  let roomState = _getRoomPartyStateEntry(ownerName, fallbackPid || fallbackKey) || {};
  for (const key of _sheetStateCandidates(sh, fallbackPid || fallbackKey)) {
    if (Object.prototype.hasOwnProperty.call(stateBucket, key)) {
      roomState = _mergePartyStateEntry(roomState, stateBucket[key]);
    }
  }
  const globalTarget = _getPartyEntryForTrainerPid(ownerName, fallbackPid)
    || _getPartyEntryForTrainerPid(ownerName, fallbackKey)
    || fallbackPid
    || fallbackKey
    || sh?.linked_pid
    || sh?.pokemon?.id
    || sh?.pokemon?.name;
  const globalPayload = _getGlobalEntryHpPayload(ownerName, globalTarget);
  const hp = _resolveHpValue(roomState, globalPayload);
  if (hp != null) return { ...roomState, hp };
  return roomState;
}

function _buildSelfSheetEntries(ownerName = safeStr(appState.by)) {
  const party = getPartyForTrainer(ownerName) || [];
  const partyPids = party.map((it) => safePidValue(it?.pid ?? it?.pokemon?.id ?? it)).filter(Boolean);
  const entries = [];
  for (const partyEntry of party) {
    const rawPid = safePidValue(partyEntry?.pid ?? partyEntry?.pokemon?.id ?? partyEntry);
    const basePid = safePidValue(rawPid);
    if (!basePid) continue;
    const partySlot = _getPartySlot(partyEntry);
    const selectionId = partySlot || `${basePid}::${entries.length}`;
    const resolved = _resolveSelfEffectiveSheet(partyEntry, ownerName);
    if (!resolved?.baseSheet) continue;
    entries.push({
      _selection_id: selectionId,
      _base_pid: basePid,
      _party_pid_raw: rawPid,
      _party_slot: partySlot,
      _party_entry: partyEntry,
      baseSheet: resolved.baseSheet,
      effectiveSheet: resolved.effectiveSheet || resolved.baseSheet,
      megaSheets: Array.isArray(resolved.megaSheets) ? resolved.megaSheets : [],
      activeMegaSlug: safeStr(resolved.activeMegaSlug),
      megaState: resolved.megaState || null,
    });
  }
  return { party, partyPids, entries };
}

function _sheetMegaLabel(sheet) {
  return safeStr(sheet?.mega_label || sheet?.pokemon?.name || sheet?.mega_slug) || "Mega Evolucao";
}

function _getUniqueMegaSheets(list) {
  const seen = new Set();
  const out = [];
  for (const sheet of (Array.isArray(list) ? list : [])) {
    const key = safeStr(sheet?.mega_slug || sheet?.pokemon?.name || _sheetDocId(sheet)).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(sheet);
  }
  return out;
}

function _renderMegaControlsHtml(ownerName, basePid, entry, options = {}) {
  const megaSheets = _getUniqueMegaSheets(entry?.megaSheets);
  const activeSlug = safeStr(entry?.activeMegaSlug).toLowerCase();
  const sectionTitle = safeStr(options.title || "Mega Evolucao");
  if (!megaSheets.length) {
    const baseSheet = entry?.baseSheet || entry?.effectiveSheet;
    if (!baseSheet?.mega_available) return "";
    return `
      <div class="sheet-divider"></div>
      <div class="section-title">${escapeHtml(sectionTitle)}</div>
      <div class="muted">Este Pokemon pode mega evoluir, mas a ficha Mega ainda nao foi criada no Ga'Al Dex.</div>
    `;
  }
  const buttons = megaSheets.map((sheet) => {
    const slug = safeStr(sheet?.mega_slug);
    const label = _sheetMegaLabel(sheet);
    const active = slug && activeSlug === slug.toLowerCase();
    return `
      <button type="button" class="btn ${active ? "primary" : "secondary"}"
        data-mega-act="toggle"
        data-owner="${escapeAttr(ownerName)}"
        data-pid="${escapeAttr(basePid)}"
        data-mega-active="${active ? "1" : "0"}"
        data-mega-slug="${escapeAttr(slug)}">
        ${active ? `Cancelar Mega Evolucao: ${escapeHtml(label)}` : `Mega Evoluir: ${escapeHtml(label)}`}
      </button>
    `;
  }).join("");
  return `
    <div class="sheet-divider"></div>
    <div class="section-title">${escapeHtml(sectionTitle)}</div>
    <div class="chip-row" data-mega-controls>
      ${buttons}
    </div>
  `;
}

function getHpUiState(rawHp) {
  const value = Math.max(0, Math.min(6, Number(rawHp) || 0));
  if (value >= 5) {
    return { value, pct: (value / 6) * 100, color: "#22c55e", icon: "💚", tone: "full" };
  }
  if (value >= 3) {
    return { value, pct: (value / 6) * 100, color: "#f59e0b", icon: "🟡", tone: "mid" };
  }
  if (value >= 1) {
    return { value, pct: (value / 6) * 100, color: "#ef4444", icon: "🔴", tone: "low" };
  }
  return { value, pct: 0, color: "#64748b", icon: "💀", tone: "ko" };
}

async function setBattleMegaEvolutionForTrainerPid(ownerName, pidLike, megaSlug = "") {
  const db = currentDb;
  const rid = currentRid;
  const trainer = safeStr(ownerName);
  const basePid = safePidValue(pidLike);
  if (!db || !rid || !trainer || !basePid) return;
  const ref = doc(db, "rooms", rid, "public_state", "party_states");
  const resolved = _resolveSelfEffectiveSheet(basePid, trainer);
  const megaSheets = _getUniqueMegaSheets(resolved?.megaSheets);
  const targetSlug = safeStr(megaSlug);
  const patch = {};
  if (targetSlug) {
    const megaSheet = megaSheets.find((sheet) => safeStr(sheet?.mega_slug) === targetSlug);
    if (!megaSheet) {
      setStatus("err", "Ficha Mega nao encontrada para este Pokemon.");
      return;
    }
    patch.active_mega_slug = targetSlug;
    patch.effective_sheet_id = _sheetDocId(megaSheet) || null;
    patch.effective_sheet_kind = "mega";
    patch.effective_pokemon = megaSheet?.pokemon || null;
    patch.effective_np = megaSheet?.np ?? megaSheet?.pokemon?.np ?? megaSheet?.pokemon?.NP ?? null;
    setStatus("ok", `${displayNameFromPid(basePid, { owner: trainer })}: Mega Evolucao ativada.`);
    const megaApiSlug = _normalizePokeApiSlug(
      (typeof spriteSlugFromPokemonName === "function" ? spriteSlugFromPokemonName(megaSheet?.pokemon?.name || "") : "")
      || megaSheet?.pokemon?.name
      || targetSlug
    );
    if (megaApiSlug) fetchPokeApiData(megaApiSlug);
  } else {
    patch.active_mega_slug = null;
    patch.effective_sheet_id = null;
    patch.effective_sheet_kind = null;
    patch.effective_pokemon = null;
    patch.effective_np = null;
    setStatus("ok", `${displayNameFromPid(basePid, { owner: trainer })}: Mega Evolucao cancelada.`);
  }
  await setDoc(ref, {
    [trainer]: { [basePid]: patch },
    updated_at: serverTimestamp(),
  }, { merge: true });
  if (targetSlug) triggerMegaEvolutionFx(trainer, basePid);
}

function _bindMegaControlButtons(root) {
  if (!root) return;
  root.querySelectorAll("[data-mega-act=\"toggle\"]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const shouldCancel = safeStr(btn.dataset.megaActive) === "1";
        await setBattleMegaEvolutionForTrainerPid(
          btn.dataset.owner,
          btn.dataset.pid,
          shouldCancel ? "" : btn.dataset.megaSlug
        );
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function _setSheetsBadges() {
  const rid = safeStr(appState.rid) || "—";
  const by = safeStr(appState.by) || "—";
  const phase = safeStr(appState.battle?.status) || "idle";

  const ridEl = document.getElementById("ridBadgeSheets");
  const meEl = document.getElementById("meBadgeSheets");
  const phEl = document.getElementById("phaseBadgeSheets");
  const syncEl = document.getElementById("syncBadgeSheets");

  if (ridEl) ridEl.textContent = `Sala: ${rid}`;
  if (meEl) meEl.textContent = `Jogador: ${by}`;
  if (phEl) phEl.textContent = battlePhaseLabel(phase);

  if (syncEl) {
    const ok = !!appState.connected;
    syncEl.textContent = ok ? "Sincronizado ✓" : "—";
    syncEl.className = ok ? "pill ok" : "pill";
  }
}

function renderSheetsTab() {
  const root = $("tab_sheets");
  if (!root) return;
  const maxVisibleSheets = 8;

  ensureSheetsUI();
  _setSheetsBadges();

  const loadingEl = document.getElementById("sheetsLoading");
  const contentEl = document.getElementById("sheetsContent");
  const cardsGrid = document.getElementById("cardsGrid");
  const detailEl = document.getElementById("sheetDetail");
  const detailWrap = document.getElementById("sheetDetailWrap");
  const layoutEl = root.querySelector(".fichas-layout");
  const detailHintEl = document.getElementById("sheetDetailHint");
  const countEl = document.getElementById("sheetsCount");
  const errEl = document.getElementById("sheetsError");

  if (!cardsGrid || !detailEl || !loadingEl || !contentEl || !detailWrap) return;
  if (detailHintEl) detailHintEl.textContent = "Selecione uma ficha da lista.";
  const setSheetsLayoutState = (count, hasDetail) => {
    const safeCount = Math.max(0, safeInt(count, 0));
    cardsGrid.dataset.count = String(safeCount);
    cardsGrid.style.removeProperty("--cards-columns");
    if (layoutEl) layoutEl.dataset.hasDetail = hasDetail ? "1" : "0";
  };

  if (errEl) {
    if (_sheetsLastError) {
      errEl.style.display = "";
      errEl.textContent = `Erro carregando fichas: ${_sheetsLastError}`;
    } else {
      errEl.style.display = "none";
      errEl.textContent = "";
    }
  }

  if (!appState.connected || !currentDb || !currentRid) {
    _sheetsRenderedDetailPid = null;
    if (countEl) countEl.textContent = "0";
    loadingEl.style.display = "";
    contentEl.style.display = "none";
    detailWrap.style.display = "none";
    setSheetsLayoutState(0, false);
    cardsGrid.innerHTML = "";
    detailEl.innerHTML = `<div class="sheets-empty">Conecte numa sala para ver as fichas.</div>`;
    return;
  }

  const by = safeStr(appState.by);
  if (!by) {
    _sheetsRenderedDetailPid = null;
    if (countEl) countEl.textContent = "0";
    loadingEl.style.display = "";
    contentEl.style.display = "none";
    detailWrap.style.display = "none";
    setSheetsLayoutState(0, false);
    cardsGrid.innerHTML = "";
    detailEl.innerHTML = `<div class="sheets-empty">Preencha <b>by</b> e conecte (login) para puxar sua party.</div>`;
    return;
  }

  const { partyPids, entries: sheetEntries } = _buildSelfSheetEntries(by);
  const visibleSheetEntries = sheetEntries.slice(0, maxVisibleSheets);

  // cria mapa pid->sheet (primeira ocorrência = mais recente)
  const byPid = {};
  for (const sh of (_allSheetsLatest || [])) {
    const pid = safePidValue(sh?.pokemon?.id);
    if (pid && !byPid[pid]) byPid[pid] = sh;
    const lp = safePidValue(sh?.linked_pid);
    if (lp && !byPid[lp]) byPid[lp] = sh;
    const nameKey = safePidValue(sh?.pokemon?.name);
    if (nameKey && !byPid[nameKey]) byPid[nameKey] = sh;
  }

  const sheets = [];
  if (countEl) countEl.textContent = String(visibleSheetEntries.length);

  // UI states
  loadingEl.style.display = "none";
  contentEl.style.display = "";

  if (!partyPids.length) {
    _sheetsRenderedDetailPid = null;
    detailWrap.style.display = "none";
    setSheetsLayoutState(0, false);
    cardsGrid.innerHTML = `<div class="sheets-empty" style="grid-column:1/-1">Sua party está vazia (ou não foi encontrada ainda).<br/>
    Dica: entre na sala pelo Streamlit 1x (espelha users_raw) ou garanta que <code>party_snapshot</code> está preenchido.</div>`;
    detailEl.innerHTML = `<div class="sheets-empty">—</div>`;
    return;
  }

  if (!visibleSheetEntries.length) {
    _sheetsRenderedDetailPid = null;
    detailWrap.style.display = "none";
    setSheetsLayoutState(0, false);
    cardsGrid.innerHTML = `<div class="sheets-empty" style="grid-column:1/-1">📭 Sem fichas encontradas para a sua party.<br/>
    Salve fichas em <b>Criação Guiada</b> e mantenha a party no <b>Trainer Hub</b>.</div>`;
    detailEl.innerHTML = `<div class="sheets-empty">—</div>`;
    return;
  }

  detailWrap.style.display = "";
  setSheetsLayoutState(visibleSheetEntries.length, true);

  // selecionado
  if (!_sheetsSelectedPid || !visibleSheetEntries.some((entry) => entry._selection_id === _sheetsSelectedPid)) {
    _sheetsSelectedPid = visibleSheetEntries[0]?._selection_id || null;
  }

  // ---- render cards
  cardsGrid.innerHTML = "";
  for (const entry of visibleSheetEntries) {
    const sh = entry.effectiveSheet || entry.baseSheet;
    const baseSheet = entry.baseSheet || sh;
    const pkm = sh?.pokemon || {};
    const pid = entry._base_pid;
    const partyIdentity = entry._party_entry || { pid, party_slot: entry._party_slot };
    const ctx = _getEffectivePokemonContext(by, partyIdentity, { sheet: sh });
    const pidLabel = _sheetDisplayPid(sh, sh?._party_pid_raw) || "—";
    const pname = safeStr(ctx?.displayName || pkm.name) || "Pokémon";
    const types = (ctx?.resolvedTypes?.length ? ctx.resolvedTypes : getResolvedTypesForTrainerPid(by, partyIdentity, { sheet: sh })) || [];
    const npLabel = sh.np ?? pkm.np ?? "—";
    const np = parseInt(npLabel || 0) || 0;
    const stats = sh.stats || {};
    const stgr = parseInt(stats.stgr || 0) || 0;
    const intel = parseInt(stats.int || 0) || 0;
    let dodge = parseInt(stats.dodge || 0) || 0;
    const parry = parseInt(stats.parry || 0) || 0;
    const fort = parseInt(stats.fortitude || stats.fort || 0) || 0;
    const will = parseInt(stats.will || 0) || 0;
    let thg = parseInt(stats.thg || 0) || 0;
    const cap = 2 * np;
    if (thg <= 0 && cap > 0) thg = Math.round(cap / 2);
    if (dodge <= 0 && cap > 0 && thg > 0) dodge = Math.max(0, cap - thg);

    const movesRaw = Array.isArray(sh.moves) ? sh.moves : (sh.moves ? Object.values(sh.moves) : []);
    const moves = (movesRaw || []).filter((m) => m && typeof m === "object");
    const isSel = entry._selection_id === _sheetsSelectedPid;
    const ps = _getPartyStateForSheet(by, baseSheet, partyIdentity);
    const statBoosts = ps.stat_boosts || {};
    const boostedStats = { ...stats };
    for (const [key, value] of Object.entries(statBoosts)) {
      boostedStats[key] = (parseInt(boostedStats[key] || 0) || 0) + (parseInt(value || 0) || 0);
    }

    const cardStatsH = [
      ["Stgr", stgr + (statBoosts.stgr || 0)],
      ["Int", intel + (statBoosts.int || 0)],
      ["Thg", thg + (statBoosts.thg || 0)],
      ["Dodge", dodge + (statBoosts.dodge || 0)],
      ["Parry", parry + (statBoosts.parry || 0)],
      ["Fort", fort + (statBoosts.fort || 0)],
      ["Will", will + (statBoosts.will || 0)],
      ["Cap", cap],
    ].map(([label, value]) => `
      <div class="card-stat${label === "Cap" ? " cap" : ""}">
        <div class="card-stat-label">${label}</div>
        <div class="card-stat-val">${value}</div>
      </div>
    `).join("");

    const featuredMove = _getPreferredMovesForTrainerPid(by, partyIdentity || pid || entry._party_pid_raw || pname, moves, 1)[0] || null;
    let cardFooterBody = `
      <div class="card-featured">
        <div class="card-featured-note">Sem golpes cadastrados nesta ficha.</div>
      </div>
    `;
    if (featuredMove) {
      const moveName = safeStr(featuredMove.name || featuredMove.Nome || featuredMove.nome || "Golpe");
      const { rk, label, val, br } = _mvSum(featuredMove, boostedStats);
      const moveMeta = ((label === "Stgr" || label === "Int") && val)
        ? `R${br} + ${val} ${label}`
        : `R${br}`;
      const moveColor = _moveTypeColor(moveName);
      const isStab = _isMoveStab(moveName, types);
      cardFooterBody = `
        <div class="card-featured${isStab ? " is-stab" : ""}"${isStab ? ` style="--stab-color:${moveColor}"` : ""}>
          <div class="card-featured-head">
            <span class="card-featured-name" style="${moveColor ? `color:${moveColor}` : ""}">${escapeHtml(moveName)}${isStab ? " ★" : ""}</span>
            <span class="mv-pill rk">R${rk}</span>
          </div>
          <div class="card-featured-meta">
            <span class="card-featured-note">${escapeHtml(moveMeta)}</span>
            ${_renderMoveModePill(featuredMove, { compact: true })}
          </div>
        </div>
      `;
    }

    const tp = (types || []).map((t) => _typePill(t)).join("");
    const megaBadge = entry.activeMegaSlug ? `<span class="chip" style="border-color:rgba(251,191,36,.45);color:#fbbf24;">MEGA</span>` : "";

    const sprite = getSpriteUrlForPiece({ owner: by, pid, party_slot: entry._party_slot }, { type: "art", shiny: !!ps.shiny })
      || _artUrlFromPidForSheets(pname || pid, ps.shiny)
      || _spriteUrlFromPidForSheets(pname || pid)
      || "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png";

    const card = document.createElement("div");
    card.className = `poke-card${isSel ? " selected" : ""}`;
    card.style.setProperty("--card-bg", _typeBg(types));
    card.addEventListener("click", () => {
      _sheetsSelectedPid = entry._selection_id;
      renderSheetsTab();
      updateSidePanels();
    });

    card.innerHTML = `
      <div class="card-head">
        <div class="card-art-shell">
          <img src="${escapeAttr(sprite)}" alt="sprite" loading="lazy"
            onerror="this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'"/>
        </div>
        <div class="card-info">
          <div class="card-name">${escapeHtml(pname)}</div>
          <div class="card-sub">#${escapeHtml(pidLabel)} • NP ${escapeHtml(String(npLabel))}</div>
          <div class="pill-row">${tp}${megaBadge}</div>
        </div>
      </div>
      <div class="card-stat-grid">${cardStatsH}</div>
      <div class="card-footer">
        <div class="card-footer-label">Golpe em destaque</div>
        ${cardFooterBody}
        <div class="card-open">Abrir ficha →</div>
      </div>
    `;
    cardsGrid.appendChild(card);
  }

  // ---- render detail
  const activeEntry = visibleSheetEntries.find((entry) => entry._selection_id === _sheetsSelectedPid) || visibleSheetEntries[0];
  if (!activeEntry) {
    _sheetsRenderedDetailPid = null;
    detailEl.innerHTML = `<div class="sheets-empty">Selecione um card.</div>`;
    return;
  }

  const activeSheet = activeEntry.effectiveSheet || activeEntry.baseSheet || {};
  const activePokemon = activeSheet?.pokemon || {};
  const activePidLabel = _sheetDisplayPid(activeSheet, activeSheet?._party_pid_raw) || "—";
  const activeNp = parseInt(activeSheet?.np || activePokemon?.np || 0) || 0;
  if (detailHintEl) detailHintEl.textContent = `#${activePidLabel} • NP ${activeNp}`;
  const shouldResetDetailScroll = _sheetsRenderedDetailPid !== activeEntry._selection_id;
  _sheetsRenderedDetailPid = activeEntry._selection_id || null;

  detailEl.innerHTML = "";
  detailEl.appendChild(renderSheetsInspectorCard(document.createElement("div")));
  if (shouldResetDetailScroll) detailEl.scrollTop = 0;

  if (safeStr(appState.activeTab) === "sheets") {
    const inspectorRoot = $("inspector_root");
    if (inspectorRoot) {
      inspectorRoot.innerHTML = "";
      inspectorRoot.appendChild(renderInspectorCard());
    }
  }
}

// Primeiro render (caso usuário abra direto na aba)
try {
  if ($("tab_sheets")) {
    ensureSheetsUI();
    renderSheetsTab();
  }
} catch {}




// ─── Expor globais para patches externos (panels-patch, combat-patch, etc.) ───
// ES Modules não expõem nada no window por padrão — fazemos isso manualmente.
window.appState           = appState;
window.__globalHpRevision = appState.globalHpRevision || 0;
window._partyStates       = _partyStates;
window.updateSidePanels   = updateSidePanels;
window.getPartyForTrainer = getPartyForTrainer;
window.getPartyHp = getPartyHp;
window.updatePartyStateHp = updatePartyStateHp;
window.updateStatBoost = updateStatBoost;
window.setPieceConditions = setPieceConditions;
window.tickMmActiveEffectsOnTurnPass = tickMmActiveEffectsOnTurnPass;
window.getGlobalHpSnapshot = () => {
  const out = {};
  try {
    for (const [uid, profile] of appState.userProfiles.entries()) {
      if (profile?.hubPokemonEntries) out[uid] = profile.hubPokemonEntries;
    }
  } catch {}
  return out;
};
window.getHeldItemForTrainerPid = getHeldItemForTrainerPid;
window.getResolvedTypesForTrainerPid = getResolvedTypesForTrainerPid;
window.getResolvedAbilitiesForTrainerPid = getResolvedAbilitiesForTrainerPid;
window.getEffectivePokemonPresentationForTrainerPid = getEffectivePokemonPresentationForTrainerPid;
window.renderHeldItemBadgeHtml = renderHeldItemBadgeHtml;
window.renderHeldItemSummaryHtml = renderHeldItemSummaryHtml;
window.getSheetMoveTempModifiers = getSheetMoveTempModifiers;
window.getFavoriteMoveNamesForTrainerPid = _getFavoriteMoveNamesForTrainerPid;
window.getPreferredMovesForTrainerPid = _getPreferredMovesForTrainerPid;
window.getMoveModeInfo = _getMoveModeInfo;
window.selectPiece        = selectPiece;
window.togglePieceRevealed = togglePieceRevealed;
window.removePieceFromBoard = removePieceFromBoard;
window.startPlacePokemon  = startPlacePokemon;
window.getPlacingPokemonPartySlot = getPlacingPokemonPartySlot;
window.screenToTile       = screenToTile;
window.getPieceAt         = getPieceAt;
window.getPiecesAt        = getPiecesAt;
window.getPieceSizeCategory = getPieceSizeCategory;
window.canCurrentPlayerStartCombat = canCurrentPlayerStartCombat;
window.canCurrentPlayerPassTurn = canCurrentPlayerPassTurn;
window.isPieceVisibleToMe = isPieceVisibleToMe;
window.getSpriteUrlFromPid = getSpriteUrlFromPid;
window.getEffectiveSpriteUrlForTrainerPid = getEffectiveSpriteUrlForTrainerPid;
window.localSpriteUrl      = localSpriteUrl;
window.spriteUrlWithFallback = spriteUrlWithFallback;
window.spriteSlugFromPokemonName = spriteSlugFromPokemonName;
window._arenaView              = view;
window.getArenaRenderMode      = getArenaRenderMode;
window.getArenaBoardLayout     = getArenaBoardLayout;
window.requestArenaRefresh     = requestArenaRefresh;
window.DEFAULT_FIREBASE_CONFIG = DEFAULT_FIREBASE_CONFIG; // exposto para patches (avatar URL)
window.currentDb          = null;
window.currentRid         = null;
window.runTransaction     = runTransaction;
window.serverTimestamp    = serverTimestamp;
window.getStateDocRef     = getStateDocRef;
window.getBattleDocRef    = getBattleDocRef;
window.getCurrentTurnActor = getCurrentTurnActor;
window.buildTurnOrderFromCurrentBoard = buildTurnOrderFromCurrentBoard;
window.syncTurnStateWithCurrentBoard = syncTurnStateWithCurrentBoard;
// Mantém window.currentRid e window.currentDb sincronizados com appState
setInterval(() => {
  window.currentRid = appState.rid || null;
  window.currentDb  = window._combatDb || null;
}, 300);
