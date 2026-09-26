/**
 * Seeds the fixed product catalog (idempotent upsert) and, only where a PIN does
 * not exist yet, creates it from INITIAL_ADMIN_PIN / INITIAL_USER_PIN.
 * Never overwrites a PIN that is already set.
 *
 *   npm run db:seed
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { PRODUCT_CATALOG } from '../src/lib/catalog';

const prisma = new PrismaClient();

async function main() {
  for (const p of PRODUCT_CATALOG) {
    await prisma.product.upsert({
      where: { code: p.code },
      create: { ...p, active: true },
      update: { nameSi: p.nameSi, nameEn: p.nameEn, isCharcoal: p.isCharcoal, allowedUnits: p.allowedUnits, sortOrder: p.sortOrder },
    });
  }
  console.log(`[seed] ${PRODUCT_CATALOG.length} products upserted`);

  for (const [role, envName] of [
    ['ADMIN', 'INITIAL_ADMIN_PIN'],
    ['USER', 'INITIAL_USER_PIN'],
  ] as const) {
    const existing = await prisma.credential.findUnique({ where: { role } });
    if (existing) {
      console.log(`[seed] ${role} PIN already set — leaving it unchanged`);
      continue;
    }

    const pin = process.env[envName]?.trim();
    if (!pin) {
      console.warn(`[seed] No ${role} PIN yet and ${envName} is empty. Set one with: npm run set-pin -- ${role.toLowerCase()} <pin>`);
      continue;
    }
    if (!/^\d{4,8}$/.test(pin)) throw new Error(`${envName} must be 4-8 digits`);

    const pinHash = await bcrypt.hash(pin, 12);
    await prisma.$transaction([
      prisma.credential.create({ data: { role, pinHash } }),
      prisma.auditLog.create({
        data: { action: 'CREATE', entity: 'CREDENTIAL', entityId: role, actor: 'SYSTEM', reason: 'Initial PIN from seed' },
      }),
    ]);
    console.log(`[seed] ${role} PIN created. Remove ${envName} from your environment now.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
