// Payment policy engine. Pure function: same inputs, same verdict. No network, no keys.
// All money is bigint base units. v0 supports 6-decimal stablecoins only (USDG, USDC),
// so 1 unit = 1e-6 USD and no price feed is needed.

export const ROBINHOOD_CHAIN = "eip155:4663";
// USDG on Robinhood Chain (address checked 9 Nov 2026).
export const USDG_ROBINHOOD = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

export type PaymentRequest = {
  network: string; // CAIP-2, e.g. "eip155:4663"
  asset: string; // token contract
  amount: string; // base units, integer string
  decimals: number;
  payTo: string;
  resourceUrl: string;
  validForSeconds: number; // how long the signature stays valid
  quotedAmount?: string; // amount from the first 402 quote; must match
  now: number; // ms
};

// What the gate knows about the token being BOUGHT, from the collector (collector/src/token-facts.ts builds it).
// Only the fields the rules read are listed; the collector's sheet has more and is passed through whole.
// null always means "we could not tell", and a rule that needs it sends the payment to REVIEW, never ALLOW.
export type TokenFactSheet = {
  is_contract: boolean | null;
  is_proxy: boolean | null;
  has_pause: boolean | null;
  has_blacklist: boolean | null;
  has_upgrade: boolean | null;
  mint_with_live_owner: boolean | null;
  seen_liquidity_usd: number | null;
  ticker_uses: number | null; // how many different tokens carry this ticker, this one included
  ticker_clone_of_older: boolean | null;
  ticker?: string | null; // the collector's normalized ticker; read only by the fake-stablecoin rule
};

// The token being bought with this payment. facts is null when the collector has never seen the token
// (or could not be read): that is a REVIEW, because "no data" must never pass as "nothing wrong".
export type TokenUnderTest = { token: string; facts: TokenFactSheet | null };

export type TokenPolicy = {
  // Liquidity when the collector first saw the token. $1,000 is a starting value, not fitted to outcomes yet:
  // on the first day of data (2026-11-10, 39 tokens) a quarter had under $2 and the median was $3,487.
  reviewBelowLiquidityUsd: number;
  // Stablecoins from a known, regulated issuer, by lowercase address. Their mint, pause, blacklist and upgrade powers
  // belong to the issuer by design, and the address itself is the official one, so only "is it a contract" is checked
  // for them. Add an address here only from the issuer's own published list, with that list's URL beside it.
  knownIssuers: Record<string, { issuer: string; symbol: string }>;
  // Stablecoin symbols nobody else may use. A token carrying one of them (after look-alike letters are folded) that is
  // not in knownIssuers is a fake stablecoin and a BLOCK. Includes coins not issued on this chain at all: any token
  // there claiming that name is not the real one.
  stablecoinSymbols: string[];
};

export type Policy = {
  networks: string[];
  assets: string[];
  perPaymentUsd: number;
  dailyUsd: number; // rolling 24h, counts what was signed
  approveAboveUsd: number; // above this a human must approve
  allowPayTo: string[]; // pre-approved recipients
  allowHosts: string[]; // empty = any https host
  hostCapsUsd: Record<string, number>;
  maxValiditySec: number;
  duplicateWindowSec: number;
  maxPerMinute: number;
  token: TokenPolicy; // read only when the request names a token being bought
};

// payTo is stored lowercase. Record every signed payment BEFORE sending it.
export type LedgerEntry = { ts: number; payTo: string; amount: bigint; resourceUrl: string };

export type Verdict = "allow" | "approve" | "deny";
export type Decision = { verdict: Verdict; reasons: string[] };

export const defaultPolicy: Policy = {
  networks: [ROBINHOOD_CHAIN],
  assets: [USDG_ROBINHOOD],
  perPaymentUsd: 0.1,
  dailyUsd: 1,
  approveAboveUsd: 0.05,
  allowPayTo: [],
  allowHosts: [],
  hostCapsUsd: {},
  maxValiditySec: 120,
  duplicateWindowSec: 30,
  maxPerMinute: 10,
  token: {
    reviewBelowLiquidityUsd: 1000,
    knownIssuers: {
      // Checked 20 Nov 2026 on the issuer's own page and on-chain (symbol and decimals read from the contract).
      // USDG: https://docs.paxos.com/guides/stablecoin/usdg/mainnet.md (also https://docs.robinhood.com/chain/contracts)
      [USDG_ROBINHOOD.toLowerCase()]: { issuer: "Paxos", symbol: "USDG" },
      // RLUSD: https://docs.ripple.com/products/stablecoin/overview/token-addresses.md (18 decimals)
      "0x8d58c0c60b8d6b88fa98b291a646db34d0f98258": { issuer: "Ripple", symbol: "RLUSD" },
      // Not issued on Robinhood Chain as of 20 Nov 2026 (absent from the issuers' own lists): USDC and EURC (Circle),
      // USDT and USDT0, PYUSD and USDP (Paxos), USDe. Any token there using those names is a fake.
    },
    // Major fiat-backed and on-chain dollar and euro stablecoins by market size (2026).
    stablecoinSymbols: [
      "USDG", "USDC", "USDT", "USDT0", "PYUSD", "USDP", "RLUSD", "FDUSD", "TUSD", "GUSD", "USD1", "EURC", "EURT",
      "DAI", "USDS", "USDE", "USD0", "FRAX", "LUSD", "GHO", "CRVUSD", "USDB",
    ],
  },
};

const lc = (s: string) => s.toLowerCase();

// Look-alike letters from other scripts that copycat tickers use in place of Latin ones (seen on Robinhood Chain,
// 2026-11-20: "UЅDT" with a Cyrillic S, "ՍЅDT" with an Armenian U). Folding them lets "UЅDT" match "USDT".
const LOOKALIKE: Record<string, string> = {
  А: "A", В: "B", С: "C", Е: "E", Н: "H", І: "I", Ј: "J", К: "K", М: "M", О: "O", Р: "P", Ѕ: "S", Т: "T", Х: "X", У: "Y", Ү: "Y",
  а: "A", в: "B", с: "C", е: "E", н: "H", і: "I", ј: "J", к: "K", м: "M", о: "O", р: "P", ѕ: "S", т: "T", х: "X", у: "Y",
  Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X",
  ο: "O", ρ: "P", υ: "U", ν: "V", Ս: "U", Օ: "O", ս: "U", օ: "O",
};

// A ticker as letters and digits only, upper case, with look-alike letters folded to Latin.
export function foldTicker(raw: string): string {
  return [...raw.normalize("NFKC")]
    .map((ch) => LOOKALIKE[ch] ?? ch)
    .join("")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}
const micro = (usd: number) => BigInt(Math.round(usd * 1e6));

// The token rules alone ("what it buys"): which BLOCK and which REVIEW reasons a token's fact sheet gives.
// evaluate() runs exactly this; the free token check (GET /api/v1/verdict/{address}) runs it without any payment.
export function evaluateToken(buying: TokenUnderTest, tokenPolicy: TokenPolicy): { deny: string[]; approve: string[]; issuer?: string } {
  const deny: string[] = [];
  const approve: string[] = [];
  const f = buying.facts;
  const known = tokenPolicy.knownIssuers?.[buying.token.toLowerCase()];
  if (known !== undefined) {
    // A known issuer's stablecoin: its powers are expected, but the address must still hold a contract.
    if (f === null || f.is_contract === null) approve.push("token_facts_unknown");
    else if (f.is_contract === false) deny.push("token_not_contract");
    return { deny, approve, issuer: known.issuer };
  }
  // Wearing a stablecoin's name without being on the issuer list: a fake, whatever else its contract says.
  if (f?.ticker && (tokenPolicy.stablecoinSymbols ?? []).includes(foldTicker(f.ticker))) deny.push("token_fake_stablecoin");
  if (f === null) {
    approve.push("token_unknown");
  } else {
    // A BLOCK needs the fact to be known TRUE. If a fact a BLOCK rule reads is unknown, that is a REVIEW.
    if (f.is_contract === false) deny.push("token_not_contract");
    if (f.mint_with_live_owner === true) deny.push("token_mint_live_owner");
    if (f.has_blacklist === true) deny.push("token_has_blacklist");
    if (f.is_contract === null || f.mint_with_live_owner === null || f.has_blacklist === null || f.seen_liquidity_usd === null) {
      approve.push("token_facts_unknown");
    }
    if (f.has_pause === true) approve.push("token_has_pause");
    if (f.is_proxy === true || f.has_upgrade === true) approve.push("token_upgradeable");
    // Any shared ticker is a REVIEW, the oldest token included: "first seen" is not "the real one" (a copy can be
    // deployed before the launch, as with RUSHR). Which address is official needs a list, not the clock.
    if ((f.ticker_uses ?? 0) >= 2 || f.ticker_clone_of_older === true) approve.push("token_ticker_copy");
    if (f.seen_liquidity_usd !== null && f.seen_liquidity_usd < tokenPolicy.reviewBelowLiquidityUsd) approve.push("token_low_liquidity");
  }
  return { deny, approve };
}

// How it pays (the spend rules) and, when `buying` is given, what it buys (the token rules), in ONE answer:
// any BLOCK reason wins over any REVIEW reason, whichever side it came from.
export function evaluate(req: PaymentRequest, policy: Policy, ledger: LedgerEntry[], buying?: TokenUnderTest): Decision {
  if (!/^\d+$/.test(req.amount)) return { verdict: "deny", reasons: ["invalid_amount"] };
  const amt = BigInt(req.amount);
  const payTo = lc(req.payTo);
  const deny: string[] = [];
  const approve: string[] = [];

  if (req.decimals !== 6) deny.push("unsupported_decimals");
  if (!policy.networks.includes(req.network)) deny.push("network_not_allowed");
  if (!policy.assets.map(lc).includes(lc(req.asset))) deny.push("asset_not_allowed");
  if (req.quotedAmount !== undefined && req.quotedAmount !== req.amount) deny.push("amount_changed");
  if (req.validForSeconds > policy.maxValiditySec) deny.push("validity_too_long");

  let host = "";
  try {
    const u = new URL(req.resourceUrl);
    host = u.hostname.toLowerCase();
    if (u.protocol !== "https:") deny.push("resource_not_https");
  } catch {
    deny.push("resource_invalid");
  }
  if (host && policy.allowHosts.length && !policy.allowHosts.some((h) => host === h || host.endsWith("." + h))) {
    deny.push("host_not_allowed");
  }

  if (amt > micro(policy.perPaymentUsd)) deny.push("over_payment_cap");
  const hostCap = policy.hostCapsUsd[host];
  if (hostCap !== undefined && amt > micro(hostCap)) deny.push("over_host_cap");

  const day = ledger.filter((e) => req.now - e.ts < 86_400_000);
  if (day.reduce((s, e) => s + e.amount, 0n) + amt > micro(policy.dailyUsd)) deny.push("over_daily_cap");

  if (ledger.some((e) => req.now - e.ts <= policy.duplicateWindowSec * 1000 && e.payTo === payTo && e.amount === amt && e.resourceUrl === req.resourceUrl)) {
    deny.push("duplicate_payment");
  }
  if (ledger.filter((e) => req.now - e.ts < 60_000).length >= policy.maxPerMinute) deny.push("rate_limit");

  if (amt > micro(policy.approveAboveUsd)) approve.push("above_approval_threshold");
  if (!policy.allowPayTo.map(lc).includes(payTo) && !ledger.some((e) => e.payTo === payTo)) approve.push("new_recipient");

  if (buying) {
    const t = evaluateToken(buying, policy.token);
    deny.push(...t.deny);
    approve.push(...t.approve);
  }

  if (deny.length) return { verdict: "deny", reasons: deny };
  if (approve.length) return { verdict: "approve", reasons: approve };
  return { verdict: "allow", reasons: [] };
}

export function record(req: PaymentRequest): LedgerEntry {
  return { ts: req.now, payTo: lc(req.payTo), amount: BigInt(req.amount), resourceUrl: req.resourceUrl };
}
