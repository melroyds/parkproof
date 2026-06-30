#!/usr/bin/env python
"""Generate the iOS PWA launch-splash PNGs (vault + Datum P) for common
portrait iPhone/iPad sizes, plus the matching <link rel="apple-touch-startup-
image"> tags. Apple ignores the manifest splash, so these are the only way to
brand the launch screen on an installed iOS PWA.

Run:  python scripts/_gen_ios_splash.py
Then paste the printed <link> tags into index.html (already wired). PNGs land in
public/splash/. Re-run if the brand mark or vault colour changes.
"""
import io
from pathlib import Path
import resvg_py
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "public" / "splash"
OUT.mkdir(parents=True, exist_ok=True)

# (cssWidth, cssHeight, devicePixelRatio) — portrait. render px = css * dpr.
DEVICES = [
    (430, 932, 3), (393, 852, 3), (390, 844, 3), (428, 926, 3), (375, 812, 3),
    (414, 896, 3), (414, 896, 2), (375, 667, 2), (414, 736, 3),
    (768, 1024, 2), (834, 1194, 2), (1024, 1366, 2),
]


def svg(W: int, H: int) -> str:
    s = min(W, H)
    mh = s * 0.20
    sc = mh / 69            # Datum P bbox height is ~69 in its 100-unit space
    cx = W / 2
    mcy = H * 0.40
    tx = cx - 54 * sc       # bbox centre x = 54
    ty = mcy - 47.5 * sc    # bbox centre y = 47.5
    wy = mcy + 47.5 * sc + s * 0.085
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<rect width="{W}" height="{H}" fill="#073B25"/>
<g transform="translate({tx:.1f} {ty:.1f}) scale({sc:.4f})">
<rect x="27" y="19" width="12.5" height="63" fill="#F3F6F4"/>
<path fill-rule="evenodd" fill="#F3F6F4" d="M57 13 A24 24 0 1 0 57 61 A24 24 0 1 0 57 13 Z M57 25 A12 12 0 1 1 57 49 A12 12 0 1 1 57 25 Z"/>
<circle cx="57" cy="37" r="5.5" fill="#7BE3A4"/><path d="M73 20 L80.5 17.5 L77.5 27 Z" fill="#7BE3A4"/>
</g>
<text x="{cx:.0f}" y="{wy:.0f}" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="{s * 0.066:.0f}" fill="#F3F6F4">ParkProof</text>
</svg>'''


def main() -> None:
    tags = []
    for cssW, cssH, dpr in DEVICES:
        W, H = cssW * dpr, cssH * dpr
        png = resvg_py.svg_to_bytes(svg_string=svg(W, H), width=W, height=H)
        name = f"apple-splash-{W}x{H}.png"
        Image.open(io.BytesIO(bytes(png))).convert("RGB").save(OUT / name)
        tags.append(
            f'    <link rel="apple-touch-startup-image" media="screen and '
            f'(device-width: {cssW}px) and (device-height: {cssH}px) and '
            f'(-webkit-device-pixel-ratio: {dpr}) and (orientation: portrait)" '
            f'href="splash/{name}" />'
        )
        print("wrote", name)
    print("\n".join(tags))


if __name__ == "__main__":
    main()
