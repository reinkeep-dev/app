// CollectorStore on Cloudflare D1 (SQLite), against the schema in collector/schema.sql.
// Every value goes in through a bound parameter. The only SQL built from strings is the list of fact columns in
// setFacts, and that is derived from factRow() below (one mapping for names AND values), never from input.
import type { Launch } from "./chain-launches.ts";
import type { BandMeasure, BoardDay, CollectorStore, D1Like, LiquidityBand, PruneResult, TickerWave } from "./collector-store.ts";
import type { ContractFacts, Outcome, PoolRecord, TokenRecord } from "./types.ts";

const bool = (n: unknown): boolean | null => (n === 1 ? true : n === 0 ? false : null);
const DAY_MS = 86_400_000;
const MAX_BINDS = 90; // D1 allows 100 bound values per statement
const bit = (b: boolean | null): number | null => (b === null ? null : b ? 1 : 0);

// The one place that says how a ContractFacts maps onto the fact columns of `tokens`. Column names and values come
// from the same object, so they cannot drift apart. `token` is the key, not a column to set.
function factRow(f: ContractFacts): Record<string, unknown> {
  return {
    read_at_ms: f.readAtMs,
    facts_version: f.scannerVersion,
    is_contract: f.isContract ? 1 : 0,
    code_size: f.codeSize,
    is_proxy: bit(f.isProxy),
    implementation: f.implementation,
    has_mint: bit(f.hasMint),
    has_pause: bit(f.hasPause),
    has_blacklist: bit(f.hasBlacklist),
    has_upgrade: bit(f.hasUpgrade),
    has_owner_function: bit(f.hasOwnerFunction),
    owner: f.owner,
    owner_renounced: bit(f.ownerRenounced),
    mint_with_live_owner: bit(f.mintWithLiveOwner),
    total_supply: f.totalSupply,
    decimals: f.decimals,
    chain_symbol: f.symbol,
  };
}

// Only used for its keys: the names of the columns that hold facts, so "forget the facts" cannot miss one.
const NO_FACTS: ContractFacts = {
  token: "", readAtMs: 0, scannerVersion: 0, isContract: false, codeSize: null, isProxy: null, implementation: null, hasMint: null, hasPause: null,
  hasBlacklist: null, hasUpgrade: null, hasOwnerFunction: null, owner: null, ownerRenounced: null, mintWithLiveOwner: null, totalSupply: null,
  decimals: null, symbol: null,
};
const factColumns = Object.keys(factRow(NO_FACTS));

// The measures pools can be banded by. SQL comes only from here.
const BAND_SQL: Record<BandMeasure, string> = {
  liquidity: "p.first_liquidity_usd",
  // buys + sells at our first sighting; unknown when the source gave neither
  swaps: "CASE WHEN p.first_buys_h24 IS NULL AND p.first_sells_h24 IS NULL THEN NULL ELSE COALESCE(p.first_buys_h24, 0) + COALESCE(p.first_sells_h24, 0) END",
};

const POOL_SELECT = `
  SELECT p.*, o.at_ms AS o_at_ms, o.age_h AS o_age_h, o.liquidity_usd AS o_liquidity_usd, o.volume_h24_usd AS o_volume_h24_usd,
         o.buys_h24 AS o_buys_h24, o.sells_h24 AS o_sells_h24, o.fdv_usd AS o_fdv_usd, o.alive AS o_alive
  FROM pools p LEFT JOIN pool_outcomes o ON o.pool = p.pool`;

// Pool count and first-created time are worked out from the pools table, not stored. A token found on the chain
// before GeckoTerminal returned its pool has no pool row yet: its launch's block time stands in. Without that it
// would read as created at time 0, the "oldest" token, and every later token with its ticker would look like a copy.
const TOKEN_FIELDS = `t.*,
         COALESCE((SELECT MIN(created_ms) FROM pools WHERE token = t.token), (SELECT created_ms FROM launches WHERE token = t.token)) AS first_created_ms,
         (SELECT COUNT(*) FROM pools WHERE token = t.token) AS pool_count`;
const TOKEN_SELECT = `SELECT ${TOKEN_FIELDS} FROM tokens t`;

type Row = Record<string, any>;

function poolOf(r: Row): PoolRecord {
  const outcome: Outcome | null =
    r.o_at_ms === null
      ? null
      : { atMs: r.o_at_ms, ageH: r.o_age_h, liquidityUsd: r.o_liquidity_usd, volumeH24Usd: r.o_volume_h24_usd, buysH24: r.o_buys_h24, sellsH24: r.o_sells_h24, fdvUsd: r.o_fdv_usd, alive: bool(r.o_alive) };
  return {
    pool: r.pool, token: r.token, quote: r.quote, name: r.name, symbol: r.symbol, dex: r.dex, createdMs: r.created_ms,
    first: { atMs: r.first_at_ms, liquidityUsd: r.first_liquidity_usd, volumeH24Usd: r.first_volume_h24_usd, buysH24: r.first_buys_h24, sellsH24: r.first_sells_h24, fdvUsd: r.first_fdv_usd },
    outcome,
  };
}

function tokenOf(r: Row): TokenRecord {
  const facts: ContractFacts | null =
    r.read_at_ms === null
      ? null
      : {
          token: r.token, readAtMs: r.read_at_ms, scannerVersion: r.facts_version, isContract: r.is_contract === 1, codeSize: r.code_size, isProxy: bool(r.is_proxy),
          implementation: r.implementation, hasMint: bool(r.has_mint), hasPause: bool(r.has_pause), hasBlacklist: bool(r.has_blacklist),
          hasUpgrade: bool(r.has_upgrade), hasOwnerFunction: bool(r.has_owner_function), owner: r.owner, ownerRenounced: bool(r.owner_renounced),
          mintWithLiveOwner: bool(r.mint_with_live_owner), totalSupply: r.total_supply, decimals: r.decimals, symbol: r.chain_symbol,
        };
  return { token: r.token, symbol: r.symbol, ticker: r.ticker, firstCreatedMs: r.first_created_ms ?? 0, poolCount: r.pool_count, facts, factsTries: r.facts_tries, lastError: r.last_error };
}

export class D1CollectorStore implements CollectorStore {
  private db: D1Like;
  constructor(db: D1Like) {
    this.db = db;
  }

  async getPool(pool: string) {
    const r = await this.db.prepare(`${POOL_SELECT} WHERE p.pool = ?`).bind(pool).first<Row>();
    return r ? poolOf(r) : null;
  }

  async poolsOfToken(token: string) {
    const { results } = await this.db.prepare(`${POOL_SELECT} WHERE p.token = ? ORDER BY p.created_ms ASC`).bind(token).all<Row>();
    return results.map(poolOf);
  }

  // One statement, so it is atomic: the pool is written whole or not at all. The token must already exist (the
  // foreign key enforces it), which is why the collector calls ensureToken first.
  async addPool(rec: PoolRecord) {
    const f = rec.first;
    const res = await this.db
      .prepare(
        `INSERT OR IGNORE INTO pools (pool, token, quote, name, symbol, dex, created_ms, first_at_ms, first_liquidity_usd, first_volume_h24_usd, first_buys_h24, first_sells_h24, first_fdv_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(rec.pool, rec.token, rec.quote, rec.name, rec.symbol, rec.dex, rec.createdMs, f.atMs, f.liquidityUsd, f.volumeH24Usd, f.buysH24, f.sellsH24, f.fdvUsd)
      .run();
    return res.meta.changes === 1;
  }

  // Reads only the window's slice of the pools table (index on created_ms), not the whole table.
  async unresolvedPools(beforeMs: number, afterMs: number, limit: number) {
    const { results } = await this.db
      .prepare(`${POOL_SELECT} WHERE o.pool IS NULL AND p.created_ms <= ? AND p.created_ms >= ? ORDER BY p.created_ms ASC LIMIT ?`)
      .bind(beforeMs, afterMs, limit)
      .all<Row>();
    return results.map(poolOf);
  }

  // The primary key makes the first write win; a second one is ignored.
  async setOutcome(pool: string, o: Outcome) {
    await this.db
      .prepare("INSERT OR IGNORE INTO pool_outcomes (pool, at_ms, age_h, liquidity_usd, volume_h24_usd, buys_h24, sells_h24, fdv_usd, alive) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(pool, o.atMs, o.ageH, o.liquidityUsd, o.volumeH24Usd, o.buysH24, o.sellsH24, o.fdvUsd, bit(o.alive))
      .run();
  }

  async ensureToken(token: string, symbol: string, ticker: string | null) {
    await this.db.prepare("INSERT OR IGNORE INTO tokens (token, symbol, ticker) VALUES (?, ?, ?)").bind(token, symbol, ticker).run();
  }

  async getToken(token: string) {
    const r = await this.db.prepare(`${TOKEN_SELECT} WHERE t.token = ?`).bind(token).first<Row>();
    return r ? tokenOf(r) : null;
  }

  // The cost must be the number of tokens WAITING, not the size of the table. Left alone, SQLite prefers to walk the
  // whole table backwards (it avoids a sort for ORDER BY rowid DESC LIMIT), which in the normal case of "nothing
  // waiting" means reading every token ever seen, every run. INDEXED BY forces the small partial index
  // idx_tokens_pending, and fails loudly if that index ever goes missing instead of quietly getting slow.
  // Newest discovered first (highest rowid): a token that just appeared is the one an agent is most likely to meet.
  async tokensNeedingFacts(maxTries: number, limit: number) {
    const { results } = await this.db
      .prepare(`SELECT ${TOKEN_FIELDS} FROM tokens t INDEXED BY idx_tokens_pending WHERE t.read_at_ms IS NULL AND t.facts_tries < ? ORDER BY t.rowid DESC LIMIT ?`)
      .bind(maxTries, limit)
      .all<Row>();
    return results.map(tokenOf);
  }

  // One statement: the facts and the clearing of the old error note land together or not at all.
  async setFacts(token: string, facts: ContractFacts) {
    const row = factRow(facts);
    const columns = Object.keys(row);
    const res = await this.db
      .prepare(`UPDATE tokens SET ${columns.map((c) => `${c} = ?`).join(", ")}, last_error = NULL WHERE token = ?`)
      .bind(...Object.values(row), token)
      .run();
    if (res.meta.changes !== 1) throw new Error(`setFacts: no such token ${token.slice(0, 12)}...`);
  }

  // Facts from an older scanner go back to "unread", so the normal queue reads them again with the newer one.
  // INDEXED BY keeps this at the cost of the outdated tokens, not of every token.
  async requeueOutdated(currentVersion: number) {
    const res = await this.db
      .prepare(`UPDATE tokens INDEXED BY idx_tokens_outdated SET ${factColumns.map((c) => `${c} = NULL`).join(", ")}, facts_tries = 0, last_error = NULL WHERE read_at_ms IS NOT NULL AND facts_version < ?`)
      .bind(currentVersion)
      .run();
    return res.meta.changes;
  }

  async noteFactsFailure(token: string, error: string) {
    await this.db.prepare("UPDATE tokens SET facts_tries = facts_tries + 1, last_error = ? WHERE token = ?").bind(error.slice(0, 300), token).run();
  }

  async tokensWithTicker(ticker: string) {
    const { results } = await this.db.prepare(`${TOKEN_SELECT} WHERE t.ticker = ? ORDER BY first_created_ms ASC`).bind(ticker).all<Row>();
    return results.map(tokenOf);
  }

  async addLaunch(l: Launch, foundMs: number) {
    const res = await this.db
      .prepare("INSERT OR IGNORE INTO launches (token, pool, block, created_ms, found_ms) VALUES (?, ?, ?, ?, ?)")
      .bind(l.token, l.pool, l.block, l.createdMs, foundMs)
      .run();
    return res.meta.changes === 1;
  }

  async unresolvedLaunches(afterMs: number, limit: number) {
    const { results } = await this.db
      .prepare(
        `SELECT l.token, l.pool, l.block, l.created_ms, t.symbol FROM launches l JOIN tokens t ON t.token = l.token
         WHERE l.created_ms >= ? AND NOT EXISTS (SELECT 1 FROM pools p WHERE p.pool = l.pool)
         ORDER BY l.created_ms DESC LIMIT ?`,
      )
      .bind(afterMs, limit)
      .all<Row>();
    return results.map((r): Launch => ({ token: r.token, pool: r.pool, block: r.block, createdMs: r.created_ms, symbol: r.symbol }));
  }

  async getCursor(name: string) {
    const r = await this.db.prepare("SELECT block FROM chain_cursor WHERE name = ?").bind(name).first<{ block: number }>();
    return r ? Number(r.block) : null;
  }

  // One statement, and MAX() keeps it forward-only, so two runs finishing in either order leave the larger block.
  async setCursor(name: string, block: number) {
    await this.db
      .prepare("INSERT INTO chain_cursor (name, block) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET block = MAX(block, excluded.block)")
      .bind(name, block)
      .run();
  }

  // 24h outcomes grouped by a first-sighting measure, in bands [edges[i], edges[i+1]); the last band is open above.
  // Only pools that were re-checked count; `alive` null (the source gave no numbers) is neither alive nor dead.
  // Raw pools only: days already rolled into daily_stats by retention are not split by band.
  async outcomesByBand(measure: BandMeasure, edges: number[]): Promise<LiquidityBand[]> {
    if (edges.length < 1 || edges.some((e, i) => !Number.isFinite(e) || e < 0 || (i > 0 && e <= edges[i - 1]))) throw new RangeError("edges must be increasing, non-negative numbers");
    const expr = BAND_SQL[measure]; // from the fixed map below, never from input
    const cases = edges.map((_, i) => (i + 1 < edges.length ? `WHEN m >= ? AND m < ? THEN ${i}` : `WHEN m >= ? THEN ${i}`)).join(" ");
    const params = edges.flatMap((e, i) => (i + 1 < edges.length ? [e, edges[i + 1]] : [e]));
    const { results } = await this.db
      .prepare(
        `SELECT band, COUNT(*) AS n, COALESCE(SUM(alive = 1), 0) AS alive, COALESCE(SUM(alive = 0), 0) AS dead FROM (
           SELECT CASE ${cases} END AS band, alive FROM (
             SELECT ${expr} AS m, o.alive AS alive FROM pools p JOIN pool_outcomes o ON o.pool = p.pool
           ) WHERE m IS NOT NULL
         ) WHERE band IS NOT NULL GROUP BY band`,
      )
      .bind(...params)
      .all<{ band: number; n: number; alive: number; dead: number }>();
    const byBand = new Map(results.map((r) => [Number(r.band), r]));
    return edges.map((minUsd, i) => {
      const r = byBand.get(i);
      return { minUsd, maxUsd: i + 1 < edges.length ? edges[i + 1] : null, n: Number(r?.n ?? 0), alive: Number(r?.alive ?? 0), dead: Number(r?.dead ?? 0) };
    });
  }

  outcomesByLiquidity(edges: number[]): Promise<LiquidityBand[]> {
    return this.outcomesByBand("liquidity", edges);
  }

  // One row per UTC day (by pool creation time) since `sinceMs`: pools seen, re-checked, alive, dead. Raw pools for
  // recent days, daily_stats for days retention already rolled up (a day is in one or the other, never both).
  async boardDays(sinceMs: number): Promise<BoardDay[]> {
    const { results } = await this.db
      .prepare(
        `SELECT day, pools, outcomes, alive, dead FROM (
           SELECT strftime('%Y-%m-%d', p.created_ms / 1000, 'unixepoch') AS day, COUNT(*) AS pools, COUNT(o.pool) AS outcomes,
                  COALESCE(SUM(o.alive = 1), 0) AS alive, COALESCE(SUM(o.alive = 0), 0) AS dead
           FROM pools p LEFT JOIN pool_outcomes o ON o.pool = p.pool WHERE p.created_ms >= ? GROUP BY 1
           UNION ALL
           SELECT day, pools, outcomes, alive, dead FROM daily_stats
           WHERE day >= strftime('%Y-%m-%d', ? / 1000, 'unixepoch') AND day NOT IN (SELECT DISTINCT strftime('%Y-%m-%d', created_ms / 1000, 'unixepoch') FROM pools WHERE created_ms >= ?)
         ) ORDER BY day DESC`,
      )
      .bind(sinceMs, sinceMs, sinceMs)
      .all<BoardDay>();
    return results.map((r) => ({ day: String(r.day), pools: Number(r.pools), outcomes: Number(r.outcomes), alive: Number(r.alive), dead: Number(r.dead) }));
  }

  // Tickers used by at least `minTokens` different tokens whose pools appeared since `sinceMs`, most-used first.
  // For each, every token we know with that ticker (not only the recent ones), so "first" means first we saw.
  async tickerWaves(sinceMs: number, minTokens: number, limit: number): Promise<TickerWave[]> {
    const { results: waves } = await this.db
      .prepare(
        `SELECT t.ticker AS ticker, COUNT(DISTINCT p.token) AS recent FROM pools p JOIN tokens t ON t.token = p.token
         WHERE p.created_ms >= ? AND t.ticker IS NOT NULL GROUP BY t.ticker HAVING COUNT(DISTINCT p.token) >= ?
         ORDER BY recent DESC, t.ticker LIMIT ?`,
      )
      .bind(sinceMs, minTokens, Math.min(limit, MAX_BINDS))
      .all<{ ticker: string; recent: number }>();
    if (waves.length === 0) return [];
    const marks = waves.map(() => "?").join(", ");
    const { results: members } = await this.db
      .prepare(
        `SELECT t.ticker AS ticker, t.token AS token, MIN(p.created_ms) AS first_ms, MAX(COALESCE(p.first_volume_h24_usd, 0)) AS volume
         FROM tokens t JOIN pools p ON p.token = t.token WHERE t.ticker IN (${marks}) GROUP BY t.token`,
      )
      .bind(...waves.map((w) => w.ticker))
      .all<{ ticker: string; token: string; first_ms: number; volume: number }>();
    const out = waves.map((w) => {
      const mine = members.filter((m) => m.ticker === w.ticker).sort((a, b) => a.first_ms - b.first_ms);
      const busiest = [...mine].sort((a, b) => b.volume - a.volume)[0];
      return {
        ticker: w.ticker,
        recentTokens: Number(w.recent),
        totalTokens: mine.length,
        first: mine[0] ? { token: mine[0].token, createdMs: Number(mine[0].first_ms) } : null,
        busiest: busiest ? { token: busiest.token, firstVolumeUsd: Number(busiest.volume) } : null,
      };
    });
    // Most recent copies first; on a tie, the ticker reused by more tokens overall, then by name for a stable order.
    return out.sort((a, b) => b.recentTokens - a.recentTokens || b.totalTokens - a.totalTokens || a.ticker.localeCompare(b.ticker));
  }

  async counts() {
    const one = async (sql: string) => Number((await this.db.prepare(sql).first<{ n: number }>())?.n ?? 0);
    return {
      pools: await one("SELECT COUNT(*) AS n FROM pools"),
      tokens: await one("SELECT COUNT(*) AS n FROM tokens"),
      tokensWithFacts: await one("SELECT COUNT(*) AS n FROM tokens WHERE read_at_ms IS NOT NULL"),
      outcomes: await one("SELECT COUNT(*) AS n FROM pool_outcomes"),
    };
  }

  // Retention. Only whole UTC days that end before the cutoff go, and a day is deleted only after its totals are in
  // daily_stats (INSERT OR IGNORE: written once, from the complete day). Order: totals, outcomes, pools, tokens, so a
  // cut-off run leaves nothing half-counted and the foreign keys hold at every step.
  async prune(cutoffMs: number, maxPools: number): Promise<PruneResult> {
    const dayStart = Math.floor(cutoffMs / DAY_MS) * DAY_MS;
    const rolled = await this.db
      .prepare(
        `INSERT OR IGNORE INTO daily_stats (day, pools, outcomes, alive, dead, sum_first_liquidity_usd)
         SELECT strftime('%Y-%m-%d', p.created_ms / 1000, 'unixepoch'), COUNT(*), COUNT(o.pool),
                COALESCE(SUM(o.alive = 1), 0), COALESCE(SUM(o.alive = 0), 0), COALESCE(SUM(p.first_liquidity_usd), 0)
         FROM pools p LEFT JOIN pool_outcomes o ON o.pool = p.pool
         WHERE p.created_ms < ? GROUP BY 1`,
      )
      .bind(dayStart)
      .run();

    // The pools to delete this run: rolled-up days only, oldest first, with a fixed tie-break so every statement below
    // sees the same set.
    const batch = `SELECT p.pool FROM pools p WHERE p.created_ms < ? AND strftime('%Y-%m-%d', p.created_ms / 1000, 'unixepoch') IN (SELECT day FROM daily_stats) ORDER BY p.created_ms, p.pool LIMIT ?`;
    const { results } = await this.db.prepare(`SELECT DISTINCT token FROM pools WHERE pool IN (${batch})`).bind(dayStart, maxPools).all<{ token: string }>();
    await this.db.prepare(`DELETE FROM pool_outcomes WHERE pool IN (${batch})`).bind(dayStart, maxPools).run();
    const gone = await this.db.prepare(`DELETE FROM pools WHERE pool IN (${batch})`).bind(dayStart, maxPools).run();

    // Tokens that may now be left with nothing: those whose pools just went, plus old chain launches whose pool
    // never got a row (GeckoTerminal never returned it). Their launch row goes first, so the foreign key holds.
    const { results: stale } = await this.db
      .prepare("SELECT l.token FROM launches l WHERE l.created_ms < ? AND NOT EXISTS (SELECT 1 FROM pools p WHERE p.token = l.token) LIMIT ?")
      .bind(dayStart, maxPools)
      .all<{ token: string }>();
    let tokensDeleted = 0;
    const candidates = [...new Set([...results.map((r) => r.token), ...stale.map((r) => r.token)])];
    for (let i = 0; i < candidates.length; i += MAX_BINDS) {
      const chunk = candidates.slice(i, i + MAX_BINDS);
      const marks = chunk.map(() => "?").join(",");
      await this.db
        .prepare(`DELETE FROM launches WHERE token IN (${marks}) AND NOT EXISTS (SELECT 1 FROM pools WHERE pools.token = launches.token)`)
        .bind(...chunk)
        .run();
      const r = await this.db
        .prepare(`DELETE FROM tokens WHERE token IN (${marks}) AND NOT EXISTS (SELECT 1 FROM pools WHERE pools.token = tokens.token)`)
        .bind(...chunk)
        .run();
      tokensDeleted += r.meta.changes;
    }
    return { daysRolledUp: rolled.meta.changes, poolsDeleted: gone.meta.changes, tokensDeleted };
  }

  async pruneRuns(beforeMs: number) {
    const r = await this.db.prepare("DELETE FROM collector_runs WHERE started_ms < ?").bind(beforeMs).run();
    return r.meta.changes;
  }

  async startRun(atMs: number) {
    const r = await this.db.prepare("INSERT INTO collector_runs (started_ms) VALUES (?) RETURNING id").bind(atMs).first<{ id: number }>();
    return Number(r?.id);
  }

  async finishRun(id: number, atMs: number, stats: unknown) {
    await this.db.prepare("UPDATE collector_runs SET finished_ms = ?, stats = ? WHERE id = ?").bind(atMs, JSON.stringify(stats), id).run();
  }

  // D1 reports the file size after every write; this is a write that changes nothing, used only to read that number.
  async sizeBytes() {
    const r = await this.db.prepare("DELETE FROM daily_stats WHERE day = ''").run();
    return typeof r.meta.size_after === "number" ? r.meta.size_after : null;
  }
}
