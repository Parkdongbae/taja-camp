// 배틀 경기 중 이벤트(피버·안개·거꾸로), 팀 나누기, 역전 찬스 대상. 순수 로직(시드 → 결정적).
//
// 공개 API
//   FEVER_MS = 10000 · FEVER_MULT = 2 · TWIST_MS = 8000
//   interface BattleEvents { fever: { start; end } | null; twists: { kind: 'fog' | 'flip'; start; end }[] }   (ms, 경기 시작 기준)
//   battleEvents(seed, durationSec): BattleEvents
//     - 피버: 경기의 45~65% 지점에서 시작해 10초. 그동안 얻는 점수 2배, 낱말이 더 자주 나온다.
//     - 안개(fog)·거꾸로(flip): 각 8초. 하나는 피버 앞(15초 이후), 하나는 피버 뒤(마지막 20초 전)에. 자리가 없으면 생략.
//     - 50초보다 짧은 경기는 이벤트 없음.
//   feverAt(ev, elapsedMs): boolean · twistAt(ev, elapsedMs): 'fog' | 'flip' | null
//   TEAM_NAMES = ['홍팀', '청팀'] · teamOf(players): Record<학번, 0 | 1>   들어온 순서(joinedAt, 같으면 학번)대로 번갈아
//   isUnderdog(ranks, id): boolean   역전 찬스 낱말을 볼 수 있는가(2명 이상, 1등보다 점수가 낮고, 순위가 아래 30%)
import { mulberry32 } from './rng';

export const FEVER_MS = 10_000;
export const FEVER_MULT = 2;
export const TWIST_MS = 8_000;

export type TwistKind = 'fog' | 'flip';
export interface BattleEvents {
  fever: { start: number; end: number } | null;
  twists: { kind: TwistKind; start: number; end: number }[];
}

export function battleEvents(seed: number, durationSec: number): BattleEvents {
  const dur = Math.round(durationSec * 1000);
  if (!(dur >= 50_000)) return { fever: null, twists: [] };
  const r = mulberry32((Math.floor(Number(seed) || 0) ^ 0x51ed270b) >>> 0);
  const sec = (ms: number) => Math.round(ms / 1000) * 1000;
  const fs = sec(dur * (0.45 + 0.2 * r()));
  const fever = { start: fs, end: fs + FEVER_MS };
  const first: TwistKind = r() < 0.5 ? 'fog' : 'flip';
  const a = r();
  const b = r();
  const twists: BattleEvents['twists'] = [];
  const put = (kind: TwistKind, lo: number, hi: number, x: number) => {
    if (hi < lo) return;
    const start = sec(lo + (hi - lo) * x);
    twists.push({ kind, start, end: start + TWIST_MS });
  };
  put(first, 15_000, fever.start - TWIST_MS - 3_000, a);
  put(first === 'fog' ? 'flip' : 'fog', fever.end + 3_000, dur - 20_000 - TWIST_MS, b);
  return { fever, twists };
}

export function feverAt(ev: BattleEvents, elapsedMs: number): boolean {
  return !!ev.fever && elapsedMs >= ev.fever.start && elapsedMs < ev.fever.end;
}

export function twistAt(ev: BattleEvents, elapsedMs: number): TwistKind | null {
  for (const t of ev.twists) if (elapsedMs >= t.start && elapsedMs < t.end) return t.kind;
  return null;
}

export const TEAM_NAMES = ['홍팀', '청팀'] as const;

export function teamOf(players: Record<string, { id?: string; joinedAt?: number }> | undefined | null): Record<string, 0 | 1> {
  const ids = Object.keys(players ?? {}).sort((x, y) => {
    const d = (players![x]?.joinedAt ?? 0) - (players![y]?.joinedAt ?? 0);
    return d || (x < y ? -1 : x > y ? 1 : 0);
  });
  const out: Record<string, 0 | 1> = {};
  ids.forEach((id, i) => (out[id] = (i % 2) as 0 | 1));
  return out;
}

export function isUnderdog(ranks: { id: string; place: number; score: number }[], id: string): boolean {
  const n = ranks.length;
  const me = ranks.find((r) => r.id === id);
  if (!me || n < 2) return false;
  const top = Math.max(...ranks.map((r) => r.score));
  return me.score < top && me.place > Math.max(1, Math.floor(n * 0.7));
}
