/**
 * Checks the database setup before anything else runs, and says what is wrong in
 * plain words. Most failed installs are one of a handful of things — a placeholder
 * left in .env, a password with a "/" in it, the wrong pooler port — and each of
 * those produces a different unhelpful error from Prisma further down the line.
 *
 *   npm run check
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const problems: string[] = [];
const notes: string[] = [];

function mask(url: string): string {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, (_m, user) => `://${user}:••••@`);
}

function checkUrl(name: string, expectedPort: string): URL | null {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') {
    problems.push(`${name} is empty. Copy .env.example to .env and paste your connection string in.`);
    return null;
  }
  if (/USER:PASSWORD|\[YOUR-PASSWORD\]|@HOST|\[/.test(raw)) {
    problems.push(`${name} still has the example placeholders in it — replace USER, PASSWORD and HOST with the real values.`);
    return null;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    problems.push(
      `${name} cannot be read as a URL. This is almost always a password containing @ / : # or ? — ` +
        `either URL-encode it (/ becomes %2F, @ becomes %40) or reset the database password to letters and digits only.`,
    );
    return null;
  }

  if (!url.port) {
    problems.push(`${name} has no port. It should end with :${expectedPort}/postgres`);
  } else if (url.port !== expectedPort) {
    notes.push(`${name} uses port ${url.port}; the usual port for this one is ${expectedPort}.`);
  }
  if (url.hostname.includes('pooler') && !url.username.includes('.')) {
    problems.push(
      `${name} points at a Supabase pooler but the user is "${url.username}". ` +
        `The pooler needs the project ref too, like postgres.abcdefghijklmnop`,
    );
  }
  if (decodeURIComponent(url.password) !== url.password && /%2F|%40|%23/i.test(url.password)) {
    notes.push(`${name} has an escaped character in the password — that is correct, nothing to do.`);
  }
  return url;
}

async function main() {
  console.log('— checking .env —');
  const pooled = checkUrl('DATABASE_URL', '6543');
  const direct = checkUrl('DIRECT_URL', '5432');

  const secret = process.env.JWT_SECRET ?? '';
  if (secret.length < 32) {
    problems.push(
      'JWT_SECRET must be at least 32 characters. Generate one with:\n' +
        '    node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    );
  }
  if (/paste|your-|secret-here/i.test(secret)) {
    problems.push('JWT_SECRET still looks like placeholder text.');
  }

  if (pooled && direct && pooled.hostname !== direct.hostname && !direct.hostname.startsWith('db.')) {
    notes.push('DATABASE_URL and DIRECT_URL point at different hosts. That is fine for Neon, unusual for Supabase.');
  }

  if (problems.length > 0) {
    console.log('\n✗ Fix these first:\n');
    for (const p of problems) console.log('  • ' + p);
    process.exitCode = 1;
    return;
  }

  console.log('  DATABASE_URL  ' + mask(process.env.DATABASE_URL ?? ''));
  console.log('  DIRECT_URL    ' + mask(process.env.DIRECT_URL ?? ''));
  for (const n of notes) console.log('  note: ' + n);

  console.log('\n— connecting —');
  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('  connection works');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log('  ✗ could not connect');
    if (/P1000|authentication failed/i.test(message)) {
      console.log(
        '    The host answered but rejected the password. Reset it in the database dashboard\n' +
          '    and paste the new one into both URLs (letters and digits only avoids escaping).',
      );
    } else if (/P1001|reach database server/i.test(message)) {
      console.log(
        '    Nothing answered at that address. Check the host name, and prefer the pooler host —\n' +
          '    the direct db.*.supabase.co host needs IPv6, which many home connections lack.',
      );
    } else {
      console.log('    ' + message.split('\n')[0]);
    }
    process.exitCode = 1;
    return;
  }

  // The schema itself: has anything been migrated yet?
  try {
    const [row] = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM information_schema.tables WHERE table_schema = 'public'
    `;
    const tables = Number(row?.count ?? 0);
    console.log(`  ${tables} tables in the database`);
    if (tables === 0) console.log('    run: npm run db:migrate && npm run db:seed');
    else {
      const pins = await prisma.credential.count();
      const products = await prisma.product.count();
      console.log(`  ${products} products, ${pins} PIN(s) set`);
      if (products === 0 || pins === 0) console.log('    run: npm run db:seed');
    }
  } catch (err) {
    console.log('  tables not readable yet — run: npm run db:migrate');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
