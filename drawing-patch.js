// ═══════════════════════════════════════════════════════════════════════════
// drawing-patch.js  —  Desenho livre no grid da Arena
//
// Funcionalidades:
//   • Botão "🖌️" na barra da arena ativa/desativa o modo de desenho
//   • Ferramentas: caneta (freehand), borracha, cor, espessura
//   • Desfazer último traço, limpar tudo
//   • Sync em tempo real via Firestore (rooms/{rid}/public_state/drawings)
//   • Suporte a touch (mobile/tablet)
//
// Arquitetura:
//   • Canvas próprio (#draw-canvas) acima do zone_draw_canvas (z-index 4)
//   • Traços armazenados como arrays de pontos em coordenadas BRUTAS do canvas
//   • Cada stroke: { id, by, color, width, tool, points:[[x,y],...] }
//   • Sincroniza via setDoc merge em public_state/drawings
// ═══════════════════════════════════════════════════════════════════════════

import {
  doc, onSnapshot, setDoc, runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// ── helpers ──────────────────────────────────────────────────────────────
const safeStr = (v) => (v == null ? "" : String(v).trim());
let _uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;

// ── state ─────────────────────────────────────────────────────────────────
let _db   = null;
let _rid  = null;
let _by   = null;
let _unsub = null;

let _drawMode  = false;
let _tool      = "pen";   // "pen" | "eraser"
let _color     = "#ff4444";
let _lineWidth  = 4;
let _strokes   = [];      // all strokes from Firestore
let _currentStroke = null; // stroke being drawn right now
let _isDrawing = false;
const MAX_STROKES = 80;   // limit to avoid Firestore doc size issues

// ── DOM references ────────────────────────────────────────────────────────
let _drawCanvas = null;   // our canvas element
let _drawCtx    = null;

// ── CSS (injected once) ───────────────────────────────────────────────────
const STYLE_ID = "drawing-patch-style";
if (!document.getElementById(STYLE_ID)) {
  const st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent = `
#draw-canvas {
  position: absolute;
  top: 0; left: 0;
  pointer-events: none;
  z-index: 4;
  touch-action: none;
}
#draw-canvas.draw-active {
  pointer-events: auto;
  cursor: crosshair;
}
#draw-canvas.draw-active.eraser-mode {
  cursor: cell;
}
#draw-toolbar {
  display: none;
}
#draw-toolbar.visible {
  display: flex !important;
}
#btn_draw_mode[aria-pressed="true"] {
  border-color: rgba(56,189,248,.6) !important;
  background: rgba(56,189,248,.18) !important;
  box-shadow: 0 0 0 2px rgba(56,189,248,.2);
}
#btn-draw-pen[aria-pressed="true"],
#btn-draw-eraser[aria-pressed="true"] {
  border-color: rgba(99,102,241,.6) !important;
  background: rgba(99,102,241,.15) !important;
}
  `;
  document.head.appendChild(st);
}

// ── Firestore helpers ─────────────────────────────────────────────────────
function getDrawingsRef() {
  if (!_db || !_rid) return null;
  return doc(_db, "rooms", _rid, "public_state", "drawings");
}

async function saveStrokes() {
  _pendingSave = false;           // <-- move pra cima
  const ref = getDrawingsRef();
  if (!ref) return;
  try {
    await setDoc(ref, { strokes: _strokes.slice(-MAX_STROKES) }, { merge: false });
  } catch (e) {
    console.error("[drawing] saveStrokes error", e);
  }
}

async function appendStroke(stroke) {
  const ref = getDrawingsRef();
  if (!ref || !stroke) return;

  try {
    await runTransaction(_db, async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists() ? (snap.data() || {}) : {};
      const remote = Array.isArray(data.strokes) ? data.strokes : [];

      const merged = [...remote, stroke];
      tx.set(ref, { strokes: merged.slice(-MAX_STROKES) }, { merge: false });
    });
  } catch (e) {
    console.error("[drawing] appendStroke error", e);
  }
}

// ── Canvas setup ──────────────────────────────────────────────────────────
function ensureCanvas() {
  if (_drawCanvas) return;

  const wrap = document.getElementById("arena_wrap");
  if (!wrap) return;

  // Match size to arena canvas
  const arenaCanvas = document.getElementById("arena");
  const w = arenaCanvas ? arenaCanvas.width  : 1200;
  const h = arenaCanvas ? arenaCanvas.height : 800;

  _drawCanvas = document.createElement("canvas");
  _drawCanvas.id = "draw-canvas";
  _drawCanvas.width  = w;
  _drawCanvas.height = h;
  wrap.appendChild(_drawCanvas);

  _drawCtx = _drawCanvas.getContext("2d");

  // Observe arena canvas size changes so draw canvas stays in sync
  if (arenaCanvas) {
    const ro = new ResizeObserver(() => syncCanvasSize());
    ro.observe(arenaCanvas);
    ro.observe(wrap);
  }

  bindCanvasEvents();
}

function syncCanvasSize() {
  if (!_drawCanvas) return;
  const arenaCanvas = document.getElementById("arena");
  if (!arenaCanvas) return;
  const newW = arenaCanvas.width;
  const newH = arenaCanvas.height;
  if (_drawCanvas.width !== newW || _drawCanvas.height !== newH) {
    _drawCanvas.width  = newW;
    _drawCanvas.height = newH;
    redrawAll();
  }
}

// ── Coordinate helpers ────────────────────────────────────────────────────
function getCanvasPos(e) {
  if (!_drawCanvas) return { x: 0, y: 0 };
  const rect = _drawCanvas.getBoundingClientRect();
  const scaleX = _drawCanvas.width  / rect.width;
  const scaleY = _drawCanvas.height / rect.height;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top)  * scaleY,
  };
}


function getArenaView() {
  return window.__arenaView || null;
}

function screenToWorld(x, y) {
  const v = getArenaView();
  if (!v || !Number.isFinite(v.scale) || v.scale <= 0) return { u: x, v: y, ok: false };
  return { u: (x - v.offX) / v.scale, v: (y - v.offY) / v.scale, ok: true };
}

function worldToScreen(u, v_) {
  const v = getArenaView();
  if (!v || !Number.isFinite(v.scale) || v.scale <= 0) return { x: u, y: v_, ok: false };
  return { x: v.offX + u * v.scale, y: v.offY + v_ * v.scale, ok: true };
}

// ── Drawing logic ─────────────────────────────────────────────────────────
function redrawAll() {
  if (!_drawCtx || !_drawCanvas) return;
  _drawCtx.clearRect(0, 0, _drawCanvas.width, _drawCanvas.height);

  for (const stroke of _strokes) {
    drawStroke(_drawCtx, stroke);
  }

  if (_currentStroke) {
    drawStroke(_drawCtx, _currentStroke);
  }
}

function drawStroke(ctx, stroke) {
  const pts = stroke.points;
  if (!pts || pts.length < 4) return;

  const isWorld = stroke.space === "world";

  ctx.save();
  if (stroke.tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0,0,0,1)";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = stroke.color || "#ff4444";
  }
  ctx.lineWidth = stroke.width || 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();

  function getXY(i) {
    const a = pts[i], b = pts[i + 1];
    if (!isWorld) return { x: a, y: b }; // legado: screen pixels
    const s = worldToScreen(a, b);
    return { x: s.x, y: s.y };
  }

  const p0 = getXY(0);
  ctx.moveTo(p0.x, p0.y);

  for (let i = 2; i < pts.length; i += 2) {
    const p = getXY(i);
    ctx.lineTo(p.x, p.y);
  }

  ctx.stroke();
  ctx.restore();
}
// ── Event handlers ────────────────────────────────────────────────────────
function onPointerDown(e) {
  if (!_drawMode) return;
  e.preventDefault();
  e.stopPropagation();

  _isDrawing = true;
  const pos = getCanvasPos(e);
const w = screenToWorld(pos.x, pos.y);

_currentStroke = {
  id: _uid(),
  by: _by || "anon",
  color: _color,
  width: _lineWidth,
  tool: _tool,
  points: [w.u, w.v],
  space: "world",
};

redrawAll();

function onPointerMove(e) {
  if (!_isDrawing || !_currentStroke) return;
  e.preventDefault();
  e.stopPropagation();

  const pos = getCanvasPos(e);

  // se o stroke é "world", converte; senão, usa pixel (legado)
  if (_currentStroke.space === "world") {
    const w = screenToWorld(pos.x, pos.y);
    _currentStroke.points.push(w.u, w.v);
  } else {
    _currentStroke.points.push(pos.x, pos.y);
  }

  redrawAll();
}

function onPointerUp(e) {
  if (!_isDrawing || !_currentStroke) return;
  e.preventDefault();

  _isDrawing = false;

  if (_currentStroke.points.length >= 2) {
    const finishedStroke = _currentStroke;
    _strokes.push(finishedStroke);
    if (_strokes.length > MAX_STROKES) {
      _strokes = _strokes.slice(-MAX_STROKES);
    }

    // Use transaction-based append so one user never overwrites
    // another user's recent strokes.
    appendStroke(finishedStroke);
  }
  _currentStroke = null;
  redrawAll();
}

function bindCanvasEvents() {
  if (!_drawCanvas) return;

  // Mouse
  _drawCanvas.addEventListener("mousedown",  onPointerDown, { passive: false });
  _drawCanvas.addEventListener("mousemove",  onPointerMove, { passive: false });
  _drawCanvas.addEventListener("mouseup",    onPointerUp,   { passive: false });
  _drawCanvas.addEventListener("mouseleave", (e) => { if (_isDrawing) onPointerUp(e); });

  // Touch
  _drawCanvas.addEventListener("touchstart",  onPointerDown, { passive: false });
  _drawCanvas.addEventListener("touchmove",   onPointerMove, { passive: false });
  _drawCanvas.addEventListener("touchend",    onPointerUp,   { passive: false });
  _drawCanvas.addEventListener("touchcancel", (e) => { if (_isDrawing) onPointerUp(e); });
}

// ── Mode toggle ───────────────────────────────────────────────────────────
function setDrawMode(active) {
  _drawMode = active;
  ensureCanvas();

  const btn     = document.getElementById("btn_draw_mode");
  const toolbar = document.getElementById("draw-toolbar");

  if (btn)     btn.setAttribute("aria-pressed", String(active));
  if (toolbar) {
    toolbar.classList.toggle("visible", active);
    toolbar.style.display = active ? "flex" : "none";
  }

  if (_drawCanvas) {
    _drawCanvas.classList.toggle("draw-active", active);
    _drawCanvas.classList.toggle("eraser-mode", active && _tool === "eraser");
  }
}

function setTool(t) {
  _tool = t;
  const penBtn    = document.getElementById("btn-draw-pen");
  const eraserBtn = document.getElementById("btn-draw-eraser");
  if (penBtn)    penBtn.setAttribute("aria-pressed",    String(t === "pen"));
  if (eraserBtn) eraserBtn.setAttribute("aria-pressed", String(t === "eraser"));
  if (_drawCanvas) _drawCanvas.classList.toggle("eraser-mode", t === "eraser");
}

// ── UI event bindings ─────────────────────────────────────────────────────
function bindUI() {
  const modeBtn = document.getElementById("btn_draw_mode");
  if (modeBtn) {
    modeBtn.addEventListener("click", () => {
      setDrawMode(!_drawMode);
    });
  }

  const penBtn = document.getElementById("btn-draw-pen");
  if (penBtn) {
    penBtn.addEventListener("click", () => setTool("pen"));
  }

  const eraserBtn = document.getElementById("btn-draw-eraser");
  if (eraserBtn) {
    eraserBtn.addEventListener("click", () => setTool("eraser"));
  }

  const colorInput = document.getElementById("draw-color");
  if (colorInput) {
    colorInput.addEventListener("input", (e) => { _color = e.target.value; });
  }

  const sizeInput = document.getElementById("draw-size");
  const sizeLabel = document.getElementById("draw-size-label");
  if (sizeInput) {
    sizeInput.addEventListener("input", (e) => {
      _lineWidth = Number(e.target.value);
      if (sizeLabel) sizeLabel.textContent = _lineWidth;
    });
  }

  const undoBtn = document.getElementById("btn-draw-undo");
  if (undoBtn) {
    undoBtn.addEventListener("click", async () => {
      if (!_strokes.length) return;
      _strokes.pop();
      redrawAll();
      await saveStrokes();
    });
  }

  const clearBtn = document.getElementById("btn-draw-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      if (!_strokes.length) return;
      _strokes = [];
      redrawAll();
      await saveStrokes();
    });
  }
}

// ── Firestore listener ────────────────────────────────────────────────────
function startListening() {
  if (_unsub) { try { _unsub(); } catch {} _unsub = null; }

  const ref = getDrawingsRef();
  if (!ref) return;

  _unsub = onSnapshot(ref, (snap) => {
    const data = snap.exists() ? snap.data() : {};
    const remote = Array.isArray(data.strokes) ? data.strokes : [];

    // Only update if the remote strokes differ (avoid overwriting current stroke)
    // Simple check: compare ids
    const localIds  = new Set(_strokes.map(s => s.id));
    const remoteIds = new Set(remote.map(s => s.id));
    const differ = remote.some(s => !localIds.has(s.id)) || _strokes.some(s => !remoteIds.has(s.id));

    if (differ) {
      _strokes = remote;
      redrawAll();
    }
  }, (err) => {
    console.error("[drawing] snapshot error", err);
  });
}

// ── init ──────────────────────────────────────────────────────────────────
function initDrawing(db, rid, by) {
  _db  = db;
  _rid = rid;
  _by  = safeStr(by);

  ensureCanvas();
  startListening();
}

// ── Auto-init when appState connects ─────────────────────────────────────
bindUI();

let _watchInterval = setInterval(() => {
  const as = window.appState;
  if (!as?.connected || !as?.rid || !as?.by) return;
  const db = window.currentDb || window._combatDb;
  if (!db) return;

  clearInterval(_watchInterval);
  _watchInterval = null;

  initDrawing(db, as.rid, as.by);
}, 500);

console.log("%c[drawing] drawing-patch.js carregado ✅", "color:#34d399;font-weight:bold");
