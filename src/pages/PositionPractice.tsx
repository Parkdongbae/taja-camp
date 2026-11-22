// 자리연습(docs/02 4.4). 경로 /position/:stageId?kind=learn|mix|review
//   kind 가 없으면 stageDrill 에 따라 learn → mix. review 는 location.state.focusCodes 또는 내 약점 글쇠.
//   판정: window keydown 의 e.code + e.shiftKey(matchesTarget). 틀리면 그 문항에 머문다(문항당 오타 최대 3회 집계).
//   Esc 일시정지 · 창을 떠나면 자동 일시정지 · 10초 입력이 없으면 시간 정지.
//   끝나면 finishSession(mode 'position') + stageDrill(learn 1, mix 2) 갱신 후 결과 창.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { backend } from '../data';
import { KEYBOARD_LABEL, type KeyboardKind } from '../data/types';
import { useAuth } from '../state/auth';
import { usePrefs } from '../state/prefs';
import { finishSession, type FinishResult } from '../state/record';
import { FINGER_LABEL, keyByCode, shiftFingerFor, type KeyTarget } from '../engine/layout';
import { DRILL_COUNTS, getStage, isStagePassed, isStageUnlocked, makeDrill, matchesTarget } from '../engine/stages';
import { TypingMeter, type MeterSnapshot } from '../engine/judge';
import VirtualKeyboard from '../components/VirtualKeyboard';
import { Btn, Kbd, Modal } from '../components/ui';
import { codeLabel, groupLang, groupOf, setNeedsReview, StageTrail, stageNo, topCodes } from './PositionMap';

type Kind = 'learn' | 'mix' | 'review';
const KIND_LABEL: Record<Kind, string> = { learn: '① 글쇠 익히기', mix: '② 섞어 치기', review: '틀린 글쇠 복습' };
const MAX_TYPOS_PER_ITEM = 3;
const IDLE_MS = 10_000;

// 판정하지 않는 글쇠(수정키·한/영 등)
const IGNORE = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'CapsLock',
  'Tab',
  'Lang1',
  'Lang2',
  'HangulMode',
  'Hanja',
  'ContextMenu',
  'Fn',
]);

/** 이 글쇠를 판정에 쓰는가(문자·숫자·기호·Space·Enter). */
export function isJudgeable(code: string): boolean {
  if (IGNORE.has(code)) return false;
  const k = keyByCode(code);
  return !!k && k.en !== '';
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

interface Run {
  idx: number;
  itemTypos: number;
  phase: 'run' | 'paused' | 'done';
  finishing: boolean;
}

interface Result {
  snap: MeterSnapshot;
  fin: FinishResult | null;
  blind: boolean;
  saved: boolean;
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      onMouseUp={(e) => e.currentTarget.blur()}
      className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-mint-50"
    >
      <span>{children}</span>
      <span className={`relative h-5 w-9 rounded-full transition ${on ? 'bg-mint-500' : 'bg-ink/20'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-4.5' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

export default function PositionPractice() {
  const { stageId = '' } = useParams();
  const [params] = useSearchParams();
  const loc = useLocation();
  const nav = useNavigate();
  const student = useAuth((s) => s.student);
  const prefs = usePrefs();
  const stage = getStage(stageId);

  const kindParam = params.get('kind');
  const drillDone = student?.stageDrill[stageId] ?? 0;
  // 주소에 kind 가 없을 때의 기본값은 들어올 때 한 번만 정한다(연습을 마쳐 stageDrill 이 바뀌어도 제목이 바뀌지 않게).
  const [defaultKind, setDefaultKind] = useState<{ stageId: string; kind: Kind }>(() => ({ stageId, kind: drillDone >= 1 ? 'mix' : 'learn' }));
  if (defaultKind.stageId !== stageId) setDefaultKind({ stageId, kind: drillDone >= 1 ? 'mix' : 'learn' });
  const kind: Kind = kindParam === 'learn' || kindParam === 'mix' || kindParam === 'review' ? kindParam : defaultKind.kind;

  // 복습 글쇠: 넘겨받은 것 → 내 약점 글쇠(이 단계까지의 글쇠 중)
  const focusCodes = useMemo(() => {
    if (kind !== 'review' || !stage) return undefined;
    const given = (loc.state as { focusCodes?: string[] } | null)?.focusCodes;
    if (given?.length) return given;
    const inStage = new Set(stage.allKeys.map((k) => k.code));
    const weak = Object.fromEntries(Object.entries(student?.weakKeys ?? {}).filter(([c]) => inStage.has(c)));
    return topCodes(weak, 5);
  }, [kind, stage, loc.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const [runNo, setRunNo] = useState(0);
  const items = useMemo<KeyTarget[]>(
    () => (stage ? makeDrill(stage.id, kind, DRILL_COUNTS[kind], Math.random, focusCodes) : []),
    [stage, kind, focusCodes, runNo],
  );

  const meterRef = useRef(new TypingMeter());
  const run = useRef<Run>({ idx: 0, itemTypos: 0, phase: 'run', finishing: false });
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [wrong, setWrong] = useState<{ code: string | null; n: number }>({ code: null, n: 0 });
  const [pressed, setPressed] = useState<string | null>(null);
  const [hint, setHint] = useState('');
  const [shake, setShake] = useState(0);
  const [result, setResult] = useState<Result | null>(null);

  // 새 판 시작
  useEffect(() => {
    meterRef.current = new TypingMeter();
    run.current = { idx: 0, itemTypos: 0, phase: 'run', finishing: false };
    setResult(null);
    setHint('');
    rerender();
  }, [items]);

  const group = stage ? groupOf(stage) : 'ko';
  const lang = groupLang(group);
  const allowed = !!stage && !!student && (isStageUnlocked(student.position, stage.id) || isStagePassed(student.position, stage.id));

  const finish = useCallback(async () => {
    if (!stage || run.current.finishing) return;
    run.current.finishing = true;
    run.current.phase = 'done';
    const snap = meterRef.current.snapshot(performance.now());
    const blind = !usePrefs.getState().showKeyboard;
    setResult({ snap, fin: null, blind, saved: false });
    let fin: FinishResult | null = null;
    try {
      fin = await finishSession({
        mode: 'position',
        lang,
        stageId: stage.id,
        kpm: snap.kpm,
        accuracy: snap.accuracy,
        typos: snap.typos,
        strokes: snap.strokes,
        seconds: snap.seconds,
        missKeys: snap.missKeys,
      });
      const me = useAuth.getState().student;
      if (me && kind !== 'review') {
        const before = me.stageDrill[stage.id] ?? 0;
        const after = Math.max(before, kind === 'learn' ? 1 : 2);
        if (after !== before) await backend.updateStudent(me.id, { stageDrill: { ...me.stageDrill, [stage.id]: after } });
      }
      if (kind === 'review') setNeedsReview(stage.id, false);
    } catch (e) {
      console.error(e);
    }
    setResult({ snap, fin, blind, saved: true });
  }, [stage, lang, kind]);

  const pause = useCallback(() => {
    if (run.current.phase !== 'run') return;
    meterRef.current.pause(performance.now());
    run.current.phase = 'paused';
    rerender();
  }, []);
  const resume = useCallback(() => {
    if (run.current.phase !== 'paused') return;
    meterRef.current.resume(performance.now());
    run.current.phase = 'run';
    rerender();
  }, []);

  const backToMap = useCallback(() => nav(group === 'en' ? '/position?track=en' : '/position'), [nav, group]);

  // 결과 창 다음 단계
  const passedStage = !!student && !!stage && isStagePassed(student.position, stage.id);
  const drillNow = Math.max(drillDone, kind === 'learn' ? 1 : kind === 'mix' ? 2 : 0);
  const next: { label: string; go: () => void } =
    kind === 'learn'
      ? { label: '다음: 섞어 치기', go: () => nav(`/position/${stageId}?kind=mix`) }
      : drillNow >= 2 || passedStage
        ? { label: '다음: 승급 테스트', go: () => nav(`/position/${stageId}/test`) }
        : { label: '다음: 섞어 치기', go: () => nav(`/position/${stageId}?kind=mix`) };
  const again = useCallback(() => setRunNo((n) => n + 1), []);

  // 키 입력
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const r = run.current;
      if (r.phase === 'done') {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (result?.saved) next.go();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          backToMap();
        } else if (e.code === 'Space') {
          e.preventDefault();
          again();
        }
        return;
      }
      if (r.phase === 'paused') {
        if (e.key === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          resume();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          backToMap();
        }
        return;
      }
      // 진행 중
      if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.code)) return;
      e.preventDefault();
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
      if (e.key === 'Escape') {
        pause();
        return;
      }
      setPressed(e.code);
      if (e.repeat || !isJudgeable(e.code)) return;
      const t = items[r.idx];
      if (!t) return;
      const now = performance.now();
      if (matchesTarget(e, t)) {
        meterRef.current.addStrokes(t.shift ? 2 : 1, now);
        r.idx++;
        r.itemTypos = 0;
        setHint('');
        if (r.idx >= items.length) void finish();
        else rerender();
      } else {
        if (r.itemTypos < MAX_TYPOS_PER_ITEM) {
          meterRef.current.addTypo(t.code, now);
          r.itemTypos++;
        }
        setWrong((w) => ({ code: e.code, n: w.n + 1 }));
        setShake((n) => n + 1);
        if (e.code === t.code) setHint(t.shift ? 'Shift 를 함께 누르세요' : 'Shift 를 떼고 누르세요');
        else setHint(`${FINGER_LABEL[t.finger]} 손가락으로 눌러요`);
        rerender();
      }
    };
    const up = () => setPressed(null);
    const blur = () => pause();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  });

  // 시간 표시 갱신 + 10초 무입력 시 시간 정지(다음 입력 때 자동 재개)
  useEffect(() => {
    const t = setInterval(() => {
      const m = meterRef.current;
      if (run.current.phase !== 'run' || !m.started) return;
      const last = m.lastInputAt;
      if (!m.paused && last !== null && performance.now() - last > IDLE_MS) m.pause(last + 1000);
      rerender();
    }, 500);
    return () => clearInterval(t);
  }, []);

  if (!stage) return <Navigate to="/position" replace />;
  if (!student) return null;
  if (!allowed) return <Navigate to={group === 'en' ? '/position?track=en' : '/position'} replace />;

  const r = run.current;
  const target = r.phase === 'done' ? null : (items[r.idx] ?? null);
  const upcoming = items.slice(r.idx + 1, r.idx + 4);
  const snap = meterRef.current.snapshot(performance.now());
  const total = group === 'en' ? 7 : 10;
  const stageCodes = stage.newKeys.map((k) => k.code);
  const kbKind = prefs.keyboardKind;
  const sf = target ? shiftFingerFor(target) : null;
  const idle = meterRef.current.paused && r.phase === 'run';

  return (
    <div className="flex h-full">
      {/* 왼쪽 패널 */}
      <aside className="flex w-60 shrink-0 flex-col gap-3 overflow-y-auto bg-white px-4 py-4 shadow-sm">
        <button onClick={backToMap} className="self-start rounded-lg px-2 py-1 text-sm font-bold text-ink/60 hover:bg-mint-50">
          ← 단계 지도로
        </button>
        <div>
          <div className="text-xs text-ink/50">자리연습 · {KIND_LABEL[kind]}</div>
          <div className="text-xl font-black">{stage.name}</div>
          <div className="text-sm text-ink/60">
            {stageNo(stage)} / {total} 단계
          </div>
        </div>
        <StageTrail group={group} position={student.position} markId={stage.id} />
        <div className="rounded-xl bg-mint-50 px-3 py-1">
          <div className="flex justify-between border-b border-mint-200 py-1.5 text-sm">
            <span className="text-ink/60">진행시간</span>
            <span className="font-bold tabular-nums">{mmss(snap.seconds)}</span>
          </div>
          <div className="flex justify-between border-b border-mint-200 py-1.5 text-sm">
            <span className="text-ink/60">정확도</span>
            <span className="font-bold tabular-nums">{snap.strokes + snap.typos ? snap.accuracy.toFixed(1) : '0.0'}%</span>
          </div>
          <div className="flex justify-between py-1.5 text-sm">
            <span className="text-ink/60">오타</span>
            <span className="font-bold tabular-nums">{snap.typos}</span>
          </div>
        </div>
        <div className="border-t border-mint-100 pt-2">
          <Toggle on={prefs.showKeyboard} onClick={() => prefs.set({ showKeyboard: !prefs.showKeyboard })}>
            ⌨ 키보드 표시
          </Toggle>
          <Toggle on={prefs.showHands} onClick={() => prefs.set({ showHands: !prefs.showHands })}>
            ✋ 손 표시
          </Toggle>
        </div>
        <div>
          <div className="mb-1 text-xs text-ink/50">키보드 종류</div>
          <div className="flex flex-col gap-1">
            {(Object.keys(KEYBOARD_LABEL) as KeyboardKind[]).map((k) => (
              <button
                key={k}
                onClick={() => prefs.set({ keyboardKind: k })}
                onMouseUp={(e) => e.currentTarget.blur()}
                className={`rounded-lg border px-2 py-1 text-left text-xs font-bold transition ${
                  kbKind === k ? 'border-mint-500 bg-mint-50 text-mint-700' : 'border-mint-100 text-ink/50 hover:border-mint-300'
                }`}
              >
                {KEYBOARD_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-auto text-xs text-ink/40">
          <Kbd>Esc</Kbd> 일시정지
        </div>
      </aside>

      {/* 가운데 */}
      <section className="flex min-w-0 flex-1 flex-col gap-3 px-6 py-4">
        <div className="flex items-center justify-end gap-1 text-sm font-bold">
          <span className={`rounded-lg px-3 py-1 ${lang === 'ko' ? 'bg-mint-500 text-white' : 'bg-white text-ink/30'}`}>한국어</span>
          <span className={`rounded-lg px-3 py-1 ${lang === 'en' ? 'bg-mint-500 text-white' : 'bg-white text-ink/30'}`}>ENG</span>
        </div>

        <div className="flex items-center justify-center gap-8">
          <div
            key={`${r.idx}-${shake}`}
            className={`flex h-40 w-44 flex-col items-center justify-center rounded-3xl border-4 bg-white shadow-md ${
              shake && hint ? 'anim-shake border-miss' : 'anim-pop border-mint-300'
            }`}
          >
            <div className="text-xs font-bold text-ink/40">입력할 자리</div>
            <div className={`font-black leading-none ${target && target.label.length > 1 ? 'text-4xl' : 'text-7xl'} py-2`}>
              {target?.label ?? '✓'}
            </div>
            <div className="text-xs text-ink/50">
              {target ? FINGER_LABEL[target.finger] : ''}
              {target?.shift ? ' + Shift' : ''}
            </div>
          </div>
          <div className="flex w-44 items-center gap-4">
            {upcoming.map((t, i) => (
              <span key={i} className="text-4xl font-bold" style={{ opacity: 0.45 - i * 0.12 }}>
                {t.label === '띄어쓰기' ? '␣' : t.label}
              </span>
            ))}
          </div>
        </div>

        <div className="h-5 text-center text-sm font-bold">
          {hint ? (
            <span className="text-miss">{hint}</span>
          ) : r.idx === 0 && !meterRef.current.started ? (
            <span className="text-ink/50">
              첫 글쇠를 누르면 시작해요. {lang === 'ko' ? '한/영 상태와 상관없이 자리만 맞히면 됩니다.' : ''}
            </span>
          ) : idle ? (
            <span className="text-ink/50">시간이 멈췄어요. 글쇠를 누르면 이어서 잽니다.</span>
          ) : sf ? (
            <span className="text-mint-700">{FINGER_LABEL[sf]} 손가락으로 Shift 를 누른 채로!</span>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-mint-100">
            <div className="h-full rounded-full bg-mint-500 transition-all" style={{ width: `${(r.idx / Math.max(1, items.length)) * 100}%` }} />
          </div>
          <span className="w-16 text-right text-sm tabular-nums text-ink/60">
            {Math.min(r.idx, items.length)} / {items.length}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 items-start justify-center">
          {prefs.showKeyboard ? (
            <VirtualKeyboard
              kind={kbKind}
              lang={lang}
              target={target}
              stageCodes={stageCodes}
              wrongCode={wrong.code}
              wrongNonce={wrong.n}
              pressedCode={pressed}
              showHands={prefs.showHands}
              className="h-full max-h-full w-full"
            />
          ) : (
            <div className="mt-10 rounded-2xl bg-white/70 px-6 py-4 text-sm text-ink/50">키보드를 숨겼어요. 화면을 보지 않고 쳐 보세요!</div>
          )}
        </div>
      </section>

      {r.phase === 'paused' && (
        <Modal>
          <div className="text-center">
            <div className="text-2xl font-black">잠깐 멈췄어요</div>
            <p className="mt-2 text-sm text-ink/60">시간이 멈춰 있어요. 준비되면 계속하세요.</p>
            <div className="mt-6 flex justify-center gap-3">
              <Btn onClick={resume}>
                계속하기 <Kbd>Enter</Kbd>
              </Btn>
              <Btn variant="ghost" onClick={backToMap}>
                단계 지도로 <Kbd>Esc</Kbd>
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {result && (
        <Modal wide>
          <ResultBody result={result} kind={kind} lang={lang} />
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Btn variant="ghost" onClick={again}>
              한 번 더 <Kbd>Space</Kbd>
            </Btn>
            <Btn onClick={next.go} disabled={!result.saved}>
              {next.label} <Kbd>Enter</Kbd>
            </Btn>
            <Btn variant="ghost" onClick={backToMap}>
              단계 지도 <Kbd>Esc</Kbd>
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ResultBody({ result, kind, lang }: { result: Result; kind: Kind; lang: 'ko' | 'en' }) {
  const { snap, fin, blind } = result;
  const worst = topCodes(snap.missKeys, 3);
  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="text-2xl font-black">{KIND_LABEL[kind]} 완료!</div>
        {blind && <span className="rounded-full bg-gold/20 px-3 py-1 text-sm font-bold text-ink">🙈 안 보고 치기</span>}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 text-lg">
        <div className="flex justify-between border-b border-mint-100 pb-1">
          <span className="text-ink/60">정확도</span>
          <b className="tabular-nums">{snap.accuracy.toFixed(1)}%</b>
        </div>
        <div className="flex justify-between border-b border-mint-100 pb-1">
          <span className="text-ink/60">시간</span>
          <b className="tabular-nums">{mmss(snap.seconds)}</b>
        </div>
        <div className="flex justify-between border-b border-mint-100 pb-1">
          <span className="text-ink/60">오타</span>
          <b className="tabular-nums">{snap.typos}개</b>
        </div>
        <div className="flex justify-between border-b border-mint-100 pb-1">
          <span className="text-ink/60">타수</span>
          <b className="tabular-nums">{Math.round(snap.kpm)}타/분</b>
        </div>
      </div>
      <div className="mt-4 text-sm">
        <span className="text-ink/60">많이 틀린 글쇠: </span>
        {worst.length ? (
          worst.map((c) => (
            <span key={c} className="mr-2 rounded-lg bg-miss/10 px-2 py-0.5 font-bold text-miss">
              {codeLabel(c, lang)}({snap.missKeys[c]})
            </span>
          ))
        ) : (
          <b className="text-mint-700">없어요! 완벽해요 👏</b>
        )}
      </div>
      <div className="mt-2 text-sm text-ink/60">
        {fin ? <>⭐ 경험치 +{fin.xpGain}{fin.goalJustDone ? ' · 오늘의 훈련 완료!' : ''}</> : '기록 저장 중...'}
      </div>
    </div>
  );
}
