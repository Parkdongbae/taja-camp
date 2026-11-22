// 한글 자모 분해와 글쇠 단위 전개. 순수 로직.
//
// 공개 API
//   normalizeText(text: string): string      NFC + \r\n→\n + NBSP→공백
//   decompose(syllable: string): { cho: string; jung: string; jong: string } | null
//       완성형 음절 1글자를 호환 자모로 (jong 은 받침 없으면 ''). 겹모음·겹받침은 그대로(ㅘ, ㄳ).
//   toJamo(text: string): string[]
//       글쇠 단위 자모열. 겹모음·겹받침은 두 글쇠로 전개, 쌍자음·ㅒㅖ 는 한 원소(타수 2).
//       한글 외 글자(영문·숫자·기호·공백·\n)는 그대로 한 원소.
//   jamoUnits(text: string): { chars: string[]; units: string[]; charIndex: number[]; charStart: number[] }
//       chars = 정규화한 글자 배열, units = toJamo 결과, charIndex[u] = 그 자모가 속한 글자 번호,
//       charStart[c] = 글자 c 의 첫 자모 번호
//   unitStrokes(unit: string): number        자모(원소) 1개의 타수 (Shift 조합 2, 그 외 1)
//   toKeySeq(text: string): KeyTarget[]      눌러야 할 글쇠 순서 (칠 수 없는 글자는 빠짐)
//   strokeCount(text: string): number        총 타수 (Shift 조합 2타)
//   isHomeRowOnly(text: string): boolean     공백 빼고 자모 전체가 ㅁㄴㅇㄹㅓㅏㅣ 뿐인가 (빈 글은 false)
//   wordCount(text: string): number          공백으로 나눈 단어 수
//   isTypeable(text: string): boolean        모든 글자를 자판으로 칠 수 있는가 (빈 글은 false)
//   usedCodes(text: string): string[]        쓰인 글쇠 code (처음 나온 순서, 중복 없음)
//   isHangulChar(ch: string): boolean        완성형 음절 또는 호환 자모인가
import { charToTarget, type KeyTarget } from './layout';

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];

// 두 글쇠로 치는 겹모음·겹받침
const SPLIT: Record<string, string[]> = {
  ㅘ: ['ㅗ', 'ㅏ'],
  ㅙ: ['ㅗ', 'ㅐ'],
  ㅚ: ['ㅗ', 'ㅣ'],
  ㅝ: ['ㅜ', 'ㅓ'],
  ㅞ: ['ㅜ', 'ㅔ'],
  ㅟ: ['ㅜ', 'ㅣ'],
  ㅢ: ['ㅡ', 'ㅣ'],
  ㄳ: ['ㄱ', 'ㅅ'],
  ㄵ: ['ㄴ', 'ㅈ'],
  ㄶ: ['ㄴ', 'ㅎ'],
  ㄺ: ['ㄹ', 'ㄱ'],
  ㄻ: ['ㄹ', 'ㅁ'],
  ㄼ: ['ㄹ', 'ㅂ'],
  ㄽ: ['ㄹ', 'ㅅ'],
  ㄾ: ['ㄹ', 'ㅌ'],
  ㄿ: ['ㄹ', 'ㅍ'],
  ㅀ: ['ㄹ', 'ㅎ'],
  ㅄ: ['ㅂ', 'ㅅ'],
};

const HOME_JAMO = new Set(['ㅁ', 'ㄴ', 'ㅇ', 'ㄹ', 'ㅓ', 'ㅏ', 'ㅣ']);

export function normalizeText(text: string): string {
  return text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/ /g, ' ');
}

export function decompose(syllable: string): { cho: string; jung: string; jong: string } | null {
  if (syllable.length !== 1) return null;
  const code = syllable.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return null;
  return {
    cho: CHO[Math.floor(code / 588)],
    jung: JUNG[Math.floor((code % 588) / 28)],
    jong: JONG[code % 28],
  };
}

function expand(j: string): string[] {
  return SPLIT[j] ?? [j];
}

function charUnits(c: string): string[] {
  const d = decompose(c);
  if (d) return [...expand(d.cho), ...expand(d.jung), ...(d.jong ? expand(d.jong) : [])];
  return expand(c);
}

export interface JamoUnits {
  chars: string[];
  units: string[];
  charIndex: number[];
  charStart: number[];
}

export function jamoUnits(text: string): JamoUnits {
  const chars = Array.from(normalizeText(text));
  const units: string[] = [];
  const charIndex: number[] = [];
  const charStart: number[] = [];
  chars.forEach((c, i) => {
    charStart.push(units.length);
    for (const u of charUnits(c)) {
      units.push(u);
      charIndex.push(i);
    }
  });
  return { chars, units, charIndex, charStart };
}

export function toJamo(text: string): string[] {
  return jamoUnits(text).units;
}

export function unitStrokes(unit: string): number {
  return charToTarget(unit)?.shift ? 2 : 1;
}

export function toKeySeq(text: string): KeyTarget[] {
  const out: KeyTarget[] = [];
  for (const u of toJamo(text)) {
    const t = charToTarget(u);
    if (t) out.push(t);
  }
  return out;
}

export function strokeCount(text: string): number {
  let n = 0;
  for (const u of toJamo(text)) n += unitStrokes(u);
  return n;
}

export function isHomeRowOnly(text: string): boolean {
  const units = toJamo(text).filter((u) => u !== ' ');
  return units.length > 0 && units.every((u) => HOME_JAMO.has(u));
}

export function wordCount(text: string): number {
  return normalizeText(text).trim().split(/\s+/).filter(Boolean).length;
}

export function isTypeable(text: string): boolean {
  const units = toJamo(text);
  return units.length > 0 && units.every((u) => charToTarget(u) !== null);
}

export function usedCodes(text: string): string[] {
  const seen = new Set<string>();
  for (const t of toKeySeq(text)) seen.add(t.code);
  return [...seen];
}

export function isHangulChar(ch: string): boolean {
  if (ch.length !== 1) return false;
  const c = ch.charCodeAt(0);
  return (c >= 0xac00 && c <= 0xd7a3) || (c >= 0x3131 && c <= 0x318e);
}
