// 학생이름 외우기 순수 로직 테스트(가짜 이름)
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../engine/rng';
import type { RosterFile, RosterStudent } from './types';
import {
  blameCard,
  canAutoMatch,
  chooseLane,
  createDeck,
  drawNext,
  findMatch,
  isFinished,
  maskName,
  markSolved,
  pickStudents,
  pointsFor,
  requeueMissed,
  rosterClassKeys,
  sameName,
  studentKey,
  LANE_COUNT,
  REINSERT_GAP,
} from './game';

const photo = new Blob(['x'], { type: 'image/jpeg' });
const st = (grade: number, classNo: number, number: number, name: string, hasPhoto = true): RosterStudent => ({
  grade,
  classNo,
  number,
  name,
  photo: hasPhoto ? photo : null,
});
const roster = (id: string, classNo: number | null, students: RosterStudent[]): RosterFile => ({
  id,
  fileName: `${id}.xlsx`,
  addedAt: 0,
  title: id,
  year: 2026,
  grade: 1,
  classNo,
  students,
});

const r1 = roster('a', 1, [st(1, 1, 1, '가나다'), st(1, 1, 2, '라마바', false), st(1, 1, 3, '사아자')]);
const r2 = roster('b', 2, [st(1, 2, 1, '차카타')]);
const whole = roster('w', null, [st(1, 1, 1, '가나다'), st(1, 1, 3, '사아자'), st(1, 2, 1, '차카타'), st(1, 3, 5, '파하')]);

describe('pickStudents', () => {
  it('사진 있는 학생만', () => {
    expect(pickStudents([r1], { rosterIds: ['a'] }).map((s) => s.name)).toEqual(['가나다', '사아자']);
  });
  it('반별·학년 파일이 겹치면 한 번만', () => {
    const got = pickStudents([r1, r2, whole], { rosterIds: ['a', 'b', 'w'] });
    expect(got.map((s) => s.name)).toEqual(['가나다', '사아자', '차카타', '파하']);
  });
  it('체크하지 않은 명렬표는 빠진다', () => {
    expect(pickStudents([r1, r2], { rosterIds: ['b'] }).map((s) => s.name)).toEqual(['차카타']);
  });
  it('반 좁히기, 빈 목록이면 전체', () => {
    expect(pickStudents([whole], { rosterIds: ['w'], classKeys: ['1-3'] }).map((s) => s.name)).toEqual(['파하']);
    expect(pickStudents([whole], { rosterIds: ['w'], classKeys: [] })).toHaveLength(4);
  });
  it('반 칩 목록', () => {
    expect(rosterClassKeys([r1, whole], ['a', 'w'])).toEqual([
      { key: '1-1', grade: 1, classNo: 1, count: 2 },
      { key: '1-2', grade: 1, classNo: 2, count: 1 },
      { key: '1-3', grade: 1, classNo: 3, count: 1 },
    ]);
  });
});

describe('이름', () => {
  it('maskName', () => {
    expect(maskName('홍길동', 'show')).toBe('홍길동');
    expect(maskName('홍길동', 'surname')).toBe('홍○○');
    expect(maskName('남궁 하늘', 'surname')).toBe('남○○○');
    expect(maskName('홍길동', 'hide')).toBe('');
  });
  it('sameName: 공백 무시, NFC', () => {
    expect(sameName('홍 길동', '홍길동')).toBe(true);
    expect(sameName('홍길동'.normalize('NFD'), '홍길동')).toBe(true);
    expect(sameName('홍길동', '홍길')).toBe(false);
    expect(sameName('', '')).toBe(false);
  });
  it('studentKey 는 이름 공백 무시', () => {
    expect(studentKey(st(1, 1, 1, '홍 길동'))).toBe(studentKey(st(1, 1, 1, '홍길동')));
  });
});

describe('출제 순서', () => {
  it('섞기는 시드로 재현', () => {
    const keys = ['a', 'b', 'c', 'd', 'e'];
    expect(createDeck(keys, mulberry32(7)).queue).toEqual(createDeck(keys, mulberry32(7)).queue);
    expect([...createDeck(keys, mulberry32(7)).queue].sort()).toEqual(keys);
  });
  it('화면에 떠 있는 학생은 건너뛰고, 모두 맞추면 끝', () => {
    let d = createDeck(['a', 'b', 'c'], mulberry32(1));
    d = { ...d, queue: ['a', 'b', 'c'] };
    const r = drawNext(d, ['a']);
    expect(r.key).toBe('b');
    expect(r.deck.queue).toEqual(['a', 'c']);
    d = r.deck;
    for (const k of ['a', 'b', 'c']) d = markSolved(d, k);
    expect(isFinished(d)).toBe(true);
    expect(drawNext(d).key).toBeNull();
  });
  it('놓친 학생은 최소 2장 뒤에 다시', () => {
    const d: ReturnType<typeof createDeck> = { queue: ['b', 'c', 'd'], total: 4, solved: [], last: 'a' };
    const q = requeueMissed(d, 'a').queue;
    expect(q.indexOf('a')).toBe(REINSERT_GAP);
    // 남은 카드가 적으면 맨 뒤
    expect(requeueMissed({ ...d, queue: ['b'] }, 'a').queue).toEqual(['b', 'a']);
    expect(isFinished(d)).toBe(false);
  });
  it('직전 학생은 다른 후보가 있으면 피한다', () => {
    const d = { queue: ['a', 'b'], total: 2, solved: [], last: 'a' };
    expect(drawNext(d).key).toBe('b');
    expect(drawNext({ ...d, queue: ['a'] }).key).toBe('a');
  });
  it('놓친 학생이 맞출 때까지 반복되고 결국 끝난다', () => {
    let d = createDeck(['a', 'b', 'c'], mulberry32(3));
    let misses = 0;
    for (let step = 0; step < 50 && !isFinished(d); step++) {
      const r = drawNext(d);
      d = r.deck;
      if (!r.key) break;
      if (r.key === 'a' && misses < 2) {
        misses++;
        d = requeueMissed(d, r.key);
      } else d = markSolved(d, r.key);
    }
    expect(misses).toBe(2);
    expect(isFinished(d)).toBe(true);
  });
});

describe('배치·판정', () => {
  it('chooseLane: 빈 칸만, 직전 칸 피하기, 다 차면 null', () => {
    const rand = mulberry32(5);
    for (let i = 0; i < 20; i++) {
      const l = chooseLane([0, 2], rand, 1)!;
      expect([3, 4]).toContain(l);
    }
    expect(chooseLane([0, 1, 2, 3], rand, 4)).toBe(4);
    expect(chooseLane([...Array(LANE_COUNT).keys()], rand)).toBeNull();
  });
  it('findMatch: 동명이인은 더 아래 카드부터', () => {
    const cards = [
      { id: 1, name: '김하늘', progress: 0.3 },
      { id: 2, name: '김하늘', progress: 0.7 },
      { id: 3, name: '이바다', progress: 0.9 },
    ];
    expect(findMatch(cards, '김 하늘')).toBe(2);
    expect(findMatch(cards, '김하')).toBeNull();
  });
  it('canAutoMatch: 조합 중이면 더 긴 이름으로 이어질 수 있을 때 기다린다', () => {
    expect(canAutoMatch('이민', false, ['이민', '이미노'])).toBe(true);
    expect(canAutoMatch('이민', true, ['이민', '이미노'])).toBe(false);
    expect(canAutoMatch('이민', true, ['이민', '박하늘'])).toBe(true);
    expect(canAutoMatch('이미', true, ['이민'])).toBe(false);
  });
  it('blameCard: 자모가 가장 많이 겹치는 카드, 없으면 아래쪽', () => {
    const cards = [
      { id: 1, name: '김하늘', progress: 0.2 },
      { id: 2, name: '이바다', progress: 0.8 },
    ];
    expect(blameCard(cards, '김하눌')).toBe(1);
    expect(blameCard(cards, '최')).toBe(2);
    expect(blameCard([], '최')).toBeNull();
  });
  it('pointsFor', () => {
    expect(pointsFor(1)).toBe(10);
    expect(pointsFor(5)).toBe(14);
    expect(pointsFor(99)).toBe(20);
  });
});
