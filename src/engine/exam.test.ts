import { describe, expect, it } from 'vitest';
import { examGrade, examTable } from './scoring';

describe('수행평가 등급', () => {
  it('한글: 200 이상 A, 30타 간격', () => {
    expect(examGrade('ko', 250)).toBe('A');
    expect(examGrade('ko', 200)).toBe('A');
    expect(examGrade('ko', 199)).toBe('B');
    expect(examGrade('ko', 170)).toBe('B');
    expect(examGrade('ko', 169)).toBe('C');
    expect(examGrade('ko', 140)).toBe('C');
    expect(examGrade('ko', 139)).toBe('D');
    expect(examGrade('ko', 110)).toBe('D');
    expect(examGrade('ko', 109)).toBe('E');
    expect(examGrade('ko', 0)).toBe('E');
  });
  it('영어: 150 이상 A, 20타 간격', () => {
    expect(examGrade('en', 150)).toBe('A');
    expect(examGrade('en', 149)).toBe('B');
    expect(examGrade('en', 130)).toBe('B');
    expect(examGrade('en', 129)).toBe('C');
    expect(examGrade('en', 110)).toBe('C');
    expect(examGrade('en', 109)).toBe('D');
    expect(examGrade('en', 90)).toBe('D');
    expect(examGrade('en', 89)).toBe('E');
  });
  it('등급표', () => {
    expect(examTable('ko').map((r) => r.label)).toEqual(['200타 이상', '170~199타', '140~169타', '110~139타', '110타 미만']);
    expect(examTable('en').map((r) => r.label)).toEqual(['150타 이상', '130~149타', '110~129타', '90~109타', '90타 미만']);
  });
});
