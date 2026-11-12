// Finding new tokens on the chain (the launcher's event), so discovery no longer depends on GeckoTerminal answering.
import test from "node:test";
import assert from "node:assert/strict";
import { LAUNCHER, LAUNCH_TOPIC, parseLaunchLog, scanLaunches } from "../collector/src/chain-launches.ts";
import { runCollect } from "../collector/src/collect-run.ts";
import { createRpcClient } from "../collector/src/contract-facts.ts";
import { D1CollectorStore } from "../collector/src/d1-store.ts";
import { createGeckoClient } from "../collector/src/geckoterminal.ts";
import { createBudget } from "../collector/src/http-json.ts";
import { openSqlite } from "../collector/src/sqlite-adapter.ts";
import { buildTokenFacts } from "../collector/src/token-facts.ts";
import { fakeInternet, fixture, noSleep, RPC_URL, type Chain, type Internet } from "./collector-fixtures.ts";

const REAL = fixture("rpc-launch-log.json");
const REAL_TOKEN = "0xf96e8cc7ffe50da27eb02e1607fa59b64e7109db";
const REAL_POOL = "0xe8b5d1c723cd515a622bd192a9f10292f901f338";
const REAL_BLOCK = 0x6a4d3fc;
const word = (a: string) => "0x" + a.slice(2).padStart(64, "0");
const addr = (n: number) => "0x" + n.toString(16).padStart(40, "0");

// Synthetic launches built exactly like the real one, with their own token, pool and block.
const launchLog = (n: number, block: number) => ({ ...REAL.log, blockNumber: "0x" + block.toString(16), topics: [LAUNCH_TOPIC, word(addr(0xa000 + n)), word(addr(0xb000 + n)), REAL.log.topics[3]] });
// A GeckoTerminal /pools/multi answer for given pools, shaped like the recorded one (test/fixtures/gecko-multi.json).
const geckoPool = (pool: string, token: string, symbol: string, liquidity: string) => {
  const item = structuredClone(fixture("gecko-multi.json").data[0]);
  item.id = "robinhood_" + pool;
  item.attributes.address = pool;
  item.attributes.name = `${symbol} / ETH`;
  item.attributes.reserve_in_usd = liquidity;
  item.relationships.base_token.data.id = "robinhood_" + token;
  item.relationships.quote_token.data.id = "robinhood_0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  item.relationships.dex.data.id = "pons-v2";
  return item;
};
// The symbol() answer the fake node gives for a token (ABI-encoded string).
const symbolSpec = (s: string) => ({ symbol: s });

function bench() {
  const db = openSqlite(":memory:");
  const store = new D1CollectorStore(db);
  async function run(net: Internet, o: { now?: number; budget?: number; chain?: Record<string, number> } = {}) {
    const inet = fakeInternet({ gecko: "error500", ...net }); // GeckoTerminal down by default: discovery must not need it
    const budget = createBudget(o.budget ?? 45, inet.fetch);
    const now = o.now ?? REAL.blockTimestamp * 1000 + 60_000;
    const stats = await runCollect({
      store, now: () => now, budgetLeft: budget.left, pages: 1,
      gecko: createGeckoClient({ fetch: budget.fetch, sleep: noSleep, now: () => now, minIntervalMs: 0 }),
      rpc: createRpcClient({ url: RPC_URL, fetch: budget.fetch, sleep: noSleep }),
      chain: { lookbackBlocks: 1000, ...o.chain },
    });
    return { stats, inet, budget };
  }
  return { db, store, run };
}

test("the REAL recorded launch event: token, pool and block are read from the right topics", () => {
  assert.deepEqual(parseLaunchLog(REAL.log), { token: REAL_TOKEN, pool: REAL_POOL, block: REAL_BLOCK });
});

test("anything that is not exactly the launcher's event is ignored, not half-read", () => {
  const cases: [string, unknown][] = [
    ["another contract", { ...REAL.log, address: "0x" + "11".repeat(20) }],
    ["another event", { ...REAL.log, topics: ["0x" + "22".repeat(32), ...REAL.log.topics.slice(1)] }],
    ["missing topic", { ...REAL.log, topics: REAL.log.topics.slice(0, 3) }],
    ["topic not an address word", { ...REAL.log, topics: [LAUNCH_TOPIC, "0x" + "ff".repeat(32), REAL.log.topics[2], REAL.log.topics[3]] }],
    ["bad block number", { ...REAL.log, blockNumber: "12" }],
    ["not an object", "nope"],
  ];
  for (const [why, log] of cases) assert.equal(parseLaunchLog(log), null, why);
});

test("a first run finds the launch on the chain while GeckoTerminal is DOWN, and reads its contract", async () => {
  const { store, run } = bench();
  const chain: Chain = { head: REAL_BLOCK + 10, logs: [REAL.log], blockTime: () => REAL.blockTimestamp };
  const { stats } = await run({ chain, specs: { [REAL_TOKEN]: symbolSpec("LIBBY") } });
  assert.equal(stats.launchesFound, 1);
  assert.equal(stats.chainScannedTo, REAL_BLOCK + 10);
  assert.equal(stats.factsRead, 1, "the contract is read in the same run");
  assert.ok(stats.errors.some((e) => e.startsWith("new pools")), "GeckoTerminal really was failing");
  const t = (await store.getToken(REAL_TOKEN))!;
  assert.deepEqual([t.symbol, t.ticker, t.firstCreatedMs], ["LIBBY", "LIBBY", REAL.blockTimestamp * 1000]);
  const sheet = buildTokenFacts(t, await store.poolsOfToken(REAL_TOKEN), []);
  assert.equal(sheet.is_contract, true);
  assert.equal(sheet.seen_liquidity_usd, null, "no market numbers yet: the gate will say REVIEW, never ALLOW");
});

test("the next run continues after the cursor: old blocks are not read again, new launches are found", async () => {
  const { store, run } = bench();
  const chain: Chain = { head: REAL_BLOCK + 10, logs: [REAL.log] };
  await run({ chain });
  chain.logs.push(launchLog(1, REAL_BLOCK + 50));
  chain.head = REAL_BLOCK + 60;
  const { stats, inet } = await run({ chain });
  assert.equal(stats.launchesFound, 1, "only the new one; the first is not counted again");
  const getLogs = inet.calls.flatMap((c) => (Array.isArray(c.body) ? c.body : [])).filter((c: any) => c.method === "eth_getLogs");
  assert.equal(getLogs[0].params[0].fromBlock, "0x" + (REAL_BLOCK + 11).toString(16), "starts right after the last processed block");
  assert.equal(await store.getCursor("launches"), REAL_BLOCK + 60);
});

test("when GeckoTerminal answers, the queued pool gets its market numbers and the launch is resolved", async () => {
  const { store, run } = bench();
  const chain: Chain = { head: REAL_BLOCK + 10, logs: [REAL.log] };
  await run({ chain, specs: { [REAL_TOKEN]: symbolSpec("LIBBY") } });
  assert.equal((await store.unresolvedLaunches(0, 30)).length, 1);
  const { stats } = await run({ chain, gecko: "ok", multi: { data: [geckoPool(REAL_POOL, REAL_TOKEN, "LIBBY", "12345.6")] } });
  assert.equal(stats.launchesResolved, 1);
  assert.equal((await store.unresolvedLaunches(0, 30)).length, 0);
  const sheet = buildTokenFacts((await store.getToken(REAL_TOKEN))!, await store.poolsOfToken(REAL_TOKEN), []);
  assert.equal(sheet.seen_liquidity_usd, 12345.6);
});

test("more launches than one run's allowance: it stops at a whole block and the next run picks up the rest", async () => {
  const { store, run } = bench();
  const logs = Array.from({ length: 12 }, (_, i) => launchLog(i, REAL_BLOCK + 1 + Math.floor(i / 2))); // two per block
  const chain: Chain = { head: REAL_BLOCK + 100, logs };
  const first = await run({ chain }, { chain: { maxLaunches: 5 } });
  assert.equal(first.stats.launchesFound, 4, "the 5th shares a block with the 6th, so that block waits whole");
  assert.equal(first.stats.chainScannedTo, REAL_BLOCK + 2);
  assert.ok(first.stats.stoppedBy.some((s) => s.includes("next run continues")));
  for (let i = 0; i < 3; i++) await run({ chain }, { chain: { maxLaunches: 5 } });
  const counts = (await store.unresolvedLaunches(0, 100)).length;
  assert.equal(counts, 12, "every launch stored once, none lost, none twice");
  assert.equal(await store.getCursor("launches"), REAL_BLOCK + 100);
});

test("a failure halfway (a block time cannot be read) does not move the cursor; the next run completes it", async () => {
  const { store, run } = bench();
  const chain: Chain = { head: REAL_BLOCK + 10, logs: [REAL.log, launchLog(1, REAL_BLOCK + 5)], blockFails: [REAL_BLOCK + 5] };
  const failed = await run({ chain });
  assert.ok(failed.stats.errors.some((e) => e.startsWith("launches:")));
  assert.equal(await store.getCursor("launches"), null, "nothing claimed as done");
  assert.equal((await store.unresolvedLaunches(0, 10)).length, 0, "both were in one detail batch, so neither was written");
  chain.blockFails = [];
  const ok = await run({ chain });
  assert.equal(ok.stats.launchesFound, 2, "the retry stores both, once each");
  assert.equal((await store.unresolvedLaunches(0, 10)).length, 2);
  assert.equal(await store.getCursor("launches"), REAL_BLOCK + 10);
});

test("getLogs refused: reported, cursor unchanged, other stages still run", async () => {
  const { store, run } = bench();
  const { stats } = await run({ chain: { head: 100, logs: [], logsFail: true } });
  assert.ok(stats.errors.some((e) => e.startsWith("launches: getLogs failed")));
  assert.equal(await store.getCursor("launches"), null);
});

test("the node refuses old blocks as 'archive' (seen live on Cloudflare): jump to recent blocks and SAY what was missed", async () => {
  const { store, run } = bench();
  // The cursor is far behind (say the collector was down), and the node only serves blocks from REAL_BLOCK - 100 on.
  await store.setCursor("launches", REAL_BLOCK - 50_000);
  const chain: Chain = { head: REAL_BLOCK + 10, logs: [REAL.log], archiveBelow: REAL_BLOCK - 100 };
  const refused = await run({ chain }, { chain: { lookbackBlocks: 50 } });
  assert.ok(refused.stats.errors.some((e) => e.includes("archive")));
  assert.ok(refused.stats.stoppedBy.some((s) => s.includes("MISSED")), "the gap is reported, not hidden");
  assert.equal(await store.getCursor("launches"), REAL_BLOCK + 10 - 50, "resumes near the newest block");
  const next = await run({ chain }, { chain: { lookbackBlocks: 50 } });
  assert.deepEqual(next.stats.errors.filter((e) => e.startsWith("launches")), []);
  assert.equal(next.stats.launchesFound, 1, "recent launches are found again");
});

test("the node refuses even RECENT blocks: nothing is called missed, the cursor stays, the next run retries", async () => {
  const { store, run } = bench();
  const chain: Chain = { head: REAL_BLOCK + 10, logs: [REAL.log], archiveBelow: Number.MAX_SAFE_INTEGER };
  const { stats } = await run({ chain }, { chain: { lookbackBlocks: 50 } });
  assert.ok(stats.stoppedBy.some((s) => s.includes("nothing skipped")));
  assert.ok(!stats.stoppedBy.some((s) => s.includes("MISSED")), "no false alarm");
  assert.equal(await store.getCursor("launches"), null, "no claim that any block was processed");
});

test("with a separate logs node, launches are read from IT and contracts from the main node", async () => {
  const db = openSqlite(":memory:");
  const store = new D1CollectorStore(db);
  const main = fakeInternet({ gecko: "error500" }); // knows no logs: like the free Chainstack node for old blocks
  const logs = fakeInternet({ chain: { head: REAL_BLOCK + 10, logs: [REAL.log] }, specs: { [REAL_TOKEN]: symbolSpec("LIBBY") } });
  const now = REAL.blockTimestamp * 1000 + 60_000;
  const stats = await runCollect({
    store, now: () => now, budgetLeft: () => 45, pages: 1, chain: { lookbackBlocks: 1000 },
    gecko: createGeckoClient({ fetch: main.fetch, sleep: noSleep, now: () => now, minIntervalMs: 0 }),
    rpc: createRpcClient({ url: RPC_URL, fetch: main.fetch, sleep: noSleep }),
    logsRpc: createRpcClient({ url: RPC_URL, fetch: logs.fetch, sleep: noSleep }),
  });
  assert.equal(stats.launchesFound, 1);
  const methods = (inet: ReturnType<typeof fakeInternet>) => inet.calls.flatMap((c) => (Array.isArray(c.body) ? c.body.map((x: any) => x.method) : []));
  assert.ok(methods(logs).includes("eth_getLogs"));
  assert.ok(!methods(main).includes("eth_getLogs"), "the main node is never asked for logs");
  assert.ok(methods(main).includes("eth_getCode"), "the contract is read from the main node");
  db.close();
});

test("a symbol the contract will not give: stored as '?', ticker unknown, so it is never grouped as a copy", async () => {
  const { store, run } = bench();
  await run({ chain: { head: REAL_BLOCK + 1, logs: [REAL.log] }, specs: { [REAL_TOKEN]: { symbol: "" } } });
  const t = (await store.getToken(REAL_TOKEN))!;
  assert.deepEqual([t.symbol, t.ticker], ["?", null]);
});

test("copies: a chain-found token WITHOUT a pool yet keeps its real launch time, so others are not wrongly 'copies' of it", async () => {
  const { store, run } = bench();
  // An older WIENER seen through GeckoTerminal at block-time 1000 s, then a newer WIENER launched on chain.
  const OLD = addr(0x1);
  await store.ensureToken(OLD, "WIENER", "WIENER");
  await store.addPool({ pool: "0x" + "cd".repeat(20), token: OLD, quote: "0x" + "00".repeat(20), name: "WIENER / ETH", symbol: "WIENER", dex: "x", createdMs: 1_000_000, first: { atMs: 1_000_100, liquidityUsd: 5, volumeH24Usd: 1, buysH24: 1, sellsH24: 1, fdvUsd: null }, outcome: null });
  await run({ chain: { head: REAL_BLOCK + 1, logs: [REAL.log], blockTime: () => REAL.blockTimestamp }, specs: { [REAL_TOKEN]: symbolSpec("WIENER") } });
  const same = await store.tokensWithTicker("WIENER");
  const sheet = (tok: string) => store.getToken(tok).then(async (t) => buildTokenFacts(t!, await store.poolsOfToken(tok), same));
  assert.equal((await sheet(OLD)).ticker_clone_of_older, false, "the older one is the original");
  assert.equal((await sheet(REAL_TOKEN)).ticker_clone_of_older, true, "the chain-found newer one is the copy");
});

test("the launch queue is read through its index, not by scanning every launch", () => {
  const db = openSqlite(":memory:");
  const seen: string[] = [];
  const store = new D1CollectorStore({ prepare: (sql) => (seen.push(sql), db.prepare(sql)) });
  void store.unresolvedLaunches(0, 30);
  const plan = (db.raw.prepare("EXPLAIN QUERY PLAN " + seen[0]).all(0, 30) as { detail: string }[]).map((r) => r.detail).join(" | ");
  assert.match(plan, /idx_launches_created/);
  assert.doesNotMatch(plan, /SCAN l\b/);
});

test("the database refuses a bad launch row and a cursor never moves backwards", async () => {
  const { db, store } = bench();
  await store.ensureToken(REAL_TOKEN, "X", "X");
  const ins = (pool: string, block: number, created: number) => db.raw.prepare("INSERT INTO launches (token, pool, block, created_ms, found_ms) VALUES (?, ?, ?, ?, 1)").run(REAL_TOKEN, pool, block, created);
  assert.throws(() => ins("0x12", 1, 1), /CHECK/, "pool must be a full address");
  assert.throws(() => ins(REAL_POOL.toUpperCase().replace("0X", "0x"), 1, 1), /CHECK/, "lower case only");
  assert.throws(() => ins(REAL_POOL, 0, 1), /CHECK/, "block must be positive");
  assert.throws(() => db.raw.prepare("INSERT INTO launches (token, pool, block, created_ms, found_ms) VALUES (?, ?, 1, 1, 1)").run(addr(0x77), REAL_POOL), /FOREIGN KEY/, "a launch needs its token row");
  await store.setCursor("launches", 500);
  await store.setCursor("launches", 400);
  assert.equal(await store.getCursor("launches"), 500, "a slower run finishing late cannot rewind it");
});

test("retention removes an old launch whose pool never resolved, and its token, without breaking the foreign key", async () => {
  const { store, run } = bench();
  await run({ chain: { head: REAL_BLOCK + 1, logs: [REAL.log], blockTime: () => 1_000 } }); // launched at 1 000 s
  assert.equal((await store.counts()).tokens, 1);
  const r = await store.prune(100 * 86_400_000, 300);
  assert.equal(r.tokensDeleted, 1);
  assert.equal((await store.unresolvedLaunches(0, 10)).length, 0);
});

test("with the chain stage on, a run stays inside the 45-request budget", async () => {
  const { run } = bench();
  const logs = Array.from({ length: 30 }, (_, i) => launchLog(i, REAL_BLOCK + 1 + i));
  const { budget, stats } = await run({ chain: { head: REAL_BLOCK + 50, logs }, gecko: "ok" });
  assert.equal(stats.launchesFound, 30);
  assert.ok(budget.used() <= 45, `used ${budget.used()}`);
});

test("far behind (a GitHub run hours late): maxScans lets ONE run read several spans and catch up", async () => {
  const one = bench();
  const many = bench();
  const logs = [launchLog(1, REAL_BLOCK + 10), launchLog(2, REAL_BLOCK + 2_500), launchLog(3, REAL_BLOCK + 4_900)];
  const chain = (): Chain => ({ head: REAL_BLOCK + 5_000, logs: [...logs] });
  for (const b of [one, many]) await b.store.setCursor("launches", REAL_BLOCK);
  const a = await one.run({ chain: chain() }, { chain: { maxSpanBlocks: 1_000 } });
  assert.equal(a.stats.launchesFound, 1, "default: one span of 1,000 blocks per run");
  assert.equal(await one.store.getCursor("launches"), REAL_BLOCK + 1_000);
  assert.ok(a.stats.stoppedBy.some((s) => s.includes("next run continues")));
  const b = await many.run({ chain: chain() }, { chain: { maxSpanBlocks: 1_000, maxScans: 10 } });
  assert.equal(b.stats.launchesFound, 3, "all three spans read in one run");
  assert.equal(await many.store.getCursor("launches"), REAL_BLOCK + 5_000);
  assert.ok(!b.stats.stoppedBy.some((s) => s.includes("next run continues")), "caught up, so no 'continues' note");
  const getLogs = b.inet.calls.flatMap((c) => (Array.isArray(c.body) ? c.body : [])).filter((c: any) => c.method === "eth_getLogs");
  assert.equal(getLogs.length, 5, "stops at the head: 5 spans, not 10");
});

test("maxScans: a failure in a later span keeps what earlier spans stored", async () => {
  const { store, run } = bench();
  await store.setCursor("launches", REAL_BLOCK);
  const chain: Chain = { head: REAL_BLOCK + 3_000, logs: [launchLog(1, REAL_BLOCK + 10), launchLog(2, REAL_BLOCK + 1_500)], blockFails: [REAL_BLOCK + 1_500] };
  const { stats } = await run({ chain }, { chain: { maxSpanBlocks: 1_000, maxScans: 5 } });
  assert.equal(stats.launchesFound, 1, "the first span's launch is stored");
  assert.ok(stats.errors.some((e) => e.startsWith("launches:")));
  assert.equal(await store.getCursor("launches"), REAL_BLOCK + 1_000, "cursor after the last COMPLETE span, not past the failure");
});

test("launchBatches: a long queue is asked in different slices of 30, not the same 30 again", async () => {
  const { store, run } = bench();
  const logs = Array.from({ length: 45 }, (_, i) => launchLog(i, REAL_BLOCK + 1 + i));
  await run({ chain: { head: REAL_BLOCK + 50, logs } }, { budget: 200, chain: { maxLaunches: 100 } });
  assert.equal((await store.unresolvedLaunches(0, 100)).length, 45);
  const { inet } = await run({ chain: { head: REAL_BLOCK + 50, logs }, gecko: "ok", multi: { data: [] } }, { budget: 200, chain: { launchBatches: 3 } });
  const launchAsks = multiAsks(inet).filter((ids) => ids.some((id) => LAUNCH_POOLS.has(id)));
  assert.deepEqual(launchAsks.map((ids) => ids.length), [30, 15], "45 queued: one slice of 30, one of 15 (no third call)");
  assert.equal(new Set(launchAsks.flat()).size, 45, "every queued pool asked once, none twice");
});

const LAUNCH_POOLS = new Set(Array.from({ length: 45 }, (_, i) => addr(0xb000 + i)));
const multiAsks = (inet: { calls: { url: string }[] }) =>
  inet.calls.filter((c) => c.url.includes("/pools/multi/")).map((c) => c.url.split("/pools/multi/")[1].split(","));

test("default launchBatches is 1: the Cloudflare run still asks GeckoTerminal for at most 30 launch pools", async () => {
  const { run } = bench();
  const logs = Array.from({ length: 45 }, (_, i) => launchLog(i, REAL_BLOCK + 1 + i));
  const { inet } = await run({ chain: { head: REAL_BLOCK + 50, logs }, gecko: "ok", multi: { data: [] } }, { budget: 200, chain: { maxLaunches: 100 } });
  const launchAsks = multiAsks(inet).filter((ids) => ids.some((id) => LAUNCH_POOLS.has(id)));
  assert.deepEqual(launchAsks.map((ids) => ids.length), [30]);
});

test("scanLaunches on an empty range asks for nothing more than the head", async () => {
  const inet = fakeInternet({ chain: { head: 10, logs: [] } });
  const rpc = createRpcClient({ url: RPC_URL, fetch: inet.fetch, sleep: noSleep });
  const r = await scanLaunches(rpc, { cursor: 10, lookbackBlocks: 5, maxSpanBlocks: 100, maxLaunches: 30 });
  assert.deepEqual([r.launches.length, r.scannedTo, inet.count(RPC_URL)], [0, 10, 1]);
  assert.equal(LAUNCHER, REAL.log.address, "the recorded log came from the launcher we watch");
});
