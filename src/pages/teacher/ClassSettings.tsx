// 수업 설정: backend.watchSettings 로 읽고, 바꾸면 바로 updateSettings 로 저장한다.
import { useEffect, useRef, useState } from 'react';
import { backend } from '../../data';
import { AppError, DEFAULT_SETTINGS, type Settings } from '../../data/types';
import { Card } from '../../components/ui';

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-8 w-14 rounded-full transition focus:outline-none focus-visible:ring-4 focus-visible:ring-mint-300 ${on ? 'bg-mint-500' : 'bg-ink/20'}`}
    >
      <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? 'left-7' : 'left-1'}`} />
    </button>
  );
}

function Row({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-mint-100 py-4 last:border-0">
      <div>
        <div className="font-bold">{title}</div>
        <div className="text-sm text-ink/60">{desc}</div>
      </div>
      {children}
    </div>
  );
}

function Slider({ value, min, max, unit, onChange }: { value: number; min: number; max: number; unit: string; onChange: (n: number) => void }) {
  // 끌고 있는 동안은 화면 값만 바꾸고, 놓을 때 저장한다
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div className="flex w-56 items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        value={v}
        className="flex-1 accent-mint-500"
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={() => v !== value && onChange(v)}
        onKeyUp={() => v !== value && onChange(v)}
        onBlur={() => v !== value && onChange(v)}
      />
      <span className="w-14 text-right font-bold tabular-nums">
        {v}
        {unit}
      </span>
    </div>
  );
}

export default function ClassSettings() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<'' | 'saving' | 'saved' | 'error'>('');
  const [err, setErr] = useState('');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    try {
      return backend.watchSettings((v) => {
        setS({ ...DEFAULT_SETTINGS, ...v });
        setLoaded(true);
      });
    } catch {
      setErr('설정을 불러오지 못했습니다.');
    }
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const save = async (patch: Partial<Settings>) => {
    setS((o) => ({ ...o, ...patch }));
    setState('saving');
    setErr('');
    try {
      await backend.updateSettings(patch);
      setState('saved');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState(''), 2000);
    } catch (e) {
      setState('error');
      setErr(e instanceof AppError && e.code === 'PERMISSION' ? '권한이 없습니다.' : '저장하지 못했습니다. 잠시 후 다시 시도하세요.');
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-black">수업 설정</h1>
        <span className="text-sm font-bold text-mint-700" aria-live="polite">
          {state === 'saving' ? '저장 중...' : state === 'saved' ? '✓ 저장됨' : ''}
        </span>
      </div>
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-miss">{err}</p>}
      <Card className={loaded ? '' : 'opacity-60'}>
        <Row title="배틀 허용" desc="끄면 학생은 배틀에 들어갈 수 없어요.">
          <Toggle label="배틀 허용" on={s.battleEnabled} onChange={(v) => void save({ battleEnabled: v })} />
        </Row>
        <Row
          title="배틀 임시 공개"
          desc={
            s.battleEnabled
              ? '켜면 자리연습을 마치지 않은 학생도 배틀에 들어갈 수 있어요. 시험해 본 뒤에는 꼭 꺼 주세요.'
              : '「배틀 허용」이 꺼져 있으면 임시 공개를 켜도 들어갈 수 없어요.'
          }
        >
          <Toggle label="배틀 임시 공개" on={!!s.battleOpenAll} onChange={(v) => void save({ battleOpenAll: v })} />
        </Row>
        <Row title="하루 목표 시간" desc="오늘의 훈련 목표(5~20분).">
          <Slider value={s.dailyGoalMinutes} min={5} max={20} unit="분" onChange={(n) => void save({ dailyGoalMinutes: n })} />
        </Row>
        <Row title="승급 통과 점수" desc="승급 테스트 합격선(70~100점).">
          <Slider value={s.passScore} min={70} max={100} unit="점" onChange={(n) => void save({ passScore: n })} />
        </Row>
        <Row title="테스트 문항 제한 시간" desc="승급 테스트 한 문항당 시간(2~6초).">
          <Slider value={s.testSecondsPerItem} min={2} max={6} unit="초" onChange={(n) => void save({ testSecondsPerItem: n })} />
        </Row>
        <Row title="순위표 공개" desc="끄면 학생은 자기 기록만 볼 수 있어요.">
          <Toggle label="순위표 공개" on={s.rankingPublic} onChange={(v) => void save({ rankingPublic: v })} />
        </Row>
        <Row title="타건음 허용" desc="끄면 학생이 소리를 켤 수 없어요.">
          <Toggle label="타건음 허용" on={s.soundAllowed} onChange={(v) => void save({ soundAllowed: v })} />
        </Row>
      </Card>
    </div>
  );
}
