// 교사 콘텐츠 올리기 도우미. 순수 로직(React·백엔드 의존 없음).
//
// 공개 API
//   AI_SUBJECTS                               프롬프트로 만들 수 있는 과목(기초 제외)
//   aiPrompt({ grade, subject }): string      제미나이·챗GPT 에 자료(PDF·HWPX)와 함께 붙여 넣을 프롬프트
//   extractJson(text): unknown                AI 답(설명·```json 울타리 포함)에서 JSON 객체를 꺼낸다. 없으면 Error
//   typeableText(s): string                   굽은 따옴표·가운뎃점·말줄임표 등을 자판으로 칠 수 있는 글자로 바꾸고 공백 정리
//   mergeBundles(old, add): { words, sentences, passages, replacedUnits }
//                                             더하기: 새 자료에 있는 "과목|단원"은 옛것을 지우고 바꿔 넣고, 나머지는 그대로.
//                                             id 가 남은 옛 항목과 겹치면 새 항목 id 뒤에 -2, -3 … 을 붙인다.
//   unitSummary(bundle): UnitRow[]            올린 콘텐츠의 단원별 개수(과목 순서 → 처음 나온 순서)
//   removeUnit(bundle, subject, unit)         그 단원만 뺀 묶음
import type { PassageItem, SentenceItem, Subject, WordItem } from '../data/types';
import { SUBJECT_LABEL } from '../data/types';
import { SUBJECT_ORDER, pickKey } from './pick';

export const AI_SUBJECTS: Subject[] = ['korean', 'english', 'math', 'science', 'social'];
const SHORT: Record<Subject, string> = { korean: 'kor', english: 'eng', math: 'mat', science: 'sci', social: 'soc', basic: 'bas' };

export function aiPrompt({ grade, subject }: { grade: number; subject: Subject }): string {
  const g = Math.max(1, Math.min(3, Math.floor(grade) || 1));
  const name = SUBJECT_LABEL[subject];
  const en = subject === 'english';
  const lang = en ? 'en' : 'ko';
  const s = SHORT[subject];
  return `너는 중학교 타자 연습 프로그램의 콘텐츠 제작 도우미야.
첨부한 중학교 ${g}학년 ${name} 자료(PDF 또는 HWPX)를 읽고, 아래 규칙에 맞는 JSON 하나만 출력해.
설명이나 인사말 없이 \`\`\`json 코드 블록 하나만 출력해.

[출력 형식]
{
  "words": [{ "id": "w-${s}${g}-01-001", "text": "낱말", "meaning": "뜻풀이", "lang": "${lang}", "subject": "${subject}", "unit": "${g}학년 1. 단원 제목", "level": 1 }],
  "sentences": [{ "id": "s-${s}${g}-01-001", "text": "문장", "lang": "${lang}", "subject": "${subject}", "unit": "${g}학년 1. 단원 제목", "level": 1 }],
  "passages": [{ "id": "p-${s}${g}-01-001", "title": "제목", "text": "긴 글", "lang": "${lang}", "subject": "${subject}", "unit": "${g}학년 1. 단원 제목", "level": 2 }]
}

[규칙]
1. 모든 항목의 subject 는 "${subject}", lang 은 "${lang}" 로 똑같이 쓴다.
2. unit 은 자료의 단원을 "${g}학년 1. 단원 제목"처럼 학년과 단원 번호를 붙여 쓴다. 같은 단원은 모든 항목에서 글자 하나 다르지 않게 똑같이 쓴다. 단원이 없는 자료면 내용에 맞는 이름을 하나 정한다.
3. id 는 겹치지 않게 만든다. 낱말 "w-${s}${g}-단원번호두자리-일련번호세자리", 문장은 "s-…", 긴 글은 "p-…".
4. words: 단원마다 학생이 꼭 알아야 할 핵심 낱말(개념어·어휘) 20~40개. text 는 1~3어절.${en ? ' text 는 영어 낱말, meaning 은 우리말 뜻.' : ''} meaning 은 중학생이 이해할 수 있는 한 줄 뜻풀이(15~40자)로 쓰고, 뜻풀이 안에 그 낱말을 그대로 쓰지 않는다.
5. sentences: 단원마다 15~30개. 단원 내용을 담은 완결된 한 문장(15~40자 안팎).
6. passages: 단원마다 1~3개. 200~500자 문단 하나. title 은 짧게.
7. level: 1 쉬움(짧고 흔한 말), 2 보통, 3 어려움.
8. 원문을 길게 그대로 옮기지 말고, 핵심 내용을 바탕으로 학생이 치기 좋은 문장으로 다듬어 쓴다.
9. 키보드로 칠 수 있는 글자만 쓴다: 한글, 영문, 숫자, 보통 문장부호(. , ? ! ' " ( ) - : ; ~ /). 굽은 따옴표(“ ” ‘ ’), 가운뎃점(·), 말줄임표(…), 긴 줄표(— –), 한자, 원문자(① ②), 그림 기호, 각주 번호, 줄바꿈은 쓰지 않는다.
10. 내용이 많아 답이 길어지면 단원 몇 개씩 끊어서 출력해도 된다. 이때도 매번 위 형식을 다 갖춘 JSON 하나로 출력하고, 내가 "계속"이라고 하면 다음 단원을 출력한다.`;
}

export function extractJson(text: string): unknown {
  const t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  const body = fence ? fence[1] : t;
  const a = body.indexOf('{');
  const b = body.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('JSON 을 찾지 못했습니다.');
  return JSON.parse(body.slice(a, b + 1));
}

const SWAP: [RegExp, string][] = [
  [/[“”„‟″]/g, '"'],
  [/[‘’‚‛′`]/g, "'"],
  [/…/g, '...'],
  [/[·•ㆍ∙]/g, ', '],
  [/[—–―‐‑−]/g, '-'],
  [/[～〜]/g, '~'],
  [/[「『《〈]/g, "'"],
  [/[」』》〉]/g, "'"],
  [/[  -​　]/g, ' '],
];

export function typeableText(s: string): string {
  let out = s;
  for (const [re, to] of SWAP) out = out.replace(re, to);
  return out
    .replace(/\s+/g, ' ')
    .replace(/ ,/g, ',')
    .replace(/,\s*,/g, ',')
    .trim();
}

interface Items {
  words: WordItem[];
  sentences: SentenceItem[];
  passages: PassageItem[];
}

export function mergeBundles(old: Items | null, add: Items): Items & { replacedUnits: string[] } {
  const keys = new Set<string>();
  for (const x of [...add.words, ...add.sentences, ...add.passages]) keys.add(pickKey(x.subject, x.unit));
  const base: Items = old ?? { words: [], sentences: [], passages: [] };
  const replaced = new Set<string>();
  const keep = <T extends { subject: Subject; unit: string }>(list: T[]) =>
    list.filter((x) => {
      const k = pickKey(x.subject, x.unit);
      if (keys.has(k)) {
        replaced.add(k);
        return false;
      }
      return true;
    });
  const out: Items = { words: keep(base.words), sentences: keep(base.sentences), passages: keep(base.passages) };
  const append = <T extends { id: string }>(list: T[], more: T[]) => {
    const used = new Set(list.map((x) => x.id));
    for (const m of more) {
      let id = m.id;
      for (let n = 2; used.has(id); n++) id = `${m.id}-${n}`;
      used.add(id);
      list.push(id === m.id ? m : { ...m, id });
    }
  };
  append(out.words, add.words);
  append(out.sentences, add.sentences);
  append(out.passages, add.passages);
  return { ...out, replacedUnits: [...replaced] };
}

export interface UnitRow {
  key: string;
  subject: Subject;
  unit: string;
  words: number;
  sentences: number;
  passages: number;
}

export function unitSummary(b: Items): UnitRow[] {
  const map = new Map<string, UnitRow>();
  const bump = (x: { subject: Subject; unit: string }, f: 'words' | 'sentences' | 'passages') => {
    const key = pickKey(x.subject, x.unit);
    let r = map.get(key);
    if (!r) map.set(key, (r = { key, subject: x.subject, unit: x.unit, words: 0, sentences: 0, passages: 0 }));
    r[f]++;
  };
  b.words.forEach((x) => bump(x, 'words'));
  b.sentences.forEach((x) => bump(x, 'sentences'));
  b.passages.forEach((x) => bump(x, 'passages'));
  const order = [...map.keys()];
  return [...map.values()].sort(
    (a, c) => SUBJECT_ORDER.indexOf(a.subject) - SUBJECT_ORDER.indexOf(c.subject) || order.indexOf(a.key) - order.indexOf(c.key),
  );
}

export function removeUnit(b: Items, subject: Subject, unit: string): Items {
  const k = pickKey(subject, unit);
  const keep = <T extends { subject: Subject; unit: string }>(list: T[]) => list.filter((x) => pickKey(x.subject, x.unit) !== k);
  return { words: keep(b.words), sentences: keep(b.sentences), passages: keep(b.passages) };
}
