#!/usr/bin/env python3
"""Subsets ZCOOL KuaiLe to the glyphs actually used by the game.

Keeps the shipped font small (important for the WeChat 4 MB main package) while
still covering every UI string plus digits/punctuation. Re-run after adding new
copy and rebuild the web + Cocos resources.
"""
import glob
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "assets/art/fonts/ZCOOLKuaiLe-full.ttf")
OUT_WEB = os.path.join(ROOT, "web/fonts/ZCOOLKuaiLe-Regular.ttf")
OUT_GAME = os.path.join(ROOT, "assets/resources/fonts/ZCOOLKuaiLe-Regular.ttf")

if not os.path.exists(SOURCE):
    # first run: promote the shipped full font
    cur = os.path.join(ROOT, "assets/resources/fonts/ZCOOLKuaiLe-Regular.ttf")
    if not os.path.exists(cur):
        sys.exit("missing full font")
    os.rename(cur, SOURCE)

text = set("0123456789:+-×·%!?.,，。！？、（）()［］[]/\\|@#&* ")
files = []
files += glob.glob(os.path.join(ROOT, "web/src/*.ts"))
files += glob.glob(os.path.join(ROOT, "web/index.html"))
files += glob.glob(os.path.join(ROOT, "assets/scripts/**/*.ts"), recursive=True)

for path in files:
    with open(path, encoding="utf-8") as f:
        src = f.read()
    text.update(ch for ch in src if ord(ch) > 0x2E80 or ch in "·×—…")

# extra marketing copy that may be added later
text.update("全新关卡每日挑战排行好友分享免费领取奖励敬请期待版本更新更多精彩")

chars = "".join(sorted(text))
tmp = "/tmp/arrowclear-charset.txt"
with open(tmp, "w", encoding="utf-8") as f:
    f.write(chars)
print(f"subsetting {len(chars)} chars")

for out in (OUT_WEB, OUT_GAME):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    subprocess.run(
        [
            "/tmp/fontenv/bin/pyftsubset",
            SOURCE,
            f"--text-file={tmp}",
            f"--output-file={out}",
            "--layout-features=*",
            "--glyph-names",
            "--symbol-cmap",
            "--legacy-cmap",
            "--notdef-glyph",
            "--notdef-outline",
            "--recommended-glyphs",
            "--name-IDs=*",
            "--name-legacy",
            "--name-languages=*",
            "--drop-tables+=DSIG",
        ],
        check=True,
    )
    print(out, os.path.getsize(out) // 1024, "KB")
