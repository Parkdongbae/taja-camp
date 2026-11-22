// 자리연습 단계와 문항 만들기. 순수 로직.
//
// 공개 API
//   interface Stage { id: string; track: Track; order: number(트랙 안 1부터); name: string; newKeys: KeyTarget[]; allKeys: KeyTarget[] (트랙 안 누적) }
//   STAGES: Stage[]                       K1~K8, S1~S2, E1~E7
//   TRACK_LABEL: Record<Track, string>    { ko: '한글', symbol: '기호', en: '영문' }
//   stagesOf(track: Track): Stage[]
//   getStage(id: string): Stage | undefined
//   type DrillKind = 'learn' | 'mix' | 'test' | 'review'
//   DRILL_COUNTS = { learn: 30, mix: 40, test: 50, review: 20 }
//   makeDrill(stageId: string, kind: DrillKind, count: number, rand: () => number, focusCodes?: string[]): KeyTarget[]
//     learn = 새 글쇠만 / mix·test = 새 70% + 이전 30%(트랙 첫 단계는 새 100%)
//     review = focusCodes 에 해당하는 이 단계까지의 글쇠 70% + 나머지 30% (해당 없으면 mix 와 같음)
//     같은 글쇠(code+shift) 3회 연속 금지. 각 풀 안에서는 고르게 섞는다. 없는 단계면 [].
//   matchesTarget(e: { code: string; shiftKey: boolean }, t: KeyTarget): boolean   code·shift 정확히 일치
//   isBattleUnlocked(position: Record<Track, number>): boolean   ko ≥ 8 && symbol ≥ 2
//   isEnBattleUnlocked(position): boolean                        위 + en ≥ 7
//   nextStageId(position, track): string | null   그 트랙에서 아직 통과 못 한 첫 단계(잠김 여부와 무관). 다 통과면 null
//   isStageUnlocked(position, stageId): boolean   ko: 순서대로 / symbol: K8 통과 후 / en: K1 통과 후
//   isStagePassed(position, stageId): boolean
//   testScore(correct: number, total = 50): number   정답 ÷ 문항 × 100 (반올림)
//   isTestPassed(score: number, passScore = 90): boolean
import type { Track } from '../data/types';
import { charToTarget, sameTarget, type KeyTarget } from './layout';
import { randInt, shuffle } from './rng';

export interface Stage {
  id: string;
  track: Track;
  order: number;
  name: string;
  newKeys: KeyTarget[];
  allKeys: KeyTarget[];
}

export type DrillKind = 'learn' | 'mix' | 'test' | 'review';

export const TRACK_LABEL: Record<Track, string> = { ko: '한글', symbol: '기호', en: '영문' };

export const DRILL_COUNTS = { learn: 30, mix: 40, test: 50, review: 20 } as const;

const DEFS: [string, Track, string, string][] = [
  ['K1', 'ko', '기본자리', 'ㅁㄴㅇㄹㅓㅏㅣ;'],
  ['K2', 'ko', '왼손윗자리', 'ㅂㅈㄷㄱ'],
  ['K3', 'ko', '왼손아랫자리', 'ㅋㅌㅊㅍ'],
  ['K4', 'ko', '가운데자리', 'ㅅㅛㅎㅗㅠ'],
  ['K5', 'ko', '오른손윗자리', 'ㅕㅑㅐㅔ'],
  ['K6', 'ko', '오른손아랫자리', 'ㅜㅡ,./'],
  ['K7', 'ko', '전체자리', 'ㅃㅉㄸㄲㅆㅒㅖ'],
  ['K8', 'ko', '숫자자리', '1234567890'],
  ['S1', 'symbol', '기호 1', '!@#$%^&*()'],
  ['S2', 'symbol', '기호 2', '-=_+[]{};:\'",.<>/?~'],
  ['E1', 'en', '기본자리', 'asdfjkl;'],
  ['E2', 'en', '왼손윗자리', 'qwer'],
  ['E3', 'en', '왼손아랫자리', 'zxcv'],
  ['E4', 'en', '가운데자리', 'tyghb'],
  ['E5', 'en', '오른손윗자리', 'uiop'],
  ['E6', 'en', '오른손아랫자리', 'nm,./'],
  ['E7', 'en', '전체자리(대문자)', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
];

function tgt(ch: string): KeyTarget {
  const t = charToTarget(ch);
  if (!t) throw new Error(`칠 수 없는 글자: ${ch}`);
  return t;
}

function buildStages(): Stage[] {
  const out: Stage[] = [];
  const acc: Record<Track, KeyTarget[]> = { ko: [], symbol: [], en: [] };
  const orders: Record<Track, number> = { ko: 0, symbol: 0, en: 0 };
  for (const [id, track, name, chars] of DEFS) {
    const newKeys = Array.from(chars).map(tgt);
    for (const k of newKeys) if (!acc[track].some((a) => sameTarget(a, k))) acc[track].push(k);
    out.push({ id, track, order: ++orders[track], name, newKeys, allKeys: acc[track].slice() });
  }
  return out;
}

export const STAGES: Stage[] = buildStages();

export function stagesOf(track: Track): Stage[] {
  return STAGES.filter((s) => s.track === track);
}

export function getStage(id: string): Stage | undefined {
  return STAGES.find((s) => s.id === id);
}

// 풀을 고르게 n 개 (섞은 묶음을 이어 붙임)
function balanced(pool: KeyTarget[], n: number, rand: () => number): KeyTarget[] {
  const out: KeyTarget[] = [];
  if (pool.length === 0) return out;
  while (out.length < n) out.push(...shuffle(pool, rand));
  return out.slice(0, n);
}

function makesTriple(seq: KeyTarget[], i: number, x: KeyTarget): boolean {
  // seq 의 i 위치에 x 를 끼워 넣으면 3연속이 생기는가
  const a = seq[i - 2], b = seq[i - 1], c = seq[i], d = seq[i + 1];
  const eq = (p?: KeyTarget) => !!p && sameTarget(p, x);
  return (eq(a) && eq(b)) || (eq(b) && eq(c)) || (eq(c) && eq(d));
}

// 3연속 없이 늘어놓기 (구성은 그대로 유지)
function arrange(bag: KeyTarget[], rand: () => number, fallback: KeyTarget[]): KeyTarget[] {
  const rest = shuffle(bag, rand);
  const out: KeyTarget[] = [];
  while (rest.length) {
    const n = out.length;
    const banned = n >= 2 && sameTarget(out[n - 1], out[n - 2]) ? out[n - 1] : null;
    const cand: number[] = [];
    rest.forEach((k, i) => {
      if (!banned || !sameTarget(k, banned)) cand.push(i);
    });
    if (cand.length) {
      const i = cand[randInt(rand, cand.length)];
      out.push(rest.splice(i, 1)[0]);
      continue;
    }
    // 남은 것이 모두 금지 글쇠: 앞쪽 빈자리에 끼워 넣는다
    const x = rest.pop()!;
    let placed = false;
    for (let i = 0; i <= out.length; i++) {
      if (!makesTriple(out, i, x)) {
        out.splice(i, 0, x);
        placed = true;
        break;
      }
    }
    if (!placed) {
      const alt = fallback.filter((k) => !sameTarget(k, x) && !makesTriple(out, out.length, k));
      out.push(alt.length ? alt[randInt(rand, alt.length)] : x);
    }
  }
  return out;
}

export function makeDrill(
  stageId: string,
  kind: DrillKind,
  count: number,
  rand: () => number,
  focusCodes?: string[],
): KeyTarget[] {
  const st = getStage(stageId);
  if (!st || count <= 0) return [];
  const isNew = (k: KeyTarget) => st.newKeys.some((n) => sameTarget(n, k));
  const prev = st.allKeys.filter((k) => !isNew(k));

  let bag: KeyTarget[];
  if (kind === 'learn') bag = balanced(st.newKeys, count, rand);
  else {
    let main = st.newKeys;
    let other = prev;
    if (kind === 'review') {
      const focus = st.allKeys.filter((k) => focusCodes?.includes(k.code));
      if (focus.length) {
        main = focus;
        other = st.allKeys.filter((k) => !focus.some((f) => sameTarget(f, k)));
      }
    }
    if (other.length === 0) bag = balanced(main, count, rand);
    else {
      const nMain = Math.round(count * 0.7);
      bag = [...balanced(main, nMain, rand), ...balanced(other, count - nMain, rand)];
    }
  }
  return arrange(bag, rand, st.allKeys);
}

export function matchesTarget(e: { code: string; shiftKey: boolean }, t: KeyTarget): boolean {
  return e.code === t.code && e.shiftKey === t.shift;
}

export function isBattleUnlocked(position: Record<Track, number>): boolean {
  return position.ko >= 8 && position.symbol >= 2;
}

export function isEnBattleUnlocked(position: Record<Track, number>): boolean {
  return isBattleUnlocked(position) && position.en >= 7;
}

export function nextStageId(position: Record<Track, number>, track: Track): string | null {
  const list = stagesOf(track);
  return list[position[track] ?? 0]?.id ?? null;
}

export function isStagePassed(position: Record<Track, number>, stageId: string): boolean {
  const st = getStage(stageId);
  return !!st && st.order <= (position[st.track] ?? 0);
}

export function isStageUnlocked(position: Record<Track, number>, stageId: string): boolean {
  const st = getStage(stageId);
  if (!st) return false;
  if (st.track === 'symbol' && position.ko < 8) return false;
  if (st.track === 'en' && position.ko < 1) return false;
  return st.order <= (position[st.track] ?? 0) + 1;
}

export function testScore(correct: number, total = 50): number {
  if (total <= 0) return 0;
  return Math.round((Math.max(0, Math.min(correct, total)) / total) * 100);
}

export function isTestPassed(score: number, passScore = 90): boolean {
  return score >= passScore;
}
