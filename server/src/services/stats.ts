import { Prisma } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../db';
import { type Period, periodStart } from '../lib/period';
import { type Stats, summarise } from './statsSummary';

export type { Stats };

/** Reads everything in one REPEATABLE READ snapshot so the numbers agree with each other. */
export async function computeStats(period: Period): Promise<Stats> {
  const now = new Date();
  const from = periodStart(period, config.businessUtcOffsetMinutes, now);
  const inPeriod = { isDeleted: false, ...(from ? { occurredAt: { gte: from } } : {}) };

  const [
    products,
    saleGroups,
    purchaseGroups,
    cashGroups,
    salesWithCheque,
    salesWithCredit,
    purchasesWithCheque,
    purchasesWithCredit,
    paymentGroups,
    charcoalIn,
    charcoalOut,
    charcoalFixed,
    creditSales,
    creditPurchases,
    settlements,
  ] = await prisma.$transaction(
    [
      prisma.product.findMany({ select: { code: true, isCharcoal: true } }),
      prisma.sale.groupBy({
        by: ['productCode', 'unitType', 'bottleSize'],
        where: inPeriod,
        _sum: { quantity: true, total: true, cashAmount: true, chequeAmount: true, creditAmount: true, containerTotal: true },
        _count: { _all: true },
      }),
      prisma.purchase.groupBy({
        by: ['material'],
        where: inPeriod,
        _sum: { quantityKg: true, total: true, cashAmount: true, chequeAmount: true, creditAmount: true },
        _count: { _all: true },
      }),
      prisma.cashEntry.groupBy({
        by: ['type'],
        where: inPeriod,
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.sale.count({ where: { ...inPeriod, chequeAmount: { gt: 0 } } }),
      prisma.sale.count({ where: { ...inPeriod, creditAmount: { gt: 0 } } }),
      prisma.purchase.count({ where: { ...inPeriod, chequeAmount: { gt: 0 } } }),
      prisma.purchase.count({ where: { ...inPeriod, creditAmount: { gt: 0 } } }),
      prisma.customerPayment.groupBy({
        by: ['direction', 'method'],
        where: inPeriod,
        _sum: { amount: true },
        _count: { _all: true },
      }),
      // All-time, not period-scoped: stock is a level and a debt does not reset.
      prisma.purchase.aggregate({ where: { isDeleted: false, material: 'CHARCOAL' }, _sum: { quantityKg: true } }),
      prisma.sale.aggregate({ where: { isDeleted: false, product: { isCharcoal: true } }, _sum: { quantity: true } }),
      prisma.charcoalAdjustment.aggregate({ _sum: { deltaKg: true } }),
      prisma.sale.aggregate({ where: { isDeleted: false }, _sum: { creditAmount: true } }),
      prisma.purchase.aggregate({ where: { isDeleted: false }, _sum: { creditAmount: true } }),
      prisma.customerPayment.groupBy({
        by: ['direction'],
        where: { isDeleted: false },
        _sum: { amount: true },
      }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );

  return summarise({
    period,
    from,
    now,
    charcoalCodes: new Set(products.filter((p) => p.isCharcoal).map((p) => p.code)),
    sales: saleGroups.map((g) => ({
      productCode: g.productCode,
      unitType: g.unitType,
      bottleSize: g.bottleSize,
      quantity: g._sum.quantity,
      total: g._sum.total,
      cash: g._sum.cashAmount,
      cheque: g._sum.chequeAmount,
      credit: g._sum.creditAmount,
      containers: g._sum.containerTotal,
      count: g._count._all,
    })),
    purchases: purchaseGroups.map((g) => ({
      material: g.material,
      quantityKg: g._sum.quantityKg,
      total: g._sum.total,
      cash: g._sum.cashAmount,
      cheque: g._sum.chequeAmount,
      credit: g._sum.creditAmount,
      count: g._count._all,
    })),
    cash: cashGroups.map((g) => ({ type: g.type, amount: g._sum.amount, count: g._count._all })),
    payments: paymentGroups.map((g) => ({
      direction: g.direction,
      method: g.method,
      amount: g._sum.amount,
      count: g._count._all,
    })),
    counts: { salesWithCheque, salesWithCredit, purchasesWithCheque, purchasesWithCredit },
    allTime: {
      charcoalPurchasedKg: charcoalIn._sum.quantityKg,
      charcoalSoldKg: charcoalOut._sum.quantity,
      charcoalAdjustmentKg: charcoalFixed._sum.deltaKg,
      creditSales: creditSales._sum.creditAmount,
      creditPurchases: creditPurchases._sum.creditAmount,
      receivedFromCustomers: settlements.find((s) => s.direction === 'RECEIVED')?._sum.amount ?? 0,
      paidToCustomers: settlements.find((s) => s.direction === 'PAID')?._sum.amount ?? 0,
    },
  });
}
