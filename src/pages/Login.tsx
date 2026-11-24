// 로그인: [학생] 학번(4자리) + 이름 + PIN(4자리), "처음 접속"이면 PIN 을 새로 정한다.
//         [선생님] 성함 + PIN. "처음이에요"로 가입 신청(관리자 승인 뒤 입장), PIN 초기화 뒤 재설정도 가능.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { backend } from '../data';
import { AppError } from '../data/types';
import { useAuth } from '../state/auth';
import { memberIdOf, normalizeMemberName } from '../engine/member';
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
  const [tab, setTab] = useState<'student' | 'teacher'>('student');
  const [signup, setSignup] = useState(false);
  const [repin, setRepin] = useState(false);
  const [okMsg, setOkMsg] = useState('');

  useEffect(() => {
    if (!ready) return;
    if (user?.role === 'student' && student) nav('/home', { replace: true });
    if (user?.role === 'teacher') nav('/teacher/students', { replace: true });
  }, [ready, user, student, nav]);

  const digits = (v: string, n: number) => v.replace(/\D/g, '').slice(0, n);

  const switchTab = (t: 'student' | 'teacher') => {
    setTab(t);
    setErr('');
    setOkMsg('');
    setPin('');
    setPin2('');
  };

  const submitTeacher = async () => {
    const nm = normalizeMemberName(name);
    if (!nm) return setErr('성함을 입력하세요.');
    if (pin.length !== 4) return setErr('PIN 숫자 4자리를 입력하세요.');
    if ((signup || repin) && pin !== pin2) return setErr('PIN 이 서로 다릅니다. 다시 확인하세요.');
    setBusy(true);
    try {
      if (signup) {
        await backend.memberSignup(nm, pin);
        setSignup(false);
        setPin('');
        setPin2('');
        setOkMsg('가입 신청이 접수되었습니다. 관리자 선생님이 승인하면 성함과 PIN 으로 입장할 수 있습니다.');
        setBusy(false);
        return;
      }
      if (repin) await backend.studentFirstLogin(memberIdOf(nm), nm, pin);
      else await backend.memberLogin(nm, pin);
    } catch (e2) {
      const code = e2 instanceof AppError ? e2.code : 'UNKNOWN';
      if (code === 'NAME_TAKEN') {
        setErr('이미 같은 성함으로 신청·등록되어 있습니다. 관리자 선생님께 확인하거나 성함 뒤에 구분 글자를 붙여 신청하세요(예: 김민수B).');
      } else if (code === 'PIN_ALREADY_SET') {
        setErr('이미 PIN 을 만든 성함입니다. "PIN 을 다시 정해요"를 끄고 입장하세요. PIN 을 잊었다면 관리자 선생님께 초기화를 요청하세요.');
      } else if (code === 'LOGIN_FAILED' || code === 'NOT_REGISTERED' || code === 'PERMISSION') {
        setErr('성함·PIN 을 확인하세요. 가입 신청 뒤 관리자 선생님의 승인이 필요합니다.');
      } else if (code === 'NETWORK') {
        setErr('인터넷 연결을 확인하세요.');
      } else {
        setErr('입장하지 못했습니다. 잠시 후 다시 시도하세요.');
      }
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setOkMsg('');
    if (tab === 'teacher') return submitTeacher();
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
        <div
          role="tablist"
          className="flex gap-1 rounded-xl bg-mint-50 p-1"
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              switchTab(tab === 'student' ? 'teacher' : 'student');
            }
          }}
        >
          {(['student', 'teacher'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => switchTab(t)}
              className={`flex-1 rounded-lg py-2 text-sm font-bold ${tab === t ? 'bg-white text-mint-700 shadow' : 'text-ink/50 hover:text-ink'}`}
            >
              {t === 'student' ? '학생' : '선생님'}
            </button>
          ))}
        </div>
        {tab === 'student' && (
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
        )}
        <label className="block">
          <span className="mb-1 block text-sm font-bold">{tab === 'teacher' ? '성함' : '이름'}</span>
          <input
            className={input}
            placeholder={tab === 'teacher' ? '예: 김선생' : '예: 김민수'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={10}
            autoFocus={tab === 'teacher'}
          />
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
        {((tab === 'student' && first) || (tab === 'teacher' && (signup || repin))) && (
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
        {tab === 'student' ? (
          <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm text-ink/70">
            <input type="checkbox" className="h-4 w-4 accent-mint-500" checked={first} onChange={(e) => setFirst(e.target.checked)} />
            처음 접속이에요 (PIN 새로 만들기)
          </label>
        ) : (
          <>
            <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm text-ink/70">
              <input
                type="checkbox"
                className="h-4 w-4 accent-mint-500"
                checked={signup}
                onChange={(e) => {
                  setSignup(e.target.checked);
                  if (e.target.checked) setRepin(false);
                }}
              />
              처음이에요 (가입 신청)
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink/50">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-mint-500"
                checked={repin}
                onChange={(e) => {
                  setRepin(e.target.checked);
                  if (e.target.checked) setSignup(false);
                }}
              />
              PIN 을 다시 정해요(초기화한 경우)
            </label>
          </>
        )}
        {okMsg && <p className="rounded-lg bg-mint-100 px-3 py-2 text-sm text-mint-700">{okMsg}</p>}
        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-miss">{err}</p>}
        <Btn type="submit" className="w-full py-3 text-lg" disabled={busy}>
          {busy ? (tab === 'teacher' && signup ? '신청 중...' : '입장 중...') : tab === 'teacher' && signup ? '가입 신청' : '입 장'}
        </Btn>
      </form>
      <div className="mt-6 flex items-center gap-4 text-sm text-ink/50">
        {backend.mode === 'local' && (
          <span className="rounded-full bg-gold/20 px-3 py-1 text-ink/70">데모 모드 · 학번 1101~1106, 처음 접속으로 입장</span>
        )}
        <Link to="/teacher" className="hover:text-ink">
          선생님 모드(관리) →
        </Link>
      </div>
    </div>
  );
}
