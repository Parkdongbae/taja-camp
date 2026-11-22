// Firebase 구현 (서버 함수 없이 보안 규칙만으로 권한을 강제한다).
// 공개 API: createFirebaseBackend(config): Backend, FirebaseConfig
//
// - firebase 모듈은 동적 import 로 불러오고, backend 객체는 즉시(동기) 쓸 수 있다.
//   모든 메서드는 내부 준비 Promise(ready)를 기다린 뒤 실행된다.
// - Firestore: students, secrets(읽기 불가), links/{uid}(익명 uid → 학번), probes/{uid}(PIN 설정 여부 확인용),
//   teachers, config/owner, invites, sessions, settings/global, content/{meta|partN}
// - Realtime Database: presence/{sid}, rooms/{roomId}
// - 규칙 파일: 프로젝트 루트 firestore.rules, database.rules.json
import type { FirebaseApp } from 'firebase/app';
import type { Auth, User } from 'firebase/auth';
import type { Firestore, WriteBatch } from 'firebase/firestore';
import type { Database, DatabaseReference } from 'firebase/database';
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
  type Lang,
  type Presence,
  type SessionRecord,
  type Settings,
  type Student,
} from './types';

export interface FirebaseConfig {
  apiKey: string;
  authDomain?: string;
  projectId?: string;
  databaseURL?: string;
  appId?: string;
}

type AuthMod = typeof import('firebase/auth');
type FsMod = typeof import('firebase/firestore');
type DbMod = typeof import('firebase/database');

interface Fb {
  app: FirebaseApp;
  A: AuthMod;
  F: FsMod;
  D: DbMod;
  auth: Auth;
  fs: Firestore;
  db: Database;
}

const HOUR = 60 * 60 * 1000;
const CHUNK_CHARS = 230_000; // 한글 3바이트 × 23만 ≈ 690KB (문서당 700KB 이하)
const CACHE_STAMP = 'taja.contentCache.stamp';
const CACHE_DATA = 'taja.contentCache.data';
const BATCH_MAX = 450;

// ───────── 공용 도우미 ─────────

/** undefined 필드를 깊게 제거(Firestore·RTDB 는 undefined 를 거부한다). */
function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.filter((x) => x !== undefined).map(clean) as unknown as T;
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (x !== undefined) o[k] = clean(x);
    }
    return o as T;
  }
  return v;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function pinHashOf(sid: string, pin: string): Promise<string> {
  return sha256Hex(`taja:${sid}:${pin}`);
}

/** Firebase 오류 → AppError */
function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const err = e as { code?: unknown; message?: unknown } | null;
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? '');
  switch (code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
    case 'auth/missing-password':
      return new AppError('LOGIN_FAILED', '이메일 또는 비밀번호가 맞지 않습니다.');
    case 'auth/email-already-in-use':
      return new AppError('LOGIN_FAILED', '이미 가입된 이메일입니다. 로그인해 주세요.');
    case 'auth/weak-password':
      return new AppError('LOGIN_FAILED', '비밀번호는 6자 이상이어야 합니다.');
    case 'auth/too-many-requests':
      return new AppError('LOGIN_FAILED', '시도가 너무 많습니다. 잠시 후 다시 해 주세요.');
    case 'auth/operation-not-allowed':
    case 'auth/admin-restricted-operation':
      return new AppError('UNKNOWN', 'Firebase 콘솔에서 해당 로그인 방법(익명/이메일)을 켜야 합니다.');
    case 'auth/network-request-failed':
    case 'unavailable':
    case 'deadline-exceeded':
      return new AppError('NETWORK', '네트워크 연결을 확인해 주세요.');
    case 'permission-denied':
    case 'unauthenticated':
      return new AppError('PERMISSION', '권한이 없습니다.');
  }
  if (/permission[_ -]?denied/i.test(code + ' ' + msg)) return new AppError('PERMISSION', '권한이 없습니다.');
  if (/network|offline|failed to fetch|disconnect/i.test(msg)) return new AppError('NETWORK', '네트워크 연결을 확인해 주세요.');
  return new AppError('UNKNOWN', msg || code || '알 수 없는 오류');
}

/** 문자열을 조각으로 나눈다(서로게이트 쌍은 쪼개지 않음). */
function splitChunks(s: string, size = CHUNK_CHARS): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    let end = Math.min(i + size, s.length);
    const c = s.charCodeAt(end - 1);
    if (end < s.length && c >= 0xd800 && c <= 0xdbff) end--;
    out.push(s.slice(i, end));
    i = end;
  }
  return out.length ? out : [''];
}

/** RTDB 가 배열로 돌려준 값까지 객체로 정리 */
function objOf<T>(x: unknown): Record<string, T> {
  if (!x || typeof x !== 'object') return {};
  if (Array.isArray(x)) {
    const o: Record<string, T> = {};
    x.forEach((v, i) => {
      if (v != null) o[String(i)] = v as T;
    });
    return o;
  }
  return { ...(x as Record<string, T>) };
}

function toRoom(id: string, v: unknown): BattleRoom | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (r.state !== 'waiting' && r.state !== 'playing' && r.state !== 'done') return null;
  return {
    id,
    tier: Number(r.tier) || 0,
    lang: r.lang === 'en' ? 'en' : 'ko',
    host: String(r.host ?? ''),
    state: r.state,
    seed: Number(r.seed) || 0,
    startAt: Number(r.startAt) || 0,
    durationSec: Number(r.durationSec) || BATTLE_DURATION_SEC,
    startCount: Number(r.startCount) || 0,
    createdAt: Number(r.createdAt) || 0,
    players: objOf<BattlePlayer>(r.players),
    claims: objOf<{ by: string; at: number }>(r.claims),
  };
}

function toStudent(id: string, data: Record<string, unknown>): Student {
  const base = newStudent(id, String(data.name ?? ''));
  return { ...base, ...(data as Partial<Student>), id };
}

function random32(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

// ───────── 구현 ─────────

export function createFirebaseBackend(config: FirebaseConfig): Backend {
  const ready: Promise<Fb> = (async () => {
    const [appM, A, F, D] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
      import('firebase/database'),
    ]);
    const app = appM.initializeApp(clean({ ...config }));
    return { app, A, F, D, auth: A.getAuth(app), fs: F.getFirestore(app), db: D.getDatabase(app) };
  })();

  // ── 서버 시각 ──
  let serverOffset = 0;

  // ── 인증 상태 ──
  let authUser: AuthUser | null | undefined = undefined; // undefined = 아직 모름
  const authCbs = new Set<(u: AuthUser | null) => void>();
  let busy = 0; // 로그인 흐름 진행 중에는 중간 상태를 내보내지 않는다
  let evalSeq = 0;

  function setAuth(next: AuthUser | null) {
    const changed = authUser === undefined || JSON.stringify(next) !== JSON.stringify(authUser);
    authUser = next;
    if (!changed) return;
    for (const cb of [...authCbs]) {
      try {
        cb(next);
      } catch (e) {
        console.error(e);
      }
    }
  }

  async function evaluate(fb: Fb, user: User | null): Promise<AuthUser | null> {
    if (!user) return null;
    const { F, fs } = fb;
    try {
      if (user.isAnonymous) {
        const s = await F.getDoc(F.doc(fs, 'links', user.uid));
        const sid = s.exists() ? s.data().sid : null;
        return typeof sid === 'string' ? { role: 'student', studentId: sid } : null;
      }
      const t = await F.getDoc(F.doc(fs, 'teachers', user.uid));
      if (!t.exists()) return null;
      const d = t.data();
      return { role: 'teacher', uid: user.uid, email: user.email ?? String(d.email ?? ''), isOwner: d.owner === true };
    } catch {
      return null;
    }
  }

  async function refresh(): Promise<void> {
    const fb = await ready;
    const seq = ++evalSeq;
    const next = await evaluate(fb, fb.auth.currentUser);
    if (seq === evalSeq) setAuth(next);
  }

  ready.then(
    (fb) => {
      fb.A.onAuthStateChanged(fb.auth, (user) => {
        if (busy) return;
        const seq = ++evalSeq;
        evaluate(fb, user).then((next) => {
          if (seq === evalSeq && !busy) setAuth(next);
        });
      });
      fb.D.onValue(fb.D.ref(fb.db, '.info/serverTimeOffset'), (s) => {
        serverOffset = Number(s.val()) || 0;
      });
      fb.D.onValue(fb.D.ref(fb.db, '.info/connected'), (s) => {
        if (s.val() === true) rearmAll(fb);
      });
    },
    (e) => {
      console.error('Firebase 초기화 실패', e);
      setAuth(null);
    },
  );

  /** 로그인 흐름: 중간 인증 이벤트를 막고, 끝나면 상태를 다시 계산한다. */
  async function flow<T>(fn: (fb: Fb) => Promise<T>): Promise<T> {
    let fb: Fb;
    try {
      fb = await ready;
    } catch (e) {
      throw new AppError('NETWORK', 'Firebase 를 불러오지 못했습니다.');
    }
    busy++;
    try {
      return await fn(fb);
    } catch (e) {
      throw toAppError(e);
    } finally {
      busy--;
      await refresh().catch(() => undefined);
    }
  }

  /** 일반 작업: 준비를 기다리고 오류를 변환 */
  async function run<T>(fn: (fb: Fb) => Promise<T>): Promise<T> {
    try {
      return await fn(await ready);
    } catch (e) {
      throw toAppError(e);
    }
  }

  function myStudentId(): string | null {
    return authUser && authUser.role === 'student' ? authUser.studentId : null;
  }
  function requireTeacher(): Extract<AuthUser, { role: 'teacher' }> {
    if (!authUser || authUser.role !== 'teacher') throw new AppError('PERMISSION', '교사만 할 수 있습니다.');
    return authUser;
  }

  /**
   * 로그인 상태가 있을 때만 구독하고, 로그인 상태가 바뀌면 다시 구독한다.
   * (보안 규칙상 로그인 전에는 읽을 수 없으므로)
   */
  function authedSub(start: (fb: Fb) => Unsub, onSignedOut?: () => void): Unsub {
    let inner: Unsub | null = null;
    let closed = false;
    let gen = 0;
    const handle = (u: AuthUser | null) => {
      inner?.();
      inner = null;
      const my = ++gen;
      if (closed) return;
      if (!u) {
        onSignedOut?.();
        return;
      }
      ready.then((fb) => {
        if (!closed && my === gen) inner = start(fb);
      }, () => onSignedOut?.());
    };
    authCbs.add(handle);
    if (authUser !== undefined) handle(authUser);
    return () => {
      closed = true;
      authCbs.delete(handle);
      inner?.();
      inner = null;
    };
  }

  /** 익명 학생 계정 정리(링크 삭제 + 계정 삭제), 그 밖의 사용자는 로그아웃 */
  async function dropCurrentUser(fb: Fb): Promise<void> {
    const { A, F, fs, auth } = fb;
    const u = auth.currentUser;
    if (!u) return;
    if (u.isAnonymous) {
      await F.deleteDoc(F.doc(fs, 'links', u.uid)).catch(() => undefined);
      try {
        await A.deleteUser(u);
        return;
      } catch {
        // 삭제 실패 시 로그아웃만
      }
    }
    await A.signOut(auth).catch(() => undefined);
  }

  async function signInStudentAnon(fb: Fb): Promise<User> {
    await presenceOff(fb);
    await dropCurrentUser(fb);
    // 공용 PC 를 고려해 학생은 탭(세션) 단위로만 로그인 유지
    await fb.A.setPersistence(fb.auth, fb.A.browserSessionPersistence);
    const cred = await fb.A.signInAnonymously(fb.auth);
    return cred.user;
  }

  async function afterStudentLogin(fb: Fb, sid: string) {
    await fb.F.updateDoc(fb.F.doc(fb.fs, 'students', sid), { lastLoginAt: Date.now() }).catch(() => undefined);
  }

  /** teachers/{uid} 가 없으면 owner 또는 초대 조건으로 등록을 시도한다. 성공하면 true. */
  async function ensureTeacherDoc(fb: Fb, user: User): Promise<boolean> {
    const { F, fs } = fb;
    const tRef = F.doc(fs, 'teachers', user.uid);
    try {
      if ((await F.getDoc(tRef)).exists()) return true;
    } catch {
      // 계속 진행
    }
    const email = user.email ?? '';
    let ownerExists = true;
    try {
      ownerExists = (await F.getDoc(F.doc(fs, 'config', 'owner'))).exists();
    } catch {
      ownerExists = true;
    }
    if (!ownerExists) {
      try {
        const b = F.writeBatch(fs);
        b.set(F.doc(fs, 'config', 'owner'), { uid: user.uid });
        b.set(tRef, { email, owner: true });
        await b.commit();
        return true;
      } catch {
        // 다른 사람이 먼저 owner 가 됨 → 초대 경로 시도
      }
    }
    try {
      await F.setDoc(tRef, { email, owner: false });
      return true;
    } catch {
      return false;
    }
  }

  async function commitOps(fb: Fb, ops: ((b: WriteBatch) => void)[]) {
    for (let i = 0; i < ops.length; i += BATCH_MAX) {
      const b = fb.F.writeBatch(fb.fs);
      for (const op of ops.slice(i, i + BATCH_MAX)) op(b);
      await b.commit();
    }
  }

  // ── 접속 현황 ──
  let presenceCur: Presence | null = null;
  let presenceSid: string | null = null;
  let presenceChain: Promise<void> = Promise.resolve();

  function serverNow(): number {
    return Date.now() + serverOffset;
  }

  async function presenceApply(fb: Fb) {
    const { D, db } = fb;
    const p = presenceCur;
    if (presenceSid && (!p || p.studentId !== presenceSid)) {
      const old = D.ref(db, `presence/${presenceSid}`);
      await D.onDisconnect(old).cancel().catch(() => undefined);
      await D.remove(old).catch(() => undefined);
      presenceSid = null;
    }
    if (!p || !fb.auth.currentUser) return;
    const r = D.ref(db, `presence/${p.studentId}`);
    if (presenceSid !== p.studentId) {
      await D.onDisconnect(r).remove().catch(() => undefined);
      presenceSid = p.studentId;
    }
    await D.set(r, clean({ ...p, at: serverNow() })).catch(() => undefined);
  }

  function queuePresence(fb: Fb): Promise<void> {
    presenceChain = presenceChain.then(() => presenceApply(fb)).catch(() => undefined);
    return presenceChain;
  }

  function presenceOff(fb: Fb): Promise<void> {
    presenceCur = null;
    return queuePresence(fb);
  }

  // ── 배틀: 내가 들어간 방(연결 끊김 처리용) ──
  const myRooms = new Map<string, { player: BattlePlayer; mode: 'remove' | 'offline' }>();

  function playerRef(fb: Fb, roomId: string, pid: string): DatabaseReference {
    return fb.D.ref(fb.db, `rooms/${roomId}/players/${pid}`);
  }

  async function arm(fb: Fb, roomId: string, player: BattlePlayer, mode: 'remove' | 'offline') {
    const r = playerRef(fb, roomId, player.id);
    const prev = myRooms.get(roomId);
    myRooms.set(roomId, { player, mode });
    if (prev && prev.mode === mode) return;
    await fb.D.onDisconnect(r).cancel().catch(() => undefined);
    if (mode === 'remove') await fb.D.onDisconnect(r).remove().catch(() => undefined);
    else await fb.D.onDisconnect(r).update({ online: false }).catch(() => undefined);
  }

  async function disarm(fb: Fb, roomId: string, pid: string) {
    myRooms.delete(roomId);
    await fb.D.onDisconnect(playerRef(fb, roomId, pid)).cancel().catch(() => undefined);
  }

  /** 재접속 시: 접속 현황 다시 쓰기, 들어가 있던 방에 다시 표시 */
  function rearmAll(fb: Fb) {
    if (presenceCur) {
      presenceSid = null; // onDisconnect 재등록
      void queuePresence(fb);
    }
    for (const [roomId, { player, mode }] of [...myRooms]) {
      const r = fb.D.ref(fb.db, `rooms/${roomId}`);
      myRooms.delete(roomId); // arm 이 onDisconnect 를 다시 등록하도록
      if (mode === 'offline') {
        // 경기 중: online 만 되돌린다(방 전체를 다시 쓰지 않음). 방·자리가 없으면 규칙이 거부.
        fb.D.update(playerRef(fb, roomId, player.id), { online: true }).then(
          () => arm(fb, roomId, player, 'offline'),
          () => undefined,
        );
        continue;
      }
      // 대기 중: 끊길 때 빠졌으므로 다시 넣는다
      fb.D.runTransaction(r, (cur) => {
        if (cur === null) return cur;
        if (cur.state !== 'waiting') return;
        const players = objOf<BattlePlayer>(cur.players);
        if (!players[player.id] && Object.keys(players).length >= BATTLE_MAX_PLAYERS) return;
        players[player.id] = { ...player, online: true };
        if (!players[cur.host]) cur.host = player.id;
        cur.players = players;
        return cur;
      }).then(
        (res) => {
          if (res.committed && res.snapshot.child(`players/${player.id}`).exists()) {
            return arm(fb, roomId, player, 'remove');
          }
        },
        () => undefined,
      );
    }
  }

  /** 방장이 사라진 대기방이면, 남은 사람 중 가장 먼저 들어온 사람이 방장을 맡는다. */
  function maybeTakeHost(fb: Fb, room: BattleRoom) {
    const me = myStudentId();
    if (!me || room.state !== 'waiting' || room.players[room.host]) return;
    const list = Object.values(room.players).sort((a, b) => a.joinedAt - b.joinedAt);
    if (!list.length || list[0].id !== me) return;
    fb.D.runTransaction(fb.D.ref(fb.db, `rooms/${room.id}`), (cur) => {
      if (cur === null) return cur;
      const players = objOf<BattlePlayer>(cur.players);
      if (cur.state !== 'waiting' || players[cur.host] || !players[me]) return;
      cur.host = me;
      return cur;
    }).catch(() => undefined);
  }

  // ───────── Backend 객체 ─────────
  const backend: Backend = {
    mode: 'firebase',

    onAuth(cb) {
      let active = true;
      const wrapped = (u: AuthUser | null) => {
        if (active) cb(u);
      };
      authCbs.add(wrapped);
      if (authUser !== undefined) {
        const now = authUser;
        queueMicrotask(() => wrapped(now));
      }
      return () => {
        active = false;
        authCbs.delete(wrapped);
      };
    },

    studentLogin(id, name, pin) {
      const sid = id.trim();
      const nm = name.trim();
      return flow(async (fb) => {
        const user = await signInStudentAnon(fb);
        const pinHash = await pinHashOf(sid, pin);
        try {
          await fb.F.setDoc(fb.F.doc(fb.fs, 'links', user.uid), { sid, name: nm, pinHash, at: Date.now() });
        } catch (e) {
          await dropCurrentUser(fb);
          const ae = toAppError(e);
          throw ae.code === 'PERMISSION' ? new AppError('LOGIN_FAILED', '학번·이름·PIN 을 확인해 주세요.') : ae;
        }
        await afterStudentLogin(fb, sid);
      });
    },

    studentFirstLogin(id, name, pin) {
      const sid = id.trim();
      const nm = name.trim();
      return flow(async (fb) => {
        const { F, fs } = fb;
        const user = await signInStudentAnon(fb);
        const pinHash = await pinHashOf(sid, pin);
        try {
          const b = F.writeBatch(fs);
          b.set(F.doc(fs, 'secrets', sid), { pinHash, name: nm });
          b.set(F.doc(fs, 'links', user.uid), { sid, name: nm, pinHash, at: Date.now() });
          await b.commit();
        } catch (e) {
          const ae = toAppError(e);
          if (ae.code !== 'PERMISSION') {
            await dropCurrentUser(fb);
            throw ae;
          }
          // 실패 원인 구분: 이름이 맞고 PIN 이 이미 있으면 probes 생성이 허용된다.
          let pinSet = false;
          try {
            const pRef = F.doc(fs, 'probes', user.uid);
            await F.setDoc(pRef, { sid, name: nm });
            pinSet = true;
            await F.deleteDoc(pRef).catch(() => undefined);
          } catch {
            pinSet = false;
          }
          await dropCurrentUser(fb);
          throw pinSet
            ? new AppError('PIN_ALREADY_SET', '이미 PIN 을 정했습니다. 로그인해 주세요.')
            : new AppError('LOGIN_FAILED', '학번과 이름을 확인해 주세요.');
        }
        await afterStudentLogin(fb, sid);
      });
    },

    teacherLogin(email, password) {
      return flow(async (fb) => {
        await presenceOff(fb);
        await dropCurrentUser(fb);
        await fb.A.setPersistence(fb.auth, fb.A.browserLocalPersistence);
        const cred = await fb.A.signInWithEmailAndPassword(fb.auth, email.trim(), password);
        if (!(await ensureTeacherDoc(fb, cred.user))) {
          await fb.A.signOut(fb.auth).catch(() => undefined);
          throw new AppError('NOT_TEACHER', '교사로 등록되지 않은 계정입니다. 관리자에게 초대를 요청하세요.');
        }
      });
    },

    teacherSignup(email, password) {
      return flow(async (fb) => {
        await presenceOff(fb);
        await dropCurrentUser(fb);
        await fb.A.setPersistence(fb.auth, fb.A.browserLocalPersistence);
        const cred = await fb.A.createUserWithEmailAndPassword(fb.auth, email.trim(), password);
        if (!(await ensureTeacherDoc(fb, cred.user))) {
          try {
            await fb.A.deleteUser(cred.user);
          } catch {
            await fb.A.signOut(fb.auth).catch(() => undefined);
          }
          throw new AppError('NOT_TEACHER', '초대받은 이메일만 교사로 가입할 수 있습니다.');
        }
      });
    },

    logout() {
      return flow(async (fb) => {
        await presenceOff(fb);
        for (const [roomId, { player }] of [...myRooms]) await disarm(fb, roomId, player.id);
        await dropCurrentUser(fb);
      });
    },

    // ── 학생 데이터 ──
    watchStudent(id, cb) {
      return authedSub(
        (fb) =>
          fb.F.onSnapshot(
            fb.F.doc(fb.fs, 'students', id),
            (s) => cb(s.exists() ? toStudent(s.id, s.data()) : null),
            () => cb(null),
          ),
        () => cb(null),
      );
    },

    updateStudent(id, patch) {
      return run(async (fb) => {
        const p = clean({ ...patch }) as Record<string, unknown>;
        for (const k of ['id', 'name', 'grade', 'classNo', 'number', 'createdAt']) delete p[k];
        if (!Object.keys(p).length) return;
        await fb.F.updateDoc(fb.F.doc(fb.fs, 'students', id), p);
      });
    },

    addSession(rec) {
      return run(async (fb) => {
        const { id: _omit, ...rest } = rec;
        void _omit;
        await fb.F.addDoc(fb.F.collection(fb.fs, 'sessions'), clean(rest));
      });
    },

    listSessions(studentId, max) {
      return run(async (fb) => {
        const { F, fs } = fb;
        const q = F.query(
          F.collection(fs, 'sessions'),
          F.where('studentId', '==', studentId),
          F.orderBy('createdAt', 'desc'),
          F.limit(max),
        );
        const snap = await F.getDocs(q);
        return snap.docs.map((d) => ({ ...(d.data() as SessionRecord), id: d.id }));
      });
    },

    listStudents() {
      return run(async (fb) => {
        const snap = await fb.F.getDocs(fb.F.collection(fb.fs, 'students'));
        return snap.docs.map((d) => toStudent(d.id, d.data())).sort((a, b) => a.id.localeCompare(b.id));
      });
    },

    // ── 교사 전용 ──
    addStudents(list) {
      return run(async (fb) => {
        requireTeacher();
        const { F, fs } = fb;
        const existing = new Map<string, Record<string, unknown>>();
        (await F.getDocs(F.collection(fs, 'students'))).docs.forEach((d) => existing.set(d.id, d.data()));
        const ops: ((b: WriteBatch) => void)[] = [];
        const seen = new Set<string>();
        for (const it of list) {
          const sid = String(it.id).trim();
          const nm = String(it.name).trim();
          if (!/^[0-9]{4}$/.test(sid) || !nm || seen.has(sid)) continue;
          seen.add(sid);
          const ref = F.doc(fs, 'students', sid);
          const old = existing.get(sid);
          if (!old) ops.push((b) => b.set(ref, clean(newStudent(sid, nm))));
          else if (old.name !== nm) ops.push((b) => b.update(ref, { name: nm }));
        }
        await commitOps(fb, ops);
      });
    },

    deleteStudent(id) {
      return run(async (fb) => {
        requireTeacher();
        const { F, fs } = fb;
        const sessions = await F.getDocs(F.query(F.collection(fs, 'sessions'), F.where('studentId', '==', id)));
        const links = await F.getDocs(F.query(F.collection(fs, 'links'), F.where('sid', '==', id)));
        const ops: ((b: WriteBatch) => void)[] = [];
        sessions.docs.forEach((d) => ops.push((b) => b.delete(d.ref)));
        links.docs.forEach((d) => ops.push((b) => b.delete(d.ref)));
        ops.push((b) => b.delete(F.doc(fs, 'secrets', id)));
        ops.push((b) => b.delete(F.doc(fs, 'students', id)));
        await commitOps(fb, ops);
        await fb.D.remove(fb.D.ref(fb.db, `presence/${id}`)).catch(() => undefined);
      });
    },

    resetPin(id) {
      return run(async (fb) => {
        requireTeacher();
        const { F, fs } = fb;
        const links = await F.getDocs(F.query(F.collection(fs, 'links'), F.where('sid', '==', id)));
        const ops: ((b: WriteBatch) => void)[] = [(b) => b.delete(F.doc(fs, 'secrets', id))];
        links.docs.forEach((d) => ops.push((b) => b.delete(d.ref)));
        await commitOps(fb, ops);
      });
    },

    teacherUpdateStudent(id, patch) {
      return run(async (fb) => {
        requireTeacher();
        const p = clean({ ...patch }) as Record<string, unknown>;
        delete p.id;
        if (!Object.keys(p).length) return;
        await fb.F.updateDoc(fb.F.doc(fb.fs, 'students', id), p);
      });
    },

    listTeacherInvites() {
      return run(async (fb) => {
        requireTeacher();
        const snap = await fb.F.getDocs(fb.F.collection(fb.fs, 'invites'));
        return snap.docs.map((d) => d.id).sort();
      });
    },

    inviteTeacher(email) {
      return run(async (fb) => {
        const me = requireTeacher();
        const key = email.trim().toLowerCase();
        if (!key.includes('@')) throw new AppError('UNKNOWN', '이메일 형식이 아닙니다.');
        await fb.F.setDoc(fb.F.doc(fb.fs, 'invites', key), { by: me.email, at: Date.now() });
      });
    },

    removeTeacherInvite(email) {
      return run(async (fb) => {
        requireTeacher();
        const { F, fs } = fb;
        const raw = email.trim();
        const key = raw.toLowerCase();
        await F.deleteDoc(F.doc(fs, 'invites', key));
        // 이미 가입한 (owner 가 아닌) 교사 문서도 지운다
        for (const e of new Set([raw, key])) {
          const snap = await F.getDocs(F.query(F.collection(fs, 'teachers'), F.where('email', '==', e))).catch(() => null);
          for (const d of snap?.docs ?? []) {
            if (d.data().owner !== true) await F.deleteDoc(d.ref).catch(() => undefined);
          }
        }
      });
    },

    listRecentSessions(max) {
      return run(async (fb) => {
        requireTeacher();
        const { F, fs } = fb;
        const snap = await F.getDocs(F.query(F.collection(fs, 'sessions'), F.orderBy('createdAt', 'desc'), F.limit(max)));
        return snap.docs.map((d) => ({ ...(d.data() as SessionRecord), id: d.id }));
      });
    },

    // ── 설정·콘텐츠 ──
    watchSettings(cb) {
      return authedSub(
        (fb) =>
          fb.F.onSnapshot(
            fb.F.doc(fb.fs, 'settings', 'global'),
            (s) => cb({ ...DEFAULT_SETTINGS, ...((s.exists() ? s.data() : {}) as Partial<Settings>) }),
            () => cb({ ...DEFAULT_SETTINGS }),
          ),
        () => cb({ ...DEFAULT_SETTINGS }),
      );
    },

    updateSettings(patch) {
      return run(async (fb) => {
        requireTeacher();
        await fb.F.setDoc(fb.F.doc(fb.fs, 'settings', 'global'), clean({ ...patch }), { merge: true });
      });
    },

    getContent() {
      return run(async (fb) => {
        const { F, fs } = fb;
        const meta = await F.getDoc(F.doc(fs, 'content', 'meta'));
        if (!meta.exists()) return null;
        const m = meta.data() as { stamp?: string; version?: string; parts?: number };
        const stamp = String(m.stamp ?? m.version ?? '');
        try {
          if (stamp && localStorage.getItem(CACHE_STAMP) === stamp) {
            const cached = localStorage.getItem(CACHE_DATA);
            if (cached) return JSON.parse(cached) as ContentBundle;
          }
        } catch {
          // 캐시 무시
        }
        const n = Number(m.parts) || 0;
        const docs = await Promise.all(
          Array.from({ length: n }, (_, i) => F.getDoc(F.doc(fs, 'content', `part${i}`))),
        );
        const json = docs.map((d) => String(d.exists() ? (d.data().data ?? '') : '')).join('');
        if (!json) return null;
        const bundle = JSON.parse(json) as ContentBundle;
        try {
          localStorage.setItem(CACHE_DATA, json);
          localStorage.setItem(CACHE_STAMP, stamp);
        } catch {
          try {
            localStorage.removeItem(CACHE_DATA);
            localStorage.removeItem(CACHE_STAMP);
          } catch {
            // 무시
          }
        }
        return bundle;
      });
    },

    uploadContent(bundle) {
      return run(async (fb) => {
        requireTeacher();
        const { F, fs } = fb;
        const json = JSON.stringify(bundle);
        const parts = splitChunks(json);
        const oldMeta = await F.getDoc(F.doc(fs, 'content', 'meta'));
        const oldParts = oldMeta.exists() ? Number(oldMeta.data().parts) || 0 : 0;
        // 조각은 요청 크기 제한(10MiB)을 고려해 8개씩 나눠 쓴다
        for (let i = 0; i < parts.length; i += 8) {
          const b = F.writeBatch(fs);
          parts.slice(i, i + 8).forEach((data, j) => b.set(F.doc(fs, 'content', `part${i + j}`), { i: i + j, data }));
          await b.commit();
        }
        const b = F.writeBatch(fs);
        b.set(F.doc(fs, 'content', 'meta'), {
          version: String(bundle.version ?? ''),
          stamp: `${bundle.version ?? ''}@${Date.now()}`,
          parts: parts.length,
          at: Date.now(),
        });
        for (let i = parts.length; i < oldParts; i++) b.delete(F.doc(fs, 'content', `part${i}`));
        await b.commit();
      });
    },

    // ── 접속 현황 ──
    setPresence(p) {
      presenceCur = p ? { ...p } : null;
      ready.then((fb) => queuePresence(fb), () => undefined);
    },

    watchPresence(cb) {
      return authedSub(
        (fb) =>
          fb.D.onValue(
            fb.D.ref(fb.db, 'presence'),
            (s) => cb(Object.values(objOf<Presence>(s.val()))),
            () => cb([]),
          ),
        () => cb([]),
      );
    },

    // ── 배틀 ──
    serverNow,

    watchRooms(tier: number, lang: Lang, cb: (rooms: BattleRoom[]) => void) {
      return authedSub(
        (fb) => {
          const { D, db } = fb;
          const q = D.query(D.ref(db, 'rooms'), D.orderByChild('tier'), D.equalTo(tier));
          return D.onValue(
            q,
            (s) => {
              const now = serverNow();
              const out: BattleRoom[] = [];
              for (const [id, v] of Object.entries(objOf<unknown>(s.val()))) {
                const r = toRoom(id, v);
                const empty = r && r.state === 'waiting' && Object.keys(r.players).length === 0 && now - r.createdAt > 10_000;
                if (!r || now - r.createdAt > HOUR || empty) {
                  D.remove(D.ref(db, `rooms/${id}`)).catch(() => undefined); // 오래된 방 정리
                  continue;
                }
                if (r.lang === lang) out.push(r);
              }
              out.sort((a, b) => a.createdAt - b.createdAt);
              cb(out);
            },
            () => cb([]),
          );
        },
        () => cb([]),
      );
    },

    joinOrCreateRoom(tier, lang, me) {
      return run(async (fb) => {
        const { D, db } = fb;
        const now = serverNow();
        const player: BattlePlayer = clean({ ...me, joinedAt: now, online: true });
        const snap = await D.get(D.query(D.ref(db, 'rooms'), D.orderByChild('tier'), D.equalTo(tier)));
        const candidates = Object.entries(objOf<unknown>(snap.val()))
          .map(([id, v]) => toRoom(id, v))
          .filter(
            (r): r is BattleRoom =>
              !!r &&
              r.lang === lang &&
              r.state === 'waiting' &&
              now - r.createdAt < HOUR &&
              Object.keys(r.players).length > 0 &&
              (Object.keys(r.players).length < BATTLE_MAX_PLAYERS || !!r.players[me.id]),
          )
          .sort((a, b) => Number(!!b.players[me.id]) - Number(!!a.players[me.id]) || a.createdAt - b.createdAt);

        for (const r of candidates) {
          try {
            const res = await D.runTransaction(D.ref(db, `rooms/${r.id}`), (cur) => {
              if (cur === null) return cur; // 서버 값 확인 유도
              if (cur.state !== 'waiting') return;
              const players = objOf<BattlePlayer>(cur.players);
              if (players[me.id]) players[me.id] = { ...players[me.id], name: me.name, classNo: me.classNo, online: true };
              else {
                if (Object.keys(players).length >= BATTLE_MAX_PLAYERS) return;
                players[me.id] = player;
              }
              cur.players = players;
              if (!cur.host || !players[cur.host]) cur.host = me.id;
              return cur;
            });
            if (
              res.committed &&
              res.snapshot.exists() &&
              res.snapshot.child('state').val() === 'waiting' &&
              res.snapshot.child(`players/${me.id}`).exists()
            ) {
              await arm(fb, r.id, player, 'remove');
              return r.id;
            }
          } catch {
            // 다음 방 시도
          }
        }

        const ref = D.push(D.ref(db, 'rooms'));
        const id = ref.key as string;
        const room: BattleRoom = {
          id,
          tier,
          lang,
          host: me.id,
          state: 'waiting',
          seed: 0,
          startAt: 0,
          durationSec: BATTLE_DURATION_SEC,
          startCount: 0,
          createdAt: now,
          players: { [me.id]: player },
          claims: {},
        };
        await D.set(ref, clean(room));
        await arm(fb, id, player, 'remove');
        return id;
      });
    },

    leaveRoom(roomId, playerId) {
      return run(async (fb) => {
        const { D, db } = fb;
        await disarm(fb, roomId, playerId);
        const res = await D.runTransaction(D.ref(db, `rooms/${roomId}`), (cur) => {
          if (cur === null) return cur;
          if (cur.state !== 'waiting') return; // 경기 중이면 아래에서 online=false
          const players = objOf<BattlePlayer>(cur.players);
          delete players[playerId];
          const rest = Object.values(players).sort((a, b) => a.joinedAt - b.joinedAt);
          if (!rest.length) return null; // 아무도 없으면 방 삭제
          cur.players = players;
          if (cur.host === playerId || !players[cur.host]) cur.host = rest[0].id;
          return cur;
        });
        if (res.snapshot.exists() && res.snapshot.child('state').val() !== 'waiting') {
          if (res.snapshot.child(`players/${playerId}`).exists()) {
            await D.update(playerRef(fb, roomId, playerId), { online: false });
          }
        }
      });
    },

    watchRoom(roomId, cb) {
      return authedSub(
        (fb) =>
          fb.D.onValue(
            fb.D.ref(fb.db, `rooms/${roomId}`),
            (s) => {
              const room = toRoom(roomId, s.val());
              if (room) {
                const mine = myRooms.get(roomId);
                if (mine && mine.mode === 'remove' && room.state !== 'waiting') {
                  void arm(fb, roomId, mine.player, 'offline'); // 경기 중에는 끊겨도 자리 유지
                }
                maybeTakeHost(fb, room);
              }
              cb(room);
            },
            () => cb(null),
          ),
        () => cb(null),
      );
    },

    startRoom(roomId) {
      return run(async (fb) => {
        const { D, db } = fb;
        const me = myStudentId();
        if (!me) throw new AppError('PERMISSION', '학생으로 로그인해야 합니다.');
        let notHost = false;
        const res = await D.runTransaction(D.ref(db, `rooms/${roomId}`), (cur) => {
          notHost = false;
          if (cur === null) return cur;
          if (cur.state !== 'waiting') return;
          if (cur.host !== me) {
            notHost = true;
            return;
          }
          const players = objOf<BattlePlayer>(cur.players);
          cur.players = players;
          cur.state = 'playing';
          cur.seed = random32();
          cur.startAt = serverNow() + 5000;
          cur.startCount = Object.values(players).filter((p) => p.online !== false).length;
          return cur;
        });
        if (!res.snapshot.exists()) throw new AppError('ROOM_GONE', '방이 사라졌습니다.');
        if (notHost) throw new AppError('PERMISSION', '방장만 시작할 수 있습니다.');
        const mine = myRooms.get(roomId);
        if (mine) await arm(fb, roomId, mine.player, 'offline');
      });
    },

    async claimWord(roomId, wordIndex, playerId) {
      try {
        const fb = await ready;
        const { D, db } = fb;
        const res = await D.runTransaction(D.ref(db, `rooms/${roomId}/claims/${wordIndex}`), (cur) => {
          if (cur === null) return { by: playerId, at: D.serverTimestamp() };
          return; // 이미 선점됨 → 중단
        });
        return res.snapshot.child('by').val() === playerId;
      } catch {
        return false;
      }
    },

    finishRoom(roomId) {
      // 방 전체를 다시 쓰는 트랜잭션은 claims(배열로 올 수 있음)까지 건드리므로 state 만 갱신한다.
      // 방이 이미 지워졌다면 규칙(.validate: 필수 필드)이 부분 노드 생성을 막아 오류 → 무시.
      return run(async (fb) => {
        await fb.D.update(fb.D.ref(fb.db, `rooms/${roomId}`), { state: 'done' });
      }).catch(() => undefined);
    },
  };

  return backend;
}
