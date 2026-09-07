#!/usr/bin/env python3
"""Rasterise certification artwork into the packed bitmaps the thermal printer needs.

    python scripts/build-mark-bitmaps.py "C:/path/to/Label Artwork"

Writes features/pasteuriser-labels/mark-bitmaps.generated.ts.

── Why a build step and not runtime conversion ──────────────────────────────

The artwork never changes between deploys, and the printer is on the factory
LAN behind a route that has to answer fast while an operator is stood at the
bagging point. Rasterising five PNGs per print request to produce identical
bytes every time is work done in the wrong place. It also keeps `lib/core`
pure: core emits the PPLB command from a bitmap it is handed, and never reads
a file (ARCHITECTURE.md §2).

── Why 1-bit threshold and not dithering ────────────────────────────────────

A thermal head prints a dot or it does not. Dithered artwork reads as grey
mush at 203dpi and, on a certification mark, "looks a bit rough" is the same
outcome as "wrong" — the bag cannot be sold. Plain threshold at 50%, checked
by eye at real scale before committing the sizes below.

── Sizes ────────────────────────────────────────────────────────────────────

203dpi = 8 dots/mm. Measured legibility at label scale:

    80 dots (10mm)   Cape Natural and Control Union hold. JAS's CU number and
                     the Rainforest ring text go mushy.
    96 dots (12mm)   everything legible. The floor for any mark with ring or
                     caption text.
    112 dots (14mm)  comfortable.

96 is the default. A mark carrying a registration number is the one thing on
the label a certifier will look at, so it does not get the smallest size that
technically fits.
"""
import os
import sys
import textwrap

try:
    from PIL import Image
except ImportError:
    sys.exit('Pillow is required:  pip install Pillow')

# Source filename -> the LabelMarkKey it satisfies in lib/core/labels.
MARKS = {
    'JAS.png':                    'jas',
    'Control Union.png':          'control_union',
    'Rainforest Alliance.png':    'rainforest_alliance',
    'Fairtrade.png':              'fairtrade',
    'CNTP.png':                   'cape_natural',
}

DEFAULT_SIZE = 96
OUT = os.path.join('features', 'pasteuriser-labels', 'mark-bitmaps.generated.ts')


def flatten(im: 'Image.Image') -> 'Image.Image':
    """RGBA/palette -> white-backed greyscale.

    Transparent pixels MUST become white. Composite onto black by accident and
    every mark prints as a solid rectangle, which on a thermal printer is also
    a good way to cook the head.
    """
    im = im.convert('RGBA')
    bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
    return Image.alpha_composite(bg, im).convert('L')


def to_bits(im_l: 'Image.Image', target: int) -> list[list[int]]:
    """Fit to a square of `target` dots, threshold, return rows of 1=black."""
    w, h = im_l.size
    scale = target / max(w, h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    small = im_l.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new('L', (target, target), 255)
    canvas.paste(small, ((target - nw) // 2, (target - nh) // 2))
    px = canvas.load()
    return [[1 if px[x, y] < 128 else 0 for x in range(target)] for y in range(target)]


def pack(rows: list[list[int]]) -> tuple[bytes, int]:
    """Pack to EPL2 GW bytes. Returns (data, width_in_bytes).

    EPL2 GW is MSB-first and INVERTED: a 0 bit prints black, 1 leaves the label
    blank. Rows pad to a byte boundary with 1s (white), never 0s — pad with
    black and every mark grows a bar down its right edge.
    """
    height = len(rows)
    width = len(rows[0]) if height else 0
    wbytes = (width + 7) // 8
    out = bytearray()
    for y in range(height):
        row = rows[y]
        for b in range(wbytes):
            byte = 0
            for bit in range(8):
                x = b * 8 + bit
                black = row[x] if x < width else 0        # pad white
                if not black:
                    byte |= (0x80 >> bit)                  # 1 = white
            out.append(byte)
    return bytes(out), wbytes


def main() -> None:
    src = sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\Alyssa\Downloads\Label Artwork'
    size = int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_SIZE
    if not os.path.isdir(src):
        sys.exit(f'artwork folder not found: {src}')

    entries = []
    for fname, key in MARKS.items():
        path = os.path.join(src, fname)
        if not os.path.exists(path):
            print(f'  SKIP {fname} (not in folder)')
            continue
        rows = to_bits(flatten(Image.open(path)), size)
        data, wbytes = pack(rows)
        black = sum(sum(r) for r in rows)
        print(f'  {key:20} {size}x{size} dots, {wbytes} bytes/row, '
              f'{len(data)} bytes, {black * 100 // (size * size)}% coverage')
        entries.append((key, fname, size, wbytes, data))

    if not entries:
        sys.exit('no artwork converted — nothing written')

    body = []
    for key, fname, sz, wbytes, data in entries:
        b64 = __import__('base64').b64encode(data).decode()
        chunks = textwrap.wrap(b64, 92)
        lit = '\n'.join(f"      '{c}' +" for c in chunks[:-1]) + f"\n      '{chunks[-1]}',"
        body.append(
            f"  {key}: {{\n"
            f"    key: '{key}',\n"
            f"    source: {fname!r},\n"
            f"    widthDots: {sz},\n"
            f"    heightDots: {sz},\n"
            f"    widthBytes: {wbytes},\n"
            f"    // EPL2 GW payload, base64. MSB-first, a 0 bit prints black.\n"
            f"    dataBase64:\n{lit}\n"
            f"  }},"
        )

    header = f'''/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 *     python scripts/build-mark-bitmaps.py "<artwork folder>" [{DEFAULT_SIZE}]
 *
 * Certification artwork rasterised to 1-bit bitmaps for the Argox CP-2140EX
 * (203dpi, PPLB). Regenerate when a certifier supplies new artwork; never
 * hand-edit, because the bytes are checked against their own dimensions by
 * mark-bitmaps.test.ts and a hand-tweak will fail that rather than silently
 * print something wrong.
 *
 * These replace the redrawn SVGs in marks.ts FOR PRINTING ONLY. The SVGs stay
 * for the on-screen editor and the PDF proof, where scaling is free. Rainforest
 * Alliance and Fairtrade both license their artwork, and these are the files
 * they supplied — which is what marks.ts flagged with officialArtworkRequired.
 *
 * The MarkBitmap type lives in lib/core/labels/bitmap.ts, not here: core owns
 * the printer contract and features import core, never the reverse
 * (ARCHITECTURE.md §2, enforced by eslint.boundaries.mjs).
 */

import type {{ MarkBitmap }} from '@/lib/core/labels/bitmap'

export const MARK_BITMAPS: Record<string, MarkBitmap> = {{
'''
    with open(OUT, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(header)
        fh.write('\n'.join(body))
        fh.write('\n}\n')
    print(f'\nwrote {OUT}')


if __name__ == '__main__':
    main()
