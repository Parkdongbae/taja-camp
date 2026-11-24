// 선생님 회원(학번 없이 성함 + PIN 으로 가입) 식별.
//   memberIdOf(name)  성함 → 회원 문서 id ("t" + 16진수 9자, 모두 10자). 같은 성함이면 항상 같은 id.
//   isMemberId(id)    선생님 회원 id 인지(학번 4자리와 구분)
//   normalizeMemberName(name)  앞뒤·중간 공백 정리
// 학생 문서(students)와 같은 자리에 저장하므로 실시간 DB 의 id 길이 제한(10자)에 맞춘다.

export function normalizeMemberName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

// FNV-1a 32비트(시작값만 달리해 두 번 돌려 36비트를 쓴다)
function fnv(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function memberIdOf(name: string): string {
  const n = normalizeMemberName(name);
  const a = fnv(n, 0x811c9dc5).toString(16).padStart(8, '0');
  const b = (fnv(n, 0x9747b28c) & 0xf).toString(16);
  return `t${a}${b}`;
}

export function isMemberId(id: string): boolean {
  return /^t[0-9a-f]{9}$/.test(id);
}
