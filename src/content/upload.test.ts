import { describe, expect, it } from 'vitest';
import type { SentenceItem, WordItem } from '../data/types';
import { isTypeable } from '../engine/hangul';
import { aiPrompt, extractJson, mergeBundles, removeUnit, typeableText, unitSummary } from './upload';

const w = (id: string, unit: string): WordItem => ({ id, text: '낱말', meaning: '뜻', lang: 'ko', subject: 'korean', unit, level: 1 });
const s = (id: string, unit: string): SentenceItem => ({ id, text: '문장', lang: 'ko', subject: 'korean', unit, level: 1 });

describe('콘텐츠 올리기 도우미', () => {
  it('AI 답에서 JSON 꺼내기', () => {
    expect(extractJson('네, 만들었습니다.\n```json\n{ "words": [] }\n```\n더 필요하면 말씀하세요')).toEqual({ words: [] });
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(() => extractJson('없음')).toThrow();
  });
  it('칠 수 없는 문장부호 바꾸기', () => {
    const t = typeableText('“봄”이 왔다… 꽃·나무 — 모두  ‘좋다’');
    expect(t).toBe('"봄"이 왔다... 꽃, 나무 - 모두 \'좋다\'');
    expect(isTypeable(t)).toBe(true);
  });
  it('더하기: 같은 단원은 바꾸고 나머지는 둔다, id 겹치면 이름 바꿈', () => {
    const old = { words: [w('w-1', '1단원'), w('w-2', '2단원')], sentences: [s('s-1', '1단원')], passages: [] };
    const add = { words: [w('w-9', '1단원'), w('w-2', '3단원')], sentences: [], passages: [] };
    const m = mergeBundles(old, add);
    expect(m.words.map((x) => `${x.id}:${x.unit}`)).toEqual(['w-2:2단원', 'w-9:1단원', 'w-2-2:3단원']);
    expect(m.sentences).toEqual([]); // 1단원은 통째로 바뀜
    expect(m.replacedUnits).toEqual(['korean|1단원']);
    expect(mergeBundles(null, add).words.length).toBe(2);
  });
  it('단원 목록과 단원 지우기', () => {
    const b = { words: [w('a', '1단원'), w('b', '2단원')], sentences: [s('c', '1단원')], passages: [] };
    expect(unitSummary(b).map((r) => [r.unit, r.words, r.sentences])).toEqual([
      ['1단원', 1, 1],
      ['2단원', 1, 0],
    ]);
    expect(unitSummary(removeUnit(b, 'korean', '1단원')).map((r) => r.unit)).toEqual(['2단원']);
  });
  it('프롬프트에 학년·과목이 들어간다', () => {
    const p = aiPrompt({ grade: 2, subject: 'korean' });
    expect(p).toContain('2학년 국어');
    expect(p).toContain('"subject": "korean"');
    expect(p).toContain('w-kor2-01-001');
    expect(aiPrompt({ grade: 1, subject: 'english' })).toContain('"lang": "en"');
  });
});
