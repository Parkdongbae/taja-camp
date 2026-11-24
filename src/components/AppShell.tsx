// 학생 화면 공통 틀: 상단 바(이름·계급·자리 단계·오늘의 훈련) + 본문.
// 접속 현황(presence)도 여기서 갱신한다.
import { useEffect, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { backend } from '../data';
import { useAuth } from '../state/auth';
import { tierOf, TIERS, todayString } from '../engine/scoring';
import { TierBadge } from './TierBadge';

const DOING: [string, string][] = [
  ['/position', '자리연습'],
  ['/word', '낱말연습'],
  ['/sentence', '단문연습'],
  ['/passage', '장문연습'],
  ['/exam', '수행평가'],
  ['/battle', '배틀'],
  ['/ranking', '순위 보기'],
  ['/me', '내 기록'],
  ['/names', '학생이름 외우기'],
  ['/home', '홈'],
];

export const POSITION_TOTAL = 10; // 한글 8 + 기호 2

export default function AppShell({ children }: { children: ReactNode }) {
  const { student, settings } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();

  const tier = student ? tierOf(student.rp) : 0;
  const doing = DOING.find(([p]) => loc.pathname.startsWith(p))?.[1] ?? '홈';

  useEffect(() => {
    if (!student) return;
    backend.setPresence({
      studentId: student.id,
      name: student.name,
      classNo: student.classNo,
      tier,
      doing,
      at: Date.now(),
    });
  }, [student?.id, student?.name, tier, doing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!student) return null;
  const passed = student.position.ko + student.position.symbol;
  const goalSec = settings.dailyGoalMinutes * 60;
  const todaySec = student.lastDay === todayString() ? student.todaySeconds : 0;
  const ratio = Math.min(1, todaySec / goalSec);
  const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  const logout = async () => {
    backend.setPresence(null);
    await backend.logout();
    nav('/');
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-4 bg-white px-5 shadow-sm">
        <Link to="/home" className="text-lg font-black text-mint-600">
          ⌨ 타자 훈련소
        </Link>
        <div className="ml-2 flex items-center gap-2" title={`오늘의 훈련 ${mmss(todaySec)} / ${mmss(goalSec)}`}>
          <span className="text-xs text-ink/60">오늘의 훈련</span>
          <div className="h-2 w-32 overflow-hidden rounded-full bg-mint-100">
            <div className={`h-full rounded-full ${ratio >= 1 ? 'bg-gold' : 'bg-mint-500'}`} style={{ width: `${ratio * 100}%` }} />
          </div>
          <span className="text-xs tabular-nums text-ink/60">
            {ratio >= 1 ? '완료!' : `${mmss(todaySec)} / ${mmss(goalSec)}`}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="font-bold">
            {student.teacher ? '선생님' : `${student.classNo}반`} {student.name}
          </span>
          <TierBadge tier={tier} />
          <span className="rounded-full bg-mint-100 px-2.5 py-0.5 text-xs font-bold text-mint-700" title="자리연습 진행 단계(한글 8 + 기호 2)">
            자리 {passed}/{POSITION_TOTAL}
          </span>
          <button onClick={logout} className="text-xs text-ink/50 hover:text-ink">
            로그아웃
          </button>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}

export { TIERS };
