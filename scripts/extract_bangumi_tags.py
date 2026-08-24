#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
提取 CSV 中所有游戏在 Bangumi 数据库（subject.jsonlines）的 tags，统计并输出 xlsx。

- 匹配键: CSV 的「游戏名」（精确匹配 Bangumi name；未命中则按归一化名回退 name/name_cn）
- 统计口径: 每个游戏对某个 tag 至多计数 1 次（出现次数 = 打了该 tag 的游戏数）
- 输出: xlsx（tag名称, 出现次数），按出现次数降序、同名按名称升序

用法:
  python scripts/extract_bangumi_tags.py [--csv scripts/galgame_import.csv] [--bgm <subject.jsonlines>] [--out scripts/galgame_tags.xlsx]
"""

import argparse
import csv
import json
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict

from openpyxl import Workbook

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_DEFAULT = os.path.join(SCRIPT_DIR, "galgame_import.csv")
BGM_DEFAULT = r"C:\Users\emulation\Desktop\bgm_archive\subject.jsonlines"
OUT_DEFAULT = os.path.join(SCRIPT_DIR, "galgame_tags.xlsx")


def norm(s):
    """NFKC 全半角统一 + 小写 + 去空白和常见标点（与 match_ymgal.py 口径一致）。"""
    if not s:
        return ""
    s = unicodedata.normalize("NFKC", s).lower()
    return re.sub(r"[\s\-‐–—―~～〜·・:：;；,，。.．!！?？'’\"“”\[\]（）()【】「」『』<>《》&＆＊*/\\+＋=＝_｜|]+", "", s)


def load_bangumi_index(bgm_path):
    """流式扫描 subject.jsonlines，建立 type=4 游戏 名称 -> tags 索引。"""
    by_name = {}
    by_name_cn = {}
    by_norm = defaultdict(list)
    total = 0
    with open(bgm_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("type") != 4:
                continue
            total += 1
            tags = list(obj.get("tags") or [])
            name = (obj.get("name") or "").strip()
            name_cn = (obj.get("name_cn") or "").strip()
            if name:
                by_name.setdefault(name, tags)
                by_norm[norm(name)].append(tags)
            if name_cn:
                by_name_cn.setdefault(name_cn, tags)
    return by_name, by_name_cn, by_norm, total


def main():
    ap = argparse.ArgumentParser(description="CSV 游戏 -> Bangumi tags -> 统计 xlsx")
    ap.add_argument("--csv", default=CSV_DEFAULT, help=f"输入 CSV（默认: {CSV_DEFAULT}）")
    ap.add_argument("--bgm", default=BGM_DEFAULT, help=f"Bangumi subject.jsonlines（默认: {BGM_DEFAULT}）")
    ap.add_argument("--out", default=OUT_DEFAULT, help=f"输出 xlsx（默认: {OUT_DEFAULT}）")
    args = ap.parse_args()

    if not os.path.exists(args.bgm):
        sys.exit(f"[错误] 找不到 Bangumi 归档: {args.bgm}")
    if not os.path.exists(args.csv):
        sys.exit(f"[错误] 找不到 CSV: {args.csv}")

    # ── 读 CSV 游戏名 ──
    with open(args.csv, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    game_names = [(r.get("游戏名") or "").strip() for r in rows]
    game_names = [n for n in game_names if n]
    print(f"[tags] CSV 游戏数: {len(game_names)}")

    # ── 读 Bangumi ──
    print(f"[tags] 扫描 Bangumi 归档（type=4）: {args.bgm}")
    by_name, by_name_cn, by_norm, total_subjects = load_bangumi_index(args.bgm)
    print(f"[tags] type=4 条目: {total_subjects}")

    # ── 逐游戏匹配 ──
    counter = Counter()
    matched = 0
    unmatched = []
    for name in game_names:
        tags = by_name.get(name)
        if tags is None:
            tags = by_name_cn.get(name)
        if tags is None:
            key = norm(name)
            cands = by_norm.get(key, [])
            if len(cands) == 1:
                tags = cands[0]
        if tags is None:
            unmatched.append(name)
            continue
        matched += 1
        for tag in tags:
            tag_name = (tag.get("name") or "").strip()
            if tag_name:
                counter[tag_name] += 1

    # ── 排序 + 输出 ──
    items = sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))
    wb = Workbook()
    ws = wb.active
    ws.title = "tags"
    ws.append(["tag名称", "出现次数"])
    for tag_name, count in items:
        ws.append([tag_name, count])
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    ws.column_dimensions["A"].width = 40
    ws.column_dimensions["B"].width = 12
    wb.save(args.out)

    print(f"\n[完成] 输出 {len(items)} 个 tag -> {os.path.abspath(args.out)}")
    print(f"  匹配成功: {matched} / {len(game_names)}，未匹配: {len(unmatched)}")
    if unmatched:
        print("  未匹配游戏:")
        for n in unmatched:
            print(f"    - {n}")
    print("\n  Top 20:")
    for tag_name, count in items[:20]:
        print(f"    {count:4d}  {tag_name}")


if __name__ == "__main__":
    main()
