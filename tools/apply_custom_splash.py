#!/usr/bin/env python3
"""
Generate & apply Arrow Clear Western-casual LaunchScreen art, custom Cocos
splashScreen settings, and refreshed iOS/Android AppIcons so Cocos CLI builds
never revert to the dark 'Created with Cocos' splash.
"""
import base64
import json
import os
import shutil
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ART_DIR = os.path.join(ROOT, "assets", "resources", "art")
STORE_ICON = os.path.join(ROOT, "assets", "art", "app-icon-1024.png")
LAUNCH_SRC_DIR = os.path.join(ROOT, "settings", "launch")
IOS_NATIVE_DIR = os.path.join(ROOT, "native", "engine", "ios")
ICONSET_DIR = os.path.join(IOS_NATIVE_DIR, "Images.xcassets", "AppIcon.appiconset")
ANDROID_RES_DIR = os.path.join(ROOT, "native", "engine", "android", "res")
LOGO_PATH = os.path.join(ROOT, "settings", "splash_logo.png")

os.makedirs(LAUNCH_SRC_DIR, exist_ok=True)


def _cover_resize(im: Image.Image, target_w: int, target_h: int) -> Image.Image:
    src_ratio = im.width / im.height
    dst_ratio = target_w / target_h
    if src_ratio > dst_ratio:
        nh = target_h
        nw = int(round(nh * src_ratio))
    else:
        nw = target_w
        nh = int(round(nw / src_ratio))
    resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - target_w) // 2
    top = (nh - target_h) // 2
    return resized.crop((left, top, left + target_w, top + target_h))


def _soft_glow(w: int, h: int, cx: int, cy: int, rx: int, ry: int, rgba) -> Image.Image:
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=rgba)
    return layer.filter(ImageFilter.GaussianBlur(max(rx, ry) // 3))


def generate_launch_and_icon_assets():
    bg_raw = Image.open(os.path.join(ART_DIR, "bg.png")).convert("RGBA")
    logo_raw = Image.open(os.path.join(ART_DIR, "logo.png")).convert("RGBA")
    mascot_raw = Image.open(os.path.join(ART_DIR, "mascot.png")).convert("RGBA")

    # 1. Save splash_logo.png (crisp 3D English ARROW CLEAR logo)
    logo_raw.save(LOGO_PATH, "PNG")

    # 2. Portrait Launch Screen (1242 x 2688)
    PW, PH = 1242, 2688
    port = _cover_resize(bg_raw, PW, PH)
    # Soft sunlit aura behind hero mascot & logo
    port = Image.alpha_composite(
        port, _soft_glow(PW, PH, PW // 2, int(PH * 0.50), 420, 420, (255, 248, 210, 120))
    )
    lw = int(PW * 0.86)
    lh = int(round(lw * logo_raw.height / logo_raw.width))
    logo_port = logo_raw.resize((lw, lh), Image.Resampling.LANCZOS)
    port.alpha_composite(logo_port, ((PW - lw) // 2, int(PH * 0.22)))

    mw = int(PW * 0.56)
    mh = int(round(mw * mascot_raw.height / mascot_raw.width))
    mascot_port = mascot_raw.resize((mw, mh), Image.Resampling.LANCZOS)
    port.alpha_composite(mascot_port, ((PW - mw) // 2, int(PH * 0.44)))

    port_rgb = port.convert("RGB")
    port_rgb.save(os.path.join(LAUNCH_SRC_DIR, "LaunchScreenBackground.png"), optimize=True)
    port_rgb.save(os.path.join(LAUNCH_SRC_DIR, "LaunchScreenBackgroundPortrait.png"), optimize=True)

    # 3. Landscape Launch Screen (2208 x 1242)
    LW, LH = 2208, 1242
    land = _cover_resize(bg_raw, LW, LH)
    land = Image.alpha_composite(
        land, _soft_glow(LW, LH, LW // 2, int(LH * 0.58), 460, 320, (255, 248, 210, 110))
    )
    llw = 960
    llh = int(round(llw * logo_raw.height / logo_raw.width))
    land.alpha_composite(
        logo_raw.resize((llw, llh), Image.Resampling.LANCZOS),
        ((LW - llw) // 2, 130),
    )
    lmw = 500
    lmh = int(round(lmw * mascot_raw.height / mascot_raw.width))
    land.alpha_composite(
        mascot_raw.resize((lmw, lmh), Image.Resampling.LANCZOS),
        ((LW - lmw) // 2, 540),
    )
    land.convert("RGB").save(
        os.path.join(LAUNCH_SRC_DIR, "LaunchScreenBackgroundLandscape.png"), optimize=True
    )

    # 4. Sync iOS AppIcon.appiconset & Android mipmap icons from assets/art/app-icon-1024.png
    if os.path.isfile(STORE_ICON):
        icon_rgb = Image.open(STORE_ICON).convert("RGB")
        if os.path.isdir(ICONSET_DIR):
            for sz in (29, 40, 57, 58, 60, 76, 80, 87, 114, 120, 152, 167, 180, 1024):
                dst = os.path.join(ICONSET_DIR, f"{sz}.png")
                icon_rgb.resize((sz, sz), Image.Resampling.LANCZOS).save(dst, "PNG")
        if os.path.isdir(ANDROID_RES_DIR):
            for bucket, sz in (
                ("mipmap-mdpi", 48),
                ("mipmap-hdpi", 72),
                ("mipmap-xhdpi", 96),
                ("mipmap-xxhdpi", 144),
                ("mipmap-xxxhdpi", 192),
            ):
                bdir = os.path.join(ANDROID_RES_DIR, bucket)
                if os.path.isdir(bdir):
                    icon_rgb.resize((sz, sz), Image.Resampling.LANCZOS).save(
                        os.path.join(bdir, "ic_launcher.png"), "PNG"
                    )
    print("[splash] generated Arrow Clear LaunchScreen backgrounds & synced iOS/Android icons")


def restore_ios_launch_images():
    if not os.path.isdir(LAUNCH_SRC_DIR) or not os.path.isdir(IOS_NATIVE_DIR):
        return
    for name in (
        "LaunchScreenBackground.png",
        "LaunchScreenBackgroundPortrait.png",
        "LaunchScreenBackgroundLandscape.png",
    ):
        src = os.path.join(LAUNCH_SRC_DIR, name)
        dst = os.path.join(IOS_NATIVE_DIR, name)
        if os.path.isfile(src):
            shutil.copy2(src, dst)
            print(f"[splash] restored {os.path.relpath(dst, ROOT)}")


def patch_settings_json(settings_path: str, logo_data_uri: str, total_time: int):
    if not os.path.isfile(settings_path):
        return
    with open(settings_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    data["splashScreen"] = {
        "displayRatio": 0.56,
        "totalTime": total_time,
        "watermarkLocation": "default",
        "autoFit": True,
        "logo": {
            "type": "custom",
            "base64": logo_data_uri,
        },
        "background": {
            "type": "color",
            "color": {
                "x": 0.165,
                "y": 0.537,
                "z": 0.957,
                "w": 1.0,
            },
        },
    }
    with open(settings_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)
    print(f"[splash] patched {os.path.relpath(settings_path, ROOT)} (totalTime={total_time})")


def main():
    generate_launch_and_icon_assets()
    restore_ios_launch_images()
    with open(LOGO_PATH, "rb") as f:
        logo_b64 = base64.b64encode(f.read()).decode("ascii")
    logo_uri = f"data:image/png;base64,{logo_b64}"

    patch_settings_json(os.path.join(ROOT, "build", "ios", "data", "src", "settings.json"), logo_uri, 0)
    patch_settings_json(os.path.join(ROOT, "build", "web-mobile", "src", "settings.json"), logo_uri, 900)
    patch_settings_json(os.path.join(ROOT, "build", "android", "data", "src", "settings.json"), logo_uri, 600)
    patch_settings_json(os.path.join(ROOT, "build", "android", "assets", "src", "settings.json"), logo_uri, 600)


if __name__ == "__main__":
    main()
