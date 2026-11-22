// 배틀 방(/battle/:roomId). watchRoom 으로 방을 구독하고 상태별 화면을 보여 준다.
//   waiting → BattleWaiting (대기실)   playing → BattlePlay (카운트다운·경기)   done → BattleResult (결과)
// - 입장은 로비에서만 한다. 여기서는 방에 들어가지 않는다.
// - 참가자 목록에 내가 없으면: 대기 중이면 로비로, 경기 중이면 관전 불가 안내 후 로비로.
// - 실제로 화면을 떠날 때만(StrictMode 의 가짜 정리 제외) leaveRoom.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { backend } from '../data';
import { BATTLE_MAX_PLAYERS, type BattleRoom } from '../data/types';
import { buildSchedule } from '../engine/battle';
import { useAuth } from '../state/auth';
import { useContent } from '../content';
import { Btn, Kbd } from '../components/ui';
import { BattleWaiting } from '../components/battle/BattleWaiting';
import { BattlePlay, type BattleDriver } from '../components/battle/BattlePlay';
import { BattleResult } from '../components/battle/BattleResult';
import { battlePool, rewardKey, type LobbyState } from '../components/battle/battleUtil';
import type { BattleRank } from '../engine/scoring';
import { finishBattle } from '../state/record';

function Dark({ children }: { children: ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-4 bg-ink p-6 text-center text-white">{children}</div>;
}

export default function BattleGame() {
  const { roomId = '' } = useParams();
  const nav = useNavigate();
  const student = useAuth((s) => s.student);
  const meId = student?.id ?? '';
  const loaded = useContent((s) => s.loaded);
  const words = useContent((s) => s.words);

  const [live, setLive] = useState<BattleRoom | null | undefined>(undefined);
  const [lastDone, setLastDone] = useState<BattleRoom | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const leftRef = useRef(false);

  useEffect(() => {
    setLive(undefined);
    return backend.watchRoom(roomId, (r) => {
      setLive(r);
      if (r?.state === 'done') setLastDone(r);
    });
  }, [roomId]);

  // 결과를 보는 중에 방이 지워져도 결과는 계속 보여 준다
  const room = live === null && lastDone ? lastDone : live;
  const inRoom = !!room && !!meId && !!room.players?.[meId];

  const roomRef = useRef(room);
  const meRef = useRef(meId);
  useEffect(() => {
    roomRef.current = room;
    meRef.current = meId;
  }, [room, meId]);

  const toLobby = useCallback(
    (notice?: string) => nav('/battle', { replace: true, state: (notice ? { notice } : null) satisfies LobbyState | null }),
    [nav],
  );

  // 방이 없거나 대기실에서 빠졌으면 로비로
  useEffect(() => {
    if (leftRef.current || room === undefined) return;
    if (room === null) {
      const t = window.setTimeout(() => toLobby('방이 사라졌어요. 다시 입장해 주세요.'), 600);
      return () => window.clearTimeout(t);
    }
    if (!inRoom && room.state === 'waiting') toLobby('대기실에서 나왔어요. 다시 입장해 주세요.');
    if (!inRoom && room.state === 'done') toLobby();
  }, [room, inRoom, toLobby]);

  // 실제로 떠날 때만 방에서 나가기(StrictMode 에서는 정리 직후 다시 실행되므로 건너뜀)
  const activeRoom = useRef<string | null>(null);
  useEffect(() => {
    activeRoom.current = roomId;
    return () => {
      activeRoom.current = null;
      window.setTimeout(() => {
        if (activeRoom.current === roomId || leftRef.current) return;
        const r = roomRef.current;
        const sid = meRef.current;
        if (r && sid && r.id === roomId && r.players?.[sid]) void backend.leaveRoom(roomId, sid).catch(() => undefined);
      }, 0);
    };
  }, [roomId]);

  // ── 대기실 동작 ──
  const onStart = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    setError('');
    try {
      await backend.startRoom(roomId);
    } catch {
      setError('시작하지 못했어요. 다시 눌러 주세요.');
    } finally {
      setStarting(false);
    }
  }, [roomId, starting]);

  const onLeave = useCallback(async () => {
    if (leftRef.current) return;
    leftRef.current = true;
    try {
      if (meId) await backend.leaveRoom(roomId, meId);
    } catch {
      // 무시
    }
    nav('/battle', { replace: true });
  }, [roomId, meId, nav]);

  // 정원이 차면 방장이 자동 시작
  const playerCount = room ? Object.keys(room.players ?? {}).length : 0;
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!room || room.state !== 'waiting' || room.host !== meId || playerCount < BATTLE_MAX_PLAYERS) return;
    if (autoStarted.current) return;
    autoStarted.current = true;
    void onStart();
  }, [room, meId, playerCount, onStart]);

  // ── 낱말 일정(모든 참가자가 같은 값) ──
  const seed = room?.seed ?? 0;
  const startCount = room?.startCount ?? 0;
  const durationSec = room?.durationSec ?? 0;
  const lang = room?.lang ?? 'ko';
  const started = !!room && room.state !== 'waiting';
  const schedule = useMemo(
    () => (started && loaded ? buildSchedule(seed, battlePool(words, lang), startCount, durationSec) : null),
    [started, loaded, seed, startCount, durationSec, lang, words],
  );

  const again = useCallback(
    () => nav('/battle', { replace: true, state: { again: true, lang } satisfies LobbyState }),
    [nav, lang],
  );
  const exit = useCallback(() => nav('/home'), [nav]);

  // 서버 방을 쓰는 경기 진행자
  const driver = useMemo<BattleDriver>(
    () => ({
      now: () => backend.serverNow(),
      claim: (index) => backend.claimWord(roomId, index, meId),
      finish: () => void backend.finishRoom(roomId),
      freeze: (ms) => backend.freezeRoom(roomId, meId, ms),
    }),
    [roomId, meId],
  );
  const settle = useCallback(
    ({ room: r, me }: { room: BattleRoom; me: BattleRank | undefined }) =>
      finishBattle({
        playerCount: Math.max(1, r.startCount),
        place: me?.place ?? Math.max(1, r.startCount),
        score: me?.score ?? 0,
        words: me?.words ?? 0,
        seconds: r.durationSec,
        lang: r.lang,
      }),
    [],
  );

  if (!student) return null;
  if (room === undefined || room === null) return <Dark>방에 연결하는 중...</Dark>;

  if (room.state === 'waiting') {
    if (!inRoom) return <Dark>로비로 돌아가는 중...</Dark>;
    return <BattleWaiting room={room} meId={meId} onStart={onStart} onLeave={onLeave} starting={starting} error={error} />;
  }

  if (!inRoom) {
    if (room.state === 'done') return <Dark>로비로 돌아가는 중...</Dark>;
    return <Spectator onBack={() => toLobby()} />;
  }

  if (!schedule) return <Dark>낱말을 준비하는 중...</Dark>;
  if (schedule.length === 0) {
    return (
      <Dark>
        <div className="text-xl font-bold">배틀에 쓸 낱말이 없어요.</div>
        <Btn onClick={() => toLobby()}>로비로</Btn>
      </Dark>
    );
  }

  if (room.state === 'playing') return <BattlePlay room={room} schedule={schedule} meId={meId} driver={driver} />;
  return (
    <BattleResult
      room={room}
      schedule={schedule}
      meId={meId}
      settleKey={rewardKey(room.id, meId)}
      settle={settle}
      onAgain={again}
      onExit={exit}
    />
  );
}

function Spectator({ onBack }: { onBack: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onBack, 4000);
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', h);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', h);
    };
  }, [onBack]);
  return (
    <Dark>
      <div className="text-5xl">👀</div>
      <div className="text-2xl font-black">이미 경기가 시작된 방이에요.</div>
      <div className="text-white/60">경기 중인 방은 볼 수 없어요. 잠시 뒤 로비로 돌아갑니다.</div>
      <Btn onClick={onBack}>
        로비로 <Kbd>Enter</Kbd>
      </Btn>
    </Dark>
  );
}
