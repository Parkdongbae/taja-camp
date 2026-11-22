// 배틀 결과. <BattleResult room schedule meId settleKey settle onAgain onExit exitLabel? extra? />
// - 최종 순위표(메달), 내 순위·점수·획득 낱말 수.
// - settle({ room, me }) (보통 finishBattle) 은 settleKey 에 대해 한 번만
//   (sessionStorage 표시 + 진행 중 Promise 공유 → StrictMode·새로 고침에도 중복 없음).
// - extra(res) 는 순위표 위에 덧붙일 내용(컴퓨터 대결의 다음 수준 안내 등).
// - 계급이 오르면 진급 축하 창.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BattleRoom } from '../../data/types';
import type { FallingWord } from '../../engine/battle';
import { rankPlayers, tierName, tierProgress, type BattleRank } from '../../engine/scoring';
import { useAuth } from '../../state/auth';
import type { BattleFinish } from '../../state/record';
import { TierBadge } from '../TierBadge';
import { Btn, Kbd, Modal } from '../ui';
import { playDone, playFanfare } from '../sound';

const MEDAL = ['🥇', '🥈', '🥉'];
const SETTLE_MS = 800; // 끝 무렵 선점이 다 도착하도록 잠시 기다린 뒤 정산
const inflight = new Map<string, Promise<BattleFinish>>();

type Reward = { kind: 'fresh' | 'stored'; res: BattleFinish } | { kind: 'saved' } | { kind: 'error' } | null;

function readStored(key: string): { result?: BattleFinish } | null {
  try {
    const s = sessionStorage.getItem(key);
    return s ? (JSON.parse(s) as { result?: BattleFinish }) : null;
  } catch {
    return null;
  }
}
function writeStored(key: string, v: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(v));
  } catch {
    // 무시
  }
}

export function BattleResult({
  room,
  schedule,
  meId,
  settleKey,
  settle,
  onAgain,
  onExit,
  exitLabel = '나가기',
  extra,
}: {
  room: BattleRoom;
  schedule: FallingWord[];
  meId: string;
  settleKey: string;
  settle: (a: { room: BattleRoom; me: BattleRank | undefined }) => Promise<BattleFinish>;
  onAgain: () => void;
  onExit: () => void;
  exitLabel?: string;
  extra?: (res: BattleFinish | null) => ReactNode;
}) {
  const student = useAuth((s) => s.student);
  const ranks = useMemo(() => rankPlayers(room, schedule), [room, schedule]);
  const mine = ranks.find((r) => r.id === meId);
  const [reward, setReward] = useState<Reward>(null);
  const [promoClosed, setPromoClosed] = useState(false);

  const roomRef = useRef(room);
  const schedRef = useRef(schedule);
  const settleRef = useRef(settle);
  useEffect(() => {
    roomRef.current = room;
    schedRef.current = schedule;
    settleRef.current = settle;
  }, [room, schedule, settle]);

  useEffect(() => {
    const key = settleKey;
    let cancelled = false;
    let timer = 0;
    const attach = (p: Promise<BattleFinish>) =>
      p.then(
        (res) => !cancelled && setReward({ kind: 'fresh', res }),
        () => !cancelled && setReward({ kind: 'error' }),
      );

    const running = inflight.get(key);
    if (running) attach(running);
    else {
      const stored = readStored(key);
      if (stored) setReward(stored.result ? { kind: 'stored', res: stored.result } : { kind: 'saved' });
      else {
        timer = window.setTimeout(() => {
          if (inflight.has(key) || readStored(key)) return;
          const r = roomRef.current;
          const me = rankPlayers(r, schedRef.current).find((x) => x.id === meId);
          writeStored(key, { pending: true }); // 저장 전에 먼저 표시(중복 지급 방지)
          const p = settleRef.current({ room: r, me });
          inflight.set(key, p);
          p.then((res) => writeStored(key, { result: res }), () => undefined);
          attach(p);
        }, SETTLE_MS);
      }
    }
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [settleKey, meId]);

  // 결과가 처음 나올 때 한 번: 1등이면 팡파르, 아니면 맑은 "딩"
  const fresh = reward?.kind === 'fresh';
  const placeRef = useRef(mine?.place);
  placeRef.current = mine?.place;
  useEffect(() => {
    if (!fresh) return;
    if (placeRef.current === 1) playFanfare();
    else playDone();
  }, [fresh]);

  const res = reward && (reward.kind === 'fresh' || reward.kind === 'stored') ? reward.res : null;
  const promoted = !!res && reward?.kind === 'fresh' && res.tierAfter > res.tierBefore && !promoClosed;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (promoted) {
        if (e.key === 'Enter') {
          e.preventDefault();
          setPromoClosed(true);
        }
        return; // Esc 는 Modal 이 처리
      }
      if (e.target instanceof HTMLButtonElement && e.key === 'Enter') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        onAgain();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onExit();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [promoted, onAgain, onExit]);

  const tp = tierProgress(student?.rp ?? 0);
  const n = Math.max(room.startCount, ranks.length);

  return (
    <div className="h-full bg-ink text-white">
      <div className="mx-auto flex h-full max-w-5xl flex-col gap-5 p-6">
        <div className="grid grid-cols-3 gap-5">
          <div className="anim-pop rounded-2xl bg-white/5 p-6 text-center ring-1 ring-white/10">
            <div className="text-sm text-white/50">내 순위</div>
            <div className="mt-1 text-5xl font-black">
              {mine && mine.place <= 3 ? MEDAL[mine.place - 1] : ''} {mine?.place ?? '-'}등
              <span className="text-xl text-white/40"> / {room.startCount || n}명</span>
            </div>
            <div className="mt-2 text-white/70">
              <b className="text-gold">{mine?.score ?? 0}점</b> · 낱말 {mine?.words ?? 0}개
            </div>
          </div>

          <div className="rounded-2xl bg-white/5 p-6 text-center ring-1 ring-white/10">
            <div className="text-sm text-white/50">획득</div>
            {res ? (
              <>
                <div className="mt-1 text-4xl font-black text-gold">RP +{res.rpGain}</div>
                <div className="mt-2 text-white/70">경험치 +{res.xpGain}</div>
                {res.rpGain === 0 && <div className="mt-1 text-xs text-white/40">1점 이상 얻어야 RP 를 받아요</div>}
                {res.newBadges.length > 0 && <div className="mt-1 text-xs text-gold">새 배지 {res.newBadges.length}개!</div>}
              </>
            ) : reward?.kind === 'saved' ? (
              <div className="mt-4 text-white/60">이 경기 결과는 이미 반영됐어요.</div>
            ) : reward?.kind === 'error' ? (
              <div className="mt-4 text-miss">결과를 저장하지 못했어요.</div>
            ) : (
              <div className="mt-4 text-white/50">정산하는 중...</div>
            )}
          </div>

          <div className="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
            <div className="flex items-center justify-between">
              <div className="text-sm text-white/50">내 계급</div>
              <TierBadge tier={tp.tier} large />
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gold transition-all duration-700" style={{ width: `${tp.ratio * 100}%` }} />
            </div>
            <div className="mt-2 text-sm tabular-nums text-white/60">
              {tp.next === null ? `RP ${tp.cur} · 최고 계급!` : `RP ${tp.cur} / ${tp.next} · 다음 계급까지 ${tp.next - tp.cur}`}
            </div>
          </div>
        </div>

        {extra?.(res)}

        <div className="min-h-0 flex-1 overflow-auto rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
          <div className="mb-3 font-bold">최종 순위</div>
          <ol className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {ranks.map((r) => {
              const me = r.id === meId;
              return (
                <li
                  key={r.id}
                  className={`flex items-center gap-3 rounded-lg px-3 py-1.5 ${me ? 'bg-mint-500 font-bold' : 'bg-white/5'}`}
                >
                  <span className="w-8 text-center text-lg">{r.place <= 3 ? MEDAL[r.place - 1] : <span className="text-sm text-white/50">{r.place}</span>}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {r.name}
                    {me ? ' (나)' : ''} <span className={`text-xs ${me ? 'text-white/80' : 'text-white/40'}`}>{r.classNo ? `${r.classNo}반` : ''}</span>
                  </span>
                  <span className={`text-xs ${me ? 'text-white/80' : 'text-white/40'}`}>{r.words}개</span>
                  <span className="w-12 text-right font-bold tabular-nums">{r.score}점</span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="flex justify-center gap-3">
          <Btn onClick={onAgain}>
            한 판 더 <Kbd>Enter</Kbd>
          </Btn>
          <Btn variant="ghost" onClick={onExit}>
            {exitLabel} <Kbd>Esc</Kbd>
          </Btn>
        </div>
      </div>

      {promoted && res && (
        <Modal onClose={() => setPromoClosed(true)}>
          <div className="text-center text-ink">
            <img src="/mascot-promote.png" alt="" className="mx-auto h-40 w-40 object-contain" />
            <div className="mt-3 text-2xl font-black">진급을 축하합니다!</div>
            <div className="mt-3 flex items-center justify-center gap-2 text-lg font-bold">
              <TierBadge tier={res.tierBefore} large /> → <TierBadge tier={res.tierAfter} large />
            </div>
            <div className="mt-2 text-ink/60">
              {tierName(res.tierBefore)} → {tierName(res.tierAfter)}
            </div>
            <div className="mt-6">
              <Btn onClick={() => setPromoClosed(true)}>
                확인 <Kbd>Enter</Kbd>
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
