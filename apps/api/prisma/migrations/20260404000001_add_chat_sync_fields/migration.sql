-- AlterTable
ALTER TABLE "Chat" ADD COLUMN "syncStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "Chat" ADD COLUMN "syncCursor" TEXT;
