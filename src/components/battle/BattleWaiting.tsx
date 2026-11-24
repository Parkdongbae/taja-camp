// 배틀 대기실. <BattleWaiting room meId onStart onLeave onDuration? starting error />
// 방장만 [시작 Enter](2명 이상), [나가기 Esc]. 방장은 경기 시간(←/→ 또는 버튼, 기본 2분)과 경기 방식(↑/↓ 또는 버튼: 개인전·팀전)을 고른다.
// 팀전이면 들어온 순서대로 홍팀·청팀을 번갈아 배정해 보여 준다.
import { useEffect } from 'react';
import { BATTLE_MAX_PLAYERS, type BattleRoom } from '../../data/types';
import { BATTLE_DURATIONS } from '../../engine/battle';
import { tierName } from '../../engine/scoring';
import { TEAM_NAMES, teamOf } from '../../engine/events';
import { TierBadge } from '../TierBadge';
import { Btn, Kbd } from '../ui';
import { LANG_LABEL } from './battleUtil';

export function BattleWaiting({
  room,
  meId,
  onStart,
  onLeave,
  onDuration,
  onMode,
  starting,
  error,
}: {
  onDuration?: (sec: number) => void;
  onMode?: (mode: 'ffa' | 'team') => void;
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
  const teamMode = room.mode === 'team';
  const teams = teamOf(room.players);
  const durLabel = (sec: number) => (sec % 60 === 0 ? `${sec / 60}분` : `${Math.floor(sec / 60)}분 ${sec % 60}초`);

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
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && isHost && onDuration) {
        // 방장: 경기 시간 바꾸기
        e.preventDefault();
        const list = BATTLE_DURATIONS as readonly number[];
        const i = Math.max(0, list.indexOf(room.durationSec));
        const j = Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
        if (list[j] !== room.durationSec) onDuration(list[j]);
      } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && isHost && onMode) {
        // 방장: 개인전 ↔ 팀전
        e.preventDefault();
        onMode(teamMode ? 'ffa' : 'team');
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [canStart, onStart, onLeave, isHost, onDuration, room.durationSec, onMode, teamMode]);

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
                } ${p.online === false ? 'opacity-40' : ''} ${teamMode ? (teams[p.id] === 0 ? 'ring-4 ring-rose-500' : 'ring-4 ring-sky-500') : ''}`}
              >
                <div className="min-w-0">
                  <div className="truncate font-bold">
                    {p.name}
                    {me ? ' (나)' : ''}
                  </div>
                  <div className={`text-xs ${me ? 'text-white/80' : 'text-white/50'}`}>
                    {p.classNo}반{teamMode ? ` · ${TEAM_NAMES[teams[p.id] ?? 0]}` : ''}
                  </div>
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
              방장: <b className="text-white">{hostName}</b> · {tierName(room.tier)} 방 · <b className="text-gold">{durLabel(room.durationSec)}</b> 경기
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <span className="mr-1 text-white/50">경기 방식</span>
              {(['ffa', 'team'] as const).map((m) => {
                const on = (m === 'team') === teamMode;
                const label = m === 'team' ? '팀전(홍·청)' : '개인전';
                return isHost && onMode ? (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onMode(m)}
                    aria-pressed={on}
                    className={`rounded-full px-3 py-1 text-xs font-bold transition ${on ? 'bg-gold text-ink' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}
                  >
                    {label}
                  </button>
                ) : (
                  <span key={m} className={`rounded-full px-3 py-1 text-xs font-bold ${on ? 'bg-gold text-ink' : 'bg-white/5 text-white/30'}`}>
                    {label}
                  </span>
                );
              })}
              {isHost && onMode && (
                <span className="ml-1 text-xs text-white/40">
                  <Kbd>↑</Kbd> <Kbd>↓</Kbd> 로 바꾸기
                </span>
              )}
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <span className="mr-1 text-white/50">경기 시간</span>
              {BATTLE_DURATIONS.map((sec) => {
                const on = sec === room.durationSec;
                return isHost && onDuration ? (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => onDuration(sec)}
                    aria-pressed={on}
                    className={`rounded-full px-3 py-1 text-xs font-bold transition ${on ? 'bg-gold text-ink' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}
                  >
                    {durLabel(sec)}
                  </button>
                ) : (
                  <span key={sec} className={`rounded-full px-3 py-1 text-xs font-bold ${on ? 'bg-gold text-ink' : 'bg-white/5 text-white/30'}`}>
                    {durLabel(sec)}
                  </span>
                );
              })}
              {isHost && onDuration && (
                <span className="ml-1 text-xs text-white/40">
                  <Kbd>←</Kbd> <Kbd>→</Kbd> 로 바꾸기
                </span>
              )}
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
