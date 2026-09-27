import { Hono } from 'hono';
import { cols, type Row, sql } from '../db.ts';
import { notFound } from '../lib/errors.ts';
import type { AppEnv } from '../lib/http.ts';
import { requireSession } from '../middleware/auth.ts';
import { balanceFor } from '../services/customers.ts';

export const billsRouter = new Hono<AppEnv>();

const BILL_NO = /^[A-Z0-9-]{3,32}$/;

/**
 * Everything printed on one receipt, fetched back by its number. Used to reprint a
 * bill days later — the customer keeps the paper, the mill keeps the number.
 *
 * The balances are recomputed now rather than stored: a reprint should show the truth
 * as it stands today, and "before" is simply today's balance minus what this bill did.
 */
billsRouter.get('/:billNo', requireSession, async (c) => {
  const billNo = String(c.req.param('billNo') ?? '').toUpperCase();
  if (!BILL_NO.test(billNo)) throw notFound('Bill');

  const [sales, purchases, payments] = await Promise.all([
    sql<Row[]>`SELECT ${cols(sql, 'sales')} FROM sales WHERE bill_no = ${billNo} AND is_deleted = false ORDER BY created_at ASC`,
    sql<Row[]>`SELECT ${cols(sql, 'purchases')} FROM purchases WHERE bill_no = ${billNo} AND is_deleted = false ORDER BY created_at ASC`,
    sql<Row[]>`
      SELECT ${cols(sql, 'customer_payments')} FROM customer_payments
      WHERE bill_no = ${billNo} AND is_deleted = false ORDER BY created_at ASC`,
  ]);
  if (sales.length + purchases.length + payments.length === 0) throw notFound('Bill');

  const customerId: string | null = sales[0]?.customerId ?? purchases[0]?.customerId ?? payments[0]?.customerId ?? null;
  const [customer] = customerId
    ? await sql<Row[]>`SELECT id, name, phone FROM customers WHERE id = ${customerId}`
    : [];
  const balance = customerId ? (await balanceFor(sql, customerId)).balance : null;

  const occurredAt = [...sales, ...purchases, ...payments]
    .map((r) => r.occurredAt as Date)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  return c.json({ billNo, occurredAt, customer: customer ?? null, balanceNow: balance, sales, purchases, payments });
});
