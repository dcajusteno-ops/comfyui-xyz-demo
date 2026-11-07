#!/usr/bin/env python3
"""
P3 内置数据体积优化（可重复执行，默认幂等）。

做两件事：
1. wardrobe/thumbs/*.webp —— 保持 160×160 尺寸，重编码为 WebP quality=78 / method=6。
   只在「新文件更小 + 回读尺寸一致」时原子替换；动画 WebP 跳过。
   重复运行默认跳过（marker 记录），避免二次压缩继续掉画质；确需重跑加 --force-thumbs。
2. public/data/**/*.json —— 去掉缩进与空白（JSON 语义不变），只在更小时替换。

结果统计写到 artifacts/data-optimization.json（gitignore），作为 P3 的验收凭据。
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DATA = ROOT / "public" / "data"
THUMBS_DIR = PUBLIC_DATA / "wardrobe" / "thumbs"
ARTIFACTS_DIR = ROOT / "artifacts"
MARKER = ARTIFACTS_DIR / "data-optimization.json"


def fmt_mb(value: int) -> str:
    return f"{value / 1048576:.2f} MB"


def atomic_write_bytes(target: Path, data: bytes) -> None:
    tmp = target.with_name(target.name + ".opt-tmp")
    tmp.write_bytes(data)
    os.replace(tmp, target)


def optimize_thumbs(quality: int, force: bool, dry_run: bool) -> dict | None:
    if not THUMBS_DIR.exists():
        print(f"[thumbs] 跳过：{THUMBS_DIR} 不存在")
        return None

    if MARKER.exists() and not force:
        print(f"[thumbs] 跳过：{MARKER.name} 已存在（防止二次压缩；重跑请加 --force-thumbs）")
        return None

    files = sorted(THUMBS_DIR.glob("*.webp"))
    before = sum(path.stat().st_size for path in files)
    after = 0
    optimized = 0
    skipped = 0

    print(f"[thumbs] {len(files)} 张，quality={quality}，尺寸保持不变")
    for index, path in enumerate(files, 1):
        try:
            with Image.open(path) as image:
                if getattr(image, "is_animated", False):
                    skipped += 1
                    after += path.stat().st_size
                    continue
                image.load()
                width, height = image.size
                rgb = image.convert("RGB")
                tmp = path.with_name(path.name + ".opt-tmp")
                rgb.save(tmp, "WEBP", quality=quality, method=6)
                new_size = tmp.stat().st_size
                old_size = path.stat().st_size

                if new_size >= old_size:
                    tmp.unlink(missing_ok=True)
                    after += old_size
                    skipped += 1
                    continue

                with Image.open(tmp) as check:
                    if check.size != (width, height):
                        tmp.unlink(missing_ok=True)
                        after += old_size
                        skipped += 1
                        continue

                if not dry_run:
                    os.replace(tmp, path)
                else:
                    tmp.unlink(missing_ok=True)
                after += new_size
                optimized += 1
        except Exception as error:  # noqa: BLE001 - 单张失败不阻断整批
            print(f"[thumbs] 失败 {path.name}: {error}")
            after += path.stat().st_size
            skipped += 1

        if index % 300 == 0 or index == len(files):
            print(f"[thumbs] {index}/{len(files)} ...")

    result = {
        "count": len(files),
        "optimized": optimized,
        "skipped": skipped,
        "beforeBytes": before,
        "afterBytes": after,
        "savedBytes": before - after,
        "quality": quality,
        "dryRun": dry_run,
    }
    print(
        f"[thumbs] 完成：{optimized} 张优化 / {skipped} 张跳过；"
        f"{fmt_mb(before)} → {fmt_mb(after)}，节省 {fmt_mb(before - after)}"
    )
    return result


def minify_json(dry_run: bool) -> dict:
    files = sorted(PUBLIC_DATA.rglob("*.json"))
    before = sum(path.stat().st_size for path in files)
    after = 0
    changed = 0

    for path in files:
        raw_bytes = path.read_bytes()
        try:
            data = json.loads(raw_bytes.decode("utf-8"))
            compact = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        except Exception as error:  # noqa: BLE001
            print(f"[json] 跳过 {path.relative_to(ROOT)}：{error}")
            after += len(raw_bytes)
            continue

        if len(compact) < len(raw_bytes):
            if not dry_run:
                atomic_write_bytes(path, compact)
            before_size = len(raw_bytes)
            after += len(compact)
            changed += 1
            saved = before_size - len(compact)
            if saved > 16384:
                print(f"[json] {path.relative_to(ROOT)}：{fmt_mb(before_size)} → {fmt_mb(len(compact))}")
        else:
            after += len(raw_bytes)

    result = {
        "count": len(files),
        "changed": changed,
        "beforeBytes": before,
        "afterBytes": after,
        "savedBytes": before - after,
        "dryRun": dry_run,
    }
    print(f"[json] 完成：{changed} 个文件压缩；{fmt_mb(before)} → {fmt_mb(after)}，节省 {fmt_mb(before - after)}")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="优化内置词库 JSON 与造型台缩略图")
    parser.add_argument("--quality", type=int, default=78, help="WebP quality（默认 78）")
    parser.add_argument("--force-thumbs", action="store_true", help="忽略 marker，重新压缩缩略图")
    parser.add_argument("--dry-run", action="store_true", help="只统计，不写文件")
    parser.add_argument("--skip-thumbs", action="store_true", help="只处理 JSON")
    parser.add_argument("--skip-json", action="store_true", help="只处理缩略图")
    args = parser.parse_args()

    if args.quality < 1 or args.quality > 100:
        print("quality 必须在 1-100 之间", file=sys.stderr)
        return 2

    print(f"项目根：{ROOT}")
    result = {"quality": args.quality, "dryRun": args.dry_run}
    if not args.skip_thumbs:
        thumbs = optimize_thumbs(args.quality, args.force_thumbs, args.dry_run)
        if thumbs:
            result["thumbs"] = thumbs
    if not args.skip_json:
        result["json"] = minify_json(args.dry_run)

    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    if not args.dry_run and "thumbs" in result and not args.skip_thumbs:
        MARKER.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # 缩略图被 marker 跳过时，沿用上一轮的统计，避免把验收记录覆盖成「无 thumbs」
    if "thumbs" not in result and MARKER.exists():
        try:
            previous = json.loads(MARKER.read_text(encoding="utf-8"))
            if isinstance(previous.get("thumbs"), dict):
                result["thumbs"] = previous["thumbs"]
        except Exception:  # noqa: BLE001
            pass
    out = ARTIFACTS_DIR / ("data-optimization-dryrun.json" if args.dry_run else "data-optimization.json")
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"统计写入：{out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
