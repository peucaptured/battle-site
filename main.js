import { getMoveType, getTypeColor, getTypeDamageBonus, getSuperEffectiveAgainst, getWeakAgainst, getImmuneTo, getTypeAdvantage, TYPE_CHART, TYPE_COLORS as TYPE_COLORS_DATA, normalizeType } from "./type-data.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  collection,
  onSnapshot,
  addDoc,
  serverTimestamp,
  query,
  orderBy,
  limit,
  getDocs,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getAuth, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

/**
 * PvP Arena (HTML/JS) — Realtime Firestore
 *
 * Regras importantes:
 * - Movimento continua via actions (MOVE_PIECE) para manter compatibilidade.
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
// tenta pré-preencher "by" com o último login
try {
  const cache = loadLoginCache();
  if (cache?.name && byInput && !safeStr(byInput.value)) byInput.value = String(cache.name);
} catch {}

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

// ── Sprite overlay layer (renders GIFs as HTML <img> over canvas) ──
const _spriteOverlay = document.createElement("div");
_spriteOverlay.id = "sprite_overlay";
_spriteOverlay.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2;";
if (canvasWrap) canvasWrap.appendChild(_spriteOverlay);
const _spritePool = new Map(); // pieceId -> {el, url}

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

function saveLoginCache(name, userData, uid, customToken) {
  try {
    localStorage.setItem(
      LOGIN_CACHE_KEY,
      JSON.stringify({
        name,
        userData,
        uid: uid || null,
        customToken: customToken || null,
        savedAt: Date.now(),
      })
    );
  } catch {}
}

function clearLoginCache() {
  try { localStorage.removeItem(LOGIN_CACHE_KEY); } catch {}
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

async function buildPartySnapshotFromFirestore(db, trainerName, userData, limitSheets = 120) {
  const tn = safeStr(trainerName);
  if (!tn || !db) return [];

  const partyRaw = (userData && Array.isArray(userData.party)) ? userData.party : [];
  const partyIds = partyRaw.map(normalizePartyPid).filter(Boolean);

  // replica app.py: pega fichas mais recentes e casa por pokemon.id (primeira ocorrência, pois já está order desc)
  const byPid = new Map();
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
      if (!pid || byPid.has(pid)) return;
      byPid.set(pid, {
        sheet_id: d.id,
        pokemon: { id: p.id, name: p.name, types: p.types },
        np: sh.np,
        updated_at: sh.updated_at,
      });
    });
  } catch {}

  return partyIds.map((pid) => {
    const base = { pid };
    const extra = byPid.get(pid);
    return extra ? Object.assign(base, extra) : base;
  });
}

// Faz login antes de conectar
async function ensureLoggedInIfNeeded(db, auth, typedName) {

  const tn = safeStr(typedName);

  // se não preencheu nome, deixa conectar como espectador
  if (!tn) {
    appState.selfUserData = null;
    appState.selfPartySnapshot = null;
    appState.selfAuthStatus = null;
    appState.selfTrainerId = null;
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
  if (cache && safeStr(cache.name) === tn && cache.userData) {
    // tenta restaurar Auth sem pedir senha
    const tok = safeStr(cache.customToken);
    if (auth && tok) {
      try {
        await signInWithCustomToken(auth, tok);
        appState.selfTrainerId = safeStr(cache.uid || auth.currentUser?.uid || "");
      } catch (e) {
        // token inválido/expirado -> força relogar
        clearLoginCache();
      }
    }
  
    // se não conseguiu restaurar auth, cai pra prompt de senha abaixo
    if (auth && !auth.currentUser) {
      // continua fluxo normal (vai pedir senha)
    } else {
      appState.selfUserData = cache.userData;
      appState.selfAuthStatus = "OK";
      if (db) appState.selfPartySnapshot = await buildPartySnapshotFromFirestore(db, tn, appState.selfUserData);
      return { ok: true, name: tn };
    }

  }

  // 2) pede senha via prompt (não exige mexer no HTML)
  const pw = window.prompt(`Senha do treinador "${tn}" (mesma da planilha):`, "");
  if (pw == null) return { ok: false, cancel: true };

  const result = await sheetAuthenticateUser(tn, pw);
  appState.selfAuthStatus = result.status;
  
  if (result.status !== "OK") {
    appState.selfUserData = null;
    appState.selfPartySnapshot = null;
    appState.selfTrainerId = null;
    clearLoginCache();
    return { ok: false, status: result.status, message: result.message };
  }
  
  // 🔐 loga no Firebase Auth com custom token (necessário pras rules opção B)
  const token = safeStr(result.customToken);
  if (!auth || !token) {
    appState.selfUserData = null;
    appState.selfPartySnapshot = null;
    appState.selfTrainerId = null;
    clearLoginCache();
    return { ok: false, status: "ERROR", message: "endpoint não retornou customToken (Auth obrigatório para rules B)" };
  }
  
  await signInWithCustomToken(auth, token);
  appState.selfTrainerId = safeStr(result.uid || auth.currentUser?.uid || "");
  
  // segue igual
  appState.selfUserData = result.data || {};
  if (db) appState.selfPartySnapshot = await buildPartySnapshotFromFirestore(db, tn, appState.selfUserData);
  
  // cache agora guarda uid+token também (pra não pedir senha toda hora)
  saveLoginCache(tn, appState.selfUserData, appState.selfTrainerId, token);
  
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
  selfAuthStatus: null,    // "OK" | "NOT_FOUND" | "WRONG_PASS" | "ERROR"
  role: "—",
  players: [],
  userProfiles: new Map(), // uid -> {profile, raw}
  // docs
  board: null, // public_state/state
  battle: null, // public_state/battle
  // derived
  gridSize: 10,
  theme: "biome_grass",
  pieces: [],
  traps: [],   // armadilhas por célula (field-zones-patch)
  zones: [],   // zonas de clima/terreno (field-zones-patch)
  // UI selection
  selectedPieceId: null,
  placing: null, // { mode: "pokemon", trainer, pid }
  placingPid: null,
  placingTrainer: null, // trainer name when placing trainer avatar
  hover: { row: null, col: null },
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
  movement: {
    dashByPieceId: {},
    freeByPieceId: {},
    halfStepIntentByPieceId: {},
    turnKey: "",
  },
};


// Local UI state (não vai pro Firestore)
let armedPokemonId = null; // modo posicionamento via pokébola

// -------------------------
// Dex / Map overrides (localStorage)
// -------------------------
const STORAGE_KEYS = {
  dexMap: 'pvp_dex_map_json',
  mapUrl: 'pvp_map_url_override',
};

let dexMap = null; // { pidStr: name }
let mapUrlOverride = '';

function setDexMap(obj) {
  dexMap = (obj && typeof obj === 'object') ? obj : null;
  window.dexMap = dexMap;
}

const pieceMenuState = {
  pieceId: null,
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
          }
        }

        updateSidePanels();
      }, () => {});
      const un2 = onSnapshot(profileDoc, (snap) => {
        const data = snap.exists() ? snap.data() : null;
        const cur = appState.userProfiles.get(uid) || {};
        cur.profile = data;
        appState.userProfiles.set(uid, cur);
        updateSidePanels();
      }, () => {});
      userUnsub.set(uid, () => { try { un1(); } catch {} ; try { un2(); } catch {} });
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

function safeDocId(name) {
  const s = safeStr(name) || "user";
  return s.replace(/[^a-zA-Z0-9_\-\.]/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "user";
}

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
  if (phaseBadge) phaseBadge.textContent = phase;
  if (trainerNameEl) trainerNameEl.textContent = safeStr(appState.by) || "—";
  if (avatarIcon) {
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

  const synced = appState.connected ? "Sincronizado ✓" : "—";
  if (syncBadge) syncBadge.textContent = synced;

  if (turnBadge) {
    const turnState = appState.battle?.turn_state || null;
    if (!turnState || !Array.isArray(turnState.order) || !turnState.order.length) {
      turnBadge.textContent = "Rodada — • aguardando iniciativa";
    } else if (safeStr(turnState.phase) === "preprep_asking") {
      turnBadge.textContent = `Rodada ${Number(turnState.round) || 1} • 📋 fase de preprep`;
    } else if (safeStr(turnState.phase) !== "active") {
      turnBadge.textContent = `Rodada ${Number(turnState.round) || 1} • aguardando nova iniciativa`;
    } else {
      const idx = Number(turnState.index) || 0;
      const cur = turnState.order[idx] || null;
      if (!cur) {
        turnBadge.textContent = `Rodada ${Number(turnState.round) || 1} • aguardando próxima ação`;
      } else {
        const mon = safeStr(cur.display || cur.pid || cur.pieceId || "Pokémon");
        const owner = safeStr(cur.owner || "—");
        turnBadge.textContent = `Rodada ${Number(turnState.round) || 1} • Turno: ${mon} (${owner})`;
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

function getCurrentTurnActor() {
  const turnState = appState.battle?.turn_state;
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

function canCurrentPlayerStartCombat() {
  const role = safeStr(appState.role);
  const isPlayer = role === "owner" || role === "challenger" || role === "gm";
  return isPlayer && isCurrentTurnOwnerMe();
}

function buildTurnOrderFromCurrentBoard() {
  const pieces = Array.isArray(appState.pieces) ? appState.pieces : [];
  const init = appState.battle?.initiative || {};
  const activePieces = pieces.filter((p) => safeStr(p?.status || "active") === "active");

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

function setTab(tabName) {
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

  appState.activeTab = tabName;
  const inspectorRoot = $("inspector_root");
  if (inspectorRoot) {
    inspectorRoot.innerHTML = "";
    inspectorRoot.appendChild(renderInspectorCard());
  }
}

qsa(".tab").forEach((t) => {
  t.addEventListener("click", () => setTab(t.dataset.tab));
});

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

// Expor no console (compatibilidade com debug antigo)
window.sendAddLog = async (by, text) => sendAction("ADD_LOG", by || "Anon", { text: text || "teste" });
// window.sendMovePiece removido (debug antigo) — mover agora é por clique/arrasto no grid.

topRollBtn?.addEventListener("click", async () => {
  if (!currentDb || !currentRid || !appState.connected) {
    setStatus("err", "conecte antes de rolar dado");
    return;
  }

  const by = safeStr(appState.by || byInput?.value || "Anon") || "Anon";
  const value = Math.floor(Math.random() * 20) + 1;

  const battleRef = getBattleDocRef();
  if (!battleRef) {
    setStatus("err", "battle doc indisponível");
    return;
  }

  const prevDisabled = topRollBtn.disabled;
  const prevLabel = topRollBtn.textContent;
  topRollBtn.disabled = true;
  topRollBtn.textContent = "⏳ Rolando...";

  try {
    // Sempre rola o dado
    await addDoc(collection(currentDb, "rooms", currentRid, "rolls"), {
      by,
      trainer: by,
      value,
      label: "d20",
      createdAt: serverTimestamp(),
    });

    // Se a rodada não estiver ativa, também inicia nova rodada (se houver peças)
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
        setStatus("ok", `dado rolado: ${value} • Rodada ${currentRound + 1} iniciada!`);
      } else {
        setStatus("ok", `dado rolado: ${value}`);
      }
    } else {
      setStatus("ok", `dado rolado: ${value}`);
    }
  } catch (e) {
    setStatus("err", `erro ao rolar dado: ${e?.message || e}`);
  } finally {
    topRollBtn.disabled = prevDisabled;
    topRollBtn.textContent = prevLabel || "🎲 Rolar Dado";
  }
});

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
    setStatus("err", "battle doc indisponível");
    return;
  }

  try {
    await runTransaction(currentDb, async (tx) => {
      const snap = await tx.get(battleRef);
      const battleData = snap.exists() ? snap.data() : {};
      const turnState = battleData?.turn_state || {};
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
      let roundEnded = false;
      if (nextIndex >= order.length) {
        nextIndex = 0;
        nextRound += 1;
        nextPhase = "preprep_asking";
        roundEnded = true;
      }

      const _updatePayload = {
        turn_state: {
          ...turnState,
          round: nextRound,
          index: nextIndex,
          phase: nextPhase,
          updatedAt: Date.now(),
        },
      };
      if (roundEnded) {
        _updatePayload.preprep = { phase: "asking", responses: {}, data: {} };
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
  appState.pieces = [];
  appState.selectedPieceId = null;
  appState.selfUserData = null;
  appState.selfPartySnapshot = null;
  appState.selfAuthStatus = null;
  appState.renderedLogKeys = new Set();
  appState.placing = null;
  appState.placingPid = null;

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
  const login = await ensureLoggedInIfNeeded(db, auth, typedName);
  if (!login.ok) {
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

  const by = safeStr(login.name || "");
  appState.by = by;
  if (byInput && by) byInput.value = by;
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
    ensureUserSubscriptions();
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
        appState.pieces = Array.isArray(data?.pieces) ? data.pieces : [];
        appState.traps  = Array.isArray(data?.traps)  ? data.traps  : [];
        appState.zones  = Array.isArray(data?.zones)  ? data.zones  : [];
        if (statePre) statePre.textContent = pretty(data);
        updateArenaMeta();
        updateSidePanels();
        // Garante que treinadores que entraram só via peças (sem registro em players) também têm
        // users_raw/users assinados, permitindo carregar party e avatar corretamente.
        ensureUserSubscriptions();
        if (!useCanvas) renderArenaDom();
        if (useCanvas && view.autoFit) fitToView();
      },
      (err) => {
        if (statePre) statePre.textContent = "Erro: " + err.message;
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
      const pp = $("players_preview");
      if (pp) pp.textContent = pretty(appState.publicPlayers);

      // re-render UI que usa party (scoreboard/painéis)
      updateSidePanels?.();
      updateArenaMeta?.();
      if (!useCanvas) renderArenaDom?.();
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

  // (debug antigo) listener de "Últimas actions" removido.

// ── HUD de Rolagens Globais ────────────────────────────────────────
const rollsBanner = $("rolls_banner");
const rollPillText = $("roll_pill_text"); // (vamos criar no HTML já já)

if (rollsBanner) {
  try {
    const rollsCol = collection(db, "rooms", rid, "rolls");
    const rollsQ = query(rollsCol, orderBy("createdAt", "desc"), limit(1));
    let rollBannerTimer = null;

    unsub.push(
      onSnapshot(
        rollsQ,
        (qs) => {
          if (qs.empty) {
            // se quiser, deixa o pill mostrando "—"
            if (rollPillText) rollPillText.textContent = "—";
            return;
          }

          const latestRoll = qs.docs[0].data();
          const trainer = safeStr(latestRoll.trainer || latestRoll.by) || "???";
          const value = latestRoll.value != null ? latestRoll.value : "?";
          const label = safeStr(latestRoll.label);

          const msg = `${trainer} ${value}${label ? " (" + label + ")" : ""}`;

          // atualiza pill fixo
          if (rollPillText) rollPillText.textContent = msg;

          // mantém banner (opcional)
          rollsBanner.textContent = `🎲 ${trainer} rolou ${value}${label ? " (" + label + ")" : ""}`;
          rollsBanner.style.display = "block";
          document.body.classList.add("has-roll-banner");

          if (rollBannerTimer) clearTimeout(rollBannerTimer);
          rollBannerTimer = setTimeout(() => {
            rollsBanner.style.display = "none";
            document.body.classList.remove("has-roll-banner");
          }, 8000);
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

function slugifyPokemonName(name) {
  return safeStr(name)
    .toLowerCase()
    .replaceAll("♀", "f")
    .replaceAll("♂", "m")
    .replace(/[’‘‛′'`\.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
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

  return slug;
}

function spriteUrlFromPokemonName(name) {
  const slug = spriteSlugFromPokemonName(name);
  if (!slug) return "";
  return localSpriteUrl(slug, "art", false)
    || `https://img.pokemondb.net/sprites/home/normal/${slug}.png`;
}

// ── Local sprite repo ─────────────────────────────────────────────
// Base path relative to the site root where pokemon folders live.
const LOCAL_POKEMON_BASE = "pokemon";

/**
 * Convert a PokemonDB-style slug to local folder name.
 * PokemonDB uses -alolan/-galarian/-hisuian/-paldean, but local folders use
 * the PokeAPI convention: -alola/-galar/-hisui/-paldea.
 */
function _toLocalSlug(slug) {
  if (!slug) return "";
  return slug
    .replace(/-alolan$/,  "-alola")
    .replace(/-galarian$/, "-galar")
    .replace(/-hisuian$/,  "-hisui")
    .replace(/-paldean$/,  "-paldea");
}

/**
 * Returns a local sprite URL for the given slug.
 * @param {string} slug   - pokemondb-style slug (e.g. "charizard", "muk-alolan")
 * @param {"battle"|"art"} type
 *   "battle" → animated showdown gif (used on the arena canvas)
 *   "art"    → official artwork png (used everywhere else)
 * @param {boolean} shiny
 */
function localSpriteUrl(slug, type, shiny) {
  if (!slug) return "";
  const folder = _toLocalSlug(slug);
  const file = type === "battle"
    ? (shiny ? "showdown_male_shiny_animated_preview.gif" : "showdown_male_animated_preview.gif")
    : (shiny ? "official_artwork_male_shiny.png" : "official_artwork_male.png");
  return `${LOCAL_POKEMON_BASE}/${folder}/${file}`;
}

/**
 * Full sprite URL with local-first, remote fallback.
 * For non-battle contexts (art): local official_artwork → pokemondb → pokeapi
 * For battle context: local showdown gif → pokemondb → pokeapi
 */
function spriteUrlWithFallback(slug, type, shiny) {
  if (!slug) return "";
  return localSpriteUrl(slug, type, shiny)
    || (type === "art"
        ? `https://img.pokemondb.net/artwork/large/${slug}.jpg`
        : `https://img.pokemondb.net/sprites/home/normal/${slug}.png`);
}




function getSpriteUrlForPiece(p, opts) {
  // opts: { type: "battle"|"art", shiny: bool }
  const type = opts?.type || "battle";
  const shiny = !!(opts?.shiny ?? p?.shiny);

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

function getPartyForTrainer(trainerName) {
  const tn = safeStr(trainerName);
  if (!tn) return [];

  // 0) Se este é o usuário logado via planilha, usa o dado direto do login
  if (safeStr(appState.by) && tn === safeStr(appState.by) && appState.selfUserData) {
    const partyRaw = Array.isArray(appState.selfUserData?.party) ? appState.selfUserData.party : [];
    if (partyRaw.length) {
      // se já montou snapshot com fichas, melhor
      if (Array.isArray(appState.selfPartySnapshot) && appState.selfPartySnapshot.length) return appState.selfPartySnapshot;
      return partyRaw.map(x => ({ pid: normalizePartyPid(x) })).filter(it => it.pid);
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

    if (Array.isArray(direct) && direct.length) {
      return direct.map(x => ({ pid: normalizePartyPid(x) })).filter(it => it.pid);
    }

    // byId: Cloud Functions gravam com safeId (lowercase+sem-acento); Ga'Al Dex com safe_doc_id (case).
    // Tentamos múltiplas variações de chave para cobrir ambos os casos.
    const byId = ps.byId || {};
    const tnLower = safeStr(tn).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const entry = byId[safeDocId(tn)] || byId[tn] || byId[tnLower] || byId[safeStr(tn).toLowerCase()];
    const party2 = Array.isArray(entry?.party) ? entry.party : (Array.isArray(entry?.party_snapshot) ? entry.party_snapshot : []);
    if (party2.length) {
      // party2 pode vir como strings ou objetos, normaliza:
      return party2.map(x => ({ pid: normalizePartyPid(x?.pid ?? x) })).filter(it => it.pid);
    }
  }

  // 1) party_snapshot vindo da sala
  const p = (appState.players || []).find(x => safeStr(x?.trainer_name) === tn);
  const snapParty = (p && Array.isArray(p.party_snapshot)) ? p.party_snapshot : [];

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
    return rawParty.map(x => ({ pid: normalizePartyPid(x) })).filter(it => it.pid);
  }

  // fallback: usa party_snapshot (caso users_raw não tenha)
  if (snapParty.length) return snapParty;

  return [];
}

function renderPartyCard(it, ownerName) {
  const pid = safeStr(it?.pid || it?.pokemon?.id || it);
  const name = dexNameFromPid(pid) || (pid.startsWith("EXT:") ? pid.slice(4) : `PID ${pid}`);
  const _psPartyCard = ((_partyStates && _partyStates[ownerName]) ? _partyStates[ownerName] : {})[pid] || {};
  const spriteUrl = getSpriteUrlFromPid(pid, { type: "art", shiny: !!_psPartyCard.shiny });
  const mine = safeStr(ownerName) && safeStr(ownerName) === safeStr(appState.by);
  const p = (appState.pieces || []).find(
    (x) => safeStr(x?.owner) === safeStr(ownerName) && safeStr(x?.pid) === safeStr(pid)
  );
  const onMap = !!p?.id && safeStr(p?.status || "active") !== "deleted";
  const isExt = pid.startsWith("EXT:");
  const ps = ((_partyStates && _partyStates[ownerName]) ? _partyStates[ownerName] : {})[pid] || {};
  const hp = (ps.hp != null ? Number(ps.hp) : 6);
  const maxHp = 6;
  const cond = Array.isArray(ps.cond) ? ps.cond : [];
  const hpPct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  const hpCol = hpPct > 66 ? "#22c55e" : hpPct > 33 ? "#f59e0b" : hp <= 0 ? "#64748b" : "#ef4444";
  const hpIcon = hp >= 5 ? "💚" : hp >= 3 ? "🟡" : hp >= 1 ? "🔴" : "💀";
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
  const actionsHtml = mine ? `
    <div class="pvp-actions">
      <button class="pvp-btn" data-act="${onMap ? "select" : "place"}">${onMap ? "🎯 Selecionar" : (getPlacingPokemonPid() === pid ? "📍 Clique no mapa" : "➕ Colocar")}</button>
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
        <div class="pvp-card-name">${escapeHtml(name)} ${extBadge}</div>
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
    if (getPlacingPokemonPid() && getPlacingPokemonPid() === pid) {
      clearPokemonPlacingMode();
      updateSidePanels();
      setStatus("ok", "posicionamento cancelado");
      return;
    }
    startPlacePokemon(pid);
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
  if (!db || !rid || !trainer || !monPid || !stat) return;

  // Lê o boost atual do appState (já sincronizado via onSnapshot)
  const psData  = _partyStates?.[trainer]?.[monPid]?.stat_boosts || {};
  const current = Number(psData[stat] || 0);
  const newVal  = current + delta;

  const psRef = doc(db, "rooms", rid, "public_state", "party_states");
  const patch = { [trainer]: { [monPid]: { stat_boosts: { [stat]: newVal === 0 ? null : newVal } } } };
  await setDoc(psRef, patch, { merge: true });
}
// ────────────────────────────────────────────────────────────────────────────

async function updatePartyStateHp(ownerName, pid, hp) {
  const db = currentDb;
  const rid = currentRid;
  const trainer = safeStr(ownerName);
  const monPid = safeStr(pid);
  if (!db || !rid || !trainer || !monPid) return;
  const newHp = Math.max(0, Math.min(6, Number(hp) || 0));

  const ref = doc(db, "rooms", rid, "public_state", "party_states");
  const patch = {
    [trainer]: {
      [monPid]: { hp: newHp },
    },
    updated_at: serverTimestamp(),
  };
  await setDoc(ref, patch, { merge: true });
}


function renderPartyWindow() {
  const root = $("party_window");
  if (!root) return;
  const by = safeStr(appState.by);
  const party = by ? getPartyForTrainer(by) : [];
  const placingPid = getPlacingPokemonPid();

  const slots = [];
  for (let i = 0; i < 8; i++) slots.push(party[i] || null);
  root.innerHTML = slots.map((entry, idx) => {
    const pid = safeStr(entry?.pid || entry || "");
    if (!pid) return `<button type="button" class="party-slot empty" data-slot="${idx}" disabled></button>`;
    const _psSlot = ((_partyStates && _partyStates[by]) ? _partyStates[by] : {})[pid] || {};
    const _slotSlug = spriteSlugFromPokemonName(typeof resolvePokemonNameFromPid === "function" ? resolvePokemonNameFromPid(pid) : "") || "";
    const sprite = (_slotSlug ? localSpriteUrl(_slotSlug, "art", !!_psSlot.shiny) : "") || getSpriteUrlFromPid(pid);
    const hp = getPartyHp(by, pid);
    const ko = hp <= 0;
    const onBoard = isPokemonAlreadyOnBoard(by, pid);
    const placing = placingPid && placingPid === pid;
    const disabled = ko && !onBoard;
    return `<button type="button" class="party-slot ${ko ? 'ko' : ''} ${placing ? 'placing' : ''}" data-slot="${idx}" data-pid="${escapeAttr(pid)}" ${disabled ? 'disabled' : ''}>
      ${sprite ? `<img src="${escapeAttr(sprite)}" alt="${escapeAttr(pid)}" loading="lazy" onerror="this.style.display='none'"/>` : ''}
    </button>`;
  }).join('');

  if (root.dataset.bound === "1") return;
  root.dataset.bound = "1";
  root.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.(".party-slot[data-pid]");
    if (!btn) return;
    const pid = safeStr(btn.dataset.pid);
    if (!pid) return;

    const ownerName = safeStr(appState.by);

    const activePieceId = getActivePieceIdForPokemon(ownerName, pid);
    if (activePieceId) {
      removePieceFromBoard(activePieceId);
      return;
    }

    if (getPlacingPokemonPid() && getPlacingPokemonPid() === pid) {
      clearPokemonPlacingMode();
      updateSidePanels();
      setStatus("ok", "posicionamento cancelado");
      return;
    }

    startPlacePokemon(pid);
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
  const kind = safeStr(p?.kind) || "pokemon";
  const pid = safeStr(p?.pid ?? "?");

  const title = mine ? "🎒 Sua peça" : "🆚 Peça do oponente";
  const _psOwner1 = ((_partyStates && _partyStates[safeStr(p?.owner)]) ? _partyStates[safeStr(p?.owner)] : {})[safeStr(p?.pid)] || {};
  const spriteUrl = getSpriteUrlForPiece(p, { type: "art", shiny: !!_psOwner1.shiny });

  card.innerHTML = `
    <div class="row spread" style="align-items:flex-start; gap:10px">
      <div class="row" style="gap:10px;align-items:flex-start">
        ${
          spriteUrl
            ? `<img class="mini" src="${escapeAttr(spriteUrl)}" alt="sprite" loading="lazy" onerror="this.style.display='none'"/>`
            : `<div class="avatar" style="width:40px;height:40px;border-radius:14px">#</div>`
        }
        <div style="min-width:0">
          <div style="font-weight:950;line-height:1.1">${escapeHtml(title)}</div>
          <div class="tiny">id: <span class="mono">${escapeHtml(selId)}</span></div>
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
        <div class="inspector-title">Inspector</div>
        <div class="muted">Clique em um Pokémon no mapa para inspecionar.</div>
      </div>
    `;
    return wrap;
  }

  const p = (appState.pieces || []).find((x) => safeStr(x?.id) === selId) || null;
  if (!p) {
    wrap.innerHTML = `
      <div class="inspector-empty">
        <div class="inspector-title">Inspector</div>
        <div class="muted">Peça não encontrada (talvez foi removida).</div>
      </div>
    `;
    return wrap;
  }

  const owner = safeStr(p?.owner) || "—";
  const pid = safeStr(p?.pid) || "—";
  const revealed = !!p?.revealed;
  const name = revealed ? (dexNameFromPid(pid) || pid) : "???";
  const _psInspector = ((_partyStates && _partyStates[owner]) ? _partyStates[owner] : {})[pid] || {};
  const spriteUrl = getSpriteUrlForPiece(p, { type: "art", shiny: !!_psInspector.shiny });

  const hp = Number(getPartyHp(owner, pid) ?? 0);
  const hpMax = 6;
  const hpPct = Math.max(0, Math.min(100, (hp / hpMax) * 100));
  const hpCol = hpPct > 66 ? "#22c55e" : hpPct > 33 ? "#f59e0b" : hp <= 0 ? "#64748b" : "#ef4444";

  const chips = [
    `<span class="chip">${escapeHtml(owner)}</span>`,
    `<span class="chip mono">${escapeHtml(pid)}</span>`,
    `<span class="chip ${revealed ? "ok" : "warn"}">${revealed ? "revelado" : "oculto"}</span>`,
  ].join("");

  const isMine = isPieceMine(p);

  // ✅ Dono-only: só o dono pode puxar/usar a ficha completa
  const sh2 = isMine ? getSheetForPiece(p) : null;

  const mvBudget = isMine ? getPieceMovementBudget(p) : { speed: 0, maxTiles: 0, dash: false };
  const freeMove = !!appState.movement?.freeByPieceId?.[selId];

  const slug = _pokeApiSlugFromPid(pid);
  const apiCached = (isMine && slug) ? _pokeApiSpeedCache.get(slug) : undefined;

  // ✅ Tipos/matchups: só mostra se for meu (ou se você quiser permitir tipos públicos, troque a regra aqui)
  const insTypes = (() => {
    if (!isMine) return [];
    const fromSheet = sh2?.pokemon?.types;
    if (Array.isArray(fromSheet) && fromSheet.length) return fromSheet;
    if (Array.isArray(p?.types) && p.types.length) return p.types;
    return [];
  })();

  const matchupH = (isMine && revealed) ? _typeMatchupHtml(insTypes) : "";

const psOwner = ((_partyStates && _partyStates[owner]) ? _partyStates[owner] : {})[pid] || {};
const sheetHasSpeed = isMine ? [
  readSpeedFromStats(sh2?.stats), readSpeedFromStats(sh2?.pokemon?.stats),
  readSpeedFromStats(sh2?.poke_stats), Number(sh2?.speed), Number(sh2?.pokemon?.speed),
  readSpeedFromStats(psOwner?.stats), readSpeedFromStats(p?.stats), Number(p?.speed),
].some(c => Number.isFinite(Number(c)) && Number(c) > 0) : false;
  const speedSource = apiCached === "pending" ? "buscando…" : (!sheetHasSpeed && apiCached > 0) ? "PokeAPI" : "sheet";
  const moveSummary = isMine
    ? `Speed ${mvBudget.speed} (${speedSource}) • deslocamento ${mvBudget.maxTiles % 1 ? "1/2" : mvBudget.maxTiles} quadrado(s)`
    : `🔒 Ficha privada — apenas o dono pode ver stats/golpes.`;

  wrap.innerHTML = `
    <div class="inspector-head">
      <div class="inspector-title">Inspector</div>
      <div class="inspector-sub mono">id: ${escapeHtml(selId)}</div>
    </div>

    <div class="inspector-card">
      <div class="inspector-media">
        ${spriteUrl ? `<img src="${escapeAttr(spriteUrl)}" alt="sprite" loading="lazy" onerror="this.style.display='none'"/>` : `<div class="inspector-sprite-fallback">#</div>`}
      </div>
      <div class="inspector-body">
        <div class="inspector-name">${escapeHtml(name)}</div>
        <div class="inspector-chips">${chips}</div>
        <div class="muted" style="margin-top:6px">${escapeHtml(moveSummary)}</div>
        ${matchupH}

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
          <button type="button" class="btn ${freeMove ? "primary" : "secondary"}" data-ins-act="free" ${isMine ? "" : "disabled"}>🧭 Deslocamento livre ${freeMove ? "ON" : "OFF"}</button>
          <button type="button" class="btn ${mvBudget.dash ? "primary" : "secondary"}" data-ins-act="dash" ${isMine ? "" : "disabled"}>${mvBudget.dash ? "⚡ Standard gasta (x2)" : "⚡ Abrir mão da Standard (x2)"}</button>
          <button type="button" class="btn secondary" data-ins-act="toggle" ${isMine ? "" : "disabled"}>Ocultar</button>
          <button type="button" class="btn danger" data-ins-act="remove" ${isMine ? "" : "disabled"}>Retirar da arena</button>
        </div>
      </div>
    </div>
  `;

  // handlers
  wrap.querySelector('[data-ins-act="move"]')?.addEventListener("click", () => {
    setStatus("ok", "Mover: clique no tile de destino na arena");
    // nada além disso: o click no tile já move a seleção atual
  });
  wrap.querySelector('[data-ins-act="free"]')?.addEventListener("click", () => {
    if (!isMine) return;
    const cur = !!appState.movement.freeByPieceId[selId];
    if (cur) delete appState.movement.freeByPieceId[selId];
    else appState.movement.freeByPieceId[selId] = true;
    setStatus(
      "ok",
      cur
        ? "deslocamento livre desativado: voltou a respeitar turno e alcance"
        : "deslocamento livre ativado: movimento em qualquer quadro, mesmo fora do turno"
    );
    updateSidePanels();
  });
  wrap.querySelector('[data-ins-act="dash"]')?.addEventListener("click", () => {
    if (!isMine) return;
    const cur = !!appState.movement.dashByPieceId[selId];
    appState.movement.dashByPieceId[selId] = !cur;
    if (!cur) setStatus("ok", "Standard aberta mão: deslocamento dobrado neste turno");
    else setStatus("ok", "deslocamento voltou ao valor base");
    updateSidePanels();
  });
  wrap.querySelector('[data-ins-act="toggle"]')?.addEventListener("click", async () => {
    await togglePieceRevealed(selId);
  });
  wrap.querySelector('[data-ins-act="remove"]')?.addEventListener("click", async () => {
    await removePieceFromBoard(selId);
  });
  // HP segment bars — click sets HP to that segment value
  wrap.querySelector('[data-ins-hpbars]')?.addEventListener("click", async (ev) => {
    const seg = ev.target.closest('[data-ins-act="hp-seg"]');
    if (!seg) return;
    const newHp = Number(seg.dataset.seg);
    if (!Number.isFinite(newHp)) return;
    // clicking active segment (= current hp) decrements by 1 (toggle off)
    const nextHp = newHp === hp ? Math.max(0, hp - 1) : newHp;
    await updatePartyStateHp(owner, pid, nextHp);
  });

  return wrap;
}

function renderSheetsInspectorCard(wrap) {
  const by = safeStr(appState.by);
  const party = getPartyForTrainer(by) || [];
  const partyPids = party.map((it) => safePidValue(it?.pid ?? it?.pokemon?.id ?? it)).filter(Boolean);

  const byPid = {};
  for (const sh of (_allSheetsLatest || [])) {
    const pid = safePidValue(sh?.pokemon?.id);
    if (pid && !byPid[pid]) byPid[pid] = sh;
    const lp = safePidValue(sh?.linked_pid);
    if (lp && !byPid[lp]) byPid[lp] = sh;
  }

  const seen = new Set();
  const sheets = [];
  for (const rawPid of partyPids) {
    const pid = safePidValue(rawPid);
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    const sh = byPid[pid] || byPid[(safeStr(pid).replace(/^0+/, "") || "0")];
    if (sh) sheets.push(sh);
  }

  if (!_sheetsSelectedPid || !sheets.some((x) => safePidValue((x.pokemon || {}).id) === _sheetsSelectedPid)) {
    _sheetsSelectedPid = safePidValue((sheets[0]?.pokemon || {}).id);
  }

  const sh = sheets.find((x) => safePidValue((x.pokemon || {}).id) === _sheetsSelectedPid) || sheets[0] || null;
  if (!sh) {
    wrap.innerHTML = `
      <div class="inspector-empty">
        <div class="inspector-title">Inspector</div>
        <div class="muted">Selecione um card em Fichas para ver os detalhes completos.</div>
      </div>
    `;
    return wrap;
  }

  const pkm = sh.pokemon || {};
  const pid = safePidValue(pkm.id);
  const pname = safeStr(pkm.name) || "Pokémon";
  const types = Array.isArray(pkm.types) ? pkm.types : [];
  const abilities = Array.isArray(pkm.abilities) ? pkm.abilities : [];
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

  const ps = ((_partyStates && _partyStates[by]) ? _partyStates[by] : {})[pid] || {};
  const hp = (ps.hp ?? 6);
  const cond = Array.isArray(ps.cond) ? ps.cond : [];
  const hpMax = 6;
  const hpPct = Math.max(0, Math.min(100, (hp / hpMax) * 100));
  const hpCol = (hpPct > 50) ? "rgba(34,197,94,1)" : (hpPct > 25) ? "rgba(234,179,8,1)" : "rgba(239,68,68,1)";
  // Boosts temporários de stat
  const statBoosts = ps.stat_boosts || {};
  const isOnBoard = (appState.pieces || []).some(p => safeStr(p.owner) === by && safeStr(p.pid) === pid && safeStr(p.status || "active") === "active");

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
    const tsh = getSheetForPiece(tp);
    if (tsh && Array.isArray(tsh?.pokemon?.types) && tsh.pokemon.types.length)
      return { types: tsh.pokemon.types, name: safeStr(tsh?.pokemon?.name || tp.pid) };
    if (Array.isArray(tp.types) && tp.types.length)
      return { types: tp.types, name: safeStr(tp.pid) };
    return { types: [], name: safeStr(tp.pid || "") };
  })();

  let mvH = "";
  if (!moves.length) {
    mvH = `<span class="muted">Sem golpes nesta ficha.</span>`;
  } else {
    for (const mv of moves) {
      const n = safeStr(mv.name || mv.Nome || mv.nome || "Golpe");
      const sum = _mvSum(mv, st);
      const { rk, acc, area, br, val, label: statLabel } = sum;
      const desc = safeStr(mv.description || mv.desc || mv.build || "Descrição não disponível.");
      const mvType = getMoveType(n);
      const mvColor = mvType ? getTypeColor(mvType) : "";
      const isStab = _isMoveStab(n, types);
      const stabBonus = isStab ? 2 : 0;
      const stabClass = isStab ? " move-stab" : "";
      const typeTag = mvType ? `<span class="mv-type-pill" style="background:${mvColor}33;border:1px solid ${mvColor}66;color:${mvColor}">${mvType}</span>` : "";

      // Bônus de tipo automático vs alvo selecionado
      const typeBonus = (_calcTarget.types.length && mvType) ? getTypeDamageBonus(mvType, _calcTarget.types) : 0;
      const targetBonusHtml = (_calcTarget.types.length && mvType)
        ? `<div class="dmg-row dmg-type-row"><span class="dmg-row-lbl">Tipo vs <em>${escapeHtml(_calcTarget.name)}</em></span><span class="dmg-row-val ${typeBonus > 0 ? 'dmg-pos' : typeBonus < 0 ? 'dmg-neg' : ''}">${typeBonus >= 0 ? '+' : ''}${typeBonus}</span></div>`
        : `<div class="dmg-row dmg-muted-row"><span class="dmg-row-lbl">Tipo <span class="muted">(selecione alvo na arena)</span></span><span class="dmg-row-val muted">±?</span></div>`;

      const autoTotal = rk + stabBonus + typeBonus;

      mvH += `
        <div class="move-expander open${stabClass}"${isStab ? ` style="--stab-color:${mvColor}"` : ""}>
          <div class="move-header">
            <span class="arrow">▶</span>
            <span class="move-h-name" style="${mvColor ? `color:${mvColor}` : ""}">${escapeHtml(n)}</span>
            ${typeTag}
            <span class="mv-pill acc">A+${acc}</span>
            <span class="mv-pill rk">R${rk}</span>
            <span class="mv-pill area">${area ? "Área" : "Alvo"}</span>
          </div>
          <div class="move-body" style="display:block;">
            <div class="mv-desc-text">${escapeHtml(desc)}</div>
            <div class="dmg-calc"
              data-dmg-calc
              data-base-rk="${rk}"
              data-base-acc="${acc}"
              data-stab="${stabBonus}"
              data-type-bonus="${typeBonus}">
              <div class="dmg-calc-header">⚔️ Calcular Ação</div>
              <div class="dmg-breakdown">
                <div class="dmg-row dmg-base-row">
                  <span class="dmg-row-lbl">R${br} + ${escapeHtml(statLabel || "—")} ${val}</span>
                  <span class="dmg-row-val">= ${rk}</span>
                </div>
                ${isStab ? `<div class="dmg-row dmg-stab-row"><span class="dmg-row-lbl">STAB (mesmo tipo)</span><span class="dmg-row-val dmg-pos">+2</span></div>` : ""}
                ${targetBonusHtml}
              </div>
              <div class="dmg-modifiers">
                <label class="dmg-mod-lbl">
                  <span>Mod. Acerto</span>
                  <input class="dmg-mod-input" type="number" value="0" data-mod="acc" step="1" placeholder="0">
                </label>
                <label class="dmg-mod-lbl">
                  <span>Mod. Dano</span>
                  <input class="dmg-mod-input" type="number" value="0" data-mod="dmg" step="1" placeholder="0">
                </label>
              </div>
              <div class="dmg-result">
                <span class="dmg-res-chip dmg-acc-chip">Acerto: <strong class="dmg-live-acc">A+${acc}</strong></span>
                <span class="dmg-res-chip dmg-dmg-chip">Dano: <strong class="dmg-live-dmg">R${autoTotal}</strong></span>
              </div>
            </div>
          </div>
        </div>
      `;
    }
  }

  const art = _artUrlFromPidForSheets(pid, ps.shiny) || _spriteUrlFromPidForSheets(pid) || "";
  const inspTypeBgStyle = _fichaTypeBg(types);

  wrap.innerHTML = `
    <div class="inspector-head">
      <div class="inspector-title">Ficha completa</div>
      <div class="inspector-sub mono">#${escapeHtml(pid)} • NP ${np}</div>
    </div>
    <div class="inspector-card ficha-v2" style="display:block;${inspTypeBgStyle}">
      <div class="sheet-header">
        <div class="sheet-art-frame"><img class="sheet-art" src="${escapeAttr(art)}" alt="art" onerror="this.src='${escapeAttr(_spriteUrlFromPidForSheets(pid))}'"/></div>
        <div style="flex:1; min-width:0;">
          <div class="sheet-name">${escapeHtml(pname)}</div>
          <div class="pill-row" style="margin-top:6px;">${tp}</div>
          ${matchupH}
          <div class="pill-row" style="margin-top:8px;">${abilities.map((a) => `<span class="chip ability-pill">${escapeHtml(a)}</span>`).join("")}</div>${condH}
          <div style="margin-top:10px;">
            <div class="hp-row"><span>HP</span><span>${hp} / ${hpMax}</span></div>
            <div class="hp-track"><div class="hp-fill" style="width:${hpPct}%;background:${hpCol};"></div></div>
          </div>
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
          ${['dodge','parry','fort','will','thg','stgr'].map(s => `
            <div class="stat-boost-row">
              <span class="stat-boost-name">${s.charAt(0).toUpperCase()+s.slice(1)}</span>
              <button class="btn ghost stat-boost-btn" data-boost-stat="${s}" data-boost-delta="-1">−</button>
              <span class="stat-boost-val ${(statBoosts[s]||0) > 0 ? 'boost-pos' : (statBoosts[s]||0) < 0 ? 'boost-neg' : ''}">${(statBoosts[s]||0) > 0 ? '+' : ''}${statBoosts[s]||0}</span>
              <button class="btn ghost stat-boost-btn" data-boost-stat="${s}" data-boost-delta="1">+</button>
            </div>
          `).join('')}
        </div>
        ${Object.keys(statBoosts).length > 0 ? `<button class="btn ghost" style="width:100%;margin-top:6px;font-size:11px" data-boost-reset>↺ Zerar todos os boosts</button>` : ''}
      </div>` : `<div class="muted" style="font-size:11px;margin:6px 0;padding:6px;text-align:center">💤 Pokémon não está em campo — boosts indisponíveis</div>`}
      <div class="sheet-divider"></div>
      <div class="section-title">Skills</div>${skH}
      <div class="section-title">Advantages</div>${advH}
      <div class="sheet-divider"></div>
      <div class="section-title">Golpes</div>${mvH}
    </div>
  `;

  wrap.querySelectorAll(".move-header").forEach((h) => {
    h.addEventListener("click", () => {
      const parent = h.parentElement;
      if (parent) parent.classList.toggle("open");
    });
  });

  // ── Calculadora de dano — atualização ao vivo ──────────────────────
  wrap.querySelectorAll("[data-dmg-calc]").forEach((calcDiv) => {
    const baseRk   = parseInt(calcDiv.dataset.baseRk)    || 0;
    const baseAcc  = parseInt(calcDiv.dataset.baseAcc)   || 0;
    const stab     = parseInt(calcDiv.dataset.stab)      || 0;
    const typeB    = parseInt(calcDiv.dataset.typeBonus) || 0;
    const liveAcc  = calcDiv.querySelector(".dmg-live-acc");
    const liveDmg  = calcDiv.querySelector(".dmg-live-dmg");
    const update = () => {
      const modAcc = parseInt(calcDiv.querySelector('[data-mod="acc"]')?.value) || 0;
      const modDmg = parseInt(calcDiv.querySelector('[data-mod="dmg"]')?.value) || 0;
      if (liveAcc) liveAcc.textContent = `A+${baseAcc + modAcc}`;
      if (liveDmg) liveDmg.textContent = `R${baseRk + stab + typeB + modDmg}`;
    };
    calcDiv.querySelectorAll(".dmg-mod-input").forEach(inp => inp.addEventListener("input", update));
  });
  // ──────────────────────────────────────────────────────────────────

  // ── Handlers de boost temporário ──────────────────────────────────
  const boostPanel = wrap.querySelector(".stat-boost-panel");
  if (boostPanel) {
    const boostOwner = boostPanel.dataset.boostOwner;
    const boostPid   = boostPanel.dataset.boostPid;

    boostPanel.querySelectorAll(".stat-boost-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const stat  = btn.dataset.boostStat;
        const delta = Number(btn.dataset.boostDelta);
        if (!stat || !delta) return;
        btn.disabled = true;
        try {
          await updateStatBoost(boostOwner, boostPid, stat, delta);
        } finally {
          btn.disabled = false;
        }
      });
    });

    const resetBtn = boostPanel.querySelector("[data-boost-reset]");
    if (resetBtn) {
      resetBtn.addEventListener("click", async () => {
        resetBtn.disabled = true;
        const db  = currentDb;
        const rid = currentRid;
        if (!db || !rid) return;
        const psRef = doc(db, "rooms", rid, "public_state", "party_states");
        try {
          await setDoc(psRef, { [boostOwner]: { [boostPid]: { stat_boosts: null } } }, { merge: true });
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

  // Render pokébolas (Time / posicionamento)
  renderPartyWindow();

  // Botão de cancelar: só aparece quando estiver armado
  try {
    const placingPid = getPlacingPokemonPid();
    if (cancelPlaceBtn) cancelPlaceBtn.style.display = placingPid ? "" : "none";
    const armedLabel = document.getElementById("armed_label");
    if (armedLabel) {
      armedLabel.textContent = placingPid ? `pronto: ${dexNameFromPid(placingPid) || placingPid}` : "—";
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
          const oppPiece = visiblePieces.find(px => safeStr(px?.pid) === oppPid);
          const oppOnMap = !!oppPiece?.id && safeStr(oppPiece?.status || "active") !== "deleted";
          const oppRevealed = oppPiece ? !!oppPiece.revealed : false;
          const oppName = dexNameFromPid(oppPid) || (oppPid.startsWith("EXT:") ? oppPid.slice(4) : oppPid);
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
}


function renderPieceCard(p, isMine) {
  const { pid, id } = pieceDisplayName(p);
  const row = Number(p?.row);
  const col = Number(p?.col);
  const revealed = !!p?.revealed;
  const selected = safeStr(appState.selectedPieceId) && safeStr(appState.selectedPieceId) === safeStr(id);

  const card = document.createElement("div");
  card.className = `card ${selected ? "selected" : ""}`;
  card.dataset.pieceId = id;

  const _psCard = ((_partyStates && _partyStates[safeStr(p?.owner)]) ? _partyStates[safeStr(p?.owner)] : {})[safeStr(p?.pid)] || {};
  const spriteUrl = getSpriteUrlForPiece(p, { type: "art", shiny: !!_psCard.shiny });
  const imgHtml = spriteUrl
    ? `<img class="mini" src="${escapeAttr(spriteUrl)}" alt="sprite" loading="lazy" onerror="this.style.display='none'"/>`
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
  const revealed = !!p?.revealed;
  const _psMini = ((_partyStates && _partyStates[safeStr(p?.owner)]) ? _partyStates[safeStr(p?.owner)] : {})[safeStr(p?.pid)] || {};
  const spriteUrl = getSpriteUrlForPiece(p, { type: "art", shiny: !!_psMini.shiny });

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
  img.onerror = () => (img.style.display = "none");
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

function renderLogsIncremental() {
  const logs = Array.isArray(appState.battle?.logs) ? appState.battle.logs : [];
  if (logCount) logCount.textContent = String(logs.length);
  if (!logList) return;

  // primeira carga: renderiza os mais recentes (até 200)
  const max = 200;
  const startIdx = Math.max(0, logs.length - max);
  const fragment = document.createDocumentFragment();

  for (let i = startIdx; i < logs.length; i++) {
    const l = logs[i] || {};
    const key = logKey(l, i);
    if (appState.renderedLogKeys.has(key)) continue;
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
  box.className = "log-item";
  const by = safeStr(l?.by) || "manual";
  const at = fmtTimestamp(l?.at);
  const text = safeStr(l?.text || l?.payload?.text || "");
  box.innerHTML = `
    <div class="head">
      <div class="by">${escapeHtml(by)}</div>
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


// DOM fallback grid cache
let domGridSize = 0;
let domCells = []; // flat [row*gs+col] -> element

function updateHudViewportHeight() {
  const hero = document.querySelector(".hero-header");
  const tabs = document.querySelector(".hud-tabs");
  const scoreboard = document.getElementById("scoreboard");

  const heroH = hero?.offsetHeight || 0;
  const tabsH = tabs?.offsetHeight || 0;
  const scoreH = (scoreboard && scoreboard.classList.contains("sb-visible")) ? (scoreboard.offsetHeight || 0) : 0;

  const viewport = window.innerHeight || document.documentElement.clientHeight || 0;
  const hudH = Math.max(320, viewport - heroH - tabsH - scoreH - 16);

  document.documentElement.style.setProperty("--hud-viewport-height", `${hudH}px`);
}

function resizeCanvasToContainer() {
  const rect = canvasWrap.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const w = Math.max(320, Math.floor(rect.width));
  const h = Math.max(320, Math.floor(rect.height));
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (view.autoFit) fitToView();
}

if (useCanvas && typeof ResizeObserver !== "undefined") {
  const ro = new ResizeObserver(() => {
    updateHudViewportHeight();
    resizeCanvasToContainer();
  });
  ro.observe(canvasWrap);
  window.addEventListener("resize", () => {
    updateHudViewportHeight();
    resizeCanvasToContainer();
  });
}

if (typeof MutationObserver !== "undefined") {
  const scoreboard = document.getElementById("scoreboard");
  if (scoreboard) {
    const mo = new MutationObserver(() => updateHudViewportHeight());
    mo.observe(scoreboard, { attributes: true, attributeFilter: ["class"] });
  }
}

updateHudViewportHeight();

function fitToView() {
  const gs = appState.gridSize || 10;
  const rect = canvasWrap.getBoundingClientRect();
  const pad = 20;
  const w = rect.width - pad * 2;
  const h = rect.height - pad * 2;
  const tile = Math.floor(Math.min(w / gs, h / gs));
  view.scale = tile;
  view.offX = Math.floor((rect.width - gs * tile) / 2);
  view.offY = Math.floor((rect.height - gs * tile) / 2);
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
  const pieces = appState.pieces || [];
  for (const p of pieces) {
    if (safeStr(p?.status || "active") !== "active") continue;
    if (!isPieceVisibleToMe(p)) continue;
    if (!isPieceVisibleToMe(p)) continue;
    if (Number(p?.row) === row && Number(p?.col) === col) return p;
  }
  return null;
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
  const pid = safePidValue(piece?.pid);
  if (!pid) return null;
  for (const sh of (_allSheetsLatest || [])) {
    const sid = safePidValue(sh?.pokemon?.id);
    const linked = safePidValue(sh?.linked_pid);
    if ((sid && sid === pid) || (linked && linked === pid)) return sh;
  }
  return null;
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

// ── PokeAPI Speed cache & fetcher ────────────────────────────────
const _pokeApiSpeedCache = new Map(); // slug → speed value or "pending"

function _pokeApiSlugFromPid(pid) {
  const k = safeStr(pid);
  if (!k) return "";
  let name = "";
  if (k.startsWith("EXT:")) {
    name = k.slice(4).trim();
  } else {
    name = dexNameFromPid(k) || (!isNaN(Number(k)) ? "" : k);
  }
  if (!name) return "";
  // Convert to PokeAPI slug: lowercase, spaces→hyphens, strip special chars
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

async function fetchPokeApiSpeed(pid) {
  const slug = _pokeApiSlugFromPid(pid);
  if (!slug) return 0;
  if (_pokeApiSpeedCache.has(slug)) {
    const cached = _pokeApiSpeedCache.get(slug);
    return cached === "pending" ? 0 : cached;
  }
  _pokeApiSpeedCache.set(slug, "pending");
  try {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${slug}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const speedStat = data?.stats?.find(s => s.stat?.name === "speed");
    const spd = speedStat ? Number(speedStat.base_stat) : 0;
    _pokeApiSpeedCache.set(slug, spd > 0 ? spd : 0);
    // Refresh inspector if a piece is selected so the new speed shows up
    if (typeof updateSidePanels === "function") updateSidePanels();
    return spd;
  } catch {
    _pokeApiSpeedCache.set(slug, 0);
    return 0;
  }
}

function getPieceSpeed(piece) {
  const sh = getSheetForPiece(piece);
  const pid = safePidValue(piece?.pid);
  const owner = safeStr(piece?.owner);
  const ps = ((_partyStates && _partyStates[owner]) ? _partyStates[owner] : {})[pid] || {};

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
    if (Number.isFinite(n) && n > 0) return n;
  }

  // Try PokeAPI cache (sync read, async fetch if missing)
  const slug = _pokeApiSlugFromPid(pid);
  if (slug) {
    const cached = _pokeApiSpeedCache.get(slug);
    if (typeof cached === "number" && cached > 0) return cached;
    if (cached !== "pending") fetchPokeApiSpeed(pid); // fire-and-forget
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

  if (pieceId && appState.movement?.freeByPieceId?.[pieceId]) {
    for (let r = 0; r < gs; r++) {
      for (let c = 0; c < gs; c++) {
        if (r === row && c === col) continue;
        if (isTileOccupied(r, c)) continue;
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
        if (!isTileWithinGrid(nr, nc)) continue;
        if (isTileOccupied(nr, nc)) continue;
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
      if (isTileOccupied(r, c)) continue;
      out.set(`${r}:${c}`, { row: r, col: c, halfStep: false });
    }
  }
  return out;
}

function selectPiece(pieceId) {
  const id = safeStr(pieceId);
  appState.selectedPieceId = id || null;

  if (selBadge) selBadge.textContent = `seleção: ${id || "—"}`;

  // preenche devtools move
  if (pieceIdInput) pieceIdInput.value = id || "";

  // atualiza cards selecionados (se existirem no HTML)
  try { updateSidePanels(); } catch (e) {
    // Se o layout ainda não tem os painéis, não deve travar o restante
    try { console.warn("[pvp] updateSidePanels falhou:", e); } catch {}
  }
}

function sendMoveSelected(toRow, toCol) {
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
    const by = safeStr(byInput?.value || "Anon") || "Anon";
    sendAction("MOVE_PIECE", by, { pieceId, row: Number(toRow), col: Number(toCol) });
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
    if (!isTileWithinGrid(targetRow, targetCol)) {
      setStatus("err", "vetor final de meio deslocamento saiu da arena");
      appState.movement.halfStepIntentByPieceId[pieceId] = { ...first, turnKey: appState.movement.turnKey };
      return;
    }
    if (isTileOccupied(targetRow, targetCol)) {
      setStatus("err", "tile final ocupado para meio deslocamento");
      appState.movement.halfStepIntentByPieceId[pieceId] = { ...first, turnKey: appState.movement.turnKey };
      return;
    }

    delete appState.movement.halfStepIntentByPieceId[pieceId];
    toRow = targetRow;
    toCol = targetCol;
  }

  const by = safeStr(byInput?.value || "Anon") || "Anon";
  sendAction("MOVE_PIECE", by, { pieceId, row: toRow, col: toCol });
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


function clearPokemonPlacingMode() {
  armedPokemonId = null;
  if (appState.placing && appState.placing.mode === "pokemon") appState.placing = null;
  appState.placingPid = null;
}


function startPlacePokemon(pid) {
  const monPid = safeStr(pid);
  if (!monPid) return;
  armedPokemonId = monPid;
  if (!appState.connected || !appState.rid) {
    setStatus("err", "conecte antes de colocar pokémon no mapa");
    return;
  }
  if (!safeStr(appState.by)) {
    setStatus("err", "preencha o campo by para colocar pokémon");
    return;
  }
  if (isPokemonKo(appState.by, monPid)) {
    setStatus("err", "pokémon com HP 0 não pode ser posicionado");
    return;
  }
  if (isPokemonAlreadyOnBoard(appState.by, monPid)) {
    setStatus("warn", "esse pokémon já está no campo");
    return;
  }
  appState.placing = { mode: "pokemon", trainer: safeStr(appState.by), pid: monPid };
  appState.placingPid = monPid;
  setStatus("ok", `modo de posicionar ativo: ${monPid}. Clique em um tile vazio no mapa.`);
  updateSidePanels();
}

async function placePokemonOnBoardAt(pid, row, col) {
  const monPid = safeStr(pid);
  const by = safeStr(appState.by);
  if (!monPid || !by) return;

  const r = Number(row);
  const c = Number(col);
  if (!isTileWithinGrid(r, c)) {
    setStatus("err", "tile inválido para posicionar pokémon");
    return;
  }
  if (isPokemonKo(by, monPid)) {
    setStatus("err", "pokémon com HP 0 não pode ser posicionado");
    clearPokemonPlacingMode();
    updateSidePanels();
    return;
  }
  if (isPokemonAlreadyOnBoard(by, monPid)) {
    setStatus("warn", "esse pokémon já está no campo");
    clearPokemonPlacingMode();
    updateSidePanels();
    return;
  }
  if (isTileOccupied(r, c)) {
    setStatus("err", "tile ocupado");
    return;
  }

  try {
    // ✅ Opção A: aplica direto no public_state/state (igual Streamlit), via transaction
    // Motivo: o mapa renderiza APENAS o que está em state.pieces. Se você só cria action,
    // precisa de um "aplicador" no backend — e aqui vamos evitar isso.
    const stateRef = getStateDocRef();
    if (!stateRef || !currentDb) {
      setStatus("err", "sem conexão com o Firestore");
      return;
    }

    const newId = makePieceId();
    const newPiece = {
      id: newId,
      owner: by,
      pid: monPid,
      row: r,
      col: c,
      status: "active",
      revealed: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await runTransaction(currentDb, async (tx) => {
      const snap = await tx.get(stateRef);
      const data = snap.exists() ? snap.data() : {};
      const pieces = Array.isArray(data?.pieces) ? data.pieces : [];

      // Revalida dentro da transaction (evita corrida)
      const occupied = pieces.some(
        (p) => safeStr(p?.status || "active") === "active" && Number(p?.row) === r && Number(p?.col) === c
      );
      if (occupied) throw new Error("tile ocupado");

      const already = pieces.some(
        (p) =>
          safeStr(p?.status || "active") === "active" &&
          safeStr(p?.owner) === by &&
          safeStr(p?.pid) === monPid
      );
      if (already) throw new Error("esse pokémon já está no campo");

      const nextPieces = pieces.concat([newPiece]);
      tx.set(
        stateRef,
        {
          pieces: nextPieces,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    });

    // Optimistic UI (o snapshot vai confirmar logo em seguida)
    try {
      appState.pieces = Array.isArray(appState.pieces) ? appState.pieces : [];
      appState.pieces = appState.pieces.concat([newPiece]);
      if (!useCanvas) renderArenaDom();
      // canvas: o loop de render já vai pegar no próximo frame
    } catch {}

    clearPokemonPlacingMode();
    updateSidePanels();
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
  return (appState.pieces || []).some((p) =>
    safeStr(p?.status || "active") === "active" && Number(p?.row) === row && Number(p?.col) === col
  );
}

function getPartyHp(ownerName, pid) {
  const ps = ((_partyStates && _partyStates[ownerName]) ? _partyStates[ownerName] : {})[pid] || {};
  return ps.hp != null ? Number(ps.hp) : 6;
}

function isPokemonKo(ownerName, pid) {
  return getPartyHp(ownerName, pid) <= 0;
}

function isPokemonAlreadyOnBoard(ownerName, pid) {
  return (appState.pieces || []).some((p) =>
    safeStr(p?.owner) === safeStr(ownerName) &&
    safeStr(p?.pid) === safeStr(pid) &&
    safeStr(p?.status || "active") === "active"
  );
}

function getActivePieceIdForPokemon(ownerName, pid) {
  const found = (appState.pieces || []).find((p) =>
    safeStr(p?.owner) === safeStr(ownerName) &&
    safeStr(p?.pid) === safeStr(pid) &&
    safeStr(p?.status || "active") === "active"
  );
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
  const by = safeStr(appState.by);
  return by && safeStr(p?.owner) === by;
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

      const target = pieces.find((p) => safeStr(p?.id) === pid) || null;
      if (!target) return;
      if (!isPieceMine(target)) throw new Error("você só pode remover peças suas");

      const nextPieces = pieces.filter((p) => safeStr(p?.id) !== pid);
      tx.set(ref, { pieces: nextPieces, updatedAt: serverTimestamp() }, { merge: true });

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
    setStatus("ok", "peça removida do campo");
  } catch (e) {
    setStatus("err", `falha ao remover peça: ${e?.message || e}`);
  }
}

function hidePieceContextMenu() {
  if (!pieceContextMenu) return;
  pieceContextMenu.style.display = "none";
  pieceMenuState.pieceId = null;
}

function openPieceContextMenu(piece, x, y) {
  if (!pieceContextMenu || !piece || !canvasWrap) return;
  const id = safeStr(piece?.id);
  if (!id) return;
  pieceMenuState.pieceId = id;
  selectPiece(id);

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

async function handlePieceMenuAction(action, pieceId) {
  const id = safeStr(pieceId);
  if (!id) return;
  const piece = (appState.pieces || []).find((p) => safeStr(p?.id) === id) || null;
  if (!piece) {
    setStatus("warn", "peça não encontrada");
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
  if (action === "hp-down") {
    const owner = safeStr(piece?.owner);
    const pid = safeStr(piece?.pid);
    if (!owner || !pid) {
      setStatus("warn", "não foi possível reduzir o HP desse pokémon");
      return;
    }
    const ps = ((_partyStates && _partyStates[owner]) ? _partyStates[owner] : {})[pid] || {};
    const currentHp = Number.isFinite(Number(ps?.hp)) ? Number(ps.hp) : 6;
    await updatePartyStateHp(owner, pid, Math.max(0, currentHp - 1));
    setStatus("ok", `${pid}: HP reduzido para ${Math.max(0, currentHp - 1)}`);
  }
}

window.handlePieceMenuAction = handlePieceMenuAction;

pieceContextMenu?.addEventListener("click", async (ev) => {
  const btn = ev.target?.closest?.("[data-menu-act]");
  if (!btn) return;
  ev.preventDefault();
  ev.stopPropagation();
  const act = safeStr(btn.dataset.menuAct);
  const pieceId = pieceMenuState.pieceId;
  hidePieceContextMenu();
  await handlePieceMenuAction(act, pieceId);
});

document.addEventListener("click", (ev) => {
  if (!pieceContextMenu || pieceContextMenu.style.display !== "flex") return;
  if (ev.target?.closest?.("#piece_context_menu")) return;
  hidePieceContextMenu();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  // 1) fecha menu de contexto
  hidePieceContextMenu();

  // 2) cancela modo posicionamento (pokébola armada)
  if (getPlacingPokemonPid()) {
    clearPokemonPlacingMode();
    updateSidePanels();
    setStatus("ok", "posicionamento cancelado");
  }
});
function bindArenaInteractionsCanvas() {
  if (!useCanvas) return;

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
    if (appState.drag.active) {
      appState.drag.x = x;
      appState.drag.y = y;
    }
  });

  canvas.addEventListener("mouseleave", () => {
    appState.hover = { row: null, col: null };
    hoverBadge.textContent = `tile: —`;
  });

  canvas.addEventListener("mousedown", (ev) => {
    if (getPlacingPokemonPid()) return;
    if (appState.placingTrainer) return;
    if (ev.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const tile = screenToTile(x, y);
    if (!tile) return;
    const p = getPieceAt(tile.row, tile.col);
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
    hidePieceContextMenu();
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

    if (appState.placingTrainer) return; // handled by scoreboard-patch.js capture
    const placingPid = getPlacingPokemonPid();
    if (placingPid) {
      placePokemonOnBoardAt(placingPid, tile.row, tile.col);
      return;
    }

    const p = getPieceAt(tile.row, tile.col);
    if (p) {
      selectPiece(p.id);
      return;
    }
    // tile vazio: tenta mover seleção atual
    if (appState.selectedPieceId) sendMoveSelected(tile.row, tile.col);
  });

  canvas.addEventListener("contextmenu", (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const tile = screenToTile(x, y);
    if (!tile) return;
    const p = getPieceAt(tile.row, tile.col);
    if (!p) return;
    ev.preventDefault();
    openPieceContextMenu(p, ev.clientX, ev.clientY);
  });
}

function bindArenaInteractionsDom() {
  if (useCanvas) return;
  if (!arenaDom) return;

  // Delegação de eventos nas células
  arenaDom.addEventListener("mousemove", (ev) => {
    const cell = ev.target?.closest?.(".cell");
    if (!cell) return;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    appState.hover = { row, col };
    hoverBadge.textContent = `tile: (${row}, ${col})`;
    updateArenaDomHover();
  });

  arenaDom.addEventListener("mouseleave", () => {
    appState.hover = { row: null, col: null };
    hoverBadge.textContent = `tile: —`;
    updateArenaDomHover();
  });

  arenaDom.addEventListener("click", (ev) => {
    hidePieceContextMenu();
    const cell = ev.target?.closest?.(".cell");
    if (!cell) return;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);

    if (appState.placingTrainer) return; // handled by scoreboard-patch.js capture
    const placingPid = getPlacingPokemonPid();
    if (placingPid) {
      placePokemonOnBoardAt(placingPid, row, col);
      return;
    }

    const p = getPieceAt(row, col);
    if (p) {
      selectPiece(p.id);
      renderArenaDom();
      return;
    }
    if (appState.selectedPieceId) {
      sendMoveSelected(row, col);
    }
  });

  arenaDom.addEventListener("contextmenu", (ev) => {
    const cell = ev.target?.closest?.(".cell");
    if (!cell) return;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const p = getPieceAt(row, col);
    if (!p) return;
    ev.preventDefault();
    openPieceContextMenu(p, ev.clientX, ev.clientY);
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

function renderArenaDom() {
  if (!arenaDom) return;
  ensureDomGrid();
  // mostra DOM, esconde canvas
  if (canvas) canvas.style.display = "none";
  arenaDom.style.display = "grid";

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
    // remove token
    const t = cell.querySelector(":scope > .token");
    if (t) t.remove();
  }


  // placing mode highlight (tiles válidos)
  const placingPid = getPlacingPokemonPid();
  if (placingPid) {
    for (let r = 0; r < gs; r++) {
      for (let c = 0; c < gs; c++) {
        const cell = domCells[r * gs + c];
        if (!cell) continue;
        if (isTileOccupied(r, c)) continue;
        cell.classList.add("place-ok");
      }
    }
  }

  updateMovementTurnState();
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

  // coloca tokens
  for (const p of appState.pieces || []) {
    if (safeStr(p?.status || "active") !== "active") continue;
    if (!isPieceVisibleToMe(p)) continue;
    const r = Number(p?.row);
    const c = Number(p?.col);
    if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
    if (r < 0 || c < 0 || r >= gs || c >= gs) continue;
    const cell = domCells[r * gs + c];
    if (!cell) continue;
    const token = document.createElement("div");
    token.className = "token";
    const label = (p?.revealed ? String(p?.pid ?? "?") : "?").slice(0, 4);
    token.textContent = label;
    cell.appendChild(token);

    if (safeStr(appState.selectedPieceId) && safeStr(appState.selectedPieceId) === safeStr(p?.id)) {
      cell.classList.add("sel");
    }
  }

  updateArenaDomHover();
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
  bgRec: null,
};

// ── Structured map data (BiomeGenerator JSON) ─────────────────────────────
const mapDataState = {
  url: "",       // last URL successfully requested
  data: null,    // parsed JSON: { biome, terrain_grid, water_cells, ... }
  loading: false,
  borderMap: null, // Map<"row,col", land_mask> for O(1) border-cell lookup
};

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

  const nowMs = Date.now();

  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, gs * tile, gs * tile);
  ctx.clip();

  // Ajuste de cor: converte o azul-cyan do spritesheet (rgb≈54,143,190 / H≈201°)
  // para o azul-periwinkle do beach.png (rgb≈139,160,213 / H≈223°).
  // Cálculo: hue+22° / brightness×1.44 / saturate×0.84
  // globalAlpha deixa assets abaixo transparecerem através da camada de onda.
  ctx.filter = 'hue-rotate(22deg) brightness(1.44) saturate(0.84)';
  ctx.globalAlpha = 0.85;

  for (let ry = 0; ry < Math.min(gh, gs); ry++) {
    for (let cx = 0; cx < Math.min(gw, gs); cx++) {
      if (grid[ry][cx] !== 1) continue; // only sand cells

      const mask = waterMask(grid, cx, ry);
      if (mask === 0) continue;          // no water neighbor

      const entry = SHORE[mask];
      if (!entry) continue;              // mask combo not in table

      const frame = animFrame(nowMs, cx, ry);
      const sx    = entry.x + frame * SHORE_TILE;
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

async function maybeLoadMapData() {
  const url = safeStr(appState.board?.mapDataUrl || "");
  if (!url || url === mapDataState.url || mapDataState.loading) return;
  mapDataState.url = url;
  mapDataState.loading = true;
  try {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      mapDataState.data = data;
      // Pre-build border Set for fast per-cell lookup
      // Python exports "water_cells" as [{grid_x, grid_y, kind, land_mask}].
      // Build a Map "row,col" → land_mask for direction-aware tile selection.
      if (Array.isArray(data.water_cells)) {
        mapDataState.borderMap = new Map(
          data.water_cells
            .filter(c => c.kind === 'border')
            .map(c => [`${c.grid_y},${c.grid_x}`, c.land_mask || 0])
        );
      } else {
        mapDataState.borderMap = null;
      }
    } else {
      mapDataState.data = null;
      mapDataState.borderMap = null;
    }
  } catch (e) {
    console.warn("[mapData] fetch failed:", e);
    mapDataState.data = null;
    mapDataState.borderSet = null;
  } finally {
    mapDataState.loading = false;
  }
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
// (matches the actual PNG you uploaded)
const OCEAN_TS = 32;
const OCEAN_SHEET_X0 = 7;
const OCEAN_SHEET_Y0 = 9;
const OCEAN_FRAME_GAP_Y = 16;
const OCEAN_FRAME_STRIDE_Y = OCEAN_TS + OCEAN_FRAME_GAP_Y;

function oceanSrcForMask(mask, frameIndex) {
  const tc = OCEAN_AUTOTILE_MAP[mask] || { r: 1, c: 1 };
  const col = (tc.r * 5) + tc.c; // flatten 5×3 to single row index
  const sx = OCEAN_SHEET_X0 + col * OCEAN_TS;
  const sy = OCEAN_SHEET_Y0 + frameIndex * OCEAN_FRAME_STRIDE_Y;
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

function getActiveMapUrl() {
  const fromOverride = safeStr(mapUrlOverride);
  if (fromOverride) return fromOverride;
  const b = appState.board || {};
  return safeStr(b.mapUrl || b.map_url || b.backgroundUrl || "");
}

function maybeRebuildMapCache() {
  // Fire-and-forget fetch of structured map JSON when mapDataUrl changes
  maybeLoadMapData();

  const gs = appState.gridSize || 10;
  const theme = safeStr(appState.theme) || "biome_grass";
  const seed = _u32(appState.board?.seed || 0);
  const bgUrl = getActiveMapUrl();
  const key = `${gs}|${theme}|${seed}|${bgUrl}`;
  if (key === mapCache.key) return;

  mapCache.key = key;
  mapCache.gs = gs;
  mapCache.theme = theme;
  mapCache.seed = seed;
  mapCache.bgUrl = bgUrl;
  mapCache.bgRec = bgUrl ? loadSprite(bgUrl) : null;

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
function drawWeatherOverlay(ctx, ox, oy, gs, tile, w, h) {
  // Lê o clima e terreno do Firestore (public_state/battle)
  const weather = safeStr(appState.battle?.weather  || appState.board?.weather  || '').toLowerCase();
  const terrain = safeStr(appState.battle?.terrain  || appState.board?.terrain  || '').toLowerCase();

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
  const rect = canvasWrap.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
// CORREÇÃO: Se a aba estiver escondida (largura 0), não tenta desenhar
  if (w <= 0 || h <= 0 || view.scale <= 0) {
    requestAnimationFrame(draw);
    return;
  }
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

  // tiles / mapa
  maybeRebuildMapCache();
  const bg = mapCache.bgRec;
  if (bg && bg.ready && !bg.failed) {
    // Desenha PNG esticado no grid (mantém tiles por cima)
    ctx.globalAlpha = 0.92;
    ctx.drawImage(bg.img, ox, oy, gs * tile, gs * tile);
    ctx.globalAlpha = 1;
    // leve overlay para dar contraste
    ctx.fillStyle = 'rgba(2,6,23,0.10)';
    ctx.fillRect(ox, oy, gs * tile, gs * tile);
    // Animação de água sobre as células de terreno hídrico (terrain_grid == 2)
    drawWaterCells(ctx, ox, oy, gs, tile);
    // Camada de ondas batendo na areia (shore foam overlay)
    drawShoreOverlay(ctx, ox, oy, gs, tile);
  } else {
    drawProceduralMap(ctx, ox, oy, gs, tile);
  }




  // placing mode highlight (tiles válidos)
  const placingPid = getPlacingPokemonPid();
  if (placingPid) {
    ctx.fillStyle = "rgba(163, 230, 53, 0.10)"; // amarelo-esverdeado sutil
    for (let rr = 0; rr < gs; rr++) {
      for (let cc = 0; cc < gs; cc++) {
        if (isTileOccupied(rr, cc)) continue;
        const xh = ox + cc * tile;
        const yh = oy + rr * tile;
        ctx.fillRect(xh + 1, yh + 1, tile - 2, tile - 2);
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
        if (reach.has(`${r}:${c}`)) ctx.fillStyle = "rgba(244,114,182,0.22)";
        else ctx.fillStyle = "rgba(239,68,68,0.18)";
        ctx.fillRect(xh + 1, yh + 1, tile - 2, tile - 2);
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
  const oppOwners = [...new Set(pieces
    .filter(p => safeStr(p?.owner) && safeStr(p?.owner) !== _by && safeStr(p?.status || "active") === "active")
    .map(p => safeStr(p.owner))
  )].sort();
  const _oppColorMap = {};
  for (let i = 0; i < oppOwners.length; i++) {
    _oppColorMap[oppOwners[i]] = _oppColors[i % _oppColors.length];
  }

  // Track which sprite overlay elements are used this frame
  const _usedSpriteIds = new Set();

  for (const p of pieces) {
    if (safeStr(p?.status || "active") !== "active") continue;
    if (!isPieceVisibleToMe(p)) continue;
    const row = Number(p?.row);
    const col = Number(p?.col);
    if (!Number.isFinite(row) || !Number.isFinite(col)) continue;
    const x = ox + col * tile;
    const y = oy + row * tile;
    const id = safeStr(p?.id);
    const owner = safeStr(p?.owner);
    const isSel = safeStr(appState.selectedPieceId) && safeStr(appState.selectedPieceId) === id;
    const isMine = _by && owner === _by;

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

    // token base fill
    ctx.fillStyle = colorScheme.fill;
    ctx.fillRect(x + 2, y + 2, tile - 4, tile - 4);

    // sprite — rendered as HTML <img> overlay for GIF animation support
    const _psPiece = ((_partyStates && _partyStates[owner]) ? _partyStates[owner] : {})[safeStr(p?.pid)] || {};
    const sprUrl = getSpriteUrlForPiece(p, { type: "battle", shiny: !!_psPiece.shiny });
    const pad = Math.max(6, Math.floor(tile * 0.12));

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
        // Fallback chain: local GIF → remote PokemonDB PNG → hide
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
      // Compute remote fallback URL (PokemonDB sprite)
      const _name = resolvePokemonNameFromPid(p?.pid);
      const _fbSlug = _name ? spriteSlugFromPokemonName(_name) : "";
      const remoteFb = _fbSlug
        ? `https://img.pokemondb.net/sprites/home/normal/${_fbSlug}.png`
        : "";
      // Update src only when URL changes
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
      // Position the <img> over the tile
      // ctx coordinates are already in CSS pixels (DPR transform applied),
      // and the overlay div matches the canvas CSS size via inset:0
      const st = entry.el.style;
      st.left = (x + pad) + "px";
      st.top = (y + pad) + "px";
      st.width = (tile - pad * 2) + "px";
      st.height = (tile - pad * 2) + "px";
    } else {
      // fallback glyph (no sprite URL)
      ctx.fillStyle = "rgba(226,232,240,0.85)";
      ctx.font = `900 ${Math.max(10, Math.floor(tile * 0.22))}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = (p?.revealed ? String(p?.pid ?? "?") : "?").slice(0, 4);
      ctx.fillText(label, x + tile / 2, y + tile / 2);
    }

    // Dynamic border
    ctx.strokeStyle = colorScheme.border;
    ctx.lineWidth = isSel ? 3 : (isMine || _oppColorMap[owner]) ? 2 : 1;
    ctx.strokeRect(x + 2, y + 2, tile - 4, tile - 4);

    // Glow effect for selected piece
    if (isSel) {
      ctx.save();
      ctx.shadowColor = _selColor.glow;
      ctx.shadowBlur = 8;
      ctx.strokeStyle = _selColor.border;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, tile - 2, tile - 2);
      ctx.restore();
    }
  }

  // Remove stale overlay sprites (pieces no longer visible)
  for (const [pid, entry] of _spritePool) {
    if (!_usedSpriteIds.has(pid)) {
      entry.el.remove();
      _spritePool.delete(pid);
    }
  }

  // drag ghost
  if (appState.drag.active && appState.selectedPieceId) {
    ctx.fillStyle = "rgba(56,189,248,0.10)";
    ctx.beginPath();
    ctx.arc(appState.drag.x, appState.drag.y, Math.max(10, tile * 0.32), 0, Math.PI * 2);
    ctx.fill();
  }

  requestAnimationFrame(draw);
}

// Start arena
bindArenaInteractionsCanvas();
bindArenaInteractionsDom();

if (useCanvas) {
  if (canvas) canvas.style.display = "block";
  if (arenaDom) arenaDom.style.display = "none";
  updateHudViewportHeight();
  resizeCanvasToContainer();
  fitToView();
  requestAnimationFrame(draw);
} else {
  // fallback DOM (sempre mostra algo, mesmo se o canvas falhar)
  renderArenaDom();
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

let _allSheetsLatest = [];   // lista (desc por updated_at) do trainer logado
let _partyStates = {};
let _sheetsSelectedPid = null;
let _sheetsLastError = "";

function safePidValue(x) {
  let v = safeStr(x);
  if (!v) return "";
  if (v.startsWith("EXT:")) return v;
  if (v.startsWith("PID:")) v = v.slice(4);
  // tira zeros à esquerda apenas se for número
  if (/^\d+$/.test(v)) return (v.replace(/^0+/, "") || "0");
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
    display: grid; grid-template-columns: repeat(3,1fr); gap: 6px;
  }
  .stat-boost-row {
    display: flex; align-items: center; justify-content: center; gap: 4px;
    background: rgba(255,255,255,.04); border-radius: 10px; padding: 4px 6px;
  }
  .stat-boost-name { font-size: 11px; font-weight: 700; min-width: 34px; text-align:right; }
  .stat-boost-val {
    font-size: 14px; font-weight: 900; min-width: 24px; text-align: center;
  }
  .stat-boost-val.boost-pos { color: #4ade80; }
  .stat-boost-val.boost-neg { color: #f87171; }
  .stat-boost-btn {
    padding: 0 6px; height: 22px; min-width: 22px; font-size: 14px; line-height: 1;
    border-radius: 6px;
  }
  /* versão compacta no inspector */
  #inspector_root .stat-boost-panel { margin: 6px 0; }
  #inspector_root .stat-boost-grid { grid-template-columns: repeat(3,1fr); gap: 4px; }
  #inspector_root .stat-boost-title, #inspector_root .stat-boost-name, #inspector_root .stat-boost-val { font-size: 11px; }

  @media (max-width: 900px) {
    #inspector_root .inspector-title, .ficha-v2 .section-title { font-size: 28px; }
    .ficha-v2 .sheet-name { font-size: 34px; }
    .ficha-v2 .sheet-sub, .ficha-v2 .hp-row { font-size: 24px; }
    .ficha-v2 .type-pill, .ficha-v2 .chip, .ficha-v2 .mv-pill, .ficha-v2 .stat-label { font-size: 16px; }
    .ficha-v2 .stat-val { font-size: 28px; }
    .ficha-v2 .move-h-name { font-size: 24px; }
    .ficha-v2 .sheet-art { width: 118px; height: 118px; }
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
}

function ensureSheetsUI() {
  const root = $("tab_sheets");
  if (!root) return false;

  // já existe?
  if (root.querySelector("#cardsGrid") && root.querySelector("#sheetDetail") && root.querySelector("#sheetsLoading")) {
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
        <div>
          <div class="cards-grid" id="cardsGrid"></div>
        </div>
        <div id="sheetDetailWrap" style="display:none;">
          <div id="sheetDetail">
            <div class="sheets-empty">Selecione um card.</div>
          </div>
        </div>
      </div>
    </div>

    <div id="sheetsError" style="display:none; margin-top: 12px; color: #ef4444; font-weight: 800;"></div>
  `;
  return true;
}

function teardownSheetsRealtime() {
  try { if (_sheetsUnsub) _sheetsUnsub(); } catch {}
  try { if (_partyStatesUnsub) _partyStatesUnsub(); } catch {}
  _sheetsUnsub = null;
  _partyStatesUnsub = null;
  _sheetsRtKey = null;

  _allSheetsLatest = [];
  _partyStates = {};
  _sheetsSelectedPid = null;
  _sheetsLastError = "";
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
  if (_sheetsRtKey === key) return;

  teardownSheetsRealtime();
  ensureSheetsUI();
  _sheetsRtKey = key;

  // party_states (HP/cond) — opcional
  try {
    const psDoc = doc(db, "rooms", rid, "public_state", "party_states");
    _partyStatesUnsub = onSnapshot(psDoc, (snap) => {
      _partyStates = snap.exists() ? (snap.data() || {}) : {};
      renderSheetsTab();
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

function _mvStat(meta, stats) {
  meta = meta || {};
  stats = stats || {};
  const cat = safeStr(meta.category || meta.categoria || "").toLowerCase();
  let label = "—", val = 0;
  if (cat.includes("physical") || cat.includes("físic")) { label = "Stgr"; val = parseInt(stats.stgr || 0) || 0; }
  else if (cat.includes("special") || cat.includes("especial")) { label = "Int"; val = parseInt(stats["int"] || 0) || 0; }
  return { label, val };
}
function _mvIsArea(mv) {
  const m = (mv && mv.meta) ? mv.meta : {};
  if (m.perception_area || m.is_area || m.area) return true;
  const b = safeStr(mv && mv.build);
  return b.toLowerCase().includes("área") || b.toLowerCase().includes("area") || b.toLowerCase().includes("aoe");
}
function _mvSum(mv, stats) {
  const br = parseInt(mv?.rank || mv?.Rank || 0) || 0;
  const acc = parseInt(mv?.accuracy || mv?.Accuracy || mv?.acerto || 0) || 0;
  const { label, val } = _mvStat(mv?.meta || {}, stats);
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
  if (/^\d+$/.test(k)) {
    const n = Number(k);
    if (Number.isFinite(n) && n > 0 && n < 20000) {
      return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${n}.png`;
    }
  }
  return "";
}

function _setSheetsBadges() {
  const rid = safeStr(appState.rid) || "—";
  const by = safeStr(appState.by) || "—";
  const phase = safeStr(appState.battle?.status) || "idle";

  const ridEl = document.getElementById("ridBadgeSheets");
  const meEl = document.getElementById("meBadgeSheets");
  const phEl = document.getElementById("phaseBadgeSheets");
  const syncEl = document.getElementById("syncBadgeSheets");

  if (ridEl) ridEl.textContent = `sala: ${rid}`;
  if (meEl) meEl.textContent = `by: ${by}`;
  if (phEl) phEl.textContent = phase;

  if (syncEl) {
    const ok = !!appState.connected;
    syncEl.textContent = ok ? "Sincronizado ✓" : "—";
    syncEl.className = ok ? "pill ok" : "pill";
  }
}

function renderSheetsTab() {
  const root = $("tab_sheets");
  if (!root) return;

  ensureSheetsUI();
  _setSheetsBadges();

  const loadingEl = document.getElementById("sheetsLoading");
  const contentEl = document.getElementById("sheetsContent");
  const cardsGrid = document.getElementById("cardsGrid");
  const detailEl = document.getElementById("sheetDetail");
  const countEl = document.getElementById("sheetsCount");
  const errEl = document.getElementById("sheetsError");

  if (!cardsGrid || !detailEl || !loadingEl || !contentEl) return;

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
    if (countEl) countEl.textContent = "0";
    loadingEl.style.display = "";
    contentEl.style.display = "none";
    cardsGrid.innerHTML = "";
    detailEl.innerHTML = `<div class="sheets-empty">Conecte numa sala para ver as fichas.</div>`;
    return;
  }

  const by = safeStr(appState.by);
  if (!by) {
    if (countEl) countEl.textContent = "0";
    loadingEl.style.display = "";
    contentEl.style.display = "none";
    cardsGrid.innerHTML = "";
    detailEl.innerHTML = `<div class="sheets-empty">Preencha <b>by</b> e conecte (login) para puxar sua party.</div>`;
    return;
  }

  // Party (do login/users_raw/party_snapshot)
  const party = getPartyForTrainer(by) || [];
  const partyPids = party.map((it) => safePidValue(it?.pid ?? it?.pokemon?.id ?? it)).filter(Boolean);

  // cria mapa pid->sheet (primeira ocorrência = mais recente)
  const byPid = {};
  for (const sh of (_allSheetsLatest || [])) {
    const pid = safePidValue(sh?.pokemon?.id);
    if (pid && !byPid[pid]) byPid[pid] = sh;
    const lp = safePidValue(sh?.linked_pid);
    if (lp && !byPid[lp]) byPid[lp] = sh;
  }

  const sheets = [];
  const seen = new Set();
  for (const rawPid of partyPids) {
    const pid = safePidValue(rawPid);
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    let sh = byPid[pid] || byPid[(safeStr(pid).replace(/^0+/, "") || "0")];
    if (sh) sheets.push(Object.assign({}, sh, { _party_pid_raw: rawPid }));
  }

  if (countEl) countEl.textContent = String(sheets.length);

  // UI states
  loadingEl.style.display = "none";
  contentEl.style.display = "";

  if (!partyPids.length) {
    cardsGrid.innerHTML = `<div class="sheets-empty" style="grid-column:1/-1">Sua party está vazia (ou não foi encontrada ainda).<br/>
    Dica: entre na sala pelo Streamlit 1x (espelha users_raw) ou garanta que <code>party_snapshot</code> está preenchido.</div>`;
    detailEl.innerHTML = `<div class="sheets-empty">—</div>`;
    return;
  }

  if (!sheets.length) {
    cardsGrid.innerHTML = `<div class="sheets-empty" style="grid-column:1/-1">📭 Sem fichas encontradas para a sua party.<br/>
    Salve fichas em <b>Criação Guiada</b> e mantenha a party no <b>Trainer Hub</b>.</div>`;
    detailEl.innerHTML = `<div class="sheets-empty">—</div>`;
    return;
  }

  // selecionado
  if (!_sheetsSelectedPid || !sheets.some((x) => safePidValue((x.pokemon || {}).id) === _sheetsSelectedPid)) {
    _sheetsSelectedPid = safePidValue((sheets[0]?.pokemon || {}).id);
  }

  // ---- render cards
  cardsGrid.innerHTML = "";
  for (const sh of sheets) {
    const pkm = sh.pokemon || {};
    const pid = safePidValue(pkm.id);
    const pname = safeStr(pkm.name) || "Pokémon";
    const types = Array.isArray(pkm.types) ? pkm.types : [];
    const np = sh.np ?? pkm.np ?? "—";
    const stats = sh.stats || {};

    const movesRaw = Array.isArray(sh.moves) ? sh.moves : (sh.moves ? Object.values(sh.moves) : []);
    const moves = (movesRaw || []).filter((m) => m && typeof m === "object");
    const preview = moves.slice(0, 3);

    const isSel = pid === _sheetsSelectedPid;

    let mvH = "";
    for (const mv of preview) {
      const n = safeStr(mv.name || mv.Nome || mv.nome || "Golpe");
      const { rk, acc, label, val, area, br } = _mvSum(mv, stats);
      const brk = ((label === "Stgr" || label === "Int") && val) ? `(R${br}+${val} ${label})` : `(R${br})`;
      const mvColor = _moveTypeColor(n);
      const isStab = _isMoveStab(n, types);
      mvH += `
        <div class="card-move-row${isStab ? " move-stab-card" : ""}"${isStab ? ` style="--stab-color:${mvColor}"` : ""}>
          <span class="card-move-name" style="${mvColor ? `color:${mvColor}` : ""}">${escapeHtml(n)}${isStab ? " ★" : ""}</span>
          <span class="mv-pill acc">A+${acc}</span>
          <span class="mv-pill rk">R${rk}</span>
          <span class="mv-pill area">${area ? "Área" : "Alvo"}</span>
        </div>
        <div style="opacity:.7;font-size:.68rem;font-weight:900;margin-bottom:3px;">${escapeHtml(brk)}</div>
      `;
    }
    if (!mvH) mvH = `<div style="opacity:.6;font-size:.78rem;">Sem golpes nesta ficha.</div>`;

    const tp = (types || []).map((t) => _typePill(t)).join("");

    const _psCard2 = ((_partyStates && _partyStates[by]) ? _partyStates[by] : {})[pid] || {};
    const sprite = _artUrlFromPidForSheets(pid, _psCard2.shiny) || _spriteUrlFromPidForSheets(pid) || "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png";

    const card = document.createElement("div");
    card.className = `poke-card${isSel ? " selected" : ""}`;
    card.style.setProperty("--card-bg", _typeBg(types));
    card.addEventListener("click", () => {
      _sheetsSelectedPid = pid;
      renderSheetsTab();
      updateSidePanels();
    });

    card.innerHTML = `
      <div class="card-head">
        <img src="${escapeAttr(sprite)}" alt="sprite" loading="lazy"
          onerror="this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'"/>
        <div class="card-info">
          <div class="card-name">${escapeHtml(pname)}</div>
          <div class="card-sub">#${escapeHtml(pid)} • NP ${escapeHtml(String(np))}</div>
          <div class="pill-row">${tp}</div>
        </div>
      </div>
      <div class="card-divider"></div>
      <div class="card-moves-label">Golpes</div>
      ${mvH}
      <div class="card-open">Abrir ficha →</div>
    `;
    cardsGrid.appendChild(card);
  }

  // ---- render detail
  const sh = sheets.find((x) => safePidValue((x.pokemon || {}).id) === _sheetsSelectedPid) || sheets[0];
  if (!sh) {
    detailEl.innerHTML = `<div class="sheets-empty">Selecione um card.</div>`;
    return;
  }

  const pkm = sh.pokemon || {};
  const pid = safePidValue(pkm.id);
  const pname = safeStr(pkm.name) || "Pokémon";
  const types = Array.isArray(pkm.types) ? pkm.types : [];
  const abilities = Array.isArray(pkm.abilities) ? pkm.abilities : [];
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

  // HP/cond (se existir)
  const ps = ((_partyStates && _partyStates[by]) ? _partyStates[by] : {})[pid] || {};
  const hp = (ps.hp ?? 6);
  const cond = Array.isArray(ps.cond) ? ps.cond : [];
  const hpMax = 6;
  const hpPct = Math.max(0, Math.min(100, (hp / hpMax) * 100));
  const hpCol = (hpPct > 50) ? "rgba(34,197,94,1)" : (hpPct > 25) ? "rgba(234,179,8,1)" : "rgba(239,68,68,1)";

  const tp = (types || []).map((t) => `
    <span class="type-pill" style="background:${_tc(t)}33;border-color:${_tc(t)}55;color:${_tc(t)}">${escapeHtml(t)}</span>
  `).join("");

  const abH = abilities.length
    ? `<div class="chip-row" style="margin-top:6px;">${
        abilities.map((a) => `<span class="chip" style="border-color:rgba(56,189,248,.35);color:#38bdf8;">${escapeHtml(a)}</span>`).join("")
      }</div>`
    : "";

  const condH = cond.length
    ? `<div class="chip-row" style="margin-top:4px;">${
        cond.map((c) => `<span class="chip" style="border-color:rgba(249,115,22,.35);color:#f97316;">${escapeHtml(c)}</span>`).join("")
      }</div>`
    : "";

  let skH = `<span style="opacity:.75;font-size:.82rem;">Sem skills.</span>`;
  if (skills.length) {
    const chips = skills
      .filter((x) => x && typeof x === "object" && safeStr(x.name) && parseInt(x.ranks || 0))
      .map((x) => `<span class="chip">${escapeHtml(x.name)} R${parseInt(x.ranks || 0)}</span>`);
    if (chips.length) skH = `<div class="chip-row">${chips.join("")}</div>`;
  }

  const advChips = advantages.filter((a) => safeStr(a)).map((a) => `<span class="chip">${escapeHtml(a)}</span>`);
  const advH = advChips.length ? `<div class="chip-row">${advChips.join("")}</div>` : `<span style="opacity:.75;font-size:.82rem;">Sem advantages.</span>`;

  let mvH = "";
  if (!moves.length) {
    mvH = `<span style="opacity:.75;font-size:.82rem;">Sem golpes nesta ficha.</span>`;
  } else {
    for (const mv of moves) {
      const n = safeStr(mv.name || mv.Nome || mv.nome || "Golpe");
      const { rk, acc, label, val, area, br } = _mvSum(mv, st);
      const brk = ((label === "Stgr" || label === "Int") && val) ? `R${br}+${val} ${label}` : `R${br}`;

      const meta = mv.meta || {};
      const ranged = meta.ranged === true;
      const tags = [area ? "Área" : "Alvo"];
      if (ranged) tags.push("Ranged");
      const tagH = tags.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join("");

      const desc = safeStr(mv.description || mv.desc || "");
      const build = safeStr(mv.build || "");
      const body = desc
        ? escapeHtml(desc)
        : (build
          ? `<code style="font-size:.78rem;white-space:pre-wrap;display:block;background:rgba(255,255,255,.04);padding:8px;border-radius:10px;margin-top:4px;">${escapeHtml(build)}</code>`
          : `<span>Descrição não disponível.</span>`);

      // Tipo e STAB
      const mvType = getMoveType(n);
      const mvColor = mvType ? getTypeColor(mvType) : "";
      const isStab = _isMoveStab(n, types);
      const stabClass = isStab ? " move-stab" : "";
      const typeTag = mvType ? `<span class="mv-type-pill" style="background:${mvColor}33;border:1px solid ${mvColor}66;color:${mvColor}">${mvType}</span>` : "";

      mvH += `
        <div class="move-expander${stabClass}"${isStab ? ` style="--stab-color:${mvColor}"` : ""}>
          <div class="move-header">
            <span class="arrow">▶</span>
            <span class="move-h-name" style="${mvColor ? `color:${mvColor}` : ""}">${escapeHtml(n)}</span>
            ${typeTag}
            <span class="mv-pill acc">A+${acc}</span>
            <span class="mv-pill rk">R${rk}</span>
            <span class="mv-pill area">${area ? "Área" : "Alvo"}</span>
          </div>
          <div class="move-body">
            <div class="chip-row" style="margin-bottom:6px;">${tagH}</div>
            <div style="margin-bottom:4px;font-size:.82rem;opacity:.75;">${escapeHtml(brk)}</div>
            <div>${body}</div>
            <input class="notes-input" placeholder="Anotações..." />
          </div>
        </div>
      `;
    }
  }

  const art = _artUrlFromPidForSheets(pid, ps.shiny) || _spriteUrlFromPidForSheets(pid) || "";
  // Fundo tipo-estilizado para a ficha
  const typeBgStyle = _fichaTypeBg(types);

  detailEl.innerHTML = `
    <div class="sheet-panel ficha-v2" style="${typeBgStyle}">
      <div class="sheet-header">
        <div class="sheet-art-frame"><img class="sheet-art" src="${escapeAttr(art)}" alt="art"
          onerror="this.src='${escapeAttr(_spriteUrlFromPidForSheets(pid))}'"/></div>
        <div style="flex:1; min-width:0;">
          <div class="sheet-name">${escapeHtml(pname)}</div>
          <div class="sheet-sub">#${escapeHtml(pid)} • NP ${np}</div>
          <div class="pill-row" style="margin-top:6px;">${tp}</div>
          <div class="pill-row" style="margin-top:8px;">${abilities.map((a) => `<span class="chip ability-pill">${escapeHtml(a)}</span>`).join("")}</div>${condH}
          <div style="margin-top:10px;">
            <div class="hp-row">
              <span>HP</span><span>${hp} / ${hpMax}</span>
            </div>
            <div class="hp-track"><div class="hp-fill" style="width:${hpPct}%;background:${hpCol};"></div></div>
          </div>
        </div>
      </div>

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

      <div class="sheet-divider"></div>
      <div class="section-title">Skills</div>${skH}
      <div class="section-title">Advantages</div>${advH}
      <div class="sheet-divider"></div>
      <div class="section-title">Golpes</div>${mvH}
    </div>
  `;

  // Wire expanders
  detailEl.querySelectorAll(".move-header").forEach((h) => {
    h.addEventListener("click", () => {
      const parent = h.parentElement;
      if (parent) parent.classList.toggle("open");
    });
  });

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
window.updateSidePanels   = updateSidePanels;
window.getPartyForTrainer = getPartyForTrainer;
window.selectPiece        = selectPiece;
window.togglePieceRevealed = togglePieceRevealed;
window.removePieceFromBoard = removePieceFromBoard;
window.startPlacePokemon  = startPlacePokemon;
window.screenToTile       = screenToTile;
window.getPieceAt         = getPieceAt;
window.canCurrentPlayerStartCombat = canCurrentPlayerStartCombat;
window.canCurrentPlayerPassTurn = canCurrentPlayerPassTurn;
window.isPieceVisibleToMe = isPieceVisibleToMe;
window.getSpriteUrlFromPid = getSpriteUrlFromPid;
window.localSpriteUrl      = localSpriteUrl;
window.spriteUrlWithFallback = spriteUrlWithFallback;
window.spriteSlugFromPokemonName = spriteSlugFromPokemonName;
window._arenaView              = view;
window.DEFAULT_FIREBASE_CONFIG = DEFAULT_FIREBASE_CONFIG; // exposto para patches (avatar URL)
window.currentDb          = null;
window.currentRid         = null;
window.runTransaction     = runTransaction;
window.serverTimestamp    = serverTimestamp;
window.getStateDocRef     = getStateDocRef;
window.getBattleDocRef    = getBattleDocRef;
// Mantém window.currentRid e window.currentDb sincronizados com appState
setInterval(() => {
  window.currentRid = appState.rid || null;
  window.currentDb  = window._combatDb || null;
}, 300);
