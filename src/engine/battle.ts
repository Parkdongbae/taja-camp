// 배틀 낱말 일정. 같은 인자면 어느 브라우저에서든 완전히 같은 결과(결정적). 순수 로직.
//
// 공개 API
//   mulberry32(seed: number): () => number     (rng.ts 에서 다시 내보냄)
//   interface FallingWord { index: number; text: string; points: 1|2|4; spawnAt: number(ms, 시작 기준); fallMs: number; x: number(0~1, 낱말 가운데의 가로 위치) }
//   concurrentCount(playerCount: number): number      4 + floor(인원/2), 최대 12
//   fallMsAt(elapsedMs: number, durationMs: number): number   10000 → 6000 선형
//   normalizeFallSpeed(x?): FallSpeed   점수별 낙하 속도(%)를 50~200 으로 정리(없으면 기본값)
//   buildSchedule(seed: number, pool: string[], playerCount: number, durationSec: number, speed?: FallSpeed): FallingWord[]
//     - speed 를 주면 낱말의 fallMs = 기본 낙하 시간 ÷ (점수별 속도 ÷ 100). 등장 간격은 기본 낙하 시간 그대로.
//     - pool 은 NFC·trim·중복 제거·칠 수 없는 것 제외 후 코드 단위 순서로 다시 정렬한다.
//     - 등장 간격 = fallMs ÷ 동시 낱말 수. 경기 끝 1초 전까지 등장.
//     - 같은 낱말이 동시에 2개 뜨지 않음. x 는 (동시 수 + 2)개 칸에 나눠, 떠 있는 낱말과 칸이 겹치지 않게.
//     - 점수 비율은 pool 구성에 비례, 단 4점 낱말이 pool 에 있으면 일정의 어느 앞부분(2개 이상)을 잘라도 4점이 10% 이상.
//   visibleWords(schedule: FallingWord[], elapsedMs: number): FallingWord[]   spawnAt ≤ t < spawnAt+fallMs
//   wordY(word: FallingWord, elapsedMs: number): number   0(맨 위) ~ 1(바닥)
//   matchSubmission(schedule, elapsedMs, typed: string, claimed?: Set<number> | Record<string, unknown>): FallingWord | null
//       화면에 있고 아직 안 잡힌 낱말 중 입력(NFC·trim)과 정확히 같은 것. 여럿이면 가장 아래 것
import { battlePoints } from './scoring';
import { isTypeable, normalizeText } from './hangul';
import { mulberry32, randInt, shuffle } from './rng';
import { DEFAULT_FALL_SPEED, type FallSpeed } from '../data/types';

export const FALL_SPEED_MIN = 50;
export const FALL_SPEED_MAX = 200;

export function normalizeFallSpeed(x?: Partial<FallSpeed> | null): FallSpeed {
  const one = (v: unknown, d: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? Math.max(FALL_SPEED_MIN, Math.min(FALL_SPEED_MAX, n)) : d;
  };
  return { p1: one(x?.p1, DEFAULT_FALL_SPEED.p1), p2: one(x?.p2, DEFAULT_FALL_SPEED.p2), p4: one(x?.p4, DEFAULT_FALL_SPEED.p4) };
}

export { mulberry32 };

export interface FallingWord {
  index: number;
  text: string;
  points: 1 | 2 | 4;
  spawnAt: number;
  fallMs: number;
  x: number;
}

export function concurrentCount(playerCount: number): number {
  return Math.min(12, 4 + Math.floor(Math.max(1, playerCount) / 2));
}

export function fallMsAt(elapsedMs: number, durationMs: number): number {
  const r = durationMs > 0 ? Math.max(0, Math.min(1, elapsedMs / durationMs)) : 0;
  return Math.round(10000 - 4000 * r);
}

class Deck {
  private order: string[] = [];
  private ptr = 0;
  constructor(
    private words: string[],
    private rand: () => number,
  ) {
    this.order = shuffle(words, rand);
  }
  get size() {
    return this.words.length;
  }
  draw(exclude: Set<string>): string | null {
    for (let tries = 0; tries < this.words.length; tries++) {
      if (this.ptr >= this.order.length) {
        this.order = shuffle(this.words, this.rand);
        this.ptr = 0;
      }
      const w = this.order[this.ptr++];
      if (!exclude.has(w)) return w;
    }
    return null;
  }
}

export function buildSchedule(
  seed: number,
  pool: string[],
  playerCount: number,
  durationSec: number,
  speed?: FallSpeed | null,
): FallingWord[] {
  const mult: Record<1 | 2 | 4, number> = speed
    ? { 1: normalizeFallSpeed(speed).p1 / 100, 2: normalizeFallSpeed(speed).p2 / 100, 4: normalizeFallSpeed(speed).p4 / 100 }
    : { 1: 1, 2: 1, 4: 1 };
  const maxFall = Math.ceil(10000 / Math.min(mult[1], mult[2], mult[4]));
  const uniq = [...new Set(pool.map((w) => normalizeText(w).trim().replace(/\s+/g, ' ')))].filter(
    (w) => w && isTypeable(w),
  );
  uniq.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const durMs = Math.round(durationSec * 1000);
  if (uniq.length === 0 || durMs <= 0) return [];

  const rand = mulberry32(seed);
  const buckets: Record<1 | 2 | 4, string[]> = { 1: [], 2: [], 4: [] };
  for (const w of uniq) buckets[battlePoints(w)].push(w);
  const decks = { 1: new Deck(buckets[1], rand), 2: new Deck(buckets[2], rand), 4: new Deck(buckets[4], rand) };
  const sizes: [1 | 2 | 4, number][] = [
    [1, buckets[1].length],
    [2, buckets[2].length],
    [4, buckets[4].length],
  ];
  const totalSize = uniq.length;

  const conc = concurrentCount(playerCount);
  const lanes = conc + 2;
  const out: FallingWord[] = [];
  const laneOf: number[] = [];
  let count4 = 0;
  let lastLane = -100;
  let t = 0;
  const endAt = durMs - 1000;

  while (t < endAt) {
    const fall = fallMsAt(t, durMs);
    const visIdx: number[] = [];
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].spawnAt + out[i].fallMs > t) visIdx.push(i);
      else if (t - out[i].spawnAt > maxFall) break; // 더 앞은 이미 다 떨어짐
    }
    const visible = new Set(visIdx.map((i) => out[i].text));

    // 점수 묶음 고르기
    let order: (1 | 2 | 4)[];
    if (buckets[4].length > 0 && out.length > 0 && count4 < Math.ceil((out.length + 1) / 10)) order = [4, 2, 1];
    else {
      let r = rand() * totalSize;
      let pick: 1 | 2 | 4 = 1;
      for (const [b, n] of sizes) {
        if (n === 0) continue;
        pick = b;
        if (r < n) break;
        r -= n;
      }
      order = [pick, ...([1, 2, 4] as const).filter((b) => b !== pick)];
    }
    let text: string | null = null;
    let points: 1 | 2 | 4 = 1;
    for (const b of order) {
      if (decks[b].size === 0) continue;
      text = decks[b].draw(visible);
      if (text) {
        points = b;
        break;
      }
    }

    if (text) {
      // 칸 고르기: 비어 있는 칸 중 직전 칸에서 2칸 이상 떨어진 곳 우선
      const used = new Set(visIdx.map((i) => laneOf[i]));
      let free = [...Array(lanes).keys()].filter((l) => !used.has(l));
      if (free.length === 0) {
        // 모두 차 있으면 가장 먼저 나온(가장 아래) 낱말의 칸
        const oldest = visIdx.reduce((a, b) => (out[a].spawnAt <= out[b].spawnAt ? a : b));
        free = [laneOf[oldest]];
      }
      const far = free.filter((l) => Math.abs(l - lastLane) >= 2);
      const cands = far.length ? far : free;
      const lane = cands[randInt(rand, cands.length)];
      const jitter = (rand() - 0.5) * 0.3;
      const x = Math.round(((lane + 0.5 + jitter) / lanes) * 10000) / 10000;
      out.push({ index: out.length, text, points, spawnAt: t, fallMs: Math.round(fall / mult[points]), x });
      laneOf.push(lane);
      lastLane = lane;
      if (points === 4) count4++;
    }
    t += Math.max(100, Math.round(fall / conc));
  }
  return out;
}

export function visibleWords(schedule: FallingWord[], elapsedMs: number): FallingWord[] {
  return schedule.filter((w) => w.spawnAt <= elapsedMs && elapsedMs < w.spawnAt + w.fallMs);
}

export function wordY(word: FallingWord, elapsedMs: number): number {
  return Math.max(0, Math.min(1, (elapsedMs - word.spawnAt) / word.fallMs));
}

export function matchSubmission(
  schedule: FallingWord[],
  elapsedMs: number,
  typed: string,
  claimed?: Set<number> | Record<string, unknown>,
): FallingWord | null {
  const s = normalizeText(typed).trim().replace(/\s+/g, ' ');
  if (!s) return null;
  const isClaimed = (i: number) =>
    claimed instanceof Set ? claimed.has(i) : !!claimed && Object.prototype.hasOwnProperty.call(claimed, String(i));
  let best: FallingWord | null = null;
  for (const w of visibleWords(schedule, elapsedMs)) {
    if (w.text !== s || isClaimed(w.index)) continue;
    if (!best || wordY(w, elapsedMs) > wordY(best, elapsedMs)) best = w;
  }
  return best;
}
