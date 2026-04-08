-- Add remaining Gmail-specific fields to Message for rich email rendering.
-- fromEmail is already live (applied in 20260408000001_add_message_from_email).
-- All new columns are nullable / array-with-default, so existing rows stay
-- valid with NULL htmlBody / plainBody / subject and empty to/cc/bcc lists.
ALTER TABLE "Message" ADD COLUMN "subject" TEXT;
ALTER TABLE "Message" ADD COLUMN "htmlBody" TEXT;
ALTER TABLE "Message" ADD COLUMN "plainBody" TEXT;
ALTER TABLE "Message" ADD COLUMN "toEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Message" ADD COLUMN "ccEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Message" ADD COLUMN "bccEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Message" ADD COLUMN "inReplyTo" TEXT;
