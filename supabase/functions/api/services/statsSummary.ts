import type { BottleSize, CashEntryType, PaymentDirection, PaymentMethod, PurchaseMaterial, UnitType } from '../lib/types.ts';
import { BOTTLE_LITERS, OTHER_PRODUCT_CODE } from '../lib/catalog.ts';
import { Dec, money, qty, toDec } from '../lib/decimal.ts';
import type { Period } from '../lib/period.ts';

// Pure functions only — no config, no DB — so this is unit-testable in isolation.

/** Each group carries the three payment parts alongside the total. */
export interface PaymentParts {
  cash: unknown;
  cheque: unknown;
  credit: unknown;
}
export interface SaleGroup extends PaymentParts {
  /** Empty bottles and cans sold alongside the oil. */
  containers?: unknown;
  productCode: string;
  unitType: UnitType;
  bottleSize: BottleSize | null;
  quantity: unknown;
  total: unknown;
  count: number;
}
export interface PurchaseGroup extends PaymentParts {
  material: PurchaseMaterial;
  quantityKg: unknown;
  total: unknown;
  count: number;
}
export interface CashGroup {
  type: CashEntryType;
  amount: unknown;
  count: number;
}
export interface PaymentGroup {
  direction: PaymentDirection;
  method: PaymentMethod;
  amount: unknown;
  count: number;
}

export interface ProductBreakdown {
  productCode: string;
  liters: string;
  kg: string;
  bottles: string;
  total: string;
  count: number;
}

export interface Stats {
  period: Period;
  from: string | null;
  generatedAt: string;
  cashBalance: string;
  cash: {
    openingFloat: string;
    topUps: string;
    expenses: string;
    entriesTotal: string;
    cashSales: string;
    cashPurchases: string;
    customerReceived: string;
    customerPaid: string;
  };
  sales: { total: string; cash: string; cheque: string; credit: string; count: number; chequeCount: number; creditCount: number };
  purchases: {
    total: string;
    cash: string;
    cheque: string;
    credit: string;
    count: number;
    chequeCount: number;
    creditCount: number;
    byMaterial: { material: PurchaseMaterial; quantityKg: string; total: string; count: number }[];
  };
  litersSold: string;
  kgSold: string;
  /** Money taken for empty bottles and cans, already inside sales.total. */
  containerSales: string;
  charcoal: { soldKg: string; purchasedKg: string; adjustmentKg: string; stockKg: string };
  /** All-time credit position, not period-scoped: a debt does not reset every month. */
  customers: {
    creditSales: string;
    creditPurchases: string;
    received: string;
    paid: string;
    /** Positive = customers owe the mill. Negative = the mill owes customers. */
    netReceivable: string;
  };
  products: ProductBreakdown[];
}

export interface AllTimeTotals {
  charcoalPurchasedKg: unknown;
  charcoalSoldKg: unknown;
  charcoalAdjustmentKg: unknown;
  creditSales: unknown;
  creditPurchases: unknown;
  receivedFromCustomers: unknown;
  paidToCustomers: unknown;
}

/**
 * Pure summarisation of grouped rows → stats. Kept free of I/O so it's unit-testable.
 *
 * cashBalance = opening float + top-ups − expenses
 *             + CASH sales − CASH purchases
 *             + CASH settlements received − CASH settlements paid
 *   Cheques and credit never touch the drawer; they land when they are settled.
 * litersSold  = LITER quantities + BOTTLE count × bottle size, non-charcoal only
 * kgSold      = KG quantities, non-charcoal only (charcoal reported separately)
 *   "වෙනත්" sales stay out of both: the unit means nothing without a known product.
 */
export function summarise(input: {
  period: Period;
  from: Date | undefined;
  now: Date;
  charcoalCodes: Set<string>;
  sales: SaleGroup[];
  purchases: PurchaseGroup[];
  cash: CashGroup[];
  payments: PaymentGroup[];
  /** How many transactions carried a cheque or a credit part (a split counts in both). */
  counts: { salesWithCheque: number; salesWithCredit: number; purchasesWithCheque: number; purchasesWithCredit: number };
  allTime: AllTimeTotals;
}): Stats {
  const zero = () => new Dec(0);

  let salesTotal = zero(), salesCash = zero(), salesCheque = zero(), salesCredit = zero();
  let salesCount = 0;
  let liters = zero(), kg = zero(), charcoalSold = zero(), containers = zero();
  const perProduct = new Map<string, { liters: Dec; kg: Dec; bottles: Dec; total: Dec; count: number }>();

  for (const g of input.sales) {
    const q = toDec(g.quantity);
    const t = toDec(g.total);
    salesTotal = salesTotal.plus(t);
    salesCount += g.count;
    salesCash = salesCash.plus(toDec(g.cash));
    salesCheque = salesCheque.plus(toDec(g.cheque));
    salesCredit = salesCredit.plus(toDec(g.credit));
    containers = containers.plus(toDec(g.containers));

    const p = perProduct.get(g.productCode) ?? { liters: zero(), kg: zero(), bottles: zero(), total: zero(), count: 0 };
    p.total = p.total.plus(t);
    p.count += g.count;

    // "වෙනත්" can be anything, so its litres and kilos are not mill output.
    const countsTowardTotals = g.productCode !== OTHER_PRODUCT_CODE;
    if (input.charcoalCodes.has(g.productCode)) {
      charcoalSold = charcoalSold.plus(q);
      p.kg = p.kg.plus(q);
    } else if (g.unitType === 'LITER') {
      if (countsTowardTotals) liters = liters.plus(q);
      p.liters = p.liters.plus(q);
    } else if (g.unitType === 'KG') {
      if (countsTowardTotals) kg = kg.plus(q);
      p.kg = p.kg.plus(q);
    } else if (g.unitType === 'BOTTLE' && g.bottleSize) {
      const l = q.times(BOTTLE_LITERS[g.bottleSize]);
      if (countsTowardTotals) liters = liters.plus(l);
      p.liters = p.liters.plus(l);
      p.bottles = p.bottles.plus(q);
    }
    perProduct.set(g.productCode, p);
  }

  let purTotal = zero(), purCash = zero(), purCheque = zero(), purCredit = zero();
  let purCount = 0;
  const byMaterial = new Map<PurchaseMaterial, { quantityKg: Dec; total: Dec; count: number }>();
  for (const g of input.purchases) {
    const t = toDec(g.total);
    purTotal = purTotal.plus(t);
    purCount += g.count;
    purCash = purCash.plus(toDec(g.cash));
    purCheque = purCheque.plus(toDec(g.cheque));
    purCredit = purCredit.plus(toDec(g.credit));
    const m = byMaterial.get(g.material) ?? { quantityKg: zero(), total: zero(), count: 0 };
    m.quantityKg = m.quantityKg.plus(toDec(g.quantityKg));
    m.total = m.total.plus(t);
    m.count += g.count;
    byMaterial.set(g.material, m);
  }

  let opening = zero(), topUps = zero(), expenses = zero();
  for (const g of input.cash) {
    const a = toDec(g.amount);
    if (g.type === 'OPENING_FLOAT') opening = opening.plus(a);
    else if (g.type === 'TOP_UP') topUps = topUps.plus(a);
    else expenses = expenses.plus(a);
  }

  // Only cash settlements move the drawer; a cheque from a customer waits to clear.
  let receivedCash = zero(), paidCash = zero();
  for (const g of input.payments) {
    if (g.method !== 'CASH') continue;
    const a = toDec(g.amount);
    if (g.direction === 'RECEIVED') receivedCash = receivedCash.plus(a);
    else paidCash = paidCash.plus(a);
  }

  const entriesTotal = opening.plus(topUps).minus(expenses);
  const cashBalance = entriesTotal.plus(salesCash).minus(purCash).plus(receivedCash).minus(paidCash);

  const charcoalPurchased = toDec(input.allTime.charcoalPurchasedKg);
  const charcoalAdjustment = toDec(input.allTime.charcoalAdjustmentKg);
  const charcoalStock = charcoalPurchased.minus(toDec(input.allTime.charcoalSoldKg)).plus(charcoalAdjustment);

  const creditSales = toDec(input.allTime.creditSales);
  const creditPurchases = toDec(input.allTime.creditPurchases);
  const received = toDec(input.allTime.receivedFromCustomers);
  const paid = toDec(input.allTime.paidToCustomers);
  const netReceivable = creditSales.minus(received).minus(creditPurchases).plus(paid);

  return {
    period: input.period,
    from: input.from ? input.from.toISOString() : null,
    generatedAt: input.now.toISOString(),
    cashBalance: money(cashBalance),
    cash: {
      openingFloat: money(opening),
      topUps: money(topUps),
      expenses: money(expenses),
      entriesTotal: money(entriesTotal),
      cashSales: money(salesCash),
      cashPurchases: money(purCash),
      customerReceived: money(receivedCash),
      customerPaid: money(paidCash),
    },
    sales: {
      total: money(salesTotal),
      cash: money(salesCash),
      cheque: money(salesCheque),
      credit: money(salesCredit),
      count: salesCount,
      chequeCount: input.counts.salesWithCheque,
      creditCount: input.counts.salesWithCredit,
    },
    purchases: {
      total: money(purTotal),
      cash: money(purCash),
      cheque: money(purCheque),
      credit: money(purCredit),
      count: purCount,
      chequeCount: input.counts.purchasesWithCheque,
      creditCount: input.counts.purchasesWithCredit,
      byMaterial: [...byMaterial.entries()].map(([material, m]) => ({
        material,
        quantityKg: qty(m.quantityKg),
        total: money(m.total),
        count: m.count,
      })),
    },
    litersSold: qty(liters),
    kgSold: qty(kg),
    containerSales: money(containers),
    charcoal: {
      soldKg: qty(charcoalSold),
      purchasedKg: qty(charcoalPurchased),
      adjustmentKg: qty(charcoalAdjustment),
      stockKg: qty(charcoalStock),
    },
    customers: {
      creditSales: money(creditSales),
      creditPurchases: money(creditPurchases),
      received: money(received),
      paid: money(paid),
      netReceivable: money(netReceivable),
    },
    products: [...perProduct.entries()].map(([productCode, p]) => ({
      productCode,
      liters: qty(p.liters),
      kg: qty(p.kg),
      bottles: p.bottles.toFixed(0),
      total: money(p.total),
      count: p.count,
    })),
  };
}
