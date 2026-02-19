/**
 * combat-patch.js v3 — Integra CombatUI no battle-site
 *
 * Fallback: se window._combatDb não existir, cria seu próprio Firebase app.
 * Logging: tudo logado no console para debug.
 */

import { CombatUI } from "./combat.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  doc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// ─── Debug ───────────────────────────────────────────────────────────
function dbg(...a) { console.log("%c[combat]", "color:#38bdf8;font-weight:bold", ...a); }
function dbgErr(...a) { console.error("%c[combat]", "color:#f87171;font-weight:bold", ...a); }

// ─── Helpers ─────────────────────────────────────────────────────────
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

// ─── Firebase db ─────────────────────────────────────────────────────
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
  // 1) main.js exposed it
  if (window._combatDb) return window._combatDb;
  // 2) our own db
  if (myDb) return myDb;
  // 3) try to grab the default app that main.js created
  try {
    const apps = getApps();
    if (apps.length > 0) {
      myDb = getFirestore(apps[0]);
      dbg("Reusou app existente:", apps[0].name);
      return myDb;
    }
  } catch (e) { dbgErr("getApps falhou:", e); }
  // 4) create our own
  try {
    const app = initializeApp(FB_CONFIG, "combat-" + Date.now());
    myDb = getFirestore(app);
    dbg("Criou app próprio:", app.name);
    return myDb;
  } catch (e) { dbgErr("initializeApp falhou:", e); }
  return null;
}

// ─── State ───────────────────────────────────────────────────────────
let combatUI = null;
let currentRid = null;
let battleUnsub = null;
let localBattle = null;

// ─── Init ────────────────────────────────────────────────────────────
function init() {
  const container = document.querySelector("#tab_combat .panel-inner");
  if (!container) {
    dbg("Container não encontrado, retry em 500ms...");
    setTimeout(init, 500);
    return;
  }
  dbg("Container encontrado ✓");

  combatUI = new CombatUI({
    container,
    getDb:      () => getDb(),
    getRid:     () => currentRid,
    getBy:      () => readBy(),
    getRole:    () => readRole(),
    getBattle:  () => localBattle,
    getPieces:  () => readPieces(),
    getPlayers: () => [],
  });

  window._combatUI = combatUI;

  setInterval(checkConnection, 800);
  combatUI.render();

  dbg("✅ Inicializado");
  dbg("  db:", getDb() ? "OK" : "NULL ⚠️");
  dbg("  rid:", readRid() || "(vazio)");
  dbg("  by:", readBy() || "(vazio)");
  dbg("  role:", readRole() || "(vazio)");
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
      if (combatUI) combatUI.render();
    }, (err) => dbgErr("Snapshot erro:", err));
    if (combatUI) combatUI.startListening();
    dbg("✅ Conectado");
  } catch (e) { dbgErr("Erro ao conectar:", e); }
}

function disconnect() {
  if (battleUnsub) { try { battleUnsub(); } catch {} battleUnsub = null; }
  currentRid = null;
  localBattle = null;
  if (combatUI) { combatUI.stopListening(); combatUI.render(); }
}

// ─── Start ───────────────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => setTimeout(init, 500));
} else {
  setTimeout(init, 500);
}
