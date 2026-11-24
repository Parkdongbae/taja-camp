// 배틀 화면 공용 도우미.
//   battlePool(words, lang): string[]   배틀에 낼 낱말(언어 일치, 공백 뺀 글자 2~8자, 칠 수 있는 것)
//   battleRiddles(words, lang): Map<낱말, 뜻풀이>   뜻 낱말로 낼 수 있는 것(뜻이 2~28자이고 낱말 자체가 들어 있지 않음)
//   LANG_LABEL: Record<Lang, string>
//   AgainState: 로비로 "한 판 더" 를 넘길 때 쓰는 router state 모양
//   rewardKey(roomId, studentId): sessionStorage 키(배틀 결과 1회 반영 표시)
//   BATTLE_LANG_KEY, readBattleLang(): 로비에서 고른 언어(sessionStorage)
import type { Lang, WordItem } from '../../data/types';
import { isTypeable, normalizeText } from '../../engine/hangul';

export const LANG_LABEL: Record<Lang, string> = { ko: '한국어', en: 'ENG' };

export function battlePool(words: WordItem[], lang: Lang): string[] {
  const out: string[] = [];
  for (const w of words) {
    if (w.lang !== lang) continue;
    const t = normalizeText(w.text).trim();
    const n = [...t.replace(/\s+/g, '')].length;
    if (n >= 2 && n <= 8 && isTypeable(t)) out.push(t);
  }
  return out;
}

export function battleRiddles(words: WordItem[], lang: Lang): Map<string, string> {
  const out = new Map<string, string>();
  for (const w of words) {
    if (w.lang !== lang) continue;
    const t = normalizeText(w.text).trim().replace(/\s+/g, ' ');
    const n = [...t.replace(/\s+/g, '')].length;
    const m = normalizeText(w.meaning ?? '').trim().replace(/\s+/g, ' ');
    const mn = [...m].length;
    if (n < 2 || n > 8 || !isTypeable(t) || mn < 2 || mn > 28) continue;
    if (m.toLowerCase().includes(t.toLowerCase())) continue; // 뜻풀이에 답이 보이면 안 된다
    if (!out.has(t)) out.set(t, m);
  }
  return out;
}

export interface LobbyState {
  again?: boolean; // 결과 화면에서 [한 판 더] → 로비가 바로 입장
  lang?: Lang;
  notice?: string; // 로비 위에 띄울 안내
}

/** 로비에서 고른 배틀 언어(탭마다 기억) */
export const BATTLE_LANG_KEY = 'taja.battle.lang';
export function readBattleLang(): Lang {
  try {
    return sessionStorage.getItem(BATTLE_LANG_KEY) === 'en' ? 'en' : 'ko';
  } catch {
    return 'ko';
  }
}

export const rewardKey =(roomId: string, studentId: string) => `taja.battle.reward.${roomId}.${studentId}`;
