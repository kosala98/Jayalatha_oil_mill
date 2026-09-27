import bcrypt from 'bcryptjs';
import { Hono } from 'hono';
import { z } from 'zod';
import { config } from '../config.ts';
import { sql, transaction } from '../db.ts';
import { HttpError } from '../lib/errors.ts';
import { type AppEnv, contextFrom, readJson } from '../lib/http.ts';
import type { PinRole } from '../lib/types.ts';
import { grantAccessSchema, passwordSchema, usernameSchema } from '../lib/validation.ts';
import {
  readSession,
  requireAdmin,
  requireFullAdmin,
  signSession,
  temporaryAdminUntil,
} from '../middleware/auth.ts';
import { pinLoginLimiter } from '../middleware/rateLimit.ts';
import { writeAudit } from '../services/audit.ts';

export const BCRYPT_COST = 12;
export const authRouter = new Hono<AppEnv>();

/**
 * Compared against when the username does not exist, so response time doesn't reveal
 * which usernames are real. bcrypt('no-such-user', 12), precomputed: hashing at start-up
 * would spend the function's CPU budget on every cold start.
 */
const DUMMY_HASH = '$2a$12$JcMNW/Nwd4GHhRRuxyNGEeOa5fGqiHVl12FHUK7cuCEeDHia3C/wy';

interface AccountRow {
  id: string;
  username: string;
  role: PinRole;
  passwordHash: string;
  pinVersion: number;
  failedAttempts: number;
  lockedUntil: Date | null;
}

function lockedSeconds(lockedUntil: Date | null): number | null {
  if (!lockedUntil || lockedUntil.getTime() <= Date.now()) return null;
  return Math.ceil((lockedUntil.getTime() - Date.now()) / 1000);
}

const wrongCredentials = () => new HttpError(401, 'WRONG_CREDENTIALS', 'Wrong username or password');

/**
 * Username and password. The account's role decides what the person sees: the
 * counter screens ("user"), or the counter screens plus the books ("admin").
 */
authRouter.post('/login', pinLoginLimiter, async (c) => {
  const { username, password } = z
    .object({ username: usernameSchema, password: passwordSchema })
    .parse(await readJson(c));

  const [account] = await sql<AccountRow[]>`
    SELECT id, username, role, password_hash, pin_version, failed_attempts, locked_until
    FROM app_users WHERE username = ${username}`;

  if (!account) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw wrongCredentials();
  }

  const retryAfterSec = lockedSeconds(account.lockedUntil);
  if (retryAfterSec !== null) {
    throw new HttpError(429, 'PIN_LOCKED', 'Too many wrong passwords. Try again later.', { retryAfterSec }, {
      'Retry-After': String(retryAfterSec),
    });
  }

  if (await bcrypt.compare(password, account.passwordHash)) {
    if (account.failedAttempts !== 0 || account.lockedUntil) {
      await sql`UPDATE app_users SET failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = ${account.id}`;
    }
    const session = await signSession(account);
    return c.json({ ...session, temporaryAdminUntil: account.role === 'USER' ? await temporaryAdminUntil() : null });
  }

  // Too many wrong passwords in a row lock the account for a while, whatever the IP.
  const [updated] = await sql<{ failedAttempts: number }[]>`
    UPDATE app_users SET failed_attempts = failed_attempts + 1, updated_at = now()
    WHERE id = ${account.id}
    RETURNING failed_attempts`;
  if (updated && updated.failedAttempts >= config.pinMaxConsecutiveFailures) {
    const lockedUntil = new Date(Date.now() + config.pinLockoutMinutes * 60_000);
    await sql`
      UPDATE app_users SET failed_attempts = 0, locked_until = ${lockedUntil}, updated_at = now()
      WHERE id = ${account.id}`;
  }
  throw wrongCredentials();
});

/** What this session may do right now, including any window the owner opened. */
authRouter.get('/session', async (c) => {
  const [session, until] = await Promise.all([readSession(c), temporaryAdminUntil()]);
  return c.json({
    role: session?.role ?? null,
    username: session?.username ?? null,
    expiresAt: session ? new Date(session.expiresAt).toISOString() : null,
    temporaryAdminUntil: until ? until.toISOString() : null,
  });
});

const changePinSchema = z
  .object({ role: z.enum(['USER', 'ADMIN']), currentPin: passwordSchema, newPin: passwordSchema })
  .refine((v) => v.currentPin !== v.newPin, { path: ['newPin'], message: 'New password must differ from the current one' });

/**
 * The owner sets both passwords, and must re-enter their own to do it — so an
 * unlocked tablet left on the counter can't be used to change the locks.
 * `role` picks the account: "USER" is the counter's, "ADMIN" the owner's.
 */
authRouter.post('/change-pin', pinLoginLimiter, requireFullAdmin, async (c) => {
  const { role, currentPin, newPin } = changePinSchema.parse(await readJson(c));
  const ctx = contextFrom(c);
  const me = c.get('auth')!;

  const [admin] = await sql<{ passwordHash: string }[]>`SELECT password_hash FROM app_users WHERE id = ${me.userId}`;
  if (!admin || !(await bcrypt.compare(currentPin, admin.passwordHash))) {
    throw new HttpError(401, 'WRONG_PIN', 'Wrong admin password');
  }

  const passwordHash = await bcrypt.hash(newPin, BCRYPT_COST);
  const updated = await transaction(async (tx) => {
    const [row] = await tx<{ id: string; username: string; role: PinRole; pinVersion: number }[]>`
      UPDATE app_users SET
        password_hash = ${passwordHash},
        pin_version = pin_version + 1,
        failed_attempts = 0,
        locked_until = NULL,
        updated_at = now()
      WHERE role = ${role}
      RETURNING id, username, role, pin_version`;
    if (!row) throw new HttpError(404, 'NOT_FOUND', `No ${role.toLowerCase()} account`);
    await writeAudit(tx, {
      action: 'UPDATE',
      entity: 'CREDENTIAL',
      entityId: row.username,
      ctx,
      after: { username: row.username, role, pinVersion: row.pinVersion },
      reason: 'Password changed',
    });
    return row;
  });

  // Changing the admin password ends this session too; hand back a fresh one.
  return c.json(role === 'ADMIN' ? await signSession(updated) : { ok: true });
});

// ---------------------------------------------------------------------------
// Temporary admin access for the counter
// ---------------------------------------------------------------------------

authRouter.post('/temporary-access', requireFullAdmin, async (c) => {
  const { minutes, reason } = grantAccessSchema.parse(await readJson(c));
  const ctx = contextFrom(c);

  const grant = await transaction(async (tx) => {
    // One window at a time: granting again replaces whatever was running.
    await tx`
      UPDATE temporary_admin_access SET revoked_at = now()
      WHERE revoked_at IS NULL AND expires_at > now()`;
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    const [row] = await tx<{ id: string; expiresAt: Date; reason: string | null }[]>`
      INSERT INTO temporary_admin_access (id, expires_at, reason)
      VALUES (gen_random_uuid(), ${expiresAt}, ${reason})
      RETURNING id, expires_at, reason`;
    await writeAudit(tx, {
      action: 'CREATE',
      entity: 'TEMP_ACCESS',
      entityId: row!.id,
      ctx,
      after: { minutes, expiresAt: row!.expiresAt },
      reason,
    });
    return row!;
  });

  return c.json({ id: grant.id, expiresAt: grant.expiresAt.toISOString(), reason: grant.reason }, 201);
});

authRouter.delete('/temporary-access', requireFullAdmin, async (c) => {
  const ctx = contextFrom(c);
  const ended = await transaction(async (tx) => {
    const result = await tx`
      UPDATE temporary_admin_access SET revoked_at = now()
      WHERE revoked_at IS NULL AND expires_at > now()`;
    if (result.count === 0) throw new HttpError(409, 'NO_TEMPORARY_ACCESS', 'No temporary access is active');
    await writeAudit(tx, { action: 'DELETE', entity: 'TEMP_ACCESS', entityId: 'active', ctx, reason: 'Temporary access ended' });
    return result.count;
  });
  return c.json({ ended });
});

/** Read-only: lets the admin screen show whether a window is open. */
authRouter.get('/temporary-access', requireAdmin, async (c) => {
  const until = await temporaryAdminUntil();
  return c.json({ expiresAt: until ? until.toISOString() : null });
});
