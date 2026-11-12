// One collection run: find new pools, read their contracts, and re-check pools that are a day old.
// Written to be safe to run twice at once or to be cut off midway: every storage call is idempotent, and each stage
// is wrapped on its own, so one source failing (or asking for a human check) never throws away the others' work.
import { ArchiveRefused, launchDetails, scanLaunches } from "./chain-launches.ts";
import type { CollectorStore } from "./collector-store.ts";
import { readContractFacts, SCANNER_VERSION, type RpcClient } from "./contract-facts.ts";
import type { GeckoClient } from "./geckoterminal.ts";
import { BlockedError, BudgetExhausted, RateLimited } from "./http-json.ts";
import { normalizeTicker } from "./ticker.ts";
import type { Outcome, Snapshot } from "./types.ts";

export type CollectDeps = {
  store: CollectorStore;
  gecko: GeckoClient;
  rpc: RpcClient;
  now: () => number;
  budgetLeft: () => number; // outgoing requests still allowed this run (Cloudflare's free plan: 50 in total)
  pages?: number; // pages of new pools to read
  maxFacts?: number; // tokens whose contract to read per run
  maxFactsTries?: number; // give up on a token after this many failed reads
  resolveBatches?: number; // 30 pools per batch
  // Find launches on the chain (chain-launches.ts). Off unless given, so a run without it behaves as before.
  // maxScans: getLogs calls per run (default 1, as on Cloudflare). launchBatches: stage 1b requests of 30 pools (default 1).
  // The GitHub runner raises both: its runs can come hours apart, and the chain makes ~35,000 blocks an hour.
  chain?: { lookbackBlocks?: number; maxSpanBlocks?: number; maxLaunches?: number; maxScans?: number; launchBatches?: number };
  // The node used for launches only. Needed because the free Chainstack plan answers getLogs for about the last
  // 10 blocks (~1 s) and refuses 128+ blocks as "archive" (tested 2026-11-11), while a run comes every 5 minutes.
  // Contract reads keep using `rpc`. Without it, launches use `rpc` too.
  logsRpc?: RpcClient;
};

export type RunStats = {
  launchesFound: number; // new launches read from the chain this run
  launchesResolved: number; // queued launches whose pool GeckoTerminal returned this run
  chainScannedTo: number | null; // the cursor after this run (null when the chain stage is off or failed)
  poolsSeen: number;
  poolsAdded: number;
  rowsSkipped: number;
  factsRequeued: number; // facts from an older scanner sent back to be read again
  factsRead: number;
  factsFailed: number;
  outcomesStored: number;
  outcomesMissing: number;
  stoppedBy: string[]; // plain reasons a stage ended early
  errors: string[];
};

const HOUR_MS = 3_600_000;
// A pool counts as still alive after a day with at least this much trading. Our own rule of thumb, stated once.
const ALIVE_MIN_VOLUME_USD = 50;
const ALIVE_MIN_SWAPS = 3;
const RESOLVE_AFTER_MS = 24 * HOUR_MS;
const GIVE_UP_AFTER_MS = 72 * HOUR_MS; // a pool the source still will not return after three days is dropped
// Chain reading, sized for Cloudflare's 45-request budget. About 9.6 blocks a second (measured 2026-11-09).
// A first run starts ~5 minutes back, not 24 hours: from Cloudflare the public node refused a 24-hour-old range as
// "archive" data (2026-11-11). A span of 20,000 blocks (~35 min) lets a run catch up after a few missed runs.
const CURSOR = "launches";
const CHAIN_DEFAULTS = { lookbackBlocks: 3_000, maxSpanBlocks: 20_000, maxLaunches: 30, maxScans: 1 };

export function isAlive(s: Pick<Snapshot, "volumeH24Usd" | "buysH24" | "sellsH24">): boolean | null {
  if (s.volumeH24Usd === null && s.buysH24 === null && s.sellsH24 === null) return null; // nothing to judge by
  const swaps = (s.buysH24 ?? 0) + (s.sellsH24 ?? 0);
  return (s.volumeH24Usd ?? 0) >= ALIVE_MIN_VOLUME_USD || swaps >= ALIVE_MIN_SWAPS;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export async function runCollect(d: CollectDeps): Promise<RunStats> {
  const stats: RunStats = {
    launchesFound: 0, launchesResolved: 0, chainScannedTo: null,
    poolsSeen: 0, poolsAdded: 0, rowsSkipped: 0, factsRequeued: 0, factsRead: 0, factsFailed: 0, outcomesStored: 0, outcomesMissing: 0, stoppedBy: [], errors: [],
  };
  const nowMs = d.now();

  // 0. Launches from the chain. The token row is written at once, so its contract is read this run and the gate
  //    knows it even while GeckoTerminal is refusing us; its pool waits in the queue for market numbers (stage 1b).
  //    The cursor moves only after every launch up to it is stored, so a failure here is simply retried next run.
  if (d.chain) {
    try {
      const plan = { ...CHAIN_DEFAULTS, ...d.chain };
      const needed = 2 + Math.ceil(plan.maxLaunches / 5);
      if (d.budgetLeft() < needed) stats.stoppedBy.push("request budget too small to read launches");
      else {
        const chainRpc = d.logsRpc ?? d.rpc;
        // Each pass stores its launches and moves the cursor before the next, so a failure mid-run loses nothing.
        for (let pass = 0; pass < plan.maxScans; pass++) {
          if (pass > 0 && d.budgetLeft() < needed) { stats.stoppedBy.push("launches: request budget used up; next run continues"); break; }
          const scan = await scanLaunches(chainRpc, { cursor: await d.store.getCursor(CURSOR), ...plan });
          for (const l of await launchDetails(chainRpc, scan.launches)) {
            const symbol = l.symbol ?? "?"; // the column needs something; the ticker stays null so it is never grouped
            await d.store.ensureToken(l.token, symbol, l.symbol === null ? null : normalizeTicker(l.symbol));
            if (await d.store.addLaunch(l, nowMs)) stats.launchesFound++;
          }
          await d.store.setCursor(CURSOR, scan.scannedTo);
          stats.chainScannedTo = scan.scannedTo;
          if (scan.scannedTo >= scan.head) break;
          if (pass === plan.maxScans - 1) stats.stoppedBy.push(`launches: caught up to block ${scan.scannedTo} of ${scan.head}; next run continues`);
        }
      }
    } catch (e) {
      stats.errors.push(`launches: ${message(e)}`);
      if (e instanceof BlockedError) stats.stoppedBy.push("RPC node asked for a human check");
      // The node will never serve that range, so retrying it forever would stop discovery for good. Jump to recent
      // blocks and record the gap loudly: launches inside it are missed (they can be filled from another node later).
      // Only when the refused range starts BEFORE the recent window is there anything to skip; a refusal of recent
      // blocks is just retried next run (seen live: the public node also refuses recent ranges from Cloudflare).
      if (e instanceof ArchiveRefused) {
        const resume = Math.max(0, e.head - (d.chain.lookbackBlocks ?? CHAIN_DEFAULTS.lookbackBlocks));
        if (resume > e.from) {
          await d.store.setCursor(CURSOR, resume).catch(() => {});
          stats.chainScannedTo = resume;
          stats.stoppedBy.push(`launches: node refused old blocks ${e.from}-${e.to}; skipped to block ${resume}. Launches in blocks ${e.from}-${resume} are MISSED`);
        } else {
          stats.stoppedBy.push("launches: node refused recent blocks; will retry next run (nothing skipped)");
        }
      }
    }
  }

  // 1. New pools. Stop paging as soon as a page has nothing new: older pages cannot have anything either.
  try {
    for (let page = 1; page <= (d.pages ?? 2); page++) {
      if (d.budgetLeft() < 1) { stats.stoppedBy.push("request budget used up while reading pools"); break; }
      const { rows, skipped } = await d.gecko.newPools(page);
      stats.rowsSkipped += skipped.length;
      let added = 0;
      for (const row of rows) {
        stats.poolsSeen++;
        // The token row must exist before the pool row that points at it (the foreign key enforces this).
        await d.store.ensureToken(row.token, row.symbol, normalizeTicker(row.symbol));
        const isNew = await d.store.addPool({ ...row, first: { atMs: nowMs, ...row.stats }, outcome: null });
        if (isNew) added++;
      }
      stats.poolsAdded += added;
      if (added === 0) break;
    }
  } catch (e) {
    stats.errors.push(`new pools: ${message(e)}`);
    if (e instanceof BlockedError) stats.stoppedBy.push("market data source asked for a human check");
  }

  // 1b. Market numbers for launches found on the chain, 30 pools per request, newest first. A pool GeckoTerminal does
  //     not return yet stays queued for the next run; after three days it is no longer asked for.
  if (d.chain) {
    try {
      // Read the queue once, then ask in slices of 30. Asking "the newest 30" again would repeat the same slice,
      // because a pool GeckoTerminal does not know yet stays in the queue.
      const batches = Math.max(1, d.chain.launchBatches ?? 1);
      const queued = await d.store.unresolvedLaunches(nowMs - GIVE_UP_AFTER_MS, 30 * batches);
      for (let i = 0; i < queued.length && d.budgetLeft() >= 1; i += 30) {
        const { rows } = await d.gecko.pools(queued.slice(i, i + 30).map((l) => l.pool));
        for (const row of rows) {
          await d.store.ensureToken(row.token, row.symbol, normalizeTicker(row.symbol));
          if (await d.store.addPool({ ...row, first: { atMs: nowMs, ...row.stats }, outcome: null })) stats.launchesResolved++;
        }
      }
    } catch (e) {
      stats.errors.push(`launch pools: ${message(e)}`);
      if (e instanceof BlockedError) stats.stoppedBy.push("market data source asked for a human check");
    }
  }

  // 2. Contract facts, newest tokens first. One request per token (two for a proxy).
  try {
    stats.factsRequeued = await d.store.requeueOutdated(SCANNER_VERSION);
    const tokens = await d.store.tokensNeedingFacts(d.maxFactsTries ?? 3, d.maxFacts ?? 20);
    for (const t of tokens) {
      if (d.budgetLeft() < 2) { stats.stoppedBy.push("request budget used up while reading contracts"); break; }
      try {
        await d.store.setFacts(t.token, await readContractFacts(d.rpc, t.token, d.now()));
        stats.factsRead++;
      } catch (e) {
        // Not this token's fault, so it must not use up one of the token's tries. A source that is rate-limiting us
        // will answer the next token the same way: stop here and let the next run continue.
        if (e instanceof BlockedError || e instanceof BudgetExhausted || e instanceof RateLimited) throw e;
        stats.factsFailed++;
        await d.store.noteFactsFailure(t.token, message(e));
      }
    }
  } catch (e) {
    stats.errors.push(`contract facts: ${message(e)}`);
    if (e instanceof BlockedError) stats.stoppedBy.push("RPC node asked for a human check");
    if (e instanceof BudgetExhausted) stats.stoppedBy.push("request budget used up while reading contracts");
    if (e instanceof RateLimited) stats.stoppedBy.push("RPC node said slow down; will continue next run");
  }

  // 3. Re-check pools that are at least a day old, 30 per request.
  try {
    const due = await d.store.unresolvedPools(nowMs - RESOLVE_AFTER_MS, nowMs - GIVE_UP_AFTER_MS, 30 * (d.resolveBatches ?? 2));
    for (let i = 0; i < due.length; i += 30) {
      if (d.budgetLeft() < 1) { stats.stoppedBy.push("request budget used up while re-checking pools"); break; }
      const batch = due.slice(i, i + 30);
      const { rows } = await d.gecko.pools(batch.map((p) => p.pool));
      const returned = new Map(rows.map((r) => [r.pool, r]));
      for (const pool of batch) {
        const row = returned.get(pool.pool);
        if (!row) { stats.outcomesMissing++; continue; }
        const outcome: Outcome = { atMs: nowMs, ...row.stats, ageH: Math.round(((nowMs - pool.createdMs) / HOUR_MS) * 10) / 10, alive: isAlive(row.stats) };
        await d.store.setOutcome(pool.pool, outcome);
        stats.outcomesStored++;
      }
    }
  } catch (e) {
    stats.errors.push(`re-check: ${message(e)}`);
    if (e instanceof BlockedError) stats.stoppedBy.push("market data source asked for a human check");
  }

  return stats;
}
