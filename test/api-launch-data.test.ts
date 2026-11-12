// Launch data: odds, board, radar and autopsy over a real in-memory SQLite collector database. No network.
import assert from "node:assert/strict";
import test from "node:test";
import { D1CollectorStore } from "../collector/src/d1-store.ts";
import { openSqlite } from "../collector/src/sqlite-adapter.ts";
import type { PoolRecord } from "../collector/src/types.ts";
import { SWAP_BANDS, autopsy, board, classify, odds, radar } from "../api/src/launch-data.ts";
import { MIN_SAMPLE } from "../api/src/premortem.ts";
import { makeApp } from "./api-fixture.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 12, 12); // 12 Nov 2026 12:00 UTC
let n = 0;
const addr = () => "0x" + (++n).toString(16).padStart(40, "0");

type Snap = { liq: number | null; vol?: number | null; buys?: number | null; sells?: number | null };
const stats = (s: Snap) => ({ liquidityUsd: s.liq, volumeH24Usd: s.vol ?? null, buysH24: s.buys ?? null, sellsH24: s.sells ?? null, fdvUsd: null });

async function launch(store: D1CollectorStore, o: { created: number; first: Snap; later?: Snap & { alive: boolean | null }; ticker?: string; token?: string }) {
  const token = o.token ?? addr();
  const sym = o.ticker ?? "T" + n;
  await store.ensureToken(token, sym, sym.toUpperCase());
  const pool = addr();
  await store.addPool({ pool, token, quote: "0x" + "00".repeat(20), name: sym, symbol: sym, dex: "pons-v2", createdMs: o.created, first: { atMs: o.created + 60_000, ...stats(o.first) }, outcome: null });
  if (o.later) await store.setOutcome(pool, { atMs: o.created + DAY, ageH: 24, ...stats(o.later), alive: o.later.alive });
  return { token, pool };
}
const bench = () => new D1CollectorStore(openSqlite(":memory:"));

const poolRec = (first: Snap, later: (Snap & { alive: boolean | null }) | null, created = NOW - 2 * DAY): PoolRecord => ({
  pool: "0x1", token: "0x2", quote: "0x3", name: "X", symbol: "X", dex: "d", createdMs: created,
  first: { atMs: created, ...stats(first) },
  outcome: later ? { atMs: created + DAY, ageH: 24, ...stats(later), alive: later.alive } : null,
});

test("autopsy patterns: still trading, pulled, faded, never lived, too young, not re-checked, unknown", () => {
  const busy = { liq: 10_000, vol: 900, buys: 20, sells: 10 };
  assert.equal(classify(poolRec(busy, { liq: 9_000, vol: 400, buys: 5, sells: 3, alive: true }), NOW), "still_trading");
  assert.equal(classify(poolRec(busy, { liq: 500, vol: 10, buys: 1, sells: 0, alive: false }), NOW), "liquidity_pulled", "under 10% of the start");
  // Real case 2026-11-12 ("duh"): $70.5k -> $1.65 a day later, but 2,336 swaps in the 24 h before (trading before the pull).
  assert.equal(classify(poolRec({ liq: 70_543, vol: 83_091, buys: 200, sells: 49 }, { liq: 1.65, vol: 563_444, buys: 1500, sells: 836, alive: true }), NOW), "liquidity_pulled", "an old row stored alive is still pulled");
  assert.equal(classify(poolRec(busy, { liq: 1_000, vol: 10, buys: 1, sells: 0, alive: false }), NOW), "faded", "exactly 10% is not 'pulled'");
  assert.equal(classify(poolRec({ liq: 2_000, vol: 0, buys: 1, sells: 0 }, { liq: 100, vol: 0, buys: 0, sells: 0, alive: false }), NOW), "never_lived", "barely traded at first sight comes first");
  assert.equal(classify(poolRec(busy, null, NOW - 3_600_000), NOW), "too_young");
  assert.equal(classify(poolRec(busy, null), NOW), "not_rechecked");
  assert.equal(classify(poolRec(busy, { liq: null, alive: null }), NOW), "unknown");
});

test("autopsy over the database: first pool judged, snapshots in plain units, other pools counted", async () => {
  const store = bench();
  const { token } = await launch(store, { created: NOW - 2 * DAY, first: { liq: 8_000, vol: 600, buys: 30, sells: 12 }, later: { liq: 200, vol: 5, buys: 1, sells: 0, alive: false } });
  await launch(store, { token, created: NOW - DAY, first: { liq: 50 } });
  const r = await autopsy(store, token.toUpperCase().replace("0X", "0x"), NOW);
  assert.equal(r.pattern, "liquidity_pulled");
  assert.deepEqual(r.firstSeen, { at: new Date(NOW - 2 * DAY + 60_000).toISOString(), liquidityUsd: 8_000, volumeH24Usd: 600, swapsH24: 42 });
  assert.equal(r.dayLater!.swapsH24, 1);
  assert.equal(r.otherPools, 1);
  await assert.rejects(autopsy(store, "0x" + "e".repeat(40), NOW), (e: any) => e.status === 404 && e.code === "token_not_collected");
  await assert.rejects(autopsy(store, "0x12", NOW), (e: any) => e.status === 400);
});

test("odds: by first liquidity and first swaps, a share only from the minimum sample, coverage attached", async () => {
  const store = bench();
  for (let i = 0; i < MIN_SAMPLE; i++) await launch(store, { created: NOW - 3 * DAY, first: { liq: 20_000, buys: 50, sells: 60 }, later: { liq: 1, vol: 100, alive: i % 3 === 0 } });
  await launch(store, { created: NOW - 3 * DAY, first: { liq: 300, buys: 1, sells: 0 }, later: { liq: 0, alive: false } });
  await launch(store, { created: NOW - 3 * DAY, first: { liq: 300, buys: null, sells: null }, later: { liq: 0, alive: false } }); // swaps unknown: no swap band
  const r = await odds(store);
  const liq = r.byFirstLiquidityUsd.find((b) => b.minUsd === 10_000)!;
  assert.deepEqual([liq.n, liq.alive, liq.stillTradingPct], [MIN_SAMPLE, MIN_SAMPLE / 3, 33]);
  assert.equal(r.byFirstLiquidityUsd[0].stillTradingPct, null, "2 judged pools: no share");
  assert.deepEqual(r.byFirstSwaps.map((b) => b.minUsd), SWAP_BANDS);
  assert.deepEqual(r.byFirstSwaps.map((b) => b.n), [1, 0, 0, MIN_SAMPLE, 0], "110 swaps fall in [100, 500); unknown swaps are in no band");
  assert.deepEqual(r.coverage.pools, MIN_SAMPLE + 2);
  assert.match(r.coverage.note, /does not see every launch/);
});

test("board: per UTC day, newest first; rolled-up days come from daily_stats and are never counted twice", async () => {
  const db = openSqlite(":memory:");
  const store = new D1CollectorStore(db);
  await launch(store, { created: NOW - 1000, first: { liq: 1 } });
  await launch(store, { created: NOW - DAY, first: { liq: 1 }, later: { liq: 1, vol: 100, alive: true } });
  await launch(store, { created: NOW - DAY + 1, first: { liq: 1 }, later: { liq: 0, alive: false } });
  db.raw.prepare("INSERT INTO daily_stats (day, pools, outcomes, alive, dead, sum_first_liquidity_usd) VALUES ('2026-11-08', 40, 35, 12, 23, 0)").run();
  db.raw.prepare("INSERT INTO daily_stats (day, pools, outcomes, alive, dead, sum_first_liquidity_usd) VALUES ('2026-11-01', 9, 9, 1, 8, 0)").run(); // outside 7 days
  const r = await board(store, 7, NOW);
  assert.deepEqual(r.days.map((d) => [d.day, d.pools, d.outcomes, d.alive, d.dead, d.stillTradingPct]), [
    ["2026-11-12", 1, 0, 0, 0, null],
    ["2026-11-11", 2, 2, 1, 1, null],
    ["2026-11-08", 40, 35, 12, 23, 34],
  ]);
  await assert.rejects(board(store, 0, NOW), (e: any) => e.code === "invalid_days");
  await assert.rejects(board(store, 31, NOW), (e: any) => e.code === "invalid_days");
});

test("radar: tickers reused by 2+ recent tokens, most-used first, with the earliest and the busiest token", async () => {
  const store = bench();
  const old = await launch(store, { created: NOW - 10 * DAY, first: { liq: 1, vol: 5 }, ticker: "pepe" });
  const busy = await launch(store, { created: NOW - 3_600_000, first: { liq: 1, vol: 9_000 }, ticker: "PEPE" });
  await launch(store, { created: NOW - 7_200_000, first: { liq: 1, vol: 10 }, ticker: "Pepe" });
  await launch(store, { created: NOW - 1_000, first: { liq: 1 }, ticker: "DOGE" });
  await launch(store, { created: NOW - 2_000, first: { liq: 1 }, ticker: "DOGE" });
  await launch(store, { created: NOW - 3_000, first: { liq: 1 }, ticker: "SOLO" });
  const r = await radar(store, 24, NOW);
  assert.deepEqual(r.waves.map((w) => [w.ticker, w.recentTokens, w.totalTokens]), [["PEPE", 2, 3], ["DOGE", 2, 2]]);
  assert.equal(r.waves[0].first!.token, old.token, "the 10-day-old token is the first we saw, though outside the window");
  assert.equal(r.waves[0].busiest!.token, busy.token);
  await assert.rejects(radar(store, 0, NOW), (e: any) => e.code === "invalid_hours");
});

test("HTTP: the four tools answer; bad query is 400; no database is a clear 503", async () => {
  const store = bench();
  const { token } = await launch(store, { created: NOW - 2 * DAY, first: { liq: 5 }, later: { liq: 5, vol: 100, alive: true } });
  const app = makeApp({ collector: store });
  for (const p of ["/api/v1/odds", "/api/v1/board?days=3", "/api/v1/radar?hours=48", `/api/v1/autopsy/${token}`]) assert.equal((await app.send("GET", p)).status, 200, p);
  assert.equal((await app.send("GET", "/api/v1/board?days=abc")).status, 400);
  assert.equal((await app.send("POST", "/api/v1/odds", {})).status, 405);
  const bare = makeApp();
  const r = await bare.send("GET", "/api/v1/odds");
  assert.deepEqual([r.status, r.data.error.code], [503, "data_unavailable"]);
});
