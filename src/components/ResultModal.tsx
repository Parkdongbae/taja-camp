// 연습 결과 창(docs/02 4.8). 낱말·단문·장문 화면이 공용으로 쓴다.
//
//   <ResultModal title snapshot result lang onRetry onHome extra? note? />
//     title     "낱말연습 완료!" 같은 제목
//     snapshot  meter.snapshot() (타수·정확도·오타·시간·약점 글쇠)
//     result    finishSession 결과. 저장 중이면 null (경험치 칸이 "저장 중…")
//     lang      약점 글쇠를 어느 언어 글자로 보일지
//     onRetry   [다시 Enter],  onHome  [홈 Esc]
//     extra     버튼 줄에 끼울 선택 버튼(예: 약점 글쇠 연습),  note  제목 아래 안내 문구(예: 장문 80% 미만)
//   Enter = 다시, Esc = 홈. 뜨자마자 누르는 Enter 로 바로 넘어가지 않게 0.4초 뒤부터 받는다.
import { useEffect, useState, type ReactNode } from 'react';
import { BADGES, charToTarget, FINGER_LABEL, type MeterSnapshot } from '../engine';
import type { Lang } from '../data/types';
import type { FinishResult } from '../state/record';
import { Btn, Kbd, Modal } from './ui';
import { fmtTime, useWindowKey, weakList } from './PracticeParts';
import { playFanfare } from './sound';

function coaching(snap: MeterSnapshot, result: FinishResult | null, lang: Lang): string {
  if (snap.accuracy < 90) return '속도를 조금 늦추고 정확하게 쳐 볼까요? 정확도 90%부터 기록으로 인정돼요.';
  if (result?.isBest) {
    const gain = result.prevBest > 0 ? ` 지난 최고보다 ${snap.kpm - result.prevBest}타 빨라졌어요.` : '';
    return `최고 기록!${gain}`;
  }
  if (snap.typos === 0) return '오타 0개! 완벽해요.';
  const top = weakList(snap.missKeys, lang, 1)[0];
  if (top && top[1] >= 3) {
    const ch = top[0];
    const t = charToTarget(ch, lang);
    const finger = t ? FINGER_LABEL[t.finger] : '';
    return finger ? `「${ch}」은(는) ${finger} 손가락으로 쳐요. 약점 글쇠 연습을 해 보세요.` : `「${ch}」을(를) 자주 틀렸어요. 천천히 다시 쳐 봐요.`;
  }
  return '꾸준히 하면 반드시 늘어요. 한 번 더 도전해 볼까요?';
}

export default function ResultModal({
  title,
  snapshot,
  result,
  lang,
  onRetry,
  onHome,
  extra,
  note,
}: {
  title: string;
  snapshot: MeterSnapshot;
  result: FinishResult | null;
  lang: Lang;
  onRetry: () => void;
  onHome: () => void;
  extra?: ReactNode;
  note?: ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 400);
    return () => clearTimeout(t);
  }, []);
  useWindowKey((e) => {
    if (e.key === 'Enter' && armed && !e.repeat) {
      e.preventDefault();
      onRetry();
    }
  });
  // 새 기록·배지·목표 달성이면 팡파르 (결과가 도착했을 때 한 번)
  const celebrate = !!result && (result.isBest || result.newBadges.length > 0 || result.goalJustDone || result.promoted);
  useEffect(() => {
    if (celebrate) playFanfare();
  }, [celebrate]);

  const diff = result && result.prevBest > 0 ? snapshot.kpm - result.prevBest : null;
  const weak = weakList(snapshot.missKeys, lang, 3);
  const badges = (result?.newBadges ?? []).map((id) => BADGES.find((b) => b.id === id)).filter((b): b is (typeof BADGES)[number] => !!b);

  return (
    <Modal onClose={onHome} wide>
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-3xl font-black text-mint-700">{title}</h2>
        <div className="flex flex-wrap justify-end gap-2">
          {result?.isBest && <Chip tone="gold">🏅 최고 기록 갱신</Chip>}
          {result?.goalJustDone && <Chip tone="mint">✅ 오늘의 훈련 완료</Chip>}
          {result?.promoted && <Chip tone="mint">🎖️ 자리 단계 상승</Chip>}
        </div>
      </div>
      {note ? <div className="mt-2 rounded-lg bg-gold/15 px-3 py-2 text-sm font-medium">{note}</div> : null}

      <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 text-lg">
        <Item label="타수">
          <b className="text-2xl tabular-nums">{snapshot.kpm}</b>
          <span className="text-sm text-ink/60"> 타/분</span>
          {diff !== null && diff !== 0 && (
            <span className={`ml-2 text-sm font-bold ${diff > 0 ? 'text-mint-600' : 'text-miss'}`}>
              {diff > 0 ? '▲' : '▼'}
              {Math.abs(diff)}
            </span>
          )}
        </Item>
        <Item label="정확도">
          <b className="text-2xl tabular-nums">{snapshot.accuracy.toFixed(1)}</b>
          <span className="text-sm text-ink/60"> %</span>
        </Item>
        <Item label="오타">
          <b className="text-2xl tabular-nums">{snapshot.typos}</b>
          <span className="text-sm text-ink/60"> 개</span>
        </Item>
        <Item label="시간">
          <b className="text-2xl tabular-nums">{fmtTime(snapshot.seconds)}</b>
        </Item>
      </div>

      <div className="mt-4 flex items-center gap-3 border-t border-mint-200 pt-4">
        <span className="text-sm text-ink/60">약점 글쇠</span>
        {weak.length ? (
          weak.map(([ch, c]) => (
            <span key={ch} className="rounded-lg bg-miss/10 px-2.5 py-1 text-lg font-bold text-miss">
              {ch}
              <span className="ml-1 text-xs font-normal">({c})</span>
            </span>
          ))
        ) : (
          <span className="text-ink/50">없어요!</span>
        )}
        <span className="ml-auto text-lg font-bold">
          {result ? (
            <>
              ⭐ 경험치 <span className="text-gold">+{result.xpGain}</span>
            </>
          ) : (
            <span className="text-sm font-normal text-ink/50">저장 중…</span>
          )}
        </span>
      </div>

      {badges.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {badges.map((b) => (
            <div key={b.id} className="anim-pop flex items-center gap-2 rounded-xl bg-gold/15 px-3 py-2">
              <span className="text-2xl">{b.icon}</span>
              <span>
                <span className="block text-xs text-ink/60">새 배지</span>
                <span className="font-bold">{b.name}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 rounded-xl bg-mint-50 px-4 py-3 text-sm font-medium text-ink/80">💬 {coaching(snapshot, result, lang)}</p>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Btn onClick={onRetry} autoFocus>
          다시 <Kbd>Enter</Kbd>
        </Btn>
        {extra}
        <Btn variant="ghost" onClick={onHome}>
          홈 <Kbd>Esc</Kbd>
        </Btn>
      </div>
    </Modal>
  );
}

function Chip({ children, tone }: { children: ReactNode; tone: 'gold' | 'mint' }) {
  return (
    <span className={`rounded-full px-3 py-1 text-sm font-bold ${tone === 'gold' ? 'bg-gold/20 text-ink' : 'bg-mint-100 text-mint-700'}`}>
      {children}
    </span>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-14 text-sm text-ink/60">{label}</span>
      <span>{children}</span>
    </div>
  );
}
