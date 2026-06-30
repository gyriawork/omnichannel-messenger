/**
 * One-off provisioning script for the single-organization setup.
 *
 * Produces exactly two accounts in one organization:
 *   - a superadmin (owner) who configures messengers (TG / Slack / WhatsApp)
 *   - a regular user (broadcaster) who only creates and sends broadcasts
 *
 * All previous demo data (users, chats, broadcasts, templates, etc.) is wiped
 * so the workspace is clean. Passwords are generated and printed once.
 *
 * Run from apps/api:  npx tsx scripts/setup-accounts.ts
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 12;

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const OWNER_EMAIL = 'owner@messengly.app';
const USER_EMAIL = 'user@messengly.app';

/** Generate a strong, typeable password. */
function genPassword(): string {
  // 18 random bytes -> 24 url-safe chars, no padding.
  return randomBytes(18).toString('base64').replace(/[+/=]/g, '').slice(0, 20);
}

async function main() {
  // ─── 0. Safety guard — this script WIPES all data. Never run on production. ───
  if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DESTRUCTIVE_SETUP !== 'yes') {
    console.error(
      'Refusing to run: this script deletes ALL data. It is a local-only\n' +
      'provisioning tool. To run intentionally on a non-production database,\n' +
      'set ALLOW_DESTRUCTIVE_SETUP=yes (and never set it in production).',
    );
    process.exit(1);
  }

  // ─── 1. Confirm connectivity & show what we're about to replace ───
  const existing = await prisma.user.findMany({
    select: { email: true, role: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Connected. Existing users (${existing.length}):`);
  for (const u of existing) console.log(`  - ${u.email} [${u.role}]`);

  // ─── 2. Wipe all application data (children → parents) ───
  // Order matters because most User/Chat relations are NOT onDelete: Cascade.
  await prisma.$transaction([
    prisma.reaction.deleteMany(),
    prisma.attachment.deleteMany(),
    prisma.message.deleteMany(),
    prisma.chatParticipant.deleteMany(),
    prisma.chatTag.deleteMany(),
    prisma.chatPreference.deleteMany(),
    prisma.broadcastChat.deleteMany(),
    prisma.broadcast.deleteMany(),
    prisma.template.deleteMany(),
    prisma.wikiArticleTag.deleteMany(),
    prisma.wikiArticle.deleteMany(),
    prisma.wikiTag.deleteMany(),
    prisma.wikiCategory.deleteMany(),
    prisma.tag.deleteMany(),
    prisma.integration.deleteMany(),
    prisma.platformConfig.deleteMany(),
    prisma.antibanSettings.deleteMany(),
    prisma.activityLog.deleteMany(),
    prisma.incomingWebhook.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.passwordResetToken.deleteMany(),
    prisma.chat.deleteMany(),
    prisma.user.deleteMany(),
    prisma.organization.deleteMany(),
  ]);
  console.log('Wiped previous data.');

  // ─── 3. Recreate the single organization ───
  const org = await prisma.organization.create({
    data: {
      id: ORG_ID,
      name: 'Messengly',
      defaultLanguage: 'ru',
      timezone: 'Europe/Moscow',
      chatVisibilityAll: true,
      status: 'active',
    },
  });

  // ─── 4. Create the two accounts ───
  const ownerPassword = genPassword();
  const userPassword = genPassword();

  await prisma.user.create({
    data: {
      email: OWNER_EMAIL,
      name: 'Owner',
      passwordHash: await bcrypt.hash(ownerPassword, BCRYPT_ROUNDS),
      role: 'superadmin',
      status: 'active',
      organizationId: org.id,
    },
  });

  await prisma.user.create({
    data: {
      email: USER_EMAIL,
      name: 'Broadcaster',
      passwordHash: await bcrypt.hash(userPassword, BCRYPT_ROUNDS),
      role: 'user',
      status: 'active',
      organizationId: org.id,
    },
  });

  console.log('\n========================================');
  console.log('  New accounts created — save these now');
  console.log('========================================');
  console.log(`  Superadmin (configures messengers):`);
  console.log(`    ${OWNER_EMAIL}`);
  console.log(`    ${ownerPassword}`);
  console.log(`  User (broadcasts only):`);
  console.log(`    ${USER_EMAIL}`);
  console.log(`    ${userPassword}`);
  console.log('========================================\n');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('setup-accounts failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
