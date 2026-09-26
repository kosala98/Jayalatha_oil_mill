import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  }
  return value.trim();
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${name} must be an integer, got "${raw}"`);
  return n;
}

const jwtSecret = required('JWT_SECRET');
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long.');
}

export const config = {
  port: int('PORT', 8080),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  jwtSecret,
  adminSessionTtlMinutes: int('ADMIN_SESSION_TTL_MINUTES', 30),
  /** The counter signs in once and stays signed in through the working day. */
  userSessionTtlMinutes: int('USER_SESSION_TTL_MINUTES', 720),
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  trustProxy: int('TRUST_PROXY', 1),
  serveClientDir: process.env.SERVE_CLIENT_DIR?.trim() || undefined,
  businessUtcOffsetMinutes: int('BUSINESS_UTC_OFFSET_MINUTES', 330),
  allowNegativeCharcoalStock: process.env.ALLOW_NEGATIVE_CHARCOAL_STOCK === 'true',
  /** Global PIN lockout (in addition to per-IP rate limiting). */
  pinMaxConsecutiveFailures: 10,
  pinLockoutMinutes: 15,
  /** How far back an offline-queued transaction may be dated. */
  maxBackdateDays: 30,
} as const;
