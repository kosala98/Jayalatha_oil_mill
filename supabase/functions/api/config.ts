function env(name: string): string | undefined {
  const value = Deno.env.get(name);
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

function required(name: string): string {
  const value = env(name);
  if (!value) {
    throw new Error(`Missing required secret ${name}. Set it with: supabase secrets set ${name}=...`);
  }
  return value;
}

function int(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${name} must be an integer, got "${raw}"`);
  return n;
}

const jwtSecret = required('JWT_SECRET');
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long.');
}

export const config = {
  /**
   * Supabase injects SUPABASE_DB_URL into every function. DATABASE_URL overrides it,
   * e.g. to go through the transaction pooler (port 6543).
   */
  databaseUrl: env('DATABASE_URL') ?? required('SUPABASE_DB_URL'),
  jwtSecret,
  adminSessionTtlMinutes: int('ADMIN_SESSION_TTL_MINUTES', 30),
  /** The counter signs in once and stays signed in through the working day. */
  userSessionTtlMinutes: int('USER_SESSION_TTL_MINUTES', 720),
  /** Empty = any origin. Tokens travel in the Authorization header, never in cookies. */
  corsOrigins: (env('CORS_ORIGINS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  businessUtcOffsetMinutes: int('BUSINESS_UTC_OFFSET_MINUTES', 330),
  allowNegativeCharcoalStock: env('ALLOW_NEGATIVE_CHARCOAL_STOCK') === 'true',
  /** Global PIN lockout (in addition to per-IP rate limiting). */
  pinMaxConsecutiveFailures: 10,
  pinLockoutMinutes: 15,
  /** Per-IP limit on wrong PINs, shared by sign-in and PIN change. */
  pinAttemptsPerIp: 5,
  pinAttemptWindowMinutes: 15,
  /** How far back an offline-queued transaction may be dated. */
  maxBackdateDays: 30,
  /** Same ceiling the Express JSON parser had. */
  maxBodyBytes: 32 * 1024,
} as const;
