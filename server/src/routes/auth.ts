import bcrypt from 'bcryptjs';
import type { PinRole } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { prisma } from '../db';
import { HttpError } from '../lib/errors';
import { contextFrom } from '../lib/http';
import { grantAccessSchema, pinSchema } from '../lib/validation';
import { requireAdmin, requireFullAdmin, signSession, temporaryAdminUntil } from '../middleware/auth';
import { pinLoginLimiter } from '../middleware/rateLimit';
import { writeAudit } from '../services/audit';

export const BCRYPT_COST = 12;
export const authRouter = Router();

// Compared against when a PIN isn't configured, so response time doesn't reveal that.
const DUMMY_HASH = bcrypt.hashSync('no-pin-configured', BCRYPT_COST);

async function lockedMessage(role: PinRole, lockedUntil: Date | null) {
  if (!lockedUntil || lockedUntil.getTime() <= Date.now()) return null;
  return Math.ceil((lockedUntil.getTime() - Date.now()) / 1000);
}

/**
 * One PIN box opens the app. Which PIN was typed decides what the person sees:
 * the counter screens, or the counter screens plus the books.
 */
authRouter.post('/login', pinLoginLimiter, async (req, res) => {
  const { pin } = z.object({ pin: pinSchema }).parse(req.body);
  const credentials = await prisma.credential.findMany();

  if (credentials.length === 0) {
    await bcrypt.compare(pin, DUMMY_HASH);
    throw new HttpError(503, 'PIN_NOT_CONFIGURED', 'No PINs have been set up. Run the seed script.');
  }

  // Admin first: if both PINs were ever set the same, the owner still gets the books.
  const order: PinRole[] = ['ADMIN', 'USER'];
  for (const role of order) {
    const credential = credentials.find((c) => c.role === role);
    if (!credential) continue;

    const retryAfterSec = await lockedMessage(role, credential.lockedUntil);
    if (retryAfterSec !== null) {
      res.set('Retry-After', String(retryAfterSec));
      throw new HttpError(429, 'PIN_LOCKED', 'Too many wrong PINs. Try again later.', { retryAfterSec });
    }

    if (await bcrypt.compare(pin, credential.pinHash)) {
      if (credential.failedAttempts !== 0 || credential.lockedUntil) {
        await prisma.credential.update({ where: { role }, data: { failedAttempts: 0, lockedUntil: null } });
      }
      const session = signSession(role, credential.pinVersion);
      res.json({ ...session, temporaryAdminUntil: role === 'USER' ? await temporaryAdminUntil() : null });
      return;
    }
  }

  // Wrong for every role: count it against both, so guessing is slowed either way.
  for (const credential of credentials) {
    const updated = await prisma.credential.update({
      where: { role: credential.role },
      data: { failedAttempts: { increment: 1 } },
    });
    if (updated.failedAttempts >= config.pinMaxConsecutiveFailures) {
      await prisma.credential.update({
        where: { role: credential.role },
        data: { failedAttempts: 0, lockedUntil: new Date(Date.now() + config.pinLockoutMinutes * 60_000) },
      });
    }
  }
  throw new HttpError(401, 'WRONG_PIN', 'Wrong PIN');
});

/** What this session may do right now, including any window the owner opened. */
authRouter.get('/session', async (req, res) => {
  const until = await temporaryAdminUntil();
  res.json({
    role: req.auth?.role ?? null,
    expiresAt: req.auth ? new Date(req.auth.expiresAt).toISOString() : null,
    temporaryAdminUntil: until ? until.toISOString() : null,
  });
});

const changePinSchema = z
  .object({ role: z.enum(['USER', 'ADMIN']), currentPin: pinSchema, newPin: pinSchema })
  .refine((v) => v.currentPin !== v.newPin, { path: ['newPin'], message: 'New PIN must differ from the current PIN' });

/**
 * The owner sets both PINs, and must re-enter the admin PIN to do it — so an
 * unlocked tablet left on the counter can't be used to change the locks.
 */
authRouter.post('/change-pin', pinLoginLimiter, requireFullAdmin, async (req, res) => {
  const { role, currentPin, newPin } = changePinSchema.parse(req.body);
  const ctx = contextFrom(req);

  const admin = await prisma.credential.findUnique({ where: { role: 'ADMIN' } });
  if (!admin) throw new HttpError(503, 'PIN_NOT_CONFIGURED', 'No admin PIN configured');
  if (!(await bcrypt.compare(currentPin, admin.pinHash))) throw new HttpError(401, 'WRONG_PIN', 'Wrong admin PIN');

  const pinHash = await bcrypt.hash(newPin, BCRYPT_COST);
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.credential.upsert({
      where: { role },
      create: { role, pinHash, pinVersion: 1 },
      update: { pinHash, pinVersion: { increment: 1 }, failedAttempts: 0, lockedUntil: null },
    });
    await writeAudit(tx, {
      action: 'UPDATE',
      entity: 'CREDENTIAL',
      entityId: role,
      ctx,
      after: { role, pinVersion: row.pinVersion },
      reason: 'PIN changed',
    });
    return row;
  });

  // Changing the admin PIN ends this session too; hand back a fresh one.
  res.json(role === 'ADMIN' ? signSession('ADMIN', updated.pinVersion) : { ok: true });
});

// ---------------------------------------------------------------------------
// Temporary admin access for the counter
// ---------------------------------------------------------------------------

authRouter.post('/temporary-access', requireFullAdmin, async (req, res) => {
  const { minutes, reason } = grantAccessSchema.parse(req.body);
  const ctx = contextFrom(req);

  const grant = await prisma.$transaction(async (tx) => {
    // One window at a time: granting again replaces whatever was running.
    await tx.temporaryAdminAccess.updateMany({
      where: { revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });
    const row = await tx.temporaryAdminAccess.create({
      data: { expiresAt: new Date(Date.now() + minutes * 60_000), reason },
    });
    await writeAudit(tx, {
      action: 'CREATE',
      entity: 'TEMP_ACCESS',
      entityId: row.id,
      ctx,
      after: { minutes, expiresAt: row.expiresAt },
      reason,
    });
    return row;
  });

  res.status(201).json({ id: grant.id, expiresAt: grant.expiresAt.toISOString(), reason: grant.reason });
});

authRouter.delete('/temporary-access', requireFullAdmin, async (req, res) => {
  const ctx = contextFrom(req);
  const ended = await prisma.$transaction(async (tx) => {
    const { count } = await tx.temporaryAdminAccess.updateMany({
      where: { revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new HttpError(409, 'NO_TEMPORARY_ACCESS', 'No temporary access is active');
    await writeAudit(tx, { action: 'DELETE', entity: 'TEMP_ACCESS', entityId: 'active', ctx, reason: 'Temporary access ended' });
    return count;
  });
  res.json({ ended });
});

/** Read-only: lets the admin screen show whether a window is open. */
authRouter.get('/temporary-access', requireAdmin, async (_req, res) => {
  const until = await temporaryAdminUntil();
  res.json({ expiresAt: until ? until.toISOString() : null });
});
