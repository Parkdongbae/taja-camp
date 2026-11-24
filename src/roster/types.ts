// 사진명렬표(나이스에서 저장한 엑셀) 공통 타입. 이 폴더의 자료는 브라우저 안에서만 다루고 서버로 보내지 않는다.
//   RosterStudent  명렬표의 학생 한 명(학년·반·번호·이름·사진)
//   RosterFile     등록한 명렬표 파일 하나(반별 또는 학년 전체)
//   ParsedRoster   파일을 읽은 결과(저장 전)
//   RosterError    읽기 실패. message 는 화면에 그대로 보여 줄 한국어 문장

export interface RosterStudent {
  grade: number;
  classNo: number;
  number: number;
  name: string;
  /** 증명사진(JPEG/PNG). 사진이 없는 학생은 null */
  photo: Blob | null;
}

export interface ParsedRoster {
  /** 표 제목. 예: "2026학년도 3학년 3반", "2026학년도 1학년 전체반" */
  title: string;
  year: number; // 모르면 0
  grade: number; // 모르면 0
  /** 반별 명렬표면 반 번호, 학년 전체면 null */
  classNo: number | null;
  students: RosterStudent[];
}

export interface RosterFile extends ParsedRoster {
  id: string;
  fileName: string;
  addedAt: number;
}

export class RosterError extends Error {}
