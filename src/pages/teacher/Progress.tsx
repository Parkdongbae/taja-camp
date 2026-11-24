// 진도 현황: 학생별 자리연습 진도표(K1~K8·S1~S2·E1~E7), 단계 분포, 요약, CSV 내보내기, 학생 상세 창.
// 기본 export: Progress (선생님 모드 탭 /teacher/progress). 단계 조정은 학생 관리 탭에서 한다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { backend } from '../../data';
import { isMemberId } from '../../engine/member';
import { AppError, type SessionMode, type SessionRecord, type Student } from '../../data/types';
import {
  STAGES,
  charOfKey,
  isBattleUnlocked,
  isStagePassed,
  isStageUnlocked,
  nextStageId,
  tierName,
  tierOf,
  todayString,
  levelOf,
} from '../../engine';
import { useAuth } from '../../state/auth';
import { Btn, Card, Modal, Spinner } from '../../components/ui';
import { TierBadge } from '../../components/TierBadge';

const MODE_LABEL: Record<SessionMode, string> = {
  position: '자리연습',
  positionTest: '승급 테스트',
  word: '낱말',
  sentence: '단문',
  passage: '장문',
  battle: '배틀',
  quiz: '퀴즈',
  exam: '수행평가',
};
const DRILL_LABEL = ['시작 전', '익히기 완료', '테스트 대기'];
const DRILL_SHORT = ['시작 전', '익히기', '테스트'];
const GROUPS = [
  { track: 'ko' as const, title: '한글' },
  { track: 'symbol' as const, title: '기호' },
  { track: 'en' as const, title: '영문' },
];
const PROGRESS_STAGES = STAGES.filter((s) => s.track !== 'en').map((s) => s.id); // K1..K8,S1,S2

type SortKey = 'number' | 'high' | 'low' | 'recent';

function errMsg(e: unknown): string {
  if (e instanceof AppError && e.code === 'PERMISSION') return '권한이 없습니다.';
  if (e instanceof AppError && e.code === 'NETWORK') return '인터넷 연결을 확인하세요.';
  return '학생 정보를 불러오지 못했습니다. 잠시 후 다시 시도하세요.';
}

const passedCount = (s: Student) => (s.position?.ko ?? 0) + (s.position?.symbol ?? 0);
const examText = (s: Student) => `${s.exam?.ko?.grade ?? '-'}/${s.exam?.en?.grade ?? '-'}`;
const minutes = (sec: number) => Math.round((sec || 0) / 60);

/** 지금 도전 중인 단계 id (없으면 '수료'). 한글 → 기호 순. */
function currentStage(s: Student): string {
  const pos = s.position ?? { ko: 0, symbol: 0, en: 0 };
  const k = nextStageId(pos, 'ko');
  if (k) return k;
  return nextStageId(pos, 'symbol') ?? '수료';
}

function hasRecord(s: Student): boolean {
  return (s.days ?? 0) > 0 || (s.totalSeconds ?? 0) > 0 || !!s.lastDay;
}

function daysAgo(day: string, today: string): number {
  const a = new Date(`${day}T00:00:00`).getTime();
  const b = new Date(`${today}T00:00:00`).getTime();
  return Math.round((b - a) / 86400000);
}

function fmtDay(day: string): string {
  if (!day) return '-';
  const [, m, d] = day.split('-');
  return `${Number(m)}/${Number(d)}`;
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(rows: Student[], goalMin: number, today: string): string {
  const head = [
    '학번', '이름', '반', '번호',
    ...STAGES.map((s) => s.id),
    '통과 단계 수', '배틀 개방', '수행평가(한글/영어)', '계급', 'RP', '한글 최고 타수', '영문 최고 타수', '퀴즈 점수',
    '연습 일수', '누적 연습 시간(분)', '오늘 연습 시간(분)', '최근 연습일',
  ];
  const lines = [head.map(csvCell).join(',')];
  for (const s of rows) {
    const pos = s.position ?? { ko: 0, symbol: 0, en: 0 };
    const cells: (string | number)[] = [
      s.id, s.name, s.classNo, s.number,
      ...STAGES.map((st) => (isStagePassed(pos, st.id) && s.stageBest?.[st.id] != null ? s.stageBest[st.id] : '')),
      passedCount(s),
      isBattleUnlocked(pos) ? '개방' : '잠김',
      examText(s),
      tierName(tierOf(s.rp ?? 0)),
      s.rp ?? 0,
      s.bestKo ?? 0,
      s.bestEn ?? 0,
      s.quizPoints ?? 0,
      s.days ?? 0,
      minutes(s.totalSeconds),
      s.lastDay === today ? minutes(s.todaySeconds) : 0,
      s.lastDay || '',
    ];
    lines.push(cells.map(csvCell).join(','));
  }
  void goalMin;
  // UTF-8 BOM: 엑셀·구글 시트에서 한글이 깨지지 않게
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export default function Progress() {
  const goalMin = useAuth((s) => s.settings.dailyGoalMinutes);
  const [students, setStudents] = useState<Student[] | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [cls, setCls] = useState<'all' | number>('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('number');
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [detail, setDetail] = useState<Student | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      setStudents((await backend.listStudents()).filter((s) => !isMemberId(s.id)));
    } catch (e) {
      setErr(errMsg(e));
      setStudents((s) => s ?? []);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const today = todayString();
  const classes = useMemo(() => [...new Set((students ?? []).map((s) => s.classNo))].sort((a, b) => a - b), [students]);
  const scope = useMemo(() => (students ?? []).filter((s) => cls === 'all' || s.classNo === cls), [students, cls]);

  const summary = useMemo(() => {
    const n = scope.length;
    const avg = n ? scope.reduce((a, s) => a + passedCount(s), 0) / n : 0;
    const battle = scope.filter((s) => isBattleUnlocked(s.position ?? { ko: 0, symbol: 0, en: 0 })).length;
    const notStarted = scope.filter((s) => passedCount(s) === 0 && !hasRecord(s)).length;
    const goal = scope.filter((s) => s.lastDay === today && s.todaySeconds >= goalMin * 60).length;
    const dist = new Map<string, number>();
    for (const id of [...PROGRESS_STAGES, '수료']) dist.set(id, 0);
    for (const s of scope) {
      const c = currentStage(s);
      dist.set(c, (dist.get(c) ?? 0) + 1);
    }
    return { n, avg, battle, notStarted, goal, dist, maxDist: Math.max(1, ...dist.values()) };
  }, [scope, goalMin, today]);

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const list = scope.filter(
      (s) => (!kw || s.name.toLowerCase().includes(kw) || s.id.includes(kw)) && (!stageFilter || currentStage(s) === stageFilter),
    );
    const byNo = (a: Student, b: Student) => a.id.localeCompare(b.id);
    list.sort((a, b) => {
      if (sort === 'high') return passedCount(b) - passedCount(a) || byNo(a, b);
      if (sort === 'low') return passedCount(a) - passedCount(b) || byNo(a, b);
      if (sort === 'recent') return (b.lastLoginAt ?? 0) - (a.lastLoginAt ?? 0) || byNo(a, b);
      return byNo(a, b);
    });
    return list;
  }, [scope, q, sort, stageFilter]);

  const exportCsv = () => {
    const blob = new Blob([buildCsv(shown, goalMin, today)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `타자훈련소_진도현황_${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!students) return <Spinner />;

  return (
    <div className="mx-auto max-w-[1400px] space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-2xl font-black">진도 현황</h1>
        <select
          className="rounded-xl border border-mint-200 bg-white px-3 py-2"
          value={cls}
          onChange={(e) => setCls(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          aria-label="반 선택"
        >
          <option value="all">전체 반</option>
          {classes.map((c) => (
            <option key={c} value={c}>
              {c}반
            </option>
          ))}
        </select>
        <input
          className="w-40 rounded-xl border border-mint-200 bg-white px-3 py-2"
          placeholder="이름·학번 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="rounded-xl border border-mint-200 bg-white px-3 py-2"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="정렬"
        >
          <option value="number">번호순</option>
          <option value="high">진도 높은 순</option>
          <option value="low">진도 낮은 순</option>
          <option value="recent">최근 접속순</option>
        </select>
        <div className="ml-auto flex gap-2">
          <Btn small variant="ghost" onClick={() => void load()} disabled={loading}>
            {loading ? '불러오는 중...' : '↻ 새로 고침'}
          </Btn>
          <Btn small variant="ghost" onClick={exportCsv} disabled={shown.length === 0}>
            CSV 내보내기
          </Btn>
        </div>
      </div>
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-miss">{err}</p>}

      {students.length === 0 ? (
        <Card>
          <p className="py-10 text-center text-ink/60">등록된 학생이 없습니다. 학생 관리 탭에서 추가하세요.</p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <SumBox label="학생 수" value={`${summary.n}명`} />
            <SumBox label="평균 진도" value={`${summary.avg.toFixed(1)}/10`} />
            <SumBox label="자리연습 수료(배틀 개방)" value={`${summary.battle}명`} />
            <SumBox label="아직 시작 안 함" value={`${summary.notStarted}명`} warn={summary.notStarted > 0} />
            <SumBox label={`오늘 목표(${goalMin}분) 달성`} value={`${summary.goal}명`} />
          </div>

          <Card className="!p-3">
            <div className="mb-1 flex items-baseline gap-2">
              <h2 className="text-sm font-bold">지금 도전 중인 단계별 학생 수</h2>
              <span className="text-xs text-ink/50">막대를 누르면 그 단계 학생만 표에 남깁니다.</span>
              {stageFilter && (
                <button className="ml-auto text-xs font-bold text-mint-600 underline" onClick={() => setStageFilter(null)}>
                  필터 해제
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 md:grid-cols-2">
              {[...PROGRESS_STAGES, '수료'].map((id) => {
                const n = summary.dist.get(id) ?? 0;
                const on = stageFilter === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setStageFilter(on ? null : id)}
                    className={`flex items-center gap-2 rounded px-1 text-left text-xs hover:bg-mint-50 ${on ? 'bg-mint-100 font-bold' : ''}`}
                  >
                    <span className="w-8 shrink-0 font-bold">{id}</span>
                    <span className="h-3.5 flex-1 rounded bg-mint-50">
                      <span className="block h-full rounded bg-mint-500" style={{ width: `${(n / summary.maxDist) * 100}%` }} />
                    </span>
                    <span className="w-8 shrink-0 text-right tabular-nums">{n}명</span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card className="!p-0">
            <div className="max-h-[calc(100vh-190px)] min-h-[300px] overflow-auto rounded-2xl">
              <table className="min-w-full border-separate border-spacing-0 text-xs">
                <thead>
                  <tr>
                    <th rowSpan={2} className={`${TH} sticky left-0 z-30 w-10`}>
                      번호
                    </th>
                    <th rowSpan={2} className={`${TH} sticky left-10 z-30 w-20 border-r border-mint-200 text-left`}>
                      이름
                    </th>
                    {GROUPS.map((g) => (
                      <th
                        key={g.track}
                        colSpan={STAGES.filter((s) => s.track === g.track).length}
                        className={`${TH} border-l border-mint-200`}
                      >
                        {g.title}
                      </th>
                    ))}
                    {['진도', '배틀', '수행평가', '계급', '한글 타수', '퀴즈', '오늘(분)', '최근 연습'].map((h) => (
                      <th key={h} rowSpan={2} className={`${TH} whitespace-nowrap border-l border-mint-200`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {STAGES.map((st, i) => (
                      <th
                        key={st.id}
                        title={`${st.id} ${st.name}`}
                        className={`${TH2} ${i === 0 || STAGES[i - 1].track !== st.track ? 'border-l border-mint-200' : ''}`}
                      >
                        <div className="font-black">{st.id}</div>
                        <div className="max-w-[3.2rem] truncate text-[10px] font-normal text-ink/60">{st.name}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={STAGES.length + 10} className="py-10 text-center text-ink/60">
                        조건에 맞는 학생이 없습니다.
                      </td>
                    </tr>
                  )}
                  {shown.map((s) => (
                    <Row key={s.id} s={s} today={today} goalMin={goalMin} onOpen={() => setDetail(s)} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="text-xs text-ink/50">
            <span className="mr-3 inline-block h-3 w-3 rounded bg-mint-300 align-middle" /> 통과(최고 점수)
            <span className="mx-3 inline-block h-3 w-3 rounded border-2 border-mint-600 bg-white align-middle" /> 도전 중
            <span className="mx-3 inline-block h-3 w-3 rounded bg-gray-100 align-middle" /> 잠김 · 회색 점수는 불합격 최고 점수
          </p>
        </>
      )}

      {detail && <DetailModal s={detail} goalMin={goalMin} today={today} onClose={() => setDetail(null)} />}
    </div>
  );
}

const TH = 'sticky top-0 z-20 border-b border-mint-200 bg-mint-50 px-1.5 py-1 text-center font-bold';
const TH2 = 'sticky top-[25px] z-20 border-b border-mint-200 bg-mint-50 px-0.5 py-0.5 text-center';

function SumBox({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl bg-white p-3 text-center shadow-sm">
      <div className="text-xs text-ink/60">{label}</div>
      <div className={`text-xl font-black tabular-nums ${warn ? 'text-miss' : ''}`}>{value}</div>
    </div>
  );
}

function Row({ s, today, goalMin, onOpen }: { s: Student; today: string; goalMin: number; onOpen: () => void }) {
  const pos = s.position ?? { ko: 0, symbol: 0, en: 0 };
  const n = passedCount(s);
  const unlocked = isBattleUnlocked(pos);
  const todayMin = s.lastDay === today ? minutes(s.todaySeconds) : 0;
  const goalDone = s.lastDay === today && s.todaySeconds >= goalMin * 60;
  const ago = s.lastDay ? daysAgo(s.lastDay, today) : -1;
  const stale = !!s.lastDay && ago > 7;
  const currents = new Set(
    (['ko', 'symbol', 'en'] as const)
      .map((t) => nextStageId(pos, t))
      .filter((id): id is string => !!id && isStageUnlocked(pos, id)),
  );
  const cellBorder = 'border-b border-mint-100 px-0.5 py-0.5 text-center';
  return (
    <tr className="cursor-pointer hover:bg-mint-50/60" onClick={onOpen}>
      <td className={`${cellBorder} sticky left-0 z-10 bg-white tabular-nums text-ink/60`}>{s.number}</td>
      <td className={`${cellBorder} sticky left-10 z-10 whitespace-nowrap border-r border-mint-200 bg-white text-left font-bold`}>
        <button
          type="button"
          className="font-bold hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-300"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          {s.name}
        </button>
      </td>
      {STAGES.map((st, i) => {
        const passed = isStagePassed(pos, st.id);
        const best = s.stageBest?.[st.id];
        const cur = currents.has(st.id);
        const first = i === 0 || STAGES[i - 1].track !== st.track;
        let cls = 'bg-gray-100 text-ink/30';
        let text = '';
        let title = `${st.id} 잠김`;
        if (passed) {
          cls = 'bg-mint-300 font-bold text-ink';
          text = best != null ? String(best) : '✓';
          title = `${st.id} 통과${best != null ? ` (최고 ${best}점)` : ''}`;
        } else if (cur) {
          const d = Math.max(0, Math.min(2, s.stageDrill?.[st.id] ?? 0));
          cls = 'border-2 border-mint-600 bg-white text-ink';
          title = `${st.id} 도전 중: ${DRILL_LABEL[d]}${best != null ? ` (불합격 최고 ${best}점)` : ''}`;
          text = '';
          return (
            <td key={st.id} className={`${cellBorder} ${first ? 'border-l border-l-mint-200' : ''}`} title={title}>
              <div className={`mx-auto flex h-7 min-w-[2.6rem] flex-col items-center justify-center rounded leading-none ${cls}`}>
                <span className="text-[10px] font-bold text-mint-700">{DRILL_SHORT[d]}</span>
                {best != null && <span className="text-[10px] text-gray-400">{best}</span>}
              </div>
            </td>
          );
        } else if (best != null) {
          text = String(best);
          cls = 'bg-gray-100 text-gray-400';
          title = `${st.id} 잠김 (불합격 최고 ${best}점)`;
        }
        return (
          <td key={st.id} className={`${cellBorder} ${first ? 'border-l border-l-mint-200' : ''}`} title={title}>
            <div className={`mx-auto flex h-7 min-w-[2.6rem] items-center justify-center rounded tabular-nums ${cls}`}>{text}</div>
          </td>
        );
      })}
      <td className={`${cellBorder} border-l border-l-mint-200`}>
        <div className="flex items-center gap-1">
          <span className="h-2 w-14 overflow-hidden rounded bg-mint-100">
            <span className="block h-full bg-mint-500" style={{ width: `${(n / 10) * 100}%` }} />
          </span>
          <span className="tabular-nums">{n}/10</span>
        </div>
      </td>
      <td className={`${cellBorder} border-l border-l-mint-200 whitespace-nowrap ${unlocked ? 'font-bold text-mint-700' : 'text-ink/40'}`}>
        {unlocked ? '⚔ 개방' : '🔒 잠김'}
      </td>
      <td className={`${cellBorder} border-l border-l-mint-200 whitespace-nowrap tabular-nums ${s.exam?.ko || s.exam?.en ? 'font-bold' : 'text-ink/40'}`}>
        {examText(s)}
      </td>
      <td className={`${cellBorder} border-l border-l-mint-200`}>
        <TierBadge tier={tierOf(s.rp ?? 0)} />
      </td>
      <td className={`${cellBorder} border-l border-l-mint-200 tabular-nums`}>{s.bestKo > 0 ? s.bestKo : '-'}</td>
      <td className={`${cellBorder} border-l border-l-mint-200 tabular-nums`}>{(s.quizPoints ?? 0) > 0 ? s.quizPoints : '-'}</td>
      <td className={`${cellBorder} border-l border-l-mint-200 whitespace-nowrap tabular-nums ${goalDone ? 'font-bold text-mint-700' : ''}`}>
        {todayMin}
        {goalDone ? ' ✔' : ''}
      </td>
      <td className={`${cellBorder} border-l border-l-mint-200 tabular-nums ${stale ? 'font-bold text-miss' : ''}`}>
        {s.lastDay ? fmtDay(s.lastDay) : '-'}
      </td>
    </tr>
  );
}

function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function DetailModal({ s, goalMin, today, onClose }: { s: Student; goalMin: number; today: string; onClose: () => void }) {
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    backend
      .listSessions(s.id, 50)
      .then((r) => alive && setSessions(r))
      .catch(() => {
        if (alive) {
          setErr('연습 기록을 불러오지 못했습니다.');
          setSessions([]);
        }
      });
    return () => {
      alive = false;
    };
  }, [s.id]);

  const pos = s.position ?? { ko: 0, symbol: 0, en: 0 };
  const sorted = useMemo(() => (sessions ?? []).slice().sort((a, b) => b.createdAt - a.createdAt), [sessions]);
  const tests = sorted.filter((r) => r.mode === 'positionTest');
  const testPass = tests.filter((r) => r.passed).length;
  const series = useMemo(
    () =>
      sorted
        .filter((r) => (r.mode === 'word' || r.mode === 'sentence' || r.mode === 'passage') && r.kpm > 0)
        .reverse()
        .map((r) => r.kpm),
    [sorted],
  );
  const weak = useMemo(
    () =>
      Object.entries(s.weakKeys ?? {})
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8),
    [s.weakKeys],
  );
  const todayMin = s.lastDay === today ? minutes(s.todaySeconds) : 0;

  return (
    <Modal wide onClose={onClose}>
      <div className="max-h-[80vh] space-y-4 overflow-y-auto pr-1">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-black">
            {s.name} <span className="text-sm font-normal text-ink/60">({s.id})</span>
          </h2>
          <TierBadge tier={tierOf(s.rp ?? 0)} />
          <span className="text-sm text-ink/70">
            RP {s.rp ?? 0} · 레벨 {levelOf(s.xp ?? 0)} · 오늘 {todayMin}/{goalMin}분
          </span>
          <Btn small variant="ghost" className="ml-auto" onClick={onClose}>
            닫기
          </Btn>
        </div>

        <section>
          <h3 className="mb-1 text-sm font-bold">자리연습 단계별 최고 점수</h3>
          <div className="grid grid-cols-3 gap-x-4 gap-y-0.5 text-sm sm:grid-cols-4">
            {STAGES.map((st) => {
              const passed = isStagePassed(pos, st.id);
              const best = s.stageBest?.[st.id];
              return (
                <div key={st.id} className="flex justify-between border-b border-mint-100 py-0.5">
                  <span>
                    <b>{st.id}</b> <span className="text-xs text-ink/50">{st.name}</span>
                  </span>
                  <span className={`tabular-nums ${passed ? 'font-bold text-mint-700' : 'text-ink/40'}`}>
                    {best != null ? `${best}점` : '-'}
                    {passed ? ' ✓' : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {!sessions ? (
          <Spinner />
        ) : (
          <>
            {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-miss">{err}</p>}
            <section className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-1 text-sm font-bold">승급 테스트</h3>
                <p className="text-sm">
                  응시 {tests.length}회 · 합격 {testPass}회 ·{' '}
                  <b>{tests.length ? `합격률 ${Math.round((testPass / tests.length) * 100)}%` : '합격률 -'}</b>
                  <span className="ml-1 text-xs text-ink/50">(최근 50건 기준)</span>
                </p>
                <h3 className="mb-1 mt-3 text-sm font-bold">약점 글쇠 (오타 많은 순)</h3>
                {weak.length === 0 ? (
                  <p className="text-sm text-ink/60">아직 기록이 없습니다.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {weak.map(([code, n]) => (
                      <span key={code} className="rounded-lg bg-red-50 px-2 py-1 text-sm">
                        <b>{charOfKey(code, false, 'ko') || code}</b> <span className="text-xs text-miss">{n}회</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h3 className="mb-1 text-sm font-bold">타수 변화 (낱말·단문·장문)</h3>
                <KpmChart data={series} />
              </div>
            </section>

            <section>
              <h3 className="mb-1 text-sm font-bold">최근 연습 20건</h3>
              {sorted.length === 0 ? (
                <p className="text-sm text-ink/60">아직 연습 기록이 없습니다.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-mint-200 text-left text-ink/60">
                      <th className="py-1">날짜</th>
                      <th>종류</th>
                      <th>타수</th>
                      <th>정확도</th>
                      <th>점수</th>
                      <th>통과</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.slice(0, 20).map((r, i) => {
                      const noKpm = r.mode === 'battle' || r.mode === 'quiz';
                      return (
                        <tr key={r.id ?? i} className="border-b border-mint-100 last:border-0">
                          <td className="py-0.5 tabular-nums text-ink/60">{fmtDateTime(r.createdAt)}</td>
                          <td>
                            {MODE_LABEL[r.mode] ?? r.mode}
                            {r.stageId ? <span className="ml-1 text-xs text-ink/50">{r.stageId}</span> : null}
                          </td>
                          <td className="tabular-nums">{noKpm ? '-' : `${r.kpm}타`}</td>
                          <td className="tabular-nums">{noKpm ? '-' : `${r.accuracy}%`}</td>
                          <td className="tabular-nums">{r.score != null ? `${r.score}점` : '-'}</td>
                          <td>{r.passed == null ? '-' : r.passed ? <span className="font-bold text-mint-700">합격</span> : <span className="text-miss">불합격</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}

        <p className="rounded-lg bg-mint-50 px-3 py-2 text-xs text-ink/70">단계 조정은 학생 관리 탭에서 할 수 있습니다.</p>
      </div>
    </Modal>
  );
}

function KpmChart({ data }: { data: number[] }) {
  if (data.length < 2) return <p className="text-sm text-ink/60">기록이 2건 이상 쌓이면 그래프가 나타납니다.</p>;
  const W = 300;
  const H = 110;
  const pad = 22;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = Math.max(1, max - min);
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (W - pad - 6);
    const y = 8 + (1 - (v - min) / span) * (H - 24);
    return [x, y] as const;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="타수 변화 꺾은선 그래프">
      <line x1={pad} x2={W - 6} y1={H - 12} y2={H - 12} stroke="var(--color-mint-200)" />
      <polyline fill="none" stroke="var(--color-mint-500)" strokeWidth="2" points={pts.map((p) => p.join(',')).join(' ')} />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.5" fill="var(--color-mint-600)">
          <title>{`${data[i]}타`}</title>
        </circle>
      ))}
      <text x="2" y="14" fontSize="10" fill="var(--color-ink)" opacity="0.6">
        {max}
      </text>
      <text x="2" y={H - 14} fontSize="10" fill="var(--color-ink)" opacity="0.6">
        {min}
      </text>
      <text x={W - 6} y={H - 1} textAnchor="end" fontSize="10" fill="var(--color-ink)" opacity="0.5">
        오래된 기록 → 최근
      </text>
    </svg>
  );
}
