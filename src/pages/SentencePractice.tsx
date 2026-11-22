// 단문연습: 1회 10문장. 문장을 오타 없이 완성하고 Enter 여야 다음(오타가 남으면 입력창이 흔들린다).
// 입력한 글자가 예시 문장 위에 색으로 겹쳐 보인다(정타 진하게, 오타 빨갛게).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TypingMeter, type MeterSnapshot } from '../engine';
import { SUBJECT_LABEL, type Lang, type SentenceItem, type Student } from '../data/types';
import { useAuth } from '../state/auth';
import { usePrefs } from '../state/prefs';
import { finishSession, type FinishResult } from '../state/record';
import { pickSentences, useContent, type SubjectFilter } from '../content';
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

const COUNT = 10;
const EMPTY_RESULT: FinishResult = { isBest: false, prevBest: 0, xpGain: 0, newBadges: [], goalJustDone: false, promoted: false };

function dealSentences(lang: Lang, subject: SubjectFilter, student: Student): SentenceItem[] {
  const best = lang === 'ko' ? student.bestKo : student.bestEn;
  const key = `sentence-${lang}`;
  const list = pickByLevel(pickSentences(lang, subject), COUNT, ratioFor(best), () => 1, getRecent(key));
  rememberRecent(key, list.map((s) => s.id));
  return list;
}

interface Session {
  items: SentenceItem[];
  idx: number;
  meter: TypingMeter;
  done: boolean;
}

export default function SentencePractice() {
  const nav = useNavigate();
  const student = useAuth((s) => s.student);
  const studentRef = useRef(student);
  studentRef.current = student;
  const prefs = usePrefs();
  const loaded = useContent((s) => s.loaded);

  const [lang, setLang] = useState<Lang>('ko');
  const [subject, setSubject] = useState<SubjectFilter>('all');
  const [sess, setSess] = useState<Session>(() => ({ items: [], idx: 0, meter: new TypingMeter(), done: false }));
  const [paused, setPaused] = useState(false);
  const [blocked, setBlocked] = useState(0); // 오타가 남은 채 Enter 를 누른 횟수
  const [result, setResult] = useState<FinishResult | null>(null);
  const [finalSnap, setFinalSnap] = useState<MeterSnapshot | null>(null);

  const cur = sess.items[sess.idx];
  const snap = useSnapshot(sess.meter);
  const bestKpm = (lang === 'ko' ? student?.bestKo : student?.bestEn) ?? 0;

  const input = useTypingInput({
    meter: sess.meter,
    target: cur?.text ?? '',
    lang,
    active: !paused && !sess.done && !!cur,
    onSubmit: ({ result: r, target }) => {
      if (!r.done) {
        // 오타가 남았거나 덜 쳤으면 넘어가지 않는다
        setBlocked((n) => n + 1);
        playError();
        return false;
      }
      playDone();
      sess.meter.commit(target);
      if (sess.idx + 1 >= sess.items.length) finish();
      else setSess((s) => ({ ...s, idx: s.idx + 1 }));
    },
  });
  const shake = useShake(input.errorCount + blocked);

  const restart = useCallback((l: Lang, sub: SubjectFilter) => {
    const st = studentRef.current;
    if (!st) return;
    setSess({ items: dealSentences(l, sub, st), idx: 0, meter: new TypingMeter(), done: false });
    setResult(null);
    setFinalSnap(null);
    setPaused(false);
    setBlocked(0);
  }, []);

  useEffect(() => {
    restart(lang, subject);
    input.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, subject, loaded, restart]);

  function finish() {
    const m = sess.meter;
    const now = performance.now();
    const s = m.snapshot(now);
    m.pause(now);
    setFinalSnap(s);
    setSess((x) => ({ ...x, done: true }));
    finishSession({
      mode: 'sentence',
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

  const resume = () => {
    sess.meter.resume(performance.now());
    setPaused(false);
  };
  useWindowKey((e) => {
    if (e.key === 'Escape' && !paused && !sess.done) {
      sess.meter.pause(performance.now());
      setPaused(true);
    }
  }, !sess.done);

  if (!student) return null;
  const prev = sess.items[sess.idx - 1];
  const next = sess.items[sess.idx + 1];
  const kbTarget = input.result.ok ? (input.result.done ? null : input.result.next) : BACKSPACE_TARGET;

  return (
    <div className="relative flex h-full">
      <PracticeSidebar
        title="단문연습"
        subtitle={subject === 'all' ? '섞어서' : SUBJECT_LABEL[subject]}
        onHome={() => nav('/home')}
        snap={snap}
        bestKpm={bestKpm}
        lang={lang}
      />
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-4 border-b border-mint-200 bg-white/60 px-6 py-2.5">
          <SubjectSelect kind="sentences" lang={lang} value={subject} onChange={setSubject} />
          <LangToggle
            lang={lang}
            onChange={(l) => {
              setSubject('all');
              setLang(l);
            }}
          />
          <span className="ml-auto text-lg font-black tabular-nums text-mint-700">
            {Math.min(sess.idx + 1, sess.items.length)} / {sess.items.length || COUNT}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-8">
          {!cur ? (
            <div className="text-ink/60">{loaded ? '이 과목에는 연습할 문장이 아직 없어요.' : '문장을 불러오는 중...'}</div>
          ) : (
            <>
              <div className="h-7 max-w-3xl truncate text-base text-ink/35">{prev ? `이전: ${prev.text}` : ''}</div>
              <div key={sess.idx} className="anim-pop w-full max-w-4xl rounded-2xl bg-white px-10 py-6 text-center shadow-md">
                <TargetText text={cur.text} states={input.result.targetStates} size={32} />
              </div>
              <div className="h-7 max-w-3xl truncate text-base text-ink/35">{next ? `다음: ${next.text}` : ''}</div>
              <input
                {...input.inputProps}
                aria-label="문장 입력"
                className={`w-full max-w-4xl rounded-xl border-2 bg-white px-4 py-3 text-xl focus:outline-none ${
                  input.result.ok ? 'border-mint-300 focus:border-mint-500' : 'border-miss focus:border-miss'
                } ${shake ? 'anim-shake' : ''}`}
              />
              <div className="h-6 text-sm font-bold">
                {input.langHint ? (
                  <span className="text-miss">⚠ {input.langHint}</span>
                ) : input.paused && !paused ? (
                  <span className="text-ink/50">멈췄어요. 계속 치면 이어서 쳐요.</span>
                ) : !input.result.ok ? (
                  <span className="text-miss">오타가 있어요. Backspace 로 고치고 Enter 를 누르세요</span>
                ) : input.result.done ? (
                  <span className="text-mint-600">좋아요! Enter 를 누르면 다음 문장이에요</span>
                ) : null}
              </div>
            </>
          )}
        </div>

        {prefs.showKeyboard && (
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
          title="단문연습 완료!"
          snapshot={finalSnap}
          result={result}
          lang={lang}
          onRetry={() => {
            restart(lang, subject);
            input.reset();
          }}
          onHome={() => nav('/home')}
        />
      )}
    </div>
  );
}
