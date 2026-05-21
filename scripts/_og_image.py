"""
Generate public/og-image.png — the social-share card displayed by every
platform that previews a link (iMessage, WhatsApp, LinkedIn, Slack, Twitter,
Reddit, Discord, Facebook). 1200×630 PNG, sRGB.

Re-runnable: every time the brand or canonical URL changes, run this script
again. Output is deterministic (same inputs = same bytes).

Fonts:
  Fraunces 72pt extra-bold variable (downloaded once into scripts/.fonts/)
  Inter — uses the system install on Windows; falls back to Arial otherwise.
"""
from __future__ import annotations
import io
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import resvg_py

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "scripts" / ".fonts"
OUTPUT = ROOT / "public" / "og-image.png"
ICON_SVG = ROOT / "public" / "parkproof-icon.svg"

# ─── Brand tokens (matches src/index.css @theme) ──────────────────────────
BRAND_BLUE = (39, 91, 255)        # #275BFF
INK_NAVY = (26, 34, 51)           # #1A2233
INK_MID = (74, 85, 104)           # #4A5568
INK_LIGHT = (107, 114, 128)       # #6B7280
PAPER_BG = (242, 244, 247)        # #F2F4F7
PAPER_DARK = (229, 231, 235)      # #E5E7EB
ACCENT_TEAL = (32, 196, 199)      # #20C4C7
WHITE = (255, 255, 255)

# ─── Canvas ────────────────────────────────────────────────────────────────
WIDTH, HEIGHT = 1200, 630
PADDING = 64


def _load_font(path: Path | str, size: int, fallback: str | None = None) -> ImageFont.FreeTypeFont:
    """Try the requested font, fall back to a Windows-system alternative."""
    p = Path(path)
    if p.exists():
        return ImageFont.truetype(str(p), size=size)
    if fallback:
        try:
            return ImageFont.truetype(fallback, size=size)
        except Exception:
            pass
    # Last resort — Pillow's default bitmap font (ugly, but won't crash).
    return ImageFont.load_default()


def _load_fraunces(size: int) -> ImageFont.FreeTypeFont:
    """Fraunces extra-bold (wght axis = 800) for the hero tagline."""
    font = _load_font(
        FONTS / "Fraunces-ExtraBold.ttf",
        size,
        fallback="C:/Windows/Fonts/cambriab.ttf",
    )
    # Set the wght axis on the variable font to 800 (extra-bold).
    try:
        font.set_variation_by_axes([800.0])
    except (AttributeError, OSError):
        # Static fallback or older Pillow — ignore.
        pass
    return font


def _load_inter(size: int, weight: str = "Bold") -> ImageFont.FreeTypeFont:
    """Inter sans-serif for body, label, and URL."""
    # On Windows Inter is installed at C:/Windows/Fonts/Inter-*.ttf. Pillow
    # picks the right weight by filename.
    weight_to_path = {
        "Regular": "C:/Windows/Fonts/Inter-Regular.ttf",
        "Medium": "C:/Windows/Fonts/Inter-Medium.ttf",
        "SemiBold": "C:/Windows/Fonts/Inter-SemiBold.ttf",
        "Bold": "C:/Windows/Fonts/Inter-Bold.ttf",
    }
    path = weight_to_path.get(weight, weight_to_path["Bold"])
    return _load_font(path, size, fallback="C:/Windows/Fonts/arialbd.ttf")


def _draw_subtle_pattern(draw: ImageDraw.ImageDraw) -> None:
    """A whisper of diagonal stripes echoes the SPA's cavalcade background.

    Keeps the brand recognisable across the SPA → social-card → screenshot
    surface without overpowering the typography.
    """
    stripe_color = PAPER_DARK
    spacing = 80
    # Diagonal stripes from top-left to bottom-right.
    for offset in range(-HEIGHT, WIDTH, spacing):
        draw.line(
            [(offset, 0), (offset + HEIGHT, HEIGHT)],
            fill=stripe_color,
            width=1,
        )


def _rasterize_icon(size: int) -> Image.Image:
    """Render the brand-canonical SVG (public/parkproof-icon.svg) to a PIL
    image at the requested square size. Uses resvg (Rust-based, no native
    Cairo dependency). This preserves the layered-P + alarm-clock design
    exactly as it appears everywhere else in the app (favicon, PWA tile,
    splash, inline BrandMark component) — no fork between OG-card branding
    and product branding.

    Renders at 3× the target then downscales with LANCZOS for crisp edges
    at small thumbnail sizes (LinkedIn shows OG cards at ~600px wide, so
    the logo mark renders at ~30px there — anti-aliasing matters).
    """
    super_size = size * 3
    with open(ICON_SVG, "r", encoding="utf-8") as f:
        svg_string = f.read()
    png_bytes = resvg_py.svg_to_bytes(
        svg_string=svg_string,
        width=super_size,
        height=super_size,
    )
    img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    return img.resize((size, size), Image.LANCZOS)


def _paste_logo(canvas: Image.Image, x: int, y: int, size: int = 80) -> None:
    """Place the real brand mark on the OG canvas at the given top-left."""
    logo = _rasterize_icon(size)
    canvas.paste(logo, (x, y), mask=logo)


def build() -> None:
    img = Image.new("RGB", (WIDTH, HEIGHT), PAPER_BG)
    draw = ImageDraw.Draw(img)

    _draw_subtle_pattern(draw)

    # ─── Wordmark band ────────────────────────────────────────────────────
    # Use the real layered-P + clock mark from parkproof-icon.svg, NOT a
    # Pillow primitive approximation. Logo is 80px tall to read clearly at
    # LinkedIn's ~600px-wide thumbnail.
    LOGO_SIZE = 80
    _paste_logo(img, PADDING, PADDING - 10, size=LOGO_SIZE)
    # Wordmark text — Fraunces ExtraBold (variable, wght=800) to match the
    # actual SVG wordmark's serif treatment. The hero tagline below uses the
    # same Fraunces; the wordmark is smaller + tighter tracking.
    word_font = _load_fraunces(48)
    word_x = PADDING + LOGO_SIZE + 18
    word_y = PADDING + 12
    draw.text((word_x, word_y), "ParkProof", font=word_font, fill=INK_NAVY)

    # ─── Hero tagline (two lines) ─────────────────────────────────────────
    tagline_font = _load_fraunces(92)
    tagline_y = 200
    line1 = "Aussie parking,"
    line2 = "decoded."
    draw.text((PADDING, tagline_y), line1, font=tagline_font, fill=INK_NAVY)
    # Wrap to next line — measure first line's height to set y2.
    bbox = draw.textbbox((PADDING, tagline_y), line1, font=tagline_font)
    line_height = bbox[3] - bbox[1]
    draw.text(
        (PADDING, tagline_y + line_height + 6),
        line2,
        font=tagline_font,
        fill=BRAND_BLUE,
    )

    # ─── Sub-tagline (one or two lines of body) ───────────────────────────
    sub_font = _load_inter(28, "Medium")
    sub_y = 470
    draw.text(
        (PADDING, sub_y),
        "Photograph a sign. Get a plain-English answer.",
        font=sub_font,
        fill=INK_MID,
    )
    draw.text(
        (PADDING, sub_y + 38),
        "Save evidence for disputes.",
        font=sub_font,
        fill=INK_MID,
    )

    # ─── URL pill (bottom-right) ──────────────────────────────────────────
    url_text = "www.parkproof.com.au"
    url_font = _load_inter(22, "SemiBold")
    url_bbox = draw.textbbox((0, 0), url_text, font=url_font)
    url_w = url_bbox[2] - url_bbox[0]
    url_h = url_bbox[3] - url_bbox[1]
    pill_pad_x = 20
    pill_pad_y = 12
    pill_w = url_w + pill_pad_x * 2 + 28  # room for the "→ " prefix
    pill_h = url_h + pill_pad_y * 2 + 6
    pill_x = WIDTH - PADDING - pill_w
    pill_y = HEIGHT - PADDING - pill_h
    draw.rounded_rectangle(
        (pill_x, pill_y, pill_x + pill_w, pill_y + pill_h),
        radius=pill_h // 2,
        fill=INK_NAVY,
    )
    # Arrow + URL inside the pill.
    arrow_font = _load_inter(22, "Bold")
    arrow_y_offset = (pill_h - url_h) // 2 - 4
    draw.text(
        (pill_x + pill_pad_x, pill_y + arrow_y_offset),
        "→",
        font=arrow_font,
        fill=ACCENT_TEAL,
    )
    draw.text(
        (pill_x + pill_pad_x + 28, pill_y + arrow_y_offset),
        url_text,
        font=url_font,
        fill=WHITE,
    )

    # ─── Brand stripe (bottom edge accent) ────────────────────────────────
    # A 6px-thick brand-blue line right above the bottom edge — anchors the
    # composition and prevents the tagline from "floating".
    stripe_y = HEIGHT - 6
    draw.rectangle((0, stripe_y, WIDTH, HEIGHT), fill=BRAND_BLUE)

    # Save as PNG with reasonable compression.
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUTPUT, format="PNG", optimize=True)
    size_kb = OUTPUT.stat().st_size // 1024
    print(f"wrote {OUTPUT}  ({size_kb} KB, {WIDTH}x{HEIGHT})")


if __name__ == "__main__":
    build()
