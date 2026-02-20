// ═══════════════════════════════════════════════════════════════════════════
// preprep-patch.js  —  Sistema de Preprep de rodada
// Fluxo:
//   1. Após "Rolar iniciativa" (turn_state.phase = "preprep_ask") todos
//      os jogadores veem um modal perguntando se querem fazer preprep.
//   2. Quem diz "Sim" seleciona pokémons e digita o texto da preprep.
//   3. Quem diz "Não" marca pronto. Quando TODOS estão prontos (ou nenhum
//      quis preprep) a fase muda para "active".
//   4. Durante a rodada, pokémons com preprep mostram indicador VERMELHO no
//      scoreboard e não podem atacar.
//   5. Botão "Revelar Preprep" fica ao lado do dado e revela para todos.
//
// Firestore: rooms/{rid}/public_state/battle
//   preprep: {
//     phase: "asking" | "collecting" | "done",
//     responses: { [trainerName]: "yes" | "no" },
//     data: {
//       [trainerName]: {
//         text: string,                    // texto da preprep
//         pids: string[],                  // pieceIds que fizeram preprep
//         revealed: boolean,               // já foi revelada?
//         revealedAt?: number,
//       }
//     }
//   }
// ═══════════════════════════════════════════════════════════════════════════

import {
  doc, onSnapshot, setDoc, updateDoc, getDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// ── helpers ──────────────────────────────────────────────────────────────
const safeStr  = (v) => (v == null ? "" : String(v).trim());
const escHtml  = (s) => safeStr(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

// ── state ─────────────────────────────────────────────────────────────────
let _db  = null;
let _rid = null;
let _by  = null;
let _unsub = null;      // Firestore listener
let _preprepData = {};  // last known preprep field from Firestore

// ── CSS (injected once) ───────────────────────────────────────────────────
const STYLE_ID = "preprep-patch-style";
if (!document.getElementById(STYLE_ID)) {
  const st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent = `
/* ── Preprep modal overlay ─────────────────────────────────── */
#preprep-modal {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(2,6,23,.82);
  backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  animation: ppFadeIn .18s ease;
}
@keyframes ppFadeIn { from { opacity:0; transform:scale(.96) } to { opacity:1; transform:scale(1) } }

#preprep-modal .pp-card {
  background: linear-gradient(160deg, rgba(15,23,42,.98), rgba(2,6,23,.98));
  border: 1.5px solid rgba(148,163,184,.18);
  border-radius: 20px;
  padding: 28px 32px;
  width: min(480px, 94vw);
  box-shadow: 0 24px 80px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.04);
  display: flex; flex-direction: column; gap: 18px;
}
#preprep-modal h2 {
  margin: 0; font-size: 1.15rem; font-weight: 950;
  color: rgba(226,232,240,.95); letter-spacing: -.01em;
}
#preprep-modal .pp-subtitle {
  font-size: .82rem; color: rgba(148,163,184,.7); margin-top: -10px;
}

/* Ask step */
.pp-ask-row {
  display: flex; gap: 10px;
}
.pp-ask-row button {
  flex: 1; padding: 12px 0; border-radius: 12px; font-weight: 900;
  font-size: .95rem; border: none; cursor: pointer; transition: filter .15s;
}
.pp-ask-row button:hover { filter: brightness(1.15); }
.pp-btn-yes {
  background: linear-gradient(135deg, rgba(56,189,248,.2), rgba(99,102,241,.25));
  border: 1.5px solid rgba(99,102,241,.45) !important;
  color: rgba(199,210,254,.95);
}
.pp-btn-no {
  background: rgba(30,41,59,.6);
  border: 1.5px solid rgba(148,163,184,.2) !important;
  color: rgba(148,163,184,.75);
}

/* Waiting step */
.pp-waiting-list {
  list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px;
}
.pp-waiting-item {
  display: flex; align-items: center; gap: 10px;
  font-size: .85rem; color: rgba(226,232,240,.8);
}
.pp-waiting-dot {
  width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto;
}
.pp-waiting-dot.yes  { background: rgba(56,189,248,.9); box-shadow: 0 0 6px rgba(56,189,248,.5); }
.pp-waiting-dot.no   { background: rgba(74,222,128,.7); }
.pp-waiting-dot.wait { background: rgba(148,163,184,.4); animation: ppDotPulse 1.2s ease-in-out infinite; }
@keyframes ppDotPulse {
  0%,100% { opacity:.4; } 50% { opacity:1; }
}

/* Select pokemon step */
.pp-poke-grid {
  display: flex; flex-wrap: wrap; gap: 8px;
}
.pp-poke-chip {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 10px;
  background: rgba(30,41,59,.6);
  border: 1.5px solid rgba(148,163,184,.18);
  cursor: pointer; transition: all .14s;
  font-size: .82rem; font-weight: 800; color: rgba(226,232,240,.85);
  user-select: none;
}
.pp-poke-chip:hover { border-color: rgba(99,102,241,.5); background: rgba(99,102,241,.12); }
.pp-poke-chip.selected {
  border-color: rgba(99,102,241,.8);
  background: rgba(99,102,241,.2);
  color: rgba(199,210,254,.95);
  box-shadow: 0 0 10px rgba(99,102,241,.25);
}
.pp-poke-chip img {
  width: 26px; height: 26px; image-rendering: pixelated; object-fit: contain;
}

/* Text input step */
.pp-text-wrap {
  display: flex; flex-direction: column; gap: 8px;
}
.pp-text-wrap label {
  font-size: .78rem; font-weight: 800;
  color: rgba(148,163,184,.7); letter-spacing: .04em; text-transform: uppercase;
}
.pp-text-wrap textarea {
  background: rgba(15,23,42,.8);
  border: 1.5px solid rgba(148,163,184,.2);
  border-radius: 10px; color: rgba(226,232,240,.9);
  font-size: .88rem; padding: 10px 12px;
  resize: vertical; min-height: 80px; outline: none; font-family: inherit;
  transition: border-color .15s;
}
.pp-text-wrap textarea:focus { border-color: rgba(99,102,241,.6); }

/* Action row */
.pp-action-row {
  display: flex; gap: 10px; justify-content: flex-end;
}
.pp-action-row button {
  padding: 10px 22px; border-radius: 10px; font-weight: 900;
  font-size: .9rem; cursor: pointer; border: none; transition: filter .15s;
}
.pp-action-row button:hover { filter: brightness(1.12); }
.pp-btn-confirm {
  background: linear-gradient(135deg, rgba(99,102,241,.8), rgba(56,189,248,.7));
  color: #fff;
}
.pp-btn-cancel {
  background: rgba(30,41,59,.6);
  border: 1.5px solid rgba(148,163,184,.2) !important;
  color: rgba(148,163,184,.8);
}

/* ── Revelar Preprep button (hero header) ──────────────────── */
#preprep-reveal-btn {
  display: none;               /* shown when preprep data exists */
  position: relative;
}
#preprep-reveal-btn.pp-reveal-active {
  display: inline-flex;
  animation: ppRevealPulse 2s ease-in-out infinite;
}
@keyframes ppRevealPulse {
  0%,100% { box-shadow: 0 0 0 0 rgba(99,102,241,.0); }
  50%     { box-shadow: 0 0 0 5px rgba(99,102,241,.35); }
}
#preprep-reveal-btn.pp-reveal-done {
  display: inline-flex;
  opacity: .55;
  animation: none;
}

/* ── Scoreboard preprep indicator (red glow) ───────────────── */
.sb-poke.sb-poke-preprep .sb-poke-img {
  border-color: rgba(239,68,68,.9);
  box-shadow:
    0 0 0 2px rgba(239,68,68,.3),
    0 0 12px rgba(239,68,68,.8),
    0 0 22px rgba(239,68,68,.4);
  animation: sbPrePrepHalo 1.6s ease-in-out infinite;
}
@keyframes sbPrePrepHalo {
  0%,100% { filter: drop-shadow(0 0 0 rgba(239,68,68,.0)); transform: scale(1); }
  50%     { filter: drop-shadow(0 0 8px rgba(239,68,68,.9)); transform: scale(1.04); }
}
/* small red badge on top-right of the sprite */
.sb-poke.sb-poke-preprep::after {
  content: "📋";
  position: absolute;
  font-size: 9px;
  top: -2px; right: -2px;
  pointer-events: none;
}
.sb-poke { position: relative; }   /* ensure ::after positions correctly */

/* ── Revealed preprep toast ────────────────────────────────── */
#preprep-toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  z-index: 10000; pointer-events: none;
  display: flex; flex-direction: column; gap: 8px; align-items: center;
}
.pp-toast-item {
  background: linear-gradient(135deg, rgba(15,23,42,.97), rgba(30,41,59,.97));
  border: 1.5px solid rgba(99,102,241,.5);
  border-radius: 14px; padding: 14px 22px;
  color: rgba(226,232,240,.95); font-size: .88rem; font-weight: 700;
  max-width: 400px; text-align: center;
  box-shadow: 0 8px 40px rgba(0,0,0,.6);
  animation: ppToastIn .25s ease, ppToastOut .3s ease 5s forwards;
}
@keyframes ppToastIn  { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }
@keyframes ppToastOut { to   { opacity:0; transform:translateY(8px) } }
.pp-toast-name { font-size: .72rem; color: rgba(99,102,241,.9); font-weight: 900; margin-bottom: 4px; letter-spacing:.04em; text-transform:uppercase; }
.pp-toast-text { color: rgba(226,232,240,.9); }
  `;
  document.head.appendChild(st);
}

// ── DOM: Revelar Preprep button ───────────────────────────────────────────
let revealBtn = document.getElementById("preprep-reveal-btn");
if (!revealBtn) {
  revealBtn = document.createElement("button");
  revealBtn.id = "preprep-reveal-btn";
  revealBtn.className = "btn secondary";
  revealBtn.title = "Revelar sua preprep para todos";
  revealBtn.textContent = "📋 Revelar Preprep";
  // Insert before pass_turn_btn
  const passBtn = document.getElementById("pass_turn_btn");
  if (passBtn) passBtn.parentNode.insertBefore(revealBtn, passBtn);
}

// ── DOM: Toast container ──────────────────────────────────────────────────
let toastRoot = document.getElementById("preprep-toast");
if (!toastRoot) {
  toastRoot = document.createElement("div");
  toastRoot.id = "preprep-toast";
  document.body.appendChild(toastRoot);
}

// ── helpers ───────────────────────────────────────────────────────────────
function getBattleRef() {
  if (!_db || !_rid) return null;
  return doc(_db, "rooms", _rid, "public_state", "battle");
}

function getMyPieces() {
  const pieces = window.appState?.pieces || [];
  return pieces.filter(p => safeStr(p?.owner) === _by && safeStr(p?.status || "active") === "active");
}

function getSpriteUrl(pid) {
  if (typeof window.getSpriteUrlFromPid === "function") return window.getSpriteUrlFromPid(pid);
  const k = safeStr(pid);
  if (!k || isNaN(Number(k))) return "";
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${Number(k)}.png`;
}

function getDisplayName(pid) {
  const k = safeStr(pid);
  if (!k) return "???";
  try {
    if (window.dexMap) {
      const n = window.dexMap[k] || window.dexMap[String(Number(k))];
      if (n) return n;
    }
  } catch {}
  if (k.startsWith("EXT:")) return k.slice(4).trim() || "???";
  return k;
}

// ── modal logic ───────────────────────────────────────────────────────────
let _modal = null;
let _modalStep = null;    // "ask" | "waiting" | "select" | "text"
let _selectedPieceIds = new Set();
let _prepText = "";

function closeModal() {
  if (_modal) { _modal.remove(); _modal = null; }
  _modalStep = null;
}

function openModal(step) {
  closeModal();
  _modalStep = step;
  _modal = document.createElement("div");
  _modal.id = "preprep-modal";
  document.body.appendChild(_modal);

  if (step === "ask")      renderModalAsk();
  if (step === "waiting")  renderModalWaiting();
  if (step === "select")   renderModalSelect();
  if (step === "text")     renderModalText();
}

// Step 1 — Pergunta inicial
function renderModalAsk() {
  if (!_modal) return;
  const allPlayers = window.appState?.players || [];
  const numPlayers = allPlayers.length;
  _modal.innerHTML = `
    <div class="pp-card">
      <h2>🎯 Fase de Preprep</h2>
      <p class="pp-subtitle">Antes de iniciar a rodada, você deseja que algum pokémon faça uma ação preemptiva?</p>
      <div class="pp-ask-row">
        <button class="pp-btn-yes" id="pp-yes">✅ Sim, quero fazer preprep</button>
        <button class="pp-btn-no"  id="pp-no">❌ Não, pode começar</button>
      </div>
    </div>
  `;
  _modal.querySelector("#pp-yes").onclick = () => {
    _selectedPieceIds = new Set();
    openModal("select");
  };
  _modal.querySelector("#pp-no").onclick = () => answerPreprep("no");
}

// Step — Aguardando outros jogadores
function renderModalWaiting() {
  if (!_modal) return;
  const pp = _preprepData;
  const responses = pp?.responses || {};
  const allPlayers = window.appState?.players || [];

  let items = "";
  for (const player of allPlayers) {
    const tn = safeStr(player.trainer_name);
    const resp = responses[tn];
    const dotCls = resp === "yes" ? "yes" : resp === "no" ? "no" : "wait";
    const label  = resp === "yes" ? "quer fazer preprep" : resp === "no" ? "não quer preprep" : "aguardando…";
    items += `<li class="pp-waiting-item">
      <span class="pp-waiting-dot ${dotCls}"></span>
      <span><strong>${escHtml(tn)}</strong> — ${label}</span>
    </li>`;
  }

  _modal.innerHTML = `
    <div class="pp-card">
      <h2>⏳ Aguardando jogadores…</h2>
      <p class="pp-subtitle">Esperando todos responderem antes de iniciar a rodada.</p>
      <ul class="pp-waiting-list">${items}</ul>
    </div>
  `;
}

// Step — Selecionar pokémons para preprep
function renderModalSelect() {
  if (!_modal) return;
  const myPieces = getMyPieces();

  const chips = myPieces.map(p => {
    const name = getDisplayName(p.pid);
    const sprite = getSpriteUrl(p.pid);
    const sel = _selectedPieceIds.has(p.id);
    return `<div class="pp-poke-chip${sel ? " selected" : ""}" data-piece-id="${escHtml(p.id)}">
      ${sprite ? `<img src="${escHtml(sprite)}" alt="${escHtml(name)}" onerror="this.style.display='none'"/>` : ""}
      ${escHtml(name)}
    </div>`;
  }).join("");

  _modal.innerHTML = `
    <div class="pp-card">
      <h2>🎯 Selecionar Pokémons</h2>
      <p class="pp-subtitle">Quais pokémons vão fazer preprep? (eles não poderão atacar nesta rodada)</p>
      <div class="pp-poke-grid">${chips || '<span style="color:rgba(148,163,184,.6);font-size:.85rem">Nenhum pokémon no campo.</span>'}</div>
      <div class="pp-action-row">
        <button class="pp-btn-cancel" id="pp-sel-cancel">Voltar</button>
        <button class="pp-btn-confirm" id="pp-sel-next" ${myPieces.length === 0 ? "disabled" : ""}>Próximo →</button>
      </div>
    </div>
  `;

  _modal.querySelectorAll(".pp-poke-chip").forEach(chip => {
    chip.onclick = () => {
      const id = safeStr(chip.dataset.pieceId);
      if (_selectedPieceIds.has(id)) _selectedPieceIds.delete(id);
      else _selectedPieceIds.add(id);
      renderModalSelect();
    };
  });
  _modal.querySelector("#pp-sel-cancel").onclick = () => openModal("ask");
  _modal.querySelector("#pp-sel-next").onclick = () => {
    if (_selectedPieceIds.size === 0) return;
    openModal("text");
  };
}

// Step — Digitar texto da preprep
function renderModalText() {
  if (!_modal) return;
  _modal.innerHTML = `
    <div class="pp-card">
      <h2>📋 Descrever Preprep</h2>
      <p class="pp-subtitle">Escreva a ação preemptiva. Ela ficará secreta até você revelar.</p>
      <div class="pp-text-wrap">
        <label>Ação preprep</label>
        <textarea id="pp-text-input" placeholder="Ex: Se o oponente atacar, uso Protect…">${escHtml(_prepText)}</textarea>
      </div>
      <div class="pp-action-row">
        <button class="pp-btn-cancel" id="pp-text-back">Voltar</button>
        <button class="pp-btn-confirm" id="pp-text-confirm">✔ Confirmar preprep</button>
      </div>
    </div>
  `;
  const ta = _modal.querySelector("#pp-text-input");
  ta.oninput = () => { _prepText = ta.value; };
  ta.focus();

  _modal.querySelector("#pp-text-back").onclick = () => openModal("select");
  _modal.querySelector("#pp-text-confirm").onclick = async () => {
    _prepText = ta.value.trim();
    if (!_prepText) { ta.style.borderColor = "rgba(239,68,68,.7)"; return; }
    await submitPreprep();
  };
}

// ── Firestore writers ─────────────────────────────────────────────────────

async function answerPreprep(answer /* "yes" | "no" */) {
  const ref = getBattleRef();
  if (!ref || !_by) return;
  try {
    await setDoc(ref, {
      preprep: {
        responses: { [_by]: answer },
      },
    }, { merge: true });
  } catch (e) {
    console.error("[preprep] answerPreprep error", e);
  }
  // Show waiting modal; if no, we'll still wait for others
  openModal("waiting");
}

async function submitPreprep() {
  const ref = getBattleRef();
  if (!ref || !_by) return;
  const pids = [..._selectedPieceIds];
  try {
    await setDoc(ref, {
      preprep: {
        responses: { [_by]: "yes" },
        data: {
          [_by]: {
            text: _prepText,
            pids,
            revealed: false,
          },
        },
      },
    }, { merge: true });
  } catch (e) {
    console.error("[preprep] submitPreprep error", e);
    return;
  }
  openModal("waiting");
  updateRevealButton();
}

async function revealMyPreprep() {
  const ref = getBattleRef();
  if (!ref || !_by) return;
  const myData = _preprepData?.data?.[_by];
  if (!myData || myData.revealed) return;
  try {
    await setDoc(ref, {
      preprep: {
        data: {
          [_by]: { revealed: true, revealedAt: Date.now() },
        },
      },
    }, { merge: true });
  } catch (e) {
    console.error("[preprep] revealMyPreprep error", e);
  }
}

// Advance phase to "active" once all players responded
async function tryAdvanceToActive() {
  const ref = getBattleRef();
  if (!ref) return;
  const allPlayers = window.appState?.players || [];
  const responses = _preprepData?.responses || {};

  const allAnswered = allPlayers.every(p => {
    const tn = safeStr(p.trainer_name);
    return responses[tn] === "yes" || responses[tn] === "no";
  });

  if (!allAnswered) return;

  // All "no" or all collected their prepreps
  const anyYes = Object.values(responses).some(v => v === "yes");
  if (anyYes) {
    // Check if all who said yes already submitted their data
    const data = _preprepData?.data || {};
    const yesPlayers = allPlayers.filter(p => responses[safeStr(p.trainer_name)] === "yes");
    const allSubmitted = yesPlayers.every(p => data[safeStr(p.trainer_name)]?.text);
    if (!allSubmitted) return;
  }

  // Transition to "active"
  try {
    await setDoc(ref, {
      preprep: { phase: "done" },
      turn_state: { phase: "active" },
    }, { merge: true });
  } catch (e) {
    console.error("[preprep] tryAdvanceToActive error", e);
  }
}

// ── Reveal button ─────────────────────────────────────────────────────────
function updateRevealButton() {
  const myData = _preprepData?.data?.[_by];
  if (!myData) {
    revealBtn.classList.remove("pp-reveal-active", "pp-reveal-done");
    revealBtn.style.display = "none";
    return;
  }
  if (myData.revealed) {
    revealBtn.classList.remove("pp-reveal-active");
    revealBtn.classList.add("pp-reveal-done");
    revealBtn.style.display = "";
    revealBtn.textContent = "📋 Preprep revelada";
    revealBtn.disabled = true;
  } else {
    revealBtn.classList.add("pp-reveal-active");
    revealBtn.classList.remove("pp-reveal-done");
    revealBtn.style.display = "";
    revealBtn.textContent = "📋 Revelar Preprep";
    revealBtn.disabled = false;
  }
}

revealBtn.addEventListener("click", () => revealMyPreprep());

// ── Toast for revealed prepreps ───────────────────────────────────────────
const _seenReveals = new Set();

function checkNewReveals(pp) {
  const data = pp?.data || {};
  for (const [trainer, entry] of Object.entries(data)) {
    if (!entry?.revealed) continue;
    const key = `${trainer}:${entry.revealedAt || "x"}`;
    if (_seenReveals.has(key)) continue;
    _seenReveals.add(key);
    showRevealToast(trainer, safeStr(entry.text));
  }
}

function showRevealToast(trainer, text) {
  const item = document.createElement("div");
  item.className = "pp-toast-item";
  item.innerHTML = `<div class="pp-toast-name">📋 Preprep de ${escHtml(trainer)}</div>
                    <div class="pp-toast-text">${escHtml(text)}</div>`;
  toastRoot.appendChild(item);
  setTimeout(() => item.remove(), 6000);
}

// ── Scoreboard integration ────────────────────────────────────────────────
// We patch the scoreboard render to add .sb-poke-preprep class
// by monkey-patching after each render.
let _sbPatchScheduled = false;
function patchScoreboardPreprep() {
  if (_sbPatchScheduled) return;
  _sbPatchScheduled = true;
  requestAnimationFrame(() => {
    _sbPatchScheduled = false;
    const pp = _preprepData;
    if (!pp?.data) return;

    // Build set of pieceIds that have preprep
    const prepPieceIds = new Set();
    for (const entry of Object.values(pp.data)) {
      if (!entry?.pids) continue;
      for (const id of entry.pids) prepPieceIds.add(safeStr(id));
    }
    if (!prepPieceIds.size) return;

    // Map pieceId → pid so we can match scoreboard slots
    const pieces = window.appState?.pieces || [];
    const prepPids = new Set();
    for (const p of pieces) {
      if (prepPieceIds.has(safeStr(p.id))) prepPids.add(safeStr(p.pid));
    }

    // Find scoreboard pokemon slots and add class
    const sb = document.getElementById("scoreboard");
    if (!sb) return;
    sb.querySelectorAll(".sb-poke").forEach(el => {
      const pidAttr = safeStr(el.title);  // title attr holds pid
      if (prepPids.has(pidAttr)) {
        el.classList.add("sb-poke-preprep");
      } else {
        el.classList.remove("sb-poke-preprep");
      }
    });
  });
}

// ── Block attack for preprep pokémons ────────────────────────────────────
// Expose a helper other systems can call
window.isPreprepPiece = function(pieceId) {
  const pp = _preprepData;
  if (!pp?.data) return false;
  for (const entry of Object.values(pp.data)) {
    if (entry?.pids?.includes(safeStr(pieceId))) return true;
  }
  return false;
};

// ── Main Firestore listener ───────────────────────────────────────────────
function onBattleSnapshot(snap) {
  if (!snap.exists()) return;
  const data = snap.data() || {};
  const pp = data.preprep || {};
  const turnState = data.turn_state || {};
  const prevPp = _preprepData;
  _preprepData = pp;

  // Check newly revealed prepreps → toast
  checkNewReveals(pp);

  // Update reveal button
  updateRevealButton();

  // Patch scoreboard
  patchScoreboardPreprep();

  // --- Modal flow ---
  const ppPhase = safeStr(pp.phase);
  const turnPhase = safeStr(turnState.phase);

  // If preprep is done or turn is active → close any modal
  if (ppPhase === "done" || turnPhase === "active") {
    closeModal();
    return;
  }

  // If preprep phase is "asking" (set by roll initiative)
  if (ppPhase === "asking") {
    const responses = pp.responses || {};
    const myResp = responses[_by];

    // I haven't answered yet → show Ask modal
    if (!myResp) {
      if (_modalStep !== "ask") openModal("ask");
      return;
    }

    // I answered yes but haven't submitted data yet → stay on text/select
    if (myResp === "yes") {
      const myData = pp.data?.[_by];
      if (!myData?.text) {
        // Stay in selection/text flow; don't interrupt
        if (_modalStep === "waiting") openModal("select");
        return;
      }
    }

    // I answered; show waiting for others
    if (_modalStep !== "waiting") openModal("waiting");
    else renderModalWaiting(); // refresh the list

    // Try advancing
    tryAdvanceToActive();
  }
}

// ── init ──────────────────────────────────────────────────────────────────
function initPreprep(db, rid, by) {
  _db  = db;
  _rid = rid;
  _by  = safeStr(by);

  if (_unsub) { try { _unsub(); } catch {} }

  const ref = getBattleRef();
  if (!ref) return;

  _unsub = onSnapshot(ref, onBattleSnapshot, (err) => {
    console.error("[preprep] snapshot error", err);
  });
}

// ── Hook into roll initiative to start preprep phase ─────────────────────
// We wrap the existing topRollBtn click by observing turn_state changes.
// When turn_state.phase becomes "awaiting_initiative" → next roll starts preprep.
// We intercept the Firestore write by patching appState changes via a MutationObserver
// on the battle state, but the cleanest way is to hook after the round starts.
//
// Strategy: patch the existing topRollBtn to also write preprep.phase="asking"

let _patchedRollBtn = false;
function patchRollButton() {
  if (_patchedRollBtn) return;
  const btn = document.getElementById("top_roll_btn");
  if (!btn) return;
  _patchedRollBtn = true;

  btn.addEventListener("click", async () => {
    // Only inject preprep when a new round is actually being started
    // We check after a small delay so main.js writes turn_state first
    setTimeout(async () => {
      const ref = getBattleRef();
      if (!ref) return;
      try {
        const snap = await getDoc(ref);
        const battle = snap.exists() ? snap.data() : {};
        const turn = battle.turn_state || {};
        // If a new round just started (phase === "active" already set by main.js)
        // We override to preprep asking
        if (safeStr(turn.phase) === "active") {
          await setDoc(ref, {
            preprep: {
              phase: "asking",
              responses: {},
              data: {},
            },
            turn_state: { phase: "preprep_asking" },
          }, { merge: true });
        }
      } catch (e) {
        console.error("[preprep] patchRollButton error", e);
      }
    }, 600);
  }, { capture: false });
}

// ── Auto-init when appState connects ─────────────────────────────────────
let _watchInterval = setInterval(() => {
  const as = window.appState;
  if (!as?.connected || !as?.rid || !as?.by) return;
  const db = window.currentDb || window._combatDb;
  if (!db) return;

  clearInterval(_watchInterval);
  _watchInterval = null;

  initPreprep(db, as.rid, as.by);
  patchRollButton();

  // Re-patch scoreboard after renders (monkey-patch main.js render)
  const origRender = window.render;
  if (typeof origRender === "function") {
    window.render = function(...args) {
      const r = origRender.apply(this, args);
      patchScoreboardPreprep();
      return r;
    };
  }

  // MutationObserver on #scoreboard so even scoreboard-patch internal renders trigger patch
  const sbRoot = document.getElementById("scoreboard");
  if (sbRoot) {
    const mo = new MutationObserver(() => patchScoreboardPreprep());
    mo.observe(sbRoot, { childList: true, subtree: true });
  }
}, 500);

// Also handle preprep_asking as a valid turn phase so main.js doesn't error
// We patch canCurrentPlayerPassTurn to allow pass when preprep is done
const _origCanPass = window.canCurrentPlayerPassTurn;
if (typeof _origCanPass === "function") {
  window.canCurrentPlayerPassTurn = function() {
    const pp = _preprepData;
    if (pp?.phase === "asking") return false;  // block during preprep
    return _origCanPass.call(this);
  };
}

// Export for debugging
window._preprepPatch = { initPreprep, revealMyPreprep, getPreprepData: () => _preprepData };
