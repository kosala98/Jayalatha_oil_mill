import { Router } from 'express';
import { prisma } from '../db';
import { config } from '../config';
import { assertPartsMatchTotal } from '../lib/validation';
import { computeContainerTotal, computeTotal, qty } from '../lib/decimal';
import { HttpError, notFound } from '../lib/errors';
import { contextFrom } from '../lib/http';
import { createSaleSchema, deleteSchema, idParamSchema, listQuerySchema } from '../lib/validation';
import { requireAdmin, requireSession } from '../middleware/auth';
import { writeAudit } from '../services/audit';
import { requireLiveCustomer } from '../services/customers';
import { charcoalStockKg, lockCharcoalStock } from '../services/charcoal';
import { isUniqueViolation, listArgs, page } from './helpers';

export const salesRouter = Router();

salesRouter.post('/', requireSession, async (req, res) => {
  const input = createSaleSchema.parse(req.body);
  const ctx = contextFrom(req);

  // Idempotency: an offline re-send of the same transaction returns the original.
  const existing = await prisma.sale.findUnique({ where: { clientId: input.clientId } });
  if (existing) {
    res.status(200).json(existing);
    return;
  }

  try {
    const sale = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { code: input.productCode } });
      if (!product || !product.active) {
        throw new HttpError(400, 'UNKNOWN_PRODUCT', `Unknown product ${input.productCode}`);
      }
      if (!product.allowedUnits.includes(input.unitType)) {
        throw new HttpError(400, 'UNIT_NOT_ALLOWED', `${product.nameEn} cannot be sold by ${input.unitType}`);
      }

      if (input.customerId) await requireLiveCustomer(tx, input.customerId);

      if (product.isCharcoal) {
        await lockCharcoalStock(tx);
        const stock = await charcoalStockKg(tx);
        if (!config.allowNegativeCharcoalStock && stock.lt(input.quantity)) {
          throw new HttpError(409, 'INSUFFICIENT_CHARCOAL_STOCK', 'Not enough charcoal in stock', {
            availableKg: qty(stock),
            requestedKg: input.quantity,
          });
        }
      }

      const containerTotal = computeContainerTotal(input.containerCount, input.containerPrice);
      const total = computeTotal(input.quantity, input.pricePerUnit).plus(containerTotal);
      assertPartsMatchTotal(input, total);

      const created = await tx.sale.create({
        data: {
          clientId: input.clientId,
          productCode: product.code,
          unitType: input.unitType,
          bottleSize: input.bottleSize,
          billNo: input.billNo,
          customName: input.customName,
          containerCount: input.containerCount,
          containerPrice: input.containerCount > 0 ? input.containerPrice : '0',
          containerTotal: containerTotal.toFixed(2),
          quantity: input.quantity,
          pricePerUnit: input.pricePerUnit,
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
      await writeAudit(tx, { action: 'CREATE', entity: 'SALE', entityId: created.id, ctx, after: created });
      return created;
    });
    res.status(201).json(sale);
  } catch (err) {
    // Two copies of the same offline send raced each other; return the winner.
    if (isUniqueViolation(err)) {
      const winner = await prisma.sale.findUnique({ where: { clientId: input.clientId } });
      if (winner) {
        res.status(200).json(winner);
        return;
      }
    }
    throw err;
  }
});

salesRouter.get('/', requireAdmin, async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const rows = await prisma.sale.findMany(listArgs(q));
  res.json(page(rows, q.limit));
});

salesRouter.delete('/:id', requireAdmin, async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const { reason } = deleteSchema.parse(req.body ?? {});
  const ctx = contextFrom(req);

  const deleted = await prisma.$transaction(async (tx) => {
    const before = await tx.sale.findUnique({ where: { id }, include: { product: { select: { isCharcoal: true } } } });
    if (!before) throw notFound('Sale');
    if (before.isDeleted) throw new HttpError(409, 'ALREADY_DELETED', 'This sale is already deleted');
    if (before.product.isCharcoal) await lockCharcoalStock(tx);

    const { count } = await tx.sale.updateMany({
      where: { id, isDeleted: false },
      data: { isDeleted: true, deletedAt: new Date(), deleteReason: reason },
    });
    if (count !== 1) throw new HttpError(409, 'ALREADY_DELETED', 'This sale is already deleted');

    const after = await tx.sale.findUniqueOrThrow({ where: { id } });
    const { product: _p, ...beforeRow } = before;
    await writeAudit(tx, { action: 'DELETE', entity: 'SALE', entityId: id, ctx, before: beforeRow, after, reason });
    return after;
  });
  res.json(deleted);
});
