#!/usr/bin/env python
"""
One-shot script — composites the layered-P + clock brand mark onto the blank
sign face of the AI-generated hero photo. Writes the final asset to
public/hero-illustration.png so it slots in as the new hero with no
component-side changes (LandingFeatures already references that path).

Steps:
  1. Build a transparent-background brand-mark SVG by stripping the white
     rounded-rect tile from public/parkproof-icon.svg (we don't want the
     tile because the photographed sign IS the tile).
  2. Render the brand-mark SVG to a 220×220 transparent PNG via resvg.
  3. Paste it onto the photo with alpha-compositing at the sign's location
     (eyeballed bbox: ~x=100..220, y=90..220, so centred at (160, 155)).
  4. Save as PNG.

Run once when the source photo or icon changes. Not invoked by deploy.sh —
this is an offline asset-bake step.
"""

from pathlib import Path
import re
import io
from PIL import Image
import resvg_py

ROOT = Path(__file__).resolve().parents[1]
PHOTO_PATH = ROOT / "public" / "hero-photo-candidate.png"
ICON_PATH = ROOT / "public" / "parkproof-icon.svg"
OUTPUT_PATH = ROOT / "public" / "hero-illustration.png"

# Sign bbox in the 640x516 source photo (eyeballed from the saved crop).
# Brand mark gets centred inside this rectangle with a small inset so it
# doesn't crowd the painted sign border.
SIGN_X1, SIGN_Y1 = 100, 88
SIGN_X2, SIGN_Y2 = 222, 218
# Inset proportional to the sign size so the mark "breathes" inside the sign.
INSET = 12

# ── Step 1: build a tile-less brand mark SVG ──────────────────────────
svg_src = ICON_PATH.read_text(encoding="utf-8")
# Strip the white background tile (line starting with `<rect x="34"`). It's
# a single self-closing rect element — remove it cleanly with a regex so
# future edits to the icon don't break this script.
tile_less = re.sub(
    r'<rect\s+x="34"\s+y="34"[^/]*fill="#F2F4F7"\s*/>\s*',
    '',
    svg_src,
    count=1,
)
assert tile_less != svg_src, "Failed to strip the background tile — the icon SVG markup changed?"

# ── Step 2: render to transparent PNG ─────────────────────────────────
mark_w = SIGN_X2 - SIGN_X1 - 2 * INSET
mark_h = SIGN_Y2 - SIGN_Y1 - 2 * INSET
mark_size = min(mark_w, mark_h)  # square — the icon is 512x512

mark_png_bytes = resvg_py.svg_to_bytes(
    svg_string=tile_less,
    width=mark_size,
    height=mark_size,
)
mark_img = Image.open(io.BytesIO(bytes(mark_png_bytes))).convert("RGBA")

# ── Step 3: composite onto the photo ──────────────────────────────────
photo = Image.open(PHOTO_PATH).convert("RGBA")
# Centre of the sign rectangle.
cx = (SIGN_X1 + SIGN_X2) // 2
cy = (SIGN_Y1 + SIGN_Y2) // 2
paste_x = cx - mark_size // 2
paste_y = cy - mark_size // 2

# Paste with the mark's own alpha channel as the mask so the white sign
# face shows through where the SVG is transparent.
photo.paste(mark_img, (paste_x, paste_y), mark_img)

# ── Step 4: save ──────────────────────────────────────────────────────
# Convert back to RGB before saving since the photo doesn't need a global
# alpha channel and RGB PNGs compress smaller.
photo.convert("RGB").save(OUTPUT_PATH, "PNG", optimize=True)
size_kb = OUTPUT_PATH.stat().st_size // 1024
print(f"wrote {OUTPUT_PATH.name}  ({size_kb} KB, {photo.size[0]}x{photo.size[1]})")
print(f"brand mark placed at ({paste_x}, {paste_y}) sized {mark_size}x{mark_size}")
