// 선생님 화면 틀: 상단 탭 + 로그아웃 + <Outlet />. /teacher 로 들어오면 students 로 보낸다.
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { backend } from '../../data';
import { useAuth } from '../../state/auth';

const TABS = [
  { to: '/teacher/students', label: '학생 관리' },
  { to: '/teacher/progress', label: '진도 현황' },
  { to: '/teacher/exam', label: '수행평가' },
  { to: '/teacher/status', label: '학습 현황' },
  { to: '/teacher/settings', label: '수업 설정' },
  { to: '/teacher/content', label: '콘텐츠' },
];

export default function TeacherLayout() {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const user = useAuth((s) => s.user);

  if (pathname.replace(/\/+$/, '') === '/teacher') return <Navigate to="/teacher/students" replace />;

  const logout = async () => {
    try {
      await backend.logout();
    } catch {
      // 실패해도 로그인 화면으로 이동
    }
    nav('/teacher', { replace: true });
  };

  return (
    <div className="flex h-full min-h-screen flex-col bg-mint-50">
      <header className="flex flex-wrap items-center gap-4 border-b border-mint-200 bg-white px-6 py-3">
        <span className="text-lg font-black text-mint-600">🧑‍🏫 선생님 모드</span>
        <nav className="flex gap-1">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                `rounded-xl px-4 py-2 font-bold transition ${isActive ? 'bg-mint-500 text-white' : 'text-ink hover:bg-mint-100'}`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm text-ink/60">
          {user?.role === 'teacher' && (
            <span>
              {user.email}
              {user.isOwner ? ' (관리자)' : ''}
            </span>
          )}
          <button onClick={() => void logout()} className="rounded-xl border border-mint-200 px-3 py-1.5 font-bold text-ink hover:bg-mint-50">
            로그아웃
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
