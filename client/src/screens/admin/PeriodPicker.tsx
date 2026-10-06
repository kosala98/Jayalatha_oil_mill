import { Segmented } from '../../components/Segmented';
import type { Period } from '../../domain/types';
import { S } from '../../i18n';

const PERIODS = (['today', 'week', 'month', 'year', 'all'] as const).map((p) => ({ value: p, label: S.periods[p] }));

export function PeriodPicker({ value, onChange }: { value: Period | null; onChange(p: Period): void }) {
  return <Segmented label={S.history.period} hideLabel options={PERIODS} value={value} onChange={onChange} size="sm" />;
}
