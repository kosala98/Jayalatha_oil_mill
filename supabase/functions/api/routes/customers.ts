import { Hono } from 'hono';
import { cols, isUniqueViolation, type Row, sql, transaction } from '../db.ts';
import { HttpError, notFound } from '../lib/errors.ts';
import { type AppEnv, contextFrom, readJson } from '../lib/http.ts';
import {
  createCustomerPaymentSchema,
  createCustomerSchema,
  customerLedgerQuerySchema,
  customerListQuerySchema,
  deleteSchema,
  idParamSchema,
  updateCustomerSchema,
} from '../lib/validation.ts';
import { requireAdmin, requireSession } from '../middleware/auth.ts';
import { writeAudit } from '../services/audit.ts';
import { balanceFor, balancesFor, requireLiveCustomer } from '../services/customers.ts';
import { findByClientId } from './helpers.ts';

/** The partial unique index that keeps one live ledger per name. */
const NAME_UNIQUE = 'customers_name_unique_live';

export const customersRouter = new Hono<AppEnv>();

/**
 * The counter needs the customer list to record a credit sale and to answer
 * "how much do I owe?", so reads here need any session rather than the admin.
 * Editing and deleting a customer still needs the admin.
 */

customersRouter.get('/', requireSession, async (c) => {
  const q = customerListQuerySchema.parse(c.req.query());
  // Case-insensitive "contains", with LIKE wildcards in the search taken literally.
  const pattern = q.q ? `%${q.q.replace(/[\\%_]/g, '\\$&')}%` : null;
  const customers = await sql<Row[]>`
    SELECT ${cols(sql, 'customers')} FROM customers
    WHERE true
      ${q.includeDeleted ? sql`` : sql`AND is_deleted = false`}
      ${pattern ? sql`AND name ILIKE ${pattern}` : sql``}
    ORDER BY name ASC
    LIMIT ${q.limit}`;
  const balances = await balancesFor(sql, customers.map((cu) => cu.id));
  return c.json(customers.map((cu) => ({ ...cu, ...balances.get(cu.id) })));
});

customersRouter.post('/', requireSession, async (c) => {
  const input = createCustomerSchema.parse(await readJson(c));
  const ctx = contextFrom(c);

  const existing = await findByClientId('customers', input.clientId);
  if (existing) return c.json(existing, 200);

  try {
    const customer = await transaction(async (tx) => {
      const [created] = await tx<Row[]>`
        INSERT INTO customers (id, client_id, name, phone, note, updated_at, device_id)
        VALUES (gen_random_uuid(), ${input.clientId}, ${input.name}, ${input.phone}, ${input.note}, now(), ${ctx.deviceId})
        RETURNING ${cols(tx, 'customers')}`;
      await writeAudit(tx, { action: 'CREATE', entity: 'CUSTOMER', entityId: created!.id, ctx, after: created });
      return created!;
    });
    return c.json(customer, 201);
  } catch (err) {
    if (isUniqueViolation(err)) {
      const bySameSend = await findByClientId('customers', input.clientId);
      if (bySameSend) return c.json(bySameSend, 200);
      // Two "Sunil" rows would split one ledger in two.
      throw new HttpError(409, 'CUSTOMER_EXISTS', 'A customer with this name already exists');
    }
    throw err;
  }
});

/** Profile: who they are, what they owe, and the transactions behind that number. */
customersRouter.get('/:id', requireSession, async (c) => {
  const id = idParamSchema.parse(c.req.param('id'));
  const q = customerLedgerQuerySchema.parse(c.req.query());

  const [customer] = await sql<Row[]>`SELECT ${cols(sql, 'customers')} FROM customers WHERE id = ${id}`;
  if (!customer) throw notFound('Customer');

  const [balance, sales, purchases, payments] = await Promise.all([
    balanceFor(sql, id),
    sql<Row[]>`
      SELECT ${cols(sql, 'sales')} FROM sales
      WHERE customer_id = ${id} AND is_deleted = false
      ORDER BY occurred_at DESC LIMIT ${q.limit}`,
    sql<Row[]>`
      SELECT ${cols(sql, 'purchases')} FROM purchases
      WHERE customer_id = ${id} AND is_deleted = false
      ORDER BY occurred_at DESC LIMIT ${q.limit}`,
    sql<Row[]>`
      SELECT ${cols(sql, 'customer_payments')} FROM customer_payments
      WHERE customer_id = ${id} AND is_deleted = false
      ORDER BY occurred_at DESC LIMIT ${q.limit}`,
  ]);

  // One list in time order is how the customer thinks about it.
  const ledger = [
    ...sales.map((s) => ({
      kind: 'sale' as const,
      id: s.id,
      occurredAt: s.occurredAt as Date,
      amount: s.total,
      cashAmount: s.cashAmount,
      chequeAmount: s.chequeAmount,
      creditAmount: s.creditAmount,
      chequeNumber: s.chequeNumber,
      detail: s.customName ?? s.productCode,
      // What actually left the mill, so the row can be read without opening anything.
      quantity: s.quantity,
      unitType: s.unitType,
      bottleSize: s.bottleSize,
      unitPrice: s.pricePerUnit,
    })),
    ...purchases.map((p) => ({
      kind: 'purchase' as const,
      id: p.id,
      occurredAt: p.occurredAt as Date,
      amount: p.total,
      cashAmount: p.cashAmount,
      chequeAmount: p.chequeAmount,
      creditAmount: p.creditAmount,
      chequeNumber: p.chequeNumber,
      detail: p.customName ?? p.material,
      quantity: p.quantityKg,
      unitType: 'KG' as const,
      bottleSize: null,
      unitPrice: p.pricePerKg,
    })),
    ...payments.map((p) => ({
      kind: p.kind === 'LOAN' ? ('loan' as const) : ('payment' as const),
      id: p.id,
      occurredAt: p.occurredAt as Date,
      amount: p.amount,
      cashAmount: p.method === 'CASH' ? p.amount : '0',
      chequeAmount: p.method === 'CHEQUE' ? p.amount : '0',
      creditAmount: '0',
      chequeNumber: p.chequeNumber,
      detail: p.direction,
      note: p.note,
    })),
  ]
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, q.limit);

  return c.json({ ...customer, ...balance, ledger });
});

customersRouter.patch('/:id', requireAdmin, async (c) => {
  const id = idParamSchema.parse(c.req.param('id'));
  const input = updateCustomerSchema.parse(await readJson(c));
  const ctx = contextFrom(c);

  try {
    const updated = await transaction(async (tx) => {
      const [before] = await tx<Row[]>`SELECT ${cols(tx, 'customers')} FROM customers WHERE id = ${id}`;
      if (!before) throw notFound('Customer');
      if (before.isDeleted) throw new HttpError(409, 'ALREADY_DELETED', 'This customer is deleted');
      const [after] = await tx<Row[]>`
        UPDATE customers SET name = ${input.name}, phone = ${input.phone}, note = ${input.note}, updated_at = now()
        WHERE id = ${id}
        RETURNING ${cols(tx, 'customers')}`;
      await writeAudit(tx, { action: 'UPDATE', entity: 'CUSTOMER', entityId: id, ctx, before, after });
      return after!;
    });
    return c.json(updated);
  } catch (err) {
    if (isUniqueViolation(err, NAME_UNIQUE)) {
      throw new HttpError(409, 'CUSTOMER_EXISTS', 'A customer with this name already exists');
    }
    throw err;
  }
});

/** Deleting hides the customer from the pickers. Refused while they still owe. */
customersRouter.delete('/:id', requireAdmin, async (c) => {
  const id = idParamSchema.parse(c.req.param('id'));
  const { reason } = deleteSchema.parse((await readJson(c)) ?? {});
  const ctx = contextFrom(c);

  const deleted = await transaction(async (tx) => {
    const [before] = await tx<Row[]>`SELECT ${cols(tx, 'customers')} FROM customers WHERE id = ${id}`;
    if (!before) throw notFound('Customer');
    if (before.isDeleted) throw new HttpError(409, 'ALREADY_DELETED', 'This customer is already deleted');

    const balance = await balanceFor(tx, id);
    if (balance.balance !== '0.00') {
      throw new HttpError(409, 'CUSTOMER_HAS_BALANCE', 'Settle the balance before removing this customer', {
        balance: balance.balance,
      });
    }

    const [after] = await tx<Row[]>`
      UPDATE customers SET is_deleted = true, deleted_at = now(), delete_reason = ${reason}, updated_at = now()
      WHERE id = ${id}
      RETURNING ${cols(tx, 'customers')}`;
    await writeAudit(tx, { action: 'DELETE', entity: 'CUSTOMER', entityId: id, ctx, before, after, reason });
    return after!;
  });

  return c.json(deleted);
});

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------
export const customerPaymentsRouter = new Hono<AppEnv>();

customerPaymentsRouter.post('/', requireSession, async (c) => {
  const input = createCustomerPaymentSchema.parse(await readJson(c));
  const ctx = contextFrom(c);

  const existing = await findByClientId('customer_payments', input.clientId);
  if (existing) return c.json(existing, 200);

  try {
    const payment = await transaction(async (tx) => {
      await requireLiveCustomer(tx, input.customerId);
      const [created] = await tx<Row[]>`
        INSERT INTO customer_payments (
          id, client_id, customer_id, bill_no, kind, direction, method, amount,
          cheque_number, cheque_deposit_date, note, occurred_at, device_id
        ) VALUES (
          gen_random_uuid(), ${input.clientId}, ${input.customerId}, ${input.billNo ?? null}, ${input.kind},
          ${input.direction}, ${input.method}, ${input.amount}, ${input.chequeNumber},
          ${input.chequeDepositDate}::date, ${input.note}, ${input.occurredAt}, ${ctx.deviceId}
        )
        RETURNING ${cols(tx, 'customer_payments')}`;
      await writeAudit(tx, { action: 'CREATE', entity: 'CUSTOMER_PAYMENT', entityId: created!.id, ctx, after: created });
      return created!;
    });
    return c.json(payment, 201);
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await findByClientId('customer_payments', input.clientId);
      if (winner) return c.json(winner, 200);
    }
    throw err;
  }
});

customerPaymentsRouter.delete('/:id', requireAdmin, async (c) => {
  const id = idParamSchema.parse(c.req.param('id'));
  const { reason } = deleteSchema.parse((await readJson(c)) ?? {});
  const ctx = contextFrom(c);

  const deleted = await transaction(async (tx) => {
    const [before] = await tx<Row[]>`SELECT ${cols(tx, 'customer_payments')} FROM customer_payments WHERE id = ${id}`;
    if (!before) throw notFound('Payment');
    if (before.isDeleted) throw new HttpError(409, 'ALREADY_DELETED', 'This payment is already deleted');
    const [after] = await tx<Row[]>`
      UPDATE customer_payments SET is_deleted = true, deleted_at = now(), delete_reason = ${reason}
      WHERE id = ${id}
      RETURNING ${cols(tx, 'customer_payments')}`;
    await writeAudit(tx, { action: 'DELETE', entity: 'CUSTOMER_PAYMENT', entityId: id, ctx, before, after, reason });
    return after!;
  });

  return c.json(deleted);
});
