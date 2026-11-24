// 학생이름 외우기 게임 화면. <NamePlay students mode speed seed onEnd />
//   - 사진 카드가 위에서 아래로만 떨어진다(칸마다 한 장, 동시에 3~4장). requestAnimationFrame + 경과 시간(dt 상한).
//   - 아래 입력창에 이름을 다 치면 자동으로 맞춤, Enter 로도 확인. 맞는 카드가 없으면 흔들고 비운다(오답 +1).
//   - 바닥에 닿으면 "놓침": 이름을 크게 보여 준 뒤 사라지고, 조금 뒤 다시 나온다(맞출 때까지).
//   - Esc = 일시정지(계속 / 그만두기). 탭이 숨겨지면 자동 일시정지.
//   - 화면에 떠 있는 카드만 object URL 을 만들고, 사라지면 revoke 한다.
//   onEnd(result: NameGameResult)  모두 맞췄거나 그만두었을 때
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { RosterStudent } from '../../roster/types';
import {
  blameCard,
  canAutoMatch,
  chooseLane,
  classLabel,
  createDeck,
  drawNext,
  findMatch,
  isFinished,
  markSolved,
  maskName,
  pointsFor,
  requeueMissed,
  studentKey,
  DT_MAX_MS,
  FALL_MS,
  HIT_SHOW_MS,
  LANE_COUNT,
  MAX_ON_SCREEN,
  MISS_SHOW_MS,
  SPAWN_GAP_MS,
  type Deck,
  type NameMode,
  type Speed,
} from '../../roster/game';
import { mulberry32 } from '../../engine/rng';
import { fmtTime, PauseModal, useShake, useWindowKey } from '../PracticeParts';
import { playDone, playError, playKey } from '../sound';
import { Kbd } from '../ui';

export interface NameGameResult {
  total: number;
  solved: number;
  missed: number;
  wrong: number;
  score: number;
  bestCombo: number;
  ms: number;
  /** 놓쳤거나 오답 뒤에 맞춘 학생 키 */
  confused: string[];
  quit: boolean;
}

interface LiveCard {
  id: number;
  key: string;
  student: RosterStudent;
  url: string;
  lane: number;
  spawnAt: number;
  progress: number;
  state: 'fall' | 'hit' | 'miss';
  endAt: number;
}

interface Hud {
  solved: number;
  missed: number;
  combo: number;
  score: number;
  sec: number;
}

export default function NamePlay({
  students,
  mode,
  speed,
  seed,
  onEnd,
}: {
  students: RosterStudent[];
  mode: NameMode;
  speed: Speed;
  seed: number;
  onEnd: (r: NameGameResult) => void;
}) {
  // 처음 한 번만 만든다
  const [init] = useState(() => {
    const map = new Map(students.map((s) => [studentKey(s), s]));
    const rand = mulberry32(seed);
    return { map, rand, deck: createDeck([...map.keys()], rand) };
  });
  const byKey = useRef(init.map);
  const randRef = useRef(init.rand);
  const deckRef = useRef<Deck>(init.deck);
  const cardsRef = useRef<LiveCard[]>([]);
  const elRef = useRef(new Map<number, HTMLDivElement>());
  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const gameMs = useRef(0);
  const lastSpawn = useRef(-Infinity);
  const lastLane = useRef<number | null>(null);
  const nextId = useRef(1);
  const stats = useRef({ solved: 0, missed: 0, wrong: 0, combo: 0, bestCombo: 0, score: 0 });
  const confused = useRef(new Set<string>());
  const pausedRef = useRef(false);
  const endedRef = useRef(false);
  const lastHit = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [paused, setPaused] = useState(false);
  const [hud, setHud] = useState<Hud>({ solved: 0, missed: 0, combo: 0, score: 0, sec: 0 });
  const [wrongTick, setWrongTick] = useState(0);
  const shaking = useShake(wrongTick);
  const total = byKey.current.size;

  const syncHud = useCallback(() => {
    const s = stats.current;
    setHud({ solved: s.solved, missed: s.missed, combo: s.combo, score: s.score, sec: Math.floor(gameMs.current / 1000) });
  }, []);

  const finish = useCallback((quit: boolean) => {
    if (endedRef.current) return;
    endedRef.current = true;
    const s = stats.current;
    onEndRef.current({
      total,
      solved: s.solved,
      missed: s.missed,
      wrong: s.wrong,
      score: s.score,
      bestCombo: s.bestCombo,
      ms: gameMs.current,
      confused: [...confused.current],
      quit,
    });
  }, [total]);

  // 한 프레임 진행. 카드 목록이 바뀌었으면 true
  const step = useCallback(() => {
    const now = gameMs.current;
    const fall = FALL_MS[speed];
    let changed = false;
    const keep: LiveCard[] = [];
    for (const c of cardsRef.current) {
      if (c.state === 'fall') {
        c.progress = Math.min(1, (now - c.spawnAt) / fall);
        if (c.progress >= 1) {
          c.state = 'miss';
          c.endAt = now + MISS_SHOW_MS;
          const s = stats.current;
          s.missed++;
          s.combo = 0;
          confused.current.add(c.key);
          playError();
          changed = true;
        }
      } else if (now >= c.endAt) {
        URL.revokeObjectURL(c.url);
        elRef.current.delete(c.id);
        if (c.state === 'miss') deckRef.current = requeueMissed(deckRef.current, c.key);
        changed = true;
        continue;
      }
      keep.push(c);
    }
    cardsRef.current = keep;

    // 새 카드
    const falling = keep.filter((c) => c.state === 'fall').length;
    if (falling < MAX_ON_SCREEN[speed] && keep.length < LANE_COUNT && (falling === 0 || now - lastSpawn.current >= SPAWN_GAP_MS[speed])) {
      const lane = chooseLane(keep.map((c) => c.lane), randRef.current, lastLane.current);
      if (lane !== null) {
        const r = drawNext(deckRef.current, keep.map((c) => c.key));
        const st = r.key ? byKey.current.get(r.key) : undefined;
        if (r.key && st?.photo) {
          deckRef.current = r.deck;
          keep.push({
            id: nextId.current++,
            key: r.key,
            student: st,
            url: URL.createObjectURL(st.photo),
            lane,
            spawnAt: now,
            progress: 0,
            state: 'fall',
            endAt: 0,
          });
          lastSpawn.current = now;
          lastLane.current = lane;
          changed = true;
        }
      }
    }

    if (isFinished(deckRef.current) && keep.length === 0) finish(false);
    return changed;
  }, [speed, finish]);

  // 카드 위치: 위쪽 밖(-높이)에서 바닥(필드 높이 - 카드 높이)까지
  const place = useCallback(() => {
    const h = fieldRef.current?.clientHeight ?? 0;
    for (const c of cardsRef.current) {
      const el = elRef.current.get(c.id);
      if (!el) continue;
      const ch = el.offsetHeight;
      el.style.transform = `translateY(${-ch + c.progress * h}px)`;
    }
  }, []);

  // 메인 루프
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastSec = -1;
    const frame = (t: number) => {
      const dt = Math.min(DT_MAX_MS, Math.max(0, t - last));
      last = t;
      if (!pausedRef.current && !endedRef.current) {
        gameMs.current += dt;
        if (step()) {
          rerender();
          syncHud();
        }
        const sec = Math.floor(gameMs.current / 1000);
        if (sec !== lastSec) {
          lastSec = sec;
          syncHud();
        }
        place();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [step, place, syncHud]);

  // 새로 그린 카드도 첫 프레임부터 제자리에
  useLayoutEffect(() => place());

  // 끝날 때 남은 URL 정리
  useEffect(() => {
    const els = elRef.current;
    return () => {
      for (const c of cardsRef.current) URL.revokeObjectURL(c.url);
      cardsRef.current = [];
      els.clear();
    };
  }, []);

  const pause = useCallback((on: boolean) => {
    pausedRef.current = on;
    setPaused(on);
    if (!on) requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useWindowKey((e) => {
    if (e.key === 'Escape' && !pausedRef.current) {
      e.preventDefault();
      pause(true);
    }
  }, !paused);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden && !endedRef.current) pause(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [pause]);

  // ── 입력 ──
  const clearInput = useCallback((duringComposition: boolean) => {
    const el = inputRef.current;
    if (!el) return;
    if (duringComposition) {
      // 조합 중에 값을 지우면 브라우저가 글자를 되살리는 경우가 있어 포커스를 잠깐 뺐다가 돌려준다
      el.blur();
      el.value = '';
      composingRef.current = false;
      requestAnimationFrame(() => {
        el.value = '';
        el.focus();
      });
    } else el.value = '';
  }, []);

  const fallingCards = () => cardsRef.current.filter((c) => c.state === 'fall');
  const matchCards = () => fallingCards().map((c) => ({ id: c.id, name: c.student.name, progress: c.progress }));

  const hit = useCallback((typed: string, duringComposition: boolean): boolean => {
    const id = findMatch(matchCards(), typed);
    const c = cardsRef.current.find((x) => x.id === id);
    if (!c) return false;
    c.state = 'hit';
    c.endAt = gameMs.current + HIT_SHOW_MS;
    deckRef.current = markSolved(deckRef.current, c.key);
    const s = stats.current;
    s.solved++;
    s.combo++;
    s.bestCombo = Math.max(s.bestCombo, s.combo);
    s.score += pointsFor(s.combo);
    lastHit.current = { text: typed, at: performance.now() };
    playDone();
    clearInput(duringComposition);
    rerender();
    syncHud();
    return true;
  }, [clearInput, syncHud]);

  const wrong = useCallback((typed: string) => {
    const s = stats.current;
    s.wrong++;
    s.combo = 0;
    const id = blameCard(matchCards(), typed);
    const c = cardsRef.current.find((x) => x.id === id);
    if (c) confused.current.add(c.key);
    playError();
    setWrongTick((n) => n + 1);
    clearInput(false);
    syncHud();
  }, [clearInput, syncHud]);

  const check = useCallback((v: string, composing: boolean) => {
    if (pausedRef.current || endedRef.current) return;
    const names = fallingCards().map((c) => c.student.name);
    if (canAutoMatch(v, composing, names)) hit(v, composing);
  }, [hit]);

  const submit = useCallback((v: string) => {
    if (pausedRef.current || endedRef.current) return;
    if (v.trim() === '') return;
    if (!hit(v, false)) wrong(v);
  }, [hit, wrong]);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    if (pausedRef.current) {
      el.value = '';
      return;
    }
    // 맞춘 직후 조합이 확정되며 같은 글이 다시 들어오는 경우는 버린다
    const lh = lastHit.current;
    if (lh.text && el.value === lh.text && performance.now() - lh.at < 300) {
      el.value = '';
      return;
    }
    if (el.value.length > 0) playKey();
    check(el.value, composingRef.current || (e.nativeEvent as InputEvent).isComposing === true);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' && e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
    e.preventDefault();
    if (e.repeat) return;
    if (e.nativeEvent.isComposing || e.keyCode === 229 || composingRef.current) {
      // 조합이 끝난 값으로 판정
      let tries = 0;
      const later = () => {
        if (composingRef.current && tries++ < 6) return void requestAnimationFrame(later);
        submit(inputRef.current?.value ?? '');
      };
      requestAnimationFrame(later);
      return;
    }
    submit(e.currentTarget.value);
  };

  const block = (e: { preventDefault: () => void }) => e.preventDefault();

  const cards = cardsRef.current;
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <style>{`
        @keyframes nameHit { 0% { transform: scale(1); opacity: 1; filter: brightness(1) } 40% { transform: scale(1.12); filter: brightness(1.6) } 100% { transform: scale(0.6); opacity: 0 } }
        .name-hit { animation: nameHit ${HIT_SHOW_MS}ms ease-out forwards; }
      `}</style>

      {/* 위쪽 진행 */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl bg-white px-4 py-2 text-sm shadow-sm">
        <span>
          진행 <b className="text-lg tabular-nums">{hud.solved}</b>
          <span className="text-ink/50"> / {total}</span>
        </span>
        <span>
          놓침 <b className="tabular-nums text-miss">{hud.missed}</b>
        </span>
        <span>
          연속 <b className="tabular-nums text-mint-600">{hud.combo}</b>
        </span>
        <span>
          점수 <b className="tabular-nums">{hud.score}</b>
        </span>
        <span>
          시간 <b className="tabular-nums">{fmtTime(hud.sec)}</b>
        </span>
        <span className="ml-auto text-xs text-ink/50">
          <Kbd>Esc</Kbd> 일시정지
        </span>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-mint-100">
          <div className="h-full bg-mint-500 transition-all" style={{ width: `${total ? (hud.solved / total) * 100 : 0}%` }} />
        </div>
      </div>

      {/* 카드가 떨어지는 곳 */}
      <div ref={fieldRef} className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border-b-4 border-miss/40 bg-mint-50">
        {cards.map((c) => {
          const label = c.state === 'fall' ? maskName(c.student.name, mode) : c.student.name;
          return (
            <div
              key={c.id}
              ref={(el) => {
                if (el) elRef.current.set(c.id, el);
              }}
              className="absolute top-0 flex justify-center will-change-transform"
              style={{ left: `${(c.lane * 100) / LANE_COUNT}%`, width: `${100 / LANE_COUNT}%`, transform: 'translateY(-100%)' }}
            >
              <div
                className={`relative w-[110px] max-w-[calc(100%-8px)] rounded-xl bg-white p-1.5 shadow-md ${
                  c.state === 'hit' ? 'name-hit ring-4 ring-gold' : c.state === 'miss' ? 'ring-4 ring-miss' : ''
                }`}
              >
                <img src={c.url} alt="" draggable={false} className="aspect-[3/4] w-full rounded-lg object-cover" />
                <div className={`mt-1 truncate text-center font-bold ${label ? '' : 'text-ink/30'}`}>{label || '???'}</div>
                <div className="text-center text-[11px] text-ink/50">{classLabel(c.student)}</div>
                {c.state === 'miss' && (
                  <div className="anim-pop absolute inset-x-[-12px] top-1/3 rounded-xl bg-miss px-2 py-2 text-center text-2xl font-black text-white shadow-lg">
                    {c.student.name}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {cards.length === 0 && !paused && <div className="flex h-full items-center justify-center text-ink/40">곧 사진이 내려와요</div>}
      </div>

      {/* 입력창 */}
      <div className="flex flex-col items-center gap-1 pb-1">
        <input
          ref={inputRef}
          autoFocus
          className={`w-full max-w-sm rounded-2xl border-2 border-mint-300 bg-white px-4 py-3 text-center text-2xl font-bold outline-none focus:border-mint-500 ${
            shaking ? 'anim-shake border-miss' : ''
          }`}
          placeholder="이름을 치세요"
          aria-label="학생 이름 입력"
          onChange={onChange}
          onKeyDown={onKeyDown}
          onCompositionStart={() => (composingRef.current = true)}
          onCompositionEnd={(e) => {
            composingRef.current = false;
            const v = e.currentTarget.value;
            const lh = lastHit.current;
            if (lh.text && v === lh.text && performance.now() - lh.at < 300) {
              e.currentTarget.value = '';
              return;
            }
            check(v, false);
          }}
          onPaste={block}
          onDrop={block}
          onDragOver={block}
          onCut={block}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          readOnly={paused}
        />
        <div className="text-xs text-ink/50">
          이름을 다 치면 자동으로 맞춰요 · <Kbd>Enter</Kbd> 확인
        </div>
      </div>

      {paused && <PauseModal onResume={() => pause(false)} onQuit={() => finish(true)} />}
    </div>
  );
}
