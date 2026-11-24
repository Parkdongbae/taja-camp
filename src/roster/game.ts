// 학생이름 외우기 게임의 순수 로직(React·DOM 금지). 사진·이름은 브라우저 안에서만 다룬다.
//
// 공개 API
//   type NameMode = 'show' | 'surname' | 'hide'      이름 보이기 / 성만 보이기 / 이름 숨기기
//   type Speed = 'slow' | 'normal' | 'fast'
//   상수: NAME_MODES, SPEEDS(화면 문구), FALL_MS(속도별 낙하 시간), MAX_ON_SCREEN, SPAWN_GAP_MS, LANE_COUNT,
//         MISS_SHOW_MS(놓친 이름 보여 주는 시간), HIT_SHOW_MS, REINSERT_GAP(놓친 학생 재투입 최소 간격), DT_MAX_MS
//   studentKey(s): string                     학년-반-번호-이름 (같은 학생 판별)
//   classKey(grade, classNo): string          "3-3"
//   classLabel(s): string                     "3-3 12번"
//   rosterClassKeys(rosters, rosterIds): ClassChip[]   체크한 명렬표에 들어 있는 (학년, 반) 목록(사진 있는 학생 수 포함)
//   pickStudents(rosters, { rosterIds, classKeys }): RosterStudent[]
//       체크한 명렬표에서 사진 있는 학생만, 겹치는 학생은 한 번만. classKeys 가 비면 모든 반
//   normName(s) / sameName(a, b)              공백 제거 + NFC 비교
//   maskName(name, mode): string              surname → "김○○", hide → ""
//   Deck: createDeck(keys, rand) · drawNext(deck, exclude) · markSolved(deck, key) · requeueMissed(deck, key) · isFinished(deck)
//   chooseLane(busy, rand, avoid?): number | null      빈 칸(lane) 중 무작위
//   findMatch(cards, typed): id | null       이름이 같은 카드 중 가장 아래(progress 큰) 것
//   canAutoMatch(typed, composing, names): boolean     조합 중이면 더 긴 이름으로 이어질 수 없을 때만 자동 맞춤
//   blameCard(cards, typed): id | null       Enter 오답일 때 "헷갈린" 카드 추정(자모 접두가 가장 긴 것, 같으면 아래쪽)
//   pointsFor(combo): number                 맞춘 카드 점수 10 + 연속 보너스(최대 +10)
import { shuffle } from '../engine/rng';
import { normalizeText, toJamo } from '../engine/hangul';
import type { RosterFile, RosterStudent } from './types';

export type NameMode = 'show' | 'surname' | 'hide';
export type Speed = 'slow' | 'normal' | 'fast';

export const NAME_MODES: { id: NameMode; label: string }[] = [
  { id: 'show', label: '이름 보이기' },
  { id: 'surname', label: '성만 보이기' },
  { id: 'hide', label: '이름 숨기기' },
];
export const SPEEDS: { id: Speed; label: string }[] = [
  { id: 'slow', label: '느림' },
  { id: 'normal', label: '보통' },
  { id: 'fast', label: '빠름' },
];

/** 카드가 위에서 바닥까지 떨어지는 시간 */
export const FALL_MS: Record<Speed, number> = { slow: 15000, normal: 11000, fast: 8000 };
/** 동시에 떠 있는 카드 수 */
export const MAX_ON_SCREEN: Record<Speed, number> = { slow: 3, normal: 4, fast: 4 };
/** 새 카드가 나오는 최소 간격 */
export const SPAWN_GAP_MS: Record<Speed, number> = { slow: 3200, normal: 2400, fast: 1700 };
/** 가로 칸 수. 한 칸에는 카드 한 장만 → 겹치지 않는다 */
export const LANE_COUNT = 5;
export const MISS_SHOW_MS = 1200;
export const HIT_SHOW_MS = 450;
/** 놓친 학생은 최소 이만큼 다른 카드가 나온 뒤 다시 나온다 */
export const REINSERT_GAP = 2;
/** 한 프레임 최대 경과 시간(탭이 숨겨졌다 돌아와도 튀지 않게) */
export const DT_MAX_MS = 100;

export const studentKey = (s: Pick<RosterStudent, 'grade' | 'classNo' | 'number' | 'name'>) =>
  `${s.grade}-${s.classNo}-${s.number}-${normName(s.name)}`;
export const classKey = (grade: number, classNo: number) => `${grade}-${classNo}`;
export const classLabel = (s: Pick<RosterStudent, 'grade' | 'classNo' | 'number'>) => `${s.grade}-${s.classNo} ${s.number}번`;

export interface ClassChip {
  key: string;
  grade: number;
  classNo: number;
  /** 사진 있는 학생 수(겹침 제외) */
  count: number;
}

function uniqueWithPhoto(rosters: readonly RosterFile[], rosterIds: readonly string[]): RosterStudent[] {
  const ids = new Set(rosterIds);
  const seen = new Set<string>();
  const out: RosterStudent[] = [];
  for (const r of rosters) {
    if (!ids.has(r.id)) continue;
    for (const s of r.students) {
      if (!s.photo || !normName(s.name)) continue;
      const k = studentKey(s);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}

export function rosterClassKeys(rosters: readonly RosterFile[], rosterIds: readonly string[]): ClassChip[] {
  const map = new Map<string, ClassChip>();
  const ids = new Set(rosterIds);
  // 사진 없는 반도 칩은 보여 준다(인원 0)
  for (const r of rosters) {
    if (!ids.has(r.id)) continue;
    for (const s of r.students) {
      const k = classKey(s.grade, s.classNo);
      if (!map.has(k)) map.set(k, { key: k, grade: s.grade, classNo: s.classNo, count: 0 });
    }
  }
  for (const s of uniqueWithPhoto(rosters, rosterIds)) map.get(classKey(s.grade, s.classNo))!.count++;
  return [...map.values()].sort((a, b) => a.grade - b.grade || a.classNo - b.classNo);
}

export function pickStudents(
  rosters: readonly RosterFile[],
  opts: { rosterIds: readonly string[]; classKeys?: readonly string[] | null },
): RosterStudent[] {
  const all = uniqueWithPhoto(rosters, opts.rosterIds);
  if (!opts.classKeys || opts.classKeys.length === 0) return all;
  const keys = new Set(opts.classKeys);
  return all.filter((s) => keys.has(classKey(s.grade, s.classNo)));
}

export const normName = (s: string) => normalizeText(s).normalize('NFC').replace(/\s+/g, '');
export const sameName = (a: string, b: string) => normName(a) !== '' && normName(a) === normName(b);

export function maskName(name: string, mode: NameMode): string {
  const n = normName(name);
  if (mode === 'show') return name.trim();
  if (mode === 'hide') return '';
  const chars = Array.from(n);
  return chars.length <= 1 ? chars.join('') : chars[0] + '○'.repeat(chars.length - 1);
}

// ── 출제 순서 ──
export interface Deck {
  /** 앞에서부터 나올 학생 키 */
  queue: string[];
  total: number;
  solved: string[];
  /** 마지막으로 꺼낸 학생(연달아 나오지 않게) */
  last: string | null;
}

export function createDeck(keys: readonly string[], rand: () => number): Deck {
  const uniq = [...new Set(keys)];
  return { queue: shuffle(uniq, rand), total: uniq.length, solved: [], last: null };
}

/** 다음 학생을 꺼낸다. exclude(화면에 떠 있는 학생)는 건너뛰고, 직전 학생은 다른 후보가 있으면 피한다. */
export function drawNext(deck: Deck, exclude: readonly string[] = []): { deck: Deck; key: string | null } {
  const ex = new Set(exclude);
  let idx = deck.queue.findIndex((k) => !ex.has(k) && k !== deck.last);
  if (idx < 0) idx = deck.queue.findIndex((k) => !ex.has(k));
  if (idx < 0) return { deck, key: null };
  const key = deck.queue[idx];
  const queue = deck.queue.slice(0, idx).concat(deck.queue.slice(idx + 1));
  return { deck: { ...deck, queue, last: key }, key };
}

export function markSolved(deck: Deck, key: string): Deck {
  if (deck.solved.includes(key)) return deck;
  return { ...deck, solved: [...deck.solved, key], queue: deck.queue.filter((k) => k !== key) };
}

/** 놓친 학생을 REINSERT_GAP 장 뒤에 다시 넣는다(남은 카드가 적으면 맨 뒤). */
export function requeueMissed(deck: Deck, key: string): Deck {
  if (deck.solved.includes(key)) return deck;
  const rest = deck.queue.filter((k) => k !== key);
  const at = Math.min(REINSERT_GAP, rest.length);
  return { ...deck, queue: [...rest.slice(0, at), key, ...rest.slice(at)] };
}

export const isFinished = (deck: Deck) => deck.solved.length >= deck.total;

// ── 카드 배치·판정 ──
/** 빈 칸 중 무작위. avoid(직전 칸)는 다른 빈 칸이 있으면 피한다. 빈 칸이 없으면 null */
export function chooseLane(busy: readonly number[], rand: () => number, avoid: number | null = null, laneCount = LANE_COUNT): number | null {
  const used = new Set(busy);
  const free: number[] = [];
  for (let i = 0; i < laneCount; i++) if (!used.has(i)) free.push(i);
  if (free.length === 0) return null;
  const pool = free.length > 1 && avoid !== null ? free.filter((l) => l !== avoid) : free;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

export interface MatchCard<Id> {
  id: Id;
  name: string;
  /** 0(맨 위) ~ 1(바닥) */
  progress: number;
}

export function findMatch<Id>(cards: readonly MatchCard<Id>[], typed: string): Id | null {
  let best: MatchCard<Id> | null = null;
  for (const c of cards) if (sameName(c.name, typed) && (!best || c.progress > best.progress)) best = c;
  return best ? best.id : null;
}

/** 자모 단위로 a 가 b 의 (진)접두인가 */
function jamoPrefix(a: string, b: string, proper: boolean): boolean {
  const ja = toJamo(normName(a));
  const jb = toJamo(normName(b));
  if (ja.length > jb.length || (proper && ja.length === jb.length)) return false;
  return ja.every((u, i) => u === jb[i]);
}

/**
 * 입력값이 이름과 같아졌을 때 바로 맞춤 처리해도 되는가.
 * 조합 중이면 마지막 글자가 더 바뀔 수 있으므로, 화면의 다른 이름이 지금 입력의 자모 뒤로 이어지는 경우에는 기다린다.
 */
export function canAutoMatch(typed: string, composing: boolean, names: readonly string[]): boolean {
  if (!names.some((n) => sameName(n, typed))) return false;
  if (!composing) return true;
  return !names.some((n) => jamoPrefix(typed, n, true));
}

function commonJamo(a: string, b: string): number {
  const ja = toJamo(normName(a));
  const jb = toJamo(normName(b));
  let i = 0;
  while (i < ja.length && i < jb.length && ja[i] === jb[i]) i++;
  return i;
}

export function blameCard<Id>(cards: readonly MatchCard<Id>[], typed: string): Id | null {
  let best: MatchCard<Id> | null = null;
  let bestLen = -1;
  for (const c of cards) {
    const len = commonJamo(c.name, typed);
    if (len > bestLen || (len === bestLen && best && c.progress > best.progress)) {
      best = c;
      bestLen = len;
    }
  }
  return best ? best.id : null;
}

export const pointsFor = (combo: number) => 10 + Math.min(10, Math.max(0, combo - 1));
