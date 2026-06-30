/**
 * NON-DESTRUCTIVE production account provisioning.
 *
 * Creates (or updates) the two accounts for the single-org model:
 *   - owner@messengly.app  -> superadmin (configures messengers)
 *   - user@messengly.app   -> user       (broadcasts only)
 *
 * It does NOT delete or deactivate any existing data or accounts — it only
 * upserts these two users and attaches them to the existing organization.
 * Existing accounts are listed so you can decide what to do with them later.
 *
 * Pass DATABASE_URL via env. Requires CONFIRM_PROD=yes to run.
 *   DATABASE_URL=... CONFIRM_PROD=yes npx tsx scripts/provision-prod-accounts.ts
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 12;

const OWNER_EMAIL = 'owner@messengly.app';
const USER_EMAIL = 'user@messengly.app';

function genPassword(): string {
  return randomBytes(18).toString('base64').replace(/[+/=]/g, '').slice(0, 20);
}

async function main() {
  if (process.env.CONFIRM_PROD !== 'yes') {
    console.error('Refusing to run without CONFIRM_PROD=yes');
    process.exit(1);
  }

  const existing = await prisma.user.findMany({
    select: { email: true, role: true, status: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Existing users (${existing.length}):`);
  for (const u of existing) console.log(`  - ${u.email} [${u.role}/${u.status}]`);

  // Attach to the existing organization (first one). Create one only if none.
  let org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!org) {
    org = await prisma.organization.create({
      data: { name: 'Messengly', defaultLanguage: 'ru', timezone: 'Europe/Moscow', status: 'active' },
    });
    console.log(`No org found — created "${org.name}" (${org.id}).`);
  } else {
    console.log(`Using existing organization "${org.name}" (${org.id}).`);
  }

  const ownerPassword = genPassword();
  const userPassword = genPassword();

  await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: { role: 'superadmin', status: 'active', organizationId: org.id, passwordHash: await bcrypt.hash(ownerPassword, BCRYPT_ROUNDS) },
    create: { email: OWNER_EMAIL, name: 'Owner', role: 'superadmin', status: 'active', organizationId: org.id, passwordHash: await bcrypt.hash(ownerPassword, BCRYPT_ROUNDS) },
  });

  await prisma.user.upsert({
    where: { email: USER_EMAIL },
    update: { role: 'user', status: 'active', organizationId: org.id, passwordHash: await bcrypt.hash(userPassword, BCRYPT_ROUNDS) },
    create: { email: USER_EMAIL, name: 'Broadcaster', role: 'user', status: 'active', organizationId: org.id, passwordHash: await bcrypt.hash(userPassword, BCRYPT_ROUNDS) },
  });

  console.log('\n========================================');
  console.log('  Production accounts provisioned');
  console.log('========================================');
  console.log(`  Superadmin: ${OWNER_EMAIL}`);
  console.log(`    ${ownerPassword}`);
  console.log(`  User:       ${USER_EMAIL}`);
  console.log(`    ${userPassword}`);
  console.log('========================================');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('provision-prod-accounts failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
