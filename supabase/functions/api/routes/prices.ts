import { Hono } from 'hono';
import { type Row, sql, transaction } from '../db.ts';
import { Dec } from '../lib/decimal.ts';
import { type AppEnv, contextFrom, readJson } from '../lib/http.ts';
import { savePricesSchema } from '../lib/validation.ts';
import { requireSession } from '../middleware/auth.ts';
import { writeAudit } from '../services/audit.ts';

export const pricesRouter = new Hono<AppEnv>();

/**
 * The price book. Anyone signed in may read and set it — the counter is where the
 * day's price is actually known, and the owner sees every change in the audit log.
 * Prices stand until someone changes them; nothing expires overnight.
 */
pricesRouter.get('/', requireSession, async (c) => {
  const prices = await sql<Row[]>`SELECT id, amount, updated_at FROM prices ORDER BY id ASC`;
  return c.json(prices);
});

/** Batch upsert: the screen sends the rows it changed, not the whole book. */
pricesRouter.put('/', requireSession, async (c) => {
  const { prices } = savePricesSchema.parse(await readJson(c));
  const ctx = contextFrom(c);

  const saved = await transaction(async (tx) => {
    const before = await tx<{ id: string; amount: string }[]>`
      SELECT id, amount::text AS amount FROM prices WHERE id = ANY(${prices.map((p) => p.id)}::text[])`;
    const previous = new Map(before.map((p) => [p.id, p.amount]));

    const rows: Row[] = [];
    for (const price of prices) {
      // Unchanged rows are skipped so the audit log stays a log of actual changes.
      // Compared as decimals, so "650" and "650.00" count as the same price.
      const old = previous.get(price.id);
      if (old !== undefined && new Dec(old).equals(price.amount)) continue;
      const [row] = await tx<Row[]>`
        INSERT INTO prices (id, amount, updated_at, device_id)
        VALUES (${price.id}, ${price.amount}, now(), ${ctx.deviceId})
        ON CONFLICT (id) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now(), device_id = EXCLUDED.device_id
        RETURNING id, amount, updated_at`;
      rows.push(row!);
      await writeAudit(tx, {
        action: old !== undefined ? 'UPDATE' : 'CREATE',
        entity: 'PRICE',
        entityId: price.id,
        ctx,
        before: old !== undefined ? { amount: old } : undefined,
        after: { amount: price.amount },
      });
    }
    return rows;
  });

  return c.json({ updated: saved.length, prices: saved });
});
