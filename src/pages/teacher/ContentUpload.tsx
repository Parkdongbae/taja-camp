// 콘텐츠 올리기: ① AI(제미나이·챗GPT)용 프롬프트 복사 → ② AI 답(JSON)을 붙여넣거나 JSON 파일 선택 → 검증·미리 보기
// → '더하기'(같은 과목·단원만 바꿔 넣음, 기본) 또는 '전부 바꾸기'로 backend.uploadContent. 올린 단원 목록·단원 지우기, 내용 확인.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { backend } from '../../data';
import {
  AppError,
  SUBJECT_LABEL,
  type ContentBundle,
  type Lang,
  type PassageItem,
  type SentenceItem,
  type Subject,
  type WordItem,
} from '../../data/types';
import { isTypeable } from '../../engine/hangul';
import { loadContent, useContent } from '../../content';
import { Btn, Card, Modal } from '../../components/ui';
import { AI_SUBJECTS, aiPrompt, extractJson, mergeBundles, removeUnit, typeableText, unitSummary } from '../../content/upload';

const SUBJECTS = Object.keys(SUBJECT_LABEL) as Subject[];
const isSubject = (v: unknown): v is Subject => typeof v === 'string' && (SUBJECTS as string[]).includes(v);
const isLang = (v: unknown): v is Lang => v === 'ko' || v === 'en';
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
// 글자는 칠 수 있는 문장부호로 바꿔 둔다(AI 가 굽은 따옴표·가운뎃점을 섞어 쓰는 경우가 많다)
const txt = (v: unknown) => (typeof v === 'string' ? typeableText(v) : '');

interface Problem {
  file: string;
  kind: string;
  id: string;
  text: string;
  reason: string;
}
interface Merged {
  words: WordItem[];
  sentences: SentenceItem[];
  passages: PassageItem[];
  problems: Problem[];
  dupes: number;
}

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof AppError && e.code === 'PERMISSION') return '권한이 없습니다.';
  if (e instanceof AppError && e.code === 'NETWORK') return '인터넷 연결을 확인하세요.';
  return fallback;
}

// 파일들을 합치고 항목마다 검증한다.
function mergeAndValidate(files: { name: string; data: unknown }[]): Merged {
  const out: Merged = { words: [], sentences: [], passages: [], problems: [], dupes: 0 };
  const seen = new Set<string>();
  const bad = (file: string, kind: string, o: Record<string, unknown>, reason: string) =>
    out.problems.push({ file, kind, id: str(o.id), text: str(o.text) || str(o.title), reason });

  for (const f of files) {
    const d = f.data as Record<string, unknown> | null;
    if (!d || typeof d !== 'object') {
      out.problems.push({ file: f.name, kind: '파일', id: '', text: '', reason: 'JSON 객체가 아님' });
      continue;
    }
    for (const kind of ['words', 'sentences', 'passages'] as const) {
      const arr = d[kind];
      if (arr === undefined) continue;
      if (!Array.isArray(arr)) {
        out.problems.push({ file: f.name, kind, id: '', text: '', reason: '배열이 아님' });
        continue;
      }
      for (const raw of arr) {
        const o = (raw ?? {}) as Record<string, unknown>;
        const id = str(o.id);
        const text = txt(o.text);
        const level = o.level === undefined ? 1 : Number(o.level);
        let reason = '';
        if (!id) reason = 'id 없음';
        else if (!text) reason = 'text 없음';
        else if (!isLang(o.lang)) reason = 'lang 은 ko 또는 en';
        else if (!isSubject(o.subject)) reason = `subject 값이 잘못됨(${SUBJECTS.join('/')})`;
        else if (![1, 2, 3].includes(level)) reason = 'level 은 1~3';
        else if (kind === 'words' && !txt(o.meaning)) reason = 'meaning 없음';
        else if (kind === 'passages' && !txt(o.title)) reason = 'title 없음';
        else if (!isTypeable(text)) reason = '칠 수 없는 글자가 들어 있음';
        if (reason) {
          bad(f.name, kind, o, reason);
          continue;
        }
        const key = `${kind}:${id}`;
        if (seen.has(key)) {
          out.dupes++;
          continue;
        }
        seen.add(key);
        const base = { id, text, lang: o.lang as Lang, subject: o.subject as Subject, unit: txt(o.unit), level: level as 1 | 2 | 3 };
        if (kind === 'words') out.words.push({ ...base, meaning: txt(o.meaning) });
        else if (kind === 'sentences') out.sentences.push(base);
        else out.passages.push({ ...base, title: txt(o.title) });
      }
    }
  }
  return out;
}

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
};

export default function ContentUpload() {
  const content = useContent();
  const [merged, setMerged] = useState<Merged | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState('');
  const [mode, setMode] = useState<'add' | 'replace'>('add');
  // 교사가 올린 콘텐츠(내장 콘텐츠 제외). undefined = 불러오는 중
  const [mine, setMine] = useState<ContentBundle | null | undefined>(undefined);
  const [delUnit, setDelUnit] = useState<{ subject: Subject; unit: string } | null>(null);

  const reloadMine = useCallback(async () => {
    try {
      setMine(await backend.getContent());
    } catch {
      setMine(null);
    }
  }, []);
  useEffect(() => {
    void reloadMine();
  }, [reloadMine]);

  const reset = () => {
    setOk('');
    setErr('');
    setMerged(null);
  };

  const pick = async (files: FileList | null) => {
    reset();
    if (!files || files.length === 0) return;
    const read: { name: string; data: unknown }[] = [];
    const parseErrors: Problem[] = [];
    for (const f of Array.from(files)) {
      try {
        read.push({ name: f.name, data: extractJson(await f.text()) });
      } catch {
        parseErrors.push({ file: f.name, kind: '파일', id: '', text: '', reason: 'JSON 형식이 아님' });
      }
    }
    const m = mergeAndValidate(read);
    m.problems.unshift(...parseErrors);
    setNames(Array.from(files).map((f) => f.name));
    setMerged(m);
  };

  const checkPaste = () => {
    reset();
    let data: unknown;
    try {
      data = extractJson(paste);
    } catch {
      setErr('붙여 넣은 글에서 JSON 을 찾지 못했습니다. AI 답의 코드 블록 전체({ 부터 } 까지)를 복사했는지 확인하세요.');
      return;
    }
    setNames(['붙여 넣은 글']);
    setMerged(mergeAndValidate([{ name: '붙여넣기', data }]));
  };

  const total = merged ? merged.words.length + merged.sentences.length + merged.passages.length : 0;

  const save = async (items: { words: WordItem[]; sentences: SentenceItem[]; passages: PassageItem[] }) => {
    const bundle: ContentBundle = { version: 'tb-' + stamp(), ...items };
    await backend.uploadContent(bundle);
    await loadContent(true);
    setMine(bundle);
    return bundle;
  };

  const upload = async () => {
    if (!merged || total === 0) return;
    setBusy(true);
    setErr('');
    try {
      const add = { words: merged.words, sentences: merged.sentences, passages: merged.passages };
      // 더하기: 지금 올라가 있는 것을 다시 읽어 합친다(다른 선생님이 그사이 올렸을 수 있음)
      const cur = mode === 'add' ? await backend.getContent() : null;
      const m = mode === 'add' ? mergeBundles(cur, add) : { ...add, replacedUnits: [] as string[] };
      const b = await save({ words: m.words, sentences: m.sentences, passages: m.passages });
      const rep = m.replacedUnits.length ? ` · 바꿔 넣은 단원 ${m.replacedUnits.length}개` : '';
      setOk(
        `${mode === 'add' ? '더했습니다' : '전부 바꿨습니다'}. 이번에 낱말 ${add.words.length} · 단문 ${add.sentences.length} · 장문 ${add.passages.length}${rep}. ` +
          `(올린 콘텐츠 전체: 낱말 ${b.words.length} · 단문 ${b.sentences.length} · 장문 ${b.passages.length})`,
      );
      setMerged(null);
      setNames([]);
      setPaste('');
    } catch (e) {
      setErr(errMsg(e, '올리지 못했습니다. 잠시 후 다시 시도하세요.'));
    } finally {
      setBusy(false);
    }
  };

  const removeOne = async () => {
    if (!delUnit || !mine) return;
    setBusy(true);
    setErr('');
    try {
      const cur = (await backend.getContent()) ?? mine;
      await save(removeUnit(cur, delUnit.subject, delUnit.unit));
      setOk(`「${SUBJECT_LABEL[delUnit.subject]} · ${delUnit.unit}」 단원을 지웠습니다.`);
    } catch (e) {
      setErr(errMsg(e, '지우지 못했습니다. 잠시 후 다시 시도하세요.'));
    } finally {
      setBusy(false);
      setDelUnit(null);
    }
  };

  const units = mine ? unitSummary(mine) : [];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-black">콘텐츠 올리기</h1>

      <Card>
        <h2 className="mb-2 font-bold">현재 상태</h2>
        <p className="mb-3 text-sm">
          교과 콘텐츠:{' '}
          {content.hasTextbook ? <b className="text-mint-700">올라가 있음</b> : <b className="text-ink/60">없음 (내장 기초 콘텐츠만 사용 중)</b>}
          <span className="ml-3 text-ink/60">version {content.version}</span>
        </p>
        <CountTable />
        <h3 className="mb-1 mt-4 text-sm font-bold">내가 올린 단원</h3>
        {mine === undefined ? (
          <p className="text-sm text-ink/60">불러오는 중...</p>
        ) : units.length === 0 ? (
          <p className="text-sm text-ink/60">아직 올린 단원이 없습니다. (내장 콘텐츠는 지울 수 없습니다)</p>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-xl border border-mint-100">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-mint-200 text-left text-ink/60">
                  <th className="px-3 py-1.5">과목</th>
                  <th>단원</th>
                  <th>낱말</th>
                  <th>단문</th>
                  <th>장문</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u.key} className="border-b border-mint-100 last:border-0">
                    <td className="px-3 py-1.5 font-bold">{SUBJECT_LABEL[u.subject]}</td>
                    <td>{u.unit || '(단원 없음)'}</td>
                    <td className="tabular-nums">{u.words}</td>
                    <td className="tabular-nums">{u.sentences}</td>
                    <td className="tabular-nums">{u.passages}</td>
                    <td className="pr-3 text-right">
                      <button
                        className="rounded-lg px-2 py-1 text-xs font-bold text-miss hover:bg-red-50"
                        onClick={() => setDelUnit({ subject: u.subject, unit: u.unit })}
                        disabled={busy}
                      >
                        지우기
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AiPromptCard />

      <Card>
        <h2 className="mb-1 font-bold">② 올리기 (AI 답 붙여넣기 또는 JSON 파일)</h2>
        <p className="mb-3 text-sm text-ink/60">
          교과서 발췌 자료는 이 화면으로만 올리고, 올린 자료는 로그인한 학생만 볼 수 있습니다. 굽은 따옴표·가운뎃점처럼 자판에 없는 문장부호는 자동으로 바꿉니다.
          <br />
          형식: <code>{'{ "words": [...], "sentences": [...], "passages": [...] }'}</code>
        </p>
        <textarea
          className="h-36 w-full rounded-xl border border-mint-200 bg-white p-3 font-mono text-xs outline-none focus:border-mint-500 focus:ring-4 focus:ring-mint-100"
          placeholder="AI 가 출력한 답(```json … ``` 코드 블록)을 통째로 여기에 붙여 넣으세요."
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          spellCheck={false}
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Btn onClick={checkPaste} disabled={!paste.trim()}>
            붙여 넣은 글 확인
          </Btn>
          <span className="text-sm text-ink/50">또는</span>
          <input
            type="file"
            accept=".json,.txt,application/json,text/plain"
            multiple
            onChange={(e) => {
              void pick(e.target.files);
              e.target.value = '';
            }}
            className="block text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-mint-500 file:px-4 file:py-2 file:font-bold file:text-white hover:file:bg-mint-600"
          />
        </div>
        {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-miss">{err}</p>}
        {ok && <p className="mt-3 rounded-lg bg-mint-100 px-3 py-2 text-sm font-bold text-mint-700">{ok}</p>}

        {merged && (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-ink/60">선택한 파일: {names.join(', ')}</p>
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                ['낱말', merged.words.length],
                ['단문', merged.sentences.length],
                ['장문', merged.passages.length],
              ].map(([l, n]) => (
                <div key={l} className="rounded-xl bg-mint-50 p-3">
                  <div className="text-xs text-ink/60">{l}</div>
                  <div className="text-2xl font-black tabular-nums">{n}</div>
                </div>
              ))}
            </div>
            {merged.dupes > 0 && <p className="text-sm text-ink/60">id 가 겹치는 {merged.dupes}개는 하나만 남겼습니다.</p>}
            {merged.problems.length > 0 && (
              <div>
                <p className="mb-1 text-sm font-bold text-miss">제외된 항목 {merged.problems.length}개</p>
                <div className="max-h-48 overflow-y-auto rounded-xl border border-red-200 bg-red-50 text-sm">
                  <table className="w-full">
                    <tbody>
                      {merged.problems.map((p, i) => (
                        <tr key={i} className="border-b border-red-100 last:border-0">
                          <td className="px-3 py-1 text-ink/60">{p.file}</td>
                          <td>{p.kind}</td>
                          <td className="tabular-nums">{p.id}</td>
                          <td className="max-w-xs truncate">{p.text}</td>
                          <td className="text-miss">{p.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-4">
              <div className="flex gap-1 rounded-xl bg-mint-50 p-1 text-sm" role="radiogroup" aria-label="올리기 방식">
                {(
                  [
                    ['add', '더하기', '같은 과목·단원만 새것으로 바꾸고 나머지는 그대로'],
                    ['replace', '전부 바꾸기', '올린 콘텐츠 전체를 이것으로 바꿈'],
                  ] as const
                ).map(([v, l, d]) => (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={mode === v}
                    title={d}
                    onClick={() => setMode(v)}
                    className={`rounded-lg px-3 py-1.5 font-bold ${mode === v ? 'bg-white text-mint-700 shadow-sm' : 'text-ink/50'}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <span className="text-xs text-ink/50">
                {mode === 'add' ? '같은 과목·단원 이름은 새것으로 바뀌고, 다른 단원은 그대로 남습니다.' : '지금 올라가 있는 교과 콘텐츠가 모두 지워집니다.'}
              </span>
              <Btn onClick={() => void upload()} disabled={busy || total === 0}>
                {busy ? '올리는 중...' : `올리기 (${total}개)`}
              </Btn>
            </div>
            <Preview m={merged} />
          </div>
        )}
      </Card>

      <Viewer />

      {delUnit && (
        <Modal onClose={() => setDelUnit(null)}>
          <h3 className="mb-2 text-lg font-black">단원 지우기</h3>
          <p className="mb-4 text-sm">
            「{SUBJECT_LABEL[delUnit.subject]} · {delUnit.unit || '(단원 없음)'}」의 낱말·단문·장문을 모두 지웁니다. 되돌릴 수 없습니다.
          </p>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setDelUnit(null)}>
              취소
            </Btn>
            <Btn variant="danger" onClick={() => void removeOne()} disabled={busy}>
              지우기
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// 미리 보기: 단원별 개수와 낱말 몇 개
function Preview({ m }: { m: Merged }) {
  const rows = unitSummary(m);
  if (rows.length === 0) return null;
  return (
    <div className="max-h-72 overflow-y-auto rounded-xl border border-mint-100 text-sm">
      <table className="w-full">
        <thead className="sticky top-0 bg-white">
          <tr className="border-b border-mint-200 text-left text-ink/60">
            <th className="px-3 py-1.5">과목 · 단원</th>
            <th>낱말</th>
            <th>단문</th>
            <th>장문</th>
            <th>낱말 예시</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-mint-100 align-top last:border-0">
              <td className="px-3 py-1.5 font-bold">
                {SUBJECT_LABEL[r.subject]} · {r.unit || '(단원 없음)'}
              </td>
              <td className="tabular-nums">{r.words}</td>
              <td className="tabular-nums">{r.sentences}</td>
              <td className="tabular-nums">{r.passages}</td>
              <td className="py-1.5 pr-3 text-ink/70">
                {m.words
                  .filter((w) => w.subject === r.subject && w.unit === r.unit)
                  .slice(0, 4)
                  .map((w) => `${w.text}: ${w.meaning}`)
                  .join(' / ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CountTable() {
  const { allWords: words, allSentences: sentences, allPassages: passages } = useContent();
  const rows = SUBJECTS.map((s) => ({
    s,
    w: words.filter((x) => x.subject === s).length,
    n: sentences.filter((x) => x.subject === s).length,
    p: passages.filter((x) => x.subject === s).length,
  })).filter((r) => r.w + r.n + r.p > 0);
  return (
    <table className="w-full max-w-md text-sm">
      <thead>
        <tr className="border-b border-mint-200 text-left text-ink/60">
          <th className="py-1.5">과목</th>
          <th>낱말</th>
          <th>단문</th>
          <th>장문</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.s} className="border-b border-mint-100 last:border-0">
            <td className="py-1.5 font-bold">{SUBJECT_LABEL[r.s]}</td>
            <td className="tabular-nums">{r.w}</td>
            <td className="tabular-nums">{r.n}</td>
            <td className="tabular-nums">{r.p}</td>
          </tr>
        ))}
        <tr className="font-bold">
          <td className="py-1.5">합계</td>
          <td className="tabular-nums">{words.length}</td>
          <td className="tabular-nums">{sentences.length}</td>
          <td className="tabular-nums">{passages.length}</td>
        </tr>
      </tbody>
    </table>
  );
}

// 교사용 내용 확인: 과목을 고르면 낱말·뜻 표
function Viewer() {
  const words = useContent((s) => s.allWords);
  const [subject, setSubject] = useState<Subject>('basic');
  const [lang, setLang] = useState<Lang>('ko');
  const rows = useMemo(() => words.filter((w) => w.subject === subject && w.lang === lang), [words, subject, lang]);
  const sel = 'rounded-xl border border-mint-200 bg-white px-3 py-2 text-sm';
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="font-bold">내용 확인 (낱말·뜻)</h2>
        <select className={sel} value={subject} onChange={(e) => setSubject(e.target.value as Subject)}>
          {SUBJECTS.map((s) => (
            <option key={s} value={s}>
              {SUBJECT_LABEL[s]}
            </option>
          ))}
        </select>
        <select className={sel} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
          <option value="ko">한글</option>
          <option value="en">영문</option>
        </select>
        <span className="text-sm text-ink/60">{rows.length}개{rows.length > 200 ? ' (앞 200개만 표시)' : ''}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-ink/60">이 과목에는 낱말이 없습니다.</p>
      ) : (
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-mint-200 text-left text-ink/60">
                <th className="py-1.5">낱말</th>
                <th>뜻</th>
                <th>단원</th>
                <th>수준</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((w) => (
                <tr key={w.id} className="border-b border-mint-100 last:border-0">
                  <td className="py-1.5 font-bold">{w.text}</td>
                  <td>{w.meaning}</td>
                  <td className="text-ink/60">{w.unit}</td>
                  <td className="tabular-nums">{w.level}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// AI(제미나이·챗GPT)에게 자료와 함께 줄 프롬프트
function AiPromptCard() {
  const [grade, setGrade] = useState(2);
  const [subject, setSubject] = useState<Subject>('korean');
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState('');
  const prompt = useMemo(() => aiPrompt({ grade, subject }), [grade, subject]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied('복사했습니다. AI 채팅 창에 붙여 넣으세요.');
    } catch {
      setOpen(true);
      setCopied('자동 복사가 막혀 있습니다. 아래 글상자를 눌러 전체 선택(Ctrl+A) 후 복사(Ctrl+C)하세요.');
    }
  };
  const sel = 'rounded-xl border border-mint-200 bg-white px-3 py-2 text-sm';
  return (
    <Card>
      <h2 className="mb-1 font-bold">① AI 로 콘텐츠 만들기 (PDF·HWPX → JSON)</h2>
      <ol className="mb-3 list-decimal space-y-0.5 pl-5 text-sm text-ink/70">
        <li>학년과 과목을 고르고 [프롬프트 복사]를 누릅니다.</li>
        <li>제미나이(gemini.google.com)나 챗GPT 를 열고 교과서·학습지 파일(PDF 또는 HWPX)을 첨부한 뒤, 복사한 프롬프트를 붙여 넣어 보냅니다.</li>
        <li>AI 가 출력한 JSON 코드 블록을 통째로 복사해 아래 ②에 붙여 넣고 [붙여 넣은 글 확인] → [올리기].</li>
        <li>답이 중간에 끊기면 AI 에게 "계속"이라고 보내고, 새로 나온 JSON 도 같은 방법으로 올립니다(더하기).</li>
      </ol>
      <p className="mb-3 rounded-lg bg-gold/15 px-3 py-2 text-xs text-ink/70">
        HWPX 를 읽지 못하는 AI 도 있습니다. 그럴 때는 한글에서 [파일 → PDF로 저장하기] 한 뒤 PDF 를 첨부하세요. 파일이 크면 단원별로 나눠 첨부하는 것이 정확합니다.
        AI 가 만든 뜻풀이·문장은 올리기 전에 미리 보기에서 한 번 훑어보세요.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <select className={sel} value={grade} onChange={(e) => setGrade(Number(e.target.value))} aria-label="학년">
          {[1, 2, 3].map((g) => (
            <option key={g} value={g}>
              {g}학년
            </option>
          ))}
        </select>
        <select className={sel} value={subject} onChange={(e) => setSubject(e.target.value as Subject)} aria-label="과목">
          {AI_SUBJECTS.map((s) => (
            <option key={s} value={s}>
              {SUBJECT_LABEL[s]}
            </option>
          ))}
        </select>
        <Btn onClick={() => void copy()}>📋 프롬프트 복사</Btn>
        <button className="text-sm text-ink/60 underline hover:text-ink" onClick={() => setOpen((v) => !v)}>
          {open ? '프롬프트 접기' : '프롬프트 보기'}
        </button>
      </div>
      {copied && <p className="mt-2 text-sm font-bold text-mint-700">{copied}</p>}
      {open && (
        <textarea
          readOnly
          className="mt-3 h-72 w-full rounded-xl border border-mint-200 bg-mint-50 p-3 font-mono text-xs"
          value={prompt}
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
    </Card>
  );
}
