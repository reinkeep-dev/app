// "What it buys" joined "how it pays": the token rules, run by the same evaluate() and returned as one answer.
import test from "node:test";
import assert from "node:assert/strict";
import { D1CollectorStore } from "../collector/src/d1-store.ts";
import { openSqlite } from "../collector/src/sqlite-adapter.ts";
import type { TokenFacts } from "../collector/src/token-facts.ts";
import { factsFromCollector, factsLive } from "../api/src/token-facts-source.ts";
import { createRpcClient } from "../collector/src/contract-facts.ts";
import { codeWith, fakeInternet, MINT, noSleep, RPC_URL } from "./collector-fixtures.ts";
import { goodRequest, knownPolicy, makeApp, PAYER } from "./api-fixture.ts";

const TOKEN = "0x00000000000000000000000000000000000000f1";
const codes = (r: { data: any }): string[] => r.data.reasons.map((x: any) => x.code);

// A token with nothing alarming in it, in the collector's own fact-sheet shape.
const cleanSheet = (over: Partial<TokenFacts> = {}): TokenFacts => ({
  token: TOKEN, ticker: "CLEAN", facts_read_at_ms: 1, is_contract: true, is_proxy: false, has_mint: false, has_pause: false, has_blacklist: false,
  has_upgrade: false, has_owner_function: false, owner_renounced: null, mint_with_live_owner: false, total_supply: "1000", decimals: 18,
  pool_count: 1, seen_age_minutes: 5, seen_liquidity_usd: 25_000, seen_volume_usd: 100, seen_swaps: 10, liquidity_not_reported: false,
  ticker_uses: 1, ticker_clone_of_older: false, ...over,
});
const source = (sheets: Record<string, TokenFacts | null>) => async (t: string) => sheets[t] ?? null;
const buy = (app: ReturnType<typeof makeApp>, extra: Record<string, unknown> = {}, request = goodRequest()) =>
  app.gate(request, { policy: knownPolicy, token: TOKEN, ...extra });

test("a clean token bought with a clean payment: ALLOW, and the receipt carries the exact facts it read", async () => {
  const sheet = cleanSheet();
  const r = await buy(makeApp({ tokenFacts: source({ [TOKEN]: sheet }) }));
  assert.equal(r.status, 200);
  assert.equal(r.data.decision, "ALLOW");
  assert.deepEqual(r.data.receipt.body.buying, { token: TOKEN, facts: sheet });
});

test("a token the collector never saw is REVIEW token_unknown, never ALLOW", async () => {
  const r = await buy(makeApp({ tokenFacts: source({}) }));
  assert.equal(r.data.decision, "REVIEW");
  assert.deepEqual(codes(r), ["token_unknown"]);
  assert.equal(r.data.receipt.body.buying.facts, null);
});

test("no facts source configured at all: still REVIEW token_unknown (we never judge a token blind)", async () => {
  const r = await buy(makeApp());
  assert.equal(r.data.decision, "REVIEW");
  assert.deepEqual(codes(r), ["token_unknown"]);
});

test("the facts store failing is treated like 'never seen': 200 with REVIEW, not ALLOW and not a 500", async () => {
  const silence = console.error;
  console.error = () => {};
  try {
    const r = await buy(makeApp({ tokenFacts: async () => { throw new Error("db down"); } }));
    assert.equal(r.status, 200);
    assert.equal(r.data.decision, "REVIEW");
    assert.deepEqual(codes(r), ["token_unknown"]);
  } finally {
    console.error = silence;
  }
});

test("each blocking token fact, when known TRUE, is a BLOCK with its own reason", async () => {
  const cases: [Partial<TokenFacts>, string][] = [
    [{ is_contract: false }, "token_not_contract"],
    [{ mint_with_live_owner: true, has_mint: true }, "token_mint_live_owner"],
    [{ has_blacklist: true }, "token_has_blacklist"],
  ];
  for (const [over, code] of cases) {
    const r = await buy(makeApp({ tokenFacts: source({ [TOKEN]: cleanSheet(over) }) }));
    assert.equal(r.data.decision, "BLOCK", code);
    assert.ok(codes(r).includes(code), `${code} in ${codes(r)}`);
  }
});

test("a blocking fact that is UNKNOWN is a REVIEW, never an ALLOW", async () => {
  for (const field of ["is_contract", "mint_with_live_owner", "has_blacklist", "seen_liquidity_usd"] as const) {
    const r = await buy(makeApp({ tokenFacts: source({ [TOKEN]: cleanSheet({ [field]: null }) }) }));
    assert.equal(r.data.decision, "REVIEW", field);
    assert.deepEqual(codes(r), ["token_facts_unknown"], field);
  }
});

test("each warning fact is a REVIEW with its own reason", async () => {
  const cases: [Partial<TokenFacts>, string][] = [
    [{ has_pause: true }, "token_has_pause"],
    [{ is_proxy: true }, "token_upgradeable"],
    [{ has_upgrade: true }, "token_upgradeable"],
    [{ ticker_clone_of_older: true, ticker_uses: 4 }, "token_ticker_copy"],
    [{ seen_liquidity_usd: 2 }, "token_low_liquidity"],
  ];
  for (const [over, code] of cases) {
    const r = await buy(makeApp({ tokenFacts: source({ [TOKEN]: cleanSheet(over) }) }));
    assert.equal(r.data.decision, "REVIEW", code);
    assert.deepEqual(codes(r), [code]);
  }
});

test("a proxy that is also upgradeable is named once, not twice", async () => {
  const r = await buy(makeApp({ tokenFacts: source({ [TOKEN]: cleanSheet({ is_proxy: true, has_upgrade: true }) }) }));
  assert.deepEqual(codes(r), ["token_upgradeable"]);
});

test("the liquidity line is the policy's to set: $500 is low by default, fine at a $100 line", async () => {
  const app = makeApp({ tokenFacts: source({ [TOKEN]: cleanSheet({ seen_liquidity_usd: 500 }) }) });
  assert.deepEqual(codes(await buy(app)), ["token_low_liquidity"]);
  const loose = await buy(app, { policy: { ...knownPolicy, token: { reviewBelowLiquidityUsd: 100 } } });
  assert.equal(loose.data.decision, "ALLOW");
  assert.equal(loose.data.receipt.policy.token.reviewBelowLiquidityUsd, 100, "the line used is in the signed policy");
});

test("ONE answer across both sides: a BLOCK from either side beats a REVIEW from the other, and all reasons are named", async () => {
  const warnToken = makeApp({ tokenFacts: source({ [TOKEN]: cleanSheet({ has_pause: true }) }) });
  const overCap = await buy(warnToken, {}, goodRequest({ amount: "900000", quotedAmount: "900000" }));
  assert.equal(overCap.data.decision, "BLOCK");
  assert.deepEqual(codes(overCap), ["over_payment_cap"], "a BLOCK lists its BLOCK reasons");

  const badToken = makeApp({ tokenFacts: source({ [TOKEN]: cleanSheet({ has_blacklist: true }) }) });
  const newPayee = await badToken.gate(goodRequest(), { token: TOKEN }); // spend side alone would be REVIEW new_recipient
  assert.equal(newPayee.data.decision, "BLOCK");
  assert.deepEqual(codes(newPayee), ["token_has_blacklist"]);

  const twoReviews = await warnToken.gate(goodRequest(), { token: TOKEN });
  assert.equal(twoReviews.data.decision, "REVIEW");
  assert.deepEqual(codes(twoReviews).sort(), ["new_recipient", "token_has_pause"]);
});

test("a payment held for a token REVIEW is not written to the payer's history", async () => {
  const app = makeApp({ tokenFacts: source({ [TOKEN]: cleanSheet({ has_pause: true }), "0x00000000000000000000000000000000000000f2": cleanSheet() }) });
  const held = await buy(app, { payer: PAYER });
  assert.equal(held.data.decision, "REVIEW");
  const same = await app.gate(goodRequest(), { policy: knownPolicy, payer: PAYER, token: "0x00000000000000000000000000000000000000f2" });
  assert.equal(same.data.decision, "ALLOW", "the held payment did not count, so this is not a duplicate");
});

test("the token address is matched case-insensitively (the collector stores lowercase)", async () => {
  const r = await makeApp({ tokenFacts: source({ [TOKEN]: cleanSheet() }) }).gate(goodRequest(), { policy: knownPolicy, token: TOKEN.toUpperCase().replace("0X", "0x") });
  assert.equal(r.data.decision, "ALLOW");
  assert.equal(r.data.receipt.body.buying.token, TOKEN);
});

test("a receipt with token facts verifies, and changing one fact afterwards breaks it", async () => {
  const app = makeApp({ tokenFacts: source({ [TOKEN]: cleanSheet() }) });
  const { receipt } = (await buy(app)).data;
  assert.deepEqual((await app.send("POST", "/api/v1/receipts/verify", { receipt })).data, { valid: true, signer: app.account.address });
  const forged = JSON.parse(JSON.stringify(receipt));
  forged.body.buying.facts.has_blacklist = true;
  assert.deepEqual((await app.send("POST", "/api/v1/receipts/verify", { receipt: forged })).data, { valid: false, reason: "body_hash_mismatch" });
});

test("validation: a broken token address and a mistyped token policy are 400s, not silent defaults", async () => {
  const app = makeApp();
  const badToken = await app.gate(goodRequest(), { token: "0x1234" });
  assert.equal(badToken.status, 400);
  assert.equal(badToken.data.error.code, "invalid_address");
  const typo = await app.gate(goodRequest(), { policy: { token: { reviewBelowLiquidity: 5 } } });
  assert.equal(typo.status, 400);
  assert.equal(typo.data.error.code, "unknown_policy_field");
  const notNumber = await app.gate(goodRequest(), { policy: { token: { reviewBelowLiquidityUsd: "5" } } });
  assert.equal(notNumber.status, 400);
  assert.equal(notNumber.data.error.code, "invalid_field");
});

test("end to end on the collector's real storage: a token stored by the collector is judged from its database", async () => {
  const db = openSqlite(":memory:");
  const store = new D1CollectorStore(db);
  const t = TOKEN;
  await store.ensureToken(t, "WIENER", "WIENER");
  await store.addPool({
    pool: "0x" + "ab".repeat(20), token: t, quote: "0x" + "00".repeat(20), name: "WIENER / WETH", symbol: "WIENER", dex: "uniswap-v3-robinhood", createdMs: 1_000,
    first: { atMs: 61_000, liquidityUsd: 12_000, volumeH24Usd: 40, buysH24: 5, sellsH24: 2, fdvUsd: null }, outcome: null,
  });
  await store.setFacts(t, {
    token: t, readAtMs: 70_000, scannerVersion: 3, isContract: true, codeSize: 3249, isProxy: false, implementation: null, hasMint: true, hasPause: false,
    hasBlacklist: false, hasUpgrade: false, hasOwnerFunction: true, owner: "0x" + "cd".repeat(20), ownerRenounced: false, mintWithLiveOwner: true,
    totalSupply: "1000000000000000000000000000", decimals: 18, symbol: "WIENER",
  });
  const app = makeApp({ tokenFacts: factsFromCollector(store) });
  const r = await buy(app);
  assert.equal(r.data.decision, "BLOCK");
  assert.deepEqual(codes(r), ["token_mint_live_owner"]);
  assert.equal(r.data.receipt.body.buying.facts.seen_liquidity_usd, 12_000);
  const unseen = await app.gate(goodRequest(), { policy: knownPolicy, token: "0x00000000000000000000000000000000000000f9" });
  assert.deepEqual(codes(unseen), ["token_unknown"]);
  db.close();
});

test("LIVE: a token nobody collected is read from the chain at request time; unknown liquidity keeps it at REVIEW", async () => {
  const inet = fakeInternet({ specs: { [TOKEN]: { symbol: "FRESH" } } }); // a plain token: no mint, pause, blacklist
  const rpc = createRpcClient({ url: RPC_URL, fetch: inet.fetch, sleep: noSleep });
  const r = await buy(makeApp({ tokenFacts: factsLive({ rpc, now: () => 1 }) }));
  assert.equal(r.data.decision, "REVIEW");
  assert.deepEqual(codes(r), ["token_facts_unknown"], "not token_unknown any more: the contract WAS read");
  assert.equal(r.data.receipt.body.buying.facts.is_contract, true);
  assert.equal(r.data.receipt.body.buying.facts.seen_liquidity_usd, null);
});

test("LIVE: a dangerous contract is BLOCKED even though no collector ever saw it", async () => {
  const inet = fakeInternet({ specs: { [TOKEN]: { code: codeWith(MINT), owner: "0x" + "ab".repeat(20) } } });
  const rpc = createRpcClient({ url: RPC_URL, fetch: inet.fetch, sleep: noSleep });
  const r = await buy(makeApp({ tokenFacts: factsLive({ rpc, now: () => 1 }) }));
  assert.equal(r.data.decision, "BLOCK");
  assert.ok(codes(r).includes("token_mint_live_owner"));
});

test("LIVE: when the collector already read the token, the chain is not asked again", async () => {
  const db = openSqlite(":memory:");
  const store = new D1CollectorStore(db);
  await store.ensureToken(TOKEN, "CLEAN", "CLEAN");
  await store.setFacts(TOKEN, { token: TOKEN, readAtMs: 5, scannerVersion: 3, isContract: true, codeSize: 10, isProxy: false, implementation: null, hasMint: false, hasPause: false, hasBlacklist: false, hasUpgrade: false, hasOwnerFunction: false, owner: null, ownerRenounced: null, mintWithLiveOwner: false, totalSupply: "1", decimals: 18, symbol: "CLEAN" });
  const inet = fakeInternet({});
  const sheet = await factsLive({ rpc: createRpcClient({ url: RPC_URL, fetch: inet.fetch, sleep: noSleep }), now: () => 1, store })(TOKEN);
  assert.equal(sheet!.facts_read_at_ms, 5, "the collector's reading is used");
  assert.equal(inet.count(RPC_URL), 0);
  db.close();
});
