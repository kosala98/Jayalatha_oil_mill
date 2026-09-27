import type { Db } from '../db.ts';
import { Dec, money, toDec } from '../lib/decimal.ts';
import { HttpError } from '../lib/errors.ts';

/**
 * A customer's position, always recomputed — never stored. A deleted sale or a
 * deleted payment therefore can't leave a phantom debt behind.
 *
 * balance = credit sales − settlements received − credit purchases + settlements paid
 * Positive: the customer owes the mill. Negative: the mill owes the customer.
 */
export interface CustomerBalance {
  /** Everything ever sold to them, however it was paid for. */
  salesTotal: string;
  salesCash: string;
  salesCheque: string;
  /** Everything ever bought from them. */
  purchasesTotal: string;
  purchasesCash: string;
  purchasesCheque: string;
  creditSales: string;
  creditPurchases: string;
  received: string;
  paid: string;
  /** Cash we handed him as a loan; he owes it back. */
  loanGiven: string;
  /** Cash we took from him as a loan; we owe it back. */
  loanTaken: string;
  balance: string;
}

interface PartSums {
  customerId: string;
  creditAmount: string | null;
  cashAmount: string | null;
  chequeAmount: string | null;
  total: string | null;
}

/** One query per source for the whole set, rather than four per customer. */
export async function balancesFor(tx: Db, customerIds: string[]): Promise<Map<string, CustomerBalance>> {
  const out = new Map<string, CustomerBalance>();
  if (customerIds.length === 0) return out;

  const [sales, purchases, payments] = await Promise.all([
    tx<PartSums[]>`
      SELECT customer_id, sum(credit_amount) AS credit_amount, sum(cash_amount) AS cash_amount,
             sum(cheque_amount) AS cheque_amount, sum(total) AS total
      FROM sales
      WHERE is_deleted = false AND customer_id = ANY(${customerIds}::uuid[])
      GROUP BY customer_id`,
    tx<PartSums[]>`
      SELECT customer_id, sum(credit_amount) AS credit_amount, sum(cash_amount) AS cash_amount,
             sum(cheque_amount) AS cheque_amount, sum(total) AS total
      FROM purchases
      WHERE is_deleted = false AND customer_id = ANY(${customerIds}::uuid[])
      GROUP BY customer_id`,
    tx<{ customerId: string; direction: string; kind: string; amount: string | null }[]>`
      SELECT customer_id, direction, kind, sum(amount) AS amount
      FROM customer_payments
      WHERE is_deleted = false AND customer_id = ANY(${customerIds}::uuid[])
      GROUP BY customer_id, direction, kind`,
  ]);

  for (const id of customerIds) {
    const saleSums = sales.find((r) => r.customerId === id);
    const purchaseSums = purchases.find((r) => r.customerId === id);
    const creditSales = toDec(saleSums?.creditAmount);
    const creditPurchases = toDec(purchaseSums?.creditAmount);
    const sum = (direction: 'RECEIVED' | 'PAID', kind?: 'SETTLEMENT' | 'LOAN') =>
      payments
        .filter((p) => p.customerId === id && p.direction === direction && (kind ? p.kind === kind : true))
        .reduce((acc, p) => acc.plus(toDec(p.amount)), new Dec(0));

    // Money in is money in, whatever it was for: the balance treats both the same.
    const received = sum('RECEIVED');
    const paid = sum('PAID');
    const loanGiven = sum('PAID', 'LOAN');
    const loanTaken = sum('RECEIVED', 'LOAN');
    out.set(id, {
      // The cash and cheque parts of a split sale are money this customer has already
      // handed over — the profile is wrong without them, even though the balance isn't.
      salesTotal: money(toDec(saleSums?.total)),
      salesCash: money(toDec(saleSums?.cashAmount)),
      salesCheque: money(toDec(saleSums?.chequeAmount)),
      purchasesTotal: money(toDec(purchaseSums?.total)),
      purchasesCash: money(toDec(purchaseSums?.cashAmount)),
      purchasesCheque: money(toDec(purchaseSums?.chequeAmount)),
      creditSales: money(creditSales),
      creditPurchases: money(creditPurchases),
      received: money(received),
      paid: money(paid),
      loanGiven: money(loanGiven),
      loanTaken: money(loanTaken),
      balance: money(creditSales.minus(received).minus(creditPurchases).plus(paid)),
    });
  }
  return out;
}

export async function balanceFor(tx: Db, customerId: string): Promise<CustomerBalance> {
  const map = await balancesFor(tx, [customerId]);
  return map.get(customerId)!;
}

/** Used by sales, purchases and payments: the customer must exist and be live. */
export async function requireLiveCustomer(tx: Db, customerId: string) {
  const [customer] = await tx<{ id: string; name: string; isDeleted: boolean }[]>`
    SELECT id, name, is_deleted FROM customers WHERE id = ${customerId}`;
  if (!customer || customer.isDeleted) throw new HttpError(400, 'UNKNOWN_CUSTOMER', 'Unknown customer');
  return customer;
}
