// 손 실루엣: VirtualKeyboard 의 <svg> 안에 겹쳐 그리는 <g>. (VirtualKeyboard showHands 로 쓴다)
//
// 공개 API
//   <Hands kind target? />   kind 로 kbGeom(kind)·keysFor(kind) 좌표를 써서 키보드 그림과 맞물린다.
//     - 손 그림 /hand-left.png(왼손, 1000×1000) 을 반투명하게 쓰고, 오른손은 좌우 반전.
//     - 기본 상태: 네 손끝(TIPS)이 기본자리 글쇠 중심에 가장 가깝게 오도록 배율·회전·위치를 최소제곱으로 맞춘다.
//     - target 이 있으면 손 모양은 그대로 두고 손 전체를 옮겨, 누를 손가락 끝이 목표 글쇠 중심에 정확히 오게 한다(130ms).
//       Shift 가 필요하면 반대 손 전체를 옮겨 새끼손가락 끝이 Shift 위에 온다. Space 는 오른손 엄지. 안 쓰는 손은 기본자리.
//   handsExtra(g: KbGeom): number   손목을 그리려고 키보드 아래에 더 두는 높이(viewBox 단위)
//   TIPS: 그림 속 손끝(누르는 지점) 좌표(그림 픽셀, 1000 기준)
import { useMemo } from 'react';
import type { KeyboardKind } from '../data/types';
import { HOME_CODES, keyByCode, shiftFingerFor, type Finger, type KeyDef, type KeyTarget } from '../engine/layout';
import { kbGeom, keyCenter, type KbGeom } from './VirtualKeyboard';

const HAND_SRC = '/hand-left.png';
const IMG = 1000;
const OPACITY = 0.4;
const MOVE = 'transform 130ms ease-out';

// 손끝 볼록점에서 살짝 안쪽 = 글쇠를 누르는 지점(긴 약지·중지는 손가락 끝을 조금 구부린 셈으로 더 안쪽)
export const TIPS = {
  L5: { x: 390, y: 150 },
  L4: { x: 522, y: 115 },
  L3: { x: 638, y: 145 },
  L2: { x: 722, y: 223 },
  T: { x: 785, y: 530 },
} as const;

// 그림을 미리 받아 둔다
if (typeof window !== 'undefined') {
  const im = new Image();
  im.src = HAND_SRC;
}

export function handsExtra(g: KbGeom): number {
  return g.U * 1.3;
}

interface Pt {
  x: number;
  y: number;
}
// 닮음 변환 Q = A·P + t  (A = [[a, -b], [b, a]])
interface Sim {
  a: number;
  b: number;
  tx: number;
  ty: number;
}
const apply = (m: Sim, p: Pt): Pt => ({ x: m.a * p.x - m.b * p.y + m.tx, y: m.b * p.x + m.a * p.y + m.ty });

// 최소제곱 닮음 변환(회전·배율·이동)
function fitSim(src: Pt[], dst: Pt[]): Sim {
  const n = src.length;
  const sc = src.reduce((s, p) => ({ x: s.x + p.x / n, y: s.y + p.y / n }), { x: 0, y: 0 });
  const dc = dst.reduce((s, p) => ({ x: s.x + p.x / n, y: s.y + p.y / n }), { x: 0, y: 0 });
  let num1 = 0;
  let num2 = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const zx = src[i].x - sc.x;
    const zy = src[i].y - sc.y;
    const wx = dst[i].x - dc.x;
    const wy = dst[i].y - dc.y;
    num1 += zx * wx + zy * wy;
    num2 += zx * wy - zy * wx;
    den += zx * zx + zy * zy;
  }
  const a = num1 / den;
  const b = num2 / den;
  return { a, b, tx: dc.x - (a * sc.x - b * sc.y), ty: dc.y - (b * sc.x + a * sc.y) };
}

type Side = 'L' | 'R';
type Digit = '5' | '4' | '3' | '2' | 'T';

interface HandFit {
  m: Sim; // 그림 좌표(오른손은 반전한 좌표) → 키보드 좌표
  tip: Record<Digit, Pt>; // 기본 상태 손끝 화면 좌표
  matrix: string; // <image> transform
}

function fitHand(g: KbGeom, kind: KeyboardKind, side: Side): HandFit {
  const digits: Digit[] = ['5', '4', '3', '2'];
  // 오른손은 그림을 좌우 반전: x' = IMG - x
  const img = (d: Digit): Pt => {
    const p = TIPS[d === 'T' ? 'T' : (`L${d}` as 'L5')];
    return side === 'L' ? p : { x: IMG - p.x, y: p.y };
  };
  const src = digits.map(img);
  const dst = digits.map((d) => keyCenter(g, keyByCode(HOME_CODES[`${side}${d}` as Finger], kind)!));
  const m = fitSim(src, dst);
  const tip = {} as Record<Digit, Pt>;
  for (const d of [...digits, 'T' as const]) tip[d] = apply(m, img(d));
  // 반전 F(x,y) = (IMG - x, y) 를 먼저 적용
  const matrix =
    side === 'L'
      ? `matrix(${m.a} ${m.b} ${-m.b} ${m.a} ${m.tx} ${m.ty})`
      : `matrix(${-m.a} ${-m.b} ${-m.b} ${m.a} ${m.a * IMG + m.tx} ${m.b * IMG + m.ty})`;
  return { m, tip, matrix };
}

// 넓은 글쇠(Shift·Enter 등)는 손에 가까운 쪽을 누른다
function aimPoint(g: KbGeom, k: KeyDef, left: boolean): Pt {
  const c = keyCenter(g, k);
  if (k.w <= 1.3) return c;
  const x = left ? g.pad + (k.x + k.w) * g.U - g.U * 0.6 : g.pad + k.x * g.U + g.U * 0.6;
  return { x, y: c.y };
}

export default function Hands({ kind, target = null }: { kind: KeyboardKind; target?: KeyTarget | null }) {
  const g = useMemo(() => kbGeom(kind), [kind]);
  const fits = useMemo(() => ({ L: fitHand(g, kind, 'L'), R: fitHand(g, kind, 'R') }), [g, kind]);

  // 손마다 이동량과 누르는 손끝
  const move: Record<Side, { dx: number; dy: number; digit: Digit | null }> = {
    L: { dx: 0, dy: 0, digit: null },
    R: { dx: 0, dy: 0, digit: null },
  };
  const reach = (side: Side, digit: Digit, code: string) => {
    const k = keyByCode(code, kind);
    if (!k) return;
    const from = fits[side].tip[digit];
    let to: Pt;
    if (digit === 'T') {
      // 엄지: 스페이스 안쪽으로 가로 위치만 맞추고 세로는 스페이스 중심
      const c = keyCenter(g, k);
      const x0 = g.pad + k.x * g.U + g.U * 0.4;
      const x1 = g.pad + (k.x + k.w) * g.U - g.U * 0.4;
      // 그림 속 엄지가 스페이스보다 아래에 있어 손 전체가 크게 올라가지 않게, 위로는 반 줄까지만 옮긴다
      const y0 = c.y - ((k.h ?? 1) * g.P) / 2 + g.P * 0.2;
      to = { x: Math.max(x0, Math.min(x1, from.x)), y: Math.max(c.y, Math.min(from.y, y0 + g.P * 0.6), from.y - g.P * 0.5) };
    } else to = aimPoint(g, k, side === 'L');
    move[side] = { dx: to.x - from.x, dy: to.y - from.y, digit };
  };
  if (target) {
    if (target.finger === 'T') reach('R', 'T', target.code);
    else reach(target.finger[0] as Side, target.finger[1] as Digit, target.code);
    const sf = shiftFingerFor(target);
    if (sf) reach(sf[0] as Side, '5', sf === 'L5' ? 'ShiftLeft' : 'ShiftRight');
  }

  return (
    <g className="pointer-events-none" aria-hidden="true">
      {(['L', 'R'] as const).map((side) => {
        const f = fits[side];
        const mv = move[side];
        const tip = mv.digit ? f.tip[mv.digit] : null;
        return (
          <g key={side} style={{ transform: `translate(${mv.dx}px, ${mv.dy}px)`, transition: MOVE }}>
            <image href={HAND_SRC} width={IMG} height={IMG} transform={f.matrix} opacity={OPACITY} preserveAspectRatio="none" />
            {tip && <circle cx={tip.x} cy={tip.y} r={g.U * 0.09} className="fill-ink/70" />}
          </g>
        );
      })}
    </g>
  );
}
