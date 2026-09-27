import { createClient } from '@supabase/supabase-js';
import { useEffect, useRef } from 'react';
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
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Changes arriving close together (a visit saves a purchase, a sale and a settlement)
 * are delivered as one batch, so each screen fetches once rather than three times.
 */
function signal(tables: Iterable<LiveTable>): void {
  for (const t of tables) pending.add(t);
  if (timer) return;
  timer = setTimeout(() => {
    const batch = pending;
    pending = new Set();
    timer = null;
    listeners.forEach((l) => l(batch));
  }, 400);
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
