// 학생 관리: 목록·검색, 추가/일괄 등록/CSV 내보내기, PIN 초기화·단계 조정·삭제, (관리자) 교사 초대.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { backend } from '../../data';
import { AppError, type Student } from '../../data/types';
import { tierName, tierOf } from '../../engine/scoring';
import { useAuth } from '../../state/auth';
import { Btn, Card, Modal, Spinner } from '../../components/ui';
import { TierBadge } from '../../components/TierBadge';

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof AppError) {
    if (e.code === 'PERMISSION') return '권한이 없습니다.';
    if (e.code === 'NETWORK') return '인터넷 연결을 확인하세요.';
  }
  return fallback;
}

// 학번: 학년(1)·반(1)·번호(2). 0 은 쓰지 않는다.
const validId = (id: string) => /^[1-9][1-9](0[1-9]|[1-9]\d)$/.test(id);

const fmtDate = (ms: number) => {
  if (!ms) return '-';
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
const minutes = (sec: number) => Math.round((sec || 0) / 60);

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function buildCsv(rows: Student[]): string {
  const head = ['학번', '이름', '반', '번호', '자리단계', '기호단계', '영문단계', '계급', 'RP', '한글최고타수', '영문최고타수', '퀴즈점수', '연습일수', '연습시간(분)', '최근접속'];
  const lines = [head.map(csvCell).join(',')];
  for (const s of rows) {
    const last = s.lastLoginAt ? new Date(s.lastLoginAt) : null;
    const lastStr = last
      ? `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
      : '';
    lines.push(
      [
        s.id,
        s.name,
        s.classNo,
        s.number,
        s.position.ko,
        s.position.symbol,
        s.position.en,
        tierName(tierOf(s.rp ?? 0)),
        s.rp ?? 0,
        s.bestKo ?? 0,
        s.bestEn ?? 0,
        s.quizPoints ?? 0,
        s.days ?? 0,
        minutes(s.totalSeconds),
        lastStr,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  // UTF-8 BOM: 엑셀·구글 시트에서 한글이 깨지지 않게
  return '﻿' + lines.join('\r\n') + '\r\n';
}

interface ParsedRow {
  line: number;
  id: string;
  name: string;
  error?: string;
}
function parseBulk(text: string, existing: Set<string>): ParsedRow[] {
  const seen = new Set<string>();
  const out: ParsedRow[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(/[\t,\s]+/).filter(Boolean);
    const id = parts[0] ?? '';
    const name = parts.slice(1).join(' ').trim();
    let error: string | undefined;
    if (!validId(id)) error = '학번은 숫자 4자리(예: 1315)';
    else if (!name) error = '이름이 없음';
    else if (name.length > 10) error = '이름이 너무 김';
    else if (existing.has(id)) error = '이미 등록된 학번';
    else if (seen.has(id)) error = '붙여넣은 목록에서 학번 중복';
    if (!error) seen.add(id);
    out.push({ line: i + 1, id, name, error });
  });
  return out;
}

type Dlg =
  | { kind: 'add' }
  | { kind: 'bulk' }
  | { kind: 'del'; s: Student }
  | { kind: 'pin'; s: Student }
  | { kind: 'stage'; s: Student }
  | null;

const inputCls = 'w-full rounded-xl border border-mint-200 bg-white px-3 py-2 outline-none focus:border-mint-500 focus:ring-4 focus:ring-mint-100';

export default function Students() {
  const user = useAuth((s) => s.user);
  const isOwner = user?.role === 'teacher' && user.isOwner;
  const [list, setList] = useState<Student[] | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [cls, setCls] = useState<'all' | number>('all');
  const [q, setQ] = useState('');
  const [dlg, setDlg] = useState<Dlg>(null);

  const load = useCallback(async () => {
    try {
      setList(await backend.listStudents());
      setErr('');
    } catch (e) {
      setErr(errMsg(e, '학생 목록을 불러오지 못했습니다.'));
      setList((l) => l ?? []);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const classes = useMemo(() => [...new Set((list ?? []).map((s) => s.classNo))].sort((a, b) => a - b), [list]);
  const shown = useMemo(() => {
    const kw = q.trim();
    return (list ?? [])
      .filter((s) => (cls === 'all' || s.classNo === cls) && (!kw || s.name.includes(kw) || s.id.includes(kw)))
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [list, cls, q]);

  const done = (m: string) => {
    setMsg(m);
    setDlg(null);
    void load();
  };

  const exportCsv = () => {
    const blob = new Blob([buildCsv(shown)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `타자훈련소_학생기록_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!list) return <Spinner />;
  const existing = new Set(list.map((s) => s.id));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-2 text-2xl font-black">학생 관리</h1>
        <select
          className="rounded-xl border border-mint-200 bg-white px-3 py-2"
          value={cls}
          onChange={(e) => setCls(e.target.value === 'all' ? 'all' : Number(e.target.value))}
        >
          <option value="all">전체 반</option>
          {classes.map((c) => (
            <option key={c} value={c}>
              {c}반
            </option>
          ))}
        </select>
        <input className="w-44 rounded-xl border border-mint-200 bg-white px-3 py-2" placeholder="이름·학번 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-sm text-ink/60">{shown.length}명</span>
        <div className="ml-auto flex gap-2">
          <Btn small onClick={() => setDlg({ kind: 'add' })}>
            + 학생 추가
          </Btn>
          <Btn small variant="ghost" onClick={() => setDlg({ kind: 'bulk' })}>
            일괄 등록
          </Btn>
          <Btn small variant="ghost" onClick={exportCsv} disabled={shown.length === 0}>
            CSV 내보내기
          </Btn>
          <Btn small variant="ghost" onClick={() => void load()}>
            ↻
          </Btn>
        </div>
      </div>

      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-miss">{err}</p>}
      {msg && (
        <p className="flex items-center justify-between rounded-lg bg-mint-100 px-3 py-2 text-sm text-mint-700">
          {msg}
          <button className="font-bold" onClick={() => setMsg('')}>
            ✕
          </button>
        </p>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-mint-200 bg-mint-50 text-left text-ink/70">
              <th className="px-3 py-2">학번</th>
              <th>이름</th>
              <th>자리 단계</th>
              <th>영문</th>
              <th>계급</th>
              <th>최고 한글</th>
              <th>퀴즈</th>
              <th>연습 시간</th>
              <th>최근 접속</th>
              <th className="pr-3">관리</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={10} className="p-8 text-center text-ink/60">
                  {list.length === 0 ? '등록된 학생이 없습니다. [+ 학생 추가] 또는 [일괄 등록]으로 명단을 올리세요.' : '조건에 맞는 학생이 없습니다.'}
                </td>
              </tr>
            )}
            {shown.map((s) => (
              <tr key={s.id} className="border-b border-mint-100 last:border-0 hover:bg-mint-50/60">
                <td className="px-3 py-2 tabular-nums">{s.id}</td>
                <td className="font-bold">{s.name}</td>
                <td className="tabular-nums">{s.position.ko + s.position.symbol}/10</td>
                <td className="tabular-nums">{s.position.en}/7</td>
                <td>
                  <TierBadge tier={tierOf(s.rp ?? 0)} />
                </td>
                <td className="tabular-nums">{s.bestKo ?? 0}</td>
                <td className="tabular-nums">{s.quizPoints ?? 0}</td>
                <td className="tabular-nums">{minutes(s.totalSeconds)}분</td>
                <td className="tabular-nums">{fmtDate(s.lastLoginAt)}</td>
                <td className="whitespace-nowrap pr-3">
                  <div className="flex gap-1">
                    <Btn small variant="ghost" onClick={() => setDlg({ kind: 'pin', s })}>
                      PIN 초기화
                    </Btn>
                    <Btn small variant="ghost" onClick={() => setDlg({ kind: 'stage', s })}>
                      단계 조정
                    </Btn>
                    <Btn small variant="danger" onClick={() => setDlg({ kind: 'del', s })}>
                      삭제
                    </Btn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {isOwner && <Invites />}

      {dlg?.kind === 'add' && <AddDialog existing={existing} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.kind === 'bulk' && <BulkDialog existing={existing} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.kind === 'del' && <DeleteDialog s={dlg.s} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.kind === 'pin' && <PinDialog s={dlg.s} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.kind === 'stage' && <StageDialog s={dlg.s} onClose={() => setDlg(null)} onDone={done} />}
    </div>
  );
}

interface DlgProps {
  onClose: () => void;
  onDone: (m: string) => void;
}

function AddDialog({ existing, onClose, onDone }: DlgProps & { existing: Set<string> }) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const nm = name.trim();
    if (!validId(id)) return setErr('학번은 숫자 4자리입니다. (학년1·반1·번호2, 예: 1315)');
    if (!nm) return setErr('이름을 입력하세요.');
    if (existing.has(id)) return setErr('이미 등록된 학번입니다.');
    setBusy(true);
    try {
      await backend.addStudents([{ id, name: nm }]);
      onDone(`${nm} 학생을 추가했습니다.`);
    } catch (e) {
      setErr(errMsg(e, '추가하지 못했습니다. 잠시 후 다시 시도하세요.'));
      setBusy(false);
    }
  };
  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-xl font-black">학생 추가</h2>
      <form
        className="space-y-3"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="block text-sm font-bold">
          학번 (4자리)
          <input className={`${inputCls} mt-1`} inputMode="numeric" value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, '').slice(0, 4))} autoFocus />
        </label>
        <label className="block text-sm font-bold">
          이름
          <input className={`${inputCls} mt-1`} value={name} maxLength={10} onChange={(e) => setName(e.target.value)} />
        </label>
        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-miss">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Btn type="button" variant="ghost" onClick={onClose}>
            취소
          </Btn>
          <Btn type="submit" disabled={busy}>
            추가
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

function BulkDialog({ existing, onClose, onDone }: DlgProps & { existing: Set<string> }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => parseBulk(text, existing), [text, existing]);
  const good = rows.filter((r) => !r.error);
  const bad = rows.filter((r) => r.error);
  const submit = async () => {
    if (good.length === 0) return;
    setBusy(true);
    try {
      await backend.addStudents(good.map((r) => ({ id: r.id, name: r.name })));
      onDone(`${good.length}명을 등록했습니다.${bad.length ? ` (오류 ${bad.length}줄은 제외)` : ''}`);
    } catch (e) {
      setErr(errMsg(e, '등록하지 못했습니다. 잠시 후 다시 시도하세요.'));
      setBusy(false);
    }
  };
  return (
    <Modal onClose={onClose} wide>
      <h2 className="mb-1 text-xl font-black">일괄 등록</h2>
      <p className="mb-3 text-sm text-ink/60">엑셀에서 “학번 이름” 두 열을 복사해 붙여넣으세요. (탭·쉼표·공백으로 구분, 한 줄에 한 명)</p>
      <textarea
        className={`${inputCls} h-36 font-mono text-sm`}
        placeholder={'1301\t강지우\n1302\t김민수'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        autoFocus
      />
      {rows.length > 0 && (
        <div className="mt-3 max-h-48 overflow-y-auto rounded-xl border border-mint-200 text-sm">
          <table className="w-full">
            <tbody>
              {rows.map((r) => (
                <tr key={r.line} className={r.error ? 'bg-red-50' : ''}>
                  <td className="px-3 py-1 text-ink/50">{r.line}줄</td>
                  <td className="tabular-nums">{r.id}</td>
                  <td>{r.name}</td>
                  <td className={r.error ? 'text-miss' : 'text-mint-700'}>{r.error ?? '등록 가능'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-sm">
        등록 가능 <b>{good.length}</b>명 {bad.length > 0 && <span className="text-miss">· 오류 {bad.length}줄(등록되지 않음)</span>}
      </p>
      {err && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-miss">{err}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>
          취소
        </Btn>
        <Btn onClick={() => void submit()} disabled={busy || good.length === 0}>
          {good.length}명 등록
        </Btn>
      </div>
    </Modal>
  );
}

function DeleteDialog({ s, onClose, onDone }: DlgProps & { s: Student }) {
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = typed.trim() === s.name;
  const submit = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      await backend.deleteStudent(s.id);
      onDone(`${s.name} 학생을 삭제했습니다.`);
    } catch (e) {
      setErr(errMsg(e, '삭제하지 못했습니다. 잠시 후 다시 시도하세요.'));
      setBusy(false);
    }
  };
  return (
    <Modal onClose={onClose}>
      <h2 className="mb-2 text-xl font-black text-miss">학생 삭제</h2>
      <p className="mb-1">
        <b>
          {s.id} {s.name}
        </b>{' '}
        학생을 삭제합니다.
      </p>
      <p className="mb-3 text-sm text-miss">기록도 함께 삭제됩니다. 되돌릴 수 없습니다.</p>
      <form
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="block text-sm font-bold">
          확인을 위해 학생 이름을 다시 입력하세요
          <input className={`${inputCls} mt-1`} value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </label>
        {err && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-miss">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn type="button" variant="ghost" onClick={onClose}>
            취소
          </Btn>
          <Btn type="submit" variant="danger" disabled={!ok || busy}>
            삭제
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

function PinDialog({ s, onClose, onDone }: DlgProps & { s: Student }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await backend.resetPin(s.id);
      onDone(`${s.name} 학생의 PIN 을 초기화했습니다. 다음 접속 때 “처음 접속”으로 새 PIN 을 정합니다.`);
    } catch (e) {
      setErr(errMsg(e, 'PIN 을 초기화하지 못했습니다. 잠시 후 다시 시도하세요.'));
      setBusy(false);
    }
  };
  return (
    <Modal onClose={onClose}>
      <h2 className="mb-2 text-xl font-black">PIN 초기화</h2>
      <p className="mb-3">
        <b>
          {s.id} {s.name}
        </b>{' '}
        학생의 PIN 을 지울까요? 학생은 다음 접속 때 새 PIN 을 정하게 됩니다.
      </p>
      {err && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-miss">{err}</p>}
      <div className="flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>
          취소
        </Btn>
        <Btn onClick={() => void submit()} disabled={busy} autoFocus>
          초기화
        </Btn>
      </div>
    </Modal>
  );
}

function StageDialog({ s, onClose, onDone }: DlgProps & { s: Student }) {
  const [ko, setKo] = useState(s.position.ko);
  const [symbol, setSymbol] = useState(s.position.symbol);
  const [en, setEn] = useState(s.position.en);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await backend.teacherUpdateStudent(s.id, { position: { ko, symbol, en } });
      onDone(`${s.name} 학생의 단계를 바꿨습니다.`);
    } catch (e) {
      setErr(errMsg(e, '단계를 바꾸지 못했습니다. 잠시 후 다시 시도하세요.'));
      setBusy(false);
    }
  };
  const field = (label: string, max: number, v: number, set: (n: number) => void) => (
    <label className="block text-sm font-bold">
      {label} (통과한 단계 0~{max})
      <select className={`${inputCls} mt-1`} value={v} onChange={(e) => set(Number(e.target.value))}>
        {Array.from({ length: max + 1 }, (_, i) => (
          <option key={i} value={i}>
            {i}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <Modal onClose={onClose}>
      <h2 className="mb-1 text-xl font-black">단계 조정</h2>
      <p className="mb-3 text-sm text-ink/60">
        {s.id} {s.name} · 전학생·결석생 등을 위해 통과한 단계 수를 직접 바꿉니다.
      </p>
      <div className="space-y-3">
        {field('한글', 8, ko, setKo)}
        {field('기호', 2, symbol, setSymbol)}
        {field('영문', 7, en, setEn)}
      </div>
      {err && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-miss">{err}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>
          취소
        </Btn>
        <Btn onClick={() => void submit()} disabled={busy}>
          저장
        </Btn>
      </div>
    </Modal>
  );
}

function Invites() {
  const [emails, setEmails] = useState<string[] | null>(null);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try {
      setEmails(await backend.listTeacherInvites());
    } catch (e) {
      setErr(errMsg(e, '초대 목록을 불러오지 못했습니다.'));
      setEmails([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const em = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(em)) return setErr('이메일 주소를 확인하세요.');
    try {
      await backend.inviteTeacher(em);
      setEmail('');
      setErr('');
      void load();
    } catch (e) {
      setErr(errMsg(e, '초대하지 못했습니다.'));
    }
  };
  const remove = async (em: string) => {
    if (!window.confirm(`${em} 초대를 삭제할까요?`)) return;
    try {
      await backend.removeTeacherInvite(em);
      void load();
    } catch (e) {
      setErr(errMsg(e, '삭제하지 못했습니다.'));
    }
  };
  return (
    <Card>
      <h2 className="mb-1 font-bold">교사 초대 (관리자 전용)</h2>
      <p className="mb-3 text-sm text-ink/60">초대한 이메일로만 교사 계정을 만들 수 있습니다.</p>
      <form
        className="flex gap-2"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input className={inputCls} type="email" placeholder="선생님 이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Btn type="submit" className="whitespace-nowrap">
          초대 추가
        </Btn>
      </form>
      {err && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-miss">{err}</p>}
      <ul className="mt-3 space-y-1">
        {emails === null && <li className="text-sm text-ink/60">불러오는 중...</li>}
        {emails?.length === 0 && <li className="text-sm text-ink/60">초대한 선생님이 없습니다.</li>}
        {emails?.map((em) => (
          <li key={em} className="flex items-center justify-between rounded-lg bg-mint-50 px-3 py-1.5 text-sm">
            {em}
            <Btn small variant="ghost" onClick={() => void remove(em)}>
              삭제
            </Btn>
          </li>
        ))}
      </ul>
    </Card>
  );
}
