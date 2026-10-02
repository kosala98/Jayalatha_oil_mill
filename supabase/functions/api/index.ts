/**
 * Coconut oil mill POS — the whole REST API as one Supabase Edge Function.
 *
 * Supabase routes https://<project>.supabase.co/functions/v1/api/<path> here with the
 * pathname /api/<path>, so the routes are exactly the ones the Express server had and
 * the client only needs VITE_API_URL=https://<project>.supabase.co/functions/v1.
 *
 * Sessions are this app's own username/password tokens, not Supabase Auth: deploy with
 * verify_jwt = false (see supabase/config.toml).
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ZodError } from 'zod';
import { config } from './config.ts';
import { freshPoolForRequest, markPoolActivity, resetPool, sql } from './db.ts';
import { HttpError } from './lib/errors.ts';
import type { AppEnv } from './lib/http.ts';
import { authRouter } from './routes/auth.ts';
import { billsRouter } from './routes/bills.ts';
import { cashEntriesRouter } from './routes/cashEntries.ts';
import { charcoalRouter, chequesRouter } from './routes/cheques.ts';
import { customerPaymentsRouter, customersRouter } from './routes/customers.ts';
import { pricesRouter } from './routes/prices.ts';
import { productsRouter } from './routes/products.ts';
import { purchasesRouter } from './routes/purchases.ts';
import { salesRouter } from './routes/sales.ts';
import { statsRouter } from './routes/stats.ts';

const app = new Hono<AppEnv>().basePath('/api');

app.use(
  '*',
  cors({
    origin: config.corsOrigins.length > 0 ? [...config.corsOrigins] : '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Device-Id'],
    maxAge: 600,
  }),
);

/**
 * No request may wait on the database forever. The client gives up at 15 s and keeps the
 * transaction queued; answering at 12 s with a retryable 503 lets it resend promptly, and
 * resetting the pool clears whatever connection was stuck. A resend is safe: creates are
 * idempotent on clientId.
 */
const REQUEST_DEADLINE_MS = 12_000;

class RequestTimeout extends Error {}

app.use('*', async (c, next) => {
  freshPoolForRequest();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RequestTimeout()), REQUEST_DEADLINE_MS);
  });
  try {
    await Promise.race([next(), deadline]);
  } catch (err) {
    if (!(err instanceof RequestTimeout)) throw err;
    console.error(`[timeout] ${c.req.method} ${c.req.path} — resetting the database pool`);
    resetPool();
    throw new HttpError(503, 'DB_TIMEOUT', 'The database did not answer in time. Please try again.');
  } finally {
    clearTimeout(timer);
    markPoolActivity();
  }
});

// API responses are never cached unless a route says otherwise (the product catalog).
app.use('*', async (c, next) => {
  await next();
  if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('Referrer-Policy', 'no-referrer');
});

app.get('/health', async (c) => {
  await sql`SELECT 1`;
  return c.json({ ok: true, time: new Date().toISOString() });
});

app.route('/products', productsRouter);
app.route('/sales', salesRouter);
app.route('/purchases', purchasesRouter);
app.route('/cash-entries', cashEntriesRouter);
app.route('/prices', pricesRouter);
app.route('/customers', customersRouter);
app.route('/customer-payments', customerPaymentsRouter);
app.route('/bills', billsRouter);
app.route('/cheques', chequesRouter);
app.route('/charcoal', charcoalRouter);
app.route('/stats', statsRouter);
app.route('/auth', authRouter);

app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'No such endpoint' } }, 404));

app.onError((err, c) => {
  if (err instanceof ZodError) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      },
      400,
    );
  }
  if (err instanceof HttpError) {
    for (const [name, value] of Object.entries(err.headers ?? {})) c.header(name, value);
    return c.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      err.status as 400,
    );
  }
  console.error(`[error] ${c.req.method} ${c.req.path}`, err);
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server' } }, 500);
});

Deno.serve(app.fetch);
