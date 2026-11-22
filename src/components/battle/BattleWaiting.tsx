// 배틀 대기실. <BattleWaiting room meId onStart onLeave starting error />
// 방장만 [시작 Enter](2명 이상), [나가기 Esc].
import { useEffect } from 'react';
import { BATTLE_DURATION_SEC, BATTLE_MAX_PLAYERS, type BattleRoom } from '../../data/types';
import { tierName } from '../../engine/scoring';
import { TierBadge } from '../TierBadge';
import { Btn, Kbd } from '../ui';
import { LANG_LABEL } from './battleUtil';

export function BattleWaiting({
  room,
  meId,
  onStart,
  onLeave,
  starting,
  error,
}: {
  room: BattleRoom;
  meId: string;
  onStart: () => void;
  onLeave: () => void;
  starting: boolean;
  error: string;
}) {
  const players = Object.values(room.players ?? {}).sort((a, b) => a.joinedAt - b.joinedAt);
  const isHost = room.host === meId;
  const canStart = isHost && players.length >= 2 && !starting;
  const hostName = room.players?.[room.host]?.name ?? '';

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === 'Enter') {
        if (e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        if (canStart) onStart();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onLeave();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [canStart, onStart, onLeave]);

  return (
    <div className="h-full bg-ink text-white">
      <div className="mx-auto flex h-full max-w-5xl flex-col gap-5 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-black">⚔️ 배틀 대기실</h1>
            <TierBadge tier={room.tier} large />
            <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-bold">{LANG_LABEL[room.lang]}</span>
          </div>
          <div className="text-2xl font-black tabular-nums">
            참가 {players.length} <span className="text-white/40">/ {BATTLE_MAX_PLAYERS}</span>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-4 content-start gap-3 overflow-auto rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
          {players.map((p) => {
            const me = p.id === meId;
            return (
              <div
                key={p.id}
                className={`anim-pop flex items-center justify-between rounded-xl px-4 py-3 ${
                  me ? 'bg-mint-500 text-white' : 'bg-white/10'
                } ${p.online === false ? 'opacity-40' : ''}`}
              >
                <div className="min-w-0">
                  <div className="truncate font-bold">
                    {p.name}
                    {me ? ' (나)' : ''}
                  </div>
                  <div className={`text-xs ${me ? 'text-white/80' : 'text-white/50'}`}>{p.classNo}반</div>
                </div>
                {p.id === room.host && (
                  <span className="shrink-0 rounded-full bg-gold px-2 py-0.5 text-xs font-bold text-ink">👑 방장</span>
                )}
              </div>
            );
          })}
          {Array.from({ length: Math.max(0, Math.min(4, BATTLE_MAX_PLAYERS - players.length)) }, (_, i) => (
            <div key={`empty${i}`} className="rounded-xl border-2 border-dashed border-white/10 px-4 py-3 text-sm text-white/30">
              빈 자리
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between rounded-2xl bg-white/5 px-6 py-4 ring-1 ring-white/10">
          <div className="text-sm text-white/70">
            <div>
              방장: <b className="text-white">{hostName}</b> · {tierName(room.tier)} 방 · {BATTLE_DURATION_SEC}초 경기
            </div>
            <div className="mt-1 text-white/50">
              {isHost
                ? players.length >= 2
                  ? '모두 모이면 시작을 누르세요. 16명이 차면 자동으로 시작해요.'
                  : '친구가 들어오면 시작할 수 있어요.'
                : '방장이 시작하기를 기다리는 중...'}
            </div>
            {error && <div className="mt-1 text-miss">{error}</div>}
          </div>
          <div className="flex gap-3">
            <Btn variant="ghost" onClick={onLeave}>
              나가기 <Kbd>Esc</Kbd>
            </Btn>
            {isHost && (
              <Btn onClick={onStart} disabled={!canStart}>
                {starting ? '시작하는 중...' : '시작'} <Kbd>Enter</Kbd>
              </Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
