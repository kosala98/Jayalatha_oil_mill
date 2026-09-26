import { Router } from 'express';
import { prisma } from '../db';
import { assertPartsMatchTotal } from '../lib/validation';
import { computeTotal } from '../lib/decimal';
import { HttpError, notFound } from '../lib/errors';
import { contextFrom } from '../lib/http';
import { createPurchaseSchema, deleteSchema, idParamSchema, listQuerySchema } from '../lib/validation';
import { requireAdmin, requireSession } from '../middleware/auth';
import { writeAudit } from '../services/audit';
import { requireLiveCustomer } from '../services/customers';
import { lockCharcoalStock } from '../services/charcoal';
import { isUniqueViolation, listArgs, page } from './helpers';

export const purchasesRouter = Router();

purchasesRouter.post('/', requireSession, async (req, res) => {
  const input = createPurchaseSchema.parse(req.body);
  const ctx = contextFrom(req);

  const existing = await prisma.purchase.findUnique({ where: { clientId: input.clientId } });
  if (existing) {
    res.status(200).json(existing);
    return;
  }

  try {
    const purchase = await prisma.$transaction(async (tx) => {
      if (input.customerId) await requireLiveCustomer(tx, input.customerId);
      if (input.material === 'CHARCOAL') await lockCharcoalStock(tx);
      const total = computeTotal(input.quantityKg, input.pricePerKg);
      assertPartsMatchTotal(input, total);

      const created = await tx.purchase.create({
        data: {
          clientId: input.clientId,
          material: input.material,
          customName: input.customName,
          billNo: input.billNo,
          grossKg: input.grossKg,
          deductionKg: input.deductionKg,
          deductions: input.deductions ?? undefined,
          quantityKg: input.quantityKg,
          pricePerKg: input.pricePerKg,
          total: total.toFixed(2),
          cashAmount: input.cashAmount,
          chequeAmount: input.chequeAmount,
          creditAmount: input.creditAmount,
          chequeNumber: input.chequeNumber,
          chequeDepositDate: input.chequeDepositDate,
          customerId: input.customerId,
          occurredAt: input.occurredAt,
          installId: contextFrom(req).deviceId,
        },
      });
      await writeAudit(tx, { action: 'CREATE', entity: 'PURCHASE', entityId: created.id, ctx, after: created });
      return created;
    });
    res.status(201).json(purchase);
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await prisma.purchase.findUnique({ where: { clientId: input.clientId } });
      if (winner) {
        res.status(200).json(winner);
        return;
      }
    }
    throw err;
  }
});

purchasesRouter.get('/', requireAdmin, async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const rows = await prisma.purchase.findMany(listArgs(q));
  res.json(page(rows, q.limit));
});

purchasesRouter.delete('/:id', requireAdmin, async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const { reason } = deleteSchema.parse(req.body ?? {});
  const ctx = contextFrom(req);

  const deleted = await prisma.$transaction(async (tx) => {
    const before = await tx.purchase.findUnique({ where: { id } });
    if (!before) throw notFound('Purchase');
    if (before.isDeleted) throw new HttpError(409, 'ALREADY_DELETED', 'This purchase is already deleted');
    // Deleting a charcoal purchase lowers stock; take the same lock sales use.
    if (before.material === 'CHARCOAL') await lockCharcoalStock(tx);

    const { count } = await tx.purchase.updateMany({
      where: { id, isDeleted: false },
      data: { isDeleted: true, deletedAt: new Date(), deleteReason: reason },
    });
    if (count !== 1) throw new HttpError(409, 'ALREADY_DELETED', 'This purchase is already deleted');

    const after = await tx.purchase.findUniqueOrThrow({ where: { id } });
    await writeAudit(tx, { action: 'DELETE', entity: 'PURCHASE', entityId: id, ctx, before, after, reason });
    return after;
  });
  res.json(deleted);
});
