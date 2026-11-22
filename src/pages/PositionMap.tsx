// 자리연습 단계 지도(docs/02 4.3). [한글·기호] / [영문] 트랙, 단계 선택, ①②③ 상태, 시작.
//   경로 /position?track=ko|en
//   키: ←/→ 단계 고르기, Enter 추천 연습 시작, 1·2·3 각 연습, ↑/↓ 트랙 전환, Esc 홈
//
// 자리연습 화면들이 함께 쓰는 도우미(named export)
//   type TrackGroup = 'ko' | 'en'            ko = 한글 8 + 기호 2, en = 영문 7
//   groupOf(stage): TrackGroup / groupStages(g): Stage[] / groupLang(g): Lang
//   stageNo(stage): number                   그 묶음 안 번호(1부터, 기호 1 = 9)
//   currentStageId(position, g): string | null
//   codeLabel(code, lang): string            글쇠 code → 화면 표시 글자
//   topCodes(miss: Record<string, number>, n): string[]  많이 틀린 순
//   needsReview(id) / setNeedsReview(id, on)  불합격 직후 복습 권유 표시(이 브라우저 세션에만)
//   <StageTrail group position markId? />    축소 진행 막대(✅ 🟢 🔒)
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Lang, Student, Track } from '../data/types';
import { useAuth } from '../state/auth';
import { keyByCode } from '../engine/layout';
import {
  getStage,
  isBattleUnlocked,
  isEnBattleUnlocked,
  isStagePassed,
  isStageUnlocked,
  nextStageId,
  stagesOf,
  type Stage,
} from '../engine/stages';
import { Card, Kbd } from '../components/ui';

export type TrackGroup = 'ko' | 'en';

export function groupOf(st: Stage): TrackGroup {
  return st.track === 'en' ? 'en' : 'ko';
}
export function groupStages(g: TrackGroup): Stage[] {
  return g === 'en' ? stagesOf('en') : [...stagesOf('ko'), ...stagesOf('symbol')];
}
export function groupLang(g: TrackGroup): Lang {
  return g === 'en' ? 'en' : 'ko';
}
export function stageNo(st: Stage): number {
  return st.track === 'symbol' ? 8 + st.order : st.order;
}
export function currentStageId(position: Record<Track, number>, g: TrackGroup): string | null {
  if (g === 'en') return nextStageId(position, 'en');
  return nextStageId(position, 'ko') ?? nextStageId(position, 'symbol');
}
export function codeLabel(code: string, lang: Lang): string {
  const k = keyByCode(code);
  if (!k) return code;
  if (code === 'Space') return lang === 'ko' ? '띄어쓰기' : 'Space';
  if (k.label) return k.label;
  if (lang === 'ko' && k.ko) return k.ko;
  return k.en;
}
export function topCodes(miss: Record<string, number>, n: number): string[] {
  return Object.entries(miss)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([c]) => c);
}

const REVIEW_KEY = (id: string) => `taja-review-${id}`;
export function needsReview(id: string): boolean {
  try {
    return sessionStorage.getItem(REVIEW_KEY(id)) === '1';
  } catch {
    return false;
  }
}
export function setNeedsReview(id: string, on: boolean) {
  try {
    if (on) sessionStorage.setItem(REVIEW_KEY(id), '1');
    else sessionStorage.removeItem(REVIEW_KEY(id));
  } catch {
    /* 저장소를 못 쓰면 무시 */
  }
}

type NodeState = 'passed' | 'current' | 'open' | 'locked';
function nodeState(position: Record<Track, number>, st: Stage, curId: string | null): NodeState {
  if (isStagePassed(position, st.id)) return 'passed';
  if (!isStageUnlocked(position, st.id)) return 'locked';
  return st.id === curId ? 'current' : 'open';
}

/** 축소 진행 막대: ✅ 통과 / 🟢 지금 / 🔒 잠김. markId 는 테두리로 표시. */
export function StageTrail({
  group,
  position,
  markId,
}: {
  group: TrackGroup;
  position: Record<Track, number>;
  markId?: string;
}) {
  const list = groupStages(group);
  const cur = currentStageId(position, group);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {list.map((st) => {
        const s = nodeState(position, st, cur);
        return (
          <span key={st.id} className="flex items-center">
            {group === 'ko' && st.id === 'S1' && <span className="mx-0.5 text-xs text-ink/30">·</span>}
            <span
              title={`${stageNo(st)}단계 ${st.name}`}
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                s === 'passed'
                  ? 'bg-mint-500 text-white'
                  : s === 'current' || s === 'open'
                    ? 'bg-gold text-white'
                    : 'bg-ink/10 text-ink/40'
              } ${markId === st.id ? 'ring-2 ring-ink ring-offset-1' : ''}`}
            >
              {s === 'passed' ? '✓' : s === 'locked' ? '🔒' : stageNo(st)}
            </span>
          </span>
        );
      })}
    </div>
  );
}

const STEP_NAMES = ['글쇠 익히기', '섞어 치기', '승급 테스트'];

function stepState(student: Student, st: Stage) {
  const drill = student.stageDrill[st.id] ?? 0;
  const passed = isStagePassed(student.position, st.id);
  return {
    drill,
    passed,
    testOpen: passed || drill >= 2,
    best: student.stageBest[st.id],
  };
}

export default function PositionMap() {
  const nav = useNavigate();
  const { student } = useAuth();
  const [params, setParams] = useSearchParams();
  const group: TrackGroup = params.get('track') === 'en' ? 'en' : 'ko';
  const list = useMemo(() => groupStages(group), [group]);
  const position = student?.position ?? { ko: 0, symbol: 0, en: 0 };
  const curId = currentStageId(position, group);
  const [sel, setSel] = useState<string | null>(null);

  // 트랙이 바뀌면 지금 단계(없으면 마지막 단계)를 고른다
  const defaultSel = curId && isStageUnlocked(position, curId) ? curId : (list.filter((s) => isStageUnlocked(position, s.id)).pop()?.id ?? null);
  const selId = sel && list.some((s) => s.id === sel) ? sel : defaultSel;
  const selStage = selId ? getStage(selId) : undefined;
  const lang = groupLang(group);

  const go = (id: string, kind: 'learn' | 'mix' | 'review' | 'test') => {
    if (kind === 'test') nav(`/position/${id}/test`);
    else nav(`/position/${id}?kind=${kind}`);
  };

  const recommend = (st: Stage): 'learn' | 'mix' | 'review' | 'test' => {
    if (!student) return 'learn';
    const s = stepState(student, st);
    if (needsReview(st.id)) return 'review';
    if (s.passed) return 'mix';
    if (s.drill < 1) return 'learn';
    if (s.drill < 2) return 'mix';
    return 'test';
  };

  const setTrack = (g: TrackGroup) => {
    setSel(null);
    setParams(g === 'en' ? { track: 'en' } : {}, { replace: true });
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const open = list.filter((s) => isStageUnlocked(position, s.id));
      const i = open.findIndex((s) => s.id === selId);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const j = i + (e.key === 'ArrowRight' ? 1 : -1);
        if (open[j]) setSel(open[j].id);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selStage) go(selStage.id, recommend(selStage));
      } else if (e.key === 'Escape') {
        nav('/home');
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        setTrack(group === 'ko' ? 'en' : 'ko');
      } else if (selStage && student && ['1', '2', '3'].includes(e.key)) {
        const s = stepState(student, selStage);
        if (e.key === '1') go(selStage.id, 'learn');
        if (e.key === '2') go(selStage.id, 'mix');
        if (e.key === '3' && s.testOpen) go(selStage.id, 'test');
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  if (!student) return null;
  const enLocked = group === 'en' && position.ko < 1;
  const battleOpen = group === 'en' ? isEnBattleUnlocked(position) : isBattleUnlocked(position);
  const ss = selStage ? stepState(student, selStage) : null;
  const rec = selStage ? recommend(selStage) : 'learn';
  const recLabel = { learn: '① 글쇠 익히기 시작', mix: '② 섞어 치기 시작', review: '틀린 글쇠 복습하기', test: '③ 승급 테스트 보기' }[rec];

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 p-6">
      <div className="flex items-center gap-4">
        <button onClick={() => nav('/home')} className="rounded-lg px-2 py-1 text-sm font-bold text-ink/60 hover:bg-white">
          ← 홈
        </button>
        <h1 className="text-2xl font-black">자리연습</h1>
        <div className="ml-auto flex gap-1 rounded-xl bg-white p-1 shadow-sm">
          {(['ko', 'en'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setTrack(g)}
              className={`rounded-lg px-4 py-1.5 text-sm font-bold transition ${
                group === g ? 'bg-mint-500 text-white' : 'text-ink/60 hover:bg-mint-50'
              }`}
            >
              {g === 'ko' ? '한글·기호' : '영문'}
            </button>
          ))}
        </div>
      </div>

      {/* 진행 경로 */}
      <Card className="px-6 py-6">
        <div className="mb-3 flex items-center justify-between text-sm">
          <span className="font-bold text-ink/70">{group === 'ko' ? '한글 8단계 + 기호 2단계' : '영문 7단계'}</span>
          <span className="text-ink/50">
            통과 {group === 'ko' ? position.ko + position.symbol : position.en} / {list.length}
          </span>
        </div>
        <div className="flex items-start">
          {list.map((st, i) => {
            const s = nodeState(position, st, curId);
            const isSel = st.id === selId;
            const best = student.stageBest[st.id];
            return (
              <div key={st.id} className="flex min-w-0 flex-1 items-start">
                {i > 0 && (
                  <div
                    className={`mt-7 h-1 flex-1 rounded ${
                      group === 'ko' && st.id === 'S1' ? 'border-t-2 border-dashed border-ink/20 bg-transparent' : s === 'locked' ? 'bg-ink/10' : 'bg-mint-300'
                    }`}
                  />
                )}
                <button
                  disabled={s === 'locked'}
                  onClick={() => setSel(st.id)}
                  className="flex w-16 shrink-0 flex-col items-center gap-1 disabled:cursor-not-allowed"
                  title={s === 'locked' ? '아직 잠겨 있어요' : `${st.name}`}
                >
                  <span
                    className={`flex items-center justify-center rounded-full font-black transition ${
                      s === 'current' ? 'h-16 w-16 bg-gold text-2xl text-white shadow-lg' : 'mt-2 h-12 w-12 text-lg'
                    } ${s === 'passed' ? 'bg-mint-500 text-white' : s === 'open' ? 'bg-gold/80 text-white' : s === 'locked' ? 'bg-ink/10 text-ink/40' : ''} ${
                      isSel ? 'ring-4 ring-ink/70 ring-offset-2' : ''
                    }`}
                  >
                    {s === 'passed' ? '✅' : s === 'locked' ? '🔒' : stageNo(st)}
                  </span>
                  <span className={`text-center text-xs leading-tight ${s === 'locked' ? 'text-ink/40' : 'font-bold'}`}>{st.name}</span>
                  {s === 'passed' && best !== undefined && <span className="text-xs font-bold text-mint-700">{best}점</span>}
                  {s === 'current' && <span className="whitespace-nowrap rounded bg-gold px-1.5 text-xs font-black text-white">지금 여기!</span>}
                </button>
              </div>
            );
          })}
          <div className="mt-7 h-1 w-6 shrink-0 rounded bg-ink/10" />
          <div className={`flex w-20 shrink-0 flex-col items-center gap-1 ${battleOpen ? '' : 'opacity-50'}`}>
            <span className={`mt-2 flex h-12 w-12 items-center justify-center rounded-full text-xl ${battleOpen ? 'bg-ink text-white' : 'bg-ink/10'}`}>
              ⚔
            </span>
            <span className="text-center text-xs font-bold leading-tight">{group === 'ko' ? '배틀 개방' : '영문 배틀 개방'}</span>
          </div>
        </div>
      </Card>

      {/* 선택한 단계 */}
      {enLocked ? (
        <Card className="py-10 text-center text-ink/60">한글 1단계 「기본자리」 승급 테스트를 통과하면 영문 자리연습이 열려요.</Card>
      ) : selStage && ss ? (
        <Card className="flex flex-col gap-5 px-7 py-6">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <h2 className="text-2xl font-black">
              {stageNo(selStage)}단계 {selStage.name}
            </h2>
            {ss.passed && (
              <span className="rounded-full bg-mint-100 px-3 py-0.5 text-sm font-bold text-mint-700">
                ✅ 통과{ss.best !== undefined ? ` · 최고 ${ss.best}점` : ''}
              </span>
            )}
            <div className="flex flex-wrap gap-1.5">
              {selStage.newKeys.map((k) => (
                <span key={k.code + k.shift} className="rounded-lg border border-mint-200 bg-mint-50 px-2.5 py-1 text-lg font-bold">
                  {k.label}
                </span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {STEP_NAMES.map((name, i) => {
              const done = i === 0 ? ss.drill >= 1 : i === 1 ? ss.drill >= 2 : ss.passed;
              const locked = i === 2 && !ss.testOpen;
              const kind = (['learn', 'mix', 'test'] as const)[i];
              return (
                <button
                  key={name}
                  disabled={locked}
                  onClick={() => go(selStage.id, kind)}
                  className={`flex items-center justify-between rounded-xl border-2 px-4 py-3 text-left transition disabled:cursor-not-allowed ${
                    rec === kind ? 'border-mint-500 bg-mint-50' : 'border-mint-100 hover:border-mint-300'
                  } ${locked ? 'opacity-50' : ''}`}
                >
                  <span>
                    <span className="block font-bold">
                      {'①②③'[i]} {name}
                    </span>
                    <span className="text-xs text-ink/50">
                      {i === 0 ? '새 글쇠만 30문항' : i === 1 ? '새 글쇠 + 이전 글쇠 40문항' : locked ? '섞어 치기를 마치면 열려요' : '50문항 · 90점 통과'}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-xl">
                    <Kbd>{i + 1}</Kbd>
                    {locked ? '🔒' : done ? '✅' : '⬜'}
                  </span>
                </button>
              );
            })}
          </div>
          {needsReview(selStage.id) && (
            <p className="rounded-xl bg-gold/15 px-4 py-2 text-sm text-ink/80">
              지난 승급 테스트가 아쉬웠어요. 틀린 글쇠를 먼저 복습하고 다시 도전해 보세요.
            </p>
          )}
          <div className="flex items-center justify-end gap-3">
            <span className="text-xs text-ink/50">
              <Kbd>←</Kbd> <Kbd>→</Kbd> 단계 고르기 · <Kbd>↑</Kbd> <Kbd>↓</Kbd> 트랙 바꾸기 · <Kbd>Esc</Kbd> 홈
            </span>
            {rec === 'review' && (
              <button onClick={() => go(selStage.id, 'test')} className="text-sm font-bold text-ink/50 underline hover:text-ink">
                바로 승급 테스트
              </button>
            )}
            <button
              onClick={() => go(selStage.id, rec)}
              className="rounded-xl bg-mint-500 px-6 py-3 text-lg font-black text-white shadow hover:bg-mint-600"
            >
              {recLabel} <span className="ml-1 rounded bg-white/25 px-1.5 text-sm">Enter</span>
            </button>
          </div>
        </Card>
      ) : null}
      {lang === 'ko' && !enLocked && (
        <p className="text-center text-xs text-ink/40">자리연습은 한/영 상태와 상관없이 글쇠 자리만 봅니다.</p>
      )}
    </div>
  );
}
