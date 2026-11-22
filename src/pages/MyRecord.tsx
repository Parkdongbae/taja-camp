// 내 기록: 요약 카드, 타수 성장 그래프(SVG), 약점 글쇠 지도, 최근 연습 10건, 배지 목록.
import { useEffect, useMemo, useState } from 'react';
import { backend } from '../data';
import type { Lang, SessionMode, SessionRecord, Student } from '../data/types';
import { BADGES, levelProgress, tierProgress, todayString } from '../engine/scoring';
import { KEYBOARD_WIDTH, keysFor } from '../engine/layout';
import { useAuth } from '../state/auth';
import { usePrefs } from '../state/prefs';
import { Card, Spinner } from '../components/ui';
import { TierBadge } from '../components/TierBadge';

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
const GRAPH_MODES: SessionMode[] = ['word', 'sentence', 'passage'];

const fmtMinutes = (sec: number) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
};
const dayOf = (ms: number) => todayString(new Date(ms));
const shortDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

function Bar({ ratio, color = 'bg-mint-500' }: { ratio: number; color?: string }) {
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-mint-100">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%` }} />
    </div>
  );
}

function Summary({ s }: { s: Student }) {
  const lv = levelProgress(s.xp ?? 0);
  const tp = tierProgress(s.rp ?? 0);
  const tile = (label: string, value: string, sub?: string) => (
    <Card className="text-center">
      <div className="text-sm text-ink/60">{label}</div>
      <div className="mt-1 text-2xl font-black tabular-nums">{value}</div>
      {sub && <div className="text-xs text-ink/50">{sub}</div>}
    </Card>
  );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tile('최고 한글 타수', `${s.bestKo ?? 0}타`)}
        {tile('최고 영문 타수', `${s.bestEn ?? 0}타`)}
        {tile('누적 연습 시간', fmtMinutes(s.totalSeconds ?? 0))}
        {tile('연습 일수', `${s.days ?? 0}일`)}
        {tile('연속 횟수', `${s.streak ?? 0}회`)}
        {tile('퀴즈 점수', `${(s.quizPoints ?? 0).toLocaleString()}점`)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="font-bold">레벨 {lv.level}</span>
            <span className="text-sm text-ink/60">
              경험치 {lv.cur} / {lv.need}
            </span>
          </div>
          <Bar ratio={lv.ratio} />
        </Card>
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <TierBadge tier={tp.tier} />
            <span className="text-sm text-ink/60">
              {tp.next === null ? `RP ${tp.cur} · 최고 계급` : `RP ${tp.cur} / ${tp.next}`}
            </span>
          </div>
          <Bar ratio={tp.ratio} color="bg-gold" />
        </Card>
      </div>
    </div>
  );
}

// 날짜별 평균·최고 타수 꺾은선
function GrowthChart({ sessions }: { sessions: SessionRecord[] }) {
  const [lang, setLang] = useState<Lang>('ko');
  const points = useMemo(() => {
    const byDay = new Map<string, { ms: number; ks: number[] }>();
    for (const r of sessions) {
      if (r.lang !== lang || !GRAPH_MODES.includes(r.mode) || !(r.kpm > 0)) continue;
      const d = dayOf(r.createdAt);
      const e = byDay.get(d) ?? { ms: r.createdAt, ks: [] };
      e.ks.push(r.kpm);
      byDay.set(d, e);
    }
    return [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([, e]) => ({
        ms: e.ms,
        avg: e.ks.reduce((a, b) => a + b, 0) / e.ks.length,
        max: Math.max(...e.ks),
      }));
  }, [sessions, lang]);

  const W = 560;
  const H = 240;
  const L = 44;
  const R = 16;
  const T = 16;
  const B = 32;
  const top = Math.max(100, Math.ceil(Math.max(0, ...points.map((p) => p.max)) / 50) * 50);
  const x = (i: number) => (points.length <= 1 ? (L + W - R) / 2 : L + ((W - L - R) * i) / (points.length - 1));
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const line = (key: 'avg' | 'max') => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((r) => Math.round(top * r));
  const step = Math.max(1, Math.ceil(points.length / 8));

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-bold">타수 성장 그래프</h2>
        <div className="flex gap-1">
          {(['ko', 'en'] as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`rounded-lg px-3 py-1 text-sm font-bold ${lang === l ? 'bg-mint-500 text-white' : 'bg-mint-50 hover:bg-mint-100'}`}
            >
              {l === 'ko' ? '한글' : '영문'}
            </button>
          ))}
        </div>
      </div>
      {points.length === 0 ? (
        <p className="py-12 text-center text-ink/60">
          아직 {lang === 'ko' ? '한글' : '영문'} 낱말·단문·장문 기록이 없어요. 연습을 하면 여기에 그래프가 그려져요.
        </p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="날짜별 평균과 최고 타수 꺾은선 그래프">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--color-mint-200)" strokeWidth="1" />
                <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--color-ink)" opacity="0.6">
                  {t}
                </text>
              </g>
            ))}
            {points.map(
              (p, i) =>
                i % step === 0 && (
                  <text key={i} x={x(i)} y={H - 10} textAnchor="middle" fontSize="11" fill="var(--color-ink)" opacity="0.6">
                    {shortDate(p.ms)}
                  </text>
                ),
            )}
            {points.length > 1 && (
              <>
                <path d={line('max')} fill="none" stroke="var(--color-gold)" strokeWidth="2.5" strokeLinejoin="round" />
                <path d={line('avg')} fill="none" stroke="var(--color-mint-600)" strokeWidth="2.5" strokeLinejoin="round" />
              </>
            )}
            {points.map((p, i) => (
              <g key={i}>
                <circle cx={x(i)} cy={y(p.max)} r="3.5" fill="var(--color-gold)">
                  <title>{`${shortDate(p.ms)} 최고 ${Math.round(p.max)}타`}</title>
                </circle>
                <circle cx={x(i)} cy={y(p.avg)} r="3.5" fill="var(--color-mint-600)">
                  <title>{`${shortDate(p.ms)} 평균 ${Math.round(p.avg)}타`}</title>
                </circle>
              </g>
            ))}
          </svg>
          <div className="mt-1 flex gap-4 text-xs text-ink/60">
            <span>
              <span className="mr-1 inline-block h-2 w-4 rounded bg-mint-600 align-middle" />
              날짜별 평균
            </span>
            <span>
              <span className="mr-1 inline-block h-2 w-4 rounded bg-gold align-middle" />
              날짜별 최고
            </span>
            <span className="ml-auto">낱말·단문·장문 기록</span>
          </div>
        </>
      )}
    </Card>
  );
}

// 약점 글쇠 지도: weakKeys 가 클수록 진한 빨강
function WeakMap({ weak }: { weak: Record<string, number> }) {
  const kind = usePrefs((p) => p.keyboardKind);
  const keys = useMemo(() => keysFor(kind), [kind]);
  const max = Math.max(0, ...Object.values(weak));
  const rows = Math.max(...keys.map((k) => k.row + 1));
  const top = Object.entries(weak)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([code]) => {
      const k = keys.find((kk) => kk.code === code);
      return k ? (k.label ?? (k.en ? k.en.toUpperCase() : code)) : code;
    });
  return (
    <Card>
      <h2 className="mb-2 font-bold">약점 글쇠 지도</h2>
      {max === 0 ? (
        <p className="py-12 text-center text-ink/60">아직 오타 기록이 없어요. 잘하고 있어요!</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${KEYBOARD_WIDTH} ${rows}`} className="w-full" role="img" aria-label="오타가 많은 글쇠일수록 진한 빨강으로 표시한 키보드">
            {keys.map((k) => {
              const n = weak[k.code] ?? 0;
              const ratio = n / max;
              const h = (k.h ?? 1) - 0.1;
              const label = k.label ?? (k.en ? k.en.toUpperCase() : '');
              return (
                <g key={k.code}>
                  <rect
                    x={k.x + 0.05}
                    y={k.row + (k.dy ?? 0) + 0.05}
                    width={k.w - 0.1}
                    height={h}
                    rx="0.12"
                    fill={n > 0 ? 'var(--color-miss)' : 'var(--color-mint-50)'}
                    fillOpacity={n > 0 ? 0.15 + 0.85 * ratio : 1}
                    stroke="var(--color-mint-200)"
                    strokeWidth="0.03"
                  >
                    <title>{`${label || k.code}: 오타 ${n}번`}</title>
                  </rect>
                  {label && (
                    <text
                      x={k.x + k.w / 2}
                      y={k.row + (k.dy ?? 0) + h / 2 + 0.2}
                      textAnchor="middle"
                      fontSize={k.label ? 0.28 : 0.4}
                      fontWeight="700"
                      fill={ratio > 0.6 ? '#fff' : 'var(--color-ink)'}
                    >
                      {label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <p className="mt-2 text-sm text-ink/60">진할수록 자주 틀린 글쇠예요. 가장 많이 틀린 글쇠: {top.join(', ')}</p>
        </>
      )}
    </Card>
  );
}

function RecentTable({ sessions }: { sessions: SessionRecord[] }) {
  const rows = [...sessions].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
  return (
    <Card>
      <h2 className="mb-2 font-bold">최근 연습 10건</h2>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-ink/60">아직 연습 기록이 없어요.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-mint-200 text-left text-ink/60">
              <th className="py-1.5">종류</th>
              <th>타수</th>
              <th>정확도</th>
              <th>날짜</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const noKpm = r.mode === 'battle' || r.mode === 'quiz';
              return (
                <tr key={r.id ?? i} className="border-b border-mint-100 last:border-0">
                  <td className="py-1.5 font-bold">
                    {MODE_LABEL[r.mode] ?? r.mode}
                    <span className="ml-1 text-xs font-normal text-ink/50">{r.lang === 'ko' ? '한글' : '영문'}</span>
                  </td>
                  <td className="tabular-nums">{noKpm ? (r.score != null ? `${r.score}점` : '-') : `${r.kpm}타`}</td>
                  <td className="tabular-nums">{noKpm ? '-' : `${r.accuracy}%`}</td>
                  <td className="tabular-nums text-ink/60">
                    {new Date(r.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function BadgeList({ have }: { have: string[] }) {
  const got = BADGES.filter((b) => have.includes(b.id)).length;
  return (
    <Card>
      <h2 className="mb-3 font-bold">
        배지 <span className="text-sm font-normal text-ink/60">{got} / {BADGES.length}</span>
      </h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {BADGES.map((b) => {
          const on = have.includes(b.id);
          return (
            <div
              key={b.id}
              className={`flex items-center gap-3 rounded-xl border p-3 ${
                on ? 'border-gold bg-gold/10' : 'border-mint-100 bg-mint-50 opacity-50 grayscale'
              }`}
            >
              <span className="text-3xl">{b.icon}</span>
              <div>
                <div className="font-bold">{b.name}</div>
                <div className="text-xs text-ink/70">{on ? '획득!' : b.desc}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export default function MyRecord() {
  const student = useAuth((s) => s.student);
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [err, setErr] = useState('');
  const id = student?.id;

  useEffect(() => {
    if (!id) return;
    let alive = true;
    backend
      .listSessions(id, 200)
      .then((l) => alive && setSessions(l))
      .catch(() => {
        if (alive) {
          setErr('연습 기록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.');
          setSessions([]);
        }
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (!student) return <Spinner />;
  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 overflow-y-auto p-6">
      <h1 className="text-2xl font-black">📈 내 기록</h1>
      <Summary s={student} />
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-miss">{err}</p>}
      {sessions === null ? (
        <div className="h-32">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <GrowthChart sessions={sessions} />
            <WeakMap weak={student.weakKeys ?? {}} />
          </div>
          <RecentTable sessions={sessions} />
        </>
      )}
      <BadgeList have={student.badges ?? []} />
    </div>
  );
}
