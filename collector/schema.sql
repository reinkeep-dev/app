-- Collector storage. Runs unchanged on Cloudflare D1 and on plain SQLite (local runner and tests).
-- Create on Cloudflare (run from reinkeep/collector, see DEPLOY.md):  npx wrangler d1 execute reinkeep-collector --remote --file=schema.sql
-- Model, integrity rules, concurrency and capacity are written up in collector/DATA-MODEL.md.
--
-- Standards: snake_case names. Times are epoch milliseconds in UTC, columns end in _ms. Addresses are lowercase
-- 0x + hex text. USD amounts are REAL (market data for display and statistics, not money to settle).
-- Booleans are INTEGER 1 / 0, and NULL means "could not tell", which is different from 0.

CREATE TABLE IF NOT EXISTS tokens (
  token       TEXT    PRIMARY KEY
              CHECK (length(token) = 42 AND substr(token, 1, 2) = '0x' AND substr(token, 3) NOT GLOB '*[^0-9a-f]*'),
  symbol      TEXT    NOT NULL CHECK (length(symbol) BETWEEN 1 AND 64),            -- as written in the first pool's name
  ticker      TEXT    CHECK (ticker IS NULL OR length(ticker) BETWEEN 1 AND 32),   -- derived from symbol, for spotting copies

  -- Reading the contract. Attempts and the last error are bookkeeping for the read, not facts about the token.
  facts_tries INTEGER NOT NULL DEFAULT 0 CHECK (facts_tries >= 0),
  last_error  TEXT,

  -- What the chain says about the contract. ALL of these are NULL until the contract has been read; after that
  -- read_at_ms and is_contract are always set, and each of the others is 1, 0 or NULL (could not tell).
  read_at_ms           INTEGER CHECK (read_at_ms IS NULL OR read_at_ms > 0),
  facts_version        INTEGER CHECK (facts_version IS NULL OR facts_version >= 1),      -- which scanner version read it
  is_contract          INTEGER CHECK (is_contract IS NULL OR is_contract IN (0, 1)),
  code_size            INTEGER CHECK (code_size IS NULL OR code_size >= 0),
  is_proxy             INTEGER CHECK (is_proxy IS NULL OR is_proxy IN (0, 1)),
  implementation       TEXT    CHECK (implementation IS NULL OR length(implementation) = 42),
  has_mint             INTEGER CHECK (has_mint            IS NULL OR has_mint            IN (0, 1)),
  has_pause            INTEGER CHECK (has_pause           IS NULL OR has_pause           IN (0, 1)),
  has_blacklist        INTEGER CHECK (has_blacklist       IS NULL OR has_blacklist       IN (0, 1)),
  has_upgrade          INTEGER CHECK (has_upgrade         IS NULL OR has_upgrade         IN (0, 1)),
  has_owner_function   INTEGER CHECK (has_owner_function  IS NULL OR has_owner_function  IN (0, 1)),
  owner                TEXT    CHECK (owner IS NULL OR length(owner) = 42),
  owner_renounced      INTEGER CHECK (owner_renounced     IS NULL OR owner_renounced     IN (0, 1)),
  mint_with_live_owner INTEGER CHECK (mint_with_live_owner IS NULL OR mint_with_live_owner IN (0, 1)),
  total_supply         TEXT    CHECK (total_supply IS NULL OR (length(total_supply) BETWEEN 1 AND 78 AND total_supply NOT GLOB '*[^0-9]*')),
  decimals             INTEGER CHECK (decimals IS NULL OR decimals BETWEEN 0 AND 255),
  chain_symbol         TEXT,                                                       -- symbol() as the contract answers it

  -- The facts exist as a whole or not at all.
  CHECK ((read_at_ms IS NULL) = (is_contract IS NULL)),
  CHECK ((read_at_ms IS NULL) = (facts_version IS NULL)),
  CHECK (read_at_ms IS NOT NULL OR (
    code_size IS NULL AND is_proxy IS NULL AND implementation IS NULL AND has_mint IS NULL AND has_pause IS NULL AND
    has_blacklist IS NULL AND has_upgrade IS NULL AND has_owner_function IS NULL AND owner IS NULL AND
    owner_renounced IS NULL AND mint_with_live_owner IS NULL AND total_supply IS NULL AND decimals IS NULL AND chain_symbol IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_tokens_ticker ON tokens (ticker);
-- Only tokens still waiting for a read are in this index, so finding work costs the size of the queue, not of the table.
CREATE INDEX IF NOT EXISTS idx_tokens_pending ON tokens (facts_tries) WHERE read_at_ms IS NULL;
-- Facts read by an older scanner. Finding them costs the number of outdated tokens, not the size of the table.
CREATE INDEX IF NOT EXISTS idx_tokens_outdated ON tokens (facts_version) WHERE read_at_ms IS NOT NULL;

CREATE TABLE IF NOT EXISTS pools (
  pool                 TEXT    PRIMARY KEY
                       CHECK (length(pool) IN (42, 66) AND substr(pool, 1, 2) = '0x' AND substr(pool, 3) NOT GLOB '*[^0-9a-f]*'),
  token                TEXT    NOT NULL REFERENCES tokens (token),
  quote                TEXT    NOT NULL CHECK (length(quote) = 42),
  name                 TEXT    NOT NULL,
  symbol               TEXT    NOT NULL CHECK (length(symbol) BETWEEN 1 AND 64),
  dex                  TEXT    NOT NULL,
  created_ms           INTEGER NOT NULL CHECK (created_ms > 0),
  -- our first sighting of the pool; written once, never changed
  first_at_ms          INTEGER NOT NULL CHECK (first_at_ms > 0),
  first_liquidity_usd  REAL    CHECK (first_liquidity_usd   IS NULL OR first_liquidity_usd   >= 0),
  first_volume_h24_usd REAL    CHECK (first_volume_h24_usd  IS NULL OR first_volume_h24_usd  >= 0),
  first_buys_h24       INTEGER CHECK (first_buys_h24        IS NULL OR first_buys_h24        >= 0),
  first_sells_h24      INTEGER CHECK (first_sells_h24       IS NULL OR first_sells_h24       >= 0),
  first_fdv_usd        REAL    CHECK (first_fdv_usd         IS NULL OR first_fdv_usd         >= 0)
);
CREATE INDEX IF NOT EXISTS idx_pools_token   ON pools (token);
CREATE INDEX IF NOT EXISTS idx_pools_created ON pools (created_ms);

-- The re-check 24 hours or more after creation. A row exists only once the pool has been re-checked; written once.
CREATE TABLE IF NOT EXISTS pool_outcomes (
  pool           TEXT    PRIMARY KEY REFERENCES pools (pool),
  at_ms          INTEGER NOT NULL CHECK (at_ms > 0),
  age_h          REAL    NOT NULL CHECK (age_h >= 0),
  liquidity_usd  REAL    CHECK (liquidity_usd  IS NULL OR liquidity_usd  >= 0),
  volume_h24_usd REAL    CHECK (volume_h24_usd IS NULL OR volume_h24_usd >= 0),
  buys_h24       INTEGER CHECK (buys_h24       IS NULL OR buys_h24       >= 0),
  sells_h24      INTEGER CHECK (sells_h24      IS NULL OR sells_h24      >= 0),
  fdv_usd        REAL    CHECK (fdv_usd        IS NULL OR fdv_usd        >= 0),
  alive          INTEGER CHECK (alive IS NULL OR alive IN (0, 1))  -- NULL: the source gave no numbers to judge by
);

-- A launch found on the chain (the launcher contract's event, see src/chain-launches.ts). Written once per token.
-- The pool it names is "resolved" when that pool has a row in `pools` (market numbers from GeckoTerminal); that is
-- computed with a join, not stored, so it cannot drift. created_ms is the block time, and stands in for the token's
-- first-created time until a pool row exists (see TOKEN_FIELDS in src/d1-store.ts).
CREATE TABLE IF NOT EXISTS launches (
  token      TEXT    PRIMARY KEY REFERENCES tokens (token),
  pool       TEXT    NOT NULL CHECK (length(pool) = 42 AND substr(pool, 1, 2) = '0x' AND substr(pool, 3) NOT GLOB '*[^0-9a-f]*'),
  block      INTEGER NOT NULL CHECK (block > 0),
  created_ms INTEGER NOT NULL CHECK (created_ms > 0),
  found_ms   INTEGER NOT NULL CHECK (found_ms > 0)
);
CREATE INDEX IF NOT EXISTS idx_launches_created ON launches (created_ms);
CREATE INDEX IF NOT EXISTS idx_launches_pool    ON launches (pool);

-- How far the chain has been read. One row per reader ("launches"). Only ever moves forward (see setCursor).
CREATE TABLE IF NOT EXISTS chain_cursor (
  name  TEXT    PRIMARY KEY CHECK (length(name) BETWEEN 1 AND 32),
  block INTEGER NOT NULL CHECK (block >= 0)
);

-- One row per UTC day, written when that day's pools are old enough to be deleted (see src/retention.ts). The raw
-- pools go, the day's totals stay, so the statistics (how many launched, how many were still alive after a day)
-- survive while the database stays small. Written once per day; the primary key makes a repeat harmless.
CREATE TABLE IF NOT EXISTS daily_stats (
  day            TEXT    PRIMARY KEY CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  pools          INTEGER NOT NULL CHECK (pools >= 0),
  outcomes       INTEGER NOT NULL CHECK (outcomes >= 0),   -- pools that got their 24h re-check
  alive          INTEGER NOT NULL CHECK (alive >= 0),      -- of those, judged still alive
  dead           INTEGER NOT NULL CHECK (dead >= 0),       -- of those, judged not alive (the rest: unknown)
  sum_first_liquidity_usd REAL NOT NULL CHECK (sum_first_liquidity_usd >= 0)
);

-- One row per scheduled run, written when the run starts and finished when it ends. A row with finished_ms still NULL
-- is a run that was cut off (for example by the CPU limit). Cleared after 14 days by the retention job.
CREATE TABLE IF NOT EXISTS collector_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_ms  INTEGER NOT NULL CHECK (started_ms > 0),
  finished_ms INTEGER CHECK (finished_ms IS NULL OR finished_ms >= started_ms),
  stats       TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_started ON collector_runs (started_ms);

-- Signed gate receipts (api/src/receipt-store.ts). Written by the gate API, not by the collector. Same statement as
-- api/migrations/0001_receipts.sql, which is what gets applied to the remote database.
CREATE TABLE IF NOT EXISTS receipts (
  id        TEXT    PRIMARY KEY,
  decision  TEXT    NOT NULL,
  json      TEXT    NOT NULL,   -- the whole signed receipt, as the gate returned it
  issued_at INTEGER             -- unix seconds
);
CREATE INDEX IF NOT EXISTS idx_receipts_issued ON receipts (issued_at);
