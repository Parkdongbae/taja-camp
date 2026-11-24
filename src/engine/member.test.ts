import { describe, expect, it } from 'vitest';
import { isMemberId, memberIdOf, normalizeMemberName } from './member';

describe('선생님 회원 id', () => {
  it('같은 성함은 같은 id, 형식은 t + 16진수 9자', () => {
    expect(memberIdOf('김선생')).toBe(memberIdOf('  김선생 '));
    expect(memberIdOf('김선생')).toMatch(/^t[0-9a-f]{9}$/);
    expect(memberIdOf('김선생')).not.toBe(memberIdOf('이선생'));
  });
  it('학번과 구분된다', () => {
    expect(isMemberId(memberIdOf('박선생'))).toBe(true);
    expect(isMemberId('1315')).toBe(false);
    expect(isMemberId('t123')).toBe(false);
  });
  it('공백 정리', () => {
    expect(normalizeMemberName(' 남궁  민수 ')).toBe('남궁 민수');
  });
});
