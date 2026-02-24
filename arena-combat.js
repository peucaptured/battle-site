/**
 * arena-combat.js — Combat overlay system on the Arena
 *
 * Click enemy token on map → attack overlay at cursor → radial menu /
 * compact move list → auto-roll → floating feedback on map → pending
 * prompt for defender → reroll toast → stage chips.
 *
 * Agora com cálculos completos unificados com o combat.js:
 * STAB, Fraqueza/Vantagem de Tipo, Bônus de Acerto e Efeito Secundário.
 */

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit as fbLimit,
  onSnapshot,
  arrayUnion,
  serverTimestamp,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

import { getMoveType, getTypeDamageBonus, normalizeType } from "./type-data.js";

// ─── helpers ──────────────────────────────────────────────────────
function safeStr(x) { return (x == null ? "" : String(x)).trim(); }
function safeInt(x, fb = 0) { const n = parseInt(x, 10); return Number.isFinite(n) ? n : fb; }
function getMoveData(mv) {
  return {
    // Garante que pega o Rank base do golpe
    rank: safeInt(mv?.rank ?? mv?.damage ?? mv?.power ?? mv?.lvl ?? 0),
    // Pega o modificador de acerto específico DO GOLPE
    acc: safeInt(mv?.accuracy ?? mv?.acc ?? mv?.acerto ?? mv?.modificador ?? 0),
    // Pega possíveis bônus extras de dano salvos direto no golpe
    modDano: safeInt(mv?.damage_mod ?? mv?.mod_dano ?? mv?.mod ?? 0)
  };
}
function safeDocId(name) {
  const s = safeStr(name) || "user";
  return s.replace(/[^a-zA-Z0-9_\-\.]/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "user";
}
function d20Roll() { return Math.floor(Math.random() * 20) + 1; }
function escHtml(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function uid() { return `ac_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`; }

function normalizeStatKey(key) {
  const k = safeStr(key).toLowerCase();
  if (k === "fortitude") return "fort";
  if (k === "toughness") return "thg";
  if (k === "intel" || k === "intelligence") return "int";
  return k;
}

function normalizeStats(stats) {
  const raw = stats || {};
  const norm = {
    stgr: safeInt(raw.stgr),
    int:  safeInt(raw.int ?? raw.intel ?? raw.intelligence),
    dodge: safeInt(raw.dodge),
    parry: safeInt(raw.parry),
    fort:  safeInt(raw.fort ?? raw.fortitude),
    will:  safeInt(raw.will),
    thg:   safeInt(raw.thg ?? raw.toughness),
    cap:   safeInt(raw.cap ?? raw.capability),
  };
  if (norm.thg <= 0 && norm.cap > 0) norm.thg = Math.round(norm.cap / 2);
  if (norm.dodge <= 0 && norm.cap > 0 && norm.thg > 0) norm.dodge = Math.max(0, norm.cap - norm.thg);
  norm.fortitude = norm.fort;
  norm.toughness = norm.thg;
  return { ...raw, ...norm };
}

function moveBasedStat(meta) {
  meta = meta || {};
  const cat = safeStr(meta.category).toLowerCase();
  if (meta.is_special === true) return "Int";
  if (meta.is_special === false) return "Stgr";
  if (cat.includes("status")) return "—";
  if (cat.includes("especial") || cat.includes("special")) return "Int";
  if (cat.includes("físico") || cat.includes("fisico") || cat.includes("physical")) return "Stgr";
  return "Stgr";
}

function moveStatValue(meta, stats) {
  const based = moveBasedStat(meta);
  stats = stats || {};
  if (based === "Int") return [based, safeInt(stats["int"])];
  if (based === "Stgr") return [based, safeInt(stats.stgr)];
  return [based, 0];
}

function spriteUrl(pid, opts) {
  try {
    if (typeof window.getSpriteUrlFromPid === "function") {
      return safeStr(window.getSpriteUrlFromPid(pid, opts));
    }
  } catch {}
  const k = safeStr(pid);
  if (!k) return "";
  const type = opts?.type || "art";
  const shiny = !!opts?.shiny;
  if (typeof window.localSpriteUrl === "function" && typeof window.spriteSlugFromPokemonName === "function") {
    const slug = window.spriteSlugFromPokemonName(k);
    if (slug) return window.localSpriteUrl(slug, type, shiny) || "";
  }
  if (/^\d+$/.test(k)) return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${Number(k)}.png`;
  return "";
}

function displayName(pid) {
  const k = safeStr(pid);
  if (!k) return "???";
  if (k.startsWith("EXT:")) return k.slice(4).trim() || "???";
  try {
    if (window.dexMap) {
      const name = window.dexMap[k] || window.dexMap[String(Number(k))];
      if (safeStr(name)) return safeStr(name);
    }
  } catch {}
  return "???";
}

// ─── CSS injection ────────────────────────────────────────────────
let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const s = document.createElement("style");
  s.id = "arena-combat-css";
  s.textContent = CSS_TEXT;
  document.head.appendChild(s);
}

const CSS_TEXT = `
/* ═══════════════════════════════════════════════════════════
   ARENA COMBAT — Overlay, Radial Menu, Floating Feedback
   ═══════════════════════════════════════════════════════════ */

#arena-combat-overlay {
  position: absolute; inset: 0;
  pointer-events: none;
  z-index: 50;
  overflow: hidden;
}

/* ── Attack overlay panel ── */
.ac-overlay {
  position: absolute;
  pointer-events: auto;
  z-index: 60;
  min-width: 260px;
  max-width: 340px;
  border-radius: 16px;
  border: 1px solid rgba(56,189,248,.4);
  background: rgba(10,18,32,.92);
  backdrop-filter: blur(12px);
  box-shadow: 0 16px 40px rgba(2,6,23,.5), 0 0 0 1px rgba(56,189,248,.15);
  padding: 14px;
  animation: acFadeIn .2s ease-out;
}
@keyframes acFadeIn {
  from { opacity:0; transform:scale(.92) translateY(6px); }
  to { opacity:1; transform:scale(1) translateY(0); }
}
.ac-overlay-header {
  display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
}
.ac-overlay-sprite {
  width: 48px; height: 48px; border-radius: 12px;
  border: 1px solid rgba(226,232,240,.15);
  background: rgba(255,255,255,.04);
  object-fit: contain; image-rendering: pixelated; padding: 3px;
}
.ac-overlay-name {
  font-weight: 900; font-size: 14px; color: rgba(226,232,240,.95);
}
.ac-overlay-sub {
  font-size: 11px; color: rgba(148,163,184,.7); margin-top: 2px;
}
.ac-overlay-close {
  margin-left: auto; appearance: none; border: none;
  background: rgba(248,113,113,.12); color: rgba(248,113,113,.85);
  border-radius: 8px; width: 28px; height: 28px;
  font-size: 14px; font-weight: 900; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.ac-overlay-close:hover { background: rgba(248,113,113,.25); }

/* ── Quick actions ── */
.ac-quick-actions {
  display: flex; gap: 6px; margin-bottom: 10px;
}
.ac-quick-btn {
  flex: 1; appearance: none; cursor: pointer;
  padding: 8px 6px; border-radius: 10px;
  border: 1px solid rgba(148,163,184,.22);
  background: rgba(2,6,23,.3); color: rgba(226,232,240,.85);
  font-size: 11.5px; font-weight: 800; text-align: center;
  transition: all .15s;
}
.ac-quick-btn:hover {
  background: rgba(56,189,248,.14); border-color: rgba(56,189,248,.4);
  transform: translateY(-1px);
}
.ac-quick-btn.ac-active {
  background: rgba(56,189,248,.2); border-color: rgba(56,189,248,.55);
  color: rgba(56,189,248,1);
}

/* ── Radial menu ── */
.ac-radial {
  position: absolute;
  pointer-events: auto;
  z-index: 65;
  width: 0; height: 0;
  animation: acFadeIn .2s ease-out;
}
.ac-radial-slot {
  position: absolute;
  width: 72px; height: 72px;
  border-radius: 50%;
  border: 1.5px solid rgba(56,189,248,.35);
  background: rgba(10,18,32,.9);
  backdrop-filter: blur(8px);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  cursor: pointer;
  transition: all .15s;
  transform: translate(-50%, -50%);
  pointer-events: auto;
  box-shadow: 0 4px 16px rgba(2,6,23,.4);
}
.ac-radial-slot:hover {
  border-color: rgba(56,189,248,.7);
  background: rgba(56,189,248,.15);
  transform: translate(-50%, -50%) scale(1.1);
  box-shadow: 0 8px 24px rgba(2,6,23,.5);
}
.ac-radial-slot.ac-disabled {
  opacity: .35; cursor: default;
  pointer-events: none;
}
.ac-radial-slot .ac-slot-name {
  font-size: 9px; font-weight: 800; color: rgba(226,232,240,.9);
  text-align: center; line-height: 1.15;
  max-width: 60px; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap;
}
.ac-radial-slot .ac-slot-icon {
  font-size: 16px; margin-bottom: 2px;
}
.ac-radial-slot .ac-slot-sub {
  font-size: 8px; color: rgba(148,163,184,.7); margin-top: 1px;
}
.ac-radial-center {
  position: absolute;
  width: 52px; height: 52px;
  border-radius: 50%;
  border: 2px solid rgba(248,113,113,.4);
  background: rgba(248,113,113,.12);
  display: flex; align-items: center; justify-content: center;
  transform: translate(-50%, -50%);
  pointer-events: auto; cursor: pointer;
}
.ac-radial-center:hover { background: rgba(248,113,113,.25); }
.ac-radial-center img {
  width: 36px; height: 36px; object-fit: contain;
  image-rendering: pixelated; border-radius: 8px;
}

/* ── Compact move list ── */
.ac-movelist {
  max-height: 260px; overflow-y: auto;
  margin-top: 6px;
}
.ac-movelist::-webkit-scrollbar { width: 4px; }
.ac-movelist::-webkit-scrollbar-thumb { background: rgba(148,163,184,.2); border-radius: 4px; }
.ac-search {
  width: 100%; padding: 7px 10px; border-radius: 10px;
  border: 1px solid rgba(148,163,184,.22);
  background: rgba(0,0,0,.25); color: rgba(226,232,240,.9);
  font-size: 12px; outline: none; margin-bottom: 6px;
}
.ac-search:focus { border-color: rgba(56,189,248,.45); }
.ac-move-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 10px;
  border: 1px solid rgba(148,163,184,.12);
  background: rgba(2,6,23,.2);
  margin-bottom: 4px; cursor: pointer;
  transition: all .12s;
}
.ac-move-item:hover {
  background: rgba(56,189,248,.1); border-color: rgba(56,189,248,.3);
  transform: translateX(2px);
}
.ac-move-name { font-weight: 800; font-size: 12px; color: rgba(226,232,240,.9); flex: 1; }
.ac-move-meta { font-size: 10px; color: rgba(148,163,184,.7); }
.ac-move-dmg {
  font-size: 11px; font-weight: 800; color: rgba(56,189,248,.85);
  padding: 2px 6px; border-radius: 6px;
  background: rgba(56,189,248,.1); border: 1px solid rgba(56,189,248,.2);
}
.ac-move-dmg.bonus-high {
  background: rgba(34,197,94,.15); border-color: rgba(34,197,94,.4); color: rgba(34,197,94,.95);
}

/* ── Range selector (in overlay) ── */
.ac-range-row {
  display: flex; gap: 6px; margin-bottom: 8px;
  flex-wrap: wrap;
}
.ac-range-btn {
  flex: 1 1 30%; appearance: none; cursor: pointer;
  padding: 6px; border-radius: 8px;
  border: 1px solid rgba(148,163,184,.22);
  background: rgba(2,6,23,.2); color: rgba(226,232,240,.75);
  font-size: 11px; font-weight: 700; text-align: center;
  transition: all .12s;
}
.ac-range-btn:hover { border-color: rgba(56,189,248,.3); }
.ac-range-btn.ac-active {
  background: rgba(56,189,248,.15); border-color: rgba(56,189,248,.45);
  color: rgba(56,189,248,.95);
}

/* ── Floating feedback ── */
.ac-float {
  position: absolute;
  pointer-events: none;
  z-index: 55;
  transform: translate(-50%, -100%);
  padding: 8px 14px;
  border-radius: 12px;
  font-weight: 800; font-size: 13px;
  white-space: nowrap;
  animation: acFloatUp 4s ease-out forwards;
  box-shadow: 0 6px 24px rgba(2,6,23,.45);
}
@keyframes acFloatUp {
  0% { opacity: 0; transform: translate(-50%, -80%); }
  8% { opacity: 1; transform: translate(-50%, -110%); }
  75% { opacity: 1; transform: translate(-50%, -130%); }
  100% { opacity: 0; transform: translate(-50%, -160%); }
}
.ac-float-hit {
  background: rgba(34,197,94,.18); border: 1px solid rgba(34,197,94,.45);
  color: rgba(34,197,94,.95);
}
.ac-float-miss {
  background: rgba(248,113,113,.18); border: 1px solid rgba(248,113,113,.45);
  color: rgba(248,113,113,.95);
}
.ac-float-crit {
  background: rgba(251,191,36,.18); border: 1px solid rgba(251,191,36,.45);
  color: rgba(251,191,36,.95);
}
.ac-float-resist {
  background: rgba(168,85,247,.18); border: 1px solid rgba(168,85,247,.45);
  color: rgba(168,85,247,.95);
}
.ac-float-stage {
  background: rgba(56,189,248,.15); border: 1px solid rgba(56,189,248,.35);
  color: rgba(56,189,248,.9);
  font-size: 12px; padding: 5px 10px;
  animation: acFloatUp 5s ease-out forwards;
}
.ac-float-pending {
  background: rgba(251,191,36,.12); border: 1px solid rgba(251,191,36,.35);
  color: rgba(251,191,36,.9);
  animation: acPulse 2s ease-in-out infinite;
  pointer-events: auto; cursor: default;
}
@keyframes acPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(251,191,36,.25); }
  50% { box-shadow: 0 0 0 8px rgba(251,191,36,0); }
}

/* ── Pending prompt (defender / attacker small panel) ── */
.ac-prompt {
  position: absolute;
  pointer-events: auto;
  z-index: 62;
  min-width: 220px; max-width: 300px;
  border-radius: 14px;
  border: 1.5px solid rgba(168,85,247,.4);
  background: rgba(10,18,32,.92);
  backdrop-filter: blur(12px);
  padding: 12px;
  animation: acFadeIn .25s ease-out;
  box-shadow: 0 12px 32px rgba(2,6,23,.5);
}
.ac-prompt-title {
  font-weight: 900; font-size: 13px; margin-bottom: 8px;
  color: rgba(226,232,240,.95);
}
.ac-prompt-dc {
  padding: 8px 10px; border-radius: 10px;
  background: rgba(56,189,248,.1); border: 1px solid rgba(56,189,248,.25);
  font-weight: 800; font-size: 13px; margin-bottom: 10px;
  color: rgba(56,189,248,.9);
}
.ac-prompt-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
}
.ac-prompt-btn {
  appearance: none; cursor: pointer;
  padding: 10px 8px; border-radius: 10px;
  border: 1px solid rgba(148,163,184,.22);
  background: rgba(2,6,23,.3); color: rgba(226,232,240,.85);
  font-size: 12px; font-weight: 800; text-align: center;
  transition: all .15s;
}
.ac-prompt-btn:hover {
  background: rgba(168,85,247,.15); border-color: rgba(168,85,247,.45);
  transform: translateY(-1px);
}
.ac-prompt-btn:disabled { opacity:.35; cursor: default; transform: none; }
.ac-prompt-btn.ac-wide { grid-column: span 2; }
.ac-prompt-btn.ac-special { background: rgba(251,191,36,.15); border-color: rgba(251,191,36,.4); color: rgba(251,191,36,.95); }
.ac-prompt-btn.ac-special:hover { background: rgba(251,191,36,.25); }

/* ── Reroll toast ── */
.ac-reroll-toast {
  position: absolute;
  bottom: 16px; left: 50%;
  transform: translateX(-50%);
  pointer-events: auto;
  z-index: 70;
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px;
  border-radius: 14px;
  border: 1px solid rgba(251,191,36,.4);
  background: rgba(10,18,32,.92);
  backdrop-filter: blur(12px);
  box-shadow: 0 12px 32px rgba(2,6,23,.5);
  animation: acSlideUp .25s ease-out;
  white-space: nowrap;
}
@keyframes acSlideUp {
  from { opacity:0; transform: translateX(-50%) translateY(20px); }
  to { opacity:1; transform: translateX(-50%) translateY(0); }
}
.ac-reroll-text {
  font-weight: 800; font-size: 13px; color: rgba(251,191,36,.9);
}
.ac-reroll-btn {
  appearance: none; cursor: pointer;
  padding: 7px 14px; border-radius: 10px;
  border: 1px solid rgba(148,163,184,.22);
  background: rgba(2,6,23,.3); color: rgba(226,232,240,.85);
  font-weight: 800; font-size: 12px;
  transition: all .15s;
}
.ac-reroll-btn:hover {
  background: rgba(251,191,36,.15); border-color: rgba(251,191,36,.45);
  transform: translateY(-1px);
}
.ac-reroll-btn.ac-primary {
  background: rgba(251,191,36,.2); border-color: rgba(251,191,36,.45);
  color: rgba(251,191,36,.95);
}
.ac-reroll-timer {
  width: 60px; height: 4px; border-radius: 2px;
  background: rgba(148,163,184,.2); overflow: hidden;
}
.ac-reroll-timer-bar {
  height: 100%; background: rgba(251,191,36,.7);
  border-radius: 2px;
  transition: width .1s linear;
}

/* ── Context menu ── */
.ac-context {
  position: absolute;
  pointer-events: auto;
  z-index: 75;
  min-width: 180px;
  border-radius: 12px;
  border: 1px solid rgba(148,163,184,.28);
  background: rgba(10,18,32,.94);
  backdrop-filter: blur(12px);
  box-shadow: 0 12px 32px rgba(2,6,23,.5);
  padding: 4px;
  animation: acFadeIn .15s ease-out;
}
.ac-ctx-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 8px;
  cursor: pointer; transition: background .1s;
  font-size: 12px; font-weight: 700;
  color: rgba(226,232,240,.85);
}
.ac-ctx-item:hover { background: rgba(56,189,248,.1); }
.ac-ctx-item .ac-ctx-icon { font-size: 14px; width: 20px; text-align: center; }
.ac-ctx-item .ac-ctx-kbd {
  margin-left: auto; font-size: 10px; color: rgba(148,163,184,.5);
  font-family: monospace;
}
.ac-ctx-sep {
  height: 1px; background: rgba(148,163,184,.15); margin: 4px 8px;
}

/* ── Mini turn timeline ── */
.ac-timeline {
  position: absolute;
  top: 6px; left: 50%; transform: translateX(-50%);
  pointer-events: none; z-index: 45;
  display: flex; align-items: center; gap: 4px;
  padding: 4px 10px;
  border-radius: 10px;
  background: rgba(2,6,23,.7);
  border: 1px solid rgba(148,163,184,.15);
  backdrop-filter: blur(6px);
}
.ac-tl-step {
  display: flex; align-items: center; gap: 4px;
  font-size: 10px; font-weight: 700;
  color: rgba(148,163,184,.6);
}
.ac-tl-step.ac-tl-done { color: rgba(34,197,94,.8); }
.ac-tl-step.ac-tl-active { color: rgba(251,191,36,.9); }
.ac-tl-arrow { font-size: 8px; color: rgba(148,163,184,.3); }

/* ── Repeat last move button ── */
.ac-repeat-btn {
  position: absolute;
  bottom: 16px; right: 16px;
  pointer-events: auto; z-index: 45;
  appearance: none; cursor: pointer;
  padding: 8px 14px; border-radius: 12px;
  border: 1px solid rgba(56,189,248,.3);
  background: rgba(10,18,32,.85);
  backdrop-filter: blur(8px);
  color: rgba(56,189,248,.9);
  font-weight: 800; font-size: 12px;
  box-shadow: 0 6px 18px rgba(2,6,23,.35);
  transition: all .15s;
  display: none;
}
.ac-repeat-btn:hover {
  background: rgba(56,189,248,.15);
  border-color: rgba(56,189,248,.55);
  transform: translateY(-2px);
}


/* ── Sidebar ficha preview (Arena context menu) ── */
#arena_sheet_preview {
  margin: 10px 0 12px;
}
.arena-sheet-card {
  border-radius: 12px;
  border: 1px solid rgba(120,210,255,.2);
  background: linear-gradient(160deg, rgba(30,46,86,.92), rgba(20,35,70,.86));
  padding: 10px;
  color: #e8f6ff;
  box-shadow: 0 8px 20px rgba(2,6,23,.25);
}
.arena-sheet-card .sheet-name { font-weight: 900; font-size: 14px; line-height: 1.1; }
.arena-sheet-card .sheet-sub { font-size: 11px; opacity: .82; margin-top: 2px; }
.arena-sheet-card .sheet-top { display: flex; gap: 10px; align-items: flex-start; }
.arena-sheet-card .sheet-art { width: 76px; height: 76px; object-fit: contain; border-radius: 10px; background: rgba(0,0,0,.22); border: 1px solid rgba(255,255,255,.14); padding: 4px; }
.arena-sheet-card .chip-row { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
.arena-sheet-card .chip { font-size: 10px; font-weight: 800; border: 1px solid rgba(255,255,255,.2); border-radius: 999px; padding: 2px 7px; background: rgba(0,0,0,.2); }
.arena-sheet-card .hp-row { display:flex; justify-content:space-between; font-size: 11px; font-weight: 800; margin: 8px 0 4px; }
.arena-sheet-card .hp-track { height: 6px; border-radius: 999px; background: rgba(2,6,23,.55); overflow: hidden; }
.arena-sheet-card .hp-fill { height: 100%; border-radius: inherit; }
.arena-sheet-card .stat-grid { display:grid; grid-template-columns: repeat(4,1fr); gap: 4px; margin: 8px 0; }
.arena-sheet-card .stat-box { border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.05); padding: 4px 2px; text-align:center; }
.arena-sheet-card .stat-label { font-size: 9px; opacity: .75; text-transform: uppercase; font-weight: 800; }
.arena-sheet-card .stat-val { font-size: 14px; font-weight: 900; line-height: 1; }
.arena-sheet-card .section-title { font-size: 11px; font-weight: 900; margin: 8px 0 4px; }
.arena-sheet-card .move-row { border: 1px solid rgba(255,255,255,.14); border-radius: 9px; padding: 6px; margin-bottom: 5px; background: rgba(0,0,0,.14); }
.arena-sheet-card .move-head { display:flex; align-items:center; gap:4px; }
.arena-sheet-card .move-name { font-size: 11px; font-weight: 900; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.arena-sheet-card .mv-pill { font-size: 9px; border-radius: 999px; border: 1px solid rgba(255,255,255,.18); padding: 1px 4px; }
.arena-sheet-card .muted { opacity: .75; font-size: 10px; }
`;

// localStorage keys
const FAV_KEY_PREFIX = "pvp_fav_moves_";
const LAST_MOVE_KEY = "pvp_last_move";

// ═══════════════════════════════════════════════════════════════════
// ArenaCombatUI — main class
// ═══════════════════════════════════════════════════════════════════
export class ArenaCombatUI {
  constructor(opts) {
    this.container = opts.arenaWrap;
    this.getDb     = opts.getDb;
    this.getRid    = opts.getRid;
    this.getBy     = opts.getBy;
    this.getRole   = opts.getRole;
    this.getBattle = opts.getBattle;
    this.getPieces = opts.getPieces;

    this._partyStates = {};
    this._sheets = new Map();
    this._sheetsMap = new Map();
    this._partyStatesUnsub = null;

    this._overlayRoot = null;
    this._currentOverlay = null;
    this._currentRadial = null;
    this._currentPrompt = null;
    this._currentContext = null;
    this._currentReroll = null;
    this._floats = [];
    this._pendingBadge = null;
    this._repeatBtn = null;
    this._timeline = null;
    this._lastMove = null;
    this._kbBound = false;

    try {
      this._lastMove = JSON.parse(localStorage.getItem(LAST_MOVE_KEY));
    } catch { this._lastMove = null; }

    injectCSS();
    this._init();
    this.startListening();
  }

  _init() {
    this._overlayRoot = document.createElement("div");
    this._overlayRoot.id = "arena-combat-overlay";
    this.container.appendChild(this._overlayRoot);

    this._repeatBtn = document.createElement("button");
    this._repeatBtn.className = "ac-repeat-btn";
    this._repeatBtn.style.display = "none";
    this._overlayRoot.appendChild(this._repeatBtn);
    this._repeatBtn.addEventListener("click", () => this._repeatLastMove());

    this._bindCanvasClick();
    this._bindContextMenu();
    this._bindKeyboard();
    this._updateRepeatBtn();
  }

  _battleRef() {
    const db = this.getDb(); const rid = this.getRid();
    if (!db || !rid) return null;
    return doc(db, "rooms", rid, "public_state", "battle");
  }

  _partyStatesRef() {
    const db = this.getDb(); const rid = this.getRid();
    if (!db || !rid) return null;
    return doc(db, "rooms", rid, "public_state", "party_states");
  }

  async _publishRoll(value, label = "d20") {
    const db = this.getDb(); const rid = this.getRid();
    const by = safeStr(this.getBy()) || "—";
    if (!db || !rid) return;
    try {
      await addDoc(collection(db, "rooms", rid, "rolls"), {
        by, value: safeInt(value, 0), label: safeStr(label) || "d20",
        createdAt: serverTimestamp(),
      });
    } catch (err) {}
  }

  startListening() {
    this.stopListening();
    const ref = this._partyStatesRef();
    if (!ref) return;
    this._partyStatesUnsub = onSnapshot(ref, (snap) => {
      this._partyStates = snap.exists() ? (snap.data() || {}) : {};
      for (const trainerName of Object.keys(this._partyStates)) {
        if (trainerName && !this._sheets.has(trainerName)) {
          this._loadSheets(trainerName);
        }
      }
    }, () => {});

    setTimeout(() => {
      const players = window.appState?.players || [];
      for (const pl of players) {
        const name = safeStr(pl?.trainer_name);
        if (name && !this._sheets.has(name)) this._loadSheets(name);
      }
      const by = this.getBy?.();
      if (by && !this._sheets.has(by)) this._loadSheets(by);
    }, 400);
  }

  stopListening() {
    if (this._partyStatesUnsub) { try { this._partyStatesUnsub(); } catch {} }
    this._partyStatesUnsub = null;
  }

  async _loadSheets(trainerName) {
    if (this._sheets.has(trainerName) && (this._sheets.get(trainerName) || []).length > 0) return;
    const db = this.getDb();
    if (!db) return;
    const tid = safeDocId(trainerName);
    try {
      const col = collection(db, "trainers", tid, "sheets");
      const q = query(col, orderBy("updated_at", "desc"), fbLimit(50));
      const snap = await getDocs(q);
      const sheets = [];
      const map = new Map();

      snap.forEach((d) => {
        const s = d.data() || {};
        s._sheet_id = d.id;
        sheets.push(s);

        const pid = safeStr(s.pokemon?.id);
        const lpid = safeStr(s.linked_pid);
        const pname = safeStr(s.pokemon?.name).toLowerCase();

        if (pid && !map.has(pid)) map.set(pid, s);
        if (pid && /^\d+$/.test(pid)) {
          const num = String(Number(pid));
          if (!map.has(num)) map.set(num, s);
        }
        if (lpid && !map.has(lpid)) map.set(lpid, s);
        if (pname && !map.has(pname)) map.set(pname, s);
      });
      this._sheets.set(trainerName, sheets);
      this._sheetsMap.set(trainerName, map);
    } catch (e) {}
  }

  _getSheet(trainerName, pid) {
    const m = this._sheetsMap.get(trainerName);
    if (!m) return null;
    const key = safeStr(pid);
    if (m.has(key)) return m.get(key);
    if (/^\d+$/.test(key)) {
      const num = String(Number(key));
      if (m.has(num)) return m.get(num);
    }
    if (window.dexMap) {
      const name = (window.dexMap[key] || window.dexMap[String(Number(key))] || "").toLowerCase();
      if (name && m.has(name)) return m.get(name);
    }
    return null;
  }

  // Novo _getEffectiveStats incluindo boosts temporários (espelha o combat.js)
  _getEffectiveStats(trainerName, pid) {
    const tData = this._partyStates[trainerName] || {};
    const key = safeStr(pid);
    
    let pData = tData[key];
    if (!pData && /^\d+$/.test(key)) pData = tData[String(Number(key))];
    if (!pData) {
      for (const k of Object.keys(tData)) {
        if (/^\d+$/.test(k) && Number(k) === Number(key)) { pData = tData[k]; break; }
      }
    }
    pData = pData || {};

    const sheet = this._getSheet(trainerName, pid);
    const hasPartyStats = (pData.stats && Object.keys(pData.stats).length > 0);
    const base = hasPartyStats ? pData.stats : (sheet?.stats || {});

    let baseFixed = base;
    if (!hasPartyStats) {
      const rawStats = (sheet && sheet.stats && typeof sheet.stats === "object" && !Array.isArray(sheet.stats)) ? sheet.stats : {};
      const np = safeInt(sheet?.np ?? sheet?.pokemon?.np ?? sheet?.pokemon?.NP);
      const hasCap = safeInt(rawStats.cap ?? rawStats.capability) > 0;
      baseFixed = (!hasCap && np > 0) ? { ...rawStats, cap: 2 * np } : rawStats;
    }

    const boosts = pData.stat_boosts || {};
    const result = normalizeStats(baseFixed);

    // Aplica modificadores (ex: acerto +2, parry -1)
    for (const [k, v] of Object.entries(boosts)) {
      const statKey = normalizeStatKey(k);
      if (result[statKey] !== undefined || statKey === "acerto") {
        result[statKey] = (safeInt(result[statKey]) + safeInt(v));
      }
    }

    result.fortitude = safeInt(result.fort);
    result.toughness = safeInt(result.thg);

    // THG Fallback baseado no dodge já boostado
    const np = safeInt(sheet?.np ?? sheet?.pokemon?.np ?? sheet?.pokemon?.NP);
    if (safeInt(result.thg) <= 0 && np > 0) {
      result.thg = Math.max(0, (2 * np) - safeInt(result.dodge));
      result.toughness = safeInt(result.thg);
    }

    return result;
  }

  // Calculador centralizado de dano com STAB e Tipo
_calcMoveContext(move, atkStats, by, atkPid, tOwner, tPid) {
    const mData = getMoveData(move);
    const rank = mData.rank;
    const extraDmg = mData.modDano; // Modificador extra do golpe, se houver
    
    const [based, statVal] = moveStatValue(move.meta || {}, atkStats);
    
    const moveName = safeStr(move.name) || "Golpe";
    const moveType = getMoveType(moveName) || safeStr(move.meta?.type) || safeStr(move.type) || "";
    
    const atkSheet = this._getSheet(by, atkPid);
    const atkTypes = Array.isArray(atkSheet?.pokemon?.types) ? atkSheet.pokemon.types : [];
    const tSheet = this._getSheet(tOwner, tPid);
    const tgtTypes = Array.isArray(tSheet?.pokemon?.types) ? tSheet.pokemon.types : [];

    const typeBonus = moveType && tgtTypes.length > 0 ? getTypeDamageBonus(moveType, tgtTypes) : 0;
    const stabBonus = (moveType && atkTypes.some(t => normalizeType(t) === moveType)) ? 2 : 0;

    return {
      baseDmg: rank + statVal + extraDmg,
      totalDmg: rank + statVal + typeBonus + stabBonus + extraDmg,
      typeBonus,
      stabBonus,
      moveType,
      based,
      statVal,
      rank
    };
  }

  _getFavorites(trainerName) {
    try {
      const raw = localStorage.getItem(FAV_KEY_PREFIX + trainerName);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }

  _saveFavorites(trainerName, arr) {
    try { localStorage.setItem(FAV_KEY_PREFIX + trainerName, JSON.stringify(arr)); } catch {}
  }

  _tileToScreen(row, col) {
    const v = window._arenaView;
    if (!v) return { x: 0, y: 0 };
    return {
      x: v.offX + col * v.scale + v.scale / 2,
      y: v.offY + row * v.scale + v.scale / 2,
    };
  }

  _pieceScreenPos(piece) {
    if (!piece) return { x: 0, y: 0 };
    return this._tileToScreen(Number(piece.row), Number(piece.col));
  }

  _clampPos(x, y, w, h) {
    const cr = this.container.getBoundingClientRect();
    const maxX = cr.width - w - 8;
    const maxY = cr.height - h - 8;
    return {
      x: Math.max(8, Math.min(x, maxX)),
      y: Math.max(8, Math.min(y, maxY)),
    };
  }

  _bindCanvasClick() {
    const canvas = document.getElementById("arena");
    if (!canvas) return;

    const _getEnemyPiece = (ev) => {
      if (window.appState?.placingPid) return null;
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const tile = window.screenToTile?.(x, y);
      if (!tile) return null;
      const piece = window.getPieceAt?.(tile.row, tile.col);
      if (!piece) return null;
      const by = this.getBy();
      const owner = safeStr(piece.owner);
      const role = this.getRole();
      const isPlayer = (role === "owner" || role === "challenger");
      const canStartCombat = !!window.canCurrentPlayerStartCombat?.();
      if (!isPlayer || !canStartCombat || owner === by || !owner) return null;
      return piece;
    };

    canvas.addEventListener("mousedown", (ev) => {
      if (ev.button !== 0) return;
      if (_getEnemyPiece(ev)) ev.stopImmediatePropagation();
    }, true);

    canvas.addEventListener("click", (ev) => {
      if (window.appState?.drag?.justDropped) return;
      const piece = _getEnemyPiece(ev);
      if (!piece) return;
      ev.stopImmediatePropagation();
      this._closeAll();
      window.selectPiece?.(safeStr(piece.id));
    }, true);
  }

  _bindContextMenu() {
    const canvas = document.getElementById("arena");
    if (!canvas) return;

    canvas.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const tile = window.screenToTile?.(x, y);
      if (!tile) return;

      this._closeAll();

      const piece = window.getPieceAt?.(tile.row, tile.col);
      const wrapRect = this.container.getBoundingClientRect();
      const cx = ev.clientX - wrapRect.left;
      const cy = ev.clientY - wrapRect.top;

      this._showContextMenu(piece, tile, cx, cy);
    }, true);
  }

  _showContextMenu(piece, tile, x, y) {
    const by = this.getBy();
    const role = this.getRole();
    const isPlayer = (role === "owner" || role === "challenger");
    const canStartCombat = !!window.canCurrentPlayerStartCombat?.();
    const el = document.createElement("div");
    el.className = "ac-context";

    let items = [];

    if (piece) {
      const owner = safeStr(piece.owner);
      const isEnemy = owner && by && owner.toLowerCase() !== by.toLowerCase();
      const isMine  = owner && by && owner.toLowerCase() === by.toLowerCase();
      const name = displayName(safeStr(piece.pid));

      if (isEnemy && isPlayer && canStartCombat) {
        items.push({ icon: "⚔️", label: `Atacar ${name}`, action: () => { this._closeAll(); this._openAttackOverlay(piece, x, y); } });
        if (this._lastMove) {
          items.push({ icon: "🔄", label: `Repetir: ${this._lastMove.moveName}`, kbd: "", action: () => { this._closeAll(); this._executeRepeatOnTarget(piece); } });
        }
        items.push({ icon: "🌀", label: "Ataque em Área", action: () => { this._closeAll(); this._openAttackOverlay(piece, x, y, "area"); } });
        items.push({ type: "sep" });
      }

      if (isMine) {
        const pieceId = safeStr(piece.id);
        const isRevealed = !!piece.revealed;
        items.push({ icon: "🎯", label: "Selecionar peça", action: () => { this._closeAll(); window.selectPiece?.(pieceId); } });
        items.push({
          icon: isRevealed ? "🙈" : "👁️",
          label: isRevealed ? "Ocultar peça" : "Revelar peça",
          action: () => { this._closeAll(); window.togglePieceRevealed?.(pieceId); },
        });
        items.push({ icon: "💔", label: "Reduzir 1 HP", action: () => { this._closeAll(); window.handlePieceMenuAction?.("hp-down", pieceId); } });
        items.push({ icon: "❌", label: "Retirar da arena", action: () => { this._closeAll(); window.removePieceFromBoard?.(pieceId); } });
        items.push({ type: "sep" });
        items.push({ icon: "📋", label: `Ver ficha de ${name}`, action: () => { this._closeAll(); this._viewSheet(piece); } });
      }
    } else if (isPlayer && window.appState?.selectedPieceId) {
      items.push({ icon: "🚶", label: `Mover para (${tile.row}, ${tile.col})`, action: () => { this._closeAll(); } });
    }

    if (!items.length) return;

    el.innerHTML = items.map(it => {
      if (it.type === "sep") return `<div class="ac-ctx-sep"></div>`;
      return `<div class="ac-ctx-item"><span class="ac-ctx-icon">${it.icon}</span>${escHtml(it.label)}${it.kbd ? `<span class="ac-ctx-kbd">${it.kbd}</span>` : ""}</div>`;
    }).join("");

    const pos = this._clampPos(x, y, 200, items.length * 36);
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    this._overlayRoot.appendChild(el);
    this._currentContext = el;

    let idx = 0;
    el.querySelectorAll(".ac-ctx-item").forEach(itemEl => {
      while (idx < items.length && items[idx].type === "sep") idx++;
      if (idx >= items.length) return;
      const action = items[idx].action;
      itemEl.addEventListener("click", () => { if (action) action(); });
      idx++;
    });

    const closeHandler = (e) => {
      if (!el.contains(e.target)) {
        this._closeContext();
        document.removeEventListener("click", closeHandler, true);
      }
    };
    setTimeout(() => document.addEventListener("click", closeHandler, true), 10);
  }

  _bindKeyboard() {
    if (this._kbBound) return;
    this._kbBound = true;
    document.addEventListener("keydown", (ev) => {
      const tag = (ev.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") {
        if (ev.key !== "Escape") return;
      }
      if (ev.key === "Escape") {
        if (this._currentOverlay || this._currentRadial || this._currentPrompt || this._currentContext || this._currentReroll) {
          ev.preventDefault();
          this._closeAll();
        }
        return;
      }
      if (this._currentReroll) {
        if (ev.key === "r" || ev.key === "R") { ev.preventDefault(); this._doReroll(); return; }
        if (ev.key === "Enter") { ev.preventDefault(); this._keepRoll(); return; }
      }
      if (ev.key === "/" && this._currentOverlay) {
        const search = this._currentOverlay.querySelector(".ac-search");
        if (search) { ev.preventDefault(); search.focus(); }
      }
    });
  }

  async _openAttackOverlay(targetPiece, x, y, forceMode = null) {
    this._closeOverlay();

    const by = this.getBy();
    await this._loadSheets(by);

    const pieces = this.getPieces() || [];
    const myPieces = pieces.filter(p =>
      safeStr(p.owner) === by && safeStr(p.kind) !== "trainer" && safeStr(p.pid) && safeStr(p.status || "active") === "active"
    );

    const tPid = safeStr(targetPiece.pid);
    const tOwner = safeStr(targetPiece.owner);
    const tName = displayName(tPid);
    const _tPs = ((this._partyStates && this._partyStates[tOwner]) ? this._partyStates[tOwner] : {})[tPid] || {};
    const tSprite = spriteUrl(tPid, { type: "battle", shiny: !!_tPs.shiny });

    const el = document.createElement("div");
    el.className = "ac-overlay";

    el.innerHTML = `
      <div class="ac-overlay-header">
        <img class="ac-overlay-sprite" src="${escHtml(tSprite)}" alt="${escHtml(tName)}" onerror="this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'" />
        <div>
          <div class="ac-overlay-name">${escHtml(tName)}</div>
          <div class="ac-overlay-sub">${escHtml(tOwner)} • ${escHtml(tName)}</div>
        </div>
        <button class="ac-overlay-close" title="Fechar (Esc)">✕</button>
      </div>
      <div id="ac-overlay-body"></div>
    `;

    const pos = this._clampPos(x + 10, y - 20, 300, 400);
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;

    this._overlayRoot.appendChild(el);
    this._currentOverlay = el;

    el.querySelector(".ac-overlay-close").addEventListener("click", () => this._closeOverlay());

    const closeHandler = (e) => {
      if (!el.contains(e.target) && !e.target.closest(".ac-radial")) {
        this._closeOverlay();
        document.removeEventListener("mousedown", closeHandler, true);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", closeHandler, true), 50);

    const body = el.querySelector("#ac-overlay-body");
    this._buildOverlayBody(body, targetPiece, myPieces, forceMode);
  }

  _buildOverlayBody(body, targetPiece, myPieces, forceMode) {
    const by = this.getBy();

    let atkHtml = "";
    if (myPieces.length === 1) {
      const p = myPieces[0];
      atkHtml = `<div style="font-size:11px;color:rgba(148,163,184,.7);margin-bottom:6px">Atacante: <strong style="color:rgba(226,232,240,.9)">${escHtml(displayName(safeStr(p.pid)))}</strong></div>`;
    } else if (myPieces.length > 1) {
      atkHtml = `<select class="ac-search" id="ac-atk-select" style="margin-bottom:8px">
        ${myPieces.map(p => {
          const pid = safeStr(p.pid);
          return `<option value="${escHtml(pid)}">${escHtml(displayName(pid))}</option>`;
        }).join("")}
      </select>`;
    }

    const rangeHtml = `
      <div class="ac-range-row">
        <button class="ac-range-btn ac-active" data-range="distance">🏹 Distância (Dodge)</button>
        <button class="ac-range-btn" data-range="melee">⚔️ Melee (Parry)</button>
        <button class="ac-range-btn" data-range="area">🌀 Área (Dodge CD)</button>
      </div>
    `;

    body.innerHTML = `
      ${atkHtml}
      ${rangeHtml}
      <div style="display:flex;align-items:center;gap:8px;margin:8px 0 10px;padding:8px 10px;border-radius:10px;background:rgba(168,85,247,.10);border:1px solid rgba(168,85,247,.28)">
        <input type="checkbox" id="ac-sneak-attack" style="accent-color:#a855f7;width:16px;height:16px;cursor:pointer" />
        <label for="ac-sneak-attack" style="font-size:12px;font-weight:700;cursor:pointer;color:rgba(226,232,240,.9)">🥷 Furtivo <span style="font-weight:400;color:rgba(148,163,184,.9)">(oponente usa def/2)</span></label>
      </div>
      <div id="ac-moves-area"></div>
    `;

    const getSneakAttack = () => !!body.querySelector("#ac-sneak-attack")?.checked;

    let currentRange = "distance";
    body.querySelectorAll(".ac-range-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        currentRange = btn.dataset.range;
        body.querySelectorAll(".ac-range-btn").forEach(b => b.classList.toggle("ac-active", b === btn));
      });
    });

    const getAtkPid = () => {
      if (myPieces.length === 1) return safeStr(myPieces[0].pid);
      const sel = body.querySelector("#ac-atk-select");
      return sel ? sel.value : (myPieces[0] ? safeStr(myPieces[0].pid) : "");
    };

    const loadMoves = () => {
      const atkPid = getAtkPid();
      const sheet = this._getSheet(by, atkPid);
      const moves = sheet?.moves || [];
      const stats = this._getEffectiveStats(by, atkPid);
      const favorites = this._getFavorites(by);

      const movesArea = body.querySelector("#ac-moves-area");

      const favMoves = favorites.length > 0
        ? favorites.map(name => moves.find(m => safeStr(m.name) === name)).filter(Boolean)
        : [];

      if (favMoves.length >= 3 && !forceMode) {
        movesArea.innerHTML = `
          <div class="ac-quick-actions">
            <button class="ac-quick-btn" id="ac-open-radial">🎯 Favoritos (${favMoves.length})</button>
            <button class="ac-quick-btn" id="ac-open-list">📋 Todos os Golpes</button>
            <button class="ac-quick-btn" id="ac-open-manual">✍️ Input manual</button>
          </div>
        `;
        movesArea.querySelector("#ac-open-radial")?.addEventListener("click", () => {
          this._openRadialMenu(targetPiece, favMoves, moves, stats, getAtkPid, currentRange, getSneakAttack);
        });
        movesArea.querySelector("#ac-open-list")?.addEventListener("click", () => {
          this._renderMoveList(movesArea, moves, stats, targetPiece, getAtkPid, () => currentRange, getSneakAttack);
        });
        movesArea.querySelector("#ac-open-manual")?.addEventListener("click", () => {
          this._openManualInputDialog(targetPiece, getAtkPid(), currentRange, getSneakAttack());
        });
      } else {
        this._renderMoveList(movesArea, moves, stats, targetPiece, getAtkPid, () => currentRange, getSneakAttack);
      }
    };

    body.querySelector("#ac-atk-select")?.addEventListener("change", loadMoves);
    loadMoves();
  }

  _renderMoveList(container, moves, stats, targetPiece, getAtkPid, getRange, getSneakAttack = () => false) {
    let html = `<input class="ac-search" placeholder="/ buscar golpe..." id="ac-move-search" />`;
    html += `<button class="ac-quick-btn" id="ac-manual-input" style="width:100%;margin-bottom:6px">✍️ Input manual</button>`;
    html += `<div class="ac-movelist" id="ac-movelist-inner">`;

    html += `<div class="ac-move-item" data-mode="area">
      <span style="font-size:14px">🌀</span>
      <span class="ac-move-name">Ataque em Área</span>
      <span class="ac-move-meta">Dodge CD</span>
    </div>`;

    moves.forEach((mv, i) => {
      const name = safeStr(mv.name) || "Golpe";
      const cat = safeStr(mv.meta?.category || mv.category || "").toLowerCase();
      const icon = cat.includes("status") ? "🟣" : cat.includes("special") || cat.includes("especial") ? "🔵" : "🔴";
      
      const ctx = this._calcMoveContext(mv, stats, this.getBy(), getAtkPid(), targetPiece.owner, targetPiece.pid);
      const aceiroBonus = safeInt(stats.acerto || 0);
const mData = getMoveData(mv);
const acc = mData.acc + aceiroBonus;
      const extraTxt = (ctx.typeBonus !== 0 || ctx.stabBonus > 0) ? ` (+)` : ``;
      const dmgClass = (ctx.typeBonus > 0 || ctx.stabBonus > 0) ? "bonus-high" : "";

      html += `<div class="ac-move-item" data-idx="${i}">
        <span style="font-size:14px">${icon}</span>
        <span class="ac-move-name">${escHtml(name)}</span>
        <span class="ac-move-meta">Ac ${acc} • R${ctx.rank}</span>
        <span class="ac-move-dmg ${dmgClass}">${ctx.totalDmg}${extraTxt}</span>
      </div>`;
    });

    if (!moves.length) {
      html += `<div style="padding:12px;text-align:center;color:rgba(148,163,184,.5);font-size:12px">Nenhum golpe encontrado.</div>`;
    }

    html += `</div>`;
    container.innerHTML = html;

    const searchInput = container.querySelector("#ac-move-search");
    searchInput?.addEventListener("input", () => {
      const q = searchInput.value.toLowerCase();
      container.querySelectorAll(".ac-move-item[data-idx]").forEach(el => {
        const name = el.querySelector(".ac-move-name")?.textContent?.toLowerCase() || "";
        el.style.display = name.includes(q) ? "" : "none";
      });
    });

    container.querySelectorAll(".ac-move-item[data-idx]").forEach(el => {
      el.addEventListener("click", () => {
        const idx = parseInt(el.dataset.idx);
        const mv = moves[idx];
        if (!mv) return;
        if (getRange() === "area") {
          this._openAreaDialog(targetPiece, getAtkPid(), {
            level: safeInt(mv.rank, 1),
            isEffect: this._isEffectMove(mv),
          });
          return;
        }
        this._executeAttack(getAtkPid(), targetPiece, mv, stats, getRange(), { sneakAttack: getSneakAttack() });
      });
    });

    container.querySelector('.ac-move-item[data-mode="area"]')?.addEventListener("click", () => {
      this._openAreaDialog(targetPiece, getAtkPid());
    });

    container.querySelector("#ac-manual-input")?.addEventListener("click", () => {
      this._openManualInputDialog(targetPiece, getAtkPid(), getRange(), getSneakAttack());
    });
  }

  _isEffectMove(move) {
    const category = safeStr(move?.meta?.category || move?.category || "").toLowerCase();
    return category.includes("status") || move?.meta?.is_effect === true;
  }

  _openAreaDialog(targetPiece, atkPid, defaults = {}) {
    this._closeOverlay();
    const pos = this._pieceScreenPos(targetPiece);
    const el = document.createElement("div");
    el.className = "ac-prompt";
    const cpos = this._clampPos(pos.x + 30, pos.y - 50, 260, 200);
    el.style.left = `${cpos.x}px`;
    el.style.top = `${cpos.y}px`;

    el.innerHTML = `
      <div class="ac-prompt-title">🌀 Ataque em Área</div>
      <div style="margin-bottom:8px">
        <label style="font-size:11px;color:rgba(148,163,184,.7)">Nível do Efeito / Dano</label>
        <input class="ac-search" id="ac-area-level" type="number" value="${safeInt(defaults.level, 1)}" min="1" style="margin-top:4px" />
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
        <input type="checkbox" id="ac-area-effect" ${defaults.isEffect ? "checked" : ""} />
        <label for="ac-area-effect" style="font-size:12px;font-weight:700;color:rgba(226,232,240,.85)">É Efeito? (Affliction)</label>
      </div>
      <button class="ac-prompt-btn ac-wide" id="ac-area-launch">🚀 Lançar Área</button>
    `;

    this._overlayRoot.appendChild(el);
    this._currentPrompt = el;

    el.querySelector("#ac-area-launch").addEventListener("click", async () => {
      const btn = el.querySelector("#ac-area-launch");
      btn.disabled = true; btn.textContent = "⏳...";

      const lvl = safeInt(el.querySelector("#ac-area-level").value, 1);
      const isEff = el.querySelector("#ac-area-effect").checked;
      const by = this.getBy();
      const tId = safeStr(targetPiece.id);
      const tOwner = safeStr(targetPiece.owner);
      const tPid = safeStr(targetPiece.pid);

      const ref = this._battleRef();
      if (!ref) return;

      await this._writeBattle({
        status: "aoe_defense",
        attacker: by,
        attacker_pid: atkPid,
        target_id: tId,
        target_owner: tOwner,
        target_pid: tPid,
        aoe_dc: lvl + 10,
        dmg_base: lvl,
        is_effect: isEff,
        pendingFor: tOwner,
        prompt: { type: "ROLL_RESIST", options: { dc: lvl + 10, isEffect: isEff, isAoe: true, aoePhase: "dodge" } },
        logs: [`${by} lançou Área (Rank ${lvl}). Defensor rola Dodge obrigatório (CD ${lvl + 10}).`],
      });

      this._showFloat(targetPiece, `🌀 Área Nv${lvl} — CD ${lvl + 10}`, "pending");
      this._closePrompt();
    });
  }

  _openManualInputDialog(targetPiece, atkPid, rangeStr, sneakAttack = false) {
    this._closeOverlay();
    const pos = this._pieceScreenPos(targetPiece);
    const el = document.createElement("div");
    el.className = "ac-prompt";
    const cpos = this._clampPos(pos.x + 30, pos.y - 50, 280, 260);
    el.style.left = `${cpos.x}px`;
    el.style.top = `${cpos.y}px`;

    el.innerHTML = `
      <div class="ac-prompt-title">✍️ Input manual</div>
      <div style="display:grid;gap:8px;margin-bottom:10px">
        <label style="font-size:11px;color:rgba(148,163,184,.7)">Acerto (Accuracy)
          <input class="ac-search" id="ac-manual-acc" type="number" value="0" style="margin-top:4px" />
        </label>
        <label style="font-size:11px;color:rgba(148,163,184,.7)">Rank
          <input class="ac-search" id="ac-manual-rank" type="number" value="1" min="1" style="margin-top:4px" />
        </label>
        <label style="font-size:11px;color:rgba(148,163,184,.7)">Tipo
          <select class="ac-search" id="ac-manual-type" style="margin-top:4px">
            <option value="damage">Dano</option>
            <option value="effect">Affliction</option>
          </select>
        </label>
      </div>
      <button class="ac-prompt-btn ac-wide" id="ac-manual-send">✅ Confirmar</button>
    `;

    this._overlayRoot.appendChild(el);
    this._currentPrompt = el;

    el.querySelector("#ac-manual-send")?.addEventListener("click", async () => {
      const acc = safeInt(el.querySelector("#ac-manual-acc")?.value, 0);
      const rank = Math.max(1, safeInt(el.querySelector("#ac-manual-rank")?.value, 1));
      const manualType = safeStr(el.querySelector("#ac-manual-type")?.value) || "damage";
      const isEffect = manualType === "effect";

      if (rangeStr === "area") {
        const by = this.getBy();
        const tId = safeStr(targetPiece.id);
        const tOwner = safeStr(targetPiece.owner);
        const tPid = safeStr(targetPiece.pid);

        await this._writeBattle({
          status: "aoe_defense",
          attacker: by,
          attacker_pid: atkPid,
          target_id: tId,
          target_owner: tOwner,
          target_pid: tPid,
          aoe_dc: rank + 10,
          dmg_base: rank,
          is_effect: isEffect,
          pendingFor: tOwner,
          prompt: { type: "ROLL_RESIST", options: { dc: rank + 10, isEffect, isAoe: true, aoePhase: "dodge" } },
          logs: [`${by} lançou Área manual (Rank ${rank}, Acc ${acc}). Defensor rola Dodge obrigatório (CD ${rank + 10}).`],
        });
        this._showFloat(targetPiece, `🌀 Área Nv${rank} — CD ${rank + 10}`, "pending");
        this._closePrompt();
        return;
      }

      const manualMove = {
        name: `Input Manual (${isEffect ? "Affliction" : "Dano"})`,
        accuracy: acc,
        rank,
        meta: { category: isEffect ? "Status" : "Physical", is_effect: isEffect },
      };

      this._closePrompt();
      await this._executeAttack(atkPid, targetPiece, manualMove, {}, rangeStr || "distance", { sneakAttack });
    });
  }

  _openRadialMenu(targetPiece, favMoves, allMoves, stats, getAtkPid, currentRange, getSneakAttack = () => false) {
    this._closeRadial();

    const pos = this._pieceScreenPos(targetPiece);
    const el = document.createElement("div");
    el.className = "ac-radial";
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;

    const tPid = safeStr(targetPiece.pid);
    const _tOwnerRadial = safeStr(targetPiece.owner);
    const _tPsRadial = ((this._partyStates && this._partyStates[_tOwnerRadial]) ? this._partyStates[_tOwnerRadial] : {})[tPid] || {};
    const tSprite = spriteUrl(tPid, { type: "battle", shiny: !!_tPsRadial.shiny });
    el.innerHTML = `
      <div class="ac-radial-center" title="${escHtml(displayName(tPid))}">
        <img src="${escHtml(tSprite)}" alt="" onerror="this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'" />
      </div>
    `;

    const radius = 90;
    const slotCount = Math.min(favMoves.length + 2, 8);
    const totalSlots = slotCount;

    const displayMoves = [...favMoves.slice(0, 6)];

    for (let i = 0; i < totalSlots; i++) {
      const angle = (i / totalSlots) * 2 * Math.PI - Math.PI / 2;
      const sx = Math.cos(angle) * radius;
      const sy = Math.sin(angle) * radius;

      const slot = document.createElement("div");
      slot.className = "ac-radial-slot";
      slot.style.left = `${sx}px`;
      slot.style.top = `${sy}px`;

      if (i < displayMoves.length) {
        const mv = displayMoves[i];
        const ctx = this._calcMoveContext(mv, stats, this.getBy(), getAtkPid(), targetPiece.owner, targetPiece.pid);
        const cat = safeStr(mv.meta?.category || mv.category || "").toLowerCase();
        const icon = cat.includes("status") ? "🟣" : cat.includes("special") || cat.includes("especial") ? "🔵" : "🔴";

        slot.innerHTML = `
          <span class="ac-slot-icon">${icon}</span>
          <span class="ac-slot-name">${escHtml(safeStr(mv.name).slice(0, 10))}</span>
          <span class="ac-slot-sub">R${ctx.rank} • D${ctx.totalDmg}</span>
        `;
        slot.title = `${safeStr(mv.name)} — Rank ${ctx.rank}, Dano ${ctx.totalDmg}, Acc ${safeInt(mv.accuracy) + safeInt(stats.acerto||0)}`;
        slot.addEventListener("click", () => {
          this._closeRadial();
          this._closeOverlay();
          if (currentRange === "area") {
            this._openAreaDialog(targetPiece, getAtkPid(), {
              level: safeInt(mv.rank, 1),
              isEffect: this._isEffectMove(mv),
            });
            return;
          }
          this._executeAttack(getAtkPid(), targetPiece, mv, stats, currentRange, { sneakAttack: getSneakAttack() });
        });
      } else if (i === totalSlots - 2) {
        slot.innerHTML = `<span class="ac-slot-icon">➕</span><span class="ac-slot-name">Todos</span>`;
        slot.title = "Ver todos os golpes";
        slot.addEventListener("click", () => {
          this._closeRadial();
          if (this._currentOverlay) {
            const body = this._currentOverlay.querySelector("#ac-overlay-body #ac-moves-area");
            if (body) this._renderMoveList(body, allMoves, stats, targetPiece, getAtkPid, () => currentRange, getSneakAttack);
          }
        });
      } else {
        slot.innerHTML = `<span class="ac-slot-icon">🌀</span><span class="ac-slot-name">Área</span>`;
        slot.title = "Ataque em Área";
        slot.addEventListener("click", () => {
          this._closeRadial();
          this._closeOverlay();
          this._openAreaDialog(targetPiece, getAtkPid());
        });
      }

      el.appendChild(slot);
    }

    this._overlayRoot.appendChild(el);
    this._currentRadial = el;

    const closeHandler = (e) => {
      if (!el.contains(e.target) && !this._currentOverlay?.contains(e.target)) {
        this._closeRadial();
        document.removeEventListener("mousedown", closeHandler, true);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", closeHandler, true), 50);
  }

  async _executeAttack(atkPid, targetPiece, move, stats, rangeStr, opts = {}) {
    this._closeAll();

    const by = this.getBy();
    const tId = safeStr(targetPiece.id);
    const tOwner = safeStr(targetPiece.owner);
    const tPid = safeStr(targetPiece.pid);
    
    // Assegura fichas atualizadas
    if (by) await this._loadSheets(by);
    if (tOwner) await this._loadSheets(tOwner);

    const atkStats = this._getEffectiveStats(by, atkPid);
    const tStats = this._getEffectiveStats(tOwner, tPid);

    const aceiroBonus = safeInt(atkStats.acerto || 0);

    const isDistance = rangeStr === "distance";
    const defenseKey = isDistance ? "dodge" : "parry";
    const isSneakAttack = !!opts.sneakAttack;
    const baseDefenseVal = safeInt(tStats[defenseKey]);
    const defenseVal = isSneakAttack ? Math.floor(baseDefenseVal / 2) : baseDefenseVal;
    
    // Novo fluxo: Defense DC é dinâmico usando o stats total do alvo
    const needed = defenseVal + 10;

const mData = getMoveData(move);
const atkMod = mData.acc; // Puxa o modificador do golpe exato
const ctx = this._calcMoveContext(move, atkStats, by, atkPid, tOwner, tPid);
    const isEffect = this._isEffectMove(move);

    // Roll d20 + Acc do Golpe + Modificador de Acerto (Ficha)
    const roll = d20Roll();
    this._publishRoll(roll, `Ataque • ${displayName(atkPid)}`);

    const totalAtk = atkMod + aceiroBonus + roll;
    let hit, critBonus;
    if (roll === 1) { hit = false; critBonus = 0; }
    else if (roll === 20) { hit = true; critBonus = 5; }
    else { hit = totalAtk >= needed; critBonus = 0; }

    const atkModStr = (aceiroBonus !== 0) ? `${atkMod}+${aceiroBonus}` : `${atkMod}`;
    const rollText = `d20=${roll}+${atkModStr}=${totalAtk} vs DEF ${needed}`;
    if (hit) {
      const critTxt = critBonus ? " CRIT!" : "";
      this._showFloat(targetPiece, `ACERTOU ✅ (${rollText})${critTxt}`, critBonus ? "crit" : "hit");
    } else {
      this._showFloat(targetPiece, `ERROU ❌ (${rollText})`, "miss");
    }

    this._lastMove = {
      moveName: safeStr(move.name),
      moveIdx: 0,
      attackerPid: atkPid,
      mode: "normal",
      rangeStr,
      sneakAttack: isSneakAttack,
    };
    try { localStorage.setItem(LAST_MOVE_KEY, JSON.stringify(this._lastMove)); } catch {}
    this._updateRepeatBtn();

    const movePayload = {
      name: safeStr(move.name) || "Golpe",
      accuracy: atkMod,
      damage: ctx.totalDmg,
      rank: ctx.rank,
      based_stat: ctx.based,
      stat_value: ctx.statVal,
      move_type: ctx.moveType,
      type_bonus: ctx.typeBonus,
      stab_bonus: ctx.stabBonus,
      meta: move.meta || {},
    };

    const atkRange = isDistance ? "Distância (Dodge)" : "Corpo-a-corpo (Parry)";
    const critTxt = critBonus ? " (CRÍTICO +5)" : "";
    const sneakTxt = isSneakAttack ? " 🥷 Furtivo (def/2)" : "";
    const resultMsg = hit ? "ACERTOU! ✅" : "ERROU! ❌";

    if (hit) {
      const dcBase = isEffect ? 10 : 15;
      const dcTotal = dcBase + ctx.totalDmg + critBonus;

      await this._writeBattle({
        status: "waiting_defense",
        attacker: by,
        attacker_pid: atkPid,
        target_id: tId,
        target_owner: tOwner,
        target_pid: tPid,
        attack_move: movePayload,
        attack_range: atkRange,
        atk_mod: atkMod,
        aceiro_bonus: aceiroBonus,
        d20: roll,
        defense_val: defenseVal,
        needed,
        total_atk: totalAtk,
        crit_bonus: critBonus,
        sneak_attack: isSneakAttack,
        dmg_base: ctx.totalDmg,
        is_effect: isEffect,
        pendingFor: tOwner,
        prompt: {
          type: "ROLL_RESIST",
          options: { dc: dcTotal, isEffect, rank: ctx.totalDmg, critBonus },
        },
        logs: [
          `${by} rolou ${roll}+${atkModStr}=${totalAtk} (vs Def ${needed} [${defenseVal}+10])${critTxt}${sneakTxt}... ${resultMsg}`,
          `Rank/Dano: ${ctx.totalDmg}${isEffect ? " (Affliction)" : ""}. Aguardando resistência... (CD ${dcTotal})`,
        ],
      });

      this._showFloat(targetPiece, `🛡️ Resistência pendente (${tOwner})`, "pending");
    } else {
      await this._writeBattle({
        status: "idle",
        attacker: by,
        attacker_pid: atkPid,
        target_id: tId,
        target_owner: tOwner,
        target_pid: tPid,
        attack_move: movePayload,
        attack_range: atkRange,
        atk_mod: atkMod,
        aceiro_bonus: aceiroBonus,
        d20: roll,
        defense_val: defenseVal,
        needed,
        total_atk: totalAtk,
        crit_bonus: 0,
        sneak_attack: isSneakAttack,
        pendingFor: null,
        prompt: null,
        logs: [
          `${by} rolou ${roll}+${atkModStr}=${totalAtk} (vs Def ${needed} [${defenseVal}+10])${sneakTxt}... ${resultMsg}`,
        ],
      });
    }
  }

  async _executeRepeatOnTarget(targetPiece) {
    if (!this._lastMove) return;
    const by = this.getBy();
    await this._loadSheets(by);

    const atkPid = this._lastMove.attackerPid;
    const sheet = this._getSheet(by, atkPid);
    const moves = sheet?.moves || [];
    const stats = this._getEffectiveStats(by, atkPid);
    const mv = moves.find(m => safeStr(m.name) === this._lastMove.moveName);
    if (!mv) {
      this._showFloat(targetPiece, `❌ Golpe "${this._lastMove.moveName}" não encontrado`, "miss");
      return;
    }
    this._executeAttack(atkPid, targetPiece, mv, stats, this._lastMove.rangeStr || "distance", {
      sneakAttack: !!this._lastMove.sneakAttack,
    });
  }

  _repeatLastMove() {
    const battle = this.getBattle();
    if (!battle || !this._lastMove) return;

    const tId = safeStr(battle.target_id);
    const pieces = this.getPieces() || [];
    const target = pieces.find(p => safeStr(p.id) === tId);
    if (!target) return;

    this._executeRepeatOnTarget(target);
  }

  _updateRepeatBtn() {
    if (!this._repeatBtn) return;
    if (this._lastMove && this._lastMove.moveName) {
      this._repeatBtn.textContent = `🔄 Repetir: ${this._lastMove.moveName}`;
      this._repeatBtn.style.display = "";
    } else {
      this._repeatBtn.style.display = "none";
    }
  }

  _sheetMoveMeta(move) {
    const rk = safeInt(move?.rank ?? move?.damage ?? move?.power ?? move?.lvl ?? 0, 0);
    const acc = safeInt(move?.accuracy ?? move?.acc ?? move?.acerto ?? 0, 0);
    const area = !!(move?.is_area || move?.area || safeStr(move?.target).toLowerCase().includes("area"));
    return { rk, acc, area };
  }

  _renderSidebarSheet(piece, sheet) {
    const root = document.getElementById("arena_sheet_preview");
    if (!root) return;
    if (!piece || !sheet) {
      root.innerHTML = `<div class="arena-sheet-card"><div class="muted">Ficha não encontrada para esta peça.</div></div>`;
      return;
    }

    const by = this.getBy();
    const pid = safeStr(piece.pid);
    const pkm = sheet.pokemon || {};
    const name = safeStr(pkm.name) || displayName(pid);
    const np = safeInt(sheet.np || pkm.np || 0, 0);
    const types = Array.isArray(pkm.types) ? pkm.types : [];
    const abilities = Array.isArray(pkm.abilities) ? pkm.abilities : [];
    const owner = safeStr(piece.owner) || by;
    const st = this._getEffectiveStats(owner, pid);
    const stgr = safeInt(st.stgr), intel = safeInt(st.int), thg = safeInt(st.thg), dodge = safeInt(st.dodge);
    const parry = safeInt(st.parry), fort = safeInt(st.fort), will = safeInt(st.will);

    const tData = this._partyStates[by] || {};
    const pData = tData[pid] || {};
    const hp = safeInt(pData.hp, 6);
    const hpMax = 6;
    const hpPct = Math.max(0, Math.min(100, (hp / hpMax) * 100));
    const hpCol = hpPct > 50 ? "rgba(34,197,94,1)" : hpPct > 25 ? "rgba(234,179,8,1)" : "rgba(239,68,68,1)";

    const movesRaw = Array.isArray(sheet.moves) ? sheet.moves : (sheet.moves ? Object.values(sheet.moves) : []);
    const moves = movesRaw.filter((m) => m && typeof m === "object").slice(0, 3);
    const movesHtml = moves.length
      ? moves.map((mv) => {
          const mName = safeStr(mv.name || mv.nome || mv.Nome || "Golpe");
          const { rk, acc, area } = this._sheetMoveMeta(mv);
          return `<div class="move-row"><div class="move-head"><span class="move-name">${escHtml(mName)}</span><span class="mv-pill">A+${acc}</span><span class="mv-pill">R${rk}</span><span class="mv-pill">${area ? "Área" : "Alvo"}</span></div></div>`;
        }).join("")
      : `<div class="muted">Sem golpes nesta ficha.</div>`;

    const typeHtml = types.map((t) => `<span class="chip">${escHtml(safeStr(t))}</span>`).join("");
    const abHtml = abilities.slice(0, 3).map((a) => `<span class="chip">${escHtml(safeStr(a))}</span>`).join("");
    const art = spriteUrl(pid, { type: "art", shiny: !!pData.shiny });

    root.innerHTML = `
      <div class="arena-sheet-card">
        <div class="sheet-top">
          <img class="sheet-art" src="${escHtml(art)}" alt="${escHtml(name)}" />
          <div style="flex:1;min-width:0;">
            <div class="sheet-name">${escHtml(name)}</div>
            <div class="sheet-sub">#${escHtml(pid)} • NP ${np}</div>
            <div class="chip-row">${typeHtml || `<span class="muted">Sem tipo</span>`}</div>
          </div>
        </div>
        ${abHtml ? `<div class="chip-row">${abHtml}</div>` : ""}
        <div class="hp-row"><span>HP</span><span>${hp}/${hpMax}</span></div>
        <div class="hp-track"><div class="hp-fill" style="width:${hpPct}%;background:${hpCol};"></div></div>
        <div class="stat-grid">
          <div class="stat-box"><div class="stat-label">Stgr</div><div class="stat-val">${stgr}</div></div>
          <div class="stat-box"><div class="stat-label">Int</div><div class="stat-val">${intel}</div></div>
          <div class="stat-box"><div class="stat-label">Thg</div><div class="stat-val">${thg}</div></div>
          <div class="stat-box"><div class="stat-label">Dodge</div><div class="stat-val">${dodge}</div></div>
          <div class="stat-box"><div class="stat-label">Parry</div><div class="stat-val">${parry}</div></div>
          <div class="stat-box"><div class="stat-label">Fort</div><div class="stat-val">${fort}</div></div>
          <div class="stat-box"><div class="stat-label">Will</div><div class="stat-val">${will}</div></div>
          <div class="stat-box"><div class="stat-label">Cap</div><div class="stat-val">${np * 2}</div></div>
        </div>
        <div class="section-title">Golpes</div>
        ${movesHtml}
      </div>
    `;
  }

  async _viewSheet(piece) {
    if (!piece) return;
    const by = (this.getBy() || "").toLowerCase();
    const owner = safeStr(piece.owner).toLowerCase();
    if (!by || owner !== by) return;

    if (piece?.id && typeof window.selectPiece === "function") {
      window.selectPiece(piece.id);
    }
    await this._loadSheets(safeStr(piece.owner) || this.getBy());
    const pid = safeStr(piece.pid);
    const sheet = this._getSheet(safeStr(piece.owner) || this.getBy(), pid);
    this._renderSidebarSheet(piece, sheet);
  }

  _showFloat(piece, text, type = "hit") {
    const pos = this._pieceScreenPos(piece);
    const offset = this._floats.filter(f => !f._removed).length * 35;

    const el = document.createElement("div");
    el.className = `ac-float ac-float-${type}`;
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y - offset}px`;
    el.textContent = text;

    this._overlayRoot.appendChild(el);

    const entry = { el, _removed: false };
    this._floats.push(entry);

    if (type !== "pending") {
      const duration = type === "stage" ? 5000 : 4000;
      setTimeout(() => {
        entry._removed = true;
        try { el.remove(); } catch {}
        this._floats = this._floats.filter(f => f !== entry);
      }, duration);
    }

    return entry;
  }

  _clearPendingFloats() {
    this._floats = this._floats.filter(f => {
      if (f.el.classList.contains("ac-float-pending")) {
        try { f.el.remove(); } catch {}
        f._removed = true;
        return false;
      }
      return true;
    });
  }

  render() {
    const battle = this.getBattle();
    if (!battle) { this._clearPendingFloats(); this._closePrompt(); this._closeReroll(); return; }

    const by = this.getBy();
    const pendingFor = safeStr(battle.pendingFor);
    const prompt = battle.prompt;
    const status = safeStr(battle.status);

    this._updateTimeline(battle);

    if (status === "idle") {
      this._clearPendingFloats();
      this._closePrompt();
      this._closeReroll();

      // Verifica se há combate anterior para Efeito Secundário
      const prevAttacker = safeStr(battle.attacker);
      const prevLogs = battle.logs || [];
      const canSecondary = (prevAttacker === by) && prevLogs.length > 0 && safeStr(battle.target_id);
      if (canSecondary && !this._currentPrompt) {
        this._renderSecondaryEffectPrompt(battle);
      }
      return;
    }

    if (pendingFor === by && prompt) {
      if (prompt.type === "ROLL_RESIST" && !this._currentPrompt) {
        this._renderResistPrompt(battle, prompt);
      } else if (prompt.type === "CONFIRM_HIT_RANK" && !this._currentPrompt) {
        this._renderRankPrompt(battle, prompt);
      } else if (prompt.type === "REROLL" && !this._currentReroll) {
        this._renderRerollToast(battle, prompt);
      }
    } else if (pendingFor && pendingFor !== by) {
      this._closePrompt();
      this._closeReroll();
    }
  }

  // Novo prompt que aparece para o Atacante ativar efeitos secundários
  _renderSecondaryEffectPrompt(battle) {
    const tId = safeStr(battle.target_id);
    const pieces = this.getPieces() || [];
    const targetPiece = pieces.find(p => safeStr(p.id) === tId);
    if (!targetPiece) return;

    const pos = this._pieceScreenPos(targetPiece);
    const el = document.createElement("div");
    el.className = "ac-prompt";
    const cpos = this._clampPos(pos.x + 40, pos.y - 30, 260, 150);
    el.style.left = `${cpos.x}px`;
    el.style.top = `${cpos.y}px`;

    el.innerHTML = `
      <div class="ac-prompt-title">⚡ Efeito Secundário?</div>
      <div style="font-size:11px;color:rgba(148,163,184,.7);margin-bottom:8px">Ative se o seu ataque causar também envenenar, paralisar, etc.</div>
      <div class="ac-prompt-grid">
        <button class="ac-prompt-btn ac-special" id="ac-sec-yes">⚡ Ativar Efeito</button>
        <button class="ac-prompt-btn" id="ac-sec-no">Encerrar</button>
      </div>
    `;

    this._overlayRoot.appendChild(el);
    this._currentPrompt = el;

    el.querySelector("#ac-sec-yes").addEventListener("click", async () => {
      // IMPORTANTE: feche o prompt ANTES de escrever no Firestore.
      // Caso contrário, o snapshot pode chegar enquanto _currentPrompt ainda existe,
      // e a UI não renderiza o próximo passo (CONFIRM_HIT_RANK).
      el.querySelector("#ac-sec-yes").disabled = true;
      const ref = this._battleRef(); if (!ref) return;

      this._closePrompt();

      await this._writeBattle({
        status: "hit_confirmed",
        pendingFor: this.getBy(),
        prompt: { type: "CONFIRM_HIT_RANK" },
        logs: arrayUnion("⚡ Efeito secundário ativado — defina o rank do efeito.")
      });

      // Força um repaint local imediato caso o próximo snapshot demore
      // (ou caso o snapshot anterior tenha sido consumido com o prompt aberto).
      this.render();
    });
      this._closePrompt();
    });

    el.querySelector("#ac-sec-no").addEventListener("click", () => {
      this._closePrompt();
      const ref = this._battleRef();
      if (ref) this._writeBattle({ target_id: "" });
    });
  }

  _renderResistPrompt(battle, prompt) {
    this._closePrompt();
    this._clearPendingFloats();

    const tPid = safeStr(battle.target_pid);
    const tOwner = safeStr(battle.target_owner);
    const tId = safeStr(battle.target_id);
    const pieces = this.getPieces() || [];
    const targetPiece = pieces.find(p => safeStr(p.id) === tId);

    const dc = safeInt(prompt.options?.dc);
    const isEffect = !!prompt.options?.isEffect;
    const isAoe = !!prompt.options?.isAoe;

    const pos = targetPiece ? this._pieceScreenPos(targetPiece) : { x: 200, y: 200 };
    const el = document.createElement("div");
    el.className = "ac-prompt";
    const cpos = this._clampPos(pos.x + 40, pos.y - 30, 260, 250);
    el.style.left = `${cpos.x}px`;
    el.style.top = `${cpos.y}px`;

    el.innerHTML = `
      <div class="ac-prompt-title">🛡️ Resistir ao ataque!</div>
      <div class="ac-prompt-dc">CD ${dc} ${isEffect ? "(Efeito)" : "(Dano)"}${isAoe ? " — Área" : ""}</div>
      <div style="font-size:11px;color:rgba(148,163,184,.7);margin-bottom:8px">${isAoe ? "Dodge obrigatório da área:" : "Escolha a resistência:"}</div>
      <div class="ac-prompt-grid">
        <button class="ac-prompt-btn" data-def="dodge">Dodge</button>
        ${isAoe ? "" : `
        <button class="ac-prompt-btn" data-def="parry">Parry</button>
        <button class="ac-prompt-btn" data-def="fort">Fort</button>
        <button class="ac-prompt-btn" data-def="will">Will</button>
        <button class="ac-prompt-btn ac-wide" data-def="thg">THG (Toughness)</button>
        `}
      </div>
    `;

    this._overlayRoot.appendChild(el);
    this._currentPrompt = el;

    el.querySelectorAll("[data-def]").forEach(btn => {
      btn.addEventListener("click", async () => {
        el.querySelectorAll("[data-def]").forEach(b => { b.disabled = true; b.style.opacity = "0.4"; });
        btn.textContent = "⏳ Rolando...";

        const defType = btn.dataset.def;
        const by = this.getBy();
        const tStats = this._getEffectiveStats(by, tPid);
        const statVal = safeInt(tStats[defType]);

        const roll = d20Roll();
        this._publishRoll(roll, `Defesa • ${defType.toUpperCase()}`);
        const checkTotal = roll + statVal;

        if (isAoe) {
          const baseRank = safeInt(battle.dmg_base);
          let finalRank, msg;
          if (checkTotal >= dc) {
            finalRank = Math.max(1, Math.floor(baseRank / 2));
            msg = `Sucesso no Dodge! (${checkTotal} vs ${dc}). Rank: ${baseRank}→${finalRank}`;
          } else {
            finalRank = baseRank;
            msg = `Falha no Dodge! (${checkTotal} vs ${dc}). Rank total: ${finalRank}`;
          }

          if (targetPiece) this._showFloat(targetPiece, `🛡️ ${msg}`, "resist");

          const isEff = !!battle.is_effect;
          const newDc = (isEff ? 10 : 15) + finalRank + safeInt(battle.crit_bonus);

          await this._writeBattle({
            status: "waiting_defense",
            dmg_base: finalRank,
            pendingFor: by,
            prompt: { type: "ROLL_RESIST", options: { dc: newDc, isEffect: isEff, isAoe: false } },
            logs: arrayUnion(`${msg}. Agora escolha como resistir (CD ${newDc}).`),
          });
          this._closePrompt();
        } else {
          const diff = dc - checkTotal;
          let barsLost, resMsg;
          if (diff <= 0) {
            barsLost = 0;
            resMsg = "SUCESSO! Nenhum dano.";
          } else {
            barsLost = Math.ceil(diff / 5);
            resMsg = `FALHA por ${diff} — ${barsLost} barra(s)`;
          }

          let finalMsg = `🛡️ ${roll}+${statVal}=${checkTotal} (${defType.toUpperCase()}) vs CD ${dc}. ${resMsg}`;

          if (targetPiece) {
            this._showFloat(targetPiece, `🛡️ ${checkTotal} vs ${dc} — ${barsLost > 0 ? "FALHA" : "SUCESSO"}`, "resist");
            if (barsLost > 0) {
              setTimeout(() => {
                if (targetPiece) this._showFloat(targetPiece, `−${barsLost} barra(s)`, "stage");
              }, 600);
            }
          }

          await this._writeBattle({
            status: "idle",
            pendingFor: null,
            prompt: null,
            logs: arrayUnion(finalMsg),
          });
          this._closePrompt();
        }
      });
    });
  }

  _renderRankPrompt(battle, prompt) {
    this._closePrompt();

    const tId = safeStr(battle.target_id);
    const pieces = this.getPieces() || [];
    const targetPiece = pieces.find(p => safeStr(p.id) === tId);

    const atk = battle.attack_move;
    const moveDmg = atk?.damage || 0;
    
    // Breakdown de como o Dano final foi gerado
    let breakdownHtml = "";
    if (atk && atk.rank != null) {
      const parts = [];
      parts.push(`R${atk.rank} base`);
      if (atk.stat_value) parts.push(`+${atk.stat_value} ${atk.based_stat || ""}`);
      if (atk.stab_bonus) parts.push(`+${atk.stab_bonus} STAB`);
      if (atk.type_bonus && atk.type_bonus !== 0) parts.push(`${atk.type_bonus > 0 ? '+' : ''}${atk.type_bonus} tipo`);
      const critBonus = safeInt(battle.crit_bonus);
      if (critBonus) parts.push(`+${critBonus} crit`);
      breakdownHtml = `<div style="font-size:10px;color:rgba(56,189,248,.8);margin:4px 0 6px">${escHtml(parts.join(" "))}</div>`;
    }

    const pos = targetPiece ? this._pieceScreenPos(targetPiece) : { x: 200, y: 200 };
    const el = document.createElement("div");
    el.className = "ac-prompt";
    const cpos = this._clampPos(pos.x + 40, pos.y - 30, 260, 210);
    el.style.left = `${cpos.x}px`;
    el.style.top = `${cpos.y}px`;

    el.innerHTML = `
      <div class="ac-prompt-title">✅ Acerto Confirmado!</div>
      <div style="margin-bottom:8px">
        <label style="font-size:11px;color:rgba(148,163,184,.7)">Rank do Dano / Efeito</label>
        ${breakdownHtml}
        <input class="ac-search" id="ac-rank-input" type="number" value="${safeInt(moveDmg)}" min="0" style="margin-top:2px" />
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
        <input type="checkbox" id="ac-rank-effect" />
        <label for="ac-rank-effect" style="font-size:12px;font-weight:700;color:rgba(226,232,240,.85)">É efeito? (Affliction)</label>
      </div>
      <button class="ac-prompt-btn ac-wide" id="ac-rank-confirm">Confirmar Rank</button>
    `;

    this._overlayRoot.appendChild(el);
    this._currentPrompt = el;

    el.querySelector("#ac-rank-confirm").addEventListener("click", async () => {
      const btn = el.querySelector("#ac-rank-confirm");
      btn.disabled = true; btn.textContent = "⏳...";

      const dmg = safeInt(el.querySelector("#ac-rank-input").value);
      const isEff = el.querySelector("#ac-rank-effect").checked;
      const tOwner = safeStr(battle.target_owner);
      const baseVal = isEff ? 10 : 15;
      const dcTotal = baseVal + dmg + safeInt(battle.crit_bonus);

      await this._writeBattle({
        status: "waiting_defense",
        dmg_base: dmg,
        is_effect: isEff,
        pendingFor: tOwner,
        prompt: { type: "ROLL_RESIST", options: { dc: dcTotal, isEffect: isEff } },
        logs: arrayUnion(`Rank/Dano: ${dmg} (${isEff ? "Efeito" : "Dano"}). CD ${dcTotal}. Aguardando resistência...`),
      });
      this._closePrompt();
    });
  }

  _renderRerollToast(battle, prompt) {
    this._closeReroll();

    const el = document.createElement("div");
    el.className = "ac-reroll-toast";
    el.innerHTML = `
      <span class="ac-reroll-text">🎲 Deseja usar Re-roll?</span>
      <button class="ac-reroll-btn ac-primary" id="ac-reroll-yes">Rerollar (R)</button>
      <button class="ac-reroll-btn" id="ac-reroll-no">Manter (Enter)</button>
      <div class="ac-reroll-timer"><div class="ac-reroll-timer-bar" id="ac-reroll-bar" style="width:100%"></div></div>
    `;

    this._overlayRoot.appendChild(el);
    this._currentReroll = el;

    const TIMEOUT = 8000;
    const start = Date.now();
    this._rerollInterval = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.max(0, 1 - elapsed / TIMEOUT) * 100;
      const bar = el.querySelector("#ac-reroll-bar");
      if (bar) bar.style.width = `${pct}%`;
      if (elapsed >= TIMEOUT) {
        this._keepRoll();
      }
    }, 50);

    el.querySelector("#ac-reroll-yes").addEventListener("click", () => this._doReroll());
    el.querySelector("#ac-reroll-no").addEventListener("click", () => this._keepRoll());
  }

  async _doReroll() {
    this._closeReroll();
    const battle = this.getBattle();
    if (!battle) return;

    const roll = d20Roll();
    this._publishRoll(roll, "Re-roll");

    const atkMod = safeInt(battle.atk_mod);
    const aceiroBonus = safeInt(battle.aceiro_bonus);
    const totalAtk = atkMod + aceiroBonus + roll;
    const needed = safeInt(battle.needed);
    
    let hit, critBonus;
    if (roll === 1) { hit = false; critBonus = 0; }
    else if (roll === 20) { hit = true; critBonus = 5; }
    else { hit = totalAtk >= needed; critBonus = 0; }

    const tId = safeStr(battle.target_id);
    const pieces = this.getPieces() || [];
    const targetPiece = pieces.find(p => safeStr(p.id) === tId);

    const atkModStr = (aceiroBonus !== 0) ? `${atkMod}+${aceiroBonus}` : `${atkMod}`;
    const rollText = `Re-roll d20=${roll}+${atkModStr}=${totalAtk} vs DEF ${needed}`;
    
    if (hit) {
      if (targetPiece) this._showFloat(targetPiece, `🔄 ACERTOU ✅ (${rollText})`, critBonus ? "crit" : "hit");
      const damage = safeInt(battle.dmg_base) || safeInt(battle.attack_move?.damage);
      const dcTotal = 15 + damage + critBonus;

      await this._writeBattle({
        status: "waiting_defense",
        d20: roll, total_atk: totalAtk, crit_bonus: critBonus,
        pendingFor: safeStr(battle.target_owner),
        prompt: { type: "ROLL_RESIST", options: { dc: dcTotal, isEffect: false } },
        logs: arrayUnion(`Re-roll: ${roll}+${atkModStr}=${totalAtk} vs ${needed}. ACERTOU!`),
      });
    } else {
      if (targetPiece) this._showFloat(targetPiece, `🔄 ERROU ❌ (${rollText})`, "miss");
      await this._writeBattle({
        status: "idle",
        d20: roll, total_atk: totalAtk, crit_bonus: 0,
        pendingFor: null, prompt: null,
        logs: arrayUnion(`Re-roll: ${roll}+${atkModStr}=${totalAtk} vs ${needed}. ERROU!`),
      });
    }
  }

  async _keepRoll() {
    this._closeReroll();
  }

  _updateTimeline(battle) {
    const status = safeStr(battle.status);
    if (status === "idle") {
      if (this._timeline) { this._timeline.remove(); this._timeline = null; }
      return;
    }

    if (!this._timeline) {
      this._timeline = document.createElement("div");
      this._timeline.className = "ac-timeline";
      this._overlayRoot.appendChild(this._timeline);
    }

    const steps = [
      { label: "Golpe", done: ["setup", "hit_confirmed", "waiting_defense", "missed", "aoe_defense"].includes(status) },
      { label: "Ataque", done: ["hit_confirmed", "waiting_defense", "missed", "aoe_defense"].includes(status) },
      { label: "Resistência", done: false, active: status === "waiting_defense" || status === "aoe_defense" },
      { label: "Resultado", done: false },
    ];

    this._timeline.innerHTML = steps.map((s, i) => {
      const cls = s.done ? "ac-tl-done" : s.active ? "ac-tl-active" : "";
      const arrow = i < steps.length - 1 ? `<span class="ac-tl-arrow">→</span>` : "";
      return `<span class="ac-tl-step ${cls}">${s.done ? "✅" : s.active ? "⏳" : "○"} ${s.label}</span>${arrow}`;
    }).join("");
  }

  async _writeBattle(updates) {
    const db = this.getDb();
    const rid = this.getRid();
    if (!db || !rid) return;
    const ref = doc(db, "rooms", rid, "public_state", "battle");

    const hasFieldValue = Object.values(updates).some(v =>
      v != null && typeof v === "object" && typeof v.isEqual === "function"
    );

    if (hasFieldValue) {
      try {
        const snap = await getDoc(ref);
        const current = snap.exists() ? snap.data() : {};
        const nextRev = (safeInt(current.rev) || 0) + 1;
        await updateDoc(ref, { ...updates, rev: nextRev });
      } catch (err) {
        try { await updateDoc(ref, updates); } catch (err2) {}
      }
    } else {
      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          const current = snap.exists() ? snap.data() : {};
          const nextRev = (safeInt(current.rev) || 0) + 1;
          tx.set(ref, { ...current, ...updates, rev: nextRev });
        });
      } catch (err) {
        try { await setDoc(ref, updates, { merge: true }); } catch (err2) {}
      }
    }
  }

  _closeOverlay() {
    if (this._currentOverlay) {
      try { this._currentOverlay.remove(); } catch {}
      this._currentOverlay = null;
    }
    this._closeRadial();
  }

  _closeRadial() {
    if (this._currentRadial) {
      try { this._currentRadial.remove(); } catch {}
      this._currentRadial = null;
    }
  }

  _closePrompt() {
    if (this._currentPrompt) {
      try { this._currentPrompt.remove(); } catch {}
      this._currentPrompt = null;
    }
  }

  _closeContext() {
    if (this._currentContext) {
      try { this._currentContext.remove(); } catch {}
      this._currentContext = null;
    }
  }

  _closeReroll() {
    if (this._rerollInterval) { clearInterval(this._rerollInterval); this._rerollInterval = null; }
    if (this._currentReroll) {
      try { this._currentReroll.remove(); } catch {}
      this._currentReroll = null;
    }
  }

  _closeAll() {
    this._closeOverlay();
    this._closeRadial();
    this._closePrompt();
    this._closeContext();
    this._closeReroll();
  }

  destroy() {
    this._closeAll();
    this._clearPendingFloats();
    this.stopListening();
    if (this._overlayRoot) {
      try { this._overlayRoot.remove(); } catch {}
    }
    if (this._timeline) {
      try { this._timeline.remove(); } catch {}
    }
  }
}