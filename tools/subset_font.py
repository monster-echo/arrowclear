#!/usr/bin/env python3
"""Subsets ZCOOL KuaiLe to the glyphs actually used by the Cocos game.

Keeps the shipped font small (important for the WeChat 4 MB main package) while
covering every UI string plus digits/punctuation. Re-run after adding new copy.
"""
import glob
import os
import sys
from fontTools.subset import main as subset_main

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "assets/art/fonts/ZCOOLKuaiLe-full.ttf")
OUT_GAME = os.path.join(ROOT, "assets/resources/fonts/ZCOOLKuaiLe-Regular.ttf")

if not os.path.exists(SOURCE):
    if not os.path.exists(OUT_GAME):
        sys.exit("missing full font")
    os.rename(OUT_GAME, SOURCE)

text = set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz:+-×·%!?.,，。！？、（）()［］[]/\\|@#&*★⚔⚡✿∞‹›−✓ ")
files = glob.glob(os.path.join(ROOT, "assets/scripts/**/*.ts"), recursive=True)

for path in files:
    with open(path, encoding="utf-8") as f:
        src = f.read()
    text.update(ch for ch in src if ord(ch) > 0x2E80 or ch in "·×—…★⚔⚡✿∞‹›−✓")

# Extra casual UI & marketing copy
text.update("全新关卡每日挑战排行好友分享免费领取奖励敬请期待版本更新更多精彩阳光草甸冰雪城堡艺术画廊环游世界皇家王座千层箭阵彩蛋挑战世界进度")

chars = "".join(sorted(text))
tmp = "/tmp/arrowclear-charset.txt"
with open(tmp, "w", encoding="utf-8") as f:
    f.write(chars)
print(f"subsetting {len(chars)} chars")

os.makedirs(os.path.dirname(OUT_GAME), exist_ok=True)
subset_main([
    SOURCE,
    f"--text-file={tmp}",
    f"--output-file={OUT_GAME}",
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
])
print(OUT_GAME, os.path.getsize(OUT_GAME) // 1024, "KB")
