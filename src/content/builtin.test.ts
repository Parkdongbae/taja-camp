import { describe, expect, it } from 'vitest';
import { BUILTIN } from './builtin';
import { isTypeable, normalizeText } from '../engine/hangul';
import type { Subject } from '../data/types';

const SUBJECTS: Subject[] = ['korean', 'english', 'math', 'science', 'social', 'basic'];

describe('내장 콘텐츠', () => {
  it('id 가 겹치지 않는다', () => {
    const ids = [...BUILTIN.words, ...BUILTIN.sentences, ...BUILTIN.passages].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('모든 과목에 낱말·단문·장문이 있다', () => {
    for (const s of SUBJECTS) {
      expect(BUILTIN.words.filter((w) => w.subject === s).length, `${s} 낱말`).toBeGreaterThanOrEqual(40);
      expect(BUILTIN.sentences.filter((w) => w.subject === s).length, `${s} 단문`).toBeGreaterThanOrEqual(8);
      expect(BUILTIN.passages.filter((w) => w.subject === s).length, `${s} 장문`).toBeGreaterThanOrEqual(2);
    }
  });
  it('모두 칠 수 있는 글자이고 뜻풀이가 있다', () => {
    for (const w of BUILTIN.words) {
      expect(isTypeable(normalizeText(w.text)), w.text).toBe(true);
      expect(w.meaning.trim().length, w.text).toBeGreaterThan(0);
    }
    for (const s of BUILTIN.sentences) expect(isTypeable(normalizeText(s.text)), s.text).toBe(true);
    for (const p of BUILTIN.passages) expect(isTypeable(normalizeText(p.text)), p.title).toBe(true);
  });
  it('같은 언어 안에서 낱말이 겹치지 않는다', () => {
    for (const lang of ['ko', 'en'] as const) {
      const texts = BUILTIN.words.filter((w) => w.lang === lang).map((w) => normalizeText(w.text).trim().toLowerCase());
      const dup = texts.filter((t, i) => texts.indexOf(t) !== i);
      expect(dup, lang).toEqual([]);
    }
  });
  it('과목 낱말의 언어: 영어 과목은 영어, 나머지 과목은 한국어', () => {
    for (const w of BUILTIN.words) {
      if (w.subject === 'basic') continue;
      expect(w.lang, w.text).toBe(w.subject === 'english' ? 'en' : 'ko');
    }
  });
});
