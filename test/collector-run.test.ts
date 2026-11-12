import test from "node:test";
import assert from "node:assert/strict";
import { isAlive, isPulled, outcomeAlive, runCollect } from "../collector/src/collect-run.ts";
import { D1CollectorStore } from "../collector/src/d1-store.ts";
import { createRpcClient } from "../collector/src/contract-facts.ts";
import { createGeckoClient } from "../collector/src/geckoterminal.ts";
import { createBudget } from "../collector/src/http-json.ts";
import { openSqlite } from "../collector/src/sqlite-adapter.ts";
import { buildTokenFacts } from "../collector/src/token-facts.ts";
import { fakeInternet, NOW, noSleep, RPC_URL, type Internet } from "./collector-fixtures.ts";

const HYVO_TOKEN = "0xeedc49c41ea7141e8fb1f1a3f106858c31c05a9a";
const METRION_TOKEN = "0x38a4656010a2384c07ee7eaa9e1ce8f71c4098f0";
const HOUR = 3_600_000;

function bench() {
  const db = openSqlite(":memory:");
  const store = new D1CollectorStore(db);
  // One run against a fake internet, optionally with a request budget and settings.
  async function run(net: Internet = {}, o: { now?: number; budget?: number; maxFacts?: number; resolveBatches?: number; pages?: number; planBlind?: boolean } = {}) {
    const inet = fakeInternet(net);
    const budget = createBudget(o.budget ?? 45, inet.fetch);
    const now = o.now ?? NOW;
    const stats = await runCollect({
      store,
      gecko: createGeckoClient({ fetch: budget.fetch, sleep: noSleep, now: () => now, minIntervalMs: 0 }),
      rpc: createRpcClient({ url: RPC_URL, fetch: budget.fetch, sleep: noSleep }),
      now: () => now,
      budgetLeft: o.planBlind ? () => 99 : budget.left, // planBlind: the planner believes it has plenty; only the real limit stops it
      maxFacts: o.maxFacts,
      resolveBatches: o.resolveBatches,
      pages: o.pages,
    });
    return { stats, inet, budget };
  }
  return { db, store, run };
}

test("a first run on the REAL recorded data stores everything and uses few requests", async () => {
  const { store, run } = bench();
  const { stats, inet, budget } = await run();
  assert.equal(stats.poolsAdded, 20);
  assert.equal(stats.poolsSeen, 40, "page two repeats page one in the recording, so every row is seen twice");
  assert.equal(stats.factsRead, 19);
  assert.deepEqual([stats.factsFailed, stats.rowsSkipped, stats.outcomesStored, stats.errors, stats.stoppedBy], [0, 0, 0, [], []]);
  assert.deepEqual(await store.counts(), { pools: 20, tokens: 19, tokensWithFacts: 19, outcomes: 0 });
  assert.equal(inet.count("geckoterminal"), 2);
  assert.equal(inet.count(RPC_URL), 19, "one request per token");
  assert.equal(budget.used(), 21);
  assert.ok(budget.used() <= 45, "well inside Cloudflare's free allowance of 50 per run");
});

test("a second run with nothing new stops reading pages early and does no needless work", async () => {
  const { store, run } = bench();
  await run();
  const second = await run();
  assert.equal(second.stats.poolsAdded, 0);
  assert.equal(second.stats.factsRead, 0);
  assert.equal(second.inet.count("geckoterminal"), 1, "page one had nothing new, so page two was never asked for");
  assert.equal(second.inet.count(RPC_URL), 0);
  assert.deepEqual(await store.counts(), { pools: 20, tokens: 19, tokensWithFacts: 19, outcomes: 0 });
});

test("WIENER: four different tokens with one ticker, and only the oldest is not a copy", async () => {
  const { store, run } = bench();
  await run();
  const same = await store.tokensWithTicker("WIENER");
  assert.equal(same.length, 4);
  const sheets = await Promise.all(same.map(async (t) => buildTokenFacts(t, await store.poolsOfToken(t.token), same)));
  assert.deepEqual(sheets.map((s) => s.ticker_uses), [4, 4, 4, 4]);
  assert.deepEqual(sheets.map((s) => s.ticker_clone_of_older), [false, true, true, true]);
  assert.equal(same[0].token.slice(0, 10), "0xe5d76779", "the oldest was created first, at 05:28");
});

test("Metrion: one token in two pools is NOT a copy of itself", async () => {
  const { store, run } = bench();
  await run();
  const t = (await store.getToken(METRION_TOKEN))!;
  const sheet = buildTokenFacts(t, await store.poolsOfToken(METRION_TOKEN), await store.tokensWithTicker("METRION"));
  assert.equal(sheet.pool_count, 2);
  assert.equal(sheet.ticker_uses, 1);
  assert.equal(sheet.ticker_clone_of_older, false);
  assert.equal(sheet.seen_age_minutes, 14, "first pool 05:35:57, first seen 05:50:00");
  assert.equal(sheet.seen_liquidity_usd, 1.6984, "the larger of its two first-seen figures; the other was not reported");
  assert.equal(sheet.liquidity_not_reported, false);
  assert.equal(sheet.has_mint, false);
  assert.equal(sheet.mint_with_live_owner, false);
});

test("after a day, pools are re-checked and the outcome is written once", async () => {
  const { store, run } = bench();
  await run();
  const later = Date.parse("2026-11-11T06:00:00Z");
  const r = await run({}, { now: later });
  assert.equal(r.stats.poolsAdded, 0);
  assert.equal(r.stats.outcomesStored, 2, "the recorded multi-pool answer holds two pools");
  assert.equal(r.stats.outcomesMissing, 18, "the others were not in the answer, and are left to try again");
  assert.equal(r.inet.count("/pools/multi/"), 1, "all 20 due pools went in ONE request");
  const hyvo = (await store.poolsOfToken(HYVO_TOKEN))[0];
  assert.equal(hyvo.outcome!.ageH, 24.3);
  assert.equal(hyvo.outcome!.alive, true);
  assert.ok(hyvo.outcome!.volumeH24Usd! >= 50);
  const before = JSON.stringify(hyvo.outcome);
  const again = await run({}, { now: later + HOUR });
  assert.equal(again.stats.outcomesStored, 0);
  assert.equal(JSON.stringify((await store.poolsOfToken(HYVO_TOKEN))[0].outcome), before, "an outcome is never overwritten");
  assert.equal((await store.counts()).outcomes, 2);
});

test("nothing is re-checked before 24 hours, and pools older than 72 hours are given up on", async () => {
  const { run } = bench();
  await run();
  const early = await run({}, { now: NOW + 23 * HOUR });
  assert.equal(early.inet.count("/pools/multi/"), 0);
  const tooLate = await run({}, { now: NOW + 80 * HOUR });
  assert.equal(tooLate.inet.count("/pools/multi/"), 0);
});

test("with no request budget, nothing is sent and the run says why", async () => {
  const { run } = bench();
  const r = await run({}, { budget: 0 });
  assert.equal(r.inet.calls.length, 0);
  assert.deepEqual(r.stats.stoppedBy, ["request budget used up while reading pools"]);
});

test("a tight budget is respected exactly: pools first, then as many contracts as fit", async () => {
  const { store, run } = bench();
  const r = await run({}, { budget: 5 });
  assert.equal(r.inet.calls.length, 4, "2 pool pages + 2 contracts; the third contract would need 2 and only 1 was left");
  assert.equal(r.stats.factsRead, 2);
  assert.ok(r.stats.stoppedBy.includes("request budget used up while reading contracts"));
  assert.equal((await store.counts()).tokensWithFacts, 2);
  assert.equal((await store.tokensNeedingFacts(3, 50)).every((t) => t.factsTries === 0), true, "running out of budget is nobody's fault, so no token loses a try");
  const next = await run();
  assert.equal(next.stats.factsRead, 17, "the next run picks up exactly where this one stopped");
});

test("running out of requests in the middle of reading a contract does not blame that token", async () => {
  const { store, run } = bench();
  const r = await run({}, { budget: 3, planBlind: true }); // 2 pool pages + 1 contract, then the real limit hits
  assert.equal(r.stats.factsRead, 1);
  assert.equal(r.stats.factsFailed, 0, "a spent allowance is not a failed read");
  assert.ok(r.stats.stoppedBy.includes("request budget used up while reading contracts"));
  assert.equal((await store.tokensNeedingFacts(3, 50)).every((t) => t.factsTries === 0), true, "no token lost one of its three tries");
  assert.equal(r.inet.calls.length, 3, "and it did not retry or wait: the extra request never left");
});

test("when the market-data source fails, the other stages still run and nothing is lost", async () => {
  const { store, run } = bench();
  const first = await run({ rpc: "challenge" });
  assert.equal(first.stats.factsRead, 0);
  const second = await run({ gecko: "error500" });
  assert.match(second.stats.errors[0], /^new pools: .*gave up after 4 tries \(HTTP 500\)/);
  assert.equal(second.stats.factsRead, 19, "contracts were still read from what was already collected");
  assert.equal((await store.counts()).tokensWithFacts, 19);
});

test("a bot check from the market-data source stops that stage, says so, and is not worked around", async () => {
  const { run } = bench();
  const r = await run({ gecko: "challenge" });
  assert.equal(r.inet.count("geckoterminal"), 1, "asked once, no retries");
  assert.ok(r.stats.stoppedBy.includes("market data source asked for a human check"));
  assert.match(r.stats.errors[0], /human check/);
});

test("a bot check from the RPC node stops reading at once and costs no token a try", async () => {
  const { store, run } = bench();
  const r = await run({ rpc: "challenge" });
  assert.equal(r.inet.count(RPC_URL), 1, "stopped at the first answer");
  assert.ok(r.stats.stoppedBy.includes("RPC node asked for a human check"));
  assert.equal(r.stats.factsFailed, 0);
  assert.equal((await store.tokensNeedingFacts(3, 50)).every((t) => t.factsTries === 0), true);
});

test("an RPC node that keeps saying slow down stops the stage, and no token is blamed for it", async () => {
  const { store, run } = bench();
  const r = await run({ rpc: "slow-down" });
  assert.equal(r.inet.count(RPC_URL), 4, "one token was tried, with the normal four attempts, then the stage stopped");
  assert.equal(r.stats.factsFailed, 0);
  assert.ok(r.stats.stoppedBy.includes("RPC node said slow down; will continue next run"));
  assert.equal((await store.tokensNeedingFacts(3, 50)).every((t) => t.factsTries === 0 && t.lastError === null), true, "nobody lost a try or got an error note");
  assert.equal((await run()).stats.factsRead, 19, "the next run, with the node answering again, reads them all");
});

test("one token that cannot be read is retried, then left alone after three tries; others are unaffected", async () => {
  const { store, run } = bench();
  const bad = { [HYVO_TOKEN]: { codeFails: true } };
  const first = await run({ specs: bad });
  assert.equal(first.stats.factsFailed, 1);
  assert.equal(first.stats.factsRead, 18);
  const t1 = (await store.getToken(HYVO_TOKEN))!;
  assert.equal(t1.factsTries, 1);
  assert.match(t1.lastError!, /could not read the token's code/);
  await run({ specs: bad });
  await run({ specs: bad });
  assert.equal((await store.getToken(HYVO_TOKEN))!.factsTries, 3);
  const fourth = await run({ specs: bad });
  assert.equal(fourth.stats.factsFailed, 0, "no fourth attempt");
  assert.equal(fourth.inet.count(RPC_URL), 0);
});

test("facts read by an older scanner are read again automatically, and the newest scanner's answers are left alone", async () => {
  const { store, run } = bench();
  await run();
  const before = (await store.getToken(HYVO_TOKEN))!.facts!;
  assert.equal(before.scannerVersion, 2);
  await store.setFacts(HYVO_TOKEN, { ...before, scannerVersion: 1, hasMint: true }); // pretend an old, wrong answer
  const next = await run();
  assert.equal(next.stats.factsRequeued, 1, "only the one outdated token was sent back");
  assert.equal(next.stats.factsRead, 1);
  const after = (await store.getToken(HYVO_TOKEN))!.facts!;
  assert.deepEqual([after.scannerVersion, after.hasMint], [2, false], "the old, wrong answer is replaced by the new scanner's");
  const again = await run();
  assert.equal(again.stats.factsRequeued, 0);
  assert.equal(again.inet.count(RPC_URL), 0, "nothing more to read");
});

test("a token that failed earlier is read later when the node recovers, and the error note clears", async () => {
  const { store, run } = bench();
  await run({ specs: { [HYVO_TOKEN]: { codeFails: true } } });
  assert.equal((await store.getToken(HYVO_TOKEN))!.facts, null);
  await run({});
  const t = (await store.getToken(HYVO_TOKEN))!;
  assert.notEqual(t.facts, null);
  assert.equal(t.lastError, null);
});

test("two runs at the same time cannot make duplicates or lose anything", async () => {
  const { store, run } = bench();
  const [a, b] = await Promise.all([run(), run()]);
  assert.equal(a.stats.poolsAdded + b.stats.poolsAdded, 20, "each pool was added by exactly one of the two");
  assert.deepEqual(await store.counts(), { pools: 20, tokens: 19, tokensWithFacts: 19, outcomes: 0 });
});

test("pools with an odd shape are counted as skipped and the rest are kept", async () => {
  const { store, run } = bench();
  const page = { data: [{ attributes: { address: "bad" }, relationships: {} }, null] };
  const r = await run({ newPools: { 1: page, 2: page } });
  assert.equal(r.stats.rowsSkipped, 2);
  assert.equal(r.stats.poolsAdded, 0);
  assert.equal((await store.counts()).pools, 0);
});

test("alive after a day: enough trading, or too little, or nothing to judge by", () => {
  assert.equal(isAlive({ volumeH24Usd: 50, buysH24: 0, sellsH24: 0 }), true, "$50 of volume is enough");
  assert.equal(isAlive({ volumeH24Usd: 49.99, buysH24: 1, sellsH24: 1 }), false);
  assert.equal(isAlive({ volumeH24Usd: 0, buysH24: 2, sellsH24: 1 }), true, "three swaps is enough");
  assert.equal(isAlive({ volumeH24Usd: null, buysH24: 3, sellsH24: null }), true);
  assert.equal(isAlive({ volumeH24Usd: 0, buysH24: 0, sellsH24: 0 }), false, "zeros are real data: dead");
  assert.equal(isAlive({ volumeH24Usd: null, buysH24: null, sellsH24: null }), null, "no numbers at all is unknown, not dead");
});

test("a pulled pool is never stored alive, however busy its last 24 hours look", () => {
  // Real case 2026-11-12 ("duh"): $70.5k at first sight, $1.65 a day later, 2,336 swaps in the 24 h before the re-check.
  const busyAfterPull = { liquidityUsd: 1.65, volumeH24Usd: 563_444, buysH24: 1500, sellsH24: 836 };
  assert.equal(outcomeAlive({ liquidityUsd: 70_543 }, busyAfterPull), false);
  assert.equal(outcomeAlive({ liquidityUsd: 10_000 }, { ...busyAfterPull, liquidityUsd: 1_000 }), true, "exactly 10% is not pulled");
  assert.equal(outcomeAlive({ liquidityUsd: null }, busyAfterPull), true, "no first liquidity: trading decides");
  assert.equal(outcomeAlive({ liquidityUsd: 10_000 }, { ...busyAfterPull, liquidityUsd: null }), true, "no later liquidity: trading decides");
  assert.equal(isPulled(0, 0), false);
});
