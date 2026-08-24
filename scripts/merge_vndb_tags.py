#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将 galgame_vndb_tags 里的若干细分标签合并为精简类别，输出 xlsx。

- 一个标签可同时属于多组（例如 g14 Mecha Combat 同时进“战斗”与“机甲”）。
- 次数统计按“游戏”去重：先把每款游戏命中的原始 tag 展开成其所属的组集合，
  再按组计数，因此同一款游戏重复打中组内多个标签只计 1 次。
- 未纳入任何合并组的标签保持原样输出。

用法:
  python scripts/merge_vndb_tags.py [--vndb VNDB/db] [--csv scripts/galgame_import.csv] [--out scripts/galgame_vndb_tags_merged.xlsx]
"""

import argparse
import os
from collections import defaultdict

from openpyxl import Workbook

from extract_vndb_tags import (
    SCRIPT_DIR,
    CSV_DEFAULT,
    VNDB_DEFAULT,
    unescape,
    load_title_index,
    match_vn,
)

OUT_DEFAULT = os.path.join(SCRIPT_DIR, "galgame_vndb_tags_merged.xlsx")

# 合并组：组名 -> 该组包含的原始 tag id
MERGES = {
    "现代设定": ["g143", "g60", "g221", "g470"],
    "奇幻": ["g2", "g1897", "g1765", "g994", "g3127"],
    "战斗": [
        "g25", "g63", "g66", "g72", "g36", "g44", "g77", "g78", "g79", "g14", "g80",
    ],
    "未来设定": ["g140", "g62", "g244", "g2786"],
    "虚拟实境/模拟": ["g442", "g2274"],
    "科幻": ["g105", "g106"],
    "机甲": ["g377", "g14"],
}

# 合并组的展示分类
GROUP_CAT = {
    "现代设定": "content",
    "奇幻": "content",
    "战斗": "content",
    "未来设定": "content",
    "虚拟实境/模拟": "content",
    "科幻": "content",
    "机甲": "content",
}

CAT_ZH = {"content": "content", "ero": "erotic", "tech": "tech"}


def build_tag_to_groups():
    """原始 tag id -> 该 tag 所属的所有组名。"""
    g2g = {}
    for grp, tags in MERGES.items():
        for t in tags:
            g2g.setdefault(t, []).append(grp)
    return g2g


def build_present_by_game(args, moved):
    """返回 {vid: set(组名或原tag)} 已在游戏层面去重。"""
    import csv
    from collections import defaultdict

    with open(args.csv, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    games = [
        (r["游戏名"].strip(), (r.get("中文名") or "").strip(),
         [a.strip() for a in (r.get("别名") or "").split("、") if a.strip()])
        for r in rows if r["游戏名"].strip()
    ]

    exact, norm_index = load_title_index(args.vndb)
    match = {}
    for name, cn, aliases in games:
        vid = match_vn(name, cn, aliases, exact, norm_index)
        if vid:
            match[name] = vid

    wanted = set(match.values())
    tally = defaultdict(lambda: {"sum": 0})
    with open(os.path.join(args.vndb, "tags_vn"), encoding="utf-8") as f:
        for line in f:
            c = line.rstrip("\n").split("\t")
            vid = c[2]
            if vid not in wanted:
                continue
            if c[6] == "t":
                continue
            if c[5] == "1":
                continue
            tally[(vid, c[1])]["sum"] += int(c[4])

    present_by_game = defaultdict(set)
    for (vid, tag), t in tally.items():
        if t["sum"] > 0:
            present_by_game[vid].add(tag)

    # 游戏层面去重：原始标签 -> 所属组集合
    game_group_sets = defaultdict(set)
    for vid, tags in present_by_game.items():
        for tag in tags:
            grps = moved.get(tag)
            if grps:
                game_group_sets[vid].update(grps)
            else:
                game_group_sets[vid].add(tag)
    return game_group_sets


def main():
    ap = argparse.ArgumentParser(description="VNDB 标签合并精简")
    ap.add_argument("--csv", default=CSV_DEFAULT, help=f"输入 CSV（默认: {CSV_DEFAULT}）")
    ap.add_argument("--vndb", default=VNDB_DEFAULT, help=f"VNDB 转储目录（默认: {VNDB_DEFAULT}）")
    ap.add_argument("--out", default=OUT_DEFAULT, help=f"输出 xlsx（默认: {OUT_DEFAULT}）")
    args = ap.parse_args()

    moved = build_tag_to_groups()

    # 标签信息
    tag_info = {}
    with open(os.path.join(args.vndb, "tags"), encoding="utf-8") as f:
        for line in f:
            c = line.rstrip("\n").split("\t")
            tag_info[c[0]] = {"cat": c[1], "name": unescape(c[5]) or ""}

    game_sets = build_present_by_game(args, moved)

    # 计数：组/标签 -> 命中游戏数
    counts = defaultdict(int)
    for tags in game_sets.values():
        for k in tags:
            counts[k] += 1

    # 输出：合并组的标签名用组名，分类用 GROUP_CAT；非合并标签用原名
    def label(k):
        if k in MERGES:
            return k
        info = tag_info.get(k)
        return info["name"] if info else k

    def cat(k):
        if k in MERGES:
            return GROUP_CAT.get(k, "content")
        info = tag_info.get(k)
        return CAT_ZH.get(info["cat"], info["cat"]) if info else "content"

    items = sorted(counts.items(), key=lambda kv: (-kv[1], label(kv[0]).lower()))

    wb = Workbook()
    ws = wb.active
    ws.title = "tag统计-合并"
    ws.append(["标签名称", "分类", "出现次数", "来源标签"])
    for k, cnt in items:
        src = "、".join(MERGES[k]) if k in MERGES else k
        ws.append([label(k), cat(k), cnt, src])
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions

    wb.save(args.out)
    print(f"[完成] 合并后 tag {len(items)} 个 -> {os.path.abspath(args.out)}")
    for k, cnt in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"   {cnt:>3}  {label(k):<26}  <- {'、'.join(MERGES[k]) if k in MERGES else '原标签'}")


if __name__ == "__main__":
    main()