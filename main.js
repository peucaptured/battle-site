import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  doc,
  collection,
  onSnapshot,
  addDoc,
  serverTimestamp,
  query,
  orderBy,
  limit,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

/**
 * PvP Arena (HTML/JS) — Realtime Firestore
 *
 * Regras importantes (preservadas):
 * - Front NÃO mexe no state diretamente.
 * - Envia ações criando docs em rooms/{rid}/actions
 * - Ações suportadas: ADD_LOG, MOVE_PIECE (campos exatos)
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
// Local state (update incremental)
// -------------------------
const appState = {
  connected: false,
  rid: null,
  by: "",
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
  if (by) wanted.set(safeTrainerId(by), by);
  for (const p of (appState.players || [])) {
    const tn = safeStr(p?.trainer_name);
    if (!tn) continue;
    wanted.set(safeTrainerId(tn), tn);
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

// ID canônico de treinador (precisa bater com a `safeId()` das Cloud Functions)
// - lower
// - remove acentos
// - troca qualquer coisa fora [a-z0-9] por _
function safeTrainerId(name) {
  let s = safeStr(name) || "user";
  try {
    s = s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    s = s.toLowerCase();
  }
  return s
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "user";
}

function inferRoleFromPlayers(players, by) {
  const name = safeStr(by);
  if (!name) return "—";
  const found = players.find((p) => safeStr(p.trainer_name) === name);
  return found?.role || "—";
}

function updateTopBadges() {
  ridBadge.textContent = appState.rid || "—";
  meBadge.textContent = `by: ${safeStr(appState.by) || "—"}`;
  roleBadge.textContent = `role: ${appState.role || "—"}`;

  const phase = safeStr(appState.battle?.status) || "idle";
  phaseBadge.textContent = phase;
  trainerNameEl.textContent = safeStr(appState.by) || "—";
  avatarIcon.textContent = safeStr(appState.by)?.slice(0, 1)?.toUpperCase() || "🙂";

  const synced = appState.connected ? "Sincronizado ✓" : "—";
  syncBadge.textContent = synced;
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

connectBtn?.addEventListener("click", () => {
  cleanup();
  const rid = safeStr(ridInput?.value || "");
  if (!rid) {
    setStatus("err", "faltou rid");
    return;
  }

  const by = safeStr(byInput?.value || "");
  appState.by = by;
  updateTopBadges();

  const app = initializeApp(DEFAULT_FIREBASE_CONFIG);
  const db = getFirestore(app);
  currentDb = db;
  currentRid = rid;
  appState.connected = true;
  appState.rid = rid;
  setStatus("ok", "conectado");
  updateTopBadges();

  // players (suporta 2 formatos: subcoleção rooms/{rid}/players e/ou campos no doc rooms/{rid})
  let playersFromCol = [];
  let playersFromRoom = [];
  // ✅ roster público (espelhado por Cloud Function em public_state/players)
  let playersFromPublic = [];

  const commitPlayers = () => {
    // ✅ merge por (role+trainer_name)
    // ✅ prioridade: fontes "ricas" primeiro (com party_snapshot/uid/avatar)
    //   1) playersFromCol (rooms/{rid}/players)
    //   2) playersFromPublic (public_state/players)
    //   3) playersFromRoom (doc rooms/{rid} legacy)
    const seen = new Set();
    const merged = [];

    const upsert = (p) => {
      const role = safeStr(p?.role);
      const tn = safeStr(p?.trainer_name);
      if (!tn) return;

      const key = `${role}::${tn}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(p);
        return;
      }

      // já existe: enriquece sem perder party_snapshot/avatar/uid
      const idx = merged.findIndex(
        (x) => `${safeStr(x?.role)}::${safeStr(x?.trainer_name)}` === key
      );
      if (idx < 0) return;

      const cur = merged[idx] || {};
      const next = p || {};

      const curParty = Array.isArray(cur.party_snapshot) ? cur.party_snapshot : [];
      const nextParty = Array.isArray(next.party_snapshot) ? next.party_snapshot : [];

      merged[idx] = {
        ...cur,
        ...next,
        uid: safeStr(next.uid) || safeStr(cur.uid),
        id: safeStr(next.id) || safeStr(cur.id),
        avatar: next.avatar ?? cur.avatar ?? null,
        party_snapshot: nextParty.length ? nextParty : curParty,
      };
    };

    for (const arr of [playersFromCol, playersFromPublic, playersFromRoom]) {
      for (const p of (arr || [])) upsert(p);
    }

    merged.sort(
      (a, b) =>
        (a.role || "").localeCompare(b.role || "") ||
        (a.trainer_name || "").localeCompare(b.trainer_name || "")
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
            out.push({
              role,
              trainer_name,
              id: d.id,
              uid: safeStr(p.uid || d.id),
              avatar: p.avatar || null,
              party_snapshot: Array.isArray(p.party_snapshot) ? p.party_snapshot : [],
            });
          });
          playersFromCol = out;
          commitPlayers();
        },
        (err) => {
          if (playersPre) playersPre.textContent = "Erro (players col): " + err.message;
        }
      )
    );
  } catch {}

  // A2) doc público rooms/{rid}/public_state/players (fallback quando rules bloqueiam rooms/{rid}/players)
  try {
    const pubPlayersDoc = doc(db, "rooms", rid, "public_state", "players");
    unsub.push(
      onSnapshot(
        pubPlayersDoc,
        (snap) => {
          const data = snap.exists() ? snap.data() : null;
          const byId = data?.byId && typeof data.byId === "object" ? data.byId : {};
          const out = [];
          for (const k of Object.keys(byId)) {
            const p = byId[k] || {};
            const role = safeStr(p.role) || "player";
            const trainer_name = safeStr(p.trainer_name || p.name || p.by || p.uid || k);
            out.push({
              role,
              trainer_name,
              id: safeStr(p.id || k),
              uid: safeStr(p.uid || k),
              avatar: p.avatar || null,
              party_snapshot: Array.isArray(p.party_snapshot) ? p.party_snapshot : [],
            });
          }
          playersFromPublic = out;
          commitPlayers();
        },
        () => {}
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
        $("battle_preview").textContent = pretty(data);
        $("initiative_preview").textContent = pretty(data?.initiative || null);
        $("sheets_preview").textContent = pretty({ selectedPieceId: appState.selectedPieceId });
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
});

// Keep badges updated when user edits inputs
byInput?.addEventListener("input", () => {
  appState.by = safeStr(byInput.value);
  appState.role = inferRoleFromPlayers(appState.players, appState.by);
  updateTopBadges();
  updateSidePanels();
});

function updateArenaMeta() {
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

function spriteUrlFromPokemonName(name) {
  const slug = slugifyPokemonName(name);
  if (!slug) return "";
  return `https://img.pokemondb.net/sprites/home/normal/${slug}.png`;
}

function getSpriteUrlForPiece(p) {
  const direct = safeStr(p?.spriteUrl || p?.sprite_url || "");
  if (direct) return direct;

  const name = resolvePokemonNameFromPid(p?.pid);
  if (name) return spriteUrlFromPokemonName(name);

  const pidRaw = Number(p?.pid);
  if (Number.isFinite(pidRaw) && pidRaw > 0 && pidRaw < 20000) {
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pidRaw}.png`;
  }
  return "";
}

function normalizePartyPid(x) {
  let v = safeStr(x?.pid ?? x?.id ?? x?.pokemon?.id ?? x?.pokemon ?? x);
  if (!v) return "";
  v = v.trim();
  v = v.replace(/^pid\s*[:#-]?\s*/i, "").trim();

  if (/^ext\s*:/i.test(v)) {
    const nm = v.split(":").slice(1).join(":").trim();
    return nm ? `EXT:${nm}` : "";
  }

  if (/^\d+$/.test(v)) return String(Number(v));

  const slug = slugifyPokemonName(v);
  const slugMap = window.dexSlugToId;
  if (slug && slugMap && slugMap[slug]) return String(Number(slugMap[slug]));

  return v;
}

function getPartyForTrainer(trainerName) {
  const tn = safeStr(trainerName);
  if (!tn) return [];

  const p = (appState.players || []).find(x => safeStr(x?.trainer_name) === tn);
  const snapParty = (p && Array.isArray(p.party_snapshot)) ? p.party_snapshot : [];

  const uid = safeTrainerId(tn);
  const entry = appState.userProfiles?.get?.(uid) || appState.userProfiles?.get?.(safeDocId(tn)) || appState.userProfiles?.get?.(tn);
  const raw = entry?.raw;
  const data = raw?.data || raw;
  const rawParty = Array.isArray(data?.party) ? data.party : [];

  if (rawParty.length) {
    return rawParty.map(x => ({ pid: normalizePartyPid(x) })).filter(it => it.pid);
  }

  if (snapParty.length) return snapParty;

  return [];
}

function renderPartyCard(it, ownerName) {
  const pid = safeStr(it?.pid || it?.pokemon?.id || it);
  const name = dexNameFromPid(pid) || `PID ${pid}`;
  const spriteUrl = getSpriteUrlFromPid(pid);
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="row" style="align-items:flex-start">
      ${spriteUrl ? `<img class="mini" src="${escapeAttr(spriteUrl)}" alt="sprite" loading="lazy" onerror="this.style.display='none'"/>` : `<div class="avatar" style="width:40px;height:40px;border-radius:14px">#</div>`}
      <div style="flex:1; min-width:0">
        <div style="font-weight:950; line-height:1.1">${escapeHtml(name)}</div>
        <div class="muted">PID <span class="mono">${escapeHtml(pid)}</span>${it?.np != null ? ` • NP ${escapeHtml(String(it.np))}` : ""}</div>
      </div>
    </div>
  `;
  card.addEventListener("click", () => {
    const p = (appState.pieces || []).find(x => safeStr(x?.owner)===safeStr(ownerName) && safeStr(x?.pid)===pid);
    if (p?.id) selectPiece(String(p.id));
  });
  return card;
}

function updateSidePanels() {
  const by = safeStr(appState.by);
  const pieces = Array.isArray(appState.pieces) ? appState.pieces : [];

  const myParty = by ? getPartyForTrainer(by) : [];
  const myPieces = by ? pieces.filter((p) => safeStr(p?.owner) === by && safeStr(p?.status || "active") !== "deleted") : [];
  const oppPieces = by ? pieces.filter((p) => safeStr(p?.owner) && safeStr(p?.owner) !== by && safeStr(p?.status || "active") !== "deleted") : pieces;

  const teamRoot = $("team_list");
  teamRoot.innerHTML = "";
  if (!appState.connected) {
    teamRoot.innerHTML = `<div class="card"><div class="muted">Conecte numa sala para ver suas peças.</div></div>`;
  } else if (myParty && myParty.length) {
    for (const it of myParty) teamRoot.appendChild(renderPartyCard(it, by));
  } else if (!myPieces.length) {
    teamRoot.innerHTML = `<div class="card"><div style="font-weight:950;margin-bottom:6px">Equipe não encontrada</div><div class="muted">Ainda não achei <code>party_snapshot</code>/<code>users_raw</code> e você não tem peças no tabuleiro. Se você usa Streamlit, entre na sala por lá 1x (ele espelha seu perfil para o Firestore).</div></div>`;
  } else {
    for (const p of myPieces) teamRoot.appendChild(renderPieceCard(p, true));
  }

  const oppRoot = $("opp_list");
  oppRoot.innerHTML = "";
  const grouped = new Map();
  for (const p of oppPieces) {
    const o = safeStr(p?.owner) || "—";
    if (!grouped.has(o)) grouped.set(o, []);
    grouped.get(o).push(p);
  }
  const oppOwners = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
  oppCount.textContent = String(oppOwners.length);
  for (const owner of oppOwners) {
    const box = document.createElement("div");
    box.className = "card";
    box.innerHTML = `<div class="row spread"><div style="font-weight:950">${escapeHtml(owner)}</div><div class="pill mono">${grouped.get(owner).length}</div></div>`;
    const list = document.createElement("div");
    list.style.marginTop = "10px";
    for (const p of grouped.get(owner)) list.appendChild(renderPieceMiniRow(p));
    box.appendChild(list);
    oppRoot.appendChild(box);
  }
}

/* ... (o restante do seu arquivo permanece igual daqui pra baixo)
   Para não estourar o limite de mensagem, eu não repliquei o trecho inteiro de arena + logs,
   porque não foi alterado. Se você quiser, eu te devolvo ele completo 100% colado.
*/

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
