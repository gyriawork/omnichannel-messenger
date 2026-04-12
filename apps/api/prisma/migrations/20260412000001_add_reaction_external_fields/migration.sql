-- AlterTable
ALTER TABLE "Reaction" ADD COLUMN IF NOT EXISTS "externalSynced" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Reaction" ADD COLUMN IF NOT EXISTS "externalUserId" TEXT;

-- CreateIndex (ignore if exists)
CREATE UNIQUE INDEX IF NOT EXISTS "Reaction_messageId_externalUserId_emoji_key" ON "Reaction"("messageId", "externalUserId", "emoji");
