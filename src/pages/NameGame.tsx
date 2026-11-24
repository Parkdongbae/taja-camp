// 학생이름 외우기(선생님 전용). 나이스 사진명렬표 엑셀을 브라우저 안에서만 읽어 사진 카드가 떨어지는 이름 맞추기 게임.
// 사진·이름은 이 컴퓨터 브라우저(IndexedDB, roster/store)에만 저장하고 서버로 보내지 않는다(backend·fetch·finishSession 쓰지 않음).
// 흐름: 준비(명렬표 등록·선택·옵션, Enter 시작) → 게임(components/names/NamePlay) → 결과(components/names/NameResult)
// localStorage 에는 체크를 끈 명렬표 id·끈 반·옵션만 남긴다(이름·사진은 넣지 않음).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../state/auth';
import type { RosterFile, RosterStudent } from '../roster/types';
import { RosterError } from '../roster/types';
import { parseRoster } from '../roster/parse';
import { addRoster, clearRosters, listRosters, removeRoster } from '../roster/store';
import { NEIS_GUIDE } from '../roster/guide';
import { NAME_MODES, SPEEDS, pickStudents, rosterClassKeys, type NameMode, type Speed } from '../roster/game';
import NamePlay, { type NameGameResult } from '../components/names/NamePlay';
import NameResult from '../components/names/NameResult';
import { useWindowKey } from '../components/PracticeParts';
import { Btn, Card, Kbd, Modal, Spinner } from '../components/ui';

const LS_KEY = 'taja.nameGame.v1';

interface Saved {
  /** 체크를 끈 명렬표 id (새로 넣은 파일은 기본 체크) */
  off: string[];
  /** 끈 반 "학년-반" */
  classOff: string[];
  mode: NameMode;
  speed: Speed;
}

const DEFAULT_SAVED: Saved = { off: [], classOff: [], mode: 'show', speed: 'normal' };

function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_SAVED;
    const v = JSON.parse(raw) as Partial<Saved>;
    return {
      off: Array.isArray(v.off) ? v.off.filter((x) => typeof x === 'string') : [],
      classOff: Array.isArray(v.classOff) ? v.classOff.filter((x) => typeof x === 'string') : [],
      mode: NAME_MODES.some((m) => m.id === v.mode) ? (v.mode as NameMode) : 'show',
      speed: SPEEDS.some((m) => m.id === v.speed) ? (v.speed as Speed) : 'normal',
    };
  } catch {
    return DEFAULT_SAVED;
  }
}

function storeSaved(s: Saved) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    // 저장 못 해도 게임은 된다
  }
}

interface Run {
  students: RosterStudent[];
  seed: number;
  /** 같은 설정으로 한 번 더 할 때마다 바뀌어 NamePlay 를 새로 만든다 */
  n: number;
}

export default function NameGame() {
  const { ready, student } = useAuth();
  const [saved, setSaved] = useState<Saved>(loadSaved);
  const [run, setRun] = useState<Run | null>(null);
  const [result, setResult] = useState<NameGameResult | null>(null);

  const update = useCallback((patch: Partial<Saved>) => {
    setSaved((s) => {
      const next = { ...s, ...patch };
      storeSaved(next);
      return next;
    });
  }, []);

  if (!ready) return <Spinner />;
  if (student?.teacher !== true) return <Navigate to="/home" replace />;

  const start = (students: RosterStudent[]) => {
    setResult(null);
    setRun((r) => ({ students, seed: (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0, n: (r?.n ?? 0) + 1 }));
  };
  const back = () => {
    setResult(null);
    setRun(null);
  };

  if (run && result) {
    return (
      <NameResult
        result={result}
        students={run.students}
        onAgain={() => start(run.students)}
        onRetryConfused={(list) => start(list)}
        onBack={back}
      />
    );
  }
  if (run) {
    return <NamePlay key={run.n} students={run.students} mode={saved.mode} speed={saved.speed} seed={run.seed} onEnd={setResult} />;
  }
  return <Setup saved={saved} update={update} onStart={start} />;
}

// ── 준비 화면 ──
interface FileMsg {
  fileName: string;
  ok: boolean;
  text: string;
}

function Setup({ saved, update, onStart }: { saved: Saved; update: (p: Partial<Saved>) => void; onStart: (s: RosterStudent[]) => void }) {
  const [rosters, setRosters] = useState<RosterFile[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<FileMsg[]>([]);
  const [guideOpen, setGuideOpen] = useState<boolean | null>(null); // null = 명렬표 유무로 결정
  const [confirmClear, setConfirmClear] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setRosters(await listRosters());
      setLoadError(null);
    } catch {
      setRosters([]);
      setLoadError('이 브라우저에 저장된 명렬표를 읽지 못했어요. 시크릿 창이면 일반 창에서 열어 주세요.');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const list = useMemo(() => rosters ?? [], [rosters]);
  const checkedIds = useMemo(() => list.filter((r) => !saved.off.includes(r.id)).map((r) => r.id), [list, saved.off]);
  const chips = useMemo(() => rosterClassKeys(list, checkedIds), [list, checkedIds]);
  const onKeys = chips.filter((c) => !saved.classOff.includes(c.key)).map((c) => c.key);
  const picked = useMemo(
    () => pickStudents(list, { rosterIds: checkedIds, classKeys: onKeys.length === chips.length ? [] : onKeys.length ? onKeys : ['-'] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, checkedIds, onKeys.join(','), chips.length],
  );

  const open = guideOpen ?? (rosters !== null && rosters.length === 0);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setWarn(null);
    const out: FileMsg[] = [];
    let current = await listRosters().catch(() => list);
    for (const f of Array.from(files)) {
      try {
        const parsed = await parseRoster(await f.arrayBuffer());
        const same = current.filter((r) => r.fileName === f.name);
        for (const r of same) await removeRoster(r.id);
        const added = await addRoster(f.name, parsed);
        current = current.filter((r) => r.fileName !== f.name).concat(added);
        const withPhoto = parsed.students.filter((s) => s.photo).length;
        out.push({
          fileName: f.name,
          ok: true,
          text: `${same.length ? '바꿔 넣음' : '등록'}: ${parsed.title || f.name} (사진 ${withPhoto}/${parsed.students.length}명)`,
        });
      } catch (e) {
        out.push({ fileName: f.name, ok: false, text: e instanceof RosterError ? e.message : '파일을 읽지 못했어요. 나이스에서 저장한 사진명렬표 엑셀인지 확인해 주세요.' });
      }
    }
    setMsgs(out);
    if (fileRef.current) fileRef.current.value = '';
    await reload();
    setBusy(false);
  };

  const toggleRoster = (id: string) => {
    update({ off: saved.off.includes(id) ? saved.off.filter((x) => x !== id) : [...saved.off, id] });
  };
  const toggleClass = (key: string) => {
    update({ classOff: saved.classOff.includes(key) ? saved.classOff.filter((x) => x !== key) : [...saved.classOff, key] });
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await removeRoster(id);
      update({ off: saved.off.filter((x) => x !== id) });
    } finally {
      await reload();
      setBusy(false);
    }
  };

  const clearAll = async () => {
    setConfirmClear(false);
    setBusy(true);
    try {
      await clearRosters();
      update({ off: [], classOff: [] });
      setMsgs([]);
    } finally {
      await reload();
      setBusy(false);
    }
  };

  const tryStart = () => {
    if (busy || rosters === null) return;
    if (picked.length === 0) {
      setWarn(
        list.length === 0
          ? '먼저 사진명렬표 파일을 등록하세요.'
          : '고른 명렬표·반에 사진이 있는 학생이 없어요. 체크를 확인해 주세요.',
      );
      return;
    }
    onStart(picked);
  };

  useWindowKey(
    (e) => {
      if (e.key !== 'Enter' || e.repeat || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'BUTTON' || tag === 'A' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'SUMMARY') return;
      if (tag === 'INPUT' && (t as HTMLInputElement).type === 'file') return;
      e.preventDefault();
      tryStart();
    },
    !confirmClear,
  );

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-2xl font-black">학생이름 외우기</h1>
            <p className="text-sm text-ink/60">사진 카드가 내려오면 이름을 쳐서 맞춰요.</p>
          </div>
          <p className="rounded-lg bg-gold/15 px-3 py-1.5 text-xs text-ink/80">
            🔒 사진과 이름은 이 컴퓨터 브라우저에만 저장되고 서버로 전송되지 않아요. 공용 컴퓨터에서는 끝난 뒤 [모두 지우기]를 누르세요.
          </p>
        </div>

        {/* 나이스 저장 방법 */}
        <Card>
          <button
            type="button"
            className="flex w-full items-center justify-between text-left font-bold focus:outline-none focus-visible:ring-4 focus-visible:ring-mint-300"
            aria-expanded={open}
            onClick={() => setGuideOpen(!open)}
          >
            <span>📋 {NEIS_GUIDE.title}</span>
            <span className="text-sm text-ink/50">{open ? '접기 ▲' : '펼치기 ▼'}</span>
          </button>
          {open && (
            <div className="mt-3 text-sm">
              <ol className="list-decimal space-y-1 pl-5">
                {NEIS_GUIDE.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              {NEIS_GUIDE.notes.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-ink/60">
                  {NEIS_GUIDE.notes.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>

        {/* 파일 등록·목록 */}
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-bold">사진명렬표</h2>
            <Btn small onClick={() => fileRef.current?.click()} disabled={busy}>
              📂 명렬표 파일 선택
            </Btn>
            <span className="text-xs text-ink/50">여러 개를 한꺼번에 골라도 돼요(반별 또는 학년 전체).</span>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => void onFiles(e.currentTarget.files)}
            />
            {list.length > 0 && (
              <Btn small variant="danger" className="ml-auto" onClick={() => setConfirmClear(true)} disabled={busy}>
                모두 지우기
              </Btn>
            )}
          </div>

          {busy && <p className="mt-2 text-sm text-ink/60">처리하는 중...</p>}
          {loadError && <p className="mt-2 text-sm text-miss">{loadError}</p>}
          {msgs.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm" aria-live="polite">
              {msgs.map((m, i) => (
                <li key={i} className={m.ok ? 'text-mint-700' : 'text-miss'}>
                  {m.ok ? '✔' : '✖'} <span className="font-medium">{m.fileName}</span> — {m.text}
                </li>
              ))}
            </ul>
          )}

          {rosters === null ? (
            <p className="mt-3 text-sm text-ink/60">불러오는 중...</p>
          ) : list.length === 0 ? (
            <p className="mt-3 text-sm text-ink/60">아직 등록한 명렬표가 없어요.</p>
          ) : (
            <ul className="mt-3 divide-y divide-mint-100">
              {list.map((r) => {
                const withPhoto = r.students.filter((s) => s.photo).length;
                const on = !saved.off.includes(r.id);
                return (
                  <li key={r.id} className="flex items-center gap-3 py-2">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-mint-500"
                      checked={on}
                      onChange={() => toggleRoster(r.id)}
                      aria-label={`${r.title} 고르기`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold">{r.title || r.fileName}</div>
                      <div className="truncate text-xs text-ink/50">{r.fileName}</div>
                    </div>
                    <div className="text-sm tabular-nums text-ink/70">
                      사진 {withPhoto}/{r.students.length}명
                    </div>
                    <Btn small variant="ghost" onClick={() => void remove(r.id)} disabled={busy} aria-label={`${r.title} 삭제`}>
                      삭제
                    </Btn>
                  </li>
                );
              })}
            </ul>
          )}

          {chips.length > 1 && (
            <div className="mt-3">
              <div className="mb-1 text-sm font-bold">반 고르기</div>
              <div className="flex flex-wrap gap-2">
                {chips.map((c) => {
                  const on = !saved.classOff.includes(c.key);
                  return (
                    <button
                      key={c.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleClass(c.key)}
                      className={`rounded-full border px-3 py-1 text-sm font-medium focus:outline-none focus-visible:ring-4 focus-visible:ring-mint-300 ${
                        on ? 'border-mint-500 bg-mint-500 text-white' : 'border-mint-200 bg-white text-ink/60'
                      }`}
                    >
                      {c.grade}학년 {c.classNo}반 <span className="opacity-70">({c.count})</span>
                    </button>
                  );
                })}
                {saved.classOff.length > 0 && (
                  <button
                    type="button"
                    onClick={() => update({ classOff: [] })}
                    className="rounded-full px-3 py-1 text-sm text-mint-700 underline focus:outline-none focus-visible:ring-4 focus-visible:ring-mint-300"
                  >
                    모두 고르기
                  </button>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* 옵션·시작 */}
        <Card>
          <div className="flex flex-wrap gap-x-10 gap-y-3">
            <OptionRow label="이름 표시" items={NAME_MODES} value={saved.mode} onChange={(mode) => update({ mode })} />
            <OptionRow label="속도" items={SPEEDS} value={saved.speed} onChange={(speed) => update({ speed })} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Btn onClick={tryStart} disabled={busy || rosters === null}>
              시작 <Kbd>Enter</Kbd>
            </Btn>
            <span className="text-sm text-ink/70">
              사진 있는 학생 <b className="tabular-nums">{picked.length}</b>명
            </span>
            {warn && <span className="text-sm font-medium text-miss">{warn}</span>}
          </div>
        </Card>
      </div>

      {confirmClear && (
        <Modal onClose={() => setConfirmClear(false)}>
          <h2 className="text-xl font-black">명렬표를 모두 지울까요?</h2>
          <p className="mt-2 text-sm text-ink/70">이 브라우저에 저장한 사진과 이름이 모두 지워져요. 되돌릴 수 없어요.</p>
          <div className="mt-6 flex justify-end gap-3">
            <Btn variant="ghost" onClick={() => setConfirmClear(false)} autoFocus>
              취소 <Kbd>Esc</Kbd>
            </Btn>
            <Btn variant="danger" onClick={() => void clearAll()}>
              모두 지우기
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

function OptionRow<T extends string>({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label}>
      <div className="mb-1 text-sm font-bold">{label}</div>
      <div className="flex gap-1 rounded-xl bg-mint-50 p-1">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            role="radio"
            aria-checked={value === it.id}
            onClick={() => onChange(it.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-4 focus-visible:ring-mint-300 ${
              value === it.id ? 'bg-white text-mint-700 shadow-sm' : 'text-ink/60 hover:text-ink'
            }`}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}
