// 배틀 입력창. 항상 포커스, 붙여넣기 차단. Space/Enter 로 제출(한글 조합 중이면 조합이 끝난 값으로 1번만).
//   <BattleInput active onSubmit={(text) => Promise<SubmitResult>} spaceContinues={(base) => boolean} blockedText? />
//   - active 가 꺼지면(멈추기·욕설 제재·종료) 입력값을 지우고 blockedText 를 안내로 보여 준다.
//   - Space: 입력값 끝에 공백이 생기는 순간 판단. 지금 값 + 공백이 화면 낱말(두 단어)의 앞부분이면 계속 치고, 아니면 제출.
//   - Enter: keydown 에서 처리. 조합 중(isComposing/229)이면 compositionend 뒤 값으로 제출.
//   - miss 면 흔들림 + 0.5초 입력 잠금.
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { playKey } from '../sound';

export type SubmitResult =
  | { kind: 'ok'; points: number }
  | { kind: 'late' }
  | { kind: 'miss' }
  | { kind: 'none' }
  | { kind: 'info'; text: string }; // 안내만 띄움(멈추기 등)

const LOCK_MS = 500;

export const BattleInput = memo(function BattleInput({
  active,
  onSubmit,
  spaceContinues,
  blockedText,
}: {
  blockedText?: string;
  active: boolean;
  onSubmit: (text: string) => Promise<SubmitResult>;
  spaceContinues: (base: string) => boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [locked, setLocked] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'late' | 'miss'; id: number } | null>(null);
  const pendingEnter = useRef(false);
  const msgId = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const show = useCallback((text: string, tone: 'ok' | 'late' | 'miss') => {
    const id = ++msgId.current;
    setMsg({ text, tone, id });
    later(() => setMsg((m) => (m && m.id === id ? null : m)), 900);
  }, []);

  const submitNow = useCallback(
    (raw: string) => {
      pendingEnter.current = false;
      if (ref.current) ref.current.value = '';
      setValue('');
      const text = raw.trim();
      if (!text) return;
      void onSubmit(text).then((r) => {
        if (r.kind === 'ok') show(`+${r.points}점!`, 'ok');
        else if (r.kind === 'late') show('한발 늦었어요', 'late');
        else if (r.kind === 'info') show(r.text, 'late');
        else if (r.kind === 'miss') {
          show('화면에 없는 낱말이에요', 'miss');
          setLocked(true);
          later(() => setLocked(false), LOCK_MS);
          ref.current?.animate(
            [
              { transform: 'translateX(0)' },
              { transform: 'translateX(-8px)' },
              { transform: 'translateX(8px)' },
              { transform: 'translateX(-5px)' },
              { transform: 'translateX(0)' },
            ],
            { duration: 300, easing: 'ease-in-out' },
          );
        }
      });
    },
    [onSubmit, show],
  );

  const flushEnter = useCallback(() => {
    if (!pendingEnter.current) return;
    submitNow(ref.current?.value ?? '');
  }, [submitNow]);

  // 항상 포커스
  useEffect(() => {
    ref.current?.focus();
  }, [active, locked]);

  // 입력이 막히면 치던 글자를 지운다
  useEffect(() => {
    if (active) return;
    pendingEnter.current = false;
    setValue('');
  }, [active]);

  const readOnly = !active || locked;

  return (
    <div className="relative flex h-24 shrink-0 items-center justify-center px-6">
      {msg && (
        <div
          key={msg.id}
          className={`anim-pop pointer-events-none absolute -top-3 rounded-full px-4 py-1 text-sm font-bold ${
            msg.tone === 'ok' ? 'bg-mint-500 text-white' : msg.tone === 'late' ? 'bg-gold text-ink' : 'bg-miss text-white'
          }`}
        >
          {msg.text}
        </div>
      )}
      <input
        ref={ref}
        value={value}
        readOnly={readOnly}
        autoFocus
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="낱말 입력"
        placeholder={active ? '떨어지는 낱말을 치고 Space 또는 Enter' : (blockedText ?? '')}
        className={`w-full max-w-xl rounded-2xl border-2 bg-white/10 px-5 py-3 text-center text-2xl font-bold text-white outline-none transition placeholder:text-base placeholder:font-normal placeholder:text-white/30 ${
          locked || (!active && blockedText) ? 'border-miss bg-miss/20' : 'border-mint-400 focus:border-mint-300'
        }`}
        onBlur={() => window.setTimeout(() => ref.current?.focus(), 0)}
        onPaste={(e) => e.preventDefault()}
        onDrop={(e) => e.preventDefault()}
        onCompositionEnd={() => {
          if (pendingEnter.current) window.setTimeout(flushEnter, 0);
        }}
        onKeyDown={(e) => {
          const isEnter = e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter';
          if (!isEnter) return;
          e.preventDefault();
          if (readOnly) return;
          if (e.nativeEvent.isComposing || e.keyCode === 229) {
            // 조합 중: 조합이 확정된 뒤 값으로 제출(compositionend 가 안 오면 잠시 뒤)
            pendingEnter.current = true;
            window.setTimeout(flushEnter, 60);
            return;
          }
          submitNow(e.currentTarget.value);
        }}
        onChange={(e) => {
          const v = e.target.value;
          if (readOnly) return;
          if (!v.endsWith(' ')) {
            if (v.length > value.length) playKey();
            setValue(v);
            return;
          }
          const base = v.slice(0, -1);
          if (!base.trim()) {
            setValue('');
            return;
          }
          if (!base.endsWith(' ') && spaceContinues(base)) {
            setValue(v); // 두 단어 낱말의 앞 단어: 계속 친다
            return;
          }
          submitNow(base);
        }}
      />
    </div>
  );
});
