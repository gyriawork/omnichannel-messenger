import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;

async function main() {
  console.log('Seeding database...');

  // ─── Organization ───
  const org = await prisma.organization.upsert({
    where: { id: '00000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Omnichannel Demo',
      defaultLanguage: 'en',
      timezone: 'Europe/Moscow',
      chatVisibilityAll: true,
      status: 'active',
    },
  });
  console.log(`Organization: ${org.name} (${org.id})`);

  // ─── Super Admin ───
  const superadminHash = await bcrypt.hash('admin123', BCRYPT_ROUNDS);
  const superadmin = await prisma.user.upsert({
    where: { email: 'superadmin@omnichannel.dev' },
    update: {},
    create: {
      email: 'superadmin@omnichannel.dev',
      name: 'Super Admin',
      passwordHash: superadminHash,
      role: 'superadmin',
      status: 'active',
      organizationId: org.id,
    },
  });
  console.log(`Super Admin: ${superadmin.email} / admin123`);

  // ─── Admin ───
  const adminHash = await bcrypt.hash('admin123', BCRYPT_ROUNDS);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@omnichannel.dev' },
    update: {},
    create: {
      email: 'admin@omnichannel.dev',
      name: 'Anton Petrov',
      passwordHash: adminHash,
      role: 'admin',
      status: 'active',
      organizationId: org.id,
    },
  });
  console.log(`Admin: ${admin.email} / admin123`);

  // ─── Regular Users ───
  const userHash = await bcrypt.hash('user123', BCRYPT_ROUNDS);

  const user1 = await prisma.user.upsert({
    where: { email: 'maria@omnichannel.dev' },
    update: {},
    create: {
      email: 'maria@omnichannel.dev',
      name: 'Maria Ivanova',
      passwordHash: userHash,
      role: 'user',
      status: 'active',
      organizationId: org.id,
      lastActiveAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    },
  });

  const user2 = await prisma.user.upsert({
    where: { email: 'alex@omnichannel.dev' },
    update: {},
    create: {
      email: 'alex@omnichannel.dev',
      name: 'Alex Sokolov',
      passwordHash: userHash,
      role: 'user',
      status: 'active',
      organizationId: org.id,
      lastActiveAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // yesterday
    },
  });

  const user3 = await prisma.user.upsert({
    where: { email: 'elena@omnichannel.dev' },
    update: {},
    create: {
      email: 'elena@omnichannel.dev',
      name: 'Elena Kuznetsova',
      passwordHash: userHash,
      role: 'user',
      status: 'deactivated',
      organizationId: org.id,
    },
  });

  console.log(`Users: maria, alex (user123), elena (deactivated)`);

  // ─── Tags ───
  const tags = await Promise.all([
    prisma.tag.upsert({
      where: { name_organizationId: { name: 'VIP', organizationId: org.id } },
      update: {},
      create: { name: 'VIP', color: '#6366f1', organizationId: org.id },
    }),
    prisma.tag.upsert({
      where: { name_organizationId: { name: 'Support', organizationId: org.id } },
      update: {},
      create: { name: 'Support', color: '#16a34a', organizationId: org.id },
    }),
    prisma.tag.upsert({
      where: { name_organizationId: { name: 'Sales', organizationId: org.id } },
      update: {},
      create: { name: 'Sales', color: '#d97706', organizationId: org.id },
    }),
    prisma.tag.upsert({
      where: { name_organizationId: { name: 'Urgent', organizationId: org.id } },
      update: {},
      create: { name: 'Urgent', color: '#dc2626', organizationId: org.id },
    }),
  ]);
  console.log(`Tags: ${tags.map((t) => t.name).join(', ')}`);

  // ─── Sample Chats ───
  const chat1 = await prisma.chat.upsert({
    where: {
      externalChatId_messenger_organizationId: {
        externalChatId: 'tg-chat-001',
        messenger: 'telegram',
        organizationId: org.id,
      },
    },
    update: {},
    create: {
      name: 'Dmitry Volkov',
      messenger: 'telegram',
      externalChatId: 'tg-chat-001',
      chatType: 'direct',
      status: 'active',
      organizationId: org.id,
      importedById: admin.id,
      ownerId: admin.id,
      messageCount: 24,
      lastActivityAt: new Date(Date.now() - 5 * 60 * 1000),
    },
  });

  const chat2 = await prisma.chat.upsert({
    where: {
      externalChatId_messenger_organizationId: {
        externalChatId: 'sl-channel-001',
        messenger: 'slack',
        organizationId: org.id,
      },
    },
    update: {},
    create: {
      name: '#general',
      messenger: 'slack',
      externalChatId: 'sl-channel-001',
      chatType: 'channel',
      status: 'active',
      organizationId: org.id,
      importedById: admin.id,
      messageCount: 156,
      lastActivityAt: new Date(Date.now() - 30 * 60 * 1000),
    },
  });

  const chat3 = await prisma.chat.upsert({
    where: {
      externalChatId_messenger_organizationId: {
        externalChatId: 'wa-chat-001',
        messenger: 'whatsapp',
        organizationId: org.id,
      },
    },
    update: {},
    create: {
      name: 'Client Group',
      messenger: 'whatsapp',
      externalChatId: 'wa-chat-001',
      chatType: 'group',
      status: 'active',
      organizationId: org.id,
      importedById: user1.id,
      ownerId: user1.id,
      messageCount: 89,
      lastActivityAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    },
  });

  const chat4 = await prisma.chat.upsert({
    where: {
      externalChatId_messenger_organizationId: {
        externalChatId: 'gm-thread-001',
        messenger: 'gmail',
        organizationId: org.id,
      },
    },
    update: {},
    create: {
      name: 'Partnership Inquiry',
      messenger: 'gmail',
      externalChatId: 'gm-thread-001',
      chatType: 'direct',
      status: 'active',
      organizationId: org.id,
      importedById: admin.id,
      ownerId: admin.id,
      messageCount: 7,
      lastActivityAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    },
  });

  console.log(`Chats: ${[chat1, chat2, chat3, chat4].map((c) => c.name).join(', ')}`);

  // ─── Assign tags to chats ───
  await prisma.chatTag.createMany({
    data: [
      { chatId: chat1.id, tagId: tags[0]!.id }, // VIP
      { chatId: chat3.id, tagId: tags[1]!.id }, // Support
      { chatId: chat3.id, tagId: tags[3]!.id }, // Urgent
      { chatId: chat4.id, tagId: tags[2]!.id }, // Sales
    ],
    skipDuplicates: true,
  });

  // ─── Sample Messages ───
  const now = Date.now();
  await prisma.message.createMany({
    data: [
      {
        chatId: chat1.id,
        senderName: 'Dmitry Volkov',
        senderExternalId: 'tg-user-100',
        isSelf: false,
        text: 'Hi, can we discuss the new proposal?',
        createdAt: new Date(now - 60 * 60 * 1000),
      },
      {
        chatId: chat1.id,
        senderName: 'Anton Petrov',
        isSelf: true,
        text: 'Sure, I just sent you the updated document. Let me know what you think.',
        createdAt: new Date(now - 55 * 60 * 1000),
      },
      {
        chatId: chat1.id,
        senderName: 'Dmitry Volkov',
        senderExternalId: 'tg-user-100',
        isSelf: false,
        text: 'Looks great! A few minor corrections on page 3 though.',
        createdAt: new Date(now - 10 * 60 * 1000),
      },
      {
        chatId: chat1.id,
        senderName: 'Anton Petrov',
        isSelf: true,
        text: 'Got it, I\'ll fix those and resend. Thanks!',
        createdAt: new Date(now - 5 * 60 * 1000),
      },
      {
        chatId: chat2.id,
        senderName: 'Maria Ivanova',
        senderExternalId: 'sl-user-200',
        isSelf: false,
        text: 'Team standup at 2pm today. Don\'t forget!',
        createdAt: new Date(now - 30 * 60 * 1000),
      },
      {
        chatId: chat3.id,
        senderName: 'Client Support',
        senderExternalId: 'wa-user-300',
        isSelf: false,
        text: 'We need the invoice ASAP, the deadline is tomorrow.',
        createdAt: new Date(now - 3 * 60 * 60 * 1000),
      },
    ],
    skipDuplicates: true,
  });
  console.log('Messages: 6 sample messages created');

  // ─── Templates ───
  await prisma.template.createMany({
    data: [
      {
        name: 'Welcome Message',
        messageText: 'Hello! Welcome to our platform. We\'re glad to have you on board. How can we help you today?',
        usageCount: 12,
        organizationId: org.id,
        createdById: admin.id,
      },
      {
        name: 'Follow-Up',
        messageText: 'Hi! Just checking in. Have you had a chance to review the materials we sent? Let us know if you have any questions.',
        usageCount: 8,
        organizationId: org.id,
        createdById: admin.id,
      },
      {
        name: 'Meeting Reminder',
        messageText: 'Reminder: We have a meeting scheduled for tomorrow. Please confirm your availability.',
        usageCount: 5,
        organizationId: org.id,
        createdById: user1.id,
      },
    ],
    skipDuplicates: true,
  });
  console.log('Templates: 3 created');

  // ─── Activity Log ───
  await prisma.activityLog.createMany({
    data: [
      {
        category: 'users',
        action: 'user_invited',
        description: 'Invited Maria Ivanova as user',
        userId: admin.id,
        userName: 'Anton Petrov',
        organizationId: org.id,
        createdAt: new Date(now - 7 * 24 * 60 * 60 * 1000),
      },
      {
        category: 'chats',
        action: 'chat_imported',
        description: 'Imported 4 chats from messengers',
        userId: admin.id,
        userName: 'Anton Petrov',
        organizationId: org.id,
        createdAt: new Date(now - 5 * 24 * 60 * 60 * 1000),
      },
      {
        category: 'broadcast',
        action: 'broadcast_sent',
        description: 'Sent broadcast "Weekly Update" to 3 chats',
        userId: admin.id,
        userName: 'Anton Petrov',
        organizationId: org.id,
        createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
      },
      {
        category: 'templates',
        action: 'template_created',
        description: 'Created template "Welcome Message"',
        userId: admin.id,
        userName: 'Anton Petrov',
        organizationId: org.id,
        createdAt: new Date(now - 24 * 60 * 60 * 1000),
      },
      {
        category: 'integrations',
        action: 'integration_connected',
        description: 'Connected Telegram integration',
        userId: admin.id,
        userName: 'Anton Petrov',
        organizationId: org.id,
        createdAt: new Date(now - 6 * 60 * 60 * 1000),
      },
    ],
    skipDuplicates: true,
  });
  console.log('Activity: 5 log entries created');

  console.log('\n✅ Seed complete!\n');
  console.log('Login credentials:');
  console.log('─────────────────────────────────────');
  console.log('Super Admin:  superadmin@omnichannel.dev / admin123');
  console.log('Admin:        admin@omnichannel.dev / admin123');
  console.log('User:         maria@omnichannel.dev / user123');
  console.log('User:         alex@omnichannel.dev / user123');
  console.log('User (off):   elena@omnichannel.dev / user123');
  console.log('─────────────────────────────────────');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
