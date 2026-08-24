import { sify } from 'chinese-conv';

/** 繁体/日文汉字转简体，用于萌百标题匹配 */
export function toSimplified(value: string): string {
  return sify(value);
}

/** 搜索归一化：转简体、去空格、统一小写 */
export function normalizeSearchName(value: string): string {
  return toSimplified(value)
    .normalize('NFC')
    .replace(/\s+/g, '')
    .toLocaleLowerCase();
}
