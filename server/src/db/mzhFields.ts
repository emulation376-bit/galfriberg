/**
 * 萌百角色页 wikitext 字段提取。
 *
 * 只提取猜角色需要的字段，不保存页面快照。模板写法在不同角色页可能不一致，
 * 这里按常见 infobox 的 `|字段名 = 值` 结构解析，并兼容多行/单行两种写法。
 */

export interface MzhCharacterFields {
  name?: string;
  gender?: string;
  age?: string;
  height?: string;
  hair_color?: string;
  eye_color?: string;
  voice_actor?: string;
  series?: string;
  moe_points?: string;
}

const FIELD_ALIASES: Array<[keyof MzhCharacterFields, string[]]> = [
  ['name', ['姓名', '名字', '本名']],
  ['gender', ['性别']],
  ['age', ['年龄']],
  ['height', ['身高']],
  ['hair_color', ['发色']],
  ['eye_color', ['瞳色', '眼睛颜色']],
  ['voice_actor', ['声优', '配音']],
  ['series', ['所属作品', '登场作品']],
  ['moe_points', ['萌点', '萌属性']],
];

export function cleanMzhValue(raw: string): string {
  return raw
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/\{\{[^{}]*\}\}/g, ' ')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[、，,、\s]+|[、，,、\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function assignField(
  fields: MzhCharacterFields,
  key: string,
  value: string
): void {
  if (!value) return;
  for (const [field, aliases] of FIELD_ALIASES) {
    if (fields[field]) continue;
    if (aliases.includes(key)) fields[field] = value;
  }
}

export function parseMzhFields(wikitext: string): MzhCharacterFields {
  const fields: MzhCharacterFields = {};

  for (const line of wikitext.split('\n')) {
    const match = line.match(/^\s*\|\s*([^|=]+?)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = cleanMzhValue(match[2]);
    assignField(fields, key, value);
  }

  // 单行模板兜底：{{ACG人物信息|姓名=xx|发色=xx}} 这类写法
  const inlineRe = /\|\s*([^|=}]+?)\s*=\s*([^|}\n]+)/g;
  for (const match of wikitext.matchAll(inlineRe)) {
    const key = match[1].trim();
    const value = cleanMzhValue(match[2]);
    assignField(fields, key, value);
  }

  return fields;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)));
}

export function cleanHtmlValue(raw: string): string {
  const text = raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s*([、，,])\s*/g, '$1');
  return cleanMzhValue(decodeHtmlEntities(text));
}

/**
 * 萌百渲染后的角色页 infobox 结构：
 * `<span>字段名</span></div><div ...>字段值</div>`
 */
export function parseMzhFieldsFromHtml(html: string): MzhCharacterFields {
  const fields: MzhCharacterFields = {};
  for (const [field, aliases] of FIELD_ALIASES) {
    for (const alias of aliases) {
      const pattern = new RegExp(
        `<span[^>]*>${escapeRegex(alias)}</span>\\s*</div>\\s*<div[^>]*>([\\s\\S]*?)</div>`,
        'i'
      );
      const match = html.match(pattern);
      if (!match) continue;
      const value = cleanHtmlValue(match[1]);
      if (!value) continue;
      fields[field] = value;
      break;
    }
  }
  return fields;
}
