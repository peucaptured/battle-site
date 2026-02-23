"""
BiomeGenerator v2 – Rewritten for BiomesCollection + Topdown RPG 32×32 assets.

Preserves proven math logic: value_noise, _blur2d, _mask4, _place_sprites,
occupancy grid, arena generation, distance fields.

New asset loading:
  - BiomesCollection/{biome}.png + {biome}_guide.png  → terrain autotiles
  - Topdown RPG 32x32 sprite sheets                   → universal decoration
  - Biome-embedded sprites (right side of tileset)     → biome-specific decoration

Dependencies: pillow, numpy
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple, Optional, Callable
from collections import deque
import random
import math
import json

import numpy as np
from PIL import Image, ImageFilter


# ════════════════════════════════════════════════════════════════
# Module 1 — Math Utilities (preserved verbatim from old code)
# ════════════════════════════════════════════════════════════════

def _blur2d(a: np.ndarray, iters: int = 2) -> np.ndarray:
    """Fast-ish blur using 3×3 neighbor averaging."""
    a = a.astype(np.float32)
    for _ in range(iters):
        acc = (
            a
            + np.roll(a, 1, 0) + np.roll(a, -1, 0)
            + np.roll(a, 1, 1) + np.roll(a, -1, 1)
            + np.roll(np.roll(a, 1, 0), 1, 1) + np.roll(np.roll(a, 1, 0), -1, 1)
            + np.roll(np.roll(a, -1, 0), 1, 1) + np.roll(np.roll(a, -1, 0), -1, 1)
        )
        a = acc / 9.0
    return a


def value_noise(h: int, w: int, rng: random.Random,
                scale: int = 8, blur: int = 2) -> np.ndarray:
    """Creates smooth value noise in [0, 1]."""
    gh = max(2, h // scale)
    gw = max(2, w // scale)
    grid = np.array([[rng.random() for _ in range(gw)] for _ in range(gh)],
                    dtype=np.float32)
    up = np.kron(grid, np.ones((math.ceil(h / gh), math.ceil(w / gw)),
                               dtype=np.float32))
    up = up[:h, :w]
    up = _blur2d(up, iters=blur)
    mn, mx = float(up.min()), float(up.max())
    if mx - mn < 1e-6:
        return np.zeros((h, w), dtype=np.float32)
    return (up - mn) / (mx - mn)


def safe_randint(rng: random.Random, a: int, b: int) -> int:
    a, b = int(a), int(b)
    if b < a:
        return a
    return rng.randint(a, b)


# ════════════════════════════════════════════════════════════════
# Module 2 — Asset Loading
# ════════════════════════════════════════════════════════════════

TILE_SIZE = 32  # Base tile size of BiomesCollection assets

# ── Thematic exclusion zones per biome tileset ──
# Each entry is a list of tile-coordinate rectangles (col0, row0, col1, row1)
# (exclusive end) that zero-out man-made / non-natural sprites before extraction.
_BIOME_EXCLUSION_TILES: Dict[str, List[Tuple[int, int, int, int]]] = {
    "grasslands": [
        (13, 0, 15, 2),      # wooden house with brown roof
    ],
    "desert": [
        (9, 0, 23, 6),       # Egyptian structures: coins, sphinx, sarcophagus, tablets
        (8, 2, 9, 6),        # temple entrance extends left below cactus
        (0, 6, 23, 14),      # lower terrain layers (edge fragments leak as decor)
    ],
    "beach": [
        (11, 0, 14, 2),      # tiki tent / cabana with green leaf roof
        (13, 2, 18, 5),      # crates, barrel, wooden fence, stone blocks (rows 2-4)
        (0, 5, 18, 10),      # water terrain area (edge tiles leak as decor)
    ],
    "deepforest": [
        (8, 0, 10, 2),       # lantern and street lamp post
    ],
    "snowlands": [
        (5, 0, 8, 3),        # tombstones / graves
        (0, 4, 13, 8),       # entire ice terrain area (edge fragments leak as decor)
    ],
    "temple": [
        (4, 0, 9, 4),        # large temple building (gray walls, red roof)
    ],
    "cave": [
        (12, 0, 14, 2),      # wooden signs / posts
        (7, 3, 14, 7),       # crystal pillar lanterns, rune tablet, gargoyle, runic circle
        (0, 5, 7, 7),        # bottom terrain edge fragments
    ],
    # Seafloor: exclude the terrain rows (rows 0-3) entirely.
    # The light-blue circular tiles and dark-teal tiles fill rows 0-3.
    # Extra columns beyond the detected 3×3 block contain frame / hollow-square
    # tile variants that aren't registered as terrain and leak as white-circle
    # artifacts during sprite extraction.  Decorations (coral, kelp, seaweed,
    # stone arches, etc.) live in rows 4+ and are not affected.
    # Seafloor terrain cells cover rows 0-4 (cols 0-7); rows 5+ are decorations.
    # Also zero cols 8-13 in row 4 (non-terrain content that bleeds into blobs).
    # In the decoration area:
    #   - Treasure chests: r8c1 (lid) + r9c0-c1 (bodies) — not appropriate underwater
    #   - Ship (r8-r9, c10-c13): extracted separately as a whole setpiece; excluded
    #     here so the tile-grid pass doesn't chop it into individual fragments.
    "seafloor": [
        (0, 0, 14, 5),   # rows 0-4: terrain tiles + stray non-terrain row-4 content
        (1, 8, 2, 9),    # chest lid   (r8 c1)
        (0, 9, 2, 10),   # chest bodies (r9 c0-c1)
        (10, 8, 14, 10), # ship hull (r8-r9 c10-c13) — kept whole as setpiece
    ],
}

# Per-biome dilation size override.  Default = 3.
# Larger values bridge wider gaps between sprite fragments (e.g. thin
# mushroom stems in deepforest).
_BIOME_DILATION_SIZE: Dict[str, int] = {
    "deepforest": 7,         # pink mushroom stems need wide bridging
    "seafloor":   1,         # sprites are close together on sheet; default 3 fuses them all
}


@dataclass
class DecorSprite:
    """A single decoration sprite ready for placement."""
    image: Image.Image
    tiles_w: int
    tiles_h: int
    size_class: str  # "micro", "medium", "setpiece"


# ────── Connected-component extraction helpers ──────

def _dilate_mask(mask: np.ndarray, size: int = 3) -> np.ndarray:
    """Dilate a boolean mask using MaxFilter to bridge small transparent gaps
    inside a single sprite (e.g. leaves separated from trunk in pixel art).
    size=3 bridges 1px gaps without fusing adjacent sprites on a sheet."""
    pil = Image.fromarray((mask * 255).astype(np.uint8), mode='L')
    dilated = pil.filter(ImageFilter.MaxFilter(size=size))
    return np.array(dilated) > 127


def _label_components(mask: np.ndarray) -> Tuple[np.ndarray, int]:
    """Simple connected-component labeling via BFS (4-connected).
    Returns (label_array, num_labels).  Label 0 = background."""
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    current = 0
    for y in range(h):
        for x in range(w):
            if mask[y, x] and labels[y, x] == 0:
                current += 1
                q = deque([(y, x)])
                labels[y, x] = current
                while q:
                    cy, cx = q.popleft()
                    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and labels[ny, nx] == 0:
                            labels[ny, nx] = current
                            q.append((ny, nx))
    return labels, current


def _sprites_from_labels(img: Image.Image, labels: np.ndarray,
                         num_labels: int,
                         min_px: int = 8, max_px: int = 2000) -> List[DecorSprite]:
    """Extract bounding-box crops from a label map and auto-classify by size.

    Size classes:
      micro    – single tile (1×1)
      medium   – multi-tile but area < 9  (e.g. 2×2, 2×3)
      setpiece – area ≥ 9 tiles (e.g. 3×3, 3×4, large portals)

    Rejects sprites whose aspect ratio exceeds 2.5 (indicates accidental
    fusion of an entire row/column of adjacent sprites).
    """
    sprites: List[DecorSprite] = []
    for lbl in range(1, num_labels + 1):
        ys, xs = np.where(labels == lbl)
        if len(ys) == 0:
            continue
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        bw, bh = x1 - x0, y1 - y0
        if bw < min_px or bh < min_px:
            continue
        if bw > max_px or bh > max_px:
            continue

        # Reject overly elongated blobs (likely fused row/column)
        aspect = max(bw, bh) / max(1, min(bw, bh))
        if aspect > 2.0:
            continue

        crop = img.crop((x0, y0, x1, y1)).copy()
        tw = max(1, math.ceil(bw / TILE_SIZE))
        th = max(1, math.ceil(bh / TILE_SIZE))

        # Reject oversized blobs (likely several adjacent sprites fused by dilation)
        if tw > 3 or th > 3:
            continue

        # Reject sprites that are mostly transparent (bounding box >> actual pixels).
        # These produce ugly hollow-outline or single-pixel artifacts on the map.
        crop_arr = np.array(crop)
        opaque_px = int((crop_arr[:, :, 3] > 40).sum())
        fill_ratio = opaque_px / max(1, bw * bh)
        if fill_ratio < 0.25:
            continue

        # Reject ring/frame-shaped sprites (hollow interior = terrain tile fragment).
        # For sprites >= 1 tile: if the central quarter area is nearly empty while
        # the bounding box has decent coverage, it's a hollow frame artifact.
        if bw >= TILE_SIZE and bh >= TILE_SIZE:
            cy0, cy1 = bh // 4, (bh * 3) // 4
            cx0, cx1 = bw // 4, (bw * 3) // 4
            if cy1 > cy0 and cx1 > cx0:
                center_op = int((crop_arr[cy0:cy1, cx0:cx1, 3] > 40).sum())
                center_fill = center_op / max(1, (cy1 - cy0) * (cx1 - cx0))
                if center_fill < 0.15:
                    continue  # hollow ring — likely an autotile edge fragment

        # Reject fully tile-aligned solid sprites (terrain tiles extracted by mistake).
        # Decorations never perfectly fill an exact N×M tile bounding box at 95%+.
        is_tile_aligned = (bw == tw * TILE_SIZE) and (bh == th * TILE_SIZE)
        if is_tile_aligned and fill_ratio > 0.95:
            continue

        # Reject nearly-solid sprites with very low color variance.
        # Legitimate decoration sprites (flowers, lily pads, etc.) have varied
        # colors; flat-fill terrain tiles are nearly uniform.
        if fill_ratio > 0.90:
            opaque_px_arr = crop_arr[crop_arr[:, :, 3] > 40][:, :3].astype(float)
            if len(opaque_px_arr) > 64:
                color_std = float(opaque_px_arr.std(axis=0).mean())
                if color_std < 32.0:
                    continue  # solid-color terrain tile extracted by mistake

        # Auto-classify by tile area
        area = tw * th
        if tw <= 1 and th <= 1:
            cls = "micro"
        elif area >= 9:
            cls = "setpiece"
        else:
            cls = "medium"

        sprites.append(DecorSprite(image=crop, tiles_w=tw, tiles_h=th,
                                   size_class=cls))
    return sprites


def extract_sprites_from_sheet(sheet_path: Path) -> List[DecorSprite]:
    """Extract individual sprites from a Topdown RPG 32×32 sprite sheet.
    Uses alpha dilation (MaxFilter) to merge fragments of the same sprite
    before connected-component labeling.
    Dilation=1 bridges within-sprite 1px gaps without fusing adjacent sprites."""
    if not sheet_path.exists():
        return []
    img = Image.open(sheet_path).convert("RGBA")
    alpha = np.array(img)[:, :, 3]
    raw_mask = alpha > 40
    dilated = _dilate_mask(raw_mask, size=1)
    labels, num = _label_components(dilated)
    return _sprites_from_labels(img, labels, num, min_px=6, max_px=2000)


def _extract_water_flora(sheet_path: Path) -> List[DecorSprite]:
    """Extract water flora from WaterTileset, cropping to the rightmost third.
    Cols 0-5 are green terrain, cols 6-7 have mixed green edges.
    Only cols 8+ (x >= 256) contain clean water flora sprites."""
    if not sheet_path.exists():
        return []
    img = Image.open(sheet_path).convert("RGBA")
    # Crop starting at col 8 (x=256) — skips all green terrain
    crop_x = min(8 * TILE_SIZE, img.width)
    img = img.crop((crop_x, 0, img.width, img.height))
    alpha = np.array(img)[:, :, 3]
    raw_mask = alpha > 40
    dilated = _dilate_mask(raw_mask, size=1)
    labels, num = _label_components(dilated)
    # Use higher min_px to exclude stray terrain-edge fragments that bleed in
    return _sprites_from_labels(img, labels, num, min_px=20, max_px=2000)


# ────── Autotile loading via positional 3×3 block detection ──────

# Standard bitmask mapping for a 3×3 autotile block.
# Position (dr, dc) relative to block top-left → bitmask value.
# Convention: N=1 E=2 S=4 W=8 (bit set = that neighbor is "different").
_BLOCK_3X3: Dict[Tuple[int, int], int] = {
    (0, 0): 9,   (0, 1): 1,   (0, 2): 3,
    (1, 0): 8,   (1, 1): 0,   (1, 2): 2,
    (2, 0): 12,  (2, 1): 4,   (2, 2): 6,
}

# Extended tiles that may sit at (row_offset, col_offset) relative to
# the 3×3 block's top-left, providing extra mask coverage.
_BLOCK_EXT: Dict[Tuple[int, int], int] = {
    (0, 3): 11,  # N+E+W  (dead-end S)
    (1, 3): 10,  # E+W    (vertical strip)
    (0, 4): 5,   # N+S    (horizontal strip)
    (1, 4): 15,  # all    (island)
    (2, 3): 14,  # S+E+W  (dead-end N)
    (2, 4): 13,  # N+S+W  (dead-end E)
}


def _cell_alpha(ts_arr: np.ndarray, r: int, c: int,
                ts: int = TILE_SIZE) -> float:
    cell = ts_arr[r * ts:(r + 1) * ts, c * ts:(c + 1) * ts]
    return float(cell[:, :, 3].mean())


def _check_3x3(ts_arr: np.ndarray, sr: int, sc: int,
               th: int, tw: int) -> bool:
    """Return True if (sr, sc)-(sr+2, sc+2) form a valid 3×3 autotile block."""
    if sr + 2 >= th or sc + 2 >= tw:
        return False
    if _cell_alpha(ts_arr, sr + 1, sc + 1) < 200:  # center must be solid
        return False
    for dr in range(3):
        for dc in range(3):
            if dr == 1 and dc == 1:
                continue  # center already verified above
            # Edge/corner tiles can be partially transparent (transition tiles)
            if _cell_alpha(ts_arr, sr + dr, sc + dc) < 20:
                return False
    return True


def _detect_3x3_blocks(ts_arr: np.ndarray) -> List[Tuple[int, int]]:
    """Find top-left (row, col) of 3×3 autotile blocks in the tileset.

    BiomesCollection tilesets stack different terrain layers VERTICALLY
    at the same starting column.  We find the anchor column (first col
    that works), then scan downward for all valid 3×3 blocks at that
    column.  This avoids false positives from inner-corner / extension
    tiles sitting to the right of the main block.
    """
    th = ts_arr.shape[0] // TILE_SIZE
    tw = ts_arr.shape[1] // TILE_SIZE

    # Try anchor columns 0, 1, 2 — use the first that yields any blocks.
    for anchor_col in range(min(3, tw - 2)):
        used_rows: set = set()
        blocks: List[Tuple[int, int]] = []
        for sr in range(th - 2):
            if sr in used_rows:
                continue
            if _check_3x3(ts_arr, sr, anchor_col, th, tw):
                blocks.append((sr, anchor_col))
                used_rows.update(range(sr, sr + 3))
        if blocks:
            return blocks
    return []


def _classify_guide_cells(guide_arr: np.ndarray, tile_sz: int = TILE_SIZE
                          ) -> Tuple[List[Tuple[int, int]], List[Tuple[int, int]]]:
    """Scan a guide image array and return (green_cells, purple_cells) as (row,col).
    Used only for terrain-vs-decoration cell identification."""
    gh = guide_arr.shape[0] // tile_sz
    gw = guide_arr.shape[1] // tile_sz
    greens: List[Tuple[int, int]] = []
    purples: List[Tuple[int, int]] = []

    for r in range(gh):
        for c in range(gw):
            cell = guide_arr[r * tile_sz:(r + 1) * tile_sz,
                             c * tile_sz:(c + 1) * tile_sz]
            a = cell[:, :, 3]
            bright = a > 30
            if bright.sum() < 40:
                continue
            rgb = cell[bright][:, :3].astype(np.float32)
            avg = rgb.mean(axis=0)

            if avg[1] > 70 and avg[1] > avg[0] * 1.3 and avg[1] > avg[2] * 1.2:
                greens.append((r, c))
            elif max(avg[0], avg[1], avg[2]) > 45:
                purples.append((r, c))
    return greens, purples


class AutotileSet:
    """Loads one biome's tileset and provides mask → tile lookup.

    Detection strategy:
      1. Scan the tileset for 3×3 blocks of fully-opaque tiles (the standard
         autotile layout used by BiomesCollection).
      2. Map each block using _BLOCK_3X3 positional mapping.
      3. Each detected block becomes one terrain layer.
      4. The guide image is still loaded to separate terrain cells from
         decoration cells for sprite extraction.
    """

    def __init__(self, biome_name: str, biomes_dir: Path):
        guide_path = biomes_dir / f"{biome_name}_guide.png"
        tileset_path = biomes_dir / f"{biome_name}.png"

        if not tileset_path.exists():
            self.layers: List[Dict[int, List[Image.Image]]] = [
                {0: [Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (60, 60, 60, 255))]}
            ]
            self.tileset_img = Image.new("RGBA", (TILE_SIZE, TILE_SIZE))
            self._terrain_cells: set = set()
            return

        self.tileset_img = Image.open(tileset_path).convert("RGBA")
        ts_arr = np.array(self.tileset_img)
        th = ts_arr.shape[0] // TILE_SIZE
        tw = ts_arr.shape[1] // TILE_SIZE

        # ── Detect autotile blocks from the tileset itself ──
        blocks = _detect_3x3_blocks(ts_arr)
        self.layers = []
        self._terrain_cells: set = set()

        for (br, bc) in blocks:
            mask_tiles: Dict[int, List[Image.Image]] = {}

            # Map the core 3×3
            for (dr, dc), mask_val in _BLOCK_3X3.items():
                r, c = br + dr, bc + dc
                tile = self._crop((r, c))
                mask_tiles.setdefault(mask_val, []).append(tile)
                self._terrain_cells.add((r, c))

            # Try extended tiles (cols 3-4 relative to block)
            for (dr, dc), mask_val in _BLOCK_EXT.items():
                r, c = br + dr, bc + dc
                if r < th and c < tw and _cell_alpha(ts_arr, r, c) >= 50:
                    tile = self._crop((r, c))
                    mask_tiles.setdefault(mask_val, []).append(tile)
                    self._terrain_cells.add((r, c))

            self.layers.append(mask_tiles)

        # ── Also load the guide for decoration extraction ──
        if guide_path.exists():
            guide_img = Image.open(guide_path).convert("RGBA")
            guide_arr = np.array(guide_img)
            greens, purples = _classify_guide_cells(guide_arr)
            self._terrain_cells |= set(greens) | set(purples)

        if not self.layers:
            self.layers = [
                {0: [Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (60, 60, 60, 255))]}
            ]

    def _crop(self, rc: Tuple[int, int]) -> Image.Image:
        r, c = rc
        return self.tileset_img.crop(
            (c * TILE_SIZE, r * TILE_SIZE,
             (c + 1) * TILE_SIZE, (r + 1) * TILE_SIZE)
        ).copy()

    def get_tile(self, layer: int, mask: int, rng: random.Random) -> Image.Image:
        """Get a random tile variant for (layer, bitmask). Falls back gracefully."""
        if layer >= len(self.layers):
            layer = 0
        d = self.layers[layer]
        if mask in d:
            return rng.choice(d[mask])
        # Fallback: tile with fewest differing bits
        for fb in sorted(d.keys(), key=lambda k: bin(k ^ mask).count('1')):
            if fb != mask:
                return rng.choice(d[fb])
        return rng.choice(d.get(0, list(d.values())[0]))

    def wall_color(self, layer: int = 0) -> Tuple[int, int, int, int]:
        """Sample a representative wall/background color from corner of an edge tile."""
        d = self.layers[min(layer, len(self.layers) - 1)]
        for try_mask in (9, 3, 12, 6, 1, 2, 4, 8):
            if try_mask in d:
                tile = d[try_mask][0]
                arr = np.array(tile)
                corner = arr[:4, :4, :4]
                avg = corner.mean(axis=(0, 1)).astype(int)
                return tuple(avg)
        return (40, 30, 50, 255)


def extract_biome_decor(autotile: AutotileSet,
                        biome_name: str = "") -> List[DecorSprite]:
    """Extract decoration sprites from the non-terrain area of a biome tileset.
    Uses alpha dilation to merge fragments, then re-excludes terrain area.
    Applies thematic exclusion zones to remove man-made assets per biome."""
    img = autotile.tileset_img
    ts_arr = np.array(img).copy()          # mutable copy for exclusion
    h, w = ts_arr.shape[:2]

    # ── Apply thematic exclusion zones (zero out RGBA) ──
    for (c0, r0, c1, r1) in _BIOME_EXCLUSION_TILES.get(biome_name, []):
        px0 = c0 * TILE_SIZE
        py0 = r0 * TILE_SIZE
        px1 = min(c1 * TILE_SIZE, w)
        py1 = min(r1 * TILE_SIZE, h)
        ts_arr[py0:py1, px0:px1, :] = 0

    # Rebuild image from filtered array
    img_filtered = Image.fromarray(ts_arr)

    # Build terrain cell mask
    terrain_mask = np.zeros((h, w), dtype=bool)
    for r, c in autotile._terrain_cells:
        y0 = r * TILE_SIZE
        x0 = c * TILE_SIZE
        y1 = min(y0 + TILE_SIZE, h)
        x1 = min(x0 + TILE_SIZE, w)
        terrain_mask[y0:y1, x0:x1] = True

    # Content = non-transparent pixels outside terrain cells
    alpha = ts_arr[:, :, 3]
    content = (alpha > 40) & (~terrain_mask)

    # Dilate to bridge small gaps, then re-exclude terrain area
    dil_size = _BIOME_DILATION_SIZE.get(biome_name, 3)
    dilated = _dilate_mask(content, size=dil_size)
    dilated = dilated & (~terrain_mask)

    labels, num = _label_components(dilated)
    return _sprites_from_labels(img_filtered, labels, num, min_px=8, max_px=2000)


def extract_grid_sprites(autotile: AutotileSet,
                         biome_name: str = "",
                         start_row: int = 0) -> List[DecorSprite]:
    """Extract individual 32×32 tile sprites from a densely-packed tileset.

    Used when decoration sprites in the tileset touch each other with zero
    transparent gaps, making connected-component extraction impossible.
    Each non-empty 32×32 cell in the decoration area is cropped and returned
    as a ``micro`` DecorSprite.

    Parameters
    ----------
    autotile   : already-loaded AutotileSet for the biome.
    biome_name : key for ``_BIOME_EXCLUSION_TILES`` lookup.
    start_row  : first tile row (inclusive) to scan for decorations.
                 Rows 0..(start_row-1) are skipped (terrain area).
    """
    img = autotile.tileset_img
    ts_arr = np.array(img).copy()
    h, w = ts_arr.shape[:2]

    # Apply exclusion zones so human-made tile cells are silenced
    for (c0, r0, c1, r1) in _BIOME_EXCLUSION_TILES.get(biome_name, []):
        ts_arr[r0 * TILE_SIZE: min(r1 * TILE_SIZE, h),
               c0 * TILE_SIZE: min(c1 * TILE_SIZE, w), :] = 0

    num_cols = w // TILE_SIZE
    num_rows = h // TILE_SIZE
    sprites: List[DecorSprite] = []

    for r in range(start_row, num_rows):
        for c in range(num_cols):
            if (r, c) in autotile._terrain_cells:
                continue   # terrain cell — skip

            y0, x0 = r * TILE_SIZE, c * TILE_SIZE
            y1, x1 = y0 + TILE_SIZE, x0 + TILE_SIZE
            cell_arr = ts_arr[y0:y1, x0:x1]

            opaque_px = int((cell_arr[:, :, 3] > 40).sum())
            if opaque_px < 64:          # nearly empty tile → skip
                continue

            fill_ratio = opaque_px / (TILE_SIZE * TILE_SIZE)
            if fill_ratio < 0.20:       # too sparse — likely edge fragment or debris
                continue

            # Reject solid-color terrain tiles that leaked past terrain_cells
            if fill_ratio > 0.90:
                rgb = cell_arr[cell_arr[:, :, 3] > 40][:, :3].astype(float)
                if len(rgb) > 64 and float(rgb.std(axis=0).mean()) < 32.0:
                    continue   # flat-fill terrain tile

            crop = img.crop((x0, y0, x1, y1)).copy()
            sprites.append(DecorSprite(image=crop,
                                       tiles_w=1, tiles_h=1,
                                       size_class="micro"))

    return sprites


# ════════════════════════════════════════════════════════════════
# Module 3 — Biome Configurations
# ════════════════════════════════════════════════════════════════

# Decor rule: (sprite_key, density, attempts)
# sprite_key: "biome" for biome-specific, or "trees", "bushes", "rocks",
#             "mushrooms", "stumps", "nature", "ruins"
# Sprites are auto-classified into micro/medium/setpiece during extraction.
# Scatter (micro+medium) fills up to density; 1 set-piece per rule max.

BIOME_CONFIG: Dict[str, dict] = {
    # Dense natural forest — most of the map is trees and undergrowth.
    "grasslands": {
        "tileset": "grasslands",
        "mode": "open",
        "noise_scale": 8,
        "noise_blur": 2,
        "threshold": 0.65,   # more primary terrain → bigger contiguous clearings for trees
        "decor": [
            ("trees",  0.35, 9000),   # very dense canopy
            ("bushes", 0.18, 6000),
            ("stumps", 0.04, 2000),   # forest floor debris
            ("rocks",  0.03, 2000),
            ("nature", 0.12, 5000),   # ferns, vines, small flora
            ("biome",  0.05, 3000),
        ],
    },
    "deepforest": {
        "tileset": "deepforest",
        "mode": "open",
        "noise_scale": 9,
        "noise_blur": 3,
        "threshold": 0.65,
        "decor": [
            ("trees",  0.30, 9000),
            ("bushes", 0.12, 5000),
            ("biome",  0.08, 4000),
            ("stumps", 0.05, 2500),
            ("nature", 0.08, 4000),
            ("rocks",  0.02, 1000),
        ],
    },
    "desert": {
        "tileset": "desert",
        "mode": "open",
        "noise_scale": 9,
        "noise_blur": 3,
        "threshold": 0.70,
        "decor": [
            ("biome",   0.08, 4000),   # cacti, dry bones, desert flora from tileset
            ("rocks",   0.05, 2500),
            ("stumps",  0.03, 1500),   # dead logs / sun-bleached wood
            ("nature",  0.03, 1500),
        ],
    },
    # Tropical beach — natural vegetation, driftwood, rocks; no man-made objects.
    # Tileset "grasslands" is used as the terrain base (beach tileset has ocean
    # as layer-0 which breaks standard rendering).  The actual beach sand tiles
    # are composited separately via _beach_sand_at in generate().
    "beach": {
        "tileset": "grasslands",
        "mode": "beach",
        "decor": [
            ("trees",        0.06, 2500),   # palm-like trees on grass/sand
            ("rocks",        0.05, 2000),   # rocks scattered on shore
            ("stumps",       0.04, 1500),   # driftwood
            ("bushes",       0.03, 1500),
            ("nature",       0.04, 2000),   # small natural details
            ("water_flora",  0.04, 1500),   # aquatic plants
        ],
    },
    "snowlands": {
        "tileset": "snowlands",
        "mode": "open",
        "noise_scale": 9,
        "noise_blur": 3,
        "threshold": 0.50,
        "decor": [
            ("biome",   0.18, 8000),   # snow-covered trees, crystals, ice formations
            ("trees",   0.08, 4000),
            ("rocks",   0.04, 2000),
            ("stumps",  0.03, 1500),
            ("nature",  0.04, 2000),
        ],
    },
    "cave": {
        "tileset": "cave",
        "mode": "arena",
        "arena_margin": 1,
        "decor": [
            ("biome",  0.08, 2000),   # stalactites, crystals, cave flora
            ("rocks",  0.04, 1000),
            ("nature", 0.02, 500),
        ],
    },
    "mines": {
        "tileset": "mines",
        "mode": "arena",
        "arena_margin": 1,
        "decor": [
            ("biome",  0.06, 1500),
            ("rocks",  0.03, 800),
        ],
    },
    "temple": {
        "tileset": "temple",
        "mode": "open",
        "noise_scale": 10,
        "noise_blur": 3,
        "threshold": 0.50,
        "decor": [
            ("biome",   0.12, 6000),   # ancient stone features, vines, natural overgrowth
            ("nature",  0.06, 3000),
            ("trees",   0.06, 3000),
            ("rocks",   0.03, 1500),
            ("bushes",  0.04, 2000),
        ],
    },
    # Seafloor: rich underwater environment — coral, seaweed, kelp, stone arches, ships.
    "seafloor": {
        "tileset": "seafloor",
        "mode": "open",
        "noise_scale": 8,
        "noise_blur": 3,
        "threshold": 0.55,
        "decor": [
            ("biome",  0.22, 9000),   # coral, kelp, seaweed, arches, ships from tileset
            ("rocks",  0.03, 2000),   # scattered stones on the seafloor
            ("nature", 0.02, 1500),   # small underwater detail sprites
        ],
    },
    "interior": {
        "tileset": "interior",
        "mode": "arena",
        "arena_margin": 1,
        "decor": [
            ("biome",  0.015, 300),
        ],
    },
    # ── New water biomes ──
    "lake": {
        "tileset": "grasslands",
        "mode": "lake",
        "decor": [
            ("trees",       0.18, 5000),
            ("bushes",      0.10, 4000),
            ("nature",      0.08, 3500),
            ("rocks",       0.03, 2000),
            ("water_flora", 0.05, 2000),
            ("biome",       0.04, 2500),
        ],
    },
    "river": {
        "tileset": "grasslands",
        "mode": "river",
        "decor": [
            ("trees",       0.18, 5000),
            ("bushes",      0.10, 4000),
            ("nature",      0.08, 3500),
            ("rocks",       0.03, 2000),
            ("water_flora", 0.05, 2000),
            ("biome",       0.04, 2500),
        ],
    },
}


# ════════════════════════════════════════════════════════════════
# Module 4 — BiomeGenerator
# ════════════════════════════════════════════════════════════════

class BiomeGenerator:
    """Generate coherent biome maps as RGBA images."""

    def __init__(self, assets_root: str | Path | None = None):
        if assets_root is None:
            assets_root = Path(__file__).parent
        self.root = Path(assets_root)

        biomes_dir = self.root / "BiomesCollection" / "32x32 tile size"
        nature_dir = self.root / "Top-Down RPG 32x32 by Mixel v1.7" / "Nature v1.5"
        buildings_dir = self.root / "Top-Down RPG 32x32 by Mixel v1.7" / "Buildings v.1.1"

        # ── Load biome autotile sets ──
        self.autotiles: Dict[str, AutotileSet] = {}
        self.biome_decor: Dict[str, List[DecorSprite]] = {}

        for biome_name in ("grasslands", "deepforest", "desert", "beach",
                           "snowlands", "cave", "mines", "temple",
                           "seafloor", "interior"):
            ats = AutotileSet(biome_name, biomes_dir)
            self.autotiles[biome_name] = ats

            if biome_name == "seafloor":
                # Seafloor decoration sprites touch each other with zero transparent
                # gaps on the sheet — connected-component extraction would fuse them
                # into huge blobs.  Use tile-grid extraction instead: each non-empty
                # 32×32 cell in the decoration area (rows 5+) becomes a micro sprite.
                grid_sprites = extract_grid_sprites(ats, biome_name, start_row=5)

                # The ship (cols 10-13, rows 8-9 = 128×64 px) is excluded from the
                # tile-grid pass via _BIOME_EXCLUSION_TILES so it isn't chopped up.
                # Crop it from the ORIGINAL tileset image (before exclusion zones) and
                # add as a single setpiece so it appears intact exactly once per map.
                _ship_img = ats.tileset_img.crop((
                    10 * TILE_SIZE, 8 * TILE_SIZE,
                    14 * TILE_SIZE, 10 * TILE_SIZE,   # 128 × 64 px
                ))
                _ship_sprite = DecorSprite(
                    image=_ship_img, tiles_w=4, tiles_h=2, size_class="setpiece")
                self.biome_decor[biome_name] = grid_sprites + [_ship_sprite]
            else:
                self.biome_decor[biome_name] = extract_biome_decor(ats, biome_name)

        # ── Load universal sprite sheets ──
        self.universal: Dict[str, List[DecorSprite]] = {}
        sheet_map = {
            "trees":       nature_dir / "Topdown RPG 32x32 - Trees 1.2.PNG",
            "bushes":      nature_dir / "Topdown RPG 32x32 - Bushes 1.1.PNG",
            "rocks":       nature_dir / "Topdown RPG 32x32 - Rocks 1.2.PNG",
            "mushrooms":   nature_dir / "Topdown RPG 32x32 - Mushrooms.png",
            "stumps":      nature_dir / "Topdown RPG 32x32 - Tree Stumps and Logs 1.2.PNG",
            "nature":      nature_dir / "Topdown RPG 32x32 - Nature Details.png",
            "water_flora": nature_dir / "Topdown RPG 32x32 - WaterTileset.PNG",
            "ruins":       buildings_dir / "Topdown RPG 32x32 - Ruins.PNG",
        }
        for key, path in sheet_map.items():
            if key == "water_flora":
                self.universal[key] = _extract_water_flora(path)
            else:
                self.universal[key] = extract_sprites_from_sheet(path)

        # ── Load water tiles (collect top variants for per-cell variation) ──
        # Try calm-water first (gentler look), fallback to ocean.
        bg_color = (45, 110, 185, 255)   # vivid, saturated blue
        self.water_tiles: List[Image.Image] = []
        for water_file in ("calm-water-autotiles-anim.png", "ocean-autotiles-anim.png"):
            water_path = self.root / water_file
            if not water_path.exists():
                continue
            water_img = Image.open(water_path).convert("RGBA")
            ww, wh = water_img.size
            scored: List[Tuple[float, Image.Image]] = []
            for ty in range(0, wh - TILE_SIZE + 1, TILE_SIZE):
                for tx in range(0, ww - TILE_SIZE + 1, TILE_SIZE):
                    tile = water_img.crop((tx, ty, tx + TILE_SIZE, ty + TILE_SIZE))
                    arr = np.array(tile).astype(float)
                    avg = arr.mean(axis=(0, 1))
                    if avg[3] < 20:
                        continue   # skip fully transparent frames
                    score = (avg[2] - max(avg[0], avg[1])) * (avg[3] / 255.0)
                    if score > 0:
                        scored.append((score, tile))
            if scored:
                scored.sort(key=lambda s: -s[0])
                for _, best_tile in scored[:8]:   # up to 8 tile variants
                    bg = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), bg_color)
                    bg.alpha_composite(best_tile)
                    self.water_tiles.append(bg)
                break   # use first working water animation file
        if not self.water_tiles:
            self.water_tiles = [Image.new("RGBA", (TILE_SIZE, TILE_SIZE), bg_color)]
        # Backward-compat alias
        self.water_tile = self.water_tiles[0]

        # ── Beach ocean tiles by bitmask (BiomesCollection — all 16 land-mask variants) ──
        # Layer 1 of beach autotile = ocean/water tiles with autotile edge system.
        # All variants are pre-composited on water-blue so transparent edges never
        # reveal the underlying terrain colour (green grasslands, etc.).
        _water_bg = (45, 110, 185, 255)
        self.beach_water_by_mask: List[Image.Image] = []   # indexed by 4-bit land mask 0-15
        _bat = self.autotiles.get("beach")
        if _bat is not None and len(_bat.layers) >= 2:
            _rng0 = random.Random(0)
            for _m in range(16):
                try:
                    _raw = _bat.get_tile(1, _m, _rng0)
                    _comp = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), _water_bg)
                    _comp.alpha_composite(_raw)
                    self.beach_water_by_mask.append(_comp)
                except Exception:
                    self.beach_water_by_mask.append(
                        Image.new("RGBA", (TILE_SIZE, TILE_SIZE), _water_bg))
        if len(self.beach_water_by_mask) < 16:
            # Fallback: fill missing slots with solid water tiles
            _fb = self.water_tiles[0] if self.water_tiles else \
                  Image.new("RGBA", (TILE_SIZE, TILE_SIZE), _water_bg)
            while len(self.beach_water_by_mask) < 16:
                self.beach_water_by_mask.append(_fb)
        # Keep interior_water_tiles alias (mask-0 = center/interior tile)
        self.interior_water_tiles = [self.beach_water_by_mask[0]]

        # ── Ocean border animation: ocean-autotiles-anim.png ──
        # Border = water cells adjacent to any non-water terrain.
        # Each 32×32 tile in the sheet is one animation frame.
        # Tiles with "warm" content (sand visible) → border frame.
        # JSON exports the full frame list so the game can animate them in a loop.
        self.ocean_border_frames: List[Image.Image] = []
        self.ocean_anim_info: dict = {}
        ocean_anim_path = self.root / "ocean-autotiles-anim.png"
        if ocean_anim_path.exists():
            _oimg = Image.open(ocean_anim_path).convert("RGBA")
            _ow, _oh = _oimg.size
            _border_bg = (45, 110, 185, 255)
            _frame_coords: List[dict] = []
            for _ty in range(0, _oh - TILE_SIZE + 1, TILE_SIZE):
                for _tx in range(0, _ow - TILE_SIZE + 1, TILE_SIZE):
                    _crop = _oimg.crop((_tx, _ty, _tx + TILE_SIZE, _ty + TILE_SIZE))
                    _arr = np.array(_crop).astype(np.float32)
                    if _arr[:, :, 3].mean() < 20:
                        continue  # skip transparent tiles
                    # Measure sand/warm content — R > B+20 within opaque pixels
                    _op = _arr[:, :, 3] > 40
                    if _op.sum() < 16:
                        continue
                    _warm = _op & (_arr[:, :, 0] > _arr[:, :, 2] + 20)
                    _warm_frac = float(_warm.sum()) / max(1, float(_op.sum()))
                    if _warm_frac < 0.04:
                        continue  # nearly pure water tile — skip for border use
                    _comp = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), _border_bg)
                    _comp.alpha_composite(_crop)
                    self.ocean_border_frames.append(_comp)
                    _frame_coords.append({"x": _tx, "y": _ty})
            self.ocean_anim_info = {
                "sheet":       "ocean-autotiles-anim.png",
                "tile_px":     TILE_SIZE,
                "sheet_w":     _ow,
                "sheet_h":     _oh,
                "frame_count": len(self.ocean_border_frames),
                "fps":         5,
                "frames":      _frame_coords,
            }
        # Fallback: use existing water_tiles if no border frames found
        if not self.ocean_border_frames:
            self.ocean_border_frames = list(self.water_tiles)

    # ────── Static math methods (preserved) ──────

    @staticmethod
    def _mask4(grid: np.ndarray, y: int, x: int, fn: Callable[[int], bool]) -> int:
        """4-direction bitmask: N=1, E=2, S=4, W=8.
        fn(neighbor_value) should return True when the neighbor is 'different'."""
        h, w = grid.shape
        m = 0
        if y > 0     and fn(int(grid[y - 1, x])): m |= 1
        if x < w - 1 and fn(int(grid[y, x + 1])): m |= 2
        if y < h - 1 and fn(int(grid[y + 1, x])): m |= 4
        if x > 0     and fn(int(grid[y, x - 1])): m |= 8
        return m

    @staticmethod
    def _distance_to_mask(mask: np.ndarray) -> np.ndarray:
        """Manhattan distance transform (2-pass BFS)."""
        H, W = mask.shape
        dist = np.full((H, W), 1e9, dtype=np.float32)
        dist[mask] = 0.0
        for _ in range(3):
            for y in range(H):
                for x in range(W):
                    d = dist[y, x]
                    if y > 0:     d = min(d, dist[y - 1, x] + 1)
                    if x > 0:     d = min(d, dist[y, x - 1] + 1)
                    dist[y, x] = d
            for y in range(H - 1, -1, -1):
                for x in range(W - 1, -1, -1):
                    d = dist[y, x]
                    if y < H - 1: d = min(d, dist[y + 1, x] + 1)
                    if x < W - 1: d = min(d, dist[y, x + 1] + 1)
                    dist[y, x] = d
        return dist

    @staticmethod
    def _add_sprite_shadow(im: Image.Image,
                           offset: Tuple[int, int] = (0, 1)) -> Image.Image:
        alpha = im.split()[-1]
        shadow_mask = alpha.filter(ImageFilter.GaussianBlur(radius=1))
        shadow = Image.new("RGBA", im.size, (0, 0, 0, 0))
        shadow_layer = Image.new("RGBA", im.size, (0, 0, 0, 150))
        shadow.paste(shadow_layer, offset, shadow_mask)
        return Image.alpha_composite(shadow, im)

    # ────── Sprite placement ──────

    def _place_sprites(
        self,
        canvas: Image.Image,
        rng: random.Random,
        sprites: List[DecorSprite],
        occ: np.ndarray,
        tile_px: int,
        attempts: int,
        density: float,
        allowed_anchor: np.ndarray,
    ) -> List[dict]:
        """Place decoration sprites on the canvas.

        Sprites are auto-split into scatter (micro + medium) and set-pieces.
        Scatter sprites fill the map up to *density*; up to 1 set-piece per
        call is placed when the pool contains any.

        Rendering rules (pixel-art safe):
          - Uniform scale factor ``tile_px / 32`` preserves proportions.
          - ``Image.NEAREST`` resampling keeps pixel-art crisp.
          - Bottom-center alignment within the occupancy rectangle.

        Returns a list of placement records for JSON export.
        """
        h, w = occ.shape
        avail = int(np.sum(allowed_anchor)) if allowed_anchor is not None else (h * w)
        placements: List[dict] = []

        if not sprites:
            return placements
        sprites = [sp for sp in sprites if sp.image is not None]
        if not sprites:
            return placements

        # Split by size class
        scatter = [sp for sp in sprites if sp.size_class != "setpiece"]
        setpieces = [sp for sp in sprites if sp.size_class == "setpiece"]

        scale = tile_px / 32.0

        def _try_place(sp: DecorSprite) -> bool:
            occ_w = max(1, sp.tiles_w)
            occ_h = max(1, sp.tiles_h)

            max_y = h - occ_h
            max_x = w - occ_w
            if max_y < 0 or max_x < 0:
                return False

            y = safe_randint(rng, 0, max_y)
            x = safe_randint(rng, 0, max_x)

            # Anchor check at bottom row of occupancy
            base_y = y + occ_h - 1
            if base_y >= h or not allowed_anchor[base_y, x]:
                return False

            if occ[y:y + occ_h, x:x + occ_w].any():
                return False

            occ[y:y + occ_h, x:x + occ_w] = True

            base_im = sp.image.copy()

            # Uniform pixel-perfect scale
            new_w = max(1, int(base_im.width * scale))
            new_h = max(1, int(base_im.height * scale))
            if (new_w, new_h) != base_im.size:
                im_final = base_im.resize((new_w, new_h), Image.NEAREST)
            else:
                im_final = base_im

            im_final = self._add_sprite_shadow(im_final)

            area_w = occ_w * tile_px
            area_h = occ_h * tile_px
            off_x = (area_w - im_final.width) // 2   # center horizontally
            off_y = area_h - im_final.height           # bottom-aligned

            draw_x = x * tile_px + off_x
            draw_y = y * tile_px + off_y

            canvas.alpha_composite(im_final, (draw_x, draw_y))

            # Record placement for JSON export
            placements.append({
                "grid_x": int(x),
                "grid_y": int(y),
                "tiles_w": int(occ_w),
                "tiles_h": int(occ_h),
                "size_class": sp.size_class,
                "px_x": int(draw_x),
                "px_y": int(draw_y),
            })
            return True

        # ── Place scatter (micro + medium) ──
        if scatter:
            target = max(1, int(avail * density))
            placed = 0
            for _ in range(attempts):
                if placed >= target:
                    break
                sp = rng.choice(scatter)
                if _try_place(sp):
                    placed += 1

        # ── Place up to 1 set-piece ──
        if setpieces:
            sp = rng.choice(setpieces)
            for _ in range(min(200, attempts)):
                if _try_place(sp):
                    break

        return placements

    # ────── Terrain generators ──────

    def _make_open_terrain(self, H: int, W: int, rng: random.Random,
                           scale: int = 9, blur: int = 3,
                           threshold: float = 0.5) -> np.ndarray:
        """Generic 2-zone noise terrain.  0=primary, 1=secondary."""
        n = value_noise(H, W, rng, scale=scale, blur=blur)
        grid = np.zeros((H, W), dtype=np.int8)
        grid[n >= threshold] = 1
        return grid

    def _make_beach(self, H: int, W: int, rng: random.Random) -> np.ndarray:
        """Island/coast: 0=grass, 1=sand, 2=water."""
        n = value_noise(H, W, rng, scale=7, blur=3)
        water = n < 0.45

        # Flood-fill from edges to find connected ocean
        vis = np.zeros((H, W), dtype=bool)
        q: deque = deque()
        for x in range(W):
            if water[0, x]:     q.append((0, x));     vis[0, x] = True
            if water[H - 1, x]: q.append((H - 1, x)); vis[H - 1, x] = True
        for y in range(H):
            if water[y, 0]:     q.append((y, 0));     vis[y, 0] = True
            if water[y, W - 1]: q.append((y, W - 1)); vis[y, W - 1] = True
        while q:
            cy, cx = q.popleft()
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < H and 0 <= nx < W and water[ny, nx] and not vis[ny, nx]:
                    vis[ny, nx] = True
                    q.append((ny, nx))

        ocean = vis
        dist = self._distance_to_mask(~ocean)
        sand = (~ocean) & (dist <= 2.5)   # beach sand band
        grass = (~ocean) & (~sand)

        grid = np.zeros((H, W), dtype=np.int8)
        grid[ocean] = 2
        grid[sand] = 1
        grid[grass] = 0
        return grid

    def _make_arena(self, H: int, W: int, rng: random.Random,
                    margin: int = 1) -> np.ndarray:
        """Rectangular room: 0=floor, 1=floor_accent (near walls), 2=wall."""
        grid = np.full((H, W), 2, dtype=np.int8)

        # Carve interior
        for y in range(margin, H - margin):
            for x in range(margin, W - margin):
                grid[y, x] = 0

        # Accent ring hugging the walls
        inner_t = margin
        inner_b = H - margin - 1
        inner_l = margin
        inner_r = W - margin - 1
        for x in range(inner_l, inner_r + 1):
            grid[inner_t, x] = 1
            grid[inner_b, x] = 1
        for y in range(inner_t, inner_r + 1):
            if y < H:
                grid[y, inner_l] = 1
                grid[y, inner_r] = 1

        # A few accent patches in the interior
        for _ in range(max(1, (H * W) // 180)):
            yy = safe_randint(rng, margin + 2, H - margin - 3)
            xx = safe_randint(rng, margin + 2, W - margin - 3)
            if rng.random() < 0.35:
                grid[yy, xx] = 1

        return grid

    def _make_lake_terrain(self, H: int, W: int,
                           rng: random.Random) -> np.ndarray:
        """Inland lake: 0=grass, 1=shore/secondary grass, 2=water.

        Creates an organic lake shape using a radial gradient modulated
        by value noise.  The shore band sits between water and grass.
        """
        cy, cx = H / 2.0, W / 2.0
        yy, xx = np.mgrid[0:H, 0:W]

        # Normalised distance from center (0 at center, ~1.0 at edge)
        dist = np.sqrt(((yy - cy) / (H / 2.0)) ** 2 +
                       ((xx - cx) / (W / 2.0)) ** 2)

        # Noise gives organic edges
        noise = value_noise(H, W, rng, scale=6, blur=2)

        # Water where radial gradient + noise is low
        water_mask = (dist - noise * 0.45) < 0.55

        # Shore = land cells within 2 cells of water
        water_edge_dist = self._distance_to_mask(water_mask)
        shore = (~water_mask) & (water_edge_dist <= 2.0)

        grid = np.zeros((H, W), dtype=np.int8)
        grid[water_mask] = 2
        grid[shore] = 1
        return grid

    def _make_river_terrain(self, H: int, W: int,
                            rng: random.Random) -> np.ndarray:
        """River crossing the map: 0=grass, 1=riverbank, 2=water.

        Generates a sinusoidal river flowing left→right with noise-
        modulated width for organic, natural-looking banks.
        """
        noise = value_noise(H, W, rng, scale=7, blur=3)
        yy, xx = np.mgrid[0:H, 0:W]

        # Sinusoidal center-line parameters
        freq = rng.uniform(0.6, 1.4) * 2.0 * math.pi / W
        phase = rng.uniform(0, 2.0 * math.pi)
        amplitude = H * 0.18

        center_y = H / 2.0 + amplitude * np.sin(freq * xx + phase)

        # River width varies with noise (base ≈ 8 % of map height)
        base_width = max(2.0, H * 0.08)
        width = base_width * (1.0 + 0.5 * noise)   # 1.0×–1.5×

        # Water where vertical distance from center-line < width
        dist_to_river = np.abs(yy - center_y)
        water_mask = dist_to_river < width

        # Riverbank = land cells within 2 cells of water
        water_edge_dist = self._distance_to_mask(water_mask)
        bank = (~water_mask) & (water_edge_dist <= 2.0)

        grid = np.zeros((H, W), dtype=np.int8)
        grid[water_mask] = 2
        grid[bank] = 1
        return grid

    # ────── Main generate ──────

    def generate(
        self,
        biome: str,
        grid_w: int = 32,
        grid_h: int = 32,
        tile_px: int = 32,
        seed: int = 0,
    ) -> Image.Image:
        rng = random.Random(seed)
        biome = biome.lower().strip()

        cfg = BIOME_CONFIG.get(biome)
        if cfg is None:
            cfg = BIOME_CONFIG["grasslands"]

        tileset_name = cfg["tileset"]
        autotile = self.autotiles.get(tileset_name)
        if autotile is None:
            autotile = list(self.autotiles.values())[0]

        mode = cfg["mode"]

        # ── Generate terrain grid ──
        if mode == "open":
            grid = self._make_open_terrain(
                grid_h, grid_w, rng,
                scale=cfg.get("noise_scale", 9),
                blur=cfg.get("noise_blur", 3),
                threshold=cfg.get("threshold", 0.5),
            )
        elif mode == "beach":
            grid = self._make_beach(grid_h, grid_w, rng)
        elif mode == "lake":
            grid = self._make_lake_terrain(grid_h, grid_w, rng)
        elif mode == "river":
            grid = self._make_river_terrain(grid_h, grid_w, rng)
        elif mode == "arena":
            grid = self._make_arena(grid_h, grid_w, rng,
                                    margin=cfg.get("arena_margin", 1))
        else:
            grid = np.zeros((grid_h, grid_w), dtype=np.int8)

        # ── Prepare canvas ──
        # Beach mode uses water as the bottom layer — sand tiles have transparent
        # edges designed to blend *over* water, not grass.  All other modes use
        # the primary terrain color as background.
        if mode == "beach":
            bg_fill = (45, 110, 185, 255)   # water blue — revealed by sand edge tiles
        else:
            _base_sample = autotile.get_tile(0, 0, random.Random(seed ^ 0xBEEF))
            _barr = np.array(_base_sample)
            _opm = _barr[:, :, 3] > 50
            if _opm.any():
                _avc = _barr[_opm][:, :3].mean(axis=0).astype(int)
                bg_fill = (int(_avc[0]), int(_avc[1]), int(_avc[2]), 255)
            else:
                bg_fill = (40, 40, 40, 255)
        canvas = Image.new("RGBA", (grid_w * tile_px, grid_h * tile_px), bg_fill)
        scale_factor = tile_px / TILE_SIZE

        def blit(x: int, y: int, tile: Image.Image) -> None:
            if tile_px != TILE_SIZE:
                tile = tile.resize((tile_px, tile_px), resample=Image.NEAREST)
            canvas.alpha_composite(tile, (x * tile_px, y * tile_px))

        # ── Determine how many terrain layers the autotile has ──
        num_layers = len(autotile.layers)

        # ── Wall fill for arena modes ──
        wall_rgba = autotile.wall_color(0)
        wall_tile = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), wall_rgba)

        # ── Water tiles (fallback only) ──
        water_tiles = self.water_tiles
        _n_water = len(water_tiles)

        # Water is rendered via self.beach_water_by_mask[bitmask] — 16 bitmask-indexed
        # tiles from the beach autotile (ocean layer), all pre-composited on water-blue.
        # Mask 0 = fully interior; masks 1-15 = edge variants matching land neighbours.
        # ocean_border_frames / ocean_anim_info are exported to JSON only (game animates them).

        # ── Beach: use beach tileset for sand cells (layer 0 = sand, layer 1 = ocean) ──
        _beach_sand_at = None
        if mode == "beach":
            _bat = self.autotiles.get("beach")
            if _bat is not None and len(_bat.layers) >= 1:
                _beach_sand_at = _bat

        # ── Pre-compute water border mask for animated edge tiles ──
        # A water cell is a "border" if it has at least one non-water neighbour.
        _water_border_mask = np.zeros((grid_h, grid_w), dtype=np.int8)
        if mode in ("beach", "lake", "river"):
            for _wy in range(grid_h):
                for _wx in range(grid_w):
                    if int(grid[_wy, _wx]) != 2:
                        continue
                    _bm = self._mask4(grid, _wy, _wx, lambda v: v != 2)
                    _water_border_mask[_wy, _wx] = _bm  # 0 = interior

        # Track water cells for JSON export
        _water_cells: List[dict] = []

        # ── Ground layer ──
        if mode == "arena":
            # Arena: single-pass rendering (walls + floor + accent in one pass)
            for y in range(grid_h):
                for x in range(grid_w):
                    t = int(grid[y, x])
                    if t == 2:
                        blit(x, y, wall_tile)
                        continue
                    layer = min(t, num_layers - 1)
                    cell_val = t
                    mask = self._mask4(grid, y, x, lambda v: v != cell_val)
                    tile = autotile.get_tile(layer, mask, rng)
                    blit(x, y, tile)
        else:
            # Open / Beach: LAYERED rendering.
            # Autotile edge tiles have transparent areas designed to reveal
            # the terrain below.  We must paint the base layer first, then
            # composite overlay terrain on top.

            # Pass 1: base terrain on every cell
            for y in range(grid_h):
                for x in range(grid_w):
                    t = int(grid[y, x])
                    if mode in ("beach", "lake", "river") and t == 2:
                        _bm = int(_water_border_mask[y, x])
                        # beach_water_by_mask[0] = interior; [1-15] = autotile edge variants.
                        # All pre-composited on water-blue so transparent edges never
                        # reveal the underlying terrain colour.
                        blit(x, y, self.beach_water_by_mask[_bm])
                        if _bm > 0:
                            _water_cells.append(
                                {"grid_x": x, "grid_y": y,
                                 "kind": "border", "land_mask": _bm}
                            )
                        else:
                            _water_cells.append(
                                {"grid_x": x, "grid_y": y, "kind": "interior"}
                            )
                    elif mode == "beach" and t == 1 and _beach_sand_at is not None:
                        # Sand zone: beach autotile layer 0 = tan/beige sand tiles.
                        # Transparent edges blend naturally over the water background.
                        base = _beach_sand_at.get_tile(0, 0, rng)
                        blit(x, y, base)
                    elif mode in ("lake", "river") and t == 1 and num_layers > 1:
                        # Riverbank / shoreline: secondary grasslands layer
                        base = autotile.get_tile(1, 0, rng)
                        blit(x, y, base)
                    else:
                        base = autotile.get_tile(0, 0, rng)
                        blit(x, y, base)

            # Pass 2: overlay secondary terrain (layer > 0) with bitmask transitions
            for y in range(grid_h):
                for x in range(grid_w):
                    t = int(grid[y, x])
                    if t == 0:
                        continue  # base terrain, already painted
                    if mode in ("beach", "lake", "river") and t == 2:
                        continue  # water, already painted

                    # Beach sand: beach autotile layer 0 with bitmask for sand edges.
                    # Transparent edge areas blend over the water-colored background.
                    if mode == "beach" and t == 1 and _beach_sand_at is not None:
                        cell_val = t
                        mask = self._mask4(grid, y, x, lambda v: v != cell_val)
                        tile = _beach_sand_at.get_tile(0, mask, rng)
                        blit(x, y, tile)
                        continue

                    layer = min(t, num_layers - 1)
                    if layer == 0:
                        continue  # only 1 layer detected, nothing to overlay
                    cell_val = t
                    mask = self._mask4(grid, y, x, lambda v: v != cell_val)
                    tile = autotile.get_tile(layer, mask, rng)
                    blit(x, y, tile)

        # ── Cliff mask: block sprite placement on terrain transition edges ──
        cliff_mask = np.zeros((grid_h, grid_w), dtype=bool)
        for y in range(grid_h):
            for x in range(grid_w):
                v = int(grid[y, x])
                if y > 0          and int(grid[y - 1, x]) != v: cliff_mask[y, x] = True
                if y < grid_h - 1 and int(grid[y + 1, x]) != v: cliff_mask[y, x] = True
                if x > 0          and int(grid[y, x - 1]) != v: cliff_mask[y, x] = True
                if x < grid_w - 1 and int(grid[y, x + 1]) != v: cliff_mask[y, x] = True

        # ── Decoration layer ──
        occ = np.zeros((grid_h, grid_w), dtype=bool)

        # Block walls for arena modes (floor sprites can't go on walls)
        if mode == "arena":
            occ[grid == 2] = True

        # Define default floor anchor based on mode
        if mode == "arena":
            is_floor = (grid == 0)
            # Keep floor decor away from wall-adjacent cells
            center = np.zeros_like(is_floor)
            margin_val = cfg.get("arena_margin", 1)
            y0 = margin_val + 2
            y1 = grid_h - margin_val - 3
            x0 = margin_val + 2
            x1 = grid_w - margin_val - 3
            if y1 >= y0 and x1 >= x0:
                center[y0:y1 + 1, x0:x1 + 1] = True
            else:
                center[:, :] = True
            allowed_floor = is_floor & center
        elif mode in ("beach", "lake", "river"):
            allowed_floor = (grid != 2) & (~cliff_mask)
        else:
            allowed_floor = np.ones((grid_h, grid_w), dtype=bool) & (~cliff_mask)

        # Wall-sprite support for arena modes (vines, stalactites on walls)
        if mode == "arena":
            occ_wall = np.zeros((grid_h, grid_w), dtype=bool)
            occ_wall[grid != 2] = True          # only wall cells available
            allowed_wall = (grid == 2)
        else:
            occ_wall = None
            allowed_wall = None

        # Place decorations per config, collecting placement records
        all_placements: List[dict] = []

        for sprite_key, density, attempts in cfg.get("decor", []):
            if sprite_key == "biome":
                sprites = self.biome_decor.get(tileset_name, [])
            else:
                sprites = self.universal.get(sprite_key, [])

            if not sprites:
                continue

            # ── Arena biome decor: split wall vs floor sprites ──
            if mode == "arena" and sprite_key == "biome":
                wall_sp = [sp for sp in sprites
                           if sp.tiles_h >= 2 * max(1, sp.tiles_w)]
                floor_sp = [sp for sp in sprites
                            if sp.tiles_h < 2 * max(1, sp.tiles_w)]

                if floor_sp:
                    recs = self._place_sprites(
                        canvas, rng, floor_sp, occ, tile_px,
                        attempts=attempts, density=density,
                        allowed_anchor=allowed_floor,
                    )
                    for r in recs:
                        r["sprite_key"] = sprite_key
                    all_placements.extend(recs)
                if wall_sp and occ_wall is not None:
                    recs = self._place_sprites(
                        canvas, rng, wall_sp, occ_wall, tile_px,
                        attempts=min(150, attempts),
                        density=density * 0.5,
                        allowed_anchor=allowed_wall,
                    )
                    for r in recs:
                        r["sprite_key"] = sprite_key + "_wall"
                    all_placements.extend(recs)
                continue

            # ── Water flora: only on water cells (cliff_mask NOT applied) ──
            if sprite_key == "water_flora":
                anchor = (grid == 2)
            else:
                anchor = allowed_floor

            recs = self._place_sprites(
                canvas, rng, sprites, occ, tile_px,
                attempts=attempts,
                density=density,
                allowed_anchor=anchor,
            )
            for r in recs:
                r["sprite_key"] = sprite_key
            all_placements.extend(recs)

        # ── Store map data for JSON export ──
        self._last_map_data = {
            "biome": biome,
            "grid_w": grid_w,
            "grid_h": grid_h,
            "tile_px": tile_px,
            "seed": seed,
            "terrain_grid": grid.tolist(),
            "decorations": all_placements,
            # Water animation — border cells loop through ocean-autotiles-anim.png frames.
            # Interior cells use beach.png layer-1 tiles (BiomesCollection ocean pattern).
            # land_mask uses the 4-bit bitmask: N=1, E=2, S=4, W=8.
            "water_animation": self.ocean_anim_info if mode in ("beach", "lake", "river") else {},
            "water_cells": _water_cells if mode in ("beach", "lake", "river") else [],
        }

        return canvas

    # ────── JSON export ──────

    def export_map_data(self) -> dict:
        """Return the map data dictionary from the last ``generate()`` call.

        Structure::

            {
              "biome": str,
              "grid_w": int,
              "grid_h": int,
              "tile_px": int,
              "seed": int,
              "terrain_grid": [[int, ...], ...],   # 2D matrix of zone IDs
              "decorations": [
                {
                  "sprite_key": str,
                  "grid_x": int, "grid_y": int,
                  "tiles_w": int, "tiles_h": int,
                  "size_class": str,
                  "px_x": int, "px_y": int,
                },
                ...
              ]
            }
        """
        return getattr(self, "_last_map_data", {})

    def export_map_json(self, json_path: str | Path) -> None:
        """Save map data from the last ``generate()`` call to a JSON file."""
        data = self.export_map_data()
        if not data:
            return
        json_path = Path(json_path)
        json_path.parent.mkdir(parents=True, exist_ok=True)
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)


# ════════════════════════════════════════════════════════════════
# Convenience
# ════════════════════════════════════════════════════════════════

def generate_to_file(
    out_png: str | Path,
    biome: str,
    assets_root: str | Path | None = None,
    grid_w: int = 32,
    grid_h: int = 32,
    tile_px: int = 32,
    seed: int = 0,
) -> None:
    gen = BiomeGenerator(assets_root)
    img = gen.generate(biome=biome, grid_w=grid_w, grid_h=grid_h,
                       tile_px=tile_px, seed=seed)
    out_png = Path(out_png)
    out_png.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_png)

    # Also export companion JSON with terrain grid + decoration data
    json_path = out_png.with_suffix(".json")
    gen.export_map_json(json_path)


if __name__ == "__main__":
    import sys
    biome = sys.argv[1] if len(sys.argv) > 1 else "grasslands"
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 42
    out = f"test_{biome}.png"
    print(f"Generating {biome} (seed={seed}) ...")
    generate_to_file(out, biome, seed=seed)
    print(f"Saved to {out}")
    print(f"Saved JSON to test_{biome}.json")
