import { Hono } from 'hono';
import { cols, isUniqueViolation, type Row, transaction } from '../db.ts';
import { computeTotal } from '../lib/decimal.ts';
import { HttpError, notFound } from '../lib/errors.ts';
import { type AppEnv, contextFrom, readJson } from '../lib/http.ts';
import {
  assertPartsMatchTotal,
  createPurchaseSchema,
  deleteSchema,
  idParamSchema,
  listQuerySchema,
} from '../lib/validation.ts';
import { requireAdmin, requireSession } from '../middleware/auth.ts';
import { writeAudit } from '../services/audit.ts';
import { lockCharcoalStock } from '../services/charcoal.ts';
import { requireLiveCustomer } from '../services/customers.ts';
import { findByClientId, listRows } from './helpers.ts';

export const purchasesRouter = new Hono<AppEnv>();

purchasesRouter.post('/', requireSession, async (c) => {
  const input = createPurchaseSchema.parse(await readJson(c));
  const ctx = contextFrom(c);

  const existing = await findByClientId('purchases', input.clientId);
  if (existing) return c.json(existing, 200);

  try {
    const purchase = await transaction(async (tx) => {
      if (input.customerId) await requireLiveCustomer(tx, input.customerId);
      if (input.material === 'CHARCOAL') await lockCharcoalStock(tx);
      const total = computeTotal(input.quantityKg, input.pricePerKg);
      assertPartsMatchTotal(input, total);

      const [created] = await tx<Row[]>`
        INSERT INTO purchases (
          id, client_id, material, custom_name, bill_no, gross_kg, deduction_kg, deductions,
          quantity_kg, price_per_kg, total, cash_amount, cheque_amount, credit_amount,
          cheque_number, cheque_deposit_date, customer_id, occurred_at, device_id
        ) VALUES (
          gen_random_uuid(), ${input.clientId}, ${input.material}, ${input.customName}, ${input.billNo ?? null},
          ${input.grossKg}, ${input.deductionKg}, ${input.deductions ? tx.json(input.deductions) : null},
          ${input.quantityKg}, ${input.pricePerKg}, ${total.toFixed(2)},
          ${input.cashAmount}, ${input.chequeAmount}, ${input.creditAmount},
          ${input.chequeNumber}, ${input.chequeDepositDate}::date, ${input.customerId}, ${input.occurredAt},
          ${ctx.deviceId}
        )
        RETURNING ${cols(tx, 'purchases')}`;
      await writeAudit(tx, { action: 'CREATE', entity: 'PURCHASE', entityId: created!.id, ctx, after: created });
      return created!;
    });
    return c.json(purchase, 201);
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await findByClientId('purchases', input.clientId);
      if (winner) return c.json(winner, 200);
    }
    throw err;
  }
});

purchasesRouter.get('/', requireAdmin, async (c) => {
  const q = listQuerySchema.parse(c.req.query());
  return c.json(await listRows('purchases', q));
});

purchasesRouter.delete('/:id', requireAdmin, async (c) => {
  const id = idParamSchema.parse(c.req.param('id'));
  const { reason } = deleteSchema.parse((await readJson(c)) ?? {});
  const ctx = contextFrom(c);

  const deleted = await transaction(async (tx) => {
    const [before] = await tx<Row[]>`SELECT ${cols(tx, 'purchases')} FROM purchases WHERE id = ${id}`;
    if (!before) throw notFound('Purchase');
    if (before.isDeleted) throw new HttpError(409, 'ALREADY_DELETED', 'This purchase is already deleted');
    // Deleting a charcoal purchase lowers stock; take the same lock sales use.
    if (before.material === 'CHARCOAL') await lockCharcoalStock(tx);

    const [after] = await tx<Row[]>`
      UPDATE purchases SET is_deleted = true, deleted_at = now(), delete_reason = ${reason}
      WHERE id = ${id} AND is_deleted = false
      RETURNING ${cols(tx, 'purchases')}`;
    if (!after) throw new HttpError(409, 'ALREADY_DELETED', 'This purchase is already deleted');

    await writeAudit(tx, { action: 'DELETE', entity: 'PURCHASE', entityId: id, ctx, before, after, reason });
    return after;
  });
  return c.json(deleted);
});
