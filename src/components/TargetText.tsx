// 목표 글을 글자별 상태(CompareResult.targetStates)로 색칠한다.
//   <TargetText text={target} states={result.targetStates} size={32} showCurrent />
//   done 진한 남색, current 밑줄(다음에 칠 글자), error 빨강+밑줄+연한 배경, todo 연회색.
//   size: 글자 크기(px, 기본 32, 28 미만이면 28 로 올린다). showCurrent=false 면 current 밑줄을 그리지 않는다.
//   states 를 안 주면 전부 todo.
import { Fragment } from 'react';
import { normalizeText, type TargetState } from '../engine';

interface Props {
  text: string;
  states?: TargetState[];
  size?: number;
  showCurrent?: boolean;
  className?: string;
}

const CLS: Record<TargetState, string> = {
  done: 'font-bold text-ink',
  current: 'text-ink/70 underline decoration-mint-500 decoration-4 underline-offset-[6px]',
  error: 'font-bold text-miss underline decoration-miss decoration-4 underline-offset-[6px] bg-miss/10 rounded-sm',
  todo: 'text-ink/25',
};

export default function TargetText({ text, states, size = 32, showCurrent = true, className = '' }: Props) {
  const chars = Array.from(normalizeText(text));
  return (
    <span
      className={`whitespace-pre-wrap break-keep leading-snug tracking-wide ${className}`}
      style={{ fontSize: Math.max(28, size) }}
      aria-label={text}
    >
      {chars.map((c, i) => {
        let s: TargetState = states?.[i] ?? 'todo';
        if (s === 'current' && !showCurrent) s = 'todo';
        // 공백도 span 으로 그려 밑줄·배경이 보이게 한다(줄바꿈은 그대로 가능)
        return (
          <Fragment key={i}>
            <span className={`transition-colors duration-100 ${CLS[s]}`}>{c}</span>
          </Fragment>
        );
      })}
    </span>
  );
}
