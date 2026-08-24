import { describe, expect, it } from 'vitest';
import { parseMzhFields, parseMzhFieldsFromHtml } from './mzhFields';

describe('parseMzhFields', () => {
  it('extracts fields from a multiline character infobox', () => {
    const wikitext = `{{ACG人物信息
|姓名 = 古河渚
|性别 = 女
|年龄 = 17（初登场）
|身高 = 155cm
|发色 = 棕
|瞳色 = 棕
|声优 = 中原麻衣
|所属作品 = CLANNAD
|萌点 = [[天然呆]]、{{ruby|软妹|ねこ}}
}}`;

    expect(parseMzhFields(wikitext)).toEqual({
      name: '古河渚',
      gender: '女',
      age: '17（初登场）',
      height: '155cm',
      hair_color: '棕',
      eye_color: '棕',
      voice_actor: '中原麻衣',
      series: 'CLANNAD',
      moe_points: '天然呆',
    });
  });

  it('extracts fields from a single-line template', () => {
    const wikitext = '{{ACG人物信息|姓名=雷姆|性别=女|发色=蓝|瞳色=蓝}}';
    expect(parseMzhFields(wikitext)).toEqual({
      name: '雷姆',
      gender: '女',
      hair_color: '蓝',
      eye_color: '蓝',
    });
  });

  it('returns an empty object when no known fields are present', () => {
    expect(parseMzhFields('{{其他模板|foo=bar}}')).toEqual({});
  });

  it('extracts fields from a rendered HTML infobox', () => {
    const html = `<div style="display:flex"><div><span>发色</span></div><div><a title="棕">棕</a></div></div>
<div style="display:flex"><div><span>声优</span></div><div><a title="中原麻衣">中原麻衣</a></div></div>
<div style="display:flex"><div><span>萌点</span></div><div><a title="天然呆">天然呆</a>、<a title="治愈系">治愈系</a></div></div>`;

    expect(parseMzhFieldsFromHtml(html)).toEqual({
      hair_color: '棕',
      voice_actor: '中原麻衣',
      moe_points: '天然呆、治愈系',
    });
  });
});
