#!/usr/bin/env python3
"""Builds assets/scenes/main.scene (Cocos Creator 3.8 serialization format).

The scene is intentionally tiny: Canvas + Camera + a single GameRoot node.
Everything else is constructed at runtime by GameRoot.ts, which keeps the
serialized scene stable and easy to regenerate.
"""
import json
import os
import random
import string

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCENE_DIR = os.path.join(ROOT, "assets", "scenes")
SCENE_UUID = "3d2b8c10-6f4a-4e59-8b71-2c9a5d0e4f86"
SCRIPT_UUID = "0f7c1a2e-5b3d-4c8a-9e21-7d6b4a90c135"

random.seed(42)
ALPHABET = string.ascii_letters + string.digits + "+/"


def rid() -> str:
    return "".join(random.choice(ALPHABET) for _ in range(22))


def vec3(x, y, z=0):
    return {"__type__": "cc.Vec3", "x": x, "y": y, "z": z}


def quat():
    return {"__type__": "cc.Quat", "x": 0, "y": 0, "z": 0, "w": 1}


def node(name, parent, children, components, x, y, layer):
    return {
        "__type__": "cc.Node",
        "_name": name,
        "_objFlags": 0,
        "__editorExtras__": {},
        "_parent": {"__id__": parent},
        "_children": [{"__id__": c} for c in children],
        "_active": True,
        "_components": [{"__id__": c} for c in components],
        "_prefab": None,
        "_lpos": vec3(x, y),
        "_lrot": quat(),
        "_lscale": vec3(1, 1, 1),
        "_mobility": 0,
        "_layer": layer,
        "_euler": vec3(0, 0, 0),
        "_id": rid(),
    }


def uiopacity(node_id):
    return {
        "__type__": "cc.UIOpacity",
        "_name": "",
        "_objFlags": 0,
        "__editorExtras__": {},
        "node": {"__id__": node_id},
        "_enabled": True,
        "__prefab": None,
        "_opacity": 255,
        "_id": rid(),
    }


UI_2D = 1 << 25
DEFAULT = 1 << 30

scene = [
    {
        "__type__": "cc.SceneAsset",
        "_name": "main",
        "_objFlags": 0,
        "__editorExtras__": {},
        "_native": "",
        "scene": {"__id__": 1},
    },
    {
        "__type__": "cc.Scene",
        "_name": "main",
        "_objFlags": 0,
        "__editorExtras__": {},
        "_parent": None,
        "_children": [{"__id__": 2}],
        "_active": True,
        "_components": [],
        "_prefab": None,
        "_lpos": vec3(0, 0),
        "_lrot": quat(),
        "_lscale": vec3(1, 1, 1),
        "_mobility": 0,
        "_layer": DEFAULT,
        "_euler": vec3(0, 0, 0),
        "autoReleaseAssets": False,
        "_globals": {"__id__": 10},
        "_id": SCENE_UUID,
    },
    # 2 - Canvas
    node("Canvas", 1, [3, 5], [8, 9], 360, 640, UI_2D),
    # 3 - Camera
    node("Camera", 2, [], [4], 0, 0, DEFAULT),
    # 4 - cc.Camera
    {
        "__type__": "cc.Camera",
        "_name": "",
        "_objFlags": 0,
        "__editorExtras__": {},
        "node": {"__id__": 3},
        "_enabled": True,
        "__prefab": None,
        "_projection": 1,
        "_priority": 0,
        "_fov": 45,
        "_fovAxis": 0,
        "_orthoHeight": 640,
        "_near": 1,
        "_far": 2000,
        "_color": {"__type__": "cc.Color", "r": 207, "g": 239, "b": 247, "a": 255},
        "_depth": 1,
        "_stencil": 0,
        "_clearFlags": 7,
        "_rect": {"__type__": "cc.Rect", "x": 0, "y": 0, "width": 1, "height": 1},
        "_aperture": 19,
        "_shutter": 7,
        "_iso": 0,
        "_screenScale": 1,
        "_visibility": 41943040,
        "_targetTexture": None,
        "_postProcess": None,
        "_usePostProcess": False,
        "_cameraType": -1,
        "_trackingType": 0,
        "_id": rid(),
    },
    # 5 - GameRoot
    node("GameRoot", 2, [], [6, 7], 0, 0, UI_2D),
    # 6 - GameRoot.ts component
    {
        "__type__": SCRIPT_UUID,
        "_name": "",
        "_objFlags": 0,
        "__editorExtras__": {},
        "node": {"__id__": 5},
        "_enabled": True,
        "__prefab": None,
        "_id": rid(),
    },
    # 7 - GameRoot UITransform
    {
        "__type__": "cc.UITransform",
        "_name": "",
        "_objFlags": 0,
        "__editorExtras__": {},
        "node": {"__id__": 5},
        "_enabled": True,
        "__prefab": None,
        "_contentSize": {"__type__": "cc.Size", "width": 720, "height": 1280},
        "_anchorPoint": {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5},
        "_id": rid(),
    },
    # 8 - Canvas UITransform
    {
        "__type__": "cc.UITransform",
        "_name": "",
        "_objFlags": 0,
        "__editorExtras__": {},
        "node": {"__id__": 2},
        "_enabled": True,
        "__prefab": None,
        "_contentSize": {"__type__": "cc.Size", "width": 720, "height": 1280},
        "_anchorPoint": {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5},
        "_id": rid(),
    },
    # 9 - Canvas component
    {
        "__type__": "cc.Canvas",
        "_name": "",
        "_objFlags": 0,
        "__editorExtras__": {},
        "node": {"__id__": 2},
        "_enabled": True,
        "__prefab": None,
        "_cameraComponent": {"__id__": 4},
        "_alignCanvasWithScreen": True,
        "_id": rid(),
    },
    # 10 - SceneGlobals (defaults are fine for a 2D game)
    {"__type__": "cc.SceneGlobals"},
]

os.makedirs(SCENE_DIR, exist_ok=True)
with open(os.path.join(SCENE_DIR, "main.scene"), "w", encoding="utf-8") as f:
    json.dump(scene, f, ensure_ascii=False, indent=2)
    f.write("\n")

with open(os.path.join(SCENE_DIR, "main.scene.meta"), "w", encoding="utf-8") as f:
    json.dump(
        {
            "ver": "1.1.50",
            "importer": "scene",
            "imported": True,
            "uuid": SCENE_UUID,
            "files": [".json"],
            "subMetas": {},
            "userData": {},
        },
        f,
        indent=2,
    )
    f.write("\n")

with open(
    os.path.join(ROOT, "assets", "scripts", "cocos", "GameRoot.ts.meta"), "w", encoding="utf-8"
) as f:
    json.dump(
        {
            "ver": "4.0.24",
            "importer": "typescript",
            "imported": True,
            "uuid": SCRIPT_UUID,
            "files": [],
            "subMetas": {},
            "userData": {},
        },
        f,
        indent=2,
    )
    f.write("\n")

with open(os.path.join(ROOT, "project.json"), "w", encoding="utf-8") as f:
    json.dump({"engine": "3.8.6"}, f, indent=2)
    f.write("\n")

# ---- structural validation -------------------------------------------------
ids = {i for i in range(len(scene))}

def walk(obj, top=False):
    if isinstance(obj, dict):
        if "__id__" in obj:
            assert obj["__id__"] in ids, f"dangling reference {obj['__id__']}"
        for k, v in obj.items():
            walk(v)
    elif isinstance(obj, list):
        for v in obj:
            walk(v)

walk(scene)
assert scene[1]["_globals"]["__id__"] == 10
assert scene[9]["_cameraComponent"]["__id__"] == 4
print(f"wrote scene with {len(scene)} objects, uuid={SCENE_UUID}")