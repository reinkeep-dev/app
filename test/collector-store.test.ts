import test from "node:test";
import assert from "node:assert/strict";
import { D1CollectorStore } from "../collector/src/d1-store.ts";
import { openSqlite } from "../collector/src/sqlite-adapter.ts";
import type { ContractFacts, PoolRecord } from "../collector/src/types.ts";

const A = "0x" + "aa".repeat(20);
const B = "0x" + "bb".repeat(20);
const C = "0x" + "cc".repeat(20);
const poolId = (n: number) => "0x" + n.toString(16).padStart(64, "0");

const make = () => {
  const db = openSqlite(":memory:");
  return { db, store: new D1CollectorStore(db) };
};
const pool = (n: number, over: Partial<PoolRecord> = {}): PoolRecord => ({
  pool: poolId(n), token: A, quote: "0x" + "00".repeat(20), name: "AAA / WETH 1%", symbol: "AAA", dex: "uniswap-v4-robinhood", createdMs: 1_000 * n,
  first: { atMs: 5_000 + n, liquidityUsd: 100.5, volumeH24Usd: 12, buysH24: 3, sellsH24: 2, fdvUsd: null },
  outcome: null,
  ...over,
});
const facts = (token: string, over: Partial<ContractFacts> = {}): ContractFacts => ({
  token, readAtMs: 9_000, scannerVersion: 2, isContract: true, codeSize: 4655, isProxy: false, implementation: null, hasMint: true, hasPause: false, hasBlacklist: null,
  hasUpgrade: false, hasOwnerFunction: true, owner: B, ownerRenounced: false, mintWithLiveOwner: true, totalSupply: "1000000000000000000000000000", decimals: 18, symbol: "AAA",
  ...over,
});
const outcome = (over = {}) => ({ atMs: 90_000, ageH: 24.3, liquidityUsd: 50, volumeH24Usd: 80, buysH24: 4, sellsH24: 1, fdvUsd: 9, alive: true as boolean | null, ...over });

test("a fresh database is empty", async () => {
  assert.deepEqual(await make().store.counts(), { pools: 0, tokens: 0, tokensWithFacts: 0, outcomes: 0 });
});

test("a pool round-trips exactly, nulls and all", async () => {
  const { store } = make();
  await store.ensureToken(A, "AAA", "AAA");
  assert.equal(await store.addPool(pool(1)), true);
  assert.deepEqual(await store.getPool(poolId(1)), pool(1));
  assert.equal(await store.getPool(poolId(99)), null);
});

test("the first sighting is never overwritten", async () => {
  const { store } = make();
  await store.ensureToken(A, "AAA", "AAA");
  assert.equal(await store.addPool(pool(1)), true);
  assert.equal(await store.addPool(pool(1, { first: { atMs: 99_999, liquidityUsd: 1e9, volumeH24Usd: null, buysH24: null, sellsH24: null, fdvUsd: null } })), false);
  assert.equal((await store.getPool(poolId(1)))!.first.liquidityUsd, 100.5);
  assert.equal((await store.counts()).pools, 1);
});

test("a pool cannot exist without its token (referential integrity)", async () => {
  const { store } = make();
  await assert.rejects(store.addPool(pool(1)), /FOREIGN KEY/);
  await assert.rejects(store.setFacts(A, facts(A)), /no such token/, "facts for a token we never saw are an error, not a silent no-op");
});

test("a pool count and the first-created time are worked out, not stored", async () => {
  const { store } = make();
  await store.ensureToken(A, "AAA", "AAA");
  assert.deepEqual([(await store.getToken(A))!.poolCount, (await store.getToken(A))!.firstCreatedMs], [0, 0]);
  for (const n of [3, 1, 2]) await store.addPool(pool(n));
  const t = (await store.getToken(A))!;
  assert.equal(t.poolCount, 3);
  assert.equal(t.firstCreatedMs, 1000);
});

test("ensureToken is safe to repeat and the first spelling stays", async () => {
  const { store } = make();
  await store.ensureToken(A, "First", "FIRST");
  await store.ensureToken(A, "Second", "SECOND");
  assert.equal((await store.getToken(A))!.symbol, "First");
  assert.equal((await store.counts()).tokens, 1);
  assert.equal(await store.getToken(B), null);
});

test("the DATABASE itself refuses bad data, whatever the code does", () => {
  const { db } = make();
  const run = (sql: string, ...v: unknown[]) => db.raw.prepare(sql).run(...(v as any[]));
  const tokenSql = "INSERT INTO tokens (token, symbol, ticker, facts_tries) VALUES (?, ?, ?, ?)";
  assert.throws(() => run(tokenSql, "0x" + "AA".repeat(20), "X", null, 0), /CHECK/, "upper-case address");
  assert.throws(() => run(tokenSql, "0x" + "aa".repeat(19), "X", null, 0), /CHECK/, "short address");
  assert.throws(() => run(tokenSql, "0x" + "zz".repeat(20), "X", null, 0), /CHECK/, "not hex");
  assert.throws(() => run(tokenSql, A, "", null, 0), /CHECK/, "empty symbol");
  assert.throws(() => run(tokenSql, A, "X", null, -1), /CHECK/, "negative tries");
  run(tokenSql, A, "X", null, 0);
  const poolSql = "INSERT INTO pools (pool, token, quote, name, symbol, dex, created_ms, first_at_ms, first_liquidity_usd) VALUES (?, ?, ?, 'n', 's', 'd', ?, ?, ?)";
  const quote = "0x" + "00".repeat(20);
  assert.throws(() => run(poolSql, "0x" + "ab".repeat(25), A, quote, 1, 1, 1), /CHECK/, "pool id of the wrong length");
  assert.throws(() => run(poolSql, poolId(2), A, "0x12", 1, 1, 1), /CHECK/, "quote must be a full address");
  assert.throws(() => run(poolSql, poolId(1), A, quote, 0, 1, 1), /CHECK/, "created time must be positive");
  assert.throws(() => run(poolSql, poolId(1), A, quote, 1, 1, -5), /CHECK/, "negative liquidity");
  run(poolSql, poolId(1), A, quote, 1, 1, 0);
  assert.throws(() => run("INSERT INTO pool_outcomes (pool, at_ms, age_h, alive) VALUES (?, 1, 1, 2)", poolId(1)), /CHECK/, "alive must be 0, 1 or NULL");
  const set = (assignments: string) => run(`UPDATE tokens SET ${assignments} WHERE token = ?`, A);
  assert.throws(() => set("read_at_ms = 1, facts_version = 1"), /CHECK/, "a half-written set of facts is refused (is_contract is missing)");
  assert.throws(() => set("read_at_ms = 1, is_contract = 1"), /CHECK/, "facts must say which scanner version read them");
  assert.throws(() => set("has_mint = 1"), /CHECK/, "no fact may be set before the contract has been read");
  const read = "read_at_ms = 1, facts_version = 1, is_contract = 1";
  assert.throws(() => set(`${read}, has_mint = 2`), /CHECK/, "boolean must be 0, 1 or NULL");
  assert.throws(() => set(`${read}, decimals = 300`), /CHECK/, "decimals above 255");
  assert.throws(() => set(`${read}, total_supply = '12ab'`), /CHECK/, "supply must be digits");
  assert.throws(() => set(`${read}, owner = '0x12'`), /CHECK/, "owner must be a full address");
  assert.throws(() => set("read_at_ms = 1, facts_version = 0, is_contract = 1"), /CHECK/, "scanner versions start at 1");
  set(`${read}, has_mint = 0`); // a complete, valid set is accepted
  assert.throws(() => set("is_contract = NULL"), /CHECK/, "half of a set cannot be un-known afterwards");
});

test("the queries that run every few minutes use an index and never scan a whole table", () => {
  const db = openSqlite(":memory:");
  const seen: string[] = [];
  const store = new D1CollectorStore({ prepare: (sql) => (seen.push(sql), db.prepare(sql)) });
  void store.tokensNeedingFacts(3, 20);
  void store.unresolvedPools(5000, 0, 60);
  const plan = (sql: string, ...v: unknown[]) => (db.raw.prepare("EXPLAIN QUERY PLAN " + sql).all(...(v as any[])) as { detail: string }[]).map((r) => r.detail).join(" | ");
  const pending = plan(seen[0], 3, 20);
  assert.match(pending, /idx_tokens_pending/, "the work queue is read from its own small index");
  assert.doesNotMatch(pending, /SCAN t\b/, "not by walking every token ever seen");
  void store.requeueOutdated(2);
  const outdated = plan(seen[2], 2);
  assert.match(outdated, /idx_tokens_outdated/, "finding facts from an older scanner reads only those, not every token");
  const window = plan(seen[1], 5000, 0, 60);
  assert.match(window, /idx_pools_created/, "the re-check reads only its time window");
  assert.doesNotMatch(window, /SCAN p\b/);
});

test("an outcome is written once; the second write is ignored", async () => {
  const { store } = make();
  await store.ensureToken(A, "AAA", "AAA");
  await store.addPool(pool(1));
  await store.setOutcome(poolId(1), outcome());
  await store.setOutcome(poolId(1), outcome({ liquidityUsd: 1e9, alive: false }));
  assert.deepEqual((await store.getPool(poolId(1)))!.outcome, outcome());
});

test("alive keeps its three states: true, false and unknown", async () => {
  const { store } = make();
  await store.ensureToken(A, "AAA", "AAA");
  for (const [n, alive] of [[1, true], [2, false], [3, null]] as const) {
    await store.addPool(pool(n));
    await store.setOutcome(poolId(n), outcome({ alive }));
    assert.equal((await store.getPool(poolId(n)))!.outcome!.alive, alive);
  }
});

test("unresolved pools: inside the window, oldest first, without those already resolved", async () => {
  const { store } = make();
  await store.ensureToken(A, "AAA", "AAA");
  for (const n of [5, 1, 3, 2, 4]) await store.addPool(pool(n)); // created 1000..5000
  await store.setOutcome(poolId(2), outcome());
  const ids = async (before: number, after: number, limit: number) => (await store.unresolvedPools(before, after, limit)).map((p) => p.createdMs);
  assert.deepEqual(await ids(5000, 0, 10), [1000, 3000, 4000, 5000]);
  assert.deepEqual(await ids(4000, 2000, 10), [3000, 4000], "the upper edge counts");
  assert.deepEqual(await ids(5000, 3000, 10), [3000, 4000, 5000], "and so does the lower edge (a pool created exactly then)");
  assert.deepEqual(await ids(5000, 0, 2), [1000, 3000], "limit applies after ordering");
  assert.deepEqual(await ids(500, 0, 10), []);
});

test("contract facts round-trip, including true, false, unknown and a huge supply", async () => {
  const { store } = make();
  await store.ensureToken(A, "AAA", "AAA");
  assert.equal((await store.getToken(A))!.facts, null);
  await store.setFacts(A, facts(A));
  assert.deepEqual((await store.getToken(A))!.facts, facts(A));
  assert.equal((await store.counts()).tokensWithFacts, 1);
});

test("facts can be refreshed in place, and a refresh clears the old error note", async () => {
  const { store } = make();
  await store.ensureToken(A, "AAA", "AAA");
  await store.noteFactsFailure(A, "node hiccup");
  await store.setFacts(A, facts(A, { hasMint: true }));
  await store.setFacts(A, facts(A, { hasMint: false, readAtMs: 20_000 }));
  const t = (await store.getToken(A))!;
  assert.equal(t.facts!.hasMint, false);
  assert.equal(t.facts!.readAtMs, 20_000);
  assert.equal(t.lastError, null);
  assert.equal((await store.counts()).tokensWithFacts, 1, "still one row for the token");
});

test("tokens that need facts: newest discovered first, tries limited, never those that have them", async () => {
  const { store } = make();
  for (const [t, n] of [[A, 1], [B, 2], [C, 3]] as const) {
    await store.ensureToken(t, "T", "T"); // discovered in this order
    await store.addPool(pool(n, { token: t, pool: poolId(n) }));
  }
  assert.deepEqual((await store.tokensNeedingFacts(3, 10)).map((t) => t.token), [C, B, A]);
  assert.deepEqual((await store.tokensNeedingFacts(3, 2)).map((t) => t.token), [C, B]);
  await store.setFacts(B, facts(B));
  assert.deepEqual((await store.tokensNeedingFacts(3, 10)).map((t) => t.token), [C, A], "B has its facts now, so it left the queue");
  for (let i = 0; i < 3; i++) await store.noteFactsFailure(C, "x");
  assert.deepEqual((await store.tokensNeedingFacts(3, 10)).map((t) => t.token), [A], "three failed tries and it is left alone");
  assert.equal((await store.getToken(C))!.factsTries, 3);
});

test("facts from an older scanner go back to the queue; current ones are left alone", async () => {
  const { store } = make();
  for (const t of [A, B, C]) await store.ensureToken(t, "T", "T");
  await store.setFacts(A, facts(A, { scannerVersion: 1 }));
  await store.setFacts(B, facts(B, { scannerVersion: 2 }));
  await store.noteFactsFailure(C, "x"); // never read at all
  assert.equal(await store.requeueOutdated(2), 1, "only A was read by an older scanner");
  const a = (await store.getToken(A))!;
  assert.equal(a.facts, null, "its old answer is forgotten");
  assert.equal(a.factsTries, 0);
  assert.equal((await store.getToken(B))!.facts!.scannerVersion, 2, "a current answer stays");
  assert.deepEqual((await store.tokensNeedingFacts(3, 10)).map((t) => t.token).sort(), [A, C].sort(), "A is queued again, next to the unread C");
  assert.equal(await store.requeueOutdated(2), 0, "running it again changes nothing");
  assert.equal(await store.requeueOutdated(3), 1, "a newer scanner outdates B as well");
});

test("an error note is kept but cut to a sensible length", async () => {
  const { store } = make();
  await store.ensureToken(A, "AAA", "AAA");
  await store.noteFactsFailure(A, "e".repeat(5000));
  assert.equal((await store.getToken(A))!.lastError!.length, 300);
});

test("tokens that share a ticker come back oldest first, others do not", async () => {
  const { store } = make();
  for (const [t, n, tick] of [[A, 3, "WIENER"], [B, 1, "WIENER"], [C, 2, "OTHER"]] as const) {
    await store.ensureToken(t, tick, tick);
    await store.addPool(pool(n, { token: t, pool: poolId(n) }));
  }
  assert.deepEqual((await store.tokensWithTicker("WIENER")).map((t) => t.token), [B, A]);
  assert.deepEqual((await store.tokensWithTicker("NOPE")), []);
});

test("hostile text from the outside is stored as plain data and cannot touch the SQL", async () => {
  const { store } = make();
  const evil = "x'); DROP TABLE tokens; DROP TABLE pools; --";
  await store.ensureToken(A, evil, "EVIL");
  await store.addPool(pool(1, { name: evil, symbol: evil.slice(0, 40), dex: evil }));
  await store.noteFactsFailure(A, evil);
  assert.equal((await store.getToken(A))!.symbol, evil);
  assert.equal((await store.getPool(poolId(1)))!.name, evil);
  assert.deepEqual(await store.counts(), { pools: 1, tokens: 1, tokensWithFacts: 0, outcomes: 0 });
});
