import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

function safeInt(x, fallback = 0) {
  const n = parseInt(x, 10);
  return Number.isFinite(n) ? n : fallback;
}

function safeStr(x) {
  return String(x ?? "").trim();
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

async function playDiceRollAnimation(label, value) {
  try {
    if (typeof window !== "undefined" && typeof window.playDiceRollAnimation === "function") {
      await window.playDiceRollAnimation({ label, value });
    }
  } catch {}
}

function normalizeOwnerName(value) {
  return String(value || "").trim().toLowerCase();
}

function isSameOwner(a, b) {
  return normalizeOwnerName(a) !== "" && normalizeOwnerName(a) === normalizeOwnerName(b);
}

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

function extractSpeed(statsObj) {
  if (!statsObj || typeof statsObj !== "object") return 0;
  for (const k of ["speed", "spe", "spd", "velocidade", "vel", "Speed"]) {
    if (k in statsObj) return safeInt(statsObj[k], 0);
  }
  return 0;
}

const _speedCache = new Map();

function toPokeAPIName(raw) {
  const cleaned = String(raw || "")
    .replace(/^EXT:/i, "")
    .split(" - ")[0]
    .trim();
  if (!cleaned) return "";
  try {
    if (typeof window.spriteSlugFromPokemonName === "function") {
      const shared = String(window.spriteSlugFromPokemonName(cleaned) || "").trim().toLowerCase();
      if (shared) return shared;
    }
  } catch {}
  return cleaned
    .toLowerCase()
    .replace(/nidoran\s*(?:\u2640|\u00e2\u2122\u20ac)/g, "nidoran-f")
    .replace(/nidoran\s*(?:\u2642|\u00e2\u2122\u201a)/g, "nidoran-m")
    .replace(/(?:\u2640|\u00e2\u2122\u20ac)/g, "-f")
    .replace(/(?:\u2642|\u00e2\u2122\u201a)/g, "-m")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/^nidoranf$/g, "nidoran-f")
    .replace(/^nidoranm$/g, "nidoran-m");
}

async function fetchSpeedFromPokeAPI(name) {
  const key = toPokeAPIName(name);
  if (!key) return 0;
  if (_speedCache.has(key)) return _speedCache.get(key);

  try {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(key)}`);
    if (!res.ok) {
      _speedCache.set(key, 0);
      return 0;
    }
    const json = await res.json();
    const speedStat = (json.stats || []).find((s) => s.stat?.name === "speed");
    const val = safeInt(speedStat?.base_stat, 0);
    _speedCache.set(key, val);
    return val;
  } catch {
    _speedCache.set(key, 0);
    return 0;
  }
}

const INITIATIVE_STYLE_ID = "initiative-ui-style-v3";

function ensureInitiativeStyles() {
  if (document.getElementById(INITIATIVE_STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = INITIATIVE_STYLE_ID;
  st.textContent = `
    #tab_initiative .panel-inner{
      overflow:hidden;
    }
    #init_root.init-shell{
      height:100%;
      min-height:0;
      display:flex;
      flex-direction:column;
      gap:12px;
    }
    .init-shell-head{
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap:12px;
    }
    .init-shell-title{
      margin:0;
      font-size:1.08rem;
      font-weight:950;
      letter-spacing:.01em;
    }
    .init-shell-sub{
      margin-top:4px;
      font-size:.78rem;
      line-height:1.45;
      color:rgba(148,163,184,.95);
    }
    .init-board{
      flex:1 1 auto;
      min-height:0;
      display:grid;
      grid-template-columns:minmax(0,1fr) minmax(280px,340px);
      gap:12px;
      align-items:stretch;
    }
    .init-stage,
    .init-order-shell{
      min-height:0;
      display:flex;
      flex-direction:column;
      gap:10px;
    }
    .init-section-head{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:10px;
    }
    .init-section-title{
      font-size:.9rem;
      font-weight:900;
      letter-spacing:.01em;
    }
    .init-section-note{
      margin-top:3px;
      font-size:.76rem;
      color:rgba(148,163,184,.92);
    }
    .init-count-pill{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-width:28px;
      padding:4px 9px;
      border-radius:999px;
      border:1px solid rgba(148,163,184,.18);
      background:rgba(15,23,42,.58);
      font-size:.74rem;
      font-weight:900;
      color:rgba(226,232,240,.92);
    }
    .init-controls{
      margin-bottom:0;
      display:flex;
      flex-direction:column;
      gap:10px;
    }
    .init-controls-row{
      display:flex;
      gap:8px;
      flex-wrap:wrap;
      align-items:flex-end;
    }
    .init-select-row{
      display:flex;
      gap:6px;
      flex:1 1 280px;
      min-width:240px;
    }
    #init_rows{
      flex:1 1 auto;
      min-height:0;
      overflow:auto;
      padding-right:6px;
      display:grid;
      grid-template-columns:repeat(auto-fit,minmax(290px,1fr));
      gap:12px;
      align-content:start;
    }
    #init_order_table{
      flex:1 1 auto;
      min-height:0;
      overflow:auto;
      padding-right:4px;
      display:flex;
      flex-direction:column;
      gap:8px;
    }
    .init-empty{
      display:flex;
      align-items:center;
      justify-content:center;
      min-height:180px;
      text-align:center;
      color:rgba(148,163,184,.95);
    }
    .init-card{
      margin-bottom:0;
      display:flex;
      flex-direction:column;
      gap:12px;
      padding:14px;
      border-radius:18px;
      border:1px solid rgba(148,163,184,.16);
      background:
        radial-gradient(120% 140% at 0% 0%, rgba(56,189,248,.08), transparent 50%),
        linear-gradient(180deg, rgba(15,23,42,.8), rgba(9,14,29,.94));
      box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
    }
    .init-card.is-lead{
      border-color:rgba(56,189,248,.45);
      box-shadow:0 0 0 1px rgba(56,189,248,.16), inset 0 1px 0 rgba(255,255,255,.05);
    }
    .init-card.is-avatar{
      background:
        radial-gradient(120% 140% at 0% 0%, rgba(250,204,21,.08), transparent 55%),
        linear-gradient(180deg, rgba(15,23,42,.82), rgba(9,14,29,.94));
    }
    .init-card-top{
      display:flex;
      gap:12px;
      align-items:center;
      min-width:0;
    }
    .init-card-media{
      width:72px;
      height:72px;
      flex:0 0 72px;
      border-radius:18px;
      border:1px solid rgba(148,163,184,.18);
      background:rgba(15,23,42,.82);
      display:flex;
      align-items:center;
      justify-content:center;
      overflow:hidden;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
    }
    .init-card-media img{
      width:100%;
      height:100%;
      object-fit:contain;
      padding:6px;
    }
    .init-card-media-avatar{
      font-size:1.35rem;
      font-weight:950;
      color:#f8fafc;
      letter-spacing:.02em;
    }
    .init-card-copy{
      flex:1;
      min-width:0;
    }
    .init-card-name{
      font-size:1rem;
      font-weight:950;
      line-height:1.1;
      color:#f8fafc;
    }
    .init-card-meta{
      margin-top:4px;
      font-size:.78rem;
      line-height:1.4;
      color:rgba(148,163,184,.96);
    }
    .init-chip-row{
      display:flex;
      flex-wrap:wrap;
      gap:6px;
      margin-top:8px;
    }
    .init-chip{
      display:inline-flex;
      align-items:center;
      gap:4px;
      padding:4px 9px;
      border-radius:999px;
      border:1px solid rgba(148,163,184,.16);
      background:rgba(15,23,42,.65);
      font-size:.72rem;
      font-weight:900;
      color:rgba(226,232,240,.94);
    }
    .init-chip.speed{
      border-color:rgba(34,197,94,.24);
      color:#86efac;
    }
    .init-chip.mod{
      border-color:rgba(245,158,11,.24);
      color:#fcd34d;
    }
    .init-chip.d20{
      border-color:rgba(59,130,246,.24);
      color:#93c5fd;
    }
    .init-chip.dim{
      color:rgba(148,163,184,.92);
    }
    .init-final-stack{
      margin-left:auto;
      display:flex;
      flex-direction:column;
      align-items:flex-end;
      gap:4px;
      text-align:right;
    }
    .init-final-label{
      font-size:.68rem;
      letter-spacing:.08em;
      text-transform:uppercase;
      color:rgba(148,163,184,.86);
    }
    .init-final-badge{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-width:56px;
      padding:8px 12px;
      border-radius:14px;
      border:1px solid rgba(59,130,246,.32);
      background:rgba(59,130,246,.15);
      color:#dbeafe;
      font-weight:950;
      font-size:1rem;
      line-height:1;
    }
    .init-final-badge.is-zero{
      border-color:rgba(148,163,184,.18);
      background:rgba(15,23,42,.62);
      color:rgba(148,163,184,.96);
    }
    .init-card-controls{
      display:grid;
      grid-template-columns:repeat(4,minmax(0,1fr));
      gap:10px;
    }
    .init-metric{
      display:flex;
      flex-direction:column;
      gap:6px;
    }
    .init-metric-label{
      font-size:.68rem;
      letter-spacing:.08em;
      text-transform:uppercase;
      color:rgba(148,163,184,.84);
    }
    .init-metric-pill{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-height:38px;
      padding:0 10px;
      border-radius:12px;
      border:1px solid rgba(148,163,184,.16);
      background:rgba(15,23,42,.62);
      font-weight:900;
      color:#f8fafc;
    }
    .init-metric-pill.is-muted{
      color:rgba(148,163,184,.94);
    }
    .init-metric-pill.is-success{
      border-color:rgba(34,197,94,.26);
      color:#86efac;
    }
    .init-metric-pill.is-warn{
      border-color:rgba(245,158,11,.26);
      color:#fcd34d;
    }
    .init-metric-pill.is-crit{
      border-color:rgba(34,197,94,.35);
      background:rgba(34,197,94,.12);
    }
    .init-metric-pill.is-fail{
      border-color:rgba(239,68,68,.35);
      background:rgba(239,68,68,.12);
      color:#fca5a5;
    }
    .init-bonus-input{
      min-height:38px;
      text-align:center;
      font-weight:900;
    }
    .init-order-card{
      display:grid;
      grid-template-columns:42px minmax(0,1fr) auto;
      gap:10px;
      align-items:center;
      padding:12px;
      border-radius:16px;
      border:1px solid rgba(148,163,184,.16);
      background:linear-gradient(180deg, rgba(15,23,42,.76), rgba(9,14,29,.92));
    }
    .init-order-card.is-top{
      border-color:rgba(56,189,248,.45);
      box-shadow:0 0 0 1px rgba(56,189,248,.16) inset;
    }
    .init-order-rank{
      width:42px;
      height:42px;
      border-radius:12px;
      border:1px solid rgba(148,163,184,.18);
      background:rgba(15,23,42,.7);
      display:flex;
      align-items:center;
      justify-content:center;
      font-size:.9rem;
      font-weight:950;
      color:#f8fafc;
    }
    .init-order-card.is-top .init-order-rank{
      border-color:rgba(56,189,248,.4);
      color:#7dd3fc;
    }
    .init-order-copy{
      min-width:0;
    }
    .init-order-name{
      font-size:.9rem;
      font-weight:900;
      color:#f8fafc;
      line-height:1.15;
    }
    .init-order-meta{
      margin-top:3px;
      font-size:.76rem;
      color:rgba(148,163,184,.92);
    }
    .init-order-score{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-width:54px;
      padding:7px 11px;
      border-radius:12px;
      border:1px solid rgba(59,130,246,.28);
      background:rgba(59,130,246,.14);
      color:#dbeafe;
      font-size:.95rem;
      font-weight:950;
    }
    .init-order-score.is-zero{
      border-color:rgba(148,163,184,.16);
      background:rgba(15,23,42,.58);
      color:rgba(148,163,184,.96);
    }
    @media (max-width: 1100px){
      .init-board{
        grid-template-columns:1fr;
      }
      .init-order-shell{
        max-height:260px;
      }
    }
    @media (max-width: 760px){
      .init-card-controls{
        grid-template-columns:repeat(2,minmax(0,1fr));
      }
      .init-select-row{
        min-width:100%;
      }
      #init_rows{
        grid-template-columns:1fr;
      }
      .init-card-top{
        align-items:flex-start;
      }
    }
  `;
  document.head.appendChild(st);
}

export class InitiativeUI {
  constructor({ db, rid, by, role, container }) {
    ensureInitiativeStyles();
    this._db = db;
    this._rid = rid;
    this._by = by;
    this._role = role;
    this._container = container;

    this._initStore = {};
    this._battleData = {};
    this._pieces = [];
    this._partyStates = {};
    this._bonusEdits = {};

    this._unsubBattle = null;
    this._unsubState = null;
    this._unsubParty = null;

    this._render();
    this._subscribe();
  }

  _battleRef() {
    return doc(this._db, "rooms", this._rid, "public_state", "battle");
  }

  _stateRef() {
    return doc(this._db, "rooms", this._rid, "public_state", "state");
  }

  _partyStatesRef() {
    return doc(this._db, "rooms", this._rid, "public_state", "party_states");
  }

  async _publishRoll(value, label = "d20") {
    const rollValue = safeInt(value, 0);
    const rollLabel = safeStr(label) || "d20";
    const by = safeStr(this._by) || "Anon";
    if (!this._db || !this._rid || rollValue < 1 || rollValue > 20) return null;

    try {
      if (typeof window !== "undefined" && typeof window.publishPublicD20Roll === "function") {
        const ref = await window.publishPublicD20Roll({
          by,
          value: rollValue,
          rawValue: rollValue,
          label: rollLabel,
          animationLabel: rollLabel,
          final: true,
        });
        if (ref) return ref;
      }

      const requestId = `initiative_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const ref = await addDoc(collection(this._db, "rooms", this._rid, "rolls"), {
        by,
        trainer: by,
        value: rollValue,
        rawValue: rollValue,
        label: rollLabel,
        animationLabel: rollLabel,
        requestId,
        final: true,
        kind: "dice",
        die: "d20",
        clientCreatedAt: Date.now(),
        createdAt: serverTimestamp(),
      });
      if (typeof window !== "undefined" && typeof window.waitForSharedRollAnimation === "function") {
        await window.waitForSharedRollAnimation(requestId, { label: rollLabel, value: rollValue });
      }
      return ref;
    } catch (err) {
      console.warn("[initiative] falha ao publicar rolagem:", err);
      return null;
    }
  }

  _subscribe() {
    this._unsubBattle = onSnapshot(this._battleRef(), (snap) => {
      this._battleData = snap.exists() ? (snap.data() || {}) : {};
      this._initStore = this._battleData.initiative || {};
      this._renderRows();
    });

    this._unsubState = onSnapshot(this._stateRef(), (snap) => {
      this._pieces = snap.exists() ? (snap.data()?.pieces || []) : [];
      this._renderRows();
    });

    this._unsubParty = onSnapshot(this._partyStatesRef(), (snap) => {
      this._partyStates = snap.exists() ? (snap.data() || {}) : {};
      this._renderRows();
    });
  }

  destroy() {
    try { this._unsubBattle?.(); } catch {}
    try { this._unsubState?.(); } catch {}
    try { this._unsubParty?.(); } catch {}
  }

  _render() {
    this._container.innerHTML = `
      <div id="init_root" class="init-shell">
        <div class="init-shell-head">
          <div>
            <h3 class="init-shell-title">Iniciativa</h3>
            <div class="init-shell-sub">Speed -> Mod: 1-40=-4, 41-60=-1, 61-70=0, 71-80=+1, 81-100=+2, 101-120=+4, 121+=+8</div>
          </div>
        </div>

        <div class="card init-controls">
          <div class="init-controls-row">
            <button class="btn" id="init_roll_all" style="display:none">Rolar todos (Pokemon em campo)</button>

            <div class="init-select-row">
              <select class="input" id="init_sel_pokemon" style="flex:1"></select>
              <button class="btn secondary" id="init_roll_sel">Rolar selecionado</button>
            </div>

            <button class="btn" id="init_save" style="background:#2563eb">Salvar iniciativa</button>
            <button class="btn secondary" id="init_reset_all" style="display:none">Resetar todos</button>
          </div>
          <div class="init-section-note" id="init_perm_note"></div>
        </div>

        <div class="init-board">
          <section class="init-stage">
            <div class="init-section-head">
              <div>
                <div class="init-section-title">Pecas em campo</div>
                <div class="init-section-note">Os cards sao reordenados assim que a iniciativa muda.</div>
              </div>
              <span class="init-count-pill" id="init_rows_count">0</span>
            </div>
            <div id="init_rows"></div>
          </section>

          <aside class="card init-order-shell">
            <div class="init-section-head">
              <div>
                <div class="init-section-title">Ordem automatica</div>
                <div class="init-section-note">Ranking atual da rodada com base na iniciativa salva.</div>
              </div>
            </div>
            <div id="init_order_table"></div>
          </aside>
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
      permNote.textContent = "Voce e o owner: pode rolar e editar qualquer Pokemon.";
    } else {
      permNote.textContent = "Voce pode rolar e editar apenas os seus proprios Pokemon.";
    }

    rollAllBtn.addEventListener("click", async () => {
      const rows = this._buildRows();
      const pokemon = rows.filter((r) => r.kind === "Pokemon");
      const out = { ...this._initStore };
      for (const rec of pokemon) {
        const roll = d20();
        await this._publishRoll(roll, `Iniciativa - ${rec.display || "Pokemon"}`);
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

    this._container.querySelector("#init_roll_sel").addEventListener("click", async () => {
      const sel = this._container.querySelector("#init_sel_pokemon").value;
      if (!sel) return;
      const rows = this._buildRows();
      const rec = rows.find((r) => r.key === sel);
      if (!rec) return;

      const isOwnerNow = this._role === "owner" || this._role === "gm";
      if (!isOwnerNow && !isSameOwner(rec.owner, this._by)) {
        alert("Voce so pode rolar iniciativa dos seus proprios Pokemon.");
        return;
      }

      const roll = d20();
      await this._publishRoll(roll, `Iniciativa - ${rec.display || "Pokemon"}`);
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

    this._container.querySelector("#init_save").addEventListener("click", async () => {
      const out = { ...this._initStore };
      for (const [key, bonus] of Object.entries(this._bonusEdits)) {
        const prev = out[key] || {};
        const d20val = safeInt(prev.d20_roll, 0);
        const mod = safeInt(prev.speed_mod, 0);
        const isTrainer = key.startsWith("trainer:");
        out[key] = {
          ...prev,
          bonus_input: bonus,
          initiative: isTrainer ? bonus : (d20val > 0 ? d20val + mod + bonus : bonus),
        };
      }
      await this._save(out);
      this._bonusEdits = {};
    });

    resetAllBtn.addEventListener("click", async () => {
      if (!confirm("Zerar todas as iniciativas?")) return;
      await this._save({});
      this._bonusEdits = {};
    });
  }

  _buildRows() {
    const rows = [];

    for (const p of this._pieces) {
      const pieceKind = String(p?.kind || "piece");
      const isTrainer = pieceKind === "trainer";
      const isPokemon = !isTrainer && String(p?.pid || "").trim() !== "";
      if (!isTrainer && !isPokemon) continue;
      if (isPokemon && String(p?.status || "active") !== "active") continue;

      const key = `${pieceKind}:${p.id}`;
      const owner = String(p?.owner || "");
      const pid = isTrainer ? "" : String(p?.pid || "");

      let display = owner || "Treinador";
      let speedVal = 0;
      let speedMod = 0;

      if (!isTrainer) {
        const presentation = typeof window.getEffectivePokemonPresentationForTrainerPid === "function"
          ? window.getEffectivePokemonPresentationForTrainerPid(owner, p, { piece: p })
          : null;
        if (presentation?.display_name) {
          display = presentation.display_name;
        } else if (window.dexMap) {
          const mapped = window.dexMap[pid] || window.dexMap[String(Number(pid))];
          display = mapped || p?.name || p?.display_name || pid || "Pokemon";
        } else {
          display = p?.name || p?.display_name || pid || "Pokemon";
        }

        const ownerParty = this._partyStates[owner] || {};
        const pokeData = ownerParty[pid] || ownerParty[String(Number(pid))] || {};
        speedVal = extractSpeed(pokeData.stats || {});

        if (speedVal === 0) {
          speedVal = extractSpeed(p?.stats || p?.poke_stats || {});
        }

        const cacheKey = toPokeAPIName(pid.startsWith("EXT:") ? pid : display);
        if (speedVal === 0 && _speedCache.has(cacheKey)) {
          speedVal = _speedCache.get(cacheKey);
        }

        if (speedVal === 0 && !_speedCache.has(cacheKey)) {
          const nameForAPI = pid.startsWith("EXT:") ? pid : display;
          fetchSpeedFromPokeAPI(nameForAPI).then((val) => {
            if (val > 0) this._renderRows();
          });
        }

        speedMod = speedToMod(speedVal);
      }

      const saved = this._initStore[key] || {};
      const d20Roll = safeInt(saved.d20_roll, 0);
      const bonusInput = safeInt(this._bonusEdits[key] ?? saved.bonus_input, 0);
      const initiative = isTrainer
        ? bonusInput
        : (d20Roll > 0 ? d20Roll + speedMod + bonusInput : 0);

      rows.push({
        key,
        pieceId: String(p?.id || ""),
        pieceKind,
        piece: p,
        owner,
        kind: isTrainer ? "Avatar" : "Pokemon",
        pid,
        partySlot: String(p?.party_slot || ""),
        display,
        speed: speedVal,
        mod_speed: speedMod,
        d20: d20Roll,
        bonus: bonusInput,
        initiative,
      });
    }

    return rows;
  }

  _hasInitiativeData(row) {
    if (!row) return false;
    if (row.kind === "Avatar") return row.bonus !== 0;
    return row.d20 > 0 || row.bonus !== 0 || row.initiative !== 0;
  }

  _compareRows(a, b) {
    const aReady = this._hasInitiativeData(a) ? 1 : 0;
    const bReady = this._hasInitiativeData(b) ? 1 : 0;
    if (bReady !== aReady) return bReady - aReady;
    if (b.initiative !== a.initiative) return b.initiative - a.initiative;
    const byOwner = String(a.owner || "").localeCompare(String(b.owner || ""));
    if (byOwner !== 0) return byOwner;
    return String(a.display || "").localeCompare(String(b.display || ""));
  }

  _metricTone(type, value) {
    if (type === "speed") return value > 0 ? " is-success" : " is-muted";
    if (type === "mod") return value > 0 ? " is-warn" : (value < 0 ? " is-muted" : "");
    if (type === "d20") {
      if (value === 20) return " is-crit";
      if (value === 1) return " is-fail";
      if (value > 0) return "";
      return " is-muted";
    }
    return value ? "" : " is-muted";
  }

  _mediaHtml(row) {
    const initial = esc((row.kind === "Avatar" ? row.owner : row.display).slice(0, 2).toUpperCase() || "?");
    if (row.kind === "Avatar") {
      return `<div class="init-card-media"><span class="init-card-media-avatar">${initial}</span></div>`;
    }

    const sprite = (typeof window.getEffectiveSpriteUrlForTrainerPid === "function"
      ? (window.getEffectiveSpriteUrlForTrainerPid(row.owner, row.piece || { pid: row.pid, party_slot: row.partySlot }, { type: "art" }) || "")
      : "")
      || (typeof window.getSpriteUrlFromPid === "function"
        ? (window.getSpriteUrlFromPid(row.pid || row.display, { type: "art" }) ||
           window.getSpriteUrlFromPid(row.display, { type: "art" }) || "")
        : "");

    if (!sprite) {
      return `<div class="init-card-media"><span class="init-card-media-avatar">${initial}</span></div>`;
    }

    return `<div class="init-card-media"><img src="${esc(sprite)}" alt="${esc(row.display)}" loading="lazy" onerror="this.style.display='none';this.parentElement.innerHTML='<span class=&quot;init-card-media-avatar&quot;>${initial}</span>'" /></div>`;
  }

  _renderCard(row, index, isOwner) {
    const canEditPokemon = row.kind === "Pokemon" && isSameOwner(row.owner, this._by);
    const canEdit = isOwner || canEditPokemon;
    const bonusVal = safeInt(this._bonusEdits[row.key] ?? row.bonus, 0);
    const leadClass = index === 0 && this._hasInitiativeData(row) ? " is-lead" : "";
    const avatarClass = row.kind === "Avatar" ? " is-avatar" : "";
    const finalClass = row.initiative === 0 ? " is-zero" : "";
    const speedText = row.kind === "Pokemon" ? row.speed : "--";
    const modText = row.kind === "Pokemon" ? `${row.mod_speed >= 0 ? "+" : ""}${row.mod_speed}` : "--";
    const d20Text = row.d20 > 0 ? row.d20 : "--";
    const pidText = row.pid ? `PID ${esc(row.pid)}` : "Sem PID";
    const ownerText = esc(row.owner) || "--";

    return `
      <article class="card init-card${leadClass}${avatarClass}" data-key="${esc(row.key)}">
        <div class="init-card-top">
          ${this._mediaHtml(row)}
          <div class="init-card-copy">
            <div class="init-card-name">${esc(row.display)}</div>
            <div class="init-card-meta">${ownerText} • ${esc(row.kind)} • ${pidText}</div>
            <div class="init-chip-row">
              <span class="init-chip speed">Speed ${esc(speedText)}</span>
              <span class="init-chip mod">Mod ${esc(modText)}</span>
              <span class="init-chip d20">d20 ${esc(d20Text)}</span>
            </div>
          </div>
          <div class="init-final-stack">
            <span class="init-final-label">Final</span>
            <span class="init-final-badge${finalClass}">${row.initiative}</span>
          </div>
        </div>
        <div class="init-card-controls">
          <div class="init-metric">
            <span class="init-metric-label">Speed</span>
            <span class="init-metric-pill${this._metricTone("speed", row.speed)}">${esc(speedText)}</span>
          </div>
          <div class="init-metric">
            <span class="init-metric-label">Mod</span>
            <span class="init-metric-pill${this._metricTone("mod", row.mod_speed)}">${esc(modText)}</span>
          </div>
          <div class="init-metric">
            <span class="init-metric-label">d20</span>
            <span class="init-metric-pill${this._metricTone("d20", row.d20)}">${esc(d20Text)}</span>
          </div>
          <label class="init-metric">
            <span class="init-metric-label">Ajuste</span>
            <input
              type="number"
              class="input init-bonus-input"
              data-key="${esc(row.key)}"
              value="${bonusVal}"
              min="-99"
              max="99"
              step="1"
              ${canEdit ? "" : "disabled"}
            />
          </label>
        </div>
      </article>
    `;
  }

  _renderOrderCard(row, index) {
    const topClass = index === 0 ? " is-top" : "";
    const scoreClass = row.initiative === 0 ? " is-zero" : "";
    return `
      <div class="init-order-card${topClass}">
        <div class="init-order-rank">${index + 1}</div>
        <div class="init-order-copy">
          <div class="init-order-name">${esc(row.display)}</div>
          <div class="init-order-meta">${esc(row.owner) || "--"} • ${esc(row.kind)}</div>
        </div>
        <div class="init-order-score${scoreClass}">${row.initiative}</div>
      </div>
    `;
  }

  _renderRows() {
    const rows = this._buildRows();
    const sortedRows = [...rows].sort((a, b) => this._compareRows(a, b));
    const isOwner = this._role === "owner" || this._role === "gm";
    const rowsEl = this._container.querySelector("#init_rows");
    const rowsCountEl = this._container.querySelector("#init_rows_count");
    const selEl = this._container.querySelector("#init_sel_pokemon");
    const orderEl = this._container.querySelector("#init_order_table");
    if (!rowsEl || !selEl || !orderEl) return;

    if (rowsCountEl) rowsCountEl.textContent = String(sortedRows.length);

    const pool = (isOwner
      ? sortedRows.filter((r) => r.kind === "Pokemon")
      : sortedRows.filter((r) => r.kind === "Pokemon" && isSameOwner(r.owner, this._by)));

    const prevSel = selEl.value;
    selEl.innerHTML = pool.length
      ? pool.map((r) => `<option value="${esc(r.key)}">${esc(r.display)} • ${esc(r.owner)}</option>`).join("")
      : `<option value="">-- sem Pokemon em campo --</option>`;
    if (prevSel && pool.some((r) => r.key === prevSel)) {
      selEl.value = prevSel;
    }

    if (!sortedRows.length) {
      rowsEl.innerHTML = `<div class="card init-empty">Sem pecas em campo para registrar iniciativa.</div>`;
    } else {
      rowsEl.innerHTML = sortedRows.map((row, index) => this._renderCard(row, index, isOwner)).join("");

      rowsEl.querySelectorAll(".init-bonus-input").forEach((input) => {
        input.addEventListener("change", (ev) => {
          const key = ev.target.dataset.key;
          this._bonusEdits[key] = safeInt(ev.target.value, 0);
          this._renderRows();
        });
      });

      rowsEl.querySelectorAll(".init-card").forEach((card) => {
        card.addEventListener("click", (ev) => {
          if (ev.target.closest(".init-bonus-input")) return;
          const key = card.dataset.key;
          if (selEl.querySelector(`option[value="${CSS.escape(key)}"]`)) {
            selEl.value = key;
          }
        });
      });
    }

    const orderedRows = sortedRows.filter((row) => this._hasInitiativeData(row));
    if (!orderedRows.length) {
      orderEl.innerHTML = `<div class="init-empty">Rode os dados para montar a ordem da rodada.</div>`;
    } else {
      orderEl.innerHTML = orderedRows.map((row, index) => this._renderOrderCard(row, index)).join("");
    }
  }

  async _save(initiativeObj) {
    try {
      await updateDoc(this._battleRef(), { initiative: initiativeObj });
      console.log("[initiative] salvo");
    } catch (err) {
      console.error("[initiative] erro ao salvar:", err);
      alert("Erro ao salvar iniciativa: " + err.message);
    }
  }
}
