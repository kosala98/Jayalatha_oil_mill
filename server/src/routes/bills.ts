import { Router } from 'express';
import { prisma } from '../db';
import { notFound } from '../lib/errors';
import { requireSession } from '../middleware/auth';
import { balanceFor } from '../services/customers';

export const billsRouter = Router();

const BILL_NO = /^[A-Z0-9-]{3,32}$/;

/**
 * Everything printed on one receipt, fetched back by its number. Used to reprint a
 * bill days later — the customer keeps the paper, the mill keeps the number.
 *
 * The balances are recomputed now rather than stored: a reprint should show the truth
 * as it stands today, and "before" is simply today's balance minus what this bill did.
 */
billsRouter.get('/:billNo', requireSession, async (req, res) => {
  const billNo = String(req.params.billNo ?? '').toUpperCase();
  if (!BILL_NO.test(billNo)) throw notFound('Bill');

  const [sales, purchases, payments] = await Promise.all([
    prisma.sale.findMany({ where: { billNo, isDeleted: false }, orderBy: { createdAt: 'asc' } }),
    prisma.purchase.findMany({ where: { billNo, isDeleted: false }, orderBy: { createdAt: 'asc' } }),
    prisma.customerPayment.findMany({ where: { billNo, isDeleted: false }, orderBy: { createdAt: 'asc' } }),
  ]);
  if (sales.length + purchases.length + payments.length === 0) throw notFound('Bill');

  const customerId = sales[0]?.customerId ?? purchases[0]?.customerId ?? payments[0]?.customerId ?? null;
  const customer = customerId
    ? await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, phone: true } })
    : null;
  const balance = customerId ? (await balanceFor(prisma, customerId)).balance : null;

  const occurredAt = [...sales, ...purchases, ...payments]
    .map((r) => r.occurredAt)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  res.json({ billNo, occurredAt, customer, balanceNow: balance, sales, purchases, payments });
});
