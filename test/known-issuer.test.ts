// A known issuer's stablecoin (USDG from Paxos) is not blocked for the powers its issuer holds by design.
// Regression: on 2026-11-20 the free token check answered "BLOCK, do not buy this token" for USDG itself,
// the coin Reinkeep's own payments use, because Paxos can mint it and the contract is upgradeable.
import test from "node:test";
import assert from "node:assert/strict";
import type { TokenFacts } from "../collector/src/token-facts.ts";
import { defaultPolicy, evaluateToken, foldTicker, USDG_ROBINHOOD } from "../engine/policy.ts";
import { goodRequest, knownPolicy, makeApp } from "./api-fixture.ts";

const USDG = USDG_ROBINHOOD.toLowerCase();
const LOOKALIKE = "0x00000000000000000000000000000000000000f2";
const codes = (r: { data: any }): string[] => r.data.reasons.map((x: any) => x.code);

// The facts the live gate read for USDG on 2026-11-20: mint with a live owner, a proxy that can be upgraded,
// no pool seen, ticker unknown.
const issuerSheet = (token: string, over: Partial<TokenFacts> = {}): TokenFacts => ({
  token, ticker: null, facts_read_at_ms: 1, is_contract: true, is_proxy: true, has_mint: true, has_pause: true, has_blacklist: true,
  has_upgrade: true, has_owner_function: true, owner_renounced: false, mint_with_live_owner: true, total_supply: "616244832667485",
  decimals: 6, pool_count: 0, seen_age_minutes: null, seen_liquidity_usd: null, seen_volume_usd: null, seen_swaps: null,
  liquidity_not_reported: null, ticker_uses: 3, ticker_clone_of_older: true, ...over,
});
const source = (sheets: Record<string, TokenFacts | null>) => async (t: string) => sheets[t.toLowerCase()] ?? null;

test("engine: USDG is a known issuer's coin; its issuer powers and shared ticker do not count against it", () => {
  assert.deepEqual(defaultPolicy.token.knownIssuers[USDG], { issuer: "Paxos", symbol: "USDG" });
  const r = evaluateToken({ token: USDG_ROBINHOOD, facts: issuerSheet(USDG) as any }, defaultPolicy.token);
  assert.deepEqual(r, { deny: [], approve: [], issuer: "Paxos" });
});

test("engine: the same facts on any other address are still a BLOCK", () => {
  const r = evaluateToken({ token: LOOKALIKE, facts: issuerSheet(LOOKALIKE) as any }, defaultPolicy.token);
  assert.ok(r.deny.includes("token_mint_live_owner"));
  assert.ok(r.deny.includes("token_has_blacklist"));
  assert.equal(r.issuer, undefined);
});

test("engine: a known issuer's address still has to hold a contract", () => {
  const notContract = evaluateToken({ token: USDG, facts: issuerSheet(USDG, { is_contract: false }) as any }, defaultPolicy.token);
  assert.deepEqual(notContract.deny, ["token_not_contract"]);
  const unread = evaluateToken({ token: USDG, facts: null }, defaultPolicy.token);
  assert.deepEqual([unread.deny, unread.approve], [[], ["token_facts_unknown"]]);
});

test("verdict: USDG is ALLOW with the issuer named; a lookalike with the same facts is BLOCK", async () => {
  const app = makeApp({ tokenFacts: source({ [USDG]: issuerSheet(USDG), [LOOKALIKE]: issuerSheet(LOOKALIKE) }) });
  const ok = await app.send("GET", "/api/v1/verdict/" + USDG_ROBINHOOD);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.decision, "ALLOW");
  assert.deepEqual(ok.data.reasons, []);
  assert.equal(ok.data.issuer, "Paxos");
  assert.equal(ok.data.explanation.source, "rules");
  assert.match(ok.data.explanation.text, /^Allowed\. This is the official stablecoin from Paxos\./);
  const fake = await app.send("GET", "/api/v1/verdict/" + LOOKALIKE);
  assert.equal(fake.data.decision, "BLOCK");
  assert.ok(codes(fake).includes("token_mint_live_owner"));
  assert.equal(fake.data.issuer, undefined);
  assert.ok(!("issuer" in fake.data), "no issuer key on an ordinary token");
});

test("gate: buying USDG with a clean payment is ALLOW", async () => {
  const app = makeApp({ tokenFacts: source({ [USDG]: issuerSheet(USDG) }) });
  const r = await app.gate(goodRequest(), { policy: knownPolicy, token: USDG_ROBINHOOD });
  assert.equal(r.status, 200);
  assert.equal(r.data.decision, "ALLOW");
});

test("gate: a request cannot add its own token to the known issuers", async () => {
  const app = makeApp({ tokenFacts: source({ [LOOKALIKE]: issuerSheet(LOOKALIKE) }) });
  const r = await app.gate(goodRequest(), { policy: { ...knownPolicy, token: { knownIssuers: { [LOOKALIKE]: "Me" } } }, token: LOOKALIKE });
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, "unknown_policy_field");
});

// A clean-looking token in the collector's shape, so only the name decides.
const plainSheet = (token: string, ticker: string): TokenFacts => ({
  token, ticker, facts_read_at_ms: 1, is_contract: true, is_proxy: false, has_mint: false, has_pause: false, has_blacklist: false,
  has_upgrade: false, has_owner_function: false, owner_renounced: null, mint_with_live_owner: false, total_supply: "1000", decimals: 18,
  pool_count: 1, seen_age_minutes: 5, seen_liquidity_usd: 5_000_000, seen_volume_usd: 100, seen_swaps: 10, liquidity_not_reported: false,
  ticker_uses: 1, ticker_clone_of_older: false,
});

test("look-alike letters fold to Latin: the copies seen on Robinhood Chain on 2026-11-20 all read as USDT", () => {
  for (const t of ["U\u0405DT", "\u054D\u0405DT", "US\u2069DT", "usdt", "U.S.D.T", "\uFF35\uFF33\uFF24\uFF34"]) assert.equal(foldTicker(t), "USDT", JSON.stringify(t));
  assert.equal(foldTicker("DOGE"), "DOGE");
  assert.equal(foldTicker("USD0"), "USD0", "digits are not folded: USD0 is its own coin");
});

test("a token wearing a stablecoin's name off the issuer list is a BLOCK, even with a clean contract and deep liquidity", () => {
  // Live on 2026-11-20 the gate answered ALLOW for a "U\u0405DT" (Cyrillic S) and an 18-decimal "RLUSD".
  for (const ticker of ["U\u0405DT", "RLUSD", "USDG", "usdc", "PYUSD"]) {
    const r = evaluateToken({ token: LOOKALIKE, facts: plainSheet(LOOKALIKE, ticker) as any }, defaultPolicy.token);
    assert.deepEqual(r.deny, ["token_fake_stablecoin"], ticker);
  }
  for (const ticker of ["DOGE", "USDGOLD", "SUSD3", null]) {
    const r = evaluateToken({ token: LOOKALIKE, facts: { ...plainSheet(LOOKALIKE, "X"), ticker } as any }, defaultPolicy.token);
    assert.deepEqual(r.deny, [], String(ticker));
  }
});

test("verdict and gate: a fake stablecoin is BLOCK token_fake_stablecoin with a plain reason", async () => {
  const app = makeApp({ tokenFacts: source({ [LOOKALIKE]: plainSheet(LOOKALIKE, "U\u0405DT") }) });
  const v = await app.send("GET", "/api/v1/verdict/" + LOOKALIKE);
  assert.equal(v.data.decision, "BLOCK");
  assert.deepEqual(codes(v), ["token_fake_stablecoin"]);
  assert.ok(v.data.reasons[0].plain.length > 10);
  const g = await app.gate(goodRequest(), { policy: knownPolicy, token: LOOKALIKE });
  assert.equal(g.data.decision, "BLOCK");
  assert.ok(codes(g).includes("token_fake_stablecoin"));
});

test("RLUSD at Ripple's published address is a known issuer too; the 18-decimal RLUSD seen on 2026-11-20 is not", () => {
  const RLUSD = "0x8d58c0c60b8d6b88fa98b291a646db34d0f98258";
  const official = evaluateToken({ token: RLUSD, facts: issuerSheet(RLUSD) as any }, defaultPolicy.token);
  assert.deepEqual(official, { deny: [], approve: [], issuer: "Ripple" });
  const FAKE = "0x11776828ab56cbf6c66f5eb6c11644972a7cbdf2";
  assert.deepEqual(evaluateToken({ token: FAKE, facts: plainSheet(FAKE, "RLUSD") as any }, defaultPolicy.token).deny, ["token_fake_stablecoin"]);
});

test("every known issuer's own symbol is on the protected list, so its copies are caught", () => {
  for (const { symbol } of Object.values(defaultPolicy.token.knownIssuers)) assert.ok(defaultPolicy.token.stablecoinSymbols.includes(symbol), symbol);
});

test("pre-mortem: a draft named after a stablecoin is told the gate will BLOCK it, with a fix", async () => {
  const app = makeApp();
  const r = await app.send("POST", "/api/v1/premortem", {
    name: "Tether", ticker: "USDT", contract: { mint: false, ownerRenounced: true, pause: false, blacklist: false, upgradeable: false },
    buyTaxPct: 0, sellTaxPct: 0, teamAllocationPct: 0, liquidityUsd: 50_000, liquidityLockDays: 365,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.gate.decision, "BLOCK");
  const risk = r.data.risks.find((x: any) => x.code === "token_fake_stablecoin");
  assert.ok(risk && risk.fix.length > 10);
});
