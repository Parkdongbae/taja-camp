// 낱말·단문·장문·퀴즈 화면이 함께 쓰는 작은 조각들.
//
// 공개 API
//   fmtTime(sec): "mm:ss"
//   useSnapshot(meter, ms = 500): MeterSnapshot   meter.snapshot 을 ms 마다 새로 읽는다
//   <PracticeSidebar title subtitle? onHome snap bestKpm lang extra? />   왼쪽 패널(← 홈, 타수·정확도·시간·오타, 약점 글쇠)
//   <PauseModal onResume onQuit />                 Esc 일시정지 창(Enter·Esc 계속)
//   <ComboFlash combo />                            연속 정타 10/30/50/100 에서 🔥 표시
//   <SubjectSelect kind lang value onChange /> / <LangToggle lang onChange />   위쪽 선택 줄 부품
//   ratioFor(bestKpm): [number, number, number]    docs/03 3.4 수준 비율
//   pickByLevel(pool, count, ratio, weight, recent)   수준 비율·가중치·최근 제외로 count 개 뽑기
//   getRecent(key) / rememberRecent(key, ids)       최근 50개 기억(모듈 변수)
//   useWindowKey(handler, enabled)                  window keydown 등록
//   useShake(trigger): boolean                      trigger 가 바뀌면 0.3초 true (anim-shake 용)
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { charOfKey, type MeterSnapshot, type TypingMeter } from '../engine';
import { SUBJECT_LABEL, type Lang, type Subject } from '../data/types';
import { subjectsFor, useContent, type SubjectFilter } from '../content';
import { Btn, Kbd, Modal } from './ui';

export const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function useSnapshot(meter: TypingMeter, ms = 500): MeterSnapshot {
  const [snap, setSnap] = useState(() => meter.snapshot(performance.now()));
  useEffect(() => {
    setSnap(meter.snapshot(performance.now()));
    const t = setInterval(() => setSnap(meter.snapshot(performance.now())), ms);
    return () => clearInterval(t);
  }, [meter, ms]);
  return snap;
}

export function useWindowKey(handler: (e: KeyboardEvent) => void, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const h = (e: KeyboardEvent) => ref.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [enabled]);
}

/** 약점 글쇠 상위 n 개: [글자, 횟수, code] */
export function weakList(missKeys: Record<string, number>, lang: Lang, n = 3): [string, number, string][] {
  return Object.entries(missKeys)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([code, c]) => [charOfKey(code, false, lang) || code, c, code]);
}

export function PracticeSidebar({
  title,
  subtitle,
  onHome,
  snap,
  bestKpm,
  lang,
  extra,
}: {
  title: string;
  subtitle?: string;
  onHome: () => void;
  snap: MeterSnapshot;
  bestKpm: number;
  lang: Lang;
  extra?: ReactNode;
}) {
  const weak = weakList(snap.missKeys, lang);
  const record = bestKpm > 0 && snap.kpm > bestKpm && snap.accuracy >= 90;
  return (
    <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-mint-200 bg-white/60 p-4">
      <button onClick={onHome} className="mb-2 self-start rounded-lg px-2 py-1 text-sm font-bold text-ink/70 hover:bg-mint-100">
        ← 홈
      </button>
      <div className="text-xl font-black text-mint-700">{title}</div>
      {subtitle ? <div className="mb-3 text-sm text-ink/60">{subtitle}</div> : <div className="mb-3" />}
      <div className="flex items-baseline justify-between border-b border-mint-200 py-2">
        <span className="text-sm text-ink/70">현재 타수</span>
        <span className={`rounded-md px-1.5 text-2xl font-black tabular-nums ${record ? 'border-2 border-gold' : 'border-2 border-transparent'}`}>
          {snap.kpm}
        </span>
      </div>
      <Row label="최고 타수" value={bestKpm || '-'} />
      <Row label="정확도" value={snap.accuracy ? `${snap.accuracy.toFixed(1)}%` : '-'} />
      <Row label="진행시간" value={fmtTime(snap.seconds)} />
      <Row label="오타" value={snap.typos} />
      {extra}
      <div className="mt-3 text-sm text-ink/70">
        약점:{' '}
        {weak.length ? (
          weak.map(([ch, c]) => (
            <span key={ch} className="mr-2 font-bold text-miss">
              {ch}
              <span className="text-xs font-normal text-ink/50">{c}</span>
            </span>
          ))
        ) : (
          <span className="text-ink/40">아직 없어요</span>
        )}
      </div>
      <div className="mt-auto flex items-center gap-1 pt-3 text-xs text-ink/50">
        <Kbd>Esc</Kbd> 일시정지
      </div>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between border-b border-mint-200 py-2">
      <span className="text-sm text-ink/70">{label}</span>
      <span className="text-lg font-bold tabular-nums">{value}</span>
    </div>
  );
}

export function PauseModal({ onResume, onQuit }: { onResume: () => void; onQuit: () => void }) {
  useWindowKey((e) => {
    if (e.key === 'Enter' && !e.repeat) {
      e.preventDefault();
      onResume();
    }
  });
  return (
    <Modal onClose={onResume}>
      <div className="text-center">
        <div className="text-4xl">⏸</div>
        <h2 className="mt-2 text-2xl font-black">잠깐 쉬어요</h2>
        <p className="mt-1 text-sm text-ink/60">시간이 멈췄어요. 준비되면 계속하세요.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Btn onClick={onResume} autoFocus>
            계속 <Kbd>Enter</Kbd>
          </Btn>
          <Btn variant="ghost" onClick={onQuit}>
            그만두기
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

const COMBO_STEPS = [10, 30, 50, 100];
export function ComboFlash({ combo }: { combo: number }) {
  const [flash, setFlash] = useState<number | null>(null);
  const prev = useRef(0);
  useEffect(() => {
    const crossed = COMBO_STEPS.filter((s) => prev.current < s && combo >= s).pop();
    prev.current = combo;
    if (crossed) {
      setFlash(crossed);
      const t = setTimeout(() => setFlash(null), 1000);
      return () => clearTimeout(t);
    }
  }, [combo]);
  if (!flash) return null;
  const tone = flash >= 100 ? 'text-miss' : flash >= 50 ? 'text-orange-500' : flash >= 30 ? 'text-gold' : 'text-mint-600';
  return (
    <div className={`anim-pop pointer-events-none absolute right-6 top-20 z-10 text-3xl font-black ${tone}`} aria-live="polite">
      🔥 {flash} 연속!
    </div>
  );
}

export function SubjectSelect({
  kind,
  lang,
  value,
  onChange,
}: {
  kind: 'words' | 'sentences' | 'passages';
  lang: Lang;
  value: SubjectFilter;
  onChange: (s: SubjectFilter) => void;
}) {
  useContent((s) => s[kind]); // 콘텐츠가 들어오면 목록을 다시 그린다
  const list: Subject[] = subjectsFor(kind, lang);
  return (
    <label className="flex items-center gap-2 text-sm font-bold text-ink/70">
      과목
      <select
        value={value}
        onChange={(e) => {
          onChange(e.target.value as SubjectFilter);
          e.currentTarget.blur();
        }}
        className="rounded-lg border border-mint-200 bg-white px-2 py-1 font-medium text-ink focus:outline-none focus-visible:ring-4 focus-visible:ring-mint-300"
      >
        <option value="all">섞어서</option>
        {list.map((s) => (
          <option key={s} value={s}>
            {SUBJECT_LABEL[s]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  const b = (l: Lang, label: string) => (
    <button
      key={l}
      onClick={(e) => {
        onChange(l);
        e.currentTarget.blur();
      }}
      className={`px-3 py-1 text-sm font-bold ${lang === l ? 'bg-mint-500 text-white' : 'bg-white text-ink/70 hover:bg-mint-50'}`}
    >
      {label}
    </button>
  );
  return <div className="flex overflow-hidden rounded-lg border border-mint-200">{[b('ko', '한국어'), b('en', 'ENG')]}</div>;
}

// ───────── 출제 ─────────
/** docs/03 3.4: 한글(영문) 최고 타수에 따른 수준 1:2:3 비율 */
export function ratioFor(bestKpm: number): [number, number, number] {
  if (bestKpm < 100) return [70, 30, 0];
  if (bestKpm < 200) return [30, 50, 20];
  return [10, 40, 50];
}

const recent: Record<string, string[]> = {};
export const getRecent = (key: string) => recent[key] ?? [];
export function rememberRecent(key: string, ids: string[]) {
  recent[key] = [...(recent[key] ?? []), ...ids].slice(-50);
}

function weightedPick<T>(items: T[], weight: (t: T) => number): T {
  const ws = items.map((t) => Math.max(0, weight(t)));
  const total = ws.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

/** 수준 비율·가중치로 count 개를 뽑는다. 최근에 낸 것은 풀이 넉넉하면 제외, 모자라면 다시 쓴다. */
export function pickByLevel<T extends { id: string; level: number }>(
  pool: T[],
  count: number,
  ratio: [number, number, number],
  weight: (t: T) => number,
  recentIds: string[],
): T[] {
  if (pool.length === 0) return [];
  let rem = pool.filter((x) => !recentIds.includes(x.id));
  if (rem.length < Math.min(count, pool.length)) rem = pool.slice();
  const out: T[] = [];
  while (out.length < count) {
    if (rem.length === 0) {
      const tail = out.slice(-3);
      rem = pool.filter((x) => !tail.includes(x));
      if (rem.length === 0) rem = pool.slice();
    }
    const levels = [1, 2, 3].filter((l) => ratio[l - 1] > 0 && rem.some((x) => x.level === l));
    const lv = levels.length ? weightedPick(levels, (l) => ratio[l - 1]) : null;
    const group = lv ? rem.filter((x) => x.level === lv) : rem;
    const p = weightedPick(group, weight);
    out.push(p);
    rem = rem.filter((x) => x !== p);
  }
  return out;
}

/** trigger 값이 바뀔 때마다 0.3초 true (입력창 흔들림 클래스용). */
export function useShake(trigger: number): boolean {
  const [on, setOn] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setOn(true);
    const t = setTimeout(() => setOn(false), 300);
    return () => clearTimeout(t);
  }, [trigger]);
  return on;
}
