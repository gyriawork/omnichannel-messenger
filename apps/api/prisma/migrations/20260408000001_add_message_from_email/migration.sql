-- Add fromEmail column for Gmail chat grouping by sender domain.
-- Nullable and backfill-free: existing rows stay NULL and are simply
-- excluded from the grouping pass on the frontend (which skips chats
-- without a fromEmail).
ALTER TABLE "Message" ADD COLUMN "fromEmail" TEXT;
