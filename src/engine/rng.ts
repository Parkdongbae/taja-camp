// 시드 난수. 같은 시드면 어느 브라우저에서든 같은 수열.
//
// 공개 API
//   mulberry32(seed: number): () => number      [0, 1) 균등 난수
//   randInt(rand: () => number, n: number): number   0 ~ n-1
//   shuffle<T>(arr: readonly T[], rand: () => number): T[]   새 배열(Fisher–Yates)
//   seedFromString(s: string): number           문자열 → 32비트 시드
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rand: () => number, n: number): number {
  return Math.min(n - 1, Math.floor(rand() * n));
}

export function shuffle<T>(arr: readonly T[], rand: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rand, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function seedFromString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
