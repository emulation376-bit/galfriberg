import { GameTitle, GuessFeedback, AttributeFeedback, displayName } from '../types';
import { identityStaff, displayStaff, resolveStaffName, staffFrequency } from './staffResolver';
import { tagFrequency } from './tagResolver';

const BGM_SCORE_CLOSE_RANGE = 0.3;
const RELEASE_YEAR_CLOSE_RANGE = 3;
/** staff 单人 chip 默认最多显示 4 个；命中的 staff 不受限制（必显示） */
const STAFF_VISIBLE_MAX = 4;

/** 时长分类（VNDB 5 类）；顺序索引用于相邻判定 */
const LENGTH_ORDER: Record<string, number> = { veryshort: 0, short: 1, medium: 2, long: 3, verylong: 4 };

function lengthKey(minutes: number): string {
  if (!minutes || minutes <= 0) return 'unknown';
  if (minutes < 120) return 'veryshort'; // <2h
  if (minutes < 600) return 'short'; // 2-10h
  if (minutes < 1800) return 'medium'; // 10-30h
  if (minutes < 3000) return 'long'; // 30-50h
  return 'verylong'; // >50h
}

/** 时长：同档 correct（绿）；相邻档 close（黄）；否则 wrong。箭头提示目标更长/更短 */
function lengthAttr(guessMinutes: number, targetMinutes: number): AttributeFeedback {
  const g = lengthKey(guessMinutes);
  const t = lengthKey(targetMinutes);
  const gi = LENGTH_ORDER[g];
  const ti = LENGTH_ORDER[t];
  let level: AttributeFeedback['level'];
  if (gi === undefined && ti === undefined) level = 'correct';
  else if (gi === undefined || ti === undefined) level = 'wrong';
  else if (gi === ti) level = 'correct';
  else if (Math.abs(gi - ti) === 1) level = 'close';
  else level = 'wrong';
  const hint =
    gi !== undefined && ti !== undefined && gi !== ti ? (ti > gi ? 'higher' : 'lower') : undefined;
  return { value: g, level, ...(hint ? { hint } : {}) };
}

function textAttr(guess: string, target: string): AttributeFeedback {
  return { value: guess, level: guess === target ? 'correct' : 'wrong' };
}

/** 会社锛氬畬鍏ㄧ浉鍚?correct锛涢娆″瓧姣嶇浉鍚?close锛堥粍锛?鍚﹀垯 wrong */
function companyAttr(guess: string, target: string): AttributeFeedback {
  if (guess === target) return { value: guess, level: 'correct' };
  const first = (s: string) => {
    const ch = [...s.trim().normalize('NFKC')][0] ?? '';
    return ch ? ch.toLocaleLowerCase() : '';
  };
  const level = first(guess) && first(guess) === first(target) ? 'close' : 'wrong';
  return { value: guess, level };
}

/** tag 锛堝銆佸垎闅旓級锛氶泦鍚堝畬鍏ㄧ浉鍚?correct锛屾湁浜ら泦 close锛屽惁鍒?wrong */
/** tag （、分隔）：集合完全相同 correct，有交集 close，否则 wrong。
 * 展示优先级：命中必显示；其余按出现频率降序；再按原始顺序兜底。
 * 规则1：总数 <=5 全显示；>5 时从 4 开始截断，最多显示 5 个 cell（4 个值 + +N）。 */
function tagAttr(guessTags: string[], targetTags: string[]): AttributeFeedback {
  const guessSet = new Set(guessTags);
  const targetSet = new Set(targetTags);
  const value = guessTags.join('\u3001');
  const ranked = [...guessSet]
    .map((tag, index) => ({
      name: tag,
      matched: targetSet.has(tag),
      freq: tagFrequency(tag),
      index,
    }))
    .sort((a, b) => {
      if (a.matched !== b.matched) return a.matched ? -1 : 1;
      if (b.freq !== a.freq) return b.freq - a.freq;
      return a.index - b.index;
    });
  const visibleCount = ranked.length <= 5 ? ranked.length : 4;
  const visible = ranked.slice(0, visibleCount);
  const omittedCount = ranked.length - visible.length;
  const parts = visible.map(({ name, matched }) => ({ name, matched }));
  if (guessSet.size === targetSet.size && [...guessSet].every((tag) => targetSet.has(tag)))
    return { value, level: 'correct', parts, ...(omittedCount > 0 ? { omitted: omittedCount } : {}) };
  if ([...guessSet].some((tag) => targetSet.has(tag)))
    return { value, level: 'close', parts, ...(omittedCount > 0 ? { omitted: omittedCount } : {}) };
  return { value, level: 'wrong', parts, ...(omittedCount > 0 ? { omitted: omittedCount } : {}) };
}

/** 限制级：R18 / 全年龄，相同 correct 否则 wrong */
function boolAttr(guess: boolean, target: boolean): AttributeFeedback {
  return { value: guess, level: guess === target ? 'correct' : 'wrong' };
}

/** 多人 staff 字段（、分隔）：按 staff 身份（主名/别名归一为同一人）完全一致 correct，有交集 close，否则 wrong */
function staffAttr(guess: string, target: string): AttributeFeedback {
  const guessSet = identityStaff(guess);
  const targetSet = identityStaff(target);
  const value = displayStaff(guess);
  const rawParts = guess
    .split('、')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const { staffId } = resolveStaffName(raw);
      return {
        name: displayStaff(raw),
        matched: targetSet.has(staffId),
        freq: staffFrequency(staffId),
      };
    });
  // 展示优先级：命中的必然显示；其余按总表出现次数降序；再按原始顺序兜底
  const ranked = rawParts
    .map((p, i) => ({ ...p, idx: i }))
    .sort((a, b) => {
      if (a.matched !== b.matched) return a.matched ? -1 : 1;
      if (b.freq !== a.freq) return b.freq - a.freq;
      return a.idx - b.idx;
    });
  // 规则1：总数 <=5 全显示；>5 时从 4 开始截断，最多显示 5 个 cell（4 个值 + +N）。
  // 展示优先级保持：命中必显示；其余按出现频率降序。
  const visibleCount = ranked.length <= 5 ? ranked.length : STAFF_VISIBLE_MAX;
  const visible = ranked.slice(0, visibleCount);
  const omittedCount = ranked.length - visible.length;
  const parts = visible.map(({ name, matched }) => ({ name, matched }));
  if (guessSet.size === targetSet.size && [...guessSet].every((id) => targetSet.has(id)))
    return { value, level: 'correct', parts, ...(omittedCount > 0 ? { omitted: omittedCount } : {}) };
  if ([...guessSet].some((id) => targetSet.has(id)))
    return { value, level: 'close', parts, ...(omittedCount > 0 ? { omitted: omittedCount } : {}) };
  return { value, level: 'wrong', parts, ...(omittedCount > 0 ? { omitted: omittedCount } : {}) };
}

function numberAttr(
  guessVal: number,
  targetVal: number,
  closeRange: number
): AttributeFeedback {
  if (guessVal === targetVal) return { value: guessVal, level: 'correct' };
  // 微小容差吸收 IEEE 754 浮点误差(如 8.5 - 0.3 = 8.2 的差略大于 0.3)
  const level = Math.abs(guessVal - targetVal) <= closeRange + 1e-9 ? 'close' : 'wrong';
  return {
    value: guessVal,
    level,
    hint: targetVal > guessVal ? 'higher' : 'lower',
  };
}

/** 逐属性对比猜测作品与目标作品，产出反馈 */
export function compareGuess(guess: GameTitle, target: GameTitle): GuessFeedback {
  const correct = guess.id === target.id;
  return {
    gameId: guess.id,
    title: displayName(guess),
    correct,
    attributes: {
      releaseYear: numberAttr(guess.release_year, target.release_year, RELEASE_YEAR_CLOSE_RANGE),
      company: companyAttr(guess.company, target.company),
      isR18: boolAttr(Boolean(guess.is_r18), Boolean(target.is_r18)),
      scenarioWriter: staffAttr(guess.scenario_writer, target.scenario_writer),
      musicComposer: staffAttr(guess.music_composer, target.music_composer),
      artist: staffAttr(guess.artist, target.artist),
      voiceActor: staffAttr(guess.voice_actor, target.voice_actor),
      tags: tagAttr(guess.tags ?? [], target.tags ?? []),
      bgmScore: numberAttr(Number(guess.bgm_score), Number(target.bgm_score), BGM_SCORE_CLOSE_RANGE),
      isSeries: boolAttr(Boolean(guess.is_series), Boolean(target.is_series)),
      length: lengthAttr(Number(guess.length_minutes), Number(target.length_minutes)),
    },
  };
}

export const MAX_GUESSES = 8;
