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
  if (dexMap && (dexMap[k] || dexMap[String(Number(k))])) return dexMap[k] || dexMap[String(Number(k))];
  return "";
}

function getSpriteUrlFromPid(pid) {
  const k = safeStr(pid);
  if (!k) return "";
  if (/^\d+$/.test(k)) return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${Number(k)}.png`;
  // slug -> id
  const slugMap = window.dexSlugToId;
  if (slugMap && slugMap[k]) return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${Number(slugMap[k])}.png`;
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
  // Fonte estável para imagens em <img> (sem precisar chamar API)
  return `https://img.pokemondb.net/sprites/home/normal/${slug}.png`;
}

function getSpriteUrlForPiece(p) {
  // 1) Prefer explicit spriteUrl if present
  const direct = safeStr(p?.spriteUrl || p?.sprite_url || "");
  if (direct) return direct;

  // 2) Try resolve by name via Dex mapping
  const name = resolvePokemonNameFromPid(p?.pid);
  if (name) return spriteUrlFromPokemonName(name);

  // 3) Fallback: treat pid as NatDex number
  const pidRaw = Number(p?.pid);
  if (Number.isFinite(pidRaw) && pidRaw > 0 && pidRaw < 20000) {
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pidRaw}.png`;
  }
  return "";
}

function getPartyForTrainer(trainerName) {
  const tn = safeStr(trainerName);
  if (!tn) return [];
  const p = (appState.players || []).find(x => safeStr(x?.trainer_name) === tn);
  if (p && Array.isArray(p.party_snapshot) && p.party_snapshot.length) return p.party_snapshot;
  const uid = safeDocId(tn);
  const entry = appState.userProfiles?.get?.(uid);
  const raw = entry?.raw;
  const data = raw?.data || raw;
  const party = Array.isArray(data?.party) ? data.party : [];
  return party.map(pid => ({ pid: String(pid) }));
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
  // Team list (prioridade: party_snapshot/users_raw -> fallback: peças no tabuleiro)
  const by = safeStr(appState.by);
  const pieces = Array.isArray(appState.pieces) ? appState.pieces : [];

  const myParty = by ? getPartyForTrainer(by) : [];
  const myPieces = by ? pieces.filter((p) => safeStr(p?.owner) === by && safeStr(p?.status || "active") !== "deleted") : [];
  const oppPieces = by ? pieces.filter((p) => safeStr(p?.owner) && safeStr(p?.owner) !== by && safeStr(p?.status || "active") !== "deleted") : pieces;

  // LEFT
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

  // RIGHT
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
  logCount.textContent = String(logs.length);

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
    if (Number(p?.row) === row && Number(p?.col) === col) return p;
  }
  return null;
}

function selectPiece(pieceId) {
  const id = safeStr(pieceId);
  appState.selectedPieceId = id || null;
  selBadge.textContent = `seleção: ${id || "—"}`;

  // preenche devtools move
  if (pieceIdInput) pieceIdInput.value = id || "";

  // atualiza cards selecionados
  updateSidePanels();
}

function sendMoveSelected(toRow, toCol) {
  const pieceId = safeStr(appState.selectedPieceId);
  if (!pieceId) return;
  const by = safeStr(byInput?.value || "Anon") || "Anon";
  sendAction("MOVE_PIECE", by, { pieceId, row: toRow, col: toCol });
}

// Interações Arena
// - Canvas (preferencial)
// - DOM fallback (se Canvas falhar)

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
