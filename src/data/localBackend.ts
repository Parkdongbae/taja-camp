// 데모 모드 구현: localStorage 에 저장하고, storage 이벤트로 여러 탭을 실시간 동기화한다.
// 공개 API: createLocalBackend(): Backend
//
// - 인증 상태는 sessionStorage(탭마다 다른 학생으로 로그인 가능).
// - 저장소가 비어 있으면 학생 6명(1101~1106)을 만든다. PIN 은 첫 접속에서 정한다.
// - 교사: 아무 이메일 + 6자 이상 비밀번호로 가입·로그인(첫 가입자가 관리자). 초대 목록은 저장만 한다.
// - 방 변경·낱말 선점은 Web Locks API(navigator.locks)가 있으면 탭 간 잠금으로 원자성을 확보한다.
// - 탭을 닫으면(pagehide) 접속 현황에서 빠지고, 대기방에서는 나가며, 경기 중이면 online=false.
import type { Backend, Unsub } from './backend';
import {
  AppError,
  BATTLE_DURATION_SEC,
  BATTLE_MAX_PLAYERS,
  DEFAULT_SETTINGS,
  newStudent,
  type AuthUser,
  type BattlePlayer,
  type BattleRoom,
  type ContentBundle,
  type Presence,
  type SessionRecord,
  type Settings,
  type Student,
} from './types';

const P = 'taja.demo.';
const K = {
  students: P + 'students',
  secrets: P + 'secrets',
  sessions: P + 'sessions',
  teachers: P + 'teachers',
  invites: P + 'invites',
  settings: P + 'settings',
  content: P + 'content',
  presence: P + 'presence',
  rooms: P + 'rooms',
} as const;
const AUTH_KEY = P + 'auth';
const HOUR = 60 * 60 * 1000;
const PRESENCE_TTL = 30_000;
const BEAT_MS = 10_000;
const MAX_SESSIONS = 5000;

const DEMO_STUDENTS: [string, string][] = [
  ['1101', '김민준'],
  ['1102', '이서연'],
  ['1103', '박지호'],
  ['1104', '최하은'],
  ['1105', '정도윤'],
  ['1106', '강지우'],
];

interface TeacherRec {
  uid: string;
  pwHash: string;
  owner: boolean;
}
interface PresenceRec {
  p: Presence;
  tab: string;
  beat: number;
}

// ───────── 저장소 도우미 ─────────

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}
function pick(get: () => Storage): Storage {
  try {
    const s = get();
    const t = '__taja_test__';
    s.setItem(t, '1');
    s.removeItem(t);
    return s;
  } catch {
    return memoryStorage();
  }
}

async function sha256Hex(s: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // 보안 맥락이 아니면(http) 간단한 대체 해시(데모 전용)
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

function randomId(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function random32(): number {
  if (typeof globalThis.crypto?.getRandomValues === 'function') return crypto.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 2 ** 32);
}

/** JSON 직렬화 가능한 값으로 정리(undefined 제거) */
function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

// ───────── 구현 ─────────

export function createLocalBackend(): Backend {
  const hasWindow = typeof window !== 'undefined';
  const ls = pick(() => window.localStorage);
  const ss = pick(() => window.sessionStorage);
  const tab = randomId('tab-');

  // ── 변경 알림 ──
  const listeners = new Map<string, Set<() => void>>();
  function on(key: string, fn: () => void): Unsub {
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }
  function notify(key: string) {
    for (const fn of [...(listeners.get(key) ?? [])]) {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }
  }
  if (hasWindow) {
    // 다른 탭에서 localStorage 를 바꾸면 storage 이벤트가 온다
    window.addEventListener('storage', (e) => {
      if (e.storageArea && e.storageArea !== window.localStorage) return;
      if (e.key === null) for (const k of listeners.keys()) notify(k);
      else if (listeners.has(e.key)) notify(e.key);
    });
  }

  function read<T>(key: string, fallback: T): T {
    try {
      const s = ls.getItem(key);
      return s ? (JSON.parse(s) as T) : fallback;
    } catch {
      return fallback;
    }
  }
  function write(key: string, val: unknown) {
    try {
      if (val === undefined || val === null) ls.removeItem(key);
      else ls.setItem(key, JSON.stringify(val));
    } catch {
      throw new AppError('UNKNOWN', '브라우저 저장 공간이 부족합니다.');
    }
    notify(key);
  }

  /** 값이 바뀌었을 때만 cb 를 부르는 구독 */
  function watch<T>(keys: string[], compute: () => T, cb: (v: T) => void, pollMs = 0): Unsub {
    let last = '\u0000';
    let closed = false;
    const fire = () => {
      if (closed) return;
      const v = compute();
      const s = JSON.stringify(v) ?? 'null';
      if (s === last) return;
      last = s;
      cb(v);
    };
    const offs = keys.map((k) => on(k, fire));
    const timer = pollMs && hasWindow ? window.setInterval(fire, pollMs) : 0;
    queueMicrotask(fire);
    return () => {
      closed = true;
      offs.forEach((f) => f());
      if (timer) window.clearInterval(timer);
    };
  }

  // ── 데모 학생 만들기 ──
  if (ls.getItem(K.students) === null) {
    const init: Record<string, Student> = {};
    for (const [id, name] of DEMO_STUDENTS) init[id] = newStudent(id, name);
    try {
      ls.setItem(K.students, JSON.stringify(init));
    } catch {
      // 무시
    }
  }

  const students = () => read<Record<string, Student>>(K.students, {});
  const rooms = () => read<Record<string, BattleRoom>>(K.rooms, {});

  // ── 인증 ──
  const authCbs = new Set<(u: AuthUser | null) => void>();
  function getAuth(): AuthUser | null {
    try {
      const s = ss.getItem(AUTH_KEY);
      return s ? (JSON.parse(s) as AuthUser) : null;
    } catch {
      return null;
    }
  }
  /** 저장된 인증이 아직 유효한지(학생 삭제·교사 삭제 반영) */
  function validAuth(): AuthUser | null {
    const u = getAuth();
    if (!u) return null;
    if (u.role === 'student') return students()[u.studentId] ? u : null;
    const t = read<Record<string, TeacherRec>>(K.teachers, {})[u.email];
    return t ? { ...u, isOwner: t.owner } : null;
  }
  let lastAuthJson = JSON.stringify(validAuth());
  function setAuth(u: AuthUser | null) {
    try {
      if (u) ss.setItem(AUTH_KEY, JSON.stringify(u));
      else ss.removeItem(AUTH_KEY);
    } catch {
      // 무시
    }
    emitAuth();
  }
  function emitAuth() {
    const u = validAuth();
    if (!u && getAuth()) {
      try {
        ss.removeItem(AUTH_KEY);
      } catch {
        // 무시
      }
    }
    const j = JSON.stringify(u);
    if (j === lastAuthJson) return;
    lastAuthJson = j;
    for (const cb of [...authCbs]) cb(u);
  }
  on(K.students, emitAuth);
  on(K.teachers, emitAuth);

  function me(): AuthUser | null {
    return validAuth();
  }
  function requireTeacher(): Extract<AuthUser, { role: 'teacher' }> {
    const u = me();
    if (!u || u.role !== 'teacher') throw new AppError('PERMISSION', '교사만 할 수 있습니다.');
    return u;
  }
  function requireOwner() {
    const u = requireTeacher();
    if (!u.isOwner) throw new AppError('PERMISSION', '관리자만 할 수 있습니다.');
    return u;
  }
  function requireSignedIn() {
    if (!me()) throw new AppError('PERMISSION', '로그인이 필요합니다.');
  }

  // ── 잠금(탭 간 원자성) ──
  async function withLock<T>(name: string, fn: () => T): Promise<T> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (locks?.request) return locks.request(name, async () => fn());
    return fn();
  }
  function mutateRooms<T>(fn: (rs: Record<string, BattleRoom>) => T): T {
    const rs = rooms();
    const out = fn(rs);
    write(K.rooms, rs);
    return out;
  }
  const roomLock = <T>(fn: (rs: Record<string, BattleRoom>) => T) => withLock('taja-demo-rooms', () => mutateRooms(fn));

  function purgeRooms(rs: Record<string, BattleRoom>) {
    const now = Date.now();
    for (const [id, r] of Object.entries(rs)) {
      const empty = r.state === 'waiting' && Object.keys(r.players ?? {}).length === 0;
      if (now - r.createdAt > HOUR || empty) delete rs[id];
    }
  }

  /** 대기방에서 빼거나(방장 이양·빈 방 삭제), 경기 중이면 online=false */
  function leaveIn(rs: Record<string, BattleRoom>, roomId: string, playerId: string) {
    const r = rs[roomId];
    if (!r || !r.players?.[playerId]) return;
    if (r.state === 'waiting') {
      delete r.players[playerId];
      const rest = Object.values(r.players).sort((a, b) => a.joinedAt - b.joinedAt);
      if (!rest.length) delete rs[roomId];
      else if (r.host === playerId || !r.players[r.host]) r.host = rest[0].id;
    } else {
      r.players[playerId] = { ...r.players[playerId], online: false };
    }
  }

  // ── 접속 현황 ──
  let presenceCur: Presence | null = null;
  function writePresence() {
    const all = read<Record<string, PresenceRec>>(K.presence, {});
    const now = Date.now();
    for (const [sid, rec] of Object.entries(all)) {
      if (rec.tab === tab || now - rec.beat > PRESENCE_TTL) delete all[sid];
    }
    if (presenceCur) all[presenceCur.studentId] = { p: { ...presenceCur, at: now }, tab, beat: now };
    write(K.presence, all);
  }
  if (hasWindow) {
    window.setInterval(() => {
      if (presenceCur) writePresence();
    }, BEAT_MS);
  }

  // ── 탭 닫힘 처리 ──
  const myRooms = new Map<string, string>(); // roomId → playerId
  if (hasWindow) {
    window.addEventListener('pagehide', () => {
      try {
        if (presenceCur) {
          presenceCur = null;
          writePresence();
        }
        if (myRooms.size) {
          // pagehide 에서는 비동기 잠금을 기다릴 수 없으므로 바로 쓴다
          mutateRooms((rs) => {
            for (const [roomId, pid] of myRooms) leaveIn(rs, roomId, pid);
          });
          myRooms.clear();
        }
      } catch {
        // 무시
      }
    });
  }

  const backend: Backend = {
    mode: 'local',

    // ── 인증 ──
    onAuth(cb) {
      let active = true;
      const wrapped = (u: AuthUser | null) => {
        if (active) cb(u);
      };
      authCbs.add(wrapped);
      queueMicrotask(() => wrapped(validAuth()));
      return () => {
        active = false;
        authCbs.delete(wrapped);
      };
    },

    async studentLogin(id, name, pin) {
      const sid = id.trim();
      const s = students()[sid];
      const secrets = read<Record<string, string>>(K.secrets, {});
      const hash = await sha256Hex(`taja:${sid}:${pin}`);
      if (!s || s.name !== name.trim() || !secrets[sid] || secrets[sid] !== hash) {
        throw new AppError('LOGIN_FAILED', '학번·이름·PIN 을 확인해 주세요.');
      }
      const all = students();
      all[sid] = { ...all[sid], lastLoginAt: Date.now() };
      write(K.students, all);
      setAuth({ role: 'student', studentId: sid });
    },

    async studentFirstLogin(id, name, pin) {
      const sid = id.trim();
      const s = students()[sid];
      if (!s || s.name !== name.trim()) throw new AppError('LOGIN_FAILED', '학번과 이름을 확인해 주세요.');
      const hash = await sha256Hex(`taja:${sid}:${pin}`);
      await withLock('taja-demo-secrets', () => {
        const secrets = read<Record<string, string>>(K.secrets, {});
        if (secrets[sid]) throw new AppError('PIN_ALREADY_SET', '이미 PIN 을 정했습니다. 로그인해 주세요.');
        secrets[sid] = hash;
        write(K.secrets, secrets);
      });
      const all = students();
      if (all[sid]) {
        all[sid] = { ...all[sid], lastLoginAt: Date.now() };
        write(K.students, all);
      }
      setAuth({ role: 'student', studentId: sid });
    },

    async teacherLogin(email, password) {
      const key = email.trim().toLowerCase();
      if (!key.includes('@') || password.length < 6) {
        throw new AppError('LOGIN_FAILED', '이메일 또는 비밀번호가 맞지 않습니다.');
      }
      const teachers = read<Record<string, TeacherRec>>(K.teachers, {});
      const t = teachers[key];
      if (!t) return backend.teacherSignup(email, password); // 데모: 처음 보는 이메일은 바로 가입
      if (t.pwHash !== (await sha256Hex(`taja-demo:${key}:${password}`))) {
        throw new AppError('LOGIN_FAILED', '이메일 또는 비밀번호가 맞지 않습니다.');
      }
      setAuth({ role: 'teacher', uid: t.uid, email: key, isOwner: t.owner });
    },

    async teacherSignup(email, password) {
      const key = email.trim().toLowerCase();
      if (!key.includes('@')) throw new AppError('LOGIN_FAILED', '이메일 형식이 아닙니다.');
      if (password.length < 6) throw new AppError('LOGIN_FAILED', '비밀번호는 6자 이상이어야 합니다.');
      const pwHash = await sha256Hex(`taja-demo:${key}:${password}`);
      const rec = await withLock('taja-demo-teachers', () => {
        const teachers = read<Record<string, TeacherRec>>(K.teachers, {});
        if (teachers[key]) throw new AppError('LOGIN_FAILED', '이미 가입된 이메일입니다. 로그인해 주세요.');
        const owner = Object.keys(teachers).length === 0;
        const r: TeacherRec = { uid: randomId('t-'), pwHash, owner };
        teachers[key] = r;
        write(K.teachers, teachers);
        return r;
      });
      setAuth({ role: 'teacher', uid: rec.uid, email: key, isOwner: rec.owner });
    },

    async logout() {
      backend.setPresence(null);
      if (myRooms.size) {
        await roomLock((rs) => {
          for (const [roomId, pid] of myRooms) leaveIn(rs, roomId, pid);
        });
        myRooms.clear();
      }
      setAuth(null);
    },

    // ── 학생 데이터 ──
    watchStudent(id, cb) {
      return watch([K.students], () => students()[id] ?? null, cb);
    },

    async updateStudent(id, patch) {
      const u = me();
      if (!u || (u.role === 'student' && u.studentId !== id)) throw new AppError('PERMISSION', '권한이 없습니다.');
      const p = clone(patch) as Partial<Student>;
      for (const k of ['id', 'name', 'grade', 'classNo', 'number', 'createdAt'] as const) delete p[k];
      const all = students();
      if (!all[id]) throw new AppError('PERMISSION', '학생이 없습니다.');
      all[id] = { ...all[id], ...p };
      write(K.students, all);
    },

    async addSession(rec) {
      const u = me();
      if (!u || u.role !== 'student' || u.studentId !== rec.studentId) throw new AppError('PERMISSION', '권한이 없습니다.');
      await withLock('taja-demo-sessions', () => {
        const list = read<SessionRecord[]>(K.sessions, []);
        list.push(clone({ ...rec, id: randomId('s-') }));
        if (list.length > MAX_SESSIONS) list.splice(0, list.length - MAX_SESSIONS);
        write(K.sessions, list);
      });
    },

    async listSessions(studentId, max) {
      requireSignedIn();
      return read<SessionRecord[]>(K.sessions, [])
        .filter((s) => s.studentId === studentId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, max);
    },

    async listStudents() {
      requireSignedIn();
      return Object.values(students()).sort((a, b) => a.id.localeCompare(b.id));
    },

    // ── 교사 전용 ──
    async addStudents(list) {
      requireTeacher();
      const all = students();
      for (const it of list) {
        const sid = String(it.id).trim();
        const nm = String(it.name).trim();
        if (!/^[0-9]{4}$/.test(sid) || !nm) continue;
        all[sid] = all[sid] ? { ...all[sid], name: nm } : newStudent(sid, nm);
      }
      write(K.students, all);
    },

    async deleteStudent(id) {
      requireTeacher();
      const all = students();
      delete all[id];
      write(K.students, all);
      const secrets = read<Record<string, string>>(K.secrets, {});
      delete secrets[id];
      write(K.secrets, secrets);
      await withLock('taja-demo-sessions', () => {
        write(
          K.sessions,
          read<SessionRecord[]>(K.sessions, []).filter((s) => s.studentId !== id),
        );
      });
      const pres = read<Record<string, PresenceRec>>(K.presence, {});
      if (pres[id]) {
        delete pres[id];
        write(K.presence, pres);
      }
    },

    async resetPin(id) {
      requireTeacher();
      const secrets = read<Record<string, string>>(K.secrets, {});
      delete secrets[id];
      write(K.secrets, secrets);
    },

    async teacherUpdateStudent(id, patch) {
      requireTeacher();
      const all = students();
      if (!all[id]) throw new AppError('PERMISSION', '학생이 없습니다.');
      const p = clone(patch) as Partial<Student>;
      delete p.id;
      all[id] = { ...all[id], ...p };
      write(K.students, all);
    },

    async listTeacherInvites() {
      requireTeacher();
      return Object.keys(read<Record<string, unknown>>(K.invites, {})).sort();
    },

    async inviteTeacher(email) {
      const u = requireOwner();
      const key = email.trim().toLowerCase();
      if (!key.includes('@')) throw new AppError('UNKNOWN', '이메일 형식이 아닙니다.');
      const inv = read<Record<string, { by: string; at: number }>>(K.invites, {});
      inv[key] = { by: u.email, at: Date.now() };
      write(K.invites, inv);
    },

    async removeTeacherInvite(email) {
      requireOwner();
      const key = email.trim().toLowerCase();
      const inv = read<Record<string, unknown>>(K.invites, {});
      delete inv[key];
      write(K.invites, inv);
      const teachers = read<Record<string, TeacherRec>>(K.teachers, {});
      if (teachers[key] && !teachers[key].owner) {
        delete teachers[key];
        write(K.teachers, teachers);
      }
    },

    async listRecentSessions(max) {
      requireTeacher();
      return read<SessionRecord[]>(K.sessions, [])
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, max);
    },

    // ── 설정·콘텐츠 ──
    watchSettings(cb) {
      return watch([K.settings], () => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(K.settings, {}) }), cb);
    },

    async updateSettings(patch) {
      requireTeacher();
      write(K.settings, { ...read<Partial<Settings>>(K.settings, {}), ...clone(patch) });
    },

    async getContent() {
      return read<ContentBundle | null>(K.content, null);
    },

    async uploadContent(bundle) {
      requireTeacher();
      write(K.content, bundle);
    },

    // ── 접속 현황 ──
    setPresence(p) {
      presenceCur = p ? { ...p } : null;
      try {
        writePresence();
      } catch {
        // 무시
      }
    },

    watchPresence(cb) {
      return watch(
        [K.presence],
        () => {
          const now = Date.now();
          return Object.values(read<Record<string, PresenceRec>>(K.presence, {}))
            .filter((r) => now - r.beat <= PRESENCE_TTL)
            .map((r) => r.p)
            .sort((a, b) => a.studentId.localeCompare(b.studentId));
        },
        cb,
        BEAT_MS,
      );
    },

    // ── 배틀 ──
    serverNow() {
      return Date.now(); // 같은 PC 의 탭끼리는 시계가 같다
    },

    watchRooms(tier, lang, cb) {
      return watch(
        [K.rooms],
        () => {
          const now = Date.now();
          return Object.values(rooms())
            .filter(
              (r) =>
                r.tier === tier &&
                r.lang === lang &&
                now - r.createdAt <= HOUR &&
                !(r.state === 'waiting' && Object.keys(r.players ?? {}).length === 0),
            )
            .sort((a, b) => a.createdAt - b.createdAt);
        },
        cb,
        60_000,
      );
    },

    async joinOrCreateRoom(tier, lang, meP) {
      const player: BattlePlayer = clone({ ...meP, joinedAt: Date.now(), online: true });
      const id = await roomLock((rs) => {
        purgeRooms(rs);
        const candidates = Object.values(rs)
          .filter(
            (r) =>
              r.tier === tier &&
              r.lang === lang &&
              r.state === 'waiting' &&
              (Object.keys(r.players).length < BATTLE_MAX_PLAYERS || !!r.players[meP.id]),
          )
          .sort((a, b) => Number(!!b.players[meP.id]) - Number(!!a.players[meP.id]) || a.createdAt - b.createdAt);
        const r = candidates[0];
        if (r) {
          r.players[meP.id] = r.players[meP.id] ? { ...r.players[meP.id], online: true } : player;
          if (!r.players[r.host]) r.host = meP.id;
          return r.id;
        }
        const nid = randomId('room-');
        rs[nid] = {
          id: nid,
          tier,
          lang,
          host: meP.id,
          state: 'waiting',
          seed: 0,
          startAt: 0,
          durationSec: BATTLE_DURATION_SEC,
          startCount: 0,
          createdAt: Date.now(),
          players: { [meP.id]: player },
          claims: {},
        };
        return nid;
      });
      myRooms.set(id, meP.id);
      return id;
    },

    async leaveRoom(roomId, playerId) {
      myRooms.delete(roomId);
      await roomLock((rs) => leaveIn(rs, roomId, playerId));
    },

    watchRoom(roomId, cb) {
      return watch([K.rooms], () => rooms()[roomId] ?? null, cb);
    },

    async startRoom(roomId) {
      const u = me();
      const myId = u && u.role === 'student' ? u.studentId : null;
      await roomLock((rs) => {
        const r = rs[roomId];
        if (!r) throw new AppError('ROOM_GONE', '방이 사라졌습니다.');
        if (r.state !== 'waiting') return;
        if (r.host !== myId) throw new AppError('PERMISSION', '방장만 시작할 수 있습니다.');
        r.state = 'playing';
        r.seed = random32();
        r.startAt = Date.now() + 5000;
        r.startCount = Object.values(r.players).filter((p) => p.online !== false).length;
      });
    },

    async claimWord(roomId, wordIndex, playerId) {
      try {
        return await roomLock((rs) => {
          const r = rs[roomId];
          if (!r || r.state !== 'playing') return false;
          r.claims = r.claims ?? {};
          const k = String(wordIndex);
          if (!r.claims[k]) r.claims[k] = { by: playerId, at: Date.now() };
          return r.claims[k].by === playerId;
        });
      } catch {
        return false;
      }
    },

    async finishRoom(roomId) {
      await roomLock((rs) => {
        const r = rs[roomId];
        if (r && r.state !== 'done') r.state = 'done';
      }).catch(() => undefined);
    },
  };

  return backend;
}
