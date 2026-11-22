// 가상 키보드(SVG). 폭에 맞춰 비율을 유지하며 줄어든다(부모 크기에 맞춤: className 으로 h-full w-full 등).
//
// 공개 API
//   <VirtualKeyboard kind lang target? stageCodes? wrongCode? wrongNonce? pressedCode? showHands? plain? className? />
//     kind        키보드 종류(맨 아랫줄 모양·글쇠 납작함만 다름)
//     lang        글쇠 표시 글자: ko 두벌식 자모(위에 Shift 글자 작게) / en 영문
//     target      지금 눌러야 할 글쇠(진하게). Shift 가 필요하면 반대쪽 Shift 도 진하게
//     stageCodes  현재 단계 글쇠(연하게)
//     wrongCode   잘못 누른 글쇠(0.3초 빨갛게). 같은 글쇠를 또 틀렸을 때는 wrongNonce 를 바꿔 다시 깜빡이게 한다
//     pressedCode 지금 누르고 있는 글쇠(살짝 진하게)
//     showHands   손 실루엣(Hands) 겹쳐 그리기
//     plain       테스트용: 강조·손 없이 배열만
//   기하 도우미(Hands 와 공유): kbGeom(kind), keyRect(g, k), keyCenter(g, k)
import { useEffect, useId, useMemo, useState } from 'react';
import type { KeyboardKind, Lang } from '../data/types';
import { keysFor, shiftCodeFor, type KeyDef, type KeyTarget, KEYBOARD_WIDTH } from '../engine/layout';
import Hands, { handsExtra } from './Hands';

export interface KbGeom {
  U: number; // 글쇠 1칸 가로(viewBox 단위)
  P: number; // 한 줄 높이
  gap: number; // 글쇠 사이 간격
  pad: number; // 판 테두리 여백
  radius: number;
  width: number; // 판 전체 폭
  height: number; // 판 전체 높이(손 여백 제외)
}

export function kbGeom(kind: KeyboardKind): KbGeom {
  const U = 60;
  const pad = 14;
  const flat = kind !== 'desktop';
  const P = flat ? 50 : 60;
  return {
    U,
    P,
    gap: flat ? 4 : 6,
    pad,
    radius: flat ? 5 : 8,
    width: KEYBOARD_WIDTH * U + pad * 2,
    height: 5 * P + pad * 2,
  };
}

export function keyRect(g: KbGeom, k: KeyDef) {
  const h = k.h ?? 1;
  const dy = k.dy ?? 0;
  const half = k.h && k.h < 1 ? g.gap / 4 : g.gap / 2;
  return {
    x: g.pad + k.x * g.U + g.gap / 2,
    y: g.pad + (k.row + dy) * g.P + half,
    w: k.w * g.U - g.gap,
    h: h * g.P - half * 2,
  };
}

export function keyCenter(g: KbGeom, k: KeyDef) {
  return { x: g.pad + (k.x + k.w / 2) * g.U, y: g.pad + (k.row + (k.dy ?? 0) + (k.h ?? 1) / 2) * g.P };
}

type KeyState = 'none' | 'stage' | 'target' | 'wrong' | 'pressed';

export interface VirtualKeyboardProps {
  kind: KeyboardKind;
  lang: Lang;
  target?: KeyTarget | null;
  stageCodes?: string[];
  wrongCode?: string | null;
  wrongNonce?: number;
  pressedCode?: string | null;
  showHands?: boolean;
  plain?: boolean;
  className?: string;
}

// 글쇠 위 글자: main(가운데), sub(왼쪽 위 작게), small(특수 글쇠 이름)
function keyText(k: KeyDef, lang: Lang): { main: string; sub: string; isLabel: boolean } {
  if (k.label !== undefined) return { main: k.label, sub: '', isLabel: true };
  if (k.ko) {
    if (lang === 'ko') return { main: k.ko, sub: k.koShift && k.koShift !== k.ko ? k.koShift : '', isLabel: false };
    return { main: k.enShift, sub: '', isLabel: false };
  }
  return { main: k.en, sub: k.enShift !== k.en ? k.enShift : '', isLabel: false };
}

const RECT_CLASS: Record<KeyState, string> = {
  none: 'fill-white stroke-mint-200',
  stage: 'fill-mint-100 stroke-mint-300',
  target: 'fill-mint-500 stroke-mint-600',
  wrong: 'fill-miss stroke-miss',
  pressed: 'fill-mint-200 stroke-mint-300',
};
const TEXT_CLASS: Record<KeyState, string> = {
  none: 'fill-ink',
  stage: 'fill-mint-700',
  target: 'fill-white',
  wrong: 'fill-white',
  pressed: 'fill-ink',
};

function KeyLabel({ g, k, lang, state }: { g: KbGeom; k: KeyDef; lang: Lang; state: KeyState }) {
  const r = keyRect(g, k);
  const t = keyText(k, lang);
  const cls = TEXT_CLASS[state];
  const dim = state === 'none' && t.isLabel ? ' opacity-60' : '';
  if (!t.main && !t.sub) return null;
  const cx = r.x + r.w / 2;
  if (t.isLabel) {
    const size = t.main.length > 3 ? g.U * 0.22 : g.U * (k.h && k.h < 1 ? 0.2 : 0.26);
    return (
      <text x={cx} y={r.y + r.h / 2} fontSize={size} textAnchor="middle" dominantBaseline="central" className={cls + dim}>
        {t.main}
      </text>
    );
  }
  const mainSize = g.P * 0.44;
  return (
    <>
      {t.sub && (
        <text x={r.x + g.U * 0.14} y={r.y + g.P * 0.25} fontSize={g.P * 0.27} dominantBaseline="central" className={cls + ' opacity-60'}>
          {t.sub}
        </text>
      )}
      <text
        x={t.sub ? cx + g.U * 0.08 : cx}
        y={r.y + r.h / 2 + (t.sub ? g.P * 0.1 : 0)}
        fontSize={mainSize}
        fontWeight={700}
        textAnchor="middle"
        dominantBaseline="central"
        className={cls}
      >
        {t.main}
      </text>
    </>
  );
}

export default function VirtualKeyboard({
  kind,
  lang,
  target = null,
  stageCodes,
  wrongCode = null,
  wrongNonce = 0,
  pressedCode = null,
  showHands = false,
  plain = false,
  className = '',
}: VirtualKeyboardProps) {
  const g = useMemo(() => kbGeom(kind), [kind]);
  const keys = keysFor(kind);
  const maskId = useId().replace(/:/g, '');

  // 잘못 누른 글쇠 0.3초 깜빡임
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!wrongCode) return;
    setFlash(wrongCode);
    const t = setTimeout(() => setFlash(null), 300);
    return () => clearTimeout(t);
  }, [wrongCode, wrongNonce]);

  const stageSet = useMemo(() => new Set(stageCodes ?? []), [stageCodes]);
  const shiftCode = target ? shiftCodeFor(target) : null;
  const hands = showHands && !plain;

  const stateOf = (code: string): KeyState => {
    if (plain) return 'none';
    if (flash === code) return 'wrong';
    if (target && (target.code === code || shiftCode === code)) return 'target';
    if (pressedCode === code) return 'pressed';
    if (stageSet.has(code)) return 'stage';
    return 'none';
  };

  const extra = hands ? handsExtra(g) : 0;
  const totalH = g.height + extra;
  const highlighted = keys.filter((k) => {
    const s = stateOf(k.code);
    return s === 'target' || s === 'wrong';
  });

  return (
    <svg
      viewBox={`0 0 ${g.width} ${totalH}`}
      preserveAspectRatio="xMidYMin meet"
      className={`block select-none ${className}`}
      role="img"
      aria-label="가상 키보드"
    >
      <rect x={0} y={0} width={g.width} height={g.height} rx={g.radius * 2} className="fill-mint-200/70" />
      {keys.map((k) => {
        const r = keyRect(g, k);
        const s = stateOf(k.code);
        const special = k.label !== undefined && s === 'none';
        return (
          <g key={k.code}>
            <rect
              x={r.x}
              y={r.y + (s === 'pressed' ? 1.5 : 0)}
              width={r.w}
              height={r.h}
              rx={g.radius}
              strokeWidth={1.5}
              className={`${special ? 'fill-mint-50 stroke-mint-200' : RECT_CLASS[s]} transition-colors duration-100`}
            />
            {(k.code === 'KeyF' || k.code === 'KeyJ') && (
              <line
                x1={r.x + r.w / 2 - g.U * 0.12}
                x2={r.x + r.w / 2 + g.U * 0.12}
                y1={r.y + r.h - g.P * 0.12}
                y2={r.y + r.h - g.P * 0.12}
                strokeWidth={2.5}
                strokeLinecap="round"
                className={s === 'target' || s === 'wrong' ? 'stroke-white/80' : 'stroke-ink/30'}
              />
            )}
            <KeyLabel g={g} k={k} lang={lang} state={s} />
          </g>
        );
      })}
      {hands && (
        <>
          <defs>
            <linearGradient id={`${maskId}-g`} gradientUnits="userSpaceOnUse" x1={0} y1={g.height - g.P * 0.5} x2={0} y2={totalH - g.P * 0.3}>
              <stop offset={0} stopColor="white" />
              <stop offset={1} stopColor="black" />
            </linearGradient>
            <mask id={`${maskId}-m`} maskUnits="userSpaceOnUse" x={0} y={0} width={g.width} height={totalH}>
              <rect x={0} y={0} width={g.width} height={totalH} fill={`url(#${maskId}-g)`} />
            </mask>
          </defs>
          <g mask={`url(#${maskId}-m)`}>
            <Hands kind={kind} target={target} />
          </g>
          {/* 손에 가려진 목표 글쇠 글자를 위에 다시 쓴다 */}
          {highlighted.map((k) => (
            <KeyLabel key={k.code} g={g} k={k} lang={lang} state={stateOf(k.code)} />
          ))}
        </>
      )}
    </svg>
  );
}
