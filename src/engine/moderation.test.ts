import { describe, expect, it } from 'vitest';
import { BAD_WORD_COUNT, findBadWord } from './badwords';
import { activeFreeze, samePhrase } from './freeze';

describe('findBadWord', () => {
  it('기본 목록이 있다', () => expect(BAD_WORD_COUNT).toBeGreaterThan(100));
  it('욕설을 잡는다(띄어쓰기·기호·늘여 쓰기 포함)', () => {
    expect(findBadWord('시 1 발')).not.toBeNull();
    expect(findBadWord('씨.발')).not.toBeNull();
    expect(findBadWord('fuuuck')).not.toBeNull();
  });
  it('정상인 말은 잡지 않는다', () => {
    for (const s of ['last night', '전염병', '시발점', '학교', '쉬는 시간', '강아지', 'middlesex', '선생님 멋있어요.']) expect(findBadWord(s)).toBeNull();
  });
  it('선생님이 추가한 낱말도 잡는다', () => {
    expect(findBadWord('너 바보야')).toBeNull();
    expect(findBadWord('너 바 보야', ['바보'])).toBe('바보');
  });
});

describe('멈추기', () => {
  it('문장 비교는 공백·끝 문장부호에 너그럽다', () => {
    expect(samePhrase('홍길동  선생님 멋있어요', '홍길동 선생님 멋있어요.')).toBe(true);
    expect(samePhrase('홍길동 선생님', '홍길동 선생님 멋있어요.')).toBe(false);
    expect(samePhrase('', '')).toBe(false);
    expect(samePhrase('아무 말', undefined)).toBe(false);
  });
  it('지금 걸린 멈추기를 찾는다', () => {
    const f = { a: { at: 1000, ms: 5000 }, b: { at: 3000, ms: 5000 } };
    expect(activeFreeze(f, 500)).toBeNull();
    expect(activeFreeze(f, 2000)).toEqual({ by: 'a', until: 6000 });
    expect(activeFreeze(f, 4000)).toEqual({ by: 'a', until: 6000 });
    expect(activeFreeze(f, 7000)).toEqual({ by: 'b', until: 8000 });
    expect(activeFreeze(f, 8000)).toBeNull();
    expect(activeFreeze(undefined, 1)).toBeNull();
  });
});

import { buildSchedule, fallMsAt, normalizeFallSpeed } from './battle';
describe('점수별 낙하 속도', () => {
  const pool = ['ㅁㄴㅇㄹ', '학교', '강아지', '쉬는 시간', '착한 친구', '신호등'];
  it('속도를 주지 않으면 예전과 같고, 주면 점수별로 낙하 시간이 달라진다', () => {
    const a = buildSchedule(7, pool, 4, 60);
    const b = buildSchedule(7, pool, 4, 60, { p1: 100, p2: 100, p4: 100 });
    expect(b).toEqual(a);
    const c = buildSchedule(7, pool, 4, 60, { p1: 100, p2: 125, p4: 200 });
    expect(c.length).toBeGreaterThan(10);
    for (const w of c) {
      const m = w.points === 4 ? 2 : w.points === 2 ? 1.25 : 1;
      expect(w.fallMs).toBe(Math.round((fallMsAt(w.spawnAt, 60000) / m / (w.fast ? 1.7 : 1)) * (w.coopMult === 2 ? 1.5 : w.coopMult === 4 ? 0.7 : 1)));
    }
  });
  it('값을 50~200 으로 정리한다', () => {
    expect(normalizeFallSpeed(undefined)).toEqual({ p1: 100, p2: 115, p4: 130 });
    expect(normalizeFallSpeed({ p1: 10, p2: 999, p4: 150 })).toEqual({ p1: 50, p2: 200, p4: 150 });
  });
});
