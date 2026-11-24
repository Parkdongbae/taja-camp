// 컴퓨터 대결(연습 배틀, /battle/solo). 서버 방 없이 전부 이 브라우저에서 진행한다.
// - 나 + 컴퓨터 3명(새내기·맞수·고수). 봇 타수는 engine/bots 의 botBaseKpm(최고 타수·계급 RP·solo.level) × 0.8/1.0/1.15.
// - seed 무작위, 시간은 performance.now, claims 는 로컬 상태. 봇은 createBotRunner 로 매 프레임 진행.
// - 협동 낱말은 봇도 각자 친다(planBotCoop 의 시각에 협동 칸에 기록). 봇 진행기에는 협동 낱말을 뺀 일정을 준다.
// - 끝나면 finishBattle({ practice: true }) → RP 절반, 실제 전적 제외, solo.level ±1.
// - 경기 중에 떠나거나 새로 고침하면 그 판은 무효(아무것도 저장하지 않음).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BATTLE_DURATION_SEC, type BattleRoom, type Lang, type Student } from '../data/types';
import { buildSchedule, nextCoopIndex, normalizeFallSpeed, type FallingWord } from '../engine/battle';
import { botBaseKpm, createBotRunner, makeBots, nextSoloLevel, planBotCoop, SOLO_LEVEL_MAX, SOLO_LEVEL_MIN, type Bot, type BotClaim } from '../engine/bots';
import { rankPlayers, tierOf, type BattleRank } from '../engine/scoring';
import { isBattleUnlocked, isEnBattleUnlocked } from '../engine/stages';
import { useAuth } from '../state/auth';
import { finishBattle, type BattleFinish } from '../state/record';
import { useContent } from '../content';
import { BattlePlay, type BattleDriver } from '../components/battle/BattlePlay';
import { BattleResult } from '../components/battle/BattleResult';
import { battlePool, battleRiddles, readBattleLang, type LobbyState } from '../components/battle/battleUtil';

const BOT_ICON = '🤖 ';

function random32(): number {
  if (typeof crypto?.getRandomValues === 'function') return crypto.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 2 ** 32);
}

export default function BattleSolo() {
  const nav = useNavigate();
  const loc = useLocation();
  const { student, settings } = useAuth();
  const openAll = !!settings.battleOpenAll; // 임시 공개
  const open = !!student && (openAll || isBattleUnlocked(student.position)) && settings.battleEnabled;
  const want = ((loc.state ?? null) as LobbyState | null)?.lang ?? readBattleLang();
  const lang: Lang = want === 'en' && student && (openAll || isEnBattleUnlocked(student.position)) ? 'en' : 'ko';
  const [gameNo, setGameNo] = useState(0);
  const loaded = useContent((s) => s.loaded);

  useEffect(() => {
    if (student && !open) nav('/battle', { replace: true });
  }, [student, open, nav]);

  if (!student || !open) return null;
  if (!loaded) return <div className="flex h-full items-center justify-center bg-ink text-white/70">낱말을 준비하는 중...</div>;
  return <SoloMatch key={gameNo} lang={lang} student={student} onAgain={() => setGameNo((n) => n + 1)} onExit={() => nav('/battle')} />;
}

function SoloMatch({ lang, student, onAgain, onExit }: { lang: Lang; student: Student; onAgain: () => void; onExit: () => void }) {
  const words = useContent((s) => s.words);
  const meId = student.id;
  const durMs = BATTLE_DURATION_SEC * 1000;

  // 판 하나의 고정 설정(시작할 때 학생 상태로 정하고, 결과가 반영돼도 바꾸지 않음)
  const [setup] = useState(() => {
    const baseKpm = botBaseKpm(student, lang);
    const bots = makeBots(baseKpm);
    const seed = random32();
    const startAt = performance.now() + 5000;
    const room: BattleRoom = {
      id: `solo-${Date.now().toString(36)}-${(seed % 46656).toString(36)}`,
      tier: tierOf(student.rp),
      lang,
      host: meId,
      state: 'playing',
      seed,
      startAt,
      durationSec: BATTLE_DURATION_SEC,
      startCount: 1 + bots.length,
      createdAt: Date.now(),
      players: {
        [meId]: { id: meId, name: student.name, classNo: student.classNo, joinedAt: 0, online: true },
        ...Object.fromEntries(bots.map((b, i) => [b.id, { id: b.id, name: BOT_ICON + b.name, classNo: 0, joinedAt: i + 1, online: true }])),
      },
      claims: {},
      fall: normalizeFallSpeed(useAuth.getState().settings.fallSpeed),
    };
    return { baseKpm, bots, level: student.solo?.level ?? 0, room };
  });

  const schedule = useMemo<FallingWord[]>(
    () =>
      buildSchedule(setup.room.seed, battlePool(words, lang), setup.room.startCount, BATTLE_DURATION_SEC, setup.room.fall, {
        riddles: battleRiddles(words, lang).keys(),
      }),
    // 판 도중 콘텐츠가 바뀌어도 일정은 그대로
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [runner] = useState(() =>
    createBotRunner(
      schedule.filter((w) => !w.coop && !w.comeback), // 협동은 따로, 역전 찬스는 학생 몫
      setup.bots,
      (setup.room.seed ^ 0x5bd1e995) >>> 0,
      durMs,
    ),
  );
  const [coopPlan] = useState(() => planBotCoop(schedule, setup.bots, (setup.room.seed ^ 0x27d4eb2f) >>> 0, durMs));
  const coopPtr = useRef(0);
  const [room, setRoom] = useState<BattleRoom>(setup.room);
  const claimsRef = useRef<BattleRoom['claims']>({});
  const freezesRef = useRef<NonNullable<BattleRoom['freezes']>>({});
  const startAt = setup.room.startAt;

  const publish = useCallback((done?: boolean) => {
    setRoom((r) => ({ ...r, claims: { ...claimsRef.current }, freezes: { ...freezesRef.current }, ...(done ? { state: 'done' as const } : {}) }));
  }, []);

  const advance = useCallback(
    (elapsed: number) => {
      const got: BotClaim[] = runner.step(elapsed, claimsRef.current);
      for (const c of got) claimsRef.current[String(c.index)] = { by: c.botId, at: startAt + c.at };
      // 봇이 협동 낱말을 치는 시각이 지났으면 협동 칸에 기록
      let coop = false;
      while (coopPtr.current < coopPlan.length && coopPlan[coopPtr.current].at <= elapsed) {
        const c = coopPlan[coopPtr.current++];
        const k = nextCoopIndex(c.index, claimsRef.current);
        if (k < 0) continue;
        claimsRef.current[String(k)] = { by: c.botId, at: startAt + c.at };
        coop = true;
      }
      return got.length > 0 || coop;
    },
    [runner, startAt, coopPlan],
  );

  const driver = useMemo<BattleDriver>(
    () => ({
      now: () => performance.now(),
      claim: async (index) => {
        const now = performance.now();
        advance(now - startAt); // 그 순간까지 봇이 먼저 끝낸 낱말부터 반영
        const k = String(index);
        if (claimsRef.current[k]) {
          publish();
          return claimsRef.current[k].by === meId;
        }
        claimsRef.current[k] = { by: meId, at: now };
        publish();
        return true;
      },
      finish: () => {
        advance(durMs);
        publish(true);
      },
      onFrame: (t) => {
        if (advance(t)) publish();
      },
      // 멈추기: 봇들이 ms 동안 쉰다(한 판에 한 번)
      freeze: async (ms) => {
        if (freezesRef.current[meId]) return false;
        const now = performance.now();
        advance(now - startAt);
        runner.freeze(now - startAt + ms);
        freezesRef.current[meId] = { at: now, ms };
        publish();
        return true;
      },
    }),
    [advance, publish, runner, startAt, durMs, meId],
  );

  const settle = useCallback(
    ({ room: r, me }: { room: BattleRoom; me: BattleRank | undefined }) =>
      finishBattle({
        playerCount: r.startCount,
        place: me?.place ?? r.startCount,
        score: me?.score ?? 0,
        words: me?.words ?? 0,
        seconds: r.durationSec,
        lang: r.lang,
        practice: true,
      }),
    [],
  );

  const extra = useCallback(
    (res: BattleFinish | null) => <SoloSummary room={room} schedule={schedule} meId={meId} bots={setup.bots} level={setup.level} res={res} />,
    [room, schedule, meId, setup],
  );

  if (schedule.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-ink text-white">
        <div className="text-xl font-bold">배틀에 쓸 낱말이 없어요.</div>
        <button className="rounded-xl bg-mint-500 px-5 py-2.5 font-bold" onClick={onExit}>
          로비로
        </button>
      </div>
    );
  }

  if (room.state === 'playing') {
    return <BattlePlay room={room} schedule={schedule} meId={meId} driver={driver} title={`🤖 컴퓨터 대결 · 연습 (기준 ${setup.baseKpm}타)`} />;
  }
  return (
    <BattleResult
      room={room}
      schedule={schedule}
      meId={meId}
      settleKey={`taja.battle.solo.${room.id}.${meId}`}
      settle={settle}
      onAgain={onAgain}
      onExit={onExit}
      exitLabel="로비로"
      extra={extra}
    />
  );
}

// 결과 화면에 덧붙이는 컴퓨터 대결 요약: 다음 판 수준, 봇 타수, 격려 문구
function SoloSummary({
  room,
  schedule,
  meId,
  bots,
  level,
  res,
}: {
  room: BattleRoom;
  schedule: FallingWord[];
  meId: string;
  bots: Bot[];
  level: number;
  res: BattleFinish | null;
}) {
  const list = useMemo(() => rankPlayers(room, schedule), [room, schedule]);
  const mine = list.find((r) => r.id === meId);
  const place = mine?.place ?? list.length;
  const after = res?.solo?.after.level ?? nextSoloLevel(level, place);
  const before = res?.solo?.before.level ?? level;
  const placeOf = (id: string) => list.find((r) => r.id === id)?.place ?? list.length;
  const beaten = bots.filter((b) => placeOf(b.id) > place);
  const above = bots.filter((b) => placeOf(b.id) < place);
  let cheer: string;
  if (beaten.length === bots.length && (mine?.score ?? 0) > 0) cheer = '컴퓨터를 모두 이겼어요! 다음 판은 조금 더 빨라져요.';
  else if (beaten.length > 0 && above.length > 0)
    cheer = `${beaten[beaten.length - 1].name}를 이겼어요! 다음엔 ${above[0].name}에게 도전해 보세요.`;
  else if (above.length > 0) cheer = `다음엔 ${above[0].name}를 이겨 봐요! 서두르지 말고 정확하게 치면 돼요.`;
  else cheer = '좋은 승부였어요! 한 판 더 해 볼까요?';

  const change =
    after > before
      ? { icon: '▲', text: '다음 판 컴퓨터 수준: 조금 빨라집니다', cls: 'text-gold' }
      : after < before
        ? { icon: '▼', text: '다음 판 컴퓨터 수준: 조금 느려집니다', cls: 'text-mint-300' }
        : {
            icon: '■',
            text:
              before >= SOLO_LEVEL_MAX && place === 1
                ? '다음 판 컴퓨터 수준: 유지 (가장 높은 수준)'
                : before <= SOLO_LEVEL_MIN && place > 2
                  ? '다음 판 컴퓨터 수준: 유지 (가장 낮은 수준)'
                  : '다음 판 컴퓨터 수준: 유지',
            cls: 'text-white/70',
          };

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-white/5 px-6 py-4 ring-1 ring-white/10">
      <div className="min-w-0">
        <div className="text-lg font-bold">{cheer}</div>
        <div className={`mt-1 text-sm font-bold ${change.cls}`}>
          {change.icon} {change.text} <span className="font-normal text-white/40">(수준 {before > 0 ? `+${before}` : before} → {after > 0 ? `+${after}` : after})</span>
        </div>
        <div className="mt-1 text-xs text-white/40">연습 배틀이라 계급 포인트(RP)는 절반만 받고, 배틀 전적에는 들어가지 않아요.</div>
      </div>
      <div className="flex shrink-0 gap-2">
        {bots.map((b) => (
          <div key={b.id} className="rounded-xl bg-white/10 px-3 py-2 text-center text-xs">
            <div className="text-white/60">🤖 {b.name.replace('컴퓨터 ', '')}</div>
            <div className="text-base font-black tabular-nums">{b.kpm}타</div>
          </div>
        ))}
      </div>
    </div>
  );
}
