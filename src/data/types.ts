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
