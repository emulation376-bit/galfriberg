import { describe, it, expect } from 'vitest';
import { compareGuess } from './gameService';
import { GameTitle } from '../types';

function makeGame(overrides: Partial<GameTitle>): GameTitle {
  return {
    id: 1,
    title: 'Ever17 -the out of infinity-',
    title_cn: '时空轮回',
    release_year: 2002,
    company: 'KID',
    is_r18: false,
    scenario_writer: '打越钢太郎、中泽工',
    music_composer: '阿保刚',
    artist: '泷泽泉',
    voice_actor: '雪野五月、高山みなみ',
    bgm_score: 8.6,
    is_active: true,
    is_enabled: true,
    created_at: '',
    ...overrides,
  };
}

describe('compareGuess', () => {
  const target = makeGame({ id: 10 });

  it('猜中时所有属性 correct', () => {
    const fb = compareGuess(target, target);
    expect(fb.correct).toBe(true);
    expect(Object.values(fb.attributes).every((a) => a.level === 'correct')).toBe(true);
  });

  it('发行年份相差 3 年给 close 并带方向提示', () => {
    const guess = makeGame({ id: 2, release_year: target.release_year - 3 });
    const fb = compareGuess(guess, target);
    expect(fb.attributes.releaseYear.level).toBe('close');
    // 猜的年份更早,目标年份更晚
    expect(fb.attributes.releaseYear.hint).toBe('higher');
  });

  it('发行年份相差 4 年给 wrong 并带方向提示', () => {
    const guess = makeGame({ id: 2, release_year: target.release_year + 4 });
    const fb = compareGuess(guess, target);
    expect(fb.attributes.releaseYear.level).toBe('wrong');
    expect(fb.attributes.releaseYear.hint).toBe('lower');
  });

  it('会社不同且首字母不同给 wrong', () => {
    const guess = makeGame({ id: 2, company: 'Nitro+' });
    expect(compareGuess(guess, target).attributes.company.level).toBe('wrong');
  });

  it('会社首字母相同给 close', () => {
    const guess = makeGame({ id: 2, company: 'Key' });
    expect(compareGuess(guess, target).attributes.company.level).toBe('close');
  });

  it('会社完全一致给 correct', () => {
    expect(compareGuess(target, target).attributes.company.level).toBe('correct');
  });

  it('限制级不同给 wrong', () => {
    const guess = makeGame({ id: 2, is_r18: true });
    expect(compareGuess(guess, target).attributes.isR18.level).toBe('wrong');
  });

  it('限制级支持数字 0/1 与布尔值互相比较', () => {
    const guess = makeGame({ id: 2, is_r18: 0 });
    expect(compareGuess(guess, target).attributes.isR18.level).toBe('correct');
  });

  it('剧本完全一致(顺序不同)给 correct', () => {
    const guess = makeGame({ id: 2, scenario_writer: '中泽工、打越钢太郎' });
    expect(compareGuess(guess, target).attributes.scenarioWriter.level).toBe('correct');
  });

  it('剧本有交集给 close', () => {
    const guess = makeGame({ id: 2, scenario_writer: '打越钢太郎' });
    expect(compareGuess(guess, target).attributes.scenarioWriter.level).toBe('close');
  });

  it('剧本无交集给 wrong', () => {
    const guess = makeGame({ id: 2, scenario_writer: '麻枝准' });
    expect(compareGuess(guess, target).attributes.scenarioWriter.level).toBe('wrong');
  });

  it('配乐有交集给 close', () => {
    const guess = makeGame({ id: 2, music_composer: '阿保刚、折户伸治' });
    expect(compareGuess(guess, target).attributes.musicComposer.level).toBe('close');
  });

  it('原画无交集给 wrong', () => {
    const guess = makeGame({ id: 2, artist: '樋上至' });
    expect(compareGuess(guess, target).attributes.artist.level).toBe('wrong');
  });

  it('声优完全一致(顺序不同)给 correct', () => {
    const guess = makeGame({ id: 2, voice_actor: '高山みなみ、雪野五月' });
    expect(compareGuess(guess, target).attributes.voiceActor.level).toBe('correct');
  });

  it('声优有交集给 close', () => {
    const guess = makeGame({ id: 2, voice_actor: '雪野五月、堀江由衣' });
    expect(compareGuess(guess, target).attributes.voiceActor.level).toBe('close');
  });

  it('声优无交集给 wrong', () => {
    const guess = makeGame({ id: 2, voice_actor: '林原めぐみ' });
    expect(compareGuess(guess, target).attributes.voiceActor.level).toBe('wrong');
  });

  it('双方都无声优时声优列给 correct(与 staff 空集行为一致)', () => {
    const guess = makeGame({ id: 2, voice_actor: '' });
    const silent = makeGame({ id: 10, voice_actor: '' });
    expect(compareGuess(guess, silent).attributes.voiceActor.level).toBe('correct');
  });

  it('BGM评分相差 0.3 以内给 close 并带方向提示', () => {
    const guess = makeGame({ id: 2, bgm_score: target.bgm_score - 0.3 });
    const fb = compareGuess(guess, target);
    expect(fb.attributes.bgmScore.level).toBe('close');
    expect(fb.attributes.bgmScore.hint).toBe('higher');
  });

  it('BGM评分相差超过 0.3 给 wrong 并带方向提示', () => {
    const guess = makeGame({ id: 2, bgm_score: target.bgm_score + 1.2 });
    const fb = compareGuess(guess, target);
    expect(fb.attributes.bgmScore.level).toBe('wrong');
    expect(fb.attributes.bgmScore.hint).toBe('lower');
  });

  it('BGM评分为字符串(数据库decimal)时仍可比较', () => {
    const guess = makeGame({ id: 2, bgm_score: '8.6' as unknown as number });
    expect(compareGuess(guess, target).attributes.bgmScore.level).toBe('correct');
  });

  it('tag 超过 5 个时从 4 开始截断并返回 +N，恰好 5 个时全显示', () => {
    const target = makeGame({ id: 10, tags: ['A', 'B'] });
    const guess6 = makeGame({ id: 2, tags: ['A', 'B', 'C', 'D', 'E', 'F'] });
    const fb6 = compareGuess(guess6, target).attributes.tags;
    expect(fb6.parts).toHaveLength(4);
    expect(fb6.omitted).toBe(2);

    const guess5 = makeGame({ id: 2, tags: ['A', 'B', 'C', 'D', 'E'] });
    const fb5 = compareGuess(guess5, target).attributes.tags;
    expect(fb5.parts).toHaveLength(5);
    expect(fb5.omitted).toBeUndefined();
  });

  it('staff 超过 5 个时从 4 开始截断并返回 +N，恰好 5 个时全显示', () => {
    const target = makeGame({ id: 10, scenario_writer: 'S1' });
    const guess6 = makeGame({ id: 2, scenario_writer: 'S1、S2、S3、S4、S5、S6' });
    const fb6 = compareGuess(guess6, target).attributes.scenarioWriter;
    expect(fb6.parts).toHaveLength(4);
    expect(fb6.omitted).toBe(2);

    const guess5 = makeGame({ id: 2, scenario_writer: 'S1、S2、S3、S4、S5' });
    const fb5 = compareGuess(guess5, target).attributes.scenarioWriter;
    expect(fb5.parts).toHaveLength(5);
    expect(fb5.omitted).toBeUndefined();
  });
});
