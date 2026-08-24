#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 galgame_import.csv 生成 server/src/db/seeds/games.json（生产种子，全字段）。

用法:
  python scripts/gen_games_json.py [--csv scripts/galgame_import.csv]

生成后重新构建 Docker 镜像即可把最新数据固化进镜像。
"""
import argparse
import csv
import json
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(SCRIPT_DIR, ".."))
CSV_DEFAULT = os.path.join(REPO, "scripts", "galgame_import.csv")
OUT_DEFAULT = os.path.join(REPO, "server", "src", "db", "seeds", "games.json")


def split_list(value):
    return [x.strip() for x in str(value or "").split("、") if x.strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=CSV_DEFAULT)
    ap.add_argument("--out", default=OUT_DEFAULT)
    args = ap.parse_args()

    with open(args.csv, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    tag_cols = [k for k in rows[0].keys() if re.fullmatch(r"tag\d+", k)]
    games = []
    for r in rows:
        title = (r.get("游戏名") or "").strip()
        if not title:
            continue
        year = (r.get("发行年份") or "").strip()
        score = (r.get("平均分") or "").strip()
        minutes = (r.get("时长分钟") or "").strip()
        vndb_id = (r.get("vndb_id") or "").strip()
        game = {
            "title": title,
            "title_cn": (r.get("中文名") or "").strip(),
            "release_year": int(year) if year.isdigit() else 0,
            "company": (r.get("品牌") or "").strip(),
            "is_r18": (r.get("限制级") or "").strip() == "R18",
            "scenario_writer": (r.get("脚本") or "").strip(),
            "music_composer": (r.get("音乐") or "").strip(),
            "artist": (r.get("原画") or "").strip(),
            "voice_actor": (r.get("声优") or "").strip(),
            "bgm_score": float(score) if score else 0,
            "difficulties": split_list(r.get("难度")),
            "is_active": True,
            "is_enabled": True,
            "is_series": (r.get("系列作") or "").strip() == "是",
            "length_minutes": int(minutes) if minutes.isdigit() else 0,
            "tags": [r[k] for k in tag_cols if (r.get(k) or "").strip()],
            "aliases": split_list(r.get("别名")),
        }
        if vndb_id:
            game["vndb_id"] = vndb_id
        games.append(game)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(games, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"[gen-games-json] 已生成 {len(games)} 款 -> {os.path.abspath(args.out)}")
    with_tags = sum(1 for g in games if g["tags"])
    with_voice = sum(1 for g in games if g["voice_actor"])
    with_series = sum(1 for g in games if g["is_series"])
    print(f"  有 tag: {with_tags} | 有声优: {with_voice} | 系列作: {with_series}")


if __name__ == "__main__":
    main()
