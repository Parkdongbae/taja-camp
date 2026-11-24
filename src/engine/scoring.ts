// 계급·RP·배틀 점수·XP·학생 기록 반영·배지. 순수 로직.
//
// 공개 API
//   TIERS: { name: string; rp: number }[]   훈련병 0 / 이등병 100 / 일병 300 / 상병 600 / 병장 1000 / 예비역 1500
//   tierOf(rp: number): number              TIERS 번호(0~5)
//   tierName(tier: number): string
//   tierProgress(rp: number): { tier: number; name: string; cur: number(지금 RP); base: number(지금 계급 기준 RP); next: number | null(다음 계급 기준 RP); ratio: number(0~1) }
//   battlePoints(text: string): 1 | 2 | 4   기본자리 낱말 1 / 한 단어 2 / 두 단어 이상 4 (두 단어가 모두 기본자리면 2)
//   rpGain(playerCount: number, place: number, score: number, practice = false): number
//       점수 0 이하면 0, 아니면 5 + 2×(인원−순위). practice(봇 연습 배틀)면 절반(내림)
//   interface BattleRank { id: string; name: string; classNo: number; score: number; words: number; lastAt: number(마지막 득점 시각, 없으면 0); place: number; stolen: number(파워로 가져온 점수); lost: number(파워로 빼앗긴 점수); coop: number(협동 성공에 함께한 횟수); fever: number(피버로 더 얻은 점수); team: 0 | 1 | -1(팀전이 아니면 -1) }
//   rankPlayers(room: BattleRoom, scheduleWords: { index: number; points: number; score?: number }[]): BattleRank[]
//       claims 를 시각 순으로 합산(낱말 점수는 score, 없으면 points). 파워 칸(번호 ≥ 1000000)은 그 시점에
//       다른 참가자 각자의 점수 절반(올림)을 빼서 쓴 사람에게 더한다(BattleRank.stolen·lost 에 기록).
//       피버(events.battleEvents) 동안 얻은 낱말·협동 점수는 2배(BattleRank.fever 에 덤으로 얻은 점수).
//       팀전(room.mode === 'team')이면 BattleRank.team 에 팀 번호(0·1), 파워는 상대 팀에게서만 가져온다.
//   teamScores(ranks): [홍팀 점수, 청팀 점수]
//       협동 칸(번호 ≥ 10000000, 낱말에 coop·coopMult 가 있을 때): 접속 중인 참가자 모두가 쳤으면 마지막 사람이 친 시각에
//       모두(친 사람 포함) points × coopMult, 아니면 친 사람만 각자 친 시각에 points. BattleRank.coop 에 성공 횟수. 정렬: 점수 ↓ → 획득 낱말 수 ↓ → 마지막 득점 시각 ↑ (셋 다 같으면 같은 순위). 명단에 없는 득점자도 포함.
//   xpFor(rec: { mode: SessionMode; accuracy: number; isBest: boolean }): number
//       배틀 15 / 그 외 10 + 정확도(95%↑ +5, 100% +10) + 기록 갱신 +10
//   DAILY_GOAL_XP = 30
//   levelOf(xp: number): number             1 + floor(xp / 100)
//   levelProgress(xp: number): { level: number; cur: number; need: number; ratio: number }
//   todayString(d?: Date): string           로컬 날짜 "YYYY-MM-DD"
//   STREAK_GAP_DAYS = 8                     이 일수 안에 다시 연습하면 연속 유지(수업일 기준 근사)
//   applySession(student: Student, rec: SessionRecord, now: Date, goalMinutes = 10): Partial<Student>
//       totalSeconds, todaySeconds, lastDay, days, streak, bestKo/bestEn(정확도 90%↑·낱말/단문/장문·1500 이하),
//       stageBest(승급 테스트 최고점), position(승급 테스트 통과 && 바로 다음 단계일 때 +1),
//       xp(+하루 목표 달성 30), weakKeys(missKeys 합산), badges(새 배지가 있을 때만) 중 바뀐 것
//   applyBattle(student: Student, r: { playerCount: number; place: number; score: number; practice?: boolean }): Partial<Student>
//       rp, games, wins(1등 && 점수>0 && 2명 이상), badges. (XP 는 applySession 에 mode 'battle' 기록으로)
//       practice(컴퓨터 대결)면 rp 만 절반 반영하고 games·wins 는 그대로 둔다.
//   interface Badge { id: string; name: string; desc: string; icon: string; auto: boolean(earnedBadges 로 판정되는가) }
//   BADGES: Badge[]
//   earnedBadges(student: Student, rec?: SessionRecord): string[]   지금 조건을 만족하는 auto 배지 id 전부(이미 가진 것 포함)
import type { BattleRoom, SessionMode, SessionRecord, Student } from '../data/types';
import { isHomeRowOnly, wordCount } from './hangul';
import { getStage } from './stages';
import { battleEvents, feverAt, FEVER_MULT, teamOf } from './events';

export const TIERS: { name: string; rp: number }[] = [
  { name: '훈련병', rp: 0 },
  { name: '이등병', rp: 100 },
  { name: '일병', rp: 300 },
  { name: '상병', rp: 600 },
  { name: '병장', rp: 1000 },
  { name: '예비역', rp: 1500 },
];

export function tierOf(rp: number): number {
  let t = 0;
  for (let i = 0; i < TIERS.length; i++) if (rp >= TIERS[i].rp) t = i;
  return t;
}

export function tierName(tier: number): string {
  return TIERS[Math.max(0, Math.min(TIERS.length - 1, tier))].name;
}

export function tierProgress(rp: number) {
  const tier = tierOf(rp);
  const base = TIERS[tier].rp;
  const next = tier + 1 < TIERS.length ? TIERS[tier + 1].rp : null;
  const ratio = next === null ? 1 : Math.max(0, Math.min(1, (rp - base) / (next - base)));
  return { tier, name: TIERS[tier].name, cur: rp, base, next, ratio };
}

export function battlePoints(text: string): 1 | 2 | 4 {
  const two = wordCount(text) >= 2;
  if (isHomeRowOnly(text)) return two ? 2 : 1;
  return two ? 4 : 2;
}

export function rpGain(playerCount: number, place: number, score: number, practice = false): number {
  if (!(score > 0)) return 0;
  const n = Math.max(1, Math.floor(playerCount));
  const p = Math.max(1, Math.min(n, Math.floor(place)));
  const rp = 5 + 2 * (n - p);
  return practice ? Math.floor(rp / 2) : rp;
}

export interface BattleRank {
  id: string;
  name: string;
  classNo: number;
  score: number;
  words: number;
  lastAt: number;
  place: number;
  stolen: number;
  lost: number;
  coop: number;
  fever: number;
  team: 0 | 1 | -1;
}

export function teamScores(ranks: { team: number; score: number }[]): [number, number] {
  const out: [number, number] = [0, 0];
  for (const r of ranks) if (r.team === 0 || r.team === 1) out[r.team] += r.score;
  return out;
}

const POWER_BASE = 1_000_000; // engine/battle 의 POWER_INDEX_BASE 와 같은 값
const COOP_BASE = 10_000_000; // engine/battle 의 COOP_INDEX_BASE
const COOP_SLOTS = 100;
interface RankWord {
  index: number;
  points: number;
  score?: number;
  coop?: boolean;
  coopMult?: number;
}

export function rankPlayers(room: BattleRoom, scheduleWords: RankWord[]): BattleRank[] {
  const pts = new Map<number, number>();
  const coopW = new Map<number, RankWord>();
  for (const w of scheduleWords) {
    if (w.coop) coopW.set(w.index, w);
    else pts.set(w.index, w.score ?? w.points);
  }
  const teams = room.mode === 'team' ? teamOf(room.players) : null;
  const ev = battleEvents(room.seed, room.durationSec);
  // 피버 동안이면 2배
  const boosted = (r: BattleRank, at: number, base: number) => {
    const v = feverAt(ev, at - room.startAt) ? base * FEVER_MULT : base;
    r.fever += v - base;
    return v;
  };
  const rows = new Map<string, BattleRank>();
  const row = (id: string): BattleRank => {
    let r = rows.get(id);
    if (!r) {
      const p = room.players?.[id];
      r = { id, name: p?.name ?? id, classNo: p?.classNo ?? 0, score: 0, words: 0, lastAt: 0, place: 0, stolen: 0, lost: 0, coop: 0, fever: 0, team: teams ? (teams[id] ?? -1) : -1 };
      rows.set(id, r);
    }
    return r;
  };
  for (const id of Object.keys(room.players ?? {})) row(id);
  const all = Object.entries(room.claims ?? {})
    .filter(([, c]) => !!c?.by)
    .map(([key, c]) => ({ i: Number(key), c, add: -1, team: false }));
  // 협동 칸을 낱말별로 모아 점수 사건으로 바꾼다
  const hits = new Map<number, Map<string, number>>();
  for (const { i, c } of all) {
    if (i < COOP_BASE) continue;
    const wi = Math.floor((i - COOP_BASE) / COOP_SLOTS);
    if (!coopW.has(wi)) continue;
    let m = hits.get(wi);
    if (!m) hits.set(wi, (m = new Map()));
    m.set(c.by, Math.min(m.get(c.by) ?? Infinity, c.at));
  }
  const required = Object.entries(room.players ?? {})
    .filter(([, p]) => p && p.online !== false)
    .map(([id]) => id);
  const events = all.filter((e) => e.i < COOP_BASE);
  for (const [wi, m] of hits) {
    const w = coopW.get(wi)!;
    const done = required.length > 0 && required.every((id) => m.has(id));
    const doneAt = done ? Math.max(...required.map((id) => m.get(id)!)) : 0;
    for (const [by, at] of m) {
      events.push({ i: COOP_BASE + wi, c: { by, at: done ? Math.max(doneAt, at) : at }, add: w.points * (done ? Math.max(1, w.coopMult ?? 1) : 1), team: done });
    }
  }
  events.sort((a, b) => a.c.at - b.c.at || a.i - b.i || (a.c.by < b.c.by ? -1 : 1));
  for (const { i, c, add, team } of events) {
    if (add >= 0) {
      // 협동 낱말 점수
      const r = row(c.by);
      r.score += boosted(r, c.at, add);
      r.words += 1;
      r.lastAt = Math.max(r.lastAt, c.at);
      if (team) r.coop += 1;
      continue;
    }
    if (i >= POWER_BASE) {
      // 파워: 그 시점 다른 사람 점수의 절반(올림)을 가져온다
      const me = row(c.by);
      for (const o of [...rows.values()]) {
        if (o.id === c.by || o.score <= 0 || (teams && o.team === me.team)) continue;
        const take = Math.ceil(o.score / 2);
        o.score -= take;
        o.lost += take;
        me.score += take;
        me.stolen += take;
      }
      continue;
    }
    const p = pts.get(i);
    if (p === undefined) continue;
    const r = row(c.by);
    r.score += boosted(r, c.at, p);
    r.words += 1;
    r.lastAt = Math.max(r.lastAt, c.at);
  }
  const t = (r: BattleRank) => (r.words > 0 ? r.lastAt : Infinity);
  const list = [...rows.values()].sort(
    (a, b) => b.score - a.score || b.words - a.words || t(a) - t(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  list.forEach((r, i) => {
    const prev = list[i - 1];
    r.place = prev && prev.score === r.score && prev.words === r.words && t(prev) === t(r) ? prev.place : i + 1;
  });
  return list;
}

export const DAILY_GOAL_XP = 30;

export function xpFor(rec: { mode: SessionMode; accuracy: number; isBest: boolean }): number {
  if (rec.mode === 'battle') return 15;
  let xp = 10;
  if (rec.accuracy >= 100) xp += 10;
  else if (rec.accuracy >= 95) xp += 5;
  if (rec.isBest) xp += 10;
  return xp;
}

export function levelOf(xp: number): number {
  return 1 + Math.floor(Math.max(0, xp) / 100);
}

export function levelProgress(xp: number) {
  const cur = Math.max(0, xp) % 100;
  return { level: levelOf(xp), cur, need: 100, ratio: cur / 100 };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function todayString(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const STREAK_GAP_DAYS = 8;

function dayNumber(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
}

const RECORD_MODES: SessionMode[] = ['word', 'sentence', 'passage'];

export function applySession(student: Student, rec: SessionRecord, now: Date, goalMinutes = 10): Partial<Student> {
  const out: Partial<Student> = {};
  const day = todayString(now);
  const sec = Math.max(0, Math.round(rec.seconds || 0));
  const practiced = sec > 0 || rec.strokes > 0;

  out.totalSeconds = (student.totalSeconds || 0) + sec;
  const sameDay = student.lastDay === day;
  const prevToday = sameDay ? student.todaySeconds || 0 : 0;
  out.todaySeconds = prevToday + sec;
  if (practiced || sameDay) out.lastDay = day;
  if (practiced && !sameDay) {
    out.days = (student.days || 0) + 1;
    const a = dayNumber(student.lastDay);
    const b = dayNumber(day)!;
    const gap = a === null ? Infinity : b - a;
    out.streak = gap >= 1 && gap <= STREAK_GAP_DAYS ? (student.streak || 0) + 1 : 1;
  } else if (!practiced && !sameDay) {
    // 연습 안 한 기록(0초)은 날짜를 바꾸지 않는다
    out.todaySeconds = student.todaySeconds || 0;
  }

  // 최고 기록
  let isBest = false;
  if (RECORD_MODES.includes(rec.mode) && rec.accuracy >= 90 && rec.kpm > 0 && rec.kpm <= 1500) {
    if (rec.lang === 'ko' && rec.kpm > (student.bestKo || 0)) {
      out.bestKo = rec.kpm;
      isBest = true;
    } else if (rec.lang === 'en' && rec.kpm > (student.bestEn || 0)) {
      out.bestEn = rec.kpm;
      isBest = true;
    }
  }

  // 승급 테스트
  if (rec.mode === 'positionTest' && rec.stageId && typeof rec.score === 'number') {
    const prevBest = student.stageBest?.[rec.stageId];
    if (prevBest === undefined || rec.score > prevBest) {
      out.stageBest = { ...(student.stageBest ?? {}), [rec.stageId]: rec.score };
      isBest = prevBest !== undefined;
    }
    const st = getStage(rec.stageId);
    if (rec.passed && st && st.order === (student.position?.[st.track] ?? 0) + 1) {
      out.position = { ...student.position, [st.track]: st.order };
    }
  }

  // XP
  let xp = xpFor({ mode: rec.mode, accuracy: rec.accuracy, isBest });
  const goal = goalMinutes * 60;
  if (practiced && prevToday < goal && (out.todaySeconds ?? 0) >= goal) xp += DAILY_GOAL_XP;
  out.xp = (student.xp || 0) + xp;

  // 약점 글쇠
  const miss = Object.entries(rec.missKeys ?? {}).filter(([, n]) => n > 0);
  if (miss.length) {
    const wk = { ...(student.weakKeys ?? {}) };
    for (const [code, n] of miss) wk[code] = (wk[code] ?? 0) + n;
    out.weakKeys = wk;
  }

  const nb = newBadges(student, { ...student, ...out }, rec);
  if (nb) out.badges = nb;
  return out;
}

export function applyBattle(
  student: Student,
  r: { playerCount: number; place: number; score: number; practice?: boolean },
): Partial<Student> {
  const out: Partial<Student> = {
    rp: (student.rp || 0) + rpGain(r.playerCount, r.place, r.score, r.practice),
  };
  // 컴퓨터 대결(practice)은 실제 배틀 전적(games·wins)에 넣지 않는다
  if (!r.practice) {
    out.games = (student.games || 0) + 1;
    if (r.place === 1 && r.score > 0 && r.playerCount >= 2) out.wins = (student.wins || 0) + 1;
  }
  const nb = newBadges(student, { ...student, ...out });
  if (nb) out.badges = nb;
  return out;
}

function newBadges(before: Student, after: Student, rec?: SessionRecord): string[] | null {
  const have = before.badges ?? [];
  const add = earnedBadges(after, rec).filter((b) => !have.includes(b));
  return add.length ? [...have, ...add] : null;
}

export interface Badge {
  id: string;
  name: string;
  desc: string;
  icon: string;
  auto: boolean;
}

export const BADGES: Badge[] = [
  { id: 'home-100', name: '기본기 탄탄', desc: '기본자리 승급 테스트 100점', icon: '🎯', auto: true },
  { id: 'bootcamp', name: '훈련소 수료', desc: '한글 8단계와 기호 2단계 통과', icon: '🎖️', auto: true },
  { id: 'no-look', name: '안 보고 치기', desc: '키보드·손 표시를 끄고 테스트 통과', icon: '🙈', auto: false },
  { id: 'flawless', name: '무결점', desc: '단문연습 정확도 100%', icon: '💎', auto: true },
  { id: 'sharpshooter', name: '명사수', desc: '정확도 95% 이상 10회 연속', icon: '🏹', auto: false },
  { id: 'speed-100', name: '100타 돌파', desc: '정확도 90% 이상으로 100타', icon: '🚲', auto: true },
  { id: 'speed-200', name: '200타 돌파', desc: '정확도 90% 이상으로 200타', icon: '🛵', auto: true },
  { id: 'speed-300', name: '300타 돌파', desc: '정확도 90% 이상으로 300타', icon: '🚗', auto: true },
  { id: 'speed-400', name: '400타 돌파', desc: '정확도 90% 이상으로 400타', icon: '🚀', auto: true },
  { id: 'streak-3', name: '개근 3', desc: '3회 연속 출석', icon: '🌱', auto: true },
  { id: 'streak-5', name: '개근 5', desc: '5회 연속 출석', icon: '🌿', auto: true },
  { id: 'streak-10', name: '개근 10', desc: '10회 연속 출석', icon: '🌳', auto: true },
  { id: 'streak-20', name: '개근 20', desc: '20회 연속 출석', icon: '🏆', auto: true },
  { id: 'subject-korean', name: '국어 정복', desc: '국어 낱말을 모두 1회 이상 정확히 입력', icon: '📖', auto: false },
  { id: 'subject-english', name: '영어 정복', desc: '영어 낱말을 모두 1회 이상 정확히 입력', icon: '🔤', auto: false },
  { id: 'subject-math', name: '수학 정복', desc: '수학 낱말을 모두 1회 이상 정확히 입력', icon: '📐', auto: false },
  { id: 'subject-science', name: '과학 정복', desc: '과학 낱말을 모두 1회 이상 정확히 입력', icon: '🔬', auto: false },
  { id: 'subject-social', name: '사회 정복', desc: '사회 낱말을 모두 1회 이상 정확히 입력', icon: '🌏', auto: false },
  { id: 'first-win', name: '첫 승리', desc: '배틀 1등', icon: '🥇', auto: true },
  { id: 'win-10', name: '10승', desc: '배틀 누적 10승', icon: '👑', auto: true },
  { id: 'comeback', name: '역전의 용사', desc: '마지막 20초에 순위 3계단 상승', icon: '⚡', auto: false },
  { id: 'bilingual', name: '바이링구얼', desc: '영문 자리 7단계 통과', icon: '🌐', auto: true },
];

export function earnedBadges(student: Student, rec?: SessionRecord): string[] {
  const out: string[] = [];
  const pos = student.position ?? { ko: 0, symbol: 0, en: 0 };
  const k1 = Math.max(student.stageBest?.K1 ?? 0, rec?.mode === 'positionTest' && rec.stageId === 'K1' ? rec.score ?? 0 : 0);
  if (k1 >= 100) out.push('home-100');
  if (pos.ko >= 8 && pos.symbol >= 2) out.push('bootcamp');
  if (rec && rec.mode === 'sentence' && rec.accuracy >= 100 && rec.strokes > 0) out.push('flawless');
  const best = Math.max(student.bestKo || 0, student.bestEn || 0);
  for (const n of [100, 200, 300, 400]) if (best >= n) out.push(`speed-${n}`);
  for (const n of [3, 5, 10, 20]) if ((student.streak || 0) >= n) out.push(`streak-${n}`);
  if ((student.wins || 0) >= 1) out.push('first-win');
  if ((student.wins || 0) >= 10) out.push('win-10');
  if (pos.en >= 7) out.push('bilingual');
  return out;
}

// ───────── 수행평가 등급 ─────────
// 한글: A 200타 이상, 30타 간격으로 E 까지. 영어: A 150타 이상, 20타 간격으로 E 까지.
export const EXAM_CUTS: Record<'ko' | 'en', { grade: 'A' | 'B' | 'C' | 'D'; min: number }[]> = {
  ko: [
    { grade: 'A', min: 200 },
    { grade: 'B', min: 170 },
    { grade: 'C', min: 140 },
    { grade: 'D', min: 110 },
  ],
  en: [
    { grade: 'A', min: 150 },
    { grade: 'B', min: 130 },
    { grade: 'C', min: 110 },
    { grade: 'D', min: 90 },
  ],
};
/** 최종 타수(타/분)를 수행평가 등급으로 바꾼다. 기준 미만은 E. */
export function examGrade(lang: 'ko' | 'en', kpm: number): 'A' | 'B' | 'C' | 'D' | 'E' {
  for (const c of EXAM_CUTS[lang]) if (kpm >= c.min) return c.grade;
  return 'E';
}
/** 등급표(화면 표시용): [{grade, label}] 예: {grade:'B', label:'170~199타'} */
export function examTable(lang: 'ko' | 'en'): { grade: 'A' | 'B' | 'C' | 'D' | 'E'; label: string }[] {
  const cuts = EXAM_CUTS[lang];
  const rows: { grade: 'A' | 'B' | 'C' | 'D' | 'E'; label: string }[] = cuts.map((c, i) => ({
    grade: c.grade,
    label: i === 0 ? `${c.min}타 이상` : `${c.min}~${cuts[i - 1].min - 1}타`,
  }));
  rows.push({ grade: 'E', label: `${cuts[cuts.length - 1].min}타 미만` });
  return rows;
}
