// 배틀 낱말 일정. 같은 인자면 어느 브라우저에서든 완전히 같은 결과(결정적). 순수 로직.
//
// 공개 API
//   mulberry32(seed: number): () => number     (rng.ts 에서 다시 내보냄)
//   interface FallingWord { index; text; points: 1|2|4(기본 점수); spawnAt: number(ms, 시작 기준); fallMs: number(화면을 가로지르는 시간);
//       x: number(0~1, 진행 방향과 직각인 축의 위치. 위·아래로 움직이면 가로, 좌·우로 움직이면 세로 위치);
//       dir: 'down'|'up'|'left'|'right'(움직이는 방향. down = 위에서 나와 아래로); fast·blink·zigzag·golden: boolean(특수 낱말);
//       bonus: number(보너스 점수); score: number(얻는 점수 = points + bonus) }
//     - 특수 낱말: 빠름(낙하 시간 ÷ 1.7, +1) · 깜빡(보였다 안 보였다, +2) · 흔들(지그재그, +1) · 황금(기본 점수만큼 더). 겹칠 수 있다.
//     - 방향·특수 효과는 별도 난수(seed 에서 파생)로 정하므로 낱말·등장 시각·위치는 효과와 무관하게 같다. 처음 3개는 효과 없이 위에서 내려온다.
//   wordAlpha(word, elapsedMs): number   깜빡 낱말의 불투명도(0~1). 보통 낱말은 1
//   wordSway(word, elapsedMs): number    흔들 낱말의 직각 축 흔들림(−1~1). 보통 낱말은 0
//   POWER_NEED = 20(연속 성공 수) · POWER_INDEX_BASE = 1000000 · isPowerIndex(i) · nextPowerIndex(claims)
//     - 파워(포인트 회수)는 claims 의 POWER_INDEX_BASE 이상 번호 칸에 기록한다(낱말 번호와 겹치지 않음). 점수 계산은 scoring.rankPlayers.
//   협동 낱말(FallingWord.coop, 참가 2명 이상일 때 약 7%): 선착순이 아니라 각자 친다. 접속 중인 참가자 모두가 치면
//     모두 points × coopMult 를 얻고, 실패하면 친 사람만 points 를 얻는다. 다른 특수 효과는 붙지 않는다.
//     coopMult 는 속도로 정한다: 아주 느림(낙하 시간 ×1.5) 2배 · 보통 3배 · 빠름(×0.7) 4배.
//     기록은 claims 의 COOP_INDEX_BASE(10000000) + 낱말 번호 × 100 + 빈 칸(0~99)에 { by, at }.
//   coopWordOf(claimIndex): 협동 칸이면 낱말 번호, 아니면 −1 · nextCoopIndex(wordIndex, claims): 그 낱말의 빈 칸 번호(없으면 −1)
//   coopHits(claims): Map<낱말 번호, Record<학번, 시각>> · coopRequired(players): 접속 중인 참가자 학번들
//   coopDone(hits, required): 모두 쳤는가
//   BATTLE_DURATIONS = [60, 90, 120, 180, 300] · normalizeDuration(sec): 목록에 없으면 120
//   concurrentCount(playerCount, classBattle?): number   보통 3 + 인원(4~16). 학급 배틀은 3 + 인원 × 1.5(올림, 최대 CLASS_CONCURRENT_MAX)
//   laneCount(playerCount, classBattle?): 직각 축 칸 수
//   fallMsAt(elapsedMs: number, durationMs: number): number   10000 → 6000 선형
//   normalizeFallSpeed(x?): FallSpeed   점수별 낙하 속도(%)를 50~200 으로 정리(없으면 기본값)
//   buildSchedule(seed: number, pool: string[], playerCount: number, durationSec: number, speed?: FallSpeed, opts?: { riddles?: Iterable<string>; classBattle?: boolean }): FallingWord[]
//     - opts.classBattle 이면 인원에 비례해 동시 낱말 수를 늘린다(학급 배틀은 정원 40명).
//     - 피버(events.battleEvents) 동안에는 등장 간격이 0.6배로 줄어 낱말이 쏟아진다.
//     - 역전 찬스 낱말(comeback, 2명 이상·경기 25% 이후 약 6%, +4점): 하위권(events.isUnderdog)에게만 보이고 그들만 칠 수 있다. 다른 효과 없음.
//     - 뜻 낱말(riddle, opts.riddles 에 있는 낱말의 약 10%, +2점): 화면에는 뜻풀이가 떠다니고 낱말을 쳐야 한다. 깜빡과는 겹치지 않는다.
//     - speed 를 주면 낱말의 fallMs = 기본 낙하 시간 ÷ (점수별 속도 ÷ 100). 등장 간격은 기본 낙하 시간 그대로.
//     - pool 은 NFC·trim·중복 제거·칠 수 없는 것 제외 후 코드 단위 순서로 다시 정렬한다.
//     - 등장 간격 = fallMs ÷ 동시 낱말 수. 경기 끝 1초 전까지 등장.
//     - 같은 낱말이 동시에 2개 뜨지 않음. x 는 (동시 수 + 4)개 칸에 나눠, 떠 있는 낱말과 칸이 겹치지 않게.
//     - 점수 비율은 pool 구성에 비례, 단 4점 낱말이 pool 에 있으면 일정의 어느 앞부분(2개 이상)을 잘라도 4점이 10% 이상.
//   visibleWords(schedule: FallingWord[], elapsedMs: number): FallingWord[]   spawnAt ≤ t < spawnAt+fallMs
//   wordY(word: FallingWord, elapsedMs: number): number   0(맨 위) ~ 1(바닥)
//   matchSubmission(schedule, elapsedMs, typed: string, claimed?: Set<number> | Record<string, unknown>): FallingWord | null
//       화면에 있고 아직 안 잡힌 낱말 중 입력(NFC·trim)과 정확히 같은 것. 여럿이면 가장 아래 것
import { battlePoints } from './scoring';
import { isTypeable, normalizeText } from './hangul';
import { mulberry32, randInt, shuffle } from './rng';
import { battleEvents, feverAt } from './events';
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

export type WordDir = 'down' | 'up' | 'left' | 'right';

export interface FallingWord {
  index: number;
  text: string;
  points: 1 | 2 | 4;
  spawnAt: number;
  fallMs: number;
  x: number;
  dir: WordDir;
  fast: boolean;
  blink: boolean;
  zigzag: boolean;
  golden: boolean;
  bonus: number;
  score: number;
  coop: boolean;
  /** 협동 성공 배수(2~4). 협동 낱말이 아니면 0 */
  coopMult: 0 | 2 | 3 | 4;
  /** 역전 찬스: 하위권에게만 보인다 */
  comeback: boolean;
  /** 뜻 낱말: 뜻풀이를 보고 낱말을 친다 */
  riddle: boolean;
}

export const COMEBACK_RATE = 0.06;
export const COMEBACK_BONUS = 4;
export const RIDDLE_RATE = 0.1;
export const RIDDLE_BONUS = 2;
export const FEVER_SPAWN = 0.6; // 피버 동안 등장 간격 배율

// ── 협동 낱말 ──
export const COOP_INDEX_BASE = 10_000_000;
export const COOP_SLOTS = 100;
export const COOP_RATE = 0.07;
/** 배수별 낙하 시간 배율: 느릴수록 배수가 낮다 */
export const COOP_FALL: Record<2 | 3 | 4, number> = { 2: 1.5, 3: 1, 4: 0.7 };
export function coopWordOf(claimIndex: number): number {
  return Number.isFinite(claimIndex) && claimIndex >= COOP_INDEX_BASE ? Math.floor((claimIndex - COOP_INDEX_BASE) / COOP_SLOTS) : -1;
}
export function nextCoopIndex(wordIndex: number, claims: Record<string, unknown> | undefined | null): number {
  const base = COOP_INDEX_BASE + wordIndex * COOP_SLOTS;
  for (let k = 0; k < COOP_SLOTS; k++) {
    if (!claims || !Object.prototype.hasOwnProperty.call(claims, String(base + k))) return base + k;
  }
  return -1;
}
export function coopHits(claims: Record<string, { by: string; at: number }> | undefined | null): Map<number, Record<string, number>> {
  const out = new Map<number, Record<string, number>>();
  for (const [key, c] of Object.entries(claims ?? {})) {
    const w = coopWordOf(Number(key));
    if (w < 0 || !c?.by) continue;
    let rec = out.get(w);
    if (!rec) out.set(w, (rec = {}));
    rec[c.by] = rec[c.by] === undefined ? c.at : Math.min(rec[c.by], c.at);
  }
  return out;
}
export function coopRequired(players: Record<string, { online?: boolean }> | undefined | null): string[] {
  return Object.entries(players ?? {})
    .filter(([, p]) => p && p.online !== false)
    .map(([id]) => id);
}
export function coopDone(hits: Record<string, number> | undefined, required: string[]): boolean {
  return !!hits && required.length > 0 && required.every((id) => hits[id] !== undefined);
}

export const FAST_MULT = 1.7;
export const BLINK_CYCLE_MS = 1500;
export const PLAIN_FIRST = 3; // 처음 몇 개는 효과 없이

// ── 파워(포인트 회수) ──
export const POWER_NEED = 20;
export const POWER_INDEX_BASE = 1_000_000;
export const isPowerIndex = (i: number) => Number.isFinite(i) && i >= POWER_INDEX_BASE && i < 10_000_000; // 그 위는 협동 칸
/** 아직 쓰이지 않은 가장 앞의 파워 칸 번호 */
export function nextPowerIndex(claims: Record<string, unknown> | undefined | null): number {
  let i = POWER_INDEX_BASE;
  while (claims && Object.prototype.hasOwnProperty.call(claims, String(i))) i++;
  return i;
}

// ── 경기 시간(방장이 고름) ──
export const BATTLE_DURATIONS = [60, 90, 120, 180, 300] as const;
export function normalizeDuration(sec: unknown): number {
  const n = Math.round(Number(sec));
  return (BATTLE_DURATIONS as readonly number[]).includes(n) ? n : 120;
}

/** 학급 배틀 동시 낱말 수 상한(40명일 때 63 → 이 값) */
export const CLASS_CONCURRENT_MAX = 60;

export function concurrentCount(playerCount: number, classBattle = false): number {
  const n = Math.floor(Math.max(1, playerCount));
  // 학급 배틀은 한 반이 한 방에 모이므로 인원에 비례해 넉넉히(1명당 1.5개)
  if (classBattle) return Math.max(4, Math.min(CLASS_CONCURRENT_MAX, 3 + Math.ceil(n * 1.5)));
  return Math.max(4, Math.min(16, 3 + n));
}

/** 직각 축을 나누는 칸 수: 느린 협동 낱말·피버 폭주에도 빈 칸이 남게 넉넉히 */
export function laneCount(playerCount: number, classBattle = false): number {
  return Math.ceil(concurrentCount(playerCount, classBattle) * 1.7) + 4;
}

/** 깜빡 낱말의 불투명도: 주기의 앞 55% 는 보이고 나머지는 사라진다(경계는 부드럽게). */
export function wordAlpha(word: Pick<FallingWord, 'blink' | 'spawnAt'>, elapsedMs: number): number {
  if (!word.blink) return 1;
  const ph = ((((elapsedMs - word.spawnAt) % BLINK_CYCLE_MS) + BLINK_CYCLE_MS) % BLINK_CYCLE_MS) / BLINK_CYCLE_MS;
  const edge = 0.08;
  if (ph < 0.55 - edge) return 1;
  if (ph < 0.55) return (0.55 - ph) / edge;
  if (ph < 1 - edge) return 0;
  return (ph - (1 - edge)) / edge;
}

/** 흔들 낱말의 직각 축 흔들림(−1~1): 화면을 지나는 동안 3번 왕복. */
export function wordSway(word: Pick<FallingWord, 'zigzag' | 'spawnAt' | 'fallMs'>, elapsedMs: number): number {
  if (!word.zigzag || word.fallMs <= 0) return 0;
  return Math.sin(((elapsedMs - word.spawnAt) / word.fallMs) * Math.PI * 6);
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
  opts?: { riddles?: Iterable<string>; classBattle?: boolean } | null,
): FallingWord[] {
  const riddles = new Set<string>();
  for (const w of opts?.riddles ?? []) riddles.add(normalizeText(w).trim().replace(/\s+/g, ' '));
  const ev = battleEvents(seed, durationSec);
  const mult: Record<1 | 2 | 4, number> = speed
    ? { 1: normalizeFallSpeed(speed).p1 / 100, 2: normalizeFallSpeed(speed).p2 / 100, 4: normalizeFallSpeed(speed).p4 / 100 }
    : { 1: 1, 2: 1, 4: 1 };
  const maxFall = Math.ceil((10000 / Math.min(mult[1], mult[2], mult[4])) * COOP_FALL[2]); // 가장 오래 떠 있는 낱말(느린 협동 낱말)
  const uniq = [...new Set(pool.map((w) => normalizeText(w).trim().replace(/\s+/g, ' ')))].filter(
    (w) => w && isTypeable(w),
  );
  uniq.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const durMs = Math.round(durationSec * 1000);
  if (uniq.length === 0 || durMs <= 0) return [];

  const rand = mulberry32(seed);
  const fx = mulberry32((Math.floor(seed) ^ 0x9e3779b9) >>> 0); // 방향·특수 효과 전용
  const buckets: Record<1 | 2 | 4, string[]> = { 1: [], 2: [], 4: [] };
  for (const w of uniq) buckets[battlePoints(w)].push(w);
  const decks = { 1: new Deck(buckets[1], rand), 2: new Deck(buckets[2], rand), 4: new Deck(buckets[4], rand) };
  const sizes: [1 | 2 | 4, number][] = [
    [1, buckets[1].length],
    [2, buckets[2].length],
    [4, buckets[4].length],
  ];
  const totalSize = uniq.length;

  const conc = concurrentCount(playerCount, !!opts?.classBattle);
  const lanes = laneCount(playerCount, !!opts?.classBattle);
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
      // 방향·특수 효과(난수는 항상 같은 횟수만큼 뽑는다)
      const rd = fx();
      const rf = fx();
      const rb = fx();
      const rz = fx();
      const rg = fx();
      const rc = fx();
      const rs = fx();
      const rk = fx();
      const rr = fx();
      const plain = out.length < PLAIN_FIRST;
      const dir: WordDir = plain || rd < 0.4 ? 'down' : rd < 0.6 ? 'up' : rd < 0.8 ? 'left' : 'right';
      // 협동 낱말: 2명 이상일 때만. 속도(배수)는 느림 50% · 보통 30% · 빠름 20%. 다른 효과는 붙지 않는다
      const coop = !plain && playerCount >= 2 && rc < COOP_RATE;
      const coopMult: 0 | 2 | 3 | 4 = !coop ? 0 : rs < 0.5 ? 2 : rs < 0.8 ? 3 : 4;
      const comeback = !plain && !coop && playerCount >= 2 && t > durMs * 0.25 && rk < COMEBACK_RATE;
      const special = !plain && !coop && !comeback;
      const fast = special && rf < 0.15;
      const blink = special && rb < 0.12;
      const zigzag = special && rz < 0.12;
      const golden = special && rg < 0.04;
      const riddle = special && !blink && rr < RIDDLE_RATE && riddles.has(text);
      const bonus =
        (fast ? 1 : 0) + (blink ? 2 : 0) + (zigzag ? 1 : 0) + (golden ? points : 0) + (comeback ? COMEBACK_BONUS : 0) + (riddle ? RIDDLE_BONUS : 0);
      out.push({
        index: out.length,
        text,
        points,
        spawnAt: t,
        fallMs: Math.round((fall / mult[points] / (fast ? FAST_MULT : 1)) * (coopMult ? COOP_FALL[coopMult] : 1)),
        x,
        dir,
        fast,
        blink,
        zigzag,
        golden,
        bonus,
        score: points + bonus,
        coop,
        coopMult,
        comeback,
        riddle,
      });
      laneOf.push(lane);
      lastLane = lane;
      if (points === 4) count4++;
    }
    t += Math.max(100, Math.round((fall / conc) * (feverAt(ev, t) ? FEVER_SPAWN : 1)));
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
