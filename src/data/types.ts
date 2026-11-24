// 공통 타입. 모든 화면·백엔드가 이 파일의 타입만 사용한다.

export type Subject = 'korean' | 'english' | 'math' | 'science' | 'social' | 'basic';
export type Lang = 'ko' | 'en';
export type Level = 1 | 2 | 3;
export type Track = 'ko' | 'symbol' | 'en';
export type KeyboardKind = 'desktop' | 'laptop' | 'surface';
export const KEYBOARD_LABEL: Record<KeyboardKind, string> = {
  desktop: '데스크톱 키보드',
  laptop: '노트북 키보드',
  surface: '서피스 고3',
};

export const SUBJECT_LABEL: Record<Subject, string> = {
  korean: '국어',
  english: '영어',
  math: '수학',
  science: '과학',
  social: '사회',
  basic: '기초',
};

// ───────── 콘텐츠 ─────────
export interface WordItem {
  id: string; // 예: "w-sci-012"
  text: string; // "광합성", "지구 온난화", "environment"
  meaning: string; // 한 줄 뜻풀이 (영어 낱말은 우리말 뜻)
  lang: Lang;
  subject: Subject;
  unit: string;
  level: Level;
}
export interface SentenceItem {
  id: string;
  text: string; // 한 문장
  lang: Lang;
  subject: Subject;
  unit: string;
  level: Level;
}
export interface PassageItem {
  id: string;
  title: string;
  text: string; // 문단. 화면 줄 나눔은 실행 시 engine 이 한다.
  lang: Lang;
  subject: Subject;
  unit: string;
  level: Level;
}
export interface ContentBundle {
  version: string;
  words: WordItem[];
  sentences: SentenceItem[];
  passages: PassageItem[];
}

// ───────── 학생 ─────────
export interface Student {
  id: string; // 학번 4자리: 학년(1) 반(1) 번호(2). 예: "1315"
  name: string;
  grade: number;
  classNo: number;
  number: number;
  /** 트랙별로 "통과한 단계 수". ko 0~8, symbol 0~2, en 0~7 */
  position: Record<Track, number>;
  /** 단계 id(K1..) → 승급 테스트 최고 점수 */
  stageBest: Record<string, number>;
  /** 단계 id → 완료한 연습 단계 (0 없음, 1 익히기 완료, 2 섞어 치기 완료) */
  stageDrill: Record<string, number>;
  rp: number;
  wins: number;
  games: number;
  bestKo: number; // 최고 타수(정확도 90% 이상 기록만)
  bestEn: number;
  xp: number;
  quizPoints: number; // 낱말 뜻 퀴즈 누적 점수
  totalSeconds: number;
  days: number; // 누적 연습 일수
  streak: number; // 연속 연습 횟수(수업일 기준)
  lastDay: string; // "YYYY-MM-DD"
  todaySeconds: number; // lastDay 의 연습 시간(초)
  weakKeys: Record<string, number>; // KeyboardEvent.code → 누적 오타 수
  badges: string[];
  /** 컴퓨터 대결(연습 배틀) 상태. level 은 난이도 보정값(-5~+10), 이기면 +1 지면 -1 */
  solo?: { level: number; wins: number; games: number };
  /** 수행평가 결과(언어별 최고 기록). 응시 전에는 없음 */
  exam?: Partial<Record<Lang, ExamResult>>;
  /** 선생님 회원(관리자가 학생 관리에서 체크). 홈에 '학생이름 외우기'가 보인다. 관리자 권한은 아니다 */
  teacher?: boolean;
  createdAt: number;
  lastLoginAt: number;
}

export type ExamGrade = 'A' | 'B' | 'C' | 'D' | 'E';
export interface ExamResult {
  kpm: number; // 최종 타수(인정된 기록)
  accuracy: number;
  typos: number;
  grade: ExamGrade;
  attempts: number; // 응시 횟수
  at: number; // 인정된 기록의 응시 시각
  passageTitle?: string;
}
/** 수행평가 설정(교사가 정함) */
export interface ExamConfig {
  open: boolean; // 응시 가능 여부
  langs: Lang[]; // 평가할 언어
  minutes: number; // 제한 시간(분)
  maxAttempts: number; // 언어별 최대 응시 횟수
  passageKo: string; // 한글 평가 지문 id, 'random' 이면 무작위
  passageEn: string;
  title: string; // 예: "1학기 타자 수행평가"
}
export const DEFAULT_EXAM: ExamConfig = {
  open: false,
  langs: ['ko'],
  minutes: 3,
  maxAttempts: 2,
  passageKo: 'random',
  passageEn: 'random',
  title: '타자 수행평가',
};

export type SessionMode = 'position' | 'positionTest' | 'word' | 'sentence' | 'passage' | 'battle' | 'quiz' | 'exam';
export interface SessionRecord {
  id?: string;
  studentId: string;
  classNo: number;
  mode: SessionMode;
  lang: Lang;
  subject?: Subject | 'all';
  stageId?: string;
  kpm: number; // 타/분
  accuracy: number; // 0~100
  typos: number;
  strokes: number; // 정타 수
  seconds: number;
  score?: number; // 승급 테스트 점수 또는 배틀 점수
  passed?: boolean;
  missKeys: Record<string, number>;
  createdAt: number;
}

/** 배틀 낱말이 떨어지는 속도(%). 점수별. 100 = 기본, 클수록 빠름 */
export interface FallSpeed {
  p1: number;
  p2: number;
  p4: number;
}
export const DEFAULT_FALL_SPEED: FallSpeed = { p1: 100, p2: 115, p4: 130 };

export interface Settings {
  battleEnabled: boolean;
  /** 배틀 임시 공개: 켜면 자리 단계와 상관없이 누구나 배틀(한글·영문)에 들어간다. 옛 문서에는 없을 수 있다 */
  battleOpenAll?: boolean;
  dailyGoalMinutes: number;
  passScore: number;
  testSecondsPerItem: number;
  rankingPublic: boolean;
  soundAllowed: boolean;
  exam: ExamConfig;
  // ── 배틀 멈추기·바른 말 (옛 문서에는 없을 수 있다) ──
  /** 멈추기 문장. 배틀에서 이 문장을 친 학생만 freezeSeconds 동안 입력할 수 있다. 비우면 끔 */
  freezePhrase?: string;
  freezeSeconds?: number;
  /** 배틀에서 욕설을 치면 badWordSeconds 동안 그 학생의 입력을 막는다 */
  badWordBlock?: boolean;
  badWordSeconds?: number;
  /** 선생님이 추가한 욕설 */
  badWordsExtra?: string[];
  /** 배틀 점수별 낙하 속도(%). 방이 시작될 때 방에 복사된다 */
  fallSpeed?: FallSpeed;
  /** 연습·배틀에 낼 콘텐츠("과목|단원" 키 목록, content/pick 의 pickKey). 비어 있거나 없으면 전체 */
  contentPick?: string[];
  /** 학급 배틀: 켜면 배틀 화면에 '학급 배틀'이 보인다(같은 반 모두가 한 방, 반 총점 기록). 옛 문서에는 없을 수 있다 */
  classBattle?: boolean;
  /** 학급 배틀 경기 시간(초). 기본 300 */
  classBattleSec?: number;
}
export const DEFAULT_SETTINGS: Settings = {
  battleEnabled: true,
  battleOpenAll: false,
  dailyGoalMinutes: 10,
  passScore: 90,
  testSecondsPerItem: 3,
  rankingPublic: true,
  soundAllowed: true,
  exam: DEFAULT_EXAM,
  freezePhrase: '',
  freezeSeconds: 5,
  badWordBlock: true,
  badWordSeconds: 10,
  badWordsExtra: [],
  fallSpeed: DEFAULT_FALL_SPEED,
  contentPick: [],
  classBattle: false,
  classBattleSec: 300,
};

// ───────── 인증 ─────────
export type AuthUser =
  | { role: 'student'; studentId: string }
  | { role: 'teacher'; uid: string; email: string; isOwner: boolean };

export type AppErrorCode =
  | 'LOGIN_FAILED' // 학번·이름·PIN 불일치
  | 'PIN_ALREADY_SET'
  | 'NOT_REGISTERED' // 명단에 없음(구분 가능한 경우에만)
  | 'NOT_TEACHER'
  | 'NAME_TAKEN' // 같은 성함으로 이미 가입 신청·등록됨
  | 'ROOM_FULL'
  | 'ROOM_GONE'
  | 'PERMISSION'
  | 'NETWORK'
  | 'UNKNOWN';
export class AppError extends Error {
  code: AppErrorCode;
  constructor(code: AppErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

/** 선생님 회원 가입 신청(관리자 승인 전). id 는 engine/member 의 memberIdOf(name) */
export interface TeacherApplicant {
  id: string;
  name: string;
  at: number;
}

// ───────── 접속 현황·배틀 ─────────
export interface Presence {
  studentId: string;
  name: string;
  classNo: number;
  tier: number;
  doing: string; // 화면 이름(예: "낱말연습")
  at: number;
}

export interface BattlePlayer {
  id: string; // 학번
  name: string;
  classNo: number;
  joinedAt: number;
  online: boolean;
}
export interface BattleRoom {
  id: string;
  tier: number;
  lang: Lang;
  host: string; // 방장 학번
  state: 'waiting' | 'playing' | 'done';
  seed: number;
  startAt: number; // 서버 시각(ms). waiting 일 때 0
  durationSec: number;
  /** 시작 시점 참가 인원(낱말 일정 계산용). waiting 일 때 0 */
  startCount: number;
  createdAt: number;
  players: Record<string, BattlePlayer>;
  /** 낱말 번호 → 선점한 사람 */
  claims: Record<string, { by: string; at: number }>;
  /** 멈추기: 쓴 사람 학번 → 시작 시각(서버 ms)·길이(ms). 한 판에 한 사람 한 번 */
  freezes?: Record<string, { at: number; ms: number }>;
  /** 경기 방식. 'team' 이면 팀전(들어온 순서대로 홍·청 번갈아). 없으면 개인전 */
  mode?: 'ffa' | 'team';
  /** 이 판의 점수별 낙하 속도(%). 시작할 때 설정에서 복사(모든 참가자가 같은 일정을 만들기 위해). 없으면 100 */
  fall?: FallSpeed;
  /** 학급 배틀 방이면 "학년반"(예: 1학년 3반 = "13"). tier 는 CLASS_TIER 로 고정. 없으면 일반 방 */
  klass?: string;
}

/** 학급 배틀 한 판의 결과(반 총점·참여 학생). 문서 id = 방 id */
export interface ClassBattleRecord {
  id: string;
  grade: number;
  classNo: number;
  date: string; // "YYYY-MM-DD"
  at: number; // 끝난 시각(ms)
  lang: Lang;
  durationSec: number;
  total: number; // 참여 학생 점수 합
  players: { id: string; name: string; score: number }[];
}
export const BATTLE_MAX_PLAYERS = 16;
export const BATTLE_DURATION_SEC = 120;

export function newStudent(id: string, name: string): Student {
  return {
    id,
    name,
    grade: Number(id[0]) || 1,
    classNo: Number(id[1]) || 0,
    number: Number(id.slice(2)) || 0,
    position: { ko: 0, symbol: 0, en: 0 },
    stageBest: {},
    stageDrill: {},
    rp: 0,
    wins: 0,
    games: 0,
    bestKo: 0,
    bestEn: 0,
    xp: 0,
    quizPoints: 0,
    totalSeconds: 0,
    days: 0,
    streak: 0,
    lastDay: '',
    todaySeconds: 0,
    weakKeys: {},
    badges: [],
    createdAt: Date.now(),
    lastLoginAt: 0,
  };
}
