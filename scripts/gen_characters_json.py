#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate server/src/db/seeds/characters.json from the local SQLite database.

Usage:
  python scripts/gen_characters_json.py [--db server/data/csgofriberg.sqlite3]

The seed stores vndb_vid instead of numeric game ids so a fresh PostgreSQL
database can resolve game_titles ids after games.json is seeded.
"""
import argparse
import json
import os
import sqlite3
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(SCRIPT_DIR, ".."))
DB_DEFAULT = os.path.join(REPO, "server", "data", "csgofriberg.sqlite3")
OUT_DEFAULT = os.path.join(REPO, "server", "src", "db", "seeds", "characters.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DB_DEFAULT)
    ap.add_argument("--out", default=OUT_DEFAULT)
    args = ap.parse_args()

    if not os.path.exists(args.db):
        print(f"Database not found: {args.db}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row

    def select(sql, params=()):
        return [dict(row) for row in conn.execute(sql, params)]

    data = {
        "characters": select(
            "select id, name_cn, surname, given_name, image, ymgal_image, sex, birthday, height, age "
            "from characters order by id"
        ),
        "names": select(
            "select character_id, lang, name, latin from character_names order by character_id, lang"
        ),
        "aliases": select(
            "select character_id, name, latin, spoil from character_aliases order by character_id, spoil, name"
        ),
        "traits": select(
            "select character_id, trait_id, trait_name, group_id, group_name "
            "from character_traits order by character_id, group_id, trait_id"
        ),
        "voice_actors": select(
            "select character_id, staff_id, name from character_voice_actors order by character_id, staff_id"
        ),
        "appearances": select(
            "select character_id, vndb_vid, role, spoil, title, title_cn, release_date, bgm_score "
            "from character_game_appearances order by character_id, vndb_vid"
        ),
        "game_characters": select(
            "select character_id, vndb_vid, role, spoil from game_characters order by game_id, character_id"
        ),
    }
    conn.close()

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    counts = ", ".join(f"{k}={len(v)}" for k, v in data.items())
    size = os.path.getsize(args.out)
    print(f"[characters-seed] generated {args.out} ({size / 1024 / 1024:.2f} MiB)")
    print(f"[characters-seed] {counts}")


if __name__ == "__main__":
    main()
