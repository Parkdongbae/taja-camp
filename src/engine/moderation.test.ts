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
