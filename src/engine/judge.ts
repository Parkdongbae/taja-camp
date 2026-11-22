// 입력 판정(자모열 접두 비교)과 연습 1회 통계 누적. 순수 로직.
//
// 공개 API
//   type CharState = 'ok' | 'composing' | 'error'
//   type TargetState = 'done' | 'current' | 'error' | 'todo'
//   interface CompareResult {
//     ok: boolean            입력 자모열 전체가 목표 자모열의 접두
//     done: boolean          완전히 일치
//     matchedKeys: number    일치한 타수(Shift 2타)
//     totalKeys: number      목표 전체 타수
//     matchedUnits: number   일치한 자모 수
//     chars: CharState[]     입력 문자열 각 글자 상태
//     targetStates: TargetState[]  목표 문자열 각 글자 상태
//     errorKey?: { expected: KeyTarget | null; typed: string; index: number; charIndex: number }
//                            index = 처음 어긋난 자모 번호, charIndex = 그 자모가 속한 목표 글자 번호
//                            expected 는 입력이 목표보다 길면 null
//     next: KeyTarget | null 다음에 눌러야 할 글쇠 (오타 상태·완료면 null → 화면은 Backspace 안내)
//     wrongLang: boolean     한글 목표에 영문이(또는 반대) 들어옴 → 한/영 안내, 오타로 세지 않음
//   }
//   compare(target: string, input: string, opts?: { composing?: boolean }): CompareResult
//     composing 을 주면 입력 마지막 글자를 조합 중으로 볼지 직접 정한다(compositionstart~end).
//     안 주면 "마지막 글자가 한글이고 목표의 같은 자리 글자와 다르면 조합 중" 으로 추정.
//   interface MeterSnapshot { strokes; typos; kpm; accuracy; seconds; missKeys: Record<string, number>; combo; maxCombo; items }
//   class TypingMeter
//     update(target: string, input: string, now: number): CompareResult  입력값이 바뀔 때마다
//     commit(target?: string): void      한 항목(낱말/문장/줄) 마침. 누적은 유지
//     addStrokes(n: number, now?: number): void   (자리연습용 정타 직접 가산)
//     addTypo(code?: string, now?: number): void  (자리연습·틀린 채 제출 등 오타 직접 가산)
//     start(now: number): void           시간 측정 시작(첫 입력 때 자동 호출됨)
//     pause(now: number): void / resume(now: number): void
//     snapshot(now: number): MeterSnapshot
//     isSuspicious(now: number): boolean 1500타/분 초과 또는 20ms 미만 간격 10회 연속
//     elapsedMs(now: number): number
//     readonly started: boolean; readonly paused: boolean; readonly lastInputAt: number | null
//   splitLines(text: string, maxLen = 38): string[]   장문을 어절 단위로 줄 나눔(줄 끝 공백 없음)
//   MAX_KPM = 1500
import { charToTarget, isHangulJamo, isLatinLetter, type KeyTarget } from './layout';
import { isHangulChar, jamoUnits, normalizeText, strokeCount, unitStrokes } from './hangul';

export type CharState = 'ok' | 'composing' | 'error';
export type TargetState = 'done' | 'current' | 'error' | 'todo';

export interface CompareResult {
  ok: boolean;
  done: boolean;
  matchedKeys: number;
  totalKeys: number;
  matchedUnits: number;
  chars: CharState[];
  targetStates: TargetState[];
  errorKey?: { expected: KeyTarget | null; typed: string; index: number; charIndex: number };
  next: KeyTarget | null;
  wrongLang: boolean;
}

export const MAX_KPM = 1500;

export function compare(target: string, input: string, opts: { composing?: boolean } = {}): CompareResult {
  const T = jamoUnits(target);
  const I = jamoUnits(input);
  const n = Math.min(T.units.length, I.units.length);
  let p = 0;
  while (p < n && T.units[p] === I.units[p]) p++;
  const ok = p === I.units.length;
  const done = ok && p === T.units.length;

  let matchedKeys = 0;
  for (let i = 0; i < p; i++) matchedKeys += unitStrokes(T.units[i]);
  let totalKeys = 0;
  for (const u of T.units) totalKeys += unitStrokes(u);

  // 입력 글자 상태
  const chars: CharState[] = I.chars.map((c, i) => {
    const end = i + 1 < I.chars.length ? I.charStart[i + 1] : I.units.length;
    if (end > p) return 'error';
    const isLast = i === I.chars.length - 1;
    if (isLast && isHangulChar(c)) {
      const composing = opts.composing ?? c !== T.chars[i];
      if (composing) return 'composing';
    }
    return 'ok';
  });

  // 목표 글자 상태
  let currentGiven = false;
  const targetStates: TargetState[] = T.chars.map((_, j) => {
    const s = T.charStart[j];
    const e = j + 1 < T.chars.length ? T.charStart[j + 1] : T.units.length;
    if (e <= p) return 'done';
    if (!ok) return s <= p ? 'error' : 'todo';
    if (!currentGiven) {
      currentGiven = true;
      return 'current';
    }
    return 'todo';
  });

  let errorKey: CompareResult['errorKey'];
  let wrongLang = false;
  if (!ok) {
    const exp = p < T.units.length ? T.units[p] : null;
    const typed = I.units[p];
    errorKey = {
      expected: exp === null ? null : charToTarget(exp),
      typed,
      index: p,
      charIndex: p < T.units.length ? T.charIndex[p] : T.chars.length,
    };
    if (exp !== null) {
      wrongLang = (isHangulJamo(exp) && isLatinLetter(typed)) || (isLatinLetter(exp) && isHangulJamo(typed));
    }
  }

  const next = ok && !done ? charToTarget(T.units[p]) : null;

  return { ok, done, matchedKeys, totalKeys, matchedUnits: p, chars, targetStates, errorKey, next, wrongLang };
}

export interface MeterSnapshot {
  strokes: number;
  typos: number;
  kpm: number;
  accuracy: number;
  seconds: number;
  missKeys: Record<string, number>;
  combo: number;
  maxCombo: number;
  items: number;
}

export class TypingMeter {
  private base = 0; // 마친 항목들의 정타
  private curMax = 0; // 지금 항목에서 접두가 일치한 최대 타수
  private curTarget: string | null = null;
  private errPos: number | null = null; // 지금 오타 상태인 자모 위치
  private typos = 0;
  private missKeys: Record<string, number> = {};
  private combo = 0;
  private maxCombo = 0;
  private items = 0;
  private startAt: number | null = null;
  private runSince: number | null = null;
  private activeMs = 0;
  private lastAt: number | null = null;
  private lastGrowAt: number | null = null;
  private fastRun = 0;
  private macro = false;

  get started(): boolean {
    return this.startAt !== null;
  }
  get paused(): boolean {
    return this.startAt !== null && this.runSince === null;
  }
  get lastInputAt(): number | null {
    return this.lastAt;
  }

  start(now: number): void {
    if (this.startAt === null) {
      this.startAt = now;
      this.runSince = now;
    }
  }

  private touch(now: number): void {
    this.start(now);
    if (this.runSince === null) this.runSince = now;
    this.lastAt = now;
  }

  private gain(n: number, now?: number): void {
    if (n <= 0) return;
    this.combo += n;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    if (now !== undefined) {
      if (this.lastGrowAt !== null && now - this.lastGrowAt < 20) {
        this.fastRun++;
        if (this.fastRun >= 10) this.macro = true;
      } else this.fastRun = 0;
      this.lastGrowAt = now;
    }
  }

  private typo(code?: string): void {
    this.typos++;
    if (code) this.missKeys[code] = (this.missKeys[code] ?? 0) + 1;
    this.combo = 0;
  }

  update(target: string, input: string, now: number): CompareResult {
    if (this.curTarget !== null && this.curTarget !== target) this.commit();
    this.curTarget = target;
    const r = compare(target, input);
    if (normalizeText(input).length > 0) this.touch(now);
    if (r.matchedKeys > this.curMax) {
      this.gain(r.matchedKeys - this.curMax, now);
      this.curMax = r.matchedKeys;
    }
    if (r.ok) this.errPos = null;
    else if (r.wrongLang) this.errPos = null;
    else {
      const pos = r.errorKey!.index;
      if (this.errPos !== pos) {
        this.errPos = pos;
        this.typo(r.errorKey!.expected?.code);
      }
    }
    return r;
  }

  commit(target?: string): void {
    let m = this.curMax;
    if (target !== undefined) m = Math.min(m, strokeCount(target));
    this.base += m;
    this.curMax = 0;
    this.errPos = null;
    this.curTarget = null;
    this.items++;
  }

  addStrokes(n: number, now?: number): void {
    if (now !== undefined) this.touch(now);
    this.base += n;
    this.gain(n, now);
  }

  addTypo(code?: string, now?: number): void {
    if (now !== undefined) this.touch(now);
    this.typo(code);
  }

  pause(now: number): void {
    if (this.runSince !== null) {
      this.activeMs += Math.max(0, now - this.runSince);
      this.runSince = null;
    }
  }

  resume(now: number): void {
    if (this.startAt !== null && this.runSince === null) this.runSince = now;
  }

  elapsedMs(now: number): number {
    return this.activeMs + (this.runSince !== null ? Math.max(0, now - this.runSince) : 0);
  }

  snapshot(now: number): MeterSnapshot {
    const strokes = this.base + this.curMax;
    const ms = this.elapsedMs(now);
    const total = strokes + this.typos;
    return {
      strokes,
      typos: this.typos,
      kpm: ms < 3000 ? 0 : Math.round((strokes * 60000) / ms),
      accuracy: total === 0 ? 0 : Math.round((strokes / total) * 1000) / 10,
      seconds: Math.round(ms / 100) / 10,
      missKeys: { ...this.missKeys },
      combo: this.combo,
      maxCombo: this.maxCombo,
      items: this.items,
    };
  }

  isSuspicious(now: number): boolean {
    if (this.macro) return true;
    const strokes = this.base + this.curMax;
    const ms = Math.max(this.elapsedMs(now), 1000);
    return (strokes * 60000) / ms > MAX_KPM;
  }
}

export function splitLines(text: string, maxLen = 38): string[] {
  const lines: string[] = [];
  for (const para of normalizeText(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let cur = '';
    for (let w of words) {
      // 한 어절이 너무 길면 잘라 넣는다
      while (Array.from(w).length > maxLen) {
        if (cur) {
          lines.push(cur);
          cur = '';
        }
        const cs = Array.from(w);
        lines.push(cs.slice(0, maxLen).join(''));
        w = cs.slice(maxLen).join('');
      }
      if (!w) continue;
      if (!cur) cur = w;
      else if (Array.from(cur).length + 1 + Array.from(w).length <= maxLen) cur += ' ' + w;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}
