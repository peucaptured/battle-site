/**
 * panels-patch.js — Enhanced Side Panels for battle-site
 * 
 * Transforms the team/opponent columns into anime-style Pokémon layouts with:
 * - HP bars (6 bars, color-coded green/yellow/red)
 * - Status conditions with icons
 * - Damage flash animations
 * - Pokémon borders (selected, moving, placing, fainted)
 * - Avatar section with trainer info
 * - Support for up to 4 players
 * - "No campo" vs "Mochila" badges
 * - Responsive layout that collapses gracefully
 *
 * INSTALL: add <script type="module" src="./panels-patch.js"></script>
 * after main.js in index.html. Does NOT modify main.js.
 */

// ─── Helpers ─────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function safeStr(x) { return (x == null ? "" : String(x)).trim(); }
function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, "&quot;"); }

// ─── Inject styles ONCE ──────────────────────────────────────────────
let _stylesInjected = false;
function injectPanelStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const style = document.createElement("style");
  style.id = "panels-patch-css";
  style.textContent = `
/* ═══════════════════════════════════════════════════════════
   PANELS PATCH — Pokémon Battle Style Enhanced Panels
   ═══════════════════════════════════════════════════════════ */

/* Team Panel header */
.pp-team-header {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(56,189,248,.12) 0%, rgba(168,85,247,.08) 100%);
  border: 1px solid rgba(56,189,248,.25);
}
.pp-team-header .pp-icon { font-size: 18px; }
.pp-team-header .pp-label {
  font-weight: 900; font-size: 13px; letter-spacing: .3px;
  color: rgba(226,232,240,.95);
}
.pp-team-header .pp-count {
  margin-left: auto;
  font-size: 11px; font-weight: 800;
  padding: 3px 8px; border-radius: 8px;
  background: rgba(56,189,248,.15);
  border: 1px solid rgba(56,189,248,.3);
  color: rgba(56,189,248,.9);
}

/* Avatar card */
.pp-avatar-card {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px;
  border-radius: 16px;
  border: 1px solid rgba(148,163,184,.22);
  background: rgba(2,6,23,.25);
  margin-bottom: 10px;
}
.pp-avatar-img {
  width: 48px; height: 48px;
  border-radius: 14px;
  border: 2px solid rgba(56,189,248,.35);
  background: rgba(255,255,255,.05);
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; font-weight: 900;
  box-shadow: 0 6px 18px rgba(2,6,23,.35);
  overflow: hidden;
  flex: 0 0 48px;
}
.pp-avatar-img img {
  width: 100%; height: 100%; object-fit: cover;
}
.pp-avatar-info { flex: 1; min-width: 0; }
.pp-avatar-name {
  font-weight: 900; font-size: 13px; line-height: 1.2;
  color: rgba(226,232,240,.95);
}
.pp-avatar-role {
  font-size: 11px; color: rgba(148,163,184,.8);
  margin-top: 2px;
}
.pp-avatar-place-btn {
  appearance: none; border: 1px solid rgba(168,85,247,.4);
  background: linear-gradient(180deg, rgba(168,85,247,.25) 0%, rgba(168,85,247,.12) 100%);
  color: rgba(168,85,247,.95);
  border-radius: 10px;
  padding: 6px 10px;
  font-size: 11px; font-weight: 800;
  cursor: pointer;
  transition: all .15s;
}
.pp-avatar-place-btn:hover {
  background: linear-gradient(180deg, rgba(168,85,247,.35) 0%, rgba(168,85,247,.2) 100%);
  transform: translateY(-1px);
}

/* ─── Pokémon Card ─── */
.pp-mon-card {
  border-radius: 16px;
  border: 1.5px solid rgba(148,163,184,.2);
  background: rgba(2,6,23,.2);
  padding: 10px 12px;
  margin-bottom: 8px;
  transition: all .2s ease;
  cursor: pointer;
  position: relative;
  overflow: hidden;
}
.pp-mon-card::before {
  content: "";
  position: absolute; inset: 0;
  border-radius: 16px;
  opacity: 0;
  transition: opacity .2s;
  pointer-events: none;
}
.pp-mon-card:hover {
  border-color: rgba(148,163,184,.35);
  background: rgba(2,6,23,.3);
  transform: translateY(-1px);
  box-shadow: 0 8px 20px rgba(2,6,23,.3);
}

/* States */
.pp-mon-card.pp-selected {
  border: 2px solid rgba(56,189,248,.55);
  background: radial-gradient(600px 250px at 10% 0%, rgba(56,189,248,.12), transparent 60%),
              rgba(2,6,23,.25);
}
.pp-mon-card.pp-moving {
  border: 2px solid rgba(255,204,0,.6);
  animation: ppPulseYellow 1.5s ease-in-out infinite;
}
.pp-mon-card.pp-placing {
  border: 2px solid rgba(56,189,248,.6);
  animation: ppPulseBlue 1.5s ease-in-out infinite;
}
.pp-mon-card.pp-fainted {
  opacity: .5;
  filter: grayscale(.6);
}
.pp-mon-card.pp-fainted .pp-mon-sprite {
  filter: grayscale(1) brightness(.7);
}

@keyframes ppPulseYellow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255,204,0,.25); }
  50% { box-shadow: 0 0 0 6px rgba(255,204,0,0); }
}
@keyframes ppPulseBlue {
  0%, 100% { box-shadow: 0 0 0 0 rgba(56,189,248,.25); }
  50% { box-shadow: 0 0 0 6px rgba(56,189,248,0); }
}

/* Damage flash */
.pp-mon-card.pp-damage-flash {
  animation: ppDamageFlash .5s ease-out;
}
@keyframes ppDamageFlash {
  0% { background: rgba(248,113,113,.3); }
  100% { background: rgba(2,6,23,.2); }
}

/* Card layout */
.pp-mon-row {
  display: flex; align-items: flex-start; gap: 10px;
}
.pp-mon-sprite-wrap {
  flex: 0 0 50px;
  position: relative;
}
.pp-mon-sprite {
  width: 50px; height: 50px;
  image-rendering: pixelated;
  object-fit: contain;
  border-radius: 12px;
  border: 1px solid rgba(226,232,240,.15);
  background: rgba(255,255,255,.03);
  padding: 3px;
  transition: filter .3s;
}
.pp-mon-loc-badge {
  position: absolute;
  bottom: -2px; right: -4px;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 6px;
  font-weight: 800;
  border: 1px solid;
  line-height: 1.3;
}
.pp-loc-field {
  background: rgba(34,197,94,.18);
  border-color: rgba(34,197,94,.4);
  color: rgba(34,197,94,.95);
}
.pp-loc-bag {
  background: rgba(148,163,184,.12);
  border-color: rgba(148,163,184,.3);
  color: rgba(148,163,184,.8);
}

.pp-mon-info {
  flex: 1; min-width: 0;
}
.pp-mon-name {
  font-weight: 900; font-size: 12.5px; line-height: 1.2;
  color: rgba(226,232,240,.95);
  display: flex; align-items: center; gap: 6px;
}
.pp-mon-name .pp-ext-badge {
  font-size: 9px; font-weight: 800;
  padding: 1px 5px; border-radius: 5px;
  background: rgba(168,85,247,.15);
  border: 1px solid rgba(168,85,247,.3);
  color: rgba(168,85,247,.8);
}
.pp-mon-sub {
  font-size: 10.5px; color: rgba(148,163,184,.7);
  margin-top: 2px;
}

/* HP Bar */
.pp-hp-wrap {
  margin-top: 6px;
  display: flex; align-items: center; gap: 6px;
}
.pp-hp-icon {
  font-size: 11px;
  flex: 0 0 auto;
}
.pp-hp-bars {
  display: flex; gap: 2.5px;
  flex: 1;
}
.pp-hp-bar {
  flex: 1;
  height: 7px;
  border-radius: 4px;
  transition: all .3s ease;
}
.pp-hp-bar.pp-hp-full {
  background: linear-gradient(180deg, rgba(34,197,94,.7) 0%, rgba(34,197,94,.5) 100%);
  border: 1px solid rgba(34,197,94,.35);
  box-shadow: 0 0 4px rgba(34,197,94,.15);
}
.pp-hp-bar.pp-hp-warn {
  background: linear-gradient(180deg, rgba(251,191,36,.7) 0%, rgba(251,191,36,.5) 100%);
  border: 1px solid rgba(251,191,36,.35);
  box-shadow: 0 0 4px rgba(251,191,36,.15);
}
.pp-hp-bar.pp-hp-crit {
  background: linear-gradient(180deg, rgba(248,113,113,.7) 0%, rgba(248,113,113,.5) 100%);
  border: 1px solid rgba(248,113,113,.35);
  box-shadow: 0 0 4px rgba(248,113,113,.15);
  animation: ppHpPulse 1.8s ease-in-out infinite;
}
.pp-hp-bar.pp-hp-empty {
  background: rgba(30,30,40,.4);
  border: 1px solid rgba(148,163,184,.12);
}

@keyframes ppHpPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .6; }
}

.pp-hp-label {
  font-size: 10.5px; font-weight: 800;
  color: rgba(226,232,240,.7);
  flex: 0 0 auto;
  min-width: 28px;
  text-align: right;
}

/* Status conditions */
.pp-status-row {
  display: flex; gap: 4px; flex-wrap: wrap;
  margin-top: 4px;
}
.pp-status-pill {
  font-size: 9.5px; font-weight: 800;
  padding: 2px 6px; border-radius: 6px;
  background: rgba(248,113,113,.12);
  border: 1px solid rgba(248,113,113,.3);
  color: rgba(248,113,113,.85);
}
.pp-status-none {
  font-size: 9.5px;
  color: rgba(148,163,184,.5);
  margin-top: 4px;
}

/* Action buttons row */
.pp-actions {
  display: flex; gap: 6px; margin-top: 8px;
  flex-wrap: wrap;
}
.pp-act-btn {
  appearance: none;
  border: 1px solid rgba(148,163,184,.22);
  background: rgba(2,6,23,.3);
  color: rgba(226,232,240,.85);
  border-radius: 10px;
  padding: 5px 10px;
  font-size: 11px; font-weight: 800;
  cursor: pointer;
  transition: all .15s;
}
.pp-act-btn:hover {
  background: rgba(56,189,248,.12);
  border-color: rgba(56,189,248,.35);
  transform: translateY(-1px);
}
.pp-act-btn:disabled {
  opacity: .35; cursor: default;
  transform: none !important;
}
.pp-act-btn.pp-act-danger:hover:not(:disabled) {
  background: rgba(248,113,113,.12);
  border-color: rgba(248,113,113,.35);
}

/* HP Control (only for own team) */
.pp-hp-controls {
  display: flex; align-items: center; gap: 4px;
  margin-top: 6px;
}
.pp-hp-ctrl-btn {
  appearance: none;
  width: 26px; height: 26px;
  border-radius: 8px;
  border: 1px solid rgba(148,163,184,.25);
  background: rgba(2,6,23,.3);
  color: rgba(226,232,240,.85);
  font-size: 14px; font-weight: 900;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all .15s;
  padding: 0;
}
.pp-hp-ctrl-btn:hover {
  background: rgba(56,189,248,.12);
  border-color: rgba(56,189,248,.35);
}
.pp-hp-ctrl-btn.pp-minus:hover {
  background: rgba(248,113,113,.12);
  border-color: rgba(248,113,113,.35);
}
.pp-hp-slider {
  flex: 1;
  accent-color: #38bdf8;
  height: 4px;
}

/* Damage message */
.pp-damage-msg {
  margin-top: 5px;
  padding: 5px 10px;
  border-radius: 10px;
  font-size: 11px; font-weight: 800;
  animation: ppFadeSlide .4s ease-out;
}
.pp-damage-msg.pp-dmg-hurt {
  background: rgba(248,113,113,.12);
  border: 1px solid rgba(248,113,113,.3);
  color: rgba(248,113,113,.9);
}
.pp-damage-msg.pp-dmg-heal {
  background: rgba(34,197,94,.12);
  border: 1px solid rgba(34,197,94,.3);
  color: rgba(34,197,94,.9);
}
@keyframes ppFadeSlide {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Opponent section */
.pp-opp-group {
  margin-bottom: 10px;
}
.pp-opp-group-header {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  border-radius: 12px;
  background: rgba(248,113,113,.06);
  border: 1px solid rgba(248,113,113,.15);
  margin-bottom: 8px;
  cursor: pointer;
  transition: all .15s;
}
.pp-opp-group-header:hover {
  background: rgba(248,113,113,.1);
}
.pp-opp-group-header .pp-opp-icon { font-size: 14px; }
.pp-opp-group-header .pp-opp-name {
  font-weight: 900; font-size: 12px;
  color: rgba(226,232,240,.9);
  flex: 1;
}
.pp-opp-group-header .pp-opp-count {
  font-size: 10px; font-weight: 800;
  padding: 2px 7px; border-radius: 6px;
  background: rgba(248,113,113,.12);
  border: 1px solid rgba(248,113,113,.25);
  color: rgba(248,113,113,.8);
}
.pp-opp-collapse-icon {
  font-size: 10px; color: rgba(148,163,184,.6);
  transition: transform .2s;
}
.pp-opp-group.pp-collapsed .pp-opp-collapse-icon {
  transform: rotate(-90deg);
}
.pp-opp-group.pp-collapsed .pp-opp-body {
  display: none;
}

/* Unknown pokemon (opponent hidden) */
.pp-mon-card.pp-hidden {
  opacity: .7;
}
.pp-mon-card.pp-hidden .pp-mon-sprite {
  filter: brightness(.5) contrast(.8);
}

/* Fainted text overlay */
.pp-fainted-overlay {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%) rotate(-8deg);
  font-weight: 900;
  font-size: 14px;
  color: rgba(248,113,113,.7);
  text-shadow: 0 2px 8px rgba(0,0,0,.5);
  letter-spacing: 2px;
  pointer-events: none;
}

/* Condition select */
.pp-cond-select {
  width: 100%;
  padding: 6px 8px;
  border-radius: 10px;
  border: 1px solid rgba(148,163,184,.22);
  background: rgba(0,0,0,.25);
  color: rgba(226,232,240,.85);
  font-size: 11px;
  margin-top: 6px;
  outline: none;
}
.pp-cond-select:focus {
  border-color: rgba(56,189,248,.45);
}

/* Scrollbar in panels */
.panel-inner::-webkit-scrollbar { width: 5px; }
.panel-inner::-webkit-scrollbar-track { background: transparent; }
.panel-inner::-webkit-scrollbar-thumb {
  background: rgba(148,163,184,.2);
  border-radius: 10px;
}
.panel-inner::-webkit-scrollbar-thumb:hover { background: rgba(148,163,184,.35); }
  `;
  document.head.appendChild(style);
}

// ─── State tracking for damage messages ─────────────────────────────
const _prevHpMap = new Map(); // key: "{owner}:{pid}" -> hp
const _damageMessages = new Map(); // key -> { text, type, timeout }

function trackHpChange(owner, pid, newHp) {
  const key = `${owner}:${pid}`;
  const prev = _prevHpMap.get(key);
  _prevHpMap.set(key, newHp);
  
  if (prev == null) return null; // First time seeing this Pokémon
  if (prev === newHp) return null;
  
  const diff = newHp - prev;
  const msg = diff < 0 ? `−${Math.abs(diff)} HP` : `+${diff} HP`;
  const type = diff < 0 ? "hurt" : "heal";
  
  // Clear previous timeout
  const existing = _damageMessages.get(key);
  if (existing?.timeout) clearTimeout(existing.timeout);
  
  // Set damage message that auto-clears after 3 seconds
  const timeout = setTimeout(() => _damageMessages.delete(key), 3000);
  _damageMessages.set(key, { text: msg, type, timeout });
  
  return { text: msg, type };
}

// ─── Collapsed groups tracking ──────────────────────────────────────
const _collapsedGroups = new Set();

// ─── HP icon helper ─────────────────────────────────────────────────
function hpIcon(hp) {
  if (hp >= 5) return "💚";
  if (hp >= 3) return "🟡";
  if (hp >= 1) return "🔴";
  return "💀";
}

function hpBarClass(hp, idx) {
  if (idx >= hp) return "pp-hp-empty";
  if (hp >= 5) return "pp-hp-full";
  if (hp >= 3) return "pp-hp-warn";
  return "pp-hp-crit";
}

// ─── Get party_states data ──────────────────────────────────────────
function getPartyStateData() {
  // Try the global appState or _partyStates from sheets
  try {
    if (window._partyStates && Object.keys(window._partyStates).length) return window._partyStates;
  } catch {}
  // Fallback: try appState.partyStates
  try {
    if (window.appState?.partyStates && Object.keys(window.appState.partyStates).length) return window.appState.partyStates;
  } catch {}
  return {};
}

function getPokemonState(ownerName, pid) {
  const ps = getPartyStateData();
  const userDict = ps[ownerName] || {};
  const data = userDict[String(pid)] || {};
  return {
    hp: data.hp != null ? Number(data.hp) : 6,
    cond: Array.isArray(data.cond) ? data.cond : [],
    stats: data.stats || {},
    shiny: !!data.shiny,
    form: data.form || null,
  };
}

// ─── Sprite URL helpers (reuse from main.js) ────────────────────────
function getSpriteUrl(pid) {
  const k = safeStr(pid);
  if (!k) return "";
  // Try dexMap
  try {
    if (window.dexMap) {
      const name = window.dexMap[k] || window.dexMap[String(Number(k))];
      if (name) {
        const slug = name.toLowerCase()
          .replace(/[♀]/g, "f").replace(/[♂]/g, "m")
          .replace(/[''‛′'`\.]/g, "")
          .replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
        return `https://img.pokemondb.net/sprites/home/normal/${slug}.png`;
      }
    }
  } catch {}
  // EXT: prefix
  if (k.startsWith("EXT:")) {
    const name = k.slice(4).trim();
    if (!name) return "";
    const slug = name.toLowerCase()
      .replace(/[♀]/g, "f").replace(/[♂]/g, "m")
      .replace(/[''‛′'`\.]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    return `https://img.pokemondb.net/sprites/home/normal/${slug}.png`;
  }
  // Numeric -> PokeAPI
  if (/^\d+$/.test(k)) {
    const n = Number(k);
    if (n > 0 && n < 20000) return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${n}.png`;
  }
  return "";
}

function getDisplayName(pid) {
  const k = safeStr(pid);
  if (!k) return "???";
  try {
    if (window.dexMap) {
      const name = window.dexMap[k] || window.dexMap[String(Number(k))];
      if (name) return name;
    }
  } catch {}
  if (k.startsWith("EXT:")) return k.slice(4).trim() || "???";
  return k;
}

// ─── Build HP bars HTML ─────────────────────────────────────────────
function renderHpBarsHtml(hp, maxHp = 6) {
  let bars = "";
  for (let i = 0; i < maxHp; i++) {
    bars += `<div class="pp-hp-bar ${hpBarClass(hp, i)}"></div>`;
  }
  return `
    <div class="pp-hp-wrap">
      <span class="pp-hp-icon">${hpIcon(hp)}</span>
      <div class="pp-hp-bars">${bars}</div>
      <span class="pp-hp-label">${hp}/${maxHp}</span>
    </div>
  `;
}

// ─── Build status conditions HTML ───────────────────────────────────
function renderConditionsHtml(cond) {
  if (!cond || !cond.length) {
    return `<div class="pp-status-none">Sem status negativos.</div>`;
  }
  return `<div class="pp-status-row">${cond.map(c => `<span class="pp-status-pill">${escapeHtml(c)}</span>`).join("")}</div>`;
}

// ─── Build a single Pokémon card ────────────────────────────────────
function buildMonCard(pid, ownerName, options = {}) {
  const {
    isMine = false,
    isOnMap = false,
    isSelected = false,
    isMoving = false,
    isPlacing = false,
    pieceId = null,
    revealed = true,
    piece = null,
  } = options;

  const state = getPokemonState(ownerName, pid);
  const hp = state.hp;
  const cond = state.cond;
  const isFainted = hp <= 0;
  
  // Track HP changes for damage messages
  const dmgInfo = trackHpChange(ownerName, pid, hp);
  const dmgKey = `${ownerName}:${pid}`;
  const dmgMsg = _damageMessages.get(dmgKey);

  const displayName = getDisplayName(pid);
  const spriteUrl = getSpriteUrl(pid);
  const isExt = safeStr(pid).startsWith("EXT:");

  // Card classes
  let cardClasses = "pp-mon-card";
  if (isSelected) cardClasses += " pp-selected";
  if (isMoving) cardClasses += " pp-moving";
  if (isPlacing) cardClasses += " pp-placing";
  if (isFainted) cardClasses += " pp-fainted";
  if (!revealed && !isMine) cardClasses += " pp-hidden";
  if (dmgInfo) cardClasses += " pp-damage-flash";

  const locBadge = isOnMap
    ? `<span class="pp-mon-loc-badge pp-loc-field">⚔️</span>`
    : `<span class="pp-mon-loc-badge pp-loc-bag">🎒</span>`;

  const spriteHtml = spriteUrl
    ? `<img class="pp-mon-sprite" src="${escapeAttr(spriteUrl)}" alt="${escapeAttr(displayName)}" loading="lazy" onerror="this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'"/>`
    : `<div class="pp-mon-sprite" style="display:flex;align-items:center;justify-content:center;font-size:22px;">❓</div>`;

  const nameDisplay = revealed || isMine
    ? `${escapeHtml(displayName)}${isExt ? `<span class="pp-ext-badge">EXT</span>` : ""}`
    : "???";

  const subDisplay = revealed || isMine
    ? `PID ${escapeHtml(safeStr(pid))} • ${isOnMap ? "No campo" : "Mochila"}`
    : (isOnMap ? "No campo" : "Mochila");

  // HP controls (only for own team)
  let hpControlsHtml = "";
  if (isMine) {
    hpControlsHtml = `
      <div class="pp-hp-controls">
        <button class="pp-hp-ctrl-btn pp-minus" data-act="hp-down" title="−1 HP">−</button>
        <input type="range" class="pp-hp-slider" min="0" max="6" value="${hp}" data-act="hp-slider" />
        <button class="pp-hp-ctrl-btn" data-act="hp-up" title="+1 HP">+</button>
      </div>
    `;
  }

  // Damage message
  let dmgHtml = "";
  if (dmgMsg) {
    const cls = dmgMsg.type === "hurt" ? "pp-dmg-hurt" : "pp-dmg-heal";
    dmgHtml = `<div class="pp-damage-msg ${cls}">${escapeHtml(dmgMsg.text)}</div>`;
  }

  // Action buttons (only for own team)
  let actionsHtml = "";
  if (isMine) {
    actionsHtml = `
      <div class="pp-actions">
        <button class="pp-act-btn" data-act="select" title="Selecionar no mapa">🎯 Selecionar</button>
        <button class="pp-act-btn" data-act="toggle" ${isOnMap ? "" : "disabled"} title="Revelar/Ocultar">👁️</button>
        <button class="pp-act-btn pp-act-danger" data-act="remove" ${isOnMap ? "" : "disabled"} title="Retirar do campo">❌</button>
      </div>
    `;
  }

  // Fainted overlay
  const faintedOverlay = isFainted ? `<div class="pp-fainted-overlay">FAINTED</div>` : "";

  const card = document.createElement("div");
  card.className = cardClasses;
  card.dataset.pid = pid;
  card.dataset.owner = ownerName;
  if (pieceId) card.dataset.pieceId = pieceId;

  card.innerHTML = `
    ${faintedOverlay}
    <div class="pp-mon-row">
      <div class="pp-mon-sprite-wrap">
        ${spriteHtml}
        ${locBadge}
      </div>
      <div class="pp-mon-info">
        <div class="pp-mon-name">${nameDisplay}</div>
        <div class="pp-mon-sub">${subDisplay}</div>
        ${renderHpBarsHtml(hp)}
        ${renderConditionsHtml(cond)}
        ${dmgHtml}
      </div>
    </div>
    ${hpControlsHtml}
    ${actionsHtml}
  `;

  // ── Event listeners ──
  // Click to select on map
  card.addEventListener("click", (ev) => {
    if (ev.target.closest("button") || ev.target.closest("input")) return;
    if (pieceId && typeof window.selectPiece === "function") {
      window.selectPiece(pieceId);
    }
  });

  // Action buttons
  card.querySelector('[data-act="select"]')?.addEventListener("click", () => {
    if (pieceId && typeof window.selectPiece === "function") {
      window.selectPiece(pieceId);
    }
  });

  card.querySelector('[data-act="toggle"]')?.addEventListener("click", () => {
    if (pieceId && typeof window.togglePieceRevealed === "function") {
      window.togglePieceRevealed(pieceId);
    }
  });

  card.querySelector('[data-act="remove"]')?.addEventListener("click", () => {
    if (pieceId && typeof window.removePieceFromBoard === "function") {
      window.removePieceFromBoard(pieceId);
    }
  });

  // HP controls
  const hpDown = card.querySelector('[data-act="hp-down"]');
  const hpUp = card.querySelector('[data-act="hp-up"]');
  const hpSlider = card.querySelector('[data-act="hp-slider"]');

  function updateHpFirestore(newHp) {
    newHp = Math.max(0, Math.min(6, newHp));
    try {
      const db = window._combatDb || window.currentDb;
      const rid = window.currentRid || window.appState?.rid;
      if (!db || !rid) return;
      
      // Import needed
      import("https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js").then(({ doc, setDoc }) => {
        const ref = doc(db, "rooms", rid, "public_state", "party_states");
        const key = `${ownerName}.${pid}`;
        const data = {};
        data[key + ".hp"] = newHp;
        data["last_update"] = new Date().toISOString();
        setDoc(ref, data, { merge: true });
      });
    } catch (err) {
      console.error("[panels-patch] HP update failed:", err);
    }
  }

  hpDown?.addEventListener("click", (e) => {
    e.stopPropagation();
    updateHpFirestore(hp - 1);
  });
  hpUp?.addEventListener("click", (e) => {
    e.stopPropagation();
    updateHpFirestore(hp + 1);
  });
  hpSlider?.addEventListener("input", (e) => {
    e.stopPropagation();
    updateHpFirestore(Number(e.target.value));
  });

  return card;
}

// ─── Render "My Team" panel ─────────────────────────────────────────
function renderMyTeam(teamRoot, by, pieces, myParty) {
  teamRoot.innerHTML = "";

  // Header
  const header = document.createElement("div");
  header.className = "pp-team-header";
  const total = myParty.length;
  const onField = myParty.filter(it => {
    const pid = safeStr(it?.pid || it);
    return pieces.some(p => safeStr(p?.owner) === by && safeStr(p?.pid) === pid);
  }).length;
  header.innerHTML = `
    <span class="pp-icon">🎒</span>
    <span class="pp-label">Sua Equipe</span>
    <span class="pp-count">${onField}/${total}</span>
  `;
  teamRoot.appendChild(header);

  // Avatar card
  const avatarCard = document.createElement("div");
  avatarCard.className = "pp-avatar-card";
  const initial = by ? by.charAt(0).toUpperCase() : "?";
  const role = safeStr(window.appState?.role) || "—";
  avatarCard.innerHTML = `
    <div class="pp-avatar-img">${initial}</div>
    <div class="pp-avatar-info">
      <div class="pp-avatar-name">🟡 ${escapeHtml(by || "—")}</div>
      <div class="pp-avatar-role">${escapeHtml(role)}</div>
    </div>
  `;
  teamRoot.appendChild(avatarCard);

  // Pokémon cards
  if (!myParty.length) {
    const empty = document.createElement("div");
    empty.className = "card";
    empty.innerHTML = `<div class="muted">Equipe vazia. Conecte-se à sala para ver suas peças.</div>`;
    teamRoot.appendChild(empty);
    return;
  }

  for (const it of myParty) {
    const pid = safeStr(it?.pid || it?.pokemon?.id || it);
    if (!pid) continue;

    // Find piece on board for this pid/owner
    const piece = pieces.find(p => safeStr(p?.owner) === by && safeStr(p?.pid) === pid);
    const isOnMap = !!piece?.id && safeStr(piece?.status || "active") !== "deleted";
    const isSelected = piece?.id && safeStr(window.appState?.selectedPieceId) === safeStr(piece.id);

    const card = buildMonCard(pid, by, {
      isMine: true,
      isOnMap,
      isSelected,
      pieceId: piece?.id || null,
      revealed: piece ? !!piece.revealed : true,
      piece,
    });
    teamRoot.appendChild(card);
  }
}

// ─── Render "Opponents" panel ───────────────────────────────────────
function renderOpponents(oppRoot, by, pieces) {
  oppRoot.innerHTML = "";

  // Filter opponent pieces (visible ones)
  const oppPieces = pieces.filter(p => {
    const owner = safeStr(p?.owner);
    return owner && owner !== by && safeStr(p?.status || "active") !== "deleted";
  });

  // Also gather opponent parties from players list
  const players = window.appState?.players || [];
  const oppPlayers = players.filter(p => safeStr(p?.trainer_name) !== by);

  // Group by owner
  const grouped = new Map();

  // First, add all opponent players (even if they have no pieces on board)
  for (const player of oppPlayers) {
    const name = safeStr(player?.trainer_name);
    if (!name) continue;
    if (!grouped.has(name)) grouped.set(name, { pieces: [], party: [] });
    // Try to get their party
    try {
      const partyFn = window.getPartyForTrainer || (() => []);
      const party = partyFn(name);
      grouped.get(name).party = Array.isArray(party) ? party : [];
    } catch {}
  }

  // Then add pieces
  for (const p of oppPieces) {
    const owner = safeStr(p?.owner) || "???";
    if (!grouped.has(owner)) grouped.set(owner, { pieces: [], party: [] });
    grouped.get(owner).pieces.push(p);
  }

  // Update opponent count badge
  const oppCount = $("opp_count");
  if (oppCount) oppCount.textContent = String(grouped.size);

  if (!grouped.size) {
    const empty = document.createElement("div");
    empty.className = "card";
    empty.innerHTML = `<div class="muted">Nenhum oponente na sala.</div>`;
    oppRoot.appendChild(empty);
    return;
  }

  for (const [ownerName, data] of grouped) {
    const group = document.createElement("div");
    group.className = `pp-opp-group${_collapsedGroups.has(ownerName) ? " pp-collapsed" : ""}`;

    const piecesOnBoard = data.pieces;
    const party = data.party;

    // Use party if available, otherwise just show pieces on board
    const displayList = party.length ? party : piecesOnBoard.map(p => ({ pid: safeStr(p?.pid) }));
    const totalCount = displayList.length;

    // Header
    const headerEl = document.createElement("div");
    headerEl.className = "pp-opp-group-header";
    headerEl.innerHTML = `
      <span class="pp-opp-icon">🔴</span>
      <span class="pp-opp-name">${escapeHtml(ownerName)}</span>
      <span class="pp-opp-count">${totalCount}</span>
      <span class="pp-opp-collapse-icon">▼</span>
    `;
    headerEl.addEventListener("click", () => {
      if (_collapsedGroups.has(ownerName)) {
        _collapsedGroups.delete(ownerName);
      } else {
        _collapsedGroups.add(ownerName);
      }
      group.classList.toggle("pp-collapsed");
    });
    group.appendChild(headerEl);

    // Body
    const body = document.createElement("div");
    body.className = "pp-opp-body";

    // Avatar card for opponent
    const oppAvatar = document.createElement("div");
    oppAvatar.className = "pp-avatar-card";
    oppAvatar.innerHTML = `
      <div class="pp-avatar-img" style="border-color: rgba(248,113,113,.35);">${ownerName.charAt(0).toUpperCase()}</div>
      <div class="pp-avatar-info">
        <div class="pp-avatar-name">🔴 ${escapeHtml(ownerName)}</div>
        <div class="pp-avatar-role">Oponente</div>
      </div>
    `;
    body.appendChild(oppAvatar);

    for (const it of displayList) {
      const pid = safeStr(it?.pid || it?.pokemon?.id || it);
      if (!pid) continue;

      // Find piece on board
      const piece = piecesOnBoard.find(p => safeStr(p?.pid) === pid);
      const isOnMap = !!piece?.id && safeStr(piece?.status || "active") !== "deleted";
      // Visibility check
      const isRevealed = piece ? !!piece.revealed : false;
      const seenPids = window.appState?.seenPids || (window.appState?.state?.seen || []);
      const isSeen = seenPids.includes(pid) || seenPids.includes(String(pid));

      const card = buildMonCard(pid, ownerName, {
        isMine: false,
        isOnMap,
        revealed: isRevealed || isSeen,
        pieceId: piece?.id || null,
        piece,
      });
      body.appendChild(card);
    }

    group.appendChild(body);
    oppRoot.appendChild(group);
  }
}

// ─── Main render function ───────────────────────────────────────────
function renderEnhancedPanels() {
  injectPanelStyles();

  const by = safeStr(window.appState?.by);
  const pieces = Array.isArray(window.appState?.pieces) ? window.appState.pieces : [];
  const connected = !!window.appState?.connected;

  // LEFT (My Team)
  const teamRoot = $("team_list");
  if (teamRoot) {
    if (!connected) {
      teamRoot.innerHTML = `<div class="card"><div class="muted">Conecte numa sala para ver suas peças.</div></div>`;
    } else {
      let myParty = [];
      try {
        const fn = window.getPartyForTrainer;
        if (fn) myParty = fn(by) || [];
      } catch {}
      // Fallback: use pieces on board
      if (!myParty.length) {
        const myPieces = pieces.filter(p => safeStr(p?.owner) === by && safeStr(p?.status || "active") !== "deleted");
        myParty = myPieces.map(p => ({ pid: safeStr(p?.pid) }));
      }
      renderMyTeam(teamRoot, by, pieces, myParty);
    }
  }

  // RIGHT (Opponents)
  const oppRoot = $("opp_list");
  if (oppRoot) {
    if (!connected) {
      oppRoot.innerHTML = `<div class="card"><div class="muted">Conecte para ver oponentes.</div></div>`;
    } else {
      renderOpponents(oppRoot, by, pieces);
    }
  }
}

// ─── Monkey-patch updateSidePanels ──────────────────────────────────
function patchSidePanels() {
  // Wait for main.js to define updateSidePanels, then override it
  const origFn = window.updateSidePanels;
  
  window.updateSidePanels = function() {
    // Call original first (it may update appState fields we need)
    try { if (origFn) origFn.call(this); } catch {}
    // Then render our enhanced version on top
    renderEnhancedPanels();
  };
  
  console.log("%c[panels-patch]", "color:#a78bfa;font-weight:bold", "✅ updateSidePanels patched");
}

// ─── Listen for party_states changes (for HP/conditions) ────────────
let _partyStatesUnsub = null;

async function listenPartyStates() {
  const check = () => {
    const db = window._combatDb || window.currentDb;
    const rid = window.currentRid || window.appState?.rid;
    return { db, rid };
  };

  // Retry loop
  const { db, rid } = check();
  if (!db || !rid) {
    // Retry in 2s
    setTimeout(listenPartyStates, 2000);
    return;
  }

  try {
    if (_partyStatesUnsub) _partyStatesUnsub();
  } catch {}

  try {
    const { doc, onSnapshot } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js");
    const psRef = doc(db, "rooms", rid, "public_state", "party_states");
    _partyStatesUnsub = onSnapshot(psRef, (snap) => {
      const data = snap.exists() ? snap.data() : {};
      window._partyStates = data;
      // Also update appState if it exists
      if (window.appState) window.appState.partyStates = data;
      // Re-render panels
      renderEnhancedPanels();
    }, (err) => {
      console.warn("[panels-patch] party_states listen error:", err);
    });
    console.log("%c[panels-patch]", "color:#a78bfa;font-weight:bold", "📡 Listening party_states for HP/conditions");
  } catch (err) {
    console.error("[panels-patch] Failed to listen party_states:", err);
    setTimeout(listenPartyStates, 3000);
  }
}

// ─── Init ────────────────────────────────────────────────────────────
function init() {
  injectPanelStyles();
  
  // Wait for main.js to be ready
  const waitForApp = () => {
    if (window.appState && typeof window.updateSidePanels === "function") {
      patchSidePanels();
      listenPartyStates();
      // Initial render
      renderEnhancedPanels();
      console.log("%c[panels-patch]", "color:#a78bfa;font-weight:bold", "🎨 Enhanced panels initialized");
    } else {
      setTimeout(waitForApp, 300);
    }
  };
  waitForApp();
}

// Auto-init when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
