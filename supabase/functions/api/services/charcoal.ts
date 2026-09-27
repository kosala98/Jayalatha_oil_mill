import type { Db } from '../db.ts';
import { type Dec, toDec } from '../lib/decimal.ts';

/** Arbitrary constant key for the charcoal stock advisory lock. */
const CHARCOAL_LOCK_KEY = 7_310_042;

/**
 * Serialises every transaction that changes charcoal stock. Held until the
 * surrounding transaction commits or rolls back, so "read stock → insert sale"
 * can't interleave with another sale. Safe behind transaction pooling.
 */
export async function lockCharcoalStock(tx: Db): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(${CHARCOAL_LOCK_KEY})::text AS locked`;
}

/**
 * Charcoal stock (KG) = Σ charcoal purchases − Σ charcoal sales + Σ corrections,
 * excluding soft-deleted rows. Always all-time: stock is a level, not a flow.
 */
export async function charcoalStockKg(tx: Db): Promise<Dec> {
  const [row] = await tx<{ bought: string | null; sold: string | null; adjusted: string | null }[]>`
    SELECT
      (SELECT sum(quantity_kg) FROM purchases WHERE is_deleted = false AND material = 'CHARCOAL') AS bought,
      (SELECT sum(s.quantity) FROM sales s JOIN products p ON p.code = s.product_code
        WHERE s.is_deleted = false AND p.is_charcoal) AS sold,
      (SELECT sum(delta_kg) FROM charcoal_adjustments) AS adjusted`;
  return toDec(row?.bought).minus(toDec(row?.sold)).plus(toDec(row?.adjusted));
}
