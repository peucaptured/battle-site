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

// ── DOM: Nova Rodada button ───────────────────────────────────────────────
let newRoundBtn = document.getElementById("preprep-nova-rodada-btn");
if (!newRoundBtn) {
  newRoundBtn = document.createElement("button");
  newRoundBtn.id = "preprep-nova-rodada-btn";
  newRoundBtn.className = "btn";
  newRoundBtn.title = "Confirmar início de nova rodada";
  newRoundBtn.textContent = "▶ Nova Rodada";
  newRoundBtn.style.display = "none";
  newRoundBtn.style.background = "linear-gradient(135deg,rgba(99,102,241,.85),rgba(56,189,248,.75))";
  newRoundBtn.style.animation = "ppRevealPulse 2s ease-in-out infinite";
  // Insert before pass_turn_btn
  const passBtn = document.getElementById("pass_turn_btn");
  if (passBtn) passBtn.parentNode.insertBefore(newRoundBtn, passBtn);
}

newRoundBtn.addEventListener("click", async () => {
  const ref = getBattleRef();
  if (!ref || !_db || !_rid) return;
  newRoundBtn.disabled = true;
  newRoundBtn.textContent = "⏳...";
  try {
    // Build a fresh turn order from current board (same as main.js does on roll)
    const pieces = window.appState?.pieces || [];
    const init = window.appState?.battle?.initiative || {};
    const activePieces = pieces.filter(p => safeStr(p?.status || "active") === "active");
    const order = activePieces.map(p => {
      const pieceId = safeStr(p?.id);
      const pieceKind = safeStr(p?.kind || "piece");
      const pid = safeStr(p?.pid);
      const owner = safeStr(p?.owner);
      const legacyKey = `piece:${pieceId}`;
      const keyedByKind = `${pieceKind}:${pieceId}`;
      const savedInit = init?.[keyedByKind] ?? init?.[legacyKey] ?? null;
      const initVal = Number(savedInit?.initiative);
      const display = safeStr(
        (window.dexMap && (window.dexMap[pid] || window.dexMap[String(Number(pid))])) ||
        p?.name || p?.display_name || pid || pieceId
      );
      return { pieceId, pieceKind, pid, owner, display, initiative: Number.isFinite(initVal) ? initVal : 0 };
    });
    order.sort((a, b) => {
      if (b.initiative !== a.initiative) return b.initiative - a.initiative;
      const ow = a.owner.localeCompare(b.owner);
      return ow !== 0 ? ow : a.display.localeCompare(b.display);
    });

    const currentRound = Number(window.appState?.battle?.turn_state?.round) || 1;
    // Start preprep asking phase directly (no dice roll needed)
    await setDoc(ref, {
      preprep: { phase: "asking", responses: {}, data: {} },
      turn_state: {
        phase: "preprep_asking",
        round: currentRound + 1,
        index: 0,
        order,
        updatedAt: Date.now(),
      },
    }, { merge: true });
  } catch (e) {
    console.error("[preprep] newRoundBtn error", e);
  }
  newRoundBtn.disabled = false;
  newRoundBtn.textContent = "▶ Nova Rodada";
});

// _lastTurnPhase tracks phase from latest Firestore snapshot (more reliable than appState)
let _lastTurnPhase = "";

function updateNewRoundBtn(turnPhaseOverride) {
  const phase = turnPhaseOverride !== undefined ? turnPhaseOverride : _lastTurnPhase;
  const role = safeStr(window.appState?.role);
  const isOwner = role === "owner" || role === "gm";
  const isAwaiting = phase === "awaiting_initiative";
  newRoundBtn.style.display = (isAwaiting && isOwner) ? "" : "none";
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

function getSpriteUrl(pid, opts) {
  // opts: { type: "battle"|"art", shiny: bool }
  if (typeof window.getSpriteUrlFromPid === "function") return window.getSpriteUrlFromPid(pid, opts);
  const k = safeStr(pid);
  if (!k) return "";
  const type = opts?.type || "art";
  const shiny = !!opts?.shiny;
  if (typeof window.localSpriteUrl === "function" && typeof window.spriteSlugFromPokemonName === "function") {
    const slug = window.spriteSlugFromPokemonName(k);
    if (slug) return window.localSpriteUrl(slug, type, shiny) || "";
  }
  if (isNaN(Number(k))) return "";
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
let _modalStep = null;    // "ask" | "waiting" | "select" | "text" | "reveal-pick"
let _selectedPieceIds = new Set();
let _prepTexts = new Map(); // pieceId → text (one per selected pokemon)

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

  if (step === "ask")          renderModalAsk();
  if (step === "waiting")      renderModalWaiting();
  if (step === "select")       renderModalSelect();
  if (step === "text")         renderModalText();
  if (step === "reveal-pick")  renderModalRevealPick();
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
    _prepTexts = new Map();
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
    const sprite = getSpriteUrl(p.pid, { type: "art" });
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

// Step — Digitar texto da preprep (um campo por pokémon selecionado)
function renderModalText() {
  if (!_modal) return;
  const myPieces = getMyPieces();
  const selected = myPieces.filter(p => _selectedPieceIds.has(p.id));

  const fields = selected.map(p => {
    const name = getDisplayName(p.pid);
    const sprite = getSpriteUrl(p.pid, { type: "art" });
    const saved = escHtml(_prepTexts.get(p.id) || "");
    return `
      <div class="pp-text-wrap" style="margin-bottom:4px;">
        <label style="display:flex;align-items:center;gap:6px;">
          ${sprite ? `<img src="${escHtml(sprite)}" style="width:20px;height:20px;image-rendering:pixelated;object-fit:contain;" onerror="this.style.display='none'"/>` : ""}
          ${escHtml(name)}
        </label>
        <textarea
          class="pp-text-field"
          data-piece-id="${escHtml(p.id)}"
          placeholder="Ex: Se o oponente atacar, uso Protect…"
        >${saved}</textarea>
      </div>
    `;
  }).join("");

  _modal.innerHTML = `
    <div class="pp-card">
      <h2>📋 Descrever Preprep</h2>
      <p class="pp-subtitle">Escreva a ação de cada pokémon. Cada uma fica secreta e pode ser revelada individualmente.</p>
      ${fields}
      <div class="pp-action-row">
        <button class="pp-btn-cancel" id="pp-text-back">Voltar</button>
        <button class="pp-btn-confirm" id="pp-text-confirm">✔ Confirmar preprep</button>
      </div>
    </div>
  `;

  _modal.querySelectorAll(".pp-text-field").forEach(ta => {
    ta.oninput = () => { _prepTexts.set(safeStr(ta.dataset.pieceId), ta.value); };
  });

  // Focus first textarea
  _modal.querySelector(".pp-text-field")?.focus();

  _modal.querySelector("#pp-text-back").onclick = () => openModal("select");
  _modal.querySelector("#pp-text-confirm").onclick = async () => {
    // Collect all values and validate
    let allFilled = true;
    _modal.querySelectorAll(".pp-text-field").forEach(ta => {
      const val = ta.value.trim();
      _prepTexts.set(safeStr(ta.dataset.pieceId), val);
      if (!val) { ta.style.borderColor = "rgba(239,68,68,.7)"; allFilled = false; }
    });
    if (!allFilled) return;
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
  const myPieces = getMyPieces();

  // Build one entry per selected pokemon
  const entries = myPieces
    .filter(p => _selectedPieceIds.has(p.id))
    .map(p => ({
      pieceId: p.id,
      pid:     p.pid,
      name:    getDisplayName(p.pid),
      text:    _prepTexts.get(p.id) || "",
      revealed: false,
    }));

  try {
    await setDoc(ref, {
      preprep: {
        responses: { [_by]: "yes" },
        data: {
          [_by]: { entries },
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

async function revealEntry(pieceId) {
  const ref = getBattleRef();
  if (!ref || !_by) return;
  const myData = _preprepData?.data?.[_by];
  if (!myData?.entries) return;

  // Mark the chosen entry as revealed
  const updatedEntries = myData.entries.map(e =>
    e.pieceId === pieceId
      ? { ...e, revealed: true, revealedAt: Date.now() }
      : e
  );

  try {
    await setDoc(ref, {
      preprep: { data: { [_by]: { entries: updatedEntries } } },
    }, { merge: true });
  } catch (e) {
    console.error("[preprep] revealEntry error", e);
  }
}

function revealMyPreprep() {
  const myData = _preprepData?.data?.[_by];
  const entries = myData?.entries || [];
  const unrevealed = entries.filter(e => !e.revealed);

  if (!unrevealed.length) return;

  // Only one left → reveal directly, no picker needed
  if (unrevealed.length === 1) {
    revealEntry(unrevealed[0].pieceId);
    return;
  }

  // Multiple → show picker modal
  openModal("reveal-pick");
}

function renderModalRevealPick() {
  if (!_modal) return;
  const myData = _preprepData?.data?.[_by];
  const unrevealed = (myData?.entries || []).filter(e => !e.revealed);

  const chips = unrevealed.map(e => {
    const sprite = getSpriteUrl(e.pid);
    return `<div class="pp-poke-chip" data-piece-id="${escHtml(e.pieceId)}" style="cursor:pointer;">
      ${sprite ? `<img src="${escHtml(sprite)}" onerror="this.style.display='none'" style="width:26px;height:26px;image-rendering:pixelated;"/>` : ""}
      ${escHtml(e.name || e.pid)}
    </div>`;
  }).join("");

  _modal.innerHTML = `
    <div class="pp-card">
      <h2>📋 Revelar Preprep</h2>
      <p class="pp-subtitle">Escolha qual pokémon terá sua preprep revelada agora.</p>
      <div class="pp-poke-grid">${chips}</div>
      <div class="pp-action-row">
        <button class="pp-btn-cancel" id="pp-rp-cancel">Cancelar</button>
      </div>
    </div>
  `;

  _modal.querySelectorAll(".pp-poke-chip").forEach(chip => {
    chip.onclick = async () => {
      const id = safeStr(chip.dataset.pieceId);
      closeModal();
      await revealEntry(id);
    };
  });
  _modal.querySelector("#pp-rp-cancel").onclick = () => closeModal();
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
    const allSubmitted = yesPlayers.every(p => {
      const entries = data[safeStr(p.trainer_name)]?.entries;
      return Array.isArray(entries) && entries.length > 0;
    });
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
  const entries = myData?.entries || [];
  if (!entries.length) {
    revealBtn.classList.remove("pp-reveal-active", "pp-reveal-done");
    revealBtn.style.display = "none";
    return;
  }
  const unrevealed = entries.filter(e => !e.revealed);
  if (!unrevealed.length) {
    // All revealed
    revealBtn.classList.remove("pp-reveal-active");
    revealBtn.classList.add("pp-reveal-done");
    revealBtn.style.display = "";
    revealBtn.textContent = "📋 Tudo revelado";
    revealBtn.disabled = true;
  } else {
    revealBtn.classList.add("pp-reveal-active");
    revealBtn.classList.remove("pp-reveal-done");
    revealBtn.style.display = "";
    const label = unrevealed.length === 1
      ? `📋 Revelar Preprep (${unrevealed[0].name || unrevealed[0].pid})`
      : `📋 Revelar Preprep (${unrevealed.length} restantes)`;
    revealBtn.textContent = label;
    revealBtn.disabled = false;
  }
}

revealBtn.addEventListener("click", () => revealMyPreprep());

// ── Toast for revealed prepreps ───────────────────────────────────────────
const _seenReveals = new Set();

function checkNewReveals(pp) {
  const data = pp?.data || {};
  for (const [trainer, trainerData] of Object.entries(data)) {
    const entries = trainerData?.entries || [];
    for (const entry of entries) {
      if (!entry?.revealed) continue;
      const key = `${trainer}:${entry.pieceId}:${entry.revealedAt || "x"}`;
      if (_seenReveals.has(key)) continue;
      _seenReveals.add(key);
      showRevealToast(trainer, entry.name || entry.pid, safeStr(entry.text));
    }
  }
}

function showRevealToast(trainer, pokeName, text) {
  const item = document.createElement("div");
  item.className = "pp-toast-item";
  item.innerHTML = `
    <div class="pp-toast-name">📋 Preprep de ${escHtml(trainer)} — ${escHtml(pokeName)}</div>
    <div class="pp-toast-text">${escHtml(text)}</div>
  `;
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

    // Build set of pieceIds that have preprep (via new entries[] structure)
    const prepPieceIds = new Set();
    for (const trainerData of Object.values(pp.data)) {
      for (const entry of (trainerData?.entries || [])) {
        prepPieceIds.add(safeStr(entry.pieceId));
      }
    }
    if (!prepPieceIds.size) return;

    // Map pieceId → pid so we can match scoreboard slots (title attr holds pid)
    const pieces = window.appState?.pieces || [];
    const prepPids = new Set();
    for (const p of pieces) {
      if (prepPieceIds.has(safeStr(p.id))) prepPids.add(safeStr(p.pid));
    }

    // Find scoreboard pokemon slots and toggle class
    const sb = document.getElementById("scoreboard");
    if (!sb) return;
    sb.querySelectorAll(".sb-poke").forEach(el => {
      const pidAttr = safeStr(el.title);
      if (prepPids.has(pidAttr)) el.classList.add("sb-poke-preprep");
      else el.classList.remove("sb-poke-preprep");
    });
  });
}

// ── Block attack for preprep pokémons ────────────────────────────────────
window.isPreprepPiece = function(pieceId) {
  const pp = _preprepData;
  if (!pp?.data) return false;
  for (const trainerData of Object.values(pp.data)) {
    for (const entry of (trainerData?.entries || [])) {
      if (entry.pieceId === safeStr(pieceId)) return true;
    }
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
  _lastTurnPhase = safeStr(turnState.phase);

  // Check newly revealed prepreps → toast
  checkNewReveals(pp);

  // Update reveal button
  updateRevealButton();

  // Update nova rodada button
  updateNewRoundBtn(_lastTurnPhase);

  // Patch scoreboard
  patchScoreboardPreprep();

  // --- Modal flow ---
  const ppPhase = safeStr(pp.phase);
  const turnPhase = safeStr(turnState.phase);

  // If preprep is done or turn is active → close any modal
  if (ppPhase === "done" || turnPhase === "active" || turnPhase === "preprep_asking") {
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

// ── Auto-init when appState connects ─────────────────────────────────────
let _watchInterval = setInterval(() => {
  const as = window.appState;
  if (!as?.connected || !as?.rid || !as?.by) return;
  const db = window.currentDb || window._combatDb;
  if (!db) return;

  clearInterval(_watchInterval);
  _watchInterval = null;

  initPreprep(db, as.rid, as.by);

  // Re-patch scoreboard after renders (monkey-patch main.js render)
  const origRender = window.render;
  if (typeof origRender === "function") {
    window.render = function(...args) {
      const r = origRender.apply(this, args);
      patchScoreboardPreprep();
      updateNewRoundBtn(_lastTurnPhase);
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
