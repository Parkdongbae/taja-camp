// 배틀 경기 화면. <BattlePlay room schedule meId driver title? />
//   interface BattleDriver { now(): number; claim(index): Promise<boolean>; finish(): void; onFrame?(elapsedMs): void }
//     친구 배틀은 서버(serverNow·claimWord·finishRoom), 컴퓨터 대결은 로컬 상태로 구현해 넘긴다.
// - startAt 전 5초 카운트다운 → durationSec 동안 경기 → 시간이 다 되면 driver.finish()(상태가 그대로면 3초마다 다시).
// - 낱말 DOM 은 React 밖에서 만들고 requestAnimationFrame 으로 transform 만 바꾼다(리렌더 최소화).
// - 멈추기: 선생님이 정한 문장(settings.freezePhrase)을 치면 driver.freeze(ms) → room.freezes 에 기록,
//   그동안 다른 참가자는 입력할 수 없다(한 판에 한 사람 한 번).
// - 욕설: 화면에 없는 말을 냈는데 욕설이면 경고 창 + settings.badWordSeconds 동안 내 입력만 막는다.
// - claims 에 들어온 낱말은 숨기고, 그 자리에 선점자 이름표 + 터지는 효과(0.6초). 내가 얻으면 +점수.
// - 낱말은 네 방향(위→아래, 아래→위, 좌→우, 우→좌)으로 지나가고, 반대쪽 끝에 닿으면 사라진다.
//   특수 낱말(⚡빠름 +1 · 👻깜빡 +2 · 🌀흔들 +1 · ★황금 2배)은 이름 옆에 보너스 표시.
// - 파워게이지: 오타 없이 연속 POWER_NEED(20)개를 얻으면 자동으로 "포인트 회수"(다른 참가자 점수의 절반을 가져옴).
//   claims 의 파워 칸(nextPowerIndex)에 driver.claim 으로 기록한다. 오타면 게이지 0, 한발 늦은 것은 유지.
// - 배경음: 경기 중에만(소리 켬 + usePrefs.bgm). 마지막 20초에는 빨라진다.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BattleRoom } from '../../data/types';
import {
  matchSubmission,
  nextPowerIndex,
  isPowerIndex,
  POWER_NEED,
  visibleWords,
  wordAlpha,
  wordSway,
  wordY,
  type FallingWord,
} from '../../engine/battle';
import { normalizeText } from '../../engine/hangul';
import { rankPlayers } from '../../engine/scoring';
import { BattleInput, type SubmitResult } from './BattleInput';
import { LANG_LABEL } from './battleUtil';
import {
  playAlarm,
  playBonus,
  playCombo,
  playEnd,
  playError,
  playFreeze,
  playLate,
  playPower,
  playScore,
  playStart,
  playTick,
  playWarn,
  soundEnabled,
} from '../sound';
import { setBgmFast, startBgm, stopBgm } from '../bgm';
import { usePrefs } from '../../state/prefs';
import { findBadWord } from '../../engine/badwords';
import { activeFreeze, phraseKey, samePhrase } from '../../engine/freeze';
import { useAuth } from '../../state/auth';

const WORD_BASE =
  'absolute left-0 top-0 whitespace-nowrap rounded-lg px-2 py-0.5 text-2xl font-bold will-change-transform select-none transition-opacity';
const WORD_COLOR: Record<1 | 2 | 4, string> = {
  1: 'text-white/45',
  2: 'text-white',
  4: 'text-gold drop-shadow-[0_0_6px_var(--color-gold)]',
};
const WORD_GOLDEN = 'text-ink bg-gold shadow-[0_0_12px_var(--color-gold)]';
const BURST_MS = 600;
const SWAY_PX = 26;
const POWER_FX_MS = 2600;
const lim = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(Math.max(lo, hi), n));
const fxIcons = (w: FallingWord) => `${w.fast ? '⚡' : ''}${w.blink ? '👻' : ''}${w.zigzag ? '🌀' : ''}${w.golden ? '★' : ''}`;
const LAST_SEC = 20;

interface WordEl {
  el: HTMLDivElement;
  w: number;
  h: number;
  x: number;
  y: number;
}

export interface BattleDriver {
  /** room.startAt 과 같은 기준의 현재 시각(ms) */
  now(): number;
  /** 낱말 선점. 내가 처음이면 true */
  claim(index: number): Promise<boolean>;
  /** 경기 시간 종료(여러 번 불려도 안전해야 함) */
  finish(): void;
  /** 매 프레임(경기 시작 기준 경과 ms) — 컴퓨터 대결의 봇 진행용 */
  onFrame?(elapsedMs: number): void;
  /** 멈추기 발동(ms 동안). 이번 판에 처음 써서 걸렸으면 true */
  freeze?(ms: number): Promise<boolean>;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
const penaltyKey = (roomId: string) => `taja.battle.penalty.${roomId}`;

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export function BattlePlay({
  room,
  schedule,
  meId,
  driver,
  title,
}: {
  room: BattleRoom;
  schedule: FallingWord[];
  meId: string;
  driver: BattleDriver;
  title?: string;
}) {
  const settings = useAuth((s) => s.settings);
  const roomRef = useRef(room);
  const driverRef = useRef(driver);
  const setRef = useRef(settings);
  useLayoutEffect(() => {
    roomRef.current = room;
    driverRef.current = driver;
    setRef.current = settings;
  }, [room, driver, settings]);

  // 멈추기(누가·남은 초)와 욕설 제재(남은 초). 제재 끝 시각은 새로 고침해도 남게 sessionStorage 에 둔다.
  const [freezeBy, setFreezeBy] = useState('');
  const [freezeLeft, setFreezeLeft] = useState(0);
  const [penaltyLeft, setPenaltyLeft] = useState(0);
  const penaltyUntil = useRef(0);
  useEffect(() => {
    try {
      penaltyUntil.current = Number(sessionStorage.getItem(penaltyKey(room.id))) || 0;
    } catch {
      penaltyUntil.current = 0;
    }
  }, [room.id]);

  const layerRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(new Set<number>()); // 내가 제출해 선점 중(또는 선점 성공)인 낱말
  const durMs = room.durationSec * 1000;

  const t0 = driver.now() - room.startAt;
  const [countdown, setCountdown] = useState(t0 < 0 ? Math.ceil(-t0 / 1000) : 0);
  const [remain, setRemain] = useState(Math.max(0, Math.ceil((durMs - Math.max(0, t0)) / 1000)));
  const [ended, setEnded] = useState(t0 >= durMs);
  const [combo, setCombo] = useState<{ n: number; id: number } | null>(null);
  const streak = useRef(0);
  // 파워게이지(오타 없이 연속으로 얻은 수)와 포인트 회수 알림
  const powerRef = useRef(0);
  const [power, setPower] = useState(0);
  const [powerFx, setPowerFx] = useState<{ by: string; mine: boolean; amount: number; id: number } | null>(null);
  const bgmOn = usePrefs((s) => s.bgm);
  const soundOn = usePrefs((s) => s.sound) && settings.soundAllowed;

  // ── 낱말 애니메이션 ──
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const els = new Map<number, WordEl>();
    let raf = 0;
    let finishCalled = false;
    const burstTimers: number[] = [];

    const burst = (rec: WordEl, word: FallingWord, by: string) => {
      const mine = by === meId;
      const name = roomRef.current.players?.[by]?.name ?? by;
      const box = document.createElement('div');
      box.className = 'pointer-events-none absolute left-0 top-0 flex flex-col items-center';
      box.style.transform = `translate3d(${rec.x}px, ${Math.max(0, rec.y - 26)}px, 0)`;
      box.style.minWidth = `${rec.w}px`;
      const tag = document.createElement('div');
      tag.className = `rounded-full px-2 py-0.5 text-xs font-bold ${mine ? 'bg-mint-500 text-white' : 'bg-white/25 text-white'}`;
      tag.textContent = mine ? `나 +${word.score}` : name;
      const txt = document.createElement('div');
      txt.className = `whitespace-nowrap text-2xl font-black ${mine ? 'text-mint-300' : 'text-white/60'}`;
      txt.textContent = word.text;
      box.append(tag, txt);
      layer.appendChild(box);
      txt.animate(
        [
          { transform: 'scale(1)', opacity: 1, filter: 'blur(0)' },
          { transform: 'scale(1.6)', opacity: 0, filter: 'blur(2px)' },
        ],
        { duration: BURST_MS, easing: 'ease-out', fill: 'forwards' },
      );
      tag.animate(
        [
          { transform: 'translateY(0)', opacity: 1 },
          { transform: 'translateY(-14px)', opacity: 1, offset: 0.7 },
          { transform: 'translateY(-18px)', opacity: 0 },
        ],
        { duration: BURST_MS, easing: 'ease-out', fill: 'forwards' },
      );
      burstTimers.push(window.setTimeout(() => box.remove(), BURST_MS + 50));
    };

    const clearWords = () => {
      for (const rec of els.values()) rec.el.remove();
      els.clear();
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const r = roomRef.current;
      const t = driverRef.current.now() - r.startAt;
      if (t >= 0 && t < durMs) driverRef.current.onFrame?.(t);

      setCountdown(t < 0 ? Math.ceil(-t / 1000) : 0);
      setRemain(Math.max(0, Math.ceil((durMs - Math.max(0, t)) / 1000)));

      const nowT = r.startAt + t;
      const af = t >= 0 && t < durMs ? activeFreeze(r.freezes, nowT) : null;
      setFreezeBy(af ? af.by : '');
      setFreezeLeft(af ? Math.ceil((af.until - nowT) / 1000) : 0);
      setPenaltyLeft(t < durMs ? Math.max(0, Math.ceil((penaltyUntil.current - Date.now()) / 1000)) : 0);

      if (t >= durMs) {
        clearWords();
        setEnded(true);
        if (!finishCalled) {
          finishCalled = true;
          driverRef.current.finish();
        }
        return;
      }

      const W = layer.clientWidth;
      const H = layer.clientHeight;
      const claims = r.claims ?? {};
      const seen = new Set<number>();
      if (t >= 0) {
        for (const w of visibleWords(schedule, t)) {
          const c = claims[String(w.index)];
          let rec = els.get(w.index);
          if (c) {
            if (rec) {
              burst(rec, w, c.by);
              rec.el.remove();
              els.delete(w.index);
            }
            continue;
          }
          seen.add(w.index);
          if (!rec) {
            const el = document.createElement('div');
            el.className = `${WORD_BASE} ${w.golden ? WORD_GOLDEN : WORD_COLOR[w.points]}`;
            el.textContent = w.text;
            if (w.bonus > 0) {
              const tag = document.createElement('span');
              tag.className = `ml-1 align-top text-xs font-black ${w.golden ? 'text-ink' : 'text-sky-300'}`;
              tag.textContent = `${fxIcons(w)}+${w.bonus}`;
              el.appendChild(tag);
            }
            if (w.blink) el.style.transition = 'none';
            layer.appendChild(el);
            rec = { el, w: el.offsetWidth, h: el.offsetHeight, x: 0, y: 0 };
            els.set(w.index, rec);
          }
          // 진행 방향 축은 0→1, 직각 축은 w.x(+흔들림)
          const p = wordY(w, t);
          const sway = wordSway(w, t) * SWAY_PX;
          if (w.dir === 'down' || w.dir === 'up') {
            rec.x = lim(w.x * W - rec.w / 2 + sway, 4, W - rec.w - 4);
            rec.y = (w.dir === 'down' ? p : 1 - p) * Math.max(0, H - rec.h);
          } else {
            rec.y = lim(w.x * H - rec.h / 2 + sway, 2, H - rec.h - 2);
            rec.x = 4 + (w.dir === 'right' ? p : 1 - p) * Math.max(0, W - rec.w - 8);
          }
          rec.el.style.transform = `translate3d(${rec.x}px, ${rec.y}px, 0)`;
          rec.el.style.opacity = String(wordAlpha(w, t) * (pendingRef.current.has(w.index) ? 0.35 : 1));
        }
      }
      // 끝에 닿은 낱말 지우기
      for (const [i, rec] of els) {
        if (!seen.has(i)) {
          rec.el.remove();
          els.delete(i);
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      burstTimers.forEach((x) => window.clearTimeout(x));
      clearWords();
      layer.replaceChildren();
    };
  }, [schedule, durMs, meId]);

  // 종료 표시가 안 되면(네트워크 오류 등) 다시 요청
  useEffect(() => {
    if (!ended || room.state !== 'playing') return;
    const id = window.setInterval(() => driverRef.current.finish(), 3000);
    return () => window.clearInterval(id);
  }, [ended, room.state]);

  // ── 제출 ──
  const onSubmit = useCallback(
    async (typed: string): Promise<SubmitResult> => {
      const r = roomRef.current;
      const t = driverRef.current.now() - r.startAt;
      if (r.state !== 'playing' || t < 0 || t >= durMs) return { kind: 'none' };
      const st = setRef.current;
      // 멈추기 문장
      if (samePhrase(typed, st.freezePhrase)) {
        if (r.freezes?.[meId]) return { kind: 'info', text: '멈추기는 한 판에 한 번만 쓸 수 있어요' };
        if (activeFreeze(r.freezes, r.startAt + t)) return { kind: 'info', text: '지금은 멈추기를 쓸 수 없어요' };
        const ok = !!driverRef.current.freeze && (await driverRef.current.freeze(clamp(st.freezeSeconds ?? 5, 1, 30) * 1000));
        if (ok) playFreeze();
        return { kind: 'info', text: ok ? '⛄ 멈추기 발동!' : '멈추기를 쓰지 못했어요' };
      }
      const taken = new Set<number>(pendingRef.current);
      for (const k of Object.keys(r.claims ?? {})) taken.add(Number(k));
      const w = matchSubmission(schedule, t, typed, taken);
      if (!w) {
        streak.current = 0;
        powerRef.current = 0;
        setPower(0);
        // 욕설이면 경고 + 입력 금지
        if (st.badWordBlock !== false && findBadWord(typed, st.badWordsExtra)) {
          const sec = clamp(st.badWordSeconds ?? 10, 1, 120);
          penaltyUntil.current = Date.now() + sec * 1000;
          try {
            sessionStorage.setItem(penaltyKey(r.id), String(penaltyUntil.current));
          } catch {
            // 무시
          }
          setPenaltyLeft(sec);
          playAlarm();
          return { kind: 'none' };
        }
        playError();
        return { kind: 'miss' };
      }
      pendingRef.current.add(w.index);
      const ok = await driverRef.current.claim(w.index);
      if (!ok) {
        pendingRef.current.delete(w.index);
        streak.current = 0;
        playLate();
        return { kind: 'late' };
      }
      streak.current += 1;
      playScore(w.points);
      if (w.bonus > 0) playBonus();
      if (streak.current >= 3) {
        setCombo({ n: streak.current, id: Date.now() });
        playCombo(streak.current);
      }
      // 파워게이지: 가득 차면 바로 포인트 회수(빈 파워 칸을 잡는다. 동시에 쓴 사람이 있으면 다음 칸)
      powerRef.current += 1;
      if (powerRef.current >= POWER_NEED) {
        powerRef.current = 0;
        const tried: Record<string, true> = {};
        for (let k = 0; k < 4; k++) {
          const idx = nextPowerIndex({ ...(roomRef.current.claims ?? {}), ...tried });
          if (await driverRef.current.claim(idx)) break;
          tried[String(idx)] = true;
        }
      }
      setPower(powerRef.current);
      return { kind: 'ok', points: w.score };
    },
    [schedule, durMs, meId],
  );

  const spaceContinues = useCallback(
    (base: string) => {
      const r = roomRef.current;
      const t = driverRef.current.now() - r.startAt;
      const s = normalizeText(base).trim().replace(/\s+/g, ' ');
      if (!s || t < 0) return false;
      const claims = r.claims ?? {};
      const vis = visibleWords(schedule, t).filter((w) => !claims[String(w.index)] && !pendingRef.current.has(w.index));
      if (vis.some((w) => w.text === s)) return false;
      if (phraseKey(setRef.current.freezePhrase ?? '').startsWith(s + ' ')) return true; // 멈추기 문장을 치는 중
      return vis.some((w) => w.text.startsWith(s + ' '));
    },
    [schedule],
  );

  useEffect(() => {
    if (!combo) return;
    const id = window.setTimeout(() => setCombo(null), 1200);
    return () => window.clearTimeout(id);
  }, [combo]);

  // ── 포인트 회수 알림: claims 에 새 파워 칸이 생기면 한 번씩 ──
  const seenPower = useRef<Set<string> | null>(null);
  useEffect(() => {
    const keys = Object.keys(room.claims ?? {}).filter((k) => isPowerIndex(Number(k)));
    if (!seenPower.current) {
      seenPower.current = new Set(keys); // 들어올 때 이미 있던 것은 알리지 않음
      return;
    }
    for (const k of keys) {
      if (seenPower.current.has(k)) continue;
      seenPower.current.add(k);
      const by = room.claims[k]?.by ?? '';
      const rest = { ...room.claims };
      delete rest[k];
      const score = (claims: BattleRoom['claims']) => rankPlayers({ ...room, claims }, schedule).find((r) => r.id === meId)?.score ?? 0;
      const amount = Math.abs(score(room.claims) - score(rest));
      setPowerFx({ by, mine: by === meId, amount, id: Date.now() });
      playPower(by === meId);
    }
  }, [room, schedule, meId]);
  useEffect(() => {
    if (!powerFx) return;
    const id = window.setTimeout(() => setPowerFx(null), POWER_FX_MS);
    return () => window.clearTimeout(id);
  }, [powerFx]);

  // ── 점수판 ──
  const ranks = useMemo(() => rankPlayers(room, schedule), [room, schedule]);
  const mine = ranks.find((r) => r.id === meId);
  const last = !ended && countdown === 0 && remain <= LAST_SEC;
  const active = !ended && countdown === 0;
  const frozen = active && !!freezeBy && freezeBy !== meId; // 남이 건 멈추기
  const punished = active && penaltyLeft > 0;
  const canType = active && !frozen && !punished;
  const freezerName = room.players?.[freezeBy]?.name ?? freezeBy;
  useEffect(() => {
    if (frozen) playFreeze();
  }, [frozen]);

  // ── 배경음: 경기 중에만, 마지막 20초는 빠르게 ──
  useEffect(() => {
    if (!active || !bgmOn || !soundOn) return;
    startBgm();
    return () => stopBgm();
  }, [active, bgmOn, soundOn]);
  useEffect(() => {
    setBgmFast(last);
  }, [last]);

  // ── 효과음: 카운트다운·시작·마지막 20초·마지막 5초·종료 (값이 바뀌는 순간에만) ──
  const snd = useRef({ countdown, remain, last, ended });
  useEffect(() => {
    const p = snd.current;
    if (countdown !== p.countdown) {
      if (countdown > 0) playTick();
      else if (!ended) playStart();
    }
    if (last && !p.last) playWarn();
    if (active && remain !== p.remain && remain > 0 && remain <= 5) playTick(true);
    if (ended && !p.ended) playEnd();
    snd.current = { countdown, remain, last, ended };
  }, [countdown, remain, last, ended, active]);

  return (
    <div className="flex h-full bg-ink text-white">
      <div className={`flex min-w-0 flex-1 flex-col transition-colors duration-700 ${last ? 'bg-miss/20' : ''}`}>
        <div className="flex h-14 shrink-0 items-center justify-between px-6">
          <div className="text-sm text-white/50">{title ?? `⚔️ 배틀 · ${LANG_LABEL[room.lang]}`}</div>
          <div className={`text-3xl font-black tabular-nums ${last ? 'animate-pulse text-miss' : ''}`}>
            {countdown > 0 ? mmss(room.durationSec) : mmss(remain)}
          </div>
          <div className="flex items-center gap-3 text-sm">
            {soundEnabled() && (
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => usePrefs.getState().set({ bgm: !bgmOn })}
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${bgmOn ? 'bg-mint-500 text-white' : 'bg-white/10 text-white/50'}`}
                title="배경음 켜기/끄기"
              >
                🎵 배경음 {bgmOn ? '켬' : '끔'}
              </button>
            )}
            <span>
              내 점수 <b className="text-2xl tabular-nums text-gold">{mine?.score ?? 0}</b>
            </span>
          </div>
        </div>

        <div className={`relative min-h-0 flex-1 overflow-hidden border-2 border-miss/40 transition-colors duration-700 ${last ? 'bg-miss/10' : 'bg-white/[0.03]'}`}>
          <div ref={layerRef} className="absolute inset-0" />
          {countdown > 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-ink/60">
              <div className="text-lg text-white/70">곧 시작해요! 입력창에 손을 올리세요</div>
              <div key={countdown} className="anim-pop mt-2 text-9xl font-black text-gold tabular-nums">
                {countdown}
              </div>
            </div>
          )}
          {ended && (
            <div className="absolute inset-0 flex items-center justify-center bg-ink/70">
              <div className="anim-pop text-6xl font-black">경기 종료!</div>
            </div>
          )}
          {frozen && !punished && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-sky-950/70 text-center backdrop-blur-[2px]">
              <div className="text-7xl">⛄</div>
              <div className="mt-2 text-5xl font-black text-sky-200">멈춤!</div>
              <div className="mt-3 text-xl font-bold">{freezerName} 님이 멈추기를 썼어요</div>
              <div className="mt-1 text-lg text-white/80">
                <b className="text-3xl tabular-nums text-gold">{freezeLeft}</b>초 뒤에 다시 칠 수 있어요
              </div>
            </div>
          )}
          {active && freezeBy === meId && !punished && (
            <div className="pointer-events-none absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-sky-400 px-5 py-1.5 text-lg font-black text-ink">
              ⛄ 멈추기 발동! {freezeLeft}초 동안 나만 칠 수 있어요
            </div>
          )}
          {punished && (
            <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center bg-miss/95 p-6 text-center">
              <div className="text-7xl">🚫</div>
              <div className="mt-2 text-5xl font-black">욕설·비속어 금지!</div>
              <div className="mt-4 text-xl font-bold">배틀에서 욕설이나 나쁜 말은 절대 쓸 수 없습니다.</div>
              <div className="mt-1 text-lg">친구를 존중하는 바르고 고운 말만 써 주세요.</div>
              <div className="mt-5 rounded-2xl bg-black/30 px-6 py-3 text-lg">
                <b className="text-4xl tabular-nums text-gold">{penaltyLeft}</b>초 동안 입력할 수 없습니다
              </div>
            </div>
          )}
          {combo && (
            <div key={combo.id} className="anim-pop pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 rounded-full bg-gold px-5 py-1.5 text-lg font-black text-ink">
              연속 획득! ×{combo.n}
            </div>
          )}
          {powerFx && active && (
            <div
              key={powerFx.id}
              className={`anim-pop pointer-events-none absolute inset-x-0 top-1/3 mx-auto w-fit rounded-3xl px-8 py-4 text-center shadow-2xl ${
                powerFx.mine ? 'bg-gold text-ink' : 'bg-miss text-white'
              }`}
            >
              <div className="text-4xl font-black">⚡ 포인트 회수!</div>
              <div className="mt-1 text-lg font-bold">
                {powerFx.mine
                  ? `모두에게서 +${powerFx.amount}점을 가져왔어요`
                  : `${room.players?.[powerFx.by]?.name ?? powerFx.by} 님에게 ${powerFx.amount}점을 빼앗겼어요`}
              </div>
            </div>
          )}
          <div className="pointer-events-none absolute bottom-1 right-3 text-xs text-white/25">낱말은 사방에서 날아와요</div>
        </div>

        <div className="flex h-8 shrink-0 items-center gap-3 px-6" aria-label={`파워게이지 ${power} / ${POWER_NEED}`}>
          <div className={`w-28 text-xs font-bold ${power >= POWER_NEED - 5 ? 'text-gold' : 'text-white/60'}`}>
            ⚡ 파워 {power}/{POWER_NEED}
          </div>
          <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-all duration-200 ${power >= POWER_NEED - 5 ? 'animate-pulse bg-gold' : 'bg-mint-500'}`}
              style={{ width: `${(power / POWER_NEED) * 100}%` }}
            />
          </div>
          <div className="text-[11px] text-white/40">오타 없이 연속 {POWER_NEED}개 → 상대 점수 절반 회수</div>
        </div>

        <BattleInput
          active={canType}
          onSubmit={onSubmit}
          spaceContinues={spaceContinues}
          blockedText={punished ? `🚫 욕설 금지 · ${penaltyLeft}초 동안 입력할 수 없어요` : frozen ? `⛄ 멈춤 · ${freezeLeft}초 뒤에 칠 수 있어요` : undefined}
        />
      </div>

      <aside className="flex w-72 shrink-0 flex-col bg-black/20 p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <div className="font-bold">순위</div>
          <div className="text-xs text-white/40">{room.startCount}명</div>
        </div>
        <ol className="min-h-0 flex-1 space-y-1 overflow-hidden">
          {ranks.map((r) => {
            const me = r.id === meId;
            // 나는 지금 이 화면에 있으므로 흐리게 하지 않는다(새로 고침 뒤 online=false 로 남는 경우 포함)
            const off = !me && (room.players?.[r.id]?.online === false || !room.players?.[r.id]);
            return (
              <li
                key={r.id}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-1 text-sm transition ${
                  me ? 'bg-mint-500 font-bold text-white' : 'bg-white/5'
                } ${off ? 'opacity-40' : ''}`}
                title={off ? '접속 끊김' : undefined}
              >
                <span className="w-5 text-right tabular-nums text-white/60">{r.place}</span>
                <span className="min-w-0 flex-1 truncate">
                  {r.name}
                  {me ? ' (나)' : ''}
                </span>
                <span className="tabular-nums font-bold">{r.score}</span>
              </li>
            );
          })}
        </ol>
        <div className="mt-3 rounded-xl bg-white/5 p-3 text-center">
          <div className="text-xs text-white/50">내 점수 · 낱말 {mine?.words ?? 0}개</div>
          <div className="text-4xl font-black tabular-nums text-gold">{mine?.score ?? 0}</div>
          <div className="mt-1 text-[11px] text-white/40">
            <span className="text-white/45">■ 1점</span> <span className="text-white">■ 2점</span> <span className="text-gold">■ 4점</span>
          </div>
          <div className="mt-0.5 text-[11px] text-sky-300/80">⚡빠름 +1 · 👻깜빡 +2 · 🌀흔들 +1 · ★황금 2배</div>
        </div>
      </aside>
    </div>
  );
}
