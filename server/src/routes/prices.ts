import { Router } from 'express';
import { prisma } from '../db';
import { contextFrom } from '../lib/http';
import { savePricesSchema } from '../lib/validation';
import { requireSession } from '../middleware/auth';
import { writeAudit } from '../services/audit';

export const pricesRouter = Router();

/**
 * The price book. Anyone signed in may read and set it — the counter is where the
 * day's price is actually known, and the owner sees every change in the audit log.
 * Prices stand until someone changes them; nothing expires overnight.
 */
pricesRouter.get('/', requireSession, async (_req, res) => {
  const prices = await prisma.price.findMany({ orderBy: { id: 'asc' } });
  res.json(prices.map((p) => ({ id: p.id, amount: p.amount, updatedAt: p.updatedAt })));
});

/** Batch upsert: the screen sends the rows it changed, not the whole book. */
pricesRouter.put('/', requireSession, async (req, res) => {
  const { prices } = savePricesSchema.parse(req.body);
  const ctx = contextFrom(req);

  const saved = await prisma.$transaction(async (tx) => {
    const before = await tx.price.findMany({ where: { id: { in: prices.map((p) => p.id) } } });
    const previous = new Map(before.map((p) => [p.id, p.amount.toString()]));

    const rows = [];
    for (const price of prices) {
      // Unchanged rows are skipped so the audit log stays a log of actual changes.
      if (previous.get(price.id) === price.amount) continue;
      rows.push(
        await tx.price.upsert({
          where: { id: price.id },
          create: { id: price.id, amount: price.amount, installId: ctx.deviceId },
          update: { amount: price.amount, installId: ctx.deviceId },
        }),
      );
      await writeAudit(tx, {
        action: previous.has(price.id) ? 'UPDATE' : 'CREATE',
        entity: 'PRICE',
        entityId: price.id,
        ctx,
        before: previous.has(price.id) ? { amount: previous.get(price.id) } : undefined,
        after: { amount: price.amount },
      });
    }
    return rows;
  });

  res.json({ updated: saved.length, prices: saved.map((p) => ({ id: p.id, amount: p.amount, updatedAt: p.updatedAt })) });
});
