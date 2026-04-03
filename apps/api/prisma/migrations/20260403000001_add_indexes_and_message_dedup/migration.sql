-- AlterTable
ALTER TABLE "BroadcastChat" DROP COLUMN IF EXISTS "deletedAt";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BroadcastChat_broadcastId_status_idx" ON "BroadcastChat"("broadcastId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Integration_organizationId_idx" ON "Integration"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_chatId_externalMessageId_key" ON "Message"("chatId", "externalMessageId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Template_organizationId_idx" ON "Template"("organizationId");
