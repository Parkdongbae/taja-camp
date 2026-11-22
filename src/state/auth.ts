// 로그인 상태·내 학생 문서·수업 설정을 한곳에서 구독한다.
//   useAuth(): { ready, user, student, settings }
//   initAuth(): 앱 시작 시 1회 호출
import { create } from 'zustand';
import { backend } from '../data';
import { DEFAULT_EXAM, DEFAULT_SETTINGS, type AuthUser, type Settings, type Student } from '../data/types';

interface AuthState {
  ready: boolean; // 최초 인증 확인이 끝났는가
  user: AuthUser | null;
  student: Student | null; // 학생으로 로그인한 경우 내 문서(실시간)
  settings: Settings;
}

export const useAuth = create<AuthState>(() => ({
  ready: false,
  user: null,
  student: null,
  settings: DEFAULT_SETTINGS,
}));

let started = false;
export function initAuth() {
  if (started) return;
  started = true;
  let unsubStudent: (() => void) | null = null;
  let unsubSettings: (() => void) | null = null;

  backend.onAuth((user) => {
    unsubStudent?.();
    unsubStudent = null;
    unsubSettings?.();
    unsubSettings = null;

    if (!user) {
      useAuth.setState({ ready: true, user: null, student: null });
      return;
    }
    unsubSettings = backend.watchSettings((s) => useAuth.setState({ settings: { ...DEFAULT_SETTINGS, ...s, exam: { ...DEFAULT_EXAM, ...s?.exam } } }));
    if (user.role === 'student') {
      useAuth.setState({ user });
      unsubStudent = backend.watchStudent(user.studentId, (student) => {
        if (!student) {
          // 교사가 학생을 삭제한 경우
          useAuth.setState({ ready: true, user: null, student: null });
          void backend.logout();
          return;
        }
        useAuth.setState({ ready: true, student });
      });
    } else {
      useAuth.setState({ ready: true, user, student: null });
    }
  });
}
