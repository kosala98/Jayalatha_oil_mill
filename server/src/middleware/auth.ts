import type { NextFunction, Request, Response } from 'express';
import type { PinRole } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../db';
import { HttpError } from '../lib/errors';

const AUDIENCE = 'coconut-pos';
const ISSUER = 'coconut-pos';

interface SessionClaims {
  role: PinRole;
  pv: number; // pin version of that role
}

export function sessionTtlMinutes(role: PinRole): number {
  // The counter stays open all day; the owner's session is short on purpose.
  return role === 'ADMIN' ? config.adminSessionTtlMinutes : config.userSessionTtlMinutes;
}

export function signSession(role: PinRole, pinVersion: number): { token: string; role: PinRole; expiresAt: string } {
  const expiresInSec = sessionTtlMinutes(role) * 60;
  const token = jwt.sign({ role, pv: pinVersion } satisfies SessionClaims, config.jwtSecret, {
    algorithm: 'HS256',
    audience: AUDIENCE,
    issuer: ISSUER,
    subject: role.toLowerCase(),
    expiresIn: expiresInSec,
  });
  return { token, role, expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString() };
}

/** Reads and checks the bearer token. Returns null when there isn't a usable one. */
async function readSession(req: Request): Promise<{ role: PinRole; expiresAt: number } | null> {
  const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') ?? '');
  if (!match?.[1]) return null;

  let claims: jwt.JwtPayload & Partial<SessionClaims>;
  try {
    claims = jwt.verify(match[1], config.jwtSecret, {
      algorithms: ['HS256'],
      audience: AUDIENCE,
      issuer: ISSUER,
    }) as jwt.JwtPayload & Partial<SessionClaims>;
  } catch {
    return null;
  }
  if (claims.role !== 'USER' && claims.role !== 'ADMIN') return null;

  // A changed PIN ends every session opened with the old one.
  const credential = await prisma.credential.findUnique({ where: { role: claims.role }, select: { pinVersion: true } });
  if (!credential || claims.pv !== credential.pinVersion) return null;

  return { role: claims.role, expiresAt: (claims.exp ?? 0) * 1000 };
}

/** Is a temporary window open that lets counter sessions into the admin screens? */
export async function temporaryAdminUntil(): Promise<Date | null> {
  const grant = await prisma.temporaryAdminAccess.findFirst({
    where: { revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { expiresAt: 'desc' },
    select: { expiresAt: true },
  });
  return grant?.expiresAt ?? null;
}

/** Any signed-in person: the counter or the owner. Required to record anything. */
export async function requireSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const session = await readSession(req);
  if (!session) throw new HttpError(401, 'SESSION_REQUIRED', 'Sign in with your PIN');
  req.auth = { ...session, temporary: false };
  next();
}

/**
 * Admin screens: the owner's PIN, or the counter during a window the owner opened.
 * The window is checked against the clock on every request, so it stops the moment
 * it expires or is ended — nothing is cached in the token.
 */
export async function requireAdmin(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const session = await readSession(req);
  if (!session) throw new HttpError(401, 'SESSION_REQUIRED', 'Sign in with your PIN');

  if (session.role === 'ADMIN') {
    req.auth = { ...session, temporary: false };
    next();
    return;
  }

  const until = await temporaryAdminUntil();
  if (!until) throw new HttpError(403, 'ADMIN_REQUIRED', 'Admin access is required');
  req.auth = { ...session, temporary: true, expiresAt: Math.min(session.expiresAt, until.getTime()) };
  next();
}

/**
 * Anything that could hand out more access: the PINs themselves and the temporary
 * window. Never reachable with a lent session.
 */
export async function requireFullAdmin(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const session = await readSession(req);
  if (!session || session.role !== 'ADMIN') throw new HttpError(401, 'ADMIN_REQUIRED', 'Admin PIN required');
  req.auth = { ...session, temporary: false };
  next();
}
