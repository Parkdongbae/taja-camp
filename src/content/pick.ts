// 교사가 고른 콘텐츠(과목·단원)로 거르기. 순수 로직(React·백엔드 의존 없음).
//
// 공개 API
//   pickKey(subject, unit): string                  "과목|단원" 키(Settings.contentPick 에 저장하는 값)
//   normalizePick(x): string[]                      문자열만, 중복 없이, 정렬
//   filterByPick(list, pick): T[]                   pick 이 비어 있으면 전체. 고른 단원만 남기되,
//                                                   어떤 언어의 항목이 하나도 안 남으면 그 언어는 전체를 그대로 둔다(빈 화면 방지).
//   interface ContentGroup { key; subject; unit; words; sentences; passages }   단원별 개수
//   contentGroups(words, sentences, passages): ContentGroup[]   과목 순서 → 처음 나온 순서
import type { Lang, Subject } from '../data/types';

export const SUBJECT_ORDER: Subject[] = ['korean', 'english', 'math', 'science', 'social', 'basic'];

export const pickKey = (subject: string, unit: string) => `${subject}|${unit}`;

export function normalizePick(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return [...new Set(x.filter((v): v is string => typeof v === 'string' && v.length > 0))].sort();
}

export function filterByPick<T extends { lang: Lang; subject: Subject; unit: string }>(list: T[], pick: string[] | undefined | null): T[] {
  if (!pick || pick.length === 0) return list;
  const set = new Set(pick);
  const on = (x: T) => set.has(pickKey(x.subject, x.unit));
  const kept = new Set<Lang>();
  for (const x of list) if (on(x)) kept.add(x.lang);
  return list.filter((x) => (kept.has(x.lang) ? on(x) : true));
}

export interface ContentGroup {
  key: string;
  subject: Subject;
  unit: string;
  words: number;
  sentences: number;
  passages: number;
}

type Item = { subject: Subject; unit: string };
export function contentGroups(words: Item[], sentences: Item[], passages: Item[]): ContentGroup[] {
  const map = new Map<string, ContentGroup>();
  const add = (list: Item[], field: 'words' | 'sentences' | 'passages') => {
    for (const x of list) {
      const key = pickKey(x.subject, x.unit);
      let g = map.get(key);
      if (!g) map.set(key, (g = { key, subject: x.subject, unit: x.unit, words: 0, sentences: 0, passages: 0 }));
      g[field] += 1;
    }
  };
  add(words, 'words');
  add(sentences, 'sentences');
  add(passages, 'passages');
  const rank = (s: Subject) => {
    const i = SUBJECT_ORDER.indexOf(s);
    return i < 0 ? SUBJECT_ORDER.length : i;
  };
  // Map 은 넣은 순서를 지키므로 과목 순서로만 안정 정렬
  return [...map.values()].map((g, i) => ({ g, i })).sort((a, b) => rank(a.g.subject) - rank(b.g.subject) || a.i - b.i).map((x) => x.g);
}
