/**
 * scoreboard-patch.js — Scoreboard circular multi-jogador (até 4 players, até 8 pokémon cada)
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

// ── Firebase Storage (public URL helper) ──
const TRAINER_PHOTO_FILENAME = "profile.png"; // <- seus arquivos estão assim
function storageMediaUrl(path) {
  const bucket = (FIREBASE_CONFIG && FIREBASE_CONFIG.storageBucket) || "";
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;
}
function trainerFolderCandidates(trainerName) {
  const tn = safeStr(trainerName);
  const s = safeDocId(tn);
  // tenta 1) nome como veio, 2) versão "safe"
  return Array.from(new Set([tn, s].filter(Boolean)));
}


function getDb() {
  const apps = getApps();
  const app = apps.length ? apps[0] : initializeApp(FIREBASE_CONFIG);
  return getFirestore(app);
}

// ── Helpers ──
const safeStr = (x) => (x == null ? "" : String(x).trim());
const POKE_BALL_URL = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png";

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── State tracking ──
let _lastRid = null;
let _partyStatesUnsub = null;
let _playersUnsub = null;
let _stateUnsub = null;
let _partyStates = {};
let _prevHash = "";

const sbRoot = document.getElementById("scoreboard");

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

  // Connection changed?
  if (rid !== _lastRid) {
    cleanup();
    _lastRid = rid;
    if (rid) subscribe(rid);
  }

  // Visibility
  if (!rid || !as.connected) {
    sbRoot.classList.remove("sb-visible");
    return;
  }
  sbRoot.classList.add("sb-visible");

  // Re-render if data changed
  renderIfChanged();
}

// ── Firestore subscriptions (party_states only — players/state come from appState) ──
function subscribe(rid) {
  const db = getDb();

  // party_states
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

  // Collect unique trainer names
  const map = new Map(); // trainerName -> {trainer_name, avatar, party_snapshot, uid}
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

  // Fallback: owners from pieces
  for (const p of pieces) {
    const tn = safeStr(p?.owner);
    if (!tn || map.has(tn)) continue;
    map.set(tn, { trainer_name: tn, uid: "", avatar: null, party_snapshot: [] });
  }

  // Sort: me first, then alphabetical
  const list = Array.from(map.values());
  list.sort((a, b) => {
    if (safeStr(a.trainer_name) === by) return -1;
    if (safeStr(b.trainer_name) === by) return 1;
    return a.trainer_name.localeCompare(b.trainer_name);
  });

  return list.slice(0, 4); // max 4 players
}

// ── Build slots for a player ──
function buildSlots(player) {
  const tn = safeStr(player.trainer_name);
  const as = window.appState;
  const pieces = Array.isArray(as?.pieces) ? as.pieces : [];
  const partyStates = (_partyStates && _partyStates[tn]) ? _partyStates[tn] : {};

  // Get party (use getPartyForTrainer if available, else party_snapshot)
  let party = [];
  if (typeof window.getPartyForTrainer === "function") {
    party = window.getPartyForTrainer(tn);
  }
  if (!party || !party.length) {
    party = Array.isArray(player.party_snapshot) ? player.party_snapshot : [];
  }

  // Normalize to pid strings
  const pids = party.map(x => safeStr(x?.pid || x?.pokemon?.id || x)).filter(Boolean);

  // Pad/truncate to 8
  const slots = [];
  const count = Math.min(pids.length, 8);
  for (let i = 0; i < 8; i++) {
    if (i < count) {
      const pid = pids[i];
      const ps = partyStates[pid] || {};
      const piece = pieces.find(p =>
        safeStr(p?.owner) === tn && safeStr(p?.pid) === pid && safeStr(p?.status || "active") === "active"
      );
      const revealed = piece ? !!piece.revealed : false;
      const hp = ps.hp != null ? Number(ps.hp) : null; // null = not set
      const ko = hp != null && hp <= 0;
      const spriteUrl = getSpriteUrl(pid);

      slots.push({ pid, revealed, ko, hp, spriteUrl, empty: false });
    } else {
      slots.push({ pid: null, revealed: false, ko: false, hp: null, spriteUrl: "", empty: true });
    }
  }
  return slots;
}

// ── Sprite resolution (delegates to main.js if available) ──
function getSpriteUrl(pid) {
  const k = safeStr(pid);
  if (!k) return "";
  // Try main.js global
  if (typeof window.getSpriteUrlFromPid === "function") {
    return window.getSpriteUrlFromPid(k) || POKE_BALL_URL;
  }
  // Fallback
  if (k.startsWith("EXT:")) return POKE_BALL_URL;
  const n = Number(k);
  if (Number.isFinite(n) && n > 0 && n < 20000) {
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${n}.png`;
  }
  return POKE_BALL_URL;
}

// ── Get trainer photo ──
function getTrainerPhotoUrls(player) {
  const tn = safeStr(player.trainer_name);

  // 1) player.avatar.photo_thumb_b64 (mais rápido, não depende de regras do Storage)
  if (player.avatar?.photo_thumb_b64) {
    return { primary: `data:image/png;base64,${player.avatar.photo_thumb_b64}`, fallback: null };
  }

  // 2) userProfiles (se main.js estiver populando isso)
  const as = window.appState;
  if (as?.userProfiles) {
    const uid = safeStr(player.uid) || safeDocId(tn);
    const entry = as.userProfiles.get(uid);
    const profile = entry?.profile;
    if (profile?.avatar?.photo_thumb_b64) {
      return { primary: `data:image/png;base64,${profile.avatar.photo_thumb_b64}`, fallback: null };
    }
  }

  // 3) Firebase Storage: trainer_photos/<TrainerName>/profile.png
  // Observação: <img> não aceita gs://, tem que ser URL HTTP.
  if (tn) {
    const cands = trainerFolderCandidates(tn);
    const primary = storageMediaUrl(`trainer_photos/${cands[0]}/${TRAINER_PHOTO_FILENAME}`);
    const fallback = cands[1] ? storageMediaUrl(`trainer_photos/${cands[1]}/${TRAINER_PHOTO_FILENAME}`) : null;
    return { primary, fallback };
  }

  return { primary: null, fallback: null };
}

function safeDocId(name) {
  return safeStr(name).replace(/[/\\.\s]/g, "_").slice(0, 100) || "_";
}

// ── Compute ring positions for N slots around center ──
function ringPositions(count, ringRadius) {
  // Distribute slots in an arc from -135° to +135° (front-facing arc)
  const positions = [];
  if (count <= 0) return positions;
  const startAngle = -Math.PI * 0.75; // -135°
  const endAngle = Math.PI * 0.75;    // +135°
  const step = count === 1 ? 0 : (endAngle - startAngle) / (count - 1);
  for (let i = 0; i < count; i++) {
    const angle = count === 1 ? -Math.PI / 2 : startAngle + step * i;
    const cx = 50 + ringRadius * Math.cos(angle);
    const cy = 50 + ringRadius * Math.sin(angle);
    positions.push({ left: cx, top: cy });
  }
  return positions;
}

// ── Compute maxStages for a player ──
function getMaxStages(player) {
  const party = getPartyCount(player);
  return party > 0 && party <= 8 ? party : 8;
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

// ── Quick hash for change detection ──
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
  ];
  return parts.join("##");
}

// ── Render (only if data changed) ──
function renderIfChanged() {
  const hash = computeHash();
  if (hash === _prevHash) return;
  _prevHash = hash;
  render();
}

function render() {
  if (!sbRoot) return;
  const players = buildPlayerList();
  if (!players.length) {
    sbRoot.innerHTML = "";
    return;
  }

  const as = window.appState;
  const by = safeStr(as?.by);
  const me = players.find(p => safeStr(p?.trainer_name) === by) || players[0];
  const opponents = players.filter(p => safeStr(p?.trainer_name) !== safeStr(me?.trainer_name));

  const oppCount = opponents.length;
  const sbClass = `sb-line sb-opp-${Math.min(4, Math.max(0, oppCount))}`;

  const html = `
    <div class="sb-container ${sbClass}">
      ${renderPartyRow(me, { isMe: true, side: "left" })}

      <div class="sb-center">
        ${renderPortrait(me, { isMe: true })}
        ${oppCount ? `<div class="sb-vs" aria-label="versus">VS</div>` : ``}
        <div class="sb-opponents">
          ${opponents.map(p => `
            <div class="sb-opponent">
              ${renderPortrait(p, { isMe: false })}
              ${renderPartyRow(p, { isMe: false, side: "right" })}
            </div>
          `).join("")}
        </div>
      </div>
    </div>
  `;

  sbRoot.innerHTML = html;

  // Adjust .app height
  requestAnimationFrame(() => {
    const sbH = sbRoot.offsetHeight;
    const app = document.querySelector(".app");
    if (app) {
      app.style.height = `calc(100% - 56px - ${sbH}px)`;
    }
  });
}

function renderPortrait(player, { isMe }) {
  const tn = safeStr(player?.trainer_name);
  const { primary: photo, fallback: photo2 } = getTrainerPhotoUrls(player);
  const initial = (tn.charAt(0) || "?").toUpperCase();

  const photoHtml = photo
    ? `<img class="sb-photo" src="${escapeAttr(photo)}" alt="${escapeAttr(tn)}" loading="lazy"
        onerror="if(this.dataset.fallback!=='1' && '${escapeAttr(photo2 || "")}'){this.dataset.fallback='1';this.src='${escapeAttr(photo2 || "")}';}else{this.style.display='none';this.insertAdjacentHTML('afterend','<div class=&quot;sb-photo-placeholder&quot;>${escapeHtml(initial)}</div>');}" />`
    : `<div class="sb-photo-placeholder">${escapeHtml(initial)}</div>`;

  const as = window.appState;
  const isPlacing = !!as?.placingTrainer && safeStr(as.placingTrainer) === tn;
  const placeBtnHtml = isMe
    ? `<button class="sb-place-btn${isPlacing ? " sb-placing" : ""}" data-action="place-trainer" data-trainer="${escapeAttr(tn)}">${isPlacing ? "Clique no mapa..." : "Posicionar avatar"}</button>`
    : "";

  return `
    <div class="sb-portrait${isMe ? " sb-me" : ""}" title="${escapeAttr(tn)}">
      <div class="sb-portrait-core">${photoHtml}</div>
      <div class="sb-name">${escapeHtml(tn)}</div>
      ${placeBtnHtml}
    </div>
  `;
}

function renderPartyRow(player, { isMe, side }) {
  const tn = safeStr(player?.trainer_name);
  const slots = buildSlots(player);
  const maxStages = getMaxStages(player);

  const chips = slots.map((s) => {
    if (s.empty) {
      return `<div class="sb-chip sb-empty" aria-hidden="true"></div>`;
    }

    let imgSrc, imgClass;
    if (s.ko) {
      imgSrc = s.revealed ? s.spriteUrl : POKE_BALL_URL;
      imgClass = "sb-chip-img sb-ko";
    } else if (s.revealed) {
      imgSrc = s.spriteUrl;
      imgClass = "sb-chip-img";
    } else {
      imgSrc = POKE_BALL_URL;
      imgClass = "sb-chip-img sb-unrevealed";
    }

    const hpVal = s.hp != null ? s.hp : maxStages;
    const hpPct = maxStages > 0 ? Math.max(0, Math.min(100, (hpVal / maxStages) * 100)) : 100;

    return `
      <div class="sb-chip" data-owner="${escapeAttr(tn)}" data-pid="${escapeAttr(s.pid)}" title="${escapeAttr(s.pid)}">
        <img class="${imgClass}" src="${escapeAttr(imgSrc)}" loading="lazy" onerror="this.src='${POKE_BALL_URL}'" />
        <div class="sb-chip-hp"><div class="sb-chip-hp-fill" style="width:${hpPct.toFixed(0)}%"></div></div>
      </div>
    `;
  }).join("");

  return `
    <div class="sb-party ${isMe ? "sb-party-me" : "sb-party-opp"} sb-${escapeAttr(side || "left")}" aria-label="time de ${escapeAttr(tn)}">
      ${chips}
    </div>
  `;
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

  // Toggle placing mode
  if (as.placingTrainer === tn) {
    as.placingTrainer = null;
  } else {
    as.placingTrainer = tn;
    as.placingPid = null; // cancel pokémon placement if any
  }
  renderIfChanged();
  _prevHash = ""; // force re-render
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
  }, true); // capture phase to intercept before main.js
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

      // Check if tile is occupied
      const occupied = pieces.some(p =>
        safeStr(p?.status || "active") === "active" && Number(p?.row) === r && Number(p?.col) === c
      );
      if (occupied) throw new Error("tile ocupado");

      // Find existing trainer token
      const existingIdx = pieces.findIndex(p =>
        safeStr(p?.owner) === tn && safeStr(p?.kind) === "trainer" && safeStr(p?.status || "active") === "active"
      );

      // Get avatar choice
      let avatarChoice = "";
      const player = (as.players || []).find(p => safeStr(p?.trainer_name) === tn);
      if (player?.avatar?.avatar_choice) avatarChoice = player.avatar.avatar_choice;

      if (existingIdx >= 0) {
        // Move existing trainer token
        pieces[existingIdx] = { ...pieces[existingIdx], row: r, col: c };
      } else {
        // Create new trainer token
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

// ── DOM fallback click handler (for non-canvas arena) ──
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
// (main.js will overwrite this once loaded)
if (typeof window.getSpriteUrlFromPid !== "function") {
  window.getSpriteUrlFromPid = getSpriteUrl;
}

// ── Boot ──
installCanvasInterceptor();
installDomFallbackInterceptor();
startPoll();
