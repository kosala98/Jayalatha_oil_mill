import { Router } from 'express';
import { prisma } from '../db';
import { qty } from '../lib/decimal';
import { contextFrom } from '../lib/http';
import { charcoalAdjustmentSchema, chequeQuerySchema } from '../lib/validation';
import { requireAdmin } from '../middleware/auth';
import { writeAudit } from '../services/audit';
import { charcoalStockKg, lockCharcoalStock } from '../services/charcoal';
import { isUniqueViolation } from './helpers';

// ---------------------------------------------------------------------------
// Cheques due for deposit on a given day (or range)
// ---------------------------------------------------------------------------
export const chequesRouter = Router();

/**
 * Everything banked or presented between two dates, in one list: cheques taken
 * on sales and on settlements come IN, cheques written for purchases and to
 * customers go OUT. Deposit dates are plain calendar dates, so no time zone
 * maths happens here.
 */
chequesRouter.get('/', requireAdmin, async (req, res) => {
  const { from, to } = chequeQuerySchema.parse(req.query);
  const range = { gte: from, lte: to };
  const live = { isDeleted: false, chequeAmount: { gt: 0 }, chequeDepositDate: range };

  const [sales, purchases, payments] = await Promise.all([
    prisma.sale.findMany({
      where: live,
      orderBy: [{ chequeDepositDate: 'asc' }, { occurredAt: 'asc' }],
      include: { customer: { select: { id: true, name: true } } },
    }),
    prisma.purchase.findMany({
      where: live,
      orderBy: [{ chequeDepositDate: 'asc' }, { occurredAt: 'asc' }],
      include: { customer: { select: { id: true, name: true } } },
    }),
    prisma.customerPayment.findMany({
      where: { isDeleted: false, method: 'CHEQUE', chequeDepositDate: range },
      orderBy: [{ chequeDepositDate: 'asc' }, { occurredAt: 'asc' }],
      include: { customer: { select: { id: true, name: true } } },
    }),
  ]);

  const items = [
    ...sales.map((s) => ({
      id: s.id,
      kind: 'sale' as const,
      direction: 'IN' as const,
      chequeNumber: s.chequeNumber,
      depositDate: s.chequeDepositDate,
      amount: s.chequeAmount,
      occurredAt: s.occurredAt,
      detail: s.customName ?? s.productCode,
      customer: s.customer,
    })),
    ...purchases.map((p) => ({
      id: p.id,
      kind: 'purchase' as const,
      direction: 'OUT' as const,
      chequeNumber: p.chequeNumber,
      depositDate: p.chequeDepositDate,
      amount: p.chequeAmount,
      occurredAt: p.occurredAt,
      detail: p.customName ?? p.material,
      customer: p.customer,
    })),
    ...payments.map((p) => ({
      id: p.id,
      kind: 'payment' as const,
      direction: p.direction === 'RECEIVED' ? ('IN' as const) : ('OUT' as const),
      chequeNumber: p.chequeNumber,
      depositDate: p.chequeDepositDate,
      amount: p.amount,
      occurredAt: p.occurredAt,
      detail: p.direction,
      customer: p.customer,
    })),
  ].sort((a, b) => (a.depositDate?.getTime() ?? 0) - (b.depositDate?.getTime() ?? 0));

  const sum = (dir: 'IN' | 'OUT') =>
    items
      .filter((i) => i.direction === dir)
      .reduce((acc, i) => acc + Number(i.amount), 0)
      .toFixed(2);

  res.json({
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    incomingTotal: sum('IN'),
    outgoingTotal: sum('OUT'),
    items,
  });
});

// ---------------------------------------------------------------------------
// Charcoal stock corrections
// ---------------------------------------------------------------------------
export const charcoalRouter = Router();

charcoalRouter.get('/adjustments', requireAdmin, async (_req, res) => {
  const [adjustments, stock] = await Promise.all([
    prisma.charcoalAdjustment.findMany({ orderBy: { occurredAt: 'desc' }, take: 50 }),
    prisma.$transaction(async (tx) => charcoalStockKg(tx)),
  ]);
  res.json({ stockKg: qty(stock), adjustments });
});

/**
 * Sets computed charcoal stock to what is actually in the store — usually 0, to
 * clear the rounding and weighing difference left after a batch is sold out.
 * The underlying purchases and sales are never touched; a signed correction row
 * is added instead, so the history still adds up.
 */
charcoalRouter.post('/adjustments', requireAdmin, async (req, res) => {
  const input = charcoalAdjustmentSchema.parse(req.body);
  const ctx = contextFrom(req);

  const existing = await prisma.charcoalAdjustment.findUnique({ where: { clientId: input.clientId } });
  if (existing) {
    res.status(200).json(existing);
    return;
  }

  try {
    const adjustment = await prisma.$transaction(async (tx) => {
      // Same lock the sales take: the "previous" figure must not move underneath us.
      await lockCharcoalStock(tx);
      const previous = await charcoalStockKg(tx);
      const counted = input.countedKg;
      const delta = previous.minus(counted).negated(); // counted − previous

      if (delta.isZero()) {
        return { unchanged: true as const, stockKg: qty(previous) };
      }

      const created = await tx.charcoalAdjustment.create({
        data: {
          clientId: input.clientId,
          previousKg: previous.toFixed(3),
          countedKg: counted,
          deltaKg: delta.toFixed(3),
          reason: input.reason,
          occurredAt: input.occurredAt,
          installId: contextFrom(req).deviceId,
        },
      });
      await writeAudit(tx, {
        action: 'CREATE',
        entity: 'CHARCOAL_ADJUSTMENT',
        entityId: created.id,
        ctx,
        after: created,
        reason: input.reason,
      });
      return created;
    });

    if ('unchanged' in adjustment) {
      res.status(200).json(adjustment);
      return;
    }
    res.status(201).json(adjustment);
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await prisma.charcoalAdjustment.findUnique({ where: { clientId: input.clientId } });
      if (winner) {
        res.status(200).json(winner);
        return;
      }
    }
    throw err;
  }
});
