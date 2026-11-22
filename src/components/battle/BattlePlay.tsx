// 배틀 경기 화면. <BattlePlay room schedule meId driver title? />
//   interface BattleDriver { now(): number; claim(index): Promise<boolean>; finish(): void; onFrame?(elapsedMs): void }
//     친구 배틀은 서버(serverNow·claimWord·finishRoom), 컴퓨터 대결은 로컬 상태로 구현해 넘긴다.
// - startAt 전 5초 카운트다운 → durationSec 동안 경기 → 시간이 다 되면 driver.finish()(상태가 그대로면 3초마다 다시).
// - 낱말 DOM 은 React 밖에서 만들고 requestAnimationFrame 으로 transform 만 바꾼다(리렌더 최소화).
// - claims 에 들어온 낱말은 숨기고, 그 자리에 선점자 이름표 + 터지는 효과(0.6초). 내가 얻으면 +점수.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BattleRoom } from '../../data/types';
import { matchSubmission, visibleWords, wordY, type FallingWord } from '../../engine/battle';
import { normalizeText } from '../../engine/hangul';
import { rankPlayers } from '../../engine/scoring';
import { BattleInput, type SubmitResult } from './BattleInput';
import { LANG_LABEL } from './battleUtil';
import { playCombo, playEnd, playError, playLate, playScore, playStart, playTick, playWarn } from '../sound';

const WORD_BASE =
  'absolute left-0 top-0 whitespace-nowrap rounded-lg px-2 py-0.5 text-2xl font-bold will-change-transform select-none transition-opacity';
const WORD_COLOR: Record<1 | 2 | 4, string> = {
  1: 'text-white/45',
  2: 'text-white',
  4: 'text-gold drop-shadow-[0_0_6px_var(--color-gold)]',
};
const BURST_MS = 600;
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
}

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
  const roomRef = useRef(room);
  const driverRef = useRef(driver);
  useLayoutEffect(() => {
    roomRef.current = room;
    driverRef.current = driver;
  }, [room, driver]);

  const layerRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(new Set<number>()); // 내가 제출해 선점 중(또는 선점 성공)인 낱말
  const durMs = room.durationSec * 1000;

  const t0 = driver.now() - room.startAt;
  const [countdown, setCountdown] = useState(t0 < 0 ? Math.ceil(-t0 / 1000) : 0);
  const [remain, setRemain] = useState(Math.max(0, Math.ceil((durMs - Math.max(0, t0)) / 1000)));
  const [ended, setEnded] = useState(t0 >= durMs);
  const [combo, setCombo] = useState<{ n: number; id: number } | null>(null);
  const streak = useRef(0);

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
      tag.textContent = mine ? `나 +${word.points}` : name;
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
            el.className = `${WORD_BASE} ${WORD_COLOR[w.points]}`;
            el.textContent = w.text;
            layer.appendChild(el);
            rec = { el, w: el.offsetWidth, h: el.offsetHeight, x: 0, y: 0 };
            els.set(w.index, rec);
          }
          rec.x = Math.max(4, Math.min(W - rec.w - 4, w.x * W - rec.w / 2));
          rec.y = wordY(w, t) * Math.max(0, H - rec.h);
          rec.el.style.transform = `translate3d(${rec.x}px, ${rec.y}px, 0)`;
          rec.el.style.opacity = pendingRef.current.has(w.index) ? '0.35' : '1';
        }
      }
      // 바닥에 닿은 낱말 지우기
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
      const taken = new Set<number>(pendingRef.current);
      for (const k of Object.keys(r.claims ?? {})) taken.add(Number(k));
      const w = matchSubmission(schedule, t, typed, taken);
      if (!w) {
        streak.current = 0;
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
      if (streak.current >= 3) {
        setCombo({ n: streak.current, id: Date.now() });
        playCombo(streak.current);
      }
      return { kind: 'ok', points: w.points };
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
      return vis.some((w) => w.text.startsWith(s + ' '));
    },
    [schedule],
  );

  useEffect(() => {
    if (!combo) return;
    const id = window.setTimeout(() => setCombo(null), 1200);
    return () => window.clearTimeout(id);
  }, [combo]);

  // ── 점수판 ──
  const ranks = useMemo(() => rankPlayers(room, schedule), [room, schedule]);
  const mine = ranks.find((r) => r.id === meId);
  const last = !ended && countdown === 0 && remain <= LAST_SEC;
  const active = !ended && countdown === 0;

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
          <div className="text-sm">
            내 점수 <b className="text-2xl tabular-nums text-gold">{mine?.score ?? 0}</b>
          </div>
        </div>

        <div className={`relative min-h-0 flex-1 overflow-hidden border-b-2 border-miss/50 transition-colors duration-700 ${last ? 'bg-miss/10' : 'bg-white/[0.03]'}`}>
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
          {combo && (
            <div key={combo.id} className="anim-pop pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 rounded-full bg-gold px-5 py-1.5 text-lg font-black text-ink">
              연속 획득! ×{combo.n}
            </div>
          )}
          <div className="pointer-events-none absolute bottom-1 right-3 text-xs text-white/25">바닥</div>
        </div>

        <BattleInput active={active} onSubmit={onSubmit} spaceContinues={spaceContinues} />
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
        </div>
      </aside>
    </div>
  );
}
