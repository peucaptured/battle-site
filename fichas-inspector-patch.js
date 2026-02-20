/**
 * fichas-inspector-patch.js
 *
 * Objetivo:
 * - Quando a aba "Fichas" estiver ativa e existir uma "Ficha completa" aberta
 *   no painel central, espelha esse mesmo layout para a coluna da direita
 *   (#inspector_root) e alarga a coluna da direita.
 *
 * Não altera main.js: apenas observa o DOM e clona o bloco.
 */

function dbg(...a){
  console.log('%c[fichas-inspector]', 'color:#22d3ee;font-weight:bold', ...a);
}

function isVisible(el){
  if (!el) return false;
  const st = window.getComputedStyle(el);
  return st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
}

function activeTabId(){
  // usa o padrão do index: .tab[data-tab="#tab_xxx"]
  const btn = document.querySelector('.tab.active');
  if (!btn) return '';
  const dt = btn.getAttribute('data-tab') || '';
  return dt.startsWith('#') ? dt.slice(1) : dt;
}

function findSheetFullCard(){
  // A ficha aberta aparece no painel central (tab_sheets).
  // Heurística:
  //  - procurar um elemento que contenha o texto "Ficha completa"
  //  - subir até um container "card" ou "panel-inner" e pegar o bloco mais "card-like"

  const tab = document.getElementById('tab_sheets');
  if (!tab || !isVisible(tab)) return null;

  // Primeiro, tentar achar um título exato
  const all = Array.from(tab.querySelectorAll('*'));
  const titleEl = all.find(el => {
    if (!el) return false;
    const t = (el.textContent || '').trim();
    return t === 'Ficha completa';
  });

  // Se achou o título, tentar pegar a "card" mais próxima / subsequente
  if (titleEl) {
    const nearCard = titleEl.closest('.card');
    if (nearCard) return nearCard;

    // tenta: próximo irmão que seja .card
    let n = titleEl.parentElement;
    for (let i=0;i<3 && n;i++) {
      const next = n.nextElementSibling;
      if (next && next.classList && next.classList.contains('card')) return next;
      n = n.parentElement;
    }
  }

  // Fallback: procurar uma .card que contenha "Ficha completa" e algum marcador típico de ficha
  const cards = Array.from(tab.querySelectorAll('.card'));
  const scored = cards.map(card => {
    const txt = (card.textContent || '').toLowerCase();
    let score = 0;
    if (txt.includes('ficha completa')) score += 10;
    // marcadores comuns no seu layout
    if (txt.includes('skills')) score += 2;
    if (txt.includes('vantagens')) score += 2;
    if (txt.includes('golpes')) score += 2;
    if (txt.includes('hp')) score += 1;
    if (txt.includes('stgr')) score += 1;
    if (txt.includes('dodge')) score += 1;
    // tamanho ajuda a evitar cards pequenos
    score += Math.min(5, Math.floor((card.textContent || '').length / 400));
    return { card, score };
  }).sort((a,b)=>b.score-a.score);

  if (scored[0] && scored[0].score >= 8) return scored[0].card;
  return null;
}

function ensureInspectorMount(){
  const root = document.getElementById('inspector_root');
  if (!root) return null;
  let mount = document.getElementById('sheet_inspector_mount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'sheet_inspector_mount';
    mount.style.display = 'none';
    root.prepend(mount);
  }
  return mount;
}

let _savedInspectorHtml = null;
let _lastCloneKey = '';

function toggleOtherInspectorContent(root, mount, onlyMount) {
  if (!root || !mount) return;
  const kids = Array.from(root.children);
  for (const el of kids) {
    if (el === mount) {
      el.style.display = '';
      continue;
    }
    if (onlyMount) {
      if (!el.dataset._prevDisplay) el.dataset._prevDisplay = el.style.display || '';
      el.style.display = 'none';
    } else {
      if (el.dataset._prevDisplay != null) {
        el.style.display = el.dataset._prevDisplay;
        delete el.dataset._prevDisplay;
      } else {
        el.style.display = '';
      }
    }
  }
}

function cloneSheetIntoInspector(){
  const root = document.getElementById('inspector_root');
  const mount = ensureInspectorMount();
  if (!root || !mount) return;

  const shouldBeActive = activeTabId() === 'tab_sheets';
  const sheetCard = shouldBeActive ? findSheetFullCard() : null;

  if (!shouldBeActive || !sheetCard) {
    // sair do modo ficha
    document.body.classList.remove('sheet-inspector-mode');
    mount.style.display = 'none';

    // volta a mostrar o conteúdo original do inspector
    toggleOtherInspectorContent(root, mount, false);

    // restaura inspector original (somente se a gente tiver salvo)
    if (_savedInspectorHtml != null && root.innerHTML !== _savedInspectorHtml) {
      // preserva nosso mount (recria depois)
      root.innerHTML = _savedInspectorHtml;
      _savedInspectorHtml = null;
    }
    _lastCloneKey = '';
    return;
  }

  // entrar no modo ficha
  document.body.classList.add('sheet-inspector-mode');

  // salva o estado original do inspector (uma vez)
  if (_savedInspectorHtml == null) {
    _savedInspectorHtml = root.innerHTML;
    // garante que o mount exista depois da restauração
    ensureInspectorMount();
  }

  // esconde o conteúdo original do inspector (fica só a ficha)
  toggleOtherInspectorContent(root, mount, true);

  // esconde o conteúdo original do inspector (fica só a ficha)
  toggleOtherInspectorContent(root, mount, true);

  // cria uma key para não reclonar sem necessidade
  const key = [
    sheetCard.querySelector('img')?.getAttribute('src') || '',
    (sheetCard.textContent || '').slice(0, 1200)
  ].join('|');

  if (key === _lastCloneKey) {
    mount.style.display = '';
    return;
  }
  _lastCloneKey = key;

  // Clona mantendo o layout/estilos existentes.
  const clone = sheetCard.cloneNode(true);

  // Pequenos ajustes para ficar bem no inspector
  clone.style.marginBottom = '0';

  mount.innerHTML = '';
  mount.appendChild(clone);
  mount.style.display = '';
}

function watch(){
  // Reage a:
  //  - troca de tabs (click)
  //  - alterações no tab_sheets (seleção de ficha)
  //  - alterações no inspector_root (main.js rerender)

  const tabBar = document.querySelector('.tabs');
  if (tabBar) {
    tabBar.addEventListener('click', () => setTimeout(cloneSheetIntoInspector, 50));
  }

  const sheetsTab = document.getElementById('tab_sheets');
  if (sheetsTab) {
    const mo = new MutationObserver(() => {
      // debounce leve
      setTimeout(cloneSheetIntoInspector, 30);
    });
    mo.observe(sheetsTab, { subtree:true, childList:true, characterData:true, attributes:true });
  }

  const insp = document.getElementById('inspector_root');
  if (insp) {
    const mo2 = new MutationObserver(() => setTimeout(cloneSheetIntoInspector, 30));
    mo2.observe(insp, { subtree:true, childList:true });
  }

  // primeira rodada
  cloneSheetIntoInspector();

  // e um "seguro" (caso a UI demore para montar)
  setTimeout(cloneSheetIntoInspector, 800);
  setTimeout(cloneSheetIntoInspector, 1800);

  dbg('Patch ativo. (aba Fichas -> ficha aberta vai para direita)');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(watch, 300));
} else {
  setTimeout(watch, 300);
}
