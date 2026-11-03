#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""重新生成造型台的对拍夹具（dev-only）。

夹具是「同 seed 与插件逐字一致」这条承诺的证据。插件升级后必须显式重跑本脚本，
并让 `src/lib/wardrobe/parity.test.ts` 重新变绿 —— 不允许悄悄改期望值。

用法（本机 npm run 不可用，直接调 python）：
  python -B scripts/export-wardrobe-fixtures.py --plugin <插件根目录>
  python -B scripts/export-wardrobe-fixtures.py --check

输出（默认 src/lib/wardrobe/__fixtures__/）：
  option-levels.json  tag-levels.json  role-levels.json
  core-cases.json  char-style-cases.json  scene-cases.json
  parity.json  parity-random.json
"""
from __future__ import annotations

import argparse
import importlib
import json
import os
import random
import sys
import types

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.normpath(os.path.join(HERE, "..", "src", "lib", "wardrobe", "__fixtures__"))
DEFAULT_PLUGIN = os.environ.get("ANIMA_WARDROBE_DIR", "")


def fail(message: str) -> "NoReturn":
    print(f"[wardrobe-fixtures] 失败：{message}", file=sys.stderr)
    raise SystemExit(1)


def load_package(plugin_dir: str, name: str = "awv4"):
    init = os.path.join(plugin_dir, "__init__.py")
    if not os.path.isfile(init):
        fail(f"不像插件根目录（缺 __init__.py）：{plugin_dir}")
    pkg = types.ModuleType(name)
    pkg.__path__ = [plugin_dir]
    pkg.__package__ = name
    sys.modules[name] = pkg
    return pkg


def dump(value, compact=False) -> str:
    if compact:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return json.dumps(value, ensure_ascii=False, indent=1)


def emit(out_dir: str, name: str, payload, check: bool, compact=False) -> None:
    text = dump(payload, compact=compact)
    path = os.path.join(out_dir, name)
    if check:
        if not os.path.isfile(path):
            fail(f"缺夹具：{path}")
        with open(path, "r", encoding="utf-8") as fh:
            actual = json.load(fh)
        # 内存里的 payload 可能含 tuple（R.sanitize / R.repair 的返回值），
        # JSON 落盘后会变成 list；比较前先过一遍序列化，避免类型假阳性。
        if actual != json.loads(text):
            fail(f"{name} 与插件不一致，请重新生成并跑对拍")
        print(f"[wardrobe-fixtures] OK {name}")
        return
    os.makedirs(out_dir, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text + "\n")
    print(f"[wardrobe-fixtures] 写入 {name}（{len(text)} B）")


def build_levels(R, pools, levels):
    option_levels = {}
    for section in pools["sections"]:
        for field in section["fields"]:
            for _zh, en in field.get("opts") or []:
                option_levels[field["key"] + "||" + en] = R.option_level(field["key"], en)
    tag_levels = {tag: R.tag_level(tag) for tag in levels["tag_levels"]}
    for tag in ["wet hair", "fishnet bodystocking", "against wall, sex", "pov crotch", "1girl", "completely nude"]:
        tag_levels[tag] = R.tag_level(tag)
    role_levels = {en: lv for _zh, en, lv in R._role_options()}
    return option_levels, tag_levels, role_levels


def build_core(R):
    sanitize_cases = [
        ("hands", {"count": "1girl, solo", "arms_hands": "hand in own hair", "pose_risque": "skirt pull"}),
        ("extra_hand", {"count": "1girl, solo", "arms_hands": "hand in own hair", "n_extra": "stretching"}),
        ("solo_partner", {"count": "1girl, solo", "n_act": "missionary", "n_cum": "creampie"}),
        ("solo_group_theme", {"count": "1girl, solo", "n_theme": "threesome", "n_cum": "bukkake"}),
        ("nude_outfit", {"count": "1girl, solo", "n_state": "completely nude", "outfit": "evening gown", "n_fabric": "lingerie"}),
        ("pantyhose_bare", {"count": "1girl, solo", "socks": "black pantyhose", "shoes": "bare feet"}),
        ("blindfold", {"count": "1girl, solo", "n_theme": "blindfold", "accessory": "glasses", "n_orgasm": "heart-shaped pupils"}),
        ("facing_away", {"count": "1girl, solo", "pose_base": "standing, facing away", "eye_gaze": "looking at viewer"}),
        ("pov_full", {"count": "1girl, solo", "viewpoint": "pov", "shot_size": "full body"}),
        ("lofi_dof", {"count": "1girl, solo", "device": "selfie", "dof": "focus on face"}),
        ("above_lookup", {"count": "1girl, solo", "viewpoint": "from above", "eye_gaze": "looking up"}),
        ("protected_outfit", {"count": "1girl, solo", "_preset_fields": ["outfit"], "outfit": "bikini", "n_state": "completely nude"}),
    ]
    sanitize = []
    for name, state in sanitize_cases:
        before = json.loads(json.dumps(state))
        cleared = R.sanitize(state)
        sanitize.append({"name": name, "input": before, "cleared": cleared, "state": state})

    repair_cases = [
        ("sfw_wet", "wet hair, completely nude, black_hair, black hair, blindfold, heart-shaped pupils", 0),
        ("nude_outfit", "completely nude, evening gown, black thighhighs, bare feet", 0),
        ("pantyhose", "black pantyhose, bare feet", 0),
        ("solo_multi", "1girl, solo, 2girls, smile", 0),
        ("pov", "pov, full body, from above, looking up, from below, looking down", 2),
        ("stand_lie", "standing sex, on all fours, lying on stomach", 3),
        ("dup_fmt", "black_hair, black_hair, smile, score_tag", 0),
        ("raise_tag", "fishnet bodystocking, smile", 0),
    ]
    repair = []
    for name, text, lv in repair_cases:
        tags = [t.strip() for t in text.split(",") if t.strip()]
        repair.append({"name": name, "tags": tags, "lv": lv, "result": R.repair(tags, lv)})

    collect_states = [
        {"count": "1girl, solo", "role": "hatsune miku, vocaloid", "hair_color": "blue hair", "outfit": "school uniform", "socks": "white socks", "pose_base": "standing", "emotion": "smile", "shot_size": "upper body", "place": "classroom", "light_fx": "soft lighting", "nl": "looking at viewer"},
        {"count": "2girls, yuri", "n_state": "completely nude", "n_act": "missionary", "n_extra": "afternoon light, quiet", "_preset_fields": ["n_extra"]},
        {"count": "1girl, solo", "hair_acc": "hair ornament", "makeup": "lipstick", "skin_detail": "mole", "leg": "thigh gap", "texture_fx": "film grain", "comp": "portrait"},
    ]
    collect = [{"name": f"c{i}", "input": st, "out": R.collect(st)} for i, st in enumerate(collect_states)]
    return {"sanitize": sanitize, "repair": repair, "collect": collect}


def build_char_style(R, OS):
    out = {}
    out["rolePoolCounts"] = {str(lv): len(R.role_pool(lv)) for lv in range(5)}
    out["rolePoolHead"] = {str(lv): [[z, t, n] for z, t, n in R.role_pool(lv)[:8]] for lv in [0, 2, 4]}
    out["pickRoles"] = [
        {"seed": 42, "lv": 2, "n": 3, "roles": R.pick_random_roles(random.Random(42), 2, 3)},
        {"seed": 7, "lv": 4, "n": 1, "roles": R.pick_random_roles(random.Random(7), 4, 1)},
        {"seed": 42, "lv": 2, "n": 2, "works": ["vocaloid"], "roles": R.pick_random_roles(random.Random(42), 2, 2, works=["vocaloid"])},
    ]
    out["headcount"] = [
        [n, lv, cur, R.headcount_tags(n, lv, cur)]
        for n in range(0, 5)
        for lv in (0, 2)
        for cur in ("1girl, solo", "1girl, 1boy, hetero", "")
    ]
    out["selected"] = []
    for state, triggers, lv in [
        ({"count": "1girl, solo"}, ["hatsune miku, vocaloid"], 2),
        ({"count": "1girl, 1boy, hetero"}, ["hatsune miku, vocaloid", "hu tao, genshin impact"], 2),
        ({"count": "1girl, solo", "n_act": "missionary", "n_pos": "against wall"}, ["hu tao, genshin impact", "ganyu, genshin impact"], 1),
    ]:
        st = json.loads(json.dumps(state))
        notes = R.apply_selected_roles(st, triggers, lv)
        out["selected"].append({"input": state, "triggers": triggers, "lv": lv, "notes": notes, "state": st})
    out["hair"] = []
    for trigger in ["hatsune miku, vocaloid", "hu tao, genshin impact", "emilia (re:zero), re:zero", "raiden shogun, genshin impact"]:
        out["hair"].append({"trigger": trigger, "style": R.hair_style_for(trigger), "appearance": R.appearance_for(trigger)})
    out["hairApply"] = []
    for picks in [{}, {"hair_len": "twin braids"}, {"hair_tie": "twintails"}, {"hair_tie": "very long hair"}]:
        st = {"role": "hatsune miku, vocaloid"}
        changed = R.apply_hair_style(st, {}, picks)
        out["hairApply"].append({"picks": picks, "changed": changed, "state": st})
    out["feat"] = []
    for tag in ["emilia_(re:zero)", "the_herta_(honkai:_star_rail)", "raiden_shogun"]:
        extras, drops, sets = R.char_feat_for(tag, 42)
        out["feat"].append({"tag": tag, "extras": extras, "drop": drops, "set": sets})
    out["style"] = []
    states = [{"place": "classroom"}, {"place": "beach", "outfit": "school uniform"}, {"outfit": "wedding dress", "shoes": "sneakers"}, {"place": "office"}]
    for state in states:
        for choice in ["随机", "不限", "学院", "泳装", "哥特"]:
            out["style"].append({
                "state": state,
                "choice": choice,
                "anchor": OS.anchor_of(state, choice),
                "bansShoes": sorted(OS.style_bans(state, "shoes", choice)),
                "biasOutfit": OS.style_bias(state, "outfit", "school uniform", choice),
                "biasTop": OS.style_bias(state, "top", "t-shirt", choice),
                "makeupBias": OS.field_option_bias("makeup", choice, "pale skin, black lipstick, eyeshadow"),
                "placeBias": OS.field_option_bias("place", choice, "classroom"),
                "colorBias": OS.field_option_bias("cloth_color", choice, "black"),
            })
    out["colorize"] = []
    for state in [
        {"sock_color": "black", "socks": "thighhighs"},
        {"cloth_color": "black", "skirt": "miniskirt"},
        {"cloth_color": "yellow", "socks": "thighhighs"},
        {"cloth_color": "black", "skirt": "black skirt"},
        {"cloth_color": "red", "kneehighs": "kneehighs"},
    ]:
        st = json.loads(json.dumps(state))
        notes = OS.colorize(st)
        out["colorize"].append({"input": state, "notes": notes, "state": st})
    return out


def build_scenes(R):
    out = {"scenes": [], "trim": [], "split": []}
    for scene in R.scene_list():
        sid = scene["id"]
        lv = int(scene.get("level", 0))
        state: dict = {}
        filled = R.apply_preset(state, sid, lv, weights={}, locks=set(), rng=random.Random(42))
        out["scenes"].append({"id": sid, "level": lv, "preset": R.scene_preset(sid), "filled": filled, "state": state})
    weights = {"sections": {}, "fields": {}, "options": {}}
    trim_cases = [
        ({"count": "1girl, solo", "role": "x, y", "hair_color": "blue hair", "eyes_color": "blue eyes", "texture_fx": "film grain", "comp": "portrait", "prop": "chair", "weather": "rain", "hair_acc": "hair ornament", "emotion": "smile", "outfit": "dress"}, 20),
        ({"count": "1girl, solo", "role": "x, y", "n_canon": "c1", "n_extra": "a, b", "_preset_fields": ["outfit"], "outfit": "dress", "emotion": "smile", "prop": "chair", "light_fx": "soft lighting"}, 3),
        ({"count": "1girl, solo", "figure": "large breasts", "_breast_size": True, "emotion": "smile", "prop": "chair"}, 1),
    ]
    for state, cap in trim_cases:
        st = json.loads(json.dumps(state))
        dropped = R.trim_to_cap(st, cap, weights)
        out["trim"].append({"input": state, "cap": cap, "weights": weights, "dropped": dropped, "state": st})
    for text, lv in [("1girl, solo, completely nude, smile", 0), ("smile, missionary, creampie", 2), ("a, b, c", 4)]:
        keep, removed = R.split_by_level(text, lv)
        out["split"].append({"text": text, "lv": lv, "keep": keep, "removed": removed})
    return out


def build_parity(R):
    w0 = {"sections": {}, "fields": {}, "options": {}}
    profiles = [
        ("default", {}),
        ("field-tuned", {"sections": {}, "fields": {"hair_color": 3.0, "prop": 0, "n_act": 0.4}, "options": {}}),
        ("option-tuned", {"sections": {}, "fields": {}, "options": {"emotion": {"embarrassed, blush": 3.0, "expressionless": 0}}}),
        ("sections-off", {"sections": {"makeup": 0, "lighting": 0.5}, "fields": {}, "options": {}}),
        ("fixed-cap", {}),
    ]
    cases = []
    for lv in ["sfw", "suggestive", "explicit", "hardcore", "extreme"]:
        for seed in [0, 42, 20261015]:
            for name, weights in profiles:
                kw = dict(level=lv, seed=seed, weights=weights, base_prob=0.65, tag_cap="自动")
                if name == "fixed-cap":
                    kw.update(tag_cap=28, base_prob=0.45)
                cases.append((f"{lv}_{seed}_{name}", kw))
    for style in ["随机", "不限", "哥特", "泳装"]:
        for lv in ["sfw", "suggestive", "explicit", "hardcore", "extreme"]:
            cases.append((f"style_{style}_{lv}", dict(level=lv, seed=42, weights=w0, outfit_style=style)))
    cases.extend([
        ("force-role", dict(level="explicit", seed=42, weights=w0, force_role="hatsune miku, vocaloid", locks=["hair_color"], hair_picks={"hair_tie": "twin braids"})),
        ("selected-2", dict(level="explicit", seed=42, weights=w0, selected_roles=["hatsune miku, vocaloid", "hu tao, genshin impact"])),
        ("selected-1-lock-count", dict(level="hardcore", seed=7, weights=w0, selected_roles=["ganyu, genshin impact"])),
        ("forced-place-outfit", dict(level="suggestive", seed=11, weights=w0, forced={"place": "beach", "outfit": "bikini"})),
        ("scene-forced", dict(level="sfw", seed=42, weights=w0, forced={"n_canon": "sc_rain_street_lookback"})),
        ("breast-size", dict(level="suggestive", seed=42, weights=w0, breast_size="巨乳")),
        ("big-breasts", dict(level="suggestive", seed=42, weights=w0, big_breasts=True)),
        ("works-vocaloid", dict(level="suggestive", seed=42, weights=w0, role_works="vocaloid")),
        ("appearance-off", dict(level="suggestive", seed=42, weights=w0, appearance_follow=False)),
        ("hair-off", dict(level="suggestive", seed=42, weights=w0, hair_follow=False)),
        ("no-sections", dict(level="suggestive", seed=42, weights=w0, enabled_sections=["hair", "face"])),
        ("extra-body", dict(level="explicit", seed=99, weights=w0, extra_body="pointy ears, smile")),
    ])
    out = []
    for name, kw in cases:
        r = R.draw(**kw)
        out.append({"id": name, "input": kw, "expect": {"text": r["text"], "tags": r["tags"], "state": r["state"], "dropped": r["dropped"], "level_num": r["level_num"]}})
    return {"cases": out}


def build_random(R):
    rnd = random.Random(20261102)
    fields = list(R.field_keys())
    role_pool = [t for _z, t, _lv in R.role_pool(4)]
    styles = ["随机", "不限", "哥特", "泳装", "学院", "女仆", "战术风", "暗黑少女", "辣妹"]
    cases = []
    for i in range(80):
        level = rnd.choice(["sfw", "suggestive", "explicit", "hardcore", "extreme"])
        seed = rnd.randrange(0, 2 ** 31 - 1)
        weights = {"sections": {}, "fields": {}, "options": {}}
        for _ in range(rnd.randrange(0, 4)):
            weights["fields"][rnd.choice(fields)] = rnd.choice([0, 0.4, 1.5, 2.0, 3.0])
        for _ in range(rnd.randrange(0, 3)):
            weights["sections"][rnd.choice(["hair", "face", "body", "makeup", "cloth_sfw", "pose_sfw", "camera", "scene", "lighting", "cloth_nsfw", "pose_nsfw", "special_nsfw", "canon"])] = rnd.choice([0, 0.5, 1.5, 2.0, 3.0])
        kw = dict(level=level, seed=seed, weights=weights)
        if rnd.random() < 0.15: kw["locks"] = [rnd.choice(fields)]
        if rnd.random() < 0.12: kw["tag_cap"] = rnd.choice([16, 20, 24, 28, 32, 40, 48])
        if rnd.random() < 0.12: kw["extra_body"] = rnd.choice(["pointy ears, smile", "soft focus, smile", "rain, reflection"])
        if rnd.random() < 0.15: kw["outfit_style"] = rnd.choice(styles)
        if rnd.random() < 0.12: kw["appearance_follow"] = False
        if rnd.random() < 0.12: kw["hair_follow"] = False
        if rnd.random() < 0.12: kw["selected_roles"] = [rnd.choice(role_pool)]
        if rnd.random() < 0.08: kw["selected_roles"] = [rnd.choice(role_pool), rnd.choice(role_pool)]
        if rnd.random() < 0.10: kw["breast_size"] = rnd.choice(["平胸", "小胸", "中等", "大胸", "巨乳", "爆乳"])
        if rnd.random() < 0.10: kw["base_prob"] = rnd.choice([0.45, 0.55, 0.75, 0.9])
        if rnd.random() < 0.08: kw["role_works"] = rnd.choice(["vocaloid", "genshin impact", "touhou"])
        cases.append((f"rnd{i:03d}", kw))
    out = []
    for name, kw in cases:
        try:
            r = R.draw(**kw)
        except Exception as exc:  # noqa: BLE001 - 插件自身的输入校验
            print(f"[wardrobe-fixtures] skip {name}: {exc}")
            continue
        out.append({"id": name, "input": kw, "expect": {"text": r["text"], "tags": r["tags"], "state": r["state"], "dropped": r["dropped"], "level_num": r["level_num"]}})
    return {"cases": out}


def main():
    ap = argparse.ArgumentParser(description="生成造型台对拍夹具")
    ap.add_argument("--plugin", default=DEFAULT_PLUGIN)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    plugin = os.path.abspath(args.plugin)
    if not os.path.isdir(plugin):
        fail("必须提供 --plugin（或设置 ANIMA_WARDROBE_DIR）")
    load_package(plugin)
    R = importlib.import_module("awv4.anima_v4_rules")
    OS = importlib.import_module("awv4.anima_v4_outfit_style")

    presets = os.path.join(plugin, "presets")
    with open(os.path.join(presets, "anima_v4_pools.json"), "r", encoding="utf-8") as fh:
        pools = json.load(fh)
    with open(os.path.join(presets, "anima_v4_levels.json"), "r", encoding="utf-8") as fh:
        levels = json.load(fh)

    option_levels, tag_levels, role_levels = build_levels(R, pools, levels)
    emit(args.out, "option-levels.json", option_levels, args.check, compact=True)
    emit(args.out, "tag-levels.json", tag_levels, args.check, compact=True)
    emit(args.out, "role-levels.json", role_levels, args.check, compact=True)
    emit(args.out, "core-cases.json", build_core(R), args.check)
    emit(args.out, "char-style-cases.json", build_char_style(R, OS), args.check)
    emit(args.out, "scene-cases.json", build_scenes(R), args.check)
    emit(args.out, "parity.json", build_parity(R), args.check, compact=True)
    emit(args.out, "parity-random.json", build_random(R), args.check, compact=True)


if __name__ == "__main__":
    main()
