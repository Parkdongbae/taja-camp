// 콘텐츠 로더: 내장 기초 콘텐츠 + 교사가 올린 교과 콘텐츠를 합쳐 제공한다.
//   useContent(): { loaded, hasTextbook, version, words, sentences, passages, allWords, allSentences, allPassages, pick }
//     - words·sentences·passages 는 교사가 고른 콘텐츠(Settings.contentPick)만 남긴 것. 연습·퀴즈·배틀은 이것을 쓴다.
//     - all* 은 거르지 않은 전체. 선생님 화면(콘텐츠 확인·수행평가 글 고르기)과 수행평가는 이것을 쓴다.
//   setContentPick(pick): 수업 설정이 바뀔 때 state/auth 가 부른다(값이 같으면 아무것도 하지 않음)
//   loadContent(force?): 로그인 후 1회 호출
//   pickWords / pickSentences / pickPassages(lang, subject): 언어·과목으로 거르기
//   subjectsFor(kind, lang): 콘텐츠가 있는 과목 목록,  shuffle(arr, rand?)
import { create } from 'zustand';
import { backend } from '../data';
import type { Lang, PassageItem, SentenceItem, Subject, WordItem } from '../data/types';
import { BUILTIN } from './builtin';
import { filterByPick, normalizePick } from './pick';

interface ContentState {
  loaded: boolean;
  hasTextbook: boolean; // 교사가 올린 교과 콘텐츠가 있는가
  version: string;
  words: WordItem[];
  sentences: SentenceItem[];
  passages: PassageItem[];
  allWords: WordItem[];
  allSentences: SentenceItem[];
  allPassages: PassageItem[];
  pick: string[]; // 교사가 고른 "과목|단원" 키(비어 있으면 전체)
}

export const useContent = create<ContentState>(() => ({
  loaded: false,
  hasTextbook: false,
  version: BUILTIN.version,
  words: BUILTIN.words,
  sentences: BUILTIN.sentences,
  passages: BUILTIN.passages,
  allWords: BUILTIN.words,
  allSentences: BUILTIN.sentences,
  allPassages: BUILTIN.passages,
  pick: [],
}));

/** 전체 목록과 선택을 받아 화면에 낼 목록까지 한 번에 만든다 */
function withPick(all: { allWords: WordItem[]; allSentences: SentenceItem[]; allPassages: PassageItem[] }, pick: string[]) {
  return {
    ...all,
    pick,
    words: filterByPick(all.allWords, pick),
    sentences: filterByPick(all.allSentences, pick),
    passages: filterByPick(all.allPassages, pick),
  };
}

export function setContentPick(pick: unknown): void {
  const next = normalizePick(pick);
  const cur = useContent.getState();
  if (next.join('\n') === cur.pick.join('\n')) return;
  useContent.setState(withPick(cur, next));
}

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
          ...withPick(
            {
              allWords: [...BUILTIN.words, ...up.words],
              allSentences: [...BUILTIN.sentences, ...up.sentences],
              allPassages: [...BUILTIN.passages, ...up.passages],
            },
            useContent.getState().pick,
          ),
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
