import { describe, expect, it } from 'vitest';
import {
  BATTLE_DURATIONS,
  FAST_MULT,
  POWER_INDEX_BASE,
  buildSchedule,
  concurrentCount,
  isPowerIndex,
  nextPowerIndex,
  normalizeDuration,
  wordAlpha,
  wordSway,
  fallMsAt,
  matchSubmission,
  mulberry32,
  visibleWords,
  wordY,
  type FallingWord,
} from './battle';
import { battlePoints } from './scoring';
import { seedFromString, shuffle } from './rng';

const POOL = [
  '나라', '어머니', '이마', '아이', '머리', '말', '날', '나리', // 1점
  '광합성', '세포', '분자', '원자', '지층', '화산', '기후', '대륙', '문장', '방정식', '함수', '비례', '역사', '문화', // 2점
  '지구 온난화', '물의 순환', '세포 분열', '일차 방정식', // 4점
];

describe('mulberry32', () => {
  it('같은 시드면 같은 수열', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });
  it('값은 [0, 1)', () => {
    const r = mulberry32(9);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('알려진 첫 값(엔진 간 고정 확인)', () => {
    // 비트 연산만 쓰므로 어느 브라우저든 같다
    expect(mulberry32(1)()).toBeCloseTo(0.6270739405881613, 15);
  });
  it('다른 시드는 다른 수열', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
  it('shuffle 은 원소를 보존', () => {
    expect(shuffle([1, 2, 3, 4, 5], mulberry32(3)).sort()).toEqual([1, 2, 3, 4, 5]);
  });
  it('seedFromString 결정적', () => {
    expect(seedFromString('room-1')).toBe(seedFromString('room-1'));
    expect(seedFromString('room-1')).not.toBe(seedFromString('room-2'));
  });
});

describe('concurrentCount / fallMsAt', () => {
  it.each([
    [1, 4],
    [2, 5],
    [3, 6],
    [8, 11],
    [13, 16],
    [16, 16],
    [30, 16],
  ])('인원 %i → 동시 %i개', (n, c) => {
    expect(concurrentCount(n)).toBe(c);
  });
  it.each([
    [0, 10000],
    [60000, 8000],
    [120000, 6000],
    [200000, 6000],
  ])('fallMsAt(%i) = %i', (t, f) => {
    expect(fallMsAt(t, 120000)).toBe(f);
  });
});

describe('깜빡·흔들·파워·경기 시간', () => {
  it('wordAlpha: 보통 낱말은 1, 깜빡 낱말은 보였다 사라진다', () => {
    expect(wordAlpha({ blink: false, spawnAt: 0 }, 900)).toBe(1);
    const b = { blink: true, spawnAt: 1000 };
    expect(wordAlpha(b, 1000)).toBe(1);
    expect(wordAlpha(b, 1000 + 600)).toBe(1);
    expect(wordAlpha(b, 1000 + 1000)).toBe(0);
    expect(wordAlpha(b, 1000 + 1500)).toBe(1); // 다음 주기
    for (let t = 1000; t < 6000; t += 37) {
      const a = wordAlpha(b, t);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });
  it('wordSway: 보통 낱말은 0, 흔들 낱말은 −1~1', () => {
    expect(wordSway({ zigzag: false, spawnAt: 0, fallMs: 6000 }, 500)).toBe(0);
    const z = { zigzag: true, spawnAt: 0, fallMs: 6000 };
    expect(wordSway(z, 0)).toBe(0);
    expect(wordSway(z, 500)).toBeCloseTo(1, 5);
    for (let t = 0; t < 6000; t += 111) expect(Math.abs(wordSway(z, t))).toBeLessThanOrEqual(1);
  });
  it('파워 칸 번호', () => {
    expect(isPowerIndex(3)).toBe(false);
    expect(isPowerIndex(POWER_INDEX_BASE)).toBe(true);
    expect(nextPowerIndex(undefined)).toBe(POWER_INDEX_BASE);
    expect(nextPowerIndex({ '5': 1, [String(POWER_INDEX_BASE)]: 1 })).toBe(POWER_INDEX_BASE + 1);
  });
  it('경기 시간은 목록에 있는 값만, 아니면 120초', () => {
    for (const d of BATTLE_DURATIONS) expect(normalizeDuration(d)).toBe(d);
    expect(normalizeDuration(77)).toBe(120);
    expect(normalizeDuration(undefined)).toBe(120);
    expect(normalizeDuration('180')).toBe(180);
  });
});

describe('buildSchedule', () => {
  const s16 = buildSchedule(42, POOL, 16, 120);
  const s2 = buildSchedule(42, POOL, 2, 120);

  it('같은 인자면 완전히 같다', () => {
    expect(buildSchedule(42, POOL, 16, 120)).toEqual(s16);
    expect(JSON.stringify(buildSchedule(42, POOL, 2, 120))).toBe(JSON.stringify(s2));
  });
  it('pool 순서가 달라도 같다(내부에서 정렬)', () => {
    expect(buildSchedule(42, [...POOL].reverse(), 16, 120)).toEqual(s16);
    expect(buildSchedule(42, shuffle(POOL, mulberry32(5)), 16, 120)).toEqual(s16);
  });
  it('pool 중복·앞뒤 공백·NFD 는 무시', () => {
    const messy = [...POOL, ' 나라 ', '광합성'.normalize('NFD'), '세포'];
    expect(buildSchedule(42, messy, 16, 120)).toEqual(s16);
  });
  it('시드가 다르면 다르다', () => {
    expect(buildSchedule(43, POOL, 16, 120)).not.toEqual(s16);
  });
  it('index 는 0부터 차례, spawnAt 은 증가, 경기 안', () => {
    s16.forEach((w, i) => {
      expect(w.index).toBe(i);
      if (i) expect(w.spawnAt).toBeGreaterThan(s16[i - 1].spawnAt);
      expect(w.spawnAt).toBeLessThan(120000);
      expect(Number.isInteger(w.spawnAt)).toBe(true);
    });
  });
  it('fallMs 는 10000 에서 6000 쪽으로 줄어든다', () => {
    expect(s16[0].fallMs).toBe(10000);
    const slow = s16.filter((w) => !w.fast); // 빠른 낱말은 따로 확인
    for (let i = 1; i < slow.length; i++) expect(slow[i].fallMs).toBeLessThanOrEqual(slow[i - 1].fallMs);
    const last = slow[slow.length - 1];
    expect(last.fallMs).toBeGreaterThanOrEqual(6000);
    expect(last.fallMs).toBeLessThan(6400);
  });
  it('x 는 0~1', () => {
    for (const w of s16) {
      expect(w.x).toBeGreaterThan(0);
      expect(w.x).toBeLessThan(1);
    }
  });
  it('points 는 battlePoints 와 같다', () => {
    for (const w of s16) expect(w.points).toBe(battlePoints(w.text));
  });
  it('모든 낱말은 pool 안에 있다', () => {
    for (const w of s16) expect(POOL).toContain(w.text);
  });

  function checkAt(s: FallingWord[], lanes: number) {
    for (const w of s) {
      const t = w.spawnAt;
      const vis = visibleWords(s, t);
      const texts = vis.map((v) => v.text);
      expect(new Set(texts).size, `t=${t}`).toBe(texts.length);
      for (let i = 0; i < vis.length; i++)
        for (let j = i + 1; j < vis.length; j++)
          expect(Math.abs(vis[i].x - vis[j].x), `t=${t}`).toBeGreaterThan(0.69 / lanes);
    }
  }
  it.each([1, 2, 5, 9, 16])('인원 %i: 같은 낱말 동시 2개 없음, 가로 위치 겹침 없음', (n) => {
    const s = buildSchedule(7, POOL, n, 120);
    checkAt(s, concurrentCount(n) + 2);
  });
  it.each([2, 8, 16])('인원 %i: 동시에 떠 있는 수 ≈ 3 + 인원(빠른 낱말만큼 줄 수 있음)', (n) => {
    const s = buildSchedule(11, POOL, n, 120);
    const c = concurrentCount(n);
    let maxVis = 0;
    for (let t = 15000; t < 110000; t += 250) maxVis = Math.max(maxVis, visibleWords(s, t).length);
    expect(maxVis).toBeGreaterThanOrEqual(c);
    expect(maxVis).toBeLessThanOrEqual(c + 1);
  });
  it('4점 낱말이 최소 10%', () => {
    const pool = [...POOL.slice(0, 22), '지구 온난화'];
    for (const seed of [1, 2, 3, 4, 5]) {
      // 4점 낱말이 하나뿐이면 화면에 떠 있는 동안 다시 낼 수 없으므로 동시 수가 적은 방으로 확인
      const s = buildSchedule(seed, pool, 4, 120);
      const n4 = s.filter((w) => w.points === 4).length;
      expect(n4 / s.length).toBeGreaterThanOrEqual(0.1);
    }
  });
  it('4점 낱말이 많은 pool 은 그 비율대로', () => {
    const s = buildSchedule(3, POOL, 16, 120);
    const n2 = s.filter((w) => w.points === 2).length;
    expect(n2 / s.length).toBeGreaterThan(0.35);
  });
  it('4점 낱말이 없어도 동작', () => {
    const s = buildSchedule(3, POOL.slice(0, 22), 4, 120);
    expect(s.length).toBeGreaterThan(30);
    expect(s.every((w) => w.points !== 4)).toBe(true);
  });
  it('낱말이 아주 적어도 동시 중복 없이 동작', () => {
    const s = buildSchedule(3, ['나라', '광합성'], 16, 120);
    expect(s.length).toBeGreaterThan(0);
    checkAt(s, concurrentCount(16) + 2);
  });
  it('빈 pool·칠 수 없는 낱말뿐이면 빈 일정', () => {
    expect(buildSchedule(1, [], 4, 120)).toEqual([]);
    expect(buildSchedule(1, ['“따옴표”', '😀'], 4, 120)).toEqual([]);
    expect(buildSchedule(1, POOL, 4, 0)).toEqual([]);
  });
  it('인원이 많을수록 낱말이 많다', () => {
    expect(s16.length).toBeGreaterThan(s2.length);
  });
  it('방향·특수 낱말: 처음 3개는 평범, 네 방향이 모두 나오고 점수 = 기본 + 보너스', () => {
    for (const w of s16.slice(0, 3)) {
      expect(w.dir).toBe('down');
      expect(w.bonus).toBe(0);
    }
    expect(new Set(s16.map((w) => w.dir))).toEqual(new Set(['down', 'up', 'left', 'right']));
    for (const w of s16) {
      const bonus = (w.fast ? 1 : 0) + (w.blink ? 2 : 0) + (w.zigzag ? 1 : 0) + (w.golden ? w.points : 0);
      expect(w.bonus).toBe(bonus);
      expect(w.score).toBe(w.points + bonus);
    }
    for (const k of ['fast', 'blink', 'zigzag', 'golden'] as const) {
      const n = s16.filter((w) => w[k]).length;
      expect(n, k).toBeGreaterThan(0);
      expect(n / s16.length, k).toBeLessThan(0.3);
    }
  });
  it('빠른 낱말은 낙하 시간이 1.7배 짧다', () => {
    for (const w of s16) {
      const base = fallMsAt(w.spawnAt, 120000);
      expect(w.fallMs).toBe(Math.round(base / (w.fast ? FAST_MULT : 1)));
    }
  });
  it('효과는 낱말·등장 시각·위치를 바꾸지 않는다(인원만 같으면 같은 뼈대)', () => {
    const a = buildSchedule(42, POOL, 16, 120);
    expect(a.map((w) => [w.text, w.spawnAt, w.x])).toEqual(s16.map((w) => [w.text, w.spawnAt, w.x]));
  });
  it('seed 는 큰 수·음수도 받는다', () => {
    expect(buildSchedule(2 ** 40 + 5, POOL, 4, 60).length).toBeGreaterThan(0);
    expect(buildSchedule(-7, POOL, 4, 60)).toEqual(buildSchedule(-7, POOL, 4, 60));
  });
});

describe('visibleWords / wordY / matchSubmission', () => {
  const w = (index: number, text: string, spawnAt: number, fallMs = 10000): FallingWord => ({
    index,
    text,
    points: 2,
    spawnAt,
    fallMs,
    x: 0.5,
    dir: 'down',
    fast: false,
    blink: false,
    zigzag: false,
    golden: false,
    bonus: 0,
    score: 2,
  });
  const sched = [w(0, '세포', 0), w(1, '분자', 2000), w(2, '세포', 11000)];
  it('visibleWords', () => {
    expect(visibleWords(sched, 0).map((x) => x.index)).toEqual([0]);
    expect(visibleWords(sched, 5000).map((x) => x.index)).toEqual([0, 1]);
    expect(visibleWords(sched, 10000).map((x) => x.index)).toEqual([1]);
    expect(visibleWords(sched, 11500).map((x) => x.index)).toEqual([1, 2]);
  });
  it('wordY', () => {
    expect(wordY(sched[0], 0)).toBe(0);
    expect(wordY(sched[0], 5000)).toBe(0.5);
    expect(wordY(sched[0], 20000)).toBe(1);
    expect(wordY(sched[1], 0)).toBe(0);
  });
  it('matchSubmission: 화면에 있고 안 잡힌 낱말', () => {
    expect(matchSubmission(sched, 5000, '세포')!.index).toBe(0);
    expect(matchSubmission(sched, 5000, ' 세포 ')!.index).toBe(0);
    expect(matchSubmission(sched, 5000, '세포', new Set([0]))).toBeNull();
    expect(matchSubmission(sched, 5000, '세포', { '0': { by: 'a', at: 1 } })).toBeNull();
    expect(matchSubmission(sched, 5000, '원자')).toBeNull();
    expect(matchSubmission(sched, 12000, '세포')!.index).toBe(2);
    expect(matchSubmission(sched, 5000, '')).toBeNull();
  });
});
