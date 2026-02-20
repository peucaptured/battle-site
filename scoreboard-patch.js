/**
 * scoreboard-patch.js — Scoreboard horizontal multi-jogador (até 4 players, até 8 pokémon cada)
 *
 * Layout conceito: barra horizontal compacta (max 20% da tela).
 * Cada jogador: avatar + nome à esquerda, fileira horizontal de até 8 pokémon à direita.
 * Pokémon não revelado = pokébola. HP bar embaixo de cada sprite.
 * Se adapta a 1-4 jogadores empilhando verticalmente.
 *
 * Padrão "patch": ES module independente, lê window.appState e DOM,
 * subscreve Firestore por conta própria, não modifica main.js.
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  doc,
  collection,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// ── Firebase (reusa app existente) ──
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD2YZfQc-qeqMT3slk0ouvPC08d901te-Q",
  authDomain: "batalhas-de-gaal.firebaseapp.com",
  projectId: "batalhas-de-gaal",
  storageBucket: "batalhas-de-gaal.firebasestorage.app",
  messagingSenderId: "676094077702",
  appId: "1:676094077702:web:dc834e5b4b5811a3b0e164",
};

function getDb() {
  const apps = getApps();
  const app = apps.length ? apps[0] : initializeApp(FIREBASE_CONFIG);
  return getFirestore(app);
}

// ── Helpers ──
const safeStr = (x) => (x == null ? "" : String(x).trim());
const POKE_BALL_URL = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png";

function slugifyPokemonName(name) {
  return safeStr(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizePartyPid(pidLike) {
  let v = safeStr(pidLike?.pid ?? pidLike?.id ?? pidLike?.pokemon?.id ?? pidLike?.pokemon ?? pidLike);
  if (!v) return "";
  v = v.replace(/^pid\s*[:#-]?\s*/i, "").trim();
  if (!v) return "";

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

function getPartyStateEntry(partyStates, pidLike) {
  if (!partyStates || typeof partyStates !== "object") return {};
  const rawPid = safeStr(pidLike);
  const normalizedPid = normalizePartyPid(pidLike);

  if (rawPid && partyStates[rawPid]) return partyStates[rawPid] || {};
  if (normalizedPid && partyStates[normalizedPid]) return partyStates[normalizedPid] || {};

  const rawPidLc = rawPid.toLowerCase();
  const normalizedPidLc = normalizedPid.toLowerCase();
  for (const [k, state] of Object.entries(partyStates)) {
    const key = safeStr(k);
    if (!key) continue;
    const keyNormalized = normalizePartyPid(key);
    if (
      key === rawPid ||
      key === normalizedPid ||
      key.toLowerCase() === rawPidLc ||
      key.toLowerCase() === normalizedPidLc ||
      (keyNormalized && (keyNormalized === normalizedPid || keyNormalized === rawPid))
    ) {
      return state || {};
    }
  }
  return {};
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── State tracking ──
let _lastRid = null;
let _partyStatesUnsub = null;
let _partyStates = {};
let _prevHash = "";

const sbRoot = document.getElementById("scoreboard");

// ── Inject scoreboard styles ──
(function injectStyles() {
  if (document.getElementById("sb-patch-css")) return;
  const style = document.createElement("style");
  style.id = "sb-patch-css";
  style.textContent = `
/* ═══ SCOREBOARD v2 — Horizontal compact bar ═══ */
#scoreboard {
  display: none;
  width: 100%;
  padding: 6px 14px;
  margin-top: 72px;
  background: rgba(2,6,23,.55);
  border-bottom: 1px solid rgba(148,163,184,.18);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  z-index: 50;
  max-height: 20vh;
  overflow-y: auto;
  overflow-x: hidden;
}
#scoreboard.sb-visible { display: block; }
#scoreboard.sb-visible ~ .hud-tabs { margin-top: 0; }

/* Container: stacks players vertically */
.sb-bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 1440px;
  margin: 0 auto;
}
.sb-bar.sb-bar-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 8px;
}

/* Single player row */
.sb-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  border-radius: 10px;
  background: rgba(255,255,255,.03);
  border: 1px solid rgba(148,163,184,.10);
  min-height: 0;
}
.sb-row.sb-row-me {
  border-color: rgba(34,197,94,.25);
  background: rgba(34,197,94,.04);
}

/* Avatar + name block */
.sb-identity {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-width: 100px;
  max-width: 160px;
}
.sb-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid rgba(56,189,248,.45);
  background: rgba(15,23,42,.7);
  object-fit: cover;
  flex: 0 0 32px;
  box-shadow: 0 0 8px rgba(56,189,248,.15);
}
.sb-avatar-placeholder {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid rgba(56,189,248,.45);
  background: rgba(15,23,42,.7);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 900;
  color: rgba(56,189,248,.8);
  flex: 0 0 32px;
  box-shadow: 0 0 8px rgba(56,189,248,.15);
}
.sb-row-me .sb-avatar,
.sb-row-me .sb-avatar-placeholder {
  border-color: rgba(34,197,94,.55);
  box-shadow: 0 0 8px rgba(34,197,94,.2);
}
.sb-trainer-name {
  font-weight: 900;
  font-size: 11px;
  color: rgba(226,232,240,.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100px;
}
.sb-row-me .sb-trainer-name { color: rgba(34,197,94,.95); }
.sb-row-turn .sb-trainer-name {
  animation: sbTurnNameBlink 1.1s ease-in-out infinite;
}
@keyframes sbTurnNameBlink {
  0%, 100% {
    opacity: 1;
    text-shadow: 0 0 6px rgba(56,189,248,.28);
  }
  50% {
    opacity: .45;
    text-shadow: 0 0 14px rgba(251,191,36,.9);
  }
}

/* Pokémon lineup (horizontal scroll if needed) */
.sb-lineup {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 2px 0;
  scrollbar-width: none;
}
.sb-lineup::-webkit-scrollbar { display: none; }

/* Single pokémon slot */
.sb-poke {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  min-width: 30px;
}
.sb-poke-img {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1.5px solid rgba(148,163,184,.25);
  background: rgba(15,23,42,.5);
  object-fit: contain;
  image-rendering: pixelated;
  padding: 1px;
  display: block;
}
.sb-poke-img.sb-ko {
  filter: grayscale(1);
  opacity: .4;
}
.sb-poke-img.sb-unrevealed {
  opacity: .65;
}
.sb-poke.sb-poke-turn .sb-poke-img {
  border-color: rgba(251,191,36,.95);
  box-shadow:
    0 0 0 2px rgba(251,191,36,.35),
    0 0 14px rgba(251,191,36,.85),
    0 0 28px rgba(56,189,248,.45);
  animation: sbTurnHalo 1.4s ease-in-out infinite;
}
@keyframes sbTurnHalo {
  0%, 100% {
    transform: scale(1);
    filter: drop-shadow(0 0 0 rgba(251,191,36,.0));
  }
  50% {
    transform: scale(1.06);
    filter: drop-shadow(0 0 8px rgba(251,191,36,.85));
  }
}
/* HP bar below sprite */
.sb-poke-hp {
  width: 24px;
  height: 3px;
  border-radius: 2px;
  background: rgba(148,163,184,.18);
  overflow: hidden;
}
.sb-poke-hp-fill {
  height: 100%;
  border-radius: 2px;
  transition: width .3s;
}
/* Empty slot placeholder */
.sb-poke-empty {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1.5px dashed rgba(148,163,184,.15);
  background: rgba(15,23,42,.25);
}

/* Place trainer button */
.sb-place-btn {
  appearance: none;
  cursor: pointer;
  font-weight: 800;
  font-size: 9px;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid rgba(56,189,248,.3);
  background: rgba(56,189,248,.1);
  color: rgba(56,189,248,.9);
  transition: all .15s;
  flex: 0 0 auto;
  white-space: nowrap;
}
.sb-place-btn:hover {
  background: rgba(56,189,248,.2);
  border-color: rgba(56,189,248,.5);
}
.sb-place-btn.sb-placing {
  background: rgba(251,191,36,.15);
  border-color: rgba(251,191,36,.5);
  color: rgba(251,191,36,.95);
  animation: sbPulse2 1.5s ease-in-out infinite;
}
@keyframes sbPulse2 {
  0%,100% { box-shadow: 0 0 0 0 rgba(251,191,36,.2); }
  50%     { box-shadow: 0 0 0 4px rgba(251,191,36,0); }
}

/* VS divider for 2 players */
.sb-vs-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}
.sb-vs-text {
  font-weight: 950;
  font-size: 12px;
  color: rgba(248,113,113,.7);
  text-shadow: 0 0 10px rgba(248,113,113,.3);
  letter-spacing: 1px;
}

/* Responsive */
@media (max-width: 700px) {
  #scoreboard { padding: 4px 8px; }
  .sb-bar.sb-bar-grid { grid-template-columns: 1fr; }
  .sb-row { padding: 3px 6px; gap: 6px; }
  .sb-identity { min-width: 70px; max-width: 100px; }
  .sb-avatar, .sb-avatar-placeholder { width: 24px; height: 24px; flex: 0 0 24px; font-size: 11px; }
  .sb-trainer-name { font-size: 10px; max-width: 60px; }
  .sb-poke-img, .sb-poke-empty { width: 22px; height: 22px; }
  .sb-poke-hp { width: 18px; height: 2px; }
  .sb-place-btn { font-size: 8px; padding: 1px 6px; }
}
`;
  document.head.appendChild(style);
})();

// ── Poll for connection (main.js exposes appState on window) ──
let _pollId = null;
function startPoll() {
  if (_pollId) return;
  _pollId = setInterval(tick, 600);
  tick();
}

function tick() {
  const as = window.appState;
  if (!as) return;
  const rid = safeStr(as.rid);

  if (rid !== _lastRid) {
    cleanup();
    _lastRid = rid;
    if (rid) subscribe(rid);
  }

  if (!rid || !as.connected) {
    sbRoot.classList.remove("sb-visible");
    return;
  }
  sbRoot.classList.add("sb-visible");
  renderIfChanged();
}

// ── Firestore subscriptions ──
function subscribe(rid) {
  const db = getDb();
  const psRef = doc(db, "rooms", rid, "public_state", "party_states");
  _partyStatesUnsub = onSnapshot(psRef, (snap) => {
    _partyStates = snap.exists() ? (snap.data() || {}) : {};
    renderIfChanged();
  }, () => {});
}

function cleanup() {
  if (_partyStatesUnsub) { try { _partyStatesUnsub(); } catch {} _partyStatesUnsub = null; }
  _partyStates = {};
  _prevHash = "";
}

// ── Build player list (sorted: me first, then alphabetical) ──
function buildPlayerList() {
  const as = window.appState;
  if (!as) return [];
  const by = safeStr(as.by);
  const players = Array.isArray(as.players) ? as.players : [];
  const pieces = Array.isArray(as.pieces) ? as.pieces : [];

  const map = new Map();
  for (const p of players) {
    const tn = safeStr(p?.trainer_name);
    if (!tn) continue;
    if (!map.has(tn)) {
      map.set(tn, {
        trainer_name: tn,
        uid: safeStr(p.uid || p.id || ""),
        avatar: p.avatar || null,
        party_snapshot: Array.isArray(p.party_snapshot) ? p.party_snapshot : [],
      });
    }
  }
  for (const p of pieces) {
    const tn = safeStr(p?.owner);
    if (!tn || map.has(tn)) continue;
    map.set(tn, { trainer_name: tn, uid: "", avatar: null, party_snapshot: [] });
  }

  const list = Array.from(map.values());
  list.sort((a, b) => {
    if (safeStr(a.trainer_name) === by) return -1;
    if (safeStr(b.trainer_name) === by) return 1;
    return a.trainer_name.localeCompare(b.trainer_name);
  });
  return list.slice(0, 4);
}

// ── Build slots for a player ──
function buildSlots(player) {
  const tn = safeStr(player.trainer_name);
  const as = window.appState;
  const pieces = Array.isArray(as?.pieces) ? as.pieces : [];
  const partyStates = (_partyStates && _partyStates[tn]) ? _partyStates[tn] : {};

  let party = [];
  if (typeof window.getPartyForTrainer === "function") {
    party = window.getPartyForTrainer(tn);
  }
  if (!party || !party.length) {
    party = Array.isArray(player.party_snapshot) ? player.party_snapshot : [];
  }

  const pids = party.map(x => safeStr(x?.pid || x?.pokemon?.id || x)).filter(Boolean);
  const slots = [];
  const count = Math.min(pids.length, 8);
  for (let i = 0; i < 8; i++) {
    if (i < count) {
      const pid = pids[i];
      const ps = getPartyStateEntry(partyStates, pid);
      const piece = pieces.find(p =>
        safeStr(p?.owner) === tn && safeStr(p?.pid) === pid && safeStr(p?.status || "active") === "active"
      );
      const revealed = piece ? !!piece.revealed : false;
      const hp = ps.hp != null ? Number(ps.hp) : null;
      const ko = hp != null && hp <= 0;
      const spriteUrl = getSpriteUrl(pid, { type: "art", shiny: !!ps.shiny });
      slots.push({ pid, revealed, ko, hp, spriteUrl, empty: false });
    } else {
      slots.push({ pid: null, revealed: false, ko: false, hp: null, spriteUrl: "", empty: true });
    }
  }
  return slots;
}

// ── Sprite resolution ──
function getSpriteUrl(pid, opts) {
  // opts: { type: "battle"|"art", shiny: bool }
  const k = safeStr(pid);
  if (!k) return "";
  if (typeof window.getSpriteUrlFromPid === "function") {
    return window.getSpriteUrlFromPid(k, opts) || POKE_BALL_URL;
  }
  if (k.startsWith("EXT:")) return POKE_BALL_URL;
  const n = Number(k);
  if (Number.isFinite(n) && n > 0 && n < 20000) {
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${n}.png`;
  }
  return POKE_BALL_URL;
}

// ── Get trainer photo ──
function getTrainerPhoto(player) {
  const tn = safeStr(player.trainer_name);
  if (player.avatar?.photo_thumb_b64) {
    return `data:image/png;base64,${player.avatar.photo_thumb_b64}`;
  }
  const as = window.appState;
  if (as?.userProfiles) {
    const uid = safeStr(player.uid) || safeDocId(tn);
    const entry = as.userProfiles.get(uid);
    const profile = entry?.profile;
    if (profile?.avatar?.photo_thumb_b64) {
      return `data:image/png;base64,${profile.avatar.photo_thumb_b64}`;
    }
  }
  return null;
}

function safeDocId(name) {
  return safeStr(name).replace(/[/\\.\s]/g, "_").slice(0, 100) || "_";
}

function getMaxStages(player) {
  return getPartyCount(player) || 8;
}

function getPartyCount(player) {
  const tn = safeStr(player.trainer_name);
  let party = [];
  if (typeof window.getPartyForTrainer === "function") {
    party = window.getPartyForTrainer(tn);
  }
  if (!party || !party.length) {
    party = Array.isArray(player.party_snapshot) ? player.party_snapshot : [];
  }
  return party.length;
}

function getCurrentTurnActor() {
  const turnState = window.appState?.battle?.turn_state;
  if (!turnState || safeStr(turnState.phase) !== "active") return null;
  const order = Array.isArray(turnState.order) ? turnState.order : [];
  if (!order.length) return null;
  const idx = Math.max(0, Number(turnState.index) || 0);
  return order[idx] || null;
}

// ── Change detection ──
function computeHash() {
  const as = window.appState;
  if (!as) return "";
  const parts = [
    safeStr(as.by),
    safeStr(as.rid),
    JSON.stringify((as.players || []).map(p => safeStr(p?.trainer_name) + "|" + (p?.party_snapshot?.length || 0))),
    JSON.stringify((as.pieces || []).map(p => `${p?.owner}:${p?.pid}:${p?.revealed}:${p?.status}`)),
    JSON.stringify(_partyStates),
    safeStr(as.placingTrainer ? "pt" : ""),
    JSON.stringify(as.battle?.turn_state || null),
  ];
  return parts.join("##");
}

function renderIfChanged() {
  const hash = computeHash();
  if (hash === _prevHash) return;
  _prevHash = hash;
  render();
}

// ── Render ──
function render() {
  if (!sbRoot) return;
  const players = buildPlayerList();
  if (!players.length) {
    sbRoot.innerHTML = "";
    return;
  }

  const as = window.appState;
  const by = safeStr(as?.by);
  const turnActor = getCurrentTurnActor();
  const turnOwner = safeStr(turnActor?.owner);
  const turnPid = normalizePartyPid(turnActor?.pid || "");
  const useGrid = players.length >= 2;

  let html = `<div class="sb-bar${useGrid ? " sb-bar-grid" : ""}">`;

  for (let pi = 0; pi < players.length; pi++) {
    const player = players[pi];
    const tn = safeStr(player.trainer_name);
    const isMe = tn === by;
    const isTurnOwner = !!turnOwner && tn === turnOwner;
    const photo = getTrainerPhoto(player);
    const slots = buildSlots(player);
    const maxStages = getMaxStages(player);

    // Avatar
    const avatarHtml = photo
      ? `<img class="sb-avatar" src="${escapeAttr(photo)}" alt="${escapeAttr(tn)}" />`
      : `<div class="sb-avatar-placeholder">${escapeHtml(tn.charAt(0).toUpperCase())}</div>`;

    // Pokémon lineup
    let lineupHtml = "";
    for (const s of slots) {
      if (s.empty) {
        lineupHtml += `<div class="sb-poke"><div class="sb-poke-empty"></div><div class="sb-poke-hp"></div></div>`;
        continue;
      }

      const isTurnPokemon = isTurnOwner && turnPid && normalizePartyPid(s.pid) === turnPid;

      let imgSrc, imgClass;
      if (s.ko) {
        imgSrc = s.revealed ? s.spriteUrl : POKE_BALL_URL;
        imgClass = "sb-poke-img sb-ko";
      } else if (s.revealed) {
        imgSrc = s.spriteUrl;
        imgClass = "sb-poke-img";
      } else {
        imgSrc = POKE_BALL_URL;
        imgClass = "sb-poke-img sb-unrevealed";
      }

      const HP_MAX = 6;
      const hpVal = s.hp != null ? s.hp : HP_MAX;
      const hpPct = Math.max(0, Math.min(100, (hpVal / HP_MAX) * 100));
      const hpCol = s.ko ? "#64748b" : hpPct > 66 ? "#22c55e" : hpPct > 33 ? "#f59e0b" : "#ef4444";

      lineupHtml += `<div class="sb-poke${isTurnPokemon ? " sb-poke-turn" : ""}" title="${escapeAttr(s.pid)}">
        <img class="${imgClass}" src="${escapeAttr(imgSrc)}" loading="lazy" onerror="this.src='${POKE_BALL_URL}'" />
        <div class="sb-poke-hp"><div class="sb-poke-hp-fill" style="width:${hpPct.toFixed(0)}%;background:${hpCol}"></div></div>
      </div>`;
    }

    // Place trainer button (only for self)
    const isPlacing = !!as?.placingTrainer && as.placingTrainer === tn;
    const placeBtnHtml = isMe
      ? `<button class="sb-place-btn${isPlacing ? " sb-placing" : ""}" data-action="place-trainer" data-trainer="${escapeAttr(tn)}">${isPlacing ? "Clique no mapa..." : "Posicionar"}</button>`
      : "";

    html += `<div class="sb-row${isMe ? " sb-row-me" : ""}${isTurnOwner ? " sb-row-turn" : ""}" data-trainer="${escapeAttr(tn)}">
      <div class="sb-identity">
        ${avatarHtml}
        <span class="sb-trainer-name" title="${escapeAttr(tn)}">${escapeHtml(tn)}</span>
      </div>
      <div class="sb-lineup">${lineupHtml}</div>
      ${placeBtnHtml}
    </div>`;

  }

  html += `</div>`;
  sbRoot.innerHTML = html;
}

// ── Event delegation for Place Trainer button ──
sbRoot.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-action='place-trainer']");
  if (!btn) return;
  ev.stopPropagation();

  const tn = safeStr(btn.dataset.trainer);
  if (!tn) return;

  const as = window.appState;
  if (!as || !as.connected || !as.rid) return;

  if (as.placingTrainer === tn) {
    as.placingTrainer = null;
  } else {
    as.placingTrainer = tn;
    as.placingPid = null;
  }
  renderIfChanged();
  _prevHash = "";
  render();
});

// ── Handle placing trainer on canvas click ──
function installCanvasInterceptor() {
  const canvas = document.getElementById("arena");
  if (!canvas) return;

  canvas.addEventListener("click", (ev) => {
    const as = window.appState;
    if (!as?.placingTrainer) return;

    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const tile = window.screenToTile?.(x, y);
    if (!tile) return;

    ev.stopImmediatePropagation();
    placeTrainerAt(as.placingTrainer, tile.row, tile.col);
  }, true);
}

async function placeTrainerAt(trainerName, row, col) {
  const as = window.appState;
  const db = window.currentDb || getDb();
  const rid = safeStr(as?.rid || window.currentRid);
  const tn = safeStr(trainerName);
  if (!db || !rid || !tn) return;

  const r = Number(row);
  const c = Number(col);
  if (!Number.isFinite(r) || !Number.isFinite(c)) return;

  const ref = doc(db, "rooms", rid, "public_state", "state");

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists() ? snap.data() : {};
      let pieces = Array.isArray(data?.pieces) ? [...data.pieces] : [];

      const occupied = pieces.some(p =>
        safeStr(p?.status || "active") === "active" && Number(p?.row) === r && Number(p?.col) === c
      );
      if (occupied) throw new Error("tile ocupado");

      const existingIdx = pieces.findIndex(p =>
        safeStr(p?.owner) === tn && safeStr(p?.kind) === "trainer" && safeStr(p?.status || "active") === "active"
      );

      let avatarChoice = "";
      const player = (as.players || []).find(p => safeStr(p?.trainer_name) === tn);
      if (player?.avatar?.avatar_choice) avatarChoice = player.avatar.avatar_choice;

      if (existingIdx >= 0) {
        pieces[existingIdx] = { ...pieces[existingIdx], row: r, col: c };
      } else {
        const newId = `tc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        pieces.push({
          id: newId,
          owner: tn,
          kind: "trainer",
          pid: `trainer_${tn}`,
          row: r,
          col: c,
          revealed: true,
          status: "active",
          avatar: avatarChoice,
        });
      }

      tx.set(ref, { pieces, updatedAt: serverTimestamp() }, { merge: true });
    });

    as.placingTrainer = null;
    _prevHash = "";
    render();
  } catch (e) {
    console.warn("[scoreboard] falha ao posicionar trainer:", e?.message || e);
  }
}

// ── DOM fallback click handler ──
function installDomFallbackInterceptor() {
  const arenaDom = document.getElementById("arena_dom");
  if (!arenaDom) return;

  arenaDom.addEventListener("click", (ev) => {
    const as = window.appState;
    if (!as?.placingTrainer) return;

    const cell = ev.target?.closest?.(".cell");
    if (!cell) return;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);

    ev.stopImmediatePropagation();
    placeTrainerAt(as.placingTrainer, row, col);
  }, true);
}

// ── Expose getSpriteUrlFromPid if main.js hasn't yet ──
if (typeof window.getSpriteUrlFromPid !== "function") {
  window.getSpriteUrlFromPid = getSpriteUrl;
}

// ── Boot ──
installCanvasInterceptor();
installDomFallbackInterceptor();
startPoll();
