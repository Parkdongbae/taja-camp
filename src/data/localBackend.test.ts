// 데모 백엔드: 선생님 회원 가입 신청 → 승인 → 입장 흐름, 학급 배틀 방·결과 저장
import { describe, expect, it } from 'vitest';
import { createLocalBackend } from './localBackend';
import { memberIdOf } from '../engine/member';
import type { AuthUser, BattleRoom, ClassBattleRecord } from './types';
import { CLASS_TIER } from '../engine/classBattle';

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

describe('localBackend 학급 배틀', () => {
  const p = (id: string, name: string) => ({ id, name, classNo: Number(id[1]), joinedAt: 0, online: true });

  it('같은 반은 같은 방, 다른 반·일반 방과는 섞이지 않는다', async () => {
    const b = createLocalBackend();
    const a1 = await b.joinOrCreateClassRoom('13', 'ko', p('1301', '가'), 420);
    const a2 = await b.joinOrCreateClassRoom('13', 'ko', p('1302', '나'), 999);
    const c1 = await b.joinOrCreateClassRoom('14', 'ko', p('1401', '다'), 300);
    const n1 = await b.joinOrCreateRoom(CLASS_TIER, 'ko', p('1303', '라'));
    expect(a2).toBe(a1);
    expect(c1).not.toBe(a1);
    expect(n1).not.toBe(a1);
    expect(n1).not.toBe(c1);

    const room = await new Promise<BattleRoom | null>((res) => {
      const off = b.watchRoom(a1, (r) => {
        queueMicrotask(() => off());
        res(r);
      });
    });
    expect(room).toMatchObject({ tier: CLASS_TIER, klass: '13', durationSec: 420, state: 'waiting' });
    expect(Object.keys(room?.players ?? {}).sort()).toEqual(['1301', '1302']);

    const lobby = await new Promise<BattleRoom[]>((res) => {
      const off = b.watchRooms(CLASS_TIER, 'ko', (rs) => {
        queueMicrotask(() => off());
        res(rs);
      });
    });
    expect(lobby.map((r) => r.id).sort()).toEqual([a1, c1, n1].sort());
    const normal = await new Promise<BattleRoom[]>((res) => {
      const off = b.watchRooms(0, 'ko', (rs) => {
        queueMicrotask(() => off());
        res(rs);
      });
    });
    expect(normal).toEqual([]);
  });

  it('학급 방은 방장이라도 경기 시간·방식을 바꿀 수 없다', async () => {
    const b = createLocalBackend();
    await b.studentFirstLogin('1101', '김민준', '1111');
    const id = await b.joinOrCreateClassRoom('11', 'ko', p('1101', '김민준'), 180);
    await b.setRoomDuration(id, 60);
    await b.setRoomMode(id, 'team');
    const room = await new Promise<BattleRoom | null>((res) => {
      const off = b.watchRoom(id, (r) => {
        queueMicrotask(() => off());
        res(r);
      });
    });
    expect(room).toMatchObject({ host: '1101', durationSec: 180, klass: '11' });
    expect(room?.mode).toBeUndefined();
  });

  it('학급 방 정원은 40명', async () => {
    const b = createLocalBackend();
    const ids = new Set<string>();
    for (let i = 1; i <= 41; i++) {
      ids.add(await b.joinOrCreateClassRoom('21', 'en', p(`21${String(i).padStart(2, '0')}`, `학생${i}`), 300));
    }
    expect(ids.size).toBe(2);
  });

  it('saveClassBattle 을 같은 id 로 두 번 저장하면 한 건', async () => {
    const b = createLocalBackend();
    await b.studentFirstLogin('1101', '김민준', '1111');
    const rec: ClassBattleRecord = {
      id: 'room-x',
      grade: 1,
      classNo: 1,
      date: '2026-11-24',
      at: 1000,
      lang: 'ko',
      durationSec: 300,
      total: 30,
      players: [{ id: '1101', name: '김민준', score: 30 }],
    };
    await b.saveClassBattle(rec);
    await b.saveClassBattle({ ...rec });
    await b.saveClassBattle({ ...rec, id: 'room-y', at: 2000, total: 5 });
    const list = await b.listClassBattles(10);
    expect(list.map((r) => r.id)).toEqual(['room-y', 'room-x']);
    expect(list[1]).toEqual(rec);
    expect(await b.listClassBattles(1)).toHaveLength(1);
  });
});
