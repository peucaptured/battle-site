/**
 * combat-patch.js — Integra o CombatUI no battle-site existente.
 *
 * Carregado como módulo separado APÓS main.js.
 *
 * Estratégia: NÃO modifica main.js.
 * Em vez disso, intercepta o Firestore init via proxy e monitora
 * o elemento #battle_preview (que main.js já atualiza) para detectar
 * mudanças no estado de batalha.
 */

import { CombatUI } from "./combat.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  doc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// ─── Bridge: reconstruct Firestore connection from DOM state ────────
// main.js shows rid in #rid_badge and by in #me_badge.
// We reconstruct our own Firestore ref using the same config.

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD2YZfQc-qeqMT3slk0ouvPC08d901te-Q",
  authDomain: "batalhas-de-gaal.firebaseapp.com",
  projectId: "batalhas-de-gaal",
  storageBucket: "batalhas-de-gaal.firebasestorage.app",
  messagingSenderId: "676094077702",
  appId: "1:676094077702:web:31095aa7dd2100b17d0c87",
};

let combatDb = null;
let combatUI = null;
let currentRid = null;

// Local mirror of appState (read from DOM badges + battle_preview JSON)
const localState = {
  battle: null,
  by: "",
  role: "spectator",
  pieces: [],
  players: [],
};

function getDb() { return combatDb; }
function getRid() { return currentRid; }

function readBadge(id) {
  const el = document.getElementById(id);
  return el ? el.textContent.trim() : "";
}

function readBy() {
  const raw = readBadge("me_badge"); // "by: Logan"
  return raw.replace(/^by:\s*/i, "").trim();
}

function readRid() {
  return readBadge("rid_badge").replace(/^—$/, "");
}

function readRole() {
  return readBadge("role_badge").replace(/^role:\s*/i, "").trim() || "spectator";
}

// Parse pieces from the state <pre> element
function readPieces() {
  try {
    const el = document.getElementById("state");
    if (!el) return [];
    const data = JSON.parse(el.textContent || "{}");
    return Array.isArray(data?.pieces) ? data.pieces : [];
  } catch { return []; }
}

// Parse battle from the battle <pre> element
function readBattle() {
  try {
    const el = document.getElementById("battle_preview");
    if (!el || el.textContent.trim() === "—" || el.textContent.trim() === "null") return null;
    return JSON.parse(el.textContent || "null");
  } catch { return null; }
}

// ─── Initialize ─────────────────────────────────────────────────────
function init() {
  const container = document.querySelector("#tab_combat .panel-inner");
  if (!container) {
    console.warn("combat-patch: container not found, retrying...");
    setTimeout(init, 500);
    return;
  }

  // Use existing Firebase app if available, otherwise create
  try {
    const apps = getApps();
    const app = apps.length > 0 ? apps[0] : initializeApp(FIREBASE_CONFIG, "combat");
    combatDb = getFirestore(app);
  } catch {
    try {
      const app = initializeApp(FIREBASE_CONFIG, "combat-" + Date.now());
      combatDb = getFirestore(app);
    } catch (e) {
      console.error("combat-patch: Firebase init failed", e);
      return;
    }
  }

  combatUI = new CombatUI({
    container,
    getDb:      () => combatDb,
    getRid:     () => currentRid,
    getBy:      () => readBy(),
    getRole:    () => readRole(),
    getBattle:  () => localState.battle,
    getPieces:  () => readPieces(),
    getPlayers: () => localState.players,
  });

  window._combatUI = combatUI;

  // ─── Monitor connection changes ────────────────────────────────
  let battleUnsub = null;

  function connectCombat() {
    const rid = readRid();
    if (!rid || rid === "—") {
      currentRid = null;
      combatUI.stopListening();
      localState.battle = null;
      combatUI.render();
      return;
    }
    if (rid === currentRid) return; // already connected

    // Disconnect previous
    if (battleUnsub) { try { battleUnsub(); } catch {} }
    currentRid = rid;
    combatUI.startListening();

    // Listen to battle doc independently
    const battleRef = doc(combatDb, "rooms", rid, "public_state", "battle");
    battleUnsub = onSnapshot(battleRef, (snap) => {
      localState.battle = snap.exists() ? snap.data() : null;
      combatUI.render();
    }, () => {});
  }

  function disconnectCombat() {
    if (battleUnsub) { try { battleUnsub(); } catch {} battleUnsub = null; }
    currentRid = null;
    combatUI.stopListening();
    localState.battle = null;
    combatUI.render();
  }

  // Hook connect/disconnect buttons
  document.getElementById("connect")?.addEventListener("click", () => {
    setTimeout(connectCombat, 800);
  });
  document.getElementById("disconnect")?.addEventListener("click", () => {
    disconnectCombat();
  });

  // Poll for rid changes (covers cases where main.js connects programmatically)
  setInterval(() => {
    const rid = readRid();
    if (rid && rid !== "—" && rid !== currentRid) connectCombat();
    if ((!rid || rid === "—") && currentRid) disconnectCombat();
  }, 1000);

  combatUI.render();
  console.log("✅ combat-patch: CombatUI initialized");
}

// Start when DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => setTimeout(init, 300));
} else {
  setTimeout(init, 300);
}
