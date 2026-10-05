import { Hono } from 'hono';
import { config } from '../config.ts';
import { cols, isUniqueViolation, type Row, transaction } from '../db.ts';
import { computeContainerTotal, computeTotal, qty } from '../lib/decimal.ts';
import { HttpError, notFound } from '../lib/errors.ts';
import { type AppEnv, contextFrom, readJson } from '../lib/http.ts';
import type { UnitType } from '../lib/types.ts';
import {
  assertPartsMatchTotal,
  createSaleSchema,
  deleteSchema,
  idParamSchema,
  listQuerySchema,
} from '../lib/validation.ts';
import { requireAdmin, requireSession } from '../middleware/auth.ts';
import { writeAudit } from '../services/audit.ts';
import { charcoalStockKg, lockCharcoalStock } from '../services/charcoal.ts';
import { requireLiveCustomer } from '../services/customers.ts';
import { findByClientId, listRows, recentRows } from './helpers.ts';

export const salesRouter = new Hono<AppEnv>();

salesRouter.post('/', requireSession, async (c) => {
  const input = createSaleSchema.parse(await readJson(c));
  const ctx = contextFrom(c);

  // Idempotency: an offline re-send of the same transaction returns the original.
  const existing = await findByClientId('sales', input.clientId);
  if (existing) return c.json(existing, 200);

  try {
    const sale = await transaction(async (tx) => {
      const [product] = await tx<{ code: string; nameEn: string; isCharcoal: boolean; active: boolean; allowedUnits: UnitType[] }[]>`
        SELECT code, name_en, is_charcoal, active, allowed_units::text[] AS allowed_units
        FROM products WHERE code = ${input.productCode}`;
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

      const [created] = await tx<Row[]>`
        INSERT INTO sales (
          id, client_id, product_code, unit_type, bottle_size, bill_no, custom_name,
          container_count, container_price, container_total, quantity, price_per_unit, total,
          cash_amount, cheque_amount, credit_amount, cheque_number, cheque_deposit_date,
          customer_id, occurred_at, device_id
        ) VALUES (
          gen_random_uuid(), ${input.clientId}, ${product.code}, ${input.unitType}, ${input.bottleSize},
          ${input.billNo ?? null}, ${input.customName},
          ${input.containerCount}, ${input.containerCount > 0 ? input.containerPrice : '0'},
          ${containerTotal.toFixed(2)}, ${input.quantity}, ${input.pricePerUnit}, ${total.toFixed(2)},
          ${input.cashAmount}, ${input.chequeAmount}, ${input.creditAmount}, ${input.chequeNumber},
          ${input.chequeDepositDate}::date, ${input.customerId}, ${input.occurredAt}, ${ctx.deviceId}
        )
        RETURNING ${cols(tx, 'sales')}`;
      await writeAudit(tx, { action: 'CREATE', entity: 'SALE', entityId: created!.id, ctx, after: created });
      return created!;
    });
    return c.json(sale, 201);
  } catch (err) {
    // Two copies of the same offline send raced each other; return the winner.
    if (isUniqueViolation(err)) {
      const winner = await findByClientId('sales', input.clientId);
      if (winner) return c.json(winner, 200);
    }
    throw err;
  }
});

/** The last few sales, for the counter's own check under the sale form. */
salesRouter.get('/recent', requireSession, async (c) => c.json(await recentRows('sales')));

salesRouter.get('/', requireAdmin, async (c) => {
  const q = listQuerySchema.parse(c.req.query());
  return c.json(await listRows('sales', q));
});

salesRouter.delete('/:id', requireAdmin, async (c) => {
  const id = idParamSchema.parse(c.req.param('id'));
  const { reason } = deleteSchema.parse((await readJson(c)) ?? {});
  const ctx = contextFrom(c);

  const deleted = await transaction(async (tx) => {
    const [before] = await tx<Row[]>`
      SELECT ${cols(tx, 'sales')}, (SELECT is_charcoal FROM products p WHERE p.code = sales.product_code) AS is_charcoal
      FROM sales WHERE id = ${id}`;
    if (!before) throw notFound('Sale');
    if (before.isDeleted) throw new HttpError(409, 'ALREADY_DELETED', 'This sale is already deleted');
    const { isCharcoal, ...beforeRow } = before;
    if (isCharcoal) await lockCharcoalStock(tx);

    const [after] = await tx<Row[]>`
      UPDATE sales SET is_deleted = true, deleted_at = now(), delete_reason = ${reason}
      WHERE id = ${id} AND is_deleted = false
      RETURNING ${cols(tx, 'sales')}`;
    if (!after) throw new HttpError(409, 'ALREADY_DELETED', 'This sale is already deleted');

    await writeAudit(tx, { action: 'DELETE', entity: 'SALE', entityId: id, ctx, before: beforeRow, after, reason });
    return after;
  });
  return c.json(deleted);
});

