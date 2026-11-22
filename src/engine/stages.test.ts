import { describe, expect, it } from 'vitest';
import { sameTarget, type KeyTarget } from './layout';
import { mulberry32 } from './rng';
import {
  DRILL_COUNTS,
  STAGES,
  TRACK_LABEL,
  getStage,
  isBattleUnlocked,
  isEnBattleUnlocked,
  isStagePassed,
  isStageUnlocked,
  isTestPassed,
  makeDrill,
  matchesTarget,
  nextStageId,
  stagesOf,
  testScore,
  type DrillKind,
} from './stages';

const labels = (ks: KeyTarget[]) => ks.map((k) => k.label).join('');

function hasTriple(seq: KeyTarget[]): boolean {
  for (let i = 2; i < seq.length; i++) {
    if (sameTarget(seq[i], seq[i - 1]) && sameTarget(seq[i], seq[i - 2])) return true;
  }
  return false;
}

describe('STAGES', () => {
  it('17단계, 순서', () => {
    expect(STAGES.map((s) => s.id)).toEqual([
      'K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8', 'S1', 'S2', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7',
    ]);
  });
  it.each([
    ['K1', 'ㅁㄴㅇㄹㅓㅏㅣ;'],
    ['K2', 'ㅂㅈㄷㄱ'],
    ['K3', 'ㅋㅌㅊㅍ'],
    ['K4', 'ㅅㅛㅎㅗㅠ'],
    ['K5', 'ㅕㅑㅐㅔ'],
    ['K6', 'ㅜㅡ,./'],
    ['K7', 'ㅃㅉㄸㄲㅆㅒㅖ'],
    ['K8', '1234567890'],
    ['S1', '!@#$%^&*()'],
    ['E1', 'asdfjkl;'],
    ['E4', 'tyghb'],
  ])('%s 새 글쇠 = %s', (id, ls) => {
    expect(labels(getStage(id)!.newKeys)).toBe(ls);
  });
  it('K7 은 모두 Shift, E7 은 대문자 26개 모두 Shift', () => {
    expect(getStage('K7')!.newKeys.every((k) => k.shift)).toBe(true);
    const e7 = getStage('E7')!.newKeys;
    expect(e7.length).toBe(26);
    expect(e7.every((k) => k.shift)).toBe(true);
  });
  it('E 단계는 같은 자리의 K 단계와 code 가 같다', () => {
    for (let i = 1; i <= 6; i++) {
      const k = getStage(`K${i}`)!.newKeys.map((t) => t.code).sort();
      const e = getStage(`E${i}`)!.newKeys.map((t) => t.code).sort();
      expect(e).toEqual(k);
    }
  });
  it('allKeys 는 트랙 안에서 누적', () => {
    expect(getStage('K1')!.allKeys.length).toBe(8);
    expect(getStage('K2')!.allKeys.length).toBe(12);
    expect(getStage('K8')!.allKeys.length).toBe(8 + 4 + 4 + 5 + 4 + 5 + 7 + 10);
    expect(getStage('S2')!.allKeys.length).toBe(10 + 19);
    expect(getStage('E7')!.allKeys.length).toBe(8 + 4 + 4 + 5 + 4 + 5 + 26);
  });
  it('stagesOf / order / TRACK_LABEL', () => {
    expect(stagesOf('ko').length).toBe(8);
    expect(stagesOf('symbol').length).toBe(2);
    expect(stagesOf('en').map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(TRACK_LABEL.symbol).toBe('기호');
    expect(getStage('X9')).toBeUndefined();
  });
  it('DRILL_COUNTS', () => {
    expect(DRILL_COUNTS).toEqual({ learn: 30, mix: 40, test: 50, review: 20 });
  });
});

describe('makeDrill: 같은 글쇠 3회 연속 없음 (모든 단계·종류·시드)', () => {
  it.each(STAGES.map((s) => s.id))('%s', (id) => {
    for (const kind of ['learn', 'mix', 'test', 'review'] as DrillKind[]) {
      for (let seed = 1; seed <= 30; seed++) {
        const d = makeDrill(id, kind, DRILL_COUNTS[kind], mulberry32(seed), ['KeyA']);
        expect(d.length).toBe(DRILL_COUNTS[kind]);
        expect(hasTriple(d)).toBe(false);
      }
    }
  });
});

describe('makeDrill 구성', () => {
  const isIn = (ks: KeyTarget[]) => (k: KeyTarget) => ks.some((x) => sameTarget(x, k));
  it('learn 은 새 글쇠만, 모두 한 번 이상', () => {
    const st = getStage('K4')!;
    const d = makeDrill('K4', 'learn', 30, mulberry32(7));
    expect(d.every(isIn(st.newKeys))).toBe(true);
    for (const k of st.newKeys) expect(d.some((x) => sameTarget(x, k))).toBe(true);
  });
  it.each([
    ['K3', 'mix', 40, 28],
    ['K5', 'test', 50, 35],
    ['E2', 'mix', 40, 28],
    ['S2', 'test', 50, 35],
  ] as const)('%s %s: 새 글쇠 70%%', (id, kind, n, nNew) => {
    const st = getStage(id)!;
    for (let seed = 1; seed <= 10; seed++) {
      const d = makeDrill(id, kind, n, mulberry32(seed));
      expect(d.filter(isIn(st.newKeys)).length).toBe(nNew);
      expect(d.every(isIn(st.allKeys))).toBe(true);
    }
  });
  it.each(['K1', 'S1', 'E1'])('%s(트랙 첫 단계)는 test 도 새 글쇠 100%%', (id) => {
    const st = getStage(id)!;
    expect(makeDrill(id, 'test', 50, mulberry32(3)).every(isIn(st.newKeys))).toBe(true);
  });
  it('review 는 focusCodes 위주(70%)', () => {
    const d = makeDrill('K3', 'review', 20, mulberry32(5), ['KeyA', 'KeyZ']);
    const focus = d.filter((k) => k.code === 'KeyA' || k.code === 'KeyZ');
    expect(focus.length).toBe(14);
    expect(hasTriple(d)).toBe(false);
  });
  it('review 에 글쇠 하나만 주어도 3연속 없음', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const d = makeDrill('K2', 'review', 20, mulberry32(seed), ['KeyR']);
      expect(hasTriple(d)).toBe(false);
      expect(d.length).toBe(20);
    }
  });
  it('review 에 해당 글쇠가 없으면 mix 처럼', () => {
    const st = getStage('K2')!;
    const d = makeDrill('K2', 'review', 20, mulberry32(5), ['Digit1']);
    expect(d.filter(isIn(st.newKeys)).length).toBe(14);
  });
  it('같은 시드면 같은 결과', () => {
    expect(makeDrill('K6', 'mix', 40, mulberry32(42))).toEqual(makeDrill('K6', 'mix', 40, mulberry32(42)));
  });
  it('다른 시드면 대체로 다른 결과', () => {
    expect(makeDrill('K6', 'mix', 40, mulberry32(1))).not.toEqual(makeDrill('K6', 'mix', 40, mulberry32(2)));
  });
  it('없는 단계·0개면 빈 배열', () => {
    expect(makeDrill('Z1', 'learn', 30, mulberry32(1))).toEqual([]);
    expect(makeDrill('K1', 'learn', 0, mulberry32(1))).toEqual([]);
  });
  it('Math.random 도 쓸 수 있다', () => {
    expect(makeDrill('K1', 'learn', 30, Math.random).length).toBe(30);
  });
});

describe('matchesTarget', () => {
  const kk = getStage('K7')!.newKeys.find((k) => k.label === 'ㄲ')!;
  const g = getStage('K2')!.newKeys.find((k) => k.label === 'ㄱ')!;
  it.each([
    [{ code: 'KeyR', shiftKey: true }, kk, true],
    [{ code: 'KeyR', shiftKey: false }, kk, false],
    [{ code: 'KeyR', shiftKey: false }, g, true],
    [{ code: 'KeyR', shiftKey: true }, g, false],
    [{ code: 'KeyE', shiftKey: false }, g, false],
  ])('%j vs %s → %s', (e, t, v) => {
    expect(matchesTarget(e, t)).toBe(v);
  });
});

describe('잠금·진행', () => {
  it.each([
    [{ ko: 8, symbol: 2, en: 0 }, true],
    [{ ko: 8, symbol: 1, en: 7 }, false],
    [{ ko: 7, symbol: 2, en: 7 }, false],
    [{ ko: 0, symbol: 0, en: 0 }, false],
  ])('isBattleUnlocked(%j) = %s', (p, v) => {
    expect(isBattleUnlocked(p)).toBe(v);
  });
  it('isEnBattleUnlocked', () => {
    expect(isEnBattleUnlocked({ ko: 8, symbol: 2, en: 7 })).toBe(true);
    expect(isEnBattleUnlocked({ ko: 8, symbol: 2, en: 6 })).toBe(false);
  });
  it.each([
    [{ ko: 0, symbol: 0, en: 0 }, 'ko', 'K1'],
    [{ ko: 3, symbol: 0, en: 0 }, 'ko', 'K4'],
    [{ ko: 8, symbol: 0, en: 0 }, 'ko', null],
    [{ ko: 8, symbol: 1, en: 0 }, 'symbol', 'S2'],
    [{ ko: 8, symbol: 2, en: 0 }, 'symbol', null],
    [{ ko: 1, symbol: 0, en: 6 }, 'en', 'E7'],
  ] as const)('nextStageId(%j, %s) = %s', (p, track, id) => {
    expect(nextStageId(p, track)).toBe(id);
  });
  it.each([
    [{ ko: 0, symbol: 0, en: 0 }, 'K1', true],
    [{ ko: 0, symbol: 0, en: 0 }, 'K2', false],
    [{ ko: 3, symbol: 0, en: 0 }, 'K2', true],
    [{ ko: 7, symbol: 0, en: 0 }, 'S1', false],
    [{ ko: 8, symbol: 0, en: 0 }, 'S1', true],
    [{ ko: 0, symbol: 0, en: 0 }, 'E1', false],
    [{ ko: 1, symbol: 0, en: 0 }, 'E1', true],
    [{ ko: 1, symbol: 0, en: 0 }, 'E2', false],
    [{ ko: 1, symbol: 0, en: 0 }, 'ZZ', false],
  ])('isStageUnlocked(%j, %s) = %s', (p, id, v) => {
    expect(isStageUnlocked(p, id)).toBe(v);
  });
  it('isStagePassed', () => {
    expect(isStagePassed({ ko: 2, symbol: 0, en: 0 }, 'K2')).toBe(true);
    expect(isStagePassed({ ko: 2, symbol: 0, en: 0 }, 'K3')).toBe(false);
  });
  it.each([
    [50, 100, true],
    [45, 90, true],
    [44, 88, false],
    [0, 0, false],
  ])('testScore(%i) = %i, 통과 %s', (c, s, pass) => {
    expect(testScore(c)).toBe(s);
    expect(isTestPassed(s)).toBe(pass);
  });
});
