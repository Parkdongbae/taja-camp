// 데모 백엔드의 선생님 회원 가입 신청 → 승인 → 입장 흐름
import { describe, expect, it } from 'vitest';
import { createLocalBackend } from './localBackend';
import { memberIdOf } from '../engine/member';
import type { AuthUser } from './types';

function code(p: Promise<unknown>) {
  return p.then(
    () => 'OK',
    (e: { code?: string }) => e.code ?? 'ERR',
  );
}

function currentAuth(b: ReturnType<typeof createLocalBackend>): Promise<AuthUser | null> {
  return new Promise((res) => {
    const off = b.onAuth((u) => {
      off();
      res(u);
    });
  });
}

describe('localBackend 선생님 회원', () => {
  it('신청 → 승인 전 로그인 실패 → 승인 → 로그인 → 재신청 NAME_TAKEN', async () => {
    const b = createLocalBackend();
    const tid = memberIdOf('홍길동');

    await b.memberSignup(' 홍길동 ', '1234');
    expect(await code(b.memberSignup('홍길동', '5678'))).toBe('NAME_TAKEN');
    expect(await code(b.memberLogin('홍길동', '1234'))).toBe('LOGIN_FAILED');

    await b.teacherSignup('owner@school.kr', 'secret1'); // 첫 가입자 = 관리자
    expect(await b.listApplicants()).toEqual([expect.objectContaining({ id: tid, name: '홍길동' })]);
    await b.approveApplicant(tid);
    await b.approveApplicant(tid); // 두 번 해도 괜찮다
    expect(await b.listApplicants()).toEqual([]);
    const st = (await b.listStudents()).find((s) => s.id === tid);
    expect(st).toMatchObject({ name: '홍길동', teacher: true, grade: 0, classNo: 0, number: 0 });
    await b.logout();

    expect(await code(b.memberLogin('홍길동', '0000'))).toBe('LOGIN_FAILED');
    await b.memberLogin('홍길동', '1234');
    expect(await currentAuth(b)).toEqual({ role: 'student', studentId: tid });

    expect(await code(b.memberSignup('홍길동', '1111'))).toBe('NAME_TAKEN');
  });

  it('관리자가 아니면 승인할 수 없고, 학생은 스스로 teacher 를 켤 수 없다', async () => {
    const b = createLocalBackend();
    await b.memberSignup('김선생', '1234');
    expect(await code(b.approveApplicant(memberIdOf('김선생')))).toBe('PERMISSION');

    await b.studentFirstLogin('1101', '김민준', '1111');
    await b.updateStudent('1101', { teacher: true });
    expect((await b.listStudents()).find((s) => s.id === '1101')?.teacher).toBeUndefined();
  });
});
