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
const addLogBtn = $("btn_add_log");
const logTextInput = $("log_text");
const moveBtn = $("btn_move_piece");
const pieceIdInput = $("pieceId");
const rowInput = $("row");
const colInput = $("col");

// arena render target
const canvas = $("arena");
const canvasWrap = $("arena_wrap");
const arenaDom = $("arena_dom");

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
  // UI selection
  selectedPieceId: null,
  placingPid: null,
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
};

// -------------------------
// Dex / Map overrides (localStorage)
// -------------------------
const STORAGE_KEYS = {
  dexMap: 'pvp_dex_map_json',
  mapUrl: 'pvp_map_url_override',
};

let dexMap = null; // { pidStr: name }
let mapUrlOverride = '';

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
  dexMap = loadDexMapFromStorage();
  mapUrlOverride = loadMapOverrideFromStorage();
  // tenta assets apenas se ainda não tem nada no storage
  if (!dexMap) {
    tryLoadDexMapFromAssets().then((obj) => {
      if (obj && !dexMap) {
        dexMap = obj;
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

function ensureUserSubscriptions() {
  if (!currentDb) return;
  const wanted = new Map(); // uid -> trainer_name
  const by = safeStr(appState.by);
  if (by) wanted.set(safeDocId(by), by);
  for (const p of (appState.players || [])) {
    const tn = safeStr(p?.trainer_name);
    if (!tn) continue;
    wanted.set(safeDocId(tn), tn);
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
  if (meBadge) meBadge.textContent = `by: ${safeStr(appState.by) || "—"}`;
  if (roleBadge) roleBadge.textContent = `role: ${appState.role || "—"}`;

  const phase = safeStr(appState.battle?.status) || "idle";
  if (phaseBadge) phaseBadge.textContent = phase;
  if (trainerNameEl) trainerNameEl.textContent = safeStr(appState.by) || "—";
  if (avatarIcon) avatarIcon.textContent = safeStr(appState.by)?.slice(0, 1)?.toUpperCase() || "🙂";

  const synced = appState.connected ? "Sincronizado ✓" : "—";
  if (syncBadge) syncBadge.textContent = synced;
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
    return;
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
  } catch (e) {
    setStatus("err", `erro ao enviar ação: ${e?.message || e}`);
  }
}

addLogBtn?.addEventListener("click", async () => {
  const by = safeStr(byInput?.value || "Anon") || "Anon";
  const text = safeStr(logTextInput?.value || "") || "teste";
  await sendAction("ADD_LOG", by, { text });
  logTextInput.value = "";
});

moveBtn?.addEventListener("click", async () => {
  const by = safeStr(byInput?.value || "Anon") || "Anon";
  const pieceId = safeStr(pieceIdInput?.value || "");
  const row = Number(rowInput?.value);
  const col = Number(colInput?.value);
  if (!pieceId) {
    setStatus("err", "faltou pieceId (use public_state/state.pieces[].id)");
    return;
  }
  if (!Number.isFinite(row) || !Number.isFinite(col)) {
    setStatus("err", "row/col precisam ser números");
    return;
  }
  await sendAction("MOVE_PIECE", by, { pieceId, row, col });
});

// Expor no console (compatibilidade com debug antigo)
window.sendAddLog = async (by, text) => sendAction("ADD_LOG", by || "Anon", { text: text || "teste" });
window.sendMovePiece = async (by, pieceId, row, col) =>
  sendAction("MOVE_PIECE", by || "Anon", {
    pieceId: String(pieceId || ""),
    row: Number(row),
    col: Number(col),
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

  if (playersPre) playersPre.textContent = "—";
  if (statePre) statePre.textContent = "—";
  if (battlePre) battlePre.textContent = "—";
  if (actionsLogEl) actionsLogEl.textContent = "—";
  if (lastActionEl) lastActionEl.textContent = "—";
  if (logList) logList.innerHTML = "";
  if (logCount) logCount.textContent = "0";

  updateSidePanels();
  updateTopBadges();
  setStatus("warn", "desconectado");
}

disconnectBtn?.addEventListener("click", cleanup);

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
  setStatus("ok", "conectado");
  updateTopBadges();

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
        if (statePre) statePre.textContent = pretty(data);
        updateArenaMeta();
        updateSidePanels();
        if (!useCanvas) renderArenaDom();
        if (useCanvas && view.autoFit) fitToView();
      },
      (err) => {
        if (statePre) statePre.textContent = "Erro: " + err.message;
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
        renderLogsIncremental();
      },
      (err) => {
        if (battlePre) battlePre.textContent = "Erro: " + err.message;
      }
    )
  );

  // Últimas actions (debug)
  const actionsCol = collection(db, "rooms", rid, "actions");
  const actionsQ = query(actionsCol, orderBy("createdAt", "desc"), limit(20));
  unsub.push(
    onSnapshot(
      actionsQ,
      (qs) => {
        if (!actionsLogEl) return;
        const items = [];
        qs.forEach((d) => {
          const a = d.data() || {};
          items.push({
            id: d.id,
            type: a.type,
            status: a.status || "new",
            by: a.by,
            payload: a.payload,
            createdAt: a.createdAt,
            appliedAt: a.appliedAt,
            reason: a.reason,
            error: a.error,
          });
        });
        actionsLogEl.textContent = JSON.stringify(items, null, 2);
      },
      (err) => {
        if (actionsLogEl) actionsLogEl.textContent = JSON.stringify({ error: String(err?.message || err) }, null, 2);
      }
    )
  );

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
}

// Keep badges updated when user edits inputs
byInput?.addEventListener("input", () => {
  appState.by = safeStr(byInput.value);
  appState.role = inferRoleFromPlayers(appState.players, appState.by);
  updateTopBadges();
  updateSidePanels();
});

function updateArenaMeta() {
  if (!arenaMeta) return;
  const gs = appState.gridSize || 10;
  arenaMeta.textContent = `grid ${gs}×${gs} • tema ${appState.theme || "—"}`;
}

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

function getSpriteUrlFromPid(pid) {
  const k = safeStr(pid);
  if (!k) return "";

  // 1) EXT:Nome (convenção do seu app)
  if (k.startsWith("EXT:")) {
    const nm = safeStr(k.slice(4));
    return nm ? spriteUrlFromPokemonName(nm) : "";
  }

  // 2) ✅ Regional Dex: id -> name -> slug -> sprite
  const nm = dexNameFromPid(k);
  if (nm) return spriteUrlFromPokemonName(nm);

  // 3) Se vier um nome/slug direto, tenta sprite por nome (ex.: "Muk-A")
  if (!/^\d+$/.test(k)) return spriteUrlFromPokemonName(k);

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
  let n = safeStr(name);
  if (!n) return "";

  // Formatos tipo: "Muk (Alola)" / "Ponyta (Galar)"
  n = n.replace(/\s*\(\s*galar\s*\)\s*/ig, "-galar");
  n = n.replace(/\s*\(\s*alola\s*\)\s*/ig, "-alola");
  n = n.replace(/\s*\(\s*hisui\s*\)\s*/ig, "-hisui");
  n = n.replace(/\s*\(\s*paldea\s*\)\s*/ig, "-paldea");

  // Adjetivos tipo: "Alolan Muk" / "Galarian Ponyta"
  if (/\bgalarian\b/i.test(n)) n = n.replace(/\bgalarian\b/ig, "").trim() + "-galar";
  if (/\balolan\b/i.test(n))   n = n.replace(/\balolan\b/ig, "").trim() + "-alola";
  if (/\bhisuian\b/i.test(n))  n = n.replace(/\bhisuian\b/ig, "").trim() + "-hisui";
  if (/\bpaldean\b/i.test(n))  n = n.replace(/\bpaldean\b/ig, "").trim() + "-paldea";

  // Atalhos do seu padrão: Muk-A / A-Muk / Mr-Mime-A etc (aceita hífen no nome)
  n = n.replace(/\b([a-zA-Z-]+)\s*-\s*a\b/g, "$1-alola");
  n = n.replace(/\b([a-zA-Z-]+)\s*-\s*g\b/g, "$1-galar");
  n = n.replace(/\b([a-zA-Z-]+)\s*-\s*h\b/g, "$1-hisui");
  n = n.replace(/\b([a-zA-Z-]+)\s*-\s*p\b/g, "$1-paldea");

  n = n.replace(/\ba\s*-\s*([a-zA-Z-]+)\b/g, "$1-alola");
  n = n.replace(/\bg\s*-\s*([a-zA-Z-]+)\b/g, "$1-galar");
  n = n.replace(/\bh\s*-\s*([a-zA-Z-]+)\b/g, "$1-hisui");
  n = n.replace(/\bp\s*-\s*([a-zA-Z-]+)\b/g, "$1-paldea");

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

  // PokemonDB usa sufixos diferentes para regionais
  if (slug.endsWith("-alola"))  slug = slug.slice(0, -6) + "-alolan";
  if (slug.endsWith("-galar"))  slug = slug.slice(0, -6) + "-galarian";
  if (slug.endsWith("-hisui"))  slug = slug.slice(0, -6) + "-hisuian";
  if (slug.endsWith("-paldea")) slug = slug.slice(0, -7) + "-paldean";

  return slug;
}

function spriteUrlFromPokemonName(name) {
  const slug = spriteSlugFromPokemonName(name);
  if (!slug) return "";
  return `https://img.pokemondb.net/sprites/home/normal/${slug}.png`;
}




function getSpriteUrlForPiece(p) {
  // 1) Prefer explicit spriteUrl if present
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
    return spriteUrlFromPokemonName(name);
  }

  // 3) Fallback: treat pid as NatDex number
  const pidRaw = Number(p?.pid);
  if (Number.isFinite(pidRaw) && pidRaw > 0 && pidRaw < 20000) {
    // Se tiver form, tenta buscar via slug do PokeAPI (ex: rotom-wash)
    if (form) {
      const baseName = dexNameFromPid(p?.pid) || "";
      if (baseName) {
        return spriteUrlFromPokemonName(baseName + "-" + form);
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

  // 1) party_snapshot vindo da sala
  const p = (appState.players || []).find(x => safeStr(x?.trainer_name) === tn);
  const snapParty = (p && Array.isArray(p.party_snapshot)) ? p.party_snapshot : [];

  // 2) users_raw/users (espelhado pelo Streamlit ou por outro processo)
  const uid = safeDocId(tn);
  const entry = appState.userProfiles?.get?.(uid);
  const raw = entry?.raw;
  const data = raw?.data || raw;
  const rawParty = Array.isArray(data?.party) ? data.party : [];

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
  const spriteUrl = getSpriteUrlFromPid(pid);
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
      <button class="pvp-btn" data-act="${onMap ? "select" : "place"}">${onMap ? "🎯 Selecionar" : (appState.placingPid === pid ? "📍 Clique no mapa" : "➕ Colocar")}</button>
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
          <input
            type="range"
            class="pvp-hp-slider"
            min="0"
            max="${maxHp}"
            step="1"
            value="${hp}"
            data-act="hp-slider"
            data-owner="${escapeAttr(ownerName)}"
            data-pid="${escapeAttr(pid)}"
            style="--hp-pct:${hpPct}%;--hp-col:${hpCol};"
          />
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
    startPlacePokemon(pid);
  });
  card.querySelector('[data-act="toggle"]')?.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    if (p?.id) await togglePieceRevealed(String(p.id));
  });
  card.querySelector('[data-act="remove"]')?.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    if (p?.id) await removePieceFromBoard(String(p.id));
  });

  card.querySelector('[data-act="hp-slider"]')?.addEventListener("input", async (ev) => {
    ev.stopPropagation();
    const newHp = Number(ev.target.value);
    if (!Number.isFinite(newHp)) return;
    await updatePartyStateHp(ownerName, pid, newHp);
  });
  return card;
}

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
  const spriteUrl = getSpriteUrlForPiece(p);

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

function updateSidePanels() {
  // Team list (prioridade: party_snapshot/users_raw -> fallback: peças no tabuleiro)
  const by = safeStr(appState.by);
  const pieces = Array.isArray(appState.pieces) ? appState.pieces : [];

  const myParty = by ? getPartyForTrainer(by) : [];
  const myPieces = by ? pieces.filter((p) => safeStr(p?.owner) === by && safeStr(p?.status || "active") !== "deleted") : [];
  const oppPiecesRaw = by ? pieces.filter((p) => safeStr(p?.owner) && safeStr(p?.owner) !== by && safeStr(p?.status || "active") !== "deleted") : pieces;
  const oppPieces = (oppPiecesRaw || []).filter((p) => isPieceVisibleToMe(p));

  // LEFT
  const teamRoot = $("team_list");
  if (!teamRoot) return;
  teamRoot.innerHTML = "";
  // Card de controles do selecionado (mover/ocultar/retirar)
  teamRoot.appendChild(renderSelectedControlsCard());
  if (!appState.connected) {
    const c = document.createElement("div");
    c.className = "card";
    c.innerHTML = `<div class="muted">Conecte numa sala para ver suas peças.</div>`;
    teamRoot.appendChild(c);
  } else if (myParty && myParty.length) {
    for (const it of myParty) teamRoot.appendChild(renderPartyCard(it, by));
  } else if (!myPieces.length) {
    teamRoot.innerHTML = `<div class="card"><div style="font-weight:950;margin-bottom:6px">Equipe não encontrada</div><div class="muted">Ainda não achei <code>party_snapshot</code>/<code>users_raw</code> e você não tem peças no tabuleiro. Opções: (1) preencha <code>by</code> e faça login (planilha) no conectar, ou (2) entre na sala 1x pelo Streamlit (ele espelha seu perfil para o Firestore).</div></div>`;
  } else {
    for (const p of myPieces) teamRoot.appendChild(renderPieceCard(p, true));
  }

  // RIGHT
  const oppRoot = $("opp_list");
  if (!oppRoot) return;
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
        const oppName = dexNameFromPid(oppPid) || (oppPid.startsWith("EXT:") ? oppPid.slice(4) : `PID ${oppPid}`);
        const oppSprite = getSpriteUrlFromPid(oppPid);
        const oppPs = ((_partyStates && _partyStates[owner]) ? _partyStates[owner] : {})[oppPid] || {};
        const oppHp = oppPs.hp != null ? Number(oppPs.hp) : 6;
        const oppHpPct = Math.max(0, Math.min(100, (oppHp / 6) * 100));
        const oppHpCol = oppHpPct > 66 ? "#22c55e" : oppHpPct > 33 ? "#f59e0b" : oppHp <= 0 ? "#64748b" : "#ef4444";
        const oppHpIcon = oppHp >= 5 ? "💚" : oppHp >= 3 ? "🟡" : oppHp >= 1 ? "🔴" : "💀";
        const mc = document.createElement("div");
        mc.className = "pvp-party-card pvp-opp-card";
        const oppImg = oppRevealed && oppSprite
          ? `<img class="pvp-sprite" src="${escapeAttr(oppSprite)}" loading="lazy" onerror="this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'"/>`
          : `<img class="pvp-sprite" src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png"/>`;
        mc.innerHTML = `
          <div class="pvp-card-row">
            <div class="pvp-sprite-wrap">
              ${oppImg}
              ${oppOnMap ? `<span class="pvp-loc-badge pvp-loc-field">⚔️</span>` : `<span class="pvp-loc-badge pvp-loc-bag">🎒</span>`}
            </div>
            <div class="pvp-card-info">
              <div class="pvp-card-name">${oppRevealed ? escapeHtml(oppName) : "???"}<span style="font-size:10px;color:#94a3b8;margin-left:6px;">${oppOnMap ? "No campo" : "Mochila"}</span></div>
              ${oppRevealed ? `<div class="pvp-hp-row">
                <span class="pvp-hp-icon">${oppHpIcon}</span>
                <input
                  type="range"
                  class="pvp-hp-slider"
                  min="0"
                  max="6"
                  step="1"
                  value="${oppHp}"
                  data-act="hp-slider"
                  data-owner="${escapeAttr(owner)}"
                  data-pid="${escapeAttr(oppPid)}"
                  style="--hp-pct:${oppHpPct}%;--hp-col:${oppHpCol};"
                />
                <span class="pvp-hp-label">${oppHp}/6</span>
              </div>` : ""}
            </div>
          </div>
        `;
        mc.querySelector('[data-act="hp-slider"]')?.addEventListener("input", async (ev) => {
          ev.stopPropagation();
          const newHp = Number(ev.target.value);
          if (!Number.isFinite(newHp)) return;
          await updatePartyStateHp(owner, oppPid, newHp);
        });
        if (oppPiece?.id) mc.addEventListener("click", () => selectPiece(String(oppPiece.id)));
        ownerBox.appendChild(mc);
      }
    } else {
      for (const p of visiblePieces) ownerBox.appendChild(renderPieceMiniRow(p));
    }
    oppRoot.appendChild(ownerBox);
  }

  // ── Fichas (tab) ──
  try { ensureSheetsRealtime(); renderSheetsTab(); } catch {}
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

  const spriteUrl = getSpriteUrlForPiece(p);
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
  const spriteUrl = getSpriteUrlForPiece(p);

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
};

// DOM fallback grid cache
let domGridSize = 0;
let domCells = []; // flat [row*gs+col] -> element

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
  const ro = new ResizeObserver(() => resizeCanvasToContainer());
  ro.observe(canvasWrap);
  window.addEventListener("resize", () => resizeCanvasToContainer());
}

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
  fitToView();
});
$("btn_center")?.addEventListener("click", () => {
  view.autoFit = false;
  fitToView();
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
  const pieceId = safeStr(appState.selectedPieceId);
  if (!pieceId) return;
  const by = safeStr(byInput?.value || "Anon") || "Anon";
  sendAction("MOVE_PIECE", by, { pieceId, row: toRow, col: toCol });
}


function makePieceId() {
  return `pc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function startPlacePokemon(pid) {
  const monPid = safeStr(pid);
  if (!monPid) return;
  if (!appState.connected || !appState.rid) {
    setStatus("err", "conecte antes de colocar pokémon no mapa");
    return;
  }
  if (!safeStr(appState.by)) {
    setStatus("err", "preencha o campo by para colocar pokémon");
    return;
  }
  appState.placingPid = monPid;
  setStatus("ok", `modo de posicionar ativo: ${monPid}. Clique em um tile vazio no mapa.`);
  updateSidePanels();
}

async function placePokemonOnBoardAt(pid, row, col) {
  const monPid = safeStr(pid);
  const by = safeStr(appState.by);
  const ref = getStateDocRef();
  if (!monPid || !by || !ref) return;

  const r = Number(row);
  const c = Number(col);
  if (!Number.isFinite(r) || !Number.isFinite(c)) {
    setStatus("err", "tile inválido para posicionar pokémon");
    return;
  }

  try {
    let createdId = null;
    await runTransaction(currentDb, async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists() ? snap.data() : {};
      const pieces = Array.isArray(data?.pieces) ? data.pieces : [];
      const seen = Array.isArray(data?.seen) ? data.seen : [];

      const occupied = pieces.some((p) =>
        safeStr(p?.status || "active") === "active" && Number(p?.row) === r && Number(p?.col) === c
      );
      if (occupied) throw new Error("tile ocupado");

      const alreadyOnBoard = pieces.some((p) =>
        safeStr(p?.owner) === by && safeStr(p?.pid) === monPid && safeStr(p?.status || "active") === "active"
      );
      if (alreadyOnBoard) throw new Error("esse pokémon já está no campo");

      createdId = makePieceId();
      const newPiece = {
        id: createdId,
        owner: by,
        kind: "pokemon",
        pid: monPid,
        row: r,
        col: c,
        revealed: true,
        status: "active",
      };

      const nextSeen = seen.includes(monPid) ? seen : [...seen, monPid];
      tx.set(
        ref,
        { pieces: [...pieces, newPiece], seen: nextSeen, updatedAt: serverTimestamp() },
        { merge: true }
      );
    });

    appState.placingPid = null;
    if (createdId) selectPiece(createdId);
    setStatus("ok", "pokémon colocado no mapa");
  } catch (e) {
    setStatus("err", `falha ao colocar pokémon: ${e?.message || e}`);
  }
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
    if (appState.placingPid) return;
    if (ev.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const tile = screenToTile(x, y);
    if (!tile) return;
    const p = getPieceAt(tile.row, tile.col);
    if (!p) return;
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

    if (appState.placingPid) {
      placePokemonOnBoardAt(appState.placingPid, tile.row, tile.col);
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
    const cell = ev.target?.closest?.(".cell");
    if (!cell) return;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);

    if (appState.placingPid) {
      placePokemonOnBoardAt(appState.placingPid, row, col);
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
    // remove token
    const t = cell.querySelector(":scope > .token");
    if (t) t.remove();
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
  } else {
    drawProceduralMap(ctx, ox, oy, gs, tile);
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

  // grid lines
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

  // pieces
  const pieces = appState.pieces || [];
  for (const p of pieces) {
    if (safeStr(p?.status || "active") !== "active") continue;
    if (!isPieceVisibleToMe(p)) continue;
    const row = Number(p?.row);
    const col = Number(p?.col);
    if (!Number.isFinite(row) || !Number.isFinite(col)) continue;
    const x = ox + col * tile;
    const y = oy + row * tile;
    const id = safeStr(p?.id);
    const isSel = safeStr(appState.selectedPieceId) && safeStr(appState.selectedPieceId) === id;

    // token base
    ctx.fillStyle = isSel ? "rgba(56,189,248,0.22)" : "rgba(0,0,0,0.18)";
    ctx.fillRect(x + 2, y + 2, tile - 4, tile - 4);

    // sprite
    const spriteUrl = getSpriteUrlForPiece(p);
    const spr = spriteUrl ? loadSprite(spriteUrl) : null;
    const pad = Math.max(6, Math.floor(tile * 0.12));
    if (spr?.ready && !spr?.failed) {
      ctx.drawImage(spr.img, x + pad, y + pad, tile - pad * 2, tile - pad * 2);
    } else {
      // fallback glyph
      ctx.fillStyle = "rgba(226,232,240,0.85)";
      ctx.font = `900 ${Math.max(10, Math.floor(tile * 0.22))}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = (p?.revealed ? String(p?.pid ?? "?") : "?").slice(0, 4);
      ctx.fillText(label, x + tile / 2, y + tile / 2);
    }

    // outline
    ctx.strokeStyle = isSel ? "rgba(56,189,248,0.75)" : "rgba(148,163,184,0.22)";
    ctx.lineWidth = isSel ? 3 : 1;
    ctx.strokeRect(x + 2, y + 2, tile - 4, tile - 4);
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
  dexMap = loadDexMapFromStorage();
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
      dexMap = obj;
      saveDexMapToStorage(obj);
      setStatus('ok', 'Dex carregada (local)');
      updateSidePanels();
    } catch (e) {
      setStatus('err', 'Falha ao carregar Dex: ' + (e?.message || e));
    }
  });
  dexClear?.addEventListener('click', () => {
    dexMap = null;
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
  st.textContent = "\n/* ─── FICHAS TAB (injetado pelo main.js) ─── */\n#tab_sheets .sheets-status-bar{\n  display:flex;align-items:center;gap:8px;flex-wrap:wrap;\n  padding:10px 14px;border-radius:14px;border:1px solid rgba(255,255,255,.12);\n  background:rgba(15,23,42,.55);margin-bottom:16px;\n}\n#tab_sheets .fichas-layout{display:grid;grid-template-columns:1.15fr .85fr;gap:20px;align-items:start;}\n@media (max-width: 900px){ #tab_sheets .fichas-layout{grid-template-columns:1fr;} }\n#tab_sheets .cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(255px,1fr));gap:10px;}\n#tab_sheets .poke-card{border-radius:14px;padding:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);\n  cursor:pointer;transition:all .2s;position:relative;overflow:hidden;}\n#tab_sheets .poke-card::before{content:'';position:absolute;inset:0;background:var(--card-bg,transparent);opacity:.12;pointer-events:none;border-radius:inherit;}\n#tab_sheets .poke-card:hover{border-color:rgba(255,255,255,.2);transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.3);}\n#tab_sheets .poke-card.selected{border-color:rgba(59,130,246,.5);box-shadow:0 0 0 2px rgba(59,130,246,.3) inset,0 10px 30px rgba(0,0,0,.3);}\n#tab_sheets .card-head{display:flex;gap:10px;align-items:center;position:relative;z-index:1;}\n#tab_sheets .card-head img{width:64px;height:64px;object-fit:contain;border-radius:12px;border:1px solid rgba(255,255,255,.12);\n  background:rgba(0,0,0,.15);padding:4px;image-rendering:pixelated;}\n#tab_sheets .card-info{flex:1;min-width:0;}\n#tab_sheets .card-name{font-weight:900;font-size:.95rem;line-height:1.15;}\n#tab_sheets .card-sub{font-size:.78rem;opacity:.75;margin-top:2px;}\n#tab_sheets .pill-row{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;}\n#tab_sheets .type-pill{padding:2px 8px;border-radius:999px;font-size:.68rem;font-weight:900;text-transform:uppercase;\n  border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.2);}\n#tab_sheets .card-divider{height:1px;background:rgba(255,255,255,.12);margin:8px 0;position:relative;z-index:1;}\n#tab_sheets .card-moves-label{font-weight:900;font-size:.78rem;opacity:.8;margin-bottom:4px;position:relative;z-index:1;}\n#tab_sheets .card-move-row{display:flex;align-items:center;gap:6px;padding:3px 0;position:relative;z-index:1;}\n#tab_sheets .card-move-name{font-weight:700;font-size:.82rem;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n#tab_sheets .mv-pill{padding:1px 6px;border-radius:999px;font-size:.66rem;font-weight:900;font-family:monospace;border:1px solid rgba(255,255,255,.12);}\n#tab_sheets .mv-pill.acc{background:rgba(56,189,248,.12);border-color:rgba(56,189,248,.3);color:#38bdf8;}\n#tab_sheets .mv-pill.rk{background:rgba(234,179,8,.12);border-color:rgba(234,179,8,.3);color:#eab308;}\n#tab_sheets .mv-pill.area{background:rgba(168,85,247,.12);border-color:rgba(168,85,247,.3);color:#a855f7;}\n#tab_sheets .card-open{display:block;text-align:right;font-weight:900;font-size:.78rem;color:#38bdf8;margin-top:6px;position:relative;z-index:1;cursor:pointer;}\n#tab_sheets .sheet-panel{border-radius:14px;border:1px solid rgba(255,255,255,.12);background:rgba(17,24,39,.9);padding:18px;position:sticky;top:16px;}\n#tab_sheets .sheet-header{display:flex;gap:16px;align-items:flex-start;margin-bottom:14px;}\n#tab_sheets .sheet-art{width:130px;height:130px;object-fit:contain;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.2);padding:8px;}\n#tab_sheets .sheet-name{font-weight:900;font-size:1.2rem;}\n#tab_sheets .sheet-sub{font-size:.85rem;opacity:.75;margin-top:2px;}\n#tab_sheets .stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:12px 0;}\n#tab_sheets .stat-box{text-align:center;padding:8px 4px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);}\n#tab_sheets .stat-label{font-size:.68rem;font-weight:700;opacity:.75;text-transform:uppercase;}\n#tab_sheets .stat-val{font-size:1.1rem;font-weight:900;margin-top:2px;}\n#tab_sheets .section-title{font-weight:900;font-size:.88rem;margin:14px 0 6px;}\n#tab_sheets .chip-row{display:flex;flex-wrap:wrap;gap:5px;}\n#tab_sheets .chip{padding:3px 10px;border-radius:999px;font-size:.75rem;font-weight:700;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);}\n#tab_sheets .sheet-divider{height:1px;background:rgba(255,255,255,.12);margin:12px 0;}\n#tab_sheets .move-expander{border:1px solid rgba(255,255,255,.12);border-radius:10px;margin-bottom:6px;overflow:hidden;}\n#tab_sheets .move-header{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;background:rgba(255,255,255,.04);transition:background .15s;}\n#tab_sheets .move-header:hover{background:rgba(255,255,255,.08);}\n#tab_sheets .move-header .arrow{font-size:.7rem;transition:transform .2s;opacity:.75;}\n#tab_sheets .move-expander.open .arrow{transform:rotate(90deg);}\n#tab_sheets .move-h-name{font-weight:900;font-size:.85rem;flex:1;}\n#tab_sheets .move-body{padding:10px 12px;border-top:1px solid rgba(255,255,255,.12);display:none;font-size:.82rem;opacity:.85;}\n#tab_sheets .move-expander.open .move-body{display:block;}\n#tab_sheets .notes-input{width:100%;padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.25);color:inherit;font-size:.82rem;margin-top:8px;}\n#tab_sheets .hp-track{height:8px;border-radius:4px;background:rgba(0,0,0,.25);overflow:hidden;}\n#tab_sheets .hp-fill{height:100%;border-radius:4px;transition:width .3s;}\n#tab_sheets .sheets-empty{ text-align:center; padding:40px 20px; opacity:.75;}\n#tab_sheets .spinner{width:24px;height:24px;border:3px solid rgba(255,255,255,.12);border-top-color:#38bdf8;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto;}\n@keyframes spin{to{transform:rotate(360deg);}}\n";
  document.head.appendChild(st);
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
          <div style="font-weight: 900; margin-bottom: 10px;">Cards</div>
          <div class="cards-grid" id="cardsGrid"></div>
        </div>
        <div>
          <div style="font-weight: 900; margin-bottom: 10px;">Ficha completa</div>
          <div id="sheetDetail">
            <div class="sheets-empty">👆 Selecione um card à esquerda.</div>
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
const _TYPE_COLORS = {
  Normal:"#A8A878",Fire:"#F08030",Water:"#6890F0",Electric:"#F8D030",
  Grass:"#78C850",Ice:"#98D8D8",Fighting:"#C03028",Poison:"#A040A0",
  Ground:"#E0C068",Flying:"#A890F0",Psychic:"#F85888",Bug:"#A8B820",
  Rock:"#B8A038",Ghost:"#705898",Dragon:"#7038F8",Dark:"#705848",
  Steel:"#B8B8D0",Fairy:"#EE99AC",
  Fogo:"#F08030",Água:"#6890F0",Elétrico:"#F8D030",Planta:"#78C850",
  Gelo:"#98D8D8",Lutador:"#C03028",Veneno:"#A040A0",Terra:"#E0C068",
  Voador:"#A890F0",Psíquico:"#F85888",Inseto:"#A8B820",Pedra:"#B8A038",
  Fantasma:"#705898",Dragão:"#7038F8",Sombrio:"#705848",Aço:"#B8B8D0",Fada:"#EE99AC",
};
const _tc = (t) => _TYPE_COLORS[safeStr(t)] || "#666";
function _typeBg(types) {
  if (!types || !types.length) return "";
  return types.length === 1 ? _tc(types[0]) : `linear-gradient(135deg,${_tc(types[0])},${_tc(types[1])})`;
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

function _artUrlFromPidForSheets(pid) {
  const k = safeStr(pid);
  if (!k) return "";
  if (k.startsWith("EXT:")) {
    const nm = safeStr(k.slice(4));
    if (!nm) return "";
    const slug = (typeof spriteSlugFromPokemonName === "function") ? spriteSlugFromPokemonName(nm) : slugifyPokemonName(nm);
    return slug ? `https://img.pokemondb.net/artwork/large/${slug}.jpg` : "";
  }
  const nm = (typeof resolvePokemonNameFromPid === "function") ? resolvePokemonNameFromPid(k) : "";
  if (nm) {
    const slug = (typeof spriteSlugFromPokemonName === "function") ? spriteSlugFromPokemonName(nm) : slugifyPokemonName(nm);
    if (slug) return `https://img.pokemondb.net/artwork/large/${slug}.jpg`;
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
      mvH += `
        <div class="card-move-row">
          <span class="card-move-name">${escapeHtml(n)}</span>
          <span class="mv-pill acc">A+${acc}</span>
          <span class="mv-pill rk">R${rk}</span>
          <span class="mv-pill area">${area ? "Área" : "Alvo"}</span>
        </div>
        <div style="opacity:.7;font-size:.68rem;font-weight:900;margin-bottom:3px;">${escapeHtml(brk)}</div>
      `;
    }
    if (!mvH) mvH = `<div style="opacity:.6;font-size:.78rem;">Sem golpes nesta ficha.</div>`;

    const tp = (types || []).map((t) => `
      <span class="type-pill" style="background:${_tc(t)}33;border-color:${_tc(t)}55;color:${_tc(t)}">${escapeHtml(t)}</span>
    `).join("");

    const sprite = _spriteUrlFromPidForSheets(pid) || "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png";

    const card = document.createElement("div");
    card.className = `poke-card${isSel ? " selected" : ""}`;
    card.style.setProperty("--card-bg", _typeBg(types));
    card.addEventListener("click", () => {
      _sheetsSelectedPid = pid;
      renderSheetsTab();
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

      mvH += `
        <div class="move-expander">
          <div class="move-header">
            <span class="arrow">▶</span>
            <span class="move-h-name">${escapeHtml(n)}</span>
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

  const art = _artUrlFromPidForSheets(pid) || _spriteUrlFromPidForSheets(pid) || "";

  detailEl.innerHTML = `
    <div class="sheet-panel">
      <div class="sheet-header">
        <img class="sheet-art" src="${escapeAttr(art)}" alt="art"
          onerror="this.src='${escapeAttr(_spriteUrlFromPidForSheets(pid))}'"/>
        <div style="flex:1; min-width:0;">
          <div class="sheet-name">${escapeHtml(pname)}</div>
          <div class="sheet-sub">#${escapeHtml(pid)} • NP ${np}</div>
          <div class="pill-row" style="margin-top:6px;">${tp}</div>
          ${abH}${condH}
          <div style="margin-top:10px;">
            <div style="display:flex;justify-content:space-between;font-size:.75rem;font-weight:700;margin-bottom:3px;">
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
        <div class="stat-box" style="border-color:rgba(56,189,248,.3);"><div class="stat-label" style="color:#38bdf8;">Cap</div><div class="stat-val" style="color:#38bdf8;">${cap}</div></div>
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
window.currentDb          = null;
window.currentRid         = null;
// Mantém window.currentRid e window.currentDb sincronizados com appState
setInterval(() => {
  window.currentRid = appState.rid || null;
  window.currentDb  = window._combatDb || null;
}, 300);
