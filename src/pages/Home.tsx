// 홈 대시보드: 이어서 하기, 연습 메뉴, 배틀·순위·내 기록, 키보드 종류 설정.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { backend } from '../data';
import { KEYBOARD_LABEL, type KeyboardKind } from '../data/types';
import { useAuth } from '../state/auth';
import { usePrefs } from '../state/prefs';
import { useContent } from '../content';
import { getStage, isBattleUnlocked, nextStageId } from '../engine/stages';
import { levelOf, tierProgress, todayString } from '../engine/scoring';
import { TierBadge } from '../components/TierBadge';
import { Card, Kbd } from '../components/ui';
import { POSITION_TOTAL } from '../components/AppShell';
import { GradeBadge } from '../components/ExamGradeBadge';

export default function Home() {
  const nav = useNavigate();
  const { student, settings } = useAuth();
  const prefs = usePrefs();
  const content = useContent();
  const [online, setOnline] = useState(0);

  useEffect(() => backend.watchPresence((list) => setOnline(list.length)), []);

  // 다음에 할 일: 자리연습이 남았으면 그 단계, 아니면 낱말연습
  const nextKo = student ? (nextStageId(student.position, 'ko') ?? nextStageId(student.position, 'symbol')) : null;
  const continueTo = nextKo ? `/position/${nextKo}` : '/word';
  const continueLabel = nextKo ? `자리연습 「${getStage(nextKo)?.name ?? ''}」` : '낱말연습';

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) {
        nav(continueTo);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [continueTo, nav]);

  if (!student) return null;
  const passed = student.position.ko + student.position.symbol;
  const unlocked = !!settings.battleOpenAll || isBattleUnlocked(student.position); // 임시 공개 포함
  const tp = tierProgress(student.rp);
  const goalDone = student.lastDay === todayString() && student.todaySeconds >= settings.dailyGoalMinutes * 60;
  const level = levelOf(student.xp);

  const menu = [
    { to: '/position', title: '자리연습', desc: `${passed} / ${POSITION_TOTAL} 단계`, icon: '🎯' },
    { to: '/word', title: '낱말연습', desc: '교과서 낱말과 뜻', icon: '🔤' },
    { to: '/sentence', title: '단문연습', desc: student.bestKo ? `최고 ${student.bestKo}타` : '한 문장씩', icon: '✏️' },
    { to: '/passage', title: '장문연습', desc: '긴 글 이어 치기', icon: '📖' },
    { to: '/quiz', title: '뜻 맞추기 퀴즈', desc: `퀴즈 점수 ${student.quizPoints ?? 0}점`, icon: '💡' },
  ];

  const examOpen = !!settings.exam?.open;
  const myExam = (['ko', 'en'] as const).flatMap((l) => (student.exam?.[l] ? [{ lang: l, r: student.exam[l]! }] : []));

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      {/* 수행평가 */}
      {examOpen ? (
        <Link
          to="/exam"
          className="flex items-center justify-between rounded-2xl bg-gold px-7 py-4 text-ink shadow-md ring-4 ring-gold/30 transition hover:brightness-105"
        >
          <div>
            <div className="text-xl font-black">📝 수행평가 진행 중 — 응시하러 가기</div>
            <div className="text-sm opacity-80">{settings.exam.title}</div>
          </div>
          <div className="flex items-center gap-3 text-sm font-bold">
            {myExam.map(({ lang, r }) => (
              <span key={lang} className="flex items-center gap-1.5">
                {lang === 'ko' ? '한글' : '영어'} <GradeBadge grade={r.grade} size={30} />
              </span>
            ))}
          </div>
        </Link>
      ) : (
        myExam.length > 0 && (
          <Card className="flex items-center gap-4">
            <span className="font-bold">📝 수행평가 기록</span>
            {myExam.map(({ lang, r }) => (
              <span key={lang} className="flex items-center gap-1.5 text-sm">
                {lang === 'ko' ? '한글' : '영어'} <GradeBadge grade={r.grade} size={28} /> <span className="tabular-nums text-ink/60">{r.kpm}타</span>
              </span>
            ))}
          </Card>
        )
      )}

      {/* 이어서 하기 */}
      <Link
        to={continueTo}
        className="flex items-center justify-between rounded-2xl bg-mint-500 px-7 py-5 text-white shadow-md transition hover:bg-mint-600"
      >
        <div>
          <div className="text-sm opacity-80">{goalDone ? '오늘의 훈련 완료! 더 해 볼까요?' : '이어서 하기'}</div>
          <div className="text-2xl font-black">▶ {continueLabel}</div>
        </div>
        <div className="flex items-center gap-2 text-sm opacity-90">
          <Kbd>Enter</Kbd>
        </div>
      </Link>

      {/* 연습 메뉴 */}
      <div className="grid grid-cols-5 gap-4">
        {menu.map((m) => (
          <Link key={m.to} to={m.to} className="rounded-2xl bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="text-3xl">{m.icon}</div>
            <div className="mt-2 text-xl font-black">{m.title}</div>
            <div className="mt-1 text-sm text-ink/60">{m.desc}</div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* 배틀 */}
        {unlocked && settings.battleEnabled ? (
          <Link to="/battle" className="rounded-2xl bg-ink p-5 text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="text-3xl">⚔️</div>
            <div className="mt-2 text-xl font-black">배틀 모드</div>
            <div className="mt-1 text-sm opacity-70">지금 접속 {online}명 · {tp.name} 방</div>
          </Link>
        ) : (
          <div className="rounded-2xl bg-ink/10 p-5 text-ink/60">
            <div className="text-3xl">🔒</div>
            <div className="mt-2 text-xl font-black">배틀 모드</div>
            <div className="mt-1 text-sm">
              {unlocked ? '선생님이 배틀을 잠시 꺼 두었어요.' : `자리연습 ${POSITION_TOTAL - passed}단계를 더 통과하면 열려요.`}
            </div>
          </div>
        )}
        <Link to="/ranking" className="rounded-2xl bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <div className="text-3xl">🏆</div>
          <div className="mt-2 text-xl font-black">전체 순위</div>
          <div className="mt-1 text-sm text-ink/60">배틀 · 타수 · 성실 순위</div>
        </Link>
        <Link to="/me" className="rounded-2xl bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <div className="text-3xl">📈</div>
          <div className="mt-2 text-xl font-black">내 기록</div>
          <div className="mt-1 text-sm text-ink/60">
            레벨 {level} · 연속 {student.streak}회 · 배지 {student.badges.length}개
          </div>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* 계급 */}
        <Card>
          <div className="flex items-center justify-between">
            <div className="font-bold">내 계급</div>
            <TierBadge tier={tp.tier} large />
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-mint-100">
            <div className="h-full rounded-full bg-gold" style={{ width: `${tp.ratio * 100}%` }} />
          </div>
          <div className="mt-1.5 text-xs text-ink/60">
            {tp.next === null ? `RP ${student.rp} · 최고 계급입니다!` : `RP ${student.rp} / ${tp.next} · 다음 계급까지 ${tp.next - student.rp}`}
          </div>
        </Card>

        {/* 설정 */}
        <Card>
          <div className="font-bold">내 키보드</div>
          <div className="mt-3 flex gap-2">
            {(Object.keys(KEYBOARD_LABEL) as KeyboardKind[]).map((k) => (
              <button
                key={k}
                onClick={() => prefs.set({ keyboardKind: k })}
                className={`flex-1 rounded-xl border-2 px-2 py-2 text-sm font-bold transition ${
                  prefs.keyboardKind === k ? 'border-mint-500 bg-mint-50 text-mint-700' : 'border-mint-100 text-ink/60 hover:border-mint-300'
                }`}
              >
                {KEYBOARD_LABEL[k]}
              </button>
            ))}
          </div>
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-ink/70">
            <input
              type="checkbox"
              className="h-4 w-4 accent-mint-500"
              checked={prefs.sound && settings.soundAllowed}
              disabled={!settings.soundAllowed}
              onChange={(e) => prefs.set({ sound: e.target.checked })}
            />
            소리 켜기 · 타건음과 배틀 효과음 {settings.soundAllowed ? '(이어폰을 쓸 때만)' : '(선생님이 꺼 두었어요)'}
          </label>
        </Card>
      </div>

      {!content.hasTextbook && content.loaded && (
        <p className="text-center text-xs text-ink/40">지금은 기초 낱말만 나옵니다. 선생님이 교과 콘텐츠를 올리면 과목별 낱말이 추가됩니다.</p>
      )}
    </div>
  );
}
