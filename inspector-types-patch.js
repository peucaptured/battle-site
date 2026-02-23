/**
 * inspector-types-patch.js
 *
 * Corrige a tabela de Fraquezas & Resistências no Inspector do mapa (lado direito).
 *
 * Problema:
 *   O main.js só exibe a tabela se sh2?.pokemon?.types estiver preenchido na ficha.
 *   Quando o campo está vazio, aparece "Nenhuma fraqueza ou resistência especial."
 *
 * Solução:
 *   Observa o Inspector via MutationObserver. Quando detecta a mensagem de fallback
 *   (ou tabela vazia), lê o nome do Pokémon do painel, busca os tipos na PokeAPI
 *   e injeta a tabela correta.
 *
 * Normalização de nomes (idêntica ao main.js):
 *   -a → Alola | -g → Galar | -h → Hisui | -p → Paldea
 *   "Muk-A", "A-Muk", "Alolan Muk", "Muk (Alola)" → todos viram "muk-alola"
 *
 * Instalação:
 *   No final do <body> do index.html:
 *   <script type="module" src="./inspector-types-patch.js"></script>
 */

// ═══════════════════════════════════════════════════════════════════
// NORMALIZAÇÃO DE NOME → SLUG POKEAPI
// ═══════════════════════════════════════════════════════════════════

function normalizeName(raw) {
  let n = String(raw || "").trim();
  if (!n) return "";

  n = n.replace(/^EXT:/i, "").trim();

  // Formato "(Região)"
  n = n.replace(/\s*\(\s*alola\s*\)\s*/ig,  "-Alola");
  n = n.replace(/\s*\(\s*galar\s*\)\s*/ig,  "-Galar");
  n = n.replace(/\s*\(\s*hisui\s*\)\s*/ig,  "-Hisui");
  n = n.replace(/\s*\(\s*paldea\s*\)\s*/ig, "-Paldea");

  // Adjetivos: "Alolan X", "Galarian X", "Hisuian X", "Paldean X"
  if (/\balolan\b/i.test(n))   n = n.replace(/\balolan\b\s*/ig,   "") + "-Alola";
  if (/\bgalarian\b/i.test(n)) n = n.replace(/\bgalarian\b\s*/ig, "") + "-Galar";
  if (/\bhisuian\b/i.test(n))  n = n.replace(/\bhisuian\b\s*/ig,  "") + "-Hisui";
  if (/\bpaldean\b/i.test(n))  n = n.replace(/\bpaldean\b\s*/ig,  "") + "-Paldea";

  // Sufixos curtos no fim: "Nome-A", "Nome-G", "Nome-H", "Nome-P"
  n = n.replace(/-A$/i, "-Alola");
  n = n.replace(/-G$/i, "-Galar");
  n = n.replace(/-H$/i, "-Hisui");
  n = n.replace(/-P$/i, "-Paldea");

  // Prefixos curtos no início: "A-Nome", "G-Nome", "H-Nome", "P-Nome"
  const PREFIX = [
    [/^a-(.+)/i, "$1-Alola"],
    [/^g-(.+)/i, "$1-Galar"],
    [/^h-(.+)/i, "$1-Hisui"],
    [/^p-(.+)/i, "$1-Paldea"],
  ];
  for (const [re, rep] of PREFIX) {
    if (re.test(n)) { n = n.replace(re, rep); break; }
  }

  return n.trim();
}

function nameToSlug(name) {
  let slug = normalizeName(name)
    .toLowerCase()
    .replace(/♀/g, "f").replace(/♂/g, "m")
    .replace(/[''‛′'`\.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  // Convenção PokeAPI (não PokemonDB)
  slug = slug
    .replace(/-alolan$/, "-alola")
    .replace(/-galarian$/, "-galar")
    .replace(/-hisuian$/, "-hisui")
    .replace(/-paldean$/, "-paldea");

  // Formas padrão que a PokeAPI exige sufixo
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
const _cache = new Map(); // slug → string[] | "pending" | "error"

async function fetchTypes(slug) {
  if (!slug) return [];
  if (_cache.has(slug)) {
    const v = _cache.get(slug);
    return (v === "pending" || v === "error") ? [] : v;
  }

  _cache.set(slug, "pending");
  try {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const types = (data.types || [])
      .sort((a, b) => a.slot - b.slot)
      .map(t => {
        const n = String(t.type?.name || "");
        return n.charAt(0).toUpperCase() + n.slice(1); // "psychic" → "Psychic"
      })
      .filter(Boolean);

    _cache.set(slug, types);
    return types;
  } catch (e) {
    console.warn(`[inspector-types-patch] PokeAPI falhou para "${slug}":`, e.message);
    _cache.set(slug, "error");
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// GERA HTML DA TABELA (mesmos estilos do main.js: classes tmt-*)
// ═══════════════════════════════════════════════════════════════════

// Reutiliza TYPE_CHART e getTypeColor do main.js via window
function getAdvantage(atkType, defTypes) {
  const chart = window.TYPE_CHART || {};
  const atkEntry = chart[atkType] || {};
  let mult = 1;
  for (const dt of defTypes) {
    if (atkEntry[dt] !== undefined) mult *= atkEntry[dt];
  }
  return mult;
}

function getColor(type) {
  if (typeof window.getTypeColor === "function") return window.getTypeColor(type);
  // Fallback básico se a função não estiver exposta
  const COLORS = {
    Normal:"#A8A878", Fire:"#F08030", Water:"#6890F0", Electric:"#F8D030",
    Grass:"#78C850", Ice:"#98D8D8", Fighting:"#C03028", Poison:"#A040A0",
    Ground:"#E0C068", Flying:"#A890F0", Psychic:"#F85888", Bug:"#A8B820",
    Rock:"#B8A038", Ghost:"#705898", Dragon:"#7038F8", Dark:"#705848",
    Steel:"#B8B8D0", Fairy:"#EE99AC",
  };
  return COLORS[type] || "#888";
}

function normalizeT(t) {
  const MAP = {
    Fogo:"Fire", Água:"Water", Elétrico:"Electric", Planta:"Grass", Gelo:"Ice",
    Lutador:"Fighting", Veneno:"Poison", Terra:"Ground", Voador:"Flying",
    Psíquico:"Psychic", Inseto:"Bug", Pedra:"Rock", Fantasma:"Ghost",
    Dragão:"Dragon", Sombrio:"Dark", Aço:"Steel", Fada:"Fairy", Normal:"Normal",
  };
  return MAP[t] || t;
}

function buildInspectorTypeTable(types) {
  if (!types || !types.length) return "";

  const normalized = types.map(normalizeT).filter(Boolean);
  const ALL = [
    "Normal","Fire","Water","Electric","Grass","Ice","Fighting","Poison",
    "Ground","Flying","Psychic","Bug","Rock","Ghost","Dragon","Dark","Steel","Fairy"
  ];

  const GROUPS = {
    4:    { label: "Fraqueza 4×",   bonus: "+4",  icon: "💀",
            bg: "rgba(239,68,68,.14)",   border: "rgba(239,68,68,.50)",   text: "#f87171", types: [] },
    2:    { label: "Fraqueza 2×",   bonus: "+2",  icon: "⚠️",
            bg: "rgba(251,146,60,.12)",  border: "rgba(251,146,60,.45)",  text: "#fb923c", types: [] },
    0.5:  { label: "Resistência ½", bonus: "−2",  icon: "🛡",
            bg: "rgba(74,222,128,.10)",  border: "rgba(74,222,128,.40)",  text: "#4ade80", types: [] },
    0.25: { label: "Resistência ¼", bonus: "−4",  icon: "🛡🛡",
            bg: "rgba(34,197,94,.12)",   border: "rgba(34,197,94,.50)",   text: "#22c55e", types: [] },
    0:    { label: "Imunidade 0×",  bonus: "−6",  icon: "🚫",
            bg: "rgba(100,116,139,.12)", border: "rgba(100,116,139,.40)", text: "#94a3b8", types: [] },
  };

  for (const atk of ALL) {
    const mult = getAdvantage(atk, normalized);
    if      (mult === 0)   GROUPS[0].types.push(atk);
    else if (mult >= 4)    GROUPS[4].types.push(atk);
    else if (mult >= 2)    GROUPS[2].types.push(atk);
    else if (mult <= 0.25) GROUPS[0.25].types.push(atk);
    else if (mult < 1)     GROUPS[0.5].types.push(atk);
  }

  const pill = (t) => {
    const c = getColor(t);
    return `<span class="tmt-pill" style="background:${c}28;border:1px solid ${c}55;color:${c}">${t}</span>`;
  };

  const rows = [4, 2, 0.5, 0.25, 0].map(key => {
    const g = GROUPS[key];
    if (!g.types.length) return "";
    return `
      <div class="tmt-row" style="background:${g.bg};border-left:3px solid ${g.border}">
        <div class="tmt-row-head">
          <span class="tmt-icon">${g.icon}</span>
          <span class="tmt-label" style="color:${g.text}">${g.label}</span>
          <span class="tmt-bonus" style="background:${g.border};color:#0a0f1e">${g.bonus}</span>
        </div>
        <div class="tmt-pills">${g.types.map(pill).join("")}</div>
      </div>`;
  }).filter(Boolean).join("");

  return `
    <div class="type-matchup-table" data-from-patch="1">
      <div class="tmt-header">⚔️ Fraquezas &amp; Resistências</div>
      ${rows || `<div class="tmt-empty">Sem fraquezas ou resistências especiais.</div>`}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════
// LÓGICA PRINCIPAL — observa o Inspector e injeta a tabela
// ═══════════════════════════════════════════════════════════════════

/**
 * Lê o nome do Pokémon a partir do painel do Inspector.
 * O main.js renderiza: <div class="inspector-name">Gallade</div>
 */
function readNameFromInspector(inspectorEl) {
  return (inspectorEl.querySelector(".inspector-name")?.textContent || "").trim();
}

/**
 * Verifica se a tabela existente está vazia (só tem a mensagem de fallback).
 */
function tableIsEmpty(tableEl) {
  return !!tableEl?.querySelector(".tmt-empty");
}

/**
 * Tenta preencher a tabela de tipos no Inspector.
 * Se já existir uma tabela com dados reais (data-from-patch ou com linhas tmt-row),
 * não faz nada.
 */
async function tryFillTypeTable(inspectorEl) {
  if (!inspectorEl) return;

  // Não reprocessa se já injetamos dados reais
  if (inspectorEl.querySelector(".type-matchup-table[data-from-patch='1']")) return;

  const existingTable = inspectorEl.querySelector(".type-matchup-table");

  // Se a tabela existente já tem linhas reais (não está vazia), não precisa de patch
  if (existingTable && !tableIsEmpty(existingTable)) return;

  // Lê o nome do Pokémon
  const name = readNameFromInspector(inspectorEl);
  if (!name || name === "???") return; // Pokémon oculto, não exibe

  const slug = nameToSlug(name);
  if (!slug) return;

  // Marca como "buscando" para evitar chamadas duplicadas
  if (inspectorEl._fetchingSlug === slug) return;
  inspectorEl._fetchingSlug = slug;

  const types = await fetchTypes(slug);
  inspectorEl._fetchingSlug = null;

  if (!types.length) return;

  const newTable = buildInspectorTypeTable(types);

  if (existingTable) {
    // Substitui a tabela vazia pela nova
    existingTable.outerHTML = newTable;
  } else {
    // Insere após o .muted (linha de speed/movimento)
    const anchor =
      inspectorEl.querySelector(".muted") ||
      inspectorEl.querySelector(".inspector-chips") ||
      inspectorEl.querySelector(".inspector-name");

    if (anchor) {
      anchor.insertAdjacentHTML("afterend", newTable);
    }
  }
}

// ─── Observer ────────────────────────────────────────────────────────────────
function startObserver() {
  // O Inspector está dentro de #side_panel ou .inspector
  const root = document.body;

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      // Procura qualquer inspector adicionado/modificado
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;

        // O próprio nó é o inspector
        if (node.classList?.contains("inspector") || node.querySelector?.(".inspector")) {
          const el = node.classList.contains("inspector") ? node : node.querySelector(".inspector");
          if (el) tryFillTypeTable(el);
        }
      }

      // Também verifica mudanças de atributo/texto em elementos existentes
      const target = m.target;
      if (target instanceof HTMLElement) {
        const inspector = target.closest(".inspector") || target.querySelector(".inspector");
        if (inspector) tryFillTypeTable(inspector);
      }
    }
  });

  observer.observe(root, {
    childList: true,
    subtree: true,
  });

  // Tenta preencher qualquer Inspector já na página
  document.querySelectorAll(".inspector").forEach(el => tryFillTypeTable(el));

  console.log("[inspector-types-patch] ✅ Observer ativo — tipos via PokeAPI por nome.");
}

// Inicia assim que o DOM estiver pronto
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startObserver);
} else {
  startObserver();
}
