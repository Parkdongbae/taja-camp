// 학급 배틀(같은 반 모두가 한 방에서 치고 반 총점을 기록) 순수 로직.
//   CLASS_TIER = 9            학급 방의 tier 값(일반 계급 방 0~5 와 섞이지 않게)
//   CLASS_MAX_PLAYERS = 40    학급 방 정원
//   CLASS_RP = 10             참여 점수(1점 이상 얻은 학생 모두 같은 RP)
//   CLASS_DURATIONS · normalizeClassDuration(sec)   고를 수 있는 경기 시간(초), 기본 300
//   klassOf(grade, classNo) → "13" · parseKlass("13") → { grade, classNo } | null
//   classBattleRecord(room, ranks, at)   끝난 방 → 저장할 결과(ClassBattleRecord). 학급 방이 아니면 null
//   classStandings(records)   반별 최고 총점 순위
//   latestOfClass(records, grade, classNo)   그 반의 가장 최근 결과
//   dateLabel("2026-11-24") → "11월 24일"
import type { BattleRoom, ClassBattleRecord } from '../data/types';
import { todayString } from './scoring';

export const CLASS_TIER = 9;
export const CLASS_MAX_PLAYERS = 40;
export const CLASS_RP = 10;
export const CLASS_DURATIONS = [120, 180, 300, 420, 600] as const;

export function normalizeClassDuration(sec: unknown): number {
  const n = Math.round(Number(sec));
  return (CLASS_DURATIONS as readonly number[]).includes(n) ? n : 300;
}

export function klassOf(grade: number, classNo: number): string {
  return `${Math.floor(grade)}${Math.floor(classNo)}`;
}

export function parseKlass(klass: string | undefined): { grade: number; classNo: number } | null {
  const m = /^([1-9])([1-9]\d?)$/.exec(klass ?? '');
  return m ? { grade: Number(m[1]), classNo: Number(m[2]) } : null;
}

export function classBattleRecord(
  room: BattleRoom,
  ranks: { id: string; name: string; score: number }[],
  at: number,
): ClassBattleRecord | null {
  const k = parseKlass(room.klass);
  if (!k) return null;
  // 누가 저장해도 같은 내용이 되게 점수·학번 순으로 고정한다
  const players = ranks
    .map((r) => ({ id: r.id, name: r.name, score: Math.max(0, Math.round(r.score)) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  // 날짜·시각은 방 시작 시각 기준(참가자마다 저장 시각이 달라도 같은 값)
  const end = room.startAt > 0 ? room.startAt + room.durationSec * 1000 : at;
  return {
    id: room.id,
    grade: k.grade,
    classNo: k.classNo,
    date: todayString(new Date(end)),
    at: end,
    lang: room.lang,
    durationSec: room.durationSec,
    total: players.reduce((s, p) => s + p.score, 0),
    players,
  };
}

export interface ClassStanding {
  grade: number;
  classNo: number;
  best: number; // 최고 총점
  date: string; // 최고 총점을 낸 날
  games: number;
  place: number;
}

export function classStandings(records: ClassBattleRecord[]): ClassStanding[] {
  const by = new Map<string, ClassStanding>();
  for (const r of records) {
    const key = klassOf(r.grade, r.classNo);
    const cur = by.get(key);
    if (!cur) by.set(key, { grade: r.grade, classNo: r.classNo, best: r.total, date: r.date, games: 1, place: 0 });
    else {
      cur.games++;
      if (r.total > cur.best) {
        cur.best = r.total;
        cur.date = r.date;
      }
    }
  }
  const list = [...by.values()].sort((a, b) => b.best - a.best || a.grade - b.grade || a.classNo - b.classNo);
  list.forEach((s, i) => {
    s.place = i > 0 && list[i - 1].best === s.best ? list[i - 1].place : i + 1;
  });
  return list;
}

export function latestOfClass(records: ClassBattleRecord[], grade: number, classNo: number): ClassBattleRecord | null {
  let out: ClassBattleRecord | null = null;
  for (const r of records) {
    if (r.grade === grade && r.classNo === classNo && (!out || r.at > out.at)) out = r;
  }
  return out;
}

export function dateLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : date;
}
