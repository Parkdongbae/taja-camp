// 낱말·단문·장문·퀴즈 공용 입력 훅. 실제 <input> 에 입력받고 값이 바뀔 때마다 TypingMeter 와 판정을 갱신한다.
//
// 공개 API
//   useTypingInput(opts: TypingInputOptions): TypingInput
//     opts.meter?       TypingMeter (없으면 통계를 쌓지 않고 판정만. 퀴즈용)
//     opts.target       목표 글. 문자열 배열이면 "지금 입력과 접두가 맞는 첫 후보"를 목표로 본다(퀴즈 보기용)
//     opts.lang         'ko' | 'en' (한/영 안내 문구용)
//     opts.active?      false 면 입력을 무시한다(모달·결과 표시 중). 기본 true
//     opts.submitOnSpace?  Space 로도 제출(낱말). 목표에 공백이 있으면 완성했을 때만 제출. 기본 false
//     opts.onSubmit?    Enter/Space 제출. false 를 돌려주면 입력값을 지우지 않는다(단문에서 오타가 남았을 때)
//     opts.onChange?    값이 바뀔 때마다 (value, result, composing)
//     opts.sound?       정타·오타 소리(기본 true). 완성음(playDone)은 화면이 낸다
//     opts.idleMs?      이 시간 동안 입력이 없으면 meter.pause (기본 10000)
//   반환 TypingInput
//     inputProps   <input {...inputProps} /> 로 펼친다(ref·붙여넣기/드롭 차단·autoComplete 등 포함)
//     value, result(CompareResult, composing 반영), composing, wrongLang, langHint(한/영 안내 문구 또는 null)
//     paused(meter 가 멈춘 상태), wrongCode(방금 틀린 글쇠 code, 0.3초 뒤 null), errorCount(오타 순간마다 +1, 흔들림 키로 쓴다)
//     reset()  입력값 비우고 포커스,  focus(),  inputRef
//   BACKSPACE_TARGET  오타 상태에서 가상 키보드에 보여 줄 Backspace 글쇠
// 제출 규칙: Enter/Space 는 keydown 에서 처리한다. 한글 조합 중(isComposing, keyCode 229)이면 조합이 끝난 다음 프레임의
// 값으로 판정해 이중 처리를 막는다. 값이 비어 있으면 제출하지 않는다. 입력 맨 앞의 공백은 버린다.
import { useCallback, useEffect, useMemo, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type RefObject } from 'react';
import { compare, charToTarget, type CompareResult, type KeyTarget, type TypingMeter } from '../engine';
import type { Lang } from '../data/types';
import { playError, playKey } from './sound';

export const BACKSPACE_TARGET: KeyTarget = { code: 'Backspace', shift: false, label: 'Backspace', finger: 'R5' };

export interface SubmitInfo {
  via: 'Enter' | 'Space';
  value: string;
  result: CompareResult;
  target: string;
}

export interface TypingInputOptions {
  meter?: TypingMeter | null;
  target: string | string[];
  lang: Lang;
  active?: boolean;
  submitOnSpace?: boolean;
  onSubmit?: (info: SubmitInfo) => boolean | void;
  onChange?: (value: string, result: CompareResult, composing: boolean) => void;
  sound?: boolean;
  idleMs?: number;
}

export type TypingInputProps = InputHTMLAttributes<HTMLInputElement> & { ref: RefObject<HTMLInputElement | null> };

export interface TypingInput {
  inputProps: TypingInputProps;
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  result: CompareResult;
  composing: boolean;
  wrongLang: boolean;
  langHint: string | null;
  paused: boolean;
  wrongCode: string | null;
  errorCount: number;
  reset: () => void;
  focus: () => void;
}

function pickTarget(target: string | string[], v: string): string {
  if (typeof target === 'string') return target;
  for (const t of target) if (compare(t, v).ok) return t;
  return target[0] ?? '';
}

export function useTypingInput(opts: TypingInputOptions): TypingInput {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const valueRef = useRef('');
  const composingRef = useRef(false);
  const prevGoodRef = useRef(true);
  const lastSubmitRef = useRef<{ via: string; at: number }>({ via: '', at: 0 });
  const idleBaseRef = useRef(0);
  const wrongTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [value, setValue] = useState('');
  const [composing, setComposing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [wrongCode, setWrongCode] = useState<string | null>(null);
  const [errorCount, setErrorCount] = useState(0);

  const active = opts.active !== false;
  const targetKey = Array.isArray(opts.target) ? opts.target.join('\u0000') : opts.target;
  // 화면용 판정: 조합 상태를 compare 에 직접 넘긴다
  const result = useMemo(
    () => compare(pickTarget(optsRef.current.target, value), value, { composing }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetKey, value, composing],
  );

  const focus = useCallback(() => inputRef.current?.focus(), []);

  const clear = useCallback(() => {
    valueRef.current = '';
    prevGoodRef.current = true;
    setValue('');
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const reset = useCallback(() => {
    clear();
    inputRef.current?.focus();
  }, [clear]);

  // 값이 바뀜(직접 입력·조합 끝)
  const apply = useCallback((v: string) => {
    const o = optsRef.current;
    const now = performance.now();
    const prev = valueRef.current;
    valueRef.current = v;
    const t = pickTarget(o.target, v);
    const r = o.meter ? o.meter.update(t, v, now) : compare(t, v);
    setValue(v);
    setPaused(false);

    const bad = !r.ok && !r.wrongLang;
    if (bad && prevGoodRef.current) {
      if (o.sound !== false) playError();
      const typed = r.errorKey?.typed;
      const code = typed ? (charToTarget(typed)?.code ?? null) : null;
      setErrorCount((n) => n + 1);
      setWrongCode(code);
      if (wrongTimer.current) clearTimeout(wrongTimer.current);
      wrongTimer.current = setTimeout(() => setWrongCode(null), 300);
    } else if (!bad && v.length > prev.length && o.sound !== false) {
      playKey();
    }
    prevGoodRef.current = !bad;
    o.onChange?.(v, r, composingRef.current);
  }, []);

  // 제출 시도. 제출했으면 true
  const trySubmit = useCallback(
    (via: 'Enter' | 'Space', raw: string, deferred: boolean, ev?: KeyboardEvent<HTMLInputElement>): boolean => {
      const o = optsRef.current;
      let base = raw;
      // 조합 중 Space 로 끝내면 브라우저가 공백을 이미 넣어 둔 경우가 있다
      if (via === 'Space' && deferred && base.endsWith(' ')) base = base.slice(0, -1);
      if (base.trim() === '') return false;
      const t = pickTarget(o.target, base);
      const r = compare(t, base);
      if (via === 'Space' && !(r.done || !t.includes(' '))) return false;
      ev?.preventDefault();
      const last = lastSubmitRef.current;
      const now = performance.now();
      if (last.via === via && now - last.at < 60) return true; // 같은 입력의 중복 이벤트
      lastSubmitRef.current = { via, at: now };
      const keep = o.onSubmit?.({ via, value: base, result: r, target: t });
      if (keep !== false) clear();
      return true;
    },
    [clear],
  );

  const defer = useCallback(
    (via: 'Enter' | 'Space', tries = 0) => {
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        if (composingRef.current && tries < 6) return defer(via, tries + 1);
        trySubmit(via, el.value, true);
      });
    },
    [trySubmit],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      const o = optsRef.current;
      if (o.active === false) return;
      // 조합 중에는 key 가 'Process' 로 오므로 code 로 구분한다
      const k = e.key === 'Process' || e.key === 'Unidentified' ? e.code : e.key;
      const via = k === 'Enter' || k === 'NumpadEnter' ? 'Enter' : k === ' ' || k === 'Space' ? 'Space' : null;
      if (!via) return;
      if (via === 'Space' && !o.submitOnSpace) return;
      if (e.repeat) {
        if (via === 'Enter') e.preventDefault();
        return;
      }
      if (e.nativeEvent.isComposing || e.keyCode === 229 || composingRef.current) {
        defer(via);
        return;
      }
      trySubmit(via, e.currentTarget.value, false, e);
    },
    [defer, trySubmit],
  );

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (optsRef.current.active === false) {
        e.target.value = valueRef.current;
        return;
      }
      let v = e.target.value;
      if (v.startsWith(' ')) {
        // 목표 글은 공백으로 시작하지 않는다. 앞 공백(줄·낱말 사이에 누른 Space)은 버린다
        v = v.replace(/^ +/, '');
        e.target.value = v;
      }
      if (v === valueRef.current) return;
      apply(v);
    },
    [apply],
  );

  const onCompositionStart = useCallback(() => {
    composingRef.current = true;
    setComposing(true);
  }, []);
  const onCompositionEnd = useCallback((e: React.CompositionEvent<HTMLInputElement>) => {
    composingRef.current = false;
    setComposing(false);
    // 조합이 끝난 뒤 값이 달라졌다면(브라우저에 따라 input 이 먼저/나중에 온다) 한 번 더 반영
    const v = e.currentTarget.value.replace(/^ +/, '');
    if (v !== valueRef.current && optsRef.current.active !== false) apply(v);
  }, [apply]);

  // 창 포커스를 잃으면 일시정지, 10초 무입력이면 일시정지. 다시 입력하면 meter.update 가 재개한다
  useEffect(() => {
    const pauseNow = () => {
      const m = optsRef.current.meter;
      if (m && m.started && !m.paused) m.pause(performance.now());
      setPaused(true);
    };
    const onVis = () => {
      if (document.hidden) pauseNow();
    };
    window.addEventListener('blur', pauseNow);
    document.addEventListener('visibilitychange', onVis);
    const timer = setInterval(() => {
      const o = optsRef.current;
      const m = o.meter;
      if (!m) return;
      const now = performance.now();
      const idle = o.idleMs ?? 10000;
      if (o.active !== false && m.started && !m.paused && m.lastInputAt !== null && now - Math.max(m.lastInputAt, idleBaseRef.current) > idle) {
        m.pause(now);
      }
      setPaused(m.paused);
    }, 500);
    return () => {
      window.removeEventListener('blur', pauseNow);
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(timer);
      if (wrongTimer.current) clearTimeout(wrongTimer.current);
    };
  }, []);

  // 활성화될 때 포커스를 주고 무입력 기준 시각을 새로 잡는다
  useEffect(() => {
    if (!active) return;
    idleBaseRef.current = performance.now();
    inputRef.current?.focus();
  }, [active]);

  // 포커스가 body 로 빠진 상태에서 글쇠를 누르면 입력창으로 되돌린다
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => {
      if (optsRef.current.active === false) return;
      const ae = document.activeElement;
      if ((!ae || ae === document.body) && (e.key.length === 1 || e.key === 'Process') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const block = (e: { preventDefault: () => void }) => e.preventDefault();
  const inputProps: TypingInputProps = {
    ref: inputRef,
    value,
    onChange,
    onKeyDown,
    onCompositionStart,
    onCompositionEnd,
    onPaste: block,
    onDrop: block,
    onDragOver: block,
    onCut: block,
    autoComplete: 'off',
    autoCorrect: 'off',
    autoCapitalize: 'off',
    spellCheck: false,
    enterKeyHint: 'next',
    readOnly: !active,
  };

  const langHint = result.wrongLang
    ? opts.lang === 'ko'
      ? '한/영 키를 눌러 한글로 바꾸세요'
      : '한/영 키를 눌러 영문으로 바꾸세요'
    : null;

  return { inputProps, inputRef, value, result, composing, wrongLang: result.wrongLang, langHint, paused, wrongCode, errorCount, reset, focus };
}
