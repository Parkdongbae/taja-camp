// 공용 UI 조각: Modal, Btn, Card, Stat, Spinner, Kbd
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';

export function Modal({ children, onClose, wide }: { children: ReactNode; onClose?: () => void; wide?: boolean }) {
  useEffect(() => {
    if (!onClose) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal="true">
      <div className={`anim-pop w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl bg-white p-8 shadow-2xl`}>{children}</div>
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; small?: boolean };
export function Btn({ variant = 'primary', small, className = '', ...rest }: BtnProps) {
  const base =
    'rounded-xl font-bold transition disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-4 focus-visible:ring-mint-300';
  const size = small ? 'px-3 py-1.5 text-sm' : 'px-5 py-2.5';
  const color =
    variant === 'primary'
      ? 'bg-mint-500 text-white hover:bg-mint-600'
      : variant === 'danger'
        ? 'bg-miss text-white hover:opacity-90'
        : 'bg-white text-ink border border-mint-200 hover:bg-mint-50';
  return <button className={`${base} ${size} ${color} ${className}`} {...rest} />;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-5 shadow-sm ${className}`}>{children}</div>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between border-b border-mint-200 py-2">
      <span className="text-sm text-ink/70">{label}</span>
      <span className="text-lg font-bold tabular-nums">
        {value}
        {sub ? <span className="ml-1 text-xs font-normal text-ink/50">{sub}</span> : null}
      </span>
    </div>
  );
}

export function Spinner({ text = '불러오는 중...' }: { text?: string }) {
  return <div className="flex h-full items-center justify-center text-ink/60">{text}</div>;
}

/** 키 이름 표시(단축키 안내). */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-ink/20 bg-white px-1.5 py-0.5 text-xs font-medium text-ink/70">{children}</kbd>;
}
