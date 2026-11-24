// 이 브라우저에만 저장하는 개인 설정(키보드 종류, 표시, 소리).
//   usePrefs(): { keyboardKind, showKeyboard, showHands, sound, soundTheme, volume, bgm(배틀 배경음, 소리가 켜져 있을 때만), set }
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { KeyboardKind } from '../data/types';

export type SoundTheme = 'mechanical' | 'typewriter' | 'bubble';
interface Prefs {
  keyboardKind: KeyboardKind;
  showKeyboard: boolean;
  showHands: boolean;
  sound: boolean;
  soundTheme: SoundTheme;
  volume: number; // 0~1
  bgm: boolean; // 배틀 배경음
  set: (p: Partial<Omit<Prefs, 'set'>>) => void;
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      keyboardKind: 'desktop',
      showKeyboard: true,
      showHands: true,
      sound: false,
      soundTheme: 'mechanical',
      volume: 0.5,
      bgm: true,
      set: (p) => set(p),
    }),
    { name: 'taja-prefs' },
  ),
);
