import type { z } from 'zod';
import { config } from '../config.ts';
import { cols, type Row, sql, type Table } from '../db.ts';
import { periodStart } from '../lib/period.ts';
import type { listQuerySchema } from '../lib/validation.ts';

export type ListQuery = z.infer<typeof listQuerySchema>;

/**
 * History list shared by sales, purchases and cash entries: newest first, filtered by
 * period, keyset-paginated on (occurred_at, id) starting after the cursor row.
 */
export async function listRows(table: 'sales' | 'purchases' | 'cash_entries', q: ListQuery) {
  const from = periodStart(q.period, config.businessUtcOffsetMinutes);
  const t = sql(table);
  const rows = await sql<Row[]>`
    SELECT ${cols(sql, table)} FROM ${t}
    WHERE true
      ${q.includeDeleted ? sql`` : sql`AND is_deleted = false`}
      ${from ? sql`AND occurred_at >= ${from}` : sql``}
      ${q.cursor ? sql`AND (occurred_at, id) < (SELECT occurred_at, id FROM ${t} WHERE id = ${q.cursor})` : sql``}
    ORDER BY occurred_at DESC, id DESC
    LIMIT ${q.limit + 1}`; // one extra to know if there's another page
  return page(rows, q.limit);
}

export function page<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null };
}

/** The row with this client id, if an earlier send already recorded it. */
export async function findByClientId(table: Table, clientId: string): Promise<Row | undefined> {
  const [row] = await sql<Row[]>`SELECT ${cols(sql, table)} FROM ${sql(table)} WHERE client_id = ${clientId}`;
  return row;
}
