/**
 * field-zones-patch.js
 *
 * Zoned weather / terrain with two placement flows:
 * - square: choose a radius, click a center tile, clip at board edges
 * - freehand: trace an outline, convert the filled area to board cells
 *
 * Traps keep their existing behavior.
 */

function $(id) { return document.getElementById(id); }
function safeStr(x) { return (x == null ? "" : String(x)).trim(); }
function nanoid8() {
  return Math.random().toString(36).slice(2, 10);
}

function waitForGlobals(cb, attempts = 0) {
  if (
    window.appState &&
    window.getStateDocRef &&
    window.runTransaction &&
    window.currentDb !== undefined
  ) {
    cb();
  } else if (attempts < 40) {
    setTimeout(() => waitForGlobals(cb, attempts + 1), 300);
  } else {
    console.warn("[field-zones-patch] globals not available after 12s");
  }
}

let _selectedZoneType = null;
let _selectedZoneValue = null;
let _trapMode = null;

let _zonePlacementMode = null; // "square" | "freehand"
let _squareRadius = null;
let _zoneHoverTile = null;
let _freehandPoints = [];
let _isFreehandDrawing = false;

let canvas, zoneCanvas, zoneCtx, drawCanvas, drawCtx, arenaWrap;
let fcZonePanel, fzpTypeLabel, fzpAreaSelect, fzpBtnDraw, fzpBtnCancel, fzpZonesList;
let trapModalBackdrop, trapModalList, trapModalConfirm, trapModalCancel, trapModalClose;
let zoneModeBackdrop, zoneModeTitle, zoneModeHint, zoneModeSelect, zoneRadiusRow, zoneRadiusInput, zoneModeConfirm, zoneModeCancel, zoneModeClose;
let conflictBackdrop, conflictText, conflictKeepNew, conflictKeepOld;
let _conflictResolve = null;
let _zoneModeResolve = null;
let _zoneRafHandle = 0;
let _overlayLayoutKey = "";
let _previewDirty = true;

const ZONE_COLORS = {
  sun:              { bg: "rgba(253,224,71,0.35)",  border: "rgba(253,224,71,0.7)",  label: "☀️ Sol Forte" },
  rain:             { bg: "rgba(56,189,248,0.25)",  border: "rgba(56,189,248,0.7)",  label: "🌧️ Chuva" },
  sandstorm:        { bg: "rgba(217,119,6,0.30)",   border: "rgba(217,119,6,0.7)",   label: "🌪️ Areia" },
  hail:             { bg: "rgba(186,230,253,0.30)", border: "rgba(186,230,253,0.7)", label: "🌨️ Granizo" },
  snow:             { bg: "rgba(186,230,253,0.25)", border: "rgba(186,230,253,0.7)", label: "❄️ Neve" },
  electric_terrain: { bg: "rgba(250,204,21,0.30)",  border: "rgba(250,204,21,0.7)",  label: "⚡ Terreno Eletrico" },
  grassy_terrain:   { bg: "rgba(74,222,128,0.25)",  border: "rgba(74,222,128,0.7)",  label: "🌿 Terreno Herboso" },
  psychic_terrain:  { bg: "rgba(192,132,252,0.25)", border: "rgba(192,132,252,0.7)", label: "🔮 Terreno Psiquico" },
  misty_terrain:    { bg: "rgba(249,168,212,0.25)", border: "rgba(249,168,212,0.7)", label: "🌸 Terreno de Nevoa" },
};

function getGridSize() {
  return Number(window.appState?.gridSize) || 10;
}

function getZoneLabel(value) {
  const key = safeStr(value).toLowerCase();
  return ZONE_COLORS[key]?.label || safeStr(value);
}

function ensureArenaRefs() {
  const nextCanvas = document.getElementById("arena");
  const nextZoneCanvas = $("zone_canvas");
  const nextDrawCanvas = $("zone_draw_canvas");
  const nextArenaWrap = document.getElementById("arena_wrap");

  if (nextCanvas) canvas = nextCanvas;
  if (nextZoneCanvas && nextZoneCanvas !== zoneCanvas) {
    zoneCanvas = nextZoneCanvas;
    zoneCtx = zoneCanvas.getContext("2d");
  }
  if (nextDrawCanvas && nextDrawCanvas !== drawCanvas) {
    drawCanvas = nextDrawCanvas;
    drawCtx = drawCanvas.getContext("2d");
  }
  if (nextArenaWrap) arenaWrap = nextArenaWrap;
}

function isVisibleElement(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle?.(el);
  return style?.display !== "none" && style?.visibility !== "hidden";
}

function getBoardLayout() {
  const sharedLayout = window.getArenaBoardLayout?.();
  if (
    sharedLayout &&
    Number.isFinite(Number(sharedLayout.width)) &&
    Number.isFinite(Number(sharedLayout.height)) &&
    Number(sharedLayout.width) > 0 &&
    Number(sharedLayout.height) > 0 &&
    Number.isFinite(Number(sharedLayout.tile)) &&
    Number(sharedLayout.tile) > 0
  ) {
    return sharedLayout;
  }

  ensureArenaRefs();
  const gs = getGridSize();
  const wrapRect = arenaWrap?.getBoundingClientRect?.();
  if (!wrapRect || wrapRect.width <= 0 || wrapRect.height <= 0 || gs <= 0) return null;

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const domBoard = document.getElementById("arena_dom");
  if (isVisibleElement(domBoard)) {
    const rect = domBoard.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const tile = Math.min(width, height) / gs;
    if (Number.isFinite(tile) && tile > 0) {
      return {
        mode: "dom",
        gs,
        width,
        height,
        tile,
        clientLeft: rect.left,
        clientTop: rect.top,
        relLeft: rect.left - wrapRect.left,
        relTop: rect.top - wrapRect.top,
        dpr,
      };
    }
  }

  const view = window._arenaView;
  const canvasRect = canvas?.getBoundingClientRect?.();
  if (
    canvasRect &&
    canvasRect.width > 0 &&
    canvasRect.height > 0 &&
    view &&
    Number.isFinite(Number(view.scale)) &&
    Number(view.scale) > 0
  ) {
    const tile = Number(view.scale);
    const width = gs * tile;
    const height = gs * tile;
    const clientLeft = canvasRect.left + Number(view.offX || 0);
    const clientTop = canvasRect.top + Number(view.offY || 0);
    return {
      mode: "canvas",
      gs,
      width,
      height,
      tile,
      clientLeft,
      clientTop,
      relLeft: clientLeft - wrapRect.left,
      relTop: clientTop - wrapRect.top,
      dpr,
    };
  }

  const side = Math.max(1, Math.min(wrapRect.width, wrapRect.height));
  const clientLeft = wrapRect.left + (wrapRect.width - side) / 2;
  const clientTop = wrapRect.top + (wrapRect.height - side) / 2;
  return {
    mode: "fallback",
    gs,
    width: side,
    height: side,
    tile: side / gs,
    clientLeft,
    clientTop,
    relLeft: clientLeft - wrapRect.left,
    relTop: clientTop - wrapRect.top,
    dpr,
  };
}

function cellKey(row, col) {
  return `${row},${col}`;
}

function normalizeCell(cell) {
  const row = Number(cell?.row);
  const col = Number(cell?.col);
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
  const gs = getGridSize();
  if (row < 0 || col < 0 || row >= gs || col >= gs) return null;
  return { row, col };
}

function dedupeCells(cells) {
  const out = [];
  const seen = new Set();
  for (const cell of Array.isArray(cells) ? cells : []) {
    const normalized = normalizeCell(cell);
    if (!normalized) continue;
    const key = cellKey(normalized.row, normalized.col);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function getZoneCells(zone) {
  return dedupeCells(Array.isArray(zone?.cells) ? zone.cells : []);
}

function getCanvasPointFromEvent(ev) {
  const layout = getBoardLayout();
  if (!layout) return null;
  const x = ev.clientX - layout.clientLeft;
  const y = ev.clientY - layout.clientTop;
  if (x < 0 || y < 0 || x > layout.width || y > layout.height) return null;
  return { x, y };
}

function canvasPointToTilePoint(x, y, layout = getBoardLayout()) {
  if (!layout) return null;
  const tile = Number(layout.tile);
  const gs = Number(layout.gs || getGridSize());
  if (!Number.isFinite(tile) || tile <= 0) return null;
  const row = Math.floor(y / tile);
  const col = Math.floor(x / tile);
  if (row < 0 || col < 0 || row >= gs || col >= gs) return null;
  return { row, col };
}

function getTileFromEvent(ev) {
  const point = getCanvasPointFromEvent(ev);
  if (!point) return null;
  return canvasPointToTilePoint(point.x, point.y);
}

function buildRectCells(r0, c0, r1, c1) {
  const gs = getGridSize();
  const minRow = Math.max(0, Math.min(gs - 1, Math.min(r0, r1)));
  const maxRow = Math.max(0, Math.min(gs - 1, Math.max(r0, r1)));
  const minCol = Math.max(0, Math.min(gs - 1, Math.min(c0, c1)));
  const maxCol = Math.max(0, Math.min(gs - 1, Math.max(c0, c1)));
  const cells = [];
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      cells.push({ row, col });
    }
  }
  return cells;
}

function buildSquareCells(centerRow, centerCol, radius) {
  const safeRadius = Math.max(0, Number(radius) || 0);
  return buildRectCells(
    centerRow - safeRadius,
    centerCol - safeRadius,
    centerRow + safeRadius,
    centerCol + safeRadius
  );
}

let _offscreenCanvas = null;
let _offscreenCtx = null;
let _zoneMaskCanvas = null;
let _zoneMaskCtx = null;

function getOffscreen(width, height) {
  if (!_offscreenCanvas) {
    _offscreenCanvas = document.createElement("canvas");
    _offscreenCtx = _offscreenCanvas.getContext("2d");
  }
  if (_offscreenCanvas.width !== width || _offscreenCanvas.height !== height) {
    _offscreenCanvas.width = width;
    _offscreenCanvas.height = height;
  }
  return { canvas: _offscreenCanvas, ctx: _offscreenCtx };
}

function getZoneMaskCanvas(width, height) {
  if (!_zoneMaskCanvas) {
    _zoneMaskCanvas = document.createElement("canvas");
    _zoneMaskCtx = _zoneMaskCanvas.getContext("2d", { willReadFrequently: true });
  }
  if (_zoneMaskCanvas.width !== width || _zoneMaskCanvas.height !== height) {
    _zoneMaskCanvas.width = width;
    _zoneMaskCanvas.height = height;
  }
  return { canvas: _zoneMaskCanvas, ctx: _zoneMaskCtx };
}

function getZoneBounds(cells) {
  const normalized = dedupeCells(cells);
  if (normalized.length === 0) return null;
  let minRow = Infinity;
  let maxRow = -Infinity;
  let minCol = Infinity;
  let maxCol = -Infinity;
  for (const cell of normalized) {
    minRow = Math.min(minRow, cell.row);
    maxRow = Math.max(maxRow, cell.row);
    minCol = Math.min(minCol, cell.col);
    maxCol = Math.max(maxCol, cell.col);
  }
  return { minRow, maxRow, minCol, maxCol };
}

function traceZonePath(ctx, cells, ox, oy, tile) {
  const normalized = dedupeCells(cells);
  const set = new Set(normalized.map((cell) => cellKey(cell.row, cell.col)));
  ctx.beginPath();
  for (const cell of normalized) {
    const x = ox + cell.col * tile;
    const y = oy + cell.row * tile;
    if (!set.has(cellKey(cell.row - 1, cell.col))) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + tile, y);
    }
    if (!set.has(cellKey(cell.row, cell.col + 1))) {
      ctx.moveTo(x + tile, y);
      ctx.lineTo(x + tile, y + tile);
    }
    if (!set.has(cellKey(cell.row + 1, cell.col))) {
      ctx.moveTo(x + tile, y + tile);
      ctx.lineTo(x, y + tile);
    }
    if (!set.has(cellKey(cell.row, cell.col - 1))) {
      ctx.moveTo(x, y + tile);
      ctx.lineTo(x, y);
    }
  }
}

function clipZoneCells(ctx, cells, ox, oy, tile) {
  const normalized = dedupeCells(cells);
  if (normalized.length === 0) return false;
  ctx.beginPath();
  for (const cell of normalized) {
    ctx.rect(ox + cell.col * tile, oy + cell.row * tile, tile, tile);
  }
  ctx.clip();
  return true;
}

function getPlacementSummary() {
  if (_zonePlacementMode === "square") {
    return `Quadrado raio ${Math.max(0, Number(_squareRadius) || 0)}`;
  }
  if (_zonePlacementMode === "freehand") {
    return "Traco livre";
  }
  return "Sem modo";
}

function resetFreehandState() {
  _freehandPoints = [];
  _isFreehandDrawing = false;
  _previewDirty = true;
}

function refreshZoneSelectionUI() {
  document.querySelectorAll(".fc-btn[data-fc-type='weather'], .fc-btn[data-fc-type='terrain']").forEach((button) => {
    const active =
      button.dataset.fcType === _selectedZoneType &&
      button.dataset.fcValue === _selectedZoneValue;
    button.classList.toggle("fc-zone-armed", active);
  });
}

function updateZonePanelControls() {
  if (fcZonePanel) fcZonePanel.style.display = _selectedZoneValue ? "" : "none";
  if (fzpTypeLabel) {
    const base = _selectedZoneValue ? getZoneLabel(_selectedZoneValue) : "—";
    fzpTypeLabel.textContent = _selectedZoneValue ? `${base} • ${getPlacementSummary()}` : base;
  }
  if (fzpBtnDraw) {
    if (!_selectedZoneValue) {
      fzpBtnDraw.textContent = "▶ Escolher modo";
    } else if (_zonePlacementMode === "square") {
      fzpBtnDraw.textContent = `⬛ Quadrado raio ${Math.max(0, Number(_squareRadius) || 0)}`;
    } else if (_zonePlacementMode === "freehand") {
      fzpBtnDraw.textContent = "🖊️ Traco livre";
    } else {
      fzpBtnDraw.textContent = "▶ Escolher modo";
    }
  }
}

function syncCanvasSize() {
  ensureArenaRefs();
  if (!zoneCanvas || !drawCanvas || !arenaWrap) return;
  const layout = getBoardLayout();
  if (!layout) return;

  const width = Math.max(1, Math.round(layout.width));
  const height = Math.max(1, Math.round(layout.height));
  const pixelWidth = Math.max(1, Math.round(width * layout.dpr));
  const pixelHeight = Math.max(1, Math.round(height * layout.dpr));
  const layoutKey = [
    Math.round(Number(layout.relLeft) || 0),
    Math.round(Number(layout.relTop) || 0),
    width,
    height,
    pixelWidth,
    pixelHeight,
    Math.round((Number(layout.dpr) || 1) * 100),
  ].join(":");

  if (layoutKey === _overlayLayoutKey) return;
  _overlayLayoutKey = layoutKey;

  for (const overlay of [zoneCanvas, drawCanvas]) {
    if (!overlay) continue;
    overlay.style.left = `${layout.relLeft}px`;
    overlay.style.top = `${layout.relTop}px`;
    overlay.style.right = "auto";
    overlay.style.bottom = "auto";
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;
    if (overlay.width !== pixelWidth || overlay.height !== pixelHeight) {
      overlay.width = pixelWidth;
      overlay.height = pixelHeight;
    }
  }

  zoneCtx?.setTransform(layout.dpr, 0, 0, layout.dpr, 0, 0);
  drawCtx?.setTransform(layout.dpr, 0, 0, layout.dpr, 0, 0);
  _previewDirty = true;
}

function drawZoneCellsPreview(ctx, cells, label) {
  const layout = getBoardLayout();
  if (!layout) return;
  const tile = Number(layout.tile);
  const ox = 0;
  const oy = 0;
  const color = ZONE_COLORS[safeStr(_selectedZoneValue).toLowerCase()] || {
    bg: "rgba(56,189,248,0.2)",
    border: "rgba(56,189,248,0.8)",
  };
  const normalized = dedupeCells(cells);
  if (!Number.isFinite(tile) || tile <= 0 || normalized.length === 0) return;

  ctx.save();
  ctx.fillStyle = color.bg;
  for (const cell of normalized) {
    ctx.fillRect(ox + cell.col * tile + 1, oy + cell.row * tile + 1, tile - 2, tile - 2);
  }
  ctx.strokeStyle = color.border;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  traceZonePath(ctx, normalized, ox, oy, tile);
  ctx.stroke();
  ctx.setLineDash([]);

  const bounds = getZoneBounds(normalized);
  if (bounds && label) {
    const centerX = ox + ((bounds.minCol + bounds.maxCol + 1) * tile) / 2;
    const centerY = oy + ((bounds.minRow + bounds.maxRow + 1) * tile) / 2;
    ctx.font = "bold 12px system-ui";
    ctx.fillStyle = "#fff";
    ctx.globalAlpha = 0.92;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 6;
    ctx.fillText(label, centerX, centerY);
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

function renderZones() {
  ensureArenaRefs();
  if (!zoneCtx || !zoneCanvas) return;
  const layout = getBoardLayout();
  if (!layout) return;
  const cssWidth = Math.max(1, Math.round(layout.width));
  const cssHeight = Math.max(1, Math.round(layout.height));
  const width = zoneCanvas.width;
  const height = zoneCanvas.height;
  zoneCtx.clearRect(0, 0, cssWidth, cssHeight);

  const zones = Array.isArray(window.appState?.zones) ? window.appState.zones : [];
  if (zones.length === 0) return;

  const tile = Number(layout.tile);
  const ox = 0;
  const oy = 0;
  const gs = Number(layout.gs || getGridSize());
  if (!Number.isFinite(tile) || tile <= 0) return;

  const { canvas: offscreen, ctx: offCtx } = getOffscreen(width, height);
  const dpr = width / cssWidth;
  for (const zone of zones) {
    const cells = getZoneCells(zone);
    if (cells.length === 0) continue;

    offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    offCtx.clearRect(0, 0, cssWidth, cssHeight);

    const drawWeather = window.drawWeatherOverlay;
    if (typeof drawWeather === "function") {
      const scopedBattle = { weather: null, terrain: null };
      if (safeStr(zone.type) === "weather") scopedBattle.weather = zone.value;
      if (safeStr(zone.type) === "terrain") scopedBattle.terrain = zone.value;
      drawWeather(offCtx, ox, oy, gs, tile, cssWidth, cssHeight, scopedBattle);
    } else {
      const color = ZONE_COLORS[safeStr(zone.value).toLowerCase()] || { bg: "rgba(56,189,248,0.2)" };
      offCtx.fillStyle = color.bg;
      offCtx.fillRect(ox, oy, gs * tile, gs * tile);
    }

    zoneCtx.save();
    if (clipZoneCells(zoneCtx, cells, ox, oy, tile)) {
      zoneCtx.drawImage(offscreen, 0, 0, cssWidth, cssHeight);
    }
    zoneCtx.restore();

    const color = ZONE_COLORS[safeStr(zone.value).toLowerCase()];
    if (color) {
      zoneCtx.save();
      zoneCtx.strokeStyle = color.border;
      zoneCtx.lineWidth = 2;
      zoneCtx.setLineDash([4, 4]);
      traceZonePath(zoneCtx, cells, ox, oy, tile);
      zoneCtx.stroke();
      zoneCtx.setLineDash([]);
      zoneCtx.restore();
    }

    const bounds = getZoneBounds(cells);
    if (!bounds) continue;
    const label = getZoneLabel(zone.value);
    zoneCtx.save();
    zoneCtx.globalAlpha = 0.92;
    zoneCtx.font = `bold ${Math.max(9, Math.min(12, tile * 0.3))}px system-ui`;
    zoneCtx.fillStyle = "#fff";
    zoneCtx.textAlign = "left";
    zoneCtx.textBaseline = "top";
    zoneCtx.shadowColor = "rgba(0,0,0,0.9)";
    zoneCtx.shadowBlur = 5;
    zoneCtx.fillText(label, ox + bounds.minCol * tile + 4, oy + bounds.minRow * tile + 3);
    zoneCtx.shadowBlur = 0;
    zoneCtx.restore();
  }
}

function hasZoneAnimation() {
  const zones = Array.isArray(window.appState?.zones) ? window.appState.zones : [];
  return zones.length > 0;
}

function hasZonePreview() {
  if (!_selectedZoneValue || !_zonePlacementMode) return false;
  if (_zonePlacementMode === "square") return !!_zoneHoverTile;
  return _isFreehandDrawing || _freehandPoints.length > 0;
}

function requestZoneFrame() {
  if (_zoneRafHandle) return;
  _zoneRafHandle = requestAnimationFrame(renderZoneFrame);
}

function renderZoneFrame() {
  _zoneRafHandle = 0;
  syncCanvasSize();
  renderZones();
  if (_previewDirty || hasZonePreview()) {
    renderDrawPreview();
  }
  if (hasZoneAnimation()) {
    _zoneRafHandle = requestAnimationFrame(renderZoneFrame);
  }
}
function addSampledPathCells(points, keys, tile) {
  if (!Array.isArray(points) || points.length === 0) return;
  const addPoint = (point) => {
    const tilePoint = canvasPointToTilePoint(point.x, point.y);
    if (tilePoint) keys.add(cellKey(tilePoint.row, tilePoint.col));
  };
  addPoint(points[0]);
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const dist = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const steps = Math.max(1, Math.ceil(dist / Math.max(4, tile * 0.35)));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      addPoint({
        x: prev.x + (curr.x - prev.x) * t,
        y: prev.y + (curr.y - prev.y) * t,
      });
    }
  }
}

function buildFreehandCells(points) {
  const usablePoints = Array.isArray(points) ? points.filter(Boolean) : [];
  if (!drawCanvas || usablePoints.length === 0) return [];
  if (usablePoints.length === 1) {
    const tilePoint = canvasPointToTilePoint(usablePoints[0].x, usablePoints[0].y);
    return tilePoint ? [tilePoint] : [];
  }

  const layout = getBoardLayout();
  if (!layout) return [];
  const tile = Number(layout.tile);
  const gs = Number(layout.gs || getGridSize());
  if (!Number.isFinite(tile) || tile <= 0) return [];

  const maskWidth = Math.max(1, Math.round(layout.width));
  const maskHeight = Math.max(1, Math.round(layout.height));
  const { ctx: maskCtx } = getZoneMaskCanvas(maskWidth, maskHeight);
  if (!maskCtx) return [];

  maskCtx.clearRect(0, 0, maskWidth, maskHeight);
  maskCtx.save();
  maskCtx.fillStyle = "#000";
  maskCtx.strokeStyle = "#000";
  maskCtx.lineWidth = Math.max(4, tile * 0.45);
  maskCtx.lineJoin = "round";
  maskCtx.lineCap = "round";
  maskCtx.beginPath();
  maskCtx.moveTo(usablePoints[0].x, usablePoints[0].y);
  for (let i = 1; i < usablePoints.length; i++) {
    maskCtx.lineTo(usablePoints[i].x, usablePoints[i].y);
  }
  maskCtx.closePath();
  maskCtx.fill();
  maskCtx.stroke();
  maskCtx.restore();

  const imageData = maskCtx.getImageData(0, 0, maskWidth, maskHeight);
  const alpha = imageData.data;
  const cellKeys = new Set();
  addSampledPathCells(usablePoints, cellKeys, tile);

  const samples = [
    [0.5, 0.5],
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
  ];

  for (let row = 0; row < gs; row++) {
    for (let col = 0; col < gs; col++) {
      const baseX = col * tile;
      const baseY = row * tile;
      let inside = false;
      for (const [sx, sy] of samples) {
        const px = Math.max(0, Math.min(maskWidth - 1, Math.round(baseX + tile * sx)));
        const py = Math.max(0, Math.min(maskHeight - 1, Math.round(baseY + tile * sy)));
        if (alpha[(py * maskWidth + px) * 4 + 3] > 12) {
          inside = true;
          break;
        }
      }
      if (inside) cellKeys.add(cellKey(row, col));
    }
  }

  return Array.from(cellKeys).map((key) => {
    const [row, col] = key.split(",").map(Number);
    return { row, col };
  });
}

function renderDrawPreview() {
  ensureArenaRefs();
  if (!drawCtx || !drawCanvas) return;
  const layout = getBoardLayout();
  if (!layout) return;
  drawCtx.clearRect(0, 0, layout.width, layout.height);
  _previewDirty = false;
  if (!_selectedZoneValue) return;

  if (_zonePlacementMode === "square" && _zoneHoverTile) {
    drawZoneCellsPreview(
      drawCtx,
      buildSquareCells(_zoneHoverTile.row, _zoneHoverTile.col, _squareRadius),
      `Raio ${Math.max(0, Number(_squareRadius) || 0)}`
    );
    return;
  }

  if (_zonePlacementMode === "freehand" && _freehandPoints.length > 0) {
    const color = ZONE_COLORS[safeStr(_selectedZoneValue).toLowerCase()] || {
      bg: "rgba(56,189,248,0.2)",
      border: "rgba(56,189,248,0.8)",
    };

    drawCtx.save();
    drawCtx.beginPath();
    drawCtx.moveTo(_freehandPoints[0].x, _freehandPoints[0].y);
    for (let i = 1; i < _freehandPoints.length; i++) {
      drawCtx.lineTo(_freehandPoints[i].x, _freehandPoints[i].y);
    }
    if (_freehandPoints.length > 2) {
      drawCtx.closePath();
      drawCtx.fillStyle = color.bg;
      drawCtx.fill();
    }
    drawCtx.strokeStyle = color.border;
    drawCtx.lineWidth = 3;
    drawCtx.lineJoin = "round";
    drawCtx.lineCap = "round";
    drawCtx.setLineDash([6, 4]);
    drawCtx.stroke();
    drawCtx.setLineDash([]);
    drawCtx.restore();
  }
}

function syncZoneModeModalState() {
  if (!zoneModeSelect || !zoneRadiusRow) return;
  const mode = safeStr(zoneModeSelect.value).toLowerCase() || "freehand";
  zoneRadiusRow.style.display = mode === "square" ? "" : "none";
}

function closeZoneModeModal(result) {
  if (zoneModeBackdrop) zoneModeBackdrop.style.display = "none";
  if (_zoneModeResolve) {
    _zoneModeResolve(result);
    _zoneModeResolve = null;
  }
}

function askPlacementMode(effectLabel) {
  if (!zoneModeBackdrop || !zoneModeSelect || !zoneModeConfirm || !zoneModeCancel) {
    return Promise.resolve({ mode: "freehand", radius: null });
  }

  const defaultMode = _zonePlacementMode === "square" ? "square" : "freehand";
  const defaultRadius = Math.max(0, Number.isFinite(_squareRadius) ? _squareRadius : 2);
  if (zoneModeTitle) zoneModeTitle.textContent = `Definir Area: ${effectLabel}`;
  if (zoneModeHint) {
    zoneModeHint.textContent =
      `Escolha se ${effectLabel} sera aplicado por traco livre ou por um quadrado centrado em um tile.`;
  }
  zoneModeSelect.value = defaultMode;
  if (zoneRadiusInput) zoneRadiusInput.value = String(defaultRadius);
  syncZoneModeModalState();
  zoneModeBackdrop.style.display = "";

  return new Promise((resolve) => {
    _zoneModeResolve = resolve;
    window.setTimeout(() => {
      if (zoneModeSelect) zoneModeSelect.focus();
    }, 0);
  });
}

function bindZoneModeModal() {
  if (zoneModeSelect) {
    zoneModeSelect.addEventListener("change", syncZoneModeModalState);
  }

  if (zoneModeConfirm) {
    zoneModeConfirm.addEventListener("click", () => {
      const mode = safeStr(zoneModeSelect?.value).toLowerCase() === "square" ? "square" : "freehand";
      if (mode === "square") {
        const radius = Number.parseInt(zoneRadiusInput?.value || "", 10);
        if (!Number.isFinite(radius) || radius < 0) {
          if (zoneRadiusInput) zoneRadiusInput.focus();
          return;
        }
        closeZoneModeModal({ mode, radius });
        return;
      }
      closeZoneModeModal({ mode: "freehand", radius: null });
    });
  }

  if (zoneModeCancel) zoneModeCancel.addEventListener("click", () => closeZoneModeModal(null));
  if (zoneModeClose) zoneModeClose.addEventListener("click", () => closeZoneModeModal(null));
  if (zoneModeBackdrop) {
    zoneModeBackdrop.addEventListener("click", (ev) => {
      if (ev.target === zoneModeBackdrop) closeZoneModeModal(null);
    });
  }

  if (zoneRadiusInput) {
    zoneRadiusInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        zoneModeConfirm?.click();
      }
    });
  }
}

function armZonePlacement(mode, radius) {
  _zonePlacementMode = mode;
  _squareRadius = mode === "square" ? Math.max(0, Number(radius) || 0) : null;
  _zoneHoverTile = null;
  resetFreehandState();
  if (arenaWrap) arenaWrap.classList.add("arena-drawing-mode");
  updateZonePanelControls();
}

function setZoneSelection(type, value, placement) {
  clearTrapMode();
  _selectedZoneType = type;
  _selectedZoneValue = value;
  refreshZoneSelectionUI();
  updateZonePanelControls();
  armZonePlacement(placement.mode, placement.radius);
  requestZoneFrame();
}

function clearZoneSelection() {
  _selectedZoneType = null;
  _selectedZoneValue = null;
  _zonePlacementMode = null;
  _squareRadius = null;
  _zoneHoverTile = null;
  resetFreehandState();
  if (arenaWrap) arenaWrap.classList.remove("arena-drawing-mode");
  refreshZoneSelectionUI();
  updateZonePanelControls();
  requestZoneFrame();
}

function setTrapMode(icon) {
  clearZoneSelection();
  _trapMode = icon;
  document.querySelectorAll(".fc-btn[data-fc-type='trap']").forEach((button) => {
    button.classList.toggle("fc-trap-active", button.dataset.fcValue === icon);
  });
  if (arenaWrap) arenaWrap.classList.add("arena-trap-mode");
  requestZoneFrame();
}

function clearTrapMode() {
  _trapMode = null;
  document.querySelectorAll(".fc-btn[data-fc-type='trap']").forEach((button) => {
    button.classList.remove("fc-trap-active");
  });
  if (arenaWrap) arenaWrap.classList.remove("arena-trap-mode");
  requestZoneFrame();
}

async function chooseZonePlacement(type, value) {
  const placement = await askPlacementMode(getZoneLabel(value));
  if (!placement) return;
  setZoneSelection(type, value, placement);
}

function bindFieldConditions() {
  const bar = $("field_conditions");
  if (!bar) return;

  bar.addEventListener("click", async (ev) => {
    const button = ev.target.closest(".fc-btn[data-fc-type]");
    if (!button) return;

    const role = safeStr(window.appState?.role);
    if (role === "spectator") return;

    ev.preventDefault();
    ev.stopImmediatePropagation();
    ev.stopPropagation();

    const type = button.dataset.fcType;
    const value = button.dataset.fcValue;

    if (type === "trap") {
      if (_trapMode === value) {
        clearTrapMode();
      } else {
        setTrapMode(value);
      }
      return;
    }

    if (_selectedZoneType === type && _selectedZoneValue === value) {
      clearZoneSelection();
      return;
    }

    await chooseZonePlacement(type, value);
  }, true);

  const btnReveal = $("btn_reveal_traps");
  if (btnReveal) {
    btnReveal.addEventListener("click", openTrapModal);
  }
}

function bindZonePanel() {
  if (fzpAreaSelect) {
    fzpAreaSelect.disabled = true;
    const group = fzpAreaSelect.closest(".fzp-area-group");
    if (group) group.style.display = "none";
  }

  if (fzpBtnDraw) {
    fzpBtnDraw.addEventListener("click", async () => {
      if (!_selectedZoneType || !_selectedZoneValue) return;
      await chooseZonePlacement(_selectedZoneType, _selectedZoneValue);
    });
  }

  if (fzpBtnCancel) {
    fzpBtnCancel.addEventListener("click", () => clearZoneSelection());
  }
}
function bindCanvasEvents() {
  document.addEventListener("mousedown", onCanvasDown, true);
  document.addEventListener("mousemove", onCanvasMove, true);
  window.addEventListener("mouseup", onCanvasUp, true);

  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (zoneModeBackdrop && zoneModeBackdrop.style.display !== "none") {
      closeZoneModeModal(null);
      return;
    }
    if (_trapMode) {
      clearTrapMode();
      return;
    }
    if (_selectedZoneValue) {
      clearZoneSelection();
    }
  });
}

function onCanvasDown(ev) {
  if (ev.button !== 0) return;

  if (_trapMode) {
    const tile = getTileFromEvent(ev);
    if (!tile) return;
    ev.stopImmediatePropagation();
    ev.stopPropagation();
    placeTrap(_trapMode, tile.row, tile.col);
    return;
  }

  if (!_selectedZoneValue || !_zonePlacementMode) return;

  if (_zonePlacementMode === "square") {
    const tile = getTileFromEvent(ev);
    if (!tile) return;
    ev.stopImmediatePropagation();
    ev.stopPropagation();
    const cells = buildSquareCells(tile.row, tile.col, _squareRadius);
    commitZoneCells(cells, { shape: "square", radius: _squareRadius, center: tile });
    return;
  }

  if (_zonePlacementMode === "freehand") {
    const point = getCanvasPointFromEvent(ev);
    const tile = point ? canvasPointToTilePoint(point.x, point.y) : null;
    if (!point || !tile) return;
    ev.stopImmediatePropagation();
    ev.stopPropagation();
    _isFreehandDrawing = true;
    _freehandPoints = [point];
    _zoneHoverTile = tile;
    _previewDirty = true;
    requestZoneFrame();
  }
}

function onCanvasMove(ev) {
  if (_trapMode) return;
  if (!_selectedZoneValue || !_zonePlacementMode) return;

  if (_zonePlacementMode === "square") {
    _zoneHoverTile = getTileFromEvent(ev);
    _previewDirty = true;
    requestZoneFrame();
    return;
  }

  if (_zonePlacementMode === "freehand") {
    const point = getCanvasPointFromEvent(ev);
    const tile = point ? canvasPointToTilePoint(point.x, point.y) : null;
    if (tile) _zoneHoverTile = tile;
    if (!_isFreehandDrawing || !point || !tile) return;
    ev.stopImmediatePropagation();
    ev.stopPropagation();
    _freehandPoints.push(point);
    _previewDirty = true;
    requestZoneFrame();
  }
}

function onCanvasUp(ev) {
  if (!_selectedZoneValue || _zonePlacementMode !== "freehand" || !_isFreehandDrawing) return;
  ev.stopImmediatePropagation();
  ev.stopPropagation();
  _isFreehandDrawing = false;
  const cells = buildFreehandCells(_freehandPoints);
  resetFreehandState();
  requestZoneFrame();
  if (cells.length === 0) return;
  commitZoneCells(cells, { shape: "freehand" });
}

async function commitZoneCells(cells, meta = {}) {
  if (!_selectedZoneType || !_selectedZoneValue) return;

  const normalizedCells = dedupeCells(cells);
  if (normalizedCells.length === 0) return;

  const cellSet = new Set(normalizedCells.map((cell) => cellKey(cell.row, cell.col)));
  const existing = Array.isArray(window.appState?.zones) ? window.appState.zones : [];
  const conflicts = existing.filter((zone) => {
    const zoneCells = getZoneCells(zone);
    return zoneCells.some((cell) => cellSet.has(cellKey(cell.row, cell.col)));
  });

  let finalCells = normalizedCells;
  let zonesToRemove = [];

  if (conflicts.length > 0) {
    const conflictNames = conflicts.map((zone) => getZoneLabel(zone.value)).join(", ");
    const keep = await showConflictModal(conflictNames, getZoneLabel(_selectedZoneValue));
    if (keep === "old") {
      const conflictKeys = new Set();
      for (const zone of conflicts) {
        for (const cell of getZoneCells(zone)) {
          conflictKeys.add(cellKey(cell.row, cell.col));
        }
      }
      finalCells = normalizedCells.filter((cell) => !conflictKeys.has(cellKey(cell.row, cell.col)));
      if (finalCells.length === 0) return;
    } else if (keep === "new") {
      zonesToRemove = conflicts.map((zone) => zone.id);
    } else {
      return;
    }
  }

  const newZone = {
    id: "z_" + nanoid8(),
    type: _selectedZoneType,
    value: _selectedZoneValue,
    cells: finalCells,
    owner: safeStr(window.appState?.by),
    shape: meta.shape || _zonePlacementMode || "square",
    radius: meta.shape === "square" ? Math.max(0, Number(meta.radius) || 0) : null,
    createdAt: Date.now(),
  };

  await writeZoneToFirestore(newZone, zonesToRemove);
  syncZonePanelUI();
}

async function writeZoneToFirestore(newZone, idsToRemove = []) {
  const ref = window.getStateDocRef?.();
  const db = window.currentDb;
  if (!ref || !db) return;

  try {
    await window.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists() ? snap.data() : {};
      let zones = Array.isArray(data.zones) ? [...data.zones] : [];

      if (idsToRemove.length > 0) {
        zones = zones.filter((zone) => !idsToRemove.includes(zone.id));
      }

      zones.push(newZone);
      tx.set(ref, { zones, updatedAt: Date.now() }, { merge: true });
    });
  } catch (err) {
    console.error("[field-zones-patch] writeZone error:", err);
  }
}

async function removeZone(zoneId) {
  const ref = window.getStateDocRef?.();
  const db = window.currentDb;
  if (!ref || !db) return;

  try {
    await window.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists() ? snap.data() : {};
      const zones = (Array.isArray(data.zones) ? data.zones : []).filter((zone) => zone.id !== zoneId);
      tx.set(ref, { zones, updatedAt: Date.now() }, { merge: true });
    });
  } catch (err) {
    console.error("[field-zones-patch] removeZone error:", err);
  }
}

function getZoneConditionsAtTile(row, col) {
  const result = { weather: null, terrain: null, zones: [] };
  const zones = Array.isArray(window.appState?.zones) ? window.appState.zones : [];
  for (const zone of zones) {
    const hasCell = getZoneCells(zone).some((cell) => cell.row === row && cell.col === col);
    if (!hasCell) continue;
    result.zones.push(zone);
    if (zone.type === "weather") result.weather = zone.value;
    if (zone.type === "terrain") result.terrain = zone.value;
  }
  return result;
}

window.getZoneConditionsAtTile = getZoneConditionsAtTile;

function syncZonePanelUI() {
  refreshZoneSelectionUI();
  updateZonePanelControls();

  if (!fzpZonesList) return;
  const zones = (Array.isArray(window.appState?.zones) ? [...window.appState.zones] : [])
    .sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0));

  if (zones.length === 0) {
    fzpZonesList.innerHTML = '<span style="font-size:11px;color:var(--muted,#64748b)">Nenhuma zona</span>';
    return;
  }

  fzpZonesList.innerHTML = "";
  for (const zone of zones) {
    const color = ZONE_COLORS[safeStr(zone.value).toLowerCase()];
    const chip = document.createElement("div");
    chip.className = "fzp-zone-chip";
    chip.style.background = color?.bg || "rgba(56,189,248,.18)";
    chip.style.borderColor = color?.border || "rgba(56,189,248,.35)";
    const cellCount = getZoneCells(zone).length;
    const shapeLabel =
      safeStr(zone.shape) === "square"
        ? `quadrado r${Math.max(0, Number(zone.radius) || 0)}`
        : "livre";
    chip.innerHTML = `<span>${getZoneLabel(zone.value)}</span><span style="font-size:10px;color:var(--muted,#64748b)">(${cellCount} • ${shapeLabel})</span>`;

    const removeButton = document.createElement("button");
    removeButton.textContent = "×";
    removeButton.title = "Remover zona";
    removeButton.addEventListener("click", () => removeZone(zone.id));
    chip.appendChild(removeButton);
    fzpZonesList.appendChild(chip);
  }
  requestZoneFrame();
}
async function placeTrap(icon, row, col) {
  const ref = window.getStateDocRef?.();
  const db = window.currentDb;
  const by = safeStr(window.appState?.by);
  if (!ref || !db || !by) return;

  const newTrap = {
    id: "t_" + nanoid8(),
    icon,
    row,
    col,
    owner: by,
    revealed: false,
    revealedAt: null,
  };

  try {
    await window.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists() ? snap.data() : {};
      const traps = Array.isArray(data.traps) ? [...data.traps] : [];
      const duplicate = traps.find((trap) => trap.row === row && trap.col === col && trap.icon === icon);
      if (duplicate) return;
      traps.push(newTrap);
      tx.set(ref, { traps, updatedAt: Date.now() }, { merge: true });
    });
  } catch (err) {
    console.error("[field-zones-patch] placeTrap error:", err);
  }
}

function trapName(icon) {
  return icon === "🪨" ? "Stealth Rock"
    : icon === "🔺" ? "Spikes"
    : icon === "☠️" ? "Toxic Spikes"
    : icon === "🕸️" ? "Sticky Web"
    : icon || "Armadilha";
}

function openTrapModal() {
  const role = safeStr(window.appState?.role);
  if (role === "spectator") return;

  const by = safeStr(window.appState?.by);
  const traps = (Array.isArray(window.appState?.traps) ? window.appState.traps : [])
    .filter((trap) => safeStr(trap.owner) === by && !trap.revealed);

  if (traps.length === 0) {
    alert("Voce nao tem armadilhas ocultas no campo.");
    return;
  }

  trapModalList.innerHTML = "";
  for (const trap of traps) {
    const item = document.createElement("label");
    item.className = "trap-modal-item selected";
    item.innerHTML = `
      <input type="checkbox" value="${trap.id}" checked>
      <span class="tmi-icon">${trap.icon || "🪨"}</span>
      <span class="tmi-name">${trapName(trap.icon)}</span>
      <span class="tmi-pos">(${trap.row}, ${trap.col})</span>
    `;
    item.addEventListener("click", (ev) => {
      if (ev.target.tagName === "INPUT") {
        item.classList.toggle("selected", ev.target.checked);
      }
    });
    trapModalList.appendChild(item);
  }

  trapModalBackdrop.style.display = "";
}

function closeTrapModal() {
  if (trapModalBackdrop) trapModalBackdrop.style.display = "none";
}

async function confirmReveal() {
  const ids = Array.from(
    trapModalList.querySelectorAll("input[type=checkbox]:checked"),
    (checkbox) => checkbox.value
  );
  if (ids.length === 0) {
    closeTrapModal();
    return;
  }

  const ref = window.getStateDocRef?.();
  const db = window.currentDb;
  if (!ref || !db) return;

  try {
    await window.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists() ? snap.data() : {};
      const traps = Array.isArray(data.traps) ? [...data.traps] : [];
      const now = Date.now();
      for (const trap of traps) {
        if (ids.includes(trap.id)) {
          trap.revealed = true;
          trap.revealedAt = now;
        }
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
  if (trapModalCancel) trapModalCancel.addEventListener("click", closeTrapModal);
  if (trapModalClose) trapModalClose.addEventListener("click", closeTrapModal);
  if (trapModalBackdrop) {
    trapModalBackdrop.addEventListener("click", (ev) => {
      if (ev.target === trapModalBackdrop) closeTrapModal();
    });
  }
}

function showConflictModal(existingNames, newName) {
  return new Promise((resolve) => {
    _conflictResolve = resolve;
    if (conflictText) {
      conflictText.textContent =
        `Area conflita com zona(s) existente(s): ${existingNames}. O que fazer?`;
    }
    if (conflictKeepNew) conflictKeepNew.textContent = `Manter Novo (${newName})`;
    if (conflictKeepOld) conflictKeepOld.textContent = `Manter Existente (${existingNames})`;
    if (conflictBackdrop) conflictBackdrop.style.display = "";
  });
}

function closeConflictModal(result) {
  if (conflictBackdrop) conflictBackdrop.style.display = "none";
  if (_conflictResolve) {
    _conflictResolve(result);
    _conflictResolve = null;
  }
}

function bindConflictModal() {
  if (conflictKeepNew) conflictKeepNew.addEventListener("click", () => closeConflictModal("new"));
  if (conflictKeepOld) conflictKeepOld.addEventListener("click", () => closeConflictModal("old"));
  if (conflictBackdrop) {
    conflictBackdrop.addEventListener("click", (ev) => {
      if (ev.target === conflictBackdrop) closeConflictModal(null);
    });
  }
}

function init() {
  ensureArenaRefs();
  canvas = document.getElementById("arena");
  zoneCanvas = $("zone_canvas");
  drawCanvas = $("zone_draw_canvas");
  arenaWrap = document.getElementById("arena_wrap");

  if (!canvas || !zoneCanvas || !drawCanvas || !arenaWrap) {
    setTimeout(init, 500);
    return;
  }

  zoneCtx = zoneCanvas.getContext("2d");
  drawCtx = drawCanvas.getContext("2d");

  fcZonePanel = $("fc_zone_panel");
  fzpTypeLabel = $("fzp_type_label");
  fzpAreaSelect = $("fzp_area_select");
  fzpBtnDraw = $("fzp_btn_draw");
  fzpBtnCancel = $("fzp_btn_cancel");
  fzpZonesList = $("fzp_zones_list");

  trapModalBackdrop = $("trap_modal_backdrop");
  trapModalList = $("trap_modal_list");
  trapModalConfirm = $("trap_modal_confirm");
  trapModalCancel = $("trap_modal_cancel");
  trapModalClose = $("trap_modal_close");

  zoneModeBackdrop = $("zone_mode_backdrop");
  zoneModeTitle = $("zone_mode_title");
  zoneModeHint = $("zone_mode_hint");
  zoneModeSelect = $("zone_mode_select");
  zoneRadiusRow = $("zone_radius_row");
  zoneRadiusInput = $("zone_radius_input");
  zoneModeConfirm = $("zone_mode_confirm");
  zoneModeCancel = $("zone_mode_cancel");
  zoneModeClose = $("zone_mode_close");

  conflictBackdrop = $("zone_conflict_backdrop");
  conflictText = $("zone_conflict_text");
  conflictKeepNew = $("zone_conflict_keep_new");
  conflictKeepOld = $("zone_conflict_keep_old");

  bindFieldConditions();
  bindZonePanel();
  bindCanvasEvents();
  bindTrapModal();
  bindZoneModeModal();
  bindConflictModal();
  syncZonePanelUI();
  setInterval(syncZonePanelUI, 800);

  console.log("[field-zones-patch] ready");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => setTimeout(() => waitForGlobals(init), 700));
} else {
  setTimeout(() => waitForGlobals(init), 700);
}
