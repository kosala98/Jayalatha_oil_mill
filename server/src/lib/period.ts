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
