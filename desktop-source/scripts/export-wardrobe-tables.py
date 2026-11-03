#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把 Comfyui-Anima-Wardrobe-V4 的「语义知识表」导出为前端可读 JSON。

为什么单独导出而不是手抄：
  anima_v4_nsfw.py（16 类判定表）、anima_v4_overrides.py（34 条降档 + 48 条抬档）、
  anima_v4_outfit_style.py（16 种风格的亲和/铁律/颜色）与 anima_v4_link.py（三张联动表）
  合计上千条人工维护的语义知识。手抄一次就会和插件漂移，而漂移的表现是
  「低档抽出越界标签」或「合法标签被 repair 删掉」—— 很难从现象倒推。

用法（本机 npm run 不可用，直接调 python）：
  python -B scripts/export-wardrobe-tables.py --plugin <插件根目录>
  python -B scripts/export-wardrobe-tables.py --check

输出（默认 desktop-source/public/data/wardrobe/）：
  nsfw-tables.json  overrides.json  outfit-style.json  link.json

--check 会重新生成并与磁盘逐字节比对，用于发版前确认「Python 表改了、JSON 没重导」。
"""
from __future__ import annotations

import argparse
import importlib
import json
import os
import re
import sys
import types

sys.dont_write_bytecode = True  # 不在插件目录留 __pycache__

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.normpath(os.path.join(HERE, "..", "public", "data", "wardrobe"))
DEFAULT_PLUGIN = os.environ.get("ANIMA_WARDROBE_DIR", "")
SCHEMA_PREFIX = "xyz-wardrobe"


def fail(msg: str) -> "NoReturn":
    print(f"[wardrobe-tables] 失败：{msg}", file=sys.stderr)
    raise SystemExit(1)


def load_package(plugin_dir: str, name: str = "awv4"):
    """以「空包」方式加载插件模块。

    插件目录名带 `-`，不能直接 import；`__init__.py` 又会 import ComfyUI 的
    PromptServer。这里手工造一个空包并把 __path__ 指过去，只加载需要的子模块。
    """
    init = os.path.join(plugin_dir, "__init__.py")
    if not os.path.isfile(init):
        fail(f"不像插件根目录（缺 __init__.py）：{plugin_dir}")
    pkg = types.ModuleType(name)
    pkg.__path__ = [plugin_dir]
    pkg.__package__ = name
    sys.modules[name] = pkg
    return pkg


def plugin_version(plugin_dir: str) -> str:
    path = os.path.join(plugin_dir, "__init__.py")
    with open(path, "r", encoding="utf-8") as fh:
        m = re.search(r'__version__\s*=\s*["\']([^"\']+)["\']', fh.read())
    return m.group(1) if m else "unknown"


def sorted_set(value):
    return sorted(value, key=lambda x: (str(type(x)), str(x)))


def json_safe(value):
    """set/tuple 转 list，其余原样递归。dict 键必须是字符串。"""
    if isinstance(value, (set, frozenset)):
        return sorted_set(value)
    if isinstance(value, tuple):
        return [json_safe(v) for v in value]
    if isinstance(value, dict):
        out = {}
        for key, val in value.items():
            if not isinstance(key, str):
                raise TypeError(f"dict 键不是字符串：{key!r}")
            out[key] = json_safe(val)
        return out
    if isinstance(value, list):
        return [json_safe(v) for v in value]
    return value


def pair_records(table: dict, key_names: tuple[str, str], value_key: str, why: bool = False):
    """把 {(a, b): value} 转成 [{a, b, <value_key>: value}]，保持插件里的顺序。"""
    rows = []
    for key, val in table.items():
        if not isinstance(key, tuple) or len(key) != 2:
            fail(f"期望二元组键，实际：{key!r}")
        row = {key_names[0]: key[0], key_names[1]: key[1], value_key: json_safe(val)}
        rows.append(row)
    return rows


def level_pair_records(table: dict):
    rows = []
    for key, val in table.items():
        if not isinstance(key, tuple) or len(key) != 2:
            fail(f"档位校准表的键应为 (field, en)：{key!r}")
        if not isinstance(val, tuple) or len(val) < 2:
            fail(f"档位校准表的值应为 (level, why)：{key!r}")
        rows.append({
            "field": key[0],
            "en": key[1],
            "level": int(val[0]),
            "why": str(val[1]),
        })
    return rows


def build_nsfw(N, version: str):
    tables = {}
    for key, val in N.NSFW_TABLES.items():
        tables[key] = {
            "label": val.get("label", key),
            "level": int(val.get("level", 0)),
            "tags": sorted_set(val.get("tags") or []),
            "patterns": list(val.get("patterns") or []),
        }
    return {
        "_meta": {
            "schema": f"{SCHEMA_PREFIX}/nsfw-tables@1",
            "source": "Comfyui-Anima-Wardrobe-V4/anima_v4_nsfw.py",
            "pluginVersion": version,
        },
        "levels": list(N.LEVELS),
        "levelZh": json_safe(N.LEVEL_ZH),
        "levelRank": json_safe(N.LEVEL_RANK),
        "targetNum": json_safe(N.TARGET_NUM),
        "numOf": json_safe(N.NUM_OF),
        "levelAlias": json_safe(N.LEVEL_ALIAS),
        "nsfwMax": int(N.NSFW_MAX),
        "nsfwLabel": json_safe(N.NSFW_LABEL),
        "nsfwKeyOfNum": {str(k): v for k, v in N.NSFW_KEY_OF_NUM.items()},
        "scale": [
            {"num": int(row[0]), "key": row[1], "zh": row[2], "desc": row[3]}
            for row in N.NSFW_SCALE
        ],
        "exactOnly": sorted_set(N.EXACT_ONLY),
        "explicitTags": sorted_set(N.EXPLICIT_TAGS),
        "explicitExceptions": sorted_set(N.EXPLICIT_EXCEPTIONS),
        "explicitPatterns": list(N.EXPLICIT_PATTERNS),
        "suggestiveTags": sorted_set(N.SUGGESTIVE_TAGS),
        "tables": tables,
        "hardcoreCategories": list(N.HARDCORE_CATEGORIES),
        "extremeCategories": list(N.EXTREME_CATEGORIES),
        "categoryOrder": list(N.CATEGORY_ORDER),
    }


def build_overrides(OV, version: str):
    return {
        "_meta": {
            "schema": f"{SCHEMA_PREFIX}/overrides@1",
            "source": "Comfyui-Anima-Wardrobe-V4/anima_v4_overrides.py",
            "pluginVersion": version,
        },
        "sectionFloor": json_safe(OV.SECTION_FLOOR),
        "levelDemote": level_pair_records(OV.LEVEL_DEMOTE),
        "levelRaise": level_pair_records(OV.LEVEL_RAISE),
    }


def build_outfit_style(OS, version: str):
    return {
        "_meta": {
            "schema": f"{SCHEMA_PREFIX}/outfit-style@1",
            "source": "Comfyui-Anima-Wardrobe-V4/anima_v4_outfit_style.py",
            "pluginVersion": version,
        },
        "styles": [{"key": row[0], "zh": row[1]} for row in OS.STYLES],
        "styleChoices": list(OS.STYLE_CHOICES),
        "styleOf": json_safe(OS.STYLE_OF),
        "styleBans": [
            {"style": key[0], "field": key[1], "tags": sorted_set(val)}
            for key, val in OS.STYLE_BANS.items()
        ],
        "styleCompat": pair_records(OS.STYLE_COMPAT, ("a", "b"), "factor"),
        "styleMakeup": json_safe(OS.STYLE_MAKEUP),
        "styleColor": json_safe(OS.STYLE_COLOR),
        "styleSceneBias": json_safe(OS.STYLE_SCENE_BIAS),
        "styleOutfitPrefer": pair_records(OS.STYLE_OUTFIT_PREFER, ("a", "b"), "factor"),
        "placeStyle": json_safe(OS.PLACE_STYLE),
        "anchorBans": [
            {"anchor": key, "field": field, "tags": sorted_set(val)}
            for key, by_field in OS.ANCHOR_BANS.items()
            for field, val in by_field.items()
        ],
        "outfitPartial": sorted_set(OS.OUTFIT_PARTIAL),
        "colorTags": list(OS.COLOR_TAGS),
        "colorZh": json_safe(OS.COLOR_ZH),
        "sockColorTargets": list(OS.SOCK_COLOR_TARGETS),
        "bodyColorTargets": list(OS.BODY_COLOR_TARGETS),
        "constants": {
            "sameStyleBoost": OS.SAME_STYLE_BOOST,
            "farStyleFactor": OS.FAR_STYLE_FACTOR,
            "layerSuppress": OS.LAYER_SUPPRESS,
            "styleMakeupBoost": OS.STYLE_MAKEUP_BOOST,
            "styleMakeupFar": OS.STYLE_MAKEUP_FAR,
            "styleSceneBoost": OS.STYLE_SCENE_BOOST,
            "styleSceneFar": OS.STYLE_SCENE_FAR,
        },
    }


def build_link(L, version: str):
    return {
        "_meta": {
            "schema": f"{SCHEMA_PREFIX}/link@1",
            "source": "Comfyui-Anima-Wardrobe-V4/anima_v4_link.py",
            "pluginVersion": version,
        },
        "actPosBan": {key: sorted_set(val) for key, val in L.ACT_POS_BAN.items()},
        "emotionBan": {
            key: {field: sorted_set(tags) for field, tags in by_field.items()}
            for key, by_field in L.EMOTION_BAN.items()
        },
        "placeTheme": json_safe(L.PLACE_THEME),
        "themeWeight": json_safe(L.THEME_WEIGHT),
        "themeBan": {
            key: {field: sorted_set(tags) for field, tags in by_field.items()}
            for key, by_field in L.THEME_BAN.items()
        },
        "handAll": sorted_set(L.HAND_ALL),
        "handSlot": {key: sorted_set(val) for key, val in L.HAND_SLOT.items()},
        "handOrder": list(L.HAND_ORDER),
        "handPriority": json_safe(L.HAND_PRIORITY),
    }


def dump(payload) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=1) + "\n"


def main():
    ap = argparse.ArgumentParser(description="导出 Wardrobe 语义表为 JSON")
    ap.add_argument("--plugin", default=DEFAULT_PLUGIN, help="插件根目录（含 __init__.py）")
    ap.add_argument("--out", default=DEFAULT_OUT, help="输出目录")
    ap.add_argument("--check", action="store_true", help="只校验磁盘文件是否与插件一致")
    args = ap.parse_args()

    plugin = os.path.abspath(args.plugin)
    if not os.path.isdir(plugin):
        fail("必须提供 --plugin（或设置 ANIMA_WARDROBE_DIR）")

    load_package(plugin)
    N = importlib.import_module("awv4.anima_v4_nsfw")
    OV = importlib.import_module("awv4.anima_v4_overrides")
    OS = importlib.import_module("awv4.anima_v4_outfit_style")
    L = importlib.import_module("awv4.anima_v4_link")
    version = plugin_version(plugin)

    payloads = {
        "nsfw-tables.json": build_nsfw(N, version),
        "overrides.json": build_overrides(OV, version),
        "outfit-style.json": build_outfit_style(OS, version),
        "link.json": build_link(L, version),
    }

    for name, payload in payloads.items():
        text = dump(payload)
        path = os.path.join(args.out, name)
        if args.check:
            if not os.path.isfile(path):
                fail(f"缺少 {path}，请先不带 --check 跑一次")
            with open(path, "r", encoding="utf-8") as fh:
                actual = fh.read()
            if actual != text:
                fail(f"{name} 与插件不一致，请重新导出")
            print(f"[wardrobe-tables] OK {name} ({len(text)} B)")
        else:
            os.makedirs(args.out, exist_ok=True)
            with open(path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(text)
            print(f"[wardrobe-tables] 写入 {name} ({len(text)} B)")

    print(
        "[wardrobe-tables] 统计："
        f"nsfw tables={len(N.NSFW_TABLES)} / demote={len(OV.LEVEL_DEMOTE)} / "
        f"raise={len(OV.LEVEL_RAISE)} / styles={len(OS.STYLES)} / "
        f"actBan={len(L.ACT_POS_BAN)} / placeTheme={len(L.PLACE_THEME)}"
    )


if __name__ == "__main__":
    main()
