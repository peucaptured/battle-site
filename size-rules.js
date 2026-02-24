/**
 * size-rules.js — Regras de tamanho, ocupação e stacking para a arena.
 *
 * Módulo ES puro: sem DOM, sem Firestore, sem side-effects.
 * Importado diretamente por main.js e scoreboard-patch.js.
 */

// ── Constantes ────────────────────────────────────────────────────
export const SIZE_CATEGORIES = Object.freeze({
  tiny:   "tiny",
  medium: "medium",
  large:  "large",
  huge:   "huge",
});

// height em decímetros (campo "height" da PokeAPI)
const HEIGHT_THRESHOLDS = { tiny: 8, medium: 20, large: 40 };

// ── getSizeCategory ───────────────────────────────────────────────
/** Converte height (decímetros da PokeAPI) → categoria de tamanho. */
export function getSizeCategory(heightDm) {
  const h = Number(heightDm);
  if (!Number.isFinite(h) || h <= 0) return SIZE_CATEGORIES.medium;
  if (h < HEIGHT_THRESHOLDS.tiny)   return SIZE_CATEGORIES.tiny;
  if (h < HEIGHT_THRESHOLDS.medium) return SIZE_CATEGORIES.medium;
  if (h < HEIGHT_THRESHOLDS.large)  return SIZE_CATEGORIES.large;
  return SIZE_CATEGORIES.huge;
}

// ── getSizeDimensions ─────────────────────────────────────────────
/**
 * Retorna dimensões do footprint e layer de renderização.
 * @returns {{ tileW: number, tileH: number, zIndex: number }}
 */
export function getSizeDimensions(sizeCategory) {
  switch (sizeCategory) {
    case SIZE_CATEGORIES.tiny:   return { tileW: 1, tileH: 1, zIndex: 4 };
    case SIZE_CATEGORIES.large:  return { tileW: 2, tileH: 2, zIndex: 2 };
    case SIZE_CATEGORIES.huge:   return { tileW: 3, tileH: 3, zIndex: 1 };
    case SIZE_CATEGORIES.medium:
    default:                     return { tileW: 1, tileH: 1, zIndex: 3 };
  }
}

// ── getPieceFootprint ─────────────────────────────────────────────
/**
 * Retorna todos os tiles ocupados por um piece (baseado em anchor + size).
 * @param {{ row: number, col: number, sizeCategory?: string }} piece
 * @returns {Array<{ row: number, col: number }>}
 */
export function getPieceFootprint(piece) {
  const row = Number(piece?.row);
  const col = Number(piece?.col);
  if (!Number.isFinite(row) || !Number.isFinite(col)) return [];
  const { tileW, tileH } = getSizeDimensions(piece?.sizeCategory || SIZE_CATEGORIES.medium);
  const cells = [];
  for (let dr = 0; dr < tileH; dr++) {
    for (let dc = 0; dc < tileW; dc++) {
      cells.push({ row: row + dr, col: col + dc });
    }
  }
  return cells;
}

// ── getPiecesOccupyingTile ────────────────────────────────────────
/**
 * Retorna todos os pieces ativos cujo footprint inclui (row, col).
 * @param {number} row
 * @param {number} col
 * @param {Array} pieces
 * @returns {Array}
 */
export function getPiecesOccupyingTile(row, col, pieces) {
  return (pieces || []).filter(p => {
    if (String(p?.status || "active") !== "active") return false;
    const footprint = getPieceFootprint(p);
    return footprint.some(c => c.row === row && c.col === col);
  });
}

// ── canPieceLandOn (regra central de stacking) ────────────────────
/**
 * Verifica se `movingPiece` pode pousar em (targetRow, targetCol).
 * Checa TODOS os tiles do footprint do destino.
 * @returns {{ allowed: boolean, reason: string }}
 */
export function canPieceLandOn(movingPiece, targetRow, targetCol, allPieces) {
  const movingSize = movingPiece?.sizeCategory || SIZE_CATEGORIES.medium;
  const { tileW, tileH } = getSizeDimensions(movingSize);
  const movingId = String(movingPiece?.id || "");

  // Filtra pieces ativos excluindo o próprio moving piece
  const others = (allPieces || []).filter(p =>
    String(p?.status || "active") === "active" &&
    String(p?.id || "") !== movingId
  );

  for (let dr = 0; dr < tileH; dr++) {
    for (let dc = 0; dc < tileW; dc++) {
      const tr = targetRow + dr;
      const tc = targetCol + dc;
      const residents = getPiecesOccupyingTile(tr, tc, others);
      const check = _checkTileAcceptsSize(movingSize, residents);
      if (!check.allowed) return check;
    }
  }
  return { allowed: true, reason: "" };
}

// ── _checkTileAcceptsSize (interno) ───────────────────────────────
function _checkTileAcceptsSize(incomingSize, residents) {
  if (residents.length === 0) return { allowed: true, reason: "" };

  const nonTiny = residents.filter(p =>
    (p?.sizeCategory || SIZE_CATEGORIES.medium) !== SIZE_CATEGORIES.tiny
  );
  const tinyCount = residents.length - nonTiny.length;

  switch (incomingSize) {
    case SIZE_CATEGORIES.tiny: {
      // Tiny pode compartilhar com até 3 outros Tiny (max 4)
      // Tiny pode entrar em tile com 1 Medium (max 1 Tiny junto com Medium)
      // Tiny pode entrar em tiles de Large/Huge
      if (nonTiny.length === 0) {
        // Só tinies no tile
        return tinyCount >= 4
          ? { allowed: false, reason: "tile cheio (máximo 4 tiny)" }
          : { allowed: true, reason: "" };
      }
      // Tem non-tiny no tile
      const nonTinySize = nonTiny[0]?.sizeCategory || SIZE_CATEGORIES.medium;
      if (nonTinySize === SIZE_CATEGORIES.medium) {
        // Medium + Tiny: max 1 Tiny junto com Medium
        return tinyCount >= 1
          ? { allowed: false, reason: "tile com medium já tem 1 tiny" }
          : { allowed: true, reason: "" };
      }
      // Large ou Huge: Tiny pode entrar livremente (respeitando cap de 4 Tiny por tile)
      return tinyCount >= 4
        ? { allowed: false, reason: "tile cheio (máximo 4 tiny)" }
        : { allowed: true, reason: "" };
    }

    case SIZE_CATEGORIES.medium: {
      // Medium precisa: tile vazio ou no máximo 1 Tiny, sem outro non-tiny
      if (nonTiny.length > 0) {
        return { allowed: false, reason: "tile ocupado por unidade medium ou maior" };
      }
      return tinyCount > 1
        ? { allowed: false, reason: "tile tem muitos tiny para medium entrar" }
        : { allowed: true, reason: "" };
    }

    case SIZE_CATEGORIES.large:
    case SIZE_CATEGORIES.huge: {
      // Large/Huge: bloqueia Medium+. Só Tiny pode compartilhar
      if (nonTiny.length > 0) {
        return { allowed: false, reason: "tile ocupado por unidade medium ou maior" };
      }
      // Tinies podem ficar — sem restrição extra
      return { allowed: true, reason: "" };
    }
  }
  return { allowed: false, reason: "tamanho desconhecido" };
}

// ── isTileFullyBlocked ────────────────────────────────────────────
/**
 * Retorna true se NENHUMA unidade de qualquer tamanho pode entrar neste tile.
 * Substituto conservador do antigo isTileOccupied para callers legados.
 */
export function isTileFullyBlocked(row, col, pieces) {
  const residents = getPiecesOccupyingTile(row, col, pieces);
  if (residents.length === 0) return false;

  // Se nem Tiny pode entrar, está fully blocked
  const check = _checkTileAcceptsSize(SIZE_CATEGORIES.tiny, residents);
  return !check.allowed;
}

// ── getTinySlotPosition ───────────────────────────────────────────
/**
 * Posição de sub-tile (quadrante) para Tiny empilhados.
 * Slot 0=top-left, 1=top-right, 2=bottom-left, 3=bottom-right.
 * @returns {{ offsetXRatio: number, offsetYRatio: number, sizeRatio: number }}
 */
export function getTinySlotPosition(slotIndex) {
  const positions = [
    { offsetXRatio: 0.03, offsetYRatio: 0.03 },
    { offsetXRatio: 0.50, offsetYRatio: 0.03 },
    { offsetXRatio: 0.03, offsetYRatio: 0.50 },
    { offsetXRatio: 0.50, offsetYRatio: 0.50 },
  ];
  return { ...(positions[slotIndex % 4] || positions[0]), sizeRatio: 0.44 };
}

// ── isFootprintWithinGrid ─────────────────────────────────────────
/**
 * Verifica se o footprint inteiro de uma peça com `sizeCategory` cabe no grid.
 */
export function isFootprintWithinGrid(row, col, sizeCategory, gridSize) {
  const { tileW, tileH } = getSizeDimensions(sizeCategory);
  const gs = Number(gridSize) || 0;
  return (
    Number.isFinite(row) && Number.isFinite(col) &&
    row >= 0 && col >= 0 &&
    row + tileH <= gs &&
    col + tileW <= gs
  );
}
