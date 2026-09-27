import { config } from '../config.ts';
import { type Row, transaction } from '../db.ts';
import { type Period, periodStart } from '../lib/period.ts';
import { type Stats, summarise } from './statsSummary.ts';

export type { Stats };

/** Reads everything in one REPEATABLE READ snapshot so the numbers agree with each other. */
export async function computeStats(period: Period): Promise<Stats> {
  const now = new Date();
  const from = periodStart(period, config.businessUtcOffsetMinutes, now);

  return await transaction(async (tx) => {
    const inPeriod = from ? tx`AND occurred_at >= ${from}` : tx``;

    const [products, sales, purchases, cash, counts, payments, allTime] = await Promise.all([
      tx<{ code: string; isCharcoal: boolean }[]>`SELECT code, is_charcoal FROM products`,
      tx<Row[]>`
        SELECT product_code, unit_type, bottle_size,
               sum(quantity) AS quantity, sum(total) AS total, sum(cash_amount) AS cash,
               sum(cheque_amount) AS cheque, sum(credit_amount) AS credit,
               sum(container_total) AS containers, count(*)::int AS count
        FROM sales WHERE is_deleted = false ${inPeriod}
        GROUP BY product_code, unit_type, bottle_size`,
      tx<Row[]>`
        SELECT material, sum(quantity_kg) AS quantity_kg, sum(total) AS total, sum(cash_amount) AS cash,
               sum(cheque_amount) AS cheque, sum(credit_amount) AS credit, count(*)::int AS count
        FROM purchases WHERE is_deleted = false ${inPeriod}
        GROUP BY material`,
      tx<Row[]>`
        SELECT type, sum(amount) AS amount, count(*)::int AS count
        FROM cash_entries WHERE is_deleted = false ${inPeriod}
        GROUP BY type`,
      tx<Row[]>`
        SELECT
          (SELECT count(*)::int FROM sales WHERE is_deleted = false AND cheque_amount > 0 ${inPeriod}) AS sales_with_cheque,
          (SELECT count(*)::int FROM sales WHERE is_deleted = false AND credit_amount > 0 ${inPeriod}) AS sales_with_credit,
          (SELECT count(*)::int FROM purchases WHERE is_deleted = false AND cheque_amount > 0 ${inPeriod}) AS purchases_with_cheque,
          (SELECT count(*)::int FROM purchases WHERE is_deleted = false AND credit_amount > 0 ${inPeriod}) AS purchases_with_credit`,
      tx<Row[]>`
        SELECT direction, method, sum(amount) AS amount, count(*)::int AS count
        FROM customer_payments WHERE is_deleted = false ${inPeriod}
        GROUP BY direction, method`,
      // All-time, not period-scoped: stock is a level and a debt does not reset.
      tx<Row[]>`
        SELECT
          (SELECT sum(quantity_kg) FROM purchases WHERE is_deleted = false AND material = 'CHARCOAL') AS charcoal_purchased_kg,
          (SELECT sum(s.quantity) FROM sales s JOIN products p ON p.code = s.product_code
            WHERE s.is_deleted = false AND p.is_charcoal) AS charcoal_sold_kg,
          (SELECT sum(delta_kg) FROM charcoal_adjustments) AS charcoal_adjustment_kg,
          (SELECT sum(credit_amount) FROM sales WHERE is_deleted = false) AS credit_sales,
          (SELECT sum(credit_amount) FROM purchases WHERE is_deleted = false) AS credit_purchases,
          (SELECT sum(amount) FROM customer_payments WHERE is_deleted = false AND direction = 'RECEIVED') AS received_from_customers,
          (SELECT sum(amount) FROM customer_payments WHERE is_deleted = false AND direction = 'PAID') AS paid_to_customers`,
    ]);

    const c = counts[0]!;
    const a = allTime[0]!;
    return summarise({
      period,
      from,
      now,
      charcoalCodes: new Set(products.filter((p) => p.isCharcoal).map((p) => p.code)),
      sales: sales.map((g) => ({
        productCode: g.productCode,
        unitType: g.unitType,
        bottleSize: g.bottleSize,
        quantity: g.quantity,
        total: g.total,
        cash: g.cash,
        cheque: g.cheque,
        credit: g.credit,
        containers: g.containers,
        count: g.count,
      })),
      purchases: purchases.map((g) => ({
        material: g.material,
        quantityKg: g.quantityKg,
        total: g.total,
        cash: g.cash,
        cheque: g.cheque,
        credit: g.credit,
        count: g.count,
      })),
      cash: cash.map((g) => ({ type: g.type, amount: g.amount, count: g.count })),
      payments: payments.map((g) => ({ direction: g.direction, method: g.method, amount: g.amount, count: g.count })),
      counts: {
        salesWithCheque: c.salesWithCheque,
        salesWithCredit: c.salesWithCredit,
        purchasesWithCheque: c.purchasesWithCheque,
        purchasesWithCredit: c.purchasesWithCredit,
      },
      allTime: {
        charcoalPurchasedKg: a.charcoalPurchasedKg,
        charcoalSoldKg: a.charcoalSoldKg,
        charcoalAdjustmentKg: a.charcoalAdjustmentKg,
        creditSales: a.creditSales,
        creditPurchases: a.creditPurchases,
        receivedFromCustomers: a.receivedFromCustomers,
        paidToCustomers: a.paidToCustomers,
      },
    });
  }, 'isolation level repeatable read read only');
}
