// 콘텐츠 올리기: JSON 파일(여러 개) → 합치기·검증 → 미리 보기 → backend.uploadContent. 현재 콘텐츠 목록도 확인한다.
import { useMemo, useState } from 'react';
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
import { Btn, Card } from '../../components/ui';

const SUBJECTS = Object.keys(SUBJECT_LABEL) as Subject[];
const isSubject = (v: unknown): v is Subject => typeof v === 'string' && (SUBJECTS as string[]).includes(v);
const isLang = (v: unknown): v is Lang => v === 'ko' || v === 'en';
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

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
        const text = str(o.text);
        const level = o.level === undefined ? 1 : Number(o.level);
        let reason = '';
        if (!id) reason = 'id 없음';
        else if (!text) reason = 'text 없음';
        else if (!isLang(o.lang)) reason = 'lang 은 ko 또는 en';
        else if (!isSubject(o.subject)) reason = `subject 값이 잘못됨(${SUBJECTS.join('/')})`;
        else if (![1, 2, 3].includes(level)) reason = 'level 은 1~3';
        else if (kind === 'words' && !str(o.meaning)) reason = 'meaning 없음';
        else if (kind === 'passages' && !str(o.title)) reason = 'title 없음';
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
        const base = { id, text, lang: o.lang as Lang, subject: o.subject as Subject, unit: str(o.unit), level: level as 1 | 2 | 3 };
        if (kind === 'words') out.words.push({ ...base, meaning: str(o.meaning) });
        else if (kind === 'sentences') out.sentences.push(base);
        else out.passages.push({ ...base, title: str(o.title) });
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

  const pick = async (files: FileList | null) => {
    setOk('');
    setErr('');
    setMerged(null);
    if (!files || files.length === 0) return;
    const read: { name: string; data: unknown }[] = [];
    const parseErrors: Problem[] = [];
    for (const f of Array.from(files)) {
      try {
        read.push({ name: f.name, data: JSON.parse(await f.text()) });
      } catch {
        parseErrors.push({ file: f.name, kind: '파일', id: '', text: '', reason: 'JSON 형식이 아님' });
      }
    }
    const m = mergeAndValidate(read);
    m.problems.unshift(...parseErrors);
    setNames(Array.from(files).map((f) => f.name));
    setMerged(m);
  };

  const total = merged ? merged.words.length + merged.sentences.length + merged.passages.length : 0;

  const upload = async () => {
    if (!merged || total === 0) return;
    setBusy(true);
    setErr('');
    try {
      const bundle: ContentBundle = {
        version: 'tb-' + stamp(),
        words: merged.words,
        sentences: merged.sentences,
        passages: merged.passages,
      };
      await backend.uploadContent(bundle);
      await loadContent(true);
      setOk(`올렸습니다. (낱말 ${bundle.words.length} · 단문 ${bundle.sentences.length} · 장문 ${bundle.passages.length})`);
      setMerged(null);
      setNames([]);
    } catch (e) {
      setErr(errMsg(e, '올리지 못했습니다. 잠시 후 다시 시도하세요.'));
    } finally {
      setBusy(false);
    }
  };

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
      </Card>

      <Card>
        <h2 className="mb-1 font-bold">JSON 파일 올리기</h2>
        <p className="mb-3 text-sm text-ink/60">
          교과서 발췌 자료는 이 화면으로만 올리고, 올린 자료는 로그인한 학생만 볼 수 있습니다. 새로 올리면 이전에 올린 교과 콘텐츠는 대체됩니다.
          <br />
          형식: <code>{'{ "words": [...], "sentences": [...], "passages": [...] }'}</code> (과목별 파일 여러 개 선택 가능)
        </p>
        <input
          type="file"
          accept=".json,application/json"
          multiple
          onChange={(e) => {
            void pick(e.target.files);
            e.target.value = '';
          }}
          className="block text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-mint-500 file:px-4 file:py-2 file:font-bold file:text-white hover:file:bg-mint-600"
        />
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
            <div className="flex justify-end">
              <Btn onClick={() => void upload()} disabled={busy || total === 0}>
                {busy ? '올리는 중...' : `올리기 (${total}개)`}
              </Btn>
            </div>
          </div>
        )}
      </Card>

      <Viewer />
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
