// 배틀 로비(/battle): 입장 조건 확인, 내 계급·RP, 같은 계급 방 현황, [친구와 배틀 Enter], [컴퓨터와 대결 C](/battle/solo).
// 학급 배틀(settings.classBattle 가 켜져 있고 반이 있는 학생): [🏫 학급 배틀 K] 로 같은 반 방에 들어간다. 자리 단계·계급과 상관없이 열린다.
// 결과 화면의 [한 판 더] 는 router state { again: true, lang } 로 넘어와 바로 입장한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { backend } from '../data';
import { AppError, BATTLE_DURATION_SEC, BATTLE_MAX_PLAYERS, type BattleRoom, type ClassBattleRecord, type Lang } from '../data/types';
import { useAuth } from '../state/auth';
import { usePrefs } from '../state/prefs';
import { playScore } from '../components/sound';
import { getStage, isBattleUnlocked, isEnBattleUnlocked, nextStageId } from '../engine/stages';
import { tierProgress } from '../engine/scoring';
import { isMemberId } from '../engine/member';
import { CLASS_MAX_PLAYERS, classStandings, klassOf, normalizeClassDuration } from '../engine/classBattle';
import { TierBadge } from '../components/TierBadge';
import { Btn, Kbd } from '../components/ui';
import { BATTLE_LANG_KEY, LANG_LABEL, readBattleLang, type LobbyState } from '../components/battle/battleUtil';

export default function BattleLobby() {
  const nav = useNavigate();
  const loc = useLocation();
  const { student, settings } = useAuth();
  const navState = (loc.state ?? null) as LobbyState | null;
  const sound = usePrefs((s) => s.sound);
  const setPrefs = usePrefs((s) => s.set);

  // 임시 공개(선생님 설정)면 자리 단계와 상관없이 연다
  const openAll = !!settings.battleOpenAll;
  const unlocked = !!student && (openAll || isBattleUnlocked(student.position));
  const enUnlocked = !!student && (openAll || isEnBattleUnlocked(student.position));
  const tempOpen = !!student && openAll && !isBattleUnlocked(student.position);
  const [langPick, setLangPick] = useState<Lang>(() => navState?.lang ?? readBattleLang());
  const lang: Lang = langPick === 'en' && enUnlocked ? 'en' : 'ko';
  const tp = tierProgress(student?.rp ?? 0);
  const tier = tp.tier;

  const [rooms, setRooms] = useState<BattleRoom[] | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [notice] = useState(navState?.notice ?? '');
  const open = unlocked && settings.battleEnabled;
  // 학급 배틀: 선생님이 켰고 반이 있는 학생이면 일반 배틀 잠금과 상관없이 입장
  const classOpen = !!settings.classBattle && !!student && !isMemberId(student.id) && student.grade > 0 && student.classNo > 0;
  const classSec = normalizeClassDuration(settings.classBattleSec);
  const [records, setRecords] = useState<ClassBattleRecord[]>([]);
  useEffect(() => {
    if (!settings.classBattle) return;
    let off = false;
    backend
      .listClassBattles(100)
      .then((l) => !off && setRecords(l))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [settings.classBattle]);

  useEffect(() => {
    try {
      sessionStorage.setItem(BATTLE_LANG_KEY, lang);
    } catch {
      // 무시
    }
  }, [lang]);

  useEffect(() => {
    if (!open) return;
    setRooms(null);
    return backend.watchRooms(tier, lang, setRooms);
  }, [open, tier, lang]);

  const joiningRef = useRef(false);
  const join = useCallback(async () => {
    if (!student || !open || joiningRef.current) return;
    joiningRef.current = true;
    setJoining(true);
    setError('');
    try {
      const id = await backend.joinOrCreateRoom(tier, lang, {
        id: student.id,
        name: student.name,
        classNo: student.classNo,
        joinedAt: 0,
        online: true,
      });
      nav(`/battle/${id}`);
    } catch (e) {
      setError(e instanceof AppError && e.code === 'ROOM_FULL' ? '방이 가득 찼어요. 다시 시도해 주세요.' : '입장하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
      joiningRef.current = false;
      setJoining(false);
    }
  }, [student, open, tier, lang, nav]);

  // [한 판 더] 로 왔으면 바로 입장(StrictMode 이중 실행에도 한 번만)
  const againDone = useRef(false);
  useEffect(() => {
    if (!navState?.again || againDone.current || !open) return;
    againDone.current = true;
    nav(loc.pathname, { replace: true, state: null });
    void join();
  }, [navState?.again, open, join, nav, loc.pathname]);

  const joinClass = useCallback(async () => {
    if (!student || !classOpen || joiningRef.current) return;
    joiningRef.current = true;
    setJoining(true);
    setError('');
    try {
      const id = await backend.joinOrCreateClassRoom(
        klassOf(student.grade, student.classNo),
        'ko',
        { id: student.id, name: student.name, classNo: student.classNo, joinedAt: 0, online: true },
        classSec,
      );
      nav(`/battle/${id}`);
    } catch (e) {
      setError(e instanceof AppError && e.code === 'ROOM_FULL' ? '우리 반 방이 가득 찼어요.' : '입장하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
      joiningRef.current = false;
      setJoining(false);
    }
  }, [student, classOpen, classSec, nav]);

  const solo = useCallback(() => {
    if (open && !joiningRef.current) nav('/battle/solo', { state: { lang } satisfies LobbyState });
  }, [open, lang, nav]);

  // 단축키
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.code === 'KeyK' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (classOpen) {
          e.preventDefault();
          void joinClass();
        }
        return;
      }
      if (e.code === 'KeyC' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // 한글 입력 상태에서도 되도록 물리 글쇠(code)로 본다
        if (open) {
          e.preventDefault();
          solo();
        }
        return;
      }
      if (e.key === 'Enter') {
        if (e.target instanceof HTMLButtonElement) return; // 버튼 자체의 클릭으로 처리
        e.preventDefault();
        if (open) void join();
        else if (classOpen) void joinClass();
        else if (!unlocked) nav('/position');
        else nav('/home');
      } else if (e.key === 'Escape') {
        nav('/home');
      } else if (open && enUnlocked && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        setLangPick((l) => (l === 'ko' ? 'en' : 'ko'));
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, unlocked, enUnlocked, classOpen, join, joinClass, solo, nav]);

  if (!student) return null;

  // ── 잠김 ──
  if (!open && !classOpen) {
    const koLeft = Math.max(0, 8 - student.position.ko);
    const symLeft = Math.max(0, 2 - student.position.symbol);
    const nextId = nextStageId(student.position, 'ko') ?? nextStageId(student.position, 'symbol');
    return (
      <div className="flex h-full items-center justify-center bg-ink p-6 text-white">
        <div className="w-full max-w-lg rounded-3xl bg-white/5 p-10 text-center ring-1 ring-white/10">
          <div className="text-5xl">{unlocked ? '⏸️' : '🔒'}</div>
          <h1 className="mt-4 text-3xl font-black">배틀 모드</h1>
          {unlocked ? (
            <>
              <p className="mt-4 text-lg text-white/80">선생님이 배틀을 꺼 두었어요.</p>
              <p className="mt-1 text-sm text-white/50">지금은 연습 시간이에요. 선생님이 다시 켜면 들어올 수 있어요.</p>
              <div className="mt-8">
                <Btn onClick={() => nav('/home')}>
                  홈으로 <Kbd>Enter</Kbd>
                </Btn>
              </div>
            </>
          ) : (
            <>
              <p className="mt-4 text-lg text-white/80">한글 자리 8단계와 기호 2단계를 모두 통과하면 열려요.</p>
              <div className="mt-5 flex justify-center gap-3 text-sm">
                <span className="rounded-full bg-white/10 px-3 py-1">한글 {student.position.ko}/8</span>
                <span className="rounded-full bg-white/10 px-3 py-1">기호 {student.position.symbol}/2</span>
              </div>
              <p className="mt-4 text-white/70">
                남은 단계 <b className="text-gold">{koLeft + symLeft}</b>개
                {nextId ? ` · 다음: ${nextId} 「${getStage(nextId)?.name ?? ''}」` : ''}
              </p>
              <div className="mt-8 flex justify-center gap-3">
                <Btn onClick={() => nav('/position')}>
                  단계 지도로 <Kbd>Enter</Kbd>
                </Btn>
                <Btn variant="ghost" onClick={() => nav('/home')}>
                  홈 <Kbd>Esc</Kbd>
                </Btn>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const waiting = (rooms ?? []).filter((r) => r.state === 'waiting');
  const playing = (rooms ?? []).filter((r) => r.state === 'playing');
  const standings = classStandings(records);
  const myKlass = student.grade * 100 + student.classNo;

  return (
    <div className="h-full bg-ink text-white">
      <div className="mx-auto flex h-full max-w-5xl flex-col gap-5 p-6">
        {notice && <div className="rounded-xl bg-gold/15 px-4 py-2 text-sm text-gold">{notice}</div>}
        {open && tempOpen && (
          <div className="rounded-xl bg-gold/15 px-4 py-2 text-sm text-gold">
            선생님이 배틀을 임시로 열어 두었어요. 임시 공개가 끝나면 자리연습을 모두 통과해야 들어올 수 있어요.
          </div>
        )}

        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-black">⚔️ 배틀 모드</h1>
          {open && enUnlocked && (
            <div className="flex rounded-xl bg-white/10 p-1" title="← → 로 바꾸기">
              {(['ko', 'en'] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLangPick(l)}
                  className={`rounded-lg px-4 py-1.5 text-sm font-bold transition ${
                    lang === l ? 'bg-mint-500 text-white' : 'text-white/60 hover:text-white'
                  }`}
                >
                  {LANG_LABEL[l]}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-5 gap-5">
          {/* 왼쪽: 내 계급 + 입장 */}
          <div className="col-span-3 flex min-h-0 flex-col gap-5 overflow-auto">
            {classOpen && (
              <button
                onClick={() => void joinClass()}
                disabled={joining}
                className="flex shrink-0 items-center justify-between rounded-2xl bg-gold px-6 py-5 text-left text-ink shadow-lg ring-4 ring-gold/30 transition hover:brightness-105 disabled:opacity-60"
              >
                <div>
                  <div className="text-3xl font-black">{joining ? '입장하는 중...' : '🏫 학급 배틀'}</div>
                  <div className="mt-1 text-sm font-bold opacity-80">
                    {student.grade}학년 {student.classNo}반 모두 함께 · {classSec / 60}분 · 반 총점 기록
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs font-bold opacity-80">
                  <Kbd>K</Kbd>
                  {!open && (
                    <>
                      {' '}
                      <Kbd>Enter</Kbd>
                    </>
                  )}
                </div>
              </button>
            )}
            <div className="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
              <div className="flex items-center justify-between">
                <div className="text-sm text-white/60">내 계급</div>
                <TierBadge tier={tier} large />
              </div>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${tp.ratio * 100}%` }} />
              </div>
              <div className="mt-2 text-sm text-white/60 tabular-nums">
                {tp.next === null ? `RP ${student.rp} · 최고 계급입니다!` : `RP ${student.rp} / ${tp.next} · 다음 계급까지 ${tp.next - student.rp}`}
              </div>
              <div className="mt-1 text-xs text-white/40">
                {student.games}전 {student.wins}승
              </div>
            </div>

            <button
              onClick={() => void join()}
              disabled={joining || !open}
              className="flex min-h-28 flex-1 flex-col items-center justify-center rounded-2xl bg-mint-500 text-white shadow-lg transition hover:bg-mint-600 disabled:opacity-60"
            >
              <div className="text-4xl font-black">{joining ? '입장하는 중...' : '⚔️ 친구와 배틀'}</div>
              <div className="mt-2 text-sm opacity-90">
                {open ? (
                  <>
                    {tp.name} · {LANG_LABEL[lang]} 방 <Kbd>Enter</Kbd>
                  </>
                ) : (
                  '일반 배틀은 지금 열려 있지 않아요'
                )}
              </div>
            </button>
            {error && <div className="text-center text-sm text-miss">{error}</div>}

            <button
              onClick={solo}
              disabled={joining || !open}
              className="flex items-center justify-between rounded-2xl bg-white/10 px-6 py-4 text-left ring-1 ring-white/15 transition hover:bg-white/15 disabled:opacity-60"
            >
              <div>
                <div className="text-xl font-black">🤖 컴퓨터와 대결</div>
                <div className="mt-1 text-xs text-white/60">친구가 없을 때 연습하세요. 계급 포인트(RP)는 절반만 받습니다.</div>
              </div>
              <div className="shrink-0 text-right text-xs text-white/60">
                <div>
                  {student.solo?.games ?? 0}전 {student.solo?.wins ?? 0}승 · 수준{' '}
                  <b className="text-gold">{(student.solo?.level ?? 0) > 0 ? `+${student.solo?.level}` : (student.solo?.level ?? 0)}</b>
                </div>
                <div className="mt-1">
                  <Kbd>C</Kbd>
                </div>
              </div>
            </button>
          </div>

          {/* 오른쪽: 방 현황 + 규칙 */}
          <div className="col-span-2 flex min-h-0 flex-col gap-5">
            <div className="flex min-h-0 flex-1 flex-col rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
              <div className="flex items-baseline justify-between">
                <div className="font-bold">{open ? `${tp.name} 방 현황` : '방 현황'}</div>
                <div className="text-xs text-white/50">경기 중 {playing.length}개</div>
              </div>
              <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-auto">
                {!open ? (
                  <div className="text-sm text-white/50">일반 배틀이 닫혀 있어요.</div>
                ) : rooms === null ? (
                  <div className="text-sm text-white/40">불러오는 중...</div>
                ) : waiting.length === 0 ? (
                  <div className="text-sm text-white/50">대기 중인 방이 없어요. 입장하면 새 방을 만들어요.</div>
                ) : (
                  waiting.map((r, i) => {
                    const n = Object.keys(r.players ?? {}).length;
                    return (
                      <div key={r.id} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-sm">
                        <span>대기실 {i + 1}</span>
                        <span className="font-bold tabular-nums">
                          {n} / {BATTLE_MAX_PLAYERS}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {settings.classBattle && standings.length > 0 && (
              <div className="shrink-0 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                <div className="mb-2 text-sm font-bold">🏫 반별 최고 총점</div>
                <ol className="max-h-32 space-y-1 overflow-auto text-sm">
                  {standings.map((c) => {
                    const mine = c.grade * 100 + c.classNo === myKlass;
                    return (
                      <li
                        key={`${c.grade}-${c.classNo}`}
                        className={`flex items-center gap-3 rounded-lg px-3 py-1 ${mine ? 'bg-gold font-bold text-ink' : 'bg-white/5'}`}
                      >
                        <span className="w-6 text-center tabular-nums">{c.place}</span>
                        <span className="flex-1">
                          {c.grade}학년 {c.classNo}반{mine ? ' (우리 반)' : ''}
                        </span>
                        <span className="tabular-nums">{c.best.toLocaleString()}점</span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}

            <div className="min-h-0 shrink overflow-auto rounded-2xl bg-white/5 p-5 text-sm ring-1 ring-white/10">
              <div className="mb-2 font-bold">규칙</div>
              <ul className="space-y-1 text-white/70">
                {settings.classBattle && (
                  <li>
                    · <span className="text-gold">🏫 학급 배틀</span>: 같은 반이 한 방에서 최대 {CLASS_MAX_PLAYERS}명, 반 총점이 기록돼요. 참여하면 모두 RP +10
                  </li>
                )}
                <li>· 같은 계급끼리 최대 {BATTLE_MAX_PLAYERS}명, 기본 {BATTLE_DURATION_SEC / 60}분 경기(방장이 1~5분 중에서 고름)</li>
                <li>· 낱말은 위·아래·왼쪽·오른쪽 사방에서 날아오고, 사람이 많을수록 더 많이 쏟아져요</li>
                <li>
                  · 특수 낱말 보너스: <span className="text-sky-300">⚡빠름 +1 · 👻깜빡 +2 · 🌀흔들 +1 · ★황금 2배</span>
                </li>
                <li>
                  · <span className="text-mint-300">🤝 협동 낱말</span>은 모두가 각자 쳐야 해요. 다 같이 성공하면 모두 점수 2~4배(빠를수록 높음)
                </li>
                <li>· 🔥 피버 타임 10초 동안은 점수 2배! 🌫️ 안개·🙃 거꾸로 구간도 나와요</li>
                <li>· 📖 뜻 낱말(+2)은 뜻풀이를 보고 낱말을 쳐요. 🚀 역전 찬스(+4)는 하위권에게만 보여요</li>
                <li>· 방장이 팀전(홍팀·청팀)을 고를 수 있고, 끝나면 칭호를 받아요</li>
                <li>· 오타 없이 연속 20개를 얻으면 ⚡파워 발동! 다른 참가자 점수의 절반을 가져와요</li>
                <li>
                  · <span className="text-white/50">기본자리 낱말 1점</span> · <span className="text-white">한 단어 2점</span> ·{' '}
                  <span className="text-gold">두 단어 4점</span>
                </li>
                <li>· 점수가 높은 낱말일수록 빨리 떨어져요</li>
                <li>· 같은 낱말은 먼저 친 사람이 득점</li>
                <li>· Space 나 Enter 로 제출, 틀리면 0.5초 멈춤</li>
                {!!settings.freezePhrase && (
                  <li>
                    · <span className="text-sky-300">멈추기</span>: 선생님이 알려 준 문장을 치면 {settings.freezeSeconds ?? 5}초 동안 나만 칠 수 있어요(한 판에 한 번)
                  </li>
                )}
                {settings.badWordBlock !== false && (
                  <li>
                    · <span className="text-miss">욕설을 치면</span> {settings.badWordSeconds ?? 10}초 동안 입력 금지
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>

        <label className="flex cursor-pointer items-center justify-center gap-2 text-sm text-white/70">
          <input
            type="checkbox"
            className="h-4 w-4 accent-mint-500"
            checked={sound && settings.soundAllowed}
            disabled={!settings.soundAllowed}
            onChange={(e) => {
              setPrefs({ sound: e.target.checked });
              if (e.target.checked) window.setTimeout(() => playScore(2), 0); // 켜면 바로 들려준다
            }}
          />
          🔊 효과음 켜기 {settings.soundAllowed ? '(이어폰을 쓸 때만)' : '(선생님이 꺼 두었어요)'}
        </label>

        <div className="text-center text-xs text-white/40">
          {open && (
            <>
              <Kbd>Enter</Kbd> 친구와 배틀 · <Kbd>C</Kbd> 컴퓨터와 대결 ·{' '}
            </>
          )}
          {classOpen && (
            <>
              <Kbd>K</Kbd> 학급 배틀 ·{' '}
            </>
          )}
          <Kbd>Esc</Kbd> 홈{open && enUnlocked ? ' · ← → 한국어/ENG' : ''}
        </div>
      </div>
    </div>
  );
}
