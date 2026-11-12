# Collector data model

Living document: update it in the same change that touches `schema.sql`. Last reviewed 2026-11-11 (chain launches).

The collector watches new pools on Robinhood Chain, reads each new token's contract, and re-checks each pool a day
later. The gate (next step) reads a token's **fact sheet** from this data before an agent buys.

## 1. Workload and engine choice

| Flow | How often | Touches |
|---|---|---|
| Launches from the chain | every run | read 1 cursor, insert up to 30 launches and tokens, move the cursor |
| Market numbers for launches | every run | read up to 30 queued launches, insert the pools GeckoTerminal returns |
| Intake of new pools | every run (every 5 min) | insert up to ~60 pools and tokens |
| Read contracts | every run | update up to 20 tokens |
| Day-later re-check | every run | insert up to 60 outcomes |
| Fact sheet for one token (gate, later) | per agent request | read one token, its pools, its ticker twins |

Relational, single writer, small data, strong consistency wanted (a fact sheet must not show half a write).
Engine: **Cloudflare D1** (SQLite): the Worker binds to it directly, there is a free tier, and SQLite gives
serialisable transactions. Not distributed, so no BASE trade-offs are accepted (see 5).

## 2. The three schema layers

**External schema** (what other code sees): `TokenFacts` in `src/token-facts.ts`, plain JSON, snake_case. Every
fact is `true`, `false` or `null`; `null` means "could not tell" and the gate must treat it as REVIEW, never ALLOW.
Also `RunStats`, the log line of each run.

**Conceptual schema**:
- **Token** has many **Pools** (a token can sit in several pools; WETH, USDG and native pairs all exist).
- A **Pool** has at most one **PoolOutcome** (its day-later re-check).
- A Token has at most one set of **contract facts** (read from the chain, refreshable).
- A Token has at most one **Launch** (found on the chain from the launcher's event). A launch names one pool; it is
  *resolved* once that pool has a Pool row. Resolution is computed by a join, never stored.
- The **chain cursor** records the last block a chain reader fully processed.
- Invariants: a pool never exists without its token; a launch never exists without its token; first sighting, outcome
  and launch are written once; the cursor only moves forward; unknown is not no.

**Internal schema** (`schema.sql`):

| Table | Key | Why it is shaped this way |
|---|---|---|
| `tokens` | `token` | One row per token. Fact columns live here (1:1 with the token) so a **partial index** can hold only tokens still waiting to be read. |
| `pools` | `pool` (20 or 64 hex bytes: v4 pools have a 32-byte id) | Our first sighting is columns on the pool: it is 1:1 and mandatory. Index on `token`, index on `created_ms`. |
| `pool_outcomes` | `pool` | A row exists only once the pool was re-checked, so its columns can be `NOT NULL` where they should be. |
| `idx_tokens_pending` | partial, `WHERE read_at_ms IS NULL` | The work queue. Cost = tokens waiting, not tokens ever seen. |
| `idx_tokens_outdated` | partial, `WHERE read_at_ms IS NOT NULL` | Finds facts read by an older scanner. Cost = outdated tokens, not all tokens. |
| `launches` | `token` | 1:1 with a launched token. `pool` (42 chars, pons-v2), `block`, `created_ms` (block time), `found_ms`. Index on `created_ms` (the queue, newest first) and on `pool`. |
| `chain_cursor` | `name` | One row per chain reader ("launches"): the last fully processed block. |

## 3. Normal form

3NF by default. Where it is deliberately broken, with the reason and the price:

| Deviation | Why | Price |
|---|---|---|
| `tokens.ticker` is derived from `tokens.symbol` | Needed as an indexed column to find copies. | If the normalising rule changes, run a one-off recompute (the function is `normalizeTicker`). |
| `pools.symbol` is derived from `pools.name` | Parsed once at intake from a name like `HYVO / WETH 0.01%`, then indexed and used for display. | Same: re-derive if the parser changes. |
| Fact columns merged into `tokens` (1:1) | Allows the partial index above. A separate table forced a scan of every token each run. | About 16 nullable columns, held honest by two `CHECK`s (all-or-nothing, see 4). |

Not stored on purpose: a token's pool count and its first-created time. They are computed from `pools` on read, so
a half-finished run cannot leave them wrong. The first-created time falls back to the launch's block time when the
token has no pool row yet (a chain-found launch GeckoTerminal has not returned): without that it would read as 0, the
oldest token of all, and every later token with the same ticker would wrongly look like its copy (tested).

## 4. Integrity

| Kind | Rule | Enforced by |
|---|---|---|
| Entity | every table has a primary key | `PRIMARY KEY` |
| Domain | addresses are lowercase `0x` + exactly 40 (or 64) hex; amounts and counts are not negative; booleans are 0, 1 or NULL; decimals 0 to 255; supply is digits only | `CHECK` on every column |
| Referential | `pools.token` exists; `pool_outcomes.pool` exists; `launches.token` exists | `FOREIGN KEY` (on in D1, and switched on in the local adapter) |
| Business | a launch is written once; the cursor never moves backwards | `INSERT OR IGNORE`; `ON CONFLICT ... SET block = MAX(block, excluded.block)`; tested |
| Business | facts exist as a whole or not at all; an unread token has no fact set; every fact set names the scanner version that read it | three table-level `CHECK`s |
| Business | first sighting and outcome are written once | `INSERT OR IGNORE`, tested |
| Business | unknown is never stored as false | code in `contract-facts.ts`, tested |

## 5. Transactions, concurrency, isolation

SQLite and D1 run one writer at a time, serialisably. Nothing here needs an explicit lock or a multi-statement
transaction, because **every write is a single statement or idempotent**:

| Flow | Boundary | What if it is cut off or runs twice |
|---|---|---|
| Intake | `ensureToken` (insert-or-ignore), then `addPool` (one insert-or-ignore; the foreign key forces the token first) | A token with no pool yet is harmless, and the next run adds the pool. |
| Read contract | one `UPDATE` sets all facts and clears the old error note | All or nothing. |
| Outcome | one `INSERT OR IGNORE` | The first write wins; a second run changes nothing. |
| Scanner upgrade | one `UPDATE` (via `idx_tokens_outdated`) sets the old facts back to unread, and resets their tries | Idempotent: running it again changes nothing. The normal queue then reads them again. |
| Launches | token (insert-or-ignore), launch (insert-or-ignore), THEN the cursor | Cut off before the cursor moves: the next run reads the same blocks again and the inserts change nothing. The cursor is never written ahead of stored launches (a deliberate-break test checks this). Two runs at once: both insert the same rows once; the cursor keeps the larger block. |
| Two runs at once | all of the above | No duplicates, no lost rows. Tested with two parallel runs. |

Isolation level: serialisable (SQLite). Read replicas of D1 are **not** used; with them a read could lag a write,
which would be a BASE trade-off. Failure of the source (rate limit, bot check, budget) ends only that stage and is
recorded in `RunStats`; stored data is never rolled back because nothing is half-written.

## 6. Data standards

| Thing | Standard |
|---|---|
| Names | `snake_case`; tables plural; columns that hold times end in `_ms` |
| Time | integer epoch **milliseconds, UTC** |
| Addresses | lowercase text `0x` + hex; token 42 chars; pool id 42 or 66 chars |
| USD | `REAL`, market data for display and statistics, **not** money to settle |
| Big numbers | token supply is a decimal string (it does not fit a 64-bit integer) |
| Booleans | `INTEGER` 1 / 0; **NULL = could not tell** |
| Text | symbol 1 to 64 chars; ticker 1 to 32; error note cut to 300 |
| Allowed values | `alive` is 1, 0 or NULL (NULL: the source gave no numbers) |

## 7. Glossary

- **Pool**: a trading pair on a DEX (decentralised exchange), for example HYVO against WETH.
- **Token**: the thing being judged; the other side of a pool (ETH, WETH, USDG) is the *base asset*, never the token.
- **First sighting**: the numbers when we first saw the pool, not when it was created (a few minutes to an hour later).
- **Outcome**: the numbers at least 24 hours after creation. `alive` = at least $50 of volume or 3 swaps in that day.
- **Contract facts**: what the chain says about the contract: mint, pause, blacklist, upgrade, owner, supply.
- **Proxy**: a contract that forwards to another one; its powers live in the *implementation*.
- **Ticker**: the symbol normalised (case, spaces, punctuation, width removed) to spot copies.
- **Clone**: a token whose ticker an *older* token already used. Same token in two pools is not a clone.
- **Fact sheet**: the `TokenFacts` object the gate reads.
- **Scanner version**: the version of the code that reads contracts. Raised whenever the scanner learns something, so older answers are read again.
- **Unknown (NULL)**: we could not tell. Different from false.
- **Launcher**: the contract `0xe33e…2948` that creates most new tokens on Robinhood Chain; it emits one event per launch.
- **Launch**: one such event: token, pool, block. *Resolved* when its pool has a row with market numbers.
- **Cursor**: the last block whose launches are all stored.

## 8. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-11-10 | D1 (SQLite) over KV or Durable Objects | Relational, queried several ways, Worker-native, free tier. |
| 2026-11-10 | Contract data from the chain's RPC, not Blockscout | Blockscout's API sits behind a bot check; we do not work around it. One batched request per token. |
| 2026-11-10 | First draft stored snapshots and facts as JSON text. **Rejected** | Cannot query or constrain inside the blob (for example "all tokens that can mint"); fails the database rules. Normalised before any data existed. |
| 2026-11-10 | Counts and first-created time computed, not stored | Nothing to drift out of step. |
| 2026-11-10 | Facts merged into `tokens` with a partial index | A tested scan: the separate-table design read every token each run and would have used the daily read allowance in about 8 days. |
| 2026-11-10 | `INDEXED BY idx_tokens_pending` | Without it SQLite walks the whole table for `ORDER BY rowid DESC LIMIT`. A test reads the query plan and fails if it ever scans. |
| 2026-11-10 | NULL means unknown, and the gate must treat it as REVIEW | Same promise the website makes. |
| 2026-11-10 | Clones recognised by **shape** (short code that pushes an address, then GAS, DELEGATECALL), not by one byte string | **Found live:** two real tokens used a third clone layout, and the first scanner called them "not a proxy, no powers". Fixing one more string would repeat the mistake. |
| 2026-11-10 | Code with no `transfer()` or `balanceOf()` has unknown powers, not none | "Nothing found" in code we do not understand must never read as safe. |
| 2026-11-10 | Every fact set stores `scanner_version`; a scanner upgrade re-queues older facts | The live bug above left wrong answers in the data with no way to correct them. Now a fix reaches old data by itself. |
| 2026-11-10 | Outcomes and first sightings are write-once | Statistics must not change after the fact. |
| 2026-11-11 | The gate reads fact sheets through `api/src/token-facts-source.ts`, which calls `buildTokenFacts` | One definition of each fact for the collector and the gate. A read error is treated as "never seen" (REVIEW). |
| 2026-11-11 | **New tokens found on the chain** (launcher event, `src/chain-launches.ts`), GeckoTerminal kept only for market numbers | **Measured live:** GeckoTerminal answered new_pools in 44 of 210 runs (20%) from Cloudflare, the longest gap was 65 min, and only 198 of 642 launcher launches (30%) reached the database. The RPC node had read 775 of 775 contracts. Chosen over a CoinGecko API key (user's choice): no third party between us and the launches. Limit: only this launcher's tokens; other DEXes still come through GeckoTerminal. |
| 2026-11-11 | Launch pool stored as a queue row; the pool row is written only when GeckoTerminal returns its numbers | The first sighting stays write-once and honest: a pool row with empty numbers could never be filled. Until then the token's sheet has unknown liquidity, so the gate answers REVIEW. |
| 2026-11-11 | First run starts ~5 min back (3,000 blocks), not 24 h; an "archive" refusal skips to recent blocks and is logged as MISSED | **Found live:** from Cloudflare the public node (Chainstack plan) refused a 24-hour-old getLogs range as archive data; the same range worked from a home connection. Retrying a range the node will never serve would stop discovery for good, so the gap is skipped and named instead. |
| 2026-11-11 | Launches read through a second node (`LOGS_RPC_URL`); contract reads stay on `RPC_URL` | **Tested:** the free Chainstack plan (our `RPC_URL`) answers getLogs only ~10 blocks back and refuses 128+ as "archive"; the public node refuses getLogs from Cloudflare addresses (HTTP 429, 18 of 18). Neither can serve a 5-minute window from Cloudflare. |
| 2026-11-11 | Pool id = topic2 of the launch event | Checked on 200 of 200 launcher tokens already stored (pons-v2): GeckoTerminal's pool id equals topic2. |

## 8b. What the scanner cannot see (read before trusting a fact sheet)

A fact sheet says what the contract's code **exposes under the common names**. It is not a safety verdict.
Checked on the 11 distinct token templates in the first live data (2026-11-10):

- Every template was plain: no `mint`, `pause`, `blacklist`, `upgradeTo`. For those, "no" is right.
- Several templates still carry **owner-style setters and trading limits that the scanner does not look at**:
  `setInitialBuyRecipient(address)`, `setDistributor(address)`, `maxTxAmount()`, `maxWalletLimit()`,
  `restrictionEndBlock()`, `restrictionBlocks()`. A launch restriction can stop selling for a while, and a setter can
  change who receives something. These are real powers under names outside the list.
- Control by roles (AccessControl) is not read; only `owner()` is.
- USDG, a known contract with an issuer, reads `has_pause: false` and `has_blacklist: false` because it very likely
  uses other names. The scanner did find its `mint`, `upgradeTo` and live owner.

So the honest wording on the site is "common powers not found", never "safe". Widening the list (and the scanner
version with it) is a normal change; the re-queue means it reaches existing data.

## 9. Capacity estimate

**Input** (one sample, not a trend): 20 new pools between 05:21:04Z and 05:42:11Z on 2026-11-10, which is about 57
an hour or **~1,400 a day**; 19 distinct tokens among them. Real activity could differ by 10 times either way, so
check again after a week of data.

| Item | Estimate |
|---|---|
| Rows per day | pools ~1,400, tokens ~1,300, outcomes ~1,400 |
| Size per day | about 1.6 MB including indexes (rough row sizes 300, 350 and 100 bytes) |
| Size per year | about 590 MB |
| Rows written per day | about 11 per pool counting index entries, so ~15,000 |
| Rows read per day | a few thousand per run (the re-check window), so under 0.5 million at 288 runs a day (every 5 minutes) |

**Cloudflare limits** (checked in the docs on 2026-11-10; they change, so recheck before deploying):

| Limit (free plan) | Value | Us |
|---|---|---|
| Rows written per day | 100,000 | ~15,000 |
| Rows read per day | 5,000,000 | under 0.5 million |
| Size of one database | 500 MB | **reached in roughly 10 months at this rate** |
| Requests out per run | 50 | budget 45; a first run on the recorded data uses 21; a live run with 30 launches used 33 (2026-11-11) |
| CPU per cron run | **10 ms** | warm 1 to 2 ms; **cold about 32 ms measured in Node (an estimate, not measured on Cloudflare)** |

So two things need a plan, not a surprise:
1. **CPU.** A cold start probably exceeds 10 ms. If the Cloudflare dashboard shows CPU-limit errors, the Workers Paid
   plan (30 s CPU, 10,000 requests out) removes it. Verify on the real deployment.
2. **Size.** Retention is built (`src/retention.ts`, `prune()` in `d1-store.ts`). Raw pools older than 60 days are
   rolled into one `daily_stats` row per UTC day (pools, re-checked, alive, dead, summed liquidity), then deleted
   with their outcomes and any token left without a pool. At about 1.6 MB a day that holds the database near
   100 MB. The size comes from D1 itself after each run; at 300 MB the window drops to 14 days, at 420 MB to 3
   days, which stays far under the 500 MB cap even at 100 times the measured activity. D1 may not shrink the file
   after deletes (freed pages are reused), so a tightened window stays tight on purpose. Pruning runs once an hour
   (300 pools per pass, about 2,000 row writes), or every run when the size is past 300 MB (100 pools per pass).
   Limit of the roll-up: a pool we first see after its day was already rolled up is deleted uncounted; new pools
   are always recent, so this should not happen.

**Cost.** The free plan cannot bill. Past a daily limit Cloudflare refuses the call (an error in the log), it does
not charge. Money is only spent if someone clicks upgrade to Workers Paid in the dashboard.

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

## 10. What is not covered by this model yet

- No periodic refresh of contract facts: they are re-read only when the scanner version rises. A token can change (an owner can renounce or mint later); `read_at_ms` records when we looked.
- The "odds" table (share of tokens still alive after a day, by first-hour shape) needs about a week of data first.
- Schema changes after first deploy need `wrangler d1 migrations`; `CREATE IF NOT EXISTS` only creates, it does not migrate.
