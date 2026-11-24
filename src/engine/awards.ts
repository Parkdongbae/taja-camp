// 배틀 결과 칭호. 순수 로직. 1등이 아니어도 주인공이 될 수 있게 여러 기준으로 한 명씩 뽑는다.
//
// 공개 API
//   interface Award { id: string; icon: string; title: string; desc: string; winner: string(학번); name: string; value: number }
//   battleAwards(room, schedule): Award[]
//     - 속사포(낱말 수) · 한 방(한 낱말 최고 점수) · 선제 득점(가장 먼저 득점) · 막판 스퍼트(마지막 20초 점수)
//       · 보너스 사냥꾼(특수 낱말 수) · 협동왕(협동 낱말을 친 횟수) · 뜻풀이 박사(뜻 낱말 수) · 역전의 명수(역전 찬스 낱말 수)
//       · 피버왕(피버 동안 낱말 수) · 포인트 사냥꾼(파워로 가져온 점수)
//     - 값이 0 이면 그 칭호는 없다. 같은 값이면 최종 순위가 높은 사람.
import type { BattleRoom } from '../data/types';
import { coopWordOf, isPowerIndex, type FallingWord } from './battle';
import { battleEvents, feverAt } from './events';
import { rankPlayers } from './scoring';

export interface Award {
  id: string;
  icon: string;
  title: string;
  desc: string;
  winner: string;
  name: string;
  value: number;
}

interface Stat {
  words: number;
  best: number;
  firstAt: number;
  last: number;
  special: number;
  coop: number;
  riddle: number;
  comeback: number;
  fever: number;
}

export function battleAwards(room: BattleRoom, schedule: FallingWord[]): Award[] {
  const ranks = rankPlayers(room, schedule);
  const byIndex = new Map(schedule.map((w) => [w.index, w]));
  const ev = battleEvents(room.seed, room.durationSec);
  const lastFrom = room.durationSec * 1000 - 20_000;
  const stats = new Map<string, Stat>();
  const stat = (id: string) => {
    let s = stats.get(id);
    if (!s) stats.set(id, (s = { words: 0, best: 0, firstAt: Infinity, last: 0, special: 0, coop: 0, riddle: 0, comeback: 0, fever: 0 }));
    return s;
  };
  const coopSeen = new Set<string>();
  for (const [key, c] of Object.entries(room.claims ?? {})) {
    if (!c?.by) continue;
    const i = Number(key);
    if (isPowerIndex(i)) continue;
    const t = c.at - room.startAt;
    const s = stat(c.by);
    const cw = coopWordOf(i);
    if (cw >= 0) {
      const w = byIndex.get(cw);
      if (!w?.coop || coopSeen.has(`${cw}:${c.by}`)) continue;
      coopSeen.add(`${cw}:${c.by}`);
      s.coop += 1;
      s.words += 1;
      s.firstAt = Math.min(s.firstAt, c.at);
      if (feverAt(ev, t)) s.fever += 1;
      continue;
    }
    const w = byIndex.get(i);
    if (!w || w.coop) continue;
    s.words += 1;
    s.best = Math.max(s.best, w.score);
    s.firstAt = Math.min(s.firstAt, c.at);
    if (t >= lastFrom) s.last += w.score;
    if (w.fast || w.blink || w.zigzag || w.golden) s.special += 1;
    if (w.riddle) s.riddle += 1;
    if (w.comeback) s.comeback += 1;
    if (feverAt(ev, t)) s.fever += 1;
  }

  const out: Award[] = [];
  const give = (id: string, icon: string, title: string, desc: (v: number) => string, value: (r: (typeof ranks)[number], s: Stat | undefined) => number) => {
    let best: (typeof ranks)[number] | null = null;
    let bestV = 0;
    for (const r of ranks) {
      const v = value(r, stats.get(r.id));
      if (v > bestV) {
        best = r; // ranks 는 순위 순이라 같은 값이면 앞사람이 남는다
        bestV = v;
      }
    }
    if (best) out.push({ id, icon, title, desc: desc(bestV), winner: best.id, name: best.name, value: bestV });
  };
  const firstAll = Math.min(...[...stats.values()].map((s) => s.firstAt), Infinity);
  give('rapid', '🔫', '속사포', (v) => `낱말 ${v}개`, (_r, s) => s?.words ?? 0);
  give('bigshot', '💥', '한 방', (v) => `한 낱말에 ${v}점`, (_r, s) => s?.best ?? 0);
  give('first', '🚩', '선제 득점', () => '가장 먼저 득점', (_r, s) => (s && Number.isFinite(firstAll) && s.firstAt === firstAll ? 1 : 0));
  give('sprint', '🏃', '막판 스퍼트', (v) => `마지막 20초에 ${v}점`, (_r, s) => s?.last ?? 0);
  give('hunter', '✨', '보너스 사냥꾼', (v) => `특수 낱말 ${v}개`, (_r, s) => s?.special ?? 0);
  give('coop', '🤝', '협동왕', (v) => `협동 낱말 ${v}번`, (_r, s) => s?.coop ?? 0);
  give('riddle', '📖', '뜻풀이 박사', (v) => `뜻 낱말 ${v}개`, (_r, s) => s?.riddle ?? 0);
  give('comeback', '🚀', '역전의 명수', (v) => `역전 찬스 ${v}개`, (_r, s) => s?.comeback ?? 0);
  give('fever', '🔥', '피버왕', (v) => `피버 동안 ${v}개`, (_r, s) => s?.fever ?? 0);
  give('power', '⚡', '포인트 사냥꾼', (v) => `파워로 ${v}점 회수`, (r) => r.stolen);
  return out;
}
