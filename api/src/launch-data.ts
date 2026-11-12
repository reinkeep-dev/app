// What the collector's data says about launches, as four read-only tools:
//   odds     out of the tokens that started like this (liquidity, or swaps at first sighting), how many still traded a day later
//   board    per UTC day: pools seen, re-checked after a day, still trading
//   autopsy  one token: what happened to it in its first day, and which pattern that fits
//   radar    tickers reused by several tokens lately: which came first, which was busiest
// "Alive" is the collector's own isAlive() (collect-run.ts), so there is one definition. Every answer carries
// `coverage`: the collector sees only some launches, and a share is shown only from MIN_SAMPLE judged pools.
import type { BoardDay, CollectorStore, LiquidityBand, TickerWave } from "../../collector/src/collector-store.ts";
import { isAlive, isPulled } from "../../collector/src/collect-run.ts";
import type { PoolRecord, Snapshot } from "../../collector/src/types.ts";
import { ApiError } from "./api-error.ts";
import { LIQUIDITY_BANDS, MIN_SAMPLE } from "./premortem.ts";

export type LaunchStore = Pick<CollectorStore, "outcomesByBand" | "boardDays" | "tickerWaves" | "poolsOfToken" | "getToken" | "counts">;

export const SWAP_BANDS = [0, 3, 20, 100, 500];
export const BOARD_MAX_DAYS = 30;
export const RADAR_MAX_HOURS = 168;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export type Coverage = { pools: number; outcomes: number; note: string };
const COVERAGE_NOTE = "Covers only the pools our collector saw. It does not see every launch, so treat shares as a sample.";

async function coverage(store: LaunchStore): Promise<Coverage> {
  const c = await store.counts();
  return { pools: c.pools, outcomes: c.outcomes, note: COVERAGE_NOTE };
}

const shareOf = (alive: number, dead: number): number | null => (alive + dead >= MIN_SAMPLE ? Math.round((alive / (alive + dead)) * 100) : null);
const withShare = (b: LiquidityBand) => ({ ...b, stillTradingPct: shareOf(b.alive, b.dead) });

// --- odds ----------------------------------------------------------------------------------------------------------

export async function odds(store: LaunchStore) {
  const [liquidity, swaps, cov] = await Promise.all([store.outcomesByBand("liquidity", LIQUIDITY_BANDS), store.outcomesByBand("swaps", SWAP_BANDS), coverage(store)]);
  return {
    byFirstLiquidityUsd: liquidity.map(withShare),
    byFirstSwaps: swaps.map(withShare),
    minSample: MIN_SAMPLE,
    definition: "Still trading = at least $50 of volume or 3 swaps in the 24 hours before the re-check, and the pool kept at least a tenth of its first-seen liquidity. A record of past tokens, not a prediction.",
    coverage: cov,
  };
}

// --- board ---------------------------------------------------------------------------------------------------------

export async function board(store: LaunchStore, days: number, nowMs: number) {
  if (!Number.isInteger(days) || days < 1 || days > BOARD_MAX_DAYS) throw new ApiError(400, "invalid_days", `days must be a whole number from 1 to ${BOARD_MAX_DAYS}.`);
  const since = Math.floor(nowMs / DAY_MS) * DAY_MS - (days - 1) * DAY_MS;
  const [rows, cov] = await Promise.all([store.boardDays(since), coverage(store)]);
  return { days: rows.map((d: BoardDay) => ({ ...d, stillTradingPct: shareOf(d.alive, d.dead) })), minSample: MIN_SAMPLE, coverage: cov };
}

// --- radar ---------------------------------------------------------------------------------------------------------

export async function radar(store: LaunchStore, hours: number, nowMs: number) {
  if (!Number.isInteger(hours) || hours < 1 || hours > RADAR_MAX_HOURS) throw new ApiError(400, "invalid_hours", `hours must be a whole number from 1 to ${RADAR_MAX_HOURS}.`);
  const [waves, cov] = await Promise.all([store.tickerWaves(nowMs - hours * HOUR_MS, 2, 20), coverage(store)]);
  return {
    hours,
    waves: waves.map((w: TickerWave) => ({ ...w, first: w.first ? { token: w.first.token, createdAt: new Date(w.first.createdMs).toISOString() } : null })),
    note: "A ticker reused by several tokens is often a wave of copies. 'first' is the earliest token we saw with it, not proof of who is real.",
    coverage: cov,
  };
}

// --- autopsy -------------------------------------------------------------------------------------------------------

export type Pattern = "still_trading" | "liquidity_pulled" | "faded" | "never_lived" | "too_young" | "not_rechecked" | "unknown";
const PATTERN_TEXT: Record<Pattern, string> = {
  still_trading: "Still trading a day after launch.",
  liquidity_pulled: "Liquidity was pulled: a day later the pool held under a tenth of what it started with.",
  faded: "Faded: the pool still had liquidity, but trading had all but stopped a day later.",
  never_lived: "Never lived: barely any trading even when we first saw it, and none to speak of a day later.",
  too_young: "Less than a day old. The re-check comes after 24 hours.",
  not_rechecked: "Over a day old, but our collector could not re-check it, so we cannot say.",
  unknown: "Re-checked, but the market data source gave no numbers to judge by.",
};

const swapsOf = (s: Pick<Snapshot, "buysH24" | "sellsH24">) => (s.buysH24 === null && s.sellsH24 === null ? null : (s.buysH24 ?? 0) + (s.sellsH24 ?? 0));

export function classify(p: PoolRecord, nowMs: number): Pattern {
  const o = p.outcome;
  if (!o) return nowMs - p.createdMs < DAY_MS ? "too_young" : "not_rechecked";
  if (o.alive === null) return "unknown";
  // A pulled pool is never "still trading": its day-later volume can be the trading from before the pull. Rows stored
  // before 2026-11-12 can say alive for such a pool, so it is checked here too, not only in the collector.
  const pulled = isPulled(p.first.liquidityUsd, o.liquidityUsd);
  if (o.alive && !pulled) return "still_trading";
  if (isAlive(p.first) === false) return "never_lived";
  if (pulled) return "liquidity_pulled";
  return "faded";
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export async function autopsy(store: LaunchStore, address: string, nowMs: number) {
  if (!ADDRESS.test(address)) throw new ApiError(400, "invalid_address", "The token must be a 0x address with 40 hex characters.");
  const token = address.toLowerCase();
  const [record, pools] = await Promise.all([store.getToken(token), store.poolsOfToken(token)]);
  if (!record || pools.length === 0) throw new ApiError(404, "token_not_collected", "Our collector has no pool for this token, so there is nothing to look back on. Use GET /api/v1/verdict/{address} for its contract.");
  // The first pool is the launch; later pools are listed but not judged.
  const p = pools[0];
  const pattern = classify(p, nowMs);
  const snap = (s: Snapshot) => ({ at: new Date(s.atMs).toISOString(), liquidityUsd: s.liquidityUsd, volumeH24Usd: s.volumeH24Usd, swapsH24: swapsOf(s) });
  return {
    token,
    symbol: record.symbol,
    pool: { address: p.pool, dex: p.dex, createdAt: new Date(p.createdMs).toISOString() },
    pattern,
    plain: PATTERN_TEXT[pattern],
    firstSeen: snap(p.first),
    dayLater: p.outcome ? { ...snap(p.outcome), ageHours: p.outcome.ageH } : null,
    otherPools: pools.length - 1,
    note: "One re-check a day after launch, from market data. What happened in between is not seen.",
  };
}
