// 학생 로그인: 학번(4자리) + 이름 + PIN(4자리). "처음 접속"이면 PIN 을 새로 정한다.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { backend } from '../data';
import { AppError } from '../data/types';
import { useAuth } from '../state/auth';
import { Btn } from '../components/ui';

export default function Login() {
  const nav = useNavigate();
  const { ready, user, student } = useAuth();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [first, setFirst] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!ready) return;
    if (user?.role === 'student' && student) nav('/home', { replace: true });
    if (user?.role === 'teacher') nav('/teacher/students', { replace: true });
  }, [ready, user, student, nav]);

  const digits = (v: string, n: number) => v.replace(/\D/g, '').slice(0, n);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    const nm = name.trim();
    if (id.length !== 4) return setErr('학번 4자리를 입력하세요. (예: 1315 = 1학년 3반 15번)');
    if (!nm) return setErr('이름을 입력하세요.');
    if (pin.length !== 4) return setErr('PIN 숫자 4자리를 입력하세요.');
    if (first && pin !== pin2) return setErr('PIN 이 서로 다릅니다. 다시 확인하세요.');
    setBusy(true);
    try {
      if (first) await backend.studentFirstLogin(id, nm, pin);
      else await backend.studentLogin(id, nm, pin);
    } catch (e2) {
      const code = e2 instanceof AppError ? e2.code : 'UNKNOWN';
      if (code === 'PIN_ALREADY_SET') {
        setErr('이미 PIN 을 만든 학번입니다. "처음 접속"을 끄고 입장하세요. PIN 을 잊었다면 선생님께 말씀드리세요.');
      } else if (code === 'LOGIN_FAILED' || code === 'NOT_REGISTERED' || code === 'PERMISSION') {
        setErr(
          first
            ? '학번과 이름이 명단과 다릅니다. 선생님께 등록을 요청하세요.'
            : '학번·이름·PIN 을 확인하세요. 처음이라면 아래 "처음 접속"을 선택하세요.',
        );
      } else if (code === 'NETWORK') {
        setErr('인터넷 연결을 확인하세요.');
      } else {
        setErr('입장하지 못했습니다. 잠시 후 다시 시도하세요.');
      }
      setBusy(false);
    }
  };

  const input =
    'w-full rounded-xl border border-mint-200 bg-white px-4 py-3 text-lg outline-none focus:border-mint-500 focus:ring-4 focus:ring-mint-100';

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-gradient-to-b from-mint-100 to-mint-50 p-6">
      <img src="/mascot-login.png" alt="" className="mb-2 h-44 w-44 rounded-full object-cover shadow-md" />
      <div className="mb-6 text-center">
        <div className="text-5xl font-black text-mint-600">⌨ 타자 훈련소</div>
        <p className="mt-3 text-ink/60">한글·영문 타자 연습 — 자리부터 배틀까지</p>
      </div>
      <form onSubmit={submit} className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-7 shadow-lg" autoComplete="off">
        <label className="block">
          <span className="mb-1 block text-sm font-bold">학번</span>
          <input
            className={input}
            inputMode="numeric"
            placeholder="예: 1315"
            value={id}
            onChange={(e) => setId(digits(e.target.value, 4))}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-bold">이름</span>
          <input className={input} placeholder="예: 김민수" value={name} onChange={(e) => setName(e.target.value)} maxLength={10} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-bold">PIN (숫자 4자리)</span>
          <input
            className={input}
            type="password"
            inputMode="numeric"
            placeholder="● ● ● ●"
            value={pin}
            onChange={(e) => setPin(digits(e.target.value, 4))}
          />
        </label>
        {first && (
          <label className="block">
            <span className="mb-1 block text-sm font-bold">PIN 한 번 더</span>
            <input
              className={input}
              type="password"
              inputMode="numeric"
              placeholder="● ● ● ●"
              value={pin2}
              onChange={(e) => setPin2(digits(e.target.value, 4))}
            />
          </label>
        )}
        <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm text-ink/70">
          <input type="checkbox" className="h-4 w-4 accent-mint-500" checked={first} onChange={(e) => setFirst(e.target.checked)} />
          처음 접속이에요 (PIN 새로 만들기)
        </label>
        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-miss">{err}</p>}
        <Btn type="submit" className="w-full py-3 text-lg" disabled={busy}>
          {busy ? '입장 중...' : '입 장'}
        </Btn>
      </form>
      <div className="mt-6 flex items-center gap-4 text-sm text-ink/50">
        {backend.mode === 'local' && (
          <span className="rounded-full bg-gold/20 px-3 py-1 text-ink/70">데모 모드 · 학번 1101~1106, 처음 접속으로 입장</span>
        )}
        <Link to="/teacher" className="hover:text-ink">
          선생님 모드 →
        </Link>
      </div>
    </div>
  );
}
