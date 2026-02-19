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
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

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
  stats = stats || {};
  if (based === "Int") return [based, safeInt(stats["int"])];
  if (based === "Stgr") return [based, safeInt(stats.stgr)];
  return [based, 0];
}

// ─── Sprite helper ──────────────────────────────────────────────────
function spriteUrl(pid) {
  const k = safeStr(pid);
  if (!k) return "";
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
   * @param {function} opts.getPlayers   — () => appState.players array
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

    // build static shell
    this._buildShell();
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
      // don't re-render here; main.js calls render() on battle change
    }, () => {});
  }

  stopListening() {
    if (this._partyStatesUnsub) { try { this._partyStatesUnsub(); } catch {} }
    this._partyStatesUnsub = null;
  }

  // ─── Load sheets for a trainer ────────────────────────────────────
  async _loadSheets(trainerName) {
    if (this._sheets.has(trainerName)) return;
    const db = this.getDb();
    if (!db) return;
    const tid = safeDocId(trainerName);
    try {
      const col = collection(db, "trainers", tid, "sheets");
      const q = query(col, orderBy("updated_at", "desc"), fbLimit(50));
      const snap = await getDocs(q);
      const sheets = [];
      const map = new Map();
      snap.forEach(d => {
        const s = d.data() || {};
        s._sheet_id = d.id;
        sheets.push(s);
        const pid = safeStr(s.pokemon?.id);
        if (pid) map.set(pid, s);
        const lpid = safeStr(s.linked_pid);
        if (lpid) map.set(lpid, s);
      });
      this._sheets.set(trainerName, sheets);
      this._sheetsMap.set(trainerName, map);
    } catch (e) {
      console.warn("combat: loadSheets error", e);
      this._sheets.set(trainerName, []);
      this._sheetsMap.set(trainerName, new Map());
    }
  }

  _getSheet(trainerName, pid) {
    const m = this._sheetsMap.get(trainerName);
    return m ? (m.get(safeStr(pid)) || null) : null;
  }

  // ─── Get stats from party_states (mirror of get_poke_data) ───────
  _getPokeStats(trainerName, pid) {
    const tData = this._partyStates[trainerName] || {};
    const pData = tData[safeStr(pid)] || {};
    return pData.stats || {};
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
      <div id="combat_body"></div>
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
        <button class="btn" id="cb_secondary_effect" style="width:100%;margin-top:8px;background:linear-gradient(135deg,#7c3aed,#a855f7);border:none">
          ⚡ Efeito Secundário
        </button>
        <div class="muted" style="margin-top:4px;font-size:11px">Reabre a rolagem de dano/efeito sem reiniciar o combate.</div>
      `;
    }

    this._body.innerHTML = `
      <div class="card">
        <div style="font-weight:950;margin-bottom:8px">Nenhum combate ativo</div>
        <div class="muted" style="margin-bottom:12px">Inicie um novo ataque contra um oponente.</div>
        <button class="btn" id="cb_new_battle">⚔️ Nova Batalha (Atacar)</button>
        ${secondaryHtml}
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
        await setDoc(ref, { status: "setup", attacker: by, attack_move: null, logs: [] });
        console.log("[CombatUI]   ✅ setDoc concluído com sucesso!");
      } catch (e) {
        console.error("[CombatUI]   ❌ ERRO no setDoc:", e);
        btn.disabled = false;
        btn.textContent = "⚔️ Nova Batalha (Atacar)";
        btn.style.opacity = "";
      }
    });

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
      html += `<option value="${escHtml(safeStr(p.id))}" data-owner="${escHtml(owner)}" data-pid="${escHtml(pid)}">${escHtml(name)} (${escHtml(owner)})</option>`;
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

    // Roll button
    html += `<button class="btn" id="cb_roll_attack" style="width:100%">⚔️ Rolar Ataque</button>`;
    html += `</div>`; // end normal panel

    // Area attack panel
    html += `<div id="cb_area_panel" style="display:none">
      <div class="muted" style="margin-bottom:8px;padding:8px;border-radius:12px;background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.3)">
        Ataque em Área: Dodge (CD 10 + Nível) reduz dano pela metade.
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

    // Populate moves when attacker pokemon changes
    const populateMoves = async () => {
      const pid = atkPokemonSel.value;
      if (!pid) { moveSel.innerHTML = `<option value="manual">Manual (sem golpe)</option>`; return; }

      await this._loadSheets(by);
      const sheet = this._getSheet(by, pid);
      const stats = sheet?.stats || this._getPokeStats(by, pid) || {};
      const moves = sheet?.moves || [];

      let opts = `<option value="manual">Manual (sem golpe)</option>`;
      moves.forEach((mv, i) => {
        const name = safeStr(mv.name) || "Golpe";
        const rank = safeInt(mv.rank);
        const [based, statVal] = moveStatValue(mv.meta || {}, stats);
        const damage = rank + statVal;
        const acc = safeInt(mv.accuracy);
        opts += `<option value="${i}">${escHtml(name)}. Acerto: ${acc}. Dano: ${damage}</option>`;
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
      accHint.textContent = `Acerto sugerido pelo golpe: ${acc}`;
    };

    atkPokemonSel.addEventListener("change", populateMoves);
    moveSel.addEventListener("change", updateAccuracy);
    populateMoves();

    // Cancel
    this._body.querySelector("#cb_cancel").addEventListener("click", async () => {
      const cancelBtn = this._body.querySelector("#cb_cancel");
      cancelBtn.disabled = true; cancelBtn.textContent = "⏳...";
      this._lastRenderKey = "";
      const ref = this._battleRef(); if (!ref) return;
      await setDoc(ref, { status: "idle", logs: [] });
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

      // get target stats
      const tStats = this._getPokeStats(tOwner, tPid);
      const dodge = safeInt(tStats.dodge);
      const parry = safeInt(tStats.parry);
      const defenseVal = atkRange.includes("Distância") ? dodge : parry;
      const needed = defenseVal + 10;

      // roll
      const roll = d20Roll();
      this._publishRoll(roll, `Ataque • ${attackerPid || "—"}`);
      const totalAtk = atkMod + roll;
      let hit, critBonus;
      if (roll === 1) { hit = false; critBonus = 0; }
      else if (roll === 20) { hit = true; critBonus = 5; }
      else { hit = totalAtk >= needed; critBonus = 0; }

      const resultMsg = hit ? "ACERTOU! ✅" : "ERROU! ❌";
      const critTxt = critBonus ? " (CRÍTICO +5)" : "";

      // build move payload
      let movePayload = null;
      const moveIdx = moveSel.value;
      if (moveIdx !== "manual") {
        const sheet = this._getSheet(by, attackerPid);
        const moves = sheet?.moves || [];
        const mv = moves[parseInt(moveIdx)];
        if (mv) {
          const stats = sheet?.stats || this._getPokeStats(by, attackerPid) || {};
          const rank = safeInt(mv.rank);
          const [based, statVal] = moveStatValue(mv.meta || {}, stats);
          movePayload = {
            name: safeStr(mv.name) || "Golpe",
            accuracy: safeInt(mv.accuracy),
            damage: rank + statVal,
            rank,
            based_stat: based,
            stat_value: statVal,
          };
        }
      }

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
        d20: roll,
        defense_val: defenseVal,
        needed,
        total_atk: totalAtk,
        crit_bonus: critBonus,
        logs: [
          `${by} rolou ${roll}+${atkMod}=${totalAtk} (vs Def ${needed} [${defenseVal}+10])${critTxt}... ${resultMsg}`
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
        logs: [`${by} lançou Área (Nv ${lvl}). Defensor rola Dodge (CD ${lvl + 10}).`],
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
        <div style="margin-top:12px;font-weight:900;font-size:13px">🛡️ Escolha sua defesa:</div>
        <div class="muted" style="margin-bottom:10px">Dodge (CD 10 + Nível) reduz o Rank pela metade.</div>
        <div class="cb-defense-grid">
          <button class="btn secondary" data-def="dodge">Dodge</button>
          <button class="btn secondary" data-def="parry">Parry</button>
          <button class="btn secondary" data-def="fort">Fort</button>
          <button class="btn secondary" data-def="will">Will</button>
          <button class="btn secondary" data-def="thg" style="grid-column:span 2">THG (Toughness)</button>
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
          const tStats = this._getPokeStats(by, tPid);
          const statVal = safeInt(tStats[defType]);

          const roll = d20Roll();
          this._publishRoll(roll, `Defesa área • ${defType.toUpperCase()}`);
          const totalRoll = roll + statVal;
          const dc = safeInt(battle.aoe_dc, 10);
          const baseRank = safeInt(battle.dmg_base);

          let finalRank, msg;
          if (totalRoll >= dc) {
            finalRank = Math.max(1, Math.floor(baseRank / 2));
            msg = `Sucesso! (${totalRoll} vs ${dc}) com ${defType.toUpperCase()}. Rank reduzido: ${baseRank} -> ${finalRank}.`;
          } else {
            finalRank = baseRank;
            msg = `Falha! (${totalRoll} vs ${dc}) com ${defType.toUpperCase()}. Rank total: ${finalRank}.`;
          }

          const ref = this._battleRef(); if (!ref) return;
          await updateDoc(ref, {
            status: "waiting_defense",
            dmg_base: finalRank,
            logs: arrayUnion(msg + " Escolha a resistência agora."),
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
      const moveDmg = battle.attack_move?.damage || 0;
      html += `
        <div style="margin-top:12px">
          <label class="label">Rank do Dano / Efeito</label>
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
      html += `
        <div style="margin-top:12px;font-weight:900;font-size:13px">🛡️ Resistir com:</div>
        <div class="cb-defense-grid">
          <button class="btn secondary" data-def="dodge">Dodge</button>
          <button class="btn secondary" data-def="parry">Parry</button>
          <button class="btn secondary" data-def="fort">Fort</button>
          <button class="btn secondary" data-def="will">Will</button>
          <button class="btn secondary" data-def="thg" style="grid-column:span 2">THG (Toughness)</button>
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
          const tStats = this._getPokeStats(by, tPid);
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

          // ── Lesão por dano massivo ──────────────────────────────
          const maxHp = 6; // sistema de 6 barras
          const injuryStages = barsLost > 0 ? Math.floor(barsLost / (maxHp / 2)) : 0;
          const targetName = this._getDisplayName(tPid);

          let finalMsg = `🛡️ Defensor rolou ${roll} + ${statVal} = ${checkTotal} (${defType.toUpperCase()}). ${resMsg}. Barras perdidas: ${barsLost}`;
          if (injuryStages > 0) {
            finalMsg += ` | 💥 ${targetName} recebeu um golpe massivo e caiu ${injuryStages} estágio(s)!`;
          }

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
