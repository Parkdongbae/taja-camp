// 학습 현황: 접속 중인 학생, 반 요약(평균 타수·단계 분포·배틀 개방·오늘 목표), 오늘 미연습 학생, 최근 연습 30건.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { backend } from '../../data';
import { isMemberId } from '../../engine/member';
import { AppError, type Presence, type SessionMode, type SessionRecord, type Student } from '../../data/types';
import { isBattleUnlocked, todayString } from '../../engine';
import { useAuth } from '../../state/auth';
import { Btn, Card, Spinner } from '../../components/ui';

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

function errMsg(e: unknown): string {
  if (e instanceof AppError && e.code === 'PERMISSION') return '권한이 없습니다.';
  if (e instanceof AppError && e.code === 'NETWORK') return '인터넷 연결을 확인하세요.';
  return '불러오지 못했습니다. 잠시 후 다시 시도하세요.';
}

export default function Status() {
  const goalMin = useAuth((s) => s.settings.dailyGoalMinutes);
  const [students, setStudents] = useState<Student[] | null>(null);
  const [recent, setRecent] = useState<SessionRecord[] | null>(null);
  const [online, setOnline] = useState<Presence[]>([]);
  const [cls, setCls] = useState<'all' | number>('all');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [st0, rc] = await Promise.all([backend.listStudents(), backend.listRecentSessions(30)]);
      const st = st0.filter((s) => !isMemberId(s.id));
      setStudents(st);
      setRecent(rc);
    } catch (e) {
      setErr(errMsg(e));
      setStudents((s) => s ?? []);
      setRecent((r) => r ?? []);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    try {
      return backend.watchPresence(setOnline);
    } catch {
      setErr('접속 현황을 불러오지 못했습니다.');
    }
  }, []);

  const today = todayString();
  const classes = useMemo(() => [...new Set((students ?? []).map((s) => s.classNo))].sort((a, b) => a - b), [students]);
  const scope = useMemo(() => (students ?? []).filter((s) => cls === 'all' || s.classNo === cls), [students, cls]);
  const nameOf = useMemo(() => new Map((students ?? []).map((s) => [s.id, s])), [students]);

  const summary = useMemo(() => {
    const kos = scope.filter((s) => (s.bestKo ?? 0) > 0).map((s) => s.bestKo);
    const avgKo = kos.length ? Math.round(kos.reduce((a, b) => a + b, 0) / kos.length) : 0;
    const dist = Array.from({ length: 11 }, () => 0);
    for (const s of scope) dist[Math.min(10, s.position.ko + s.position.symbol)]++;
    const battle = scope.filter((s) => isBattleUnlocked(s.position)).length;
    const goal = scope.filter((s) => s.lastDay === today && s.todaySeconds >= goalMin * 60).length;
    return { avgKo, dist, battle, goal, maxDist: Math.max(1, ...dist) };
  }, [scope, goalMin, today]);

  const absent = scope.filter((s) => s.lastDay !== today).sort((a, b) => a.id.localeCompare(b.id));
  const onlineShown = online.filter((p) => !isMemberId(p.studentId) && (cls === 'all' || p.classNo === cls));

  if (!students || !recent) return <Spinner />;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-2 text-2xl font-black">학습 현황</h1>
        <select
          className="rounded-xl border border-mint-200 bg-white px-3 py-2"
          value={cls}
          onChange={(e) => setCls(e.target.value === 'all' ? 'all' : Number(e.target.value))}
        >
          <option value="all">전체 반</option>
          {classes.map((c) => (
            <option key={c} value={c}>
              {c}반
            </option>
          ))}
        </select>
        <Btn small variant="ghost" className="ml-auto" onClick={() => void load()} disabled={loading}>
          {loading ? '불러오는 중...' : '↻ 새로 고침'}
        </Btn>
      </div>
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-miss">{err}</p>}

      <Card>
        <h2 className="mb-2 font-bold">
          지금 접속 중 <span className="text-mint-600">{onlineShown.length}명</span>
        </h2>
        {onlineShown.length === 0 ? (
          <p className="text-sm text-ink/60">지금 접속 중인 학생이 없습니다.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {onlineShown
              .slice()
              .sort((a, b) => a.classNo - b.classNo || a.name.localeCompare(b.name))
              .map((p) => (
                <span key={p.studentId} className="rounded-full bg-mint-100 px-3 py-1 text-sm">
                  <b>{p.name}</b> <span className="text-ink/60">{p.classNo}반 · {p.doing || '대기'}</span>
                </span>
              ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-bold">{cls === 'all' ? '전체' : `${cls}반`} 요약 ({scope.length}명)</h2>
          <div className="mb-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-mint-50 p-3">
              <div className="text-xs text-ink/60">평균 한글 타수</div>
              <div className="text-2xl font-black tabular-nums">{summary.avgKo}</div>
            </div>
            <div className="rounded-xl bg-mint-50 p-3">
              <div className="text-xs text-ink/60">배틀 개방</div>
              <div className="text-2xl font-black tabular-nums">{summary.battle}명</div>
            </div>
            <div className="rounded-xl bg-mint-50 p-3">
              <div className="text-xs text-ink/60">오늘 목표({goalMin}분) 달성</div>
              <div className="text-2xl font-black tabular-nums">{summary.goal}명</div>
            </div>
          </div>
          <h3 className="mb-1 text-sm font-bold text-ink/70">자리연습 단계 분포 (한글+기호, 0~10)</h3>
          <svg viewBox="0 0 330 130" className="w-full" role="img" aria-label="자리연습 단계별 학생 수 막대 그래프">
            {summary.dist.map((n, i) => {
              const h = (n / summary.maxDist) * 85;
              return (
                <g key={i}>
                  <rect x={i * 30 + 4} y={100 - h} width="22" height={h} rx="3" fill="var(--color-mint-500)">
                    <title>{`${i}단계: ${n}명`}</title>
                  </rect>
                  <text x={i * 30 + 15} y={95 - h} textAnchor="middle" fontSize="10" fill="var(--color-ink)">
                    {n > 0 ? n : ''}
                  </text>
                  <text x={i * 30 + 15} y={116} textAnchor="middle" fontSize="11" fill="var(--color-ink)" opacity="0.6">
                    {i}
                  </text>
                </g>
              );
            })}
            <line x1="0" x2="330" y1="100" y2="100" stroke="var(--color-mint-200)" />
          </svg>
        </Card>

        <Card>
          <h2 className="mb-2 font-bold">
            오늘 연습하지 않은 학생 <span className="text-miss">{absent.length}명</span>
          </h2>
          {absent.length === 0 ? (
            <p className="text-sm text-ink/60">모두 오늘 연습했어요!</p>
          ) : (
            <div className="flex max-h-64 flex-wrap gap-2 overflow-y-auto">
              {absent.map((s) => (
                <span key={s.id} className="rounded-full bg-mint-50 px-3 py-1 text-sm">
                  {s.classNo}반 {s.name}
                </span>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-2 font-bold">최근 연습 기록 30건</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-ink/60">아직 연습 기록이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-mint-200 text-left text-ink/60">
                  <th className="py-1.5">시각</th>
                  <th>반</th>
                  <th>이름</th>
                  <th>종류</th>
                  <th>타수</th>
                  <th>정확도</th>
                  <th>시간</th>
                </tr>
              </thead>
              <tbody>
                {recent
                  .slice()
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((r, i) => {
                    const st = nameOf.get(r.studentId);
                    const noKpm = r.mode === 'battle' || r.mode === 'quiz';
                    return (
                      <tr key={r.id ?? i} className="border-b border-mint-100 last:border-0">
                        <td className="py-1.5 tabular-nums text-ink/60">
                          {new Date(r.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td>{r.classNo}반</td>
                        <td className="font-bold">{st?.name ?? '(삭제됨)'}</td>
                        <td>
                          {MODE_LABEL[r.mode] ?? r.mode}
                          <span className="ml-1 text-xs text-ink/50">{r.lang === 'ko' ? '한글' : '영문'}</span>
                        </td>
                        <td className="tabular-nums">{noKpm ? (r.score != null ? `${r.score}점` : '-') : `${r.kpm}타`}</td>
                        <td className="tabular-nums">{noKpm ? '-' : `${r.accuracy}%`}</td>
                        <td className="tabular-nums">{r.seconds}초</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
