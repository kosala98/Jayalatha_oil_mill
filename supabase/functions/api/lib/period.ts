import { z } from 'zod';

export const PERIODS = ['today', 'week', 'month', 'year', 'all'] as const;
export type Period = (typeof PERIODS)[number];
export const periodSchema = z.enum(PERIODS);

/**
 * Start of the period in the business's local time zone, returned as a UTC instant.
 * Sri Lanka has no DST, so a fixed offset is exact. Weeks start on Monday.
 * Returns `undefined` for 'all'.
 */
export function periodStart(period: Period, offsetMinutes: number, now: Date = new Date()): Date | undefined {
  if (period === 'all') return undefined;
  const offsetMs = offsetMinutes * 60_000;
  // Shift so that UTC getters read local wall-clock values.
  const local = new Date(now.getTime() + offsetMs);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();

  let startLocalMs: number;
  switch (period) {
    case 'today':
      startLocalMs = Date.UTC(y, m, d);
      break;
    case 'week': {
      const daysSinceMonday = (local.getUTCDay() + 6) % 7;
      startLocalMs = Date.UTC(y, m, d - daysSinceMonday);
      break;
    }
    case 'month':
      startLocalMs = Date.UTC(y, m, 1);
      break;
    case 'year':
      startLocalMs = Date.UTC(y, 0, 1);
      break;
  }
  return new Date(startLocalMs - offsetMs);
}

/**
 * A range of whole local days, 'YYYY-MM-DD' to 'YYYY-MM-DD' inclusive, as UTC instants:
 * `from` is the first day's local midnight and `until` the midnight after the last day.
 * A `to` before `from` is treated as the single day `from`.
 */
export function dayRange(from: string, to: string | undefined, offsetMinutes: number): { from: Date; until: Date } {
  const offsetMs = offsetMinutes * 60_000;
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const last = Math.max(start, Date.parse(`${to ?? from}T00:00:00.000Z`));
  return { from: new Date(start - offsetMs), until: new Date(last + 86_400_000 - offsetMs) };
}
