#!/usr/bin/env python3
"""
Subset the Noto Sans TTFs in public/fonts/ down to just the glyphs that the
ParkProof PDF generator actually needs for each locale.

Why this exists:
  CJK variable fonts (NotoSansSC 17MB, NotoSansKR 10MB) are too large to
  serve over CloudFront on a Reddit launch — a Chinese-speaking user
  clicking Export PDF on mobile data would wait ages for the font. Subset
  versions cover ONLY the characters that appear in our localized strings
  + ASCII + Latin-1, dropping CJK font sizes by ~95%.

How it works:
  1. Read all 9 locale JSON files under src/locales/*.json
  2. Build a per-locale set of unique Unicode codepoints from every string
     value in the JSON
  3. For each font: union the relevant locale charsets + a universal ASCII
     + Latin-1 baseline + common punctuation/digits
  4. Run pyftsubset to produce a TTF with only those glyphs

Output:
  Overwrites the full-size TTFs in public/fonts/ with subsetted versions.
  Originals can be re-downloaded from Google Fonts GitHub at any time.

Re-run after locale JSON edits. Idempotent — subsetting an already-subset
font is fine (it'll just produce the same output).

Run:
  python scripts/_subset_pdf_fonts.py
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES_DIR = ROOT / "src" / "locales"
FONTS_DIR = ROOT / "public" / "fonts"

# Map of font filename → locale codes whose strings should be included.
# Vietnamese + Greek share NotoSans.ttf (the file covers both scripts).
FONT_LOCALES = {
    "NotoSansSC.ttf": ["zh-CN"],
    "NotoSansKR.ttf": ["ko"],
    "NotoSans.ttf": ["vi", "el", "en"],   # Latin Ext + Greek + Vietnamese
    "NotoSansDevanagari.ttf": ["hi"],
    "NotoSansGurmukhi.ttf": ["pa"],
}

# Baseline glyphs every font should keep, regardless of locale content.
# ASCII covers numbers / English punctuation / the verbatim ASCII parts of
# any localized string. Latin-1 covers occasional € £ ° etc. Common symbols
# cover the ✓ → curly quotes the UI sprinkles in.
def baseline_chars() -> set[str]:
    chars: set[str] = set()
    # ASCII printable
    chars.update(chr(c) for c in range(0x20, 0x7F))
    # Latin-1 supplement (covers Italian/Indonesian accented chars in case
    # those strings also slip into a non-Latin font's subset)
    chars.update(chr(c) for c in range(0xA0, 0x100))
    # Frequently-used Unicode characters in the UI (arrows, checkmarks,
    # curly quotes, em dashes, ellipsis)
    chars.update("→✓×←⋯…—–“”‘’•·©®°·′″≈≥≤≠⌀⚠")
    return chars


def chars_from_json(path: Path) -> set[str]:
    """Walk a locale JSON and collect every character in every string value."""
    chars: set[str] = set()
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    def walk(obj) -> None:
        if isinstance(obj, str):
            chars.update(obj)
        elif isinstance(obj, dict):
            for v in obj.values():
                walk(v)
        elif isinstance(obj, list):
            for v in obj:
                walk(v)

    walk(data)
    return chars


def subset_font(font_path: Path, chars: set[str]) -> tuple[int, int]:
    """Run pyftsubset on the font file. Returns (orig_size, new_size)."""
    orig_size = font_path.stat().st_size
    # pyftsubset takes a `--unicodes` arg as comma-separated hex codes.
    unicodes = ",".join(f"{ord(c):04X}" for c in sorted(chars))
    out_path = font_path.with_suffix(".subset.ttf")

    # `--no-hinting` strips the hinting table — a big size saver. Hinting
    # only matters at small pixel sizes on low-DPI screens; in a PDF
    # rendered to a printer the hinting is irrelevant.
    cmd = [
        sys.executable, "-m", "fontTools.subset",
        str(font_path),
        f"--unicodes={unicodes}",
        f"--output-file={out_path}",
        "--no-hinting",
        "--desubroutinize",
        "--name-IDs=*",
        "--name-legacy",
        "--name-languages=*",
        "--retain-gids",
        "--no-recalc-bounds",
        "--drop-tables+=DSIG",
    ]
    print(f"  → subsetting {font_path.name} ({len(chars)} glyphs)...")
    subprocess.run(cmd, check=True, capture_output=True)
    # Replace the original with the subset
    out_path.replace(font_path)
    new_size = font_path.stat().st_size
    return orig_size, new_size


def main() -> None:
    if not LOCALES_DIR.is_dir():
        print(f"ERROR: locales dir not found: {LOCALES_DIR}", file=sys.stderr)
        sys.exit(1)
    if not FONTS_DIR.is_dir():
        print(f"ERROR: fonts dir not found: {FONTS_DIR}", file=sys.stderr)
        sys.exit(1)

    # Build per-locale char sets once.
    locale_chars: dict[str, set[str]] = {}
    for json_path in sorted(LOCALES_DIR.glob("*.json")):
        code = json_path.stem
        locale_chars[code] = chars_from_json(json_path)
        print(f"locale {code}: {len(locale_chars[code])} unique chars")

    base = baseline_chars()

    print()
    print("Subsetting fonts (per-font glyph union of mapped locales + baseline)…")
    total_before = 0
    total_after = 0
    for font_name, locales in FONT_LOCALES.items():
        font_path = FONTS_DIR / font_name
        if not font_path.is_file():
            print(f"  ! skip {font_name} (not present)")
            continue
        union_chars = set(base)
        for loc in locales:
            if loc in locale_chars:
                union_chars |= locale_chars[loc]
        orig, new = subset_font(font_path, union_chars)
        total_before += orig
        total_after += new
        pct = (1 - new / orig) * 100 if orig else 0
        print(
            f"  ✓ {font_name}: {orig/1024:.0f} KB → {new/1024:.0f} KB "
            f"({pct:.1f}% reduction)"
        )

    print()
    saved_mb = (total_before - total_after) / 1024 / 1024
    print(
        f"Done. Total before: {total_before/1024/1024:.1f} MB · "
        f"after: {total_after/1024/1024:.1f} MB · "
        f"saved: {saved_mb:.1f} MB."
    )


if __name__ == "__main__":
    main()
