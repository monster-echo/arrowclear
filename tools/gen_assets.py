#!/usr/bin/env python3
"""Generates the background, store icon and sound effects (no external assets)."""
import math, os, random, shutil, struct, subprocess, wave
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "assets/resources/art")
AUD = os.path.join(ROOT, "assets/resources/audio")
os.makedirs(AUD, exist_ok=True)
random.seed(7)

# ------------------------------------------------------------------ background
W, H = 720, 1560
bg = Image.new("RGB", (W, H))
top = (220, 245, 251)
bot = (176, 226, 240)
for y in range(H):
    t = y / (H - 1)
    c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
    ImageDraw.Draw(bg).line([(0, y), (W, y)], fill=c)

# soft white glow at the top
glow = Image.new("L", (W, H), 0)
gd = ImageDraw.Draw(glow)
for i in range(28):
    r = int(W * (0.95 - i * 0.03))
    gd.ellipse([W // 2 - r, -int(H * 0.28) - r // 2, W // 2 + r, -int(H * 0.28) + r // 2], fill=6)
glow = glow.filter(ImageFilter.GaussianBlur(40))
bg = Image.composite(Image.new("RGB", (W, H), (255, 255, 255)), bg, glow.point(lambda v: min(255, v * 3)))

# arrow pattern
pat = Image.new("RGBA", (W, H), (0, 0, 0, 0))
pd = ImageDraw.Draw(pat)
COL = (127, 182, 201)

def arrow(draw, cx, cy, up=True, scale=1.0, alpha=38):
    s = 34 * scale
    h = 60 * scale
    col = COL + (alpha,)
    if up:
        draw.rounded_rectangle([cx - s * 0.22, cy - h * 0.1, cx + s * 0.22, cy + h * 0.42], radius=s * 0.22, fill=col)
        draw.polygon([(cx, cy - h * 0.52), (cx + s * 0.62, cy - h * 0.06), (cx - s * 0.62, cy - h * 0.06)], fill=col)
    else:
        draw.rounded_rectangle([cx - s * 0.22, cy - h * 0.42, cx + s * 0.22, cy + h * 0.1], radius=s * 0.22, fill=col)
        draw.polygon([(cx, cy + h * 0.52), (cx + s * 0.62, cy + h * 0.06), (cx - s * 0.62, cy + h * 0.06)], fill=col)

for gy in range(-1, H // 168 + 2):
    for gx in range(-1, W // 168 + 2):
        ox, oy = gx * 168, gy * 168
        arrow(pd, ox + 42, oy + 54, True, 1.0, 36)
        arrow(pd, ox + 128, oy + 120, False, 1.0, 36)
        arrow(pd, ox + 100, oy + 22, True, 0.62, 22)
        arrow(pd, ox + 20, oy + 144, False, 0.62, 22)

bg = Image.alpha_composite(bg.convert("RGBA"), pat).convert("RGB")
bg.save(os.path.join(ART, "bg.png"), optimize=True)
print("bg.png", bg.size)

# ------------------------------------------------------------------ app icon
S = 1024
icon = Image.new("RGB", (S, S))
d = ImageDraw.Draw(icon)
for y in range(S):
    t = y / (S - 1)
    c = (int(110 + (34 - 110) * t), int(208 + (140 - 208) * t), int(248 + (222 - 248) * t))
    d.line([(0, y), (S, y)], fill=c)

# soft cream disc behind the mascot
disc = Image.new("RGBA", (S, S), (0, 0, 0, 0))
dd = ImageDraw.Draw(disc)
r = int(S * 0.365)
dd.ellipse([S // 2 - r, S // 2 - r, S // 2 + r, S // 2 + r], fill=(255, 248, 231, 255))
shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.ellipse([S // 2 - r, S // 2 - r + 26, S // 2 + r, S // 2 + r + 26], fill=(10, 60, 90, 80))
shadow = shadow.filter(ImageFilter.GaussianBlur(26))
icon = Image.alpha_composite(icon.convert("RGBA"), shadow)
icon = Image.alpha_composite(icon, disc)

# sparkles around
sd = ImageDraw.Draw(icon)
for (x, y, rr, col) in [(190, 230, 34, (255, 214, 90)), (836, 300, 26, (255, 214, 90)),
                        (196, 800, 22, (255, 255, 255)), (820, 786, 30, (255, 214, 90))]:
    sd.polygon([(x, y - rr), (x + rr * 0.32, y - rr * 0.32), (x + rr, y), (x + rr * 0.32, y + rr * 0.32),
                (x, y + rr), (x - rr * 0.32, y + rr * 0.32), (x - rr, y), (x - rr * 0.32, y - rr * 0.32)], fill=col)

mascot = Image.open(os.path.join(ART, "mascot.png")).convert("RGBA")
mw = int(S * 0.74)
mh = int(mw * mascot.height / mascot.width)
mascot = mascot.resize((mw, mh), Image.LANCZOS)
icon.alpha_composite(mascot, (S // 2 - mw // 2, S // 2 - mh // 2 - 8))
icon.convert("RGB").save(os.path.join(ROOT, "assets/art/app-icon-1024.png"), optimize=True)
print("app-icon ok")

# ------------------------------------------------------------------ audio
SR = 44100

def env(i, n, attack=0.005, decay=1.0):
    t = i / SR
    a = min(1.0, t / attack) if attack > 0 else 1.0
    return a * math.exp(-decay * t)

def sweep(f0, f1, dur, kind="sine", vol=0.5, decay=6.0):
    n = int(SR * dur)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / n
        f = f0 + (f1 - f0) * t
        phase += 2 * math.pi * f / SR
        if kind == "sine":
            s = math.sin(phase)
        elif kind == "square":
            s = 1.0 if math.sin(phase) > 0 else -1.0
        else:
            s = 2 * ((phase / (2 * math.pi)) % 1) - 1
        out.append(s * env(i, n, 0.004, decay * dur) * vol)
    return out

def mix(*parts):
    n = max(len(p) for p in parts)
    out = [0.0] * n
    for p in parts:
        for i, v in enumerate(p):
            out[i] += v
    return out

def pad(track, dur):
    n = int(SR * dur)
    return track + [0.0] * max(0, n - len(track))

def noise(dur, vol=0.2, cutoff=0.4):
    n = int(SR * dur)
    out = []
    last = 0.0
    for i in range(n):
        last = last * (1 - cutoff) + random.uniform(-1, 1) * cutoff
        out.append(last * env(i, n, 0.002, 9) * vol)
    return out

def note(freq, dur, vol=0.35, kind="triangle", decay=4.0):
    n = int(SR * dur)
    out = []
    for i in range(n):
        ph = 2 * math.pi * freq * i / SR
        if kind == "triangle":
            s = 2 * abs(2 * ((ph / (2 * math.pi)) % 1) - 1) - 1
        elif kind == "square":
            s = 1.0 if math.sin(ph) > 0 else -1.0
        else:
            s = math.sin(ph)
        out.append(s * env(i, n, 0.006, decay) * vol)
    return out

sounds = {}
sounds["pop"] = pad(mix(sweep(520, 1080, 0.16, "sine", 0.55, 7), noise(0.1, 0.1, 0.5)), 0.2)
sounds["thud"] = pad(mix(sweep(160, 62, 0.22, "sine", 0.7, 6), noise(0.12, 0.16, 0.2)), 0.26)
sounds["click"] = pad(sweep(760, 900, 0.06, "sine", 0.35, 10), 0.08)
sounds["coin"] = pad(mix(note(1046, 0.09, 0.3, "square", 9), [0.0] * int(SR * 0.05) + note(1568, 0.12, 0.26, "square", 8)), 0.22)
win = []
for i, f in enumerate([523, 659, 784, 1046]):
    win.append([0.0] * int(SR * 0.11 * i) + note(f, 0.42, 0.32, "triangle", 3.4))
win.append([0.0] * int(SR * 0.46) + note(1568, 0.6, 0.2, "sine", 2.6))
sounds["win"] = pad(mix(*win), 1.2)
lose = []
for i, f in enumerate([392, 330, 262]):
    lose.append([0.0] * int(SR * 0.14 * i) + note(f, 0.34, 0.28, "sawtooth", 4.2))
sounds["lose"] = pad(mix(*lose), 0.8)

for name, data in sounds.items():
    peak = max(1e-6, max(abs(v) for v in data))
    scale = 0.86 / peak
    path = os.path.join(AUD, f"{name}.wav")
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, v * scale)) * 32767)) for v in data))
    print("wav", name, len(data) / SR)

# Cocos + 微信小游戏对 mp3 兼容性最好；有 ffmpeg 就转 mp3 并删掉 wav
if shutil.which("ffmpeg"):
    for name in list(sounds):
        wav = os.path.join(AUD, f"{name}.wav")
        mp3 = os.path.join(AUD, f"{name}.mp3")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav,
                        "-codec:a", "libmp3lame", "-b:a", "96k", "-ac", "1", mp3], check=True)
        os.remove(wav)
        print("mp3", name, os.path.getsize(mp3) // 1024, "KB")
else:
    print("!! ffmpeg not found, keeping wav")
