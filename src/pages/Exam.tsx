// 수행평가(학생): 안내 → 3초 카운트다운 → 제한 시간 동안 장문 입력 → 등급 결과.
// 일시정지 없음, 가상 키보드 없음. 최종 타수 = 정타 수 ÷ 제한 시간(분). 가장 좋은 기록이 인정된다.
// 응시 횟수는 시작하는 순간 먼저 +1 로 저장한다(새로 고침으로 횟수를 되돌릴 수 없게).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { backend } from '../data';
import { DEFAULT_EXAM, type ExamGrade, type ExamResult, type Lang, type PassageItem } from '../data/types';
import { EXAM_CUTS, TypingMeter, examGrade, examTable, splitLines } from '../engine';
import { mulberry32, shuffle } from '../engine/rng';
import { useAuth } from '../state/auth';
import { finishSession } from '../state/record';
import { useContent } from '../content';
import TargetText from '../components/TargetText';
import { GRADE_BG, GRADE_TEXT, GradeBadge } from '../components/ExamGradeBadge';
import { Btn, Card, Kbd, Spinner } from '../components/ui';
import { playDone } from '../components/sound';
import { useTypingInput } from '../components/useTypingInput';
import { fmtTime, useShake, useSnapshot, useWindowKey } from '../components/PracticeParts';

const LINE_LEN = 38;
const LANG_LABEL: Record<Lang, string> = { ko: '한글', en: '영어' };
const charLen = (s: string) => Array.from(s).length;

/** 지정 지문 → 나머지는 학번을 씨앗으로 한 고정 순서로 이어 붙여, 시간이 끝날 때까지 모자라지 않을 만큼의 줄 목록을 만든다. */
function buildLines(list: PassageItem[], firstId: string, seed: number, minutes: number): { lines: string[]; title: string } {
  if (list.length === 0) return { lines: [], title: '' };
  let order = shuffle(list, mulberry32(seed));
  const first = list.find((p) => p.id === firstId);
  if (first) order = [first, ...order.filter((p) => p.id !== first.id)];
  const need = minutes * 800; // 분당 800자면 누구도 다 못 친다
  const lines: string[] = [];
  let chars = 0;
  for (let round = 0; round < 20 && chars < need; round++) {
    for (const p of order) {
      for (const l of splitLines(p.text, LINE_LEN)) {
        lines.push(l);
        chars += charLen(l);
      }
      if (chars >= need) break;
    }
  }
  return { lines, title: order[0].title };
}

type Phase = 'intro' | 'run' | 'result';
interface RunResult {
  kpm: number;
  accuracy: number;
  typos: number;
  strokes: number;
  missKeys: Record<string, number>;
}

export default function Exam() {
  const nav = useNavigate();
  const student = useAuth((s) => s.student);
  const settings = useAuth((s) => s.settings);
  const passages = useContent((s) => s.allPassages); // 수행평가 글은 콘텐츠 선택과 무관
  const loaded = useContent((s) => s.loaded);
  const cfg = { ...DEFAULT_EXAM, ...settings.exam };
  const langs: Lang[] = cfg.langs.length ? cfg.langs : ['ko'];

  const [phase, setPhase] = useState<Phase>('intro');
  const [lang, setLang] = useState<Lang>(langs[0]);
  const [round, setRound] = useState(0);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState('');
  const [outcome, setOutcome] = useState<{ run: RunResult; kept: ExamResult; improved: boolean; lang: Lang } | null>(null);
  const [saveState, setSaveState] = useState<'saving' | 'done' | 'error'>('saving');
  // 저장 직후 화면이 구독 갱신을 기다리지 않도록 마지막으로 저장한 기록을 기억한다
  const savedRef = useRef<Partial<Record<Lang, ExamResult>>>({});

  const curLang: Lang = langs.includes(lang) ? lang : langs[0];
  const list = useMemo(() => passages.filter((p) => p.lang === curLang), [passages, curLang]);
  const lines = useMemo(
    () =>
      student
        ? buildLines(list, curLang === 'ko' ? cfg.passageKo : cfg.passageEn, Number(student.id) || 1, cfg.minutes)
        : { lines: [], title: '' },
    // round: 다시 응시할 때 같은 순서로 새로 만든다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, curLang, cfg.passageKo, cfg.passageEn, cfg.minutes, student?.id, round],
  );

  const recordOf = (l: Lang): ExamResult | undefined => {
    const a = savedRef.current[l];
    const b = student?.exam?.[l];
    if (a && (!b || a.attempts >= b.attempts)) return a;
    return b;
  };

  const rec = recordOf(curLang);
  const used = rec?.attempts ?? 0;
  const left = Math.max(0, cfg.maxAttempts - used);
  const canStart = cfg.open && left > 0 && lines.lines.length > 0 && loaded && !starting;

  async function start() {
    if (!student || !canStart) return;
    setStarting(true);
    setErr('');
    const prev = recordOf(curLang);
    const next: ExamResult = {
      kpm: prev?.kpm ?? 0,
      accuracy: prev?.accuracy ?? 0,
      typos: prev?.typos ?? 0,
      grade: prev?.grade ?? 'E',
      at: prev?.at ?? 0,
      ...(prev?.passageTitle ? { passageTitle: prev.passageTitle } : {}),
      attempts: (prev?.attempts ?? 0) + 1,
    };
    try {
      await backend.updateStudent(student.id, { exam: { ...student.exam, ...savedRef.current, [curLang]: next } });
    } catch {
      setErr('응시 기록을 저장하지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요.');
      setStarting(false);
      return;
    }
    savedRef.current[curLang] = next;
    setStarting(false);
    setOutcome(null);
    setRound((r) => r + 1);
    setPhase('run');
  }

  async function onFinish(run: RunResult) {
    if (!student) return;
    const l = curLang;
    const prev = savedRef.current[l] ?? student.exam?.[l];
    const attempts = prev?.attempts ?? 1;
    const improved = run.kpm > (prev?.kpm ?? 0);
    const kept: ExamResult = improved
      ? {
          kpm: run.kpm,
          accuracy: run.accuracy,
          typos: run.typos,
          grade: examGrade(l, run.kpm),
          attempts,
          at: Date.now(),
          ...(lines.title ? { passageTitle: lines.title } : {}),
        }
      : { ...(prev as ExamResult), attempts };
    setOutcome({ run, kept, improved, lang: l });
    setSaveState('saving');
    setPhase('result');
    try {
      await finishSession({
        mode: 'exam',
        lang: l,
        kpm: run.kpm,
        accuracy: run.accuracy,
        typos: run.typos,
        strokes: run.strokes,
        seconds: cfg.minutes * 60,
        missKeys: run.missKeys,
      });
      const cur = useAuth.getState().student;
      await backend.updateStudent(student.id, { exam: { ...cur?.exam, ...savedRef.current, [l]: kept } });
      savedRef.current[l] = kept;
      setSaveState('done');
    } catch (e) {
      console.error('수행평가 저장 실패', e);
      setSaveState('error');
    }
  }

  // 안내 화면 단축키
  useWindowKey(
    (e) => {
      if (e.key === 'Escape') nav('/home');
      else if (e.key === 'Enter' && !e.repeat && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        void start();
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && langs.length > 1) setLang(curLang === 'ko' ? 'en' : 'ko');
    },
    phase === 'intro',
  );

  if (!student) return null;

  if (phase === 'run') {
    return (
      <ExamRun
        key={round}
        lang={curLang}
        lines={lines.lines}
        title={cfg.title}
        minutes={cfg.minutes}
        onFinish={(r) => void onFinish(r)}
      />
    );
  }

  if (phase === 'result' && outcome) {
    const attemptsLeft = Math.max(0, cfg.maxAttempts - outcome.kept.attempts);
    return (
      <ResultView
        outcome={outcome}
        saveState={saveState}
        canRetry={attemptsLeft > 0 && cfg.open}
        attemptsLeft={attemptsLeft}
        onHome={() => nav('/home')}
        onRetry={() => void start()}
        starting={starting}
        err={err}
      />
    );
  }

  const mine = (['ko', 'en'] as Lang[]).flatMap((l) => {
    const r = recordOf(l);
    return r ? [{ lang: l, r }] : [];
  });

  if (!cfg.open) {
    return (
      <div className="mx-auto flex h-full max-w-2xl flex-col justify-center gap-5 p-6">
        <Card className="text-center">
          <div className="text-5xl">📝</div>
          <h1 className="mt-2 text-2xl font-black">지금은 수행평가 기간이 아닙니다</h1>
          <p className="mt-1 text-ink/60">선생님이 수행평가를 열면 이 화면에서 응시할 수 있어요.</p>
        </Card>
        {mine.length > 0 && (
          <Card>
            <div className="mb-3 font-bold">지난 내 기록</div>
            <div className="space-y-2">
              {mine.map(({ lang: l, r }) => (
                <RecordRow key={l} lang={l} r={r} max={cfg.maxAttempts} />
              ))}
            </div>
          </Card>
        )}
        <div className="text-center">
          <Btn variant="ghost" onClick={() => nav('/home')}>
            홈으로 <Kbd>Esc</Kbd>
          </Btn>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col gap-4 overflow-auto p-6">
      <div className="flex items-center gap-4">
        <button onClick={() => nav('/home')} className="rounded-lg px-2 py-1 text-sm font-bold text-ink/70 hover:bg-mint-100">
          ← 홈
        </button>
        <h1 className="text-2xl font-black text-mint-700">📝 {cfg.title}</h1>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="space-y-3">
          <div>
            <div className="text-sm text-ink/60">평가 언어</div>
            {langs.length > 1 ? (
              <div className="mt-1 flex gap-2">
                {langs.map((l) => (
                  <button
                    key={l}
                    onClick={(e) => {
                      setLang(l);
                      e.currentTarget.blur();
                    }}
                    className={`flex-1 rounded-xl border-2 px-3 py-2 font-bold transition ${
                      curLang === l ? 'border-mint-500 bg-mint-50 text-mint-700' : 'border-mint-100 text-ink/60 hover:border-mint-300'
                    }`}
                  >
                    {LANG_LABEL[l]}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-xl font-black">{LANG_LABEL[curLang]}</div>
            )}
          </div>
          <div className="flex gap-6">
            <div>
              <div className="text-sm text-ink/60">제한 시간</div>
              <div className="text-xl font-black tabular-nums">{cfg.minutes}분</div>
            </div>
            <div>
              <div className="text-sm text-ink/60">응시 횟수</div>
              <div className="text-xl font-black tabular-nums">
                {used} / {cfg.maxAttempts}
              </div>
            </div>
          </div>
          <div>
            <div className="text-sm text-ink/60">내 기록</div>
            {rec && rec.at > 0 ? (
              <RecordRow lang={curLang} r={rec} max={cfg.maxAttempts} compact />
            ) : (
              <div className="text-ink/50">아직 기록이 없어요.</div>
            )}
          </div>
        </Card>

        <Card>
          <div className="mb-2 text-sm text-ink/60">등급표 · {LANG_LABEL[curLang]} (1분에 치는 타수)</div>
          <GradeTable lang={curLang} mark={rec && rec.at > 0 ? rec.grade : undefined} />
        </Card>
      </div>

      <Card className="text-sm leading-relaxed text-ink/80">
        <ul className="list-disc space-y-1 pl-5">
          <li className="font-bold text-miss">시작하면 멈출 수 없습니다. 일시정지가 없고, 창을 벗어나도 시간은 계속 흘러요.</li>
          <li>제한 시간 동안 긴 글을 이어서 치고, 1분 평균 타수로 등급을 매겨요. 가장 좋은 기록이 인정돼요.</li>
          <li>오타는 고쳐도 정확도에 남아요. 붙여넣기는 안 돼요.</li>
          <li>시작하기 전에 <b>한/영 키</b>가 {LANG_LABEL[curLang]} 입력으로 맞는지 확인하세요. 응시 횟수는 시작하는 순간 차감돼요.</li>
        </ul>
      </Card>

      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-miss">{err}</p>}
      {left <= 0 ? (
        <div className="rounded-2xl bg-ink/10 px-5 py-4 text-center font-bold text-ink/70">
          {LANG_LABEL[curLang]} 응시 기회를 모두 사용했습니다. 인정 기록은 가장 좋은 기록이에요.
        </div>
      ) : lines.lines.length === 0 ? (
        <div className="rounded-2xl bg-ink/10 px-5 py-4 text-center font-bold text-ink/70">
          {loaded ? `${LANG_LABEL[curLang]} 평가 지문이 없습니다. 선생님께 알려 주세요.` : '글을 불러오는 중...'}
        </div>
      ) : (
        <Btn onClick={() => void start()} disabled={!canStart} className="py-4 text-xl">
          {starting ? '준비 중...' : '평가 시작'} <Kbd>Enter</Kbd>
        </Btn>
      )}
    </div>
  );
}

function GradeTable({ lang, mark }: { lang: Lang; mark?: ExamGrade }) {
  return (
    <table className="w-full text-left">
      <tbody>
        {examTable(lang).map((r) => (
          <tr key={r.grade} className={mark === r.grade ? 'bg-mint-50 ring-2 ring-mint-300' : ''}>
            <td className="w-14 py-1.5 pl-2">
              <GradeBadge grade={r.grade} size={28} />
            </td>
            <td className="font-bold tabular-nums">{r.label}</td>
            <td className="pr-2 text-right text-xs font-bold text-mint-700">{mark === r.grade ? '내 등급' : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RecordRow({ lang, r, max, compact }: { lang: Lang; r: ExamResult; max: number; compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      {!compact && <span className="w-10 font-bold">{LANG_LABEL[lang]}</span>}
      <GradeBadge grade={r.grade} size={compact ? 36 : 32} />
      <span className="font-black tabular-nums">{r.kpm}타</span>
      <span className="text-sm tabular-nums text-ink/60">정확도 {r.accuracy}%</span>
      {!compact && (
        <span className="ml-auto text-sm tabular-nums text-ink/60">
          응시 {r.attempts}/{max}
        </span>
      )}
    </div>
  );
}

// ───────── 응시 ─────────
function ExamRun({
  lang,
  lines,
  title,
  minutes,
  onFinish,
}: {
  lang: Lang;
  lines: string[];
  title: string;
  minutes: number;
  onFinish: (r: RunResult) => void;
}) {
  const limitMs = minutes * 60000;
  const [meter] = useState(() => new TypingMeter());
  const [count, setCount] = useState(3); // 3,2,1 → 0 이면 시작
  const [lineIdx, setLineIdx] = useState(0);
  const [away, setAway] = useState(false);
  const [now, setNow] = useState(() => performance.now());
  const startRef = useRef(0);
  const doneRef = useRef(false);
  const [finished, setFinished] = useState(false);
  const snap = useSnapshot(meter);
  const running = count === 0 && !finished;

  const target = lines[Math.min(lineIdx, lines.length - 1)] ?? '';
  const targetLen = charLen(target);

  const input = useTypingInput({
    meter,
    target,
    lang,
    active: running,
    idleMs: 1e9, // 평가 중에는 무입력 일시정지 없음
    onChange: (v, r, composing) => {
      const len = charLen(v);
      if (r.done || (len >= targetLen && !composing) || len > targetLen) advance();
    },
    onSubmit: () => {
      advance();
    },
  });
  const shake = useShake(input.errorCount);

  function advance() {
    if (doneRef.current) return;
    meter.commit(target);
    playDone();
    if (lineIdx + 1 >= lines.length) {
      finish();
      return;
    }
    setLineIdx(lineIdx + 1);
    input.reset();
  }

  function finish() {
    if (doneRef.current) return;
    doneRef.current = true;
    setFinished(true);
    const end = performance.now();
    const s = meter.snapshot(end);
    meter.pause(end);
    onFinish({
      kpm: Math.max(0, Math.min(1500, Math.round(s.strokes / minutes))), // 전체 제한 시간 기준 타/분
      accuracy: s.accuracy,
      typos: s.typos,
      strokes: s.strokes,
      missKeys: s.missKeys,
    });
  }

  // 3초 카운트다운 → 끝나는 순간 측정 시작
  useEffect(() => {
    if (count <= 0) return;
    const t = setTimeout(() => {
      if (count === 1) {
        const n = performance.now();
        startRef.current = n;
        meter.start(n);
      }
      setCount((c) => c - 1);
    }, 1000);
    return () => clearTimeout(t);
  }, [count, meter]);

  // 남은 시간은 performance.now() 기준. 포커스를 잃어도 계속 흐른다
  useEffect(() => {
    if (count !== 0) return;
    const t = setInterval(() => {
      const n = performance.now();
      setNow(n);
      if (n - startRef.current >= limitMs) finish();
    }, 100);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, limitMs]);

  // 창 이탈 경고, 나가기 경고
  useEffect(() => {
    const out = () => setAway(true);
    const back = () => {
      if (!document.hidden) setAway(false);
    };
    const hid = () => document.hidden && setAway(true);
    const bye = (e: BeforeUnloadEvent) => {
      if (!doneRef.current) e.preventDefault();
    };
    window.addEventListener('blur', out);
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', hid);
    window.addEventListener('beforeunload', bye);
    return () => {
      window.removeEventListener('blur', out);
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', hid);
      window.removeEventListener('beforeunload', bye);
    };
  }, []);

  // Esc 는 무시(일시정지 없음)
  useWindowKey((e) => {
    if (e.key === 'Escape') e.preventDefault();
  });

  const elapsed = count === 0 ? Math.min(limitMs, Math.max(0, now - startRef.current)) : 0;
  const leftSec = Math.ceil((limitMs - elapsed) / 1000);
  const kpmNow = elapsed < 3000 ? 0 : Math.round((snap.strokes * 60000) / elapsed);
  const prevLines = lines.slice(Math.max(0, lineIdx - 3), lineIdx);
  const nextLines = lines.slice(lineIdx + 1, lineIdx + 4);

  return (
    <div className="relative flex h-full flex-col">
      <div className="border-b border-mint-200 bg-white/60 px-6 py-2">
        <div className="flex items-center gap-6">
          <div className="min-w-0 text-sm">
            <div className="font-bold">📝 {title}</div>
            <div className="text-ink/60">{LANG_LABEL[lang]} · {minutes}분</div>
          </div>
          <div className={`mx-auto text-center font-black tabular-nums leading-none ${leftSec <= 10 && count === 0 ? 'text-miss' : 'text-ink'}`}>
            <div className="text-xs font-bold text-ink/50">남은 시간</div>
            <div className="text-6xl">{fmtTime(count === 0 ? leftSec : minutes * 60)}</div>
          </div>
          <div className="flex gap-4 text-right text-sm tabular-nums text-ink/70">
            <div>
              <div className="text-xs text-ink/50">타수</div>
              <div className="font-bold">{kpmNow}</div>
            </div>
            <div>
              <div className="text-xs text-ink/50">정확도</div>
              <div className="font-bold">{snap.accuracy ? `${snap.accuracy.toFixed(1)}%` : '-'}</div>
            </div>
            <div>
              <div className="text-xs text-ink/50">오타</div>
              <div className="font-bold">{snap.typos}</div>
            </div>
          </div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-mint-100">
          <div className="h-full rounded-full bg-mint-500" style={{ width: `${(elapsed / limitMs) * 100}%` }} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-8">
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-2 overflow-hidden pb-5">
          {prevLines.map((l, i) => (
            <div key={lineIdx - prevLines.length + i} className="truncate text-xl text-ink" style={{ opacity: 0.12 + 0.14 * (i + 1) }}>
              {l}
            </div>
          ))}
        </div>
        <div className="shrink-0 space-y-3">
          <div className="flex items-start gap-3">
            <span className="pt-1 text-2xl font-black text-mint-500">▶</span>
            <TargetText text={target} states={input.result.targetStates} size={30} />
          </div>
          <input
            {...input.inputProps}
            aria-label="수행평가 입력"
            className={`w-full rounded-xl border-2 bg-white px-4 py-3 text-xl focus:outline-none ${
              input.result.ok ? 'border-mint-300 focus:border-mint-500' : 'border-miss focus:border-miss'
            } ${shake ? 'anim-shake' : ''}`}
          />
          <div className="h-5 text-sm font-bold">
            {away ? (
              <span className="text-miss">⚠ 창을 벗어났습니다. 시간은 계속 흘러요. 창을 클릭하고 계속 치세요.</span>
            ) : input.langHint ? (
              <span className="text-miss">⚠ {input.langHint}</span>
            ) : null}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col justify-start gap-2 overflow-hidden pt-3">
          {nextLines.map((l, i) => (
            <div key={lineIdx + 1 + i} className="truncate text-xl text-ink" style={{ opacity: 0.5 - 0.14 * i }}>
              {l}
            </div>
          ))}
        </div>
      </div>

      {count > 0 && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-mint-50/95">
          <div className="text-lg font-bold text-ink/70">준비하세요. 한/영 키를 확인하세요.</div>
          <div key={count} className="anim-pop text-9xl font-black text-mint-600">
            {count}
          </div>
        </div>
      )}
    </div>
  );
}

// ───────── 결과 ─────────
function ResultView({
  outcome,
  saveState,
  canRetry,
  attemptsLeft,
  onHome,
  onRetry,
  starting,
  err,
}: {
  outcome: { run: RunResult; kept: ExamResult; improved: boolean; lang: Lang };
  saveState: 'saving' | 'done' | 'error';
  canRetry: boolean;
  attemptsLeft: number;
  onHome: () => void;
  onRetry: () => void;
  starting: boolean;
  err: string;
}) {
  const { run, kept, improved, lang } = outcome;
  const grade = examGrade(lang, run.kpm);
  const higher = [...EXAM_CUTS[lang]].reverse().find((c) => c.min > run.kpm);
  const busy = saveState === 'saving';

  useWindowKey(
    (e) => {
      if (e.key === 'Enter' && !e.repeat && !(e.target instanceof HTMLButtonElement) && !busy) {
        e.preventDefault();
        onHome();
      }
    },
    true,
  );

  if (busy) return <Spinner text="결과를 저장하는 중..." />;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col justify-center gap-4 p-6">
      <Card className="flex items-center gap-8">
        <div className={`flex h-40 w-40 shrink-0 items-center justify-center rounded-3xl text-9xl font-black text-white shadow-lg ${GRADE_BG[grade]}`}>
          {grade}
        </div>
        <div className="flex-1">
          <div className="text-sm font-bold text-ink/60">수행평가 결과 · {LANG_LABEL[lang]}</div>
          <div className="text-5xl font-black tabular-nums">
            {run.kpm}
            <span className="ml-1 text-xl text-ink/60">타/분</span>
          </div>
          <div className="mt-1 flex gap-5 text-ink/70">
            <span>정확도 <b className="tabular-nums">{run.accuracy}%</b></span>
            <span>오타 <b className="tabular-nums">{run.typos}</b>개</span>
          </div>
          <div className={`mt-2 font-bold ${GRADE_TEXT[grade]}`}>
            {higher ? `다음 등급(${higher.grade})까지 ${higher.min - run.kpm}타 더!` : '최고 등급입니다!'}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <div className="mb-2 text-sm text-ink/60">등급표에서 내 위치</div>
          <GradeTable lang={lang} mark={grade} />
        </Card>
        <Card className="space-y-2">
          <div className="text-sm text-ink/60">인정되는 기록</div>
          <div className="flex items-center gap-3">
            <GradeBadge grade={kept.grade} size={40} />
            <span className="text-2xl font-black tabular-nums">{kept.kpm}타</span>
          </div>
          <p className="text-sm text-ink/70">
            {improved ? '이번 기록이 가장 좋아서 새로 인정돼요.' : '이전 기록이 더 좋아서 이전 기록이 그대로 인정돼요.'}
          </p>
          <p className="text-sm text-ink/60">
            응시 {kept.attempts}회 · 남은 기회 {attemptsLeft}회
          </p>
          {saveState === 'error' && <p className="text-sm font-bold text-miss">기록 저장에 실패했어요. 선생님께 알려 주세요.</p>}
          {err && <p className="text-sm font-bold text-miss">{err}</p>}
        </Card>
      </div>

      <div className="flex justify-center gap-3">
        <Btn onClick={onHome}>
          확인 <Kbd>Enter</Kbd>
        </Btn>
        {canRetry && (
          <Btn variant="ghost" onClick={onRetry} disabled={starting}>
            다시 응시
          </Btn>
        )}
      </div>
    </div>
  );
}
