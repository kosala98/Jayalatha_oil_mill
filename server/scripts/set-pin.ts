/**
 * Sets or resets a PIN from the command line — the way back in if one is forgotten.
 * Ends every session opened with the old PIN.
 *
 *   npm run set-pin -- admin 482913
 *   npm run set-pin -- user 1234
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const [roleArg, pin] = process.argv.slice(2);
  const role = roleArg?.toUpperCase();
  if (role !== 'ADMIN' && role !== 'USER') {
    throw new Error('Usage: npm run set-pin -- <admin|user> <pin>');
  }
  if (!pin || !/^\d{4,8}$/.test(pin)) throw new Error('The PIN must be 4 to 8 digits');

  const pinHash = await bcrypt.hash(pin, 12);
  const row = await prisma.credential.upsert({
    where: { role },
    create: { role, pinHash },
    update: { pinHash, pinVersion: { increment: 1 }, failedAttempts: 0, lockedUntil: null },
  });
  await prisma.auditLog.create({
    data: {
      action: 'UPDATE',
      entity: 'CREDENTIAL',
      entityId: role,
      actor: 'SYSTEM',
      after: { role, pinVersion: row.pinVersion },
      reason: 'PIN set from the command line',
    },
  });
  console.log(`[set-pin] ${role} PIN updated (version ${row.pinVersion}). Existing ${role} sessions have ended.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
