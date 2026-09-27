import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/endpoints';
import type { PriceMap } from '../domain/prices';
import { latestOnly, onLiveChange } from './live';

const CACHE_KEY = 'pos.prices';

/**
 * The price book, shared by every screen. Cached on the device so the counter still
 * gets today's prices filled in when the connection is down, and refreshed whenever
 * someone changes them.
 */
let cache: PriceMap = read();
const listeners = new Set<() => void>();

function read(): PriceMap {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as PriceMap) : {};
  } catch {
    return {};
  }
}

function publish(next: PriceMap) {
  cache = next;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked — the prices still work for this session */
  }
  listeners.forEach((l) => l());
}

const fetchPrices = latestOnly(() => api.prices());

export async function refreshPrices(): Promise<void> {
  const result = await fetchPrices();
  if (!result.fresh) return; // a newer fetch is already on its way
  publish(Object.fromEntries(result.value.map((r) => [r.id, String(r.amount)])));
}

// Someone changed a price on another device: every open screen picks it up.
onLiveChange(['prices'], () => {
  refreshPrices().catch(() => {
    /* offline: the next reconnect catches up */
  });
});

/** Applies what was just saved, so every open screen sees it without a round trip. */
export function applyPrices(changed: PriceMap): void {
  publish({ ...cache, ...changed });
}

export function usePrices() {
  const [prices, setPrices] = useState<PriceMap>(cache);

  useEffect(() => {
    const listener = () => setPrices(cache);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      await refreshPrices();
    } catch {
      // Offline: keep whatever the device last saw.
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { prices, reload };
}
