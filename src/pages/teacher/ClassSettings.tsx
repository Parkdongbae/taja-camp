// 수업 설정: backend.watchSettings 로 읽고, 바꾸면 바로 updateSettings 로 저장한다.
// 배틀 멈추기(문장·초)와 바른 말(욕설 제재 켜기·초·추가 낱말)도 여기서 정한다.
// 학급 배틀: 켜기·끄기(classBattle), 경기 시간(classBattleSec), 최근 기록 표.
// 연습·배틀 콘텐츠: 과목·단원을 여러 개 골라 Settings.contentPick 에 저장한다(모두 고르거나 하나도 안 고르면 전체 = 빈 목록).
import { useEffect, useMemo, useRef, useState } from 'react';
import { backend } from '../../data';
import { AppError, DEFAULT_SETTINGS, SUBJECT_LABEL, type ClassBattleRecord, type Settings, type Subject } from '../../data/types';
import { useContent } from '../../content';
import { contentGroups, type ContentGroup } from '../../content/pick';
import { Card } from '../../components/ui';
import { BAD_WORD_COUNT, findBadWord, squash } from '../../engine/badwords';
import { CLASS_DURATIONS, CLASS_RATES, dateLabel, normalizeClassDuration, normalizeClassRate } from '../../engine/classBattle';
import { FALL_SPEED_MAX, FALL_SPEED_MIN, fallMsAt, normalizeFallSpeed } from '../../engine/battle';

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-8 w-14 rounded-full transition focus:outline-none focus-visible:ring-4 focus-visible:ring-mint-300 ${on ? 'bg-mint-500' : 'bg-ink/20'}`}
    >
      <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? 'left-7' : 'left-1'}`} />
    </button>
  );
}

function Row({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-mint-100 py-4 last:border-0">
      <div>
        <div className="font-bold">{title}</div>
        <div className="text-sm text-ink/60">{desc}</div>
      </div>
      {children}
    </div>
  );
}

function Slider({
  value,
  min,
  max,
  unit,
  step = 1,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  unit: string;
  step?: number;
  onChange: (n: number) => void;
}) {
  // 끌고 있는 동안은 화면 값만 바꾸고, 놓을 때 저장한다
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div className="flex w-56 items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        className="flex-1 accent-mint-500"
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={() => v !== value && onChange(v)}
        onKeyUp={() => v !== value && onChange(v)}
        onBlur={() => v !== value && onChange(v)}
      />
      <span className="w-14 text-right font-bold tabular-nums">
        {v}
        {unit}
      </span>
    </div>
  );
}

// 연습·배틀에 낼 콘텐츠 고르기(과목·단원, 여러 개). pick 이 비어 있으면 전체.
function ContentPicker({ pick, onChange }: { pick: string[]; onChange: (p: string[]) => void }) {
  const allWords = useContent((s) => s.allWords);
  const allSentences = useContent((s) => s.allSentences);
  const allPassages = useContent((s) => s.allPassages);
  const groups = useMemo(() => contentGroups(allWords, allSentences, allPassages), [allWords, allSentences, allPassages]);
  const allKeys = useMemo(() => groups.map((g) => g.key), [groups]);
  const everything = pick.length === 0 || allKeys.every((k) => pick.includes(k));
  const sel = useMemo(() => new Set(everything ? allKeys : pick), [everything, allKeys, pick]);
  const bySubject = useMemo(() => {
    const m = new Map<Subject, ContentGroup[]>();
    for (const g of groups) m.set(g.subject, [...(m.get(g.subject) ?? []), g]);
    return [...m.entries()];
  }, [groups]);

  // 모두 고르거나 하나도 안 고르면 "전체"(빈 목록)로 저장한다
  const commit = (next: Set<string>) => {
    const list = allKeys.filter((k) => next.has(k));
    onChange(list.length === 0 || list.length === allKeys.length ? [] : list);
  };
  const toggle = (keys: string[], on: boolean) => {
    const next = new Set(sel);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    commit(next);
  };
  const total = groups.filter((g) => sel.has(g.key)).reduce((a, g) => ({ w: a.w + g.words, s: a.s + g.sentences, p: a.p + g.passages }), { w: 0, s: 0, p: 0 });

  return (
    <div className="py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-ink/70">
          {everything ? <b className="text-mint-700">전체 콘텐츠 사용 중</b> : <b className="text-mint-700">고른 콘텐츠만 사용 중</b>} · 낱말 {total.w}개 · 단문 {total.s}개 · 장문{' '}
          {total.p}개
        </div>
        <button
          onClick={() => onChange([])}
          disabled={everything}
          className="rounded-xl bg-mint-500 px-3 py-1.5 text-sm font-bold text-white hover:bg-mint-600 disabled:opacity-40"
        >
          전체 선택
        </button>
      </div>
      <div className="mt-3 space-y-3">
        {bySubject.map(([subject, list]) => {
          const keys = list.map((g) => g.key);
          const n = keys.filter((k) => sel.has(k)).length;
          return (
            <fieldset key={subject} className="rounded-xl border border-mint-100 p-3">
              <legend className="px-1">
                <label className="flex cursor-pointer items-center gap-2 font-bold">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-mint-500"
                    checked={n === keys.length}
                    ref={(el) => {
                      if (el) el.indeterminate = n > 0 && n < keys.length;
                    }}
                    onChange={(e) => toggle(keys, e.target.checked)}
                  />
                  {SUBJECT_LABEL[subject] ?? subject}
                  <span className="text-xs font-normal text-ink/50">
                    {n}/{keys.length} 단원
                  </span>
                </label>
              </legend>
              <div className="flex flex-wrap items-center gap-2">
                {list.map((g) => (
                  <label
                    key={g.key}
                    title={`낱말 ${g.words} · 단문 ${g.sentences} · 장문 ${g.passages}`}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border-2 px-3 py-1 text-sm transition ${
                      sel.has(g.key) ? 'border-mint-500 bg-mint-50 font-bold text-mint-700' : 'border-ink/10 text-ink/50'
                    }`}
                  >
                    <input type="checkbox" className="h-3.5 w-3.5 accent-mint-500" checked={sel.has(g.key)} onChange={(e) => toggle([g.key], e.target.checked)} />
                    {g.unit || '(단원 없음)'}
                    <span className="text-xs font-normal text-ink/40">{g.words + g.sentences + g.passages}</span>
                  </label>
                ))}
                <button onClick={() => commit(new Set(keys))} className="ml-auto text-xs font-bold text-mint-700 underline-offset-2 hover:underline">
                  이 과목만
                </button>
              </div>
            </fieldset>
          );
        })}
      </div>
      <div className="mt-3 text-xs text-ink/50">
        낱말·단문·장문 연습, 뜻 맞추기, 배틀에 고른 콘텐츠만 나와요. 고른 콘텐츠에 한국어(또는 영어) 자료가 하나도 없으면 그 언어는 전체 콘텐츠로 진행합니다. 수행평가 글과
        진행 중인 배틀에는 영향이 없어요.
      </div>
    </div>
  );
}

// 멈추기 문장: 치는 동안은 화면 값만 바꾸고, Enter 나 포커스를 옮길 때 저장한다
function PhraseInput({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const t = v.trim().replace(/\s+/g, ' ');
    setV(t);
    if (t !== value) onSave(t);
  };
  return (
    <input
      value={v}
      maxLength={40}
      placeholder="예: 홍길동 선생님 멋있어요."
      aria-label="멈추기 문장"
      autoComplete="off"
      spellCheck={false}
      className="w-full rounded-xl border-2 border-mint-200 px-4 py-2 text-lg font-bold outline-none focus:border-mint-500"
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur();
      }}
    />
  );
}

// 선생님이 추가하는 욕설 목록 + 걸리는지 시험해 보는 칸
function BadWords({ extra, onChange }: { extra: string[]; onChange: (list: string[]) => void }) {
  const [word, setWord] = useState('');
  const [probe, setProbe] = useState('');
  const [note, setNote] = useState('');
  const add = () => {
    const w = squash(word);
    if (!w) return setNote('한글이나 영어로 적어 주세요.');
    if (w.length < 2) return setNote('두 글자 이상으로 적어 주세요.');
    if (extra.length >= 300) return setNote('추가 낱말은 300개까지 넣을 수 있어요.');
    if (extra.includes(w) || findBadWord(w)) {
      setWord('');
      return setNote(`「${w}」는 이미 막고 있어요.`);
    }
    onChange([...extra, w]);
    setWord('');
    setNote(`「${w}」를 추가했어요.`);
  };
  const hit = probe.trim() ? findBadWord(probe, extra) : null;
  return (
    <div className="border-b border-mint-100 py-4 last:border-0">
      <div className="font-bold">욕설 낱말 추가</div>
      <div className="text-sm text-ink/60">
        기본 {BAD_WORD_COUNT}개를 이미 막고 있어요. 띄어쓰기·숫자·기호를 섞어 써도 잡습니다. 여기에 새 낱말을 더할 수 있어요.
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={word}
          maxLength={20}
          placeholder="추가할 낱말"
          aria-label="추가할 욕설 낱말"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-xl border-2 border-mint-200 px-3 py-2 outline-none focus:border-mint-500"
          onChange={(e) => setWord(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              add();
            }
          }}
        />
        <button onClick={add} className="shrink-0 rounded-xl bg-mint-500 px-4 py-2 font-bold text-white hover:bg-mint-600">
          추가
        </button>
      </div>
      {note && <div className="mt-1 text-sm text-mint-700">{note}</div>}
      {extra.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {extra.map((w) => (
            <span key={w} className="flex items-center gap-1 rounded-full bg-mint-100 py-1 pl-3 pr-1 text-sm font-bold">
              {w}
              <button
                aria-label={`${w} 삭제`}
                onClick={() => onChange(extra.filter((x) => x !== w))}
                className="flex h-5 w-5 items-center justify-center rounded-full text-ink/50 hover:bg-miss hover:text-white"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-3 text-sm text-ink/40">추가한 낱말이 없어요.</div>
      )}
      <div className="mt-4 flex items-center gap-3">
        <input
          value={probe}
          maxLength={40}
          placeholder="걸리는지 시험해 보기"
          aria-label="욕설 검사 시험"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-xl border-2 border-mint-100 px-3 py-2 text-sm outline-none focus:border-mint-500"
          onChange={(e) => setProbe(e.target.value)}
        />
        <span className={`w-40 shrink-0 text-sm font-bold ${hit ? 'text-miss' : 'text-mint-700'}`} aria-live="polite">
          {!probe.trim() ? '' : hit ? `막힘 (「${hit}」)` : '통과'}
        </span>
      </div>
    </div>
  );
}

// 최근 학급 배틀 기록(불러오지 못하면 아무것도 보이지 않는다)
function ClassBattleLog() {
  const [list, setList] = useState<ClassBattleRecord[]>([]);
  useEffect(() => {
    let off = false;
    backend
      .listClassBattles(30)
      .then((l) => !off && setList([...l].sort((a, b) => b.at - a.at).slice(0, 10)))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, []);
  if (list.length === 0) return null;
  return (
    <div className="mt-3 border-t border-mint-100 pt-3">
      <div className="mb-2 text-sm font-bold">최근 학급 배틀 기록</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink/50">
            <th className="py-1 font-normal">날짜</th>
            <th className="font-normal">반</th>
            <th className="text-right font-normal">총점</th>
            <th className="text-right font-normal">참여</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id} className="border-t border-mint-100">
              <td className="py-1.5">{dateLabel(r.date)}</td>
              <td>
                {r.grade}학년 {r.classNo}반
              </td>
              <td className="text-right font-bold tabular-nums">{r.total.toLocaleString()}점</td>
              <td className="text-right tabular-nums">{r.players.length}명</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ClassSettings() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<'' | 'saving' | 'saved' | 'error'>('');
  const [err, setErr] = useState('');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    try {
      return backend.watchSettings((v) => {
        setS({ ...DEFAULT_SETTINGS, ...v });
        setLoaded(true);
      });
    } catch {
      setErr('설정을 불러오지 못했습니다.');
    }
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const save = async (patch: Partial<Settings>) => {
    setS((o) => ({ ...o, ...patch }));
    setState('saving');
    setErr('');
    try {
      await backend.updateSettings(patch);
      setState('saved');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState(''), 2000);
    } catch (e) {
      setState('error');
      setErr(e instanceof AppError && e.code === 'PERMISSION' ? '권한이 없습니다.' : '저장하지 못했습니다. 잠시 후 다시 시도하세요.');
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-black">수업 설정</h1>
        <span className="text-sm font-bold text-mint-700" aria-live="polite">
          {state === 'saving' ? '저장 중...' : state === 'saved' ? '✓ 저장됨' : ''}
        </span>
      </div>
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-miss">{err}</p>}
      <Card className={loaded ? '' : 'opacity-60'}>
        <Row title="배틀 허용" desc="끄면 학생은 배틀에 들어갈 수 없어요.">
          <Toggle label="배틀 허용" on={s.battleEnabled} onChange={(v) => void save({ battleEnabled: v })} />
        </Row>
        <Row
          title="배틀 임시 공개"
          desc={
            s.battleEnabled
              ? '켜면 자리연습을 마치지 않은 학생도 배틀에 들어갈 수 있어요. 시험해 본 뒤에는 꼭 꺼 주세요.'
              : '「배틀 허용」이 꺼져 있으면 임시 공개를 켜도 들어갈 수 없어요.'
          }
        >
          <Toggle label="배틀 임시 공개" on={!!s.battleOpenAll} onChange={(v) => void save({ battleOpenAll: v })} />
        </Row>
        <Row title="하루 목표 시간" desc="오늘의 훈련 목표(5~20분).">
          <Slider value={s.dailyGoalMinutes} min={5} max={20} unit="분" onChange={(n) => void save({ dailyGoalMinutes: n })} />
        </Row>
        <Row title="승급 통과 점수" desc="승급 테스트 합격선(70~100점).">
          <Slider value={s.passScore} min={70} max={100} unit="점" onChange={(n) => void save({ passScore: n })} />
        </Row>
        <Row title="테스트 문항 제한 시간" desc="승급 테스트 한 문항당 시간(2~6초).">
          <Slider value={s.testSecondsPerItem} min={2} max={6} unit="초" onChange={(n) => void save({ testSecondsPerItem: n })} />
        </Row>
        <Row title="순위표 공개" desc="끄면 학생은 자기 기록만 볼 수 있어요.">
          <Toggle label="순위표 공개" on={s.rankingPublic} onChange={(v) => void save({ rankingPublic: v })} />
        </Row>
        <Row title="소리 허용" desc="타건음과 배틀 효과음. 끄면 학생이 소리를 켤 수 없어요.">
          <Toggle label="소리 허용" on={s.soundAllowed} onChange={(v) => void save({ soundAllowed: v })} />
        </Row>
      </Card>

      <h2 className="pt-2 text-lg font-black">학급 배틀</h2>
      <Card className={loaded ? '' : 'opacity-60'}>
        <Row
          title="학급 배틀 켜기"
          desc="켜면 학생의 배틀 화면에 '학급 배틀'이 보입니다. 같은 반 학생이 모두 한 방에 들어가 함께 치고, 반 총점과 참여 학생이 기록됩니다. 먼저 들어온 학생이 시작합니다."
        >
          <Toggle label="학급 배틀" on={!!s.classBattle} onChange={(v) => void save({ classBattle: v })} />
        </Row>
        <Row title="경기 시간" desc="학급 배틀 한 판의 길이(기본 5분). 다음에 만드는 방부터 적용돼요.">
          <div className="flex gap-1.5">
            {CLASS_DURATIONS.map((sec) => {
              const on = normalizeClassDuration(s.classBattleSec) === sec;
              return (
                <button
                  key={sec}
                  aria-pressed={on}
                  onClick={() => void save({ classBattleSec: sec })}
                  className={`shrink-0 whitespace-nowrap rounded-xl border-2 px-3 py-1.5 text-sm font-bold transition ${
                    on ? 'border-mint-500 bg-mint-50 text-mint-700' : 'border-mint-100 text-ink/60 hover:border-mint-300'
                  }`}
                >
                  {sec / 60}분
                </button>
              );
            })}
          </div>
        </Row>
        <Row
          title="낱말 수"
          desc={`참가자 1명당 화면에 동시에 뜨는 낱말 수(기본 1.5개). 30명이면 지금 설정으로 약 ${Math.min(60, 3 + Math.ceil(30 * normalizeClassRate(s.classBattleRate)))}개. 너무 많아 어지러우면 줄이세요. 다음에 시작하는 판부터 적용돼요.`}
        >
          <div className="flex gap-1.5">
            {CLASS_RATES.map((r) => {
              const on = normalizeClassRate(s.classBattleRate) === r;
              return (
                <button
                  key={r}
                  aria-pressed={on}
                  onClick={() => void save({ classBattleRate: r })}
                  className={`shrink-0 whitespace-nowrap rounded-xl border-2 px-3 py-1.5 text-sm font-bold transition ${
                    on ? 'border-mint-500 bg-mint-50 text-mint-700' : 'border-mint-100 text-ink/60 hover:border-mint-300'
                  }`}
                >
                  {r}개
                </button>
              );
            })}
          </div>
        </Row>
        <ClassBattleLog />
      </Card>

      <h2 className="pt-2 text-lg font-black">연습·배틀 콘텐츠</h2>
      <Card className={loaded ? '' : 'opacity-60'}>
        <ContentPicker pick={s.contentPick ?? []} onChange={(list) => void save({ contentPick: list })} />
      </Card>

      <h2 className="pt-2 text-lg font-black">배틀 낱말 속도</h2>
      <Card className={loaded ? '' : 'opacity-60'}>
        <div className="border-b border-mint-100 py-3 text-sm text-ink/60">
          점수별로 낱말이 떨어지는 속도예요. 100%가 기본이고, 숫자가 클수록 빨리 떨어져요. 바꾼 값은 다음에 시작하는 판부터 적용돼요.
        </div>
        {(
          [
            ['p1', '1점 낱말 (기본자리)'],
            ['p2', '2점 낱말 (한 단어)'],
            ['p4', '4점 낱말 (두 단어)'],
          ] as const
        ).map(([k, title]) => {
          const sp = normalizeFallSpeed(s.fallSpeed);
          const sec = (ms: number) => (ms / (sp[k] / 100) / 1000).toFixed(1);
          return (
            <Row key={k} title={title} desc={`바닥까지 처음 ${sec(fallMsAt(0, 1))}초 → 끝날 무렵 ${sec(fallMsAt(1, 1))}초`}>
              <Slider
                value={sp[k]}
                min={FALL_SPEED_MIN}
                max={FALL_SPEED_MAX}
                step={5}
                unit="%"
                onChange={(n) => void save({ fallSpeed: { ...sp, [k]: n } })}
              />
            </Row>
          );
        })}
      </Card>

      <h2 className="pt-2 text-lg font-black">배틀 멈추기</h2>
      <Card className={loaded ? '' : 'opacity-60'}>
        <div className="border-b border-mint-100 py-4">
          <div className="font-bold">멈추기 문장</div>
          <div className="mb-3 text-sm text-ink/60">
            배틀에서 이 문장을 그대로 치고 Enter 를 누른 학생만 잠시 입력할 수 있고, 나머지 학생은 입력이 막혀요. 한 판에 한 사람이 한 번만 쓸 수 있어요.
            비워 두면 멈추기를 쓰지 않아요.
          </div>
          <PhraseInput value={s.freezePhrase ?? ''} onSave={(v) => void save({ freezePhrase: v })} />
        </div>
        <Row title="멈추는 시간" desc="다른 학생의 입력이 막히는 시간(1~20초).">
          <Slider value={s.freezeSeconds ?? 5} min={1} max={20} unit="초" onChange={(n) => void save({ freezeSeconds: n })} />
        </Row>
      </Card>

      <h2 className="pt-2 text-lg font-black">배틀 바른 말</h2>
      <Card className={loaded ? '' : 'opacity-60'}>
        <Row title="욕설 제재" desc="배틀에서 욕설을 치면 경고 창이 뜨고 그 학생만 입력이 막혀요.">
          <Toggle label="욕설 제재" on={s.badWordBlock !== false} onChange={(v) => void save({ badWordBlock: v })} />
        </Row>
        <Row title="입력 금지 시간" desc="욕설을 친 학생의 입력이 막히는 시간(5~60초).">
          <Slider value={s.badWordSeconds ?? 10} min={5} max={60} unit="초" onChange={(n) => void save({ badWordSeconds: n })} />
        </Row>
        <BadWords extra={s.badWordsExtra ?? []} onChange={(list) => void save({ badWordsExtra: list })} />
      </Card>
    </div>
  );
}
