-- Track initial chat-list sync progress per Integration
ALTER TABLE "Integration"
  ADD COLUMN "syncStatus" TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN "syncTotalChats" INTEGER,
  ADD COLUMN "syncCompletedChats" INTEGER,
  ADD COLUMN "syncStartedAt" TIMESTAMP(3),
  ADD COLUMN "syncError" TEXT;

-- Chats start without full history — only filled once the user explicitly
-- asks to "pull full history" or an integration finishes background sync.
ALTER TABLE "Chat"
  ADD COLUMN "hasFullHistory" BOOLEAN NOT NULL DEFAULT false;
