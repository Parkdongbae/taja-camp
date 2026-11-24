import { describe, expect, it } from 'vitest';
import { battleAwards } from './awards';
import { COOP_INDEX_BASE, POWER_INDEX_BASE, type FallingWord } from './battle';
import type { BattleRoom } from '../data/types';

const w = (index: number, patch: Partial<FallingWord> = {}): FallingWord => ({
  index,
  text: `낱말${index}`,
  points: 2,
  spawnAt: 0,
  fallMs: 10000,
  x: 0.5,
  dir: 'down',
  fast: false,
  blink: false,
  zigzag: false,
  golden: false,
  bonus: 0,
  score: 2,
  coop: false,
  coopMult: 0,
  comeback: false,
  riddle: false,
  ...patch,
});

const room = (claims: BattleRoom['claims']): BattleRoom => ({
  id: 'r',
  tier: 0,
  lang: 'ko',
  host: 'a',
  state: 'done',
  seed: 1,
  startAt: 0,
  durationSec: 120,
  startCount: 3,
  createdAt: 0,
  players: Object.fromEntries(['a', 'b', 'c'].map((id) => [id, { id, name: id.toUpperCase(), classNo: 1, joinedAt: 0, online: true }])),
  claims,
});

describe('battleAwards', () => {
  const sched = [
    w(0),
    w(1, { fast: true, bonus: 1, score: 3 }),
    w(2, { riddle: true, bonus: 2, score: 4 }),
    w(3, { comeback: true, bonus: 4, score: 6 }),
    w(4, { coop: true, coopMult: 2 }),
    w(5),
    w(6),
  ];
  it('기준별로 한 명씩, 값이 없으면 칭호도 없다', () => {
    const a = battleAwards(
      room({
        '0': { by: 'a', at: 100 },
        '1': { by: 'a', at: 200 },
        '5': { by: 'a', at: 300 },
        '2': { by: 'b', at: 400 },
        '3': { by: 'c', at: 110000 },
        [String(COOP_INDEX_BASE + 400)]: { by: 'b', at: 500 },
        [String(COOP_INDEX_BASE + 401)]: { by: 'b', at: 600 }, // 같은 사람 두 번은 한 번
        [String(POWER_INDEX_BASE)]: { by: 'c', at: 115000 },
      }),
      sched,
    );
    const by = Object.fromEntries(a.map((x) => [x.id, x]));
    expect(by.rapid).toMatchObject({ winner: 'a', value: 3, name: 'A' });
    expect(by.bigshot).toMatchObject({ winner: 'c', value: 6 });
    expect(by.first).toMatchObject({ winner: 'a' });
    expect(by.sprint).toMatchObject({ winner: 'c', value: 6 });
    expect(by.hunter).toMatchObject({ winner: 'a', value: 1 });
    expect(by.coop).toMatchObject({ winner: 'b', value: 1 });
    expect(by.riddle).toMatchObject({ winner: 'b', value: 1 });
    expect(by.comeback).toMatchObject({ winner: 'c', value: 1 });
    expect(by.power.winner).toBe('c');
    expect(by.power.value).toBeGreaterThan(0);
    expect(by.fever).toBeUndefined();
  });
  it('아무도 득점하지 않으면 칭호 없음', () => {
    expect(battleAwards(room({}), sched)).toEqual([]);
  });
});
