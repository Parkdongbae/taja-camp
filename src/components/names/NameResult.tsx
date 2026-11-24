// 학생이름 외우기 결과 화면. <NameResult result students onAgain onRetryConfused onBack />
//   맞춘 수·놓친 횟수·오답 수·걸린 시간 + "헷갈린 학생" 사진·이름 격자.
//   Enter = 한 번 더(같은 설정), Esc = 준비 화면. 헷갈린 학생이 있으면 [헷갈린 학생만 다시].
//   사진 object URL 은 이 화면이 떠 있는 동안만 만든다.
import { useEffect, useMemo, useState } from 'react';
import type { RosterStudent } from '../../roster/types';
import { classLabel, studentKey } from '../../roster/game';
import { fmtTime, useWindowKey } from '../PracticeParts';
import { Btn, Card, Kbd, Stat } from '../ui';
import type { NameGameResult } from './NamePlay';

export default function NameResult({
  result,
  students,
  onAgain,
  onRetryConfused,
  onBack,
}: {
  result: NameGameResult;
  students: RosterStudent[];
  onAgain: () => void;
  onRetryConfused: (list: RosterStudent[]) => void;
  onBack: () => void;
}) {
  const confused = useMemo(() => {
    const keys = new Set(result.confused);
    return students.filter((s) => keys.has(studentKey(s)));
  }, [result.confused, students]);

  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const list = confused.map((s) => (s.photo ? URL.createObjectURL(s.photo) : ''));
    setUrls(list);
    return () => list.forEach((u) => u && URL.revokeObjectURL(u));
  }, [confused]);

  // 게임 중 치던 Enter 가 바로 "한 번 더" 로 이어지지 않게 잠깐 무시
  const [shownAt] = useState(() => performance.now());
  useWindowKey((e) => {
    if (e.repeat || performance.now() - shownAt < 700) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'BUTTON') return; // 버튼 위의 Enter 는 버튼이 처리
    if (e.key === 'Enter') {
      e.preventDefault();
      onAgain();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onBack();
    }
  });

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <Card>
          <h2 className="text-2xl font-black">{result.quit ? '여기까지 했어요' : '모두 맞췄어요! 🎉'}</h2>
          <div className="mt-3 grid gap-x-8 sm:grid-cols-2">
            <Stat label="맞춘 학생" value={result.solved} sub={`/ ${result.total}명`} />
            <Stat label="놓친 횟수" value={result.missed} />
            <Stat label="오답 수" value={result.wrong} />
            <Stat label="걸린 시간" value={fmtTime(result.ms / 1000)} />
            <Stat label="점수" value={result.score} />
            <Stat label="최대 연속 정답" value={result.bestCombo} />
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Btn onClick={onAgain}>
              한 번 더 <Kbd>Enter</Kbd>
            </Btn>
            {confused.length > 0 && (
              <Btn variant="ghost" onClick={() => onRetryConfused(confused)}>
                헷갈린 학생만 다시 ({confused.length}명)
              </Btn>
            )}
            <Btn variant="ghost" onClick={onBack}>
              준비 화면으로 <Kbd>Esc</Kbd>
            </Btn>
          </div>
        </Card>

        <Card>
          <h3 className="text-lg font-bold">헷갈린 학생</h3>
          {confused.length === 0 ? (
            <p className="mt-2 text-sm text-ink/60">한 번도 놓치거나 틀리지 않았어요.</p>
          ) : (
            <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
              {confused.map((s, i) => (
                <div key={studentKey(s)} className="rounded-xl bg-mint-50 p-1.5 text-center">
                  {urls[i] ? (
                    <img src={urls[i]} alt="" draggable={false} className="aspect-[3/4] w-full rounded-lg object-cover" />
                  ) : (
                    <div className="aspect-[3/4] w-full rounded-lg bg-mint-100" />
                  )}
                  <div className="mt-1 truncate font-bold">{s.name}</div>
                  <div className="text-[11px] text-ink/50">{classLabel(s)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
