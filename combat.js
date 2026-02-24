/**
 * combat.js — Calculadora de Combate (battle-site)
 *
 * Replica TODA a aba ⚔️ Combate do app.py (Streamlit) em JS puro.
 *
 * Fases do combate (state machine via public_state/battle.status):
 *   idle → setup → (rolar ataque normal | lançar área)
 *        → hit_confirmed → waiting_defense → resultado (idle)
 *        → missed → idle
 *        → aoe_defense → waiting_defense → resultado (idle)
 *
 * Dados consumidos:
 *   - public_state/battle   (estado do combate — já escutado pelo main.js)
 *   - public_state/state    (peças no tabuleiro)
 *   - public_state/party_states  (stats dos pokémon de cada treinador)
 *   - trainers/{name}/sheets     (fichas com golpes, advantages, etc.)
 *
 * Escrita:
 *   - Escreve DIRETAMENTE em public_state/battle (igual o Streamlit faz)
 *     porque o battle doc É a state machine compartilhada.
 */

import {
  doc,
  setDoc,
  updateDoc,
  addDoc,
  collection,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getMoveType, getTypeColor, getTypeDamageBonus, getSuperEffectiveAgainst, getTypeAdvantage, normalizeType } from "./type-data.js";

// ─── helpers ────────────────────────────────────────────────────────
function safeStr(x) { return (x == null ? "" : String(x)).trim(); }
function safeInt(x, fallback = 0) { const n = parseInt(x, 10); return Number.isFinite(n) ? n : fallback; }
function safeDocId(name) {
  const s = safeStr(name) || "user";
  return s.replace(/[^a-zA-Z0-9_\-\.]/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "user";
}
function d20Roll() { return Math.floor(Math.random() * 20) + 1; }
function escHtml(s) {
  const d = document.createElement("div"); d.textContent = s; return d.innerHTML;
}

function parseBarsLost(logLine) {
  const txt = safeStr(logLine);
  if (!txt) return 0;
  const patterns = [
    /Barras perdidas:\s*(\d+)/i,
    /Perdeu\s*\*\*(\d+)\*\*\s*barras/i,
    /Perdeu\s*(\d+)\s*barras/i,
  ];
  for (const re of patterns) {
    const match = txt.match(re);
    if (match) return safeInt(match[1], 0);
  }
  return 0;
}

function cleanCombatLog(logLine) {
  return safeStr(logLine).replace(/\*\*/g, "");
}

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
    int: safeInt(raw.int ?? raw.intel ?? raw.intelligence),
    dodge: safeInt(raw.dodge),
    parry: safeInt(raw.parry),
    fort: safeInt(raw.fort ?? raw.fortitude),
    will: safeInt(raw.will),
    thg: safeInt(raw.thg ?? raw.toughness),
    cap: safeInt(raw.cap ?? raw.capability),
  };

  // Mantém o mesmo fallback usado no restante do app para não zerar defesa
  if (norm.thg <= 0 && norm.cap > 0) norm.thg = Math.round(norm.cap / 2);
  if (norm.dodge <= 0 && norm.cap > 0 && norm.thg > 0) {
    norm.dodge = Math.max(0, norm.cap - norm.thg);
  }

  // Compatibilidade com caminhos que ainda leem aliases antigos
  norm.fortitude = norm.fort;
  norm.toughness = norm.thg;
  return { ...raw, ...norm };

// ═══════════════════════════════════════════════════════════════════════
// What‑If / Guia visual (LOCAL — não escreve no Firestore)
//   - Portado de combat.reformulado.v2.js e integrado aqui sem alterar
//     a lógica do combate; apenas adiciona um painel auxiliar.
// ═══════════════════════════════════════════════════════════════════════

// Extracts attack roll from canonical fields first, then from logs
function parseAttackRoll(battle) {
  const d20 = safeInt(battle?.d20, NaN);
  if (Number.isFinite(d20) && d20 > 0) return d20;

  const logs = battle?.logs || [];
  for (let i = logs.length - 1; i >= 0; i--) {
    const t = safeStr(logs[i]);
    const m = t.match(/d20\s*=\s*(\d{1,2})/i);
    if (m) return safeInt(m[1], 0);
  }
  return 0;
}

// Extracts defense roll/stat from logs, because arena-combat doesn't store it as fields.
function parseDefenseFromLogs(battle) {
  const logs = battle?.logs || [];
  for (let i = logs.length - 1; i >= 0; i--) {
    const t = safeStr(logs[i]);
    let m = t.match(/🛡️\s*(\d{1,2})\s*\+\s*([+-]?\d+)\s*=\s*(\d+)\s*\(\s*([A-Z]{2,5})\s*\)\s*vs\s*CD\s*(\d+)/i);
    if (m) {
      return {
        roll: safeInt(m[1], 0),
        stat: safeInt(m[2], 0),
        total: safeInt(m[3], 0),
        defType: safeStr(m[4]).toLowerCase(),
        dc: safeInt(m[5], 0),
        source: "log",
        logLine: t,
      };
    }
    m = t.match(/\(\s*(\d+)\s*vs\s*(\d+)\s*\)/i);
    if (m && /dodge/i.test(t)) {
      const total = safeInt(m[1], 0);
      const dc = safeInt(m[2], 0);
      return { roll: 0, stat: 0, total, defType: "dodge", dc, source: "log", logLine: t };
    }
  }
  return { roll: 0, stat: 0, total: 0, defType: "", dc: 0, source: "none", logLine: "" };
}

function statusLabel(st) {
  const s = safeStr(st);
  if (!s || s === "idle") return "Idle";
  const map = {
    setup: "Setup",
    hit_confirmed: "Acerto confirmado (rank)",
    waiting_defense: "Aguardando resistência",
    aoe_defense: "Área (Dodge) → resistência",
    missed: "Errou",
  };
  return map[s] || s;
}

function badgeClassForStatus(st) {
  const s = safeStr(st);
  if (!s || s === "idle") return "ok";
  if (s === "waiting_defense" || s === "hit_confirmed" || s === "aoe_defense") return "warn";
  if (s === "missed") return "err";
  return "";
}

function normalizeDefKey(k) {
  const s = safeStr(k).toLowerCase();
  if (s === "toughness") return "thg";
  if (s === "fortitude") return "fort";
  return s;
}

function cbwPick(obj, keys, fb = undefined) {
  for (const k of keys) {
    if (!obj) break;
    if (Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return fb;
}
function cbwLast(arr) { return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null; }

// What‑If store (localStorage per rid)
function cbwStoreKey(rid) {
  const r = safeStr(rid) || "no_rid";
  return `combat_whatif_v1:${r}`;
}
function cbwLoadOverrides(rid) {
  try {
    const raw = localStorage.getItem(cbwStoreKey(rid));
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch { return {}; }
}
function cbwSaveOverrides(rid, obj) {
  try { localStorage.setItem(cbwStoreKey(rid), JSON.stringify(obj || {})); } catch {}
}

function cbwBuildSnapshot(battle, overrides) {
  overrides = overrides || {};

  const status = safeStr(battle?.status || "idle");
  const attacker = safeStr(battle?.attacker);
  const attackerPid = safeStr(battle?.attacker_pid);
  const targetOwner = safeStr(battle?.target_owner);
  const targetPid = safeStr(battle?.target_pid);

  const atkRoll = parseAttackRoll(battle);
  const atkMod = safeInt(cbwPick(overrides, ["atk_mod"], battle?.atk_mod), 0);
  const aceiroBonus = safeInt(cbwPick(overrides, ["aceiro_bonus", "acerto_bonus"], battle?.aceiro_bonus), 0);
  const defenseVal = safeInt(cbwPick(overrides, ["defense_val"], battle?.defense_val), 0);
  const needed = safeInt(cbwPick(overrides, ["needed"], battle?.needed), (defenseVal + 10));
  const sneakAttack = !!cbwPick(overrides, ["sneak_attack"], battle?.sneak_attack);

  const critBonus = safeInt(cbwPick(overrides, ["crit_bonus"], battle?.crit_bonus), 0);

  const totalAtk = atkRoll + atkMod + aceiroBonus;
  const hit =
    atkRoll === 1 ? false :
    atkRoll === 20 ? true :
    totalAtk >= needed;

  const atkMove = battle?.attack_move || {};
  const moveName = safeStr(atkMove?.name || "");
  const moveType = safeStr(atkMove?.move_type || "");
  const moveRank = safeInt(cbwPick(overrides, ["move_rank", "rank"], atkMove?.rank), safeInt(atkMove?.rank, 0));
  const statVal = safeInt(cbwPick(overrides, ["move_stat_value"], atkMove?.stat_value), safeInt(atkMove?.stat_value, 0));
  const stabBonus = safeInt(cbwPick(overrides, ["stab_bonus"], atkMove?.stab_bonus), safeInt(atkMove?.stab_bonus, 0));
  const typeBonus = safeInt(cbwPick(overrides, ["type_bonus"], atkMove?.type_bonus), safeInt(atkMove?.type_bonus, 0));
  const modDano = safeInt(cbwPick(overrides, ["move_mod_dano", "move_damage_mod"], atkMove?.modDano), 0);

  const dmgBase = safeInt(cbwPick(overrides, ["dmg_base"], battle?.dmg_base), safeInt(battle?.dmg_base, safeInt(atkMove?.damage, 0)));
  const isEffect = !!cbwPick(overrides, ["is_effect"], battle?.is_effect);

  const computedMoveDamage = (moveRank + statVal + stabBonus + typeBonus + modDano);

  const dcBase = isEffect ? 10 : 15;
  const dc = safeInt(cbwPick(overrides, ["dc"], (dcBase + dmgBase + critBonus)), (dcBase + dmgBase + critBonus));

  const d = parseDefenseFromLogs(battle);
  const defType = normalizeDefKey(cbwPick(overrides, ["def_type"], d.defType || ""));
  const defRoll = safeInt(d.roll, 0); // locked (dice)
  const defStat = safeInt(cbwPick(overrides, ["def_stat"], d.stat), safeInt(d.stat, 0));
  const defTotal = (defRoll > 0 || d.source === "log") ? (defRoll + defStat) : safeInt(cbwPick(overrides, ["def_total"], d.total), safeInt(d.total, 0));

  const diff = dc - defTotal;
  const barsLost = diff <= 0 ? 0 : Math.ceil(diff / 5);

  return {
    status, attacker, attackerPid, targetOwner, targetPid,
    attack: { roll: atkRoll, atkMod, aceiroBonus, total: totalAtk, defenseVal, needed, sneakAttack, hit, critBonus },
    move: { name: moveName, moveType, rank: moveRank, statVal, stabBonus, typeBonus, modDano, dmgBase, computedMoveDamage },
    defense: { fromLog: d.source === "log", logLine: d.logLine || "", type: defType, roll: defRoll, stat: defStat, total: defTotal, dcParsed: safeInt(d.dc, 0) },
    dc: { base: dcBase, dc, isEffect },
    outcome: { diff, barsLost },
  };
}

function cbwInjectStylesOnce() {
  const id = "combat-whatif-style";
  if (document.getElementById(id)) return;
  const st = document.createElement("style");
  st.id = id;
  st.textContent = `
/* combat what-if UI */
.cbw-wrap { display:flex; flex-direction:column; gap:10px; }
.cbw-top { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.cbw-title { font-weight:950; letter-spacing:.2px; }
.cbw-sub { font-size:12px; opacity:.72; }
.cbw-badge { display:inline-flex; align-items:center; gap:8px; padding:6px 10px; border-radius:999px; border:1px solid rgba(120,210,255,.18); background:rgba(6,10,22,.55); box-shadow: inset 0 1px 0 rgba(255,255,255,.06), inset 0 -1px 0 rgba(0,0,0,.25); font-weight:850; font-size:12px; white-space:nowrap; user-select:none; }
.cbw-badge.ok { background: rgba(34,197,94,.18); border-color: rgba(34,197,94,.45); }
.cbw-badge.warn { background: rgba(251,191,36,.18); border-color: rgba(251,191,36,.45); }
.cbw-badge.err { background: rgba(248,113,113,.18); border-color: rgba(248,113,113,.45); }
.cbw-card { border-radius: 18px; padding: 14px 14px; background: rgba(12,18,35,.52); border: 1px solid rgba(120, 210, 255, .14); box-shadow: inset 0 1px 0 rgba(255,255,255,.06), inset 0 -1px 0 rgba(0,0,0,.25); }
.cbw-h { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px; }
.cbw-h .t { font-weight:950; }
.cbw-grid { display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
@media (max-width: 820px){ .cbw-grid { grid-template-columns: 1fr; } }
.cbw-row { display:flex; gap:10px; align-items:center; justify-content:space-between; padding:10px; border-radius:14px; background: rgba(2,6,23,.42); border: 1px solid rgba(148,163,184,.14); }
.cbw-row .k { font-size:12px; opacity:.75; font-weight:800; }
.cbw-row .v { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-weight:900; }
.cbw-row .vv { font-weight:900; }
.cbw-in { width: 110px; padding: 8px 10px; border-radius: 12px; border: 1px solid rgba(120,210,255,.18); background: rgba(6,10,22,.55); color: rgba(232,240,255,.92); font-weight:900; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
.cbw-in[disabled] { opacity:.55; }
.cbw-pill { display:inline-flex; align-items:center; gap:8px; padding:6px 10px; border-radius:999px; background: rgba(6,10,22,.55); border: 1px solid rgba(120, 210, 255, .14); font-weight:850; font-size:12px; }
.cbw-muted { opacity:.72; font-size:12px; }
.cbw-hr { height:1px; background: rgba(120,210,255,.12); margin: 10px 0; }
.cbw-btn { cursor:pointer; border: 1px solid rgba(120,210,255,.18); background: rgba(56,189,248,.12); color: rgba(232,240,255,.95); padding: 8px 10px; border-radius: 12px; font-weight:900; }
.cbw-btn.secondary { background: rgba(148,163,184,.08); }
.cbw-btn:active { transform: translateY(1px); }
.cbw-log { white-space: pre-wrap; font-size:12px; opacity:.86; line-height:1.35; }
.cbw-out { font-weight:950; font-size:14px; }
.cbw-ok { color: rgba(34,197,94,1); }
.cbw-warn { color: rgba(251,191,36,1); }
.cbw-bad { color: rgba(248,113,113,1); }
.cbw-foot { display:flex; gap:10px; align-items:center; justify-content:space-between; flex-wrap:wrap; }
.cbw-tiny { font-size:11px; opacity:.65; }
  `;
  document.head.appendChild(st);
}

function cbwFieldInput(label, key, value, { disabled = false, hint = "" } = {}) {
  return `
    <div class="cbw-row">
      <div style="min-width:0">
        <div class="k">${escHtml(label)}</div>
        ${hint ? `<div class="cbw-tiny">${escHtml(hint)}</div>` : ""}
      </div>
      <input class="cbw-in" data-whatif="${escHtml(key)}" type="number" value="${Number.isFinite(Number(value)) ? escHtml(value) : 0}" ${disabled ? "disabled" : ""}/>
    </div>
  `;
}

function cbwBoolToggle(label, key, checked) {
  const id = `cbw_${key}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  return `
    <div class="cbw-row" style="justify-content:flex-start">
      <input id="${escHtml(id)}" type="checkbox" data-whatif-bool="${escHtml(key)}" ${checked ? "checked" : ""} style="transform:scale(1.05)"/>
      <label for="${escHtml(id)}" class="vv" style="cursor:pointer">${escHtml(label)}</label>
    </div>
  `;
}

class CombatWhatIfPanel {
  constructor({ container, getRid, getBy, getBattle } = {}) {
    this._root = container || null;
    this._getRid = getRid || (() => "");
    this._getBy = getBy || (() => "");
    this._getBattle = getBattle || (() => null);
    this._overrides = {};
    this._lastSig = "";
    this._onInputBound = (e) => this._onInput(e);
    this._onClickBound = (e) => this._onClick(e);
    this._listening = false;
  }

  start() {
    if (!this._root || this._listening) return;
    this._root.addEventListener("input", this._onInputBound);
    this._root.addEventListener("change", this._onInputBound);
    this._root.addEventListener("click", this._onClickBound);
    this._listening = true;
  }

  stop() {
    if (!this._root || !this._listening) return;
    this._root.removeEventListener("input", this._onInputBound);
    this._root.removeEventListener("change", this._onInputBound);
    this._root.removeEventListener("click", this._onClickBound);
    this._listening = false;
  }

  _ensureOverrides(rid) {
    if (!rid) { this._overrides = {}; return; }
    const cur = safeStr(this._overrides.__rid);
    if (!cur || cur !== rid) {
      this._overrides = cbwLoadOverrides(rid);
      this._overrides.__rid = rid;
      cbwSaveOverrides(rid, this._overrides);
      this._lastSig = "";
    }
  }

  _onClick(e) {
    const btn = e.target?.closest?.("[data-action]");
    if (!btn) return;
    const act = btn.dataset.action;
    const rid = safeStr(this._getRid());
    if (!rid) return;

    if (act === "reset-whatif") {
      this._overrides = { __rid: rid };
      cbwSaveOverrides(rid, this._overrides);
      this._lastSig = "";
      this.render({ force: true });
      return;
    }

    if (act === "copy-json") {
      const battle = this._getBattle() || {};
      const snap = cbwBuildSnapshot(battle, this._overrides);
      const payload = { overrides: this._overrides, snapshot: snap };
      try {
        navigator.clipboard?.writeText?.(JSON.stringify(payload, null, 2));
        btn.textContent = "✅ Copiado!";
        setTimeout(() => (btn.textContent = "📋 Copiar What‑If"), 1200);
      } catch {
        window.prompt("Copie o JSON:", JSON.stringify(payload, null, 2));
      }
    }
  }

  _onInput(e) {
    const inEl = e.target;
    if (!inEl) return;
    const rid = safeStr(this._getRid());
    if (!rid) return;

    const k = inEl.dataset?.whatif;
    if (k) {
      this._overrides[k] = safeInt(inEl.value, 0);
      cbwSaveOverrides(rid, this._overrides);
      this.render({ force: true });
      return;
    }

    const kb = inEl.dataset?.whatifBool;
    if (kb) {
      this._overrides[kb] = !!inEl.checked;
      cbwSaveOverrides(rid, this._overrides);
      this.render({ force: true });
      return;
    }
  }

  render({ battle = null, isPlayer = null, by = null, force = false } = {}) {
    cbwInjectStylesOnce();

    const root = this._root;
    if (!root) return;

    const rid = safeStr(this._getRid());
    this._ensureOverrides(rid);

    const b = battle || this._getBattle();
    const who = (by != null ? by : this._getBy());

    const sig = JSON.stringify({
      rid,
      who,
      battle: b ? {
        status: b.status,
        attacker: b.attacker,
        attacker_pid: b.attacker_pid,
        target_owner: b.target_owner,
        target_pid: b.target_pid,
        atk_mod: b.atk_mod,
        aceiro_bonus: b.aceiro_bonus,
        defense_val: b.defense_val,
        needed: b.needed,
        d20: b.d20,
        crit_bonus: b.crit_bonus,
        dmg_base: b.dmg_base,
        is_effect: b.is_effect,
        attack_move: b.attack_move ? {
          name: b.attack_move.name,
          move_type: b.attack_move.move_type,
          rank: b.attack_move.rank,
          stat_value: b.attack_move.stat_value,
          stab_bonus: b.attack_move.stab_bonus,
          type_bonus: b.attack_move.type_bonus,
          damage: b.attack_move.damage,
        } : null,
        logsLast: cbwLast(b.logs || []),
        logsLen: Array.isArray(b.logs) ? b.logs.length : 0,
      } : null,
      overrides: this._overrides,
    });

    if (!force && sig === this._lastSig) return;
    this._lastSig = sig;

    if (!rid) {
      root.innerHTML = `
        <div class="cbw-wrap">
          <div class="cbw-card">
            <div class="cbw-title">⚔️ Combate (Guia Visual)</div>
            <div class="cbw-muted" style="margin-top:6px">Conecte em uma sala (RID) para ver o combate.</div>
          </div>
        </div>
      `;
      return;
    }

    if (!b) {
      root.innerHTML = `
        <div class="cbw-wrap">
          <div class="cbw-card">
            <div class="cbw-top">
              <div>
                <div class="cbw-title">⚔️ Combate (Guia Visual)</div>
                <div class="cbw-sub">RID: <span class="vv">${escHtml(rid)}</span> • por: <span class="vv">${escHtml(who || "—")}</span></div>
              </div>
              <div class="cbw-badge ok">Sem dados de battle</div>
            </div>
            <div class="cbw-muted" style="margin-top:10px">Nenhum combate ativo. Quando um ataque ocorrer no mapa, esta seção vai detalhar a rolagem e permitir What‑If.</div>
          </div>
        </div>
      `;
      return;
    }

    const snap = cbwBuildSnapshot(b, this._overrides);
    const status = snap.status;
    const badgeCls = badgeClassForStatus(status);
    const atk = snap.attack;
    const mv = snap.move;
    const df = snap.defense;
    const dc = snap.dc;
    const out = snap.outcome;

    const hitTxt = atk.hit ? `ACERTOU ✅` : `ERROU ❌`;
    const critTxt = atk.roll === 20 ? `CRÍTICO (d20=20) +${atk.critBonus}` : (atk.critBonus ? `crit +${atk.critBonus}` : "sem crítico");
    const resTxt = (df.total <= 0 && status !== "idle") ? "—" : (out.barsLost <= 0 ? "SUCESSO ✅ (0 barras)" : `FALHA ❌ (${out.barsLost} barra${out.barsLost === 1 ? "" : "s"})`);
    const resCls = (df.total <= 0) ? "" : (out.barsLost <= 0 ? "cbw-ok" : "cbw-bad");

    const lastLog = safeStr(cbwLast(b.logs || []) || "");
    const moveTypeNote = mv.moveType ? `Tipo: ${mv.moveType}` : "Tipo: —";

    const computedWarn = (mv.computedMoveDamage && mv.computedMoveDamage !== safeInt(b?.attack_move?.damage, mv.computedMoveDamage))
      ? `<div class="cbw-tiny">⚠️ Dano do golpe no battle (${safeInt(b?.attack_move?.damage, 0)}) difere do breakdown (${mv.computedMoveDamage}). No What‑If você pode ajustar as peças.</div>`
      : "";

    root.innerHTML = `
      <div class="cbw-wrap">
        <div class="cbw-card">
          <div class="cbw-top">
            <div>
              <div class="cbw-title">🔎 Guia Visual + What‑If (local)</div>
              <div class="cbw-sub">RID: <span class="vv">${escHtml(rid)}</span> • você: <span class="vv">${escHtml(who || "—")}</span></div>
              <div class="cbw-sub" style="margin-top:4px">Etapa: <span class="vv">${escHtml(statusLabel(status))}</span></div>
            </div>
            <div class="cbw-badge ${badgeCls}">${escHtml(statusLabel(status))}</div>
          </div>

          <div class="cbw-hr"></div>

          <div class="cbw-grid">
            <div class="cbw-card" style="padding:12px">
              <div class="cbw-h"><div class="t">🎯 Ataque</div><div class="cbw-pill">${escHtml(hitTxt)}</div></div>
              ${cbwFieldInput("atk_mod (do golpe)", "atk_mod", atk.atkMod)}
              ${cbwFieldInput("bônus de acerto (party_states)", "aceiro_bonus", atk.aceiroBonus, { hint: "campo aceiro_bonus do battle" })}
              ${cbwFieldInput("defesa alvo (Dodge/Parry)", "defense_val", atk.defenseVal, { hint: "usado para needed = defesa+10 (se não sobrescrever)" })}
              ${cbwFieldInput("needed (DEF+10)", "needed", atk.needed, { hint: "pode sobrescrever o cálculo padrão" })}
              ${cbwFieldInput("crit_bonus", "crit_bonus", atk.critBonus, { hint: "d20=20 normalmente dá +5" })}
              ${cbwBoolToggle("Furtivo (def/2)", "sneak_attack", atk.sneakAttack)}
              <div class="cbw-row">
                <div>
                  <div class="k">d20 do ataque (fixo)</div>
                  <div class="cbw-tiny">resultado do dado — não editável</div>
                </div>
                <input class="cbw-in" disabled value="${escHtml(atk.roll)}"/>
              </div>
              <div class="cbw-row">
                <div class="k">Total ataque</div>
                <div class="v">${escHtml(atk.roll)} + ${escHtml(atk.atkMod)} + ${escHtml(atk.aceiroBonus)} = ${escHtml(atk.total)}</div>
              </div>
              <div class="cbw-row">
                <div class="k">Comparação</div>
                <div class="v">${escHtml(atk.total)} vs ${escHtml(atk.needed)} → <span class="${atk.hit ? "cbw-ok" : "cbw-bad"}">${escHtml(hitTxt)}</span></div>
              </div>
              <div class="cbw-tiny" style="margin-top:8px">${escHtml(critTxt)}</div>
            </div>

            <div class="cbw-card" style="padding:12px">
              <div class="cbw-h"><div class="t">💥 Dano / CD</div><div class="cbw-pill">${escHtml(moveTypeNote)}</div></div>

              <div class="cbw-row">
                <div style="min-width:0">
                  <div class="k">Golpe</div>
                  <div class="cbw-tiny">${escHtml(mv.name || "—")}</div>
                </div>
                <div class="v">${escHtml(mv.name ? "ok" : "—")}</div>
              </div>

              ${cbwFieldInput("rank base (do golpe)", "move_rank", mv.rank)}
              ${cbwFieldInput("stat_value (Stgr/Int)", "move_stat_value", mv.statVal)}
              ${cbwFieldInput("STAB (+2)", "stab_bonus", mv.stabBonus)}
              ${cbwFieldInput("bônus de tipo (+2/-2/...)", "type_bonus", mv.typeBonus)}
              ${cbwFieldInput("mod extra de dano (opcional)", "move_mod_dano", mv.modDano)}
              <div class="cbw-row">
                <div class="k">Dano calculado (breakdown)</div>
                <div class="v">${escHtml(mv.rank)} + ${escHtml(mv.statVal)} + ${escHtml(mv.stabBonus)} + ${escHtml(mv.typeBonus)} + ${escHtml(mv.modDano)} = ${escHtml(mv.computedMoveDamage)}</div>
              </div>
              ${computedWarn}

              <div class="cbw-hr"></div>

              ${cbwFieldInput("dmg_base usado na CD", "dmg_base", mv.dmgBase, { hint: "rank final confirmado (pode ser diferente do breakdown)" })}
              ${cbwBoolToggle("É efeito? (CD base 10)", "is_effect", dc.isEffect)}
              ${cbwFieldInput("CD total (pode sobrescrever)", "dc", dc.dc, { hint: `base ${dc.base} + dmg_base ${mv.dmgBase} + crit ${atk.critBonus}` })}

              <div class="cbw-row">
                <div class="k">CD (derivada)</div>
                <div class="v">${escHtml(dc.base)} + ${escHtml(mv.dmgBase)} + ${escHtml(atk.critBonus)} = ${escHtml(dc.base + mv.dmgBase + atk.critBonus)}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="cbw-card">
          <div class="cbw-h">
            <div class="t">🛡️ Resistência (What‑If)</div>
            <div class="cbw-pill">${df.fromLog ? "extraído do log" : "sem log de defesa ainda"}</div>
          </div>

          <div class="cbw-grid">
            <div>
              <div class="cbw-row">
                <div>
                  <div class="k">d20 da resistência (fixo)</div>
                  <div class="cbw-tiny">não editável (quando existe no log)</div>
                </div>
                <input class="cbw-in" disabled value="${escHtml(df.roll)}"/>
              </div>

              ${cbwFieldInput("stat usado na resistência", "def_stat", df.stat, { hint: "ex.: THG/Dodge/Fort etc." })}
              <div class="cbw-row">
                <div class="k">Total resistência</div>
                <div class="v">${escHtml(df.roll)} + ${escHtml(df.stat)} = ${escHtml(df.roll + df.stat)}</div>
              </div>

              <div class="cbw-row">
                <div class="k">Comparação</div>
                <div class="v">${escHtml(df.total)} vs CD ${escHtml(dc.dc)} → <span class="${resCls}">${escHtml(resTxt)}</span></div>
              </div>

              <div class="cbw-row">
                <div class="k">Diferença</div>
                <div class="v">CD ${escHtml(dc.dc)} − ${escHtml(df.total)} = ${escHtml(out.diff)} → barras = ${escHtml(out.barsLost)}</div>
              </div>
            </div>

            <div>
              <div class="cbw-row">
                <div class="k">Atacante</div>
                <div class="v">${escHtml(snap.attacker || "—")} <span class="cbw-muted">${escHtml(snap.attackerPid ? `(${snap.attackerPid})` : "")}</span></div>
              </div>
              <div class="cbw-row">
                <div class="k">Alvo</div>
                <div class="v">${escHtml(snap.targetOwner || "—")} <span class="cbw-muted">${escHtml(snap.targetPid ? `(${snap.targetPid})` : "")}</span></div>
              </div>
              <div class="cbw-row">
                <div class="k">Último log</div>
                <div class="v">${escHtml(lastLog ? "ok" : "—")}</div>
              </div>
              <div class="cbw-card" style="padding:12px;margin-top:10px">
                <div class="cbw-muted" style="font-weight:900;margin-bottom:6px">Log (última linha)</div>
                <div class="cbw-log">${escHtml(lastLog || "—")}</div>
              </div>
              ${df.logLine ? `
                <div class="cbw-card" style="padding:12px;margin-top:10px">
                  <div class="cbw-muted" style="font-weight:900;margin-bottom:6px">Log de resistência usado</div>
                  <div class="cbw-log">${escHtml(df.logLine)}</div>
                </div>
              ` : ""}
            </div>
          </div>

          <div class="cbw-hr"></div>

          <div class="cbw-foot">
            <div class="cbw-tiny">🔒 O What‑If é local (não escreve no Firestore). Para “regras oficiais”, use os botões do mapa (arena-combat).</div>
            <div style="display:flex;gap:10px;align-items:center">
              <button class="cbw-btn secondary" data-action="reset-whatif">↩ Reset What‑If</button>
              <button class="cbw-btn" data-action="copy-json">📋 Copiar What‑If</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

}

// ─── _move_stat_value (replica do app.py) ───────────────────────────
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
  stats = normalizeStats(stats);
  if (based === "Int") return [based, safeInt(stats["int"])];
  if (based === "Stgr") return [based, safeInt(stats.stgr)];
  return [based, 0];
}

// ─── Sprite helper ──────────────────────────────────────────────────
function spriteUrl(pid, opts) {
  // opts: { type: "battle"|"art", shiny: bool }
  if (typeof window.getSpriteUrlFromPid === "function") {
    return safeStr(window.getSpriteUrlFromPid(pid, opts));
  }
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

// ═══════════════════════════════════════════════════════════════════════
// CombatUI — classe que gerencia toda a aba de combate
// ═══════════════════════════════════════════════════════════════════════
export class CombatUI {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.container  — div#tab_combat .panel-inner
   * @param {function} opts.getDb        — () => Firestore db (ou null)
   * @param {function} opts.getRid       — () => room id string
   * @param {function} opts.getBy        — () => trainer name
   * @param {function} opts.getRole      — () => "owner"|"challenger"|"spectator"
   * @param {function} opts.getBattle    — () => appState.battle object
   * @param {function} opts.getPieces    — () => appState.pieces array
   * @param {function} opts.getPlayers   — () => appState.players arrayf
   */
  constructor(opts) {
    this.container = opts.container;
    this.getDb = opts.getDb;
    this.getRid = opts.getRid;
    this.getBy = opts.getBy;
    this.getRole = opts.getRole;
    this.getBattle = opts.getBattle;
    this.getPieces = opts.getPieces;
    this.getPlayers = opts.getPlayers;

    // caches
    this._partyStates = {};    // { trainerName: { pid: { stats, ... } } }
    this._sheets = new Map();  // trainerName → [ {pokemon, stats, moves, ...} ]
    this._sheetsMap = new Map(); // trainerName → Map<pid, sheet>
    this._partyStatesUnsub = null;
    this._sheetUnsubs = new Map(); // trainerName -> unsubscribe fn

    // build static shell
    this._buildShell();
    this.startListening();

    // What‑If painel (local)
    this._whatifPanel = new CombatWhatIfPanel({
      container: this.container.querySelector('#combat_whatif_panel'),
      getRid: this.getRid,
      getBy: this.getBy,
      getBattle: this.getBattle,
    });
    this._whatifPanel.start();
	
  }

  // ─── Firestore refs ───────────────────────────────────────────────
  _battleRef() {
    const db = this.getDb(); const rid = this.getRid();
    if (!db) { console.warn("[CombatUI] _battleRef: db é null!"); return null; }
    if (!rid) { console.warn("[CombatUI] _battleRef: rid é null/vazio!"); return null; }
    return doc(db, "rooms", rid, "public_state", "battle");
  }

  _partyStatesRef() {
    const db = this.getDb(); const rid = this.getRid();
    if (!db || !rid) return null;
    return doc(db, "rooms", rid, "public_state", "party_states");
  }

  async _publishRoll(value, label = "d20") {
    const db = this.getDb();
    const rid = this.getRid();
    const by = safeStr(this.getBy()) || "—";
    if (!db || !rid) return;
    try {
      await addDoc(collection(db, "rooms", rid, "rolls"), {
        by,
        value: safeInt(value, 0),
        label: safeStr(label) || "d20",
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn("[CombatUI] falha ao publicar rolagem no HUD:", err);
    }
  }

  // ─── Listen to party_states ───────────────────────────────────────
  startListening() {
    this.stopListening();
    const ref = this._partyStatesRef();
    if (!ref) return;
    this._partyStatesUnsub = onSnapshot(ref, (snap) => {
      this._partyStates = snap.exists() ? (snap.data() || {}) : {};
      // Pré-carrega fichas de todos os trainers que aparecerem no party_states
      const data = snap.exists() ? snap.data() : {};
      for (const trainerName of Object.keys(data || {})) {
        if (trainerName && !this._sheetUnsubs.has(trainerName)) {
          this._loadSheets(trainerName);
        }
      }
    }, () => {});

    // Pré-carrega fichas dos jogadores já conhecidos via appState.players
    setTimeout(() => {
      const players = window.appState?.players || [];
      for (const pl of players) {
        const name = safeStr(pl?.trainer_name);
        if (name && !this._sheetUnsubs.has(name)) this._loadSheets(name);
      }
    }, 500);
  }

  stopListening() {
    try { this._whatifPanel?.stop?.(); } catch {}
    if (this._partyStatesUnsub) { try { this._partyStatesUnsub(); } catch {} }
    this._partyStatesUnsub = null;
    for (const [trainerName, unsub] of this._sheetUnsubs.entries()) {
      try { unsub(); } catch {}
      this._sheetUnsubs.delete(trainerName);
    }
  }

  // ─── Load sheets for a trainer ────────────────────────────────────
  async _loadSheets(trainerName, forceReload = false) {
    if (!trainerName) return;
    if (!forceReload && this._sheetUnsubs.has(trainerName)) return;
    const db = this.getDb();
    if (!db) return;
    if (forceReload && this._sheetUnsubs.has(trainerName)) {
      try { this._sheetUnsubs.get(trainerName)?.(); } catch {}
      this._sheetUnsubs.delete(trainerName);
    }
    const tid = safeDocId(trainerName);
    try {
      const colRef = collection(db, "trainers", tid, "sheets");
      const q = query(colRef, orderBy("updated_at", "desc"), limit(200));

      const unsub = onSnapshot(q, (snap) => {
        const sheets = [];
        const map = new Map();

        // snap já vem do mais recente → mais antigo
        snap.forEach((d) => {
          const s = d.data() || {};
          s._sheet_id = d.id;
          sheets.push(s);

          const pid = safeStr(s.pokemon?.id);
          const lpid = safeStr(s.linked_pid);

          // ✅ FIRST WINS: não sobrescreve chave já mapeada (mantém a ficha mais recente)
          if (pid && !map.has(pid)) map.set(pid, s);
          if (pid && /^\d+$/.test(pid)) {
            const num = String(Number(pid));
            if (!map.has(num)) map.set(num, s);
          }

          if (lpid && !map.has(lpid)) map.set(lpid, s);
          if (lpid && /^\d+$/.test(lpid)) {
            const num = String(Number(lpid));
            if (!map.has(num)) map.set(num, s);
          }
        });

        this._sheets.set(trainerName, sheets);
        this._sheetsMap.set(trainerName, map);
      }, (e) => {
        console.warn("combat: sheets realtime error", trainerName, e);
      });

      this._sheetUnsubs.set(trainerName, unsub);
    } catch (e) {
      console.warn("combat: loadSheets error", e);
      this._sheets.set(trainerName, []);
      this._sheetsMap.set(trainerName, new Map());
    }
  }

  _getSheet(trainerName, pid) {
    const m = this._sheetsMap.get(trainerName);
    if (!m) return null;
    const key = safeStr(pid);
    if (m.has(key)) return m.get(key);
    // Normalização numérica: "009" → "9" para não falhar por zero-padding
    if (/^\d+$/.test(key)) {
      const num = String(Number(key));
      if (m.has(num)) return m.get(num);
    }
    return null;
  }

  // ─── Get stats from party_states (mirror of get_poke_data) ───────
  // Fallback: se party_states não tiver dados, usa stats da ficha
  _getPokeStats(trainerName, pid) {
    const tData = this._partyStates[trainerName] || {};
    const key = safeStr(pid);

    // Resolve pid key com normalização (espelha arena-combat.js)
    let pData = tData[key];
    if (!pData && /^\d+$/.test(key)) pData = tData[String(Number(key))];
    if (!pData) {
      for (const k of Object.keys(tData)) {
        if (/^\d+$/.test(k) && Number(k) === Number(key)) { pData = tData[k]; break; }
      }
    }
    pData = pData || {};

    const stats = (pData || {}).stats;
    if (stats && Object.keys(stats).length > 0) return normalizeStats(stats);

    // Fallback: stats da ficha carregada
    const sheet = this._getSheet(trainerName, pid);

    const rawStats =
      (sheet && sheet.stats && typeof sheet.stats === "object" && !Array.isArray(sheet.stats))
        ? sheet.stats
        : {};

    const np = safeInt(sheet?.np ?? sheet?.pokemon?.np ?? sheet?.pokemon?.NP);
    const hasCap = safeInt(rawStats.cap ?? rawStats.capability) > 0;
    const baseStats = (!hasCap && np > 0) ? { ...rawStats, cap: 2 * np } : rawStats;

    // ✅ THG fallback: se vier 0, THG = 2*NP - Dodge
    const out = normalizeStats(baseStats);
    if (safeInt(out.thg) <= 0 && np > 0) {
      out.thg = Math.max(0, (2 * np) - safeInt(out.dodge));
      out.toughness = safeInt(out.thg);
    }
    return out;
  }

  // ─── Get effective stats (base + boosts temporários) ─────────────
  // boosts ficam em party_states[trainer][pid].stat_boosts = { dodge:+2, parry:-1, ... }
  // Fallback para stats da ficha se party_states estiver vazio
  // ─── Get effective stats (base + boosts temporários) ─────────────
  // boosts ficam em party_states[trainer][pid].stat_boosts = { dodge:+2, parry:-1, acerto:+2, ... }
  // Fallback para stats da ficha se party_states estiver vazio
  _getEffectiveStats(trainerName, pid) {
    const tData = this._partyStates[trainerName] || {};
    const key = safeStr(pid);

    // Resolve pid key com normalização (espelha arena-combat.js)
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

    // Se base veio da ficha e não tem cap, derive cap = 2*np
    let baseFixed = base;
    if (!hasPartyStats) {
      const rawStats =
        (sheet && sheet.stats && typeof sheet.stats === "object" && !Array.isArray(sheet.stats))
          ? sheet.stats
          : {};
      const np = safeInt(sheet?.np ?? sheet?.pokemon?.np ?? sheet?.pokemon?.NP);
      const hasCap = safeInt(rawStats.cap ?? rawStats.capability) > 0;
      baseFixed = (!hasCap && np > 0) ? { ...rawStats, cap: 2 * np } : rawStats;
    }

    const boosts = pData.stat_boosts || {};
    const result = normalizeStats(baseFixed);

    // Aplica modificadores temporários (ex: acerto +2, parry -1)
    for (const [k, v] of Object.entries(boosts)) {
      const statKey = normalizeStatKey(k);
      if (result[statKey] !== undefined || statKey === "acerto") {
        result[statKey] = (safeInt(result[statKey]) + safeInt(v));
      }
    }

    // Aliases compat
    result.fortitude = safeInt(result.fort);
    result.toughness = safeInt(result.thg);

    // THG fallback: se vier 0, THG = 2*NP - Dodge (usa Dodge já boostado)
    const np = safeInt(sheet?.np ?? sheet?.pokemon?.np ?? sheet?.pokemon?.NP);
    if (safeInt(result.thg) <= 0 && np > 0) {
      result.thg = Math.max(0, (2 * np) - safeInt(result.dodge));
      result.toughness = safeInt(result.thg);
    }

    return result;
  }

  _getDisplayName(pid) {
    // try dexMap from main
    if (window.dexMap) {
      const k = safeStr(pid);
      const name = window.dexMap[k] || window.dexMap[String(Number(k))];
      if (name) return name;
    }
    return `#${pid}`;
  }

  // ─── Build static shell ───────────────────────────────────────────
  _buildShell() {
    this.container.innerHTML = `
      <div class="panel-title" style="margin-bottom:12px">
        <h3>⚔️ Combate</h3>
        <div class="pill mono" id="combat_phase_pill">idle</div>
      </div>
      <div id="combat_body"></div>      <div id="combat_whatif_panel" style="margin-top:14px"></div>
      <!-- Hidden: main.js writes to these, keep them alive to prevent crashes -->
      <pre id="battle_preview" style="display:none">—</pre>
    `;
    this._body = this.container.querySelector("#combat_body");
    this._phasePill = this.container.querySelector("#combat_phase_pill");
    this._lastRenderKey = ""; // tracks last rendered state to avoid redundant re-renders
    this._rendering = false;  // prevents concurrent renders
  }

  // ═══════════════════════════════════════════════════════════════════
  // render() — chamado sempre que battle muda
  //
  // CRITICAL FIX: gera uma "render key" a partir do status + campos
  // relevantes. Se a key não mudou, NÃO re-renderiza — isso impede
  // que o innerHTML seja destruído e recriado enquanto o usuário
  // está no meio de um clique.
  // ═══════════════════════════════════════════════════════════════════
  async render() {
    if (this._rendering) return; // skip if already rendering
    this._rendering = true;

    try {
      const battle = this.getBattle() || {};
      const status = safeStr(battle.status) || "idle";
      const by = this.getBy();
      const role = this.getRole();
      const isPlayer = (role === "owner" || role === "challenger");

      // Build a render key — only re-render when something meaningful changes
      const renderKey = [
        status,
        by,
        role,
        safeStr(battle.attacker),
        safeStr(battle.target_owner),
        safeStr(battle.target_pid),
        safeInt(battle.dmg_base),
        safeInt(battle.crit_bonus),
        battle.is_effect ? "1" : "0",
        (battle.logs || []).length,
      ].join("|");

      if (renderKey === this._lastRenderKey) {
        // Nothing changed — just update the pill text and skip DOM rebuild
        this._phasePill.textContent = status;
        this._phasePill.className = `pill mono ${status === "idle" ? "" : "warn"}`;
        return;
      }
      this._lastRenderKey = renderKey;

      this._phasePill.textContent = status;
      this._phasePill.className = `pill mono ${status === "idle" ? "" : "warn"}`;

      // ensure sheets loaded for current player
      if (isPlayer && by) await this._loadSheets(by);

      switch (status) {
        case "idle":       this._renderIdle(isPlayer, by, battle); break;
        case "setup":      await this._renderSetup(battle, isPlayer, by); break;
        case "hit_confirmed": this._renderHitConfirmed(battle, by); break;
        case "missed":     this._renderMissed(battle, by); break;
        case "aoe_defense": this._renderAoeDefense(battle, by); break;
        case "waiting_defense": this._renderWaitingDefense(battle, by); break;
        default:           this._body.innerHTML = `<div class="card"><div class="muted">Status desconhecido: ${escHtml(status)}</div></div>`;
      }
    
      // Painel What‑If (local) — render independente da state machine
      try { this._whatifPanel?.render?.({ battle, isPlayer, by }); } catch {}
} finally {
      this._rendering = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // FASE 0 — IDLE
  // ═══════════════════════════════════════════════════════════════════
  _renderIdle(isPlayer, by, battle) {
    if (!isPlayer) {
      this._body.innerHTML = `<div class="card"><div class="muted">Aguardando combate...</div></div>`;
      return;
    }

    // Detecta se o combate anterior acabou de terminar (logs existem e o jogador era o atacante)
    const prevAttacker = safeStr(battle.attacker);
    const prevLogs = battle.logs || [];
    const canSecondary = (prevAttacker === by) && prevLogs.length > 0 && safeStr(battle.target_id);

    let secondaryHtml = "";
    if (canSecondary) {
      secondaryHtml = `
        <button class="btn cb-secondary-btn" id="cb_secondary_effect">
          ⚡ Efeito Secundário em ${escHtml(this._getDisplayName(safeStr(battle.target_pid)))}
        </button>
      `;
    }

    const barsLost = prevLogs.length ? parseBarsLost(prevLogs[prevLogs.length - 1]) : 0;
    const logItemsHtml = prevLogs.map((line) => {
      const cleanLine = cleanCombatLog(line);
      const icon = cleanLine.includes("ACERTOU") ? "✅" : (cleanLine.includes("FALHA") ? "🛡️" : "•");
      return `<div class="cb-result-log-line">${icon} ${escHtml(cleanLine)}</div>`;
    }).join("");

    const resultHtml = prevLogs.length > 0
      ? `
        <div class="cb-result-card">
          <div class="cb-result-title">🩸 Resultado: -${barsLost} Barras</div>
          <div class="cb-result-log">${logItemsHtml}</div>
          <div class="cb-result-actions">
            <button class="btn" id="cb_end_battle">Encerrar Combate</button>
            ${secondaryHtml}
          </div>
        </div>
      `
      : "";

    this._body.innerHTML = `
      <div class="card">
        <div style="font-weight:950;margin-bottom:8px">Nenhum combate ativo</div>
        <div class="muted" style="margin-bottom:12px">Inicie um novo ataque contra um oponente.</div>
        ${resultHtml}
        <button class="btn" id="cb_new_battle">⚔️ Nova Batalha (Atacar)</button>
      </div>
    `;

    // ── Botão Nova Batalha ──
    const btn = this._body.querySelector("#cb_new_battle");
    btn.addEventListener("click", async () => {
      console.log("[CombatUI] 🔴 CLIQUE em Nova Batalha!");
      console.log("[CombatUI]   by =", by);
      console.log("[CombatUI]   getDb() =", this.getDb());
      console.log("[CombatUI]   getRid() =", this.getRid());
      btn.disabled = true;
      btn.textContent = "⏳ Iniciando...";
      btn.style.opacity = "0.6";
      try {
        const ref = this._battleRef();
        console.log("[CombatUI]   ref =", ref);
        if (!ref) { btn.disabled = false; btn.textContent = "⚔️ Nova Batalha (Atacar)"; btn.style.opacity = ""; return; }
        this._lastRenderKey = "";
        // Use merge:true to preserve turn_state, initiative, preprep, etc.
        await setDoc(ref, { status: "setup", attacker: by, attack_move: null, logs: [] }, { merge: true });
        console.log("[CombatUI]   ✅ setDoc concluído com sucesso!");
      } catch (e) {
        console.error("[CombatUI]   ❌ ERRO no setDoc:", e);
        btn.disabled = false;
        btn.textContent = "⚔️ Nova Batalha (Atacar)";
        btn.style.opacity = "";
      }
    });

    const endBtn = this._body.querySelector("#cb_end_battle");
    if (endBtn) {
      endBtn.addEventListener("click", async () => {
        endBtn.disabled = true;
        endBtn.textContent = "⏳ Encerrando...";
        this._lastRenderKey = "";
        const ref = this._battleRef(); if (!ref) return;
        await updateDoc(ref, { logs: [], attacker: "", target_owner: "", target_id: "", target_pid: "", attack_move: null });
      });
    }

    // ── Botão Efeito Secundário ──
    if (canSecondary) {
      const secBtn = this._body.querySelector("#cb_secondary_effect");
      secBtn.addEventListener("click", async () => {
        secBtn.disabled = true;
        secBtn.textContent = "⏳...";
        this._lastRenderKey = "";
        const ref = this._battleRef(); if (!ref) return;
        await updateDoc(ref, {
          status: "hit_confirmed",
          logs: arrayUnion("⚡ Efeito secundário ativado — defina o rank/efeito."),
        });
      });
    }
  }

  // ─── Type matchup table ───────────────────────────────────────────
  _renderTypeTable(pid, trainerName, container) {
    if (!container) return;
    const sheet = this._getSheet(trainerName, pid);
    const pokTypes = Array.isArray(sheet?.pokemon?.types) ? sheet.pokemon.types : [];
    if (pokTypes.length === 0) { container.innerHTML = ""; return; }

    const allTypes = ["Normal","Fire","Water","Electric","Grass","Ice","Fighting","Poison",
      "Ground","Flying","Psychic","Bug","Rock","Ghost","Dragon","Dark","Steel","Fairy"];

    // Offensive: what types does each pokemon type hit super effectively? (merged, deduplicated)
    const atkAdvSet = new Set();
    for (const t of pokTypes) {
      getSuperEffectiveAgainst(normalizeType(t)).forEach(x => atkAdvSet.add(x));
    }
    const atkAdv = [...atkAdvSet];

    // Defensive: calculate multipliers for each attacking type (dual-type aware)
    const weakTo4 = [], weakTo2 = [], resistHalf = [], resistQuarter = [], immuneTo = [];
    for (const atkType of allTypes) {
      const mult = getTypeAdvantage(atkType, pokTypes);
      if (mult === 0) immuneTo.push(atkType);
      else if (mult >= 4) weakTo4.push(atkType);
      else if (mult >= 2) weakTo2.push(atkType);
      else if (mult <= 0.25) resistQuarter.push(atkType);
      else if (mult < 1) resistHalf.push(atkType);
    }

    const badge = (type, extra = "") => {
      const color = getTypeColor(normalizeType(type) || type);
      return `<span class="cb-type-badge" style="background:${color}22;border-color:${color}66;color:${color}">${type}${extra}</span>`;
    };

    let html = `<div class="cb-type-table">`;

    // Header: the pokemon's own types
    html += `<div class="cb-type-table-header">`;
    html += pokTypes.map(t => {
      const color = getTypeColor(normalizeType(t) || t);
      return `<span class="cb-type-badge-self" style="background:${color}28;border-color:${color}80;color:${color}">${t}</span>`;
    }).join(" ");
    html += `</div>`;

    if (atkAdv.length > 0) {
      html += `<div class="cb-type-row"><div class="cb-type-row-label advantage">⚔️ Vantagem</div><div class="cb-type-badges">${atkAdv.map(t => badge(t, " +2")).join("")}</div></div>`;
    }
    if (weakTo4.length > 0) {
      html += `<div class="cb-type-row"><div class="cb-type-row-label weakness">💥 Fraqueza (+4)</div><div class="cb-type-badges">${weakTo4.map(t => badge(t, " +4")).join("")}</div></div>`;
    }
    if (weakTo2.length > 0) {
      html += `<div class="cb-type-row"><div class="cb-type-row-label weakness">⚠️ Fraqueza (+2)</div><div class="cb-type-badges">${weakTo2.map(t => badge(t, " +2")).join("")}</div></div>`;
    }
    if (resistQuarter.length > 0 || resistHalf.length > 0) {
      const all = [...resistQuarter.map(t => badge(t, " -4")), ...resistHalf.map(t => badge(t, " -2"))];
      html += `<div class="cb-type-row"><div class="cb-type-row-label resist">🛡️ Resistência</div><div class="cb-type-badges">${all.join("")}</div></div>`;
    }
    if (immuneTo.length > 0) {
      html += `<div class="cb-type-row"><div class="cb-type-row-label immune">🚫 Imunidade (-4)</div><div class="cb-type-badges">${immuneTo.map(t => badge(t, " -4")).join("")}</div></div>`;
    }

    html += `</div>`;
    container.innerHTML = html;
  }

  // ═══════════════════════════════════════════════════════════════════
  // FASE 1 — SETUP (configurar ataque)
  // ═══════════════════════════════════════════════════════════════════
  async _renderSetup(battle, isPlayer, by) {
    const attacker = safeStr(battle.attacker);
    const isAttacker = (attacker === by);

    if (!isAttacker) {
      this._body.innerHTML = `
        <div class="card">
          <div style="font-weight:950;margin-bottom:6px">Ataque em andamento</div>
          <div class="muted">Aguardando <strong>${escHtml(attacker)}</strong> configurar o ataque...</div>
        </div>
      `;
      return;
    }

    // — Eu sou o atacante —
    const pieces = this.getPieces() || [];
    const myPieces = pieces.filter(p => safeStr(p.owner) === by && safeStr(p.kind) !== "trainer" && safeStr(p.pid));
    const oppPieces = pieces.filter(p => safeStr(p.owner) !== by && safeStr(p.owner) && safeStr(p.kind) !== "trainer" && safeStr(p.pid) && safeStr(p.status || "active") === "active");

    // Build HTML
    let html = `<div class="card">
      <div style="font-weight:950;margin-bottom:10px">⚔️ Configurar Ataque</div>
      <div class="muted" style="margin-bottom:8px">Atacante: <strong>${escHtml(attacker)}</strong></div>
    `;

    // Select attacker Pokémon
    html += `<label class="label">Seu Pokémon (Atacante)</label>
      <select class="input" id="cb_atk_pokemon" style="margin-bottom:10px">`;
    if (myPieces.length === 0) {
      html += `<option value="">— Nenhuma peça no mapa —</option>`;
    }
    for (const p of myPieces) {
      const pid = safeStr(p.pid);
      const name = this._getDisplayName(pid);
      html += `<option value="${escHtml(pid)}">${escHtml(name)} (${escHtml(pid)})</option>`;
    }
    html += `</select>`;
    html += `<div id="cb_type_table" style="margin-bottom:10px"></div>`;

    // Select target
    html += `<label class="label">Alvo</label>
      <select class="input" id="cb_atk_target" style="margin-bottom:10px">`;
    if (oppPieces.length === 0) {
      html += `<option value="">— Sem alvos disponíveis —</option>`;
    }
    for (const p of oppPieces) {
      const pid = safeStr(p.pid);
      const name = this._getDisplayName(pid);
      const owner = safeStr(p.owner);
      // Pré-carrega tipos do alvo no option element (fallback para race condition de carregamento de ficha)
      const tSheetPre = this._getSheet(owner, pid);
      const tTypesPre = Array.isArray(tSheetPre?.pokemon?.types) ? tSheetPre.pokemon.types.join(",") : "";
      html += `<option value="${escHtml(safeStr(p.id))}" data-owner="${escHtml(owner)}" data-pid="${escHtml(pid)}" data-types="${escHtml(tTypesPre)}">${escHtml(name)} (${escHtml(owner)})</option>`;
    }
    html += `</select>`;

    // Mode: Normal / Área
    html += `
      <label class="label">Modo de Ataque</label>
      <div style="display:flex;gap:8px;margin-bottom:10px" id="cb_mode_btns">
        <button class="btn secondary cb-mode-btn active" data-mode="normal">Normal</button>
        <button class="btn secondary cb-mode-btn" data-mode="area">Área</button>
      </div>
    `;

    // Normal attack panel
    html += `<div id="cb_normal_panel">`;

    // Range
    html += `<label class="label">Alcance</label>
      <select class="input" id="cb_atk_range" style="margin-bottom:10px">
        <option value="Distância (Dodge)">Distância (Dodge)</option>
        <option value="Corpo-a-corpo (Parry)">Corpo-a-corpo (Parry)</option>
      </select>`;

    // Moves (populated dynamically)
    html += `<label class="label">Golpe</label>
      <select class="input" id="cb_atk_move" style="margin-bottom:10px">
        <option value="manual">Manual (sem golpe)</option>
      </select>`;

    // Accuracy modifier
    html += `<label class="label">Acerto (Modificador)</label>
      <input class="input" id="cb_atk_accuracy" type="number" value="0" style="margin-bottom:10px" />
      <div class="muted" id="cb_acc_hint" style="margin-bottom:10px"></div>`;

    // Golpe Furtivo
    html += `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:8px 10px;border-radius:10px;background:rgba(168,85,247,.10);border:1px solid rgba(168,85,247,.28)">
        <input type="checkbox" id="cb_sneak_attack" style="accent-color:#a855f7;width:16px;height:16px;cursor:pointer"/>
        <label for="cb_sneak_attack" style="font-size:13px;font-weight:700;cursor:pointer">🥷 Golpe Furtivo <span class="muted" style="font-weight:400">(oponente usa metade da defesa)</span></label>
      </div>`;

    // Roll button
    html += `<button class="btn" id="cb_roll_attack" style="width:100%">⚔️ Rolar Ataque</button>`;
    html += `</div>`; // end normal panel

    // Area attack panel
    html += `<div id="cb_area_panel" style="display:none">
      <div class="muted" style="margin-bottom:8px;padding:8px;border-radius:12px;background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.3)">
        Ataque em Área: Dodge obrigatório (CD 10 + Rank). Se passar, dano cai para metade do Rank.
      </div>
      <label class="label">Nível do Efeito / Dano</label>
      <input class="input" id="cb_area_level" type="number" value="1" min="1" style="margin-bottom:10px" />
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
        <input type="checkbox" id="cb_area_is_effect" />
        <label for="cb_area_is_effect" style="font-size:13px;font-weight:700">É Efeito? (Affliction)</label>
      </div>
      <button class="btn" id="cb_launch_area" style="width:100%">🚀 Lançar Área</button>
    </div>`;

    // Cancel button
    html += `<div style="margin-top:10px"><button class="btn ghost" id="cb_cancel" style="width:100%">✖ Cancelar</button></div>`;

    html += `</div>`; // end card
    this._body.innerHTML = html;

    // ─── Wire up interactions ────────────────────────────────────────
    const atkPokemonSel = this._body.querySelector("#cb_atk_pokemon");
    const targetSel = this._body.querySelector("#cb_atk_target");
    const moveSel = this._body.querySelector("#cb_atk_move");
    const accInput = this._body.querySelector("#cb_atk_accuracy");
    const accHint = this._body.querySelector("#cb_acc_hint");
    const normalPanel = this._body.querySelector("#cb_normal_panel");
    const areaPanel = this._body.querySelector("#cb_area_panel");

    // Mode toggle
    let currentMode = "normal";
    this._body.querySelectorAll(".cb-mode-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        currentMode = btn.dataset.mode;
        this._body.querySelectorAll(".cb-mode-btn").forEach(b => b.classList.toggle("active", b === btn));
        normalPanel.style.display = currentMode === "normal" ? "" : "none";
        areaPanel.style.display = currentMode === "area" ? "" : "none";
      });
    });

    // Retorna os tipos do alvo atualmente selecionado (da ficha, com fallback para data-types do option)
    const getTargetTypes = () => {
      const tOpt = targetSel.selectedOptions[0];
      if (!tOpt) return [];
      const tOwner = tOpt.dataset.owner;
      const tPid = tOpt.dataset.pid;
      if (!tOwner || !tPid) return [];
      const tSheet = this._getSheet(tOwner, tPid);
      if (tSheet && Array.isArray(tSheet?.pokemon?.types) && tSheet.pokemon.types.length > 0) {
        // Atualiza cache no option para futuras consultas
        tOpt.dataset.types = tSheet.pokemon.types.join(",");
        return tSheet.pokemon.types;
      }
      // Fallback: tipos armazenados no atributo data-types do option
      const stored = safeStr(tOpt.dataset.types);
      return stored ? stored.split(",").filter(Boolean) : [];
    };

    // Helper: resolve tipo do golpe (lookup por nome + fallback para mv.type / mv.meta.type)
    const getMoveTypeResolved = (moveName, mv) => {
      return getMoveType(moveName) || safeStr(mv?.meta?.type) || safeStr(mv?.type) || "";
    };

    // Populate moves when attacker pokemon changes
    const populateMoves = async () => {
      const pid = atkPokemonSel.value;

      // Update type matchup table for the selected attacker pokemon
      const typeTableContainer = this._body.querySelector("#cb_type_table");
      if (pid && typeTableContainer) {
        this._renderTypeTable(pid, by, typeTableContainer);
      } else if (typeTableContainer) {
        typeTableContainer.innerHTML = "";
      }

      if (!pid) { moveSel.innerHTML = `<option value="manual">Manual (sem golpe)</option>`; return; }

      await this._loadSheets(by);
      const sheet = this._getSheet(by, pid);
      // Usa stats com boosts temporários (party_states) se disponíveis
      const baseStats = sheet?.stats || this._getPokeStats(by, pid) || {};
      const effectiveStats = this._getEffectiveStats(by, pid);
      const stats = Object.keys(effectiveStats).length > 0 ? effectiveStats : baseStats;
      const atkTypes = Array.isArray(sheet?.pokemon?.types) ? sheet.pokemon.types : [];
      const moves = sheet?.moves || [];
      const tgtTypes = getTargetTypes();
      // Boost de acerto global (afeta todas as rolagens de ataque)
      const aceiroBonus = safeInt(effectiveStats.acerto || 0);

      let opts = `<option value="manual">Manual (sem golpe)</option>`;
      moves.forEach((mv, i) => {
        const name = safeStr(mv.name) || "Golpe";
        const rank = safeInt(mv.rank);
        const [based, statVal] = moveStatValue(mv.meta || {}, stats);
        // Resolve tipo do golpe: lookup por nome + fallback para mv.meta.type / mv.type
        const moveType = getMoveTypeResolved(name, mv);
        const typeBonus = tgtTypes.length > 0 && moveType ? getTypeDamageBonus(moveType, tgtTypes) : 0;
        // STAB: +2 se o tipo do golpe é igual ao tipo do pokémon atacante
        const isStab = moveType && atkTypes.some(t => normalizeType(t) === moveType);
        const stabBonus = isStab ? 2 : 0;
        const damage = rank + statVal + typeBonus + stabBonus;
        const acc = safeInt(mv.accuracy);
        const bonusTxt = typeBonus !== 0 ? ` [${typeBonus > 0 ? '+' : ''}${typeBonus} tipo]` : '';
        const stabTxt = isStab ? " ★" : "";
        const aceiroTxt = aceiroBonus !== 0 ? ` Ac:${aceiroBonus > 0 ? '+' : ''}${aceiroBonus}` : '';
        opts += `<option value="${i}">${escHtml(name)}${stabTxt}. A:${acc}${aceiroTxt} D:${damage}${bonusTxt}</option>`;
      });
      moveSel.innerHTML = opts;
      updateAccuracy();
    };

    const updateAccuracy = () => {
      const pid = atkPokemonSel.value;
      const sheet = this._getSheet(by, pid);
      const moves = sheet?.moves || [];
      const idx = moveSel.value;
      if (idx === "manual" || !moves[idx]) {
        accHint.textContent = "";
        return;
      }
      const mv = moves[parseInt(idx)];
      const acc = safeInt(mv.accuracy);
      accInput.value = acc;
      const effectiveStats = this._getEffectiveStats(by, pid);
      const aceiroBonus = safeInt(effectiveStats.acerto || 0);
      const totalAcc = acc + aceiroBonus;
      accHint.textContent = aceiroBonus !== 0
        ? `Acerto sugerido: ${acc} + boost Acerto ${aceiroBonus > 0 ? '+' : ''}${aceiroBonus} = ${totalAcc}`
        : `Acerto sugerido pelo golpe: ${acc}`;
    };

    atkPokemonSel.addEventListener("change", populateMoves);
    moveSel.addEventListener("change", updateAccuracy);
    // Pré-carrega ficha do dono do alvo quando o alvo muda, e re-popula golpes (recalcula bonus tipo)
    targetSel.addEventListener("change", async () => {
      const opt = targetSel.selectedOptions[0];
      const owner = opt?.dataset?.owner;
      if (owner && !this._sheetUnsubs.has(owner)) await this._loadSheets(owner);
      populateMoves();
    });
    // Dispara o pré-carregamento do alvo inicial
    (async () => {
      const opt = targetSel.selectedOptions[0];
      const owner = opt?.dataset?.owner;
      if (owner && !this._sheetUnsubs.has(owner)) await this._loadSheets(owner);
    })();
    populateMoves();

    // Cancel
    this._body.querySelector("#cb_cancel").addEventListener("click", async () => {
      const cancelBtn = this._body.querySelector("#cb_cancel");
      cancelBtn.disabled = true; cancelBtn.textContent = "⏳...";
      this._lastRenderKey = "";
      const ref = this._battleRef(); if (!ref) return;
      await setDoc(ref, { status: "idle", logs: [] }, { merge: true });
    });

    // ─── ROLL NORMAL ATTACK ─────────────────────────────────────────
    this._body.querySelector("#cb_roll_attack").addEventListener("click", async () => {
      const rollBtn = this._body.querySelector("#cb_roll_attack");
      rollBtn.disabled = true; rollBtn.textContent = "⏳ Rolando..."; rollBtn.style.opacity = "0.6";
      this._lastRenderKey = "";

      const targetOpt = targetSel.selectedOptions[0];
      if (!targetOpt || !targetOpt.value) { alert("Selecione um alvo."); return; }

      const targetId = targetOpt.value;
      const tOwner = targetOpt.dataset.owner;
      const tPid = targetOpt.dataset.pid;
      const attackerPid = atkPokemonSel.value;
      const atkRange = this._body.querySelector("#cb_atk_range").value;
      const atkMod = safeInt(accInput.value);
      const isSneakAttack = !!this._body.querySelector("#cb_sneak_attack")?.checked;
      // ✅ FIX 2: garante que as fichas do atacante e do alvo estejam carregadas
      const by = this.getBy();
      if (by && !this._sheetUnsubs.has(by)) await this._loadSheets(by);
      if (tOwner && !this._sheetUnsubs.has(tOwner)) await this._loadSheets(tOwner);

      // get target stats (aplica boosts temporários se existirem)
      const tStats = this._getEffectiveStats(tOwner, tPid);
      const dodge = safeInt(tStats.dodge);
      const parry = safeInt(tStats.parry);
      let defenseVal = atkRange.includes("Distância") ? dodge : parry;
      if (isSneakAttack) defenseVal = Math.floor(defenseVal / 2);
      const needed = defenseVal + 10;

      // Boost de acerto do atacante (da aba de fichas)
      const atkEffStatsForAceiro = this._getEffectiveStats(by, attackerPid);
      const aceiroBonus = safeInt(atkEffStatsForAceiro.acerto || 0);

      // roll
      const roll = d20Roll();
      this._publishRoll(roll, `Ataque • ${attackerPid || "—"}`);
      const totalAtk = atkMod + aceiroBonus + roll;
      let hit, critBonus;
      if (roll === 1) { hit = false; critBonus = 0; }
      else if (roll === 20) { hit = true; critBonus = 5; }
      else { hit = totalAtk >= needed; critBonus = 0; }

      const resultMsg = hit ? "ACERTOU! ✅" : "ERROU! ❌";
      const critTxt = critBonus ? " (CRÍTICO +5)" : "";
      const aceiroTxt = aceiroBonus !== 0 ? ` +${aceiroBonus} Acerto` : "";

      // build move payload (usa effective stats com boosts)
      let movePayload = null;
      const moveIdx = moveSel.value;
      if (moveIdx !== "manual") {
        const sheet = this._getSheet(by, attackerPid);
        const moves = sheet?.moves || [];
        const mv = moves[parseInt(moveIdx)];
        if (mv) {
          const baseStats = sheet?.stats || this._getPokeStats(by, attackerPid) || {};
          const effectiveStats = this._getEffectiveStats(by, attackerPid);
          const stats = Object.keys(effectiveStats).length > 0 ? effectiveStats : baseStats;
          const rank = safeInt(mv.rank);
          const [based, statVal] = moveStatValue(mv.meta || {}, stats);
          const moveName = safeStr(mv.name) || "Golpe";
          // Resolve tipo: lookup por nome + fallback mv.meta.type / mv.type
          const moveType = getMoveTypeResolved(moveName, mv);
          // Tipos do alvo: tenta carregar da ficha, com fallback para option data-types
          const tSheet = this._getSheet(tOwner, tPid);
          const tgtTypes = (tSheet && Array.isArray(tSheet?.pokemon?.types) && tSheet.pokemon.types.length > 0)
            ? tSheet.pokemon.types
            : (safeStr(targetOpt.dataset.types) ? safeStr(targetOpt.dataset.types).split(",").filter(Boolean) : []);
          const typeBonus = moveType && tgtTypes.length > 0 ? getTypeDamageBonus(moveType, tgtTypes) : 0;
          // STAB: +2 se o tipo do golpe = tipo do pokémon atacante
          const atkTypes = Array.isArray(sheet?.pokemon?.types) ? sheet.pokemon.types : [];
          const stabBonus = (moveType && atkTypes.some(t => normalizeType(t) === moveType)) ? 2 : 0;
          movePayload = {
            name: moveName,
            accuracy: safeInt(mv.accuracy),
            damage: rank + statVal + typeBonus + stabBonus,
            rank,
            based_stat: based,
            stat_value: statVal,
            move_type: moveType || null,
            type_bonus: typeBonus,
            stab_bonus: stabBonus,
          };
        }
      }

      const sneakTxt = isSneakAttack ? " 🥷 Furtivo (def/2)" : "";
      const atkModParts = [atkMod, aceiroBonus].filter(v => v !== 0);
      const atkModStr = atkModParts.length > 1 ? atkModParts.join("+") : (atkModParts[0] || 0);
      const ref = this._battleRef(); if (!ref) return;
      await updateDoc(ref, {
        status: hit ? "hit_confirmed" : "missed",
        attacker: by,
        attacker_pid: attackerPid,
        target_id: targetId,
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
        logs: [
          `${by} rolou ${roll}+${atkModStr}=${totalAtk} (vs Def ${needed} [${defenseVal}+10])${critTxt}${aceiroTxt}${sneakTxt}... ${resultMsg}`
        ],
      });
    });

    // ─── LAUNCH AREA ATTACK ─────────────────────────────────────────
    this._body.querySelector("#cb_launch_area").addEventListener("click", async () => {
      const launchBtn = this._body.querySelector("#cb_launch_area");
      launchBtn.disabled = true; launchBtn.textContent = "⏳ Lançando..."; launchBtn.style.opacity = "0.6";
      this._lastRenderKey = "";

      const targetOpt = targetSel.selectedOptions[0];
      if (!targetOpt || !targetOpt.value) { alert("Selecione um alvo."); return; }

      const targetId = targetOpt.value;
      const tOwner = targetOpt.dataset.owner;
      const tPid = targetOpt.dataset.pid;
      const lvl = safeInt(this._body.querySelector("#cb_area_level").value, 1);
      const isEff = this._body.querySelector("#cb_area_is_effect").checked;

      const ref = this._battleRef(); if (!ref) return;
      await updateDoc(ref, {
        status: "aoe_defense",
        attacker: by,
        target_id: targetId,
        target_owner: tOwner,
        target_pid: tPid,
        aoe_dc: lvl + 10,
        dmg_base: lvl,
        is_effect: isEff,
        logs: [`${by} lançou Área (Rank ${lvl}). Defensor rola Dodge obrigatório (CD ${lvl + 10}).`],
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // FASE 1.5 — AOE_DEFENSE
  // ═══════════════════════════════════════════════════════════════════
  _renderAoeDefense(battle, by) {
    const logs = battle.logs || [];
    const lastLog = logs[logs.length - 1] || "";
    const targetOwner = safeStr(battle.target_owner);
    const isDefender = (targetOwner === by);

    let html = `<div class="card">
      <div style="font-weight:950;margin-bottom:8px">🌀 Defesa de Área</div>
      <div class="cb-log-msg">${escHtml(lastLog)}</div>
    `;

    if (isDefender) {
      html += `
        <div style="margin-top:12px;font-weight:900;font-size:13px">🛡️ Dodge obrigatório:</div>
        <div class="muted" style="margin-bottom:10px">CD 10 + Rank. Se passar, toma metade do Rank. Se falhar, toma Rank total.</div>
        <div class="cb-defense-grid">
          <button class="btn secondary" data-def="dodge">Dodge</button>
        </div>
      `;
    } else {
      html += `<div class="muted" style="margin-top:10px">Aguardando defesa de área...</div>`;
    }
    html += `</div>`;
    this._body.innerHTML = html;

    if (isDefender) {
      this._body.querySelectorAll("[data-def]").forEach(btn => {
        btn.addEventListener("click", async () => {
          // Disable ALL defense buttons immediately
          this._body.querySelectorAll("[data-def]").forEach(b => { b.disabled = true; b.style.opacity = "0.5"; });
          btn.textContent = "⏳...";
          this._lastRenderKey = "";

          const defType = btn.dataset.def;
          const tPid = safeStr(battle.target_pid);
          const tStats = this._getEffectiveStats(by, tPid);
          const statVal = safeInt(tStats[defType]);

          const roll = d20Roll();
          this._publishRoll(roll, `Defesa área • ${defType.toUpperCase()}`);
          const totalRoll = roll + statVal;
          const dc = safeInt(battle.aoe_dc, 10);
          const baseRank = safeInt(battle.dmg_base);

          let finalRank, msg;
          if (totalRoll >= dc) {
            finalRank = Math.max(1, Math.floor(baseRank / 2));
            msg = `Sucesso no Dodge! (${totalRoll} vs ${dc}). Rank reduzido: ${baseRank} -> ${finalRank}.`;
          } else {
            finalRank = baseRank;
            msg = `Falha no Dodge! (${totalRoll} vs ${dc}). Rank total: ${finalRank}.`;
          }

          const ref = this._battleRef(); if (!ref) return;
          await updateDoc(ref, {
            status: "waiting_defense",
            dmg_base: finalRank,
            logs: arrayUnion(msg + " Agora escolha como resistir."),
          });
        });
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // FASE 2 — HIT_CONFIRMED (atacante define rank do dano)
  // ═══════════════════════════════════════════════════════════════════
  _renderHitConfirmed(battle, by) {
    const logs = battle.logs || [];
    const lastLog = logs[logs.length - 1] || "";
    const attacker = safeStr(battle.attacker);
    const isAttacker = (attacker === by);

    let html = `<div class="card">
      <div style="font-weight:950;margin-bottom:8px">✅ Acerto Confirmado!</div>
      <div class="cb-log-msg cb-log-success">${escHtml(lastLog)}</div>
    `;

    if (isAttacker) {
      const atk = battle.attack_move;
      const moveDmg = atk?.damage || 0;
      // Monta breakdown visual do dano para transparência
      let breakdownHtml = "";
      if (atk && atk.rank != null) {
        const parts = [];
        parts.push(`R${atk.rank} base`);
        if (atk.stat_value) parts.push(`+${atk.stat_value} ${atk.based_stat || ""}`);
        if (atk.stab_bonus) parts.push(`+${atk.stab_bonus} STAB`);
        if (atk.type_bonus && atk.type_bonus !== 0) parts.push(`${atk.type_bonus > 0 ? '+' : ''}${atk.type_bonus} tipo`);
        const critBonus = safeInt(battle.crit_bonus);
        if (critBonus) parts.push(`+${critBonus} crítico`);
        const totalWithCrit = moveDmg + critBonus;
        breakdownHtml = `
          <div style="font-size:11px;padding:6px 10px;margin-bottom:8px;border-radius:8px;background:rgba(56,189,248,.08);border:1px solid rgba(56,189,248,.2);color:#94a3b8">
            ${escHtml(parts.join(" "))} = <strong style="color:#38bdf8">R${totalWithCrit}</strong>
            ${atk.move_type ? `<span style="margin-left:4px;opacity:.7">(${escHtml(atk.move_type)})</span>` : ""}
          </div>
        `;
      }
      html += `
        <div style="margin-top:12px">
          <label class="label">Rank do Dano / Efeito</label>
          ${breakdownHtml}
          <input class="input" id="cb_dmg_input" type="number" value="${safeInt(moveDmg)}" min="0" style="margin-bottom:10px" />
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">
            <input type="checkbox" id="cb_is_effect" />
            <label for="cb_is_effect" style="font-size:13px;font-weight:700">É efeito? (Affliction)</label>
          </div>
          <button class="btn" id="cb_confirm_rank" style="width:100%">Confirmar Rank</button>
        </div>
      `;
    } else {
      html += `<div class="muted" style="margin-top:10px">Aguardando atacante definir o dano...</div>`;
    }
    html += `</div>`;
    this._body.innerHTML = html;

    if (isAttacker) {
      const confirmBtn = this._body.querySelector("#cb_confirm_rank");
      confirmBtn.addEventListener("click", async () => {
        confirmBtn.disabled = true; confirmBtn.textContent = "⏳...";
        this._lastRenderKey = "";
        const dmg = safeInt(this._body.querySelector("#cb_dmg_input").value);
        const isEff = this._body.querySelector("#cb_is_effect").checked;
        const ref = this._battleRef(); if (!ref) return;
        await updateDoc(ref, {
          status: "waiting_defense",
          dmg_base: dmg,
          is_effect: isEff,
          logs: arrayUnion(`Rank/Dano: ${dmg} (${isEff ? "Efeito" : "Dano"}). Aguardando resistência...`),
        });
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // FASE 2b — MISSED
  // ═══════════════════════════════════════════════════════════════════
  _renderMissed(battle, by) {
    const logs = battle.logs || [];
    const lastLog = logs[logs.length - 1] || "";
    const attacker = safeStr(battle.attacker);
    const isAttacker = (attacker === by);

    let html = `<div class="card">
      <div style="font-weight:950;margin-bottom:8px">❌ Ataque Errou!</div>
      <div class="cb-log-msg cb-log-error">${escHtml(lastLog)}</div>
    `;

    if (isAttacker) {
      html += `<button class="btn" id="cb_end_miss" style="margin-top:12px;width:100%">Encerrar</button>`;
    }
    html += `</div>`;
    this._body.innerHTML = html;

    if (isAttacker) {
      const endBtn = this._body.querySelector("#cb_end_miss");
      endBtn.addEventListener("click", async () => {
        endBtn.disabled = true; endBtn.textContent = "⏳...";
        this._lastRenderKey = "";
        const ref = this._battleRef(); if (!ref) return;
        await updateDoc(ref, { status: "idle", logs: [] });
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // FASE 3 — WAITING_DEFENSE (defensor resiste)
  // ═══════════════════════════════════════════════════════════════════
  _renderWaitingDefense(battle, by) {
    const isEff = battle.is_effect || false;
    const baseVal = isEff ? 10 : 15;
    const rank = safeInt(battle.dmg_base);
    const critBonus = safeInt(battle.crit_bonus);
    const dcTotal = baseVal + rank + critBonus;

    const targetOwner = safeStr(battle.target_owner);
    const isDefender = (targetOwner === by);

    const logs = battle.logs || [];
    const lastLog = logs[logs.length - 1] || "";

    let html = `<div class="card">
      <div style="font-weight:950;margin-bottom:8px">🛡️ Resistência</div>
      <div class="cb-log-msg">${escHtml(lastLog)}</div>
      <div style="margin-top:10px;padding:10px;border-radius:12px;background:rgba(56,189,248,.1);border:1px solid rgba(56,189,248,.25);font-weight:800;font-size:14px">
        CD ${dcTotal} <span style="font-weight:500;font-size:12px">(${baseVal} + ${rank}${critBonus ? ` + ${critBonus} crit` : ""})</span>
      </div>
    `;

    if (isDefender) {
      const tPid = safeStr(battle.target_pid);
      const tStats = this._getEffectiveStats(by, tPid);
      const sv = (k) => { const v = safeInt(tStats[k]); return v ? ` <span style="font-size:11px;opacity:.7">(+${v})</span>` : ""; };
      html += `
        <div style="margin-top:12px;font-weight:900;font-size:13px">🛡️ Resistir com:</div>
        <div class="cb-defense-grid">
          <button class="btn secondary" data-def="dodge">Dodge${sv("dodge")}</button>
          <button class="btn secondary" data-def="parry">Parry${sv("parry")}</button>
          <button class="btn secondary" data-def="fort">Fort${sv("fort")}</button>
          <button class="btn secondary" data-def="will">Will${sv("will")}</button>
          <button class="btn secondary" data-def="thg" style="grid-column:span 2">THG (Toughness)${sv("thg")}</button>
        </div>
      `;
    } else {
      html += `<div class="muted" style="margin-top:10px">Aguardando defensor resistir...</div>`;
    }
    html += `</div>`;
    this._body.innerHTML = html;

    if (isDefender) {
      this._body.querySelectorAll("[data-def]").forEach(btn => {
        btn.addEventListener("click", async () => {
          // Disable ALL defense buttons immediately
          this._body.querySelectorAll("[data-def]").forEach(b => { b.disabled = true; b.style.opacity = "0.5"; });
          btn.textContent = "⏳...";
          this._lastRenderKey = "";

          const defType = btn.dataset.def;
          const tPid = safeStr(battle.target_pid);
          const tStats = this._getEffectiveStats(by, tPid);
          const statVal = safeInt(tStats[defType]);

          const roll = d20Roll();
          this._publishRoll(roll, `Defesa • ${defType.toUpperCase()}`);
          const checkTotal = roll + statVal;
          const diff = dcTotal - checkTotal;

          let barsLost, resMsg;
          if (diff <= 0) {
            barsLost = 0;
            resMsg = "SUCESSO (Nenhum dano)";
          } else {
            barsLost = Math.ceil(diff / 5);
            resMsg = `FALHA por ${diff}`;
          }

          let finalMsg = `🛡️ Defensor rolou ${roll} + ${statVal} = ${checkTotal} (${defType.toUpperCase()}). ${resMsg}. Barras perdidas: ${barsLost}`;

          const ref = this._battleRef(); if (!ref) return;
          await updateDoc(ref, {
            status: "idle",
            logs: arrayUnion(finalMsg),
          });
        });
      });
    }
  }
}
