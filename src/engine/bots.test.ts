import { describe, expect, it } from 'vitest';
import { buildSchedule } from './battle';
import {
  applySolo,
  botBaseKpm,
  createBotRunner,
  makeBots,
  nextSoloLevel,
  planBotClaims,
  type Bot,
} from './bots';
import { strokeCount } from './hangul';

const stu = (o: Partial<{ rp: number; bestKo: number; bestEn: number; solo: { level: number; wins: number; games: number } }> = {}) => ({
  rp: 0,
  bestKo: 0,
  bestEn: 0,
  ...o,
});

const POOL = [
  '나라', '어머니', '이마', '광합성', '민주주의', '세포', '지구 온난화', '학교', '단풍', '높은 산',
  '바다', '하늘', '사과', '포도', '기차', '자전거', '도서관', '운동장', '작은 약속', '맑은 하늘',
  '고래', '나무', '무궁화', '태극기', '시간표', '냉장고', '컴퓨터', '연필', '공책', '친구',
];
const DUR = 120;
const sched = buildSchedule(12345, POOL, 4, DUR);

describe('botBaseKpm', () => {
  it('최고 타수가 없으면 계급 추정값', () => {
    expect(botBaseKpm(stu({ rp: 0 }), 'ko')).toBe(90);
    expect(botBaseKpm(stu({ rp: 100 }), 'ko')).toBe(120);
    expect(botBaseKpm(stu({ rp: 300 }), 'ko')).toBe(150);
    expect(botBaseKpm(stu({ rp: 1500 }), 'ko')).toBe(300);
  });
  it('계급 안에서 RP 가 높을수록 조금 빠름', () => {
    expect(botBaseKpm(stu({ rp: 50 }), 'ko')).toBe(105); // 90 → 120 의 절반
    expect(botBaseKpm(stu({ rp: 200 }), 'ko')).toBeGreaterThan(botBaseKpm(stu({ rp: 100 }), 'ko'));
  });
  it('영문은 0.75배, 영문 최고 타수 사용', () => {
    expect(botBaseKpm(stu({ rp: 0 }), 'en')).toBe(Math.round(90 * 0.75));
    expect(botBaseKpm(stu({ rp: 0, bestKo: 300, bestEn: 100 }), 'en')).toBe(Math.round(0.7 * 100 + 0.3 * 67.5));
  });
  it('최고 타수 0.7 + 계급 추정 0.3', () => {
    expect(botBaseKpm(stu({ rp: 0, bestKo: 120 }), 'ko')).toBe(Math.round(0.7 * 120 + 0.3 * 90)); // 111
  });
  it('solo.level 1단계당 4%, 범위 -5~10', () => {
    const b = 0.7 * 200 + 0.3 * 90;
    expect(botBaseKpm(stu({ bestKo: 200, solo: { level: 2, wins: 0, games: 0 } }), 'ko')).toBe(Math.round(b * 1.08));
    expect(botBaseKpm(stu({ bestKo: 200, solo: { level: -3, wins: 0, games: 0 } }), 'ko')).toBe(Math.round(b * 0.88));
    expect(botBaseKpm(stu({ bestKo: 200, solo: { level: 99, wins: 0, games: 0 } }), 'ko')).toBe(Math.round(b * 1.4));
    expect(botBaseKpm(stu({ bestKo: 200, solo: { level: -99, wins: 0, games: 0 } }), 'ko')).toBe(Math.round(b * 0.8));
  });
  it('60~600 으로 제한', () => {
    expect(botBaseKpm(stu({ bestKo: 1500, rp: 2000, solo: { level: 10, wins: 0, games: 0 } }), 'ko')).toBe(600);
    expect(botBaseKpm(stu({ rp: 0, solo: { level: -5, wins: 0, games: 0 } }), 'en')).toBe(60);
  });
});

describe('makeBots / solo level', () => {
  it('배율 0.8 / 1.0 / 1.15', () => {
    expect(makeBots(200).map((b) => b.kpm)).toEqual([160, 200, 230]);
    expect(makeBots(200).map((b) => b.id)).toEqual(['bot1', 'bot2', 'bot3']);
  });
  it('nextSoloLevel: 1등 +1, 2등 유지, 3등 이하 -1, 범위', () => {
    expect(nextSoloLevel(0, 1)).toBe(1);
    expect(nextSoloLevel(3, 2)).toBe(3);
    expect(nextSoloLevel(3, 3)).toBe(2);
    expect(nextSoloLevel(0, 4)).toBe(-1);
    expect(nextSoloLevel(10, 1)).toBe(10);
    expect(nextSoloLevel(-5, 4)).toBe(-5);
  });
  it('applySolo: games +1, 1등이면 wins +1', () => {
    expect(applySolo(undefined, 1)).toEqual({ level: 1, wins: 1, games: 1 });
    expect(applySolo({ level: 2, wins: 3, games: 5 }, 3)).toEqual({ level: 1, wins: 3, games: 6 });
  });
});

describe('createBotRunner / planBotClaims', () => {
  const bots: Bot[] = makeBots(150);

  it('결정적: 같은 seed 면 같은 결과, 프레임 간격과 무관(학생 행동 없음)', () => {
    const a = planBotClaims(sched, bots, 7, DUR * 1000);
    const b = planBotClaims(sched, bots, 7, DUR * 1000);
    expect(a).toEqual(b);
    const r = createBotRunner(sched, bots, 7, DUR * 1000);
    const stepped: ReturnType<typeof r.step> = [];
    for (let t = 0; t <= DUR * 1000; t += 16.7) stepped.push(...r.step(t));
    stepped.push(...r.step(DUR * 1000));
    expect(stepped).toEqual(a);
    expect(planBotClaims(sched, bots, 8, DUR * 1000)).not.toEqual(a);
  });

  it('같은 낱말을 두 번 가져가지 않고, 화면에 있을 때만 가져감', () => {
    const plan = planBotClaims(sched, bots, 3, DUR * 1000);
    expect(plan.length).toBeGreaterThan(5);
    const seen = new Set<number>();
    for (const c of plan) {
      expect(seen.has(c.index)).toBe(false);
      seen.add(c.index);
      const w = sched[c.index];
      expect(c.at).toBeGreaterThanOrEqual(w.spawnAt);
      expect(c.at).toBeLessThan(w.spawnAt + w.fallMs + 1);
      expect(c.at).toBeLessThanOrEqual(DUR * 1000);
    }
  });

  it('자기 타수보다 훨씬 빠르게 가져가지 않음 (타수 합 / 경기 시간 ≤ kpm × 1.3)', () => {
    for (const base of [60, 120, 250, 450]) {
      const bs = makeBots(base);
      for (const seed of [1, 2, 3]) {
        const plan = planBotClaims(buildSchedule(seed, POOL, 4, DUR), bs, seed, DUR * 1000);
        const s2 = buildSchedule(seed, POOL, 4, DUR);
        for (const b of bs) {
          const strokes = plan.filter((c) => c.botId === b.id).reduce((n, c) => n + strokeCount(s2[c.index].text), 0);
          expect(strokes / (DUR / 60)).toBeLessThanOrEqual(b.kpm * 1.3);
        }
      }
    }
  });

  it('이미 선점된 낱말(학생)은 가져가지 않음', () => {
    const r = createBotRunner(sched, bots, 5, DUR * 1000);
    const claimed = new Set<number>();
    const got: number[] = [];
    for (let t = 0; t <= DUR * 1000; t += 50) {
      // 학생이 짝수 번 낱말을 등장 즉시 가져간다고 가정
      for (const w of sched) if (w.index % 2 === 0 && w.spawnAt <= t) claimed.add(w.index);
      for (const c of r.step(t, claimed)) {
        expect(claimed.has(c.index)).toBe(false);
        got.push(c.index);
        claimed.add(c.index);
      }
    }
    expect(got.every((i) => i % 2 === 1)).toBe(true);
    expect(got.length).toBeGreaterThan(0);
  });

  it('Record 형태의 claims 도 받음', () => {
    const r = createBotRunner(sched, bots, 5, DUR * 1000);
    const all: Record<string, unknown> = Object.fromEntries(sched.map((w) => [String(w.index), 1]));
    expect(r.step(DUR * 1000, all)).toEqual([]);
  });

  it('빠른 봇일수록 대체로 더 많이 가져감', () => {
    const plan = planBotClaims(sched, makeBots(200), 11, DUR * 1000);
    const n = (id: string) => plan.filter((c) => c.botId === id).length;
    expect(n('bot3')).toBeGreaterThanOrEqual(n('bot1'));
  });
});

import { makeBots as mk, planBotCoop } from './bots';
describe('planBotCoop', () => {
  it('협동 낱말만, 화면에 있는 동안, 시간순, 결정적', () => {
    const bots = mk(150);
    const plan = planBotCoop(sched, bots, 99, DUR * 1000);
    expect(plan).toEqual(planBotCoop(sched, bots, 99, DUR * 1000));
    const coop = sched.filter((w) => w.coop);
    expect(coop.length).toBeGreaterThan(0);
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.length).toBeLessThanOrEqual(coop.length * bots.length);
    plan.forEach((c, i) => {
      const w = sched[c.index];
      expect(w.coop).toBe(true);
      expect(c.at).toBeGreaterThan(w.spawnAt);
      expect(c.at).toBeLessThan(w.spawnAt + w.fallMs);
      if (i) expect(c.at).toBeGreaterThanOrEqual(plan[i - 1].at);
    });
    // 같은 봇이 같은 낱말을 두 번 치지 않는다
    expect(new Set(plan.map((c) => `${c.botId}:${c.index}`)).size).toBe(plan.length);
  });
});
