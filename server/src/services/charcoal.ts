import type { Prisma } from '@prisma/client';
import { type Dec, toDec } from '../lib/decimal';

/** Arbitrary constant key for the charcoal stock advisory lock. */
const CHARCOAL_LOCK_KEY = 7_310_042;

/**
 * Serialises every transaction that changes charcoal stock. Held until the
 * surrounding transaction commits or rolls back, so "read stock → insert sale"
 * can't interleave with another sale. Safe behind PgBouncer transaction pooling.
 */
export async function lockCharcoalStock(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(${CHARCOAL_LOCK_KEY})::text AS locked`);
}

/**
 * Charcoal stock (KG) = Σ charcoal purchases − Σ charcoal sales + Σ corrections,
 * excluding soft-deleted rows. Always all-time: stock is a level, not a flow.
 */
export async function charcoalStockKg(tx: Prisma.TransactionClient): Promise<Dec> {
  const [bought, sold, adjusted] = await Promise.all([
    tx.purchase.aggregate({ where: { isDeleted: false, material: 'CHARCOAL' }, _sum: { quantityKg: true } }),
    tx.sale.aggregate({ where: { isDeleted: false, product: { isCharcoal: true } }, _sum: { quantity: true } }),
    tx.charcoalAdjustment.aggregate({ _sum: { deltaKg: true } }),
  ]);
  return toDec(bought._sum.quantityKg).minus(toDec(sold._sum.quantity)).plus(toDec(adjusted._sum.deltaKg));
}

