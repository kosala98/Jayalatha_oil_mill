import { Router } from 'express';
import { prisma } from '../db';
import { HttpError, notFound } from '../lib/errors';
import { contextFrom } from '../lib/http';
import { createCashEntrySchema, deleteSchema, idParamSchema, listQuerySchema } from '../lib/validation';
import { requireAdmin, requireSession } from '../middleware/auth';
import { writeAudit } from '../services/audit';
import { isUniqueViolation, listArgs, page } from './helpers';

export const cashEntriesRouter = Router();

cashEntriesRouter.post('/', requireSession, async (req, res) => {
  const input = createCashEntrySchema.parse(req.body);
  const ctx = contextFrom(req);

  const existing = await prisma.cashEntry.findUnique({ where: { clientId: input.clientId } });
  if (existing) {
    res.status(200).json(existing);
    return;
  }

  try {
    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.cashEntry.create({
        data: {
          clientId: input.clientId,
          type: input.type,
          amount: input.amount,
          note: input.note,
          occurredAt: input.occurredAt,
          installId: contextFrom(req).deviceId,
        },
      });
      await writeAudit(tx, { action: 'CREATE', entity: 'CASH_ENTRY', entityId: created.id, ctx, after: created });
      return created;
    });
    res.status(201).json(entry);
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await prisma.cashEntry.findUnique({ where: { clientId: input.clientId } });
      if (winner) {
        res.status(200).json(winner);
        return;
      }
    }
    throw err;
  }
});

cashEntriesRouter.get('/', requireAdmin, async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const rows = await prisma.cashEntry.findMany(listArgs(q));
  res.json(page(rows, q.limit));
});

cashEntriesRouter.delete('/:id', requireAdmin, async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const { reason } = deleteSchema.parse(req.body ?? {});
  const ctx = contextFrom(req);

  const deleted = await prisma.$transaction(async (tx) => {
    const before = await tx.cashEntry.findUnique({ where: { id } });
    if (!before) throw notFound('Cash entry');
    if (before.isDeleted) throw new HttpError(409, 'ALREADY_DELETED', 'This cash entry is already deleted');

    const { count } = await tx.cashEntry.updateMany({
      where: { id, isDeleted: false },
      data: { isDeleted: true, deletedAt: new Date(), deleteReason: reason },
    });
    if (count !== 1) throw new HttpError(409, 'ALREADY_DELETED', 'This cash entry is already deleted');

    const after = await tx.cashEntry.findUniqueOrThrow({ where: { id } });
    await writeAudit(tx, { action: 'DELETE', entity: 'CASH_ENTRY', entityId: id, ctx, before, after, reason });
    return after;
  });
  res.json(deleted);
});
