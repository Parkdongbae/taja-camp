// 라우터와 접근 제어.
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { initAuth, useAuth } from './state/auth';
import { loadContent } from './content';
import { Spinner } from './components/ui';
import AppShell from './components/AppShell';
import Login from './pages/Login';
import Home from './pages/Home';

const PositionMap = lazy(() => import('./pages/PositionMap'));
const PositionPractice = lazy(() => import('./pages/PositionPractice'));
const PositionTest = lazy(() => import('./pages/PositionTest'));
const WordPractice = lazy(() => import('./pages/WordPractice'));
const SentencePractice = lazy(() => import('./pages/SentencePractice'));
const PassagePractice = lazy(() => import('./pages/PassagePractice'));
const Exam = lazy(() => import('./pages/Exam'));
const TeacherExam = lazy(() => import('./pages/teacher/Exam'));
const Quiz = lazy(() => import('./pages/Quiz'));
const BattleLobby = lazy(() => import('./pages/BattleLobby'));
const BattleGame = lazy(() => import('./pages/BattleGame'));
const BattleSolo = lazy(() => import('./pages/BattleSolo'));
const Ranking = lazy(() => import('./pages/Ranking'));
const MyRecord = lazy(() => import('./pages/MyRecord'));
const TeacherLogin = lazy(() => import('./pages/teacher/TeacherLogin'));
const TeacherLayout = lazy(() => import('./pages/teacher/TeacherLayout'));
const Students = lazy(() => import('./pages/teacher/Students'));
const Progress = lazy(() => import('./pages/teacher/Progress'));
const Status = lazy(() => import('./pages/teacher/Status'));
const ClassSettings = lazy(() => import('./pages/teacher/ClassSettings'));
const ContentUpload = lazy(() => import('./pages/teacher/ContentUpload'));

function RequireStudent({ children }: { children: ReactNode }) {
  const { ready, user, student } = useAuth();
  if (!ready) return <Spinner />;
  if (!user || user.role !== 'student' || !student) return <Navigate to="/" replace />;
  return <AppShell>{children}</AppShell>;
}

function RequireTeacher({ children }: { children: ReactNode }) {
  const { ready, user } = useAuth();
  if (!ready) return <Spinner />;
  if (!user || user.role !== 'teacher') return <Navigate to="/teacher" replace />;
  return <>{children}</>;
}

export default function App() {
  const user = useAuth((s) => s.user);
  useEffect(() => initAuth(), []);
  useEffect(() => {
    if (user) void loadContent();
  }, [user]);

  const S = (el: ReactNode) => <RequireStudent>{el}</RequireStudent>;
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/home" element={S(<Home />)} />
        <Route path="/position" element={S(<PositionMap />)} />
        <Route path="/position/:stageId" element={S(<PositionPractice />)} />
        <Route path="/position/:stageId/test" element={S(<PositionTest />)} />
        <Route path="/word" element={S(<WordPractice />)} />
        <Route path="/sentence" element={S(<SentencePractice />)} />
        <Route path="/passage" element={S(<PassagePractice />)} />
        <Route path="/quiz" element={S(<Quiz />)} />
        <Route path="/exam" element={S(<Exam />)} />
        <Route path="/battle" element={S(<BattleLobby />)} />
        <Route path="/battle/solo" element={S(<BattleSolo />)} />
        <Route path="/battle/:roomId" element={S(<BattleGame />)} />
        <Route path="/ranking" element={S(<Ranking />)} />
        <Route path="/me" element={S(<MyRecord />)} />
        <Route path="/teacher" element={<TeacherLogin />} />
        <Route
          path="/teacher"
          element={
            <RequireTeacher>
              <TeacherLayout />
            </RequireTeacher>
          }
        >
          <Route path="students" element={<Students />} />
          <Route path="progress" element={<Progress />} />
          <Route path="status"element={<Status />} />
          <Route path="exam" element={<TeacherExam />} />
          <Route path="settings" element={<ClassSettings />} />
          <Route path="content" element={<ContentUpload />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
