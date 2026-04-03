-- Enable pg_trgm extension for trigram-based text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add GIN index on Message.text for fast ILIKE/contains queries
CREATE INDEX IF NOT EXISTS "Message_text_gin_trgm_idx" ON "Message" USING gin ("text" gin_trgm_ops);
