import { Hono } from 'hono';
import { cols, isUniqueViolation, type Row, sql, transaction } from '../db.ts';
import { Dec, qty, toDec } from '../lib/decimal.ts';
import { type AppEnv, contextFrom, readJson } from '../lib/http.ts';
import { charcoalAdjustmentSchema, chequeQuerySchema } from '../lib/validation.ts';
import { requireAdmin } from '../middleware/auth.ts';
import { writeAudit } from '../services/audit.ts';
import { charcoalStockKg, lockCharcoalStock } from '../services/charcoal.ts';
import { findByClientId } from './helpers.ts';

// ---------------------------------------------------------------------------
// Cheques due for deposit on a given day (or range)
// ---------------------------------------------------------------------------
export const chequesRouter = new Hono<AppEnv>();

/** `{ id, name }` of the linked customer, or null. */
const CUSTOMER_JSON = "CASE WHEN cu.id IS NULL THEN NULL ELSE json_build_object('id', cu.id, 'name', cu.name) END";

/**
 * Everything banked or presented between two dates, in one list: cheques taken
 * on sales and on settlements come IN, cheques written for purchases and to
 * customers go OUT. Deposit dates are plain calendar dates, so no time zone
 * maths happens here.
 */
chequesRouter.get('/', requireAdmin, async (c) => {
  const { from, to } = chequeQuerySchema.parse(c.req.query());
  const fromDay = from.toISOString().slice(0, 10);
  const toDay = to.toISOString().slice(0, 10);

  const [sales, purchases, payments] = await Promise.all([
    sql<Row[]>`
      SELECT s.id, s.cheque_number, s.cheque_deposit_date, s.cheque_amount, s.occurred_at,
             s.custom_name, s.product_code, ${sql.unsafe(CUSTOMER_JSON)} AS customer
      FROM sales s LEFT JOIN customers cu ON cu.id = s.customer_id
      WHERE s.is_deleted = false AND s.cheque_amount > 0
        AND s.cheque_deposit_date BETWEEN ${fromDay}::date AND ${toDay}::date
      ORDER BY s.cheque_deposit_date ASC, s.occurred_at ASC`,
    sql<Row[]>`
      SELECT p.id, p.cheque_number, p.cheque_deposit_date, p.cheque_amount, p.occurred_at,
             p.custom_name, p.material, ${sql.unsafe(CUSTOMER_JSON)} AS customer
      FROM purchases p LEFT JOIN customers cu ON cu.id = p.customer_id
      WHERE p.is_deleted = false AND p.cheque_amount > 0
        AND p.cheque_deposit_date BETWEEN ${fromDay}::date AND ${toDay}::date
      ORDER BY p.cheque_deposit_date ASC, p.occurred_at ASC`,
    sql<Row[]>`
      SELECT cp.id, cp.cheque_number, cp.cheque_deposit_date, cp.amount, cp.occurred_at,
             cp.direction, ${sql.unsafe(CUSTOMER_JSON)} AS customer
      FROM customer_payments cp LEFT JOIN customers cu ON cu.id = cp.customer_id
      WHERE cp.is_deleted = false AND cp.method = 'CHEQUE'
        AND cp.cheque_deposit_date BETWEEN ${fromDay}::date AND ${toDay}::date
      ORDER BY cp.cheque_deposit_date ASC, cp.occurred_at ASC`,
  ]);

  const items = [
    ...sales.map((s) => ({
      id: s.id,
      kind: 'sale' as const,
      direction: 'IN' as const,
      chequeNumber: s.chequeNumber,
      depositDate: s.chequeDepositDate as Date | null,
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
      depositDate: p.chequeDepositDate as Date | null,
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
      depositDate: p.chequeDepositDate as Date | null,
      amount: p.amount,
      occurredAt: p.occurredAt,
      detail: p.direction,
      customer: p.customer,
    })),
  ].sort((a, b) => (a.depositDate?.getTime() ?? 0) - (b.depositDate?.getTime() ?? 0));

  const sum = (dir: 'IN' | 'OUT') =>
    items
      .filter((i) => i.direction === dir)
      .reduce((acc, i) => acc.plus(toDec(i.amount)), new Dec(0))
      .toFixed(2);

  return c.json({
    from: fromDay,
    to: toDay,
    incomingTotal: sum('IN'),
    outgoingTotal: sum('OUT'),
    items,
  });
});

// ---------------------------------------------------------------------------
// Charcoal stock corrections
// ---------------------------------------------------------------------------
export const charcoalRouter = new Hono<AppEnv>();

charcoalRouter.get('/adjustments', requireAdmin, async (c) => {
  const [adjustments, stock] = await Promise.all([
    sql<Row[]>`
      SELECT ${cols(sql, 'charcoal_adjustments')} FROM charcoal_adjustments
      ORDER BY occurred_at DESC LIMIT 50`,
    charcoalStockKg(sql),
  ]);
  return c.json({ stockKg: qty(stock), adjustments });
});

/**
 * Sets computed charcoal stock to what is actually in the store — usually 0, to
 * clear the rounding and weighing difference left after a batch is sold out.
 * The underlying purchases and sales are never touched; a signed correction row
 * is added instead, so the history still adds up.
 */
charcoalRouter.post('/adjustments', requireAdmin, async (c) => {
  const input = charcoalAdjustmentSchema.parse(await readJson(c));
  const ctx = contextFrom(c);

  const existing = await findByClientId('charcoal_adjustments', input.clientId);
  if (existing) return c.json(existing, 200);

  try {
    const adjustment = await transaction(async (tx) => {
      // Same lock the sales take: the "previous" figure must not move underneath us.
      await lockCharcoalStock(tx);
      const previous = await charcoalStockKg(tx);
      const counted = input.countedKg;
      const delta = previous.minus(counted).negated(); // counted − previous

      if (delta.isZero()) {
        return { unchanged: true as const, stockKg: qty(previous) };
      }

      const [created] = await tx<Row[]>`
        INSERT INTO charcoal_adjustments (id, client_id, previous_kg, counted_kg, delta_kg, reason, occurred_at, device_id)
        VALUES (gen_random_uuid(), ${input.clientId}, ${previous.toFixed(3)}, ${counted}, ${delta.toFixed(3)},
                ${input.reason}, ${input.occurredAt}, ${ctx.deviceId})
        RETURNING ${cols(tx, 'charcoal_adjustments')}`;
      await writeAudit(tx, {
        action: 'CREATE',
        entity: 'CHARCOAL_ADJUSTMENT',
        entityId: created!.id,
        ctx,
        after: created,
        reason: input.reason,
      });
      return created!;
    });

    if ('unchanged' in adjustment) return c.json(adjustment, 200);
    return c.json(adjustment, 201);
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await findByClientId('charcoal_adjustments', input.clientId);
      if (winner) return c.json(winner, 200);
    }
    throw err;
  }
});
