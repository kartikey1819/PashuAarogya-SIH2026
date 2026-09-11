# -*- coding: utf-8 -*-
"""Generate every PashuAarogya app icon from one source logo.

    python make_icons.py [path-to-logo]

With no argument it looks for frontend/icons/logo-source.(png|jpg|jpeg|webp).
Produces, in frontend/icons/:
    logo.png          full-bleed logo, 1024px, transparent-safe
    logo-mark.png     square crop of just the artwork (headers)
    icon-192.png      PWA icon (rounded, brand ground)
    icon-512.png      PWA icon
    maskable-512.png  Android adaptive icon (safe zone honoured)
    apple-180.png     iOS home-screen icon
    favicon-32.png    browser tab
"""
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.abspath(__file__))
ICONS = os.path.join(ROOT, "frontend", "icons")
GROUND = (58, 61, 60)          # charcoal of the source artwork
CANDIDATES = ["logo-source.png", "logo-source.jpg", "logo-source.jpeg",
              "logo-source.webp", "logo.png"]


def find_source(argv):
    if len(argv) > 1:
        return argv[1]
    for c in CANDIDATES:
        p = os.path.join(ICONS, c)
        if os.path.exists(p):
            return p
    return None


def trim(img, bg_tol=26):
    """Crop away the flat background border so the mark fills its box."""
    rgb = img.convert("RGB")
    bg = rgb.getpixel((1, 1))
    w, h = rgb.size
    px = rgb.load()

    def row_is_bg(y):
        return all(sum(abs(a - b) for a, b in zip(px[x, y], bg)) < bg_tol
                   for x in range(0, w, max(1, w // 90)))

    def col_is_bg(x):
        return all(sum(abs(a - b) for a, b in zip(px[x, y], bg)) < bg_tol
                   for y in range(0, h, max(1, h // 90)))

    top = 0
    while top < h - 2 and row_is_bg(top):
        top += 1
    bot = h - 1
    while bot > top + 2 and row_is_bg(bot):
        bot -= 1
    left = 0
    while left < w - 2 and col_is_bg(left):
        left += 1
    right = w - 1
    while right > left + 2 and col_is_bg(right):
        right -= 1
    return img.crop((left, top, right + 1, bot + 1))


def square(img, size, pad_ratio, radius_ratio, ground=GROUND):
    """Centre the mark on a rounded brand-coloured tile."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    r = int(size * radius_ratio)
    if r:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=ground + (255,))
    else:
        d.rectangle([0, 0, size - 1, size - 1], fill=ground + (255,))
    inner = int(size * (1 - 2 * pad_ratio))
    mark = img.copy()
    mark.thumbnail((inner, inner), Image.LANCZOS)
    canvas.paste(mark, ((size - mark.width) // 2, (size - mark.height) // 2),
                 mark if mark.mode == "RGBA" else None)
    return canvas


def main():
    src = find_source(sys.argv)
    if not src or not os.path.exists(src):
        print("No source logo found.\n"
              "  Save the logo as:  frontend/icons/logo-source.png\n"
              "  or run:            python make_icons.py <path-to-logo>")
        return 1
    os.makedirs(ICONS, exist_ok=True)
    raw = Image.open(src).convert("RGBA")
    mark = trim(raw)
    print(f"source {os.path.basename(src)} {raw.size} -> trimmed {mark.size}")

    full = raw.copy()
    full.thumbnail((1024, 1024), Image.LANCZOS)
    full.save(os.path.join(ICONS, "logo.png"))

    m = mark.copy()
    m.thumbnail((512, 512), Image.LANCZOS)
    sq = Image.new("RGBA", (max(m.size),) * 2, GROUND + (255,))
    sq.paste(m, ((sq.width - m.width) // 2, (sq.height - m.height) // 2),
             m if m.mode == "RGBA" else None)
    sq.save(os.path.join(ICONS, "logo-mark.png"))

    out = {
        "icon-192.png": square(mark, 192, 0.10, 0.20),
        "icon-512.png": square(mark, 512, 0.10, 0.20),
        # maskable: Android crops to a circle, keep art inside the 80% safe zone
        "maskable-512.png": square(mark, 512, 0.20, 0.0),
        "apple-180.png": square(mark, 180, 0.09, 0.0),
        "favicon-32.png": square(mark, 32, 0.06, 0.22),
    }
    for name, im in out.items():
        im.save(os.path.join(ICONS, name))
        print("  wrote", name, im.size)
    print("done — hard-refresh the app to see the new icons")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
