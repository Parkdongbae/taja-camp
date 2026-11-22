// 전체 순위: 배틀 / 한글 타수 / 영문 타수 / 퀴즈 / 성실 탭. 학생 목록을 불러와 클라이언트에서 정렬한다.
// 학번은 표시하지 않는다. 값이 0인 학생은 순위에서 제외. rankingPublic 이 꺼져 있으면 내 기록만 보여 준다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { backend } from '../data';
import { AppError, type Student } from '../data/types';
import { TIERS, tierOf } from '../engine/scoring';
import { useAuth } from '../state/auth';
import { Btn, Card, Spinner } from '../components/ui';
import { TierBadge } from '../components/TierBadge';

type TabId = 'battle' | 'ko' | 'en' | 'quiz' | 'days';
const TABS: { id: TabId; label: string }[] = [
  { id: 'battle', label: '배틀' },
  { id: 'ko', label: '한글 타수' },
  { id: 'en', label: '영문 타수' },
  { id: 'quiz', label: '퀴즈' },
  { id: 'days', label: '성실' },
];

// 정렬 키(클수록 위). 첫 값이 0 이하면 순위에서 제외.
function keyOf(tab: TabId, s: Student): number[] {
  switch (tab) {
    case 'battle':
      return [s.rp ?? 0, s.wins ?? 0];
    case 'ko':
      return [s.bestKo ?? 0];
    case 'en':
      return [s.bestEn ?? 0];
    case 'quiz':
      return [s.quizPoints ?? 0];
    case 'days':
      return [s.days ?? 0, s.totalSeconds ?? 0];
  }
}

function valueText(tab: TabId, s: Student): string {
  switch (tab) {
    case 'battle':
      return `RP ${(s.rp ?? 0).toLocaleString()}`;
    case 'ko':
      return `${s.bestKo ?? 0}타`;
    case 'en':
      return `${s.bestEn ?? 0}타`;
    case 'quiz':
      return `${(s.quizPoints ?? 0).toLocaleString()}점`;
    case 'days': {
      const m = Math.round((s.totalSeconds ?? 0) / 60);
      return `${s.days ?? 0}일 · ${m}분`;
    }
  }
}

const sameKey = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const MEDAL = ['🥇', '🥈', '🥉'];

function errMsg(e: unknown): string {
  if (e instanceof AppError && e.code === 'PERMISSION') return '권한이 없습니다.';
  if (e instanceof AppError && e.code === 'NETWORK') return '인터넷 연결을 확인하세요.';
  return '순위를 불러오지 못했습니다. 잠시 후 다시 시도하세요.';
}

export default function Ranking() {
  const { student: me, settings } = useAuth();
  const [tab, setTab] = useState<TabId>('battle');
  const [classFilter, setClassFilter] = useState<'all' | number>('all');
  const [tierFilter, setTierFilter] = useState<'all' | number>('all');
  const [list, setList] = useState<Student[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const isPublic = settings.rankingPublic !== false;

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      setList(await backend.listStudents());
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isPublic) void load();
  }, [isPublic, load]);

  const classes = useMemo(() => [...new Set((list ?? []).map((s) => s.classNo))].sort((a, b) => a - b), [list]);

  const ranked = useMemo(() => {
    let rows = (list ?? []).filter((s) => keyOf(tab, s)[0] > 0);
    if (classFilter !== 'all') rows = rows.filter((s) => s.classNo === classFilter);
    if (tab === 'battle' && tierFilter !== 'all') rows = rows.filter((s) => tierOf(s.rp ?? 0) === tierFilter);
    const keyed = rows.map((s) => ({ s, k: keyOf(tab, s) }));
    keyed.sort((a, b) => {
      for (let i = 0; i < a.k.length; i++) if (a.k[i] !== b.k[i]) return b.k[i] - a.k[i];
      return a.s.classNo - b.s.classNo || a.s.number - b.s.number;
    });
    // 같은 값이면 같은 순위(1, 2, 2, 4)
    return keyed.map((r, i) => {
      let place = i + 1;
      if (i > 0 && sameKey(r.k, keyed[i - 1].k)) {
        let j = i;
        while (j > 0 && sameKey(keyed[j - 1].k, r.k)) j--;
        place = j + 1;
      }
      return { ...r, place };
    });
  }, [list, tab, classFilter, tierFilter]);

  const mine = me ? ranked.find((r) => r.s.id === me.id) : undefined;
  const meVal = me ? keyOf(tab, me)[0] : 0;

  const tabBtn = (id: TabId, label: string) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      className={`rounded-xl px-4 py-2 font-bold transition ${
        tab === id ? 'bg-mint-500 text-white' : 'bg-white text-ink hover:bg-mint-100'
      }`}
    >
      {label}
    </button>
  );

  const sel = 'rounded-xl border border-mint-200 bg-white px-3 py-2 text-sm outline-none focus:border-mint-500';

  const myLine = me && (
    <div className="flex items-center gap-3 rounded-2xl bg-mint-100 px-5 py-3 ring-2 ring-mint-300">
      <span className="font-black text-mint-700">★ 내 순위</span>
      <span className="text-xl font-black tabular-nums">
        {isPublic ? (mine ? `${mine.place}위` : meVal > 0 ? '범위 밖' : '순위 없음') : '비공개'}
      </span>
      <span className="font-bold">
        {me.classNo}반 {me.name}
      </span>
      <TierBadge tier={tierOf(me.rp ?? 0)} />
      <span className="ml-auto font-bold tabular-nums">{valueText(tab, me)}</span>
    </div>
  );

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black">🏆 전체 순위</h1>
        {isPublic && (
          <Btn variant="ghost" small onClick={() => void load()} disabled={loading}>
            {loading ? '불러오는 중...' : '↻ 새로 고침'}
          </Btn>
        )}
      </div>

      <div className="flex flex-wrap gap-2">{TABS.map((t) => tabBtn(t.id, t.label))}</div>

      {!isPublic ? (
        <>
          <Card className="text-center text-ink/70">선생님이 순위표를 꺼 두었어요. 내 기록만 볼 수 있어요.</Card>
          {myLine}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              범위
              <select
                className={sel}
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              >
                <option value="all">전체</option>
                {classes.map((c) => (
                  <option key={c} value={c}>
                    {c}반
                  </option>
                ))}
              </select>
            </label>
            {tab === 'battle' && (
              <label className="flex items-center gap-2">
                계급
                <select
                  className={sel}
                  value={tierFilter}
                  onChange={(e) => setTierFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                >
                  <option value="all">모든 계급</option>
                  {TIERS.map((t, i) => (
                    <option key={t.name} value={i}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span className="text-ink/50">
              {tab === 'battle' ? '같은 RP 면 승수가 많은 순' : tab === 'days' ? '연습 일수 → 연습 시간 순' : '값이 0인 학생은 제외'}
            </span>
          </div>

          {myLine}

          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-miss">{err}</p>}

          {!list && !err ? (
            <div className="h-32">
              <Spinner />
            </div>
          ) : (
            <Card className="p-0">
              {ranked.length === 0 ? (
                <p className="p-8 text-center text-ink/60">아직 순위에 오른 학생이 없어요.</p>
              ) : (
                <ol>
                  {ranked.slice(0, 20).map((r) => (
                    <li
                      key={r.s.id}
                      className={`flex items-center gap-3 border-b border-mint-100 px-5 py-3 last:border-0 ${
                        r.s.id === me?.id ? 'bg-mint-50 font-bold' : ''
                      }`}
                    >
                      <span className="w-10 text-center text-xl font-black tabular-nums">
                        {r.place <= 3 ? MEDAL[r.place - 1] : r.place}
                      </span>
                      <span className="w-12 text-ink/60">{r.s.classNo}반</span>
                      <span className="flex-1 font-bold">{r.s.name}</span>
                      <TierBadge tier={tierOf(r.s.rp ?? 0)} />
                      <span className="w-32 text-right font-bold tabular-nums">{valueText(tab, r.s)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
