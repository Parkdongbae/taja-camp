import { describe, expect, it } from 'vitest';
import type { BattleRoom, ClassBattleRecord } from '../data/types';
import { classBattleRecord, classStandings, dateLabel, klassOf, latestOfClass, normalizeClassDuration, parseKlass } from './classBattle';

const room = (klass?: string): BattleRoom => ({
  id: 'r1',
  tier: 9,
  lang: 'ko',
  host: '1301',
  state: 'done',
  seed: 1,
  startAt: new Date(2026, 10, 24, 10, 0, 0).getTime(),
  durationSec: 300,
  startCount: 3,
  createdAt: 0,
  players: {},
  claims: {},
  klass,
});
const rec = (id: string, grade: number, classNo: number, total: number, at: number): ClassBattleRecord => ({
  id,
  grade,
  classNo,
  date: '2026-11-24',
  at,
  lang: 'ko',
  durationSec: 300,
  total,
  players: [],
});

describe('학급 배틀', () => {
  it('반 표기', () => {
    expect(klassOf(1, 3)).toBe('13');
    expect(parseKlass('13')).toEqual({ grade: 1, classNo: 3 });
    expect(parseKlass('112')).toEqual({ grade: 1, classNo: 12 });
    expect(parseKlass(undefined)).toBeNull();
    expect(parseKlass('00')).toBeNull();
  });
  it('경기 시간 기본 5분', () => {
    expect(normalizeClassDuration(undefined)).toBe(300);
    expect(normalizeClassDuration(600)).toBe(600);
    expect(normalizeClassDuration(77)).toBe(300);
  });
  it('결과: 총점은 합, 누가 만들어도 같은 내용', () => {
    const a = classBattleRecord(room('13'), [{ id: '1302', name: '나', score: 5 }, { id: '1301', name: '가', score: 12 }], 1);
    const b = classBattleRecord(room('13'), [{ id: '1301', name: '가', score: 12 }, { id: '1302', name: '나', score: 5 }], 999);
    expect(a).toEqual(b);
    expect(a?.total).toBe(17);
    expect(a?.date).toBe('2026-11-24');
    expect(a?.players[0].id).toBe('1301');
    expect(classBattleRecord(room(), [], 1)).toBeNull();
  });
  it('반별 최고 총점 순위와 최근 결과', () => {
    const list = [rec('a', 1, 1, 100, 1), rec('b', 1, 2, 300, 2), rec('c', 1, 1, 250, 3), rec('d', 1, 3, 300, 4)];
    const s = classStandings(list);
    expect(s.map((x) => [x.classNo, x.best, x.place])).toEqual([
      [2, 300, 1],
      [3, 300, 1],
      [1, 250, 3],
    ]);
    expect(s[2].games).toBe(2);
    expect(latestOfClass(list, 1, 1)?.id).toBe('c');
    expect(latestOfClass(list, 2, 1)).toBeNull();
  });
  it('날짜 표시', () => {
    expect(dateLabel('2026-11-04')).toBe('11월 4일');
  });
});
