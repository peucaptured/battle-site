import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore, doc, collection, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const el = (id) => document.getElementById(id);
const statusEl = el("status");
const ridBadge = el("rid_badge");

let unsub = [];

/**
 * ✅ Firebase config fixo (integrado)
 * Obs: isso pode ficar público; a segurança vem das Firestore Rules.
 */
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyD2YZfQc-qeqMT3slk0ouvPC08d901te-Q",
  authDomain: "batalhas-de-gaal.firebaseapp.com",
  projectId: "batalhas-de-gaal",
  storageBucket: "batalhas-de-gaal.firebasestorage.app",
  messagingSenderId: "676094077702",
  appId: "1:676094077702:web:31095aa7dd2100b17d0c87",
  measurementId: "G-1Q0TB1YPFG",
};

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

  // ✅ Agora: usa config integrado por padrão
  // Se você quiser manter a opção de "colar JSON" no campo cfg, deixei como override:
  let cfg = DEFAULT_FIREBASE_CONFIG;

  const cfgEl = el("cfg");
  const raw = (cfgEl ? (cfgEl.value || "").trim() : "");
  if(raw){
    try {
      const parsed = JSON.parse(raw);
      if(parsed && parsed.projectId){
        cfg = parsed; // override manual
      } else {
        setStatus("err", "firebaseConfig inválido (sem projectId)");
        return;
      }
    } catch (e) {
      setStatus("err", "firebaseConfig inválido (JSON)");
      return;
    }
  }

  ridBadge.textContent = rid;

  const app = initializeApp(cfg);
  const db = getFirestore(app);

  setStatus("ok", "conectado");

  // ✅ Players (a partir do doc rooms/<rid>)
  const roomDoc = doc(db, "rooms", rid);
  unsub.push(onSnapshot(roomDoc, (snap) => {
    const data = snap.exists() ? snap.data() : null;
    if(!data){
      el("players").textContent = pretty([]);
      return;
    }
  
    const out = [];
  
    // owner: { name: "Delta" }
    if(data.owner && data.owner.name){
      out.push({ role: "owner", trainer_name: String(data.owner.name) });
    }
  
    // challengers: [ { name: "James HiBorn" }, { name: "Logan" } ]
    if(Array.isArray(data.challengers)){
      for(const ch of data.challengers){
        const nm = ch && (ch.name ?? ch.trainer_name);
        if(nm) out.push({ role: "challenger", trainer_name: String(nm) });
      }
    }
  
    // spectators: [ "Amber", ... ] (às vezes pode ser objeto também)
    if(Array.isArray(data.spectators)){
      for(const sp of data.spectators){
        const nm = (typeof sp === "string") ? sp : (sp && (sp.name ?? sp.trainer_name));
        if(nm) out.push({ role: "spectator", trainer_name: String(nm) });
      }
    }
  
    out.sort((a,b) =>
      (a.role||"").localeCompare(b.role||"") ||
      (a.trainer_name||"").localeCompare(b.trainer_name||"")
    );
  
    el("players").textContent = pretty(out);
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
