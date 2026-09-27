import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/endpoints';
import type { Customer } from '../domain/types';
import { onLiveChange } from './live';

const CACHE_KEY = 'pos.customers';

/**
 * One customer list for the whole app. It used to be per-screen, which meant a name
 * added on the customers tab was invisible to the picker on the sale screen until a
 * reload — so the list lives here, and every screen watches the same copy.
 *
 * The last good list is also kept on the device: the connection is the least reliable
 * part of the mill, and a credit sale needs a name to point at.
 */
function read(): Customer[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Customer[]) : [];
  } catch {
    return [];
  }
}

let cache: Customer[] = read();
let lastFetchFailed = false;
const listeners = new Set<() => void>();

function publish(next: Customer[]) {
  cache = next;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked — the list still works for this session */
  }
  listeners.forEach((l) => l());
}

export async function refreshCustomers(): Promise<void> {
  try {
    publish(await api.customers());
    lastFetchFailed = false;
  } catch {
    // Offline or server down: keep showing what we had.
    lastFetchFailed = true;
    listeners.forEach((l) => l());
  }
}

// New customers, and every transaction that moves a balance, refresh the shared list.
onLiveChange(['customers', 'sales', 'purchases', 'customer_payments'], () => {
  void refreshCustomers();
});

/** Puts a newly created customer in front of every screen at once. */
export function addCustomerLocally(customer: Customer): void {
  publish([...cache.filter((c) => c.id !== customer.id), customer].sort((a, b) => a.name.localeCompare(b.name)));
}

export function useCustomers() {
  const [customers, setCustomers] = useState<Customer[]>(cache);
  const [stale, setStale] = useState(lastFetchFailed);
  const [loading, setLoading] = useState(cache.length === 0);

  useEffect(() => {
    const listener = () => {
      setCustomers(cache);
      setStale(lastFetchFailed);
      setLoading(false);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    await refreshCustomers();
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { customers, loading, stale, reload, addLocal: addCustomerLocally };
}
