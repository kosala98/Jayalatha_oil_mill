import { Field } from '../../components/Field';
import { Segmented } from '../../components/Segmented';
import { todayIso } from '../../domain/payment';
import type { Period } from '../../domain/types';
import { S } from '../../i18n';

const PERIODS = (['today', 'week', 'month', 'year', 'all'] as const).map((p) => ({ value: p, label: S.periods[p] }));

export function PeriodPicker({ value, onChange }: { value: Period | null; onChange(p: Period): void }) {
  return <Segmented label={S.history.period} hideLabel options={PERIODS} value={value} onChange={onChange} size="sm" />;
}

/** Calendar days picked by hand ('YYYY-MM-DD'), or '' when not set. */
export interface DayFilter {
  from: string;
  to: string;
}

export const NO_DAYS: DayFilter = { from: '', to: '' };

/** The range to send: null until `from` is set; a missing or earlier `to` means the single day `from`. */
export function dayFilterRange({ from, to }: DayFilter): { from: string; to: string } | null {
  return from ? { from, to: to && to >= from ? to : from } : null;
}

/**
 * The period buttons plus from/to calendar fields. While a "from" day is set it replaces
 * the period; choosing a period clears the days.
 */
export function PeriodOrDays({
  period,
  days,
  onPeriod,
  onDays,
}: {
  period: Period;
  days: DayFilter;
  onPeriod(p: Period): void;
  onDays(d: DayFilter): void;
}) {
  return (
    <>
      <PeriodPicker
        value={days.from ? null : period}
        onChange={(p) => {
          onPeriod(p);
          onDays(NO_DAYS);
        }}
      />
      <div className="field-row">
        <Field
          label={S.history.dateFrom}
          value={days.from}
          onChange={(from) => onDays({ ...days, from })}
          type="date"
          max={todayIso()}
        />
        <Field
          label={S.history.dateTo}
          value={days.to}
          onChange={(to) => onDays({ ...days, to })}
          type="date"
          min={days.from || undefined}
          max={todayIso()}
        />
      </div>
      {(days.from || days.to) && (
        <button type="button" className="btn btn--quiet btn--sm btn--block" onClick={() => onDays(NO_DAYS)}>
          {S.history.clearDates}
        </button>
      )}
    </>
  );
}
