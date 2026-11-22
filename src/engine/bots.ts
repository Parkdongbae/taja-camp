// 컴퓨터 대결(연습 배틀)의 봇 난이도와 봇 시뮬레이션. 순수 로직(시드 난수 → 결정적).
//
// 공개 API
//   BOT_TIER_KPM = [90, 120, 150, 190, 240, 300]    계급별 추정 타수(한글). 영문은 × BOT_EN_FACTOR(0.75)
//   BOT_FACTORS = [0.8, 1.0, 1.15]   BOT_NAMES = ['컴퓨터 새내기', '컴퓨터 맞수', '컴퓨터 고수']
//   SOLO_LEVEL_MIN = -5, SOLO_LEVEL_MAX = 10, SOLO_LEVEL_STEP = 0.04
//   interface Bot { id: string; name: string; kpm: number }
//   botBaseKpm(student: { rp; bestKo; bestEn; solo? }, lang): number
//       계급 추정값(계급 안 진행률만큼 다음 계급 쪽으로 보간 → RP 가 높을수록 조금 빠름).
//       최고 타수가 있으면 최고 타수 0.7 + 계급 추정 0.3. 여기에 solo.level 1단계당 ±4%. 60~600, 정수.
//   makeBots(baseKpm: number): Bot[]          bot1~bot3, kpm = base × BOT_FACTORS (60~600)
//   nextSoloLevel(level: number, place: number): number   1등 +1 / 2등 유지 / 3등 이하 −1 (−5~10)
//   applySolo(solo: Student['solo'], place: number): { level; wins; games }
//   interface BotClaim { index: number; botId: string; at: number(ms, 경기 시작 기준) }
//   createBotRunner(schedule, bots, seed, durationMs = Infinity): { step(elapsedMs, claimed: Set<number> | Record<string, unknown>): BotClaim[]; freeze(untilMs): void(멈추기) }
//       실시간 스텝 방식. step 은 elapsedMs 까지의 봇 사건을 시간순으로 처리하고 새로 가져간 낱말을 돌려준다.
//       - 봇은 한 번에 낱말 하나: 화면에 있는 미선점 낱말을 고르고(점수 높은 것 선호 + 무작위),
//         반응 400~900ms + 타수 ÷ (kpm/60) 초 × 흔들림 0.85~1.25 (+7% 확률 오타 600ms) 뒤에 완성.
//       - 완성 전에 바닥에 닿으면 실패, 다른 사람이 먼저 가져가면 그 시점에 포기하고 새로 고른다.
//       - durationMs 이후에는 가져가지 않는다.
//   planBotClaims(schedule, bots, seed, durationMs?): BotClaim[]   학생 없이 봇끼리만 끝까지 돌린 계획(테스트·미리보기용)
import type { Lang, Student } from '../data/types';
import type { FallingWord } from './battle';
import { strokeCount } from './hangul';
import { mulberry32 } from './rng';
import { tierProgress } from './scoring';

export const BOT_TIER_KPM = [90, 120, 150, 190, 240, 300];
export const BOT_EN_FACTOR = 0.75;
export const BOT_FACTORS = [0.8, 1.0, 1.15];
export const BOT_NAMES = ['컴퓨터 새내기', '컴퓨터 맞수', '컴퓨터 고수'];
export const SOLO_LEVEL_MIN = -5;
export const SOLO_LEVEL_MAX = 10;
export const SOLO_LEVEL_STEP = 0.04;

export interface Bot {
  id: string;
  name: string;
  kpm: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function botBaseKpm(student: Pick<Student, 'rp' | 'bestKo' | 'bestEn' | 'solo'>, lang: Lang): number {
  const lf = lang === 'en' ? BOT_EN_FACTOR : 1;
  const tp = tierProgress(student.rp || 0);
  const cur = BOT_TIER_KPM[tp.tier] * lf;
  const next = BOT_TIER_KPM[Math.min(BOT_TIER_KPM.length - 1, tp.tier + 1)] * lf;
  const tierEst = cur + (next - cur) * tp.ratio;
  const best = (lang === 'ko' ? student.bestKo : student.bestEn) || 0;
  let base = best > 0 ? 0.7 * best + 0.3 * tierEst : tierEst;
  const level = clamp(Math.round(student.solo?.level ?? 0), SOLO_LEVEL_MIN, SOLO_LEVEL_MAX);
  base *= 1 + SOLO_LEVEL_STEP * level;
  return Math.round(clamp(base, 60, 600));
}

export function makeBots(baseKpm: number): Bot[] {
  return BOT_FACTORS.map((f, i) => ({
    id: `bot${i + 1}`,
    name: BOT_NAMES[i],
    kpm: Math.round(clamp(baseKpm * f, 60, 600)),
  }));
}

export function nextSoloLevel(level: number, place: number): number {
  const d = place === 1 ? 1 : place === 2 ? 0 : -1;
  return clamp(Math.round(level || 0) + d, SOLO_LEVEL_MIN, SOLO_LEVEL_MAX);
}

export function applySolo(solo: Student['solo'], place: number): { level: number; wins: number; games: number } {
  const s = solo ?? { level: 0, wins: 0, games: 0 };
  return {
    level: nextSoloLevel(s.level ?? 0, place),
    wins: (s.wins ?? 0) + (place === 1 ? 1 : 0),
    games: (s.games ?? 0) + 1,
  };
}

export interface BotClaim {
  index: number;
  botId: string;
  at: number;
}

interface BotState {
  bot: Bot;
  rand: () => number;
  target: number | null; // 노리는 낱말 index
  doneAt: number; // 완성(또는 실패) 시각
  fails: boolean; // 완성 전에 바닥에 닿음
  freeAt: number; // target 이 없을 때 다음에 고를 시각
}

const REACT_MIN = 400;
const REACT_MAX = 900;
const TYPO_RATE = 0.07;
const TYPO_MS = 600;

export function createBotRunner(schedule: FallingWord[], bots: Bot[], seed: number, durationMs = Infinity) {
  const states: BotState[] = bots.map((bot, i) => ({
    bot,
    rand: mulberry32((seed + Math.imul(0x9e3779b9, i + 1)) >>> 0),
    target: null,
    doneAt: 0,
    fails: false,
    freeAt: 0,
  }));
  const taken = new Set<number>(); // 봇이 가져간 낱말
  let clock = 0;

  const bottom = (w: FallingWord) => w.spawnAt + w.fallMs;

  function nextSpawnAfter(t: number): number {
    for (const w of schedule) if (w.spawnAt > t) return w.spawnAt;
    return Infinity;
  }

  function pick(s: BotState, now: number, isTaken: (i: number) => boolean) {
    const cands = schedule.filter((w) => w.spawnAt <= now && now < bottom(w) && !isTaken(w.index));
    if (cands.length === 0) {
      s.target = null;
      s.freeAt = nextSpawnAfter(now);
      return;
    }
    const msPerStroke = 60000 / Math.max(1, s.bot.kpm);
    // 가중치: 점수 높은 것 선호, 시간이 모자랄 것 같으면 덜 고름
    const weights = cands.map((w) => {
      const est = REACT_MIN + strokeCount(w.text) * msPerStroke;
      const pref = w.points === 4 ? 2 : w.points === 2 ? 1.4 : 1;
      return pref * (now + est < bottom(w) ? 1 : 0.25);
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    let r = s.rand() * sum;
    let k = 0;
    while (k < cands.length - 1 && r >= weights[k]) r -= weights[k++];
    const w = cands[k];
    const react = REACT_MIN + s.rand() * (REACT_MAX - REACT_MIN);
    const jitter = 0.85 + s.rand() * 0.4;
    const typo = s.rand() < TYPO_RATE ? TYPO_MS : 0;
    const done = now + react + strokeCount(w.text) * msPerStroke * jitter + typo;
    s.target = w.index;
    s.fails = done >= bottom(w);
    s.doneAt = s.fails ? bottom(w) : done;
  }

  function step(elapsedMs: number, claimed?: Set<number> | Record<string, unknown>): BotClaim[] {
    const ext = (i: number) =>
      claimed instanceof Set ? claimed.has(i) : !!claimed && Object.prototype.hasOwnProperty.call(claimed, String(i));
    const isTaken = (i: number) => taken.has(i) || ext(i);
    const end = Math.min(elapsedMs, durationMs);
    const out: BotClaim[] = [];
    if (end < clock) return out;

    // 남(학생)이 이미 가져간 낱말을 노리던 봇은 지금 포기
    for (const s of states) {
      if (s.target !== null && ext(s.target) && !taken.has(s.target)) {
        s.target = null;
        s.freeAt = clock;
      }
    }

    for (;;) {
      let best: BotState | null = null;
      let bt = Infinity;
      for (const s of states) {
        const t = s.target !== null ? s.doneAt : s.freeAt;
        if (t < bt) {
          bt = t;
          best = s;
        }
      }
      if (!best || bt > end) break;
      clock = Math.max(clock, bt);
      const s = best;
      if (s.target === null) {
        pick(s, clock, isTaken);
        if (s.target === null && s.freeAt <= clock) s.freeAt = Infinity; // 안전장치
        continue;
      }
      const idx = s.target;
      s.target = null;
      s.freeAt = clock;
      if (s.fails || isTaken(idx)) continue; // 바닥에 닿았거나 다른 봇이 먼저 가져감 → 새로 고르기
      taken.add(idx);
      out.push({ index: idx, botId: s.bot.id, at: Math.round(clock) });
      // 같은 낱말을 노리던 다른 봇은 이 시각에 포기
      for (const o of states) {
        if (o !== s && o.target === idx) {
          o.target = null;
          o.freeAt = clock;
        }
      }
    }
    clock = Math.max(clock, end);
    return out;
  }

  /** 멈추기: 모든 봇이 하던 낱말을 놓고 untilMs(경과 ms)까지 쉰다. step(지금) 뒤에 부른다. */
  function freeze(untilMs: number) {
    for (const s of states) {
      s.target = null;
      s.fails = false;
      s.freeAt = Math.max(untilMs, clock);
    }
  }

  return { step, freeze };
}

export function planBotClaims(schedule: FallingWord[], bots: Bot[], seed: number, durationMs = Infinity): BotClaim[] {
  const last = schedule.reduce((m, w) => Math.max(m, w.spawnAt + w.fallMs), 0);
  return createBotRunner(schedule, bots, seed, durationMs).step(Math.min(last + 1, durationMs));
}
