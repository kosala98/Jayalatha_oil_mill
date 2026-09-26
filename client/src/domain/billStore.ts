import { useSyncExternalStore } from 'react';
import type { BillData } from './bill';

/**
 * The bill waiting to be handed over. Any screen can put one here after it records a
 * transaction; the app shell shows it over everything else until the counter closes it.
 */
let pending: BillData | null = null;
const listeners = new Set<() => void>();

export function showBill(bill: BillData): void {
  pending = bill;
  listeners.forEach((l) => l());
}

export function closeBill(): void {
  pending = null;
  listeners.forEach((l) => l());
}

export function useBill(): BillData | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => pending,
    () => null,
  );
}
