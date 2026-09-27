import type { MiddlewareHandler } from 'hono';
import { config } from '../config.ts';
import { sql } from '../db.ts';
import { HttpError } from '../lib/errors.ts';
import { type AppEnv, clientIp } from '../lib/http.ts';

/**
 * Per-IP limit on PIN attempts. Edge function instances share no memory, so the
 * counter lives in the rate_limit_hits table. Only failed attempts (any 4xx/5xx)
 * count, as with express-rate-limit's skipSuccessfulRequests. A global DB-backed
 * lockout also applies (see the login route).
 */
export const pinLoginLimiter: MiddlewareHandler<AppEnv> = async (c, next) => {
  const ip = clientIp(c);
  if (!ip) {
    await next();
    return;
  }
  const key = `pin:${ip}`;
  const windowMin = config.pinAttemptWindowMinutes;

  const [row] = await sql<{ hits: number; retryAfterSec: number }[]>`
    SELECT hits,
           ceil(extract(epoch FROM window_start + make_interval(mins => ${windowMin}) - now()))::int AS retry_after_sec
    FROM rate_limit_hits
    WHERE key = ${key} AND window_start > now() - make_interval(mins => ${windowMin})`;
  if (row && row.hits >= config.pinAttemptsPerIp) {
    throw new HttpError(
      429,
      'TOO_MANY_ATTEMPTS',
      'Too many PIN attempts. Try again in 15 minutes.',
      undefined,
      { 'Retry-After': String(Math.max(1, row.retryAfterSec)) },
    );
  }

  let failed = false;
  try {
    await next();
    failed = c.res.status >= 400;
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    if (failed) await recordFailure(key, windowMin);
  }
};

async function recordFailure(key: string, windowMin: number): Promise<void> {
  try {
    // A fixed window per IP: restart it once the previous one has run out.
    await sql`
      INSERT INTO rate_limit_hits (key, window_start, hits) VALUES (${key}, now(), 1)
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE WHEN rate_limit_hits.window_start <= now() - make_interval(mins => ${windowMin})
                    THEN 1 ELSE rate_limit_hits.hits + 1 END,
        window_start = CASE WHEN rate_limit_hits.window_start <= now() - make_interval(mins => ${windowMin})
                    THEN now() ELSE rate_limit_hits.window_start END`;
    await sql`DELETE FROM rate_limit_hits WHERE window_start < now() - interval '1 day'`;
  } catch (err) {
    // Never turn a wrong PIN into a 500 because the counter could not be written.
    console.error('[rate-limit] could not record a failed attempt', err);
  }
}
