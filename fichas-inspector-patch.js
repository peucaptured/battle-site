/**
 * fichas-inspector-patch.js
 *
 * When Fichas tab is active and a ficha is selected:
 *  - The center shows only the card grid (mini cards)
 *  - main.js already renders the full ficha in #inspector_root via renderSheetsInspectorCard()
 *  - This patch toggles body.sheet-inspector-mode to widen the right column
 *
 * Does not alter main.js — observes DOM and toggles class.
 */

function activeTabId(){
  const btn = document.querySelector('.tab.active');
  if (!btn) return '';
  return btn.getAttribute('data-tab') || '';
}

function syncInspectorMode(){
  const isSheets = activeTabId() === 'sheets';
  const inspRoot = document.getElementById('inspector_root');
  const hasContent = inspRoot && inspRoot.querySelector('.sheet-panel, .inspector');

  if (isSheets && hasContent) {
    document.body.classList.add('sheet-inspector-mode');
  } else {
    document.body.classList.remove('sheet-inspector-mode');
  }
}

function watch(){
  // React to tab changes
  const tabBar = document.querySelector('.tabs');
  if (tabBar) {
    tabBar.addEventListener('click', () => setTimeout(syncInspectorMode, 80));
  }

  // Watch inspector_root for content changes
  const insp = document.getElementById('inspector_root');
  if (insp) {
    const mo = new MutationObserver(() => setTimeout(syncInspectorMode, 30));
    mo.observe(insp, { subtree: true, childList: true });
  }

  // Initial
  syncInspectorMode();
  setTimeout(syncInspectorMode, 800);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(watch, 300));
} else {
  setTimeout(watch, 300);
}
