import prisma from './lib/prisma.js';

/**
 * Ensures critical database columns exist, bypassing Prisma migration history.
 * This handles the case where migrations were recorded as "applied" in
 * _prisma_migrations but the SQL was never actually executed on the database.
 * All statements use IF NOT EXISTS — safe to run on every startup.
 */
export async function repairDatabase(): Promise<void> {
  const statements = [
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3)`,
    `ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3)`,
    `ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3)`,
    `ALTER TABLE "Broadcast" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3)`,
    `ALTER TABLE "BroadcastChat" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3)`,
    `CREATE TABLE IF NOT EXISTS "Attachment" (
      "id" TEXT NOT NULL,
      "messageId" TEXT NOT NULL,
      "url" TEXT NOT NULL,
      "filename" TEXT NOT NULL,
      "mimeType" TEXT NOT NULL,
      "size" INTEGER NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "Attachment_messageId_idx" ON "Attachment"("messageId")`,
    `CREATE TABLE IF NOT EXISTS "Reaction" (
      "id" TEXT NOT NULL,
      "messageId" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "emoji" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Reaction_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "Reaction_messageId_idx" ON "Reaction"("messageId")`,
    `CREATE INDEX IF NOT EXISTS "Reaction_userId_idx" ON "Reaction"("userId")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Reaction_messageId_userId_emoji_key" ON "Reaction"("messageId", "userId", "emoji")`,
  ];

  for (const sql of statements) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (err) {
      console.error(`[db-repair] Failed: ${sql.slice(0, 80)}...`, err);
    }
  }

  // Add FK separately — may already exist
  try {
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'Attachment_messageId_fkey'
        ) THEN
          ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_messageId_fkey"
            FOREIGN KEY ("messageId") REFERENCES "Message"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$;
    `);
  } catch (err) {
    console.error('[db-repair] Failed to add Attachment FK:', err);
  }

  // Add Reaction FK
  try {
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'Reaction_messageId_fkey'
        ) THEN
          ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_messageId_fkey"
            FOREIGN KEY ("messageId") REFERENCES "Message"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$;
    `);
  } catch (err) {
    console.error('[db-repair] Failed to add Reaction FK:', err);
  }

  console.log('[db-repair] Database schema check complete');
}
