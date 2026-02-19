/**
 * initiative-patch.js — Integra InitiativeUI no battle-site
 *
 * Segue exatamente o mesmo padrão do combat-patch.js:
 *  1. Lê rid, by, role dos badges do DOM
 *  2. Aguarda conexão (appState ou polling nos badges)
 *  3. Instancia InitiativeUI dentro do #tab_initiative .panel-inner
 *  4. Reinicia sempre que rid/by mudar
 */

import { InitiativeUI } from "./initiative.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// ─── Debug ────────────────────────────────────────────────────────────
function dbg(...a) { console.log("%c[initiative]", "color:#a78bfa;font-weight:bold", ...a); }
function dbgErr(...a) { console.error("%c[initiative]", "color:#f87171;font-weight:bold", ...a); }

// ─── Ler badges do DOM (igual ao combat-patch) ────────────────────────
function readBadge(id) {
  const el = document.getElementById(id);
  return el ? el.textContent.trim() : "";
}
function readBy()   { return readBadge("me_badge").replace(/^by:\s*/i, "").trim(); }
function readRid()  { return readBadge("rid_badge").replace(/^—$/, "").trim(); }
function readRole() { return readBadge("role_badge").replace(/^role:\s*/i, "").trim() || "spectator"; }

// ─── Firebase (reusa ou cria) ─────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD6MLb1P5IzFB4MJpX2M7T9vB3kZQwRtNc",
  authDomain: "gaaldex.firebaseapp.com",
  projectId: "gaaldex",
  storageBucket: "gaaldex.appspot.com",
  messagingSenderId: "523088109672",
  appId: "1:523088109672:web:placeholder",
};

function getDb() {
  // Tenta reusar o db exposto pelo main.js
  if (window._combatDb) return window._combatDb;
  if (window._initiativeDb) return window._initiativeDb;

  const apps = getApps();
  let app;
  if (apps.length > 0) {
    app = apps[0];
  } else {
    // Tenta pegar config real do DOM (injetada pelo main.js)
    const cfgEl = document.getElementById("firebase_config");
    let cfg = FIREBASE_CONFIG;
    if (cfgEl) {
      try { cfg = JSON.parse(cfgEl.textContent); } catch {}
    }
    app = initializeApp(cfg);
  }
  const db = getFirestore(app);
  window._initiativeDb = db;
  return db;
}

// ─── Instância ativa ──────────────────────────────────────────────────
let _ui = null;
let _lastKey = "";

function maybeInit() {
  const rid  = readRid();
  const by   = readBy();
  const role = readRole();

  const key = `${rid}|${by}|${role}`;
  if (!rid || !by) return;          // ainda não conectou
  if (key === _lastKey) return;     // nada mudou
  _lastKey = key;

  // Destrói instância anterior
  if (_ui) { try { _ui.destroy(); } catch {} _ui = null; }

  // Encontra container
  const tabEl = document.getElementById("tab_initiative");
  if (!tabEl) { dbgErr("tab_initiative não encontrado"); return; }

  let inner = tabEl.querySelector(".panel-inner");
  if (!inner) {
    inner = document.createElement("div");
    inner.className = "panel-inner";
    tabEl.appendChild(inner);
  }
  inner.innerHTML = `<div class="muted" style="padding:20px">⏳ Carregando iniciativa...</div>`;

  const db = getDb();
  if (!db) { dbgErr("Firestore não disponível"); return; }

  try {
    _ui = new InitiativeUI({ db, rid, by, role, container: inner });
    dbg("InitiativeUI iniciado", { rid, by, role });
  } catch (err) {
    dbgErr("Erro ao iniciar InitiativeUI:", err);
    inner.innerHTML = `<div class="card" style="color:#f87171">Erro ao carregar iniciativa: ${err.message}</div>`;
  }
}

// ─── Polling (garante inicialização mesmo em carregamentos lentos) ────
function startPolling() {
  maybeInit();
  setInterval(maybeInit, 1500);
}

// ─── Aguarda DOM e dispara ────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startPolling);
} else {
  startPolling();
}

// Também reinicia ao clicar na aba (garante dados frescos)
document.addEventListener("click", (e) => {
  if (e.target?.dataset?.tab === "initiative") {
    setTimeout(maybeInit, 100);
  }
});

dbg("initiative-patch.js carregado ✅");
