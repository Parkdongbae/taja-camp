// 데이터 계층 인터페이스. 화면은 이 인터페이스만 사용한다.
// 구현: firebaseBackend.ts (실서비스), localBackend.ts (데모 모드: localStorage + BroadcastChannel)
import type {
  AuthUser,
  BattlePlayer,
  BattleRoom,
  FallSpeed,
  ContentBundle,
  Lang,
  Presence,
  SessionRecord,
  Settings,
  Student,
} from './types';

export type Unsub = () => void;

export interface Backend {
  readonly mode: 'firebase' | 'local';

  // ── 인증 ──
  /** 로그인 상태가 바뀔 때마다 호출. 최초 1회는 반드시 호출된다(null 포함). */
  onAuth(cb: (user: AuthUser | null) => void): Unsub;
  /** 학번·이름·PIN 으로 입장. 틀리면 AppError('LOGIN_FAILED'). */
  studentLogin(id: string, name: string, pin: string): Promise<void>;
  /** 첫 접속: PIN 을 정하고 입장. 이미 PIN 이 있으면 AppError('PIN_ALREADY_SET'), 명단과 다르면 'LOGIN_FAILED'. */
  studentFirstLogin(id: string, name: string, pin: string): Promise<void>;
  teacherLogin(email: string, password: string): Promise<void>;
  /** 교사 계정 만들기. 교사가 한 명도 없으면 첫 가입자가 관리자(owner)가 된다. 그 외에는 초대된 이메일만 가능 → 아니면 AppError('NOT_TEACHER'). */
  teacherSignup(email: string, password: string): Promise<void>;
  logout(): Promise<void>;

  // ── 학생 데이터 ──
  watchStudent(id: string, cb: (s: Student | null) => void): Unsub;
  /** 본인 문서의 일부 필드 갱신(얕은 병합). */
  updateStudent(id: string, patch: Partial<Student>): Promise<void>;
  addSession(rec: SessionRecord): Promise<void>;
  listSessions(studentId: string, max: number): Promise<SessionRecord[]>;
  /** 전체 학생(순위표·교사 화면). */
  listStudents(): Promise<Student[]>;

  // ── 교사 전용 ──
  addStudents(list: { id: string; name: string }[]): Promise<void>;
  deleteStudent(id: string): Promise<void>;
  resetPin(id: string): Promise<void>;
  /** 교사가 학생 문서를 직접 수정(단계 조정 등). */
  teacherUpdateStudent(id: string, patch: Partial<Student>): Promise<void>;
  listTeacherInvites(): Promise<string[]>;
  inviteTeacher(email: string): Promise<void>;
  removeTeacherInvite(email: string): Promise<void>;
  listRecentSessions(max: number): Promise<SessionRecord[]>;

  // ── 설정·콘텐츠 ──
  watchSettings(cb: (s: Settings) => void): Unsub;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  /** 교사가 올린 교과서 콘텐츠. 없으면 null (앱은 내장 기초 콘텐츠만 사용). */
  getContent(): Promise<ContentBundle | null>;
  uploadContent(bundle: ContentBundle): Promise<void>;

  // ── 접속 현황 ──
  setPresence(p: Presence | null): void;
  watchPresence(cb: (list: Presence[]) => void): Unsub;

  // ── 배틀 ──
  /** 서버 기준 현재 시각(ms). 모든 클라이언트가 같은 값을 얻어야 한다. */
  serverNow(): number;
  watchRooms(tier: number, lang: Lang, cb: (rooms: BattleRoom[]) => void): Unsub;
  /** 대기 중이고 자리가 남은 같은 계급 방에 들어가거나, 없으면 새로 만든다. roomId 반환. */
  joinOrCreateRoom(tier: number, lang: Lang, me: BattlePlayer): Promise<string>;
  leaveRoom(roomId: string, playerId: string): Promise<void>;
  watchRoom(roomId: string, cb: (room: BattleRoom | null) => void): Unsub;
  /** 방장만, 대기 중일 때만. 경기 시간(초)을 바꾼다. */
  setRoomDuration(roomId: string, sec: number): Promise<void>;
  /** 방장만, 대기 중일 때만. 개인전('ffa')·팀전('team')을 바꾼다. */
  setRoomMode(roomId: string, mode: 'ffa' | 'team'): Promise<void>;
  /** 방장만. state=playing, startAt=serverNow()+5000, seed 확정. */
  startRoom(roomId: string, fall?: FallSpeed): Promise<void>;
  /** 낱말 선점. 내가 처음이면 true. 원자적(트랜잭션)이어야 한다. */
  claimWord(roomId: string, wordIndex: number, playerId: string): Promise<boolean>;
  /** 경기 종료 표시(누가 호출해도 됨, 여러 번 호출 안전). */
  finishRoom(roomId: string): Promise<void>;
  /** 멈추기 발동(한 판에 한 사람 한 번). 내 칸이 비어 있어 새로 썼으면 true. */
  freezeRoom(roomId: string, playerId: string, ms: number): Promise<boolean>;
}
