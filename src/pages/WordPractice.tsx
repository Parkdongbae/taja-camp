// 낱말연습(docs/02 4.6): 1회 30낱말. 뜻풀이를 함께 보여 주고 정확히 치고 Space/Enter 면 다음.
// 출제: 최고 타수에 따른 수준 비율, 배운 글쇠 우선(한글), 약점 글쇠가 든 낱말 가중 2배, 최근 50개 제외.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TypingMeter, STAGES, usedCodes, type MeterSnapshot } from '../engine';
import type { Lang, Student, WordItem } from '../data/types';
import { useAuth } from '../state/auth';
import { usePrefs } from '../state/prefs';
import { finishSession, type FinishResult } from '../state/record';
import { pickWords, useContent, type SubjectFilter } from '../content';
import { SUBJECT_LABEL } from '../data/types';
import TargetText from '../components/TargetText';
import VirtualKeyboard from '../components/VirtualKeyboard';
import ResultModal from '../components/ResultModal';
import { playDone, playError } from '../components/sound';
import { BACKSPACE_TARGET, useTypingInput } from '../components/useTypingInput';
import {
  ComboFlash,
  LangToggle,
  PauseModal,
  PracticeSidebar,
  SubjectSelect,
  getRecent,
  pickByLevel,
  ratioFor,
  rememberRecent,
  useShake,
  useSnapshot,
  useWindowKey,
} from '../components/PracticeParts';

const COUNT = 30;
const EMPTY_RESULT: FinishResult = { isBest: false, prevBest: 0, xpGain: 0, newBadges: [], goalJustDone: false, promoted: false };

/** 한글 연습에서 자리연습을 다 마치지 않았으면, 통과한 단계(최소 K1)까지의 글쇠 code 집합. 다 마쳤으면 null. */
function learnedCodes(student: Student, lang: Lang): Set<string> | null {
  if (lang !== 'ko' || student.position.ko >= 8) return null;
  const n = Math.max(1, student.position.ko);
  const set = new Set<string>(['Space']);
  for (const st of STAGES) {
    if (st.track === 'ko' && st.order <= n) for (const k of st.allKeys) set.add(k.code);
  }
  return set;
}

function dealWords(lang: Lang, subject: SubjectFilter, student: Student): WordItem[] {
  const pool = pickWords(lang, subject);
  const best = lang === 'ko' ? student.bestKo : student.bestEn;
  const learned = learnedCodes(student, lang);
  const weak = new Set(Object.entries(student.weakKeys ?? {}).filter(([, n]) => n > 0).map(([c]) => c));
  const codeCache = new Map<string, string[]>();
  const codes = (w: WordItem) => {
    let c = codeCache.get(w.id);
    if (!c) codeCache.set(w.id, (c = usedCodes(w.text)));
    return c;
  };
  const weight = (w: WordItem) => {
    let x = 1;
    if (learned && codes(w).every((c) => learned.has(c))) x *= 20; // 배운 글쇠만으로 된 낱말 우선
    if (weak.size && codes(w).some((c) => weak.has(c))) x *= 2; // 약점 보강
    return x;
  };
  const key = `word-${lang}`;
  const list = pickByLevel(pool, COUNT, ratioFor(best), weight, getRecent(key));
  rememberRecent(key, list.map((w) => w.id));
  return list;
}

interface Session {
  words: WordItem[];
  idx: number;
  meter: TypingMeter;
  done: boolean;
}

export default function WordPractice() {
  const nav = useNavigate();
  const student = useAuth((s) => s.student);
  const studentRef = useRef(student);
  studentRef.current = student;
  const prefs = usePrefs();
  const loaded = useContent((s) => s.loaded);

  const [lang, setLang] = useState<Lang>('ko');
  const [subject, setSubject] = useState<SubjectFilter>('all');
  const [sess, setSess] = useState<Session>(() => ({ words: [], idx: 0, meter: new TypingMeter(), done: false }));
  const [paused, setPaused] = useState(false);
  const [result, setResult] = useState<FinishResult | null>(null);
  const [finalSnap, setFinalSnap] = useState<MeterSnapshot | null>(null);

  const cur = sess.words[sess.idx];
  const snap = useSnapshot(sess.meter);
  const bestKpm = (lang === 'ko' ? student?.bestKo : student?.bestEn) ?? 0;

  const input = useTypingInput({
    meter: sess.meter,
    target: cur?.text ?? '',
    lang,
    active: !paused && !sess.done && !!cur,
    submitOnSpace: true,
    onSubmit: ({ result: r, target }) => {
      const now = performance.now();
      const m = sess.meter;
      if (!r.done) {
        // 틀린 채(또는 덜 친 채) 제출: 오타 1회 추가 후 다음으로
        m.addTypo(r.errorKey?.expected?.code ?? r.next?.code, now);
        playError();
      } else playDone();
      m.commit(target);
      if (sess.idx + 1 >= sess.words.length) finish();
      else setSess((s) => ({ ...s, idx: s.idx + 1 }));
    },
  });
  const shake = useShake(input.errorCount);

  const restart = useCallback(
    (l: Lang, sub: SubjectFilter) => {
      const st = studentRef.current;
      if (!st) return;
      setSess({ words: dealWords(l, sub, st), idx: 0, meter: new TypingMeter(), done: false });
      setResult(null);
      setFinalSnap(null);
      setPaused(false);
      input.reset();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // 처음·과목/언어 바뀜·콘텐츠 도착 때 새로 출제
  useEffect(() => {
    restart(lang, subject);
  }, [lang, subject, loaded, restart]);

  function finish() {
    const m = sess.meter;
    const now = performance.now();
    const s = m.snapshot(now);
    m.pause(now);
    setFinalSnap(s);
    setSess((x) => ({ ...x, done: true }));
    finishSession({
      mode: 'word',
      lang,
      subject,
      kpm: s.kpm,
      accuracy: s.accuracy,
      typos: s.typos,
      strokes: s.strokes,
      seconds: s.seconds,
      missKeys: s.missKeys,
    })
      .then(setResult)
      .catch(() => setResult(EMPTY_RESULT));
  }

  const pause = () => {
    sess.meter.pause(performance.now());
    setPaused(true);
  };
  const resume = () => {
    sess.meter.resume(performance.now());
    setPaused(false);
  };
  useWindowKey((e) => {
    if (e.key === 'Escape' && !paused && !sess.done) pause();
  }, !sess.done);

  if (!student) return null;
  const subjectLabel = subject === 'all' ? '섞어서' : SUBJECT_LABEL[subject];
  const prev = sess.words[sess.idx - 1];
  const next = sess.words[sess.idx + 1];
  const showKb = prefs.showKeyboard;
  const kbTarget = input.result.ok ? input.result.next : BACKSPACE_TARGET;

  return (
    <div className="relative flex h-full">
      <PracticeSidebar title="낱말연습" subtitle={subjectLabel} onHome={() => nav('/home')} snap={snap} bestKpm={bestKpm} lang={lang} />
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-4 border-b border-mint-200 bg-white/60 px-6 py-2.5">
          <SubjectSelect
            kind="words"
            lang={lang}
            value={subject}
            onChange={(s) => {
              setSubject(s);
            }}
          />
          <LangToggle
            lang={lang}
            onChange={(l) => {
              setSubject('all');
              setLang(l);
            }}
          />
          <span className="ml-auto text-lg font-black tabular-nums text-mint-700">
            {Math.min(sess.idx + 1, sess.words.length)} / {sess.words.length || COUNT}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6">
          {!cur ? (
            <div className="text-ink/60">{loaded ? '이 과목에는 연습할 낱말이 아직 없어요.' : '낱말을 불러오는 중...'}</div>
          ) : (
            <>
              <div className="grid w-full max-w-3xl grid-cols-[1fr_auto_1fr] items-center gap-4">
                <div className="truncate text-right text-xl text-ink/35">{prev ? <>이전: {prev.text}</> : ''}</div>
                <div key={sess.idx} className="anim-pop min-w-[240px] rounded-2xl bg-white px-10 py-4 text-center shadow-md">
                  <TargetText text={cur.text} states={input.result.targetStates} size={44} />
                </div>
                <div className="truncate text-xl text-ink/35">{next ? <>다음: {next.text}</> : ''}</div>
              </div>
              <p className="max-w-2xl text-center text-lg text-ink/70">
                <span className="mr-2 rounded bg-mint-100 px-2 py-0.5 text-sm font-bold text-mint-700">뜻</span>
                {cur.meaning || '(뜻풀이가 없어요)'}
              </p>
              <input
                {...input.inputProps}
                aria-label="낱말 입력"
                className={`w-[420px] rounded-xl border-2 bg-white px-4 py-3 text-center text-2xl focus:outline-none ${
                  input.result.ok ? 'border-mint-300 focus:border-mint-500' : 'border-miss focus:border-miss'
                } ${shake ? 'anim-shake' : ''}`}
              />
              <div className="h-6 text-sm font-bold">
                {input.langHint ? (
                  <span className="text-miss">⚠ {input.langHint}</span>
                ) : input.paused && !paused ? (
                  <span className="text-ink/50">멈췄어요. 계속 치면 이어서 쳐요.</span>
                ) : !input.result.ok ? (
                  <span className="text-miss">Backspace 로 고쳐 보세요 (그대로 Enter 를 누르면 오타로 세고 넘어가요)</span>
                ) : null}
              </div>
            </>
          )}
        </div>

        {showKb && (
          <div className="mx-auto w-full max-w-[640px] shrink-0 px-4 pb-3">
            <VirtualKeyboard
              kind={prefs.keyboardKind}
              lang={lang}
              target={cur ? kbTarget : null}
              wrongCode={input.wrongCode}
              wrongNonce={input.errorCount}
              showHands={prefs.showHands}
            />
          </div>
        )}
      </section>

      <ComboFlash combo={snap.combo} />
      {paused && !sess.done && <PauseModal onResume={resume} onQuit={() => nav('/home')} />}
      {sess.done && finalSnap && (
        <ResultModal
          title="낱말연습 완료!"
          snapshot={finalSnap}
          result={result}
          lang={lang}
          onRetry={() => restart(lang, subject)}
          onHome={() => nav('/home')}
        />
      )}
    </div>
  );
}
