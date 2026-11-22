// 배틀 멈추기: 선생님이 정한 문장을 친 학생만 잠시 입력할 수 있다. 순수 로직.
//   phraseKey(text): 비교용 문자열(공백 정리, 끝의 . ! ? ~ 무시)
//   samePhrase(typed, phrase): 멈추기 문장을 맞게 쳤는가
//   activeFreeze(freezes, now): 지금 걸려 있는 멈추기 { by, until } (없으면 null). 겹치면 먼저 시작한 것
import { normalizeText } from './hangul';

export interface FreezeMark {
  at: number; // 시작 시각(room.startAt 과 같은 기준, ms)
  ms: number; // 길이
}

export function phraseKey(text: string): string {
  return normalizeText(text ?? '').trim().replace(/\s+/g, ' ').replace(/[.!?~\s]+$/, '');
}

export function samePhrase(typed: string, phrase: string | undefined | null): boolean {
  const p = phraseKey(phrase ?? '');
  return p.length > 0 && phraseKey(typed) === p;
}

export function activeFreeze(freezes: Record<string, FreezeMark> | undefined | null, now: number): { by: string; until: number } | null {
  let best: { by: string; at: number; until: number } | null = null;
  for (const [by, f] of Object.entries(freezes ?? {})) {
    if (!f || typeof f.at !== 'number' || typeof f.ms !== 'number') continue;
    const until = f.at + f.ms;
    if (now < f.at || now >= until) continue;
    if (!best || f.at < best.at) best = { by, at: f.at, until };
  }
  return best ? { by: best.by, until: best.until } : null;
}
