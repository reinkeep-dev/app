-- Signed gate receipts, one row per receipt id, kept so a receipt can be shown at /r/{id} and fetched at
-- /api/v1/receipts/{id}. Same statement as the end of collector/schema.sql. Safe to run twice.
-- Apply (owner only):  npx wrangler d1 execute reinkeep-collector --remote --file api/migrations/0001_receipts.sql
CREATE TABLE IF NOT EXISTS receipts (
  id        TEXT    PRIMARY KEY,
  decision  TEXT    NOT NULL,
  json      TEXT    NOT NULL,   -- the whole signed receipt, as the gate returned it
  issued_at INTEGER             -- unix seconds
);
CREATE INDEX IF NOT EXISTS idx_receipts_issued ON receipts (issued_at);
