import { describe, expect, it } from 'vitest';
import { contentGroups, filterByPick, normalizePick, pickKey } from './pick';
import type { Lang, Subject } from '../data/types';

const it_ = (id: string, lang: Lang, subject: Subject, unit: string) => ({ id, lang, subject, unit });
const LIST = [
  it_('a', 'ko', 'basic', '기본자리'),
  it_('b', 'ko', 'science', '1단원'),
  it_('c', 'ko', 'science', '2단원'),
  it_('d', 'en', 'english', 'Lesson 1'),
  it_('e', 'en', 'basic', 'English basic'),
];

describe('콘텐츠 선택', () => {
  it('normalizePick: 문자열만, 중복 없이, 정렬', () => {
    expect(normalizePick(['b', 'a', 'b', 3, '', null])).toEqual(['a', 'b']);
    expect(normalizePick(undefined)).toEqual([]);
    expect(normalizePick('x')).toEqual([]);
  });
  it('고르지 않으면 전체(같은 배열 그대로)', () => {
    expect(filterByPick(LIST, [])).toBe(LIST);
    expect(filterByPick(LIST, undefined)).toBe(LIST);
  });
  it('고른 단원만 남긴다(여러 개 가능)', () => {
    const pick = [pickKey('science', '1단원'), pickKey('english', 'Lesson 1'), pickKey('basic', '기본자리')];
    expect(filterByPick(LIST, pick).map((x) => x.id)).toEqual(['a', 'b', 'd']);
  });
  it('어떤 언어가 하나도 안 남으면 그 언어는 전체를 둔다', () => {
    expect(filterByPick(LIST, [pickKey('science', '2단원')]).map((x) => x.id)).toEqual(['c', 'd', 'e']);
    expect(filterByPick(LIST, ['없는|단원']).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('같은 단원 이름이라도 과목이 다르면 따로', () => {
    const list = [it_('x', 'ko', 'science', '1단원'), it_('y', 'ko', 'social', '1단원')];
    expect(filterByPick(list, [pickKey('social', '1단원')]).map((x) => x.id)).toEqual(['y']);
  });
  it('contentGroups: 과목 순서대로, 단원별 개수', () => {
    const g = contentGroups(LIST, [it_('s', 'ko', 'science', '1단원')], [it_('p', 'ko', 'korean', '읽기')]);
    expect(g.map((x) => x.key)).toEqual(['korean|읽기', 'english|Lesson 1', 'science|1단원', 'science|2단원', 'basic|기본자리', 'basic|English basic']);
    expect(g.find((x) => x.key === 'science|1단원')).toMatchObject({ words: 1, sentences: 1, passages: 0 });
  });
});
