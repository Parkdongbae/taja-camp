import { describe, expect, it } from 'vitest';
import {
  HOME_CODES,
  HOME_CODE_LIST,
  KEYBOARD_WIDTH,
  charOfKey,
  charToTarget,
  keyByCode,
  keysFor,
  shiftCodeFor,
  shiftFingerFor,
} from './layout';

describe('charToTarget', () => {
  it.each([
    ['ㄱ', 'KeyR', false],
    ['ㄲ', 'KeyR', true],
    ['ㅃ', 'KeyQ', true],
    ['ㅉ', 'KeyW', true],
    ['ㄸ', 'KeyE', true],
    ['ㅆ', 'KeyT', true],
    ['ㅒ', 'KeyO', true],
    ['ㅖ', 'KeyP', true],
    ['ㅛ', 'KeyY', false],
    ['ㅁ', 'KeyA', false],
    ['ㅠ', 'KeyB', false],
    ['ㅡ', 'KeyM', false],
    ['a', 'KeyA', false],
    ['A', 'KeyA', true],
    ['z', 'KeyZ', false],
    ['1', 'Digit1', false],
    ['0', 'Digit0', false],
    ['!', 'Digit1', true],
    [')', 'Digit0', true],
    ['?', 'Slash', true],
    [' ', 'Space', false],
    ['\n', 'Enter', false],
    [';', 'Semicolon', false],
    [':', 'Semicolon', true],
    ['"', 'Quote', true],
    ["'", 'Quote', false],
    ['~', 'Backquote', true],
    ['_', 'Minus', true],
    ['+', 'Equal', true],
    ['{', 'BracketLeft', true],
    ['<', 'Comma', true],
  ])('%j → %s shift=%s', (ch, code, shift) => {
    const t = charToTarget(ch)!;
    expect(t.code).toBe(code);
    expect(t.shift).toBe(shift);
  });
  it.each(['가', 'ㅘ', 'ㄳ', '…', '“', '😀', 'ab'])('칠 수 없으면 null: %j', (ch) => {
    expect(charToTarget(ch)).toBeNull();
  });
  it('label 은 글자 자체, 공백·줄바꿈은 이름', () => {
    expect(charToTarget('ㅃ')!.label).toBe('ㅃ');
    expect(charToTarget(' ')!.label).toBe('Space');
    expect(charToTarget(' ', 'ko')!.label).toBe('띄어쓰기');
    expect(charToTarget('\n')!.label).toBe('Enter');
  });
  it.each([
    ['ㅁ', 'L5'],
    ['ㄴ', 'L4'],
    ['ㅇ', 'L3'],
    ['ㄹ', 'L2'],
    ['ㅎ', 'L2'],
    ['ㅗ', 'R2'],
    ['ㅓ', 'R2'],
    ['ㅏ', 'R3'],
    ['ㅣ', 'R4'],
    [';', 'R5'],
    [' ', 'T'],
    ['ㅔ', 'R5'],
  ])('손가락: %j → %s', (ch, f) => {
    expect(charToTarget(ch)!.finger).toBe(f);
  });
});

describe('shiftFingerFor / shiftCodeFor', () => {
  it.each([
    ['ㄲ', 'R5', 'ShiftRight'],
    ['ㅃ', 'R5', 'ShiftRight'],
    ['ㅖ', 'L5', 'ShiftLeft'],
    ['!', 'R5', 'ShiftRight'],
    ['?', 'L5', 'ShiftLeft'],
    ['J', 'L5', 'ShiftLeft'],
  ])('%j → %s', (ch, f, code) => {
    const t = charToTarget(ch)!;
    expect(shiftFingerFor(t)).toBe(f);
    expect(shiftCodeFor(t)).toBe(code);
  });
  it('Shift 가 필요 없으면 null', () => {
    expect(shiftFingerFor(charToTarget('ㄱ')!)).toBeNull();
    expect(shiftCodeFor(charToTarget('a')!)).toBeNull();
  });
});

describe('keysFor', () => {
  const desk = keysFor('desktop');
  const lap = keysFor('laptop');
  it('문자·숫자 줄(0~3)은 같다', () => {
    expect(lap.filter((k) => k.row < 4)).toEqual(desk.filter((k) => k.row < 4));
  });
  it('맨 아랫줄은 다르다', () => {
    expect(lap.filter((k) => k.row === 4)).not.toEqual(desk.filter((k) => k.row === 4));
    expect(lap.some((k) => k.code === 'Fn')).toBe(true);
    expect(lap.some((k) => k.code === 'ArrowUp')).toBe(true);
    expect(desk.some((k) => k.code === 'Fn')).toBe(false);
  });
  it('서피스 고3: 문자·숫자 줄은 같고 맨 아랫줄만 다르다', () => {
    const sur = keysFor('surface');
    expect(sur.filter((k) => k.row < 4)).toEqual(desk.filter((k) => k.row < 4));
    const bottom = sur.filter((k) => k.row === 4).sort((a, b) => a.x - b.x || (a.dy ?? 0) - (b.dy ?? 0));
    expect(bottom.map((k) => k.code)).toEqual([
      'ControlLeft',
      'Fn',
      'MetaLeft',
      'AltLeft',
      'Space',
      'AltRight',
      'ContextMenu',
      'ArrowLeft',
      'ArrowUp',
      'ArrowDown',
      'ArrowRight',
    ]);
    expect(bottom).not.toEqual(desk.filter((k) => k.row === 4));
    expect(bottom).not.toEqual(lap.filter((k) => k.row === 4));
    expect(keyByCode('AltRight', 'surface')!.label).toBe('한/영');
    expect(keyByCode('ArrowUp', 'surface')!.h).toBe(0.5);
    expect(keyByCode('ControlRight', 'surface')).toBeUndefined();
  });
  it.each(['desktop', 'laptop', 'surface'] as const)('%s: Space 는 엄지, 기본자리 글쇠가 모두 있다', (kind) => {
    expect(keyByCode('Space', kind)!.finger).toBe('T');
    for (const c of HOME_CODE_LIST) expect(keyByCode(c, kind)).toBeTruthy();
  });
  it.each(['desktop', 'laptop', 'surface'] as const)('%s: 각 줄 폭 합이 15이고 겹치지 않는다', (kind) => {
    const keys = keysFor(kind);
    for (const row of [0, 1, 2, 3, 4]) {
      const rk = keys.filter((k) => k.row === row && !(k.dy && k.dy > 0)).sort((a, b) => a.x - b.x);
      let x = 0;
      for (const k of rk) {
        expect(k.x).toBeCloseTo(x, 6);
        x = k.x + k.w;
      }
      expect(x).toBeCloseTo(KEYBOARD_WIDTH, 6);
    }
  });
  it.each(['desktop', 'laptop', 'surface'] as const)('%s: code 중복 없음', (kind) => {
    const codes = keysFor(kind).map((k) => k.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
  it('문자 글쇠 26개는 모두 영문, 그중 자모가 있는 것은 26개', () => {
    const letters = desk.filter((k) => /^Key[A-Z]$/.test(k.code));
    expect(letters.length).toBe(26);
    expect(letters.every((k) => k.ko && k.koShift)).toBe(true);
  });
  it('특수 글쇠는 label 이 있다', () => {
    for (const c of ['Backspace', 'Tab', 'CapsLock', 'Enter', 'ShiftLeft', 'ShiftRight', 'ControlLeft']) {
      expect(keyByCode(c)!.label).toBeTruthy();
    }
  });
  it('keyByCode', () => {
    expect(keyByCode('KeyA')!.ko).toBe('ㅁ');
    expect(keyByCode('Lang1', 'laptop')!.label).toBe('한/영');
    expect(keyByCode('없는글쇠')).toBeUndefined();
  });
});

describe('HOME_CODES / charOfKey', () => {
  it('기본자리', () => {
    expect(HOME_CODE_LIST).toEqual(['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon']);
    expect(HOME_CODES.L2).toBe('KeyF');
    expect(HOME_CODES.R2).toBe('KeyJ');
    expect(HOME_CODES.R5).toBe('Semicolon');
  });
  it.each([
    ['KeyR', false, 'ko', 'ㄱ'],
    ['KeyR', true, 'ko', 'ㄲ'],
    ['KeyR', true, 'en', 'R'],
    ['Digit2', true, 'ko', '@'],
    ['Backspace', false, 'en', ''],
  ] as const)('charOfKey(%s, %s, %s) = %j', (code, shift, lang, ch) => {
    expect(charOfKey(code, shift, lang)).toBe(ch);
  });
});
