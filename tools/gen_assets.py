#!/usr/bin/env python3
"""Generates Western-casual sunlit sky background, 1024 store icon, and sound effects."""
import math, os, random, shutil, struct, subprocess, wave
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "assets/resources/art")
AUD = os.path.join(ROOT, "assets/resources/audio")
os.makedirs(ART, exist_ok=True)
os.makedirs(AUD, exist_ok=True)
random.seed(7)

# ------------------------------------------------------------------ Western Casual Sky Background (720x1560)
W, H = 720, 1560
bg = Image.new("RGBA", (W, H))
draw = ImageDraw.Draw(bg)

# Rich sunlit sky gradient: Royal Blue -> Bright Sky -> Soft Aqua Horizon
stops = [
    (0.00, (36, 126, 232)),
    (0.35, (64, 166, 250)),
    (0.72, (118, 206, 255)),
    (1.00, (162, 228, 255)),
]

def lerp_color(t):
    for i in range(len(stops) - 1):
        t0, c0 = stops[i]
        t1, c1 = stops[i + 1]
        if t <= t1:
            k = (t - t0) / max(1e-6, t1 - t0)
            return tuple(int(c0[j] + (c1[j] - c0[j]) * k) for j in range(3))
    return stops[-1][1]

for y in range(H):
    c = lerp_color(y / (H - 1))
    draw.line([(0, y), (W, y)], fill=c + (255,))

# Subtle sunlit radial rays from upper-center (classic Royal Match / Toon Blast sky feel)
rays = Image.new("RGBA", (W, H), (0, 0, 0, 0))
rd = ImageDraw.Draw(rays)
cx, cy = W // 2, int(H * 0.30)
ray_count = 16
R = int(math.hypot(W, H) * 1.15)
for i in range(ray_count):
    a0 = (i / ray_count) * math.tau
    a1 = a0 + (math.tau / (ray_count * 2.35))
    pts = [
        (cx, cy),
        (cx + math.cos(a0) * R, cy + math.sin(a0) * R),
        (cx + math.cos(a1) * R, cy + math.sin(a1) * R),
    ]
    rd.polygon(pts, fill=(255, 255, 255, 20))
rays = rays.filter(ImageFilter.GaussianBlur(10))
bg = Image.alpha_composite(bg, rays)

# Warm sunlit radial glow at hero center
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
for i in range(22):
    rr = int(W * (0.86 - i * 0.036))
    gd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(255, 253, 232, 7))
glow = glow.filter(ImageFilter.GaussianBlur(36))
bg = Image.alpha_composite(bg, glow)

# Crisp low-opacity arrow & diamond sparkle watermark
pat = Image.new("RGBA", (W, H), (0, 0, 0, 0))
pd = ImageDraw.Draw(pat)

def draw_arrow_motif(d, x, y, up=True, scale=1.0, alpha=24):
    s = 30 * scale
    h = 54 * scale
    col = (255, 255, 255, alpha)
    if up:
        d.rounded_rectangle([x - s * 0.22, y - h * 0.08, x + s * 0.22, y + h * 0.42], radius=s * 0.22, fill=col)
        d.polygon([(x, y - h * 0.50), (x + s * 0.62, y - h * 0.04), (x - s * 0.62, y - h * 0.04)], fill=col)
    else:
        d.rounded_rectangle([x - s * 0.22, y - h * 0.42, x + s * 0.22, y + h * 0.08], radius=s * 0.22, fill=col)
        d.polygon([(x, y + h * 0.50), (x + s * 0.62, y + h * 0.04), (x - s * 0.62, y + h * 0.04)], fill=col)

def draw_star4(d, x, y, r, alpha=40):
    col = (255, 248, 198, alpha)
    d.polygon([
        (x, y - r), (x + r * 0.28, y - r * 0.28),
        (x + r, y), (x + r * 0.28, y + r * 0.28),
        (x, y + r), (x - r * 0.28, y + r * 0.28),
        (x - r, y), (x - r * 0.28, y - r * 0.28),
    ], fill=col)

for gy in range(-1, H // 180 + 2):
    for gx in range(-1, W // 180 + 2):
        ox, oy = gx * 180, gy * 180
        draw_arrow_motif(pd, ox + 45, oy + 62, True, 0.95, 20)
        draw_arrow_motif(pd, ox + 135, oy + 132, False, 0.95, 20)
        draw_star4(pd, ox + 128, oy + 42, 10, 34)
        draw_star4(pd, ox + 34, oy + 148, 7, 26)

bg = Image.alpha_composite(bg, pat)

# Soft fluffy cloud hills at the very bottom for Western casual storybook polish
clouds = Image.new("RGBA", (W, H), (0, 0, 0, 0))
cd = ImageDraw.Draw(clouds)
cloud_circles = [
    (-20, H - 18, 130), (120, H + 12, 140), (280, H - 6, 150),
    (450, H + 8, 145), (610, H - 10, 140), (740, H + 4, 130),
]
for (x, y, rr) in cloud_circles:
    cd.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(255, 255, 255, 68))
clouds = clouds.filter(ImageFilter.GaussianBlur(14))
bg = Image.alpha_composite(bg, clouds)

bg.convert("RGB").save(os.path.join(ART, "bg.png"), optimize=True)
print("bg.png", bg.size)

# ------------------------------------------------------------------ Western Casual App Icon (1024x1024)
S = 1024
icon = Image.new("RGBA", (S, S))
d = ImageDraw.Draw(icon)
for y in range(S):
    t = y / (S - 1)
    c = (
        int(34 + (20 - 34) * t),
        int(134 + (82 - 134) * t),
        int(248 + (192 - 248) * t),
    )
    d.line([(0, y), (S, y)], fill=c + (255,))

# Starburst rays
irays = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ird = ImageDraw.Draw(irays)
icx, icy = S // 2, S // 2
for i in range(14):
    a0 = (i / 14) * math.tau
    a1 = a0 + (math.tau / 32)
    ird.polygon([
        (icx, icy),
        (icx + math.cos(a0) * S, icy + math.sin(a0) * S),
        (icx + math.cos(a1) * S, icy + math.sin(a1) * S),
    ], fill=(255, 255, 255, 26))
irays = irays.filter(ImageFilter.GaussianBlur(6))
icon = Image.alpha_composite(icon, irays)

# Golden-rimmed cream medallion
med = Image.new("RGBA", (S, S), (0, 0, 0, 0))
md = ImageDraw.Draw(med)
r_out = int(S * 0.405)
r_in = int(S * 0.365)
shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.ellipse([icx - r_out, icy - r_out + 24, icx + r_out, icy + r_out + 24], fill=(8, 32, 72, 110))
shadow = shadow.filter(ImageFilter.GaussianBlur(24))
icon = Image.alpha_composite(icon, shadow)

md.ellipse([icx - r_out, icy - r_out, icx + r_out, icy + r_out], fill=(255, 198, 42, 255))
md.ellipse([icx - r_in, icy - r_in, icx + r_in, icy + r_in], fill=(255, 251, 238, 255))
icon = Image.alpha_composite(icon, med)

# Sparkles around medallion
sd = ImageDraw.Draw(icon)
for (x, y, rr, col) in [
    (168, 200, 42, (255, 230, 96, 255)),
    (858, 240, 34, (255, 230, 96, 255)),
    (176, 822, 26, (255, 255, 255, 240)),
    (846, 804, 36, (255, 230, 96, 255)),
]:
    sd.polygon([
        (x, y - rr), (x + rr * 0.3, y - rr * 0.3), (x + rr, y), (x + rr * 0.3, y + rr * 0.3),
        (x, y + rr), (x - rr * 0.3, y + rr * 0.3), (x - rr, y), (x - rr * 0.3, y - rr * 0.3),
    ], fill=col)

mascot_path = os.path.join(ART, "mascot.png")
if os.path.exists(mascot_path):
    mascot = Image.open(mascot_path).convert("RGBA")
    mw = int(S * 0.78)
    mh = int(mw * mascot.height / mascot.width)
    mascot = mascot.resize((mw, mh), Image.LANCZOS)
    icon.alpha_composite(mascot, (icx - mw // 2, icy - mh // 2 - 4))

os.makedirs(os.path.join(ROOT, "assets/art"), exist_ok=True)
icon.convert("RGB").save(os.path.join(ROOT, "assets/art/app-icon-1024.png"), optimize=True)
print("app-icon-1024.png ok")

# ------------------------------------------------------------------ Audio (only regenerate if missing)
SR = 44100
needed_audio = ["pop", "thud", "click", "coin", "win", "lose"]
if all(os.path.exists(os.path.join(AUD, f"{n}.mp3")) for n in needed_audio):
    print("audio mp3s already present, keeping existing")
else:
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
            s = math.sin(phase) if kind == "sine" else (1.0 if math.sin(phase) > 0 else -1.0)
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

    sounds = {
        "pop": pad(mix(sweep(520, 1080, 0.16, "sine", 0.55, 7), noise(0.1, 0.1, 0.5)), 0.2),
        "thud": pad(mix(sweep(160, 62, 0.22, "sine", 0.7, 6), noise(0.12, 0.16, 0.2)), 0.26),
        "click": pad(sweep(760, 900, 0.06, "sine", 0.35, 10), 0.08),
        "coin": pad(mix(note(1046, 0.09, 0.3, "square", 9), [0.0] * int(SR * 0.05) + note(1568, 0.12, 0.26, "square", 8)), 0.22),
        "win": pad(mix(*([([0.0] * int(SR * 0.11 * i) + note(f, 0.42, 0.32, "triangle", 3.4)) for i, f in enumerate([523, 659, 784, 1046])] + [[0.0] * int(SR * 0.46) + note(1568, 0.6, 0.2, "sine", 2.6)])), 1.2),
        "lose": pad(mix(*[[0.0] * int(SR * 0.14 * i) + note(f, 0.34, 0.28, "sawtooth", 4.2) for i, f in enumerate([392, 330, 262])]), 0.8),
    }

    for name, data in sounds.items():
        peak = max(1e-6, max(abs(v) for v in data))
        scale = 0.86 / peak
        wav = os.path.join(AUD, f"{name}.wav")
        with wave.open(wav, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(SR)
            wf.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, v * scale)) * 32767)) for v in data))
        if shutil.which("ffmpeg"):
            mp3 = os.path.join(AUD, f"{name}.mp3")
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav,
                            "-codec:a", "libmp3lame", "-b:a", "96k", "-ac", "1", mp3], check=True)
            os.remove(wav)
            print("mp3", name, os.path.getsize(mp3) // 1024, "KB")
