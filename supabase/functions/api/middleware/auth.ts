import type { MiddlewareHandler } from 'hono';
import { jwtVerify, SignJWT } from 'jose';
import { config } from '../config.ts';
import { sql } from '../db.ts';
import { HttpError } from '../lib/errors.ts';
import type { AppEnv, Ctx } from '../lib/http.ts';
import type { PinRole } from '../lib/types.ts';

const AUDIENCE = 'coconut-pos';
const ISSUER = 'coconut-pos';
const KEY = new TextEncoder().encode(config.jwtSecret);

export function sessionTtlMinutes(role: PinRole): number {
  // The counter stays open all day; the owner's session is short on purpose.
  return role === 'ADMIN' ? config.adminSessionTtlMinutes : config.userSessionTtlMinutes;
}

export interface Account {
  id: string;
  username: string;
  role: PinRole;
  pinVersion: number;
}

export interface Session {
  userId: string;
  username: string;
  role: PinRole;
  expiresAt: number;
}

export async function signSession(
  account: Account,
): Promise<{ token: string; role: PinRole; username: string; expiresAt: string }> {
  const expiresInSec = sessionTtlMinutes(account.role) * 60;
  const nowSec = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ role: account.role, pv: account.pinVersion })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setAudience(AUDIENCE)
    .setIssuer(ISSUER)
    .setSubject(account.id)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + expiresInSec)
    .sign(KEY);
  return {
    token,
    role: account.role,
    username: account.username,
    expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads and checks the bearer token. Returns null when there isn't a usable one. */
export async function readSession(c: Ctx): Promise<Session | null> {
  const match = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '');
  if (!match?.[1]) return null;

  let claims: { sub?: string; role?: unknown; pv?: unknown; exp?: number };
  try {
    ({ payload: claims } = await jwtVerify(match[1], KEY, {
      algorithms: ['HS256'],
      audience: AUDIENCE,
      issuer: ISSUER,
    }));
  } catch {
    return null;
  }
  if (!claims.sub || !UUID.test(claims.sub)) return null;

  // A changed password ends every session opened with the old one, and the role
  // always comes from the account, never from the token alone.
  const [account] = await sql<Account[]>`
    SELECT id, username, role, pin_version FROM app_users WHERE id = ${claims.sub}`;
  if (!account || claims.pv !== account.pinVersion || claims.role !== account.role) return null;

  return { userId: account.id, username: account.username, role: account.role, expiresAt: (claims.exp ?? 0) * 1000 };
}

/** Is a temporary window open that lets counter sessions into the admin screens? */
export async function temporaryAdminUntil(): Promise<Date | null> {
  const [grant] = await sql<{ expiresAt: Date }[]>`
    SELECT expires_at FROM temporary_admin_access
    WHERE revoked_at IS NULL AND expires_at > now()
    ORDER BY expires_at DESC
    LIMIT 1`;
  return grant?.expiresAt ?? null;
}

/** Any signed-in person: the counter or the owner. Required to record anything. */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await readSession(c);
  if (!session) throw new HttpError(401, 'SESSION_REQUIRED', 'Sign in first');
  c.set('auth', { ...session, temporary: false });
  await next();
};

/**
 * Admin screens: the owner's PIN, or the counter during a window the owner opened.
 * The window is checked against the clock on every request, so it stops the moment
 * it expires or is ended — nothing is cached in the token.
 */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await readSession(c);
  if (!session) throw new HttpError(401, 'SESSION_REQUIRED', 'Sign in first');

  if (session.role === 'ADMIN') {
    c.set('auth', { ...session, temporary: false });
    await next();
    return;
  }

  const until = await temporaryAdminUntil();
  if (!until) throw new HttpError(403, 'ADMIN_REQUIRED', 'Admin access is required');
  c.set('auth', { ...session, temporary: true, expiresAt: Math.min(session.expiresAt, until.getTime()) });
  await next();
};

/**
 * Anything that could hand out more access: the PINs themselves and the temporary
 * window. Never reachable with a lent session.
 */
export const requireFullAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await readSession(c);
  if (!session || session.role !== 'ADMIN') throw new HttpError(401, 'ADMIN_REQUIRED', 'Admin sign-in required');
  c.set('auth', { ...session, temporary: false });
  await next();
};
