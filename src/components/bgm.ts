// 타이핑 배틀용 절차 생성 BGM (Web Audio 합성, 오디오 파일 없음)
// - startBgm(): 루프를 처음부터 시작 (재생 중/사운드 차단/bgm off/컨텍스트 없으면 무시, 절대 throw 없음)
// - stopBgm(): 약 0.4초 페이드아웃 후 스케줄 중지 (중복 호출 안전)
// - setBgmFast(f): true → 168BPM +2반음 (마지막 초 긴장감), 다음 스케줄 스텝부터 적용
// - isBgmPlaying(): 재생 중 여부
import { usePrefs } from '../state/prefs';
import { soundEnabled } from './sound';

// --- 상수 ---
const BPM_NORMAL = 132;
const BPM_FAST = 168;
const STEPS_PER_BAR = 16;
const BARS = 4;
const TOTAL_STEPS = STEPS_PER_BAR * BARS; // 64
const LOOKAHEAD_S = 0.12; // 스케줄 선행 시간
const TICK_MS = 25; // 스케줄러 주기
const MASTER_BASE = 0.16;

// --- 음악 데이터 (A 단조, Am | F | C | G, 마디당 한 코드) ---
// 리드 멜로디: 64스텝, MIDI 노트(0=쉼표), 8분음 중심 + 16분 러닝, 범위 A4..E6
const MELODY: readonly number[] = [
  // Am
  69, 0, 72, 0, 76, 0, 74, 72, 69, 0, 72, 74, 76, 0, 72, 0,
  // F
  69, 0, 72, 0, 77, 0, 72, 77, 74, 0, 72, 0, 69, 0, 72, 0,
  // C
  72, 0, 76, 0, 79, 0, 76, 72, 74, 0, 76, 0, 79, 0, 76, 0,
  // G
  71, 0, 74, 0, 79, 0, 74, 79, 76, 0, 74, 0, 76, 0, 74, 72,
];
// 베이스 루트: A2, F2, C3, G2
const BASS_ROOTS: readonly number[] = [45, 41, 48, 43];
// 아르페지오 코드톤 (리드보다 한 옥타브 아래 레지스터)
const ARP_CHORDS: readonly number[][] = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [55, 60, 64], // C
  [55, 59, 62], // G
];

// --- 상태 ---
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let step = 0;
let nextStepTime = 0;
let playing = false;
let isFast = false;

// MIDI → 주파수
function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// 현재 16분음 길이(초)
function stepDur(): number {
  return 60 / (isFast ? BPM_FAST : BPM_NORMAL) / 4;
}

// 0.2초 화이트노이즈 버퍼 생성
function makeNoiseBuffer(c: AudioContext): AudioBuffer {
  const len = Math.floor(c.sampleRate * 0.2);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// 컨텍스트 지연 생성 + 마스터 게인/노이즈 버퍼 준비
function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  master = ctx.createGain();
  master.connect(ctx.destination);
  noiseBuf = makeNoiseBuffer(ctx);
  return ctx;
}

// 마스터 게인 = 0.16 * clamp(volume), 틱마다 재적용해 볼륨 실시간 반영
function applyMasterGain(): void {
  if (!ctx || !master) return;
  const vol = Math.min(1, Math.max(0, usePrefs.getState().volume));
  master.gain.setTargetAtTime(MASTER_BASE * vol, ctx.currentTime, 0.05);
}

// 일반 발진 음성: 어택 후 지수 감쇠
function playOsc(type: OscillatorType, hz: number, t: number, dur: number, peak: number, attack: number): void {
  if (!ctx || !master) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(hz, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  osc.onended = () => {
    osc.disconnect();
    g.disconnect();
  };
}

// 킥: 사인 150→50Hz 스윕, 0.12s, 게인 1.0
function playKick(t: number): void {
  if (!ctx || !master) return;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(50, t + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(1.0, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  osc.connect(g);
  g.connect(master);
  osc.start(t);
  osc.stop(t + 0.14);
  osc.onended = () => {
    osc.disconnect();
    g.disconnect();
  };
}

// 노이즈 타음 (스네어/하이햇 공용)
function playNoise(t: number, dur: number, peak: number, filterType: BiquadFilterType, freq: number): void {
  if (!ctx || !master || !noiseBuf) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.setValueAtTime(freq, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
  src.onended = () => {
    src.disconnect();
    f.disconnect();
    g.disconnect();
  };
}

// 한 스텝(16분음) 스케줄
function scheduleStep(s: number, t: number): void {
  const bar = Math.floor(s / STEPS_PER_BAR);
  const inBar = s % STEPS_PER_BAR;
  const tr = isFast ? 2 : 0; // 빠르면 +2반음 전조

  // 리드: 스퀘어, 어택 5ms, 0.18s 감쇠, 게인 0.5
  const lead = MELODY[s];
  if (lead > 0) playOsc('square', midiToHz(lead + tr), t, 0.18, 0.5, 0.005);

  if (inBar % 2 === 0) {
    // 베이스: 루트/옥타브 교대 8분음, 트라이앵글, 0.2s, 게인 0.9
    const oct = inBar % 4 === 2 ? 12 : 0;
    playOsc('triangle', midiToHz(BASS_ROOTS[bar] + oct + tr), t, 0.2, 0.9, 0.004);
  } else {
    // 아르페지오: 엇박 16분음 코드톤, 스퀘어, 게인 0.18
    const tones = ARP_CHORDS[bar];
    playOsc('square', midiToHz(tones[Math.floor(inBar / 2) % tones.length] + tr), t, 0.09, 0.18, 0.004);
  }

  // 드럼
  if (inBar === 0 || inBar === 8) playKick(t);
  if (inBar === 4 || inBar === 12) playNoise(t, 0.1, 0.5, 'bandpass', 1800); // 스네어
  if (s % 2 === 0) playNoise(t, 0.03, 0.15, 'highpass', 7000); // 하이햇
}

// 룩어헤드 스케줄러 틱
function tick(): void {
  if (!ctx || !master) return;
  try {
    applyMasterGain(); // 볼륨 라이브 반영
    if (nextStepTime < ctx.currentTime) {
      // 탭 숨김 등으로 뒤처진 경우 현재 스텝부터 재앵커
      nextStepTime = ctx.currentTime + 0.02;
    }
    while (nextStepTime < ctx.currentTime + LOOKAHEAD_S) {
      scheduleStep(step, nextStepTime);
      nextStepTime += stepDur();
      step = (step + 1) % TOTAL_STEPS;
    }
  } catch {
    // 스케줄 오류 무시
  }
}

// 루프 시작 (처음부터)
export function startBgm(): void {
  try {
    if (playing) return;
    if (!soundEnabled()) return;
    if (usePrefs.getState().bgm === false) return;
    const c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => undefined);
    step = 0;
    nextStepTime = c.currentTime + 0.06;
    playing = true;
    applyMasterGain();
    if (timer !== null) clearInterval(timer);
    timer = setInterval(tick, TICK_MS);
  } catch {
    // 절대 throw 하지 않음
  }
}

// 페이드아웃 후 정지 (중복 호출 안전)
export function stopBgm(): void {
  try {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    playing = false;
    if (ctx && master) {
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.1); // 약 0.4s 페이드
    }
  } catch {
    // 무시
  }
}

// 템포/전조 전환 (다음 스케줄 스텝부터 적용)
export function setBgmFast(fast: boolean): void {
  isFast = fast;
}

export function isBgmPlaying(): boolean {
  return playing;
}

// 탭 숨김 시 스케줄 중단, 복귀 시 현재 스텝부터 재개 (1회 등록)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    try {
      if (document.hidden) {
        if (playing && timer !== null) {
          clearInterval(timer);
          timer = null;
        }
        if (playing && ctx && master) {
          master.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        }
      } else if (playing) {
        if (ctx) {
          if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
          if (master) applyMasterGain();
        }
        if (timer === null) timer = setInterval(tick, TICK_MS);
      }
    } catch {
      // 무시
    }
  });
}
