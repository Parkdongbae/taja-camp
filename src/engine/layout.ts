// 자판 데이터 (한글 두벌식 + 영문 QWERTY). 순수 로직.
//
// 공개 API
//   type Finger = 'L5'|'L4'|'L3'|'L2'|'R2'|'R3'|'R4'|'R5'|'T'   (L5 왼손 새끼 … L2 왼손 검지, R2 오른손 검지 … R5 오른손 새끼, T 엄지)
//   interface KeyDef { code; row: 0|1|2|3|4; x; w; h?; dy?; en; enShift; ko?; koShift?; label?; finger }
//     - x, w: 글쇠 1개 폭 = 1 단위. 한 줄 전체 폭은 KEYBOARD_WIDTH(15).
//     - h(기본 1), dy(기본 0): 한 줄 안에서의 높이·세로 위치(노트북 ↑↓ 반쪽 글쇠용).
//     - en/enShift: 그 글쇠가 내는 영문 글자(특수 글쇠는 ''). ko/koShift: 두벌식 자모(문자 글쇠만).
//     - label: 특수 글쇠 표시 이름(Shift, Enter, 한/영 …). 문자 글쇠는 없음.
//   const KEYBOARD_WIDTH = 15
//   keysFor(kind: KeyboardKind): KeyDef[]          desktop / laptop / surface (맨 아랫줄만 다름)
//   keyByCode(code: string, kind?: KeyboardKind): KeyDef | undefined
//   interface KeyTarget { code: string; shift: boolean; label: string; finger: Finger }
//   charToTarget(ch: string, lang?: Lang): KeyTarget | null
//     - 호환 자모(ㄱ ㅃ ㅖ …), 영문, 숫자, 기호, ' '(Space), '\n'(Enter), '\t'(Tab). 그 밖(음절·겹자모 등)은 null.
//     - lang 은 공백·줄바꿈 label 표기에만 쓴다(ko: 띄어쓰기/엔터, 그 외: Space/Enter).
//   shiftFingerFor(target: KeyTarget): Finger | null   Shift 가 필요하면 반대 손 새끼(L5/R5)
//   shiftCodeFor(target: KeyTarget): 'ShiftLeft' | 'ShiftRight' | null
//   charOfKey(code: string, shift: boolean, lang: Lang): string   그 글쇠가 내는 글자(없으면 '')
//   sameTarget(a: KeyTarget, b: KeyTarget): boolean    code·shift 가 같은가
//   HOME_CODES: Record<Finger, string>   (L5 KeyA … R5 Semicolon, T Space)
//   HOME_CODE_LIST: string[]             기본자리 8개 code
//   FINGER_LABEL: Record<Finger, string> 손가락 한국어 이름
//   isHangulJamo(ch: string): boolean    호환 자모 한 글자인가
//   isLatinLetter(ch: string): boolean   a-z / A-Z 한 글자인가
import type { KeyboardKind, Lang } from '../data/types';

export type Finger = 'L5' | 'L4' | 'L3' | 'L2' | 'R2' | 'R3' | 'R4' | 'R5' | 'T';

export interface KeyDef {
  code: string;
  row: 0 | 1 | 2 | 3 | 4;
  x: number;
  w: number;
  h?: number;
  dy?: number;
  en: string;
  enShift: string;
  ko?: string;
  koShift?: string;
  label?: string;
  finger: Finger;
}

export interface KeyTarget {
  code: string;
  shift: boolean;
  label: string;
  finger: Finger;
}

export const KEYBOARD_WIDTH = 15;

type Row = KeyDef['row'];

function key(
  code: string,
  row: Row,
  x: number,
  w: number,
  en: string,
  enShift: string,
  finger: Finger,
  extra: Partial<KeyDef> = {},
): KeyDef {
  return { code, row, x, w, en, enShift, finger, ...extra };
}

function special(code: string, row: Row, x: number, w: number, label: string, finger: Finger, extra: Partial<KeyDef> = {}): KeyDef {
  return key(code, row, x, w, '', '', finger, { label, ...extra });
}

// 문자 글쇠 한 줄 만들기
function letters(
  row: Row,
  x0: number,
  en: string,
  ko: string,
  koShift: string,
  fingers: Finger[],
): KeyDef[] {
  return Array.from(en).map((c, i) =>
    key(`Key${c.toUpperCase()}`, row, x0 + i, 1, c, c.toUpperCase(), fingers[i], {
      ko: ko[i],
      koShift: koShift[i],
    }),
  );
}

const DIGIT_FINGERS: Finger[] = ['L5', 'L4', 'L3', 'L2', 'L2', 'R2', 'R2', 'R3', 'R4', 'R5'];

const ROW0: KeyDef[] = [
  key('Backquote', 0, 0, 1, '`', '~', 'L5'),
  ...Array.from('1234567890').map((d, i) => key(`Digit${d}`, 0, 1 + i, 1, d, '!@#$%^&*()'[i], DIGIT_FINGERS[i])),
  key('Minus', 0, 11, 1, '-', '_', 'R5'),
  key('Equal', 0, 12, 1, '=', '+', 'R5'),
  special('Backspace', 0, 13, 2, 'Backspace', 'R5'),
];

const ROW1: KeyDef[] = [
  key('Tab', 1, 0, 1.5, '\t', '\t', 'L5', { label: 'Tab' }),
  ...letters(1, 1.5, 'qwertyuiop', 'ㅂㅈㄷㄱㅅㅛㅕㅑㅐㅔ', 'ㅃㅉㄸㄲㅆㅛㅕㅑㅒㅖ', DIGIT_FINGERS),
  key('BracketLeft', 1, 11.5, 1, '[', '{', 'R5'),
  key('BracketRight', 1, 12.5, 1, ']', '}', 'R5'),
  key('Backslash', 1, 13.5, 1.5, '\\', '|', 'R5'),
];

const ROW2: KeyDef[] = [
  special('CapsLock', 2, 0, 1.75, 'Caps Lock', 'L5'),
  ...letters(2, 1.75, 'asdfghjkl', 'ㅁㄴㅇㄹㅎㅗㅓㅏㅣ', 'ㅁㄴㅇㄹㅎㅗㅓㅏㅣ', ['L5', 'L4', 'L3', 'L2', 'L2', 'R2', 'R2', 'R3', 'R4']),
  key('Semicolon', 2, 10.75, 1, ';', ':', 'R5'),
  key('Quote', 2, 11.75, 1, "'", '"', 'R5'),
  key('Enter', 2, 12.75, 2.25, '\n', '\n', 'R5', { label: 'Enter' }),
];

const ROW3: KeyDef[] = [
  special('ShiftLeft', 3, 0, 2.25, 'Shift', 'L5'),
  ...letters(3, 2.25, 'zxcvbnm', 'ㅋㅌㅊㅍㅠㅜㅡ', 'ㅋㅌㅊㅍㅠㅜㅡ', ['L5', 'L4', 'L3', 'L2', 'L2', 'R2', 'R2']),
  key('Comma', 3, 9.25, 1, ',', '<', 'R3'),
  key('Period', 3, 10.25, 1, '.', '>', 'R4'),
  key('Slash', 3, 11.25, 1, '/', '?', 'R5'),
  special('ShiftRight', 3, 12.25, 2.75, 'Shift', 'R5'),
];

const SPACE_EXTRA = { label: '' };

// 데스크톱(한국어 103키): 오른쪽 Alt = 한/영, 오른쪽 Ctrl = 한자
const ROW4_DESKTOP: KeyDef[] = [
  special('ControlLeft', 4, 0, 1.25, 'Ctrl', 'L5'),
  special('MetaLeft', 4, 1.25, 1.25, 'Win', 'L5'),
  special('AltLeft', 4, 2.5, 1.25, 'Alt', 'T'),
  key('Space', 4, 3.75, 6.25, ' ', ' ', 'T', SPACE_EXTRA),
  special('AltRight', 4, 10, 1.25, '한/영', 'T'),
  special('MetaRight', 4, 11.25, 1.25, 'Win', 'R5'),
  special('ContextMenu', 4, 12.5, 1.25, '메뉴', 'R5'),
  special('ControlRight', 4, 13.75, 1.25, '한자', 'R5'),
];

// 노트북: Ctrl Fn Win Alt Space 한/영 한자 Ctrl ← ↑↓ →
const ROW4_LAPTOP: KeyDef[] = [
  special('ControlLeft', 4, 0, 1, 'Ctrl', 'L5'),
  special('Fn', 4, 1, 1, 'Fn', 'L5'),
  special('MetaLeft', 4, 2, 1, 'Win', 'L5'),
  special('AltLeft', 4, 3, 1, 'Alt', 'T'),
  key('Space', 4, 4, 5, ' ', ' ', 'T', SPACE_EXTRA),
  special('Lang1', 4, 9, 1, '한/영', 'T'),
  special('Lang2', 4, 10, 1, '한자', 'R2'),
  special('ControlRight', 4, 11, 1, 'Ctrl', 'R5'),
  special('ArrowLeft', 4, 12, 1, '←', 'R2'),
  special('ArrowUp', 4, 13, 1, '↑', 'R3', { h: 0.5, dy: 0 }),
  special('ArrowDown', 4, 13, 1, '↓', 'R3', { h: 0.5, dy: 0.5 }),
  special('ArrowRight', 4, 14, 1, '→', 'R4'),
];

// 서피스 고3 타입 커버: Ctrl Fn Win Alt Space Alt(한/영) 메뉴 ← ↑↓ →
const ROW4_SURFACE: KeyDef[] = [
  special('ControlLeft', 4, 0, 1, 'Ctrl', 'L5'),
  special('Fn', 4, 1, 1, 'Fn', 'L5'),
  special('MetaLeft', 4, 2, 1, 'Win', 'L5'),
  special('AltLeft', 4, 3, 1, 'Alt', 'T'),
  key('Space', 4, 4, 6, ' ', ' ', 'T', SPACE_EXTRA),
  special('AltRight', 4, 10, 1, '한/영', 'T'),
  special('ContextMenu', 4, 11, 1, '메뉴', 'R5'),
  special('ArrowLeft', 4, 12, 1, '←', 'R2'),
  special('ArrowUp', 4, 13, 1, '↑', 'R3', { h: 0.5, dy: 0 }),
  special('ArrowDown', 4, 13, 1, '↓', 'R3', { h: 0.5, dy: 0.5 }),
  special('ArrowRight', 4, 14, 1, '→', 'R4'),
];

const MAIN = [...ROW0, ...ROW1, ...ROW2, ...ROW3];
const DESKTOP = [...MAIN, ...ROW4_DESKTOP];
const LAPTOP = [...MAIN, ...ROW4_LAPTOP];
const SURFACE = [...MAIN, ...ROW4_SURFACE];

export function keysFor(kind: KeyboardKind): KeyDef[] {
  if (kind === 'laptop') return LAPTOP;
  if (kind === 'surface') return SURFACE;
  return DESKTOP;
}

export function keyByCode(code: string, kind: KeyboardKind = 'desktop'): KeyDef | undefined {
  return keysFor(kind).find((k) => k.code === code);
}

export const HOME_CODES: Record<Finger, string> = {
  L5: 'KeyA',
  L4: 'KeyS',
  L3: 'KeyD',
  L2: 'KeyF',
  R2: 'KeyJ',
  R3: 'KeyK',
  R4: 'KeyL',
  R5: 'Semicolon',
  T: 'Space',
};

export const HOME_CODE_LIST: string[] = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'];

export const FINGER_LABEL: Record<Finger, string> = {
  L5: '왼손 새끼',
  L4: '왼손 약지',
  L3: '왼손 중지',
  L2: '왼손 검지',
  R2: '오른손 검지',
  R3: '오른손 중지',
  R4: '오른손 약지',
  R5: '오른손 새끼',
  T: '엄지',
};

// 글자 → 글쇠 표 (문자·숫자 줄 + Space)
interface RawTarget {
  code: string;
  shift: boolean;
  finger: Finger;
}
const CHAR_MAP = new Map<string, RawTarget>();
for (const k of [...MAIN, ROW4_DESKTOP[3]]) {
  const put = (ch: string | undefined, shift: boolean) => {
    if (ch && !CHAR_MAP.has(ch)) CHAR_MAP.set(ch, { code: k.code, shift, finger: k.finger });
  };
  put(k.ko, false);
  put(k.koShift, true);
  put(k.en, false);
  put(k.enShift, true);
}

export function charToTarget(ch: string, lang?: Lang): KeyTarget | null {
  const raw = CHAR_MAP.get(ch);
  if (!raw) return null;
  let label = ch;
  if (ch === ' ') label = lang === 'ko' ? '띄어쓰기' : 'Space';
  else if (ch === '\n') label = lang === 'ko' ? '엔터' : 'Enter';
  else if (ch === '\t') label = 'Tab';
  return { code: raw.code, shift: raw.shift, label, finger: raw.finger };
}

export function shiftFingerFor(target: KeyTarget): Finger | null {
  if (!target.shift) return null;
  return target.finger.startsWith('L') ? 'R5' : 'L5';
}

export function shiftCodeFor(target: KeyTarget): 'ShiftLeft' | 'ShiftRight' | null {
  const f = shiftFingerFor(target);
  if (!f) return null;
  return f === 'L5' ? 'ShiftLeft' : 'ShiftRight';
}

export function charOfKey(code: string, shift: boolean, lang: Lang): string {
  const k = keyByCode(code);
  if (!k) return '';
  if (lang === 'ko' && k.ko) return (shift ? k.koShift : k.ko) ?? '';
  return shift ? k.enShift : k.en;
}

export function sameTarget(a: KeyTarget, b: KeyTarget): boolean {
  return a.code === b.code && a.shift === b.shift;
}

export function isHangulJamo(ch: string): boolean {
  if (ch.length !== 1) return false;
  const c = ch.charCodeAt(0);
  return c >= 0x3131 && c <= 0x318e;
}

export function isLatinLetter(ch: string): boolean {
  return ch.length === 1 && /[A-Za-z]/.test(ch);
}
