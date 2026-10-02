import { createClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef } from 'react';
import { API_URL } from '../api/http';

/**
 * Live updates. The database sends a signal on the Realtime channel "pos-changes"
 * whenever one of these tables changes (see the realtime_change_signals migration).
 * The signal says only which table changed; screens that show it fetch again through
 * the API, with their own session, exactly as they do on first load.
 */
export type LiveTable =
  | 'sales'
  | 'purchases'
  | 'cash_entries'
  | 'customers'
  | 'customer_payments'
  | 'charcoal_adjustments'
  | 'prices'
  | 'products'
  | 'temporary_admin_access';

export const ALL_TABLES: readonly LiveTable[] = [
  'sales',
  'purchases',
  'cash_entries',
  'customers',
  'customer_payments',
  'charcoal_adjustments',
  'prices',
  'products',
  'temporary_admin_access',
];

/** The money tables: anything that moves a total, a balance or the stock. */
export const LEDGER_TABLES: readonly LiveTable[] = [
  'sales',
  'purchases',
  'cash_entries',
  'customer_payments',
  'charcoal_adjustments',
];

type Listener = (changed: ReadonlySet<LiveTable>) => void;

const listeners = new Set<Listener>();
let pending = new Set<LiveTable>();
let quietTimer: ReturnType<typeof setTimeout> | null = null;
let firstPendingAt = 0;

/** Wait this long after the last signal before refreshing... */
const QUIET_MS = 700;
/** ...but never longer than this after the first one. */
const MAX_WAIT_MS = 2500;

function deliver(): void {
  if (quietTimer) clearTimeout(quietTimer);
  quietTimer = null;
  const batch = pending;
  pending = new Set();
  firstPendingAt = 0;
  listeners.forEach((l) => l(batch));
}

/**
 * A visit is saved as several requests in a row (the copra purchase, the oil sale,
 * the settlement), each committing on its own. Signals are held until they stop
 * arriving for a moment, so every screen refreshes once and shows the whole visit
 * together instead of half of it first.
 */
function signal(tables: Iterable<LiveTable>): void {
  for (const t of tables) pending.add(t);
  const now = Date.now();
  if (!firstPendingAt) firstPendingAt = now;
  if (quietTimer) clearTimeout(quietTimer);
  const wait = Math.min(QUIET_MS, Math.max(0, firstPendingAt + MAX_WAIT_MS - now));
  quietTimer = setTimeout(deliver, wait);
}

/**
 * Wraps a loader so only the newest call may apply its result. Refreshes overlap
 * (a signal arrives while the previous fetch is still in flight), and without this an
 * older, slower response could land last and put stale figures back on the screen.
 */
export function latestOnly<A extends unknown[], T>(
  fetcher: (...args: A) => Promise<T>,
): (...args: A) => Promise<{ fresh: true; value: T } | { fresh: false }> {
  let seq = 0;
  return async (...args: A) => {
    const mine = ++seq;
    const value = await fetcher(...args);
    return mine === seq ? { fresh: true, value } : { fresh: false };
  };
}

/** Subscribe outside React (module-level caches such as prices and customers). */
export function onLiveChange(tables: readonly LiveTable[], fn: () => void): () => void {
  const listener: Listener = (changed) => {
    if (tables.some((t) => changed.has(t))) fn();
  };
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * For component loaders: `const isCurrent = begin();` before fetching, and apply the
 * result only if `isCurrent()` is still true afterwards (see latestOnly).
 */
export function useLatestGuard(): () => () => boolean {
  const seq = useRef(0);
  return useCallback(() => {
    const mine = ++seq.current;
    return () => mine === seq.current;
  }, []);
}

/** Calls `refresh` whenever one of `tables` changes. Always uses the latest `refresh`. */
export function useLiveRefresh(tables: readonly LiveTable[], refresh: () => void): void {
  const latest = useRef(refresh);
  latest.current = refresh;
  const key = tables.join(',');
  useEffect(
    () => onLiveChange(key.split(',') as LiveTable[], () => latest.current()),
    [key],
  );
}

/** Sri Lanka is UTC+5:30 all year (no daylight saving), as on the server. */
const BUSINESS_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** Milliseconds until the next 00:00 in Sri Lanka. */
export function msUntilBusinessMidnight(now: number = Date.now()): number {
  const local = now + BUSINESS_OFFSET_MS;
  return (Math.floor(local / DAY_MS) + 1) * DAY_MS - local;
}

/**
 * Calls `refresh` just after midnight (Sri Lanka time), every night. "Today" starts
 * again from zero then, and a summary left open overnight must not keep showing
 * yesterday. Nothing is deleted: older days stay under the week/month/all periods
 * and in the history. (A tablet that slept through midnight refreshes when it wakes,
 * through the visibility catch-up in startLive.)
 */
export function useNewDayRefresh(refresh: () => void): void {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        latest.current();
        schedule();
      }, msUntilBusinessMidnight() + 2_000);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);
}

/** https://<ref>.supabase.co — given directly, or taken from the functions URL. */
function supabaseUrl(): string | null {
  const explicit = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  try {
    const url = new URL(API_URL);
    return url.pathname.startsWith('/functions/') ? url.origin : null;
  } catch {
    return null;
  }
}

let started = false;

/** Opens the live connection once per page. Without the key the app simply isn't live. */
export function startLive(): void {
  if (started) return;
  started = true;

  // Whatever happened while the tablet slept or was offline was missed: catch up.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') signal(ALL_TABLES);
  });
  window.addEventListener('online', () => signal(ALL_TABLES));

  const url = supabaseUrl();
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim();
  if (!url || !key) {
    console.info('[live] VITE_SUPABASE_PUBLISHABLE_KEY not set — live updates are off');
    return;
  }

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  let connectedBefore = false;
  client
    .channel('pos-changes')
    .on('broadcast', { event: 'change' }, ({ payload }) => {
      const table = (payload as { table?: string } | undefined)?.table;
      if (table && (ALL_TABLES as readonly string[]).includes(table)) signal([table as LiveTable]);
    })
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      // A reconnect after a drop: signals sent in between were lost.
      if (connectedBefore) signal(ALL_TABLES);
      connectedBefore = true;
    });
}
