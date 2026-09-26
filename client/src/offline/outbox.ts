/**
 * The outbox is what makes "never lose a submitted transaction" true.
 *
 *  1. submit() writes the transaction to IndexedDB BEFORE touching the network.
 *  2. It then tries to POST it. Success → removed from the outbox.
 *  3. Network failure / 5xx → it stays, and flush() retries it later, in order.
 *  4. Every transaction carries a device-generated clientId; the server treats a
 *     repeated clientId as "already have it", so retries can never double-record.
 *  5. If the server rejects a *queued* item (e.g. not enough charcoal), it is kept
 *     and marked 'failed' for a person to retry or consciously discard — never silently dropped.
 */
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import { ApiError, request } from '../api/http';
import { COLLECTION_PATH, type HistoryKind } from '../api/endpoints';
import { notifySessionExpired } from '../auth/sessionEvents';
import { uuid } from '../lib/ids';

/** Everything that must survive a dead connection, not just the three history kinds. */
export type OutboxKind = HistoryKind | 'customer';

export interface OutboxItem {
  clientId: string;
  kind: OutboxKind;
  payload: Record<string, unknown> & { clientId: string; occurredAt: string };
  queuedAt: number;
  attempts: number;
  nextAttemptAt: number;
  status: 'pending' | 'failed';
  lastError?: { status: number; code: string; message: string; details?: unknown };
}

interface OutboxDB extends DBSchema {
  outbox: { key: string; value: OutboxItem; indexes: { 'by-queued': number } };
}

export type SubmitResult<T> =
  | { status: 'sent'; record: T }
  | { status: 'queued' }
  | { status: 'rejected'; error: unknown };

let dbPromise: Promise<IDBPDatabase<OutboxDB>> | null = null;
function db() {
  dbPromise ??= openDB<OutboxDB>('coconut-pos', 1, {
    upgrade(d) {
      const store = d.createObjectStore('outbox', { keyPath: 'clientId' });
      store.createIndex('by-queued', 'queuedAt');
    },
  });
  return dbPromise;
}

// ---------- change notifications (for the status pill / sheet) ----------
type Listener = (items: OutboxItem[]) => void;
const listeners = new Set<Listener>();
async function notify() {
  const items = await all();
  listeners.forEach((l) => l(items));
  // Other tabs on the same device
  channel?.postMessage('changed');
}
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('coconut-pos-outbox') : null;
channel?.addEventListener('message', async () => {
  const items = await all();
  listeners.forEach((l) => l(items));
});

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  void all().then(listener);
  return () => listeners.delete(listener);
}

export async function all(): Promise<OutboxItem[]> {
  try {
    return await (await db()).getAllFromIndex('outbox', 'by-queued');
  } catch {
    return [];
  }
}

async function put(item: OutboxItem) {
  await (await db()).put('outbox', item);
}
async function remove(clientId: string) {
  await (await db()).delete('outbox', clientId);
}

function send<T>(item: OutboxItem): Promise<T> {
  return request<T>(COLLECTION_PATH[item.kind], { method: 'POST', body: item.payload });
}

/**
 * The session expired while the transaction sat in the queue. Not the cashier's
 * mistake and not a reason to drop it: keep it queued until someone signs in again.
 */
function isSessionError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

function backoffMs(attempts: number) {
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.min(attempts, 6));
}

function errorInfo(err: unknown): NonNullable<OutboxItem['lastError']> {
  if (err instanceof ApiError) return { status: err.status, code: err.code, message: err.message, details: err.details };
  return { status: 0, code: 'UNKNOWN', message: String(err) };
}

/**
 * Record a transaction. Resolves only after it is durably stored (in IndexedDB or
 * on the server). If neither is possible, it throws — the UI must then say "not saved".
 */
export async function submit<T>(kind: OutboxKind, data: object): Promise<SubmitResult<T>> {
  const payload = { ...data, clientId: uuid(), occurredAt: new Date().toISOString() };
  const item: OutboxItem = {
    clientId: payload.clientId,
    kind,
    payload,
    queuedAt: Date.now(),
    attempts: 0,
    // Keep background flushes off this item while the immediate send below is in flight.
    nextAttemptAt: Date.now() + 20_000,
    status: 'pending',
  };

  let stored = false;
  try {
    await put(item);
    stored = true;
    void notify();
  } catch {
    // IndexedDB unavailable (private mode, storage full). Fall through to a direct send.
  }

  try {
    const record = await send<T>(item);
    if (stored) {
      await remove(item.clientId);
      void notify();
    }
    return { status: 'sent', record };
  } catch (err) {
    const expired = isSessionError(err);
    if (expired) notifySessionExpired();
    const retryable = expired || (err instanceof ApiError ? err.isRetryable : true);
    if (retryable && stored) {
      await put({ ...item, attempts: 1, nextAttemptAt: Date.now() + backoffMs(1), lastError: errorInfo(err) });
      void notify();
      return { status: 'queued' };
    }
    if (retryable && !stored) throw err; // nowhere to keep it: caller must show "not saved"
    // The server said no while the cashier is still looking at the form: let them fix it.
    if (stored) {
      await remove(item.clientId);
      void notify();
    }
    return { status: 'rejected', error: err };
  }
}

let flushing: Promise<void> | null = null;

/** Send queued items oldest-first. Stops at the first network failure to keep order. */
export function flush(opts: { force?: boolean } = {}): Promise<void> {
  flushing ??= doFlush(opts.force ?? false).finally(() => {
    flushing = null;
  });
  return flushing;
}

async function doFlush(force: boolean) {
  const run = async () => {
    const items = await all();
    for (const item of items) {
      if (item.status !== 'pending') continue;
      if (!force && item.nextAttemptAt > Date.now()) continue;
      try {
        await send(item);
        await remove(item.clientId);
      } catch (err) {
        const expired = isSessionError(err);
        if (expired) notifySessionExpired();
        const retryable = expired || (err instanceof ApiError ? err.isRetryable : true);
        const attempts = item.attempts + 1;
        await put({
          ...item,
          attempts,
          status: retryable ? 'pending' : 'failed',
          nextAttemptAt: Date.now() + backoffMs(attempts),
          lastError: errorInfo(err),
        });
        if (retryable) break; // offline or server down — later items would fail too, and order matters
      }
    }
    await notify();
  };

  // One flusher across tabs. The clientId makes overlap harmless anyway; this just avoids waste.
  if (navigator.locks?.request) {
    await navigator.locks.request('coconut-pos-outbox', { ifAvailable: true }, async (lock) => {
      if (lock) await run();
    });
  } else {
    await run();
  }
}

export async function retry(clientId: string) {
  const item = await (await db()).get('outbox', clientId);
  if (!item) return;
  await put({ ...item, status: 'pending', nextAttemptAt: 0 });
  await flush({ force: true });
}

/** Only ever called after the person confirms they want this transaction gone. */
export async function discard(clientId: string) {
  await remove(clientId);
  await notify();
}

let started = false;
/** Wire up automatic syncing. Call once at startup. */
export function startOutboxSync() {
  if (started) return;
  started = true;
  // Ask the browser not to evict our storage under pressure.
  void navigator.storage?.persist?.();
  const kick = () => void flush();
  window.addEventListener('online', () => void flush({ force: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kick();
  });
  setInterval(async () => {
    if ((await all()).some((i) => i.status === 'pending')) kick();
  }, 15_000);
  kick();
}
