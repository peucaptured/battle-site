import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore, doc, collection, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const el = (id) => document.getElementById(id);
const statusEl = el("status");
const ridBadge = el("rid_badge");

let unsub = [];

function setStatus(kind, text){
  statusEl.className = "pill " + (kind === "ok" ? "ok" : kind === "err" ? "err" : "warn");
  statusEl.textContent = text;
}

function pretty(x){
  try { return JSON.stringify(x ?? null, null, 2); } catch { return String(x); }
}

function cleanup(){
  unsub.forEach(fn => { try { fn(); } catch {} });
  unsub = [];
  ridBadge.textContent = "—";
  el("players").textContent = "—";
  el("state").textContent = "—";
  el("battle").textContent = "—";
  setStatus("warn", "desconectado");
}

el("disconnect").addEventListener("click", cleanup);

el("connect").addEventListener("click", () => {
  cleanup();

  const rid = (el("rid").value || "").trim();
  if(!rid){ setStatus("err", "faltou rid"); return; }

  let cfg = null;
  try {
    cfg = JSON.parse(el("cfg").value || "{}");
  } catch (e) {
    setStatus("err", "firebaseConfig inválido (JSON)");
    return;
  }
  if(!cfg.projectId){
    setStatus("err", "firebaseConfig sem projectId");
    return;
  }

  ridBadge.textContent = rid;

  const app = initializeApp(cfg);
  const db = getFirestore(app);

  setStatus("ok", "conectado");

  // Players subcollection
  const playersCol = collection(db, "rooms", rid, "players");
  unsub.push(onSnapshot(playersCol, (snap) => {
    const arr = [];
    snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
    arr.sort((a,b) => (a.role||"").localeCompare(b.role||"") || (a.trainer_name||"").localeCompare(b.trainer_name||""));
    el("players").textContent = pretty(arr);
  }, (err) => {
    el("players").textContent = "Erro: " + err.message;
  }));

  // public_state/state
  const stateDoc = doc(db, "rooms", rid, "public_state", "state");
  unsub.push(onSnapshot(stateDoc, (snap) => {
    el("state").textContent = pretty(snap.exists() ? snap.data() : null);
  }, (err) => {
    el("state").textContent = "Erro: " + err.message;
  }));

  // public_state/battle
  const battleDoc = doc(db, "rooms", rid, "public_state", "battle");
  unsub.push(onSnapshot(battleDoc, (snap) => {
    el("battle").textContent = pretty(snap.exists() ? snap.data() : null);
  }, (err) => {
    el("battle").textContent = "Erro: " + err.message;
  }));
});
