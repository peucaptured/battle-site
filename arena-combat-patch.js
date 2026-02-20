/**
 * arena-combat-patch.js — Integra ArenaCombatUI no battle-site
 *
 * Mesmo padrão do combat-patch.js:
 *  - Lê badges do DOM (rid, by, role)
 *  - Conecta listener do battle doc via onSnapshot
 *  - Cria instância de ArenaCombatUI
 *  - Chama render() a cada mudança
 */

import { ArenaCombatUI } from "./arena-combat.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  doc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// ─── Debug ───────────────────────────────────────────────────────
function dbg(...a) { console.log("%c[arena-combat]", "color:#a78bfa;font-weight:bold", ...a); }
function dbgErr(...a) { console.error("%c[arena-combat]", "color:#f87171;font-weight:bold", ...a); }

// ─── Helpers ─────────────────────────────────────────────────────
function readBadge(id) {
  const el = document.getElementById(id);
  return el ? el.textContent.trim() : "";
}
function readBy() { return readBadge("me_badge").replace(/^by:\s*/i, "").trim(); }
function readRid() { return readBadge("rid_badge").replace(/^—$/, "").trim(); }
function readRole() { return readBadge("role_badge").replace(/^role:\s*/i, "").trim() || "spectator"; }
function readPieces() {
  try {
    const el = document.getElementById("state");
    if (!el) return [];
    const data = JSON.parse(el.textContent || "{}");
    return Array.isArray(data?.pieces) ? data.pieces : [];
  } catch { return []; }
}

// ─── Firebase db ─────────────────────────────────────────────────
const FB_CONFIG = {
  apiKey: "AIzaSyD2YZfQc-qeqMT3slk0ouvPC08d901te-Q",
  authDomain: "batalhas-de-gaal.firebaseapp.com",
  projectId: "batalhas-de-gaal",
  storageBucket: "batalhas-de-gaal.firebasestorage.app",
  messagingSenderId: "676094077702",
  appId: "1:676094077702:web:31095aa7dd2100b17d0c87",
};

let myDb = null;

function getDb() {
  if (window._combatDb) return window._combatDb;
  if (myDb) return myDb;
  try {
    const apps = getApps();
    if (apps.length > 0) {
      myDb = getFirestore(apps[0]);
      return myDb;
    }
  } catch (e) { dbgErr("getApps falhou:", e); }
  try {
    const app = initializeApp(FB_CONFIG, "arena-combat-" + Date.now());
    myDb = getFirestore(app);
    return myDb;
  } catch (e) { dbgErr("initializeApp falhou:", e); }
  return null;
}

// ─── State ───────────────────────────────────────────────────────
let arenaCombatUI = null;
let currentRid = null;
let battleUnsub = null;
let localBattle = null;

// ─── Init ────────────────────────────────────────────────────────
function init() {
  const arenaWrap = document.getElementById("arena_wrap");
  if (!arenaWrap) {
    dbg("arena_wrap não encontrado, retry em 500ms...");
    setTimeout(init, 500);
    return;
  }

  // Wait for main.js globals
  if (!window.appState || !window.screenToTile) {
    dbg("Aguardando main.js exportar globals...");
    setTimeout(init, 500);
    return;
  }

  dbg("arena_wrap encontrado ✓");

  arenaCombatUI = new ArenaCombatUI({
    arenaWrap,
    getDb:      () => getDb(),
    getRid:     () => currentRid,
    getBy:      () => readBy(),
    getRole:    () => readRole(),
    getBattle:  () => localBattle,
    getPieces:  () => {
      // Prefer live appState (more up-to-date than the <pre> json)
      if (window.appState?.pieces?.length) return window.appState.pieces;
      return readPieces();
    },
  });

  window._arenaCombatUI = arenaCombatUI;

  setInterval(checkConnection, 800);

  dbg("✅ Inicializado");
  dbg("  db:", getDb() ? "OK" : "NULL ⚠️");
  dbg("  rid:", readRid() || "(vazio)");
  dbg("  by:", readBy() || "(vazio)");
  dbg("  role:", readRole());
}

function checkConnection() {
  const db = getDb();
  const rid = readRid();

  if (!db || !rid || rid === "—") {
    if (currentRid) disconnect();
    return;
  }
  if (rid !== currentRid) {
    disconnect();
    connect(db, rid);
  }
}

function connect(db, rid) {
  currentRid = rid;
  dbg("Conectando battle listener, rid =", rid);
  try {
    const ref = doc(db, "rooms", rid, "public_state", "battle");
    battleUnsub = onSnapshot(ref, (snap) => {
      localBattle = snap.exists() ? snap.data() : null;
      if (arenaCombatUI) arenaCombatUI.render();
    }, (err) => dbgErr("Snapshot erro:", err));
    if (arenaCombatUI) arenaCombatUI.startListening();
    dbg("✅ Conectado");
  } catch (e) { dbgErr("Erro ao conectar:", e); }
}

function disconnect() {
  if (battleUnsub) { try { battleUnsub(); } catch {} battleUnsub = null; }
  currentRid = null;
  localBattle = null;
  if (arenaCombatUI) { arenaCombatUI.stopListening(); }
}

// ─── Start ───────────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => setTimeout(init, 600));
} else {
  setTimeout(init, 600);
}
