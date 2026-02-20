/**
 * field-zones-patch.js — Zonas de clima/terreno + Armadilhas por célula
 *
 * - Zonas zonais: múltiplos retângulos no mapa com efeitos visuais animados
 * - Armadilhas: Stealth Rock, Spikes, Toxic Spikes, Sticky Web (ocultas até revelação)
 * - NÃO modifica main.js — usa window.appState, window.screenToTile, etc.
 *
 * Firestore:
 *   public_state/state → zones[], traps[]
 */

// ─── Helpers ──────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function safeStr(x) { return (x == null ? "" : String(x)).trim(); }
function nanoid8() {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Aguarda globals do main.js ───────────────────────────────────────────
function waitForGlobals(cb, attempts = 0) {
  if (
    window.appState &&
    window.screenToTile &&
    window.getStateDocRef &&
    window.runTransaction &&
    window.currentDb !== undefined
  ) {
    cb();
  } else if (attempts < 40) {
    setTimeout(() => waitForGlobals(cb, attempts + 1), 300);
  } else {
    console.warn("[field-zones-patch] globals não disponíveis após 12s — abortando");
  }
}

// ─── State local ──────────────────────────────────────────────────────────
let _selectedZoneType  = null; // "weather" | "terrain"
let _selectedZoneValue = null; // "sun", "rain", "electric_terrain", etc.
let _drawingMode       = false; // modo arrastar retângulo ativo
let _drawStart         = null;  // { row, col, px, py }
let _drawCurrent       = null;  // { row, col }
let _trapMode          = null;  // "🪨" | "🔺" | "☠️" | "🕸️" | null

// ─── Elementos DOM ────────────────────────────────────────────────────────
let canvas, zoneCanvas, zoneCtx, drawCanvas, drawCtx, arenaWrap;
let fcZonePanel, fzpTypeLabel, fzpAreaSelect, fzpBtnDraw, fzpBtnCancel, fzpZonesList;
let trapModalBackdrop, trapModalList, trapModalConfirm, trapModalCancel, trapModalClose;
let conflictBackdrop, conflictText, conflictKeepNew, conflictKeepOld;
let _conflictResolve = null; // promise resolver para o modal de conflito

// ─── Cor de cada efeito para o chip e preview ────────────────────────────
const ZONE_COLORS = {
  sun:              { bg: "rgba(253,224,71,0.35)",  border: "rgba(253,224,71,0.7)",  label: "☀️ Sol Forte"   },
  rain:             { bg: "rgba(56,189,248,0.25)",  border: "rgba(56,189,248,0.7)",  label: "🌧️ Chuva"       },
  sandstorm:        { bg: "rgba(217,119,6,0.30)",   border: "rgba(217,119,6,0.7)",   label: "🌪️ Areia"        },
  hail:             { bg: "rgba(186,230,253,0.30)", border: "rgba(186,230,253,0.7)", label: "🌨️ Granizo"      },
  snow:             { bg: "rgba(186,230,253,0.25)", border: "rgba(186,230,253,0.7)", label: "❄️ Neve"         },
  electric_terrain: { bg: "rgba(250,204,21,0.30)",  border: "rgba(250,204,21,0.7)",  label: "⚡ El. Terrain"  },
  grassy_terrain:   { bg: "rgba(74,222,128,0.25)",  border: "rgba(74,222,128,0.7)",  label: "🌿 Grassy Ter."  },
  psychic_terrain:  { bg: "rgba(192,132,252,0.25)", border: "rgba(192,132,252,0.7)", label: "🔮 Psychic Ter." },
  misty_terrain:    { bg: "rgba(249,168,212,0.25)", border: "rgba(249,168,212,0.7)", label: "🌸 Misty Ter."   },
};

// ─── Init ─────────────────────────────────────────────────────────────────
function init() {
  canvas      = document.getElementById("arena");
  zoneCanvas  = $("zone_canvas");
  drawCanvas  = $("zone_draw_canvas");
  arenaWrap   = document.getElementById("arena_wrap");

  if (!canvas || !zoneCanvas || !arenaWrap) {
    setTimeout(init, 500);
    return;
  }

  zoneCtx  = zoneCanvas.getContext("2d");
  drawCtx  = drawCanvas.getContext("2d");

  // DOM refs
  fcZonePanel   = $("fc_zone_panel");
  fzpTypeLabel  = $("fzp_type_label");
  fzpAreaSelect = $("fzp_area_select");
  fzpBtnDraw    = $("fzp_btn_draw");
  fzpBtnCancel  = $("fzp_btn_cancel");
  fzpZonesList  = $("fzp_zones_list");

  trapModalBackdrop = $("trap_modal_backdrop");
  trapModalList     = $("trap_modal_list");
  trapModalConfirm  = $("trap_modal_confirm");
  trapModalCancel   = $("trap_modal_cancel");
  trapModalClose    = $("trap_modal_close");

  conflictBackdrop  = $("zone_conflict_backdrop");
  conflictText      = $("zone_conflict_text");
  conflictKeepNew   = $("zone_conflict_keep_new");
  conflictKeepOld   = $("zone_conflict_keep_old");

  bindFieldConditions();
  bindZonePanel();
  bindCanvasEvents();
  bindTrapModal();
  bindConflictModal();

  startZoneRaf();

  // Sincroniza UI quando o state muda
  const _origOnSnapshot = window.appState;
  setInterval(syncZonePanelUI, 800);

  console.log("[field-zones-patch] ✅ inicializado");
}

// ─── Sincroniza o canvas de zonas com o tamanho real do canvas principal ──
function syncCanvasSize() {
  if (!canvas || !zoneCanvas || !drawCanvas) return;
  const w = canvas.width;
  const h = canvas.height;
  if (zoneCanvas.width !== w || zoneCanvas.height !== h) {
    zoneCanvas.width = w; zoneCanvas.height = h;
  }
  if (drawCanvas.width !== w || drawCanvas.height !== h) {
    drawCanvas.width = w; drawCanvas.height = h;
  }
}

// ─── RAF: animação das zonas ───────────────────────────────────────────────
function startZoneRaf() {
  function loop() {
    syncCanvasSize();
    renderZones();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

// ─── Render zonas no zone_canvas ─────────────────────────────────────────
function renderZones() {
  if (!zoneCtx) return;
  const W = zoneCanvas.width;
  const H = zoneCanvas.height;
  zoneCtx.clearRect(0, 0, W, H);

  const zones = window.appState?.zones;
  if (!Array.isArray(zones) || zones.length === 0) return;

  const view = window._arenaView;
  if (!view) return;

  const tile = view.scale;
  const ox   = view.offX;
  const oy   = view.offY;
  if (!tile || tile <= 0) return;

  for (const zone of zones) {
    const cells = Array.isArray(zone.cells) ? zone.cells : [];
    if (cells.length === 0) continue;

    // Bounding box das células da zona
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    for (const c of cells) {
      minR = Math.min(minR, c.row); maxR = Math.max(maxR, c.row);
      minC = Math.min(minC, c.col); maxC = Math.max(maxC, c.col);
    }
    const x  = ox + minC * tile;
    const y  = oy + minR * tile;
    const zw = (maxC - minC + 1) * tile;
    const zh = (maxR - minR + 1) * tile;
    const gs = window.appState?.gridSize || 10;

    zoneCtx.save();
    zoneCtx.beginPath();
    zoneCtx.rect(x, y, zw, zh);
    zoneCtx.clip();

    // Chama o overlay de efeito existente (de battle_effects.js, exposto globalmente)
    if (typeof drawWeatherOverlay === "function") {
      // Hack: substitui temporariamente appState.battle para a zona
      const _origBattle = window.appState.battle;
      const fakeBattle  = { weather: null, terrain: null };
      if (zone.type === "weather") fakeBattle.weather = zone.value;
      if (zone.type === "terrain") fakeBattle.terrain = zone.value;
      window.appState.battle = fakeBattle;
      drawWeatherOverlay(zoneCtx, ox, oy, gs, tile, W, H);
      window.appState.battle = _origBattle;
    } else {
      // Fallback: cor sólida se battle_effects não estiver carregado
      const col = ZONE_COLORS[safeStr(zone.value).toLowerCase()] || { bg: "rgba(56,189,248,0.2)" };
      zoneCtx.fillStyle = col.bg;
      zoneCtx.fillRect(x, y, zw, zh);
    }

    // Borda da zona
    const col = ZONE_COLORS[safeStr(zone.value).toLowerCase()];
    if (col) {
      zoneCtx.strokeStyle = col.border;
      zoneCtx.lineWidth = 2;
      zoneCtx.setLineDash([4, 4]);
      zoneCtx.strokeRect(x + 1, y + 1, zw - 2, zh - 2);
      zoneCtx.setLineDash([]);
    }

    // Label mini no canto superior
    const label = col?.label || safeStr(zone.value);
    zoneCtx.globalAlpha = 0.85;
    zoneCtx.font = `bold ${Math.max(9, Math.min(12, tile * 0.3))}px system-ui`;
    zoneCtx.fillStyle = "#fff";
    zoneCtx.textAlign = "left";
    zoneCtx.textBaseline = "top";
    zoneCtx.shadowColor = "rgba(0,0,0,0.8)";
    zoneCtx.shadowBlur = 4;
    zoneCtx.fillText(label, x + 4, y + 3);
    zoneCtx.shadowBlur = 0;
    zoneCtx.globalAlpha = 1;

    zoneCtx.restore();
  }
}

// ─── Preview de desenho (drawCanvas) ─────────────────────────────────────
function renderDrawPreview() {
  if (!drawCtx) return;
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  if (!_drawStart || !_drawCurrent) return;

  const view = window._arenaView;
  if (!view) return;
  const tile = view.scale;
  const ox   = view.offX;
  const oy   = view.offY;

  // Retângulo de tiles cobertos
  const r0 = Math.min(_drawStart.row, _drawCurrent.row);
  const r1 = Math.max(_drawStart.row, _drawCurrent.row);
  const c0 = Math.min(_drawStart.col, _drawCurrent.col);
  const c1 = Math.max(_drawStart.col, _drawCurrent.col);

  const x  = ox + c0 * tile;
  const y  = oy + r0 * tile;
  const rw = (c1 - c0 + 1) * tile;
  const rh = (r1 - r0 + 1) * tile;

  const col = ZONE_COLORS[safeStr(_selectedZoneValue)] || { bg: "rgba(56,189,248,0.2)", border: "rgba(56,189,248,0.8)" };

  drawCtx.save();
  drawCtx.fillStyle = col.bg;
  drawCtx.fillRect(x, y, rw, rh);
  drawCtx.strokeStyle = col.border;
  drawCtx.lineWidth = 2;
  drawCtx.setLineDash([5, 4]);
  drawCtx.strokeRect(x + 1, y + 1, rw - 2, rh - 2);
  drawCtx.setLineDash([]);

  // Dimensão em tiles
  drawCtx.font = "bold 12px system-ui";
  drawCtx.fillStyle = "#fff";
  drawCtx.globalAlpha = 0.9;
  drawCtx.textAlign = "center";
  drawCtx.textBaseline = "middle";
  drawCtx.shadowColor = "rgba(0,0,0,0.9)";
  drawCtx.shadowBlur = 6;
  drawCtx.fillText(`${c1-c0+1}×${r1-r0+1}`, x + rw / 2, y + rh / 2);
  drawCtx.shadowBlur = 0;
  drawCtx.restore();
}

// ─── Bind: campo de condições (botões weather/terrain/trap) ───────────────
function bindFieldConditions() {
  const bar = $("field_conditions");
  if (!bar) return;

  bar.addEventListener("click", e => {
    const btn = e.target.closest(".fc-btn[data-fc-type]");
    if (!btn) return;
    const role = safeStr(window.appState?.role);
    if (role === "spectator") return;

    const type  = btn.dataset.fcType;
    const value = btn.dataset.fcValue;

    if (type === "trap") {
      // Modo armadilha
      if (_trapMode === value) {
        clearTrapMode();
      } else {
        setTrapMode(value);
      }
      return;
    }

    if (type === "weather" || type === "terrain") {
      // Toggle zona: seleciona ou deseleciona para desenhar
      if (_selectedZoneValue === value) {
        clearZoneSelection();
      } else {
        setZoneSelection(type, value);
      }
    }
  });

  // Botão de revelar armadilhas
  const btnReveal = $("btn_reveal_traps");
  if (btnReveal) {
    btnReveal.addEventListener("click", openTrapModal);
  }
}

// ─── Seleção de zona ──────────────────────────────────────────────────────
function setZoneSelection(type, value) {
  clearTrapMode();
  _selectedZoneType  = type;
  _selectedZoneValue = value;

  // Atualiza botão ativo
  document.querySelectorAll(".fc-btn[data-fc-type='weather'], .fc-btn[data-fc-type='terrain']").forEach(b => {
    b.classList.toggle("fc-active", b.dataset.fcValue === value);
  });

  // Abre painel de zona
  if (fcZonePanel) fcZonePanel.style.display = "";
  if (fzpTypeLabel) {
    const col = ZONE_COLORS[value];
    fzpTypeLabel.textContent = col ? col.label : value;
  }
  syncZonePanelUI();
}

function clearZoneSelection() {
  _selectedZoneType  = null;
  _selectedZoneValue = null;
  document.querySelectorAll(".fc-btn[data-fc-type='weather'], .fc-btn[data-fc-type='terrain']").forEach(b => {
    b.classList.remove("fc-active");
  });
  if (fcZonePanel) fcZonePanel.style.display = "none";
  exitDrawingMode();
}

// ─── Modo armadilha ───────────────────────────────────────────────────────
function setTrapMode(icon) {
  clearZoneSelection();
  _trapMode = icon;
  document.querySelectorAll(".fc-btn[data-fc-type='trap']").forEach(b => {
    b.classList.toggle("fc-trap-active", b.dataset.fcValue === icon);
  });
  if (arenaWrap) arenaWrap.classList.add("arena-trap-mode");
}

function clearTrapMode() {
  _trapMode = null;
  document.querySelectorAll(".fc-btn[data-fc-type='trap']").forEach(b => b.classList.remove("fc-trap-active"));
  if (arenaWrap) arenaWrap.classList.remove("arena-trap-mode");
}

// ─── Bind: painel de zona (Desenhar / Cancelar) ───────────────────────────
function bindZonePanel() {
  if (fzpBtnDraw) {
    fzpBtnDraw.addEventListener("click", () => {
      const areaMode = fzpAreaSelect?.value || "free";
      if (areaMode === "all") {
        placeFullArenaZone();
      } else if (areaMode === "3x3" || areaMode === "5x5") {
        const sz = areaMode === "3x3" ? 3 : 5;
        startPresetMode(sz);
      } else {
        enterDrawingMode();
      }
    });
  }
  if (fzpBtnCancel) {
    fzpBtnCancel.addEventListener("click", () => clearZoneSelection());
  }
}

// ─── Modo desenho (arrastar retângulo) ────────────────────────────────────
function enterDrawingMode() {
  _drawingMode = true;
  if (arenaWrap) arenaWrap.classList.add("arena-drawing-mode");
  if (fzpBtnDraw) fzpBtnDraw.textContent = "🖱️ Arraste no mapa…";
}

function exitDrawingMode() {
  _drawingMode = false;
  _drawStart   = null;
  _drawCurrent = null;
  if (arenaWrap) arenaWrap.classList.remove("arena-drawing-mode");
  if (fzpBtnDraw) fzpBtnDraw.textContent = "▶ Desenhar área";
  if (drawCtx) drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
}

// Modo preset: usuário clica no centro e o sistema expande N×N
let _presetSize = null;
function startPresetMode(sz) {
  _presetSize  = sz;
  _drawingMode = false;
  if (arenaWrap) arenaWrap.classList.add("arena-drawing-mode");
  if (fzpBtnDraw) fzpBtnDraw.textContent = `🖱️ Clique no centro (${sz}×${sz})…`;
}

// ─── Bind: eventos de canvas (capture phase) ──────────────────────────────
function bindCanvasEvents() {
  if (!canvas) return;

  canvas.addEventListener("mousedown", onCanvasDown, true);
  canvas.addEventListener("mousemove", onCanvasMove, true);
  window.addEventListener("mouseup",   onCanvasUp,   true);

  // ESC cancela
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (_drawingMode || _presetSize !== null) {
      exitDrawingMode();
      _presetSize = null;
      if (arenaWrap) arenaWrap.classList.remove("arena-drawing-mode");
      if (fzpBtnDraw) fzpBtnDraw.textContent = "▶ Desenhar área";
    }
    if (_trapMode) clearTrapMode();
  });
}

function getTileFromEvent(ev) {
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  return window.screenToTile ? window.screenToTile(x, y) : null;
}

function onCanvasDown(ev) {
  if (ev.button !== 0) return;

  // Modo preset: clique para posicionar
  if (_presetSize !== null) {
    const tile = getTileFromEvent(ev);
    if (!tile) return;
    ev.stopImmediatePropagation();
    const half = Math.floor(_presetSize / 2);
    const gs   = window.appState?.gridSize || 10;
    const r0   = Math.max(0, tile.row - half);
    const r1   = Math.min(gs - 1, tile.row + half);
    const c0   = Math.max(0, tile.col - half);
    const c1   = Math.min(gs - 1, tile.col + half);
    _presetSize = null;
    arenaWrap?.classList.remove("arena-drawing-mode");
    if (fzpBtnDraw) fzpBtnDraw.textContent = "▶ Desenhar área";
    commitZone(r0, c0, r1, c1);
    return;
  }

  // Modo armadilha
  if (_trapMode) {
    const tile = getTileFromEvent(ev);
    if (!tile) return;
    ev.stopImmediatePropagation();
    placeTrap(_trapMode, tile.row, tile.col);
    return;
  }

  // Modo desenho livre
  if (_drawingMode) {
    const tile = getTileFromEvent(ev);
    if (!tile) return;
    ev.stopImmediatePropagation();
    _drawStart   = { ...tile };
    _drawCurrent = { ...tile };
    renderDrawPreview();
  }
}

function onCanvasMove(ev) {
  if (!_drawingMode || !_drawStart) return;
  const tile = getTileFromEvent(ev);
  if (!tile) return;
  ev.stopImmediatePropagation();
  _drawCurrent = { ...tile };
  renderDrawPreview();
}

function onCanvasUp(ev) {
  if (!_drawingMode || !_drawStart || !_drawCurrent) return;
  ev.stopImmediatePropagation();
  exitDrawingMode();

  const r0 = Math.min(_drawStart.row, _drawCurrent.row);
  const r1 = Math.max(_drawStart.row, _drawCurrent.row);
  const c0 = Math.min(_drawStart.col, _drawCurrent.col);
  const c1 = Math.max(_drawStart.col, _drawCurrent.col);
  commitZone(r0, c0, r1, c1);
}

// ─── Zona: toda arena ──────────────────────────────────────────────────────
async function placeFullArenaZone() {
  const gs = window.appState?.gridSize || 10;
  await commitZone(0, 0, gs - 1, gs - 1);
}

// ─── Commit: salva zona no Firestore (com detecção de conflito) ───────────
async function commitZone(r0, c0, r1, c1) {
  if (!_selectedZoneValue || !_selectedZoneType) return;

  // Gera lista de células
  const cells = [];
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++)
      cells.push({ row: r, col: c });

  const cellSet = new Set(cells.map(c => `${c.row},${c.col}`));

  // Checa conflitos com zonas existentes
  const existing = Array.isArray(window.appState?.zones) ? window.appState.zones : [];
  const conflicts = existing.filter(z => {
    if (!Array.isArray(z.cells)) return false;
    return z.cells.some(c => cellSet.has(`${c.row},${c.col}`));
  });

  let finalCells = cells;
  let zonesToRemove = [];

  if (conflicts.length > 0) {
    // Pergunta ao jogador o que fazer
    const conflictNames = conflicts.map(z => {
      const col = ZONE_COLORS[safeStr(z.value).toLowerCase()];
      return col ? col.label : safeStr(z.value);
    }).join(", ");

    const newName = ZONE_COLORS[_selectedZoneValue]?.label || _selectedZoneValue;

    const keep = await showConflictModal(conflictNames, newName);
    if (keep === "old") {
      // Mantém existente: remove células conflitantes da nova zona
      const conflictCells = new Set();
      for (const z of conflicts)
        for (const c of (z.cells || []))
          conflictCells.add(`${c.row},${c.col}`);
      finalCells = cells.filter(c => !conflictCells.has(`${c.row},${c.col}`));
      if (finalCells.length === 0) return; // nada sobrou
    } else if (keep === "new") {
      // Remove zonas conflitantes
      zonesToRemove = conflicts.map(z => z.id);
    } else {
      return; // cancelou
    }
  }

  const newZone = {
    id:        "z_" + nanoid8(),
    type:      _selectedZoneType,
    value:     _selectedZoneValue,
    cells:     finalCells,
    owner:     safeStr(window.appState?.by),
    createdAt: Date.now(),
  };

  await writeZoneToFirestore(newZone, zonesToRemove);
  syncZonePanelUI();
}

async function writeZoneToFirestore(newZone, idsToRemove = []) {
  const ref = window.getStateDocRef?.();
  if (!ref) { console.warn("[field-zones-patch] stateRef null"); return; }
  const db  = window.currentDb;
  if (!db)  { console.warn("[field-zones-patch] currentDb null"); return; }

  try {
    await window.runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      const data = snap.exists() ? snap.data() : {};
      let zones  = Array.isArray(data.zones) ? [...data.zones] : [];

      // Remove zonas conflitantes
      if (idsToRemove.length > 0)
        zones = zones.filter(z => !idsToRemove.includes(z.id));

      // Adiciona a nova
      zones.push(newZone);

      tx.set(ref, { zones, updatedAt: Date.now() }, { merge: true });
    });
  } catch (err) {
    console.error("[field-zones-patch] writeZone error:", err);
  }
}

// ─── Remover zona ──────────────────────────────────────────────────────────
async function removeZone(zoneId) {
  const ref = window.getStateDocRef?.();
  const db  = window.currentDb;
  if (!ref || !db) return;
  try {
    await window.runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      const data = snap.exists() ? snap.data() : {};
      const zones = (Array.isArray(data.zones) ? data.zones : []).filter(z => z.id !== zoneId);
      tx.set(ref, { zones, updatedAt: Date.now() }, { merge: true });
    });
  } catch (err) {
    console.error("[field-zones-patch] removeZone error:", err);
  }
}

// ─── Sincronizar lista de zonas no painel ────────────────────────────────
function syncZonePanelUI() {
  if (!fzpZonesList) return;
  const zones = Array.isArray(window.appState?.zones) ? window.appState.zones : [];
  if (zones.length === 0) {
    fzpZonesList.innerHTML = '<span style="font-size:11px;color:var(--muted,#64748b)">Nenhuma zona</span>';
    return;
  }
  fzpZonesList.innerHTML = "";
  for (const z of zones) {
    const col   = ZONE_COLORS[safeStr(z.value).toLowerCase()];
    const label = col?.label || safeStr(z.value);
    const chip  = document.createElement("div");
    chip.className = "fzp-zone-chip";
    chip.style.background   = col?.bg     || "rgba(56,189,248,.18)";
    chip.style.borderColor  = col?.border || "rgba(56,189,248,.35)";
    chip.innerHTML = `<span>${label}</span><span style="font-size:10px;color:var(--muted,#64748b)">(${Array.isArray(z.cells) ? z.cells.length : "?"})</span>`;
    const del = document.createElement("button");
    del.textContent = "×";
    del.title = "Remover zona";
    del.addEventListener("click", () => removeZone(z.id));
    chip.appendChild(del);
    fzpZonesList.appendChild(chip);
  }
}

// ─── Armadilhas ───────────────────────────────────────────────────────────
async function placeTrap(icon, row, col) {
  const ref = window.getStateDocRef?.();
  const db  = window.currentDb;
  if (!ref || !db) return;
  const by = safeStr(window.appState?.by);
  if (!by) return;

  const newTrap = {
    id:         "t_" + nanoid8(),
    icon,
    row,
    col,
    owner:      by,
    revealed:   false,
    revealedAt: null,
  };

  try {
    await window.runTransaction(db, async tx => {
      const snap  = await tx.get(ref);
      const data  = snap.exists() ? snap.data() : {};
      const traps = Array.isArray(data.traps) ? [...data.traps] : [];

      // Impede duplicata na mesma célula com o mesmo ícone
      const dup = traps.find(t => t.row === row && t.col === col && t.icon === icon);
      if (dup) return;

      traps.push(newTrap);
      tx.set(ref, { traps, updatedAt: Date.now() }, { merge: true });
    });
  } catch (err) {
    console.error("[field-zones-patch] placeTrap error:", err);
  }
}

// ─── Modal: Revelar Armadilhas ─────────────────────────────────────────────
function openTrapModal() {
  const role = safeStr(window.appState?.role);
  if (role === "spectator") return;

  const by    = safeStr(window.appState?.by);
  const traps = (Array.isArray(window.appState?.traps) ? window.appState.traps : [])
    .filter(t => safeStr(t.owner) === by && !t.revealed);

  if (traps.length === 0) {
    alert("Você não tem armadilhas ocultas no campo.");
    return;
  }

  trapModalList.innerHTML = "";
  for (const t of traps) {
    const item = document.createElement("label");
    item.className = "trap-modal-item";
    item.innerHTML = `
      <input type="checkbox" value="${t.id}" checked>
      <span class="tmi-icon">${t.icon || "🪨"}</span>
      <span class="tmi-name">${trapName(t.icon)}</span>
      <span class="tmi-pos">(${t.row}, ${t.col})</span>
    `;
    item.addEventListener("click", e => {
      if (e.target.tagName === "INPUT") {
        item.classList.toggle("selected", e.target.checked);
      }
    });
    const cb = item.querySelector("input");
    item.classList.add("selected"); // começa marcado
    trapModalList.appendChild(item);
  }

  trapModalBackdrop.style.display = "";
}

function closeTrapModal() {
  if (trapModalBackdrop) trapModalBackdrop.style.display = "none";
}

async function confirmReveal() {
  const checkboxes = trapModalList.querySelectorAll("input[type=checkbox]:checked");
  const ids = Array.from(checkboxes).map(cb => cb.value);
  if (ids.length === 0) { closeTrapModal(); return; }

  const ref = window.getStateDocRef?.();
  const db  = window.currentDb;
  if (!ref || !db) return;

  try {
    await window.runTransaction(db, async tx => {
      const snap  = await tx.get(ref);
      const data  = snap.exists() ? snap.data() : {};
      const traps = Array.isArray(data.traps) ? [...data.traps] : [];
      const now   = Date.now();
      for (const t of traps) {
        if (ids.includes(t.id)) { t.revealed = true; t.revealedAt = now; }
      }
      tx.set(ref, { traps, updatedAt: now }, { merge: true });
    });
    closeTrapModal();
  } catch (err) {
    console.error("[field-zones-patch] confirmReveal error:", err);
  }
}

function bindTrapModal() {
  if (trapModalConfirm) trapModalConfirm.addEventListener("click", confirmReveal);
  if (trapModalCancel)  trapModalCancel.addEventListener("click",  closeTrapModal);
  if (trapModalClose)   trapModalClose.addEventListener("click",   closeTrapModal);
  if (trapModalBackdrop) {
    trapModalBackdrop.addEventListener("click", e => {
      if (e.target === trapModalBackdrop) closeTrapModal();
    });
  }
}

function trapName(icon) {
  return icon === "🪨" ? "Stealth Rock"
       : icon === "🔺" ? "Spikes"
       : icon === "☠️" ? "Toxic Spikes"
       : icon === "🕸️" ? "Sticky Web"
       : icon || "Armadilha";
}

// ─── Modal: Conflito de zona ───────────────────────────────────────────────
function showConflictModal(existingNames, newName) {
  return new Promise(resolve => {
    _conflictResolve = resolve;
    if (conflictText) {
      conflictText.textContent =
        `Área conflita com zona(s) existente(s): ${existingNames}. O que fazer?`;
    }
    if (conflictKeepNew)  conflictKeepNew.textContent  = `Manter Novo (${newName})`;
    if (conflictKeepOld)  conflictKeepOld.textContent  = `Manter Existente (${existingNames})`;
    if (conflictBackdrop) conflictBackdrop.style.display = "";
  });
}

function closeConflictModal(result) {
  if (conflictBackdrop) conflictBackdrop.style.display = "none";
  if (_conflictResolve) { _conflictResolve(result); _conflictResolve = null; }
}

function bindConflictModal() {
  if (conflictKeepNew) conflictKeepNew.addEventListener("click", () => closeConflictModal("new"));
  if (conflictKeepOld) conflictKeepOld.addEventListener("click", () => closeConflictModal("old"));
  if (conflictBackdrop) {
    conflictBackdrop.addEventListener("click", e => {
      if (e.target === conflictBackdrop) closeConflictModal(null);
    });
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => setTimeout(() => waitForGlobals(init), 700));
} else {
  setTimeout(() => waitForGlobals(init), 700);
}
