// 연습 1회를 마쳤을 때 기록을 저장하고 내 학생 문서에 반영한다. 모든 연습 화면이 이 함수만 쓴다.
//   finishSession(rec, extra?) → { isBest, xpGain, newBadges, goalJustDone, promoted, prevBest }
//   finishBattle(result)       → { rpGain, tierBefore, tierAfter, xpGain, newBadges, solo? }
//     practice(컴퓨터 대결)면 RP 절반, 실제 전적(games·wins) 제외, solo(수준·전적) 갱신
import { backend } from '../data';
import type { SessionRecord, Student } from '../data/types';
import { applyBattle, applySession, rpGain, tierOf, todayString } from '../engine/scoring';
import { applySolo } from '../engine/bots';
import { useAuth } from './auth';

export type SessionInput = Omit<SessionRecord, 'id' | 'studentId' | 'classNo' | 'createdAt'>;

export interface FinishResult {
  isBest: boolean; // 최고 타수 갱신(정확도 90% 이상 기록)
  prevBest: number; // 갱신 전 최고 타수(해당 언어)
  xpGain: number;
  newBadges: string[];
  goalJustDone: boolean; // 이번 연습으로 오늘의 훈련 목표를 채움
  promoted: boolean; // 자리 단계가 올라감
}

function clean<T extends object>(o: T): T {
  // Firestore 는 undefined 를 허용하지 않는다
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export async function finishSession(input: SessionInput, extra?: { quizPoints?: number }): Promise<FinishResult> {
  const { student, settings } = useAuth.getState();
  if (!student) throw new Error('로그인이 필요합니다.');
  const now = new Date();
  const rec: SessionRecord = clean({
    ...input,
    kpm: Math.max(0, Math.min(1500, Math.round(input.kpm))),
    accuracy: Math.max(0, Math.min(100, Math.round(input.accuracy * 10) / 10)),
    seconds: Math.round(input.seconds),
    studentId: student.id,
    classNo: student.classNo,
    createdAt: now.getTime(),
  });

  const patch: Partial<Student> = applySession(student, rec, now, settings.dailyGoalMinutes);
  if (extra?.quizPoints) patch.quizPoints = (student.quizPoints ?? 0) + extra.quizPoints;

  const goalSec = settings.dailyGoalMinutes * 60;
  const beforeToday = student.lastDay === todayString(now) ? student.todaySeconds : 0;
  const afterToday = patch.todaySeconds ?? beforeToday;
  const prevBest = rec.lang === 'ko' ? student.bestKo : student.bestEn;
  const newBest = rec.lang === 'ko' ? (patch.bestKo ?? prevBest) : (patch.bestEn ?? prevBest);
  const posBefore = student.position.ko + student.position.symbol + student.position.en;
  const posAfter = patch.position ? patch.position.ko + patch.position.symbol + patch.position.en : posBefore;

  const result: FinishResult = {
    isBest: newBest > prevBest,
    prevBest,
    xpGain: (patch.xp ?? student.xp) - student.xp,
    newBadges: (patch.badges ?? []).filter((b) => !student.badges.includes(b)),
    goalJustDone: beforeToday < goalSec && afterToday >= goalSec,
    promoted: posAfter > posBefore,
  };

  // 저장 실패가 화면을 막지 않게 한다(결과 창은 그대로 보여 준다)
  try {
    await Promise.all([backend.addSession(rec), backend.updateStudent(student.id, clean(patch))]);
  } catch (e) {
    console.error('기록 저장 실패', e);
  }
  return result;
}

export interface BattleFinish {
  rpGain: number;
  tierBefore: number;
  tierAfter: number;
  xpGain: number;
  newBadges: string[];
  /** 컴퓨터 대결(practice)일 때: 반영 전·후 컴퓨터 수준 기록 */
  solo?: { before: { level: number; wins: number; games: number }; after: { level: number; wins: number; games: number } };
}

/** 배틀 1회 결과를 내 문서에 반영한다(RP·승수·경험치). */
export async function finishBattle(r: {
  playerCount: number;
  place: number;
  score: number;
  words: number;
  seconds: number;
  lang: 'ko' | 'en';
  practice?: boolean;
}): Promise<BattleFinish> {
  const { student, settings } = useAuth.getState();
  if (!student) throw new Error('로그인이 필요합니다.');
  const now = new Date();
  const rec: SessionRecord = {
    studentId: student.id,
    classNo: student.classNo,
    mode: 'battle',
    lang: r.lang,
    kpm: 0,
    accuracy: 100,
    typos: 0,
    strokes: 0,
    seconds: Math.round(r.seconds),
    score: r.score,
    missKeys: {},
    createdAt: now.getTime(),
  };
  const p1 = applySession(student, rec, now, settings.dailyGoalMinutes);
  const mid: Student = { ...student, ...p1 };
  const p2 = applyBattle(mid, r);
  const patch: Partial<Student> = { ...p1, ...p2 };
  // 컴퓨터 대결: 다음 판 수준(solo.level)·전적을 같은 쓰기에 넣는다
  const soloBefore = { level: student.solo?.level ?? 0, wins: student.solo?.wins ?? 0, games: student.solo?.games ?? 0 };
  if (r.practice) patch.solo = applySolo(student.solo, r.place);
  const gain = rpGain(r.playerCount, r.place, r.score, r.practice);
  const after: Student = { ...student, ...patch };
  try {
    await Promise.all([backend.addSession(rec), backend.updateStudent(student.id, clean(patch))]);
  } catch (e) {
    console.error('배틀 결과 저장 실패', e);
  }
  return {
    rpGain: gain,
    tierBefore: tierOf(student.rp),
    tierAfter: tierOf(after.rp),
    xpGain: after.xp - student.xp,
    newBadges: after.badges.filter((b) => !student.badges.includes(b)),
    ...(r.practice && patch.solo ? { solo: { before: soloBefore, after: patch.solo } } : {}),
  };
}
