import postgres from 'postgres';
import { config } from './config.ts';

/** Strips Prisma-only URL parameters, which Postgres would reject as unknown settings. */
function cleanUrl(raw: string): string {
  const url = new URL(raw);
  url.searchParams.delete('pgbouncer');
  url.searchParams.delete('connection_limit');
  return url.toString();
}

/** postgres.js closes idle connections after this many seconds — while its timers run. */
const IDLE_TIMEOUT_S = 20;

function createPool() {
  return postgres(cleanUrl(config.databaseUrl), {
    max: 3,
    idle_timeout: IDLE_TIMEOUT_S,
    // Fail fast instead of waiting on an unreachable database.
    connect_timeout: 10,
    // Works behind Supavisor/PgBouncer transaction pooling as well as direct connections.
    prepare: false,
    transform: { ...postgres.camel, undefined: null },
    onnotice: () => {},
  });
}

/**
 * One small pool per function instance. Column names come back camelCased, so rows
 * have the same shape the Prisma API returned. Numerics stay strings, never floats.
 *
 * `let`, not `const`: importers see the live binding, so a replaced pool is picked up
 * everywhere at once.
 */
export let sql = createPool();

let lastActivity = Date.now();

/**
 * Throws the pool away and starts a new one. Closing does not wait for anything, so a
 * query stuck on a dead connection fails at once instead of hanging the request.
 */
export function resetPool(): void {
  const old = sql;
  sql = createPool();
  old.end({ timeout: 0 }).catch(() => {});
}

/**
 * Call at the start of every request. The edge runtime freezes an idle instance, and
 * frozen timers never close idle connections — so after a quiet spell the pool may hold
 * sockets the network has already dropped, and a query sent on one hangs instead of
 * failing. After longer than the idle timeout without a request, start fresh.
 */
export function freshPoolForRequest(): void {
  const idleMs = Date.now() - lastActivity;
  lastActivity = Date.now();
  if (idleMs > IDLE_TIMEOUT_S * 1000) resetPool();
}

/** Call when a request finishes, so a busy instance keeps its warm connections. */
export function markPoolActivity(): void {
  lastActivity = Date.now();
}

/** Either the pool or an open transaction — both run the same tagged-template queries. */
export type Db = postgres.Sql | postgres.TransactionSql;

/** Runs `fn` in a transaction and hands back its result. */
export function transaction<T>(fn: (tx: postgres.TransactionSql) => Promise<T>, options?: string): Promise<T> {
  // postgres.js types the result of begin() as UnwrapPromiseArray<T>; for a plain value it is T.
  return (options ? sql.begin(options, fn) : sql.begin(fn)) as Promise<T>;
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint_name?: string };
  return e?.code === '23505' && (constraint === undefined || e.constraint_name === constraint);
}

/**
 * Column lists that reproduce the Prisma models field for field. `device_id` on the
 * financial tables was exposed as `installId`.
 */
export const COLS = {
  sales: `id, client_id, product_code, unit_type, bottle_size, custom_name, bill_no,
    container_count, container_price, container_total, quantity, price_per_unit, total,
    cash_amount, cheque_amount, credit_amount, cheque_number, cheque_deposit_date, customer_id,
    occurred_at, created_at, is_deleted, deleted_at, delete_reason, device_id AS install_id`,
  purchases: `id, client_id, material, custom_name, bill_no, gross_kg, deduction_kg, deductions,
    quantity_kg, price_per_kg, total, cash_amount, cheque_amount, credit_amount, cheque_number,
    cheque_deposit_date, customer_id, occurred_at, created_at, is_deleted, deleted_at, delete_reason,
    device_id AS install_id`,
  cash_entries: `id, client_id, type, amount, note, occurred_at, created_at, is_deleted, deleted_at,
    delete_reason, device_id AS install_id`,
  customers: `id, client_id, name, phone, note, created_at, updated_at, is_deleted, deleted_at,
    delete_reason, device_id AS install_id`,
  customer_payments: `id, client_id, customer_id, bill_no, kind, direction, method, amount,
    cheque_number, cheque_deposit_date, note, occurred_at, created_at, is_deleted, deleted_at,
    delete_reason, device_id AS install_id`,
  charcoal_adjustments: `id, client_id, previous_kg, counted_kg, delta_kg, reason, occurred_at,
    created_at, device_id AS install_id`,
} as const;

export type Table = keyof typeof COLS;

/** The column list of `table` as a raw SQL fragment, for the model-shaped reads. */
export const cols = (db: Db, table: Table) => db.unsafe(COLS[table]);

// deno-lint-ignore no-explicit-any
export type Row = { id: string; [column: string]: any };
