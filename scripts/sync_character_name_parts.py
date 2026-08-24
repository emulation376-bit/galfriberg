#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""自动拆分角色姓/名并生成 CSV；存在 CSV 时以人工填写值为准。"""

import csv
import os
import re
import sqlite3
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
DB_PATH = os.path.join(REPO_ROOT, "server", "data", "csgofriberg.sqlite3")
CSV_PATH = os.path.join(REPO_ROOT, "character_name_parts.csv")


def load_existing_rows(force=False):
    if force or not os.path.exists(CSV_PATH):
        return {}
    result = {}
    with open(CSV_PATH, encoding="utf-8-sig") as file:
        for row in csv.DictReader(file):
            result[row["character_id"]] = {
                "surname": row.get("surname", "").strip(),
                "given_name": row.get("given_name", "").strip(),
            }
    return result


def split_name(name):
    if not name:
        return "", "", False
    parts = [part for part in re.split(r"[\s\u3000]+", name) if part]
    if len(parts) >= 2:
        return parts[0], "".join(parts[1:]), True
    return "", name, False


def map_split_to_display(display, surname, given_name):
    if not display or not surname or not given_name:
        return None
    if re.search(r"[\s\u3000]", display):
        return None
    if len(display) == len(surname) + len(given_name):
        return display[: len(surname)], display[len(surname):]
    return None


def main():
    existing = load_existing_rows(force="--force" in sys.argv)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    characters = cur.execute("select id, name_cn from characters").fetchall()
    names = cur.execute("select character_id, lang, name from character_names").fetchall()
    name_map = {}
    for row in names:
        cid = row["character_id"]
        name_map.setdefault(cid, []).append((row["lang"], row["name"]))

    rows = []
    auto_count = 0
    surname_count = 0
    given_count = 0
    for character in characters:
        cid = character["id"]
        display = (character["name_cn"] or "").strip()
        manual = existing.get(cid)
        if manual and (manual["surname"] or manual["given_name"]):
            surname = manual["surname"]
            given_name = manual["given_name"]
            auto = False
            status = "manual"
        else:
            source = display
            if not source or re.search(r"[\s\u3000]", source) is None:
                for lang in ("ja", "en", "zh-Hans", "zh-Hant"):
                    found = next((name for l, name in name_map.get(cid, []) if l == lang), None)
                    if found:
                        source = found
                        break
            surname, given_name, auto = split_name(source)
            if not auto:
                surname = ""
                given_name = display or source
            else:
                mapped = map_split_to_display(display, surname, given_name)
                if mapped:
                    surname, given_name = mapped
            status = "auto"
        rows.append({
            "character_id": cid,
            "name_cn": display,
            "surname": surname,
            "given_name": given_name,
            "auto_split": "1" if auto else "0",
            "status": status,
        })
        auto_count += auto
        surname_count += bool(surname)
        given_count += bool(given_name)

    with open(CSV_PATH, "w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=[
            "character_id",
            "name_cn",
            "surname",
            "given_name",
            "auto_split",
            "status",
        ])
        writer.writeheader()
        writer.writerows(rows)

    cur.executemany(
        "update characters set surname = ?, given_name = ? where id = ?",
        [(row["surname"] or None, row["given_name"] or None, row["character_id"]) for row in rows],
    )
    conn.commit()
    conn.close()

    print(f"characters: {len(rows)}")
    print(f"auto split: {auto_count}")
    print(f"surname filled: {surname_count}")
    print(f"given_name filled: {given_count}")
    print(f"CSV: {CSV_PATH}")


if __name__ == "__main__":
    main()
