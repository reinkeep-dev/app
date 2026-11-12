// Payment policy engine. Pure function: same inputs, same verdict. No network, no keys.
// All money is bigint base units. v0 supports 6-decimal stablecoins only (USDG, USDC),
// so 1 unit = 1e-6 USD and no price feed is needed.

export const ROBINHOOD_CHAIN = "eip155:4663";
// USDG on Robinhood Chain, per Wafermap docs (wafermap.xyz/docs#networks), 9 Nov 2026.
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
  ticker_clone_of_older: boolean | null;
};

// The token being bought with this payment. facts is null when the collector has never seen the token
// (or could not be read): that is a REVIEW, because "no data" must never pass as "nothing wrong".
export type TokenUnderTest = { token: string; facts: TokenFactSheet | null };

export type TokenPolicy = {
  // Liquidity when the collector first saw the token. $1,000 is a starting value, not fitted to outcomes yet:
  // on the first day of data (2026-11-10, 39 tokens) a quarter had under $2 and the median was $3,487.
  reviewBelowLiquidityUsd: number;
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
  token: { reviewBelowLiquidityUsd: 1000 },
};

const lc = (s: string) => s.toLowerCase();
const micro = (usd: number) => BigInt(Math.round(usd * 1e6));

// The token rules alone ("what it buys"): which BLOCK and which REVIEW reasons a token's fact sheet gives.
// evaluate() runs exactly this; the free token check (GET /api/v1/verdict/{address}) runs it without any payment.
export function evaluateToken(buying: TokenUnderTest, tokenPolicy: TokenPolicy): { deny: string[]; approve: string[] } {
  const deny: string[] = [];
  const approve: string[] = [];
  const f = buying.facts;
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
    if (f.ticker_clone_of_older === true) approve.push("token_ticker_copy");
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
