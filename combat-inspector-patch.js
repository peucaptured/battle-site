/**
 * combat-inspector-patch.js  (v3 — busca por nome com PokeAPI)
 *
 * O que faz:
 *  1. Exibe tabela de Fraquezas & Resistências do alvo selecionado.
 *     Resolve os tipos pelo NOME do Pokémon, na seguinte ordem:
 *       a) Ficha Firestore (tSheet.pokemon.types)  — mais rápido, se disponível
 *       b) PokeAPI buscando pelo nome normalizado  — fallback online robusto
 *
 *     Normalização de nomes (mesma lógica do main.js):
 *       -a → Alola  |  -g → Galar  |  -h → Hisui  |  -p → Paldea
 *       Muk-A, A-Muk, Alolan Muk, Muk (Alola) → todos viram "muk-alola"
 *
 *  2. Injeta campos "Bônus de Acerto" e "Bônus de Dano" antes do botão Rolar.
 *
 *  3. Aplica os modificadores: acerto → somado ao input antes do d20;
 *     dano → pré-preenchido no campo de Rank na fase hit_confirmed.
 *
 * Instalação:
 *   No final do <body> do index.html, DEPOIS de combat-patch.js:
 *   <script type="module" src="./combat-inspector-patch.js"></script>
 */

import {
  getTypeColor,
  getTypeAdvantage,
  TYPE_CHART,
  normalizeType,
} from "./type-data.js";

// ═══════════════════════════════════════════════════════════════════
// NORMALIZAÇÃO DE NOME → SLUG POKEAPI
// ═══════════════════════════════════════════════════════════════════

/**
 * Normaliza variações regionais para o sufixo padrão.
 * Suporta todas as convenções usadas no sistema:
 *   "Muk-A"       → "Muk-Alola"
 *   "A-Muk"       → "Muk-Alola"
 *   "Alolan Muk"  → "Muk-Alola"
 *   "Muk (Alola)" → "Muk-Alola"
 *   "Ponyta-G"    → "Ponyta-Galar"
 *   "Sneasel-H"   → "Sneasel-Hisui"
 */
function normalizeName(raw) {
  let n = String(raw || "").trim();
  if (!n) return "";

  // Remove prefixo EXT:
  n = n.replace(/^EXT:/i, "").trim();

  // Remove sufixo " - Delta", " - Mega", etc. (apenas forma regional nos atalhos abaixo)
  // NÃO removemos aqui pois podem ser formas válidas

  // Formato "(Região)"
  n = n.replace(/\s*\(\s*alola\s*\)\s*/ig,  "-Alola");
  n = n.replace(/\s*\(\s*galar\s*\)\s*/ig,  "-Galar");
  n = n.replace(/\s*\(\s*hisui\s*\)\s*/ig,  "-Hisui");
  n = n.replace(/\s*\(\s*paldea\s*\)\s*/ig, "-Paldea");

  // Adjetivos no início: "Alolan X", "Galarian X", "Hisuian X", "Paldean X"
  if (/\balolan\b/i.test(n))   n = n.replace(/\balolan\b\s*/ig,   "") + "-Alola";
  if (/\bgalarian\b/i.test(n)) n = n.replace(/\bgalarian\b\s*/ig, "") + "-Galar";
  if (/\bhisuian\b/i.test(n))  n = n.replace(/\bhisuian\b\s*/ig,  "") + "-Hisui";
  if (/\bpaldean\b/i.test(n))  n = n.replace(/\bpaldean\b\s*/ig,  "") + "-Paldea";

  // Sufixos curtos no FIM da string: "Nome-A", "Nome-G", "Nome-H", "Nome-P"
  // Usa \b para não capturar "-Alakazam" como "-A"
  n = n.replace(/-\bA\b$/i, "-Alola");
  n = n.replace(/-\bG\b$/i, "-Galar");
  n = n.replace(/-\bH\b$/i, "-Hisui");
  n = n.replace(/-\bP\b$/i, "-Paldea");

  // Prefixos curtos no INÍCIO: "A-Nome", "G-Nome", "H-Nome", "P-Nome"
  n = n.replace(/^\bA\b-/i, "").replace(/(.+)$/, "$1-Alola");  // complexo, melhor fazer split
  // Reescreve de forma mais segura:
  n = _applyPrefixForm(n);

  return n.trim();
}

function _applyPrefixForm(n) {
  const PREFIX_MAP = [
    [/^a-(.+)/i, "$1-Alola"],
    [/^g-(.+)/i, "$1-Galar"],
    [/^h-(.+)/i, "$1-Hisui"],
    [/^p-(.+)/i, "$1-Paldea"],
  ];
  for (const [re, rep] of PREFIX_MAP) {
    if (re.test(n)) return n.replace(re, rep);
  }
  return n;
}

/**
 * Converte nome normalizado em slug PokeAPI lowercase-hyphenated.
 * Ex: "Muk-Alola" → "muk-alola"
 *     "Mr. Mime"  → "mr-mime"
 */
function nameToPokeAPISlug(name) {
  let slug = normalizeName(name)
    .toLowerCase()
    .replace(/♀/g, "f")
    .replace(/♂/g, "m")
    .replace(/[''‛′'`\.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  // Garante convenção PokeAPI (não PokemonDB)
  slug = slug
    .replace(/-alolan$/, "-alola")
    .replace(/-galarian$/, "-galar")
    .replace(/-hisuian$/, "-hisui")
    .replace(/-paldean$/, "-paldea");

  // Formas padrão que a PokeAPI exige com sufixo específico
  const DEFAULTS = {
    "mimikyu":     "mimikyu-disguised",
    "aegislash":   "aegislash-blade",
    "giratina":    "giratina-altered",
    "wishiwashi":  "wishiwashi-solo",
    "lycanroc":    "lycanroc-midday",
    "deoxys":      "deoxys-normal",
    "shaymin":     "shaymin-land",
    "keldeo":      "keldeo-ordinary",
    "meloetta":    "meloetta-aria",
    "darmanitan":  "darmanitan-standard",
    "eiscue":      "eiscue-ice",
    "morpeko":     "morpeko-full-belly",
    "urshifu":     "urshifu-single-strike",
    "toxtricity":  "toxtricity-amped",
    "minior":      "minior-red-meteor",
    "indeedee":    "indeedee-male",
    "basculegion": "basculegion-male",
    "enamorus":    "enamorus-incarnate",
    "wormadam":    "wormadam-plant",
    "pumpkaboo":   "pumpkaboo-average",
    "gourgeist":   "gourgeist-average",
  };
  return DEFAULTS[slug] || slug;
}

// ═══════════════════════════════════════════════════════════════════
// CACHE + FETCH POKEAPI
// ═══════════════════════════════════════════════════════════════════
const _typeCache = new Map(); // slug → string[] | "pending" | "error"

async function fetchTypesFromAPI(slug) {
  if (!slug) return [];

  if (_typeCache.has(slug)) {
    const v = _typeCache.get(slug);
    return (v === "pending" || v === "error") ? [] : v;
  }

  _typeCache.set(slug, "pending");

  try {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // PokeAPI retorna lowercase; capitalize para bater com TYPE_CHART
    const types = (data.types || [])
      .sort((a, b) => a.slot - b.slot)
      .map(t => {
        const n = String(t.type?.name || "");
        return n.charAt(0).toUpperCase() + n.slice(1);
      })
      .filter(Boolean);

    _typeCache.set(slug, types);
    return types;
  } catch (err) {
    console.warn(`[combat-inspector-patch] PokeAPI falhou para "${slug}":`, err.message);
    _typeCache.set(slug, "error");
    return [];
  }
}

/**
 * Resolve tipos do alvo.
 * 1. Tenta ficha Firestore
 * 2. Resolve nome do Pokémon → slug → PokeAPI
 */
async function resolveTypes(ui, tOwner, tPid) {
  // 1) Ficha Firestore
  if (typeof ui._getSheet === "function") {
    const sheet = ui._getSheet(tOwner, tPid);
    const fromSheet = sheet?.pokemon?.types;
    if (Array.isArray(fromSheet) && fromSheet.length) {
      return { types: fromSheet, source: "ficha" };
    }
  }

  // 2) Obtém o NOME do Pokémon a partir do pid
  //    Reutiliza o dexMap global que o main.js carrega
  let pokemonName = "";

  if (window.dexMap) {
    pokemonName =
      window.dexMap[String(tPid)] ||
      window.dexMap[String(Number(tPid))] ||   // remove zero-padding
      "";
  }

  // pid com prefixo EXT: já carrega o nome embutido
  if (!pokemonName && String(tPid).startsWith("EXT:")) {
    pokemonName = String(tPid).slice(4).trim();
  }

  // Último recurso: usa o próprio pid como nome (ex: "Gallade", "Muk-A")
  if (!pokemonName) pokemonName = String(tPid);

  const slug = nameToPokeAPISlug(pokemonName);
  if (!slug) return { types: [], source: "—" };

  const types = await fetchTypesFromAPI(slug);
  return {
    types,
    source: types.length ? `PokeAPI (${slug})` : `não encontrado (${slug})`,
  };
}

// ═══════════════════════════════════════════════════════════════════
// HTML DA TABELA DE TIPOS
// ═══════════════════════════════════════════════════════════════════
function buildTypeTable(types, source) {
  if (!types || !types.length) {
    return `<div style="font-size:11px;color:rgba(148,163,184,.4);padding:5px 8px;
      border-radius:8px;background:rgba(0,0,0,.18);margin-bottom:10px">
      ⚠️ Tipos não encontrados — tabela indisponível.
    </div>`;
  }

  const normalized = types.map(t => normalizeType(t)).filter(Boolean);
  const ALL_TYPES = Object.keys(TYPE_CHART);

  const GROUPS = {
    4:    { label: "Fraqueza 4×", bonus: "+4", icon: "💀", color: "#ef4444" },
    2:    { label: "Fraqueza 2×", bonus: "+2", icon: "⚠️", color: "#fb923c" },
    0.5:  { label: "Resist. ½",   bonus: "−2", icon: "🛡️", color: "#4ade80" },
    0.25: { label: "Resist. ¼",   bonus: "−4", icon: "🛡🛡", color: "#22c55e" },
    0:    { label: "Imunidade",   bonus: "−6", icon: "🚫", color: "#94a3b8" },
  };

  const buckets = { 4: [], 2: [], 0.5: [], 0.25: [], 0: [] };
  for (const atk of ALL_TYPES) {
    const mult = getTypeAdvantage(atk, normalized);
    if      (mult === 0)   buckets[0].push(atk);
    else if (mult >= 4)    buckets[4].push(atk);
    else if (mult >= 2)    buckets[2].push(atk);
    else if (mult <= 0.25) buckets[0.25].push(atk);
    else if (mult < 1)     buckets[0.5].push(atk);
  }

  const pill = (type) => {
    const c = getTypeColor(type);
    return `<span style="display:inline-block;padding:1px 7px;border-radius:8px;font-size:11px;
      font-weight:700;background:${c}28;border:1px solid ${c}55;color:${c};
      margin:2px 2px;white-space:nowrap">${type}</span>`;
  };

  let rows = "";
  for (const key of [4, 2, 0.5, 0.25, 0]) {
    if (!buckets[key].length) continue;
    const g = GROUPS[key];
    rows += `
      <div style="display:flex;align-items:flex-start;gap:8px;padding:5px 8px;border-radius:8px;
        margin-bottom:4px;background:${g.color}14;border-left:3px solid ${g.color}66">
        <span style="font-size:13px;min-width:18px;margin-top:1px">${g.icon}</span>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
            <span style="font-size:11px;font-weight:800;color:${g.color}">${g.label}</span>
            <span style="font-size:10px;font-weight:900;padding:1px 5px;border-radius:5px;
              background:${g.color}33;color:${g.color}">${g.bonus}</span>
          </div>
          <div style="display:flex;flex-wrap:wrap">${buckets[key].map(pill).join("")}</div>
        </div>
      </div>`;
  }

  if (!rows) {
    rows = `<div style="font-size:11px;color:rgba(148,163,184,.5);padding:4px 8px">
      Sem fraquezas ou resistências especiais.</div>`;
  }

  const typePills = types.map(t => {
    const c = getTypeColor(normalizeType(t));
    return `<span style="padding:2px 9px;border-radius:10px;font-size:12px;font-weight:800;
      background:${c}28;border:1px solid ${c}66;color:${c}">${t}</span>`;
  }).join(" ");

  return `
    <div style="border-radius:12px;border:1px solid rgba(56,189,248,.22);
      background:rgba(3,8,29,.55);padding:10px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:900;color:rgba(148,163,184,.8)">
          ⚔️ Fraquezas &amp; Resistências
        </span>
        <span style="flex:1"></span>
        ${typePills}
      </div>
      ${rows}
      <div style="font-size:10px;color:rgba(148,163,184,.28);margin-top:5px;text-align:right">
        via ${source}
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════
// PAINEL DE MODIFICADORES MANUAIS
// ═══════════════════════════════════════════════════════════════════
const MOD_ID = "cb_manual_mods_panel";

function buildModPanel() {
  return `
    <div id="${MOD_ID}" style="border-radius:12px;border:1px solid rgba(251,191,36,.28);
      background:rgba(251,191,36,.06);padding:10px;margin-bottom:10px">
      <div style="font-size:12px;font-weight:900;color:rgba(251,191,36,.9);margin-bottom:8px">
        🎛️ Modificadores Manuais
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <label style="display:flex;flex-direction:column;gap:3px">
          <span style="font-size:11px;font-weight:700;color:rgba(148,163,184,.8)">Bônus de Acerto</span>
          <input id="cb_mod_acc" class="input" type="number" value="0" placeholder="0"
            style="font-size:13px;padding:6px 8px;border-radius:8px" />
          <span style="font-size:10px;color:rgba(148,163,184,.4)">Soma ao modificador do golpe</span>
        </label>
        <label style="display:flex;flex-direction:column;gap:3px">
          <span style="font-size:11px;font-weight:700;color:rgba(148,163,184,.8)">Bônus de Dano</span>
          <input id="cb_mod_dmg" class="input" type="number" value="0" placeholder="0"
            style="font-size:13px;padding:6px 8px;border-radius:8px" />
          <span style="font-size:10px;color:rgba(148,163,184,.4)">Soma ao rank do golpe</span>
        </label>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════
// INICIALIZAÇÃO — aguarda CombatUI e aplica os patches
// ═══════════════════════════════════════════════════════════════════
function waitForCombatUI(cb, tries = 0) {
  const ui = window._combatUI;
  if (ui && typeof ui._renderSetup === "function") {
    cb(ui);
  } else if (tries < 80) {
    setTimeout(() => waitForCombatUI(cb, tries + 1), 250);
  } else {
    console.warn("[combat-inspector-patch] ⚠️ CombatUI não encontrado após 20s.");
  }
}

waitForCombatUI((ui) => {

  // ── PATCH 1: _renderSetup ────────────────────────────────────────
  const _origSetup = ui._renderSetup.bind(ui);

  ui._renderSetup = async function (battle, isPlayer, by) {
    await _origSetup(battle, isPlayer, by);

    // Só o atacante enxerga os painéis extras
    if (String(battle?.attacker || "").trim() !== by) return;

    const body = this._body;
    if (!body) return;

    // Painel de modificadores — insere antes do botão Rolar
    const normalPanel = body.querySelector("#cb_normal_panel");
    const rollBtn = normalPanel?.querySelector("#cb_roll_attack");
    if (rollBtn && !body.querySelector(`#${MOD_ID}`)) {
      const wrap = document.createElement("div");
      wrap.innerHTML = buildModPanel();
      normalPanel.insertBefore(wrap.firstElementChild, rollBtn);
    }

    // Tabela de tipos — insere logo após o select de alvo
    const targetSel = body.querySelector("#cb_atk_target");
    if (!targetSel) return;

    let typeWrap = body.querySelector("#cb_target_type_wrap");
    if (!typeWrap) {
      typeWrap = document.createElement("div");
      typeWrap.id = "cb_target_type_wrap";
      targetSel.parentNode.insertBefore(typeWrap, targetSel.nextSibling);
    }

    const renderTypeTable = async () => {
      const opt = targetSel.selectedOptions[0];
      if (!opt?.value) { typeWrap.innerHTML = ""; return; }

      const tOwner = opt.dataset.owner;
      const tPid   = opt.dataset.pid;
      if (!tOwner || !tPid) { typeWrap.innerHTML = ""; return; }

      typeWrap.innerHTML = `<div style="font-size:11px;color:rgba(148,163,184,.4);
        padding:4px 8px;margin-bottom:6px">🔍 Buscando tipos…</div>`;

      // Tenta carregar ficha do alvo no Firestore antes de ir à PokeAPI
      if (this._loadSheets && this._sheetUnsubs && !this._sheetUnsubs.has(tOwner)) {
        try { await this._loadSheets(tOwner); } catch {}
      }

      const { types, source } = await resolveTypes(this, tOwner, tPid);
      typeWrap.innerHTML = buildTypeTable(types, source);
    };

    // Carrega para o alvo já selecionado
    await renderTypeTable();

    // Atualiza ao mudar de alvo (sem listener duplicado)
    if (!targetSel._patchListener) {
      targetSel._patchListener = renderTypeTable;
      targetSel.addEventListener("change", renderTypeTable);
    }
  };

  // ── PATCH 2: intercepta clique em Rolar Ataque (capture) ────────
  let _lastBody = null;

  const hookBody = (body) => {
    if (!body || body === _lastBody) return;
    _lastBody = body;

    body.addEventListener("click", (e) => {
      if (!e.target.closest("#cb_roll_attack")) return;

      const accInput = body.querySelector("#cb_atk_accuracy");
      const modAcc   = parseInt(body.querySelector("#cb_mod_acc")?.value || "0", 10) || 0;
      const modDmg   = parseInt(body.querySelector("#cb_mod_dmg")?.value || "0", 10) || 0;

      if (accInput && modAcc !== 0) {
        accInput.value = String((parseInt(accInput.value, 10) || 0) + modAcc);
      }

      ui._pendingDmgMod = modDmg;

    }, true); // capture: antes do listener do combat.js
  };

  // Roda periodicamente para pegar novos _body (troca de fase)
  setInterval(() => {
    const body = ui._body;
    if (body && body !== _lastBody) hookBody(body);
  }, 300);

  // ── PATCH 3: _renderHitConfirmed — aplica mod de dano no Rank ───
  const _origHitConfirmed = ui._renderHitConfirmed.bind(ui);

  ui._renderHitConfirmed = function (battle, by) {
    const mod = this._pendingDmgMod || 0;
    if (mod !== 0 && battle?.attack_move) {
      battle = {
        ...battle,
        attack_move: {
          ...battle.attack_move,
          damage: (battle.attack_move.damage || 0) + mod,
        },
      };
      this._pendingDmgMod = 0;
    }
    return _origHitConfirmed(battle, by);
  };

  console.log("[combat-inspector-patch] ✅ v3 ativo — busca por nome + PokeAPI.");
});
