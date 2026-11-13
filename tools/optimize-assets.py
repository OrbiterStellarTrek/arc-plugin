#!/usr/bin/env python3
"""把 resources/arcb30 下的立绘 / 曲绘转成 WebP，尽量无损地压缩体积。

    python tools/optimize-assets.py [--dry] [--quality-char 95] [--quality-icon 92] [--quality-jacket 90]

依赖 Pillow（pip install pillow）。转换后删除原始 png/jpg；
数据层会依次尝试 .webp / .png，所以旧格式保留也能正常工作。
"""
import argparse
import glob
import io
import os
from concurrent.futures import ProcessPoolExecutor

from PIL import Image

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "resources", "arcb30")


def convert(args):
    path, quality, rgb = args
    try:
        im = Image.open(path).convert("RGB" if rgb else "RGBA")
        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=quality, method=6)
        out = os.path.splitext(path)[0] + ".webp"
        with open(out, "wb") as f:
            f.write(buf.getvalue())
        before = os.path.getsize(path)
        os.remove(path)
        return (before, len(buf.getvalue()))
    except Exception as exc:  # noqa: BLE001
        return ("err", f"{path}: {exc}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="只统计，不写入")
    ap.add_argument("--quality-char", type=int, default=95)
    ap.add_argument("--quality-icon", type=int, default=92)
    ap.add_argument("--quality-jacket", type=int, default=90)
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    jobs = []
    for p in glob.glob(os.path.join(BASE, "char", "*.png")):
        jobs.append((p, args.quality_icon if p.endswith("_icon.png") else args.quality_char, False))
    for p in glob.glob(os.path.join(BASE, "jacket", "*.jpg")):
        jobs.append((p, args.quality_jacket, True))

    if not jobs:
        print("没有需要转换的文件")
        return
    if args.dry:
        total = sum(os.path.getsize(p) for p, _, _ in jobs)
        print(f"待转换 {len(jobs)} 个文件，当前占用 {total / 1048576:.1f} MB")
        return

    before = after = count = 0
    with ProcessPoolExecutor(max_workers=args.workers) as ex:
        for res in ex.map(convert, jobs, chunksize=8):
            if res and res[0] == "err":
                print("跳过", res[1])
                continue
            before += res[0]
            after += res[1]
            count += 1
    print(f"完成 {count} 个文件：{before / 1048576:.1f} MB -> {after / 1048576:.1f} MB "
          f"（-{100 - after * 100 / max(before, 1):.0f}%）")


if __name__ == "__main__":
    main()
