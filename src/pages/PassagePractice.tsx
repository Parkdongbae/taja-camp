// 장문연습(docs/02 4.7): 글 선택 목록 → 연습. 현재 줄을 세로 가운데에 두고 지난 줄·다음 줄은 연하게 보인다.
// 한 줄을 목표 길이만큼 치면(오타가 있어도) 자동으로 다음 줄, Enter 로도 넘어간다. 제한 시간 5분, 80% 이상 진행해야 기록 인정.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TypingMeter, normalizeText, splitLines, type MeterSnapshot } from '../engine';
import { SUBJECT_LABEL, type Lang, type PassageItem } from '../data/types';
import { useAuth } from '../state/auth';
import { usePrefs } from '../state/prefs';
import { finishSession, type FinishResult } from '../state/record';
import { pickPassages, useContent, type SubjectFilter } from '../content';
import TargetText from '../components/TargetText';
import VirtualKeyboard from '../components/VirtualKeyboard';
import ResultModal from '../components/ResultModal';
import { Btn, Kbd } from '../components/ui';
import { playDone } from '../components/sound';
import { BACKSPACE_TARGET, useTypingInput } from '../components/useTypingInput';
import {
  ComboFlash,
  LangToggle,
  PauseModal,
  PracticeSidebar,
  SubjectSelect,
  fmtTime,
  useShake,
  useSnapshot,
  useWindowKey,
} from '../components/PracticeParts';

const LIMIT_SEC = 300;
const LINE_LEN = 38;
const RECOGNIZE = 0.8;
const EMPTY_RESULT: FinishResult = { isBest: false, prevBest: 0, xpGain: 0, newBadges: [], goalJustDone: false, promoted: false };

const charLen = (s: string) => Array.from(s).length;
const passageChars = (p: PassageItem) => charLen(normalizeText(p.text).replace(/\s+/g, ' ').trim());

export default function PassagePractice() {
  const nav = useNavigate();
  const [lang, setLang] = useState<Lang>('ko');
  const [subject, setSubject] = useState<SubjectFilter>('all');
  const [picked, setPicked] = useState<PassageItem | null>(null);
  const [round, setRound] = useState(0); // 다시 하기용 키
  const [cursor, setCursor] = useState(0);
  const passages = useContent((s) => s.passages);
  const loaded = useContent((s) => s.loaded);

  const list = useMemo(() => pickPassages(lang, subject), [passages, lang, subject]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setCursor(0), [lang, subject]);
  useWindowKey((e) => {
    if (picked) return;
    if (e.target instanceof HTMLSelectElement) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(list.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter' && list[cursor] && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      setPicked(list[cursor]);
    } else if (e.key === 'Escape') nav('/home');
  }, !picked);

  if (picked) {
    return <PassagePlay key={`${picked.id}-${round}`} passage={picked} onRetry={() => setRound((r) => r + 1)} onList={() => setPicked(null)} />;
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 p-6">
      <div className="flex items-center gap-4">
        <button onClick={() => nav('/home')} className="rounded-lg px-2 py-1 text-sm font-bold text-ink/70 hover:bg-mint-100">
          ← 홈
        </button>
        <h1 className="text-2xl font-black text-mint-700">장문연습</h1>
        <div className="ml-auto flex items-center gap-4">
          <SubjectSelect kind="passages" lang={lang} value={subject} onChange={setSubject} />
          <LangToggle
            lang={lang}
            onChange={(l) => {
              setSubject('all');
              setLang(l);
            }}
          />
        </div>
      </div>
      <p className="text-sm text-ink/60">
        읽을 글을 고르세요. 제한 시간은 5분이고, 80% 이상 치면 기록으로 인정돼요. <Kbd>↑</Kbd> <Kbd>↓</Kbd> 로 고르고 <Kbd>Enter</Kbd> 로 시작해요.
      </p>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto">
        {list.length === 0 && <div className="py-10 text-center text-ink/60">{loaded ? '이 과목에는 연습할 글이 아직 없어요.' : '글을 불러오는 중...'}</div>}
        {list.map((p, i) => (
          <button
            key={p.id}
            onClick={() => setPicked(p)}
            onMouseEnter={() => setCursor(i)}
            className={`flex w-full items-center gap-4 rounded-2xl bg-white px-5 py-4 text-left shadow-sm transition ${
              i === cursor ? 'ring-4 ring-mint-300' : 'hover:bg-mint-50'
            }`}
          >
            <span className="rounded-full bg-mint-100 px-3 py-1 text-xs font-bold text-mint-700">{SUBJECT_LABEL[p.subject]}</span>
            <span className="flex-1 text-lg font-bold">{p.title}</span>
            <span className="text-sm tabular-nums text-ink/50">{passageChars(p)}자</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PassagePlay({ passage, onRetry, onList }: { passage: PassageItem; onRetry: () => void; onList: () => void }) {
  const nav = useNavigate();
  const student = useAuth((s) => s.student);
  const prefs = usePrefs();
  const lang = passage.lang;

  const lines = useMemo(() => splitLines(passage.text, LINE_LEN), [passage]);
  const totalChars = useMemo(() => lines.reduce((n, l) => n + charLen(l), 0), [lines]);
  const [meter] = useState(() => new TypingMeter());
  const [lineIdx, setLineIdx] = useState(0);
  const [doneChars, setDoneChars] = useState(0);
  const [paused, setPaused] = useState(false);
  const [showKb, setShowKb] = useState(false); // 장문에서는 키보드를 기본으로 숨긴다
  const [finished, setFinished] = useState<{ snap: MeterSnapshot; progress: number; timeUp: boolean } | null>(null);
  const [result, setResult] = useState<FinishResult | null>(null);
  const snap = useSnapshot(meter);
  const finishedRef = useRef(false);

  const target = lines[Math.min(lineIdx, lines.length - 1)] ?? '';
  const targetLen = charLen(target);

  // 최신 진행 상태를 시간 초과 처리에서 읽기 위한 ref
  const live = useRef({ doneChars: 0, typed: 0 });

  const input = useTypingInput({
    meter,
    target,
    lang,
    active: !paused && !finished,
    onChange: (v, r, composing) => {
      const len = charLen(v);
      live.current.typed = Math.min(len, targetLen);
      if (r.done || (len >= targetLen && !composing) || len > targetLen) advance();
    },
    onSubmit: () => {
      advance(); // Enter: 덜 쳤어도 다음 줄로
    },
  });
  const shake = useShake(input.errorCount);

  function advance() {
    if (finishedRef.current) return;
    meter.commit(target);
    playDone();
    const dc = doneChars + targetLen;
    live.current = { doneChars: dc, typed: 0 };
    setDoneChars(dc);
    if (lineIdx + 1 >= lines.length) {
      finish(false, 1);
      return;
    }
    setLineIdx(lineIdx + 1);
    input.reset();
  }

  function finish(timeUp: boolean, progressOverride?: number) {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const now = performance.now();
    const s = meter.snapshot(now);
    meter.pause(now);
    const progress = progressOverride ?? Math.min(1, (live.current.doneChars + live.current.typed) / Math.max(1, totalChars));
    setFinished({ snap: s, progress, timeUp });
    const recognized = progress >= RECOGNIZE;
    finishSession({
      mode: 'passage',
      lang,
      subject: passage.subject,
      kpm: recognized ? s.kpm : 0, // 80% 미만은 저장만 하고 최고 기록·순위에는 넣지 않는다
      accuracy: s.accuracy,
      typos: s.typos,
      strokes: s.strokes,
      seconds: s.seconds,
      missKeys: s.missKeys,
    })
      .then(setResult)
      .catch(() => setResult(EMPTY_RESULT));
  }

  // 제한 시간(입력한 시간 기준, 일시정지 제외)
  useEffect(() => {
    if (!finishedRef.current && snap.seconds >= LIMIT_SEC) finish(true);
  });

  useWindowKey((e) => {
    if (e.key === 'Escape' && !paused && !finished) {
      meter.pause(performance.now());
      setPaused(true);
    }
  }, !finished);
  const resume = () => {
    meter.resume(performance.now());
    setPaused(false);
  };

  if (!student) return null;
  const progressNow = Math.min(1, (doneChars + Math.min(charLen(input.value), targetLen)) / Math.max(1, totalChars));
  const left = Math.max(0, LIMIT_SEC - snap.seconds);
  const bestKpm = lang === 'ko' ? student.bestKo : student.bestEn;
  const prevLines = lines.slice(Math.max(0, lineIdx - 3), lineIdx);
  const nextLines = lines.slice(lineIdx + 1, lineIdx + 4);
  const kbTarget = input.result.ok ? input.result.next : BACKSPACE_TARGET;
  const kbVisible = prefs.showKeyboard && showKb;

  return (
    <div className="relative flex h-full">
      <PracticeSidebar
        title="장문연습"
        subtitle={SUBJECT_LABEL[passage.subject]}
        onHome={() => nav('/home')}
        snap={snap}
        bestKpm={bestKpm}
        lang={lang}
        extra={
          <div className="flex items-baseline justify-between border-b border-mint-200 py-2">
            <span className="text-sm text-ink/70">남은 시간</span>
            <span className={`text-lg font-bold tabular-nums ${left <= 30 ? 'text-miss' : ''}`}>{fmtTime(left)}</span>
          </div>
        }
      />
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-mint-200 bg-white/60 px-6 py-2.5">
          <div className="flex items-center gap-4">
            <span className="font-bold">
              {SUBJECT_LABEL[passage.subject]} · {passage.title}
            </span>
            {prefs.showKeyboard && (
              <button
                onClick={(e) => {
                  setShowKb((v) => !v);
                  e.currentTarget.blur();
                }}
                className="rounded-lg border border-mint-200 bg-white px-2 py-1 text-xs font-bold text-ink/70 hover:bg-mint-50"
              >
                키보드 {showKb ? '숨기기' : '보기'}
              </button>
            )}
            <span className="ml-auto text-sm font-bold tabular-nums text-mint-700">진행 {Math.round(progressNow * 100)}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-mint-100">
            <div className={`h-full rounded-full transition-all ${progressNow >= RECOGNIZE ? 'bg-gold' : 'bg-mint-500'}`} style={{ width: `${progressNow * 100}%` }} />
          </div>
        </div>

        {/* 현재 줄이 세로 가운데: 위·아래 영역의 높이를 같게 둔다 */}
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
              aria-label="장문 입력"
              className={`w-full rounded-xl border-2 bg-white px-4 py-3 text-xl focus:outline-none ${
                input.result.ok ? 'border-mint-300 focus:border-mint-500' : 'border-miss focus:border-miss'
              } ${shake ? 'anim-shake' : ''}`}
            />
            <div className="h-5 text-sm font-bold">
              {input.langHint ? (
                <span className="text-miss">⚠ {input.langHint}</span>
              ) : input.paused && !paused ? (
                <span className="text-ink/50">멈췄어요. 계속 치면 이어서 쳐요.</span>
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

        {kbVisible && (
          <div className="mx-auto w-full max-w-[520px] shrink-0 px-4 pb-3">
            <VirtualKeyboard
              kind={prefs.keyboardKind}
              lang={lang}
              target={kbTarget}
              wrongCode={input.wrongCode}
              wrongNonce={input.errorCount}
              showHands={prefs.showHands}
            />
          </div>
        )}
      </section>

      <ComboFlash combo={snap.combo} />
      {paused && !finished && <PauseModal onResume={resume} onQuit={() => nav('/home')} />}
      {finished && (
        <ResultModal
          title={finished.timeUp ? '시간 종료!' : '장문연습 완료!'}
          snapshot={finished.snap}
          result={result}
          lang={lang}
          note={
            finished.progress >= RECOGNIZE ? (
              <>진행률 {Math.round(finished.progress * 100)}% · 기록으로 인정돼요.</>
            ) : (
              <>진행률 {Math.round(finished.progress * 100)}% · 80% 이상 쳐야 최고 기록·순위에 반영돼요. 이번 연습은 저장만 했어요.</>
            )
          }
          onRetry={onRetry}
          onHome={() => nav('/home')}
          extra={
            <Btn variant="ghost" onClick={onList}>
              글 고르기
            </Btn>
          }
        />
      )}
    </div>
  );
}
