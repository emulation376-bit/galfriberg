#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从数据库导出五类 tag 的翻译 CSV，并同步生成前端 characterTraits.ts。"""

import csv
import os
import re
import sqlite3

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
DB_PATH = os.path.join(REPO_ROOT, "server", "data", "csgofriberg.sqlite3")
CSV_PATH = os.path.join(REPO_ROOT, "tag_translations.csv")
TS_PATH = os.path.join(REPO_ROOT, "client", "src", "utils", "characterTraits.ts")

EXTRA_CN = {
    "Big Breast Sizes": "大罩杯",
    "Big Breasts": "巨乳",
    "Kid": "儿童",
    "Prosthesis": "义肢",
    "Younger Appearance": "显年轻",
    "Ankle Socks": "短袜",
    "Bandages": "绷带",
    "Barefoot": "赤足",
    "Belt": "腰带",
    "Blanket": "毯子",
    "Blazer School Uniform": "西装校服",
    "Blouse": "衬衫",
    "Choker": "项圈",
    "Clothing with Ribbons": "蝴蝶结服饰",
    "Cravat": "领巾",
    "Cuffs": "袖口",
    "Dress": "连衣裙",
    "Dress Shoes": "皮鞋",
    "Furisode": "振袖",
    "Goggles": "护目镜",
    "Hair Flower": "发花",
    "Hair Ribbon": "发带",
    "Hair Tie": "发绳",
    "Hairpin": "发夹",
    "Headband": "发箍",
    "Hospital Gown": "病号服",
    "Maid's Dress": "女仆装",
    "Maid's Headdress": "女仆头饰",
    "Mary Jane": "玛丽珍鞋",
    "Mini-dress": "迷你连衣裙",
    "Monocle": "单片眼镜",
    "Necktie": "领带",
    "One Piece Swimsuit": "连体泳装",
    "Overall": "背带裤",
    "Pantyhose": "连裤袜",
    "Pendant Necklace": "吊坠项链",
    "Police Officer Uniform": "警服",
    "Power Armor": "动力装甲",
    "Puffy Sleeves": "泡泡袖",
    "Ribbon Hair Accessory": "蝴蝶结发饰",
    "Ribbon Tie": "蝴蝶结",
    "Robe": "长袍",
    "Sailor School Uniform": "水手服",
    "Sandals": "凉鞋",
    "School Swimsuit": "学校泳装",
    "Shirt": "衬衫",
    "Skirt": "裙子",
    "Sport Bloomers": "运动短裤",
    "Sports Shoes": "运动鞋",
    "String Ribbon Tie": "绳结蝴蝶结",
    "T-shirt": "T恤",
    "Tank Top": "背心",
    "Towel": "毛巾",
    "Trousers": "长裤",
    "Unusual Hair Ornaments": "奇特发饰",
    "Zouri": "草履",
    "Cyan": "青色",
    "Garnet": "石榴石色",
    "Hazel": "榛色",
    "Hidden": "隐藏眼睛",
    "Hosome": "细长眼",
    "Jitome": "半睁眼",
    "Round": "圆眼",
    "Sanpaku Eyes": "三白眼",
    "Teal": "蓝绿色",
    "Blond": "金色",
    "Blunt Bangs": "齐刘海",
    "Intake": "耳后发",
    "Parted in Middle": "中分",
    "Parted to Side": "侧分",
    "Side Tail": "侧马尾",
    "V Bangs": "V形刘海",
    "Adventurer": "冒险者",
    "Ane Act": "姐系",
    "Animator": "动画师",
    "Antihero": "反英雄",
    "Apprentice": "学徒",
    "Bad Student": "不良学生",
    "Bisexual": "双性恋",
    "Bodyguard": "保镖",
    "Brother-in-law": "姻亲兄弟",
    "Cat": "猫",
    "Christian Nun": "修女",
    "Class President": "班长",
    "Commander": "指挥官",
    "Cousin": "表亲",
    "Coworker": "同事",
    "Domestic Partner": "同居伴侣",
    "Dormitory Manager": "宿舍管理员",
    "Eighth Grader": "八年级学生",
    "Eleventh Grader": "高二学生",
    "Ex-boyfriend": "前男友",
    "Executive": "高管",
    "Extraterrestrial": "外星人",
    "Farmer": "农民",
    "Foreigner": "外国人",
    "Full Brother": "亲兄弟",
    "Full Sister": "亲姐妹",
    "Gamer": "玩家",
    "Gang Leader": "黑帮老大",
    "Granddaughter": "孙女",
    "Guide": "向导",
    "Hacker": "黑客",
    "Half-Japanese": "混血日本人",
    "Half-orphan": "半孤儿",
    "Hikikomori": "家里蹲",
    "Honor Student": "优等生",
    "Imouto Act": "妹系",
    "Japanese (Expatriate)": "日裔侨民",
    "Journalist": "记者",
    "Kanban Musume": "看板娘",
    "Kouhai": "后辈",
    "Legal Guardian": "监护人",
    "Living Alone": "独居",
    "Living Doll": "人偶",
    "Lonely": "孤独",
    "Magician": "魔术师",
    "Mahou Shoujo": "魔法少女",
    "Mail Carrier": "邮递员",
    "Mecha Pilot": "机甲驾驶员",
    "Mechanic": "机械师",
    "Medical Doctor": "医生",
    "Multilingual": "多语言",
    "Neighbor": "邻居",
    "Not a Virgin": "非处",
    "Novelist": "小说家",
    "Ojousama": "大小姐",
    "Online Streamer": "网络主播",
    "Orphan": "孤儿",
    "Part-time Worker": "兼职",
    "Pet Owner": "宠物主人",
    "Police": "警察",
    "Popular": "受欢迎",
    "Prisoner": "囚犯",
    "Producer": "制作人",
    "Psychic": "超能力者",
    "Roommate": "室友",
    "Runaway": "离家出走",
    "School Literature Club Member": "文学社成员",
    "School Nurse": "校医",
    "Schoolmate": "校友",
    "Sculptor": "雕塑家",
    "Senpai": "前辈",
    "Servant": "仆人",
    "Shinigami": "死神",
    "Slave Owner": "奴隶主",
    "Sniper": "狙击手",
    "Superstrength": "超人力量",
    "Telepath": "心灵感应者",
    "Tenth Grader": "高一学生",
    "Title Character": "标题角色",
    "Tsukkomi": "吐槽役",
    "Twelfth Grader": "高三学生",
    "Uncle": "叔父",
    "University Student": "大学生",
    "Unpopular": "不受欢迎",
    "Vendor": "摊贩",
    "Waitstaff": "服务员",
    "Warrior": "战士",
    "Wealthy": "富有",
    "Skirt Suit": "裙装套装",
    "Capri Pants": "七分裤",
    "Leggings": "紧身裤",
    "Crop Top": "露脐上衣",
    "Shrug": "开衫披肩",
    "Chaps": "皮套裤",
    "Sweatpants": "运动裤",
    "Sports Jersey": "运动衫",
    "Cardigan": "开襟毛衣",
    "Off-The-Shoulder Shirt": "露肩衬衫",
    "Half-Skirt": "半裙",
    "Microskirt": "超短裙",
    "Jeans": "牛仔裤",
    "Kilt": "苏格兰裙",
    "Blazer": "西装外套",
    "Slit Skirt": "开叉裙",
    "Leather Jacket": "皮夹克",
    "Aloha Shirt": "夏威夷衬衫",
    "Polo Shirt": "Polo衫",
    "Baggy Pants": "宽松裤",
    "Turtleneck Tank Top": "高领背心",
    "Off-The-Shoulder Sweater": "露肩毛衣",
    "Sleeveless Sweater": "无袖毛衣",
    "Sleeveless Turtleneck Sweater": "无袖高领毛衣",
    "Kimono Jacket": "和服外套",
    "Kimono Mini Skirt": "和服迷你裙",
    "Yoga Pants": "瑜伽裤",
    "Formal Shirt": "正式衬衫",
    "Leather Trousers": "皮裤",
    "Pocket Shirt": "口袋衬衫",
    "Turtleneck Crop Top": "高领露脐上衣",
    "Backless Sweater": "露背毛衣",
    "Tied-up shirt": "系结衬衫",
    "Cargo Pants": "工装裤",
    "Upper Body Clothing": "上衣",
    "Vest": "背心",
    "Sweater": "毛衣",
    "Tube Top": "抹胸上衣",
    "Turtleneck Sweater": "高领毛衣",
    "Turtleneck Shirt": "高领衬衫",
    "Decorative Belt": "装饰腰带",
    "Knee-high Boots": "及膝靴",
    "Naked Shirt": "裸露衬衫",
    "Ring": "戒指",
    "Thigh-high Boots": "过膝靴",
    "Witch Hat": "巫师帽",
}


def load_existing_csv_map():
    if not os.path.exists(CSV_PATH):
        return {}
    text = open(CSV_PATH, encoding="utf-8-sig").read()
    result = {}
    for row in csv.DictReader(text.splitlines()):
        result[row["trait_name_en"]] = row["trait_name_cn"]
    return result


def load_existing_ts_map():
    if not os.path.exists(TS_PATH):
        return {}
    text = open(TS_PATH, encoding="utf-8").read()
    result = {}
    for match in re.finditer(
        r'^    "([^"]+)\\u0000([^"]+)": "([^"]+)",?$',
        text,
        re.M,
    ):
        result[(match.group(1), match.group(2))] = match.group(3)
    return result


def main():
    existing = load_existing_csv_map()
    existing_ts = load_existing_ts_map()
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    total = cur.execute("select count(*) from characters").fetchone()[0]
    rows = cur.execute(
        """
        select trait_id, trait_name, group_name, count(distinct character_id)
        from character_traits
        group by trait_id, trait_name, group_name
        order by group_name, trait_name
        """
    ).fetchall()
    conn.close()

    with open(CSV_PATH, "w", newline="", encoding="utf-8-sig") as file:
        writer = csv.writer(file)
        writer.writerow([
            "trait_id",
            "trait_name_en",
            "trait_name_cn",
            "group_name",
            "character_count",
            "frequency_pct",
        ])
        for trait_id, en, group, count in rows:
            cn = existing.get(en) or existing_ts.get((group, en)) or EXTRA_CN.get(en) or en
            writer.writerow([
                trait_id,
                en,
                cn or "",
                group,
                count,
                round(count / total * 100, 2),
            ])

    entries = []
    with open(CSV_PATH, encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)
        for row in reader:
            group = row["group_name"].replace('"', '\\"')
            en = row["trait_name_en"].replace('"', '\\"')
            cn = row["trait_name_cn"].replace('"', '\\"')
            key = f"{group}\\u0000{en}"
            entries.append(f'    "{key}": "{cn}",')

    lines = [
        "const TRAIT_LABELS: Record<string, string> = {",
        *entries,
        "};",
        "",
        "export function characterTraitLabel(name: string, group?: string): string {",
        "  const key = group ? `${group}\\u0000${name}` : name;",
        "  return TRAIT_LABELS[key] ?? TRAIT_LABELS[name] ?? name;",
        "}",
        "",
    ]
    with open(TS_PATH, "w", encoding="utf-8") as file:
        file.write("\n".join(lines))

    print(f"CSV: {CSV_PATH}")
    print(f"TS: {TS_PATH}")
    print(f"tags: {len(entries)}")


if __name__ == "__main__":
    main()
