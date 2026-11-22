// 뜻 맞추기 퀴즈: 낱말의 뜻풀이를 보고, 보기 4개(①~④) 중 맞는 낱말을 직접 타자로 쳐서 Enter 로 답한다.
// 한 판 10문제, 문제당 15초. 점수 = 정답 10 + 남은 시간 보너스(최대 5) + 연속 정답 보너스(2연속부터 +2씩, 최대 +10).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { compare, normalizeText, strokeCount, type TargetState } from '../engine';
import { SUBJECT_LABEL, type Lang, type WordItem } from '../data/types';
import { useAuth } from '../state/auth';
import { finishSession, type FinishResult } from '../state/record';
import { pickWords, shuffle, useContent, type SubjectFilter } from '../content';
import TargetText from '../components/TargetText';
import { Btn, Kbd, Modal } from '../components/ui';
import { playDone, playError, playFanfare } from '../components/sound';
import { useTypingInput } from '../components/useTypingInput';
import { LangToggle, PauseModal, SubjectSelect, getRecent, pickByLevel, ratioFor, rememberRecent, useShake, useWindowKey } from '../components/PracticeParts';

const COUNT = 10;
const LIMIT_MS = 15000;
const REVEAL_MS = 1200;
const MARKS = ['①', '②', '③', '④'];
const EMPTY_RESULT: FinishResult = { isBest: false, prevBest: 0, xpGain: 0, newBadges: [], goalJustDone: false, promoted: false };

interface Question {
  word: WordItem;
  meaning: string; // 정답 낱말을 ○○ 로 가린 뜻풀이
  choices: string[];
  answer: number;
}

const charLen = (s: string) => Array.from(s).length;
const squash = (s: string) => normalizeText(s).replace(/\s+/g, '');

/** 뜻풀이 안에 정답 낱말이 그대로 들어 있으면 ○ 로 가린다. */
function maskMeaning(meaning: string, text: string): string {
  const t = text.trim();
  if (!t) return meaning;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return meaning.replace(new RegExp(esc, 'gi'), '○'.repeat(Math.min(5, Math.max(2, charLen(squash(t))))));
}

function buildQuiz(lang: Lang, subject: SubjectFilter, bestKpm: number): Question[] {
  const all = pickWords(lang, 'all').filter((w) => w.meaning.trim() && w.text.trim());
  const base = (subject === 'all' ? all : all.filter((w) => w.subject === subject)).filter((w) => w.meaning.trim());
  if (base.length < 1 || all.length < 4) return [];
  const key = `quiz-${lang}`;
  const answers = pickByLevel(base, Math.min(COUNT, base.length), ratioFor(bestKpm), () => 1, getRecent(key));
  rememberRecent(key, answers.map((w) => w.id));

  return answers.map((w) => {
    const len = charLen(squash(w.text));
    const same = new Set([squash(w.text).toLowerCase()]);
    // 같은 과목의 글자 수가 비슷한 낱말을 우선, 모자라면 다른 과목에서
    const near = (list: WordItem[]) =>
      list
        .filter((x) => {
          const k = squash(x.text).toLowerCase();
          return k && !same.has(k);
        })
        .map((x) => ({ x, d: Math.abs(charLen(squash(x.text)) - len) + Math.random() * 1.5 }))
        .sort((a, b) => a.d - b.d)
        .map((o) => o.x);
    const picks: string[] = [];
    const take = (list: WordItem[]) => {
      const cand = near(list).slice(0, 12);
      for (const x of shuffle(cand)) {
        if (picks.length >= 3) break;
        const k = squash(x.text).toLowerCase();
        if (same.has(k)) continue;
        same.add(k);
        picks.push(x.text.trim());
      }
    };
    take(all.filter((x) => x.subject === w.subject));
    if (picks.length < 3) take(all);
    const choices = shuffle([w.text.trim(), ...picks]);
    return { word: w, meaning: maskMeaning(w.meaning, w.text), choices, answer: choices.indexOf(w.text.trim()) };
  });
}

interface Reveal {
  picked: number | null; // null = 시간 초과
  ok: boolean;
  gain: number;
  bonus: { time: number; streak: number };
}

export default function Quiz() {
  const nav = useNavigate();
  const student = useAuth((s) => s.student);
  const studentRef = useRef(student);
  studentRef.current = student;
  const loaded = useContent((s) => s.loaded);

  const [lang, setLang] = useState<Lang>('ko');
  const [subject, setSubject] = useState<SubjectFilter>('all');
  const [qs, setQs] = useState<Question[]>([]);
  const [qi, setQi] = useState(0);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState<Question[]>([]);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [left, setLeft] = useState(LIMIT_MS);
  const [paused, setPaused] = useState(false);
  const [blocked, setBlocked] = useState(0);
  const [done, setDone] = useState(false);
  const [result, setResult] = useState<FinishResult | null>(null);
  const [armed, setArmed] = useState(false);

  const deadline = useRef(0);
  const pausedLeft = useRef(LIMIT_MS);
  const revealAt = useRef(0);
  const advTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seconds = useRef(0);
  const strokes = useRef(0);

  const q = qs[qi];
  const active = !paused && !done && !reveal && !!q;

  const input = useTypingInput({
    target: q?.choices ?? [''],
    lang,
    active,
    onSubmit: ({ value }) => {
      const idx = q.choices.findIndex((c) => compare(c, value).done);
      if (idx < 0) {
        setBlocked((n) => n + 1); // 보기에 없는 낱말
        playError();
        return false;
      }
      answer(idx);
    },
  });
  const shake = useShake(input.errorCount + blocked);

  const startQuestion = useCallback(() => {
    deadline.current = performance.now() + LIMIT_MS;
    pausedLeft.current = LIMIT_MS;
    setLeft(LIMIT_MS);
    setReveal(null);
  }, []);

  const restart = useCallback(
    (l: Lang, sub: SubjectFilter) => {
      const st = studentRef.current;
      if (!st) return;
      if (advTimer.current) clearTimeout(advTimer.current);
      setQs(buildQuiz(l, sub, l === 'ko' ? st.bestKo : st.bestEn));
      setQi(0);
      setScore(0);
      setStreak(0);
      setBestStreak(0);
      setCorrect(0);
      setWrong([]);
      setDone(false);
      setResult(null);
      setArmed(false);
      setPaused(false);
      setBlocked(0);
      seconds.current = 0;
      strokes.current = 0;
      startQuestion();
      input.reset();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startQuestion],
  );

  useEffect(() => {
    restart(lang, subject);
  }, [lang, subject, loaded, restart]);

  function answer(picked: number | null) {
    if (reveal || !q || done) return;
    const remaining = Math.max(0, deadline.current - performance.now());
    seconds.current += (LIMIT_MS - remaining) / 1000;
    const ok = picked === q.answer;
    let gain = 0;
    const bonus = { time: 0, streak: 0 };
    if (ok) {
      const st = streak + 1;
      bonus.time = Math.round((5 * remaining) / LIMIT_MS);
      bonus.streak = st >= 2 ? Math.min(10, (st - 1) * 2) : 0;
      gain = 10 + bonus.time + bonus.streak;
      setStreak(st);
      setBestStreak((b) => Math.max(b, st));
      setCorrect((c) => c + 1);
      setScore((s) => s + gain);
      strokes.current += strokeCount(q.word.text);
      playDone();
    } else {
      setStreak(0);
      setWrong((w) => [...w, q]);
      playError();
    }
    revealAt.current = performance.now();
    setReveal({ picked, ok, gain, bonus });
    input.reset();
    advTimer.current = setTimeout(next, REVEAL_MS);
  }

  function next() {
    if (advTimer.current) clearTimeout(advTimer.current);
    advTimer.current = null;
    if (qi + 1 >= qs.length) {
      finish();
      return;
    }
    setQi((i) => i + 1);
    startQuestion();
    input.reset();
  }

  function finish() {
    setReveal(null);
    setDone(true);
    setTimeout(() => setArmed(true), 400);
    playFanfare();
  }

  // 결과 저장: 끝난 뒤 한 번
  const saved = useRef(false);
  useEffect(() => {
    if (!done) {
      saved.current = false;
      return;
    }
    if (saved.current) return;
    saved.current = true;
    finishSession(
      {
        mode: 'quiz',
        lang,
        subject,
        kpm: 0,
        accuracy: qs.length ? (correct / qs.length) * 100 : 0,
        typos: wrong.length,
        strokes: strokes.current,
        seconds: seconds.current,
        score,
        missKeys: {},
      },
      { quizPoints: score },
    )
      .then(setResult)
      .catch(() => setResult(EMPTY_RESULT));
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  // 문제 타이머(0.1초 간격)
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      const l = deadline.current - performance.now();
      setLeft(Math.max(0, l));
      if (l <= 0) answer(null);
    }, 100);
    return () => clearInterval(t);
  });

  const pause = () => {
    pausedLeft.current = Math.max(0, deadline.current - performance.now());
    if (advTimer.current) {
      clearTimeout(advTimer.current);
      advTimer.current = null;
    }
    setPaused(true);
  };
  const resume = () => {
    deadline.current = performance.now() + pausedLeft.current;
    setPaused(false);
    if (reveal) advTimer.current = setTimeout(next, 400);
  };

  useWindowKey((e) => {
    if (e.key === 'Escape' && !paused && !done) pause();
    else if (e.key === 'Enter' && !e.repeat && reveal && !paused && performance.now() - revealAt.current > 300) {
      e.preventDefault();
      next();
    }
  }, !done);
  useWindowKey((e) => {
    if (e.key === 'Enter' && armed && !e.repeat) {
      e.preventDefault();
      restart(lang, subject);
    }
  }, done);

  if (!student) return null;

  const total = qs.length || COUNT;
  const sec = left / 1000;
  const barTone = sec <= 5 ? 'bg-miss' : sec <= 10 ? 'bg-gold' : 'bg-mint-500';
  const typed = input.value.length > 0;
  const results = q?.choices.map((c) => compare(c, input.value));
  const noMatch = typed && results?.every((r) => !r.ok);

  return (
    <div className="relative flex h-full flex-col">
      <style>{`@keyframes quizIn{from{opacity:0;transform:translateX(28px)}to{opacity:1;transform:none}}.quiz-in{animation:quizIn .25s ease-out}@media (prefers-reduced-motion:reduce){.quiz-in{animation:none}}`}</style>
      <div className="flex items-center gap-4 border-b border-mint-200 bg-white/60 px-6 py-2.5">
        <button onClick={() => nav('/home')} className="rounded-lg px-2 py-1 text-sm font-bold text-ink/70 hover:bg-mint-100">
          ← 홈
        </button>
        <h1 className="text-xl font-black text-mint-700">뜻 맞추기 퀴즈</h1>
        <SubjectSelect kind="words" lang={lang} value={subject} onChange={setSubject} />
        <LangToggle
          lang={lang}
          onChange={(l) => {
            setSubject('all');
            setLang(l);
          }}
        />
        <div className="ml-auto flex items-center gap-5">
          {streak >= 2 && <span className="anim-pop text-lg font-black text-orange-500">🔥 {streak}연속</span>}
          <span className="text-lg font-bold tabular-nums">
            점수 <span className="text-mint-700">{score}</span>
          </span>
          <span className="text-lg font-black tabular-nums text-mint-700">
            {Math.min(qi + 1, total)} / {total}
          </span>
        </div>
      </div>

      {!q ? (
        <div className="flex flex-1 items-center justify-center text-ink/60">
          {loaded ? '이 과목에는 퀴즈를 낼 낱말이 아직 부족해요. 다른 과목을 골라 보세요.' : '낱말을 불러오는 중...'}
        </div>
      ) : (
        <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4 px-6 py-5">
          {/* 시간 막대 */}
          <div className="flex items-center gap-3">
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-mint-100">
              <div
                className={`h-full rounded-full transition-[width,background-color] duration-100 ${barTone} ${sec <= 5 && !reveal ? 'animate-pulse' : ''}`}
                style={{ width: `${(left / LIMIT_MS) * 100}%` }}
              />
            </div>
            <span className={`w-12 text-right text-lg font-black tabular-nums ${sec <= 5 ? 'text-miss' : ''}`}>{Math.ceil(sec)}초</span>
          </div>

          <div key={qi} className="quiz-in flex min-h-0 flex-1 flex-col gap-4">
            <div className="rounded-2xl bg-white px-8 py-6 shadow-md">
              <span className="mr-3 rounded bg-mint-100 px-2 py-0.5 text-sm font-bold text-mint-700">이 뜻에 맞는 낱말은?</span>
              <p className="mt-3 text-[28px] font-bold leading-snug">{q.meaning}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {q.choices.map((c, i) => {
                const r = results?.[i];
                let cls = 'border-transparent bg-white';
                let states: TargetState[] | undefined = r?.targetStates;
                if (reveal) {
                  const full = Array.from(c).map(() => 'done' as TargetState);
                  states = full;
                  if (i === q.answer) cls = 'border-mint-500 bg-mint-100';
                  else if (i === reveal.picked) cls = 'border-miss bg-miss/10';
                  else cls = 'border-transparent bg-white opacity-40';
                } else if (typed && r && !r.ok) cls = 'border-transparent bg-white opacity-35';
                else if (typed && r?.ok) cls = 'border-mint-300 bg-white';
                return (
                  <div key={i} className={`flex items-center gap-3 rounded-2xl border-2 px-5 py-4 shadow-sm transition ${cls}`}>
                    <span className="text-2xl font-black text-mint-600">{MARKS[i]}</span>
                    <TargetText text={c} states={states} size={30} showCurrent={false} />
                    {reveal && i === q.answer && <span className="ml-auto text-2xl text-mint-600">✓</span>}
                    {reveal && i === reveal.picked && !reveal.ok && <span className="ml-auto text-2xl text-miss">✗</span>}
                  </div>
                );
              })}
            </div>

            <div className="mt-auto space-y-2 pb-1">
              <input
                {...input.inputProps}
                aria-label="정답 낱말 입력"
                placeholder="정답 낱말을 직접 쳐서 Enter"
                className={`w-full rounded-xl border-2 bg-white px-4 py-3 text-center text-2xl focus:outline-none ${
                  noMatch ? 'border-miss focus:border-miss' : 'border-mint-300 focus:border-mint-500'
                } ${shake ? 'anim-shake' : ''}`}
              />
              <div className="h-7 text-center text-base font-bold">
                {reveal ? (
                  reveal.ok ? (
                    <span className="text-mint-600">
                      정답! +{reveal.gain}점{' '}
                      <span className="text-sm font-medium text-ink/60">
                        (기본 10 + 시간 {reveal.bonus.time}
                        {reveal.bonus.streak ? ` + 연속 ${reveal.bonus.streak}` : ''})
                      </span>
                    </span>
                  ) : (
                    <span className="text-miss">
                      {reveal.picked === null ? '시간 초과!' : '아쉬워요!'} 정답은 「{q.word.text}」
                    </span>
                  )
                ) : (
                  <>
                    {input.langHint ? (
                      <span className="text-miss">⚠ {input.langHint}</span>
                    ) : noMatch ? (
                      <span className="text-miss">보기와 달라요. Backspace 로 고쳐 보세요</span>
                    ) : (
                      <span className="text-sm font-medium text-ink/50">
                        숫자 키가 아니라 낱말을 직접 쳐야 해요 · <Kbd>Enter</Kbd> 답하기 · <Kbd>Esc</Kbd> 일시정지
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {paused && !done && <PauseModal onResume={resume} onQuit={() => nav('/home')} />}
      {done && (
        <Modal onClose={() => nav('/home')} wide>
          <h2 className="text-3xl font-black text-mint-700">퀴즈 끝!</h2>
          <div className="mt-5 grid grid-cols-4 gap-4 text-center">
            <Box label="맞힌 수" value={`${correct} / ${qs.length}`} />
            <Box label="점수" value={`${score}점`} />
            <Box label="최고 연속" value={`🔥 ${bestStreak}`} />
            <Box label="경험치" value={result ? `+${result.xpGain}` : '저장 중…'} />
          </div>
          <div className="mt-5 max-h-52 overflow-auto rounded-xl bg-mint-50 p-4">
            {wrong.length === 0 ? (
              <p className="text-center font-bold text-mint-700">모두 맞혔어요! 대단해요 🎉</p>
            ) : (
              <>
                <p className="mb-2 text-sm font-bold text-ink/70">틀린 낱말 복습</p>
                <ul className="space-y-1.5">
                  {wrong.map((w) => (
                    <li key={w.word.id} className="flex gap-3 text-base">
                      <span className="min-w-24 font-black text-miss">{w.word.text}</span>
                      <span className="text-ink/80">{w.word.meaning}</span>
                      <span className="ml-auto shrink-0 text-xs text-ink/40">{SUBJECT_LABEL[w.word.subject]}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          {result && (result.newBadges.length > 0 || result.goalJustDone) && (
            <p className="mt-3 text-center text-sm font-bold text-gold">
              {result.goalJustDone ? '✅ 오늘의 훈련 완료! ' : ''}
              {result.newBadges.length > 0 ? '🎖️ 새 배지를 얻었어요!' : ''}
            </p>
          )}
          <div className="mt-6 flex justify-center gap-3">
            <Btn onClick={() => restart(lang, subject)} autoFocus>
              한 판 더 <Kbd>Enter</Kbd>
            </Btn>
            <Btn variant="ghost" onClick={() => nav('/home')}>
              홈 <Kbd>Esc</Kbd>
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-mint-200 px-2 py-3">
      <div className="text-xs text-ink/60">{label}</div>
      <div className="mt-1 text-2xl font-black tabular-nums">{value}</div>
    </div>
  );
}
