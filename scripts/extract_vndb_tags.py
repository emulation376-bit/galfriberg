#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 VNDB 转储提取 tag，输出 xlsx（两个 sheet）:
  1. tag统计: 当前 CSV 游戏命中 VNDB 后，各 tag 的出现次数（按次数降序）
  2. 全部tag: VNDB tags 表全量（id/名称/分类/别名/简介），供参考与筛选

口径:
  - 游戏 -> VNDB VN 匹配: 复用 importVndbStaff 的 matchVn（exact -> 归一化唯一 -> 前缀唯一）
  - tag 是否属于某 VN: tags_vn 投票净值 > 0（官方文档: 1-3 为适用程度, 负票为"完全不适用"）；
    剔除 lie=t 与 ignore=1 的投票
  - 出现次数 = 打了该 tag 的游戏数（每个游戏至多计 1 次）

用法:
  python scripts/extract_vndb_tags.py [--csv scripts/galgame_import.csv] [--vndb VNDB/db] [--out scripts/galgame_vndb_tags.xlsx]
"""

import argparse
import csv
import os
import re
import sys
from collections import defaultdict

from openpyxl import Workbook

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_DEFAULT = os.path.join(SCRIPT_DIR, "galgame_import.csv")
VNDB_DEFAULT = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "VNDB", "db"))
OUT_DEFAULT = os.path.join(SCRIPT_DIR, "galgame_vndb_tags.xlsx")


def unescape(field):
    if field == "\\N":
        return None
    out = ""
    i = 0
    while i < len(field):
        if field[i] == "\\" and i + 1 < len(field):
            n = field[i + 1]
            mapping = {"t": "\t", "n": "\n", "r": "\r", "b": "\b", "f": "\f", "v": "\v"}
            out += mapping.get(n, n)
            i += 2
        else:
            out += field[i]
            i += 1
    return out


def norm(s):
    """与 importVndbStaff.ts 的 norm 完全一致。"""
    s = s.lower()
    s = re.sub(r"[！-～]", lambda m: chr(ord(m.group(0)) - 0xFEE0), s)
    s = re.sub(r"[‘’“”「」\"'«»]", '"', s)
    s = re.sub(r"[‐‑‒–—―−ー]", "-", s)
    s = re.sub(r"[〜～∼ヽ]", "~", s)
    s = re.sub(r"\s+", "", s)
    return s


def load_title_index(vndb_dir):
    """vn_titles + vn.alias -> {exact: {lower_title: vid}, norm: {norm_key: [vid]}}"""
    exact = {}
    norm_index = defaultdict(set)

    def add_key(key, vid):
        lk = key.lower()
        if lk not in exact:
            exact[lk] = vid
        nk = norm(key)
        if nk:
            norm_index[nk].add(vid)

    with open(os.path.join(vndb_dir, "vn_titles"), encoding="utf-8") as f:
        for line in f:
            c = line.rstrip("\n").split("\t")
            vid = c[0]
            title = unescape(c[3])
            latin = unescape(c[4])
            if title:
                add_key(title, vid)
            if latin:
                add_key(latin, vid)

    with open(os.path.join(vndb_dir, "vn"), encoding="utf-8") as f:
        for line in f:
            c = line.rstrip("\n").split("\t")
            vid = c[0]
            aliases = unescape(c[11])
            if not aliases:
                continue
            for a in aliases.split("\n"):
                t = a.strip()
                if t:
                    add_key(t, vid)
    return exact, dict(norm_index)


def match_vn(title, title_cn, aliases, exact, norm_index):
    for s in [title, title_cn, *aliases]:
        k = str(s).lower()
        if k:
            vid = exact.get(k)
            if vid:
                return vid
    for s in [title, title_cn, *aliases]:
        nk = norm(str(s))
        if not nk:
            continue
        vids = norm_index.get(nk)
        if vids and len(vids) == 1:
            return next(iter(vids))
    g_norm = norm(title)
    if len(g_norm) >= 2:
        hits = set()
        for nk, vids in norm_index.items():
            if len(vids) != 1:
                continue
            if len(nk) > len(g_norm) and nk.startswith(g_norm):
                hits.update(vids)
        if len(hits) == 1:
            return next(iter(hits))
    return None


def main():
    ap = argparse.ArgumentParser(description="VNDB tags -> 统计 xlsx")
    ap.add_argument("--csv", default=CSV_DEFAULT, help=f"输入 CSV（默认: {CSV_DEFAULT}）")
    ap.add_argument("--vndb", default=VNDB_DEFAULT, help=f"VNDB 转储目录（默认: {VNDB_DEFAULT}）")
    ap.add_argument("--out", default=OUT_DEFAULT, help=f"输出 xlsx（默认: {OUT_DEFAULT}）")
    args = ap.parse_args()

    # ── CSV 游戏 ──
    with open(args.csv, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    games = [(r["游戏名"].strip(), (r.get("中文名") or "").strip(),
              [a.strip() for a in (r.get("别名") or "").split("、") if a.strip()]) for r in rows if r["游戏名"].strip()]
    print(f"[vndb-tags] CSV 游戏: {len(games)}")

    # ── 标题索引 + 匹配 ──
    exact, norm_index = load_title_index(args.vndb)
    matched = {}
    unmatched = []
    for name, cn, aliases in games:
        vid = match_vn(name, cn, aliases, exact, norm_index)
        if vid:
            matched[name] = vid
        else:
            unmatched.append(name)
    print(f"[vndb-tags] VNDB 匹配: {len(matched)} / {len(games)}")
    for n in unmatched:
        print(f"  未匹配: {n}")

    # ── 投票聚合（仅匹配到的 vid）──
    wanted = set(matched.values())
    tally = defaultdict(lambda: {"sum": 0, "up": 0, "down": 0})
    with open(os.path.join(args.vndb, "tags_vn"), encoding="utf-8") as f:
        for line in f:
            c = line.rstrip("\n").split("\t")
            vid = c[2]
            if vid not in wanted:
                continue
            if c[6] == "t":  # lie
                continue
            if c[5] == "1":  # ignore
                continue
            vote = int(c[4])
            key = (vid, c[1])
            t = tally[key]
            t["sum"] += vote
            if vote > 0:
                t["up"] += 1
            else:
                t["down"] += 1

    present_by_game = defaultdict(set)
    for (vid, tag), t in tally.items():
        if t["sum"] > 0:
            present_by_game[vid].add(tag)

    # ── tags 表 ──
    tag_info = {}
    with open(os.path.join(args.vndb, "tags"), encoding="utf-8") as f:
        for line in f:
            c = line.rstrip("\n").split("\t")
            tag_info[c[0]] = {
                "cat": c[1],
                "searchable": c[3],
                "applicable": c[4],
                "name": unescape(c[5]) or "",
                "alias": "、".join(a for a in (unescape(c[6]) or "").split("\n") if a),
                "desc": unescape(c[7]) or "",
            }

    counts = defaultdict(int)
    for vid, tags in present_by_game.items():
        for tag in tags:
            if tag in tag_info:
                counts[tag] += 1

    # ── 输出 ──
    items = sorted(counts.items(), key=lambda kv: (-kv[1], tag_info[kv[0]]["name"].lower()))
    wb = Workbook()
    ws = wb.active
    ws.title = "tag统计"
    ws.append(["标签ID", "标签名称", "分类", "出现次数"])
    for tag, cnt in items:
        info = tag_info[tag]
        cat = {"cont": "content", "ero": "erotic", "tech": "tech"}.get(info["cat"], info["cat"])
        ws.append([tag, info["name"], cat, cnt])
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    for col, width in zip("ABCD", [10, 42, 10, 10]):
        ws.column_dimensions[col].width = width

    ws2 = wb.create_sheet("全部tag")
    ws2.append(["标签ID", "标签名称", "分类", "可搜索", "可应用", "别名", "简介"])
    for tag in sorted(tag_info, key=lambda t: int(t[1:])):
        info = tag_info[tag]
        cat = {"cont": "content", "ero": "erotic", "tech": "tech"}.get(info["cat"], info["cat"])
        ws2.append([tag, info["name"], cat, info["searchable"], info["applicable"], info["alias"], info["desc"]])
    ws2.freeze_panes = "A2"
    ws2.auto_filter.ref = ws2.dimensions
    for col, width in zip("ABCDEFG", [10, 42, 10, 10, 10, 40, 70]):
        ws2.column_dimensions[col].width = width

    wb.save(args.out)

    print(f"\n[完成] 统计 tag {len(items)} 个 -> {os.path.abspath(args.out)}")
    print(f"  全部 tag 参考: {len(tag_info)} 个（sheet: 全部tag）")
    print("\n  Top 20:")
    for tag, cnt in items[:20]:
        print(f"    {cnt:4d}  {tag_info[tag]['name']}")


if __name__ == "__main__":
    main()
