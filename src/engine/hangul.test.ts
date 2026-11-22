import { describe, expect, it } from 'vitest';
import {
  decompose,
  isHangulChar,
  isHomeRowOnly,
  isTypeable,
  normalizeText,
  strokeCount,
  toJamo,
  toKeySeq,
  usedCodes,
  wordCount,
  jamoUnits,
} from './hangul';

describe('decompose', () => {
  it.each([
    ['가', 'ㄱ', 'ㅏ', ''],
    ['각', 'ㄱ', 'ㅏ', 'ㄱ'],
    ['값', 'ㄱ', 'ㅏ', 'ㅄ'],
    ['꽃', 'ㄲ', 'ㅗ', 'ㅊ'],
    ['꽈', 'ㄲ', 'ㅘ', ''],
    ['의', 'ㅇ', 'ㅢ', ''],
    ['뷁', 'ㅂ', 'ㅞ', 'ㄺ'],
    ['힣', 'ㅎ', 'ㅣ', 'ㅎ'],
    ['얘', 'ㅇ', 'ㅒ', ''],
  ])('%s → %s %s %s', (s, cho, jung, jong) => {
    expect(decompose(s)).toEqual({ cho, jung, jong });
  });
  it.each(['a', 'ㄱ', '', '가나', '1'])('음절이 아니면 null: %j', (s) => {
    expect(decompose(s)).toBeNull();
  });
});

describe('toJamo 글쇠 단위 전개', () => {
  it.each([
    ['나라', 'ㄴㅏㄹㅏ'],
    ['값', 'ㄱㅏㅂㅅ'],
    ['꽃', 'ㄲㅗㅊ'],
    ['꽝', 'ㄲㅗㅏㅇ'],
    ['과학', 'ㄱㅗㅏㅎㅏㄱ'],
    ['닭', 'ㄷㅏㄹㄱ'],
    ['앉다', 'ㅇㅏㄴㅈㄷㅏ'],
    ['많다', 'ㅁㅏㄴㅎㄷㅏ'],
    ['읽다', 'ㅇㅣㄹㄱㄷㅏ'],
    ['삶', 'ㅅㅏㄹㅁ'],
    ['여덟', 'ㅇㅕㄷㅓㄹㅂ'],
    ['외곬', 'ㅇㅗㅣㄱㅗㄹㅅ'],
    ['핥다', 'ㅎㅏㄹㅌㄷㅏ'],
    ['읊다', 'ㅇㅡㄹㅍㄷㅏ'],
    ['싫다', 'ㅅㅣㄹㅎㄷㅏ'],
    ['없다', 'ㅇㅓㅂㅅㄷㅏ'],
    ['왜', 'ㅇㅗㅐ'],
    ['원', 'ㅇㅜㅓㄴ'],
    ['웨', 'ㅇㅜㅔ'],
    ['위', 'ㅇㅜㅣ'],
    ['의사', 'ㅇㅡㅣㅅㅏ'],
    ['얘기', 'ㅇㅒㄱㅣ'],
    ['예', 'ㅇㅖ'],
    ['빠짜따까싸', 'ㅃㅏㅉㅏㄸㅏㄲㅏㅆㅏ'],
    ['있다', 'ㅇㅣㅆㄷㅏ'],
    ['밖', 'ㅂㅏㄲ'],
    ['ㄳ', 'ㄱㅅ'],
    ['ㅘ', 'ㅗㅏ'],
  ])('%s → %s', (text, jamo) => {
    expect(toJamo(text).join('')).toBe(jamo);
  });

  it('쌍자음은 한 원소', () => {
    expect(toJamo('까')).toEqual(['ㄲ', 'ㅏ']);
  });
  it('영문·기호·공백·줄바꿈은 그대로', () => {
    expect(toJamo('Hi! 1\n')).toEqual(['H', 'i', '!', ' ', '1', '\n']);
  });
  it('NFD 로 들어와도 NFC 로 정규화', () => {
    expect(toJamo('가나'.normalize('NFD'))).toEqual(['ㄱ', 'ㅏ', 'ㄴ', 'ㅏ']);
  });
  it('jamoUnits 는 글자 번호를 함께 준다', () => {
    const u = jamoUnits('과 a');
    expect(u.chars).toEqual(['과', ' ', 'a']);
    expect(u.charIndex).toEqual([0, 0, 0, 1, 2]);
    expect(u.charStart).toEqual([0, 3, 4]);
  });
});

describe('strokeCount 타수표', () => {
  it.each([
    ['나라', 4],
    ['값', 4],
    ['꽃', 4],
    ['과학', 6],
    ['Hello!', 8],
    ['쌍', 4],
    ['예', 3],
    ['얘기', 5],
    ['의', 3],
    [' ', 1],
    ['\n', 1],
    ['!', 2],
    ['A', 2],
    ['a', 1],
    ['1', 1],
    ['?', 2],
    ['"', 2],
    [':', 2],
    [',', 1],
    ['.', 1],
    ['ㅢ', 2],
    ['닭', 4],
    ['있다', 6],
    ['나라 사랑', 10],
    ['DNA', 6],
  ])('%j → %i타', (text, n) => {
    expect(strokeCount(text)).toBe(n);
  });
});

describe('toKeySeq', () => {
  it('꽃 = Shift+R, H, C', () => {
    expect(toKeySeq('꽃').map((t) => [t.code, t.shift])).toEqual([
      ['KeyR', true],
      ['KeyH', false],
      ['KeyC', false],
    ]);
  });
  it('Hi! → Shift+H, I, Shift+1', () => {
    expect(toKeySeq('Hi!').map((t) => `${t.shift ? 'S+' : ''}${t.code}`)).toEqual(['S+KeyH', 'KeyI', 'S+Digit1']);
  });
  it('공백·줄바꿈', () => {
    expect(toKeySeq('가 나\n').map((t) => t.code)).toEqual(['KeyR', 'KeyK', 'Space', 'KeyS', 'KeyK', 'Enter']);
  });
  it('칠 수 없는 글자는 빠진다', () => {
    expect(toKeySeq('가…').length).toBe(2);
  });
});

describe('isHomeRowOnly', () => {
  it.each([
    ['나라', true],
    ['어머니', true],
    ['이마', true],
    ['아이', true],
    ['날', true],
    ['어머니 나라', true],
    ['나라 사랑', false],
    ['광합성', false],
    ['', false],
    ['   ', false],
    ['ㅁ', true],
    ['a', false],
    ['나라!', false],
    ['머리', true],
  ])('%j → %s', (text, v) => {
    expect(isHomeRowOnly(text)).toBe(v);
  });
});

describe('wordCount / isTypeable / usedCodes', () => {
  it.each([
    ['광합성', 1],
    ['지구 온난화', 2],
    ['  a  b  c ', 3],
    ['', 0],
  ])('wordCount(%j) = %i', (t, n) => {
    expect(wordCount(t)).toBe(n);
  });
  it.each([
    ['가나', true],
    ['DNA 구조!', true],
    ['😀', false],
    ['…', false],
    ['“안녕”', false],
    ['', false],
    ['line1\nline2', true],
  ])('isTypeable(%j) = %s', (t, v) => {
    expect(isTypeable(t)).toBe(v);
  });
  it('usedCodes 는 중복 없이 처음 나온 순서', () => {
    expect(usedCodes('나라')).toEqual(['KeyS', 'KeyK', 'KeyF']);
    expect(usedCodes('까가')).toEqual(['KeyR', 'KeyK']);
  });
  it('normalizeText 는 CRLF 와 NBSP 를 정리', () => {
    expect(normalizeText('a\r\nb c')).toBe('a\nb c');
  });
  it('isHangulChar', () => {
    expect(isHangulChar('가')).toBe(true);
    expect(isHangulChar('ㄱ')).toBe(true);
    expect(isHangulChar('a')).toBe(false);
  });
});
