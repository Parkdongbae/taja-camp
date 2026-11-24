import { describe, expect, it } from 'vitest';
import { battleEvents } from './events';
import { newStudent, type BattleRoom, type SessionRecord, type Student } from '../data/types';
import {
  BADGES,
  TIERS,
  applyBattle,
  applySession,
  battlePoints,
  earnedBadges,
  levelOf,
  levelProgress,
  rankPlayers,
  teamScores,
  rpGain,
  tierName,
  tierOf,
  tierProgress,
  todayString,
  xpFor,
} from './scoring';

function stu(patch: Partial<Student> = {}): Student {
  return { ...newStudent('1315', '김민수'), createdAt: 0, ...patch };
}
function rec(patch: Partial<SessionRecord> = {}): SessionRecord {
  return {
    studentId: '1315',
    classNo: 3,
    mode: 'word',
    lang: 'ko',
    kpm: 150,
    accuracy: 92,
    typos: 3,
    strokes: 100,
    seconds: 60,
    missKeys: {},
    createdAt: 0,
    ...patch,
  };
}
const D = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h);

describe('battlePoints', () => {
  it.each([
    ['나라', 1],
    ['어머니', 1],
    ['이마', 1],
    ['광합성', 2],
    ['지구 온난화', 4],
    ['어머니 나라', 2],
    ['나라 이름', 4],
    ['apple', 2],
    ['global warming', 4],
    ['세포', 2],
  ])('%s → %i점', (t, p) => {
    expect(battlePoints(t)).toBe(p);
  });
});

describe('rpGain', () => {
  it.each([
    [16, 1, 5, 35],
    [16, 16, 3, 5],
    [2, 1, 1, 7],
    [2, 2, 1, 5],
    [16, 1, 0, 0],
    [8, 3, 10, 15],
    [4, 9, 2, 5],
  ])('인원 %i 순위 %i 점수 %i → %i', (n, p, s, rp) => {
    expect(rpGain(n, p, s)).toBe(rp);
  });
  it('연습 배틀은 절반', () => {
    expect(rpGain(4, 1, 3, true)).toBe(5);
  });
});

describe('계급', () => {
  it.each([
    [0, 0],
    [99, 0],
    [100, 1],
    [299, 1],
    [300, 2],
    [599, 2],
    [600, 3],
    [1000, 4],
    [1499, 4],
    [1500, 5],
    [99999, 5],
  ])('tierOf(%i) = %i', (rp, t) => {
    expect(tierOf(rp)).toBe(t);
  });
  it('TIERS 6개, 이름', () => {
    expect(TIERS.map((t) => t.name)).toEqual(['훈련병', '이등병', '일병', '상병', '병장', '예비역']);
    expect(tierName(2)).toBe('일병');
  });
  it('tierProgress', () => {
    expect(tierProgress(50)).toEqual({ tier: 0, name: '훈련병', cur: 50, base: 0, next: 100, ratio: 0.5 });
    expect(tierProgress(200).ratio).toBe(0.5);
    expect(tierProgress(1500)).toMatchObject({ tier: 5, next: null, ratio: 1 });
  });
});

describe('rankPlayers', () => {
  const room = (claims: BattleRoom['claims'], ids = ['a', 'b', 'c']): BattleRoom => ({
    id: 'r',
    tier: 0,
    lang: 'ko',
    host: 'a',
    state: 'done',
    seed: 1,
    startAt: 0,
    durationSec: 120,
    startCount: ids.length,
    createdAt: 0,
    players: Object.fromEntries(ids.map((id) => [id, { id, name: id.toUpperCase(), classNo: 1, joinedAt: 0, online: true }])),
    claims,
  });
  const words = [
    { index: 0, points: 1 },
    { index: 1, points: 2 },
    { index: 2, points: 4 },
    { index: 3, points: 2 },
    { index: 4, points: 1 },
    { index: 5, points: 1 },
  ];
  it('점수 합산과 순위', () => {
    const r = rankPlayers(room({ '0': { by: 'b', at: 10 }, '2': { by: 'a', at: 20 }, '1': { by: 'b', at: 30 } }), words);
    expect(r.map((x) => [x.id, x.score, x.words, x.place])).toEqual([
      ['a', 4, 1, 1],
      ['b', 3, 2, 2],
      ['c', 0, 0, 3],
    ]);
    expect(r[0].name).toBe('A');
  });
  it('동점이면 획득 낱말 수가 많은 쪽', () => {
    const r = rankPlayers(room({ '1': { by: 'a', at: 5 }, '4': { by: 'b', at: 10 }, '5': { by: 'b', at: 20 } }), words);
    expect(r[0].id).toBe('b');
    expect(r[1].id).toBe('a');
  });
  it('그것도 같으면 마지막 득점이 빠른 쪽', () => {
    const r = rankPlayers(room({ '1': { by: 'a', at: 50 }, '3': { by: 'b', at: 40 } }), words);
    expect(r.map((x) => x.id)).toEqual(['b', 'a', 'c']);
    expect(r[1].place).toBe(2);
  });
  it('보너스가 붙은 낱말은 score 로 센다', () => {
    const r = rankPlayers(room({ '0': { by: 'a', at: 10 } }), [{ index: 0, points: 2, score: 5 }]);
    expect(r[0]).toMatchObject({ id: 'a', score: 5, words: 1 });
  });
  it('파워: 그 시점 다른 사람 점수의 절반(올림)을 가져온다', () => {
    const P = 1_000_000;
    const r = rankPlayers(
      room({
        '2': { by: 'a', at: 10 }, // a 4
        '1': { by: 'b', at: 20 }, // b 2
        '0': { by: 'b', at: 25 }, // b 3
        [String(P)]: { by: 'c', at: 30 }, // c: a 에게서 2, b 에게서 2
        '3': { by: 'a', at: 40 }, // a 2 + 2 = 4 (회수 뒤에 얻은 점수는 그대로)
      }),
      words,
    );
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(by.c).toMatchObject({ score: 4, stolen: 4, lost: 0, words: 0 });
    expect(by.a).toMatchObject({ score: 4, lost: 2, words: 2 });
    expect(by.b).toMatchObject({ score: 1, lost: 2, words: 2 });
    expect(r.reduce((n, x) => n + x.score, 0)).toBe(9); // 전체 합은 그대로
  });
  it('협동 낱말: 모두 치면 모두 배수 점수, 아니면 친 사람만 기본 점수', () => {
    const C = 10_000_000;
    const cw = [{ index: 0, points: 2, coop: true, coopMult: 3 }, { index: 1, points: 1 }];
    // 실패: a, b 만 침
    let r = rankPlayers(room({ [String(C)]: { by: 'a', at: 10 }, [String(C + 1)]: { by: 'b', at: 20 } }), cw);
    let by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect([by.a.score, by.b.score, by.c.score]).toEqual([2, 2, 0]);
    expect(by.a.coop).toBe(0);
    // 성공: 셋 다 침 → 2 × 3
    r = rankPlayers(room({ [String(C)]: { by: 'a', at: 10 }, [String(C + 1)]: { by: 'b', at: 20 }, [String(C + 2)]: { by: 'c', at: 30 }, '1': { by: 'a', at: 5 } }), cw);
    by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect([by.a.score, by.b.score, by.c.score]).toEqual([7, 6, 6]);
    expect([by.a.coop, by.a.words, by.b.lastAt]).toEqual([1, 2, 30]);
    // 접속이 끊긴 사람은 빼고 판단
    const rm = room({ [String(C)]: { by: 'a', at: 10 }, [String(C + 1)]: { by: 'b', at: 20 } });
    rm.players.c.online = false;
    expect(rankPlayers(rm, cw).map((x) => x.score)).toEqual([6, 6, 0]);
    // 협동 낱말을 선점 칸에 적어도 점수 없음
    expect(rankPlayers(room({ '0': { by: 'a', at: 1 } }), cw)[0].score).toBe(0);
  });
  it('피버 동안 얻은 점수는 2배', () => {
    const ev = battleEvents(1, 120);
    const t = ev.fever!.start + 100;
    const r = rankPlayers(room({ '1': { by: 'a', at: t }, '0': { by: 'b', at: 10 } }), words);
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect([by.a.score, by.a.fever, by.b.score, by.b.fever]).toEqual([4, 2, 1, 0]);
  });
  it('팀전: 팀 번호·팀 점수, 파워는 상대 팀에게서만', () => {
    const rm = room({ '2': { by: 'a', at: 10 }, '1': { by: 'b', at: 20 }, '3': { by: 'c', at: 25 }, '1000000': { by: 'a', at: 30 } });
    rm.players.a.joinedAt = 1;
    rm.players.b.joinedAt = 2;
    rm.players.c.joinedAt = 3;
    rm.mode = 'team';
    const r = rankPlayers(rm, words);
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect([by.a.team, by.b.team, by.c.team]).toEqual([0, 1, 0]);
    expect([by.a.score, by.b.score, by.c.score]).toEqual([5, 1, 2]); // 같은 팀 c 는 그대로
    expect(teamScores(r)).toEqual([7, 1]);
    expect(rankPlayers(room({}), words)[0].team).toBe(-1);
  });
  it('0점끼리는 같은 순위', () => {
    const r = rankPlayers(room({}), words);
    expect(r.map((x) => x.place)).toEqual([1, 1, 1]);
  });
  it('명단에 없는 득점자도 포함, 일정에 없는 낱말은 무시', () => {
    const r = rankPlayers(room({ '0': { by: 'z', at: 1 }, '99': { by: 'a', at: 2 } }), words);
    expect(r[0]).toMatchObject({ id: 'z', score: 1, name: 'z' });
    expect(r.find((x) => x.id === 'a')!.score).toBe(0);
  });
});

describe('XP·레벨·날짜', () => {
  it.each([
    ['word', 92, false, 10],
    ['word', 95, false, 15],
    ['sentence', 100, false, 20],
    ['passage', 100, true, 30],
    ['position', 80, true, 20],
    ['battle', 100, true, 15],
  ] as const)('xpFor(%s, %i, %s) = %i', (mode, accuracy, isBest, xp) => {
    expect(xpFor({ mode, accuracy, isBest })).toBe(xp);
  });
  it.each([
    [0, 1],
    [99, 1],
    [100, 2],
    [250, 3],
  ])('levelOf(%i) = %i', (xp, lv) => {
    expect(levelOf(xp)).toBe(lv);
  });
  it('levelProgress', () => {
    expect(levelProgress(250)).toEqual({ level: 3, cur: 50, need: 100, ratio: 0.5 });
  });
  it('todayString 은 로컬 날짜', () => {
    expect(todayString(D(2026, 3, 5))).toBe('2026-03-05');
    expect(todayString(D(2026, 12, 31, 23))).toBe('2026-12-31');
  });
});

describe('applySession', () => {
  it('첫 연습: 일수·연속·시간·XP', () => {
    const p = applySession(stu(), rec({ seconds: 61.4 }), D(2026, 3, 5));
    expect(p).toMatchObject({ totalSeconds: 61, todaySeconds: 61, lastDay: '2026-03-05', days: 1, streak: 1 });
    expect(p.bestKo).toBe(150);
    expect(p.xp).toBe(20); // 10 + 기록 갱신 10
  });
  it('같은 날 두 번째: 일수·연속은 그대로, 오늘 시간 누적', () => {
    const s = stu({ lastDay: '2026-03-05', todaySeconds: 100, days: 4, streak: 2, totalSeconds: 1000, bestKo: 300 });
    const p = applySession(s, rec(), D(2026, 3, 5, 15));
    expect(p.todaySeconds).toBe(160);
    expect(p.totalSeconds).toBe(1060);
    expect(p.days).toBeUndefined();
    expect(p.streak).toBeUndefined();
    expect(p.bestKo).toBeUndefined();
  });
  it('일주일 뒤 수업: 연속 유지', () => {
    const s = stu({ lastDay: '2026-03-05', todaySeconds: 100, days: 4, streak: 2 });
    const p = applySession(s, rec(), D(2026, 3, 12));
    expect(p).toMatchObject({ days: 5, streak: 3, todaySeconds: 60 });
  });
  it('한참 쉬면 연속 1로', () => {
    const s = stu({ lastDay: '2026-03-05', days: 4, streak: 6 });
    expect(applySession(s, rec(), D(2026, 4, 20)).streak).toBe(1);
  });
  it('정확도 90% 미만은 최고 기록 아님', () => {
    expect(applySession(stu(), rec({ accuracy: 89.9 }), D(2026, 3, 5)).bestKo).toBeUndefined();
  });
  it('자리연습은 최고 타수에 반영 안 함', () => {
    expect(applySession(stu(), rec({ mode: 'position' }), D(2026, 3, 5)).bestKo).toBeUndefined();
  });
  it('1500 초과는 반영 안 함', () => {
    expect(applySession(stu(), rec({ kpm: 1600 }), D(2026, 3, 5)).bestKo).toBeUndefined();
  });
  it('영문 최고 타수', () => {
    const p = applySession(stu(), rec({ lang: 'en', kpm: 210 }), D(2026, 3, 5));
    expect(p.bestEn).toBe(210);
    expect(p.bestKo).toBeUndefined();
  });
  it('하루 목표 달성 +30 XP (한 번만)', () => {
    const s = stu({ lastDay: '2026-03-05', todaySeconds: 550, bestKo: 999 });
    expect(applySession(s, rec({ seconds: 60 }), D(2026, 3, 5)).xp).toBe(40);
    const s2 = stu({ lastDay: '2026-03-05', todaySeconds: 700, bestKo: 999 });
    expect(applySession(s2, rec({ seconds: 60 }), D(2026, 3, 5)).xp).toBe(10);
  });
  it('goalMinutes 설정', () => {
    const p = applySession(stu({ bestKo: 999 }), rec({ seconds: 300 }), D(2026, 3, 5), 5);
    expect(p.xp).toBe(40);
  });
  it('weakKeys 병합', () => {
    const s = stu({ weakKeys: { KeyA: 2 } });
    const p = applySession(s, rec({ missKeys: { KeyA: 1, KeyS: 3 } }), D(2026, 3, 5));
    expect(p.weakKeys).toEqual({ KeyA: 3, KeyS: 3 });
  });
  it('승급 테스트 통과: 최고점·단계 진행', () => {
    const s = stu({ position: { ko: 1, symbol: 0, en: 0 } });
    const p = applySession(s, rec({ mode: 'positionTest', stageId: 'K2', score: 94, passed: true }), D(2026, 3, 5));
    expect(p.stageBest).toEqual({ K2: 94 });
    expect(p.position).toEqual({ ko: 2, symbol: 0, en: 0 });
  });
  it('이미 통과한 단계 재응시는 진행을 바꾸지 않고 최고점만', () => {
    const s = stu({ position: { ko: 3, symbol: 0, en: 0 }, stageBest: { K2: 92 } });
    const p = applySession(s, rec({ mode: 'positionTest', stageId: 'K2', score: 98, passed: true }), D(2026, 3, 5));
    expect(p.position).toBeUndefined();
    expect(p.stageBest).toEqual({ K2: 98 });
  });
  it('불합격은 진행 없음', () => {
    const p = applySession(stu(), rec({ mode: 'positionTest', stageId: 'K1', score: 80, passed: false }), D(2026, 3, 5));
    expect(p.position).toBeUndefined();
    expect(p.stageBest).toEqual({ K1: 80 });
  });
  it('새 배지 추가', () => {
    const p = applySession(stu({ badges: ['streak-3'] }), rec({ mode: 'sentence', accuracy: 100 }), D(2026, 3, 5));
    expect(p.badges).toEqual(['streak-3', 'flawless', 'speed-100']);
  });
  it('0초·0타 기록은 일수를 늘리지 않는다', () => {
    const p = applySession(stu({ lastDay: '2026-03-04', todaySeconds: 30 }), rec({ seconds: 0, strokes: 0 }), D(2026, 3, 5));
    expect(p.days).toBeUndefined();
    expect(p.lastDay).toBeUndefined();
  });
});

describe('applyBattle / earnedBadges', () => {
  it('1등: rp·games·wins·첫 승리 배지', () => {
    const p = applyBattle(stu({ rp: 90 }), { playerCount: 4, place: 1, score: 6 });
    expect(p).toMatchObject({ rp: 101, games: 1, wins: 1, badges: ['first-win'] });
  });
  it('practice(컴퓨터 대결): rp 절반, games·wins 는 그대로', () => {
    const p = applyBattle(stu({ rp: 90, games: 3, wins: 1 }), { playerCount: 4, place: 1, score: 6, practice: true });
    expect(p.rp).toBe(90 + Math.floor(11 / 2));
    expect(p.games).toBeUndefined();
    expect(p.wins).toBeUndefined();
  });
  it('0점은 rp 없음, 승리 아님', () => {
    const p = applyBattle(stu(), { playerCount: 4, place: 1, score: 0 });
    expect(p.rp).toBe(0);
    expect(p.wins).toBeUndefined();
  });
  it('earnedBadges', () => {
    const s = stu({
      position: { ko: 8, symbol: 2, en: 7 },
      stageBest: { K1: 100 },
      bestKo: 320,
      streak: 10,
      wins: 10,
    });
    expect(earnedBadges(s).sort()).toEqual(
      ['home-100', 'bootcamp', 'speed-100', 'speed-200', 'speed-300', 'streak-3', 'streak-5', 'streak-10', 'first-win', 'win-10', 'bilingual'].sort(),
    );
  });
  it('새 학생은 배지 없음', () => {
    expect(earnedBadges(stu())).toEqual([]);
  });
  it('BADGES id 중복 없음, auto 판정 id 는 모두 BADGES 에 있다', () => {
    const ids = BADGES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    const s = stu({ position: { ko: 8, symbol: 2, en: 7 }, stageBest: { K1: 100 }, bestKo: 999, streak: 99, wins: 99 });
    for (const id of earnedBadges(s, rec({ mode: 'sentence', accuracy: 100 }))) expect(ids).toContain(id);
  });
});
