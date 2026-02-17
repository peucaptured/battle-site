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

let currentDb = null;
let currentRid = null;
let unsub = [];

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
            out.push({ role, trainer_name, id: d.id });
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
function pieceDisplayName(p) {
  const pid = p?.pid != null ? String(p.pid) : "?";
  const id = safeStr(p?.id) || "—";
  const owner = safeStr(p?.owner) || "—";
  return { pid, id, owner };
}

function getSpriteUrlForPiece(p) {
  // Prefer explicit spriteUrl if present
  const direct = safeStr(p?.spriteUrl || p?.sprite_url || "");
  if (direct) return direct;
  const pidRaw = Number(p?.pid);
  // fallback: PokeAPI sprites (pode falhar para ids custom)
  if (Number.isFinite(pidRaw) && pidRaw > 0 && pidRaw < 10000) {
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pidRaw}.png`;
  }
  return "";
}

function updateSidePanels() {
  // Team list (filter by owner == by)
  const by = safeStr(appState.by);
  const pieces = Array.isArray(appState.pieces) ? appState.pieces : [];

  const myPieces = by ? pieces.filter((p) => safeStr(p?.owner) === by && safeStr(p?.status || "active") !== "deleted") : [];
  const oppPieces = by ? pieces.filter((p) => safeStr(p?.owner) && safeStr(p?.owner) !== by && safeStr(p?.status || "active") !== "deleted") : pieces;

  // LEFT
  const teamRoot = $("team_list");
  teamRoot.innerHTML = "";
  if (!appState.connected) {
    teamRoot.innerHTML = `<div class="card"><div class="muted">Conecte numa sala para ver suas peças.</div></div>`;
  } else if (!myPieces.length) {
    teamRoot.innerHTML = `<div class="card"><div style="font-weight:950;margin-bottom:6px">Nenhuma peça sua encontrada</div><div class="muted">Se você esperava ver sua equipe, confira se <code>by</code> = <code>piece.owner</code>.</div></div>`;
  } else {
    for (const p of myPieces) {
      teamRoot.appendChild(renderPieceCard(p, true));
    }
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

  // tiles (simple texture via alternating alpha)
  for (let r = 0; r < gs; r++) {
    for (let c = 0; c < gs; c++) {
      const x = ox + c * tile;
      const y = oy + r * tile;
      const alt = (r + c) % 2 === 0;
      ctx.fillStyle = alt ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.05)";
      ctx.fillRect(x, y, tile, tile);
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

// Initial UI
setTab("arena");
updateArenaMeta();
updateTopBadges();
updateSidePanels();
setStatus("warn", "desconectado");
