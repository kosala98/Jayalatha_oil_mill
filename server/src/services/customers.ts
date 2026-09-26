import type { Prisma } from '@prisma/client';
import { Dec, money, toDec } from '../lib/decimal';
import { HttpError } from '../lib/errors';

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

export interface CustomerBalanceRow extends CustomerBalance {
  customerId: string;
}

/** One query per source for the whole set, rather than four per customer. */
export async function balancesFor(
  tx: Prisma.TransactionClient,
  customerIds: string[],
): Promise<Map<string, CustomerBalance>> {
  const out = new Map<string, CustomerBalance>();
  if (customerIds.length === 0) return out;

  const where = { isDeleted: false, customerId: { in: customerIds } };
  const [sales, purchases, payments] = await Promise.all([
    tx.sale.groupBy({ by: ['customerId'], where, _sum: { creditAmount: true, cashAmount: true, chequeAmount: true, total: true } }),
    tx.purchase.groupBy({ by: ['customerId'], where, _sum: { creditAmount: true, cashAmount: true, chequeAmount: true, total: true } }),
    tx.customerPayment.groupBy({ by: ['customerId', 'direction', 'kind'], where, _sum: { amount: true } }),
  ]);

  const pick = <T extends { customerId: string | null }>(rows: T[], id: string) => rows.find((r) => r.customerId === id);

  for (const id of customerIds) {
    const saleSums = pick(sales, id)?._sum;
    const purchaseSums = pick(purchases, id)?._sum;
    const creditSales = toDec(saleSums?.creditAmount);
    const creditPurchases = toDec(purchaseSums?.creditAmount);
    const sum = (direction: 'RECEIVED' | 'PAID', kind?: 'SETTLEMENT' | 'LOAN') =>
      payments
        .filter((p) => p.customerId === id && p.direction === direction && (kind ? p.kind === kind : true))
        .reduce((acc, p) => acc.plus(toDec(p._sum.amount)), new Dec(0));

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

export async function balanceFor(tx: Prisma.TransactionClient, customerId: string): Promise<CustomerBalance> {
  const map = await balancesFor(tx, [customerId]);
  return (
    map.get(customerId) ?? {
      salesTotal: '0.00',
      salesCash: '0.00',
      salesCheque: '0.00',
      purchasesTotal: '0.00',
      purchasesCash: '0.00',
      purchasesCheque: '0.00',
      creditSales: '0.00',
      creditPurchases: '0.00',
      received: '0.00',
      paid: '0.00',
      loanGiven: '0.00',
      loanTaken: '0.00',
      balance: '0.00',
    }
  );
}

/** Used by sales, purchases and payments: the customer must exist and be live. */
export async function requireLiveCustomer(tx: Prisma.TransactionClient, customerId: string) {
  const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, isDeleted: true } });
  if (!customer || customer.isDeleted) throw new HttpError(400, 'UNKNOWN_CUSTOMER', 'Unknown customer');
  return customer;
}

export const ZERO = new Dec(0);
