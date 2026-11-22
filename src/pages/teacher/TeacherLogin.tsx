// 선생님 로그인/가입. 이미 교사로 로그인돼 있으면 /teacher/students 로 보낸다.
import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { backend } from '../../data';
import { AppError } from '../../data/types';
import { useAuth } from '../../state/auth';
import { Btn, Spinner } from '../../components/ui';

export default function TeacherLogin() {
  const { ready, user } = useAuth();
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!ready) return <Spinner />;
  if (user?.role === 'teacher') return <Navigate to="/teacher/students" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    const em = email.trim();
    if (!em.includes('@')) return setErr('이메일 주소를 입력하세요.');
    if (pw.length < 6) return setErr('비밀번호는 6자 이상이어야 합니다.');
    setBusy(true);
    try {
      if (signup) await backend.teacherSignup(em, pw);
      else await backend.teacherLogin(em, pw);
      // 로그인 상태가 바뀌면 위의 Navigate 가 이동시킨다
    } catch (e2) {
      const code = e2 instanceof AppError ? e2.code : 'UNKNOWN';
      if (code === 'NOT_TEACHER') setErr('등록된 교사 계정이 아닙니다. 관리자 선생님께 초대를 요청하세요.');
      else if (code === 'PERMISSION') setErr('권한이 없습니다.');
      else if (code === 'NETWORK') setErr('인터넷 연결을 확인하세요.');
      else if (code === 'LOGIN_FAILED') setErr('이메일 또는 비밀번호가 맞지 않습니다.');
      else setErr(signup ? '계정을 만들지 못했습니다. 이미 가입한 이메일이면 로그인하세요.' : '로그인하지 못했습니다. 이메일과 비밀번호를 확인하세요.');
    } finally {
      setBusy(false);
    }
  };

  const input =
    'w-full rounded-xl border border-mint-200 bg-white px-4 py-3 text-lg outline-none focus:border-mint-500 focus:ring-4 focus:ring-mint-100';

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-gradient-to-b from-mint-100 to-mint-50 p-6">
      <div className="mb-6 text-center">
        <div className="text-4xl font-black text-mint-600">🧑‍🏫 선생님 모드</div>
        <p className="mt-2 text-ink/60">{signup ? '교사 계정 만들기' : '선생님 로그인'}</p>
      </div>
      <form onSubmit={submit} className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-7 shadow-lg" autoComplete="off">
        <label className="block">
          <span className="mb-1 block text-sm font-bold">이메일</span>
          <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-bold">비밀번호</span>
          <input
            className={input}
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete={signup ? 'new-password' : 'current-password'}
          />
        </label>
        {signup && <p className="text-sm text-ink/60">처음 가입하는 선생님이 관리자가 되고, 이후에는 관리자가 초대한 이메일만 가입할 수 있어요.</p>}
        {backend.mode === 'local' && (
          <p className="rounded-lg bg-gold/20 px-3 py-2 text-sm text-ink/70">데모 모드: 아무 이메일과 6자 이상 비밀번호로 가입</p>
        )}
        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-miss">{err}</p>}
        <Btn type="submit" className="w-full py-3 text-lg" disabled={busy}>
          {busy ? '확인 중...' : signup ? '교사 계정 만들기' : '로그인'}
        </Btn>
        <button
          type="button"
          className="w-full text-sm font-bold text-mint-700 hover:underline"
          onClick={() => {
            setSignup(!signup);
            setErr('');
          }}
        >
          {signup ? '이미 계정이 있어요 → 로그인' : '처음이면 교사 계정 만들기'}
        </button>
      </form>
      <Link to="/" className="mt-6 text-sm text-ink/50 hover:underline">
        ← 학생 로그인으로
      </Link>
    </div>
  );
}
