-- Free-text owner label on chats (replaces user-based owner)
ALTER TABLE "Chat" ADD COLUMN "ownerName" TEXT;

-- Optional attachments attached to a template (carried into broadcasts)
ALTER TABLE "Template" ADD COLUMN "attachments" JSONB;
