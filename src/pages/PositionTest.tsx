// 승급 테스트(docs/01 4.3, docs/02 4.5). 경로 /position/:stageId/test
//   3초 카운트다운 → 50문항. 문항마다 settings.testSecondsPerItem 초. 첫 글쇠가 맞아야 정답, 틀리거나 시간 초과면 오답 후 바로 다음.
//   가상 키보드는 plain(강조·손 없음). Esc·창 떠남 = 일시정지(타이머 멈춤).
//   끝나면 finishSession(mode 'positionTest') → 승급 창 / 통과(재시험) / 불합격(틀린 글쇠 복습) 창.
//   잠긴 단계나 섞어 치기를 마치지 않은 단계(stageDrill < 2)는 지도로 돌려보낸다(이미 통과한 단계는 허용).
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import type { Track } from '../data/types';
import { useAuth } from '../state/auth';
import { usePrefs } from '../state/prefs';
import { finishSession } from '../state/record';
import type { KeyTarget } from '../engine/layout';
import {
  DRILL_COUNTS,
  getStage,
  isEnBattleUnlocked,
  isStagePassed,
  isStageUnlocked,
  isTestPassed,
  makeDrill,
  matchesTarget,
  testScore,
} from '../engine/stages';
import { TypingMeter, type MeterSnapshot } from '../engine/judge';
import VirtualKeyboard from '../components/VirtualKeyboard';
import { Btn, Kbd, Modal } from '../components/ui';
import { codeLabel, groupLang, groupOf, groupStages, setNeedsReview, StageTrail, stageNo, topCodes } from './PositionMap';
import { isJudgeable } from './PositionPractice';

type Phase = 'countdown' | 'run' | 'paused' | 'done';

interface Outcome {
  score: number;
  passed: boolean;
  promoted: boolean;
  snap: MeterSnapshot;
  saved: boolean;
  posAfter: Record<Track, number>;
}

export default function PositionTest() {
  const { stageId = '' } = useParams();
  const nav = useNavigate();
  const student = useAuth((s) => s.student);
  const settings = useAuth((s) => s.settings);
  const kbKind = usePrefs((s) => s.keyboardKind);
  const stage = getStage(stageId);

  // 들어온 순간의 상태(테스트 중 학생 문서가 바뀌어도 판단이 흔들리지 않게)
  const start = useRef<{ allowed: boolean; position: Record<Track, number>; wasPassed: boolean; prevBest: number } | null>(null);
  if (!start.current && student && stage) {
    const pos = { ...student.position };
    const wasPassed = isStagePassed(pos, stage.id);
    start.current = {
      allowed: wasPassed || (isStageUnlocked(pos, stage.id) && (student.stageDrill[stage.id] ?? 0) >= 2),
      position: pos,
      wasPassed,
      prevBest: student.stageBest[stage.id] ?? 0,
    };
  }

  const items = useMemo<KeyTarget[]>(() => (stage ? makeDrill(stage.id, 'test', DRILL_COUNTS.test, Math.random) : []), [stage]);
  const perItemMs = Math.max(1, settings.testSecondsPerItem) * 1000;

  const meter = useRef(new TypingMeter());
  const st = useRef({ phase: 'countdown' as Phase, idx: 0, correct: 0, itemStart: 0, pausedAt: 0, finishing: false });
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [count, setCount] = useState(3);
  const [fb, setFb] = useState<{ ok: boolean; n: number } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const group = stage ? groupOf(stage) : 'ko';
  const lang = groupLang(group);
  const mapPath = group === 'en' ? '/position?track=en' : '/position';

  // 카운트다운
  useEffect(() => {
    if (st.current.phase !== 'countdown') return;
    if (count <= 0) {
      const now = performance.now();
      st.current.phase = 'run';
      st.current.itemStart = now;
      meter.current.start(now);
      rerender();
      return;
    }
    const t = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [count]);

  const finish = useCallback(async () => {
    const s = st.current;
    if (!stage || !start.current || s.finishing) return;
    s.finishing = true;
    s.phase = 'done';
    const snap = meter.current.snapshot(performance.now());
    const score = testScore(s.correct, items.length);
    const passed = isTestPassed(score, settings.passScore);
    const pos0 = start.current.position;
    const posAfter = { ...pos0 };
    if (passed && !start.current.wasPassed && stage.order === pos0[stage.track] + 1) posAfter[stage.track] += 1;
    const base: Outcome = { score, passed, promoted: false, snap, saved: false, posAfter };
    setOutcome(base);
    setNeedsReview(stage.id, !passed);
    let promoted = false;
    try {
      const r = await finishSession({
        mode: 'positionTest',
        lang,
        stageId: stage.id,
        kpm: snap.kpm,
        accuracy: snap.accuracy,
        typos: snap.typos,
        strokes: snap.strokes,
        seconds: snap.seconds,
        missKeys: snap.missKeys,
        score,
        passed,
      });
      promoted = r.promoted;
    } catch (e) {
      console.error(e);
    }
    setOutcome({ ...base, promoted, saved: true, posAfter: promoted ? posAfter : pos0 });
  }, [stage, items.length, settings.passScore, lang]);

  const answer = useCallback(
    (ok: boolean, now: number) => {
      const s = st.current;
      const t = items[s.idx];
      if (!t) return;
      if (ok) {
        s.correct++;
        meter.current.addStrokes(t.shift ? 2 : 1, now);
      } else meter.current.addTypo(t.code, now);
      setFb((f) => ({ ok, n: (f?.n ?? 0) + 1 }));
      s.idx++;
      s.itemStart = now;
      if (s.idx >= items.length) void finish();
      else rerender();
    },
    [items, finish],
  );

  const pause = useCallback(() => {
    const s = st.current;
    if (s.phase !== 'run') return;
    const now = performance.now();
    s.phase = 'paused';
    s.pausedAt = now;
    meter.current.pause(now);
    rerender();
  }, []);
  const resume = useCallback(() => {
    const s = st.current;
    if (s.phase !== 'paused') return;
    const now = performance.now();
    s.itemStart += now - s.pausedAt;
    s.phase = 'run';
    meter.current.resume(now);
    rerender();
  }, []);

  // 문항 타이머(화면 갱신 겸)
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const s = st.current;
      if (s.phase === 'run') {
        const now = performance.now();
        if (now - s.itemStart >= perItemMs) answer(false, now);
        else rerender();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [answer, perItemMs]);

  // 결과 창 버튼
  const o = outcome;
  const list = stage ? groupStages(group) : [];
  const nextStage = stage ? list[list.findIndex((x) => x.id === stage.id) + 1] : undefined;
  const graduated = !!o?.promoted && !nextStage;
  const actions = (() => {
    if (!o || !stage) return null;
    if (o.passed && o.promoted) {
      if (nextStage) return { primary: { label: '다음 단계 시작', go: () => nav(`/position/${nextStage.id}`) }, second: { label: '홈으로', go: () => nav('/home') } };
      if (stage.id === 'S2' && settings.battleEnabled)
        return { primary: { label: '배틀 하러 가기', go: () => nav('/battle') }, second: { label: '홈으로', go: () => nav('/home') } };
      return { primary: { label: '홈으로', go: () => nav('/home') }, second: { label: '단계 지도', go: () => nav(mapPath) } };
    }
    if (o.passed) return { primary: { label: '단계 지도', go: () => nav(mapPath) }, second: { label: '홈으로', go: () => nav('/home') } };
    const focusCodes = topCodes(o.snap.missKeys, 5);
    return {
      primary: { label: '틀린 글쇠 복습하기', go: () => nav(`/position/${stage.id}?kind=review`, { state: { focusCodes } }) },
      second: { label: '단계 지도', go: () => nav(mapPath) },
    };
  })();

  // 키 입력
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const s = st.current;
      if (s.phase === 'done') {
        if (!actions || !o?.saved) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          actions.primary.go();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          actions.second.go();
        }
        return;
      }
      if (s.phase === 'paused') {
        if (e.key === 'Enter') {
          e.preventDefault();
          resume();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          nav(mapPath);
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.code)) return;
      e.preventDefault();
      if (e.key === 'Escape') {
        if (s.phase === 'countdown') nav(mapPath);
        else pause();
        return;
      }
      if (s.phase !== 'run' || e.repeat || !isJudgeable(e.code)) return;
      const t = items[s.idx];
      if (t) answer(matchesTarget(e, t), performance.now());
    };
    const blur = () => pause();
    window.addEventListener('keydown', down);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('blur', blur);
    };
  });

  const keyboard = useMemo(() => <VirtualKeyboard kind={kbKind} lang={lang} plain className="h-full max-h-full w-full" />, [kbKind, lang]);

  if (!stage) return <Navigate to="/position" replace />;
  if (!student || !start.current) return null;
  if (!start.current.allowed) return <Navigate to={mapPath} replace />;

  const s = st.current;
  const target = s.phase === 'run' || s.phase === 'paused' ? items[s.idx] : null;
  const remain = s.phase === 'run' ? Math.max(0, 1 - (performance.now() - s.itemStart) / perItemMs) : s.phase === 'paused' ? Math.max(0, 1 - (s.pausedAt - s.itemStart) / perItemMs) : 1;
  const R = 26;
  const C = 2 * Math.PI * R;
  const total = group === 'en' ? 7 : 10;

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-3 px-6 py-4">
      <div className="flex items-center gap-4">
        <div className="text-xl font-black">
          승급 테스트 · {stageNo(stage)}단계 {stage.name}
        </div>
        <span className="ml-auto rounded-full bg-white px-3 py-1 text-sm font-bold text-ink/70">통과 기준 {settings.passScore}점</span>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm text-ink/60">문항</span>
        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-mint-100">
          <div className="h-full rounded-full bg-mint-500" style={{ width: `${(s.idx / items.length) * 100}%` }} />
        </div>
        <span className="w-16 text-right text-sm tabular-nums text-ink/60">
          {Math.min(s.idx + (target ? 1 : 0), items.length)} / {items.length}
        </span>
        <svg viewBox="0 0 64 64" className="h-14 w-14" aria-label="남은 시간">
          <circle cx={32} cy={32} r={R} strokeWidth={7} fill="none" className="stroke-mint-100" />
          <circle
            cx={32}
            cy={32}
            r={R}
            strokeWidth={7}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - remain)}
            transform="rotate(-90 32 32)"
            className={remain < 0.34 ? 'stroke-miss' : 'stroke-mint-500'}
          />
          <text x={32} y={33} textAnchor="middle" dominantBaseline="central" fontSize={16} fontWeight={700} className="fill-ink">
            {Math.ceil((remain * perItemMs) / 1000)}
          </text>
        </svg>
      </div>

      <div className="flex justify-center">
        <div
          key={fb?.n ?? 0}
          className={`flex h-36 w-44 items-center justify-center rounded-3xl border-4 bg-white shadow-md transition-colors ${
            fb ? (fb.ok ? 'border-mint-500' : 'anim-shake border-miss') : 'border-mint-200'
          }`}
        >
          {s.phase === 'countdown' ? (
            <span className="text-7xl font-black text-mint-600">{count > 0 ? count : '시작!'}</span>
          ) : (
            <span className={`font-black ${target && target.label.length > 1 ? 'text-4xl' : 'text-7xl'}`}>{target?.label ?? ''}</span>
          )}
        </div>
      </div>
      <div className="h-5 text-center text-sm font-bold">
        {s.phase === 'countdown' ? (
          <span className="text-ink/50">첫 글쇠가 맞아야 정답이에요. 문항마다 {settings.testSecondsPerItem}초!</span>
        ) : fb ? (
          fb.ok ? <span className="text-mint-700">정답!</span> : <span className="text-miss">아쉬워요</span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 items-start justify-center">{keyboard}</div>

      {s.phase === 'paused' && (
        <Modal>
          <div className="text-center">
            <div className="text-2xl font-black">테스트를 잠깐 멈췄어요</div>
            <p className="mt-2 text-sm text-ink/60">남은 시간이 멈춰 있어요. 그만두면 이번 테스트는 기록되지 않아요.</p>
            <div className="mt-6 flex justify-center gap-3">
              <Btn onClick={resume}>
                계속하기 <Kbd>Enter</Kbd>
              </Btn>
              <Btn variant="ghost" onClick={() => nav(mapPath)}>
                그만두기 <Kbd>Esc</Kbd>
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {o && actions && (
        <Modal wide>
          {o.passed && o.promoted ? (
            <div className="text-center">
              <img src="/mascot-promote.png" alt="" className="mx-auto h-32 w-32 object-contain" />
              {graduated ? (
                <div className="mt-2 text-3xl font-black">
                  {stage.track === 'en' ? '🎖 영문 자리연습 수료!' : '🎖 자리연습 수료! 배틀 모드가 열렸습니다'}
                </div>
              ) : (
                <div className="mt-2 text-3xl font-black">🎉 승급되었습니다!</div>
              )}
              {graduated && stage.track === 'en' && (
                <p className="mt-1 text-sm text-ink/60">
                  {isEnBattleUnlocked(o.posAfter) ? '영문 배틀도 열렸어요!' : '한글·기호 단계를 마치면 영문 배틀이 열려요.'}
                </p>
              )}
              {nextStage && (
                <div className="mt-4 text-xl font-bold">
                  {stage.name} <span className="text-mint-600">→</span> {nextStage.name}
                </div>
              )}
              <div className="mt-2 text-lg">
                테스트 점수 <b className="text-2xl text-mint-700">{o.score}점</b>
              </div>
              <div className="mt-4 flex items-center justify-center gap-3">
                <StageTrail group={group} position={o.posAfter} />
                <span className="text-sm text-ink/60">
                  ({group === 'en' ? o.posAfter.en : o.posAfter.ko + o.posAfter.symbol} / {total} 단계)
                </span>
              </div>
            </div>
          ) : o.passed ? (
            <div className="text-center">
              <div className="text-3xl font-black">통과! (최고 점수 {Math.max(o.score, start.current.prevBest)}점)</div>
              <p className="mt-2 text-ink/60">이번 점수 {o.score}점 · 이미 통과한 단계라 다음 단계는 그대로예요.</p>
            </div>
          ) : (
            <div className="text-center">
              <div className="text-3xl font-black">
                아쉬워요! {o.score}점 <span className="text-xl text-miss">({settings.passScore - o.score}점 부족)</span>
              </div>
              <div className="mt-4 text-sm">
                <span className="text-ink/60">가장 많이 틀린 글쇠: </span>
                {topCodes(o.snap.missKeys, 3).map((c) => (
                  <span key={c} className="mr-2 rounded-lg bg-miss/10 px-2 py-0.5 text-base font-bold text-miss">
                    {codeLabel(c, lang)}({o.snap.missKeys[c]})
                  </span>
                ))}
              </div>
              <p className="mt-3 text-sm text-ink/60">틀린 글쇠를 복습하고 다시 도전해 보세요.</p>
            </div>
          )}
          <div className="mt-6 flex justify-center gap-3">
            <Btn onClick={actions.primary.go} disabled={!o.saved}>
              {o.saved ? actions.primary.label : '저장 중...'} <Kbd>Enter</Kbd>
            </Btn>
            <Btn variant="ghost" onClick={actions.second.go} disabled={!o.saved}>
              {actions.second.label} <Kbd>Esc</Kbd>
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
