/**
 * combat-inspector-patch.js
 *
 * Patch aplicado APÓS o carregamento do combat.js e combat-patch.js.
 * Não modifica os arquivos originais.
 *
 * O que este patch faz:
 *  1. Substitui a mensagem "Ficha Privada" do alvo por uma tabela visual de
 *     fraquezas/resistências gerada a partir dos tipos do Pokémon alvo.
 *  2. Injeta campos "Mod. Acerto" e "Mod. Dano" na fase Setup, antes do botão
 *     ⚔️ Rolar Ataque, para que o jogador possa adicionar bônus/prejuízos
 *     manuais antes de confirmar.
 *  3. Aplica esses modificadores ao calcular o payload do ataque (soma ao
 *     accuracy e ao damage final).
 *
 * Instalação:
 *   Adicione ao final do <body> do index.html, DEPOIS dos outros scripts:
 *   <script type="module" src="./combat-inspector-patch.js"></script>
 */

import {
  getTypeColor,
  getTypeDamageBonus,
  getTypeAdvantage,
  TYPE_CHART,
  normalizeType,
} from "./type-data.js";

// ─── Aguarda o CombatUI estar pronto ──────────────────────────────────────────
function waitForCombatUI(cb, tries = 0) {
  const ui = window._combatUI;
  if (ui && typeof ui._renderSetup === "function") {
    cb(ui);
  } else if (tries < 60) {
    setTimeout(() => waitForCombatUI(cb, tries + 1), 300);
  } else {
    console.warn("[combat-inspector-patch] CombatUI não encontrado após 18s.");
  }
}

// ─── Helper: gera HTML da tabela de tipo do alvo ──────────────────────────────
function buildTargetTypeTable(types) {
  if (!types || !types.length) return "";
  const normalizedTypes = types.map((t) => normalizeType(t)).filter(Boolean);
  if (!normalizedTypes.length) return "";

  const ALL_TYPES = Object.keys(TYPE_CHART);

  const groups = {
    4:    { label: "Fraqueza 4×", bonus: "+4", icon: "💀", color: "#ef4444" },
    2:    { label: "Fraqueza 2×", bonus: "+2", icon: "⚠️", color: "#fb923c" },
    0.5:  { label: "Resist. ½",   bonus: "−2", icon: "🛡️", color: "#4ade80" },
    0.25: { label: "Resist. ¼",   bonus: "−4", icon: "🛡🛡", color: "#22c55e" },
    0:    { label: "Imunidade",   bonus: "−6", icon: "🚫", color: "#94a3b8" },
  };

  const buckets = { 4: [], 2: [], 0.5: [], 0.25: [], 0: [] };

  for (const atkType of ALL_TYPES) {
    const mult = getTypeAdvantage(atkType, normalizedTypes);
    if (mult === 0)        buckets[0].push(atkType);
    else if (mult >= 4)   buckets[4].push(atkType);
    else if (mult >= 2)   buckets[2].push(atkType);
    else if (mult <= 0.25) buckets[0.25].push(atkType);
    else if (mult < 1)    buckets[0.5].push(atkType);
  }

  const pill = (type) => {
    const c = getTypeColor(type);
    return `<span style="
      display:inline-block;padding:1px 7px;border-radius:8px;font-size:11px;font-weight:700;
      background:${c}28;border:1px solid ${c}55;color:${c};margin:2px 2px;white-space:nowrap">${type}</span>`;
  };

  let rows = "";
  for (const key of [4, 2, 0.5, 0.25, 0]) {
    const list = buckets[key];
    if (!list.length) continue;
    const g = groups[key];
    rows += `<div style="
        display:flex;align-items:flex-start;gap:8px;padding:5px 8px;border-radius:8px;margin-bottom:4px;
        background:${g.color}14;border-left:3px solid ${g.color}66">
      <span style="font-size:13px;min-width:18px">${g.icon}</span>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
          <span style="font-size:11px;font-weight:800;color:${g.color}">${g.label}</span>
          <span style="font-size:10px;font-weight:900;padding:1px 5px;border-radius:5px;
            background:${g.color}33;color:${g.color}">${g.bonus}</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:0">${list.map(pill).join("")}</div>
      </div>
    </div>`;
  }

  if (!rows) {
    rows = `<div style="font-size:11px;color:rgba(148,163,184,.6);padding:4px 8px">
      Sem fraquezas ou resistências especiais.</div>`;
  }

  // Header com os tipos do alvo
  const typePills = types
    .map((t) => {
      const c = getTypeColor(normalizeType(t));
      return `<span style="
        padding:2px 9px;border-radius:10px;font-size:12px;font-weight:800;
        background:${c}28;border:1px solid ${c}66;color:${c}">${t}</span>`;
    })
    .join(" ");

  return `
    <div class="cb-target-type-table" style="
      border-radius:12px;border:1px solid rgba(56,189,248,.25);
      background:rgba(3,8,29,.55);padding:10px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:900;color:rgba(148,163,184,.8)">⚔️ Fraquezas &amp; Resistências</span>
        <span style="flex:1"></span>
        ${typePills}
      </div>
      ${rows}
    </div>`;
}

// ─── Helper: campos de modificadores manuais ─────────────────────────────────
const MOD_PANEL_ID = "cb_manual_mods_panel";

function buildModPanel() {
  return `
    <div id="${MOD_PANEL_ID}" style="
      border-radius:12px;border:1px solid rgba(251,191,36,.28);
      background:rgba(251,191,36,.06);padding:10px;margin-bottom:10px">
      <div style="font-size:12px;font-weight:900;color:rgba(251,191,36,.9);margin-bottom:8px">
        🎛️ Modificadores Manuais
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <label style="display:flex;flex-direction:column;gap:3px">
          <span style="font-size:11px;font-weight:700;color:rgba(148,163,184,.8)">Bônus de Acerto</span>
          <input id="cb_mod_acc" class="input" type="number" value="0" placeholder="0"
            style="font-size:13px;padding:6px 8px;border-radius:8px" />
          <span style="font-size:10px;color:rgba(148,163,184,.55)">Soma ao modificador de acerto</span>
        </label>
        <label style="display:flex;flex-direction:column;gap:3px">
          <span style="font-size:11px;font-weight:700;color:rgba(148,163,184,.8)">Bônus de Dano</span>
          <input id="cb_mod_dmg" class="input" type="number" value="0" placeholder="0"
            style="font-size:13px;padding:6px 8px;border-radius:8px" />
          <span style="font-size:10px;color:rgba(148,163,184,.55)">Soma ao rank do golpe</span>
        </label>
      </div>
    </div>`;
}

// ─── Aplica o patch ───────────────────────────────────────────────────────────
waitForCombatUI((ui) => {
  // ── 1. Guarda o método original de renderSetup ──────────────────────────
  const _origRenderSetup = ui._renderSetup.bind(ui);

  ui._renderSetup = async function (battle, isPlayer, by) {
    // Chama o render original
    await _origRenderSetup(battle, isPlayer, by);

    // Só modifica se sou o atacante (setup panel estará visível)
    const attacker = (battle && battle.attacker) ? String(battle.attacker).trim() : "";
    if (attacker !== by) return;

    const body = this._body;
    if (!body) return;

    const normalPanel = body.querySelector("#cb_normal_panel");
    if (!normalPanel) return;

    // ── 2. Injeta painel de modificadores manuais antes do botão Rolar ────
    const rollBtn = body.querySelector("#cb_roll_attack");
    if (rollBtn && !body.querySelector(`#${MOD_PANEL_ID}`)) {
      const modDiv = document.createElement("div");
      modDiv.innerHTML = buildModPanel();
      normalPanel.insertBefore(modDiv.firstElementChild, rollBtn);
    }

    // ── 3. Injeta tabela de tipo do alvo abaixo do select de alvo ──────────
    const targetSel = body.querySelector("#cb_atk_target");
    if (!targetSel) return;

    // Cria container para a tabela do alvo (apenas uma vez)
    let targetTypeDiv = body.querySelector("#cb_target_type_table_wrap");
    if (!targetTypeDiv) {
      targetTypeDiv = document.createElement("div");
      targetTypeDiv.id = "cb_target_type_table_wrap";
      targetSel.parentNode.insertBefore(targetTypeDiv, targetSel.nextSibling);
    }

    const renderTargetTable = async () => {
      const opt = targetSel.selectedOptions[0];
      if (!opt || !opt.value) { targetTypeDiv.innerHTML = ""; return; }
      const tOwner = opt.dataset.owner;
      const tPid = opt.dataset.pid;
      if (!tOwner || !tPid) { targetTypeDiv.innerHTML = ""; return; }

      // Garante que a ficha do alvo esteja carregada
      if (this._loadSheets && !this._sheetUnsubs?.has(tOwner)) {
        await this._loadSheets(tOwner);
      }

      const tSheet = this._getSheet ? this._getSheet(tOwner, tPid) : null;
      const types = Array.isArray(tSheet?.pokemon?.types) ? tSheet.pokemon.types : [];
      targetTypeDiv.innerHTML = buildTargetTypeTable(types);
    };

    // Renderiza para o alvo já selecionado
    await renderTargetTable();

    // Escuta mudanças no alvo
    // Evita listener duplicado com uma flag
    if (!targetSel._patchListenerAdded) {
      targetSel._patchListenerAdded = true;
      targetSel.addEventListener("change", renderTargetTable);
    }
  };

  // ── 4. Intercepta o clique do botão Rolar Ataque para aplicar os mods ──
  // Fazemos isso com event delegation no _body, que é recriado a cada render
  const _origBody_set = Object.getOwnPropertyDescriptor(ui.__proto__, "_body")
    || Object.getOwnPropertyDescriptor(ui, "_body");

  // Usa um MutationObserver para detectar quando o botão de ataque aparece
  // e injeta um listener que captura os modificadores
  const observer = new MutationObserver(() => {
    const rollBtn = ui._body && ui._body.querySelector("#cb_roll_attack");
    if (!rollBtn || rollBtn._patchHooked) return;
    rollBtn._patchHooked = true;

    rollBtn.addEventListener(
      "click",
      () => {
        // Quando o botão é clicado, lê os modificadores e ajusta os inputs
        // O combat.js já lê #cb_atk_accuracy — sobrescrevemos o valor com o mod somado
        const accInput = ui._body && ui._body.querySelector("#cb_atk_accuracy");
        const modAccInput = ui._body && ui._body.querySelector("#cb_mod_acc");
        const modDmgInput = ui._body && ui._body.querySelector("#cb_mod_dmg");

        if (accInput && modAccInput) {
          const baseAcc = parseInt(accInput.value, 10) || 0;
          const modAcc = parseInt(modAccInput.value, 10) || 0;
          // Guarda para uso na interceptação do payload
          accInput._modApplied = modAcc;
          accInput.value = String(baseAcc + modAcc);
        }

        if (modDmgInput) {
          // Guardamos o mod de dano numa variável acessível ao patch de payload
          ui._pendingDmgMod = parseInt(modDmgInput.value, 10) || 0;
        }
      },
      true // capture: roda ANTES do listener do combat.js
    );
  });

  if (ui._body) {
    observer.observe(ui._body, { childList: true, subtree: false });
  }

  // Reaplica o observer toda vez que _body é substituído
  // (combat.js substitui this._body ao mudar de fase)
  let _lastBody = ui._body;
  setInterval(() => {
    if (ui._body && ui._body !== _lastBody) {
      _lastBody = ui._body;
      observer.disconnect();
      observer.observe(ui._body, { childList: true, subtree: false });
    }
  }, 400);

  // ── 5. Patch no movePayload: adiciona _pendingDmgMod ao damage ───────────
  // Interceptamos updateDoc / setDoc de forma cirúrgica:
  // O combat.js monta o movePayload e logo chama updateDoc.
  // Após o roll, o damage já está calculado em movePayload.damage.
  // Aplicamos o mod de dano ajustando o objeto ANTES do Firestore receber.

  // A abordagem mais segura é interceptar o método _battleRef e wrappear o
  // resultado. Mas como o combat.js usa o import direto de updateDoc, a forma
  // prática é: after the roll, o dano é salvo em battle.attack_move.damage.
  // Ao invés de monkey-patchar o Firestore, injetamos o mod diretamente no
  // estado local do combat.js via sua própria lógica de render.

  // O truque: antes de o botão ser clicado (capture=true acima), já somamos
  // o mod de acerto ao input de acerto. Para o dano, o combat.js usa o valor
  // do golpe selecionado — então precisamos interceptar _depois_ do cálculo.

  // Wrapper alternativo mais limpo: sobreescrever _renderHitConfirmed para
  // pré-preencher o campo de Rank com (battle.attack_move.damage + _pendingDmgMod).
  const _origRenderHitConfirmed = ui._renderHitConfirmed.bind(ui);
  ui._renderHitConfirmed = function (battle, by) {
    // Aplica mod de dano ao campo antes de renderizar
    if (this._pendingDmgMod && this._pendingDmgMod !== 0 && battle.attack_move) {
      battle = {
        ...battle,
        attack_move: {
          ...battle.attack_move,
          damage: (battle.attack_move.damage || 0) + this._pendingDmgMod,
        },
      };
      this._pendingDmgMod = 0;
    }
    return _origRenderHitConfirmed(battle, by);
  };

  console.log("[combat-inspector-patch] ✅ Patch aplicado com sucesso.");
});
