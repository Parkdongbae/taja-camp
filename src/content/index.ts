// 콘텐츠 로더: 내장 기초 콘텐츠 + 교사가 올린 교과 콘텐츠를 합쳐 제공한다.
//   useContent(): { loaded, hasTextbook, version, words, sentences, passages }
//   loadContent(force?): 로그인 후 1회 호출
//   pickWords / pickSentences / pickPassages(lang, subject): 언어·과목으로 거르기
//   subjectsFor(kind, lang): 콘텐츠가 있는 과목 목록,  shuffle(arr, rand?)
import { create } from 'zustand';
import { backend } from '../data';
import type { Lang, PassageItem, SentenceItem, Subject, WordItem } from '../data/types';
import { BUILTIN } from './builtin';

interface ContentState {
  loaded: boolean;
  hasTextbook: boolean; // 교사가 올린 교과 콘텐츠가 있는가
  version: string;
  words: WordItem[];
  sentences: SentenceItem[];
  passages: PassageItem[];
}

export const useContent = create<ContentState>(() => ({
  loaded: false,
  hasTextbook: false,
  version: BUILTIN.version,
  words: BUILTIN.words,
  sentences: BUILTIN.sentences,
  passages: BUILTIN.passages,
}));

let loading: Promise<void> | null = null;
export function loadContent(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = (async () => {
    try {
      const up = await backend.getContent();
      if (up) {
        useContent.setState({
          loaded: true,
          hasTextbook: true,
          version: up.version,
          words: [...BUILTIN.words, ...up.words],
          sentences: [...BUILTIN.sentences, ...up.sentences],
          passages: [...BUILTIN.passages, ...up.passages],
        });
        return;
      }
    } catch {
      // 콘텐츠를 못 받아도 내장 콘텐츠로 계속한다.
    }
    useContent.setState({ loaded: true });
  })();
  return loading;
}

export type SubjectFilter = Subject | 'all';
function bySubject<T extends { lang: Lang; subject: Subject }>(list: T[], lang: Lang, subject: SubjectFilter): T[] {
  return list.filter((x) => x.lang === lang && (subject === 'all' || x.subject === subject));
}
export const pickWords = (lang: Lang, subject: SubjectFilter) => bySubject(useContent.getState().words, lang, subject);
export const pickSentences = (lang: Lang, subject: SubjectFilter) => bySubject(useContent.getState().sentences, lang, subject);
export const pickPassages = (lang: Lang, subject: SubjectFilter) => bySubject(useContent.getState().passages, lang, subject);

/** 해당 언어에 콘텐츠가 있는 과목 목록(선택 상자용). */
export function subjectsFor(kind: 'words' | 'sentences' | 'passages', lang: Lang): Subject[] {
  const list = useContent.getState()[kind] as { lang: Lang; subject: Subject }[];
  const order: Subject[] = ['korean', 'english', 'math', 'science', 'social', 'basic'];
  const has = new Set(list.filter((x) => x.lang === lang).map((x) => x.subject));
  return order.filter((s) => has.has(s));
}

/** 배열 섞기(Fisher-Yates). */
export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
