import { useSyncExternalStore } from 'react';
import type { BottleSize, PurchaseMaterial, UnitType } from './types';

/**
 * The counter visit in progress. A purchase typed on the purchase screen and a sale
 * typed on the sale screen belong to the same visit when the cashier says so, so the
 * lines live here rather than inside either screen.
 *
 * Each line carries how it was paid for, because that is decided at the moment the
 * goods are weighed — not in a summary at the end.
 */
export interface LinePayment {
  cashAmount: string;
  chequeAmount: string;
  creditAmount: string;
  chequeNumber: string | null;
  chequeDepositDate: string | null;
  customerId: string | null;
}

export interface SaleLine extends LinePayment {
  id: string;
  kind: 'sale';
  productCode: string;
  label: string;
  unitType: UnitType;
  bottleSize: BottleSize | null;
  customName: string | null;
  quantity: string;
  price: string;
  containerCount: number;
  containerPrice: string;
  total: string;
}

export interface PurchaseLine extends LinePayment {
  id: string;
  kind: 'purchase';
  material: PurchaseMaterial;
  label: string;
  customName: string | null;
  grossKg?: string;
  deductions?: { kind: string; kg: string }[];
  quantityKg: string;
  price: string;
  total: string;
}

export type BasketLine = SaleLine | PurchaseLine;

let lines: BasketLine[] = [];
const listeners = new Set<() => void>();

function publish(next: BasketLine[]) {
  lines = next;
  listeners.forEach((l) => l());
}

export function addLine(line: BasketLine): void {
  publish([...lines, line]);
}

export function removeLine(id: string): void {
  publish(lines.filter((l) => l.id !== id));
}

export function clearBasket(): void {
  publish([]);
}

export function basketLines(): BasketLine[] {
  return lines;
}

/** Positive: the customer owes the mill. Negative: the mill owes the customer. */
export function basketNet(list: BasketLine[] = lines): number {
  const sales = list.filter((l) => l.kind === 'sale').reduce((acc, l) => acc + Number(l.total), 0);
  const purchases = list.filter((l) => l.kind === 'purchase').reduce((acc, l) => acc + Number(l.total), 0);
  return Math.round((sales - purchases) * 100) / 100;
}

/** Each way of paying, across the visit: money in on sales minus money out on purchases. */
export function basketPayments(list: BasketLine[] = lines) {
  const sum = (key: 'cashAmount' | 'chequeAmount' | 'creditAmount') =>
    Math.round(list.reduce((acc, l) => acc + (l.kind === 'sale' ? 1 : -1) * Number(l[key] || 0), 0) * 100) / 100;
  return { cash: sum('cashAmount'), cheque: sum('chequeAmount'), credit: sum('creditAmount') };
}

/** The customer this visit is tied to, if any line named one. */
export function basketCustomerId(list: BasketLine[] = lines): string | null {
  return list.find((l) => l.customerId)?.customerId ?? null;
}

export function useBasket(): BasketLine[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    basketLines,
    () => [],
  );
}
