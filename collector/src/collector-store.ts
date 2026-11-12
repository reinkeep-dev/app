// What the collector needs from storage, and the smallest slice of Cloudflare D1's API that implements it.
// D1 and node:sqlite are both SQLite, so one implementation (d1-store.ts) serves production and the tests.
import type { Launch } from "./chain-launches.ts";
import type { ContractFacts, Outcome, PoolRecord, TokenRecord } from "./types.ts";

export interface CollectorStore {
  getPool(pool: string): Promise<PoolRecord | null>;
  poolsOfToken(token: string): Promise<PoolRecord[]>;
  /** Writes the first sighting once. Returns true if the pool was new. Never overwrites. */
  addPool(rec: PoolRecord): Promise<boolean>;
  /** Pools created in [afterMs, beforeMs] that have no 24h outcome yet, oldest first. */
  unresolvedPools(beforeMs: number, afterMs: number, limit: number): Promise<PoolRecord[]>;
  /** Writes the outcome once; a second write for the same pool is ignored. */
  setOutcome(pool: string, outcome: Outcome): Promise<void>;

  /** Safe to call any number of times for the same token. */
  ensureToken(token: string, symbol: string, ticker: string | null): Promise<void>;
  getToken(token: string): Promise<TokenRecord | null>;
  tokensNeedingFacts(maxTries: number, limit: number): Promise<TokenRecord[]>;
  setFacts(token: string, facts: ContractFacts): Promise<void>;
  /** Sends facts read by a scanner older than `currentVersion` back to the queue. Returns how many. */
  requeueOutdated(currentVersion: number): Promise<number>;
  noteFactsFailure(token: string, error: string): Promise<void>;
  /** Every token that shares this normalised ticker, with the time its first pool appeared. */
  tokensWithTicker(ticker: string): Promise<TokenRecord[]>;

  /** Writes a launch found on the chain once; the token row must exist. Returns true if it was new. */
  addLaunch(launch: Launch, foundMs: number): Promise<boolean>;
  /** Launches created at or after `afterMs` whose pool has no row yet, newest first. */
  unresolvedLaunches(afterMs: number, limit: number): Promise<Launch[]>;
  /** The last block a chain reader fully processed, or null before its first run. */
  getCursor(name: string): Promise<number | null>;
  /** Moves the cursor forward only: a smaller block (a slower run finishing late) is ignored. */
  setCursor(name: string, block: number): Promise<void>;

  counts(): Promise<{ pools: number; tokens: number; tokensWithFacts: number; outcomes: number }>;
  /** 24h outcomes grouped by first-seen liquidity, bands [edges[i], edges[i+1]); the last band is open above. */
  outcomesByLiquidity(edges: number[]): Promise<LiquidityBand[]>;
  /** Same, for any first-sighting measure (liquidity in USD, or swaps = buys + sells). */
  outcomesByBand(measure: BandMeasure, edges: number[]): Promise<LiquidityBand[]>;
  /** Per UTC day since `sinceMs`, newest first: pools seen, re-checked after a day, alive, dead. */
  boardDays(sinceMs: number): Promise<BoardDay[]>;
  /** Tickers reused by at least `minTokens` tokens with pools since `sinceMs`, with the first and busiest token. */
  tickerWaves(sinceMs: number, minTokens: number, limit: number): Promise<TickerWave[]>;

  /**
   * Deletes pools created before `cutoffMs`, at most `maxPools` of them, but only whole UTC days whose totals are
   * already in daily_stats (written first, once). Then deletes tokens left with no pool. Safe to repeat or cut off.
   */
  prune(cutoffMs: number, maxPools: number): Promise<PruneResult>;
  /** Removes run notes started before `beforeMs`. Returns how many. */
  pruneRuns(beforeMs: number): Promise<number>;
  /** Notes that a run began; returns its id. A run with no finish was cut off. */
  startRun(atMs: number): Promise<number>;
  finishRun(id: number, atMs: number, stats: unknown): Promise<void>;
  /** Size of the database file in bytes, or null if the database does not say. */
  sizeBytes(): Promise<number | null>;
}

export type PruneResult = { daysRolledUp: number; poolsDeleted: number; tokensDeleted: number };
/** n: pools re-checked after 24h in this band. alive + dead can be below n (the source gave no numbers for some). */
export type LiquidityBand = { minUsd: number; maxUsd: number | null; n: number; alive: number; dead: number };
export type BandMeasure = "liquidity" | "swaps";
export type BoardDay = { day: string; pools: number; outcomes: number; alive: number; dead: number };
export type TickerWave = {
  ticker: string;
  recentTokens: number; // tokens with this ticker whose pools appeared in the window
  totalTokens: number; // every token with this ticker we know
  first: { token: string; createdMs: number } | null; // the earliest we saw
  busiest: { token: string; firstVolumeUsd: number } | null; // highest volume at our first sighting
};

// The part of Cloudflare D1's API we use. node:sqlite is adapted to it for local runs and tests.
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<{ meta: { changes: number; size_after?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface D1Like {
  prepare(sql: string): D1Statement;
}
