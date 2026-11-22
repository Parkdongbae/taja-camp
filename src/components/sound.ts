// Web Audio 로 합성하는 타건음. 파일 없이 오실레이터·잡음으로 만든다. 순수 함수라 어느 화면에서나 쓴다.
//
// 공개 API
//   playKey()      정타 (테마마다 3가지 변형을 무작위 재생)
//   playError()    오타: 낮고 짧은 "툭"
//   playDone()     낱말·문장 완성: 맑은 "딩"
//   playFanfare()  승급·진급·결과 창: 2초 이내 팡파르
//   배틀: playTick(high?) 카운트다운 "삑" · playStart() 시작 · playScore(1|2|4) 낱말 획득 · playCombo(n) 연속 획득
//         playLate() 한발 늦음 · playWarn() 마지막 20초 · playEnd() 경기 종료
//   soundEnabled() 지금 소리를 내도 되는가 (usePrefs.sound 와 useAuth.settings.soundAllowed)
// 소리가 꺼져 있거나 Web Audio 를 쓸 수 없으면 아무것도 하지 않는다. 음량은 usePrefs.volume, 테마는 usePrefs.soundTheme.
import { usePrefs, type SoundTheme } from '../state/prefs';
import { useAuth } from '../state/auth';

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  if (!noise) {
    const len = Math.floor(c.sampleRate * 0.12);
    noise = c.createBuffer(1, len, c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return noise;
}

export function soundEnabled(): boolean {
  return usePrefs.getState().sound && useAuth.getState().settings.soundAllowed;
}

interface Ready {
  c: AudioContext;
  vol: number;
  theme: SoundTheme;
}
function ready(): Ready | null {
  if (!soundEnabled()) return null;
  const c = getCtx();
  if (!c) return null;
  const { volume, soundTheme } = usePrefs.getState();
  return { c, vol: Math.max(0, Math.min(1, volume)), theme: soundTheme };
}

/** 짧은 음 하나: 주파수 f0→f1 로 미끄러지며 지수 감쇠. */
function tone(r: Ready, type: OscillatorType, f0: number, f1: number, dur: number, gain: number, delay = 0) {
  const { c, vol } = r;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * vol), t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** 잡음 한 번: 대역 필터를 거친 짧은 "탁". */
function click(r: Ready, freq: number, q: number, dur: number, gain: number, type: BiquadFilterType = 'bandpass') {
  const { c, vol } = r;
  const t = c.currentTime;
  const s = c.createBufferSource();
  s.buffer = noiseBuffer(c);
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(Math.max(0.0002, gain * vol), t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(c.destination);
  s.start(t);
  s.stop(t + dur + 0.02);
}

const pick = (n: number) => Math.floor(Math.random() * n);

export function playKey(): void {
  const r = ready();
  if (!r) return;
  const v = pick(3);
  if (r.theme === 'typewriter') {
    click(r, 3200 + v * 500, 1.2, 0.05, 0.9, 'highpass');
    tone(r, 'square', 900 + v * 120, 300, 0.04, 0.12);
  } else if (r.theme === 'bubble') {
    const base = 520 + v * 140;
    tone(r, 'sine', base, base * 1.8, 0.09, 0.35);
  } else {
    // 기계식: 윗 잡음 + 낮은 울림
    click(r, 1800 + v * 350, 0.9, 0.045, 0.8);
    tone(r, 'sine', 180 + v * 25, 90, 0.07, 0.25);
  }
}

export function playError(): void {
  const r = ready();
  if (!r) return;
  // 경고음처럼 날카롭지 않게: 낮은 사인파 + 둔한 잡음
  tone(r, 'sine', 150, 70, 0.14, 0.4);
  click(r, 400, 0.7, 0.06, 0.35, 'lowpass');
}

export function playDone(): void {
  const r = ready();
  if (!r) return;
  tone(r, 'sine', 1320, 1320, 0.35, 0.3);
  tone(r, 'sine', 1980, 1980, 0.25, 0.1);
}

export function playFanfare(): void {
  const r = ready();
  if (!r) return;
  // 도-미-솔-높은 도, 마지막 음은 길게(총 약 1.6초)
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => {
    const last = i === notes.length - 1;
    tone(r, 'triangle', f, f, last ? 0.7 : 0.18, 0.3, i * 0.14);
    if (last) tone(r, 'sine', f * 1.5, f * 1.5, 0.7, 0.12, i * 0.14);
  });
}

// ───────── 배틀 효과음 ─────────

/** 카운트다운 한 칸. high 면 마지막 5초용 높은 음. */
export function playTick(high = false): void {
  const r = ready();
  if (!r) return;
  tone(r, 'square', high ? 1320 : 660, high ? 1320 : 660, 0.09, 0.14);
}

/** 경기 시작: 위로 올라가는 두 음. */
export function playStart(): void {
  const r = ready();
  if (!r) return;
  tone(r, 'triangle', 660, 660, 0.12, 0.3);
  tone(r, 'triangle', 1320, 1320, 0.45, 0.32, 0.12);
  tone(r, 'sine', 1980, 1980, 0.4, 0.1, 0.12);
}

/** 낱말 획득: 점수가 클수록 높고 화려하게. */
export function playScore(points: number): void {
  const r = ready();
  if (!r) return;
  if (points >= 4) {
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => tone(r, 'triangle', f, f, i === 3 ? 0.3 : 0.1, 0.26, i * 0.055));
  } else if (points >= 2) {
    tone(r, 'triangle', 880, 880, 0.09, 0.26);
    tone(r, 'triangle', 1318.5, 1318.5, 0.2, 0.26, 0.07);
  } else {
    tone(r, 'triangle', 880, 990, 0.14, 0.24);
  }
}

/** 연속 획득(3번째부터): 이어질수록 한 음씩 올라간다. */
export function playCombo(n: number): void {
  const r = ready();
  if (!r) return;
  const f = 1568 * Math.pow(2, Math.min(7, Math.max(0, n - 3)) / 12);
  tone(r, 'sine', f, f * 1.5, 0.22, 0.2, 0.18);
}

/** 한발 늦음: 아래로 떨어지는 부드러운 음. */
export function playLate(): void {
  const r = ready();
  if (!r) return;
  tone(r, 'sine', 520, 300, 0.22, 0.3);
}

/** 마지막 20초 알림: 같은 음 두 번. */
export function playWarn(): void {
  const r = ready();
  if (!r) return;
  tone(r, 'square', 880, 880, 0.12, 0.14);
  tone(r, 'square', 880, 880, 0.12, 0.14, 0.18);
}

/** 경기 종료: 길게 내려가는 호루라기 느낌. */
export function playEnd(): void {
  const r = ready();
  if (!r) return;
  tone(r, 'triangle', 1568, 1568, 0.18, 0.3);
  tone(r, 'triangle', 1568, 784, 0.7, 0.3, 0.2);
}
