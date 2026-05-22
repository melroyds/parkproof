#!/usr/bin/env python
"""
Composites the layered-P + clock brand mark onto the blank sign face of an
AI-generated hero photo. Drop-in: detects the sign rectangle automatically
so a higher-res / cropped / re-rendered source works without code changes.

Steps:
  1. Detect the sign bbox in public/hero-photo-candidate.png by scanning
     each row in the upper-left third for the longest contiguous run of
     near-pure-white pixels. The sign is the brightest neutral rectangle
     in that region; the slightly-blue sky fails the neutrality test.
  2. Build a transparent-background brand-mark SVG by stripping the white
     rounded-rect tile from public/parkproof-icon.svg (the photographed
     sign IS the tile).
  3. Render the mark to a transparent PNG sized to fit the detected sign
     with a small inset.
  4. Alpha-paste onto the photo, centred on the sign rectangle.
  5. Save as public/hero-illustration.png.

Re-run after regenerating the source photo. Not invoked by deploy.sh —
this is an offline asset-bake step.
"""

from pathlib import Path
import re
import io
from PIL import Image, ImageDraw
import resvg_py

ROOT = Path(__file__).resolve().parents[1]
# Source photo lives under scripts/ so the 2MB Nano-Banana raw doesn't ship
# to S3 as a static asset. The baked OUTPUT goes to public/ for delivery.
PHOTO_PATH = ROOT / "scripts" / "screenshots-fixtures" / "hero-source.png"
ICON_PATH = ROOT / "public" / "parkproof-icon.svg"
OUTPUT_PATH = ROOT / "public" / "hero-illustration.png"
# Debug image also kept out of public/ — it's a build artefact, not a
# user-facing asset.
DEBUG_BBOX_PATH = ROOT / "scripts" / "screenshots-fixtures" / "hero-sign-bbox-debug.png"

# Inset proportional to the sign's smaller side so the mark "breathes"
# inside the painted sign border without crowding it. 6% is what looked
# best at small display sizes (140-180px wide) — adjust if a future
# composition wants more padding.
INSET_FRACTION = 0.06


def detect_sign_bbox(img: Image.Image) -> tuple[int, int, int, int]:
    """Return (x1, y1, x2, y2) of the blank white sign panel.

    Scans the upper-left third of the image for the longest contiguous run
    of near-pure-white pixels per row. Takes the bounding box of all rows
    whose run is at least 70% of the median run length — that excludes
    stray white pixels in distant building facades / clouds that have a
    short cluster but aren't the main sign rectangle.

    Tightness of the neutrality test (max-min < 8) is what excludes the
    slightly-blue sky; loosening it picks up sky pixels and inflates the
    bbox horizontally.
    """
    pixels = img.load()
    w, h = img.size

    def is_sign_white(r: int, g: int, b: int) -> bool:
        return r > 235 and g > 235 and b > 235 and max(r, g, b) - min(r, g, b) < 8

    # Per-row: find the longest contiguous run of sign-white pixels in the
    # left 45% of the row (the sign is always on the left in our framing —
    # if a future composition flips that, expand this window).
    best_runs: list[tuple[int, int, int, int]] = []  # (y, x_start, x_end, length)
    scan_y_max = int(h * 0.6)
    scan_x_max = int(w * 0.45)
    for y in range(scan_y_max):
        longest = 0
        cur_start = -1
        cur_len = 0
        best_start = -1
        best_end = -1
        for x in range(scan_x_max):
            r, g, b = pixels[x, y]
            if is_sign_white(r, g, b):
                if cur_start == -1:
                    cur_start = x
                cur_len += 1
                if cur_len > longest:
                    longest = cur_len
                    best_start = cur_start
                    best_end = x
            else:
                cur_start = -1
                cur_len = 0
        if longest > max(30, w * 0.04):
            best_runs.append((y, best_start, best_end, longest))

    if not best_runs:
        raise RuntimeError(
            "Could not find a blank sign panel in the photo. "
            "Verify the source has a near-pure-white sign in the upper-left third."
        )

    runs_sorted = sorted(r[3] for r in best_runs)
    median = runs_sorted[len(runs_sorted) // 2]
    sign_rows = [r for r in best_runs if r[3] >= median * 0.7]
    if not sign_rows:
        raise RuntimeError("Detected white rows but couldn't cluster them into a sign rectangle.")

    return (
        min(r[1] for r in sign_rows),
        min(r[0] for r in sign_rows),
        max(r[2] for r in sign_rows),
        max(r[0] for r in sign_rows),
    )


# ── Step 1: load + detect ─────────────────────────────────────────────
photo = Image.open(PHOTO_PATH).convert("RGBA")
detect_src = photo.convert("RGB")
x1, y1, x2, y2 = detect_sign_bbox(detect_src)
sign_w, sign_h = x2 - x1, y2 - y1
print(f"detected sign bbox: x=[{x1},{x2}] y=[{y1},{y2}]  ({sign_w}x{sign_h})")

# Save a debug image with a red rectangle outlining the detected sign so
# you can sanity-check the detection visually. Delete this if you don't
# want it tracked in git.
debug = detect_src.copy()
ImageDraw.Draw(debug).rectangle((x1, y1, x2, y2), outline="red", width=3)
debug.save(DEBUG_BBOX_PATH)

inset = max(4, int(min(sign_w, sign_h) * INSET_FRACTION))
mark_w = sign_w - 2 * inset
mark_h = sign_h - 2 * inset
mark_size = min(mark_w, mark_h)  # square — the icon is 512x512

# ── Step 2: build a tile-less brand-mark SVG ──────────────────────────
svg_src = ICON_PATH.read_text(encoding="utf-8")
tile_less = re.sub(
    r'<rect\s+x="34"\s+y="34"[^/]*fill="#F2F4F7"\s*/>\s*',
    "",
    svg_src,
    count=1,
)
assert tile_less != svg_src, "Failed to strip the background tile — the icon SVG markup changed?"

# ── Step 3: render mark ───────────────────────────────────────────────
mark_png_bytes = resvg_py.svg_to_bytes(
    svg_string=tile_less,
    width=mark_size,
    height=mark_size,
)
mark_img = Image.open(io.BytesIO(bytes(mark_png_bytes))).convert("RGBA")

# ── Step 4: composite ─────────────────────────────────────────────────
cx = (x1 + x2) // 2
cy = (y1 + y2) // 2
paste_x = cx - mark_size // 2
paste_y = cy - mark_size // 2
photo.paste(mark_img, (paste_x, paste_y), mark_img)

# ── Step 5: save ──────────────────────────────────────────────────────
# Downscale before saving — the landing renders this image at max ~728px
# wide (full-width inside max-w-md = 28rem container). Shipping a
# 1152x928 PNG would be ~1.4 MB; a 800px-wide downscale lands at
# ~500-700 KB while staying sharp on 3x retina displays.
MAX_DELIVERY_WIDTH = 800
flat = photo.convert("RGB")
if flat.width > MAX_DELIVERY_WIDTH:
    new_h = round(flat.height * MAX_DELIVERY_WIDTH / flat.width)
    flat = flat.resize((MAX_DELIVERY_WIDTH, new_h), Image.LANCZOS)
flat.save(OUTPUT_PATH, "PNG", optimize=True)
size_kb = OUTPUT_PATH.stat().st_size // 1024
print(f"wrote {OUTPUT_PATH.name}  ({size_kb} KB, {flat.size[0]}x{flat.size[1]})")
print(f"brand mark placed at ({paste_x}, {paste_y}) sized {mark_size}x{mark_size}, inset {inset}px")
print(f"debug bbox image: {DEBUG_BBOX_PATH.name}")
