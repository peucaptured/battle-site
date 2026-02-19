/**
 * initiative.js — Aba de Iniciativa (battle-site)
 *
 * Replica a aba 🧭 Iniciativa do app.py (Streamlit) em JS puro.
 *
 * Lógica:
 *  - Lê as peças do tabuleiro (public_state/state.pieces)
 *  - Lê stats de speed em public_state/party_states (igual ao app.py get_poke_data)
 *  - Lê/escreve iniciativas em public_state/battle.initiative
 *  - Calcula: d20 + mod_speed + bonus  (Pokémon)
 *             bonus                     (Treinador/Avatar)
 *
 * Estrutura Firestore:
 *   party_states[trainerName][pid].stats.speed
 *
 * Tabela Speed → Mod:
 *   1–40 = -4 | 41–60 = -1 | 61–70 = 0 | 71–80 = +1 | 81–100 = +2 | 101–120 = +4 | 121+ = +8
 *
 * Permissões:
 *   - "owner" / "gm" → rola todos, edita qualquer bonus
 *   - jogador comum → rola e edita apenas os próprios Pokémon
 */

import {
  doc,
  onSnapshot,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// ─── helpers ────────────────────────────────────────────────────────
function safeInt(x, fallback = 0) {
  const n = parseInt(x, 10);
  return Number.isFinite(n) ? n : fallback;
}
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function d20() {
  return Math.floor(Math.random() * 20) + 1;
}

/** Tabela Speed → Mod (igual ao app.py) */
function speedToMod(speed) {
  const s = safeInt(speed, 0);
  if (s <= 40) return -4;
  if (s <= 60) return -1;
  if (s <= 70) return 0;
  if (s <= 80) return 1;
  if (s <= 100) return 2;
  if (s <= 120) return 4;
  return 8;
}

/** Extrai Speed de um objeto de stats (várias chaves possíveis) */
function extractSpeed(statsObj) {
  if (!statsObj || typeof statsObj !== "object") return 0;
  for (const k of ["speed", "spe", "spd", "velocidade", "vel", "Speed"]) {
    if (k in statsObj) return safeInt(statsObj[k], 0);
  }
  return 0;
}

/**
 * Cache em memória para speeds da PokeAPI.
 * Evita chamadas repetidas para o mesmo nome.
 */
const _speedCache = new Map();

/**
 * Converte nome para o formato PokeAPI (igual ao to_pokeapi_name do app.py).
 * Remove "EXT:", sufixos " - Delta" / " - Alolan", etc.
 */
function toPokeAPIName(raw) {
  return String(raw || "")
    .replace(/^EXT:/i, "")
    .split(" - ")[0]
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

/**
 * Busca Speed base na PokeAPI pelo nome do Pokémon.
 * Retorna 0 em caso de erro. Resultado fica cacheado.
 */
async function fetchSpeedFromPokeAPI(name) {
  const key = toPokeAPIName(name);
  if (!key) return 0;
  if (_speedCache.has(key)) return _speedCache.get(key);

  try {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(key)}`);
    if (!res.ok) { _speedCache.set(key, 0); return 0; }
    const json = await res.json();
    const speedStat = (json.stats || []).find(s => s.stat?.name === "speed");
    const val = safeInt(speedStat?.base_stat, 0);
    _speedCache.set(key, val);
    return val;
  } catch {
    _speedCache.set(key, 0);
    return 0;
  }
}

// ─── classe principal ────────────────────────────────────────────────
export class InitiativeUI {
  /**
   * @param {Object} opts
   * @param {import("firebase/firestore").Firestore} opts.db
   * @param {string}  opts.rid        - Room ID
   * @param {string}  opts.by         - Nome do usuário conectado
   * @param {string}  opts.role       - "owner" | "player" | "spectator"
   * @param {HTMLElement} opts.container - Elemento onde renderizar
   */
  constructor({ db, rid, by, role, container }) {
    this._db = db;
    this._rid = rid;
    this._by = by;
    this._role = role;
    this._container = container;

    // Estado local em memória
    this._initStore = {};   // battle.initiative
    this._pieces = [];      // state.pieces
    this._partyStates = {}; // party_states — { trainerName: { pid: { stats: { speed, ... } } } }
    this._bonusEdits = {};  // { [key]: number } — edições locais não salvas ainda

    this._unsubBattle = null;
    this._unsubState = null;
    this._unsubParty = null;

    this._render();
    this._subscribe();
  }

  // ─── Firestore refs ────────────────────────────────────────────────
  _battleRef() {
    return doc(this._db, "rooms", this._rid, "public_state", "battle");
  }
  _stateRef() {
    return doc(this._db, "rooms", this._rid, "public_state", "state");
  }
  _partyStatesRef() {
    return doc(this._db, "rooms", this._rid, "public_state", "party_states");
  }

  // ─── Subscrições em tempo real ─────────────────────────────────────
  _subscribe() {
    // Escuta battle → pega initiative salvo
    this._unsubBattle = onSnapshot(this._battleRef(), (snap) => {
      if (!snap.exists()) return;
      this._initStore = snap.data()?.initiative || {};
      this._renderRows();
    });

    // Escuta state → pega peças
    this._unsubState = onSnapshot(this._stateRef(), (snap) => {
      if (!snap.exists()) return;
      this._pieces = snap.data()?.pieces || [];
      this._renderRows();
    });

    // Escuta party_states → pega stats (speed) de todos os Pokémon
    // Estrutura: { trainerName: { pid: { stats: { speed, dodge, ... } } } }
    this._unsubParty = onSnapshot(this._partyStatesRef(), (snap) => {
      if (!snap.exists()) return;
      this._partyStates = snap.data() || {};
      this._renderRows();
    });
  }

  destroy() {
    try { this._unsubBattle?.(); } catch {}
    try { this._unsubState?.(); } catch {}
    try { this._unsubParty?.(); } catch {}
  }

  // ─── Estrutura raiz (renderizada uma vez) ──────────────────────────
  _render() {
    this._container.innerHTML = `
      <div class="panel-inner" id="init_root" style="padding:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <h3 style="margin:0">🧭 Iniciativa</h3>
          <span style="font-size:.75rem;opacity:.6">Speed → Mod: 1-40=-4, 41-60=-1, 61-70=0, 71-80=+1, 81-100=+2, 101-120=+4, 121+=+8</span>
        </div>

        <!-- Botões de controle -->
        <div class="card" style="margin-bottom:10px">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
            <button class="btn" id="init_roll_all" style="display:none">🎲 Rolar todos (Pokémon em campo)</button>

            <div style="display:flex;gap:6px;flex:1;min-width:200px">
              <select class="input" id="init_sel_pokemon" style="flex:1"></select>
              <button class="btn secondary" id="init_roll_sel">🎯 Rolar selecionado</button>
            </div>

            <button class="btn" id="init_save" style="background:#2563eb">💾 Salvar iniciativa</button>
            <button class="btn secondary" id="init_reset_all" style="display:none">🔄 Resetar todos</button>
          </div>
          <div style="margin-top:6px;font-size:.75rem;opacity:.6" id="init_perm_note"></div>
        </div>

        <!-- Lista de linhas -->
        <div id="init_rows"></div>

        <!-- Divisor -->
        <div style="height:1px;background:rgba(255,255,255,.1);margin:12px 0"></div>

        <!-- Tabela de ordem -->
        <div>
          <div style="font-weight:900;margin-bottom:8px">🏁 Ordem automática</div>
          <div id="init_order_table"></div>
        </div>
      </div>
    `;

    const isOwner = this._role === "owner" || this._role === "gm";

    const rollAllBtn = this._container.querySelector("#init_roll_all");
    const resetAllBtn = this._container.querySelector("#init_reset_all");
    const permNote = this._container.querySelector("#init_perm_note");

    if (isOwner) {
      rollAllBtn.style.display = "";
      resetAllBtn.style.display = "";
      permNote.textContent = "Você é o owner: pode rolar e editar qualquer Pokémon.";
    } else {
      permNote.textContent = "Você pode rolar e editar apenas os seus próprios Pokémon.";
    }

    // ── Evento: Rolar todos (owner only)
    rollAllBtn.addEventListener("click", async () => {
      const rows = this._buildRows();
      const pokemon = rows.filter(r => r.kind === "Pokémon");
      const out = { ...this._initStore };
      for (const rec of pokemon) {
        const roll = d20();
        const bonus = safeInt(this._bonusEdits[rec.key] ?? out[rec.key]?.bonus_input, 0);
        out[rec.key] = {
          d20_roll: roll,
          speed: rec.speed,
          speed_mod: rec.mod_speed,
          bonus_input: bonus,
          initiative: roll + rec.mod_speed + bonus,
          note: "",
        };
      }
      await this._save(out);
    });

    // ── Evento: Rolar selecionado
    this._container.querySelector("#init_roll_sel").addEventListener("click", async () => {
      const sel = this._container.querySelector("#init_sel_pokemon").value;
      if (!sel) return;
      const rows = this._buildRows();
      const rec = rows.find(r => r.key === sel);
      if (!rec) return;

      const isOwner2 = this._role === "owner" || this._role === "gm";
      if (!isOwner2 && rec.owner !== this._by) {
        alert("Você só pode rolar iniciativa dos seus próprios Pokémon.");
        return;
      }

      const roll = d20();
      const out = { ...this._initStore };
      const bonus = safeInt(this._bonusEdits[rec.key] ?? out[rec.key]?.bonus_input, 0);
      out[rec.key] = {
        d20_roll: roll,
        speed: rec.speed,
        speed_mod: rec.mod_speed,
        bonus_input: bonus,
        initiative: roll + rec.mod_speed + bonus,
        note: "",
      };
      await this._save(out);
    });

    // ── Evento: Salvar (persiste bonus editados localmente)
    this._container.querySelector("#init_save").addEventListener("click", async () => {
      const out = { ...this._initStore };
      for (const [k, bonus] of Object.entries(this._bonusEdits)) {
        const prev = out[k] || {};
        const d20val = safeInt(prev.d20_roll, 0);
        const mod = safeInt(prev.speed_mod, 0);
        out[k] = {
          ...prev,
          bonus_input: bonus,
          initiative: d20val > 0 ? d20val + mod + bonus : bonus,
        };
      }
      await this._save(out);
      this._bonusEdits = {};
    });

    // ── Evento: Resetar todos (owner only)
    resetAllBtn.addEventListener("click", async () => {
      if (!confirm("Zerar todas as iniciativas?")) return;
      await this._save({});
      this._bonusEdits = {};
    });
  }

  // ─── Constrói lista de linhas (síncrona, usa cache de speed) ────────
  _buildRows() {
    const rows = [];
    for (const p of this._pieces) {
      const pKind = String(p.kind || "piece");
      if (!["trainer", "piece"].includes(pKind)) continue;

      const key = `${pKind}:${p.id}`;
      const owner = String(p.owner || "");

      let display, speed_val, speed_mod, pid;

      if (pKind === "trainer") {
        display = `🧍 ${owner || "Treinador"}`;
        pid = "";
        speed_val = 0;
        speed_mod = 0;
      } else {
        pid = String(p.pid || "");

        // Nome de exibição
        if (window.dexMap) {
          const mapped = window.dexMap[pid] || window.dexMap[String(Number(pid))];
          display = mapped || p.name || p.display_name || pid || "Pokémon";
        } else {
          display = p.name || p.display_name || pid || "Pokémon";
        }

        // 1) tenta party_states[owner][pid].stats.speed
        const ownerParty = this._partyStates[owner] || {};
        const pokeData   = ownerParty[pid] || ownerParty[String(Number(pid))] || {};
        const statsObj   = pokeData.stats || {};
        speed_val = extractSpeed(statsObj);

        // 2) fallback: stats direto na peça
        if (speed_val === 0) {
          speed_val = extractSpeed(p.stats || p.poke_stats || {});
        }

        // 3) fallback: cache da PokeAPI (preenchido assincronamente)
        const cacheKey = toPokeAPIName(pid.startsWith("EXT:") ? pid : display);
        if (speed_val === 0 && _speedCache.has(cacheKey)) {
          speed_val = _speedCache.get(cacheKey);
        }

        // 4) dispara fetch assíncrono se ainda 0 e não está no cache
        if (speed_val === 0 && !_speedCache.has(cacheKey)) {
          const nameForAPI = pid.startsWith("EXT:") ? pid : display;
          fetchSpeedFromPokeAPI(nameForAPI).then(v => {
            if (v > 0) this._renderRows(); // re-renderiza ao obter o valor
          });
        }

        speed_mod = speedToMod(speed_val);
      }

      const saved = this._initStore[key] || {};
      const d20_roll = safeInt(saved.d20_roll, 0);
      const bonus_input = safeInt(
        this._bonusEdits[key] ?? saved.bonus_input,
        0
      );

      let final_init;
      if (pKind === "piece" && d20_roll > 0) {
        final_init = d20_roll + speed_mod + bonus_input;
      } else if (pKind === "trainer") {
        final_init = bonus_input;
      } else {
        final_init = 0;
      }

      rows.push({
        key,
        owner,
        kind: pKind === "trainer" ? "Avatar" : "Pokémon",
        pid,
        display,
        speed: speed_val,
        mod_speed: speed_mod,
        d20: d20_roll,
        bonus: bonus_input,
        initiative: final_init,
      });
    }
    return rows;
  }

  // ─── Renderiza as linhas e a tabela de ordem ───────────────────────
  _renderRows() {
    const rows = this._buildRows();
    const isOwner = this._role === "owner" || this._role === "gm";
    const rowsEl = this._container.querySelector("#init_rows");
    const selEl = this._container.querySelector("#init_sel_pokemon");
    const orderEl = this._container.querySelector("#init_order_table");
    if (!rowsEl) return;

    // ── Atualiza select de Pokémon
    const pool = isOwner
      ? rows.filter(r => r.kind === "Pokémon")
      : rows.filter(r => r.kind === "Pokémon" && r.owner === this._by);

    const prevSel = selEl.value;
    selEl.innerHTML = pool.length
      ? pool.map(r => `<option value="${esc(r.key)}">${esc(r.display)} • ${esc(r.owner)}</option>`).join("")
      : `<option value="">— sem Pokémon em campo —</option>`;
    if (prevSel) selEl.value = prevSel;

    // ── Linhas individuais
    if (!rows.length) {
      rowsEl.innerHTML = `<div class="card muted">Sem peças em campo para registrar iniciativa.</div>`;
    } else {
      rowsEl.innerHTML = rows.map(r => {
        const canEdit = isOwner || r.owner === this._by;
        const bonusVal = safeInt(this._bonusEdits[r.key] ?? r.bonus, 0);

        // cor da badge d20
        let d20Color = "rgba(255,255,255,.06)";
        let d20Border = "rgba(255,255,255,.16)";
        if (r.d20 === 20) { d20Color = "rgba(34,197,94,.15)"; d20Border = "rgba(34,197,94,.35)"; }
        else if (r.d20 === 1) { d20Color = "rgba(239,68,68,.15)"; d20Border = "rgba(239,68,68,.35)"; }
        else if (r.d20 > 0) { d20Color = "rgba(59,130,246,.12)"; d20Border = "rgba(59,130,246,.22)"; }

        return `
          <div class="card init-row" data-key="${esc(r.key)}"
               style="display:grid;grid-template-columns:160px 70px 55px 60px 90px 100px;gap:8px;align-items:center;margin-bottom:8px;padding:10px">

            <!-- Nome + dono -->
            <div>
              <div style="font-weight:900;font-size:.9rem">${esc(r.display)}</div>
              <div style="opacity:.7;font-size:.75rem">${esc(r.owner) || "—"} • ${esc(r.kind)}</div>
            </div>

            <!-- Speed -->
            <div style="text-align:center">
              <div style="font-size:.68rem;opacity:.7;margin-bottom:2px">Speed</div>
              <span style="padding:3px 8px;border-radius:999px;border:1px solid rgba(34,197,94,.22);background:rgba(34,197,94,.10);font-weight:900;font-size:.8rem">${r.kind === "Pokémon" ? r.speed : "—"}</span>
            </div>

            <!-- Mod -->
            <div style="text-align:center">
              <div style="font-size:.68rem;opacity:.7;margin-bottom:2px">Mod</div>
              <span style="padding:3px 8px;border-radius:999px;border:1px solid rgba(245,158,11,.22);background:rgba(245,158,11,.10);font-weight:900;font-size:.8rem">${r.kind === "Pokémon" ? (r.mod_speed >= 0 ? "+" : "") + r.mod_speed : "—"}</span>
            </div>

            <!-- d20 -->
            <div style="text-align:center">
              <div style="font-size:.68rem;opacity:.7;margin-bottom:2px">d20</div>
              <span style="padding:3px 8px;border-radius:999px;border:1px solid ${d20Border};background:${d20Color};font-weight:900;font-size:.8rem">${r.d20 > 0 ? r.d20 : "—"}</span>
            </div>

            <!-- Ajuste (editável) -->
            <div>
              <div style="font-size:.68rem;opacity:.7;margin-bottom:2px">Ajuste</div>
              <input type="number" class="input init-bonus-input" data-key="${esc(r.key)}"
                     value="${bonusVal}" min="-99" max="99" step="1"
                     ${canEdit ? "" : "disabled"}
                     style="width:100%;padding:4px 6px;font-size:.85rem;text-align:center" />
            </div>

            <!-- Iniciativa final -->
            <div style="text-align:center">
              <div style="font-size:.68rem;opacity:.7;margin-bottom:2px">Final</div>
              <span class="init-final-badge" data-key="${esc(r.key)}"
                    style="padding:5px 10px;border-radius:999px;border:1px solid rgba(59,130,246,.3);background:rgba(59,130,246,.15);font-weight:900;font-size:.95rem">${r.initiative}</span>
            </div>
          </div>
        `;
      }).join("");

      // ── Bind inputs de ajuste
      rowsEl.querySelectorAll(".init-bonus-input").forEach(input => {
        input.addEventListener("change", (e) => {
          const key = e.target.dataset.key;
          const val = safeInt(e.target.value, 0);
          this._bonusEdits[key] = val;
          // Atualiza badge final imediatamente (visual)
          const rec = rows.find(r => r.key === key);
          if (rec) {
            const d20v = safeInt((this._initStore[key] || {}).d20_roll, 0);
            const mod = rec.mod_speed;
            const fin = rec.kind === "Pokémon" && d20v > 0
              ? d20v + mod + val
              : rec.kind === "Avatar" ? val : 0;
            const badge = rowsEl.querySelector(`.init-final-badge[data-key="${key}"]`);
            if (badge) badge.textContent = fin;
          }
        });
      });
    }

    // ── Tabela de ordem
    const sorted = [...rows].sort((a, b) => {
      if (b.initiative !== a.initiative) return b.initiative - a.initiative;
      return a.display.localeCompare(b.display);
    });

    if (!sorted.length) {
      orderEl.innerHTML = `<div class="muted" style="font-size:.8rem">Sem dados ainda.</div>`;
    } else {
      orderEl.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:.85rem">
          <thead>
            <tr style="opacity:.6;font-size:.75rem">
              <th style="text-align:left;padding:4px 8px">#</th>
              <th style="text-align:left;padding:4px 8px">Dono</th>
              <th style="text-align:left;padding:4px 8px">Tipo</th>
              <th style="text-align:left;padding:4px 8px">Em campo</th>
              <th style="text-align:right;padding:4px 8px">Iniciativa</th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map((r, i) => `
              <tr style="border-top:1px solid rgba(255,255,255,.07);${i % 2 === 0 ? "background:rgba(255,255,255,.025)" : ""}">
                <td style="padding:6px 8px;font-weight:900;opacity:.7">${i + 1}</td>
                <td style="padding:6px 8px">${esc(r.owner) || "—"}</td>
                <td style="padding:6px 8px;opacity:.8">${esc(r.kind)}</td>
                <td style="padding:6px 8px;font-weight:700">${esc(r.display)}${r.owner ? " • " + esc(r.owner) : ""}</td>
                <td style="padding:6px 8px;text-align:right;font-weight:900;color:${r.initiative > 0 ? "#60a5fa" : "inherit"}">${r.initiative}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    }
  }

  // ─── Persiste no Firebase ──────────────────────────────────────────
  async _save(initiativeObj) {
    try {
      const ref = this._battleRef();
      await updateDoc(ref, { initiative: initiativeObj });
      console.log("[initiative] salvo ✅");
    } catch (err) {
      console.error("[initiative] erro ao salvar:", err);
      alert("Erro ao salvar iniciativa: " + err.message);
    }
  }
}
