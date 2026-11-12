import test from "node:test";
import assert from "node:assert/strict";
import { D1CollectorStore } from "../collector/src/d1-store.ts";
import { openSqlite } from "../collector/src/sqlite-adapter.ts";
import { HARD_LIMIT_BYTES, SOFT_LIMIT_BYTES, retentionPlan } from "../collector/src/retention.ts";
import type { PoolRecord } from "../collector/src/types.ts";

const DAY = 86_400_000;
const D0 = Date.parse("2026-09-01T00:00:00Z"); // start of a UTC day
const addr = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const poolId = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const mk = (n: number, token: string, createdMs: number): PoolRecord => ({
  pool: poolId(n), token, quote: addr(0), name: "T / WETH", symbol: "T", dex: "uniswap-v4-robinhood", createdMs,
  first: { atMs: createdMs + 1, liquidityUsd: 10, volumeH24Usd: 1, buysH24: 1, sellsH24: 1, fdvUsd: null }, outcome: null,
});
const bench = async () => {
  const db = openSqlite(":memory:");
  const store = new D1CollectorStore(db);
  const add = async (n: number, token: string, createdMs: number, alive?: boolean | null) => {
    await store.ensureToken(token, "T", "T");
    await store.addPool(mk(n, token, createdMs));
    if (alive !== undefined) await store.setOutcome(poolId(n), { atMs: createdMs + DAY, ageH: 24, liquidityUsd: 1, volumeH24Usd: 1, buysH24: 1, sellsH24: 1, fdvUsd: null, alive });
  };
  return { db, store, add };
};
const rows = (db: any, sql: string) => db.raw.prepare(sql).all();

test("old whole days are rolled into daily_stats, then deleted; recent days stay", async () => {
  const { db, store, add } = await bench();
  await add(1, addr(1), D0 + 1000, true); // day 0, alive
  await add(2, addr(2), D0 + 2000, false); // day 0, dead
  await add(3, addr(3), D0 + 3000, null); // day 0, unknown
  await add(4, addr(4), D0 + 4000); // day 0, never re-checked
  await add(5, addr(5), D0 + 5 * DAY + 1000, true); // day 5, recent
  const r = await store.prune(D0 + 2 * DAY + 5 * 3_600_000, 100); // cutoff mid day 2: days 0 and 1 are whole days before it
  assert.equal(r.poolsDeleted, 4);
  assert.equal(r.tokensDeleted, 4);
  assert.deepEqual(await store.counts(), { pools: 1, tokens: 1, tokensWithFacts: 0, outcomes: 1 });
  assert.deepEqual(rows(db, "SELECT * FROM daily_stats").map((x: any) => ({ ...x })), [
    { day: "2026-09-01", pools: 4, outcomes: 3, alive: 1, dead: 1, sum_first_liquidity_usd: 40 },
  ]);
});

test("a day that has begun but not ended before the cutoff is never touched", async () => {
  const { store, add } = await bench();
  await add(1, addr(1), D0 + 2 * DAY + 1000); // same day as the cutoff, older than the cutoff itself
  const r = await store.prune(D0 + 2 * DAY + 12 * 3_600_000, 100);
  assert.equal(r.poolsDeleted, 0);
  assert.equal((await store.counts()).pools, 1);
});

test("a token with a newer pool survives; only orphaned tokens go", async () => {
  const { store, add } = await bench();
  await add(1, addr(1), D0 + 1000, true);
  await add(2, addr(1), D0 + 9 * DAY, true); // same token, recent pool
  await add(3, addr(2), D0 + 2000, true);
  await store.prune(D0 + 3 * DAY, 100);
  assert.deepEqual({ pools: (await store.counts()).pools, tokens: (await store.counts()).tokens }, { pools: 1, tokens: 1 });
  assert.notEqual(await store.getToken(addr(1)), null);
  assert.equal(await store.getToken(addr(2)), null);
});

test("the limit is respected, oldest first, and repeating finishes the job without double counting", async () => {
  const { db, store, add } = await bench();
  for (let i = 1; i <= 5; i++) await add(i, addr(i), D0 + i * 1000, true);
  const first = await store.prune(D0 + 3 * DAY, 2);
  assert.equal(first.poolsDeleted, 2);
  assert.equal((await store.counts()).pools, 3);
  assert.equal(await store.getPool(poolId(1)), null); // oldest went first
  assert.notEqual(await store.getPool(poolId(5)), null);
  const second = await store.prune(D0 + 3 * DAY, 100);
  assert.equal(second.poolsDeleted, 3);
  assert.equal(second.daysRolledUp, 0); // totals were written once, on the first run
  assert.equal(rows(db, "SELECT pools FROM daily_stats")[0].pools, 5);
  const third = await store.prune(D0 + 3 * DAY, 100);
  assert.deepEqual(third, { daysRolledUp: 0, poolsDeleted: 0, tokensDeleted: 0 });
});

test("more tokens than one statement can bind are all cleaned up", async () => {
  const { store, add } = await bench();
  for (let i = 1; i <= 250; i++) await add(i, addr(i), D0 + i, true);
  const r = await store.prune(D0 + 3 * DAY, 1000);
  assert.deepEqual({ pools: r.poolsDeleted, tokens: r.tokensDeleted }, { pools: 250, tokens: 250 });
  assert.equal((await store.counts()).tokens, 0);
});

test("a day total cannot be written twice or overwritten with a partial one", async () => {
  const { db, store, add } = await bench();
  for (let i = 1; i <= 4; i++) await add(i, addr(i), D0 + i, true);
  await store.prune(D0 + 3 * DAY, 1); // rolls up all four, deletes one
  await store.prune(D0 + 3 * DAY, 1); // would see only three pools if it recounted
  assert.equal(rows(db, "SELECT pools FROM daily_stats")[0].pools, 4);
});

test("the database file size is reported and changes with the data", async () => {
  const { store, add } = await bench();
  const empty = await store.sizeBytes();
  for (let i = 1; i <= 300; i++) await add(i, addr(i), D0 + i, true);
  const full = await store.sizeBytes();
  assert.ok(typeof empty === "number" && typeof full === "number" && full > empty, `${empty} -> ${full}`);
});

test("the retention window tightens as the database fills, and an unknown size is not an alarm", () => {
  const now = D0;
  const days = (p: ReturnType<typeof retentionPlan>) => Math.round((now - p.cutoffMs) / DAY);
  assert.deepEqual([retentionPlan(null, now).level, days(retentionPlan(null, now))], ["normal", 60]);
  assert.deepEqual([retentionPlan(SOFT_LIMIT_BYTES - 1, now).level, days(retentionPlan(SOFT_LIMIT_BYTES - 1, now))], ["normal", 60]);
  assert.deepEqual([retentionPlan(SOFT_LIMIT_BYTES, now).level, days(retentionPlan(SOFT_LIMIT_BYTES, now))], ["tight", 14]);
  assert.deepEqual([retentionPlan(HARD_LIMIT_BYTES, now).level, days(retentionPlan(HARD_LIMIT_BYTES, now))], ["emergency", 3]);
  assert.ok(HARD_LIMIT_BYTES < 500 * 1024 * 1024, "the emergency level must sit below Cloudflare's 500 MB cap");
});

test("a run note starts unfinished, is finished with its stats, and old notes are cleared", async () => {
  const { db, store } = await bench();
  const a = await store.startRun(D0);
  const b = await store.startRun(D0 + 20 * DAY);
  await store.finishRun(b, D0 + 20 * DAY + 5000, { poolsAdded: 3, errors: [] });
  const all = rows(db, "SELECT id, started_ms, finished_ms, stats FROM collector_runs ORDER BY id").map((x: any) => ({ ...x }));
  assert.deepEqual(all[0], { id: a, started_ms: D0, finished_ms: null, stats: null }, "never finished = cut off");
  assert.deepEqual(JSON.parse(all[1].stats), { poolsAdded: 3, errors: [] });
  assert.equal(await store.pruneRuns(D0 + 14 * DAY), 1);
  assert.equal(rows(db, "SELECT COUNT(*) AS n FROM collector_runs")[0].n, 1);
});
