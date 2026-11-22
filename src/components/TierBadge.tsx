// 계급장 표시. <TierBadge tier={0~5} large? />
import { TIERS } from '../engine/scoring';

const STYLE = [
  'bg-gray-200 text-gray-700',
  'bg-green-100 text-green-800',
  'bg-blue-100 text-blue-800',
  'bg-purple-100 text-purple-800',
  'bg-orange-100 text-orange-800',
  'bg-yellow-200 text-yellow-900',
];
// 작대기 수(훈련병 0, 이등병 1 … 병장 4), 예비역은 별
const MARK = ['', '▬', '▬▬', '▬▬▬', '▬▬▬▬', '★'];

export function TierBadge({ tier, large }: { tier: number; large?: boolean }) {
  const t = Math.max(0, Math.min(5, tier));
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-bold ${STYLE[t]} ${large ? 'px-4 py-1.5 text-base' : 'px-2.5 py-0.5 text-xs'}`}
    >
      {MARK[t] ? <span className="text-[0.6em] tracking-tighter">{MARK[t]}</span> : null}
      {TIERS[t].name}
    </span>
  );
}
