import test from "node:test";
import assert from "node:assert/strict";
import { buildTokenFacts } from "../collector/src/token-facts.ts";
import type { ContractFacts, PoolRecord, TokenRecord } from "../collector/src/types.ts";

const token = (over: Partial<TokenRecord> = {}): TokenRecord => ({ token: "0x" + "aa".repeat(20), symbol: "AAA", ticker: "AAA", firstCreatedMs: 1_000_000, poolCount: 1, facts: null, factsTries: 0, lastError: null, ...over });
const pool = (n: number, over: Partial<PoolRecord> = {}, first: Partial<PoolRecord["first"]> = {}): PoolRecord => ({
  pool: "0x" + n.toString(16).padStart(64, "0"), token: "0x" + "aa".repeat(20), quote: "0x" + "00".repeat(20), name: "AAA / WETH", symbol: "AAA", dex: "d", createdMs: 1_000_000 + n,
  first: { atMs: 1_000_000 + n + 600_000, liquidityUsd: 1000, volumeH24Usd: 50, buysH24: 4, sellsH24: 1, fdvUsd: null, ...first }, outcome: null, ...over,
});
const contract = (over: Partial<ContractFacts> = {}): ContractFacts => ({
  token: "0x" + "aa".repeat(20), readAtMs: 7, scannerVersion: 2, isContract: true, codeSize: 100, isProxy: false, implementation: null, hasMint: false, hasPause: false, hasBlacklist: false, hasUpgrade: false,
  hasOwnerFunction: false, owner: null, ownerRenounced: null, mintWithLiveOwner: false, totalSupply: "1000", decimals: 18, symbol: "AAA", ...over,
});

test("a token whose contract has not been read says UNKNOWN for every contract fact, never 'no'", () => {
  const f = buildTokenFacts(token(), [pool(1)], []);
  for (const k of ["facts_read_at_ms", "is_contract", "is_proxy", "has_mint", "has_pause", "has_blacklist", "has_upgrade", "has_owner_function", "owner_renounced", "mint_with_live_owner", "total_supply", "decimals"] as const) {
    assert.equal(f[k], null, k);
  }
  assert.equal(f.pool_count, 1, "what we do know is still reported");
});

test("contract facts are passed through, with their three states", () => {
  const f = buildTokenFacts(token({ facts: contract({ hasMint: true, hasBlacklist: null, mintWithLiveOwner: true, owner: "0x" + "bb".repeat(20), ownerRenounced: false }) }), [pool(1)], []);
  assert.equal(f.has_mint, true);
  assert.equal(f.has_pause, false);
  assert.equal(f.has_blacklist, null);
  assert.equal(f.mint_with_live_owner, true);
  assert.equal(f.facts_read_at_ms, 7);
  assert.equal(f.total_supply, "1000");
});

test("how old the pool was when first seen, in whole minutes, from the EARLIEST pool", () => {
  const f = buildTokenFacts(token(), [pool(2, {}, { atMs: 1_000_002 + 20 * 60_000 }), pool(1, {}, { atMs: 1_000_001 + 5 * 60_000 })], []);
  assert.equal(f.seen_age_minutes, 5);
});

test("liquidity is the largest first-seen figure; unreported is only true when NO pool reported", () => {
  const some = buildTokenFacts(token(), [pool(1, {}, { liquidityUsd: null }), pool(2, {}, { liquidityUsd: 100 }), pool(3, {}, { liquidityUsd: 250 })], []);
  assert.equal(some.seen_liquidity_usd, 250, "the largest of 100 and 250, not the smallest");
  assert.equal(some.liquidity_not_reported, false);
  const none = buildTokenFacts(token(), [pool(1, {}, { liquidityUsd: null }), pool(2, {}, { liquidityUsd: null })], []);
  assert.equal(none.seen_liquidity_usd, null);
  assert.equal(none.liquidity_not_reported, true);
  const zero = buildTokenFacts(token(), [pool(1, {}, { liquidityUsd: 0 })], []);
  assert.equal(zero.seen_liquidity_usd, 0, "a reported zero is zero, not unknown");
  assert.equal(zero.liquidity_not_reported, false);
});

test("swaps and volume add up across pools and ignore pools with no figure", () => {
  const f = buildTokenFacts(token(), [pool(1, {}, { buysH24: 3, sellsH24: 2, volumeH24Usd: 10 }), pool(2, {}, { buysH24: null, sellsH24: 4, volumeH24Usd: null }), pool(3, {}, { buysH24: 1, sellsH24: 1, volumeH24Usd: 5 })], []);
  assert.equal(f.seen_swaps, 7, "the half-known pool is left out rather than guessed");
  assert.equal(f.seen_volume_usd, 15);
  const nothing = buildTokenFacts(token(), [pool(1, {}, { buysH24: null, sellsH24: null, volumeH24Usd: null })], []);
  assert.equal(nothing.seen_swaps, null);
  assert.equal(nothing.seen_volume_usd, null);
});

test("a token with no pools has no market facts at all", () => {
  const f = buildTokenFacts(token(), [], []);
  assert.deepEqual([f.pool_count, f.seen_age_minutes, f.seen_liquidity_usd, f.seen_volume_usd, f.seen_swaps, f.liquidity_not_reported], [0, null, null, null, null, null]);
});

test("copies: counted by different tokens, and 'older' means created earlier", () => {
  const me = token({ token: "0x" + "02".repeat(20), firstCreatedMs: 2000 });
  const older = token({ token: "0x" + "01".repeat(20), firstCreatedMs: 1000 });
  const newer = token({ token: "0x" + "03".repeat(20), firstCreatedMs: 3000 });
  const f = buildTokenFacts(me, [], [older, me, newer]);
  assert.equal(f.ticker_uses, 3);
  assert.equal(f.ticker_clone_of_older, true);
  const first = buildTokenFacts(older, [], [older, me, newer]);
  assert.equal(first.ticker_clone_of_older, false, "the original is not a copy of its own copies");
  assert.equal(first.ticker_uses, 3);
});

test("a token alone with its ticker is not a copy, and the list may leave it out", () => {
  const me = token();
  assert.deepEqual([buildTokenFacts(me, [], [me]).ticker_uses, buildTokenFacts(me, [], [me]).ticker_clone_of_older], [1, false]);
  assert.equal(buildTokenFacts(me, [], []).ticker_uses, 1, "this token always counts itself");
});

test("two tokens created at the same moment are not copies of each other", () => {
  const a = token({ token: "0x" + "01".repeat(20), firstCreatedMs: 5 });
  const b = token({ token: "0x" + "02".repeat(20), firstCreatedMs: 5 });
  assert.equal(buildTokenFacts(a, [], [a, b]).ticker_clone_of_older, false);
  assert.equal(buildTokenFacts(b, [], [a, b]).ticker_clone_of_older, false);
});

test("a ticker we cannot normalise means copy facts are unknown", () => {
  const f = buildTokenFacts(token({ ticker: null }), [], []);
  assert.deepEqual([f.ticker, f.ticker_uses, f.ticker_clone_of_older], [null, null, null]);
});

test("the sheet is plain JSON: it survives a round trip unchanged", () => {
  const f = buildTokenFacts(token({ facts: contract() }), [pool(1), pool(2)], []);
  assert.deepEqual(JSON.parse(JSON.stringify(f)), f);
});
