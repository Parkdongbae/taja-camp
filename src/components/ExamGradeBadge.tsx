// 수행평가 등급 표시. A 금색, B 민트, C 파랑, D 주황, E 회색.
//   GRADE_BG[grade] / GRADE_TEXT[grade]  Tailwind 클래스
//   <GradeBadge grade size? />            동그란 등급 글자
import type { ExamGrade } from '../data/types';

export const GRADE_BG: Record<ExamGrade, string> = {
  A: 'bg-gold',
  B: 'bg-mint-500',
  C: 'bg-blue-500',
  D: 'bg-orange-500',
  E: 'bg-ink/40',
};
export const GRADE_TEXT: Record<ExamGrade, string> = {
  A: 'text-gold',
  B: 'text-mint-600',
  C: 'text-blue-600',
  D: 'text-orange-600',
  E: 'text-ink/50',
};

export function GradeBadge({ grade, size = 32 }: { grade: ExamGrade; size?: number }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-black text-white ${GRADE_BG[grade]}`}
      style={{ width: size, height: size, fontSize: size * 0.55 }}
    >
      {grade}
    </span>
  );
}
