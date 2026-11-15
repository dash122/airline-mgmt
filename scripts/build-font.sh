#!/usr/bin/env bash
# Regenerates the subset Chinese font after text changes: needs `pip install fonttools brotli` and the full
# NotoSansTC-Variable.ttf (from https://github.com/notofonts/noto-cjk) in src/assets/fonts/. The unicode-range in
# src/ui/style.css must list the same characters; anything missing there simply loads from the full font.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY' > /tmp/waypoint-chars.txt
import glob
chars = set(chr(c) for c in range(0x20, 0x7f))
for f in glob.glob('src/**/*.*', recursive=True) + glob.glob('scripts/*.json') + glob.glob('scripts/*.mjs') + ['index.html', 'README.md']:
    if f.endswith(('.ttf', '.woff2')) or 'geo.json' in f: continue
    try: chars |= set(open(f, encoding='utf-8').read())
    except Exception: pass
print(''.join(sorted(c for c in chars if ord(c) >= 0x20)), end='')
PY
python3 -m fontTools.subset src/assets/fonts/NotoSansTC-Variable.ttf --text-file=/tmp/waypoint-chars.txt --flavor=woff2 --layout-features='*' --output-file=src/assets/fonts/NotoSansTC-Variable.subset.woff2
# Then set the subset face's unicode-range in style.css to the font's own cmap (fontTools TTFont(...).getBestCmap()), so a character the font lacks is not looked up in it.
