// 수행평가(선생님): 설정(열기/닫기·언어·시간·횟수·지문), 등급표, 결과 표·요약, 초기화, CSV 내보내기.
// 설정은 backend.watchSettings 로 읽고 바꾸면 바로 updateSettings({ exam }) 로 저장한다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { backend } from '../../data';
import { AppError, DEFAULT_EXAM, SUBJECT_LABEL, type ExamConfig, type ExamGrade, type Lang, type Student } from '../../data/types';
import { examTable, normalizeText } from '../../engine';
import { useContent } from '../../content';
import { GRADE_BG, GradeBadge } from '../../components/ExamGradeBadge';
import { Btn, Card, Modal, Spinner } from '../../components/ui';

const GRADES: ExamGrade[] = ['A', 'B', 'C', 'D', 'E'];
const LANG_LABEL: Record<Lang, string> = { ko: '한글', en: '영어' };
const charCount = (t: string) => Array.from(normalizeText(t).replace(/\s+/g, ' ').trim()).length;

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const fmtAt = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const errMsg = (e: unknown) => (e instanceof AppError && e.code === 'PERMISSION' ? '권한이 없습니다.' : '저장하지 못했습니다. 잠시 후 다시 시도하세요.');

function buildCsv(rows: Student[]): string {
  const head = [
    '학번', '이름', '반', '번호',
    '한글 등급', '한글 타수', '한글 정확도', '한글 응시 횟수',
    '영어 등급', '영어 타수', '영어 정확도', '영어 응시 횟수',
  ];
  const lines = [head.map(csvCell).join(',')];
  for (const s of rows) {
    const cells: (string | number)[] = [s.id, s.name, s.classNo, s.number];
    for (const l of ['ko', 'en'] as Lang[]) {
      const r = s.exam?.[l];
      cells.push(r ? r.grade : '', r ? r.kpm : '', r ? r.accuracy : '', r ? r.attempts : '');
    }
    lines.push(cells.map(csvCell).join(','));
  }
  // UTF-8 BOM: 엑셀·구글 시트에서 한글이 깨지지 않게
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export default function TeacherExam() {
  const [cfg, setCfg] = useState<ExamConfig>(DEFAULT_EXAM);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<'' | 'saving' | 'saved' | 'error'>('');
  const [err, setErr] = useState('');
  const [title, setTitle] = useState(DEFAULT_EXAM.title);

  useEffect(() => {
    try {
      return backend.watchSettings((s) => {
        const e = { ...DEFAULT_EXAM, ...s?.exam };
        setCfg(e);
        setTitle(e.title);
        setLoaded(true);
      });
    } catch {
      setErr('설정을 불러오지 못했습니다.');
    }
  }, []);

  const save = async (patch: Partial<ExamConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    setState('saving');
    setErr('');
    try {
      await backend.updateSettings({ exam: next });
      setState('saved');
      window.setTimeout(() => setState(''), 2000);
    } catch (e) {
      setState('error');
      setErr(errMsg(e));
    }
  };

  const langs: Lang[] = cfg.langs.length ? cfg.langs : ['ko'];
  const langMode: 'ko' | 'en' | 'both' = langs.length > 1 ? 'both' : langs[0];

  // ── 결과 ──
  const [students, setStudents] = useState<Student[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [cls, setCls] = useState<'all' | number>('all');
  const [lang, setLang] = useState<Lang>('ko');
  const [sort, setSort] = useState<'number' | 'kpm'>('number');
  const [resetOne, setResetOne] = useState<Student | null>(null);
  const [resetAll, setResetAll] = useState(false);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStudents(await backend.listStudents());
    } catch (e) {
      setMsg(e instanceof AppError && e.code === 'PERMISSION' ? '권한이 없습니다.' : '학생 정보를 불러오지 못했습니다.');
      setStudents((s) => s ?? []);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const classes = useMemo(() => [...new Set((students ?? []).map((s) => s.classNo))].sort((a, b) => a - b), [students]);
  const scope = useMemo(() => (students ?? []).filter((s) => cls === 'all' || s.classNo === cls), [students, cls]);
  const taken = (s: Student) => s.exam?.[lang]?.attempts;
  const rows = useMemo(() => {
    const list = scope.slice();
    list.sort((a, b) => {
      if (sort === 'kpm') return (b.exam?.[lang]?.kpm ?? -1) - (a.exam?.[lang]?.kpm ?? -1) || a.id.localeCompare(b.id);
      return a.id.localeCompare(b.id);
    });
    return list;
  }, [scope, sort, lang]);

  const summary = useMemo(() => {
    const done = scope.filter((s) => s.exam?.[lang] && s.exam[lang]!.at > 0);
    const dist: Record<ExamGrade, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    for (const s of done) dist[s.exam![lang]!.grade]++;
    const avg = done.length ? Math.round(done.reduce((a, s) => a + s.exam![lang]!.kpm, 0) / done.length) : 0;
    return { total: scope.length, done: done.length, dist, avg, max: Math.max(1, ...Object.values(dist)) };
  }, [scope, lang]);

  const doReset = async (targets: Student[]) => {
    setBusy(true);
    setMsg('');
    try {
      for (const s of targets) {
        const rest = { ...(s.exam ?? {}) };
        delete rest[lang];
        await backend.teacherUpdateStudent(s.id, { exam: rest });
      }
      setMsg(`${targets.length}명의 ${LANG_LABEL[lang]} 결과를 초기화했습니다.`);
      await load();
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setBusy(false);
      setResetOne(null);
      setResetAll(false);
      setWord('');
    }
  };

  const exportCsv = () => {
    const blob = new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `타자훈련소_수행평가_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetTargets = scope.filter((s) => s.exam?.[lang]);

  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-black">수행평가</h1>
        <span className="text-sm font-bold text-mint-700" aria-live="polite">
          {state === 'saving' ? '저장 중...' : state === 'saved' ? '✓ 저장됨' : ''}
        </span>
      </div>
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-miss">{err}</p>}

      <SettingsCard cfg={cfg} loaded={loaded} langMode={langMode} title={title} setTitle={setTitle} save={save} />

      <Card>
        <div className="mb-3 font-bold">등급 기준표 (1분 평균 타수)</div>
        <div className="grid grid-cols-2 gap-6">
          {(['ko', 'en'] as Lang[]).map((l) => (
            <div key={l}>
              <div className="mb-1 text-sm font-bold text-ink/60">{LANG_LABEL[l]}</div>
              <table className="w-full text-left text-sm">
                <tbody>
                  {examTable(l).map((r) => (
                    <tr key={r.grade} className="border-b border-mint-100 last:border-0">
                      <td className="w-12 py-1">
                        <GradeBadge grade={r.grade} size={24} />
                      </td>
                      <td className="font-bold tabular-nums">{r.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-2 font-bold">결과</div>
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
          <div className="flex overflow-hidden rounded-xl border border-mint-200">
            {(['ko', 'en'] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-4 py-2 font-bold ${lang === l ? 'bg-mint-500 text-white' : 'bg-white text-ink/70 hover:bg-mint-50'}`}
              >
                {LANG_LABEL[l]}
              </button>
            ))}
          </div>
          <select
            className="rounded-xl border border-mint-200 bg-white px-3 py-2"
            value={sort}
            onChange={(e) => setSort(e.target.value as 'number' | 'kpm')}
            aria-label="정렬"
          >
            <option value="number">번호순</option>
            <option value="kpm">타수순</option>
          </select>
          <div className="ml-auto flex gap-2">
            <Btn variant="ghost" small onClick={() => void load()} disabled={loading}>
              {loading ? '불러오는 중...' : '새로 고침'}
            </Btn>
            <Btn variant="ghost" small onClick={exportCsv} disabled={!rows.length}>
              CSV 내보내기
            </Btn>
            <Btn variant="danger" small onClick={() => setResetAll(true)} disabled={!resetTargets.length}>
              전체 초기화
            </Btn>
          </div>
        </div>
        {msg && <p className="rounded-lg bg-mint-50 px-3 py-2 text-sm font-bold text-mint-700">{msg}</p>}

        {/* 요약 */}
        <div className="flex flex-wrap items-end gap-8 rounded-xl bg-mint-50 px-4 py-3">
          <div>
            <div className="text-xs text-ink/60">응시 인원</div>
            <div className="text-2xl font-black tabular-nums">
              {summary.done} <span className="text-base font-bold text-ink/50">/ {summary.total}</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-ink/60">평균 타수</div>
            <div className="text-2xl font-black tabular-nums">{summary.done ? summary.avg : '-'}</div>
          </div>
          <div className="flex flex-1 items-end gap-3">
            {GRADES.map((g) => (
              <div key={g} className="flex w-12 flex-col items-center gap-1">
                <span className="text-sm font-bold tabular-nums">{summary.dist[g]}</span>
                <div className="flex h-16 w-full items-end">
                  <div
                    className={`w-full rounded-t ${GRADE_BG[g]}`}
                    style={{ height: `${Math.max(summary.dist[g] ? 6 : 2, (summary.dist[g] / summary.max) * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-black">{g}</span>
              </div>
            ))}
          </div>
        </div>

        {!students ? (
          <Spinner />
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-center text-sm">
              <thead>
                <tr className="border-b border-mint-200 text-ink/60">
                  {['학번', '이름', '등급', '최종 타수', '정확도', '오타', '응시', '응시 일시', ''].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-2 font-bold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-8 text-ink/60">
                      학생이 없습니다.
                    </td>
                  </tr>
                )}
                {rows.map((s) => {
                  const r = s.exam?.[lang];
                  const none = !r;
                  const aborted = !!r && r.at === 0; // 시작만 하고 끝내지 못함
                  return (
                    <tr key={s.id} className="border-b border-mint-100">
                      <td className="px-2 py-1.5 tabular-nums text-ink/60">{s.id}</td>
                      <td className="px-2 font-bold">{s.name}</td>
                      {none ? (
                        <td colSpan={6} className="text-ink/40">
                          미응시
                        </td>
                      ) : (
                        <>
                          <td className="px-2">{aborted ? <span className="text-ink/40">-</span> : <GradeBadge grade={r.grade} size={26} />}</td>
                          <td className="px-2 font-bold tabular-nums">{aborted ? '중단' : r.kpm}</td>
                          <td className="px-2 tabular-nums">{aborted ? '-' : `${r.accuracy}%`}</td>
                          <td className="px-2 tabular-nums">{aborted ? '-' : r.typos}</td>
                          <td className="px-2 tabular-nums">{taken(s)}</td>
                          <td className="whitespace-nowrap px-2 tabular-nums text-ink/60">{aborted ? '-' : fmtAt(r.at)}</td>
                        </>
                      )}
                      <td className="px-2">
                        {!none && (
                          <Btn variant="ghost" small onClick={() => setResetOne(s)}>
                            응시 기회 초기화
                          </Btn>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {resetOne && (
        <Modal onClose={() => !busy && setResetOne(null)}>
          <h2 className="text-xl font-black">응시 기회 초기화</h2>
          <p className="mt-3 text-ink/80">
            {resetOne.id} {resetOne.name} 학생의 <b>{LANG_LABEL[lang]}</b> 수행평가 결과(등급·타수·응시 횟수)를 지우고 처음부터 다시 응시하게 합니다. 되돌릴 수 없어요.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setResetOne(null)} disabled={busy}>
              취소
            </Btn>
            <Btn variant="danger" onClick={() => void doReset([resetOne])} disabled={busy}>
              {busy ? '처리 중...' : '초기화'}
            </Btn>
          </div>
        </Modal>
      )}
      {resetAll && (
        <Modal
          onClose={() => {
            if (!busy) {
              setResetAll(false);
              setWord('');
            }
          }}
        >
          <h2 className="text-xl font-black">전체 초기화</h2>
          <p className="mt-3 text-ink/80">
            {cls === 'all' ? '전체 반' : `${cls}반`} {resetTargets.length}명의 <b>{LANG_LABEL[lang]}</b> 수행평가 결과를 모두 지웁니다. 되돌릴 수 없어요. 실행하려면 아래에 <b>초기화</b> 를 입력하세요.
          </p>
          <input
            value={word}
            onChange={(e) => setWord(e.target.value)}
            className="mt-3 w-full rounded-xl border-2 border-mint-200 px-3 py-2 focus:border-mint-500 focus:outline-none"
            aria-label="확인 문구"
            autoFocus
          />
          <div className="mt-6 flex justify-end gap-2">
            <Btn
              variant="ghost"
              onClick={() => {
                setResetAll(false);
                setWord('');
              }}
              disabled={busy}
            >
              취소
            </Btn>
            <Btn variant="danger" onClick={() => void doReset(resetTargets)} disabled={busy || word.trim() !== '초기화'}>
              {busy ? '처리 중...' : '전체 초기화'}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SettingsCard({
  cfg,
  loaded,
  langMode,
  title,
  setTitle,
  save,
}: {
  cfg: ExamConfig;
  loaded: boolean;
  langMode: 'ko' | 'en' | 'both';
  title: string;
  setTitle: (t: string) => void;
  save: (p: Partial<ExamConfig>) => Promise<void>;
}) {
  const passages = useContent((s) => s.passages);
  const koList = useMemo(() => passages.filter((p) => p.lang === 'ko'), [passages]);
  const enList = useMemo(() => passages.filter((p) => p.lang === 'en'), [passages]);
  const showKo = langMode !== 'en';
  const showEn = langMode !== 'ko';

  const passageSelect = (lang: Lang, list: typeof koList, value: string) => (
    <label className="block">
      <span className="text-sm font-bold text-ink/70">{LANG_LABEL[lang]} 지문</span>
      <select
        className="mt-1 w-full rounded-xl border border-mint-200 bg-white px-3 py-2"
        value={list.some((p) => p.id === value) ? value : 'random'}
        onChange={(e) => void save(lang === 'ko' ? { passageKo: e.target.value } : { passageEn: e.target.value })}
      >
        <option value="random">무작위 (학생마다 고정된 순서)</option>
        {list.map((p) => (
          <option key={p.id} value={p.id}>
            [{SUBJECT_LABEL[p.subject]}] {p.title} · {charCount(p.text)}자
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Card className={`space-y-4 ${loaded ? '' : 'opacity-60'}`}>
      {/* 열기/닫기 */}
      <button
        onClick={() => void save({ open: !cfg.open })}
        aria-pressed={cfg.open}
        className={`flex w-full items-center justify-between rounded-2xl px-6 py-4 text-left transition focus:outline-none focus-visible:ring-4 focus-visible:ring-mint-300 ${
          cfg.open ? 'bg-gold text-ink ring-4 ring-gold/30' : 'bg-ink/10 text-ink/70'
        }`}
      >
        <div>
          <div className="text-xl font-black">{cfg.open ? '🟢 평가 진행 중 (열림)' : '⚪ 평가 닫힘'}</div>
          <div className="text-sm">{cfg.open ? '학생이 응시할 수 있어요. 눌러서 닫기' : '학생은 응시할 수 없어요. 눌러서 열기'}</div>
        </div>
        <span className={`relative h-9 w-16 rounded-full ${cfg.open ? 'bg-ink' : 'bg-ink/30'}`}>
          <span className={`absolute top-1 h-7 w-7 rounded-full bg-white shadow transition-all ${cfg.open ? 'left-8' : 'left-1'}`} />
        </span>
      </button>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-bold text-ink/70">평가 제목</span>
          <input
            value={title}
            maxLength={40}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              const t = title.trim() || DEFAULT_EXAM.title;
              setTitle(t);
              if (t !== cfg.title) void save({ title: t });
            }}
            className="mt-1 w-full rounded-xl border border-mint-200 bg-white px-3 py-2"
          />
        </label>
        <div>
          <span className="text-sm font-bold text-ink/70">평가 언어</span>
          <div className="mt-1 flex overflow-hidden rounded-xl border border-mint-200">
            {(
              [
                ['ko', '한글', ['ko']],
                ['en', '영어', ['en']],
                ['both', '둘 다', ['ko', 'en']],
              ] as const
            ).map(([k, label, v]) => (
              <button
                key={k}
                onClick={() => void save({ langs: [...v] })}
                className={`flex-1 px-3 py-2 font-bold ${langMode === k ? 'bg-mint-500 text-white' : 'bg-white text-ink/70 hover:bg-mint-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="text-sm font-bold text-ink/70">제한 시간</span>
          <Stepper value={cfg.minutes} min={1} max={10} unit="분" onChange={(n) => void save({ minutes: n })} />
        </div>
        <div>
          <span className="text-sm font-bold text-ink/70">최대 응시 횟수 (언어별)</span>
          <Stepper value={cfg.maxAttempts} min={1} max={5} unit="회" onChange={(n) => void save({ maxAttempts: n })} />
        </div>
        {showKo && passageSelect('ko', koList, cfg.passageKo)}
        {showEn && passageSelect('en', enList, cfg.passageEn)}
      </div>
      <p className="text-xs text-ink/50">
        지문을 다 치면 같은 언어의 다른 장문으로 이어져요(지정 지문 → 나머지는 학번 기준 고정 순서). 설정은 바로 저장돼요.
      </p>
    </Card>
  );
}

function Stepper({ value, min, max, unit, onChange }: { value: number; min: number; max: number; unit: string; onChange: (n: number) => void }) {
  const v = Math.min(max, Math.max(min, Number(value) || min));
  return (
    <div className="mt-1 flex items-center gap-3">
      <Btn variant="ghost" small onClick={() => onChange(Math.max(min, v - 1))} disabled={v <= min} aria-label="줄이기">
        −
      </Btn>
      <span className="w-16 text-center text-xl font-black tabular-nums">
        {v}
        {unit}
      </span>
      <Btn variant="ghost" small onClick={() => onChange(Math.min(max, v + 1))} disabled={v >= max} aria-label="늘리기">
        ＋
      </Btn>
    </div>
  );
}
