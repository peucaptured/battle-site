/**
 * combat.js — Combat Guide / What‑If (battle-site)
 *
 * Objetivo:
 *   Este arquivo NÃO executa o combate. Ele é um "guia visual" (auditoria)
 *   do que o arena-combat.js fez/escreveu no Firestore (public_state/battle),
 *   exibindo:
 *     - em que etapa está (status)
 *     - rolagens (dados) e somas
 *     - de onde vem cada número (atk_mod, aceiro_bonus, defense_val, dmg_base, crit_bonus, etc.)
 *     - o valor exato do dano a resistir (CD) e o resultado em barras
 *
 *   + Modo What‑If:
 *     - Após um combate existir (ou durante), o jogador pode editar as ENTRADAS
 *       (ex.: THG usado, Dodge, bônus de acerto, rank do dano, etc.)
 *     - Os RESULTADOS DOS DADOS (d20 do ataque e d20 da resistência) NÃO são editáveis.
 *     - Ao editar, o painel recalcula em tempo real (sem escrever no Firestore).
 *
 * Integração:
 *   combat-patch.js instancia new CombatUI({ container, getBattle, getBy, getRid, ... })
 *   e chama combatUI.render() sempre que o battle snapshot mudar.
 *
 * Observação importante:
 *   arena-combat.js atualmente não grava explicitamente (em campos próprios) o d20 da defesa;
 *   ele grava um log textual em battle.logs. Este arquivo tenta extrair a rolagem/estatística
 *   de defesa a partir do último log de resistência quando possível.
 */

import { normalizeType, getTypeDamageBonus } from "./type-data.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function safeStr(x) { return (x == null ? "" : String(x)).trim(); }
function safeInt(x, fb = 0) { const n = parseInt(x, 10); return Number.isFinite(n) ? n : fb; }
function escHtml(s) { const d = document.createElement("div"); d.textContent = String(s ?? ""); return d.innerHTML; }
function clamp(n, a, b) { n = Number(n); return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : a; }

function nowId() { return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`; }

function pick(obj, keys, fb = undefined) {
  for (const k of keys) {
    if (!obj) break;
    if (Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return fb;
}

function last(arr) { return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null; }

// Extracts attack roll from canonical fields first, then from logs
function parseAttackRoll(battle) {
  const d20 = safeInt(battle?.d20, NaN);
  if (Number.isFinite(d20) && d20 > 0) return d20;

  const logs = battle?.logs || [];
  // Examples:
  // "d20=17+5=22 vs DEF 18"
  // "Re-roll d20=..."
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
  // Example (arena-combat):
  // "🛡️ 12+6=18 (THG) vs CD 22. FALHA por 4 — 1 barra(s)"
  // Another:
  // "Sucesso no Dodge! (18 vs 17). Rank: 8→4"
  for (let i = logs.length - 1; i >= 0; i--) {
    const t = safeStr(logs[i]);
    // Prefer explicit "X+Y=Z"
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
    // Fallback: "(TOTAL vs DC)" line from AOE dodge step
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

// ─────────────────────────────────────────────────────────────────────────────
// What‑If store (localStorage per rid)
// ─────────────────────────────────────────────────────────────────────────────
function getStoreKey(rid) {
  const r = safeStr(rid) || "no_rid";
  return `combat_whatif_v1:${r}`;
}

function loadOverrides(rid) {
  try {
    const raw = localStorage.getItem(getStoreKey(rid));
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch { return {}; }
}

function saveOverrides(rid, obj) {
  try { localStorage.setItem(getStoreKey(rid), JSON.stringify(obj || {})); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: derive a "snapshot" from battle + overrides
// ─────────────────────────────────────────────────────────────────────────────
function buildSnapshot(battle, overrides) {
  overrides = overrides || {};

  const status = safeStr(battle?.status || "idle");
  const attacker = safeStr(battle?.attacker);
  const attackerPid = safeStr(battle?.attacker_pid);
  const targetOwner = safeStr(battle?.target_owner);
  const targetPid = safeStr(battle?.target_pid);

  const atkRoll = parseAttackRoll(battle);
  const atkMod = safeInt(pick(overrides, ["atk_mod"], battle?.atk_mod), 0);
  const aceiroBonus = safeInt(pick(overrides, ["aceiro_bonus", "acerto_bonus"], battle?.aceiro_bonus), 0);
  const defenseVal = safeInt(pick(overrides, ["defense_val"], battle?.defense_val), 0);
  const needed = safeInt(pick(overrides, ["needed"], battle?.needed), (defenseVal + 10));
  const sneakAttack = !!pick(overrides, ["sneak_attack"], battle?.sneak_attack);

  // Crit: arena-combat stores crit_bonus (0|5) already; keep editable for What‑If
  const critBonus = safeInt(pick(overrides, ["crit_bonus"], battle?.crit_bonus), 0);

  const totalAtk = atkRoll + atkMod + aceiroBonus;
  const hit =
    atkRoll === 1 ? false :
    atkRoll === 20 ? true :
    totalAtk >= needed;

  const atkMove = battle?.attack_move || {};
  const moveName = safeStr(atkMove?.name || "");
  const moveType = safeStr(atkMove?.move_type || "");
  const moveRank = safeInt(pick(overrides, ["move_rank", "rank"], atkMove?.rank), safeInt(atkMove?.rank, 0));
  const statVal = safeInt(pick(overrides, ["move_stat_value"], atkMove?.stat_value), safeInt(atkMove?.stat_value, 0));
  const stabBonus = safeInt(pick(overrides, ["stab_bonus"], atkMove?.stab_bonus), safeInt(atkMove?.stab_bonus, 0));
  const typeBonus = safeInt(pick(overrides, ["type_bonus"], atkMove?.type_bonus), safeInt(atkMove?.type_bonus, 0));
  const modDano = safeInt(pick(overrides, ["move_mod_dano", "move_damage_mod"], atkMove?.modDano), 0);

  // dmg_base in battle is the "rank" used for DC (after confirmation). Let user override.
  const dmgBase = safeInt(pick(overrides, ["dmg_base"], battle?.dmg_base), safeInt(battle?.dmg_base, safeInt(atkMove?.damage, 0)));
  const isEffect = !!pick(overrides, ["is_effect"], battle?.is_effect);

  // If attack_move.damage exists but is inconsistent with parts, show computed suggestion:
  const computedMoveDamage = (moveRank + statVal + stabBonus + typeBonus + modDano);

  const dcBase = isEffect ? 10 : 15;
  const dc = safeInt(pick(overrides, ["dc"], (dcBase + dmgBase + critBonus)), (dcBase + dmgBase + critBonus));

  // Defense (try parse from logs, then allow override)
  const d = parseDefenseFromLogs(battle);
  const defType = normalizeDefKey(pick(overrides, ["def_type"], d.defType || ""));
  const defRoll = safeInt(d.roll, 0); // locked (dice)
  const defStat = safeInt(pick(overrides, ["def_stat"], d.stat), safeInt(d.stat, 0));
  const defTotal = (defRoll > 0 || d.source === "log") ? (defRoll + defStat) : safeInt(pick(overrides, ["def_total"], d.total), safeInt(d.total, 0));

  // Resist outcome
  const diff = dc - defTotal;
  const barsLost = diff <= 0 ? 0 : Math.ceil(diff / 5);

  // AOE first-step (if present in logs) is informational only here.
  return {
    status,
    attacker,
    attackerPid,
    targetOwner,
    targetPid,

    attack: {
      roll: atkRoll,
      atkMod,
      aceiroBonus,
      total: totalAtk,
      defenseVal,
      needed,
      sneakAttack,
      hit,
      critBonus,
    },

    move: {
      name: moveName,
      moveType,
      rank: moveRank,
      statVal,
      stabBonus,
      typeBonus,
      modDano,
      dmgBase,
      computedMoveDamage,
    },

    defense: {
      fromLog: d.source === "log",
      logLine: d.logLine || "",
      type: defType,
      roll: defRoll,
      stat: defStat,
      total: defTotal,
      dcParsed: safeInt(d.dc, 0),
    },

    dc: { base: dcBase, dc, isEffect },

    outcome: { diff, barsLost },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────────────────────────
function injectStylesOnce() {
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

function fieldInput(label, key, value, { disabled = false, hint = "" } = {}) {
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

function boolToggle(label, key, checked) {
  const id = `cbw_${key}_${nowId()}`;
  return `
    <div class="cbw-row" style="justify-content:flex-start">
      <input id="${escHtml(id)}" type="checkbox" data-whatif-bool="${escHtml(key)}" ${checked ? "checked" : ""} style="transform:scale(1.05)"/>
      <label for="${escHtml(id)}" class="vv" style="cursor:pointer">${escHtml(label)}</label>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// CombatUI class (expected by combat-patch.js)
// ─────────────────────────────────────────────────────────────────────────────
export class CombatUI {
  constructor(opts) {
    this._opts = opts || {};
    this._container = opts?.container || null;
    this._overrides = {};
    this._lastRenderSig = "";
    this._boundOnInput = (e) => this._onInput(e);
    this._boundOnClick = (e) => this._onClick(e);
  }

  // ───────────────────────────────────────────────────────────────
  // Compat: métodos esperados por patches antigos (combat-inspector-patch.js)
  // ───────────────────────────────────────────────────────────────

  async _renderSetup(battle, isPlayer, by) {
    this._renderGuide(battle, isPlayer, by);
  }

  async _renderHitConfirmed(battle, isPlayer, by) {
    this._renderGuide(battle, isPlayer, by);
  }



  startListening() {
    // purely DOM listeners (no Firestore)
    if (!this._container) return;
    this._container.addEventListener("input", this._boundOnInput);
    this._container.addEventListener("change", this._boundOnInput);
    this._container.addEventListener("click", this._boundOnClick);
  }

  stopListening() {
    if (!this._container) return;
    this._container.removeEventListener("input", this._boundOnInput);
    this._container.removeEventListener("change", this._boundOnInput);
    this._container.removeEventListener("click", this._boundOnClick);
  }

  _getRid() { return this._opts?.getRid ? this._opts.getRid() : ""; }
  _getBy() { return this._opts?.getBy ? this._opts.getBy() : ""; }
  _getBattle() { return this._opts?.getBattle ? this._opts.getBattle() : null; }

  _loadOverrides() {
    const rid = this._getRid();
    this._overrides = loadOverrides(rid);
  }

  _saveOverrides() {
    const rid = this._getRid();
    saveOverrides(rid, this._overrides);
  }

  _onClick(e) {
    const btn = e.target?.closest?.("[data-action]");
    if (!btn) return;
    const act = btn.dataset.action;
    if (act === "reset-whatif") {
      this._overrides = {};
      this._saveOverrides();
      this._lastRenderSig = "";
      this.render(true);
    }
    if (act === "copy-json") {
      const battle = this._getBattle() || {};
      const snap = buildSnapshot(battle, this._overrides);
      const payload = { overrides: this._overrides, snapshot: snap };
      try {
        navigator.clipboard?.writeText?.(JSON.stringify(payload, null, 2));
        btn.textContent = "✅ Copiado!";
        setTimeout(() => (btn.textContent = "📋 Copiar What‑If"), 1200);
      } catch {
        // fallback: show prompt
        window.prompt("Copie o JSON:", JSON.stringify(payload, null, 2));
      }
    }
  }

  _onInput(e) {
    const inEl = e.target;
    if (!inEl) return;

    const rid = this._getRid();
    if (!rid) return;

    // Numeric inputs
    const k = inEl.dataset?.whatif;
    if (k) {
      const v = safeInt(inEl.value, 0);
      this._overrides[k] = v;
      this._saveOverrides();
      this.render(true);
      return;
    }

    // Boolean toggles
    const kb = inEl.dataset?.whatifBool;
    if (kb) {
      this._overrides[kb] = !!inEl.checked;
      this._saveOverrides();
      this.render(true);
      return;
    }
  }

  render(battle = null, isPlayer = null, by = null) {
    // Compat com combat-patch.js: render(battle,isPlayer,by)
    if (battle) this._battle = battle;
    if (typeof isPlayer === "boolean") this._isPlayer = isPlayer;
    if (by != null) this._by = by;

    const b = this._battle || this._getBattle();
    const status = (b && b.status) ? String(b.status) : "setup";

    if (status === "setup") {
      Promise.resolve(this._renderSetup(b, this._isPlayer, this._by));
      return;
    }
    if (status === "hit_confirmed") {
      Promise.resolve(this._renderHitConfirmed(b, this._isPlayer, this._by));
      return;
    }
    this._renderGuide(b, this._isPlayer, this._by);
  }

  _renderGuide(battleArg, isPlayer, byArg) {

    injectStylesOnce();

    const root = this._container;
    if (!root) return;

    const rid = this._getRid();
    if (!this._overrides || typeof this._overrides !== "object") this._overrides = {};
    // Load overrides when rid changes (or first render)
    if (!this._overrides.__rid || this._overrides.__rid !== rid) {
      this._loadOverrides();
      this._overrides.__rid = rid || "";
      this._saveOverrides();
    }

    const battle = battleArg || this._getBattle();
    const by = (byArg != null ? byArg : this._getBy());

    // Signature to avoid unnecessary reflows
    const sig = JSON.stringify({
      rid,
      by,
      battle: battle ? {
        status: battle.status,
        attacker: battle.attacker,
        attacker_pid: battle.attacker_pid,
        target_owner: battle.target_owner,
        target_pid: battle.target_pid,
        atk_mod: battle.atk_mod,
        aceiro_bonus: battle.aceiro_bonus,
        defense_val: battle.defense_val,
        needed: battle.needed,
        d20: battle.d20,
        crit_bonus: battle.crit_bonus,
        dmg_base: battle.dmg_base,
        is_effect: battle.is_effect,
        attack_move: battle.attack_move ? {
          name: battle.attack_move.name,
          move_type: battle.attack_move.move_type,
          rank: battle.attack_move.rank,
          stat_value: battle.attack_move.stat_value,
          stab_bonus: battle.attack_move.stab_bonus,
          type_bonus: battle.attack_move.type_bonus,
          damage: battle.attack_move.damage,
        } : null,
        logsLast: last(battle.logs || []),
        logsLen: Array.isArray(battle.logs) ? battle.logs.length : 0,
      } : null,
      overrides: this._overrides,
    });

    if (!force && sig === this._lastRenderSig) return;
    this._lastRenderSig = sig;

    // Empty state
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

    if (!battle) {
      root.innerHTML = `
        <div class="cbw-wrap">
          <div class="cbw-card">
            <div class="cbw-top">
              <div>
                <div class="cbw-title">⚔️ Combate (Guia Visual)</div>
                <div class="cbw-sub">RID: <span class="vv">${escHtml(rid)}</span> • por: <span class="vv">${escHtml(by || "—")}</span></div>
              </div>
              <div class="cbw-badge ok">Sem dados de battle</div>
            </div>
            <div class="cbw-muted" style="margin-top:10px">Nenhum combate ativo. Quando um ataque ocorrer no mapa, esta aba vai detalhar a rolagem e permitir What‑If.</div>
          </div>
        </div>
      `;
      return;
    }

    const snap = buildSnapshot(battle, this._overrides);

    // helpful notes
    const status = snap.status;
    const badgeCls = badgeClassForStatus(status);
    const atk = snap.attack;
    const mv = snap.move;
    const df = snap.defense;
    const dc = snap.dc;
    const out = snap.outcome;

    // derived labels
    const hitTxt = atk.hit ? `ACERTOU ✅` : `ERROU ❌`;
    const critTxt = atk.roll === 20 ? `CRÍTICO (d20=20) +${atk.critBonus}` : (atk.critBonus ? `crit +${atk.critBonus}` : "sem crítico");
    const resTxt = (df.total <= 0 && status !== "idle") ? "—" : (out.barsLost <= 0 ? "SUCESSO ✅ (0 barras)" : `FALHA ❌ (${out.barsLost} barra${out.barsLost === 1 ? "" : "s"})`);
    const resCls = (df.total <= 0) ? "" : (out.barsLost <= 0 ? "cbw-ok" : "cbw-bad");

    const lastLog = safeStr(last(battle.logs || []) || "");
    const moveTypeNote = mv.moveType ? `Tipo: ${mv.moveType}` : "Tipo: —";

    // Display a small damage breakdown
    const computedWarn = (mv.computedMoveDamage && mv.computedMoveDamage !== safeInt(battle?.attack_move?.damage, mv.computedMoveDamage))
      ? `<div class="cbw-tiny">⚠️ Dano do golpe no battle (${safeInt(battle?.attack_move?.damage, 0)}) difere do breakdown (${mv.computedMoveDamage}). No What‑If você pode ajustar as peças.</div>`
      : "";

    root.innerHTML = `
      <div class="cbw-wrap">

        <div class="cbw-card">
          <div class="cbw-top">
            <div>
              <div class="cbw-title">⚔️ Combate (Guia Visual + What‑If)</div>
              <div class="cbw-sub">RID: <span class="vv">${escHtml(rid)}</span> • você: <span class="vv">${escHtml(by || "—")}</span></div>
              <div class="cbw-sub" style="margin-top:4px">Etapa: <span class="vv">${escHtml(statusLabel(status))}</span></div>
            </div>
            <div class="cbw-badge ${badgeCls}">${escHtml(statusLabel(status))}</div>
          </div>

          <div class="cbw-hr"></div>

          <div class="cbw-grid">
            <div class="cbw-card" style="padding:12px">
              <div class="cbw-h"><div class="t">🎯 Ataque</div><div class="cbw-pill">${escHtml(hitTxt)}</div></div>
              ${fieldInput("atk_mod (do golpe)", "atk_mod", atk.atkMod)}
              ${fieldInput("bônus de acerto (party_states)", "aceiro_bonus", atk.aceiroBonus, { hint: "campo aceiro_bonus do battle" })}
              ${fieldInput("defesa alvo (Dodge/Parry)", "defense_val", atk.defenseVal, { hint: "usado para needed = defesa+10 (se não sobrescrever)" })}
              ${fieldInput("needed (DEF+10)", "needed", atk.needed, { hint: "pode sobrescrever o cálculo padrão" })}
              ${fieldInput("crit_bonus", "crit_bonus", atk.critBonus, { hint: "d20=20 normalmente dá +5" })}
              ${boolToggle("Furtivo (def/2)", "sneak_attack", atk.sneakAttack)}
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

              ${fieldInput("rank base (do golpe)", "move_rank", mv.rank)}
              ${fieldInput("stat_value (Stgr/Int)", "move_stat_value", mv.statVal)}
              ${fieldInput("STAB (+2)", "stab_bonus", mv.stabBonus)}
              ${fieldInput("bônus de tipo (+2/-2/...)", "type_bonus", mv.typeBonus)}
              ${fieldInput("mod extra de dano (opcional)", "move_mod_dano", mv.modDano)}
              <div class="cbw-row">
                <div class="k">Dano calculado (breakdown)</div>
                <div class="v">${escHtml(mv.rank)} + ${escHtml(mv.statVal)} + ${escHtml(mv.stabBonus)} + ${escHtml(mv.typeBonus)} + ${escHtml(mv.modDano)} = ${escHtml(mv.computedMoveDamage)}</div>
              </div>
              ${computedWarn}

              <div class="cbw-hr"></div>

              ${fieldInput("dmg_base usado na CD", "dmg_base", mv.dmgBase, { hint: "rank final confirmado (pode ser diferente do breakdown)" })}
              ${boolToggle("É efeito? (CD base 10)", "is_effect", dc.isEffect)}
              ${fieldInput("CD total (pode sobrescrever)", "dc", dc.dc, { hint: `base ${dc.base} + dmg_base ${mv.dmgBase} + crit ${atk.critBonus}` })}

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

              ${fieldInput("stat usado na resistência", "def_stat", df.stat, { hint: "ex.: THG/Dodge/Fort etc." })}
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

// Backwards compatibility: some code may import default
export default CombatUI;
